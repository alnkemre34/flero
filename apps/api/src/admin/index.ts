import { TokenService } from '../auth/tokens.ts';
import { loadConfig } from '../config.ts';
import { createPool } from '../db.ts';
import { buildAdminServer } from './server.ts';

/** Admin API: own process, own port, own token issuer (ADR-013). Bind to a private network in production. */
const cfg = loadConfig();
const pool = createPool(cfg.DATABASE_URL, Math.min(cfg.DB_POOL_MAX, 10));
const tokens = await TokenService.create({ ...cfg, JWT_ISSUER: `${cfg.JWT_ISSUER}:admin`, ACCESS_TTL_SECONDS: 8 * 3600 });
const app = buildAdminServer({ cfg, pool, tokens, ...(process.env.ADMIN_CORS_ORIGIN ? { corsOrigin: process.env.ADMIN_CORS_ORIGIN } : {}) });
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, async () => { await app.close(); await pool.end(); process.exit(0); });
await app.listen({ port: Number(process.env.ADMIN_PORT ?? 8181), host: process.env.ADMIN_HOST ?? '127.0.0.1' });
