import { randomInt } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  capUncertainPriority,
  presentationOrder,
  quota,
  sparseComplete,
  type SelectedCard,
  type SparseCandidate,
} from '../src/index.ts';

const rng = (max: number) => randomInt(max);

const cardArb = fc.uniqueArray(
  fc.record({
    publicUserId: fc.stringMatching(/^usr_[a-z0-9]{6}$/),
    placement: fc.constantFrom('BOOST_BLOCK' as const, 'DISCOVERY' as const),
    plusActive: fc.boolean(),
  }),
  { selector: (c) => c.publicUserId, maxLength: 50 },
);

const group = (c: SelectedCard): number => (c.placement === 'BOOST_BLOCK' ? 0 : c.plusActive ? 1 : 2);

describe('presentation order (A§3.7, SHF-T13/T14/T42/T73/T74/T89)', () => {
  it('is a bijection with BOOST_BLOCK prefix, then Plus, then Standard, and placement-specific badges', () => {
    fc.assert(
      fc.property(cardArb, (cards) => {
        const out = presentationOrder(cards, rng);
        expect(out.map((c) => c.publicUserId).sort()).toEqual(cards.map((c) => c.publicUserId).sort());
        const groups = out.map(group);
        expect(groups).toEqual([...groups].sort((a, b) => a - b));
        out.forEach((c, i) => {
          expect(c.presentationRank).toBe(i);
          expect(c.badges.includes('badge.promoted')).toBe(c.placement === 'BOOST_BLOCK');
          expect(c.badges.includes('badge.plus')).toBe(c.plusActive);
        });
        // placements and counts are unchanged by sorting
        const count = (xs: readonly SelectedCard[], p: string) => xs.filter((x) => x.placement === p).length;
        expect(count(out, 'BOOST_BLOCK')).toBe(count(cards, 'BOOST_BLOCK'));
      }),
      { numRuns: 2_000 },
    );
  });

  it('rejects in-batch duplicates (SHF-T16)', () => {
    const dup: SelectedCard[] = [
      { publicUserId: 'usr_a', placement: 'DISCOVERY', plusActive: false },
      { publicUserId: 'usr_a', placement: 'DISCOVERY', plusActive: true },
    ];
    expect(() => presentationOrder(dup, rng)).toThrow(/duplicate/);
  });

  it('shuffles within blocks: each of 3 Boost cards reaches position 0 (uniformity smoke)', () => {
    const cards: SelectedCard[] = ['a', 'b', 'c'].map((id) => ({ publicUserId: id, placement: 'BOOST_BLOCK', plusActive: false }));
    const first = new Map<string, number>();
    const runs = 30_000;
    for (let i = 0; i < runs; i++) {
      const id = presentationOrder(cards, rng)[0]!.publicUserId;
      first.set(id, (first.get(id) ?? 0) + 1);
    }
    for (const id of ['a', 'b', 'c']) expect(Math.abs((first.get(id) ?? 0) / runs - 1 / 3)).toBeLessThan(0.02);
  });
});

describe('SPARSE_COMPLETE (A§3.1.1, SHF-T46/T63/T66–T69/T86)', () => {
  it('N=10, 8 eligible: 6 surface-qualifying Boost, 1 Plus, 1 Standard → all 8, ordered, 6 promoted', () => {
    const eligible: SparseCandidate[] = [
      ...Array.from({ length: 6 }, (_, i) => ({ publicUserId: `b${i}`, surfaceQualifyingBoost: true, plusActive: i % 2 === 0 })),
      { publicUserId: 'p', surfaceQualifyingBoost: false, plusActive: true },
      { publicUserId: 's', surfaceQualifyingBoost: false, plusActive: false },
    ];
    const out = sparseComplete(eligible, rng);
    expect(out).toHaveLength(8);
    expect(out.slice(0, 6).every((c) => c.placement === 'BOOST_BLOCK' && c.badges.includes('badge.promoted'))).toBe(true);
    expect(out[6]!.publicUserId).toBe('p');
    expect(out[7]!.publicUserId).toBe('s');
  });

  it('a district Boost in CITY mode is non-qualifying → DISCOVERY_STANDARD after Plus (SHF-T69)', () => {
    const out = sparseComplete(
      [
        { publicUserId: 'districtBoostStd', surfaceQualifyingBoost: false, plusActive: false },
        { publicUserId: 'plus', surfaceQualifyingBoost: false, plusActive: true },
      ],
      rng,
    );
    expect(out.map((c) => c.publicUserId)).toEqual(['plus', 'districtBoostStd']);
    expect(out.every((c) => !c.badges.includes('badge.promoted'))).toBe(true);
  });

  it('includes every eligible profile exactly once, with no ratio cap (property)', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.record({ publicUserId: fc.stringMatching(/^usr_[a-z0-9]{5}$/), surfaceQualifyingBoost: fc.boolean(), plusActive: fc.boolean() }),
          { selector: (c) => c.publicUserId, maxLength: 49 },
        ),
        (eligible) => {
          const out = sparseComplete(eligible, rng);
          expect(out).toHaveLength(eligible.length);
          expect(out.filter((c) => c.placement === 'BOOST_BLOCK')).toHaveLength(eligible.filter((e) => e.surfaceQualifyingBoost).length);
        },
      ),
    );
  });
});

describe('UNCERTAIN_PARTIAL cap (doc 11 §3.7, review H1)', () => {
  it('caps BOOST_BLOCK at quota(k) by demotion, never by dropping cards', () => {
    fc.assert(
      fc.property(cardArb, fc.integer({ min: 500, max: 4000 }), (cards, pb) => {
        const out = capUncertainPriority(cards, pb, rng);
        expect(out).toHaveLength(cards.length);
        expect(out.map((c) => c.publicUserId)).toEqual(cards.map((c) => c.publicUserId));
        const before = cards.filter((c) => c.placement === 'BOOST_BLOCK').length;
        const after = out.filter((c) => c.placement === 'BOOST_BLOCK').length;
        expect(after).toBe(Math.min(before, quota(cards.length, pb)));
        out.forEach((c, i) => {
          if (cards[i]!.placement === 'DISCOVERY') expect(c.placement).toBe('DISCOVERY');
        });
      }),
      { numRuns: 2_000 },
    );
  });
});
