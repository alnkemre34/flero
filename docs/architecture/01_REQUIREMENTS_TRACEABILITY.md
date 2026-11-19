# 01 — Requirements Traceability Matrix

**Status:** Draft for owner approval · **Source:** `FLERO_MASTER_SPEC.md` v1.0 (master §0–§15) + Appendix A (Shuffle V5.2 LOCKED) · **Date:** 2026-11-14

This matrix is the index of binding requirements. Each row carries a stable ID, its source anchor, a label, the design document that satisfies it, and how it is verified. Implementation tickets and tests must cite these IDs (`REQ-…`). Appendix A test cases keep their own numbering (`SHF-T01…T101`) and are mapped as a group in §14.

**Labels** (master §0): `CONFIRMED` = binding · `ENG` = engineering choice (Claude decides; recorded in an ADR) · `GATE` = launch gate · `DEC-xx` = decision required (catalogue: doc 00 §7).
**Verification codes:** U = unit · P = property/exhaustive · I = integration (real Postgres) · C = contract/OpenAPI · E = E2E (Maestro/Playwright) · L = load · S = security/privacy regression · M = manual/legal review · A = accessibility/device audit.

The spec's required pre-code deliverables (master §2) map onto this doc set:

| Spec deliverable | Doc |
|---|---|
| `TECHNOLOGY_EVALUATION` | 03 |
| `ARCHITECTURE_DECISIONS` | 04 |
| `SYSTEM_ARCHITECTURE` | 05 |
| `SECURITY_PRIVACY_MODEL` | 10 |
| `SCALABILITY_AND_SLO_PLAN` | 17 |
| `API_DESIGN_PLAN` | 07 |
| `UI_UX_BLUEPRINT` | 14 |
| `IMPLEMENTATION_ROADMAP` | 19 |
| `RISK_REGISTER` | 20 |

---

## 1. Platform, localization, onboarding

| ID | Requirement | Src | Label | Doc | Verify |
|---|---|---|---|---|---|
| REQ-PLT-01 | Native-quality Android and iOS apps | §1 | CONFIRMED | 13 | E, A |
| REQ-PLT-02 | Turkish-first and complete English. Errors arrive as stable codes, never as inline Turkish text | §1, A§6 | CONFIRMED | 13, 07 | U (i18n key coverage), E |
| REQ-PLT-03 | Desktop-first web admin console | §10 | CONFIRMED | 15 | E |
| REQ-ONB-01 | Sign up with email+password, Google or Apple | §1 | CONFIRMED | 10, 07 | I, E |
| REQ-ONB-02 | Optional phone verification, triggered by risk | §1 | CONFIRMED | 10 | I |
| REQ-ONB-03 | Meaningful 18+ assurance that keeps only minimal proof | §1, §4 | CONFIRMED + DEC-06 | 10 | I, M |
| REQ-ONB-04 | Affirmative, versioned consents (version, timestamp, locale). Marketing consent is separate and optional | §1, §4 | CONFIRMED | 06, 10 | I |
| REQ-ONB-05 | Required gender, exactly `FEMALE` or `MALE`. No self-service change; corrections go through support | §1, A§0.1.4 | CONFIRMED | 06, 15 | U, I |
| REQ-ONB-06 | Home city/district chosen at signup, which starts the 30-day clock | A§8.4.1 | CONFIRMED | 06, 11 | I |
| REQ-ONB-07 | Avatar optional at registration | §1, §3 | CONFIRMED | 13 | E |

## 2. Identity and accounts

| ID | Requirement | Src | Label | Doc | Verify |
|---|---|---|---|---|---|
| REQ-ID-01 | Opaque, immutable public IDs. Internal IDs never authorize anything and never leave the server | §4, A§6 | CONFIRMED | 06, 07 | C (forbidden-field tests) |
| REQ-ID-02 | Normalized unique handles with Turkish-aware case folding (İ/ı) | §4 | CONFIRMED | 06 | U, I |
| REQ-ID-03 | Verified email and verified OIDC. Account linking is protected against takeover | §4 | CONFIRMED | 10 | I, S |
| REQ-ID-04 | Reset, refresh rotation with reuse detection, session/device list, sign out everywhere | §4 | CONFIRMED | 10, 07 | I, S |
| REQ-ID-05 | Gender is publicly visible on the profile | §4 | CONFIRMED | 07 | C |
| REQ-ID-06 | Graduated controls against underage use, impersonation and spam | §4 | CONFIRMED | 10 | S |
| REQ-ID-07 | Data export, account deletion, appeals | §9 | CONFIRMED | 07, 10, 15 | I, M |

## 3. Social graph

| ID | Requirement | Src | Label | Doc | Verify |
|---|---|---|---|---|---|
| REQ-SOC-01 | Directional, idempotent follow with no duplicate edges | §4 | CONFIRMED | 06 | I (concurrency) |
| REQ-SOC-02 | Anonymous follow notification: "Bir kişi seni takip etti" | §4 | CONFIRMED + DEC-16 (timing) | 09 | S |
| REQ-SOC-03 | Follower identities never exposed. Follower count is public. Owners see their own following list | §4 | CONFIRMED | 07 | C, S |
| REQ-SOC-04 | `Seni takip ediyor` label is shown. This is an accepted, documented leak and is rate-limited | §4, A§5.3 | CONFIRMED (tradeoff) | 10 | S, L |
| REQ-SOC-05 | Friendship = mutual follow. The friend list and count are visible only to the owner, enforced on the server | §4 | CONFIRMED | 07, 10 | C, S |
| REQ-SOC-06 | Mutual follow permanently reveals an existing anonymous thread. Users get a generic disclosure before following and a confirmation when it becomes mutual. Unfollowing does not re-hide | §4, §5 | CONFIRMED | 08, 10 | S, E |
| REQ-SOC-07 | One irreversible like per ordered pair. No unlike UI or API. Public count. Anonymized notification. Legal and moderation exceptions apply | §4 | CONFIRMED | 06, 09 | I, C |
| REQ-SOC-08 | Block: bilateral suppression across Shuffle, search, chat, follow, like and transfer; removes follow edges; no automatic restore after unblock; old messages become read-only | §4 | CONFIRMED + **DEC-02** (anonymous-origin block oracle) | 06, 10 | I, S |
| REQ-SOC-09 | All social actions are safe under concurrency | §4 | CONFIRMED | 06 | I |
| REQ-SOC-10 | Exact/prefix username search, normalized and throttled. Respects blocks. No enumeration and no correlation with anonymous chats | §8 | CONFIRMED | 07, 10 | S, L |

## 4. Anonymity boundary (cross-cutting)

| ID | Requirement | Src | Label | Doc | Verify |
|---|---|---|---|---|---|
| REQ-ANON-01 | Before an authorized reveal, the recipient cannot learn the initiator's identity through any channel: profile actions, API, search, mutual state, push, transfers, media, analytics, admin exports or errors | §4 | CONFIRMED | 10, 07, 08, 09 | S (differential suite), C |
| REQ-ANON-02 | Formal conversation state diagram and adversarial tests exist before any code | §5 | CONFIRMED | 08 | Gate at M1 |
| REQ-ANON-03 | No `Mesaja Git` oracle on the recipient's side | §5, §13 | CONFIRMED | 08 | S, E |
| REQ-ANON-04 | Anonymous starts in both directions resolve safely | §5, §15 | CONFIRMED + **DEC-01** | 08 | P, S |
| REQ-ANON-05 | The anonymous sender can be blocked or reported via the conversation ID alone | §5, §11 | CONFIRMED | 07, 10 | S |
| REQ-ANON-06 | Presence and connection status cannot leak identity | §5 | CONFIRMED + DEC-14 | 08 | S |
| REQ-ANON-07 | Support roles never see the identity. Investigation access is break-glass and logged | §10 | CONFIRMED | 15 | S, M |

## 5. Messaging

| ID | Requirement | Src | Label | Doc | Verify |
|---|---|---|---|---|---|
| REQ-MSG-01 | A starts a chat from B's profile and B sees "Anonim Kullanıcı". `Profilimi Göster` reveals A irreversibly | §5 | CONFIRMED | 08 | E, S |
| REQ-MSG-02 | Mesaj İstekleri: accept, reject, block or report | §5 | CONFIRMED | 08 | E |
| REQ-MSG-03 | No cap on messages before acceptance. Safety rate limits and spam detection still apply | §5 | CONFIRMED | 08, 10 | L, S |
| REQ-MSG-04 | Text chat is free, with no Plus or Gold gate | §1, §5 | CONFIRMED | 08 | C |
| REQ-MSG-05 | Defined behavior for reject, accept, block, deletion and multi-device races | §5 | CONFIRMED + DEC-15, DEC-17 | 08 | P, I |
| REQ-MSG-06 | Archive, mute, unread, request filter, and search that cannot leak identity | §5 | CONFIRMED | 08, 07 | S, E |
| REQ-MSG-07 | Client idempotency key. Durable commit and per-conversation sequence before ACK | §5 | CONFIRMED | 08 | I, failure-injection |
| REQ-MSG-08 | sending→sent→delivered→read, with monotonic watermarks and multi-device reconciliation | §5 | CONFIRMED | 08 | P, I |
| REQ-MSG-09 | Resume sync, offline queue, backoff, pagination | §5 | CONFIRMED | 08, 13 | E (network chaos) |
| REQ-MSG-10 | Typing indicator with TTL and heartbeat, stops on blur, in-app only, never pushed | §5, §8 | CONFIRMED | 08 | I |
| REQ-MSG-11 | Read receipts visible to both parties | §5 | CONFIRMED | 08 | E |
| REQ-MSG-12 | Message edit/delete only if approved | §5 | DEC-11 | 08 | — |
| REQ-MSG-13 | Provider acceptance of a push ≠ delivery | §5 | CONFIRMED | 08, 09 | I |
| REQ-MSG-14 | Measured p50/p95/p99 SLOs | §5, §12 | CONFIRMED | 17 | L |
| REQ-MSG-15 | Retention: 12 months for text, 90 days for media. Legal holds. Idempotent, audited retention job. Expiry shown in the client | §5 | CONFIRMED | 06, 08 | I |
| REQ-MSG-16 | Encrypted in transit and at rest. No E2EE claim | §5 | CONFIRMED | 10 | S |

## 6. Chat media and unlock

| ID | Requirement | Src | Label | Doc | Verify |
|---|---|---|---|---|---|
| REQ-MED-01 | Every chat photo (persistent or one-view) stays locked for the recipient until Gold is paid. There is no free route | §6 | CONFIRMED | 12, 08 | I, S |
| REQ-MED-02 | Senders view their own photo free. Public profile photos are free | §6 | CONFIRMED | 12 | C |
| REQ-MED-03 | Cost shown before unlock. A persistent unlock is a durable entitlement and is never charged twice | §6 | CONFIRMED | 12 | I |
| REQ-MED-04 | One-view: single consumption controlled by the server, with grace after a failed render and no replay | §6, §13 | CONFIRMED | 08, 12 | I, S |
| REQ-MED-05 | Placeholders reveal nothing about the photo, and nothing claims to know its content | §6 | CONFIRMED | 14 | M, S |
| REQ-MED-06 | Media can be reported without paying Gold | §6 | CONFIRMED | 07 | E |
| REQ-MED-07 | Short-lived URLs, private objects, malware/abuse scanning, metadata stripping, encryption | §6 | CONFIRMED | 10, 16 | S |
| REQ-MED-08 | Screenshot prevention is best effort only | §6 | CONFIRMED | 13 | M |
| REQ-MED-09 | Where unlock Gold goes (sink or sender) | gap | **DEC-03** | 12 | — |
| REQ-MED-10 | Persistent unlock vs 90-day media retention | §5/§6 conflict | **DEC-05** | 12 | — |

## 7. Avatar editor

| ID | Requirement | Src | Label | Doc | Verify |
|---|---|---|---|---|---|
| REQ-AVA-01 | Camera and library with permissions. 1:1 crop with pinch, pan, grid, reset, preview and confirm | §3 | CONFIRMED | 13, 14 | E, A |
| REQ-AVA-02 | Progress, retry, cancel, resumable upload, weak-network handling | §3 | CONFIRMED | 13 | E |
| REQ-AVA-03 | EXIF orientation, color handling, HEIC/JPEG/PNG policy, server re-encode, thumbnails | §3 | CONFIRMED | 13, 16 | U (golden images) |
| REQ-AVA-04 | Store the square source and render it as a circle. Keep the original until the new one succeeds. No blur | §3 | CONFIRMED | 13 | U |
| REQ-AVA-05 | Moderation, removal, replacement | §3 | CONFIRMED | 15 | I |

## 8. Gold wallet

| ID | Requirement | Src | Label | Doc | Verify |
|---|---|---|---|---|---|
| REQ-GLD-01 | Gold comes from IAP, admin gifts, promos, subscription bonuses and transfers. One available balance. Append-only ledger with provenance | §7, A§8.7 | CONFIRMED | 12, 06 | I, P (conservation) |
| REQ-GLD-02 | All Gold can be spent and transferred, subject to antifraud holds. No locks based on source | §7, A T55 | CONFIRMED | 12 | I |
| REQ-GLD-03 | No cash redemption | §7 | CONFIRMED | 12 | M |
| REQ-GLD-04 | Receipts verified on the server. Refunds, chargebacks, replays and duplicates handled. Each purchase credited exactly once | §7 | CONFIRMED | 12 | I (sandbox) |
| REQ-GLD-05 | Exactly 1 Gold per confirmed chat transfer. Atomic, balanced, idempotent. No bulk transfers | §7, §13 | CONFIRMED | 12 | I, P, S |
| REQ-GLD-06 | Either participant may transfer, with no Plus required. Blocked or suspended accounts cannot | §7 | CONFIRMED | 12 | I |
| REQ-GLD-07 | Available balance never goes negative. No confiscation of unrelated funds. Holds and debt are audited | §7, A§8.7 | CONFIRMED | 12 | P, I |
| REQ-GLD-08 | Transfer history in an anonymous thread hides the sender | §7 | CONFIRMED | 12, 10 | S |
| REQ-GLD-09 | Fail closed when an antifraud or coordination dependency is down | §11 | CONFIRMED | 12, 17 | failure-injection |
| REQ-GLD-10 | Store and legal position on transferable purchased Gold | §11, §15 | GATE + **DEC-08** | 20 | M |
| REQ-GLD-11 | Gold expiry policy | A§8.7 | DEC-09 | 12 | M |

## 9. Plus subscription

| ID | Requirement | Src | Label | Doc | Verify |
|---|---|---|---|---|---|
| REQ-PLS-01 | Monthly and yearly plans with an entitlement verified on the server | §7 | CONFIRMED | 12 | I (sandbox) |
| REQ-PLS-02 | Benefits: styling, post-selection rank, district/city browsing, gender filter, CITY Boost, bonuses | §7, A§0.1 | CONFIRMED | 11, 12 | C, P |
| REQ-PLS-03 | Paywall states the real benefits, including rank. No verification claim | §7, A§8.8 | CONFIRMED | 14 | M |
| REQ-PLS-04 | Renewal, grace, cancel, refund, billing retry and downgrade semantics are explicit | §7 | CONFIRMED | 12 | I |
| REQ-PLS-05 | On expiry, the filter resets to ALL and the view to the home district, immediately | A§7.2, §8.2 | CONFIRMED | 11, 13 | I, E |

## 10. Boost and home region

| ID | Requirement | Src | Label | Doc | Verify |
|---|---|---|---|---|---|
| REQ-BST-01 | Activated with wallet Gold only. No store payment at activation | §7, A§0.1.11 | CONFIRMED | 12 | C, I |
| REQ-BST-02 | Standard: home DISTRICT. Plus: home DISTRICT or home CITY | A§1 | CONFIRMED | 12 | I |
| REQ-BST-03 | At most one active Boost (enforced in the DB). No queue, schedule, stacking or extension | A§8.8 | CONFIRMED | 06, 12 | I |
| REQ-BST-04 | Versioned quote. Idempotent, atomic debit + ledger + entitlement | A§8.4.5, §8.7 | CONFIRMED | 12 | I, failure-injection |
| REQ-BST-05 | Target geography is immutable, including for support | A§0.1.12 | CONFIRMED | 12, 15 | I |
| REQ-BST-06 | Valid while `starts_at ≤ now < ends_at`, without depending on a job | A§8.8 | CONFIRMED | 11, 12 | I (boundary) |
| REQ-BST-07 | No pause. Outage compensation follows the defined trigger and formula | A§8.8 | CONFIRMED | 12, 15, 17 | I, U |
| REQ-BST-08 | The same neutral disclosure appears everywhere. No sparse flag and no audience size | A§8.8 | CONFIRMED | 12, 14 | C, M |
| REQ-BST-09 | A city Boost outlives Plus expiry and shows Standard styling | A§1, §8.4.6 | CONFIRMED | 11 | P, I |
| REQ-REG-01 | Home change allowed only after 30×24h UTC since the last change and with no active Boost. One canonical timestamp. Choosing the same region is a no-op | A§8.4 | CONFIRMED | 06, 11 | I (T33–T35) |
| REQ-REG-02 | Typed errors `HOME_REGION_CHANGE_TOO_SOON` and `HOME_REGION_LOCKED_BY_ACTIVE_BOOST` | A§8.4.4 | CONFIRMED | 07 | C |
| REQ-REG-03 | Region change and Boost activation are serialized per account | A§8.2 | CONFIRMED | 06, 12 | I (T36, T95) |

## 11. Shuffle (detail in doc 11)

| ID | Requirement | Src | Label | Doc | Verify |
|---|---|---|---|---|---|
| REQ-SHF-01 | A single column of compact cards. The whole card opens the profile. No social actions on the card | A§0.1.1 | CONFIRMED | 13, 14 | E, golden |
| REQ-SHF-02 | Eligibility predicates LOCAL, REMOTE, CITY_ALL, PRIORITY_* | A§1 | CONFIRMED | 11 | P |
| REQ-SHF-03 | Batch size N is set on the server only, from {10,15,20,25,35,50}, default 10. N is also the sparse threshold. Client overrides are rejected | A§2, T84/87 | CONFIRMED | 11, 07 | C |
| REQ-SHF-04 | Half-up quotas. Priority 500..4000 bps, local 5000..9000 bps, remote derived | A§2, §8.5 | CONFIRMED | 11, 15 | U |
| REQ-SHF-05 | SPARSE_COMPLETE only when `A_total<N` is proven: everyone is shown, ordered Boost→Plus→Standard | A§3.1.1 | CONFIRMED | 11 | P |
| REQ-SHF-06 | NORMAL: capacity proof, seats fixed first, §3.3 allocator, two uniform stages | A§3.2–3.4 | CONFIRMED | 11 | P |
| REQ-SHF-07 | BOOST_NON_HARM holds. The exact enumerator is a release gate | A§3.5, §9.1 | CONFIRMED + GATE | 11, 18 | P (passing in the pre-architecture spike, doc 11 §8) |
| REQ-SHF-08 | Order BOOST_BLOCK→DISCOVERY_PLUS→DISCOVERY_STANDARD, using the server's `presentation_rank` | A§3.7 | CONFIRMED | 11, 13 | P, golden |
| REQ-SHF-09 | Promoted badge only where the placement is BOOST_BLOCK, and kept in SPARSE mode | A§0.1.10, §8.8 | CONFIRMED | 11, 14 | C, golden |
| REQ-SHF-10 | No viewer history, seen-sets, caches or ID cursors, on server or client | A§0.1.9, §4 | CONFIRMED | 11, 13 | S, review |
| REQ-SHF-11 | `completion` is one of FULL, EXHAUSTED or UNCERTAIN, and is never mislabeled | A§4 | CONFIRMED | 11, 13 | P, E |
| REQ-SHF-12 | Per-request work is bounded. No `ORDER BY random()` | A§5.2 | CONFIRMED | 11 | L |
| REQ-SHF-13 | Warm p95 ≤ 250 ms under a defined profile, measured | A§5.2 | target + GATE | 17 | L |
| REQ-SHF-14 | Abuse budgets without history, with a secure fallback when Redis is down | A§5.3 | CONFIRMED | 10, 11 | S, failure-injection |
| REQ-SHF-15 | Aggregate metrics only: no viewer IDs, low-cohort suppression, `selection_mode` dimension | A§5.3, §8.8 | CONFIRMED | 15 | S |
| REQ-SHF-16 | Admin config is versioned, audited, simulated, staged and bounds-checked on rollback | A§8.3, §8.5 | CONFIRMED | 15 | I, T38 |
| REQ-SHF-17 | Reference sampler plus production sampler, with divergence measured | A§5.1 | CONFIRMED | 11 | P, statistical |

## 12. Notifications, home, search

| ID | Requirement | Src | Label | Doc | Verify |
|---|---|---|---|---|---|
| REQ-NTF-01 | In-app and push notifications for every listed event class | §8 | CONFIRMED | 09 | E (background/terminated) |
| REQ-NTF-02 | No push for typing | §8 | CONFIRMED | 09 | C |
| REQ-NTF-03 | Permission education, token lifecycle, preferences, quiet hours, locale, dedupe, retries, authorized deep links | §8 | CONFIRMED | 09 | I, E |
| REQ-NTF-04 | Lock-screen copy never reveals identity, photo, counterpart or sensitive text | §8 | CONFIRMED | 09, 10 | S |
| REQ-NTF-05 | No delivery guarantee, plus diagnostics | §8 | CONFIRMED | 09 | — |
| REQ-HOM-01 | Banner carousel: scheduling, placement, locale assets, allowlisted links, frequency caps, sponsored label. No overlays in chat | §8 | CONFIRMED | 15, 13 | E |

## 13. Admin, security, compliance, operations

| ID | Requirement | Src | Label | Doc | Verify |
|---|---|---|---|---|---|
| REQ-ADM-01 | RBAC, MFA, SSO, scoped support, immutable audit, approvals, rollback | §10 | CONFIRMED | 15 | S, E |
| REQ-ADM-02 | Full module list (§10) | §10 | CONFIRMED | 15 | E |
| REQ-ADM-03 | No direct balance edits. Only balanced, approved ledger adjustments | §10, A§8.7 | CONFIRMED | 12, 15 | S, I |
| REQ-ADM-04 | Protected exports, PII redaction, staff-access anomaly monitoring | §10 | CONFIRMED | 15 | S |
| REQ-SEC-01 | Threat model covering every listed vector | §11 | CONFIRMED | 10 | Review gate |
| REQ-SEC-02 | Counters allowed. Shuffle caches and seen lists forbidden | §11 | CONFIRMED | 10, 11 | review |
| REQ-SEC-03 | Least privilege, rotation, encryption, secure storage, SCA/SAST/DAST, IR, restore drills | §11 | CONFIRMED | 10, 16 | CI, DR drill |
| REQ-CMP-01 | Apple/Google policy review: anonymous chat, UGC, billing | §11 | GATE + DEC-21 | 20 | M |
| REQ-CMP-02 | KVKK, Law 5651, consumer law, age assurance, Law 6493 (e-money) | §11 | GATE + DEC-07, DEC-08 | 10, 20 | M |
| REQ-CMP-03 | Published Terms, Privacy, Community Rules, refund and retention policies | §11 | GATE | 19 | M |
| REQ-OPS-01 | Capacity model with separate SLOs | §12 | CONFIRMED + DEC-10 | 17 | L |
| REQ-OPS-02 | Outbox, dedupe, poison handling, graceful Redis outage, replay, migrations, observability, runbooks | §12 | CONFIRMED | 05, 16 | failure-injection |
| REQ-OPS-03 | RPO/RTO, multi-AZ, rolling deploys, cost | §12 | CONFIRMED | 16, 17 | DR drill |
| REQ-OPS-04 | Never promise zero downtime or 100% delivery | §12 | CONFIRMED | all | copy review |

## 14. Appendix A test-case mapping

All of SHF-T01…T101 are release gates (master §13). Suites are defined in doc 18.

| Cases | Suite |
|---|---|
| T01–T04, T43, T84, T87, T88 | `shuffle.contract` (authorization, schema) |
| T05–T15, T39–T41, T46–T48, T61, T63–T77, T85–T86, T89–T93 | `shuffle-core` (TS) + `shuffle-reference` (independent Python enumerator) |
| T16–T19, T29–T30, T44, T79 | Mobile list behavior + golden snapshots |
| T20, T27, T32, T42, T45, T78 | Privacy/adversarial |
| T21–T23, T33–T37, T49–T60, T62, T81, T83, T94–T97, T99 | Entitlement/wallet integration on real Postgres with concurrency |
| T24–T25, T28 | Statistical fairness + load (1M+ fixtures, skewed geography) |
| T26, T38, T80, T98, T100, T101 | Admin config, outage compensation, copy, analytics |

## 15. Contradictions and gaps found during analysis

| # | Finding | Proposed resolution | Ref |
|---|---|---|---|
| C-1 | A persistent unlock is "durable" (§6), but media is kept only 90 days (§5) | The entitlement lasts as long as the media. The expiry date is shown before unlocking | DEC-05 |
| C-2 | "One canonical conversation preferred" conflicts with the oracle-free rule when both sides start anonymously | Directional threads while either side is anonymous; consolidate once both are identified (doc 08 §3) | DEC-01 |
| C-3 | A bilateral block with edge removal from an anonymous thread reveals the initiator by elimination (search, Shuffle, the recipient's following list, follower count) | Anonymous-scoped "shield" block (doc 10 §3) | DEC-02 |
| C-4 | The spec does not say where unlock Gold goes | Platform sink | DEC-03 |
| C-5 | Appendix A names Expo, FlashList, Next.js and PostgreSQL GiST | Treated as examples (master §0.4) and chosen on merit in the ADRs | 03, 04 |
| C-6 | "Connection status vs last seen" is mentioned but no presence feature is specified | No public presence | DEC-14 |
| C-7 | What the sender sees after a rejection is undefined | Doc 08 §3.4 | DEC-17 |
| C-8 | Master §2 deliverable names differ from this doc set | Mapping table above | — |
| C-9 | Gold expiry is deferred to a "wallet spec" that doesn't exist | Purchased Gold never expires (Apple 3.1.1 requires this) | DEC-09 |
| C-10 | Uniform sampling, yet the eligible set is viewer-specific (blocks) | Rejection sampling over dense directories plus bounded exhaustion proof (doc 11 §4) | — |
| C-11 | Apple Guideline 1.2 says "random or anonymous chat" apps "do not belong on the App Store" | Position the app as a moderated social network with identity-bearing profiles and a recipient who is always identified (doc 20 RISK-01) | DEC-21 |
| C-12 | A§3.5 uses "B<q" and "B≥q" inconsistently at the B=q boundary | At B=q every Boost holder is chosen (p=1). Implementation follows the formula, which is continuous at B=q, so this is editorial only | doc 11 §8 |
| C-13 | A§3.2 does not give the formula for shortfall transfer | `n_L=min(n_L0,A_L)`, `n_R=N−n_L` (and the mirror case). Both-short is impossible when A_total≥N | doc 11 §3 |
