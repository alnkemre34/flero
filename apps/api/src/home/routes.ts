import { Banner, Notification, NotificationReadRequest } from '@flero/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Deps } from '../server.ts';

/** Admin-scheduled banners; destinations are allowlisted deep links; sponsored is always disclosed (REQ-HOM-01). */
export function homeRoutes(app: FastifyInstance, deps: Deps) {
  app.withTypeProvider<ZodTypeProvider>().get('/v1/home/banners', {
    schema: { querystring: z.strictObject({ placement: z.enum(['HOME', 'WALLET', 'SHUFFLE']).default('HOME') }), response: { 200: z.array(Banner) } },
  }, async (req, reply) => {
    const { rows } = await deps.pool.query<{ public_id: string; image_url: string; alt_key: string; destination: string; sponsored: boolean }>(
      `SELECT public_id, image_url, alt_key, destination, sponsored FROM app.banner
        WHERE active AND placement = $1 AND now() >= starts_at AND now() < ends_at ORDER BY priority DESC, id DESC LIMIT 10`, [req.query.placement]);
    reply.header('cache-control', 'private, max-age=60');
    return rows.map((b) => ({ banner_id: b.public_id, image_url: b.image_url, alt_key: b.alt_key, destination: b.destination, sponsored: b.sponsored }));
  });
}


/** Notification centre. Copy is generic: anonymous classes never carry who (doc 09 §4). */
export function notificationRoutes(app: FastifyInstance, deps: Deps) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get('/v1/notifications', { schema: { querystring: z.strictObject({ cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }), response: { 200: z.array(Notification) } } }, async (req, reply) => {
    const before = req.query.cursor ? Number(Buffer.from(req.query.cursor, 'base64url').toString()) : null;
    const { rows } = await deps.pool.query<{ id: number; public_id: string; event_type: string; domain_ref: string; conversation_ref: string | null; created_at: Date; read_at: Date | null }>(
      `SELECT id, public_id, event_type, domain_ref, conversation_ref, created_at, read_at FROM ident.notification
        WHERE recipient_id = $1 AND ($2::bigint IS NULL OR id < $2) ORDER BY id DESC LIMIT $3`, [req.auth!.aid, Number.isFinite(before) ? before : null, req.query.limit + 1]);
    const page = rows.slice(0, req.query.limit);
    if (rows.length > req.query.limit) reply.header('x-next-cursor', Buffer.from(String(page.at(-1)!.id)).toString('base64url'));
    return page.map((n) => {
      const copy = { title: `notif.${n.event_type.toLowerCase()}.title`, body: `notif.${n.event_type.toLowerCase()}.body` };
      const conv = n.conversation_ref;
      return {
        notification_id: n.public_id, type: n.event_type as z.infer<typeof Notification>['type'], title_key: copy.title, body_key: copy.body,
        params: {}, deep_link: conv ? `flero://chat/${conv}` : null, conversation_id: conv, created_at: n.created_at.toISOString(), read: n.read_at !== null,
      };
    });
  });
  r.post('/v1/notifications/read', { schema: { body: NotificationReadRequest } }, async (req, reply) => {
    await deps.pool.query(
      `UPDATE ident.notification SET read_at = now() WHERE recipient_id = $1 AND read_at IS NULL
          AND id <= (SELECT id FROM ident.notification WHERE public_id = $2 AND recipient_id = $1)`, [req.auth!.aid, req.body.up_to_id]);
    reply.code(204).send();
  });
}
