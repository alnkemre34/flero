import { motion } from '@flero/ui-tokens';
import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { Platform, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const [x1, y1, x2, y2] = motion.easing.out;
export const easeOut = Easing.bezier(x1, y1, x2, y2);

type HapticKind = 'light' | 'medium' | 'selection' | 'none';

/**
 * Press feedback (emil-design-eng): scale to 0.97 on press with a stiff spring (interruptible, runs on the UI
 * thread), snap back on release. Under Reduced Motion: opacity dip instead of scale.
 */
export function PressableScale({
  children, style, haptic = 'light', scaleTo = motion.pressScale, ...rest
}: Omit<PressableProps, 'style'> & { children: ReactNode; style?: StyleProp<ViewStyle>; haptic?: HapticKind; scaleTo?: number }) {
  const reduced = useReducedMotion();
  const pressed = useSharedValue(0);
  const animated = useAnimatedStyle(() =>
    reduced
      ? { opacity: 1 - pressed.value * 0.15 }
      : { transform: [{ scale: 1 - pressed.value * (1 - scaleTo) }] },
  );
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => {
        pressed.value = withSpring(1, motion.spring.press);
        if (haptic !== 'none' && Platform.OS !== 'web') {
          if (haptic === 'selection') void Haptics.selectionAsync();
          else void Haptics.impactAsync(haptic === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
        }
        rest.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        pressed.value = withTiming(0, { duration: motion.duration.fast, easing: easeOut });
        rest.onPressOut?.(e);
      }}
      style={[style, animated]}
    >
      {children}
    </AnimatedPressable>
  );
}

/**
 * Entrance for the FIRST page only (choreograph): short, non-uniform stagger, 8 px rise + fade, strong ease-out.
 * Rows beyond `maxRows` and every row under Reduced Motion get a plain short fade (no movement).
 */
export function entering(index: number, reduced: boolean) {
  if (index >= motion.stagger.maxRows) return undefined;
  const delay = motion.stagger.stepMs.slice(0, index).reduce((a, b) => a + b, 0);
  if (reduced) return FadeIn.duration(motion.duration.reducedFade);
  return FadeInDown.duration(motion.duration.enter).delay(delay).easing(easeOut).withInitialValues({ transform: [{ translateY: 8 }] });
}
