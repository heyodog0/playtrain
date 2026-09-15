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
let _fpReady = false;

function initRenderFp() {
  // Classic's own init: the inventory strip below reuses its icon and digit
  // atlases, its float buffers and its upload path, so those pixels are the
  // same code and not a copy of it.
  if (_atlasRaw === null) initRender();

  _fpAtlas = _decodeB64(ATLAS_FP_B64);
  _fpGrid = new Uint16Array(MAP_SIZE * MAP_SIZE);
  for (let b = 0; b < 17; b++) FP_PACK[b] = (b << 1) | (_fpIsCube(b) ? 1 : 0);
  _fpReady = true;
}

// Repack the whole 64x64 map every frame. Craftax mutates very few cells per
// step, so this is more work than it needs to be (§5 suggests a dirty flag),
// but it is obviously correct and it is one table lookup and one store per
// cell. T7 measures whether it is worth the state a dirty flag would add.
function _fpPackGrid(st) {
  const n = MAP_SIZE * MAP_SIZE;
  for (let i = 0; i < n; i++) _fpGrid[i] = FP_PACK[st.mapPacked[i]];
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
function _fpInventory(st) {
  _invPx.fill(0);
  const counts = {
    health: st.health[0], food: st.food[0], drink: st.drink[0], energy: st.energy[0],
    inv_wood: st.inv[INV_WOOD], inv_stone: st.inv[INV_STONE], inv_coal: st.inv[INV_COAL],
    inv_iron: st.inv[INV_IRON], inv_diamond: st.inv[INV_DIAMOND],
    inv_sapling: st.inv[INV_SAPLING], inv_wpick: st.inv[INV_WPICK],
    inv_spick: st.inv[INV_SPICK], inv_ipick: st.inv[INV_IPICK],
    inv_wsword: st.inv[INV_WSWORD], inv_ssword: st.inv[INV_SSWORD],
    inv_isword: st.inv[INV_ISWORD],
  };
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
}

function renderGameFp(st) {
  if (!_fpReady) initRenderFp();

  background(0, 0, 0);
  _fpPackGrid(st);

  // Eye at the centre of the player's cell. Cell (r, c) is x in [c, c+1),
  // z in [r, r+1), so the centre is (c + 0.5, z = r + 0.5) — which is what
  // puts the cell the player would interact with dead centre on screen.
  voxelView(
    _fpGrid, MAP_SIZE, MAP_SIZE,
    st.playerC[0] + 0.5, FP_EYE_Y, st.playerR[0] + 0.5,
    FP_YAW[st.playerDir[0]], FP_VIEW_DIST,
    _fpAtlas, ATLAS_FP_TILE, ATLAS_FP_COUNT, FP_SKY_RGB,
    0, 0, FP_VIEW_W, FP_VIEW_H,
  );

  _fpInventory(st);
}
