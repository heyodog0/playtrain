// 90_playtrain.js — the PlayTrain contract.
//
// setup(), draw(), resetGame(seed), getGameState(), and the mapping from a
// frame's input to one action index. The game logic lives in 10..70; this
// file is the adapter between it and the host.
//
// The pixels are NOT here. draw() delegates to renderGame(), which
// 80_render.js defines. Until that lands, draw() paints a flat background so
// the game boots and steps — the dynamics gates (G0-G2) never look at
// pixels, and the render gates (G5) are not claimed yet.

// 64, with Craftax's 63x63 frame drawn into the top-left and a one-pixel
// black margin on the right and bottom.
//
// Craftax's agent observation is exactly 63x63 (a 9x7 map view plus two
// inventory rows, every tile BLOCK_PIXEL_SIZE_AGENT = 7), and 63 was tried
// first. It does not work: every harness fixes the observation at 64 —
// reference_trace.mjs hardcodes obsWidth 64, qjs_host has `static const int
// OBS = 64` — so a 63 canvas gets resampled up to 64 on readback, and the
// two backends resample differently. The differential gate caught it
// immediately, diverging on the very first frame.
//
// At 64 the device scale is 1:1, so every tile blit stays a straight 7x7
// copy with no resampling, which is the whole point of the baked atlas. The
// cost is that the observation is (64, 64, 3) rather than Craftax's
// (63, 63, 3); the content is identical and `obs[:63, :63]` is the Craftax
// frame. Declared in the manifest.
const CANVAS_SIZE = 64;

let gameState = null;
let gameOver = false;

function setup() {
  createCanvas(CANVAS_SIZE, CANVAS_SIZE);
  if (gameState === null) resetGame(0);
}

// One action per frame, matching one puf_step (PLAN 3.3). A pressed key wins
// over a held one, so crafting cannot fire twice from a single keystroke
// while an arrow can be held to walk.
function currentAction() {
  if (typeof keyIsDown !== 'function') return ACT_NOOP;
  if (keyIsDown(32)) return ACT_DO;          // SPACE
  if (keyIsDown(9)) return ACT_SLEEP;        // TAB
  if (keyIsDown(49)) return ACT_PLACE_STONE;
  if (keyIsDown(50)) return ACT_PLACE_TABLE;
  if (keyIsDown(51)) return ACT_PLACE_FURNACE;
  if (keyIsDown(52)) return ACT_PLACE_PLANT;
  if (keyIsDown(53)) return ACT_MAKE_WOOD_PICK;
  if (keyIsDown(54)) return ACT_MAKE_STONE_PICK;
  if (keyIsDown(55)) return ACT_MAKE_IRON_PICK;
  if (keyIsDown(56)) return ACT_MAKE_WOOD_SWORD;
  if (keyIsDown(57)) return ACT_MAKE_STONE_SWORD;
  if (keyIsDown(48)) return ACT_MAKE_IRON_SWORD;
  if (keyIsDown(37)) return ACT_LEFT;
  if (keyIsDown(39)) return ACT_RIGHT;
  if (keyIsDown(38)) return ACT_UP;
  if (keyIsDown(40)) return ACT_DOWN;
  return ACT_NOOP;
}

function draw() {
  if (gameState === null) resetGame(0);
  if (!gameOver) {
    const res = stepGame(gameState, currentAction());
    if (res.done) gameOver = true;
  }
  if (typeof renderGame === 'function') {
    renderGame(gameState);
  } else {
    // Placeholder until 80_render.js lands; see the note at the top.
    background(20, 24, 20);
  }
}

// PLAN 3.4: seeding the PCG here exactly as c_init does is what makes
// "episode with seed s" mean the same world on both sides. PufferLib's
// auto-reset continues its stream across episodes instead; that difference
// is declared in the manifest's not_matched.
function resetGame(seed) {
  if (gameState === null) gameState = createState();
  newEpisode(gameState, (seed >>> 0));
  gameOver = false;
}

// PLAN 3.6: the symbolic observation mode. The host calls this with no
// arguments and copies the Float32Array straight into the obs slot, skipping
// the rasterizer entirely. Length is manifest.obs.symbolic (1345).
function getObservation() {
  if (gameState === null) resetGame(0);
  return computeSymbolicObs(gameState);
}

// PLAN 3.5: score is the float32 running sum of the C's per-step reward, so
// it equals PufferLib's episode_return_accum bit for bit. lives is 1 while
// alive. Classic has no win condition.
function getGameState() {
  return {
    score: gameState === null ? 0 : gameState.score[0],
    lives: gameOver ? 0 : 1,
    gameState: gameOver ? 'GAMEOVER' : 'PLAYING',
  };
}
