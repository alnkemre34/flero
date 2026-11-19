import { space, type as typeScale } from '@flero/ui-tokens';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { api, errorText } from '@/api/client';
import { ErrorBanner, Field, FormScreen, PrimaryButton } from '@/design/Form';
import { fonts, useTheme } from '@/design/theme';

/**
 * Forgot password. The server always answers the same way, so this screen never reveals whether an account
 * exists for the address (no enumeration). The e-mail carries a flero://reset-password link.
 */
export default function ForgotPassword() {
  const { c } = useTheme();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email ?? '');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function submit() {
    if (!valid || busy) return;
    setBusy(true); setError(null);
    try { await api('/v1/auth/password/reset-request', { auth: false, body: { email: email.trim() } }); setSent(true); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }

  if (sent) {
    return (
      <FormScreen backTo="/login" title="E-postanı kontrol et" subtitle={`${email.trim()} adresine kayıtlı bir hesap varsa, şifreni sıfırlaman için bir bağlantı gönderdik. Bağlantı 30 dakika geçerli.`}
        footer={<PrimaryButton label="Girişe dön" onPress={() => router.replace('/login')} />}>
        <Animated.View entering={FadeIn.duration(200)} style={[styles.hint, { backgroundColor: c.surface, borderColor: c.hairline }]}>
          <Ionicons name="mail-open-outline" size={22} color={c.brandText} />
          <Text style={[styles.hintText, { color: c.textSecondary }]}>Gelmediyse istenmeyen klasörüne bak ya da bir dakika sonra tekrar iste.</Text>
        </Animated.View>
      </FormScreen>
    );
  }
  return (
    <FormScreen backTo="/login" title="Şifreni mi unuttun?" subtitle="Hesabının e-posta adresini yaz, sana bir sıfırlama bağlantısı gönderelim."
      footer={<PrimaryButton label="Bağlantı gönder" busy={busy} disabled={!valid} onPress={submit} />}>
      <ErrorBanner text={error} />
      <Field label="E-posta" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" returnKeyType="send" onSubmitEditing={submit} />
      <View />
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  hint: { flexDirection: 'row', gap: space.m, alignItems: 'center', padding: space.l, borderRadius: 16, borderWidth: 1 },
  hintText: { flex: 1, fontFamily: fonts.medium, fontSize: typeScale.bodySmall.size, lineHeight: 20 },
});
