import { radius, space, type as typeScale } from '@flero/ui-tokens';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInUp, SlideOutUp, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { onRealtime } from '@/api/realtime';
import { useSession } from '@/api/session';
import { easeOut, PressableScale } from '@/design/motion';
import { fonts, useTheme } from '@/design/theme';
import { t } from '@/i18n/tr';

type Banner = { id: number; title: string; icon: React.ComponentProps<typeof Ionicons>['name']; href: string | null };
const ICON: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  MESSAGE_REQUEST: 'mail-unread', REQUEST_ACCEPTED: 'checkmark-circle', GOLD_GIFT: 'gift', FOLLOW: 'person-add', LIKE: 'heart',
  FRIENDSHIP: 'people', REVEAL: 'eye', PLUS_LIFECYCLE: 'sparkles', BOOST_LIFECYCLE: 'flash', WALLET: 'wallet', SECURITY: 'shield-checkmark', MODERATION: 'flag',
};

/**
 * In-app notification banner (foreground). Copy is the same generic text as the centre — never a name or a
 * message preview (doc 09 §4). Suppressed for the conversation already on screen. Auto-dismisses after 4 s,
 * can be swiped/tapped away, announced politely to screen readers.
 */
export function InAppBanner() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const { state } = useSession();
  const path = usePathname();
  const pathRef = useRef(path);
  pathRef.current = path;
  const [b, setB] = useState<Banner | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (state !== 'ready') return;
    return onRealtime((e) => {
      let next: Omit<Banner, 'id'> | null = null;
      if (e.t === 'notification.new') {
        const type = String(e.notification_type ?? '');
        next = { title: t(`notif.${type}`), icon: ICON[type] ?? 'notifications', href: '/bildirimler' };
      } else if (e.t === 'message.new' && e.conversation_id && !pathRef.current.includes(String(e.conversation_id))) {
        next = { title: t('notif.new_message'), icon: 'chatbubble-ellipses', href: `/chat/${e.conversation_id}` };
      }
      if (!next) return;
      const id = ++seq.current;
      setB({ id, ...next });
      setTimeout(() => setB((cur) => (cur?.id === id ? null : cur)), 4000);
    });
  }, [state]);

  if (!b) return null;
  return (
    <Animated.View key={b.id} entering={reduced ? FadeIn.duration(150) : SlideInUp.duration(320).easing(easeOut)} exiting={reduced ? FadeOut.duration(120) : SlideOutUp.duration(200)}
      style={[styles.wrap, { top: insets.top + space.s }]} pointerEvents="box-none" accessibilityLiveRegion="polite">
      {/* open + close are sibling buttons (a button inside a button is invalid on web and confuses screen readers) */}
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.hairline }]}>
        <PressableScale accessibilityRole="button" accessibilityLabel={`${b.title}. ${t('notif.open')}`}
          onPress={() => { setB(null); if (b.href) router.push(b.href as never); }} style={styles.open}>
          <View style={[styles.icon, { backgroundColor: c.raised }]}><Ionicons name={b.icon} size={18} color={c.brandText} /></View>
          <Text style={[styles.title, { color: c.textPrimary }]} numberOfLines={2}>{b.title}</Text>
        </PressableScale>
        <PressableScale haptic="none" accessibilityRole="button" accessibilityLabel="Kapat" onPress={() => setB(null)} style={styles.close}>
          <Ionicons name="close" size={18} color={c.textTertiary} />
        </PressableScale>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.m, right: space.m, zIndex: 100 },
  card: { flexDirection: 'row', alignItems: 'center', paddingRight: space.xs, borderRadius: radius.card, borderWidth: 1, minHeight: 60,
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontFamily: fonts.semibold, fontSize: typeScale.bodySmall.size + 1 },
  open: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.m, padding: space.m, minHeight: 60 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
