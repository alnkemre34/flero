/** Server-owned discovery configuration and its hard bounds (Appendix A §2, §8.5). */

export const ALLOWED_BATCH_SIZES = [10, 15, 20, 25, 35, 50] as const;
export type BatchSize = (typeof ALLOWED_BATCH_SIZES)[number];

export const PRIORITY_BPS_MIN = 500;
export const PRIORITY_BPS_MAX = 4_000;
export const LOCAL_BPS_MIN = 5_000;
export const LOCAL_BPS_MAX = 9_000;

export interface DiscoveryConfig {
  readonly shuffleBatchSize: BatchSize;
  readonly priorityBps: number;
  readonly localBps: number;
}

export const DEFAULT_DISCOVERY_CONFIG: DiscoveryConfig = {
  shuffleBatchSize: 10,
  priorityBps: 3_000,
  localBps: 7_000,
};

export type ConfigViolation =
  | 'BATCH_SIZE_NOT_ALLOWED'
  | 'PRIORITY_BPS_OUT_OF_BOUNDS'
  | 'LOCAL_BPS_OUT_OF_BOUNDS';

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);

/**
 * Validates a candidate config on every path (create, patch, import, rollback — SHF-T38).
 * Remote bps is derived (10000 - local) and is never an input.
 */
export function validateDiscoveryConfig(candidate: {
  shuffleBatchSize: unknown;
  priorityBps: unknown;
  localBps: unknown;
}): { ok: true; config: DiscoveryConfig } | { ok: false; violations: ConfigViolation[] } {
  const violations: ConfigViolation[] = [];
  const { shuffleBatchSize, priorityBps, localBps } = candidate;
  if (!isInt(shuffleBatchSize) || !(ALLOWED_BATCH_SIZES as readonly number[]).includes(shuffleBatchSize)) {
    violations.push('BATCH_SIZE_NOT_ALLOWED');
  }
  if (!isInt(priorityBps) || priorityBps < PRIORITY_BPS_MIN || priorityBps > PRIORITY_BPS_MAX) {
    violations.push('PRIORITY_BPS_OUT_OF_BOUNDS');
  }
  if (!isInt(localBps) || localBps < LOCAL_BPS_MIN || localBps > LOCAL_BPS_MAX) {
    violations.push('LOCAL_BPS_OUT_OF_BOUNDS');
  }
  if (violations.length > 0) return { ok: false, violations };
  return {
    ok: true,
    config: {
      shuffleBatchSize: shuffleBatchSize as BatchSize,
      priorityBps: priorityBps as number,
      localBps: localBps as number,
    },
  };
}

export const remoteBps = (config: DiscoveryConfig): number => 10_000 - config.localBps;
