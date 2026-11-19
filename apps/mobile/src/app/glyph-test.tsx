import { space } from '@flero/ui-tokens';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { fonts, useTheme } from '@/design/theme';

/**
 * Turkish glyph render test (doc 14 §3 gate): every weight of Manrope and Fraunces with the letters that
 * fail most often (dotted/dotless i, ğ, ş) plus locale-correct casing. Screenshot on iOS + Android at M1.3.
 */
const SAMPLES = [
  'ğ ş ı İ I i ç ö ü Ğ Ş Ç Ö Ü',
  'Şebnem Çağlayan-Öztürk · Ilgaz · İpek · Gülşen',
  'Kadıköy · Beşiktaş · Üsküdar · Şişli',
];
const CASING = [
  ['istanbul', 'istanbul'.toLocaleUpperCase('tr-TR')],
  ['ILGAZ', 'ILGAZ'.toLocaleLowerCase('tr-TR')],
  ['Öne çıkan', 'Öne çıkan'.toLocaleUpperCase('tr-TR')],
] as const;

export default function GlyphTest() {
  const { c } = useTheme();
  const families = [fonts.regular, fonts.semibold, fonts.bold, fonts.display];
  return (
    <ScrollView contentContainerStyle={styles.root} style={{ backgroundColor: c.canvas }}>
      {families.map((family) => (
        <View key={family} style={[styles.block, { borderColor: c.hairline, backgroundColor: c.surface }]}>
          <Text style={[styles.label, { color: c.textTertiary }]}>{family}</Text>
          {SAMPLES.map((s) => (
            <Text key={s} style={{ fontFamily: family, fontSize: 20, lineHeight: 28, color: c.textPrimary }}>{s}</Text>
          ))}
        </View>
      ))}
      <View style={[styles.block, { borderColor: c.hairline, backgroundColor: c.surface }]}>
        <Text style={[styles.label, { color: c.textTertiary }]}>toLocale…Case('tr-TR')</Text>
        {CASING.map(([from, to]) => (
          <Text key={from} style={{ fontFamily: fonts.semibold, fontSize: 18, color: c.textPrimary }}>{from} → {to}</Text>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { padding: space.gutter, gap: space.m },
  block: { borderWidth: 1, borderRadius: 14, padding: space.l, gap: space.xs },
  label: { fontFamily: fonts.regular, fontSize: 12 },
});
