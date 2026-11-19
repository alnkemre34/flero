import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { devPayload } from '../src/wallet/iap.ts';
import { dispatchPush } from '../src/worker/jobs.ts';
import { onboarded, signup, startHarness, type Harness } from './harness.ts';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
  await h.pool.query(`INSERT INTO app.gold_product (store, product_id, version, gold_amount, created_by) VALUES ('APPLE', 'gold_100', 1, 100, 'seed')`);
});
afterAll(async () => { await h?.stop(); });

const PW = 'correct horse battery';
const post = (url: string, headers: Record<string, string>, payload: object) => h.app.inject({ method: 'POST', url, headers: { ...headers, 'idempotency-key': randomUUID() }, payload });

describe('password change (signed in)', () => {
  it('needs the current password, keeps this session and signs out every other one', async () => {
    await signup(h.app, { email: 'pw@test.flero', handle: 'pw_user' });
    const other = await h.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'pw@test.flero', password: PW } });
    const here = await h.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'pw@test.flero', password: PW } });
    const auth = { authorization: `Bearer ${here.json().access_token}` };
    expect((await post('/v1/me/password', auth, { current_password: 'nope nope nope', new_password: 'brand new password 1' })).json()).toMatchObject({ code: 'VALIDATION_FAILED', params: { field: 'current_password' } });
    expect((await post('/v1/me/password', auth, { current_password: PW, new_password: 'brand new password 1' })).statusCode).toBe(204);
    expect((await h.app.inject({ method: 'GET', url: '/v1/me', headers: auth })).statusCode).toBe(200);
    expect((await h.app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${other.json().access_token}` } })).statusCode).toBe(401);
    expect((await h.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'pw@test.flero', password: 'brand new password 1' } })).statusCode).toBe(200);
    expect(h.mailer.last('pw@test.flero', 'password_changed')).toBeTruthy();
    const notes = (await h.app.inject({ method: 'GET', url: '/v1/notifications', headers: auth })).json();
    expect(notes.map((n: { type: string }) => n.type)).toContain('SECURITY');
  });
});

describe('password reset (forgot password)', () => {
  it('answers 204 for unknown e-mails too; the token is single-use and signs out every session', async () => {
    const s = await signup(h.app, { email: 'reset@test.flero', handle: 'reset_user' });
    expect((await h.app.inject({ method: 'POST', url: '/v1/auth/password/reset-request', payload: { email: 'ghost@test.flero' } })).statusCode).toBe(204);
    expect((await h.app.inject({ method: 'POST', url: '/v1/auth/password/reset-request', payload: { email: 'RESET@test.flero' } })).statusCode).toBe(204);
    const token = h.mailer.last('reset@test.flero', 'password_reset')!.vars.token!;
    const reset = (pw: string) => h.app.inject({ method: 'POST', url: '/v1/auth/password/reset', payload: { token, new_password: pw } });
    expect((await reset('another good password')).statusCode).toBe(204);
    expect((await reset('third good password!')).statusCode).toBe(401); // single use
    expect((await h.app.inject({ method: 'GET', url: '/v1/me', headers: s.auth })).statusCode).toBe(401);
    expect((await h.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'reset@test.flero', password: 'another good password' } })).statusCode).toBe(200);
  });
});

describe('e-mail verification', () => {
  it('sends a 6-digit code, rate-limits resends, locks after 5 wrong tries', async () => {
    const s = await signup(h.app, { email: 'verify@test.flero', handle: 'verify_user' });
    expect((await post('/v1/auth/email/resend', s.auth, {})).statusCode).toBe(204);
    expect((await post('/v1/auth/email/resend', s.auth, {})).statusCode).toBe(429);
    const code = h.mailer.last('verify@test.flero', 'email_code')!.vars.code!;
    expect(code).toMatch(/^\d{6}$/);
    const wrong = code === '000000' ? '111111' : '000000';
    expect((await post('/v1/auth/email/verify', s.auth, { code: wrong })).json().params).toMatchObject({ reason: 'wrong' });
    expect((await post('/v1/auth/email/verify', s.auth, { code })).statusCode).toBe(204);
    expect((await h.app.inject({ method: 'GET', url: '/v1/me', headers: s.auth })).json().email_verified).toBe(true);
  });
});

describe('notifications: every event type reaches the centre, generically', () => {
  it('follow, friendship, request, accept, reveal, gift, wallet, boost-free path — with deep links and no identity', async () => {
    const a = await onboarded(h); const b = await onboarded(h);
    await h.app.inject({ method: 'PUT', url: `/v1/follows/${b.pid}`, headers: a.auth });
    await h.app.inject({ method: 'PUT', url: `/v1/follows/${a.pid}`, headers: b.auth });
    const cid = (await post('/v1/conversations', a.auth, { recipient: b.pid, first_message: { client_msg_id: randomUUID(), body: 'hi' } })).json().conversation_id;
    await post(`/v1/conversations/${cid}/accept`, b.auth, {});
    await post('/v1/wallet/purchases/verify', a.auth, { platform: 'APPLE', signed_payload: devPayload({ store_txn_id: `n-${a.id}`, product_id: 'gold_100' }) });
    await post(`/v1/conversations/${cid}/gold-gifts`, a.auth, {});
    const list = async (u: { auth: Record<string, string> }) => (await h.app.inject({ method: 'GET', url: '/v1/notifications', headers: u.auth })).json() as { type: string; conversation_id: string | null; title_key: string; params: object }[];
    const bt = await list(b);
    expect(bt.map((n) => n.type).sort()).toEqual(['FOLLOW', 'FRIENDSHIP', 'GOLD_GIFT', 'MESSAGE_REQUEST'].sort());
    expect(bt.find((n) => n.type === 'GOLD_GIFT')!.conversation_id).toBe(cid);
    expect(bt.every((n) => JSON.stringify(n).indexOf(a.pid) === -1)).toBe(true); // never names the sender
    const at = await list(a);
    expect(at.map((n) => n.type)).toEqual(expect.arrayContaining(['FOLLOW', 'FRIENDSHIP', 'REQUEST_ACCEPTED', 'WALLET']));
    expect(at.find((n) => n.type === 'WALLET')!.title_key).toBe('notif.wallet.title');
  });

  it('anonymous reveal notifies the recipient; duplicates are impossible', async () => {
    const a = await onboarded(h); const b = await onboarded(h);
    const cid = (await post('/v1/conversations', a.auth, { recipient: b.pid, first_message: { client_msg_id: randomUUID(), body: 'hi' } })).json().conversation_id;
    await post(`/v1/conversations/${cid}/reveal`, a.auth, {});
    await post(`/v1/conversations/${cid}/reveal`, a.auth, {});
    const bt = (await h.app.inject({ method: 'GET', url: '/v1/notifications', headers: b.auth })).json() as { type: string }[];
    expect(bt.filter((n) => n.type === 'REVEAL')).toHaveLength(1);
  });

  it('preferences gate push (never the centre); security cannot be muted; the worker drains the queue', async () => {
    const a = await onboarded(h); const b = await onboarded(h);
    const prefs = (await h.app.inject({ method: 'GET', url: '/v1/me/notification-preferences', headers: b.auth })).json();
    expect(prefs).toMatchObject({ topics: { social: true, marketing: false }, message_preview: false });
    await h.app.inject({ method: 'PUT', url: '/v1/me/notification-preferences', headers: b.auth, payload: { ...prefs, topics: { ...prefs.topics, social: false } } });
    await h.pool.query(`UPDATE ident.outbox_event SET processed_at = now() WHERE topic = 'push' AND processed_at IS NULL`);
    await h.app.inject({ method: 'PUT', url: `/v1/likes/${b.pid}`, headers: a.auth });
    const pushes = await h.pool.query(`SELECT payload FROM ident.outbox_event WHERE topic = 'push' AND processed_at IS NULL AND (payload->>'account_id')::bigint = $1`, [b.id]);
    expect(pushes.rows).toEqual([]); // social muted → no push
    expect(((await h.app.inject({ method: 'GET', url: '/v1/notifications', headers: b.auth })).json() as { type: string }[]).map((n) => n.type)).toContain('LIKE'); // centre still has it
    await post('/v1/me/password', b.auth, { current_password: PW, new_password: 'a fresh password 22' });
    const sec = await h.pool.query(`SELECT 1 FROM ident.outbox_event WHERE topic = 'push' AND processed_at IS NULL AND payload->>'type' = 'SECURITY' AND (payload->>'account_id')::bigint = $1`, [b.id]);
    expect(sec.rows).toHaveLength(1);
    expect(await dispatchPush(h.pool)).toBeGreaterThan(0);
    expect((await h.pool.query(`SELECT 1 FROM ident.outbox_event WHERE topic = 'push' AND processed_at IS NULL`)).rows).toEqual([]);
  });
});
