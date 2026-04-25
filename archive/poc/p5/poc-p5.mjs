// poc-p5.mjs — Can we run the kazuki p5.js game headlessly via node-canvas?
//
// Tests: game loads, renders pixels, accepts actions, produces reward signals

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
import {
  installGlobals,
  setKeysDown,
  simulateKeyPress,
  tick,
  isLooping,
  getPixelData,
} from './p5-shim.mjs';

// Step 1: Install p5-compatible globals
installGlobals();

// Step 2: Load and execute the game code (defines setup, draw, keyPressed, etc.)
console.log('Loading game code...');
let gameCode = readFileSync(join(__dirname, 'kazuki_game.js'), 'utf-8');
// Append state accessor — let/const in vm.runInThisContext are script-scoped,
// not on globalThis. This function closes over the game's variables.
gameCode += `
globalThis.getGameState = () => ({ gameState, score, lives, player, inventory, currentRoom });
globalThis.setGameState = (s) => { gameState = s; };
`;
vm.runInThisContext(gameCode);

// Step 3: Call setup() to initialize the game
console.log('Calling setup()...');
globalThis.setup();

// Step 4: Render the start screen
tick();
let pixels = getPixelData();
let nonZero = 0;
for (let i = 0; i < pixels.data.length; i += 4) {
  if (pixels.data[i] > 0 || pixels.data[i+1] > 0 || pixels.data[i+2] > 0) nonZero++;
}
console.log(`\nStart screen: ${pixels.width}x${pixels.height}, non-zero pixels: ${nonZero}/${pixels.width * pixels.height}`);

// Step 5: Press ENTER to start the game
console.log('\nSimulating ENTER to start game...');
simulateKeyPress(13); // ENTER
tick();

// Read game state via accessor
let gs = globalThis.getGameState();
console.log(`gameState: ${gs.gameState}`);
console.log(`score: ${gs.score}, lives: ${gs.lives}`);

// Step 6: Run 60 frames with RIGHT + UP (walk right and jump)
console.log('\nRunning 60 frames with RIGHT_ARROW held...');
const scoreBefore = globalThis.getGameState().score;
for (let i = 0; i < 60; i++) {
  setKeysDown([39]); // RIGHT_ARROW
  if (i === 10) {
    // Jump at frame 10
    simulateKeyPress(38); // UP_ARROW triggers keyPressed() for jump
  }
  tick();
}
gs = globalThis.getGameState();
const scoreAfter = gs.score;

pixels = getPixelData();
nonZero = 0;
for (let i = 0; i < pixels.data.length; i += 4) {
  if (pixels.data[i] > 0 || pixels.data[i+1] > 0 || pixels.data[i+2] > 0) nonZero++;
}

console.log(`After 60 frames: non-zero pixels: ${nonZero}/${pixels.width * pixels.height}`);
console.log(`Score: ${scoreBefore} → ${scoreAfter} (delta: ${scoreAfter - scoreBefore})`);
console.log(`Lives: ${gs.lives}, gameState: ${gs.gameState}`);
console.log(`Player pos: (${gs.player.x.toFixed(1)}, ${gs.player.y.toFixed(1)})`);

function runBenchmark(label, frames, stepFn) {
  const start = performance.now();
  let checksum = 0;
  let steps = 0;

  for (let i = 0; i < frames; i++) {
    checksum += stepFn(i) || 0;
    steps++;
    if (!isLooping()) break;
  }

  const elapsed = performance.now() - start;
  const fps = steps / (elapsed / 1000);
  console.log(`${label}: ${steps} frames in ${elapsed.toFixed(1)}ms = ${fps.toFixed(0)} FPS (checksum ${checksum})`);
  return { elapsed, fps, steps, checksum };
}

// Step 7: Measure throughput
console.log('\nBenchmarking throughput...');
const renderOnly = runBenchmark('Render-only (action + tick)', 1000, (i) => {
  setKeysDown(i % 60 < 30 ? [39] : [37]); // Alternate left/right
  tick();
  return globalThis.frameCount & 255;
});

const rlStep = runBenchmark('RL step (action + tick + pixels + state)', 1000, (i) => {
  setKeysDown(i % 60 < 30 ? [39] : [37]);
  tick();
  const frame = getPixelData();
  const state = globalThis.getGameState();
  return frame.data[0] + state.score + state.lives + state.player.x;
});

// Step 8: Final pixel check
pixels = getPixelData();
nonZero = 0;
for (let i = 0; i < pixels.data.length; i += 4) {
  if (pixels.data[i] > 0 || pixels.data[i+1] > 0 || pixels.data[i+2] > 0) nonZero++;
}

gs = globalThis.getGameState();
console.log(`\nFinal frame: ${nonZero} non-zero pixels`);

// Sample center pixels
const cx = Math.floor(pixels.width / 2);
const cy = Math.floor(pixels.height / 2);
console.log('\nSample pixels (center):');
for (let dy = -2; dy <= 2; dy++) {
  const y = cy + dy;
  const idx = (y * pixels.width + cx) * 4;
  console.log(`  [${cx},${y}] RGBA: ${pixels.data[idx]}, ${pixels.data[idx+1]}, ${pixels.data[idx+2]}, ${pixels.data[idx+3]}`);
}

if (nonZero > 0) {
  console.log('\n✅ P5 POC PASSED — game renders headlessly via node-canvas');
  console.log(`   Render-only speed: ${renderOnly.fps.toFixed(0)} FPS`);
  console.log(`   RL-step speed: ${rlStep.fps.toFixed(0)} FPS`);
  console.log(`   Reward signal: score variable accessible (${gs.score})`);
  console.log(`   Terminal signal: gameState accessible (${gs.gameState})`);
} else {
  console.log('\n❌ P5 POC FAILED — blank frame');
}

process.exit(0);
