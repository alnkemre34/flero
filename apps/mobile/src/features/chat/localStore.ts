/**
 * Unsent-message store, web preview build. The phone uses encrypted SQLite (localStore.native.ts); the web preview
 * is development-only and keeps the queue in localStorage, the same policy as the refresh token (api/client.ts).
 * Both files export the same functions; Metro picks the platform file.
 */
export interface StoredOut { clientId: string; cid: string; body: string; createdAt: string; status: 'sending' | 'failed' }

const KEY = 'flero.outbox.v1';
type Row = StoredOut & { account: string };

const read = (): Row[] => {
  try { return JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '[]') as Row[]; } catch { return []; }
};
const write = (rows: Row[]) => {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(rows)); } catch { /* storage full or blocked: the in-memory queue still sends */ }
};

export async function saveOut(account: string, x: StoredOut) {
  write([...read().filter((r) => r.clientId !== x.clientId), { ...x, account }]);
}
export async function deleteOut(clientId: string) {
  write(read().filter((r) => r.clientId !== clientId));
}
export async function loadOut(account: string): Promise<StoredOut[]> {
  return read().filter((r) => r.account === account).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(({ clientId, cid, body, createdAt, status }) => ({ clientId, cid, body, createdAt, status }));
}
export async function clearOut() {
  globalThis.localStorage?.removeItem(KEY);
}

// ---------- read cache (web preview: localStorage, development only) ----------
const CACHE = 'flero.cache.v1';
type CacheRow = { account: string; key: string; json: string; updatedAt: number };
const readCache = (): CacheRow[] => {
  try { return JSON.parse(globalThis.localStorage?.getItem(CACHE) ?? '[]') as CacheRow[]; } catch { return []; }
};

export async function putCache(account: string, key: string, json: string, updatedAt: number) {
  const rows = readCache().filter((r) => !(r.account === account && r.key === key));
  rows.push({ account, key, json, updatedAt });
  try { globalThis.localStorage?.setItem(CACHE, JSON.stringify(rows)); } catch { /* quota: the cache is best effort */ }
}
export async function loadCache(account: string) {
  return readCache().filter((r) => r.account === account).map(({ key, json, updatedAt }) => ({ key, json, updatedAt }));
}
export async function clearCache() {
  globalThis.localStorage?.removeItem(CACHE);
}
