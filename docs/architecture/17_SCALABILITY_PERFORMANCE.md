# 17 — Scalability, Capacity & SLOs

Every number here is an **assumption or a target**, not a measurement (L-4). M8 replaces each target with a measured value or flags it as failed. Registered users ≠ concurrent users.

## 1. Workload assumptions (ASM)
| ID | Assumption | Base | High |
|---|---|---|---|
| ASM-1 | Registered accounts (horizon ~24 months) | 1,000,000 | 1,000,000 |
| ASM-2 | DAU / registered | 15 % → 150k | 25 % → 250k |
| ASM-3 | Peak concurrent app-foreground users / DAU | 10 % → 15k | 12 % → 30k |
| ASM-4 | Peak-hour factor (Turkey evening, 20:00–23:00 TRT) vs daily average | 4× | 5× |
| ASM-5 | Messages sent per DAU per day | 30 | 50 |
| ASM-6 | Shuffle requests per DAU per day | 15 | 25 |
| ASM-7 | API requests per DAU per day (all endpoints) | 200 | 300 |
| ASM-8 | Chat photos per DAU per day | 0.3 | 0.6 |
| ASM-9 | Gold economic operations per DAU per day | 0.5 | 1.5 |
| ASM-10 | Geography skew: share of accounts in the largest city (Istanbul) | 40 % | 50 % |
| ASM-11 | Registration growth | 2–5k/day | 15k/day (campaign spikes 50k/day) |
| ASM-T1 | Team size at build | 3–6 engineers | — |

## 2. Derived load
| Quantity | Base avg | Base peak | High peak | Design target (headroom) |
|---|---|---|---|---|
| API requests/s | 350 | 1,400 | 4,300 | **5,000 rps** |
| WebSocket connections | — | 15k | 30k | **60k** |
| Messages committed/s | 52 | 210 | 720 | **1,500 msg/s** (burst 3× high) |
| Realtime events/s (msg + receipts + typing) | ~300 | ~1,200 | ~4,000 | 10k events/s through Valkey |
| Shuffle requests/s | 26 | 105 | 360 | **500 rps** at p95 ≤ 250 ms |
| Push notifications/s | 46 | 250 | 700 | 1,500/s |
| Chat photo uploads/s | 0.5 | 2 | 7 | 20/s (worker autoscale) |
| Gold ops/s | 0.9 | 3.5 | 17 | 100/s |

**Storage growth (base):**
- Messages: ~4.5M/day × ~600 B (row + indexes) ≈ 2.7 GB/day, ≈ 1 TB steady state with 12-month retention.
- Chat media: 45k/day × ~0.7 MB of variants ≈ 32 GB/day, ≈ 2.9 TB steady state at 90 days.
- Avatars: ~1M × 0.3 MB ≈ 300 GB.
- Ledger: < 50 GB/year.
- Discovery directories: ~2.5 rows/account → ~2.5M rows (< 1 GB).

## 3. Load profiles (for k6 at M8)
| Profile | Description |
|---|---|
| NORMAL | base average mix for 2 h |
| PEAK | base peak (1.4k rps, 15k sockets, 210 msg/s, 105 Shuffle rps) for 1 h |
| HIGH-PEAK | high case (4.3k rps, 30k sockets, 720 msg/s, 360 Shuffle rps) for 30 min |
| BURST | 3× HIGH-PEAK messages for 5 min (event, campaign) |
| RECONNECT STORM | 30k sockets dropped and reconnected within 60 s (gateway deploy or network blip) |
| SHUFFLE SKEW | 1M accounts; Istanbul 40–50 %; small districts with 0–50 members; 10 % of viewers with 1,000+ blocks; Boost penetration 0.5 %, 5 % and 30 % in some districts |
| WALLET CONTENTION | 1,000 concurrent Boost activations and gifts on 50 shared accounts (retry and double-tap storms) |

## 4. Service-level objectives (proposed; owner approval DEC-10)
| Service | SLI | SLO (30-day) |
|---|---|---|
| Auth (login/refresh) | success of valid requests | 99.9 %, p95 ≤ 300 ms |
| Messaging commit | successful commit of valid sends | **99.95 %**, p95 ≤ 150 ms, p99 ≤ 400 ms |
| Realtime delivery | commit → recipient socket, both online | p95 ≤ 500 ms, p99 ≤ 1.5 s, measured for ≥ 99 % of online pairs |
| Discovery (Shuffle) | non-5xx valid responses | 99.9 %, **p95 ≤ 250 ms warm**, p99 ≤ 600 ms; UNCERTAIN rate ≤ 0.5 % |
| Wallet operations | correct completion (no double debit, ever) | 99.9 % availability; **correctness: 0 incidents** (reconciliation drift = 0) |
| Push pipeline | commit → provider accepted | p95 ≤ 5 s (no claim about device delivery) |
| Media | upload complete → READY | p95 ≤ 8 s |

**Dependency math:** messaging commit depends on ALB × api × PG. With RDS Multi-AZ (AWS SLA 99.95 %), the api layer must reach 99.99 % to keep the composite ≈ 99.95 %. That's achievable only with ≥ 3 tasks across 3 AZs and rolling deploys. Realtime delivery additionally depends on Valkey and the gateway, which is why it has a **latency** SLO and not an availability SLO. When Valkey is down, push/sync keeps correctness.

## 5. Bottlenecks and thresholds
| Component | First bottleneck | Expected threshold (estimate) | Mitigation path |
|---|---|---|---|
| PG primary (writes) | message commit ≈ 8–10 row writes (idem, conversation seq, message, 2 sync bumps, 2 change upserts, outbox, later watermark update; review M4) | ~5–8k simple writes/s on r7g.2xlarge with gp3/io2 → ≈ **600–1,000 msg/s**. That's below the 1,500 msg/s design target but above the high peak of 720. **Must be measured at M8.** | coalesce receipt bumps; r7g.4xlarge; then move the messaging schema to its own cluster (module boundary ready) |
| PG connections | many tasks | 400 | RDS Proxy / pgbouncer |
| Conversation row lock | per-conversation seq | ≫ human chat rates | n/a |
| Celebrity counters | follower/like counter rows | hot single row > ~200 updates/s | sharded counters |
| pool_size locks | membership churn in the largest districts | campaign signup spikes | pool segments |
| Gateway | sockets per Node process | ~5–10k (to be measured) | horizontal; Go rewrite if CPU/GC bound |
| Valkey pub/sub | events/s | 10k+ easily per shard | sharded pub/sub (Valkey 7+) |
| Worker / outbox | push fan-out | ~2k jobs/s with Graphile batching | batch jobs; SQS for push if exceeded |
| Shuffle | DB round trips | 500 rps × ~10 queries = 5k QPS of cheap index reads | read-only snapshot on primary is required for correctness of final checks; if primary CPU > 60 %, serve the *draw* phase from a readable standby and keep the post-check on the primary. This requires the **RDS Multi-AZ DB cluster** deployment (two readable standbys, semi-synchronous) chosen in doc 16 §1. Standby lag means the post-check must also re-validate directory-derived Boost and REMOTE eligibility (doc 11 §3.7) |

**Sharding triggers** (any one, sustained 7 days, after vertical scaling):
- PG primary CPU > 65 % at peak
- WAL volume > 50 MB/s
- message table > 3 TB
- p99 commit > 400 ms

First step: split messaging into its own PostgreSQL cluster. Then hash-partition by conversation if needed.

## 6. Backpressure and protection
- Per-endpoint concurrency limits in Fastify (`@fastify/under-pressure`: event-loop delay > 200 ms → 503 with Retry-After).
- Outbox lag guard: if push lag > 5 min, coalesce harder (1 push per conversation per minute).
- Shuffle: hard per-request budgets (doc 11 §3.5) plus global concurrency cap → `UNCERTAIN_PARTIAL` or 503, never unbounded work.
- Client: jittered retry everywhere; UNCERTAIN retry caps; reconnect backoff up to 30 s.

## 7. Graceful degradation matrix
| Outage | Messaging | Realtime | Shuffle | Wallet | Push |
|---|---|---|---|---|---|
| Valkey | ✔ commits | ✘ fan-out → push + polling sync 15 s | ✔ correctness (no dependency); limits per doc 10 §6 (local buckets; risk-flagged accounts fail closed) | gifts/Boost fail closed; unlock ✔ | ✔ (presence unknown → push everyone offline-assumed) |
| Gateway | ✔ | ✘ → push + polling | ✔ | ✔ | ✔ |
| Worker | ✔ | ✔ best-effort direct publish | ✔ | ✔ | ✘ delayed (outbox persists) |
| PG failover (~1–2 min) | ✘ retryable | partial | ✘ retryable | ✘ fail closed | backlog |
| Store APIs | ✔ | ✔ | ✔ | top-ups pending verification | ✔ |

## 8. Capacity verification plan (M8 release evidence)
1. Generate a 1M+ account fixture: realistic city/district distributions from TÜİK population shares (public data), gender split, 15 % Plus, Boost penetration scenarios, follow graph with power-law degrees, 12 months of synthetic messages for 150k DAU (partitioned).
2. Run the §3 profiles in staging, sized like prod (temporarily). Record p50/p95/p99, CPU, IO, pool waits, lock waits, errors, underfill and UNCERTAIN rates.
3. Publish a report in `docs/evidence/load-<date>.md`. Any SLO miss blocks launch or produces an approved, explicit risk acceptance.
