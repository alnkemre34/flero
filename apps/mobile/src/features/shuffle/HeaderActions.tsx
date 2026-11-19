import type { Notification } from '@flero/contracts';
import { radius, space, type as typeScale } from '@flero/ui-tokens';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withSpring, withTiming, ZoomIn,
} from 'react-native-reanimated';
import type { z } from 'zod';
import { api } from '@/api/client';
import { PressableScale } from '@/design/motion';
import { fonts, useTheme } from '@/design/theme';

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

/**
 * Notification bell (top-right of Keşfet). Badge = unread count from the same ['notifications'] query the centre
 * uses, so realtime invalidation updates both. When a new notification arrives the bell rings once (a short
 * rotation, state indication) — never on mount, never under Reduced Motion.
 */
export function NotificationBell() {
  const { c } = useTheme();
  const reduced = useReducedMotion();
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api<z.infer<typeof Notification>[]>('/v1/notifications?limit=50').then((r) => r.data) });
  const unread = (q.data ?? []).filter((n) => !n.read).length;
  const tilt = useSharedValue(0);
  const prev = useSharedValue(-1);
  useEffect(() => {
    if (prev.get() >= 0 && unread > prev.get() && !reduced) {
      tilt.set(withSequence(withTiming(14, { duration: 90 }), withTiming(-11, { duration: 110 }), withTiming(6, { duration: 100 }), withSpring(0, { duration: 300, dampingRatio: 0.6 })));
    }
    prev.set(unread);
  }, [unread, reduced, tilt, prev]);
  const ring = useAnimatedStyle(() => ({ transform: [{ rotate: `${tilt.get()}deg` }] }));
  const label = unread ? `Bildirimler, ${unread} okunmamış` : 'Bildirimler';
  return (
    <PressableScale haptic="selection" accessibilityRole="button" accessibilityLabel={label} hitSlop={6}
      onPress={() => router.push('/bildirimler')} style={[styles.round, { backgroundColor: c.surface, borderColor: c.hairline }]}>
      <Animated.View style={ring}><Ionicons name={unread ? 'notifications' : 'notifications-outline'} size={21} color={c.textPrimary} /></Animated.View>
      {unread > 0 && (
        <Animated.View key={unread} entering={reduced ? undefined : ZoomIn.duration(220).easing(EASE_OUT).withInitialValues({ transform: [{ scale: 0.6 }] })}
          style={[styles.badge, { backgroundColor: c.brand, borderColor: c.canvas }]}>
          <Text style={[styles.badgeText, { color: c.onBrand }]} maxFontSizeMultiplier={1.2}>{unread > 9 ? '9+' : unread}</Text>
        </Animated.View>
      )}
    </PressableScale>
  );
}

/**
 * Shuffle button: asks the server for a brand-new independent batch (A§0.1.9 — no memory between requests).
 * Feedback on press-in (scale via PressableScale + haptic); the icon spins while the batch is on its way and
 * settles with an ease-out when it lands. The previous list stays visible until then (no skeleton flash).
 */
export function ShuffleButton({ onPress, busy }: { onPress: () => void; busy: boolean }) {
  const { c } = useTheme();
  const reduced = useReducedMotion();
  const spin = useSharedValue(0);
  useEffect(() => {
    if (busy && !reduced) {
      spin.set(withRepeat(withTiming(spin.get() + 360, { duration: 700, easing: Easing.linear }), -1, false));
    } else {
      cancelAnimation(spin);
      spin.set(withTiming(Math.ceil(spin.get() / 180) * 180, { duration: 260, easing: EASE_OUT }));
    }
  }, [busy, reduced, spin]);
  const icon = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.get()}deg` }] }));
  return (
    <PressableScale haptic="medium" accessibilityRole="button" accessibilityLabel="Karıştır, yeni kişiler getir"
      accessibilityState={{ busy }} aria-busy={busy} disabled={busy} onPress={onPress} style={[styles.fabWrap, styles.fabShadow]}>
      <LinearGradient colors={[c.brand, '#B8F01E']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fab}>
        <Animated.View style={icon}><Ionicons name="shuffle" size={22} color={c.onBrand} /></Animated.View>
        <Text style={[styles.fabText, { color: c.onBrand }]}>{busy ? 'Karıştırılıyor…' : 'Karıştır'}</Text>
      </LinearGradient>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  round: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -3, right: -3, minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontFamily: fonts.bold, fontSize: 10, lineHeight: 12 },
  fabWrap: { borderRadius: radius.pill },
  fabShadow: Platform.select({
    ios: { shadowColor: '#D4FF3A', shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
    android: { elevation: 8 },
    web: { boxShadow: '0 10px 30px -8px rgba(212,255,58,0.55)' } as object,
    default: {},
  }) as object,
  fab: { flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 54, paddingHorizontal: space.xl + 2, borderRadius: radius.pill },
  fabText: { fontFamily: fonts.bold, fontSize: typeScale.body.size },
});
