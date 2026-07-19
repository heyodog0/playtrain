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
 * Supported (generic, env-agnostic) material features:
 *   - flat per-mesh colour (material.color), OR per-vertex colour
 *     (material.vertexColors + geometry `color` attribute), flat per face;
 *   - a repeating colour `.map` texture (material.map + geometry `uv`), sampled
 *     nearest with a footprint fade toward the texture's average colour — a cheap
 *     2-level mip so receding/tiled surfaces don't alias or drop out.
 * No lighting is computed here: shading is baked into vertex colours by the env.
 */

import { Matrix4 } from 'three';

// Per-triangle attributes pulled from a geometry: positions (9), a flat colour
// (= material.color x the first vertex's vertex-colour), and optional uvs (6).
function extractTris(geometry, material) {
  const pos = geometry.attributes.position;
  const colAttr = (material.vertexColors && geometry.attributes.color) || null;
  const uvAttr = (material.map && geometry.attributes.uv) || null;
  const mc = material.color;
  const idx = geometry.index ? geometry.index.array : null;
  const n = idx ? idx.length : pos.count;
  const out = [];
  for (let t = 0; t < n; t += 3) {
    const a = idx ? idx[t] : t, b = idx ? idx[t + 1] : t + 1, c = idx ? idx[t + 2] : t + 2;
    const p = [pos.getX(a), pos.getY(a), pos.getZ(a), pos.getX(b), pos.getY(b), pos.getZ(b), pos.getX(c), pos.getY(c), pos.getZ(c)];
    const col = colAttr
      ? [mc.r * colAttr.getX(a), mc.g * colAttr.getY(a), mc.b * colAttr.getZ(a)]
      : [mc.r, mc.g, mc.b];
    const uv = uvAttr ? [uvAttr.getX(a), uvAttr.getY(a), uvAttr.getX(b), uvAttr.getY(b), uvAttr.getX(c), uvAttr.getY(c)] : null;
    out.push({ p, col, uv });
  }
  return out;
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
    this.staticTris = null;   // [{t:[9 world], col:[r,g,b], uv:[6]|null, tex|null}]
    this.dynamic = null;      // [{obj, tris:[{p,col,uv}], tex}]
    this._texCache = null;
    this._ca = new Float64Array(4); this._cb = new Float64Array(4); this._cc = new Float64Array(4);
    this._clear = null;
  }

  // Prepare a material.map (a DataTexture) for sampling: cache its pixel buffer +
  // average colour (the "1x1 mip" we fade toward as the footprint grows).
  _prepTex(map) {
    if (this._texCache.has(map)) return this._texCache.get(map);
    const img = map.image, w = img.width, h = img.height, d = img.data;
    let ar = 0, ag = 0, ab = 0; const n = w * h;
    for (let i = 0; i < n; i++) { const o = i * 4; ar += d[o]; ag += d[o + 1]; ab += d[o + 2]; }
    const tex = { w, h, data: d, avg: [ar / n, ag / n, ab / n] };
    this._texCache.set(map, tex);
    return tex;
  }

  compile(scene) {
    this.staticTris = []; this.dynamic = []; this._texCache = new Map();
    scene.updateMatrixWorld(true);
    scene.traverse((obj) => {
      if (!obj.isMesh || !obj.geometry || !obj.material || !obj.material.color) return;
      const mat = obj.material;
      const tex = mat.map ? this._prepTex(mat.map) : null;
      const tris = extractTris(obj.geometry, mat);
      if (obj.userData && obj.userData.static) {
        const e = obj.matrixWorld.elements;
        for (const tr of tris) {
          const p = tr.p, w = [];
          for (let k = 0; k < 9; k += 3) { const q = mulVec(e, p[k], p[k + 1], p[k + 2]); w.push(q[0], q[1], q[2]); }
          this.staticTris.push({ t: w, col: tr.col, uv: tr.uv, tex });
        }
      } else {
        this.dynamic.push({ obj, tris, tex });
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
    out.set(this._clear);
    zb.fill(Infinity);

    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    this._vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const vp = this._vp.elements;
    const ca = this._ca, cb = this._cb, cc = this._cc;

    // behind-camera pre-cull (skip transform+clip for fully-behind triangles).
    const cm = camera.matrixWorld.elements;
    const cpx = cm[12], cpy = cm[13], cpz = cm[14], fwx = -cm[8], fwy = -cm[9], fwz = -cm[10];

    const st = this.staticTris;
    for (let i = 0; i < st.length; i++) {
      const e = st[i], t = e.t;
      const d0 = (t[0] - cpx) * fwx + (t[1] - cpy) * fwy + (t[2] - cpz) * fwz;
      const d1 = (t[3] - cpx) * fwx + (t[4] - cpy) * fwy + (t[5] - cpz) * fwz;
      const d2 = (t[6] - cpx) * fwx + (t[7] - cpy) * fwy + (t[8] - cpz) * fwz;
      if (d0 < 0 && d1 < 0 && d2 < 0) continue;
      mulVecInto(vp, t[0], t[1], t[2], ca); mulVecInto(vp, t[3], t[4], t[5], cb); mulVecInto(vp, t[6], t[7], t[8], cc);
      this._tri(ca, cb, cc, e.col, e.uv, e.tex);
    }
    for (let d = 0; d < this.dynamic.length; d++) {
      const dyn = this.dynamic[d];
      if (!dyn.obj.visible) continue;
      dyn.obj.updateMatrixWorld();
      this._mvp.multiplyMatrices(this._vp, dyn.obj.matrixWorld);
      const m = this._mvp.elements;
      for (const tr of dyn.tris) {
        const p = tr.p;
        mulVecInto(m, p[0], p[1], p[2], ca); mulVecInto(m, p[3], p[4], p[5], cb); mulVecInto(m, p[6], p[7], p[8], cc);
        this._tri(ca, cb, cc, tr.col, tr.uv, dyn.tex);
      }
    }
    return out;
  }

  _tri(a, b, c, col, uv, tex) {
    const W = this.width, H = this.height;
    const textured = !!(tex && uv);
    if (a[2] + a[3] >= 0 && b[2] + b[3] >= 0 && c[2] + c[3] >= 0) {
      const ia = 1 / a[3], ib = 1 / b[3], ic = 1 / c[3];
      const sax = (a[0] * ia * 0.5 + 0.5) * W, say = (0.5 - a[1] * ia * 0.5) * H, saz = a[2] * ia;
      const sbx = (b[0] * ib * 0.5 + 0.5) * W, sby = (0.5 - b[1] * ib * 0.5) * H, sbz = b[2] * ib;
      const scx = (c[0] * ic * 0.5 + 0.5) * W, scy = (0.5 - c[1] * ic * 0.5) * H, scz = c[2] * ic;
      if (textured) this._rasterTex(sax, say, saz, sbx, sby, sbz, scx, scy, scz, col, uv, tex, ia, ib, ic);
      else this._rasterFlat(sax, say, saz, sbx, sby, sbz, scx, scy, scz, col);
      return;
    }
    if (a[2] + a[3] < 0 && b[2] + b[3] < 0 && c[2] + c[3] < 0) return;
    // Slow path (vertex straddles the near plane): clip + fan, always flat.
    const poly = clipNear([[a[0], a[1], a[2], a[3]], [b[0], b[1], b[2], b[3]], [c[0], c[1], c[2], c[3]]]);
    if (poly.length < 3) return;
    const sv = poly.map((p) => { const iw = 1 / p[3]; return [(p[0] * iw * 0.5 + 0.5) * W, (0.5 - p[1] * iw * 0.5) * H, p[2] * iw]; });
    for (let k = 0; k + 2 < sv.length; k++) {
      const A = sv[0], B = sv[k + 1], C = sv[k + 2];
      this._rasterFlat(A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2], col);
    }
  }

  // Flat fill — monomorphic and tight (the common path; kept identical in shape
  // to the original renderer so V8 keeps it fast).
  _rasterFlat(ax, ay, az, bx, by, bz, cx, cy, cz, col) {
    const W = this.width, H = this.height, out = this.obs, zb = this.zbuf;
    let minX = Math.floor(Math.min(ax, bx, cx)); if (minX < 0) minX = 0;
    let maxX = Math.ceil(Math.max(ax, bx, cx)); if (maxX > W - 1) maxX = W - 1;
    let minY = Math.floor(Math.min(ay, by, cy)); if (minY < 0) minY = 0;
    let maxY = Math.ceil(Math.max(ay, by, cy)); if (maxY > H - 1) maxY = H - 1;
    if (minX > maxX || minY > maxY) return;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (area === 0) return;
    const ia = 1 / area, r = col[0] * 255, g = col[1] * 255, bl = col[2] * 255;
    const dw0 = (-(by - ay)) * ia, dw1 = (-(cy - by)) * ia, dw2 = (-(ay - cy)) * ia;
    for (let y = minY; y <= maxY; y++) {
      const fy = y + 0.5, fx0 = minX + 0.5;
      let w0 = ((bx - ax) * (fy - ay) - (by - ay) * (fx0 - ax)) * ia;
      let w1 = ((cx - bx) * (fy - by) - (cy - by) * (fx0 - bx)) * ia;
      let w2 = ((ax - cx) * (fy - cy) - (ay - cy) * (fx0 - cx)) * ia;
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

  // Textured fill — repeating .map with nearest sample + footprint fade to the
  // texture average (cheap mip). Separate fn so the flat path stays monomorphic.
  _rasterTex(ax, ay, az, bx, by, bz, cx, cy, cz, col, uv, tex, iwA, iwB, iwC) {
    const W = this.width, H = this.height, out = this.obs, zb = this.zbuf;
    let minX = Math.floor(Math.min(ax, bx, cx)); if (minX < 0) minX = 0;
    let maxX = Math.ceil(Math.max(ax, bx, cx)); if (maxX > W - 1) maxX = W - 1;
    let minY = Math.floor(Math.min(ay, by, cy)); if (minY < 0) minY = 0;
    let maxY = Math.ceil(Math.max(ay, by, cy)); if (maxY > H - 1) maxY = H - 1;
    if (minX > maxX || minY > maxY) return;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (area === 0) return;
    const ia = 1 / area, r255 = col[0] * 255, g255 = col[1] * 255, b255 = col[2] * 255;
    const dw0 = (-(by - ay)) * ia, dw1 = (-(cy - by)) * ia, dw2 = (-(ay - cy)) * ia;
    const Au = uv[0], Av = uv[1], Bu = uv[2], Bv = uv[3], Cu = uv[4], Cv = uv[5];
    const tw = tex.w, th = tex.h, td = tex.data, aR = tex.avg[0];
    const dw0y = (bx - ax) * ia, dw1y = (cx - bx) * ia, dw2y = (ax - cx) * ia;
    const kAx = dw1 * iwA, kBx = dw2 * iwB, kCx = dw0 * iwC;     // weights: A=w1, B=w2, C=w0
    const kAy = dw1y * iwA, kBy = dw2y * iwB, kCy = dw0y * iwC;
    const dDx = kAx + kBx + kCx, dDy = kAy + kBy + kCy;
    const dNux = kAx * Au + kBx * Bu + kCx * Cu, dNvy = kAy * Av + kBy * Bv + kCy * Cv;
    for (let y = minY; y <= maxY; y++) {
      const fy = y + 0.5, fx0 = minX + 0.5;
      let w0 = ((bx - ax) * (fy - ay) - (by - ay) * (fx0 - ax)) * ia;
      let w1 = ((cx - bx) * (fy - by) - (cy - by) * (fx0 - bx)) * ia;
      let w2 = ((ax - cx) * (fy - cy) - (ay - cy) * (fx0 - cx)) * ia;
      let row = y * W;
      for (let x = minX; x <= maxX; x++, w0 += dw0, w1 += dw1, w2 += dw2) {
        if ((w0 < 0 || w1 < 0 || w2 < 0) && (w0 > 0 || w1 > 0 || w2 > 0)) continue;
        const z = w1 * az + w2 * bz + w0 * cz, idx = row + x;
        if (z >= zb[idx]) continue;
        zb[idx] = z;
        const pA = w1 * iwA, pB = w2 * iwB, pC = w0 * iwC, inv = 1 / (pA + pB + pC);
        const u = (pA * Au + pB * Bu + pC * Cu) * inv, v = (pA * Av + pB * Bv + pC * Cv) * inv;
        const foot = Math.max(Math.abs((dNux - u * dDx) * inv), Math.abs((dNvy - v * dDy) * inv));
        let tx = ((u - Math.floor(u)) * tw) | 0; if (tx >= tw) tx = tw - 1;
        let ty = ((v - Math.floor(v)) * th) | 0; if (ty >= th) ty = th - 1;
        let m = td[(ty * tw + tx) * 4];
        if (foot > 0.3) { const ft = foot >= 1 ? 1 : (foot - 0.3) / 0.7; m += (aR - m) * ft; }
        m /= 255;
        const o = idx * 3; out[o] = r255 * m; out[o + 1] = g255 * m; out[o + 2] = b255 * m;
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
