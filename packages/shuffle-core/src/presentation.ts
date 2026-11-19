import { quota } from './quota.ts';

/** Source of uniform integers in [0, maxExclusive). Production injects node:crypto randomInt. */
export type RandomInt = (maxExclusive: number) => number;

export type Placement = 'BOOST_BLOCK' | 'DISCOVERY';

/** A card selected by the sampler, before presentation ordering. */
export interface SelectedCard<Id extends string = string> {
  readonly publicUserId: Id;
  readonly placement: Placement;
  /** Plus active at response time t0 (not entitlement history). */
  readonly plusActive: boolean;
}

export interface PresentedCard<Id extends string = string> extends SelectedCard<Id> {
  readonly presentationRank: number;
  readonly badges: readonly ('badge.promoted' | 'badge.plus')[];
}

/** Unbiased in-place Fisher–Yates shuffle using the injected RNG. */
export function shuffleInPlace<T>(items: T[], randomInt: RandomInt): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const a = items[i] as T;
    items[i] = items[j] as T;
    items[j] = a;
  }
  return items;
}

/**
 * Appendix A §3.7: BOOST_BLOCK → DISCOVERY_PLUS → DISCOVERY_STANDARD, each block shuffled.
 * A bijection on the selected cards: it never changes inclusion, placement or counts.
 * Badges are placement-specific: promoted only for BOOST_BLOCK (never DISCOVERY).
 */
export function presentationOrder<Id extends string>(
  cards: readonly SelectedCard<Id>[],
  randomInt: RandomInt,
): PresentedCard<Id>[] {
  assertUniqueIds(cards);
  const boost = cards.filter((c) => c.placement === 'BOOST_BLOCK');
  const plus = cards.filter((c) => c.placement === 'DISCOVERY' && c.plusActive);
  const standard = cards.filter((c) => c.placement === 'DISCOVERY' && !c.plusActive);
  const ordered = [
    ...shuffleInPlace([...boost], randomInt),
    ...shuffleInPlace([...plus], randomInt),
    ...shuffleInPlace([...standard], randomInt),
  ];
  return ordered.map((c, i) => ({
    ...c,
    presentationRank: i,
    badges: [
      ...(c.placement === 'BOOST_BLOCK' ? (['badge.promoted'] as const) : []),
      ...(c.plusActive ? (['badge.plus'] as const) : []),
    ],
  }));
}

/** Candidate in a proven-complete sparse pool (A_total < N). */
export interface SparseCandidate<Id extends string = string> {
  readonly publicUserId: Id;
  /** Holds a currently valid Boost that qualifies for THIS surface (district Boost never qualifies in CITY). */
  readonly surfaceQualifyingBoost: boolean;
  readonly plusActive: boolean;
}

/**
 * SPARSE_COMPLETE (Appendix A §3.1.1): every eligible profile exactly once; all surface-qualifying
 * Boost holders get BOOST_BLOCK with no percentage cap; then Plus, then Standard.
 */
export function sparseComplete<Id extends string>(
  eligible: readonly SparseCandidate<Id>[],
  randomInt: RandomInt,
): PresentedCard<Id>[] {
  return presentationOrder(
    eligible.map((c) => ({
      publicUserId: c.publicUserId,
      placement: c.surfaceQualifyingBoost ? ('BOOST_BLOCK' as const) : ('DISCOVERY' as const),
      plusActive: c.plusActive,
    })),
    randomInt,
  );
}

/**
 * UNCERTAIN_PARTIAL cap (doc 11 §3.7, review fix H1): at most quota(k, priorityBps) BOOST_BLOCK cards,
 * where k is the (fixed) returned count. Excess priority draws are DEMOTED to unlabeled DISCOVERY —
 * never dropped — so a boosted account is never excluded where its unboosted twin would be kept.
 * Which excess cards are demoted is chosen uniformly at random.
 */
export function capUncertainPriority<Id extends string>(
  cards: readonly SelectedCard<Id>[],
  priorityBps: number,
  randomInt: RandomInt,
): SelectedCard<Id>[] {
  const cap = quota(cards.length, priorityBps);
  const priorityIdx = cards.flatMap((c, i) => (c.placement === 'BOOST_BLOCK' ? [i] : []));
  if (priorityIdx.length <= cap) return [...cards];
  const demote = new Set(shuffleInPlace([...priorityIdx], randomInt).slice(cap));
  return cards.map((c, i) => (demote.has(i) ? { ...c, placement: 'DISCOVERY' as const } : c));
}

function assertUniqueIds(cards: readonly { publicUserId: string }[]): void {
  const seen = new Set<string>();
  for (const c of cards) {
    if (seen.has(c.publicUserId)) throw new Error('duplicate public ID within one batch (SHF-T16)');
    seen.add(c.publicUserId);
  }
}
