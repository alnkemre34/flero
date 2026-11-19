import { radius, space, type as typeScale } from '@flero/ui-tokens';
import Ionicons from '@expo/vector-icons/Ionicons';
import { FlashList } from '@shopify/flash-list';
import type { ThemeName } from '@flero/ui-tokens';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressableScale } from '@/design/motion';
import { goBack } from '@/design/nav';
import { ForceTheme, fonts, useTheme } from '@/design/theme';
import { DiscoveryCard, type DiscoveryCardData } from '@/features/shuffle/card/DiscoveryCard';

/**
 * Discovery Card Showcase — a DEVELOPMENT screen with sample data (not shown to users).
 *   1. the same profile in all three designs (+ Boost card of a Plus member), for a fair comparison
 *   2. a sample list: 10 profiles (3 Boost, 3 Plus, 4 Standard), or 50 / 100 for scrolling checks
 * Theme switch renders everything dark or light. The list order is the array order — nothing is sorted here.
 */
const SAME: Omit<DiscoveryCardData, 'placement' | 'membership'> = {
  id: 'usr_showcaseelif000000000000', name: 'Elif', gender: 'FEMALE', districtKey: 'geo.district.kadikoy', cityKey: 'geo.city.istanbul', avatarUrl: null,
};
const COMPARE: { label: string; data: DiscoveryCardData }[] = [
  { label: 'BOOST · öne çıkan yerleşim (sunucu kararı)', data: { ...SAME, placement: 'BOOST_BLOCK', membership: 'STANDARD' } },
  { label: 'PLUS · üye', data: { ...SAME, placement: 'DISCOVERY', membership: 'PLUS' } },
  { label: 'STANDART', data: { ...SAME, placement: 'DISCOVERY', membership: 'STANDARD' } },
  { label: 'BOOST + Plus üye · ikincil taç işareti', data: { ...SAME, id: 'usr_showcaseelifplus000000000', placement: 'BOOST_BLOCK', membership: 'PLUS' } },
];

const PEOPLE: [string, 'FEMALE' | 'MALE', string][] = [
  ['Deniz', 'FEMALE', 'kadikoy'], ['Kerem', 'MALE', 'besiktas'], ['Şebnem Çağlayan-Öztürk', 'FEMALE', 'kadikoy'],
  ['Mert', 'MALE', 'uskudar'], ['İpek', 'FEMALE', 'kadikoy'], ['Ilgaz', 'MALE', 'kadikoy'],
  ['Gülşen', 'FEMALE', 'sisli'], ['Barış', 'MALE', 'kadikoy'], ['Ümran', 'FEMALE', 'kadikoy'], ['Can', 'MALE', 'esenyurt'],
];
/** 3 Boost, 3 Plus, 4 Standard for the first 10 (a demo mix, not a Shuffle ordering rule), then repeating. */
function sample(n: number): DiscoveryCardData[] {
  return Array.from({ length: n }, (_, i) => {
    const [name, gender, district] = PEOPLE[i % PEOPLE.length]!;
    const slot = i % 10;
    return {
      id: `usr_demo${String(i).padStart(4, '0')}`, name, gender, districtKey: `geo.district.${district}`, cityKey: 'geo.city.istanbul', avatarUrl: null,
      placement: slot < 3 ? 'BOOST_BLOCK' : 'DISCOVERY', membership: slot === 1 || (slot >= 3 && slot < 6) ? 'PLUS' : 'STANDARD',
    };
  });
}

export default function CardShowcase() {
  const outer = useTheme();
  const [theme, setTheme] = useState<ThemeName>(outer.name);
  const [count, setCount] = useState(10);
  return (
    <ForceTheme name={theme}>
      <Showcase theme={theme} setTheme={setTheme} count={count} setCount={setCount} />
    </ForceTheme>
  );
}

function Showcase({ theme, setTheme, count, setCount }: { theme: ThemeName; setTheme: (t: ThemeName) => void; count: number; setCount: (n: number) => void }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const rows = useMemo(() => sample(count), [count]);
  const [opened, setOpened] = useState<string | null>(null);
  const open = useCallback((id: string) => setOpened(id), []);

  const Seg = <T extends string | number>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) => (
    <View style={[styles.seg, { backgroundColor: c.surface, borderColor: c.hairline }]} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map(([v, l]) => (
        <PressableScale key={String(v)} haptic="selection" accessibilityRole="radio" accessibilityState={{ selected: v === value }} onPress={() => onChange(v)}
          style={[styles.segBtn, v === value && { backgroundColor: c.raised }]}>
          <Text style={[styles.segText, { color: v === value ? c.textPrimary : c.textSecondary }]}>{l}</Text>
        </PressableScale>
      ))}
    </View>
  );

  const header = (
    <View>
      <View style={[styles.top, { paddingTop: insets.top + space.s }]}>
        <PressableScale accessibilityRole="button" accessibilityLabel="Geri" onPress={() => goBack('/profilim')} style={styles.back}>
          <Ionicons name="chevron-back" size={24} color={c.textPrimary} />
        </PressableScale>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: c.textPrimary }]} accessibilityRole="header">Kart vitrini</Text>
          <Text style={[styles.sub, { color: c.textTertiary }]}>Geliştirici ekranı · örnek veriler</Text>
        </View>
      </View>
      <View style={styles.controls}>
        <Seg label="Tema" value={theme} onChange={setTheme} options={[['dark', 'Koyu'], ['light', 'Açık']]} />
      </View>
      <Text style={[styles.section, { color: c.textPrimary }]}>Aynı profil, üç tasarım</Text>
      {COMPARE.map((x) => (
        <View key={x.label}>
          <Text style={[styles.label, { color: c.textTertiary }]}>{x.label}</Text>
          <DiscoveryCard data={x.data} onPress={open} />
        </View>
      ))}
      <View style={styles.listHead}>
        <Text style={[styles.section, { color: c.textPrimary, marginHorizontal: 0 }]}>Örnek liste</Text>
        <Seg label="Profil sayısı" value={count} onChange={setCount} options={[[10, '10'], [50, '50'], [100, '100']]} />
      </View>
      <Text style={[styles.label, { color: c.textTertiary }]}>İlk 10: 3 Boost · 3 Plus (biri Boost'ta) · 4 Standart. Sıra dizideki sıradır; hiçbir sıralama yapılmaz.</Text>
      {opened ? <Text style={[styles.label, { color: c.brandText }]} accessibilityLiveRegion="polite">Dokunuldu: {opened} (gerçek listede bu profil açılır)</Text> : null}
    </View>
  );

  return (
    <View style={[styles.fill, { backgroundColor: c.canvas }]}>
      <FlashList
        data={rows}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => <DiscoveryCard data={item} onPress={open} />}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.s, paddingHorizontal: space.s, paddingBottom: space.m },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.displayHeavy, fontSize: typeScale.title1.size, lineHeight: typeScale.title1.line },
  sub: { fontFamily: fonts.medium, fontSize: typeScale.caption.size + 1 },
  controls: { paddingHorizontal: space.gutter, marginBottom: space.l },
  section: { fontFamily: fonts.display, fontSize: typeScale.title2.size, lineHeight: typeScale.title2.line, marginHorizontal: space.gutter, marginBottom: space.s },
  label: { fontFamily: fonts.medium, fontSize: typeScale.caption.size + 1, marginHorizontal: space.gutter, marginBottom: 6, lineHeight: 18 },
  listHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.m, paddingHorizontal: space.gutter, marginTop: space.xl, marginBottom: space.s },
  seg: { flexDirection: 'row', padding: 3, borderRadius: radius.pill, borderWidth: 1 },
  segBtn: { minWidth: 56, minHeight: 34, paddingHorizontal: space.m, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  segText: { fontFamily: fonts.semibold, fontSize: typeScale.bodySmall.size },
});
