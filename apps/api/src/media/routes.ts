import { randomUUID } from 'node:crypto';
import { MediaId, MediaUploadRequest, MediaUploadTicket, MediaView, OneViewLease, RenderedRequest } from '@flero/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import sharp from 'sharp';
import { z } from 'zod';
import { appendMessage, canSendNow } from '../conversations/routes.ts';
import { loadConv } from '../conversations/core.ts';
import { withTx, type Tx } from '../db.ts';
import { AppError, err } from '../errors.ts';
import { fingerprint, publicId } from '../ids.ts';
import { notify } from '../notifications.ts';
import type { Deps } from '../server.ts';
import { DevStorage } from '../storage.ts';
import { assertCanSpend, lockWallets, postLedger } from '../wallet/ledger.ts';

/**
 * Chat photos (doc 08 §8, doc 12 §4, REQ-MED-*).
 *   upload ticket → original into quarantine → complete: re-encode (EXIF/GPS stripped, ≤1600 px) + safety scan →
 *   stored under a random key → the PHOTO message commits. The recipient sees a locked tile with no derived pixels;
 *   a Gold unlock (never charged twice, sender never pays) gives short-lived signed URLs for PERSISTENT photos and
 *   a single-use proxied lease for ONE_VIEW photos (DEC-25 default: one grace re-open within 10 minutes).
 * Storage and the safety scanner are integrations (S3 / vendor); development uses DevStorage + devScanner.
 */
const TICKET_TTL_S = 600;
const ACCESS_TTL_S = 300;
const LEASE_S = 90;
const GRACE_MS = 10 * 60 * 1000;
const MAX_OPEN_ATTEMPTS = 3;
const MAX_UPLOADS_PER_HOUR = 30;
const MAX_PX = 1600;
const RETENTION = '90 days';

const MediaParam = z.strictObject({ media_id: MediaId });
const ConvParam = z.strictObject({ conversation_id: z.string().regex(/^cnv_[a-z2-7]{26}$/) });

interface MediaRow {
  id: number; public_id: string; owner_id: number; conversation_id: number; conv_public: string;
  kind: 'PERSISTENT' | 'ONE_VIEW'; state: 'UPLOADING' | 'PROCESSING' | 'READY' | 'REJECTED' | 'EXPIRED' | 'REMOVED';
  storage_key: string; quarantine_key: string | null; unlock_price_gold: number; expires_at: Date; expired: boolean;
  upload_live: boolean; client_msg_id: string; message_seq: number | null; withheld: boolean | null; width: number | null; height: number | null;
  unlocked: boolean; one_view_state: 'UNOPENED' | 'OPENING' | 'CONSUMED' | null; open_attempts: number | null;
  lease_id: string | null; lease_live: boolean | null; bytes_delivered_at: Date | null; grace_used: boolean | null;
}

/** Media as seen by `viewer` — only participants of its conversation get a row (others: the same 404). */
async function loadMedia(db: Tx | Deps['pool'], viewer: number, mediaPublic: string, lock = false): Promise<MediaRow | null> {
  const { rows } = await db.query<MediaRow>(
    `SELECT mo.id, mo.public_id, mo.owner_id, mo.conversation_id, c.public_id AS conv_public, mo.kind, mo.state, mo.storage_key,
            mo.quarantine_key, mo.unlock_price_gold, mo.expires_at, mo.expires_at <= now() AS expired,
            COALESCE(mo.upload_expires_at > now(), false) AS upload_live, mo.client_msg_id, mo.message_seq, mo.width, mo.height,
            (SELECT m.withheld FROM ident.message m WHERE m.conversation_id = mo.conversation_id AND m.seq = mo.message_seq) AS withheld,
            mu.media_id IS NOT NULL AS unlocked, mu.one_view_state, mu.open_attempts, mu.lease_id,
            mu.lease_expires_at > now() AS lease_live, mu.bytes_delivered_at, mu.grace_used
       FROM ident.media_object mo
       JOIN ident.conversation c ON c.id = mo.conversation_id
       JOIN ident.participant p ON p.conversation_id = c.id AND p.account_id = $1
       LEFT JOIN ident.media_unlock mu ON mu.media_id = mo.id AND mu.viewer_id = $1
      WHERE mo.public_id = $2 ${lock ? 'FOR UPDATE OF mo' : ''}`, [viewer, mediaPublic]);
  const r = rows[0];
  if (!r) return null;
  // the recipient only ever sees a committed, delivered photo (never an upload in progress or a withheld one)
  if (r.owner_id !== viewer && (r.message_seq === null || r.withheld)) return null;
  return r;
}

/** What a one-view photo allows right now (lazy evaluation of an expired lease, doc 08 §8 step 5). */
function oneView(r: MediaRow, now = Date.now()): { state: 'UNOPENED' | 'OPENING' | 'CONSUMED'; canOpen: boolean; grace: boolean } {
  if (r.one_view_state === 'CONSUMED') return { state: 'CONSUMED', canOpen: false, grace: false };
  if (r.one_view_state === 'UNOPENED') return { state: 'UNOPENED', canOpen: (r.open_attempts ?? 0) < MAX_OPEN_ATTEMPTS, grace: false };
  if (r.lease_live) return { state: 'OPENING', canOpen: false, grace: false };
  // the lease ran out without a "rendered" ack
  if (!r.bytes_delivered_at) return (r.open_attempts ?? 0) < MAX_OPEN_ATTEMPTS ? { state: 'UNOPENED', canOpen: true, grace: false } : { state: 'CONSUMED', canOpen: false, grace: false };
  if (!r.grace_used && now - r.bytes_delivered_at.getTime() <= GRACE_MS && (r.open_attempts ?? 0) < MAX_OPEN_ATTEMPTS) return { state: 'UNOPENED', canOpen: true, grace: true };
  return { state: 'CONSUMED', canOpen: false, grace: false };
}

export function mediaRoutes(app: FastifyInstance, deps: Deps) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const me = (req: { auth?: { aid: number } }) => req.auth!.aid;

  const view = (m: MediaRow, viewer: number) => {
    const mine = m.owner_id === viewer;
    const state = m.state === 'UPLOADING' ? 'PROCESSING' as const : m.state === 'READY' && m.expired ? 'EXPIRED' as const : m.state;
    const ov = m.kind === 'ONE_VIEW' && !mine && m.unlocked ? oneView(m).state : null;
    // signed URLs only for: the sender (always free), or an unlocked PERSISTENT photo. One-view goes through /open.
    const access = state === 'READY' && (mine || (m.unlocked && m.kind === 'PERSISTENT'))
      ? { url: deps.storage.signedReadUrl(m.storage_key, ACCESS_TTL_S), expires_in: ACCESS_TTL_S } : null;
    return {
      media_id: m.public_id, state, kind: m.kind, unlock_price_gold: m.unlock_price_gold, expires_at: m.expires_at.toISOString(),
      locked: !mine && !m.unlocked, one_view_state: ov, access, width: m.width, height: m.height,
    };
  };

  // ---------- 1. upload ticket ----------
  r.post('/v1/conversations/:conversation_id/media/uploads', { schema: { params: ConvParam, body: MediaUploadRequest, response: { 201: MediaUploadTicket } } }, async (req, reply) => {
    const v = me(req);
    const id = publicId('med');
    const qkey = `quarantine/chat/${randomUUID()}`;
    await withTx(deps.pool, async (tx) => {
      const c = await loadConv(tx, v, req.params.conversation_id);
      if (!canSendNow(c)) throw err.unavailable();
      const recent = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM ident.media_object WHERE owner_id = $1 AND created_at > now() - interval '1 hour'`, [v]);
      if (recent.rows[0]!.n >= MAX_UPLOADS_PER_HOUR) throw err.rateLimited();
      const price = await tx.query<{ price_gold: number }>('SELECT price_gold FROM app.unlock_price WHERE kind = $1 ORDER BY version DESC LIMIT 1', [req.body.kind]);
      if (!price.rows[0]) throw err.retryable(); // catalog not configured yet
      await tx.query(
        `INSERT INTO ident.media_object (public_id, owner_id, conversation_id, kind, state, storage_key, unlock_price_gold, expires_at,
                                         quarantine_key, content_type, max_bytes, upload_expires_at)
         VALUES ($1, $2, $3, $4, 'UPLOADING', $5, $6, now() + interval '${RETENTION}', $7, $8, $9, now() + make_interval(secs => $10))`,
        [id, v, c.id, req.body.kind, `chat/${randomUUID()}.jpg`, price.rows[0].price_gold, qkey, req.body.content_type, req.body.byte_size, TICKET_TTL_S]);
    });
    let ticket;
    try { ticket = deps.storage.createUpload(qkey, req.body.content_type, req.body.byte_size, TICKET_TTL_S); }
    catch { throw err.retryable(); } // storage integration not configured
    reply.code(201);
    return { media_id: id, ...ticket };
  });

  // ---------- 2. complete: process, scan, post the PHOTO message ----------
  r.post('/v1/media/:media_id/complete', { schema: { params: MediaParam, response: { 200: MediaView } } }, async (req) => {
    const v = me(req);
    const m = await loadMedia(deps.pool, v, req.params.media_id);
    if (!m || m.owner_id !== v) throw err.notFound();
    if (m.message_seq !== null) return view(m, v); // idempotent retry
    if (m.state === 'REJECTED') throw new AppError('VALIDATION_FAILED', 400, { field: 'image', reason: 'policy' });
    const original = m.quarantine_key ? await deps.storage.get(m.quarantine_key) : null;
    if (!original || !m.upload_live) throw new AppError('VALIDATION_FAILED', 400, { field: 'upload', reason: 'missing_or_expired' });

    let jpeg: Buffer; let width: number; let height: number;
    try {
      const out = await sharp(original, { limitInputPixels: 50_000_000, failOn: 'error' }).rotate()
        .resize({ width: MAX_PX, height: MAX_PX, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true }).toBuffer({ resolveWithObject: true }); // metadata (EXIF/GPS) is not copied
      jpeg = out.data; width = out.info.width; height = out.info.height;
    } catch {
      await deps.pool.query(`UPDATE ident.media_object SET state = 'REJECTED' WHERE id = $1`, [m.id]);
      throw new AppError('VALIDATION_FAILED', 400, { field: 'image', reason: 'unreadable' });
    }
    if ((await deps.scanner.scan(jpeg)) === 'reject') {
      await deps.pool.query(`UPDATE ident.media_object SET state = 'REJECTED' WHERE id = $1`, [m.id]);
      await deps.storage.remove(m.quarantine_key!);
      throw new AppError('VALIDATION_FAILED', 400, { field: 'image', reason: 'policy' });
    }
    await deps.storage.put(m.storage_key, jpeg, 'image/jpeg');
    await withTx(deps.pool, async (tx) => {
      const c = await loadConv(tx, v, m.conv_public, true); // the conversation lock is the message sequencer
      const fresh = await loadMedia(tx, v, m.public_id, true);
      if (!fresh || fresh.message_seq !== null) return; // a concurrent complete already posted it
      const { msg } = await appendMessage(tx, c, v, { clientMsgId: m.client_msg_id, kind: 'PHOTO', mediaId: m.id });
      await tx.query(`UPDATE ident.media_object SET state = 'READY', message_seq = $2, width = $3, height = $4 WHERE id = $1`, [m.id, msg.seq, width, height]);
    });
    await deps.storage.remove(m.quarantine_key!);
    return view((await loadMedia(deps.pool, v, m.public_id))!, v);
  });

  // ---------- 3. state for the viewer (locked / access) ----------
  r.get('/v1/media/:media_id', { schema: { params: MediaParam, response: { 200: MediaView } } }, async (req) => {
    const v = me(req);
    const m = await loadMedia(deps.pool, v, req.params.media_id);
    if (!m) throw err.notFound();
    return view(m, v);
  });

  // ---------- 4. unlock with Gold: never charged twice, sender never pays (doc 12 §4) ----------
  r.post('/v1/media/:media_id/unlock', { schema: { params: MediaParam, response: { 200: MediaView } } }, async (req) => {
    const v = me(req);
    return withTx(deps.pool, async (tx) => {
      const peek = await loadMedia(tx, v, req.params.media_id);
      if (!peek) throw err.notFound();
      if (peek.owner_id === v || peek.unlocked) return view(peek, v); // existing entitlement: no charge, no balance check
      const wallets = await lockWallets(tx, [v]); // lock order: wallet → media (doc 05 §4)
      const m = (await loadMedia(tx, v, req.params.media_id, true))!;
      if (m.unlocked) return view(m, v); // a concurrent unlock won the race: still no second charge
      if (m.state !== 'READY' || m.expired) throw err.conflict('ACTION_UNAVAILABLE', { reason: 'media_unavailable' });
      const price = m.unlock_price_gold; // snapshot taken at send time
      assertCanSpend(wallets.get(v), price);
      const txn = await postLedger(tx, {
        op: 'UNLOCK', account: v, key: `unlock:${m.public_id}`, hash: fingerprint({ media: m.public_id, price }), actor: 'user',
        postings: [{ account: 'USER_AVAILABLE', owner: v, amount: -price }, { account: 'SYS_SINK_UNLOCK', amount: price }], // DEC-03 default: sink
      });
      await tx.query(
        `INSERT INTO ident.media_unlock (media_id, viewer_id, ledger_txn_id, one_view_state) VALUES ($1, $2, $3, $4)`,
        [m.id, v, txn.txnId, m.kind === 'ONE_VIEW' ? 'UNOPENED' : null]);
      await notify(tx, { recipient: m.owner_id, type: 'PHOTO_UNLOCKED', ref: `unlock:${m.public_id}`, conversation: m.conv_public });
      return view((await loadMedia(tx, v, m.public_id))!, v);
    });
  });

  // ---------- 5. one-view: lease → single-use proxied bytes → rendered ----------
  r.post('/v1/media/:media_id/open', { schema: { params: MediaParam, response: { 200: OneViewLease } } }, async (req) => {
    const v = me(req);
    return withTx(deps.pool, async (tx) => {
      const m = await loadMedia(tx, v, req.params.media_id, true);
      if (!m) throw err.notFound();
      if (m.kind !== 'ONE_VIEW' || m.owner_id === v) throw err.conflict('ACTION_UNAVAILABLE', { reason: 'not_one_view' });
      if (!m.unlocked) throw err.unavailable(); // pay first
      if (m.state !== 'READY' || m.expired) throw err.conflict('ACTION_UNAVAILABLE', { reason: 'media_unavailable' });
      const ov = oneView(m);
      if (ov.state === 'OPENING' && m.lease_id && !m.bytes_delivered_at) {
        // retry before the bytes were fetched (e.g. the app restarted): hand back the same lease
        const left = await tx.query<{ s: number }>('SELECT GREATEST(10, floor(extract(epoch FROM lease_expires_at - now())))::int AS s FROM ident.media_unlock WHERE media_id = $1 AND viewer_id = $2', [m.id, v]);
        return { lease_id: m.lease_id, url: `${deps.cfg.PUBLIC_BASE_URL}/v1/media/one-view/${m.lease_id}`, expires_in: Math.min(LEASE_S, left.rows[0]!.s) };
      }
      if (!ov.canOpen) {
        await tx.query(`UPDATE ident.media_unlock SET one_view_state = 'CONSUMED', lease_id = NULL, lease_expires_at = NULL WHERE media_id = $1 AND viewer_id = $2`, [m.id, v]);
        throw err.conflict('ACTION_UNAVAILABLE', { reason: 'consumed' });
      }
      const lease = randomUUID();
      await tx.query(
        `UPDATE ident.media_unlock SET one_view_state = 'OPENING', lease_id = $3, lease_expires_at = now() + make_interval(secs => $4),
                open_attempts = open_attempts + 1, bytes_delivered_at = NULL, grace_used = grace_used OR $5
          WHERE media_id = $1 AND viewer_id = $2`, [m.id, v, lease, LEASE_S, ov.grace]);
      return { lease_id: lease, url: `${deps.cfg.PUBLIC_BASE_URL}/v1/media/one-view/${lease}`, expires_in: LEASE_S };
    });
  });

  r.post('/v1/media/:media_id/rendered', { schema: { params: MediaParam, body: RenderedRequest, response: { 200: MediaView } } }, async (req) => {
    const v = me(req);
    return withTx(deps.pool, async (tx) => {
      const m = await loadMedia(tx, v, req.params.media_id, true);
      if (!m || !m.unlocked || m.kind !== 'ONE_VIEW') throw err.notFound();
      if (m.one_view_state !== 'CONSUMED') {
        if (m.lease_id !== req.body.lease_id) throw err.conflict('ACTION_UNAVAILABLE', { reason: 'lease' });
        await tx.query(`UPDATE ident.media_unlock SET one_view_state = 'CONSUMED', lease_id = NULL, lease_expires_at = NULL WHERE media_id = $1 AND viewer_id = $2`, [m.id, v]);
      }
      return view((await loadMedia(tx, v, m.public_id))!, v);
    });
  });

  /**
   * The leased URL itself: a capability (unguessable, 90 s, single use), served by the API — never a CDN, never
   * cacheable. The bytes count as delivered only when the response finished; a dropped connection frees the lease
   * again (reconnect grace), so a flaky network never consumes a photo nobody saw.
   */
  app.withTypeProvider<ZodTypeProvider>().get('/v1/media/one-view/:lease_id', { config: { public: true }, schema: { params: z.strictObject({ lease_id: z.uuid() }) } }, async (req, reply) => {
    const claimed = await deps.pool.query<{ storage_key: string }>(
      `UPDATE ident.media_unlock mu SET bytes_delivered_at = now() FROM ident.media_object mo
        WHERE mu.lease_id = $1 AND mu.one_view_state = 'OPENING' AND mu.lease_expires_at > now() AND mu.bytes_delivered_at IS NULL
          AND mo.id = mu.media_id AND mo.state = 'READY' AND mo.expires_at > now()
        RETURNING mo.storage_key`, [req.params.lease_id]);
    const key = claimed.rows[0]?.storage_key;
    const body = key ? await deps.storage.get(key) : null;
    if (!body) {
      if (key) await deps.pool.query('UPDATE ident.media_unlock SET bytes_delivered_at = NULL WHERE lease_id = $1', [req.params.lease_id]);
      throw err.notFound();
    }
    let finished = false;
    reply.raw.on('finish', () => { finished = true; });
    reply.raw.on('close', () => {
      if (!finished) void deps.pool.query('UPDATE ident.media_unlock SET bytes_delivered_at = NULL WHERE lease_id = $1', [req.params.lease_id]).catch(() => {});
    });
    reply.header('content-type', 'image/jpeg').header('cache-control', 'no-store, private').header('pragma', 'no-cache');
    return reply.send(body);
  });

  // ---------- development stand-in for a presigned S3 GET ----------
  const dev = deps.storage instanceof DevStorage ? deps.storage : null;
  if (dev) {
    app.withTypeProvider<ZodTypeProvider>().get('/media-private', {
      config: { public: true }, schema: { querystring: z.strictObject({ k: z.string().max(200), e: z.string().max(12), s: z.string().max(100) }) },
    }, async (req, reply) => {
      const key = dev.verifyRead(req.query.k, req.query.e, req.query.s);
      if (!key || !key.startsWith('chat/')) throw err.notFound(); // quarantine and anything else is never served
      const body = await dev.get(key);
      if (!body) throw err.notFound();
      reply.header('content-type', 'image/jpeg').header('cache-control', `private, max-age=${ACCESS_TTL_S}`);
      return reply.send(body);
    });
  }
}

/** Worker: expire photos after the retention period (rows stay as the unlock audit trail; bytes go). */
export async function expireMedia(pool: Deps['pool'], storage: Deps['storage'], limit = 200) {
  const { rows } = await pool.query<{ storage_key: string; quarantine_key: string | null }>(
    `UPDATE ident.media_object SET state = 'EXPIRED'
      WHERE id IN (SELECT id FROM ident.media_object
                    WHERE (state = 'READY' AND expires_at <= now())
                       OR (state = 'UPLOADING' AND upload_expires_at < now() - interval '1 hour')
                    ORDER BY id LIMIT $1)
      RETURNING storage_key, quarantine_key`, [limit]);
  for (const r of rows) {
    await storage.remove(r.storage_key).catch(() => {});
    if (r.quarantine_key) await storage.remove(r.quarantine_key).catch(() => {});
  }
  return rows.length;
}
