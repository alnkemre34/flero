import { radius, space, type as typeScale } from '@flero/ui-tokens';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Platform, StyleSheet, Text, View } from 'react-native';
import { api, ApiError, errorText, newKey } from '@/api/client';
import { useSession } from '@/api/session';
import { ErrorBanner, Field, FormScreen, PrimaryButton, type TInput } from '@/design/Form';
import { PressableScale } from '@/design/motion';
import { Sheet } from '@/design/Sheet';
import { fonts, useTheme } from '@/design/theme';
import { t } from '@/i18n/tr';

/** Current legal document versions (must match the server's CURRENT_DOCS). */
const DOCS = { TERMS: '2026-11', PRIVACY: '2026-11', COMMUNITY: '2026-11', MARKETING: '2026-11' } as const;

/**
 * S04–S06 onboarding, in the order the server enforces: age → consents → home region. The screen always shows
 * the first missing step from `/v1/me`, so killing the app mid-way resumes at the right place.
 */
export default function Onboarding() {
  const { me, reloadMe, signOut } = useSession();
  const { c } = useTheme();
  const [leaving, setLeaving] = useState(false);
  // Android back does the same as the on-screen back: ask, never silently exit the app mid-onboarding
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setLeaving(true); return true; });
    return () => sub.remove();
  }, []);
  const o = me?.onboarding;
  if (!o) return null;
  const step = !o.age_assured ? <AgeStep done={reloadMe} onBlocked={signOut} /> : !o.consents_current ? <ConsentStep done={reloadMe} /> : <RegionStep done={reloadMe} />;
  return (
    <LeaveContext.Provider value={() => setLeaving(true)}>
      {step}
      <Sheet visible={leaving} onClose={() => setLeaving(false)} title="Kayıttan çıkılsın mı?">
        <Text style={[styles.leaveText, { color: c.textSecondary }]}>
          Şimdiye kadar girdiklerin kaydedildi. Daha sonra aynı hesapla giriş yaptığında kaldığın adımdan devam edersin.
        </Text>
        <PrimaryButton label="Devam et" onPress={() => setLeaving(false)} />
        <PrimaryButton label="Çıkış yap" variant="ghost" onPress={() => { setLeaving(false); void signOut(); }} />
      </Sheet>
    </LeaveContext.Provider>
  );
}

/** Each step's back button asks before leaving (the steps already saved on the server cannot be undone). */
const LeaveContext = createContext<() => void>(() => {});
const useLeave = () => useContext(LeaveContext);

function AgeStep({ done, onBlocked }: { done: () => Promise<unknown>; onBlocked: () => Promise<void> }) {
  const leave = useLeave();
  const [d, setD] = useState({ day: '', month: '', year: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const m = useRef<TInput>(null);
  const y = useRef<TInput>(null);
  const iso = `${d.year.padStart(4, '0')}-${d.month.padStart(2, '0')}-${d.day.padStart(2, '0')}`;
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(Date.parse(iso)) && Number(d.year) > 1900 && new Date(iso).getUTCDate() === Number(d.day);

  async function submit() {
    if (!valid || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await api<{ age_assured: boolean; next_step: string }>('/v1/onboarding/age-assurance', { body: { method: 'SELF_DECLARED_DOB', date_of_birth: iso } });
      if (r.data.next_step === 'BLOCKED') setBlocked(true); else await done();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }

  if (blocked) {
    return (
      <FormScreen back={false} title="FLERO 18 yaş ve üzeri içindir" subtitle="Şu an hesap oluşturamazsın. Doğum tarihin kaydedilmedi."
        footer={<PrimaryButton label="Tamam" onPress={() => void onBlocked()} />}>{null}</FormScreen>
    );
  }
  const num = (v: string, max: number) => v.replace(/\D/g, '').slice(0, max);
  return (
    <FormScreen onBack={leave} step={2} total={4} title="Doğum tarihin" subtitle="Yalnızca 18 yaşından büyük olduğunu doğrulamak için kullanılır; tarih kaydedilmez ve profilinde görünmez."
      footer={<PrimaryButton label="Devam" busy={busy} disabled={!valid} onPress={submit} />}>
      <ErrorBanner text={error} />
      <View style={styles.dob}>
        <View style={{ flex: 1 }}><Field label="Gün" value={d.day} keyboardType="number-pad" maxLength={2} placeholder="GG" onChangeText={(v) => { const x = num(v, 2); setD({ ...d, day: x }); if (x.length === 2) m.current?.focus(); }} /></View>
        <View style={{ flex: 1 }}><Field ref={m} label="Ay" value={d.month} keyboardType="number-pad" maxLength={2} placeholder="AA" onChangeText={(v) => { const x = num(v, 2); setD({ ...d, month: x }); if (x.length === 2) y.current?.focus(); }} /></View>
        <View style={{ flex: 1.4 }}><Field ref={y} label="Yıl" value={d.year} keyboardType="number-pad" maxLength={4} placeholder="YYYY" onChangeText={(v) => setD({ ...d, year: num(v, 4) })} onSubmitEditing={submit} /></View>
      </View>
    </FormScreen>
  );
}

function ConsentStep({ done }: { done: () => Promise<unknown> }) {
  const leave = useLeave();
  const { c } = useTheme();
  const [checked, setChecked] = useState({ TERMS: false, PRIVACY: false, COMMUNITY: false, MARKETING: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useMemo(newKey, []); // the same key across retries: accepting twice is a no-op
  const required = checked.TERMS && checked.PRIVACY && checked.COMMUNITY;
  const items: [keyof typeof checked, string, string, boolean][] = [
    ['TERMS', 'Kullanım koşulları', 'Hesap, Gold ve ödemelerle ilgili kurallar.', true],
    ['PRIVACY', 'KVKK aydınlatma metni', 'Hangi veriyi neden işlediğimiz.', true],
    ['COMMUNITY', 'Topluluk kuralları', 'Saygı, rıza ve güvenlik kurallarımız.', true],
    ['MARKETING', 'Kampanya bildirimleri', 'İsteğe bağlı. İstediğin zaman kapatabilirsin.', false],
  ];
  async function submit() {
    if (!required || busy) return;
    setBusy(true); setError(null);
    try {
      const consents = items.filter(([k]) => checked[k]).map(([k]) => ({ kind: k, doc_version: DOCS[k] }));
      await api('/v1/onboarding/consents', { body: { locale: 'tr', consents }, idem: key });
      await done();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return (
    <FormScreen onBack={leave} step={3} total={4} title="Birkaç onay" subtitle="Zorunlu olanları onaylaman gerekiyor; pazarlama tamamen isteğe bağlı."
      footer={<PrimaryButton label="Kabul et ve devam et" busy={busy} disabled={!required} onPress={submit} />}>
      <ErrorBanner text={error} />
      {items.map(([k, title, body, req]) => (
        <PressableScale key={k} haptic="selection" accessibilityRole="checkbox" accessibilityState={{ checked: checked[k] }} aria-checked={checked[k]} accessibilityLabel={`${title}${req ? ', zorunlu' : ', isteğe bağlı'}`}
          onPress={() => setChecked((s) => ({ ...s, [k]: !s[k] }))}
          style={[styles.consent, { backgroundColor: c.surface, borderColor: checked[k] ? c.brandText : c.hairline }]}>
          <View style={[styles.box, { borderColor: checked[k] ? c.brand : c.textTertiary, backgroundColor: checked[k] ? c.brand : 'transparent' }]}>
            {checked[k] && <Ionicons name="checkmark" size={16} color={c.onBrand} />}
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[styles.cTitle, { color: c.textPrimary }]}>{title}{req && <Text style={{ color: c.textTertiary }}>  · zorunlu</Text>}</Text>
            <Text style={[styles.cBody, { color: c.textSecondary }]}>{body}</Text>
          </View>
        </PressableScale>
      ))}
    </FormScreen>
  );
}

interface City { city_id: string; label_key: string }
interface District { district_id: string; city_id: string; label_key: string }

function RegionStep({ done }: { done: () => Promise<unknown> }) {
  const leave = useLeave();
  const { c } = useTheme();
  const [city, setCity] = useState<string | null>(null);
  const [district, setDistrict] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useMemo(newKey, []);
  const cities = useQuery({ queryKey: ['geo', 'cities'], queryFn: () => api<City[]>('/v1/geo/cities').then((r) => r.data), staleTime: Infinity });
  const districts = useQuery({ queryKey: ['geo', 'districts', city], queryFn: () => api<District[]>(`/v1/geo/cities/${city}/districts`).then((r) => r.data), enabled: !!city, staleTime: Infinity });

  async function submit() {
    if (!city || !district || busy) return;
    setBusy(true); setError(null);
    try {
      await api('/v1/onboarding/home-region', { body: { city_id: city, district_id: district }, idem: key });
      await done();
    } catch (e) { setError(e instanceof ApiError && e.code === 'HOME_REGION_CHANGE_TOO_SOON' ? 'Bölgen zaten seçilmiş.' : errorText(e)); } finally { setBusy(false); }
  }
  const Pill = ({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) => (
    <PressableScale haptic="selection" accessibilityRole="radio" accessibilityState={{ checked: on }} aria-checked={on} onPress={onPress}
      style={[styles.pill, { backgroundColor: on ? c.brand : c.surface, borderColor: on ? c.brand : c.hairline }]}>
      <Text style={[styles.pillText, { color: on ? c.onBrand : c.textPrimary }]}>{label}</Text>
    </PressableScale>
  );
  return (
    <FormScreen onBack={leave} step={4} total={4} title="Nerede yaşıyorsun?" subtitle="Keşfet seni ilçendeki insanlarla buluşturur. Bölgeni 30 günde bir değiştirebilirsin; tam konumun asla kullanılmaz."
      footer={<PrimaryButton label="FLERO’ya başla" busy={busy} disabled={!city || !district} onPress={submit} />}>
      <ErrorBanner text={error ?? (cities.isError ? errorText(cities.error) : null)} />
      <Text style={[styles.group, { color: c.textTertiary }]}>ŞEHİR</Text>
      <View style={styles.pills} accessibilityRole="radiogroup">
        {cities.data?.map((x) => <Pill key={x.city_id} label={t(x.label_key)} on={city === x.city_id} onPress={() => { setCity(x.city_id); setDistrict(null); }} />)}
      </View>
      {city && (
        <>
          <Text style={[styles.group, { color: c.textTertiary }]}>İLÇE</Text>
          <View style={styles.pills} accessibilityRole="radiogroup">
            {districts.data?.map((x) => <Pill key={x.district_id} label={t(x.label_key)} on={district === x.district_id} onPress={() => setDistrict(x.district_id)} />)}
          </View>
        </>
      )}
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  leaveText: { fontFamily: fonts.regular, fontSize: typeScale.body.size, lineHeight: 23 },
  dob: { flexDirection: 'row', gap: space.s },
  consent: { flexDirection: 'row', gap: space.m, alignItems: 'center', padding: space.l, borderRadius: radius.card - 4, borderWidth: 1.5 },
  box: { width: 24, height: 24, borderRadius: 8, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  cTitle: { fontFamily: fonts.semibold, fontSize: typeScale.body.size },
  cBody: { fontFamily: fonts.regular, fontSize: typeScale.bodySmall.size, lineHeight: 19 },
  group: { fontFamily: fonts.bold, fontSize: typeScale.label.size, letterSpacing: 1 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  pill: { minHeight: 44, paddingHorizontal: space.l + 2, borderRadius: radius.pill, borderWidth: 1.5, justifyContent: 'center' },
  pillText: { fontFamily: fonts.semibold, fontSize: typeScale.bodySmall.size + 1 },
});
