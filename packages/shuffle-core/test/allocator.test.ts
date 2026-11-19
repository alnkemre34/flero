import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_BATCH_SIZES,
  allocateCityPriority,
  allocatePriority,
  allocateSeats,
  quota,
  validateDiscoveryConfig,
} from '../src/index.ts';

describe('quota (A§2, SHF-T10/T11/T40)', () => {
  it('matches the spec tables', () => {
    const table: Record<number, [number, number, number]> = {
      10: [3, 7, 3], 15: [5, 11, 4], 20: [6, 14, 6], 25: [8, 18, 7], 35: [11, 25, 10], 50: [15, 35, 15],
    };
    for (const n of ALLOWED_BATCH_SIZES) {
      expect([quota(n, 3000), quota(n, 7000), n - quota(n, 7000)]).toEqual(table[n]);
    }
    expect(quota(2, 7000)).toBe(1);
  });

  it('rejects invalid domains', () => {
    expect(() => quota(-1, 3000)).toThrow(RangeError);
    expect(() => quota(10, 10_001)).toThrow(RangeError);
    expect(() => quota(1.5, 3000)).toThrow(RangeError);
  });
});

describe('config bounds (A§8.5, SHF-T38)', () => {
  const base = { shuffleBatchSize: 10, priorityBps: 3000, localBps: 7000 };
  it('accepts the default', () => {
    expect(validateDiscoveryConfig(base).ok).toBe(true);
  });
  it.each([0, 499, 4001, 5000, 10_000])('rejects priority %i bps', (priorityBps) => {
    expect(validateDiscoveryConfig({ ...base, priorityBps })).toEqual({ ok: false, violations: ['PRIORITY_BPS_OUT_OF_BOUNDS'] });
  });
  it.each([0, 4999, 9001, 10_000])('rejects local %i bps', (localBps) => {
    expect(validateDiscoveryConfig({ ...base, localBps })).toEqual({ ok: false, violations: ['LOCAL_BPS_OUT_OF_BOUNDS'] });
  });
  it.each([9, 11, 30, 51, 100, '10'])('rejects batch size %s', (shuffleBatchSize) => {
    expect(validateDiscoveryConfig({ ...base, shuffleBatchSize })).toEqual({ ok: false, violations: ['BATCH_SIZE_NOT_ALLOWED'] });
  });
});

describe('worked examples (A§3.6)', () => {
  it('Example A: 20 seats fully stocked → 14/6 seats, 4/2 priority', () => {
    const seats = allocateSeats(20, 7000, 100, 100);
    expect(seats).toEqual({ local: 14, remote: 6 });
    expect(allocatePriority(20, 3000, 7000, seats, 50, 50)).toEqual({ local: 4, remote: 2 });
  });
  it('Example B: 1 local Boost, many remote → 1/5 priority, seats unchanged', () => {
    expect(allocatePriority(20, 3000, 7000, { local: 14, remote: 6 }, 1, 50)).toEqual({ local: 1, remote: 5 });
  });
  it('Example G: local scarcity → 4 LOCAL + 16 REMOTE regardless of Boost', () => {
    expect(allocateSeats(20, 7000, 4, 100)).toEqual({ local: 4, remote: 16 });
  });
  it('NORMAL-only precondition', () => {
    expect(() => allocateSeats(10, 7000, 4, 5)).toThrow(RangeError);
  });
  it('SHF-T92: N=10, 100 Boost owners → exactly Q=3 priority seats', () => {
    const seats = allocateSeats(10, 7000, 500, 500);
    const q = allocatePriority(10, 3000, 7000, seats, 100, 100);
    expect(q.local + q.remote).toBe(3);
  });
});

interface Fixture {
  columns: string[];
  rows: [number, number, number, number, number, number, number, number, number, number, number][];
}

describe('cross-implementation agreement with tools/shuffle-reference (doc 18 §2)', () => {
  const path = fileURLToPath(new URL('./fixtures/allocator_reference.json', import.meta.url));
  const fixture = JSON.parse(readFileSync(path, 'utf8')) as Fixture;

  it('fixture is non-trivial', () => {
    expect(fixture.rows.length).toBeGreaterThan(100_000);
  });

  it('seat totals and priority seats are identical to the Python reference for every row', () => {
    let mismatches = 0;
    const examples: unknown[] = [];
    for (const [n, pb, lb, aL, aR, bL, bR, nL, nR, qL, qR] of fixture.rows) {
      const seats = allocateSeats(n, lb, aL, aR);
      const q = allocatePriority(n, pb, lb, seats, bL, bR);
      if (seats.local !== nL || seats.remote !== nR || q.local !== qL || q.remote !== qR) {
        mismatches++;
        if (examples.length < 5) examples.push({ n, pb, lb, aL, aR, bL, bR, expected: [nL, nR, qL, qR], got: [seats, q] });
      }
    }
    expect({ mismatches, examples }).toEqual({ mismatches: 0, examples: [] });
  });
});

describe('allocator properties (fast-check)', () => {
  const scenario = fc
    .record({
      n: fc.constantFrom(...ALLOWED_BATCH_SIZES),
      pb: fc.integer({ min: 500, max: 4000 }),
      lb: fc.integer({ min: 5000, max: 9000 }),
      aL: fc.integer({ min: 0, max: 200 }),
      aR: fc.integer({ min: 0, max: 200 }),
    })
    .filter((s) => s.aL + s.aR >= s.n)
    .chain((s) =>
      fc.record({ bL: fc.integer({ min: 0, max: s.aL }), bR: fc.integer({ min: 0, max: s.aR }) }).map((b) => ({ ...s, ...b })),
    );

  it('seats sum to N within capacity; priority ≤ Q, fills when supply exists, respects strata', () => {
    fc.assert(
      fc.property(scenario, ({ n, pb, lb, aL, aR, bL, bR }) => {
        const seats = allocateSeats(n, lb, aL, aR);
        expect(seats.local + seats.remote).toBe(n);
        expect(seats.local).toBeLessThanOrEqual(aL);
        expect(seats.remote).toBeLessThanOrEqual(aR);
        const q = allocatePriority(n, pb, lb, seats, bL, bR);
        const Q = quota(n, pb);
        expect(q.local + q.remote).toBe(Math.min(Q, Math.min(seats.local, bL) + Math.min(seats.remote, bR)));
        expect(q.local).toBeLessThanOrEqual(Math.min(seats.local, bL));
        expect(q.remote).toBeLessThanOrEqual(Math.min(seats.remote, bR));
      }),
      { numRuns: 5_000 },
    );
  });

  it("seat totals never depend on Boost counts, and a stratum's own q is nondecreasing when its Boost supply grows (A§3.5)", () => {
    fc.assert(
      fc.property(scenario, fc.boolean(), ({ n, pb, lb, aL, aR, bL, bR }, localSide) => {
        const seats = allocateSeats(n, lb, aL, aR);
        const before = allocatePriority(n, pb, lb, seats, bL, bR);
        if (localSide ? bL >= aL : bR >= aR) return;
        const after = localSide
          ? allocatePriority(n, pb, lb, seats, bL + 1, bR)
          : allocatePriority(n, pb, lb, seats, bL, bR + 1);
        if (localSide) expect(after.local).toBeGreaterThanOrEqual(before.local);
        else expect(after.remote).toBeGreaterThanOrEqual(before.remote);
      }),
      { numRuns: 5_000 },
    );
  });

  it('CITY mode: q = min(Q, B, N)', () => {
    expect(allocateCityPriority(10, 3000, 1)).toBe(1);
    expect(allocateCityPriority(10, 3000, 100)).toBe(3);
    expect(allocateCityPriority(50, 4000, 100)).toBe(20);
  });
});
