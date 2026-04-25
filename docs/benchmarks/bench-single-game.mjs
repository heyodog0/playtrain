/**
 * Benchmark a single game headlessly. Called by all-games-bench.mjs.
 *
 * Usage: node benchmarks/bench-single-game.mjs <game-name> [frames]
 * Outputs JSON to stdout.
 */

import { readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

import {
  installGlobals,
  setKeysDown,
  tick,
  getPixelData,
} from '../../../node-gym/runtime/p5/p5-shim.mjs';
import {
  preprocessObservationFromRGBA,
  preprocessObservationRGB,
} from '../../../node-gym/runtime/p5/obs.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const gamesDir = join(repoRoot, 'games', 'js');

const gameName = process.argv[2];
const BENCH_FRAMES = parseInt(process.argv[3] || '500', 10);
const WARMUP_FRAMES = 50;
const OBS_WIDTH = 64;
const OBS_HEIGHT = 64;
const MATTER_GAMES = new Set(['angry_birds', 'suika']);

if (!gameName) {
  process.stderr.write('Usage: node bench-single-game.mjs <game-name> [frames]\n');
  process.exit(1);
}

const ACTIONS = [
  { held: [], press: null },
  { held: [37], press: null },
  { held: [39], press: null },
  { held: [38], press: null },
  { held: [40], press: null },
  { held: [], press: 32 },
  { held: [37], press: 32 },
  { held: [39], press: 32 },
];

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let n = Math.imul(t ^ (t >>> 15), t | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

function randomAction(rng) {
  return Math.floor(rng() * 8);
}

function resetIfTerminal(state, seed) {
  if (state.gameState === 'GAMEOVER' || state.gameState === 'WIN') {
    globalThis.resetGame(seed);
    tick();
  }
}

installGlobals();

// Load Matter.js if needed
if (MATTER_GAMES.has(gameName)) {
  const matterPath = join(repoRoot, 'node_modules', 'matter-js', 'build', 'matter.js');
  vm.runInThisContext(readFileSync(matterPath, 'utf8'), { filename: 'matter.js' });
}

// Load game
const gamePath = join(gamesDir, `${gameName}.js`);
vm.runInThisContext(readFileSync(gamePath, 'utf8'), { filename: gamePath });

globalThis.setup();
const seedRng = mulberry32(42);
Math.random = () => seedRng();
globalThis.resetGame(42);
tick();

// Warmup
const warmRng = mulberry32(123);
for (let i = 0; i < WARMUP_FRAMES; i++) {
  setKeysDown(ACTIONS[randomAction(warmRng)].held);
  tick();
  resetIfTerminal(globalThis.getGameState(), 42 + i);
}

// Capture sample frame
const sampleFrame = getPixelData();
const sampleRgb = preprocessObservationRGB(
  sampleFrame.data, sampleFrame.width, sampleFrame.height, OBS_WIDTH, OBS_HEIGHT,
);

// Benchmark: render-only
const renderRng = mulberry32(456);
globalThis.resetGame(456);
tick();
const renderStart = performance.now();
for (let i = 0; i < BENCH_FRAMES; i++) {
  setKeysDown(ACTIONS[randomAction(renderRng)].held);
  tick();
  resetIfTerminal(globalThis.getGameState(), 456 + i);
}
const renderElapsed = performance.now() - renderStart;

// Benchmark: full RL step
const rlRng = mulberry32(789);
globalThis.resetGame(789);
tick();
const rlStart = performance.now();
for (let i = 0; i < BENCH_FRAMES; i++) {
  setKeysDown(ACTIONS[randomAction(rlRng)].held);
  tick();
  const frame = getPixelData();
  preprocessObservationRGB(frame.data, frame.width, frame.height, OBS_WIDTH, OBS_HEIGHT);
  globalThis.getGameState();
  resetIfTerminal(globalThis.getGameState(), 789 + i);
}
const rlElapsed = performance.now() - rlStart;

// Sub-step breakdown
const subRng = mulberry32(999);
globalThis.resetGame(999);
tick();
let tickT = 0, pixelT = 0, preprocT = 0, stateT = 0;
const SUB = Math.min(BENCH_FRAMES, 200);
for (let i = 0; i < SUB; i++) {
  setKeysDown(ACTIONS[randomAction(subRng)].held);

  let t0 = performance.now();
  tick();
  tickT += performance.now() - t0;

  t0 = performance.now();
  const frame = getPixelData();
  pixelT += performance.now() - t0;

  t0 = performance.now();
  preprocessObservationRGB(frame.data, frame.width, frame.height, OBS_WIDTH, OBS_HEIGHT);
  preprocT += performance.now() - t0;

  t0 = performance.now();
  globalThis.getGameState();
  stateT += performance.now() - t0;

  resetIfTerminal(globalThis.getGameState(), 999 + i);
}

const result = {
  game: gameName,
  canvasWidth: sampleFrame.width,
  canvasHeight: sampleFrame.height,
  renderOnly: {
    fps: Math.round(BENCH_FRAMES / (renderElapsed / 1000)),
    steps: BENCH_FRAMES,
    elapsedMs: Math.round(renderElapsed),
  },
  rlStep: {
    fps: Math.round(BENCH_FRAMES / (rlElapsed / 1000)),
    steps: BENCH_FRAMES,
    elapsedMs: Math.round(rlElapsed),
  },
  substeps: {
    tick: { perStepMs: +(tickT / SUB).toFixed(4) },
    pixelRead: { perStepMs: +(pixelT / SUB).toFixed(4) },
    preprocess: { perStepMs: +(preprocT / SUB).toFixed(4) },
    stateRead: { perStepMs: +(stateT / SUB).toFixed(4) },
  },
  sampleFrame: Array.from(sampleRgb),
};

process.stdout.write(JSON.stringify(result) + '\n');
