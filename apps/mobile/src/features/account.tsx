import type { NotificationPrefs, PersonSummary, Session } from '@flero/contracts';
import { radius, space, type as typeScale } from '@flero/ui-tokens';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import type { z } from 'zod';
import { avatarErrorText, pickImage, removeAvatar, uploadAvatar, type Crop, type PickedImage } from '@/api/avatar';
import { notificationPermission, registerPushToken, requestNotificationPermission, type PermissionState } from '@/api/push';
import { AvatarCropper } from './AvatarCropper';
import { api, ApiError, errorText, newKey } from '@/api/client';
import { useSession } from '@/api/session';
import { Avatar } from '@/design/Avatar';
import { PressableScale } from '@/design/motion';
import { Sheet } from '@/design/Sheet';
import { fonts, useTheme } from '@/design/theme';
import { t } from '@/i18n/tr';

/** Account hub sheets (S30–S34). Each one is backed by a real endpoint; nothing here is decorative. */
type Person = z.infer<typeof PersonSummary>;

function Primary({ label, onPress, busy, disabled, danger }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean; danger?: boolean }) {
  const { c } = useTheme();
  return (
    <PressableScale accessibilityRole="button" accessibilityState={{ disabled: !!disabled || !!busy, busy: !!busy }} disabled={disabled || busy} onPress={onPress} haptic="medium"
      style={[styles.primary, { backgroundColor: danger ? c.danger : c.brand, opacity: disabled ? 0.45 : 1 }]}>
      {busy ? <ActivityIndicator color={c.onBrand} /> : <Text style={[styles.primaryText, { color: c.onBrand }]}>{label}</Text>}
    </PressableScale>
  );
}

function Note({ text, tone = 'muted' }: { text: string | null; tone?: 'muted' | 'error' }) {
  const { c } = useTheme();
  if (!text) return null;
  return <Text style={[styles.note, { color: tone === 'error' ? c.danger : c.textSecondary }]} accessibilityLiveRegion="polite">{text}</Text>;
}

export function EditProfileSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { c } = useTheme();
  const { me, reloadMe } = useSession();
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (visible && me) { setName(me.display_name); setBio(me.bio ?? ''); setErr(null); } }, [visible, me]);
  const save = async () => {
    if (!name.trim()) { setErr('Adın boş olamaz.'); return; }
    setBusy(true); setErr(null);
    try { await api('/v1/me/profile', { body: { display_name: name.trim(), bio: bio.trim() || null } }); await reloadMe(); onClose(); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Profili düzenle">
      <Text style={[styles.label, { color: c.textSecondary }]}>Ad</Text>
      <TextInput value={name} onChangeText={setName} maxLength={40} accessibilityLabel="Ad" style={[styles.input, { color: c.textPrimary, backgroundColor: c.raised, borderColor: c.hairline }]} />
      <Text style={[styles.label, { color: c.textSecondary }]}>Hakkında <Text style={{ color: c.textTertiary }}>· {bio.length}/300</Text></Text>
      <TextInput value={bio} onChangeText={setBio} maxLength={300} multiline accessibilityLabel="Hakkında" placeholder="Kendinden biraz bahset" placeholderTextColor={c.textTertiary}
        style={[styles.input, styles.multi, { color: c.textPrimary, backgroundColor: c.raised, borderColor: c.hairline }]} />
      <Note text={err} tone="error" />
      <Primary label="Kaydet" busy={busy} onPress={() => void save()} />
    </Sheet>
  );
}

interface City { city_id: string; label_key: string }
interface District { district_id: string; label_key: string }

export function RegionSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { c } = useTheme();
  const { me, reloadMe } = useSession();
  const [city, setCity] = useState<string | null>(null);
  const [district, setDistrict] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const key = useMemo(newKey, [visible]); // one key per attempt; retries of the same choice are idempotent
  const cities = useQuery({ queryKey: ['geo', 'cities'], queryFn: () => api<City[]>('/v1/geo/cities').then((r) => r.data), enabled: visible, staleTime: Infinity });
  const districts = useQuery({ queryKey: ['geo', 'districts', city], queryFn: () => api<District[]>(`/v1/geo/cities/${city}/districts`).then((r) => r.data), enabled: visible && !!city, staleTime: Infinity });
  const locked = !!me?.home_region_next_change_at && new Date(me.home_region_next_change_at) > new Date();
  useEffect(() => { if (visible) { setCity(null); setDistrict(null); setErr(null); } }, [visible]);
  const save = async () => {
    if (!city || !district) return;
    setBusy(true); setErr(null);
    try { await api('/v1/me/home-region', { method: 'PUT', body: { city_id: city, district_id: district }, idem: key }); await reloadMe(); onClose(); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const Pill = ({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) => (
    <PressableScale haptic="selection" accessibilityRole="radio" accessibilityState={{ checked: on }} aria-checked={on} onPress={onPress}
      style={[styles.pill, { backgroundColor: on ? c.brand : c.raised, borderColor: on ? c.brand : c.hairline }]}>
      <Text style={[styles.pillText, { color: on ? c.onBrand : c.textPrimary }]}>{label}</Text>
    </PressableScale>
  );
  return (
    <Sheet visible={visible} onClose={onClose} title="Ev bölgesi">
      <Text style={[styles.note, { color: c.textSecondary }]}>
        Şu an: {me?.home_district_label_key ? `${t(me.home_district_label_key)} · ${t(me.home_city_label_key ?? '')}` : '—'}.
        {locked && me?.home_region_next_change_at ? ` Bir sonraki değişiklik ${new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long' }).format(new Date(me.home_region_next_change_at))} tarihinden sonra.` : ' Değişiklikten sonra 30 gün yeniden değiştiremezsin.'}
      </Text>
      {!locked && (
        <>
          <View style={styles.pills}>{cities.data?.map((x) => <Pill key={x.city_id} label={t(x.label_key)} on={city === x.city_id} onPress={() => { setCity(x.city_id); setDistrict(null); }} />)}</View>
          {city && <View style={styles.pills}>{districts.data?.map((x) => <Pill key={x.district_id} label={t(x.label_key)} on={district === x.district_id} onPress={() => setDistrict(x.district_id)} />)}</View>}
          <Note text={err} tone="error" />
          <Primary label="Bölgeyi değiştir" busy={busy} disabled={!district} onPress={() => void save()} />
        </>
      )}
    </Sheet>
  );
}

function PeopleList({ people, action }: { people: Person[]; action?: (p: Person) => { label: string; onPress: () => void } }) {
  const { c } = useTheme();
  return (
    <View>
      {people.map((p) => {
        const a = action?.(p);
        return (
          <View key={p.public_user_id} style={[styles.person, { borderBottomColor: c.hairline }]}>
            <Avatar id={p.public_user_id} name={p.display_name} size={40} ring="none" uri={p.avatar?.url} />
            <PressableScale haptic="none" accessibilityRole="button" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/profile/[id]', params: { id: p.public_user_id } })}>
              <Text style={[styles.personName, { color: c.textPrimary }]} numberOfLines={1}>{p.display_name}</Text>
              <Text style={[styles.note, { color: c.textTertiary }]} numberOfLines={1}>@{p.handle}</Text>
            </PressableScale>
            {a && (
              <PressableScale accessibilityRole="button" onPress={a.onPress} style={[styles.small, { borderColor: c.hairline }]}>
                <Text style={[styles.smallText, { color: c.textPrimary }]}>{a.label}</Text>
              </PressableScale>
            )}
          </View>
        );
      })}
    </View>
  );
}

export function PeopleSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { c } = useTheme();
  const [tab, setTab] = useState<'following' | 'friends'>('friends');
  const q = useQuery({ queryKey: ['people', tab], queryFn: () => api<Person[]>(`/v1/me/${tab}?limit=50`).then((r) => r.data), enabled: visible });
  return (
    <Sheet visible={visible} onClose={onClose} title="Bağlantıların">
      <View style={[styles.segment, { backgroundColor: c.raised }]}>
        {(['friends', 'following'] as const).map((k) => (
          <PressableScale key={k} haptic="selection" accessibilityRole="tab" accessibilityState={{ selected: tab === k }} onPress={() => setTab(k)} style={[styles.seg, tab === k && { backgroundColor: c.surface }]}>
            <Text style={[styles.smallText, { color: tab === k ? c.textPrimary : c.textSecondary }]}>{k === 'friends' ? 'Arkadaşlar' : 'Takip ettiklerin'}</Text>
          </PressableScale>
        ))}
      </View>
      {q.isPending ? <ActivityIndicator color={c.brandText} /> : q.data?.length ? <PeopleList people={q.data} /> : (
        <Text style={[styles.note, { color: c.textSecondary }]}>{tab === 'friends' ? 'Karşılıklı takipleştiğin kişiler burada görünür. Bu liste yalnızca sana görünür.' : 'Henüz kimseyi takip etmiyorsun.'}</Text>
      )}
    </Sheet>
  );
}

export function BlocksSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { c } = useTheme();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['blocks'], queryFn: () => api<Person[]>('/v1/me/blocks?limit=50').then((r) => r.data), enabled: visible });
  const [err, setErr] = useState<string | null>(null);
  const unblock = async (p: Person) => {
    try { await api(`/v1/blocks/${p.public_user_id}`, { method: 'DELETE' }); void qc.invalidateQueries({ queryKey: ['blocks'] }); }
    catch (e) { setErr(errorText(e)); }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Engellenenler">
      <Note text="Engeli kaldırmak eski takipleri ya da sohbetleri geri getirmez." />
      <Note text={err} tone="error" />
      {q.isPending ? <ActivityIndicator color={c.brandText} /> : q.data?.length ? <PeopleList people={q.data} action={(p) => ({ label: 'Engeli kaldır', onPress: () => void unblock(p) })} /> : (
        <Text style={[styles.note, { color: c.textSecondary }]}>Engellediğin kimse yok.</Text>
      )}
    </Sheet>
  );
}

export function SessionsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { c } = useTheme();
  const qc = useQueryClient();
  const { signOut } = useSession();
  const q = useQuery({ queryKey: ['sessions'], queryFn: () => api<z.infer<typeof Session>[]>('/v1/me/sessions').then((r) => r.data), enabled: visible });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const revoke = async (id: string) => {
    try { await api(`/v1/me/sessions/${id}`, { method: 'DELETE' }); void qc.invalidateQueries({ queryKey: ['sessions'] }); }
    catch (e) { setErr(errorText(e)); }
  };
  const all = async () => {
    setBusy(true);
    try { await api('/v1/me/sessions/revoke-all', { body: {}, idem: newKey() }); await signOut(); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const icon = (p: string) => (p === 'ios' ? 'logo-apple' : p === 'android' ? 'logo-android' : 'globe-outline') as React.ComponentProps<typeof Ionicons>['name'];
  return (
    <Sheet visible={visible} onClose={onClose} title="Oturumlar ve cihazlar">
      <Note text={err} tone="error" />
      {q.isPending ? <ActivityIndicator color={c.brandText} /> : q.data?.map((s) => (
        <View key={s.session_id} style={[styles.person, { borderBottomColor: c.hairline }]}>
          <Ionicons name={icon(s.platform)} size={22} color={c.textPrimary} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.personName, { color: c.textPrimary }]}>{s.device_label ?? (s.platform === 'web' ? 'Tarayıcı' : s.platform === 'ios' ? 'iPhone' : 'Android')}{s.current ? ' · bu cihaz' : ''}</Text>
            <Text style={[styles.note, { color: c.textTertiary }]}>Son etkinlik {new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(s.last_seen_at))}</Text>
          </View>
          {!s.current && (
            <PressableScale accessibilityRole="button" onPress={() => void revoke(s.session_id)} style={[styles.small, { borderColor: c.hairline }]}>
              <Text style={[styles.smallText, { color: c.textPrimary }]}>Kapat</Text>
            </PressableScale>
          )}
        </View>
      ))}
      <Primary label="Tüm cihazlardan çıkış yap" danger busy={busy} onPress={() => void all()} />
    </Sheet>
  );
}

/**
 * Profile photo: library or camera → FLERO square cropper (AvatarCropper) → upload with progress state, remove. The previous
 * photo stays until the new one is processed server-side, so a failed upload never leaves the profile blank.
 */
export function AvatarSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { c } = useTheme();
  const { me, reloadMe } = useSession();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<null | 'library' | 'camera' | 'remove'>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cropping, setCropping] = useState<PickedImage | null>(null);
  const [saving, setSaving] = useState(false);
  const [cropErr, setCropErr] = useState<string | null>(null);
  useEffect(() => { if (visible) { setErr(null); setBusy(null); setCropping(null); } }, [visible]);
  const done = async () => {
    await reloadMe();
    void qc.invalidateQueries({ queryKey: ['profile'] });
    onClose();
  };
  const run = async (what: 'library' | 'camera' | 'remove') => {
    setBusy(what); setErr(null);
    try {
      if (what === 'remove') { await removeAvatar(); await done(); return; }
      const img = await pickImage(what);
      if (img) { setCropErr(null); setCropping(img); } // cancelled → stay on the sheet
    } catch (e) { setErr(avatarErrorText(e)); } finally { setBusy(null); }
  };
  const save = async (crop: Crop) => {
    if (!cropping || saving) return;
    setSaving(true); setCropErr(null);
    try { await uploadAvatar(cropping, crop); setCropping(null); await done(); }
    catch (e) { setCropErr(avatarErrorText(e)); } finally { setSaving(false); }
  };
  const Row = ({ icon, label, what, danger }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; what: 'library' | 'camera' | 'remove'; danger?: boolean }) => (
    <PressableScale accessibilityRole="button" disabled={!!busy} onPress={() => void run(what)} style={[styles.person, { borderBottomColor: c.hairline }]}>
      <Ionicons name={icon} size={22} color={danger ? c.danger : c.textPrimary} />
      <Text style={[styles.personName, { color: danger ? c.danger : c.textPrimary, flex: 1 }]}>{label}</Text>
      {busy === what ? <ActivityIndicator color={c.brandText} /> : null}
    </PressableScale>
  );
  return (
    <Sheet visible={visible} onClose={onClose} title="Profil fotoğrafı">
      <View style={{ alignItems: 'center', marginBottom: space.m }}>
        <Avatar id={me?.public_user_id ?? 'me'} name={me?.display_name ?? '·'} size={96} ring="subtle" uri={me?.avatar?.url} />
      </View>
      <Note text="Fotoğrafı seçtikten sonra kare olarak kırpabilirsin. Yüzünün net göründüğü bir kare en iyi sonucu verir; konum bilgisi otomatik silinir." />
      <Note text={err} tone="error" />
      <Row icon="images-outline" label="Galeriden seç" what="library" />
      {Platform.OS !== 'web' ? <Row icon="camera-outline" label="Fotoğraf çek" what="camera" /> : null}
      {me?.avatar ? <Row icon="trash-outline" label="Fotoğrafı kaldır" what="remove" danger /> : null}
      <AvatarCropper image={cropping} busy={saving} error={cropErr} onCancel={() => { if (!saving) setCropping(null); }} onConfirm={(crop) => void save(crop)} />
    </Sheet>
  );
}

function Secret({ label, value, onChange, error }: { label: string; value: string; onChange: (v: string) => void; error?: string | null }) {
  const { c } = useTheme();
  return (
    <>
      <Text style={[styles.label, { color: c.textSecondary }]}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} secureTextEntry accessibilityLabel={label} autoCapitalize="none"
        style={[styles.input, { color: c.textPrimary, backgroundColor: c.raised, borderColor: error ? c.danger : c.hairline }]} />
      {error ? <Text style={[styles.note, { color: c.danger }]}>{error}</Text> : null}
    </>
  );
}

/** Change password: current one re-checked server-side; every other device is signed out. */
export function ChangePasswordSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => { if (visible) { setCur(''); setNext(''); setAgain(''); setTouched(false); setErr(null); setDone(false); } }, [visible]);
  const nextErr = next.length < 10 ? 'En az 10 karakter.' : next === cur ? 'Yeni şifre eskisiyle aynı olamaz.' : null;
  const againErr = again !== next ? 'Şifreler eşleşmiyor.' : null;
  const save = async () => {
    setTouched(true);
    if (!cur || nextErr || againErr) return;
    setBusy(true); setErr(null);
    try { await api('/v1/me/password', { body: { current_password: cur, new_password: next } }); setDone(true); }
    catch (e) { setErr(e instanceof ApiError && e.params?.field === 'current_password' ? 'Mevcut şifren hatalı.' : errorText(e)); }
    finally { setBusy(false); }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Şifreyi değiştir">
      {done ? (
        <>
          <Note text="Şifren değişti. Güvenliğin için diğer tüm cihazlarda oturum kapatıldı; bu cihazda devam edebilirsin." />
          <Primary label="Tamam" onPress={onClose} />
        </>
      ) : (
        <>
          <Secret label="Mevcut şifre" value={cur} onChange={setCur} error={touched && !cur ? 'Mevcut şifreni yaz.' : null} />
          <Secret label="Yeni şifre" value={next} onChange={setNext} error={touched ? nextErr : null} />
          <Secret label="Yeni şifre (tekrar)" value={again} onChange={setAgain} error={touched ? againErr : null} />
          <Note text={err} tone="error" />
          <Primary label="Şifreyi değiştir" busy={busy} onPress={() => void save()} />
        </>
      )}
    </Sheet>
  );
}

/** E-mail verification with a 6-digit code (sent on open; resend after 60 s). */
export function VerifyEmailSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { c } = useTheme();
  const { me, reloadMe } = useSession();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const send = async () => {
    setErr(null);
    try { await api('/v1/auth/email/resend', { body: {} }); setInfo(`${me?.email ?? 'E-posta adresine'} 6 haneli bir kod gönderdik. Kod 15 dakika geçerli.`); }
    catch (e) { setErr(e instanceof ApiError && e.code === 'RATE_LIMITED' ? 'Yeni kod için bir dakika bekle.' : errorText(e)); }
  };
  useEffect(() => { if (visible) { setCode(''); setErr(null); setInfo(null); void send(); } }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const verify = async () => {
    if (!/^\d{6}$/.test(code)) { setErr('6 haneli kodu yaz.'); return; }
    setBusy(true); setErr(null);
    try { await api('/v1/auth/email/verify', { body: { code } }); await reloadMe(); onClose(); }
    catch (e) {
      const reason = e instanceof ApiError ? e.params?.reason : undefined;
      setErr(reason === 'wrong' ? 'Kod hatalı.' : reason === 'expired' ? 'Kodun süresi doldu ya da çok fazla deneme yapıldı. Yeni kod iste.' : errorText(e));
    } finally { setBusy(false); }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="E-postanı doğrula">
      <Note text={info} />
      <TextInput value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} accessibilityLabel="Doğrulama kodu"
        autoComplete="one-time-code" textContentType="oneTimeCode" placeholder="••••••" placeholderTextColor={c.textTertiary}
        style={[styles.input, styles.code, { color: c.textPrimary, backgroundColor: c.raised, borderColor: c.hairline }]} />
      <Note text={err} tone="error" />
      <Primary label="Doğrula" busy={busy} disabled={code.length !== 6} onPress={() => void verify()} />
      <PressableScale haptic="none" accessibilityRole="button" onPress={() => void send()} style={styles.textBtn}>
        <Text style={[styles.smallText, { color: c.brandText }]}>Kodu yeniden gönder</Text>
      </PressableScale>
    </Sheet>
  );
}

type Prefs = z.infer<typeof NotificationPrefs>;
const PREF_ROWS: [keyof Prefs['topics'], string, string][] = [
  ['messages', 'Mesajlar', 'Yeni mesajlar (içerik gösterilmez)'],
  ['requests', 'Mesaj istekleri', 'Yeni istekler ve kabul edilenler'],
  ['social', 'Sosyal', 'Takip, beğeni, arkadaşlık'],
  ['gifts_unlocks', 'Hediye ve fotoğraflar', 'Gold hediyeleri, açılan fotoğraflar'],
  ['plus_boost', 'Plus ve Boost', 'Üyelik ve Boost durumları'],
  ['wallet', 'Cüzdan', 'Gold yüklemeleri ve iadeler'],
  ['marketing', 'Kampanyalar', 'Fırsatlar ve duyurular'],
];

/** Push preferences. The in-app centre always shows everything; security notices cannot be turned off. */
export function NotificationPrefsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { c } = useTheme();
  const qc = useQueryClient();
  const [perm, setPerm] = useState<PermissionState | null>(null);
  useEffect(() => { if (visible) void notificationPermission().then(setPerm); }, [visible]);
  const enable = async () => {
    if (perm === 'denied') { void Linking.openSettings(); return; } // the OS will not ask twice: send to Settings
    const p = await requestNotificationPermission();
    setPerm(p);
    if (p === 'granted') void registerPushToken();
  };
  const q = useQuery({ queryKey: ['notification-prefs'], queryFn: () => api<Prefs>('/v1/me/notification-preferences').then((r) => r.data), enabled: visible });
  const [err, setErr] = useState<string | null>(null);
  const save = async (next: Prefs) => {
    qc.setQueryData(['notification-prefs'], next); // optimistic toggle, reverted on failure
    try { await api('/v1/me/notification-preferences', { method: 'PUT', body: next }); }
    catch (e) { setErr(errorText(e)); void q.refetch(); }
  };
  const Toggle = ({ on, onPress, label }: { on: boolean; onPress: () => void; label: string }) => (
    <PressableScale haptic="selection" accessibilityRole="switch" accessibilityState={{ checked: on }} aria-checked={on} accessibilityLabel={label} onPress={onPress}
      style={[styles.switch, { backgroundColor: on ? c.brand : c.raised, borderColor: on ? c.brand : c.hairline }]}>
      <View style={[styles.knob, { backgroundColor: on ? c.onBrand : c.textTertiary, alignSelf: on ? 'flex-end' : 'flex-start' }]} />
    </PressableScale>
  );
  const p = q.data;
  return (
    <Sheet visible={visible} onClose={onClose} title="Bildirim tercihleri">
      {perm && perm !== 'granted' && perm !== 'unsupported' ? (
        <View style={[styles.permBox, { backgroundColor: c.surface, borderColor: c.hairline }]}>
          <Ionicons name="notifications-off-outline" size={20} color={c.textSecondary} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.personName, { color: c.textPrimary }]}>Telefon bildirimleri kapalı</Text>
            <Text style={[styles.note, { color: c.textTertiary, marginVertical: 0 }]}>
              {perm === 'denied' ? 'Açmak için telefonunun ayarlarından FLERO’ya izin ver.' : 'Yeni mesaj ve isteklerden haberdar olmak için aç.'}
            </Text>
          </View>
          <PressableScale accessibilityRole="button" onPress={() => void enable()} style={[styles.permBtn, { backgroundColor: c.brand }]}>
            <Text style={[styles.permBtnText, { color: c.onBrand }]}>{perm === 'denied' ? 'Ayarlar' : 'Aç'}</Text>
          </PressableScale>
        </View>
      ) : null}
      <Note text="Bunlar telefon bildirimlerini yönetir. Uygulama içindeki Bildirimler sekmesi her şeyi göstermeye devam eder." />
      <Note text={err} tone="error" />
      {!p ? <ActivityIndicator color={c.brandText} /> : (
        <>
          {PREF_ROWS.map(([k, title, sub]) => (
            <View key={k} style={[styles.person, { borderBottomColor: c.hairline }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.personName, { color: c.textPrimary }]}>{title}</Text>
                <Text style={[styles.note, { color: c.textTertiary, marginVertical: 0 }]}>{sub}</Text>
              </View>
              <Toggle label={title} on={p.topics[k]} onPress={() => void save({ ...p, topics: { ...p.topics, [k]: !p.topics[k] } })} />
            </View>
          ))}
          <View style={[styles.person, { borderBottomColor: c.hairline }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.personName, { color: c.textPrimary }]}>Güvenlik bildirimleri</Text>
              <Text style={[styles.note, { color: c.textTertiary, marginVertical: 0 }]}>Yeni giriş, şifre değişikliği — kapatılamaz</Text>
            </View>
            <Ionicons name="lock-closed" size={18} color={c.textTertiary} />
          </View>
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  permBox: { flexDirection: 'row', alignItems: 'center', gap: space.m, padding: space.m, borderRadius: radius.card, borderWidth: 1, marginBottom: space.m },
  permBtn: { minHeight: 40, paddingHorizontal: space.l, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  permBtnText: { fontFamily: fonts.bold, fontSize: typeScale.bodySmall.size },
  code: { fontFamily: fonts.display, fontSize: 28, letterSpacing: 10, textAlign: 'center', marginTop: space.s },
  textBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: space.s },
  switch: { width: 52, height: 32, borderRadius: 16, borderWidth: 1, padding: 3, justifyContent: 'center' },
  knob: { width: 24, height: 24, borderRadius: 12 },
  label: { fontFamily: fonts.semibold, fontSize: typeScale.bodySmall.size, marginBottom: 6, marginTop: space.s },
  input: { minHeight: 50, borderRadius: radius.s + 4, borderWidth: 1, paddingHorizontal: space.l, fontFamily: fonts.medium, fontSize: typeScale.body.size },
  multi: { minHeight: 96, paddingTop: space.m, textAlignVertical: 'top' },
  note: { fontFamily: fonts.medium, fontSize: typeScale.bodySmall.size - 1, lineHeight: 19, marginVertical: space.xs },
  primary: { minHeight: 52, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', marginTop: space.l },
  primaryText: { fontFamily: fonts.bold, fontSize: typeScale.body.size },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginTop: space.m },
  pill: { minHeight: 42, paddingHorizontal: space.l, borderRadius: radius.pill, borderWidth: 1, justifyContent: 'center' },
  pillText: { fontFamily: fonts.semibold, fontSize: typeScale.bodySmall.size },
  person: { flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.m, borderBottomWidth: StyleSheet.hairlineWidth },
  personName: { fontFamily: fonts.semibold, fontSize: typeScale.body.size - 1 },
  small: { minHeight: 36, paddingHorizontal: space.m, borderRadius: radius.pill, borderWidth: 1, justifyContent: 'center' },
  smallText: { fontFamily: fonts.semibold, fontSize: typeScale.bodySmall.size },
  segment: { flexDirection: 'row', padding: 4, borderRadius: radius.pill, marginBottom: space.m },
  seg: { flex: 1, minHeight: 38, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
