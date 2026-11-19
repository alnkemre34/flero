# 06 — Database Architecture

**Engine:** PostgreSQL 17 (ADR-004). Extensions: `btree_gist`, `pgcrypto`, `citext` (not for handles; see §2), `pg_stat_statements`.
The DDL below is **illustrative design**. **Schema v0 now exists** as `packages/db/migrations/0001_init.sql` (M1.5, 2026-11-14). It has `app`, `ident` and `admin_v` schemas, roles and grants. `packages/db/test/schema.test.ts` covers it with 34 tests on real PostgreSQL 17 via Testcontainers, including:
- one active Boost, with exact-boundary restart
- immutable Boost terms
- balanced and append-only ledger, non-negative wallet
- api_rw locked out of the ledger and wallet
- `admin_ro` isolation (review C1)
- one open thread per direction, with restart
- config bounds (T38)

Removing the exclusion constraint or the balance trigger fails exactly the corresponding test. Not yet in v0: `wallet_apply()`, `discovery_resync()`, `admin_ops`, and partition-maintenance jobs (M2–M6). Where this doc and the migration differ, the migration is authoritative. All timestamps are `timestamptz` in UTC.

## 1. Conventions
- Internal PK: `bigint` identity (`id`). Public ID: `public_id text` set to a prefixed random 128-bit base32 value (`usr_…`, `cnv_…`, `msg_…`, `med_…`). It is unique and never derived from internal IDs or pairs. **Only public IDs cross the API** (REQ-ID-01).
- Soft state goes in enums (`CREATE TYPE`) and is extended additively.
- Every mutable aggregate has `version int` for optimistic concurrency where it's needed (config, profile).
- **Identity-isolation schema (review C1):** every table or column that can link a conversation, message, media, gift posting, notification or push attempt to an account lives in schema `ident`:
  - tables: `conversation`/`participant` membership, `message.sender_id`, `media_object.owner_id`, ledger postings of gifts, `notification`, `push_attempt`, `conversation_change`
  - `admin_ro` and `admin_ops` have **no grants** on `ident`. They read alias-keyed views (`admin_v.conversation_alias`, …) that expose `alias = HMAC(k_admin, conversation_id, side)`.
  - Only `api_rw`, `worker_rw` and the break-glass function can resolve identities.
  - A CI test logs in as `admin_ro` and asserts that no query path joins a conversation or alias to an account.
- Migrations: forward-only, reviewed SQL, expand → migrate → contract. Online index creation (`CONCURRENTLY`). A migration linter (squawk) runs in CI.

## 2. Identity, profile, geo

```sql
CREATE TYPE gender AS ENUM ('FEMALE','MALE');
CREATE TYPE account_state AS ENUM ('ACTIVE','SUSPENDED','BANNED','PENDING_DELETION','DELETED');

CREATE TABLE account (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id text NOT NULL UNIQUE,
  state account_state NOT NULL DEFAULT 'ACTIVE',
  email_norm text UNIQUE,                    -- NFC + lowercase; NULL for Apple private relay-only? (relay address stored)
  email_verified_at timestamptz,
  handle_norm text NOT NULL UNIQUE,          -- Turkish-aware fold (İ→i, I→ı handled by app-level normalizer) + NFKC, [a-z0-9._], 3–20
  handle_display text NOT NULL,
  gender gender NOT NULL,
  home_city_id int NOT NULL REFERENCES city,
  home_district_id int NOT NULL REFERENCES district,
  home_region_last_changed_at timestamptz NOT NULL,   -- single canonical field (A§8.4, T49)
  home_region_version int NOT NULL DEFAULT 1,
  discoverable boolean NOT NULL DEFAULT true,         -- user hide
  moderation_hold boolean NOT NULL DEFAULT false,
  age_assured_at timestamptz,                          -- 18+ result only (no DOB/biometrics, DEC-06)
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT district_in_city CHECK (true)            -- enforced via FK (district.city_id) + trigger
);
CREATE TABLE credential_password (account_id bigint PRIMARY KEY REFERENCES account, hash text NOT NULL, updated_at timestamptz NOT NULL);
CREATE TABLE oidc_link (provider text, subject text, account_id bigint NOT NULL REFERENCES account, linked_at timestamptz, PRIMARY KEY(provider, subject));
CREATE TABLE session (id uuid PRIMARY KEY, account_id bigint NOT NULL, device_label text, platform text, created_at timestamptz, last_seen_at timestamptz, revoked_at timestamptz);
CREATE TABLE refresh_token (token_hash bytea PRIMARY KEY, session_id uuid NOT NULL, family_id uuid NOT NULL, parent_hash bytea, used_at timestamptz, expires_at timestamptz NOT NULL);
CREATE TABLE consent (account_id bigint, kind text, doc_version text, locale text, accepted_at timestamptz, PRIMARY KEY(account_id, kind, doc_version));
CREATE TABLE home_region_change (id bigserial PRIMARY KEY, account_id bigint, from_city int, from_district int, to_city int, to_district int, changed_at timestamptz, actor text); -- audit
```
`profile` (display_name, bio, current avatar version) is 1:1 with account. `avatar_version` holds the storage key of the square source and its variants, plus moderation status.

## 3. Social graph

```sql
CREATE TABLE follow (follower_id bigint, followee_id bigint, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id), CHECK (follower_id <> followee_id));
CREATE INDEX follow_by_followee ON follow (followee_id, follower_id);   -- "follows me" check + counts
CREATE TABLE like_edge (liker_id bigint, likee_id bigint, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (liker_id, likee_id), CHECK (liker_id <> likee_id));      -- no DELETE grant to api role (irreversible)
CREATE TABLE block (blocker_id bigint, blocked_id bigint, kind text NOT NULL CHECK (kind IN ('FULL','ANON_SHIELD')),
  origin_conversation_id bigint, created_at timestamptz, PRIMARY KEY (blocker_id, blocked_id));
CREATE INDEX block_rev ON block (blocked_id, blocker_id);
CREATE TABLE profile_counter (account_id bigint PRIMARY KEY, followers int NOT NULL DEFAULT 0, likes int NOT NULL DEFAULT 0);
```
- Counters are updated in the same transaction as the edge insert. Hot celebrity rows are mitigated with a sharded counter (`profile_counter_shard`, 16 shards summed on read) if p99 lock wait exceeds 5 ms.
- Friendship is **derived** (`EXISTS` both directions) and never stored. The friend list query runs only for `viewer = owner`.
- `ANON_SHIELD` exists for DEC-02 (doc 10 §3). If DEC-02 is rejected, only `FULL` is used.
- `like_edge` has no DELETE privilege for `api_rw`. Legal-erasure removal goes through an admin security-definer function with audit.

## 4. Conversations and messages

```sql
CREATE TYPE conv_state AS ENUM ('REQUEST','ACTIVE','REJECTED','CLOSED','SEALED');
CREATE TABLE conversation (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id text UNIQUE NOT NULL,
  initiator_id bigint NOT NULL, recipient_id bigint NOT NULL,
  initiator_revealed_at timestamptz,          -- Profilimi Göster or mutual-follow
  reveal_cause text,                           -- 'SELF'|'MUTUAL_FOLLOW'
  state conv_state NOT NULL DEFAULT 'REQUEST',
  canonical_of bigint REFERENCES conversation, -- consolidation link (ADR-012)
  last_seq bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (initiator_id <> recipient_id)
);
-- one open directional thread per ordered pair (DEC-01)
CREATE UNIQUE INDEX one_thread_per_direction ON conversation (initiator_id, recipient_id) WHERE state IN ('REQUEST','ACTIVE');
-- terminal states (REJECTED, CLOSED, SEALED) don't block a restart (review M6). Restart rules are in doc 08 §3.4.
-- conversation also carries last_message_at, first_message_at, last_message_preview_ref so inbox and paging avoid scanning partitions (review M5)

CREATE TABLE participant (
  conversation_id bigint, account_id bigint, role text CHECK (role IN ('INITIATOR','RECIPIENT')),
  delivered_seq bigint NOT NULL DEFAULT 0, read_seq bigint NOT NULL DEFAULT 0,
  muted_until timestamptz, archived_at timestamptz, accepted_at timestamptz,
  PRIMARY KEY (conversation_id, account_id));
CREATE INDEX participant_inbox ON participant (account_id, conversation_id);

CREATE TABLE message (
  conversation_id bigint NOT NULL, seq bigint NOT NULL,
  public_id text NOT NULL, sender_id bigint NOT NULL,
  client_msg_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('TEXT','PHOTO','GOLD_GIFT','SYSTEM')),
  body text, media_id bigint, ledger_txn_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, seq, created_at)
) PARTITION BY RANGE (created_at);              -- monthly partitions; retention drops whole partitions after 12 months
CREATE UNIQUE INDEX message_idem ON message (conversation_id, sender_id, client_msg_id, created_at);
CREATE TABLE user_sync_state (account_id bigint PRIMARY KEY, version bigint NOT NULL DEFAULT 0);
CREATE TABLE conversation_change (account_id bigint, conversation_id bigint, version bigint NOT NULL,
  PRIMARY KEY (account_id, conversation_id));                 -- UPSERT: one row per (account, conversation), not one per event (review M4)
CREATE INDEX conversation_change_feed ON conversation_change (account_id, version);
```
- **Idempotency caveat with partitioning:** the unique index must include the partition key, so the API first looks up `client_msg_id` in a small `message_idem_recent (conversation_id, sender_id, client_msg_id) PK` table (TTL 7 days, unpartitioned). The client retry window is far shorter than 7 days.
- **Delivered/read watermarks** use `GREATEST()` updates, so they're monotonic even under out-of-order acks.
- **Sync semantics:** `user_sync_state.version` is bumped (in the same transaction) by **every** change visible to that user: message, receipt, state, reveal, consolidation, mute or archive from another device, retention purge. Because it's a per-user counter updated under row lock, versions are commit-ordered per user, so a feed read by `version > since` can't miss events (unlike a global sequence). Hot-row risk for very popular request recipients is bounded by the new-thread limits (doc 10 §6). If lock wait p99 exceeds 5 ms, bumps for receipts only are coalesced (one bump per 250 ms per user).
- **Retention (REQ-MSG-15):** text is kept 12 months. Monthly partitions are kept, and a daily idempotent job deletes rows older than 12 months from the oldest partition. Once that partition is empty it is dropped, so data is never kept more than about a day past 12 months (review M5). Message-level holds copy rows into `legal_hold_message` first. Paging queries add a `created_at` range derived from `conversation.first_message_at/last_message_at` so the planner prunes partitions. Media is kept 90 days (§5).

## 5. Media and unlocks

```sql
CREATE TYPE media_state AS ENUM ('UPLOADING','PROCESSING','READY','REJECTED','EXPIRED','REMOVED');
CREATE TABLE media_object (id bigint PK, public_id text UNIQUE, owner_id bigint, conversation_id bigint,
  kind text CHECK (kind IN ('PERSISTENT','ONE_VIEW')), state media_state, storage_key text, sha256 bytea, phash bytea,
  unlock_price_gold int NOT NULL, created_at timestamptz, expires_at timestamptz NOT NULL);   -- created_at + 90 days
CREATE TABLE media_unlock (media_id bigint, viewer_id bigint, ledger_txn_id bigint NOT NULL UNIQUE,
  unlocked_at timestamptz, one_view_state text CHECK (one_view_state IN ('UNOPENED','OPENING','CONSUMED')),
  open_attempts smallint NOT NULL DEFAULT 0, lease_id uuid, lease_expires_at timestamptz,
  PRIMARY KEY (media_id, viewer_id));
```
`unlock_price_gold` is snapshotted at send time. The price shown to the recipient is the snapshot value.

## 6. Wallet and ledger (ADR-010)

```sql
CREATE TABLE ledger_account (id bigint PK, kind text, owner_id bigint, UNIQUE(kind, owner_id));
  -- kinds: USER_AVAILABLE, USER_HELD, USER_DEBT, SYS_IAP_CLEARING, SYS_PROMO, SYS_ADMIN_GRANT, SYS_SUB_BONUS,
  --        SYS_SINK_UNLOCK, SYS_SINK_BOOST, SYS_COMPENSATION, SYS_CHARGEBACK_LOSS
CREATE TABLE wallet (account_id bigint PRIMARY KEY, available bigint NOT NULL CHECK (available >= 0),
  held bigint NOT NULL DEFAULT 0 CHECK (held >= 0), debt bigint NOT NULL DEFAULT 0 CHECK (debt >= 0), version bigint NOT NULL);
CREATE TABLE ledger_transaction (id bigint PK, op_type text NOT NULL, account_id bigint, idempotency_key text,
  payload_hash bytea, created_at timestamptz NOT NULL DEFAULT now(), reason text, actor text, approval_id bigint,
  UNIQUE (account_id, op_type, idempotency_key));
CREATE TABLE ledger_posting (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, txn_id bigint NOT NULL REFERENCES ledger_transaction,
  ledger_account_id bigint NOT NULL, amount bigint NOT NULL CHECK (amount <> 0), source_lot_id bigint);   -- lot nullable for system postings
CREATE INDEX ledger_posting_by_account ON ledger_posting (ledger_account_id, txn_id);
-- deferred constraint trigger: SUM(amount) per txn_id = 0
CREATE TABLE store_transaction (store text, store_txn_id text, account_id bigint, product_id text, gold_amount int,
  state text, ledger_txn_id bigint, raw_jws_ref text, PRIMARY KEY (store, store_txn_id));
```
- Grants: `api_rw` has no UPDATE on `ledger_*` and no DELETE anywhere in the wallet schema. Ledger writes go only through `wallet_apply(op jsonb)`, a security-definer function that validates the balance and updates the wallet in one statement set.
- `source_lot_id` tracks provenance (purchase lot, promo, gift) for fraud and chargeback analysis (REQ-GLD-01). It never restricts spending (REQ-GLD-02).

## 7. Entitlements

```sql
CREATE TABLE plus_entitlement (account_id bigint, store text, original_txn_id text, valid_from timestamptz, valid_until timestamptz,
  grace_until timestamptz, state text, PRIMARY KEY (store, original_txn_id));
-- effective Plus(U, now) := exists row with now < COALESCE(grace_until, valid_until) and state in ('ACTIVE','GRACE')

CREATE TABLE boost_quote (id uuid PK, account_id bigint, package_id int, package_version int, scope text, city_id int, district_id int,
  price_gold int, duration interval, home_region_version int, expires_at timestamptz, consumed_at timestamptz);
CREATE TABLE boost_entitlement (id bigint PK, owner_id bigint NOT NULL, scope text NOT NULL CHECK (scope IN ('DISTRICT','CITY')),
  city_id int NOT NULL, district_id int, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  price_gold int NOT NULL, gold_ledger_debit_id bigint NOT NULL UNIQUE, quote_id uuid NOT NULL UNIQUE,
  state text NOT NULL CHECK (state IN ('ACTIVE','REVOKED')),          -- EXPIRED is derived from time
  CHECK ((scope='DISTRICT') = (district_id IS NOT NULL)),
  EXCLUDE USING gist (owner_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&) WHERE (state <> 'REVOKED'));
-- immutable columns: trigger rejects UPDATE of scope/city/district/starts_at/ends_at/price (REQ-BST-05)
CREATE TABLE boost_compensation (incident_id text, entitlement_id bigint, compensation_type text, gold int, ledger_txn_id bigint,
  PRIMARY KEY (incident_id, entitlement_id, compensation_type));
```
The exclusion constraint gives "no intersecting non-revoked intervals per owner" (A§8.8). Since `starts_at = now()` and there are no future starts, an expired Boost (`ends_at ≤ now`) never intersects a new one: the `[)` bounds make the exact-boundary restart (T94) succeed.

## 8. Discovery directories (ADR-011; algorithm in doc 11)

```sql
CREATE TABLE pool (id bigint PK, city_id int, district_id int, gender gender, kind text,
  UNIQUE (city_id, district_id, gender, kind));
  -- kind: MEMBER (all discoverable, by home district), REMOTE_ELIGIBLE (Plus OR city-Boost, by home district),
  --       BOOST_DISTRICT (district Boost holders by target district), BOOST_CITY (city Boost holders by home district)
CREATE TABLE pool_size (pool_id bigint PRIMARY KEY, size int NOT NULL CHECK (size >= 0));
CREATE TABLE pool_slot (pool_id bigint, slot int, account_id bigint NOT NULL, valid_until timestamptz,   -- NULL = no time limit
  PRIMARY KEY (pool_id, slot), UNIQUE (pool_id, account_id));
```
- Pools are keyed by **home district** even for city-scope kinds, which makes "REMOTE = other districts of the city" a union of per-district pools with exact sizes, so weighted selection stays exactly uniform (doc 11 §4).
- Swap-remove on leave: lock `pool_size`, move the last slot into the hole, decrement. On join: append at `size`, increment. These run inside the domain transaction that changed membership.
- Expected write rate is low (signups, region changes, Plus/Boost events, hides): tens per second at peak. `pool_size` row-lock contention is negligible except in the largest district pools. If measured lock wait p99 exceeds 10 ms, split a pool into sub-pools (`segment`) with independent sizes; weighted selection keeps it uniform.

## 9. Config, audit, notifications, moderation (abridged)
- `discovery_config_version (id, payload jsonb, created_by, reason, created_at, activated_at, rolled_back_from)` with CHECK constraints on the bps bounds and the batch allowlist (A§8.5), so **rollbacks and imports are validated by the DB too** (T38).
- `audit_event (id, at, actor_type, actor_id, action, target_type, target_ref, reason, diff jsonb, prev_hash, hash)` is append-only (no UPDATE/DELETE grants) and exported hourly to S3 Object Lock (compliance mode, 1-year retention).
- `device_token (token_hash, account_id, session_id, platform, push_provider, locale, last_registered_at, invalidated_at)`.
- `outbox_event (id bigserial, topic, payload jsonb, created_at, processed_at, attempts, dead_lettered_at)`.

## 10. Indexing and query plans (critical paths)

| Path | Index | Target |
|---|---|---|
| Profile "follows me" check | `follow PK (follower,followee)` | 1 index probe |
| Block check (bidirectional) | `block PK` + `block_rev` | 2 probes |
| Inbox list | `participant_inbox` + conversation by id + last message via `(conversation_id, seq DESC)` | ≤ 30 ms p95 for 50 rows |
| Message page | `message PK (conversation_id, seq)` per partition | range scan |
| Sync | `conversation_change PK (account_id, version)` | range scan |
| Shuffle slot fetch | `pool_slot PK (pool_id, slot)` | N…3N probes |
| Ledger by wallet | `ledger_posting (ledger_account_id, txn_id)` | range |

Every critical query gets an `EXPLAIN (ANALYZE, BUFFERS)` artifact on the 1M-account fixture before M8 sign-off.

## 11. Backup, retention, growth
- RDS automated backups with PITR (35 days). Daily snapshot copied cross-region to eu-west-1 (KMS multi-region key). **Restore drill** quarterly and before launch, with measured RTO.
- Growth estimate (base case, doc 17): messages ~2.7 GB/day including indexes, ~1 TB at steady state under 12-month retention. Ledger < 50 GB/year. Everything else < 100 GB.
- Data deletion (REQ-ID-07): account deletion pseudonymizes the account row (public profile removed, handle released after 30 days). Messages stay with the counterpart under the retention policy, with the sender shown as "Silinmiş Kullanıcı" (DEC-15). Ledger entries are kept for statutory accounting with the owner pseudonymized.
