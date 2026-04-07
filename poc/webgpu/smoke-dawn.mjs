// smoke-dawn.mjs — Verify Dawn WebGPU bindings work on this machine
// Tests: adapter creation, device creation, render pass clear, pixel readback

import { create, globals } from 'webgpu';
Object.assign(globalThis, globals);

const gpu = create([]);
const adapter = await gpu.requestAdapter();
if (!adapter) {
  console.error('❌ Failed to get GPU adapter');
  process.exit(1);
}
console.log('Adapter acquired');

const device = await adapter.requestDevice();
console.log('Device acquired');

// Create a small texture, clear it to red, read back pixels
const width = 4, height = 4;
const texture = device.createTexture({
  size: [width, height],
  format: 'bgra8unorm',
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
});

const encoder = device.createCommandEncoder();
const pass = encoder.beginRenderPass({
  colorAttachments: [{
    view: texture.createView(),
    clearValue: { r: 1, g: 0, b: 0, a: 1 }, // Red
    loadOp: 'clear',
    storeOp: 'store',
  }],
});
pass.end();

// bytesPerRow must be aligned to 256
const bytesPerRow = 256; // 4*4=16, rounded up to 256
const buffer = device.createBuffer({
  size: bytesPerRow * height,
  usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
});

encoder.copyTextureToBuffer(
  { texture },
  { buffer, bytesPerRow },
  [width, height],
);

device.queue.submit([encoder.finish()]);
await buffer.mapAsync(GPUMapMode.READ);
const data = new Uint8Array(buffer.getMappedRange());

// BGRA format: Red = B:0, G:0, R:255, A:255
const b = data[0], g = data[1], r = data[2], a = data[3];
console.log(`Pixel [0,0] BGRA: ${b}, ${g}, ${r}, ${a}`);

if (r === 255 && g === 0 && b === 0 && a === 255) {
  console.log('✅ Dawn smoke test PASSED — GPU rendering works');
} else if (r > 0 || g > 0 || b > 0) {
  console.log('⚠️  Dawn smoke test PARTIAL — got pixels but unexpected values');
} else {
  console.log('❌ Dawn smoke test FAILED — all zeros');
}

buffer.unmap();
texture.destroy();
device.destroy();
process.exit(0);
