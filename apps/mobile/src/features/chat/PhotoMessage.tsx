import { radius, space, type as typeScale } from '@flero/ui-tokens';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { cloneElement, isValidElement, useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, Modal, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { reachable } from '@/api/avatar';
import { getMedia, mediaErrorText, openOneView, renderedOneView, unlockMedia, type MediaKind, type MediaViewT } from '@/api/chatMedia';
import { api } from '@/api/client';
import { GoldCoin } from '@/design/GoldCoin';
import { PressableScale } from '@/design/motion';
import { Sheet } from '@/design/Sheet';
import { fonts, useTheme } from '@/design/theme';
import { TickIcon, type Tick } from './Ticks';

/**
 * Chat photos, WhatsApp-style:
 *   PERSISTENT → the photo sits inside a chat bubble at its real proportions; time + ticks float on the bottom-right
 *                corner over a soft shade. Locked: the same shape filled with a pattern (never pixels of the photo,
 *                REQ-MED-05) and a centred "🔒 10 Gold" pill, like WhatsApp's download pill.
 *   ONE_VIEW   → a compact pill bubble with the circled "1": "Fotoğraf" → tap to open once → "Açıldı" (dashed 1).
 * Every state comes from GET /v1/media/{id}; signed URLs live 300 s, so the query refreshes before they expire.
 */
const MAX_W = 252; const MAX_H = 330; const MIN_W = 150; const MIN_H = 120; const PAD = 3;

/** Bubble size from the photo's pixel size (contained in MAX, never smaller than MIN). */
export function photoBox(w?: number | null, h?: number | null) {
  if (!w || !h) return { width: MAX_W - PAD * 2, height: MAX_W - PAD * 2 };
  const s = Math.min((MAX_W - PAD * 2) / w, MAX_H / h);
  return { width: Math.max(MIN_W, Math.round(w * s)), height: Math.max(MIN_H, Math.round(h * s)) };
}

type Footer = { time: string; tick?: Tick };
const day = (iso: string) => new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));

export function PhotoBubble({ mid, mine, time, tick, tail }: { mid: string; mine: boolean; time: string; tick?: Tick; tail: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['media', mid], queryFn: () => getMedia(mid), staleTime: 240_000 });
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [viewer, setViewer] = useState<{ url: string; oneView?: { lease: string } } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const m = q.data;
  const footer: Footer = { time, tick };

  const openOne = async () => {
    setBusy(true); setErr(null);
    try { const l = await openOneView(mid); setViewer({ url: l.url, oneView: { lease: l.lease_id } }); }
    catch (e) { setErr(mediaErrorText(e)); void qc.invalidateQueries({ queryKey: ['media', mid] }); }
    finally { setBusy(false); }
  };
  const closeViewer = () => { const one = !!viewer?.oneView; setViewer(null); if (one) void qc.invalidateQueries({ queryKey: ['media', mid] }); };

  if (!m) return <PhotoFrame mine={mine} tail={tail} box={photoBox()} footer={footer}><Pattern /><Center>{q.isError ? <Ionicons name="image-outline" size={26} color="#fff" /> : <ActivityIndicator color="#fff" />}</Center></PhotoFrame>;

  if (m.state === 'EXPIRED' || m.state === 'REMOVED' || m.state === 'REJECTED') {
    return <Pill mine={mine} tail={tail} footer={footer} icon={<Ionicons name="time-outline" size={18} />} label={m.state === 'EXPIRED' ? 'Fotoğrafın süresi doldu' : 'Fotoğraf kaldırıldı'} muted />;
  }

  // ---------- one-view: the WhatsApp "view once" pill ----------
  if (m.kind === 'ONE_VIEW') {
    const consumed = !mine && m.one_view_state === 'CONSUMED';
    const onPress = mine ? (m.access ? () => setViewer({ url: reachable(m.access!.url) }) : undefined)
      : m.locked ? () => { setErr(null); setUnlockOpen(true); }
      : consumed ? undefined : () => void openOne();
    return (
      <>
        <Pill mine={mine} tail={tail} footer={footer} onPress={onPress} busy={busy}
          icon={<OneIcon consumed={consumed} />} label={consumed ? 'Açıldı' : 'Fotoğraf'} muted={consumed}
          a11y={mine ? 'Gönderdiğin tek görüntülük fotoğraf, görmek için dokun' : consumed ? 'Tek görüntülük fotoğraf, açıldı' : m.locked ? `Tek görüntülük fotoğraf, ${m.unlock_price_gold} Gold ile açılır` : 'Tek görüntülük fotoğraf, açmak için dokun'}
          trailing={m.locked && !mine ? <PriceChip gold={m.unlock_price_gold} /> : null} />
        {err ? <Text style={[styles.err, { alignSelf: mine ? 'flex-end' : 'flex-start' }]}>{err}</Text> : null}
        <UnlockSheet visible={unlockOpen} media={m} onClose={() => setUnlockOpen(false)} onUnlocked={(v) => { qc.setQueryData(['media', mid], v); setUnlockOpen(false); }} />
        <Viewer state={viewer} onClose={closeViewer} mid={mid} time={time} />
      </>
    );
  }

  // ---------- persistent ----------
  const box = photoBox(m.width, m.height);
  if (m.state === 'PROCESSING') return <PhotoFrame mine={mine} tail={tail} box={box} footer={footer}><Pattern /><Center><ActivityIndicator color="#fff" /></Center></PhotoFrame>;

  if (m.access) {
    const url = reachable(m.access.url);
    return (
      <>
        <PhotoFrame mine={mine} tail={tail} box={box} footer={footer} onPress={() => setViewer({ url })} a11y={mine ? 'Gönderdiğin fotoğraf, büyütmek için dokun' : 'Fotoğraf, büyütmek için dokun'}>
          <Image source={{ uri: url }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors onError={() => void q.refetch()} />
        </PhotoFrame>
        <Viewer state={viewer} onClose={closeViewer} mid={mid} time={time} />
      </>
    );
  }

  // locked: same shape as the photo will have, no pixels of it
  return (
    <>
      <PhotoFrame mine={mine} tail={tail} box={box} footer={footer} onPress={() => { setErr(null); setUnlockOpen(true); }} a11y={`Fotoğraf kilitli, ${m.unlock_price_gold} Gold ile açılır`}>
        <Pattern />
        <Center>
          <View style={styles.lockPill}>
            <Ionicons name="lock-closed" size={14} color="#fff" />
            <GoldCoin size={15} />
            <Text style={styles.lockPillText}>{m.unlock_price_gold} Gold</Text>
          </View>
        </Center>
      </PhotoFrame>
      <UnlockSheet visible={unlockOpen} media={m} onClose={() => setUnlockOpen(false)} onUnlocked={(v) => { qc.setQueryData(['media', mid], v); setUnlockOpen(false); }} />
    </>
  );
}

/** A photo on its way out: the real picked image, dimmed, with progress or a retry. */
export function PendingPhotoBubble({ uri, width, height, kind, failed, error, onRetry, time }: {
  uri: string; width: number; height: number; kind: MediaKind; failed: boolean; error?: string; onRetry: () => void; time: string;
}) {
  const footer: Footer = { time, tick: 'sending' };
  if (kind === 'ONE_VIEW') {
    return (
      <>
        <Pill mine tail footer={footer} icon={failed ? <Ionicons name="alert-circle" size={20} color="#FF6B6B" /> : <OneIcon spinning />} label="Fotoğraf"
          onPress={failed ? onRetry : undefined} a11y={failed ? `${error ?? 'Gönderilemedi'}. Tekrar dene` : 'Tek görüntülük fotoğraf gönderiliyor'} />
        {failed ? <Text style={[styles.err, { alignSelf: 'flex-end' }]}>{error ?? 'Gönderilemedi'} · tekrar dene</Text> : null}
      </>
    );
  }
  return (
    <>
      <PhotoFrame mine tail box={photoBox(width, height)} footer={footer} onPress={failed ? onRetry : undefined} a11y={failed ? `${error ?? 'Gönderilemedi'}. Tekrar dene` : 'Fotoğraf gönderiliyor'}>
        <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]} />
        <Center>
          <View style={styles.progress}>{failed ? <Ionicons name="refresh" size={24} color="#fff" /> : <ActivityIndicator color="#fff" />}</View>
        </Center>
      </PhotoFrame>
      {failed ? <Text style={[styles.err, { alignSelf: 'flex-end' }]}>{error ?? 'Gönderilemedi'} · tekrar dene</Text> : null}
    </>
  );
}

// ---------- building blocks ----------

/** The chat bubble around a photo: bubble colour, 3 px frame, tail corner, footer floating on a soft shade. */
function PhotoFrame({ mine, tail, box, footer, onPress, a11y, children }: {
  mine: boolean; tail: boolean; box: { width: number; height: number }; footer: Footer; onPress?: () => void; a11y?: string; children: ReactNode;
}) {
  const { c } = useTheme();
  const shape = { borderRadius: radius.bubble, [mine ? 'borderBottomRightRadius' : 'borderBottomLeftRadius']: tail ? 6 : radius.bubble };
  const inner = { width: box.width, height: box.height, borderRadius: radius.bubble - PAD, [mine ? 'borderBottomRightRadius' : 'borderBottomLeftRadius']: tail ? 4 : radius.bubble - PAD };
  return (
    <PressableScale haptic="none" disabled={!onPress} onPress={onPress} accessibilityRole={onPress ? 'imagebutton' : 'image'} accessibilityLabel={a11y}
      style={[{ padding: PAD, backgroundColor: mine ? c.bubbleMine : c.bubbleTheirs }, shape]}>
      <View style={[styles.inner, inner]}>
        {children}
        <LinearGradient pointerEvents="none" colors={['transparent', 'rgba(0,0,0,0.5)']} style={styles.shade} />
        <View pointerEvents="none" style={styles.overlayFooter}>
          <Text style={styles.overlayTime}>{footer.time}</Text>
          {footer.tick ? <TickIcon tick={footer.tick} onMedia /> : null}
        </View>
      </View>
    </PressableScale>
  );
}

/** The compact bubble used for one-view photos and for gone photos. */
function Pill({ mine, tail, footer, icon, label, muted, onPress, busy, trailing, a11y }: {
  mine: boolean; tail: boolean; footer: Footer; icon: ReactNode; label: string; muted?: boolean; onPress?: () => void; busy?: boolean; trailing?: ReactNode; a11y?: string;
}) {
  const { c } = useTheme();
  const fg = mine ? c.onBubbleMine : c.textPrimary;
  const sub = mine ? c.onBubbleMine : c.textTertiary;
  return (
    <PressableScale haptic="light" disabled={!onPress || busy} onPress={onPress} accessibilityRole={onPress ? 'button' : 'text'} accessibilityLabel={a11y ?? label}
      style={[styles.pill, { backgroundColor: mine ? c.bubbleMine : c.bubbleTheirs }, { [mine ? 'borderBottomRightRadius' : 'borderBottomLeftRadius']: tail ? 6 : radius.bubble }]}>
      <View style={styles.pillIcon}>{busy ? <ActivityIndicator color={fg} /> : <IconTint color={muted ? sub : fg}>{icon}</IconTint>}</View>
      <Text style={[styles.pillLabel, { color: muted ? sub : fg, fontStyle: muted ? 'italic' : 'normal', opacity: muted ? 0.8 : 1 }]} numberOfLines={1}>{label}</Text>
      {trailing}
      <View style={styles.pillFooter}>
        <Text style={[styles.pillTime, { color: sub, opacity: mine ? 0.7 : 1 }]}>{footer.time}</Text>
        {footer.tick ? <TickIcon tick={footer.tick} color={mine ? c.onBubbleMine : undefined} /> : null}
      </View>
    </PressableScale>
  );
}

/** Passes a colour to a single icon child (Ionicons or OneIcon). */
function IconTint({ color, children }: { color: string; children: ReactNode }) {
  if (isValidElement<{ color?: string }>(children) && children.props.color === undefined) return cloneElement(children, { color });
  return <>{children}</>;
}

/** WhatsApp's view-once mark: a circled "1"; dashed once it has been opened. */
function OneIcon({ consumed, spinning, color }: { consumed?: boolean; spinning?: boolean; color?: string }) {
  if (spinning) return <ActivityIndicator color={color} />;
  return (
    <View style={[styles.one, { borderColor: color, borderStyle: consumed ? 'dashed' : 'solid' }]}>
      <Text style={[styles.oneText, { color }]}>1</Text>
    </View>
  );
}

function PriceChip({ gold }: { gold: number }) {
  const { c } = useTheme();
  return (
    <View style={[styles.priceChip, { backgroundColor: c.goldFill }]}>
      <GoldCoin size={13} inverted />
      <Text style={[styles.priceChipText, { color: c.onGoldFill }]}>{gold}</Text>
    </View>
  );
}

/** Procedural fill for a photo nobody may see yet: diagonal lines, no relation to the image. */
function Pattern() {
  const { c } = useTheme();
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: c.raised }]}>
      {Array.from({ length: 18 }, (_, i) => <View key={i} style={[styles.stripe, { left: -160 + i * 24, backgroundColor: c.hairline }]} />)}
    </View>
  );
}
const Center = ({ children }: { children: ReactNode }) => <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, styles.center]}>{children}</View>;

/** Confirm the price, the balance and how long it stays viewable (DEC-05), then spend Gold exactly once. */
function UnlockSheet({ visible, media, onClose, onUnlocked }: { visible: boolean; media: MediaViewT; onClose: () => void; onUnlocked: (v: MediaViewT) => void }) {
  const { c } = useTheme();
  const qc = useQueryClient();
  const wallet = useQuery({ queryKey: ['wallet'], queryFn: () => api<{ available: number }>('/v1/wallet').then((r) => r.data), enabled: visible });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const balance = wallet.data?.available ?? 0;
  const short = wallet.isSuccess && balance < media.unlock_price_gold;
  const unlock = async () => {
    setBusy(true); setErr(null);
    try { const v = await unlockMedia(media.media_id); void qc.invalidateQueries({ queryKey: ['wallet'] }); onUnlocked(v); }
    catch (e) { setErr(mediaErrorText(e)); void qc.invalidateQueries({ queryKey: ['wallet'] }); }
    finally { setBusy(false); }
  };
  const oneView = media.kind === 'ONE_VIEW';
  return (
    <Sheet visible={visible} onClose={onClose} title={oneView ? 'Tek görüntülük fotoğrafı aç' : 'Fotoğrafı aç'}>
      <View style={styles.priceRow}>
        <GoldCoin size={28} />
        <Text style={[styles.price, { color: c.textPrimary }]}>{media.unlock_price_gold} Gold</Text>
      </View>
      <Text style={[styles.note, { color: c.textSecondary }]}>
        {oneView ? 'Fotoğrafı yalnızca bir kez görebilirsin; kapattığında bir daha açılamaz. ' : 'Bir kez ödersin, sonra istediğin kadar bakabilirsin. '}
        Bu fotoğraf {day(media.expires_at)} tarihine kadar görüntülenebilir.
      </Text>
      <Text style={[styles.note, { color: c.textTertiary }]}>Bakiyen: {wallet.isSuccess ? `${balance} Gold` : '…'}</Text>
      {err ? <Text style={[styles.note, { color: c.danger }]} accessibilityLiveRegion="assertive">{err}</Text> : null}
      {short ? (
        <PressableScale accessibilityRole="button" onPress={() => { onClose(); router.push('/cuzdan'); }} style={[styles.primary, { backgroundColor: c.brand }]}>
          <Text style={[styles.primaryText, { color: c.onBrand }]}>Gold al</Text>
        </PressableScale>
      ) : (
        <PressableScale accessibilityRole="button" haptic="medium" accessibilityState={{ busy, disabled: busy || !wallet.isSuccess }} disabled={busy || !wallet.isSuccess} onPress={() => void unlock()} style={[styles.primary, { backgroundColor: c.goldFill }]}>
          {busy ? <ActivityIndicator color={c.onGoldFill} /> : <Text style={[styles.primaryText, { color: c.onGoldFill }]}>{media.unlock_price_gold} Gold ile aç</Text>}
        </PressableScale>
      )}
    </Sheet>
  );
}

/**
 * Full-screen viewer (WhatsApp-like black stage). For a one-view photo the URL is the single-use lease: it is shown
 * once and reported "rendered" only after it actually loaded (doc 08 §8), so a failed load never consumes it.
 */
function Viewer({ state, onClose, mid, time }: { state: { url: string; oneView?: { lease: string } } | null; onClose: () => void; mid: string; time: string }) {
  const insets = useSafeAreaInsets();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const one = state?.oneView;
  return (
    <Modal visible={!!state} animationType="fade" onRequestClose={onClose} statusBarTranslucent presentationStyle="fullScreen" onShow={() => { setLoaded(false); setFailed(false); }}>
      <View style={[styles.viewer, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.viewerBar}>
          <PressableScale haptic="none" accessibilityRole="button" accessibilityLabel="Kapat" onPress={onClose} style={styles.viewerClose}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </PressableScale>
          <View style={{ flex: 1 }}>
            <Text style={styles.viewerTitle}>{one ? 'Tek görüntülük fotoğraf' : 'Fotoğraf'}</Text>
            <Text style={styles.viewerSub}>{time}</Text>
          </View>
          {one ? <OneIcon color="#fff" /> : null}
        </View>
        {state ? (
          <Image source={{ uri: reachable(state.url), cache: one ? 'reload' : 'default' }} style={styles.viewerImg} resizeMode="contain" accessibilityIgnoresInvertColors
            onLoad={() => { setLoaded(true); if (one) void renderedOneView(mid, one.lease).catch(() => {}); }}
            onError={() => setFailed(true)} />
        ) : null}
        {!loaded && !failed ? <ActivityIndicator style={StyleSheet.absoluteFill} color="#fff" /> : null}
        {failed ? <Text style={styles.viewerFail}>Fotoğraf yüklenemedi. Kapatıp tekrar dene.</Text> : null}
        {one ? <Text style={styles.viewerFoot}>Bu fotoğraf yalnızca bir kez görüntülenebilir. Kapattığında bir daha açılamaz.</Text> : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  inner: { overflow: 'hidden' },
  shade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 44 },
  overlayFooter: { position: 'absolute', right: 8, bottom: 6, flexDirection: 'row', alignItems: 'center', gap: 3 },
  overlayTime: { fontFamily: fonts.medium, fontSize: 11, color: 'rgba(255,255,255,0.95)' },
  center: { alignItems: 'center', justifyContent: 'center' },
  stripe: { position: 'absolute', top: -60, width: 1.5, height: 520, transform: [{ rotate: '35deg' }] },
  lockPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, minHeight: 40, borderRadius: radius.pill, backgroundColor: 'rgba(0,0,0,0.6)' },
  lockPillText: { fontFamily: fonts.bold, fontSize: typeScale.bodySmall.size, color: '#fff' },
  progress: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: space.s, minWidth: 190, maxWidth: 280, minHeight: 50, paddingLeft: space.m, paddingRight: space.s + 2, paddingVertical: space.s, borderRadius: radius.bubble },
  pillIcon: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  pillLabel: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: typeScale.body.size },
  pillFooter: { marginLeft: 'auto', paddingLeft: space.s, flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-end' },
  pillTime: { fontFamily: fonts.medium, fontSize: 11 },
  one: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.6, alignItems: 'center', justifyContent: 'center' },
  oneText: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 14 },
  priceChip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, height: 22, borderRadius: radius.pill },
  priceChipText: { fontFamily: fonts.bold, fontSize: 12 },
  err: { fontFamily: fonts.semibold, fontSize: 12, color: '#FF6B6B', marginTop: 4, maxWidth: 260 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: space.s, marginBottom: space.m },
  price: { fontFamily: fonts.displayHeavy, fontSize: typeScale.title1.size },
  note: { fontFamily: fonts.regular, fontSize: typeScale.bodySmall.size, lineHeight: typeScale.bodySmall.line, marginBottom: space.s },
  primary: { minHeight: 52, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', marginTop: space.m },
  primaryText: { fontFamily: fonts.bold, fontSize: typeScale.body.size },
  viewer: { flex: 1, backgroundColor: '#000' },
  viewerBar: { flexDirection: 'row', alignItems: 'center', gap: space.s, paddingHorizontal: space.s, paddingRight: space.l, minHeight: 60, zIndex: 2 },
  viewerClose: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  viewerTitle: { fontFamily: fonts.semibold, fontSize: typeScale.body.size, color: '#fff' },
  viewerSub: { fontFamily: fonts.medium, fontSize: typeScale.caption.size, color: 'rgba(255,255,255,0.65)' },
  viewerImg: { flex: 1 },
  viewerFail: { position: 'absolute', alignSelf: 'center', top: '50%', fontFamily: fonts.medium, color: 'rgba(255,255,255,0.8)' },
  viewerFoot: { textAlign: 'center', fontFamily: fonts.medium, fontSize: typeScale.caption.size + 1, color: 'rgba(255,255,255,0.7)', paddingHorizontal: space.xl, paddingVertical: space.m },
});
