/**
 * Three.js game env wrapper.
 *
 * Loads a JS game (which exports setup/update/render/resetGame/getGameState
 * as globals), drives it through a deterministic update/render loop, and
 * reads pixels back via Dawn's WebGPU implementation.
 *
 * Parallel to runtime/game-env.mjs (the p5 version) — same RL contract,
 * different rendering backend.
 */

import { readFileSync } from 'fs';
import vm from 'vm';

import {
  fakeContext,
  getRenderDevice,
  createFakeCanvas,
  WIDTH,
  HEIGHT,
} from './shims.mjs';

const TERMINAL_STATES = new Set(['WIN', 'EXIT', 'GAMEOVER']);
const ORIGINAL_MATH_RANDOM = Math.random;
const FIXED_DT = 1 / 60;

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let n = Math.imul(t ^ (t >>> 15), t | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

function randomSeed() {
  return Number(process.hrtime.bigint() & 0xffffffffn);
}

let THREE = null;
let renderer = null;
let device = null;
let readBuffer = null;
let bytesPerRow = 0;
let bufferSize = 0;

let gameLoaded = false;

async function ensureRenderer() {
  if (renderer) return;
  THREE = await import('three/webgpu');

  const canvas = createFakeCanvas();
  renderer = new THREE.WebGPURenderer({ canvas });
  renderer.setSize(WIDTH, HEIGHT);
  await renderer.init();
}

async function loadGame(gamePath) {
  if (gameLoaded) return;
  await ensureRenderer();

  // Make mulberry32 available as a global for games that reference it
  // without defining it locally.
  globalThis.mulberry32 = mulberry32;

  // Many generated games read globalThis.renderer / globalThis.THREE inside
  // their render() function instead of capturing them from setup() args.
  // Pre-populate so those games work without modification.
  globalThis.renderer = renderer;
  globalThis.THREE = THREE;

  const code = readFileSync(gamePath, 'utf8');
  vm.runInThisContext(code, { filename: gamePath });

  for (const fn of ['setup', 'update', 'render', 'resetGame', 'getGameState']) {
    if (typeof globalThis[fn] !== 'function') {
      throw new Error(`Game ${gamePath} missing required function: ${fn}()`);
    }
  }

  globalThis.setup({ THREE, renderer, width: WIDTH, height: HEIGHT });

  gameLoaded = true;
}

async function ensureReadBuffer() {
  if (readBuffer) return;
  // Trigger Three.js's first render so context.configure() fires and the
  // device + render texture become available.
  globalThis.currentAction = 0;
  globalThis.render();
  device = getRenderDevice();
  if (!device) throw new Error('Three.js never called context.configure() — game render() likely missing or broken');
  await device.queue.onSubmittedWorkDone();

  bytesPerRow = Math.ceil((WIDTH * 4) / 256) * 256;
  bufferSize = bytesPerRow * HEIGHT;
  readBuffer = device.createBuffer({
    size: bufferSize,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
}

async function readPixelsRGB() {
  // Copy current swap-chain texture into a buffer, map it, slice out RGB
  // (Dawn returns BGRA on macOS Metal — swap to RGB).
  const tex = fakeContext.getCurrentTexture();
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex }, { buffer: readBuffer, bytesPerRow }, [WIDTH, HEIGHT]);
  device.queue.submit([enc.finish()]);
  await readBuffer.mapAsync(GPUMapMode.READ);

  const bgra = new Uint8Array(readBuffer.getMappedRange());
  // Output: tightly packed WIDTH * HEIGHT * 3 RGB
  const out = new Uint8Array(WIDTH * HEIGHT * 3);
  let o = 0;
  for (let y = 0; y < HEIGHT; y++) {
    const row = y * bytesPerRow;
    for (let x = 0; x < WIDTH; x++) {
      const i = row + x * 4;
      out[o++] = bgra[i + 2]; // R
      out[o++] = bgra[i + 1]; // G
      out[o++] = bgra[i + 0]; // B
    }
  }
  readBuffer.unmap();
  return out;
}

export class ThreeGameEnv {
  constructor({ gamePath, obsWidth = WIDTH, obsHeight = HEIGHT, maxSteps = 2000 } = {}) {
    if (!gamePath) throw new Error('gamePath is required');
    if (obsWidth !== WIDTH || obsHeight !== HEIGHT) {
      // The shim is sized via NODE_GYM_THREE_OBS_SIZE env var at startup;
      // if a different size is requested at runtime, that's a contract bug.
      throw new Error(
        `ThreeGameEnv obsWidth/obsHeight (${obsWidth}x${obsHeight}) must match shim WIDTH/HEIGHT (${WIDTH}x${HEIGHT}). ` +
        `Set NODE_GYM_THREE_OBS_SIZE before launching the worker.`
      );
    }
    this.gamePath = gamePath;
    this.obsWidth = WIDTH;
    this.obsHeight = HEIGHT;
    this.maxSteps = maxSteps;
    this.steps = 0;
    this.episodeReturn = 0;
    this.lastScore = 0;
    this.seed = null;
    this._loaded = false;
  }

  static getActionMeanings() {
    // Discrete(15) — matches THREE_GAME_TEMPLATE.md / ProcGen
    return [
      'NOOP', 'LEFT', 'RIGHT', 'UP', 'DOWN',
      'UP+LEFT', 'UP+RIGHT', 'DOWN+LEFT', 'DOWN+RIGHT',
      'A', 'B',
      'LEFT+A', 'RIGHT+A', 'UP+A', 'DOWN+A',
    ];
  }

  async _ensure() {
    if (!this._loaded) {
      await loadGame(this.gamePath);
      await ensureReadBuffer();
      this._loaded = true;
    }
  }

  _getState() {
    return globalThis.getGameState();
  }

  _buildInfo() {
    const state = this._getState();
    return {
      score: state.score,
      lives: state.lives,
      gameState: state.gameState,
      episodeReturn: this.episodeReturn,
      episodeLength: this.steps,
      seed: this.seed,
      actionMeanings: ThreeGameEnv.getActionMeanings(),
    };
  }

  async reset({ seed = undefined, maxSteps = undefined } = {}) {
    await this._ensure();
    if (maxSteps !== undefined) this.maxSteps = maxSteps;
    this.seed = (seed ?? randomSeed()) >>> 0;
    this.steps = 0;
    this.episodeReturn = 0;

    // Seed Math.random for the game's procgen.
    Math.random = mulberry32(this.seed);

    globalThis.currentAction = 0;
    globalThis.resetGame(this.seed);
    // Render once so the first frame's pixels are ready.
    globalThis.render();
    await device.queue.onSubmittedWorkDone();

    const state = this._getState();
    this.lastScore = state.score;

    const observation = await readPixelsRGB();
    return { observation, info: this._buildInfo() };
  }

  async step(actionIndex) {
    await this._ensure();
    globalThis.currentAction = actionIndex | 0;
    try {
      globalThis.update(FIXED_DT);
      globalThis.render();
    } catch (e) {
      throw new Error(`Game update/render threw: ${e.message}`);
    }
    await device.queue.onSubmittedWorkDone();

    const state = this._getState();
    const reward = state.score - this.lastScore;
    this.lastScore = state.score;
    this.steps += 1;
    this.episodeReturn += reward;

    const terminated = TERMINAL_STATES.has(state.gameState);
    const truncated = !terminated && this.steps >= this.maxSteps;

    const observation = await readPixelsRGB();
    return { observation, reward, terminated, truncated, info: this._buildInfo() };
  }

  close() {
    Math.random = ORIGINAL_MATH_RANDOM;
    if (readBuffer) { readBuffer.destroy(); readBuffer = null; }
    if (renderer) { renderer.dispose(); renderer = null; }
  }
}
