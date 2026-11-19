import { radius, size, space, type as typeScale } from '@flero/ui-tokens';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import type { PublicProfile } from '@flero/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { z } from 'zod';
import { api, errorText, newKey } from '@/api/client';
import { Sheet } from '@/design/Sheet';
import Animated, {
  FadeIn, FadeInDown, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming, ZoomIn,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/design/Avatar';
import { easeOut, PressableScale } from '@/design/motion';
import { fonts, useTheme } from '@/design/theme';
import { t } from '@/i18n/tr';
import { goBack } from '@/design/nav';

/**
 * Public profile (S11). Social actions live HERE, not on Shuffle cards (A§0.1.1). The message CTA follows the
 * server's oracle-free `actions.message` (doc 08 §3.2); the like is irreversible, so the first tap confirms.
 */
type Profile = z.infer<typeof PublicProfile>;

export default function ProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const q = useQuery({ queryKey: ['profile', id], queryFn: () => api<Profile>(`/v1/profiles/${id}`).then((r) => r.data) });
  if (q.data) return <ProfileView p={q.data} />;
  return (
    <View style={[styles.fill, styles.center, { backgroundColor: c.canvas }]} accessibilityLiveRegion="polite">
      {q.isError ? (
        <>
          <Text style={[styles.bio, { color: c.textSecondary, textAlign: 'center' }]}>{q.error && 'status' in q.error && (q.error as { status: number }).status === 404 ? 'Bu profil artık kullanılamıyor.' : errorText(q.error)}</Text>
          <PressableScale accessibilityRole="button" onPress={() => goBack('/')} style={[styles.secondary, { backgroundColor: c.surface, borderColor: c.hairline, flex: 0, paddingHorizontal: 24 }]}>
            <Text style={[styles.primaryText, { color: c.textPrimary }]}>Geri dön</Text>
          </PressableScale>
        </>
      ) : <ActivityIndicator color={c.brandText} />}
    </View>
  );
}

function ProfileView({ p }: { p: Profile }) {
  const qc = useQueryClient();
  const { c, name } = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [following, setFollowing] = useState(p.relationship.i_follow);
  const [liked, setLiked] = useState(p.relationship.i_liked);
  const [confirmLike, setConfirmLike] = useState(false);
  const [menu, setMenu] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const plus = p.membership_tier_style === 'PLUS';
  const refresh = () => qc.invalidateQueries({ queryKey: ['profile', p.public_user_id] });
  const toggleFollow = async () => {
    const next = !following;
    setFollowing(next); // optimistic; rolled back on failure
    try { await api(`/v1/follows/${p.public_user_id}`, { method: next ? 'PUT' : 'DELETE' }); void refresh(); }
    catch (e) { setFollowing(!next); setNote(errorText(e)); }
  };
  const msg = p.actions.message;
  const openChat = () => {
    if (msg.kind === 'OPEN_EXISTING') router.push({ pathname: '/chat/[cid]', params: { cid: msg.conversation_id } });
    else if (msg.kind === 'START_NEW') router.push({ pathname: '/chat/[cid]', params: { cid: 'new', to: p.public_user_id, name: p.display_name } });
  };
  const safety = async (kind: 'report' | 'block') => {
    setMenu(false);
    try {
      if (kind === 'report') await api('/v1/reports', { body: { target: { type: 'PROFILE', id: p.public_user_id }, reason: 'OTHER' }, idem: newKey() });
      else { await api(`/v1/blocks/${p.public_user_id}`, { method: 'PUT', idem: newKey() }); void qc.invalidateQueries({ queryKey: ['shuffle'] }); goBack('/'); return; }
      setNote('Bildirimin alındı. Ekibimiz inceleyecek.');
    } catch (e) { setNote(errorText(e)); }
  };

  const heart = useSharedValue(1);
  const heartStyle = useAnimatedStyle(() => ({ transform: [{ scale: heart.value }] }));
  const onLike = () => {
    if (liked) return;
    if (!confirmLike) { setConfirmLike(true); return; }
    setLiked(true); setConfirmLike(false);
    api(`/v1/likes/${p.public_user_id}`, { method: 'PUT' }).then(() => refresh(), (e) => { setLiked(false); setNote(errorText(e)); });
    if (!reduced) heart.value = withSequence(withTiming(1.25, { duration: 140, easing: easeOut }), withSpring(1, { damping: 12, stiffness: 260 }));
  };

  const enter = (i: number) => (reduced ? FadeIn.duration(150) : FadeInDown.duration(280).delay(60 + i * 40).easing(easeOut).withInitialValues({ transform: [{ translateY: 10 }] }));

  return (
    <View style={[styles.fill, { backgroundColor: c.canvas }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 120 }} showsVerticalScrollIndicator={false}>
        <LinearGradient
          colors={plus ? [name === 'dark' ? '#241F3D' : '#E9E4FF', c.canvas] : [name === 'dark' ? '#1A2208' : '#F2FFD0', c.canvas]}
          style={[styles.backdrop, { paddingTop: insets.top + 56 }]}
        >
          <Animated.View entering={reduced ? FadeIn.duration(150) : ZoomIn.duration(320).easing(easeOut).withInitialValues({ transform: [{ scale: 0.92 }] })}>
            <Avatar id={p.public_user_id} name={p.display_name} size={116} ring={plus ? 'plus' : 'subtle'} uri={p.avatar?.url} />
          </Animated.View>
          <Animated.Text entering={enter(0)} style={[styles.name, { color: c.textPrimary }]}>{p.display_name}</Animated.Text>
          <Animated.Text entering={enter(1)} style={[styles.handle, { color: c.textSecondary }]}>
            @{p.handle} · {t(p.home_district_label_key)}
          </Animated.Text>
          <Animated.View entering={enter(2)} style={styles.chips}>
            {plus ? (
              <View style={[styles.chip, { backgroundColor: c.plusTint }]}>
                <Ionicons name="sparkles" size={12} color={c.plusText} />
                <Text style={[styles.chipText, { color: c.plusText }]}>Plus</Text>
              </View>
            ) : null}
            {p.relationship.follows_me ? (
              <View style={[styles.chip, { backgroundColor: c.surface, borderColor: c.hairline, borderWidth: 1 }]}>
                <Ionicons name="person-add" size={12} color={c.brandText} />
                <Text style={[styles.chipText, { color: c.textPrimary }]}>{t('profile.follows_you')}</Text>
              </View>
            ) : null}
          </Animated.View>
        </LinearGradient>

        <Animated.View entering={enter(3)} style={[styles.stats, { backgroundColor: c.surface, borderColor: c.hairline }]}>
          <Stat value={p.follower_count + (following && !p.relationship.i_follow ? 1 : !following && p.relationship.i_follow ? -1 : 0)} label={t('profile.followers')} />
          <View style={[styles.divider, { backgroundColor: c.hairline }]} />
          <Stat value={p.like_count + (liked && !p.relationship.i_liked ? 1 : 0)} label={t('profile.likes')} />
        </Animated.View>

        {p.bio ? <Animated.Text entering={enter(4)} style={[styles.bio, { color: c.textPrimary }]}>{p.bio}</Animated.Text> : null}

        <Animated.View entering={enter(5)} style={[styles.note, { backgroundColor: c.surface, borderColor: c.hairline }]}>
          <Ionicons name="eye-off-outline" size={18} color={c.textSecondary} />
          <Text style={[styles.noteText, { color: c.textSecondary }]}>{t('profile.anon_note')}</Text>
        </Animated.View>
      </ScrollView>

      {/* floating top controls */}
      <View style={[styles.topBar, { top: insets.top + space.s }]} pointerEvents="box-none">
        <PressableScale accessibilityRole="button" accessibilityLabel="Geri" onPress={() => goBack('/')} style={[styles.round, { backgroundColor: c.surface, borderColor: c.hairline }]}>
          <Ionicons name="chevron-back" size={22} color={c.textPrimary} />
        </PressableScale>
        <PressableScale accessibilityRole="button" accessibilityLabel="Profil seçenekleri" onPress={() => setMenu(true)} style={[styles.round, { backgroundColor: c.surface, borderColor: c.hairline }]}>
          <Ionicons name="ellipsis-horizontal" size={20} color={c.textPrimary} />
        </PressableScale>
      </View>

      {/* action dock */}
      <View style={[styles.dock, { paddingBottom: insets.bottom + space.m, backgroundColor: c.canvas, borderTopColor: c.hairline }]}>
        {note ? <Animated.Text entering={FadeIn.duration(150)} style={[styles.confirm, { color: c.textSecondary }]} accessibilityLiveRegion="polite">{note}</Animated.Text> : null}
        {confirmLike ? (
          <Animated.Text entering={FadeIn.duration(150)} style={[styles.confirm, { color: c.textSecondary }]}>{t('profile.like_confirm')}</Animated.Text>
        ) : null}
        <View style={styles.dockRow}>
          <PressableScale
            accessibilityRole="button"
            accessibilityState={{ selected: following }}
            onPress={() => void toggleFollow()}
            style={[styles.primary, following ? { backgroundColor: c.surface, borderColor: c.hairline, borderWidth: 1 } : { backgroundColor: c.brand }]}
          >
            <Ionicons name={following ? 'checkmark' : 'person-add'} size={18} color={following ? c.textPrimary : c.onBrand} />
            <Text style={[styles.primaryText, { color: following ? c.textPrimary : c.onBrand }]}>{following ? t('profile.following') : t('profile.follow')}</Text>
          </PressableScale>
          <PressableScale
            accessibilityRole="button"
            onPress={openChat}
            disabled={msg.kind === 'UNAVAILABLE'}
            accessibilityState={{ disabled: msg.kind === 'UNAVAILABLE' }}
            style={[styles.secondary, { backgroundColor: c.surface, borderColor: c.hairline, opacity: msg.kind === 'UNAVAILABLE' ? 0.45 : 1 }]}
          >
            <Ionicons name="chatbubble-ellipses" size={18} color={c.textPrimary} />
            <Text style={[styles.primaryText, { color: c.textPrimary }]}>{msg.kind === 'OPEN_EXISTING' ? t('profile.message.open') : t('profile.message')}</Text>
          </PressableScale>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={liked ? t('profile.liked') : t('profile.like')}
            accessibilityState={{ selected: liked }}
            onPress={onLike}
            haptic={confirmLike ? 'medium' : 'light'}
            style={[styles.like, { backgroundColor: liked ? '#FF4D6D22' : confirmLike ? c.raised : c.surface, borderColor: liked ? '#FF4D6D' : c.hairline }]}
          >
            <Animated.View style={heartStyle}>
              <Ionicons name={liked ? 'heart' : 'heart-outline'} size={22} color={liked ? '#FF4D6D' : c.textPrimary} />
            </Animated.View>
          </PressableScale>
        </View>
      </View>
      <Sheet visible={menu} onClose={() => setMenu(false)} title={p.display_name}>
        <PressableScale accessibilityRole="button" onPress={() => void safety('report')} style={[styles.secondary, { flex: 0, backgroundColor: c.surface, borderColor: c.hairline, marginBottom: space.s }]}>
          <Ionicons name="flag-outline" size={18} color={c.textPrimary} />
          <Text style={[styles.primaryText, { color: c.textPrimary }]}>Profili bildir</Text>
        </PressableScale>
        <PressableScale accessibilityRole="button" haptic="medium" onPress={() => void safety('block')} style={[styles.secondary, { flex: 0, backgroundColor: c.danger, borderColor: c.danger }]}>
          <Ionicons name="ban" size={18} color="#0A0A0F" />
          <Text style={[styles.primaryText, { color: '#0A0A0F' }]}>Engelle</Text>
        </PressableScale>
      </Sheet>
    </View>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  const { c } = useTheme();
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: c.textPrimary }]}>{value.toLocaleString('tr-TR')}</Text>
      <Text style={[styles.statLabel, { color: c.textTertiary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', gap: space.l, padding: space.xxl },
  backdrop: { alignItems: 'center', paddingBottom: space.xxl, paddingHorizontal: space.gutter },
  name: { fontFamily: fonts.displayHeavy, fontSize: typeScale.display.size, lineHeight: typeScale.display.line, marginTop: space.l, letterSpacing: -0.6, textAlign: 'center' },
  handle: { fontFamily: fonts.medium, fontSize: typeScale.bodySmall.size, marginTop: 2 },
  chips: { flexDirection: 'row', gap: space.s, marginTop: space.m, flexWrap: 'wrap', justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill },
  chipText: { fontFamily: fonts.bold, fontSize: typeScale.caption.size },
  stats: { flexDirection: 'row', marginHorizontal: space.gutter, borderRadius: radius.card, borderWidth: 1, paddingVertical: space.l },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: { fontFamily: fonts.displayHeavy, fontSize: typeScale.title1.size, lineHeight: typeScale.title1.line },
  statLabel: { fontFamily: fonts.medium, fontSize: typeScale.caption.size },
  divider: { width: 1, marginVertical: 4 },
  bio: { fontFamily: fonts.regular, fontSize: typeScale.body.size, lineHeight: typeScale.body.line, marginHorizontal: space.gutter, marginTop: space.xl },
  note: { flexDirection: 'row', gap: space.m, alignItems: 'flex-start', marginHorizontal: space.gutter, marginTop: space.xl, padding: space.l, borderRadius: radius.card, borderWidth: 1 },
  noteText: { flex: 1, fontFamily: fonts.regular, fontSize: typeScale.bodySmall.size, lineHeight: typeScale.bodySmall.line },
  topBar: { position: 'absolute', left: space.gutter, right: space.gutter, flexDirection: 'row', justifyContent: 'space-between' },
  round: { width: size.hitTarget, height: size.hitTarget, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.gutter, paddingTop: space.m, borderTopWidth: StyleSheet.hairlineWidth, gap: space.s },
  dockRow: { flexDirection: 'row', gap: space.s },
  primary: { flex: 1.3, minHeight: 50, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  secondary: { flex: 1, minHeight: 50, borderRadius: radius.pill, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryText: { fontFamily: fonts.bold, fontSize: typeScale.body.size - 1 },
  like: { width: 50, height: 50, borderRadius: 25, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  confirm: { fontFamily: fonts.medium, fontSize: typeScale.caption.size, textAlign: 'center' },
});
