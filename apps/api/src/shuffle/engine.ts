import { randomBytes, randomInt } from 'node:crypto';
import {
  allocateCityPriority, allocatePriority, allocateSeats, capUncertainPriority, presentationOrder, quota, sparseComplete,
  type BatchSize, type SelectedCard,
} from '@flero/shuffle-core';
import type pg from 'pg';
import type { Tx } from '../db.ts';
import { avatarView } from '../storage.ts';

/**
 * Shuffle engine (doc 11, Appendix A V5.2). Pure selection logic lives in @flero/shuffle-core (cross-checked
 * against the Python exact enumerator); this module is the data plane: snapshot, capacity proof, uniform
 * rejection-sampled draws over dense slot directories, post-check and presentation.
 */

export const E_ENUM = 2_000; // exact enumeration threshold (doc 11 §3.3)
const EXPIRED_SCAN_K = 512;
const PROBE_BATCH = 64;
const MAX_ROUNDS = 6; // DB round trips per draw (doc 11 §3.5 budget)

export interface Config { id: number; n: BatchSize; priorityBps: number; localBps: number }
export interface Surface { mode: 'DISTRICT' | 'CITY'; city: number; district: number | null; genders: ('FEMALE' | 'MALE')[] }
type Kind = 'MEMBER' | 'REMOTE_ELIGIBLE' | 'BOOST_DISTRICT' | 'BOOST_CITY';
interface PoolRow { id: number; district_id: number; gender: string; kind: Kind; size: number }
interface Slot { account_id: number; valid_until: Date | null }

export type SelectionMode = 'NORMAL' | 'SPARSE_COMPLETE' | 'UNCERTAIN_PARTIAL';
export interface Selection {
  mode: SelectionMode;
  completion: 'FULL' | 'EXHAUSTED' | 'UNCERTAIN';
  cards: { id: number; placement: 'BOOST_BLOCK' | 'DISCOVERY'; remote: boolean }[];
  stats: { probes: number; roundTrips: number; enumerated: number };
}

/** One stratum = a union of disjoint pools; sampling over it is uniform at the slot level (doc 11 §4). */
class Stratum {
  readonly U: number;
  private exact: number[] | null = null;
  readonly pools: PoolRow[];
  private readonly ctx: Ctx;
  constructor(pools: PoolRow[], ctx: Ctx) {
    this.pools = pools;
    this.ctx = ctx;
    this.U = pools.reduce((s, p) => s + p.size, 0);
  }
  get ids() { return this.pools.map((p) => p.id); }
  get enumerated() { return this.exact !== null; }

  /** Exact eligible set (bounded: only when U ≤ E_ENUM). */
  async enumerate(): Promise<number[]> {
    if (this.exact) return this.exact;
    if (this.U === 0) return (this.exact = []);
    const { rows } = await this.ctx.q<Slot>('SELECT account_id, valid_until FROM app.pool_slot WHERE pool_id = ANY($1::bigint[])', [this.ids]);
    this.ctx.stats.enumerated += rows.length;
    return (this.exact = [...new Set(rows.filter((r) => this.ctx.eligible(r)).map((r) => r.account_id))]);
  }

  /** Proven lower bound on eligible members: U − expired − (viewer + block counterparties present). */
  /**
   * Cheap proven lower bound U − X − Bk in ONE round trip (no row scan of the stratum). When `need` is given and
   * the cheap bound already covers it, no enumeration happens; exact enumeration is used only when the bound
   * is insufficient and U ≤ E_ENUM (doc 11 §3.3). Returns -1 when the expired scan saturates (caller probes).
   */
  async lowerBound(need = Infinity): Promise<number> {
    if (this.exact) return this.exact.length;
    if (this.U === 0) return (this.exact = []).length;
    const timed = this.pools.some((p) => p.kind !== 'MEMBER');
    const { rows } = await this.ctx.q<{ x: number; bk: number }>(
      `SELECT ${timed ? `(SELECT count(*)::int FROM (SELECT 1 FROM app.pool_slot WHERE pool_id = ANY($1::bigint[])
                 AND valid_until IS NOT NULL AND valid_until <= $3 LIMIT ${EXPIRED_SCAN_K}) e)` : '0'} AS x,
              (SELECT count(*)::int FROM app.pool_slot WHERE pool_id = ANY($1::bigint[]) AND account_id = ANY($2::bigint[])) AS bk`,
      timed ? [this.ids, this.ctx.excludedIds, this.ctx.t0] : [this.ids, this.ctx.excludedIds]);
    const { x, bk } = rows[0]!;
    const cheap = x >= EXPIRED_SCAN_K ? -1 : this.U - x - bk;
    if (cheap >= need) return cheap;
    if (this.U <= E_ENUM) return (await this.enumerate()).length;
    return cheap;
  }

  /**
   * k distinct eligible members not in `taken`, uniformly without replacement. Enumerated strata use a partial
   * Fisher–Yates; large ones use rejection sampling: r ~ U[0, ΣU) maps to (pool, slot) with probability 1/ΣU.
   */
  async draw(k: number, taken: Set<number>): Promise<number[]> {
    if (k <= 0) return [];
    if (this.exact) {
      const pool = this.exact.filter((id) => !taken.has(id));
      for (let i = 0; i < Math.min(k, pool.length); i++) {
        const j = i + randomInt(pool.length - i);
        [pool[i], pool[j]] = [pool[j]!, pool[i]!];
      }
      return pool.slice(0, k);
    }
    const out: number[] = [];
    const seen = new Set(taken);
    for (let round = 0; round < MAX_ROUNDS && out.length < k && this.U > 0; round++) {
      const picks: [number, number][] = [];
      const want = Math.min(PROBE_BATCH, Math.max(8, (k - out.length) * 3));
      for (let i = 0; i < want; i++) {
        let r = randomInt(this.U);
        for (const p of this.pools) { if (r < p.size) { picks.push([p.id, r]); break; } r -= p.size; }
      }
      this.ctx.stats.probes += picks.length;
      const { rows } = await this.ctx.q<Slot & { pool_id: number; slot: number }>(
        `SELECT s.pool_id, s.slot, s.account_id, s.valid_until FROM app.pool_slot s
           JOIN unnest($1::bigint[], $2::int[]) AS t(pool_id, slot) ON s.pool_id = t.pool_id AND s.slot = t.slot`,
        [picks.map((p) => p[0]), picks.map((p) => p[1])]);
      const bySlot = new Map(rows.map((r) => [`${r.pool_id}:${r.slot}`, r]));
      for (const [pool, slot] of picks) { // process in draw order: identical to sequential rejection sampling
        const r = bySlot.get(`${pool}:${slot}`);
        if (!r || seen.has(r.account_id) || !this.ctx.eligible(r)) continue;
        seen.add(r.account_id);
        out.push(r.account_id);
        if (out.length === k) break;
      }
    }
    return out;
  }
}

class Ctx {
  readonly stats = { probes: 0, roundTrips: 0, enumerated: 0 };
  readonly tx: Tx; readonly viewer: number; readonly blocked: Set<number>; readonly t0: Date;
  constructor(tx: Tx, viewer: number, blocked: Set<number>, t0: Date) { this.tx = tx; this.viewer = viewer; this.blocked = blocked; this.t0 = t0; }
  get excludedIds() { return [this.viewer, ...this.blocked]; }
  eligible(r: Slot) {
    return r.account_id !== this.viewer && !this.blocked.has(r.account_id) && (r.valid_until === null || r.valid_until > this.t0);
  }
  async q<T extends pg.QueryResultRow>(sql: string, params: unknown[]) {
    this.stats.roundTrips++;
    return this.tx.query<T>(sql, params);
  }
}

/** One selection over a single consistent snapshot (REPEATABLE READ READ ONLY, doc 11 §3.1). */
export async function select(pool: pg.Pool, viewer: number, surface: Surface, cfg: Config): Promise<Selection> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const t0 = (await client.query<{ now: Date }>('SELECT now()')).rows[0]!.now;
    const blocks = await client.query<{ other: number }>(
      'SELECT CASE WHEN blocker_id = $1 THEN blocked_id ELSE blocker_id END AS other FROM ident.block WHERE blocker_id = $1 OR blocked_id = $1', [viewer]);
    const ctx = new Ctx(client, viewer, new Set(blocks.rows.map((r) => r.other)), t0);
    const { rows: pools } = await ctx.q<PoolRow>(
      `SELECT p.id, p.district_id, p.gender::text, p.kind, z.size FROM app.pool p JOIN app.pool_size z ON z.pool_id = p.id
        WHERE p.city_id = $1 AND p.gender = ANY($2::app.gender[]) ORDER BY p.id`, [surface.city, surface.genders]);
    const pick = (f: (p: PoolRow) => boolean) => new Stratum(pools.filter(f), ctx);
    const out = surface.mode === 'CITY'
      ? await selectCity(ctx, cfg, pick((p) => p.kind === 'MEMBER'), pick((p) => p.kind === 'BOOST_CITY'))
      : await selectDistrict(ctx, cfg,
        pick((p) => p.kind === 'MEMBER' && p.district_id === surface.district),
        pick((p) => p.kind === 'REMOTE_ELIGIBLE' && p.district_id !== surface.district),
        pick((p) => (p.kind === 'BOOST_DISTRICT' || p.kind === 'BOOST_CITY') && p.district_id === surface.district),
        pick((p) => p.kind === 'BOOST_CITY' && p.district_id !== surface.district));
    await client.query('COMMIT');
    return { ...out, stats: ctx.stats };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

type Partial = Omit<Selection, 'stats'>;
const uncertain = (cards: Selection['cards'], priorityBps: number): Partial => {
  const capped = capUncertainPriority(cards.map((c) => ({ publicUserId: String(c.id), placement: c.placement, plusActive: false })), priorityBps, randomInt);
  return { mode: 'UNCERTAIN_PARTIAL', completion: 'UNCERTAIN', cards: cards.map((c, i) => ({ ...c, placement: capped[i]!.placement })) };
};

/** Capacity proven up to `need`: exact when enumerable, else lower bound, else a bounded probe. */
async function proven(s: Stratum, need: number, taken: Set<number>): Promise<{ cap: number; exact: boolean }> {
  const lb = await s.lowerBound(need);
  if (s.enumerated) return { cap: lb, exact: true };
  if (lb >= need) return { cap: lb, exact: false };
  const probe = await s.draw(need, taken); // proof by construction; the drawn ids are discarded (no bias)
  return { cap: Math.max(lb, probe.length), exact: false };
}

async function selectDistrict(ctx: Ctx, cfg: Config, L: Stratum, R: Stratum, PL: Stratum, PR: Stratum): Promise<Partial> {
  const N = cfg.n;
  const none = new Set<number>();
  if (L.U + R.U < N) {
    // sparse: everything is enumerable (≤ N−1 rows) → exact, every eligible profile exactly once
    const [l, r, pl, pr] = await Promise.all([L.enumerate(), R.enumerate(), PL.enumerate(), PR.enumerate()]);
    const prio = new Set([...pl, ...pr]);
    const remote = new Set(r);
    const all = [...new Set([...l, ...r])];
    return { mode: 'SPARSE_COMPLETE', completion: 'EXHAUSTED', cards: sparseComplete(all.map((id) => ({ publicUserId: String(id), surfaceQualifyingBoost: prio.has(id), plusActive: false })), randomInt).map((c) => ({ id: Number(c.publicUserId), placement: c.placement, remote: remote.has(Number(c.publicUserId)) })) };
  }
  const nL0 = quota(N, cfg.localBps);
  let capL = await proven(L, nL0, none);
  let capR = await proven(R, N - nL0, none);
  if (capL.cap + capR.cap < N) {
    // a cheap bound was enough for the nominal seats but not for the total: tighten to exact where bounded
    if (!capL.exact && L.U <= E_ENUM) capL = { cap: (await L.enumerate()).length, exact: true };
    if (!capR.exact && R.U <= E_ENUM) capR = { cap: (await R.enumerate()).length, exact: true };
  }
  if (capL.exact && capR.exact && capL.cap + capR.cap < N) {
    // exact enumeration shows fewer than N eligible (blocks/expiry) → still a complete, honest sparse result
    const [l, r, pl, pr] = [await L.enumerate(), await R.enumerate(), await PL.enumerate(), await PR.enumerate()];
    const prio = new Set([...pl, ...pr]);
    const remote = new Set(r);
    return { mode: 'SPARSE_COMPLETE', completion: 'EXHAUSTED', cards: sparseComplete([...new Set([...l, ...r])].map((id) => ({ publicUserId: String(id), surfaceQualifyingBoost: prio.has(id), plusActive: false })), randomInt).map((c) => ({ id: Number(c.publicUserId), placement: c.placement, remote: remote.has(Number(c.publicUserId)) })) };
  }
  if (capL.cap + capR.cap < N) {
    const got = [...(await L.draw(N, none))];
    const rem = await R.draw(N - got.length, new Set(got));
    return uncertain([...got.map((id) => ({ id, placement: 'DISCOVERY' as const, remote: false })), ...rem.map((id) => ({ id, placement: 'DISCOVERY' as const, remote: true }))], cfg.priorityBps);
  }
  const seats = allocateSeats(N, cfg.localBps, capL.cap, capR.cap);
  // B_s only matters up to the seat count: min(B_s, n_s) proven exactly or by bound (doc 11 §3.4)
  const bL = Math.min((await proven(PL, seats.local, none)).cap, seats.local);
  const bR = Math.min((await proven(PR, seats.remote, none)).cap, seats.remote);
  const q = allocatePriority(N, cfg.priorityBps, cfg.localBps, seats, bL, bR);
  const taken = new Set<number>();
  const cards: Selection['cards'] = [];
  const take = (ids: number[], placement: 'BOOST_BLOCK' | 'DISCOVERY', remote: boolean) => { for (const id of ids) { taken.add(id); cards.push({ id, placement, remote }); } };
  take(await PL.draw(q.local, taken), 'BOOST_BLOCK', false);
  take(await PR.draw(q.remote, taken), 'BOOST_BLOCK', true);
  take(await L.draw(seats.local - cards.filter((c) => !c.remote).length, taken), 'DISCOVERY', false);
  take(await R.draw(seats.remote - cards.filter((c) => c.remote).length, taken), 'DISCOVERY', true);
  if (cards.length < N) return uncertain(cards, cfg.priorityBps);
  const exhausted = capL.exact && capR.exact && capL.cap + capR.cap === N;
  return { mode: 'NORMAL', completion: exhausted ? 'EXHAUSTED' : 'FULL', cards };
}

async function selectCity(ctx: Ctx, cfg: Config, ALL: Stratum, PC: Stratum): Promise<Partial> {
  const N = cfg.n;
  const none = new Set<number>();
  const cap = ALL.U < N ? { cap: (await ALL.enumerate()).length, exact: true } : await proven(ALL, N, none);
  if (cap.exact && cap.cap < N) {
    const prio = new Set(await PC.enumerate());
    return { mode: 'SPARSE_COMPLETE', completion: 'EXHAUSTED', cards: sparseComplete((await ALL.enumerate()).map((id) => ({ publicUserId: String(id), surfaceQualifyingBoost: prio.has(id), plusActive: false })), randomInt).map((c) => ({ id: Number(c.publicUserId), placement: c.placement, remote: false })) };
  }
  if (cap.cap < N) return uncertain((await ALL.draw(N, none)).map((id) => ({ id, placement: 'DISCOVERY' as const, remote: false })), cfg.priorityBps);
  const b = Math.min((await proven(PC, N, none)).cap, N);
  const q = allocateCityPriority(N, cfg.priorityBps, b);
  const taken = new Set<number>();
  const prio = await PC.draw(q, taken);
  prio.forEach((id) => taken.add(id));
  const disc = await ALL.draw(N - prio.length, taken);
  const cards = [...prio.map((id) => ({ id, placement: 'BOOST_BLOCK' as const, remote: false })), ...disc.map((id) => ({ id, placement: 'DISCOVERY' as const, remote: false }))];
  if (cards.length < N) return uncertain(cards, cfg.priorityBps);
  return { mode: 'NORMAL', completion: cap.exact && cap.cap === N ? 'EXHAUSTED' : 'FULL', cards };
}

// ---------- post-check + presentation ----------

interface CardRow { id: number; public_id: string; gender: 'FEMALE' | 'MALE'; display_name: string; avatar_key: string | null; city_key: string; district_key: string; ok: boolean; plus: boolean; boost_ok: boolean; remote_ok: boolean }

/** Late-change check on the primary (READ COMMITTED): state, blocks, entitlements (doc 11 §3.7, review M8). */
export async function postCheck(pool: pg.Pool, viewer: number, surface: Surface, ids: number[]): Promise<Map<number, CardRow>> {
  const { rows } = await pool.query<CardRow>(
    `SELECT a.id, a.public_id, a.gender, p.display_name, p.avatar_key, c.label_key AS city_key, d.label_key AS district_key,
            (a.state = 'ACTIVE' AND a.discoverable AND NOT a.moderation_hold
              AND NOT EXISTS (SELECT 1 FROM ident.block b WHERE (b.blocker_id = $2 AND b.blocked_id = a.id) OR (b.blocker_id = a.id AND b.blocked_id = $2))) AS ok,
            EXISTS (SELECT 1 FROM app.plus_entitlement pe WHERE pe.account_id = a.id AND pe.state IN ('ACTIVE','GRACE') AND now() < COALESCE(pe.grace_until, pe.valid_until)) AS plus,
            EXISTS (SELECT 1 FROM app.boost_entitlement be WHERE be.owner_id = a.id AND be.state = 'ACTIVE' AND now() >= be.starts_at AND now() < be.ends_at
                     AND be.city_id = $3 AND (be.scope = 'CITY' OR ($4::int IS NOT NULL AND be.district_id = $4))) AS boost_ok,
            (EXISTS (SELECT 1 FROM app.plus_entitlement pe WHERE pe.account_id = a.id AND pe.state IN ('ACTIVE','GRACE') AND now() < COALESCE(pe.grace_until, pe.valid_until))
              OR EXISTS (SELECT 1 FROM app.boost_entitlement be WHERE be.owner_id = a.id AND be.state = 'ACTIVE' AND be.scope = 'CITY' AND now() < be.ends_at)) AS remote_ok
       FROM app.account a JOIN app.profile p ON p.account_id = a.id
       JOIN app.city c ON c.id = a.home_city_id JOIN app.district d ON d.id = a.home_district_id
      WHERE a.id = ANY($1::bigint[])`, [ids, viewer, surface.city, surface.mode === 'CITY' ? null : surface.district]);
  return new Map(rows.map((r) => [r.id, r]));
}

export const cardValid = (c: Selection['cards'][number], row: CardRow | undefined) =>
  !!row && row.ok && (c.placement !== 'BOOST_BLOCK' || row.boost_ok) && (!c.remote || row.remote_ok);

export function present(sel: Selection, rows: Map<number, CardRow>) {
  const selected: SelectedCard[] = sel.cards.map((c) => ({ publicUserId: String(c.id), placement: c.placement, plusActive: rows.get(c.id)!.plus }));
  return presentationOrder(selected, randomInt).map((p) => {
    const r = rows.get(Number(p.publicUserId))!;
    return {
      public_user_id: r.public_id, presentation_rank: p.presentationRank, placement: p.placement,
      membership_tier: r.plus ? 'PLUS' as const : 'STANDARD' as const, display_name: r.display_name, avatar: avatarView(r.avatar_key),
      home_city_label_key: r.city_key, home_district_label_key: r.district_key, gender: r.gender, card_badges: [...p.badges],
    };
  });
}

export const batchId = () => `bat_${randomBytes(12).toString('base64url')}`;
