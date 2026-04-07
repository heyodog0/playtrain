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
} from '../poc/p5/p5-shim.mjs';
import { preprocessObservationFromRGBA } from '../poc/p5/obs.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_PATH = join(__dirname, '..', 'poc', 'p5', 'kazuki_game.js');
const TERMINAL_STATES = new Set(['WIN', 'EXIT', 'GAMEOVER']);
const ORIGINAL_MATH_RANDOM = Math.random;

const ACTIONS = [
  { name: 'NOOP', held: [], press: null },
  { name: 'LEFT', held: [37], press: null },
  { name: 'RIGHT', held: [39], press: null },
  { name: 'JUMP', held: [], press: 38 },
  { name: 'LEFT_JUMP', held: [37], press: 38 },
  { name: 'RIGHT_JUMP', held: [39], press: 38 },
  { name: 'UP', held: [38], press: null },
  { name: 'DOWN', held: [40], press: null },
];

let globalsInstalled = false;
let gameLoaded = false;

function randomSeed() {
  return Number(process.hrtime.bigint() & 0xffffffffn);
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let n = Math.imul(t ^ (t >>> 15), t | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

function ensureRuntimeLoaded() {
  if (!globalsInstalled) {
    installGlobals();
    globalsInstalled = true;
  }

  if (!gameLoaded) {
    let gameCode = readFileSync(GAME_PATH, 'utf8');
    gameCode += `
globalThis.getGameState = () => ({ gameState, score, lives, player, inventory, currentRoom });
globalThis.setGameState = (s) => { gameState = s; };
`;
    vm.runInThisContext(gameCode, { filename: GAME_PATH });
    globalThis.setup();
    tick();
    gameLoaded = true;
  }
}

export class KazukiEnv {
  constructor({ obsWidth = 84, obsHeight = 84, maxSteps = 2000 } = {}) {
    ensureRuntimeLoaded();
    this.obsWidth = obsWidth;
    this.obsHeight = obsHeight;
    this.maxSteps = maxSteps;
    this.steps = 0;
    this.episodeReturn = 0;
    this.lastScore = 0;
    this.seed = null;
  }

  static getActionMeanings() {
    return ACTIONS.map((action) => action.name);
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
    const frame = getPixelData();
    return preprocessObservationFromRGBA(frame.data, frame.width, frame.height, this.obsWidth, this.obsHeight);
  }

  _buildInfo() {
    const state = this._getState();
    return {
      score: state.score,
      lives: state.lives,
      gameState: state.gameState,
      currentRoom: state.currentRoom,
      episodeReturn: this.episodeReturn,
      episodeLength: this.steps,
      seed: this.seed,
      actionMeanings: KazukiEnv.getActionMeanings(),
    };
  }

  reset({ seed = undefined, maxSteps = undefined } = {}) {
    if (maxSteps !== undefined) this.maxSteps = maxSteps;
    this._setSeed(seed ?? randomSeed());
    this.steps = 0;
    this.episodeReturn = 0;

    setKeysDown([]);
    const currentState = this._getState();
    if (currentState.gameState !== 'START') {
      globalThis.setGameState('GAMEOVER');
    }

    simulateKeyPress(13);
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
