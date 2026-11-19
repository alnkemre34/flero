# 11 — Shuffle Engine Design (implements Appendix A V5.2 LOCKED)

This document is an **implementation design**. Appendix A remains the sole normative product contract. Where this design replaces a technical example from Appendix A, §9 below argues that the replacement is equivalent or stronger. Nothing here changes a business rule.

## 1. Request resolution (server-only)
1. Authenticate the viewer V. Load the account row, current Plus status (`now < COALESCE(grace_until, valid_until)`), home city/district and state.
2. Validate the strict schema: `{mode, target_district_id?, gender}`. **Any** of `shuffle_batch_size | batch_size | page_size | N | sparse_threshold | priority_ratio` → `400 SHUFFLE_BATCH_SIZE_NOT_CLIENT_CONFIGURABLE` with no selection run (T84, T87). Other unknown keys → `400 VALIDATION_FAILED`.
3. Resolve the surface:
   - Standard: `mode` must be `DISTRICT`. `target_district_id` must be null, absent, or equal to the home district, otherwise `SHUFFLE_SURFACE_NOT_ALLOWED`. `gender` must be `ALL`, otherwise `SHUFFLE_FILTER_REQUIRES_PLUS`.
   - Plus: `DISTRICT` with a district inside the home city (default: home district) or `CITY` (district must be absent or null, otherwise `VALIDATION_FAILED`). Any gender. Another city → `SHUFFLE_SURFACE_NOT_ALLOWED`.
4. Pin `config = active discovery_config_version` (immutable for the request): `N`, `priority_bps`, `local_bps`, budgets.

## 2. Directory model (ADR-011, doc 06 §8)
Dense slot arrays are maintained **in the same transaction** as every membership change, so the directory is an exact, consistent mirror of authoritative state at any snapshot. There is one exception: time-based validity, which is checked at read.

| Pool kind | Key | Members | `valid_until` |
|---|---|---|---|
| MEMBER | (city, home district, gender) | all discoverable, ACTIVE, non-held accounts | NULL |
| REMOTE_ELIGIBLE | (city, home district, gender) | members with active Plus OR active city Boost | max(Plus grace/valid end, city Boost end) |
| BOOST_DISTRICT | (city, target district, gender) | active DISTRICT Boost holders | Boost `ends_at` |
| BOOST_CITY | (city, home district, gender) | active CITY Boost holders | Boost `ends_at` |

Surface sets as unions of disjoint pools. `g*` is `{g}`, or `{FEMALE, MALE}` for ALL:
```
District d:  LOCAL          = MEMBER(c,d,g*)
             REMOTE         = ⋃_{d'≠d} REMOTE_ELIGIBLE(c,d',g*)
             PRIORITY_LOCAL = BOOST_DISTRICT(c,d,g*) ∪ BOOST_CITY(c,d,g*)     (disjoint: ≤1 active Boost per owner)
             PRIORITY_REMOTE= ⋃_{d'≠d} BOOST_CITY(c,d',g*)
City:        CITY_ALL       = ⋃_d MEMBER(c,d,g*)
             PRIORITY_CITY  = ⋃_d BOOST_CITY(c,d,g*)                          (district Boosts never qualify, T69/T93)
```
These match A§1's predicates exactly: LOCAL ⊆ home district d. REMOTE = other districts ∧ (Plus ∨ city Boost). Priority sets are subsets of their stratum, because a Boost holder is also a member of their own home district's MEMBER pool, and a city-Boost holder is also in REMOTE_ELIGIBLE.

**Membership maintenance events** (each updates the relevant pools transactionally):
- signup/onboarding complete
- home region change
- hide/unhide
- suspend/ban/delete/restore
- Plus activation/renewal/expiry-cleanup
- Boost activation/revocation/expiry-cleanup
- gender correction (support)

Expiry cleanup is a worker job that removes rows whose `valid_until ≤ now()`. Correctness never depends on it (A§8.8), because reads reject expired rows.

**Directory exactness contract (review H2).** The capacity proof in §3.3 is sound only if the directory equals authoritative state. Three mechanisms enforce that:
1. **One maintenance function** `discovery_resync(account_id)` recomputes *all* of an account's pool memberships and `valid_until` values from authoritative tables inside the caller's transaction. It is the only writer of `pool_slot`, and every mutation path calls it. The complete list:
   - signup completion; home change; hide/unhide
   - suspend, ban, delete, KVKK erasure, restore, **`moderation_hold` set/clear** (re-review H2)
   - age-assurance revocation
   - Plus SUBSCRIBED, RENEWED, GRACE entry/exit, ON_HOLD, EXPIRED, REFUND, REVOKE
   - Boost activation and revocation (REMOTE_ELIGIBLE `valid_until` is recomputed as `max(plus_end, city_boost_end)`, not just deleted)
   - gender correction
2. **Cleanup safety.** The expiry worker locks `pool_size`, re-reads the row's current `valid_until` and removes it only if it is still expired. A renewal racing the cleanup therefore wins, and a later renewal re-inserts through `discovery_resync`.
3. **Nightly diff job.** It compares each pool against the authoritative predicate query. Any drift is SEV-2: the affected pools switch to enumerate-or-UNCERTAIN mode, with no sparse or exhausted claims, until repaired. Property tests cover random mutation sequences and assert directory = predicate.

## 3. Algorithm

### 3.1 Snapshot
Selection runs in a `REPEATABLE READ READ ONLY` transaction on the **primary** (doc 17 §5 lists offloading the draw phase to a readable standby only as a measured scale-out option; the post-check always stays on the primary). Pool sizes and slots must come from the **same** snapshot, or the union-of-pools weighting isn't uniform, which gives one consistent snapshot (A§5.1.1, T78). Time is evaluated once, as `t0 = now()` of that transaction.

### 3.2 Per-request eligibility predicate (final check)
`eligible(U)` := U ≠ V ∧ account ACTIVE ∧ discoverable ∧ ¬moderation_hold ∧ ¬block(V,U) ∧ ¬block(U,V) (both FULL and ANON_SHIELD in the direction that suppresses U from V, see doc 10 §3.1) ∧ the row's `valid_until IS NULL OR valid_until > t0`.
Viewer blocks are loaded once per request into an in-memory set. Its size is bounded: if it exceeds 10,000, the check switches to batched per-candidate DB lookups.

### 3.3 Capacity proof without unbounded COUNT (A§3.2, §5.1.1)
For any stratum `s` (a union of pools):
- `U_s = Σ pool_size` (O(#pools) point reads) is an **upper bound**: `A_s ≤ U_s`.
- `X_s = ` expired rows still present, a bounded index scan `WHERE valid_until ≤ t0 LIMIT K` (K = 512) on the stratum's pools. It's small because the cleanup worker keeps it small, and if it hits K the proof falls back to probing.
- `Bk_s = ` the number of the viewer's block counterparties that appear in the stratum's pools (bounded query by pool membership of the blocked set), plus 1 if V is in the stratum.
- **Lower bound:** `A_s ≥ U_s − X_s − Bk_s`. This is valid because the directory is transactionally exact, so every remaining row satisfies all the non-viewer-specific, non-time predicates, and these three terms are the only possible exclusions.

**Mode decision:**
```
A_total bounds: [Σ lower_s, Σ U_s]
if Σ U_s < N                          → enumerate all strata exactly (≤ N−1 rows) → A_total exact → SPARSE_COMPLETE
elif Σ lower_s ≥ N                    → NORMAL proven
elif Σ U_s ≤ E_ENUM (=2,000)          → enumerate exactly (bounded) → decide
else                                  → probe-sampling proof (bounded budget); success → NORMAL; else UNCERTAIN_PARTIAL
```
The completion flag needs one more distinction, between `A_total = N` (EXHAUSTED) and `A_total > N` (FULL), and it uses the same bounds. `Σ lower_s ≥ N+1` proves FULL. If the exact enumeration gives `A_total = N`, the result is NORMAL + EXHAUSTED (T70, T85). Otherwise the server enumerates (if `ΣU ≤ E_ENUM`) or probes for N+1 distinct eligible. If neither completes within budget, a proven-NORMAL full batch is returned as `FULL`/`has_more=true`. This is allowed, because `has_more` never promises new profiles (A§4). The only consequence is that client autoload may fetch repeats. `EXHAUSTED` is never claimed without proof.
**Stratum seat totals (NORMAL district):** `n_L0 = quota(N, local_bps)`, `n_R0 = N − n_L0`. If `lower_L ≥ n_L0` and `lower_R ≥ n_R0`, freeze `(n_L0, n_R0)`. If one stratum may be short, enumerate it exactly **only if `U_s ≤ E_ENUM`**. A low lower bound can also come from `X_s` hitting K or from a large block set, so "short" doesn't imply "small". Otherwise run the probe proof, and failing that, return UNCERTAIN. Then `n_s = A_s` and the other stratum gets `N − A_s`, provided its lower bound (or a probe proof) covers that. The shortfall rule `n_L = min(n_L0, A_L)`, `n_R = N − n_L` (and its mirror) is the one exercised by the spike (§8). **Boost flags are never consulted here** (A§3.2.4).

### 3.4 Priority allocation
The pure function `allocatePriority(N, priority_bps, local_bps, n_L, n_R, B_L, B_R)` in `packages/shuffle-core` is a verbatim implementation of the A§3.3 reference. `B_s` must be **exact eligible counts of qualifying Boost holders** in the stratum, capped where that helps: we only need `min(B_s, n_s)`, so computing B_s exactly is needed only when the priority pools are small (lower bound ≥ n_s otherwise suffices). The same bounds technique applies: priority pools are small in practice, so they're enumerated exactly whenever `U ≤ 2,000`, and otherwise bounded so that `min(B_s, n_s)` is proven.
City mode: `q = min(Q, B_CITY, N)`.

### 3.5 Draws
For each stratum, in NORMAL mode:
1. **Priority draw:** uniform without replacement over the eligible members of `PRIORITY_s`. Choose a pool with probability ∝ `pool_size`, then a uniform slot with `crypto.randomInt`, fetch, apply `eligible()`, reject duplicates. Repeat until `q_s` are drawn. This is exactly uniform over eligible members (§9).
2. **Discovery draw:** uniform without replacement over **all** eligible members of stratum `s` not yet selected (this includes Boost holders not chosen above, Plus and Standard). Same technique over the stratum's MEMBER/REMOTE_ELIGIBLE pools.
3. Slot fetches are batched: up to 64 `(pool_id, slot)` pairs per query, a few round trips per request.

**Budgets:** max 6 × N slot probes per request and max 6 DB round trips for draws. On exhaustion without proof → `UNCERTAIN_PARTIAL` (§3.7).
**SPARSE_COMPLETE:** all eligible rows are already enumerated, so return all of them, ordered as in §3.6. Priority = rows with a **surface-qualifying** valid Boost.

### 3.6 Presentation (A§3.7)
`BOOST_BLOCK` (shuffled) → `DISCOVERY_PLUS` (current Plus at t0, shuffled) → `DISCOVERY_STANDARD` (shuffled). Fisher–Yates with a CSPRNG. `presentation_rank` = final index. Badges: `badge.promoted` iff placement = BOOST_BLOCK; `badge.plus` iff current Plus. A Plus+Boost card in BOOST_BLOCK carries both semantics, rendered as one badge slot (doc 14).

### 3.7 Late changes, partial results
- After the snapshot draw, run a **post-check** (READ COMMITTED) on the selected IDs. It covers blocks either way, account state and discoverable, **plus entitlements** (review M8, A§8.2): the Boost is still valid and unrevoked for every BOOST_BLOCK card, current Plus status for tier and styling, and REMOTE eligibility for REMOTE cards. Any newly ineligible ID → re-run the whole selection once with a fresh snapshot. Still failing, or budget exceeded → `UNCERTAIN_PARTIAL`.
- `UNCERTAIN_PARTIAL` response: `completion = UNCERTAIN`, `has_more = true`, and at most `quota(k, priority_bps)` BOOST_BLOCK cards, where k = returned count. **Review H1 fix:** excess priority draws are **not dropped**, because dropping a boosted target that the unboosted twin would have kept violates BOOST_NON_HARM. They are **demoted to DISCOVERY** with no promoted label and no paid-placement claim, and sorted into DISCOVERY_PLUS or DISCOVERY_STANDARD by tier. Since nothing is removed, k is fixed before the cap is computed. The cap applies to the **batch total**, just as Q is a batch-total target (A§3.3). Per-stratum seat counts are unaffected by demotion, because demotion changes labels, not membership. A server-side assertion checks `BOOST_BLOCK count ≤ quota(k, priority_bps)` before responding. Clients can't check this because they never see `priority_bps`. A§3.3 forbids relabeling a paid slot as DISCOVERY *while claiming paid priority*, and nothing here claims it. Analytics count these demoted cards as DISCOVERY. Never `EXHAUSTED`, never `SPARSE_COMPLETE` (T18, T48, T76, T91). The Python enumerator must cover this fallback's non-harm before M6 exit (doc 18).
- Completion flags: NORMAL with A_total > N proven → `FULL`/`has_more=true`. NORMAL with A_total = N proven exactly → `EXHAUSTED`/`has_more=false` (A§4, T44). SPARSE_COMPLETE → `EXHAUSTED`/`has_more=false`.

### 3.8 Response (A§6)
As in A§6, plus `applied.config_version`. Card fields come from the allowlist serializer: `public_user_id, presentation_rank, placement, membership_tier, display_name, avatar{url}, home_city_label_key, home_district_label_key, gender, card_badges`. **Never:** active Boost, Boost expiry, counts, internal IDs, relationship data.

## 4. Why the draws are exactly uniform
For a union of disjoint pools with sizes `s_1..s_k`, choosing a pool with probability `s_i/Σs` and then a uniform slot gives probability `1/Σs` for every row. Rejecting rows that fail `eligible()` or are already selected, and redrawing, makes the accepted draw uniform over the remaining eligible rows (standard rejection sampling, since every eligible row has equal proposal probability). Slots are dense (swap-remove), so there are **no gaps**: this avoids the random-key/pivot bias that A§5.2 forbids. Each request uses fresh CSPRNG draws, with no memory between requests (A§0.1.9). Draws are uniform at the slot level, so the statistical gate (doc 18) tests the *implementation* against the exact reference rather than an approximation.

## 5. Performance model (to be measured, doc 17)
Per NORMAL request (N = 10):
- ~8–16 `pool_size` point reads (district mode spans the city's district pools; a cached city→district list)
- one bounded expired-scan
- one block-set load
- ~12–30 slot probes in 2–4 batched queries
- one post-check query
- total ~8–12 round trips on the primary

Expected server time is 10–40 ms. **Target warm p95 ≤ 250 ms** (A§5.2) is a budget to verify at M8 on a fixture of 1M+ accounts with realistic skew (one city holding 40 % of accounts; districts of 200 to 150,000 members).
A city surface with ~40 districts × 2 genders × 2 kinds = 160 pools: `pool_size` reads come from a single indexed query `WHERE pool_id = ANY($1)`.
Hot rows: `pool_size` is written only on membership changes. If lock waits on the largest pools exceed 10 ms p99, split into segments.

## 6. Abuse controls (A§5.3)
- Rate limits per account/installation/IP: proposed **anomaly thresholds** of about 300 Shuffle requests per 10 minutes per account and a 30 per minute burst. They are set well above normal scrolling so they never act as a discovery cap (A§5.3: "no fixed anonymous discovery/paywall cap for normal users"), and they can be adjusted within bounds in security admin after load testing.
- If Valkey fails: the canonical rule in doc 10 §6 applies (local strict buckets for everyone; fail-closed only for risk-flagged accounts). Shuffle correctness has no Valkey dependency.
- No histories: counters only.

## 7. Client behavior (doc 13)
- FlashList with keys `${batch_id}:${public_user_id}`. Server order is preserved and never re-sorted.
- Pull-to-refresh replaces the list. Infinite scroll appends while `has_more`. A *filter generation counter* discards late responses from an old filter (T29).
- `UNCERTAIN`: footer retry, at most 2 automatic retries with backoff (2 s, 8 s), then manual only (A§4).
- No seen-set and no deduplication across batches. Duplicates inside a single response are treated as a server bug and reported to telemetry.

## 8. Verification evidence (pre-architecture spike, 2026-11-14)
An independent exact-enumeration checker (`docs/architecture/evidence/shuffle_verify_spike.py`, Python stdlib + Fractions, written by a separate agent and re-run by the lead with exit code 0 in 21.9 s; output in `evidence/shuffle_verify_spike_output.txt`) showed:

| Check | Domain | Result |
|---|---|---|
| Quota tables (A§2) | N ∈ allowlist | PASS |
| §3.3 allocator: determinism, assertions | allowlist N × 4 priority × 3 local ratios × A_L, A_R ∈ 0..12, all B_s | PASS (179,172 cases) |
| Dual-surplus branch unreachable (T39) | same | PASS (0 reached) |
| No avoidable unfilled priority seat | same | PASS |
| Q = 0 and Q = N boundaries (T61) | N = 1..10, bps 0/10000 | PASS (182,680 cases) |
| **BOOST_NON_HARM**, own toggle, LOCAL and REMOTE, by subset enumeration | N = 2..10, 6 priority × 3 local ratios, A_L, A_R ∈ 0..8 | **PASS: 478,872 toggles, 0 violations** |
| City-mode non-harm | N = 2..10, A ≤ 12 | PASS |
| SPARSE_COMPLETE inclusion = 1 and order; A_total = N → NORMAL with p = 1 | allowlist N | PASS |
| Paid seats ≤ Q (T47) | 500..4000 bps step 100 | PASS (9.2M cases) |

**Observed, allowed behavior (not a violation):** boosting a *different* account can lower a target's inclusion probability. Example from the spike: N = 2, local 5000, A_L = 1, A_R = 8. A REMOTE boosted target drops from 1 to 1/8 when a LOCAL account boosts, because the single priority seat moves to LOCAL. A§3.1 defines non-harm only for the target's own toggle, so this is consistent. Admin and analytics wording must not imply otherwise.

**UNCERTAIN fallback (M1, 2026-11-14; `tools/shuffle-reference/flero_shuffle_ref/fallback.py`, `tests/test_fallback.py`).**
- **Model:** the priority stage completes; discovery is truncated by budget to m seats, independent of the target's toggle; the result is capped at `quota(k)`.
- **Adopted "demote" policy:** passes own-toggle non-harm for every case with N = 1..10, A ≤ 7, all m, and bps ∈ {500, 3000, 4000}.
- **Rejected "drop" policy:** fails. Minimal counterexample: N = 5, 3000 bps, A = 5, 2 other Boosts, q = 2, m = 2 → the buyer's inclusion falls from 2/3 to 5/9. This confirms review H1 was a real defect.
- **Priority-stage truncation** is now modeled too: only `kp ≤ q` priority draws complete, so the realized count is `min(q, kp)` in both worlds. "demote" passes own-toggle non-harm for every case with A ≤ 6 and N ≤ 10 (`test_demote_policy_non_harm_with_priority_stage_truncation`).

**What this does NOT prove yet:** larger domains (property tests up to A ≈ 50 per stratum with rational arithmetic), the production sampler's empirical distribution versus the reference (statistical gate), the UNCERTAIN fallback's non-harm, and load. All of these remain release gates (doc 18 §3).

## 9. Equivalence argument for replacing Appendix A implementation examples
| A example | This design | Why it's equal or stronger |
|---|---|---|
| "membership directories / dense-slot indices" (A§5.1) | Dense-slot directories in PostgreSQL, transactional | Same approach. Being transactional removes staleness for every non-time predicate |
| Redis for distributed limits | Valkey (Redis-compatible) with a local fallback | Same |
| GiST `tstzrange` exclusion (A§8.8) | Used as-is | Same |
| "FlashList", "Expo UI", "Next.js" | Chosen on merit (doc 03) | — |
| "single PostgreSQL transaction" for Boost | Used as-is (doc 12) | Same |
