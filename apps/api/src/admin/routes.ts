import { hash, verify } from '@node-rs/argon2';
import { validateDiscoveryConfig } from '@flero/shuffle-core';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTx } from '../db.ts';
import { AppError, err } from '../errors.ts';
import { decodeCursor, encodeCursor } from '../http.ts';
import { fingerprint, normalizeEmail, sha256 } from '../ids.ts';
import { notify } from '../notifications.ts';
import { select, type Config } from '../shuffle/engine.ts';
import { invalidateConfigCache } from '../shuffle/routes.ts';
import { lockWallets, postLedger } from '../wallet/ledger.ts';
import { audit, auditBody, can, PERMISSIONS, requirePerm, type AdminDeps, type Role } from './server.ts';

const ARGON = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
const STAFF_SESSION_HOURS = 8;
const Reason = z.string().trim().min(5).max(500);
const PublicUser = z.strictObject({ public_id: z.string().regex(/^usr_[a-z2-7]{26}$/) });
const Limit = z.coerce.number().int().min(1).max(100).default(50);
let dummy: Promise<string> | undefined;

export function adminRoutes(app: FastifyInstance, deps: AdminDeps) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const db = deps.pool;

  // ---------- auth ----------
  r.post('/admin/v1/auth/login', { config: { public: true }, schema: { body: z.strictObject({ email: z.email(), password: z.string().min(1).max(200) }) } }, async (req) => {
    const { rows } = await db.query<{ id: number; email: string; password_hash: string; roles: Role[]; display_name: string }>(
      'SELECT id, email, password_hash, roles, display_name FROM app.staff_user WHERE email = $1 AND disabled_at IS NULL', [normalizeEmail(req.body.email)]);
    const s = rows[0];
    dummy ??= hash('flero-admin-dummy', ARGON);
    const ok = await verify(s?.password_hash ?? (await dummy), req.body.password);
    if (!s || !ok) throw err.unauthenticated(); // production: SSO + WebAuthn in front of this (integration)
    const sess = await db.query<{ id: string }>(
      `INSERT INTO app.staff_session (staff_id, expires_at) VALUES ($1, now() + make_interval(hours => $2)) RETURNING id`, [s.id, STAFF_SESSION_HOURS]);
    const token = await deps.tokens.signAccess({ sub: s.email, sid: sess.rows[0]!.id, aid: s.id });
    return { token, expires_in: STAFF_SESSION_HOURS * 3600, staff: { email: s.email, display_name: s.display_name, roles: s.roles } };
  });

  r.post('/admin/v1/auth/logout', async (req, reply) => {
    await db.query('UPDATE app.staff_session SET revoked_at = now() WHERE id = $1', [req.staff!.sid]);
    reply.code(204).send();
  });

  r.get('/admin/v1/me', async (req) => {
    const s = req.staff!;
    const { rows } = await db.query<{ display_name: string }>('SELECT display_name FROM app.staff_user WHERE id = $1', [s.id]);
    const permissions = (Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]).filter((p) => can(s, p));
    return { email: s.email, display_name: rows[0]!.display_name, roles: s.roles, permissions };
  });

  // ---------- dashboard ----------
  r.get('/admin/v1/dashboard', async (req) => {
    requirePerm(req, 'dashboard.read');
    const { rows } = await db.query(`
      SELECT
        (SELECT count(*) FROM app.account WHERE state <> 'DELETED')::int AS accounts,
        (SELECT count(*) FROM app.account WHERE created_at > now() - interval '24 hours')::int AS signups_24h,
        (SELECT count(*) FROM app.account WHERE created_at > now() - interval '7 days')::int AS signups_7d,
        (SELECT count(DISTINCT account_id) FROM app.plus_entitlement WHERE state IN ('ACTIVE','GRACE') AND now() < COALESCE(grace_until, valid_until))::int AS plus_active,
        (SELECT count(*) FROM app.boost_entitlement WHERE state = 'ACTIVE' AND now() BETWEEN starts_at AND ends_at)::int AS boosts_active,
        (SELECT count(*) FROM app.session WHERE revoked_at IS NULL AND last_seen_at > now() - interval '24 hours')::int AS sessions_24h,
        (SELECT count(*) FROM ident.conversation WHERE created_at > now() - interval '24 hours')::int AS conversations_24h,
        (SELECT COALESCE(sum(gold_amount), 0) FROM app.store_transaction st JOIN app.ledger_transaction t ON t.id = st.ledger_txn_id
          WHERE t.created_at > now() - interval '24 hours' AND st.state = 'CREDITED')::int AS gold_sold_24h,
        (SELECT COALESCE(sum(p.amount), 0) FROM app.ledger_posting p JOIN app.ledger_account la ON la.id = p.ledger_account_id
          JOIN app.ledger_transaction t ON t.id = p.txn_id WHERE la.kind IN ('SYS_SINK_UNLOCK','SYS_SINK_BOOST') AND t.created_at > now() - interval '24 hours')::int AS gold_spent_24h,
        (SELECT COALESCE(sum(available), 0) FROM app.wallet)::bigint AS gold_outstanding,
        (SELECT count(*) FROM ident.report WHERE status IN ('OPEN','IN_REVIEW'))::int AS reports_open,
        (SELECT count(*) FROM ident.report WHERE status IN ('OPEN','IN_REVIEW') AND priority = 0)::int AS reports_urgent,
        (SELECT count(*) FROM app.approval WHERE decision IS NULL)::int AS approvals_pending`);
    const daily = await db.query<{ day: string; signups: number }>(`
      SELECT to_char(d, 'YYYY-MM-DD') AS day, (SELECT count(*) FROM app.account a WHERE a.created_at >= d AND a.created_at < d + interval '1 day')::int AS signups
        FROM generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') d ORDER BY d`);
    return { ...rows[0], signups_daily: daily.rows };
  });

  // ---------- users ----------
  r.get('/admin/v1/users', { schema: { querystring: z.strictObject({ q: z.string().max(100).optional(), state: z.enum(['ACTIVE', 'SUSPENDED', 'BANNED']).optional(), cursor: z.string().optional(), limit: Limit }) } }, async (req, reply) => {
    requirePerm(req, 'users.read');
    const q = req.query.q?.trim().toLowerCase().replace(/^@/, '') ?? '';
    const cur = decodeCursor(req.query.cursor, z.strictObject({ i: z.number().int() }));
    const { rows } = await db.query(
      `SELECT a.id, a.public_id, a.handle_norm AS handle, p.display_name, a.state, a.gender, a.created_at, a.email_norm AS email,
              c.label_key AS city_key, d.label_key AS district_key, COALESCE(w.available, 0)::int AS gold,
              EXISTS (SELECT 1 FROM app.plus_entitlement pe WHERE pe.account_id = a.id AND pe.state IN ('ACTIVE','GRACE') AND now() < COALESCE(pe.grace_until, pe.valid_until)) AS plus
         FROM app.account a JOIN app.profile p ON p.account_id = a.id LEFT JOIN app.wallet w ON w.account_id = a.id
         LEFT JOIN app.city c ON c.id = a.home_city_id LEFT JOIN app.district d ON d.id = a.home_district_id
        WHERE ($1 = '' OR a.handle_norm LIKE $1 || '%' OR a.public_id = $1 OR a.email_norm = $1)
          AND ($2::app.account_state IS NULL OR a.state = $2) AND ($3::bigint IS NULL OR a.id < $3)
        ORDER BY a.id DESC LIMIT $4`, [q.replace(/[%_\\]/g, (m) => `\\${m}`), req.query.state ?? null, cur?.i ?? null, req.query.limit + 1]);
    const page = rows.slice(0, req.query.limit);
    if (rows.length > req.query.limit) reply.header('x-next-cursor', encodeCursor({ i: page.at(-1)!.id }));
    return page.map(({ id: _id, ...u }) => u);
  });

  r.get('/admin/v1/users/:public_id', { schema: { params: PublicUser } }, async (req) => {
    requirePerm(req, 'users.read');
    const { rows } = await db.query(
      `SELECT a.id, a.public_id, a.handle_norm AS handle, p.display_name, p.bio, a.state, a.gender, a.created_at, a.email_norm AS email,
              a.email_verified_at IS NOT NULL AS email_verified, a.age_assured_at IS NOT NULL AS age_assured, a.discoverable, a.moderation_hold,
              c.label_key AS city_key, d.label_key AS district_key, a.home_region_last_changed_at,
              COALESCE(w.available, 0)::int AS gold, COALESCE(w.debt, 0)::int AS debt, COALESCE(w.frozen, false) AS frozen,
              pc.followers, pc.likes,
              (SELECT count(*) FROM app.session s WHERE s.account_id = a.id AND s.revoked_at IS NULL)::int AS active_sessions,
              (SELECT count(*) FROM ident.report r WHERE r.target_account_id = a.id)::int AS reports_against,
              (SELECT max(COALESCE(grace_until, valid_until)) FROM app.plus_entitlement pe WHERE pe.account_id = a.id AND now() < COALESCE(pe.grace_until, pe.valid_until)) AS plus_until,
              (SELECT json_build_object('scope', scope, 'ends_at', ends_at) FROM app.boost_entitlement b WHERE b.owner_id = a.id AND b.state = 'ACTIVE' AND now() < b.ends_at LIMIT 1) AS boost
         FROM app.account a JOIN app.profile p ON p.account_id = a.id JOIN app.profile_counter pc ON pc.account_id = a.id
         LEFT JOIN app.wallet w ON w.account_id = a.id
         LEFT JOIN app.city c ON c.id = a.home_city_id LEFT JOIN app.district d ON d.id = a.home_district_id
        WHERE a.public_id = $1`, [req.params.public_id]);
    const u = rows[0];
    if (!u) throw err.notFound();
    // ledger history is shown without counterparties: gifts never reveal the other side (C1a)
    const ledger = await db.query(
      `SELECT t.public_id, t.op_type, t.created_at, t.actor, t.reason, SUM(p.amount)::int AS amount
         FROM app.ledger_account la JOIN app.ledger_posting p ON p.ledger_account_id = la.id JOIN app.ledger_transaction t ON t.id = p.txn_id
        WHERE la.owner_id = $1 AND la.kind = 'USER_AVAILABLE' GROUP BY t.id ORDER BY t.id DESC LIMIT 30`, [u.id]);
    const { id: _id, ...rest } = u;
    return { ...rest, ledger: ledger.rows };
  });

  r.post('/admin/v1/users/:public_id/state', { schema: { params: PublicUser, body: z.strictObject({ state: z.enum(['ACTIVE', 'SUSPENDED', 'BANNED']), reason: Reason }) } }, async (req) => {
    const staff = requirePerm(req, 'users.moderate');
    return withTx(db, async (tx) => {
      const { rows } = await tx.query<{ id: number; state: string }>('SELECT id, state FROM app.account WHERE public_id = $1 FOR UPDATE', [req.params.public_id]);
      const a = rows[0];
      if (!a || a.state === 'DELETED') throw err.notFound();
      if (a.state === req.body.state) return { state: a.state };
      // the directory trigger removes/restores discovery membership in the same transaction
      await tx.query('UPDATE app.account SET state = $2 WHERE id = $1', [a.id, req.body.state]);
      if (req.body.state !== 'ACTIVE') {
        await tx.query(
          `WITH s AS (UPDATE app.session SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL RETURNING id)
           SELECT pg_notify('flero_rt', json_build_object('a', $1::bigint, 't', 'session.revoked', 'sid', id::text)::text) FROM s`, [a.id]);
      }
      await audit(tx, { staff, action: 'account.state', targetType: 'account', targetRef: req.params.public_id, reason: req.body.reason, diff: { from: a.state, to: req.body.state } });
      return { state: req.body.state };
    });
  });

  // ---------- money: four-eyes (maker → checker, DB-enforced approved_by <> requested_by) ----------
  r.post('/admin/v1/users/:public_id/gold-adjustments', { schema: { params: PublicUser, body: z.strictObject({ amount: z.int().min(-100_000).max(100_000).refine((v) => v !== 0), reason: Reason }) } }, async (req, reply) => {
    const staff = requirePerm(req, 'finance.request');
    const out = await withTx(db, async (tx) => {
      const { rows } = await tx.query<{ id: number }>('SELECT id FROM app.account WHERE public_id = $1', [req.params.public_id]);
      if (!rows[0]) throw err.notFound();
      const a = await tx.query<{ id: number }>(
        `INSERT INTO app.approval (kind, payload, requested_by, reason) VALUES ('LEDGER_ADJUSTMENT', $1, $2, $3) RETURNING id`,
        [JSON.stringify({ account_id: rows[0].id, public_id: req.params.public_id, amount: req.body.amount }), staff.id, req.body.reason]);
      await audit(tx, { staff, action: 'approval.request', targetType: 'account', targetRef: req.params.public_id, reason: req.body.reason, diff: { amount: req.body.amount } });
      return { approval_id: a.rows[0]!.id, status: 'PENDING' };
    });
    reply.code(201);
    return out;
  });

  r.get('/admin/v1/approvals', { schema: { querystring: z.strictObject({ status: z.enum(['PENDING', 'DECIDED']).default('PENDING') }) } }, async (req) => {
    requirePerm(req, 'finance.read');
    const { rows } = await db.query(
      `SELECT a.id, a.kind, a.payload, a.reason, a.created_at, a.decision, a.decided_at, a.executed_at,
              rq.email AS requested_by, ap.email AS approved_by
         FROM app.approval a JOIN app.staff_user rq ON rq.id = a.requested_by LEFT JOIN app.staff_user ap ON ap.id = a.approved_by
        WHERE ($1 = 'PENDING') = (a.decision IS NULL) ORDER BY a.id DESC LIMIT 100`, [req.query.status]);
    return rows;
  });

  r.post('/admin/v1/approvals/:id/decision', { schema: { params: z.strictObject({ id: z.coerce.number().int() }), body: z.strictObject({ decision: z.enum(['APPROVED', 'REJECTED']) }) } }, async (req) => {
    const staff = requirePerm(req, 'finance.approve');
    return withTx(db, async (tx) => {
      const { rows } = await tx.query<{ id: number; kind: string; payload: { account_id: number; public_id: string; amount: number }; requested_by: number; decision: string | null; reason: string }>(
        'SELECT id, kind, payload, requested_by, decision, reason FROM app.approval WHERE id = $1 FOR UPDATE', [req.params.id]);
      const a = rows[0];
      if (!a) throw err.notFound();
      if (a.decision) throw err.conflict('ACTION_UNAVAILABLE');
      if (a.requested_by === staff.id) throw new AppError('ACTION_UNAVAILABLE', 403, { reason: 'four_eyes' });
      await tx.query('UPDATE app.approval SET decision = $2, approved_by = $3, decided_at = now() WHERE id = $1', [a.id, req.body.decision, staff.id]);
      if (req.body.decision === 'APPROVED' && a.kind === 'LEDGER_ADJUSTMENT') {
        const { account_id: acc, amount } = a.payload;
        const w = (await lockWallets(tx, [acc])).get(acc);
        if (amount < 0 && (w?.available ?? 0) < -amount) throw err.payment('INSUFFICIENT_GOLD');
        await postLedger(tx, {
          op: 'ADMIN_GRANT', account: acc, key: `approval:${a.id}`, hash: fingerprint(a.payload), actor: `staff:${staff.id}`, reason: a.reason,
          postings: [{ account: 'SYS_ADMIN_GRANT', amount: -amount }, { account: 'USER_AVAILABLE', owner: acc, amount }],
        });
        await tx.query('UPDATE app.approval SET executed_at = now() WHERE id = $1', [a.id]);
        await notify(tx, { recipient: acc, type: 'WALLET', ref: `adjustment:${a.id}` });
      }
      await audit(tx, { staff, action: `approval.${req.body.decision.toLowerCase()}`, targetType: 'approval', targetRef: String(a.id), diff: a.payload });
      return { id: a.id, decision: req.body.decision };
    });
  });

  // ---------- reports (moderation queue; MINOR_SAFETY first) ----------
  r.get('/admin/v1/reports', { schema: { querystring: z.strictObject({ status: z.enum(['OPEN', 'IN_REVIEW', 'ACTIONED', 'DISMISSED']).default('OPEN') }) } }, async (req) => {
    requirePerm(req, 'reports.read');
    // the reporter is shown only as a keyed alias; anonymous-thread context is never joined to identities here
    const { rows } = await db.query(
      `SELECT r.public_id, r.target_type, r.reason, r.note, r.priority, r.status, r.created_at, r.target_ref,
              t.public_id AS target_public_id, t.handle_norm AS target_handle, t.state AS target_state,
              (SELECT count(*) FROM ident.report x WHERE x.target_account_id = r.target_account_id)::int AS target_report_count,
              substr(encode(public.hmac(convert_to('reporter:' || r.reporter_id::text, 'UTF8'), (SELECT k FROM admin_secret.alias_key), 'sha256'), 'hex'), 1, 12) AS reporter_alias
         FROM ident.report r LEFT JOIN app.account t ON t.id = r.target_account_id
        WHERE r.status = $1 ORDER BY r.priority, r.created_at LIMIT 100`, [req.query.status]);
    return rows;
  });

  r.post('/admin/v1/reports/:public_id/resolve', { schema: { params: z.strictObject({ public_id: z.string().regex(/^rpt_[a-z2-7]{26}$/) }), body: z.strictObject({ action: z.enum(['DISMISS', 'SUSPEND_TARGET', 'BAN_TARGET']), note: Reason }) } }, async (req) => {
    const staff = requirePerm(req, 'reports.resolve');
    return withTx(db, async (tx) => {
      const { rows } = await tx.query<{ id: number; target_account_id: number | null; status: string }>(
        'SELECT id, target_account_id, status FROM ident.report WHERE public_id = $1 FOR UPDATE', [req.params.public_id]);
      const rep = rows[0];
      if (!rep) throw err.notFound();
      if (rep.status === 'ACTIONED' || rep.status === 'DISMISSED') throw err.conflict('ACTION_UNAVAILABLE');
      if (req.body.action !== 'DISMISS' && rep.target_account_id) {
        const state = req.body.action === 'BAN_TARGET' ? 'BANNED' : 'SUSPENDED';
        await tx.query(`UPDATE app.account SET state = $2 WHERE id = $1 AND state = 'ACTIVE'`, [rep.target_account_id, state]);
        await tx.query(
          `WITH s AS (UPDATE app.session SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL RETURNING id)
           SELECT pg_notify('flero_rt', json_build_object('a', $1::bigint, 't', 'session.revoked', 'sid', id::text)::text) FROM s`, [rep.target_account_id]);
      }
      await tx.query(`UPDATE ident.report SET status = $2, resolved_at = now(), resolved_by = $3 WHERE id = $1`,
        [rep.id, req.body.action === 'DISMISS' ? 'DISMISSED' : 'ACTIONED', staff.id]);
      const reporter = await tx.query<{ reporter_id: number }>('SELECT reporter_id FROM ident.report WHERE id = $1', [rep.id]);
      await notify(tx, { recipient: reporter.rows[0]!.reporter_id, type: 'MODERATION', ref: `report:${req.params.public_id}` });
      await audit(tx, { staff, action: `report.${req.body.action.toLowerCase()}`, targetType: 'report', targetRef: req.params.public_id, reason: req.body.note });
      return { status: req.body.action === 'DISMISS' ? 'DISMISSED' : 'ACTIONED' };
    });
  });

  // ---------- catalog & pricing (DEC-04: owner-managed, versioned; a change = a new immutable version) ----------
  r.get('/admin/v1/catalog', async (req) => {
    requirePerm(req, 'catalog.read');
    const [gold, boost, plus, unlock] = await Promise.all([
      db.query(`SELECT DISTINCT ON (store, product_id) store, product_id, version, gold_amount, active, created_by, created_at FROM app.gold_product ORDER BY store, product_id, version DESC`),
      db.query(`SELECT DISTINCT ON (package_id) package_id, version, scope, (extract(epoch FROM duration) / 60)::int AS duration_minutes, price_gold, active, created_by, created_at FROM app.boost_package ORDER BY package_id, version DESC`),
      db.query(`SELECT DISTINCT ON (plan_id) plan_id, version, period, store, product_id, bonus_gold, active, created_by, created_at FROM app.plus_plan ORDER BY plan_id, version DESC`),
      db.query(`SELECT DISTINCT ON (kind) kind, version, price_gold, created_by, created_at FROM app.unlock_price ORDER BY kind, version DESC`),
    ]);
    return { gold_products: gold.rows, boost_packages: boost.rows, plus_plans: plus.rows, unlock_prices: unlock.rows };
  });

  r.get('/admin/v1/catalog/history', { schema: { querystring: z.strictObject({ kind: z.enum(['gold_product', 'boost_package', 'plus_plan', 'unlock_price']), key: z.string().max(100) }) } }, async (req) => {
    requirePerm(req, 'catalog.read');
    const q = {
      gold_product: `SELECT version, gold_amount AS value, active, created_by, created_at FROM app.gold_product WHERE product_id = $1 ORDER BY version DESC`,
      boost_package: `SELECT version, price_gold AS value, active, created_by, created_at FROM app.boost_package WHERE package_id::text = $1 ORDER BY version DESC`,
      plus_plan: `SELECT version, bonus_gold AS value, active, created_by, created_at FROM app.plus_plan WHERE plan_id = $1 ORDER BY version DESC`,
      unlock_price: `SELECT version, price_gold AS value, true AS active, created_by, created_at FROM app.unlock_price WHERE kind = $1 ORDER BY version DESC`,
    }[req.query.kind];
    return (await db.query(q, [req.query.key])).rows;
  });

  const catalogWrite = async (req: Parameters<typeof requirePerm>[0], action: string, ref: string, fn: (tx: Parameters<Parameters<typeof withTx>[1]>[0], by: string) => Promise<unknown>, reason: string) => {
    const staff = requirePerm(req, 'catalog.write');
    return withTx(db, async (tx) => {
      const out = await fn(tx, staff.email);
      await audit(tx, { staff, action, targetType: 'catalog', targetRef: ref, reason, diff: out });
      return out;
    });
  };

  r.post('/admin/v1/catalog/gold-products', { schema: { body: z.strictObject({ store: z.enum(['APPLE', 'GOOGLE']), product_id: z.string().regex(/^[a-z0-9_.]{3,100}$/), gold_amount: z.int().min(1).max(1_000_000), active: z.boolean().default(true), reason: Reason }) } }, async (req, reply) => {
    const b = req.body;
    const out = await catalogWrite(req, 'catalog.gold_product', `${b.store}:${b.product_id}`, async (tx, by) => {
      await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('gold_product:' || $1 || $2, 0))`, [b.store, b.product_id]);
      await tx.query('UPDATE app.gold_product SET active = false WHERE store = $1 AND product_id = $2 AND active', [b.store, b.product_id]);
      const { rows } = await tx.query(
        `INSERT INTO app.gold_product (store, product_id, version, gold_amount, active, created_by)
         SELECT $1, $2, COALESCE(max(version), 0) + 1, $3, $4, $5 FROM app.gold_product WHERE store = $1 AND product_id = $2
         RETURNING store, product_id, version, gold_amount, active`, [b.store, b.product_id, b.gold_amount, b.active, by]);
      return rows[0];
    }, b.reason);
    reply.code(201);
    return out;
  });

  r.post('/admin/v1/catalog/boost-packages', { schema: { body: z.strictObject({ package_id: z.int().min(1).optional(), scope: z.enum(['DISTRICT', 'CITY']), duration_minutes: z.int().min(15).max(43_200), price_gold: z.int().min(1).max(100_000), active: z.boolean().default(true), reason: Reason }) } }, async (req, reply) => {
    const b = req.body;
    const out = await catalogWrite(req, 'catalog.boost_package', String(b.package_id ?? 'new'), async (tx, by) => {
      await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('boost_package', 0))`);
      const id = b.package_id ?? (await tx.query<{ n: number }>('SELECT COALESCE(max(package_id), 0) + 1 AS n FROM app.boost_package')).rows[0]!.n;
      await tx.query('UPDATE app.boost_package SET active = false WHERE package_id = $1 AND active', [id]);
      const { rows } = await tx.query(
        `INSERT INTO app.boost_package (package_id, version, scope, duration, price_gold, active, created_by)
         SELECT $1, COALESCE(max(version), 0) + 1, $2, make_interval(mins => $3), $4, $5, $6 FROM app.boost_package WHERE package_id = $1
         RETURNING package_id, version, scope, price_gold, active`, [id, b.scope, b.duration_minutes, b.price_gold, b.active, by]);
      return rows[0];
    }, b.reason);
    reply.code(201);
    return out;
  });

  r.post('/admin/v1/catalog/plus-plans', { schema: { body: z.strictObject({ plan_id: z.string().regex(/^[a-z0-9_]{3,64}$/), period: z.enum(['MONTHLY', 'YEARLY']), store: z.enum(['APPLE', 'GOOGLE']), product_id: z.string().regex(/^[a-z0-9_.]{3,100}$/), bonus_gold: z.int().min(0).max(100_000), active: z.boolean().default(true), reason: Reason }) } }, async (req, reply) => {
    const b = req.body;
    const out = await catalogWrite(req, 'catalog.plus_plan', b.plan_id, async (tx, by) => {
      await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('plus_plan:' || $1, 0))`, [b.plan_id]);
      await tx.query('UPDATE app.plus_plan SET active = false WHERE plan_id = $1 AND active', [b.plan_id]);
      const { rows } = await tx.query(
        `INSERT INTO app.plus_plan (plan_id, version, period, store, product_id, bonus_gold, active, created_by)
         SELECT $1, COALESCE(max(version), 0) + 1, $2, $3, $4, $5, $6, $7 FROM app.plus_plan WHERE plan_id = $1
         RETURNING plan_id, version, period, store, product_id, bonus_gold, active`, [b.plan_id, b.period, b.store, b.product_id, b.bonus_gold, b.active, by]);
      return rows[0];
    }, b.reason);
    reply.code(201);
    return out;
  });

  r.post('/admin/v1/catalog/unlock-prices', { schema: { body: z.strictObject({ kind: z.enum(['PERSISTENT', 'ONE_VIEW']), price_gold: z.int().min(1).max(10_000), reason: Reason }) } }, async (req, reply) => {
    const b = req.body;
    const out = await catalogWrite(req, 'catalog.unlock_price', b.kind, async (tx, by) => {
      await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('unlock_price:' || $1, 0))`, [b.kind]);
      const { rows } = await tx.query(
        `INSERT INTO app.unlock_price (kind, version, price_gold, created_by)
         SELECT $1, COALESCE(max(version), 0) + 1, $2, $3 FROM app.unlock_price WHERE kind = $1 RETURNING kind, version, price_gold`, [b.kind, b.price_gold, by]);
      return rows[0];
    }, b.reason);
    reply.code(201);
    return out;
  });

  // ---------- discovery config (bounded on every path: app + DB CHECKs, SHF-T38) ----------
  const DiscoveryBody = z.strictObject({ shuffle_batch_size: z.int(), priority_bps: z.int(), local_bps: z.int() });
  r.get('/admin/v1/discovery/config', async (req) => {
    requirePerm(req, 'catalog.read');
    const { rows } = await db.query(
      `SELECT id, shuffle_batch_size, priority_bps, local_bps, created_by, reason, created_at, activated_at FROM app.discovery_config_version ORDER BY id DESC LIMIT 20`);
    return { active: rows.find((r) => r.activated_at) ?? null, history: rows };
  });

  r.post('/admin/v1/discovery/config', { schema: { body: DiscoveryBody.extend({ reason: Reason }) } }, async (req, reply) => {
    const staff = requirePerm(req, 'discovery.write');
    const v = validateDiscoveryConfig({ shuffleBatchSize: req.body.shuffle_batch_size, priorityBps: req.body.priority_bps, localBps: req.body.local_bps });
    if (!v.ok) throw err.validation({ violations: v.violations.join(',') });
    const out = await withTx(db, async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO app.discovery_config_version (shuffle_batch_size, priority_bps, local_bps, created_by, reason, activated_at)
         VALUES ($1, $2, $3, $4, $5, now()) RETURNING id, shuffle_batch_size, priority_bps, local_bps, activated_at`,
        [v.config.shuffleBatchSize, v.config.priorityBps, v.config.localBps, staff.email, req.body.reason]);
      await audit(tx, { staff, action: 'discovery.config', targetType: 'discovery_config', targetRef: String(rows[0].id), reason: req.body.reason, diff: v.config });
      return rows[0];
    });
    invalidateConfigCache();
    reply.code(201);
    return out;
  });

  /** Read-only simulation on live directory data: what would this config do on a real surface? */
  r.post('/admin/v1/discovery/simulate', { schema: { body: DiscoveryBody.extend({ district_id: z.int().min(1), runs: z.int().min(1).max(200).default(50) }) } }, async (req) => {
    requirePerm(req, 'catalog.read');
    const v = validateDiscoveryConfig({ shuffleBatchSize: req.body.shuffle_batch_size, priorityBps: req.body.priority_bps, localBps: req.body.local_bps });
    if (!v.ok) throw err.validation({ violations: v.violations.join(',') });
    const d = await db.query<{ city_id: number }>('SELECT city_id FROM app.district WHERE id = $1', [req.body.district_id]);
    if (!d.rows[0]) throw err.notFound();
    const cfg: Config = { id: 0, n: v.config.shuffleBatchSize, priorityBps: v.config.priorityBps, localBps: v.config.localBps };
    const modes: Record<string, number> = {};
    let boost = 0; let remote = 0; let cards = 0; const ms: number[] = [];
    for (let i = 0; i < req.body.runs; i++) {
      const t = performance.now();
      const s = await select(db, 0, { mode: 'DISTRICT', city: d.rows[0].city_id, district: req.body.district_id, genders: ['FEMALE', 'MALE'] }, cfg);
      ms.push(performance.now() - t);
      modes[s.mode] = (modes[s.mode] ?? 0) + 1;
      cards += s.cards.length;
      boost += s.cards.filter((c) => c.placement === 'BOOST_BLOCK').length;
      remote += s.cards.filter((c) => c.remote).length;
    }
    ms.sort((a, b) => a - b);
    return {
      runs: req.body.runs, modes, avg_cards: cards / req.body.runs,
      boost_share: cards ? boost / cards : 0, remote_share: cards ? remote / cards : 0,
      latency_ms: { p50: ms[Math.floor(ms.length * 0.5)], p95: ms[Math.min(ms.length - 1, Math.floor(ms.length * 0.95))] },
    };
  });

  // ---------- banners ----------
  const BannerBody = z.strictObject({
    placement: z.enum(['HOME', 'WALLET', 'SHUFFLE']).default('HOME'), image_url: z.url().startsWith('https://'),
    alt_key: z.string().regex(/^[a-z0-9_]+(\.[a-z0-9_]+)+$/), destination: z.string().regex(/^flero:\/\/[a-z/_-]{1,64}$/),
    sponsored: z.boolean(), priority: z.int().min(0).max(100).default(0), starts_at: z.iso.datetime({ offset: true }).optional(),
    ends_at: z.iso.datetime({ offset: true }), active: z.boolean().default(true),
  });
  r.get('/admin/v1/banners', async (req) => {
    requirePerm(req, 'catalog.read');
    return (await db.query(`SELECT public_id, placement, image_url, alt_key, destination, sponsored, priority, starts_at, ends_at, active, created_by FROM app.banner ORDER BY active DESC, priority DESC, id DESC LIMIT 200`)).rows;
  });
  r.post('/admin/v1/banners', { schema: { body: BannerBody } }, async (req, reply) => {
    const staff = requirePerm(req, 'banners.write');
    const b = req.body;
    const out = await withTx(db, async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO app.banner (placement, image_url, alt_key, destination, sponsored, priority, starts_at, ends_at, active, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()), $8, $9, $10) RETURNING public_id`,
        [b.placement, b.image_url, b.alt_key, b.destination, b.sponsored, b.priority, b.starts_at ?? null, b.ends_at, b.active, staff.email]);
      await audit(tx, { staff, action: 'banner.create', targetType: 'banner', targetRef: rows[0].public_id, diff: b });
      return rows[0];
    });
    reply.code(201);
    return out;
  });
  r.post('/admin/v1/banners/:public_id/active', { schema: { params: z.strictObject({ public_id: z.string().regex(/^bnr_[a-z2-7]{26}$/) }), body: z.strictObject({ active: z.boolean() }) } }, async (req) => {
    const staff = requirePerm(req, 'banners.write');
    return withTx(db, async (tx) => {
      const { rowCount } = await tx.query('UPDATE app.banner SET active = $2 WHERE public_id = $1', [req.params.public_id, req.body.active]);
      if (!rowCount) throw err.notFound();
      await audit(tx, { staff, action: req.body.active ? 'banner.activate' : 'banner.deactivate', targetType: 'banner', targetRef: req.params.public_id });
      return { active: req.body.active };
    });
  });

  // ---------- audit & staff ----------
  r.get('/admin/v1/audit', { schema: { querystring: z.strictObject({ cursor: z.string().optional(), limit: Limit }) } }, async (req, reply) => {
    requirePerm(req, 'audit.read');
    const cur = decodeCursor(req.query.cursor, z.strictObject({ i: z.number().int() }));
    const { rows } = await db.query(
      `SELECT e.id, e.at, e.actor_type, s.email AS actor, e.action, e.target_type, e.target_ref, e.reason, e.diff, encode(e.hash, 'hex') AS hash
         FROM app.audit_event e LEFT JOIN app.staff_user s ON e.actor_type = 'STAFF' AND s.id::text = e.actor_id
        WHERE ($1::bigint IS NULL OR e.id < $1) ORDER BY e.id DESC LIMIT $2`, [cur?.i ?? null, req.query.limit + 1]);
    const page = rows.slice(0, req.query.limit);
    if (rows.length > req.query.limit) reply.header('x-next-cursor', encodeCursor({ i: page.at(-1)!.id }));
    return page;
  });

  /** Recomputes the whole chain: any edited or deleted row breaks it at that point. */
  r.get('/admin/v1/audit/verify', async (req) => {
    requirePerm(req, 'audit.read');
    const { rows } = await db.query<{ id: number; at: Date; actor_id: string; action: string; target_type: string; target_ref: string; reason: string | null; diff: unknown; prev_hash: Buffer; hash: Buffer }>(
      'SELECT id, at, actor_id, action, target_type, target_ref, reason, diff, prev_hash, hash FROM app.audit_event ORDER BY id');
    let prev: Buffer = Buffer.alloc(32);
    for (const e of rows) {
      const body = auditBody({ at: e.at.toISOString(), actor: Number(e.actor_id), action: e.action, t: e.target_type, r: e.target_ref, reason: e.reason, diff: e.diff ?? null });
      if (!e.prev_hash.equals(prev) || !sha256(Buffer.concat([prev, Buffer.from(body)])).equals(e.hash)) return { ok: false, broken_at: e.id, checked: rows.length };
      prev = e.hash;
    }
    return { ok: true, checked: rows.length };
  });

  r.post('/admin/v1/staff', { schema: { body: z.strictObject({ email: z.email(), display_name: z.string().min(1).max(80), password: z.string().min(12).max(200), roles: z.array(z.enum(Object.keys({ SUPERADMIN: 1, SUPPORT_L1: 1, SUPPORT_L2: 1, MODERATOR: 1, SENIOR_MODERATOR: 1, TS_INVESTIGATOR: 1, TS_LEAD: 1, FINANCE_VIEWER: 1, FINANCE_OPERATOR: 1, FINANCE_APPROVER: 1, GROWTH: 1, PRODUCT_CONFIG_EDITOR: 1, PRODUCT_CONFIG_APPROVER: 1, SRE: 1, PRIVACY_OFFICER: 1, AUDITOR: 1 }) as [Role, ...Role[]])).min(1) }) } }, async (req, reply) => {
    const staff = requirePerm(req, 'staff.manage');
    const out = await withTx(db, async (tx) => {
      try {
        const { rows } = await tx.query('INSERT INTO app.staff_user (email, display_name, password_hash, roles) VALUES ($1, $2, $3, $4) RETURNING id, email, roles',
          [normalizeEmail(req.body.email), req.body.display_name, await hash(req.body.password, ARGON), req.body.roles]);
        await audit(tx, { staff, action: 'staff.create', targetType: 'staff', targetRef: rows[0].email, diff: { roles: req.body.roles } });
        return rows[0];
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw err.conflict('VALIDATION_FAILED', { field: 'email' });
        throw e;
      }
    });
    reply.code(201);
    return out;
  });

  r.get('/admin/v1/staff', async (req) => {
    requirePerm(req, 'staff.manage');
    return (await db.query('SELECT id, email, display_name, roles, disabled_at, created_at FROM app.staff_user ORDER BY id')).rows;
  });
}

export const hashStaffPassword = (pw: string) => hash(pw, ARGON);
