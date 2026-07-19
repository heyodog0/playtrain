// raster-wasm.mjs — JS glue for the Rust→WASM rasterizer (crates/rasterizer, built to
// rasterizer.wasm). Exposes a node-canvas-compatible createCanvas so it drops into the shim
// exactly like the pure-JS raster.mjs. All interop is scalar numeric; pixels live in WASM
// linear memory and are copied out only at readback. Enable with NODE_GYM_RASTERIZER=wasm.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Instantiate at import, but NEVER throw here — the shim statically imports this module even
// when another backend is selected, so a missing/broken wasm must not break cairo/js. On
// failure, wasmAvailable=false and the shim falls back to the pure-JS rasterizer.
let ex = null, _initErr = null;
try {
  const _wasmPath = join(dirname(fileURLToPath(import.meta.url)), 'rasterizer.wasm');
  ex = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(_wasmPath)), {}).exports;
} catch (e) {
  _initErr = e;
}
export const wasmAvailable = ex !== null;
const mem = () => ex.memory.buffer; // re-fetch: buffer object changes if memory grows

function parseColor(s) {
  if (typeof s !== 'string') return [0, 0, 0, 255];
  let m = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/);
  if (m) {
    return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3]),
      m[4] === undefined ? 255 : Math.round(Math.max(0, Math.min(1, +m[4])) * 255)];
  }
  if (s[0] === '#') {
    let h = s.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
  }
  return s === 'white' ? [255, 255, 255, 255] : [0, 0, 0, 255];
}

class Context2D {
  constructor(h) {
    this._h = h;
    this._fill = null;
    this._stroke = null;
  }
  // style setters (shim assigns rgba strings; cache-gated upstream so reparse is rare)
  set fillStyle(v) { const c = parseColor(v); ex.rs_set_fill(this._h, c[0], c[1], c[2], c[3]); }
  set strokeStyle(v) { const c = parseColor(v); ex.rs_set_stroke(this._h, c[0], c[1], c[2], c[3]); }
  set lineWidth(w) { ex.rs_set_line_width(this._h, w); }
  set font(_) {}
  set textAlign(_) {}
  set imageSmoothingEnabled(_) {}

  save() { ex.rs_save(this._h); }
  restore() { ex.rs_restore(this._h); }
  resetTransform() { ex.rs_reset_transform(this._h); }
  translate(x, y) { ex.rs_translate(this._h, x, y); }
  rotate(a) { ex.rs_rotate(this._h, a); }
  scale(sx, sy) { ex.rs_scale(this._h, sx, sy === undefined ? sx : sy); }

  beginPath() { ex.rs_begin_path(this._h); }
  moveTo(x, y) { ex.rs_move_to(this._h, x, y); }
  lineTo(x, y) { ex.rs_line_to(this._h, x, y); }
  closePath() { ex.rs_close_path(this._h); }
  rect(x, y, w, h) { ex.rs_rect_path(this._h, x, y, w, h); }
  roundRect(x, y, w, h, r) { ex.rs_round_rect_path(this._h, x, y, w, h, Array.isArray(r) ? r[0] : r); }
  ellipse(cx, cy, rx, ry, _rot, a0, a1) { ex.rs_ellipse_path(this._h, cx, cy, rx, ry, a0, a1); }
  arc(cx, cy, r, a0, a1) { ex.rs_ellipse_path(this._h, cx, cy, r, r, a0, a1); }
  fill() { ex.rs_fill(this._h); }
  stroke() { ex.rs_stroke(this._h); }
  fillRect(x, y, w, h) { ex.rs_fill_rect(this._h, x, y, w, h); }
  strokeRect(x, y, w, h) { ex.rs_begin_path(this._h); ex.rs_rect_path(this._h, x, y, w, h); ex.rs_stroke(this._h); }
  fillText() {}

  drawImage(src, dx, dy, dw, dh) { ex.rs_draw_image(this._h, src._h, dx, dy, dw, dh); }
  getImageData() {
    const ptr = ex.rs_pixels_ptr(this._h), len = ex.rs_buf_len(this._h);
    return { data: new Uint8ClampedArray(mem(), ptr, len).slice(), width: this.canvasW, height: this.canvasH };
  }
}

class Canvas {
  constructor(lw, lh, dw, dh) {
    dw = dw || lw; dh = dh || lh;
    this.width = dw;
    this.height = dh;
    this._h = ex.rs_new_canvas(lw, lh, dw, dh);
    this._ctx = null;
  }
  getContext() {
    if (!this._ctx) { this._ctx = new Context2D(this._h); this._ctx.canvasW = this.width; this._ctx.canvasH = this.height; }
    return this._ctx;
  }
  toBuffer() {
    ex.rs_to_bgra(this._h);
    const ptr = ex.rs_bgra_ptr(this._h), len = ex.rs_buf_len(this._h);
    return Buffer.from(new Uint8Array(mem(), ptr, len)); // copy out (stable Buffer)
  }
}

export function createCanvas(lw, lh, dw, dh) {
  if (!ex) throw new Error('wasm rasterizer unavailable: ' + _initErr);
  return new Canvas(lw, lh, dw, dh);
}
