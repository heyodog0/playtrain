// poc.mjs — Can Three.js WebGPURenderer produce pixels via Dawn in Node.js?
//
// This validates the critical assumption: Three.js has never been run
// headlessly in Node.js via Dawn's WebGPU implementation.

// Step 1: Import shims FIRST (sets up fake browser globals before Three.js loads)
import { fakeContext, getRenderDevice, createFakeCanvas, WIDTH, HEIGHT } from './shims.mjs';

// Step 2: Dynamic import so shims are in place when Three.js module code runs
console.log('Importing Three.js...');
const {
  WebGPURenderer,
  Scene,
  PerspectiveCamera,
  BoxGeometry,
  MeshNormalMaterial,
  Mesh,
} = await import('three/webgpu');
console.log('Three.js imported successfully');

// Step 3: Build a minimal scene
const scene = new Scene();
const camera = new PerspectiveCamera(70, 1, 0.1, 100);
camera.position.z = 2;

const geometry = new BoxGeometry();
const material = new MeshNormalMaterial();
scene.add(new Mesh(geometry, material));

// Step 4: Create the renderer with our Dawn device and fake canvas
const canvas = createFakeCanvas();
console.log('Creating WebGPURenderer...');
const renderer = new WebGPURenderer({ canvas });
renderer.setSize(WIDTH, HEIGHT);

console.log('Initializing renderer...');
await renderer.init();
console.log('Renderer initialized');

// Step 5: Render one frame
console.log('Rendering...');
renderer.render(scene, camera);

// Get the device Three.js is actually using (captured during context.configure())
const device = getRenderDevice();
if (!device) {
  console.error('❌ No render device — Three.js never called context.configure()');
  process.exit(1);
}

// Wait for GPU to finish
await device.queue.onSubmittedWorkDone();
console.log('Frame rendered');

// Step 6: Read pixels back from the render texture
const renderTexture = fakeContext.getCurrentTexture();
if (!renderTexture) {
  console.error('❌ No render texture — fakeContext.getCurrentTexture() returned null');
  process.exit(1);
}

// bytesPerRow must be aligned to 256
const bytesPerRow = Math.ceil((WIDTH * 4) / 256) * 256; // 336 → 512
const bufferSize = bytesPerRow * HEIGHT;

const readBuffer = device.createBuffer({
  size: bufferSize,
  usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
});

const encoder = device.createCommandEncoder();
encoder.copyTextureToBuffer(
  { texture: renderTexture },
  { buffer: readBuffer, bytesPerRow },
  [WIDTH, HEIGHT],
);
device.queue.submit([encoder.finish()]);

await readBuffer.mapAsync(GPUMapMode.READ);
const rawData = new Uint8Array(readBuffer.getMappedRange());

// Count non-zero pixels (accounting for row padding)
let nonZeroPixels = 0;
let totalPixels = WIDTH * HEIGHT;
for (let y = 0; y < HEIGHT; y++) {
  for (let x = 0; x < WIDTH; x++) {
    const offset = y * bytesPerRow + x * 4;
    const b = rawData[offset];
    const g = rawData[offset + 1];
    const r = rawData[offset + 2];
    const a = rawData[offset + 3];
    if (r > 0 || g > 0 || b > 0 || a > 0) {
      nonZeroPixels++;
    }
  }
}

console.log(`\nPixels read: ${totalPixels}, non-zero: ${nonZeroPixels}`);

// Sample a few pixels for inspection
console.log('\nSample pixels (center region):');
const cx = Math.floor(WIDTH / 2);
const cy = Math.floor(HEIGHT / 2);
for (let dy = -2; dy <= 2; dy++) {
  const y = cy + dy;
  const x = cx;
  const offset = y * bytesPerRow + x * 4;
  console.log(`  [${x},${y}] BGRA: ${rawData[offset]}, ${rawData[offset+1]}, ${rawData[offset+2]}, ${rawData[offset+3]}`);
}

if (nonZeroPixels > 0) {
  console.log('\n✅ POC PASSED — pixels rendered via Three.js + Dawn in Node.js');
} else {
  console.log('\n❌ POC FAILED — blank frame (all pixels zero)');
}

// Cleanup
readBuffer.unmap();
readBuffer.destroy();
device.destroy();
process.exit(0);
