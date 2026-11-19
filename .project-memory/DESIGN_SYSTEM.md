# FLERO Design System — "FLERO Gece" (v2, 2026-11-14)

The owner **rejected** the first direction ("Fener Işığı": warm paper + petrol) as not exciting enough. v2 replaces it.

- **Sources:**
  - ui-ux-pro-max: product "Social Media App" → Vibrant & Block-based + Motion-Driven, Aurora + micro-interactions. Its palettes were generic and its rose/coral sits too close to Tinder, so the colors were chosen by hand.
  - emil-design-eng: motion and craft rules.
- **Dark-first** (canvas #0A0A0F), with a full light theme from the same tokens: `packages/ui-tokens/src/tokens.ts`.
- **Roles (never cross):**
  - Brand/CTA = **Volt lime #D4FF3A** (use `brandText` for text: lime in dark, olive #3F5A00 in light)
  - Plus = **pearl iridescent** (lilac #B9B4FF → pink #FFC6E8 → ice #9EF0FF)
  - Promoted (BOOST_BLOCK) = **Signal cyan #3DDCFF**
  - Gold = warm #FFC53D with a "G" coin. Never a crypto/cash icon.
- **Type:** Bricolage Grotesque 700/800 for titles and names, Inter 400–700 for UI. Hero 40, display 32.
- **Shapes:** card radius 20, bubble 22, pill. Story-style gradient rings on avatars (pearl for Plus, cyan for promoted). Initials avatars use saturated dark duotones picked by an FNV hash of the id.
- **Motion (tokens in `motion`):**
  - press = spring to 0.97 (+ haptic)
  - first-page stagger ≤ 8 rows (40 → 20 ms, 8 px rise, ease-out [0.23, 1, 0.32, 1])
  - collapsing large title driven by scroll on the UI thread
  - Volt tab pill springs in
  - send button zooms in from 0.6 (never from 0)
  - irreversible like: confirm, then a heart pop
  - Reduced Motion swaps all of this for fades; it's honored, and this dev machine has it on
- **Contrast:** 62 pairs × 2 themes measured, 0 failures (`docs/architecture/evidence/contrast_report.md`).
- **Binding constraints kept:**
  - Shuffle card 76–88 dp (now 84), avatar 56, whole card opens the profile, no in-card actions
  - promoted badge only on BOOST_BLOCK
  - anonymous counterpart shows the abstract mark only
- **Prototype screens:** Keşfet, Profil (`/profile/[id]`), Sohbetler (inbox + requests), Sohbet (`/chat/[cid]`: request dock, bubbles, locked photo, composer).

## Shuffle card tiers (2026-11-15, v2 "cam" — owner rejected v1 glow/sheen as cheap)
Hierarchy on the list: Boost > Plus > Standard. One glass recipe, defined in `apps/mobile/src/design/tiers.ts`:
- 1 px edge gradient
- low-alpha tint washing in from the top-left
- 1 px lit rim on the top edge
- a barely visible glow, Plus/Boost only, iOS/web
- frosted chips (tinted fill + hairline border; never solid neon)

Colours:
- Gender sets the hue family. FEMALE = "Gül" (rose/orchid/plum faces); MALE = "Okyanus" (azure/petrol/indigo faces).
- Plus is gendered too: female "Ametist-Gül" (#F7B8D6→#C7A2FF), male "Safir" (#B9C6FF→#7D97FF).
- Boost is ALWAYS Signal cyan, with a 2 dp leading accent bar and a frosted "Öne Çıkan" chip with a flash icon.
- Standard is a neutral glass with only a whisper of the gender tint, plus a chevron.
- The meta row shows a ♀/♂ glyph, so colour never carries the meaning alone.

Motion: no loops and no sheen sweeps on rows.
- **Discover chrome:**
  - The notification bell sits top-right, with an unread badge and a single "ring" wiggle on a new item.
  - A floating Volt "Karıştır" button reshuffles: a new generation of the query, the old list stays until the new batch lands, the icon spins while loading, then the list scrolls to top with a light haptic.
  - Pull-to-refresh does the same thing.
  - Notifications moved out of the tab bar into a pushed screen with a back button.
- **Turkish caps:** use `upper()` from `i18n/tr` (tr-TR). Never use `textTransform: 'uppercase'`.
