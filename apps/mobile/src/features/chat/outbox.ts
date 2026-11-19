import type { QueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { api, ApiError } from '@/api/client';
import { clearOut, deleteOut, loadOut, saveOut } from './localStore';

/**
 * Outgoing message queue (doc 08 §4 step 1). A message lives here from the moment the user taps send until the
 * server has committed it, independent of the chat screen: leaving the conversation never loses it.
 *   - transient failures (offline, 5xx, 429) keep it "sending" and retry with backoff, and immediately on reconnect
 *   - permanent failures (4xx: blocked, closed, invalid) mark it "failed"; the user can tap to retry
 * Every attempt reuses the same client_msg_id, so the server deduplicates retries (exactly one message).
 * Persistence: every queued message is also written to the on-device store (encrypted SQLite on the phone, see
 * localStore.native.ts), so a message survives the app being killed and is resent on the next launch.
 */
export interface OutItem { clientId: string; cid: string; body: string; createdAt: string; status: 'sending' | 'failed'; attempts: number; error?: ApiError;
  /** set once the server committed it: the screen hides this bubble as soon as the history contains that id */
  sentId?: string; seq?: number }

const byConv = new Map<string, OutItem[]>();
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const inFlight = new Set<string>();
let qc: QueryClient | null = null;
let account: string | null = null;
const EMPTY: OutItem[] = [];
/** Server dedupe of client_msg_id lasts 7 days (worker job); older restored items are never auto-resent. */
const AUTO_RESEND_MAX_AGE_MS = 6 * 24 * 3600 * 1000;

// all disk writes go through one ordered chain: a "delete after send" can never overtake its "save"
let disk: Promise<unknown> = Promise.resolve();
const persist = (op: () => Promise<unknown>) => { disk = disk.then(op).catch(() => { /* disk trouble never blocks sending */ }); return disk; };
const save = (x: OutItem) => { const a = account; if (a) void persist(() => saveOut(a, { clientId: x.clientId, cid: x.cid, body: x.body, createdAt: x.createdAt, status: x.status })); };

const emit = () => listeners.forEach((l) => l());
const update = (cid: string, fn: (list: OutItem[]) => OutItem[]) => { byConv.set(cid, fn(byConv.get(cid) ?? [])); emit(); };
const transient = (e: unknown) => !(e instanceof ApiError) || e.status === 0 || e.status === 429 || e.status >= 500;

export const bindOutbox = (client: QueryClient) => { qc = client; };

/** Signed in as `accountId`: load what this account left unsent (e.g. the app was killed) and send it. */
export async function restoreOutbox(accountId: string) {
  if (account === accountId) return;
  account = accountId;
  await disk;
  const rows = await loadOut(accountId).catch(() => []);
  if (account !== accountId) return; // signed out meanwhile
  const now = Date.now();
  for (const r of rows) {
    if (byConv.get(r.cid)?.some((x) => x.clientId === r.clientId)) continue;
    const stale = now - Date.parse(r.createdAt) > AUTO_RESEND_MAX_AGE_MS;
    const item: OutItem = { ...r, status: stale ? 'failed' : r.status, attempts: 0 };
    byConv.set(r.cid, [...(byConv.get(r.cid) ?? []), item]);
  }
  emit();
  flushOutbox();
}

/** Signed out: forget the queue in memory and on disk. */
export function resetOutbox() {
  account = null;
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  byConv.clear();
  emit();
  void persist(() => clearOut());
}

export function useOutbox(cid: string): OutItem[] {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => byConv.get(cid) ?? EMPTY,
  );
}

export function enqueue(cid: string, clientId: string, body: string) {
  const item: OutItem = { clientId, cid, body, createdAt: new Date().toISOString(), status: 'sending', attempts: 0 };
  update(cid, (l) => [...l, item]);
  save(item);
  void attempt(item.clientId, cid);
}

/** User tapped "tekrar dene" on a failed bubble. */
export function retry(cid: string, clientId: string) {
  update(cid, (l) => l.map((x) => (x.clientId === clientId ? { ...x, status: 'sending', attempts: 0 } : x)));
  const x = byConv.get(cid)?.find((i) => i.clientId === clientId);
  if (x) save(x);
  void attempt(clientId, cid);
}

/** Connection is back (socket hello): send everything still waiting, now, in order. */
export function flushOutbox() {
  for (const [cid, list] of byConv) for (const x of list) if (x.status === 'sending') { clearTimeout(timers.get(x.clientId)); void attempt(x.clientId, cid); }
}

async function attempt(clientId: string, cid: string) {
  const item = byConv.get(cid)?.find((x) => x.clientId === clientId);
  if (!item || inFlight.has(clientId)) return;
  // keep order: a later message waits for every earlier one still in the queue
  const earlier = (byConv.get(cid) ?? []).filter((x) => x.createdAt < item.createdAt && x.status === 'sending');
  if (earlier.length) { timers.set(clientId, setTimeout(() => void attempt(clientId, cid), 250)); return; }
  inFlight.add(clientId);
  try {
    const r = await api<{ message_id: string; seq: number }>(`/v1/conversations/${cid}/messages`, { body: { client_msg_id: clientId, kind: 'TEXT', body: item.body }, idem: clientId });
    update(cid, (l) => l.map((x) => (x.clientId === clientId ? { ...x, sentId: r.data.message_id, seq: r.data.seq } : x)));
    void persist(() => deleteOut(clientId)); // committed on the server: nothing left to resend
    // the committed message replaces the queued bubble only once the refreshed history contains it
    await qc?.invalidateQueries({ queryKey: ['messages', cid] });
    void qc?.invalidateQueries({ queryKey: ['inbox'] });
    update(cid, (l) => l.filter((x) => x.clientId !== clientId));
  } catch (e) {
    if (transient(e)) {
      const n = item.attempts + 1;
      update(cid, (l) => l.map((x) => (x.clientId === clientId ? { ...x, attempts: n } : x)));
      const delay = Math.min(30_000, 1_000 * 2 ** Math.min(n - 1, 5)) * (0.75 + Math.random() / 2);
      timers.set(clientId, setTimeout(() => void attempt(clientId, cid), delay));
    } else {
      update(cid, (l) => l.map((x) => (x.clientId === clientId ? { ...x, status: 'failed', error: e as ApiError } : x)));
      const f = byConv.get(cid)?.find((i) => i.clientId === clientId);
      if (f) save(f);
      if ((e as ApiError).status === 403) void qc?.invalidateQueries({ queryKey: ['conversation', cid] });
    }
  } finally {
    inFlight.delete(clientId);
  }
}
