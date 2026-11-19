import { radius, space, type as typeScale } from '@flero/ui-tokens';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { registerPushToken, requestNotificationPermission } from '@/api/push';
import { BrandMark } from '@/design/Brand';
import { PrimaryButton } from '@/design/Form';
import { easeOut } from '@/design/motion';
import { fonts, useTheme } from '@/design/theme';
import { finishNotificationStep } from '@/features/notificationStep';
import { t } from '@/i18n/tr';

/**
 * Notification permission, explained before the system prompt (doc 09: permission education). Shown once per
 * install after onboarding, only while the OS can still ask. The preview cards use the real notification copy:
 * generic, never a name, a message or a photo (lock-screen privacy). "Şimdi değil" never asks again here;
 * Profilim → Bildirimler can still turn it on later.
 */
export default function NotificationPermission() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [busy, setBusy] = useState(false);
  const rise = (d: number) => (reduced ? FadeIn.duration(150) : FadeInDown.duration(420).delay(d).easing(easeOut).withInitialValues({ transform: [{ translateY: 14 }] }));

  const allow = async () => {
    setBusy(true);
    try {
      const p = await requestNotificationPermission();
      if (p === 'granted') {
        void registerPushToken();
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } finally {
      setBusy(false);
      finishNotificationStep(); // the gate moves on to the app either way
    }
  };

  const samples = [
    { icon: 'mail-unread' as const, title: t('notif.MESSAGE_REQUEST'), when: 'şimdi' },
    { icon: 'checkmark-circle' as const, title: t('notif.REQUEST_ACCEPTED'), when: '2 dk' },
    { icon: 'shield-checkmark' as const, title: t('notif.SECURITY'), when: '1 sa' },
  ];

  return (
    <View style={[styles.fill, { backgroundColor: c.canvas, paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.l }]}>
      <View style={styles.stage} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[styles.glow, { backgroundColor: c.brand }]} />
        {samples.map((s, i) => (
          <Animated.View key={s.title} entering={rise(80 + i * 90)}
            style={[styles.card, { backgroundColor: c.surface, borderColor: c.hairline, opacity: 1 - i * 0.16, transform: [{ scale: 1 - i * 0.04 }] }]}>
            <BrandMark size={34} style={styles.cardIcon} />
            <View style={{ flex: 1 }}>
              <View style={styles.cardHead}>
                <Text style={[styles.cardApp, { color: c.textSecondary }]}>FLERO</Text>
                <Text style={[styles.cardWhen, { color: c.textTertiary }]}>{s.when}</Text>
              </View>
              <View style={styles.cardRow}>
                <Ionicons name={s.icon} size={15} color={c.brandText} />
                <Text style={[styles.cardTitle, { color: c.textPrimary }]} numberOfLines={1}>{s.title}</Text>
              </View>
            </View>
          </Animated.View>
        ))}
      </View>

      <Animated.View entering={rise(320)} style={styles.copy}>
        <Text style={[styles.title, { color: c.textPrimary }]} accessibilityRole="header">Önemli anları kaçırma</Text>
        <Text style={[styles.body, { color: c.textSecondary }]}>
          Biri sana yazdığında, isteğin kabul edildiğinde ya da hesabında bir güvenlik değişikliği olduğunda haber verelim.
        </Text>
        <View style={[styles.privacy, { backgroundColor: c.surface, borderColor: c.hairline }]}>
          <Ionicons name="lock-closed" size={16} color={c.textSecondary} />
          <Text style={[styles.privacyText, { color: c.textSecondary }]}>
            Bildirimlerde mesaj içeriği, fotoğraf ve anonim kişilerin kimliği asla gösterilmez.
          </Text>
        </View>
      </Animated.View>

      <Animated.View entering={rise(400)} style={styles.actions}>
        <PrimaryButton label="Bildirimlere izin ver" onPress={() => void allow()} busy={busy} />
        <PrimaryButton label="Şimdi değil" variant="ghost" onPress={finishNotificationStep} disabled={busy} />
        <Text style={[styles.hint, { color: c.textTertiary }]}>Hangi bildirimleri alacağını Profilim › Bildirimler’den seçebilirsin.</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, paddingHorizontal: space.gutter },
  stage: { flex: 1, justifyContent: 'center', gap: space.s, paddingHorizontal: space.s },
  glow: { position: 'absolute', alignSelf: 'center', width: 220, height: 220, borderRadius: 110, opacity: 0.08 },
  card: { flexDirection: 'row', alignItems: 'center', gap: space.m, padding: space.m, borderRadius: radius.card, borderWidth: 1 },
  cardIcon: { borderRadius: 9 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  cardApp: { fontFamily: fonts.semibold, fontSize: typeScale.caption.size, letterSpacing: 0.6 },
  cardWhen: { fontFamily: fonts.medium, fontSize: typeScale.caption.size },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: { flex: 1, fontFamily: fonts.semibold, fontSize: typeScale.body.size },
  copy: { gap: space.m, marginBottom: space.xl },
  title: { fontFamily: fonts.displayHeavy, fontSize: typeScale.title1.size + 4, lineHeight: typeScale.title1.line + 4, letterSpacing: -0.6 },
  body: { fontFamily: fonts.regular, fontSize: typeScale.body.size + 1, lineHeight: 25 },
  privacy: { flexDirection: 'row', alignItems: 'flex-start', gap: space.s, padding: space.m, borderRadius: radius.s + 4, borderWidth: 1 },
  privacyText: { flex: 1, fontFamily: fonts.medium, fontSize: typeScale.bodySmall.size, lineHeight: 20 },
  actions: { gap: space.s },
  hint: { fontFamily: fonts.medium, fontSize: typeScale.caption.size, textAlign: 'center', marginTop: space.xs },
});
