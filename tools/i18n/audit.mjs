// i18n audit: every key the mobile app can render must exist in tr.ts, including keys that come from the
// server (notification types, transaction kinds, geo labels) and every stable API error code must have a
// Turkish message in both clients. Exit code 1 lists the gaps. Usage: node tools/i18n/audit.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');
const tr = read('apps/mobile/src/i18n/tr.ts');
const have = new Set([...tr.matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]));

const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f)) files.push(p); } };
walk(join(root, 'apps/mobile/src'));

const used = new Set();
for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/\bt\('([a-zA-Z0-9_.]+)'\)/g)) used.add(m[1]);

const list = (src, re) => { const m = src.match(re); return m ? [...m[1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]) : []; };
const catalog = read('packages/contracts/src/catalog.ts');
const wallet = read('packages/contracts/src/wallet.ts');
for (const k of list(catalog, /NotificationType = z\.enum\(\[([\s\S]*?)\]\)/)) used.add(`notif.${k}`);
for (const k of list(wallet, /kind: z\.enum\(\[([\s\S]*?)\]\)/)) used.add(`tx.${k}`);
for (const m of read('packages/db/migrations/0003_engine.sql').matchAll(/'(geo\.(?:city|district)\.[a-z_]+)'/g)) used.add(m[1]);

const problems = [...used].filter((k) => !have.has(k)).sort().map((k) => `mobile tr.ts missing key: ${k}`);
const codes = list(read('packages/contracts/src/common.ts'), /ErrorCode = z\.enum\(\[([\s\S]*?)\]\)/);
for (const [name, path] of [['mobile', 'apps/mobile/src/api/client.ts'], ['admin', 'apps/admin/src/lib/api.ts']]) {
  const src = read(path);
  for (const c of codes) if (!new RegExp(`\\b${c}:`).test(src)) problems.push(`${name} missing error text: ${c}`);
}
console.log(problems.length ? `${problems.length} i18n gaps:\n  ${problems.join('\n  ')}` : 'i18n: complete');
process.exit(problems.length ? 1 : 0);
