# 13 — Mobile Architecture (iOS + Android)

Stack (ADR-002): React Native New Architecture with Expo dev builds, plus EAS. TypeScript strict throughout.

## 1. App structure
```
apps/mobile/
  app/                      Expo Router (file-based) — route groups below
    (boot)/                 splash, onboarding, auth, age, consent, home-region
    (tabs)/kesfet/          home banners + Shuffle list, filter sheet, profile/[id]
    (tabs)/sohbetler/       inbox, requests, conversation/[cid], media viewer
    (tabs)/bildirimler/
    (tabs)/cuzdan/          wallet, store, history, plus paywall, boost catalog/quote/confirm/status
    (tabs)/profilim/        own profile, edit, avatar editor, following/friends, privacy/safety/blocked, sessions, report/appeal/support, settings
    (modals)/               filter, unlock-confirm, gift-confirm, reveal-confirm, report
  src/features/<domain>/    screens' logic: hooks, view-models, components (no fetch in components)
  src/api/                  generated client (packages/contracts) + TanStack Query hooks
  src/realtime/             socket client, event reducer, sync engine
  src/store/                Zustand slices (UI/session state only), MMKV persistence
  src/db/                   encrypted SQLite (op-sqlite + SQLCipher): messages, outbox, conversation list
  src/design/               tokens from packages/ui-tokens, primitives, motion tokens
  src/i18n/                 i18next; tr (default) + en; ICU plurals; Turkish locale casing
```
**Layering rule:** screens → feature hooks → API/realtime/db services. Business rules stay on the server. The client only mirrors them for UX (for example, a locked filter), never for authorization.

## 2. State management
| State | Tool | Notes |
|---|---|---|
| Server cache (profiles, wallet, inbox pages, catalog) | TanStack Query | stale-while-revalidate; wallet always refetched after an economic op; **Shuffle responses are never cached** (`gcTime: 0`, no persister) (A§0.1.9) |
| Conversations/messages | encrypted SQLite + reducer driven by sync and socket events | source for offline reading and the optimistic outbox |
| UI/session (theme, filter selection, draft text) | Zustand + MMKV | drafts stored in encrypted SQLite, not MMKV |
| Secrets | expo-secure-store | refresh token, DB key |

## 3. Navigation graph
- Boot gate decides the route: no session → auth. Session without age/consent → those screens. No home region → selection. Otherwise → tabs.
- Tabs: Keşfet · Sohbetler (badge = unread + requests) · Bildirimler · Cüzdan · Profilim (design 14 §10).
- Deep links (doc 09 §5) resolve after the boot gate. Unauthorized targets show a neutral "Bu içerik kullanılamıyor".
- Transitions: native stack (react-native-screens) with platform-default gestures. Shared-element avatar transition from card to profile is optional, Reanimated-based and disabled under Reduced Motion.

## 4. Shuffle list (A§7, REQ-SHF-01/08/11)
- **FlashList v2**, one column, fixed row geometry per text-scale bucket (row min-height 80 dp; at large text sizes the layout recomputes with the measured height). `keyExtractor = ${batch_id}:${public_user_id}`.
- The list renders server order exactly. No client sort, no cross-batch filtering.
- Append: `onEndReached` while `has_more && completion !== 'UNCERTAIN'`, with one request in flight at a time. A `filterGeneration` counter is incremented on every filter or home change, and responses carrying a stale generation are dropped (T29).
- Refresh: pull-to-refresh replaces data. EXHAUSTED shows the footer "Şimdilik hepsi bu" with Yenile. UNCERTAIN shows the retry footer, with at most 2 auto retries (2 s, 8 s).
- Card component: four placement/tier variants (design 14 §4), memoized, no per-row animation loops, image via `expo-image` (memory+disk cache for **public avatars only**, `recyclingKey`).
- Banners carousel at the top (Reanimated pager, auto-advance paused under Reduced Motion and when off-screen). Sponsored label shown, tap destinations only from the allowlist.

## 5. Conversation screen
- Inverted FlashList of messages. Pending messages are rendered from the outbox. Grouping by sender and time. Receipts shown as ✓ sent, ✓✓ delivered, ✓✓ colored for read.
- The composer uses `react-native-keyboard-controller` for keyboard-safe layout and interactive dismiss.
- The anonymous header uses the counterparty projection: "Anonim Kullanıcı" with an abstract avatar. The initiator sees the recipient's identity and a `Profilimi Göster` action (confirmation sheet, irreversible).
- Locked photo tile (design 14 §6). The unlock and gift sheets are separate modals, each requiring an explicit confirmation. Typing is sent from composer focus and input events, throttled to 3 s.
- No banners or overlays in an active chat (REQ-HOM-01).

## 6. Realtime and sync client
- The socket connects when the app is foregrounded and disconnects 30 s after backgrounding (iOS limits background sockets anyway). Reconnect uses exponential backoff with jitter (1 s → 30 s), and the connection status shows as a subtle banner after 3 s of disconnect.
- On (re)connect, or when a gap is detected: `GET /v1/sync`, then per-conversation `after_seq` pulls, then ack the delivered watermark.
- The outbox worker sends queued messages in order, one in flight per conversation (preserving the user's intent order), retrying with backoff (doc 08 §4).
- AppState `active` → resync. Background fetch is not relied on.

## 7. Avatar editor (REQ-AVA-*)
Pipeline: picker (expo-image-picker, camera or library; permission-education screens; limited-library support on iOS) → normalize (expo-image-manipulator: apply EXIF orientation, convert HEIC→JPEG at quality 0.92, cap the long edge at 4096 px) → **crop UI** → export → upload.
- Crop UI: Gesture Handler pinch, pan and double-tap, with Reanimated shared values. The crop frame is a 1:1 square with a circular preview overlay (Skia mask) and a rule-of-thirds grid shown while dragging. Rubber-band at the edges; minimum scale = cover. Reset, rotate 90°, and preview before confirm.
- Export: the crop rectangle is computed in source-pixel space from the transform matrix and applied to the **original full-resolution image** (never a screenshot of the view, which prevents blurry crops). Output is a 1080×1080 JPEG at q 0.9 in the sRGB color space (Display P3 converted).
- Upload: presigned PUT. Large files use S3 multipart, with resume state stored in MMKV (upload_id, parts). Progress, cancel and retry. Weak network: chunk size adapts between 1 and 5 MB.
- The server re-encodes (sharp: strip metadata, sRGB, AVIF+WebP+JPEG at 64/128/256/512/1080 px) and moderates. Only after the new version is READY does the profile switch to it. The previous avatar stays until then (REQ-AVA-04, "preserve original until safe completion").
- Accessibility: every gesture has a button alternative (zoom +/−, arrows to nudge), and every control has a VoiceOver/TalkBack label.

## 8. Media viewing and screenshot policy
- Unlocked persistent photos: signed URL, displayed via expo-image with `cachePolicy: 'memory'`. They're never written to the disk cache, and each new session re-fetches them with a fresh signed URL.
- One-view: memory only, FLAG_SECURE (Android) and iOS capture-detection overlay via `expo-screen-capture`, best effort. The copy never promises screenshot prevention (REQ-MED-08).

## 9. Payments (client side)
`expo-iap` (StoreKit 2 / Play Billing v7+). Consumable Gold packs and subscription Plus. The client never grants anything locally; it shows "Doğrulanıyor…" until the server verify call succeeds, and only then finishes/consumes the transaction. A restore-purchases entry point is on the paywall (required by stores). The Boost screen **never** opens a store sheet (REQ-BST-01). Insufficient Gold routes to the wallet store.

## 10. Performance budgets (verified on devices at M8; numbers are targets)
| Metric | Target | Device class |
|---|---|---|
| Cold start to interactive Keşfet | ≤ 2.0 s p75 | midrange Android (e.g. Galaxy A54), iPhone 12 |
| Shuffle list scroll | ≤ 1 % frames > 16.7 ms at 60 Hz; 120 Hz on ProMotion devices without sustained drops | same |
| JS bundle | Hermes bytecode; ≤ 6 MB | — |
| Memory, 30 min chat use | no growth > 50 MB | — |
Tools: Flashlight (Android FPS/CPU), Xcode Instruments, React Native DevTools profiler, Reassure for component render regressions.

## 11. Accessibility and localization
- Dynamic type up to 200 % on every screen (cards grow; never truncate names to unreadable). VoiceOver/TalkBack labels per design 14 §11. Focus order. Reduced Motion and Reduce Transparency honored. Minimum hit target 44 dp.
- i18n: all strings and server error codes mapped to keys. Turkish casing via `toLocaleUpperCase('tr-TR')`. Plurals via ICU. Dates via `Intl` with tr-TR/en-GB. Server label keys for geography.

## 12. Release engineering
EAS Build profiles: development, preview (internal testers), production. EAS Submit to TestFlight and Play internal testing. EAS Update channels per runtime version; native changes require a store build; staged rollout 10 % → 50 % → 100 % with automatic rollback when the crash-free rate drops below 99.5 %. Sentry source maps uploaded per build.
