import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * FLERO API client. Access token in memory; refresh token in the OS keychain/keystore (SecureStore; the web
 * preview falls back to localStorage, development only). One refresh in flight at a time; a 401 triggers exactly
 * one refresh + retry. Economic POSTs carry an Idempotency-Key that the caller keeps across retries.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000');
const REFRESH_KEY = 'flero.refresh';

const store = {
  get: async (): Promise<string | null> => (Platform.OS === 'web' ? globalThis.localStorage?.getItem(REFRESH_KEY) ?? null : SecureStore.getItemAsync(REFRESH_KEY)),
  set: async (v: string) => { if (Platform.OS === 'web') globalThis.localStorage?.setItem(REFRESH_KEY, v); else await SecureStore.setItemAsync(REFRESH_KEY, v); },
  clear: async () => { if (Platform.OS === 'web') globalThis.localStorage?.removeItem(REFRESH_KEY); else await SecureStore.deleteItemAsync(REFRESH_KEY); },
};

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly params: Record<string, string | number> | undefined;
  constructor(code: string, status: number, params?: Record<string, string | number>) {
    super(code);
    this.code = code;
    this.status = status;
    this.params = params;
  }
}

export interface Onboarding { email_verified: boolean; age_assured: boolean; consents_current: boolean; home_region_set: boolean }
export interface TokenPair { access_token: string; refresh_token: string; access_expires_in: number; onboarding: Onboarding }

let access: string | null = null;
let volatileRefresh: string | null = null; // "Beni hatırla" kapalıyken: yalnızca bellekte
let refreshing: Promise<boolean> | null = null;
/** Why the last refresh ended as it did: a cold start offline must not look like a sign-out. */
export type RefreshOutcome = 'ok' | 'none' | 'rejected' | 'offline';
let outcome: RefreshOutcome = 'none';
export const lastRefreshOutcome = () => outcome;
const listeners = new Set<(signedIn: boolean) => void>();
export const onAuthChange = (f: (signedIn: boolean) => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export const accessToken = () => access;

export async function adoptTokens(t: TokenPair, remember = true) {
  access = t.access_token;
  if (remember && volatileRefresh === null) await store.set(t.refresh_token);
  else { volatileRefresh = t.refresh_token; await store.clear(); }
  listeners.forEach((f) => f(true));
}

export async function signOut() {
  if (access) await fetch(`${API_URL}/v1/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${access}` } }).catch(() => {});
  access = null;
  volatileRefresh = null;
  await store.clear();
  listeners.forEach((f) => f(false));
}

/** Single-flight refresh: concurrent 401s share one rotation (a second rotation would trip reuse detection). */
export function refresh(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const rt = volatileRefresh ?? (await store.get());
      if (!rt) { outcome = 'none'; return false; }
      const res = await fetch(`${API_URL}/v1/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: rt }) });
      if (!res.ok) { outcome = 'rejected'; access = null; volatileRefresh = null; await store.clear(); listeners.forEach((f) => f(false)); return false; }
      await adoptTokens((await res.json()) as TokenPair, volatileRefresh === null);
      outcome = 'ok';
      return true;
    } catch {
      outcome = 'offline';
      return false; // offline: keep the stored token and try again later
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export const newKey = () => {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

export async function api<T>(path: string, o: { method?: string; body?: unknown; idem?: string; auth?: boolean } = {}): Promise<{ data: T; next: string | null }> {
  const send = () => fetch(`${API_URL}${path}`, {
    method: o.method ?? (o.body !== undefined ? 'POST' : 'GET'),
    headers: {
      ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(o.auth !== false && access ? { authorization: `Bearer ${access}` } : {}),
      ...(o.idem ? { 'idempotency-key': o.idem } : {}),
      'x-platform': Platform.OS === 'web' ? 'web' : Platform.OS,
    },
    ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
  });
  let res: Response;
  try {
    res = await send();
    if (res.status === 401 && o.auth !== false && (await refresh())) res = await send();
  } catch {
    throw new ApiError('NETWORK', 0);
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(json?.code ?? 'TEMPORARILY_UNAVAILABLE', res.status, json?.params);
  return { data: json as T, next: res.headers.get('x-next-cursor') };
}

const ERRORS: Record<string, string> = {
  NETWORK: 'Bağlantı yok. İnternetini kontrol edip tekrar dene.',
  UNAUTHENTICATED: 'Oturumun sona erdi, tekrar giriş yap.',
  VALIDATION_FAILED: 'Bilgileri kontrol edip tekrar dene.',
  ACTION_UNAVAILABLE: 'Bu işlem şu an kullanılamıyor.',
  INSUFFICIENT_GOLD: 'Yeterli Gold yok.',
  RATE_LIMITED: 'Biraz yavaşla, birazdan tekrar dene.',
  HOME_REGION_CHANGE_TOO_SOON: 'Bölgeni 30 günde bir değiştirebilirsin.',
  HOME_REGION_LOCKED_BY_ACTIVE_BOOST: 'Aktif Boost varken bölge değiştirilemez.',
  BOOST_ALREADY_ACTIVE: 'Zaten aktif bir Boost var.',
  BOOST_QUOTE_EXPIRED: 'Teklifin süresi doldu, yenileyelim.',
  BOOST_SCOPE_REQUIRES_PLUS: 'Şehir Boost yalnızca Plus üyelerde.',
  SHUFFLE_FILTER_REQUIRES_PLUS: 'Filtreler yalnızca Plus üyelerde.',
  SHUFFLE_SURFACE_NOT_ALLOWED: 'Bu bölgeyi keşfetmek için Plus gerekiyor.',
  SHUFFLE_BATCH_SIZE_NOT_CLIENT_CONFIGURABLE: 'Bu ayar uygulamadan değiştirilemez.',
  TEMPORARILY_UNAVAILABLE: 'Sunucuya şu an ulaşılamıyor. Biraz sonra tekrar dene.',
  IDEMPOTENCY_PAYLOAD_MISMATCH: 'Bu işlem zaten farklı bilgilerle yapıldı. Sayfayı yenileyip tekrar dene.',
  NOT_FOUND: 'Aradığın şey bulunamadı ya da artık yok.',
  BOOST_QUOTE_STALE_REGION: 'Bölgen değiştiği için teklif yenilendi.',
  BOOST_PRODUCT_UNAVAILABLE: 'Bu Boost paketi şu an satışta değil.',
  BOOST_ACTIVATION_RETRYABLE: 'Boost etkinleştirilemedi, Gold düşülmedi. Tekrar dene.',
  MEDIA_NOT_READY: 'Fotoğraf henüz hazır değil.',
  MEDIA_EXPIRED: 'Bu fotoğrafın süresi doldu.',
  ONE_VIEW_ALREADY_CONSUMED: 'Bu fotoğraf zaten görüntülendi.',
};
/** Plain Turkish for stable error codes (REQ-PLT-02: clients localize codes). */
export const errorText = (e: unknown) => ERRORS[e instanceof ApiError ? e.code : ''] ?? 'Bir şeyler ters gitti. Tekrar dene.';
