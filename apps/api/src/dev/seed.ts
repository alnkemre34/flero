import { migrate } from '@flero/db';
import pg from 'pg';
import { hashStaffPassword } from '../admin/routes.ts';

/**
 * DEVELOPMENT ONLY: migrates a local database and fills it with a demo catalog, demo staff and synthetic
 * users so the app and the admin panel have something real to show. Refuses to run with NODE_ENV=production.
 *   DATABASE_URL=postgres://flero:flero@127.0.0.1:5433/flero node src/dev/seed.ts
 * Demo staff (local only): owner@flero.local / maker@flero.local / checker@flero.local / mod@flero.local,
 * all with the password in FLERO_DEV_STAFF_PASSWORD (default below — never used outside a dev database).
 */
if (process.env.NODE_ENV === 'production') throw new Error('refusing to seed a production database');
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const password = process.env.FLERO_DEV_STAFF_PASSWORD ?? 'flero-dev-only-2026';

const c = new pg.Client({ connectionString: url });
await c.connect();
console.log('migrations:', (await migrate(c)).join(', ') || 'up to date');
const n = (await c.query<{ n: number }>('SELECT count(*)::int AS n FROM app.gold_product')).rows[0]!.n;
if (n === 0) {
  await c.query(`
    INSERT INTO app.gold_product (store, product_id, version, gold_amount, created_by) VALUES
      ('APPLE', 'gold_100', 1, 100, 'seed'), ('APPLE', 'gold_550', 1, 550, 'seed'), ('APPLE', 'gold_1200', 1, 1200, 'seed'),
      ('GOOGLE', 'gold_100', 1, 100, 'seed'), ('GOOGLE', 'gold_550', 1, 550, 'seed'), ('GOOGLE', 'gold_1200', 1, 1200, 'seed');
    INSERT INTO app.boost_package (package_id, version, scope, duration, price_gold, created_by) VALUES
      (1, 1, 'DISTRICT', '1 hour', 60, 'seed'), (2, 1, 'DISTRICT', '1 day', 250, 'seed'), (3, 1, 'CITY', '1 hour', 150, 'seed'), (4, 1, 'CITY', '1 day', 600, 'seed');
    INSERT INTO app.plus_plan (plan_id, version, period, store, product_id, bonus_gold, created_by) VALUES
      ('plus_monthly_ios', 1, 'MONTHLY', 'APPLE', 'flero.plus.monthly', 50, 'seed'), ('plus_yearly_ios', 1, 'YEARLY', 'APPLE', 'flero.plus.yearly', 700, 'seed'),
      ('plus_monthly_android', 1, 'MONTHLY', 'GOOGLE', 'flero.plus.monthly', 50, 'seed');
    INSERT INTO app.unlock_price (kind, version, price_gold, created_by) VALUES ('ONE_VIEW', 1, 5, 'seed'), ('PERSISTENT', 1, 10, 'seed');`);
  console.log('catalog seeded (placeholder prices — change them in the admin panel)');
}
const hash = await hashStaffPassword(password);
for (const [email, name, roles] of [
  ['owner@flero.local', 'Owner', ['SUPERADMIN']],
  ['maker@flero.local', 'Finans Talep', ['FINANCE_OPERATOR', 'FINANCE_VIEWER']],
  ['checker@flero.local', 'Finans Onay', ['FINANCE_APPROVER', 'FINANCE_VIEWER']],
  ['mod@flero.local', 'Moderatör', ['MODERATOR']],
] as const) {
  await c.query(`INSERT INTO app.staff_user (email, display_name, password_hash, roles) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING`, [email, name, hash, roles]);
}
const m = (await c.query<{ m: number }>('SELECT count(*)::int AS m FROM app.account')).rows[0]!.m;
if (m < 100) {
  const names = ['Defne', 'Ece', 'Zeynep', 'Elif', 'Mert', 'Kaan', 'Deniz', 'Arda', 'Selin', 'Can', 'Ada', 'Emir', 'Nehir', 'Ozan', 'İpek', 'Bora'];
  await c.query(`
    WITH a AS (
      INSERT INTO app.account (public_id, handle_norm, handle_display, gender, home_city_id, home_district_id, home_region_last_changed_at, age_assured_at, created_at)
      SELECT app.opaque_id('usr'), 'demo_' || i, 'demo_' || i, CASE WHEN i % 2 = 0 THEN 'FEMALE' ELSE 'MALE' END::app.gender,
             d.city_id, d.id, now(), now(), now() - (random() * interval '13 days')
        FROM generate_series(1, 600) i JOIN LATERAL (SELECT id, city_id FROM app.district ORDER BY random() + i * 0 LIMIT 1) d ON true RETURNING id),
    p AS (INSERT INTO app.profile (account_id, display_name, bio) SELECT id, ($1::text[])[1 + id % 16], 'Demo profil' FROM a RETURNING account_id),
    pc AS (INSERT INTO app.profile_counter (account_id) SELECT account_id FROM p RETURNING account_id),
    w AS (INSERT INTO app.wallet (account_id) SELECT account_id FROM pc RETURNING account_id)
    INSERT INTO ident.user_sync_state (account_id) SELECT account_id FROM w`, [names]);
  await c.query(`INSERT INTO app.plus_entitlement (store, original_txn_id, account_id, valid_from, valid_until, state)
    SELECT 'APPLE', 'demo-' || id, id, now(), now() + interval '30 days', 'ACTIVE' FROM app.account WHERE handle_norm LIKE 'demo_%' AND id % 9 = 0`);
  await c.query(`INSERT INTO ident.report (reporter_id, target_type, target_account_id, target_ref, reason, note, priority, idempotency_key)
    SELECT a.id, 'PROFILE', b.id, b.public_id, r.reason, r.note, CASE WHEN r.reason = 'MINOR_SAFETY' THEN 0 ELSE 2 END, gen_random_uuid()
      FROM (SELECT id FROM app.account WHERE handle_norm LIKE 'demo_%' ORDER BY id LIMIT 4) a
      JOIN LATERAL (SELECT id, public_id FROM app.account WHERE handle_norm LIKE 'demo_%' AND id <> a.id ORDER BY random() LIMIT 1) b ON true
      JOIN LATERAL (VALUES ('SPAM', 'Aynı mesajı herkese atıyor'), ('HARASSMENT', 'Rahatsız edici mesajlar'), ('MINOR_SAFETY', 'Profilde yaş şüphesi'), ('IMPERSONATION', 'Ünlü birinin fotoğrafı')) r(reason, note) ON true
     LIMIT 4`);
  console.log('demo users, Plus members and reports seeded');
}
await c.end();
console.log('dev staff ready: owner@flero.local (password from FLERO_DEV_STAFF_PASSWORD or the dev default in this file)');
