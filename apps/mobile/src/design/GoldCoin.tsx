import { StyleSheet, Text, View } from 'react-native';
import { fonts, useTheme } from './theme';

/** FLERO Gold mark: a warm coin with "G". Deliberately not a crypto/cash symbol (no cash value, master §7). */
export function GoldCoin({ size = 16, inverted = false }: { size?: number; inverted?: boolean }) {
  const { c } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.coin, { width: size, height: size, borderRadius: size / 2, backgroundColor: inverted ? c.onGoldFill : c.goldFill, borderColor: inverted ? c.goldFill : '#E0A300' }]}
    >
      <Text style={{ fontFamily: fonts.displayHeavy, fontSize: size * 0.62, lineHeight: size * 0.8, color: inverted ? c.goldFill : c.onGoldFill }}>G</Text>
    </View>
  );
}

const styles = StyleSheet.create({ coin: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 } });
