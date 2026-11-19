/**
 * Schema v0 invariants on a real PostgreSQL 17 (Testcontainers). Each test documents the requirement it
 * proves; these are DB-level backstops, the domain layer adds its own checks on top.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/migrate.ts';

let container: StartedPostgreSqlContainer;
let db: pg.Client;

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
const opaque = (prefix: string) => prefix + Array.from(randomBytes(26), (b) => B32[b % 32]).join('');

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17').start();
  db = new pg.Client({ connectionString: container.getConnectionUri() });
  await db.connect();
  expect(await migrate(db)).toEqual(['0001_init', '0002_rereview_fixes', '0003_engine', '0004_wallet', '0005_conversations', '0006_discovery', '0007_admin', '0008_notifications', '0009_account_recovery', '0010_avatar_upload', '0011_chat_media']);
  await db.query(`INSERT INTO app.city VALUES (34, 'geo.city.istanbul', true), (6, 'geo.city.ankara', true) ON CONFLICT DO NOTHING`);
  await db.query(`INSERT INTO app.district VALUES (3401, 34, 'geo.district.kadikoy', true),
                  (3402, 34, 'geo.district.esenyurt', true), (601, 6, 'geo.district.cankaya', true) ON CONFLICT DO NOTHING`);
});

afterAll(async () => {
  await db?.end();
  await container?.stop();
});

beforeEach(async () => {
  await db.query('RESET ROLE');
});

let handleSeq = 0;
async function account(gender: 'FEMALE' | 'MALE' = 'FEMALE', district = 3401, city = 34): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO app.account (public_id, handle_norm, handle_display, gender, home_city_id, home_district_id, home_region_last_changed_at)
     VALUES ($1, $2, $2, $3, $4, $5, now()) RETURNING id`,
    [opaque('usr_'), `user_${++handleSeq}`, gender, city, district],
  );
  return Number(rows[0]!.id);
}

async function ledgerTxn(accountId: number | null, op = 'TEST'): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO app.ledger_transaction (op_type, account_id, idempotency_key, payload_hash, actor)
     VALUES ($1, $2, $3, '\\x00', 'test') RETURNING id`,
    [op, accountId, randomUUID()],
  );
  return Number(rows[0]!.id);
}

async function sysLedgerAccount(kind: string): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO app.ledger_account (kind) VALUES ($1)
     ON CONFLICT (kind) WHERE owner_id IS NULL DO UPDATE SET kind = EXCLUDED.kind RETURNING id`,
    [kind],
  );
  return Number(rows[0]!.id);
}

describe('migrations', () => {
  it('are idempotent: re-running applies nothing', async () => {
    expect(await migrate(db)).toEqual([]);
  });
});

describe('identity & geo', () => {
  it('rejects a home district outside the home city', async () => {
    await expect(account('FEMALE', 601, 34)).rejects.toMatchObject({ code: '23503' });
  });
  it('accepts only FEMALE/MALE (REQ-ONB-05) and opaque public ids (REQ-ID-01)', async () => {
    await expect(db.query(`SELECT 'OTHER'::app.gender`)).rejects.toMatchObject({ code: '22P02' });
    await expect(
      db.query(`INSERT INTO app.account (public_id, handle_norm, handle_display, gender, home_city_id, home_district_id, home_region_last_changed_at)
                VALUES ('usr_123', 'badid', 'badid', 'MALE', 34, 3401, now())`),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('social graph', () => {
  it('follow is unique per ordered pair and not self (REQ-SOC-01)', async () => {
    const [a, b] = [await account(), await account()];
    await db.query('INSERT INTO app.follow (follower_id, followee_id) VALUES ($1, $2)', [a, b]);
    await expect(db.query('INSERT INTO app.follow (follower_id, followee_id) VALUES ($1, $2)', [a, b])).rejects.toMatchObject({ code: '23505' });
    await expect(db.query('INSERT INTO app.follow (follower_id, followee_id) VALUES ($1, $1)', [a])).rejects.toMatchObject({ code: '23514' });
  });
  it('likes are irreversible: api_rw cannot DELETE (REQ-SOC-07)', async () => {
    const [a, b] = [await account(), await account()];
    await db.query('INSERT INTO app.like_edge (liker_id, likee_id) VALUES ($1, $2)', [a, b]);
    await db.query('SET ROLE api_rw');
    await expect(db.query('DELETE FROM app.like_edge WHERE liker_id = $1', [a])).rejects.toMatchObject({ code: '42501' });
  });
  it('an ANON_SHIELD block must record its origin conversation', async () => {
    const [a, b] = [await account(), await account()];
    await expect(db.query(`INSERT INTO ident.block (blocker_id, blocked_id, kind) VALUES ($1, $2, 'ANON_SHIELD')`, [a, b]))
      .rejects.toMatchObject({ code: '23514' });
  });
  it('a FULL block over a shield keeps it (shield_retained) so unblock can restore it (re-review New-2)', async () => {
    const [a, b] = [await account(), await account()];
    const c = Number((await db.query<{ id: string }>(`INSERT INTO ident.conversation (public_id, initiator_id, recipient_id) VALUES ($1, $2, $3) RETURNING id`, [opaque('cnv_'), a, b])).rows[0]!.id);
    await db.query(`INSERT INTO ident.block (blocker_id, blocked_id, kind, origin_conversation_id) VALUES ($1, $2, 'ANON_SHIELD', $3)`, [b, a, c]);
    await db.query(`UPDATE ident.block SET kind = 'FULL', shield_retained = true WHERE blocker_id = $1 AND blocked_id = $2`, [b, a]);
    await db.query(`UPDATE ident.block SET kind = 'ANON_SHIELD', shield_retained = false WHERE blocker_id = $1 AND blocked_id = $2`, [b, a]);
    await expect(db.query(`UPDATE ident.block SET shield_retained = true WHERE blocker_id = $1 AND blocked_id = $2`, [b, a]))
      .rejects.toMatchObject({ code: '23514' }); // retained flag only on FULL
  });
  it('likes cannot be rewritten by app roles (re-review New-5)', async () => {
    const [a, b] = [await account(), await account()];
    await db.query('INSERT INTO app.like_edge (liker_id, likee_id) VALUES ($1, $2)', [a, b]);
    await db.query('SET ROLE api_rw');
    await expect(db.query('UPDATE app.like_edge SET created_at = now() WHERE liker_id = $1', [a])).rejects.toMatchObject({ code: '42501' });
  });
});

describe('conversations (DEC-01, review M6)', () => {
  const start = (i: number, r: number) =>
    db.query<{ id: string }>(`INSERT INTO ident.conversation (public_id, initiator_id, recipient_id) VALUES ($1, $2, $3) RETURNING id`, [opaque('cnv_'), i, r]);

  it('allows both directions but only one open thread per ordered pair; a closed one allows a restart', async () => {
    const [x, b] = [await account(), await account()];
    const first = await start(x, b);
    await start(b, x); // opposite direction is a separate thread
    await expect(start(x, b)).rejects.toMatchObject({ code: '23505' });
    await db.query(`UPDATE ident.conversation SET state = 'CLOSED' WHERE id = $1`, [first.rows[0]!.id]);
    await expect(start(x, b)).resolves.toBeDefined();
  });

  it('read watermark can never exceed delivered (REQ-MSG-08)', async () => {
    const [x, b] = [await account(), await account()];
    const c = Number((await start(x, b)).rows[0]!.id);
    await expect(db.query(`INSERT INTO ident.participant (conversation_id, account_id, role, delivered_seq, read_seq) VALUES ($1, $2, 'RECIPIENT', 1, 2)`, [c, b]))
      .rejects.toMatchObject({ code: '23514' });
  });

  it('messages land in the current monthly partition', async () => {
    const [x, b] = [await account(), await account()];
    const c = Number((await start(x, b)).rows[0]!.id);
    await db.query(`INSERT INTO ident.message (conversation_id, seq, public_id, sender_id, client_msg_id, kind, body)
                    VALUES ($1, 1, $2, $3, $4, 'TEXT', 'merhaba')`, [c, opaque('msg_'), x, randomUUID()]);
    const { rows } = await db.query(`SELECT tableoid::regclass::text AS part FROM ident.message WHERE conversation_id = $1`, [c]);
    expect(rows[0]!.part).toMatch(/^ident\.message_\d{6}$/);
  });
});

describe('admin isolation (review C1)', () => {
  it('admin_ro cannot read ident or app tables at all', async () => {
    await db.query('SET ROLE admin_ro');
    for (const table of ['ident.conversation', 'ident.participant', 'ident.message', 'ident.block', 'ident.notification', 'app.account', 'app.ledger_posting']) {
      await expect(db.query(`SELECT 1 FROM ${table} LIMIT 1`), table).rejects.toMatchObject({ code: '42501' });
    }
  });
  it('admin_ro sees conversations only as keyed aliases, with no account columns', async () => {
    const [x, b] = [await account(), await account()];
    await db.query(`INSERT INTO ident.conversation (public_id, initiator_id, recipient_id) VALUES ($1, $2, $3)`, [opaque('cnv_'), x, b]);
    await db.query('SET ROLE admin_ro');
    const { rows, fields } = await db.query('SELECT * FROM admin_v.conversation_alias');
    expect(fields.map((f) => f.name).sort()).toEqual(['alias', 'created_at', 'last_message_at', 'revealed', 'state']);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.alias).toMatch(/^[0-9a-f]{64}$/);
  });
  it('admin_ro cannot read the alias key and cannot influence aliases (re-review C1d)', async () => {
    await db.query('SET ROLE admin_ro');
    await expect(db.query('SELECT k FROM admin_secret.alias_key')).rejects.toMatchObject({ code: '42501' });
    // a session setting no longer influences aliases
    await db.query(`SET flero.admin_alias_key = 'attacker-chosen'`);
    const a = await db.query('SELECT alias FROM admin_v.conversation_alias ORDER BY created_at LIMIT 1');
    await db.query('RESET flero.admin_alias_key');
    const b = await db.query('SELECT alias FROM admin_v.conversation_alias ORDER BY created_at LIMIT 1');
    expect(a.rows[0]!.alias).toBe(b.rows[0]!.alias);
  });
  it('app.follow carries no shield/frozen marker (re-review C1b)', async () => {
    const { rows } = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'follow'`);
    expect(rows.map((r) => r.column_name).sort()).toEqual(['created_at', 'followee_id', 'follower_id']);
  });
});

describe('ledger & wallet (ADR-010)', () => {
  it('rejects an unbalanced transaction at commit', async () => {
    const a = await account();
    const promo = await sysLedgerAccount('SYS_PROMO');
    await db.query('BEGIN');
    const txn = await ledgerTxn(a);
    await db.query('INSERT INTO app.ledger_posting (txn_id, ledger_account_id, amount) VALUES ($1, $2, -5)', [txn, promo]);
    await expect(db.query('COMMIT')).rejects.toMatchObject({ code: '23514' });
  });

  it('accepts a balanced transaction and keeps it append-only', async () => {
    const a = await account();
    const promo = await sysLedgerAccount('SYS_PROMO');
    const userAcc = Number((await db.query<{ id: string }>(`INSERT INTO app.ledger_account (kind, owner_id) VALUES ('USER_AVAILABLE', $1) RETURNING id`, [a])).rows[0]!.id);
    await db.query('BEGIN');
    const txn = await ledgerTxn(a);
    await db.query('INSERT INTO app.ledger_posting (txn_id, ledger_account_id, amount) VALUES ($1, $2, -5), ($1, $3, 5)', [txn, promo, userAcc]);
    await db.query('COMMIT');
    await expect(db.query('UPDATE app.ledger_posting SET amount = 6 WHERE txn_id = $1 AND amount = 5', [txn])).rejects.toMatchObject({ code: '42501' });
    await expect(db.query('DELETE FROM app.ledger_transaction WHERE id = $1', [txn])).rejects.toMatchObject({ code: '42501' });
  });

  it('wallet available can never go negative (REQ-GLD-07)', async () => {
    const a = await account();
    await db.query('INSERT INTO app.wallet (account_id, available) VALUES ($1, 3)', [a]);
    await expect(db.query('UPDATE app.wallet SET available = available - 4 WHERE account_id = $1', [a])).rejects.toMatchObject({ code: '23514' });
  });

  it('api_rw cannot write the wallet or ledger directly', async () => {
    const a = await account();
    await db.query('INSERT INTO app.wallet (account_id, available) VALUES ($1, 3)', [a]);
    await db.query('SET ROLE api_rw');
    await expect(db.query('UPDATE app.wallet SET available = 100 WHERE account_id = $1', [a])).rejects.toMatchObject({ code: '42501' });
    await expect(db.query(`INSERT INTO app.ledger_transaction (op_type, idempotency_key, payload_hash, actor) VALUES ('X', 'k', '\\x00', 'x')`))
      .rejects.toMatchObject({ code: '42501' });
  });

  it('system-account transactions are idempotent too (re-review New-5)', async () => {
    const ins = () => db.query(`INSERT INTO app.ledger_transaction (op_type, account_id, idempotency_key, payload_hash, actor) VALUES ('PROMO_CAMPAIGN', NULL, 'camp-1', '\\x00', 'system')`);
    await ins();
    await expect(ins()).rejects.toMatchObject({ code: '23505' });
  });

  it('a gift is two balanced transactions through SYS_GIFT_TRANSIT, linked only in ident (re-review C1a)', async () => {
    const [s, r] = [await account(), await account()];
    const transit = await sysLedgerAccount('SYS_GIFT_TRANSIT');
    const acc = async (owner: number) => Number((await db.query<{ id: string }>(`INSERT INTO app.ledger_account (kind, owner_id) VALUES ('USER_AVAILABLE', $1) RETURNING id`, [owner])).rows[0]!.id);
    const [sa, ra] = [await acc(s), await acc(r)];
    const c = Number((await db.query<{ id: string }>(`INSERT INTO ident.conversation (public_id, initiator_id, recipient_id) VALUES ($1, $2, $3) RETURNING id`, [opaque('cnv_'), s, r])).rows[0]!.id);
    await db.query('BEGIN');
    const t1 = await ledgerTxn(s, 'GOLD_GIFT_OUT');
    const t2 = await ledgerTxn(r, 'GOLD_GIFT_IN');
    await db.query('INSERT INTO app.ledger_posting (txn_id, ledger_account_id, amount) VALUES ($1, $2, -1), ($1, $3, 1)', [t1, sa, transit]);
    await db.query('INSERT INTO app.ledger_posting (txn_id, ledger_account_id, amount) VALUES ($1, $2, -1), ($1, $3, 1)', [t2, transit, ra]);
    await db.query('INSERT INTO ident.gift_link (sender_txn_id, recipient_txn_id, conversation_id) VALUES ($1, $2, $3)', [t1, t2, c]);
    await db.query('COMMIT');
    const { rows } = await db.query('SELECT DISTINCT account_id FROM app.ledger_posting p JOIN app.ledger_transaction t ON t.id = p.txn_id WHERE p.txn_id = ANY($1)', [[t1, t2]]);
    expect(rows).toHaveLength(2); // each app transaction names exactly one user
  });

  it('a store transaction is credited at most once (REQ-GLD-04)', async () => {
    const a = await account();
    const insert = () => db.query(`INSERT INTO app.store_transaction (store, store_txn_id, account_id, product_id, gold_amount, state)
                                   VALUES ('APPLE', 'tx-1', $1, 'gold_100', 100, 'CREDITED')`, [a]);
    await insert();
    await expect(insert()).rejects.toMatchObject({ code: '23505' });
  });
});

describe('Boost entitlement (A§8.8, REQ-BST-03/05)', () => {
  async function boost(owner: number, starts: string, ends: string, state = 'ACTIVE') {
    const quote = (await db.query<{ id: string }>(
      `INSERT INTO app.boost_quote (account_id, package_id, package_version, scope, city_id, district_id, price_gold, duration, home_region_version, expires_at)
       VALUES ($1, 1, 1, 'DISTRICT', 34, 3401, 5, interval '1 hour', 1, now() + interval '5 min') RETURNING id`, [owner])).rows[0]!.id;
    const debit = await ledgerTxn(owner, 'BOOST_DEBIT');
    return db.query<{ id: string }>(
      `INSERT INTO app.boost_entitlement (owner_id, scope, city_id, district_id, starts_at, ends_at, price_gold, gold_ledger_debit_id, quote_id, state)
       VALUES ($1, 'DISTRICT', 34, 3401, $2, $3, 5, $4, $5, $6) RETURNING id`, [owner, starts, ends, debit, quote, state]);
  }

  it('rejects an overlapping second Boost even with a different scope or key (SHF-T50, T54)', async () => {
    const a = await account();
    await boost(a, '2026-12-01T10:00Z', '2026-12-01T12:00Z');
    await expect(boost(a, '2026-12-01T11:00Z', '2026-12-01T13:00Z')).rejects.toMatchObject({ code: '23P01' });
  });

  it('allows a new Boost exactly at the previous ends_at (SHF-T59, T94)', async () => {
    const a = await account();
    await boost(a, '2026-12-02T10:00Z', '2026-12-02T12:00Z');
    await expect(boost(a, '2026-12-02T12:00Z', '2026-12-02T14:00Z')).resolves.toBeDefined();
  });

  it('a REVOKED Boost does not block a new one', async () => {
    const a = await account();
    await boost(a, '2026-12-03T10:00Z', '2026-12-03T12:00Z', 'REVOKED');
    await expect(boost(a, '2026-12-03T10:30Z', '2026-12-03T11:30Z')).resolves.toBeDefined();
  });

  it('purchase terms are immutable; only ACTIVE→REVOKED; no deletes (REQ-BST-05)', async () => {
    const a = await account();
    const id = Number((await boost(a, '2026-12-04T10:00Z', '2026-12-04T12:00Z')).rows[0]!.id);
    await expect(db.query(`UPDATE app.boost_entitlement SET district_id = 3402 WHERE id = $1`, [id])).rejects.toMatchObject({ code: '42501' });
    await expect(db.query(`UPDATE app.boost_entitlement SET ends_at = ends_at + interval '1 day' WHERE id = $1`, [id])).rejects.toMatchObject({ code: '42501' });
    await db.query(`UPDATE app.boost_entitlement SET state = 'REVOKED' WHERE id = $1`, [id]);
    await expect(db.query(`UPDATE app.boost_entitlement SET state = 'ACTIVE' WHERE id = $1`, [id])).rejects.toMatchObject({ code: '23514' });
    await expect(db.query(`DELETE FROM app.boost_entitlement WHERE id = $1`, [id])).rejects.toMatchObject({ code: '42501' });
  });
});

describe('discovery config bounds (A§8.5, SHF-T38)', () => {
  const insert = (n: number, p: number, l: number) =>
    db.query(`INSERT INTO app.discovery_config_version (shuffle_batch_size, priority_bps, local_bps, created_by, reason) VALUES ($1, $2, $3, 'test', 'test')`, [n, p, l]);

  it('accepts the default and the bounds', async () => {
    await insert(10, 3000, 7000);
    await insert(50, 500, 9000);
    await insert(15, 4000, 5000);
  });
  it.each([
    [10, 0, 7000], [10, 499, 7000], [10, 4001, 7000], [10, 5000, 7000], [10, 10000, 7000],
    [10, 3000, 0], [10, 3000, 4999], [10, 3000, 9001], [10, 3000, 10000],
    [30, 3000, 7000], [51, 3000, 7000],
  ])('rejects N=%i priority=%i local=%i', async (n, p, l) => {
    await expect(insert(n, p, l)).rejects.toMatchObject({ code: '23514' });
  });
  it('api_rw cannot write config versions', async () => {
    await db.query('SET ROLE api_rw');
    await expect(insert(10, 3000, 7000)).rejects.toMatchObject({ code: '42501' });
  });
});

describe('media unlock (REQ-MED-03)', () => {
  it('one unlock per (media, viewer)', async () => {
    const [x, b] = [await account(), await account()];
    const c = Number((await db.query<{ id: string }>(`INSERT INTO ident.conversation (public_id, initiator_id, recipient_id) VALUES ($1, $2, $3) RETURNING id`, [opaque('cnv_'), x, b])).rows[0]!.id);
    const m = Number((await db.query<{ id: string }>(
      `INSERT INTO ident.media_object (public_id, owner_id, conversation_id, kind, storage_key, unlock_price_gold, expires_at)
       VALUES ($1, $2, $3, 'PERSISTENT', $4, 5, now() + interval '90 days') RETURNING id`, [opaque('med_'), x, c, randomUUID()])).rows[0]!.id);
    await db.query('INSERT INTO ident.media_unlock (media_id, viewer_id, ledger_txn_id) VALUES ($1, $2, 1)', [m, b]);
    await expect(db.query('INSERT INTO ident.media_unlock (media_id, viewer_id, ledger_txn_id) VALUES ($1, $2, 2)', [m, b])).rejects.toMatchObject({ code: '23505' });
  });
});
