import { BricolageGrotesque_700Bold, BricolageGrotesque_800ExtraBold } from '@expo-google-fonts/bricolage-grotesque';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, useFonts } from '@expo-google-fonts/inter';
import { Stack, router, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getPref, loadPrefs } from '@/api/prefs';
import { SessionProvider, useSession } from '@/api/session';
import { ThemeProvider, useTheme } from '@/design/theme';
import { InAppBanner } from '@/features/InAppBanner';
import { LaunchCurtain } from '@/features/LaunchCurtain';
import { checkNotificationStep, resetNotificationStep, useNotificationStep } from '@/features/notificationStep';

const PUBLIC = new Set(['intro', 'welcome', 'signup', 'login', 'forgot-password', 'reset-password']);
/** Reachable from an e-mail link even while signed in. */
const ALWAYS = new Set(['reset-password']);

/**
 * Session gate, runs on every change:
 *   signed out   → first launch: intro, afterwards: welcome
 *   onboarding   → onboarding (age → consents → region)
 *   ready        → the notification explanation once, then the app
 */
function useGate() {
  const { state } = useSession();
  const seg = useSegments();
  const first = seg[0] ?? '';
  const notif = useNotificationStep();
  useEffect(() => {
    if (state === 'ready') void checkNotificationStep();
    else if (state === 'signedOut') resetNotificationStep();
  }, [state]);
  const settled = state !== 'loading' && !(state === 'ready' && notif === 'unknown');
  useEffect(() => {
    if (!settled) return;
    if (state === 'signedOut') {
      if (!getPref('intro_seen') && first !== 'intro' && !ALWAYS.has(first)) router.replace('/intro');
      else if (!PUBLIC.has(first)) router.replace('/welcome');
    } else if (state === 'onboarding' && first !== 'onboarding') router.replace('/onboarding');
    else if (state === 'ready') {
      if (notif === 'ask') { if (first !== 'bildirim-izni') router.replace('/bildirim-izni'); }
      else if ((PUBLIC.has(first) && !ALWAYS.has(first)) || first === 'onboarding' || first === 'bildirim-izni') router.replace('/');
    }
  }, [settled, state, first, notif]);
  return { state, settled };
}

function Root() {
  const { name, c } = useTheme();
  const { state, settled } = useGate();
  return (
    <>
      {state !== 'loading' ? <Screens dark={name === 'dark'} canvas={c.canvas} /> : null}
      <LaunchCurtain ready={settled} />
    </>
  );
}

function Screens({ dark, canvas }: { dark: boolean; canvas: string }) {
  return (
    <>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: canvas },
          animation: 'slide_from_right', // native stack: platform-correct, interruptible back gesture
          gestureEnabled: true,
        }}
      >
        <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
        <Stack.Screen name="intro" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="bildirim-izni" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="welcome" options={{ animation: 'fade' }} />
        <Stack.Screen name="signup" />
        <Stack.Screen name="login" />
        <Stack.Screen name="forgot-password" />
        <Stack.Screen name="reset-password" />
        <Stack.Screen name="onboarding" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="profile/[id]" />
        <Stack.Screen name="bildirimler" />
        <Stack.Screen name="chat/[cid]" />
        <Stack.Screen name="plus" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="boost" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="perf-list" />
        <Stack.Screen name="kart-vitrini" />
        <Stack.Screen name="glyph-test" options={{ headerShown: true, title: 'Glyph test' }} />
      </Stack>
      <InAppBanner />
    </>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold,
    BricolageGrotesque_700Bold, BricolageGrotesque_800ExtraBold,
  });
  // The native splash stays until fonts and per-install preferences are ready (LaunchCurtain then takes over);
  // a font failure must never leave the app blank (falls back to the system font).
  const [prefs, setPrefs] = useState(false);
  useEffect(() => { void loadPrefs().finally(() => setPrefs(true)); }, []);
  if ((!loaded && !error) || !prefs) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <SessionProvider>
            <Root />
          </SessionProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
