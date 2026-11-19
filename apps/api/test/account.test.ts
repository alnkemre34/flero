import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ageOn, CURRENT_DOCS } from '../src/account/routes.ts';
import { signup, startHarness, type Harness } from './harness.ts';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.stop(); });

const idem = () => ({ 'idempotency-key': randomUUID() });
const post = (url: string, auth: Record<string, string>, payload: unknown, method: 'POST' | 'PUT' = 'POST') =>
  h.app.inject({ method, url, headers: { ...auth, ...idem() }, payload: payload as object });
const consents = { locale: 'tr', consents: (['TERMS', 'PRIVACY', 'COMMUNITY'] as const).map((kind) => ({ kind, doc_version: CURRENT_DOCS[kind] })) };

describe('age (DEC-06)', () => {
  it('computes age on the Türkiye calendar date', () => {
    expect(ageOn('2008-11-15', new Date('2026-11-14T22:30:00Z'))).toBe(18); // 01:30 on the 15th in Istanbul
    expect(ageOn('2008-11-16', new Date('2026-11-15T12:00:00Z'))).toBe(17);
  });

  it('under-18 is blocked and nothing is stored; 18+ is assured', async () => {
    const s = await signup(h.app);
    const kid = await post('/v1/onboarding/age-assurance', s.auth, { method: 'SELF_DECLARED_DOB', date_of_birth: '2015-01-01' });
    expect(kid.json()).toEqual({ age_assured: false, next_step: 'BLOCKED' });
    const adult = await post('/v1/onboarding/age-assurance', s.auth, { method: 'SELF_DECLARED_DOB', date_of_birth: '1995-05-05' });
    expect(adult.json()).toEqual({ age_assured: true, next_step: 'NONE' });
    const cols = await h.pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'app' AND column_name ILIKE '%birth%'`);
    expect(cols.rows).toEqual([]); // no DOB column anywhere
  });
});

describe('onboarding flow and the home-region rules (A§8.4)', () => {
  it('signup → age → consents → region completes onboarding', async () => {
    const s = await signup(h.app);
    expect((await post('/v1/onboarding/home-region', s.auth, { city_id: 'cty_34', district_id: 'dst_3401' })).statusCode).toBe(403); // age first
    await post('/v1/onboarding/age-assurance', s.auth, { method: 'SELF_DECLARED_DOB', date_of_birth: '1990-01-01' });
    expect((await post('/v1/onboarding/consents', s.auth, { locale: 'tr', consents: [{ kind: 'TERMS', doc_version: '1999-01' }] })).statusCode).toBe(400);
    expect((await post('/v1/onboarding/consents', s.auth, consents)).statusCode).toBe(204);
    const me = await post('/v1/onboarding/home-region', s.auth, { city_id: 'cty_34', district_id: 'dst_3402' });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ home_city_label_key: 'geo.city.istanbul', home_district_label_key: 'geo.district.besiktas',
      onboarding: { age_assured: true, consents_current: true, home_region_set: true } });
    // idempotent retry of the same initial choice
    expect((await post('/v1/onboarding/home-region', s.auth, { city_id: 'cty_34', district_id: 'dst_3402' })).statusCode).toBe(200);
  });

  it('rejects a district that is not in the chosen city', async () => {
    const s = await signup(h.app);
    await post('/v1/onboarding/age-assurance', s.auth, { method: 'SELF_DECLARED_DOB', date_of_birth: '1990-01-01' });
    expect((await post('/v1/onboarding/home-region', s.auth, { city_id: 'cty_6', district_id: 'dst_3401' })).statusCode).toBe(400);
  });

  it('a change inside 30 days is refused with the next allowed time; after 30 days it works; an active Boost locks it', async () => {
    const s = await signup(h.app);
    await post('/v1/onboarding/age-assurance', s.auth, { method: 'SELF_DECLARED_DOB', date_of_birth: '1990-01-01' });
    const me = (await post('/v1/onboarding/home-region', s.auth, { city_id: 'cty_34', district_id: 'dst_3401' })).json();
    const early = await post('/v1/me/home-region', s.auth, { city_id: 'cty_6', district_id: 'dst_601' }, 'PUT');
    expect(early.statusCode).toBe(409);
    expect(early.json()).toMatchObject({ code: 'HOME_REGION_CHANGE_TOO_SOON', params: { next_change_at: me.home_region_next_change_at } });

    await h.pool.query(`UPDATE app.account SET home_region_last_changed_at = now() - interval '31 days' WHERE public_id = $1`, [me.public_user_id]);
    const moved = await post('/v1/me/home-region', s.auth, { city_id: 'cty_6', district_id: 'dst_601' }, 'PUT');
    expect(moved.json().home_city_label_key).toBe('geo.city.ankara');

    // active Boost → locked even after the cooldown
    await h.pool.query(`UPDATE app.account SET home_region_last_changed_at = now() - interval '31 days' WHERE public_id = $1`, [me.public_user_id]);
    const { rows } = await h.pool.query<{ id: number }>('SELECT id FROM app.account WHERE public_id = $1', [me.public_user_id]);
    const id = rows[0]!.id;
    await h.pool.query(`
      WITH q AS (INSERT INTO app.boost_quote (account_id, package_id, package_version, scope, city_id, district_id, price_gold, duration, home_region_version, expires_at)
                 VALUES (${id}, 1, 1, 'DISTRICT', 6, 601, 1, '1 hour', 2, now() + interval '5 min') RETURNING id),
           t AS (INSERT INTO app.ledger_transaction (op_type, account_id, idempotency_key, payload_hash, actor) VALUES ('BOOST', ${id}, 'k', '\\x00', 'test') RETURNING id)
      INSERT INTO app.boost_entitlement (owner_id, scope, city_id, district_id, starts_at, ends_at, price_gold, gold_ledger_debit_id, quote_id)
      SELECT ${id}, 'DISTRICT', 6, 601, now(), now() + interval '1 hour', 1, t.id, q.id FROM q, t`);
    const locked = await post('/v1/me/home-region', s.auth, { city_id: 'cty_35', district_id: 'dst_3501' }, 'PUT');
    expect(locked.json().code).toBe('HOME_REGION_LOCKED_BY_ACTIVE_BOOST');
  });
});

describe('profile, sessions and geo', () => {
  it('edits display name and bio; lists and revokes sessions', async () => {
    const s = await signup(h.app);
    const me = await h.app.inject({ method: 'POST', url: '/v1/me/profile', headers: s.auth, payload: { display_name: '  Defne ', bio: 'Kahve ☕' } });
    expect(me.json()).toMatchObject({ display_name: 'Defne', bio: 'Kahve ☕' });
    const sessions = (await h.app.inject({ method: 'GET', url: '/v1/me/sessions', headers: s.auth })).json();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].current).toBe(true);
    expect((await h.app.inject({ method: 'POST', url: '/v1/me/sessions/revoke-all', headers: { ...s.auth, ...idem() } })).statusCode).toBe(204);
    expect((await h.app.inject({ method: 'GET', url: '/v1/me', headers: s.auth })).statusCode).toBe(401);
  });

  it('serves cities and districts', async () => {
    const s = await signup(h.app);
    const cities = (await h.app.inject({ method: 'GET', url: '/v1/geo/cities', headers: s.auth })).json();
    expect(cities.map((c: { city_id: string }) => c.city_id)).toEqual(['cty_6', 'cty_34', 'cty_35']);
    const d = (await h.app.inject({ method: 'GET', url: '/v1/geo/cities/cty_6/districts', headers: s.auth })).json();
    expect(d).toHaveLength(3);
    expect((await h.app.inject({ method: 'GET', url: '/v1/geo/cities/cty_99/districts', headers: s.auth })).statusCode).toBe(404);
  });
});
