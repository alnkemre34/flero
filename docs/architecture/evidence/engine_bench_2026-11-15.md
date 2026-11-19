# Engine latency benchmark — 2026-11-15

**Command:** `pnpm --dir apps/api bench` (= `node bench/engine.bench.ts 100000`)

**Setup:**
- PostgreSQL 17 (Testcontainers, Docker Desktop on Windows 11, local laptop)
- the real Fastify stack driven by `app.inject` (routing, auth, zod validation, serialization; no network hop)
- concurrency 8

**Fixture:** 100,000 accounts
- 40 % İstanbul, with districts skewed 1–14 %
- 5 % Plus
- ~1 % active District Boost
- 106,030 directory slots
- `discovery_drift()` = 0 rows

| Path | p50 | p95 | p99 | Throughput |
|---|---|---|---|---|
| Shuffle district (~14k members) | 21.4 ms | 28.1 ms | 42.3 ms | 357 req/s |
| Shuffle district (~1k members) | 18.9 ms | 22.5 ms | 24.1 ms | 413 req/s |
| Shuffle CITY Plus (İstanbul ~40k) | 15.0 ms | 18.7 ms | 20.2 ms | 519 req/s |
| Shuffle district Plus FEMALE | 18.3 ms | 21.1 ms | 23.7 ms | 431 req/s |
| Send message | 19.4 ms | 22.4 ms | 26.2 ms | 403 req/s |
| List messages | 8.3 ms | 11.1 ms | 14.0 ms | 929 req/s |
| Inbox | 5.7 ms | 7.7 ms | 8.6 ms | 1354 req/s |
| Sync | 7.1 ms | 9.3 ms | 10.8 ms | 1091 req/s |
| Profile view | 9.2 ms | 11.7 ms | 13.0 ms | 844 req/s |
| IAP verify (credit) | 14.4 ms | 19.0 ms | 23.0 ms | 546 req/s |
| Gold gift (2 wallets + 2 ledger txns) | 27.8 ms | 33.9 ms | 39.4 ms | 278 req/s |
| GET /v1/me | 6.4 ms | 8.5 ms | 9.1 ms | 1209 req/s |

**Result:**
- The Appendix A target (Shuffle warm p95 ≤ 250 ms) is met with about 9× headroom.
- The global ledger sum after the run is 0.

**Optimization applied during the run:** the capacity proof now uses the one-round-trip lower bound `U − X − Bk` before falling back to exact enumeration. Before the change, district p95 was 43 ms and small-district p95 was 53 ms.

**Limits (honest):**
- This is a single laptop: no network RTT, no TLS, no realistic multi-instance pool contention.
- The M8 gate (1M+ accounts, staging hardware) is still pending (doc 17).
