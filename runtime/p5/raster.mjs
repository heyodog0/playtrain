// raster.mjs — a tiny pure-JS 2D rasterizer, drop-in for the subset of node-canvas
// that p5-shim.mjs uses. Zero native deps (no Cairo), deterministic across platforms.
//
// WHY: profiling the floor games (miner/chaser and similar) showed 57-73% of
// every frame is rasterization through node-canvas/Cairo — dominated by rect/ellipse/line.
// The shim enumerates only ~10 primitives, so Cairo's general path machinery is overkill.
// This owns exactly that surface. Enable with PLAYTRAIN_RASTERIZER=js.
//
// v1 goal: CORRECT drop-in at the game's canvas resolution, with a fast axis-aligned rect
// path (rect is 25-43% of floor-game frames). Rendering directly at obs resolution (the
// bigger win) is increment 2 — same code, different base transform.

const _named = { black: [0, 0, 0, 255], white: [255, 255, 255, 255] };

// Shared sin/cos for the rasterizer's OWN geometry (ellipse flattening, rotate, roundRect).
// V8's Math.sin/cos (fdlibm) and Rust's f64::sin/cos (libm) differ by ~1 ULP, which can flip
// an edge pixel — so both backends use THIS identical polynomial instead, guaranteeing bitwise
// wasm==js regardless of angle. Accuracy (Taylor-9) far exceeds the ~10-gon ellipse it feeds.
// NOTE: this is NOT the game-facing cos()/sin() (those stay real Math.* for game-logic fidelity).
const _2PI = 6.283185307179586, _PI = 3.141592653589793, _PIH = 1.5707963267948966;
function _rsin(x) {
  x = x - _2PI * Math.floor((x + _PI) / _2PI); // reduce to [-PI, PI)
  const x2 = x * x;
  return x * (1.0 + x2 * (-0.16666666666666666 + x2 * (0.008333333333333333
    + x2 * (-0.0001984126984126984 + x2 * 0.0000027557319223985893))));
}
function _rcos(x) { return _rsin(x + _PIH); }

function parseColor(s) {
  if (Array.isArray(s)) return s;
  if (typeof s !== 'string') return [0, 0, 0, 255];
  let m = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/);
  if (m) {
    return [
      Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3]),
      m[4] === undefined ? 255 : Math.round(Math.max(0, Math.min(1, +m[4])) * 255),
    ];
  }
  if (s[0] === '#') {
    let h = s.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
  }
  return _named[s] || [0, 0, 0, 255];
}

class Context2D {
  // No 3D pipeline here: p5 WEBGL mode lives in the Rust rasterizer (wasm). The shim
  // routes WEBGL canvases to the wasm backend and throws before reaching this.
  begin3d() { throw new Error('raster.mjs (pure-JS backend) has no p5 WEBGL pipeline; use the wasm rasterizer'); }
  constructor(canvas) {
    this.canvas = canvas;
    this.w = canvas.width;   // device resolution (may be < logical, e.g. 64 vs 400)
    this.h = canvas.height;
    this.px = canvas._px; // Uint8ClampedArray RGBA straight-alpha
    // affine transform [a b c d e f]: device = (a*x+c*y+e, b*x+d*y+f).
    // Base transform bakes the logical->device scale so the game draws in its own
    // coordinate space (e.g. 400) but we rasterize directly at obs resolution (e.g. 64).
    this._base = [canvas._sx, 0, 0, canvas._sy, 0, 0];
    this._t = this._base.slice();
    this._stack = [];
    this.fillStyle = 'rgba(0,0,0,1)';
    this.strokeStyle = 'rgba(0,0,0,1)';
    this.lineWidth = 1;
    this.imageSmoothingEnabled = true; // honored as nearest either way
    this.font = '12px sans-serif';
    this.textAlign = 'left';
    this._sub = [];   // current path: array of subpaths; subpath = {pts:[[x,y]...], closed}
    this._cur = null;
  }

  save() {
    this._stack.push([this._t.slice(), this.fillStyle, this.strokeStyle, this.lineWidth]);
  }
  restore() {
    const s = this._stack.pop();
    if (s) { this._t = s[0]; this.fillStyle = s[1]; this.strokeStyle = s[2]; this.lineWidth = s[3]; }
  }
  resetTransform() { this._t = this._base.slice(); } // back to logical->device base, not identity
  translate(x, y) {
    const t = this._t; t[4] += t[0] * x + t[2] * y; t[5] += t[1] * x + t[3] * y;
  }
  scale(sx, sy) {
    const t = this._t; t[0] *= sx; t[1] *= sx; t[2] *= sy; t[3] *= sy;
  }
  rotate(a) {
    const t = this._t, c = _rcos(a), s = _rsin(a);
    const a0 = t[0], b0 = t[1], c0 = t[2], d0 = t[3];
    t[0] = a0 * c + c0 * s; t[1] = b0 * c + d0 * s;
    t[2] = -a0 * s + c0 * c; t[3] = -b0 * s + d0 * c;
  }
  _xf(x, y) {
    const t = this._t;
    return [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]];
  }

  // ---- path building (points stored in DEVICE space) ----
  beginPath() { this._sub = []; this._cur = null; }
  moveTo(x, y) { this._cur = { pts: [this._xf(x, y)], closed: false }; this._sub.push(this._cur); }
  lineTo(x, y) { if (!this._cur) this.moveTo(x, y); else this._cur.pts.push(this._xf(x, y)); }
  closePath() { if (this._cur) this._cur.closed = true; }
  rect(x, y, w, h) {
    this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h);
    this.closePath();
  }
  roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    const k = 6; // segments per corner
    const pts = [];
    const corner = (cx, cy, a0) => {
      for (let i = 0; i <= k; i++) {
        const a = a0 + (Math.PI / 2) * (i / k);
        pts.push([cx + _rcos(a) * r, cy + _rsin(a) * r]);
      }
    };
    corner(x + w - r, y + r, -Math.PI / 2);
    corner(x + w - r, y + h - r, 0);
    corner(x + r, y + h - r, Math.PI / 2);
    corner(x + r, y + r, Math.PI);
    this.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) this.lineTo(pts[i][0], pts[i][1]);
    this.closePath();
  }
  ellipse(cx, cy, rx, ry, rot, a0, a1) {
    const span = (a1 === undefined) ? Math.PI * 2 : (a1 - a0);
    const start = (a0 === undefined) ? 0 : a0;
    const n = Math.max(10, Math.ceil(Math.max(rx, ry) * 0.8));
    for (let i = 0; i <= n; i++) {
      const a = start + span * (i / n);
      const ex = cx + _rcos(a) * rx, ey = cy + _rsin(a) * ry; // rot=0 in shim
      if (i === 0) this.moveTo(ex, ey); else this.lineTo(ex, ey);
    }
    this.closePath();
  }
  arc(cx, cy, r, a0, a1) { this.ellipse(cx, cy, r, r, 0, a0, a1); }

  // ---- fills ----
  _fillSubpaths(subs, rgba) {
    // scanline, nonzero winding, sample at row center y+0.5
    let minY = Infinity, maxY = -Infinity;
    for (const sp of subs) for (const p of sp.pts) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
    let y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(this.h - 1, Math.ceil(maxY));
    const W = this.w, px = this.px;
    const [r, g, b, a] = rgba;
    for (let y = y0; y <= y1; y++) {
      const sy = y + 0.5;
      const xs = []; // {x, dir}
      for (const sp of subs) {
        const pts = sp.pts, n = pts.length;
        for (let i = 0; i < n; i++) {
          const A = pts[i], B = pts[(i + 1) % n];
          const ay = A[1], by = B[1];
          if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) {
            const x = A[0] + (sy - ay) / (by - ay) * (B[0] - A[0]);
            xs.push({ x, dir: by > ay ? 1 : -1 });
          }
        }
      }
      if (xs.length < 2) continue;
      xs.sort((u, v) => u.x - v.x);
      let wind = 0;
      for (let i = 0; i < xs.length - 1; i++) {
        wind += xs[i].dir;
        if (wind !== 0) this._span(y, xs[i].x, xs[i + 1].x, r, g, b, a);
      }
    }
  }
  _span(y, xa, xb, r, g, b, a) {
    const W = this.w, px = this.px;
    let x0 = Math.max(0, Math.round(xa)), x1 = Math.min(W, Math.round(xb));
    let o = (y * W + x0) * 4;
    if (a >= 255) {
      for (let x = x0; x < x1; x++, o += 4) { px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255; }
    } else if (a > 0) {
      const ia = a / 255, na = 1 - ia;
      for (let x = x0; x < x1; x++, o += 4) {
        px[o] = r * ia + px[o] * na; px[o + 1] = g * ia + px[o + 1] * na;
        px[o + 2] = b * ia + px[o + 2] * na; px[o + 3] = 255;
      }
    }
  }
  fill() { this._fillSubpaths(this._sub, parseColor(this.fillStyle)); }

  fillRect(x, y, w, h) {
    const t = this._t, rgba = parseColor(this.fillStyle);
    if (t[1] === 0 && t[2] === 0) { // axis-aligned fast path (no rotation/shear) — the hot path
      let x0 = t[0] * x + t[4], y0 = t[3] * y + t[5];
      let x1 = t[0] * (x + w) + t[4], y1 = t[3] * (y + h) + t[5];
      if (x1 < x0) { const s = x0; x0 = x1; x1 = s; }
      if (y1 < y0) { const s = y0; y0 = y1; y1 = s; }
      const iy0 = Math.max(0, Math.round(y0)), iy1 = Math.min(this.h, Math.round(y1));
      const [r, g, b, a] = rgba;
      for (let yy = iy0; yy < iy1; yy++) this._span(yy, x0, x1, r, g, b, a);
    } else {
      const sub = [{ pts: [this._xf(x, y), this._xf(x + w, y), this._xf(x + w, y + h), this._xf(x, y + h)], closed: true }];
      this._fillSubpaths(sub, rgba);
    }
  }

  // ---- strokes (square-brush along segments; v1 keeps it simple) ----
  _line(ax, ay, bx, by, rgba, lw) {
    const W = this.w, H = this.h, px = this.px, [r, g, b, a] = rgba;
    const dx = bx - ax, dy = by - ay, len = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
    const rad = Math.max(0, (lw - 1) / 2) | 0;
    for (let i = 0; i <= len; i++) {
      const cx = Math.round(ax + dx * i / len), cy = Math.round(ay + dy * i / len);
      for (let oy = -rad; oy <= rad; oy++) for (let ox = -rad; ox <= rad; ox++) {
        const X = cx + ox, Y = cy + oy;
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const o = (Y * W + X) * 4;
        if (a >= 255) { px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255; }
        else { const ia = a / 255, na = 1 - ia; px[o] = r * ia + px[o] * na; px[o + 1] = g * ia + px[o + 1] * na; px[o + 2] = b * ia + px[o + 2] * na; px[o + 3] = 255; }
      }
    }
  }
  stroke() {
    const rgba = parseColor(this.strokeStyle), lw = Math.max(1, Math.round(this.lineWidth));
    for (const sp of this._sub) {
      const pts = sp.pts, n = pts.length, last = sp.closed ? n : n - 1;
      for (let i = 0; i < last; i++) { const A = pts[i], B = pts[(i + 1) % n]; this._line(A[0], A[1], B[0], B[1], rgba, lw); }
    }
  }
  strokeRect(x, y, w, h) {
    this.beginPath(); this.rect(x, y, w, h); this.stroke();
  }

  // ---- text (template-banned; no-op to avoid crashes) ----
  fillText() {}

  // ---- image / readback ----
  // Load raw RGBA straight-alpha bytes into this canvas. The JS mirror of
  // rs_load_rgba; see crates/rasterizer/src/lib.rs. A blit of the result goes
  // through drawImage below, which is integer nearest-neighbour, so native,
  // wasm and this backend stay bit-identical.
  loadRGBA(bytes) {
    const px = this.px;
    const n = Math.min(bytes.length, px.length);
    for (let i = 0; i < n; i++) px[i] = bytes[i];
    return n;
  }

  drawImage(src, dx, dy, dw, dh) {
    // nearest-neighbor blit/downsample of another raster Canvas into this one
    const sw = src.width, sh = src.height, spx = src._px, W = this.w, px = this.px;
    for (let y = 0; y < dh; y++) {
      const syy = Math.min(sh - 1, (y * sh / dh) | 0);
      for (let x = 0; x < dw; x++) {
        const sxx = Math.min(sw - 1, (x * sw / dw) | 0);
        const so = (syy * sw + sxx) * 4, doff = ((dy + y) * W + (dx + x)) * 4;
        px[doff] = spx[so]; px[doff + 1] = spx[so + 1]; px[doff + 2] = spx[so + 2]; px[doff + 3] = spx[so + 3];
      }
    }
  }
  getImageData(x, y, w, h) {
    // assumes full-surface reads (the only use in the shim)
    return { data: this.px, width: this.w, height: this.h };
  }

  // ---- first-person voxel raycast ----------------------------------------
  // A LINE-FOR-LINE port of rs_voxel_view (crates/rasterizer/src/voxel.rs),
  // which is the spec. This is the browser fallback for a machine without the
  // wasm backend, and the only per-pixel JS loop FIRST_PERSON_PLAN.md allows —
  // it exists to be bit-identical, not to be fast.
  //
  // Every float op is wrapped in Math.fround, in the SAME association order as
  // the Rust, because that is what makes f64 JS arithmetic reproduce f32. A
  // missing fround here is not a rounding difference, it is a different image,
  // and tests/test_voxel.py compares the two hash for hash.
  voxelView(grid, gw, gh, eyeX, eyeY, eyeZ, yawQ, viewDist, atlas, tilePx, nTiles, skyRgb, dstX, dstY, dstW, dstH) {
    if (!grid || !atlas) return;
    if (gw === 0 || gh === 0 || dstW === 0 || dstH === 0 || tilePx === 0 || nTiles === 0) return;
    const F = Math.fround;
    const cw = this.w, ch = this.h, px = this.px;
    if (cw === 0 || ch === 0) return;
    if (!this.depth || this.depth.length !== cw * ch) this.depth = new Float32Array(cw * ch).fill(Infinity);

    // f32 images of every scalar that crosses the boundary: the Rust takes
    // these as f32 parameters, so the conversion happens before any arithmetic.
    const ex = F(eyeX), ey = F(eyeY), ez = F(eyeZ), vd = F(viewDist);
    const BIG = F(1.0e30);
    const skyR = (skyRgb >>> 16) & 255, skyG = (skyRgb >>> 8) & 255, skyB = skyRgb & 255;
    const tpx = F(tilePx), tmax = tilePx - 1;
    const tstride = tilePx * tilePx * 4;
    const fw = F(dstW), fh = F(dstH);
    const q = yawQ & 3;

    // floor() as the Rust does it: truncate, then correct the negative case.
    const ffloor = (x) => { const t = x | 0; return F(t) > x ? t - 1 : t; };

    for (let py = 0; py < dstH; py++) {
      const cyp = dstY + py;
      if (cyp >= ch) continue;
      const sy = F(1 - F(2 * F(F(py + 0.5) / fh)));

      for (let pxi = 0; pxi < dstW; pxi++) {
        const cxp = dstX + pxi;
        if (cxp >= cw) continue;
        const sx = F(F(2 * F(F(pxi + 0.5) / fw)) - 1);

        let rdx, rdz;
        if (q === 0) { rdx = sx; rdz = -1; }
        else if (q === 1) { rdx = 1; rdz = sx; }
        else if (q === 2) { rdx = F(-sx); rdz = 1; }
        else { rdx = -1; rdz = F(-sx); }
        const rdy = sy;

        const len = F(Math.sqrt(F(F(F(rdx * rdx) + F(rdy * rdy)) + F(rdz * rdz))));
        const dx = F(rdx / len), dy = F(rdy / len), dz = F(rdz / len);

        let mx = ffloor(ex), mz = ffloor(ez);
        const adx = dx < 0 ? F(-dx) : dx;
        const adz = dz < 0 ? F(-dz) : dz;
        const ddx = adx > 0 ? F(1 / adx) : BIG;
        const ddz = adz > 0 ? F(1 / adz) : BIG;
        const stepx = dx > 0 ? 1 : -1;
        const stepz = dz > 0 ? 1 : -1;
        let sidex = adx > 0
          ? (dx > 0 ? F(F(F(mx + 1) - ex) * ddx) : F(F(ex - F(mx)) * ddx))
          : BIG;
        let sidez = adz > 0
          ? (dz > 0 ? F(F(F(mz + 1) - ez) * ddz) : F(F(ez - F(mz)) * ddz))
          : BIG;

        let tIn = 0, tOut = BIG, tFloor = BIG, tTop = BIG;
        if (dy < 0) {
          const t0 = F(F(0 - ey) / dy);
          const t1 = F(F(1 - ey) / dy);
          if (t1 > 0) { tIn = t1; tTop = t1; }
          if (t0 > 0) { tOut = t0; tFloor = t0; } else { tOut = 0; }
        } else if (dy > 0) {
          const t0 = F(F(0 - ey) / dy);
          const t1 = F(F(1 - ey) / dy);
          if (t0 > 0) tIn = t0;
          if (t1 > 0) tOut = t1; else tOut = 0;
        } else if (ey < 0 || ey >= 1) {
          tOut = 0;
        }

        let hit = 0, tHit = 0, tile = 0, tEnter = 0, axisX = true, first = true;
        for (;;) {
          if (mx < 0 || mz < 0 || mx >= gw || mz >= gh) break;
          if (tEnter > vd) break;
          const cell = grid[mz * gw + mx];
          const solid = (cell & 1) !== 0;
          const ctile = cell >>> 1;
          const tExit = sidex < sidez ? sidex : sidez;

          if (!first && solid && tEnter >= tIn && tEnter < tOut) {
            hit = axisX ? 1 : 2; tHit = tEnter; tile = ctile; break;
          }
          if (solid && tTop >= tEnter && tTop < tExit) { hit = 3; tHit = tTop; tile = ctile; break; }
          if (tFloor >= tEnter && tFloor < tExit) { hit = 4; tHit = tFloor; tile = ctile; break; }

          if (sidex < sidez) { tEnter = sidex; sidex = F(sidex + ddx); mx += stepx; axisX = true; }
          else { tEnter = sidez; sidez = F(sidez + ddz); mz += stepz; axisX = false; }
          first = false;
        }
        if (hit !== 0 && tHit > vd) hit = 0;

        let r, g, b, depth;
        if (hit === 0) {
          r = skyR; g = skyG; b = skyB; depth = Infinity;
        } else {
          const xh = F(ex + F(dx * tHit));
          const yh = F(ey + F(dy * tHit));
          const zh = F(ez + F(dz * tHit));
          let u, v;
          if (hit === 1) {
            const f = F(zh - F(ffloor(zh)));
            u = stepx > 0 ? f : F(1 - f);
            v = F(1 - F(yh - F(ffloor(yh))));
          } else if (hit === 2) {
            const f = F(xh - F(ffloor(xh)));
            u = stepz > 0 ? F(1 - f) : f;
            v = F(1 - F(yh - F(ffloor(yh))));
          } else {
            u = F(xh - F(ffloor(xh)));
            v = F(zh - F(ffloor(zh)));
          }
          const t = tile < nTiles ? tile : 0;
          let tx = F(u * tpx) | 0;
          let ty = F(v * tpx) | 0;
          if (tx < 0) tx = 0; if (tx > tmax) tx = tmax;
          if (ty < 0) ty = 0; if (ty > tmax) ty = tmax;
          const o = t * tstride + (ty * tilePx + tx) * 4;
          // Forward distance, not Euclidean — see rs_voxel_view's doc comment.
          r = atlas[o]; g = atlas[o + 1]; b = atlas[o + 2]; depth = F(tHit / len);
        }

        const i = cyp * cw + cxp;
        const o = i * 4;
        px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
        this.depth[i] = depth;
      }
    }
  }

  // A LINE-FOR-LINE port of rs_voxel_sprite. Same rule as voxelView above:
  // Math.fround after every float op, in the Rust's association order.
  voxelSprite(eyeX, eyeY, eyeZ, yawQ, viewDist, spriteX, spriteZ, atlas, tilePx, nTiles, atlasTile, dstX, dstY, dstW, dstH) {
    if (!atlas || tilePx === 0 || nTiles === 0 || dstW === 0 || dstH === 0) return;
    const F = Math.fround;
    const cw = this.w, ch = this.h, px = this.px;
    if (cw === 0 || ch === 0) return;
    if (!this.depth || this.depth.length !== cw * ch) this.depth = new Float32Array(cw * ch).fill(Infinity);

    const ex = F(eyeX), ey = F(eyeY), ez = F(eyeZ), vd = F(viewDist);
    const sxw = F(spriteX), szw = F(spriteZ);

    let fx, fz, rx, rz;
    switch (yawQ & 3) {
      case 0: fx = 0; fz = -1; rx = 1; rz = 0; break;
      case 1: fx = 1; fz = 0; rx = 0; rz = 1; break;
      case 2: fx = 0; fz = 1; rx = -1; rz = 0; break;
      default: fx = -1; fz = 0; rx = 0; rz = -1; break;
    }
    const dx = F(sxw - ex);
    const dz = F(szw - ez);
    const depth = F(F(dx * fx) + F(dz * fz));
    const lat = F(F(dx * rx) + F(dz * rz));
    if (!(depth > 0) || depth > vd) return;

    const fw = F(dstW), fh = F(dstH);
    const hw = F(fw * 0.5), hh = F(fh * 0.5);
    const x0f = F(F(F(F(lat - 0.5) / depth) + 1) * hw - 0.5);
    const x1f = F(F(F(F(lat + 0.5) / depth) + 1) * hw - 0.5);
    const y0f = F(F(F(1 - F(F(1 - ey) / depth)) * hh) - 0.5);
    const y1f = F(F(F(1 - F(F(0 - ey) / depth)) * hh) - 0.5);
    const wf = F(x1f - x0f), hf = F(y1f - y0f);
    if (!(wf > 0) || !(hf > 0)) return;

    const ffloor = (x) => { const t = x | 0; return F(t) > x ? t - 1 : t; };
    let ix0 = -ffloor(F(-x0f));
    let ix1 = ffloor(x1f);
    let iy0 = -ffloor(F(-y0f));
    let iy1 = ffloor(y1f);
    if (ix0 < 0) ix0 = 0;
    if (iy0 < 0) iy0 = 0;
    if (ix1 > dstW - 1) ix1 = dstW - 1;
    if (iy1 > dstH - 1) iy1 = dstH - 1;

    const t = atlasTile < nTiles ? atlasTile : 0;
    const tpx = F(tilePx), tmax = tilePx - 1;
    const tstride = tilePx * tilePx * 4;

    for (let py = iy0; py <= iy1; py++) {
      const cyp = dstY + py;
      if (cyp < 0 || cyp >= ch) continue;
      const v = F(F(py - y0f) / hf);
      let ty = F(v * tpx) | 0;
      if (ty < 0) ty = 0; if (ty > tmax) ty = tmax;

      for (let pxi = ix0; pxi <= ix1; pxi++) {
        const cxp = dstX + pxi;
        if (cxp < 0 || cxp >= cw) continue;
        const i = cyp * cw + cxp;
        if (depth >= this.depth[i]) continue;
        const u = F(F(pxi - x0f) / wf);
        let tx = F(u * tpx) | 0;
        if (tx < 0) tx = 0; if (tx > tmax) tx = tmax;

        const o = t * tstride + (ty * tilePx + tx) * 4;
        const sr = atlas[o], sg = atlas[o + 1], sb = atlas[o + 2], sa = atlas[o + 3];
        if (sa === 0) continue;
        const d = i * 4;
        if (sa === 255) {
          px[d] = sr; px[d + 1] = sg; px[d + 2] = sb; px[d + 3] = 255;
          this.depth[i] = depth;
        } else {
          const a = F(sa / 255);
          const ia = F(1 - a);
          px[d] = F(F(px[d] * ia) + F(sr * a)) | 0;
          px[d + 1] = F(F(px[d + 1] * ia) + F(sg * a)) | 0;
          px[d + 2] = F(F(px[d + 2] * ia) + F(sb * a)) | 0;
          px[d + 3] = 255;
        }
      }
    }
  }
}

class Canvas {
  constructor(lw, lh, dw, dh) {
    dw = dw || lw; dh = dh || lh;
    this.width = dw;            // device resolution (what we rasterize + read back)
    this.height = dh;
    this.logicalW = lw;         // coordinate space the game draws in
    this.logicalH = lh;
    this._sx = dw / lw;         // logical->device scale, baked into the context base transform
    this._sy = dh / lh;
    this._px = new Uint8ClampedArray(dw * dh * 4); // RGBA, init transparent black
    this._ctx = null;
  }
  getContext() { if (!this._ctx) this._ctx = new Context2D(this); return this._ctx; }
  // Match node-canvas toBuffer('raw'): native Cairo surface is BGRA, premultiplied, LE.
  toBuffer(fmt) {
    const px = this._px, n = this.width * this.height, out = Buffer.allocUnsafe(n * 4);
    for (let i = 0; i < n; i++) {
      const o = i * 4, a = px[o + 3];
      // premultiply (opaque -> identity), reorder RGBA -> BGRA
      if (a >= 255) { out[o] = px[o + 2]; out[o + 1] = px[o + 1]; out[o + 2] = px[o]; out[o + 3] = 255; }
      else { const m = a / 255; out[o] = (px[o + 2] * m) | 0; out[o + 1] = (px[o + 1] * m) | 0; out[o + 2] = (px[o] * m) | 0; out[o + 3] = a; }
    }
    return out;
  }
}

export function createCanvas(lw, lh, dw, dh) { return new Canvas(lw, lh, dw, dh); }
