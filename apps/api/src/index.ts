import { TokenService } from './auth/tokens.ts';
import { loadConfig } from './config.ts';
import { createPool } from './db.ts';
import { buildServer, SessionCache } from './server.ts';
import { devScanner } from './account/avatar.ts';
import { DevMailer, errUnconfiguredMailer } from './mail.ts';
import { DevStorage, UnconfiguredStorage } from './storage.ts';
import { DevPurchaseVerifier } from './wallet/iap.ts';

const cfg = loadConfig();
const pool = createPool(cfg.DATABASE_URL, cfg.DB_POOL_MAX);
const tokens = await TokenService.create(cfg);
const app = buildServer({ cfg, pool, tokens, sessions: new SessionCache(pool), verifier: new DevPurchaseVerifier(cfg.NODE_ENV === 'production'),
  // e-mail is an INTEGRATION: production refuses to start a dev mailer and answers 503 until a sender is configured
  mailer: cfg.NODE_ENV === 'production' ? errUnconfiguredMailer : new DevMailer(),
  // object storage + image safety scan are INTEGRATIONS: production refuses uploads (503) until S3/vendor exist
  storage: cfg.NODE_ENV === 'production' ? new UnconfiguredStorage() : new DevStorage(cfg.STORAGE_DIR, cfg.PUBLIC_BASE_URL, `${cfg.JWT_ISSUER}:dev-storage:${process.pid}`),
  scanner: devScanner });

// Graceful shutdown: stop accepting, drain in-flight requests, close the pool (rolling deploys, doc 16 §4).
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
}

await app.listen({ port: cfg.PORT, host: '0.0.0.0' });

// Development convenience: attach the realtime gateway to the same server (production runs it separately).
if (cfg.NODE_ENV === 'development') {
  const { Gateway } = await import('./realtime/gateway.ts');
  const gw = new Gateway({ pool, databaseUrl: cfg.DATABASE_URL, tokens, sessions: new SessionCache(pool) });
  await gw.attach(app.server);
}
