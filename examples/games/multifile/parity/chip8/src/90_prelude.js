// ---- PlayTrain contract: setup / resetGame / draw / getGameState ----
// The bundle defines, before the sources:
//   C8_GAME_DEF : the games/<game>.json object (rom, action_set, startup, score, terminated, human)
//   C8_ROM_B64  : the ROM bytes, base64
// One draw() = one Octax env step (44 instructions). Observation = the display after the step,
// drawn with drawTiles as a 64x32 grid of two colours (Octax's `classic` scheme) letterboxed in a
// square canvas; at 64x64 observation resolution every CHIP-8 pixel is exactly one pixel.
// Octax's 4-frame stack and 8x scaling are not matched (manifest.json reference.not_matched).

// CHIP-8 keypad hex digit -> browser keyCode, conventional layout
//   1 2 3 C      1 2 3 4
//   4 5 6 D  ->  Q W E R
//   7 8 9 E      A S D F
//   A 0 B F      Z X C V
const C8_KEYCODES = [88, 49, 50, 51, 81, 87, 69, 65, 83, 68, 90, 67, 52, 82, 70, 86];
const C8_KEYNAMES = ['X', '1', '2', '3', 'Q', 'W', 'E', 'A', 'S', 'D', 'Z', 'C', '4', 'R', 'F', 'V'];

const C8_CANVAS = 256;                       // square; the display band is 256 x 128, centred
const C8_ON = [0, 255, 0], C8_OFF = [0, 0, 0];   // rendering.py create_color_scheme('classic')

// Integer-only base64 decoder (QuickJS has no atob).
const C8_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function c8B64Decode(s) {
  const lut = new Int16Array(128).fill(-1);
  for (let i = 0; i < 64; i++) lut[C8_B64.charCodeAt(i)] = i;
  let n = s.length; while (n > 0 && s.charCodeAt(n - 1) === 61) n--;      // '='
  const out = new Uint8Array(Math.floor(n * 3 / 4));
  let acc = 0, bits = 0, k = 0;
  for (let i = 0; i < n; i++) {
    const v = lut[s.charCodeAt(i)]; if (v < 0) continue;
    acc = ((acc << 6) | v) & 0xFFFFFF; bits += 6;
    if (bits >= 8) { bits -= 8; out[k++] = (acc >> bits) & 0xFF; }
  }
  return out.subarray(0, k);
}

let score = 0, lives = 1, gameState = 'PLAYING';
let c8Env = null;
const c8Kinds = new Uint16Array(C8_W * C8_H);
const c8Palette = new Uint8Array([C8_OFF[0], C8_OFF[1], C8_OFF[2], 255, C8_ON[0], C8_ON[1], C8_ON[2], 255]);

function c8Prepare() {
  if (c8Env) return;
  c8Env = c8EnvCreate(C8_GAME_DEF, c8B64Decode(C8_ROM_B64));
}

function setup() { c8Prepare(); createCanvas(C8_CANVAS, C8_CANVAS); }

function resetGame(seed) {
  c8Prepare();
  c8EnvReset(c8Env, seed >>> 0);
  score = c8Env.score; lives = 1; gameState = 'PLAYING';
}

// The action for this frame: the first held key in action_set order, else NOOP.
// Octax presses exactly one key per step; a human holding two gets the lower action index.
function c8ActionFromKeys() {
  const set = c8Env.actionSet;
  for (let i = 0; i < set.length; i++) if (keyIsDown(C8_KEYCODES[set[i]])) return i;
  return c8Env.noop;
}

function c8Render() {
  background(C8_OFF[0], C8_OFF[1], C8_OFF[2]);
  const d = c8Env.cpu.display;
  for (let x = 0; x < C8_W; x++) { const o = x * C8_H; for (let y = 0; y < C8_H; y++) c8Kinds[y * C8_W + x] = d[o + y]; }
  drawTiles(c8Kinds, C8_W, C8_H, c8Palette, 1, 2, 0, C8_CANVAS / 4, C8_CANVAS, C8_CANVAS / 2);
}

function draw() {
  if (!c8Env || c8Env.time === 0 && gameState !== 'PLAYING') resetGame(0);
  if (!c8Env.startup) resetGame(0);
  if (gameState === 'PLAYING') {
    c8EnvStep(c8Env, c8ActionFromKeys());
    score = c8Env.score;
    if (c8Env.terminated) gameState = 'GAMEOVER';
  }
  c8Render();
}

function getGameState() { return { score: score, lives: lives, gameState: gameState }; }

// gate hooks (node harnesses only)
globalThis.__chip8 = {
  reset: (seed) => { c8Prepare(); c8EnvReset(c8Env, seed >>> 0); score = c8Env.score; lives = 1; gameState = 'PLAYING'; },
  step: (a) => c8EnvStep(c8Env, a),
  env: () => c8Env,
  def: () => C8_GAME_DEF,
  keyNames: () => C8_KEYNAMES, keyCodes: () => C8_KEYCODES,
  snap: () => { const c = c8Env.cpu; return { t: c8Env.time, pc: c.pc, I: c.I, V: Array.from(c.V), sp: c.sp, stack: Array.from(c.stack), delay: c.delay, sound: c.sound, keypad: Array.from(c.keypad), display: c8DisplayHex(c), rng: Array.from(c.rng), score: c8Env.score, reward: c8Env.reward, terminated: c8Env.terminated, truncated: c8Env.truncated }; },
};
