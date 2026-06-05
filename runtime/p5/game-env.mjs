import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

import {
  installGlobals,
  setRasterRes,
  setKeysDown,
  simulateKeyPress,
  tick,
  getPixelData,
  getObsBuffer,
} from './p5-shim.mjs';
import {
  preprocessObservationFromRGBA,
  preprocessObservationRGB,
  bgraBufferToRGB,
} from './obs.mjs';

const FAST_OBS = process.env.NODE_GYM_P5_FAST_OBS !== '0';
const PROFILE = process.env.NODE_GYM_P5_PROFILE === '1';

// Per-phase wall-clock accumulators (BigInt nanoseconds). Only written when
// PROFILE is on. Summary is printed on env.close() to stderr.
export const _profileTimings = {
  draw: 0n,       // tick() — game's draw() function
  downsample: 0n, // getObsBuffer — drawImage + toBuffer (or full getImageData on slow path)
  swap: 0n,       // BGRA->RGB swap (fast path) or JS nearest-neighbor resample (slow path)
  info: 0n,       // _getState + reward math + _buildInfo
  n: 0,
};
const _hrtime = process.hrtime.bigint;

const __dirname = dirname(fileURLToPath(import.meta.url));
const TERMINAL_STATES = new Set(['WIN', 'EXIT', 'GAMEOVER']);
const ORIGINAL_MATH_RANDOM = Math.random;

// GAME_TEMPLATE.md action mapping:
// 0=NOOP, 1=LEFT, 2=RIGHT, 3=UP, 4=DOWN, 5=D(SPACE), 6=LEFT+D, 7=RIGHT+D
const ACTIONS = [
  { name: 'NOOP',    held: [],   press: null },
  { name: 'LEFT',    held: [37], press: null },
  { name: 'RIGHT',   held: [39], press: null },
  { name: 'UP',      held: [38], press: null },
  { name: 'DOWN',    held: [40], press: null },
  { name: 'D',       held: [],   press: 32 },
  { name: 'LEFT_D',  held: [37], press: 32 },
  { name: 'RIGHT_D', held: [39], press: 32 },
];

let globalsInstalled = false;
let gameLoaded = false;

function randomSeed() {
  return Number(process.hrtime.bigint() & 0xffffffffn);
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let n = Math.imul(t ^ (t >>> 15), t | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

function loadGame(gamePath, needsMatter) {
  if (!globalsInstalled) {
    installGlobals();
    globalsInstalled = true;
  }

  if (needsMatter) {
    try {
      const matterPath = join(__dirname, '..', '..', 'node_modules', 'matter-js', 'build', 'matter.js');
      const matterCode = readFileSync(matterPath, 'utf8');
      vm.runInThisContext(matterCode, { filename: 'matter.js' });
    } catch (err) {
      throw new Error(`Failed to load Matter.js: ${err.message}. Run: npm install matter-js`);
    }
  }

  const gameCode = readFileSync(gamePath, 'utf8');
  vm.runInThisContext(gameCode, { filename: gamePath });

  // Verify the game exports the required interface
  if (typeof globalThis.setup !== 'function') {
    throw new Error(`Game ${gamePath} missing setup()`);
  }
  if (typeof globalThis.resetGame !== 'function') {
    throw new Error(`Game ${gamePath} missing resetGame(seed)`);
  }
  if (typeof globalThis.getGameState !== 'function') {
    throw new Error(`Game ${gamePath} missing getGameState()`);
  }

  // Initial setup: setup() creates the canvas, resetGame() initializes game objects
  globalThis.setup();
  globalThis.resetGame(0);
  tick();
  gameLoaded = true;
}

export class GameEnv {
  constructor({ gamePath, obsWidth = 64, obsHeight = 64, obsMode = 'rgb', maxSteps = 2000, needsMatter = false, frameSkip = 1 } = {}) {
    if (!gamePath) throw new Error('gamePath is required');
    // Render directly at obs resolution (our rasterizer's big speedup). Must run BEFORE
    // loadGame, which executes the game's setup()/createCanvas. No-op for the cairo backend.
    if (!gameLoaded) { setRasterRes(obsWidth); loadGame(gamePath, needsMatter); }

    this.obsWidth = obsWidth;
    this.obsHeight = obsHeight;
    this.obsMode = obsMode;
    this.maxSteps = maxSteps;
    // Action-repeat: run `frameSkip` game ticks per env.step(), holding the
    // same action across all of them and returning ONE decision. Reward is the
    // summed score delta over the skip (computed once from lastScore, so it is
    // automatically the sum). `steps`/`maxSteps` count FRAMES, so a budget and
    // any per-frame penalties stay calibrated. frameSkip=1 == original behavior.
    this.frameSkip = Math.max(1, frameSkip | 0);
    this.steps = 0;
    this.episodeReturn = 0;
    this.lastScore = 0;
    this.seed = null;
  }

  static getActionMeanings() {
    return ACTIONS.map((a) => a.name);
  }

  _setSeed(seed) {
    this.seed = seed >>> 0;
    const rng = mulberry32(this.seed);
    Math.random = () => rng();
  }

  _getState() {
    return globalThis.getGameState();
  }

  _getObservation() {
    if (FAST_OBS && this.obsMode === 'rgb') {
      const buf = getObsBuffer(this.obsWidth, this.obsHeight);
      return bgraBufferToRGB(buf, this.obsWidth, this.obsHeight);
    }
    const frame = getPixelData();
    if (this.obsMode === 'rgb') {
      return preprocessObservationRGB(frame.data, frame.width, frame.height, this.obsWidth, this.obsHeight);
    }
    return preprocessObservationFromRGBA(frame.data, frame.width, frame.height, this.obsWidth, this.obsHeight);
  }

  // Profile-instrumented variant of _getObservation: splits downsample vs swap.
  _getObservationProfiled() {
    if (FAST_OBS && this.obsMode === 'rgb') {
      const tA = _hrtime();
      const buf = getObsBuffer(this.obsWidth, this.obsHeight);
      const tB = _hrtime();
      const obs = bgraBufferToRGB(buf, this.obsWidth, this.obsHeight);
      const tC = _hrtime();
      _profileTimings.downsample += tB - tA;
      _profileTimings.swap += tC - tB;
      return obs;
    }
    // Slow path: getImageData is the "downsample" cost (full-canvas readback);
    // preprocess* is the "swap" cost (resample + repack).
    const tA = _hrtime();
    const frame = getPixelData();
    const tB = _hrtime();
    const obs = this.obsMode === 'rgb'
      ? preprocessObservationRGB(frame.data, frame.width, frame.height, this.obsWidth, this.obsHeight)
      : preprocessObservationFromRGBA(frame.data, frame.width, frame.height, this.obsWidth, this.obsHeight);
    const tC = _hrtime();
    _profileTimings.downsample += tB - tA;
    _profileTimings.swap += tC - tB;
    return obs;
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
      actionMeanings: GameEnv.getActionMeanings(),
    };
  }

  reset({ seed = undefined, maxSteps = undefined } = {}) {
    if (maxSteps !== undefined) this.maxSteps = maxSteps;
    this._setSeed(seed ?? randomSeed());
    this.steps = 0;
    this.episodeReturn = 0;

    setKeysDown([]);
    globalThis.resetGame(this.seed);
    tick();

    const state = this._getState();
    this.lastScore = state.score;

    return {
      observation: this._getObservation(),
      info: this._buildInfo(),
    };
  }

  step(actionIndex) {
    const action = ACTIONS[actionIndex] ?? ACTIONS[0];
    setKeysDown(action.held);
    if (action.press !== null) simulateKeyPress(action.press);

    if (!PROFILE) {
      let state, terminated = false, truncated = false;
      for (let i = 0; i < this.frameSkip; i++) {
        tick();
        this.steps += 1;
        state = this._getState();
        terminated = TERMINAL_STATES.has(state.gameState);
        truncated = !terminated && this.steps >= this.maxSteps;
        if (terminated || truncated) break;  // stop ticking a finished episode
      }
      const reward = state.score - this.lastScore;  // summed delta over the skip
      this.lastScore = state.score;
      this.episodeReturn += reward;
      return {
        observation: this._getObservation(),
        reward,
        terminated,
        truncated,
        info: this._buildInfo(),
      };
    }

    const t0 = _hrtime();
    let state, terminated = false, truncated = false;
    for (let i = 0; i < this.frameSkip; i++) {
      tick();
      this.steps += 1;
      state = this._getState();
      terminated = TERMINAL_STATES.has(state.gameState);
      truncated = !terminated && this.steps >= this.maxSteps;
      if (terminated || truncated) break;
    }
    const t1 = _hrtime();
    const observation = this._getObservationProfiled();
    const t2 = _hrtime();
    const reward = state.score - this.lastScore;  // summed delta over the skip
    this.lastScore = state.score;
    this.episodeReturn += reward;
    const info = this._buildInfo();
    const t3 = _hrtime();
    _profileTimings.draw += t1 - t0;
    _profileTimings.info += t3 - t2;
    _profileTimings.n += 1;

    return { observation, reward, terminated, truncated, info };
  }

  close() {
    setKeysDown([]);
    Math.random = ORIGINAL_MATH_RANDOM;
  }
}
