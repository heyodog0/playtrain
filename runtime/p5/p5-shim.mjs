// p5-shim.mjs — Minimal p5.js-compatible API on top of node-canvas (cairo).

import { createCanvas as createNodeCanvas } from 'canvas';
import { endianness } from 'os';

// toBuffer('raw') hands back Cairo's native ARGB32 surface — byte order is
// BGRA on LE, ARGB on BE. The fast obs path assumes BGRA. Fail loudly on BE
// rather than silently corrupting channels.
const _IS_LE = endianness() === 'LE';

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
  _canvas = createNodeCanvas(w, h);
  _ctx = _canvas.getContext('2d');
  return { parent() {} };
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
function push() { _ctx.save(); }
function pop() { _ctx.restore(); _invalidateStyleCache(); }
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
    throw new Error('getObsBuffer assumes little-endian (BGRA byte order from Cairo). Set NODE_GYM_P5_FAST_OBS=0 on big-endian hosts.');
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
const PI = Math.PI;
const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const CLOSE = 'close';

// ---- Install globals ----
function installGlobals() {
  const globals = {
    createCanvas, background, fill, rectMode, rect, ellipseMode, ellipse, circle, triangle, quad, line,
    stroke, noStroke, strokeWeight, noSmooth, color,
    textSize, textAlign, textFont, text,
    push, pop, translate, rotate, scale,
    beginShape, vertex, endShape,
    map, constrain, lerp, dist,
    abs, floor, ceil, round, sqrt, pow, sin, cos, atan2, random, min, max,
    keyIsDown, loop, noLoop, tint, millis,
    LEFT_ARROW, UP_ARROW, RIGHT_ARROW, DOWN_ARROW, ENTER,
    CENTER, CORNER, LEFT, PI, TWO_PI, HALF_PI, CLOSE,
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
  setKeysDown,
  simulateKeyPress,
  tick,
  isLooping,
  getPixelData,
  getCanvasBuffer,
  getObsBuffer,
};
