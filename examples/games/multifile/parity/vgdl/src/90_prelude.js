// ---- PlayTrain contract: setup / resetGame / draw / getGameState ----
// The bundle defines, before this file:
//   VG_GAME_TEXT   : the VGDL spec text
//   VG_LEVELS      : array of level strings
//   VG_BLOCK       : block size in pixels (1 for the vgfmri set, 50 for the infer set, 30 for RC_RL)
//   VG_PROFILE     : 'colas' (py-vgdl Colas lineage, 30_engine.js) | 'rcrl' (tomov/RC_RL, 35_rcrl.js)
//   VG_LEVEL_MODE  : 'seed' (level = seed % nLevels) | 'fixed' (VG_LEVEL_INDEX)
//   VG_RENDER      : 'exact' (one rect per sprite, registration order)
//                  | 'fast'  (full-cover statics as background, one fill per type)
//                  | 'tiles' (statics in one drawTiles call, movers as rects at exact pixel positions)

// Colas dialect: img=colors/NAME
const VG_COLORS = {
  LIGHTGRAY: [150, 150, 150], BLUE: [0, 0, 200], YELLOW: [250, 250, 0], BLACK: [0, 0, 0],
  ORANGE: [250, 160, 0], PURPLE: [128, 0, 128], BROWN: [140, 120, 100], PINK: [250, 200, 200],
  GREEN: [0, 200, 0], RED: [200, 0, 0], WHITE: [250, 250, 250], GOLD: [250, 212, 0],
  LIGHTRED: [250, 50, 50], LIGHTORANGE: [250, 200, 100], LIGHTBLUE: [50, 100, 250],
  LIGHTGREEN: [50, 250, 50], DARKGRAY: [30, 30, 30], DARKBLUE: [20, 20, 100], GRAY: [90, 90, 90],
};
function vgColorOf(img) {
  if (VG_PROFILE === 'rcrl') return (typeof img === 'string' && RC_COLORS[img]) || [140, 20, 140];
  if (!img) return [128, 128, 128];
  if (img.startsWith('colors/')) return VG_COLORS[img.split('/')[1]] || [128, 128, 128];
  if (img.startsWith('colored_shapes/')) return VG_COLORS[img.split('/')[1].split('_')[0]] || [128, 128, 128];
  return [128, 128, 128];
}

let score = 0, lives = 1, gameState = 'PLAYING';
// Canvas is sized for the largest level (setup runs once); each level is drawn at the
// largest whole-pixel cell that fits and centred, so small levels fill the frame.
const VG_CELL_MAX = 8;
let VG_CELL = 8, vgOffX = 0, vgOffY = 0;
let vgCanvasW = 0, vgCanvasH = 0, vgSpec = null, vgColors = [], vgBgType = -1, vgLevelIdx = 0;
// tiles mode: static types as a kinds grid (tile id = type index + 1, 0 = empty), palette RGBA per tile
let vgKinds = null, vgPalette = null, vgStaticN = null, vgKindsW = 0, vgKindsH = 0;

function vgPrepare() {
  if (vgSpec) return;
  vgSpec = vgParse(VG_GAME_TEXT);
  if (VG_PROFILE === 'rcrl') rcInit(vgSpec, VG_BLOCK); else vgInit(vgSpec, VG_BLOCK);
  if (VG_PROFILE === 'rcrl' && typeof VG_GROUP_ORDER !== 'undefined' && VG_GROUP_ORDER) VG.groupOrder = VG_GROUP_ORDER;
  if (VG.installCompiled) VG.installCompiled();   // the compile pass, if the bundle carries one
  vgColors = VG.types.map(t => vgColorOf(VG_PROFILE === 'rcrl' ? t.args.color : t.args.img));
  let W = 0, H = 0;
  for (const L of VG_LEVELS) { const lines = L.split('\n').filter(l => l.length > 0); H = Math.max(H, lines.length); for (const l of lines) W = Math.max(W, l.length); }
  vgCanvasW = W * VG_CELL_MAX; vgCanvasH = H * VG_CELL_MAX;
}
function vgFitLevel() {
  VG_CELL = Math.max(1, Math.floor(Math.min(vgCanvasW / VG.W, vgCanvasH / VG.H)));
  vgOffX = Math.floor((vgCanvasW - VG.W * VG_CELL) / 2); vgOffY = Math.floor((vgCanvasH - VG.H * VG_CELL) / 2);
}
// a static type whose sprites cover every cell of the level can be drawn as the background
function vgPickBackground() {
  vgBgType = -1;
  if (VG_RENDER === 'tiles') { vgTilesReset(); return; }
  if (VG_RENDER !== 'fast') return;
  for (let a = 0; a < VG.types.length; a++) {
    const t = VG.types[a];
    if (!t.isStatic || t.n !== VG.W * VG.H) continue;
    let ok = true; for (const e of vgSpec.interactions) if (e.actor === t.key || e.actee === t.key) { ok = false; break; }
    for (const st of t.stypes) for (const e of vgSpec.interactions) if (e.actor === st || e.actee === st) ok = false;
    if (ok) { vgBgType = a; return; }
  }
}

function setup() { vgPrepare(); createCanvas(vgCanvasW, vgCanvasH); }

function resetGame(seed) {
  vgPrepare();
  seed = seed >>> 0;
  vgLevelIdx = VG_LEVEL_MODE === 'fixed' ? VG_LEVEL_INDEX : seed % VG_LEVELS.length;
  if (VG_PROFILE === 'rcrl') rcReset(VG_LEVELS[vgLevelIdx], seed); else vgReset(VG_LEVELS[vgLevelIdx], seed);
  vgFitLevel();
  vgPickBackground();
  score = 0; lives = 1; gameState = 'PLAYING';
}

function vgActiveKeys() {
  const k = [];
  if (keyIsDown(32)) k.push(VG_K_SPACE);
  if (keyIsDown(38)) k.push(VG_K_UP);
  if (keyIsDown(40)) k.push(VG_K_DOWN);
  if (keyIsDown(39)) k.push(VG_K_RIGHT);
  if (keyIsDown(37)) k.push(VG_K_LEFT);
  return k;   // ascending key codes: SPACE(32) < UP(273) < DOWN(274) < RIGHT(275) < LEFT(276)
}

// ---- tiles mode ----
function vgTilesReset() {
  const nT = VG.types.length;
  vgPalette = new Uint8Array((nT + 1) * 4);
  for (let a = 0; a < nT; a++) { const c = vgColors[a]; vgPalette[(a + 1) * 4] = c[0]; vgPalette[(a + 1) * 4 + 1] = c[1]; vgPalette[(a + 1) * 4 + 2] = c[2]; vgPalette[(a + 1) * 4 + 3] = 255; }
  vgKindsW = VG.W; vgKindsH = VG.H;
  vgKinds = new Uint16Array(VG.W * VG.H);
  vgStaticN = new Int32Array(nT).fill(-1);
  vgTilesRebuild();
}
// statics never move; the grid is rebuilt only when a static type's population changed
function vgTilesRebuild() {
  vgKinds.fill(0);
  for (let a = 0; a < VG.types.length; a++) {
    const t = VG.types[a]; vgStaticN[a] = t.isStatic ? t.n : -1;
    if (!t.isStatic) continue;
    for (let k = 0; k < t.n; k++) { const i = t.live[k]; const c = t.cell[i]; if (c >= 0) vgKinds[c] = a + 1; }
  }
}
function vgRenderTiles() {
  background(0); noStroke();
  let changed = false;
  for (let a = 0; a < VG.types.length; a++) { const t = VG.types[a]; if (t.isStatic && t.n !== vgStaticN[a]) { changed = true; break; } }
  if (changed) vgTilesRebuild();
  drawTiles(vgKinds, vgKindsW, vgKindsH, vgPalette, 1, VG.types.length + 1, vgOffX, vgOffY, vgKindsW * VG_CELL, vgKindsH * VG_CELL);
  const s = VG_CELL / VG.B;
  for (let a = 0; a < VG.types.length; a++) {
    const t = VG.types[a]; if (t.isStatic || t.n === 0) continue;
    const c = vgColors[a]; fill(c[0], c[1], c[2]);
    for (let k = 0; k < t.n; k++) { const i = t.live[k]; rect(vgOffX + t.x[i] * s, vgOffY + t.y[i] * s, VG_CELL, VG_CELL); }
  }
}

function vgRender() {
  if (VG_RENDER === 'tiles') { vgRenderTiles(); return; }
  const s = VG_CELL / VG.B;
  if (vgBgType >= 0) { const c = vgColors[vgBgType]; background(c[0], c[1], c[2]); } else background(0);
  noStroke();
  for (let a = 0; a < VG.types.length; a++) {
    if (a === vgBgType) continue;
    const t = VG.types[a]; if (t.n === 0) continue;
    const c = vgColors[a];
    if (VG_RENDER === 'fast') fill(c[0], c[1], c[2]);
    for (let k = 0; k < t.n; k++) {
      const i = t.live[k];
      if (VG_RENDER !== 'fast') fill(c[0], c[1], c[2]);
      rect(vgOffX + t.x[i] * s, vgOffY + t.y[i] * s, VG_CELL, VG_CELL);
    }
  }
}

function draw() {
  if (!VG.spec) resetGame(0);
  if (!VG.ended) { if (VG.tickImpl) VG.tickImpl(vgActiveKeys()); else if (VG_PROFILE === 'rcrl') rcTick(vgActiveKeys()); else vgTick(vgActiveKeys()); }
  score = VG.score;
  if (VG.ended) gameState = VG.won ? 'WIN' : 'GAMEOVER';
  vgRender();
}

function getGameState() { return { score: score, lives: lives, gameState: gameState }; }

// gate hooks (node harnesses only)
globalThis.__vgdl = {
  snapshot: vgSnapshot,
  state: () => ({ t: VG.time, score: VG.score, ended: VG.ended, won: VG.won }),
  tickKeys: (keys) => (VG.tickImpl ? VG.tickImpl(keys) : VG_PROFILE === 'rcrl' ? rcTick(keys) : vgTick(keys)),
  setGroupOrder: (order) => { VG.groupOrder = order; VG.rcMembers = {}; },
  resetLevel: (idx, seed) => { vgPrepare(); vgLevelIdx = idx; if (VG_PROFILE === 'rcrl') rcReset(VG_LEVELS[idx], seed >>> 0); else vgReset(VG_LEVELS[idx], seed >>> 0); vgFitLevel(); vgPickBackground(); score = 0; lives = 1; gameState = 'PLAYING'; },
  levels: () => VG_LEVELS.length,
};
