import { expireMedia } from '../media/routes.ts';
import type { ObjectStorage } from '../storage.ts';
import type pg from 'pg';
import { withTx } from '../db.ts';

/**
 * Push delivery. INTEGRATION STUB: production implements this with APNs (HTTP/2, token auth) and FCM v1. The
 * dev provider only reports which devices would be reached. Copy keys are generic (doc 09 §4).
 */
export interface PushProvider { deliver(device: { provider: 'apns' | 'fcm'; token: Buffer; locale: string }, msg: { title_key: string; conversation_ref: string | null }): Promise<'ok' | 'invalid_token'> }
export const devPush: PushProvider = { async deliver() { return 'ok'; } };

const BATCH = 100;
const MAX_ATTEMPTS = 5;

/** Claims pending push jobs with SKIP LOCKED, delivers to every live device, dead-letters after 5 failures. */
export async function dispatchPush(pool: pg.Pool, provider: PushProvider = devPush): Promise<number> {
  return withTx(pool, async (tx) => {
    const { rows } = await tx.query<{ id: number; payload: { account_id: number; title_key: string; conversation_ref: string | null }; attempts: number }>(
      `SELECT id, payload, attempts FROM ident.outbox_event WHERE topic = 'push' AND processed_at IS NULL AND dead_lettered_at IS NULL
        ORDER BY id LIMIT ${BATCH} FOR UPDATE SKIP LOCKED`);
    for (const job of rows) {
      try {
        const devices = await tx.query<{ token_hash: Buffer; provider: 'apns' | 'fcm'; token_ciphertext: Buffer; locale: string }>(
          `SELECT token_hash, provider, token_ciphertext, locale FROM ident.device_token WHERE account_id = $1 AND invalidated_at IS NULL`, [job.payload.account_id]);
        for (const d of devices.rows) {
          const res = await provider.deliver({ provider: d.provider, token: d.token_ciphertext, locale: d.locale }, job.payload);
          if (res === 'invalid_token') await tx.query('UPDATE ident.device_token SET invalidated_at = now() WHERE token_hash = $1', [d.token_hash]);
        }
        await tx.query('UPDATE ident.outbox_event SET processed_at = now(), attempts = attempts + 1 WHERE id = $1', [job.id]);
      } catch {
        await tx.query(
          `UPDATE ident.outbox_event SET attempts = attempts + 1, dead_lettered_at = CASE WHEN attempts + 1 >= $2 THEN now() END WHERE id = $1`,
          [job.id, MAX_ATTEMPTS]);
      }
    }
    return rows.length;
  });
}

/** One worker cycle: push, expiry cleanup of the discovery directory, idempotency TTL, chat photo retention. */
export async function runOnce(pool: pg.Pool, provider: PushProvider = devPush, storage?: ObjectStorage) {
  const push = await dispatchPush(pool, provider);
  const discovery = (await pool.query<{ n: number }>('SELECT app.discovery_cleanup(500) AS n')).rows[0]!.n;
  const idempotency = (await pool.query(`DELETE FROM app.idempotency_record WHERE created_at < now() - interval '7 days'`)).rowCount ?? 0;
  await pool.query(`DELETE FROM ident.message_idem_recent WHERE created_at < now() - interval '7 days'`);
  const media = storage ? await expireMedia(pool, storage) : 0;
  return { push, discovery, idempotency, media };
}
