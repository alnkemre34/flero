# 16 — Infrastructure & DevOps

ADR-014. AWS eu-central-1 (Frankfurt), pending DEC-07. Nothing is provisioned until the owner approves it; no account creation or spending is implied (master §0).

## 1. Topology (prod)
| Component | Service | Sizing at launch (≤ 50k registered) | Sizing at the 1M base case (doc 17) |
|---|---|---|---|
| Edge | CloudFront + AWS WAF (managed rules + rate rules) + Shield Standard | — | — |
| Load balancer | ALB (HTTP/2, WebSocket), 3 AZ | 1 | 1 (+ a separate ALB for realtime) |
| api | ECS Fargate | 2 × (1 vCPU, 2 GB) | 6–12 × (2 vCPU, 4 GB), autoscaled on CPU 55 % and p95 latency |
| realtime | ECS Fargate | 2 × (1 vCPU, 2 GB) | 4–8 × (2 vCPU, 4 GB); ~5–8k sockets per task (to be measured) |
| worker | ECS Fargate | 2 × (1 vCPU, 2 GB) | 4–8 (separate services: outbox/push, media, maintenance) |
| admin-api / admin-web | ECS Fargate, private | 1 + 1 | 2 + 2 |
| PostgreSQL | RDS PostgreSQL 17 **Multi-AZ DB cluster** (writer + 2 readable standbys, semi-sync; gp3/io2). At launch, plain Multi-AZ instance is acceptable | db.m7g.large (Multi-AZ instance) | db.r7g.2xlarge Multi-AZ DB cluster + 1 async read replica for analytics and admin (alias views only, doc 06 §1) |
| Valkey | ElastiCache (cluster mode, Multi-AZ) | cache.t4g.medium × 2 | cache.r7g.large × 3 shards |
| Object storage | S3 (SSE-KMS, versioning, lifecycle 90 d chat media) | — | ~3 TB chat media steady state + avatars |
| Email | SES (EU) | — | — |
| Secrets/keys | Secrets Manager + KMS CMKs | — | — |
| Push | APNs, FCM (outbound from worker via NAT) | — | — |
| Networking | VPC, private subnets, NAT gateways (one per AZ in prod), VPC endpoints (S3, ECR, Secrets, KMS) to cut NAT cost | — | — |

## 2. Environments
- `dev`: shared and ephemeral (preview stacks per PR for api and admin are optional), with seeded synthetic data.
- `staging`: production-like topology at a smaller scale, synthetic data only (**never** production PII), store sandbox environments, APNs sandbox.
- `prod`.
Each environment is a separate AWS account under AWS Organizations, with SCPs (deny root, deny regions other than eu-central-1 and the eu-west-1 backup region) and guardrails via IAM Identity Center.

## 3. Infrastructure as code
OpenTofu modules in `infra/` (network, ecs-service, rds, elasticache, s3-media, cdn, waf, observability, iam). Remote state in S3 with locking. Every change goes through PR, `tofu plan` posted to the PR, and manual approval for prod apply. Drift detection runs nightly.

## 4. CI/CD (GitHub Actions; OIDC to AWS, no static keys; actions pinned by SHA)
**PR pipeline (changed packages via Turborepo):**
- typecheck (`tsc --noEmit`), ESLint/Prettier, dependency-cruiser module rules
- unit tests (Vitest), property tests (fast-check), and the Python Shuffle reference when shuffle-core changes
- integration tests with Testcontainers PG17 + Valkey
- OpenAPI/AsyncAPI generation + `oasdiff` breaking-change check + forbidden-field contract tests
- migration lint (squawk) + apply against a fresh DB and a production-shaped snapshot (staging)
- security: gitleaks, Semgrep, OSV-Scanner/`pnpm audit`, license check, container scan (Trivy), SBOM

**Main → staging:** build images (distroless Node), push to ECR, deploy staging, run smoke E2E (Playwright admin, API flows), ZAP baseline nightly.

**Release → prod:** manual approval, then:
- DB migrations as a pre-deploy ECS task (expand phase only)
- rolling deploy (minimum healthy 100 %, circuit breaker with auto-rollback)
- post-deploy SLO watch for 30 min
- the contract phase of migrations in a later release

**Mobile:** EAS Build on tags. EAS Submit to TestFlight / Play internal. Staged store rollout (doc 13 §12).

## 5. Observability
- OpenTelemetry SDK in every service, and an OTel Collector sidecar that redacts PII (drops message bodies, email, phone, tokens) and exports to Grafana Cloud (EU).
- **Dashboards:** golden signals per service; SLOs (doc 17 §4); message commit latency; socket counts; push accept rates; store webhook lag; ledger reconciliation; Shuffle `selection_mode` mix, underfill and latency; DB (pg_stat_statements top queries, locks, replication lag, connections via RDS Proxy or pgbouncer).
- **Alerts:** burn-rate SLO alerts (multi-window). Paging only for user-facing SLO burn, ledger drift and security events. Everything else goes to tickets.
- Sentry for backend, mobile and admin errors. Scrubbing rules drop counterpart IDs.
- Runbooks in `docs/runbooks/` (M2+): DB failover, Valkey outage, push outage, store webhook backlog, ledger drift, CSAM detection, ATO wave, mass report spam, incident compensation.

## 6. Connection management
App tasks → **RDS Proxy** (or pgbouncer in transaction mode) to cap PG connections (target ≤ 400 server connections). Shuffle's REPEATABLE READ read-only transactions and the wallet's explicit locks are compatible with transaction pooling: no session state, and no advisory locks across transactions.

## 7. Backups and disaster recovery
| Item | Policy |
|---|---|
| RDS | PITR 35 days; daily snapshots copied to eu-west-1; monthly snapshot kept 1 year (encrypted, multi-region KMS key) |
| S3 media | versioning + lifecycle; cross-region replication (eu-west-1) for avatars, chat media (its 90-day lifecycle applies to the replica too) and legal-hold evidence. Users pay Gold to unlock chat media, so losing it in a region failure isn't acceptable. Replicating ~3 TB costs about $70/month in storage |
| Audit log | hourly export to S3 Object Lock (compliance mode) |
| **Targets** | AZ failure: automatic, RTO ≤ 5 min, RPO 0 (sync standby). Region loss: **RPO ≤ 15 min** (PITR log shipping lag plus snapshot copies), **RTO ≤ 24 h** (rebuild in eu-west-1 from IaC) |
| Drills | restore drill before launch and quarterly, with measured times recorded; game day for a Valkey outage and a PG failover before launch |

## 8. Cost estimate (list-price order of magnitude; **not a quote**, L-1)
| Phase | Infra (monthly) | Notes |
|---|---|---|
| Pre-launch (staging + dev) | $400–900 | small instances |
| Launch (≤ 50k registered) | $900–1,800 prod | Multi-AZ RDS, NAT gateways and WAF dominate |
| 1M registered, ~150k DAU (base) | $5,000–9,000 | RDS r7g.2xlarge Multi-AZ + replica ≈ 35–40 %; Fargate ≈ 20–25 %; CloudFront/S3 ≈ 10–15 %; ElastiCache ≈ 10 %; observability ≈ 10–15 % |
| Vendors (excluded above) | variable | moderation/CSAM scanning, age assurance (per check), SMS OTP (per message, risk-triggered only), Grafana/Sentry/PostHog tiers, Apple/Google developer accounts, legal |

Store commissions (15–30 %) dominate revenue-side cost and sit outside infrastructure.
