/**
 * Which of the three card designs a Shuffle result gets. Pure and unit-tested (variant.test.ts).
 *
 *   server placement BOOST_BLOCK (paid priority slot in THIS batch) → BOOST   (Plus members also get a small crown)
 *   otherwise membership PLUS                                       → PLUS
 *   otherwise                                                       → STANDARD
 *
 * Placement and membership stay separate inputs (A§0.1.10): owning an active Boost is NOT a promoted placement —
 * only the server's `placement` says so. Gender never changes the design. Nothing here reorders results.
 */
export type CardVariant = 'BOOST' | 'PLUS' | 'STANDARD';

export interface VariantInput { placement: 'BOOST_BLOCK' | 'DISCOVERY'; membership_tier: 'PLUS' | 'STANDARD' }

export function cardVariant(i: VariantInput): { variant: CardVariant; plusMember: boolean } {
  const plusMember = i.membership_tier === 'PLUS';
  if (i.placement === 'BOOST_BLOCK') return { variant: 'BOOST', plusMember };
  return { variant: plusMember ? 'PLUS' : 'STANDARD', plusMember };
}
