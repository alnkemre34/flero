import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashStaffPassword } from '../src/admin/routes.ts';
import { buildAdminServer } from '../src/admin/server.ts';
import { TokenService } from '../src/auth/tokens.ts';
import { loadConfig } from '../src/config.ts';
import { onboarded, startHarness, type Harness } from './harness.ts';

let h: Harness;
let admin: FastifyInstance;
const PW = 'correct-horse-battery-staple';
const tok: Record<string, string> = {};

beforeAll(async () => {
  h = await startHarness();
  const cfg = loadConfig({ NODE_ENV: 'test', DATABASE_URL: h.container.getConnectionUri() });
  admin = buildAdminServer({ cfg, pool: h.pool, tokens: await TokenService.create({ ...cfg, JWT_ISSUER: `${cfg.JWT_ISSUER}:admin` }) });
  await admin.ready();
  const pw = await hashStaffPassword(PW);
  for (const [who, roles] of [['owner', ['SUPERADMIN']], ['maker', ['FINANCE_OPERATOR', 'FINANCE_VIEWER']], ['checker', ['FINANCE_APPROVER', 'FINANCE_VIEWER']], ['mod', ['MODERATOR']], ['aud', ['AUDITOR']]] as const) {
    await h.pool.query('INSERT INTO app.staff_user (email, display_name, password_hash, roles) VALUES ($1, $2, $3, $4)', [`${who}@flero.test`, who, pw, roles]);
    const res = await admin.inject({ method: 'POST', url: '/admin/v1/auth/login', payload: { email: `${who}@flero.test`, password: PW } });
    tok[who] = res.json().token;
  }
});
afterAll(async () => { await admin?.close(); await h?.stop(); });

const as = (who: string, method: 'GET' | 'POST', url: string, payload?: object) =>
  admin.inject({ method, url, headers: { authorization: `Bearer ${tok[who]}` }, ...(payload ? { payload } : {}) });

describe('admin auth and RBAC (ADR-013)', () => {
  it('wrong password is a generic 401; app tokens never work on the admin plane and vice versa', async () => {
    expect((await admin.inject({ method: 'POST', url: '/admin/v1/auth/login', payload: { email: 'owner@flero.test', password: 'nope-nope-nope' } })).statusCode).toBe(401);
    const u = await onboarded(h);
    expect((await admin.inject({ method: 'GET', url: '/admin/v1/me', headers: u.auth })).statusCode).toBe(401);
    expect((await h.app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${tok.owner}` } })).statusCode).toBe(401);
    const me = (await as('mod', 'GET', '/admin/v1/me')).json();
    expect(me.permissions).toContain('reports.resolve');
    expect(me.permissions).not.toContain('catalog.write');
  });

  it('a moderator cannot change prices; logout revokes the staff session', async () => {
    expect((await as('mod', 'POST', '/admin/v1/catalog/gold-products', { store: 'APPLE', product_id: 'gold_x', gold_amount: 5, reason: 'try it out' })).statusCode).toBe(403);
    const res = await admin.inject({ method: 'POST', url: '/admin/v1/auth/login', payload: { email: 'aud@flero.test', password: PW } });
    const t = res.json().token;
    await admin.inject({ method: 'POST', url: '/admin/v1/auth/logout', headers: { authorization: `Bearer ${t}` } });
    expect((await admin.inject({ method: 'GET', url: '/admin/v1/me', headers: { authorization: `Bearer ${t}` } })).statusCode).toBe(401);
  });
});

describe('pricing from the admin panel (DEC-04)', () => {
  it('Gold packs: every change is a new immutable version and the app sees it immediately', async () => {
    const v1 = await as('owner', 'POST', '/admin/v1/catalog/gold-products', { store: 'APPLE', product_id: 'gold_250', gold_amount: 250, reason: 'launch pack' });
    expect(v1.json()).toMatchObject({ version: 1, gold_amount: 250, active: true });
    const v2 = await as('owner', 'POST', '/admin/v1/catalog/gold-products', { store: 'APPLE', product_id: 'gold_250', gold_amount: 300, reason: 'campaign +20%' });
    expect(v2.json()).toMatchObject({ version: 2, gold_amount: 300 });
    const u = await onboarded(h);
    const products = (await h.app.inject({ method: 'GET', url: '/v1/store/products?platform=APPLE', headers: u.auth })).json();
    expect(products).toContainEqual({ product_id: 'gold_250', platform: 'APPLE', gold_amount: 300 });
    const hist = (await as('owner', 'GET', '/admin/v1/catalog/history?kind=gold_product&key=gold_250')).json();
    expect(hist.map((x: { version: number; value: number }) => [x.version, x.value])).toEqual([[2, 300], [1, 250]]);
    // retiring hides it from the store list
    await as('owner', 'POST', '/admin/v1/catalog/gold-products', { store: 'APPLE', product_id: 'gold_250', gold_amount: 300, active: false, reason: 'end of campaign' });
    const after = (await h.app.inject({ method: 'GET', url: '/v1/store/products?platform=APPLE', headers: u.auth })).json();
    expect(after.find((p: { product_id: string }) => p.product_id === 'gold_250')).toBeUndefined();
  });

  it('Boost price change never alters a quote already issued (immutable at purchase, A§8.7)', async () => {
    const pkg = (await as('owner', 'POST', '/admin/v1/catalog/boost-packages', { scope: 'DISTRICT', duration_minutes: 60, price_gold: 40, reason: 'district 1h' })).json();
    await h.pool.query(`INSERT INTO app.gold_product (store, product_id, version, gold_amount, created_by) VALUES ('APPLE', 'gold_100', 1, 100, 'seed') ON CONFLICT DO NOTHING`);
    const u = await onboarded(h);
    await h.app.inject({ method: 'POST', url: '/v1/wallet/purchases/verify', headers: { ...u.auth, 'idempotency-key': randomUUID() }, payload: { platform: 'APPLE', signed_payload: `dev.${Buffer.from(JSON.stringify({ store_txn_id: `adm-${u.id}`, product_id: 'gold_100' })).toString('base64url')}` } });
    const quote = (await h.app.inject({ method: 'POST', url: '/v1/boosts/quotes', headers: u.auth, payload: { package_id: pkg.package_id, scope: 'DISTRICT' } })).json();
    await as('owner', 'POST', '/admin/v1/catalog/boost-packages', { package_id: pkg.package_id, scope: 'DISTRICT', duration_minutes: 60, price_gold: 90, reason: 'raise price' });
    const act = await h.app.inject({ method: 'POST', url: '/v1/boosts/activations', headers: { ...u.auth, 'idempotency-key': randomUUID() }, payload: { quote_id: quote.quote_id } });
    expect(act.json()).toMatchObject({ price_gold: 40, balance_after: 60 });
    const cat = (await as('owner', 'GET', '/admin/v1/catalog')).json();
    expect(cat.boost_packages.find((p: { package_id: number }) => p.package_id === pkg.package_id)).toMatchObject({ version: 2, price_gold: 90 });
  });

  it('unlock prices and Plus plans are versioned too', async () => {
    expect((await as('owner', 'POST', '/admin/v1/catalog/unlock-prices', { kind: 'ONE_VIEW', price_gold: 3, reason: 'launch price' })).json()).toMatchObject({ version: 1, price_gold: 3 });
    expect((await as('owner', 'POST', '/admin/v1/catalog/plus-plans', { plan_id: 'plus_m_ios', period: 'MONTHLY', store: 'APPLE', product_id: 'flero.plus.m', bonus_gold: 30, reason: 'launch plan' })).json()).toMatchObject({ version: 1, bonus_gold: 30 });
  });
});

describe('money needs four eyes', () => {
  it('maker requests, maker cannot approve, checker approves → Gold moves exactly once', async () => {
    const u = await onboarded(h);
    const req = await as('maker', 'POST', `/admin/v1/users/${u.pid}/gold-adjustments`, { amount: 50, reason: 'compensation for outage' });
    expect(req.statusCode).toBe(201);
    const id = req.json().approval_id;
    expect((await as('maker', 'POST', `/admin/v1/approvals/${id}/decision`, { decision: 'APPROVED' })).statusCode).toBe(403);
    expect((await as('checker', 'POST', `/admin/v1/approvals/${id}/decision`, { decision: 'APPROVED' })).statusCode).toBe(200);
    expect((await as('checker', 'POST', `/admin/v1/approvals/${id}/decision`, { decision: 'APPROVED' })).statusCode).toBe(409);
    expect((await h.app.inject({ method: 'GET', url: '/v1/wallet', headers: u.auth })).json().available).toBe(50);
    const detail = (await as('owner', 'GET', `/admin/v1/users/${u.pid}`)).json();
    expect(detail).toMatchObject({ gold: 50, ledger: [{ op_type: 'ADMIN_GRANT', amount: 50 }] });
  });
});

describe('moderation', () => {
  it('suspending a user signs them out and removes them from discovery; reports resolve with an action', async () => {
    const a = await onboarded(h); const b = await onboarded(h);
    const cid = (await h.app.inject({ method: 'POST', url: '/v1/conversations', headers: { ...a.auth, 'idempotency-key': randomUUID() }, payload: { recipient: b.pid, first_message: { client_msg_id: randomUUID(), body: 'spam spam' } } })).json().conversation_id;
    await h.app.inject({ method: 'POST', url: '/v1/reports', headers: { ...b.auth, 'idempotency-key': randomUUID() }, payload: { target: { type: 'CONVERSATION', id: cid }, reason: 'SPAM' } });
    const queue = (await as('mod', 'GET', '/admin/v1/reports')).json();
    const rep = queue.find((x: { target_public_id: string }) => x.target_public_id === a.pid);
    expect(rep).toMatchObject({ reason: 'SPAM', target_type: 'CONVERSATION' });
    expect(rep.reporter_alias).toMatch(/^[0-9a-f]{12}$/); // never the reporter's id
    expect((await as('mod', 'POST', `/admin/v1/reports/${rep.public_id}/resolve`, { action: 'SUSPEND_TARGET', note: 'confirmed spam' })).json()).toEqual({ status: 'ACTIONED' });
    expect((await h.app.inject({ method: 'GET', url: '/v1/me', headers: a.auth })).statusCode).toBe(401);
    const pools = await h.pool.query('SELECT 1 FROM app.pool_slot WHERE account_id = $1', [a.id]);
    expect(pools.rows).toEqual([]);
    expect((await as('mod', 'POST', `/admin/v1/users/${a.pid}/state`, { state: 'ACTIVE', reason: 'appeal accepted' })).json()).toEqual({ state: 'ACTIVE' });
  });
});

describe('discovery config, simulation, banners, audit', () => {
  it('rejects out-of-bounds configs, activates valid ones, and simulates on live data', async () => {
    expect((await as('owner', 'POST', '/admin/v1/discovery/config', { shuffle_batch_size: 12, priority_bps: 3000, local_bps: 7000, reason: 'try odd size' })).statusCode).toBe(400);
    const ok = await as('owner', 'POST', '/admin/v1/discovery/config', { shuffle_batch_size: 15, priority_bps: 2000, local_bps: 8000, reason: 'bigger batches' });
    expect(ok.json()).toMatchObject({ shuffle_batch_size: 15, priority_bps: 2000 });
    const viewer = await onboarded(h);
    const res = (await h.app.inject({ method: 'POST', url: '/v1/shuffle/sample', headers: viewer.auth, payload: { mode: 'DISTRICT', gender: 'ALL' } })).json();
    expect(res.applied.shuffle_batch_size).toBe(15);
    const sim = (await as('owner', 'POST', '/admin/v1/discovery/simulate', { shuffle_batch_size: 10, priority_bps: 3000, local_bps: 7000, district_id: 3401, runs: 10 })).json();
    expect(sim).toMatchObject({ runs: 10 });
    expect(sim.latency_ms.p95).toBeGreaterThan(0);
  });

  it('banners: only allowlisted destinations; live ones reach the app', async () => {
    const bad = await as('owner', 'POST', '/admin/v1/banners', { image_url: 'https://cdn.flero.app/b.png', alt_key: 'banner.plus', destination: 'https://evil.example', sponsored: false, ends_at: new Date(Date.now() + 86400_000).toISOString() });
    expect(bad.statusCode).toBe(400);
    const good = await as('owner', 'POST', '/admin/v1/banners', { image_url: 'https://cdn.flero.app/b.png', alt_key: 'banner.plus', destination: 'flero://plus', sponsored: true, ends_at: new Date(Date.now() + 86400_000).toISOString() });
    expect(good.statusCode).toBe(201);
    const u = await onboarded(h);
    const list = (await h.app.inject({ method: 'GET', url: '/v1/home/banners', headers: u.auth })).json();
    expect(list).toContainEqual(expect.objectContaining({ banner_id: good.json().public_id, destination: 'flero://plus', sponsored: true }));
  });

  it('every action is in the hash-chained audit, and the chain verifies', async () => {
    const log = (await as('aud', 'GET', '/admin/v1/audit?limit=100')).json();
    expect(log.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(['catalog.gold_product', 'approval.approved', 'report.suspend_target', 'discovery.config', 'banner.create']));
    expect((await as('aud', 'GET', '/admin/v1/audit/verify')).json()).toMatchObject({ ok: true });
    // tampering is detectable even by a superuser who bypasses the append-only trigger
    await h.pool.query('ALTER TABLE app.audit_event DISABLE TRIGGER audit_append_only');
    await h.pool.query(`UPDATE app.audit_event SET reason = 'edited' WHERE id = (SELECT min(id) FROM app.audit_event WHERE reason IS NOT NULL)`);
    await h.pool.query('ALTER TABLE app.audit_event ENABLE TRIGGER audit_append_only');
    expect((await as('aud', 'GET', '/admin/v1/audit/verify')).json().ok).toBe(false);
  });

  it('dashboard aggregates', async () => {
    const d = (await as('owner', 'GET', '/admin/v1/dashboard')).json();
    expect(d.accounts).toBeGreaterThan(0);
    expect(d.signups_daily).toHaveLength(14);
  });
});
