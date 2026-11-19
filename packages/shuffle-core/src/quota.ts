/**
 * Half-up integer quota, Appendix A §2: (n * bps + 5000) div 10000.
 * Never use Math.round — the spec mandates exact integer half-up semantics.
 */
export function quota(n: number, bps: number): number {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`quota: invalid n=${n}`);
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > 10_000) throw new RangeError(`quota: invalid bps=${bps}`);
  return Math.floor((n * bps + 5_000) / 10_000);
}
