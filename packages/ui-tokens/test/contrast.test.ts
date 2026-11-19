import { describe, expect, it } from 'vitest';
import { color, contrast, measureAll, REQUIREMENTS, size, type } from '../src/index.ts';

describe('WCAG contrast formula (sanity against known values)', () => {
  it('black/white = 21, identical = 1', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#123456', '#123456')).toBeCloseTo(1, 5);
  });
  it('#767676 on white is the classic ~4.54 AA boundary; #777777 just fails', () => {
    expect(contrast('#767676', '#FFFFFF')).toBeGreaterThan(4.5);
    expect(contrast('#777777', '#FFFFFF')).toBeLessThan(4.5);
  });
  it('is symmetric', () => {
    expect(contrast('#0F6B70', '#FFFFFF')).toBeCloseTo(contrast('#FFFFFF', '#0F6B70'), 10);
  });
});

describe('token contrast meets doc 14 §12 targets in both themes (M1.2)', () => {
  it.each(measureAll().map((m) => [m.theme, m.use, m] as const))('%s: %s', (_t, _u, m) => {
    expect(m.ratio).toBeGreaterThanOrEqual(m.min);
  });
  it('covers every requirement in both themes', () => {
    expect(measureAll()).toHaveLength(REQUIREMENTS.length * 2);
  });
});

describe('role separation (doc 14 §2: accents never cross roles)', () => {
  it.each(['light', 'dark'] as const)('%s: Gold, Plus and Promoted accents are distinct colors', (t) => {
    const c = color[t];
    const accents = [c.goldFill, c.plusRing, c.promotedAccent, c.brand];
    expect(new Set(accents).size).toBe(accents.length);
  });
});

describe('layout tokens honor binding UX rules', () => {
  it('card min-height within the spec 76–88 dp and avatar within 52–58 dp (A§7.1)', () => {
    expect(size.cardMinHeight).toBeGreaterThanOrEqual(76);
    expect(size.cardMinHeight).toBeLessThanOrEqual(88);
    expect(size.avatar).toBeGreaterThanOrEqual(52);
    expect(size.avatar).toBeLessThanOrEqual(58);
  });
  it('hit targets ≥ 44 dp and body text ≥ 16 sp', () => {
    expect(size.hitTarget).toBeGreaterThanOrEqual(44);
    expect(type.body.size).toBeGreaterThanOrEqual(16);
  });
});
