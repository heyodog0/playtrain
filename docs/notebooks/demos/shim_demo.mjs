// Demo: The p5.js shim in action
// Shows that canvas creation, rendering, and pixel readback
// all happen in a single Node.js process with direct memory access.

import { installGlobals, tick, getPixelData } from '../../../archive/poc/p5/p5-shim.mjs';

// Install p5.js-compatible globals onto globalThis
installGlobals();

// Create a 100x100 canvas (same API the game uses)
createCanvas(100, 100);

// Define a draw function (just like the game does)
globalThis.draw = function () {
  background(0);        // Black background
  fill(255, 0, 0);      // Red fill
  rect(10, 10, 30, 30); // Draw a red square
  fill(0, 255, 0);      // Green fill
  ellipse(70, 50, 40);  // Draw a green circle
};

// Advance one frame — calls draw() synchronously
tick();

// Read pixels directly from the Cairo buffer (no GPU, no IPC)
const pixels = getPixelData();
console.log('Canvas size:', pixels.width, 'x', pixels.height);
console.log('Pixel buffer type:', pixels.data.constructor.name);
console.log('Pixel buffer length:', pixels.data.length, 'bytes');
console.log(
  "That's",
  pixels.width,
  'x',
  pixels.height,
  'x 4 (RGBA) =',
  pixels.width * pixels.height * 4,
);

// Sample some pixels
const topLeft = pixels.data.slice(0, 4);
console.log('\nPixel at (0,0) RGBA:', Array.from(topLeft));

// Check the red square area (pixel at 20,20)
const idx = (20 * 100 + 20) * 4;
const redArea = pixels.data.slice(idx, idx + 4);
console.log('Pixel at (20,20) RGBA:', Array.from(redArea), '← inside red square');

// Timing: how fast is getPixelData()?
const iterations = 10000;
const start = performance.now();
for (let i = 0; i < iterations; i++) {
  getPixelData();
}
const elapsed = performance.now() - start;
console.log('\nPixel readback timing:');
console.log('  ' + iterations + ' reads in ' + elapsed.toFixed(1) + ' ms');
console.log(
  '  ' + ((elapsed / iterations) * 1000).toFixed(1) + ' microseconds per read',
);
console.log('  This is a direct memory read — no GPU sync, no IPC');
