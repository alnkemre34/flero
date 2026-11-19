# 14 — Premium UI/UX System: "Fener Işığı" (Lantern Light)

**Origin:** the design-director workstream (2026-11-14), reconciled by the lead with A§7 and master §3. **Status:** the tokens are implemented in `packages/ui-tokens`. **Contrast has been measured** for 54 required pairs across both themes, with 0 failures and no token changes needed (`evidence/contrast_report.md`). The tightest pair is light textTertiary on raised, at 4.69:1. The font pairing needs a Turkish-glyph render test before the tokens freeze. M1 produces coded component prototypes and screenshot golden tests in place of Figma files (doc 02, limitation L-2).

## 1. Concept
The mood is an Istanbul evening street: warm paper neutrals, deep petrol ink, and light only where something matters. Premium comes from restraint, hairlines and precise typography rather than glossy gradients.
**What it deliberately avoids:**
- Tinder/Connected2.me trade dress: coral or pink flame, swipe stacks
- purple-blue "AI" gradients
- blanket glassmorphism
- anything resembling a verification check for Plus

## 2. Color tokens (light / dark)
| Token | Light | Dark |
|---|---|---|
| canvas | #F6F3EE | #0F1214 |
| surface | #FFFFFF | #171B1E |
| raised | #EFEBE4 | #1F2427 |
| hairline | #E1DCD3 | #2A3034 |
| text.primary | #1B1F22 | #ECE9E3 |
| text.secondary | #4F565B | #A9B0B5 |
| text.tertiary | #62696E | #8A9298 |
| brand (Petrol) | #0F6B70 | #6DB3B6 |
| on-brand | #FFFFFF | #062F32 |
| focus ring (2 dp) | #0B5559 | #A8D5D7 |
| success / warning / danger | #1E7A4F / #8A5A00 / #B3261E | #5CC596 / #F2B705 / #FF8A80 |

**Three accent families. They never cross roles:**
- **Plus, "Şarap" (wine with a rose-gold hairline):** ramp 50 #FBEAF0 · 200 #F0B9CF · 400 #D4668F · 600 #A32D63 · 700 #831F4D · 900 #4A112B.
  - Frame gradient: #A32D63 → #C98F73 (light), #D4668F → #E8C2A8 (dark).
  - Tint: #FBEAF0 / #2A1520.
- **Gold (currency only, never Plus or Promoted):** 50 #FFF6DD · 200 #FFE08A · 400 #F2B705 · 600 #A66F00 · 700 #7A5000.
  - Chip: #F2B705 fill with #2B1D00 text.
- **Promoted (slate; it reads as a disclosure, not a luxury):**
  - Accent: #3E5C76 / #8FB0CC.
  - Tint: #E8EEF3 / #1A2630.

Meaning never rests on color alone. A text label always accompanies the accent.

## 3. Typography
- **UI:** Manrope. **Display:** Fraunces, used only for the wallet balance and the Plus/Boost paywall headlines. Both claim Latin Extended-A coverage for ğ ş ı İ Ç Ö Ü. **Gate:** render-test "ğ ş ı İ I i ı Ğ Ş" at every weight before freezing.
- Scale (sp / line height):

  | Style | Size / line height | Notes |
  |---|---|---|
  | display | 32/38 | Fraunces 600 |
  | title1 | 24/30 | 700 |
  | title2 | 20/26 | 700 |
  | headline | 17/24 | |
  | body | 16/24 | |
  | bodySmall | 14/20 | |
  | card.name | 16/20 | 700 |
  | card.meta | 13/18 | |
  | caption | 12/16 | |
  | label | 11/14 | 700, +0.2 tracking |

- Tabular figures for Gold amounts. Uppercase only via `toLocaleUpperCase('tr-TR')` (so "i" becomes "İ").
- Dynamic Type up to 200 %. Rows use a min-height, never a fixed height. Meta text wraps to two lines. Badges cap at 150 %.

## 4. Space, radius, elevation
- **Space:** 2, 4, 8, 12, 16, 20, 24, 32, 48 dp. Page gutter 16.
- **Radius:** 8 · card 14 · sheet 20 · pill 999.
- **Elevation:** cards are flat with a 1 dp hairline. Sheets get a y8 / blur24 / 12 % shadow in light mode. In dark mode a surface step plus a 6 % top highlight replaces the shadow.
- **Hit targets:** ≥ 44 dp.

## 5. Shuffle cards (A§7.1; one grid for all variants)
`[16][avatar 56][12][text: name·age / district·city][badge slot ≤72][16]`. Min-height 80 dp (inside the spec's 76–88 dp at default text size). There is **one** trailing badge slot, so a double badge and a taller row are structurally impossible.

| Variant | Treatment |
|---|---|
| 1. Standard · DISCOVERY | surface fill, hairline border, no badge, tertiary chevron |
| 2. Plus · DISCOVERY | 1.5 dp static Şarap gradient frame, tint wash on the left 40 %, 2 dp Şarap avatar ring with a gap, "Plus" pill with a spark glyph. **No check, shield or "verified" wording.** |
| 3. Standard · BOOST_BLOCK | promoted tint fill, 3 dp left rail in the promoted accent, "Öne Çıkan" pill, no Plus colors |
| 4. Plus + BOOST_BLOCK | promoted base and "Öne Çıkan" pill in the single slot. Plus identity comes only from the Şarap avatar ring, a 1 dp frame and a 16 dp Plus micro-glyph on the avatar corner. Same height |
| 5. Boost holder in DISCOVERY | renders exactly as variant 1 or 2. No rail, no label, no hint (A§0.1.10) |
| Expired Plus with city Boost in DISCOVERY | variant 1 (Standard styling) |

- **Interaction:** pressed = 8 % darker surface, scale 0.985, 90 ms. Focus = 2 dp ring outside the card. The whole card is one accessible button, for example "Ayşe, 27, Kadıköy, Plus üye. Öne Çıkan ücretli yerleşim. Profili aç". Decorative elements are hidden from accessibility.
- **Optional block caption [DEC-22]:** a small "Öne Çıkan ⓘ" caption above the first BOOST_BLOCK row explains paid placement. A§3.7 forbids *mandatory* section headings, so this is offered as an optional disclosure for owner approval.

## 6. Conversation elements
- **Anonymous avatar:** a 56 dp circle on `raised` with an abstract mark (two offset arcs). No face or gender silhouette. One of 8 tonal backgrounds is chosen by an HMAC of the conversation ID, never of the user. A dashed 1.5 dp ring distinguishes it from a no-photo identified profile, which shows an initial. The label "Anonim Kullanıcı" is always visible.
- **Locked photo tile:** 3:4 at ≤ 240 dp, a procedural diagonal-hairline pattern, **no blur and no pixels derived from the image** (REQ-MED-05). It shows a lock icon, "Fotoğraf kilitli", a Gold chip "N Gold ile aç" and an "Aç" button. "Bildir" is always visible and free.
  - States: locked · unlocking · unlocked · consumed (one-view) · failed-render (retry within the grace window) · expired · removed.
  - The sender sees their own photo with "Sadece sen ücretsiz görüyorsun".
- **Unlock sheet:** cost, balance before → after, kind ("Kalıcı" / "Tek görüntüleme") and expiry date (DEC-05). Insufficient balance → "Gold al".
- **Gift sheet:** "1 Gold gönder", balance X → X−1, a single confirm. There's no quantity control. It is never embedded in the photo tile.

## 7. Monetization screens
- **Plus paywall:** Fraunces headline, Şarap accent, and an honest benefit list: citywide and other-district browsing, gender filter, CITY Boost eligibility, premium card style, **"Keşifte Standart kartlardan önce sıralanırsın"** (rank advantage, A§8.8), plus any configured bonuses. Also price, restore, terms. No verification claims.
- **Boost checkout:** a mandatory, neutral disclosure card above the confirm button, containing the A§8.8 text, the Gold cost, balance, fixed scope and target, start, end and duration, that the Boost survives Plus expiry, and "Görüntülenme veya mesaj garantisi yoktur". The confirm button stays disabled until the disclosure has rendered. No urgency colors, no countdowns.
- **Wallet:** the balance in Fraunces with tabular figures. History shows counterparties via the projection ("Anonim Kullanıcı"). Debt or hold states are explained neutrally.

## 8. Motion tokens (shared with `packages/ui-tokens`)
- **Durations:** instant 90 · fast 160 · base 240 · slow 360 · shimmer 1400 ms.
- **Easing:** standard (0.2, 0, 0, 1), exit (0.4, 0, 1, 1).
- **Springs:** snappy {damping 22, stiffness 320}, sheet {26, 240}, celebratory {14, 180}. Celebratory is used only for a Gold credit and for Plus activation.
- **Allowed motion:**
  - press feedback
  - one skeleton shimmer
  - first-page fade-in (≤ 8 rows, 25 ms stagger)
  - a one-time 600 ms Plus sheen the first time a row is visible in a session (never looped, never during scroll)
  - Skia effects only on the paywall hero and the Gold-credit burst
- **Never animated:** rows continuously, looping frames, promoted rows, anything while scrolling, row height. Only transform and opacity animate, on the UI thread.
- **Reduced Motion:** springs become 120 ms fades. No scale, sheen or shimmer (static skeleton). Sheets fade, or slide 8 dp. Haptics stay unless the user disables them.

## 9. Haptics (expo-haptics)
| Haptic | Used for |
|---|---|
| light | card press, tab change, chip select |
| selection | toggles |
| medium | pull-to-refresh trigger, sheet confirm |
| success | unlock, purchase, Plus active, Boost active |
| warning | insufficient Gold, tap on a locked filter |
| error | failed purchase or transfer |
| none | scroll, list append, incoming messages |

An in-app setting turns haptics off.

## 10. States catalogue
| State | Design |
|---|---|
| Loading | 8 skeleton rows at the exact card geometry, no promoted skeleton |
| Empty (EXHAUSTED, 0 results) | lantern line illustration, "Bu filtrelerle kimse bulunamadı", "Filtreleri sıfırla" + Yenile |
| EXHAUSTED footer | "Şimdilik hepsi bu" + Yenile. Never "herkesi gördün" (A§4) |
| UNCERTAIN | inline footer card "Liste tam yüklenemedi" + "Tekrar dene". Loaded rows kept. Never shown as "no users" |
| Offline | persistent "Çevrimdışısın" banner; cached content readable; economic actions disabled with an explanation; "Bağlandı" toast on recovery |
| Error | full-screen only when nothing is cached, with request ID + retry |

## 11. Navigation and screen inventory
**Tabs** (solid bar, labels always visible, 2 dp active indicator):
1. **Keşfet:** banners, Shuffle, filter sheet (Standard sees Kadın/Erkek locked → Plus paywall), public profile.
2. **Sohbetler:** inbox, Mesaj İstekleri sub-tab, conversation, photo viewer, gift.
3. **Bildirimler.**
4. **Cüzdan:** balance, store, history, Plus, Boost catalog/quote/confirm/status.
5. **Profilim:** own profile/edit, avatar editor, following/friends (owner-only), privacy/safety/blocked users, sessions, report/appeal/support, settings (theme, language, notifications, haptics).

**Pre-tab flow:** splash → onboarding (3 screens) → auth → age → consent → city/district → optional photo.
**Modals:** filter, unlock, gift, reveal, report, follow disclosure (first follow).

M1 deliverable per screen: a flow diagram, entitlement variants (Standard / Plus / Boost owner), states from §10, and light, dark and 200 %-text screenshots as golden tests.

## 12. Accessibility rules (WCAG 2.2 AA targets)
- Text contrast ≥ 4.5:1 (large text ≥ 3:1). UI elements and focus ≥ 3:1. Both themes are **measured**.
- Targets ≥ 44 dp. Reading order and focus restoration: focus returns to the originating card after the profile closes.
- Live-region announcements for UNCERTAIN, offline and unlock results.
- Honors Reduced Motion, Reduce Transparency and Bold Text.
- Turkish is primary and English complete. No string concatenation for grammar.
