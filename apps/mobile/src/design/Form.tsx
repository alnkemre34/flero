import { radius, size, space, type as typeScale } from '@flero/ui-tokens';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Href } from 'expo-router';
import { forwardRef, useState, type ComponentRef, type ReactNode } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps,
} from 'react-native';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { easeOut, PressableScale } from './motion';
import { fonts, useTheme } from './theme';
import { goBack } from '@/design/nav';

export type TInput = ComponentRef<typeof TextInput>;

/** Onboarding / auth scaffold: step indicator, large title, keyboard-safe scroll, sticky primary action. */
export function FormScreen({ step, total, title, subtitle, children, footer, back = true, backTo = '/welcome', onBack }: {
  step?: number; total?: number; title: string; subtitle?: string; children: ReactNode; footer: ReactNode; back?: boolean; backTo?: Href;
  /** replaces the default navigation back (e.g. confirm before leaving onboarding) */
  onBack?: () => void;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const enter = reduced ? FadeIn.duration(150) : FadeInDown.duration(320).easing(easeOut).withInitialValues({ transform: [{ translateY: 10 }] });
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.canvas }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.top, { paddingTop: insets.top + space.s }]}>
        {back ? (
          <PressableScale haptic="selection" accessibilityRole="button" accessibilityLabel="Geri" onPress={() => (onBack ? onBack() : goBack(backTo))} style={styles.back}>
            <Ionicons name="chevron-back" size={24} color={c.textPrimary} />
          </PressableScale>
        ) : <View style={styles.back} />}
        {step !== undefined && total !== undefined && (
          <View style={styles.steps} accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: total, now: step }} accessibilityLabel={`Adım ${step} / ${total}`}>
            {Array.from({ length: total }, (_, i) => (
              <View key={i} style={[styles.stepDot, { backgroundColor: i < step ? c.brand : c.raised, flex: i === step - 1 ? 2 : 1 }]} />
            ))}
          </View>
        )}
      </View>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Animated.View entering={enter} style={{ gap: space.s, marginBottom: space.xxl }}>
          <Text style={[styles.title, { color: c.textPrimary }]} accessibilityRole="header">{title}</Text>
          {subtitle && <Text style={[styles.subtitle, { color: c.textSecondary }]}>{subtitle}</Text>}
        </Animated.View>
        <Animated.View entering={reduced ? FadeIn.duration(150) : FadeInDown.duration(320).delay(60).easing(easeOut)} style={{ gap: space.l }}>{children}</Animated.View>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space.l) }]}>{footer}</View>
    </KeyboardAvoidingView>
  );
}

export const Field = forwardRef<TInput, TextInputProps & { label: string; error?: string | null; hint?: string; secure?: boolean }>(
  function Field({ label, error, hint, secure, style, ...p }, ref) {
    const { c } = useTheme();
    const [focus, setFocus] = useState(false);
    const [hidden, setHidden] = useState(true);
    return (
      <View style={{ gap: 6 }}>
        <Text style={[styles.label, { color: c.textSecondary }]}>{label}</Text>
        <View style={[styles.inputWrap, { backgroundColor: c.surface, borderColor: error ? c.danger : focus ? c.brandText : c.hairline }]}>
          <TextInput
            ref={ref}
            {...p}
            secureTextEntry={secure && hidden}
            accessibilityLabel={label}
            accessibilityHint={error ?? hint}
            placeholderTextColor={c.textTertiary}
            onFocus={(e) => { setFocus(true); p.onFocus?.(e); }}
            onBlur={(e) => { setFocus(false); p.onBlur?.(e); }}
            style={[styles.input, { color: c.textPrimary }, style]}
          />
          {secure && (
            <PressableScale haptic="none" accessibilityRole="button" accessibilityLabel={hidden ? 'Şifreyi göster' : 'Şifreyi gizle'} onPress={() => setHidden((h) => !h)} style={styles.eye}>
              <Ionicons name={hidden ? 'eye-outline' : 'eye-off-outline'} size={20} color={c.textTertiary} />
            </PressableScale>
          )}
        </View>
        {error ? <Text style={[styles.hint, { color: c.danger }]} accessibilityLiveRegion="polite">{error}</Text> : hint ? <Text style={[styles.hint, { color: c.textTertiary }]}>{hint}</Text> : null}
      </View>
    );
  },
);

export function PrimaryButton({ label, onPress, busy, disabled, variant = 'brand' }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean; variant?: 'brand' | 'ghost' }) {
  const { c } = useTheme();
  const off = disabled || busy;
  return (
    <PressableScale
      haptic="medium" accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off} onPress={onPress}
      style={[styles.primary, variant === 'brand' ? { backgroundColor: c.brand, opacity: off && !busy ? 0.45 : 1 } : { backgroundColor: 'transparent' }]}
    >
      {busy ? <ActivityIndicator color={variant === 'brand' ? c.onBrand : c.textPrimary} /> : (
        <Text style={[styles.primaryText, { color: variant === 'brand' ? c.onBrand : c.textPrimary }]}>{label}</Text>
      )}
    </PressableScale>
  );
}

export function ErrorBanner({ text }: { text: string | null }) {
  const { c } = useTheme();
  if (!text) return null;
  return (
    <Animated.View entering={FadeIn.duration(160)} style={[styles.error, { borderColor: c.danger, backgroundColor: c.surface }]} accessibilityLiveRegion="assertive" accessibilityRole="alert">
      <Ionicons name="alert-circle" size={18} color={c.danger} />
      <Text style={[styles.errorText, { color: c.textPrimary }]}>{text}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: space.m, paddingHorizontal: space.s },
  back: { width: size.hitTarget, height: size.hitTarget, alignItems: 'center', justifyContent: 'center' },
  steps: { flex: 1, flexDirection: 'row', gap: 6, marginRight: space.gutter },
  stepDot: { height: 4, borderRadius: 2 },
  body: { padding: space.gutter, paddingTop: space.xl },
  title: { fontFamily: fonts.displayHeavy, fontSize: typeScale.display.size, lineHeight: typeScale.display.line, letterSpacing: -0.8 },
  subtitle: { fontFamily: fonts.regular, fontSize: typeScale.body.size, lineHeight: typeScale.body.line },
  label: { fontFamily: fonts.semibold, fontSize: typeScale.bodySmall.size },
  inputWrap: { flexDirection: 'row', alignItems: 'center', minHeight: 54, borderRadius: radius.s + 6, borderWidth: 1.5, paddingHorizontal: space.l },
  input: { flex: 1, fontFamily: fonts.medium, fontSize: typeScale.body.size + 1, paddingVertical: space.m },
  eye: { width: size.hitTarget, height: size.hitTarget, alignItems: 'center', justifyContent: 'center', marginRight: -space.m },
  hint: { fontFamily: fonts.medium, fontSize: typeScale.caption.size },
  footer: { paddingHorizontal: space.gutter, paddingTop: space.m, gap: space.s },
  primary: { minHeight: 56, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontFamily: fonts.bold, fontSize: typeScale.body.size + 1 },
  error: { flexDirection: 'row', gap: space.s, alignItems: 'center', padding: space.m, borderRadius: radius.s + 4, borderWidth: 1 },
  errorText: { flex: 1, fontFamily: fonts.medium, fontSize: typeScale.bodySmall.size },
});
