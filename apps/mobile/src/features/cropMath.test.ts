// Run: node --test src/features/cropMath.test.ts  (Node strips types natively)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bounds, cropFor, maxZoom } from './cropMath.ts';

const land = { W: 1200, H: 800, F: 300 }; // landscape, s0 = 300/800

test('untouched: centred square of the short side', () => {
  assert.deepEqual(cropFor(land, 1, 0, 0), { x: 200, y: 0, size: 800 });
});

test('dragging the image right reveals its left edge', () => {
  const b = bounds(land, 1);
  assert.equal(b.y, 0);
  assert.equal(b.x, (1200 * 0.375 - 300) / 2);
  assert.deepEqual(cropFor(land, 1, b.x, 0), { x: 0, y: 0, size: 800 });
  assert.deepEqual(cropFor(land, 1, -b.x, 0), { x: 400, y: 0, size: 800 });
});

test('zoom 2× halves the crop and stays centred', () => {
  assert.deepEqual(cropFor(land, 2, 0, 0), { x: 400, y: 200, size: 400 });
});

test('max zoom never goes below the 256 px server minimum', () => {
  const z = maxZoom(land);
  assert.equal(z, 800 / 256);
  assert.ok(cropFor(land, z, 0, 0).size >= 256);
  assert.ok(cropFor(land, z * 3, 0, 0).size >= 256);
});

test('out-of-bounds translation is clamped inside the image', () => {
  const portrait = { W: 600, H: 900, F: 300 };
  for (const [tx, ty] of [[9999, 9999], [-9999, -9999]]) {
    const c = cropFor(portrait, 1.7, tx, ty);
    assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.size <= 600 && c.y + c.size <= 900, JSON.stringify(c));
  }
});
