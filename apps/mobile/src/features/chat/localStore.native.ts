import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import type { StoredOut } from './localStore';

/**
 * On-device store (doc 08 §7): unsent messages + a read cache of the chat (profile, inbox, recent messages): SQLite encrypted with SQLCipher (`useSQLCipher` in app.json).
 * The 256-bit key is random per install and lives only in the Keychain/Keystore; it is never logged or sent.
 * Rows are scoped to the signed-in account and wiped on sign-out, so a shared phone never resends someone else's.
 */
const KEY_NAME = 'flero.local_db_key';
let dbp: Promise<SQLite.SQLiteDatabase> | null = null;

async function dbKey(): Promise<string> {
  let k = await SecureStore.getItemAsync(KEY_NAME);
  if (!k || !/^[0-9a-f]{64}$/.test(k)) {
    const b = new Uint8Array(32);
    globalThis.crypto.getRandomValues(b);
    k = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    await SecureStore.setItemAsync(KEY_NAME, k, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
  }
  return k;
}

function db() {
  dbp ??= (async () => {
    const d = await SQLite.openDatabaseAsync('flero-local.db');
    const k = await dbKey(); // validated hex above: safe to place in the PRAGMA (which takes no bound params)
    await d.execAsync(`PRAGMA key = "x'${k}'";`);
    await d.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS outbox (
        client_id TEXT PRIMARY KEY NOT NULL, account TEXT NOT NULL, cid TEXT NOT NULL, body TEXT NOT NULL,
        created_at TEXT NOT NULL, status TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS outbox_account ON outbox (account, created_at);
      CREATE TABLE IF NOT EXISTS cache (
        account TEXT NOT NULL, key TEXT NOT NULL, json TEXT NOT NULL, updated_at INTEGER NOT NULL,
        PRIMARY KEY (account, key)
      );`);
    return d;
  })().catch((e) => { dbp = null; throw e; });
  return dbp;
}

export async function saveOut(account: string, x: StoredOut) {
  await (await db()).runAsync(
    'INSERT OR REPLACE INTO outbox (client_id, account, cid, body, created_at, status) VALUES (?, ?, ?, ?, ?, ?)',
    [x.clientId, account, x.cid, x.body, x.createdAt, x.status]);
}

export async function deleteOut(clientId: string) {
  await (await db()).runAsync('DELETE FROM outbox WHERE client_id = ?', [clientId]);
}

export async function loadOut(account: string): Promise<StoredOut[]> {
  const rows = await (await db()).getAllAsync<{ client_id: string; cid: string; body: string; created_at: string; status: string }>(
    'SELECT client_id, cid, body, created_at, status FROM outbox WHERE account = ? ORDER BY created_at', [account]);
  return rows.map((r) => ({ clientId: r.client_id, cid: r.cid, body: r.body, createdAt: r.created_at, status: r.status === 'failed' ? 'failed' : 'sending' }));
}

/** Sign-out / account switch: nothing of a previous account stays on the device. */
export async function clearOut() {
  await (await db()).runAsync('DELETE FROM outbox');
}

// ---------- read cache: what the chat screens last showed, so they open instantly and work offline ----------
export async function putCache(account: string, key: string, json: string, updatedAt: number) {
  await (await db()).runAsync('INSERT OR REPLACE INTO cache (account, key, json, updated_at) VALUES (?, ?, ?, ?)', [account, key, json, updatedAt]);
}

export async function loadCache(account: string): Promise<{ key: string; json: string; updatedAt: number }[]> {
  const rows = await (await db()).getAllAsync<{ key: string; json: string; updated_at: number }>(
    'SELECT key, json, updated_at FROM cache WHERE account = ?', [account]);
  return rows.map((r) => ({ key: r.key, json: r.json, updatedAt: r.updated_at }));
}

/** Sign-out / no session: the cache of every account goes (the server keeps the history; sign-in refills it). */
export async function clearCache() {
  await (await db()).runAsync('DELETE FROM cache');
}
