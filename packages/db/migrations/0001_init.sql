-- FLERO schema v0 (M1.5). Design: docs/architecture/06_DATABASE_ARCHITECTURE.md.
-- Forward-only. Applied inside one transaction by packages/db/src/migrate.ts.
--
-- Schemas:
--   app     core domain data that does not link a conversation/message/media/gift to an account
--   ident   counterpart-bearing data (review C1): only api_rw / worker_rw may read it
--   admin_v alias-keyed views; the ONLY thing admin_ro can read

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- roles (NOLOGIN groups; login users are granted membership per deployable) ----------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api_rw')    THEN CREATE ROLE api_rw NOLOGIN;    END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'worker_rw') THEN CREATE ROLE worker_rw NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_ro')  THEN CREATE ROLE admin_ro NOLOGIN;  END IF;
END $$;

CREATE SCHEMA app;
CREATE SCHEMA ident;
CREATE SCHEMA admin_v;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

-- ---------- enums ----------
CREATE TYPE app.gender         AS ENUM ('FEMALE', 'MALE');
CREATE TYPE app.account_state  AS ENUM ('ACTIVE', 'SUSPENDED', 'BANNED', 'PENDING_DELETION', 'DELETED');
CREATE TYPE ident.conv_state   AS ENUM ('REQUEST', 'ACTIVE', 'REJECTED', 'CLOSED', 'SEALED');
CREATE TYPE ident.media_state  AS ENUM ('UPLOADING', 'PROCESSING', 'READY', 'REJECTED', 'EXPIRED', 'REMOVED');

-- ---------- geo ----------
CREATE TABLE app.city (
  id        int PRIMARY KEY,
  label_key text NOT NULL UNIQUE,
  enabled   boolean NOT NULL DEFAULT true
);
CREATE TABLE app.district (
  id        int PRIMARY KEY,
  city_id   int NOT NULL REFERENCES app.city,
  label_key text NOT NULL UNIQUE,
  enabled   boolean NOT NULL DEFAULT true,
  UNIQUE (id, city_id)                       -- target of the composite FK below
);

-- ---------- identity & profile ----------
CREATE TABLE app.account (
  id                          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id                   text NOT NULL UNIQUE CHECK (public_id ~ '^usr_[a-z2-7]{26}$'),
  state                       app.account_state NOT NULL DEFAULT 'ACTIVE',
  email_norm                  text UNIQUE,
  email_verified_at           timestamptz,
  handle_norm                 text NOT NULL UNIQUE CHECK (handle_norm ~ '^[a-z0-9._]{3,20}$'),
  handle_display              text NOT NULL,
  gender                      app.gender NOT NULL,
  home_city_id                int NOT NULL,
  home_district_id            int NOT NULL,
  home_region_last_changed_at timestamptz NOT NULL,   -- the single canonical field (A§8.4, SHF-T49)
  home_region_version         int NOT NULL DEFAULT 1,
  discoverable                boolean NOT NULL DEFAULT true,
  moderation_hold             boolean NOT NULL DEFAULT false,
  age_assured_at              timestamptz,            -- 18+ result only; no DOB stored (DEC-06)
  created_at                  timestamptz NOT NULL DEFAULT now(),
  -- district must belong to the home city
  FOREIGN KEY (home_district_id, home_city_id) REFERENCES app.district (id, city_id)
);
CREATE TABLE app.profile (
  account_id   bigint PRIMARY KEY REFERENCES app.account,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 40),
  bio          text CHECK (char_length(bio) <= 300),
  avatar_key   text,
  version      int NOT NULL DEFAULT 1
);
CREATE TABLE app.credential_password (
  account_id bigint PRIMARY KEY REFERENCES app.account,
  hash       text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.oidc_link (
  provider   text NOT NULL CHECK (provider IN ('google', 'apple')),
  subject    text NOT NULL,
  account_id bigint NOT NULL REFERENCES app.account,
  linked_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject)
);
CREATE TABLE app.session (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   bigint NOT NULL REFERENCES app.account,
  device_label text,
  platform     text CHECK (platform IN ('ios', 'android', 'web')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz
);
CREATE INDEX session_by_account ON app.session (account_id) WHERE revoked_at IS NULL;
CREATE TABLE app.refresh_token (
  token_hash  bytea PRIMARY KEY,
  session_id  uuid NOT NULL REFERENCES app.session,
  family_id   uuid NOT NULL,
  parent_hash bytea,
  used_at     timestamptz,
  expires_at  timestamptz NOT NULL
);
CREATE INDEX refresh_token_family ON app.refresh_token (family_id);
CREATE TABLE app.consent (
  account_id  bigint NOT NULL REFERENCES app.account,
  kind        text NOT NULL CHECK (kind IN ('TERMS', 'PRIVACY', 'COMMUNITY', 'MARKETING')),
  doc_version text NOT NULL,
  locale      text NOT NULL CHECK (locale IN ('tr', 'en')),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, kind, doc_version)
);
CREATE TABLE app.home_region_change (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id    bigint NOT NULL REFERENCES app.account,
  from_city     int, from_district int,
  to_city       int NOT NULL, to_district int NOT NULL,
  changed_at    timestamptz NOT NULL DEFAULT now(),
  actor         text NOT NULL
);

-- ---------- social graph ----------
CREATE TABLE app.follow (
  follower_id bigint NOT NULL REFERENCES app.account,
  followee_id bigint NOT NULL REFERENCES app.account,
  frozen      boolean NOT NULL DEFAULT false,      -- kept but inert under an ANON_SHIELD (DEC-02)
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE INDEX follow_by_followee ON app.follow (followee_id, follower_id);
CREATE TABLE app.like_edge (                         -- irreversible: no DELETE grant to any app role
  liker_id   bigint NOT NULL REFERENCES app.account,
  likee_id   bigint NOT NULL REFERENCES app.account,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (liker_id, likee_id),
  CHECK (liker_id <> likee_id)
);
CREATE TABLE app.profile_counter (
  account_id bigint PRIMARY KEY REFERENCES app.account,
  followers  int NOT NULL DEFAULT 0 CHECK (followers >= 0),
  likes      int NOT NULL DEFAULT 0 CHECK (likes >= 0)
);

-- ---------- identity-bearing data (review C1) ----------
CREATE TABLE ident.block (
  blocker_id             bigint NOT NULL REFERENCES app.account,
  blocked_id             bigint NOT NULL REFERENCES app.account,
  kind                   text NOT NULL CHECK (kind IN ('FULL', 'ANON_SHIELD')),
  origin_conversation_id bigint,
  created_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id),
  CHECK ((kind = 'ANON_SHIELD') = (origin_conversation_id IS NOT NULL))
);
CREATE INDEX block_rev ON ident.block (blocked_id, blocker_id);

CREATE TABLE ident.conversation (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id             text NOT NULL UNIQUE CHECK (public_id ~ '^cnv_[a-z2-7]{26}$'),
  initiator_id          bigint NOT NULL REFERENCES app.account,
  recipient_id          bigint NOT NULL REFERENCES app.account,
  initiator_revealed_at timestamptz,
  reveal_cause          text CHECK (reveal_cause IN ('SELF', 'MUTUAL_FOLLOW')),
  state                 ident.conv_state NOT NULL DEFAULT 'REQUEST',
  canonical_of          bigint REFERENCES ident.conversation,
  last_seq              bigint NOT NULL DEFAULT 0,
  rejected_at           timestamptz,
  first_message_at      timestamptz,
  last_message_at       timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (initiator_id <> recipient_id),
  CHECK ((initiator_revealed_at IS NULL) = (reveal_cause IS NULL)),
  CHECK ((state = 'SEALED') = (canonical_of IS NOT NULL)),
  CHECK ((state = 'REJECTED') = (rejected_at IS NOT NULL))
);
-- DEC-01: at most one OPEN directional thread per ordered pair; terminal states allow a restart (review M6)
CREATE UNIQUE INDEX one_open_thread_per_direction
  ON ident.conversation (initiator_id, recipient_id) WHERE state IN ('REQUEST', 'ACTIVE');

CREATE TABLE ident.participant (
  conversation_id bigint NOT NULL REFERENCES ident.conversation,
  account_id      bigint NOT NULL REFERENCES app.account,
  role            text NOT NULL CHECK (role IN ('INITIATOR', 'RECIPIENT')),
  delivered_seq   bigint NOT NULL DEFAULT 0,
  read_seq        bigint NOT NULL DEFAULT 0,
  muted_until     timestamptz,
  archived_at     timestamptz,
  accepted_at     timestamptz,
  PRIMARY KEY (conversation_id, account_id),
  CHECK (read_seq <= delivered_seq)                  -- read implies delivered
);
CREATE INDEX participant_inbox ON ident.participant (account_id, conversation_id);

CREATE TABLE ident.message (
  conversation_id bigint NOT NULL,
  seq             bigint NOT NULL CHECK (seq > 0),
  public_id       text NOT NULL,
  sender_id       bigint NOT NULL,
  client_msg_id   uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('TEXT', 'PHOTO', 'GOLD_GIFT', 'SYSTEM')),
  body            text CHECK (char_length(body) <= 4000),
  media_id        bigint,
  ledger_txn_id   bigint,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, seq, created_at),
  CHECK ((kind = 'TEXT') = (body IS NOT NULL)),
  CHECK ((kind = 'PHOTO') = (media_id IS NOT NULL)),
  CHECK ((kind = 'GOLD_GIFT') = (ledger_txn_id IS NOT NULL))
) PARTITION BY RANGE (created_at);

-- idempotent send lookup outside the partitioned table (doc 06 §4), TTL-pruned after 7 days
CREATE TABLE ident.message_idem_recent (
  conversation_id bigint NOT NULL,
  sender_id       bigint NOT NULL,
  client_msg_id   uuid NOT NULL,
  seq             bigint NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, sender_id, client_msg_id)
);

CREATE TABLE ident.user_sync_state (
  account_id bigint PRIMARY KEY REFERENCES app.account,
  version    bigint NOT NULL DEFAULT 0 CHECK (version >= 0)
);
CREATE TABLE ident.conversation_change (               -- upserted, one row per (account, conversation) (review M4)
  account_id      bigint NOT NULL REFERENCES app.account,
  conversation_id bigint NOT NULL REFERENCES ident.conversation,
  version         bigint NOT NULL,
  PRIMARY KEY (account_id, conversation_id)
);
CREATE INDEX conversation_change_feed ON ident.conversation_change (account_id, version);

-- creates the monthly partition containing `month` (idempotent)
CREATE FUNCTION ident.ensure_message_partition(month date) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  start_d date := date_trunc('month', month)::date;
  end_d   date := (date_trunc('month', month) + interval '1 month')::date;
  name    text := format('message_%s', to_char(start_d, 'YYYYMM'));
BEGIN
  EXECUTE format('CREATE TABLE IF NOT EXISTS ident.%I PARTITION OF ident.message FOR VALUES FROM (%L) TO (%L)',
                 name, start_d, end_d);
END $$;
SELECT ident.ensure_message_partition(now()::date);
SELECT ident.ensure_message_partition((now() + interval '1 month')::date);

CREATE TABLE ident.media_object (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id         text NOT NULL UNIQUE,
  owner_id          bigint NOT NULL REFERENCES app.account,
  conversation_id   bigint NOT NULL REFERENCES ident.conversation,
  kind              text NOT NULL CHECK (kind IN ('PERSISTENT', 'ONE_VIEW')),
  state             ident.media_state NOT NULL DEFAULT 'UPLOADING',
  storage_key       text NOT NULL UNIQUE,
  unlock_price_gold int NOT NULL CHECK (unlock_price_gold > 0),   -- snapshot at send time
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE TABLE ident.media_unlock (
  media_id         bigint NOT NULL REFERENCES ident.media_object,
  viewer_id        bigint NOT NULL REFERENCES app.account,
  ledger_txn_id    bigint NOT NULL UNIQUE,
  unlocked_at      timestamptz NOT NULL DEFAULT now(),
  one_view_state   text CHECK (one_view_state IN ('UNOPENED', 'OPENING', 'CONSUMED')),
  open_attempts    smallint NOT NULL DEFAULT 0 CHECK (open_attempts BETWEEN 0 AND 3),
  lease_id         uuid,
  lease_expires_at timestamptz,
  PRIMARY KEY (media_id, viewer_id)                  -- one unlock per viewer: never charged twice (REQ-MED-03)
);

CREATE TABLE ident.device_token (
  token_hash         bytea PRIMARY KEY,
  account_id         bigint NOT NULL REFERENCES app.account,
  session_id         uuid NOT NULL REFERENCES app.session,
  platform           text NOT NULL CHECK (platform IN ('ios', 'android')),
  provider           text NOT NULL CHECK (provider IN ('apns', 'fcm')),
  token_ciphertext   bytea NOT NULL,
  locale             text NOT NULL,
  last_registered_at timestamptz NOT NULL DEFAULT now(),
  invalidated_at     timestamptz
);
CREATE TABLE ident.notification (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recipient_id bigint NOT NULL REFERENCES app.account,
  event_type   text NOT NULL,
  domain_ref   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  read_at      timestamptz,
  UNIQUE (recipient_id, event_type, domain_ref)      -- dedupe key (doc 09 §1)
);

-- ---------- wallet & ledger (ADR-010) ----------
CREATE TABLE app.ledger_account (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind     text NOT NULL CHECK (kind IN (
             'USER_AVAILABLE', 'USER_HELD', 'USER_DEBT',
             'SYS_IAP_CLEARING', 'SYS_PROMO', 'SYS_ADMIN_GRANT', 'SYS_SUB_BONUS',
             'SYS_SINK_UNLOCK', 'SYS_SINK_BOOST', 'SYS_COMPENSATION', 'SYS_CHARGEBACK_LOSS')),
  owner_id bigint REFERENCES app.account,
  CHECK ((kind LIKE 'USER\_%') = (owner_id IS NOT NULL))
);
CREATE UNIQUE INDEX ledger_account_user ON app.ledger_account (kind, owner_id) WHERE owner_id IS NOT NULL;
CREATE UNIQUE INDEX ledger_account_sys  ON app.ledger_account (kind) WHERE owner_id IS NULL;

CREATE TABLE app.wallet (
  account_id bigint PRIMARY KEY REFERENCES app.account,
  available  bigint NOT NULL DEFAULT 0 CHECK (available >= 0),   -- never negative (REQ-GLD-07)
  held       bigint NOT NULL DEFAULT 0 CHECK (held >= 0),
  debt       bigint NOT NULL DEFAULT 0 CHECK (debt >= 0),
  frozen     boolean NOT NULL DEFAULT false,
  version    bigint NOT NULL DEFAULT 0
);
CREATE TABLE app.ledger_transaction (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  op_type         text NOT NULL,
  account_id      bigint REFERENCES app.account,
  idempotency_key text NOT NULL,
  payload_hash    bytea NOT NULL,
  reason          text,
  actor           text NOT NULL,
  approval_id     bigint,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, op_type, idempotency_key)
);
CREATE TABLE app.ledger_posting (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  txn_id            bigint NOT NULL REFERENCES app.ledger_transaction,
  ledger_account_id bigint NOT NULL REFERENCES app.ledger_account,
  amount            bigint NOT NULL CHECK (amount <> 0),
  source_lot_id     bigint                            -- provenance only; never restricts spending
);
CREATE INDEX ledger_posting_by_account ON app.ledger_posting (ledger_account_id, txn_id);
CREATE INDEX ledger_posting_by_txn ON app.ledger_posting (txn_id);

-- every ledger transaction must balance to zero at commit (double entry)
CREATE FUNCTION app.check_txn_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE total bigint;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO total FROM app.ledger_posting WHERE txn_id = NEW.txn_id;
  IF total <> 0 THEN
    RAISE EXCEPTION 'ledger transaction % is unbalanced (sum=%)', NEW.txn_id, total
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledger_txn_balanced
  AFTER INSERT ON app.ledger_posting
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app.check_txn_balanced();

-- the ledger is append-only for everyone, including the owner
CREATE FUNCTION app.reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed (append-only)', TG_OP, TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER ledger_posting_append_only BEFORE UPDATE OR DELETE ON app.ledger_posting
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER ledger_transaction_append_only BEFORE UPDATE OR DELETE ON app.ledger_transaction
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();

CREATE TABLE app.store_transaction (
  store         text NOT NULL CHECK (store IN ('APPLE', 'GOOGLE')),
  store_txn_id  text NOT NULL,
  account_id    bigint NOT NULL REFERENCES app.account,
  product_id    text NOT NULL,
  gold_amount   int CHECK (gold_amount > 0),
  state         text NOT NULL CHECK (state IN ('CREDITED', 'REVERSED')),
  ledger_txn_id bigint REFERENCES app.ledger_transaction,
  PRIMARY KEY (store, store_txn_id)                  -- exactly-once credit per store transaction
);

-- ---------- entitlements ----------
CREATE TABLE app.plus_entitlement (
  store           text NOT NULL CHECK (store IN ('APPLE', 'GOOGLE')),
  original_txn_id text NOT NULL,
  account_id      bigint NOT NULL REFERENCES app.account,
  valid_from      timestamptz NOT NULL,
  valid_until     timestamptz NOT NULL,
  grace_until     timestamptz,
  state           text NOT NULL CHECK (state IN ('ACTIVE', 'GRACE', 'ON_HOLD', 'EXPIRED', 'REVOKED', 'REFUNDED')),
  PRIMARY KEY (store, original_txn_id),
  CHECK (valid_until > valid_from),
  CHECK (grace_until IS NULL OR grace_until >= valid_until)
);
CREATE INDEX plus_by_account ON app.plus_entitlement (account_id);

CREATE TABLE app.boost_quote (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          bigint NOT NULL REFERENCES app.account,
  package_id          int NOT NULL,
  package_version     int NOT NULL,
  scope               text NOT NULL CHECK (scope IN ('DISTRICT', 'CITY')),
  city_id             int NOT NULL REFERENCES app.city,
  district_id         int REFERENCES app.district,
  price_gold          int NOT NULL CHECK (price_gold > 0),
  duration            interval NOT NULL CHECK (duration > interval '0'),
  home_region_version int NOT NULL,
  expires_at          timestamptz NOT NULL,
  consumed_at         timestamptz,
  CHECK ((scope = 'DISTRICT') = (district_id IS NOT NULL))
);

CREATE TABLE app.boost_entitlement (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id             bigint NOT NULL REFERENCES app.account,
  scope                text NOT NULL CHECK (scope IN ('DISTRICT', 'CITY')),
  city_id              int NOT NULL REFERENCES app.city,
  district_id          int REFERENCES app.district,
  starts_at            timestamptz NOT NULL,
  ends_at              timestamptz NOT NULL,
  price_gold           int NOT NULL CHECK (price_gold > 0),
  gold_ledger_debit_id bigint NOT NULL UNIQUE REFERENCES app.ledger_transaction,
  quote_id             uuid NOT NULL UNIQUE REFERENCES app.boost_quote,
  state                text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'REVOKED')),  -- EXPIRED is derived from time
  CHECK ((scope = 'DISTRICT') = (district_id IS NOT NULL)),
  CHECK (ends_at > starts_at),
  -- at most one non-revoked Boost interval per owner, ever overlapping (A§8.8); [) makes exact-boundary restart legal
  CONSTRAINT one_active_boost_per_owner
    EXCLUDE USING gist (owner_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&) WHERE (state <> 'REVOKED')
);

-- purchased target, scope, window and price are immutable; only ACTIVE -> REVOKED is allowed (REQ-BST-05)
CREATE FUNCTION app.boost_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.owner_id, NEW.scope, NEW.city_id, NEW.district_id, NEW.starts_at, NEW.ends_at, NEW.price_gold,
      NEW.gold_ledger_debit_id, NEW.quote_id)
     IS DISTINCT FROM
     (OLD.owner_id, OLD.scope, OLD.city_id, OLD.district_id, OLD.starts_at, OLD.ends_at, OLD.price_gold,
      OLD.gold_ledger_debit_id, OLD.quote_id) THEN
    RAISE EXCEPTION 'boost_entitlement purchase terms are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (OLD.state = NEW.state OR (OLD.state = 'ACTIVE' AND NEW.state = 'REVOKED')) THEN
    RAISE EXCEPTION 'illegal boost state transition % -> %', OLD.state, NEW.state USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER boost_entitlement_immutable BEFORE UPDATE ON app.boost_entitlement
  FOR EACH ROW EXECUTE FUNCTION app.boost_immutable();
CREATE TRIGGER boost_entitlement_no_delete BEFORE DELETE ON app.boost_entitlement
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();

CREATE TABLE app.boost_compensation (
  incident_id       text NOT NULL,
  entitlement_id    bigint NOT NULL REFERENCES app.boost_entitlement,
  compensation_type text NOT NULL,
  gold              int NOT NULL CHECK (gold >= 0),
  ledger_txn_id     bigint NOT NULL REFERENCES app.ledger_transaction,
  PRIMARY KEY (incident_id, entitlement_id, compensation_type)   -- never double-credited (A§8.8)
);

-- ---------- discovery (ADR-011, doc 11 §2) ----------
CREATE TABLE app.pool (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  city_id     int NOT NULL REFERENCES app.city,
  district_id int NOT NULL REFERENCES app.district,
  gender      app.gender NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('MEMBER', 'REMOTE_ELIGIBLE', 'BOOST_DISTRICT', 'BOOST_CITY')),
  UNIQUE (city_id, district_id, gender, kind)
);
CREATE TABLE app.pool_size (
  pool_id bigint PRIMARY KEY REFERENCES app.pool,
  size    int NOT NULL DEFAULT 0 CHECK (size >= 0)
);
CREATE TABLE app.pool_slot (
  pool_id     bigint NOT NULL REFERENCES app.pool,
  slot        int NOT NULL CHECK (slot >= 0),
  account_id  bigint NOT NULL REFERENCES app.account,
  valid_until timestamptz,                          -- NULL = no time limit
  PRIMARY KEY (pool_id, slot),
  UNIQUE (pool_id, account_id)
);
CREATE INDEX pool_slot_expiry ON app.pool_slot (pool_id, valid_until) WHERE valid_until IS NOT NULL;

-- server-owned config, bounds enforced by the DB on every path incl. import/rollback (A§8.5, SHF-T38)
CREATE TABLE app.discovery_config_version (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shuffle_batch_size int NOT NULL CHECK (shuffle_batch_size IN (10, 15, 20, 25, 35, 50)),
  priority_bps       int NOT NULL CHECK (priority_bps BETWEEN 500 AND 4000),
  local_bps          int NOT NULL CHECK (local_bps BETWEEN 5000 AND 9000),
  budgets            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by         text NOT NULL,
  reason             text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  activated_at       timestamptz,
  rolled_back_from   bigint REFERENCES app.discovery_config_version
);
CREATE TRIGGER discovery_config_immutable BEFORE DELETE ON app.discovery_config_version
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();

-- ---------- audit & outbox ----------
CREATE TABLE app.audit_event (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  actor_type  text NOT NULL CHECK (actor_type IN ('USER', 'STAFF', 'SYSTEM')),
  actor_id    text NOT NULL,
  action      text NOT NULL,
  target_type text NOT NULL,
  target_ref  text NOT NULL,
  reason      text,
  diff        jsonb,
  prev_hash   bytea,
  hash        bytea NOT NULL
);
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON app.audit_event
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();

CREATE TABLE ident.outbox_event (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  topic            text NOT NULL,
  payload          jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz,
  attempts         int NOT NULL DEFAULT 0,
  dead_lettered_at timestamptz
);
CREATE INDEX outbox_pending ON ident.outbox_event (id) WHERE processed_at IS NULL AND dead_lettered_at IS NULL;

-- ---------- admin views (alias-keyed; review C1) ----------
-- Views run with the owner's privileges, so admin_ro needs no grant on the underlying tables.
-- The alias key is a per-session setting supplied by admin-api; without it, aliases are NULL.
CREATE VIEW admin_v.conversation_alias AS
SELECT encode(hmac(c.id::text, current_setting('flero.admin_alias_key', true), 'sha256'), 'hex') AS alias,
       c.state, c.created_at, c.last_message_at, (c.initiator_revealed_at IS NOT NULL) AS revealed
FROM ident.conversation c;

CREATE VIEW admin_v.account_summary AS
SELECT a.public_id, a.handle_display, a.state, a.gender, a.home_city_id, a.home_district_id,
       a.created_at, (a.age_assured_at IS NOT NULL) AS age_assured
FROM app.account a;

CREATE VIEW admin_v.wallet_summary AS
SELECT a.public_id, w.available, w.held, w.debt, w.frozen
FROM app.wallet w JOIN app.account a ON a.id = w.account_id;

-- ---------- grants ----------
GRANT USAGE ON SCHEMA app, ident TO api_rw, worker_rw;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA app, ident TO api_rw, worker_rw;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA app, ident TO api_rw, worker_rw;
GRANT DELETE ON app.follow, app.refresh_token, app.pool_slot, ident.block,
                ident.message_idem_recent TO api_rw, worker_rw;
GRANT DELETE ON ident.outbox_event TO worker_rw;
-- money: app roles may read but never write the ledger or wallet directly (doc 06 §6: wallet_apply() lands in M4)
REVOKE INSERT, UPDATE ON app.ledger_transaction, app.ledger_posting, app.wallet, app.ledger_account FROM api_rw, worker_rw;
-- config versions are written by admin-api only (later admin_ops role)
REVOKE INSERT, UPDATE ON app.discovery_config_version FROM api_rw, worker_rw;

GRANT USAGE ON SCHEMA admin_v TO admin_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA admin_v TO admin_ro;
-- admin_ro deliberately has NO usage on app or ident.
