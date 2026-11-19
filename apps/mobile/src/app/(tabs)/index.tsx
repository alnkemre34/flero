import { radius, size, space, type as typeScale } from '@flero/ui-tokens';
import Ionicons from '@expo/vector-icons/Ionicons';
import { FlashList, type FlashListProps } from '@shopify/flash-list';
import { LinearGradient } from 'expo-linear-gradient';
import type { ShuffleSampleResponse } from '@flero/contracts';
import * as Haptics from 'expo-haptics';
import { useInfiniteQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, RefreshControl, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Extrapolation, interpolate, useAnimatedScrollHandler, useAnimatedStyle, useReducedMotion, useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { entering, PressableScale } from '@/design/motion';
import { fonts, useTheme } from '@/design/theme';
import { api } from '@/api/client';
import { useSession } from '@/api/session';
import type { ShuffleItem } from '@/features/shuffle/fixtures';
import { NotificationBell, ShuffleButton } from '@/features/shuffle/HeaderActions';
import { ShuffleCard } from '@/features/shuffle/ShuffleCard';
import { FilterSheet } from '@/features/sheets';
import { t, upper } from '@/i18n/tr';

type Row = ShuffleItem & { batch: string; first: boolean };
/** The list ends just above the floating Karıştır button: dock offset + button height + one small gap. */
const FAB_CLEARANCE = space.l + 54 + space.m;
const AnimatedFlashList = Animated.createAnimatedComponent(FlashList as React.ComponentType<FlashListProps<Row>>);

/**
 * Keşfet (S09) — FLERO Gece. Server order is rendered exactly (no client sort, no cross-batch dedupe; keys are
 * `${batch_id}:${public_user_id}`, A§4/T30). Motion: collapsing large title driven by the scroll position on the
 * UI thread; first-page stagger only; no row animation while scrolling. Every page is an independent server batch
 * (no client memory, A§0.1.9); autoload continues only while `has_more`.
 */
export default function DiscoverScreen() {
  const { c, name } = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const { me } = useSession();
  const isPlus = me?.membership_tier === 'PLUS';
  const [filter, setFilter] = useState<{ mode: 'DISTRICT' | 'CITY'; gender: 'ALL' | 'FEMALE' | 'MALE' }>({ mode: 'DISTRICT', gender: 'ALL' });
  const [refreshing, setRefreshing] = useState(false);
  // Every reshuffle is a new generation: an independent server batch (A§0.1.9). The previous list stays on screen
  // (placeholder) until the new batch lands, so a reshuffle never flashes a skeleton.
  const [gen, setGen] = useState(0);
  const listRef = useRef<{ scrollToOffset: (o: { offset: number; animated?: boolean }) => void } | null>(null);
  const q = useInfiniteQuery({
    queryKey: ['shuffle', filter, gen], // filter/generation change = new query; late responses of the old one are dropped (T29)
    queryFn: () => api<ShuffleSampleResponse>('/v1/shuffle/sample', { body: filter.mode === 'CITY' ? { mode: 'CITY', gender: filter.gender } : { mode: 'DISTRICT', gender: filter.gender } }).then((r) => r.data),
    initialPageParam: 0,
    // one batch per shuffle (the server's N, e.g. 10): new people come from the Shuffle button, not from scrolling
    getNextPageParam: () => undefined,
    staleTime: Infinity,
    placeholderData: (prev) => prev,
  });
  const reshuffling = q.isPlaceholderData && q.isFetching;
  const landed = useRef(gen);
  useEffect(() => {
    // the new batch is on screen: one light haptic, list back to the top (paired with the visual entrance)
    if (!q.isPlaceholderData && q.isSuccess && landed.current !== gen) {
      landed.current = gen;
      listRef.current?.scrollToOffset({ offset: 0, animated: !reduced });
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [q.isPlaceholderData, q.isSuccess, gen, reduced]);
  const reshuffle = useCallback(() => setGen((g) => g + 1), []);
  const rows = useMemo<Row[]>(() => (q.data?.pages ?? []).flatMap((p, pi) => p.items.map((i) => ({ ...i, batch: p.batch_id, first: pi === 0 }))), [q.data]);
  const last = q.data?.pages.at(-1);
  const state = q.isPending ? 'loading' : q.isError && !rows.length ? 'uncertain' : !rows.length ? 'exhausted' : last?.completion === 'UNCERTAIN' || q.isFetchNextPageError ? 'uncertain' : 'list';
  const [filterOpen, setFilterOpen] = useState(false);
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => { scrollY.value = e.contentOffset.y; });

  const compactHeader = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [36, 72], [0, 1], Extrapolation.CLAMP),
  }));
  const bigTitle = useAnimatedStyle(() => (reduced ? {} : {
    transform: [
      { translateY: interpolate(scrollY.value, [-80, 0, 80], [16, 0, -10], Extrapolation.CLAMP) },
      { scale: interpolate(scrollY.value, [-80, 0], [1.08, 1], Extrapolation.CLAMP) },
    ],
    opacity: interpolate(scrollY.value, [0, 60], [1, 0], Extrapolation.CLAMP),
  }));

  const openProfile = useCallback((id: string) => router.push({ pathname: '/profile/[id]', params: { id } }), []);
  // pull-to-refresh is the same action as the Shuffle button: a fresh batch
  const onRefresh = useCallback(() => { setRefreshing(true); setGen((g) => g + 1); }, []);
  useEffect(() => { if (refreshing && !q.isFetching) setRefreshing(false); }, [refreshing, q.isFetching]);
  const district = me?.home_district_label_key ? t(me.home_district_label_key) : t('geo.district.kadikoy');

  const header = (
    <View style={{ paddingTop: insets.top + space.l }}>
      <Animated.View style={[styles.titleBlock, bigTitle]}>
        <Text style={[styles.eyebrow, { color: c.brandText }]}>{upper(t('discover.eyebrow'))}</Text>
        <Text style={[styles.hero, { color: c.textPrimary }]}>{t('tab.discover')}</Text>
      </Animated.View>

      <View style={styles.chips}>
        <Chip label={district} icon="location-sharp" active={filter.mode === 'DISTRICT'} onPress={() => setFilter((f) => ({ ...f, mode: 'DISTRICT' }))} />
        <Chip label={t('discover.citywide')} icon={isPlus ? 'business' : 'lock-closed'} locked={!isPlus} active={filter.mode === 'CITY'}
          onPress={() => (isPlus ? setFilter((f) => ({ ...f, mode: 'CITY' })) : router.push('/plus'))} />
        <Chip label={filter.gender === 'ALL' ? t('discover.gender.all') : filter.gender === 'FEMALE' ? 'Kadın' : 'Erkek'} icon="options" onPress={() => setFilterOpen(true)} />
      </View>

      <PressableScale style={styles.bannerPress} accessibilityRole="button" accessibilityLabel={t('banner.plus.title')}>
        <LinearGradient
          colors={name === 'dark' ? ['#1E1B2E', '#14141B'] : ['#F1EEFF', '#FFFFFF']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={[styles.banner, { borderColor: c.hairline }]}
        >
          <LinearGradient
            colors={[c.plusFrameFrom, c.plusFrameMid, c.plusFrameTo]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={styles.bannerOrb}
          />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[styles.bannerKicker, { color: c.plusText }]}>{upper(`${t('banner.sponsored')} · FLERO Plus`)}</Text>
            <Text style={[styles.bannerTitle, { color: c.textPrimary }]}>{t('banner.plus.title')}</Text>
            <Text style={[styles.bannerBody, { color: c.textSecondary }]}>{t('banner.plus.body')}</Text>
          </View>
          <Ionicons name="arrow-forward" size={20} color={c.textPrimary} />
        </LinearGradient>
      </PressableScale>

      <View style={styles.sectionRow}>
        <Text style={[styles.section, { color: c.textPrimary }]}>{t('discover.nearby')}</Text>
        <Text style={[styles.sectionMeta, { color: c.textTertiary }]}>{t('discover.shuffle_hint')}</Text>
      </View>
    </View>
  );

  const overlay = (
    <>
      <View style={[styles.topRight, { top: insets.top + space.s }]} pointerEvents="box-none">
        <NotificationBell />
      </View>
      {state !== 'loading' && (
        <View style={styles.fabDock} pointerEvents="box-none">
          <ShuffleButton onPress={reshuffle} busy={reshuffling} />
        </View>
      )}
    </>
  );

  if (state === 'loading') return <View style={styles.fill}><Skeleton header={header} />{overlay}</View>;
  if (state === 'exhausted') return <View style={styles.fill}><Empty header={header} onReset={reshuffle} />{overlay}</View>;

  return (
    <View style={[styles.fill, { backgroundColor: c.canvas }]}>
      <AnimatedFlashList
        ref={listRef as never}
        data={rows}
        keyExtractor={(item: Row) => `${item.batch}:${item.public_user_id}`}
        renderItem={({ item, index }: { item: Row; index: number }) => (
          <Animated.View entering={item.first ? entering(index, reduced) : undefined}>
            <ShuffleCard item={item} onPress={openProfile} />
          </Animated.View>
        )}
        ListHeaderComponent={header}
        ListFooterComponent={state === 'uncertain' ? <UncertainFooter onRetry={reshuffle} /> : null}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: FAB_CLEARANCE }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.brandText} colors={[c.brandText]} progressViewOffset={insets.top} />}
      />
      <Animated.View pointerEvents="none" style={[styles.compact, { paddingTop: insets.top, backgroundColor: c.canvas, borderBottomColor: c.hairline }, compactHeader]}>
        <Text style={[styles.compactTitle, { color: c.textPrimary }]}>{t('tab.discover')}</Text>
      </Animated.View>
      {overlay}
      <FilterSheet visible={filterOpen} onClose={() => setFilterOpen(false)} isPlus={isPlus} value={filter} onApply={setFilter} districtLabel={district} />
    </View>
  );
}

function Chip({ label, icon, active, locked, onPress }: { label: string; icon: React.ComponentProps<typeof Ionicons>['name']; active?: boolean; locked?: boolean; onPress?: () => void }) {
  const { c } = useTheme();
  return (
    <PressableScale
      haptic="selection"
      accessibilityRole="button"
      accessibilityState={{ selected: !!active, disabled: !!locked }}
      accessibilityHint={locked ? t('discover.locked_hint') : undefined}
      onPress={onPress}
      style={[styles.chip, { backgroundColor: active ? c.brand : c.surface, borderColor: active ? c.brand : c.hairline }]}
    >
      <Ionicons name={icon} size={14} color={active ? c.onBrand : locked ? c.plusText : c.textSecondary} />
      <Text style={[styles.chipText, { color: active ? c.onBrand : c.textPrimary }]}>{label}</Text>
    </PressableScale>
  );
}

function UncertainFooter({ onRetry }: { onRetry: () => void }) {
  const { c } = useTheme();
  return (
    <View style={[styles.footerCard, { backgroundColor: c.surface, borderColor: c.hairline }]} accessibilityLiveRegion="polite">
      <Ionicons name="cloud-offline-outline" size={22} color={c.textSecondary} />
      <Text style={[styles.footerText, { color: c.textSecondary }]}>{t('shuffle.uncertain')}</Text>
      <PressableScale accessibilityRole="button" onPress={onRetry} style={[styles.cta, { backgroundColor: c.brand }]}>
        <Text style={[styles.ctaText, { color: c.onBrand }]}>{t('shuffle.retry')}</Text>
      </PressableScale>
    </View>
  );
}

function Skeleton({ header }: { header: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={[styles.fill, { backgroundColor: c.canvas }]}>
      {header}
      {Array.from({ length: 6 }, (_, i) => (
        <View key={i} style={[styles.skeleton, { backgroundColor: c.surface }]}>
          <View style={[styles.skelAvatar, { backgroundColor: c.raised }]} />
          <View style={{ flex: 1, gap: 8 }}>
            <View style={[styles.skelLine, { backgroundColor: c.raised, width: '50%' }]} />
            <View style={[styles.skelLine, { backgroundColor: c.raised, width: '32%' }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

function Empty({ header, onReset }: { header: React.ReactNode; onReset: () => void }) {
  const { c } = useTheme();
  return (
    <View style={[styles.fill, { backgroundColor: c.canvas }]}>
      {header}
      <View style={styles.empty} accessibilityLiveRegion="polite">
        <View style={[styles.emptyIcon, { backgroundColor: c.surface, borderColor: c.hairline }]}>
          <Ionicons name="compass-outline" size={30} color={c.brandText} />
        </View>
        <Text style={[styles.emptyTitle, { color: c.textPrimary }]}>{t('shuffle.empty.title')}</Text>
        <PressableScale accessibilityRole="button" onPress={onReset} style={[styles.cta, { backgroundColor: c.brand }]}>
          <Text style={[styles.ctaText, { color: c.onBrand }]}>{t('shuffle.empty.reset')}</Text>
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  topRight: { position: 'absolute', right: space.gutter, zIndex: 20 },
  fabDock: { position: 'absolute', left: 0, right: 0, bottom: space.l, alignItems: 'center', zIndex: 20 },
  titleBlock: { paddingHorizontal: space.gutter, marginBottom: space.l, transformOrigin: 'left' },
  eyebrow: { fontFamily: fonts.bold, fontSize: typeScale.label.size, letterSpacing: 1.2, marginBottom: 2 },
  hero: { fontFamily: fonts.displayHeavy, fontSize: typeScale.hero.size, lineHeight: typeScale.hero.line, letterSpacing: -1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s, paddingHorizontal: space.gutter, marginBottom: space.l },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: size.hitTarget - 6, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1 },
  chipText: { fontFamily: fonts.semibold, fontSize: typeScale.bodySmall.size },
  bannerPress: { marginHorizontal: space.gutter, marginBottom: space.xxl },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.l, padding: space.l, borderRadius: radius.card, borderWidth: 1, overflow: 'hidden' },
  bannerOrb: { width: 52, height: 52, borderRadius: 16, transform: [{ rotate: '12deg' }] },
  bannerKicker: { fontFamily: fonts.bold, fontSize: typeScale.label.size, letterSpacing: 0.4 },
  bannerTitle: { fontFamily: fonts.display, fontSize: typeScale.title2.size - 2, lineHeight: 22 },
  bannerBody: { fontFamily: fonts.regular, fontSize: typeScale.bodySmall.size - 1, lineHeight: 18 },
  sectionRow: { paddingHorizontal: space.gutter, marginBottom: space.m, gap: 2 },
  section: { fontFamily: fonts.display, fontSize: typeScale.title2.size, lineHeight: typeScale.title2.line },
  sectionMeta: { fontFamily: fonts.medium, fontSize: typeScale.caption.size },
  compact: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', paddingBottom: space.l + 2, borderBottomWidth: StyleSheet.hairlineWidth },
  compactTitle: { fontFamily: fonts.display, fontSize: typeScale.headline.size + 1, marginTop: space.l + 2, lineHeight: 24 },
  skeleton: { minHeight: size.cardMinHeight, marginHorizontal: space.gutter, marginBottom: space.s + 2, borderRadius: radius.card, flexDirection: 'row', alignItems: 'center', padding: space.l, gap: space.m },
  skelAvatar: { width: size.avatar, height: size.avatar, borderRadius: 999 },
  skelLine: { height: 12, borderRadius: 6 },
  empty: { alignItems: 'center', padding: space.xxl, gap: space.l },
  emptyIcon: { width: 72, height: 72, borderRadius: 24, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontFamily: fonts.display, fontSize: typeScale.title2.size, lineHeight: typeScale.title2.line, textAlign: 'center' },
  cta: { minHeight: size.hitTarget, paddingHorizontal: space.xxl, borderRadius: radius.pill, justifyContent: 'center', alignItems: 'center' },
  ctaText: { fontFamily: fonts.bold, fontSize: typeScale.bodySmall.size + 1 },
  footerCard: { margin: space.gutter, padding: space.xl, borderRadius: radius.card, borderWidth: 1, gap: space.m, alignItems: 'flex-start' },
  footerText: { fontFamily: fonts.medium, fontSize: typeScale.body.size, lineHeight: typeScale.body.line },
  footerQuiet: { fontFamily: fonts.medium, fontSize: typeScale.caption.size, textAlign: 'center', padding: space.xl },
});
