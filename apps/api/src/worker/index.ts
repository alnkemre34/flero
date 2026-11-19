import { loadConfig } from '../config.ts';
import { createPool } from '../db.ts';
import { DevStorage, UnconfiguredStorage } from '../storage.ts';
import { runOnce } from './jobs.ts';

/**
 * Background worker (doc 05 §2): its own process. Every job is idempotent and safe to run on several instances
 * at once (outbox rows are claimed with SKIP LOCKED; cleanups re-check under row locks).
 */
const cfg = loadConfig();
const pool = createPool(cfg.DATABASE_URL, 4);
// object storage is an integration (S3 in production); the worker only removes expired chat photos with it
const storage = cfg.NODE_ENV === 'production' ? new UnconfiguredStorage() : new DevStorage(cfg.STORAGE_DIR, cfg.PUBLIC_BASE_URL, `${cfg.JWT_ISSUER}:dev-storage:worker`);
let stop = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => { stop = true; });

while (!stop) {
  try {
    const r = await runOnce(pool, undefined, storage);
    if (r.push || r.discovery || r.idempotency || r.media) console.info(`[worker] ${JSON.stringify(r)}`);
  } catch (e) {
    console.error('[worker] cycle failed', e instanceof Error ? e.message : e);
  }
  await new Promise((r) => setTimeout(r, 2_000));
}
await pool.end();
