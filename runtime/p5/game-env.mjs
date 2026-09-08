import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

import {
  installGlobals,
  setRasterRes,
  setKeysDown,
  simulateKeyPress,
  setPointerPos,
  setButtons,
  setAxes,
  resetPointer,
  tick,
  resetFrameCount,
  getPixelData,
  getObsBuffer,
} from './p5-shim.mjs';
import {
  preprocessObservationFromRGBA,
  preprocessObservationRGB,
  bgraBufferToRGB,
} from './obs.mjs';

const FAST_OBS = process.env.PLAYTRAIN_P5_FAST_OBS !== '0';
const PROFILE = process.env.PLAYTRAIN_P5_PROFILE === '1';

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

// Discrete action spaces live in runtime/action_spaces.json — one declarative
// spec shared with the native hosts (native/qjs/action_table.hpp) and the
// human-study harness (study/study-templates.mjs). The default is default8
// (GAME_TEMPLATE.md: 0=NOOP, 1=LEFT, 2=RIGHT, 3=UP, 4=DOWN, 5=D(SPACE),
// 6=LEFT+D, 7=RIGHT+D), whose indices are frozen — recorded trajectories and
// the native gate's golden traces depend on the exact mapping.
const ACTION_SPACES = JSON.parse(
  readFileSync(join(__dirname, '..', 'action_spaces.json'), 'utf8'));
const DEFAULT_ACTIONS = ACTION_SPACES.default8;

// Resolve a space given as a named entry in action_spaces.json, a path to a
// JSON file holding one action array, an inline JSON array string (how
// env.py's --action-space passes a custom list), or the array itself.
export function resolveActionSpace(spec) {
  if (spec == null) return DEFAULT_ACTIONS;
  if (Array.isArray(spec)) return spec;
  if (typeof spec === 'string') {
    if (spec.trimStart().startsWith('[')) return JSON.parse(spec);
    if (spec.endsWith('.json')) return JSON.parse(readFileSync(spec, 'utf8'));
    if (ACTION_SPACES[spec]) return ACTION_SPACES[spec];
    throw new Error(`unknown action space '${spec}' (not in action_spaces.json, not a .json path)`);
  }
  throw new Error(`invalid action space spec: ${spec}`);
}

// Resolve a box-space channel list: a named box entry in action_spaces.json,
// an inline JSON array string, or the array itself.
export function resolveInputMap(spec) {
  if (spec == null) return null;
  if (Array.isArray(spec)) return spec;
  if (typeof spec === 'string') {
    if (spec.trimStart().startsWith('[')) return JSON.parse(spec);
    const named = ACTION_SPACES[spec];
    if (named && named.type === 'box') return named.channels;
    throw new Error(`unknown box space '${spec}'`);
  }
  throw new Error(`invalid input map spec: ${spec}`);
}

// The wire quantization (see action_spaces.json "//"): producers only.
const quantize = (v01) => Math.floor(Math.min(1, Math.max(0, v01)) * 65535 + 0.5);
const BUTTON_BITS = { mouse: 1 };
const Q_CENTER = quantize(0.5);

// Pre-resolve one discrete action's analog fields into wire values.
function analogOf(a) {
  // Pointer is LATCHED (only actions carrying one move it); buttons and axes
  // are ABSOLUTE per step — axes snap back to center unless the action sets
  // them, like a physical stick. Mirrors ActionTable::frameFor exactly.
  const out = {
    hasPointer: false, qx: 0, qy: 0, buttons: 0,
    qaxes: [Q_CENTER, Q_CENTER, Q_CENTER, Q_CENTER],
  };
  if (a.pointer) {
    out.hasPointer = true;
    out.qx = quantize(a.pointer[0]);
    out.qy = quantize(a.pointer[1]);
  }
  for (const b of a.buttons || []) out.buttons |= BUTTON_BITS[b] || 0;
  (a.axes || []).forEach((v, j) => { out.qaxes[j] = quantize((v + 1) / 2); });
  return out;
}

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
  constructor({ gamePath, obsWidth = 64, obsHeight = 64, obsMode = 'rgb', maxSteps = 2000, needsMatter = false, frameSkip = 1, actions = null, inputMap = null } = {}) {
    if (!gamePath) throw new Error('gamePath is required');
    // Per-instance discrete action space (name / path / array; see
    // resolveActionSpace). Default: the frozen default8 mapping.
    this.actions = resolveActionSpace(actions);
    // Pre-resolved analog fields (pointer/buttons/axes) per action; null when
    // the table is pure-keyboard so the default path pays nothing.
    this._analog = this.actions.some((a) => a.pointer || a.buttons || a.axes)
      ? this.actions.map(analogOf) : null;
    // Box mode: a channel list (see resolveInputMap); stepQ() replaces step().
    this.inputMap = resolveInputMap(inputMap);
    this._chan = this.inputMap ? this.inputMap.map((ch) => {
      if (ch === 'pointer_x') return { kind: 'px' };
      if (ch === 'pointer_y') return { kind: 'py' };
      if (ch.startsWith('button:')) {
        const bit = BUTTON_BITS[ch.slice(7)];
        if (!bit) throw new Error(`unknown button channel '${ch}'`);
        return { kind: 'button', arg: bit };
      }
      if (ch.startsWith('axis:')) return { kind: 'axis', arg: parseInt(ch.slice(5), 10) };
      if (ch.startsWith('key:')) return { kind: 'key', arg: parseInt(ch.slice(4), 10) };
      throw new Error(`unknown channel '${ch}'`);
    }) : null;
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
    return DEFAULT_ACTIONS.map((a) => a.name);
  }

  actionMeanings() {
    return this.actions.map((a) => a.name);
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
      actionMeanings: this.actionMeanings(),
    };
  }

  reset({ seed = undefined, maxSteps = undefined } = {}) {
    if (maxSteps !== undefined) this.maxSteps = maxSteps;
    this._setSeed(seed ?? randomSeed());
    this.steps = 0;
    this.episodeReturn = 0;

    setKeysDown([]);
    resetPointer();     // pointer/axes park at rest, like the cleared keys
    resetFrameCount();  // per-episode frame phase: make reset(seed) deterministic
    globalThis.resetGame(this.seed);
    tick();

    const state = this._getState();
    this.lastScore = state.score;

    return {
      observation: this._getObservation(),
      info: this._buildInfo(),
    };
  }

  // Tick loop shared by step() (non-profile) and stepQ(); the input frame has
  // already been applied.
  _tickLoop() {
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

  step(actionIndex) {
    const action = this.actions[actionIndex] ?? this.actions[0];
    setKeysDown(action.held);
    if (action.press !== null) simulateKeyPress(action.press);
    if (this._analog) {
      // Pointer/axes are latched (only actions carrying them move them);
      // buttons are absolute per step. Mirrors env_apply_frame in the hosts.
      const an = this._analog[actionIndex] ?? this._analog[0];
      if (an.hasPointer) setPointerPos(an.qx, an.qy);
      setButtons(an.buttons);
      setAxes(an.qaxes);
    }

    if (!PROFILE) return this._tickLoop();
    return this._stepProfiled();
  }

  // Box path: qvals are uint16 wire values, one per inputMap channel; every
  // channel is absolute each step. Mirrors InputMap::frameFor in the hosts.
  stepQ(qvals) {
    if (!this._chan) throw new Error('stepQ requires an inputMap');
    const keys = [];
    let qx = 0, qy = 0, hasPtr = false, buttons = 0, hasAxes = false;
    const qaxes = [Q_CENTER, Q_CENTER, Q_CENTER, Q_CENTER];
    this._chan.forEach((c, i) => {
      const q = qvals[i];
      if (c.kind === 'px') { qx = q; hasPtr = true; }
      else if (c.kind === 'py') { qy = q; hasPtr = true; }
      else if (c.kind === 'button') { if (q >= 32768) buttons |= c.arg; }
      else if (c.kind === 'axis') { qaxes[c.arg] = q; hasAxes = true; }
      else if (c.kind === 'key') { if (q >= 32768) keys.push(c.arg); }
    });
    setKeysDown(keys);
    if (hasPtr) setPointerPos(qx, qy);
    setButtons(buttons);
    if (hasAxes) setAxes(qaxes);
    return this._tickLoop();
  }

  _stepProfiled() {

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
