# FLERO — project instructions

Global engineering policy (risk classes, specialist routing, contracts, evidence vocabulary, security) comes from the
user-level `~/.claude/CLAUDE.md` (TITAN OS v7). This file adds only what is specific to FLERO and never relaxes the
global rules. It replaces an older copy of a global "V5 policy" that conflicted with TITAN v7.

## Product authority
- Spec: `FLERO_MASTER_SPEC.md` (product) + its Appendix A "Shuffle V5.2". Architecture: `docs/architecture/00–21`.
- **Owner decision (2026-11): district/city discovery is REMOVED.** Target: Turkey-wide Shuffle, one Turkey-wide Boost,
  no regional limits or region-change locks. No V6.1 spec exists yet; the Turkey-wide algorithm, Boost quota/pricing,
  Plus advantage, location-on-profile and the cutover of active regional Boosts are OPEN owner decisions (see the
  2026-11 audit). Until the P2 conversion is approved: do not change the Shuffle algorithm, do not add new code that
  depends on district/city, do not delete regional code or columns, never edit financial Boost history.
- UI language Turkish (`apps/mobile/src/i18n/tr.ts`, check with `node tools/i18n/audit.mjs`); code and docs English.

## Stack and layout (pnpm monorepo, `nodeLinker: hoisted`)
- `apps/api` Fastify 5 + zod, Node 26 type stripping (`erasableSyntaxOnly`: no parameter properties, no enums).
  Entries: `src/index.ts` (API + realtime gateway in development), `src/realtime/index.ts`, `src/admin/index.ts`
  (admin API, port 8181), `src/worker/index.ts`.
- `packages/db` SQL migrations `NNNN_name.sql` (+ hand-applied `.down.sql`), runner `src/migrate.ts`. Never edit an
  applied migration; add a new one. Money tables are written only through `app.post_ledger`.
- `packages/contracts` zod contracts + generated OpenAPI/AsyncAPI: after any contract change run
  `pnpm --filter @flero/contracts generate` (a drift test fails otherwise).
- `packages/shuffle-core` allocator; `tools/shuffle-reference` Python reference implementation.
- `apps/mobile` Expo SDK 58 / RN 0.88 (Reanimated 4, React Query, expo-sqlite+SQLCipher, SecureStore).
- `apps/admin` Next.js admin web (BFF cookie session).

## Running and testing
- Dev DB: Docker container `flero-dev-pg` on port 5433; API and DB tests use Testcontainers, so **Docker Desktop must
  be running** (otherwise suites report "Could not find a working container runtime strategy" = BLOCKED, not FAIL).
- Gates: `pnpm -r typecheck`, `pnpm -r --no-bail test`, `pnpm test:reference` (Python), mobile pure tests
  `node --test <file>.test.ts`, `pnpm audit`. No ESLint config exists yet; gitleaks is not installed.
- Dev servers come from `.claude/launch.json` (api 3000, mobile-web 8081, admin-api 8181, admin-web 3100). Stop dev
  servers before `pnpm install`. Dev seed/migrate: `node apps/api/src/dev/seed.ts` against the local dev DB only.

## FLERO-specific invariants
- Integrations are deliberate stubs until wired: IAP verifier, push (APNs/FCM), S3 storage, mailer, age vendor, image
  scanner. Non-development environments must never fall back to the dev stubs.
- Anonymous messaging: never expose the initiator's identity before reveal (API payloads, realtime events,
  notifications, errors, timing). Non-participants get the same 404 as a missing id.
- Gold: immutable ledger, idempotent keys, wallets locked in ascending account id order, compensating entries only.
- Commit only when the owner asks; never push.
