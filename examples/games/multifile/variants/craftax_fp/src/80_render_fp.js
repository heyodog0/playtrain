// 80_render_fp.js — the first-person frame (FIRST_PERSON_PLAN.md §4).
//
// Craftax-Classic's 64x64 grid, extruded into unit blocks and seen from eye
// height through one DDA ray per pixel. The ray march is `voxelView`, a Rust
// rasterizer primitive (crates/rasterizer/src/voxel.rs) — this file only says
// what to draw. That is the whole point: the classic port spends ~97% of its
// step inside renderGame's per-pixel JS loops, and the fix for that is to move
// the pixels into native code, not to make the JS faster.
//
// WHAT THIS IS NOT. There is no first-person Craftax anywhere, so nothing here
// is "parity" with anything. The dynamics underneath are craftax_classic's,
// unchanged and reused by manifest path; only the observation function differs.
// Say "variant", never "Craftax parity".
//
// FRAME LAYOUT (§4.5), on the 64x64 observation:
//
//     row  0 +----------------------------------------+
//            |                                        |
//            |   first-person view, 64 wide x 49 tall |   <- voxelView
//            |   (horizon at row 24, pitch fixed 0)   |
//     row 48 |                                        |
//     row 49 +----------------------------------------+---+
//            |   Craftax inventory strip, 63 x 14     |pad|   <- classic's own
//     row 62 +----------------------------------------+---+      bitmap path
//     row 63 |            black padding                   |
//            +--------------------------------------------+
//
// The view is 64 wide where the classic map region is 63, because the view has
// no tile grid to keep aligned — it is cast per pixel — and the extra column
// is free. The inventory strip keeps classic's 63 exactly, so those rows are
// byte-identical to craftax_classic for the same state.

const FP_VIEW_W = 64;
const FP_VIEW_H = 49;              // same height as classic's map region
const FP_EYE_Y = F(0.5);           // mid-block: the player stands on the floor
const FP_VIEW_DIST = F(9.0);       // Craftax's 9-wide view, as a radius

// Sky colour. Craftax has no sky texture and no palette entry for one — its
// view is top-down — so this is a choice, not a reproduction. A plain daylight
// blue, distinct from every block texture so the horizon reads clearly; the
// dusk pass darkens it along with everything else.
const FP_SKY_RGB = 0x87CEEB;

// playerDir -> yaw quarter-turn, read off DIR_DR/DIR_DC in 10_constants.js
// rather than guessed. The renderer's yaw 0 faces -z (row decreasing), 1 faces
// +x, 2 faces +z, 3 faces -x; Craftax's dirs are 1 left (dc -1), 2 right
// (dc +1), 3 up (dr -1), 4 down (dr +1). Index 0 is unreachable (playerDir is
// 1..4) and mirrors dir 3 so a corrupt value cannot index off the end.
const FP_YAW = [0, 3, 1, 0, 2];

// Which block ids get a full cube rather than just a floor.
//
// DERIVED, not chosen: `isSolid` in 40_player.js is exactly the set that
// refuses a move, so it is exactly the set that should stop a ray. The one
// exception the plan makes (§4.1) is WATER — impassable, but rendered as a
// floor, because a lake you can see across reads better than a glass wall and
// the player still cannot walk into it. LAVA is not in `isSolid` at all (you
// can walk onto lava; it kills you), and Craftax never generates it anyway —
// reference quirk 1 in the classic README.
function _fpIsCube(blk) {
  return isSolid(blk) && blk !== BLK_WATER;
}

// Packed cell = (block id << 1) | cube. Block ids ARE the atlas indices in
// 15_atlas_fp.js, which is why no translation table is needed.
const FP_PACK = new Uint16Array(17);

let _fpGrid = null;                // Uint16Array(64*64), rebuilt per frame
let _fpAtlas = null;               // Uint8Array, 16x16 RGBA tiles
let _fpNoise = null;               // Float32Array(49*64), night_noise_intensity
let _fpReady = false;

function initRenderFp() {
  // Classic's own init: the inventory strip below reuses its icon and digit
  // atlases, its float buffers and its upload path, so those pixels are the
  // same code and not a copy of it.
  if (_atlasRaw === null) initRender();

  _fpAtlas = _decodeB64(ATLAS_FP_B64);
  _fpNoise = _decodeF32(_decodeB64(NIGHT_NOISE_FP_B64),
                        NIGHT_NOISE_FP_ROWS * NIGHT_NOISE_FP_COLS);
  _fpGrid = new Uint16Array(MAP_SIZE * MAP_SIZE);
  for (let b = 0; b < 17; b++) FP_PACK[b] = (b << 1) | (_fpIsCube(b) ? 1 : 0);
  _fpReady = true;
}

// Repack only the cells a ray can reach this frame.
//
// T3 packed all 4,096 cells every frame and left the question to T7, which
// measured it at **109 of 346 us a step** — a third of the whole step, in a
// JS loop, which is exactly what this variant exists to avoid. §5 suggests a
// dirty flag; a window is better, because it needs no extra state and cannot
// go stale by accident.
//
// Why it is exact rather than an approximation: rays terminate at
// FP_VIEW_DIST (9.0) and sprites are skipped past it, so no ray can leave the
// player's cell by more than 9 blocks in any axis. Repacking a
// (2*FP_PACK_R+1)^2 window centred on the player therefore refreshes every
// cell that can possibly be sampled; cells outside it keep stale values that
// nothing reads. FP_PACK_R is 10, one more than the view distance, so the
// margin survives the half-cell eye offset and any rounding at the edge.
//
// 441 cells instead of 4,096.
const FP_PACK_R = 10;

function _fpPackGrid(st) {
  const pr = st.playerR[0], pc = st.playerC[0];
  let r0 = pr - FP_PACK_R, r1 = pr + FP_PACK_R;
  let c0 = pc - FP_PACK_R, c1 = pc + FP_PACK_R;
  if (r0 < 0) r0 = 0;
  if (c0 < 0) c0 = 0;
  if (r1 > MAP_SIZE - 1) r1 = MAP_SIZE - 1;
  if (c1 > MAP_SIZE - 1) c1 = MAP_SIZE - 1;
  for (let r = r0; r <= r1; r++) {
    const row = r * MAP_SIZE;
    for (let c = c0; c <= c1; c++) {
      _fpGrid[row + c] = FP_PACK[st.mapPacked[row + c]];
    }
  }
}

// Mobs and arrows, as upright billboards (FIRST_PERSON_PLAN.md §4.3).
//
// Drawn from the mob ARRAYS, not the per-row bitmaps 80_render.js scans: the
// bitmaps only say "something is here", and a billboard needs the entity's
// actual cell. The arrays are short (3 zombies, 3 cows, 2 skeletons, 3
// arrows), so this is 11 calls a frame at most and no search.
//
// Order is Craftax's — zombies, cows, skeletons, arrows — but it does not
// matter the way it does in the top-down renderer: the depth buffer
// rs_voxel_view filled decides what is in front, so a far sprite drawn last
// is still occluded by a near one drawn first.
//
// The PLAYER is deliberately absent. You are the player; this is their view.
//
// Plants are NOT sprites. `isSolid` in 40_player.js includes BLK_PLANT and
// BLK_RIPE_PLANT, so they are cubes in the grid, and the plan's §4.3 aside
// about "plants that are not solid" does not match the code it points at. A
// plant you cannot walk through reads better as a block than as a billboard.
function _fpSpriteAt(st, r, c, tile, eyeX, eyeZ, yaw) {
  voxelSprite(
    eyeX, FP_EYE_Y, eyeZ, yaw, FP_VIEW_DIST,
    c + 0.5, r + 0.5,
    _fpAtlas, ATLAS_FP_TILE, ATLAS_FP_COUNT, tile,
    0, 0, FP_VIEW_W, FP_VIEW_H,
  );
}

function _fpSprites(st, eyeX, eyeZ, yaw) {
  for (let i = 0; i < MAX_ZOMBIES; i++) {
    if (st.zombieMask[i]) _fpSpriteAt(st, st.zombieR[i], st.zombieC[i], ATLAS_FP.zombie, eyeX, eyeZ, yaw);
  }
  for (let i = 0; i < MAX_COWS; i++) {
    if (st.cowMask[i]) _fpSpriteAt(st, st.cowR[i], st.cowC[i], ATLAS_FP.cow, eyeX, eyeZ, yaw);
  }
  for (let i = 0; i < MAX_SKELETONS; i++) {
    if (st.skelMask[i]) _fpSpriteAt(st, st.skelR[i], st.skelC[i], ATLAS_FP.skeleton, eyeX, eyeZ, yaw);
  }
  for (let i = 0; i < MAX_ARROWS; i++) {
    if (!st.arrowMask[i]) continue;
    const dr = st.arrowDr[i], dc = st.arrowDc[i];
    const tile = dr < 0 ? ATLAS_FP.arrow_up
      : dr > 0 ? ATLAS_FP.arrow_down
      : dc < 0 ? ATLAS_FP.arrow_left : ATLAS_FP.arrow_right;
    _fpSpriteAt(st, st.arrowR[i], st.arrowC[i], tile, eyeX, eyeZ, yaw);
  }
}

// Dusk, the night static, and the sleep tint (FIRST_PERSON_PLAN.md §4.4).
//
// Runs over the first-person region only, AFTER the world and the mobs, which
// is the order 80_render.js composes the classic frame in — Craftax darkens
// the composited scene, mobs included. The inventory strip below is drawn
// afterwards and is never darkened, exactly as in classic.
//
// The static needs Craftax's state_rng, which 90_playtrain_fp.js installs via
// setNightKey() once per step from the driver seed. `_nightKey` lives in
// 80_render.js, which this bundle carries; with no driver seed it is null, no
// key is passed, and the frame is the deterministic dusk image — which is what
// every host does today.
//
// The whole pass is one call into the rasterizer. Doing it in JS was option B
// in the plan; it is the slowest part of the classic renderer under QuickJS,
// and this is the variant that exists to not do that.
function _fpDusk(st) {
  const daylight = st.lightLevel[0];
  const sleeping = st.isSleeping[0] ? 1 : 0;
  if (daylight >= 1.0 && sleeping === 0) return;
  const useStatic = (daylight < 0.5 && _nightKey !== null) ? 1 : 0;
  voxelDusk(
    0, 0, FP_VIEW_W, FP_VIEW_H,
    daylight,
    useStatic ? _nightKey[0] : 0,
    useStatic ? _nightKey[1] : 0,
    useStatic, _fpNoise, sleeping,
  );
}

// The inventory strip, drawn exactly as craftax_classic draws it.
//
// This IS a copy of the tail of classic's renderGame, and there is no way
// around it: that code is inline in a function this variant must replace, and
// editing craftax_classic to extract it is out of scope (plan §9). Everything
// it leans on — _invPx, _putIcon, _putDigit, _upload, INV_SLOTS, the buffer
// sizes — comes from 80_render.js itself, so only the slot loop is duplicated.
// The comments explaining WHY each line is what it is live there; read them
// there, and keep the two in step.
// The inventory strip only changes when one of its 20 numbers changes, and
// those change rarely. Recomposing it is another **110 us a step** (T7), all
// of it JS: a 2,646-float clear, 16 icon blits, up to 16 digit stencils, and
// an 882-pixel float->uint8 conversion.
//
// So the composition is skipped when the counts are unchanged. The BLIT is
// not: background() clears the canvas every frame, so image() has to be
// re-issued regardless — but the bitmap it blits still holds the last
// composition, and loadBitmap is what costs. Pixels are identical either way,
// which tests/test_same_dynamics.py checks against craftax_classic's own strip.
const _fpInvPrev = new Int32Array(16);
// Hoisted: building this per frame would allocate 16 strings a step.
const _fpInvKeys = INV_SLOTS.map((sl) => sl[0]);

function _fpInvChanged(counts) {
  let changed = false;
  for (let i = 0; i < _fpInvKeys.length; i++) {
    const v = counts[_fpInvKeys[i]];
    if (_fpInvPrev[i] !== v) {
      _fpInvPrev[i] = v;
      changed = true;
    }
  }
  return changed;
}

let _fpInvDrawn = false;

function _fpInventory(st) {
  const counts = {
    health: st.health[0], food: st.food[0], drink: st.drink[0], energy: st.energy[0],
    inv_wood: st.inv[INV_WOOD], inv_stone: st.inv[INV_STONE], inv_coal: st.inv[INV_COAL],
    inv_iron: st.inv[INV_IRON], inv_diamond: st.inv[INV_DIAMOND],
    inv_sapling: st.inv[INV_SAPLING], inv_wpick: st.inv[INV_WPICK],
    inv_spick: st.inv[INV_SPICK], inv_ipick: st.inv[INV_IPICK],
    inv_wsword: st.inv[INV_WSWORD], inv_ssword: st.inv[INV_SSWORD],
    inv_isword: st.inv[INV_ISWORD],
  };
  if (_fpInvChanged(counts) || !_fpInvDrawn) {
    _invPx.fill(0);
    for (let i = 0; i < INV_SLOTS.length; i++) {
      const key = INV_SLOTS[i][0], col = INV_SLOTS[i][1], row = INV_SLOTS[i][2];
      const n = counts[key];
      if (n > 0) _putIcon(key, col, row);
      let d = n > 9 ? 9 : n;
      if (d < 0) d += 10;
      if (d <= 0) continue;
      _putDigit(d, col, row);
    }
    _upload(_invPx, _invBmp, RENDER_W, RENDER_INV_H, 0, RENDER_MAP_H);
    _fpInvDrawn = true;
  } else {
    // Composition unchanged; the bitmap still holds it, so just blit.
    image(_invBmp, 0, RENDER_MAP_H, RENDER_W, RENDER_INV_H);
  }
}

// --- smooth camera (display only) -----------------------------------------
//
// The TRAINING observation is what renderGameFp draws: camera snapped to the
// player's cell centre and one of four facings, exactly once per step. None of
// what follows touches that path, and none of it is in any gate's frame.
//
// A human at 8 steps/s sees that snapping as a teleport plus a 90-degree jump.
// The play page already runs a 60fps requestAnimationFrame loop and simply
// skips the game step between ticks, so there is a render budget going spare:
// renderGameFpSmooth(alpha) draws the SAME state with the camera interpolated
// from where it was before the last step toward where it is now.
//
// Yaw is interpolated the short way round, so turning from facing 3 (west) to
// facing 1 (east) sweeps through north rather than spinning 270 degrees the
// wrong way. voxelView takes a fractional yawQ for this and routes to the
// free-yaw entry point; an integer yawQ still goes to the exact quarter-turn
// path, which is the one with pinned goldens.
const FP_YAW_PREV = new Float64Array(3);   // x, z, yaw (quarter-turn units)
const FP_YAW_CUR = new Float64Array(3);
let _fpPoseInit = false;

function _fpPose(st) {
  return [st.playerC[0] + 0.5, st.playerR[0] + 0.5, FP_YAW[st.playerDir[0]]];
}

// Called once per STEP, after the state has moved, to roll current -> previous.
function fpNotePose(st) {
  const [x, z, yaw] = _fpPose(st);
  if (!_fpPoseInit) {
    FP_YAW_PREV[0] = x; FP_YAW_PREV[1] = z; FP_YAW_PREV[2] = yaw;
    _fpPoseInit = true;
  } else {
    FP_YAW_PREV[0] = FP_YAW_CUR[0];
    FP_YAW_PREV[1] = FP_YAW_CUR[1];
    FP_YAW_PREV[2] = FP_YAW_CUR[2];
  }
  FP_YAW_CUR[0] = x; FP_YAW_CUR[1] = z; FP_YAW_CUR[2] = yaw;
  // Unwrap: carry the previous yaw to whichever branch is nearest the current
  // one, so the lerp below always takes the short way round.
  let d = FP_YAW_CUR[2] - FP_YAW_PREV[2];
  while (d > 2) { FP_YAW_PREV[2] += 4; d -= 4; }
  while (d < -2) { FP_YAW_PREV[2] -= 4; d += 4; }
  // A HALF TURN IS SNAPPED, NOT SWEPT. At exactly +/-2 quarter turns there is
  // no short way round — both directions are equally long — so the sweep
  // picks one arbitrarily and the result is a 180-degree spin over one step,
  // which reads as the camera lurching rather than as turning around. The game
  // itself flips the facing instantly, so the honest animation is no animation:
  // keep the position interpolating and let the yaw jump.
  if (d === 2 || d === -2) FP_YAW_PREV[2] = FP_YAW_CUR[2];
}

// Ease-out: most of the motion happens early, so the camera arrives before the
// next step rather than still gliding into it. Pure display sugar.
function _fpEase(a) {
  if (a <= 0) return 0;
  if (a >= 1) return 1;
  return 1 - (1 - a) * (1 - a);
}

function renderGameFpSmooth(st, alpha) {
  if (!_fpReady) initRenderFp();
  if (!_fpPoseInit) fpNotePose(st);
  const a = _fpEase(alpha);
  const x = FP_YAW_PREV[0] + (FP_YAW_CUR[0] - FP_YAW_PREV[0]) * a;
  const z = FP_YAW_PREV[1] + (FP_YAW_CUR[1] - FP_YAW_PREV[1]) * a;
  const yaw = FP_YAW_PREV[2] + (FP_YAW_CUR[2] - FP_YAW_PREV[2]) * a;
  _fpRender(st, x, z, yaw);
}

function renderGameFp(st) {
  if (!_fpReady) initRenderFp();

  // Eye at the centre of the player's cell. Cell (r, c) is x in [c, c+1),
  // z in [r, r+1), so the centre is (c + 0.5, z = r + 0.5) — which is what
  // puts the cell the player would interact with dead centre on screen.
  // An INTEGER yaw here is what keeps this on the exact quarter-turn path.
  _fpRender(st, st.playerC[0] + 0.5, st.playerR[0] + 0.5, FP_YAW[st.playerDir[0]]);
}

function _fpRender(st, eyeX, eyeZ, yaw) {
  background(0, 0, 0);
  _fpPackGrid(st);
  voxelView(
    _fpGrid, MAP_SIZE, MAP_SIZE,
    eyeX, FP_EYE_Y, eyeZ, yaw, FP_VIEW_DIST,
    _fpAtlas, ATLAS_FP_TILE, ATLAS_FP_COUNT, FP_SKY_RGB,
    0, 0, FP_VIEW_W, FP_VIEW_H,
  );
  _fpSprites(st, eyeX, eyeZ, yaw);
  _fpDusk(st);
  _fpInventory(st);
}
