# 15 — Admin Platform

Covers REQ-ADM-*, REQ-ANON-07, REQ-SHF-15/16 and A§8.3/§8.5. Architecture: ADR-013. Next.js admin web plus a separate `admin-api` behind an identity-aware proxy.

## 1. Architecture
- **Access path:** staff browser → identity-aware proxy (AWS Verified Access or Cloudflare Access, device-posture checks) → `admin-web` (Next.js, server components, no public DNS) → `admin-api` (Fastify, staff JWT minted after SSO + WebAuthn).
- **DB roles:** `admin_ro` reads **only through alias-keyed views**. At launch it uses the primary, because the Multi-AZ instance has no readable replica. At scale it moves to the async analytics replica (doc 16 §1). The alias key lives in `admin_secret`, which admin roles can't read (migration 0002). Finance views show gift transactions only as aggregates, because pairing per-transaction timestamps could re-link transit legs (re-review C1a residual). It has no grants on the `ident` schema (doc 06 §1, review C1), so conversations can't be joined to accounts outside break-glass. `admin_ops` reads and writes the primary, but only through domain functions (ledger adjustments, moderation actions, config versions). `breakglass_fn` is the only path to anonymity mappings.
- **No arbitrary SQL** and no generic "edit row" screens. Every mutation is a named domain command with a validated schema, a reason field and an audit event.
- **Design:** the "Fener Işığı" tokens in a desktop-first layout: a dense data-table system (TanStack Table with virtualized rows), a command palette, a split-view inspector, and light and dark themes. Premium here means fast, calm and unambiguous, with consistent status chips and timestamps shown in UTC and local time.

## 2. RBAC (least privilege; MFA = WebAuthn for every role)
| Role | Can | Cannot |
|---|---|---|
| SUPPORT_L1 | view user profile, account state, sessions (revoke), consent and age **status**, wallet balance and history with anonymous aliases, push diagnostics | see anonymous identities, message bodies, adjust the ledger |
| SUPPORT_L2 | L1 + home-region correction requests (proposals), account recovery, gender correction proposals | approve its own proposals |
| MODERATOR | report queues, reported content (blurred by default), actions: warn, remove content, temporary suspend | permanent ban without SENIOR approval; de-anonymize |
| SENIOR_MODERATOR | bans, appeals, approve L2 corrections | ledger |
| TS_INVESTIGATOR | open investigation cases; **request** break-glass de-anonymization | self-approve |
| TS_LEAD | approve break-glass (second person), legal-hold placement | ledger |
| FINANCE_VIEWER | revenue, reconciliation, ledger read (aliases) | write |
| FINANCE_OPERATOR | propose adjustments, holds, compensation credits | approve own |
| FINANCE_APPROVER | approve adjustments and compensation (four eyes) | propose and approve the same item |
| GROWTH | banners, push/email templates (non-transactional), localization overrides | user data |
| PRODUCT_CONFIG_EDITOR | propose Shuffle/Gold/Plus/Boost catalog and config versions, run simulations | activate |
| PRODUCT_CONFIG_APPROVER | approve and activate staged rollouts, roll back | propose and approve the same item |
| SRE | operational health, queues, incidents, feature-flag kill switches | user content, ledger |
| PRIVACY_OFFICER | privacy requests (export/deletion), legal holds, audit queries | ledger |
| AUDITOR | read-only audit log | everything else |
| SUPERADMIN | manage roles (2 holders, dual approval for grants) | **no data access by default** |

Separation of duties is enforced by `approval.requested_by ≠ approval.approved_by`, checked in the DB.

## 3. Modules
| Module | Key functions | Safety rules |
|---|---|---|
| Users & profiles | search by handle, email (exact), or public ID; state; sessions; avatar moderation; consent and age status (minimal); gender/home corrections via proposals | corrections audited; home correction never touches Boost (A§8.4.7) |
| Reports, cases, appeals | unified queue with SLA timers, priority (CSAM > threats > harassment > spam), evidence snapshot, actions, appeal workflow | outcome notices generic (DEC-18) |
| Anonymous investigations | case-bound break-glass (doc 10 §7): reason, case ID, step-up, second approver, 2 h grant, real-time security alert | every resolved identity is logged; weekly review |
| Media moderation | hash-match hits, classifier queue, blurred preview, legal hold | CSAM flow per launch-gate procedure; no download of flagged media except to the isolated evidence bucket |
| Geo catalog | cities and districts, labels (tr/en), enable or disable markets | disabling a district with active Boosts is blocked |
| Entitlement catalogs | Gold packs (store product mapping), unlock prices, Plus plans and bonus, Boost packages | immutable versions; effective dates; never retroactive (T60) |
| Gold & risk | wallet inspector (aliases), holds, debt, transfer velocity dashboards, mule-graph alerts, adjustments (maker-checker) | **no balance edit field exists**; adjustments are balanced journal entries with a reason (REQ-ADM-03) |
| Boost operations | active entitlements, quotes, incident compensation reviews (A§8.8), revocations (fraud only, dual approval) | target, scope and time are read-only |
| Shuffle configuration | edit `priority_slot_ratio_bps` (500–4000), `district_local_ratio_bps` (5000–9000), batch size from {10,15,20,25,35,50}, sampler budgets; remote is derived and shown read-only; the 30-day interval is displayed as fixed | §4 |
| Banners | campaigns, schedule, placement, locale assets, allowlisted destinations, frequency caps, sponsored label, preview in light and dark | destinations allowlist; no in-chat placement |
| Templates & localization | push and email templates with variables, locale preview, privacy-lint (forbids counterpart variables in anonymous classes) | transactional templates are change-controlled |
| Feature flags | server flags with cohorts and kill switches | cannot override invariants (A§8.3) |
| Ops health | SLO dashboards, queues and DLQ, push provider health, store webhook lag, reconciliation status, incident log | — |
| Revenue reconciliation | store reports vs `store_transaction` vs ledger; refunds and chargebacks; FX-free (Gold units and store currency separated) | discrepancies open finance cases |
| Privacy requests | export and deletion queues with SLA, legal holds, KVKK request log | exports redact counterparts (DEC-19) |
| Audit | searchable, hash-chain verification status, export to WORM storage | read-only |

## 4. Shuffle configuration workflow (A§8.3, §8.5, T26, T38)
1. **Edit** produces a draft version. Validation runs in three places: the Zod schema, admin-api domain checks, and DB CHECK constraints, so imports and rollbacks are validated identically. Rejected values include 0, 499, 4001, 5000, 10000 bps (priority) and 0, 4999, 9001, 10000 bps (local).
2. **Simulate** (required before approval): the pure `shuffle-core` runs on fixtures and on privacy-thresholded aggregate market snapshots, for N ∈ allowlist. It covers local/remote scarcity, high Boost penetration and Plus expiry with a city Boost. It shows Q, the local/remote targets per N, worked examples, and the exact-enumerator non-harm check for small fixtures. Labels read "priority slot share (NORMAL target)" and "target local/remote seat share", never "Boost share".
3. **Approve** requires a different person.
4. **Staged activation:** 5 % of requests (hash of the request nonce, not of the user, to avoid per-user state), then 50 %, then 100%, with automatic monitors (error rate, latency, underfill rate, selection_mode mix). Rollback goes to the previous version and passes the same validation.
5. Immutable invariants (no history, no session dedupe, placement order, sparse rule, Gold-only Boost, max 1 active Boost) are **not represented as editable fields** at all.

## 5. Analytics (privacy-preserving)
- Aggregates only, computed by the worker into `aggregate_metric (day, city, district?, mode, selection_mode, placement, tier, metric, value)`, with **no viewer IDs**. Events (`returned`, `rendered/viewable`, `profile_opened`, `boost_block_viewable`) are counted client-side into anonymous batched counters.
- Minimum cohort threshold k = 20 for any breakdown below city level. Smaller cells are suppressed or merged.
- Dashboards always split by `selection_mode` (NORMAL / SPARSE_COMPLETE / UNCERTAIN_PARTIAL). The "priority seat ratio" KPI is computed on NORMAL only. Returned is separated from viewable, priority from tier (A§8.8, T101).
- Business KPIs: DAU/MAU, activation funnel, message volume, request acceptance rate, Gold sources and sinks, Plus conversion and churn, Boost purchases by scope, refunds and chargebacks.

## 6. Admin security specifics
- Session 8 h idle, 30 min re-auth for sensitive commands. All actions carry a `reason`.
- Exports: CSV/Parquet with PII redacted by default; dual approval; watermark (staff ID + time); expire in 7 days; logged.
- Anomaly alerts: unusual volumes of profile views per staff member, break-glass frequency, after-hours sensitive access, mass exports.
- The admin web uses a CSP with strict nonces, no third-party scripts, and SameSite=strict cookies plus CSRF tokens for cookie-auth mutations (rules/security.md).
