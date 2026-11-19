import { router, type Href } from 'expo-router';

/**
 * Back that always works. `router.back()` is a no-op when there is no history (deep link, push notification,
 * web refresh, a screen opened with replace) — the button then looks dead. Fall back to a sensible parent.
 */
export function goBack(fallback: Href = '/') {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
