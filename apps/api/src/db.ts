import pg from 'pg';
import { err } from './errors.ts';

export type Tx = pg.PoolClient;

export function createPool(url: string, max: number): pg.Pool {
  const pool = new pg.Pool({
    connectionString: url,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 2_000, // fail fast → retryable 503, never hang a request
    statement_timeout: 5_000,
    application_name: 'flero-api',
  });
  // int8 → number. Safe: FLERO ids and Gold amounts stay far below 2^53.
  pg.types.setTypeParser(20, (v) => Number(v));
  return pool;
}

const RETRYABLE = new Set(['40001', '40P01']); // serialization_failure, deadlock_detected

/**
 * Runs `fn` in one transaction. Retries serialization failures/deadlocks up to 3 times with jitter
 * (doc 05 §4). Any thrown error rolls back everything — no partial economic state can be committed.
 */
export async function withTx<T>(pool: pg.Pool, fn: (tx: Tx) => Promise<T>, isolation: 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE' = 'READ COMMITTED'): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let client: pg.PoolClient;
    try {
      client = await pool.connect();
    } catch {
      throw err.retryable();
    }
    try {
      await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      const code = (e as { code?: string }).code;
      if (code && RETRYABLE.has(code) && attempt < 3) {
        await new Promise((r) => setTimeout(r, 5 + Math.random() * 25 * (attempt + 1)));
        continue;
      }
      throw e;
    } finally {
      client.release();
    }
  }
}
