import type { BoostCatalog, BoostEntitlement, BoostQuote, MyBoost } from '@flero/contracts';
import { radius, space, type as typeScale } from '@flero/ui-tokens';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { z } from 'zod';
import { api, ApiError, errorText, newKey } from '@/api/client';
import { useSession } from '@/api/session';
import { GoldCoin } from '@/design/GoldCoin';
import { easeOut, PressableScale } from '@/design/motion';
import { fonts, useTheme } from '@/design/theme';
import { t } from '@/i18n/tr';
import { goBack } from '@/design/nav';

type Catalog = z.infer<typeof BoostCatalog>;
type Quote = z.infer<typeof BoostQuote>;
type Ent = z.infer<typeof BoostEntitlement>;
const dur = (s: number) => (s % 86400 === 0 ? `${s / 86400} gün` : s % 3600 === 0 ? `${s / 3600} saat` : `${Math.round(s / 60)} dk`);
const time = (iso: string) => new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/**
 * Boost checkout (S27/S28). Gold-only (never a store sheet), target = registered home, fixed by the server.
 * The neutral viewer-dependent disclosure (A§8.8) is ALWAYS shown, and confirm stays disabled until it rendered.
 * The quote is server-issued and versioned: the price shown is the price charged. One Idempotency-Key per
 * quote means a double tap or a retry after a timeout can never charge twice.
 */
export default function BoostCheckout() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const qc = useQueryClient();
  const { me } = useSession();
  const isPlus = me?.membership_tier === 'PLUS';
  const catalog = useQuery({ queryKey: ['boost', 'catalog'], queryFn: () => api<Catalog>('/v1/boosts/catalog').then((r) => r.data) });
  const mine = useQuery({ queryKey: ['boost', 'mine'], queryFn: () => api<z.infer<typeof MyBoost>>('/v1/me/boost').then((r) => r.data.active) });
  const [pkg, setPkg] = useState<number | null>(null);
  const [disclosureShown, setDisclosureShown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Ent | null>(null);
  const key = useRef<string>(newKey());

  useEffect(() => { if (pkg === null && catalog.data?.packages[0]) setPkg(catalog.data.packages[0].package_id); }, [catalog.data, pkg]);
  const selected = catalog.data?.packages.find((p) => p.package_id === pkg);
  const quote = useQuery({
    queryKey: ['boost', 'quote', pkg],
    queryFn: () => api<Quote>('/v1/boosts/quotes', { body: { package_id: selected!.package_id, scope: selected!.scope } }).then((r) => r.data),
    enabled: !!selected && !mine.data,
    staleTime: 240_000, // quotes live 5 minutes server-side; refresh before that
  });
  useEffect(() => { key.current = newKey(); }, [quote.data?.quote_id]); // a new quote is a new purchase intent

  const activate = useMutation({
    mutationFn: () => api<Ent>('/v1/boosts/activations', { body: { quote_id: quote.data!.quote_id }, idem: key.current }).then((r) => r.data),
    onSuccess: (e) => { setDone(e); void qc.invalidateQueries({ queryKey: ['wallet'] }); void qc.invalidateQueries({ queryKey: ['boost', 'mine'] }); },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'BOOST_QUOTE_EXPIRED') void quote.refetch();
      setError(errorText(e));
    },
  });

  const active = done ?? mine.data;
  if (active) {
    return (
      <View style={[styles.fill, styles.center, { backgroundColor: c.canvas, paddingTop: insets.top }]}>
        <Animated.View entering={reduced ? FadeIn.duration(150) : ZoomIn.duration(360).easing(easeOut)} style={[styles.icon, { backgroundColor: c.promotedTint, width: 88, height: 88, borderRadius: 30 }]}>
          <Ionicons name="flash" size={42} color={c.promotedAccent} />
        </Animated.View>
        <Text style={[styles.title, { color: c.textPrimary, textAlign: 'center' }]}>{done ? 'Boost aktif' : 'Boost’un sürüyor'}</Text>
        <Text style={[styles.subtitle, { color: c.textSecondary, textAlign: 'center' }]}>
          {t(active.scope === 'CITY' ? 'boost.city' : 'boost.district')} · {active.target_district_label_key ? `${t(active.target_district_label_key)} · ` : ''}{t(active.target_city_label_key)}{'\n'}{time(active.ends_at)} tarihine kadar
        </Text>
        <PressableScale accessibilityRole="button" onPress={() => goBack('/cuzdan')} style={[styles.cta, { backgroundColor: c.brand, alignSelf: 'stretch', marginHorizontal: space.gutter }]}>
          <Text style={[styles.ctaText, { color: c.onBrand }]}>Tamam</Text>
        </PressableScale>
      </View>
    );
  }

  const balance = quote.data?.available_gold;
  const price = quote.data?.price_gold ?? selected?.price_gold ?? 0;
  const short = balance !== undefined && balance < price;

  return (
    <View style={[styles.fill, { backgroundColor: c.canvas }]}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + space.xxxl, paddingHorizontal: space.gutter, paddingBottom: 200 }}>
        <View style={[styles.icon, { backgroundColor: c.promotedTint }]}><Ionicons name="flash" size={30} color={c.promotedAccent} /></View>
        <Text style={[styles.title, { color: c.textPrimary }]}>{t('boost.title')}</Text>
        <Text style={[styles.subtitle, { color: c.textSecondary }]}>{t('boost.subtitle')}</Text>

        {catalog.isPending ? <ActivityIndicator color={c.promotedAccent} /> : (
          <View style={styles.scopes} accessibilityRole="radiogroup">
            {(catalog.data?.packages ?? []).map((p) => {
              const on = p.package_id === pkg;
              return (
                <PressableScale key={p.package_id} haptic="selection" accessibilityRole="radio" accessibilityState={{ checked: on }} aria-checked={on}
                  onPress={() => { setPkg(p.package_id); setError(null); }}
                  style={[styles.scope, { backgroundColor: c.surface, borderColor: on ? c.promotedAccent : c.hairline, borderWidth: on ? 2 : 1 }]}>
                  <Text style={[styles.scopeName, { color: c.textPrimary }]}>{t(p.scope === 'DISTRICT' ? 'boost.district' : 'boost.city')}</Text>
                  <Text style={[styles.price, { color: c.textSecondary }]}>{dur(p.duration_seconds)}</Text>
                  <View style={styles.priceRow}><GoldCoin size={14} /><Text style={[styles.price, { color: c.textPrimary }]}>{p.price_gold}</Text></View>
                </PressableScale>
              );
            })}
            {!isPlus && (
              <PressableScale haptic="none" accessibilityRole="button" accessibilityHint="Plus sayfasını açar" onPress={() => router.push('/plus')}
                style={[styles.scope, { backgroundColor: c.surface, borderColor: c.hairline, borderWidth: 1, opacity: 0.75 }]}>
                <Text style={[styles.scopeName, { color: c.textPrimary }]}>{t('boost.city')}</Text>
                <View style={styles.priceRow}><Ionicons name="lock-closed" size={12} color={c.plusText} /><Text style={[styles.lock, { color: c.plusText }]}>{t('boost.requires_plus')}</Text></View>
              </PressableScale>
            )}
          </View>
        )}

        <View style={[styles.summary, { backgroundColor: c.surface, borderColor: c.hairline }]}>
          <Line label={t('boost.target')} value={quote.data ? `${quote.data.target_district_label_key ? `${t(quote.data.target_district_label_key)} · ` : ''}${t(quote.data.target_city_label_key)}` : '…'} />
          <Line label={t('boost.duration')} value={selected ? `${dur(selected.duration_seconds)} · şimdi başlar` : '…'} />
          <Line label={t('boost.balance_after')} value={balance === undefined ? '…' : short ? `${balance} Gold (yetersiz)` : `${balance} → ${balance - price} Gold`} />
        </View>

        {error ? <Text style={[styles.error, { color: c.danger }]} accessibilityLiveRegion="assertive">{error}</Text> : null}

        <View onLayout={() => setDisclosureShown(true)} style={[styles.disclosure, { backgroundColor: c.raised }]} accessibilityLiveRegion="polite">
          <Ionicons name="information-circle" size={18} color={c.textSecondary} />
          <View style={{ flex: 1, gap: space.s }}>
            <Text style={[styles.disclosureText, { color: c.textPrimary }]}>{t('boost.disclosure')}</Text>
            <Text style={[styles.disclosureText, { color: c.textSecondary }]}>{t('boost.no_guarantee')} {t('boost.survives_plus')}</Text>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.dock, { paddingBottom: insets.bottom + space.m, backgroundColor: c.canvas, borderTopColor: c.hairline }]}>
        {short ? (
          <PressableScale accessibilityRole="button" haptic="medium" onPress={() => router.push('/cuzdan')} style={[styles.cta, { backgroundColor: c.goldFill }]}>
            <GoldCoin size={18} inverted />
            <Text style={[styles.ctaText, { color: c.onGoldFill }]}>Gold yükle</Text>
          </PressableScale>
        ) : (
          <PressableScale accessibilityRole="button" accessibilityState={{ disabled: !disclosureShown || !quote.data, busy: activate.isPending }}
            disabled={!disclosureShown || !quote.data || activate.isPending} haptic="medium" onPress={() => { setError(null); activate.mutate(); }}
            style={[styles.cta, { backgroundColor: c.brand, opacity: disclosureShown && quote.data ? 1 : 0.5 }]}>
            {activate.isPending ? <ActivityIndicator color={c.onBrand} /> : (
              <>
                <GoldCoin size={18} inverted />
                <Text style={[styles.ctaText, { color: c.onBrand }]}>{price} Gold {t('boost.activate')}</Text>
              </>
            )}
          </PressableScale>
        )}
      </View>
      <PressableScale accessibilityRole="button" accessibilityLabel="Kapat" onPress={() => goBack('/cuzdan')} style={[styles.close, { top: insets.top + space.s, backgroundColor: c.surface }]}>
        <Ionicons name="close" size={22} color={c.textPrimary} />
      </PressableScale>
    </View>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  const { c } = useTheme();
  return (
    <View style={styles.line}>
      <Text style={[styles.lineLabel, { color: c.textTertiary }]}>{label}</Text>
      <Text style={[styles.lineValue, { color: c.textPrimary }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', gap: space.l },
  icon: { width: 64, height: 64, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: space.l },
  title: { fontFamily: fonts.displayHeavy, fontSize: typeScale.display.size, lineHeight: typeScale.display.line, letterSpacing: -0.6 },
  subtitle: { fontFamily: fonts.medium, fontSize: typeScale.body.size, marginTop: space.xs, marginBottom: space.xl, lineHeight: 23 },
  scopes: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  scope: { flexGrow: 1, flexBasis: '45%', padding: space.l, borderRadius: radius.card, gap: 6 },
  scopeName: { fontFamily: fonts.display, fontSize: typeScale.headline.size },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  price: { fontFamily: fonts.semibold, fontSize: typeScale.bodySmall.size },
  lock: { fontFamily: fonts.semibold, fontSize: typeScale.caption.size },
  summary: { marginTop: space.l, borderRadius: radius.card, borderWidth: 1, padding: space.l, gap: space.m },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: space.m },
  lineLabel: { fontFamily: fonts.medium, fontSize: typeScale.bodySmall.size },
  lineValue: { fontFamily: fonts.semibold, fontSize: typeScale.bodySmall.size, flexShrink: 1, textAlign: 'right' },
  error: { fontFamily: fonts.semibold, fontSize: typeScale.bodySmall.size, marginTop: space.m },
  disclosure: { marginTop: space.l, flexDirection: 'row', gap: space.m, padding: space.l, borderRadius: radius.card },
  disclosureText: { fontFamily: fonts.regular, fontSize: typeScale.bodySmall.size, lineHeight: typeScale.bodySmall.line },
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.gutter, paddingTop: space.m, borderTopWidth: StyleSheet.hairlineWidth },
  cta: { minHeight: 54, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  ctaText: { fontFamily: fonts.bold, fontSize: typeScale.body.size },
  close: { position: 'absolute', right: space.gutter, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
