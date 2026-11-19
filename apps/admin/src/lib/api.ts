'use client';

/** Error codes from the admin API, mapped to plain Turkish for staff. */
const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'Oturum süresi doldu. Lütfen tekrar giriş yapın.',
  ACTION_UNAVAILABLE: 'Bu işlem için yetkiniz yok ya da işlem artık geçerli değil.',
  VALIDATION_FAILED: 'Girilen bilgiler geçersiz. Alanları kontrol edin.',
  NOT_FOUND: 'Kayıt bulunamadı.',
  INSUFFICIENT_GOLD: 'Kullanıcının bakiyesi bu düzeltme için yetersiz.',
  TEMPORARILY_UNAVAILABLE: 'Sunucuya şu an ulaşılamıyor. Biraz sonra tekrar deneyin.',
  NETWORK: 'Bağlantı kurulamadı. İnternet bağlantınızı kontrol edin.',
  RATE_LIMITED: 'Çok fazla istek gönderildi. Biraz bekleyip tekrar deneyin.',
  IDEMPOTENCY_PAYLOAD_MISMATCH: 'Bu işlem farklı bilgilerle zaten yapılmış. Sayfayı yenileyin.',
  SHUFFLE_BATCH_SIZE_NOT_CLIENT_CONFIGURABLE: 'Parti boyutu yalnızca yönetim panelinden değiştirilebilir.',
  SHUFFLE_SURFACE_NOT_ALLOWED: 'Bu keşif yüzeyi bu kullanıcı için kapalı.',
  SHUFFLE_FILTER_REQUIRES_PLUS: 'Bu filtre Plus üyelik gerektirir.',
  HOME_REGION_CHANGE_TOO_SOON: 'Bölge 30 günde bir değiştirilebilir.',
  HOME_REGION_LOCKED_BY_ACTIVE_BOOST: 'Aktif Boost varken bölge değiştirilemez.',
  BOOST_ALREADY_ACTIVE: 'Kullanıcının zaten aktif bir Boost’u var.',
  BOOST_QUOTE_EXPIRED: 'Teklifin süresi dolmuş.',
  BOOST_QUOTE_STALE_REGION: 'Bölge değiştiği için teklif geçersiz.',
  BOOST_SCOPE_REQUIRES_PLUS: 'Şehir Boost’u Plus gerektirir.',
  BOOST_PRODUCT_UNAVAILABLE: 'Bu Boost paketi satışta değil.',
  BOOST_ACTIVATION_RETRYABLE: 'Boost etkinleştirilemedi; tekrar denenebilir.',
  MEDIA_NOT_READY: 'Medya henüz hazır değil.',
  MEDIA_EXPIRED: 'Medyanın süresi dolmuş.',
  ONE_VIEW_ALREADY_CONSUMED: 'Tek görüntülük medya zaten açılmış.',
};

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly params: Record<string, unknown> | undefined;
  constructor(code: string, status: number, params?: Record<string, unknown>) {
    super(MESSAGES[code] ?? 'Beklenmeyen bir hata oluştu.');
    this.code = code;
    this.status = status;
    this.params = params;
  }
}

export async function api<T = unknown>(path: string, init?: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown }): Promise<{ data: T; next: string | null }> {
  const method = init?.method ?? 'GET';
  const res = await fetch(`/api/admin/${path}`, {
    method,
    headers: method === 'GET' ? {} : { 'content-type': 'application/json', 'x-flero-admin': '1' },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : method !== 'GET' ? { body: '{}' } : {}),
    cache: 'no-store',
  }).catch(() => { throw new ApiError('NETWORK', 0); });
  if (res.status === 401 && typeof window !== 'undefined' && !location.pathname.startsWith('/login')) {
    location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
  }
  const text = await res.text();
  let json: { code?: string; params?: Record<string, unknown> } | null = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; } // e.g. an HTML error page from a proxy
  if (!res.ok) throw new ApiError(json?.code ?? 'TEMPORARILY_UNAVAILABLE', res.status, json?.params);
  return { data: json as T, next: res.headers.get('x-next-cursor') };
}

export const fmt = {
  int: (n: number | string | null | undefined) => new Intl.NumberFormat('tr-TR').format(Number(n ?? 0)),
  date: (d: string | null | undefined) => (d ? new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(d)) : '—'),
  pct: (x: number) => `%${(x * 100).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}`,
};

/** i18n label keys from the backend rendered as readable Turkish place names. */
const PLACES: Record<string, string> = {
  istanbul: 'İstanbul', ankara: 'Ankara', izmir: 'İzmir', kadikoy: 'Kadıköy', besiktas: 'Beşiktaş', uskudar: 'Üsküdar', sisli: 'Şişli',
  esenyurt: 'Esenyurt', beyoglu: 'Beyoğlu', atasehir: 'Ataşehir', bakirkoy: 'Bakırköy', cankaya: 'Çankaya', kecioren: 'Keçiören',
  yenimahalle: 'Yenimahalle', konak: 'Konak', karsiyaka: 'Karşıyaka', bornova: 'Bornova',
};
export const place = (key: string | null | undefined) => (key ? PLACES[key.split('.').pop() ?? ''] ?? key : '—');
