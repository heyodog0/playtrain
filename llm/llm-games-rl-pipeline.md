# Fast RL on LLM-Generated Browser Games

## Problem

LLMs are exceptionally good at generating complex, playable browser games (Three.js, p5.js) — far better than generating equivalent native code. These games have rich mechanics, physics, scoring, and visual complexity that make them ideal RL environments. But running RL on browser games is impractically slow: Selenium-based wrappers achieve 0.2–0.5 FPS, Puppeteer tops out around 5–30 FPS. Pixel-based RL needs hundreds of FPS minimum.

## Goal

Build a **headless runtime** that executes unmodified JS browser games at native GPU speed, outputs pixel observations, accepts action inputs, and exposes a Gymnasium-compatible interface for RL training. Target: **200–500 FPS** per environment at 84×84 resolution.

## Key Insight

Browser games don't need a browser. They need a JS engine (V8) and a GPU context. The browser is overhead — compositor, DOM layout, process isolation, IPC — none of which the game logic requires. Strip all of that away and route rendering calls directly to the GPU.

## Method

### Architecture

```
LLM generates browser game (Three.js / p5.js)
  → Human playtests in browser (unchanged)
  → One-line change: WebGLRenderer → WebGPURenderer
  → Game runs in Node.js headless runtime:
      ├── V8 executes game JS (unmodified)
      ├── Fake browser shim (window, document, rAF, events)
      ├── canvas.getContext('webgpu') → Dawn (Google's WebGPU impl)
      │   ├── macOS: Dawn → Metal
      │   └── Linux/NVIDIA: Dawn → Vulkan
      ├── 2D games (p5.js): canvas.getContext('2d') → node-canvas
      └── Pixel readback: GPU texture → shared memory → Python
  → Gymnasium wrapper: step(action) → (pixels, reward, done)
  → RL training via PufferLib (vectorized, parallel envs)
```

### Core Components

1. **Fake browser runtime** — Minimal shim providing `window`, `document`, `navigator`, `requestAnimationFrame`, `addEventListener`, `Image`, audio stubs. Game code loads into this and believes it's running in Chrome.

2. **Dawn WebGPU bridge** — `canvas.getContext('webgpu')` returns a fake `GPUCanvasContext` that renders to an offscreen Dawn `GPUTexture` instead of a screen. `getCurrentTexture()` returns this texture each frame.

3. **Pixel readback** — After each `renderer.render()`, copy the GPU texture to a `GPUBuffer`, map it, and expose the raw RGBA bytes to Python via shared memory (no PNG encoding).

4. **Action injection** — `requestAnimationFrame` becomes a manually called `tick()`. Keyboard/mouse listeners are triggered programmatically by the RL agent's action.

5. **Gymnasium wrapper** — Python process communicates with Node.js via shared memory or ZMQ. Exposes standard `step(action) → (obs, reward, terminated, truncated, info)`.

### Why Dawn / WebGPU

- Cross-platform: Metal on macOS (M4), Vulkan on Linux/NVIDIA — zero code changes
- `npm install webgpu` — prebuilt binaries for macOS ARM, Linux x64
- No deprecated OpenGL (Apple killed it), no ANGLE, no browser
- Native GPU speed with direct texture readback

### Speed Comparison

| Approach | FPS | Notes |
|---|---|---|
| Selenium + browser | 0.2–0.5 | PNG screenshot round-trip |
| Puppeteer + headless Chrome | 5–30 | Full browser overhead |
| **This system (Dawn + Node.js)** | **200–500** | No browser, GPU direct, shared memory |
| Procgen (C++ software render) | 2,000–5,000 | Hand-coded C++, simple 2D only |
| ALE/Atari (CPU) | ~6,000 | 1977-era games, 128 bytes RAM |

### Positioning vs Existing Work

- **ALE/Atari**: 57 fixed games from 1977, heavily overfit by the field
- **Procgen**: 16 hand-coded C++ game types, procedural levels but fixed mechanics
- **This system**: Unlimited game types generated on-the-fly by LLMs, with 3D rendering, real physics, novel reward structures — at 10× slower but infinitely more diverse

## Unvalidated Assumption

**Three.js WebGPURenderer has never been run headlessly in Node.js via Dawn.** The Dawn npm package explicitly states it does not provide web platform integration (no `HTMLCanvasElement`, no `HTMLImageElement`). The fake `GPUCanvasContext` shim is a design — not working code. Three.js internals may make browser API calls we haven't accounted for.

## Proof of Concept Test

Before building the full pipeline, validate the critical assumption with a minimal test:

```js
// poc.mjs — Can Three.js WebGPURenderer produce pixels via Dawn in Node.js?

import { create, globals } from 'webgpu';
Object.assign(globalThis, globals);

// Minimal browser shims
globalThis.window = globalThis;
globalThis.document = {
  createElementNS: (ns, tag) => {
    if (tag === 'canvas') return { width: 84, height: 84, style: {} };
    return {};
  },
  createElement: (tag) => ({ style: {} }),
};
globalThis.navigator = { gpu: create([]), userAgent: 'node' };
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);

// Dawn setup
const adapter = await navigator.gpu.requestAdapter();
const device = await adapter.requestDevice();

const width = 84, height = 84;
const texture = device.createTexture({
  size: [width, height],
  format: 'bgra8unorm',
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
});

// Fake GPUCanvasContext
const fakeContext = {
  configure(config) { this.device = config.device; },
  getCurrentTexture() { return texture; },
  getPreferredFormat() { return 'bgra8unorm'; },
};

// Patch document.createElement to return a canvas with our fake context
globalThis.document.createElement = (tag) => {
  if (tag === 'canvas') {
    return {
      width, height, style: {},
      getContext(type) {
        if (type === 'webgpu') return fakeContext;
        return null;
      },
      addEventListener() {},
      removeEventListener() {},
    };
  }
  return { style: {} };
};

// NOW: import Three.js and attempt to render
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu'; // or appropriate import path

// If we get here without crashing, the shim is partially working
// Build a minimal scene
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100);
camera.position.z = 2;
const geometry = new THREE.BoxGeometry();
const material = new THREE.MeshNormalMaterial();
scene.add(new THREE.Mesh(geometry, material));

const renderer = new WebGPURenderer({ canvas: document.createElement('canvas') });
renderer.setSize(width, height);
await renderer.init();
renderer.render(scene, camera);

// Read pixels back
const buffer = device.createBuffer({
  size: width * height * 4,
  usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
});
const encoder = device.createCommandEncoder();
encoder.copyTextureToBuffer(
  { texture },
  { buffer, bytesPerRow: width * 4 },
  [width, height],
);
device.queue.submit([encoder.finish()]);
await buffer.mapAsync(GPUMapMode.READ);
const pixels = new Uint8Array(buffer.getMappedRange());

// Check: are there non-zero pixels?
const nonZero = pixels.filter(p => p > 0).length;
console.log(`Pixels read: ${pixels.length}, non-zero: ${nonZero}`);
console.log(nonZero > 0 ? '✅ POC PASSED — pixels rendered' : '❌ POC FAILED — blank frame');

buffer.unmap();
device.destroy();
```

### What the POC tells us

- **If it passes**: The shim approach works. Three.js can render through Dawn. Build the full runtime.
- **If it crashes on import**: Three.js has hard browser dependencies. Catalog them and extend the shim.
- **If it renders blank**: The fake `GPUCanvasContext` isn't wired correctly. Debug the texture pipeline.
- **If it requires too many shims**: Consider having the LLM generate games using Dawn's WebGPU API directly (losing the "unmodified game" property but keeping everything else).

## Next Steps (if POC passes)

1. Harden the browser shim (image loading, audio stubs, resize handling)
2. Build the Gymnasium wrapper with shared memory pixel transfer
3. Integrate with PufferLib for vectorized parallel training
4. Test with real LLM-generated Three.js and p5.js games
5. Benchmark FPS across macOS M4 and Linux/NVIDIA
