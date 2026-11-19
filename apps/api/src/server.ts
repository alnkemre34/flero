import Fastify, { type FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type pg from 'pg';
import { accountRoutes } from './account/routes.ts';
import { recoveryRoutes } from './auth/recovery.ts';
import { authRoutes } from './auth/routes.ts';
import { avatarRoutes, type ImageScanner } from './account/avatar.ts';
import { mediaRoutes } from './media/routes.ts';
import type { Mailer } from './mail.ts';
import { useStorage, type ObjectStorage } from './storage.ts';
import { notificationPrefRoutes } from './notifications.ts';
import { conversationRoutes } from './conversations/routes.ts';
import { homeRoutes, notificationRoutes } from './home/routes.ts';
import { shuffleRoutes } from './shuffle/routes.ts';
import { socialRoutes } from './social/routes.ts';
import type { AccessClaims, TokenService } from './auth/tokens.ts';
import type { Config } from './config.ts';
import { AppError, err, problem } from './errors.ts';
import type { PurchaseVerifier } from './wallet/iap.ts';
import { walletRoutes } from './wallet/routes.ts';

declare module 'fastify' {
  interface FastifyRequest { auth?: AccessClaims }
  interface FastifyContextConfig { public?: boolean }
}

/** Revocation check with a tiny TTL cache: keeps the hot path at zero DB round-trips most of the time (≤ 30 s lag). */
export class SessionCache {
  private readonly ok = new Map<string, number>();
  private readonly pool: pg.Pool;
  private readonly ttlMs: number;
  constructor(pool: pg.Pool, ttlMs = 30_000) { this.pool = pool; this.ttlMs = ttlMs; }
  async assertActive(sid: string) {
    const until = this.ok.get(sid);
    if (until && until > Date.now()) return;
    const { rows } = await this.pool.query<{ revoked_at: Date | null }>('SELECT revoked_at FROM app.session WHERE id = $1', [sid]);
    if (!rows[0] || rows[0].revoked_at) throw err.unauthenticated();
    this.ok.set(sid, Date.now() + this.ttlMs);
    if (this.ok.size > 50_000) this.ok.clear();
  }
  invalidate(sid: string) { this.ok.delete(sid); }
  invalidateAll() { this.ok.clear(); }
}

export interface Deps { cfg: Config; pool: pg.Pool; tokens: TokenService; sessions: SessionCache; verifier: PurchaseVerifier; mailer: Mailer; storage: ObjectStorage; scanner: ImageScanner }

export function buildServer(deps: Deps): FastifyInstance {
  const app = Fastify({
    logger: deps.cfg.NODE_ENV === 'test' ? false : {
      level: deps.cfg.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.body.password', 'req.body.refresh_token', 'req.body.body'],
    },
    genReqId: () => crypto.randomUUID(),
    bodyLimit: 64 * 1024,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // CORS only for explicitly listed origins (the Expo web preview in development). Native apps don't need it.
  const origins = new Set((deps.cfg.CORS_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean));
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && origins.has(origin)) {
      reply.header('access-control-allow-origin', origin).header('vary', 'origin')
        .header('access-control-allow-headers', 'authorization, content-type, idempotency-key, x-platform')
        .header('access-control-allow-methods', 'GET, POST, PUT, DELETE').header('access-control-expose-headers', 'x-next-cursor')
        .header('access-control-max-age', '600');
      if (req.method === 'OPTIONS') return reply.code(204).send();
    }
  });

  app.addHook('onRequest', async (req) => {
    if (req.method === 'OPTIONS') return;
    if (req.routeOptions.config?.public || req.url === '/health') return;
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) throw err.unauthenticated();
    const claims = await deps.tokens.verifyAccess(h.slice(7));
    await deps.sessions.assertActive(claims.sid);
    req.auth = claims;
  });

  app.setErrorHandler((e, req, reply) => {
    if (e instanceof AppError) return reply.code(e.status).type('application/problem+json').send(problem(e, req.id));
    if (hasZodFastifySchemaValidationErrors(e) || (e as { validation?: unknown }).validation) {
      return reply.code(400).type('application/problem+json').send(problem(err.validation(), req.id));
    }
    if ((e as { code?: string }).code === 'FST_ERR_CTP_BODY_TOO_LARGE') return reply.code(413).send(problem(err.validation(), req.id));
    req.log.error({ err: e }, 'unhandled');
    if (deps.cfg.NODE_ENV === 'test') console.error('UNHANDLED', e);
    return reply.code(500).type('application/problem+json').send({ ...problem(err.retryable(), req.id), status: 500 });
  });

  app.get('/health', { config: { public: true } }, async () => {
    await deps.pool.query('SELECT 1');
    return { ok: true };
  });

  authRoutes(app, deps);
  recoveryRoutes(app, deps);
  useStorage(deps.storage);
  avatarRoutes(app, deps);
  mediaRoutes(app, deps);
  notificationPrefRoutes(app, deps);
  accountRoutes(app, deps);
  walletRoutes(app, deps);
  socialRoutes(app, deps);
  conversationRoutes(app, deps);
  shuffleRoutes(app, deps);
  homeRoutes(app, deps);
  notificationRoutes(app, deps);
  return app;
}
