import { randomUUID } from 'node:crypto';
import { ShuffleSampleResponse } from '@flero/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { select } from '../src/shuffle/engine.ts';
import { onboarded, startHarness, type Harness } from './harness.ts';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.stop(); });

/** Bulk-seeds discoverable accounts straight into the authoritative tables (triggers maintain the directory). */
export async function seed(h: Harness, n: number, city: number, district: number, gender: 'FEMALE' | 'MALE' | null = null) {
  const tag = randomUUID().slice(0, 6);
  await h.pool.query(
    `WITH a AS (
       INSERT INTO app.account (public_id, handle_norm, handle_display, gender, home_city_id, home_district_id, home_region_last_changed_at, age_assured_at)
       SELECT app.opaque_id('usr'), 's' || $5 || '_' || i, 's' || $5 || '_' || i,
              COALESCE($4::app.gender, CASE WHEN i % 2 = 0 THEN 'FEMALE' ELSE 'MALE' END::app.gender), $2, $3, now(), now()
         FROM generate_series(1, $1) i RETURNING id),
     p AS (INSERT INTO app.profile (account_id, display_name) SELECT id, 'Seed ' || id FROM a RETURNING account_id)
     INSERT INTO app.profile_counter (account_id) SELECT account_id FROM p`, [n, city, district, gender, tag]);
}

const shuffle = (u: { auth: Record<string, string> }, body: object) => h.app.inject({ method: 'POST', url: '/v1/shuffle/sample', headers: u.auth, payload: body });
const D = { mode: 'DISTRICT', gender: 'ALL' };

describe('directory maintenance (doc 11 §2): triggers keep pools exact', () => {
  it('onboarding, Plus, Boost, region change and suspension all resync; slots stay dense; no drift', async () => {
    const u = await onboarded(h, [35, 3501]);
    const pools = async () => (await h.pool.query<{ kind: string; district_id: number }>(
      'SELECT p.kind, p.district_id FROM app.pool_slot s JOIN app.pool p ON p.id = s.pool_id WHERE s.account_id = $1 ORDER BY p.kind', [u.id])).rows;
    expect(await pools()).toEqual([{ kind: 'MEMBER', district_id: 3501 }]);
    await h.pool.query(`INSERT INTO app.plus_entitlement (store, original_txn_id, account_id, valid_from, valid_until, state) VALUES ('APPLE', $1, $2, now(), now() + interval '30 days', 'ACTIVE')`, [`o-${u.id}`, u.id]);
    expect((await pools()).map((p) => p.kind)).toEqual(['MEMBER', 'REMOTE_ELIGIBLE']);
    await h.pool.query(`UPDATE app.account SET home_district_id = 3502 WHERE id = $1`, [u.id]);
    expect(await pools()).toEqual([{ kind: 'MEMBER', district_id: 3502 }, { kind: 'REMOTE_ELIGIBLE', district_id: 3502 }]);
    await h.pool.query(`UPDATE app.account SET state = 'SUSPENDED' WHERE id = $1`, [u.id]);
    expect(await pools()).toEqual([]);
    await seed(h, 40, 35, 3503);
    await h.pool.query(`UPDATE app.account SET discoverable = false WHERE id IN (SELECT id FROM app.account WHERE home_district_id = 3503 ORDER BY random() LIMIT 15)`);
    expect((await h.pool.query('SELECT * FROM app.discovery_drift()')).rows).toEqual([]);
  });
});

describe('request resolution (doc 11 §1)', () => {
  it('client overrides are refused before any selection; Standard is home-district + ALL only', async () => {
    const u = await onboarded(h);
    const over = await shuffle(u, { ...D, batch_size: 50 });
    expect(over.json()).toMatchObject({ status: 400, code: 'SHUFFLE_BATCH_SIZE_NOT_CLIENT_CONFIGURABLE' });
    expect((await shuffle(u, { mode: 'DISTRICT', gender: 'FEMALE' })).json().code).toBe('SHUFFLE_FILTER_REQUIRES_PLUS');
    expect((await shuffle(u, { mode: 'CITY', gender: 'ALL' })).json().code).toBe('SHUFFLE_SURFACE_NOT_ALLOWED');
    expect((await shuffle(u, { ...D, target_district_id: 'dst_3402' })).json().code).toBe('SHUFFLE_SURFACE_NOT_ALLOWED');
    expect((await shuffle(u, { ...D, extra: 1 })).json().code).toBe('VALIDATION_FAILED');
  });
});

describe('selection', () => {
  it('SPARSE_COMPLETE: every eligible profile exactly once, never the viewer or a blocked user, Boost first', async () => {
    const v = await onboarded(h, [6, 603]);
    const others = await Promise.all(Array.from({ length: 5 }, () => onboarded(h, [6, 603])));
    await h.app.inject({ method: 'PUT', url: `/v1/blocks/${others[0]!.pid}`, headers: { ...v.auth, 'idempotency-key': randomUUID() } });
    // a district Boost for others[1]
    await h.pool.query(`
      WITH q AS (INSERT INTO app.boost_quote (account_id, package_id, package_version, scope, city_id, district_id, price_gold, duration, home_region_version, expires_at)
                 VALUES ($1, 1, 1, 'DISTRICT', 6, 603, 1, '1 hour', 1, now() + interval '5 min') RETURNING id),
           t AS (INSERT INTO app.ledger_transaction (op_type, account_id, idempotency_key, payload_hash, actor) VALUES ('BOOST', $1, 'k', '\\x00', 'test') RETURNING id)
      INSERT INTO app.boost_entitlement (owner_id, scope, city_id, district_id, starts_at, ends_at, price_gold, gold_ledger_debit_id, quote_id)
      SELECT $1, 'DISTRICT', 6, 603, now(), now() + interval '1 hour', 1, t.id, q.id FROM q, t`, [others[1]!.id]);
    const res = await shuffle(v, D);
    expect(res.statusCode).toBe(200);
    const body = ShuffleSampleResponse.parse(res.json());
    expect(body).toMatchObject({ selection_mode: 'SPARSE_COMPLETE', completion: 'EXHAUSTED', has_more: false, applied: { shuffle_batch_size: 10, district_id: 'dst_603' } });
    const ids = body.items.map((i) => i.public_user_id).sort();
    expect(ids).toEqual(others.slice(1).map((o) => o.pid).sort());
    expect(body.items[0]).toMatchObject({ public_user_id: others[1]!.pid, placement: 'BOOST_BLOCK', card_badges: ['badge.promoted'] });
  });

  it('NORMAL over an enumerable pool: N unique cards, FULL, and every member is equally likely', async () => {
    const v = await onboarded(h, [34, 3407]);
    await seed(h, 29, 34, 3407);
    const res = ShuffleSampleResponse.parse((await shuffle(v, D)).json());
    expect(res).toMatchObject({ selection_mode: 'NORMAL', completion: 'FULL', has_more: true });
    expect(res.items).toHaveLength(10);
    // uniformity: 400 draws of 10 from 29 local members (remote pool is empty → all seats local)
    const counts = new Map<number, number>();
    for (let i = 0; i < 400; i++) {
      const s = await select(h.pool, v.id, { mode: 'DISTRICT', city: 34, district: 3407, genders: ['FEMALE', 'MALE'] }, { id: 1, n: 10, priorityBps: 3000, localBps: 7000 });
      for (const c of s.cards) counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
    }
    expect(counts.size).toBe(29);
    const expected = (400 * 10) / 29;
    const chi2 = [...counts.values()].reduce((s, o) => s + (o - expected) ** 2 / expected, 0);
    expect(chi2).toBeLessThan(56.9); // χ²(28) at p = 0.001
  });

  it('NORMAL over a large pool uses rejection sampling within the round-trip budget', async () => {
    const v = await onboarded(h, [34, 3408]);
    await seed(h, 3_000, 34, 3408);
    const t = performance.now();
    const s = await select(h.pool, v.id, { mode: 'DISTRICT', city: 34, district: 3408, genders: ['FEMALE', 'MALE'] }, { id: 1, n: 10, priorityBps: 3000, localBps: 7000 });
    const ms = performance.now() - t;
    expect(s.mode).toBe('NORMAL');
    expect(new Set(s.cards.map((c) => c.id)).size).toBe(10);
    expect(s.stats.enumerated).toBe(0); // never enumerated the big stratum
    expect(s.stats.roundTrips).toBeLessThan(12);
    expect(ms).toBeLessThan(250);
  });

  it('Plus viewer: gender filter and CITY mode work; response passes the contract’s semantic checks', async () => {
    const v = await onboarded(h, [34, 3405]);
    await h.pool.query(`INSERT INTO app.plus_entitlement (store, original_txn_id, account_id, valid_from, valid_until, state) VALUES ('APPLE', $1, $2, now(), now() + interval '30 days', 'ACTIVE')`, [`p-${v.id}`, v.id]);
    await seed(h, 30, 34, 3405, 'FEMALE');
    const f = ShuffleSampleResponse.parse((await shuffle(v, { mode: 'DISTRICT', gender: 'FEMALE' })).json());
    expect(f.items.every((i) => i.gender === 'FEMALE')).toBe(true);
    const c = ShuffleSampleResponse.parse((await shuffle(v, { mode: 'CITY', gender: 'ALL' })).json());
    expect(c.mode).toBe('CITY');
    expect(c.applied.district_id).toBeUndefined();
  });
});
