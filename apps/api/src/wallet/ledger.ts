import type { Tx } from '../db.ts';
import { AppError, err } from '../errors.ts';

export type LedgerAccount =
  | 'USER_AVAILABLE' | 'USER_HELD' | 'USER_DEBT'
  | 'SYS_IAP_CLEARING' | 'SYS_PROMO' | 'SYS_ADMIN_GRANT' | 'SYS_SUB_BONUS' | 'SYS_SINK_UNLOCK'
  | 'SYS_SINK_BOOST' | 'SYS_COMPENSATION' | 'SYS_CHARGEBACK_LOSS' | 'SYS_GIFT_TRANSIT';

export interface Posting { account: LedgerAccount; owner?: number; amount: number }

/** Operation types; they map 1:1 to the client-facing WalletTransaction.kind. */
export const OP_KIND = {
  IAP_CREDIT: 'TOP_UP', GIFT_SEND: 'GIFT_SENT', GIFT_RECEIVE: 'GIFT_RECEIVED', UNLOCK: 'UNLOCK', BOOST: 'BOOST',
  PLUS_BONUS: 'BONUS', PROMO: 'PROMO', ADMIN_GRANT: 'GRANT', COMPENSATION: 'COMPENSATION', IAP_REVERSAL: 'REVERSAL',
} as const;
export type LedgerOp = keyof typeof OP_KIND;

export interface WalletRow { account_id: number; available: number; held: number; debt: number; frozen: boolean }

/**
 * Locks wallets in ascending account id order (global lock order, doc 05 §4) so two opposite gifts can never
 * deadlock. Must run before post_ledger touches any wallet in the transaction.
 */
export async function lockWallets(tx: Tx, accountIds: number[]): Promise<Map<number, WalletRow>> {
  const ids = [...new Set(accountIds)].sort((a, b) => a - b);
  const { rows } = await tx.query<WalletRow>(
    `SELECT account_id, available, held, debt, frozen FROM app.wallet WHERE account_id = ANY($1::bigint[])
      ORDER BY account_id FOR UPDATE`, [ids]);
  return new Map(rows.map((r) => [r.account_id, r]));
}

/** A spender must have an unfrozen wallet with no outstanding chargeback debt (REQ-GLD-07). */
export function assertCanSpend(w: WalletRow | undefined, price: number) {
  if (!w || w.frozen) throw err.unavailable();
  if (w.debt > 0) throw err.payment('INSUFFICIENT_GOLD', { reason: 'debt' });
  if (w.available < price) throw err.payment('INSUFFICIENT_GOLD', { required: price, available: w.available });
}

/**
 * The only way the API moves Gold: app.post_ledger (balanced double entry, idempotent on account+op+key).
 * Returns replayed=true when the same key + payload was already posted (exactly-once).
 */
export async function postLedger(tx: Tx, a: {
  op: LedgerOp; account: number | null; key: string; hash: Buffer; actor: string; reason?: string; postings: Posting[];
}): Promise<{ txnId: number; publicId: string; replayed: boolean }> {
  if (a.postings.reduce((s, p) => s + p.amount, 0) !== 0) throw new Error(`unbalanced postings for ${a.op}`);
  try {
    const { rows } = await tx.query<{ txn_id: number; replayed: boolean }>(
      'SELECT txn_id, replayed FROM app.post_ledger($1, $2, $3, $4, $5, $6, $7::jsonb)',
      [a.op, a.account, a.key, a.hash, a.actor, a.reason ?? null,
        JSON.stringify(a.postings.map((p) => ({ account: p.account, owner: p.owner ?? null, amount: p.amount })))]);
    const r = rows[0]!;
    // separate statement: a join in the same statement would not see the row the function just inserted
    const t = await tx.query<{ public_id: string }>('SELECT public_id FROM app.ledger_transaction WHERE id = $1', [r.txn_id]);
    return { txnId: r.txn_id, publicId: t.rows[0]!.public_id, replayed: r.replayed };
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'P0409') throw err.conflict('IDEMPOTENCY_PAYLOAD_MISMATCH');
    if (code === '23514') throw err.payment('INSUFFICIENT_GOLD'); // wallet.available >= 0 CHECK
    if (e instanceof AppError) throw e;
    throw e;
  }
}

export async function walletView(tx: Tx, accountId: number) {
  const { rows } = await tx.query<WalletRow>('SELECT account_id, available, held, debt, frozen FROM app.wallet WHERE account_id = $1', [accountId]);
  const w = rows[0];
  if (!w) return { available: 0, restricted: false, restriction_key: null };
  const key = w.frozen ? 'wallet.restriction.frozen' : w.debt > 0 ? 'wallet.restriction.debt' : w.held > 0 ? 'wallet.restriction.hold' : null;
  return { available: w.available, restricted: key !== null, restriction_key: key };
}
