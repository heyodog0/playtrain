import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

import {
  installGlobals,
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
  constructor({ gamePath, obsWidth = 64, obsHeight = 64, obsMode = 'rgb', maxSteps = 2000, needsMatter = false } = {}) {
    if (!gamePath) throw new Error('gamePath is required');
    if (!gameLoaded) loadGame(gamePath, needsMatter);

    this.obsWidth = obsWidth;
    this.obsHeight = obsHeight;
    this.obsMode = obsMode;
    this.maxSteps = maxSteps;
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
    tick();

    const state = this._getState();
    const reward = state.score - this.lastScore;
    this.lastScore = state.score;
    this.steps += 1;
    this.episodeReturn += reward;

    const terminated = TERMINAL_STATES.has(state.gameState);
    const truncated = !terminated && this.steps >= this.maxSteps;

    return {
      observation: this._getObservation(),
      reward,
      terminated,
      truncated,
      info: this._buildInfo(),
    };
  }

  close() {
    setKeysDown([]);
    Math.random = ORIGINAL_MATH_RANDOM;
  }
}
