import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { api, ApiError, errorText } from '@/api/client';
import { ErrorBanner, Field, FormScreen, PrimaryButton, type TInput } from '@/design/Form';

/** Opened from the e-mail link flero://reset-password?token=… — sets a new password; every session is signed out. */
export default function ResetPassword() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const second = useRef<TInput>(null);
  const pwErr = pw.length < 10 ? 'En az 10 karakter.' : null;
  const againErr = again !== pw ? 'Şifreler eşleşmiyor.' : null;

  async function submit() {
    setTouched(true);
    if (pwErr || againErr || busy || !token) return;
    setBusy(true); setError(null);
    try { await api('/v1/auth/password/reset', { auth: false, body: { token, new_password: pw } }); setDone(true); }
    catch (e) { setError(e instanceof ApiError && e.status === 401 ? 'Bu bağlantının süresi dolmuş ya da kullanılmış. Yeni bir bağlantı iste.' : errorText(e)); }
    finally { setBusy(false); }
  }

  if (!token) {
    return <FormScreen backTo="/login" title="Bağlantı geçersiz" subtitle="Şifre sıfırlama bağlantısı eksik. E-postadaki bağlantıyı yeniden aç ya da yenisini iste."
      footer={<PrimaryButton label="Yeni bağlantı iste" onPress={() => router.replace('/forgot-password')} />}>{null}</FormScreen>;
  }
  if (done) {
    return <FormScreen back={false} title="Şifren güncellendi" subtitle="Güvenliğin için tüm cihazlarda oturum kapatıldı. Yeni şifrenle giriş yapabilirsin."
      footer={<PrimaryButton label="Giriş yap" onPress={() => router.replace('/login')} />}>{null}</FormScreen>;
  }
  return (
    <FormScreen backTo="/login" title="Yeni şifre belirle" subtitle="Başka bir yerde kullanmadığın, en az 10 karakterlik bir şifre seç."
      footer={<PrimaryButton label="Şifreyi kaydet" busy={busy} onPress={submit} />}>
      <ErrorBanner text={error ?? (error === null && touched && !token ? 'Bağlantı geçersiz.' : null)} />
      <Field label="Yeni şifre" value={pw} onChangeText={setPw} secure autoComplete="new-password" error={touched ? pwErr : null} hint="En az 10 karakter" returnKeyType="next" onSubmitEditing={() => second.current?.focus()} />
      <Field ref={second} label="Yeni şifre (tekrar)" value={again} onChangeText={setAgain} secure autoComplete="new-password" error={touched ? againErr : null} returnKeyType="done" onSubmitEditing={submit} />
    </FormScreen>
  );
}
