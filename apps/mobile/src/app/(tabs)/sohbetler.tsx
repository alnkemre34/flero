import { radius, space, type as typeScale } from '@flero/ui-tokens';
import { router } from 'expo-router';
import type { InboxEntry } from '@flero/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { z } from 'zod';
import { api, errorText } from '@/api/client';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/design/Avatar';
import { entering, PressableScale } from '@/design/motion';
import { fonts, useTheme } from '@/design/theme';
import { t } from '@/i18n/tr';
import { useConnecting } from '@/features/chat/useConnecting';

/** Inbox (S13/S14). Rows render only from the counterparty projection: anonymous rows show no identity. */
export default function InboxScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [tab, setTab] = useState<'main' | 'requests'>('main');
  const connecting = useConnecting();
  // both lists are live queries; realtime events invalidate ['inbox'] so they refresh themselves
  const main = useQuery({ queryKey: ['inbox', 'main'], queryFn: () => api<Entry[]>('/v1/inbox?filter=main&limit=50').then((r) => r.data) });
  const reqs = useQuery({ queryKey: ['inbox', 'requests'], queryFn: () => api<Entry[]>('/v1/inbox?filter=requests&limit=50').then((r) => r.data) });
  const q = tab === 'main' ? main : reqs;
  const rows = (q.data ?? []).map((e) => ({ thread: e.conversation, preview: e.last_message_preview ?? (e.last_message_kind === 'PHOTO' ? 'Fotoğraf' : e.last_message_kind === 'GOLD_GIFT' ? '1 Gold' : ''), time: when(e.last_message_at), unread: e.unread_count }));
  const requestCount = reqs.data?.length ?? 0;
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => { setRefreshing(true); await Promise.all([main.refetch(), reqs.refetch()]); setRefreshing(false); };

  return (
    <ScrollView style={{ backgroundColor: c.canvas }} contentContainerStyle={{ paddingTop: insets.top + space.l, paddingBottom: space.huge }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.brandText} colors={[c.brandText]} />}>
      <Text style={[styles.hero, { color: c.textPrimary }]}>{t('inbox.title')}</Text>
      {connecting ? <Text style={[styles.connecting, { color: c.textTertiary }]} accessibilityLiveRegion="polite">Bağlanıyor… Kayıtlı sohbetlerin gösteriliyor.</Text> : null}
      <View style={[styles.segment, { backgroundColor: c.surface, borderColor: c.hairline }]}>
        {(['main', 'requests'] as const).map((k) => (
          <PressableScale key={k} haptic="selection" accessibilityRole="tab" accessibilityState={{ selected: tab === k }} onPress={() => setTab(k)}
            style={[styles.segBtn, tab === k && { backgroundColor: c.raised }]}>
            <Text style={[styles.segText, { color: tab === k ? c.textPrimary : c.textSecondary }]}>
              {k === 'main' ? t('inbox.main') : t('inbox.requests')}
            </Text>
            {k === 'requests' && requestCount > 0 ? (
              <View style={[styles.count, { backgroundColor: c.brand }]}><Text style={[styles.countText, { color: c.onBrand }]}>{requestCount}</Text></View>
            ) : null}
          </PressableScale>
        ))}
      </View>

      {q.isPending && Array.from({ length: 5 }, (_, i) => (
        <View key={i} style={styles.row}>
          <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: c.surface }} />
          <View style={{ flex: 1, gap: 8 }}><View style={{ height: 14, width: '45%', borderRadius: 7, backgroundColor: c.surface }} /><View style={{ height: 12, width: '70%', borderRadius: 6, backgroundColor: c.surface }} /></View>
        </View>
      ))}
      {q.isError && !q.data && <Text style={[styles.empty, { color: c.textSecondary }]}>{errorText(q.error)}</Text>}
      {q.isSuccess && rows.length === 0 && (
        <View style={styles.emptyBox}>
          <Text style={[styles.emptyTitle, { color: c.textPrimary }]}>{tab === 'main' ? 'Henüz sohbet yok' : 'İstek yok'}</Text>
          <Text style={[styles.empty, { color: c.textSecondary }]}>{tab === 'main' ? 'Keşfet’te birine ilk mesajı gönder; kimliğini sonra göstermek senin elinde.' : 'Sana yazan biri olduğunda burada görünür.'}</Text>
        </View>
      )}
      {rows.map((e, i) => {
        const cp = e.thread.counterparty;
        const anonymous = cp.kind === 'ANONYMOUS';
        const title = anonymous ? t('chat.anonymous_user') : cp.display_name;
        return (
          <Animated.View key={`${tab}:${e.thread.conversation_id}`} entering={entering(i, reduced)}>
            <PressableScale accessibilityRole="button" accessibilityLabel={`${title}, ${e.preview}`} onPress={() => router.push({ pathname: '/chat/[cid]', params: { cid: e.thread.conversation_id } })} style={styles.row}>
              <Avatar id={anonymous ? e.thread.conversation_id : cp.public_user_id} name={title} size={54} anonymous={anonymous} ring={e.unread ? 'promoted' : 'none'} uri={cp.kind === 'IDENTIFIED' ? cp.avatar?.url : null} />
              <View style={{ flex: 1, gap: 2 }}>
                <View style={styles.rowTop}>
                  <Text style={[styles.name, { color: c.textPrimary }]} numberOfLines={1}>{title}</Text>
                  <Text style={[styles.time, { color: e.unread ? c.brandText : c.textTertiary }]}>{e.time}</Text>
                </View>
                <View style={styles.rowTop}>
                  <Text style={[styles.preview, { color: e.unread ? c.textPrimary : c.textSecondary, fontFamily: e.unread ? fonts.semibold : fonts.regular }]} numberOfLines={1}>{e.preview}</Text>
                  {e.unread ? <View style={[styles.dot, { backgroundColor: c.brand }]}><Text style={[styles.dotText, { color: c.onBrand }]}>{e.unread}</Text></View> : null}
                </View>
              </View>
            </PressableScale>
          </Animated.View>
        );
      })}
    </ScrollView>
  );
}

type Entry = z.infer<typeof InboxEntry>;
const when = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days < 1 && new Date().getDate() === d.getDate()) return new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' }).format(d);
  if (days < 2) return 'Dün';
  return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' }).format(d);
};

const styles = StyleSheet.create({
  connecting: { fontFamily: fonts.medium, fontSize: typeScale.caption.size + 1, paddingHorizontal: space.gutter, marginTop: -space.s, marginBottom: space.m },
  emptyBox: { alignItems: 'center', gap: space.s, padding: space.xxl },
  emptyTitle: { fontFamily: fonts.display, fontSize: typeScale.title2.size },
  empty: { fontFamily: fonts.regular, fontSize: typeScale.bodySmall.size, textAlign: 'center', lineHeight: 20, paddingHorizontal: space.gutter },
  hero: { fontFamily: fonts.displayHeavy, fontSize: typeScale.hero.size, lineHeight: typeScale.hero.line, letterSpacing: -1, paddingHorizontal: space.gutter, marginBottom: space.l },
  segment: { flexDirection: 'row', marginHorizontal: space.gutter, padding: 4, borderRadius: radius.pill, borderWidth: 1, marginBottom: space.l },
  segBtn: { flex: 1, flexDirection: 'row', gap: 6, minHeight: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  segText: { fontFamily: fonts.semibold, fontSize: typeScale.bodySmall.size },
  count: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  countText: { fontFamily: fonts.bold, fontSize: 11 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m, paddingHorizontal: space.gutter, paddingVertical: space.m },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: space.s, justifyContent: 'space-between' },
  name: { flex: 1, fontFamily: fonts.display, fontSize: typeScale.headline.size },
  time: { fontFamily: fonts.medium, fontSize: typeScale.caption.size },
  preview: { flex: 1, fontSize: typeScale.bodySmall.size },
  dot: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  dotText: { fontFamily: fonts.bold, fontSize: 11 },
});
