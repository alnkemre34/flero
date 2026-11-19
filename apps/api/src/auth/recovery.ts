import { createHmac, randomBytes, randomInt } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { EmailVerifyRequest, PasswordChangeRequest, PasswordReset, PasswordResetRequest } from '@flero/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { withTx, type Tx } from '../db.ts';
import { AppError, err } from '../errors.ts';
import { normalizeEmail, sha256 } from '../ids.ts';
import { notify } from '../notifications.ts';
import type { Deps } from '../server.ts';

const ARGON = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
const RESET_TTL_MIN = 30;
const CODE_TTL_MIN = 15;
const RESEND_COOLDOWN_S = 60;

/** Revokes sessions (optionally keeping one) and tells their open sockets to close. */
async function revokeSessions(tx: Tx, accountId: number, keep: string | null) {
  await tx.query(
    `WITH s AS (UPDATE app.session SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR id <> $2) RETURNING id)
     SELECT pg_notify('flero_rt', json_build_object('a', $1::bigint, 't', 'session.revoked', 'sid', id::text)::text) FROM s`, [accountId, keep]);
}

export function recoveryRoutes(app: FastifyInstance, deps: Deps) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const codeHash = (accountId: number, code: string) => createHmac('sha256', `email-code:${deps.cfg.JWT_ISSUER}`).update(`${accountId}:${code}`).digest();

  /** Always 204 whether or not the e-mail exists (no account enumeration); at most one mail per minute. */
  r.post('/v1/auth/password/reset-request', { config: { public: true }, schema: { body: PasswordResetRequest } }, async (req, reply) => {
    const email = normalizeEmail(req.body.email);
    const { rows } = await deps.pool.query<{ id: number }>(`SELECT id FROM app.account WHERE email_norm = $1 AND state = 'ACTIVE'`, [email]);
    const acc = rows[0];
    if (acc) {
      const recent = await deps.pool.query(`SELECT 1 FROM app.password_reset WHERE account_id = $1 AND created_at > now() - interval '1 minute'`, [acc.id]);
      if (!recent.rows[0]) {
        const token = randomBytes(32).toString('base64url');
        await deps.pool.query(`INSERT INTO app.password_reset (token_hash, account_id, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))`, [sha256(token), acc.id, RESET_TTL_MIN]);
        await deps.mailer.send({ to: email, template: 'password_reset', vars: { link: `flero://reset-password?token=${token}`, token, minutes: String(RESET_TTL_MIN) } });
      }
    }
    reply.code(204).send();
  });

  /** Single-use token; on success every session is signed out (a reset usually means the account was at risk). */
  r.post('/v1/auth/password/reset', { config: { public: true }, schema: { body: PasswordReset } }, async (req, reply) => {
    const pw = await hash(req.body.new_password, ARGON);
    await withTx(deps.pool, async (tx) => {
      const { rows } = await tx.query<{ account_id: number }>(
        `UPDATE app.password_reset SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING account_id`, [sha256(req.body.token)]);
      const acc = rows[0]?.account_id;
      if (!acc) throw err.unauthenticated();
      await tx.query('UPDATE app.credential_password SET hash = $2 WHERE account_id = $1', [acc, pw]);
      await tx.query('UPDATE app.password_reset SET used_at = now() WHERE account_id = $1 AND used_at IS NULL', [acc]); // other links die too
      await revokeSessions(tx, acc, null);
      await notify(tx, { recipient: acc, type: 'SECURITY', ref: `pwreset:${sha256(req.body.token).toString('hex').slice(0, 16)}` });
    });
    deps.sessions.invalidateAll();
    reply.code(204).send();
  });

  /** Signed-in change: re-checks the current password; keeps this session, signs out every other one. */
  r.post('/v1/me/password', { schema: { body: PasswordChangeRequest } }, async (req, reply) => {
    const me = req.auth!.aid;
    const { rows } = await deps.pool.query<{ hash: string; email: string | null }>(
      'SELECT c.hash, a.email_norm AS email FROM app.credential_password c JOIN app.account a ON a.id = c.account_id WHERE c.account_id = $1', [me]);
    if (!rows[0] || !(await verify(rows[0].hash, req.body.current_password))) throw new AppError('VALIDATION_FAILED', 400, { field: 'current_password' });
    if (req.body.current_password === req.body.new_password) throw new AppError('VALIDATION_FAILED', 400, { field: 'new_password' });
    const pw = await hash(req.body.new_password, ARGON);
    await withTx(deps.pool, async (tx) => {
      await tx.query('UPDATE app.credential_password SET hash = $2 WHERE account_id = $1', [me, pw]);
      await revokeSessions(tx, me, req.auth!.sid);
      await notify(tx, { recipient: me, type: 'SECURITY', ref: `pwchange:${Date.now()}` });
    });
    deps.sessions.invalidateAll();
    if (rows[0].email) await deps.mailer.send({ to: rows[0].email, template: 'password_changed', vars: {} });
    reply.code(204).send();
  });

  /** 6-digit code by e-mail; one live code per account, 60 s resend cooldown. */
  r.post('/v1/auth/email/resend', async (req, reply) => {
    const me = req.auth!.aid;
    const { rows } = await deps.pool.query<{ email: string | null; verified: boolean; recent: boolean }>(
      `SELECT a.email_norm AS email, a.email_verified_at IS NOT NULL AS verified,
              EXISTS (SELECT 1 FROM app.email_code e WHERE e.account_id = a.id AND e.sent_at > now() - make_interval(secs => $2)) AS recent
         FROM app.account a WHERE a.id = $1`, [me, RESEND_COOLDOWN_S]);
    const a = rows[0];
    if (!a?.email || a.verified) { reply.code(204).send(); return; }
    if (a.recent) throw err.rateLimited();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await deps.pool.query(
      `INSERT INTO app.email_code (account_id, code_hash, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))
       ON CONFLICT (account_id) DO UPDATE SET code_hash = EXCLUDED.code_hash, attempts = 0, sent_at = now(), expires_at = EXCLUDED.expires_at`,
      [me, codeHash(me, code), CODE_TTL_MIN]);
    await deps.mailer.send({ to: a.email, template: 'email_code', vars: { code, minutes: String(CODE_TTL_MIN) } });
    reply.code(204).send();
  });

  /** Wrong attempts are committed before the error is returned, so the 5-attempt limit cannot be bypassed. */
  r.post('/v1/auth/email/verify', { schema: { body: EmailVerifyRequest } }, async (req, reply) => {
    const me = req.auth!.aid;
    const outcome = await withTx(deps.pool, async (tx) => {
      const { rows } = await tx.query<{ code_hash: Buffer; attempts: number; live: boolean }>(
        'SELECT code_hash, attempts, expires_at > now() AS live FROM app.email_code WHERE account_id = $1 FOR UPDATE', [me]);
      const c = rows[0];
      if (!c || !c.live || c.attempts >= 5) return 'expired' as const;
      if (!c.code_hash.equals(codeHash(me, req.body.code))) {
        await tx.query('UPDATE app.email_code SET attempts = attempts + 1 WHERE account_id = $1', [me]);
        return 'wrong' as const;
      }
      await tx.query('UPDATE app.account SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1', [me]);
      await tx.query('DELETE FROM app.email_code WHERE account_id = $1', [me]);
      return 'ok' as const;
    });
    if (outcome !== 'ok') throw new AppError('VALIDATION_FAILED', 400, { field: 'code', reason: outcome });
    reply.code(204).send();
  });
}
