import { useEffect, useState } from 'react';
import { useRealtimeConnected } from '@/api/realtime';

/**
 * WhatsApp-style "Bağlanıyor…": true only after the live connection has been down for 1.5 s, so a normal
 * reconnect blip never flashes it. Cached content stays readable underneath.
 */
export function useConnecting(): boolean {
  const connected = useRealtimeConnected();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (connected) { setShow(false); return; }
    const t = setTimeout(() => setShow(true), 1_500);
    return () => clearTimeout(t);
  }, [connected]);
  return show;
}
