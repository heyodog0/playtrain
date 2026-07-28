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
if (_RASTERIZER === 'cairo') {
  createNodeCanvas = (await import('canvas')).createCanvas;
} else if (_RASTERIZER === 'wasm') {
  const m = await import('./raster-wasm.mjs');
  if (m.wasmAvailable) { createNodeCanvas = m.createCanvas; }
  else { _RASTERIZER = 'js'; createNodeCanvas = createJsCanvas; }
} else {
  _RASTERIZER = 'js';
  createNodeCanvas = createJsCanvas;
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
function colorArgs(args) {
  // p5 accepts color arrays: fill([r,g,b]) or fill([r,g,b,a]). Unwrap.
  if (args.length === 1 && Array.isArray(args[0])) args = args[0];
  if (args.length === 1 && typeof args[0] === 'string') return args[0];
  if (args.length === 1) return `rgba(${args[0]},${args[0]},${args[0]},1)`;
  if (args.length === 2) return `rgba(${args[0]},${args[0]},${args[0]},${args[1]/255})`;
  if (args.length === 3) return `rgba(${args[0]},${args[1]},${args[2]},1)`;
  if (args.length === 4) return `rgba(${args[0]},${args[1]},${args[2]},${args[3]/255})`;
  return 'rgba(0,0,0,1)';
}

// ---- Canvas creation ----
function createCanvas(w, h) {
  _width = w;
  _height = h;
  _canvas = _RASTER_RES
    ? createNodeCanvas(w, h, _RASTER_RES, _RASTER_RES)
    : createNodeCanvas(w, h);
  _ctx = _canvas.getContext('2d');
  // logical -> device, for sizing offscreen layers and mapping image() blits
  _devSx = _canvas.width / w;
  _devSy = _canvas.height / h;
  return { parent() {} };
}

// ---- offscreen graphics: createGraphics + setTarget/clearTarget + image ----
// Mirrors native/runtime/p5.cpp so the Node/browser shim and the QuickJS host
// expose the SAME capability — a game that caches static content in a layer must
// not simply fail to load on the portable backend (it did: all four validate
// checks failed on analogen_platformer_easy).
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
}

function fill(...args) {
  _fillStyle = colorArgs(args);
}

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
  _ctx.save();
  _styleStack.push({
    fill: _fillStyle, strokeEnabled: _strokeEnabled, strokeStyle: _strokeStyle,
    strokeW: _strokeW, textSz: _textSz, textAlignH: _textAlignH,
    textFontFamily: _textFontFamily, rectMode: _rectMode, ellipseMode: _ellipseMode,
  });
}
function pop() {
  _ctx.restore();
  const s = _styleStack.pop();
  if (s) {
    _fillStyle = s.fill; _strokeEnabled = s.strokeEnabled; _strokeStyle = s.strokeStyle;
    _strokeW = s.strokeW; _textSz = s.textSz; _textAlignH = s.textAlignH;
    _textFontFamily = s.textFontFamily; _rectMode = s.rectMode; _ellipseMode = s.ellipseMode;
  }
  _invalidateStyleCache(); // force next draw to re-apply restored fill/stroke to Cairo
}
function translate(x, y) { _ctx.translate(x, y); }
function rotate(a) { _ctx.rotate(a); }
function scale(sx, sy) { if (sy === undefined) sy = sx; _ctx.scale(sx, sy); }

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
  if (typeof globalThis.draw === 'function') globalThis.draw();
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
    LEFT_ARROW, UP_ARROW, RIGHT_ARROW, DOWN_ARROW, ENTER,
    CENTER, CORNER, LEFT, RIGHT, TOP, BOTTOM, BASELINE, PI, TWO_PI, HALF_PI, CLOSE,
    get width() { return _width; },
    get height() { return _height; },
    get frameCount() { return _frameCount; },
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
  tick,
  resetFrameCount,
  isLooping,
  getPixelData,
  getCanvasBuffer,
  getObsBuffer,
};
