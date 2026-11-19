import { radius, space, type as typeScale } from '@flero/ui-tokens';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { adoptTokens, api, ApiError, errorText, type TokenPair } from '@/api/client';
import { ErrorBanner, Field, FormScreen, PrimaryButton, type TInput } from '@/design/Form';
import { PressableScale } from '@/design/motion';
import { fonts, useTheme } from '@/design/theme';

/**
 * S03 Login. One generic error for wrong password and unknown e-mail (no enumeration). "Beni hatırla" on keeps
 * the refresh token in the OS keychain; off keeps it in memory only, so the session ends when the app closes.
 */
export default function Login() {
  const { c } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pw = useRef<TInput>(null);

  async function submit() {
    if (busy || !email.trim() || !password) return;
    setBusy(true); setError(null);
    try {
      await adoptTokens((await api<TokenPair>('/v1/auth/login', { auth: false, body: { email: email.trim(), password } })).data, remember);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401 ? 'E-posta veya şifre hatalı.' : errorText(e));
    } finally { setBusy(false); }
  }

  return (
    <FormScreen title="Tekrar hoş geldin" subtitle="Kaldığın yerden devam et." footer={<PrimaryButton label="Giriş yap" busy={busy} disabled={!email.trim() || !password} onPress={submit} />}>
      <ErrorBanner text={error} />
      <Field label="E-posta" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" returnKeyType="next" onSubmitEditing={() => pw.current?.focus()} />
      <Field ref={pw} label="Şifre" value={password} onChangeText={setPassword} secure autoComplete="current-password" returnKeyType="go" onSubmitEditing={submit} />
      <View style={styles.row}>
        <PressableScale haptic="selection" accessibilityRole="checkbox" accessibilityState={{ checked: remember }} aria-checked={remember} accessibilityLabel="Beni hatırla"
          accessibilityHint="Kapalıysa uygulamayı kapattığında oturumun kapanır" onPress={() => setRemember((r) => !r)} style={styles.remember}>
          <View style={[styles.box, { borderColor: remember ? c.brand : c.textTertiary, backgroundColor: remember ? c.brand : 'transparent' }]}>
            {remember && <Ionicons name="checkmark" size={15} color={c.onBrand} />}
          </View>
          <Text style={[styles.text, { color: c.textPrimary }]}>Beni hatırla</Text>
        </PressableScale>
        <PressableScale haptic="none" accessibilityRole="link" onPress={() => router.push({ pathname: '/forgot-password', params: email.trim() ? { email: email.trim() } : {} })} style={styles.link}>
          <Text style={[styles.text, { color: c.brandText, fontFamily: fonts.semibold }]}>Şifremi unuttum</Text>
        </PressableScale>
      </View>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: -space.xs },
  remember: { flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 44 },
  box: { width: 22, height: 22, borderRadius: radius.s - 3, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  text: { fontFamily: fonts.medium, fontSize: typeScale.bodySmall.size + 1 },
  link: { minHeight: 44, justifyContent: 'center', paddingLeft: space.m },
});
