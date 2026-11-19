import {
  AgeAssuranceRequest, AgeAssuranceResult, City, ConsentRequest, District, HomeRegionRequest, Me, ProfilePatch, Session,
} from '@flero/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { loadMe } from '../auth/routes.ts';
import { withTx, type Tx } from '../db.ts';
import { err } from '../errors.ts';
import { idempotencyKey } from '../http.ts';
import type { Deps } from '../server.ts';

/** Current legal document versions; a bump forces re-consent (consents_current=false until accepted). */
export const CURRENT_DOCS = { TERMS: '2026-11', PRIVACY: '2026-11', COMMUNITY: '2026-11', MARKETING: '2026-11' } as const;
const HOME_REGION_COOLDOWN_DAYS = 30;

/** Age in whole years on today's date in Türkiye; the DOB itself never leaves this function (DEC-06). */
export function ageOn(dob: string, now = new Date()): number {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(now); // YYYY-MM-DD
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  const [y, m, d] = dob.split('-').map(Number) as [number, number, number];
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
}

const cityNum = (id: string) => Number(id.slice(4));
const districtNum = (id: string) => Number(id.slice(4));

async function setRegion(tx: Tx, accountId: number, body: { city_id: string; district_id: string }, initial: boolean) {
  const city = cityNum(body.city_id);
  const district = districtNum(body.district_id);
  const ok = await tx.query('SELECT 1 FROM app.district WHERE id = $1 AND city_id = $2', [district, city]);
  if (!ok.rows[0]) throw err.validation({ field: 'district_id' });
  // account row lock: serialises with Boost activation (which reads the region under the same lock)
  const { rows } = await tx.query<{ home_city_id: number | null; home_district_id: number | null; next_change: Date | null; age: Date | null }>(
    `SELECT home_city_id, home_district_id, home_region_last_changed_at + make_interval(days => $2) AS next_change, age_assured_at AS age
       FROM app.account WHERE id = $1 FOR UPDATE`, [accountId, HOME_REGION_COOLDOWN_DAYS]);
  const a = rows[0]!;
  if (initial) {
    if (!a.age) throw err.unavailable(); // order: signup → age → consents → region
    if (a.home_city_id !== null) {
      if (a.home_city_id === city && a.home_district_id === district) return; // idempotent retry
      throw err.conflict('HOME_REGION_CHANGE_TOO_SOON', a.next_change ? { next_change_at: a.next_change.toISOString() } : undefined);
    }
  } else {
    if (a.home_city_id === null) throw err.unavailable();
    if (a.home_city_id === city && a.home_district_id === district) return; // no-op, no clock reset
    if (a.next_change && a.next_change > new Date()) throw err.conflict('HOME_REGION_CHANGE_TOO_SOON', { next_change_at: a.next_change.toISOString() });
    const boost = await tx.query(
      `SELECT 1 FROM app.boost_entitlement WHERE owner_id = $1 AND state = 'ACTIVE' AND now() < ends_at LIMIT 1`, [accountId]);
    if (boost.rows[0]) throw err.conflict('HOME_REGION_LOCKED_BY_ACTIVE_BOOST'); // A§8.4: the purchased target never moves
  }
  await tx.query(
    `UPDATE app.account SET home_city_id = $2, home_district_id = $3, home_region_last_changed_at = now(),
            home_region_version = home_region_version + CASE WHEN $4 THEN 0 ELSE 1 END WHERE id = $1`,
    [accountId, city, district, initial]);
  await tx.query(
    'INSERT INTO app.home_region_change (account_id, from_city, from_district, to_city, to_district, actor) VALUES ($1, $2, $3, $4, $5, $6)',
    [accountId, a.home_city_id, a.home_district_id, city, district, 'user']);
  await tx.query("SELECT pg_notify('discovery_resync', $1)", [String(accountId)]); // directories pick up the move
}

export function accountRoutes(app: FastifyInstance, deps: Deps) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post('/v1/onboarding/age-assurance', { schema: { body: AgeAssuranceRequest, response: { 200: AgeAssuranceResult } } }, async (req) => {
    const age = ageOn(req.body.date_of_birth);
    if (age < 0 || age > 120) throw err.validation({ field: 'date_of_birth' });
    if (age < 18) return { age_assured: false, next_step: 'BLOCKED' as const }; // nothing about the DOB is persisted
    await deps.pool.query('UPDATE app.account SET age_assured_at = COALESCE(age_assured_at, now()) WHERE id = $1', [req.auth!.aid]);
    return { age_assured: true, next_step: 'NONE' as const };
  });

  r.post('/v1/onboarding/consents', { schema: { body: ConsentRequest } }, async (req, reply) => {
    idempotencyKey(req);
    for (const c of req.body.consents) if (CURRENT_DOCS[c.kind] !== c.doc_version) throw err.validation({ field: 'doc_version', kind: c.kind });
    await withTx(deps.pool, async (tx) => {
      for (const c of req.body.consents) {
        await tx.query(
          'INSERT INTO app.consent (account_id, kind, doc_version, locale) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
          [req.auth!.aid, c.kind, c.doc_version, req.body.locale]);
      }
    });
    reply.code(204).send();
  });

  r.post('/v1/onboarding/home-region', { schema: { body: HomeRegionRequest, response: { 200: Me } } }, async (req) => {
    idempotencyKey(req);
    return withTx(deps.pool, async (tx) => { await setRegion(tx, req.auth!.aid, req.body, true); return loadMe(tx, req.auth!.aid); });
  });

  r.put('/v1/me/home-region', { schema: { body: HomeRegionRequest, response: { 200: Me } } }, async (req) => {
    idempotencyKey(req);
    return withTx(deps.pool, async (tx) => { await setRegion(tx, req.auth!.aid, req.body, false); return loadMe(tx, req.auth!.aid); });
  });

  r.post('/v1/me/profile', { schema: { body: ProfilePatch, response: { 200: Me } } }, async (req) =>
    withTx(deps.pool, async (tx) => {
      const b = req.body;
      await tx.query(
        `UPDATE app.profile SET display_name = COALESCE($2, display_name),
                bio = CASE WHEN $3 THEN $4 ELSE bio END WHERE account_id = $1`,
        [req.auth!.aid, b.display_name?.trim() || null, b.bio !== undefined, b.bio?.trim() || null]);
      return loadMe(tx, req.auth!.aid);
    }));

  // ---------- sessions ----------
  r.get('/v1/me/sessions', { schema: { response: { 200: z.array(Session) } } }, async (req) => {
    const { rows } = await deps.pool.query<{ id: string; device_label: string | null; platform: string | null; created_at: Date; last_seen_at: Date }>(
      `SELECT id, device_label, platform, created_at, last_seen_at FROM app.session
        WHERE account_id = $1 AND revoked_at IS NULL ORDER BY last_seen_at DESC LIMIT 50`, [req.auth!.aid]);
    return rows.map((s) => ({
      session_id: s.id, device_label: s.device_label, platform: (s.platform ?? 'web') as 'ios' | 'android' | 'web',
      created_at: s.created_at.toISOString(), last_seen_at: s.last_seen_at.toISOString(), current: s.id === req.auth!.sid,
    }));
  });

  r.delete('/v1/me/sessions/:session_id', { schema: { params: z.strictObject({ session_id: z.uuid() }) } }, async (req, reply) => {
    const { rowCount } = await deps.pool.query(
      `WITH s AS (UPDATE app.session SET revoked_at = now() WHERE id = $1 AND account_id = $2 AND revoked_at IS NULL RETURNING id)
       SELECT pg_notify('flero_rt', json_build_object('a', $2::bigint, 't', 'session.revoked', 'sid', id::text)::text) FROM s`,
      [req.params.session_id, req.auth!.aid]);
    if (!rowCount) throw err.notFound();
    deps.sessions.invalidate(req.params.session_id);
    reply.code(204).send();
  });

  r.post('/v1/me/sessions/revoke-all', async (req, reply) => {
    idempotencyKey(req);
    await deps.pool.query(
      `WITH s AS (UPDATE app.session SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL RETURNING id)
       SELECT pg_notify('flero_rt', json_build_object('a', $1::bigint, 't', 'session.revoked', 'sid', id::text)::text) FROM s`, [req.auth!.aid]);
    deps.sessions.invalidateAll();
    reply.code(204).send();
  });

  // ---------- geo reference data (tiny, cacheable) ----------
  r.get('/v1/geo/cities', { schema: { response: { 200: z.array(City) } } }, async (_req, reply) => {
    const { rows } = await deps.pool.query<{ id: number; label_key: string }>('SELECT id, label_key FROM app.city ORDER BY id');
    reply.header('cache-control', 'private, max-age=3600');
    return rows.map((c) => ({ city_id: `cty_${c.id}`, label_key: c.label_key }));
  });

  r.get('/v1/geo/cities/:city_id/districts', { schema: { params: z.strictObject({ city_id: z.string().regex(/^cty_[0-9]{1,8}$/) }), response: { 200: z.array(District) } } }, async (req, reply) => {
    const city = cityNum(req.params.city_id);
    const { rows } = await deps.pool.query<{ id: number; label_key: string }>('SELECT id, label_key FROM app.district WHERE city_id = $1 ORDER BY label_key', [city]);
    if (!rows.length) throw err.notFound();
    reply.header('cache-control', 'private, max-age=3600');
    return rows.map((d) => ({ district_id: `dst_${d.id}`, city_id: req.params.city_id, label_key: d.label_key }));
  });
}
