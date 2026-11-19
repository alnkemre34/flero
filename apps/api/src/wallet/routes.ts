import {
  BOOST_DISCLOSURE_KEYS, BoostActivationRequest, BoostActivationStatus, BoostCatalog, BoostEntitlement, BoostQuote,
  BoostQuoteRequest, MyBoost, PlusPlan, PlusStatus, PurchaseVerifyRequest, StoreProduct, Wallet, WalletTransaction,
} from '@flero/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type pg from 'pg';
import { z } from 'zod';
import { withTx, type Tx } from '../db.ts';
import { AppError, err } from '../errors.ts';
import { decodeCursor, encodeCursor, idempotencyKey, ListQuery } from '../http.ts';
import { fingerprint } from '../ids.ts';
import { notify } from '../notifications.ts';
import type { Deps } from '../server.ts';
import type { Store } from './iap.ts';
import { assertCanSpend, lockWallets, OP_KIND, postLedger, walletView, type LedgerOp } from './ledger.ts';

const QUOTE_TTL_SECONDS = 300;
const PLUS_BENEFITS = ['plus.benefit.city_boost', 'plus.benefit.shuffle_filters', 'plus.benefit.rank_advantage', 'plus.benefit.badge'];

/** Serialises work on one external key (store transaction) across concurrent requests, inside the tx. */
const keyLock = (tx: Tx, key: string) => tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);

export async function isPlus(tx: Tx | pg.Pool, accountId: number): Promise<boolean> {
  const { rows } = await tx.query(
    `SELECT 1 FROM app.plus_entitlement WHERE account_id = $1 AND state IN ('ACTIVE','GRACE')
        AND now() < COALESCE(grace_until, valid_until) LIMIT 1`, [accountId]);
  return rows.length > 0;
}

async function plusStatus(tx: Tx, accountId: number) {
  const { rows } = await tx.query<{ state: string; valid_until: Date; grace_until: Date | null }>(
    `SELECT state, valid_until, grace_until FROM app.plus_entitlement WHERE account_id = $1
      ORDER BY COALESCE(grace_until, valid_until) DESC LIMIT 1`, [accountId]);
  const r = rows[0];
  if (!r) return { active: false, state: 'NONE' as const, valid_until: null, auto_renew: null };
  const end = r.grace_until ?? r.valid_until;
  const live = ['ACTIVE', 'GRACE'].includes(r.state) && end > new Date();
  const state = (live ? r.state : r.state === 'ON_HOLD' ? 'ON_HOLD' : 'EXPIRED') as 'ACTIVE' | 'GRACE' | 'ON_HOLD' | 'EXPIRED';
  return { active: live, state, valid_until: r.valid_until.toISOString(), auto_renew: null };
}

const ENTITLEMENT_SQL = `
  SELECT e.public_id, e.scope, c.label_key AS city_key, d.label_key AS district_key, e.starts_at, e.ends_at, e.price_gold
    FROM app.boost_entitlement e JOIN app.city c ON c.id = e.city_id LEFT JOIN app.district d ON d.id = e.district_id`;
type EntRow = { public_id: string; scope: 'DISTRICT' | 'CITY'; city_key: string; district_key: string | null; starts_at: Date; ends_at: Date; price_gold: number };
const entitlementView = (r: EntRow, balanceAfter: number) => ({
  boost_id: r.public_id, scope: r.scope, target_city_label_key: r.city_key, target_district_label_key: r.district_key,
  starts_at: r.starts_at.toISOString(), ends_at: r.ends_at.toISOString(), price_gold: r.price_gold, balance_after: balanceAfter,
});

/**
 * Chargeback / refund (worker + admin path). Takes back what is still available and books the rest as a
 * receivable (USER_DEBT), so the wallet never goes negative and books always balance (REQ-GLD-07). Idempotent.
 */
export async function reverseStorePurchase(pool: pg.Pool, store: Store, storeTxnId: string, actor: string) {
  return withTx(pool, async (tx) => {
    await keyLock(tx, `iap:${store}:${storeTxnId}`);
    const { rows } = await tx.query<{ account_id: number; gold_amount: number; state: string }>(
      'SELECT account_id, gold_amount, state FROM app.store_transaction WHERE store = $1 AND store_txn_id = $2 FOR UPDATE', [store, storeTxnId]);
    const st = rows[0];
    if (!st) throw err.notFound();
    if (st.state === 'REVERSED') return { reversed: false };
    const w = (await lockWallets(tx, [st.account_id])).get(st.account_id)!;
    const fromAvailable = Math.min(w.available, st.gold_amount);
    const toDebt = st.gold_amount - fromAvailable;
    await postLedger(tx, {
      op: 'IAP_REVERSAL', account: st.account_id, key: `${store}:${storeTxnId}`, hash: fingerprint({ store, storeTxnId }), actor, reason: 'store_refund',
      postings: [
        ...(fromAvailable > 0 ? [{ account: 'USER_AVAILABLE' as const, owner: st.account_id, amount: -fromAvailable }] : []),
        ...(toDebt > 0 ? [{ account: 'USER_DEBT' as const, owner: st.account_id, amount: -toDebt }] : []),
        { account: 'SYS_IAP_CLEARING', amount: st.gold_amount },
      ],
    });
    await tx.query(`UPDATE app.store_transaction SET state = 'REVERSED' WHERE store = $1 AND store_txn_id = $2`, [store, storeTxnId]);
    await notify(tx, { recipient: st.account_id, type: 'WALLET', ref: `reversal:${store}:${storeTxnId}` });
    return { reversed: true, fromAvailable, toDebt };
  });
}

export function walletRoutes(app: FastifyInstance, deps: Deps) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/v1/wallet', { schema: { response: { 200: Wallet } } }, async (req) => withTx(deps.pool, (tx) => walletView(tx, req.auth!.aid)));

  r.get('/v1/wallet/transactions', { schema: { querystring: ListQuery, response: { 200: z.array(WalletTransaction) } } }, async (req, reply) => {
    const cur = decodeCursor(req.query.cursor, z.strictObject({ t: z.number().int() }));
    const { rows } = await deps.pool.query<{ id: number; public_id: string; op_type: LedgerOp; created_at: Date; amount: number }>(
      `SELECT t.id, t.public_id, t.op_type, t.created_at, SUM(p.amount)::bigint AS amount
         FROM app.ledger_account la
         JOIN app.ledger_posting p ON p.ledger_account_id = la.id
         JOIN app.ledger_transaction t ON t.id = p.txn_id
        WHERE la.kind = 'USER_AVAILABLE' AND la.owner_id = $1 AND ($2::bigint IS NULL OR p.txn_id < $2)
        GROUP BY t.id ORDER BY t.id DESC LIMIT $3`, [req.auth!.aid, cur?.t ?? null, req.query.limit + 1]);
    const page = rows.slice(0, req.query.limit);
    if (rows.length > req.query.limit) reply.header('x-next-cursor', encodeCursor({ t: page.at(-1)!.id }));
    // Counterparty is never revealed by the ledger itself: gifts resolve it through counterpartyView (REQ-GLD-08).
    return page.map((t) => ({ transaction_id: t.public_id, kind: OP_KIND[t.op_type], amount: t.amount, counterparty: null, created_at: t.created_at.toISOString() }));
  });

  // ---------- Gold top-ups ----------
  r.get('/v1/store/products', { schema: { querystring: z.strictObject({ platform: z.enum(['APPLE', 'GOOGLE']) }), response: { 200: z.array(StoreProduct) } } }, async (req) => {
    const { rows } = await deps.pool.query<{ product_id: string; gold_amount: number }>(
      `SELECT product_id, gold_amount FROM (
         SELECT DISTINCT ON (product_id) product_id, gold_amount, active FROM app.gold_product WHERE store = $1
          ORDER BY product_id, version DESC) latest
        WHERE active ORDER BY gold_amount`, [req.query.platform]);
    return rows.map((p) => ({ product_id: p.product_id, platform: req.query.platform, gold_amount: p.gold_amount }));
  });

  r.post('/v1/wallet/purchases/verify', { schema: { body: PurchaseVerifyRequest, response: { 200: Wallet } } }, async (req) => {
    idempotencyKey(req);
    const me = req.auth!.aid;
    const store = req.body.platform;
    const v = await deps.verifier.verify(store, req.body.signed_payload); // network call stays OUTSIDE the tx
    return withTx(deps.pool, async (tx) => {
      await keyLock(tx, `iap:${store}:${v.storeTxnId}`);
      const seen = await tx.query<{ account_id: number }>('SELECT account_id FROM app.store_transaction WHERE store = $1 AND store_txn_id = $2', [store, v.storeTxnId]);
      if (seen.rows[0]) {
        if (seen.rows[0].account_id !== me) throw err.conflict('IDEMPOTENCY_PAYLOAD_MISMATCH');
        return walletView(tx, me); // exactly-once: the retry just reads the result
      }
      // Gold amount = the catalog version in force now; a retired SKU that the store still sold is honoured.
      const prod = await tx.query<{ gold_amount: number }>(
        'SELECT gold_amount FROM app.gold_product WHERE store = $1 AND product_id = $2 ORDER BY version DESC LIMIT 1', [store, v.productId]);
      const n = prod.rows[0]?.gold_amount;
      if (!n) throw err.validation({ field: 'product_id' });
      const w = (await lockWallets(tx, [me])).get(me)!;
      const repay = Math.min(w.debt, n); // a top-up first settles chargeback debt
      const posted = await postLedger(tx, {
        op: 'IAP_CREDIT', account: me, key: `${store}:${v.storeTxnId}`, hash: fingerprint({ store, t: v.storeTxnId, p: v.productId }), actor: 'store',
        postings: [
          { account: 'SYS_IAP_CLEARING', amount: -n },
          ...(repay > 0 ? [{ account: 'USER_DEBT' as const, owner: me, amount: repay }] : []),
          ...(n - repay > 0 ? [{ account: 'USER_AVAILABLE' as const, owner: me, amount: n - repay }] : []),
        ],
      });
      await tx.query(
        `INSERT INTO app.store_transaction (store, store_txn_id, account_id, product_id, gold_amount, state, ledger_txn_id)
         VALUES ($1, $2, $3, $4, $5, 'CREDITED', $6)`, [store, v.storeTxnId, me, v.productId, n, posted.txnId]);
      await notify(tx, { recipient: me, type: 'WALLET', ref: `topup:${posted.publicId}` });
      return walletView(tx, me);
    });
  });

  // ---------- Plus ----------
  r.get('/v1/plus/plans', { schema: { response: { 200: z.array(PlusPlan) } } }, async () => {
    const { rows } = await deps.pool.query<{ plan_id: string; period: 'MONTHLY' | 'YEARLY'; product_id: string }>(
      `SELECT plan_id, period, product_id FROM (
         SELECT DISTINCT ON (plan_id) plan_id, period, product_id, active FROM app.plus_plan ORDER BY plan_id, version DESC) l
        WHERE active ORDER BY period`);
    return rows.map((p) => ({ ...p, benefit_keys: PLUS_BENEFITS }));
  });

  r.get('/v1/me/plus', { schema: { response: { 200: PlusStatus } } }, async (req) => withTx(deps.pool, (tx) => plusStatus(tx, req.auth!.aid)));

  r.post('/v1/plus/verify', { schema: { body: PurchaseVerifyRequest, response: { 200: PlusStatus } } }, async (req) => {
    idempotencyKey(req);
    const me = req.auth!.aid;
    const store = req.body.platform;
    const v = await deps.verifier.verify(store, req.body.signed_payload);
    if (!v.expiresAt || v.expiresAt <= new Date()) throw err.validation({ field: 'signed_payload' });
    return withTx(deps.pool, async (tx) => {
      await keyLock(tx, `plus:${store}:${v.originalTxnId}`);
      const plan = await tx.query<{ bonus_gold: number }>(
        'SELECT bonus_gold FROM app.plus_plan WHERE store = $1 AND product_id = $2 ORDER BY version DESC LIMIT 1', [store, v.productId]);
      if (!plan.rows[0]) throw err.validation({ field: 'product_id' });
      const ex = await tx.query<{ account_id: number }>(
        'SELECT account_id FROM app.plus_entitlement WHERE store = $1 AND original_txn_id = $2 FOR UPDATE', [store, v.originalTxnId]);
      if (ex.rows[0] && ex.rows[0].account_id !== me) throw err.conflict('IDEMPOTENCY_PAYLOAD_MISMATCH');
      if (ex.rows[0]) {
        await tx.query(
          `UPDATE app.plus_entitlement SET valid_until = GREATEST(valid_until, $3), grace_until = NULL, state = 'ACTIVE'
            WHERE store = $1 AND original_txn_id = $2`, [store, v.originalTxnId, v.expiresAt]);
      } else {
        await tx.query(
          `INSERT INTO app.plus_entitlement (store, original_txn_id, account_id, valid_from, valid_until, state)
           VALUES ($1, $2, $3, now(), $4, 'ACTIVE')`, [store, v.originalTxnId, me, v.expiresAt]);
      }
      await notify(tx, { recipient: me, type: 'PLUS_LIFECYCLE', ref: `plus:${store}:${v.storeTxnId}` });
      const bonus = plan.rows[0].bonus_gold;
      if (bonus > 0) {
        await lockWallets(tx, [me]);
        await postLedger(tx, {
          op: 'PLUS_BONUS', account: me, key: `${store}:${v.storeTxnId}`, hash: fingerprint({ store, t: v.storeTxnId }), actor: 'store',
          postings: [{ account: 'SYS_SUB_BONUS', amount: -bonus }, { account: 'USER_AVAILABLE', owner: me, amount: bonus }],
        });
      }
      return plusStatus(tx, me);
    });
  });

  // ---------- Boost ----------
  const disclosure = [...BOOST_DISCLOSURE_KEYS] as [typeof BOOST_DISCLOSURE_KEYS[0], typeof BOOST_DISCLOSURE_KEYS[1]];

  r.get('/v1/boosts/catalog', { schema: { response: { 200: BoostCatalog } } }, async (req) => {
    const plus = await isPlus(deps.pool, req.auth!.aid);
    const { rows } = await deps.pool.query<{ package_id: number; version: number; scope: 'DISTRICT' | 'CITY'; secs: number; price_gold: number }>(
      `SELECT package_id, version, scope, extract(epoch FROM duration)::int AS secs, price_gold FROM (
         SELECT DISTINCT ON (package_id) * FROM app.boost_package ORDER BY package_id, version DESC) l
        WHERE active AND ($1 OR scope = 'DISTRICT') ORDER BY scope DESC, price_gold`, [plus]);
    return { packages: rows.map((p) => ({ package_id: p.package_id, version: p.version, scope: p.scope, duration_seconds: p.secs, price_gold: p.price_gold })), disclosure_keys: disclosure };
  });

  r.post('/v1/boosts/quotes', { schema: { body: BoostQuoteRequest, response: { 201: BoostQuote } } }, async (req, reply) => {
    const me = req.auth!.aid;
    const out = await withTx(deps.pool, async (tx) => {
      const acc = await tx.query<{ home_city_id: number | null; home_district_id: number | null; home_region_version: number; city_key: string; district_key: string }>(
        `SELECT a.home_city_id, a.home_district_id, a.home_region_version, c.label_key AS city_key, d.label_key AS district_key
           FROM app.account a LEFT JOIN app.city c ON c.id = a.home_city_id LEFT JOIN app.district d ON d.id = a.home_district_id
          WHERE a.id = $1`, [me]);
      const a = acc.rows[0]!;
      if (a.home_city_id === null) throw err.unavailable();
      const pkg = await tx.query<{ version: number; scope: string; duration: string; secs: number; price_gold: number; active: boolean }>(
        `SELECT version, scope, duration::text, extract(epoch FROM duration)::int AS secs, price_gold, active FROM app.boost_package
          WHERE package_id = $1 ORDER BY version DESC LIMIT 1`, [req.body.package_id]);
      const p = pkg.rows[0];
      if (!p || !p.active || p.scope !== req.body.scope) throw err.conflict('BOOST_PRODUCT_UNAVAILABLE');
      if (p.scope === 'CITY' && !(await isPlus(tx, me))) throw new AppError('BOOST_SCOPE_REQUIRES_PLUS', 403);
      const district = p.scope === 'DISTRICT' ? a.home_district_id : null;
      const q = await tx.query<{ id: string; expires_at: Date }>(
        `INSERT INTO app.boost_quote (account_id, package_id, package_version, scope, city_id, district_id, price_gold, duration, home_region_version, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::interval, $9, now() + make_interval(secs => $10)) RETURNING id, expires_at`,
        [me, req.body.package_id, p.version, p.scope, a.home_city_id, district, p.price_gold, p.duration, a.home_region_version, QUOTE_TTL_SECONDS]);
      const wallet = await walletView(tx, me);
      return {
        quote_id: q.rows[0]!.id, scope: p.scope as 'DISTRICT' | 'CITY', target_city_label_key: a.city_key,
        target_district_label_key: district ? a.district_key : null, price_gold: p.price_gold, duration_seconds: p.secs,
        available_gold: wallet.available, survives_plus_expiry: true as const,
        quote_expires_at: q.rows[0]!.expires_at.toISOString(), disclosure_keys: disclosure,
      };
    });
    reply.code(201);
    return out;
  });

  /** Atomic: Gold debit + entitlement + quote consumption commit together or not at all (A§8.7). */
  r.post('/v1/boosts/activations', { schema: { body: BoostActivationRequest, response: { 201: BoostEntitlement } } }, async (req, reply) => {
    const me = req.auth!.aid;
    const key = idempotencyKey(req);
    const hash = fingerprint({ quote_id: req.body.quote_id });
    const out = await withTx(deps.pool, async (tx) => {
      // lock order: account → wallet → quote (doc 05 §4); the account lock serialises with home-region changes
      const acc = await tx.query<{ home_city_id: number | null; home_district_id: number | null; home_region_version: number }>(
        'SELECT home_city_id, home_district_id, home_region_version FROM app.account WHERE id = $1 FOR UPDATE', [me]);
      const w = (await lockWallets(tx, [me])).get(me);
      const prior = await tx.query<{ id: number; payload_hash: Buffer }>(
        `SELECT id, payload_hash FROM app.ledger_transaction WHERE account_id = $1 AND op_type = 'BOOST' AND idempotency_key = $2`, [me, key]);
      if (prior.rows[0]) {
        if (!prior.rows[0].payload_hash.equals(hash)) throw err.conflict('IDEMPOTENCY_PAYLOAD_MISMATCH');
        const ent = await tx.query<EntRow>(`${ENTITLEMENT_SQL} WHERE e.gold_ledger_debit_id = $1`, [prior.rows[0].id]);
        return entitlementView(ent.rows[0]!, w?.available ?? 0);
      }
      const qr = await tx.query<{ package_id: number; scope: 'DISTRICT' | 'CITY'; city_id: number; district_id: number | null; price_gold: number; duration: string; home_region_version: number; expires_at: Date; consumed_at: Date | null }>(
        'SELECT package_id, scope, city_id, district_id, price_gold, duration::text, home_region_version, expires_at, consumed_at FROM app.boost_quote WHERE id = $1 AND account_id = $2 FOR UPDATE',
        [req.body.quote_id, me]);
      const q = qr.rows[0];
      if (!q) throw err.notFound();
      if (q.consumed_at || q.expires_at <= new Date()) throw err.conflict('BOOST_QUOTE_EXPIRED');
      const a = acc.rows[0]!;
      if (a.home_region_version !== q.home_region_version || a.home_city_id !== q.city_id) throw err.conflict('BOOST_QUOTE_STALE_REGION');
      if (q.scope === 'CITY' && !(await isPlus(tx, me))) throw new AppError('BOOST_SCOPE_REQUIRES_PLUS', 403);
      assertCanSpend(w, q.price_gold);
      const posted = await postLedger(tx, {
        op: 'BOOST', account: me, key, hash, actor: 'user',
        postings: [{ account: 'USER_AVAILABLE', owner: me, amount: -q.price_gold }, { account: 'SYS_SINK_BOOST', amount: q.price_gold }],
      });
      try {
        await tx.query(
          `INSERT INTO app.boost_entitlement (owner_id, scope, city_id, district_id, starts_at, ends_at, price_gold, gold_ledger_debit_id, quote_id)
           VALUES ($1, $2, $3, $4, now(), now() + $5::interval, $6, $7, $8)`,
          [me, q.scope, q.city_id, q.district_id, q.duration, q.price_gold, posted.txnId, req.body.quote_id]);
      } catch (e) {
        // exclusion constraint: one non-revoked Boost window per owner → the whole tx (incl. the debit) rolls back
        if ((e as { code?: string }).code === '23P01') throw err.conflict('BOOST_ALREADY_ACTIVE');
        throw e;
      }
      await tx.query('UPDATE app.boost_quote SET consumed_at = now() WHERE id = $1', [req.body.quote_id]);
      await notify(tx, { recipient: me, type: 'BOOST_LIFECYCLE', ref: `boost:${posted.publicId}` });
      const ent = await tx.query<EntRow>(`${ENTITLEMENT_SQL} WHERE e.gold_ledger_debit_id = $1`, [posted.txnId]);
      return entitlementView(ent.rows[0]!, w!.available - q.price_gold);
    });
    reply.code(201);
    return out;
  });

  r.get('/v1/boosts/activations/:idempotency_key', { schema: { params: z.strictObject({ idempotency_key: z.uuid() }), response: { 200: BoostActivationStatus } } }, async (req) => {
    const me = req.auth!.aid;
    const { rows } = await deps.pool.query<EntRow & { available: number }>(
      `${ENTITLEMENT_SQL} JOIN app.ledger_transaction t ON t.id = e.gold_ledger_debit_id
         JOIN app.wallet w ON w.account_id = e.owner_id
        WHERE t.account_id = $1 AND t.op_type = 'BOOST' AND t.idempotency_key = $2`.replace('SELECT e.public_id', 'SELECT w.available, e.public_id'),
      [me, req.params.idempotency_key.toLowerCase()]);
    if (!rows[0]) throw err.notFound(); // nothing committed: retrying the activation with the same key is safe
    return { state: 'SUCCEEDED' as const, boost: entitlementView(rows[0], rows[0].available), error_code: null };
  });

  r.get('/v1/me/boost', { schema: { response: { 200: MyBoost } } }, async (req) => {
    const me = req.auth!.aid;
    const { rows } = await deps.pool.query<EntRow & { available: number }>(
      `${ENTITLEMENT_SQL} JOIN app.wallet w ON w.account_id = e.owner_id
        WHERE e.owner_id = $1 AND e.state = 'ACTIVE' AND now() >= e.starts_at AND now() < e.ends_at`.replace('SELECT e.public_id', 'SELECT w.available, e.public_id'), [me]);
    return { active: rows[0] ? entitlementView(rows[0], rows[0].available) : null };
  });
}
