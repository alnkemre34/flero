# 21 — Independent Architecture Review

**Reviewer:** `ecc:architect` agent (Opus), fresh context. It did not author docs 00–20 and edited nothing. **Date:** 2026-11-14.
**Scope read:** the master spec including Appendix A in full; docs 00, 05, 06, 08, 10, 11, 12, 15 and 17 in full or in the relevant sections; the others by search.
**Verdict:** **APPROVE-WITH-FIXES.** C1, C2, H1–H3 and H5 had to be fixed before the M1 schema freeze, and H4 needed an owner decision.
**Lead's disposition:** every finding below was applied to the docs in this revision, except H4, which became DEC-25. The fixes were **not** re-reviewed by a second independent pass. That re-review is the first M1 task (M1.8).

## Findings and resolutions

| # | Sev | Finding (summary) | Resolution | Where |
|---|---|---|---|---|
| C1 | Critical | Column grants protect only `conversation.initiator_id`. The anonymity mapping can be rebuilt from participant, message.sender_id, sync feed, gift postings, media ownership and notifications, and `admin_ro` read everything | Restricted `ident` schema for all counterpart-bearing data; admin reads alias-keyed views only; CI test that `admin_ro` can't join conversation → account | 06 §1, 15 §1, 10 O23 |
| C2a | Critical | Shield block barred A "in any thread", so a break in an *identified* thread with X confirmed X = A | Shield scoped to anonymous threads; identified threads unaffected | 10 §3.1, O21 |
| C2b | Critical | Pair-keyed gift velocity shared across threads (oracle; contradicted O11) | All per-pair counters keyed by `(conversation, direction)` | 12 §2, 10 O22 |
| H1 | High | UNCERTAIN fallback "drops excess priority draws", which can exclude a boosted target its unboosted twin would keep (non-harm violation); k became a moving target | Excess is **demoted to unlabeled DISCOVERY**, never dropped; k fixed first; enumerator must cover the fallback before M6 exit | 11 §3.7, 18 §2 |
| H2 | High | The capacity proof assumes an exact directory, but maintenance events were incomplete (Plus refund/hold/grace, deletion, age revocation, Boost revocation recompute), there was a cleanup/renewal race, no reconciliation, and "short ⇒ small" was unsound | Single `discovery_resync()` writer called from an exhaustive event list; cleanup locks and rechecks; nightly diff job (drift = SEV-2 → enumerate-or-UNCERTAIN); enumeration only when `U_s ≤ E_ENUM` | 11 §2, §3.3 |
| H3 | High | Plus revocation webhook didn't lock the account, so it raced CITY Boost activation | Plus mutations lock the account first (global order) | 12 §3.2 |
| H4 | High | Doc 08 consumed one-view media on full byte delivery without a render ack, which silently weakened master §6 | Bounded grace re-open (one within 10 min), raised as **DEC-25** | 08 §8, 00 §7 |
| H5 | High | Unlock checked the balance before the existing-unlock check, so a user who already owned the photo could hit a paywall | Existing unlock checked first, no charge | 12 §4 |
| M1 | Medium | Boost idempotency was checked before the lock; a concurrent same-key request returned the wrong error | Re-check after the account lock | 12 §5.3 |
| M2 | Medium | Global lock order was incomplete (pools, sync state, quotes, Plus) | Complete order with pools last by `pool_id` | 05 §4 |
| M3 | Medium | Chargeback postings were unbalanced and HELD was ignored | Exact balanced postings, HELD-first, repayment entries | 12 §3.3 |
| M4 | Medium | Write cost understated (~8–10 writes/msg); `conversation_change` row explosion; unclear sync bump semantics; trailing-event loss | Upsert-keyed change table; every visible change bumps the version; `pong` carries `sync_version`; capacity re-estimated at 600–1,000 msg/s, to measure at M8 (below the 1,500 design target, above the 720 high peak) | 06 §4, 08 §4/§6, 17 §5 |
| M5 | Medium | `created_at` partitioning hurt pruning, and retention could overshoot to about 13 months | Daily row-age deletes plus partition drop when empty; conversation-level time bounds for pruning | 06 §4 |
| M6 | Medium | Unique-thread index included terminal states, so a pair could never restart (contradicted the DEC-17 cooldown) | Index limited to REQUEST/ACTIVE; restart and cooldown rules added to the CTA | 06 §4, 08 §3.2 |
| M7 | Medium | Contradictions: Shuffle under Valkey outage; replica vs primary; Multi-AZ instance has no readable standby; doc 21 missing | One canonical rule (10 §6) referenced everywhere; Multi-AZ DB cluster chosen at scale; this doc | 05, 10, 11, 16, 17 |
| M8 | Medium | The post-check skipped entitlements (revoked Boost or refunded Plus mid-request) | Post-check covers Boost validity, Plus and REMOTE eligibility | 11 §3.7 |
| L1 | Low | Break-glass not scoped per conversation; approver ≠ requester not enforced; the IAM DB path bypassed audit | Conversation-scoped grant, DB-enforced separation, pgaudit + paging | 10 §7 |
| L2 | Low | Apple `appAccountToken` must be a UUID and be verified; presigned PUT can't cap size | UUIDv5-style token verified on credit; presigned POST policy with `content-length-range` | 12 §3.1, 07 §2 |
| L3 | Low | No WebSocket re-auth on JWT expiry | `reauth` frame, close 4002 | 08 §6 |
| L4 | Low | 60 Shuffle requests per 10 min could act as a discovery cap (A§5.3) | Raised to anomaly-level thresholds (~300 per 10 min) | 11 §6 |
| L5 | Low | With "credit sender" (DEC-03 alternative), the moderation refund would mint Gold | Claw-back rule documented | 12 §4 |
| L6 | Low | `ledger_posting` PK included the nullable lot | Surrogate PK; lot nullable | 06 §6 |

## What the reviewer confirmed holds
- Union-of-pools sampling is exactly uniform, including the ALL gender filter (gender-partitioned pools are disjoint), **provided pool sizes and slots come from the same snapshot**. That condition was added to 11 §3.1.
- The allocator matches A§3.3.
- The GiST exclusion with `[)` boundaries is correct for one active Boost and the exact-boundary restart.

## Lead orchestrator's own critical notes (beyond the reviewer)
1. **Message throughput is now the tightest capacity margin.** Commit writes per message limit one primary to roughly the high-peak case. Measure early: run a k6 commit benchmark in M3, not M8.
2. **Directory exactness is the linchpin of Shuffle correctness.** The nightly diff job plus property tests are mandatory before any SPARSE_COMPLETE claim reaches production.
3. **RISK-01 (Apple 1.2)** is a product-positioning risk that no architecture can remove. It should be explored with counsel and store contacts in parallel with M1, not at M8.
4. **Decisions DEC-01 and DEC-02 change the conversation schema.** They must be settled before M1.5/M1.6.

## Re-review (M1.8, 2026-11-14)
**Reviewer:** a second `ecc:architect` agent with fresh context. It read docs 05–17, migration 0001, `conversation-model`, `shuffle-core` and `contracts`. It edited nothing and ran no tests.
**Result:** 14 VERIFIED · 6 PARTIAL · 1 NOT FIXED · 5 new findings. **Verdict: APPROVE-WITH-FIXES.**

| Item | Re-review status | Resolution in this revision | Where |
|---|---|---|---|
| M3 chargeback postings | **NOT FIXED.** The postings summed to d, so the balance trigger would reject them | Receivable model: `USER_DEBT −d`; repayment `+r`; separate write-off; every leg sums to 0 | 12 §3.3 |
| C1 isolation | PARTIAL: (a) gift postings link the pair in `app`; (b) `follow.frozen` encodes shields; (c) `audit_event` can hold reveal/shield results; (d) the alias key could be set from the session | (a) Two-leg gifts via `SYS_GIFT_TRANSIT` plus `ident.gift_link`, and aggregate-only gift finance views. (b) Column dropped; frozen state derived from `ident.block`. (c) `ident.audit_event_sensitive`. (d) Key moved to `admin_secret`, HMAC inlined in the view with a side prefix. **Migration 0002 + tests** | 0002, 06, 12, 15 |
| M2 lock order | PARTIAL: social and media tables missing | Added | 05 §4 |
| M6 restart rule | PARTIAL: doc wording; CTA step 5 could offer a thread where P is anonymous | Wording fixed; step 5 limited to threads where V knows P | 08 §3.1–3.2 |
| M7 replica | PARTIAL: no replica at launch | `admin_ro` reads alias views on the primary at launch | 15 §1 |
| H1 fallback | VERIFIED with caveats | Cap is on the batch total, matching Q, with a server-side assertion. Priority-stage truncation is still unmodeled (open) | 11 §3.7 |
| H2 resync events | `moderation_hold` missing | Added | 11 §2 |
| New-1 (High) | Delayed closure (DEC-02b) unspecified and not modeled | Presented-state spec written. **Model and differential inbox test still open (M3.3)** | 10 §3.2 |
| New-2 (Med) | A FULL block over a shield erased it, so unblock reopened anonymous contact | `shield_retained` in DB and model, with DB and model tests | 0002, model |
| New-4 (Low) | Shield-upgrade and frozen-follow disclosures beyond O5 | Documented as accepted residuals (RISK-03) | 10 §3.2 |
| New-5 (Low) | Migration gaps: hashes, push_attempt, raw_jws_ref, like/message UPDATE grants, system-txn idempotency | Fixed in 0002 and tested. The "≥ 2 postings" rule is already implied: one non-zero posting can't sum to 0. Default privileges are deliberately not used, so every new table needs explicit grants | 0002 |

**Still open after this revision:**
- ~~the delayed-closure model and inbox differential test~~: done in the model (doc 10 §3.2); the backend replay remains for M3.3
- priority-stage truncation in the fallback model
- an isolation CI test for the future `admin_ops` role (with M7)

These fixes have not had a third independent pass. The next reviewer pass happens with the M2 security review.

## Residual open items
- A second independent review of the revised docs (M1.8).
- DEC-25 (one-view grace) and the other DEC items in doc 00 §7.
- All release gates in doc 18 remain unexecuted. Only the Shuffle math spike has evidence.
