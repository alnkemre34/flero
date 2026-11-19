# FLERO brand assets

Everything the app shows as "the logo" comes from **one file**: `source/logo.png`.
Today it holds a temporary placeholder (the lime "F" tile). To ship the real logo:

1. Replace `source/logo.png` with the real mark — **1024×1024 PNG, transparent background**, the mark centred
   with roughly 8 % empty margin on each side.
2. Optional: add `source/logo-mono.png` (same size, any colour, transparent background) if the logo needs a
   hand-drawn single-colour version. Without it, the single-colour icons are derived automatically: light parts of
   the logo stay, dark parts become holes.
3. Optional: change colours in `brand.json` (icon background, splash backgrounds, notification tint).
4. Run `node scripts/brand-assets.mjs` in `apps/mobile`. It rewrites everything in `generated/`.
5. Rebuild the native app (`npx expo prebuild --clean`, then the Android/iOS build). App icons and the splash
   screen are baked into the binary; an over-the-air update cannot change them.

| Generated file | Used for | Where it is wired |
|---|---|---|
| `icon.png` (1024, opaque) | iOS app icon, store icon | `app.json → expo.icon` |
| `android-icon-foreground.png` (1024, safe zone 66 %) | Android adaptive icon | `app.json → android.adaptiveIcon` |
| `android-icon-monochrome.png` | Android 13+ themed icon | `app.json → android.adaptiveIcon` |
| `splash-icon.png` | native splash screen (120 pt wide) | `app.json → expo-splash-screen` plugin |
| `favicon.png` (48) | web build | `app.json → web.favicon` |
| `notification-icon.png` (96, white) | Android status-bar notification icon | `app.json → expo-notifications` plugin |
| `logo-mark.png` (512) | in-app logo: launch curtain, welcome, intro, permission screen | `src/design/Brand.tsx → BrandMark` |

The in-app launch curtain (`src/features/LaunchCurtain.tsx`) draws `logo-mark.png` at exactly the native splash
size on the same background colours, so the hand-off from the native splash to the app is seamless — keep
`imageWidth` in `app.json` and `SPLASH_MARK` in `Brand.tsx` equal if you change the size.
