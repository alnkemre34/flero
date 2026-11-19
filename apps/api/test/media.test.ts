import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fingerprint } from '../src/ids.ts';
import { expireMedia } from '../src/media/routes.ts';
import { DevStorage } from '../src/storage.ts';
import { onboarded, startHarness, type Harness } from './harness.ts';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
  await h.pool.query(`INSERT INTO app.unlock_price (kind, version, price_gold, created_by) VALUES ('ONE_VIEW', 1, 5, 'test'), ('PERSISTENT', 1, 10, 'test')`);
});
afterAll(async () => { await h?.stop(); });

type U = Awaited<ReturnType<typeof onboarded>>;
const H = (u: U) => ({ ...u.auth, 'idempotency-key': randomUUID() });
const call = (u: U, method: 'GET' | 'POST', url: string, payload?: object) =>
  h.app.inject({ method, url, headers: method === 'GET' ? u.auth : H(u), ...(payload ? { payload } : {}) });
const path = (url: string) => { const x = new URL(url); return x.pathname + x.search; };

/** A real photo with EXIF + a GPS tag, bigger than the 1600 px cap. */
const photo = () => sharp({ create: { width: 2400, height: 1200, channels: 3, background: { r: 30, g: 120, b: 200 } } })
  .jpeg().withExifMerge({ IFD0: { Copyright: 'secret-owner' }, IFD3: { GPSLatitudeRef: 'N' } }).toBuffer();

async function pair() {
  const a = await onboarded(h); const b = await onboarded(h);
  const s = await call(a, 'POST', '/v1/conversations', { recipient: b.pid, first_message: { client_msg_id: randomUUID(), body: 'Selam' } });
  return { a, b, cid: s.json().conversation_id as string };
}

async function grant(u: U, gold: number) {
  await h.pool.query(`SELECT app.post_ledger('ADMIN_GRANT', $1, $2, $3, 'test', 'test grant', $4::jsonb)`,
    [u.id, `grant:${randomUUID()}`, fingerprint({ g: gold }), JSON.stringify([{ account: 'SYS_ADMIN_GRANT', owner: null, amount: -gold }, { account: 'USER_AVAILABLE', owner: u.id, amount: gold }])]);
}
const balance = async (u: U) => (await call(u, 'GET', '/v1/wallet')).json().available as number;

/** Ticket → multipart POST into quarantine → complete, exactly as the app does. */
async function sendPhoto(u: U, cid: string, kind: 'PERSISTENT' | 'ONE_VIEW' = 'PERSISTENT') {
  const body = await photo();
  const t = await call(u, 'POST', `/v1/conversations/${cid}/media/uploads`, { kind, content_type: 'image/jpeg', byte_size: body.length });
  expect(t.statusCode).toBe(201);
  const ticket = t.json() as { media_id: string; url: string; fields: Record<string, string> };
  const boundary = `----flero${randomUUID()}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(ticket.fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="p.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`), body, Buffer.from(`\r\n--${boundary}--\r\n`));
  const up = await h.app.inject({ method: 'POST', url: new URL(ticket.url).pathname, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat(parts) });
  expect(up.statusCode).toBe(204);
  const done = await call(u, 'POST', `/v1/media/${ticket.media_id}/complete`);
  expect(done.statusCode).toBe(200);
  return { mid: ticket.media_id, done: done.json(), ticket };
}

describe('chat photo: upload → re-encode → PHOTO message', () => {
  it('strips metadata, caps size, posts exactly one PHOTO message; the sender sees it free, the recipient locked', async () => {
    const { a, b, cid } = await pair();
    const { mid, done } = await sendPhoto(a, cid);
    expect(done).toMatchObject({ media_id: mid, state: 'READY', kind: 'PERSISTENT', locked: false, unlock_price_gold: 10 });
    expect(done.access.url).toBeTruthy();
    const img = await h.app.inject({ method: 'GET', url: path(done.access.url) });
    expect(img.statusCode).toBe(200);
    const meta = await sharp(img.rawPayload).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(1600);
    expect(meta.exif).toBeUndefined(); // no EXIF, no GPS

    // a retried complete never posts a second message
    expect((await call(a, 'POST', `/v1/media/${mid}/complete`)).statusCode).toBe(200);
    const msgs = (await call(b, 'GET', `/v1/conversations/${cid}/messages?limit=10`)).json() as { kind: string; media_id: string | null }[];
    expect(msgs.filter((m) => m.kind === 'PHOTO')).toEqual([expect.objectContaining({ media_id: mid })]);

    const locked = (await call(b, 'GET', `/v1/media/${mid}`)).json();
    expect(locked).toMatchObject({ locked: true, access: null, unlock_price_gold: 10 });
  });

  it('quarantine is never served and signed URLs cannot be forged', async () => {
    const { a, cid } = await pair();
    const { ticket, done } = await sendPhoto(a, cid);
    const qkey = ticket.fields.key!;
    const forged = new URL(done.access.url); forged.searchParams.set('k', qkey);
    expect((await h.app.inject({ method: 'GET', url: forged.pathname + forged.search })).statusCode).toBe(404);
    const tampered = new URL(done.access.url); tampered.searchParams.set('s', 'x'.repeat(43));
    expect((await h.app.inject({ method: 'GET', url: tampered.pathname + tampered.search })).statusCode).toBe(404);
  });

  it('a non-participant gets the same 404 for view, unlock and upload', async () => {
    const { a, cid } = await pair();
    const c = await onboarded(h);
    const { mid } = await sendPhoto(a, cid);
    expect((await call(c, 'GET', `/v1/media/${mid}`)).statusCode).toBe(404);
    expect((await call(c, 'POST', `/v1/media/${mid}/unlock`)).statusCode).toBe(404);
    expect((await call(c, 'POST', `/v1/conversations/${cid}/media/uploads`, { kind: 'PERSISTENT', content_type: 'image/jpeg', byte_size: 100 })).statusCode).toBe(404);
  });
});

describe('Gold unlock (doc 12 §4): never charged twice, sender never pays', () => {
  it('402 without Gold; 12 concurrent unlocks charge exactly once; the sender is notified', async () => {
    const { a, b, cid } = await pair();
    const { mid } = await sendPhoto(a, cid);
    expect((await call(b, 'POST', `/v1/media/${mid}/unlock`)).statusCode).toBe(402);
    await grant(b, 30);
    const res = await Promise.all(Array.from({ length: 12 }, () => call(b, 'POST', `/v1/media/${mid}/unlock`)));
    expect(res.every((r) => r.statusCode === 200)).toBe(true);
    expect(await balance(b)).toBe(20);
    const v = (await call(b, 'GET', `/v1/media/${mid}`)).json();
    expect(v).toMatchObject({ locked: false });
    expect((await h.app.inject({ method: 'GET', url: path(v.access.url) })).statusCode).toBe(200);
    // the sender never pays, even when "unlocking" their own photo
    const before = await balance(a);
    expect((await call(a, 'POST', `/v1/media/${mid}/unlock`)).json()).toMatchObject({ locked: false });
    expect(await balance(a)).toBe(before);
    const notes = await h.pool.query(`SELECT count(*)::int AS n FROM ident.notification WHERE recipient_id = $1 AND event_type = 'PHOTO_UNLOCKED'`, [a.id]);
    expect(notes.rows[0].n).toBe(1);
    const sink = await h.pool.query(`SELECT count(*)::int AS n FROM app.ledger_transaction WHERE account_id = $1 AND op_type = 'UNLOCK'`, [b.id]);
    expect(sink.rows[0].n).toBe(1);
  });
});

describe('one-view (doc 08 §8, DEC-25 default)', () => {
  it('lease → single-use bytes → rendered consumes it; it can never be opened again', async () => {
    const { a, b, cid } = await pair();
    const { mid } = await sendPhoto(a, cid, 'ONE_VIEW');
    await grant(b, 10);
    const un = (await call(b, 'POST', `/v1/media/${mid}/unlock`)).json();
    expect(un).toMatchObject({ locked: false, access: null, one_view_state: 'UNOPENED', unlock_price_gold: 5 });
    const lease = (await call(b, 'POST', `/v1/media/${mid}/open`)).json();
    const first = await h.app.inject({ method: 'GET', url: path(lease.url) });
    expect(first.statusCode).toBe(200);
    expect(first.headers['cache-control']).toContain('no-store');
    expect((await h.app.inject({ method: 'GET', url: path(lease.url) })).statusCode).toBe(404); // single use
    const r = await call(b, 'POST', `/v1/media/${mid}/rendered`, { lease_id: lease.lease_id });
    expect(r.json()).toMatchObject({ one_view_state: 'CONSUMED', access: null });
    expect((await call(b, 'POST', `/v1/media/${mid}/open`)).statusCode).toBe(409);
    expect((await call(b, 'POST', `/v1/media/${mid}/rendered`, { lease_id: lease.lease_id })).statusCode).toBe(200); // idempotent
    // the sender still sees their own one-view photo
    expect((await call(a, 'GET', `/v1/media/${mid}`)).json().access).not.toBeNull();
  });

  it('a lease that expired before the bytes arrived can be reopened; bytes without a render ack get ONE grace re-open', async () => {
    const { a, b, cid } = await pair();
    const { mid } = await sendPhoto(a, cid, 'ONE_VIEW');
    await grant(b, 10);
    await call(b, 'POST', `/v1/media/${mid}/unlock`);
    const expire = () => h.pool.query(`UPDATE ident.media_unlock SET lease_expires_at = now() - interval '1 second' WHERE viewer_id = $1`, [b.id]);

    // 1) network died before any byte: reopen is free of penalty
    await call(b, 'POST', `/v1/media/${mid}/open`);
    await expire();
    const l2 = (await call(b, 'POST', `/v1/media/${mid}/open`)).json();
    // 2) bytes delivered, app crashed before "rendered": one grace re-open
    expect((await h.app.inject({ method: 'GET', url: path(l2.url) })).statusCode).toBe(200);
    await expire();
    const l3 = await call(b, 'POST', `/v1/media/${mid}/open`);
    expect(l3.statusCode).toBe(200);
    expect((await h.app.inject({ method: 'GET', url: path(l3.json().url) })).statusCode).toBe(200);
    // 3) the grace is used up: the next expiry consumes it
    await expire();
    expect((await call(b, 'POST', `/v1/media/${mid}/open`)).statusCode).toBe(409);
    expect((await call(b, 'GET', `/v1/media/${mid}`)).json().one_view_state).toBe('CONSUMED');
  });
});

describe('retention (DEC-05: 90 days)', () => {
  it('expired photos lose their bytes and cannot be unlocked; rows stay for the audit trail', async () => {
    const { a, b, cid } = await pair();
    const { mid } = await sendPhoto(a, cid);
    await h.pool.query(`UPDATE ident.media_object SET created_at = now() - interval '91 days', expires_at = now() - interval '1 day' WHERE public_id = $1`, [mid]);
    const storage = new DevStorage('unused', 'http://localhost:3000', 'x');
    expect(await expireMedia(h.pool, { ...storage, remove: async () => {} } as unknown as DevStorage)).toBeGreaterThanOrEqual(1);
    expect((await call(a, 'GET', `/v1/media/${mid}`)).json()).toMatchObject({ state: 'EXPIRED', access: null });
    await grant(b, 20);
    expect((await call(b, 'POST', `/v1/media/${mid}/unlock`)).statusCode).toBe(409);
    expect(await balance(b)).toBe(20);
  });
});
