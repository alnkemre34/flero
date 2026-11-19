import { space, type as typeScale } from '@flero/ui-tokens';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandMark } from '@/design/Brand';
import { PrimaryButton } from '@/design/Form';
import { easeOut } from '@/design/motion';
import { fonts, useTheme } from '@/design/theme';

/** S01 Welcome — one promise, two actions. The hero choreography plays once; Reduced Motion gets fades. */
export default function Welcome() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const rise = (d: number) => (reduced ? FadeIn.duration(150) : FadeInDown.duration(480).delay(d).easing(easeOut).withInitialValues({ transform: [{ translateY: 16 }] }));
  return (
    <View style={[styles.fill, { backgroundColor: c.canvas }]}>
      <LinearGradient colors={[c.plusFrameFrom, 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 0.7, y: 0.6 }} style={[StyleSheet.absoluteFill, { opacity: 0.22 }]} />
      <View style={[styles.hero, { paddingTop: insets.top + space.huge * 2 }]}>
        <Animated.View entering={rise(0)}><BrandMark size={72} /></Animated.View>
        <Animated.Text entering={rise(90)} style={[styles.title, { color: c.textPrimary }]} accessibilityRole="header">Yakınındaki insanlarla, kendi hızında tanış.</Animated.Text>
        <Animated.Text entering={rise(170)} style={[styles.body, { color: c.textSecondary }]}>
          İlk mesajı anonim gönder. Kim olduğunu ne zaman göstereceğine sen karar ver.
        </Animated.Text>
      </View>
      <Animated.View entering={rise(260)} style={[styles.actions, { paddingBottom: insets.bottom + space.l }]}>
        <PrimaryButton label="Hesap oluştur" onPress={() => router.push('/signup')} />
        <PrimaryButton label="Zaten hesabım var" variant="ghost" onPress={() => router.push('/login')} />
        <Text style={[styles.legal, { color: c.textTertiary }]}>Devam ederek 18 yaşından büyük olduğunu onaylarsın.</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hero: { flex: 1, paddingHorizontal: space.gutter + 4, gap: space.xl },
  title: { fontFamily: fonts.displayHeavy, fontSize: typeScale.hero.size, lineHeight: typeScale.hero.line, letterSpacing: -1.2 },
  body: { fontFamily: fonts.regular, fontSize: typeScale.body.size + 1, lineHeight: 25, maxWidth: 340 },
  actions: { paddingHorizontal: space.gutter, gap: space.s },
  legal: { fontFamily: fonts.medium, fontSize: typeScale.caption.size, textAlign: 'center', marginTop: space.s },
});
