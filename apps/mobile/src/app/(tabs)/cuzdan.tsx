import type { StoreProduct, Wallet, WalletTransaction } from '@flero/contracts';
import { radius, space, type as typeScale } from '@flero/ui-tokens';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Platform, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { z } from 'zod';
import { api, errorText, newKey } from '@/api/client';
import { GoldCoin } from '@/design/GoldCoin';
import { entering, PressableScale } from '@/design/motion';
import { Sheet } from '@/design/Sheet';
import { fonts, useTheme } from '@/design/theme';
import { t } from '@/i18n/tr';

/** Wallet (S23/S25). Counterparties come from the projection: anonymous gifts read "Anonim Kullanıcı" (REQ-GLD-08). */
type Tx = z.infer<typeof WalletTransaction>;
type Product = z.infer<typeof StoreProduct>;
const when = (iso: string) => new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const n = (x: number) => new Intl.NumberFormat('tr-TR').format(x);
const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export default function WalletScreen() {
  const { c, name } = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const qc = useQueryClient();
  const wallet = useQuery({ queryKey: ['wallet'], queryFn: () => api<z.infer<typeof Wallet>>('/v1/wallet').then((r) => r.data) });
  const history = useQuery({ queryKey: ['wallet', 'history'], queryFn: () => api<Tx[]>('/v1/wallet/transactions?limit=50').then((r) => r.data) });
  const products = useQuery({
    queryKey: ['store', Platform.OS],
    queryFn: () => api<Product[]>(`/v1/store/products?platform=${Platform.OS === 'android' ? 'GOOGLE' : 'APPLE'}`).then((r) => r.data),
  });
  const [buyOpen, setBuyOpen] = useState(false);
  const [buying, setBuying] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const balance = wallet.data?.available;

  /**
   * Store purchase. The real flow hands the signed store receipt to /purchases/verify (integration: StoreKit /
   * Play Billing). Development builds use the server's dev verifier so the whole ledger path is exercised; the
   * production server refuses dev receipts, so this can never mint free Gold.
   */
  const buy = async (p: Product) => {
    if (!__DEV__) { setNote('Mağaza ödemesi App Store / Google Play entegrasyonu ile etkinleşecek.'); return; }
    setBuying(p.product_id);
    try {
      const receipt = `dev.${b64url(JSON.stringify({ store_txn_id: `dev-${newKey()}`, product_id: p.product_id }))}`;
      await api('/v1/wallet/purchases/verify', { body: { platform: p.platform, signed_payload: receipt }, idem: newKey() });
      setBuyOpen(false);
      setNote(`${n(p.gold_amount)} Gold eklendi.`);
      await qc.invalidateQueries({ queryKey: ['wallet'] });
    } catch (e) { setNote(errorText(e)); } finally { setBuying(null); }
  };
  const onRefresh = async () => { setRefreshing(true); await Promise.all([wallet.refetch(), history.refetch()]); setRefreshing(false); };

  return (
    <ScrollView style={{ backgroundColor: c.canvas }} contentContainerStyle={{ paddingTop: insets.top + space.l, paddingBottom: space.huge }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.brandText} colors={[c.brandText]} />}>
      <Text style={[styles.hero, { color: c.textPrimary }]}>{t('wallet.title')}</Text>

      <LinearGradient
        colors={name === 'dark' ? ['#2A2105', '#14141B'] : ['#FFF3CC', '#FFFFFF']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={[styles.card, { borderColor: name === 'dark' ? '#3A2F0A' : '#F2DFA0' }]}
      >
        <Text style={[styles.label, { color: c.textSecondary }]}>{t('wallet.balance')}</Text>
        <View style={styles.balanceRow}>
          <GoldCoin size={36} />
          {balance === undefined ? <ActivityIndicator color={c.goldText} /> : (
            <Text accessibilityLabel={`${balance} Gold`} style={[styles.balance, { color: c.textPrimary }]}>{n(balance)}</Text>
          )}
        </View>
        <Text style={[styles.note, { color: wallet.data?.restricted ? c.danger : c.textTertiary }]}>
          {wallet.data?.restricted ? 'Cüzdanında bir kısıtlama var; harcama geçici olarak kapalı.' : t('wallet.no_cash')}
        </Text>
        {note ? <Text style={[styles.note, { color: c.textPrimary }]} accessibilityLiveRegion="polite">{note}</Text> : null}
        <View style={styles.actions}>
          <Action icon="add" label={t('wallet.buy')} primary onPress={() => setBuyOpen(true)} />
          <Action icon="flash" label={t('wallet.boost')} onPress={() => router.push('/boost')} />
          <Action icon="sparkles" label={t('wallet.plus')} onPress={() => router.push('/plus')} />
        </View>
      </LinearGradient>

      <Text style={[styles.section, { color: c.textPrimary }]}>{t('wallet.history')}</Text>
      {history.isPending && <ActivityIndicator style={{ margin: space.xl }} color={c.brandText} />}
      {history.isError && <Text style={[styles.empty, { color: c.textSecondary }]}>{errorText(history.error)}</Text>}
      {history.isSuccess && history.data.length === 0 && <Text style={[styles.empty, { color: c.textSecondary }]}>Henüz hareket yok. İlk Gold paketini aldığında burada görünür.</Text>}
      {(history.data ?? []).map((h, i) => (
        <Animated.View key={h.transaction_id} entering={entering(i, reduced)} style={[styles.row, { borderBottomColor: c.hairline }]}>
          <View style={[styles.txIcon, { backgroundColor: c.surface }]}>
            <Ionicons
              name={h.kind === 'BOOST' ? 'flash' : h.kind === 'UNLOCK' ? 'lock-open' : h.kind.startsWith('GIFT') ? 'gift' : h.kind === 'BONUS' ? 'sparkles' : h.kind === 'REVERSAL' ? 'return-down-back' : 'add'}
              size={18}
              color={h.kind === 'BOOST' ? c.promotedAccent : h.kind === 'BONUS' ? c.plusText : c.textPrimary}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.txTitle, { color: c.textPrimary }]}>{t(`tx.${h.kind}`)}</Text>
            <Text style={[styles.txMeta, { color: c.textTertiary }]}>
              {h.counterparty ? `${h.counterparty.kind === 'ANONYMOUS' ? t('chat.anonymous_user') : h.counterparty.display_name} · ` : ''}{when(h.created_at)}
            </Text>
          </View>
          <Text style={[styles.amount, { color: h.amount > 0 ? c.success : c.textPrimary }]}>{h.amount > 0 ? `+${n(h.amount)}` : n(h.amount)}</Text>
        </Animated.View>
      ))}

      <Sheet visible={buyOpen} onClose={() => setBuyOpen(false)} title="Gold al">
        {products.isPending ? <ActivityIndicator color={c.goldText} /> : (products.data ?? []).map((p) => (
          <PressableScale key={p.product_id} accessibilityRole="button" accessibilityLabel={`${p.gold_amount} Gold`} onPress={() => void buy(p)} disabled={!!buying}
            style={[styles.pack, { backgroundColor: c.surface, borderColor: c.hairline }]}>
            <GoldCoin size={28} />
            <Text style={[styles.packText, { color: c.textPrimary }]}>{n(p.gold_amount)} Gold</Text>
            {buying === p.product_id ? <ActivityIndicator color={c.goldText} /> : <Ionicons name="chevron-forward" size={18} color={c.textTertiary} />}
          </PressableScale>
        ))}
        <Text style={[styles.note, { color: c.textTertiary, marginTop: space.s }]}>
          Fiyat, mağazanın kendi ödeme ekranında gösterilir. Gold nakde çevrilemez.{__DEV__ ? ' Geliştirici modu: test satın alımı.' : ''}
        </Text>
      </Sheet>
    </ScrollView>
  );
}

function Action({ icon, label, primary, onPress }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; primary?: boolean; onPress?: () => void }) {
  const { c } = useTheme();
  return (
    <PressableScale accessibilityRole="button" onPress={onPress} style={[styles.action, { backgroundColor: primary ? c.goldFill : c.surface, borderColor: primary ? c.goldFill : c.hairline }]}>
      <Ionicons name={icon} size={18} color={primary ? c.onGoldFill : c.textPrimary} />
      <Text style={[styles.actionText, { color: primary ? c.onGoldFill : c.textPrimary }]}>{label}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  hero: { fontFamily: fonts.displayHeavy, fontSize: typeScale.hero.size, lineHeight: typeScale.hero.line, letterSpacing: -1, paddingHorizontal: space.gutter, marginBottom: space.l },
  card: { marginHorizontal: space.gutter, padding: space.xl, borderRadius: radius.sheet, borderWidth: 1, gap: space.s },
  label: { fontFamily: fonts.semibold, fontSize: typeScale.bodySmall.size },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 62 },
  balance: { fontFamily: fonts.displayHeavy, fontSize: 56, lineHeight: 62, letterSpacing: -2, fontVariant: ['tabular-nums'] },
  note: { fontFamily: fonts.medium, fontSize: typeScale.caption.size },
  actions: { flexDirection: 'row', gap: space.s, marginTop: space.m },
  action: { flex: 1, minHeight: 48, borderRadius: radius.pill, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  actionText: { fontFamily: fonts.bold, fontSize: typeScale.bodySmall.size },
  section: { fontFamily: fonts.display, fontSize: typeScale.title2.size, paddingHorizontal: space.gutter, marginTop: space.xxl, marginBottom: space.s },
  empty: { fontFamily: fonts.regular, fontSize: typeScale.bodySmall.size, paddingHorizontal: space.gutter, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m, paddingHorizontal: space.gutter, paddingVertical: space.m, borderBottomWidth: StyleSheet.hairlineWidth },
  txIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  txTitle: { fontFamily: fonts.semibold, fontSize: typeScale.body.size - 1 },
  txMeta: { fontFamily: fonts.medium, fontSize: typeScale.caption.size },
  pack: { flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 60, paddingHorizontal: space.l, borderRadius: radius.card - 4, borderWidth: 1, marginBottom: space.s },
  packText: { flex: 1, fontFamily: fonts.display, fontSize: typeScale.headline.size },
  amount: { fontFamily: fonts.display, fontSize: typeScale.headline.size, fontVariant: ['tabular-nums'] },
});
