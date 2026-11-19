import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { clearCache, loadCache, putCache } from './localStore';

/**
 * Read cache for the chat (doc 08 §7), WhatsApp-style: what the screens last showed is kept on the device so the
 * app opens instantly and the conversation list + recent messages stay readable offline. The SERVER stays the
 * source of truth: every message is in Postgres, so after sign-out (cache wiped) a sign-in, or a new phone,
 * refills everything from the server. Only what the user already saw is cached, scoped to the signed-in account.
 *   cached: ['me'], ['inbox', 'main' | 'requests'], ['conversation', cid], ['messages', cid] (newest 200)
 */
const MAX_MESSAGES = 200;
const LAST = '_last_account';
const tracked = (k: QueryKey) => k[0] === 'me' || k[0] === 'inbox' || k[0] === 'conversation' || k[0] === 'messages';

let account: string | null = null;
let unsubscribe: (() => void) | null = null;
const pending = new Map<string, ReturnType<typeof setTimeout>>();

type Page = { data: unknown[]; next: string | null };
type Infinite = { pages: Page[]; pageParams: unknown[] };
/** Keep the newest pages up to 200 messages; older history is paged from the server on demand. */
function trim(key: QueryKey, data: unknown) {
  if (key[0] !== 'messages') return data;
  const d = data as Infinite;
  const pages: Page[] = []; const params: unknown[] = [];
  let n = 0;
  for (let i = 0; i < d.pages.length && n < MAX_MESSAGES; i++) { pages.push(d.pages[i]!); params.push(d.pageParams[i]); n += d.pages[i]!.data.length; }
  return { pages, pageParams: params };
}

/** Which account used this device last: lets a cold start without internet show the right cache. */
export async function lastAccount(): Promise<string | null> {
  const rows = await loadCache(LAST).catch(() => []);
  return rows[0]?.json ?? null;
}

/** Put the device copy into the query cache (only where nothing fresher is loaded yet). */
export async function hydrate(qc: QueryClient, accountId: string) {
  const rows = await loadCache(accountId).catch(() => []);
  for (const r of rows) {
    const key = JSON.parse(r.key) as QueryKey;
    if (qc.getQueryData(key) !== undefined) continue;
    try { qc.setQueryData(key, JSON.parse(r.json), { updatedAt: r.updatedAt }); } catch { /* a corrupt row is just skipped */ }
  }
}

/** Signed in as `accountId`: from now on every successful load of a tracked query is written to the device. */
export function startCache(qc: QueryClient, accountId: string) {
  if (account === accountId && unsubscribe) return;
  stopWriting();
  account = accountId;
  void putCache(LAST, 'id', accountId, Date.now()).catch(() => {});
  unsubscribe = qc.getQueryCache().subscribe((ev) => {
    if (ev.type !== 'updated' || ev.action.type !== 'success' || !tracked(ev.query.queryKey)) return;
    const key = ev.query.queryKey;
    const k = JSON.stringify(key);
    clearTimeout(pending.get(k));
    // debounce: a burst of messages becomes one write
    pending.set(k, setTimeout(() => {
      pending.delete(k);
      const a = account;
      const data = qc.getQueryData(key);
      if (!a || data === undefined) return;
      void putCache(a, k, JSON.stringify(trim(key, data)), Date.now()).catch(() => {});
    }, 400));
  });
}

function stopWriting() {
  unsubscribe?.();
  unsubscribe = null;
  for (const t of pending.values()) clearTimeout(t);
  pending.clear();
}

/** Sign-out or no valid session: nothing of the chat stays on the device. */
export async function wipeCache() {
  stopWriting();
  account = null;
  await clearCache().catch(() => {});
}
