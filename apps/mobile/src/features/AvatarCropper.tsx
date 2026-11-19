import { radius, space, type as typeScale } from '@flero/ui-tokens';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { reachable, type Crop, type PickedImage } from '@/api/avatar';
import { PressableScale } from '@/design/motion';
import { fonts, useTheme } from '@/design/theme';
import { bounds, cropFor, maxZoom } from './cropMath';

const SETTLE = { duration: 300, dampingRatio: 1 } as const; // snap back inside the frame, no overshoot

/**
 * Square avatar cropper (FLERO's own, identical on iOS, Android and web). Drag to position, pinch (or −/+) to
 * zoom. The image always covers the square: a drag past the edge is allowed with resistance and springs back
 * on release. A circle guide shows how the avatar will look; thirds appear while adjusting. Gestures run on the
 * UI thread; only the final crop crosses to JS.
 */
export function AvatarCropper({ image, busy, error, onCancel, onConfirm }: {
  image: PickedImage | null; busy: boolean; error: string | null; onCancel: () => void; onConfirm: (crop: Crop) => void;
}) {
  return (
    <Modal visible={!!image} animationType="fade" onRequestClose={onCancel} statusBarTranslucent presentationStyle="fullScreen">
      <GestureHandlerRootView style={{ flex: 1 }}>
        {image ? <Editor image={image} busy={busy} error={error} onCancel={onCancel} onConfirm={onConfirm} /> : null}
      </GestureHandlerRootView>
    </Modal>
  );
}

function Editor({ image, busy, error, onCancel, onConfirm }: { image: PickedImage; busy: boolean; error: string | null; onCancel: () => void; onConfirm: (crop: Crop) => void }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const F = Math.min(width - space.xxl * 2, 360);
  const g = useMemo(() => ({ W: image.width, H: image.height, F }), [image.width, image.height, F]);
  const zMax = maxZoom(g);
  const s0 = F / Math.min(image.width, image.height);

  const zoom = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const startZ = useSharedValue(1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const active = useSharedValue(0);
  const [zoomLabel, setZoomLabel] = useState(1);

  const settle = () => {
    'worklet';
    const z = Math.min(Math.max(zoom.get(), 1), zMax);
    const b = bounds(g, z);
    zoom.set(withSpring(z, SETTLE));
    tx.set(withSpring(Math.min(Math.max(tx.get(), -b.x), b.x), SETTLE));
    ty.set(withSpring(Math.min(Math.max(ty.get(), -b.y), b.y), SETTLE));
  };
  /** Past the edge the image follows at a third of the finger (rubber band), never a hard stop. */
  const rubber = (v: number, limit: number) => {
    'worklet';
    if (v > limit) return limit + (v - limit) / 3;
    if (v < -limit) return -limit + (v + limit) / 3;
    return v;
  };

  const pan = Gesture.Pan()
    .onStart(() => { startX.set(tx.get()); startY.set(ty.get()); active.set(withTiming(1, { duration: 120 })); })
    .onUpdate((e) => {
      const b = bounds(g, zoom.get());
      tx.set(rubber(startX.get() + e.translationX, b.x));
      ty.set(rubber(startY.get() + e.translationY, b.y));
    })
    .onEnd(() => { settle(); active.set(withTiming(0, { duration: 200 })); });
  const pinch = Gesture.Pinch()
    .onStart(() => { startZ.set(zoom.get()); active.set(withTiming(1, { duration: 120 })); })
    .onUpdate((e) => {
      zoom.set(Math.min(Math.max(startZ.get() * e.scale, 0.85), zMax * 1.15));
      const b = bounds(g, Math.max(zoom.get(), 1));
      tx.set(rubber(tx.get(), b.x));
      ty.set(rubber(ty.get(), b.y));
    })
    .onEnd(() => {
      settle();
      active.set(withTiming(0, { duration: 200 }));
      scheduleOnRN(setZoomLabel, Math.min(Math.max(zoom.get(), 1), zMax));
    });
  const gesture = Gesture.Simultaneous(pan, pinch);

  const imageStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.get() }, { translateY: ty.get() }, { scale: zoom.get() }] }));
  const gridStyle = useAnimatedStyle(() => ({ opacity: active.get() }));

  const step = (dir: 1 | -1) => {
    const z = Math.min(Math.max(zoom.get() * (dir > 0 ? 1.25 : 0.8), 1), zMax);
    const b = bounds(g, z);
    const anim = (v: number) => (reduced ? v : withTiming(v, { duration: 180 }));
    zoom.set(anim(z));
    tx.set(anim(Math.min(Math.max(tx.get(), -b.x), b.x)));
    ty.set(anim(Math.min(Math.max(ty.get(), -b.y), b.y)));
    setZoomLabel(z);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  };
  const reset = () => { zoom.set(withTiming(1, { duration: 200 })); tx.set(withTiming(0, { duration: 200 })); ty.set(withTiming(0, { duration: 200 })); setZoomLabel(1); };
  const confirm = () => onConfirm(cropFor(g, Math.min(Math.max(zoom.get(), 1), zMax), tx.get(), ty.get()));

  const mask = 'rgba(5,5,10,0.72)';
  return (
    <View style={[styles.fill, { backgroundColor: '#050508', paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, space.l) }]}>
      <View style={styles.header}>
        <PressableScale haptic="none" accessibilityRole="button" onPress={onCancel} disabled={busy} style={styles.headerBtn}>
          <Text style={[styles.headerText, { color: '#F2F2F7' }]}>Vazgeç</Text>
        </PressableScale>
        <Text style={[styles.title, { color: '#F2F2F7' }]} accessibilityRole="header">Fotoğrafı kırp</Text>
        <PressableScale haptic="none" accessibilityRole="button" accessibilityLabel="Sıfırla" onPress={reset} disabled={busy} style={styles.headerBtn}>
          <Ionicons name="refresh" size={20} color="#F2F2F7" />
        </PressableScale>
      </View>

      <GestureDetector gesture={gesture}>
        <View style={styles.stage} collapsable={false} accessible accessibilityLabel="Kırpma alanı. Fotoğrafı sürükleyerek konumlandır, iki parmakla yakınlaştır.">
          <View style={{ width: F, height: F }}>
            <Animated.Image source={{ uri: image.blob ? image.uri : reachable(image.uri) }} resizeMode="cover"
              style={[{ position: 'absolute', width: image.width * s0, height: image.height * s0, left: (F - image.width * s0) / 2, top: (F - image.height * s0) / 2 }, imageStyle]} />
          </View>
          {/* mask with a square window, drawn as four bands so the window stays sharp on every platform */}
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <View style={{ flex: 1, backgroundColor: mask }} />
            <View style={{ height: F, flexDirection: 'row' }}>
              <View style={{ flex: 1, backgroundColor: mask }} />
              <View style={{ width: F, height: F, borderWidth: 1, borderColor: 'rgba(255,255,255,0.85)' }}>
                <View style={[StyleSheet.absoluteFill, { borderRadius: F / 2, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' }]} />
                <Animated.View style={[StyleSheet.absoluteFill, gridStyle]}>
                  {[1, 2].map((i) => <View key={`v${i}`} style={[styles.gridV, { left: (F / 3) * i }]} />)}
                  {[1, 2].map((i) => <View key={`h${i}`} style={[styles.gridH, { top: (F / 3) * i }]} />)}
                </Animated.View>
              </View>
              <View style={{ flex: 1, backgroundColor: mask }} />
            </View>
            <View style={{ flex: 1, backgroundColor: mask }} />
          </View>
        </View>
      </GestureDetector>

      <View style={styles.footer}>
        {error ? <Text style={[styles.error, { color: c.danger }]} accessibilityLiveRegion="assertive">{error}</Text> : (
          <Text style={styles.hint}>Sürükle ve yakınlaştır · daire profilinde görünecek alan</Text>
        )}
        <View style={styles.zoomRow}>
          <PressableScale haptic="none" accessibilityRole="button" accessibilityLabel="Uzaklaştır" disabled={busy || zoomLabel <= 1.001} onPress={() => step(-1)} style={[styles.zoomBtn, { opacity: zoomLabel <= 1.001 ? 0.4 : 1 }]}>
            <Ionicons name="remove" size={22} color="#F2F2F7" />
          </PressableScale>
          <Text style={styles.zoomText} accessibilityLabel={`Yakınlaştırma ${zoomLabel.toFixed(1)} kat`}>{zoomLabel.toFixed(1)}×</Text>
          <PressableScale haptic="none" accessibilityRole="button" accessibilityLabel="Yakınlaştır" disabled={busy || zoomLabel >= zMax - 0.001} onPress={() => step(1)} style={[styles.zoomBtn, { opacity: zoomLabel >= zMax - 0.001 ? 0.4 : 1 }]}>
            <Ionicons name="add" size={22} color="#F2F2F7" />
          </PressableScale>
        </View>
        <PressableScale haptic="medium" accessibilityRole="button" accessibilityState={{ busy, disabled: busy }} disabled={busy} onPress={confirm} style={[styles.save, { backgroundColor: c.brand }]}>
          {busy ? <ActivityIndicator color={c.onBrand} /> : <Text style={[styles.saveText, { color: c.onBrand }]}>Kaydet</Text>}
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.s, minHeight: 56 },
  headerBtn: { minWidth: 64, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.m },
  headerText: { fontFamily: fonts.semibold, fontSize: typeScale.body.size },
  title: { fontFamily: fonts.display, fontSize: typeScale.headline.size + 1 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  gridV: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.5)' },
  gridH: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.5)' },
  footer: { paddingHorizontal: space.gutter, gap: space.l, alignItems: 'center' },
  hint: { fontFamily: fonts.medium, fontSize: typeScale.caption.size, color: 'rgba(242,242,247,0.65)' },
  error: { fontFamily: fonts.semibold, fontSize: typeScale.bodySmall.size, textAlign: 'center' },
  zoomRow: { flexDirection: 'row', alignItems: 'center', gap: space.l },
  zoomBtn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)' },
  zoomText: { minWidth: 48, textAlign: 'center', fontFamily: fonts.semibold, fontSize: typeScale.body.size, color: '#F2F2F7', fontVariant: ['tabular-nums'] },
  save: { alignSelf: 'stretch', minHeight: 54, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  saveText: { fontFamily: fonts.bold, fontSize: typeScale.body.size + 1 },
});
