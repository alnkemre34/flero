# 20 — Risk Register

Scale: Likelihood (L) and Impact (I) from 1 to 5. Score = L×I. Owners are roles. Review at every milestone.

| ID | Risk | L | I | Score | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|---|
| RISK-01 | **App Store rejection under Guideline 1.2** ("random or anonymous chat … do not belong") | 4 | 5 | 20 | Positioning as a moderated social network with identity-bearing profiles; the recipient is always identified, the initiator's anonymity is limited and reveal-able; no random matching; strong UGC controls (filter, report, block, timely response, published contact); pre-submission review strategy; possible Apple contact via App Review | Product + Legal | Open (DEC-21) |
| RISK-02 | Store or legal objection to user-to-user transfer of IAP Gold, or to Turkish e-money law (6493) | 3 | 5 | 15 | No cash-out; non-exchangeable gifts; counsel review; the architecture can disable gifting by feature flag **only with an owner decision** (it's a CONFIRMED feature) | Legal | Open (DEC-08) |
| RISK-03 | Anonymity oracle via the CONFIRMED block semantics (O3/O4) if DEC-02 is rejected | 4 | 4 | 16 | Shield-block proposal; otherwise documented residual risk with user-facing warning | Security | Open (DEC-02) |
| RISK-04 | Intended disclosure channels (`Seni takip ediyor`, mutual-follow reveal) enable inference | 5 | 3 | 15 | Accepted tradeoff; rate limits; anti-probing detection; clear user disclosure | Product | Accepted (spec §15) |
| RISK-05 | CSAM or prohibited content in locked photos (pay-to-view dynamics) | 3 | 5 | 15 | Pre-delivery scanning; platform Gold sink (DEC-03); report without paying; legal reporting procedure; rapid takedown | T&S | Open |
| RISK-06 | Chargeback laundering through 1-Gold transfers | 3 | 4 | 12 | Provenance lots, risk holds, velocity limits, debt model, graph alerts | Finance/Risk | Designed |
| RISK-07 | Double spend or ledger drift bug | 2 | 5 | 10 | DB constraints, single gateway function, property + concurrency tests, nightly reconciliation, freeze on drift | Backend | Designed |
| RISK-08 | Shuffle production sampler deviates from uniform, or non-harm fails on domains larger than the spike | 2 | 4 | 8 | Exact dense-slot design; statistical gate; extended property tests; release blocker | Backend | Partially verified (spike) |
| RISK-09 | Shuffle p95 > 250 ms on skewed large cities | 2 | 3 | 6 | Bounded queries; batched probes; readable standby for draws; measurement at M8 | Backend/SRE | Open |
| RISK-10 | RN list performance below the premium bar on midrange Android | 3 | 3 | 9 | M1 frame-time go/no-go; FlashList v2, memoized cards, no row animations; Flutter fallback | Mobile | Open |
| RISK-11 | Push unreliability (OEM battery killers, Huawei without GMS, iOS throttling) | 4 | 2 | 8 | Honest delivery semantics; in-app sync; OEM guidance screens; no delivery claims | Mobile | Accepted residual |
| RISK-12 | Account takeover giving access to hidden threads and Gold | 3 | 4 | 12 | Rotation + reuse detection, step-up, linking rules, risk signals, alerts | Security | Designed |
| RISK-13 | Insider de-anonymization | 2 | 5 | 10 | Break-glass with dual approval, audit, alerts, reviews | Security | Designed |
| RISK-14 | KVKK cross-border transfer non-compliance (EU hosting) | 3 | 4 | 12 | Standard contracts + 5-day notification; DPA register; counsel | Legal | Open (DEC-07) |
| RISK-15 | Law 5651 obligations reached (> 1M daily TR access): local representative and data localization | 2 | 4 | 8 | Monitor the metric; portable data plane; Turkish-cloud migration plan | Legal/SRE | Monitoring |
| RISK-16 | Age-assurance insufficiency (minors on the platform) | 3 | 5 | 15 | Layered assurance (DEC-06); reports; underage signals; vendor escalation | T&S | Open |
| RISK-17 | Spam and harassment via unlimited pre-acceptance messages | 4 | 3 | 12 | Thread-creation limits, velocity and content scoring, filtered requests, easy block | T&S | Designed |
| RISK-18 | Persistent unlock expires with 90-day retention, so users perceive a loss | 3 | 2 | 6 | Expiry shown before unlock (DEC-05) | Product | Open |
| RISK-19 | Small team, wide scope causing schedule overrun | 4 | 3 | 12 | Strict milestone gates, parallel lanes, agent assistance, scope fixed per stage | Eng lead | Open |
| RISK-20 | Vendor or provider outage (store APIs, APNs/FCM, scanner) | 3 | 2 | 6 | Retryable flows, queues, fail-safe states | SRE | Designed |
| RISK-21 | Trademark or domain availability of "FLERO" | 3 | 3 | 9 | Clearance before public launch (spec header) | Legal | Open |
| RISK-22 | Boost purchases in sparse markets perceived as poor value | 3 | 3 | 9 | Mandatory neutral disclosure; no guarantees; mode-segmented analytics | Product | Designed |
| RISK-23 | Users or admins misread the fact that another account's Boost can lower someone else's inclusion probability as a non-harm violation | 2 | 2 | 4 | Wording in admin and help (doc 11 §8); allowed by spec | Product | Designed |

## Documented tradeoffs (master §15; shown in privacy/UX copy)
1. Follower pairwise labels and mutual-follow identity enable inference. Total anonymity against deliberate social interaction is impossible.
2. Sparse markets can show all boosted profiles with paid labels (up to 100 % promoted cards).
3. Independent Shuffle batches can repeat profiles.
4. Plus position raises expected visibility without changing organic draw probability.
5. Absolute screenshot prevention is impossible.
6. A remote Standard card with an active city Boost reveals Boost ownership by inference (A§8.6).
7. Another user's Boost can lower a given account's inclusion probability (doc 11 §8). Non-harm is only about one's own Boost.
8. No end-to-end encryption. The server can access content, for moderation.
