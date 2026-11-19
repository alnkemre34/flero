import { NotificationPrefs, PushTokenRequest } from '@flero/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from './db.ts';
import { sha256 } from './ids.ts';
import type { Deps } from './server.ts';

/**
 * The single notification gateway (doc 09). Every product event calls notify(), inside the same transaction as
 * the event, so a notification exists iff the event committed. It writes:
 *  1. the in-app centre row (deduplicated by recipient + type + ref, so retries never double-notify),
 *  2. a realtime hint (NOTIFY fires only on commit),
 *  3. a push job in the outbox — only if the recipient's preferences allow it (security/moderation always).
 * Copy is generic by design: no row ever names an anonymous counterpart.
 */
export type NotifType =
  | 'MESSAGE_REQUEST' | 'REQUEST_ACCEPTED' | 'PHOTO_RECEIVED' | 'PHOTO_UNLOCKED' | 'GOLD_GIFT' | 'FOLLOW' | 'LIKE'
  | 'FRIENDSHIP' | 'REVEAL' | 'PLUS_LIFECYCLE' | 'BOOST_LIFECYCLE' | 'WALLET' | 'SECURITY' | 'MODERATION';

type Topic = 'messages' | 'requests' | 'social' | 'gifts_unlocks' | 'plus_boost' | 'wallet' | null;
export const TOPIC: Record<NotifType | 'MESSAGE', Topic> = {
  MESSAGE: 'messages', MESSAGE_REQUEST: 'requests', REQUEST_ACCEPTED: 'requests', PHOTO_RECEIVED: 'gifts_unlocks',
  PHOTO_UNLOCKED: 'gifts_unlocks', GOLD_GIFT: 'gifts_unlocks', FOLLOW: 'social', LIKE: 'social', FRIENDSHIP: 'social',
  REVEAL: 'social', PLUS_LIFECYCLE: 'plus_boost', BOOST_LIFECYCLE: 'plus_boost', WALLET: 'wallet',
  SECURITY: null, MODERATION: null, // cannot be disabled
};

async function queuePush(tx: Tx, recipient: number, type: NotifType | 'MESSAGE', conversation: string | null) {
  const topic = TOPIC[type];
  if (topic) {
    const { rows } = await tx.query<{ on: boolean }>(`SELECT COALESCE((SELECT ${topic} FROM app.notification_prefs WHERE account_id = $1), $2) AS on`, [recipient, true]);
    if (!rows[0]!.on) return;
  }
  await tx.query(`INSERT INTO ident.outbox_event (topic, payload) VALUES ('push', $1)`,
    [JSON.stringify({ account_id: recipient, type, title_key: `push.${type}`, conversation_ref: conversation })]);
}

export async function notify(tx: Tx, n: { recipient: number; type: NotifType; ref: string; conversation?: string | null }) {
  const { rowCount } = await tx.query(
    `INSERT INTO ident.notification (recipient_id, event_type, domain_ref, conversation_ref) VALUES ($1, $2, $3, $4)
     ON CONFLICT (recipient_id, event_type, domain_ref) DO NOTHING`, [n.recipient, n.type, n.ref, n.conversation ?? null]);
  if (!rowCount) return; // already notified for this event
  await tx.query("SELECT pg_notify('flero_rt', $1)", [JSON.stringify({ a: n.recipient, t: 'notification.new', nt: n.type })]);
  await queuePush(tx, n.recipient, n.type, n.conversation ?? null);
}

/** New-message push (no centre row: the inbox is the centre for messages). Preview text is never included. */
export const queueMessagePush = (tx: Tx, recipient: number, conversation: string) => queuePush(tx, recipient, 'MESSAGE', conversation);

// ---------- preferences + device registration ----------

const PREF_SQL = `SELECT messages, requests, social, gifts_unlocks, plus_boost, wallet, marketing, message_preview, quiet_start, quiet_end, quiet_tz
  FROM app.notification_prefs WHERE account_id = $1`;
type PrefRow = { messages: boolean; requests: boolean; social: boolean; gifts_unlocks: boolean; plus_boost: boolean; wallet: boolean; marketing: boolean; message_preview: boolean; quiet_start: string | null; quiet_end: string | null; quiet_tz: string | null };
const DEFAULTS: PrefRow = { messages: true, requests: true, social: true, gifts_unlocks: true, plus_boost: true, wallet: true, marketing: false, message_preview: false, quiet_start: null, quiet_end: null, quiet_tz: null };
const view = (r: PrefRow) => ({
  topics: { messages: r.messages, requests: r.requests, social: r.social, gifts_unlocks: r.gifts_unlocks, plus_boost: r.plus_boost, wallet: r.wallet, marketing: r.marketing },
  quiet_hours: r.quiet_start && r.quiet_end ? { start: r.quiet_start, end: r.quiet_end, tz: r.quiet_tz ?? 'Europe/Istanbul' } : null,
  message_preview: r.message_preview,
});

export function notificationPrefRoutes(app: FastifyInstance, deps: Deps) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get('/v1/me/notification-preferences', { schema: { response: { 200: NotificationPrefs } } }, async (req) => {
    const { rows } = await deps.pool.query<PrefRow>(PREF_SQL, [req.auth!.aid]);
    return view(rows[0] ?? DEFAULTS);
  });
  r.put('/v1/me/notification-preferences', { schema: { body: NotificationPrefs, response: { 200: NotificationPrefs } } }, async (req) => {
    const b = req.body;
    const { rows } = await deps.pool.query<PrefRow>(
      `INSERT INTO app.notification_prefs (account_id, messages, requests, social, gifts_unlocks, plus_boost, wallet, marketing, message_preview, quiet_start, quiet_end, quiet_tz, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
       ON CONFLICT (account_id) DO UPDATE SET messages = EXCLUDED.messages, requests = EXCLUDED.requests, social = EXCLUDED.social,
         gifts_unlocks = EXCLUDED.gifts_unlocks, plus_boost = EXCLUDED.plus_boost, wallet = EXCLUDED.wallet, marketing = EXCLUDED.marketing,
         message_preview = EXCLUDED.message_preview, quiet_start = EXCLUDED.quiet_start, quiet_end = EXCLUDED.quiet_end, quiet_tz = EXCLUDED.quiet_tz, updated_at = now()
       RETURNING messages, requests, social, gifts_unlocks, plus_boost, wallet, marketing, message_preview, quiet_start, quiet_end, quiet_tz`,
      [req.auth!.aid, b.topics.messages, b.topics.requests, b.topics.social, b.topics.gifts_unlocks, b.topics.plus_boost, b.topics.wallet, b.topics.marketing,
        b.message_preview, b.quiet_hours?.start ?? null, b.quiet_hours?.end ?? null, b.quiet_hours?.tz ?? null]);
    return view(rows[0]!);
  });

  /**
   * Device push token (APNs/FCM). The token is stored hashed (lookup) + sealed (delivery); the sealing key and the
   * provider clients are the push INTEGRATION — in development the token is kept as-is and the worker only logs.
   */
  const Installation = z.strictObject({ installation_id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/) });
  r.put('/v1/me/devices/:installation_id/push-token', { schema: { params: Installation, body: PushTokenRequest } }, async (req, reply) => {
    const platform = req.body.provider === 'apns' ? 'ios' : 'android';
    await deps.pool.query(
      `INSERT INTO ident.device_token (token_hash, account_id, session_id, platform, provider, token_ciphertext, locale)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (token_hash) DO UPDATE SET account_id = EXCLUDED.account_id, session_id = EXCLUDED.session_id,
         locale = EXCLUDED.locale, last_registered_at = now(), invalidated_at = NULL`,
      [sha256(`${req.params.installation_id}:${req.body.token}`), req.auth!.aid, req.auth!.sid, platform, req.body.provider, Buffer.from(req.body.token), req.body.locale]);
    reply.code(204).send();
  });
  r.delete('/v1/me/devices/:installation_id/push-token', { schema: { params: Installation } }, async (req, reply) => {
    await deps.pool.query('UPDATE ident.device_token SET invalidated_at = now() WHERE account_id = $1 AND session_id = $2 AND invalidated_at IS NULL', [req.auth!.aid, req.auth!.sid]);
    reply.code(204).send();
  });
}
