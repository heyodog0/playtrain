// p5-shim.mjs — Minimal p5.js-compatible API on top of a pluggable 2D backend.
// ISOMORPHIC: runs in Node (training/headless) AND the browser (online playtest). Node-only
// modules (node-canvas, os, the wasm loader) are imported lazily/guarded, so the browser only
// ever pulls the pure-JS rasterizer (raster.mjs). One shim, one rasterizer, everywhere.

import { createCanvas as createJsCanvas } from './raster.mjs'; // pure JS, browser-safe

const _IS_NODE = typeof process !== 'undefined' && !!(process.versions && process.versions.node);
const _env = (k) => (_IS_NODE ? process.env[k] : undefined);

// Endianness: Node exposes os.endianness(); browsers are effectively always little-endian.
let _IS_LE = true;
if (_IS_NODE) { _IS_LE = (await import('os')).endianness() === 'LE'; }

// Backend: Node defaults to our wasm rasterizer (fast, bit-identical to js) with a js fallback;
// the browser uses the pure-JS rasterizer. node-canvas (cairo) and the wasm loader are imported
// LAZILY — so the browser never touches them, and the default Node path no longer loads
// node-canvas at all (a step toward dropping that dependency).
let _RASTERIZER = _env('PLAYTRAIN_RASTERIZER') || (_IS_NODE ? 'wasm' : 'js');
let createNodeCanvas;
// Canvas factory for p5 WEBGL mode. Only the wasm rasterizer carries the 3D pipeline
// (crates/rasterizer/src/three.rs); the pure-JS raster.mjs does not. In Node this is the
// wasm backend itself; in the browser the bundler (tools/play-templates.mjs) inlines the
// wasm for WEBGL games and hands us the instantiated exports as globalThis.__PT_WASM_EXPORTS,
// while 2D games keep the pure-JS backend exactly as before.
let createWebglCanvas = null;
if (_RASTERIZER === 'cairo') {
  createNodeCanvas = (await import('canvas')).createCanvas;
} else if (_RASTERIZER === 'wasm') {
  const m = await import('./raster-wasm.mjs');
  if (m.wasmAvailable) { createNodeCanvas = m.createCanvas; createWebglCanvas = m.createCanvas; }
  else { _RASTERIZER = 'js'; createNodeCanvas = createJsCanvas; }
} else {
  _RASTERIZER = 'js';
  createNodeCanvas = createJsCanvas;
}
if (!_IS_NODE && typeof globalThis.__PT_WASM_EXPORTS !== 'undefined' && typeof makeWasmBackend === 'function') {
  createWebglCanvas = makeWasmBackend(globalThis.__PT_WASM_EXPORTS).createCanvas;   // bundler-provided
}
const _OWN_RASTER = _RASTERIZER === 'js' || _RASTERIZER === 'wasm';

// Own rasterizer only: rasterize directly at this device resolution (e.g. 64) instead of the
// game's logical canvas size (e.g. 400), then skip the downsample — 39x fewer pixels, the bulk
// of the speedup. Precedence: explicit env override > programmatic (game-env sets it to the obs
// size via setRasterRes) > null (full logical-res render, e.g. browser / full-frame capture).
let _RASTER_RES = (_OWN_RASTER && _env('PLAYTRAIN_RASTER_RES'))
  ? parseInt(_env('PLAYTRAIN_RASTER_RES'), 10) : null;
const _RASTER_RES_FROM_ENV = _RASTER_RES !== null;
// Called by game-env BEFORE the game's setup()/createCanvas with the observation size, so the
// agent path renders directly at obs resolution by default. Env var still wins if set.
function setRasterRes(n) {
  if (_OWN_RASTER && !_RASTER_RES_FROM_ENV && Number.isFinite(n) && n > 0) _RASTER_RES = n | 0;
}

// (_IS_LE is computed above, guarded for browser. The fast obs path assumes BGRA byte order
// from toBuffer('raw'); it fails loudly on big-endian rather than corrupting channels.)

let _canvas = null;
let _ctx = null;
let _webgl = false;   // createCanvas(w, h, WEBGL): 3D calls forward to the rasterizer's rs_3d_*
let _width = 0;
let _height = 0;
let _obsCanvas = null;
let _obsCtx = null;
let _obsW = 0;
let _obsH = 0;
let _frameCount = 0;
let _fillStyle = 'rgba(255,255,255,1)';
let _strokeEnabled = true;
let _strokeStyle = 'rgba(0,0,0,1)';
let _strokeW = 1;
let _textSz = 12;
let _textAlignH = 'left';
let _textFontFamily = 'sans-serif';
let _keysDown = new Set();
let _rectMode = 'corner'; // 'corner' or 'center'
let _ellipseMode = 'center'; // 'center' or 'corner'
// p5's push()/pop() save & restore the full drawing state. _ctx.save()/restore()
// only covers Cairo's own state (transform + its fill/stroke), NOT the shim-level
// style vars above — so without this stack a stroke()/fill()/textSize() inside a
// push()/pop() leaks out to every subsequent draw. (Symptom: black outlines
// bleeding across entities in games that scope stroke() with push/pop.)
let _styleStack = [];

// Cache the last value we actually assigned to _ctx.{fillStyle,strokeStyle,
// lineWidth}. Each assignment makes Cairo re-parse the rgba string, which the
// V8 profile showed as ~30% of step time on draw-heavy games (mario, breakout)
// because many adjacent primitives share the same color. Skip the assignment
// when unchanged; invalidate on save/restore since those swap the whole state.
let _ctxFill = null;
let _ctxStroke = null;
let _ctxLineW = null;

function _applyFill() {
  if (_ctxFill !== _fillStyle) {
    _ctx.fillStyle = _fillStyle;
    _ctxFill = _fillStyle;
  }
}
function _applyStroke() {
  if (_ctxStroke !== _strokeStyle) {
    _ctx.strokeStyle = _strokeStyle;
    _ctxStroke = _strokeStyle;
  }
  if (_ctxLineW !== _strokeW) {
    _ctx.lineWidth = _strokeW;
    _ctxLineW = _strokeW;
  }
}
function _invalidateStyleCache() {
  _ctxFill = null;
  _ctxStroke = null;
  _ctxLineW = null;
}

// ---- Color helpers ----
// p5 clamps colour components into range; a game computing an alpha that runs
// past 0 (a fading particle decremented one step too far, say) must go fully
// transparent. Unclamped, the emitted string carried a minus sign, raster.mjs's
// rgba regex failed to match it, and the fallback painted OPAQUE BLACK — while
// the native backend drew nothing. That is the whole of the
// jetpack_joyride.spaceship-viz-v2 divergence in native/gate_qjs.sh.
const _c255 = (v) => {
  const n = +v;
  return n !== n ? 0 : n < 0 ? 0 : n > 255 ? 255 : n;      // NaN -> 0
};
const _a1 = (v) => {
  const n = +v / 255;
  return n !== n ? 0 : n < 0 ? 0 : n > 1 ? 1 : n;
};

function colorArgs(args) {
  // p5 accepts color arrays: fill([r,g,b]) or fill([r,g,b,a]). Unwrap.
  if (args.length === 1 && Array.isArray(args[0])) args = args[0];
  if (args.length === 1 && typeof args[0] === 'string') return args[0];
  if (args.length === 1) { const g = _c255(args[0]); return `rgba(${g},${g},${g},1)`; }
  if (args.length === 2) { const g = _c255(args[0]); return `rgba(${g},${g},${g},${_a1(args[1])})`; }
  if (args.length === 3) return `rgba(${_c255(args[0])},${_c255(args[1])},${_c255(args[2])},1)`;
  if (args.length === 4) return `rgba(${_c255(args[0])},${_c255(args[1])},${_c255(args[2])},${_a1(args[3])})`;
  return 'rgba(0,0,0,1)';
}

// ---- Canvas creation ----
function createCanvas(w, h, mode) {
  _width = w;
  _height = h;
  _webgl = (mode === WEBGL);
  let factory = createNodeCanvas;
  if (_webgl) {
    if (!createWebglCanvas) {
      throw new Error('createCanvas(WEBGL): p5 WEBGL mode needs the wasm rasterizer (PLAYTRAIN_RASTERIZER=wasm, '
        + 'or the inlined wasm in the browser bundle); the pure-JS/cairo backends have no 3D pipeline');
    }
    factory = createWebglCanvas;
  }
  _canvas = _RASTER_RES
    ? factory(w, h, _RASTER_RES, _RASTER_RES)
    : factory(w, h);
  _ctx = _canvas.getContext('2d');
  // logical -> device, for sizing offscreen layers and mapping image() blits
  _devSx = _canvas.width / w;
  _devSy = _canvas.height / h;
  if (_webgl) _ctx.begin3d(w, h);   // mirrors p5::createCanvas(w, h, WEBGL)
  return { parent() {} };
}

// Channel values the way native/runtime/p5.cpp's color() rounds them (Math.round per
// channel; gray expands to rgb; arrays unwrap). The 3D material/light calls take these,
// never the rgba string the 2D path carries.
function _rgb255(args) {
  if (args.length === 1 && Array.isArray(args[0])) args = args[0];
  if (args.length <= 2) { const v = Math.round(args[0]); return [v, v, v]; }
  return [Math.round(args[0]), Math.round(args[1]), Math.round(args[2])];
}

// ---- offscreen graphics: createGraphics + setTarget/clearTarget + image ----
// Mirrors native/runtime/p5.cpp so the Node/browser shim and the QuickJS host
// expose the SAME capability — a game that caches static content in a layer must
// not simply fail to load on the portable backend (it did: all four validate
// checks failed on a generated platformer).
//
// Layers are allocated at the MAIN canvas's DEVICE scale, not 1:1 logical. Both
// backends rasterize directly at _RASTER_RES (the obs size) rather than at the
// game's logical size, so a 1:1 logical layer would put shapes on a finer grid
// and image() would resample on blit — a cached layer would then NOT reproduce a
// direct draw. Matching the device scale keeps shape rounding identical and makes
// the blit a 1:1 copy. Round, don't truncate: 192 * (64/192) is 63.999...
let _devSx = 1;
let _devSy = 1;
const _layers = new Map();
let _nextLayerId = 1;
const _targetStack = [];

function createGraphics(w, h) {
  const dw = Math.round(w * _devSx), dh = Math.round(h * _devSy);
  const canvas = (dw !== w || dh !== h) ? createNodeCanvas(w, h, dw, dh) : createNodeCanvas(w, h);
  const id = _nextLayerId++;
  _layers.set(id, { canvas, ctx: canvas.getContext('2d'), w, h });
  return id;   // opaque handle, matching the native host's int handle
}

function setTarget(handle) {
  const L = _layers.get(handle);
  if (!L) return;
  _targetStack.push({ canvas: _canvas, ctx: _ctx, width: _width, height: _height });
  _canvas = L.canvas; _ctx = L.ctx; _width = L.w; _height = L.h;
  _invalidateStyleCache();   // style cache tracks one ctx; the target changed
}

function clearTarget() {
  const prev = _targetStack.pop();
  if (!prev) return;
  _canvas = prev.canvas; _ctx = prev.ctx; _width = prev.width; _height = prev.height;
  _invalidateStyleCache();
}

function image(handle, x, y, w, h) {
  const L = _layers.get(handle);
  if (!L) return;
  // drawImage works in DEVICE pixels on this backend, so map logical -> device.
  _ctx.drawImage(
    L.canvas,
    Math.round(x * _devSx), Math.round(y * _devSy),
    w === undefined ? L.canvas.width : Math.round(w * _devSx),
    h === undefined ? L.canvas.height : Math.round(h * _devSy),
  );
}

// ---- Drawing primitives ----
function background(...args) {
  _ctx.save();
  _ctx.resetTransform();
  _ctx.fillStyle = colorArgs(args);
  _ctx.fillRect(0, 0, _width, _height);
  _ctx.restore();
  _invalidateStyleCache(); // save/restore reset context state outside our cache
  if (_webgl) _ctx.clearDepth3d();   // p5 WEBGL background() clears the depth buffer too
}

function fill(...args) {
  _fillStyle = colorArgs(args);
  if (_webgl) { const c = _rgb255(args); _ctx.fill3d(c[0], c[1], c[2]); }
}

// ---- p5 WEBGL mode: thin forwarders (all 3D math lives in the rasterizer) ----
function rotateX(a) { if (_webgl) _ctx.rotateX3d(a); }
function rotateY(a) { if (_webgl) _ctx.rotateY3d(a); }
function rotateZ(a) { if (_webgl) _ctx.rotateZ3d(a); }
function ambientMaterial(...args) { if (_webgl) { const c = _rgb255(args); _ctx.ambientMaterial3d(c[0], c[1], c[2]); } }
function specularMaterial(...args) { if (_webgl) { const c = _rgb255(args); _ctx.specularMaterial3d(c[0], c[1], c[2]); } }
function shininess(s) { if (_webgl) _ctx.shininess3d(s); }
function ambientLight(...args) { if (_webgl) { const c = _rgb255(args); _ctx.ambientLight3d(c[0], c[1], c[2]); } }
function directionalLight(r, g, b, x, y, z) {
  if (_webgl) { const c = _rgb255([r, g, b]); _ctx.directionalLight3d(c[0], c[1], c[2], x, y, z); }
}
function pointLight(r, g, b, x, y, z) {
  if (_webgl) { const c = _rgb255([r, g, b]); _ctx.pointLight3d(c[0], c[1], c[2], x, y, z); }
}
function box(w, h, d) { if (_webgl) _ctx.box3d(w, h === undefined ? w : h, d === undefined ? w : d); }
function sphere(r) { if (_webgl) _ctx.sphere3d(r); }
function ellipsoid(rx, ry, rz) {
  if (ry === undefined) ry = rx;
  if (rz === undefined) rz = ry;
  if (_webgl) _ctx.ellipsoid3d(rx, ry, rz);
}
function cylinder(r, h) { if (_webgl) _ctx.cylinder3d(r, h); }
function cone(r, h) { if (_webgl) _ctx.cone3d(r, h); }
function noLights() {}          // not in the declared subset: accepted, no effect
function normalMaterial() {}
function emissiveMaterial() {}

// p5's noFill(): draw subsequent shapes with no fill. Implemented as a fully
// transparent fill so no draw-primitive call sites need guarding (stroke is
// separate, gated by _strokeEnabled).
function noFill() {
  _fillStyle = 'rgba(0,0,0,0)';
}

function rectMode(mode) {
  if (mode === 'center' || mode === CENTER) _rectMode = 'center';
  else _rectMode = 'corner';
}

function rect(x, y, w, h, r) {
  let dx = x, dy = y;
  if (_rectMode === 'center') { dx = x - w / 2; dy = y - h / 2; }
  _applyFill();
  if (r && r > 0) {
    _ctx.beginPath();
    _ctx.roundRect(dx, dy, w, h, r);
    _ctx.fill();
    if (_strokeEnabled) { _applyStroke(); _ctx.stroke(); }
  } else {
    _ctx.fillRect(dx, dy, w, h);
    if (_strokeEnabled) { _applyStroke(); _ctx.strokeRect(dx, dy, w, h); }
  }
}

function arc(x, y, w, h, start, stop) {
  // p5.js arc(): x,y center (per ellipseMode), w/h diameters, angles in
  // radians. Maps onto the rasterizer's angular ellipse (sector fill +
  // stroke) — the raster op has carried a0/a1 since day one; the shim just
  // never exposed it.
  if (h === undefined) h = w;
  let cx = x, cy = y;
  if (_ellipseMode === 'corner') { cx = x + w / 2; cy = y + h / 2; }
  _applyFill();
  _ctx.beginPath();
  _ctx.ellipse(cx, cy, w / 2, h / 2, 0, start, stop);
  _ctx.fill();
  if (_strokeEnabled) { _applyStroke(); _ctx.stroke(); }
}

function ellipseMode(mode) {
  if (mode === 'corner' || mode === CORNER) _ellipseMode = 'corner';
  else _ellipseMode = 'center';
}

function ellipse(x, y, w, h) {
  if (h === undefined) h = w;
  let cx = x, cy = y;
  if (_ellipseMode === 'corner') { cx = x + w / 2; cy = y + h / 2; }
  _applyFill();
  _ctx.beginPath();
  _ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
  _ctx.fill();
  if (_strokeEnabled) { _applyStroke(); _ctx.stroke(); }
}

function triangle(x1, y1, x2, y2, x3, y3) {
  _applyFill();
  _ctx.beginPath();
  _ctx.moveTo(x1, y1);
  _ctx.lineTo(x2, y2);
  _ctx.lineTo(x3, y3);
  _ctx.closePath();
  _ctx.fill();
  if (_strokeEnabled) { _applyStroke(); _ctx.stroke(); }
}

function quad(x1, y1, x2, y2, x3, y3, x4, y4) {
  _applyFill();
  _ctx.beginPath();
  _ctx.moveTo(x1, y1);
  _ctx.lineTo(x2, y2);
  _ctx.lineTo(x3, y3);
  _ctx.lineTo(x4, y4);
  _ctx.closePath();
  _ctx.fill();
  if (_strokeEnabled) { _applyStroke(); _ctx.stroke(); }
}

function circle(x, y, d) {
  ellipse(x, y, d, d);
}

function color(...args) {
  // Returns the color string for use with fill(color(...))
  return colorArgs(args);
}

function lerpColor(c1, c2, amt) {
  // p5.js lerpColor(): componentwise interpolation, amt clamped to [0,1].
  // Colors here are the rgba strings color() returns (arrays also accepted).
  const parse = (c) => {
    const s = Array.isArray(c) ? colorArgs([c]) : String(c);
    const m = s.match(/rgba?\(([^)]*)\)/);
    if (!m) return [0, 0, 0, 1];
    const v = m[1].split(',').map(Number);
    return [v[0] || 0, v[1] || 0, v[2] || 0, v.length > 3 ? v[3] : 1];
  };
  const a = parse(c1), b = parse(c2);
  const t = Math.max(0, Math.min(1, amt));
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  const al = a[3] + (b[3] - a[3]) * t;
  return `rgba(${r},${g},${bl},${al})`;
}

function noSmooth() {
  // No-op in headless mode (disables anti-aliasing in browser)
}

function line(x1, y1, x2, y2) {
  _applyStroke();
  _ctx.beginPath();
  _ctx.moveTo(x1, y1);
  _ctx.lineTo(x2, y2);
  _ctx.stroke();
}

function stroke(...args) {
  _strokeEnabled = true;
  _strokeStyle = colorArgs(args);
}

function noStroke() {
  _strokeEnabled = false;
}

function strokeWeight(w) {
  _strokeW = w;
}

// ---- Text ----
function textSize(s) {
  _textSz = s;
}

function textAlign(align) {
  if (align === 'center' || align === CENTER) _textAlignH = 'center';
  else _textAlignH = 'left';
}

function textFont(f) {
  _textFontFamily = f;
}

function text(str, x, y) {
  _applyFill();
  _ctx.font = `${_textSz}px ${_textFontFamily}`;
  _ctx.textAlign = _textAlignH;
  _ctx.fillText(String(str), x, y);
}

// ---- Transform stack ----
function push() {
  if (_webgl) _ctx.push3d(); else _ctx.save();
  _styleStack.push({
    fill: _fillStyle, strokeEnabled: _strokeEnabled, strokeStyle: _strokeStyle,
    strokeW: _strokeW, textSz: _textSz, textAlignH: _textAlignH,
    textFontFamily: _textFontFamily, rectMode: _rectMode, ellipseMode: _ellipseMode,
  });
}
function pop() {
  if (_webgl) _ctx.pop3d(); else _ctx.restore();
  const s = _styleStack.pop();
  if (s) {
    _fillStyle = s.fill; _strokeEnabled = s.strokeEnabled; _strokeStyle = s.strokeStyle;
    _strokeW = s.strokeW; _textSz = s.textSz; _textAlignH = s.textAlignH;
    _textFontFamily = s.textFontFamily; _rectMode = s.rectMode; _ellipseMode = s.ellipseMode;
  }
  _invalidateStyleCache(); // force next draw to re-apply restored fill/stroke to Cairo
}
function translate(x, y, z) { if (_webgl) _ctx.translate3d(x, y, z === undefined ? 0 : z); else _ctx.translate(x, y); }
function rotate(a) { if (_webgl) _ctx.rotateZ3d(a); else _ctx.rotate(a); }   // p5: rotate() == rotateZ() in WEBGL
function scale(sx, sy) { if (_webgl) return; if (sy === undefined) sy = sx; _ctx.scale(sx, sy); }   // scale() not in the 3D subset

// ---- Shape mode ----
let _shapeVerts = [];
function beginShape() { _shapeVerts = []; }
function vertex(x, y) { _shapeVerts.push([x, y]); }
function endShape(mode) {
  if (_shapeVerts.length < 2) return;
  _applyFill();
  _ctx.beginPath();
  _ctx.moveTo(_shapeVerts[0][0], _shapeVerts[0][1]);
  for (let i = 1; i < _shapeVerts.length; i++) _ctx.lineTo(_shapeVerts[i][0], _shapeVerts[i][1]);
  if (mode === CLOSE) _ctx.closePath();
  _ctx.fill();
  if (_strokeEnabled) { _applyStroke(); _ctx.stroke(); }
}

// ---- Math helpers ----
function map(v, s1, e1, s2, e2) { return s2 + (e2 - s2) * ((v - s1) / (e1 - s1)); }
function constrain(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }
function lerp(a, b, t) { return a + (b - a) * t; }
function dist(x1, y1, x2, y2) { return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2); }
function abs(v) { return Math.abs(v); }
function floor(v) { return Math.floor(v); }
function ceil(v) { return Math.ceil(v); }
function round(v) { return Math.round(v); }
function sqrt(v) { return Math.sqrt(v); }
function pow(b, e) { return Math.pow(b, e); }
function sin(a) { return Math.sin(a); }
function cos(a) { return Math.cos(a); }
function atan2(y, x) { return Math.atan2(y, x); }
function random(a, b) {
  if (a === undefined) return Math.random();
  if (b === undefined) return Math.random() * a;
  return a + Math.random() * (b - a);
}
function min(...args) { return Math.min(...(args.length === 1 && Array.isArray(args[0]) ? args[0] : args)); }
function max(...args) { return Math.max(...(args.length === 1 && Array.isArray(args[0]) ? args[0] : args)); }

// ---- Input ----
function keyIsDown(code) { return _keysDown.has(code); }
function setKeysDown(keys) { _keysDown = new Set(keys); }

// Pointer / gamepad state. Positions and axes arrive QUANTIZED (uint16 wire
// values, see runtime/action_spaces.json) and are dequantized here with the
// same formulas as the native hosts (action_table.hpp env_apply_frame):
// mouseX = (q/65535) * width, axis = (q/65535)*2 - 1 — identical IEEE doubles
// on every engine, which is what keeps pointer games bit-exact cross-engine.
let _qmx = 0, _qmy = 0;
let _mouseDown = false;
let _prevButtons = 0;
let _qaxes = [32768, 32768, 32768, 32768];
function setPointerPos(qx, qy) { _qmx = qx; _qmy = qy; }
function setButtons(buttons) {
  // Absolute per step; a 0->1 edge on bit0 fires the game's mousePressed()
  // once, with mouseX/mouseIsPressed already reflecting the new frame —
  // mirroring env_apply_frame's ordering in the native hosts.
  _mouseDown = (buttons & 1) !== 0;
  if ((buttons & 1) && !(_prevButtons & 1) && typeof globalThis.mousePressed === 'function') {
    globalThis.mousePressed();
  }
  _prevButtons = buttons;
}
function setAxes(qaxes) { for (let j = 0; j < 4; j++) _qaxes[j] = qaxes[j]; }
function resetPointer() {
  // Per-episode rest state, like setKeysDown([]) on env.reset.
  _qmx = 0; _qmy = 0; _mouseDown = false; _prevButtons = 0;
  _qaxes = [32768, 32768, 32768, 32768];
}
function simulateKeyPress(code) {
  // Sets keyCode global, marks the key as held for the current frame, and
  // triggers the game's keyPressed() if defined. Adding to _keysDown lets
  // games that poll via keyIsDown(code) (idiomatic p5.js for continuous
  // fire/shoot loops) see the press alongside event-driven keyPressed()
  // handlers. setKeysDown(action.held) runs at the start of the next step
  // and replaces the set, so the held-ness is exactly one frame — matching
  // the "press" semantics in game-env.mjs.
  globalThis.keyCode = code;
  _keysDown.add(code);
  if (typeof globalThis.keyPressed === 'function') globalThis.keyPressed();
}

// ---- Timing ----
function millis() { return _frameCount * (1000 / 60); }

// ---- Loop control ----
let _looping = true;
function loop() { _looping = true; }
function noLoop() { _looping = false; }
function isLooping() { return _looping; }

// ---- Pixel access ----
function getPixelData() {
  return _ctx.getImageData(0, 0, _width, _height);
}

function getCanvasBuffer() {
  return _canvas.toBuffer('raw');
}

// Cairo-side downsample + raw readback. Returns the offscreen canvas' native
// buffer (BGRA on LE, premultiplied). Skips getImageData's full-surface
// unpremul + RGBA repack, and skips the JS resample loop entirely.
function getObsBuffer(obsW, obsH) {
  if (!_IS_LE) {
    throw new Error('getObsBuffer assumes little-endian (BGRA byte order from Cairo). Set PLAYTRAIN_P5_FAST_OBS=0 on big-endian hosts.');
  }
  // js backend: when we already rasterized directly at the obs resolution, the main canvas
  // IS the obs buffer — skip the offscreen canvas + drawImage downsample entirely.
  if (_RASTER_RES === obsW && _RASTER_RES === obsH) {
    return _canvas.toBuffer('raw');
  }
  if (_obsCanvas === null || _obsW !== obsW || _obsH !== obsH) {
    _obsCanvas = createNodeCanvas(obsW, obsH);
    _obsCtx = _obsCanvas.getContext('2d');
    _obsCtx.imageSmoothingEnabled = false; // nearest-neighbor, deterministic
    _obsW = obsW;
    _obsH = obsH;
  }
  _obsCtx.drawImage(_canvas, 0, 0, obsW, obsH);
  return _obsCanvas.toBuffer('raw');
}

// ---- Tick (advance one frame) ----
function tick() {
  if (!_looping) return false;
  _frameCount++;
  if (_webgl) _ctx.frame3dBegin();   // per draw(): reset model matrix + lights (as p5 does)
  if (typeof globalThis.draw === 'function') globalThis.draw();
  if (_webgl) _ctx.frame3dEnd();
  return _looping;
}

// ---- Reset per-episode frame phase ----
// `frameCount` is monotonic across the worker's whole lifetime. Games that key
// per-episode timers off it (laser/enemy phase, blink cycles) would otherwise
// start each episode at whatever phase the previous one left off — making
// episode outcomes depend on how many frames elapsed before (i.e. eval order).
// env.reset() calls this so frameCount is episode-relative and reset(seed) is
// fully deterministic. Per-episode game counters (e.g. episodeSteps) are reset
// by the game's own resetGame(); this only zeroes the shim's global.
function resetFrameCount() { _frameCount = 0; }

// Restore p5's defaults for everything this module keeps BETWEEN frames.
//
// tools/tester.py gets this for free: it serves each game its own page, so
// switching games is a navigation and every global starts fresh. The browser
// player instead evaluates every game into ONE realm, where nothing below is
// reset by loading the next game -- a leftover fill or rectMode, or an
// unbalanced push() from a game that threw mid-draw, silently carries over and
// the next game renders with the previous one's style. Call this before a new
// game's setup().
function resetDrawState() {
  _fillStyle = 'rgba(255,255,255,1)';
  _strokeEnabled = true;
  _strokeStyle = 'rgba(0,0,0,1)';
  _strokeW = 1;
  _textSz = 12;
  _textAlignH = 'left';
  _textFontFamily = 'sans-serif';
  _rectMode = 'corner';
  _ellipseMode = 'center';
  _styleStack.length = 0;   // an unbalanced push() must not outlive its game
  _keysDown.clear();        // nor a key held down across a switch
  _frameCount = 0;
}

// ---- tint stub (used for player invulnerability flicker) ----
function tint() {} // visual-only, no gameplay impact

// ---- Constants ----
const LEFT_ARROW = 37;
const UP_ARROW = 38;
const RIGHT_ARROW = 39;
const DOWN_ARROW = 40;
const ENTER = 13;
const CENTER = 'center';
const CORNER = 'corner';
const LEFT = 'left';
const RIGHT = 'right';
const TOP = 'top';
const BOTTOM = 'bottom';
const BASELINE = 'alphabetic';
const PI = Math.PI;
const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const CLOSE = 'close';
const P2D = 1;      // createCanvas renderer selector; same numeric values as the native hosts
const WEBGL = 2;

// ---- Install globals ----
function installGlobals() {
  const globals = {
    createCanvas, createGraphics, setTarget, clearTarget, image,
    background, fill, noFill, rectMode, rect, ellipseMode, ellipse, circle, triangle, quad, line,
    stroke, noStroke, strokeWeight, noSmooth, color, lerpColor,
    textSize, textAlign, textFont, text,
    push, pop, translate, rotate, scale,
    beginShape, vertex, endShape,
    map, constrain, lerp, dist,
    abs, floor, ceil, round, sqrt, pow, sin, cos, atan2, random, min, max,
    keyIsDown, loop, noLoop, tint, millis, arc,
    rotateX, rotateY, rotateZ, ambientMaterial, specularMaterial, shininess,
    ambientLight, directionalLight, pointLight, box, sphere, ellipsoid, cylinder, cone,
    noLights, normalMaterial, emissiveMaterial,
    LEFT_ARROW, UP_ARROW, RIGHT_ARROW, DOWN_ARROW, ENTER,
    CENTER, CORNER, LEFT, RIGHT, TOP, BOTTOM, BASELINE, PI, TWO_PI, HALF_PI, CLOSE, P2D, WEBGL,
    get width() { return _width; },
    get height() { return _height; },
    get frameCount() { return _frameCount; },
    get mouseX() { return (_qmx / 65535) * _width; },
    get mouseY() { return (_qmy / 65535) * _height; },
    get mouseIsPressed() { return _mouseDown; },
    get gamepadAxes() { return _qaxes.map((q) => (q / 65535) * 2 - 1); },
  };

  for (const [k, v] of Object.entries(globals)) {
    const desc = Object.getOwnPropertyDescriptor(globals, k);
    if (desc && (desc.get || desc.set)) {
      Object.defineProperty(globalThis, k, desc);
    } else {
      globalThis[k] = v;
    }
  }
}

export {
  installGlobals,
  setRasterRes,
  setKeysDown,
  simulateKeyPress,
  setPointerPos,
  setButtons,
  setAxes,
  resetPointer,
  tick,
  resetFrameCount,
  resetDrawState,
  isLooping,
  getPixelData,
  getCanvasBuffer,
  getObsBuffer,
};
