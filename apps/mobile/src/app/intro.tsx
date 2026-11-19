import { radius, space, type as typeScale } from '@flero/ui-tokens';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { Extrapolation, FadeIn, interpolate, useAnimatedReaction, useAnimatedScrollHandler, useAnimatedStyle, useReducedMotion, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { setPref } from '@/api/prefs';
import { BrandLockup } from '@/design/Brand';
import { PrimaryButton } from '@/design/Form';
import { PressableScale } from '@/design/motion';
import { fonts, useTheme } from '@/design/theme';

type Slide = { key: string; title: string; body: string; art: () => React.ReactNode };

/**
 * First-launch intro (shown once per install, before Welcome). Three honest promises of the product, each drawn
 * with the app's own UI pieces rather than stock art. Swipe or tap Devam; "Atla" is always one tap away.
 * The pager is a native paging scroll; the dots follow the finger on the UI thread.
 */
export default function Intro() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const x = useSharedValue(0);
  const [page, setPage] = useState(0);
  const [pagerH, setPagerH] = useState(0); // pages fill the pager exactly (horizontal scrollers do not stretch children on web)
  const list = useRef<Animated.ScrollView>(null);

  const slides: Slide[] = [
    { key: 'discover', title: 'Yakınındakileri keşfet', body: 'Her karıştırmada semtinden yeni insanlar. Kaydırmak yok, puanlamak yok: bir dokunuşla profiline git, istersen yaz.', art: () => <DiscoverArt /> },
    { key: 'anon', title: 'İlk mesaj anonim', body: 'Karşı taraf kim olduğunu bilmeden yazışırsınız. Profilini ne zaman göstereceğine yalnızca sen karar verirsin.', art: () => <AnonArt /> },
    { key: 'safe', title: 'Kontrol sende', body: 'Engelle, bildir, istemediğin kişiden bir daha mesaj alma. Fotoğraflar kilitli gelir; konumun asla paylaşılmaz.', art: () => <SafeArt /> },
  ];
  const last = page === slides.length - 1;

  const finish = () => { void setPref('intro_seen', '1'); router.replace('/welcome'); };
  const next = () => {
    if (last) return finish();
    list.current?.scrollTo({ x: (page + 1) * width, animated: !reduced });
  };
  const onScroll = useAnimatedScrollHandler((e) => { x.set(e.contentOffset.x); });
  // the page follows the scroll position itself, whether it moved by finger, by button or by keyboard
  useAnimatedReaction(() => Math.round(x.get() / Math.max(1, width)), (p, prev) => { if (p !== prev) scheduleOnRN(setPage, p); }, [width]);

  return (
    <View style={[styles.fill, { backgroundColor: c.canvas }]}>
      <LinearGradient pointerEvents="none" colors={[c.plusFrameFrom, 'transparent']} start={{ x: 1, y: 0 }} end={{ x: 0.2, y: 0.55 }} style={[StyleSheet.absoluteFill, { opacity: 0.16 }]} />
      <View style={[styles.top, { paddingTop: insets.top + space.s }]}>
        <BrandLockup size={30} />
        {!last ? (
          <PressableScale haptic="none" accessibilityRole="button" accessibilityLabel="Tanıtımı atla" onPress={finish} style={styles.skip}>
            <Text style={[styles.skipText, { color: c.textSecondary }]}>Atla</Text>
          </PressableScale>
        ) : <View style={styles.skip} />}
      </View>

      <Animated.ScrollView ref={list} horizontal pagingEnabled showsHorizontalScrollIndicator={false} bounces={false} style={styles.pager}
        onLayout={(e) => setPagerH(e.nativeEvent.layout.height)}
        onScroll={onScroll} scrollEventThrottle={16}>
        {slides.map((s, i) => (
          <View key={s.key} style={[styles.slide, { width, height: pagerH || undefined }]} accessible accessibilityLabel={`${i + 1}. sayfa, ${slides.length} sayfadan. ${s.title}. ${s.body}`}>
            <View style={styles.art}>{s.art()}</View>
            <Animated.Text entering={FadeIn.duration(reduced ? 120 : 360)} style={[styles.title, { color: c.textPrimary }]}>{s.title}</Animated.Text>
            <Text style={[styles.body, { color: c.textSecondary }]}>{s.body}</Text>
          </View>
        ))}
      </Animated.ScrollView>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + space.l }]}>
        <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {slides.map((s, i) => <Dot key={s.key} i={i} x={x} width={width} active={c.brand} idle={c.hairline} />)}
        </View>
        <PrimaryButton label={last ? 'Başlayalım' : 'Devam'} onPress={next} />
      </View>
    </View>
  );
}

function Dot({ i, x, width, active, idle }: { i: number; x: SharedValue<number>; width: number; active: string; idle: string }) {
  const style = useAnimatedStyle(() => {
    const p = interpolate(x.get() / width, [i - 1, i, i + 1], [0, 1, 0], Extrapolation.CLAMP);
    return { width: 8 + 18 * p, opacity: 0.45 + 0.55 * p };
  });
  const fill = useAnimatedStyle(() => ({ opacity: interpolate(x.get() / width, [i - 0.6, i, i + 0.6], [0, 1, 0], Extrapolation.CLAMP) }));
  return (
    <Animated.View style={[styles.dot, style, { backgroundColor: idle }]}>
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: 4, backgroundColor: active }, fill]} />
    </Animated.View>
  );
}

// ---------- illustrations, drawn with the app's own pieces ----------

function MiniCard({ name, meta, tier, rotate, offset }: { name: string; meta: string; tier: 'BOOST' | 'PLUS' | 'STANDARD'; rotate: string; offset: number }) {
  const { c, name: theme } = useTheme();
  const dark = theme === 'dark';
  const frame = tier === 'BOOST' ? ['#FF8CDC', '#9C4BE6'] : tier === 'PLUS' ? ['#FFDC96', '#D6A046'] : [c.hairline, c.hairline];
  const fill = tier === 'BOOST' ? (dark ? ['#2A1533', '#16131D'] : ['#FBEDF8', '#FFFFFF']) : tier === 'PLUS' ? (dark ? ['#2A2116', '#17150F'] : ['#FFF5DF', '#FFFFFF']) : [c.surface, c.surface];
  return (
    <LinearGradient colors={frame as [string, string]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.miniFrame, { transform: [{ translateY: offset }, { rotate }] }]}>
      <LinearGradient colors={fill as [string, string]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.miniCard}>
        <View style={[styles.miniAvatar, { backgroundColor: tier === 'BOOST' ? '#B65CC9' : tier === 'PLUS' ? '#3F7CEB' : '#1F9DAA' }]}><Text style={styles.miniInitial}>{name[0]}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.miniName, { color: c.textPrimary }]}>{name}</Text>
          <Text style={[styles.miniMeta, { color: c.textSecondary }]}>{meta}</Text>
        </View>
        {tier !== 'STANDARD' ? (
          <View style={[styles.miniPill, { backgroundColor: tier === 'BOOST' ? '#E9559F' : '#F6DA97' }]}>
            <Text style={[styles.miniPillText, { color: tier === 'BOOST' ? '#fff' : '#3A2400' }]}>{tier}</Text>
          </View>
        ) : null}
      </LinearGradient>
    </LinearGradient>
  );
}

function DiscoverArt() {
  const { c } = useTheme();
  return (
    <View style={styles.artBox}>
      <MiniCard name="Deniz" meta="Kadıköy · İstanbul" tier="BOOST" rotate="-3deg" offset={0} />
      <MiniCard name="Ece" meta="Moda · İstanbul" tier="PLUS" rotate="2deg" offset={-6} />
      <MiniCard name="Arda" meta="Üsküdar · İstanbul" tier="STANDARD" rotate="-1deg" offset={-12} />
      <View style={[styles.shuffle, { backgroundColor: c.brand }]}>
        <Ionicons name="shuffle" size={18} color={c.onBrand} />
        <Text style={[styles.shuffleText, { color: c.onBrand }]}>Karıştır</Text>
      </View>
    </View>
  );
}

function AnonArt() {
  const { c } = useTheme();
  return (
    <View style={styles.artBox}>
      <View style={styles.chatRow}>
        <View style={[styles.anonAvatar, { backgroundColor: c.raised }]}>
          <View style={[styles.arc, { borderColor: c.textTertiary, left: 9, top: 13 }]} />
          <View style={[styles.arc, { borderColor: c.textSecondary, left: 19, top: 16 }]} />
        </View>
        <View style={[styles.bubble, { backgroundColor: c.bubbleTheirs }]}><Text style={[styles.bubbleText, { color: c.textPrimary }]}>Selam, profilindeki fotoğraf çok güzel.</Text></View>
      </View>
      <View style={[styles.bubble, styles.mine, { backgroundColor: c.bubbleMine }]}><Text style={[styles.bubbleText, { color: c.onBubbleMine }]}>Teşekkürler! Sen kimsin?</Text></View>
      <View style={[styles.reveal, { backgroundColor: c.surface, borderColor: c.hairline }]}>
        <Ionicons name="eye-off-outline" size={16} color={c.textSecondary} />
        <Text style={[styles.revealText, { color: c.textSecondary }]}>Karşı taraf seni görmüyor</Text>
        <Text style={[styles.revealCta, { color: c.brandText }]}>Göster</Text>
      </View>
    </View>
  );
}

function SafeArt() {
  const { c } = useTheme();
  const chip = (icon: React.ComponentProps<typeof Ionicons>['name'], label: string) => (
    <View style={[styles.chip, { backgroundColor: c.surface, borderColor: c.hairline }]}>
      <Ionicons name={icon} size={15} color={c.textPrimary} /><Text style={[styles.chipText, { color: c.textPrimary }]}>{label}</Text>
    </View>
  );
  return (
    <View style={[styles.artBox, { alignItems: 'center' }]}>
      <View style={[styles.shieldRing, { borderColor: c.hairline }]}>
        <View style={[styles.shield, { backgroundColor: c.surface, borderColor: c.hairline }]}>
          <Ionicons name="shield-checkmark" size={56} color={c.brandText} />
        </View>
      </View>
      <View style={styles.chips}>{chip('ban-outline', 'Engelle')}{chip('flag-outline', 'Bildir')}{chip('lock-closed-outline', 'Kilitli fotoğraf')}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.gutter, minHeight: 56 },
  skip: { minWidth: 64, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
  skipText: { fontFamily: fonts.semibold, fontSize: typeScale.body.size },
  pager: { flex: 1 },
  slide: { paddingHorizontal: space.gutter + 4, justifyContent: 'center' },
  art: { minHeight: 280, justifyContent: 'center', marginBottom: space.xxl },
  title: { fontFamily: fonts.displayHeavy, fontSize: typeScale.title1.size + 4, lineHeight: typeScale.title1.line + 4, letterSpacing: -0.6, marginBottom: space.m },
  body: { fontFamily: fonts.regular, fontSize: typeScale.body.size + 1, lineHeight: 25, maxWidth: 360 },
  bottom: { paddingHorizontal: space.gutter, gap: space.l },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { height: 8, borderRadius: 4, overflow: 'hidden' },
  artBox: { gap: space.s },
  miniFrame: { borderRadius: radius.card, padding: 1 },
  miniCard: { borderRadius: radius.card - 1, flexDirection: 'row', alignItems: 'center', gap: space.m, padding: space.m },
  miniAvatar: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  miniInitial: { fontFamily: fonts.displayHeavy, fontSize: 18, color: '#fff' },
  miniName: { fontFamily: fonts.display, fontSize: typeScale.body.size + 1 },
  miniMeta: { fontFamily: fonts.medium, fontSize: typeScale.caption.size + 1 },
  miniPill: { paddingHorizontal: 9, height: 24, borderRadius: radius.pill, justifyContent: 'center' },
  miniPillText: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.6 },
  shuffle: { alignSelf: 'center', marginTop: space.m, flexDirection: 'row', alignItems: 'center', gap: space.s, paddingHorizontal: space.xl, height: 48, borderRadius: radius.pill },
  shuffleText: { fontFamily: fonts.bold, fontSize: typeScale.body.size },
  chatRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.s },
  anonAvatar: { width: 44, height: 44, borderRadius: 22, overflow: 'hidden' },
  arc: { position: 'absolute', width: 18, height: 18, borderRadius: 9, borderWidth: 2.5 },
  bubble: { maxWidth: '78%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.bubble },
  bubbleText: { fontFamily: fonts.regular, fontSize: typeScale.body.size, lineHeight: 21 },
  mine: { alignSelf: 'flex-end' },
  reveal: { flexDirection: 'row', alignItems: 'center', gap: space.s, marginTop: space.m, paddingHorizontal: space.m, minHeight: 44, borderRadius: radius.pill, borderWidth: 1 },
  revealText: { flex: 1, fontFamily: fonts.medium, fontSize: typeScale.caption.size + 1 },
  revealCta: { fontFamily: fonts.bold, fontSize: typeScale.caption.size + 1 },
  shieldRing: { width: 168, height: 168, borderRadius: 84, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: space.l },
  shield: { width: 124, height: 124, borderRadius: 62, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.s },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 36, borderRadius: radius.pill, borderWidth: 1 },
  chipText: { fontFamily: fonts.semibold, fontSize: typeScale.bodySmall.size },
});
