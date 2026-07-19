// shims.mjs — Fake browser environment so Three.js can run in Node.js
// Must be imported BEFORE Three.js (ESM imports are hoisted, so this file
// sets up globals that Three.js module-level code expects)

import { create, globals } from 'webgpu';
Object.assign(globalThis, globals);

// Dawn GPU instance
const gpu = create([]);
const adapter = await gpu.requestAdapter();
if (!adapter) throw new Error('Failed to get GPU adapter');
const device = await adapter.requestDevice();

// Canvas dimensions — overridable via PLAYTRAIN_THREE_OBS_SIZE env var so the
// worker can match whatever obs_size the Python env requested.
const WIDTH  = parseInt(process.env.PLAYTRAIN_THREE_OBS_SIZE || '84', 10);
const HEIGHT = parseInt(process.env.PLAYTRAIN_THREE_OBS_SIZE || '84', 10);

// Fake GPUCanvasContext — creates the render texture lazily when Three.js
// calls configure(), so format and usage flags match what it expects
let renderTexture = null;
let renderFormat = 'bgra8unorm';
let renderDevice = null; // Captures the device Three.js actually uses

const fakeContext = {
  configure({ device: dev, format, usage, alphaMode }) {
    renderDevice = dev;
    renderFormat = format;
    renderTexture = dev.createTexture({
      size: [WIDTH, HEIGHT],
      format,
      usage: usage || (GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC),
    });
  },
  unconfigure() {},
  getCurrentTexture() {
    return renderTexture;
  },
  getPreferredFormat() {
    return renderFormat;
  },
};

// Fake canvas factory
function createFakeCanvas() {
  return {
    width: WIDTH,
    height: HEIGHT,
    style: {},
    clientWidth: WIDTH,
    clientHeight: HEIGHT,
    getContext(type) {
      if (type === 'webgpu') return fakeContext;
      return null;
    },
    setAttribute() {},
    getAttribute() { return null; },
    addEventListener() {},
    removeEventListener() {},
    getRootNode() { return this; },
    getBoundingClientRect() {
      return { x: 0, y: 0, width: WIDTH, height: HEIGHT, top: 0, left: 0, bottom: HEIGHT, right: WIDTH };
    },
  };
}

// Browser globals
globalThis.window = globalThis;
globalThis.self = globalThis;

globalThis.document = {
  createElementNS(ns, tag) {
    if (tag === 'canvas') return createFakeCanvas();
    return { style: {} };
  },
  createElement(tag) {
    if (tag === 'canvas') return createFakeCanvas();
    return { style: {} };
  },
  createTextNode() { return {}; },
  body: { appendChild() {}, removeChild() {} },
  addEventListener() {},
  removeEventListener() {},
  getElementById() { return null; },
  head: { appendChild() {} },
};

Object.defineProperty(globalThis, 'navigator', {
  value: {
    gpu,
    userAgent: 'Mozilla/5.0 Node.js',
    platform: 'MacIntel',
    language: 'en',
    maxTouchPoints: 0,
  },
  writable: true,
  configurable: true,
});

globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

// Node.js 24 has CustomEvent, but guard just in case
globalThis.CustomEvent = globalThis.CustomEvent || class CustomEvent extends Event {
  constructor(type, params = {}) {
    super(type, params);
    this.detail = params.detail;
  }
};

// Stubs for APIs Three.js may probe
globalThis.HTMLCanvasElement = globalThis.HTMLCanvasElement || class HTMLCanvasElement {};
globalThis.HTMLImageElement = globalThis.HTMLImageElement || class HTMLImageElement {};
globalThis.ImageBitmap = globalThis.ImageBitmap || class ImageBitmap {};
globalThis.OffscreenCanvas = globalThis.OffscreenCanvas || class OffscreenCanvas {
  constructor(w, h) { this.width = w; this.height = h; }
};

// Image stub (for texture loading — not used in POC but prevents crashes)
globalThis.Image = globalThis.Image || class Image {
  constructor() { this.src = ''; }
  addEventListener() {}
};

export function getRenderDevice() { return renderDevice; }
export { gpu, adapter, device, fakeContext, createFakeCanvas, WIDTH, HEIGHT };
