import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { loadConfig } from '../src/config.ts';
import { Gateway } from '../src/realtime/gateway.ts';
import { SessionCache } from '../src/server.ts';
import { onboarded, startHarness, type Harness } from './harness.ts';

let h: Harness;
let gw: Gateway;
let url: string;
beforeAll(async () => {
  h = await startHarness();
  await h.app.listen({ port: 0, host: '127.0.0.1' });
  const cfg = loadConfig({ NODE_ENV: 'test', DATABASE_URL: h.container.getConnectionUri() });
  // the gateway must verify the same tokens as the API: reuse the API's TokenService
  gw = new Gateway({ pool: h.pool, databaseUrl: cfg.DATABASE_URL, tokens: h.tokens, sessions: new SessionCache(h.pool, 0), authTimeoutMs: 800 });
  await gw.attach(h.app.server);
  url = `ws://127.0.0.1:${(h.app.server.address() as AddressInfo).port}/v1/realtime`;
});
afterAll(async () => { await gw?.close(); await h?.stop(); });

type U = Awaited<ReturnType<typeof onboarded>>;
interface Client { ws: WebSocket; events: Record<string, unknown>[]; next: (t: string, ms?: number) => Promise<Record<string, unknown>>; closed: Promise<number> }
function connect(token?: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const events: Record<string, unknown>[] = [];
    const waiters: { t: string; r: (e: Record<string, unknown>) => void }[] = [];
    const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
    ws.on('message', (raw) => {
      const e = JSON.parse(raw.toString());
      events.push(e);
      const i = waiters.findIndex((w) => w.t === e.t);
      if (i >= 0) waiters.splice(i, 1)[0]!.r(e);
    });
    const next = (t: string, ms = 3000) => new Promise<Record<string, unknown>>((r, j) => {
      const seen = events.findIndex((e) => e.t === t);
      if (seen >= 0) return r(events.splice(seen, 1)[0]!);
      const timer = setTimeout(() => j(new Error(`timeout waiting for ${t}`)), ms);
      waiters.push({ t, r: (e) => { clearTimeout(timer); events.splice(events.indexOf(e), 1); r(e); } });
    });
    ws.on('open', () => { if (token) ws.send(JSON.stringify({ t: 'auth', token })); resolve({ ws, events, next, closed }); });
    ws.on('error', reject);
  });
}
const H = (u: U) => ({ ...u.auth, 'idempotency-key': randomUUID() });
const token = (u: U) => u.auth.authorization.slice(7);

describe('realtime gateway (doc 08 §6)', () => {
  it('authenticates with the first frame; never via the URL', async () => {
    const a = await onboarded(h);
    const c = await connect(token(a));
    const hello = await c.next('hello');
    expect(hello).toMatchObject({ v: 1, heartbeat_s: 25 });
    c.ws.close();
    const anon = await connect();
    expect(await anon.closed).toBe(4401); // auth timeout
    const bad = await connect('x'.repeat(40));
    expect(await bad.closed).toBe(4401);
  });

  it('delivers message.new to the recipient (redacted) and message.committed to the sender', async () => {
    const a = await onboarded(h); const b = await onboarded(h);
    const ca = await connect(token(a)); const cb = await connect(token(b));
    await ca.next('hello'); await cb.next('hello');
    const clientMsg = randomUUID();
    const res = await h.app.inject({ method: 'POST', url: '/v1/conversations', headers: H(a), payload: { recipient: b.pid, first_message: { client_msg_id: clientMsg, body: 'Merhaba' } } });
    const cid = res.json().conversation_id;
    const got = await cb.next('message.new');
    expect(got).toMatchObject({ conversation_id: cid, seq: 1, kind: 'TEXT', body: 'Merhaba' });
    expect(JSON.stringify(got)).not.toContain(a.pid); // anonymous initiator stays anonymous on the wire
    expect(await ca.next('message.committed')).toMatchObject({ conversation_id: cid, client_msg_id: clientMsg, seq: 1 });
    // ack from the socket moves the delivered watermark and the sender sees the receipt
    cb.ws.send(JSON.stringify({ t: 'ack', conversation_id: cid, seq: 1 }));
    expect(await ca.next('receipt.updated')).toMatchObject({ conversation_id: cid, delivered_seq: 1 });
    // typing is relayed to the counterpart only
    ca.ws.send(JSON.stringify({ t: 'typing', conversation_id: cid, state: 'on' }));
    expect(await cb.next('typing')).toMatchObject({ conversation_id: cid, state: 'on' });
    // ping carries the current sync version
    cb.ws.send(JSON.stringify({ t: 'ping' }));
    expect(((await cb.next('pong')).sync_version as number)).toBeGreaterThan(0);
    ca.ws.close(); cb.ws.close();
  });

  it('a withheld (DEC-02b) message never reaches the blocked initiator', async () => {
    const a = await onboarded(h); const b = await onboarded(h);
    const cid = (await h.app.inject({ method: 'POST', url: '/v1/conversations', headers: H(a), payload: { recipient: b.pid, first_message: { client_msg_id: randomUUID(), body: 'hi' } } })).json().conversation_id;
    await h.app.inject({ method: 'PUT', url: `/v1/blocks/${a.pid}`, headers: H(b) });
    const ca = await connect(token(a));
    await ca.next('hello');
    await h.app.inject({ method: 'POST', url: `/v1/conversations/${cid}/messages`, headers: H(b), payload: { client_msg_id: randomUUID(), kind: 'TEXT', body: 'secret' } });
    await expect(ca.next('message.new', 600)).rejects.toThrow('timeout');
    ca.ws.close();
  });

  it('logout closes the session’s sockets immediately', async () => {
    const a = await onboarded(h);
    const c = await connect(token(a));
    await c.next('hello');
    await h.app.inject({ method: 'POST', url: '/v1/auth/logout', headers: a.auth });
    expect(await c.closed).toBe(4403);
  });

  it('malformed frames close the socket with a protocol error', async () => {
    const a = await onboarded(h);
    const c = await connect(token(a));
    await c.next('hello');
    c.ws.send('{"t":"nope"}');
    expect(await c.closed).toBe(4400);
  });
});
