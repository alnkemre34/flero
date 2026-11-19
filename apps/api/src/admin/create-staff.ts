import { loadConfig } from '../config.ts';
import { createPool } from '../db.ts';
import { normalizeEmail } from '../ids.ts';
import { hashStaffPassword } from './routes.ts';

/**
 * Bootstrap the first SUPERADMIN (run once by the owner):
 *   FLERO_STAFF_PASSWORD=... node src/admin/create-staff.ts owner@example.com "Owner Name"
 * The password is read from the environment so it never lands in shell history or process listings.
 */
const [email, name] = process.argv.slice(2);
const password = process.env.FLERO_STAFF_PASSWORD;
if (!email || !name || !password || password.length < 12) {
  console.error('usage: FLERO_STAFF_PASSWORD=<min 12 chars> node src/admin/create-staff.ts <email> "<display name>"');
  process.exit(2);
}
const pool = createPool(loadConfig().DATABASE_URL, 1);
await pool.query(
  `INSERT INTO app.staff_user (email, display_name, password_hash, roles) VALUES ($1, $2, $3, ARRAY['SUPERADMIN'])
   ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, roles = EXCLUDED.roles, disabled_at = NULL`,
  [normalizeEmail(email), name, await hashStaffPassword(password)]);
console.log(`SUPERADMIN ready: ${normalizeEmail(email)}`);
await pool.end();
