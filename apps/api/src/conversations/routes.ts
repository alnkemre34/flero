import {
  ConversationView, GoldGiftRequest, InboxEntry, Message, MuteRequest, ReceiptsRequest, ReportRequest, SendMessageRequest,
  StartConversationRequest, SyncResponse, Wallet,
} from '@flero/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTx, type Tx } from '../db.ts';
import { err } from '../errors.ts';
import { decodeCursor, encodeCursor, idempotencyKey, ListQuery } from '../http.ts';
import { fingerprint, publicId } from '../ids.ts';
import type { Deps } from '../server.ts';
import { notify, queueMessagePush } from '../notifications.ts';
import { resolveUser } from '../social/routes.ts';
import { assertCanSpend, lockWallets, postLedger, walletView } from '../wallet/ledger.ts';
import {
  applyReceipts, blockFull, CONV_SELECT, consolidate, convView, counterpartyOf, inDelayedPresentation, loadConv, messageAction, shieldBlock, touch,
  type ConvRow,
} from './core.ts';

const ConvParam = z.strictObject({ conversation_id: z.string().regex(/^cnv_[a-z2-7]{26}$/) });
const SYNC_PAGE = 200;

type MsgRow = { public_id: string; seq: number; sender_id: number; kind: 'TEXT' | 'PHOTO' | 'GOLD_GIFT' | 'SYSTEM'; body: string | null; created_at: Date; media_public: string | null };
const messageView = (m: MsgRow, conv: string, viewer: number) => ({
  message_id: m.public_id, conversation_id: conv, seq: m.seq, mine: m.sender_id === viewer, kind: m.kind,
  body: m.kind === 'TEXT' ? m.body : null, media_id: m.kind === 'PHOTO' ? m.media_public : null,
  system_key: m.kind === 'GOLD_GIFT' ? 'chat.system.gold_gift' : null, server_ts: m.created_at.toISOString(),
});

export const canSendNow = (c: ConvRow) => inDelayedPresentation(c) || ((c.state === 'REQUEST' || c.state === 'ACTIVE') && !c.full_block);

/**
 * Appends one message with the next seq under the conversation row lock (the lock IS the sequencer).
 * Idempotent on (conversation, sender, client_msg_id). During a DEC-02b delay the message is withheld.
 */
export async function appendMessage(tx: Tx, c: ConvRow, sender: number, m: { clientMsgId: string; kind: 'TEXT' | 'GOLD_GIFT' | 'PHOTO'; body?: string; ledgerTxnId?: number; mediaId?: number }) {
  const prior = await tx.query<{ seq: number }>(
    'SELECT seq FROM ident.message_idem_recent WHERE conversation_id = $1 AND sender_id = $2 AND client_msg_id = $3', [c.id, sender, m.clientMsgId]);
  if (prior.rows[0]) {
    const { rows } = await tx.query<MsgRow>(
      'SELECT m.public_id, m.seq, m.sender_id, m.kind, m.body, m.created_at, (SELECT mo.public_id FROM ident.media_object mo WHERE mo.id = m.media_id) AS media_public FROM ident.message m WHERE m.conversation_id = $1 AND m.seq = $2', [c.id, prior.rows[0].seq]);
    return { msg: rows[0]!, replayed: true };
  }
  if (!canSendNow(c)) throw err.unavailable();
  const withheld = c.state === 'CLOSED' && inDelayedPresentation(c);
  const seq = c.last_seq + 1;
  const { rows } = await tx.query<MsgRow>(
    `INSERT INTO ident.message (conversation_id, seq, public_id, sender_id, client_msg_id, kind, body, ledger_txn_id, withheld, media_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING public_id, seq, sender_id, kind, body, created_at, (SELECT mo.public_id FROM ident.media_object mo WHERE mo.id = media_id) AS media_public`,
    [c.id, seq, publicId('msg'), sender, m.clientMsgId, m.kind, m.body ?? null, m.ledgerTxnId ?? null, withheld, m.mediaId ?? null]);
  await tx.query('INSERT INTO ident.message_idem_recent (conversation_id, sender_id, client_msg_id, seq) VALUES ($1, $2, $3, $4)', [c.id, sender, m.clientMsgId, seq]);
  await tx.query(
    `UPDATE ident.conversation SET last_seq = $2, last_message_at = now(), first_message_at = COALESCE(first_message_at, now()),
            withheld_count = withheld_count + $3::int WHERE id = $1`, [c.id, seq, withheld ? 1 : 0]);
  // own messages are delivered+read for the sender; un-archive for both on new activity
  await tx.query('UPDATE ident.participant SET delivered_seq = $3, read_seq = $3, archived_at = NULL WHERE conversation_id = $1 AND account_id = $2', [c.id, sender, seq]);
  if (!withheld) {
    await tx.query('UPDATE ident.participant SET archived_at = NULL WHERE conversation_id = $1 AND account_id = $2', [c.id, c.other_id]);
    await touch(tx, c.id, [sender, c.other_id], { type: 'message.new', conversation: c.public_id, seq });
    if ((m.kind === 'TEXT' || m.kind === 'PHOTO') && seq > 1) await queueMessagePush(tx, c.other_id, c.public_id); // first message = MESSAGE_REQUEST
  } else {
    await touch(tx, c.id, [sender], { type: 'message.new', conversation: c.public_id, seq });
  }
  return { msg: rows[0]!, replayed: false };
}

export function conversationRoutes(app: FastifyInstance, deps: Deps) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const me = (req: { auth?: { aid: number } }) => req.auth!.aid;

  r.post('/v1/conversations', { schema: { body: StartConversationRequest, response: { 201: ConversationView } } }, async (req, reply) => {
    idempotencyKey(req);
    const v = me(req);
    const out = await withTx(deps.pool, async (tx) => {
      const p = await resolveUser(tx, v, req.body.recipient);
      await tx.query('SELECT 1 FROM app.account WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE', [[v, p]]); // serialise starts per pair
      const action = await messageAction(tx, v, p);
      let publicConv: string;
      if (action.kind === 'UNAVAILABLE') throw err.unavailable();
      if (action.kind === 'OPEN_EXISTING') {
        publicConv = action.conversation_id; // retry / double-tap: deliver into the existing thread
      } else {
        const mutual = await tx.query(
          'SELECT count(*)::int AS n FROM app.follow WHERE (follower_id = $1 AND followee_id = $2) OR (follower_id = $2 AND followee_id = $1)', [v, p]);
        const revealed = mutual.rows[0].n === 2; // an already-mutual pair reveals at creation
        publicConv = publicId('cnv');
        const ins = await tx.query<{ id: number }>(
          `INSERT INTO ident.conversation (public_id, initiator_id, recipient_id, initiator_revealed_at, reveal_cause)
           VALUES ($1, $2, $3, CASE WHEN $4 THEN now() END, CASE WHEN $4 THEN 'MUTUAL_FOLLOW' END) RETURNING id`, [publicConv, v, p, revealed]);
        await tx.query(
          `INSERT INTO ident.participant (conversation_id, account_id, role, accepted_at) VALUES ($1, $2, 'INITIATOR', now()), ($1, $3, 'RECIPIENT', NULL)`,
          [ins.rows[0]!.id, v, p]);
        await notify(tx, { recipient: p, type: 'MESSAGE_REQUEST', ref: publicConv, conversation: publicConv });
      }
      const c = await loadConv(tx, v, publicConv, true);
      await appendMessage(tx, c, v, { clientMsgId: req.body.first_message.client_msg_id, kind: 'TEXT', body: req.body.first_message.body });
      return convView(await loadConv(tx, v, publicConv));
    });
    reply.code(201);
    return out;
  });

  r.get('/v1/conversations/:conversation_id', { schema: { params: ConvParam, response: { 200: ConversationView } } }, async (req) =>
    withTx(deps.pool, async (tx) => convView(await loadConv(tx, me(req), req.params.conversation_id))));

  r.post('/v1/conversations/:conversation_id/messages', { schema: { params: ConvParam, body: SendMessageRequest, response: { 201: Message, 200: Message } } }, async (req, reply) => {
    idempotencyKey(req);
    const v = me(req);
    const { msg, replayed } = await withTx(deps.pool, async (tx) =>
      appendMessage(tx, await loadConv(tx, v, req.params.conversation_id, true), v, { clientMsgId: req.body.client_msg_id, kind: 'TEXT', body: req.body.body }));
    reply.code(replayed ? 200 : 201);
    return messageView(msg, req.params.conversation_id, v);
  });

  r.get('/v1/conversations/:conversation_id/messages', {
    schema: { params: ConvParam, querystring: ListQuery.extend({ after_seq: z.coerce.number().int().min(0).optional() }), response: { 200: z.array(Message) } },
  }, async (req, reply) => {
    const v = me(req);
    const c = await withTx(deps.pool, (tx) => loadConv(tx, v, req.params.conversation_id));
    const hideWithheld = c.role === 'INITIATOR';
    const cur = decodeCursor(req.query.cursor, z.strictObject({ s: z.number().int() }));
    // two modes: catch-up ascending after a seq (gap fill), or history descending before a cursor
    const asc = req.query.after_seq !== undefined;
    const { rows } = await deps.pool.query<MsgRow>(
      `SELECT m.public_id, m.seq, m.sender_id, m.kind, m.body, m.created_at, (SELECT mo.public_id FROM ident.media_object mo WHERE mo.id = m.media_id) AS media_public FROM ident.message m
        WHERE m.conversation_id = $1 AND (NOT $2 OR NOT m.withheld)
          AND ($3::bigint IS NULL OR m.seq > $3) AND ($4::bigint IS NULL OR m.seq < $4)
        ORDER BY m.seq ${asc ? 'ASC' : 'DESC'} LIMIT $5`,
      [c.id, hideWithheld, req.query.after_seq ?? null, cur?.s ?? null, req.query.limit + 1]);
    const page = rows.slice(0, req.query.limit);
    if (!asc && rows.length > req.query.limit) reply.header('x-next-cursor', encodeCursor({ s: page.at(-1)!.seq }));
    return page.map((m) => messageView(m, c.public_id, v));
  });

  r.post('/v1/conversations/:conversation_id/receipts', { schema: { params: ConvParam, body: ReceiptsRequest } }, async (req, reply) => {
    const v = me(req);
    await withTx(deps.pool, async (tx) => {
      const c = await loadConv(tx, v, req.params.conversation_id);
      await applyReceipts(tx, c, v, req.body.delivered_seq ?? 0, req.body.read_seq ?? 0);
    });
    reply.code(204).send();
  });

  const transition = (path: string, fn: (tx: Tx, c: ConvRow, v: number) => Promise<void>, idem = true) =>
    r.post(`/v1/conversations/:conversation_id/${path}`, { schema: { params: ConvParam, response: { 200: ConversationView } } }, async (req) => {
      if (idem) idempotencyKey(req);
      const v = me(req);
      return withTx(deps.pool, async (tx) => {
        await fn(tx, await loadConv(tx, v, req.params.conversation_id, true), v);
        return convView(await loadConv(tx, v, req.params.conversation_id));
      });
    });

  transition('reveal', async (tx, c) => {
    if (c.role !== 'INITIATOR') throw err.unavailable();
    if (c.revealed) return; // idempotent; reveal is irreversible
    if (c.state !== 'REQUEST' && c.state !== 'ACTIVE') throw err.unavailable();
    await tx.query(`UPDATE ident.conversation SET initiator_revealed_at = now(), reveal_cause = 'SELF' WHERE id = $1`, [c.id]);
    await touch(tx, c.id, [c.initiator_id, c.recipient_id], { type: 'conversation.revealed', conversation: c.public_id });
    await notify(tx, { recipient: c.recipient_id, type: 'REVEAL', ref: `reveal:${c.public_id}`, conversation: c.public_id });
    await consolidate(tx, c.initiator_id, c.recipient_id);
  });

  transition('accept', async (tx, c) => {
    if (c.role !== 'RECIPIENT') throw err.unavailable();
    if (c.state === 'ACTIVE') return;
    if (c.state !== 'REQUEST' || inDelayedPresentation(c)) throw err.conflict('ACTION_UNAVAILABLE');
    await tx.query(`UPDATE ident.conversation SET state = 'ACTIVE' WHERE id = $1`, [c.id]);
    await tx.query('UPDATE ident.participant SET accepted_at = now() WHERE conversation_id = $1 AND account_id = $2', [c.id, c.recipient_id]);
    await touch(tx, c.id, [c.initiator_id, c.recipient_id], { type: 'conversation.accepted', conversation: c.public_id });
    await notify(tx, { recipient: c.initiator_id, type: 'REQUEST_ACCEPTED', ref: `accepted:${c.public_id}`, conversation: c.public_id });
  });

  transition('reject', async (tx, c) => {
    if (c.role !== 'RECIPIENT') throw err.unavailable();
    if (c.state === 'REJECTED') return;
    if (c.state !== 'REQUEST' || inDelayedPresentation(c)) throw err.conflict('ACTION_UNAVAILABLE');
    await tx.query(`UPDATE ident.conversation SET state = 'REJECTED', rejected_at = now() WHERE id = $1`, [c.id]);
    await touch(tx, c.id, [c.initiator_id, c.recipient_id], { type: 'conversation.rejected', conversation: c.public_id });
  });

  transition('archive', async (tx, c, v) => {
    await tx.query('UPDATE ident.participant SET archived_at = COALESCE(archived_at, now()) WHERE conversation_id = $1 AND account_id = $2', [c.id, v]);
    await touch(tx, c.id, [v], { type: 'conversation.updated', conversation: c.public_id });
  }, false);
  transition('unarchive', async (tx, c, v) => {
    await tx.query('UPDATE ident.participant SET archived_at = NULL WHERE conversation_id = $1 AND account_id = $2', [c.id, v]);
    await touch(tx, c.id, [v], { type: 'conversation.updated', conversation: c.public_id });
  }, false);

  r.post('/v1/conversations/:conversation_id/mute', { schema: { params: ConvParam, body: MuteRequest, response: { 200: ConversationView } } }, async (req) => {
    const v = me(req);
    return withTx(deps.pool, async (tx) => {
      const c = await loadConv(tx, v, req.params.conversation_id);
      await tx.query('UPDATE ident.participant SET muted_until = $3 WHERE conversation_id = $1 AND account_id = $2', [c.id, v, req.body.until]);
      return convView(await loadConv(tx, v, req.params.conversation_id));
    });
  });

  /** Block without knowing the counterpart's id: shield in an anonymous thread, FULL otherwise (DEC-02). */
  r.post('/v1/conversations/:conversation_id/block', { schema: { params: ConvParam } }, async (req, reply) => {
    idempotencyKey(req);
    const v = me(req);
    await withTx(deps.pool, async (tx) => {
      const c = await loadConv(tx, v, req.params.conversation_id, true);
      if (c.role === 'RECIPIENT' && !c.revealed) await shieldBlock(tx, c);
      else await blockFull(tx, v, c.other_id);
    });
    reply.code(204).send();
  });

  // ---------- Gold gift: exactly 1 Gold, no amount field (REQ-GLD-05) ----------
  r.post('/v1/conversations/:conversation_id/gold-gifts', { schema: { params: ConvParam, body: GoldGiftRequest, response: { 201: Wallet } } }, async (req, reply) => {
    const key = idempotencyKey(req);
    const v = me(req);
    const out = await withTx(deps.pool, async (tx) => {
      const peek = await loadConv(tx, v, req.params.conversation_id);
      // lock order: wallets (ascending) → conversation (doc 05 §4)
      const wallets = await lockWallets(tx, [v, peek.other_id]);
      const c = await loadConv(tx, v, req.params.conversation_id, true);
      const prior = await tx.query('SELECT 1 FROM app.ledger_transaction WHERE account_id = $1 AND op_type = $2 AND idempotency_key = $3', [v, 'GIFT_SEND', key]);
      if (prior.rows[0]) return walletView(tx, v); // replay: already sent
      if (!canSendNow(c)) throw err.unavailable();
      assertCanSpend(wallets.get(v), 1);
      const hash = fingerprint({ conversation: c.public_id });
      // two legs through a transit account: neither ledger row names the other party (C1a)
      const sent = await postLedger(tx, { op: 'GIFT_SEND', account: v, key, hash, actor: 'user',
        postings: [{ account: 'USER_AVAILABLE', owner: v, amount: -1 }, { account: 'SYS_GIFT_TRANSIT', amount: 1 }] });
      const recv = await postLedger(tx, { op: 'GIFT_RECEIVE', account: c.other_id, key: `gift:${sent.txnId}`, hash, actor: 'system',
        postings: [{ account: 'SYS_GIFT_TRANSIT', amount: -1 }, { account: 'USER_AVAILABLE', owner: c.other_id, amount: 1 }] });
      await tx.query('INSERT INTO ident.gift_link (sender_txn_id, recipient_txn_id, conversation_id) VALUES ($1, $2, $3)', [sent.txnId, recv.txnId, c.id]);
      await appendMessage(tx, c, v, { clientMsgId: key, kind: 'GOLD_GIFT', ledgerTxnId: sent.txnId });
      if (!inDelayedPresentation(c)) await notify(tx, { recipient: c.other_id, type: 'GOLD_GIFT', ref: `gift:${recv.publicId}`, conversation: c.public_id });
      return walletView(tx, v);
    });
    reply.code(201);
    return out;
  });

  // ---------- inbox ----------
  const inboxQuery = async (v: number, where: string, params: unknown[], q: { cursor?: string | undefined; limit: number }) => {
    const cur = decodeCursor(q.cursor, z.strictObject({ t: z.number(), i: z.number().int() }));
    const n = params.length;
    const { rows } = await deps.pool.query<ConvRow & { preview: string | null; last_kind: 'TEXT' | 'PHOTO' | 'GOLD_GIFT' | 'SYSTEM' | null; unread: number; sort_t: number }>(
      `SELECT x.*, (SELECT CASE WHEN m.kind = 'TEXT' THEN left(m.body, 140) END FROM ident.message m
                     WHERE m.conversation_id = x.id AND (x.role = 'RECIPIENT' OR NOT m.withheld) ORDER BY m.seq DESC LIMIT 1) AS preview,
              (SELECT m.kind FROM ident.message m
                     WHERE m.conversation_id = x.id AND (x.role = 'RECIPIENT' OR NOT m.withheld) ORDER BY m.seq DESC LIMIT 1) AS last_kind,
              GREATEST(0, (CASE WHEN x.role = 'INITIATOR' THEN x.last_seq - x.withheld_count ELSE x.last_seq END) - x.read_seq)::int AS unread,
              extract(epoch FROM COALESCE(x.last_message_at, 'epoch'))::float8 AS sort_t
         FROM (${CONV_SELECT} WHERE p.account_id = $1 AND ${where}) x
        WHERE ($${n + 2}::float8 IS NULL OR (extract(epoch FROM COALESCE(x.last_message_at, 'epoch')), x.id) < ($${n + 2}, $${n + 3}))
        ORDER BY sort_t DESC, x.id DESC LIMIT $${n + 4}`,
      [v, ...params, cur?.t ?? null, cur?.i ?? null, q.limit + 1]);
    const page = rows.slice(0, q.limit);
    const next = rows.length > q.limit ? encodeCursor({ t: page.at(-1)!.sort_t, i: page.at(-1)!.id }) : null;
    return {
      next,
      items: page.map((c) => ({
        conversation: convView(c), last_message_preview: c.preview, last_message_kind: c.last_kind, last_message_at: c.last_message_at?.toISOString() ?? null,
        unread_count: c.unread,
      })),
    };
  };
  const FILTERS = {
    // requests: incoming, not yet accepted; main: accepted/own threads; SEALED twins never show (consolidated)
    main: `c.state <> 'SEALED' AND p.archived_at IS NULL AND NOT (p.role = 'RECIPIENT' AND COALESCE(c.presented_state_before, c.state) = 'REQUEST')`,
    requests: `c.state <> 'SEALED' AND p.archived_at IS NULL AND p.role = 'RECIPIENT' AND COALESCE(c.presented_state_before, c.state) = 'REQUEST'`,
    archived: `c.state <> 'SEALED' AND p.archived_at IS NOT NULL`,
  } as const;

  r.get('/v1/inbox', { schema: { querystring: ListQuery.extend({ filter: z.enum(['main', 'requests', 'archived']) }), response: { 200: z.array(InboxEntry) } } }, async (req, reply) => {
    const { items, next } = await inboxQuery(me(req), FILTERS[req.query.filter], [], req.query);
    if (next) reply.header('x-next-cursor', next);
    return items;
  });

  // searches message text and viewer-visible labels only — never a hidden identity
  r.get('/v1/inbox/search', { schema: { querystring: ListQuery.extend({ q: z.string().min(2).max(64) }), response: { 200: z.array(InboxEntry) } } }, async (req, reply) => {
    const like = `%${req.query.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    const { items, next } = await inboxQuery(me(req),
      `c.state <> 'SEALED' AND ((p.role = 'INITIATOR' OR c.initiator_revealed_at IS NOT NULL) AND op.display_name ILIKE $2
        OR EXISTS (SELECT 1 FROM ident.message m WHERE m.conversation_id = c.id AND m.kind = 'TEXT' AND m.body ILIKE $2
                    AND (p.role = 'RECIPIENT' OR NOT m.withheld)))`, [like], req.query);
    if (next) reply.header('x-next-cursor', next);
    return items;
  });

  // ---------- sync (doc 06 §5): changed conversations since a version ----------
  r.get('/v1/sync', { schema: { querystring: z.strictObject({ since: z.coerce.number().int().min(0).default(0) }), response: { 200: SyncResponse } } }, async (req) => {
    const v = me(req);
    const ver = await deps.pool.query<{ version: number }>('SELECT version FROM ident.user_sync_state WHERE account_id = $1', [v]);
    const version = ver.rows[0]?.version ?? 0;
    if (req.query.since > version) return { version, full_resync_required: true, changed: [] };
    const { rows } = await deps.pool.query<ConvRow>(
      `${CONV_SELECT} JOIN ident.conversation_change ch ON ch.account_id = p.account_id AND ch.conversation_id = c.id
        WHERE p.account_id = $1 AND ch.version > $2 ORDER BY ch.version LIMIT ${SYNC_PAGE + 1}`, [v, req.query.since]);
    if (rows.length > SYNC_PAGE) return { version, full_resync_required: true, changed: [] };
    return {
      version, full_resync_required: false,
      changed: rows.map((c) => {
        const view = convView(c);
        return { conversation_id: view.conversation_id, state: view.state, last_seq: view.last_seq, delivered_seq: view.delivered_seq, read_seq: view.read_seq, counterparty: counterpartyOf(c) };
      }),
    };
  });

  // ---------- reports (no Gold needed; MINOR_SAFETY jumps the queue) ----------
  r.post('/v1/reports', { schema: { body: ReportRequest } }, async (req, reply) => {
    const key = idempotencyKey(req);
    const v = me(req);
    await withTx(deps.pool, async (tx) => {
      const t = req.body.target;
      let targetAccount: number | null = null;
      let conv: number | null = null;
      if (t.type === 'PROFILE') {
        const { rows } = await tx.query<{ id: number }>('SELECT id FROM app.account WHERE public_id = $1', [t.id]);
        if (!rows[0]) throw err.notFound();
        targetAccount = rows[0].id;
      } else if (t.type === 'CONVERSATION') {
        const c = await loadConv(tx, v, t.id);
        conv = c.id; targetAccount = c.other_id; // resolved server-side: the reporter never needs the hidden id
      } else if (t.type === 'MESSAGE') {
        const { rows } = await tx.query<{ conversation_id: number; sender_id: number }>(
          `SELECT m.conversation_id, m.sender_id FROM ident.message m JOIN ident.participant p ON p.conversation_id = m.conversation_id AND p.account_id = $2
            WHERE m.public_id = $1 AND m.sender_id <> $2`, [t.id, v]);
        if (!rows[0]) throw err.notFound();
        conv = rows[0].conversation_id; targetAccount = rows[0].sender_id;
      }
      await tx.query(
        `INSERT INTO ident.report (reporter_id, target_type, target_account_id, conversation_id, target_ref, reason, note, priority, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (reporter_id, idempotency_key) DO NOTHING`,
        [v, t.type, targetAccount, conv, t.id, req.body.reason, req.body.note ?? null, req.body.reason === 'MINOR_SAFETY' ? 0 : 2, key]);
    });
    reply.code(204).send();
  });
}
