import type { PublicProfile } from '@flero/contracts';
import { radius, space, type as typeScale } from '@flero/ui-tokens';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { z } from 'zod';
import { api } from '@/api/client';
import { useSession } from '@/api/session';
import { Avatar } from '@/design/Avatar';
import { PressableScale } from '@/design/motion';
import { fonts, useTheme } from '@/design/theme';
import { AvatarSheet, BlocksSheet, ChangePasswordSheet, EditProfileSheet, NotificationPrefsSheet, PeopleSheet, RegionSheet, SessionsSheet, VerifyEmailSheet } from '@/features/account';
import { t, upper } from '@/i18n/tr';

/**
 * Own profile (S30) + account hub. Friend count and the following/friends lists appear ONLY here, for the owner
 * (REQ-SOC-05). Home-region shows the next allowed change date (30-day rule, A§8.4).
 */
type Row = { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; detail?: string; href?: Href; onPress?: () => void; danger?: boolean };
const date = (iso: string) => new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' }).format(new Date(iso));

export default function MyProfileScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { me, signOut, reloadMe } = useSession();
  const pub = useQuery({
    queryKey: ['profile', me?.public_user_id],
    queryFn: () => api<z.infer<typeof PublicProfile>>(`/v1/profiles/${me!.public_user_id}`).then((r) => r.data),
    enabled: !!me,
  });
  const friends = useQuery({ queryKey: ['friends', 'count'], queryFn: () => api<{ friend_count: number }>('/v1/me/friends/count').then((r) => r.data.friend_count) });
  const district = me?.home_district_label_key ? t(me.home_district_label_key) : '—';
  const nextChange = me?.home_region_next_change_at && new Date(me.home_region_next_change_at) > new Date() ? `sonraki değişiklik ${date(me.home_region_next_change_at)}` : 'şimdi değiştirilebilir';
  const plus = me?.membership_tier === 'PLUS';
  const [open, setOpen] = useState<null | 'edit' | 'region' | 'people' | 'blocks' | 'sessions' | 'password' | 'verify' | 'prefs' | 'photo'>(null);

  const sections: { title: string; rows: Row[] }[] = [
    { title: 'Hesap', rows: [
      { icon: 'create-outline', label: 'Profili düzenle', onPress: () => setOpen('edit') },
      { icon: 'location-outline', label: 'Ev bölgesi', detail: `${district} · ${nextChange}`, onPress: () => setOpen('region') },
      { icon: 'people-outline', label: 'Takip ettiklerin ve arkadaşların', onPress: () => setOpen('people') },
      { icon: 'sparkles-outline', label: 'FLERO Plus', detail: plus && me?.plus_until ? `Plus · ${date(me.plus_until)} tarihine kadar` : 'Standart', href: '/plus' },
    ] },
    { title: 'Bildirimler', rows: [
      { icon: 'notifications-outline', label: 'Bildirim tercihleri', detail: 'Telefon bildirimlerini yönet', onPress: () => setOpen('prefs') },
    ] },
    { title: 'Güvenlik', rows: [
      ...(me?.email && !me.email_verified ? [{ icon: 'mail-unread-outline' as const, label: 'E-postanı doğrula', detail: `${me.email} · doğrulanmadı`, onPress: () => setOpen('verify') }] : []),
      { icon: 'key-outline', label: 'Şifreyi değiştir', onPress: () => setOpen('password') },
      { icon: 'ban-outline', label: 'Engellenenler', onPress: () => setOpen('blocks') },
      { icon: 'phone-portrait-outline', label: 'Oturumlar ve cihazlar', onPress: () => setOpen('sessions') },
      { icon: 'log-out-outline', label: 'Çıkış yap', danger: true, onPress: () => void signOut() },
    ] },
    // development builds only: design review screens (never in a release build)
    ...(__DEV__ ? [{ title: 'Geliştirici', rows: [{ icon: 'color-palette-outline' as const, label: 'Kart vitrini', onPress: () => router.push('/kart-vitrini') }] }] : []),
  ];

  return (
    <ScrollView style={{ backgroundColor: c.canvas }} contentContainerStyle={{ paddingTop: insets.top + space.l, paddingBottom: space.huge }}
      refreshControl={<RefreshControl refreshing={pub.isRefetching} onRefresh={() => { void reloadMe(); void pub.refetch(); void friends.refetch(); }} tintColor={c.brandText} colors={[c.brandText]} />}>
      <View style={styles.header}>
        <PressableScale haptic="selection" accessibilityRole="button" accessibilityLabel={me?.avatar ? 'Profil fotoğrafını değiştir' : 'Profil fotoğrafı ekle'} onPress={() => setOpen('photo')}>
          <Avatar id={me?.public_user_id ?? 'me'} name={me?.display_name ?? '·'} size={84} ring={plus ? 'plus' : 'subtle'} uri={me?.avatar?.url} />
          <View style={[styles.camBadge, { backgroundColor: c.brand, borderColor: c.canvas }]}>
            <Ionicons name={me?.avatar ? 'camera' : 'add'} size={15} color={c.onBrand} />
          </View>
        </PressableScale>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.name, { color: c.textPrimary }]} numberOfLines={1}>{me?.display_name ?? ''}</Text>
          <Text style={[styles.handle, { color: c.textSecondary }]} numberOfLines={1}>@{me?.handle ?? ''} · {district}</Text>
        </View>
      </View>

      <View style={[styles.stats, { backgroundColor: c.surface, borderColor: c.hairline }]}>
        <Stat value={pub.data?.follower_count} label="Takipçi" />
        <Stat value={friends.data} label="Arkadaş" hint="yalnızca sen" />
        <Stat value={pub.data?.like_count} label="Beğeni" />
      </View>

      {sections.map((s) => (
        <View key={s.title} style={{ marginTop: space.xl }}>
          <Text style={[styles.sectionTitle, { color: c.textTertiary }]}>{upper(s.title)}</Text>
          <View style={[styles.group, { backgroundColor: c.surface, borderColor: c.hairline }]}>
            {s.rows.map((r, i) => (
              <PressableScale
                key={r.label}
                accessibilityRole="button"
                onPress={r.onPress ?? (r.href ? () => router.push(r.href!) : undefined)}
                style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hairline }]}
              >
                <Ionicons name={r.icon} size={20} color={r.danger ? c.danger : c.textPrimary} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowLabel, { color: r.danger ? c.danger : c.textPrimary }]}>{r.label}</Text>
                  {r.detail ? <Text style={[styles.rowDetail, { color: c.textTertiary }]}>{r.detail}</Text> : null}
                </View>
                {r.danger ? null : <Ionicons name="chevron-forward" size={16} color={c.textTertiary} />}
              </PressableScale>
            ))}
          </View>
        </View>
      ))}
      <EditProfileSheet visible={open === 'edit'} onClose={() => setOpen(null)} />
      <RegionSheet visible={open === 'region'} onClose={() => setOpen(null)} />
      <PeopleSheet visible={open === 'people'} onClose={() => setOpen(null)} />
      <BlocksSheet visible={open === 'blocks'} onClose={() => setOpen(null)} />
      <SessionsSheet visible={open === 'sessions'} onClose={() => setOpen(null)} />
      <ChangePasswordSheet visible={open === 'password'} onClose={() => setOpen(null)} />
      <AvatarSheet visible={open === 'photo'} onClose={() => setOpen(null)} />
      <VerifyEmailSheet visible={open === 'verify'} onClose={() => setOpen(null)} />
      <NotificationPrefsSheet visible={open === 'prefs'} onClose={() => setOpen(null)} />
    </ScrollView>
  );
}

function Stat({ value, label, hint }: { value: number | undefined; label: string; hint?: string }) {
  const { c } = useTheme();
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${value ?? ''} ${label}${hint ? `, ${hint}` : ''}`}>
      {value === undefined ? <View style={[styles.skel, { backgroundColor: c.raised }]} /> : <Text style={[styles.statValue, { color: c.textPrimary }]}>{new Intl.NumberFormat('tr-TR').format(value)}</Text>}
      <Text style={[styles.statLabel, { color: c.textSecondary }]}>{label}</Text>
      {hint ? <Text style={[styles.statHint, { color: c.textTertiary }]}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  camBadge: { position: 'absolute', right: 0, bottom: 0, width: 28, height: 28, borderRadius: 14, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.l, paddingHorizontal: space.gutter },
  name: { fontFamily: fonts.displayHeavy, fontSize: typeScale.title1.size, letterSpacing: -0.5 },
  handle: { fontFamily: fonts.medium, fontSize: typeScale.bodySmall.size },
  stats: { flexDirection: 'row', marginHorizontal: space.gutter, marginTop: space.xl, paddingVertical: space.l, borderRadius: radius.card, borderWidth: 1 },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: { fontFamily: fonts.display, fontSize: typeScale.title2.size, fontVariant: ['tabular-nums'] },
  statLabel: { fontFamily: fonts.medium, fontSize: typeScale.caption.size },
  statHint: { fontFamily: fonts.medium, fontSize: 10 },
  skel: { width: 36, height: 22, borderRadius: 6 },
  sectionTitle: { fontFamily: fonts.bold, fontSize: typeScale.label.size, letterSpacing: 1, paddingHorizontal: space.gutter + 4, marginBottom: space.s },
  group: { marginHorizontal: space.gutter, borderRadius: radius.card, borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 56, paddingHorizontal: space.l, paddingVertical: space.m },
  rowLabel: { fontFamily: fonts.semibold, fontSize: typeScale.body.size - 1 },
  rowDetail: { fontFamily: fonts.medium, fontSize: typeScale.caption.size, marginTop: 1 },
});
