import type { Me } from '@flero/contracts';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { z } from 'zod';
import { api, ApiError, lastRefreshOutcome, onAuthChange, refresh, signOut } from './client';
import { connectRealtime, disconnectRealtime, onRealtime, sendRealtime } from './realtime';
import { hydrate, lastAccount, startCache, wipeCache } from '@/features/chat/localCache';
import { bindOutbox, flushOutbox, resetOutbox, restoreOutbox } from '@/features/chat/outbox';

export type MeT = z.infer<typeof Me>;
export type SessionState = 'loading' | 'signedOut' | 'onboarding' | 'ready';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
      refetchOnWindowFocus: false,
    },
  },
});
bindOutbox(queryClient); // the queue refreshes chat history after a send, from any screen or a restore

const Ctx = createContext<{ state: SessionState; me: MeT | undefined; reloadMe: () => Promise<unknown>; signOut: () => Promise<void> }>({
  state: 'loading', me: undefined, reloadMe: async () => {}, signOut: async () => {},
});
export const useSession = () => useContext(Ctx);

function SessionInner({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    const off = onAuthChange((v) => { setSignedIn(v); if (!v) { qc.clear(); resetOutbox(); void wipeCache(); } });
    void (async () => {
      // 1) show the device copy first (instant open, works offline), 2) then restore the session from the keychain
      const last = await lastAccount();
      if (last) await hydrate(qc, last);
      const ok = await refresh();
      if (ok || (lastRefreshOutcome() === 'offline' && last)) { setSignedIn((s) => s ?? true); return; } // offline start: stay signed in
      setSignedIn((s) => s ?? false);
      if (last) { qc.clear(); resetOutbox(); await wipeCache(); } // no valid session left: nothing stays on the device
    })();
    return off;
  }, [qc]);
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<MeT>('/v1/me').then((r) => r.data), enabled: signedIn === true });
  // unsent messages from a previous run of the app (killed, crashed, rebooted) are resent once we know who is signed in
  const meId = me.data?.public_user_id;
  useEffect(() => { if (signedIn && meId) { startCache(qc, meId); void restoreOutbox(meId); } }, [signedIn, meId, qc]);

  // realtime: connect when signed in; every event invalidates exactly what it affects
  useEffect(() => {
    if (!signedIn) { disconnectRealtime(); return; }
    connectRealtime();
    const off = onRealtime((e) => {
      if (e.t === 'session.revoked') { void signOut(); return; }
      if (e.t === 'hello' || e.t === 'sync.hint') {
        void qc.invalidateQueries({ queryKey: ['inbox'] }); void qc.invalidateQueries({ queryKey: ['notifications'] });
        // (re)connected: whatever is on screen came from the device or is older than the gap → refresh it now
        if (e.t === 'hello') { void qc.invalidateQueries(); flushOutbox(); void markDeliveredOnReconnect(); }
        return;
      }
      if (e.t === 'notification.new') { void qc.invalidateQueries({ queryKey: ['notifications'] }); void qc.invalidateQueries({ queryKey: ['wallet'] }); return; }
      if (e.t === 'typing') return; // ephemeral: the open chat screen handles it
      if (e.conversation_id) {
        const cid = e.conversation_id;
        // ✓✓: this device has the message → tell the sender right away (doc 08 §5: delivered = a device persisted it)
        if (e.t === 'message.new' && typeof e.seq === 'number') sendRealtime({ t: 'ack', conversation_id: cid, seq: e.seq });
        if (e.t === 'receipt.updated') {
          // the counterpart's watermarks: move the ticks now, without waiting for a refetch (monotonic)
          qc.setQueryData(['conversation', cid], (v: { peer_delivered_seq: number; peer_read_seq: number } | undefined) => v && ({
            ...v, peer_delivered_seq: Math.max(v.peer_delivered_seq, Number(e.delivered_seq) || 0), peer_read_seq: Math.max(v.peer_read_seq, Number(e.read_seq) || 0),
          }));
          void qc.invalidateQueries({ queryKey: ['inbox'] });
          return;
        }
        void qc.invalidateQueries({ queryKey: ['inbox'] });
        void qc.invalidateQueries({ queryKey: ['conversation', cid] });
        if (e.t === 'message.new' || e.t === 'message.committed') void qc.invalidateQueries({ queryKey: ['messages', cid] });
      }
    });
    return () => { off(); };
  }, [signedIn, qc]);

  const o = me.data?.onboarding;
  const state: SessionState = signedIn === null || (signedIn && !me.data && me.isPending) ? 'loading'
    : !signedIn ? 'signedOut'
    : o && (!o.age_assured || !o.consents_current || !o.home_region_set) ? 'onboarding' : 'ready';
  return <Ctx.Provider value={{ state, me: me.data, reloadMe: () => me.refetch(), signOut }}>{children}</Ctx.Provider>;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}><SessionInner>{children}</SessionInner></QueryClientProvider>;
}

/**
 * Messages that arrived while this device was offline were never acked over the socket. After a reconnect,
 * report them delivered (not read) for every thread with unseen messages, so the sender's ✓ becomes ✓✓.
 */
async function markDeliveredOnReconnect() {
  type Entry = { conversation: { conversation_id: string; last_seq: number; delivered_seq: number } };
  const lists = await Promise.all((['main', 'requests'] as const).map((f) => api<Entry[]>(`/v1/inbox?filter=${f}&limit=50`).then((r) => r.data, () => [] as Entry[])));
  await Promise.all(lists.flat().filter((x) => x.conversation.delivered_seq < x.conversation.last_seq).map((x) =>
    api(`/v1/conversations/${x.conversation.conversation_id}/receipts`, { body: { delivered_seq: x.conversation.last_seq } }).catch(() => {})));
}
