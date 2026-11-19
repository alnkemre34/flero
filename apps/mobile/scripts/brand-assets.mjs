#!/usr/bin/env node
/**
 * FLERO brand assets: ONE source logo → every platform asset the app needs.
 *
 *   node scripts/brand-assets.mjs                 rebuild everything from assets/brand/source/logo.png
 *   node scripts/brand-assets.mjs --placeholder   (re)draw the temporary placeholder logo first, then rebuild
 *
 * To put the real logo in: replace assets/brand/source/logo.png (1024×1024 PNG, transparent background, the mark
 * centred with ~8 % breathing room), adjust colours in assets/brand/brand.json if needed, run this script, then
 * rebuild the native app (icons and the splash are baked into the binary). See assets/brand/README.md.
 */
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'brand');
const out = join(root, 'generated');
const src = join(root, 'source', 'logo.png');
const brand = JSON.parse(readFileSync(join(root, 'brand.json'), 'utf8'));
mkdirSync(out, { recursive: true });
mkdirSync(join(root, 'source'), { recursive: true });

if (process.argv.includes('--placeholder') || !existsSync(src)) {
  // Temporary mark until the real logo exists: the lime FLERO tile with an "F" (same as the in-app mark).
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
    <g transform="rotate(-6 512 512)">
      <rect x="112" y="112" width="800" height="800" rx="232" fill="${brand.brand}"/>
      <path d="M392 292h300v116H526v74h146v112H526v158H392z" fill="${brand.onBrand}"/>
    </g></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(src);
  console.log('placeholder logo written:', src);
}

const logo = await sharp(src).ensureAlpha().resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
const scaled = (px) => sharp(logo).resize(px, px).png().toBuffer();
const onCanvas = async (size, inner, background) =>
  sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: await scaled(inner), gravity: 'centre' }]).png();
/**
 * White silhouette (Android monochrome icon, notification icon). Uses source/logo-mono.png when provided;
 * otherwise derives it from the logo: opaque AND light pixels stay, dark parts (e.g. a letter cut into a tile)
 * become holes, so the mark stays readable as a single colour.
 */
const monoSrc = join(root, 'source', 'logo-mono.png');
const silhouette = async (size, inner) => {
  let a;
  if (existsSync(monoSrc)) {
    a = await sharp(monoSrc).ensureAlpha().resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).extractChannel('alpha').toBuffer();
  } else {
    const px = await scaled(inner);
    const alpha = await sharp(px).extractChannel('alpha').raw().toBuffer();
    const light = await sharp(px).removeAlpha().greyscale().raw().toBuffer();
    const m = Buffer.alloc(alpha.length);
    for (let i = 0; i < m.length; i++) m[i] = light[i] > 96 ? alpha[i] : 0;
    a = await sharp(m, { raw: { width: inner, height: inner, channels: 1 } }).png().toBuffer();
  }
  const white = await sharp({ create: { width: inner, height: inner, channels: 3, background: '#ffffff' } }).joinChannel(a).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: white, gravity: 'centre' }]).png();
};

const jobs = {
  // iOS / store icon: opaque square (Apple adds the corner mask)
  'icon.png': () => onCanvas(1024, 720, brand.iconBackground),
  // Android adaptive icon: foreground must stay inside the 66 % safe zone; background is a flat colour in app.json
  'android-icon-foreground.png': () => onCanvas(1024, 600, { r: 0, g: 0, b: 0, alpha: 0 }),
  'android-icon-monochrome.png': () => silhouette(1024, 600),
  // native splash: transparent mark, shown at `imageWidth` on the splash background colour
  'splash-icon.png': async () => sharp(logo).png(),
  // web favicon
  'favicon.png': () => onCanvas(48, 44, { r: 0, g: 0, b: 0, alpha: 0 }),
  // Android status-bar notification icon: white silhouette on transparent (tinted by the OS with brand colour)
  'notification-icon.png': () => silhouette(96, 80),
  // in-app mark (BrandMark component)
  'logo-mark.png': () => scaled(512).then((b) => sharp(b).png()),
};
for (const [name, make] of Object.entries(jobs)) {
  await (await make()).toFile(join(out, name));
  console.log('wrote', join('assets/brand/generated', name));
}
