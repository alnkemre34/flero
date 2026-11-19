import { quota } from './quota.ts';

/** NORMAL-mode seat plan for one request. */
export interface SeatTotals {
  readonly local: number;
  readonly remote: number;
}

export interface PrioritySeats {
  readonly local: number;
  readonly remote: number;
}

/**
 * Freeze LOCAL/REMOTE seat totals from proven eligible capacities only (Appendix A §3.2).
 * Boost status is intentionally not a parameter: seat totals must not depend on it.
 * Shortfall in one stratum flows to the other. Precondition: capacities sum to >= n (NORMAL).
 */
export function allocateSeats(n: number, localBps: number, localCapacity: number, remoteCapacity: number): SeatTotals {
  if (localCapacity < 0 || remoteCapacity < 0) throw new RangeError('capacities must be >= 0');
  if (localCapacity + remoteCapacity < n) {
    throw new RangeError('allocateSeats is NORMAL-only: proven A_total must be >= N');
  }
  const local0 = quota(n, localBps);
  const remote0 = n - local0;
  if (localCapacity < local0) return { local: localCapacity, remote: n - localCapacity };
  if (remoteCapacity < remote0) return { local: n - remoteCapacity, remote: remoteCapacity };
  return { local: local0, remote: remote0 };
}

/**
 * Appendix A §3.3 two-stratum priority allocation, implemented verbatim.
 * Deterministic for identical inputs; cross-checked against tools/shuffle-reference.
 *
 * @param boostLocal  exact (or capped at seats.local) count of eligible qualifying Boost holders in LOCAL
 * @param boostRemote exact (or capped at seats.remote) count of eligible qualifying Boost holders in REMOTE
 */
export function allocatePriority(
  n: number,
  priorityBps: number,
  localBps: number,
  seats: SeatTotals,
  boostLocal: number,
  boostRemote: number,
): PrioritySeats {
  const { local: nL, remote: nR } = seats;
  if (nL + nR !== n) throw new RangeError('seat totals must sum to N');
  if (boostLocal < 0 || boostRemote < 0) throw new RangeError('boost counts must be >= 0');

  const q = quota(n, priorityBps);
  let baseL = Math.min(nL, quota(q, localBps));
  let baseR = Math.min(nR, q - baseL);
  let unassigned = q - baseL - baseR;
  let add = Math.min(unassigned, nL - baseL);
  baseL += add;
  unassigned -= add;
  add = Math.min(unassigned, nR - baseR);
  baseR += add;
  unassigned -= add;
  invariant(unassigned === 0, 'Q <= n_L + n_R');

  let qL = Math.min(baseL, boostLocal);
  let qR = Math.min(baseR, boostRemote);
  let missing = q - qL - qR;
  add = Math.min(missing, Math.min(nL, boostLocal) - qL);
  qL += add;
  missing -= add;
  add = Math.min(missing, Math.min(nR, boostRemote) - qR);
  qR += add;
  missing -= add;

  invariant(qL >= 0 && qL <= Math.min(nL, boostLocal), 'q_L bounds');
  invariant(qR >= 0 && qR <= Math.min(nR, boostRemote), 'q_R bounds');
  invariant(qL + qR <= q, 'q_L + q_R <= Q');
  return { local: qL, remote: qR };
}

/** CITY mode has one stratum: q = min(Q, B_CITY, N). */
export function allocateCityPriority(n: number, priorityBps: number, boostCity: number): number {
  if (boostCity < 0) throw new RangeError('boost count must be >= 0');
  return Math.min(quota(n, priorityBps), boostCity, n);
}

function invariant(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`shuffle-core invariant violated: ${message}`);
}
