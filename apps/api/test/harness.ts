import { randomUUID } from 'node:crypto';
import { migrate } from '@flero/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { TokenService } from '../src/auth/tokens.ts';
import { loadConfig } from '../src/config.ts';
import { createPool } from '../src/db.ts';
import { buildServer, SessionCache } from '../src/server.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { devScanner } from '../src/account/avatar.ts';
import { DevMailer } from '../src/mail.ts';
import { DevStorage } from '../src/storage.ts';
import { DevPurchaseVerifier } from '../src/wallet/iap.ts';

export interface Harness { app: FastifyInstance; pool: pg.Pool; tokens: TokenService; mailer: DevMailer; container: StartedPostgreSqlContainer; stop: () => Promise<void> }

/** Real PostgreSQL 17 + all migrations + the real server, driven with app.inject (no network). */
export async function startHarness(): Promise<Harness> {
  const container = await new PostgreSqlContainer('postgres:17').start();
  const admin = new pg.Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  await migrate(admin);
  await admin.end();
  const cfg = loadConfig({ NODE_ENV: 'test', DATABASE_URL: container.getConnectionUri(), DB_POOL_MAX: '20' });
  const pool = createPool(cfg.DATABASE_URL, cfg.DB_POOL_MAX);
  const tokens = await TokenService.create(cfg);
  const mailer = new DevMailer(false);
  const storage = new DevStorage(join(tmpdir(), `flero-test-${randomUUID()}`), 'http://localhost:3000', 'test-secret');
  const app = buildServer({ cfg, pool, tokens, mailer, storage, scanner: devScanner, sessions: new SessionCache(pool, 0), verifier: new DevPurchaseVerifier(false) });
  await app.ready();
  return { app, pool, tokens, mailer, container, stop: async () => { await app.close(); await pool.end(); await container.stop(); } };
}

let n = 0;
export async function signup(app: FastifyInstance, over: Partial<Record<string, string>> = {}) {
  const i = ++n;
  const res = await app.inject({
    method: 'POST', url: '/v1/auth/signup',
    payload: { email: `u${i}-${randomUUID().slice(0, 6)}@test.flero`, password: 'correct horse battery', handle: `user_${i}_${randomUUID().slice(0, 4)}`, display_name: `User ${i}`, gender: 'FEMALE', locale: 'tr', ...over },
  });
  if (res.statusCode !== 201) throw new Error(`signup failed ${res.statusCode} ${res.body}`);
  const body = res.json() as { access_token: string; refresh_token: string };
  return { ...body, auth: { authorization: `Bearer ${body.access_token}` } };
}

/** A fully onboarded user (home region set directly) with its internal id, for engine tests. */
export async function onboarded(h: Harness, district: [number, number] = [34, 3401]) {
  const s = await signup(h.app);
  const me = (await h.app.inject({ method: 'GET', url: '/v1/me', headers: s.auth })).json() as { public_user_id: string };
  const { rows } = await h.pool.query<{ id: number }>(
    `UPDATE app.account SET home_city_id = $2, home_district_id = $3, home_region_last_changed_at = now(), age_assured_at = now()
      WHERE public_id = $1 RETURNING id`, [me.public_user_id, district[0], district[1]]);
  return { ...s, id: rows[0]!.id, pid: me.public_user_id };
}
