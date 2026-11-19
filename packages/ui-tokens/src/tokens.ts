/**
 * "FLERO Gece" (Night) design tokens — v2 (2026-11-14). Replaces the rejected "Fener Işığı" baseline.
 * Direction: dark-first, bold and youthful. Volt-lime brand, pearl-iridescent Plus, Signal-cyan paid placement,
 * warm Gold for currency only. Source: ui-ux-pro-max ("Social Media App" → Vibrant & Block-based + Motion-Driven,
 * Aurora + micro-interactions), adapted away from coral/pink (Tinder trade dress) and purple-blue AI gradients.
 * Every required pair is MEASURED by test/contrast.test.ts.
 */

export type Hex = `#${string}`;
export type ThemeName = 'light' | 'dark';

export interface ColorTheme {
  canvas: Hex; surface: Hex; raised: Hex; hairline: Hex;
  textPrimary: Hex; textSecondary: Hex; textTertiary: Hex;
  /** Brand FILL (buttons, active indicators). Use brandText for brand-colored text. */
  brand: Hex; onBrand: Hex; brandText: Hex; focusRing: Hex;
  success: Hex; warning: Hex; danger: Hex;
  plusText: Hex; plusTint: Hex; plusFrameFrom: Hex; plusFrameMid: Hex; plusFrameTo: Hex; plusRing: Hex;
  goldText: Hex; goldFill: Hex; onGoldFill: Hex;
  promotedAccent: Hex; promotedTint: Hex; onPromotedAccent: Hex;
  bubbleMine: Hex; onBubbleMine: Hex; bubbleTheirs: Hex;
}

export const color: Record<ThemeName, ColorTheme> = {
  dark: {
    canvas: '#0A0A0F', surface: '#14141B', raised: '#1C1C26', hairline: '#262632',
    textPrimary: '#F4F4F6', textSecondary: '#A3A3B2', textTertiary: '#8B8B9A',
    brand: '#D4FF3A', onBrand: '#0A0A0F', brandText: '#D4FF3A', focusRing: '#D4FF3A',
    success: '#4ADE80', warning: '#FBBF24', danger: '#FF6B6B',
    plusText: '#D9D3FF', plusTint: '#1E1B2E', plusFrameFrom: '#B9B4FF', plusFrameMid: '#FFC6E8', plusFrameTo: '#9EF0FF', plusRing: '#B9B4FF',
    goldText: '#FFC53D', goldFill: '#FFC53D', onGoldFill: '#241A00',
    promotedAccent: '#3DDCFF', promotedTint: '#0D2730', onPromotedAccent: '#00141A',
    bubbleMine: '#D4FF3A', onBubbleMine: '#0A0A0F', bubbleTheirs: '#1C1C26',
  },
  light: {
    canvas: '#F7F7F5', surface: '#FFFFFF', raised: '#EFEFEC', hairline: '#E4E4E0',
    textPrimary: '#111116', textSecondary: '#4A4A57', textTertiary: '#62626F',
    brand: '#D4FF3A', onBrand: '#0A0A0F', brandText: '#3F5A00', focusRing: '#3F5A00',
    success: '#16794C', warning: '#8A5A00', danger: '#B42318',
    plusText: '#5B4BD6', plusTint: '#F1EEFF', plusFrameFrom: '#8F86FF', plusFrameMid: '#FF8FCB', plusFrameTo: '#5CD6F0', plusRing: '#7B6CF0',
    goldText: '#8A5A00', goldFill: '#FFC53D', onGoldFill: '#241A00',
    promotedAccent: '#00668F', promotedTint: '#E3F6FC', onPromotedAccent: '#FFFFFF',
    bubbleMine: '#111116', onBubbleMine: '#FFFFFF', bubbleTheirs: '#EFEFEC',
  },
};

/** Ramps for illustration; UI roles above are what components use. */
export const ramp = {
  volt: { 300: '#E6FF8A', 400: '#D4FF3A', 600: '#8FB800', 800: '#3F5A00' },
  pearl: { lilac: '#B9B4FF', pink: '#FFC6E8', ice: '#9EF0FF' },
  signal: { 300: '#7DE8FF', 400: '#3DDCFF', 700: '#00668F' },
  gold: { 400: '#FFC53D', 700: '#8A5A00' },
} as const;

export const font = { ui: 'Inter', display: 'Bricolage Grotesque' } as const;

/** sp / line height. Display family carries names and titles; UI family carries everything else. */
export const type = {
  hero: { size: 40, line: 44, weight: 800, family: 'display' },
  display: { size: 32, line: 38, weight: 800, family: 'display' },
  title1: { size: 26, line: 32, weight: 700, family: 'display' },
  title2: { size: 20, line: 26, weight: 700, family: 'display' },
  headline: { size: 17, line: 24, weight: 600, family: 'ui' },
  body: { size: 16, line: 24, weight: 400, family: 'ui' },
  bodySmall: { size: 14, line: 20, weight: 400, family: 'ui' },
  cardName: { size: 17, line: 22, weight: 700, family: 'display' },
  cardMeta: { size: 13, line: 18, weight: 500, family: 'ui' },
  caption: { size: 12, line: 16, weight: 500, family: 'ui' },
  label: { size: 11, line: 14, weight: 700, family: 'ui', tracking: 0.3 },
} as const;

export const space = { xxs: 2, xs: 4, s: 8, m: 12, l: 16, xl: 20, xxl: 24, xxxl: 32, huge: 48, gutter: 16 } as const;
export const radius = { s: 10, card: 20, sheet: 28, bubble: 22, pill: 999 } as const;
export const size = { hitTarget: 44, avatar: 56, cardMinHeight: 84, badgeSlotMax: 84, storyRing: 3 } as const;

/**
 * Motion tokens (emil-design-eng): strong custom ease-out for enters, ease-in-out for on-screen moves,
 * never ease-in on UI; press 100–160 ms; UI ≤ 300 ms (sheets up to 500 ms); exits faster than enters.
 */
export const motion = {
  duration: { press: 120, fast: 180, base: 240, enter: 280, exit: 200, sheet: 420, reducedFade: 150 },
  easing: {
    out: [0.23, 1, 0.32, 1],
    inOut: [0.77, 0, 0.175, 1],
    drawer: [0.32, 0.72, 0, 1],
  },
  spring: {
    press: { damping: 18, stiffness: 420, mass: 0.6 },
    snappy: { damping: 22, stiffness: 320, mass: 1 },
    sheet: { damping: 28, stiffness: 260, mass: 1 },
    gentle: { damping: 20, stiffness: 180, mass: 1 }, // celebratory: Gold credit, Plus activation only
  },
  pressScale: 0.97,
  stagger: { firstMs: 0, stepMs: [40, 35, 30, 28, 26, 24, 22, 20] as const, maxRows: 8 },
} as const;

export const haptics = {
  cardPress: 'light', tabChange: 'selection', chipSelect: 'selection', toggle: 'selection',
  refreshTrigger: 'medium', sheetConfirm: 'medium', send: 'light',
  unlock: 'success', purchase: 'success', plusActive: 'success', boostActive: 'success',
  insufficientGold: 'warning', lockedFilterTap: 'warning', failedPayment: 'error',
} as const;

/** Changes forced by contrast measurement. */
export const CHANGES: readonly { token: string; from: Hex; to: Hex; reason: string }[] = [
  { token: 'dark.textTertiary', from: '#7C7C8C', to: '#8B8B9A', reason: '4.47:1 on surface < 4.5' },
];
