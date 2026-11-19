import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTx } from '../src/db.ts';
import { fingerprint } from '../src/ids.ts';
import { devPayload } from '../src/wallet/iap.ts';
import { assertCanSpend, lockWallets, postLedger } from '../src/wallet/ledger.ts';
import { reverseStorePurchase } from '../src/wallet/routes.ts';
import { signup, startHarness, type Harness } from './harness.ts';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
  await h.pool.query(`
    INSERT INTO app.gold_product (store, product_id, version, gold_amount, created_by) VALUES ('APPLE', 'gold_100', 1, 100, 'seed'), ('APPLE', 'gold_500', 1, 500, 'seed');
    INSERT INTO app.boost_package (package_id, version, scope, duration, price_gold, created_by) VALUES (1, 1, 'DISTRICT', '1 hour', 50, 'seed'), (2, 1, 'CITY', '1 hour', 120, 'seed');
    INSERT INTO app.plus_plan (plan_id, version, period, store, product_id, bonus_gold, created_by) VALUES ('plus_monthly_ios', 1, 'MONTHLY', 'APPLE', 'flero.plus.monthly', 20, 'seed');`);
});
afterAll(async () => { await h?.stop(); });

async function user() {
  const s = await signup(h.app);
  const me = (await h.app.inject({ method: 'GET', url: '/v1/me', headers: s.auth })).json();
  const { rows } = await h.pool.query<{ id: number }>(
    `UPDATE app.account SET home_city_id = 34, home_district_id = 3401, home_region_last_changed_at = now() WHERE public_id = $1 RETURNING id`, [me.public_user_id]);
  return { ...s, id: rows[0]!.id };
}
const idem = () => ({ 'idempotency-key': randomUUID() });
const buy = (u: { auth: Record<string, string> }, storeTxn: string, product = 'gold_100') =>
  h.app.inject({ method: 'POST', url: '/v1/wallet/purchases/verify', headers: { ...u.auth, ...idem() }, payload: { platform: 'APPLE', signed_payload: devPayload({ store_txn_id: storeTxn, product_id: product }) } });
const wallet = async (u: { auth: Record<string, string> }) => (await h.app.inject({ method: 'GET', url: '/v1/wallet', headers: u.auth })).json();
const quote = (u: { auth: Record<string, string> }, package_id = 1, scope = 'DISTRICT') =>
  h.app.inject({ method: 'POST', url: '/v1/boosts/quotes', headers: u.auth, payload: { package_id, scope } });
const activate = (u: { auth: Record<string, string> }, quote_id: string, key = randomUUID()) =>
  h.app.inject({ method: 'POST', url: '/v1/boosts/activations', headers: { ...u.auth, 'idempotency-key': key }, payload: { quote_id } });

describe('Gold top-up (REQ-GLD-02): exactly once per store transaction', () => {
  it('credits once, replays are no-ops, and another account cannot claim the same receipt', async () => {
    const a = await user();
    const t = `apple-${randomUUID()}`;
    expect((await buy(a, t)).json().available).toBe(100);
    expect((await buy(a, t)).json().available).toBe(100);
    const b = await user();
    expect((await buy(b, t)).statusCode).toBe(409);
    expect((await wallet(b)).available).toBe(0);
  });

  it('20 concurrent verifications of one receipt credit exactly once', async () => {
    const a = await user();
    const t = `apple-${randomUUID()}`;
    const res = await Promise.all(Array.from({ length: 20 }, () => buy(a, t, 'gold_500')));
    expect(res.every((r) => r.statusCode === 200)).toBe(true);
    expect((await wallet(a)).available).toBe(500);
  });

  it('requires an Idempotency-Key and rejects unknown products', async () => {
    const a = await user();
    const noKey = await h.app.inject({ method: 'POST', url: '/v1/wallet/purchases/verify', headers: a.auth, payload: { platform: 'APPLE', signed_payload: devPayload({ store_txn_id: 'x1', product_id: 'gold_100' }) } });
    expect(noKey.statusCode).toBe(400);
    expect((await buy(a, `apple-${randomUUID()}`, 'gold_nope')).statusCode).toBe(400);
  });
});

describe('ledger engine invariants', () => {
  it('never overspends under concurrency: 10 parallel 30-Gold debits from 100 → exactly 3 succeed', async () => {
    const a = await user();
    await buy(a, `apple-${randomUUID()}`);
    const debit = (i: number) => withTx(h.pool, async (tx) => {
      assertCanSpend((await lockWallets(tx, [a.id])).get(a.id), 30);
      await postLedger(tx, { op: 'UNLOCK', account: a.id, key: `t-${i}`, hash: fingerprint({ i }), actor: 'test',
        postings: [{ account: 'USER_AVAILABLE', owner: a.id, amount: -30 }, { account: 'SYS_SINK_UNLOCK', amount: 30 }] });
    }).then(() => 'ok', (e) => e.code);
    const out = await Promise.all(Array.from({ length: 10 }, (_, i) => debit(i)));
    expect(out.filter((o) => o === 'ok')).toHaveLength(3);
    expect(out.filter((o) => o === 'INSUFFICIENT_GOLD')).toHaveLength(7);
    expect((await wallet(a)).available).toBe(10);
  });

  it('the same key with a different payload is rejected (no silent double charge)', async () => {
    const a = await user();
    await buy(a, `apple-${randomUUID()}`);
    const post = (amount: number) => withTx(h.pool, async (tx) => {
      await lockWallets(tx, [a.id]);
      return postLedger(tx, { op: 'UNLOCK', account: a.id, key: 'same', hash: fingerprint({ amount }), actor: 'test',
        postings: [{ account: 'USER_AVAILABLE', owner: a.id, amount: -amount }, { account: 'SYS_SINK_UNLOCK', amount }] });
    });
    expect((await post(10)).replayed).toBe(false);
    expect((await post(10)).replayed).toBe(true);
    await expect(post(20)).rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
    expect((await wallet(a)).available).toBe(90);
  });

  it('chargeback takes back what is left and books the rest as debt; the next top-up settles it', async () => {
    const a = await user();
    const t = `apple-${randomUUID()}`;
    await buy(a, t);
    const q = (await quote(a)).json();
    expect((await activate(a, q.quote_id)).statusCode).toBe(201); // spent 50 of the 100
    expect(await reverseStorePurchase(h.pool, 'APPLE', t, 'test')).toMatchObject({ reversed: true, fromAvailable: 50, toDebt: 50 });
    expect(await reverseStorePurchase(h.pool, 'APPLE', t, 'test')).toEqual({ reversed: false }); // idempotent
    expect(await wallet(a)).toEqual({ available: 0, restricted: true, restriction_key: 'wallet.restriction.debt' });
    expect((await buy(a, `apple-${randomUUID()}`)).json()).toEqual({ available: 50, restricted: false, restriction_key: null });
  });

  it('books balance globally: every posting ever written sums to zero', async () => {
    const { rows } = await h.pool.query<{ s: number }>('SELECT COALESCE(SUM(amount), 0)::bigint AS s FROM app.ledger_posting');
    expect(rows[0]!.s).toBe(0);
    const drift = await h.pool.query(`
      SELECT w.account_id FROM app.wallet w
       LEFT JOIN app.ledger_account la ON la.owner_id = w.account_id AND la.kind = 'USER_AVAILABLE'
       LEFT JOIN LATERAL (SELECT COALESCE(SUM(amount), 0) s FROM app.ledger_posting p WHERE p.ledger_account_id = la.id) x ON true
      WHERE w.available <> COALESCE(x.s, 0)`);
    expect(drift.rows).toEqual([]); // wallet projection == ledger truth
  });
});

describe('Boost (A§8.7–8.8)', () => {
  it('quote → activate debits once; replay with the same key returns the same Boost', async () => {
    const a = await user();
    await buy(a, `apple-${randomUUID()}`);
    const q = (await quote(a)).json();
    expect(q).toMatchObject({ scope: 'DISTRICT', price_gold: 50, target_district_label_key: 'geo.district.kadikoy', available_gold: 100, survives_plus_expiry: true });
    const key = randomUUID();
    const first = await activate(a, q.quote_id, key);
    expect(first.statusCode).toBe(201);
    expect(first.json().balance_after).toBe(50);
    const again = await activate(a, q.quote_id, key);
    expect(again.json().boost_id).toBe(first.json().boost_id);
    expect((await wallet(a)).available).toBe(50);
    const poll = await h.app.inject({ method: 'GET', url: `/v1/boosts/activations/${key}`, headers: a.auth });
    expect(poll.json()).toMatchObject({ state: 'SUCCEEDED', boost: { boost_id: first.json().boost_id } });
    expect((await h.app.inject({ method: 'GET', url: '/v1/me/boost', headers: a.auth })).json().active.boost_id).toBe(first.json().boost_id);
  });

  it('a second overlapping Boost is refused and nothing is charged', async () => {
    const a = await user();
    await buy(a, `apple-${randomUUID()}`);
    await activate(a, (await quote(a)).json().quote_id);
    const second = await activate(a, (await quote(a)).json().quote_id);
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('BOOST_ALREADY_ACTIVE');
    expect((await wallet(a)).available).toBe(50);
  });

  it('a spent quote cannot be reused with another key; insufficient Gold is a 402', async () => {
    const a = await user();
    const q = (await quote(a)).json();
    const poor = await activate(a, q.quote_id);
    expect(poor.statusCode).toBe(402);
    await buy(a, `apple-${randomUUID()}`);
    expect((await activate(a, q.quote_id)).statusCode).toBe(201);
    expect((await activate(a, q.quote_id)).json().code).toBe('BOOST_QUOTE_EXPIRED');
  });

  it('a region change after quoting makes the quote stale', async () => {
    const a = await user();
    await buy(a, `apple-${randomUUID()}`);
    const q = (await quote(a)).json();
    await h.pool.query('UPDATE app.account SET home_region_version = home_region_version + 1 WHERE id = $1', [a.id]);
    expect((await activate(a, q.quote_id)).json().code).toBe('BOOST_QUOTE_STALE_REGION');
  });

  it('CITY scope needs Plus; Standard catalog shows DISTRICT only', async () => {
    const a = await user();
    const cat = (await h.app.inject({ method: 'GET', url: '/v1/boosts/catalog', headers: a.auth })).json();
    expect(cat.packages.map((p: { scope: string }) => p.scope)).toEqual(['DISTRICT']);
    expect(cat.disclosure_keys).toEqual(['boost.disclosure.viewer_dependent', 'boost.disclosure.no_guarantee']);
    const city = await quote(a, 2, 'CITY');
    expect(city.statusCode).toBe(403);
    expect(city.json().code).toBe('BOOST_SCOPE_REQUIRES_PLUS');
  });
});

describe('Plus subscriptions', () => {
  it('verify activates Plus, grants the bonus once per renewal, and unlocks CITY Boost', async () => {
    const a = await user();
    const exp = new Date(Date.now() + 30 * 86400_000).toISOString();
    const pay = (t: string) => ({ platform: 'APPLE', signed_payload: devPayload({ store_txn_id: t, original_txn_id: `orig-${a.id}`, product_id: 'flero.plus.monthly', expires_at: exp }) });
    const v1 = await h.app.inject({ method: 'POST', url: '/v1/plus/verify', headers: { ...a.auth, ...idem() }, payload: pay(`r1-${a.id}`) });
    expect(v1.json()).toMatchObject({ active: true, state: 'ACTIVE' });
    await h.app.inject({ method: 'POST', url: '/v1/plus/verify', headers: { ...a.auth, ...idem() }, payload: pay(`r1-${a.id}`) });
    expect((await wallet(a)).available).toBe(20);
    const me = (await h.app.inject({ method: 'GET', url: '/v1/me', headers: a.auth })).json();
    expect(me.membership_tier).toBe('PLUS');
    expect((await quote(a, 2, 'CITY')).statusCode).toBe(201);
  });
});

describe('wallet history', () => {
  it('lists newest first with cursor pagination', async () => {
    const a = await user();
    for (let i = 0; i < 3; i++) await buy(a, `apple-${randomUUID()}`);
    const p1 = await h.app.inject({ method: 'GET', url: '/v1/wallet/transactions?limit=2', headers: a.auth });
    expect(p1.json()).toHaveLength(2);
    expect(p1.json()[0]).toMatchObject({ kind: 'TOP_UP', amount: 100, counterparty: null });
    expect(p1.json()[0].transaction_id).toMatch(/^txn_[a-z2-7]{26}$/);
    const next = p1.headers['x-next-cursor'] as string;
    const p2 = await h.app.inject({ method: 'GET', url: `/v1/wallet/transactions?limit=2&cursor=${next}`, headers: a.auth });
    expect(p2.json()).toHaveLength(1);
    expect(p2.headers['x-next-cursor']).toBeUndefined();
  });
});
