import { radius, size, space, type as typeScale } from '@flero/ui-tokens';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { Avatar } from '@/design/Avatar';
import { PressableScale } from '@/design/motion';
import { fonts, useTheme } from '@/design/theme';
import { cardTokens, FACES, type CardTokens, type Gender } from '@/design/tiers';
import { t } from '@/i18n/tr';
import { cardVariant, type CardVariant } from './variant';

/** What a discovery card shows. Only data the API really has — no age, distance, presence or verification. */
export interface DiscoveryCardData {
  id: string;
  name: string;
  gender: Gender;
  districtKey: string;
  cityKey: string;
  avatarUrl: string | null;
  placement: 'BOOST_BLOCK' | 'DISCOVERY';   // the server's paid-placement decision for THIS batch
  membership: 'PLUS' | 'STANDARD';          // kept separate from placement
}

const TILE = 56;
const LABEL: Record<CardVariant, string> = { BOOST: 'BOOST', PLUS: 'PLUS', STANDARD: 'Standart' };

/**
 * Discovery card (Shuffle row). Geometry is unchanged from the approved list (≈84 dp row, 56 dp photo, the whole
 * card opens the profile, no in-card Like/Follow/Message — master §5, A§7.1); only the look is variant-driven:
 *   DiscoveryCardBackground  solid gradient ground + two decorative curves, clipped by the card (no glass/blur)
 *   DiscoveryCardAvatar      rounded-square photo tile; a small crown when a Boost card is also a Plus member
 *   DiscoveryCardIdentity    name (1 line, truncates) + gender glyph + district · city
 *   DiscoveryCardBadge       compact BOOST / PLUS / Standart pill
 *   BoostHighlight           one short light sweep when a Boost card appears; off under Reduced Motion
 */
function DiscoveryCardImpl({ data, onPress }: { data: DiscoveryCardData; onPress: (id: string) => void }) {
  const { c, name: theme } = useTheme();
  const { variant, plusMember } = cardVariant({ placement: data.placement, membership_tier: data.membership });
  const k = cardTokens(theme, variant);
  const meta = `${t(data.districtKey)} · ${t(data.cityKey)}`;
  const a11y = [data.name, data.gender === 'FEMALE' ? 'Kadın' : 'Erkek', meta,
    plusMember ? t('a11y.plusMember') : null, variant === 'BOOST' ? t('a11y.promoted') : null, t('a11y.openProfile')].filter(Boolean).join(', ');

  return (
    <PressableScale accessibilityRole="button" accessibilityLabel={a11y} onPress={() => onPress(data.id)} scaleTo={0.985}
      style={[styles.press, k.shadow ? { boxShadow: k.shadow } : null]}>
      <LinearGradient colors={k.frame} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.frame}>
        <View style={styles.row}>
          <DiscoveryCardBackground k={k} />
          {k.highlight ? <BoostHighlight color={k.highlight} id={data.id} /> : null}
          <DiscoveryCardAvatar data={data} k={k} crown={variant === 'BOOST' && plusMember} />
          <DiscoveryCardIdentity name={data.name} meta={meta} glyph={data.gender === 'FEMALE' ? k.glyphF : k.glyphM} gender={data.gender} metaColor={k.meta} nameColor={c.textPrimary} />
          <DiscoveryCardBadge variant={variant} k={k} />
        </View>
      </LinearGradient>
    </PressableScale>
  );
}
export const DiscoveryCard = memo(DiscoveryCardImpl);

export function DiscoveryCardBackground({ k }: { k: CardTokens }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient colors={k.base} locations={[0, 0.58, 1]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={k.waveA} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.waveA, { opacity: k.waveOpacity[0] }]} />
      <LinearGradient colors={k.waveB} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.waveB, { opacity: k.waveOpacity[1] }]} />
      <View style={[styles.waveA, styles.waveEdge, { borderColor: k.waveLine }]} />
    </View>
  );
}

export function DiscoveryCardAvatar({ data, k, crown }: { data: DiscoveryCardData; k: CardTokens; crown: boolean }) {
  return (
    <View style={[styles.tile, { borderColor: k.tile }]}>
      <Avatar id={data.id} name={data.name} size={TILE - 4} radius={12} faces={FACES[data.gender]} uri={data.avatarUrl} />
      {crown ? (
        // Boost card of a Plus member: the secondary Plus mark, never a fourth design
        <LinearGradient colors={['#FFE29A', '#E8A93A']} style={styles.crown} accessibilityElementsHidden importantForAccessibility="no">
          <MaterialCommunityIcons name="crown" size={11} color="#3A2400" />
        </LinearGradient>
      ) : null}
    </View>
  );
}

export function DiscoveryCardIdentity({ name, meta, glyph, gender, metaColor, nameColor }: { name: string; meta: string; glyph: string; gender: Gender; metaColor: string; nameColor: string }) {
  return (
    <View style={styles.text}>
      <Text style={[styles.name, { color: nameColor }]} numberOfLines={1}>{name}</Text>
      <View style={styles.metaRow}>
        <Ionicons name={gender === 'FEMALE' ? 'female' : 'male'} size={12} color={glyph} accessibilityElementsHidden importantForAccessibility="no" />
        <Text style={[styles.meta, { color: metaColor }]} numberOfLines={1}>{meta}</Text>
      </View>
    </View>
  );
}

export function DiscoveryCardBadge({ variant, k }: { variant: CardVariant; k: CardTokens }) {
  const icon = variant === 'BOOST' ? <Ionicons name="flash" size={12} color={k.badge.icon} />
    : variant === 'PLUS' ? <MaterialCommunityIcons name="crown" size={13} color={k.badge.icon} />
    : <Ionicons name="person-outline" size={12} color={k.badge.icon} />;
  return (
    <LinearGradient colors={k.badge.fill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={[styles.badge, k.badge.border ? { borderWidth: 1, borderColor: k.badge.border } : null]}>
      {icon}
      <Text style={[styles.badgeText, { color: k.badge.text }, variant !== 'STANDARD' && styles.badgeCaps]} numberOfLines={1} maxFontSizeMultiplier={1.3}>{LABEL[variant]}</Text>
    </LinearGradient>
  );
}

/**
 * Boost's signature moment: a single soft diagonal light sweep (≈0.9 s) the first time a given profile's Boost card
 * appears. Never loops, never runs for cards already seen, absent under Reduced Motion — the card is complete
 * without it. Transform + opacity only, on the UI thread.
 */
const swept = new Set<string>();
function BoostHighlight({ color, id }: { color: string; id: string }) {
  const reduced = useReducedMotion();
  const [w, setW] = useState(0);
  const p = useSharedValue(0);
  useEffect(() => {
    if (reduced || !w || swept.has(id)) return;
    swept.add(id);
    p.set(0);
    p.set(withDelay(160, withTiming(1, { duration: 900, easing: Easing.bezier(0.45, 0, 0.25, 1) })));
  }, [reduced, w, id, p]);
  const style = useAnimatedStyle(() => ({
    opacity: p.get() > 0 && p.get() < 1 ? 1 : 0,
    transform: [{ translateX: -120 + (w + 240) * p.get() }, { rotate: '18deg' }],
  }));
  if (reduced) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <Animated.View style={[styles.sweep, style]}>
        <LinearGradient colors={['transparent', color, 'transparent']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
    </View>
  );
}

/** Loading placeholder with the card's exact geometry (no layout shift when results arrive). */
export function DiscoveryCardSkeleton() {
  const { c } = useTheme();
  return (
    <View style={[styles.press, styles.skeleton, { backgroundColor: c.surface, borderColor: c.hairline }]}>
      <View style={[styles.skelTile, { backgroundColor: c.raised }]} />
      <View style={{ flex: 1, gap: 8 }}>
        <View style={[styles.skelLine, { backgroundColor: c.raised, width: '50%' }]} />
        <View style={[styles.skelLine, { backgroundColor: c.raised, width: '34%' }]} />
      </View>
      <View style={[styles.skelBadge, { backgroundColor: c.raised }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  press: { marginHorizontal: space.gutter, marginBottom: space.s + 2, borderRadius: radius.card },
  frame: { borderRadius: radius.card, padding: 1 },
  row: {
    minHeight: size.cardMinHeight - 2, borderRadius: radius.card - 1, flexDirection: 'row', alignItems: 'center',
    paddingLeft: space.m, paddingRight: space.m, paddingVertical: space.s + 2, gap: space.m - 2, overflow: 'hidden',
  },
  // curves live in the right ~35 % of the card (behind the badge), never under the name or the region text
  waveA: { position: 'absolute', width: 250, height: 140, borderRadius: 140, right: -128, bottom: -84, transform: [{ rotate: '-16deg' }] },
  waveB: { position: 'absolute', width: 160, height: 90, borderRadius: 90, right: -62, bottom: -58, transform: [{ rotate: '-22deg' }] },
  waveEdge: { backgroundColor: 'transparent', borderWidth: 1.5 },
  sweep: { position: 'absolute', top: -30, bottom: -30, width: 70 },
  tile: { width: TILE, height: TILE, borderRadius: 14, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  crown: { position: 'absolute', right: -5, bottom: -5, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#1C0F2C' },
  text: { flex: 1, gap: 4, minWidth: 0 },
  name: { fontFamily: fonts.display, fontSize: typeScale.cardName.size, lineHeight: typeScale.cardName.line, letterSpacing: -0.2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  meta: { fontFamily: fonts.medium, fontSize: typeScale.cardMeta.size, lineHeight: typeScale.cardMeta.line, flexShrink: 1 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.pill, paddingHorizontal: 10, minHeight: 26, flexShrink: 0 },
  badgeText: { fontFamily: fonts.bold, fontSize: typeScale.label.size + 1, lineHeight: typeScale.label.line + 1 },
  badgeCaps: { letterSpacing: 0.7 },
  skeleton: { minHeight: size.cardMinHeight, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: space.m, padding: space.m },
  skelTile: { width: TILE, height: TILE, borderRadius: 14 },
  skelLine: { height: 12, borderRadius: 6 },
  skelBadge: { width: 64, height: 26, borderRadius: 13 },
});
