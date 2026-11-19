import { parseShuffleRequest, ShuffleSampleResponse } from '@flero/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type pg from 'pg';
import { AppError, err } from '../errors.ts';
import type { Deps } from '../server.ts';
import { isPlus } from '../wallet/routes.ts';
import { batchId, cardValid, postCheck, present, select, type Config, type Selection, type Surface } from './engine.ts';

/** Active config, pinned per request; cached briefly (config changes are rare, maker-checker approved). */
let cached: { at: number; cfg: Config } | null = null;
export async function activeConfig(pool: pg.Pool): Promise<Config> {
  if (cached && Date.now() - cached.at < 5_000) return cached.cfg;
  const { rows } = await pool.query<{ id: number; shuffle_batch_size: Config['n']; priority_bps: number; local_bps: number }>(
    `SELECT id, shuffle_batch_size, priority_bps, local_bps FROM app.discovery_config_version
      WHERE activated_at IS NOT NULL ORDER BY activated_at DESC, id DESC LIMIT 1`);
  const r = rows[0];
  const cfg: Config = r ? { id: r.id, n: r.shuffle_batch_size, priorityBps: r.priority_bps, localBps: r.local_bps } : { id: 0, n: 10, priorityBps: 3000, localBps: 7000 };
  cached = { at: Date.now(), cfg };
  return cfg;
}
export const invalidateConfigCache = () => { cached = null; };

export function shuffleRoutes(app: FastifyInstance, deps: Deps) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // body is parsed by hand: forbidden override keys must win over generic validation (T84, T87)
  r.post('/v1/shuffle/sample', { schema: { response: { 200: ShuffleSampleResponse } } }, async (req) => {
    const parsed = parseShuffleRequest(req.body);
    if (!parsed.ok) throw new AppError(parsed.code, parsed.status);
    const body = parsed.value;
    const viewer = req.auth!.aid;
    const acc = await deps.pool.query<{ home_city_id: number | null; home_district_id: number | null }>(
      `SELECT home_city_id, home_district_id FROM app.account WHERE id = $1 AND state = 'ACTIVE'`, [viewer]);
    const a = acc.rows[0];
    if (!a || a.home_city_id === null) throw err.unavailable();
    const plus = await isPlus(deps.pool, viewer);

    // ---- surface resolution (doc 11 §1): server-only, never trusts the client for scope ----
    let surface: Surface;
    const genders: Surface['genders'] = body.gender === 'ALL' ? ['FEMALE', 'MALE'] : [body.gender];
    if (!plus && body.gender !== 'ALL') throw new AppError('SHUFFLE_FILTER_REQUIRES_PLUS', 403);
    if (body.mode === 'CITY') {
      if (!plus) throw new AppError('SHUFFLE_SURFACE_NOT_ALLOWED', 403);
      surface = { mode: 'CITY', city: a.home_city_id, district: null, genders };
    } else {
      const target = body.target_district_id ? Number(body.target_district_id.slice(4)) : a.home_district_id!;
      if (!plus && target !== a.home_district_id) throw new AppError('SHUFFLE_SURFACE_NOT_ALLOWED', 403);
      if (target !== a.home_district_id) {
        const inCity = await deps.pool.query('SELECT 1 FROM app.district WHERE id = $1 AND city_id = $2', [target, a.home_city_id]);
        if (!inCity.rows[0]) throw new AppError('SHUFFLE_SURFACE_NOT_ALLOWED', 403);
      }
      surface = { mode: 'DISTRICT', city: a.home_city_id, district: target, genders };
    }
    const cfg = await activeConfig(deps.pool);

    // ---- select → post-check → at most one fresh re-run → else UNCERTAIN_PARTIAL ----
    let sel: Selection = await select(deps.pool, viewer, surface, cfg);
    let rows = await postCheck(deps.pool, viewer, surface, sel.cards.map((c) => c.id));
    if (!sel.cards.every((c) => cardValid(c, rows.get(c.id)))) {
      sel = await select(deps.pool, viewer, surface, cfg);
      rows = await postCheck(deps.pool, viewer, surface, sel.cards.map((c) => c.id));
      if (!sel.cards.every((c) => cardValid(c, rows.get(c.id)))) {
        const kept = sel.cards.filter((c) => cardValid(c, rows.get(c.id)));
        const cap = Math.floor((kept.length * cfg.priorityBps) / 10_000);
        let boosts = 0;
        sel = {
          ...sel, mode: 'UNCERTAIN_PARTIAL', completion: 'UNCERTAIN',
          // demote (never drop) excess priority cards beyond quota(k) — review H1
          cards: kept.map((c) => (c.placement === 'BOOST_BLOCK' && ++boosts > cap ? { ...c, placement: 'DISCOVERY' as const } : c)),
        };
      }
    }
    req.log.debug({ shuffle: sel.stats, mode: sel.mode }, 'shuffle');
    return {
      batch_id: batchId(), mode: surface.mode,
      applied: {
        gender: body.gender, shuffle_batch_size: cfg.n,
        ...(surface.mode === 'DISTRICT' ? { district_id: `dst_${surface.district}` } : {}),
        config_version: `cfg_${cfg.id}`,
      },
      selection_mode: sel.mode, completion: sel.completion, has_more: sel.completion !== 'EXHAUSTED',
      items: present(sel, rows),
    };
  });
}
