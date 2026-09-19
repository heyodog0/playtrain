// raster-wasm.mjs — JS glue for the Rust→WASM rasterizer (crates/rasterizer, built to
// rasterizer.wasm). Exposes a node-canvas-compatible createCanvas so it drops into the shim
// exactly like the pure-JS raster.mjs. All interop is scalar numeric; pixels live in WASM
// linear memory and are copied out only at readback. Enable with PLAYTRAIN_RASTERIZER=wasm.
//
// ISOMORPHIC: `makeWasmBackend(exports)` builds the canvas factory from an already
// instantiated module, so the browser bundle (tools/play-templates.mjs) can inline the
// wasm bytes and instantiate asynchronously; the Node-only block below self-initialises
// from the file next to this module and is stripped by the bundler.
//
// 3D (p5 WEBGL mode): the same module carries the rs_3d_* pipeline
// (crates/rasterizer/src/three.rs); Context2D exposes it as *3d methods the shim
// forwards to. The pure-JS raster.mjs has NO 3D path, so a WEBGL game needs this backend.

export function makeWasmBackend(ex) {
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
      // Last arrays staged into wasm memory, by identity; see _stage.
      this._atlasStaged = null;
      this._noiseStaged = null;
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
    // Writes through the canvas's pixel pointer rather than calling a wasm
    // import: rs_pixels_ptr + mem() already exposes the buffer (see
    // getImageData), so no data has to be marshalled twice. Re-read mem()
    // each time — the view detaches if wasm memory grows.
    loadRGBA(bytes) {
      const ptr = ex.rs_pixels_ptr(this._h), len = ex.rs_buf_len(this._h);
      const dst = new Uint8ClampedArray(mem(), ptr, len);
      const n = Math.min(bytes.length, len);
      for (let i = 0; i < n; i++) dst[i] = bytes[i];
      return n;
    }
    getImageData() {
      const ptr = ex.rs_pixels_ptr(this._h), len = ex.rs_buf_len(this._h);
      return { data: new Uint8ClampedArray(mem(), ptr, len).slice(), width: this.canvasW, height: this.canvasH };
    }

    // ---- first-person voxel raycast (crates/rasterizer/src/voxel.rs) ----
    // The grid, atlas and noise texture have to be IN linear memory before the
    // call: JS cannot make a pointer into it, so the rasterizer hands out
    // staging buffers and we write through them, exactly as loadRGBA writes
    // through rs_pixels_ptr. Re-fetch mem() after anything that can grow the
    // heap, and take the pointer last, once nothing more will resize.
    //
    // The ATLAS and the NOISE texture are uploaded once, not every call. A
    // game builds each at setup and then passes the same array for the rest of
    // the run, so re-copying them per call is pure waste — and it is a lot of
    // waste: the first-person game's atlas is 24 KB and it issues one view
    // call plus up to eleven sprite calls a frame, so the naive version moved
    // ~300 KB per frame and made the wasm backend no faster than doing the
    // whole render in JS. Identity is the right test here: these are long-lived
    // arrays, and a game that mutates one in place would have to hand over a
    // new array for any backend to see it (the native hosts read the caller's
    // memory directly, so they never copy at all).
    //
    // The GRID is copied every call, because its contents genuinely change
    // every frame. It is 8 KB.
    _stage(which, arr, ViewType) {
      const bytes = arr.length * ViewType.BYTES_PER_ELEMENT;
      const fn = which === 'atlas' ? ex.rs_voxel_atlas_ptr : ex.rs_voxel_noise_ptr;
      const cache = which === 'atlas' ? '_atlasStaged' : '_noiseStaged';
      fn(which === 'atlas' ? bytes : arr.length);
      const p = fn(which === 'atlas' ? bytes : arr.length);
      if (this[cache] !== arr) {
        new ViewType(mem(), p, arr.length).set(arr);
        this[cache] = arr;
      }
      return p;
    }

    voxelView(grid, gw, gh, ex_, ey, ez, yawQ, viewDist, atlas, tilePx, nTiles, skyRgb, dx, dy, dw, dh) {
      const ap = this._stage('atlas', atlas, Uint8Array);
      ex.rs_voxel_grid_ptr(grid.length);
      const gp = ex.rs_voxel_grid_ptr(grid.length);
      new Uint16Array(mem(), gp, grid.length).set(grid);
      // An integer yawQ is a quarter turn and goes to the exact entry point
      // whose goldens are pinned; a fractional one is a free yaw in
      // quarter-turn units, used only by the smooth-camera display path.
      if (Number.isInteger(yawQ)) {
        ex.rs_voxel_view(this._h, gp, gw, gh, ex_, ey, ez, yawQ, viewDist,
          ap, tilePx, nTiles, skyRgb, dx, dy, dw, dh);
      } else {
        ex.rs_voxel_view_free(this._h, gp, gw, gh, ex_, ey, ez, yawQ * (Math.PI / 2), viewDist,
          ap, tilePx, nTiles, skyRgb, dx, dy, dw, dh);
      }
    }

    // ---- tile-grid blit (crates/rasterizer/src/tiles.rs) ----
    // kinds change every frame and are copied each call; the atlas is uploaded
    // once by identity, like the voxel atlas.
    drawTiles(kinds, gw, gh, atlas, tilePx, nTiles, dx, dy, dw, dh) {
      const abytes = atlas.length;
      ex.rs_tiles_atlas_ptr(abytes);
      const ap = ex.rs_tiles_atlas_ptr(abytes);
      if (this._tilesAtlasStaged !== atlas) { new Uint8Array(mem(), ap, abytes).set(atlas); this._tilesAtlasStaged = atlas; }
      ex.rs_tiles_kinds_ptr(kinds.length);
      const kp = ex.rs_tiles_kinds_ptr(kinds.length);
      new Uint16Array(mem(), kp, kinds.length).set(kinds);
      ex.rs_draw_tiles(this._h, kp, gw, gh, ap, tilePx, nTiles, dx, dy, dw, dh);
    }

    voxelSprite(ex_, ey, ez, yawQ, viewDist, sx, sz, atlas, tilePx, nTiles, tile, dx, dy, dw, dh) {
      const ap = this._stage('atlas', atlas, Uint8Array);
      if (Number.isInteger(yawQ)) {
        ex.rs_voxel_sprite(this._h, ex_, ey, ez, yawQ, viewDist, sx, sz,
          ap, tilePx, nTiles, tile, dx, dy, dw, dh);
      } else {
        ex.rs_voxel_sprite_free(this._h, ex_, ey, ez, yawQ * (Math.PI / 2), viewDist, sx, sz,
          ap, tilePx, nTiles, tile, dx, dy, dw, dh);
      }
    }

    voxelDusk(x, y, w, h, daylight, key0, key1, useStatic, noise, sleeping) {
      const np = this._stage('noise', noise, Float32Array);
      ex.rs_dusk(this._h, x, y, w, h, daylight, key0, key1, useStatic, np, sleeping);
    }

    // ---- 3D (p5 WEBGL mode). Mirrors native/runtime/p5.cpp call for call. ----
    begin3d(lw, lh) { ex.rs_3d_begin(this._h, lw, lh); ex.rs_3d_frame_begin(); }
    frame3dBegin() { ex.rs_3d_frame_begin(); }
    frame3dEnd() { ex.rs_3d_frame_end(); }
    clearDepth3d() { ex.rs_3d_clear_depth(); }
    push3d() { ex.rs_3d_push(); }
    pop3d() { ex.rs_3d_pop(); }
    translate3d(x, y, z) { ex.rs_3d_translate(x, y, z); }
    rotateX3d(a) { ex.rs_3d_rotate_x(a); }
    rotateY3d(a) { ex.rs_3d_rotate_y(a); }
    rotateZ3d(a) { ex.rs_3d_rotate_z(a); }
    fill3d(r, g, b) { ex.rs_3d_fill(r, g, b); }
    ambientMaterial3d(r, g, b) { ex.rs_3d_ambient_material(r, g, b); }
    specularMaterial3d(r, g, b) { ex.rs_3d_specular_material(r, g, b); }
    shininess3d(s) { ex.rs_3d_shininess(s); }
    ambientLight3d(r, g, b) { ex.rs_3d_ambient_light(r, g, b); }
    directionalLight3d(r, g, b, x, y, z) { ex.rs_3d_directional_light(r, g, b, x, y, z); }
    pointLight3d(r, g, b, x, y, z) { ex.rs_3d_point_light(r, g, b, x, y, z); }
    box3d(w, h, d) { ex.rs_3d_box(w, h, d); }
    sphere3d(r) { ex.rs_3d_sphere(r); }
    ellipsoid3d(rx, ry, rz) { ex.rs_3d_ellipsoid(rx, ry, rz); }
    cylinder3d(r, h) { ex.rs_3d_cylinder(r, h); }
    cone3d(r, h) { ex.rs_3d_cone(r, h); }
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
      // copy out (stable buffer). Buffer in Node; a plain Uint8Array in the browser.
      const view = new Uint8Array(mem(), ptr, len);
      return typeof Buffer !== 'undefined' ? Buffer.from(view) : view.slice();
    }
  }

  return { createCanvas(lw, lh, dw, dh) { return new Canvas(lw, lh, dw, dh); }, supports3d: true };
}

// @node-only-begin
// Instantiate at import, but NEVER throw here — the shim statically imports this module even
// when another backend is selected, so a missing/broken wasm must not break cairo/js. On
// failure, wasmAvailable=false and the shim falls back to the pure-JS rasterizer.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

let _backend = null, _initErr = null;
try {
  const _wasmPath = join(dirname(fileURLToPath(import.meta.url)), 'rasterizer.wasm');
  const ex = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(_wasmPath)), {}).exports;
  _backend = makeWasmBackend(ex);
} catch (e) {
  _initErr = e;
}
export const wasmAvailable = _backend !== null;
export function createCanvas(lw, lh, dw, dh) {
  if (!_backend) throw new Error('wasm rasterizer unavailable: ' + _initErr);
  return _backend.createCanvas(lw, lh, dw, dh);
}
// @node-only-end
