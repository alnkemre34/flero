import { useSyncExternalStore } from 'react';
import { API_URL, accessToken, refresh } from './client';

/**
 * Realtime client (doc 08 §6). Auth is the first frame (never the URL). Reconnects with jittered backoff;
 * every (re)connect is followed by a sync, so the socket only accelerates — it is never the source of truth.
 */
export type RtEvent = { t: string; conversation_id?: string; [k: string]: unknown };
const handlers = new Set<(e: RtEvent) => void>();
let ws: WebSocket | null = null;
let attempt = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let wanted = false;
let connected = false;
const statusListeners = new Set<() => void>();
const setConnected = (v: boolean) => { if (connected !== v) { connected = v; statusListeners.forEach((l) => l()); } };
/** true once the server said hello on the current socket; false while (re)connecting or offline. */
export const useRealtimeConnected = () => useSyncExternalStore(
  (l) => { statusListeners.add(l); return () => { statusListeners.delete(l); }; }, () => connected, () => connected);

export const onRealtime = (h: (e: RtEvent) => void) => { handlers.add(h); return () => { handlers.delete(h); }; };
export function sendRealtime(frame: object) { if (ws?.readyState === 1) ws.send(JSON.stringify(frame)); }

export function connectRealtime() {
  wanted = true;
  if (ws && ws.readyState <= 1) return;
  const token = accessToken();
  if (!token) {
    // started offline (no access token yet): get one as soon as the network is back, then connect
    if (timer) clearTimeout(timer);
    void refresh().then((ok) => {
      if (!wanted) return;
      if (ok) connectRealtime();
      else timer = setTimeout(connectRealtime, Math.min(30_000, 1_000 * 2 ** attempt++) * (0.5 + Math.random() / 2));
    });
    return;
  }
  const sock = new WebSocket(`${API_URL.replace(/^http/, 'ws')}/v1/realtime`);
  ws = sock;
  sock.onopen = () => { attempt = 0; sock.send(JSON.stringify({ t: 'auth', token })); };
  sock.onmessage = (m) => {
    let e: RtEvent;
    try { e = JSON.parse(String(m.data)) as RtEvent; } catch { return; }
    if (e.t === 'hello') {
      setConnected(true);
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = setInterval(() => sendRealtime({ t: 'ping' }), (Number(e.heartbeat_s) || 25) * 1000);
    }
    handlers.forEach((h) => h(e));
  };
  sock.onclose = async (ev) => {
    if (heartbeat) clearInterval(heartbeat);
    if (ws === sock) { ws = null; setConnected(false); }
    if (!wanted || ev.code === 4403) return; // revoked: the session layer signs out
    if (ev.code === 4401) await refresh();
    const delay = Math.min(30_000, 500 * 2 ** attempt++) * (0.5 + Math.random() / 2);
    timer = setTimeout(connectRealtime, delay);
  };
}

export function disconnectRealtime() {
  wanted = false;
  setConnected(false);
  if (timer) clearTimeout(timer);
  if (heartbeat) clearInterval(heartbeat);
  ws?.close(1000);
  ws = null;
}
