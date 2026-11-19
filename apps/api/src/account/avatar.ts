import { randomUUID } from 'node:crypto';
import multipart from '@fastify/multipart';
import { AvatarCompleteRequest, AvatarUploadRequest, Me, UploadTicket } from '@flero/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import sharp from 'sharp';
import { z } from 'zod';
import { loadMe } from '../auth/routes.ts';
import { withTx } from '../db.ts';
import { AppError, err } from '../errors.ts';
import { publicId } from '../ids.ts';
import type { Deps } from '../server.ts';
import { avatarKeyPath, DevStorage } from '../storage.ts';

const TICKET_TTL_S = 600;
const OUTPUT_PX = 512;
const MAX_PENDING_PER_HOUR = 10;

/**
 * Image safety scan. INTEGRATION STUB (doc 21): production calls the media-safety vendor (nudity/minor-safety
 * classifiers) before an avatar can go live; development approves everything.
 */
export interface ImageScanner { scan(webp: Buffer): Promise<'ok' | 'reject'> }
export const devScanner: ImageScanner = { async scan() { return 'ok'; } };

/** Random served key, unrelated to the account (REQ-ID-01). */
const newAvatarKey = () => publicId('usr').slice(4);

export function avatarRoutes(app: FastifyInstance, deps: Deps) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post('/v1/me/avatar/uploads', { schema: { body: AvatarUploadRequest, response: { 201: UploadTicket } } }, async (req, reply) => {
    const me = req.auth!.aid;
    const recent = await deps.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM app.avatar_upload WHERE account_id = $1 AND created_at > now() - interval '1 hour'`, [me]);
    if (recent.rows[0]!.n >= MAX_PENDING_PER_HOUR) throw err.rateLimited();
    const id = randomUUID();
    const key = `quarantine/avatars/${id}`;
    await deps.pool.query(
      `INSERT INTO app.avatar_upload (id, account_id, object_key, content_type, max_bytes, expires_at) VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))`,
      [id, me, key, req.body.content_type, req.body.byte_size, TICKET_TTL_S]);
    let ticket;
    try { ticket = deps.storage.createUpload(key, req.body.content_type, req.body.byte_size, TICKET_TTL_S); }
    catch { throw err.retryable(); } // storage integration not configured
    reply.code(201);
    return { upload_id: id, ...ticket };
  });

  r.post('/v1/me/avatar/uploads/:upload_id/complete', { schema: { params: z.strictObject({ upload_id: z.uuid() }), body: AvatarCompleteRequest, response: { 200: Me } } }, async (req) => {
    const me = req.auth!.aid;
    const { rows } = await deps.pool.query<{ object_key: string; state: string; live: boolean }>(
      'SELECT object_key, state, expires_at > now() AS live FROM app.avatar_upload WHERE id = $1 AND account_id = $2', [req.params.upload_id, me]);
    const up = rows[0];
    if (!up) throw err.notFound();
    if (up.state === 'READY') return withTx(deps.pool, (tx) => loadMe(tx, me)); // idempotent retry
    const original = await deps.storage.get(up.object_key);
    if (!original || !up.live) throw new AppError('VALIDATION_FAILED', 400, { field: 'upload', reason: 'missing_or_expired' });

    // decode defensively: real image, sane dimensions, crop inside the (EXIF-rotated) frame
    let webp: Buffer;
    try {
      const img = sharp(original, { limitInputPixels: 50_000_000, failOn: 'error' }).rotate();
      const { data: oriented, info } = await img.toBuffer({ resolveWithObject: true });
      const { x, y, size } = req.body.crop;
      if (x + size > info.width || y + size > info.height) throw new AppError('VALIDATION_FAILED', 400, { field: 'crop' });
      webp = await sharp(oriented).extract({ left: x, top: y, width: size, height: size })
        .resize(OUTPUT_PX, OUTPUT_PX, { fit: 'cover' }).webp({ quality: 82 }).toBuffer(); // metadata (EXIF/GPS) is not copied
    } catch (e) {
      if (e instanceof AppError) throw e;
      await deps.pool.query(`UPDATE app.avatar_upload SET state = 'REJECTED' WHERE id = $1`, [req.params.upload_id]);
      throw new AppError('VALIDATION_FAILED', 400, { field: 'image', reason: 'unreadable' });
    }
    if ((await deps.scanner.scan(webp)) === 'reject') {
      await deps.pool.query(`UPDATE app.avatar_upload SET state = 'REJECTED' WHERE id = $1`, [req.params.upload_id]);
      await deps.storage.remove(up.object_key);
      throw new AppError('VALIDATION_FAILED', 400, { field: 'image', reason: 'policy' });
    }
    const key = newAvatarKey();
    await deps.storage.put(avatarKeyPath(key), webp, 'image/webp');
    const old = await withTx(deps.pool, async (tx) => {
      const prev = await tx.query<{ avatar_key: string | null }>('SELECT avatar_key FROM app.profile WHERE account_id = $1 FOR UPDATE', [me]);
      await tx.query('UPDATE app.profile SET avatar_key = $2, version = version + 1 WHERE account_id = $1', [me, key]);
      await tx.query(`UPDATE app.avatar_upload SET state = 'READY' WHERE id = $1`, [req.params.upload_id]);
      return prev.rows[0]?.avatar_key ?? null;
    });
    await deps.storage.remove(up.object_key);
    if (old) await deps.storage.remove(avatarKeyPath(old)); // the old one goes only after the new one is live
    return withTx(deps.pool, (tx) => loadMe(tx, me));
  });

  r.delete('/v1/me/avatar', async (req, reply) => {
    const me = req.auth!.aid;
    const { rows } = await deps.pool.query<{ avatar_key: string | null }>(
      `UPDATE app.profile p SET avatar_key = NULL, version = version + 1 FROM (SELECT avatar_key FROM app.profile WHERE account_id = $1) old
        WHERE p.account_id = $1 RETURNING old.avatar_key`, [me]);
    if (rows[0]?.avatar_key) await deps.storage.remove(avatarKeyPath(rows[0].avatar_key));
    reply.code(204).send();
  });

  // ---------- development stand-ins for S3 (presigned POST) and the CDN ----------
  const dev = deps.storage instanceof DevStorage ? deps.storage : null;
  if (!dev) return;

  app.register(async (scope) => {
    await scope.register(multipart, { limits: { fileSize: 15_000_000, files: 1, fields: 10 } });
    scope.post('/dev-storage/upload', { config: { public: true } }, async (req, reply) => {
      const fields: Record<string, string> = {};
      let file: Buffer | null = null;
      for await (const part of req.parts()) {
        if (part.type === 'file') file = await part.toBuffer();
        else fields[part.fieldname] = String(part.value);
      }
      const policy = dev.verifyUpload(fields);
      if (!policy || !file) throw new AppError('VALIDATION_FAILED', 400, { field: 'policy' });
      if (file.length > policy.maxBytes) throw new AppError('VALIDATION_FAILED', 400, { field: 'file', reason: 'too_large' });
      await dev.put(policy.key, file);
      await deps.pool.query(`UPDATE app.avatar_upload SET state = 'UPLOADED' WHERE object_key = $1 AND state = 'PENDING'`, [policy.key]);
      reply.code(204).send();
    });
  });

  app.withTypeProvider<ZodTypeProvider>().get('/media/avatars/:file', { config: { public: true }, schema: { params: z.strictObject({ file: z.string().regex(/^[a-z2-7]{26}\.webp$/) }) } }, async (req, reply) => {
    const body = await dev.get(`avatars/${req.params.file}`);
    if (!body) throw err.notFound();
    reply.header('content-type', 'image/webp').header('cache-control', 'public, max-age=31536000, immutable');
    return reply.send(body);
  });
}
