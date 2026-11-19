# 00 — Executive Summary (FLERO Architecture Proposal)

**Date:** 2026-11-14 · **Status:** APPROVED by the owner on 2026-11-14 (§6b). No application code has been written yet; the next milestone is M1. **Source of truth:** `FLERO_MASTER_SPEC.md` v1.0 + Appendix A (Shuffle V5.2 LOCKED).

## 1. Product comprehension (one paragraph)
FLERO is a Turkish-first iOS and Android social discovery and messaging network:
- **Discovery:** a single-column list of compact profile cards (Shuffle) with locked, mathematically specified selection rules.
- **Messaging:** free text chat in which the *initiator* can stay anonymous until they reveal themselves or the pair becomes mutual followers.
- **Social graph:** one-way follows, owner-only friend lists, and irreversible likes.
- **Gold economy:** in-app currency used for photo unlocks, 1-Gold gifts and Boost visibility.
- **Plus:** a subscription for wider discovery, a gender filter and a post-selection rank advantage.
- **Admin:** a premium console.

The hardest parts are correctness and privacy, not raw scale: the anonymity boundary, financial atomicity, and the Shuffle invariants.

## 2. Recommended stack (doc 03)
| Layer | Choice | Primary reason |
|---|---|---|
| Mobile | React Native (New Arch) + Expo, Reanimated, Skia, FlashList v2 | one TypeScript stack, shared generated contracts, UI-thread motion; Flutter is the fallback if the M1 frame-time gate fails |
| Backend | TypeScript / Fastify **modular monolith**, 4 deployables (api, realtime, worker, admin-api) | ACID across tightly coupled domains, small-team velocity, no premature microservices |
| API | REST + OpenAPI 3.1 generated from Zod; AsyncAPI for realtime | spec-mandated contract, forbidden-field testing |
| Database | PostgreSQL 17 (RDS Multi-AZ) | exclusion constraints (one active Boost), serializable/locking ledger, partitioned retention |
| Realtime | own thin WebSocket gateway + Valkey pub/sub; Postgres is the record | small, server-redacted protocol; Centrifugo as plan B |
| Jobs | transactional outbox + Graphile Worker | no dual writes; no extra broker |
| Media | S3 private + CloudFront (public avatars only); sharp processing; pre-delivery safety scan | locked media never on the CDN |
| Push | direct APNs + FCM | no third party sees metadata |
| Auth | in-house on audited primitives (argon2id, OIDC via jose, rotating refresh with reuse detection); staff via SSO + WebAuthn | control of linking and anonymity coupling; cost |
| Billing | direct StoreKit 2 / Play Billing + server verification; ledger-authoritative | exactly-once credit; RevenueCat optional (DEC-23) |
| Admin | Next.js + Radix/shadcn + TanStack Table, behind an identity-aware proxy | shared tokens and clients; isolated plane |
| Infra | AWS Frankfurt, ECS Fargate, OpenTofu, GitHub Actions, EAS | managed stateful services, no Kubernetes initially |
| Observability | OpenTelemetry → Grafana Cloud (EU), Sentry, PostHog (restricted) | vendor-neutral, PII-scrubbed |

## 3. Architecture in one picture
Mobile and admin clients reach **CloudFront/WAF**, then the **api / realtime / admin-api** services on Fargate, backed by **PostgreSQL** (all authoritative state), **Valkey** (ephemeral only) and **S3**. Workers drain the **outbox** to APNs/FCM, media processing and maintenance. Trust boundaries and flows are in doc 05.

**Key design moves:**
1. **Counterparty projection** (ADR-016) is the single anonymity resolver.
2. **Directional anonymous threads** keep profiles oracle-free (DEC-01).
3. **Double-entry Gold ledger** with DB-enforced non-negative balances.
4. **Boost activation** is one transaction across account, wallet, ledger and entitlement, with a GiST exclusion constraint as backstop.
5. **Shuffle dense-slot directories** in Postgres, maintained transactionally. They give exactly uniform rejection sampling and a capacity proof without unbounded COUNT, and are independent of Redis.

## 4. Verified so far (evidence, not claims)
- **Shuffle math spike:** an independent exact-enumeration checker, written by a separate agent and re-run by the lead (exit 0, 21.9 s). Results:
  - **BOOST_NON_HARM:** 0 violations across 478,872 own-boost toggles (A_L, A_R ≤ 8, N = 2..10, ratio boundaries).
  - Allocator determinism, and the dual-surplus branch is unreachable (179k cases).
  - SPARSE/NORMAL boundaries hold.
  - Paid seats never exceed Q (9.2M cases).
  - See `evidence/` and doc 11 §8.
- **Not verified yet:** larger domains, the production sampler's statistical fairness, all load, latency, frame-rate and cost figures, and every legal interpretation. All of these are release gates (doc 18).

## 5. Capacity and cost (doc 17, 16)
- **Base case at 1M registered:** 150k DAU, 15k peak concurrent users, 1.4k API rps peak, ~210 msg/s peak, ~105 Shuffle rps peak. Design targets: 5k rps, 60k sockets, 1.5k msg/s.
- **Estimated infra:** $900–1.8k/month at launch; $5–9k/month at the 1M base case, plus vendors. List-price estimates, not quotes.
- **Proposed SLOs:** messaging commit 99.95 % with p95 ≤ 150 ms; Shuffle p95 ≤ 250 ms warm; wallet correctness with zero tolerance.

## 6. Top risks (doc 20)
1. **RISK-01:** Apple Guideline 1.2 treats "random or anonymous chat" apps as unwelcome. This is the single biggest launch risk.
2. **RISK-03:** the CONFIRMED block semantics create an identity oracle (DEC-02).
3. **RISK-02:** the store/legal status of transferable IAP Gold (DEC-08).
4. **RISK-05 / RISK-16:** CSAM in locked photos, and age assurance.
5. **RISK-06:** chargeback laundering.

## 6a. Independent review (doc 21)
An Opus architect agent with fresh context returned **APPROVE-WITH-FIXES**: 3 critical, 5 high, 8 medium and 6 low findings.
- **Critical:** the identity mapping could be rebuilt from secondary tables; a shield block broke identified threads (an oracle); pair-keyed gift limits (an oracle).
- **High:** a Shuffle UNCERTAIN fallback that could violate non-harm; directory-exactness gaps; a race between Plus revocation and CITY Boost activation; one-view consumption semantics; unlock idempotency order.

All were applied in this revision, and the one-view case became DEC-25. Re-review of the fixes is task M1.8. The tightest capacity margin is now message commit throughput (~600–1,000 msg/s estimated on one primary), which is to be benchmarked in M3.

## 6b. Approval record
**2026-11-14 — owner approved** the proposed architecture and the recommended resolutions of the 8 blocking decisions: **DEC-01, DEC-02 (incl. 02b), DEC-03, DEC-06, DEC-07, DEC-12, DEC-14, DEC-17**, as written in the table below. The owner's words in chat: "Approve all 8". ADRs 001–018 move from PROPOSED to ACCEPTED. The non-blocking decisions (DEC-04, 05, 08–11, 13, 15, 16, 18–25) remain **open** and are due by the milestone shown. Until they're decided, the conservative defaults stated in each doc apply. The decision log is `.project-memory/DECISIONS.md`.

## 7. Decisions requiring owner approval
**Blocking before M1 (they shape schemas or flows) — ✅ APPROVED 2026-11-14 as recommended:**
| ID | Decision | Recommendation |
|---|---|---|
| DEC-01 | Opposite-direction anonymous starts: one canonical thread would expose the initiator | **Directional threads** (≤ 1 per ordered pair), consolidated once both identities are known (doc 08 §3) |
| DEC-02 | Blocking from an anonymous thread: CONFIRMED bilateral suppression + edge removal reveals the initiator by elimination | **Shield block**: the anonymous thread closes and the initiator can't contact the recipient anonymously again; identified threads and the recipient-visible graph are unchanged until reveal (doc 10 §3.1). Plus DEC-02b: profile-block of a hidden-thread counterpart closes that thread with a delayed generic ending |
| DEC-03 | Destination of photo-unlock Gold | **Platform sink** (avoids a pay-to-view creator economy, CSAM incentives and P2P value-transfer risk) |
| DEC-06 | Age assurance process/vendor | Layered: DOB-derived 18+ (DOB discarded) + platform age signals + risk-based vendor check |
| DEC-07 | Hosting region / data residency | AWS Frankfurt with KVKK standard contracts (+ notification), Turkish-cloud migration path kept open |
| DEC-12 | Attributes of an anonymous sender visible to the recipient | **None** (no gender/age/district) |
| DEC-14 | User-visible presence | **None** in v1 (receipts and in-thread typing only) |
| DEC-17 | Sender experience after rejection | Composer disabled, generic copy; 30-day cooldown on a new thread to the same recipient |

**Needed before the relevant milestone:**
| ID | Decision | Recommendation | By |
|---|---|---|---|
| DEC-04 | Prices: Gold packs, unlock prices (persistent / one-view), Boost packages, Plus prices, subscription bonus Gold | owner business input | M4 |
| DEC-05 | Persistent unlock vs 90-day media retention | entitlement lasts as long as the media; expiry shown before unlock | M4 |
| DEC-08 | Legal/store position on transferable Gold (Apple 3.1.1, Google, Law 6493) | counsel review now; keep the feature | M4 |
| DEC-09 | Gold expiry | purchased Gold never expires; promo Gold may expire with disclosure | M4 |
| DEC-10 | SLOs and operating budget | approve doc 17 §4 and doc 16 §8 envelopes | M2 |
| DEC-11 | Message edit/delete | out of v1 (local "delete for me" only) | M3 |
| DEC-13 | Media-safety / CSAM vendor and moderation staffing | choose a hash-matching vendor + classifier; 24/7 coverage plan for CSAM | M3 |
| DEC-15 | How account deletion/ban of the other party appears in a thread | generic "Sohbet sona erdi" with a delay | M3 |
| DEC-16 | Jitter on anonymous follow/like notifications | 0–15 min jitter (default off without approval) | M3 |
| DEC-18 | Report outcome notices | generic, delayed | M3 |
| DEC-19 | KVKK export of conversations | counterpart shown as alias only | M7 |
| DEC-20 | One-view media server retention for moderation | retain for 90 days, disclosed | M4 |
| DEC-21 | App Store positioning strategy for RISK-01 | moderated social network framing; legal/store consultation pre-submission | M8 |
| DEC-22 | Optional "Öne Çıkan ⓘ" caption above promoted rows | approve as an optional disclosure | M6 |
| DEC-23 | Direct store integration vs RevenueCat | direct (ledger-authoritative) | M4 |
| DEC-24 | Reversing subscription bonus Gold on Plus refund | reverse via the debt model, disclosed | M5 |
| DEC-25 | One-view photo: delivered but never confirmed as rendered | one grace re-open within 10 min, then consumed (balances "no accidental consumption" against replay) | M4 |

## 8. Implementation phases (doc 19)
M0 approval → M1 design system + contracts + Shuffle reference (4 wks) → M2 foundation (5 wks) → M3 social/messaging/push (6 wks) ∥ M4 wallet/IAP/unlock (5 wks) → M5 Plus/Boost (4 wks) → M6 Shuffle production (4 wks) → M7 admin (5 wks, overlapping) → M8 hardening/load/security (5 wks) → M9 beta and staged launch (4 wks). That's roughly 8–9 months of calendar time for 4–6 engineers. This is an estimate.

## 9. Document index
01 Requirements traceability · 02 Agent capability matrix · 03 Technology evaluation · 04 ADRs · 05 System architecture · 06 Database · 07 API · 08 Realtime messaging · 09 Notifications · 10 Security & privacy · 11 Shuffle engine · 12 Gold/Plus/Boost · 13 Mobile · 14 UI/UX system · 15 Admin · 16 Infra/DevOps · 17 Scalability & SLOs · 18 Testing & gates · 19 Roadmap · 20 Risk register · 21 Independent review · `evidence/` Shuffle spike.
