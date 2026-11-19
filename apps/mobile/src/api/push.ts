import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './client';
import { installationId } from './prefs';

/**
 * Notification permission + device token (doc 09). The permission flow is complete on every platform; turning a
 * granted permission into a push token needs the push INTEGRATION (APNs key / FCM google-services), so until that
 * is configured the token step quietly does nothing and the app keeps using in-app banners + the notification centre.
 */
export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unsupported';

// Foreground: the in-app banner (features/InAppBanner) already shows new events, so no duplicate system banner.
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: true }),
  });
}

const webState = (): PermissionState => {
  const N = (globalThis as { Notification?: { permission: string } }).Notification;
  if (!N) return 'unsupported';
  return N.permission === 'granted' ? 'granted' : N.permission === 'denied' ? 'denied' : 'undetermined';
};

export async function notificationPermission(): Promise<PermissionState> {
  if (Platform.OS === 'web') return webState();
  try {
    const p = await Notifications.getPermissionsAsync();
    if (p.granted || p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return 'granted';
    return p.canAskAgain && p.status !== 'denied' ? 'undetermined' : 'denied';
  } catch { return 'unsupported'; }
}

/** Shows the system prompt (iOS allows it exactly once, so call it only after the in-app explanation). */
export async function requestNotificationPermission(): Promise<PermissionState> {
  if (Platform.OS === 'web') {
    const N = (globalThis as { Notification?: { requestPermission: () => Promise<string> } }).Notification;
    if (!N) return 'unsupported';
    try { await N.requestPermission(); } catch { /* dismissed */ }
    return webState();
  }
  if (Platform.OS === 'android') {
    // Android 13+: the channel must exist before the runtime prompt can appear
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Bildirimler', importance: Notifications.AndroidImportance.HIGH, lightColor: '#D4FF3A', vibrationPattern: [0, 180, 120, 180],
    }).catch(() => {});
  }
  const r = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } });
  return r.granted ? 'granted' : r.canAskAgain ? 'undetermined' : 'denied';
}

/**
 * Registers this device's push token with the API (idempotent; also refreshes a rotated token). Best effort:
 * without the push integration configured the OS gives no token and this returns false.
 */
export async function registerPushToken(): Promise<boolean> {
  if (Platform.OS === 'web' || (await notificationPermission()) !== 'granted') return false;
  try {
    const t = await Notifications.getDevicePushTokenAsync();
    const token = typeof t.data === 'string' ? t.data : JSON.stringify(t.data);
    if (token.length < 16) return false;
    await api(`/v1/me/devices/${await installationId()}/push-token`, {
      method: 'PUT', body: { provider: Platform.OS === 'ios' ? 'apns' : 'fcm', token, locale: 'tr' },
    });
    return true;
  } catch {
    return false; // push integration not configured yet (no APNs/FCM credentials) — in-app notifications still work
  }
}
