import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { devPayload } from '../src/wallet/iap.ts';
import { onboarded, startHarness, type Harness } from './harness.ts';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
  await h.pool.query(`INSERT INTO app.gold_product (store, product_id, version, gold_amount, created_by) VALUES ('APPLE', 'gold_100', 1, 100, 'seed')`);
});
afterAll(async () => { await h?.stop(); });

type U = Awaited<ReturnType<typeof onboarded>>;
const H = (u: U) => ({ ...u.auth, 'idempotency-key': randomUUID() });
const call = (u: U, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
  h.app.inject({ method, url, headers: method === 'GET' ? u.auth : H(u), ...(payload ? { payload } : {}) });
const start = (a: U, b: U, body = 'Selam!') => call(a, 'POST', '/v1/conversations', { recipient: b.pid, first_message: { client_msg_id: randomUUID(), body } });
const send = (u: U, cid: string, body = 'hey', client_msg_id = randomUUID()) => call(u, 'POST', `/v1/conversations/${cid}/messages`, { client_msg_id, kind: 'TEXT', body });
const view = async (u: U, cid: string) => (await call(u, 'GET', `/v1/conversations/${cid}`)).json();
const profile = async (viewer: U, target: U) => (await call(viewer, 'GET', `/v1/profiles/${target.pid}`)).json();
const inbox = async (u: U, filter: string) => (await call(u, 'GET', `/v1/inbox?filter=${filter}`)).json();

describe('directional threads + counterparty projection (DEC-01, ADR-016)', () => {
  it('the initiator is anonymous to the recipient; the recipient is identified to the initiator', async () => {
    const a = await onboarded(h); const b = await onboarded(h);
    const res = await start(a, b);
    expect(res.statusCode).toBe(201);
    const cv = res.json();
    expect(cv).toMatchObject({ state: 'REQUEST', my_role: 'INITIATOR', can_reveal: true, last_seq: 1, counterparty: { kind: 'IDENTIFIED', public_user_id: b.pid } });
    const bv = await view(b, cv.conversation_id);
    expect(bv.counterparty).toMatchObject({ kind: 'ANONYMOUS', label_key: 'chat.anonymous_user' });
    expect(JSON.stringify(bv)).not.toContain(a.pid); // no identity anywhere in the payload
    const req = await inbox(b, 'requests');
    expect(req).toHaveLength(1);
    expect(req[0]).toMatchObject({ unread_count: 1, last_message_preview: 'Selam!' });
    expect(await inbox(b, 'main')).toEqual([]);
  });

  it('oracle-free CTA: the recipient sees START_NEW on the hidden initiator’s profile', async () => {
    const a = await onboarded(h); const b = await onboarded(h);
    const cv = (await start(a, b)).json();
    expect((await profile(a, b)).actions.message).toEqual({ kind: 'OPEN_EXISTING', conversation_id: cv.conversation_id });
    expect((await profile(b, a)).actions.message).toEqual({ kind: 'START_NEW' }); // same as for any stranger
    // B starting its own thread creates a second, independent direction
    const back = (await start(b, a)).json();
    expect(back.conversation_id).not.toBe(cv.conversation_id);
  });

  it('accept moves to main; reject starts the 30-day cooldown for the initiator', async () => {
    const a = await onboarded(h); const b = await onboarded(h); const c = await onboarded(h);
    const ab = (await start(a, b)).json().conversation_id;
    expect((await call(b, 'POST', `/v1/conversations/${ab}/accept`)).json().state).toBe('ACTIVE');
    expect((await inbox(b, 'main'))).toHaveLength(1);
    const ac = (await start(a, c)).json().conversation_id;
    expect((await call(c, 'POST', `/v1/conversations/${ac}/reject`)).json().state).toBe('REJECTED');
    expect((await profile(a, c)).actions.message).toEqual({ kind: 'UNAVAILABLE' });
    expect((await start(a, c)).statusCode).toBe(403);
    expect((await call(a, 'POST', `/v1/conversations/${ac}/accept`)).statusCode).toBe(403); // initiator cannot accept
  });

  it('non-participants get the same 404 as a missing conversation', async () => {
    const a = await onboarded(h); const b = await onboarded(h); const x = await onboarded(h);
    const cid = (await start(a, b)).json().conversation_id;
    expect((await call(x, 'GET', `/v1/conversations/${cid}`)).statusCode).toBe(404);
    expect((await call(x, 'GET', `/v1/conversations/cnv_${'a'.repeat(26)}`)).statusCode).toBe(404);
  });
});

describe('messages: seq, idempotency, receipts, sync', () => {
  it('50 concurrent sends get gap-free unique seqs; a retried client_msg_id never duplicates', async () => {
    const a = await onboarded(h); const b = await onboarded(h);
    const cid = (await start(a, b)).json().conversation_id;
    const res = await Promise.all(Array.from({ length: 50 }, (_, i) => send(i % 2 ? a : b, cid, `m${i}`)));
    expect(res.every((r) => r.statusCode === 201)).toBe(true);
    const seqs = res.map((r) => r.json().seq).sort((x, y) => x - y);
    expect(seqs).toEqual(Array.from({ length: 50 }, (_, i) => i + 2));
    const id = randomUUID();
    const first = await send(a, cid, 'once', id);
    const again = await send(a, cid, 'once', id);
    expect(again.statusCode).toBe(200);
    expect(again.json().message_id).toBe(first.json().message_id);
    expect((await view(a, cid)).last_seq).toBe(52);
  });

  it('pages history by cursor and catches up by after_seq', async () => {
    const a = await onboarded(h); const b = await onboarded(h);
    const cid = (await start(a, b)).json().conversation_id;
    for (let i = 0; i < 4; i++) await send(a, cid, `n${i}`);
    const p1 = await call(b, 'GET', `/v1/conversations/${cid}/messages?limit=3`);
    expect(p1.json().map((m: { seq: number }) => m.seq)).toEqual([5, 4, 3]);
    expect(p1.json()[0].mine).toBe(false);
    const p2 = await call(b, 'GET', `/v1/conversations/${cid}/messages?limit=3&cursor=${p1.headers['x-next-cursor']}`);
    expect(p2.json().map((m: { seq: number }) => m.seq)).toEqual([2, 1]);
    const gap = await call(b, 'GET', `/v1/conversations/${cid}/messages?after_seq=3`);
    expect(gap.json().map((m: { seq: number }) => m.seq)).toEqual([4, 5]);
  });

  it('receipts are monotonic and capped; sync returns changed conversations since a version', async () => {
    const a = await onboarded(h); const b = await onboarded(h);
    const cid = (await start(a, b)).json().conversation_id;
    const s0 = (await call(b, 'GET', '/v1/sync?since=0')).json();
    expect(s0.changed.map((c: { conversation_id: string }) => c.conversation_id)).toEqual([cid]);
    await call(b, 'POST', `/v1/conversations/${cid}/receipts`, { read_seq: 99 });
    expect(await view(b, cid)).toMatchObject({ delivered_seq: 1, read_seq: 1 }); // capped at last_seq
    await call(b, 'POST', `/v1/conversations/${cid}/receipts`, { read_seq: 0 });
    expect((await view(b, cid)).read_seq).toBe(1); // never moves backwards
    await send(a, cid);
    const s1 = (await call(b, 'GET', `/v1/sync?since=${s0.version}`)).json();
    expect(s1).toMatchObject({ full_resync_required: false, changed: [{ conversation_id: cid, last_seq: 2 }] });
    expect((await call(b, 'GET', `/v1/sync?since=${s1.version + 100}`)).json().full_resync_required).toBe(true);
  });

  it('the sender sees the counterpart’s delivered/read watermarks after reopening (✓ → ✓✓ → read)', async () => {
    const a = await onboarded(h); const b = await onboarded(h);
    const cid = (await start(a, b)).json().conversation_id;
    await send(a, cid); await send(a, cid); // seq 1..3, all A's
    expect(await view(a, cid)).toMatchObject({ last_seq: 3, peer_delivered_seq: 0, peer_read_seq: 0 }); // ✓ sent
    await call(b, 'POST', `/v1/conversations/${cid}/receipts`, { delivered_seq: 3 });
    expect(await view(a, cid)).toMatchObject({ peer_delivered_seq: 3, peer_read_seq: 0 }); // ✓✓ delivered
    await call(b, 'POST', `/v1/conversations/${cid}/receipts`, { read_seq: 2 });
    expect(await view(a, cid)).toMatchObject({ peer_delivered_seq: 3, peer_read_seq: 2 }); // read up to 2
    // B's own view carries A's watermarks over B's messages (A wrote them all, so A has read everything it sent)
    expect(await view(b, cid)).toMatchObject({ peer_delivered_seq: 3, peer_read_seq: 3 });
  });
});

describe('reveal, mutual follow and consolidation (REQ-SOC-06, doc 08 §3.3)', () => {
  it('self-reveal is irreversible and identifies the initiator', async () => {
    const a = await onboarded(h); const b = await onboarded(h);
    const cid = (await start(a, b)).json().conversation_id;
    expect((await call(b, 'POST', `/v1/conversations/${cid}/reveal`)).statusCode).toBe(403); // recipient cannot
    expect((await call(a, 'POST', `/v1/conversations/${cid}/reveal`)).json().can_reveal).toBe(false);
    expect((await view(b, cid)).counterparty).toMatchObject({ kind: 'IDENTIFIED', public_user_id: a.pid });
    expect((await profile(b, a)).actions.message).toEqual({ kind: 'OPEN_EXISTING', conversation_id: cid });
  });

  it('mutual follow reveals both directions and seals the newer twin into the older', async () => {
    const a = await onboarded(h); const b = await onboarded(h);
    const ab = (await start(a, b)).json().conversation_id;
    const ba = (await start(b, a)).json().conversation_id;
    await call(a, 'PUT', `/v1/follows/${b.pid}`);
    expect((await profile(b, a)).relationship).toMatchObject({ follows_me: true, is_friend: false });
    await call(b, 'PUT', `/v1/follows/${a.pid}`);
    expect((await view(a, ab)).state).not.toBe('SEALED');
    const sealed = await view(a, ba);
    expect(sealed).toMatchObject({ state: 'SEALED', canonical_conversation_id: ab });
    expect((await view(b, ab)).counterparty.kind).toBe('IDENTIFIED');
    expect((await call(a, 'GET', '/v1/me/friends/count')).json()).toEqual({ friend_count: 1 });
    // unfollow never un-reveals
    await call(a, 'DELETE', `/v1/follows/${b.pid}`);
    expect((await view(b, ab)).counterparty.kind).toBe('IDENTIFIED');
  });
});

describe('blocking: shield, full block, delayed closure (DEC-02, DEC-02b)', () => {
  it('shield from an anonymous thread: recipient never learns the id; initiator can no longer start anonymously', async () => {
    const a = await onboarded(h); const b = await onboarded(h);
    const cid = (await start(a, b)).json().conversation_id;
    expect((await call(b, 'POST', `/v1/conversations/${cid}/block`)).statusCode).toBe(204);
    expect((await view(a, cid)).state).toBe('CLOSED');
    expect((await send(a, cid)).statusCode).toBe(403);
    expect((await profile(a, b)).actions.message).toEqual({ kind: 'UNAVAILABLE' });
    expect((await call(b, 'GET', '/v1/me/blocks')).json()).toEqual([]); // shields are never listed with identity
    // the shielded initiator's follow is a silent no-op
    expect((await call(a, 'PUT', `/v1/follows/${b.pid}`)).statusCode).toBe(204);
    expect((await profile(b, a)).relationship.follows_me).toBe(false);
  });

  it('full block over a shield retains it; unblock restores the shield, not open access', async () => {
    const a = await onboarded(h); const b = await onboarded(h);
    const cid = (await start(a, b)).json().conversation_id;
    await call(b, 'POST', `/v1/conversations/${cid}/block`);
    await call(b, 'PUT', `/v1/blocks/${a.pid}`);
    expect((await call(b, 'GET', '/v1/me/blocks')).json().map((p: { public_user_id: string }) => p.public_user_id)).toEqual([a.pid]);
    expect((await call(a, 'GET', `/v1/profiles/${b.pid}`)).statusCode).toBe(404); // blocked: profile disappears
    await call(b, 'DELETE', `/v1/blocks/${a.pid}`);
    expect((await profile(a, b)).actions.message).toEqual({ kind: 'UNAVAILABLE' }); // shield is back
  });

  it('DEC-02b: blocking a hidden initiator from the profile keeps the presentation; sends are withheld', async () => {
    const a = await onboarded(h); const b = await onboarded(h);
    const cid = (await start(a, b)).json().conversation_id;
    await call(b, 'PUT', `/v1/blocks/${a.pid}`); // B does not know the thread is A's
    const bv = await view(b, cid);
    expect(bv).toMatchObject({ state: 'REQUEST', can_send: true }); // unchanged presentation
    expect((await view(a, cid)).state).toBe('CLOSED');
    const s = await send(b, cid, 'kimsin?');
    expect(s.statusCode).toBe(201);
    expect((await view(a, cid)).last_seq).toBe(1); // A never sees the withheld tail
    const am = (await call(a, 'GET', `/v1/conversations/${cid}/messages`)).json();
    expect(am.map((m: { body: string }) => m.body)).toEqual(['Selam!']);
    // after the delay the recipient sees the real state
    await h.pool.query(`UPDATE ident.conversation SET presented_close_at = now() - interval '1 second' WHERE public_id = $1`, [cid]);
    expect(await view(b, cid)).toMatchObject({ state: 'CLOSED', can_send: false });
  });
});

describe('1-Gold gift (REQ-GLD-05) and reports', () => {
  it('moves exactly 1 Gold, idempotently, through the transit account', async () => {
    const a = await onboarded(h); const b = await onboarded(h);
    await h.app.inject({ method: 'POST', url: '/v1/wallet/purchases/verify', headers: H(a), payload: { platform: 'APPLE', signed_payload: devPayload({ store_txn_id: `t-${a.id}`, product_id: 'gold_100' }) } });
    const cid = (await start(a, b)).json().conversation_id;
    const key = randomUUID();
    const g = () => h.app.inject({ method: 'POST', url: `/v1/conversations/${cid}/gold-gifts`, headers: { ...a.auth, 'idempotency-key': key }, payload: {} });
    expect((await g()).json().available).toBe(99);
    expect((await g()).json().available).toBe(99);
    expect((await call(b, 'GET', '/v1/wallet')).json().available).toBe(1);
    const amount = await h.app.inject({ method: 'POST', url: `/v1/conversations/${cid}/gold-gifts`, headers: H(a), payload: { amount: 50 } });
    expect(amount.statusCode).toBe(400); // no amount field exists
    const msgs = (await call(b, 'GET', `/v1/conversations/${cid}/messages`)).json();
    expect(msgs[0]).toMatchObject({ kind: 'GOLD_GIFT', system_key: 'chat.system.gold_gift', mine: false });
    const { rows } = await h.pool.query('SELECT COALESCE(SUM(amount),0)::int AS s FROM app.ledger_posting p JOIN app.ledger_account la ON la.id = p.ledger_account_id WHERE la.kind = $1', ['SYS_GIFT_TRANSIT']);
    expect(rows[0].s).toBe(0); // transit always nets to zero
  });

  it('a gift without Gold is a 402 and nothing moves', async () => {
    const a = await onboarded(h); const b = await onboarded(h);
    const cid = (await start(a, b)).json().conversation_id;
    expect((await h.app.inject({ method: 'POST', url: `/v1/conversations/${cid}/gold-gifts`, headers: H(a), payload: {} })).statusCode).toBe(402);
    expect((await call(b, 'GET', '/v1/wallet')).json().available).toBe(0);
  });

  it('reporting an anonymous conversation resolves the target server-side; MINOR_SAFETY is priority 0', async () => {
    const a = await onboarded(h); const b = await onboarded(h);
    const cid = (await start(a, b)).json().conversation_id;
    expect((await call(b, 'POST', '/v1/reports', { target: { type: 'CONVERSATION', id: cid }, reason: 'MINOR_SAFETY' })).statusCode).toBe(204);
    const { rows } = await h.pool.query('SELECT target_account_id, priority FROM ident.report WHERE reporter_id = $1', [b.id]);
    expect(rows).toEqual([{ target_account_id: a.id, priority: 0 }]);
  });
});

describe('social graph', () => {
  it('likes are irreversible and counted once; search is prefix + block-aware', async () => {
    const a = await onboarded(h); const b = await onboarded(h);
    await call(a, 'PUT', `/v1/likes/${b.pid}`);
    await call(a, 'PUT', `/v1/likes/${b.pid}`);
    expect((await profile(a, b))).toMatchObject({ like_count: 1, relationship: { i_liked: true } });
    const handle = (await call(b, 'GET', '/v1/me')).json().handle as string;
    const hits = (await call(a, 'GET', `/v1/search/users?q=${handle.slice(0, 8)}`)).json();
    expect(hits.map((p: { public_user_id: string }) => p.public_user_id)).toContain(b.pid);
    await call(b, 'PUT', `/v1/blocks/${a.pid}`);
    const after = (await call(a, 'GET', `/v1/search/users?q=${handle.slice(0, 8)}`)).json();
    expect(after.map((p: { public_user_id: string }) => p.public_user_id)).not.toContain(b.pid);
  });
});
