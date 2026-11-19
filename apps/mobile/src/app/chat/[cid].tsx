import type { ConversationView, Message } from '@flero/contracts';
import { radius, size, space, type as typeScale } from '@flero/ui-tokens';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, useReducedMotion, ZoomIn, ZoomOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { z } from 'zod';
import { api, ApiError, errorText, newKey } from '@/api/client';
import { onRealtime, sendRealtime } from '@/api/realtime';
import { pickImage, type PickedImage, type PickSource } from '@/api/avatar';
import { mediaErrorText, sendChatPhoto, type MediaKind } from '@/api/chatMedia';
import { PendingPhotoBubble, PhotoBubble } from '@/features/chat/PhotoMessage';
import { TickIcon, type Tick } from '@/features/chat/Ticks';
import { enqueue, retry as retryOutbox, useOutbox } from '@/features/chat/outbox';
import { useConnecting } from '@/features/chat/useConnecting';
import { Avatar } from '@/design/Avatar';
import { GoldCoin } from '@/design/GoldCoin';
import { easeOut, PressableScale } from '@/design/motion';
import { Sheet } from '@/design/Sheet';
import { fonts, useTheme } from '@/design/theme';
import { GiftSheet } from '@/features/sheets';
import { t } from '@/i18n/tr';
import { goBack } from '@/design/nav';

type Msg = z.infer<typeof Message>;
type Conv = z.infer<typeof ConversationView>;
type Bubble = { id: string; mine: boolean; kind: Msg['kind']; body: string | null; time: string; pending?: boolean; failed?: boolean; clientId?: string; seq?: number; mediaId?: string | null };
/** A photo on its way: picked → uploading → (server posts the PHOTO message) → replaced by the real bubble. */
type OutPhoto = { id: string; img: PickedImage; kind: MediaKind; status: 'sending' | 'failed'; error?: string };
const hhmm = (iso: string) => new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/**
 * Conversation (S15). The header and every row render ONLY from the counterparty projection (ADR-016): in an
 * anonymous thread the recipient sees "Anonim Kullanıcı" with the abstract avatar and nothing else (DEC-12).
 * Sends are optimistic and idempotent: a bubble keeps its client_msg_id, so a retry can never duplicate it.
 * Reporting and blocking never require knowing who the other person is.
 */
export default function ChatScreen() {
  const { cid, to, name } = useLocalSearchParams<{ cid: string; to?: string; name?: string }>();
  const { c } = useTheme();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<Bubble[]>([]);
  const [giftOpen, setGiftOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [photoKind, setPhotoKind] = useState<MediaKind>('PERSISTENT');
  const [outPhotos, setOutPhotos] = useState<OutPhoto[]>([]);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const uploadPhoto = async (o: OutPhoto) => {
    setOutPhotos((l) => l.map((x) => (x.id === o.id ? { ...x, status: 'sending', error: undefined } : x)));
    try {
      await sendChatPhoto(cid, o.img, o.kind);
      await qc.invalidateQueries({ queryKey: ['messages', cid] });
      void qc.invalidateQueries({ queryKey: ['inbox'] });
      setOutPhotos((l) => l.filter((x) => x.id !== o.id));
    } catch (e) {
      setOutPhotos((l) => l.map((x) => (x.id === o.id ? { ...x, status: 'failed', error: mediaErrorText(e) } : x)));
    }
  };
  const pickPhoto = async (source: PickSource) => {
    setPhotoErr(null);
    try {
      const img = await pickImage(source);
      if (!img) return; // cancelled
      setPhotoOpen(false);
      const o: OutPhoto = { id: newKey(), img, kind: photoKind, status: 'sending' };
      setOutPhotos((l) => [...l, o]);
      requestAnimationFrame(() => scroll.current?.scrollToEnd({ animated: true }));
      void uploadPhoto(o);
    } catch (e) { setPhotoErr(mediaErrorText(e)); }
  };
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [revealOpen, setRevealOpen] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const isNew = cid === 'new';

  const conv = useQuery({ queryKey: ['conversation', cid], queryFn: () => api<Conv>(`/v1/conversations/${cid}`).then((r) => r.data), enabled: !isNew });
  const msgs = useInfiniteQuery({
    queryKey: ['messages', cid],
    queryFn: ({ pageParam }) => api<Msg[]>(`/v1/conversations/${cid}/messages?limit=50${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.next ?? undefined,
    enabled: !isNew,
  });
  const queued = useOutbox(cid);
  const connecting = useConnecting();
  const focused = useIsFocused();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  useEffect(() => { const sub = AppState.addEventListener('change', (st) => setAppActive(st === 'active')); return () => sub.remove(); }, []);
  const visible = focused && appActive;
  const loadingOlder = useRef(false);
  const wallet = useQuery({ queryKey: ['wallet'], queryFn: () => api<{ available: number }>('/v1/wallet').then((r) => r.data) });
  const v = conv.data;
  const cp = v?.counterparty;
  const anonymous = cp?.kind === 'ANONYMOUS';
  const title = isNew ? (name ?? '') : anonymous ? t('chat.anonymous_user') : cp?.kind === 'IDENTIFIED' ? cp.display_name : '';
  const avatarId = isNew ? (to ?? 'new') : anonymous ? cid : cp?.kind === 'IDENTIFIED' ? cp.public_user_id : cid;
  const request = v?.state === 'REQUEST' && v.my_role === 'RECIPIENT';
  const closed = !!v && !v.can_send;

  const server: Bubble[] = useMemo(() => (msgs.data?.pages ?? []).flatMap((p) => p.data).reverse().map((m) => ({
    id: m.message_id, mine: m.mine, kind: m.kind, body: m.body, time: hhmm(m.server_ts), seq: m.seq, mediaId: m.media_id,
  })), [msgs.data]);
  const serverIds = useMemo(() => new Set(server.map((m) => m.id)), [server]);
  const outgoing: Bubble[] = queued.filter((q) => !q.sentId || !serverIds.has(q.sentId)).map((q) => ({
    id: q.sentId ?? `local-${q.clientId}`, clientId: q.clientId, mine: true, kind: 'TEXT', body: q.body, time: hhmm(q.createdAt),
    pending: q.status === 'sending' && !q.sentId, failed: q.status === 'failed', seq: q.seq,
  }));
  const bubbles = [...server, ...outgoing, ...pending];
  const tickOf = (b: Bubble): Tick => {
    if (b.pending || b.seq === undefined) return 'sending';
    if (b.seq <= (v?.peer_read_seq ?? 0)) return 'read';
    if (b.seq <= (v?.peer_delivered_seq ?? 0)) return 'delivered';
    return 'sent';
  };

  // typing: the counterpart's indicator (TTL 5 s, cleared by their next message) and my own heartbeat
  const [peerTyping, setPeerTyping] = useState(false);
  useEffect(() => {
    if (isNew) return;
    let ttl: ReturnType<typeof setTimeout> | undefined;
    const off = onRealtime((e) => {
      if (e.conversation_id !== cid) return;
      if (e.t === 'typing') {
        clearTimeout(ttl);
        setPeerTyping(e.state === 'on');
        if (e.state === 'on') ttl = setTimeout(() => setPeerTyping(false), 5_000);
      } else if (e.t === 'message.new') { clearTimeout(ttl); setPeerTyping(false); }
    });
    return () => { off(); clearTimeout(ttl); };
  }, [cid, isNew]);
  const typingSentAt = useRef(0);
  const typingIdle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stopTyping = useCallback(() => {
    clearTimeout(typingIdle.current);
    if (typingSentAt.current && !isNew) sendRealtime({ t: 'typing', conversation_id: cid, state: 'off' });
    typingSentAt.current = 0;
  }, [cid, isNew]);
  const onType = (x: string) => {
    setText(x);
    if (isNew) return;
    if (!x.trim()) { stopTyping(); return; }
    const now = Date.now();
    if (now - typingSentAt.current >= 3_000) { sendRealtime({ t: 'typing', conversation_id: cid, state: 'on' }); typingSentAt.current = now; }
    clearTimeout(typingIdle.current);
    typingIdle.current = setTimeout(stopTyping, 5_000); // 5 s idle -> stop
  };
  useEffect(() => { if (!visible) stopTyping(); }, [visible, stopTyping]); // blur / background
  useEffect(() => stopTyping, [stopTyping]); // leaving the screen

  // read receipts: only while this chat is actually on screen and the app is in the foreground, so "read" means
  // the person could see it. Monotonic on the server, so repeats are harmless.
  const lastSeq = v?.last_seq ?? 0;
  useEffect(() => {
    if (!isNew && visible && lastSeq > 0 && (v?.read_seq ?? 0) < lastSeq) {
      void api(`/v1/conversations/${cid}/receipts`, { body: { delivered_seq: lastSeq, read_seq: lastSeq } })
        .then(() => qc.invalidateQueries({ queryKey: ['inbox'] }), () => {});
    }
  }, [cid, isNew, visible, lastSeq, v?.read_seq, qc]);

  const deliver = async (b: Bubble) => {
    setPending((p) => p.map((x) => (x.clientId === b.clientId ? { ...x, pending: true, failed: false } : x)));
    try {
      if (isNew) {
        const r = await api<Conv>('/v1/conversations', { body: { recipient: to, first_message: { client_msg_id: b.clientId, body: b.body } }, idem: b.clientId! });
        void qc.invalidateQueries({ queryKey: ['inbox'] });
        router.replace({ pathname: '/chat/[cid]', params: { cid: r.data.conversation_id } });
        return;
      }
    } catch (e) {
      setPending((p) => p.map((x) => (x.clientId === b.clientId ? { ...x, pending: false, failed: true } : x)));
      if (e instanceof ApiError && e.status === 403) { setNotice(errorText(e)); void qc.invalidateQueries({ queryKey: ['conversation', cid] }); }
    }
  };

  const send = () => {
    const body = text.trim();
    if (!body) return;
    const id = newKey();
    setText('');
    stopTyping();
    requestAnimationFrame(() => scroll.current?.scrollToEnd({ animated: !reduced }));
    if (!isNew) { enqueue(cid, id, body); return; }
    const b: Bubble = { id: `local-${id}`, clientId: id, mine: true, kind: 'TEXT', body, time: hhmm(new Date().toISOString()), pending: true };
    setPending((p) => [...p, b]);
    void deliver(b);
  };

  const act = async (path: 'accept' | 'reject') => {
    try {
      await api(`/v1/conversations/${cid}/${path}`, { body: {}, idem: newKey() });
      await Promise.all([qc.invalidateQueries({ queryKey: ['conversation', cid] }), qc.invalidateQueries({ queryKey: ['inbox'] })]);
      if (path === 'reject') goBack('/sohbetler');
    } catch (e) { setNotice(errorText(e)); }
  };
  const giftKey = useRef(newKey());
  const gift = async () => {
    try {
      await api(`/v1/conversations/${cid}/gold-gifts`, { body: {}, idem: giftKey.current });
      giftKey.current = newKey(); // a retry of this gift reuses the old key; the next gift gets a new one
      setGiftOpen(false);
      void qc.invalidateQueries({ queryKey: ['wallet'] });
      void qc.invalidateQueries({ queryKey: ['messages', cid] });
    } catch (e) { setGiftOpen(false); setNotice(errorText(e)); }
  };
  /** Profilimi Göster: irreversible (REQ-SOC-06), so it is always confirmed in a sheet first. */
  const reveal = async () => {
    setRevealing(true);
    try {
      await api(`/v1/conversations/${cid}/reveal`, { body: {}, idem: newKey() });
      setRevealOpen(false);
      void qc.invalidateQueries({ queryKey: ['conversation', cid] });
      void qc.invalidateQueries({ queryKey: ['inbox'] });
    } catch (e) { setRevealOpen(false); setNotice(errorText(e)); } finally { setRevealing(false); }
  };
  const safety = async (kind: 'report' | 'block') => {
    setSafetyOpen(false);
    try {
      if (kind === 'report') await api('/v1/reports', { body: { target: { type: 'CONVERSATION', id: cid }, reason: 'HARASSMENT' }, idem: newKey() });
      else await api(`/v1/conversations/${cid}/block`, { body: {}, idem: newKey() });
      setNotice(kind === 'report' ? 'Bildirimin alındı. Ekibimiz inceleyecek.' : 'Engellendi. Bu kişi sana artık ulaşamaz.');
      void qc.invalidateQueries({ queryKey: ['conversation', cid] });
      void qc.invalidateQueries({ queryKey: ['inbox'] });
    } catch (e) { setNotice(errorText(e)); }
  };

  return (
    <KeyboardAvoidingView style={[styles.fill, { backgroundColor: c.canvas }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.header, { paddingTop: insets.top + space.s, borderBottomColor: c.hairline, backgroundColor: c.canvas }]}>
        <PressableScale accessibilityRole="button" accessibilityLabel="Geri" onPress={() => goBack('/sohbetler')} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={24} color={c.textPrimary} />
        </PressableScale>
        <PressableScale haptic="none" disabled={cp?.kind !== 'IDENTIFIED'} accessibilityRole="button" accessibilityLabel={`${title} profili`}
          onPress={() => { if (cp?.kind === 'IDENTIFIED') router.push({ pathname: '/profile/[id]', params: { id: cp.public_user_id } }); }}
          style={styles.headerMain}>
          <Avatar id={avatarId} name={title || '·'} size={40} anonymous={anonymous} ring={anonymous ? 'none' : 'subtle'} uri={cp?.kind === 'IDENTIFIED' ? cp.avatar?.url : null} />
          <View style={{ flex: 1 }}>
            {title ? <Text style={[styles.title, { color: c.textPrimary }]} numberOfLines={1}>{title}</Text> : <View style={[styles.skelTitle, { backgroundColor: c.raised }]} />}
            {connecting ? <Text style={[styles.subtitle, { color: c.textTertiary }]} accessibilityLiveRegion="polite">Bağlanıyor…</Text>
              : peerTyping ? <Text style={[styles.subtitle, { color: c.brandText }]} accessibilityLiveRegion="polite">yazıyor…</Text>
              : v?.state === 'REQUEST' ? <Text style={[styles.subtitle, { color: c.textTertiary }]} numberOfLines={1}>{v.my_role === 'INITIATOR' ? 'İstek gönderildi · yanıt bekleniyor' : t('chat.request')}</Text> : null}
          </View>
        </PressableScale>
        {!isNew && (
          <PressableScale accessibilityRole="button" accessibilityLabel="Güvenlik seçenekleri" onPress={() => setSafetyOpen(true)} style={styles.iconBtn}>
            <Ionicons name="shield-checkmark-outline" size={22} color={c.textPrimary} />
          </PressableScale>
        )}
      </View>

      {notice && (
        <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={[styles.notice, { backgroundColor: c.surface, borderColor: c.hairline }]} accessibilityLiveRegion="polite">
          <Text style={[styles.noticeText, { color: c.textPrimary }]}>{notice}</Text>
          <PressableScale haptic="none" accessibilityRole="button" accessibilityLabel="Kapat" onPress={() => setNotice(null)} style={styles.noticeClose}>
            <Ionicons name="close" size={18} color={c.textSecondary} />
          </PressableScale>
        </Animated.View>
      )}

      <ScrollView ref={scroll} contentContainerStyle={styles.list}
        onContentSizeChange={() => { if (loadingOlder.current) { loadingOlder.current = false; return; } scroll.current?.scrollToEnd({ animated: false }); }}>
        {msgs.hasNextPage ? (
          <PressableScale haptic="none" accessibilityRole="button" disabled={msgs.isFetchingNextPage}
            onPress={() => { loadingOlder.current = true; void msgs.fetchNextPage(); }} style={[styles.older, { borderColor: c.hairline, backgroundColor: c.surface }]}>
            {msgs.isFetchingNextPage ? <ActivityIndicator color={c.textSecondary} /> : <Text style={[styles.olderText, { color: c.textSecondary }]}>Önceki mesajlar</Text>}
          </PressableScale>
        ) : null}
        {!isNew && msgs.isPending ? (
          <View style={{ gap: space.m }}>
            {[0.6, 0.4, 0.7].map((w, i) => <View key={i} style={[styles.skelBubble, { alignSelf: i % 2 ? 'flex-end' : 'flex-start', width: `${w * 100}%`, backgroundColor: c.surface }]} />)}
          </View>
        ) : null}
        {!isNew && msgs.isError && !msgs.data ? <Text style={[styles.emptyBody, { color: c.textSecondary, alignSelf: 'center' }]}>{errorText(msgs.error)}</Text> : null}
        {bubbles.length === 0 && (isNew || msgs.isSuccess) ? (
          <Animated.View entering={FadeIn.duration(240)} style={styles.emptyChat}>
            <Avatar id={avatarId} name={title || '·'} size={88} ring="subtle" anonymous={anonymous} uri={cp?.kind === 'IDENTIFIED' ? cp.avatar?.url : null} />
            <Text style={[styles.emptyTitle, { color: c.textPrimary }]}>{title}</Text>
            <Text style={[styles.emptyBody, { color: c.textSecondary }]}>{t('profile.anon_note')}</Text>
          </Animated.View>
        ) : null}

        {bubbles.map((m, i) => {
          const prevSame = i > 0 && bubbles[i - 1]!.mine === m.mine;
          const entering = m.clientId && m.id.startsWith('local-') && !reduced ? FadeInDown.duration(240).easing(easeOut).withInitialValues({ transform: [{ translateY: 12 }] }) : undefined;
          const gold = m.kind === 'GOLD_GIFT';
          return (
            <Animated.View key={m.clientId ?? m.id} entering={entering} style={[styles.rowWrap, { alignItems: m.mine ? 'flex-end' : 'flex-start', marginTop: prevSame ? 3 : space.m }]}>
              {m.kind === 'PHOTO' && m.mediaId ? <PhotoBubble mid={m.mediaId} mine={m.mine} time={m.time} tick={m.mine ? tickOf(m) : undefined} tail={!prevSame} /> : (
                <View style={[
                  styles.bubble,
                  gold ? { backgroundColor: c.goldFill }
                    : m.mine ? { backgroundColor: c.bubbleMine, borderBottomRightRadius: prevSame ? radius.bubble : 6 }
                    : { backgroundColor: c.bubbleTheirs, borderBottomLeftRadius: prevSame ? radius.bubble : 6 },
                  m.pending ? { opacity: 0.7 } : null,
                ]}>
                  {gold ? (
                    <View style={styles.giftRow}><GoldCoin size={16} inverted /><Text style={[styles.body, { color: c.onGoldFill, fontFamily: fonts.bold }]}>{m.mine ? '1 Gold gönderdin' : '1 Gold aldın'}</Text></View>
                  ) : <Text style={[styles.body, { color: m.mine ? c.onBubbleMine : c.textPrimary }]}>{m.body}</Text>}
                </View>
              )}
              {m.kind === 'PHOTO' ? null : <View style={styles.metaRow}>
                {m.failed ? (
                  <PressableScale haptic="light" accessibilityRole="button" accessibilityLabel="Gönderilemedi, tekrar dene" onPress={() => (isNew ? void deliver(m) : retryOutbox(cid, m.clientId!))} style={styles.giftRow}>
                    <Ionicons name="alert-circle" size={14} color={c.danger} /><Text style={[styles.time, { color: c.danger }]}>Gönderilemedi · tekrar dene</Text>
                  </PressableScale>
                ) : (
                  <>
                    <Text style={[styles.time, { color: c.textTertiary }]}>{m.time}</Text>
                    {m.mine && !gold ? <TickIcon tick={tickOf(m)} /> : null}
                  </>
                )}
              </View>}
            </Animated.View>
          );
        })}
        {outPhotos.map((o) => (
          <View key={o.id} style={[styles.rowWrap, { alignItems: 'flex-end', marginTop: space.m }]}>
            <PendingPhotoBubble uri={o.img.uri} width={o.img.width} height={o.img.height} kind={o.kind} failed={o.status === 'failed'} error={o.error}
              onRetry={() => void uploadPhoto(o)} time={hhmm(new Date().toISOString())} />
          </View>
        ))}
      </ScrollView>

      {request ? (
        <Animated.View exiting={FadeOut.duration(160)} style={[styles.requestDock, { paddingBottom: insets.bottom + space.m, borderTopColor: c.hairline, backgroundColor: c.canvas }]}>
          <View style={styles.requestHead}>
            <Ionicons name="mail-unread-outline" size={18} color={c.brandText} />
            <Text style={[styles.requestText, { color: c.textSecondary }]}>{t('chat.request_note')}</Text>
          </View>
          <View style={styles.requestRow}>
            <PressableScale accessibilityRole="button" onPress={() => void act('reject')} style={[styles.reqBtn, { backgroundColor: c.surface, borderColor: c.hairline, borderWidth: 1 }]}>
              <Text style={[styles.reqText, { color: c.textPrimary }]}>{t('chat.reject')}</Text>
            </PressableScale>
            <PressableScale accessibilityRole="button" haptic="medium" onPress={() => void act('accept')} style={[styles.reqBtn, { backgroundColor: c.brand }]}>
              <Text style={[styles.reqText, { color: c.onBrand }]}>{t('chat.accept')}</Text>
            </PressableScale>
          </View>
        </Animated.View>
      ) : closed ? (
        <View style={[styles.requestDock, { paddingBottom: insets.bottom + space.m, borderTopColor: c.hairline }]}>
          <Text style={[styles.requestText, { color: c.textTertiary, textAlign: 'center' }]}>Bu sohbet artık kullanılamıyor.</Text>
        </View>
      ) : (
        <View>
        {v?.can_reveal ? (
          <PressableScale haptic="light" accessibilityRole="button" accessibilityHint="Karşı tarafa kim olduğunu gösterir; geri alınamaz" onPress={() => setRevealOpen(true)}
            style={[styles.revealBar, { backgroundColor: c.surface, borderColor: c.hairline }]}>
            <Ionicons name="eye-off-outline" size={16} color={c.textSecondary} />
            <Text style={[styles.revealText, { color: c.textSecondary }]}>Karşı taraf seni görmüyor.</Text>
            <Text style={[styles.revealCta, { color: c.brandText }]}>Profilimi göster</Text>
          </PressableScale>
        ) : null}
        <Animated.View entering={FadeIn.duration(200)} style={[styles.composer, { paddingBottom: insets.bottom + space.s, borderTopColor: c.hairline, backgroundColor: c.canvas }]}>
          {!isNew && (
            <PressableScale accessibilityRole="button" accessibilityLabel="Fotoğraf gönder" onPress={() => { setPhotoErr(null); setPhotoOpen(true); }} style={[styles.circle, { backgroundColor: c.surface }]}>
              <Ionicons name="image-outline" size={21} color={c.textPrimary} />
            </PressableScale>
          )}
          {!isNew && (
            <PressableScale accessibilityRole="button" accessibilityLabel="1 Gold gönder" onPress={() => setGiftOpen(true)} style={[styles.circle, { backgroundColor: c.surface }]}>
              <GoldCoin size={20} />
            </PressableScale>
          )}
          <View style={[styles.inputWrap, { backgroundColor: c.surface, borderColor: c.hairline }]}>
            <TextInput
              value={text}
              onChangeText={onType}
              onBlur={stopTyping}
              placeholder={t('chat.placeholder')}
              placeholderTextColor={c.textTertiary}
              style={[styles.input, { color: c.textPrimary }]}
              multiline
              maxLength={4000}
              accessibilityLabel={t('chat.placeholder')}
            />
          </View>
          {text.trim() ? (
            <Animated.View entering={reduced ? FadeIn.duration(120) : ZoomIn.springify().damping(16).stiffness(320).withInitialValues({ transform: [{ scale: 0.6 }] })} exiting={reduced ? FadeOut.duration(100) : ZoomOut.duration(140)}>
              <PressableScale accessibilityRole="button" accessibilityLabel="Gönder" onPress={send} style={[styles.send, { backgroundColor: c.brand }]}>
                <Ionicons name="arrow-up" size={20} color={c.onBrand} />
              </PressableScale>
            </Animated.View>
          ) : null}
        </Animated.View>
        </View>
      )}
      <Sheet visible={revealOpen} onClose={() => setRevealOpen(false)} title="Profilini göster">
        <Text style={[styles.requestText, { color: c.textSecondary, marginBottom: space.l }]}>
          {title} adını, kullanıcı adını ve profilini görecek. Bu işlem geri alınamaz; sohbet aynen devam eder.
        </Text>
        <PressableScale accessibilityRole="button" haptic="medium" disabled={revealing} onPress={() => void reveal()} style={[styles.reqBtn, { backgroundColor: c.brand, minHeight: 52 }]}>
          <Text style={[styles.reqText, { color: c.onBrand }]}>{revealing ? 'Gösteriliyor…' : 'Evet, profilimi göster'}</Text>
        </PressableScale>
      </Sheet>
      <Sheet visible={photoOpen} onClose={() => setPhotoOpen(false)} title="Fotoğraf gönder">
        <View style={[styles.segment, { backgroundColor: c.surface, borderColor: c.hairline }]} accessibilityRole="radiogroup">
          {(['PERSISTENT', 'ONE_VIEW'] as const).map((k) => (
            <PressableScale key={k} haptic="selection" accessibilityRole="radio" accessibilityState={{ selected: photoKind === k }} onPress={() => setPhotoKind(k)}
              style={[styles.segBtn, photoKind === k && { backgroundColor: c.raised }]}>
              <Ionicons name={k === 'PERSISTENT' ? 'image-outline' : 'eye-outline'} size={16} color={photoKind === k ? c.textPrimary : c.textSecondary} />
              <Text style={[styles.segText, { color: photoKind === k ? c.textPrimary : c.textSecondary }]}>{k === 'PERSISTENT' ? 'Kalıcı' : 'Tek görüntülük'}</Text>
            </PressableScale>
          ))}
        </View>
        <Text style={[styles.requestText, { color: c.textSecondary, marginBottom: space.m }]}>
          {photoKind === 'PERSISTENT'
            ? 'Karşı taraf fotoğrafı Gold ile bir kez açar, sonra istediği kadar bakabilir. Sen her zaman ücretsiz görürsün.'
            : 'Karşı taraf Gold ile açar ve yalnızca bir kez görebilir; kapatınca bir daha açılamaz.'}
          {' '}Konum bilgisi silinir, fotoğraf 90 gün sonra kaldırılır.
        </Text>
        {photoErr ? <Text style={[styles.requestText, { color: c.danger, marginBottom: space.m }]} accessibilityLiveRegion="assertive">{photoErr}</Text> : null}
        <PressableScale accessibilityRole="button" onPress={() => void pickPhoto('library')} style={[styles.reqBtn, { backgroundColor: c.brand, marginBottom: space.s, flex: 0 }]}>
          <Text style={[styles.reqText, { color: c.onBrand }]}>Galeriden seç</Text>
        </PressableScale>
        {Platform.OS !== 'web' ? (
          <PressableScale accessibilityRole="button" onPress={() => void pickPhoto('camera')} style={[styles.reqBtn, { backgroundColor: c.surface, borderColor: c.hairline, borderWidth: 1, flex: 0 }]}>
            <Text style={[styles.reqText, { color: c.textPrimary }]}>Fotoğraf çek</Text>
          </PressableScale>
        ) : null}
      </Sheet>
      <GiftSheet visible={giftOpen} onClose={() => setGiftOpen(false)} balance={wallet.data?.available ?? 0} recipientLabel={title} onConfirm={() => void gift()} />
      <Sheet visible={safetyOpen} onClose={() => setSafetyOpen(false)} title="Güvenlik">
        <Text style={[styles.requestText, { color: c.textSecondary, marginBottom: space.m }]}>
          Bildirmek ücretsizdir. Engellediğinde karşı taraf bunu doğrudan öğrenmez{anonymous ? '; kim olduğunu da sana göstermeyiz' : ''}.
        </Text>
        <PressableScale accessibilityRole="button" onPress={() => void safety('report')} style={[styles.reqBtn, { backgroundColor: c.surface, borderColor: c.hairline, borderWidth: 1, marginBottom: space.s }]}>
          <Text style={[styles.reqText, { color: c.textPrimary }]}>Bildir</Text>
        </PressableScale>
        <PressableScale accessibilityRole="button" haptic="medium" onPress={() => void safety('block')} style={[styles.reqBtn, { backgroundColor: c.danger }]}>
          <Text style={[styles.reqText, { color: '#0A0A0F' }]}>Engelle</Text>
        </PressableScale>
      </Sheet>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.m, paddingHorizontal: space.s, paddingBottom: space.m, borderBottomWidth: StyleSheet.hairlineWidth },
  headerMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.m },
  iconBtn: { width: size.hitTarget, height: size.hitTarget, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.display, fontSize: typeScale.headline.size + 1 },
  subtitle: { fontFamily: fonts.medium, fontSize: typeScale.caption.size },
  skelTitle: { width: 120, height: 14, borderRadius: 7 },
  skelBubble: { height: 40, borderRadius: radius.bubble },
  notice: { flexDirection: 'row', alignItems: 'center', gap: space.s, margin: space.m, marginBottom: 0, padding: space.m, borderRadius: radius.s + 4, borderWidth: 1 },
  noticeText: { flex: 1, fontFamily: fonts.medium, fontSize: typeScale.bodySmall.size },
  noticeClose: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: space.gutter, paddingVertical: space.l },
  requestDock: { paddingHorizontal: space.gutter, paddingTop: space.m, gap: space.m, borderTopWidth: StyleSheet.hairlineWidth },
  requestHead: { flexDirection: 'row', gap: space.s, alignItems: 'flex-start' },
  requestText: { flex: 1, fontFamily: fonts.regular, fontSize: typeScale.bodySmall.size, lineHeight: typeScale.bodySmall.line },
  requestRow: { flexDirection: 'row', gap: space.s },
  reqBtn: { flex: 1, minHeight: size.hitTarget, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  reqText: { fontFamily: fonts.bold, fontSize: typeScale.bodySmall.size + 1 },
  emptyChat: { alignItems: 'center', gap: space.m, paddingVertical: space.huge },
  emptyTitle: { fontFamily: fonts.displayHeavy, fontSize: typeScale.title1.size },
  emptyBody: { fontFamily: fonts.regular, fontSize: typeScale.bodySmall.size, textAlign: 'center', maxWidth: 280, lineHeight: 20 },
  rowWrap: { maxWidth: '100%' },
  bubble: { maxWidth: '82%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.bubble },
  body: { fontFamily: fonts.regular, fontSize: typeScale.body.size, lineHeight: 22 },
  giftRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3, paddingHorizontal: 4 },
  time: { fontFamily: fonts.medium, fontSize: 11 },
  segment: { flexDirection: 'row', padding: 4, borderRadius: radius.pill, borderWidth: 1, marginBottom: space.m },
  segBtn: { flex: 1, minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: radius.pill },
  segText: { fontFamily: fonts.semibold, fontSize: typeScale.bodySmall.size },
  older: { alignSelf: 'center', minHeight: 36, paddingHorizontal: space.l, borderRadius: radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: space.m },
  olderText: { fontFamily: fonts.semibold, fontSize: typeScale.caption.size + 1 },
  locked: { width: 220, height: 280, borderRadius: radius.bubble, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: space.m, overflow: 'hidden' },
  stripe: { position: 'absolute', top: -40, width: 1.5, height: 420, transform: [{ rotate: '35deg' }] },
  lockIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  lockedTitle: { fontFamily: fonts.display, fontSize: typeScale.headline.size },
  goldBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 16, borderRadius: radius.pill },
  goldText: { fontFamily: fonts.bold, fontSize: typeScale.bodySmall.size },
  revealBar: { flexDirection: 'row', alignItems: 'center', gap: space.s, marginHorizontal: space.m, marginBottom: space.s, paddingHorizontal: space.m, minHeight: 44, borderRadius: radius.pill, borderWidth: 1 },
  revealText: { flex: 1, fontFamily: fonts.medium, fontSize: typeScale.caption.size + 1 },
  revealCta: { fontFamily: fonts.bold, fontSize: typeScale.caption.size + 1 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: space.s, paddingHorizontal: space.m, paddingTop: space.s, borderTopWidth: StyleSheet.hairlineWidth },
  circle: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  inputWrap: { flex: 1, minHeight: 42, maxHeight: 120, borderRadius: 21, borderWidth: 1, paddingHorizontal: 14, justifyContent: 'center' },
  input: { fontFamily: fonts.regular, fontSize: typeScale.body.size, paddingVertical: 9 },
  send: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
});
