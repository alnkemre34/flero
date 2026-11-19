# FLERO build roadmap: "everything except integrations" (owner request, 2026-11-15)

The owner asked for:
- the complete product: a real backend "engine" that is stable and low latency
- premium screen flows and transitions, using the design skills per `CLAUDE.md`
- a full admin panel where the owner sets product, Gold and Boost/Plus prices

**Only external integrations stay as stubs behind interfaces:**
- Apple/Google store verification
- APNs/FCM push
- S3 media storage
- age-assurance vendor
- media-safety scanner
- email/SMS

**Decision recorded:** DEC-04 (prices) = owner-managed in the admin panel through versioned catalogs; the defaults are placeholders.

## Order (dependency-aware; check off as done)
1. [x] **api foundation:** `apps/api`
   - Fastify + zod type provider, config (env, validated), RFC 9457 errors, request id, pg pool, health, graceful shutdown
2. [x] **migration 0003:**
   - versioned catalogs (gold_product, media_unlock_price, boost_package, plus_plan, subscription bonus)
   - idempotency_record, staff_user/staff_session/role, approval
   - geo seed (İstanbul and districts, Ankara, İzmir)
   - `wallet_apply()` SECURITY DEFINER
3. [x] **auth:**
   - signup/login/refresh/logout/me, argon2id, EdDSA JWT (jose), opaque refresh rotation + reuse detection
   - tests on real PG (Testcontainers)
4. [x] **wallet engine:**
   - IAP credit (verifier interface + dev stub), 1-Gold gift via transit, media unlock (sink), Boost quote + activation transaction (doc 12 §5.3)
   - chargeback reversal (receivable model)
   - concurrency tests: double tap, parallel gifts, boost vs region change
5. [x] **social + conversations:**
   - follow/like/block (FULL + shield), profile with the oracle-free CTA, directional threads, send with seq + idempotency, receipts, sync
   - replay the conversation-model sequences against the API
6. [x] **realtime:** `apps/realtime`
   - ws gateway, auth frame, per-user channel, in-memory bus (dev) / Valkey (prod) interface
7. [x] **shuffle engine:**
   - directories (`discovery_resync`), capacity proof, `shuffle-core` allocator, post-check, response contract
   - latency benchmark (autocannon) on 100k+ seeded accounts
8. [x] **admin:**
   - `apps/admin-api` (staff auth, RBAC, audit, maker-checker for ledger and config)
   - `apps/admin` Next.js premium UI: dashboard, users, reports, catalogs and prices, Shuffle config + simulation, banners
9. [x] **mobile (core wiring):**
   - replace fixtures with the generated API client
   - onboarding (signup, age, consent, region), avatar editor (crop), shared-element transitions, skeletons
10. [ ] **verification:** full test suite, latency numbers, design review screenshots, docs and memory update

## Status (2026-11-15)
- Steps 1–7 DONE in `apps/api` (one codebase, three processes):
  - `src/index.ts`: the app API
  - `src/realtime/index.ts`: the ws gateway
  - `src/admin/index.ts`: the admin API
- Migrations 0003–0007 are applied; DB tests 40/40 pass.
- API tests 66/66 pass on real PG17:
  - auth, account, wallet, conversations, realtime, shuffle, admin
- Bench (`node bench/engine.bench.ts 100000`) on 100k accounts, p95:
  - Shuffle district 28 ms, small district 22 ms, city 19 ms
  - send message 22 ms, gift 34 ms, inbox 8 ms, sync 9 ms
  - ledger sum 0, drift 0
  - Evidence: `docs/architecture/evidence/engine_bench_2026-11-15.md`.
- Step 8 DONE: `apps/admin` (Next 16 BFF)
  - pages: login, dashboard, users (+ detail with moderation and Gold adjustment), reports, pricing (versioned, history), approvals (four-eyes), discovery (config + live simulation), banners, audit (chain verify), staff
  - `next build` passes; verified live in the browser against dev data
  - Dev stack:
    - `docker container flero-dev-pg` (127.0.0.1:5433)
    - seed: `DATABASE_URL=postgres://flero:flero@127.0.0.1:5433/flero node apps/api/src/dev/seed.ts`
    - `launch.json`: `api` :3000, `admin-api` :8181, `admin-web` :3100
    - Dev staff are listed in the seed file header.
- Step 9 DONE (core wiring), verified end-to-end in the web preview against the dev stack:
  - `src/api/{client,session,realtime}`: SecureStore refresh, single-flight refresh, React Query, ws with backoff
  - onboarding: welcome, signup, login, then onboarding (age, consents, region) through the session gate
  - screens on the real API: Discover (infinite Shuffle, filters), profile (follow, like, report/block), chat (optimistic idempotent send, receipts, accept/reject, gift, report/block), inbox, wallet (dev top-up), Boost (quote → activate), Plus (dev verify), notifications, own profile
- 2026-11-15 (later):
  - back works everywhere (`goBack` with fallback)
  - Turkish everywhere: `tools/i18n/audit.mjs` returns "complete"; caps use `upper()` (tr-TR), never textTransform
  - account: password change, forgot/reset password (dev mailer), e-mail code verify, remember me (mobile keychain vs memory; admin persistent vs session cookie)
  - notifications: all 14 types generated through `notify()`, prefs (push only; security always), realtime notification.new, in-app banner, tab badges, push outbox + worker (`src/worker`, APNs/FCM stub)
  - migration 0009
  - tests: API 72, contracts 60, DB 40
- Discover shows exactly one server batch (N = 10). "More" comes from Shuffle; there is no infinite scroll.
- Profile photo:
  - flow: ticket → multipart into quarantine → server sharp re-encode (512 WebP, EXIF/GPS stripped, crop validated) → random key
  - storage: DevStorage on local disk (`.dev-storage`); production is the S3 integration
  - image scanner stub; migration 0010
  - mobile: expo-image-picker with the native square crop; AvatarSheet on Profilim; real photos in cards, profile, chat and inbox (never for anonymous counterparts)
- NOT DONE / open:
  - photo send/unlock in chat (needs S3 + media pipeline); production S3 + image-safety vendor for avatars
  - Android APK rebuild now also needed for expo-image-picker
  - shared-element transitions
  - real e-mail sender (SES/Postmark) and APNs/FCM providers (integration)
  - mobile push-token registration (needs expo-notifications + FCM config)
  - KVKK export/deletion
  - Android APK rebuild (expo-secure-store adds a native module)
  - visual screenshot review: the browser pane was hidden, so no screenshots were taken
- Tests: 283 pass. `tsc` is clean in api, admin and mobile.
- Gaps still open:
  - media upload/unlock endpoints (needs the S3 stub)
  - notifications list/prefs endpoints
  - password reset / email verify (email stub)
  - OIDC
  - export/deletion (KVKK)

## Conventions
- Contracts come from `packages/contracts` (Zod). Every endpoint validates with them and serializes only allowed fields.
- Every economic write uses an Idempotency-Key and one DB transaction, with the lock order from doc 05 §4.
- Tests: Testcontainers PG17 (Docker Desktop must be running; start it if `docker info` fails).
- Windows notes: `docs/runbooks/android-local-build-windows.md`.
