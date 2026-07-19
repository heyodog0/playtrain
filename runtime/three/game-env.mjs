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
import { pathToFileURL } from 'url';
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

// Opt-in async (pipelined) readback: returns the PREVIOUS frame's pixels so the
// GPU map-stall overlaps the next frame's work. Observations are 1 step stale —
// a deliberate latency-for-throughput trade. Off by default (fresh obs).
const ASYNC_OBS = process.env.NODE_GYM_ASYNC_OBS === '1';
let readBufferB = null;     // second buffer for the 2-deep ping-pong
let inflight = null;        // { buf, map } pending from the previous step

let gameLoaded = false;

// Optional per-phase timing (set NODE_GYM_DMLAB_TIMING=1). Accumulates ns spent
// in update / render / readback so a bench can attribute the gap vs IPC.
const TIMING = process.env.NODE_GYM_DMLAB_TIMING === '1';
let _tUpdate = 0, _tRender = 0, _tReadback = 0, _tCount = 0;
let _tMap = 0, _tConvert = 0; // readback sub-phases: GPU map-stall vs CPU convert

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

  const REQUIRED = ['setup', 'update', 'render', 'resetGame', 'getGameState'];

  if (gamePath.endsWith('.mjs')) {
    // Modular games (e.g. the dmlab engine): load as a native ES module so the
    // game file can `import` engine modules. We copy its exports onto globalThis
    // so the rest of the env (which calls globalThis.setup/update/...) is
    // unchanged. THREE/renderer/currentAction are read from globalThis as usual.
    const mod = await import(pathToFileURL(gamePath).href);
    for (const fn of REQUIRED) {
      if (typeof mod[fn] !== 'function') {
        throw new Error(`Game ${gamePath} missing required export: ${fn}()`);
      }
      globalThis[fn] = mod[fn];
    }
  } else {
    // Single-file games: run in this context; they define the functions as globals.
    const code = readFileSync(gamePath, 'utf8');
    vm.runInThisContext(code, { filename: gamePath });
    for (const fn of REQUIRED) {
      if (typeof globalThis[fn] !== 'function') {
        throw new Error(`Game ${gamePath} missing required function: ${fn}()`);
      }
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
  if (ASYNC_OBS) {
    readBufferB = device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }
}

const _rgbOut = new Uint8Array(WIDTH * HEIGHT * 3); // reused across steps (no per-step alloc)

function submitCopy(buf) {
  const tex = fakeContext.getCurrentTexture();
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow }, [WIDTH, HEIGHT]);
  device.queue.submit([enc.finish()]);
}

// Convert a mapped read buffer (BGRA, padded rows) into packed RGB in _rgbOut.
function convert(buf, doUnmap = true) {
  const bgra = new Uint8Array(buf.getMappedRange());
  const out = _rgbOut;
  const noPad = bytesPerRow === WIDTH * 4;
  let o = 0;
  for (let y = 0; y < HEIGHT; y++) {
    let i = noPad ? y * WIDTH * 4 : y * bytesPerRow;
    for (let x = 0; x < WIDTH; x++) {
      out[o] = bgra[i + 2]; out[o + 1] = bgra[i + 1]; out[o + 2] = bgra[i];
      o += 3; i += 4;
    }
  }
  if (doUnmap) buf.unmap();
  return out;
}

// Synchronous, fresh: copy + map + convert the current frame (default).
async function readPixelsRGB() {
  submitCopy(readBuffer);
  const m0 = TIMING ? performance.now() : 0;
  await readBuffer.mapAsync(GPUMapMode.READ);
  if (TIMING) _tMap += performance.now() - m0;
  const c0 = TIMING ? performance.now() : 0;
  const out = convert(readBuffer);
  if (TIMING) _tConvert += performance.now() - c0;
  return out;
}

// Async prime (reset): read the current frame fresh for the reset return, then
// queue a SECOND copy of it into the other buffer as the pipeline's `inflight`
// (so step 1 returns this frame, stale by 1). Two reads here keep the per-buffer
// getMappedRange single-use; reset is infrequent so the extra read is cheap.
async function readPixelsPrime() {
  if (inflight) { try { await inflight.map; inflight.buf.unmap(); } catch (e) {} inflight = null; }
  submitCopy(readBuffer);
  await readBuffer.mapAsync(GPUMapMode.READ);
  const obs = convert(readBuffer, /*doUnmap=*/true);  // fresh frame for the reset return
  submitCopy(readBufferB);
  const map = readBufferB.mapAsync(GPUMapMode.READ);
  inflight = { buf: readBufferB, map };
  return obs;
}

// Async step: submit the current frame into the free buffer, return the
// PREVIOUS frame's pixels (1-step stale). The await is cheap because the
// previous frame's copy finished while this frame's work was queued.
async function readPixelsAsyncStep() {
  const buf = inflight.buf === readBuffer ? readBufferB : readBuffer;
  submitCopy(buf);
  const map = buf.mapAsync(GPUMapMode.READ);
  const m0 = TIMING ? performance.now() : 0;
  await inflight.map;
  if (TIMING) _tMap += performance.now() - m0;
  const c0 = TIMING ? performance.now() : 0;
  const out = convert(inflight.buf);  // previous frame; unmaps it
  if (TIMING) _tConvert += performance.now() - c0;
  inflight = { buf, map };
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
    // Render once so the first frame's pixels are ready. (No explicit
    // GPU wait — readPixelsRGB below mapAsync's, which waits for us.)
    globalThis.render();

    const state = this._getState();
    this.lastScore = state.score;

    // Async mode flushes the pipeline and primes a fresh frame (no stale carry
    // over episode boundaries).
    const observation = ASYNC_OBS ? await readPixelsPrime() : await readPixelsRGB();
    return { observation, info: this._buildInfo() };
  }

  async step(actionIndex, numSteps = 1) {
    await this._ensure();
    // Support both a scalar discrete action (default Discrete(15) games) and a
    // vector action (games with a custom action space, e.g. the dmlab engine's
    // 7-value DeepMind-Lab-style spec). Arrays are passed through unchanged.
    globalThis.currentAction = Array.isArray(actionIndex) ? actionIndex : (actionIndex | 0);

    const k = numSteps > 0 ? (numSteps | 0) : 1;
    let reward = 0;
    let terminated = false;
    let truncated = false;
    try {
      // Action-repeat / frame-skip: advance the simulation K frames holding the
      // same action. Intermediate frames are never observed, so we render only
      // the final frame — K updates, ONE render, ONE readback. This amortizes
      // the (dominant) GPU readback across the action-repeat, matching how DM
      // Lab's num_steps batches frames.
      for (let i = 0; i < k; i++) {
        const a = TIMING ? performance.now() : 0;
        globalThis.update(FIXED_DT);
        if (TIMING) _tUpdate += performance.now() - a;

        const state = this._getState();
        reward += state.score - this.lastScore;
        this.lastScore = state.score;
        this.steps += 1;
        if (TERMINAL_STATES.has(state.gameState)) { terminated = true; break; }
        if (this.steps >= this.maxSteps) { truncated = true; break; }
      }
      const r0 = TIMING ? performance.now() : 0;
      globalThis.render();
      if (TIMING) { _tRender += performance.now() - r0; _tCount += 1; }
    } catch (e) {
      throw new Error(`Game update/render threw: ${e.message}`);
    }
    // NOTE: don't await device.queue.onSubmittedWorkDone() here — readPixelsRGB
    // below calls mapAsync, which already waits for all prior GPU work.

    this.episodeReturn += reward;

    const readback = ASYNC_OBS ? readPixelsAsyncStep : readPixelsRGB;
    let observation;
    if (TIMING) {
      const a = performance.now();
      observation = await readback();
      _tReadback += performance.now() - a;
    } else {
      observation = await readback();
    }
    return { observation, reward, terminated, truncated, info: this._buildInfo() };
  }

  close() {
    if (TIMING && _tCount > 0) {
      process.stderr.write('__DMLAB_TIMING ' + JSON.stringify({
        count: _tCount,
        update_ms: _tUpdate / _tCount,
        render_ms: _tRender / _tCount,
        readback_ms: _tReadback / _tCount,
        readback_map_ms: _tMap / _tCount,
        readback_convert_ms: _tConvert / _tCount,
      }) + '\n');
    }
    Math.random = ORIGINAL_MATH_RANDOM;
    if (readBuffer) { readBuffer.destroy(); readBuffer = null; }
    if (renderer) { renderer.dispose(); renderer = null; }
  }
}
