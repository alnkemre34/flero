import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Small per-install preferences (not secrets): seen the intro, asked for notifications, installation id.
 * Loaded once at launch (before the splash hides) so routing decisions are synchronous and never flicker.
 * Native: SecureStore (no extra storage dependency); web preview: localStorage.
 */
export type PrefKey = 'intro_seen' | 'notif_prompted' | 'installation_id';
const KEYS: PrefKey[] = ['intro_seen', 'notif_prompted', 'installation_id'];
const mem = new Map<PrefKey, string>();
const k = (key: PrefKey) => `flero.pref.${key}`;

async function read(key: PrefKey) {
  try { return Platform.OS === 'web' ? globalThis.localStorage?.getItem(k(key)) ?? null : await SecureStore.getItemAsync(k(key)); } catch { return null; }
}

let loaded: Promise<void> | null = null;
export function loadPrefs() {
  loaded ??= Promise.all(KEYS.map(async (key) => { const v = await read(key); if (v !== null) mem.set(key, v); })).then(() => {});
  return loaded;
}

export const getPref = (key: PrefKey) => mem.get(key) ?? null;

export async function setPref(key: PrefKey, value: string) {
  mem.set(key, value);
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(k(key), value);
    else await SecureStore.setItemAsync(k(key), value);
  } catch { /* memory still holds it for this run */ }
}

/** Stable random id for this install (push-token registration key; never derived from the device). */
export async function installationId() {
  await loadPrefs();
  let id = getPref('installation_id');
  if (!id) {
    const b = new Uint8Array(16);
    globalThis.crypto.getRandomValues(b);
    id = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    await setPref('installation_id', id);
  }
  return id;
}
