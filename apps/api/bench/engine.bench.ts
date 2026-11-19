/**
 * Engine latency benchmark (doc 17): real PostgreSQL 17 in Docker, 100k+ accounts with realistic skew, hot
 * paths driven through the real Fastify stack (app.inject: full routing, auth, validation and serialization —
 * no network). Prints p50/p95/p99 per path. Run: node bench/engine.bench.ts [accounts]
 */
import { randomUUID } from 'node:crypto';
import { devPayload } from '../src/wallet/iap.ts';
import { onboarded, startHarness } from '../test/harness.ts';

const TOTAL = Number(process.argv[2] ?? 100_000);
const h = await startHarness();
const pct = (xs: number[], p: number) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))]!;
async function measure(name: string, n: number, fn: (i: number) => Promise<unknown>, concurrency = 8) {
  const times: number[] = [];
  let next = 0;
  const t0 = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < n) {
      const i = next++;
      const t = performance.now();
      await fn(i);
      times.push(performance.now() - t);
    }
  }));
  const wall = (performance.now() - t0) / 1000;
  console.log(`${name.padEnd(34)} n=${String(n).padEnd(5)} p50=${pct(times, 50).toFixed(1).padStart(6)}ms  p95=${pct(times, 95).toFixed(1).padStart(6)}ms  p99=${pct(times, 99).toFixed(1).padStart(6)}ms  ${(n / wall).toFixed(0)} req/s`);
}

try {
  // ---- seed: 40 % İstanbul (skewed districts), rest Ankara/İzmir; 5 % Plus; ~1 % Boost ----
  const t = performance.now();
  const districts: [number, number, number][] = [
    [34, 3401, 0.14], [34, 3402, 0.08], [34, 3403, 0.06], [34, 3404, 0.04], [34, 3405, 0.04], [34, 3406, 0.02], [34, 3407, 0.01], [34, 3408, 0.01],
    [6, 601, 0.2], [6, 602, 0.1], [6, 603, 0.05], [35, 3501, 0.15], [35, 3502, 0.06], [35, 3503, 0.04],
  ];
  for (const [city, d, share] of districts) {
    const n = Math.round(TOTAL * share);
    for (let off = 0; off < n; off += 10_000) {
      await h.pool.query(
        `WITH a AS (
           INSERT INTO app.account (public_id, handle_norm, handle_display, gender, home_city_id, home_district_id, home_region_last_changed_at, age_assured_at)
           SELECT app.opaque_id('usr'), 'b' || $3::text || '_' || i, 'b' || $3::text || '_' || i, CASE WHEN i % 2 = 0 THEN 'FEMALE' ELSE 'MALE' END::app.gender, $1::int, $3::int, now(), now()
             FROM generate_series($4::int, $5::int) i WHERE $2::int = 0 RETURNING id),
         p AS (INSERT INTO app.profile (account_id, display_name) SELECT id, 'Bench ' || id FROM a RETURNING account_id),
         c AS (INSERT INTO app.profile_counter (account_id) SELECT account_id FROM p RETURNING account_id)
         INSERT INTO ident.user_sync_state (account_id) SELECT account_id FROM c`, [city, 0, d, off + 1, Math.min(n, off + 10_000)]);
    }
  }
  await h.pool.query(`INSERT INTO app.plus_entitlement (store, original_txn_id, account_id, valid_from, valid_until, state)
    SELECT 'APPLE', 'bench-' || id, id, now(), now() + interval '30 days', 'ACTIVE' FROM app.account WHERE id % 20 = 0`);
  await h.pool.query(`
    WITH o AS (SELECT id, home_city_id, home_district_id FROM app.account WHERE id % 97 = 0),
         q AS (INSERT INTO app.boost_quote (account_id, package_id, package_version, scope, city_id, district_id, price_gold, duration, home_region_version, expires_at)
               SELECT id, 1, 1, 'DISTRICT', home_city_id, home_district_id, 1, '1 hour', 1, now() + interval '5 min' FROM o RETURNING id, account_id, city_id, district_id),
         t AS (INSERT INTO app.ledger_transaction (op_type, account_id, idempotency_key, payload_hash, actor)
               SELECT 'BOOST', account_id, 'bench', '\\x00', 'bench' FROM q RETURNING id, account_id)
    INSERT INTO app.boost_entitlement (owner_id, scope, city_id, district_id, starts_at, ends_at, price_gold, gold_ledger_debit_id, quote_id)
    SELECT q.account_id, 'DISTRICT', q.city_id, q.district_id, now(), now() + interval '1 hour', 1, t.id, q.id FROM q JOIN t ON t.account_id = q.account_id`);
  await h.pool.query('ANALYZE');
  const { rows: [count] } = await h.pool.query<{ n: number; slots: number }>('SELECT (SELECT count(*) FROM app.account)::int AS n, (SELECT count(*) FROM app.pool_slot)::int AS slots');
  console.log(`seeded ${count!.n} accounts / ${count!.slots} directory slots in ${((performance.now() - t) / 1000).toFixed(1)}s`);
  const drift = await h.pool.query('SELECT * FROM app.discovery_drift()');
  console.log(`directory drift rows: ${drift.rows.length}`);

  // ---- viewers ----
  const big = await onboarded(h, [34, 3401]); // ~14k-member district
  const small = await onboarded(h, [34, 3408]);
  const plus = await onboarded(h, [34, 3402]);
  await h.pool.query(`INSERT INTO app.plus_entitlement (store, original_txn_id, account_id, valid_from, valid_until, state) VALUES ('APPLE', 'v-plus', $1, now(), now() + interval '30 days', 'ACTIVE')`, [plus.id]);
  const shuffle = (u: typeof big, body: object) => h.app.inject({ method: 'POST', url: '/v1/shuffle/sample', headers: u.auth, payload: body }).then((r) => { if (r.statusCode !== 200) throw new Error(r.body); });

  // warm-up
  for (let i = 0; i < 30; i++) await shuffle(big, { mode: 'DISTRICT', gender: 'ALL' });

  console.log('\n--- hot paths (concurrency 8) ---');
  await measure('shuffle district (large, ~14k)', 500, () => shuffle(big, { mode: 'DISTRICT', gender: 'ALL' }));
  await measure('shuffle district (small, ~1k)', 500, () => shuffle(small, { mode: 'DISTRICT', gender: 'ALL' }));
  await measure('shuffle CITY Plus (İstanbul 40k)', 300, () => shuffle(plus, { mode: 'CITY', gender: 'ALL' }));
  await measure('shuffle district Plus FEMALE', 300, () => shuffle(plus, { mode: 'DISTRICT', gender: 'FEMALE' }));

  const pairs = await Promise.all(Array.from({ length: 16 }, async () => [await onboarded(h), await onboarded(h)] as const));
  const convs = await Promise.all(pairs.map(async ([a, b]) => (await h.app.inject({ method: 'POST', url: '/v1/conversations', headers: { ...a.auth, 'idempotency-key': randomUUID() }, payload: { recipient: b.pid, first_message: { client_msg_id: randomUUID(), body: 'hi' } } })).json().conversation_id as string));
  await measure('send message', 1000, (i) => h.app.inject({ method: 'POST', url: `/v1/conversations/${convs[i % 16]}/messages`, headers: { ...pairs[i % 16]![i % 2]!.auth, 'idempotency-key': randomUUID() }, payload: { client_msg_id: randomUUID(), kind: 'TEXT', body: `m${i}` } }));
  await measure('list messages (page 20)', 500, (i) => h.app.inject({ method: 'GET', url: `/v1/conversations/${convs[i % 16]}/messages`, headers: pairs[i % 16]![0].auth }));
  await measure('inbox main', 500, (i) => h.app.inject({ method: 'GET', url: '/v1/inbox?filter=main', headers: pairs[i % 16]![0].auth }));
  await measure('sync since 0', 500, (i) => h.app.inject({ method: 'GET', url: '/v1/sync?since=0', headers: pairs[i % 16]![1].auth }));
  await measure('profile view', 500, (i) => h.app.inject({ method: 'GET', url: `/v1/profiles/${pairs[i % 16]![1].pid}`, headers: pairs[i % 16]![0].auth }));

  await h.pool.query(`INSERT INTO app.gold_product (store, product_id, version, gold_amount, created_by) VALUES ('APPLE', 'gold_100', 1, 100, 'bench')`);
  await measure('IAP verify (credit)', 300, (i) => h.app.inject({ method: 'POST', url: '/v1/wallet/purchases/verify', headers: { ...pairs[i % 16]![0].auth, 'idempotency-key': randomUUID() }, payload: { platform: 'APPLE', signed_payload: devPayload({ store_txn_id: `bench-${i}`, product_id: 'gold_100' }) } }));
  await measure('gold gift (2 wallets, ledger)', 300, (i) => h.app.inject({ method: 'POST', url: `/v1/conversations/${convs[i % 16]}/gold-gifts`, headers: { ...pairs[i % 16]![0].auth, 'idempotency-key': randomUUID() }, payload: {} }));
  await measure('GET /v1/me', 500, (i) => h.app.inject({ method: 'GET', url: '/v1/me', headers: pairs[i % 16]![0].auth }));
  const { rows: [led] } = await h.pool.query<{ s: number }>('SELECT COALESCE(SUM(amount), 0)::int AS s FROM app.ledger_posting');
  console.log(`\nledger global sum after bench: ${led!.s} (must be 0)`);
} finally {
  await h.stop();
}
