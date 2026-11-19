import { useSyncExternalStore } from 'react';
import { getPref, setPref } from '@/api/prefs';
import { notificationPermission, registerPushToken } from '@/api/push';

/**
 * Whether this install still needs the notification explanation screen. Decided once per launch after sign-in:
 * never asked and the OS can still show its prompt → 'ask' (iOS shows the system prompt only once, so our screen
 * comes first). Already granted → the push token is refreshed (tokens rotate). The screen calls finish().
 */
type Step = 'unknown' | 'ask' | 'done';
let step: Step = 'unknown';
let checking = false;
const listeners = new Set<() => void>();
const set = (s: Step) => { step = s; listeners.forEach((l) => l()); };

export function useNotificationStep(): Step {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => step, () => step);
}

export async function checkNotificationStep() {
  if (step !== 'unknown' || checking) return;
  checking = true;
  try {
    const p = await notificationPermission();
    if (p === 'granted') void registerPushToken();
    if (p === 'undetermined' && !getPref('notif_prompted')) set('ask');
    else { if (p !== 'undetermined') void setPref('notif_prompted', '1'); set('done'); }
  } finally { checking = false; }
}

/** Allowed or "not now": never show the screen again on this install (settings can still change it). */
export function finishNotificationStep() {
  void setPref('notif_prompted', '1');
  set('done');
}

/** Signed out: the next account on this device is decided afresh. */
export const resetNotificationStep = () => set('unknown');
