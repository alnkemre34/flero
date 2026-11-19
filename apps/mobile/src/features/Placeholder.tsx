import { space, type as typeScale } from '@flero/ui-tokens';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts, useTheme } from '@/design/theme';
import { t } from '@/i18n/tr';

/** Shell placeholder for tabs whose screens land in later milestones (doc 19). */
export function Placeholder({ titleKey, children }: { titleKey: string; children?: ReactNode }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top + space.m }]}>
      <Text style={[styles.title, { color: c.textPrimary }]}>{t(titleKey)}</Text>
      <Text style={[styles.body, { color: c.textSecondary }]}>{t('soon')}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: space.gutter, gap: space.m },
  title: { fontFamily: fonts.bold, fontSize: typeScale.title1.size, lineHeight: typeScale.title1.line },
  body: { fontFamily: fonts.regular, fontSize: typeScale.body.size, lineHeight: typeScale.body.line },
});
