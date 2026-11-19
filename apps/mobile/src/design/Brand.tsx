import { Image, StyleSheet, Text, View, type ImageStyle, type StyleProp } from 'react-native';
import { fonts, useTheme } from './theme';

/**
 * The in-app logo. It is generated from assets/brand/source/logo.png by scripts/brand-assets.mjs, so replacing the
 * logo is one file + one script run (see assets/brand/README.md); no screen needs to change.
 */
const MARK = require('../../assets/brand/generated/logo-mark.png') as number;

/** Size of the mark on the native splash (app.json → expo-splash-screen imageWidth). Keep them equal. */
export const SPLASH_MARK = 120;

export function BrandMark({ size = 64, style }: { size?: number; style?: StyleProp<ImageStyle> }) {
  return <Image source={MARK} style={[{ width: size, height: size }, style]} resizeMode="contain" accessibilityIgnoresInvertColors accessibilityLabel="FLERO" />;
}

/** Mark + wordmark, for places that introduce the product. */
export function BrandLockup({ size = 40 }: { size?: number }) {
  const { c } = useTheme();
  return (
    <View style={styles.row} accessible accessibilityLabel="FLERO">
      <BrandMark size={size} />
      <Text style={[styles.word, { color: c.textPrimary, fontSize: size * 0.62 }]}>FLERO</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  word: { fontFamily: fonts.displayHeavy, letterSpacing: 1.5 },
});
