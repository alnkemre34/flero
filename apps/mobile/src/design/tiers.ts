import type { ThemeName } from '@flero/ui-tokens';
import type { CardVariant } from '@/features/shuffle/card/variant';

/**
 * Discovery card design tokens (owner reference 2026-11-15, "FLERO kart sistemi"). One card, three variants:
 *   BOOST     energetic — deep purple base, magenta → coral wash and waves toward the right, coral/magenta frame
 *   PLUS      exclusive — dark plum base, bronze → champagne-gold wash and waves, restrained gold frame, crown
 *   STANDARD  elegant   — midnight navy → indigo, muted violet waves, violet frame
 * Solid gradients only: no glass, no blur, no translucent card surfaces. Light theme uses the same hue families on
 * light grounds with darker accents for contrast. Gender never changes the design (only a small glyph in the meta).
 */
export type Gender = 'FEMALE' | 'MALE';
export type Tier = CardVariant;

export interface CardTokens {
  base: [string, string, string];        // card ground, left → right
  waveA: [string, string];               // large decorative curve (bottom-right)
  waveB: [string, string];               // smaller curve on top of it
  waveOpacity: [number, number];
  waveLine: string;                      // crisp 1.5 px edge along the big curve (the reference's drawn stroke)
  frame: [string, string];               // 1 px border gradient
  shadow: string | null;                 // one soft coloured drop shadow (Boost/Plus only), never a glow halo
  tile: string;                          // photo tile frame
  badge: { fill: [string, string]; text: string; border: string | null; icon: string };
  highlight: string | null;              // Boost: colour of the one-shot sweep on first appearance
  meta: string;                          // region text
  glyphF: string; glyphM: string;        // gender glyph colours
}

/** Avatar face duotones per gender (white initials ≥ 4.5:1 on every stop). */
export const FACES: Record<Gender, [string, string][]> = {
  FEMALE: [['#D9658F', '#6E1C3F'], ['#B65CC9', '#4F1A63'], ['#E07F6B', '#6E2A20'], ['#C7578A', '#5C1838']],
  MALE: [['#3F7CEB', '#14336E'], ['#1F9DAA', '#0C4650'], ['#6A6AE8', '#272475'], ['#3E8FD0', '#123E66']],
};

const TOKENS: Record<ThemeName, Record<CardVariant, CardTokens>> = {
  dark: {
    BOOST: {
      base: ['#1C0F2C', '#3A1142', '#701552'],
      waveA: ['#DB246E', '#FF674D'], waveB: ['#FF674D', '#FFAE5C'], waveOpacity: [0.62, 0.42],
      waveLine: 'rgba(255,170,150,0.55)',
      frame: ['#FF4FA3', '#FF7A4D'],
      shadow: '0px 6px 16px -8px rgba(255,79,140,0.55)',
      tile: '#FF6FB0',
      badge: { fill: ['#FF3D7F', '#FF7A3D'], text: '#FFFFFF', border: null, icon: '#FFFFFF' },
      highlight: 'rgba(255,214,232,0.22)',
      meta: '#E7C9DD', glyphF: '#FF9CC8', glyphM: '#9CC4FF',
    },
    PLUS: {
      base: ['#1A1219', '#2B1B16', '#4D2E17'],
      waveA: ['#B86B19', '#F4BB55'], waveB: ['#F4BB55', '#FFE3A1'], waveOpacity: [0.55, 0.3],
      waveLine: 'rgba(255,214,140,0.5)',
      frame: ['#F4BB55', '#B86B19'],
      shadow: '0px 6px 16px -8px rgba(244,187,85,0.45)',
      tile: '#E8B65A',
      badge: { fill: ['#FFE29A', '#E8A93A'], text: '#3A2400', border: null, icon: '#3A2400' },
      highlight: null,
      meta: '#E6D3B5', glyphF: '#FFB3CF', glyphM: '#A9C8FF',
    },
    STANDARD: {
      base: ['#111525', '#181A36', '#25204A'],
      waveA: ['#44316F', '#7151A8'], waveB: ['#7151A8', '#9C82D9'], waveOpacity: [0.55, 0.3],
      waveLine: 'rgba(170,150,240,0.45)',
      frame: ['#6F5BC8', '#3A3270'],
      shadow: null,
      tile: '#6D5BC4',
      badge: { fill: ['#231F45', '#231F45'], text: '#DCD6FF', border: '#7E6BD6', icon: '#B9AEFF' },
      highlight: null,
      meta: '#B7B4D4', glyphF: '#FF9CC8', glyphM: '#9CC4FF',
    },
  },
  light: {
    BOOST: {
      base: ['#FFF6FA', '#FFE6F0', '#FFD5DC'],
      waveA: ['#FF7FB1', '#FF9A7A'], waveB: ['#FF9A7A', '#FFC48A'], waveOpacity: [0.55, 0.45],
      waveLine: 'rgba(226,52,126,0.45)',
      frame: ['#E2347E', '#F2683F'],
      shadow: '0px 6px 14px -8px rgba(226,52,126,0.4)',
      tile: '#E2347E',
      badge: { fill: ['#E6306F', '#F2683F'], text: '#FFFFFF', border: null, icon: '#FFFFFF' },
      highlight: 'rgba(255,255,255,0.55)',
      meta: '#6B3A55', glyphF: '#C2306F', glyphM: '#2457B8',
    },
    PLUS: {
      base: ['#FFFCF5', '#FFF3DD', '#FCE3B4'],
      waveA: ['#E9B046', '#F7D58A'], waveB: ['#F7D58A', '#FFF0C9'], waveOpacity: [0.55, 0.6],
      waveLine: 'rgba(201,139,34,0.5)',
      frame: ['#D49A2E', '#B87A17'],
      shadow: '0px 6px 14px -8px rgba(184,122,23,0.35)',
      tile: '#C98B22',
      badge: { fill: ['#FFD86E', '#E3A332'], text: '#3A2400', border: null, icon: '#3A2400' },
      highlight: null,
      meta: '#6B5332', glyphF: '#C2306F', glyphM: '#2457B8',
    },
    STANDARD: {
      base: ['#FAFAFE', '#F1F0FC', '#E6E2F8'],
      waveA: ['#B9AEF0', '#D3CBF8'], waveB: ['#D3CBF8', '#ECE8FD'], waveOpacity: [0.6, 0.7],
      waveLine: 'rgba(123,108,240,0.4)',
      frame: ['#A497E6', '#CFC8F4'],
      shadow: null,
      tile: '#9C8FE0',
      badge: { fill: ['#F1EEFF', '#F1EEFF'], text: '#4B3BB8', border: '#9C8FE0', icon: '#5B4BD6' },
      highlight: null,
      meta: '#575670', glyphF: '#C2306F', glyphM: '#2457B8',
    },
  },
};

export const cardTokens = (theme: ThemeName, variant: CardVariant): CardTokens => TOKENS[theme][variant];
