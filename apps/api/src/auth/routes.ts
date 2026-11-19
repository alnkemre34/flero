import { hash, verify } from '@node-rs/argon2';
import { LoginRequest, Me, RefreshRequest, SignupRequest, TokenPair } from '@flero/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { withTx, type Tx } from '../db.ts';
import { AppError, err } from '../errors.ts';
import { normalizeEmail, normalizeHandle, publicId } from '../ids.ts';
import { notify } from '../notifications.ts';
import { avatarView } from '../storage.ts';
import type { Deps } from '../server.ts';

// argon2id, calibrated for API instances (doc 10 §4).
const ARGON = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
// Verifying unknown emails against a dummy hash keeps login timing equal (no account enumeration).
let dummyHash: Promise<string> | undefined;

/** Untrusted header → one of the DB-allowed platforms (never a CHECK violation / 500). */
export const platformOf = (h: string | string[] | undefined) => {
  const v = (Array.isArray(h) ? h[0] : h)?.toLowerCase();
  return v === 'ios' || v === 'android' || v === 'web' ? v : null;
};

export async function onboardingStatus(tx: Tx, accountId: number) {
  const { rows } = await tx.query<{ email_verified: boolean; age_assured: boolean; region: boolean; consents: number }>(
    `SELECT a.email_verified_at IS NOT NULL AS email_verified, a.age_assured_at IS NOT NULL AS age_assured,
            a.home_city_id IS NOT NULL AS region,
            (SELECT count(DISTINCT kind) FROM app.consent c WHERE c.account_id = a.id AND c.kind IN ('TERMS','PRIVACY','COMMUNITY'))::int AS consents
       FROM app.account a WHERE a.id = $1`, [accountId]);
  const r = rows[0]!;
  return { email_verified: r.email_verified, age_assured: r.age_assured, consents_current: r.consents === 3, home_region_set: r.region };
}

export async function loadMe(tx: Tx, accountId: number) {
  const { rows } = await tx.query(
    `SELECT a.public_id, a.handle_display, a.email_norm, a.email_verified_at, a.gender,
            c.label_key AS city_key, d.label_key AS district_key,
            a.home_region_last_changed_at + interval '30 days' AS next_change,
            p.display_name, p.bio, p.avatar_key,
            (SELECT max(COALESCE(grace_until, valid_until)) FROM app.plus_entitlement pe
              WHERE pe.account_id = a.id AND pe.state IN ('ACTIVE','GRACE') AND now() < COALESCE(pe.grace_until, pe.valid_until)) AS plus_until
       FROM app.account a JOIN app.profile p ON p.account_id = a.id
       LEFT JOIN app.city c ON c.id = a.home_city_id LEFT JOIN app.district d ON d.id = a.home_district_id
      WHERE a.id = $1`, [accountId]);
  const r = rows[0];
  if (!r) throw err.notFound();
  return Me.parse({
    public_user_id: r.public_id, handle: r.handle_display.toLocaleLowerCase('tr-TR'), display_name: r.display_name,
    email: r.email_norm, email_verified: r.email_verified_at !== null, gender: r.gender, locale: 'tr',
    home_city_label_key: r.city_key, home_district_label_key: r.district_key,
    home_region_next_change_at: r.next_change ? new Date(r.next_change).toISOString() : null,
    bio: r.bio, avatar: avatarView(r.avatar_key), membership_tier: r.plus_until ? 'PLUS' : 'STANDARD',
    plus_until: r.plus_until ? new Date(r.plus_until).toISOString() : null,
    onboarding: await onboardingStatus(tx, accountId),
  });
}

export function authRoutes(app: FastifyInstance, deps: Deps) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tokenPair = async (tx: Tx, accountId: number, t: { access: string; refresh: string; sid: string }) => ({
    access_token: t.access, access_expires_in: deps.cfg.ACCESS_TTL_SECONDS, refresh_token: t.refresh, session_id: t.sid,
    onboarding: await onboardingStatus(tx, accountId),
  });

  r.post('/v1/auth/signup', { schema: { body: SignupRequest, response: { 201: TokenPair } }, config: { public: true } }, async (req, reply) => {
    const b = req.body;
    const handle = normalizeHandle(b.handle);
    if (!/^[a-z0-9._]{3,20}$/.test(handle)) throw err.validation({ field: 'handle' });
    const pwHash = await hash(b.password, ARGON);
    const out = await withTx(deps.pool, async (tx) => {
      const pid = publicId('usr');
      let accountId: number;
      try {
        const { rows } = await tx.query<{ id: number }>(
          `INSERT INTO app.account (public_id, email_norm, handle_norm, handle_display, gender)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [pid, normalizeEmail(b.email), handle, handle, b.gender]);
        accountId = rows[0]!.id;
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new AppError('VALIDATION_FAILED', 409, { field: 'email_or_handle' });
        throw e;
      }
      await tx.query('INSERT INTO app.profile (account_id, display_name) VALUES ($1, $2)', [accountId, b.display_name]);
      await tx.query('INSERT INTO app.credential_password (account_id, hash) VALUES ($1, $2)', [accountId, pwHash]);
      await tx.query('INSERT INTO app.wallet (account_id) VALUES ($1)', [accountId]);
      await tx.query('INSERT INTO app.profile_counter (account_id) VALUES ($1)', [accountId]);
      await tx.query('INSERT INTO ident.user_sync_state (account_id) VALUES ($1)', [accountId]);
      const t = await deps.tokens.issue(tx, accountId, pid, platformOf(req.headers['x-platform']));
      return tokenPair(tx, accountId, t);
    });
    reply.code(201);
    return out;
  });

  r.post('/v1/auth/login', { schema: { body: LoginRequest, response: { 200: TokenPair } }, config: { public: true } }, async (req) => {
    const found = await deps.pool.query<{ id: number; public_id: string; hash: string; state: string }>(
      `SELECT a.id, a.public_id, c.hash, a.state FROM app.account a JOIN app.credential_password c ON c.account_id = a.id
        WHERE a.email_norm = $1`, [normalizeEmail(req.body.email)]);
    const row = found.rows[0];
    dummyHash ??= hash('flero-dummy-password', ARGON);
    const ok = await verify(row?.hash ?? (await dummyHash), req.body.password);
    if (!row || !ok || row.state !== 'ACTIVE') throw err.unauthenticated(); // one generic answer
    return withTx(deps.pool, async (tx) => {
      // a sign-in while other sessions are open is a new device: tell the owner (security, cannot be muted)
      const others = await tx.query('SELECT 1 FROM app.session WHERE account_id = $1 AND revoked_at IS NULL LIMIT 1', [row.id]);
      const t = await deps.tokens.issue(tx, row.id, row.public_id, platformOf(req.headers['x-platform']));
      if (others.rows[0]) await notify(tx, { recipient: row.id, type: 'SECURITY', ref: `login:${t.sid}` });
      return tokenPair(tx, row.id, t);
    });
  });

  r.post('/v1/auth/refresh', { schema: { body: RefreshRequest, response: { 200: TokenPair } }, config: { public: true } }, async (req) => {
    const res = await withTx(deps.pool, async (tx) => {
      const t = await deps.tokens.rotate(tx, req.body.refresh_token);
      if (t.reused) return null; // committed: the session is now revoked
      return tokenPair(tx, t.accountId, t);
    });
    if (!res) {
      deps.sessions.invalidateAll();
      throw err.unauthenticated();
    }
    return res;
  });

  r.post('/v1/auth/logout', async (req, reply) => {
    await deps.pool.query(
      `WITH s AS (UPDATE app.session SET revoked_at = now() WHERE id = $1 RETURNING id)
       SELECT pg_notify('flero_rt', json_build_object('a', $2::bigint, 't', 'session.revoked', 'sid', $1::text)::text) FROM s`,
      [req.auth!.sid, req.auth!.aid]); // open sockets of this session close at once
    deps.sessions.invalidate(req.auth!.sid);
    reply.code(204).send();
  });

  r.get('/v1/me', { schema: { response: { 200: Me } } }, async (req) => withTx(deps.pool, (tx) => loadMe(tx, req.auth!.aid)));
}
