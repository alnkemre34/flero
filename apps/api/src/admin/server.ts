import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type pg from 'pg';
import type { TokenService } from '../auth/tokens.ts';
import type { Config } from '../config.ts';
import type { Tx } from '../db.ts';
import { AppError, err, problem } from '../errors.ts';
import { canonicalJson, sha256 } from '../ids.ts';
import { adminRoutes } from './routes.ts';

/**
 * Admin plane (ADR-013, doc 15): a separate Fastify instance on its own port with its own token issuer, so an
 * app token can never call an admin route. Every mutation is RBAC-checked and written to the hash-chained audit.
 */
export type Role =
  | 'SUPERADMIN' | 'SUPPORT_L1' | 'SUPPORT_L2' | 'MODERATOR' | 'SENIOR_MODERATOR' | 'TS_INVESTIGATOR' | 'TS_LEAD'
  | 'FINANCE_VIEWER' | 'FINANCE_OPERATOR' | 'FINANCE_APPROVER' | 'GROWTH' | 'PRODUCT_CONFIG_EDITOR'
  | 'PRODUCT_CONFIG_APPROVER' | 'SRE' | 'PRIVACY_OFFICER' | 'AUDITOR';

const MOD: Role[] = ['MODERATOR', 'SENIOR_MODERATOR', 'TS_INVESTIGATOR', 'TS_LEAD'];
const SUPPORT: Role[] = ['SUPPORT_L1', 'SUPPORT_L2'];
const FIN: Role[] = ['FINANCE_VIEWER', 'FINANCE_OPERATOR', 'FINANCE_APPROVER'];
const PRODUCT: Role[] = ['PRODUCT_CONFIG_EDITOR', 'PRODUCT_CONFIG_APPROVER'];

/** Permission → roles. SUPERADMIN holds every permission; four-eyes still applies to money (DB CHECK). */
export const PERMISSIONS = {
  'dashboard.read': [...MOD, ...SUPPORT, ...FIN, ...PRODUCT, 'GROWTH', 'SRE', 'AUDITOR'],
  'users.read': [...MOD, ...SUPPORT, ...FIN, 'PRIVACY_OFFICER'],
  'users.moderate': ['SENIOR_MODERATOR', 'TS_LEAD', 'MODERATOR'],
  'reports.read': [...MOD],
  'reports.resolve': [...MOD],
  'finance.read': [...FIN, 'AUDITOR'],
  'finance.request': ['FINANCE_OPERATOR'],
  'finance.approve': ['FINANCE_APPROVER'],
  'catalog.read': [...PRODUCT, ...FIN, 'GROWTH'],
  'catalog.write': ['PRODUCT_CONFIG_EDITOR'],
  'discovery.write': ['PRODUCT_CONFIG_EDITOR'],
  'banners.write': ['GROWTH'],
  'audit.read': ['AUDITOR', 'PRIVACY_OFFICER'],
  'staff.manage': [],
} satisfies Record<string, Role[]>;
export type Permission = keyof typeof PERMISSIONS;

export interface Staff { id: number; sid: string; email: string; roles: Role[] }
declare module 'fastify' {
  interface FastifyRequest { staff?: Staff }
}

export const can = (s: Staff, p: Permission) => s.roles.includes('SUPERADMIN') || s.roles.some((r) => (PERMISSIONS[p] as Role[]).includes(r));
export function requirePerm(req: FastifyRequest, p: Permission): Staff {
  const s = req.staff;
  if (!s) throw err.unauthenticated();
  if (!can(s, p)) throw err.unavailable();
  return s;
}

/**
 * Hash-chained, append-only audit (doc 15 §6): hash = sha256(prev_hash ‖ canonical event). The chain head is
 * serialised with a transaction-scoped advisory lock, so concurrent admin actions can never fork the chain.
 */
/** Canonical event body that the chain hashes; verify recomputes exactly this. */
export const auditBody = (e: { at: string; actor: number; action: string; t: string; r: string; reason: string | null; diff: unknown }) =>
  canonicalJson({ ...e, diff: e.diff === undefined ? null : JSON.parse(JSON.stringify(e.diff)) });

export async function audit(tx: Tx, e: { staff: Staff; action: string; targetType: string; targetRef: string; reason?: string | null; diff?: unknown }) {
  await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('audit_chain', 0))`);
  const head = await tx.query<{ hash: Buffer }>('SELECT hash FROM app.audit_event ORDER BY id DESC LIMIT 1');
  const prev = head.rows[0]?.hash ?? Buffer.alloc(32);
  const at = new Date().toISOString();
  const body = auditBody({ at, actor: e.staff.id, action: e.action, t: e.targetType, r: e.targetRef, reason: e.reason ?? null, diff: e.diff ?? null });
  const hash = sha256(Buffer.concat([prev, Buffer.from(body)]));
  await tx.query(
    `INSERT INTO app.audit_event (at, actor_type, actor_id, action, target_type, target_ref, reason, diff, prev_hash, hash)
     VALUES ($1, 'STAFF', $2, $3, $4, $5, $6, $7, $8, $9)`,
    [at, String(e.staff.id), e.action, e.targetType, e.targetRef, e.reason ?? null, e.diff === undefined ? null : JSON.stringify(e.diff), prev, hash]);
}

export interface AdminDeps { cfg: Config; pool: pg.Pool; tokens: TokenService; corsOrigin?: string }

export function buildAdminServer(deps: AdminDeps): FastifyInstance {
  const app = Fastify({
    logger: deps.cfg.NODE_ENV === 'test' ? false : { level: deps.cfg.LOG_LEVEL, redact: ['req.headers.authorization', 'req.body.password'] },
    genReqId: () => randomUUID(),
    bodyLimit: 256 * 1024,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // the admin UI calls through its own server (BFF); CORS is only for local development
  app.addHook('onRequest', async (req, reply) => {
    if (deps.corsOrigin) {
      reply.header('access-control-allow-origin', deps.corsOrigin).header('access-control-allow-headers', 'authorization, content-type')
        .header('access-control-allow-methods', 'GET, POST, PUT, DELETE');
      if (req.method === 'OPTIONS') return reply.code(204).send();
    }
    reply.header('cache-control', 'no-store');
    if (req.routeOptions.config?.public || req.url === '/health') return;
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) throw err.unauthenticated();
    const c = await deps.tokens.verifyAccess(h.slice(7));
    const { rows } = await deps.pool.query<{ email: string; roles: Role[] }>(
      `SELECT u.email, u.roles FROM app.staff_session s JOIN app.staff_user u ON u.id = s.staff_id
        WHERE s.id = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.disabled_at IS NULL AND u.id = $2`, [c.sid, c.aid]);
    if (!rows[0]) throw err.unauthenticated(); // revocation and disabling take effect on the next request
    req.staff = { id: c.aid, sid: c.sid, email: rows[0].email, roles: rows[0].roles };
  });

  app.setErrorHandler((e, req, reply) => {
    if (e instanceof AppError) return reply.code(e.status).type('application/problem+json').send(problem(e, req.id));
    if (hasZodFastifySchemaValidationErrors(e) || (e as { validation?: unknown }).validation) {
      return reply.code(400).type('application/problem+json').send(problem(err.validation(), req.id));
    }
    req.log.error({ err: e }, 'unhandled');
    if (deps.cfg.NODE_ENV === 'test') console.error('ADMIN UNHANDLED', e);
    return reply.code(500).type('application/problem+json').send({ ...problem(err.retryable(), req.id), status: 500 });
  });

  app.get('/health', { config: { public: true } }, async () => ({ ok: true }));
  adminRoutes(app, deps);
  return app;
}
