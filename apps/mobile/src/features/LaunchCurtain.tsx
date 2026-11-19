import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, useColorScheme, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { BrandMark, SPLASH_MARK } from '@/design/Brand';

// The native splash must stay until the curtain below is on screen (no blank frame between the two).
void SplashScreen.preventAutoHideAsync().catch(() => {});

/** Same colours as the native splash (app.json → expo-splash-screen), so the hand-off is invisible. */
const SPLASH_BG = { light: '#F7F7F5', dark: '#0A0A0F' } as const;
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

/**
 * Launch curtain: a pixel-identical copy of the native splash drawn by the app. It replaces the native splash as
 * soon as JS runs, holds while the session is restored (keychain, device cache), then lifts: the mark eases up a
 * touch and fades while the curtain dissolves into the first screen. Reduced Motion: a plain short fade.
 * If restoring takes unusually long, a quiet spinner appears under the mark instead of a frozen screen.
 */
export function LaunchCurtain({ ready }: { ready: boolean }) {
  const scheme = useColorScheme() === 'light' ? 'light' : 'dark';
  const reduced = useReducedMotion();
  const [gone, setGone] = useState(false);
  const [slow, setSlow] = useState(false);
  const curtain = useSharedValue(1);
  const mark = useSharedValue(0);

  useEffect(() => { const t = setTimeout(() => setSlow(true), 2_500); return () => clearTimeout(t); }, []);
  useEffect(() => {
    if (!ready) return;
    const done = () => setGone(true);
    if (reduced) {
      curtain.set(withTiming(0, { duration: 180 }, (f) => { if (f) scheduleOnRN(done); }));
      return;
    }
    mark.set(withTiming(1, { duration: 320, easing: EASE_OUT }));
    curtain.set(withTiming(0, { duration: 380, easing: EASE_OUT }, (f) => { if (f) scheduleOnRN(done); }));
  }, [ready, reduced, curtain, mark]);

  const curtainStyle = useAnimatedStyle(() => ({ opacity: curtain.get() }));
  const markStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -10 * mark.get() }, { scale: 1 + 0.04 * mark.get() }] }));

  if (gone) return null;
  return (
    <Animated.View pointerEvents={ready ? 'none' : 'auto'} style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: SPLASH_BG[scheme] }, curtainStyle]}
      onLayout={() => { void SplashScreen.hideAsync().catch(() => {}); }} accessibilityElementsHidden={ready} importantForAccessibility={ready ? 'no-hide-descendants' : 'auto'}>
      <Animated.View style={markStyle}><BrandMark size={SPLASH_MARK} /></Animated.View>
      {slow && !ready ? <View style={styles.spinner}><ActivityIndicator color={scheme === 'dark' ? '#D4FF3A' : '#3F5A00'} /></View> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  spinner: { position: 'absolute', bottom: '28%' },
});
