/**
 * Throughput bench for ONE Three.js v2 game. Spawned per game by
 * three-fps-bench.mjs to get clean global scope per game (game files use
 * top-level `let THREE` / `let score` which would clash if loaded into the
 * same VM context).
 *
 * Usage:  node docs/benchmarks/three-fps-bench-single.mjs <game> [frames] [warmup]
 * Output: single JSON object on stdout.
 */

import { readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

import {
  fakeContext,
  getRenderDevice,
  createFakeCanvas,
  WIDTH as RENDER_W,
  HEIGHT as RENDER_H,
} from '../../archive/poc/webgpu/shims.mjs';

const gameName = process.argv[2];
const FRAMES = parseInt(process.argv[3] || '300', 10);
const WARMUP = parseInt(process.argv[4] || '30', 10);

if (!gameName) {
  process.stderr.write('Usage: three-fps-bench-single.mjs <game> [frames] [warmup]\n');
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const gamePath = join(repoRoot, 'games', 'threejs', `${gameName}.js`);

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let n = Math.imul(t ^ (t >>> 15), t | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

const THREE = await import('three/webgpu');

// Inject the engine module as a global so engine-using games can access it
// via `globalThis.engine` without an import statement (vm.runInThisContext
// doesn't support ESM imports).
const engine = await import('../../engine/three/index.mjs');
globalThis.engine = engine;

const bytesPerRow = Math.ceil((RENDER_W * 4) / 256) * 256;
const bufferSize = bytesPerRow * RENDER_H;

const src = readFileSync(gamePath, 'utf8');
globalThis.mulberry32 = mulberry32;
vm.runInThisContext(src, { filename: gamePath });

const required = ['setup', 'update', 'render', 'resetGame', 'getGameState'];
for (const r of required) {
  if (typeof globalThis[r] !== 'function') {
    console.log(JSON.stringify({ name: gameName, error: `missing ${r}()` }));
    process.exit(0);
  }
}

const canvas = createFakeCanvas();
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.setSize(RENDER_W, RENDER_H);
await renderer.init();

// Mirror the browser tester: pre-populate globalThis with renderer + THREE so
// games that read `globalThis.renderer` directly (instead of capturing the
// setup arg) still work. The tester does the same via `window.renderer = ...`.
globalThis.renderer = renderer;
globalThis.THREE = THREE;

globalThis.setup({ THREE, renderer, width: RENDER_W, height: RENDER_H });
globalThis.resetGame(42);

// Trigger context.configure() so getRenderDevice() returns non-null.
globalThis.currentAction = 0;
globalThis.update(1 / 60);
globalThis.render();

const device = getRenderDevice();
if (!device) {
  console.log(JSON.stringify({ name: gameName, error: 'context.configure() never called' }));
  process.exit(0);
}
await device.queue.onSubmittedWorkDone();

const readBuffer = device.createBuffer({
  size: bufferSize,
  usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
});

const actionRng = mulberry32(123);
const actions = new Uint8Array(FRAMES + WARMUP);
for (let i = 0; i < actions.length; i++) actions[i] = Math.floor(actionRng() * 15);

// Warmup
for (let i = 0; i < WARMUP; i++) {
  globalThis.currentAction = actions[i];
  globalThis.update(1 / 60);
  globalThis.render();
}
await device.queue.onSubmittedWorkDone();

// Phase 1: tick only
globalThis.resetGame(42);
let t0 = performance.now();
for (let i = 0; i < FRAMES; i++) {
  globalThis.currentAction = actions[WARMUP + i];
  globalThis.update(1 / 60);
}
const tickElapsed = performance.now() - t0;

// Phase 2: tick + render (await GPU completion at the end)
globalThis.resetGame(42);
t0 = performance.now();
for (let i = 0; i < FRAMES; i++) {
  globalThis.currentAction = actions[WARMUP + i];
  globalThis.update(1 / 60);
  globalThis.render();
}
await device.queue.onSubmittedWorkDone();
const renderElapsed = performance.now() - t0;

// Phase 3: tick + render + per-frame pixel readback (full RL step)
globalThis.resetGame(42);
t0 = performance.now();
for (let i = 0; i < FRAMES; i++) {
  globalThis.currentAction = actions[WARMUP + i];
  globalThis.update(1 / 60);
  globalThis.render();

  const renderTexture = fakeContext.getCurrentTexture();
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer(
    { texture: renderTexture },
    { buffer: readBuffer, bytesPerRow },
    [RENDER_W, RENDER_H],
  );
  device.queue.submit([encoder.finish()]);
  await readBuffer.mapAsync(GPUMapMode.READ);
  new Uint8Array(readBuffer.getMappedRange());
  readBuffer.unmap();
}
const rlElapsed = performance.now() - t0;

const out = {
  name: gameName,
  frames: FRAMES,
  width: RENDER_W,
  height: RENDER_H,
  tickFps: Math.round(FRAMES / (tickElapsed / 1000)),
  renderFps: Math.round(FRAMES / (renderElapsed / 1000)),
  rlFps: Math.round(FRAMES / (rlElapsed / 1000)),
  tickMs: +(tickElapsed / FRAMES).toFixed(3),
  renderMs: +(renderElapsed / FRAMES).toFixed(3),
  rlMs: +(rlElapsed / FRAMES).toFixed(3),
};

readBuffer.destroy();
renderer.dispose();
console.log(JSON.stringify(out));
process.exit(0);
