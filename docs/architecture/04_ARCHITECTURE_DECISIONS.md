# 04 — Architecture Decision Records

Format: context → decision → consequences. Status values: `PROPOSED` (awaiting owner approval at the gate), `ACCEPTED`, `SUPERSEDED`. All of the ADRs below were **ACCEPTED on 2026-11-14** with the owner's approval of the architecture (doc 00 §6b). ADR-012's pending condition, DEC-01, was approved the same day. After approval this file is the single authoritative decision log (master §2). Changes add a new ADR; they never edit an accepted one.

---

### ADR-001 Modular monolith with four deployables
**Context:** The domains (identity, social, conversation, wallet, entitlements, discovery) share strong transactional invariants. Boost activation alone touches account, wallet, ledger and entitlement in one transaction (A§8.7). The modeled load (doc 17) fits one DB primary. The team is small.
**Decision:** One TypeScript codebase with strictly bounded modules (`packages/domain-*`), communicating through in-process interfaces and the transactional outbox. Four deployables: `api` (public HTTP), `realtime` (WebSocket gateway), `worker` (jobs/outbox consumers/media/push), `admin-api` (staff HTTP, separate ingress and auth).
**Consequences:** ACID transactions across modules. Simple deployments. Lint rules (dependency-cruiser) enforce module boundaries so that a module can later be extracted (messaging first if it has to be) without rewriting. There is no independent scaling per domain beyond the four deployables, which is acceptable at the modeled load.

### ADR-002 React Native + Expo for iOS and Android
**Context:** Two platforms, premium motion, a small team, and shared TypeScript contracts (doc 03 §1).
**Decision:** React Native New Architecture with Expo dev builds (no Expo Go limits), EAS Build/Submit. EAS Update only for JS-only fixes that comply with store rules, under a `runtimeVersion` policy.
**Consequences:** Native modules are allowed (screenshot protection, notification service extension). The M1 frame-time gate on a midrange Android device decides the go/no-go; Flutter is the fallback.

### ADR-003 TypeScript / Fastify backend, Zod-first contracts
**Decision:** Fastify with `fastify-type-provider-zod`. Zod schemas are the source for validation and for the generated OpenAPI 3.1. Strict schemas reject unknown fields, which A§9 T84 requires for the Shuffle overrides. Generated clients feed mobile and admin. CI fails when the generated spec, the clients and the examples drift.
**Consequences:** One schema language end to end. An OpenAPI diff gate catches breaking changes.

### ADR-004 PostgreSQL 17 as the single source of truth
**Decision:** Managed PostgreSQL (RDS Multi-AZ, synchronous standby). Every authoritative state lives here: accounts, social graph, conversations/messages, ledger, entitlements, discovery directories, config versions, audit. Read replicas only for admin analytics and non-authoritative reads.
**Consequences:** Financial and eligibility checks always hit the primary. Message tables are partitioned monthly so retention can drop partitions. Documented sharding triggers are in doc 17 §8.

### ADR-005 Own WebSocket gateway; realtime is a notification channel, not the record
**Decision:** The `realtime` service authenticates sockets with short-lived access tokens, binds each socket to `user_id` and its session, and subscribes to the Redis channel `u:{user_internal_id}` only. Publishers (api/worker) send events that are already redacted per recipient. Clients reconcile by per-conversation sequence through HTTP sync. Typing travels gateway-to-gateway over Redis and is never persisted.
**Consequences:** If Redis or the gateway fails, delivery degrades to push plus polling sync, and nothing is lost. Session revocation closes the socket within 60 s through the session-revocation channel. Plan B is Centrifugo.

### ADR-006 Transactional outbox + Graphile Worker
**Decision:** Every side effect (push, realtime fan-out retry, media processing, receipts, analytics aggregation, retention) is a row in `outbox_event` or a Graphile job inserted in the same transaction. Consumers are idempotent on `(event_id)` or domain keys. Poison events go to a dead-letter table after N attempts and raise an alert.
**Consequences:** No dual writes. At-least-once delivery with idempotent effects. Realtime fan-out is also attempted best-effort right after commit, to keep latency low.

### ADR-007 In-house authentication on audited primitives
**Decision:** argon2id passwords. Google/Apple ID tokens verified with `jose` against provider JWKS (issuer, audience, nonce, expiry). Access JWT lasts 10 min (EdDSA, rotating keys via KMS-wrapped secrets). Opaque refresh tokens are 256-bit, stored as SHA-256, rotated on every use, and **reuse detection revokes the token family**. Session rows carry device metadata. Accounts never merge automatically on matching email. Linking a provider requires an authenticated session plus re-authentication. Step-up re-authentication for: email/password change, provider link/unlink, sign-out-all, data export, and reveal (optional). Staff auth is separate (ADR-013).
**Consequences:** Security review gate (Opus-level) before M2 exit. Penetration test before launch.

### ADR-008 Direct APNs + FCM, privacy-minimal payloads
**Decision:** The worker sends through APNs (token-based .p8) and FCM HTTP v1. Payloads carry generic localized copy (doc 09 §4) plus an opaque `notification_id`. The client fetches details after unlock and authentication. Collapse and thread IDs use conversation public IDs, never user IDs. No iOS Communication Notifications (`INSendMessageIntent`) and no Android `Person`/shortcut donation for anonymous threads.
**Consequences:** No third-party relay. We own retry, invalidation and diagnostics.

### ADR-009 Direct store billing integration, ledger-authoritative
**Decision:** The client buys through StoreKit 2 / Play Billing. The server verifies the JWS (Apple) or calls purchases API (Google), then credits Gold exactly once keyed on `(store, transaction_id)`. Subscriptions come from App Store Server Notifications V2 + Google RTDN (Pub/Sub push) with periodic reconciliation polling. Consumables are acknowledged/consumed only **after** the credit commits.
**Consequences:** More code than RevenueCat. Full control. DEC-23 lets the owner choose RevenueCat instead.

### ADR-010 Double-entry Gold ledger with materialized balances
**Decision:** `ledger_transaction` + `ledger_posting` (sum of postings = 0 per transaction, enforced by a deferred constraint trigger). `wallet` rows hold `available` and `held` with CHECK ≥ 0, updated in the same transaction under a row lock. Debt is a separate non-spendable liability account. Nightly and on-demand reconciliation verifies Σpostings = balance per wallet and alerts on any drift.
**Consequences:** No mutable counter without an audit trail (A§8.7). Admin adjustments are just journal entries that need approval.

### ADR-011 Shuffle: dense-slot directories in PostgreSQL, maintained synchronously
**Decision:** Discovery pools are dense, gap-free arrays `(pool_id, slot) → account`, maintained in the **same transaction** as the membership change (signup, region change, discoverability, moderation, Plus activation, Boost activation) using swap-remove. Uniform sampling picks random slots with a CSPRNG. Time-based validity (`valid_until`) is checked at read, so expiry needs no write. Viewer-specific exclusions (blocks, self) use rejection sampling. Exhaustion is proven by bounded enumeration. No Redis dependency for eligibility. Full design: doc 11.
**Consequences:** Exactly uniform draws over the eligible set (no random-key gap bias, A§5.2). Small write amplification on membership changes. A pool-size row lock serializes changes within a pool, which is fine at the low rate those changes happen.

### ADR-012 Directional anonymous threads (pending DEC-01)
**Decision (proposed):** At most one thread per *ordered* pair while its initiator is anonymous. Both directions may exist independently. Once each direction's counterpart is identified to the other (both revealed, or a mutual follow), the pair is consolidated: the older thread becomes canonical and the newer one is sealed read-only and linked. Profile CTAs are computed with the rule in doc 08 §3.2, which is identical regardless of hidden threads.
**Consequences:** Oracle-free by construction. History is fragmented only until mutual identification.

### ADR-013 Separate staff identity and admin plane
**Decision:** Staff sign in through OIDC SSO (Google Workspace or Entra) plus mandatory WebAuthn. The admin web and admin API sit behind an identity-aware proxy (AWS Verified Access or Cloudflare Access). The admin API uses a separate DB role with column-level grants, so the anonymity mapping is readable only through a break-glass stored procedure that writes an audit row in the same transaction.
**Consequences:** Compromising a user account doesn't reach the admin plane. Support tooling can't casually de-anonymize.

### ADR-014 AWS Frankfurt on ECS Fargate, OpenTofu IaC
**Decision:** As in doc 16. Three AZs, no Kubernetes initially. Environments: `dev`, `staging` (production-like, synthetic data only), `prod`.
**Consequences:** KVKK cross-border transfer obligations (standard contract + notification), DEC-07. Portable containers keep a Turkish-cloud migration possible.

### ADR-015 Server-authoritative time and entitlements
**Decision:** Every time-window check (Boost validity, Plus validity, 30-day region interval, quote expiry, one-view grace) uses DB `now()` inside the deciding transaction, never the client clock or an app-node clock. Entitlements are always recomputed on the server. Client-provided tier or paid flags are ignored and their schemas reject them.
**Consequences:** No dependency on expiry jobs (A§8.8). Clock skew between nodes doesn't matter.

### ADR-016 Single counterparty projection for anonymity
**Decision:** One server function `counterpartyView(viewer, conversation)` is the only code path allowed to resolve "who is on the other side". Chat, inbox, push composer, wallet history, exports and moderation all call it. Serializers are allowlist-based per endpoint. Contract tests assert forbidden fields, plus differential tests (doc 10 §5).
**Consequences:** Anonymity is enforced centrally, and one place gets audited.

### ADR-017 No E2EE in v1
**Decision:** Encryption in transit (TLS 1.2+, HSTS) and at rest (KMS). Moderation, reporting, retention and one-view metering all require server access to content. No E2EE claim anywhere (master §5).
**Consequences:** This has to be stated honestly in the privacy policy. Access controls and audit make up for it.

### ADR-018 Monorepo layout
```
apps/mobile        Expo app
apps/admin         Next.js admin
apps/api           Fastify public API (composition root)
apps/admin-api     Fastify staff API (composition root)
apps/realtime      WebSocket gateway
apps/worker        Graphile Worker + outbox consumers
packages/contracts OpenAPI/AsyncAPI generation + generated clients
packages/domain-*  identity, profile, geo, social, conversation, media, wallet, billing, entitlement, discovery, notification, moderation, config, audit
packages/shuffle-core   pure allocator/sampler logic (no I/O)
packages/ui-tokens      design tokens (mobile + admin)
tools/shuffle-reference independent Python exact enumerator (release gate)
infra/             OpenTofu modules
```
