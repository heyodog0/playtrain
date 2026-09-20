// ---- PlayTrain contract: setup / resetGame / draw / getGameState ----
// The bundle defines, before the shims and the vendored engine:
//   PS_GAME_TEXT : the PuzzleScript source (games/<game>.txt, byte-identical to the pinned reference demo)
//   PS_GAME_DEF  : games/<game>.json (level_mode, playable_levels, ...)
// The engine is the reference's own code, untouched. This file only drives it the way the reference's test
// runner does: compile once (unitTesting = false, lazyFunctionGeneration = false), load the seed's level with
// String(seed) as the RC4 seed, and per frame one processInput(dir) followed by the `again` loop. The episode
// ends at `winning` (gameState WIN, reward 1). Rendering composites each cell's object stack (ascending object
// id, as graphics.js redraw() does) into a growing 5x5 tile atlas and draws the level with one drawTiles call.

const PS_CELL = 5;
const PS_ACTION_KEYS = [38, 37, 40, 39, 32];          // UP LEFT DOWN RIGHT ACTION(space): processInput dir 0..4; the reference takes enter, space, c and x for action
const PS_NOOP = 5;

let score = 0, lives = 1, gameState = 'PLAYING';
let psCompiled = false, psSeed = 0, psLevelIndex = -1;
let psCanvasW = 0, psCanvasH = 0, psScreenW = 0, psScreenH = 0;
let psKinds = null, psKindsW = 0, psKindsH = 0;
let psAtlasTiles = [], psAtlasIndex = {}, psAtlas = null, psAtlasDirty = true;
let psBg = [0, 0, 0];

function psHexToRgb(hex) {
  if (typeof hex !== 'string' || hex[0] !== '#') return null;   // 'transparent' or a bad colour: skip the pixel
  const h = hex.length === 4 ? hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3] : hex.slice(1, 7);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function psPlayableLevels() { return PS_GAME_DEF.playable_levels; }

function psCompile() {
  if (psCompiled) return;
  unitTesting = false;
  lazyFunctionGeneration = false;
  muted = 1;                       // the engine's own mute (sfxr.js playSound returns at `if (muted)`); sound is not_matched
  errorStrings = []; errorCount = 0;
  compile(["loadLevel", psPlayableLevels()[0]], PS_GAME_TEXT, "0");
  psRunAgains();
  psCompiled = true;
  psBg = psHexToRgb(state.bgcolor) || [0, 0, 0];
  // canvas: the largest playable level (or the flick/zoom screen) at 5 px per cell
  let W = 0, H = 0;
  if (state.metadata.flickscreen !== undefined) { W = state.metadata.flickscreen[0]; H = state.metadata.flickscreen[1]; }
  else if (state.metadata.zoomscreen !== undefined) { W = state.metadata.zoomscreen[0]; H = state.metadata.zoomscreen[1]; }
  else for (const i of psPlayableLevels()) { const L = state.levels[i]; W = Math.max(W, L.width); H = Math.max(H, L.height); }
  psCanvasW = W * PS_CELL; psCanvasH = H * PS_CELL;
}

// testingFrameWork.runTest's loop after every input
function psRunAgains() {
  let n = 0;
  while (againing) { againing = false; processInput(-1); n++; }
  return n;
}

function setup() { psCompile(); createCanvas(psCanvasW, psCanvasH); }

function psLoadLevel(idx, seed) {
  // what setGameState resets before loadLevelFromState (engine.js), minus the compile
  oldflickscreendat = []; timer = 0; autotick = 0; winning = false; againing = false; messageselected = false;
  textMode = false; messagetext = '';
  loadLevelFromState(state, idx, String(seed));
  psRunAgains();
}

function resetGame(seed) {
  psCompile();
  psSeed = seed >>> 0;
  const pl = psPlayableLevels();
  psLevelIndex = PS_GAME_DEF.level_mode === 'fixed' ? PS_GAME_DEF.level : pl[psSeed % pl.length];
  psLoadLevel(psLevelIndex, psSeed);
  score = 0; lives = 1; gameState = 'PLAYING';
  psAtlasTiles = []; psAtlasIndex = {}; psAtlas = null; psAtlasDirty = true;
}

// The action for this frame: the first held key in UP LEFT DOWN RIGHT ACTION order, else NOOP.
function psActionFromKeys() {
  for (let i = 0; i < PS_ACTION_KEYS.length; i++) if (keyIsDown(PS_ACTION_KEYS[i])) return i;
  return PS_NOOP;
}

// One env step: processInput(dir) + the again loop; NOOP does nothing (no key, no turn).
function psStep(a) {
  if (a === PS_NOOP) return 0;
  processInput(a);
  return psRunAgains();
}

// ---- render ----
// Viewport as graphics.js redraw() computes it (flickscreen pages, zoomscreen follows, else the whole level).
function psViewport() {
  const W = level.width, H = level.height;
  let mini = 0, minj = 0, maxi = W, maxj = H;
  if (state.metadata.flickscreen !== undefined || state.metadata.zoomscreen !== undefined) {
    const sw = (state.metadata.flickscreen || state.metadata.zoomscreen)[0], sh = (state.metadata.flickscreen || state.metadata.zoomscreen)[1];
    const pp = getPlayerPositions();
    if (pp.length > 0) {
      const px = (pp[0] / H) | 0, py = (pp[0] % H) | 0;
      if (state.metadata.flickscreen !== undefined) {
        mini = ((px / sw) | 0) * sw; minj = ((py / sh) | 0) * sh;
        maxi = Math.min(mini + sw, W); maxj = Math.min(minj + sh, H);
      } else {
        mini = Math.max(Math.min(px - ((sw / 2) | 0), W - sw), 0); minj = Math.max(Math.min(py - ((sh / 2) | 0), H - sh), 0);
        maxi = Math.min(mini + sw, W); maxj = Math.min(minj + sh, H);
      }
      oldflickscreendat = [mini, minj, maxi, maxj];
    } else if (oldflickscreendat.length > 0) {
      mini = oldflickscreendat[0]; minj = oldflickscreendat[1]; maxi = oldflickscreendat[2]; maxj = oldflickscreendat[3];
    } else { maxi = Math.min(sw, W); maxj = Math.min(sh, H); }
  }
  return [mini, minj, maxi, maxj];
}

// The cell's object ids in ascending order (redraw draws sprite k for every set bit k, k ascending).
function psCellKey(posIndex) {
  const cell = level.getCellInto(posIndex, _o12);
  const ids = [];
  for (let k = 0; k < state.objectCount; k++) if (cell.get(k)) ids.push(k);      // BitVec.get returns a boolean
  return ids;
}

// Composite a stack of sprites over the background into a 5x5 RGBA tile.
function psCompositeTile(ids) {
  const t = new Uint8Array(PS_CELL * PS_CELL * 4);
  for (let p = 0; p < PS_CELL * PS_CELL; p++) { t[p * 4] = psBg[0]; t[p * 4 + 1] = psBg[1]; t[p * 4 + 2] = psBg[2]; t[p * 4 + 3] = 255; }
  for (const k of ids) {
    const sp = sprites[k]; if (!sp) continue;
    const dat = sp.dat, colors = sp.colors;
    for (let j = 0; j < PS_CELL; j++) for (let i = 0; i < PS_CELL; i++) {
      const v = dat[j][i];
      if (v < 0) continue;
      const rgb = psHexToRgb(colors[v]); if (!rgb) continue;
      const o = (j * PS_CELL + i) * 4; t[o] = rgb[0]; t[o + 1] = rgb[1]; t[o + 2] = rgb[2];
    }
  }
  return t;
}

function psTileFor(ids) {
  const key = ids.join(',');
  let idx = psAtlasIndex[key];
  if (idx === undefined) { idx = psAtlasTiles.length; psAtlasIndex[key] = idx; psAtlasTiles.push(psCompositeTile(ids)); psAtlasDirty = true; }
  return idx;
}

// Atlas keys by tile index (Object.keys would put integer-like keys such as '0' first).
function psAtlasKeys() { const keys = []; for (const k in psAtlasIndex) keys[psAtlasIndex[k]] = k; return keys; }

function psRender() {
  background(psBg[0], psBg[1], psBg[2]);
  if (!level || !level.objects) return;
  const [mini, minj, maxi, maxj] = psViewport();
  const w = maxi - mini, h = maxj - minj;
  if (w <= 0 || h <= 0) return;
  if (psKindsW !== w || psKindsH !== h) { psKinds = new Uint16Array(w * h); psKindsW = w; psKindsH = h; }
  for (let i = mini; i < maxi; i++) for (let j = minj; j < maxj; j++) psKinds[(j - minj) * w + (i - mini)] = psTileFor(psCellKey(j + i * level.height));
  if (psAtlasDirty) {
    psAtlas = new Uint8Array(psAtlasTiles.length * PS_CELL * PS_CELL * 4);
    for (let t = 0; t < psAtlasTiles.length; t++) psAtlas.set(psAtlasTiles[t], t * PS_CELL * PS_CELL * 4);
    psAtlasDirty = false;
  }
  const x = Math.floor((psCanvasW - w * PS_CELL) / 2), y = Math.floor((psCanvasH - h * PS_CELL) / 2);
  drawTiles(psKinds, w, h, psAtlas, PS_CELL, psAtlasTiles.length, x, y, w * PS_CELL, h * PS_CELL);
}

function draw() {
  if (!psCompiled || psLevelIndex < 0) resetGame(0);
  if (gameState === 'PLAYING') {
    psStep(psActionFromKeys());
    if (winning) { score = 1; gameState = 'WIN'; }
  }
  psRender();
}

function getGameState() { return { score: score, lives: lives, gameState: gameState }; }

// ---- symbolic observation (PLAN 3.6 contract: a Float32Array the hosts hand on untouched) ----
// PS_GAME_DEF.symbolic: {objects, max_width, max_height, dim}. Layout [object k][row y][col x] over the largest
// playable level, 1.0 where object k's bit is set in the cell, cells beyond the current level 0. This is the
// multihot level state PuzzleJAX observes; no rasterizer work happens in this mode.
let psObs = null;
function getObservation() {
  const S = PS_GAME_DEF.symbolic;
  if (!psObs) psObs = new Float32Array(S.dim);
  psObs.fill(0);
  if (!level || !level.objects) return psObs;
  const W = level.width, H = level.height, n = S.objects, MW = S.max_width, MH = S.max_height;
  for (let x = 0; x < W && x < MW; x++) for (let y = 0; y < H && y < MH; y++) {
    const cell = level.getCellInto(y + x * H, _o12);
    for (let k = 0; k < n; k++) if (cell.get(k)) psObs[(k * MH + y) * MW + x] = 1;
  }
  return psObs;
}

// gate hooks (node harnesses only)
globalThis.__ps = {
  reset: (seed) => { psCompile(); resetGame(seed >>> 0); },
  step: (a) => { const n = psStep(a); if (winning) { score = 1; gameState = 'WIN'; } return n; },
  def: () => PS_GAME_DEF,
  levelIndex: () => psLevelIndex,
  compileErrors: () => errorCount,
  playable: () => state.levels.map((l, i) => l.message === undefined ? i : -1).filter(i => i >= 0),
  snap: () => ({ level: convertLevelToString(), objects: Array.from(level.objects), curlevel, winning, againing, textMode, messagetext,
    backups: backups.length, movements_zero: !level.movements || level.movements.every(v => v === 0),
    rng: { i: RandomGen._state.i, j: RandomGen._state.j, s: Array.from(RandomGen._state.s) }, width: level.width, height: level.height }),
  tiles: () => { psRender(); const [mini, minj, maxi, maxj] = psViewport(); return { viewport: [mini, minj, maxi, maxj], kinds: Array.from(psKinds.subarray(0, psKindsW * psKindsH)), keys: psAtlasKeys(), w: psKindsW, h: psKindsH }; },
  keyCodes: () => PS_ACTION_KEYS,
};
