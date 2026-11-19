#!/usr/bin/env node
/**
 * M1.3 frame-time gate (ADR-002, doc 13 §10): scroll the 500-card Shuffle list on a REAL Android device and
 * report the share of frames slower than 16.7 ms from Android's own renderer stats (dumpsys gfxinfo).
 * Gate: ≤ 1 % of frames > 16.7 ms on a midrange device, measured on a RELEASE build.
 * Emulator results are printed but flagged NOT VALID for the gate.
 *
 * Usage: node tools/perf/android-scroll-gate.mjs [--serial <adb-serial>] [--swipes 40] [--package app.flero.dev]
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
};
const pkg = arg('package', 'app.flero.dev');
const swipes = Number(arg('swipes', '40'));
const serial = arg('serial', undefined);

function adb(...args) {
  const full = serial ? ['-s', serial, ...args] : args;
  const r = spawnSync('adb', full, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`adb ${full.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const model = adb('shell', 'getprop', 'ro.product.model').trim();
const isEmulator = adb('shell', 'getprop', 'ro.kernel.qemu').trim() === '1' || /sdk|emulator/i.test(model);
const refresh = (adb('shell', 'dumpsys', 'display').match(/refreshRate=([\d.]+)/) ?? [])[1] ?? '?';
const size = adb('shell', 'wm', 'size').match(/(\d+)x(\d+)/);
const [w, h] = size ? [Number(size[1]), Number(size[2])] : [1080, 2400];

adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'flero://perf-list', pkg);
sleep(4000);
adb('shell', 'dumpsys', 'gfxinfo', pkg, 'reset');
for (let i = 0; i < swipes; i++) {
  adb('shell', 'input', 'swipe', String(w / 2), String(Math.round(h * 0.8)), String(w / 2), String(Math.round(h * 0.2)), '180');
  sleep(250);
}
const out = adb('shell', 'dumpsys', 'gfxinfo', pkg);

const num = (re) => Number((out.match(re) ?? [])[1] ?? NaN);
const total = num(/Total frames rendered: (\d+)/);
const janky = num(/Janky frames: (\d+)/);
const p = (n) => num(new RegExp(`${n}th percentile: (\\d+)ms`));
// HISTOGRAM: 5ms=12 6ms=3 ... — bucket "Xms" counts frames that took up to X ms.
const histogram = [...(out.match(/HISTOGRAM:([^\n]*)/)?.[1] ?? '').matchAll(/(\d+)ms=(\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
const over16 = histogram.filter(([ms]) => ms >= 17).reduce((s, [, c]) => s + c, 0); // conservative: 17 ms bucket and up
const share = total > 0 ? (over16 / total) * 100 : NaN;
const pass = !isEmulator && share <= 1;

const report = {
  date: new Date().toISOString(), device: model, emulator: isEmulator, refreshHz: refresh, package: pkg, swipes,
  totalFrames: total, jankyFramesAndroid: janky, framesOver16_7ms: over16, shareOver16_7ms: Number(share.toFixed(2)),
  p50: p(50), p90: p(90), p95: p(95), p99: p(99),
  gate: isEmulator ? 'NOT VALID (emulator)' : pass ? 'PASS' : 'FAIL',
};
console.log(JSON.stringify(report, null, 2));
mkdirSync('docs/evidence', { recursive: true });
const file = `docs/evidence/perf-android-${model.replace(/\W+/g, '_')}-${report.date.slice(0, 10)}.json`;
writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
console.log(`saved ${file}`);
process.exit(isEmulator || pass ? 0 : 1);
