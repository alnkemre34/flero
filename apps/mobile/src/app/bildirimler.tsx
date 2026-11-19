import type { Notification } from '@flero/contracts';
import { space, type as typeScale } from '@flero/ui-tokens';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { z } from 'zod';
import { api, errorText } from '@/api/client';
import { entering, PressableScale } from '@/design/motion';
import { goBack } from '@/design/nav';
import { fonts, useTheme } from '@/design/theme';
import { t } from '@/i18n/tr';

/** Notification centre (S22). Copy is generic by design: no follower, liker or anonymous-sender identity (doc 09 §4). */
type N = z.infer<typeof Notification>;
const ICON: Partial<Record<N['type'], React.ComponentProps<typeof Ionicons>['name']>> = {
  MESSAGE_REQUEST: 'mail-unread', GOLD_GIFT: 'gift', FOLLOW: 'person-add', LIKE: 'heart', FRIENDSHIP: 'people', PHOTO_UNLOCKED: 'lock-open',
  PHOTO_RECEIVED: 'image', REQUEST_ACCEPTED: 'checkmark-circle', REVEAL: 'eye', PLUS_LIFECYCLE: 'sparkles', BOOST_LIFECYCLE: 'flash',
  WALLET: 'wallet', SECURITY: 'shield-checkmark', MODERATION: 'flag',
};
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (m < 60) return `${Math.max(1, m)} dk`;
  if (m < 1440) return `${Math.round(m / 60)} sa`;
  return m < 2880 ? 'Dün' : new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' }).format(new Date(iso));
};

export default function NotificationsScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api<N[]>('/v1/notifications?limit=50').then((r) => r.data) });
  const newest = q.data?.[0];

  // opening the centre marks everything up to the newest as read (one idempotent call)
  useEffect(() => {
    // badge clears once the server confirmed; the dots on screen fade on the next refresh
    if (newest && !newest.read) {
      void api('/v1/notifications/read', { body: { up_to_id: newest.notification_id } })
        .then(() => setTimeout(() => void qc.invalidateQueries({ queryKey: ['notifications'] }), 1500), () => {});
    }
  }, [newest, qc]);

  return (
    <ScrollView style={{ backgroundColor: c.canvas }} contentContainerStyle={{ paddingTop: insets.top + space.s, paddingBottom: space.huge }}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void qc.invalidateQueries({ queryKey: ['notifications'] })} tintColor={c.brandText} colors={[c.brandText]} />}>
      <PressableScale haptic="selection" accessibilityRole="button" accessibilityLabel="Geri" onPress={() => goBack('/')} style={styles.back}>
        <Ionicons name="chevron-back" size={24} color={c.textPrimary} />
      </PressableScale>
      <Text style={[styles.hero, { color: c.textPrimary }]} accessibilityRole="header">{t('notif.title')}</Text>
      {q.isPending && <ActivityIndicator style={{ margin: space.xl }} color={c.brandText} />}
      {q.isError && <Text style={[styles.empty, { color: c.textSecondary }]}>{errorText(q.error)}</Text>}
      {q.isSuccess && q.data.length === 0 && (
        <View style={styles.emptyBox}>
          <Ionicons name="notifications-outline" size={30} color={c.brandText} />
          <Text style={[styles.emptyTitle, { color: c.textPrimary }]}>Her şey sakin</Text>
          <Text style={[styles.empty, { color: c.textSecondary }]}>Takip, beğeni ve mesaj istekleri burada görünür.</Text>
        </View>
      )}
      {(q.data ?? []).map((n, i) => (
        <Animated.View key={n.notification_id} entering={entering(i, reduced)}>
          <PressableScale haptic="none" accessibilityRole={n.conversation_id ? 'button' : 'text'} disabled={!n.conversation_id}
            onPress={() => { if (n.conversation_id) router.push({ pathname: '/chat/[cid]', params: { cid: n.conversation_id } }); }}
            style={[styles.row, !n.read && { backgroundColor: c.surface }]}>
            <View style={[styles.icon, { backgroundColor: n.type === 'LIKE' ? '#FF4D6D22' : n.type === 'GOLD_GIFT' ? `${c.goldFill}26` : c.raised }]}>
              <Ionicons name={ICON[n.type] ?? 'notifications'} size={18} color={n.type === 'LIKE' ? '#FF4D6D' : n.type === 'GOLD_GIFT' ? c.goldText : c.textPrimary} />
            </View>
            <Text style={[styles.text, { color: c.textPrimary, fontFamily: n.read ? fonts.regular : fonts.semibold }]}>{t(`notif.${n.type}`)}</Text>
            <Text style={[styles.when, { color: c.textTertiary }]}>{ago(n.created_at)}</Text>
            {!n.read ? <View style={[styles.dot, { backgroundColor: c.brand }]} /> : null}
          </PressableScale>
        </Animated.View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: space.s },
  hero: { fontFamily: fonts.displayHeavy, fontSize: typeScale.hero.size, lineHeight: typeScale.hero.line, letterSpacing: -1, paddingHorizontal: space.gutter, marginBottom: space.l },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m, paddingHorizontal: space.gutter, paddingVertical: space.m + 2 },
  icon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, fontSize: typeScale.body.size - 1 },
  when: { fontFamily: fonts.medium, fontSize: typeScale.caption.size },
  dot: { width: 8, height: 8, borderRadius: 4 },
  emptyBox: { alignItems: 'center', gap: space.s, padding: space.xxl },
  emptyTitle: { fontFamily: fonts.display, fontSize: typeScale.title2.size },
  empty: { fontFamily: fonts.regular, fontSize: typeScale.bodySmall.size, textAlign: 'center', lineHeight: 20, paddingHorizontal: space.gutter },
});
