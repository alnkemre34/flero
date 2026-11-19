import { LinearGradient } from 'expo-linear-gradient';
import { Image, StyleSheet, Text, View } from 'react-native';
import { reachable } from '@/api/avatar';
import { fonts, useTheme } from './theme';

/** Deterministic gradient per id (identified users only) — gives initials avatars a premium, distinct look. */
// Saturated dark duotones: white initials stay ≥ 4.5:1 on every stop.
const PAIRS: [string, string][] = [
  ['#5B4BFF', '#241B7A'], ['#0FA37F', '#0A4A3A'], ['#E0457B', '#6B1236'], ['#E08A1E', '#6B3A06'],
  ['#2D8CFF', '#0C3B7A'], ['#9B4DFF', '#3E1680'], ['#14A3B8', '#08505C'], ['#D9434B', '#6B1418'],
];
/** FNV-1a: well-distributed even for ids that differ in one repeated character. */
const hash = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
};

type Ring = 'none' | 'plus' | 'promoted' | 'subtle' | 'custom';

/**
 * Avatar with an optional story-style ring. `anonymous` renders the abstract mark with NO initial and a tone
 * derived from the conversation (never the user) — DEC-12 / doc 14 §6.
 */
export function Avatar({
  id, name, size = 56, ring = 'none', anonymous = false, faces, ringColors: customRing, uri, radius,
}: { id: string; name?: string; size?: number; ring?: Ring; anonymous?: boolean; faces?: [string, string][]; ringColors?: [string, string, ...string[]]; uri?: string | null;
  /** corner radius of the face; omitted = circle. Rounded squares are for the Shuffle card's photo tile only. */
  radius?: number }) {
  const { c } = useTheme();
  const inner = size - (ring === 'none' ? 0 : 6);
  const r = radius ?? inner / 2;
  const set = faces ?? PAIRS;
  const [from, to] = set[hash(id) % set.length]!;
  const ringColors: [string, string, ...string[]] =
    ring === 'custom' && customRing ? customRing
    : ring === 'plus' ? [c.plusFrameFrom, c.plusFrameMid, c.plusFrameTo]
    : ring === 'promoted' ? [c.promotedAccent, '#1F8FA8', c.promotedAccent]
    : [c.hairline, c.hairline];

  // a real photo only for identified users; an anonymous counterpart never has one (the API never sends it)
  const face = !anonymous && uri ? (
    <Image source={{ uri: reachable(uri) }} accessibilityIgnoresInvertColors style={{ width: inner, height: inner, borderRadius: r, backgroundColor: from }} />
  ) : anonymous ? (
    <View style={[styles.face, { width: inner, height: inner, borderRadius: r, backgroundColor: c.raised }]}>
      <View style={[styles.arc, { width: inner * 0.42, height: inner * 0.42, borderRadius: inner, borderColor: c.textTertiary, left: inner * 0.18, top: inner * 0.26 }]} />
      <View style={[styles.arc, { width: inner * 0.42, height: inner * 0.42, borderRadius: inner, borderColor: c.textSecondary, left: inner * 0.4, top: inner * 0.32 }]} />
    </View>
  ) : (
    <LinearGradient colors={[from, to]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.face, { width: inner, height: inner, borderRadius: r }]}>
      <Text style={{ fontFamily: fonts.displayHeavy, fontSize: inner * 0.4, color: '#F4F4F6' }}>
        {(name ?? '?').slice(0, 1).toLocaleUpperCase('tr-TR')}
      </Text>
    </LinearGradient>
  );

  if (ring === 'none') return face;
  return (
    <LinearGradient colors={ringColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.ring, { width: size, height: size, borderRadius: size / 2 }]}>
      <View style={[styles.gap, { width: size - 4, height: size - 4, borderRadius: size / 2, backgroundColor: c.canvas }]}>{face}</View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  ring: { alignItems: 'center', justifyContent: 'center' },
  gap: { alignItems: 'center', justifyContent: 'center' },
  face: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  arc: { position: 'absolute', borderWidth: 2.5 },
});
