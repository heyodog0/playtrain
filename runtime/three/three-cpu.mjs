/**
 * three-cpu: render a REAL three.js Scene + Camera on the CPU — no GPU, no Dawn,
 * no readback fence. Uses three's own Projector (scene-graph traversal, transforms,
 * projection, clipping, backface cull) and a small triangle rasterizer to fill the
 * projected faces into a CPU RGB buffer.
 *
 * The point: environments are authored in STANDARD three.js (the API LLMs are most
 * fluent in), but executed on the CPU — fast, portable, no GPU contention. The same
 * scene also runs on the GPU via three's WebGPURenderer; only the engine changes.
 */

import { Projector, RenderableFace } from 'three/examples/jsm/renderers/Projector.js';

export class ThreeCPURenderer {
  constructor(width, height, { background = [107, 140, 255] } = {}) {
    this.width = width;
    this.height = height;
    this.bg = background;
    this.obs = new Uint8Array(width * height * 3);
    this.zbuf = new Float32Array(width * height);
    this._projector = new Projector();
  }

  render(scene, camera) {
    const W = this.width, H = this.height, out = this.obs, zb = this.zbuf, bg = this.bg;
    for (let i = 0; i < W * H; i++) { zb[i] = Infinity; const o = i * 3; out[o] = bg[0]; out[o + 1] = bg[1]; out[o + 2] = bg[2]; }

    const rd = this._projector.projectScene(scene, camera, true, false);
    const els = rd.elements;
    for (let e = 0; e < els.length; e++) {
      const el = els[e];
      if (!(el instanceof RenderableFace)) continue;
      const a = el.v1.positionScreen, b = el.v2.positionScreen, c = el.v3.positionScreen;
      const ax = (W * 0.5) * (1 + a.x), ay = (H * 0.5) * (1 - a.y), az = a.z;
      const bx = (W * 0.5) * (1 + b.x), by = (H * 0.5) * (1 - b.y), bz = b.z;
      const cx = (W * 0.5) * (1 + c.x), cy = (H * 0.5) * (1 - c.y), cz = c.z;
      const col = el.material.color;   // material color (el.color is white for unlit MeshBasic)
      const r = col.r * 255, g = col.g * 255, bl = col.b * 255;

      const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxX = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
      const minY = Math.max(0, Math.floor(Math.min(ay, by, cy))), maxY = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
      if (minX > maxX || minY > maxY) continue;
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (area === 0) continue;
      const ia = 1 / area;
      for (let y = minY; y <= maxY; y++) {
        const fy = y + 0.5;
        for (let x = minX; x <= maxX; x++) {
          const fx = x + 0.5;
          const w0 = ((bx - ax) * (fy - ay) - (by - ay) * (fx - ax)) * ia;
          const w1 = ((cx - bx) * (fy - by) - (cy - by) * (fx - bx)) * ia;
          const w2 = ((ax - cx) * (fy - cy) - (ay - cy) * (fx - cx)) * ia;
          if ((w0 < 0 || w1 < 0 || w2 < 0) && (w0 > 0 || w1 > 0 || w2 > 0)) continue;
          const z = w1 * az + w2 * bz + w0 * cz;
          const idx = y * W + x;
          if (z >= zb[idx]) continue;
          zb[idx] = z;
          const o = idx * 3; out[o] = r; out[o + 1] = g; out[o + 2] = bl;
        }
      }
    }
    return out;
  }
}
