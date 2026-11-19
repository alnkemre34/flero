import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import { ClientEvent } from '@flero/contracts';
import pg from 'pg';
import { WebSocketServer, type WebSocket } from 'ws';
import type { AccessClaims, TokenService } from '../auth/tokens.ts';
import { applyReceipts, convView, loadConv } from '../conversations/core.ts';
import { withTx } from '../db.ts';
import type { SessionCache } from '../server.ts';

/**
 * Realtime gateway (doc 08 §6). Stateless fan-out: Postgres NOTIFY (emitted only on commit) → per-recipient
 * redaction → sockets. Every instance LISTENs, so horizontal scale needs no sticky routing; a Valkey bus can
 * replace LISTEN later without touching the protocol. Sockets are hints, not the source of truth: anything a
 * client misses is recovered through /v1/sync, so a dropped frame can never lose a message.
 */
export interface GatewayOptions {
  pool: pg.Pool;
  databaseUrl: string;
  tokens: TokenService;
  sessions: SessionCache;
  heartbeatSeconds?: number;
  authTimeoutMs?: number;
  maxBufferedBytes?: number;
}

interface Conn { ws: WebSocket; claims: AccessClaims; alive: boolean; typingAt: Map<string, number>; expTimer?: NodeJS.Timeout }
interface Hint { a: number; v?: number; t: string; c?: string; s?: number | null; sid?: string }

const CLOSE = { unauthenticated: 4401, slowConsumer: 4408, revoked: 4403, protocol: 4400 } as const;

export class Gateway {
  private readonly byAccount = new Map<number, Set<Conn>>();
  private readonly syncVersion = new Map<number, number>();
  private wss?: WebSocketServer;
  private listener: pg.Client | undefined;
  private heartbeat?: NodeJS.Timeout;
  private closed = false;
  private readonly o: Required<GatewayOptions>;

  constructor(opts: GatewayOptions) {
    this.o = { heartbeatSeconds: 25, authTimeoutMs: 5_000, maxBufferedBytes: 1 << 20, ...opts };
  }

  get connectionCount() { let n = 0; for (const s of this.byAccount.values()) n += s.size; return n; }

  async attach(server: Server, path = '/v1/realtime') {
    this.wss = new WebSocketServer({ server, path, maxPayload: 16 * 1024 });
    this.wss.on('connection', (ws, req) => this.onConnection(ws, req));
    await this.listen();
    this.heartbeat = setInterval(() => this.sweep(), this.o.heartbeatSeconds * 1000);
  }

  async close() {
    this.closed = true;
    clearInterval(this.heartbeat);
    for (const set of this.byAccount.values()) for (const c of set) c.ws.close(1001, 'shutdown');
    await new Promise<void>((r) => (this.wss ? this.wss.close(() => r()) : r()));
    await this.listener?.end().catch(() => {});
  }

  // ---------- bus ----------
  private async listen(attempt = 0): Promise<void> {
    const client = new pg.Client({ connectionString: this.o.databaseUrl, application_name: 'flero-realtime' });
    client.on('notification', (n) => { if (n.payload) this.onHint(JSON.parse(n.payload) as Hint).catch(() => {}); });
    client.on('error', () => this.relisten(client));
    client.on('end', () => this.relisten(client));
    try {
      await client.connect();
      await client.query('LISTEN flero_rt');
      this.listener = client;
      if (attempt > 0) this.broadcastSyncHint(); // events may have been missed while disconnected
    } catch {
      await new Promise((r) => setTimeout(r, Math.min(5_000, 200 * 2 ** attempt)));
      if (!this.closed) return this.listen(attempt + 1);
    }
  }

  private relisten(client: pg.Client) {
    if (this.closed || this.listener !== client) return;
    this.listener = undefined;
    void this.listen(1);
  }

  private broadcastSyncHint() {
    for (const [aid, set] of this.byAccount) for (const c of set) this.send(c, { t: 'sync.hint', v: 1, sync_version: this.syncVersion.get(aid) ?? 0 });
  }

  // ---------- connections ----------
  private onConnection(ws: WebSocket, _req: IncomingMessage) {
    let conn: Conn | undefined;
    const authTimer = setTimeout(() => ws.close(CLOSE.unauthenticated, 'auth timeout'), this.o.authTimeoutMs);
    ws.on('pong', () => { if (conn) conn.alive = true; });
    ws.on('close', () => { clearTimeout(authTimer); if (conn) this.remove(conn); });
    ws.on('message', async (raw) => {
      let frame;
      try {
        frame = ClientEvent.safeParse(JSON.parse(raw.toString()));
      } catch { return ws.close(CLOSE.protocol, 'bad frame'); }
      if (!frame.success) return ws.close(CLOSE.protocol, 'bad frame');
      const f = frame.data;
      try {
        if (f.t === 'auth' || f.t === 'reauth') {
          const claims = await this.o.tokens.verifyAccess(f.token);
          await this.o.sessions.assertActive(claims.sid);
          if (conn && conn.claims.aid !== claims.aid) return ws.close(CLOSE.protocol, 'account switch');
          clearTimeout(authTimer);
          if (!conn) {
            conn = { ws, claims, alive: true, typingAt: new Map() };
            this.add(conn);
            const v = await this.currentVersion(claims.aid);
            this.send(conn, { t: 'hello', v: 1, heartbeat_s: this.o.heartbeatSeconds, sync_version: v });
          } else {
            conn.claims = claims;
          }
          this.armExpiry(conn);
          return;
        }
        if (!conn) return ws.close(CLOSE.unauthenticated, 'auth first');
        if (f.t === 'ping') return this.send(conn, { t: 'pong', v: 1, sync_version: this.syncVersion.get(conn.claims.aid) ?? 0 });
        if (f.t === 'ack') {
          const aid = conn.claims.aid;
          await withTx(this.o.pool, async (tx) => applyReceipts(tx, await loadConv(tx, aid, f.conversation_id), aid, f.seq, 0));
          return;
        }
        if (f.t === 'typing') return this.relayTyping(conn, f.conversation_id, f.state);
      } catch {
        if (!conn) ws.close(CLOSE.unauthenticated, 'unauthenticated');
      }
    });
  }

  /** Access tokens are short-lived: a socket must `reauth` before expiry or it is closed (no zombie sessions). */
  private armExpiry(c: Conn) {
    clearTimeout(c.expTimer);
    if (!c.claims.exp) return;
    const ms = c.claims.exp * 1000 - Date.now();
    c.expTimer = setTimeout(() => c.ws.close(CLOSE.unauthenticated, 'token expired'), Math.max(0, ms));
  }

  private add(c: Conn) {
    let set = this.byAccount.get(c.claims.aid);
    if (!set) this.byAccount.set(c.claims.aid, (set = new Set()));
    set.add(c);
  }

  private remove(c: Conn) {
    clearTimeout(c.expTimer);
    const set = this.byAccount.get(c.claims.aid);
    set?.delete(c);
    if (set && set.size === 0) { this.byAccount.delete(c.claims.aid); this.syncVersion.delete(c.claims.aid); }
  }

  private sweep() {
    for (const set of this.byAccount.values()) {
      for (const c of set) {
        if (!c.alive) { c.ws.terminate(); continue; }
        c.alive = false;
        c.ws.ping();
      }
    }
  }

  /** Backpressure: a consumer that cannot keep up is closed; it reconnects and recovers via /v1/sync. */
  private send(c: Conn, event: Record<string, unknown>) {
    if (c.ws.readyState !== c.ws.OPEN) return;
    if (c.ws.bufferedAmount > this.o.maxBufferedBytes) return c.ws.close(CLOSE.slowConsumer, 'slow consumer');
    c.ws.send(JSON.stringify(event));
  }

  private async currentVersion(aid: number) {
    const { rows } = await this.o.pool.query<{ version: number }>('SELECT version FROM ident.user_sync_state WHERE account_id = $1', [aid]);
    const v = rows[0]?.version ?? 0;
    this.syncVersion.set(aid, Math.max(v, this.syncVersion.get(aid) ?? 0));
    return v;
  }

  // ---------- typing: ephemeral, never stored, rate-limited, never across a block or a withheld thread ----------
  private async relayTyping(c: Conn, conversationId: string, state: 'on' | 'off') {
    const now = Date.now();
    if (state === 'on' && now - (c.typingAt.get(conversationId) ?? 0) < 2_000) return;
    c.typingAt.set(conversationId, now);
    const conv = await withTx(this.o.pool, (tx) => loadConv(tx, c.claims.aid, conversationId));
    const open = (conv.state === 'REQUEST' || conv.state === 'ACTIVE') && !conv.full_block;
    if (!open) return; // includes DEC-02b delayed presentation: the blocked initiator sees nothing
    for (const other of this.byAccount.get(conv.other_id) ?? []) this.send(other, { t: 'typing', v: 1, conversation_id: conversationId, state });
  }

  // ---------- hint → redacted event per recipient ----------
  private async onHint(h: Hint) {
    const set = this.byAccount.get(h.a);
    if (h.v !== undefined) this.syncVersion.set(h.a, Math.max(h.v, this.syncVersion.get(h.a) ?? 0));
    if (!set?.size) return; // not connected here: push (integration) covers offline users
    const v = this.syncVersion.get(h.a) ?? 0;
    if (h.t === 'session.revoked') {
      for (const c of [...set]) if (c.claims.sid === h.sid) { this.send(c, { t: 'session.revoked', v: 1 }); c.ws.close(CLOSE.revoked, 'revoked'); }
      this.o.sessions.invalidate(h.sid ?? '');
      return;
    }
    if (h.t === 'notification.new') return this.fanout(set, { t: 'notification.new', v: 1, notification_type: (h as { nt?: string }).nt ?? 'GENERIC' });
    if (!h.c) return this.fanout(set, { t: 'sync.hint', v: 1, sync_version: v });
    if (h.t === 'message.new' && h.s) {
      const { rows } = await this.o.pool.query<{ public_id: string; seq: number; sender_id: number; client_msg_id: string; kind: 'TEXT' | 'PHOTO' | 'GOLD_GIFT' | 'SYSTEM'; body: string | null; created_at: Date; withheld: boolean; media_public: string | null }>(
        `SELECT m.public_id, m.seq, m.sender_id, m.client_msg_id, m.kind, m.body, m.created_at, m.withheld,
                (SELECT mo.public_id FROM ident.media_object mo WHERE mo.id = m.media_id) AS media_public
           FROM ident.message m JOIN ident.conversation c ON c.id = m.conversation_id
           JOIN ident.participant p ON p.conversation_id = c.id AND p.account_id = $1
          WHERE c.public_id = $2 AND m.seq = $3`, [h.a, h.c, h.s]);
      const m = rows[0];
      if (!m || (m.withheld && m.sender_id !== h.a)) return; // never leak a withheld message
      const base = { v: 1, event_id: randomUUID(), conversation_id: h.c, seq: m.seq, message_id: m.public_id, server_ts: m.created_at.toISOString(), sync_version: v };
      return this.fanout(set, m.sender_id === h.a
        ? { t: 'message.committed', ...base, client_msg_id: m.client_msg_id } // the sender's other devices
        : { t: 'message.new', ...base, kind: m.kind, body: m.kind === 'TEXT' ? m.body : null,
            // a recipient's photo is always announced locked; unlock state is read from GET /v1/media/{id}
            media: m.kind === 'PHOTO' && m.media_public ? { media_id: m.media_public, locked: true } : null });
    }
    // conversation changes and receipts: rebuild the viewer's own projection (redaction happens here)
    const conv = await withTx(this.o.pool, (tx) => loadConv(tx, h.a, h.c!)).catch(() => null);
    if (!conv) return;
    const view = convView(conv);
    if (h.t === 'receipts') {
      // what this viewer wants is the counterpart's watermarks (ticks), capped at what the counterpart can see
      const { rows } = await this.o.pool.query<{ delivered_seq: number; read_seq: number }>(
        'SELECT delivered_seq, read_seq FROM ident.participant WHERE conversation_id = $1 AND account_id = $2', [conv.id, conv.other_id]);
      const o = rows[0];
      if (!o) return;
      return this.fanout(set, { t: 'receipt.updated', v: 1, conversation_id: h.c, delivered_seq: Math.min(o.delivered_seq, view.last_seq), read_seq: Math.min(o.read_seq, view.last_seq), sync_version: v });
    }
    return this.fanout(set, { t: 'conversation.updated', v: 1, conversation_id: h.c, state: view.state, counterparty: view.counterparty, sync_version: v });
  }

  private fanout(set: Set<Conn>, event: Record<string, unknown>) {
    for (const c of set) this.send(c, event);
  }
}
