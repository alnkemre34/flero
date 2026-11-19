import { radius, space, type as typeScale } from '@flero/ui-tokens';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import type { PlusPlan } from '@flero/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { z } from 'zod';
import { api, errorText, newKey } from '@/api/client';
import { useSession } from '@/api/session';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { easeOut, PressableScale } from '@/design/motion';
import { fonts, useTheme } from '@/design/theme';
import { t } from '@/i18n/tr';
import { goBack } from '@/design/nav';

/** Plus paywall (S26): honest benefits INCLUDING the post-selection rank advantage (A§8.8); never "verified". */
const BENEFITS = ['plus.b.city', 'plus.b.gender', 'plus.b.rank', 'plus.b.city_boost', 'plus.b.style'] as const;

export default function PlusPaywall() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [plan, setPlan] = useState<'MONTHLY' | 'YEARLY'>('YEARLY');
  const qc = useQueryClient();
  const { me, reloadMe } = useSession();
  const plans = useQuery({ queryKey: ['plus', 'plans'], queryFn: () => api<z.infer<typeof PlusPlan>[]>('/v1/plus/plans').then((r) => r.data) });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const isPlus = me?.membership_tier === 'PLUS';
  /** Store subscription (integration: StoreKit 2 / Play Billing). Development builds use the server's dev verifier. */
  const subscribe = async () => {
    const chosen = plans.data?.find((x) => x.period === plan);
    if (!chosen) { setNote('Bu plan şu an satışta değil.'); return; }
    if (!__DEV__) { setNote('Abonelik, App Store / Google Play entegrasyonu ile etkinleşecek.'); return; }
    setBusy(true); setNote(null);
    try {
      const id = newKey();
      const expires = new Date(Date.now() + (plan === 'YEARLY' ? 365 : 30) * 86_400_000).toISOString();
      const payload = btoa(JSON.stringify({ store_txn_id: `dev-${id}`, original_txn_id: `dev-orig-${me?.public_user_id}`, product_id: chosen.product_id, expires_at: expires })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      await api('/v1/plus/verify', { body: { platform: 'APPLE', signed_payload: `dev.${payload}` }, idem: id });
      await reloadMe();
      void qc.invalidateQueries({ queryKey: ['wallet'] });
      void qc.invalidateQueries({ queryKey: ['boost'] });
      void qc.invalidateQueries({ queryKey: ['shuffle'] });
      setNote('Plus aktif. Hoş geldin!');
    } catch (e) { setNote(errorText(e)); } finally { setBusy(false); }
  };

  return (
    <View style={[styles.fill, { backgroundColor: c.canvas }]}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + space.huge, paddingBottom: 160, paddingHorizontal: space.gutter }}>
        <Animated.View entering={reduced ? FadeIn.duration(150) : ZoomIn.duration(360).easing(easeOut).withInitialValues({ transform: [{ scale: 0.9 }] })} style={styles.orbWrap}>
          <LinearGradient colors={[c.plusFrameFrom, c.plusFrameMid, c.plusFrameTo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.orb}>
            <Ionicons name="sparkles" size={40} color="#1E1B2E" />
          </LinearGradient>
        </Animated.View>
        <Text style={[styles.title, { color: c.textPrimary }]}>{t('plus.title')}</Text>
        <Text style={[styles.subtitle, { color: c.textSecondary }]}>{t('plus.subtitle')}</Text>

        <View style={[styles.list, { backgroundColor: c.surface, borderColor: c.hairline }]}>
          {BENEFITS.map((b) => (
            <View key={b} style={styles.benefit}>
              <View style={[styles.check, { backgroundColor: c.plusTint }]}><Ionicons name="checkmark" size={14} color={c.plusText} /></View>
              <Text style={[styles.benefitText, { color: c.textPrimary }]}>{t(b)}</Text>
            </View>
          ))}
        </View>
        <Text style={[styles.fine, { color: c.textTertiary }]}>{t('plus.not_verified')}</Text>

        <View style={styles.plans}>
          {(['YEARLY', 'MONTHLY'] as const).map((p) => {
            const active = plan === p;
            return (
              <PressableScale key={p} haptic="selection" accessibilityRole="radio" accessibilityState={{ checked: active }} aria-checked={active} onPress={() => setPlan(p)}
                style={[styles.plan, { backgroundColor: c.surface, borderColor: active ? c.plusRing : c.hairline, borderWidth: active ? 2 : 1 }]}>
                <Text style={[styles.planName, { color: c.textPrimary }]}>{t(p === 'YEARLY' ? 'plus.yearly' : 'plus.monthly')}</Text>
                <Text style={[styles.planPrice, { color: c.textSecondary }]}>{p === 'YEARLY' ? 'Yıllık faturalanır' : 'Aylık faturalanır'}</Text>
              </PressableScale>
            );
          })}
        </View>
      </ScrollView>

      <View style={[styles.dock, { paddingBottom: insets.bottom + space.m, backgroundColor: c.canvas, borderTopColor: c.hairline }]}>
        {note ? <Text style={[styles.restore, { color: c.textPrimary }]} accessibilityLiveRegion="polite">{note}</Text> : null}
        <PressableScale accessibilityRole="button" haptic="medium" disabled={busy || isPlus} accessibilityState={{ disabled: busy || isPlus, busy }} onPress={() => void subscribe()}
          style={[styles.cta, { backgroundColor: c.brand, opacity: busy || isPlus ? 0.6 : 1 }]}>
          <Text style={[styles.ctaText, { color: c.onBrand }]}>{isPlus ? 'Plus üyesisin' : busy ? 'İşleniyor…' : t('plus.cta')}</Text>
        </PressableScale>
        <Text style={[styles.restore, { color: c.textSecondary }]}>{t('plus.restore')}</Text>
      </View>
      <PressableScale accessibilityRole="button" accessibilityLabel="Kapat" onPress={() => goBack('/')} style={[styles.close, { top: insets.top + space.s, backgroundColor: c.surface }]}>
        <Ionicons name="close" size={22} color={c.textPrimary} />
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  orbWrap: { alignItems: 'center', marginBottom: space.xl },
  orb: { width: 92, height: 92, borderRadius: 30, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-8deg' }] },
  title: { fontFamily: fonts.displayHeavy, fontSize: typeScale.hero.size, lineHeight: typeScale.hero.line, textAlign: 'center', letterSpacing: -1 },
  subtitle: { fontFamily: fonts.medium, fontSize: typeScale.body.size, textAlign: 'center', marginTop: space.xs, marginBottom: space.xxl },
  list: { borderRadius: radius.card, borderWidth: 1, padding: space.l, gap: space.m },
  benefit: { flexDirection: 'row', gap: space.m, alignItems: 'center' },
  check: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  benefitText: { flex: 1, fontFamily: fonts.semibold, fontSize: typeScale.body.size - 1, lineHeight: 21 },
  fine: { fontFamily: fonts.medium, fontSize: typeScale.caption.size, textAlign: 'center', marginTop: space.m },
  plans: { flexDirection: 'row', gap: space.s, marginTop: space.xl },
  plan: { flex: 1, padding: space.l, borderRadius: radius.card, gap: 4 },
  planName: { fontFamily: fonts.display, fontSize: typeScale.headline.size },
  planPrice: { fontFamily: fonts.medium, fontSize: typeScale.bodySmall.size },
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.gutter, paddingTop: space.m, gap: space.s, borderTopWidth: StyleSheet.hairlineWidth, alignItems: 'center' },
  cta: { alignSelf: 'stretch', minHeight: 54, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  ctaText: { fontFamily: fonts.bold, fontSize: typeScale.body.size },
  restore: { fontFamily: fonts.medium, fontSize: typeScale.caption.size, textDecorationLine: 'underline' },
  close: { position: 'absolute', right: space.gutter, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
