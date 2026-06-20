/**
 * three-cpu-fast: a specialized CPU renderer backend for three.js.
 *
 * NOT a three.js reimplementation — three.js still builds the scene, geometry,
 * materials, and camera. This consumes that output: it bakes STATIC meshes
 * (userData.static) into a world-space triangle buffer ONCE, then each frame
 * transforms with three's real projectionMatrix x matrixWorldInverse, near-clips
 * in clip space, and fills with a tight rasterizer. Dynamic meshes are
 * transformed per frame from cached local geometry.
 *
 * The win over Projector: no per-frame scene traversal, no RenderableFace
 * allocation, no element sort, inlined matrix-vector. Supported subset:
 * triangles + flat per-mesh color (no textures/lighting/shaders).
 */

import { Matrix4 } from 'three';

function extractLocalTris(geometry) {
  const pos = geometry.attributes.position;
  const idx = geometry.index;
  const tris = [];
  const v = (i) => [pos.getX(i), pos.getY(i), pos.getZ(i)];
  if (idx) {
    const a = idx.array;
    for (let i = 0; i < a.length; i += 3) tris.push([...v(a[i]), ...v(a[i + 1]), ...v(a[i + 2])]);
  } else {
    for (let i = 0; i < pos.count; i += 3) tris.push([...v(i), ...v(i + 1), ...v(i + 2)]);
  }
  return tris;
}

// e = Matrix4.elements (column-major). Returns clip-space [x,y,z,w].
function mulVec(e, x, y, z) {
  return [
    e[0] * x + e[4] * y + e[8] * z + e[12],
    e[1] * x + e[5] * y + e[9] * z + e[13],
    e[2] * x + e[6] * y + e[10] * z + e[14],
    e[3] * x + e[7] * y + e[11] * z + e[15],
  ];
}

// Sutherland-Hodgman clip of a clip-space polygon against the near plane z+w>=0.
function clipNear(verts) {
  const out = [];
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    const A = verts[i], B = verts[(i + 1) % n];
    const da = A[2] + A[3], db = B[2] + B[3];
    const ina = da >= 0, inb = db >= 0;
    if (ina) out.push(A);
    if (ina !== inb) {
      const t = da / (da - db);
      out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t, A[3] + (B[3] - A[3]) * t]);
    }
  }
  return out;
}

export class ThreeCPUFastRenderer {
  constructor(width, height, { background = [107, 140, 255] } = {}) {
    this.width = width; this.height = height; this.bg = background;
    this.obs = new Uint8Array(width * height * 3);
    this.zbuf = new Float32Array(width * height);
    this._vp = new Matrix4();
    this._mvp = new Matrix4();
    this.staticTris = null;   // [{t:[9 world], c:[r,g,b]}]
    this.dynamic = null;      // [{obj, local:[[9]...], c}]
    this._ca = new Float64Array(4); this._cb = new Float64Array(4); this._cc = new Float64Array(4); // clip-space scratch
    this._clear = null;       // prebuilt background buffer for fast clear
  }

  compile(scene) {
    this.staticTris = []; this.dynamic = [];
    scene.updateMatrixWorld(true);
    scene.traverse((obj) => {
      if (!obj.isMesh || !obj.geometry || !obj.material || !obj.material.color) return;
      const local = extractLocalTris(obj.geometry);
      const col = obj.material.color, c = [col.r, col.g, col.b];
      if (obj.userData && obj.userData.static) {
        const e = obj.matrixWorld.elements;
        for (const t of local) {
          const w = [];
          for (let k = 0; k < 9; k += 3) { const p = mulVec(e, t[k], t[k + 1], t[k + 2]); w.push(p[0], p[1], p[2]); }
          this.staticTris.push({ t: w, c });
        }
      } else {
        this.dynamic.push({ obj, local, c });
      }
    });
  }

  render(scene, camera) {
    if (this.staticTris === null) this.compile(scene);
    const W = this.width, H = this.height, out = this.obs, zb = this.zbuf;
    if (this._clear === null) {
      this._clear = new Uint8Array(W * H * 3);
      const bg = this.bg;
      for (let i = 0; i < W * H; i++) { const o = i * 3; this._clear[o] = bg[0]; this._clear[o + 1] = bg[1]; this._clear[o + 2] = bg[2]; }
    }
    out.set(this._clear);     // native memcpy clear
    zb.fill(Infinity);

    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    this._vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const vp = this._vp.elements;
    const ca = this._ca, cb = this._cb, cc = this._cc;

    // Camera world position + forward (-Z column of matrixWorld), for a cheap
    // behind-camera pre-cull: a triangle with all verts behind the viewer can't
    // be visible, so skip its transform + clip entirely. Output is unchanged.
    const cm = camera.matrixWorld.elements;
    const cpx = cm[12], cpy = cm[13], cpz = cm[14], fwx = -cm[8], fwy = -cm[9], fwz = -cm[10];

    const st = this.staticTris;
    for (let i = 0; i < st.length; i++) {
      const e = st[i], t = e.t;
      const d0 = (t[0] - cpx) * fwx + (t[1] - cpy) * fwy + (t[2] - cpz) * fwz;
      const d1 = (t[3] - cpx) * fwx + (t[4] - cpy) * fwy + (t[5] - cpz) * fwz;
      const d2 = (t[6] - cpx) * fwx + (t[7] - cpy) * fwy + (t[8] - cpz) * fwz;
      if (d0 < 0 && d1 < 0 && d2 < 0) continue;   // fully behind the camera
      mulVecInto(vp, t[0], t[1], t[2], ca); mulVecInto(vp, t[3], t[4], t[5], cb); mulVecInto(vp, t[6], t[7], t[8], cc);
      this._tri(ca, cb, cc, e.c);
    }
    for (let d = 0; d < this.dynamic.length; d++) {
      const dyn = this.dynamic[d];
      if (!dyn.obj.visible) continue;
      dyn.obj.updateMatrixWorld();
      this._mvp.multiplyMatrices(this._vp, dyn.obj.matrixWorld);
      const m = this._mvp.elements, c = dyn.c, loc = dyn.local;
      for (let i = 0; i < loc.length; i++) {
        const t = loc[i];
        mulVecInto(m, t[0], t[1], t[2], ca); mulVecInto(m, t[3], t[4], t[5], cb); mulVecInto(m, t[6], t[7], t[8], cc);
        this._tri(ca, cb, cc, c);
      }
    }
    return out;
  }

  _tri(a, b, c, col) {
    const W = this.width, H = this.height;
    // Fast path: triangle fully in front of the near plane (z+w>=0) — project
    // inline, no clipping, no allocation (the overwhelmingly common case).
    if (a[2] + a[3] >= 0 && b[2] + b[3] >= 0 && c[2] + c[3] >= 0) {
      const ia = 1 / a[3], ib = 1 / b[3], ic = 1 / c[3];
      this._raster(
        (a[0] * ia * 0.5 + 0.5) * W, (0.5 - a[1] * ia * 0.5) * H, a[2] * ia,
        (b[0] * ib * 0.5 + 0.5) * W, (0.5 - b[1] * ib * 0.5) * H, b[2] * ib,
        (c[0] * ic * 0.5 + 0.5) * W, (0.5 - c[1] * ic * 0.5) * H, c[2] * ic, col);
      return;
    }
    // Fully behind the near plane -> invisible, skip before allocating.
    if (a[2] + a[3] < 0 && b[2] + b[3] < 0 && c[2] + c[3] < 0) return;
    // Slow path (rare): a vertex straddles the near plane — clip then fan.
    const poly = clipNear([[a[0], a[1], a[2], a[3]], [b[0], b[1], b[2], b[3]], [c[0], c[1], c[2], c[3]]]);
    if (poly.length < 3) return;
    const sv = poly.map((p) => { const iw = 1 / p[3]; return [(p[0] * iw * 0.5 + 0.5) * W, (0.5 - p[1] * iw * 0.5) * H, p[2] * iw]; });
    for (let k = 0; k + 2 < sv.length; k++) {
      const A = sv[0], B = sv[k + 1], C = sv[k + 2];
      this._raster(A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2], col);
    }
  }

  _raster(ax, ay, az, bx, by, bz, cx, cy, cz, col) {
    const W = this.width, H = this.height, out = this.obs, zb = this.zbuf;
    let minX = Math.floor(Math.min(ax, bx, cx)); if (minX < 0) minX = 0;
    let maxX = Math.ceil(Math.max(ax, bx, cx)); if (maxX > W - 1) maxX = W - 1;
    let minY = Math.floor(Math.min(ay, by, cy)); if (minY < 0) minY = 0;
    let maxY = Math.ceil(Math.max(ay, by, cy)); if (maxY > H - 1) maxY = H - 1;
    if (minX > maxX || minY > maxY) return;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (area === 0) return;
    const ia = 1 / area, r = col[0] * 255, g = col[1] * 255, bl = col[2] * 255;
    // Edge functions stepped incrementally across each scanline (no per-pixel mul).
    const e0dx = -(by - ay), e0dy = (bx - ax), e1dx = -(cy - by), e1dy = (cx - bx), e2dx = -(ay - cy), e2dy = (ax - cx);
    for (let y = minY; y <= maxY; y++) {
      const fy = y + 0.5, fx0 = minX + 0.5;
      let w0 = ((bx - ax) * (fy - ay) - (by - ay) * (fx0 - ax)) * ia;
      let w1 = ((cx - bx) * (fy - by) - (cy - by) * (fx0 - bx)) * ia;
      let w2 = ((ax - cx) * (fy - cy) - (ay - cy) * (fx0 - cx)) * ia;
      const dw0 = e0dx * ia, dw1 = e1dx * ia, dw2 = e2dx * ia;
      let row = y * W;
      for (let x = minX; x <= maxX; x++, w0 += dw0, w1 += dw1, w2 += dw2) {
        if ((w0 < 0 || w1 < 0 || w2 < 0) && (w0 > 0 || w1 > 0 || w2 > 0)) continue;
        const z = w1 * az + w2 * bz + w0 * cz, idx = row + x;
        if (z >= zb[idx]) continue;
        zb[idx] = z;
        const o = idx * 3; out[o] = r; out[o + 1] = g; out[o + 2] = bl;
      }
    }
  }
}

function mulVecInto(e, x, y, z, o) {
  o[0] = e[0] * x + e[4] * y + e[8] * z + e[12];
  o[1] = e[1] * x + e[5] * y + e[9] * z + e[13];
  o[2] = e[2] * x + e[6] * y + e[10] * z + e[14];
  o[3] = e[3] * x + e[7] * y + e[11] * z + e[15];
}
