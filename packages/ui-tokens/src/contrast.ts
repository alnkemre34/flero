import { color, type ColorTheme, type Hex, type ThemeName } from './tokens.ts';

/** WCAG 2.x relative luminance of an sRGB hex color. */
export function luminance(hex: Hex): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`bad hex ${hex}`);
  const n = parseInt(m[1]!, 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

/** WCAG contrast ratio (1..21). */
export function contrast(a: Hex, b: Hex): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Required pairs per doc 14 §12: text ≥ 4.5, large text / UI / focus ≥ 3. */
export interface Requirement { fg: keyof ColorTheme; bg: keyof ColorTheme; min: 4.5 | 3; use: string }

export const REQUIREMENTS: readonly Requirement[] = [
  ...(['canvas', 'surface', 'raised'] as const).flatMap((bg) =>
    (['textPrimary', 'textSecondary', 'textTertiary'] as const).map((fg) => ({ fg, bg, min: 4.5 as const, use: `${fg} text on ${bg}` })),
  ),
  { fg: 'onBrand', bg: 'brand', min: 4.5, use: 'button label on brand' },
  { fg: 'brandText', bg: 'surface', min: 4.5, use: 'brand-colored text on surface' },
  { fg: 'brandText', bg: 'canvas', min: 4.5, use: 'brand-colored text on canvas (eyebrows, times)' },
  { fg: 'onBubbleMine', bg: 'bubbleMine', min: 4.5, use: 'own chat bubble text' },
  { fg: 'textPrimary', bg: 'bubbleTheirs', min: 4.5, use: 'their chat bubble text' },
  { fg: 'goldText', bg: 'canvas', min: 4.5, use: 'Gold text on canvas' },
  { fg: 'focusRing', bg: 'canvas', min: 3, use: 'focus ring vs canvas' },
  { fg: 'focusRing', bg: 'surface', min: 3, use: 'focus ring vs surface' },
  { fg: 'success', bg: 'surface', min: 4.5, use: 'success text' },
  { fg: 'warning', bg: 'surface', min: 4.5, use: 'warning text' },
  { fg: 'danger', bg: 'surface', min: 4.5, use: 'danger text' },
  { fg: 'plusText', bg: 'plusTint', min: 4.5, use: 'Plus pill text on Plus tint' },
  { fg: 'plusText', bg: 'surface', min: 4.5, use: 'Plus text on surface' },
  { fg: 'plusRing', bg: 'surface', min: 3, use: 'Plus avatar ring (UI) vs surface' },
  { fg: 'goldText', bg: 'surface', min: 4.5, use: 'Gold amount text on surface' },
  { fg: 'onGoldFill', bg: 'goldFill', min: 4.5, use: 'Gold chip label on Gold fill' },
  { fg: 'onPromotedAccent', bg: 'promotedAccent', min: 4.5, use: '"Öne Çıkan" pill label' },
  { fg: 'promotedAccent', bg: 'promotedTint', min: 3, use: 'promoted rail (UI) on promoted tint' },
  { fg: 'textPrimary', bg: 'promotedTint', min: 4.5, use: 'card name on promoted tint' },
  { fg: 'textSecondary', bg: 'promotedTint', min: 4.5, use: 'card meta on promoted tint' },
  { fg: 'textPrimary', bg: 'plusTint', min: 4.5, use: 'card name on Plus tint wash' },
  { fg: 'textSecondary', bg: 'plusTint', min: 4.5, use: 'card meta on Plus tint wash' },
];

export interface Measurement extends Requirement { theme: ThemeName; ratio: number; pass: boolean }

export function measureAll(): Measurement[] {
  return (['light', 'dark'] as const).flatMap((theme) =>
    REQUIREMENTS.map((r) => {
      const ratio = contrast(color[theme][r.fg], color[theme][r.bg]);
      return { ...r, theme, ratio, pass: ratio >= r.min };
    }),
  );
}
