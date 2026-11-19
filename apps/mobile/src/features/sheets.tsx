import { radius, size, space, type as typeScale } from '@flero/ui-tokens';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GoldCoin } from '@/design/GoldCoin';
import { PressableScale } from '@/design/motion';
import { Sheet } from '@/design/Sheet';
import { fonts, useTheme } from '@/design/theme';

/** Unlock confirm (S17, REQ-MED-03, DEC-05): cost, balance before→after, kind, and media expiry BEFORE paying. */
export function UnlockSheet({ visible, onClose, onConfirm, price, balance, oneView, expires }: {
  visible: boolean; onClose: () => void; onConfirm: () => void; price: number; balance: number; oneView: boolean; expires: string;
}) {
  const { c } = useTheme();
  const enough = balance >= price;
  return (
    <Sheet visible={visible} onClose={onClose} title="Fotoğrafı aç">
      <Rows rows={[
        ['Tür', oneView ? 'Tek görüntüleme' : 'Kalıcı'],
        ['Ücret', `${price} Gold`],
        ['Bakiye', enough ? `${balance} → ${balance - price} Gold` : `${balance} Gold`],
        ['Görüntülenebilir', `${expires} tarihine kadar`],
      ]} />
      {enough ? (
        <Primary label={`${price} Gold ile aç`} coin onPress={onConfirm} />
      ) : (
        <>
          <Text style={[styles.warn, { color: c.warning }]}>Yeterli Gold yok.</Text>
          <Primary label="Gold al" onPress={() => { onClose(); router.push('/cuzdan'); }} />
        </>
      )}
      <Text style={[styles.fine, { color: c.textTertiary }]}>Uygunsuz içeriği ücret ödemeden bildirebilirsin.</Text>
    </Sheet>
  );
}

/** 1-Gold gift (REQ-GLD-05): exactly one Gold per confirmation; no quantity control exists. */
export function GiftSheet({ visible, onClose, onConfirm, balance, recipientLabel }: {
  visible: boolean; onClose: () => void; onConfirm: () => void; balance: number; recipientLabel: string;
}) {
  const { c } = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} title="1 Gold gönder">
      <View style={styles.giftHero}>
        <GoldCoin size={56} />
        <Text style={[styles.giftTo, { color: c.textSecondary }]}>{recipientLabel} kişisine</Text>
      </View>
      <Rows rows={[['Bakiye', `${balance} → ${balance - 1} Gold`]]} />
      <Primary label="1 Gold gönder" coin onPress={onConfirm} disabled={balance < 1} />
    </Sheet>
  );
}

/** Shuffle filter (S10): Standard sees district + ALL only; city and gender filters are visibly locked → paywall. */
export type ShuffleFilter = { mode: 'DISTRICT' | 'CITY'; gender: 'ALL' | 'FEMALE' | 'MALE' };

/** Filters are applied only on "Uygula"; Standard users see locked chips that route to the paywall (A§1). */
export function FilterSheet({ visible, onClose, isPlus, value, onApply, districtLabel }: {
  visible: boolean; onClose: () => void; isPlus: boolean; value: ShuffleFilter; onApply: (f: ShuffleFilter) => void; districtLabel: string;
}) {
  const { c } = useTheme();
  const [draft, setDraft] = useState<ShuffleFilter>(value);
  useEffect(() => { if (visible) setDraft(value); }, [visible, value]);
  const toPaywall = () => { onClose(); router.push('/plus'); };
  const pick = (f: Partial<ShuffleFilter>) => (isPlus ? setDraft((d) => ({ ...d, ...f })) : toPaywall());
  return (
    <Sheet visible={visible} onClose={onClose} title="Filtreler">
      <Text style={[styles.group, { color: c.textTertiary }]}>BÖLGE</Text>
      <View style={styles.chips}>
        <Chip label={districtLabel} active={draft.mode === 'DISTRICT'} onPress={() => setDraft((d) => ({ ...d, mode: 'DISTRICT' }))} />
        <Chip label="Tüm şehir" active={draft.mode === 'CITY'} locked={!isPlus} onPress={() => pick({ mode: 'CITY' })} />
      </View>
      <Text style={[styles.group, { color: c.textTertiary }]}>GÖSTER</Text>
      <View style={styles.chips}>
        <Chip label="Herkes" active={draft.gender === 'ALL'} onPress={() => setDraft((d) => ({ ...d, gender: 'ALL' }))} />
        <Chip label="Kadın" active={draft.gender === 'FEMALE'} locked={!isPlus} onPress={() => pick({ gender: 'FEMALE' })} />
        <Chip label="Erkek" active={draft.gender === 'MALE'} locked={!isPlus} onPress={() => pick({ gender: 'MALE' })} />
      </View>
      <Primary label="Uygula" onPress={() => { onApply(draft); onClose(); }} />
    </Sheet>
  );
}

function Rows({ rows }: { rows: [string, string][] }) {
  const { c } = useTheme();
  return (
    <View style={[styles.rows, { backgroundColor: c.raised }]}>
      {rows.map(([k, v]) => (
        <View key={k} style={styles.row}>
          <Text style={[styles.k, { color: c.textTertiary }]}>{k}</Text>
          <Text style={[styles.v, { color: c.textPrimary }]}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

function Primary({ label, onPress, coin, disabled }: { label: string; onPress: () => void; coin?: boolean; disabled?: boolean }) {
  const { c } = useTheme();
  return (
    <PressableScale accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} haptic="medium" onPress={onPress}
      style={[styles.primary, { backgroundColor: c.brand, opacity: disabled ? 0.5 : 1 }]}>
      {coin ? <GoldCoin size={18} inverted /> : null}
      <Text style={[styles.primaryText, { color: c.onBrand }]}>{label}</Text>
    </PressableScale>
  );
}

function Chip({ label, active, locked, onPress }: { label: string; active?: boolean; locked?: boolean; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <PressableScale haptic={locked ? 'none' : 'selection'} accessibilityRole="button" accessibilityState={{ selected: !!active, disabled: !!locked }}
      accessibilityHint={locked ? 'Plus ile açılır' : undefined} onPress={onPress}
      style={[styles.chip, { backgroundColor: active ? c.brand : c.raised, borderColor: active ? c.brand : c.hairline }]}>
      {locked ? <Ionicons name="lock-closed" size={13} color={c.plusText} /> : null}
      <Text style={[styles.chipText, { color: active ? c.onBrand : c.textPrimary }]}>{label}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  rows: { borderRadius: radius.card, padding: space.l, gap: space.m },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space.m },
  k: { fontFamily: fonts.medium, fontSize: typeScale.bodySmall.size },
  v: { fontFamily: fonts.semibold, fontSize: typeScale.bodySmall.size, flexShrink: 1, textAlign: 'right' },
  primary: { minHeight: 54, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryText: { fontFamily: fonts.bold, fontSize: typeScale.body.size },
  warn: { fontFamily: fonts.semibold, fontSize: typeScale.bodySmall.size },
  fine: { fontFamily: fonts.medium, fontSize: typeScale.caption.size, textAlign: 'center' },
  giftHero: { alignItems: 'center', gap: space.s },
  giftTo: { fontFamily: fonts.medium, fontSize: typeScale.body.size },
  group: { fontFamily: fonts.bold, fontSize: typeScale.label.size, letterSpacing: 1, marginBottom: -space.s },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: size.hitTarget - 4, paddingHorizontal: 16, borderRadius: radius.pill, borderWidth: 1 },
  chipText: { fontFamily: fonts.semibold, fontSize: typeScale.bodySmall.size },
});
