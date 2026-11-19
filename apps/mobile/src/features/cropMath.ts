/**
 * Square-crop geometry (pure, unit-tested). The image is laid out "cover" inside a square frame of side F at base
 * scale s0 = F / min(W, H), then transformed by [translate(tx, ty), scale(zoom)] around its own centre.
 * Effective scale s = s0 · zoom. The frame must always be fully covered by the image.
 */
export interface Geometry { W: number; H: number; F: number }

export const baseScale = ({ W, H, F }: Geometry) => F / Math.min(W, H);

/** Largest zoom that still yields a crop of at least `minPx` source pixels (server minimum), capped at 5×. */
export const maxZoom = ({ W, H }: Geometry, minPx = 256) => Math.max(1, Math.min(5, Math.min(W, H) / minPx));

/** Translation limits so the frame never shows outside the image. */
export function bounds(g: Geometry, zoom: number) {
  'worklet';
  const s = (g.F / Math.min(g.W, g.H)) * zoom;
  return { x: Math.max(0, (g.W * s - g.F) / 2), y: Math.max(0, (g.H * s - g.F) / 2) };
}

/** Source-pixel square the user framed; always inside the image and ≥ minPx. */
export function cropFor(g: Geometry, zoom: number, tx: number, ty: number, minPx = 256) {
  const s = baseScale(g) * zoom;
  const size = Math.max(minPx, Math.min(Math.floor(g.F / s), g.W, g.H));
  const x = ((g.W * s) / 2 - tx - g.F / 2) / s;
  const y = ((g.H * s) / 2 - ty - g.F / 2) / s;
  return {
    x: Math.min(Math.max(0, Math.floor(x)), g.W - size),
    y: Math.min(Math.max(0, Math.floor(y)), g.H - size),
    size,
  };
}
