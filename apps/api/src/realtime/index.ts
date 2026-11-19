import { createServer } from 'node:http';
import { TokenService } from '../auth/tokens.ts';
import { loadConfig } from '../config.ts';
import { createPool } from '../db.ts';
import { SessionCache } from '../server.ts';
import { Gateway } from './gateway.ts';

/** Separate deployable (apps/realtime role): same codebase, own process, own scaling (doc 16). */
const cfg = loadConfig();
const pool = createPool(cfg.DATABASE_URL, Math.min(cfg.DB_POOL_MAX, 10));
const gateway = new Gateway({ pool, databaseUrl: cfg.DATABASE_URL, tokens: await TokenService.create(cfg), sessions: new SessionCache(pool) });
const server = createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, connections: gateway.connectionCount })); return; }
  res.writeHead(404).end();
});
await gateway.attach(server);
server.listen(Number(process.env.REALTIME_PORT ?? 8090), '0.0.0.0');

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, async () => { await gateway.close(); server.close(); await pool.end(); process.exit(0); });
}
