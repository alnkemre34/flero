# FLERO Decision Log

Format: context → decision → consequences. Approvals come from the owner in chat only.

## 2026-11-14 — Architecture approved
- **Context:** Architecture doc set `docs/architecture/00–21` presented at the M0 gate.
- **Decision:** Owner approved the architecture (ADR-001…018 → ACCEPTED) and the recommended resolutions of the 8 blocking decisions ("Approve all 8"):

| ID | Approved resolution | Primary doc |
|---|---|---|
| DEC-01 | Directional anonymous threads (≤ 1 open per ordered pair); consolidated into one canonical thread once both identities are known | 08 §3 |
| DEC-02 | Shield block from an anonymous thread: that thread closes, no new anonymous contact or follow/like from the initiator; identified threads and the recipient-visible graph unchanged until reveal. 02b: a profile block of a hidden-thread counterpart closes that thread with a delayed generic ending | 10 §3.1 |
| DEC-03 | Photo-unlock Gold goes to the platform sink, not to the sender | 12 §2 |
| DEC-06 | Layered age assurance: DOB-derived 18+ (DOB discarded) + platform age signals + risk-based vendor check (vendor still to be selected) | 10 §4 |
| DEC-07 | Host in AWS Frankfurt with KVKK standard contracts and notification; keep a Turkish-cloud migration path | 16, 10 §10 |
| DEC-12 | No attributes of an anonymous sender shown to the recipient | 07 §3 |
| DEC-14 | No user-visible presence or last-seen in v1 | 08 §6 |
| DEC-17 | After a rejection: composer disabled, generic copy, 30-day cooldown before a new thread to the same recipient | 08 §3.4 |

- **Consequences:**
  - The CONFIRMED block rule is refined by DEC-02 for anonymous-origin blocks; the spec §15 change control applies (acceptance tests updated at M1).
  - Schemas for conversation and block (`ANON_SHIELD`) are fixed for M1.5/M1.6.
  - Still open, with doc defaults applying until decided: DEC-04, 05, 08–11, 13, 15, 16, 18–25.

## 2026-11-15: DEC-04 prices → owner-managed in the admin panel
- **Context:** the owner asked to set product, Gold, unlock, Boost and Plus prices from the admin panel.
- **Decision:** all prices live in versioned, immutable catalog rows edited through the admin API (maker-checker, audit). A price change creates a new version; quotes and media snapshot the price, so changes are never retroactive (A§8.7, T60). Store-side prices (IAP) are still set in App Store Connect / Play Console; the admin maps each store product id to a Gold amount.
- **Consequences:** seeded defaults are placeholders only.

## 2026-11-15: DEC-26 approval policy in the admin plane
- **Context:** the owner, often working alone, must be able to change prices; moving money has to stay safe.
- **Decision:**
  - Catalog/price and Shuffle config changes apply directly for SUPERADMIN or PRODUCT_CONFIG_EDITOR. Every change is versioned, bounded and written to the hash-chained audit.
  - Gold adjustments always need four eyes: FINANCE_OPERATOR requests, a different FINANCE_APPROVER approves. The DB enforces this with `CHECK approved_by <> requested_by`.
- **Consequences:**
  - A solo owner cannot move Gold alone; a second staff account is required.
  - Prices can be changed alone.

## 2026-11-15: DEC-27 directory maintenance by triggers
- **Context:** the Shuffle capacity proof is sound only if pool directories exactly mirror authoritative state (review H2).
- **Decision:** `app.discovery_resync(account)` is the only writer of `pool_slot`. It is invoked by AFTER triggers on account, plus_entitlement and boost_entitlement, so no code path can forget it. Expiry cleanup and `discovery_drift()` complete the contract.
- **Consequences:** every write to those tables pays a small trigger cost. Seeding 100k accounts took 24 s, and `discovery_drift` returned 0.
