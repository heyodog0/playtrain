// p5-shim.mjs — Minimal p5.js-compatible API on top of node-canvas
// Only implements the subset needed by the kazuki game

import { createCanvas as createNodeCanvas } from 'canvas';

let _canvas = null;
let _ctx = null;
let _width = 0;
let _height = 0;
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

// ---- Color helpers ----
function colorArgs(args) {
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
  if (args.length >= 2 && args.length <= 2) {
    // background(gray, alpha) used for overlays
    _ctx.fillStyle = colorArgs(args);
  } else {
    _ctx.fillStyle = colorArgs(args);
  }
  _ctx.fillRect(0, 0, _width, _height);
  _ctx.restore();
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
  _ctx.fillStyle = _fillStyle;
  if (r && r > 0) {
    _ctx.beginPath();
    _ctx.roundRect(dx, dy, w, h, r);
    _ctx.fill();
    if (_strokeEnabled) { _ctx.strokeStyle = _strokeStyle; _ctx.lineWidth = _strokeW; _ctx.stroke(); }
  } else {
    _ctx.fillRect(dx, dy, w, h);
    if (_strokeEnabled) { _ctx.strokeStyle = _strokeStyle; _ctx.lineWidth = _strokeW; _ctx.strokeRect(dx, dy, w, h); }
  }
}

function ellipse(x, y, w, h) {
  if (h === undefined) h = w;
  _ctx.fillStyle = _fillStyle;
  _ctx.beginPath();
  _ctx.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2);
  _ctx.fill();
  if (_strokeEnabled) { _ctx.strokeStyle = _strokeStyle; _ctx.lineWidth = _strokeW; _ctx.stroke(); }
}

function triangle(x1, y1, x2, y2, x3, y3) {
  _ctx.fillStyle = _fillStyle;
  _ctx.beginPath();
  _ctx.moveTo(x1, y1);
  _ctx.lineTo(x2, y2);
  _ctx.lineTo(x3, y3);
  _ctx.closePath();
  _ctx.fill();
  if (_strokeEnabled) { _ctx.strokeStyle = _strokeStyle; _ctx.lineWidth = _strokeW; _ctx.stroke(); }
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
  _ctx.strokeStyle = _strokeStyle;
  _ctx.lineWidth = _strokeW;
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
  _ctx.fillStyle = _fillStyle;
  _ctx.font = `${_textSz}px ${_textFontFamily}`;
  _ctx.textAlign = _textAlignH;
  _ctx.fillText(String(str), x, y);
}

// ---- Transform stack ----
function push() { _ctx.save(); }
function pop() { _ctx.restore(); }
function translate(x, y) { _ctx.translate(x, y); }
function rotate(a) { _ctx.rotate(a); }
function scale(sx, sy) { if (sy === undefined) sy = sx; _ctx.scale(sx, sy); }

// ---- Shape mode ----
let _shapeVerts = [];
function beginShape() { _shapeVerts = []; }
function vertex(x, y) { _shapeVerts.push([x, y]); }
function endShape(mode) {
  if (_shapeVerts.length < 2) return;
  _ctx.fillStyle = _fillStyle;
  _ctx.beginPath();
  _ctx.moveTo(_shapeVerts[0][0], _shapeVerts[0][1]);
  for (let i = 1; i < _shapeVerts.length; i++) _ctx.lineTo(_shapeVerts[i][0], _shapeVerts[i][1]);
  if (mode === CLOSE) _ctx.closePath();
  _ctx.fill();
  if (_strokeEnabled) { _ctx.strokeStyle = _strokeStyle; _ctx.lineWidth = _strokeW; _ctx.stroke(); }
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
  // Sets keyCode global and triggers the game's keyPressed() if defined
  globalThis.keyCode = code;
  if (typeof globalThis.keyPressed === 'function') globalThis.keyPressed();
}

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
    createCanvas, background, fill, rectMode, rect, ellipse, circle, triangle, line,
    stroke, noStroke, strokeWeight, noSmooth, color,
    textSize, textAlign, textFont, text,
    push, pop, translate, rotate, scale,
    beginShape, vertex, endShape,
    map, constrain, lerp, dist,
    abs, floor, ceil, round, sqrt, pow, sin, cos, atan2, random, min, max,
    keyIsDown, loop, noLoop, tint,
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
};
