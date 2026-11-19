import type { Tx } from '../db.ts';
import { err } from '../errors.ts';
import { notify } from '../notifications.ts';
import { avatarView } from '../storage.ts';

/**
 * Conversation engine core. Mirrors packages/conversation-model (the executable spec, doc 08): every rule here
 * has a counterpart there, and the differential tests drive both with the same action sequences.
 */

export type ConvState = 'REQUEST' | 'ACTIVE' | 'REJECTED' | 'CLOSED' | 'SEALED';
export const REJECT_COOLDOWN_DAYS = 30; // DEC-17
const OPEN = `('REQUEST','ACTIVE')`;

export interface ConvRow {
  id: number; public_id: string; initiator_id: number; recipient_id: number; revealed: boolean; state: ConvState;
  last_seq: number; withheld_count: number; last_message_at: Date | null; presented_close_at: Date | null;
  presented_state_before: ConvState | null; canonical_public_id: string | null; role: 'INITIATOR' | 'RECIPIENT';
  delivered_seq: number; read_seq: number; peer_delivered_seq: number; peer_read_seq: number; muted_until: Date | null; archived: boolean; other_id: number;
  other_public_id: string; other_display_name: string; other_avatar_key: string | null; full_block: boolean;
}

/** One projection query for "viewer V looks at conversation C" (ADR-016 counterpartyView). */
export const CONV_SELECT = `
  SELECT c.id, c.public_id, c.initiator_id, c.recipient_id, c.initiator_revealed_at IS NOT NULL AS revealed, c.state,
         c.last_seq, c.withheld_count, c.last_message_at, c.presented_close_at, c.presented_state_before,
         cc.public_id AS canonical_public_id, p.role, p.delivered_seq, p.read_seq, p.muted_until,
         op_part.delivered_seq AS peer_delivered_seq, op_part.read_seq AS peer_read_seq,
         p.archived_at IS NOT NULL AS archived, o.id AS other_id, o.public_id AS other_public_id,
         op.display_name AS other_display_name, op.avatar_key AS other_avatar_key,
         EXISTS (SELECT 1 FROM ident.block b WHERE b.kind = 'FULL'
                  AND ((b.blocker_id = p.account_id AND b.blocked_id = o.id) OR (b.blocker_id = o.id AND b.blocked_id = p.account_id))) AS full_block
    FROM ident.participant p
    JOIN ident.conversation c ON c.id = p.conversation_id
    JOIN app.account o ON o.id = CASE WHEN p.role = 'INITIATOR' THEN c.recipient_id ELSE c.initiator_id END
    JOIN app.profile op ON op.account_id = o.id
    JOIN ident.participant op_part ON op_part.conversation_id = c.id AND op_part.account_id = o.id
    LEFT JOIN ident.conversation cc ON cc.id = c.canonical_of`;

export async function loadConv(tx: Tx, viewer: number, publicId: string, lock = false): Promise<ConvRow> {
  if (lock) {
    const l = await tx.query('SELECT 1 FROM ident.conversation WHERE public_id = $1 FOR UPDATE', [publicId]);
    if (!l.rows[0]) throw err.notFound();
  }
  const { rows } = await tx.query<ConvRow>(`${CONV_SELECT} WHERE p.account_id = $1 AND c.public_id = $2`, [viewer, publicId]);
  if (!rows[0]) throw err.notFound(); // non-participants get the same 404 as a missing id
  return rows[0];
}

/** FNV-1a → one of 8 anonymous avatar styles, stable per conversation, unrelated to the hidden identity. */
export function avatarStyle(conversationPublicId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < conversationPublicId.length; i++) h = Math.imul(h ^ conversationPublicId.charCodeAt(i), 0x01000193);
  return (h >>> 0) % 8;
}

const isOpen = (s: ConvState) => s === 'REQUEST' || s === 'ACTIVE';

export function counterpartyOf(c: Pick<ConvRow, 'role' | 'revealed' | 'public_id' | 'other_public_id' | 'other_display_name' | 'other_avatar_key'>) {
  const knows = c.role === 'INITIATOR' || c.revealed; // knowsCounterpart (model)
  return knows
    ? { kind: 'IDENTIFIED' as const, public_user_id: c.other_public_id, display_name: c.other_display_name, avatar: avatarView(c.other_avatar_key) }
    : { kind: 'ANONYMOUS' as const, label_key: 'chat.anonymous_user' as const, avatar_style: avatarStyle(c.public_id) };
}

/** True while the recipient still sees the pre-block presentation (DEC-02b, model observeInbox). */
export const inDelayedPresentation = (c: ConvRow, now = new Date()) =>
  c.role === 'RECIPIENT' && c.presented_close_at !== null && now < c.presented_close_at;

export function convView(c: ConvRow, now = new Date()) {
  const delayed = inDelayedPresentation(c, now);
  const state = delayed ? c.presented_state_before! : c.state;
  // the initiator never sees withheld tail messages, so its watermark excludes them
  const lastSeq = c.role === 'INITIATOR' ? c.last_seq - c.withheld_count : c.last_seq;
  return {
    conversation_id: c.public_id, state, counterparty: counterpartyOf(c), my_role: c.role,
    can_reveal: c.role === 'INITIATOR' && !c.revealed && isOpen(c.state),
    can_send: delayed || (isOpen(c.state) && !c.full_block),
    last_seq: lastSeq, delivered_seq: Math.min(c.delivered_seq, lastSeq), read_seq: Math.min(c.read_seq, lastSeq),
    // capped like the live receipt.updated event: never past what this viewer can see (withheld tail excluded)
    peer_delivered_seq: Math.min(c.peer_delivered_seq, lastSeq), peer_read_seq: Math.min(c.peer_read_seq, lastSeq),
    muted_until: c.muted_until?.toISOString() ?? null, archived: c.archived,
    canonical_conversation_id: c.state === 'SEALED' ? c.canonical_public_id : null,
  };
}

// ---------- sync + realtime fan-out ----------

/**
 * Bumps the per-user sync version and the per-conversation change row for each affected participant, then
 * queues a realtime hint. NOTIFY is transactional: hints are emitted only if the transaction commits.
 * Sync rows are locked in ascending account order (doc 05 §4).
 */
export async function touch(tx: Tx, conversationId: number, accountIds: number[], event: { type: string; conversation: string; seq?: number }) {
  const ids = [...new Set(accountIds)].sort((a, b) => a - b);
  if (!ids.length) return;
  await tx.query('SELECT 1 FROM ident.user_sync_state WHERE account_id = ANY($1::bigint[]) ORDER BY account_id FOR UPDATE', [ids]);
  const { rows } = await tx.query<{ account_id: number; version: number }>(
    `WITH v AS (UPDATE ident.user_sync_state SET version = version + 1 WHERE account_id = ANY($1::bigint[]) RETURNING account_id, version),
          ins AS (INSERT INTO ident.conversation_change (account_id, conversation_id, version) SELECT account_id, $2, version FROM v
                  ON CONFLICT (account_id, conversation_id) DO UPDATE SET version = EXCLUDED.version)
     SELECT account_id, version FROM v`, [ids, conversationId]);
  for (const r of rows) {
    await tx.query("SELECT pg_notify('flero_rt', $1)", [JSON.stringify({ a: r.account_id, v: r.version, t: event.type, c: event.conversation, s: event.seq ?? null })]);
  }
}

/**
 * Monotonic delivered/read watermarks for the viewer, capped at what the viewer can see; read implies
 * delivered. Shared by the REST receipts endpoint and the realtime `ack` frame.
 */
export async function applyReceipts(tx: Tx, c: ConvRow, viewer: number, delivered: number, read: number) {
  const visible = c.role === 'INITIATOR' ? c.last_seq - c.withheld_count : c.last_seq;
  const d = Math.min(delivered, visible);
  const rd = Math.min(read, visible);
  const { rowCount } = await tx.query(
    `UPDATE ident.participant SET delivered_seq = GREATEST(delivered_seq, $3::bigint, $4::bigint), read_seq = GREATEST(read_seq, $4::bigint)
      WHERE conversation_id = $1 AND account_id = $2 AND (delivered_seq < GREATEST($3::bigint, $4::bigint) OR read_seq < $4::bigint)`, [c.id, viewer, d, rd]);
  // the counterpart only hears about receipts in delivered threads; withheld threads stay silent
  if (rowCount && !inDelayedPresentation(c)) await touch(tx, c.id, [viewer, c.other_id], { type: 'receipts', conversation: c.public_id });
}

// ---------- graph rules ----------

export async function blockBetween(tx: Tx, a: number, b: number) {
  const { rows } = await tx.query<{ blocker_id: number; kind: 'FULL' | 'ANON_SHIELD'; shield_retained: boolean }>(
    `SELECT blocker_id, kind, shield_retained FROM ident.block WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)`, [a, b]);
  return {
    full: rows.some((r) => r.kind === 'FULL'),
    /** viewer `a` is shielded by `b`: b shield-blocked a's anonymous thread */
    aShieldedByB: rows.some((r) => r.blocker_id === b && (r.kind === 'ANON_SHIELD' || r.shield_retained)),
  };
}

/** profileMessageAction (model): never consults a thread in which P is still anonymous to V (oracle-free). */
export async function messageAction(tx: Tx, v: number, p: number): Promise<{ kind: 'OPEN_EXISTING'; conversation_id: string } | { kind: 'START_NEW' } | { kind: 'UNAVAILABLE' }> {
  if (v === p) return { kind: 'UNAVAILABLE' };
  const blk = await blockBetween(tx, v, p);
  if (blk.full) return { kind: 'UNAVAILABLE' };
  const { rows } = await tx.query<{ public_id: string; mine: boolean; revealed: boolean }>(
    `SELECT public_id, initiator_id = $1 AS mine, initiator_revealed_at IS NOT NULL AS revealed FROM ident.conversation
      WHERE state IN ${OPEN} AND ((initiator_id = $1 AND recipient_id = $2) OR (initiator_id = $2 AND recipient_id = $1))`, [v, p]);
  const own = rows.find((r) => r.mine);
  if (own) return { kind: 'OPEN_EXISTING', conversation_id: own.public_id };
  const reverse = rows.find((r) => !r.mine);
  if (reverse?.revealed) return { kind: 'OPEN_EXISTING', conversation_id: reverse.public_id };
  const cd = await tx.query(
    `SELECT 1 FROM ident.conversation WHERE initiator_id = $1 AND recipient_id = $2 AND state = 'REJECTED'
        AND rejected_at > now() - make_interval(days => $3) LIMIT 1`, [v, p, REJECT_COOLDOWN_DAYS]);
  if (cd.rows[0]) return { kind: 'UNAVAILABLE' };
  if (blk.aShieldedByB) return { kind: 'UNAVAILABLE' }; // no new anonymous contact (DEC-02)
  return { kind: 'START_NEW' };
}

/** Consolidation (doc 08 §3.3): both directions open and identified → the newer thread is SEALED. */
export async function consolidate(tx: Tx, a: number, b: number) {
  const { rows } = await tx.query<{ id: number; public_id: string; initiator_id: number }>(
    `SELECT id, public_id, initiator_id FROM ident.conversation
      WHERE state IN ${OPEN} AND initiator_revealed_at IS NOT NULL
        AND ((initiator_id = $1 AND recipient_id = $2) OR (initiator_id = $2 AND recipient_id = $1))
      ORDER BY id FOR UPDATE`, [a, b]);
  if (rows.length < 2) return;
  const [older, newer] = [rows[0]!, rows[1]!];
  await tx.query(`UPDATE ident.conversation SET state = 'SEALED', canonical_of = $2 WHERE id = $1`, [newer.id, older.id]);
  await touch(tx, newer.id, [a, b], { type: 'conversation.sealed', conversation: newer.public_id });
}

/** Reveal every non-sealed anonymous thread between a and b (mutual follow). Monotonic: never reverts. */
export async function revealPair(tx: Tx, a: number, b: number) {
  const { rows } = await tx.query<{ id: number; public_id: string }>(
    `UPDATE ident.conversation SET initiator_revealed_at = now(), reveal_cause = 'MUTUAL_FOLLOW'
      WHERE initiator_revealed_at IS NULL AND state <> 'SEALED'
        AND ((initiator_id = $1 AND recipient_id = $2) OR (initiator_id = $2 AND recipient_id = $1))
      RETURNING id, public_id`, [a, b]);
  for (const r of rows) await touch(tx, r.id, [a, b], { type: 'conversation.revealed', conversation: r.public_id });
  await consolidate(tx, a, b);
}

async function dropFollow(tx: Tx, from: number, to: number) {
  const { rowCount } = await tx.query('DELETE FROM app.follow WHERE follower_id = $1 AND followee_id = $2', [from, to]);
  if (rowCount) await tx.query('UPDATE app.profile_counter SET followers = followers - 1 WHERE account_id = $1', [to]);
}

/** FULL block (model blockFull). Keeps an earlier shield as shield_retained so unblock restores it. */
export async function blockFull(tx: Tx, by: number, target: number) {
  if (by === target) throw err.unavailable();
  await tx.query('SELECT 1 FROM app.account WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE', [[by, target]]);
  await tx.query(
    `INSERT INTO ident.block (blocker_id, blocked_id, kind) VALUES ($1, $2, 'FULL')
     ON CONFLICT (blocker_id, blocked_id) DO UPDATE SET kind = 'FULL',
       shield_retained = ident.block.shield_retained OR ident.block.kind = 'ANON_SHIELD'`, [by, target]);
  await dropFollow(tx, by, target);
  await dropFollow(tx, target, by);
  const { rows } = await tx.query<{ id: number; public_id: string; hidden_from_blocker: boolean; state: ConvState }>(
    `SELECT id, public_id, state, (initiator_id = $2 AND recipient_id = $1 AND initiator_revealed_at IS NULL) AS hidden_from_blocker
       FROM ident.conversation WHERE state IN ${OPEN}
        AND ((initiator_id = $1 AND recipient_id = $2) OR (initiator_id = $2 AND recipient_id = $1)) FOR UPDATE`, [by, target]);
  for (const t of rows) {
    if (t.hidden_from_blocker) {
      // DEC-02b: random 1–24 h presentation delay for the blocker
      await tx.query(
        `UPDATE ident.conversation SET state = 'CLOSED', presented_state_before = $2,
                presented_close_at = now() + make_interval(secs => 3600 + floor(random() * 82800)::int) WHERE id = $1`, [t.id, t.state]);
      await touch(tx, t.id, [target], { type: 'conversation.closed', conversation: t.public_id });
    } else {
      await tx.query(`UPDATE ident.conversation SET state = 'CLOSED' WHERE id = $1`, [t.id]);
      await touch(tx, t.id, [by, target], { type: 'conversation.closed', conversation: t.public_id });
    }
  }
}

export async function unblock(tx: Tx, by: number, target: number) {
  const { rows } = await tx.query<{ kind: string; shield_retained: boolean }>(
    'SELECT kind, shield_retained FROM ident.block WHERE blocker_id = $1 AND blocked_id = $2 FOR UPDATE', [by, target]);
  const b = rows[0];
  if (b?.kind !== 'FULL') return; // a shield is not user-removable in v1
  if (b.shield_retained) {
    await tx.query(`UPDATE ident.block SET kind = 'ANON_SHIELD', shield_retained = false WHERE blocker_id = $1 AND blocked_id = $2`, [by, target]);
  } else {
    await tx.query('DELETE FROM ident.block WHERE blocker_id = $1 AND blocked_id = $2', [by, target]);
  }
  // no auto-restore of follows or threads (REQ-SOC-08)
}

/** Shield block from an anonymous thread (DEC-02): recipient never learns who it was; initiator sees a close. */
export async function shieldBlock(tx: Tx, c: ConvRow) {
  await tx.query(
    `INSERT INTO ident.block (blocker_id, blocked_id, kind, origin_conversation_id) VALUES ($1, $2, 'ANON_SHIELD', $3)
     ON CONFLICT (blocker_id, blocked_id) DO NOTHING`, [c.recipient_id, c.initiator_id, c.id]);
  await tx.query(`UPDATE ident.conversation SET state = 'CLOSED' WHERE id = $1 AND state IN ${OPEN}`, [c.id]);
  await touch(tx, c.id, [c.initiator_id, c.recipient_id], { type: 'conversation.closed', conversation: c.public_id });
}

export async function follow(tx: Tx, from: number, to: number) {
  if (from === to) throw err.unavailable();
  const blk = await blockBetween(tx, from, to);
  if (blk.full) throw err.unavailable();
  if (blk.aShieldedByB) return; // silent no-op: the shielded initiator learns nothing (model 'follow')
  await tx.query('SELECT 1 FROM app.account WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE', [[from, to]]);
  const ins = await tx.query('INSERT INTO app.follow (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [from, to]);
  if (!ins.rowCount) return;
  await tx.query('UPDATE app.profile_counter SET followers = followers + 1 WHERE account_id = $1', [to]);
  await notify(tx, { recipient: to, type: 'FOLLOW', ref: `follow:${from}` });
  const mutual = await tx.query('SELECT 1 FROM app.follow WHERE follower_id = $1 AND followee_id = $2', [to, from]);
  if (!mutual.rows[0]) return;
  const pair = from < to ? `${from}:${to}` : `${to}:${from}`;
  await notify(tx, { recipient: from, type: 'FRIENDSHIP', ref: `friend:${pair}` });
  await notify(tx, { recipient: to, type: 'FRIENDSHIP', ref: `friend:${pair}` });
  await revealPair(tx, from, to);
  // identity is now known on both sides: a shield between them upgrades to a FULL block (doc 10 §3.1)
  const shields = await tx.query<{ blocker_id: number; blocked_id: number }>(
    `SELECT blocker_id, blocked_id FROM ident.block WHERE kind = 'ANON_SHIELD'
        AND ((blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1))`, [from, to]);
  for (const s of shields.rows) await blockFull(tx, s.blocker_id, s.blocked_id);
}

export async function unfollow(tx: Tx, from: number, to: number) {
  if ((await blockBetween(tx, from, to)).aShieldedByB) return; // frozen edge keeps "Seni takip ediyor" stable
  await dropFollow(tx, from, to); // never un-reveals
}
