# 18 — Testing Strategy & Quality Gates

Rule (master §13): no feature is done because it compiles. Every gate below produces an **artifact**: a report, a log, a screenshot set or a benchmark. Nothing counts as "tested" without a recorded run.

## 1. Test pyramid and tools
| Layer | Tool | Scope |
|---|---|---|
| Unit | Vitest | pure domain logic, serializers, i18n key coverage |
| Property | fast-check | allocator, sampler invariants, ledger conservation, watermark monotonicity, state machines |
| Exact reference | `tools/shuffle-reference` (Python, Fractions, written independently of the TS implementation) | inclusion probabilities, non-harm, sparse/normal boundaries |
| Integration | Vitest + Testcontainers (PostgreSQL 17, Valkey) | transactions, locks, constraints, migrations, outbox |
| Concurrency | custom harness: N parallel clients against a real PG (pg + `Promise.all`, barrier-synchronized), plus a deterministic interleaving harness for critical sections | wallet, Boost, region change, follow/like/block, message seq |
| Contract | OpenAPI/AsyncAPI validation, oasdiff, forbidden-field and differential oracle suites, Schemathesis | API surface, anonymity |
| E2E mobile | Maestro (iOS simulator + Android emulator in CI; device farm for the matrix) | user flows, push states, purchases (sandbox) |
| E2E admin | Playwright | RBAC, maker-checker, config workflow |
| Load | k6 (HTTP + WebSocket) | profiles in doc 17 §3 |
| Fault injection | Toxiproxy, ECS task kill, RDS failover in staging | reliability rules (master §12) |
| Security | Semgrep, gitleaks, OSV/pnpm audit, Trivy, ZAP, external pentest | — |
| Mobile performance | Flashlight, Instruments, Reassure | frame times, startup, render regressions |
| Visual/a11y | screenshot golden tests (light, dark, 200 % text) per component and state; axe for admin; manual VoiceOver/TalkBack scripts | — |

## 2. Domain test suites (minimum content)

**Shuffle (A§9, all release gates)**
- `shuffle-reference` (Python):
  - exact enumeration of A_L, A_R ∈ 0..8 (district), A ≤ 12 (city), all N (math fixtures 1..10 + allowlist where feasible), and the ratio boundaries
  - non-harm own toggle
  - SPARSE/NORMAL boundary for A_total = 0..50 × allowlist N (T47)
  - Q = 0 and Q = N (T61)
  - dual-surplus unreachability (T39)
  - The spike passed in the pre-architecture phase (doc 11 §8).
- `shuffle-core` (TS):
  - the same fixtures, asserting **identical** allocations to the Python reference (cross-implementation agreement)
  - fast-check properties: uniqueness, prefix ordering BOOST_BLOCK → PLUS → STANDARD, badge rules, counts unchanged by sort (T74, T75, T89), UNCERTAIN cap ≤ quota(k), and the UNCERTAIN fallback non-harm property
- Statistical gate (T24): the production sampler vs the exact reference on fixtures (dense, sparse, gender-skewed, heavily blocked, churned).
  - Test: chi-square goodness of fit on per-account inclusion frequencies, with ≥ 200k draws per fixture, at α = 0.001 with Bonferroni correction across fixtures.
  - Pass requires no fixture rejected **and** max absolute deviation ≤ 0.5 percentage points.
  - Report: the test statistics, saved as an artifact.
- Integration: T20–T23, T33–T37, T49–T60, T94–T97 against real PG, including exact-boundary time tests using a controllable DB clock (`SET LOCAL` test function `app_now()` in test builds only).
- Contract: T01–T04, T43, T82, T84, T87.

**Messaging and anonymity**
- State-machine model test (doc 08 §10), 10k random interleavings per CI run, with the seed logged.
- Differential oracle suite (doc 10 §5) across every channel O1–O20 where designed.
- Watermark monotonicity under reordered and duplicated acks; idempotent replays; a PG failover during a send.

**Wallet and economics**
- Conservation: Σ postings = 0 per transaction, and the materialized balance equals Σ postings after every random operation sequence (property-based model vs DB).
- Concurrency:
  - 100 parallel gifts from one wallet with balance 10 → exactly 10 succeed
  - double-tap and two-device Boost activation → one debit
  - concurrent Boost activation vs region change → one coherent order (T36, T95)
- Store: sandbox purchase, renewal, grace, expiry, refund and revoke flows (Apple StoreKit test environment and sandbox; Google license testers), plus replay of duplicate notifications.
- Chargeback after multi-hop gifts → debt, holds, no negative balances (T58, T99).

**Media:** one-view cannot be replayed (re-open after consume → 403); a render-failure grace path; the sender sees for free; unlock is idempotent; EXIF stripped (golden file); crop accuracy (pixel diff ≤ 1 px on reference images).

**Notifications:** Maestro plus a device-lab matrix of foreground, background, terminated, permission revoked and token rotated. A payload privacy fuzz (no counterpart identity in anonymous classes).

## 3. Release gates (all must pass; evidence stored in `docs/evidence/`)
| Gate | Criterion |
|---|---|
| G1 Build | types, lint, unit, property, integration and contract tests green on main |
| G2 Shuffle math | Python reference + TS agreement + statistical gate + all T01–T101 mapped tests green |
| G3 Anonymity | differential oracle suite green; payload fuzz green; manual timing review signed |
| G4 Financial | conservation and concurrency suites green; sandbox purchase matrix green; reconciliation drill (inject drift → alert) |
| G5 Reliability | fault-injection scenarios (doc 17 §7) observed with no data loss or duplication |
| G6 Load | doc 17 §8 report; SLO targets met or explicitly risk-accepted by the owner |
| G7 Security | Semgrep/gitleaks/OSV clean (no high or critical); ZAP no high; external pentest with highs fixed |
| G8 Mobile quality | device matrix (≥ 8 devices: 3 iOS, 5 Android incl. midrange and a Huawei without GMS) screenshots in light, dark and 200 %; frame-time budget met; crash-free ≥ 99.5 % in beta |
| G9 Accessibility | VoiceOver/TalkBack scripts pass on core flows; contrast measured ≥ AA |
| G10 DR | restore drill with measured RTO/RPO recorded |
| G11 Legal/store | counsel sign-off (KVKK, 5651, 6493, consumer); store review strategy (RISK-01); published policies |
| G12 Owner sign-off | residual risk register reviewed |

## 4. Definition of done (per task)
Code merged behind CI. Tests at the right layer exist and cite the REQ/SHF IDs. Contract regenerated with no unapproved breaking diff. Telemetry added. Docs updated in the same PR. A reviewer agent or a human review for non-trivial diffs (ecc:code-reviewer; security-reviewer for auth, wallet or anonymity). Evidence attached when a gate is affected.
