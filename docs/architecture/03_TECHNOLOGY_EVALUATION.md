# 03 — Technology Evaluation

**Status:** Recommendation for approval · **Basis:** master §2 (technology autonomy). Names in the spec are candidates, not mandates.
**Criteria (directive order):** R reliability · P performance · S security · Sc scalability · D dev productivity · M maintainability · O operational simplicity (higher = simpler) · T total cost of ownership · E ecosystem maturity · L long-term sustainability. Scores run 1–5 and are qualitative judgments, not benchmarks.

**Context that drives the choices:**
1. A small team, which is assumed (ASM-T1), needs to ship three clients (iOS, Android, admin web) plus a backend.
2. Correctness-critical domains (ledger, Boost, Shuffle, anonymity) need strong transactions and exhaustive tests more than exotic scale.
3. The modeled peak load in doc 17 (~1.4k API rps, ~25k concurrent sockets and ~600 msg/s at 1M registered accounts) is moderate and fits a well-built modular monolith on one PostgreSQL primary with headroom.
4. Turkish market, with EU hosting as the likely default (DEC-07).

---

## 1. Mobile (iOS + Android)

| Option | R | P | S | Sc | D | M | O | T | E | L | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **React Native (New Architecture) + Expo (dev builds, EAS)** | 4 | 4 | 4 | — | 5 | 4 | 5 | 5 | 5 | 4 | Shares TypeScript with the backend, admin and generated API clients. Reanimated/Gesture Handler/Skia/FlashList deliver 120 Hz-capable lists and gestures on the UI thread. EAS covers build, submit and updates. Native modules are available when needed |
| Flutter | 4 | 5 | 4 | — | 4 | 4 | 4 | 4 | 4 | 4 | Excellent custom rendering (Impeller) for premium UI. Dart is a second language; no shared types with a TS backend unless OpenAPI generation is added; the platform-feel work is all manual |
| Native Swift + Kotlin | 5 | 5 | 5 | — | 2 | 3 | 3 | 2 | 5 | 5 | Best fidelity, but two full codebases. Doubles the cost of every feature for a small team |
| Kotlin Multiplatform + Compose MP | 4 | 4 | 4 | — | 3 | 3 | 3 | 3 | 3 | 4 | iOS Compose is still maturing. Logic sharing doesn't remove the UI work |

**Decision:** React Native + Expo (ADR-002). **Trade-off accepted:** a premium look depends on discipline: Skia for gradients/frames, Reanimated worklets, FlashList v2 and on-device profiling at M8. It is not automatic. Flutter remains the documented fallback if the M1 card-list prototype fails the frame-time gate (≤ 16.7 ms p95 frame on a midrange Android reference device).

## 2. Backend language/framework

| Option | R | P | S | Sc | D | M | O | T | E | L | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **TypeScript on Node.js LTS + Fastify, modular monolith** | 4 | 4 | 4 | 4 | 5 | 4 | 5 | 5 | 5 | 4 | One language across the stack. Zod schemas generate OpenAPI 3.1 and the typed clients. Fastify is low-overhead. CPU work (sampling, image processing) goes to worker processes |
| Go (chi/echo + sqlc) | 5 | 5 | 5 | 5 | 3 | 4 | 5 | 4 | 4 | 5 | Excellent for the WebSocket gateway and CPU work. Adds a second language and contract drift risk with the TS clients |
| Kotlin + Spring Boot/Ktor | 5 | 4 | 5 | 5 | 3 | 4 | 3 | 3 | 5 | 5 | Strong transactional ecosystem. Heavier runtime and ops, and a second language |
| NestJS (TS) | 4 | 3 | 4 | 4 | 4 | 3 | 4 | 5 | 5 | 4 | The decorator/DI ceremony adds little for a modular monolith with explicit modules |
| Python FastAPI | 4 | 3 | 4 | 3 | 4 | 3 | 4 | 4 | 5 | 4 | Fine, but no type sharing with clients and a weaker concurrency story for WebSockets |

**Decision:** TypeScript/Fastify modular monolith, with four deployables from one codebase: `api`, `realtime`, `worker`, `admin-api` (ADR-003). **Escape hatch:** if M8 load tests show the realtime gateway exceeding its budget (doc 17 §5), only the gateway gets rewritten in Go. Its protocol is small and fully specified by an AsyncAPI document.

## 3. API style

| Option | Verdict |
|---|---|
| **REST/JSON + OpenAPI 3.1 (generated from Zod), RFC 9457 problem+json errors with stable `code`** | **Chosen.** The spec mandates OpenAPI (A§6). Easy contract tests for forbidden fields. Cacheable where safe (geo reference, banners). Simplest for admin and mobile |
| GraphQL | Rejected. Field-level authorization and over-fetching risk the anonymity boundary (broad serializers), and query-cost control adds complexity |
| gRPC (+ gRPC-web) | Rejected for clients (weak RN/web ergonomics). Unnecessary internally inside a monolith |
| tRPC | Rejected. Couples clients to the server's TS types and produces no machine-readable OpenAPI |

## 4. Realtime transport

| Option | R | S | O | T | Notes |
|---|---|---|---|---|---|
| **Own WebSocket gateway (TS, `ws`), Redis pub/sub fan-out, Postgres as the source of truth** | 4 | 5 | 4 | 5 | The protocol is tiny: authenticate, one implicit per-user channel, ack, typing. Clients never choose channels, so there is no subscription-authorization surface. Payloads are redacted per recipient on the server before publishing |
| Centrifugo (self-hosted, Go) | 5 | 4 | 4 | 5 | Mature: history and recovery, presence, Redis engine. A sound alternative. Its channel model, presence and history features would mostly be disabled for anonymity reasons |
| Managed (Ably / Pusher / PubNub) | 5 | 3 | 5 | 2 | Cost at ~25k peak connections and millions of messages/day. Metadata reaches a third party. Vendor lock-in |
| Firebase RTDB/Firestore | 4 | 3 | 5 | 3 | Security rules don't express anonymity redaction well. A second datastore for messages |
| Socket.IO | 4 | 4 | 4 | 5 | Fallback transports are unnecessary on mobile. Extra protocol overhead |

**Decision:** own thin gateway (ADR-005), with Centrifugo as the documented plan B. Correctness never depends on the socket. Messages are committed in Postgres with per-conversation sequence numbers, and clients reconcile through the sync API (doc 08).

## 5. Primary database

| Option | Notes |
|---|---|
| **PostgreSQL 17 (managed, Multi-AZ)** | **Chosen** (ADR-004). Needs: SERIALIZABLE and row locks for the wallet; `btree_gist` exclusion constraints for "one active Boost" (A§8.8); declarative partitioning for messages and retention; JSONB for config snapshots. Mature tooling, PITR |
| CockroachDB / YugabyteDB | Horizontal writes aren't needed at the modeled load. Higher latency per transaction, higher cost, and exclusion-constraint support is limited or absent |
| MySQL 8 | No exclusion constraints, weaker partial indexes. Possible, but strictly worse for the Boost invariant |
| MongoDB / DynamoDB | No multi-row ACID ergonomics comparable to SQL. The ledger and the anonymity joins would suffer |

## 6. Cache / ephemeral state

| Option | Notes |
|---|---|
| **Valkey (Redis-compatible), managed** | **Chosen** for rate limits, abuse counters, socket routing/presence (internal only), typing pub/sub, short-lived quote and lease lookups. **Never authoritative** for balances, entitlements or eligibility (A§5.1, §8.7). Every use has a documented fallback (doc 17 §7) |
| In-process only | Not enough for distributed rate limits or fan-out across gateway nodes |
| Memcached | No pub/sub, no atomic scripts |

## 7. Jobs, queues, events

| Option | Notes |
|---|---|
| **Postgres transactional outbox + Graphile Worker (Postgres-backed jobs)** | **Chosen** (ADR-006). Jobs are enqueued in the same transaction as the domain write, which is exactly-once intent. No extra broker to operate. LISTEN/NOTIFY gives low pickup latency. Comfortably handles the modeled thousands of jobs/s with batching |
| BullMQ (Redis) | Fast, but Redis durability (AOF) makes it a weaker home for financial and notification intents, and enqueue isn't atomic with the DB write |
| Kafka / Redpanda | No event-streaming or replay requirement at this scale; heavy operations. Revisit only if analytics streaming needs it |
| RabbitMQ / SQS | Viable. Adds a dual-write problem without the outbox, which we need anyway |

**Upgrade trigger:** sustained job throughput above ~2k/s or worker lag p95 above 30 s after tuning → move the push fan-out to SQS while keeping the outbox (doc 17).

## 8. Media storage and delivery

| Option | Notes |
|---|---|
| **S3 (private buckets, SSE-KMS) + CloudFront; sharp/libvips processing workers** | **Chosen**. Presigned uploads go to a quarantine prefix. A worker strips metadata, re-encodes and scans. Public avatars are served through the CDN with long-lived, content-hashed keys. Locked chat media is **never** cached on the CDN: it's served via short-lived signed URLs after an entitlement check, and one-view media is proxied through the media service so consumption can be metered |
| Cloudflare R2 + Images | Cheaper egress. A strong alternative if hosting moves off AWS |
| Managed image CDN (Cloudinary/imgix) | Cost, and private-media semantics are a poor fit |

HEIC: iOS converts on the client (expo-image-manipulator → JPEG/HEIF) before upload, and the server accepts JPEG/PNG/HEIF. That avoids depending on server-side HEVC decoding, which has patent and build issues.

## 9. Push notifications

| Option | Notes |
|---|---|
| **Direct APNs (token auth, HTTP/2) + FCM HTTP v1 from our worker** | **Chosen** (ADR-008). No third party sees notification metadata. Full control of collapse IDs, priorities, `mutable-content` and token invalidation |
| Expo Push Service | Convenient, but an extra relay that sees payloads and receipts, and a dependency on its availability |
| OneSignal / Braze | Marketing features we don't need, and a privacy surface |

## 10. Auth

| Option | Notes |
|---|---|
| **In-house auth module on audited primitives** (argon2id, `jose` for OIDC/JWT verification, opaque rotating refresh tokens, WebAuthn for staff) | **Chosen** (ADR-007). Full control of account linking (takeover protection), session lists, the reveal/anonymity coupling, age/consent gating and cost at 1M accounts. Requires an Opus-level security review (rules/security.md) |
| Auth0 / Clerk | Strong, but per-MAU cost at 150–250k MAU is significant and identity data sits with a vendor. Linking and session logic would still be custom |
| Firebase Auth / Identity Platform | Cheap. Ties the identity layer to Google, and session revocation semantics are weaker |
| Supabase Auth | Would pull in the Supabase platform. Fine, but no advantage here |

## 11. Store billing

| Option | Notes |
|---|---|
| **Direct: StoreKit 2 / Play Billing on the client (`expo-iap`/`react-native-iap`); App Store Server API + Server Notifications V2; Google Play Developer API + RTDN** | **Chosen** (ADR-009). The ledger has to be authoritative and exactly-once regardless, so a middle layer would only add another reconciliation source in the money path. Revenue share to a third party avoided |
| RevenueCat | Faster subscription lifecycle handling and good dashboards. Still requires our ledger and reconciliation. **Owner may prefer it to cut M5 risk (DEC-23).** |

## 12. Admin frontend

| Option | Notes |
|---|---|
| **Next.js (App Router) + React + Tailwind (CSS-variable tokens) + Radix/shadcn primitives + TanStack Table/Query** | **Chosen**. Shares tokens and API clients with mobile. Server components for heavy tables. Deployed privately (doc 15) |
| Refine / React-Admin | Fast CRUD but a generic look. The spec demands premium |
| Retool / internal-tool SaaS | Data leaves our boundary, RBAC/audit is too coarse for anonymity break-glass |

## 13. Observability

| Option | Notes |
|---|---|
| **OpenTelemetry SDKs → Grafana Cloud (metrics/logs/traces; EU region) + Sentry (EU) for errors/crashes** | **Chosen**. Vendor-neutral instrumentation. PII redaction at the collector. Mobile crash reports scrubbed (no counterparty IDs) |
| Self-hosted LGTM stack | Cheaper at scale, more ops. Migration path is open because of OTel |
| Datadog | Excellent but expensive per host and per span at our volume |

Product analytics: **PostHog** (EU cloud or self-hosted) with a strict event allowlist. No viewer→profile exposure events. Counterparty IDs are never sent.

## 14. Testing infrastructure

Vitest (unit), **fast-check** (property tests), an **independent Python exact enumerator** (Shuffle reference, kept in a separate language on purpose), Testcontainers PostgreSQL (integration/concurrency), Schemathesis (OpenAPI fuzzing), k6 (load and WebSocket soak), Maestro (mobile E2E incl. background/terminated push), Playwright (admin E2E), Toxiproxy (network fault injection), Semgrep + gitleaks + OSV-Scanner/`pnpm audit` (security), OWASP ZAP (DAST on staging). Details in doc 18.

## 15. Deployment and hosting

| Option | R | O | T | Notes |
|---|---|---|---|---|
| **AWS eu-central-1 (Frankfurt), ECS on Fargate, RDS PostgreSQL Multi-AZ, ElastiCache Valkey, S3/CloudFront, WAF, KMS, Secrets Manager, SES; IaC with OpenTofu** | 5 | 4 | 3 | Managed primitives for every stateful part. Fargate avoids running Kubernetes. ~40 ms RTT to Istanbul. Requires KVKK standard contracts + notification (doc 10 §9) |
| GCP europe-west3 + Cloud Run + Cloud SQL | 5 | 5 | 3 | Equivalent. Cloud Run handles WebSockets with limits. A good alternative |
| Hetzner/OVH VMs, self-managed Postgres | 3 | 2 | 5 | Cheapest compute, but the team carries the DB HA/backup burden. Rejected for a financial ledger |
| Turkish cloud (e.g., local providers) | ? | 3 | ? | Relevant if data localization becomes mandatory (5651 threshold or counsel advice). Kept as a migration target (DEC-07) |
| Kubernetes (EKS) | 5 | 2 | 3 | Deferred. Only justified when service count or bin-packing economics demand it |

## 16. Final stack (summary)

| Layer | Choice |
|---|---|
| Mobile | React Native (New Arch) + Expo (dev client, EAS Build/Submit/Update), TypeScript strict, Expo Router, Reanimated, Gesture Handler, React Native Skia, FlashList v2, expo-image, TanStack Query, Zustand (UI state), MMKV (prefs), op-sqlite/SQLCipher (encrypted message cache), i18next (tr default, en), expo-notifications (native device tokens), expo-iap, expo-secure-store |
| Backend | Node.js LTS, TypeScript strict, Fastify, Zod → OpenAPI 3.1, Drizzle ORM (queries) + reviewed SQL migrations, Graphile Worker, `ws` gateway |
| Data | PostgreSQL 17 (+ btree_gist, pgcrypto, pg_stat_statements), Valkey, S3 |
| Admin | Next.js App Router, Tailwind + tokens, Radix/shadcn, TanStack Table |
| Contracts | OpenAPI 3.1 (HTTP), AsyncAPI 3.0 (realtime), generated TS clients (`openapi-typescript` + `openapi-fetch`) |
| Infra | AWS Frankfurt, ECS Fargate, RDS Multi-AZ, ElastiCache, CloudFront, WAF, KMS, Secrets Manager, OpenTofu, GitHub Actions, EAS |
| Observability | OpenTelemetry, Grafana Cloud, Sentry, PostHog (restricted) |
| Repo | pnpm workspaces + Turborepo monorepo |

Versions are pinned to the current stable releases at M2 kickoff and verified with Context7 or official changelogs (rules/engineering.md: Dependencies). This doc doesn't freeze version numbers on purpose.
