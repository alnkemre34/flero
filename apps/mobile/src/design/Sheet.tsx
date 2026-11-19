import { motion, radius, space, type as typeScale } from '@flero/ui-tokens';
import { useEffect, useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { PressableScale } from './motion';
import { fonts, useTheme } from './theme';

const [d1, d2, d3, d4] = motion.easing.drawer;
const drawer = Easing.bezier(d1, d2, d3, d4);

/**
 * Bottom sheet (emil-design-eng / gestures):
 *  - enters on the iOS drawer curve (420 ms), exits faster (200 ms ease-out);
 *  - tracks the finger 1:1 downward, rubber-bands upward (damping, no hard wall);
 *  - dismisses on distance OR velocity (a quick flick is enough), otherwise springs back — interruptible;
 *  - backdrop tap, the visible ✕ button, Escape (web) and Android back also dismiss; Reduced Motion = fades only;
 *  - the drag handle is the header (grabber + title), so scrolling long content never drags the sheet away;
 *  - content taller than the screen scrolls inside the sheet instead of running off the top.
 */
export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const y = useSharedValue(height);
  const fade = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      y.value = reduced ? 0 : height;
      fade.value = 0;
      requestAnimationFrame(() => {
        y.value = reduced ? 0 : withTiming(0, { duration: motion.duration.sheet, easing: drawer });
        fade.value = withTiming(1, { duration: reduced ? motion.duration.reducedFade : motion.duration.sheet, easing: drawer });
      });
    } else if (mounted) {
      const done = () => setMounted(false);
      fade.value = withTiming(0, { duration: motion.duration.exit });
      y.value = reduced ? 0 : withTiming(height, { duration: motion.duration.exit, easing: Easing.bezier(0.23, 1, 0.32, 1) });
      setTimeout(done, motion.duration.exit + 20);
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      y.value = e.translationY > 0 ? e.translationY : e.translationY * 0.2; // damping beyond the top edge
    })
    .onEnd((e) => {
      if (e.translationY > 120 || e.velocityY > 900) scheduleOnRN(onClose);
      else y.value = withSpring(0, motion.spring.sheet);
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }], opacity: reduced ? fade.value : 1 }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: fade.value * 0.6 }));

  if (!mounted) return null;
  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, backdropStyle]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Kapat" style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          style={[styles.sheet, { backgroundColor: c.surface, borderColor: c.hairline, maxHeight: height - insets.top - space.xl }, sheetStyle]}
        >
          <GestureDetector gesture={pan}>
            <View style={styles.header}>
              <View style={[styles.grabber, { backgroundColor: c.hairline }]} />
              <View style={styles.headRow}>
                {title ? <Text accessibilityRole="header" style={[styles.title, { color: c.textPrimary }]}>{title}</Text> : <View style={{ flex: 1 }} />}
                <PressableScale haptic="none" accessibilityRole="button" accessibilityLabel="Kapat" onPress={onClose} hitSlop={8}
                  style={[styles.close, { backgroundColor: c.raised }]}>
                  <Ionicons name="close" size={20} color={c.textSecondary} />
                </PressableScale>
              </View>
            </View>
          </GestureDetector>
          <ScrollView bounces={false} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
            contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.l }]}>
            {children}
          </ScrollView>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, borderWidth: 1, paddingTop: space.s, overflow: 'hidden' },
  header: { paddingHorizontal: space.gutter, paddingBottom: space.m },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, marginBottom: space.s },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.m },
  title: { flex: 1, fontFamily: fonts.displayHeavy, fontSize: typeScale.title1.size, lineHeight: typeScale.title1.line, letterSpacing: -0.4 },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  content: { paddingHorizontal: space.gutter, gap: space.l },
});
