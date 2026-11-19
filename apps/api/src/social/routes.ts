import { FriendCount, PersonSummary, PublicProfile } from '@flero/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { blockBetween, blockFull, follow, messageAction, unblock, unfollow } from '../conversations/core.ts';
import { withTx, type Tx } from '../db.ts';
import { err } from '../errors.ts';
import { decodeCursor, encodeCursor, idempotencyKey, ListQuery } from '../http.ts';
import { notify } from '../notifications.ts';
import { avatarView } from '../storage.ts';
import type { Deps } from '../server.ts';
import { isPlus } from '../wallet/routes.ts';

const UserParam = z.strictObject({ public_user_id: z.string().regex(/^usr_[a-z2-7]{26}$/) });

/** Resolves a visible, active account. Missing, deleted, suspended and fully-blocked all look the same (O10). */
export async function resolveUser(tx: Tx | Deps['pool'], viewer: number, publicId: string): Promise<number> {
  const { rows } = await tx.query<{ id: number }>(
    `SELECT a.id FROM app.account a WHERE a.public_id = $1 AND a.state = 'ACTIVE'
        AND NOT EXISTS (SELECT 1 FROM ident.block b WHERE b.kind = 'FULL' AND b.blocker_id = a.id AND b.blocked_id = $2)`, [publicId, viewer]);
  if (!rows[0]) throw err.notFound();
  return rows[0].id;
}

const person = (r: { public_id: string; handle_norm: string; display_name: string; avatar_key: string | null }) =>
  ({ public_user_id: r.public_id, handle: r.handle_norm, display_name: r.display_name, avatar: avatarView(r.avatar_key) });

export function socialRoutes(app: FastifyInstance, deps: Deps) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/v1/profiles/:public_user_id', { schema: { params: UserParam, response: { 200: PublicProfile } } }, async (req) => {
    const me = req.auth!.aid;
    return withTx(deps.pool, async (tx) => {
      const id = await resolveUser(tx, me, req.params.public_user_id);
      const { rows } = await tx.query(
        `SELECT a.public_id, a.handle_norm, a.gender, p.display_name, p.bio, p.avatar_key, c.label_key AS city_key, d.label_key AS district_key,
                pc.followers, pc.likes,
                EXISTS (SELECT 1 FROM app.follow WHERE follower_id = $2 AND followee_id = a.id) AS i_follow,
                EXISTS (SELECT 1 FROM app.follow WHERE follower_id = a.id AND followee_id = $2) AS follows_me,
                EXISTS (SELECT 1 FROM app.like_edge WHERE liker_id = $2 AND likee_id = a.id) AS i_liked
           FROM app.account a JOIN app.profile p ON p.account_id = a.id JOIN app.profile_counter pc ON pc.account_id = a.id
           JOIN app.city c ON c.id = a.home_city_id JOIN app.district d ON d.id = a.home_district_id
          WHERE a.id = $1`, [id, me]);
      const p = rows[0];
      if (!p) throw err.notFound(); // not onboarded yet → not a public profile
      return {
        public_user_id: p.public_id, handle: p.handle_norm, display_name: p.display_name, avatar: avatarView(p.avatar_key), gender: p.gender,
        home_city_label_key: p.city_key, home_district_label_key: p.district_key, bio: p.bio,
        membership_tier_style: (await isPlus(tx, id)) ? 'PLUS' as const : 'STANDARD' as const,
        follower_count: p.followers, like_count: p.likes,
        relationship: { i_follow: p.i_follow, follows_me: p.follows_me, i_liked: p.i_liked, is_friend: p.i_follow && p.follows_me },
        actions: { message: await messageAction(tx, me, id) },
      };
    });
  });

  r.put('/v1/follows/:public_user_id', { schema: { params: UserParam } }, async (req, reply) => {
    await withTx(deps.pool, async (tx) => follow(tx, req.auth!.aid, await resolveUser(tx, req.auth!.aid, req.params.public_user_id)));
    reply.code(204).send();
  });

  r.delete('/v1/follows/:public_user_id', { schema: { params: UserParam } }, async (req, reply) => {
    await withTx(deps.pool, async (tx) => unfollow(tx, req.auth!.aid, await resolveUser(tx, req.auth!.aid, req.params.public_user_id)));
    reply.code(204).send();
  });

  r.put('/v1/likes/:public_user_id', { schema: { params: UserParam } }, async (req, reply) => {
    const me = req.auth!.aid;
    await withTx(deps.pool, async (tx) => {
      const id = await resolveUser(tx, me, req.params.public_user_id);
      if (id === me || (await blockBetween(tx, me, id)).full) throw err.unavailable();
      const ins = await tx.query('INSERT INTO app.like_edge (liker_id, likee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [me, id]);
      if (ins.rowCount) {
        await tx.query('UPDATE app.profile_counter SET likes = likes + 1 WHERE account_id = $1', [id]);
        await notify(tx, { recipient: id, type: 'LIKE', ref: `like:${me}` });
      }
    });
    reply.code(204).send();
  });

  r.put('/v1/blocks/:public_user_id', { schema: { params: UserParam } }, async (req, reply) => {
    idempotencyKey(req);
    const me = req.auth!.aid;
    await withTx(deps.pool, async (tx) => {
      const { rows } = await tx.query<{ id: number }>(`SELECT id FROM app.account WHERE public_id = $1 AND state <> 'DELETED'`, [req.params.public_user_id]);
      if (!rows[0]) throw err.notFound();
      await blockFull(tx, me, rows[0].id);
    });
    reply.code(204).send();
  });

  r.delete('/v1/blocks/:public_user_id', { schema: { params: UserParam } }, async (req, reply) => {
    const me = req.auth!.aid;
    await withTx(deps.pool, async (tx) => {
      const { rows } = await tx.query<{ id: number }>('SELECT id FROM app.account WHERE public_id = $1', [req.params.public_user_id]);
      if (rows[0]) await unblock(tx, me, rows[0].id);
    });
    reply.code(204).send();
  });

  // ---------- owner-only lists (REQ-SOC-05): keyset-paginated by the other account's id ----------
  const list = (sql: string) => async (req: { auth?: { aid: number }; query: { cursor?: string | undefined; limit: number } }, reply: { header: (k: string, v: string) => unknown }) => {
    const cur = decodeCursor(req.query.cursor, z.strictObject({ i: z.number().int() }));
    const { rows } = await deps.pool.query<{ id: number; public_id: string; handle_norm: string; display_name: string; avatar_key: string | null }>(
      `SELECT a.id, a.public_id, a.handle_norm, p.display_name, p.avatar_key FROM (${sql}) x JOIN app.account a ON a.id = x.other
         JOIN app.profile p ON p.account_id = a.id
        WHERE a.state = 'ACTIVE' AND ($2::bigint IS NULL OR a.id < $2) ORDER BY a.id DESC LIMIT $3`,
      [req.auth!.aid, cur?.i ?? null, req.query.limit + 1]);
    const page = rows.slice(0, req.query.limit);
    if (rows.length > req.query.limit) reply.header('x-next-cursor', encodeCursor({ i: page.at(-1)!.id }));
    return page.map(person);
  };
  const listSchema = { schema: { querystring: ListQuery, response: { 200: z.array(PersonSummary) } } };
  r.get('/v1/me/following', listSchema, list('SELECT followee_id AS other FROM app.follow WHERE follower_id = $1'));
  r.get('/v1/me/friends', listSchema, list(
    'SELECT f.followee_id AS other FROM app.follow f JOIN app.follow g ON g.follower_id = f.followee_id AND g.followee_id = f.follower_id WHERE f.follower_id = $1'));
  // shields are never listed with identity — only FULL blocks the user placed knowingly
  r.get('/v1/me/blocks', listSchema, list(`SELECT blocked_id AS other FROM ident.block WHERE blocker_id = $1 AND kind = 'FULL'`));

  r.get('/v1/me/friends/count', { schema: { response: { 200: FriendCount } } }, async (req) => {
    const { rows } = await deps.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM app.follow f JOIN app.follow g ON g.follower_id = f.followee_id AND g.followee_id = f.follower_id
        WHERE f.follower_id = $1`, [req.auth!.aid]);
    return { friend_count: rows[0]!.n };
  });

  // prefix handle search: not personalised, block-aware, bounded (no pagination needed beyond 20)
  r.get('/v1/search/users', { schema: { querystring: z.strictObject({ q: z.string().min(2).max(20) }), response: { 200: z.array(PersonSummary) } } }, async (req) => {
    const q = req.query.q.trim().toLocaleLowerCase('tr-TR').replace(/^@/, '');
    if (!/^[a-z0-9._]{2,20}$/.test(q)) return [];
    const { rows } = await deps.pool.query<{ public_id: string; handle_norm: string; display_name: string; avatar_key: string | null }>(
      `SELECT a.public_id, a.handle_norm, p.display_name, p.avatar_key FROM app.account a JOIN app.profile p ON p.account_id = a.id
        WHERE a.handle_norm LIKE $1 || '%' AND a.state = 'ACTIVE' AND a.home_city_id IS NOT NULL AND a.id <> $2
          AND NOT EXISTS (SELECT 1 FROM ident.block b WHERE b.kind = 'FULL'
                           AND ((b.blocker_id = a.id AND b.blocked_id = $2) OR (b.blocker_id = $2 AND b.blocked_id = a.id)))
        ORDER BY a.handle_norm LIMIT 20`, [q.replace(/[%_\\]/g, (m) => `\\${m}`), req.auth!.aid]);
    return rows.map(person);
  });
}
