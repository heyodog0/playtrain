// 90_playtrain_fp.js — the PlayTrain contract for the first-person variant.
//
// craftax_classic's src/90_playtrain.js with exactly one thing changed: draw()
// delegates to renderGameFp() (80_render_fp.js) instead of renderGame(). The
// bundle carries classic's 80_render.js too, for the inventory atlases and
// upload path the first-person renderer reuses, so renderGame() is defined and
// simply never called.
//
// Everything else below — CANVAS_SIZE, the driver key, the keymap, resetGame,
// getObservation, getGameState — is classic's file verbatim, because the
// variant is the same game with a different camera. If you find yourself
// editing dynamics here, stop: you are building a different game.
//
// setup(), draw(), resetGame(seed), getGameState(), and the mapping from a
// frame's input to one action index. The game logic lives in 10..70; this
// file is the adapter between it and the host.

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

// --- Craftax's driver key --------------------------------------------------
// Craftax's night static is drawn from state_rng, which its step sets from
// the key the CALLER passes in — the training loop's own PRNG — and the
// number of splits per step is fixed, so state_rng is a function of the
// driver's seed and the step index alone (16_threefry.js, craftaxStateRng).
// Supplying that seed here makes the frame Craftax's at every light level;
// Craftax needs the same input, so this is the same interface, not an extra.
//
// This is render-side state. It is not in the parity buffer — G0-G2 compare
// state against PufferLib's C, which has no such field — and it never touches
// the game's PCG. With no driver seed (the default, and every host today)
// no key is derived and the static is skipped, as before.
let driverSeed = null;
const driverKey = new Uint32Array(2);
const stateRng = new Uint32Array(2);

// jax.random.PRNGKey(seed) for the driver; null clears it. Takes effect at
// the next resetGame, so an episode is reproducible from (seed, driverSeed).
function setDriverSeed(seed) {
  driverSeed = seed === null || seed === undefined ? null : (seed >>> 0);
}

// One driver step: advance the chain and hand the renderer this step's
// state_rng. Called once per draw(), i.e. once per host step including the
// reset tick, which is Craftax's step 0.
function nightTick() {
  if (driverSeed === null) return;
  craftaxStateRng(driverKey, stateRng);
  setNightKey(stateRng[0], stateRng[1]);
}

// The state_rng the last frame was rendered with, or null. For the gates.
function getStateRng() {
  return driverSeed === null ? null : [stateRng[0], stateRng[1]];
}

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
  nightTick();
  fpNotePose(gameState);
  renderGameFp(gameState);
}

// PLAN 3.4: seeding the PCG here exactly as c_init does is what makes
// "episode with seed s" mean the same world on both sides. PufferLib's
// auto-reset continues its stream across episodes instead; that difference
// is declared in the manifest's not_matched.
// The smooth-camera hook the play page looks for. Pages that do not know
// about it, and every host, simply never call it — draw() is unchanged, so the
// training observation is exactly what it was.
function renderInterpolated(alpha) {
  if (gameState === null) return;
  renderGameFpSmooth(gameState, alpha);
}

function resetGame(seed) {
  if (gameState === null) gameState = createState();
  newEpisode(gameState, (seed >>> 0));
  gameOver = false;
  if (driverSeed === null) {
    clearNightKey();
  } else {
    const k = threefryPRNGKey(driverSeed);
    driverKey[0] = k[0]; driverKey[1] = k[1];
  }
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
