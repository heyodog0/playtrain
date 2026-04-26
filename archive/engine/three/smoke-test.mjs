/**
 * Smoke test for engine/three/index.mjs
 *
 * Spins up the WebGPU shim, creates a world via the engine API, draws a few
 * primitives, runs N frames + pixel readback, prints FPS + asserts pixels
 * are non-zero (i.e. something actually rendered).
 *
 * Usage: node engine/three/smoke-test.mjs
 */

import { fakeContext, getRenderDevice, createFakeCanvas, WIDTH, HEIGHT } from '../../archive/poc/webgpu/shims.mjs';
const THREE = await import('three/webgpu');
const engine = await import('./index.mjs');

console.log(`Engine smoke test  (Dawn WebGPU, ${WIDTH}×${HEIGHT})`);
console.log(`Engine LOC: ${'(see file)'} | exports: ${Object.keys(engine).length}\n`);

// --- Setup ---
const canvas = createFakeCanvas();
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.setSize(WIDTH, HEIGHT);
await renderer.init();

const { world, camera } = engine.setupGame({
  THREE, renderer, width: WIDTH, height: HEIGHT,
  cameraMode: engine.CAMERA_FIXED_TOPDOWN,
  cameraOpts: { position: [6, 8, 6], target: [0, 0, 0] },
});
engine.setBackground(world, engine.SKYBLUE);

// --- Scene: a few primitives across the API surface ---
console.log('Drawing primitives...');
const ground = engine.drawPlane(world, [0, 0, 0], [10, 10], engine.DARKGRAY);
const grid   = engine.drawGrid(world, 10, 1, engine.LIGHTGRAY);
const player = engine.drawSphere(world, [0, 0.5, 0], 0.5, engine.BLUE);
const goal   = engine.drawOctahedron(world, [3, 0.5, 0], 0.4, engine.GOLD);
const wall   = engine.drawCube(world, [-3, 0.5, 0], 1, 1, 1, engine.MAROON);
const tree   = engine.drawCylinder(world, [0, 0.6, -3], 0.3, 0.3, 1.2, 8, engine.DARKGREEN);
const cone   = engine.drawCone(world, [0, 0.5, 3], 0.5, 1, 8, engine.ORANGE);
console.log(`  ${world.scene.children.length} scene children (lights + meshes)`);
console.log(`  material pool: ${world._materialPool.size}, geometry pool: ${world._geometryPool.size}`);

// --- Trigger context.configure() so we can grab the device ---
engine.render(world);
const device = getRenderDevice();
if (!device) throw new Error('Three.js never called context.configure()');
await device.queue.onSubmittedWorkDone();

// --- Phase 1: tick (math) only ---
const FRAMES = 200;
let t0 = performance.now();
for (let i = 0; i < FRAMES; i++) {
  globalThis.currentAction = i % 15;
  // simulated game tick: move player, spin goal
  player.position.x = 0 + Math.sin(i * 0.05) * 2;
  goal.rotation.y += 0.05;
}
const tickMs = performance.now() - t0;

// --- Phase 2: tick + render ---
t0 = performance.now();
for (let i = 0; i < FRAMES; i++) {
  player.position.x = Math.sin(i * 0.05) * 2;
  goal.rotation.y += 0.05;
  engine.render(world);
}
await device.queue.onSubmittedWorkDone();
const renderMs = performance.now() - t0;

// --- Phase 3: tick + render + pixel readback (full RL step) ---
const bytesPerRow = Math.ceil((WIDTH * 4) / 256) * 256;
const readBuf = device.createBuffer({
  size: bytesPerRow * HEIGHT,
  usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
});

t0 = performance.now();
let nonzeroFrames = 0;
for (let i = 0; i < FRAMES; i++) {
  player.position.x = Math.sin(i * 0.05) * 2;
  goal.rotation.y += 0.05;
  engine.render(world);
  const tex = fakeContext.getCurrentTexture();
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex }, { buffer: readBuf, bytesPerRow }, [WIDTH, HEIGHT]);
  device.queue.submit([enc.finish()]);
  await readBuf.mapAsync(GPUMapMode.READ);
  const pixels = new Uint8Array(readBuf.getMappedRange());
  let sum = 0;
  for (let p = 0; p < pixels.length; p += 256) sum += pixels[p];
  if (sum > 0) nonzeroFrames++;
  readBuf.unmap();
}
const rlMs = performance.now() - t0;

// --- Report ---
const fps = (ms) => Math.round(FRAMES / (ms / 1000));
console.log('\nResults:');
console.log(`  tick       : ${fps(tickMs).toString().padStart(7)} FPS  (${(tickMs / FRAMES).toFixed(3)} ms/frame)`);
console.log(`  render     : ${fps(renderMs).toString().padStart(7)} FPS  (${(renderMs / FRAMES).toFixed(3)} ms/frame)`);
console.log(`  rl_step    : ${fps(rlMs).toString().padStart(7)} FPS  (${(rlMs / FRAMES).toFixed(3)} ms/frame)`);
console.log(`  nonzero frames: ${nonzeroFrames} / ${FRAMES}  ${nonzeroFrames === FRAMES ? '✓' : '✗'}`);

if (nonzeroFrames === FRAMES) console.log('\nSMOKE PASSED — engine renders end-to-end via Dawn.');
else console.log('\nSMOKE FAILED — some frames came back blank.');

readBuf.destroy();
renderer.dispose();
process.exit(nonzeroFrames === FRAMES ? 0 : 1);
