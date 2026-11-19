import { radius, space, type as typeScale } from '@flero/ui-tokens';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { adoptTokens, api, errorText, type TokenPair } from '@/api/client';
import { ErrorBanner, Field, FormScreen, PrimaryButton, type TInput } from '@/design/Form';
import { PressableScale } from '@/design/motion';
import { fonts, useTheme } from '@/design/theme';

/** S02 Sign-up. Validation mirrors the server contract; server errors stay generic (no account enumeration). */
export default function Signup() {
  const { c } = useTheme();
  const [f, setF] = useState({ display_name: '', handle: '', email: '', password: '', gender: '' as '' | 'FEMALE' | 'MALE' });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refs = { handle: useRef<TInput>(null), email: useRef<TInput>(null), password: useRef<TInput>(null) };
  const handle = f.handle.trim().toLocaleLowerCase('tr-TR').replace(/^@/, '');
  const errs = {
    display_name: !f.display_name.trim() ? 'Adını yaz.' : null,
    handle: !/^[a-z0-9._]{3,20}$/.test(handle) ? '3–20 karakter: küçük harf, rakam, nokta, alt çizgi.' : null,
    email: !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim()) ? 'Geçerli bir e-posta yaz.' : null,
    password: f.password.length < 10 ? 'En az 10 karakter.' : null,
    gender: !f.gender ? 'Birini seç.' : null,
  };
  const valid = Object.values(errs).every((e) => !e);
  const show = (k: keyof typeof errs) => (touched ? errs[k] : null);

  async function submit() {
    setTouched(true);
    if (!valid || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await api<TokenPair>('/v1/auth/signup', { auth: false, body: { display_name: f.display_name.trim(), handle, email: f.email.trim(), password: f.password, gender: f.gender, locale: 'tr' } });
      await adoptTokens(r.data); // the session gate routes on to age assurance
    } catch (e) {
      setError(e instanceof Error && 'status' in e && (e as { status: number }).status === 409 ? 'Bu e-posta veya kullanıcı adı kullanılamıyor.' : errorText(e));
    } finally { setBusy(false); }
  }

  return (
    <FormScreen step={1} total={4} title="Hesabını oluştur" subtitle="Profilinde adın ve kullanıcı adın görünür; e-postan asla."
      footer={<PrimaryButton label="Devam" busy={busy} onPress={submit} />}>
      <ErrorBanner text={error} />
      <Field label="Ad" value={f.display_name} onChangeText={(v) => setF({ ...f, display_name: v })} error={show('display_name')} autoComplete="given-name" returnKeyType="next" onSubmitEditing={() => refs.handle.current?.focus()} maxLength={40} />
      <Field ref={refs.handle} label="Kullanıcı adı" value={f.handle} onChangeText={(v) => setF({ ...f, handle: v })} error={show('handle')} hint="Örn. defne.k" autoCapitalize="none" autoCorrect={false} returnKeyType="next" onSubmitEditing={() => refs.email.current?.focus()} maxLength={21} />
      <Field ref={refs.email} label="E-posta" value={f.email} onChangeText={(v) => setF({ ...f, email: v })} error={show('email')} keyboardType="email-address" autoCapitalize="none" autoComplete="email" returnKeyType="next" onSubmitEditing={() => refs.password.current?.focus()} />
      <Field ref={refs.password} label="Şifre" value={f.password} onChangeText={(v) => setF({ ...f, password: v })} error={show('password')} hint="En az 10 karakter" secure autoComplete="new-password" returnKeyType="done" onSubmitEditing={submit} />
      <View style={{ gap: 6 }}>
        <Text style={[styles.label, { color: c.textSecondary }]}>Cinsiyet</Text>
        <View style={styles.row} accessibilityRole="radiogroup">
          {([['FEMALE', 'Kadın'], ['MALE', 'Erkek']] as const).map(([v, l]) => {
            const on = f.gender === v;
            return (
              <PressableScale key={v} haptic="selection" accessibilityRole="radio" accessibilityState={{ checked: on }} aria-checked={on} onPress={() => setF({ ...f, gender: v })}
                style={[styles.seg, { backgroundColor: on ? c.brand : c.surface, borderColor: on ? c.brand : show('gender') ? c.danger : c.hairline }]}>
                <Text style={[styles.segText, { color: on ? c.onBrand : c.textPrimary }]}>{l}</Text>
              </PressableScale>
            );
          })}
        </View>
        {show('gender') && <Text style={[styles.hint, { color: c.danger }]}>{errs.gender}</Text>}
        <Text style={[styles.hint, { color: c.textTertiary }]}>Daha sonra yalnızca destek ekibi değiştirebilir.</Text>
      </View>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  label: { fontFamily: fonts.semibold, fontSize: typeScale.bodySmall.size },
  row: { flexDirection: 'row', gap: space.s },
  seg: { flex: 1, minHeight: 52, borderRadius: radius.pill, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  segText: { fontFamily: fonts.bold, fontSize: typeScale.body.size },
  hint: { fontFamily: fonts.medium, fontSize: typeScale.caption.size },
});
