// ============================================================================
// dmlab_rooms_keys_doors_puzzle v0.1.0 — GENERATED, DO NOT EDIT
//
// Built by tools/bundle_multifile.py from 14 sources listed in
// examples/games/multifile/parity/dmlab/manifest_rooms_keys_doors_puzzle.json
// Source hash (sha256 over the concatenated sources): bca8311666580d1b4e5ff211b928b335f187bd88b5c0ec8f753f4c2fedf0df77
//
// Edit the files under src/ and common/, then run:
//     just bundle dmlab_rooms_keys_doors_puzzle
// ============================================================================

// ---- ../../common/f32.js ----
// f32.js — float32 discipline.
//
// The C we mirror does its float work in `float`, not `double`. JavaScript has
// only doubles, so every float32 operation has to be rounded back explicitly:
// `F(F(a) * F(b))`, never `a * b`. One missed F is a divergence that may not
// show up for thousands of steps, which is why this file is one line of
// machinery and a lot of naming discipline.
//
// Math.cos and Math.sin are NOT wrapped here. They resolve, in every PlayTrain
// engine, to V8's ieee754 (native/qjs/v8libm/ieee754.cc via jsmath.h), which
// is exactly what the reference driver binds the C's cosf/sinf to. Callers
// write F(Math.cos(x)) so the double result is rounded to float32 the way
// (float)cos((double)x) does in the driver.

// eslint-disable-next-line no-unused-vars
const F = Math.fround;

// The C writes 3.14159265f. This is that literal as a float32.
const PI_F = Math.fround(3.14159265);

// float32 bit views, shared so no hot path allocates.
const _f32 = new Float32Array(1);
const _u32 = new Uint32Array(_f32.buffer);

// The bit pattern of a float32, as a uint32. Used by the parity serializer and
// by any test that must compare floats as bits rather than as values.
function f32Bits(x) {
  _f32[0] = x;
  return _u32[0];
}

function bitsToF32(bits) {
  _u32[0] = bits >>> 0;
  return _f32[0];
}

// ---- ../../common/rng_pcg32.js ----
// rng_pcg32.js — PCG-XSH-RR with a 64-bit LCG, as two uint32 words.
//
// Mirrors craftax_classic.h lines 135-142:
//
//   s = s * 6364136223846793005 + 1442695040888963407      (mod 2^64)
//   x = (uint32)(((s >> 18) ^ s) >> 27);  rot = s >> 59
//   out = rotr32(x, rot)
//   rf(s) = (out >> 8) * (1/16777216)
//   ri(s, n) = out % n
//
// No BigInt: the state is `hi` and `lo`, two uint32s, and the 64-bit multiply
// is done in 16-bit limbs so every intermediate stays exactly representable in
// a double. BigInt would be correct and is roughly an order of magnitude
// slower in QuickJS, and this runs about twenty times a step.

const PCG_MULT_HI = 0x5851f42d;   // 6364136223846793005
const PCG_MULT_LO = 0x4c957f2d;
const PCG_INC_HI = 0x14057b7e;    // 1442695040888963407
const PCG_INC_LO = 0xf767814f;

// The state, as the C's single uint64 split in two: a Uint32Array of length
// 2, word 0 the low half and word 1 the high half.
//
// Two words in that order on purpose. This IS the game state's `pcg` field
// (src/20_state.js), and the canonical dump writes a uint64 low word first,
// so the RNG can run directly on the parity buffer with no copying and no
// chance of the two drifting apart.
const PCG_LO = 0;
const PCG_HI = 1;

function pcgState() {
  return new Uint32Array(2);
}

// Unsigned 32x32 -> 64 multiply, returned through these two module-level
// slots to avoid allocating a pair on every draw.
let _mulHi = 0;
let _mulLo = 0;

function umul32(a, b) {
  const ah = a >>> 16;
  const al = a & 0xffff;
  const bh = b >>> 16;
  const bl = b & 0xffff;
  const ll = al * bl;
  const lh = al * bh;
  const hl = ah * bl;
  const hh = ah * bh;
  // Each addend is below 2^16, so mid stays below 2^18 and exact.
  const mid = (ll >>> 16) + (lh & 0xffff) + (hl & 0xffff);
  _mulLo = (((mid & 0xffff) << 16) | (ll & 0xffff)) >>> 0;
  // hh can carry past 2^32; >>> 0 is the mod-2^32 the 64-bit product wants.
  _mulHi = (hh + (lh >>> 16) + (hl >>> 16) + (mid >>> 16)) >>> 0;
}

// One step of the LCG, in place.
function pcgAdvance(s) {
  const lo = s[PCG_LO];
  const hi = s[PCG_HI];
  umul32(lo, PCG_MULT_LO);
  let rLo = _mulLo;
  // The cross terms only affect the high word.
  let rHi = (_mulHi + Math.imul(lo, PCG_MULT_HI) + Math.imul(hi, PCG_MULT_LO)) >>> 0;
  // Add the increment, carrying out of the low word.
  const sum = (rLo >>> 0) + (PCG_INC_LO >>> 0);
  rLo = sum >>> 0;
  rHi = (rHi + PCG_INC_HI + (sum > 0xffffffff ? 1 : 0)) >>> 0;
  s[PCG_LO] = rLo;
  s[PCG_HI] = rHi;
}

// cr_pcg: advance, then the XSH-RR output transform. Returns a uint32.
function crPcg(s) {
  pcgAdvance(s);
  const hi = s[PCG_HI];
  const lo = s[PCG_LO];
  // (s >> 18) ^ s, as two words.
  const shLo = ((lo >>> 18) | (hi << 14)) >>> 0;
  const shHi = hi >>> 18;
  const xLo = (shLo ^ lo) >>> 0;
  const xHi = (shHi ^ hi) >>> 0;
  // >> 27, truncated to uint32.
  const x = ((xLo >>> 27) | (xHi << 5)) >>> 0;
  const rot = hi >>> 27;
  // rotr32. At rot == 0 the C shifts a uint32 by 32, which is undefined but
  // on every target it assembles to a shift by 0, giving x | x == x. JS
  // shifts are defined mod 32 and give the same answer, so the two agree.
  return ((x >>> rot) | (x << ((-rot) & 31))) >>> 0;
}

// cr_rf: exact in float32 and in double, so no rounding needed.
function crRf(s) {
  return (crPcg(s) >>> 8) * (1.0 / 16777216.0);
}

// cr_ri: the C computes out % (uint32)n.
function crRi(s, n) {
  return crPcg(s) % (n >>> 0);
}

// c_init's seeding, lines 938-948: pcg = seed * 0x9E3779B97F4A7C15 +
// 0x87C37B91114253D5, then eight warm-up draws so small seeds do not produce
// correlated worlds.
function pcgSeed(s, seed) {
  const sd = seed >>> 0;
  umul32(sd, 0x7f4a7c15);
  let lo = _mulLo;
  let hi = (_mulHi + Math.imul(sd, 0x9e3779b9)) >>> 0;
  const sum = (lo >>> 0) + 0x114253d5;
  lo = sum >>> 0;
  hi = (hi + 0x87c37b91 + (sum > 0xffffffff ? 1 : 0)) >>> 0;
  s[PCG_HI] = hi;
  s[PCG_LO] = lo;
  for (let i = 0; i < 8; i++) crPcg(s);
}

// ---- src/00_header.js ----
// DMLab-30 on PlayTrain - a fast first-person port of DeepMind Lab's maze
// levels (examples/games/multifile/parity/dmlab/PLAN.md).
//
// GENERATED BUNDLE WARNING: if you are reading this inside dist/dmlab_*.js, do
// not edit it. Edit src/ and re-run tools/bundle_multifile.py.
//
// What is DMLab's and what is not:
//   * layouts, textures, decals, spawns and goals are DATA that DMLab generated
//     (reference/dumps, compiled by tools/compile_level.py) - nothing here
//     generates a maze;
//   * movement is a Quake-3-style walk written from its published behaviour and
//     fitted to DMLab's own trajectories (40_pmove.js, PROGRESS.md U04);
//   * pixels come from one rasterizer primitive, rs_maze_view (maze.rs);
//   * textures are derived from DMLab's //assets, CC BY 4.0
//     (games/dmlab_assets/ATTRIBUTION.md). No GPL code is copied or translated.

// ---- src/10_constants.js ----
// 10_constants.js - every number the dynamics use, with where it came from.
//
// Movement (fitted on explore_goal_locations_small, PROGRESS.md U04): Quake 3's
// documented walk defaults, which the oracle's trajectories select sharply.
const DM_SPEED = F(320);        // wish speed, units/s
const DM_ACCEL = F(10);         // ground acceleration
const DM_FRICTION = F(6);       // ground friction
const DM_STOP = F(100);         // friction control floor
const DM_HALF = F(16);          // player half-width: walls stop the centre 16.125 away
const DM_EPS = F(0.125);        // trace clip epsilon
const DM_OVERCLIP = F(1.001);   // velocity overclip against a plane
const DM_NOTCH = 1;              // square notch at every convex wall corner (30_level.js)

// View: a look action of p pixels adds p * 0.10560 deg (Q3 m_yaw 0.022 times
// sensitivity 4.8) to a float accumulator; the yaw is that accumulator
// quantised to Quake angle shorts (U = 360/65536 deg). Exact on every oracle
// frame (PROGRESS.md U04).
// The accumulator is a double: the fit is exact in double and a float32
// accumulator flips the quantisation on ~1 frame in 20 (tested in G3).
const DM_LOOK = 0.10560;
const DM_U = 360 / 65536;

// In the air (after a teleport): Quake's air acceleration 1 and gravity 800,
// the vertical move integrating the mean of the frame's start and end
// velocity; landing at the level's standing height (rooms_select_nonmatching,
// fitted on the oracle's z after a teleport, PROGRESS.md U06).
const DM_AIR_ACCEL = F(1);
const DM_GRAVITY = F(800);
const DM_TELEPORT_SPEED = 400;

// Engine timing: DMLab steps at 60 fps (episodeTimeSeconds advances 1/60 per
// frame) but player movement integrates over 17, 17, 14 ms - Quake's client
// clock drift around a 16 ms frame. The port uses that cycle from episode
// start; the G3 replays use the oracle's own per-frame values.
const DM_MSEC_CYCLE = [17, 17, 14];

// IMPALA's DMLab-30 action set, google-deepmind/scalable_agent environments.py
// DEFAULT_ACTION_SET: (look_lr, look_du, strafe_lr, move_bf, fire, jump, crouch).
const DM_ACTIONS = [
  [0, 0, 0, 1, 0, 0, 0],     // 0 forward
  [0, 0, 0, -1, 0, 0, 0],    // 1 backward
  [0, 0, -1, 0, 0, 0, 0],    // 2 strafe left
  [0, 0, 1, 0, 0, 0, 0],     // 3 strafe right
  [-20, 0, 0, 0, 0, 0, 0],   // 4 look left
  [20, 0, 0, 0, 0, 0, 0],    // 5 look right
  [-20, 0, 0, 1, 0, 0, 0],   // 6 forward + look left
  [20, 0, 0, 1, 0, 0, 0],    // 7 forward + look right
  [0, 0, 0, 0, 1, 0, 0],     // 8 fire
  // psychlab only (PROGRESS.md T1): IMPALA's set cannot reach the answer buttons
  [0, -20, 0, 0, 0, 0, 0],   // 9 look up
  [0, 20, 0, 0, 0, 0, 0],    // 10 look down
];
const DM_NOOP = [0, 0, 0, 0, 0, 0, 0];
const DM_REPEAT = 4;            // engine frames per agent step (IMPALA)
const DM_FPS = 60;

// Geometry: a maze cell is 100 units; feet z 25.125, eye 26 above (oracle).
const DM_CELL = 100;
const DM_FEET_Z = 25.125;
const DM_EYE_HEIGHT = 26;
const DM_FLOOR_Z = 1.125;       // feet z minus the player's 24 below origin

// Pickups: a player at (x, y) touches an item at (ix, iy) when
// x - ix in [-50, 44] and y - iy in [-36, 36], tested on a frame's end
// position; the reward arrives one frame later and a goal's restart
// teleports the player one frame after that (fitted, PROGRESS.md U04).
const DM_TOUCH_X0 = -50, DM_TOUCH_X1 = 44, DM_TOUCH_Y0 = -36, DM_TOUCH_Y1 = 36;
const DM_GOAL_REWARD = 10;

// ---- src/atlas/rooms_keys_doors_puzzle.js ----
// atlas/rooms_keys_doors_puzzle.js - GENERATED by tools/dmlab_atlas.py from games/dmlab_assets. DO NOT EDIT.
//
// Derived from DeepMind Lab //assets, CC BY 4.0 (games/dmlab_assets/ATTRIBUTION.md).
// 63 tiles of 32x32 RGBA, tile-major then row-major:
// tile i starts at byte i * DM_ATLAS_STRIDE. Names are DMLab shader names
// (map/..., decal/...) and sprite/<model>.

const DM_ATLAS_TILE = 32;
const DM_ATLAS_STRIDE = DM_ATLAS_TILE * DM_ATLAS_TILE * 4;
const DM_ATLAS_COUNT = 63;
const DM_ATLAS_MIPS = 3;   // levels after the tiles: each a 2x2 box filter of the one before

const DM_ATLAS = {
  'map/lab_games/lg_style_01_floor_orange': 0,
  'map/lab_games/lg_style_01_floor_orange_bright': 1,
  'map/lab_games/lg_style_01_floor_blue': 2,
  'map/lab_games/lg_style_01_floor_blue_bright': 3,
  'map/lab_games/lg_style_02_floor_blue': 4,
  'map/lab_games/lg_style_02_floor_blue_bright': 5,
  'map/lab_games/lg_style_02_floor_green': 6,
  'map/lab_games/lg_style_02_floor_green_bright': 7,
  'map/lab_games/lg_style_03_floor_green': 8,
  'map/lab_games/lg_style_03_floor_green_bright': 9,
  'map/lab_games/lg_style_03_floor_blue': 10,
  'map/lab_games/lg_style_03_floor_blue_bright': 11,
  'map/lab_games/lg_style_04_floor_blue': 12,
  'map/lab_games/lg_style_04_floor_blue_bright': 13,
  'map/lab_games/lg_style_04_floor_orange': 14,
  'map/lab_games/lg_style_04_floor_orange_bright': 15,
  'map/lab_games/lg_style_05_floor_blue': 16,
  'map/lab_games/lg_style_05_floor_blue_bright': 17,
  'map/lab_games/lg_style_05_floor_orange': 18,
  'map/lab_games/lg_style_05_floor_orange_bright': 19,
  'map/lab_games/lg_style_01_wall_green': 20,
  'map/lab_games/lg_style_01_wall_green_bright': 21,
  'map/lab_games/lg_style_01_wall_red': 22,
  'map/lab_games/lg_style_01_wall_red_bright': 23,
  'map/lab_games/lg_style_02_wall_yellow': 24,
  'map/lab_games/lg_style_02_wall_yellow_bright': 25,
  'map/lab_games/lg_style_02_wall_blue': 26,
  'map/lab_games/lg_style_02_wall_blue_bright': 27,
  'map/lab_games/lg_style_03_wall_orange': 28,
  'map/lab_games/lg_style_03_wall_orange_bright': 29,
  'map/lab_games/lg_style_03_wall_gray': 30,
  'map/lab_games/lg_style_03_wall_gray_bright': 31,
  'map/lab_games/lg_style_04_wall_green': 32,
  'map/lab_games/lg_style_04_wall_green_bright': 33,
  'map/lab_games/lg_style_04_wall_red': 34,
  'map/lab_games/lg_style_04_wall_red_bright': 35,
  'map/lab_games/lg_style_05_wall_red': 36,
  'map/lab_games/lg_style_05_wall_red_bright': 37,
  'map/lab_games/lg_style_05_wall_yellow': 38,
  'map/lab_games/lg_style_05_wall_yellow_bright': 39,
  'map/lab_games/fake_sky': 40,
  'map/lab_games/lg_style_01_wall_blue': 41,
  'map/fut_ceiling_tile_02_d': 42,
  'map/fut_flat_wall_yellow_blank_d': 43,
  'map/fut_door_d': 44,
  'map/fut_utility_panel_01_d': 45,
  'map/black_d': 46,
  'synthetic/script_highlight_dark': 47,
  'synthetic/script_highlight_bright': 48,
  'synthetic/door_red': 49,
  'synthetic/door_green': 50,
  'synthetic/door_blue': 51,
  'synthetic/door_white': 52,
  'synthetic/door_black': 53,
  'sprite/hr_ice_lolly_lrg__goalorange': 54,
  'sprite/hr_key_lrg__black': 55,
  'sprite/hr_key_lrg__blue': 56,
  'sprite/hr_key_lrg__green': 57,
  'sprite/hr_key_lrg__red': 58,
  'sprite/hr_key_lrg__white': 59,
  'sprite/goal_object_02': 60,
  'sprite/apple': 61,
  'sprite/goal_object_03': 62,
};

const DM_ATLAS_B64 =
  'yJcs/8KfQf/Iixn/yIsZ/8WUK//FnTv/yJct/8OhRP/MkB//zY4a/82OGv/DokX/yJct/8eYMP+6lTj/u4MY/7uDGP+6ljr/x5gv/8iXLf/DokT/zY4a/82O' +
  'Gv/MkSH/w6FD/8iXLf/Enj3/ypYo/82OGv/Njhr/w6FC/8iXK//Njhr/xZ48/8SWL//FlS3/waFF/82OGf/Njhn/zJAg/8OiRP/Jly7/xZ49/8mWKv/Njhn/' +
  'zY4Z/8CfQ/+6jSv/uo0r/8KfQf/Njhn/zY4Z/8mYLv/FnTr/yZgu/8OiRf/MkB7/zY4Z/82OGv/Do0b/yZcu/8eYMv/GnDj/zY4Z/82OGv/FnTv/xJYw/8WV' +
  'Lv/BoUX/zY4Z/82OGf/MkCD/uptD/7qOLf+5lzz/yZYq/82OGf/Njhn/wZ9C/7qOLP+6jiz/wZ9B/82OGf/Njhn/yZct/8WdO//ImC//wqFE/8yQHv/Njhn/' +
  'zY4a/8KiRv/ImC//xpkz/8acOP/Njhn/yJct/8GfQv/Iixn/yIsZ/8WUK//FnTz/yJgu/8GgRP+7hRz/u4IX/7uCF/++n0X/yJgu/8eYMf+6lTj/u4IX/7uC' +
  'F/+6lzv/x5gv/8mYLv/DokX/zY4Z/82OGf/MkSH/w6FD/8iYLv/Fnz7/ypUo/82OGf/Njhn/w6FD/8iXLP/FlS3/wZ9B/8iLGf/Iixn/xZMq/8GcPf/FlS7/' +
  'vp9E/7uEG/+7ghf/u4IX/7ibRP+6jiz/uo8v/7qVN/+7ghf/u4IX/7qXOv/HmDD/yJgv/8OiRP/Njhn/zY4Z/8yRIP+xlUL/q4Mr/6+QPf/KlSj/zY4Z/82O' +
  'Gf/DoUP/xZQt/8iMGf/DnDz/xZYv/8WVLP/AoUX/yIsZ/8iLGf/Hjh//uptD/7qNK/+6ljv/uowo/7uCF/+7ghf/uZlC/7qNKv+6jSr/wZ9C/82OGf/Njhn/' +
  'yJgv/8adOv/JmC3/vp9E/6p5Gf+pdRX/qXYW/7qdRf/JmC3/x5ky/8OaOP/Iixn/yIwZ/8ObOv/ElzH/xZYv/8CgRf/Iixn/yIsZ/8eOHv/DoUT/yJgv/8Se' +
  'Pv+6iyj/u4IX/7uCF/+7m0H/yJgv/8iYL//EoUL/zY4Z/82OGf/Jly3/xZ08/8iYL/++n0T/qngZ/6l1Ff+pdhX/upxF/8iYL//HmTP/xJo3/8iLGf/FlSz/' +
  'wZ9C/8iLGf/Iixn/xZQr/8KcPP/FlS7/waFE/8yQH//Njhn/zY4Z/7yeRf+6jiz/uo8v/8WdOv/Njhn/zY4Z/8WePf/ImDD/yZgu/8OjRf/Njhn/zY4Z/8yR' +
  'IP+xlEH/q4Mq/6+PPP/KlSj/zY4Z/82OGf/CoUT/xZQs/8iYLv/CoEP/yIsZ/8iLGf/FlCv/xZ49/8iYL//DokX/zJAf/82OGf/Njhn/w6NG/8iYL//HmDH/' +
  'xp06/82OGf/Njhn/xZ49/8eYMP/ImC7/w6NF/82OGf/Njhn/zJEg/7CVQv+rgyr/ro88/8qVKP/Njhn/zY4Z/8OiRP/ImC3/zY4a/8WePP/Eli//xZUt/8Gh' +
  'Rf/Njhn/zY4Z/8yQH//DokT/yJgu/8WePf/Jlin/zY4Z/82OGf/EoUP/yJcu/8iXLv/EoUL/zY4Z/82OGf/JmC3/xZ07/8iYLv++nkT/qngZ/6l1Ff+pdhX/' +
  'up1F/8iYLv/HmDP/xpw4/82OGf/Njhr/xZ07/8eYMP/ImC7/w6JF/82OGf/Njhn/zJAg/6yRQf+ifCn/poo5/8mWKv/Njhn/zY4Z/8SgQ//Ily7/yJcu/8Sg' +
  'Qf/Njhn/zY4Z/8mXLv+ujTf/q4Mq/66TQv+qeBn/qXUV/6l2Fv+6nET/yJgu/8aZMv/GnDj/zY4Z/8iXLf/EoUL/zY4Z/82OGf/Jlyz/xZ08/8iYL/+9nkT/' +
  'nnAZ/51tE/+dbRP/t5lE/8iYLv/HmDH/xZ06/82OGf/Njhn/xZ48/8eYMP/ImC7/uZpE/6l1Ff+pdRX/qnod/6+SQP+sgyr/r488/8qVKP/Njhn/zY4Z/8Oh' +
  'Q//Ily3/uo0r/8GfQv/Njhn/zY4Z/8mWK/+6ljv/uo4s/7WYQ/+ecBn/nW0T/51tE/+nj0L/onwp/6OALf/FnDr/zY4Z/82OGf/Fnj3/x5gw/8iYLv+4mkT/' +
  'qXUV/6l1Ff+qeRz/r5JB/6uDKv+vjzz/ypUo/82OGf/Njhn/wJ9D/7qNK/+7ghj/upc6/8iYMP/JmC7/vp9F/7uCF/+7ghf/u4Ud/6qQQf+ifCj/pog5/6F5' +
  'Jf+dbRP/nW0T/6+TQf/Jly7/yZcu/8ShQv/Njhn/zY4Z/8iYL/+ujTf/q4Mq/66TQ/+qeRn/qXUV/6l2Fv+6nUX/yZgu/8eYMv+6lDf/u4IY/7uCGP+6lTn/' +
  'uo8v/7qOLf+5m0T/u4IX/7uCF/+7hR3/waFE/8iYL//Enj3/oXkk/51tE/+dbRP/po0//6J8Kf+ifCn/vpxB/82OGf/Njhn/yZgt/8KbO//FlS7/vJ1E/6p4' +
  'Gf+pdRX/qXYW/66URP+rgyv/rIcv/7qTNv+7ghj/uo0r/7mZQf+7ghf/u4IX/7qNKf+6ljv/uo4t/7qcRP/MkB//zY4Z/82OGf+zmET/on0p/6OALv+lhjb/' +
  'nW0T/51tE/+niTj/yJgw/8mYL//CokX/yIsZ/8iLGf/HjiD/sJVB/6uDK/+ujz3/q38k/6l1Ff+pdRX/sZVB/7qNK//Ily3/u5tC/7uCF/+7ghf/uo0p/7mW' +
  'Ov+6jiv/upxE/8yQH//Njhn/zY4Z/7OYRP+heyj/o38s/6WGNv+dbRP/nW0T/6eKOf/ImC//yZgu/8KiRf/Iixn/yIsZ/8eOIP/DoUT/yZgu/8SePv+rgCX/' +
  'qXUV/6l1Ff+0l0L/yJcs/82OGv/FnTv/uo8v/7qOLP+4m0T/u4IX/7uCF/+7hBz/waFE/8iYL//Enj3/oXkk/51tE/+dbRP/po0+/6J8KP+jfSj/vZxA/82O' +
  'Gf/Njhn/yZct/8KbO//FlS7/waFE/82PHv/Njhn/zY4Z/7eZRP+sgyv/rYcv/8abOP/Njhn/zY4a/8WePP/HmDD/yJgu/72fRP+7ghf/u4IX/7uFHf/BoET/' +
  'yJgu/8SdPf+heSX/nW0T/51tE/+njj//onwo/6J8KP+9nEH/zY4Z/82OGf/JmC7/wpo6/8WVLf/AoET/zJAf/82OGf/Njhr/wqNG/8iYLv/HmDL/xpw5/82O' +
  'Gf/Ily7/xKBC/82OGf/Njhn/yZYr/7qWO/+6jiz/upxD/8yQH//Njhn/zY4Z/7OYRP+ifSn/pIAu/6WFNv+dbRP/nW0T/6eJN//HmDD/yJgv/8GhRP/Iixn/' +
  'yIsZ/8eOIP/CoET/yJgv/8SfP//KlSj/zY4Z/82OGf/DoUP/yJct/8iXLf/EoUP/zY4Z/82OGf/Jliz/xZ49/8iXLv/DokX/zJAf/82OGf/Njhn/w6NF/8iX' +
  'Lv/HmDH/pYc2/51tE/+dbRP/p4k4/8eYL//Ily7/wqFF/8iLGf/Iixn/x44g/8OhRP/Ily7/xJ8//8qVKP/Njhn/zY4Z/8OhQ//Ilyz/zY4a/8WePP/ImDD/' +
  'yZgv/8OjRv/Njhn/zY4Z/8yQIP/DokT/yZgv/8WePf/Jlir/zY4Z/82OGf+7m0L/onwo/6J8KP+9nEH/zY4Z/82OGf/JmC7/w5s6/8WVLv/BoET/zJAe/82O' +
  'Gf/Njhr/w6NH/8mYL//HmDL/xpw4/82OGf/Njhr/xp48/8eYMf/ImC7/w6NF/82OGf/Njhn/zJAg/8OiRP/ImC7/xZ49/8mWKv/Njhn/zY4Z/8ShQ//Ily7/' +
  'yJcu/8ShQv/Njhn/zY4Z/8mYLv+5lTn/uo4s/7qcRP/MkB7/zY4Z/82OGv/Do0b/yJgu/8eYMv/GnDj/zY4Z/8iYL//EoUL/zY4Z/82OGf/Jliv/xZ49/8iY' +
  'L//DokX/zJAf/82OGf/Njhn/wqNG/8iYL//HmTL/xp06/82OGf/Njhn/xZ48/8eYMf/JmC//vZ9E/7uCF/+7ghf/u4Ue/8KgRP/ImC//xaA//8qVKP/Njhn/' +
  'zY4Z/8OhQ//ImC7/yZct/8SiQ//Njhn/zY4Z/8mXLf+tjTn/q4Mp/7GWQ//MkB//zY4Z/82OGv/Do0b/yZct/8eYMP/Gnjv/zY4Z/82OGf/Fnj3/uo4u/7qN' +
  'K/+5m0T/u4IX/7uCF/+7hh//uZlC/7qNK/+5mD3/ypUp/82OGf/Njhn/w6JE/8mXLP/Njhr/xp07/8eYMf/ImC//uZtE/6l1Ff+pdRX/qnka/7+fRP/ImC//' +
  'xZ4+/8qWKf/Njhn/zY4Z/8ShQv/Ily//yJcu/7uaQP+7ghf/u4IX/7qNK/+6lTr/uo4t/7maRP+7hBv/u4IX/7uCF/++oEX/yJgv/8aZM//GnDf/zY4Z/82O' +
  'Gv/Fnjz/x5gw/8iXLv+6m0T/qXUV/6l1Ff+qeRz/rpNB/6uDKv+ujjr/yZYr/82OGf/Njhn/xKFD/8iXLf/Ily3/u5pA/7uCF/+7ghf/uo4s/8WcOv/Ily7/' +
  'wKBE/7uEHP+7ghf/u4MY/76gRf/Ily7/x5gy/8adOf/Njhn/yJcu/8ShQv/Njhn/zY4Z/8mWK/+vjjr/rIQr/6+TQv+qeRr/qXUV/6l1Ff+5m0T/yJgv/8aY' +
  'Mv/GnTn/zY4Z/82OGf/FnTv/uo8v/7qOLf+9nkT/zY4Z/82OGf/MkSD/uptC/7qOLf+6mD3/ypUo/82OGf/Njhn/w6BD/8iYLv/Ily3/xKFD/82OGf/Njhn/' +
  'yZcs/8WePP/Ily3/v59E/6p5Gv+pdRX/qXUV/7qcRP/Ily3/x5gw/8adOv/Njhn/zY4Z/8WePf/HmC//yJct/8OjRf/Njhn/zY4Z/8yRIP/DoUT/yJct/8Sf' +
  'Pv/KlSj/zY4Z/82OGf/DoUT/yJcs/82OGv/Fnjz/x5gx/8iYL//DokX/zY4Z/82OGf/MkCD/sZZD/6uDK/+ujzv/yZYp/82OGf/Njhn/xKFD/8iYL//ImC//' +
  'xKFC/82OGf/Njhn/yZgu/8WdPP/ImC//w6JF/82QHv/Njhn/zY4a/8OjRv/ImC//x5kz/8acOP/Njhn/zY4a/8WePP/Eli//xZUt/8GiRf/Njhn/zY4Z/8yR' +
  'IP/DokT/yZgu/8WePf/Jliv/zY4Z/82OGf/An0P/uo0q/7qNK//Bn0L/zY4Z/82OGf/JmC7/xZ06/8mYLv/DokX/zJAe/82OGf/Njhr/w6NG/8mYLv/HmDL/' +
  'xp05/82OGf/Ily3/wp9B/8iLGf/Iixn/xZMr/8WdO//Ily3/w6FE/8yQH//Njhr/zY4a/8KiRP/Ily3/x5gw/7qVOP+7gxj/u4MY/7qWOv/HmC//yJct/8Oi' +
  'RP/Njhr/zY4a/8yRIf/DoEP/yJcu/8SePv/KlSj/zY4a/82OGv/DoEL/yJcs//rmgP/47JX/+t9r//rfa//55H3/+euQ//rmgP/47Zj/+uJx//vhbf/74W3/' +
  '+O2Z//rmgP/554T/9uWL//bZaf/22Wn/9uaN//rng//65oD/+O2Z//vhbf/74W3/+uN0//jtl//65oD/+euR//rlfP/74W3/++Ft//jtl//65n//++Ft//nq' +
  'j//55oP/+eV///jtmv/74Gz/++Bs//vicv/47Zn/+uaB//nrkf/65n3/++Bs//vgbP/465b/9uB9//bgff/47JX/++Bs//vgbP/65oH/+euP//rmgf/47pr/' +
  '++Fw//vgbP/74W3/+O6b//rmgf/56Ib/+eqM//vhbP/74W3/+eqO//nmg//55YD/+O2Z//vgbP/74Gz/++Jy//bql//24X7/9ueQ//rlff/74Gz/++Bs//jr' +
  'lv/24X7/9uF+//jrlf/74Gz/++Bs//rmgP/564//+ueC//jumf/74XD/++Bs//vhbf/47pr/+ueC//nohv/56oz/++Fs//rngf/47JX/+t5q//reav/55H3/' +
  '+euQ//rmgv/47Zn/9ttu//bZaP/22Wj/9+yZ//rmgf/56IX/9uWL//bZaP/22Wj/9uaN//rnhP/65oH/+O6a//vgbP/74Gz/++J0//jtmP/65oL/+eyT//rl' +
  'fP/74Gz/++Bs//jtl//654D/+eaA//jrlf/63mr/+t5q//nkfP/46pD/+eWA//fsmP/2223/9tlo//bZaP/16Zj/9uF+//bjg//25Ir/9tlo//bZaP/25o3/' +
  '+uiE//rngv/47Zn/++Bs//vgbP/74nP/8+WW//DZff/x4pD/++R7//vgbP/74Gz/+OyW//nmgP/632v/+OmO//nmgv/55H//9+2a//reav/63mr/+uBw//bq' +
  'l//24H3/9uaO//bfev/22Wj/9tlo//Xolf/24H3/9uB9//jslv/74Gz/++Bs//rmgv/56o//+uaB//fsmf/v0Wv/789m/+/PZ//16pr/+uaB//rohv/46Yz/' +
  '+t9r//rfa//46Y3/+eaE//nlgf/47Zn/+t5q//reav/64HD/+O6Z//rmgv/565P/9t95//bZaP/22Wj/9umV//rmgv/65oL/+e2W//vgbP/74Gz/+uaA//nr' +
  'kP/65oL/9+ua/+/Rav/vz2b/789m//Xqmf/65oL/+eiH//joiv/632v/+eV///jrlv/63mr/+t5q//nkfv/46o//+eR///jtmf/74nH/++Bs//vgbP/27Jn/' +
  '9uB+//bigv/56o7/++Bs//vgbP/565H/+uiE//rmgf/47pr/++Bs//vgbP/74nP/8+WV//DYfP/y4Y//+uV7//vgbP/74Gz/+O2X//nlf//654H/+OyW//re' +
  'av/63mr/+eR9//nrkf/65oL/+O6a//vicf/74Gz/++Bs//jtm//65oL/+eiF//nqjv/74Gz/++Bs//nrkf/654T/+uaB//jtmv/74Gz/++Bs//vic//z5ZX/' +
  '8Nh9//HhkP/65Xv/++Bs//vgbP/47Zj/+ueA//vhbf/56o//+eaD//nlgP/47Zn/++Bs//vgbP/74nL/+O6Z//rmgv/565L/+uV9//vgbP/74Gz/+O2X//rm' +
  'gf/65oH/+e2W//vgbP/74Gz/+uaA//nrj//65oL/9+uZ/+/Rav/vz2b/789m//Xqmf/65oL/+eiG//nqjP/74Wz/++Ft//nqj//66IT/+uaA//jumv/74Gz/' +
  '++Bs//vicv/w4pX/7NJ6/+7djP/65n3/++Bs//vgbP/47Zf/+uaA//rmgP/57Jb/++Bs//vgbP/65oH/8d+L//DYfP/y5Jb/8NFr/+/PZv/vz2f/9eqZ//rm' +
  'gP/56Ib/+eqM//vhbP/654H/+O2W//vgbP/74Gz/+uZ///nrkP/65oH/9+uY/+vLav/qyGT/6shk//TomP/65oH/+eiF//nqjv/74Gz/++Bs//nrkP/654T/' +
  '+uaB//XpmP/vz2b/789m//DSbv/y45T/8Nh8//Lij//65Xv/++Bs//vgbP/47Zf/+ueA//bgfv/465b/++Bs//vgbP/65n7/9uaP//bgfv/055f/68pp/+rI' +
  'ZP/qyGT/7+CW/+zTe//t1n//+emO//vgbP/74Gz/+euQ//rnhP/65oH/9emY/+/PZv/vz2b/8NJt//Ljlf/w2Hz/8eKQ//vle//74Gz/++Bs//jslv/24H7/' +
  '9tlp//bljf/66IT/+uaB//fsmv/22Wj/9tlo//bbbv/v4ZX/7NJ6/+7cjP/s0Xf/6shk/+rIZP/x4pT/+uaB//rmgf/47Jb/++Bs//vgbP/65oH/8d+K//DY' +
  'fP/y5Jb/79Fr/+/PZv/vz2f/9eqa//rmgf/56Ib/9uSK//bZaf/22Wn/9uWM//bigv/24H//9emY//bZaP/22Wj/9ttu//jtmf/65oL/+OuS/+zRdv/qyGT/' +
  '6shk/+7ekv/s03v/7NN7//bplf/74Gz/++Bs//rmgP/46Y7/+eWB//frmf/v0Wr/789m/+/PZ//x5Jf/8Nh9//Dbg//25In/9tlp//bhfv/16JT/9tlo//bZ' +
  'aP/24Hv/9uaO//bgf//26pj/++Jx//vgbP/74Gz/8+aY/+zTfP/s1oD/7dmI/+rIZP/qyGT/7tyL//rohf/65oL/+O2a//reav/63mr/+uBx//Lllf/w2H3/' +
  '8eGQ//DWdv/vz2b/789m//PklP/24H7/+uaB//bplf/22Wj/9tlo//bgfP/25o7/9uB+//XqmP/74nH/++Bs//vgbP/z5pj/7NJ6/+zVf//t2Yj/6shk/+rI' +
  'ZP/u3Iv/+ueD//rmgf/47Zr/+t5q//reav/64HL/+O2Y//rmgf/465P/8NZ3/+/PZv/vz2b/9OaV//rmgP/74W3/+eqP//bigv/24X7/9emY//bZaP/22Wj/' +
  '9ttu//jtmf/654L/+OuS/+zQdf/qyGT/6shk/+7ekf/s03v/7NN7//bplP/74Gz/++Bs//rmgP/46o7/+eWA//jtmf/74XD/++Bs//vgbP/06Jn/8Nl9//Hc' +
  'gv/56Yz/++Fs//vhbf/56o//+ueE//rmgf/37Jn/9tlo//bZaP/222//+OyY//rmgf/465H/7NF3/+rIZP/qyGT/7t+S/+zSev/s03r/9umV//vgbP/74Gz/' +
  '+uaB//jpjf/55H//+O2Y//vicf/74Gz/++Ft//jum//65oH/+eiG//nqjP/74Wz/+ueB//jtlv/74Gz/++Bs//rmfv/2547/9uF+//brl//74nH/++Bs//vg' +
  'bP/z5pf/7NN7/+3Wf//t2Yf/6shk/+rIZP/u3Iv/+uiE//rngf/47Zn/+t5q//reav/64HH/+O2X//rngf/57JP/+uV7//vgbP/74Gz/+OyX//rngP/65oH/' +
  '+e2X//vgbP/74Gz/+uZ///nrkf/65oH/+O2a//vicf/74Gz/++Bs//jtmv/65oH/+eiF/+7aiP/qyGT/6shk/+7bi//654T/+uaB//jtmf/63mr/+t5q//rg' +
  'cf/47Zj/+uaB//nsk//65Xv/++Bs//vgbP/47Zf/+uaA//vhbf/56o//+uiE//rmgf/47pr/++Bs//vgbP/74nL/+O2Z//rmgv/565H/+uV9//vgbP/74Gz/' +
  '9emW/+zTe//s03r/9umV//vgbP/74Gz/+uaB//jpjv/55YD/+O2Z//vhcP/74Gz/++Ft//jum//65oL/+eiG//nqjP/74Wz/++Ft//nqj//66IT/+uaB//ju' +
  'mv/74Gz/++Bs//vicv/47Zn/+uaB//nrkv/65X3/++Bs//vgbP/47Zf/+uaA//rmgf/57Jb/++Bs//vgbP/65oH/9uWM//bgfv/265j/++Fw//vgbP/74W3/' +
  '+O6b//rmgf/56Ib/+eqM//vhbP/654L/+O2W//vgbP/74Gz/+uZ+//nrkv/65oP/+O6a//vicf/74Gz/++Bs//jum//65oP/+eiH//nqjv/74Gz/++Bs//nr' +
  'kP/66IX/+uaD//frmf/22Wj/9tlo//bbb//47Zn/+uaD//nslP/65Xv/++Bs//vgbP/47Zf/+ueC//rmgP/47Zf/++Bs//vgbP/65oD/8d+M//DXfP/y5Zf/' +
  '++Jy//vgbP/74G3/+O6b//rmgf/654X/+eqP//vgbP/74Gz/+euQ//bhgP/2333/9emY//bZaP/22Wj/9txw//bplv/2333/9uaQ//rlfP/74Gz/++Bs//jt' +
  'mP/65oD/++Ft//nqjv/66IX/+ueC//XpmP/vz2b/789m/+/RbP/37Jn/+ueC//nskv/65Xz/++Bs//vgbP/47Jb/+ueC//rngv/26ZP/9tlo//bZaP/24H3/' +
  '9uaN//bhf//16pf/9tps//bZaP/22Wj/9+ya//rngv/56If/+eqL//vhbP/74W3/+eqP//rnhP/65oH/9eqZ/+/PZv/vz2b/8NJt//Lklf/w2Hz/8eCN//rm' +
  'fv/74Gz/++Bs//jtl//65oH/+uaB//bplP/22Wj/9tlo//bgfv/56o7/+uaB//jtmf/2223/9tlo//bZaf/37Jr/+uaB//nohv/56o3/++Fs//rngv/47Zb/' +
  '++Bs//vgbP/65n7/8uGO//Dafv/y5Jb/79Fr/+/PZv/vz2b/9eqY//rng//56Ib/+eqN//vgbP/74Gz/+eqP//bigf/24X//9+uY//vgbP/74Gz/++Jz//bq' +
  'lv/24X//9uiS//rle//74Gz/++Bs//jtl//654H/+uaA//jtlv/74Gz/++Bs//rmf//565D/+uaB//fsmf/w0Wv/789m/+/PZv/16Zn/+uaB//nohf/56o7/' +
  '++Bs//vgbP/565D/+ueD//rmgf/47Zr/++Bs//vgbP/74nP/+O2Y//rmgf/57JP/+uV7//vgbP/74Gz/+O2Y//rngP/74W3/+eqP//rohf/65oP/+O2a//vg' +
  'bP/74Gz/++Jy//Pml//w2X7/8uGP//rlff/74Gz/++Bs//jtl//65oL/+uaC//ntlv/74Gz/++Bs//rmgP/565D/+uaD//jumv/74XD/++Bs//vgbf/47pv/' +
  '+uaD//noh//56oz/++Fs//vhbf/56o//+eaC//nkfv/47Zr/++Bs//vgbP/74nL/+O2Z//rmgP/565H/+uV+//vgbP/74Gz/+OuX//bffP/24H3/+OyW//vg' +
  'bP/74Gz/+uaB//nqjv/65oD/+O2a//vhcf/74Gz/++Ft//jum//65oD/+eiF//nqjf/74Wz/+uaA//jslf/632v/+t9r//nkff/564//+uaA//jtmP/64nL/' +
  '++Ft//vhbf/47pn/+uaA//nnhf/25Ir/9tlp//bZaf/25o3/+ueD//rmgP/47Zn/++Ft//vhbf/643T/+O2X//rmgP/565L/+uV7//vhbf/74W3/+O2W//rm' +
  'f/8AQ4b/AE+Z/wA2cv8ANnL/AEGD/wBLlP8AQ4f/AFGd/wA6ef8AN3X/ADd1/wBSnf8AQ4f/AEWK/wBIjP8AM2r/ADNq/wBJjv8ARIn/AEOH/wBSnv8AOHX/' +
  'ADh1/wA8e/8AUJv/AEOH/wBNlv8AQIP/ADd1/wA3df8AUZv/AEOG/wA4df8ATJX/AESI/wBChf8AUp3/ADd0/wA3dP8AO3r/AFGe/wBDiP8ATZb/AEGE/wA3' +
  'dP8AN3T/AFCa/wA/fv8AP37/AE+Z/wA3dP8AN3T/AESH/wBLlP8AQ4j/AFKe/wA6eP8AN3T/ADd1/wBTn/8AQ4j/AEaL/wBKkv8AOHX/ADh1/wBLlP8ARYj/' +
  'AEOF/wBSnf8AN3T/ADd0/wA7ev8AT5j/AEB//wBKkP8AQYT/ADd0/wA3dP8AT5n/AD9//wBAf/8AT5n/ADd0/wA3dP8AQ4f/AEuU/wBEiP8AUZ3/ADp4/wA3' +
  'dP8AN3X/AFKe/wBEiP8AR4z/AEqS/wA4df8AQ4f/AFCZ/wA2cf8ANnH/AEGD/wBMlf8ARIj/AFGc/wA2b/8AMmn/ADJq/wBRnP8ARIj/AEaL/wBIjP8AMmn/' +
  'ADJp/wBJjv8ARYr/AESI/wBSnv8AN3T/ADd0/wA8e/8AUZz/AESI/wBOmP8AQIL/ADd0/wA3dP8AUZz/AEOH/wBChf8AT5n/ADZx/wA2cf8AQYL/AEyU/wBD' +
  'hv8AUZv/ADVu/wAyaf8AMmn/AE+Y/wBAf/8AQoT/AEeL/wAyaf8AMmn/AEmO/wBFiv8ARIj/AFKe/wA3dP8AN3T/ADt6/wBMk/8APHj/AEmM/wBAgf8AN3T/' +
  'ADd0/wBQm/8AQoX/ADZy/wBMk/8ARIj/AEKF/wBSnf8ANnH/ADZx/wA6d/8AT5j/AD9+/wBJj/8APnz/ADJp/wAyaf8ATpb/AD9+/wA/fv8AUJn/ADd0/wA3' +
  'dP8ARIj/AEuU/wBDh/8AUZz/ADBl/wAtYP8ALmH/AFGb/wBDh/8ARoz/AEqQ/wA2cv8ANnL/AEuS/wBFif8AQ4b/AFKd/wA2cf8ANnH/ADp2/wBSnv8ARIn/' +
  'AE6X/wA9ev8AMmn/ADJp/wBOlv8ARIj/AESI/wBQm/8AN3T/ADd0/wBDh/8ATJX/AESJ/wBRnP8AMGT/AC1g/wAtYf8AUJr/AESJ/wBHjf8ASY//ADZy/wBC' +
  'hf8AUJr/ADZx/wA2cf8AQoP/AEyT/wBDhf8AUp3/ADp5/wA3dP8AN3X/AFGb/wBAf/8AQoP/AEuT/wA3dP8AN3T/AE2V/wBFiv8ARIj/AFOf/wA3dP8AN3T/' +
  'ADx7/wBMkv8AO3f/AEiM/wBAgv8AN3T/ADd0/wBRm/8AQoX/AESI/wBQmv8ANnH/ADZx/wBCg/8ATZb/AESI/wBSnv8AOnn/ADd0/wA3dP8AUp//AESI/wBG' +
  'i/8AS5T/ADd0/wA3dP8ATZb/AEWK/wBEiP8AUp//ADd0/wA3dP8APHv/AEyT/wA8d/8ASIz/AECC/wA3dP8AN3T/AFGc/wBEiP8AOHX/AEyU/wBEiP8AQ4b/' +
  'AFKd/wA3dP8AN3T/ADt5/wBSnv8ARIj/AE2W/wBBg/8AN3T/ADd0/wBQm/8AQ4j/AEOI/wBQmv8AN3T/ADd0/wBEh/8ATJT/AESI/wBRm/8AMGT/AC1g/wAt' +
  'Yf8AUJv/AESI/wBHjP8ASpL/ADh1/wA4df8ATJT/AEWK/wBEh/8AUp7/ADd0/wA3dP8AO3r/AEuQ/wA5cf8ARYX/AEGE/wA3dP8AN3T/AFGb/wBDh/8AQ4f/' +
  'AFCa/wA3dP8AN3T/AESH/wBFh/8APHf/AEyS/wAwZf8ALWD/AC5h/wBQmv8ARIf/AEaM/wBKkv8AOHX/AEOH/wBQm/8AN3T/ADd0/wBChf8ATZX/AESH/wBQ' +
  'm/8ALl//ACpZ/wAqWf8AT5j/AESH/wBGi/8AS5P/ADd0/wA3dP8ATZX/AEWJ/wBEh/8AT5j/AC1g/wAtYP8AMmj/AEuQ/wA8d/8ASIz/AECC/wA3dP8AN3T/' +
  'AFCb/wBDh/8AP37/AE+a/wA3dP8AN3T/AEKF/wBJj/8AP3//AE6W/wAuXv8AKln/ACpZ/wBLj/8AOXL/ADx3/wBLkv8AN3T/ADd0/wBNlf8ARYr/AESI/wBP' +
  'mP8ALWD/AC1g/wAyZ/8ATJH/ADx3/wBIjP8AQIL/ADd0/wA3dP8AUJr/AD9+/wAyav8ASY7/AEWK/wBEh/8AUZz/ADJp/wAyaf8ANm//AEuP/wA5cf8ARIT/' +
  'ADdt/wAqWf8AKln/AEuQ/wBDh/8AQ4f/AFCb/wA3dP8AN3T/AESI/wBFhv8AO3f/AEyS/wAwZf8ALWD/AC5h/wBRm/8ARIf/AEaM/wBHiv8AMmr/ADJq/wBI' +
  'jf8AQoP/AECA/wBPmP8AMmn/ADJp/wA2b/8AUZz/AESJ/wBNl/8ANmz/ACpZ/wAqWf8ASYv/ADly/wA5cv8ATpf/ADd0/wA3dP8ARIf/AEuT/wBDhv8AUJv/' +
  'ADBl/wAtYP8ALWH/AE2U/wA8eP8AQH7/AEeK/wAyav8AP3//AE2V/wAyaf8AMmn/AD58/wBJj/8AQID/AE+Z/wA6ef8AN3T/ADd0/wBOlv8AOnP/ADx3/wBC' +
  'gP8AKln/ACpZ/wBEhP8ARov/AESJ/wBSnf8ANnH/ADZx/wA7eP8ATJP/ADx4/wBIjP8AN3D/AC1g/wAtYP8ATJH/AD9//wBDh/8ATpf/ADJp/wAyaf8APn3/' +
  'AEmO/wA/fv8AUJn/ADt5/wA3dP8AN3X/AE+W/wA5cf8AO3b/AEKA/wAqWf8AKln/AEWF/wBFiv8ARIj/AFKe/wA2cf8ANnH/ADt4/wBRnP8ARIj/AE6X/wA4' +
  'cf8ALWD/AC1g/wBNlP8AQ4f/ADh1/wBMlP8AQYP/AEB//wBPmP8AMmn/ADJp/wA2b/8AUZ3/AESI/wBNl/8ANmz/ACpZ/wAqWf8ASYr/ADly/wA5cv8ATpf/' +
  'ADd0/wA3dP8AQ4f/AEuT/wBDhv8AUZ3/ADp4/wA3dP8AN3X/AE+Y/wA8eP8AP37/AEqR/wA4df8AOHX/AEyU/wBFiv8ARIf/AFGb/wAyaf8AMmn/ADZw/wBR' +
  'nP8ARIf/AEyW/wA3bf8AKln/ACpZ/wBJi/8AOXH/ADlx/wBOl/8AN3T/ADd0/wBEh/8AS5H/AEOF/wBRnP8AOnn/ADd0/wA4df8AU5//AESH/wBGjP8ASpL/' +
  'ADh1/wBEh/8AUJv/ADd0/wA3dP8AQoX/AEmP/wBAf/8AT5j/ADp5/wA3dP8AN3T/AE6V/wA6cv8APHf/AEJ//wAqWf8AKln/AESE/wBFiv8ARIj/AFGd/wA2' +
  'cf8ANnH/ADt4/wBRnP8ARIj/AE6Y/wBAgv8AN3T/ADd0/wBQm/8ARIf/AEOH/wBQm/8AN3T/ADd0/wBChf8ATJb/AEOI/wBSnv8AOnn/ADd0/wA3dP8AUp7/' +
  'AEOI/wBFi/8AQ4D/ACpZ/wAqWf8ARIT/AEWK/wBDiP8AUp3/ADZx/wA2cf8AOnj/AFGc/wBDiP8ATpj/AECC/wA3dP8AN3T/AFGc/wBDh/8AOHX/AEyV/wBF' +
  'iv8ARIj/AFKf/wA3dP8AN3T/ADt6/wBRnv8ARIj/AE2W/wBBhP8AN3T/ADd0/wBPl/8AOXH/ADlx/wBOl/8AN3T/ADd0/wBEh/8AS5P/AEOG/wBSnf8AOnj/' +
  'ADd0/wA3df8AU5//AESI/wBGjP8ASpL/ADh1/wA4df8ATJX/AEWK/wBEh/8AUp//ADd0/wA3dP8AO3r/AFGd/wBEh/8ATZf/AEKE/wA3dP8AN3T/AFGc/wBD' +
  'h/8AQ4f/AFCa/wA3dP8AN3T/AESH/wBIjf8AQH7/AFCZ/wA6eP8AN3T/ADd1/wBTn/8ARIf/AEaM/wBKkv8AOHX/AESJ/wBQm/8AN3T/ADd0/wBChf8ATZf/' +
  'AEWK/wBSnv8AOnn/ADd0/wA3dP8AU5//AEWJ/wBHjP8AS5P/ADd0/wA3dP8ATZX/AEaL/wBFiv8AUJv/ADJp/wAyaf8AN3D/AFGc/wBFiv8AT5n/AECC/wA3' +
  'dP8AN3T/AFGc/wBEif8AQ4f/AFGb/wA3dP8AN3T/AEOG/wBGiP8AO3b/AE2U/wA7ef8AN3T/ADd1/wBTn/8AQ4f/AEWL/wBMlP8AN3T/ADd0/wBNlf8AQIH/' +
  'AD9+/wBPmP8AMmn/ADJp/wA3cf8ATpb/AD9+/wBLkf8AQYP/ADd0/wA3dP8AUZz/AEOH/wA4df8ATJT/AEaL/wBEiP8AT5n/AC1g/wAtYP8AMWb/AFGc/wBE' +
  'iP8ATZf/AEGD/wA3dP8AN3T/AFGb/wBEiP8ARIj/AE2U/wAyaf8AMmn/AD99/wBJjv8AQID/AE+Y/wA1bf8AMmn/ADJq/wBRnf8ARIj/AEeM/wBKkf8AOHX/' +
  'ADh1/wBMlP8ARYr/AEOI/wBQmf8ALWD/AC1g/wAyZ/8AS5H/ADt3/wBHiv8AQoT/ADd0/wA3dP8AUJv/AEOH/wBDh/8ATZX/ADJp/wAyaf8AP3//AEuT/wBD' +
  'iP8AUZz/ADVu/wAyaf8AMmr/AFGd/wBDiP8ARov/AEuS/wA4df8ARIj/AFCa/wA3dP8AN3T/AEKF/wBHiv8APHn/AEyS/wAxZf8ALWD/AC1g/wBQmf8ARIn/' +
  'AEaM/wBLk/8AN3T/ADd0/wBMlP8AQoL/AECA/wBQm/8AN3T/ADd0/wA7ev8AT5f/AECA/wBLkv8AQIL/ADd0/wA3dP8AUJv/AESI/wBDh/8AUJv/ADd0/wA3' +
  'dP8AQ4b/AEyV/wBDh/8AUZz/ADFm/wAtYP8ALWD/AFCa/wBDh/8ARYv/AEuU/wA3dP8AN3T/AE2W/wBEif8AQ4f/AFKe/wA3dP8AN3T/ADx7/wBRnf8AQ4f/' +
  'AE6Y/wBAgv8AN3T/ADd0/wBRnP8AQ4f/ADh1/wBMlf8ARov/AESJ/wBSnv8AN3T/ADd0/wA7ef8ATZT/ADx5/wBHiv8AQYP/ADd0/wA3dP8AUJv/AESJ/wBE' +
  'if8AUJr/ADd0/wA3dP8ARIf/AEyV/wBEif8AUp7/ADp4/wA3dP8AN3X/AFOg/wBEif8AR43/AEqS/wA4df8AOHX/AEyV/wBEh/8AQoT/AFKe/wA3dP8AN3T/' +
  'ADt6/wBRnf8AQ4f/AE2W/wBChf8AN3T/ADd0/wBQmv8AP33/AD99/wBQmv8AN3T/ADd0/wBEh/8AS5P/AEOH/wBSnv8AOnj/ADd0/wA4df8AU5//AEOH/wBG' +
  'i/8AS5L/ADh1/wBDhv8AT5n/ADZy/wA2cv8AQYP/AEyU/wBDhv8AUZ3/ADt5/wA4df8AOHX/AFKe/wBDh/8ARYr/AEeL/wAzav8AM2r/AEmO/wBFif8AQ4b/' +
  'AFKd/wA4df8AOHX/ADx7/wBQnP8AQ4b/AE2X/wBBgv8AOHX/ADh1/wBQm/8AQ4b/AGa+/wByzP8AWa//AFmv/wBku/8Absn/AGa+/wBzz/8AXbX/AFqy/wBa' +
  'sv8AdM//AGa+/wBowf8AasH/AFWn/wBVp/8AbMP/AGfA/wBmvv8AdM//AFuy/wBbsv8AX7b/AHPO/wBmvv8AcMr/AGO8/wBasv8AWrL/AHPO/wBmvv8AW7L/' +
  'AG/I/wBnv/8AZb3/AHTP/wBasf8AWrH/AF61/wB0z/8AZr//AG/K/wBkvf8AWrH/AFqx/wByzP8AYbb/AGG2/wByzP8AWrH/AFqx/wBnv/8Absj/AGa//wB0' +
  '0P8AXbT/AFqx/wBasv8AddD/AGa//wBpwv8Abcf/AFuy/wBbsv8Absj/AGe//wBlvv8AdM//AFqx/wBasf8AXrX/AHHK/wBit/8AbMT/AGS8/wBasf8AWrH/' +
  'AHLL/wBit/8AYrf/AHLL/wBasf8AWrH/AGa//wBuyf8AZ8D/AHTP/wBdtP8AWrH/AFqy/wB10P8AZ8D/AGnD/wBtxv8AW7L/AGa//wByzP8AWK7/AFiu/wBk' +
  'u/8Ab8n/AGe//wB0z/8AWKr/AFSm/wBUp/8AdM3/AGa//wBpwv8AasD/AFSm/wBUpv8Aa8L/AGjB/wBmv/8AddD/AFqx/wBasf8AX7b/AHPO/wBmv/8AcMv/' +
  'AGO7/wBasf8AWrH/AHPO/wBmv/8AZL7/AHLL/wBYrv8AWK7/AGO6/wBuyf8AZb3/AHPN/wBXqf8AVKb/AFSm/wBxyv8AYrf/AGS7/wBqv/8AVKb/AFSm/wBr' +
  'wv8AaMH/AGfA/wB0z/8AWrH/AFqx/wBetf8Ab8X/AF+v/wBrv/8AY7v/AFqx/wBasf8Ac83/AGS+/wBYr/8Absf/AGe//wBlvP8AdM7/AFiu/wBYrv8AXLL/' +
  'AHHK/wBhtf8Aa8P/AGC0/wBUpv8AVKb/AHDI/wBhtf8AYbX/AHLM/wBasf8AWrH/AGe//wBuyP8AZr7/AHPN/wBToP8AUJz/AFCd/wB0zP8AZr7/AGnC/wBs' +
  'xf8AWK//AFiv/wBtxv8AZ7//AGa9/wB0zv8AWK7/AFiu/wBcsv8AdND/AGfA/wBxy/8AX7P/AFSm/wBUpv8AcMn/AGfA/wBnwP8Ac83/AFqx/wBasf8AZr7/' +
  'AG/J/wBnwP8Ac83/AFOf/wBQnP8AUJ3/AHPM/wBnwP8AacP/AGzF/wBYr/8AZL3/AHLM/wBYrv8AWK7/AGS7/wBuyP8AZb3/AHTO/wBdtP8AWrH/AFqy/wBz' +
  'zf8AYrb/AGS6/wBuyP8AWrH/AFqx/wBwyf8AaMH/AGe//wB10P8AWrH/AFqx/wBftv8AbsT/AF6t/wBrv/8AY7v/AFqx/wBasf8Ac87/AGS9/wBmwP8Acsz/' +
  'AFiu/wBYrv8AZLv/AG/K/wBnwP8AddD/AF20/wBasf8AWrH/AHXQ/wBnwP8AacL/AG7I/wBasf8AWrH/AHDK/wBowf8AZ8D/AHXQ/wBasf8AWrH/AF+2/wBv' +
  'xf8AXq7/AGu+/wBju/8AWrH/AFqx/wBzzv8AZsD/AFuy/wBvyP8AZr//AGW9/wB0z/8AWrH/AFqx/wBetf8Adc//AGe//wBwyv8AZLz/AFqx/wBasf8Ac87/' +
  'AGa//wBmv/8Ac83/AFqx/wBasf8AZ77/AG/J/wBnv/8Ac83/AFOf/wBQnP8AUJz/AHPM/wBnv/8AacL/AG3G/wBbsv8AW7L/AG/I/wBowf8AZ7//AHXQ/wBa' +
  'sf8AWrH/AF61/wBtwf8AW6f/AGe4/wBkvP8AWrH/AFqx/wBzzv8AZr//AGa//wByzf8AWrH/AFqx/wBmv/8AaLv/AF6u/wBuxP8AU6D/AFCc/wBQnf8Acsv/' +
  'AGe//wBpwv8Abcb/AFuy/wBmv/8Ac83/AFqx/wBasf8AZb3/AG/J/wBnv/8Ac83/AE+Y/wBLlP8AS5T/AHHJ/wBnv/8AacL/AG7I/wBasf8AWrH/AG/J/wBo' +
  'wf8AZ7//AHLK/wBQnP8AUJz/AFWi/wBtw/8AXq7/AGq+/wBju/8AWrH/AFqx/wBzzv8AZr//AGG2/wByzP8AWrH/AFqx/wBlvf8AbMP/AGK2/wBwyP8AT5j/' +
  'AEuU/wBLlP8AbcD/AFqn/wBerP8Absb/AFqx/wBasf8Ab8n/AGjB/wBmv/8Accn/AFCc/wBQnP8AVaH/AG7D/wBerv8Aa7//AGO7/wBasf8AWrH/AHLM/wBh' +
  'tv8AVKf/AGvC/wBowf8AZr//AHTN/wBUpv8AVKb/AFiq/wBtwP8AWqf/AGa3/wBYpP8AS5T/AEuU/wBtwf8AZr//AGa//wBzzf8AWrH/AFqx/wBnv/8AZ7r/' +
  'AF6t/wBvxP8AU6D/AFCc/wBQnf8AdMz/AGa//wBpwv8Aab//AFSn/wBUp/8Aa8H/AGS5/wBit/8Accr/AFSm/wBUpv8AWKr/AHTP/wBnwP8AcMv/AFij/wBL' +
  'lP8AS5T/AGq8/wBaqP8AW6j/AHHJ/wBasf8AWrH/AGe+/wBtx/8AZb3/AHPM/wBTn/8AUJz/AFCd/wBwxP8AX6//AGK0/wBpvv8AVKf/AGG3/wBvx/8AVKb/' +
  'AFSm/wBgtP8Aa8P/AGK3/wByy/8AXbT/AFqx/wBasf8Accf/AFuo/wBerf8AZLP/AEuU/wBLlP8AZrf/AGjC/wBnwP8Adc//AFiu/wBYrv8AXbP/AG/E/wBf' +
  'r/8Aa7//AFqp/wBQnP8AUJz/AG7E/wBht/8AZr//AHHJ/wBUpv8AVKb/AGC0/wBrwv8AYbb/AHLK/wBdtP8AWrH/AFqy/wBxx/8AWqf/AF2s/wBks/8AS5T/' +
  'AEuU/wBnt/8AZ8H/AGa//wB1z/8AWK7/AFiu/wBds/8AdM//AGa//wBxy/8AW6n/AFCc/wBQnP8Ab8X/AGa//wBbsv8Absj/AGS5/wBit/8Accr/AFSm/wBU' +
  'pv8AWKr/AHTP/wBnwP8AcMr/AFej/wBLlP8AS5T/AGq7/wBbqP8AW6j/AHHJ/wBasf8AWrH/AGa+/wBtx/8AZb3/AHTP/wBdtP8AWrH/AFqy/wByyf8AXq//' +
  'AGK0/wBtxv8AW7L/AFuy/wBvyP8AaMH/AGa//wBzzf8AVKb/AFSm/wBYq/8AdM7/AGa//wBvyf8AWKT/AEuU/wBLlP8Aa7z/AFqn/wBap/8AcMn/AFqx/wBa' +
  'sf8AZ7//AG3G/wBlvP8Ac87/AF20/wBasf8AW7L/AHXQ/wBmv/8AacL/AG3H/wBbsv8AZsD/AHPN/wBasf8AWrH/AGW9/wBsw/8AYrf/AHHK/wBdtP8AWrH/' +
  'AFqx/wBwx/8AW6j/AF6t/wBjs/8AS5T/AEuU/wBmt/8AaMH/AGe//wB0z/8AWK7/AFiu/wBds/8Ac87/AGe//wBxy/8AY7v/AFqx/wBasf8Ac87/AGa//wBm' +
  'v/8Ac83/AFqx/wBasf8AZb7/AG/K/wBmv/8AdM//AF20/wBasf8AWrH/AHXQ/wBmv/8AaML/AGS0/wBLlP8AS5T/AGa3/wBowf8AZr//AHTO/wBYrv8AWK7/' +
  'AF2z/wB0z/8AZr//AHHL/wBju/8AWrH/AFqx/wBzzv8AZr//AFuy/wBvyf8AaML/AGfA/wB10P8AWrH/AFqx/wBetf8AdND/AGfA/wBwy/8AZL3/AFqx/wBa' +
  'sf8Accn/AFqo/wBaqP8Accn/AFqx/wBasf8AZ7//AG3H/wBlvf8AdM7/AF20/wBasf8AWrL/AHbR/wBnwP8AacP/AG3H/wBbsv8AW7L/AG/J/wBowf8AZ7//' +
  'AHXQ/wBasf8AWrH/AF61/wB0z/8AZ7//AHDL/wBkvf8AWrH/AFqx/wBzzv8AZr//AGa//wBzzf8AWrH/AFqx/wBnv/8AasH/AGK2/wByy/8AXbT/AFqx/wBa' +
  'sv8AdtD/AGe//wBpw/8Abcb/AFuy/wBnwP8Ac83/AFqx/wBasf8AZb3/AHDK/wBnwP8AddD/AF20/wBasf8AWrH/AHXQ/wBnwP8AacP/AG7H/wBasf8AWrH/' +
  'AG/J/wBowv8AZ8D/AHPM/wBUpv8AVKb/AFmr/wB0z/8AZ8D/AHHM/wBju/8AWrH/AFqx/wBzzv8AZ8D/AGa//wB0zv8AWrH/AFqx/wBmvv8AaLv/AF6s/wBw' +
  'xf8AXrX/AFqx/wBasv8AdtD/AGa+/wBowf8Ab8j/AFqx/wBasf8AcMn/AGK4/wBhtf8Acsn/AFSm/wBUpv8AWaz/AHDI/wBhtf8AbcT/AGS8/wBasf8AWrH/' +
  'AHTO/wBmvv8AW7L/AG7I/wBowv8AZ8D/AHHK/wBQnP8AUJz/AFSg/wBzzv8AZ8D/AHDL/wBkvP8AWrH/AFqx/wBzzf8AZ8D/AGbA/wBvx/8AVKb/AFSm/wBh' +
  'tf8Aa8L/AGK4/wBxyv8AV6n/AFSm/wBUp/8AdM7/AGfA/wBpw/8Abcb/AFuy/wBbsv8Ab8n/AGjB/wBmv/8Acsr/AFCc/wBQnP8AVaH/AG7D/wBerv8Aab3/' +
  'AGW9/wBasf8AWrH/AHPO/wBmv/8AZr//AHDI/wBUpv8AVKb/AGK2/wBuyP8AZr//AHPO/wBXqv8AVKb/AFWn/wB0zv8AZr//AGnC/wBtx/8AW7L/AGfB/wBy' +
  'zf8AWrH/AFqx/wBlvf8Aab7/AF+w/wBvxP8AU6D/AFCc/wBQnP8Acsv/AGfB/wBpw/8Absf/AFqx/wBasf8Ab8j/AGS6/wBiuP8Ac8z/AFqx/wBasf8AXrX/' +
  'AHHJ/wBiuP8AbsX/AGO7/wBasf8AWrH/AHPN/wBnwP8AZr//AHPO/wBasf8AWrH/AGW+/wBvyf8AZr//AHPN/wBUoP8AUJz/AFCc/wBzy/8AZr//AGjB/wBu' +
  'yP8AWrH/AFqx/wBwyv8AZ8H/AGa//wB10P8AWrH/AFqx/wBftv8AdM//AGa//wBwy/8AY7v/AFqx/wBasf8Ac87/AGa//wBbsv8Ab8j/AGnC/wBnwP8AddD/' +
  'AFqx/wBasf8AXrX/AHDG/wBfr/8Aar7/AGS8/wBasf8AWrH/AHPO/wBnwP8AZ8D/AHPN/wBasf8AWrH/AGe+/wBvyf8AZ8D/AHXQ/wBdtP8AWrH/AFqy/wB2' +
  '0P8AZ8D/AGrD/wBtxv8AW7L/AFuy/wBvyP8AZ77/AGW8/wB0z/8AWrH/AFqx/wBetf8AdM//AGa+/wBwyv8AZb3/AFqx/wBasf8Acsz/AGG1/wBhtf8Acsz/' +
  'AFqx/wBasf8AZ7//AG7I/wBmvv8AddD/AF20/wBasf8AWrL/AHbQ/wBmvv8AacL/AG3H/wBbsv8AZr7/AHHM/wBZr/8AWa//AGS7/wBvyf8AZr7/AHTP/wBe' +
  'tf8AW7L/AFuy/wB0z/8AZr7/AGjB/wBqwP8AVaf/AFWn/wBrwv8AaMD/AGa+/wB0z/8AW7L/AFuy/wBftv8Ac87/AGa+/wBwy/8AY7v/AFuy/wBbsv8Ac87/' +
  'AGa+/zV4sf9Ehr7/So3H/1OVzv88gr7/OX+7/zl/u/87gb3/VpjS/0eKxf9HiMD/NXix/zV4sf81eLH/S43F/0WIwf9codz/QojE/0KIxP9CiMT/SY/K/1ab' +
  '1v9Mjcb/QIG6/zV4sf81eLH/NXix/1GSyf9FiMH/To/H/zV4sf81eLH/MXSt/zZ4r/87fbX/PIPB/zZ/vf82f73/Nn+9/ziAvv8+g77/N3et/zN2r/8xdK3/' +
  'MXSt/zF0rf85ebD/QIK8/0iQzf9EjMr/RIzK/0SMyv9Hjsz/QIO8/zZ2rf8yda7/MXSt/zF0rf8ydK7/O3yz/zl7tP80d7D/MXSt/zF0rf8xdK3/OHu0/zd6' +
  'tP82f73/Nn+9/zZ/vf82f73/N367/zl6sv8xdK3/MXSt/zF0rf8xdK3/MXSt/zl7tP9Dh8L/RIzK/0SMyv9EjMr/RIzK/0OIxP82d67/MXSt/zF0rf8xdK3/' +
  'MXSt/zF0rf87fLX/MnSs/zF0rf8xdK3/MXSt/zJ0rP86e7T/Nn+9/zZ/vf82f73/Nn+9/zZ/vf86f7v/M3Ko/zF0rf8xdK3/MXSt/zF0rf80da3/P4G7/0SM' +
  'yv9EjMr/RIzK/0SMyv9EjMr/PoG6/zFyqf8xdK3/MXSt/zF0rf8xdK3/NXev/zd5sv8xdK3/MXSt/zF0rf8xdK3/OHu0/zd6tP82f73/Nn+9/zZ/vf82f73/' +
  'N367/zh5sf8xdK3/MXSt/zF0rf8xdK3/MXSt/zl7tP9Dh8L/RIzK/0SMyv9EjMr/RIzK/0OIxP82d67/MXSt/zF0rf8xdK3/MXSt/zF0rf87fbb/MnSs/zF0' +
  'rf8xdK3/MXSt/zF0rf9Ehbz/S5LP/zZ/vf82f73/Nn+9/0iQzP9Ii8b/UIzB/zN2r/8xdK3/MXSt/zV4sP9PjsX/TZDK/1GZ1/9EjMr/RIzK/0SMyv9bo+H/' +
  'R4nC/02Mwv8xdK3/MXSt/zF0rf87frb/SorB/02Pxv85e7T/MXSt/zF0rf8yda7/T4/F/z2Cvf9Chb//Q4fB/0SEvP88frb/PH22/zt+t/89fbX/RYS7/z+B' +
  'u/9BgLf/Onqx/zx9tf88frX/QoO6/0GFvv9Ghrz/O321/z5/uP86frj/Pn61/0WEvP8/f7j/PHqv/zl2rP85eLD/O3it/0F+s/8+gLn/RojB/zt/uf8/g73/' +
  'OIPD/0aQzv9Fh7//SIi+/zJ1rv8xdK3/MXSt/zV3sP9Li8P/QoC2/zt6sf8wcKf/MHCn/zBwp/9Egrf/QH+2/0aIwP8xdK3/MXSt/zF0rf86fLT/SInC/z91' +
  'o/8wZ5f/KmGR/yphkf8qYZL/RHqp/0OIw/9JktH/OIPD/ziDw/84g8P/OoG//zV2rf8xdK3/MXSt/zF0rf8xdK3/MnSs/zp6s/8wcKb/MHCn/zBwp/8wcKf/' +
  'MHCn/zd4sP80c6n/MXSt/zF0rf8xdK3/MXSt/zN1rP82c6f/KmGR/yphkf8qYZH/KmGR/yphkf82dav/OYLA/ziDw/84g8P/OIPD/ziDw/87frf/MXOq/zF0' +
  'rf8xdK3/MXSt/zF0rf82eLH/NHKo/zBwp/8wcKf/MHCn/zBwp/8xcKb/OXmw/zF0rf8xdK3/MXSt/zF0rf8xdK3/OHu0/y1jkv8qYZH/KmGR/yphkf8qYZH/' +
  'LmWU/zuBvf84g8P/OIPD/ziDw/84g8P/OoG//zV2rf8xdK3/MXSt/zF0rf8xdK3/MnSs/zp5sf8wb6X/MHCn/zBwp/8wcKf/MHCn/zd4sP80c6n/MXSt/zF0' +
  'rf8xdK3/MXSt/zN1rP82c6f/KmGR/yphkf8qYZH/KmGR/yphkf82dav/OYLA/ziDw/84g8P/OIPD/ziDw/8/gbr/O3yz/zF0rf8xdK3/MXSt/zd6sv89f7b/' +
  'P3ux/zJyqf8wcKf/MHCn/zFxqP89e7H/Pn20/zl7s/8xdK3/MXSt/zF0rf86fLT/PH63/zlunf8qYZH/KmGR/yphkf8tZJT/N26d/0OIw/89h8f/OIPD/ziD' +
  'w/84g8P/Q4zL/0KGwP9Eh8D/N3u1/zd7tf83e7X/RonB/0KHwv9Li8L/Nnmy/zZ5sv82ebL/O321/0mNxv9GicH/P4K8/zd7tf83e7X/N3u1/0qMxv9Ag73/' +
  'RYK3/zNxp/8zcaf/M3Gn/z16r/9Eh8D/TpLN/z6Fwv86gsD/OoLA/zuDwP9RltH/NHSr/0eFu/9Mi8P/VJDD/zd3rv80dKv/NHSr/zd3rv9Xk8b/SYrB/0aF' +
  'u/80dKv/NHSr/zR0q/9OjML/R4a8/1WRxf80daz/NHSr/zR0q/8+fbP/UpHG/1eZ0v9Ok87/RInF/0SJxf9FicX/YqXf/0eJwf9PjcP/NHSr/zR0q/8xdK3/' +
  'M3Ws/zh4sP8xdK3/MXSt/zF0rf8xdK3/MXSt/zl7tP8zc6r/MXSt/zF0rf8xdK3/MXSt/zV2rv82d67/MXSt/zF0rf8xdK3/MXSt/zF0rP88fbX/RIrH/0SM' +
  'yv9EjMr/RIzK/0SMyv9Ch8P/NXev/zF0rf8xdK3/MXSt/zF0rf85e7T/M3Ko/zF0rf8xdK3/MXSt/zF0rf80da3/N3iw/zF0rf8xdK3/MXSt/zF0rf8xdK3/' +
  'OXqy/zFyqf8xdK3/MXSt/zF0rf8xdK3/Nniw/0CDvf9EjMr/RIzK/0SMyv9EjMr/RIvI/z1/uf8xdK3/MXSt/zF0rf8xdK3/M3Ws/zh4sP8xdK3/MXSt/zF0' +
  'rf8xdK3/MXSt/zl7s/8ycqj/MXSt/zF0rf8xdK3/MXSt/zV2rv82d67/MXSt/zF0rf8xdK3/MXSt/zF0rP88fbX/RIrH/0SMyv9EjMr/RIzK/0SMyv9Ch8P/' +
  'NXev/zF0rf8xdK3/MXSt/zF0rf85e7T/M3Ko/zF0rf8xdK3/MXSt/zF0rf80da3/N3ev/zF0rf8xdK3/MXSt/zF0rf8xdK3/OXqy/zFyqf8xdK3/MXSt/zF0' +
  'rf8xdK3/Nniw/0CDvf9EjMr/RIzK/0SMyv9EjMr/RIvI/z1/uf8xdK3/MXSt/zF0rf8xdK3/MXSt/0aEuv9KiL7/M3Sq/zN0qv8zdKr/SIe8/0iJwf9UjsD/' +
  'NXWs/zN0qv8zdKr/OXiv/1ORx/9KiL3/Q4K3/zN0qv8zdKr/M3Sq/0+Nwv9Ghr7/YKPc/0WJxf9FicX/RYnF/0+Uz/9WmtX/Uo/E/zx7sf8zdKr/M3Sq/zR0' +
  'q/9Vk8b/Mm6i/zt3qv9Dhb3/SYvD/zt/uf84fLf/OHy3/zh9t/9MjsX/QYXB/0KDuv81d6//NXev/zV3r/9DhLv/QYXA/0yOx/85f7r/OX66/zl+uv88gbz/' +
  'S47I/0OEvP88eq//M3Ko/zNyqP8zcqj/RYK4/0CCvP9Ef7L/Mm6i/zJuov8qYZH/NWua/z59s/9Fi8f/Nn+9/zZ/vf82f73/OYK//0eLxv89e7D/N3qy/zF0' +
  'rf8xdK3/MXSt/0CAt/8+f7f/RY/O/ziDw/84g8P/OIPD/z6JyP9Eh8H/OnOk/zBsoP8taZ3/LWmd/y1qnv9AfK7/OXWo/zRrmv8qYZH/KmGR/yphkf8ybqL/' +
  'N3mx/zZ/vf82f73/Nn+9/zZ/vf83frv/OXmw/zF0rf8xdK3/MXSt/zF0rf8xdK3/OHq0/zh8t/84g8P/OIPD/ziDw/84g8P/OoG//zVxpv8taZ3/LWmd/y1p' +
  'nf8taZ3/LWmd/zh3rv8rYZH/KmGR/yphkf8qYZH/K2GR/zh4rv82frv/Nn+9/zZ/vf82f73/Nn+9/zqAvP8zcab/MXSt/zF0rf8xdK3/MXSt/zN0rP85e7T/' +
  'OIPD/ziDw/84g8P/OIPD/ziDw/87f7n/LmeZ/y1pnf8taZ3/LWmd/y1pnf8xbqH/NHCk/yphkf8qYZH/KmGR/yphkf8ybqL/N3mx/zZ/vf82f73/Nn+9/zZ/' +
  'vf83frv/OHiv/zF0rf8xdK3/MXSt/zF0rf8xdK3/OHq0/zh8t/84g8P/OIPD/ziDw/84g8P/OoG//zVxpv8taZ3/LWmd/y1pnf8taZ3/LWmd/zh3rv8rYZH/' +
  'KmGR/yphkf8qYZH/KmGR/z99s/9FjMj/Nn+9/zZ/vf82f73/QYnG/0SJxf9Ggrb/M3av/zF0rf8xdK3/M3av/0eHvf9DhLz/Q43M/ziDw/84g8P/OIPD/0eR' +
  '0P9Chb//Qnqr/y1pnf8taZ3/LWmd/zNvov9BfK//Qn2x/zFnl/8qYZH/KmGR/yphkf8+dKL/P3+3/0KCuf88gLr/PH63/zp6sv9Dg7r/Pn61/0WCuP87erD/' +
  'On23/zp4rv87ea//QoK4/0KBt/9AgLf/PIG8/z5/uP86fLT/Roe+/z19tP9BfrP/O3iu/zl6sf85d6z/Pnuw/0CBuf9Df7P/Oner/zh4r/85dan/NnKm/0SB' +
  'tf8xdK3/Q4W9/0iIv/9Lg7P/MGuf/y1pnf8taZ3/MWyg/0+Kvf9CfK7/OnGg/yphkf8qYZH/KmGR/0N5p/9DgLX/T47E/zF0rf8xdK3/MXSt/zt9tf9OkMj/' +
  'TpDJ/0KLyv84g8P/OIPD/zmDw/9Wndn/RIS8/0mLw/8xdK3/MXSt/zF0rf81dq7/NHGl/y1pnf8taZ3/LWmd/y1pnf8taZ3/OHet/ytgj/8qYZH/KmGR/yph' +
  'kf8qYZH/Mm2f/zRyqf8xdK3/MXSt/zF0rf8xdK3/MnSs/zl6sv84g8P/OIPD/ziDw/84g8P/OIPD/zuCvv80dKv/MXSt/zF0rf8xdK3/MXSt/zl6sv8uZ5n/' +
  'LWmd/y1pnf8taZ3/LWmd/zJvo/8xbJ7/KmGR/yphkf8qYZH/KmGR/ythkf84dq3/MXKq/zF0rf8xdK3/MXSt/zF0rf84erT/OHu2/ziDw/84g8P/OIPD/ziD' +
  'w/85gsD/OXu0/zF0rf8xdK3/MXSt/zF0rf81dq7/NXOo/y1pnf8taZ3/LWmd/y1pnf8taZ3/OHet/ytgj/8qYZH/KmGR/yphkf8qYZH/Mm2f/zR1q/8xdK3/' +
  'MXSt/zF0rf8xdK3/MnSs/zp8tf84g8P/OIPD/ziDw/84g8P/OIPD/zuCv/81da7/MXSt/zF0rf8xdK3/MXSt/zt7tP8ybJ7/LWmd/y1pnf8taZ3/L2uf/zVx' +
  'pf81b6L/K2KS/yphkf8qYZH/KmGR/y9llP86ea//NHWt/zF0rf8xdK3/MXSt/zR2r/85fLX/PYC7/ziDw/84g8P/OIPD/zmExP88hcL/PH64/zN2r/8xdK3/' +
  'MXSt/zF0rf81d7D/RIS7/0aCt/8ycKX/MnCl/zJwpf9Ggrb/RYfA/02FtP8xa57/MGqd/zBqnf82b6H/Tom9/0mJwP9Cg7v/NXew/zV3sP81d7D/T4/G/0SG' +
  'vv9UmtX/OoK//zqCv/86gr//RozI/06U0P9Qj8b/PH22/zV3sP81d7D/Nnix/1STyv+awOX/qM7t/7DU7/+43O7/pcnq/6LG6P+ixuj/pMjp/7vf8f+t0e3/' +
  'qdDu/5rA5f+awOX/msDl/67V8P+rzev/xOTy/6zN7P+szev/rM3r/7LT7v+/3vD/sNTt/6PJ6/+awOX/msDl/5rA5f+z2vL/qs3s/7DX8v+awOX/msDl/5S+' +
  '5/+Xwej/ocLh/6XM7/+hx+z/ocfs/6HH7P+iye3/psnp/5i/5P+WwOj/lL7n/5S+5/+Uvuf/msLn/6fH5P+01vP/sNLx/7DS8f+w0vH/stTy/6fH5f+Wv+X/' +
  'lb/o/5S+5/+Uvuf/lb7n/53E5/+dw+f/l8Hp/5S+5/+Uvuf/lL7n/53C5v+dwOL/ocfs/6HH7P+hx+z/ocfs/6HF6f+dv+H/lL7n/5S+5/+Uvuf/lL7n/5S+' +
  '5/+eweP/q8zp/7DS8f+w0vH/sNLx/7DS8f+szez/mb3g/5S+5/+Uvuf/lL7n/5S+5/+Uvuf/n8Pk/5S95v+Uvuf/lL7n/5S+5/+UveX/n8Dg/6HH7P+hx+z/' +
  'ocfs/6HH7P+hx+z/o8bn/5O63/+Uvuf/lL7n/5S+5/+Uvuf/lr3k/6bG5P+w0vH/sNLx/7DS8f+w0vH/sNLx/6XF5P+Tu+P/lL7n/5S+5/+Uvuf/lL7n/5m/' +
  '5P+bweX/lL7n/5S+5/+Uvuf/lL7n/53C5v+dwOL/ocfs/6HH7P+hx+z/ocfs/6HF6f+cvt//lL7n/5S+5/+Uvuf/lL7n/5S+5/+eweP/q8zp/7DS8f+w0vH/' +
  'sNLx/7DS8f+szez/mb3g/5S+5/+Uvuf/lL7n/5S+5/+Uvuf/n8Pk/5S95v+Uvuf/lL7n/5S+5/+Uvuf/qMrk/7Tb9f+hx+z/ocfs/6HH7P+x2PP/rtLt/63U' +
  '7v+WwOn/lL7n/5S+5/+Ywun/rtfy/7TU6f+93/b/sNLx/7DS8f+w0vH/xuf5/6zO6P+s1fD/lL7n/5S+5/+Uvuf/ncjt/6vS7/+w1vH/m8Xs/5S+5/+Uvuf/' +
  'lb/o/6/Y9P+lx+b/qMrm/6rM6P+nyeb/oMPj/6DD4/+hxOX/oMPk/6fK5v+lx+b/o8bl/53A4v+gw+X/oMPj/6XI5v+oyuj/qcvm/6DC4/+ixeT/ocTl/6HE' +
  '5P+nyuf/osXm/5vA4v+YveD/mr/j/5q+4f+gxOb/o8bm/6vN5/+ixOP/psfm/6XK7f+x1/L/qsvm/6jR7/+Vv+j/lL7n/5S+5/+Xwer/rdPv/6HH6P+ZxOv/' +
  'j7rl/4+65f+PuuX/ocvu/6LE4/+n0vL/lL7n/5S+5/+Uvuf/m8bs/6vQ7f+SveT/g7Li/32s3f99rN3/fazd/5fD7P+rzuv/tNr0/6XK7f+lyu3/pcrt/6TH' +
  '6f+YvN//lL7n/5S+5/+Uvuf/lL7n/5S+5v+ewOL/j7nk/4+65f+PuuX/j7rl/4+65f+Zv+X/lLre/5S+5/+Uvuf/lL7n/5S+5/+VveX/lbnc/32s3f99rN3/' +
  'fazd/32s3f99rN3/lrzi/6TI6v+lyu3/pcrt/6XK7f+lyu3/ocLi/5O85P+Uvuf/lL7n/5S+5/+Uvuf/msDl/5S53v+PuuX/j7rl/4+65f+PuuX/j7nk/5y+' +
  '3/+Uvuf/lL7n/5S+5/+Uvuf/lL7n/53C5f+Bq9j/fazd/32s3f99rN3/fazd/4Ku3P+kx+j/pcrt/6XK7f+lyu3/pcrt/6TH6f+YvN//lL7n/5S+5/+Uvuf/' +
  'lL7n/5S+5v+dv+D/jrnj/4+65f+PuuX/j7rl/4+65f+Zv+X/lLre/5S+5/+Uvuf/lL7n/5S+5/+VveX/lbnc/32s3f99rN3/fazd/32s3f99rN3/lrzi/6TI' +
  '6v+lyu3/pcrt/6XK7f+lyu3/pMbk/5vF6f+Uvuf/lL7n/5S+5/+ZxOr/oMbp/53D5P+RvOb/j7rl/4+65f+Qu+b/msTr/6DD4f+bxev/lL7n/5S+5/+Uvuf/' +
  'nMbs/6HF5/+Nt+D/fazd/32s3f99rN3/gK/f/4u34/+rzuv/qc7v/6XK7f+lyu3/pcrt/67U8f+pzOr/qM7s/53C5v+dwub/ncLm/6rQ7f+qzev/rNLu/5vB' +
  '5f+awOX/msDl/57E6P+v0/D/q8/q/6TK6v+dwub/ncLm/53C5v+u1PD/psnp/6LK7v+RueH/kbnh/5G54f+awuj/qM3v/7XY7v+oy+r/pcjp/6XI6f+myen/' +
  'udvw/5W84/+mzu3/rtHs/7HY7/+Yv+X/lbzj/5W84/+YwOX/s9rx/6zQ7P+mzu3/lbzj/5W84/+VvOP/rdXx/6jL5/+x2fL/lb3j/5W84/+VvOP/nsXo/7LX' +
  '7/+93ez/t9fv/63O7P+tzuz/rc7s/8jp9P+szuv/rtbx/5W84/+VvOP/lL7n/5a+5f+bvuD/lL7n/5S+5/+Uvuf/lL7n/5S+5/+eweT/lLzj/5S+5/+Uvuf/' +
  'lL7n/5S+5/+XvuT/mb3g/5S+5/+Uvuf/lL7n/5S+5/+Uvub/ocLi/67Q7v+w0vH/sNLx/7DS8f+w0vH/q8zr/5m/5P+Uvuf/lL7n/5S+5/+Uvuf/ncHk/5O6' +
  '4P+Uvuf/lL7n/5S+5/+Uvuf/lr7k/5u+4P+Uvuf/lL7n/5S+5/+Uvuf/lL7n/53A4f+Tu+P/lL7n/5S+5/+Uvuf/lL7n/5rA5f+nyOX/sNLx/7DS8f+w0vH/' +
  'sNLx/6/R7/+jxeX/lL7n/5S+5/+Uvuf/lL7n/5a+5f+bvuD/lL7n/5S+5/+Uvuf/lL7n/5S+5/+dweP/k7vh/5S+5/+Uvuf/lL7n/5S+5/+XvuT/mb3g/5S+' +
  '5/+Uvuf/lL7n/5S+5/+Uvub/ocLi/67Q7v+w0vH/sNLx/7DS8f+w0vH/q8zr/5m/5P+Uvuf/lL7n/5S+5/+Uvuf/ncHk/5O64P+Uvuf/lL7n/5S+5/+Uvuf/' +
  'lr7k/5q+3/+Uvuf/lL7n/5S+5/+Uvuf/lL7n/53A4f+Tu+P/lL7n/5S+5/+Uvuf/lL7n/5rA5f+nyOX/sNLx/7DS8f+w0vH/sNLx/6/R7/+jxeX/lL7n/5S+' +
  '5/+Uvuf/lL7n/5S+5/+nyeX/qdHv/5S84/+UvOP/lLzj/6fP7f+sz+z/r9bt/5a+5P+UvOP/lLzj/5nB5v+y2fH/qs7o/6LK6/+UvOP/lLzj/5S84/+t1vH/' +
  'qcvm/8bm8v+uzuz/rs7s/67O7P+42fD/vt7w/7DW7v+bw+f/lLzj/5S84/+VveP/stny/4+12/+XvuL/p8rr/67Q5v+ixeT/oMLi/6DC4v+gw+P/sdPp/6jM' +
  '6v+lyuf/mr7g/5q+4P+avuD/psrn/6nL6f+y1Oj/osTj/6LE4/+ixOP/pcfk/7LU6f+myuj/m8Hj/5S53f+Uud3/lLnd/6TK6P+lyOn/n8bo/4+12/+Ptdv/' +
  'fazd/4e15P+gwuH/rdPw/6HH7P+hx+z/ocfs/6TK7v+u0u3/nMLj/5rE6v+Uvuf/lL7n/5S+5/+hyev/osPh/7HW8v+lyu3/pcrt/6XK7f+q0PD/qs3n/5K8' +
  '4v+Lt+P/iLTh/4i04f+JteH/m8Tp/5W84v+GteT/fazd/32s3f99rN3/jrbg/5y+3/+hx+z/ocfs/6HH7P+hx+z/ocbq/52+3v+Uvuf/lL7n/5S+5/+Uvuf/' +
  'lL7n/53B5P+gwuL/pcrt/6XK7f+lyu3/pcrt/6TI6f+UuNr/iLTh/4i04f+ItOH/iLTh/4i04f+avuH/fqva/32s3f99rN3/fazd/36s3P+bvd3/oMbq/6HH' +
  '7P+hx+z/ocfs/6HH7P+jxuj/k7jb/5S+5/+Uvuf/lL7n/5S+5/+VveX/n7/e/6XK7f+lyu3/pcrt/6XK7f+lyu3/osTk/4ew2v+ItOH/iLTh/4i04f+ItOH/' +
  'jrbg/5C33v99rN3/fazd/32s3f99rN3/jrbg/5y+3/+hx+z/ocfs/6HH7P+hx+z/ocbq/5y93P+Uvuf/lL7n/5S+5/+Uvuf/lL7n/53B5P+gwuL/pcrt/6XK' +
  '7f+lyu3/pcrt/6TI6f+UuNr/iLTh/4i04f+ItOH/iLTh/4i04f+avuH/fqva/32s3f99rN3/fazd/32s3f+hwt//rtTw/6HH7P+hx+z/ocfs/6vR8f+sz+3/' +
  'o8nl/5bA6P+Uvuf/lL7n/5bA6P+nz+//qMji/6/U8v+lyu3/pcrt/6XK7f+z2fP/qMrn/5nD5/+ItOH/iLTh/4i04f+NueX/nMXq/53E6P+DsuL/fazd/32s' +
  '3f99rN3/kL7p/6TE4P+mx+L/pMXk/6LD4v+fv97/p8fi/6LC3/+mx+P/nb/f/6DD5f+cvd7/nL7e/6XH4v+lxd//pMTh/6XG5f+jw+H/oMDe/6rL4/+hwd//' +
  'ocTh/5y+3/+dwOH/mrzc/57A3/+kxuP/osTi/5m83f+av+L/l7rc/5W32v+jxeT/lL7n/6TP8P+rzej/oszu/4q24/+ItOH/iLTh/4u35P+q0/L/nMPm/428' +
  '6f99rN3/fazd/32s3f+Uw+7/osXk/67X8/+Uvuf/lL7n/5S+5/+cx+3/sdfx/7PW6f+t0/H/pcrt/6XK7f+lyu3/vuT2/6fK6P+q1fP/lL7n/5S+5/+Uvuf/' +
  'l77k/5O32v+ItOH/iLTh/4i04f+ItOH/iLTh/5m93/99qtr/fazd/32s3f99rN3/fazd/4y13/+Vudz/lL7n/5S+5/+Uvuf/lL7n/5S95f+evt3/pcrt/6XK' +
  '7f+lyu3/pcrt/6XK7f+lx+j/lbzi/5S+5/+Uvuf/lL7n/5S+5/+dwOH/h7Hb/4i04f+ItOH/iLTh/4i04f+PuOD/jLLZ/32s3f99rN3/fazd/32s3f99rNz/' +
  'mrze/5O85P+Uvuf/lL7n/5S+5/+Uvuf/nMHl/5/A4P+lyu3/pcrt/6XK7f+lyu3/pMjr/57B4/+Uvuf/lL7n/5S+5/+Uvuf/l77k/5W53f+ItOH/iLTh/4i0' +
  '4f+ItOH/iLTh/5m93/99qtr/fazd/32s3f99rN3/fazd/4y13/+Xu9//lL7n/5S+5/+Uvuf/lL7n/5S95f+fweD/pcrt/6XK7f+lyu3/pcrt/6XK7f+lx+j/' +
  'l77k/5S+5/+Uvuf/lL7n/5S+5/+eweL/i7Xf/4i04f+ItOH/iLTh/4q24/+RueL/kLbd/36t3v99rN3/fazd/32s3f+Br9//m77g/5W/5v+Uvuf/lL7n/5S+' +
  '5/+WwOn/ncPm/6PG5f+lyu3/pcrt/6XK7f+my+7/p8vs/6LF5v+WwOj/lL7n/5S+5/+Uvuf/l8Hp/6bK6P+jy+z/kbjg/5G44P+RuOD/osrs/6rN7P+kzO//' +
  'irTf/4mz3v+Js97/jrji/6nR8v+sz+r/pcvr/5m/5P+Zv+T/mb/k/7DX8f+py+f/vODy/6XI6f+lyOn/pcjp/67S7f+32vD/sdbv/57F6P+Zv+T/mb/k/5nA' +
  '5f+02vL/YIg7/26WSf91nVH/fqRa/2qRRf9mjkL/Zo5C/2iQRP+Bp13/cppP/3CYS/9giDv/YIg7/2CIO/91nFD/cJdN/4mwZP9wmEv/cJdL/3CXS/92nlL/' +
  'g6pf/3acUv9pkUX/YIg7/2CIO/9giDv/eqFV/3CXTP93n1L/YIg7/2CIO/9bhDX/X4c5/2aMQv9qk0T/ZY4//2WOP/9ljj//Z5BB/2qSRv9fhjr/XYY3/1uE' +
  'Nf9bhDX/W4Q1/2GJPP9rkUj/d6BR/3OcTf9znE3/c5xN/3WeT/9rkkj/XoY5/1yFNv9bhDX/W4Q1/1yFNv9kiz//Y4s+/16HOP9bhDX/W4Q1/1uENf9iij3/' +
  'Yog+/2WOP/9ljj//ZY4//2WOP/9ljUD/Yog//1uENf9bhDX/W4Q1/1uENf9bhDX/ZIpA/2+WS/9znE3/c5xN/3OcTf9znE3/cJhL/1+GPP9bhDX/W4Q1/1uE' +
  'Nf9bhDX/W4Q1/2WMQf9bhDb/W4Q1/1uENf9bhDX/W4Q2/2SKQf9ljj//ZY4//2WOP/9ljj//ZY4//2eOQ/9bgTb/W4Q1/1uENf9bhDX/W4Q1/12FOP9qkEb/' +
  'c5xN/3OcTf9znE3/c5xN/3OcTf9pkEX/WoI1/1uENf9bhDX/W4Q1/1uENf9fhzr/YYk8/1uENf9bhDX/W4Q1/1uENf9iij3/Yog+/2WOP/9ljj//ZY4//2WO' +
  'P/9ljUD/Yoc+/1uENf9bhDX/W4Q1/1uENf9bhDX/ZIpA/2+WS/9znE3/c5xN/3OcTf9znE3/cJhL/1+GPP9bhDX/W4Q1/1uENf9bhDX/W4Q1/2WMQf9bhDb/' +
  'W4Q1/1uENf9bhDX/W4Q1/26US/95olP/ZY4//2WOP/9ljj//dp9Q/3ObT/91nFH/XYY3/1uENf9bhDX/X4g5/3aeUf95n1X/gKla/3OcTf9znE3/c5xN/4my' +
  'Y/9xmE7/dJtP/1uENf9bhDX/W4Q1/2WOP/9ymk3/d59S/2KLPP9bhDX/W4Q1/1yFNv92n1H/apFG/22TSf9vlkv/bZNJ/2aMQv9mjUL/Zo1C/2aMQv9tlEr/' +
  'apFG/2mQRv9jiT//ZoxB/2aNQ/9skkj/bZRJ/2+VTP9mjEL/aI5E/2aNQv9njUP/bZRK/2iPRf9jiT//YIY8/2GIPf9hiD7/Z45E/2mQRf9wl03/Z45E/2uR' +
  'R/9pkkP/dp9Q/2+VTP9vmEr/XIU2/1uENf9bhDX/Xoc4/3ObTv9oj0T/YYo7/1eAMf9XgDH/V4Ax/2qSRP9ojkX/b5hJ/1uENf9bhDX/W4Q1/2OMPf9ymU3/' +
  'XoU5/094Kf9JciP/SXIj/0lyI/9jiz3/cJdL/3miU/9pkkP/aZJD/2mSQ/9pkUT/XoQ6/1uENf9bhDX/W4Q1/1uENf9bhDX/Y4pA/1d/Mf9XgDH/V4Ax/1eA' +
  'Mf9XgDH/YIg7/1uCOP9bhDX/W4Q1/1uENf9bhDX/XIQ3/1yCOf9JciP/SXIj/0lyI/9JciP/SXIj/12FOf9okUP/aZJD/2mSQ/9pkkP/aZJD/2aMQ/9agjX/' +
  'W4Q1/1uENf9bhDX/W4Q1/2CIO/9bgTf/V4Ax/1eAMf9XgDH/V4Ax/1eAMv9iiD7/W4Q1/1uENf9bhDX/W4Q1/1uENf9jij7/THMo/0lyI/9JciP/SXIj/0ly' +
  'I/9NdSj/aZBE/2mSQ/9pkkP/aZJD/2mSQ/9pkUT/XoQ6/1uENf9bhDX/W4Q1/1uENf9bhDX/Yok//1Z/Mf9XgDH/V4Ax/1eAMf9XgDH/YIg7/1uCOP9bhDX/' +
  'W4Q1/1uENf9bhDX/XIQ3/1yCOf9JciP/SXIj/0lyI/9JciP/SXIj/12FOf9okUP/aZJD/2mSQ/9pkkP/aZJD/2qPRv9jiz7/W4Q1/1uENf9bhDX/YYo7/2eO' +
  'Qv9li0H/WYIz/1eAMf9XgDH/WIEy/2OLPf9mjEP/Yos8/1uENf9bhDX/W4Q1/2OMPf9njkL/WH40/0lyI/9JciP/SXIj/0x1Jv9WfzH/cJdL/22WR/9pkkP/' +
  'aZJD/2mSQ/9zm03/bpVK/26WSv9iij7/Yoo+/2KKPv9wmEz/b5ZL/3ObT/9hiTz/YIg8/2CIPP9ljUD/dZxQ/3GYTf9qkkX/Yoo+/2KKPv9iij7/dZxQ/2uS' +
  'R/9rk0b/WYE1/1mBNf9ZgTX/Yoo+/26WSf96olb/bJRI/2mRRf9pkUX/apJF/32lWf9chDf/bpVJ/3SaUP95oFX/X4c6/1yEN/9chDf/X4c7/3yjWP9ymU//' +
  'bZVI/1yEN/9chDf/XIQ3/3WcUP9vlUv/eqFV/12EOP9chDf/XIQ3/2WNQP95oFX/gqhe/3uiVv9xmUz/cZlM/3GZTP+NtGn/cZhN/3WdUf9chDf/XIQ3/1uE' +
  'Nf9dhDf/YYc+/1uENf9bhDX/W4Q1/1uENf9bhDX/ZItA/1uDNv9bhDX/W4Q1/1uENf9bhDX/XoY5/1+GO/9bhDX/W4Q1/1uENf9bhDX/W4Q1/2aMQ/9ymkz/' +
  'c5xN/3OcTf9znE3/c5xN/2+XSv9fhzr/W4Q1/1uENf9bhDX/W4Q1/2OKP/9agTb/W4Q1/1uENf9bhDX/W4Q1/12FOP9hhz3/W4Q1/1uENf9bhDX/W4Q1/1uE' +
  'Nf9kikD/WoI1/1uENf9bhDX/W4Q1/1uENf9giDv/a5JI/3OcTf9znE3/c5xN/3OcTf9ym03/aI9E/1uENf9bhDX/W4Q1/1uENf9dhDf/YYc+/1uENf9bhDX/' +
  'W4Q1/1uENf9bhDX/Y4o//1qBNf9bhDX/W4Q1/1uENf9bhDX/XoY5/1+GO/9bhDX/W4Q1/1uENf9bhDX/W4Q1/2aMQ/9ymkz/c5xN/3OcTf9znE3/c5xN/2+X' +
  'Sv9fhzr/W4Q1/1uENf9bhDX/W4Q1/2OKP/9agTb/W4Q1/1uENf9bhDX/W4Q1/12FOP9ghz3/W4Q1/1uENf9bhDX/W4Q1/1uENf9kikD/WoI1/1uENf9bhDX/' +
  'W4Q1/1uENf9giDv/a5JI/3OcTf9znE3/c5xN/3OcTf9ym03/aI9E/1uENf9bhDX/W4Q1/1uENf9bhDX/bZNL/3GYTP9cgzf/XIM3/1yDN/9vlkr/cphN/3ed' +
  'VP9dhTj/XIM3/1yDN/9giDz/eqFW/3GXTv9qkUX/XIM3/1yDN/9cgzf/dZ1R/2+VTP+Lsmb/cZlM/3GZTP9xmUz/fKRX/4KpXv94n1T/Y4o+/1yDN/9cgzf/' +
  'XIQ3/3uiVv9XfjT/YIY8/22USf90mVD/Z45E/2SLQf9ki0H/ZYtB/3acU/9ulUn/a5JI/1+GPP9fhjz/X4Y8/2yTSf9tlEr/d51U/2aNQ/9mjUP/Zo1D/2mQ' +
  'Rv92nVP/bJNI/2KJP/9bgTf/W4E3/1uBN/9rkkj/a5JH/2iORP9XfjT/V340/0lyI/9TfC7/Z4xE/3KaTP9ljj//ZY4//2WOP/9okUL/c5tO/2SKQP9hijv/' +
  'W4Q1/1uENf9bhDX/aJBD/2iNRf91nk//aZJD/2mSQ/9pkkP/b5hJ/2+WTP9cgzj/VH0u/1F6K/9Reiv/Unss/2SMP/9ehTn/U3wt/0lyI/9JciP/SXIj/1d/' +
  'Mv9hhz7/ZY4//2WOP/9ljj//ZY4//2WNP/9iiD//W4Q1/1uENf9bhDX/W4Q1/1uENf9jij7/ZIpA/2mSQ/9pkkP/aZJD/2mSQ/9okET/W4E4/1F6K/9Reiv/' +
  'UXor/1F6K/9Reiv/YIc8/0pyJf9JciP/SXIj/0lyI/9KciT/YYY+/2SNP/9ljj//ZY4//2WOP/9ljj//Z49C/1l/N/9bhDX/W4Q1/1uENf9bhDX/XIQ3/2SJ' +
  'Qf9pkkP/aZJD/2mSQ/9pkkP/aZJD/2eOQ/9ReCz/UXor/1F6K/9Reiv/UXor/1Z+Mf9YgDT/SXIj/0lyI/9JciP/SXIj/1d/Mv9hhz7/ZY4//2WOP/9ljj//' +
  'ZY4//2WNP/9hhj//W4Q1/1uENf9bhDX/W4Q1/1uENf9jij7/ZIpA/2mSQ/9pkkP/aZJD/2mSQ/9okET/W4E4/1F6K/9Reiv/UXor/1F6K/9Reiv/YIc8/0py' +
  'Jf9JciP/SXIj/0lyI/9JciP/Z4xE/3KbTf9ljj//ZY4//2WOP/9vmEn/cZhM/2uRSP9dhjf/W4Q1/1uENf9dhjf/b5ZJ/22SSv9znE3/aZJD/2mSQ/9pkkP/' +
  'd6BR/22TSf9jij//UXor/1F6K/9Reiv/V4Ax/2SMQP9mjUH/T3gp/0lyI/9JciP/SXIj/1yFNv9pjkf/a5BJ/2iORf9njUT/Y4lB/2yRSv9njEX/bJFJ/2SI' +
  'Qf9mjEH/Yoc//2OIQP9rkEn/a49J/2mOR/9pkEX/aI5G/2WKQv9wlU3/Z4tE/2mNRv9iiD//Y4k//2CGPv9likL/ao9H/2mOR/9hhj7/YYc9/1+EPP9cgTn/' +
  'a5BI/1uENf9slUb/cZdN/2yTSP9TfC3/UXor/1F6K/9UfS7/c5pO/2WLQf9ZgjP/SXIj/0lyI/9JciP/YYo7/2qPR/91nlD/W4Q1/1uENf9bhDX/ZI0+/3if' +
  'U/95n1b/cptM/2mSQ/9pkkP/aZJD/4SsXv9tk0n/cptM/1uENf9bhDX/W4Q1/12FOf9afzf/UXor/1F6K/9Reiv/UXor/1F6K/9ghj3/SXEk/0lyI/9JciP/' +
  'SXIj/0lyI/9VfTD/W4E4/1uENf9bhDX/W4Q1/1uENf9bhDb/ZIlB/2mSQ/9pkkP/aZJD/2mSQ/9pkkP/aZBF/1yDOP9bhDX/W4Q1/1uENf9bhDX/Y4k//1B3' +
  'LP9Reiv/UXor/1F6K/9Reiv/V38z/1V7Mv9JciP/SXIj/0lyI/9JciP/SXIk/2CGPf9agjX/W4Q1/1uENf9bhDX/W4Q1/2KKPf9kikH/aZJD/2mSQ/9pkkP/' +
  'aZJD/2mRQ/9kikD/W4Q1/1uENf9bhDX/W4Q1/12FOf9cgjj/UXor/1F6K/9Reiv/UXor/1F6K/9ghj3/SXEk/0lyI/9JciP/SXIj/0lyI/9VfTD/XYQ5/1uE' +
  'Nf9bhDX/W4Q1/1uENf9bhDb/ZYpC/2mSQ/9pkkP/aZJD/2mSQ/9pkkP/aZFF/12FOP9bhDX/W4Q1/1uENf9bhDX/ZItA/1R8L/9Reiv/UXor/1F6K/9TfC3/' +
  'WYE1/1l/Nf9KcyT/SXIj/0lyI/9JciP/TXYn/2KIP/9chTf/W4Q1/1uENf9bhDX/XYY3/2OLP/9oj0X/aZJD/2mSQ/9pkkP/apNE/2uURv9njkP/XYY3/1uE' +
  'Nf9bhDX/W4Q1/16HOP9sk0n/a5NG/1iANP9YgDT/WIA0/2qSRf9vl0z/bpVK/1R8L/9Tey7/U3su/1h/M/9ymU7/cplP/2uTRv9fhzr/X4c6/1+HOv93n1L/' +
  'b5VL/4GpXP9pkUT/aZFE/2mRRP9zm07/e6NW/3ifVP9ljED/X4c6/1+HOv9ghzv/e6NX/6jNfP+224r/veCT/8Xlm/+y1Yf/r9KE/6/ShP+x1IX/yOie/7re' +
  'kP+33Yv/qM18/6jNfP+ozXz/vOGQ/7fZjv/R6qj/udiQ/7jYkP+42JD/v96W/8vmov+94JP/sdaF/6jNfP+ozXz/qM18/8Hmlf+32o7/v+ST/6jNfP+ozXz/' +
  'pMx1/6fOef+tzYT/s9mF/6/Ugf+v1IH/r9SB/7DWgv+z1Yj/psx6/6bOd/+kzHX/pMx1/6TMdf+pz3z/s9GL/8Hhlv+93ZP/vd2T/73dk/+/35X/s9KL/6bN' +
  'ef+lzXb/pMx1/6TMdf+kzHb/q9B//6vPf/+nz3j/pMx1/6TMdf+kzHX/qs5//6rMgP+v1IH/r9SB/6/Ugf+v1IH/rtKC/6rLgf+kzHX/pMx1/6TMdf+kzHX/' +
  'pMx1/6vNgf+414//vd2T/73dk/+93ZP/vd2T/7nYkP+nyn3/pMx1/6TMdf+kzHX/pMx1/6TMdf+tzoP/pMt1/6TMdf+kzHX/pMx1/6TLdv+ry4P/r9SB/6/U' +
  'gf+v1IH/r9SB/6/Ugf+v0YX/osd2/6TMdf+kzHX/pMx1/6TMdf+ly3j/sdCK/73dk/+93ZP/vd2T/73dk/+93ZP/sdCJ/6LJdf+kzHX/pMx1/6TMdf+kzHX/' +
  'p8x7/6nNff+kzHX/pMx1/6TMdf+kzHX/qs5//6rMgP+v1IH/r9SB/6/Ugf+v1IH/rtKC/6nKgP+kzHX/pMx1/6TMdf+kzHX/pMx1/6vNgf+414//vd2T/73d' +
  'k/+93ZP/vd2T/7nYkP+nyn3/pMx1/6TMdf+kzHX/pMx1/6TMdf+tzoP/pMt1/6TMdf+kzHX/pMx1/6TMdf+11Yz/wuaU/6/Ugf+v1IH/r9SB/7/jkv+73ZH/' +
  'vOKQ/6bOd/+kzHX/pMx1/6fQeP+95ZD/wNyY/8ron/+93ZP/vd2T/73dk//T7qj/uNiQ/7vjjv+kzHX/pMx1/6TMdf+t1n7/ud+N/77jkv+r1Hz/pMx1/6TM' +
  'df+lzXb/vuaR/7LSif+11Yz/t9eO/7TVi/+tz4T/rc+E/67PhP+tz4P/tNWL/7HTiP+v0ob/qsyA/6zPg/+tz4T/stSJ/7TVi/+1143/rc6E/6/Qhv+uz4T/' +
  'rs+E/7TWi/+v0Yb/qMx//6XJfP+ny33/p8t9/63Rg/+w0Yf/t9eP/67Phv+y04n/s9aG/8Dikv+21Y7/t9+J/6XNdv+kzHX/pMx1/6fQeP+74I//r9WD/6nT' +
  'ev+fyXD/n8lw/5/JcP+x2oP/rtCG/7fgiP+kzHX/pMx1/6TMdf+r1Hz/udyO/6HLdf+TwmT/jbxe/428Xv+NvF7/ptN5/7fZjv/C5Jb/s9aG/7PWhv+z1ob/' +
  'sdOH/6bJe/+kzHX/pMx1/6TMdf+kzHX/pMt1/6rMgv+fyHD/n8lw/5/JcP+fyXD/n8lw/6fMfP+jxnj/pMx1/6TMdf+kzHX/pMx1/6XLd/+ixXn/jbxe/428' +
  'Xv+NvF7/jbxe/428Xv+jyHn/stOG/7PWhv+z1ob/s9aG/7PWhv+tzYX/o8l1/6TMdf+kzHX/pMx1/6TMdf+ozXz/ocZ3/5/JcP+fyXD/n8lw/5/JcP+fyHH/' +
  'qcmA/6TMdf+kzHX/pMx1/6TMdf+kzHX/q82A/5C6ZP+NvF7/jbxe/428Xv+NvF7/kb1k/7HSh/+z1ob/s9aG/7PWhv+z1ob/sdOH/6bJe/+kzHX/pMx1/6TM' +
  'df+kzHX/pMt1/6nLgf+ex3D/n8lw/5/JcP+fyXD/n8lw/6fMfP+jx3j/pMx1/6TMdf+kzHX/pMx1/6XLd/+ixXn/jbxe/428Xv+NvF7/jbxe/428Xv+jyHn/' +
  'stOG/7PWhv+z1ob/s9aG/7PWhv+w0Yj/q9J9/6TMdf+kzHX/pMx1/6nSev+u04L/q9CA/6HLcv+fyXD/n8lw/6DKcf+q03z/rc6F/6vTfP+kzHX/pMx1/6TM' +
  'df+s1H3/rtGD/5vGcP+NvF7/jbxe/428Xv+Qv2H/msZt/7jYjv+32or/s9aG/7PWhv+z1ob/vN+P/7bYjP+224v/q89//6vPf/+rz3//uN2N/7fZjf+634//' +
  'qc59/6jNff+ozX3/rNKB/7zgkf+424//staG/6vPf/+rz3//q89//7zhkf+z1Yn/sNiF/5/HdP+fx3T/n8d0/6jQfP+12ov/wuKZ/7XXi/+y1Ij/stSI/7PU' +
  'iP/F5Jz/pMp3/7XbiP+63ZL/v+WU/6fNev+kynf/pMp3/6fNev/C55f/ud2P/7XbiP+kynf/pMp3/6TKd/+844//tdaN/8DnlP+kynj/pMp3/6TKd/+t04D/' +
  'wOSV/8njof/D4Zr/utmS/7rZkv+62ZL/1e6s/7jaj/+85JD/pMp3/6TKd/+kzHX/pMt3/6jKf/+kzHX/pMx1/6TMdf+kzHX/pMx1/6vNgf+jynb/pMx1/6TM' +
  'df+kzHX/pMx1/6bLev+myXz/pMx1/6TMdf+kzHX/pMx1/6TMdf+tzYX/u9uS/73dk/+93ZP/vd2T/73dk/+314//p8x7/6TMdf+kzHX/pMx1/6TMdf+rzYD/' +
  'osd2/6TMdf+kzHX/pMx1/6TMdf+ly3j/qMp+/6TMdf+kzHX/pMx1/6TMdf+kzHX/qsyB/6LJdf+kzHX/pMx1/6TMdf+kzHX/qM18/7PSjP+93ZP/vd2T/73d' +
  'k/+93ZP/vNyT/6/Qhv+kzHX/pMx1/6TMdf+kzHX/pMt3/6jKf/+kzHX/pMx1/6TMdf+kzHX/pMx1/6vNgf+iyHX/pMx1/6TMdf+kzHX/pMx1/6bLev+myXz/' +
  'pMx1/6TMdf+kzHX/pMx1/6TMdf+tzYX/u9uS/73dk/+93ZP/vd2T/73dk/+314//p8x7/6TMdf+kzHX/pMx1/6TMdf+rzYD/osd2/6TMdf+kzHX/pMx1/6TM' +
  'df+ly3j/p8l+/6TMdf+kzHX/pMx1/6TMdf+kzHX/qsyB/6LJdf+kzHX/pMx1/6TMdf+kzHX/qM18/7PSjP+93ZP/vd2T/73dk/+93ZP/vNyT/6/Qhv+kzHX/' +
  'pMx1/6TMdf+kzHX/pMx1/7PUjP+434v/o8l3/6PJd/+jyXf/td2J/7nbj/+94pP/pct4/6PJd/+jyXf/p857/8Dmlf+32Y7/sdeF/6PJd/+jyXf/o8l3/7zj' +
  'j/+21o7/0+yq/7rZkv+62ZL/utmS/8Xim//K5qH/vuKU/6rRfv+jyXf/o8l3/6TKd//B55b/nMJy/6XLe/+014v/u9qS/6/Rhf+szoP/rM6D/63Og/+93ZX/' +
  'tdiM/7LWiP+nyn3/p8p9/6fKff+z14n/tdeM/77dlv+vz4b/rs+F/67Phf+x0oj/vt2V/7PWiv+pzn//osZ4/6LGeP+ixnj/steI/7LUif+t04P/nMJy/5zC' +
  'cv+NvF7/l8Vp/6zMhf+7343/r9SB/6/Ugf+v1IH/steE/7vdkP+qz3//qtJ7/6TMdf+kzHX/pMx1/7DXgv+vzof/v+GS/7PWhv+z1ob/s9aG/7ncjP+3147/' +
  'ost1/5vHbP+YxGn/mMRp/5nEav+q033/osl4/5fGaP+NvF7/jbxe/428Xv+bxHD/qMp//6/Ugf+v1IH/r9SB/6/Ugf+u04H/qcmB/6TMdf+kzHX/pMx1/6TM' +
  'df+kzHX/qs6A/6zNg/+z1ob/s9aG/7PWhv+z1ob/sdOG/6HEeP+YxGn/mMRp/5jEaf+YxGn/mMRp/6fKfv+Ou2D/jbxe/428Xv+NvF7/jbxf/6fIgP+u04D/' +
  'r9SB/6/Ugf+v1IH/r9SB/7DShf+hxHb/pMx1/6TMdf+kzHX/pMx1/6TLd/+ryoT/s9aG/7PWhv+z1ob/s9aG/7PWhv+vz4b/lr9q/5jEaf+YxGn/mMRp/5jE' +
  'af+dxXD/ncRz/428Xv+NvF7/jbxe/428Xv+bxHD/qMp//6/Ugf+v1IH/r9SB/6/Ugf+u04H/qMiA/6TMdf+kzHX/pMx1/6TMdf+kzHX/qs6A/6zNg/+z1ob/' +
  's9aG/7PWhv+z1ob/sdOG/6HEeP+YxGn/mMRp/5jEaf+YxGn/mMRp/6fKfv+Ou2D/jbxe/428Xv+NvF7/jbxe/63Nhv+74I7/r9SB/6/Ugf+v1IH/ud2L/7nb' +
  'jv+y1of/ps53/6TMdf+kzHX/ps53/7bdif+00oz/veCQ/7PWhv+z1ob/s9aG/8HjlP+01Yz/qNJ8/5jEaf+YxGn/mMRp/53Jbv+r037/q9GA/5PCZP+NvF7/' +
  'jbxe/428Xv+gznH/sM+J/7LRiv+w0If/rs6G/6rKg/+y0ov/rc2H/7LTiv+qyoL/rc+D/6jJgP+pyoH/sdKK/7HQiv+wz4j/sdGI/6/OiP+ryoX/t9WP/63M' +
  'hv+u0Ib/qMqA/6rMgP+myH//qsyD/7DRif+uz4f/psh+/6fLff+kxnz/ocR6/7DRiP+kzHX/tN2F/7fZjv+x24T/msZr/5jEaf+YxGn/m8ds/7nhjP+p0ID/' +
  'ncxu/428Xv+NvF7/jbxe/6XTdv+v0Yf/vuaP/6TMdf+kzHX/pMx1/6zVff+/5JP/wd6X/7zejv+z1ob/s9aG/7PXh//N7aD/tNaK/7rji/+kzHX/pMx1/6TM' +
  'df+ly3n/oMR3/5jEaf+YxGn/mMRp/5jEaf+YxGn/psl9/426X/+NvF7/jbxe/428Xv+NvF7/msNu/6LFef+kzHX/pMx1/6TMdf+kzHX/pMt2/6rJg/+z1ob/' +
  's9aG/7PWhv+z1ob/s9aG/7LTiP+kyXj/pMx1/6TMdf+kzHX/pMx1/6rLgf+XwGr/mMRp/5jEaf+YxGn/mMRp/57Gcv+ZwHD/jbxe/428Xv+NvF7/jbxe/428' +
  'X/+mx37/osp0/6TMdf+kzHX/pMx1/6TMdf+qzn7/q8uD/7PWhv+z1ob/s9aG/7PWhv+y1Ib/q82C/6TMdf+kzHX/pMx1/6TMdf+ly3n/osZ4/5jEaf+YxGn/' +
  'mMRp/5jEaf+YxGn/psl9/426X/+NvF7/jbxe/428Xv+NvF7/msNu/6XIev+kzHX/pMx1/6TMdf+kzHX/pMt2/6zMhP+z1ob/s9aG/7PWhv+z1ob/s9aG/7LT' +
  'iP+ly3n/pMx1/6TMdf+kzHX/pMx1/6vNgv+bxG3/mMRp/5jEaf+YxGn/msZr/6DIdP+dxHP/jr1f/428Xv+NvF7/jbxe/5HAYv+oyn//pc13/6TMdf+kzHX/' +
  'pMx1/6bPd/+rz4D/sNGG/7PWhv+z1ob/s9aG/7TXh/+114n/r9GF/6bOd/+kzHX/pMx1/6TMdf+nz3j/s9WK/7HZhf+fx3P/n8dz/5/Hc/+w2IT/ttmN/7La' +
  'h/+Zwmz/mMFr/5jBa/+cxnD/t96M/7nbj/+z2If/p8x7/6fMe/+nzHv/vuSS/7bWjf/J6J//stOH/7LTh/+y04f/vNyR/8Tjmf+/45T/rdKB/6fMe/+nzHv/' +
  'qM18/8Lnl/8fZDr/GF0z/xZbMf8UWS//F1wy/xVaMP8XXDL/Flsx/xVaMP9LkGb/XqN5/12ieP8YXTP/Flsx/xleNP8fZDr/H2Q6/xhdM/8WWzH/FFkv/xdc' +
  'Mv8VWjD/Flsx/xZbMf8VWjD/HWI4/x5jOf8gZTv/FVow/xZbMf8ZXjT/H2Q6/xhdM/8nbEL/S5Bm/zh9U/8UWS//Flsx/xRZL/8XXDL/F1wy/xpfNf82e1H/' +
  'I2g+/xZbMf8XXDL/FFkv/xhdM/8YXTP/FFkv/xdcMv8WWzH/FFkv/xZbMf8UWS//F1wy/xdcMv8UWS//Gl81/xZbMf85flT/So9l/yVqQP8YXTP/Flsx/0qP' +
  'Zf9UmW//Vptx/xpfNf8XXDL/F1wy/xVaMP8VWjD/F1wy/xdcMv8WWzH/Flsx/xRZL/8XXDL/Flsx/xZbMf8XXDL/FFkv/xZbMf8WWzH/F1wy/xdcMv8VWjD/' +
  'FVow/xdcMv8XXDL/HmM5/1abcf9UmW//SI1j/xZbMf8VWjD/N3xS/1eccv9LkGb/GV40/yNoPv8UWS//F1wy/xdcMv8UWS//FVow/xRZL/8XXDL/F1wy/xVa' +
  'MP8aXzX/GV40/xVaMP8XXDL/F1wy/xRZL/8WWzH/FFkv/xdcMv8XXDL/FFkv/x5jOf8XXDL/TJFn/1eccv81elD/FFkv/xdcMv8UWS//HGE3/xpfNf9ZnnT/' +
  'X6R6/z2CWP8VWjD/FVow/xZbMf8WWzH/F1wy/xNYLv8WWzH/I2g+/1WacP9VmnD/IWY8/xZbMf8UWS//H2Q6/x9kOv8bYDb/FVow/xVaMP85flT/Vptx/0yR' +
  'Z/8WWzH/HGE3/xRZL/8XXDL/FVow/xVaMP8XXDL/JWpA/1+kev9eo3n/TpNp/xZbMf8WWzH/Flsx/xRZL/8XXDL/FVow/xdcMv8zeE7/VZpw/1WacP8wdUv/' +
  'F1wy/xdcMv8fZDr/HmM5/x1iOP8WWzH/Flsx/0qPZf9UmW//V5xy/xtgNv8XXDL/Flsx/xVaMP8XXDL/FFkv/xtgNv8WWzH/QIVb/1CVa/8ma0H/Flsx/xZb' +
  'Mf8UWS//F1wy/xZbMf8WWzH/G2A2/xpfNf9Ch13/QYZc/yBlO/86f1X/JGk//xpfNf8eYzn/Flsx/xZbMf8WWzH/JmtB/0mOZP82e1H/Flsx/xtgNv8VWjD/' +
  'Flsx/xZbMf8dYjj/HmM5/x9kOv8WWzH/Flsx/xZbMf8WWzH/Flsx/xZbMf8WWzH/Flsx/yBlO/8eYzn/HWI4/xZbMf8WWzH/TZJo/16jef9donj/Gl81/xZb' +
  'Mf8WWzH/Flsx/xZbMf8WWzH/Flsx/xZbMf8gZTv/HmM5/x1iOP8WWzH/FVow/x1iOP8eYzn/IGU7/xVaMP8WWzH/Flsx/xZbMf8WWzH/Flsx/xZbMf8WWzH/' +
  'IGU7/x5jOf8dYjj/FVow/xVaMP9LkGb/XqN5/12ieP8ZXjT/Flsx/xZbMf8WWzH/Flsx/xZbMf8WWzH/Flsx/yBlO/8eYzn/HWI4/xVaMP88gVf/GF0z/xtg' +
  'Nv8WWzH/L3RK/0iNY/8ma0H/F1wy/xZbMf8nbEL/So9l/zh9U/8WWzH/Gl81/xRZL/8XXDL/Flsx/xpfNf83fFL/I2g+/xZbMf8XXDL/FFkv/xdcMv8WWzH/' +
  'J2xC/0qPZf84fVP/Flsx/xpfNf8bYDb/R4xi/1WacP8xdkz/F1wy/xdcMv9VmnD/VJlv/0mOZP8WWzH/Flsx/0qPZf9UmW//Vptx/xxhN/8XXDL/Flsx/xVa' +
  'MP8VWjD/FVow/xdcMv8VWjD/Flsx/xRZL/8WWzH/Flsx/xZbMf9Kj2X/VJlv/1abcf8cYTf/F1wy/zR5T/9VmnD/VJlv/yFmPP8WWzH/E1gu/0uQZv9XnHL/' +
  'NntR/xZbMf8WWzH/NXpQ/1abcf9LkGb/FFkv/xZbMf8UWS//F1wy/xdcMv8UWS//HWI4/xRZL/8XXDL/F1wy/xZbMf8cYTf/G2A2/zh9U/9Wm3H/S5Bm/xRZ' +
  'L/8WWzH/IWY8/1OYbv8YXTP/Flsx/xZbMf8XXDL/FVow/xxhN/8WWzH/H2Q6/yBlO/8WWzH/GV40/xRZL/8XXDL/Flsx/xZbMf8UWS//FFkv/zl+VP9Wm3H/' +
  'Roth/xNYLv8VWjD/JWpA/16jef9eo3n/JGk//xtgNv8VWjD/F1wy/xZbMf8WWzH/Flsx/xZbMf8XXDL/FFkv/xdcMv8WWzH/F1wy/xtgNv8eYzn/HmM5/xpf' +
  'Nf8XXDL/Flsx/xZbMf8UWS//F1wy/xZbMf8WWzH/So9l/1SZb/9Wm3H/GF0z/xdcMv84fVP/XqN5/16jef83fFL/F1wy/xZbMf8WWzH/FFkv/xdcMv8WWzH/' +
  'GV40/xRZL/8XXDL/FVow/xRZL/8WWzH/FFkv/x1iOP8dYjj/HWI4/zp/Vf8obUP/Flsx/xdcMv8VWjD/M3hO/zJ3Tf8nbEL/SY5k/zV6UP8UWS//Flsx/xpf' +
  'Nf9Kj2X/SY5k/xpfNf8aXzX/Flsx/xZbMf8XXDL/FFkv/xleNP8fZDr/GV40/xZbMf8UWS//F1wy/xVaMP8XXDL/Flsx/xVaMP9Nkmj/XqN5/16jef8aXzX/' +
  'Flsx/zJ3Tf9fpHr/X6R6/zF2TP8WWzH/FFkv/xdcMv8VWjD/F1wy/xZbMf8VWjD/HWI4/x5jOf8gZTv/FVow/xZbMf8ZXjT/H2Q6/x9kOv8YXTP/Flsx/xRZ' +
  'L/8XXDL/FVow/xZbMf8WWzH/FVow/0uQZv9eo3n/XaJ4/xleNP8WWzH/MXZM/1+kev9fpHr/L3RK/xZbMf8UWS//F1wy/xVaMP8WWzH/Flsx/xVaMP8dYjj/' +
  'HmM5/yBlO/8VWjD/Flsx/xleNP8fZDr/GF0z/ydsQv9LkGb/OH1T/xRZL/8WWzH/FFkv/xdcMv8XXDL/Gl81/zZ7Uf8jaD7/Flsx/xdcMv8VWjD/MHVL/y90' +
  'Sv8obUP/S5Bm/zd8Uv8UWS//Flsx/xRZL/8XXDL/F1wy/xRZL/8aXzX/Flsx/xZbMf8XXDL/FFkv/xhdM/8WWzH/So9l/1SZb/9Wm3H/HGE3/xdcMv8XXDL/' +
  'FVow/xVaMP8XXDL/F1wy/xZbMf8WWzH/FFkv/xdcMv8WWzH/Flsx/0qPZf9UmW//Vptx/xhdM/8XXDL/F1wy/xVaMP8VWjD/F1wy/xdcMv8WWzH/Flsx/xRZ' +
  'L/8XXDL/Flsx/xVaMP83fFL/V5xy/0qPZf8WWzH/H2Q6/xRZL/8XXDL/F1wy/xRZL/8VWjD/FFkv/xdcMv8XXDL/FVow/xRZL/8VWjD/N3xS/1eccv9DiF7/' +
  'FFkv/xZbMf8UWS//F1wy/xdcMv8UWS//HmM5/xVaMP8XXDL/F1wy/xVaMP8UWS//F1wy/xRZL/8cYTf/F1wy/1WacP9fpHr/PYJY/xVaMP8VWjD/Flsx/xZb' +
  'Mf8XXDL/E1gu/xZbMf8UWS//F1wy/xdcMv8UWS//G2A2/xRZL/8fZDr/H2Q6/xtgNv8VWjD/FVow/zl+VP9Wm3H/TZJo/xVaMP8WWzH/FFkv/xdcMv8VWjD/' +
  'FVow/xdcMv8fZDr/X6R6/16jef9PlGr/Flsx/xZbMf8WWzH/FFkv/xdcMv8VWjD/F1wy/xZbMf8VWjD/FVow/xVaMP8XXDL/F1wy/x9kOv8eYzn/HWI4/xZb' +
  'Mf8WWzH/SY5k/1SZb/9XnHL/G2A2/xdcMv8WWzH/FVow/xdcMv8UWS//G2A2/xZbMf88gVf/T5Rq/ydsQv8WWzH/Flsx/xRZL/8XXDL/Flsx/yVqQP85flT/' +
  'Gl81/xZbMf8XXDL/FFkv/xtgNv8WWzH/Gl81/x5jOf8XXDL/MHVL/y90Sv8kaT//RIlf/zF2TP8WWzH/G2A2/xVaMP8WWzH/Flsx/x1iOP8eYzn/H2Q6/xZb' +
  'Mf8WWzH/Flsx/xZbMf8WWzH/Flsx/xZbMf8bYDb/XqN5/16jef9IjWP/Flsx/xZbMf8dYjj/HmM5/x9kOv8WWzH/Flsx/zB1S/9Wm3H/Vptx/y5zSf8WWzH/' +
  'Flsx/yBlO/8eYzn/HWI4/xZbMf8VWjD/HWI4/x5jOf8gZTv/FVow/xZbMf8WWzH/Flsx/xZbMf8WWzH/Flsx/xpfNf9eo3n/XqN5/0KHXf8VWjD/FVow/x1i' +
  'OP8eYzn/IGU7/xVaMP8WWzH/LnNJ/1abcf9Wm3H/LnNJ/xZbMf8WWzH/IGU7/x5jOf8dYjj/FVow/0SJX/8ZXjT/G2A2/xZbMf86f1X/S5Bm/ydsQv8XXDL/' +
  'Flsx/xRZL/8XXDL/Flsx/yRpP/80eU//HGE3/0WKYP9EiV//Gl81/xtgNv8WWzH/OX5U/0qPZf8nbEL/LXJI/y5zSf8UWS//F1wy/xZbMf8WWzH/Gl81/xpf' +
  'Nf9FimD/VZpw/zF2TP8XXDL/H2Q6/1abcf9UmW//SI1j/xZbMf8WWzH/F1wy/xRZL/8WWzH/FVow/xdcMv8xdkz/VZpw/1WacP8xdkz/F1wy/x5jOf9Wm3H/' +
  'VJlv/0mOZP8WWzH/Flsx/xdcMv8UWS//Flsx/xVaMP8XXDL/NHlP/1WacP9UmW//IWY8/xZbMf8VWjD/TZJo/1eccv80eU//HGE3/xtgNv8WWzH/Flsx/xdc' +
  'Mv8TWC7/Flsx/x1iOP9Rlmz/VJlv/yFmPP8WWzH/FVow/02SaP9XnHL/NntR/xZbMf8WWzH/Flsx/xZbMf8XXDL/FVow/x5jOf8iZz3/VJlv/xhdM/8WWzH/' +
  'Flsx/xdcMv8VWjD/G2A2/yVqQP9eo3n/XqN5/yRpP/8VWjD/E1gu/xdcMv8WWzH/Flsx/xZbMf8WWzH/Flsx/xZbMf8XXDL/FVow/xxhN/8WWzH/H2Q6/yBl' +
  'O/8WWzH/FVow/xVaMP9Nkmj/Vptx/zd8Uv8YXTP/Flsx/xdcMv8UWS//F1wy/xZbMf8XXDL/OH1T/16jef9eo3n/N3xS/xdcMv8WWzH/Flsx/xRZL/8XXDL/' +
  'Flsx/xZbMf8XXDL/FFkv/xdcMv8WWzH/F1wy/xtgNv8eYzn/HmM5/xpfNf8XXDL/HWI4/1abcf9UmW//SI1j/xZbMf8ZXjT/FFkv/xdcMv8VWjD/FFkv/xZb' +
  'Mf8aXzX/So9l/0mOZP8hZjz/On9V/yZrQf8WWzH/F1wy/xRZL/8ZXjT/GV40/xRZL/8XXDL/FVow/xRZL/8WWzH/FFkv/x1iOP8dYjj/FVow/xpfNf8WWzH/' +
  'MndN/0KHXf8hZjz/GV40/x9kOv8ZXjT/Flsx/xRZL/8XXDL/FVow/xdcMv8WWzH/FVow/0uQZv9eo3n/XqN5/xpfNf8WWzH/GV40/x9kOv8fZDr/GV40/xZb' +
  'Mf8UWS//F1wy/xVaMP8XXDL/Flsx/xVaMP8dYjj/HmM5/yBlO/8VWjD/Flsx/xleNP8fZDr/XaJ4/1KXbf9Ok2n/So9l/0+Uav9MkWf/TpNp/02SaP9MkWf/' +
  'iM2j/53iuP+d4rj/T5Rq/06Taf9Sl23/XaJ4/12ieP9Sl23/TpNp/0qPZf9PlGr/TJFn/06Taf9Nkmj/TJFn/1qfdf9donj/YKV7/0uQZv9Ok2n/Updt/12i' +
  'eP9TmG7/XaJ4/4TJn/9vtIr/So9l/02SaP9JjmT/UJVr/0+Uav9QlWv/cLWL/1qfdf9Ok2n/UJVr/0qPZf9TmG7/U5hu/0qPZf9QlWv/TZJo/0qPZf9Nkmj/' +
  'SY5k/1CVa/9PlGr/So9l/1SZb/9Nkmj/cbaM/4PInv9boHb/U5hu/06Taf+Cx53/is+l/47Tqf9Sl23/UJVr/06Taf9LkGb/TJFn/0+Uav9QlWv/TpNp/06T' +
  'af9Kj2X/T5Rq/06Taf9Ok2n/T5Rq/0qPZf9Ok2n/TZJo/1CVa/9Ok2n/S5Bm/0yRZ/9PlGr/UJVr/1abcf+O06n/is+l/4DFm/9Ok2n/S5Bm/26zif+O06n/' +
  'hMmf/0+Uav9coXf/So9l/0+Uav9QlWv/So9l/0yRZ/9JjmT/UJVr/06Taf9Nkmj/UJVr/0+Uav9Nkmj/TpNp/1CVa/9JjmT/TpNp/0qPZf9PlGr/UJVr/0qP' +
  'Zf9VmnD/TJFn/4XKoP+O06n/bbKI/0uQZv9PlGr/So9l/1SZb/9PlGr/mN2z/5/kuv94vZP/TJFn/0yRZ/9Ok2n/TpNp/1CVa/9IjWP/TZJo/1medP+N0qj/' +
  'jdKo/1eccv9Nkmj/SY5k/16jef9fpHr/VZpw/0yRZ/9MkWf/cbaM/47Tqf+FyqD/So9l/1SZb/9Kj2X/T5Rq/0yRZ/9Nkmj/UJVr/1yhd/+f5Lr/neK4/4zR' +
  'p/9Ok2n/TZJo/0+Uav9Kj2X/TpNp/0yRZ/9QlWv/aq+F/4zRp/+M0af/aK2D/1CVa/9Ok2n/X6R6/12ieP9coXf/TpNp/02SaP+DyJ7/is+l/47Tqf9Sl23/' +
  'UJVr/02SaP9MkWf/TpNp/0qPZf9Wm3H/TpNp/3zBl/+O06n/XaJ4/06Taf9Ok2n/SY5k/0+Uav9Nkmj/TpNp/1abcf9QlWv/er+V/3i9k/9Wm3H/dbqQ/1yh' +
  'd/9VmnD/XKF3/06Taf9Ok2n/TpNp/1yhd/+Bxpz/bbKI/06Taf9Wm3H/S5Bm/06Taf9Nkmj/W6B2/12ieP9gpXv/TpNp/06Taf9Ok2n/TJFn/0yRZ/9Ok2n/' +
  'TpNp/06Taf9fpHr/XaJ4/1ugdv9Nkmj/TZJo/4vQpv+d4rj/neK4/1GWbP9Ok2n/TpNp/0yRZ/9MkWf/TpNp/06Taf9Ok2n/X6R6/12ieP9boHb/TZJo/0yR' +
  'Z/9boHb/XaJ4/2Cle/9MkWf/TZJo/06Taf9Nkmj/TZJo/06Taf9Nkmj/TZJo/2Cle/9donj/Wp91/02SaP9MkWf/ic6k/53iuP+d4rj/UZZs/02SaP9Ok2n/' +
  'TZJo/02SaP9Ok2n/TZJo/02SaP9gpXv/XaJ4/1qfdf9Nkmj/dbqQ/06Taf9Wm3H/TZJo/2argf+AxZv/XKF3/0+Uav9Ok2n/XaJ4/4PInv9vtIr/TZJo/1Wa' +
  'cP9Kj2X/T5Rq/06Taf9QlWv/creN/1qfdf9Ok2n/T5Rq/0qPZf9PlGr/TpNp/12ieP+DyJ7/b7SK/02SaP9VmnD/UZZs/3/Emv+M0af/aK2D/1CVa/9Ok2n/' +
  'jNGn/4rPpf+Bxpz/TpNp/02SaP+Cx53/is+l/47Tqf9TmG7/UJVr/02SaP9LkGb/TJFn/02SaP9QlWv/TJFn/06Taf9Kj2X/T5Rq/06Taf9Nkmj/g8ie/4rP' +
  'pf+O06n/U5hu/1CVa/9ssYf/i9Cm/43SqP9XnHL/TpNp/0mOZP+DyJ7/jtOp/22yiP9Ok2n/TZJo/2yxh/+O06n/hMmf/0qPZf9Ok2n/So9l/0+Uav9QlWv/' +
  'So9l/1WacP9JjmT/UJVr/06Taf9Nkmj/VJlv/1KXbf9vtIr/jtOp/4TJn/9Kj2X/TpNp/1abcf+L0Kb/TpNp/06Taf9Ok2n/UJVr/0qPZf9TmG7/TpNp/2Cl' +
  'e/9gpXv/TZJo/1GWbP9JjmT/UJVr/06Taf9Ok2n/So9l/0qPZf9xtoz/jtOp/3/Emv9JjmT/TJFn/12ieP+e47n/neK4/1ugdv9TmG7/So9l/1CVa/9Ok2n/' +
  'TpNp/0yRZ/9Ok2n/UJVr/0qPZf9PlGr/TZJo/1CVa/9Wm3H/XaJ4/12ieP9Wm3H/UJVr/02SaP9Ok2n/So9l/0+Uav9Ok2n/TpNp/4PInv+Kz6X/jtOp/1CV' +
  'a/9QlWv/c7iO/53iuP+d4rj/creN/1CVa/9Nkmj/TpNp/0qPZf9PlGr/TpNp/1OYbv9Kj2X/T5Rq/0yRZ/9Kj2X/TpNp/0qPZf9an3X/Wp91/1SZb/91upD/' +
  'X6R6/02SaP9PlGr/So9l/22yiP9ssYf/XKF3/4HGnP9ssYf/So9l/06Taf9QlWv/h8yi/4fMov9Rlmz/Vptx/06Taf9Nkmj/T5Rq/0qPZf9TmG7/XaJ4/1OY' +
  'bv9Ok2n/S5Bm/0+Uav9LkGb/TpNp/02SaP9Nkmj/i9Cm/53iuP+e47n/UZZs/06Taf9ssYf/neK4/53iuP9rsIb/TpNp/0uQZv9PlGr/S5Bm/06Taf9Nkmj/' +
  'TZJo/1qfdf9donj/X6R6/0uQZv9Ok2n/U5hu/12ieP9donj/Updt/06Taf9Kj2X/T5Rq/0yRZ/9Ok2n/TZJo/0yRZ/+JzqT/neK4/53iuP9QlWv/TpNp/2uw' +
  'hv+d4rj/neK4/2muhP9Ok2n/So9l/0+Uav9MkWf/TpNp/02SaP9MkWf/Wp91/12ieP9gpXv/S5Bm/06Taf9Sl23/XaJ4/1OYbv9donj/g8ie/2+0iv9Kj2X/' +
  'TZJo/0mOZP9QlWv/T5Rq/1CVa/9xtoz/Wp91/06Taf9QlWv/S5Bm/2muhP9proT/XaJ4/4TJn/9us4n/So9l/02SaP9JjmT/UJVr/0+Uav9Kj2X/VJlv/02S' +
  'aP9Ok2n/UJVr/0qPZf9TmG7/TpNp/4LHnf+Kz6X/jtOp/1SZb/9QlWv/TpNp/0uQZv9MkWf/T5Rq/1CVa/9Ok2n/TpNp/0qPZf9PlGr/TpNp/06Taf+Cx53/' +
  'is+l/47Tqf9PlGr/UJVr/06Taf9LkGb/TJFn/0+Uav9QlWv/TpNp/06Taf9Kj2X/T5Rq/06Taf9LkGb/brOJ/47Tqf+DyJ7/TJFn/1eccv9Kj2X/T5Rq/1CV' +
  'a/9Kj2X/TJFn/0mOZP9QlWv/TpNp/02SaP9LkGb/S5Bm/26zif+O06n/fMGX/0mOZP9Ok2n/So9l/0+Uav9QlWv/So9l/1WacP9LkGb/UJVr/06Taf9Nkmj/' +
  'S5Bm/0+Uav9Kj2X/U5hu/0yRZ/+U2a//n+S6/3e8kv9MkWf/TJFn/06Taf9Ok2n/UJVr/0iNY/9Nkmj/So9l/0+Uav9PlGr/So9l/1OYbv9JjmT/XqN5/1+k' +
  'ev9VmnD/TJFn/0yRZ/9xtoz/jtOp/4bLof9Kj2X/TZJo/0qPZf9PlGr/TJFn/02SaP9QlWv/V5xy/5/kuv+d4rj/jtOp/06Taf9Nkmj/T5Rq/0qPZf9Ok2n/' +
  'TJFn/1CVa/9Nkmj/TJFn/0yRZ/9Nkmj/UJVr/06Taf9fpHr/XaJ4/1yhd/9Ok2n/TZJo/4LHnf+Kz6X/jtOp/1KXbf9QlWv/TZJo/0yRZ/9Ok2n/So9l/1ab' +
  'cf9Ok2n/d7yS/47Tqf9fpHr/TpNp/06Taf9JjmT/T5Rq/02SaP9donj/c7iO/1GWbP9Ok2n/TpNp/0qPZf9Wm3H/TpNp/1WacP9coXf/T5Rq/2itg/9mq4H/' +
  'WZ50/3zBl/9proT/TpNp/1abcf9LkGb/TpNp/02SaP9boHb/XaJ4/2Cle/9Ok2n/TpNp/06Taf9MkWf/TJFn/06Taf9Ok2n/U5hu/57juf+d4rj/hcqg/02S' +
  'aP9Nkmj/W6B2/12ieP9gpXv/TpNp/06Taf9nrIL/jNGn/4zRp/9mq4H/TpNp/06Taf9fpHr/XaJ4/1ugdv9Nkmj/TJFn/1ugdv9donj/YKV7/0yRZ/9Nkmj/' +
  'TpNp/02SaP9Nkmj/TpNp/02SaP9Sl23/nuO5/53iuP+AxZv/TZJo/0yRZ/9boHb/XaJ4/2Cle/9MkWf/TZJo/2argf+N0qj/jdKo/2WqgP9Nkmj/TZJo/2Cl' +
  'e/9donj/Wp91/02SaP98wZf/T5Rq/1abcf9Nkmj/creN/4PInv9coXf/T5Rq/06Taf9Kj2X/T5Rq/02SaP9boHb/brOJ/1KXbf99wpj/fMGX/1CVa/9Wm3H/' +
  'TZJo/3G2jP+DyJ7/XKF3/2WqgP9lqoD/S5Bm/0+Uav9Nkmj/TZJo/1WacP9QlWv/fsOZ/4zRp/9proT/UJVr/1WacP+O06n/is+l/4HGnP9Ok2n/TZJo/0+U' +
  'av9Kj2X/TpNp/0yRZ/9QlWv/aK2D/4vQpv+M0af/aa6E/1CVa/9VmnD/jtOp/4rPpf+Bxpz/TpNp/02SaP9PlGr/So9l/06Taf9MkWf/UJVr/2uwhv+L0Kb/' +
  'jdKo/1eccv9Ok2n/S5Bm/4bLof+O06n/bLGH/1SZb/9Sl23/TZJo/06Taf9QlWv/SY5k/06Taf9TmG7/is+l/43SqP9Wm3H/TpNp/0uQZv+Gy6H/jtOp/22y' +
  'iP9Ok2n/TZJo/02SaP9Ok2n/UJVr/0uQZv9Wm3H/WJ1z/43SqP9Ok2n/TpNp/06Taf9QlWv/So9l/1KXbf9donj/nuO5/53iuP9boHb/TJFn/0mOZP9QlWv/' +
  'TpNp/06Taf9MkWf/TJFn/06Taf9Ok2n/UJVr/0qPZf9TmG7/TpNp/2Cle/9gpXv/TZJo/0yRZ/9LkGb/hsuh/47Tqf9vtIr/TpNp/06Taf9QlWv/So9l/0+U' +
  'av9Nkmj/UJVr/3O4jv+d4rj/neK4/3K3jf9QlWv/TZJo/06Taf9Kj2X/T5Rq/06Taf9Ok2n/UJVr/0qPZf9PlGr/TZJo/1CVa/9Wm3H/XaJ4/12ieP9Wm3H/' +
  'UJVr/1WacP+O06n/is+l/4DFm/9Ok2n/U5hu/0qPZf9PlGr/TJFn/0qPZf9Ok2n/UJVr/4fMov+Gy6H/WJ1z/3W6kP9eo3n/TZJo/0+Uav9Kj2X/U5hu/1OY' +
  'bv9Kj2X/T5Rq/0yRZ/9Kj2X/TpNp/0qPZf9an3X/Wp91/0yRZ/9Wm3H/TpNp/2muhP96v5X/V5xy/1OYbv9donj/U5hu/06Taf9LkGb/T5Rq/0uQZv9Ok2n/' +
  'TZJo/02SaP+JzqT/neK4/57juf9QlWv/TpNp/1OYbv9donj/XaJ4/1OYbv9Ok2n/S5Bm/0+Uav9LkGb/TpNp/02SaP9Nkmj/Wp91/12ieP9fpHr/S5Bm/06T' +
  'af9TmG7/XaJ4/2OXpP9YjJn/VIiV/1CEkf9ViZb/UoaT/1SIlf9Th5T/UoaT/47Cz/+j1+T/o9fk/1WJlv9UiJX/WIyZ/2OXpP9jl6T/WIyZ/1SIlf9QhJH/' +
  'VYmW/1KGk/9UiJX/U4eU/1KGk/9glKH/Y5ek/2aap/9RhZL/VIiV/1iMmf9jl6T/WY2a/2OXpP+Kvsv/dam2/1CEkf9Th5T/T4OQ/1aKl/9ViZb/VoqX/3aq' +
  't/9glKH/VIiV/1aKl/9QhJH/WY2a/1mNmv9QhJH/VoqX/1OHlP9QhJH/U4eU/0+DkP9Wipf/VYmW/1CEkf9ajpv/U4eU/3eruP+Jvcr/YZWi/1mNmv9UiJX/' +
  'iLzJ/5DE0f+UyNX/WIyZ/1aKl/9UiJX/UYWS/1KGk/9ViZb/VoqX/1SIlf9UiJX/UISR/1WJlv9UiJX/VIiV/1WJlv9QhJH/VIiV/1OHlP9Wipf/VIiV/1GF' +
  'kv9ShpP/VYmW/1aKl/9ckJ3/lMjV/5DE0f+Gusf/VIiV/1GFkv90qLX/lMjV/4q+y/9ViZb/Ypaj/1CEkf9ViZb/VoqX/1CEkf9ShpP/T4OQ/1aKl/9UiJX/' +
  'U4eU/1aKl/9ViZb/U4eU/1SIlf9Wipf/T4OQ/1SIlf9QhJH/VYmW/1aKl/9QhJH/W4+c/1KGk/+Lv8z/lMjV/3OntP9RhZL/VYmW/1CEkf9ajpv/VYmW/57S' +
  '3/+l2eb/frK//1KGk/9ShpP/VIiV/1SIlf9Wipf/ToKP/1OHlP9fk6D/k8fU/5PH1P9dkZ7/U4eU/0+DkP9kmKX/ZZmm/1uPnP9ShpP/UoaT/3eruP+UyNX/' +
  'i7/M/1CEkf9ajpv/UISR/1WJlv9ShpP/U4eU/1aKl/9ilqP/pdnm/6PX5P+SxtP/VIiV/1OHlP9ViZb/UISR/1SIlf9ShpP/VoqX/3Cksf+SxtP/ksbT/26i' +
  'r/9Wipf/VIiV/2WZpv9jl6T/Ypaj/1SIlf9Th5T/ib3K/5DE0f+UyNX/WIyZ/1aKl/9Th5T/UoaT/1SIlf9QhJH/XJCd/1SIlf+CtsP/lMjV/2OXpP9UiJX/' +
  'VIiV/0+DkP9ViZb/U4eU/1SIlf9ckJ3/VoqX/4C0wf9+sr//XJCd/3uvvP9ilqP/W4+c/2KWo/9UiJX/VIiV/1SIlf9ilqP/h7vI/3OntP9UiJX/XJCd/1GF' +
  'kv9UiJX/U4eU/2GVov9jl6T/Zpqn/1SIlf9UiJX/VIiV/1KGk/9ShpP/VIiV/1SIlf9UiJX/ZZmm/2OXpP9hlaL/U4eU/1OHlP+RxdL/o9fk/6PX5P9Xi5j/' +
  'VIiV/1SIlf9ShpP/UoaT/1SIlf9UiJX/VIiV/2WZpv9jl6T/YZWi/1OHlP9ShpP/YZWi/2OXpP9mmqf/UoaT/1OHlP9UiJX/U4eU/1OHlP9UiJX/U4eU/1OH' +
  'lP9mmqf/Y5ek/2CUof9Th5T/UoaT/4/D0P+j1+T/o9fk/1eLmP9Th5T/VIiV/1OHlP9Th5T/VIiV/1OHlP9Th5T/Zpqn/2OXpP9glKH/U4eU/3uvvP9UiJX/' +
  'XJCd/1OHlP9soK3/hrrH/2KWo/9ViZb/VIiV/2OXpP+Jvcr/dam2/1OHlP9bj5z/UISR/1WJlv9UiJX/VoqX/3isuf9glKH/VIiV/1WJlv9QhJH/VYmW/1SI' +
  'lf9jl6T/ib3K/3Wptv9Th5T/W4+c/1eLmP+Fucb/ksbT/26ir/9Wipf/VIiV/5LG0/+QxNH/h7vI/1SIlf9Th5T/iLzJ/5DE0f+UyNX/WY2a/1aKl/9Th5T/' +
  'UYWS/1KGk/9Th5T/VoqX/1KGk/9UiJX/UISR/1WJlv9UiJX/U4eU/4m9yv+QxNH/lMjV/1mNmv9Wipf/cqaz/5HF0v+Tx9T/XZGe/1SIlf9Pg5D/ib3K/5TI' +
  '1f9zp7T/VIiV/1OHlP9yprP/lMjV/4q+y/9QhJH/VIiV/1CEkf9ViZb/VoqX/1CEkf9bj5z/T4OQ/1aKl/9UiJX/U4eU/1qOm/9YjJn/dam2/5TI1f+Kvsv/' +
  'UISR/1SIlf9ckJ3/kcXS/1SIlf9UiJX/VIiV/1aKl/9QhJH/WY2a/1SIlf9mmqf/Zpqn/1OHlP9Xi5j/T4OQ/1aKl/9UiJX/VIiV/1CEkf9QhJH/d6u4/5TI' +
  '1f+Fucb/T4OQ/1KGk/9jl6T/pNjl/6PX5P9hlaL/WY2a/1CEkf9Wipf/VIiV/1SIlf9ShpP/VIiV/1aKl/9QhJH/VYmW/1OHlP9Wipf/XJCd/2OXpP9jl6T/' +
  'XJCd/1aKl/9Th5T/VIiV/1CEkf9ViZb/VIiV/1SIlf+Jvcr/kMTR/5TI1f9Wipf/VoqX/3mtuv+j1+T/o9fk/3isuf9Wipf/U4eU/1SIlf9QhJH/VYmW/1SI' +
  'lf9ZjZr/UISR/1WJlv9ShpP/UISR/1SIlf9QhJH/YJSh/2CUof9ajpv/e6+8/2WZpv9Th5T/VYmW/1CEkf9zp7T/cqaz/2KWo/+Hu8j/cqaz/1CEkf9UiJX/' +
  'VoqX/43Bzv+Nwc7/V4uY/1yQnf9UiJX/U4eU/1WJlv9QhJH/WY2a/2OXpP9ZjZr/VIiV/1GFkv9ViZb/UYWS/1SIlf9Th5T/U4eU/5HF0v+j1+T/pNjl/1eL' +
  'mP9UiJX/cqaz/6PX5P+j1+T/caWy/1SIlf9RhZL/VYmW/1GFkv9UiJX/U4eU/1OHlP9glKH/Y5ek/2WZpv9RhZL/VIiV/1mNmv9jl6T/Y5ek/1iMmf9UiJX/' +
  'UISR/1WJlv9ShpP/VIiV/1OHlP9ShpP/j8PQ/6PX5P+j1+T/VoqX/1SIlf9xpbL/o9fk/6PX5P9vo7D/VIiV/1CEkf9ViZb/UoaT/1SIlf9Th5T/UoaT/2CU' +
  'of9jl6T/Zpqn/1GFkv9UiJX/WIyZ/2OXpP9ZjZr/Y5ek/4m9yv91qbb/UISR/1OHlP9Pg5D/VoqX/1WJlv9Wipf/d6u4/2CUof9UiJX/VoqX/1GFkv9vo7D/' +
  'b6Ow/2OXpP+Kvsv/dKi1/1CEkf9Th5T/T4OQ/1aKl/9ViZb/UISR/1qOm/9Th5T/VIiV/1aKl/9QhJH/WY2a/1SIlf+IvMn/kMTR/5TI1f9ajpv/VoqX/1SI' +
  'lf9RhZL/UoaT/1WJlv9Wipf/VIiV/1SIlf9QhJH/VYmW/1SIlf9UiJX/iLzJ/5DE0f+UyNX/VYmW/1aKl/9UiJX/UYWS/1KGk/9ViZb/VoqX/1SIlf9UiJX/' +
  'UISR/1WJlv9UiJX/UYWS/3Sotf+UyNX/ib3K/1KGk/9dkZ7/UISR/1WJlv9Wipf/UISR/1KGk/9Pg5D/VoqX/1SIlf9Th5T/UYWS/1GFkv90qLX/lMjV/4K2' +
  'w/9Pg5D/VIiV/1CEkf9ViZb/VoqX/1CEkf9bj5z/UYWS/1aKl/9UiJX/U4eU/1GFkv9ViZb/UISR/1mNmv9ShpP/ms7b/6XZ5v99sb7/UoaT/1KGk/9UiJX/' +
  'VIiV/1aKl/9Ogo//U4eU/1CEkf9ViZb/VYmW/1CEkf9ZjZr/T4OQ/2SYpf9lmab/W4+c/1KGk/9ShpP/d6u4/5TI1f+MwM3/UISR/1OHlP9QhJH/VYmW/1KG' +
  'k/9Th5T/VoqX/12Rnv+l2eb/o9fk/5TI1f9UiJX/U4eU/1WJlv9QhJH/VIiV/1KGk/9Wipf/U4eU/1KGk/9ShpP/U4eU/1aKl/9UiJX/ZZmm/2OXpP9ilqP/' +
  'VIiV/1OHlP+IvMn/kMTR/5TI1f9YjJn/VoqX/1OHlP9ShpP/VIiV/1CEkf9ckJ3/VIiV/32xvv+UyNX/ZZmm/1SIlf9UiJX/T4OQ/1WJlv9Th5T/Y5ek/3mt' +
  'uv9Xi5j/VIiV/1SIlf9QhJH/XJCd/1SIlf9bj5z/Ypaj/1WJlv9uoq//bKCt/1+ToP+CtsP/b6Ow/1SIlf9ckJ3/UYWS/1SIlf9Th5T/YZWi/2OXpP9mmqf/' +
  'VIiV/1SIlf9UiJX/UoaT/1KGk/9UiJX/VIiV/1mNmv+k2OX/o9fk/4u/zP9Th5T/U4eU/2GVov9jl6T/Zpqn/1SIlf9UiJX/baGu/5LG0/+SxtP/bKCt/1SI' +
  'lf9UiJX/ZZmm/2OXpP9hlaL/U4eU/1KGk/9hlaL/Y5ek/2aap/9ShpP/U4eU/1SIlf9Th5T/U4eU/1SIlf9Th5T/WIyZ/6TY5f+j1+T/hrrH/1OHlP9ShpP/' +
  'YZWi/2OXpP9mmqf/UoaT/1OHlP9soK3/k8fU/5PH1P9rn6z/U4eU/1OHlP9mmqf/Y5ek/2CUof9Th5T/grbD/1WJlv9ckJ3/U4eU/3isuf+Jvcr/Ypaj/1WJ' +
  'lv9UiJX/UISR/1WJlv9Th5T/YZWi/3Sotf9YjJn/g7fE/4K2w/9Wipf/XJCd/1OHlP93q7j/ib3K/2KWo/9rn6z/a5+s/1GFkv9ViZb/U4eU/1OHlP9bj5z/' +
  'VoqX/4S4xf+SxtP/b6Ow/1aKl/9bj5z/lMjV/5DE0f+Hu8j/VIiV/1OHlP9ViZb/UISR/1SIlf9ShpP/VoqX/26ir/+RxdL/ksbT/2+jsP9Wipf/W4+c/5TI' +
  '1f+QxNH/h7vI/1SIlf9Th5T/VYmW/1CEkf9UiJX/UoaT/1aKl/9xpbL/kcXS/5PH1P9dkZ7/VIiV/1GFkv+MwM3/lMjV/3Kms/9ajpv/WIyZ/1OHlP9UiJX/' +
  'VoqX/0+DkP9UiJX/WY2a/5DE0f+Tx9T/XJCd/1SIlf9RhZL/jMDN/5TI1f9zp7T/VIiV/1OHlP9Th5T/VIiV/1aKl/9RhZL/XJCd/16Sn/+Tx9T/VIiV/1SI' +
  'lf9UiJX/VoqX/1CEkf9YjJn/Y5ek/6TY5f+j1+T/YZWi/1KGk/9Pg5D/VoqX/1SIlf9UiJX/UoaT/1KGk/9UiJX/VIiV/1aKl/9QhJH/WY2a/1SIlf9mmqf/' +
  'Zpqn/1OHlP9ShpP/UYWS/4zAzf+UyNX/dam2/1SIlf9UiJX/VoqX/1CEkf9ViZb/U4eU/1aKl/95rbr/o9fk/6PX5P94rLn/VoqX/1OHlP9UiJX/UISR/1WJ' +
  'lv9UiJX/VIiV/1aKl/9QhJH/VYmW/1OHlP9Wipf/XJCd/2OXpP9jl6T/XJCd/1aKl/9bj5z/lMjV/5DE0f+Gusf/VIiV/1mNmv9QhJH/VYmW/1KGk/9QhJH/' +
  'VIiV/1aKl/+Nwc7/jMDN/16Sn/97r7z/ZJil/1OHlP9ViZb/UISR/1mNmv9ZjZr/UISR/1WJlv9ShpP/UISR/1SIlf9QhJH/YJSh/2CUof9ShpP/XJCd/1SI' +
  'lf9vo7D/gLTB/12Rnv9ZjZr/Y5ek/1mNmv9UiJX/UYWS/1WJlv9RhZL/VIiV/1OHlP9Th5T/j8PQ/6PX5P+k2OX/VoqX/1SIlf9ZjZr/Y5ek/2OXpP9ZjZr/' +
  'VIiV/1GFkv9ViZb/UYWS/1SIlf9Th5T/U4eU/2CUof9jl6T/ZZmm/1GFkv9UiJX/WY2a/2OXpP+r3+z/n9Lf/5rO2/+Vydb/m8/c/5fL2P+aztv/mMzZ/5jM' +
  '2f/V8PP/6v///+r9/v+azNj/ms7b/5/S3/+r3uv/q9/s/57S3/+aztv/lcnW/5vP3P+Xy9j/ms7b/5jM2f+YzNn/p9rn/6re6/+t4O3/l8vY/5rO2/+f0t//' +
  'q97r/57S3/+o1t7/z/T3/7rj6v+Vydb/mc3a/5TI1f+bz9z/m8/c/5vL1/+94Of/pdHb/5nN2v+bz9z/lcnW/57S3/+e0t//lcnW/5vP3P+Zzdr/lcnW/5nN' +
  '2v+UyNX/m8/c/5vP3P+Vydb/odTh/5jM2f+85er/zvT2/6bU3v+e0t//ms7b/8709v/W////2v///53P2/+c0N3/ms7b/5fL2P+Xy9j/ms7b/5zQ3f+Zzdr/' +
  'ms7b/5bK1/+bz9z/ms7b/5rO2/+bz9z/lsrX/5rO2/+Zzdr/nNDd/5rO2/+Xy9j/l8vY/5rO2/+c0N3/odLd/9r////W////zPL1/5rO2/+Wytf/uuLp/9r/' +
  '///Q9Pf/mcvY/6fT3v+Vydb/m8/c/5zQ3f+Vydb/l8vY/5PH1P+c0N3/ms7b/5jM2f+bzdn/mszY/5jM2f+aztv/nNDd/5TI1f+aztr/lcnW/5vP3P+c0N3/' +
  'lcnW/6HR3P+Xytb/0PX3/9r///+44ej/lsrX/5vP3P+Vydb/n9Hc/5rM2P/l+vv/7P///8Tk6v+YzNn/l8vY/5nN2v+aztv/nNDd/5PH1P+Zzdr/pNPd/9n+' +
  '/v/Z/v7/otHc/5nN2v+UyNX/q97r/6zg7f+i1uP/mMzZ/5fL2P+85ev/2v///9D1+P+Wydb/n9Hc/5XJ1v+bz9z/l8vY/5jM2f+c0N3/qNXf/+z////q////' +
  '2fL1/5rO2/+Zzdr/ms7b/5bK1/+aztv/l8vY/5zQ3f+24Of/1////9f///+z3+b/nNDd/5rO2/+s4O3/qt7r/6nc6f+aztv/mc3a/8709//W////2v///53O' +
  '2v+c0N3/mc3a/5fL2P+aztv/lsnW/6LW4/+azdr/x+bs/9ry9f+p093/ms7b/5nN2v+Vydb/m8/c/5nN2v+azdr/otbj/5vN2f/G7fH/xOzw/6HP2v/B5Or/' +
  'p9Lc/6LV4v+p3On/mc3a/5rO2/+Zzdr/p9Td/83y9f+54un/ms3a/6LW4/+Wytf/ms7b/5jM2f+o2+j/qt7r/63h7v+Zzdr/ms7b/5nN2v+YzNn/mMzZ/5rO' +
  '2/+aztv/ms3a/63h7v+q3uv/p9vo/5nN2v+YzNn/1/H0/+r////q/f7/nc7a/5rO2/+Zzdr/mMzZ/5jM2f+aztv/ms7b/5rN2v+t4e7/qt7r/6fb6P+Zzdr/' +
  'mMzZ/6jb6P+q3uv/reDt/5jM2f+Zzdr/ms7b/5jM2f+YzNn/mc3a/5nN2v+ZzNn/reHu/6re6/+n2+j/mMzZ/5jM2f/W7/P/6v///+r9/v+dztr/mc3a/5rO' +
  '2/+YzNn/mMzZ/5nN2v+Zzdr/mczZ/63h7v+q3uv/p9vo/5jM2f/A6vD/mcvX/6LW4/+ZzNn/suDo/8vz9f+n1d7/ms7b/5rO2/+o1t7/zvT2/7rk6v+Zzdr/' +
  'otXi/5XJ1v+aztv/ms7b/5vL1/++4ej/ptHc/5nN2v+aztv/lcnW/5rO2/+aztv/qNbe/8709v+65Or/mc3a/6LV4v+dzdn/y/Dz/9f///+03+b/nNDd/5nN' +
  '2v/Y////1v///8zz9f+aztv/mc3a/8709v/W////2v///57P2v+c0N3/mc3a/5fL2P+Xy9j/mc3a/5zQ3f+YzNn/ms7b/5bK1/+aztv/ms7b/5nN2v/O9Pf/' +
  '1v///9r///+ez9r/nNDd/7jh6P/X////2f3+/6HR2/+Zzdr/lMjV/8/19//a////ueLp/5nN2v+YzNn/uOLo/9r////P9Pf/lMjV/5nN2v+Vydb/m8/c/5vP' +
  '3P+Vydb/oNHd/5TI1f+c0N3/ms7b/5jM2f+fz9v/ns7a/7vj6v/a////0PT3/5TI1f+Zzdr/otHb/9f9/f+ZzNj/mc3a/5rO2/+c0N3/lcjV/57P2v+Zzdr/' +
  'reHu/63h7v+Zzdr/nM7a/5TI1f+bz9z/ms7b/5nN2v+Wytf/lcnW/7zl6v/a////y/L2/5PH1P+Xy9j/qNPd/+v+/v/r/v7/p9Lc/57P2v+VyNX/m8/c/5rO' +
  '2/+Zzdr/l8vX/5nN2v+bz9z/lsrX/5rO2/+Zzdr/nNDd/6PW4/+q3uv/qt7r/6LW4/+c0N3/mc3a/5rO2/+Wytf/m8/c/5rO2/+Zzdr/zvT3/9b////a////' +
  'm87b/5zQ3f/A4un/6v///+r///++4ej/nNDd/5nN2v+aztv/lsrX/5vP3P+aztv/n9Lf/5XJ1v+bz9z/mMzZ/5bK1/+Zzdr/lcnW/6jb6P+n2+j/n87a/8Hj' +
  '6f+q1N7/mMzZ/5vP3P+Wydb/ud3l/7jd5f+o1d7/zfP2/7jh6P+Wytf/mc3a/5vL1//U7/L/0+7y/5zM2P+h1eL/mc3a/5jM2f+bz9z/lcnW/5/S3/+q3uv/' +
  'n9Lf/5rO2/+Wytf/m8/c/5fL2P+aztv/mc3a/5jM2f/Y8fT/6v///+z+//+dzdn/ms7b/7nd5f/q////6v///7fc5P+aztv/lsrX/5vP3P+Xy9j/ms7b/5nN' +
  '2v+YzNn/p9vo/6re6/+s4O3/l8vY/5rO2/+f0t//qt7r/6vf7P+e0t//ms7b/5XJ1v+bz9z/l8vY/5rO2/+YzNn/mMzZ/9Xw8//q////6v3+/5vM2P+aztv/' +
  't9zk/+r////r////tdvj/5rO2/+Vydb/m8/c/5fL2P+aztv/mMzZ/5jM2f+n2uf/qt7r/63g7f+Xy9j/ms7b/5/S3/+r3uv/ntLf/6jW3v/P9Pf/u+Tq/5XJ' +
  '1v+Zzdr/lMjV/5vP3P+bz9z/m8vX/73g5/+m0dz/mc3a/5vP3P+Wydb/ttzk/7Xb5P+p1t7/z/T3/7rj6f+Vydb/mc3a/5TI1f+bz9z/m8/c/5XJ1v+h1OH/' +
  'mMzZ/5nN2v+bz9z/lcnW/57S3/+aztv/zvT2/9b////a////n9Dc/5zQ3f+aztv/l8vY/5fL2P+aztv/nNDd/5nN2v+aztv/lsrX/5vP3P+aztv/ms7b/870' +
  '9v/W////2v///5vO2/+c0N3/ms7b/5fL2P+Xy9j/ms7b/5zQ3f+Zzdr/ms7b/5bK1/+bz9z/ms7b/5bK1/+64un/2v///8/09v+Xytb/otHc/5XJ1v+bz9z/' +
  'nNDd/5XJ1v+Xy9j/k8fU/5zQ3f+aztv/mMzZ/5bK1/+Wytf/uuLp/9r////I8fX/lMjV/5rO2v+Vydb/m8/c/5zQ3f+Vydb/oNHc/5XJ1f+c0N3/ms7b/5jM' +
  '2f+Wytf/m8/c/5XJ1v+f0Nz/l8nW/+L3+f/s////xOTq/5jM2f+Xy9j/mc3a/5rO2/+c0N3/k8fU/5nN2v+Vydb/m8/c/5vP3P+Vydb/n9Dc/5TI1f+r3uv/' +
  'rODt/6LW4/+YzNn/l8vY/7zl6v/a////0fb4/5XI1f+Zzdr/lcnW/5vP3P+Xy9j/mMzZ/5zQ3f+j0dz/7P///+r////a8/b/ms7b/5nN2v+aztv/lsrX/5rO' +
  '2/+Xy9j/nNDd/5nN2v+Xy9j/l8vY/5jM2f+c0N3/ms7b/6zg7f+q3uv/qdzp/5rO2/+Zzdr/zfP2/9b////a////ns/a/5zQ3f+Zzdr/l8vY/5rO2/+Wydb/' +
  'otbj/5nN2f/D4+n/2vL1/6rU3f+aztv/mc3a/5XJ1v+bz9z/mc3a/6nT3f/A4+n/nMzY/5rO2/+aztv/lsnW/6LW4/+ZzNn/otXi/6nc6f+azdr/s97m/7Ld' +
  '5f+k093/yPD0/7Tg5/+azdr/otbj/5bK1/+aztv/mMzZ/6jb6P+q3uv/reHu/5nN2v+aztv/mc3a/5jM2f+YzNn/ms7b/5rO2/+fz9v/6/7+/+r////S7vL/' +
  'mc3a/5jM2f+o2+j/qt7r/63h7v+Zzdr/ms7b/7Pe5v/Y////2P///7Hd5f+aztv/ms3a/63h7v+q3uv/p9vo/5nN2v+YzNn/qNvo/6re6/+t4O3/mMzZ/5nN' +
  '2v+aztv/mMzZ/5jM2f+Zzdr/mc3a/53O2v/r/v7/6v///8zs8f+YzNn/mMzZ/6jb6P+q3uv/reDt/5jM2f+Zzdr/st3l/9j////Y////sNzk/5nN2v+ZzNn/' +
  'reHu/6re6/+n2+j/mMzZ/8ju8v+azNj/otbj/5nM2f+95ev/z/T3/6jV3v+aztv/ms7b/5XJ1v+bz9z/mc3a/6fS3P+64Of/nc7Y/8jv8//I7vL/mszY/6LW' +
  '4/+ZzNn/vOXq/8709v+n1d7/sd3l/7Hc5f+Vydb/m8/c/5nN2v+Zzdr/otXi/5zN2f/J7/P/1////7Tf5v+c0N3/odHc/9r////W////zfL1/5rO2/+Zzdr/' +
  'm8/c/5bK1/+aztv/l8vY/5zQ3f+03+f/1////9f///+03+b/nNDd/6DR3P/a////1v///8zz9f+aztv/mc3a/5vP3P+Wytf/ms7b/5fL2P+c0N3/tuDn/9f/' +
  '///Z/f7/odHb/5nN2v+WydX/0vb4/9r///+34ej/n8/b/57O2v+YzNn/ms7b/5zQ3f+Tx9T/mc3a/57P2v/V/P3/2P39/6HR2/+Zzdr/lcnV/9H2+P/a////' +
  'ueLp/5nN2v+YzNn/mMzZ/5rO2/+c0N3/lcnV/6HS3f+i0tz/2f3+/5nM2P+Zzdr/ms7b/5zQ3f+VyNX/nc7a/6jT3f/r/v7/6/7+/6fS3P+Xy9j/k8fU/5vP' +
  '3P+aztv/mc3a/5fK1/+Xy9f/mc3a/5rO2/+c0N3/lcjV/57P2v+Zzdr/reHu/63h7v+Zzdr/l8vY/5XJ1f/S9vj/2v///7rj6f+Zy9j/mc3a/5vP3P+Wytf/' +
  'ms7b/5nN2v+c0N3/wOLp/+r////q////vuHo/5zQ3f+Zzdr/ms7b/5bK1/+bz9z/ms7b/5nN2v+bz9z/lsrX/5rO2/+Zzdr/nNDd/6PW4/+q3uv/qt7r/6LW' +
  '4/+c0N3/odLd/9r////W////zPP1/5rO2/+f0t//lcnW/5vP3P+YzNn/lsrX/5nN2v+by9f/1O/y/9Pu8v+jz9r/wePp/6nU3f+YzNn/m8/c/5XJ1v+f0t//' +
  'n9Lf/5XJ1v+bz9z/mMzZ/5bK1/+Zzdr/lcnW/6jb6P+n2+j/l8vY/6HV4v+Zzdr/tODo/8bv9P+i0tz/n9Lf/6re6/+f0t//ms7b/5bK1/+bz9z/l8vY/5rO' +
  '2/+Zzdr/mMzZ/9Xw8//q////6/7+/5zN2P+aztv/n9Lf/6re6/+q3uv/n9Lf/5rO2/+Wytf/m8/c/5fL2P+aztv/mc3a/5jM2f+n2+j/qt7r/6zg7f+Xy9j/' +
  'ms7b/5/S3/+q3uv/No7O/z6V1P8+ldT/PpXU/z6V1P8+ldT/PpXU/z6V1P8+ldT/PpTU/zySz/9dptr/Xaba/1ij2f9Yo9n/WKPZ/1ij2f9Yo9n/WKPZ/12m' +
  '2v9dptr/PJLP/z6U1P8+ldT/PpXU/z6V1P8+ldT/PpXU/z6V1P8+ldT/PpXU/zaOzv8visv/MI3Q/zCN0P8wjdD/MI3Q/zCN0P8wjdD/MI3Q/zCN0P8wjdD/' +
  'OpDO/12m2v9apNr/WKPZ/1ij2f9Yo9n/WKPZ/1ij2f9Yo9n/WqTa/12m2v86kM7/MI3Q/zCN0P8wjdD/MI3Q/zCN0P8wjdD/MI3Q/zCN0P8wjdD/L4rL/y+K' +
  'y/8wjdD/MIrM/y+Jy/8vicv/L4nL/y+Jy/8vicv/MIrN/zCN0P86kM7/Xaba/12m2v9ZpNr/WKPZ/1mk2v9Yo9n/WaTa/1ij2f9eptr/Xaba/zqQzv8wjdD/' +
  'L4rM/y+Jy/8vicv/L4nL/y+Jy/8vicv/L4rL/zCN0P8visv/L4rL/zCN0P8vicv/L4rL/y+Jy/8vicv/L4nL/y+Ky/8wi87/MI3Q/zqQzv9bpdr/WaPZ/1mj' +
  '2f9Zo9n/WaPZ/1mj2f9Zo9n/WaPZ/1mj2f9bpdr/OpDO/zCN0P8wjM7/L4nL/y+Jy/8vicv/L4rL/y+Jy/8vicv/MI3Q/y+Ky/8visv/MI3P/y+Jy/8vicv/' +
  'L4nL/y+Jy/8vicv/L4nL/y+KzP8wjdD/OI7N/zyRzv83jsz/N47M/zeOzP83jsz/N47M/zeOzP83jsz/N47M/zyRzv84js3/MI3Q/y+KzP8vicv/L4nL/y+J' +
  'y/8vicv/L4nL/y+Jy/8wjc//L4rL/y+Ky/8wjdD/L4nL/y+Jy/8vicv/L4nL/y+Jy/8vicv/MIvO/zCN0P86kM7/Zqvc/2ms3f9prN3/aazd/2ms3f9prN3/' +
  'aazd/2ms3f9prN3/Zqvc/zqQzv8wjdD/MIvO/y+Jy/8vicv/L4nL/y+Jy/8vicv/L4nL/zCN0P8visv/L4rL/zCNz/8vicv/L4nL/y+Jy/8vicv/L4nL/y+J' +
  'y/8visz/MI3Q/zqQzv9eptr/Xqba/1yl2v9eptr/XKXa/16m2v9cpdr/Xqba/16m2v9eptr/OpDO/zCN0P8visz/L4nL/y+Jy/8vicv/L4nL/y+Jy/8vicv/' +
  'MI3P/y+Ky/8visv/MI3Q/y+Jy/8visv/L4nL/y+Jy/8vicv/L4rL/zCLzv8wjdD/OpDO/16m2v9apNr/WKPZ/1ij2f9Yo9n/WKPZ/1ij2f9Yo9n/WqXa/16m' +
  '2v86kM7/MI3Q/zCMzv8vicv/L4nL/y+Jy/8visv/L4nL/y+Jy/8wjdD/L4rL/y+Ky/8wjdD/L4rM/zCLzv8visz/MIvO/y+KzP8wi87/L4rM/zCN0P86kM7/' +
  'Xqba/12m2v9Yo9n/WKPZ/1ij2f9Yo9n/WKPZ/1ij2f9dptr/Xqba/zqQzv8wjdD/MIzP/y+KzP8wi87/L4rM/zCLzv8visz/MIzP/zCN0P8visv/L4nK/y+J' +
  'yv8vicr/L4nK/y+Jyv8vicr/L4nK/y+Jyv8vicr/L4rL/zqQzv9eptr/WqTa/1ij2f9Yo9n/WKPZ/1ij2f9Yo9n/WKPZ/1qk2v9eptr/OpDO/y+Ky/8vicr/' +
  'L4nK/y+Jyv8vicr/L4nK/y+Jyv8vicr/L4nK/y+Jyv8vg8H/L4O//y+Dv/8vg7//L4O//y+Dv/8vg7//L4O//y+Dv/8vg7//Oo3J/16m2v9dptr/WKPZ/1ij' +
  '2f9Yo9n/WKPZ/1ij2f9Yo9n/Xaba/16m2v86jcn/L4O//y+Dv/8vg7//L4O//y+Dv/8vg7//L4O//y+Dv/8vg7//L4PB/zOMzP87k9P/O5PT/zuT0/87k9P/' +
  'O5PT/zuT0/87k9P/O5PT/zqT0/87kc//Xqba/1qk2v9Yo9n/WKPZ/1ij2f9Yo9n/WKPZ/1ij2f9apNr/Xqba/zuRz/86k9P/O5PT/zuT0/87k9P/O5PT/zuT' +
  '0/87k9P/O5PT/zuT0/8zjMz/L4rL/zCN0P8wjdD/MIvN/zCN0P8wi83/MI3Q/zCLzf8wjdD/MI3Q/zqQzv9eptr/Xaba/1ij2f9Yo9n/WKPZ/1ij2f9Yo9n/' +
  'WKPZ/12m2v9eptr/OpDO/zCN0P8wjM7/MI3Q/zCLzf8wjdD/MIvN/zCN0P8wi87/MI3Q/y+Ky/8visv/MI3Q/y+Jy/8vicv/L4nL/y+Jy/8vicv/L4nL/zCL' +
  'zv8wjdD/OpDO/16m2v9dptr/WqTZ/12m2v9apNn/Xaba/1qk2f9dptr/XaXa/16m2v86kM7/MI3Q/zCLzv8vicv/L4nL/y+Jy/8vicv/L4nL/y+Jy/8wjdD/' +
  'L4rL/y+Ky/8wjc//L4nL/y+Jy/8vicv/L4nL/y+Jy/8vicv/L4rM/zCN0P86kM7/V6PZ/1Og2P9ToNj/U6DY/1Og2P9ToNj/U6DY/1Og2P9ToNj/V6PZ/zqQ' +
  'zv8wjdD/L4rM/y+Jy/8vicv/L4nL/y+Jy/8vicv/L4nL/zCNz/8visv/L4rL/zCN0P8vicv/L4rL/y+Jy/8vicv/L4nL/y+Ky/8wi87/MI3Q/zmPzv9SoNj/' +
  'Up/Y/1Kf2P9Sn9j/Up/Y/1Kf2P9Sn9j/Up/Y/1Kf2P9SoNj/OY/O/zCN0P8wjM7/L4nL/y+Jy/8vicv/L4rL/y+Jy/8vicv/MI3Q/y+Ky/8visv/MI3P/y+J' +
  'y/8vicv/L4nL/y+Jy/8vicv/L4nL/y+KzP8wjdD/OpDO/2Kp3P9lqtz/Zarc/2Wq3P9lqtz/Zarc/2Wq3P9lqtz/Zarc/2Kp3P86kM7/MI3Q/y+KzP8vicv/' +
  'L4nL/y+Jy/8vicv/L4nL/y+Jy/8wjc//L4rL/y+Ky/8wjdD/L4nL/y+Jy/8vicv/L4nL/y+Jy/8vicv/MIvO/zCN0P86kM7/Xqba/12l2v9dptr/WqTZ/12m' +
  '2v9apNn/Xaba/1qk2f9dptr/Xqba/zqQzv8wjdD/MIvO/y+Jy/8vicv/L4nL/y+Jy/8vicv/L4nL/zCN0P8visv/L4rL/zCNz/8vicv/L4nL/y+Jy/8vicv/' +
  'L4nL/y+Jy/8visz/MI3Q/zqQzv9eptr/Xaba/1ij2f9Yo9n/WKPZ/1ij2f9Yo9n/WKPZ/12m2v9eptr/OpDO/zCN0P8visz/L4nL/y+Jy/8vicv/L4nL/y+J' +
  'y/8vicv/MI3P/y+Ky/8visv/MI3Q/zCN0P8wi83/MI3Q/zCLzf8wjdD/MIvN/zCN0P8wjdD/OpDO/16m2v9apNr/WKPZ/1ij2f9Yo9n/WKPZ/1ij2f9Yo9n/' +
  'WqTa/16m2v86kM7/MI3Q/zCMz/8wjdD/MIvN/zCN0P8wi83/MI3Q/zCLzf8wjdD/L4rL/y6Hx/8thcP/LYXD/y2Fw/8thcP/LYXD/y2Fw/8thcP/LYXD/y2G' +
  'xP86kM3/Xqba/12m2v9Yo9n/WKPZ/1ij2f9Yo9n/WKPZ/1ij2f9dptr/Xqba/zqQzf8thsT/LYXD/y2Fw/8thcP/LYXD/y2Fw/8thcP/LYXD/y2Fw/8uh8f/' +
  'M4fF/zaKx/82isf/NorH/zaKx/82isf/NorH/zaKx/82isf/NorH/zuOyv9eptr/WqTa/1ij2f9Yo9n/WKPZ/1ij2f9Yo9n/WKPZ/1qk2v9eptr/O47K/zaK' +
  'x/82isf/NorH/zaKx/82isf/NorH/zaKx/82isf/NorH/zOHxf8wi8z/NpDR/zaQ0f82kNH/NpDR/zaQ0f82kNH/NpDR/zaQ0f81kNH/OpDO/16m2v9dptr/' +
  'WKPZ/1ij2f9Yo9n/WKPZ/1ij2f9Yo9n/Xaba/16m2v86kM7/NZDR/zaQ0f82kNH/NpDR/zaQ0f82kNH/NpDR/zaQ0f82kNH/MIvM/y+Ky/8wjdD/L4rM/zCM' +
  'zv8visz/MIvO/y+KzP8wjM7/MIzO/zCN0P86kM7/Xqba/1ql2v9Yo9n/WKPZ/1ij2f9Yo9n/WKPZ/1ij2f9apNr/Xqba/zqQzv8wjdD/MI3Q/y+KzP8wi87/' +
  'L4rM/zCMzv8visz/MIzO/zCN0P8visv/L4rL/zCNz/8vicv/L4nL/y+Jy/8vicv/L4nL/y+Jy/8visz/MI3Q/zqQzv9eptr/Xqba/16m2v9cpdr/Xqba/1yl' +
  '2v9eptr/XKXa/16m2v9eptr/OpDO/zCN0P8visz/L4nL/y+Jy/8vicv/L4nL/y+Jy/8vicv/MI3P/y+Ky/8visv/MI3Q/y+Jy/8vicv/L4nL/y+Jy/8vicv/' +
  'L4nL/zCLzv8wjdD/OpDO/02d1/9Jm9b/SZvW/0mb1v9Jm9b/SZvW/0mb1v9Jm9b/SZvW/02d1/86kM7/MI3Q/zCLzv8vicv/L4nL/y+Jy/8vicv/L4nL/y+J' +
  'y/8wjdD/L4rL/y+Ky/8wjc//L4nL/y+Jy/8vicv/L4nL/y+Jy/8vicv/L4rM/zCN0P86kM7/aazd/22u3v9trt7/ba7e/22u3v9trt7/ba7e/22u3v9trt7/' +
  'aazd/zqQzv8wjdD/L4rM/y+Jy/8vicv/L4nL/y+Jy/8vicv/L4nL/zCNz/8visv/L4rL/zCN0P8vicv/L4rL/y+Jy/8vicv/L4nL/y+Ky/8wi87/MI3Q/zqQ' +
  'zv9fp9v/Yajb/2Go2/9hqNv/Yajb/2Go2/9hqNv/Yajb/2Go2/9fp9v/OpDO/zCN0P8wjM7/L4nL/y+Jy/8vicv/L4rL/y+Jy/8vicv/MI3Q/y+Ky/8visv/' +
  'MI3P/y+Jy/8vicv/L4nL/y+Jy/8vicv/L4nL/y+KzP8wjdD/OpDO/12m2v9eptr/WKPZ/1mk2v9Yo9n/WaTa/1ij2f9ZpNr/Xaba/12m2v86kM7/MI3Q/y+K' +
  'zP8vicv/L4nL/y+Jy/8vicv/L4nL/y+Jy/8wjc//L4rL/y+Ky/8wjdD/L4rM/y+Jy/8vicv/L4nL/y+Jy/8vicv/MIzP/zCN0P86kM7/Xaba/1qk2v9Yo9n/' +
  'WKPZ/1ij2f9Yo9n/WKPZ/1ij2f9apNr/Xaba/zqQzv8wjdD/MIvO/y+Jy/8vicv/L4nL/y+Jy/8vicv/L4nL/zCN0P8visv/L4rL/zCN0P8wjdD/MI3Q/zCN' +
  '0P8wjdD/MI3Q/zCN0P8wjdD/MI3Q/zqQzv9dptr/Xaba/1ij2f9Yo9n/WKPZ/1ij2f9Yo9n/WKPZ/12m2v9dptr/OpDO/zCN0P8wjdD/MI3Q/zCN0P8wjdD/' +
  'MI3Q/zCN0P8wjdD/MI3Q/y+Ky/8sgb7/Kn25/yp9uf8qfbn/Kn25/yp9uf8qfbn/Kn25/yp9uf8rfrr/OYzI/12m2v9apNr/WKPZ/1ij2f9Yo9n/WKPZ/1ij' +
  '2f9Yo9n/WqTa/12m2v85jMj/K366/yp9uf8qfbn/Kn25/yp9uf8qfbn/Kn25/yp9uf8qfbn/LIG+/23I8P93zfP/d83z/3fN8/93zfP/d83z/3fN8/93zfP/' +
  'd83z/3bN8/91yvH/mdr1/5na9f+U2PX/lNj1/5TY9f+U2PX/lNj1/5TY9f+Z2vX/mdr1/3XK8f92zfP/d83z/3fN8/93zfP/d83z/3fN8/93zfP/d83z/3fN' +
  '8/9tyPD/ZsTv/2jH8f9ox/H/aMfx/2jH8f9ox/H/aMfx/2jH8f9ox/H/aMfx/3LJ8f+Z2vX/ltn1/5TY9f+U2PX/lNj1/5TY9f+U2PX/lNj1/5bZ9f+Z2vX/' +
  'csnx/2jH8f9ox/H/aMfx/2jH8f9ox/H/aMfx/2jH8f9ox/H/aMfx/2bE7/9mxO//aMfx/2fF8P9nxe//Z8Xv/2fF7/9nxe//Z8Xv/2jF8P9ox/H/csnx/5na' +
  '9f+Z2vX/ldn1/5TY9f+V2fX/lNj1/5XZ9f+U2PX/mtr1/5na9f9yyfH/aMfx/2fF8P9nxe//Z8Xv/2fF7/9nxe//Z8Xv/2fF7/9ox/H/ZsTv/2bE7/9ox/H/' +
  'Z8Xv/2fF7/9nxe//Z8Xv/2fF7/9nxe//aMbw/2jH8f9yyfH/l9n1/5XY9f+V2PX/ldj1/5XY9f+V2PX/ldj1/5XY9f+V2PX/l9n1/3LJ8f9ox/H/aMbw/2fF' +
  '7/9nxe//Z8Xv/2fF7/9nxe//Z8Xv/2jH8f9mxO//ZsTv/2jH8f9nxe//Z8Xv/2fF7/9nxe//Z8Xv/2fF7/9nxfD/aMfx/3DI8P91yvD/bsfw/27H8P9ux/D/' +
  'bsfw/27H8P9ux/D/bsfw/27H8P91yvD/cMjw/2jH8f9nxfD/Z8Xv/2fF7/9nxe//Z8Xv/2fF7/9nxe//aMfx/2bE7/9mxO//aMfx/2fF7/9nxe//Z8Xv/2fF' +
  '7/9nxe//Z8Xv/2jG8P9ox/H/c8nx/6Le9v+l3/b/pd/2/6Xf9v+l3/b/pd/2/6Xf9v+l3/b/pd/2/6Le9v9zyfH/aMfx/2jG8P9nxe//Z8Xv/2fF7/9nxe//' +
  'Z8Xv/2fF7/9ox/H/ZsTv/2bE7/9ox/H/Z8Xv/2fF7/9nxe//Z8Xv/2fF7/9nxe//Z8Xw/2jH8f9zyfH/mtr1/5ra9f+Y2vX/mtr1/5jZ9f+a2vX/mNr1/5ra' +
  '9f+a2vX/mtr1/3PJ8f9ox/H/Z8Xw/2fF7/9nxe//Z8Xv/2fF7/9nxe//Z8Xv/2jH8f9mxO//ZsTv/2jH8f9nxe//Z8Xv/2fF7/9nxe//Z8Xv/2fF7/9oxvD/' +
  'aMfx/3PJ8f+a2vX/ltn1/5TY9f+U2PX/lNj1/5TY9f+U2PX/lNj1/5bZ9f+a2vX/c8nx/2jH8f9oxvD/Z8Xv/2fF7/9nxe//Z8Xv/2fF7/9nxe//aMfx/2bE' +
  '7/9mxO//aMfx/2fF8P9oxvH/Z8Xw/2jG8f9nxfD/aMbx/2fF8P9ox/H/c8nx/5ra9f+Z2vX/lNj1/5TY9f+U2PX/lNj1/5TY9f+U2PX/mdr1/5ra9f9zyfH/' +
  'aMfx/2jG8f9nxfD/aMbx/2fF8P9oxvH/Z8Xw/2jH8f9ox/H/ZsTv/2bE7/9mxO7/ZsTu/2bE7v9mxO7/ZsTu/2bE7v9mxO7/ZsTu/2fE7/9zyfH/mtr1/5bZ' +
  '9f+U2PX/lNj1/5TY9f+U2PX/lNj1/5TY9f+W2fX/mtr1/3PJ8f9nxO//ZsTu/2bE7v9mxO7/ZsTu/2bE7v9mxO7/ZsTu/2bE7v9mxO//Zr/p/2e+6P9nvuj/' +
  'Z77o/2e+6P9nvuj/Z77o/2e+6P9nvuj/Z77o/3PG7v+a2vX/mdr1/5TY9f+U2PX/lNj1/5TY9f+U2PX/lNj1/5na9f+a2vX/c8bu/2e+6P9nvuj/Z77o/2e+' +
  '6P9nvuj/Z77o/2e+6P9nvuj/Z77o/2a/6f9qxvD/dMzy/3TM8v90zPL/dMzy/3TM8v90zPL/dMzy/3TM8v9zzPL/dMrx/5ra9f+W2fX/lNj1/5TY9f+U2PX/' +
  'lNj1/5TY9f+U2PX/ltn1/5ra9f90yvH/c8zy/3TM8v90zPL/dMzy/3TM8v90zPL/dMzy/3TM8v90zPL/asbw/2bE7/9ox/H/aMfx/2jF8P9ox/H/aMXw/2jH' +
  '8f9oxfD/aMfx/2jH8f9zyfH/mtr1/5na9f+U2PX/lNj1/5TY9f+U2PX/lNj1/5TY9f+Z2vX/mtr1/3PJ8f9ox/H/aMbx/2jH8f9oxfD/aMfx/2jF8P9ox/H/' +
  'aMbw/2jH8f9mxO//ZsTv/2jH8f9nxe//Z8Xv/2fF7/9nxe//Z8Xv/2fF7/9oxvD/aMfx/3PJ8f+a2vX/mdr1/5XZ9f+Z2vX/ldn1/5na9f+V2fX/mdr1/5ja' +
  '9f+a2vX/c8nx/2jH8f9oxvD/Z8Xv/2fF7/9nxe//Z8Xv/2fF7/9nxe//aMfx/2bE7/9mxO//aMfx/2fF7/9nxe//Z8Xv/2fF7/9nxe//Z8Xv/2fF8P9ox/H/' +
  'c8nx/5PY9f+O1vX/jtb1/47W9f+O1vX/jtb1/47W9f+O1vX/jtb1/5PY9f9zyfH/aMfx/2fF8P9nxe//Z8Xv/2fF7/9nxe//Z8Xv/2fF7/9ox/H/ZsTv/2bE' +
  '7/9ox/H/Z8Xv/2fF7/9nxe//Z8Xv/2fF7/9nxe//aMbw/2jH8f9xyPH/jdX0/43V9P+N1fT/jdX0/43V9P+N1fT/jdX0/43V9P+N1fT/jdX0/3HI8f9ox/H/' +
  'aMbw/2fF7/9nxe//Z8Xv/2fF7/9nxe//Z8Xv/2jH8f9mxO//ZsTv/2jH8f9nxe//Z8Xv/2fF7/9nxe//Z8Xv/2fF7/9nxfD/aMfx/3PJ8f+e3Pb/od32/6Hd' +
  '9v+h3fb/od32/6Hd9v+h3fb/od32/6Hd9v+e3Pb/c8nx/2jH8f9nxfD/Z8Xv/2fF7/9nxe//Z8Xv/2fF7/9nxe//aMfx/2bE7/9mxO//aMfx/2fF7/9nxe//' +
  'Z8Xv/2fF7/9nxe//Z8Xv/2jG8P9ox/H/c8nx/5ra9f+Y2vX/mdr1/5XZ9f+Z2vX/ldn1/5na9f+V2fX/mdr1/5ra9f9zyfH/aMfx/2jG8P9nxe//Z8Xv/2fF' +
  '7/9nxe//Z8Xv/2fF7/9ox/H/ZsTv/2bE7/9ox/H/Z8Xv/2fF7/9nxe//Z8Xv/2fF7/9nxe//Z8Xw/2jH8f9zyfH/mtr1/5na9f+U2PX/lNj1/5TY9f+U2PX/' +
  'lNj1/5TY9f+Z2vX/mtr1/3PJ8f9ox/H/Z8Xw/2fF7/9nxe//Z8Xv/2fF7/9nxe//Z8Xv/2jH8f9mxO//ZsTv/2jH8f9ox/H/aMbw/2jH8f9oxvD/aMfx/2jG' +
  '8P9ox/H/aMfx/3PJ8f+a2vX/ltn1/5TY9f+U2PX/lNj1/5TY9f+U2PX/lNj1/5bZ9f+a2vX/c8nx/2jH8f9ox/H/aMfx/2jG8P9ox/H/aMbw/2jH8f9oxvD/' +
  'aMfx/2bE7/9lwu3/ZcDr/2XA6/9lwOv/ZcDr/2XA6/9lwOv/ZcDr/2XA6/9lwez/c8nx/5ra9f+Z2vX/lNj1/5TY9f+U2PX/lNj1/5TY9f+U2PX/mdr1/5ra' +
  '9f9zyfH/ZcHs/2XA6/9lwOv/ZcDr/2XA6/9lwOv/ZcDr/2XA6/9lwOv/ZcLt/2rB6/9uxO3/bsTt/27E7f9uxO3/bsTt/27E7f9uxO3/bsTt/27E7f90yO//' +
  'mtr1/5bZ9f+U2PX/lNj1/5TY9f+U2PX/lNj1/5TY9f+W2fX/mtr1/3TI7/9uxO3/bsTt/27E7f9uxO3/bsTt/27E7f9uxO3/bsTt/27E7f9qwev/Z8Xv/27K' +
  '8v9uyvL/bsry/27K8v9uyvL/bsry/27K8v9uyvL/bcny/3PJ8f+a2vX/mdr1/5TY9f+U2PX/lNj1/5TY9f+U2PX/lNj1/5na9f+a2vX/c8nx/23J8v9uyvL/' +
  'bsry/27K8v9uyvL/bsry/27K8v9uyvL/bsry/2fF7/9mxO//aMfx/2fF8P9oxvH/Z8Xw/2jG8f9nxfD/aMbx/2jG8P9ox/H/c8nx/5ra9f+W2fX/lNj1/5TY' +
  '9f+U2PX/lNj1/5TY9f+U2PX/ltn1/5ra9f9zyfH/aMfx/2jH8f9nxfD/aMbx/2fF8P9oxvH/Z8Xw/2jG8f9ox/H/ZsTv/2bE7/9ox/H/Z8Xv/2fF7/9nxe//' +
  'Z8Xv/2fF7/9nxe//Z8Xw/2jH8f9zyfH/mtr1/5ra9f+a2vX/mNr1/5ra9f+Y2fX/mtr1/5ja9f+a2vX/mtr1/3PJ8f9ox/H/Z8Xw/2fF7/9nxe//Z8Xv/2fF' +
  '7/9nxe//Z8Xv/2jH8f9mxO//ZsTv/2jH8f9nxe//Z8Xv/2fF7/9nxe//Z8Xv/2fF7/9oxvD/aMfx/3LJ8f+I1PX/hNL0/4TS9P+E0vT/hNL0/4TS9P+E0vT/' +
  'hNL0/4TS9P+I1PX/csnx/2jH8f9oxvD/Z8Xv/2fF7/9nxe//Z8Xv/2fF7/9nxe//aMfx/2bE7/9mxO//aMfx/2fF7/9nxe//Z8Xv/2fF7/9nxe//Z8Xv/2fF' +
  '8P9ox/H/csnx/6Xe9/+o3/f/qN/3/6jf9/+o3/f/qN/3/6jf9/+o3/f/qN/3/6Xe9/9yyfH/aMfx/2fF8P9nxe//Z8Xv/2fF7/9nxe//Z8Xv/2fF7/9ox/H/' +
  'ZsTv/2bE7/9ox/H/Z8Xv/2fF7/9nxe//Z8Xv/2fF7/9nxe//aMbw/2jH8f9yyfH/m9v2/53b9v+d2/b/ndv2/53b9v+d2/b/ndv2/53b9v+d2/b/m9v2/3LJ' +
  '8f9ox/H/aMbw/2fF7/9nxe//Z8Xv/2fF7/9nxe//Z8Xv/2jH8f9mxO//ZsTv/2jH8f9nxe//Z8Xv/2fF7/9nxe//Z8Xv/2fF7/9nxfD/aMfx/3LJ8f+Z2vX/' +
  'mtr1/5TY9f+V2fX/lNj1/5XZ9f+U2PX/ldn1/5na9f+Z2vX/csnx/2jH8f9nxfD/Z8Xv/2fF7/9nxe//Z8Xv/2fF7/9nxe//aMfx/2bE7/9mxO//aMfx/2fF' +
  '7/9nxe//Z8Xv/2fF7/9nxe//Z8Xv/2jG8f9ox/H/csnx/5na9f+W2fX/lNj1/5TY9f+U2PX/lNj1/5TY9f+U2PX/ltn1/5na9f9yyfH/aMfx/2jG8P9nxe//' +
  'Z8Xv/2fF7/9nxe//Z8Xv/2fF7/9ox/H/ZsTv/2bE7/9ox/H/aMfx/2jH8f9ox/H/aMfx/2jH8f9ox/H/aMfx/2jH8f9yyfH/mdr1/5na9f+U2PX/lNj1/5TY' +
  '9f+U2PX/lNj1/5TY9f+Z2vX/mdr1/3LJ8f9ox/H/aMfx/2jH8f9ox/H/aMfx/2jH8f9ox/H/aMfx/2jH8f9mxO//Y73p/2K55f9iueX/Yrnl/2K55f9iueX/' +
  'Yrnl/2K55f9iueX/Yrrm/3HG7f+Z2vX/ltn1/5TY9f+U2PX/lNj1/5TY9f+U2PX/lNj1/5bZ9f+Z2vX/ccbt/2K65v9iueX/Yrnl/2K55f9iueX/Yrnl/2K5' +
  '5f9iueX/Yrnl/2O96f/OpTb/1Ks+/9SrPv/Uqz7/1Ks+/9SrPv/Uqz7/1Ks+/9SrPv/Uqz7/z6g8/9q5Xf/auV3/2bdY/9m3WP/Zt1j/2bdY/9m3WP/Zt1j/' +
  '2rld/9q5Xf/PqDz/1Ks+/9SrPv/Uqz7/1Ks+/9SrPv/Uqz7/1Ks+/9SrPv/Uqz7/zqU2/8uhL//QpTD/0KUw/9ClMP/QpTD/0KUw/9ClMP/QpTD/0KUw/9Cl' +
  'MP/Opzr/2rld/9q4Wv/Zt1j/2bdY/9m3WP/Zt1j/2bdY/9m3WP/auFr/2rld/86nOv/QpTD/0KUw/9ClMP/QpTD/0KUw/9ClMP/QpTD/0KUw/9ClMP/LoS//' +
  'y6Ev/9ClMP/MojD/y6Ev/8uhL//LoS//y6Ev/8uhL//NojD/0KUw/86nOv/auV3/2rld/9q3Wf/Zt1j/2rdZ/9m3WP/at1n/2bdY/9q5Xv/auV3/zqc6/9Cl' +
  'MP/MoS//y6Ev/8uhL//LoS//y6Ev/8uhL//LoS//0KUw/8uhL//LoS//0KUw/8uhL//LoS//y6Ev/8uhL//LoS//y6Ev/86jMP/QpTD/zqc6/9q4W//Zt1n/' +
  '2bdZ/9m3Wf/Zt1n/2bdZ/9m3Wf/Zt1n/2bdZ/9q4W//Opzr/0KUw/86jMP/LoS//y6Ev/8uhL//LoS//y6Ev/8uhL//QpTD/y6Ev/8uhL//PpTD/y6Ev/8uh' +
  'L//LoS//y6Ev/8uhL//LoS//zKEv/9ClMP/NpTj/zqc8/8ykN//MpDf/zKQ3/8ykN//MpDf/zKQ3/8ykN//MpDf/zqc8/82lOP/QpTD/zKEv/8uhL//LoS//' +
  'y6Ev/8uhL//LoS//y6Ev/8+lMP/LoS//y6Ev/9ClMP/LoS//y6Ev/8uhL//LoS//y6Ev/8uhL//OozD/0KUw/86nOv/cvWb/3b5p/92+af/dvmn/3b5p/92+' +
  'af/dvmn/3b5p/92+af/cvWb/zqc6/9ClMP/OozD/y6Ev/8uhL//LoS//y6Ev/8uhL//LoS//0KUw/8uhL//LoS//z6Uw/8uhL//LoS//y6Ev/8uhL//LoS//' +
  'y6Ev/8yhL//QpTD/zqc6/9q5Xv/auV7/2rhc/9q5Xv/auFz/2rle/9q4XP/auV7/2rle/9q5Xv/Opzr/0KUw/8yhL//LoS//y6Ev/8uhL//LoS//y6Ev/8uh' +
  'L//PpTD/y6Ev/8uhL//QpTD/y6Ev/8uhL//LoS//y6Ev/8uhL//LoS//zqMw/9ClMP/Opzr/2rle/9q4Wv/Zt1j/2bdY/9m3WP/Zt1j/2bdY/9m3WP/auFr/' +
  '2rle/86nOv/QpTD/zqMw/8uhL//LoS//y6Ev/8uhL//LoS//y6Ev/9ClMP/LoS//y6Ev/9ClMP/Moi//zqMw/8yiL//OozD/zKIv/86jMP/Moi//0KUw/86n' +
  'Ov/auV7/2rld/9m3WP/Zt1j/2bdY/9m3WP/Zt1j/2bdY/9q5Xf/auV7/zqc6/9ClMP/PpDD/zKIv/86jMP/Moi//zqMw/8yiL//PpDD/0KUw/8uhL//KoS//' +
  'yqAv/8qgL//KoC//yqAv/8qgL//KoC//yqAv/8qgL//LoS//zqc6/9q5Xv/auFr/2bdY/9m3WP/Zt1j/2bdY/9m3WP/Zt1j/2rha/9q5Xv/Opzr/y6Ev/8qg' +
  'L//KoC//yqAv/8qgL//KoC//yqAv/8qgL//KoC//yqEv/8GaL/+/mS//v5kv/7+ZL/+/mS//v5kv/7+ZL/+/mS//v5kv/7+ZL//Jozr/2rle/9q5Xf/Zt1j/' +
  '2bdY/9m3WP/Zt1j/2bdY/9m3WP/auV3/2rle/8mjOv+/mS//v5kv/7+ZL/+/mS//v5kv/7+ZL/+/mS//v5kv/7+ZL//Bmi//zKQz/9OqO//Tqjv/06o7/9Oq' +
  'O//Tqjv/06o7/9OqO//Tqjv/06o6/8+nO//auV7/2rha/9m3WP/Zt1j/2bdY/9m3WP/Zt1j/2bdY/9q4Wv/auV7/z6c7/9OqOv/Tqjv/06o7/9OqO//Tqjv/' +
  '06o7/9OqO//Tqjv/06o7/8ykM//LoS//0KUw/9ClMP/NozD/0KUw/82jMP/QpTD/zaMw/9ClMP/QpTD/zqc6/9q5Xv/auV3/2bdY/9m3WP/Zt1j/2bdY/9m3' +
  'WP/Zt1j/2rld/9q5Xv/Opzr/0KUw/86kMP/QpTD/zaMw/9ClMP/NozD/0KUw/86jMP/QpTD/y6Ev/8uhL//QpTD/y6Ev/8uhL//LoS//y6Ev/8uhL//LoS//' +
  'zqMw/9ClMP/Opzr/2rle/9q5Xf/Zt1r/2rld/9m3Wv/auV3/2bda/9q5Xf/auV3/2rle/86nOv/QpTD/zqMw/8uhL//LoS//y6Ev/8uhL//LoS//y6Ev/9Cl' +
  'MP/LoS//y6Ev/8+lMP/LoS//y6Ev/8uhL//LoS//y6Ev/8uhL//MoS//0KUw/86nOv/Zt1f/2LVT/9i1U//YtVP/2LVT/9i1U//YtVP/2LVT/9i1U//Zt1f/' +
  'zqc6/9ClMP/MoS//y6Ev/8uhL//LoS//y6Ev/8uhL//LoS//z6Uw/8uhL//LoS//0KUw/8uhL//LoS//y6Ev/8uhL//LoS//y6Ev/86jMP/QpTD/zqY5/9i0' +
  'Uv/YtFL/2LRS/9i0Uv/YtFL/2LRS/9i0Uv/YtFL/2LRS/9i0Uv/Opjn/0KUw/86jMP/LoS//y6Ev/8uhL//LoS//y6Ev/8uhL//QpTD/y6Ev/8uhL//PpTD/' +
  'y6Ev/8uhL//LoS//y6Ev/8uhL//LoS//zKEv/9ClMP/Opzr/3Lti/9y8Zf/cvGX/3Lxl/9y8Zf/cvGX/3Lxl/9y8Zf/cvGX/3Lti/86nOv/QpTD/zKEv/8uh' +
  'L//LoS//y6Ev/8uhL//LoS//y6Ev/8+lMP/LoS//y6Ev/9ClMP/LoS//y6Ev/8uhL//LoS//y6Ev/8uhL//OozD/0KUw/86nOv/auV7/2rld/9q5Xf/Zt1r/' +
  '2rld/9m3Wv/auV3/2bda/9q5Xf/auV7/zqc6/9ClMP/OozD/y6Ev/8uhL//LoS//y6Ev/8uhL//LoS//0KUw/8uhL//LoS//z6Uw/8uhL//LoS//y6Ev/8uh' +
  'L//LoS//y6Ev/8yhL//QpTD/zqc6/9q5Xv/auV3/2bdY/9m3WP/Zt1j/2bdY/9m3WP/Zt1j/2rld/9q5Xv/Opzr/0KUw/8yhL//LoS//y6Ev/8uhL//LoS//' +
  'y6Ev/8uhL//PpTD/y6Ev/8uhL//QpTD/0KUw/82jMP/QpTD/zaMw/9ClMP/NozD/0KUw/9ClMP/Opzr/2rle/9q4Wv/Zt1j/2bdY/9m3WP/Zt1j/2bdY/9m3' +
  'WP/auFr/2rle/86nOv/QpTD/z6Qw/9ClMP/NozD/0KUw/82jMP/QpTD/zaMw/9ClMP/LoS//x54u/8ObLf/Dmy3/w5st/8ObLf/Dmy3/w5st/8ObLf/Dmy3/' +
  'xJwt/82mOv/auV7/2rld/9m3WP/Zt1j/2bdY/9m3WP/Zt1j/2bdY/9q5Xf/auV7/zaY6/8ScLf/Dmy3/w5st/8ObLf/Dmy3/w5st/8ObLf/Dmy3/w5st/8ee' +
  'Lv/FnjP/x6E2/8ehNv/HoTb/x6E2/8ehNv/HoTb/x6E2/8ehNv/HoTb/yqQ7/9q5Xv/auFr/2bdY/9m3WP/Zt1j/2bdY/9m3WP/Zt1j/2rha/9q5Xv/KpDv/' +
  'x6E2/8ehNv/HoTb/x6E2/8ehNv/HoTb/x6E2/8ehNv/HoTb/xZ4z/8yiMP/RqDb/0ag2/9GoNv/RqDb/0ag2/9GoNv/RqDb/0ag2/9GnNf/Opzr/2rle/9q5' +
  'Xf/Zt1j/2bdY/9m3WP/Zt1j/2bdY/9m3WP/auV3/2rle/86nOv/RpzX/0ag2/9GoNv/RqDb/0ag2/9GoNv/RqDb/0ag2/9GoNv/MojD/y6Ev/9ClMP/Moi//' +
  'zqMw/8yiL//OozD/zKIv/86jMP/OpDD/0KUw/86nOv/auV7/2rha/9m3WP/Zt1j/2bdY/9m3WP/Zt1j/2bdY/9q4Wv/auV7/zqc6/9ClMP/QpTD/zKIv/86j' +
  'MP/Moi//zqMw/8yiL//OpDD/0KUw/8uhL//LoS//z6Uw/8uhL//LoS//y6Ev/8uhL//LoS//y6Ev/8yhL//QpTD/zqc6/9q5Xv/auV7/2rle/9q4XP/auV7/' +
  '2rhc/9q5Xv/auFz/2rle/9q5Xv/Opzr/0KUw/8yhL//LoS//y6Ev/8uhL//LoS//y6Ev/8uhL//PpTD/y6Ev/8uhL//QpTD/y6Ev/8uhL//LoS//y6Ev/8uh' +
  'L//LoS//zqMw/9ClMP/Opzr/17JN/9awSf/WsEn/1rBJ/9awSf/WsEn/1rBJ/9awSf/WsEn/17JN/86nOv/QpTD/zqMw/8uhL//LoS//y6Ev/8uhL//LoS//' +
  'y6Ev/9ClMP/LoS//y6Ev/8+lMP/LoS//y6Ev/8uhL//LoS//y6Ev/8uhL//MoS//0KUw/86nOv/dvmn/3sBt/97Abf/ewG3/3sBt/97Abf/ewG3/3sBt/97A' +
  'bf/dvmn/zqc6/9ClMP/MoS//y6Ev/8uhL//LoS//y6Ev/8uhL//LoS//z6Uw/8uhL//LoS//0KUw/8uhL//LoS//y6Ev/8uhL//LoS//y6Ev/86jMP/QpTD/' +
  'zqc6/9u6X//bu2H/27th/9u7Yf/bu2H/27th/9u7Yf/bu2H/27th/9u6X//Opzr/0KUw/86jMP/LoS//y6Ev/8uhL//LoS//y6Ev/8uhL//QpTD/y6Ev/8uh' +
  'L//PpTD/y6Ev/8uhL//LoS//y6Ev/8uhL//LoS//zKEv/9ClMP/Opzr/2rld/9q5Xv/Zt1j/2rdZ/9m3WP/at1n/2bdY/9q3Wf/auV3/2rld/86nOv/QpTD/' +
  'zKEv/8uhL//LoS//y6Ev/8uhL//LoS//y6Ev/8+lMP/LoS//y6Ev/9ClMP/MoS//y6Ev/8uhL//LoS//y6Ev/8uhL//PpDD/0KUw/86nOv/auV3/2rha/9m3' +
  'WP/Zt1j/2bdY/9m3WP/Zt1j/2bdY/9q4Wv/auV3/zqc6/9ClMP/OozD/y6Ev/8uhL//LoS//y6Ev/8uhL//LoS//0KUw/8uhL//LoS//0KUw/9ClMP/QpTD/' +
  '0KUw/9ClMP/QpTD/0KUw/9ClMP/QpTD/zqc6/9q5Xf/auV3/2bdY/9m3WP/Zt1j/2bdY/9m3WP/Zt1j/2rld/9q5Xf/Opzr/0KUw/9ClMP/QpTD/0KUw/9Cl' +
  'MP/QpTD/0KUw/9ClMP/QpTD/y6Ev/76YLP+5kyr/uZMq/7mTKv+5kyr/uZMq/7mTKv+5kyr/uZMq/7qUK//Iojn/2rld/9q4Wv/Zt1j/2bdY/9m3WP/Zt1j/' +
  '2bdY/9m3WP/auFr/2rld/8iiOf+6lCv/uZMq/7mTKv+5kyr/uZMq/7mTKv+5kyr/uZMq/7mTKv++mCz/9OBs//bkef/25Hn/9uR5//bkef/25Hn/9uR5//bk' +
  'ef/25Hn/9uR4//Xidf/466H/+Oug//jrmv/465r/+Oua//jrmf/465r/+Oua//jroP/466H/9eJ1//bkeP/25Hn/9uR5//bkef/25Hn/9uR5//bkef/25Hn/' +
  '9uR5//TgbP/03mT/9eBm//XgZv/14Gb/9eBm//XgZv/14Gb/9eBm//XgZv/14Gb/9OFz//jrof/465z/+Oua//jrmv/465r/+Oua//jrmv/465r/+Ouc//jr' +
  'of/04XP/9eBm//XgZv/14Gb/9eBm//XgZv/14Gb/9eBm//XgZv/14Gb/9N5k//TeZP/14Gb/9N5l//PeZP/z3mT/895k//PeZP/z3mT/9N5l//XgZv/04XP/' +
  '+Ouh//jroP/465z/+Oua//jrm//465r/+Ouc//jrmv/466H/+Ouh//Thc//14Gb/9N5l//PeZP/z3mT/895k//PeZP/z3mT/895k//XgZv/03mT/9N5k//Xg' +
  'Zv/z3mT/895k//PeZP/z3mT/895k//PeZP/032X/9eBm//Thc//4657/+Oqb//jqm//46pv/+Oqb//jqm//46pv/+Oqb//jqm//4657/9OFz//XgZv/032X/' +
  '895k//PeZP/z3mT/895k//PeZP/z3mT/9eBm//TeZP/03mT/9eBm//PeZP/z3mT/895k//PeZP/z3mT/895k//TeZf/14Gb/9OBw//Thdf/0327/9N9u//Tf' +
  'bv/0327/9N9u//Tfbv/0327/9N9u//Thdf/04HD/9eBm//TeZf/z3mT/895k//PeZP/z3mT/895k//PeZP/14Gb/9N5k//TeZP/14Gb/895k//PeZP/z3mT/' +
  '895k//PeZP/z3mT/9N9l//XgZv/04XP/+e2q//nurv/57q7/+e6u//nurv/57q7/+e6u//nurv/57q7/+e2q//Thc//14Gb/9N9l//PeZP/z3mT/895k//Pe' +
  'ZP/z3mT/895k//XgZv/03mT/9N5k//XgZv/z3mT/895k//PeZP/z3mT/895k//PeZP/03mX/9eBm//Thc//466H/+Ouh//jrn//466H/+Ouf//jrof/465//' +
  '+Ouh//jrof/466H/9OFz//XgZv/03mX/895k//PeZP/z3mT/895k//PeZP/z3mT/9eBm//TeZP/03mT/9eBm//PeZP/z3mT/895k//PeZP/z3mT/895k//Tf' +
  'Zf/14Gb/9OFz//jrof/465z/+Oua//jrmf/465r/+Oua//jrmv/465n/+Oud//jrof/04XP/9eBm//TfZf/z3mT/895k//PeZP/z3mT/895k//PeZP/14Gb/' +
  '9N5k//TeZP/14Gb/9N9l//XfZv/032X/9d9m//TfZf/132b/9N9l//XgZv/04XP/+Ouh//jroP/465r/+Oua//jrmv/465n/+Oua//jrmv/466D/+Ouh//Th' +
  'c//14Gb/9eBm//TfZf/132b/9N9l//XfZv/032X/9eBm//XgZv/03mT/9N5k//PdZP/z3WT/891k//PdZP/z3WT/891k//PdZP/z3WT/895k//Thc//466H/' +
  '+Ouc//jrmv/465r/+Oua//jrmv/465r/+Oua//jrnP/466H/9OFz//PeZP/z3WT/891k//PdZP/z3WT/891k//PdZP/z3WT/891k//TeZP/v2WP/7thk/+7Y' +
  'ZP/u2GT/7thk/+7YZP/u2GT/7thk/+7YZP/u2GT/8t9z//jrof/466D/+Oua//jrmv/465n/+Oua//jrmv/465r/+Oug//jrof/y33P/7thk/+7YZP/u2GT/' +
  '7thk/+7YZP/u2GT/7thk/+7YZP/u2GT/79lj//Tfaf/243T/9uN0//bjdP/243T/9uN0//bjdP/243T/9uN0//bjdP/04nT/+Ouh//jrnP/465r/+OuZ//jr' +
  'mv/465r/+Oua//jrmf/465z/+Ouh//TidP/243T/9uN0//bjdP/243T/9uN0//bjdP/243T/9uN0//bjdP/032n/9N5k//XgZv/14Gb/9N9l//XgZv/032X/' +
  '9eBm//TfZf/14Gb/9eBm//Thc//466H/+Oug//jrmv/465r/+Oua//jrmf/465r/+Oua//jroP/466H/9OFz//XgZv/14Gb/9eBm//TfZf/14Gb/9N9l//Xg' +
  'Zv/032X/9eBm//TeZP/03mT/9eBm//PeZP/z3mT/895k//PeZP/z3mT/895k//TfZf/14Gb/9OFz//jrof/466D/+Ouc//jroP/465z/+Oug//jrnP/466D/' +
  '+Ouf//jrof/04XP/9eBm//TfZf/z3mT/895k//PeZP/z3mT/895k//PeZP/14Gb/9N5k//TeZP/14Gb/895k//PeZP/z3mT/895k//PeZP/z3mT/9N5l//Xg' +
  'Zv/04XP/+OqZ//fplP/36ZT/9+mU//fplP/36ZT/9+mU//fplP/36ZT/+OqZ//Thc//14Gb/9N5l//PeZP/z3mT/895k//PeZP/z3mT/895k//XgZv/03mT/' +
  '9N5k//XgZv/z3mT/895k//PeZP/z3mT/895k//PeZP/032X/9eBm//Thcf/36ZL/9+mR//fpkf/36ZH/9+mR//fpkf/36ZH/9+mR//fpkf/36ZL/9OFx//Xg' +
  'Zv/032X/895k//PeZP/z3mT/895k//PeZP/z3mT/9eBm//TeZP/03mT/9eBm//PeZP/z3mT/895k//PeZP/z3mT/895k//TeZf/14Gb/9OFz//ntpv/57an/' +
  '+e2p//ntqf/57an/+e2p//ntqf/57an/+e2p//ntpv/04XP/9eBm//TeZf/z3mT/895k//PeZP/z3mT/895k//PeZP/14Gb/9N5k//TeZP/14Gb/895k//Pe' +
  'ZP/z3mT/895k//PeZP/z3mT/9N9l//XgZv/04XP/+Ouh//jrn//466D/+Ouc//jroP/465z/+Oug//jrnP/466D/+Ouh//Thc//14Gb/9N9l//PeZP/z3mT/' +
  '895k//PeZP/z3mT/895k//XgZv/03mT/9N5k//XgZv/z3mT/895k//PeZP/z3mT/895k//PeZP/03mX/9eBm//Thc//466H/+Oug//jrmv/465r/+OuZ//jr' +
  'mv/465r/+Oua//jroP/466H/9OFz//XgZv/03mX/895k//PeZP/z3mT/895k//PeZP/z3mT/9eBm//TeZP/03mT/9eBm//XgZv/032X/9eBm//TfZf/14Gb/' +
  '9N9l//XgZv/14Gb/9OFz//jrof/465z/+Oua//jrmf/465r/+Oua//jrmv/465n/+Ouc//jrof/04XP/9eBm//XgZv/14Gb/9N9l//XgZv/032X/9eBm//Tf' +
  'Zf/14Gb/9N5k//LcY//w2mL/8Npi//DaYv/w2mL/8Npi//DaYv/w2mL/8Npi//HaYv/04XP/+Ouh//jroP/465r/+Oua//jrmv/465n/+Oua//jrmv/466D/' +
  '+Ouh//Thc//x2mL/8Npi//DaYv/w2mL/8Npi//DaYv/w2mL/8Npi//DaYv/y3GP/8Nto//Hdbv/x3W7/8d1u//Hdbv/x3W7/8d1u//Hdbv/x3W7/8d1u//Lg' +
  'dP/466H/+Ouc//jrmv/465r/+Oua//jrmv/465r/+Oua//jrnP/466H/8uB0//Hdbv/x3W7/8d1u//Hdbv/x3W7/8d1u//Hdbv/x3W7/8d1u//DbaP/032b/' +
  '9uJt//bibf/24m3/9uJt//bibf/24m3/9uJt//bibf/24mz/9OFz//jrof/466D/+Oua//jrmv/465n/+Oua//jrmv/465r/+Oug//jrof/04XP/9uJs//bi' +
  'bf/24m3/9uJt//bibf/24m3/9uJt//bibf/24m3/9N9m//TeZP/14Gb/9N5l//XfZf/03mX/9d9l//TeZf/132X/9N9l//XgZv/04XP/+Ouh//jrnf/465r/' +
  '+OuZ//jrmv/465r/+Oua//jrmf/465z/+Ouh//Thc//14Gb/9eBm//TeZf/132X/9N5l//XfZf/03mX/9d9l//XgZv/03mT/9N5k//XgZv/z3mT/895k//Pe' +
  'ZP/z3mT/895k//PeZP/03mX/9eBm//Thc//466H/+Ouh//jrof/465//+Ouh//jrn//466H/+Ouf//jrof/466H/9OFz//XgZv/03mX/895k//PeZP/z3mT/' +
  '895k//PeZP/z3mT/9eBm//TeZP/03mT/9eBm//PeZP/z3mT/895k//PeZP/z3mT/895k//TfZf/14Gb/9OFy//fojP/354f/9+eH//fnh//354f/9+eH//fn' +
  'h//354f/9+eH//fojP/04XL/9eBm//TfZf/z3mT/895k//PeZP/z3mT/895k//PeZP/14Gb/9N5k//TeZP/14Gb/895k//PeZP/z3mT/895k//PeZP/z3mT/' +
  '9N5l//XgZv/04XL/+e6s//nusP/57rD/+e6w//nusP/57rD/+e6w//nusP/57rD/+e6s//Thcv/14Gb/9N5l//PeZP/z3mT/895k//PeZP/z3mT/895k//Xg' +
  'Zv/03mT/9N5k//XgZv/z3mT/895k//PeZP/z3mT/895k//PeZP/032X/9eBm//Thc//47KP/+Oyl//jspf/47KX/+Oyl//jspf/47KX/+Oyl//jspf/47KP/' +
  '9OFz//XgZv/032X/895k//PeZP/z3mT/895k//PeZP/z3mT/9eBm//TeZP/03mT/9eBm//PeZP/z3mT/895k//PeZP/z3mT/895k//TeZf/14Gb/9OFz//jr' +
  'of/466H/+Oua//jrnP/465r/+Oub//jrmv/465z/+Oug//jrof/04XP/9eBm//TeZf/z3mT/895k//PeZP/z3mT/895k//PeZP/14Gb/9N5k//TeZP/14Gb/' +
  '895k//PeZP/z3mT/895k//PeZP/z3mT/9eBm//XgZv/04XP/+Ouh//jrnP/465r/+Oua//jrmv/465r/+Oua//jrmv/465z/+Ouh//Thc//14Gb/9N9l//Pe' +
  'ZP/z3mT/895k//PeZP/z3mT/895k//XgZv/03mT/9N5k//XgZv/14Gb/9eBm//XgZv/14Gb/9eBm//XgZv/14Gb/9eBm//Thc//466H/+Oug//jrmv/465r/' +
  '+OuZ//jrmv/465r/+Oua//jroP/466H/9OFz//XgZv/14Gb/9eBm//XgZv/14Gb/9eBm//XgZv/14Gb/9eBm//TeZP/u12H/69Rf/+vUX//r1F//69Rf/+vU' +
  'X//r1F//69Rf/+vUX//s1F//8t5x//jrof/465z/+Oua//jrmf/465r/+Oua//jrmv/465n/+Ouc//jrof/y3nH/7NRf/+vUX//r1F//69Rf/+vUX//r1F//' +
  '69Rf/+vUX//r1F//7tdh/yl8wv8yiNP/MojT/yl8wv8wgsf/N4vR/zaK0P8wgsf/KXzC/zKI0/8yiNP/KXzC/zCCx/83i9H/NorQ/zCCx/8pfML/MojT/zKI' +
  '0/8pfML/MILH/zeL0f82itD/MILH/yl8wv8yiNP/MojT/yl8wv8wgsf/N4vR/zaL0P8wgsf/LYLL/zmN1v85jdb/LYLL/0ua2/9gpuH/X6bh/0ua2/8tgsv/' +
  'OY3W/zmN1v8tgsv/S5rb/2Cm4f9fpuH/S5rb/y2Cy/85jdb/OY3W/y2Cy/9Lmtv/YKbh/1+m4f9Lmtv/LYLL/zmN1v85jdb/LYLL/0ua2/9gpuH/X6bh/0ua' +
  '2/8tgcv/OY3W/zmN1v8tgcv/SZnb/1ul4f9bpeH/SZnb/y2By/85jdb/OY3W/y2By/9Jmdv/W6Xh/1ul4f9Jmdv/LYHL/zmN1v85jdb/LYHL/0mZ2/9cpeH/' +
  'W6Xh/0mZ2/8tgcv/OY3W/zmN1v8tgcv/SZnb/1ul4f9bpeH/SZnb/yl8wv8yiNL/MojS/yl8wv8rfsX/MIXO/zCFzv8rfsX/KXzC/zKI0v8yiNL/KXzC/yt+' +
  'xf8whc7/MIXO/yt+xf8pfML/MojS/zKI0v8pfML/K37F/zCFzv8whc7/K37F/yl8wv8yiNL/MojS/yl8wv8rfsX/MIXO/zCFzv8rfsX/NIXJ/z2P0/89j9L/' +
  'NITI/yl8wv8yiNL/MojS/yl8wv8zhMj/PI7S/zyN0f8zhMj/KXzC/zKI0v8yiNL/KXzC/zOEyP88jtL/PI3R/zOEyP8pfML/MojS/zKI0v8pfML/M4TI/zuO' +
  '0v87jdH/M4TI/yl8wv8yiNL/MojS/yl8wv9Lmtv/YKbh/2Cm4f9Lmtv/LYLL/zmN1v85jdb/LYLL/0ua2/9gpuH/YKbh/0ua2/8tgsv/OY3W/zmN1v8tgsv/' +
  'S5rb/2Cm4f9gpuH/S5rb/y2Cy/85jdb/OY3W/y2Cy/9Lmtv/YKbh/2Cm4f9Lmtv/LYLL/zmN1v85jdb/LYLL/0ua2/9gpuH/YKbh/0ua2/8tgcv/OY3W/zmN' +
  '1v8tgcv/S5rb/2Cm4f9gpuH/S5rb/y2By/85jdb/OY3W/y2By/9Lmtv/YKbh/2Cm4f9Lmtv/LYHL/zmN1v85jdb/LYHL/0ua2/9gpuH/YKbh/0ua2/8tgcv/' +
  'OY3W/zmN1v8tgcv/MoPI/zqN0v86jdH/MoPI/yl8wv8yiNP/MojT/yl8wv8yg8j/Oo3S/zqN0f8yg8j/KXzC/zKI0/8yiNP/KXzC/zKDyP86jdL/Oo3R/zKD' +
  'yP8pfML/MojT/zKI0/8pfML/MoPI/zqN0v86jdH/MoPI/yl8wv8yiNP/MojT/yl8wv8pfML/MojT/zKI0/8pfML/LX/G/zKHz/8yh8//LX/G/yl8wv8yiNP/' +
  'MojT/yl8w/8tf8b/MofP/zKHz/8tf8b/KXzC/zKI0/8yiNP/KXzD/y1/xv8yh8//MofP/y1/xv8pfML/MojT/zKI0/8pfMP/LX/G/zKHz/8yh8//LX/G/y2C' +
  'y/85jdb/OY3W/y2Cy/9Kmdv/Xabh/12m4f9Kmdv/LYLL/zmN1v85jdb/LYLL/0qZ2/9dpuH/Xabh/0qZ2/8tgsv/OY3W/zmN1v8tgsv/Spnb/12m4f9dpuH/' +
  'Spnb/y2Cy/85jdb/OY3W/y2Cy/9Kmdv/Xabh/12m4f9Kmdv/LYHL/zmN1v85jdb/LYHL/0ua2/9fpuH/X6bh/0ua2/8tgcv/OY3W/zmN1v8tgcv/S5rb/1+m' +
  '4f9fpuH/S5rb/y2By/85jdb/OY3W/y2By/9Lmtv/X6bh/1+m4f9Lmtv/LYHL/zmN1v85jdb/LYHL/0ua2/9fpuH/X6bh/0ua2/8pfML/MojS/zKI0v8pfML/' +
  'L4HH/zWJ0P81idD/L4HH/yl8wv8yiNP/MojT/yl8w/8vgcf/NYnQ/zWJ0P8vgcf/KXzC/zKI0/8yiNP/KXzD/y+Bx/81itD/NYnQ/y+Bx/8pfML/MojT/zKI' +
  '0/8pfMP/L4HH/zWJ0P81idD/L4HH/zCCx/83i9H/N4vR/zCCx/8pfML/MojS/zKI0v8pfML/MILI/zeL0f83i9H/MILH/yl8wv8yiNP/MojT/yl8w/8wgsj/' +
  'N4vR/zeL0f8wgsf/KXzC/zKI0/8yiNP/KXzD/zCCyP83i9H/N4vR/zCCx/8pfML/MojT/zKI0/8pfMP/S5rb/1+m4f9fpuH/S5rb/y2Cy/85jdb/OY3W/y2C' +
  'y/9Lmtv/X6bh/1+m4f9Lmtv/LYLL/zmN1v85jdb/LYLL/0ua2/9fpuH/X6bh/0ua2/8tgsv/OY3W/zmN1v8tgsv/S5rb/1+m4f9fpuH/S5rb/y2Cy/85jdb/' +
  'OY3W/y2Cy/9Lmtv/X6bh/1+m4f9Lmtv/LYHL/zmN1v85jdb/LYHL/0ua2/9fpuH/X6bh/0ua2/8tgcv/OY3W/zmN1v8tgcv/S5rb/1+m4f9fpuH/S5rb/y2B' +
  'y/85jdb/OY3W/y2By/9Lmtv/X6bh/1+m4f9Lmtv/LYHL/zmN1v85jdb/LYHL/y+Bx/81idD/NYnQ/y+Bx/8pfML/MojT/zKI0/8pfML/L4HH/zWJ0P81idD/' +
  'L4HH/yl8w/8yiNP/MojT/yl8w/8vgcf/NYnQ/zSJ0P8vgcf/KXzD/zKI0/8yiNP/KXzD/y+Bx/81idD/NYnQ/y+Bx/8pfMP/MojT/zKI0/8pfMP/KXzC/zKI' +
  '0/8yiNP/KXzC/zCCyP83i9H/N4vR/zCCyP8pfMP/MojT/zKI0/8pfMP/MILI/zeL0f83i9H/MILI/yl8w/8yiNP/MojT/yl8w/8wgsj/N4vR/zeL0f8wgsj/' +
  'KXzD/zKI0/8yiNP/KXzD/zCCyP83i9H/N4vR/zCCyP8tgsv/OY3W/zmN1v8tgsv/S5rb/1+m4f9fpuH/S5rb/y2Cy/85jdb/OY3W/y2Cy/9Lmtv/X6bh/1+m' +
  '4f9Lmtv/LYLL/zmN1v85jdb/LYLL/0ua2/9fpuH/X6bh/0ua2/8tgsv/OY3W/zmN1v8tgsv/S5rb/1+m4f9fpuH/S5rb/y2By/85jdb/OY3W/y2By/9Lmtv/' +
  'X6bh/1+m4f9Lmtv/LYHL/zmN1v85jdb/LYHL/0ua2/9fpuH/X6bh/0ua2/8tgcv/OY3W/zmN1v8tgcv/S5rb/1+m4f9fpuH/S5rb/y2By/85jdb/OY3W/y2B' +
  'y/9Lmtv/X6bh/1+m4f9Lmtv/KXzC/zKI0v8yiNL/KXzC/y+Bx/82i9H/NorR/y+Bx/8pfML/MojT/zKI0/8pfMP/L4HH/zaL0f82itH/L4LH/yl8wv8yiNP/' +
  'MojT/yl8w/8vgsf/NovR/zaK0f8vgsf/KXzC/zKI0/8yiNP/KXzD/y+Cx/82i9H/NorR/y+Cx/8vgcf/NovR/zaK0P8vgcf/KXzC/zKI0v8yiNL/KXzC/y+B' +
  'x/82i9H/NorR/y+Bx/8pfML/MojT/zKI0/8pfMP/L4HH/zaL0f82itH/L4HH/yl8wv8yiNP/MojT/yl8w/8vgcf/NovR/zaK0f8vgcf/KXzC/zKI0/8yiNP/' +
  'KXzD/0ua2/9fpuH/X6bh/0ua2/8tgsv/OY3W/zmN1v8tgsv/S5rb/1+m4f9fpuH/S5rb/y2Cy/85jdb/OY3W/y2Cy/9Lmtv/X6bh/1+m4f9Lmtv/LYLL/zmN' +
  '1v85jdb/LYLL/0ua2/9fpuH/X6bh/0ua2/8tgsv/OY3W/zmN1v8tgsv/S5rb/2Cm4f9gpuH/S5rb/y2By/85jdb/OY3W/y2By/9Lmtv/YKbh/2Cm4f9Lmtv/' +
  'LYHL/zmN1v85jdb/LYHL/0ua2/9gpuH/YKbh/0ua2/8tgcv/OY3W/zmN1v8tgcv/S5rb/2Cm4f9gpuH/S5rb/y2By/85jdb/OY3W/y2By/8yg8j/Oo3S/zqM' +
  '0f8yg8j/KXzC/zKI0/8yiNP/KXzC/zKDyP86jdL/OozR/zKDyP8pfML/MojT/zKI0/8pfMP/MoTI/zqN0v85jNH/MoPI/yl8wv8yiNP/MojT/yl8w/8yg8j/' +
  'Oo3S/zqM0f8yg8j/KXzC/zKI0/8yiNP/KXzD/yl8wv8yiNP/MojT/yl8wv8tf8b/MofP/zKHz/8tf8b/KXzC/zKI0/8yiNP/KXzD/y1/xv8yh8//MofP/y1/' +
  'xv8pfML/MojT/zKI0/8pfMP/LX/G/zKHz/8yh8//LX/G/yl8wv8yiNP/MojT/yl8w/8tf8b/MofP/zKHz/8tf8b/LYLL/zmN1v85jdb/LYLL/0qZ2/9dpuH/' +
  'Xabh/0qZ2/8tgsv/OY3W/zmN1v8tgsv/Spnb/12m4f9dpuH/Spnb/y2Cy/85jdb/OY3W/y2Cy/9Kmdv/Xabh/12m4f9Kmdv/LYLL/zmN1v85jdb/LYLL/0qZ' +
  '2/9dpuH/Xabh/0qZ2/8tgcv/OY3W/zmN1v8tgcv/S5rb/2Cm4f9fpuH/S5rb/y2By/85jdb/OY3W/y2By/9Lmtv/YKbh/1+m4f9Lmtv/LYHL/zmN1v85jdb/' +
  'LYHL/0ua2/9gpuH/X6bh/0ua2/8tgcv/OY3W/zmN1v8tgcv/S5rb/2Cm4f9fpuH/S5rb/yl8wv8yiNL/MojS/yl8wv8wg8j/OIzS/ziM0f8xg8j/KXzC/zKI' +
  '0/8yiNP/KXzD/zCDyP84jNL/OIzR/zCDyP8pfML/MojT/zKI0/8pfMP/MIPI/ziM0v84jNH/MIPI/yl8wv8yiNP/MojT/yl8w/8wg8j/OIzS/ziM0f8xg8j/' +
  'LoDG/zSJ0P80idD/LoDG/yl8wv8yiNL/MojS/yl8wv8ugMf/NInQ/zSJ0P8ugMb/KXzC/zKI0/8yiNP/KXzD/y6Ax/80idD/NInQ/y6Ax/8pfML/MojT/zKI' +
  '0/8pfMP/LoDH/zSJ0P80idD/LoDH/yl8wv8yiNP/MojT/yl8w/9Lmdv/Xqbh/16m4f9Lmdv/LYLL/zmN1v85jdb/LYLL/0uZ2/9epuH/Xqbh/0uZ2/8tgsv/' +
  'OY3W/zmN1v8tgsv/S5rb/16m4f9epuH/S5nb/y2Cy/85jdb/OY3W/y2Cy/9Lmdv/Xqbh/16m4f9Lmdv/LYLL/zmN1v85jdb/LYLL/0qZ2/9epuH/Xabh/0qZ' +
  '2/8tgcv/OY3W/zmN1v8tgcv/Spnb/16m4f9epuH/Spnb/y2By/85jdb/OY3W/y2By/9Kmdv/Xqbh/16m4f9Kmdv/LYHL/zmN1v85jdb/LYHL/0qZ2/9epuH/' +
  'Xqbh/0qZ2/8tgcv/OY3W/zmN1v8tgcv/LX/G/zKHz/8yh8//LX/G/yl8wv8yiNP/MojT/yl8wv8tgMb/MofP/zKHz/8tgMb/KXzD/zKI0/8yiNP/KXzD/y2A' +
  'xv8yh8//MofP/y2Axv8pfMP/MojT/zKI0/8pfMP/LYDG/zKHz/8yh8//LYDG/yl8w/8yiNP/MojT/yl8w/9/v+r/hsjy/4bI8v9/v+r/fr/q/4HE7v+BxO7/' +
  'fr/q/3+/6v+GyPL/hsjy/3+/6v9+v+r/gcTu/4HE7v9+v+r/f7/q/4bI8v+GyPL/f7/q/36/6v+BxO7/gcTu/36/6v9/v+r/hsjy/4bI8v9/v+r/fr/q/4HE' +
  '7v+BxO7/fr/q/4LE7v+MzPP/jMzz/4LE7v+GyPL/jMzz/4zM8/+GyPL/gsTu/4zM8/+MzPP/gsTu/4bI8v+MzPP/jMzz/4bI8v+CxO7/jMzz/4zM8/+CxO7/' +
  'hsjy/4zM8/+MzPP/hsjy/4LE7v+MzPP/jMzz/4LE7v+GyPL/jMzz/4zM8/+GyPL/gcTu/4vM8/+LzPP/gcTu/4bI8v+MzPP/jMzz/4bI8v+BxO7/i8zz/4vM' +
  '8/+BxO7/hsjy/4zM8/+MzPP/hsjy/4HE7v+LzPP/i8zz/4HE7v+GyPL/jMzz/4zM8/+GyPL/gcTu/4vM8/+LzPP/gcTu/4bI8v+MzPP/jMzz/4bI8v9/v+r/' +
  'hsjy/4bI8v9/v+r/f8Dq/4LE7v+BxO7/f8Dq/3+/6v+GyPL/hsjy/3+/6v9/wOr/gsTu/4HE7v9/wOr/f7/q/4bI8v+GyPL/f7/q/3/A6v+CxO7/gcTu/3/A' +
  '6v9/v+r/hsjy/4bI8v9/v+r/f8Dq/4LE7v+BxO7/f8Dq/36/6v+BxO7/gcTu/36/6v9/v+r/hsjy/4bI8v9/wOr/fr/q/4HE7v+BxO7/fr/q/3+/6v+GyPL/' +
  'hsjy/3/A6v9+v+r/gcTu/4HE7v9+v+r/f7/q/4bI8v+GyPL/f8Dq/36/6v+BxO7/gcTu/36/6v9/v+r/hsjy/4bI8v9/wOr/hsjy/4zM8/+MzPP/hsjy/4LE' +
  '7v+MzPP/jMzz/4LE7v+GyPL/jMzz/4zM8/+GyPL/gsTu/4zM8/+MzPP/gsTu/4bI8v+MzPP/jMzz/4bI8v+CxO7/jMzz/4zM8/+CxO7/hsjy/4zM8/+MzPP/' +
  'hsjy/4LE7v+MzPP/jMzz/4LE7v+GyPL/jMzz/4zM8/+GyPL/gcTu/4vM8/+LzPP/gcTu/4bI8v+MzPP/jMzz/4bI8v+BxO7/i8zz/4vM8/+BxO7/hsjy/4zM' +
  '8/+MzPP/hsjy/4HE7v+LzPP/i8zz/4HE7v+GyPL/jMzz/4zM8/+GyPL/gcTu/4vM8/+LzPP/gcTu/3/A6v+CxO7/gcTu/3/A6v9/v+r/hsjy/4bI8v9/wOr/' +
  'f8Dq/4LE7v+BxO7/f8Dq/3+/6v+GyPL/hsjy/3/A6v9/wOr/gsTu/4HE7v9/wOr/f7/q/4bI8v+GyPL/f8Dq/3/A6v+CxO7/gcTu/3/A6v9/v+r/hsjy/4bI' +
  '8v9/wOr/f7/q/4bI8v+GyPL/f7/q/36/6v+BxO7/gcTu/36/6v9/wOr/hsny/4bJ8v9/wOr/f8Dq/4LE7v+BxO7/f8Dq/3/A6v+GyfL/hsny/3/A6v9/wOr/' +
  'gsTu/4HE7v9/wOr/f8Dq/4bJ8v+GyfL/f8Dq/3/A6v+CxO7/gcTu/3/A6v+CxO7/jMzz/4zM8/+CxO7/hsjy/4zM8/+MzPP/hsjy/4LE7v+MzPP/jMzz/4LE' +
  '7v+GyfL/jMzz/4zM8/+GyfL/gsTu/4zM8/+MzPP/gsTu/4bJ8v+MzPP/jMzz/4bJ8v+CxO7/jMzz/4zM8/+CxO7/hsny/4zM8/+MzPP/hsny/4HE7v+LzPP/' +
  'i8zz/4HE7v+GyPL/jMzz/4zM8/+GyPL/gcTu/4vM8/+LzPP/gcTu/4bI8v+MzPP/jMzz/4bI8v+BxO7/i8zz/4vM8/+BxO7/hsjy/4zM8/+MzPP/hsjy/4HE' +
  '7v+LzPP/i8zz/4HE7v+GyPL/jMzz/4zM8/+GyPL/f7/q/4bI8v+GyPL/f7/q/3/A6v+CxO7/gcTu/3/A6v9/v+r/hsny/4bJ8v9/wOr/f8Dq/4LE7v+BxO7/' +
  'f8Dq/3+/6v+GyfL/hsny/3/A6v9/wOr/gsTu/4HE7v9/wOr/f7/q/4bJ8v+GyfL/f8Dq/3/A6v+CxO7/gcTu/3/A6v9+v+r/gcTu/4HE7v9+v+r/f7/q/4bI' +
  '8v+GyPL/f8Dq/3+/6v+CxO7/gcTu/3+/6v9/v+r/hsny/4bJ8v9/wOr/f8Dq/4LE7v+BxO7/f7/q/3+/6v+GyfL/hsny/3/A6v9/v+r/gsTu/4HE7v9/v+r/' +
  'f7/q/4bJ8v+GyfL/f8Dq/4bI8v+MzPP/jMzz/4bI8v+CxO7/jMzz/4zM8/+CxO7/hsny/4zM8/+MzPP/hsny/4LE7v+MzPP/jMzz/4LE7v+GyfL/jMzz/4zM' +
  '8/+GyfL/gsTu/4zM8/+MzPP/gsTu/4bJ8v+MzPP/jMzz/4bJ8v+CxO7/jMzz/4zM8/+CxO7/hsjy/4zM8/+MzPP/hsjy/4HE7v+LzPP/i8zz/4HE7v+GyPL/' +
  'jMzz/4zM8/+GyPL/gcTu/4vM8/+LzPP/gcTu/4bI8v+MzPP/jMzz/4bI8v+BxO7/i8zz/4vM8/+BxO7/hsjy/4zM8/+MzPP/hsjy/4HE7v+LzPP/i8zz/4HE' +
  '7v9/wOr/gsTu/4HE7v9/wOr/f7/q/4bI8v+GyPL/f8Dq/3/A6v+CxO7/gcTu/3/A6v9/v+r/hsny/4bJ8v9/wOr/f8Dr/4LE7v+BxO7/f8Dq/3+/6v+GyfL/' +
  'hsny/3/A6v9/wOr/gsTu/4HE7v9/wOr/f7/q/4bJ8v+GyfL/f8Dq/3+/6v+GyPL/hsjy/3+/6v9+v+r/gcTu/4HE7v9+v+r/f8Dq/4bJ8v+GyfL/f8Dq/3/A' +
  '6v+CxO7/gcTu/3/A6/9/wOr/hsny/4bJ8v9/wOr/f8Dq/4LE7v+BxO7/f8Dq/3/A6v+GyfL/hsny/3/A6v9/wOr/gsTu/4HE7v9/wOv/gsTu/4zM8/+MzPP/' +
  'gsTu/4bI8v+MzPP/jMzz/4bI8v+CxO7/jMzz/4zM8/+CxO7/hsny/4zM8/+MzPP/hsny/4LE7v+MzPP/jMzz/4LE7v+GyfL/jMzz/4zM8/+GyfL/gsTu/4zM' +
  '8/+MzPP/gsTu/4bJ8v+MzPP/jMzz/4bJ8v+BxO7/i8zz/4vM8/+BxO7/hsjy/4zM8/+MzPP/hsjy/4HE7v+LzPP/i8zz/4HE7v+GyPL/jMzz/4zM8/+GyPL/' +
  'gcTu/4vM8/+LzPP/gcTu/4bI8v+MzPP/jMzz/4bI8v+BxO7/i8zz/4vM8/+BxO7/hsjy/4zM8/+MzPP/hsjy/3+/6v+GyPL/hsjy/3+/6v9/wOr/gsTu/4HE' +
  '7v9/wOr/f7/q/4bJ8v+GyfL/f8Dq/3/A6v+CxO7/gcTu/3/A6v9/v+r/hsny/4bJ8v9/wOr/f8Dq/4LE7v+BxO7/f8Dq/3+/6v+GyfL/hsny/3/A6v9/wOr/' +
  'gsTu/4HE7v9/wOr/fr/q/4HE7v+BxO7/fr/q/3+/6v+GyPL/hsjy/3/A6v9/v+r/gsTu/4HE7v9/v+r/f7/q/4bJ8v+GyfL/f8Dq/3/A6v+CxO7/gcTu/3+/' +
  '6v9/v+r/hsny/4bJ8v9/wOr/f7/q/4LE7v+BxO7/f7/q/3+/6v+GyfL/hsny/3/A6v+GyPL/jMzz/4zM8/+GyPL/gsTu/4zM8/+MzPP/gsTu/4bJ8v+MzPP/' +
  'jMzz/4bJ8v+CxO7/jMzz/4zM8/+CxO7/hsny/4zM8/+MzPP/hsny/4LE7v+MzPP/jMzz/4LE7v+GyfL/jMzz/4zM8/+GyfL/gsTu/4zM8/+MzPP/gsTu/4bI' +
  '8v+MzPP/jMzz/4bI8v+BxO7/i8zz/4vM8/+BxO7/hsjy/4zM8/+MzPP/hsjy/4HE7v+LzPP/i8zz/4HE7v+GyPL/jMzz/4zM8/+GyPL/gcTu/4vM8/+LzPP/' +
  'gcTu/4bI8v+MzPP/jMzz/4bI8v+BxO7/i8zz/4vM8/+BxO7/f8Dq/4LE7v+BxO7/f8Dq/3+/6v+GyPL/hsjy/3/A6v9/wOr/gsTu/4HE7v9/wOr/f7/q/4bJ' +
  '8v+GyfL/f8Dq/3/A6v+CxO7/gcTu/3/A6v9/v+r/hsny/4bJ8v9/wOr/f8Dq/4LE7v+BxO7/f8Dq/3+/6v+GyfL/hsny/3/A6v9/v+r/hsjy/4bI8v9/v+r/' +
  'fr/q/4HE7v+BxO7/fr/q/3/A6v+GyfL/hsny/3/A6v9/wOr/gsTu/4HE7v9/wOr/f8Dq/4bJ8v+GyfL/f8Dq/3/A6v+CxO7/gcTu/3/A6v9/wOr/hsny/4bJ' +
  '8v9/wOr/f8Dq/4LE7v+BxO7/f8Dq/4LE7v+MzPP/jMzz/4LE7v+GyPL/jMzz/4zM8/+GyPL/gsTu/4zM8/+MzPP/gsTu/4bJ8v+MzPP/jMzz/4bJ8v+CxO7/' +
  'jMzz/4zM8/+CxO7/hsny/4zM8/+MzPP/hsny/4LE7v+MzPP/jMzz/4LE7v+GyfL/jMzz/4zM8/+GyfL/gcTu/4vM8/+LzPP/gcTu/4bI8v+MzPP/jMzz/4bI' +
  '8v+BxO7/i8zz/4vM8/+BxO7/hsjy/4zM8/+MzPP/hsjy/4HE7v+LzPP/i8zz/4HE7v+GyPL/jMzz/4zM8/+GyPL/gcTu/4vM8/+LzPP/gcTu/4bI8v+MzPP/' +
  'jMzz/4bI8v9/v+r/hsjy/4bI8v9/v+r/f8Dq/4LE7v+BxO7/f8Dq/3+/6v+GyfL/hsny/3/A6v9/wOr/gsTu/4HE7v9/wOr/f7/q/4bJ8v+GyfL/f8Dq/3/A' +
  '6v+CxO7/gcTu/3/A6v9/v+r/hsny/4bJ8v9/wOr/f8Dq/4LE7v+BxO7/f8Dq/36/6v+BxO7/gcTu/36/6v9/v+r/hsjy/4bI8v9/wOr/f7/q/4LE7v+BxO7/' +
  'f7/q/3+/6v+GyfL/hsny/3/A6v9/wOr/gsTu/4HE7v9/v+r/f7/q/4bJ8v+GyfL/f8Dq/3+/6v+CxO7/gcTu/3+/6v9/v+r/hsny/4bJ8v9/wOr/hsjy/4zM' +
  '8/+MzPP/hsjy/4LE7v+MzPP/jMzz/4LE7v+GyfL/jMzz/4zM8/+GyfL/gsTu/4zM8/+MzPP/gsTu/4bJ8v+MzPP/jMzz/4bJ8v+CxO7/jMzz/4zM8/+CxO7/' +
  'hsny/4zM8/+MzPP/hsny/4LE7v+MzPP/jMzz/4LE7v+GyPL/jMzz/4zM8/+GyPL/gcTu/4vM8/+LzPP/gcTu/4bI8v+MzPP/jMzz/4bI8v+BxO7/i8zz/4vM' +
  '8/+BxO7/hsjy/4zM8/+MzPP/hsjy/4HE7v+LzPP/i8zz/4HE7v+GyPL/jMzz/4zM8/+GyPL/gcTu/4vM8/+LzPP/gcTu/3/A6v+CxO7/gcTu/3/A6v9/v+r/' +
  'hsjy/4bI8v9/wOr/f8Dq/4LE7v+BxO7/f8Dq/3+/6v+GyfL/hsny/3/A6v9/wOv/gsTu/4HE7v9/wOr/f7/q/4bJ8v+GyfL/f8Dq/3/A6v+CxO7/gcTu/3/A' +
  '6v9/v+r/hsny/4bJ8v9/wOr/wW4q/9J6Mv/SejL/wW4q/8JuKv/KdC7/ynQt/8JuKv/Bbir/0noy/9J6Mv/Bbir/wm4q/8p0Lv/KdC3/wm4q/8FuKv/SejL/' +
  '0noy/8FuKv/Cbir/ynQu/8p0Lf/Cbir/wW4q/9J6Mv/SejL/wW4q/8JuKv/KdC7/ynQu/8JuKv/KdC7/1YA5/9WAOf/KdS7/0noz/9WAOv/UgDn/0noy/8p0' +
  'Lv/VgDn/1YA5/8p1Lv/SejP/1YA6/9SAOf/SejL/ynQu/9WAOf/VgDn/ynUu/9J6M//VgDr/1IA5/9J6Mv/KdC7/1YA5/9WAOf/KdS7/0noz/9WAOv/UgDn/' +
  '0noy/8p0Lv/VgDn/1YA5/8p0Lv/SejP/1YA6/9SAOf/SejL/ynQu/9WAOf/VgDn/ynQu/9J6M//VgDr/1IA5/9J6Mv/KdC7/1YA5/9WAOf/KdC7/0noz/9WA' +
  'Ov/UgDn/0noy/8p0Lv/VgDn/1YA5/8p0Lv/SejP/1YA6/9SAOf/SejL/wW4q/9F6Mv/RejL/wW4q/8JuKv/KdS7/ynQu/8JuKv/Bbir/0Xoy/9F6Mv/Bbir/' +
  'wm4q/8p1Lv/KdC7/wm4q/8FuKv/RejL/0Xoy/8FuKv/Cbir/ynUu/8p0Lv/Cbir/wW4q/9F6Mv/RejL/wW4q/8JuKv/KdS7/ynQu/8JuKv/Cbir/ynQu/8p0' +
  'Lv/Cbir/wW4q/9F6Mv/RejL/wW4q/8JuKv/KdC7/ynQu/8JuKv/Bbir/0Xoy/9F6Mv/Bbir/wm4q/8p0Lv/KdC7/wm4q/8FuKv/RejL/0Xoy/8FuKv/Cbir/' +
  'ynQu/8p0Lv/Cbir/wW4q/9F6Mv/RejL/wW4q/9J6Mv/VgDr/1IA5/9J6M//KdC7/1YA5/9WAOf/KdS7/0noy/9WAOv/UgDn/0noz/8p0Lv/VgDn/1YA5/8p1' +
  'Lv/SejL/1YA6/9SAOf/SejP/ynQu/9WAOf/VgDn/ynUu/9J6Mv/VgDr/1IA5/9J6M//KdC7/1YA5/9WAOf/KdS7/0noy/9WAOv/UgDn/0noz/8p0Lv/VgDn/' +
  '1YA5/8p0Lv/SejL/1YA6/9SAOf/SejP/ynQu/9WAOf/VgDn/ynQu/9J6Mv/VgDr/1IA5/9J6M//KdC7/1YA5/9WAOf/KdC7/0noy/9WAOv/UgDn/0noz/8p0' +
  'Lv/VgDn/1YA5/8p0Lv/Cbir/ynUu/8p0Lf/Cbir/wW4q/9J6Mv/SejL/wW4q/8JuKv/KdS7/ynQt/8JuKv/Bbir/0noy/9J6Mv/Bbir/wm4q/8p1Lv/KdC3/' +
  'wm4q/8FuKv/SejL/0noy/8FuKv/Cbir/ynUu/8p0Lf/Cbir/wW4q/9J6Mv/SejL/wW4q/8FuKv/SejL/0noy/8FuKv/Cbir/ynQu/8p0Lf/Cbir/wW4q/9J6' +
  'Mv/SejL/wm4q/8JuKv/KdS7/ynQu/8JuKv/Bbir/0noy/9J6Mv/Cbir/wm4q/8p1Lv/KdC7/wm4q/8FuKv/SejL/0noy/8JuKv/Cbir/ynUu/8p0Lv/Cbir/' +
  'ynQu/9WAOf/VgDn/ynUu/9J6M//VgDr/1IA5/9J6Mv/KdC7/1YA5/9WAOv/KdC7/0noz/9WAOv/UgDn/0noz/8p0Lv/VgDn/1YA6/8p0Lv/SejP/1YA6/9SA' +
  'Of/SejP/ynQu/9WAOf/VgDr/ynQu/9J6M//VgDr/1IA5/9J6M//KdC7/1YA5/9WAOf/KdC7/0noz/9WAOv/UgDn/0noy/8p0Lv/VgDn/1YA6/8p0Lv/SejP/' +
  '1YA6/9WAOf/SejP/ynQu/9WAOf/VgDr/ynQu/9J6M//VgDr/1YA5/9J6M//KdC7/1YA5/9WAOv/KdC7/0noz/9WAOv/VgDn/0noz/8FuKv/RejL/0Xoy/8Fu' +
  'Kv/Cbir/ynUu/8p0Lv/Cbir/wW4q/9J6Mv/SejL/wm4q/8JuKv/KdC7/ynQu/8JuKv/Bbir/0noy/9J6Mv/Cbir/wm4q/8p0Lv/KdC7/wm4q/8FuKv/SejL/' +
  '0noy/8JuKv/Cbir/ynQu/8p0Lv/Cbir/wm4q/8p0Lv/KdC7/wm4q/8FuKv/RejL/0Xoy/8FuKv/Cbir/ynQu/8p0Lv/Cbir/wW4q/9J6Mv/SejL/wm4q/8Ju' +
  'Kv/KdC7/ynQu/8JuKv/Bbir/0noy/9J6Mv/Cbir/wm4q/8p0Lv/KdC7/wm4q/8FuKv/SejL/0noy/8JuKv/SejL/1YA6/9SAOf/SejP/ynQu/9WAOf/VgDn/' +
  'ynUu/9J6M//VgDr/1IA5/9J6M//KdC7/1YA5/9WAOv/KdC7/0noz/9WAOv/UgDn/0noz/8p0Lv/VgDn/1YA6/8p0Lv/SejP/1YA6/9SAOf/SejP/ynQu/9WA' +
  'Of/VgDr/ynQu/9J6Mv/VgDr/1IA5/9J6M//KdC7/1YA5/9WAOf/KdC7/0noz/9WAOv/VgDn/0noz/8p0Lv/VgDn/1YA6/8p0Lv/SejP/1YA6/9WAOf/SejP/' +
  'ynQu/9WAOf/VgDr/ynQu/9J6M//VgDr/1YA5/9J6M//KdC7/1YA5/9WAOv/KdC7/wm4q/8p1Lv/KdC3/wm4q/8FuKv/SejL/0noy/8FuKv/Cbir/ynQu/8p0' +
  'Lv/Cbir/wm4q/9J6Mv/SejL/wm4q/8JvKv/KdC7/ynQu/8JuKv/Cbir/0noy/9J6Mv/Cbir/wm4q/8p0Lv/KdC7/wm4q/8JuKv/SejL/0noy/8JuKv/Bbir/' +
  '0noy/9J6Mv/Bbir/wm4q/8p0Lv/KdC3/wm4q/8JuKv/SejL/0noy/8JuKv/Cbir/ynUu/8p0Lv/Cbyr/wm4q/9J6Mv/SejL/wm4q/8JuKv/KdS7/ynQu/8Ju' +
  'Kv/Cbir/0noy/9J6Mv/Cbir/wm4q/8p1Lv/KdC7/wm8q/8p0Lv/VgDn/1YA5/8p1Lv/SejP/1YA6/9SAOf/SejL/ynQu/9WAOf/VgDr/ynQu/9J6M//VgDr/' +
  '1IA5/9J6M//KdC7/1YA5/9WAOv/KdC7/0noz/9WAOv/UgDn/0noz/8p0Lv/VgDn/1YA6/8p0Lv/SejP/1YA6/9SAOf/SejP/ynQu/9WAOf/VgDn/ynQu/9J6' +
  'M//VgDr/1IA5/9J6Mv/KdC7/1YA5/9WAOv/KdC7/0noz/9WAOv/VgDn/0noz/8p0Lv/VgDn/1YA6/8p0Lv/SejP/1YA6/9WAOf/SejP/ynQu/9WAOf/VgDr/' +
  'ynQu/9J6M//VgDr/1YA5/9J6M//Bbir/0Xoy/9F6Mv/Bbir/wm4q/8p1Lv/KdC7/wm4q/8FuKv/SejL/0noy/8JuKv/Cbir/ynQu/8p0Lv/Cbir/wW4q/9J6' +
  'Mv/SejL/wm4q/8JuKv/KdC7/ynQu/8JuKv/Bbir/0noy/9J6Mv/Cbir/wm4q/8p0Lv/KdC7/wm4q/8JuKv/KdC7/ynQu/8JuKv/Bbir/0Xoy/9F6Mv/Bbir/' +
  'wm4q/8p0Lv/KdC7/wm4q/8FuKv/SejL/0noy/8JuKv/Cbir/ynQu/8p0Lv/Cbir/wW4q/9J6Mv/SejL/wm4q/8JuKv/KdC7/ynQu/8JuKv/Bbir/0noy/9J6' +
  'Mv/Cbir/0noy/9WAOv/UgDn/0noz/8p0Lv/VgDn/1YA5/8p1Lv/SejP/1YA6/9SAOf/SejP/ynQu/9WAOf/VgDr/ynQu/9J6M//VgDr/1IA5/9J6M//KdC7/' +
  '1YA5/9WAOv/KdC7/0noz/9WAOv/UgDn/0noz/8p0Lv/VgDn/1YA6/8p0Lv/SejL/1YA6/9SAOf/SejP/ynQu/9WAOf/VgDn/ynQu/9J6M//VgDr/1YA5/9J6' +
  'M//KdC7/1YA5/9WAOv/KdC7/0noz/9WAOv/VgDn/0noz/8p0Lv/VgDn/1YA6/8p0Lv/SejP/1YA6/9WAOf/SejP/ynQu/9WAOf/VgDr/ynQu/8JuKv/KdS7/' +
  'ynQt/8JuKv/Bbir/0noy/9J6Mv/Bbir/wm4q/8p0Lv/KdC7/wm4q/8FuKv/SejL/0noy/8JuKv/Cbyr/ynQu/8p0Lv/Cbir/wW4q/9J6Mv/SejL/wm4q/8Ju' +
  'Kv/KdC7/ynQu/8JuKv/Bbir/0noy/9J6Mv/Cbir/wW4q/9J6Mv/SejL/wW4q/8JuKv/KdC7/ynQt/8JuKv/Bbir/0noy/9J6Mv/Cbir/wm4q/8p1Lv/KdC7/' +
  'wm4q/8FuKv/SejL/0noy/8JuKv/Cbir/ynUu/8p0Lv/Cbir/wW4q/9J6Mv/SejL/wm4q/8JuKv/KdS7/ynQu/8JuKv/KdC7/1YA5/9WAOf/KdS7/0noz/9WA' +
  'Ov/UgDn/0noy/8p0Lv/VgDn/1YA6/8p0Lv/SejP/1YA6/9SAOf/SejP/ynQu/9WAOf/VgDr/ynQu/9J6M//VgDr/1IA5/9J6M//KdC7/1YA5/9WAOv/KdC7/' +
  '0noz/9WAOv/UgDn/0noz/8p0Lv/VgDn/1YA5/8p0Lv/SejP/1YA6/9SAOf/SejL/ynQu/9WAOf/VgDr/ynQu/9J6M//VgDr/1YA5/9J6M//KdC7/1YA5/9WA' +
  'Ov/KdC7/0noz/9WAOv/VgDn/0noz/8p0Lv/VgDn/1YA6/8p0Lv/SejP/1YA6/9WAOf/SejP/wW4q/9F6Mv/RejL/wW4q/8JuKv/KdS7/ynQu/8JuKv/Bbir/' +
  '0noy/9J6Mv/Cbir/wm4q/8p0Lv/KdC7/wm4q/8FuKv/SejL/0noy/8JuKv/Cbir/ynQu/8p0Lv/Cbir/wW4q/9J6Mv/SejL/wm4q/8JuKv/KdC7/ynQu/8Ju' +
  'Kv/Cbir/ynQu/8p0Lv/Cbir/wW4q/9F6Mv/RejL/wW4q/8JuKv/KdC7/ynQu/8JuKv/Bbir/0noy/9J6Mv/Cbir/wm4q/8p0Lv/KdC7/wm4q/8FuKv/SejL/' +
  '0noy/8JuKv/Cbir/ynQu/8p0Lv/Cbir/wW4q/9J6Mv/SejL/wm4q/9J6Mv/VgDr/1IA5/9J6M//KdC7/1YA5/9WAOf/KdS7/0noz/9WAOv/UgDn/0noz/8p0' +
  'Lv/VgDn/1YA6/8p0Lv/SejP/1YA6/9SAOf/SejP/ynQu/9WAOf/VgDr/ynQu/9J6M//VgDr/1IA5/9J6M//KdC7/1YA5/9WAOv/KdC7/0noy/9WAOv/UgDn/' +
  '0noz/8p0Lv/VgDn/1YA5/8p0Lv/SejP/1YA6/9WAOf/SejP/ynQu/9WAOf/VgDr/ynQu/9J6M//VgDr/1YA5/9J6M//KdC7/1YA5/9WAOv/KdC7/0noz/9WA' +
  'Ov/VgDn/0noz/8p0Lv/VgDn/1YA6/8p0Lv/Cbir/ynUu/8p0Lv/Cbir/wW4q/9J6Mv/SejL/wW4q/8JuKv/KdC7/ynQu/8JuKv/Cbir/0noy/9J6Mv/Cbir/' +
  'wm8q/8p0Lv/KdC7/wm4q/8JuKv/SejL/0noy/8JuKv/Cbir/ynQu/8p0Lv/Cbir/wm4q/9J6Mv/SejL/wm4q/+q2f//xv4b/8r+G/+q2f//qtn//7bqC/+26' +
  'gv/qtn//6rZ///G/hv/yv4b/6rZ//+q2f//tuoL/7bqC/+q2f//qtn//8b+G//K/hv/qtn//6rZ//+26gv/tuoL/6rZ//+q2f//xv4b/8r+G/+q2f//qtn//' +
  '7bqC/+26gv/qtn//7rqC//PDjP/zw4z/7rqC//G/h//zw4z/8sKM//G/h//uuoL/88OM//PDjP/uuoL/8b+H//PDjP/ywoz/8b+H/+66gv/zw4z/88OM/+66' +
  'gv/xv4f/88OM//LCjP/xv4f/7rqC//PDjP/zw4z/7rqC//G/h//zw4z/8sKM//G/h//tuoL/88KM//PCjP/tuoL/8b+H//PDjf/ywoz/8b+H/+26gv/zwoz/' +
  '88KM/+26gv/xv4f/88ON//LCjP/xv4f/7bqC//PCjP/zwoz/7bqC//G/h//zw43/8sKM//G/h//tuoL/88KM//PCjP/tuoL/8b+H//PDjf/ywoz/8b+H/+q2' +
  'f//xv4b/8r+G/+q2f//qtn//7rqC/+26gv/qtn//6rZ///G/hv/yv4b/6rZ//+q2f//uuoL/7bqC/+q2f//qtn//8b+G//K/hv/qtn//6rZ//+66gv/tuoL/' +
  '6rZ//+q2f//xv4b/8r+G/+q2f//qtn//7rqC/+26gv/qtn//6rZ//+26gv/tuoL/6rZ//+q2f//xv4b/8r+G/+q2f//qtn//7bqC/+26gv/qtn//6rZ///G/' +
  'hv/yv4b/6rZ//+q2f//tuoL/7bqC/+q2f//qtn//8b+G//K/hv/qtn//6rZ//+26gv/tuoL/6rZ//+q2f//xv4b/8r+G/+q2f//xv4f/88OM//LCjP/xv4f/' +
  '7rqC//PDjP/zw4z/7rqC//G/h//zw4z/8sKM//G/h//uuoL/88OM//PDjP/uuoL/8b+H//PDjP/ywoz/8b+H/+66gv/zw4z/88OM/+66gv/xv4f/88OM//LC' +
  'jP/xv4f/7rqC//PDjP/zw4z/7rqC//G/h//zw43/8sKM//G/h//tuoL/88KM//PCjP/tuoL/8b+H//PDjf/ywoz/8b+H/+26gv/zwoz/88KM/+26gv/xv4f/' +
  '88ON//LCjP/xv4f/7bqC//PCjP/zwoz/7bqC//G/h//zw43/8sKM//G/h//tuoL/88KM//PCjP/tuoL/6rZ//+66gv/tuoL/6rZ//+q2f//xv4b/8r+G/+q2' +
  'f//qtn//7rqC/+26gv/qtn//6rZ///G/hv/yv4b/6rZ//+q2f//uuoL/7bqC/+q2f//qtn//8b+G//K/hv/qtn//6rZ//+66gv/tuoL/6rZ//+q2f//xv4b/' +
  '8r+G/+q2f//qtn//8b+G//K/hv/qtn//6rZ//+26gv/tuoL/6rZ//+q2f//xv4b/8b+G/+q2f//qtn//7rqC/+26gv/qtn//6rZ///G/hv/xv4b/6rZ//+q2' +
  'f//uuoL/7bqC/+q2f//qtn//8b+G//G/hv/qtn//6rZ//+66gv/tuoL/6rZ//+66gv/zw4z/88OM/+66gv/xv4f/88OM//LCjP/xv4f/7rqC//PDjP/zw4z/' +
  '7rqC//G/h//zw43/8sKM//G/h//uuoL/88OM//PDjP/uuoL/8b+H//PDjf/ywoz/8b+H/+66gv/zw4z/88OM/+66gv/xv4f/88ON//LCjP/xv4f/7bqC//PC' +
  'jP/zwoz/7bqC//G/h//zw43/8sKM//G/h//tuoL/88KM//PDjP/tuoL/8b+H//PDjf/ywoz/8b+H/+26gv/zwoz/88OM/+26gv/xv4f/88ON//LCjP/xv4f/' +
  '7bqC//PCjP/zw4z/7bqC//G/h//zw43/8sKM//G/h//qtn//8b+G//K/hv/qtn//6rZ//+66gv/tuoL/6rZ//+q2f//xv4b/8b+G/+q2f//qtn//7rqC/+26' +
  'gv/qtn//6rZ///G/hv/xv4b/6rZ//+q2f//uuoL/7bqC/+q2f//qtn//8b+G//G/hv/qtn//6rZ//+66gv/tuoL/6rZ//+q2f//tuoL/7bqC/+q2f//qtn//' +
  '8b+G//K/hv/qtn//6rZ//+66gv/tuoL/6rZ//+q2f//xv4b/8b+G/+q2f//qtn//7rqC/+26gv/qtn//6rZ///G/hv/xv4b/6rZ//+q2f//uuoL/7bqC/+q2' +
  'f//qtn//8b+G//G/hv/qtn//8b+H//PDjP/ywoz/8b+H/+66gv/zw4z/88OM/+66gv/xv4f/88ON//LCjP/xv4f/7rqC//PDjP/zw4z/7rqC//G/h//zw43/' +
  '8sKM//G/h//uuoL/88OM//PDjP/uuoL/8b+H//PDjf/ywoz/8b+H/+66gv/zw4z/88OM/+66gv/xv4f/88ON//LCjP/xv4f/7bqC//PCjP/zwoz/7bqC//G/' +
  'h//zw43/8sKM//G/h//tuoL/88KM//PDjP/tuoL/8b+H//PDjf/ywoz/8b+H/+26gv/zwoz/88OM/+26gv/xv4f/88ON//LCjP/xv4f/7bqC//PCjP/zw4z/' +
  '7bqC/+q2f//uuoL/7bqC/+q2f//qtn//8b+G//K/hv/qtn//6rZ//+66gv/tuoL/6rZ//+q2f//xv4b/8b+G/+q2f//qtn//7rqC/+26gv/qtn//6rZ///G/' +
  'hv/xv4b/6rZ//+q2f//uuoL/7bqC/+q2f//qtn//8b+G//G/hv/qtn//6rZ///G/hv/yv4b/6rZ//+q2f//tuoL/7bqC/+q2f//qtn//8b+G//G/hv/qtn//' +
  '6rZ//+66gv/tuoL/6rZ//+q2f//xv4b/8b+G/+q2f//qtn//7rqC/+26gv/qtn//6rZ///G/hv/xv4b/6rZ//+q2f//uuoL/7bqC/+q2f//uuoL/88OM//PD' +
  'jP/uuoL/8b+H//PDjP/ywoz/8b+H/+66gv/zw4z/88OM/+66gv/xv4f/88ON//LCjP/xv4f/7rqC//PDjP/zw4z/7rqC//G/h//zw43/8sKM//G/h//uuoL/' +
  '88OM//PDjP/uuoL/8b+H//PDjf/ywoz/8b+H/+26gv/zwoz/88KM/+26gv/xv4f/88ON//LCjP/xv4f/7bqC//PCjP/zw4z/7bqC//G/h//zw43/8sKM//G/' +
  'h//tuoL/88KM//PDjP/tuoL/8b+H//PDjf/ywoz/8b+H/+26gv/zwoz/88OM/+26gv/xv4f/88ON//LCjP/xv4f/6rZ///G/hv/yv4b/6rZ//+q2f//uuoL/' +
  '7bqC/+q2f//qtn//8b+G//G/hv/qtn//6rZ//+66gv/tuoL/6rZ//+q2f//xv4b/8b+G/+q2f//qtn//7rqC/+26gv/qtn//6rZ///G/hv/xv4b/6rZ//+q2' +
  'f//uuoL/7bqC/+q2f//qtn//7bqC/+26gv/qtn//6rZ///G/hv/yv4b/6rZ//+q2f//uuoL/7bqC/+q2f//qtn//8b+G//G/hv/qtn//6rZ//+66gv/tuoL/' +
  '6rZ//+q2f//xv4b/8b+G/+q2f//qtn//7rqC/+26gv/qtn//6rZ///G/hv/xv4b/6rZ///G/h//zw4z/8sKM//G/h//uuoL/88OM//PDjP/uuoL/8b+H//PD' +
  'jf/ywoz/8b+H/+66gv/zw4z/88OM/+66gv/xv4f/88ON//LCjP/xv4f/7rqC//PDjP/zw4z/7rqC//G/h//zw43/8sKM//G/h//uuoL/88OM//PDjP/uuoL/' +
  '8b+H//PDjf/ywoz/8b+H/+26gv/zwoz/88KM/+26gv/xv4f/88ON//LCjP/xv4f/7bqC//PCjP/zw4z/7bqC//G/h//zw43/8sKM//G/h//tuoL/88KM//PD' +
  'jP/tuoL/8b+H//PDjf/ywoz/8b+H/+26gv/zwoz/88OM/+26gv/qtn//7rqC/+26gv/qtn//6rZ///G/hv/yv4b/6rZ//+q2f//uuoL/7bqC/+q2f//qtn//' +
  '8b+G//G/hv/qtn//6rZ//+66gv/tuoL/6rZ//+q2f//xv4b/8b+G/+q2f//qtn//7rqC/+26gv/qtn//6rZ///G/hv/xv4b/6rZ//+q2f//xv4b/8r+G/+q2' +
  'f//qtn//7bqC/+26gv/qtn//6rZ///G/hv/xv4b/6rZ//+q2f//uuoL/7bqC/+q2f//qtn//8b+G//G/hv/qtn//6rZ//+66gv/tuoL/6rZ//+q2f//xv4b/' +
  '8b+G/+q2f//qtn//7rqC/+26gv/qtn//7rqC//PDjP/zw4z/7rqC//G/h//zw4z/8sKM//G/h//uuoL/88OM//PDjP/uuoL/8b+H//PDjf/ywoz/8b+H/+66' +
  'gv/zw4z/88OM/+66gv/xv4f/88ON//LCjP/xv4f/7rqC//PDjP/zw4z/7rqC//G/h//zw43/8sKM//G/h//tuoL/88KM//PCjP/tuoL/8b+H//PDjf/ywoz/' +
  '8b+H/+26gv/zwoz/88OM/+26gv/xv4f/88ON//LCjP/xv4f/7bqC//PCjP/zw4z/7bqC//G/h//zw43/8sKM//G/h//tuoL/88KM//PDjP/tuoL/8b+H//PD' +
  'jf/ywoz/8b+H/+q2f//xv4b/8r+G/+q2f//qtn//7rqC/+26gv/qtn//6rZ///G/hv/xv4b/6rZ//+q2f//uuoL/7bqC/+q2f//qtn//8b+G//G/hv/qtn//' +
  '6rZ//+66gv/tuoL/6rZ//+q2f//xv4b/8b+G/+q2f//qtn//7rqC/+26gv/qtn//6rZ//+26gv/tuoL/6rZ//+q2f//xv4b/8r+G/+q2f//qtn//7rqC/+26' +
  'gv/qtn//6rZ///G/hv/xv4b/6rZ//+q2f//uuoL/7bqC/+q2f//qtn//8b+G//G/hv/qtn//6rZ//+66gv/tuoL/6rZ//+q2f//xv4b/8b+G/+q2f//xv4f/' +
  '88OM//LCjP/xv4f/7rqC//PDjP/zw4z/7rqC//G/h//zw43/8sKM//G/h//uuoL/88OM//PDjP/uuoL/8b+H//PDjf/ywoz/8b+H/+66gv/zw4z/88OM/+66' +
  'gv/xv4f/88ON//LCjP/xv4f/7rqC//PDjP/zw4z/7rqC//G/h//zw43/8sKM//G/h//tuoL/88KM//PCjP/tuoL/8b+H//PDjf/ywoz/8b+H/+26gv/zwoz/' +
  '88OM/+26gv/xv4f/88ON//LCjP/xv4f/7bqC//PCjP/zw4z/7bqC//G/h//zw43/8sKM//G/h//tuoL/88KM//PDjP/tuoL/6rZ//+66gv/tuoL/6rZ//+q2' +
  'f//xv4b/8r+G/+q2f//qtn//7rqC/+26gv/qtn//6rZ///G/hv/xv4b/6rZ//+q2f//uuoL/7bqC/+q2f//qtn//8b+G//G/hv/qtn//6rZ//+66gv/tuoL/' +
  '6rZ//+q2f//xv4b/8b+G/+q2f/9GYj7/RmI+/0ZiPv9GYj7/RmI+/0ZiPv9GYj7/RmI+/0ZiPv9GYj7/RmI+/0ZiPv9GYj7/RmI+/0ZiPv9GYj7/RmI+/0Zi' +
  'Pv9GYj7/RmI+/0ZiPv9GYj7/RmI+/0ZiPv9GYj7/RmI+/0ZiPv9GYj7/RmI+/0ZiPv9GYj7/RmI+/0pqQ/9KakP/SmpD/0ZjP/9Ud0v/VHdL/09wR/9YfE7/' +
  'WHxO/1h8Tv9YfE7/UHFH/01uRv9GZED/SnVV/0qDX/9Kg1//SnVW/0pqRP9GYz//VHdL/1R3S/9PcEf/WHxO/1h8Tv9YfE7/WHxO/1BxR/9Nbkb/RmQ//0pq' +
  'Q/9KakP/W4FR/1uBUf9VeUz/SmpD/1N2S/9Tdkv/TnBG/1d8Tv9XfE7/V3tO/1l+UP9fh1X/X4dV/1R3S/9bgVH/W4FR/1uBUf9bgVH/VXlM/0pqQ/9Tdkv/' +
  'U3ZL/05wRv9XfE7/V3xO/1d7Tv9ZflD/X4dV/1+HVf9Ud0v/W4FR/1uBUf9bgVH/W4FR/1FzSf9Qc0n/WoBQ/1qAUP9agFD/WoBQ/1qAUP9agFD/UHNI/1h9' +
  'T/9YfU//UHFH/1uBUf9Mmnn/W4FR/1uBUf9Rc0n/UHNJ/1qAUP9agFD/WoBQ/1qAUP9agFD/WoBQ/1BzSP9YfU//WH1P/1BxR/9bgVH/TGxF/1uBUf9bgVH/' +
  'UnRJ/1J1Sv9SdEn/UnVK/1J1Sv9SdUr/UnVK/1J1Sv9HZkD/SmpD/0pqQ/9EYj//UYFg/06Uc/9bgVH/W4FR/1J0Sf9SdUr/UnRJ/1J1Sv9SdUr/UnVK/1J1' +
  'Sv9SdUr/R2ZA/0pqQ/9KakP/RGE+/1FzSf9Ob0f/UnVK/1N1Sv9QcUf/W4JS/1V5TP9cg1L/XINS/1yDUv9cg1L/XINS/1BySP9We03/VntN/01tRf9TdUr/' +
  'SYdm/1J1Sv9TdUr/UHFH/1uCUv9VeUz/XINS/1yDUv9cg1L/XINS/1yDUv9Qckj/VntN/1Z7Tf9NbUX/U3VK/0loQv9VeEz/VXhM/1BySP9cg1L/XINS/1yD' +
  'Uv9XfE7/W4JR/1uCUf9bglH/T3FH/1V5TP9VeUz/VHhL/1R3S/9Limf/VXhM/1V4TP9Qckj/XINS/1yDUv9cg1L/V3xO/1uCUf9bglH/W4JR/09xR/9VeUz/' +
  'VXlM/1R4S/9Ud0v/S2tE/1Z7Tf9We03/UXJI/1yDUv9cg1L/XINS/1R3S/9Td0v/U3dL/1N3S/9IaEH/Tm9H/05vR/9OcEj/S31h/0aUev9We03/VntN/1Fy' +
  'SP9cg1L/XINS/1yDUv9Ud0v/U3dL/1N3S/9Td0v/SGhB/05vR/9Ob0f/Tm9H/0trRP9GZUD/TnBG/05wRv9Pb0b/XINS/1yDUv9cg1L/XINS/1yDUv9cg1L/' +
  'XINS/09xR/9Rc0j/UXNI/1FySP9NbkX/RYNk/05wRv9OcEb/T29G/1yDUv9cg1L/XINS/1yDUv9cg1L/XINS/1yDUv9PcUf/UXNI/1FzSP9Rckj/TW1E/0Vj' +
  'P/9bgVH/W4FR/1J0Sf9cg1L/XINS/1yDUv9cg1L/XINS/1yDUv9agFD/VXhL/2ONWP9jjVj/YotX/1N2Sv9RkWz/W4FR/1uBUf9SdEn/XINS/1yDUv9cg1L/' +
  'XINS/1yDUv9cg1L/WoBQ/1V4S/9jjVj/Y41Y/2KLV/9Tdkr/UXNJ/1FzSf9LbET/RmRA/1J2Sv9Sdkr/UnZK/1J2Sv9SdUr/UnVK/1J1Sv9VeEv/WH5Q/1+H' +
  'Vf9ii1f/U3ZK/1KQaP9Rkmz/S39l/0ZmQ/9Sdkr/UnZK/1J2Sv9Sdkr/UnVK/1J1Sv9SdUr/VXhL/1h+UP9fh1X/YotX/1N2Sv9SdUr/W4FR/1uBUf9Qckj/' +
  'WoBQ/1qAUP9agFD/WoBQ/1qAUP9agFD/WoBQ/1R3S/9YflD/Y41Y/2KLV/9Tdkr/W4FR/1uBUf9bgVH/UHJI/1qAUP9agFD/WoBQ/1qAUP9agFD/WoBQ/1qA' +
  'UP9Ud0v/WH5Q/2ONWP9ii1f/U3ZK/1uBUf9bgVH/W4FR/1V5TP9Tdkr/U3ZK/1N2Sv9Rc0j/W4FR/1uBUf9bgVH/XYRT/1h+UP9jjVj/YotX/1N2Sv9bgVH/' +
  'W4FR/1uBUf9VeUz/U3ZK/1N2Sv9Tdkr/UXNI/1uBUf9bgVH/W4FR/12EU/9YflD/Y41Y/2KLV/9Tdkr/W4FR/1FzSf9Rc0n/UXNJ/1FzSf9Rc0n/UXNJ/05v' +
  'Rv9YflD/WH5Q/1h+UP9YflD/T3JJ/1uBUf9ii1f/U3ZK/1CWb/9Rk23/UYJh/1F0S/9Rc0n/UXNJ/1FzSf9Ob0b/WH5Q/1h+UP9YflD/WH5Q/09ySf9bgVH/' +
  'YotX/1N2Sv9QcUj/W4FR/1uBUf9bgVH/W4FR/1uBUf9bgVH/VHdL/16FVP9ehVT/XoVU/16FVP9Ud0z/XYNT/12EU/9TdUr/W4BR/1uBUf9bgVH/W4FR/1uB' +
  'Uf9bgVH/W4FR/1R3S/9ehVT/XoVU/16FVP9ehVT/VHdM/12DU/9dhFP/U3VK/1uAUf9bgVH/W4FR/1uBUf9Zfk//W4FR/1uBUf9Rc0n/WoBR/1qAUf9agFH/' +
  'WoBR/1FzSf9agFH/UXNI/1l+UP9bgVH/W4FR/1uBUf9bgVH/WX5P/1uBUf9bgVH/UXNJ/1qAUf9agFH/WoBR/1qAUf9Rc0n/WoBR/1FzSP9ZflD/W4FR/1uB' +
  'Uf9bgVH/W4FR/0xsRf9agFH/W4FR/1R4S/9fh1X/X4dV/1BySP9VeUz/SmpD/1+HVf9Ud0v/W4FR/1uBUf9bgVH/W4FR/1uBUf9MbEX/WoBR/1uBUf9UeEv/' +
  'X4dV/1+HVf9Qckj/VXlM/0pqQ/9fh1X/VHdL/1uBUf9bgVH/UXNJ/1FzSf9Rc0n/SmlD/1uBUf9bgVH/VHhL/1+HVf9fh1X/X4dV/1+HVf9SdEr/VXlN/0tr' +
  'Rf9Rflv/UYxl/1GMZf9Rf1z/UXRK/0ppQ/9bgVH/W4FR/1R4S/9fh1X/X4dV/1+HVf9fh1X/UnRK/1V5Tf9La0T/UXNJ/1FzSf9bgVH/W4FR/1V5TP9KakP/' +
  'U3ZL/1N2S/9OcEb/V3xO/1d8Tv9Xe07/WX5Q/1+HVf9fh1X/VHdL/1uBUf9bgVH/W4FR/1uBUf9VeUz/SmpD/1N2S/9Tdkv/TnBG/1d8Tv9XfE7/V3tO/1l+' +
  'UP9fh1X/X4dV/1R3S/9bgVH/W4FR/1uBUf9bgVH/UXNJ/1BzSf9agFD/WoBQ/1qAUP9agFD/WoBQ/1qAUP9Qc0j/WH1P/1h9T/9QcUf/W4FR/0yaev9bgVH/' +
  'W4FR/1FzSf9Qc0n/WoBQ/1qAUP9agFD/WoBQ/1qAUP9agFD/UHNI/1h9T/9YfU//UHFH/1uBUf9MbEX/W4FR/1uBUf9SdEn/UnVK/1J0Sf9SdUr/UnVK/1J1' +
  'Sv9SdUr/UnVK/0dmQP9KakP/SmpD/0RiP/9RgWD/TpRz/1uBUf9bgVH/UnRJ/1J1Sv9SdEn/UnVK/1J1Sv9SdUr/UnVK/1J1Sv9HZkD/SmpD/0pqQ/9EYT7/' +
  'UXNJ/05vR/9SdUr/U3VK/1BxR/9bglL/VXlM/1yDUv9cg1L/XINS/1yDUv9cg1L/UHJI/1Z7Tf9We03/TW1F/1N1Sv9Jh2b/UnVK/1N1Sv9QcUf/W4JS/1V5' +
  'TP9cg1L/XINS/1yDUv9cg1L/XINS/1BySP9We03/VntN/01tRf9TdUr/SWhC/1V4TP9VeEz/UHJI/1yDUv9cg1L/XINS/1d8Tv9bglH/W4JR/1uCUf9PcUf/' +
  'VXlM/1V5TP9UeEv/VHdL/0uKZ/9VeEz/VXhM/1BySP9cg1L/XINS/1yDUv9XfE7/W4JR/1uCUf9bglH/T3FH/1V5TP9VeUz/VHhL/1R3S/9La0T/VntN/1Z7' +
  'Tf9Rckj/XINS/1yDUv9cg1L/VHdL/1N3S/9Td0v/U3dL/0hoQf9Ob0f/Tm9H/05wSP9LfWH/RpR6/1Z7Tf9We03/UXJI/1yDUv9cg1L/XINS/1R3S/9Td0v/' +
  'U3dL/1N3S/9IaEH/Tm9H/05vR/9Ob0f/S2tE/0ZlQP9OcEb/TnBG/09vRv9cg1L/XINS/1yDUv9cg1L/XINS/1yDUv9cg1L/T3FH/1FzSP9Rc0j/UXJI/01u' +
  'Rf9Fg2T/TnBG/05wRv9Pb0b/XINS/1yDUv9cg1L/XINS/1yDUv9cg1L/XINS/09xR/9Rc0j/UXNI/1FySP9NbUT/RWM//1uBUf9bgVH/UnRJ/1yDUv9cg1L/' +
  'XINS/1yDUv9cg1L/XINS/1qAUP9VeEv/Y41Y/2ONWP9ii1f/U3ZK/1GRbP9bgVH/W4FR/1J0Sf9cg1L/XINS/1yDUv9cg1L/XINS/1yDUv9agFD/VXhL/2ON' +
  'WP9jjVj/YotX/1N2Sv9Rc0n/UXNJ/0tsRP9GZED/UnZK/1J2Sv9Sdkr/UnZK/1J1Sv9SdUr/UnVK/1V4S/9YflD/X4dV/2KLV/9Tdkr/UpBo/1GSbP9LfmT/' +
  'RmZD/1J2Sv9Sdkr/UnZK/1J2Sv9SdUr/UnVK/1J1Sv9VeEv/WH5Q/1+HVf9ii1f/U3ZK/1J1Sv9bgVH/W4FR/1BySP9agFD/WoBQ/1qAUP9agFD/WoBQ/1qA' +
  'UP9agFD/VHdL/1h+UP9jjVj/YotX/1N2Sv9bgVH/W4FR/1uBUf9Qckj/WoBQ/1qAUP9agFD/WoBQ/1qAUP9agFD/WoBQ/1R3S/9YflD/Y41Y/2KLV/9Tdkr/' +
  'W4FR/1uBUf9bgVH/VXlM/1N2Sv9Tdkr/U3ZK/1FzSP9bgVH/W4FR/1uBUf9dhFP/WH5Q/2ONWP9ii1f/U3ZK/1uBUf9bgVH/W4FR/1V5TP9Tdkr/U3ZK/1N2' +
  'Sv9Rc0j/W4FR/1uBUf9bgVH/XYRT/1h+UP9jjVj/YotX/1N2Sv9bgVH/PYyQ/0CGgP9BhH3/PoqN/0CHhP9AhH3/PoiJ/0GLif9Chn//QYuI/0GMjP9Ag33/' +
  'QomF/0CNj/8/gXz/QYWA/z2MkP9BhH3/QYR9/z2MkP9AhoD/QYR9/z2Jjf9Ciob/QoZ//0GMjP9Bi4n/QIN9/0GLiP9AjIv/P4F7/0CHhP8tYWP/M2Nd/zRj' +
  'Wv8uYWL/MmNe/zNiWv8wYmD/MWJf/zNiWv8xYl//MGJh/zNiWv8yYl3/L2Ji/zRjWv8zYlz/LWFj/zRjW/80Y1v/LWFj/zNjXf80Y1r/LmFi/zJjXv8zYlr/' +
  'MGJg/zFiX/8zYlr/MWJf/zBiYf8zYlr/MmJd/05vRf9Ob0X/Tm9F/05vRf9Ob0X/Tm9F/05vRf9Ob0X/Tm9F/05vRf9Ob0X/Tm9F/05vRf9Ob0X/Tm9F/05v' +
  'Rf9Ob0X/Tm9F/05vRf9Ob0X/Tm9F/05vRf9Ob0X/Tm9F/05vRf9Ob0X/Tm9F/05vRf9Ob0X/Tm9F/05vRf9Ob0X/mLaQ/5i2kP+YtpD/mLaQ/5i2kP+YtpD/' +
  'mLaQ/5i2kP+YtpD/mLaQ/5i2kP+YtpD/mLaQ/5i2kP+YtpD/mLaQ/5i2kP+YtpD/mLaQ/5i2kP+YtpD/mLaQ/5i2kP+YtpD/mLaQ/5i2kP+YtpD/mLaQ/5i2' +
  'kP+YtpD/mLaQ/5i2kP+du5X/nbuV/527lf+XtJH/p8ie/6fInv+iwZn/q8ui/6vLov+ry6L/q8ui/6LBmv+gvpj/mLWR/527lf+du5X/nbuV/527lf+du5X/' +
  'l7SR/6fInv+nyJ7/osGZ/6vLov+ry6L/q8ui/6vLov+iwZr/oL6Y/5i1kf+du5X/nbuV/6/QpP+v0KT/qcmf/527lf+nx53/p8ed/6HAmf+ryqH/q8qh/6rK' +
  'of+szaP/s9Sp/7PUqf+nx57/r9Ck/6/QpP+v0KT/r9Ck/6nJn/+du5X/p8ed/6fHnf+hwJn/q8qh/6vKof+qyqH/rM2j/7PUqf+z1Kn/p8ee/6/QpP+v0KT/' +
  'r9Ck/6/QpP+lxJv/o8Kb/67Po/+uz6P/rs+j/67Po/+uz6P/rs+j/6TDmv+ry6L/q8ui/6PCmv+v0KT/nryX/6/QpP+v0KT/pcSb/6PCm/+uz6P/rs+j/67P' +
  'o/+uz6P/rs+j/67Po/+kw5r/q8ui/6vLov+jwpr/r9Ck/568l/+v0KT/r9Ck/6XFnP+lxJ3/pcOc/6XEnP+lxJz/pcSc/6XEnP+lxJz/mreS/527lf+du5X/' +
  'lrOP/6TDm/+hv5n/r9Ck/6/QpP+lxZz/pcSd/6XDnP+lxJz/pcSc/6XEnP+lxJz/pcSc/5q3kv+du5X/nbuV/5azj/+kw5v/ob+Z/6bGnP+mxpz/o8Ka/6/Q' +
  'pP+ox57/sNGl/7DRpf+w0aX/sNGl/7DRpf+kw5r/qsyg/6rMoP+gv5f/psac/5y5lP+mxpz/psac/6PCmv+v0KT/qMee/7DRpf+w0aX/sNGl/7DRpf+w0aX/' +
  'pMOa/6rMoP+qzKD/oL+X/6bGnP+cuZT/qcqf/6nKn/+kw5r/sNGl/7DRpf+w0aX/q8qh/6/QpP+v0KT/r9Ck/6PCmf+pyp//qcqf/6jJnv+nyJ7/nryW/6nK' +
  'n/+pyp//pMOa/7DRpf+w0aX/sNGl/6vKof+v0KT/r9Ck/6/QpP+jwpn/qcqf/6nKn/+oyZ7/p8ie/568lv+qzKD/qsyg/6TDm/+w0aX/sNGl/7DRpf+nxp7/' +
  'p8ae/6fGnv+nxp7/m7iU/6HAmf+hwJn/ocCZ/568lv+ZtpL/qsyg/6rMoP+kw5v/sNGl/7DRpf+w0aX/p8ae/6fGnv+nxp7/p8ae/5u4lP+hwJn/ocCZ/6HA' +
  'mf+evJb/mbaS/6LBmP+hwZj/osCZ/7DRpf+w0aX/sNGl/7DRpf+w0aX/sNGl/7DRpf+iwZn/pMOb/6TDm/+kw5v/oL+X/5i1kP+iwZj/ocGY/6LAmf+w0aX/' +
  'sNGl/7DRpf+w0aX/sNGl/7DRpf+w0aX/osGZ/6TDm/+kw5v/pMOb/6C/l/+YtZD/r9Ck/6/QpP+lxJv/sNGl/7DRpf+w0aX/sNGl/7DRpf+w0aX/rs6j/6jI' +
  'nv+32Kz/t9is/7bXq/+nxp3/pMKb/6/QpP+v0KT/pcSb/7DRpf+w0aX/sNGl/7DRpf+w0aX/sNGl/67Oo/+oyJ7/t9is/7fYrP+216v/p8ad/6TCm/+kw5z/' +
  'nruW/5i1kf+mxJ3/psSd/6bEnf+mxJ3/pcSc/6XEnP+lxJz/qMie/6vLo/+z06n/tter/6fGnf+lxZ3/pMOc/567lv+YtZH/psSd/6bEnf+mxJ3/psSd/6XE' +
  'nP+lxJz/pcSc/6jInv+ry6P/s9Op/7bXq/+nxp3/pcWd/6/QpP+v0KT/pMOa/67Po/+uz6P/rs+j/67Po/+uz6P/rs+j/67Po/+nx53/rMuj/7fYrP+216v/' +
  'p8ad/6/QpP+v0KT/r9Ck/6TDmv+uz6P/rs+j/67Po/+uz6P/rs+j/67Po/+uz6P/p8ed/6zLo/+32Kz/tter/6fGnf+v0KT/r9Ck/6/QpP+pyZ//psad/6bG' +
  'nf+mxp3/pMOb/6/Ppf+vz6X/rs6k/7HRp/+sy6P/t9is/7bXq/+nxp3/r9Ck/6/QpP+v0KT/qcmf/6bGnf+mxp3/psad/6TDm/+vz6X/r8+l/67OpP+x0af/' +
  'rMuj/7fYrP+216v/p8ad/6/QpP+kw5v/pMOb/6TDm/+kw5v/pMOb/6TDm/+gvpj/rMuj/6zLo/+sy6P/rMuj/6PAm/+uzqX/tter/6fGnf+jwZr/pMOb/6TD' +
  'm/+kw5v/pMOb/6TDm/+kw5v/oL6Y/6zLo/+sy6P/rMuj/6zLo/+jwJv/rs6l/7bXq/+nxp3/o8Ga/6/QpP+v0KT/r9Ck/6/QpP+v0KT/r9Ck/6fGnf+y0qf/' +
  'stKn/7LSp/+y0qf/p8Wf/7DRpv+x0ab/psad/6/QpP+v0KT/r9Ck/6/QpP+v0KT/r9Ck/6/QpP+nxp3/stKn/7LSp/+y0qf/stKn/6fFn/+w0ab/sdGm/6bG' +
  'nf+v0KT/r9Ck/6/QpP+v0KT/rM2i/6/QpP+v0KT/pMSb/67OpP+uzqT/rs6k/67OpP+jwpz/rs6k/6TDmv+tzqL/r9Ck/6/QpP+v0KT/r9Ck/6zNov+v0KT/' +
  'r9Ck/6TEm/+uzqT/rs6k/67OpP+uzqT/o8Kc/67OpP+kw5r/rc6i/6/QpP+v0KT/r9Ck/6/QpP+fvZf/rtCk/6/QpP+nx57/s9Sp/7PUqf+iwJv/qMeg/5y4' +
  'lv+z1Kn/p8ee/6/QpP+v0KT/r9Ck/6/QpP+v0KT/n72X/67QpP+v0KT/p8ee/7PUqf+z1Kn/osCb/6jHoP+cuJb/s9Sp/6fHnv+v0KT/r9Ck/6TDm/+kw5v/' +
  'pMOb/5y5lf+v0KT/r9Ck/6fHnv+z1Kn/s9Sp/7PUqf+z1Kn/pcOd/6jHoP+du5b/pMOb/6TDm/+kw5v/pMOb/6TDm/+cuZX/r9Ck/6/QpP+nx57/s9Sp/7PU' +
  'qf+z1Kn/s9Sp/6XDnf+ox6D/nbuW/6TDm/+kw5v/r9Ck/6/QpP+pyZ//nbuV/6fHnf+nx53/ocCZ/6vKof+ryqH/qsqh/6zNo/+z1Kn/s9Sp/6fHnv+v0KT/' +
  'r9Ck/6/QpP+v0KT/qcmf/527lf+nx53/p8ed/6HAmf+ryqH/q8qh/6rKof+szaP/s9Sp/7PUqf+nx57/r9Ck/6/QpP+v0KT/r9Ck/6XEm/+jwpv/rs+j/67P' +
  'o/+uz6P/rs+j/67Po/+uz6P/pMOa/6vLov+ry6L/o8Ka/6/QpP+evJf/r9Ck/6/QpP+lxJv/o8Kb/67Po/+uz6P/rs+j/67Po/+uz6P/rs+j/6TDmv+ry6L/' +
  'q8ui/6PCmv+v0KT/nryX/6/QpP+v0KT/pcWc/6XEnf+lw5z/pcSc/6XEnP+lxJz/pcSc/6XEnP+at5L/nbuV/527lf+Ws4//pMOb/6G/mf+v0KT/r9Ck/6XF' +
  'nP+lxJ3/pcOc/6XEnP+lxJz/pcSc/6XEnP+lxJz/mreS/527lf+du5X/lrOP/6TDm/+hv5n/psac/6bGnP+jwpr/r9Ck/6jHnv+w0aX/sNGl/7DRpf+w0aX/' +
  'sNGl/6TDmv+qzKD/qsyg/6C/l/+mxpz/nLmU/6bGnP+mxpz/o8Ka/6/QpP+ox57/sNGl/7DRpf+w0aX/sNGl/7DRpf+kw5r/qsyg/6rMoP+gv5f/psac/5y5' +
  'lP+pyp//qcqf/6TDmv+w0aX/sNGl/7DRpf+ryqH/r9Ck/6/QpP+v0KT/o8KZ/6nKn/+pyp//qMme/6fInv+evJb/qcqf/6nKn/+kw5r/sNGl/7DRpf+w0aX/' +
  'q8qh/6/QpP+v0KT/r9Ck/6PCmf+pyp//qcqf/6jJnv+nyJ7/nryW/6rMoP+qzKD/pMOb/7DRpf+w0aX/sNGl/6fGnv+nxp7/p8ae/6fGnv+buJT/ocCZ/6HA' +
  'mf+hwJn/nryW/5m2kv+qzKD/qsyg/6TDm/+w0aX/sNGl/7DRpf+nxp7/p8ae/6fGnv+nxp7/m7iU/6HAmf+hwJn/ocCZ/568lv+ZtpL/osGY/6HBmP+iwJn/' +
  'sNGl/7DRpf+w0aX/sNGl/7DRpf+w0aX/sNGl/6LBmf+kw5v/pMOb/6TDm/+gv5f/mLWQ/6LBmP+hwZj/osCZ/7DRpf+w0aX/sNGl/7DRpf+w0aX/sNGl/7DR' +
  'pf+iwZn/pMOb/6TDm/+kw5v/oL+X/5i1kP+v0KT/r9Ck/6XEm/+w0aX/sNGl/7DRpf+w0aX/sNGl/7DRpf+uzqP/qMie/7fYrP+32Kz/tter/6fGnf+kwpv/' +
  'r9Ck/6/QpP+lxJv/sNGl/7DRpf+w0aX/sNGl/7DRpf+w0aX/rs6j/6jInv+32Kz/t9is/7bXq/+nxp3/pMKb/6TDnP+eu5b/mLWR/6bEnf+mxJ3/psSd/6bE' +
  'nf+lxJz/pcSc/6XEnP+oyJ7/q8uj/7PTqf+216v/p8ad/6XFnf+kw5z/nruW/5i1kf+mxJ3/psSd/6bEnf+mxJ3/pcSc/6XEnP+lxJz/qMie/6vLo/+z06n/' +
  'tter/6fGnf+lxZ3/r9Ck/6/QpP+kw5r/rs+j/67Po/+uz6P/rs+j/67Po/+uz6P/rs+j/6fHnf+sy6P/t9is/7bXq/+nxp3/r9Ck/6/QpP+v0KT/pMOa/67P' +
  'o/+uz6P/rs+j/67Po/+uz6P/rs+j/67Po/+nx53/rMuj/7fYrP+216v/p8ad/6/QpP+v0KT/r9Ck/6nJn/+mxp3/psad/6bGnf+kw5v/r8+l/6/Ppf+uzqT/' +
  'sdGn/6zLo/+32Kz/tter/6fGnf+v0KT/r9Ck/6/QpP+pyZ//psad/6bGnf+mxp3/pMOb/6/Ppf+vz6X/rs6k/7HRp/+sy6P/t9is/7bXq/+nxp3/r9Ck/47b' +
  'xf+S1rz/k9S6/4/Zw/+S1r7/ktS6/4/XwP+T2cL/lNa8/5LZwf+S28P/ktO6/5PYv/+R28X/kdK4/5LVu/+O28X/k9S6/5PUuv+O28X/kta8/5PUuv+O2ML/' +
  'lNjA/5TWvP+S2sP/k9nC/5LTuv+S2cH/ktrD/5HSuP+R1r3/fbKw/4S1q/+FtKr/frOw/4O0rf+EtKn/gLOu/4K0rf+Es6n/gbSt/4Czr/+EtKn/grSs/3+z' +
  'sP+FtKr/g7Sr/32ysP+Ftar/hbWq/32ysP+Etav/hbSq/36zsP+DtK3/hLSp/4Czrv+CtK3/hLOp/4G0rf+As6//hLSp/4K0rP+hwZj/ocGY/6HBmP+hwZj/' +
  'ocGY/6HBmP+hwZj/ocGY/6HBmP+hwZj/ocGY/6HBmP+hwZj/ocGY/6HBmP+hwZj/ocGY/6HBmP+hwZj/ocGY/6HBmP+hwZj/ocGY/6HBmP+hwZj/ocGY/6HB' +
  'mP+hwZj/ocGY/6HBmP+hwZj/ocGY/3gcFv94HBb/eBwW/3gcFv94HBb/eBwW/3gcFv94HBb/eBwW/3gcFv94HBb/eBwW/3gcFv94HBb/eBwW/3gcFv94HBb/' +
  'eBwW/3gcFv94HBb/eBwW/3gcFv94HBb/eBwW/3gcFv94HBb/eBwW/3gcFv94HBb/eBwW/3gcFv94HBb/gR0X/4EdF/+BHRf/eRwW/5EhGv+RIRr/iR8a/5ci' +
  'HP+XIhz/lyIc/5ciHP+KIBn/hh8Z/3ocGP+BKCr/gTg2/4E4Nv+BKSv/gR4Z/3kcFv+RIRr/kSEa/4kfGv+XIhz/lyIc/5ciHP+XIhz/iiAZ/4YfGf96HBf/' +
  'gR0X/4EdF/+dIxz/nSMc/5MhG/+BHhj/kCAa/5AgGv+IHxn/lyIc/5ciHP+WIhv/miMc/6UlHv+lJR7/kSEa/50jHP+dIxz/nSMc/50jHP+TIRv/gR4Y/5Ag' +
  'Gv+QIBr/iB8Z/5ciHP+XIhz/liIb/5ojHP+lJR7/pSUe/5EhGv+dIxz/nSMc/50jHP+dIxz/jCAZ/4wgGv+cIx3/nCMd/5wjHf+cIx3/nCMd/5wjHf+LIBr/' +
  'mCIc/5giHP+KIBn/nSMc/4RNUv+dIxz/nSMc/4wgGf+MIBr/nCMd/5wjHf+cIx3/nCMd/5wjHf+cIx3/iyAa/5giHP+YIhz/iiAZ/50jHP+EHhj/nSMc/50j' +
  'HP+OIBr/jyEa/40gGv+OIBr/jiAa/44gGv+OIBr/jiAa/3wcF/+BHhf/gR4X/3YcF/+MLTH/h0RI/50jHP+dIxz/jiAa/48hGv+NIBr/jiAa/44gGv+OIBr/' +
  'jiAa/44gGv98HBf/gR4X/4EeF/92Gxb/jB8Z/4ceGf+PIBr/jyAa/4ofGf+eJB3/kyEb/58kHf+fJB3/nyQd/58kHf+fJB3/ix8Z/5YiG/+WIhv/hh8Z/48g' +
  'Gv9/PD3/jyAa/48gGv+KHxn/niQd/5MhG/+fJB3/nyQd/58kHf+fJB3/nyQd/4sfGf+WIhv/liIb/4YfGf+PIBr/fx0X/5MiG/+TIhv/ix8a/58kHf+fJB3/' +
  'nyQd/5ciHP+dJB3/nSQd/50kHf+JHxn/lCIb/5QiG/+SIhv/kSEa/4I9P/+TIhv/kyIb/4sfGv+fJB3/nyQd/58kHf+XIhz/nSQd/50kHf+dJB3/iR8Z/5Qi' +
  'G/+UIhv/kiIb/5EhGv+CHhj/liIb/5YiG/+LHxr/nyQd/58kHf+fJB3/kSEb/5EhG/+RIRv/kSEb/34dF/+IHxn/iB8Z/4ggGv+CMDb/e0tW/5YiG/+WIhv/' +
  'ix8a/58kHf+fJB3/nyQd/5EhG/+RIRv/kSEb/5EhG/9+HRf/iB8Z/4gfGf+IHxn/gh4Y/3sdF/+IHxn/iB8Z/4gfGf+fJB3/nyQd/58kHf+fJB3/nyQd/58k' +
  'Hf+fJB3/iR8Z/4wgGv+MIBn/iyAZ/4UfGv95Oz7/iB8Z/4gfGf+IHxn/nyQd/58kHf+fJB3/nyQd/58kHf+fJB3/nyQd/4kfGf+MIBr/jCAZ/4sgGf+FHhj/' +
  'eRsW/50jHP+dIxz/jSAa/58kHf+fJB3/nyQd/58kHf+fJB3/nyQd/5wjHP+SIRr/rCcf/6wnH/+qJx//kCEa/4w+QP+dIxz/nSMc/40gGv+fJB3/nyQd/58k' +
  'Hf+fJB3/nyQd/58kHf+cIxz/kiEa/6wnH/+sJx//qicf/5AhGv+MHxn/jCAZ/4MeGP97HBf/jyEa/48hGv+PIRr/jyEa/48hGv+OIRr/jyEa/5IhGv+aIxz/' +
  'pCYe/6onH/+QIRr/jz46/4xBQP+DMTn/ex4Z/48hGv+PIRr/jyEa/48hGv+PIRr/jiEa/48hGv+SIRr/miMc/6QmHv+qJx//kCEa/48gGv+dIxz/nSMc/4sg' +
  'Gv+bIxz/myMc/5sjHP+bIxz/myMc/5sjHP+bIxz/kSEa/5ojHP+sJx//qicf/5AhGv+dIxz/nSMc/50jHP+LIBr/myMc/5sjHP+bIxz/myMc/5sjHP+bIxz/' +
  'myMc/5EhGv+aIxz/rCcf/6onH/+QIRr/nSMc/50jHP+dIxz/kyEb/5AhGv+PIBr/jyAa/40gGv+eJB3/niQd/50kHf+hJR3/miMc/6wnH/+qJx//kCEa/50j' +
  'HP+dIxz/nSMc/5MhG/+QIRr/jyAa/48gGv+NIBr/niQd/54kHf+dJB3/oSUd/5ojHP+sJx//qicf/5AhGv+dIxz/jCAZ/4wgGf+MIBn/jCAZ/4wgGf+MIBn/' +
  'hx8Y/5ojHP+aIxz/miMc/5ojHP+MIBr/nSQd/6onH/+QIRr/iklF/4xDQf+MLjL/jCEb/4wgGf+MIBn/jCAZ/4cfGP+aIxz/miMc/5ojHP+aIxz/jCAa/50k' +
  'Hf+qJx//kCEa/4ogGf+dIxz/nSMc/50jHP+dIxz/nSMc/50jHP+RIRv/oyUe/6MlHv+jJR7/oyUe/5IhG/+gJR3/oSUe/48hGv+cIxz/nSMc/50jHP+dIxz/' +
  'nSMc/50jHP+dIxz/kSEb/6MlHv+jJR7/oyUe/6MlHv+SIRv/oCUd/6ElHv+PIRr/nCMc/50jHP+dIxz/nSMc/5kjHP+dIxz/nSMc/40gGv+cIx3/nCMd/5wj' +
  'Hf+cIx3/jCAa/5wjHf+MIBn/miMc/50jHP+dIxz/nSMc/50jHP+ZIxz/nSMc/50jHP+NIBr/nCMd/5wjHf+cIx3/nCMd/4wgGv+cIx3/jCAZ/5ojHP+dIxz/' +
  'nSMc/50jHP+dIxz/hB4Y/5wjHP+dIxz/kiEb/6UlHv+lJR7/ix8Z/5QiG/+BHRj/pSUe/5EhGv+dIxz/nSMc/50jHP+dIxz/nSMc/4QeGP+cIxz/nSMc/5Ih' +
  'G/+lJR7/pSUe/4sfGf+UIhv/gR0Y/6UlHv+RIRr/nSMc/50jHP+MIBn/jCAZ/4wgGf+AHRf/nSMc/50jHP+SIRv/pSUe/6UlHv+lJR7/pSUe/44gGv+UIhv/' +
  'gh4Z/4wrLP+MOjj/jDo4/4wrLf+MIBv/gB0X/50jHP+dIxz/kiEb/6UlHv+lJR7/pSUe/6UlHv+OIBr/lCIb/4IeGP+MIBn/jCAZ/50jHP+dIxz/kyEb/4Ee' +
  'GP+QIBr/kCAa/4gfGf+XIhz/lyIc/5YiG/+aIxz/pSUe/6UlHv+RIRr/nSMc/50jHP+dIxz/nSMc/5MhG/+BHhj/kCAa/5AgGv+IHxn/lyIc/5ciHP+WIhv/' +
  'miMc/6UlHv+lJR7/kSEa/50jHP+dIxz/nSMc/50jHP+MIBn/jCAa/5wjHf+cIx3/nCMd/5wjHf+cIx3/nCMd/4sgGv+YIhz/mCIc/4ogGf+dIxz/hE1T/50j' +
  'HP+dIxz/jCAZ/4wgGv+cIx3/nCMd/5wjHf+cIx3/nCMd/5wjHf+LIBr/mCIc/5giHP+KIBn/nSMc/4QeGP+dIxz/nSMc/44gGv+PIRr/jSAa/44gGv+OIBr/' +
  'jiAa/44gGv+OIBr/fBwX/4EeF/+BHhf/dhwX/4wtMf+HREn/nSMc/50jHP+OIBr/jyEa/40gGv+OIBr/jiAa/44gGv+OIBr/jiAa/3wcF/+BHhf/gR4X/3Yb' +
  'Fv+MHxn/hx4Z/48gGv+PIBr/ih8Z/54kHf+TIRv/nyQd/58kHf+fJB3/nyQd/58kHf+LHxn/liIb/5YiG/+GHxn/jyAa/388Pf+PIBr/jyAa/4ofGf+eJB3/' +
  'kyEb/58kHf+fJB3/nyQd/58kHf+fJB3/ix8Z/5YiG/+WIhv/hh8Z/48gGv9/HRf/kyIb/5MiG/+LHxr/nyQd/58kHf+fJB3/lyIc/50kHf+dJB3/nSQd/4kf' +
  'Gf+UIhv/lCIb/5IiG/+RIRr/gj0//5MiG/+TIhv/ix8a/58kHf+fJB3/nyQd/5ciHP+dJB3/nSQd/50kHf+JHxn/lCIb/5QiG/+SIhv/kSEa/4IeGP+WIhv/' +
  'liIb/4sfGv+fJB3/nyQd/58kHf+RIRv/kSEb/5EhG/+RIRv/fh0X/4gfGf+IHxn/iCAa/4IwNv97S1b/liIb/5YiG/+LHxr/nyQd/58kHf+fJB3/kSEb/5Eh' +
  'G/+RIRv/kSEb/34dF/+IHxn/iB8Z/4gfGf+CHhj/ex0X/4gfGf+IHxn/iB8Z/58kHf+fJB3/nyQd/58kHf+fJB3/nyQd/58kHf+JHxn/jCAa/4wgGf+LIBn/' +
  'hR8a/3k7Pv+IHxn/iB8Z/4gfGf+fJB3/nyQd/58kHf+fJB3/nyQd/58kHf+fJB3/iR8Z/4wgGv+MIBn/iyAZ/4UeGP95Gxb/nSMc/50jHP+NIBr/nyQd/58k' +
  'Hf+fJB3/nyQd/58kHf+fJB3/nCMc/5IhGv+sJx//rCcf/6onH/+QIRr/jD5A/50jHP+dIxz/jSAa/58kHf+fJB3/nyQd/58kHf+fJB3/nyQd/5wjHP+SIRr/' +
  'rCcf/6wnH/+qJx//kCEa/4wfGf+MIBn/gx4Y/3scF/+PIRr/jyEa/48hGv+PIRr/jyEa/44hGv+PIRr/kiEa/5ojHP+kJh7/qicf/5AhGv+PPjr/jEFA/4Mx' +
  'Of97Hhn/jyEa/48hGv+PIRr/jyEa/48hGv+OIRr/jyEa/5IhGv+aIxz/pCYe/6onH/+QIRr/jyAa/50jHP+dIxz/iyAa/5sjHP+bIxz/myMc/5sjHP+bIxz/' +
  'myMc/5sjHP+RIRr/miMc/6wnH/+qJx//kCEa/50jHP+dIxz/nSMc/4sgGv+bIxz/myMc/5sjHP+bIxz/myMc/5sjHP+bIxz/kSEa/5ojHP+sJx//qicf/5Ah' +
  'Gv+dIxz/nSMc/50jHP+TIRv/kCEa/48gGv+PIBr/jSAa/54kHf+eJB3/nSQd/6ElHf+aIxz/rCcf/6onH/+QIRr/nSMc/50jHP+dIxz/kyEb/5AhGv+PIBr/' +
  'jyAa/40gGv+eJB3/niQd/50kHf+hJR3/miMc/6wnH/+qJx//kCEa/50jHP9pTnD/b0Ve/3BCWv9qTWz/bkZi/3BCWv9qSmn/cElm/3JDW/9wSWb/b0tq/29C' +
  'Wv9xR2L/bU1t/21CWv9vRV7/aU5w/3BCWv9wQlr/aU5w/29FXv9wQlr/aUxs/3FHYv9zQ1v/b0tq/3BJZv9vQlr/cElm/25Laf9tQlr/bkZi/0w0Sf9XMD//' +
  'WS49/04zSP9VMUH/WC49/1EzRf9TMkP/WC49/1MyQ/9RM0b/WC49/1UxQf9PM0j/WS49/1cwP/9MNEn/WS89/1kvPf9MNEn/VzA//1kuPf9OM0j/VTFB/1gu' +
  'Pf9RM0X/UzJD/1guPf9TMkP/UTNG/1guPf9VMUH/iB8Z/4gfGf+IHxn/iB8Z/4gfGf+IHxn/iB8Z/4gfGf+IHxn/iB8Z/4gfGf+IHxn/iB8Z/4gfGf+IHxn/' +
  'iB8Z/4gfGf+IHxn/iB8Z/4gfGf+IHxn/iB8Z/4gfGf+IHxn/iB8Z/4gfGf+IHxn/iB8Z/4gfGf+IHxn/iB8Z/4gfGf/Db1//w29f/8NvX//Db1//w29f/8Nv' +
  'X//Db1//w29f/8NvX//Db1//w29f/8NvX//Db1//w29f/8NvX//Db1//w29f/8NvX//Db1//w29f/8NvX//Db1//w29f/8NvX//Db1//w29f/8NvX//Db1//' +
  'w29f/8NvX//Db1//w29f/8h1Y//IdWP/yHVj/8BwYP/ZfWn/2X1p/9B4Zv/df2r/3X9q/91/av/df2r/z3lm/8x3ZP/BcGD/yHVj/8h1Y//IdWP/yHVj/8h1' +
  'Y//AcGD/2X1p/9l9af/QeGb/3X9q/91/av/df2r/3X9q/895Zv/Md2T/wXBg/8h1Y//IdWP/4oNt/+KDbf/Zfmr/x3Vj/9d9aP/XfWj/z3hl/9x/av/cf2r/' +
  '2n9q/96Ba//ohm//6IZv/9h9aP/ig23/4oNt/+KDbf/ig23/2X5q/8d1Y//XfWj/131o/894Zf/cf2r/3H9q/9p/av/egWv/6IZv/+iGb//YfWj/4oNt/+KD' +
  'bf/ig23/4oNt/9R6Z//Remb/4oFs/+KBbP/igWz/4oFs/+KBbP/igWz/0npn/92Aa//dgGv/0Xlm/+KDbf/Jd2T/4oNt/+KDbf/Uemf/0Xpm/+KBbP/igWz/' +
  '4oFs/+KBbP/igWz/4oFs/9J6Z//dgGv/3YBr/9F5Zv/ig23/yXdk/+KDbf/ig23/1Xtn/9R7Z//Te2f/1Htn/9R7Z//Ue2f/1Htn/9R7Z//CcWH/yXRj/8l0' +
  'Y/++b1//0Xtn/814Zv/ig23/4oNt/9V7Z//Ue2f/03tn/9R7Z//Ue2f/1Htn/9R7Z//Ue2f/wnFh/8l0Y//JdGP/vm9f/9F7Z//NeGb/1Xxo/9V8aP/ReWb/' +
  '44Nt/9h9af/lg23/5YNt/+WDbf/lg23/5YNt/9J5Zv/df2r/3X9q/853Zf/WfGj/xXRi/9V8aP/VfGj/0Xlm/+ODbf/YfWn/5YNt/+WDbf/lg23/5YNt/+WD' +
  'bf/SeWb/3X9q/91/av/Od2X/1nxo/8V0Yv/bfWn/231p/9J5Zv/lg23/5YNt/+WDbf/df2r/44Jt/+OCbf/jgm3/0Xlm/9x+av/cfmr/2n1p/9l8af/KdWP/' +
  '231p/9t9af/SeWb/5YNt/+WDbf/lg23/3X9q/+OCbf/jgm3/44Jt/9F5Zv/cfmr/3H5q/9p9af/ZfGn/ynVj/91/av/df2r/03lm/+WDbf/lg23/5YNt/9d9' +
  'aP/WfGj/1nxo/9Z8aP/Fc2L/z3hl/894Zf/PeGX/yXVk/8JyYf/df2r/3X9q/9N5Zv/lg23/5YNt/+WDbf/XfWj/1nxo/9Z8aP/WfGj/xXNi/894Zf/PeGX/' +
  'z3hl/8l1ZP/CcmH/0Xhl/9B4Zf/PeGX/5YNt/+WDbf/lg23/5YNt/+WDbf/lg23/5YNt/9F5Zv/Temb/03pm/9N5Zv/Nd2T/wHBg/9F4Zf/QeGX/z3hl/+WD' +
  'bf/lg23/5YNt/+WDbf/lg23/5YNt/+WDbf/ReWb/03pm/9N6Zv/TeWb/zXdk/8BwYP/ig23/4oNt/9R7Z//lg23/5YNt/+WDbf/lg23/5YNt/+WDbf/igmz/' +
  '2H1p/+yJcf/siXH/64hx/9Z8aP/Remf/4oNt/+KDbf/Ue2f/5YNt/+WDbf/lg23/5YNt/+WDbf/lg23/4oJs/9h9af/siXH/7Ilx/+uIcf/WfGj/0Xpn/9J7' +
  'Z//IdmT/wHFh/9R7Z//Ue2f/1Htn/9R7Z//Ue2f/1Htn/9R7Z//YfWn/24Br/+WGb//riHH/1nxo/9R8aP/Se2f/yHZk/8BxYf/Ue2f/1Htn/9R7Z//Ue2f/' +
  '1Htn/9R7Z//Ue2f/2H1p/9uAa//lhm//64hx/9Z8aP/UfGj/4oNt/+KDbf/TeWf/4oFs/+KBbP/igWz/4oFs/+KBbP/igWz/4oFs/9d9af/bgWv/7Ilx/+uI' +
  'cf/WfGj/4oNt/+KDbf/ig23/03ln/+KBbP/igWz/4oFs/+KBbP/igWz/4oFs/+KBbP/XfWn/24Fr/+yJcf/riHH/1nxo/+KDbf/ig23/4oNt/9p+av/WfGj/' +
  '1nxo/9Z8aP/Semf/4YNt/+GDbf/fgmz/44Ru/9uBa//siXH/64hx/9Z8aP/ig23/4oNt/+KDbf/afmr/1nxo/9Z8aP/WfGj/0npn/+GDbf/hg23/34Js/+OE' +
  'bv/bgWv/7Ilx/+uIcf/WfGj/4oNt/9F7Z//Se2f/0ntn/9J7Z//Se2f/0ntn/8t3Zf/bgWv/24Br/9uBa//bgWv/zXpm/96Cbf/riHH/1nxo/9B6Z//Re2f/' +
  '0ntn/9J7Z//Se2f/0ntn/9J7Z//Ld2X/24Fr/9uAa//bgWv/24Fr/816Zv/egm3/64hx/9Z8aP/Qemf/4oNt/+KDbf/ig23/4oNt/+KDbf/ig23/1n1o/+WF' +
  'bv/lhW7/5YVu/+WFbv/UfWn/4oRu/+SEbv/WfGj/4oNt/+KDbf/ig23/4oNt/+KDbf/ig23/4oNt/9Z9aP/lhW7/5YVu/+WFbv/lhW7/1H1p/+KEbv/khG7/' +
  '1nxo/+KDbf/ig23/4oNt/+KDbf/fgWz/4oNt/+KDbf/Te2f/4IJs/+CCbP/ggmz/4IJs/9B6Z//ggmz/0npm/+CCbP/ig23/4oNt/+KDbf/ig23/34Fs/+KD' +
  'bf/ig23/03tn/+CCbP/ggmz/4IJs/+CCbP/Qemf/4IJs/9J6Zv/ggmz/4oNt/+KDbf/ig23/4oNt/8l3ZP/ig23/4oNt/9h9af/ohm//6IZv/855Zv/Xfmn/' +
  'xXRj/+iGb//YfWj/4oNt/+KDbf/ig23/4oNt/+KDbf/Jd2T/4oNt/+KDbf/YfWn/6IZv/+iGb//OeWb/135p/8V0Y//ohm//2H1o/+KDbf/ig23/0ntn/9J7' +
  'Z//Se2f/xnRj/+KDbf/ig23/2H1p/+iGb//ohm//6IZv/+iGb//Re2f/135p/8h1Y//Se2f/0ntn/9J7Z//Se2f/0ntn/8Z0Y//ig23/4oNt/9h9af/ohm//' +
  '6IZv/+iGb//ohm//0Xtn/9d+af/IdWP/0ntn/9J7Z//ig23/4oNt/9l+av/HdWP/131o/9d9aP/PeGX/3H9q/9x/av/af2r/3oFr/+iGb//ohm//2H1o/+KD' +
  'bf/ig23/4oNt/+KDbf/Zfmr/x3Vj/9d9aP/XfWj/z3hl/9x/av/cf2r/2n9q/96Ba//ohm//6IZv/9h9aP/ig23/4oNt/+KDbf/ig23/1Hpn/9F6Zv/igWz/' +
  '4oFs/+KBbP/igWz/4oFs/+KBbP/Semf/3YBr/92Aa//ReWb/4oNt/8l3ZP/ig23/4oNt/9R6Z//Remb/4oFs/+KBbP/igWz/4oFs/+KBbP/igWz/0npn/92A' +
  'a//dgGv/0Xlm/+KDbf/Jd2T/4oNt/+KDbf/Ve2f/1Htn/9N7Z//Ue2f/1Htn/9R7Z//Ue2f/1Htn/8JxYf/JdGP/yXRj/75vX//Re2f/zXhm/+KDbf/ig23/' +
  '1Xtn/9R7Z//Te2f/1Htn/9R7Z//Ue2f/1Htn/9R7Z//CcWH/yXRj/8l0Y/++b1//0Xtn/814Zv/VfGj/1Xxo/9F5Zv/jg23/2H1p/+WDbf/lg23/5YNt/+WD' +
  'bf/lg23/0nlm/91/av/df2r/zndl/9Z8aP/FdGL/1Xxo/9V8aP/ReWb/44Nt/9h9af/lg23/5YNt/+WDbf/lg23/5YNt/9J5Zv/df2r/3X9q/853Zf/WfGj/' +
  'xXRi/9t9af/bfWn/0nlm/+WDbf/lg23/5YNt/91/av/jgm3/44Jt/+OCbf/ReWb/3H5q/9x+av/afWn/2Xxp/8p1Y//bfWn/231p/9J5Zv/lg23/5YNt/+WD' +
  'bf/df2r/44Jt/+OCbf/jgm3/0Xlm/9x+av/cfmr/2n1p/9l8af/KdWP/3X9q/91/av/TeWb/5YNt/+WDbf/lg23/131o/9Z8aP/WfGj/1nxo/8VzYv/PeGX/' +
  'z3hl/894Zf/JdWT/wnJh/91/av/df2r/03lm/+WDbf/lg23/5YNt/9d9aP/WfGj/1nxo/9Z8aP/Fc2L/z3hl/894Zf/PeGX/yXVk/8JyYf/ReGX/0Hhl/894' +
  'Zf/lg23/5YNt/+WDbf/lg23/5YNt/+WDbf/lg23/0Xlm/9N6Zv/Temb/03lm/813ZP/AcGD/0Xhl/9B4Zf/PeGX/5YNt/+WDbf/lg23/5YNt/+WDbf/lg23/' +
  '5YNt/9F5Zv/Temb/03pm/9N5Zv/Nd2T/wHBg/+KDbf/ig23/1Htn/+WDbf/lg23/5YNt/+WDbf/lg23/5YNt/+KCbP/YfWn/7Ilx/+yJcf/riHH/1nxo/9F6' +
  'Z//ig23/4oNt/9R7Z//lg23/5YNt/+WDbf/lg23/5YNt/+WDbf/igmz/2H1p/+yJcf/siXH/64hx/9Z8aP/Remf/0ntn/8h2ZP/AcWH/1Htn/9R7Z//Ue2f/' +
  '1Htn/9R7Z//Ue2f/1Htn/9h9af/bgGv/5YZv/+uIcf/WfGj/1Hxo/9J7Z//IdmT/wHFh/9R7Z//Ue2f/1Htn/9R7Z//Ue2f/1Htn/9R7Z//YfWn/24Br/+WG' +
  'b//riHH/1nxo/9R8aP/ig23/4oNt/9N5Z//igWz/4oFs/+KBbP/igWz/4oFs/+KBbP/igWz/131p/9uBa//siXH/64hx/9Z8aP/ig23/4oNt/+KDbf/TeWf/' +
  '4oFs/+KBbP/igWz/4oFs/+KBbP/igWz/4oFs/9d9af/bgWv/7Ilx/+uIcf/WfGj/4oNt/+KDbf/ig23/2n5q/9Z8aP/WfGj/1nxo/9J6Z//hg23/4YNt/9+C' +
  'bP/jhG7/24Fr/+yJcf/riHH/1nxo/+KDbf/ig23/4oNt/9p+av/WfGj/1nxo/9Z8aP/Semf/4YNt/+GDbf/fgmz/44Ru/9uBa//siXH/64hx/9Z8aP/ig23/' +
  'rp6n/7WWmf+2lJb/sJ2k/7WYnP+2lJb/sJqh/7Wbn/+4lZf/tZuf/7Odov+1k5b/tpmd/7Kepf+0k5X/tZaZ/66ep/+2lJb/tpSW/66ep/+1lpn/tpSW/66c' +
  'pP+3mZ3/uJWX/7Ocov+1m5//tJOW/7Wbn/+znKL/s5KV/7SYnP+QfIv/nHqD/556gf+TfIn/m3uF/515gP+WfIj/mHyG/5x5gP+Ye4b/lnyI/515gP+ae4X/' +
  'k3yJ/556gf+ceoP/kHyL/556gf+eeoH/kHyL/5x6g/+eeoH/k3yJ/5t7hf+deYD/lnyI/5h8hv+ceYD/mHuG/5Z8iP+deYD/mnuF/9B4Zf/QeGX/0Hhl/9B4' +
  'Zf/QeGX/0Hhl/9B4Zf/QeGX/0Hhl/9B4Zf/QeGX/0Hhl/9B4Zf/QeGX/0Hhl/9B4Zf/QeGX/0Hhl/9B4Zf/QeGX/0Hhl/9B4Zf/QeGX/0Hhl/9B4Zf/QeGX/' +
  '0Hhl/9B4Zf/QeGX/0Hhl/9B4Zf/QeGX/kGsI/510CP+ddAj/nXQI/5lyCP+AXwf/k20H/4FfB/+ofQn/rIEJ/5BrCP+4iAn/uIgJ/7iICf+4iAn/p3wJ/5tz' +
  'Cf+sgAn/hWIH/4JgB/+CYAf/iGUH/7iICf+4iAn/uIgJ/7iICf+Pagj/j2oH/49qB/+ZcQn/x5QK/6yACf+ddAj/roEI/66BCP+ugQj/qX0I/4lmB/+jeQj/' +
  'imcH/7uLCv/BkAr/m3MI/8+ZCv/PmQr/z5kK/8+ZCv+4iAn/q4AJ/8CPCv+MaAf/jmkH/45pB/+SbAf/z5kK/8+ZCv/PmQr/z5kK/5pyCP+edQj/nnUI/6Z7' +
  'Cf/hpwv/v44K/4BfB/+IZQf/iWYH/5JtB/+Qawf/gmAH/41oB/9+Xgf/u4sK/8GQCv+TbQj/pHkI/6R5CP+acgj/nXQI/5RtCP+OaQj/lnAI/31dB/+OaQf/' +
  'jmkH/39eB/+bcwj/mXEI/6B3CP+ieAj/i2cH/4tmB/+LZgf/pnwJ/+GnC/+/jgr/jmkH/5x0B/+SbAf/16AK/9egCv/XoAr/16AK/62ACP+7iwr/wZAK/6B3' +
  'CP/hpwv/4acL/5pyB/+8iwn/vIsJ/7yLCf+8iwn/imcH/45pB/+OaQf/hGIG/66BCP+acgj/w5EJ/9egCv/XoAr/16AK/9afCv+tgAn/4acL/7+OCv+OaQf/' +
  'nHQH/5JsB//XoAr/16AK/9egCv/XoAr/rYAI/7uLCv/BkAr/oHcI/+GnC//hpwv/mnIH/7yLCf+8iwn/vIsJ/7yLCf+KZwf/jmkH/45pB/+FYgf/roEI/5pz' +
  'CP/DkQn/16AK/9egCv/XoAr/1p8K/62ACf/hpwv/v44K/45pB/+cdAf/h2QH/6F3CP+fdgj/fV0G/4NhBv9+XQb/fl4G/39eBv+JZgf/4acL/+GnC/+Qawf/' +
  'oXgI/5dwCP+MaAf/lG4H/49qB/+NaAf/jGgH/4ZjB/+ugQj/m3MI/5pyCP+kegj/i2cH/4NhBv+DYQb/fl0G/4RiB/97Wwf/jmkH/5x0B/+Rawf/zJcK/8aS' +
  'Cv98XAb/jmkH/45pB/+OaQf/jmkH/4xoB//hpwv/4acL/6h9CP/XoAr/v44J/6h8CP+8iwn/vIsJ/7yLCf+8iwn/jmkH/66BCP+bcwj/v40K/9OcC/+acgj/' +
  'jmkH/45pB/+OaQf/jmkH/39eBv+DYQf/jmkH/41pB//Mlwr/xpIK/3VXBv+CYAf/gmAH/4JgB/+CYAf/hGIH/8eUCv/HlAr/pnsI/9egCv+/jgn/mXEI/6h8' +
  'CP+ofAj/qHwI/6h8CP+GYwf/nXQI/49qCP+/jQr/05wL/5pyCP+CYAf/gmAH/4JgB/+CYAf/d1kG/7OFCf/HlAr/ongI/8yXCv/Gkgr/jGgI/6N5CP+MaAj/' +
  't4cK/7uLCv+7iwr/u4sK/7uLCv+kegj/16AK/7+OCf+ddQn/rIEJ/4xoCP+jeQj/o3kI/6N5CP+jeQj/k20I/7+NCv/TnAv/pHoJ/8eUCv/Gkwr/oHYJ/8eU' +
  'Cv+sgAn/x5QK/+GnC/+rfwj/zJcK/8aSCv+XcAj/tocJ/5dwCP/Mlwv/05wL/9OcC//TnAv/05wL/6Z7CP/XoAr/v44J/6yBCf/BkAr/lW8I/7aHCf+2hwn/' +
  'tocJ/7aHCf+hdwj/v40K/9OcC/+mewn/4acL/+CmC/+ugQn/4acL/7+OCv+Ubgj/oXcI/4pmB/+XcAj/lG4I/5dwCP+2hwn/l3AI/6B3CP+ieAj/m3MI/5tz' +
  'CP+bcwj/iGUH/510CP+SbAj/rIEJ/8GQCv+SbQj/mHAI/5hwCP+Qawf/lG4H/4xnB/+acgj/ongI/5BrCP/hpwv/4KYL/5FsCP+nfAj/lW8I/49qB/+edQj/' +
  'nnUI/551CP+ZcQj/lm8I/7aHCf+XcAj/xpMK/8yYCv+Ubgj/o3kI/6N5CP+jeQj/o3kI/5NtB/+sgQn/wZAK/551CP/hpwv/4acL/6R6CP/MmAr/zJgK/8yY' +
  'Cv/MmAr/onkI/+GnC//gpgv/nHQI/8GQCv+mfAn/j2oH/551CP+edQj/nnUI/5lxCP+Wbwj/tocJ/5dwCP/Gkwr/zJgK/5RuB/+jeQj/o3kI/6N5CP+jeQj/' +
  'k20H/6yBCf/BkAr/nnUI/+GnC//hpwv/pHoI/8yYCv/MmAr/zJgK/8yYCv+ieQj/4acL/+CmC/+cdAj/wZAK/6Z8Cf+IZQf/kWwH/4VjB/+KZgf/iGUH/4ll' +
  'B/+SbAf/gmAH/8aTCv/MmAr/kmwH/5BrB/+Qawf/fl0H/4JgB/9+XQf/h2QH/41pB/+KZgj/4acL/+GnC/+Vbwj/onkI/5x0CP+cdAj/oHcI/5RtB/+nfAj/' +
  'p3wI/5lxCP/BkAr/pnwJ/7+OCf/XoAr/ongI/7yLCf+8iwn/vIsJ/7yLCf+bcwj/xpMK/8yYCv+fdgj/zJgK/8yYCv+IZQf/nnUI/551CP+edQj/nnUI/45p' +
  'B//hpwv/4acL/6l9CP/XoAr/u4sJ/7yLCf/PmQr/z5kK/8+ZCv/OmQr/mnII/8GQCv+mfAn/x5YR/9egCv+uhBT/uYkJ/7mJCf+5iQn/uYkJ/6mBFv/EkQr/' +
  'yZYK/62FF//MmAr/zJgK/5VzFv+ccwj/nHMI/5xzCP+ccwj/nHgW/96lC//epQv/t4wX/9egCv/ElBL/v48P/8yXCv/Mlwr/zJcK/8uXCv+ogBf/vo4K/7CG' +
  'FP/IlxL/16AK/7GLIf+siCf/q4cn/7OPLv/CmCj/xZsr/8OZKP/DmSj/sowo/8yYCv/MmAr/pYMr/6yIJ/+mhSr/rYoq/7SOJ/+4kiv/uJEn/7iRJ/+1jiP/' +
  '16AK/8aXFP+jgir/poMn/6KCLf/InSj/yJ0o/8qfK//InCj/vZYv/7+OCf/XoAr/nXUI/6t/Cf+mewn/p3sI/8+ZCv/PmQr/z5kK/8+ZCv+hdwj/zJgK/8yY' +
  'Cv+Qawf/roEI/510CP+nfAj/u4sJ/7uLCf+7iwn/u4sJ/6B2CP/XoAr/u4sJ/5FsCP+edQj/iWYH/9egCv/XoAr/16AK/9egCv+3iAn/o3kI/7OFCf+RbAj/' +
  'q38J/6Z7Cf+SbAj/rYAJ/62ACf+tgAn/rYAJ/49qCP+rfwn/q38J/41pB/+ugQj/nXUI/5JsCP+fdgj/n3YI/592CP+fdgj/jmkI/7OFCf+gdwj/k20I/551' +
  'CP+GZAf/s4UJ/7OFCf+zhQn/s4UJ/551CP+9jAr/050L/511CP+rfwn/pnsJ/6B3CP/DkAr/oHcI/7GECv+2iAr/togK/7aICv+2iAr/jmkH/66BCP+ddAj/' +
  'pHoJ/7WHCv+Xbwj/ypYK/8qWCv/Klgr/ypYK/7KECf+TbQj/nnUI/4VjB/+xgwn/sYMJ/4NhB/+acgj/iWYH/8eUCv/hpwv/oXgI/6t/Cf+mewn/qHwI/8+Z' +
  'Cv+nfAj/u4sK/8GQCv/BkAr/wZAK/8GQCv+OaQf/roEI/510CP+sgAn/wI8K/5xzCP/XoAr/16AK/9egCv/XoAr/u4sJ/5JsCP+edQj/hWMH/7yLCf+7iwn/' +
  'h2QH/6N5CP+Pagf/m3MI/6h9Cf+Oagj/kGsI/45pCP+ofAj/z5kK/6d8CP+LZwf/jWkH/45qCP+acwj/m3MI/4hlB/+TbAj/imYI/6yACf/Ajwr/kWwI/5dw' +
  'B/+XcAf/nXUI/6h9CP+ddQj/imYH/45pB/+AXwf/vIsJ/7uLCf+BXwf/kWsH/4RiB/+2hwn/zJgK/8yYCv/MmAr/xpMK/6h8CP/PmQr/pnsI/4pmB/+OaQf/' +
  'h2QH/8+ZCv/PmQr/z5kK/8+ZCv+4iAn/rIAJ/8CPCv+MaAf/jmkH/45pB/+acgj/4acL/+GnC//hpwv/4acL/6d8CP+8iwn/u4sJ/6p+Cf/hpwv/v44K/7WG' +
  'Cf/Klwr/ypcK/8qXCv/Fkgr/p3wI/82YCv+lewj/imYH/45pB/+HZAf/zZgK/82YCv/NmAr/zZgK/7eHCf+rfwn/vo4K/4xoB/+OaQf/jmkH/5lxCP/fpgv/' +
  '36YL/9+mC//fpgv/p3wI/7qKCf+6ign/qn4J/+GnC/+/jgr/gF8H/4lmB/+AXwf/mnMI/5pzCP+Zcgj/mnMI/4dkB/+KZgf/jmkH/39eB/+nfAj/p3wI/5Fs' +
  'B/+tgQn/rIAJ/6t/Cf+tgAn/hmMH/45pB/+OaQf/g2EH/6d7Cf+ZcQn/m3MI/6R6CP+heAj/oXcI/6B3CP+pfQn/4acL/7+OCv+TbQf/o3kI/49qB//BkAr/' +
  'wZAK/8GQCv/BkAr/nXUI/4pmB/+OaQf/iWYH/9egCv/XoAr/q38I/+GnC//hpwv/4acL/+GnC/+bcwj/jmkH/45pB/+TbQj/05wL/7iICv+8iwn/z5kK/8+Z' +
  'Cv/PmQr/zpkK/6x/Cf/hpwv/v44K/5NtB/+jeQj/iGUH/552CP+edgj/nHQI/5x1CP+HZQf/eloG/3xcBv+FYgf/16AK/9egCv+Ubgf/r4IJ/6+CCf+wgwn/' +
  'sYMJ/4dkB/97Wwb/e1sG/5JsCP/TnAv/uIgK/5lxCP+keQj/pHkI/6V7CP+lewj/kmwI/7GDCf+cdAn/k20H/6N5CP+Vbgf/0pwK/82ZCv+jeQj/x5QK/8eU' +
  'Cv/HlAr/x5QK/6F3CP/XoAr/16AK/4llB/+ddAj/j2oI/6l/Cf+9jQr/vY0K/72NCv+9jQr/n3YJ/9OcC/+4iAr/k20I/592CP+JZQf/yZYK/8mWCv/Jlgr/' +
  'yZYK/62BCf+TbQf/o3kI/5ZvB//XoAr/0JsK/6Z7CP/Llwr/y5cK/8uXCv/Llwr/ongI/9egCv/XoAr/imYH/6B3CP+SbQj/rIEJ/8GQCv/BkAr/wZAK/8GQ' +
  'Cv+fdgn/05wL/7iICv+Wbwj/o3kI/4pmB//OmQr/zpkK/86ZCv/OmQr/sIMJ/5BrB/+acwj/lm8I/9egCv/Qmwr/iWUH/5t0CP+TbQj/qH0J/6l+Cf+edgj/' +
  'rYEJ/62BCf+IZAf/oHcI/5JtCP+Zcgj/pnsJ/5ZvCP+fdgj/oHcI/5dwCP+mewn/lnAI/5ZvCP+jeQj/iGUH/6p+Cf+qfgn/kGsI/5VuCP+IZQf/x5QK/+Gn' +
  'C/+ugQj/16AK/9CbCv+bcwj/vIsJ/5tzCP/aogv/4acL/+GnC//hpwv/4acL/4xnB/+gdwj/km0I/8eUCv/hpwv/qX0J/8+ZCv/PmQr/z5kK/8+ZCv+1hgn/' +
  'lm8I/6N5CP+NaAf/4acL/+CmC/+MaAf/o3kI/49qB/+sgAn/v44K/5tzCP+3iAn/s4UJ/4tnCP+ieAj/i2cI/7qKCv+/jgr/v44K/7+OCv+/jgr/gF8H/41p' +
  'B/+EYgf/rIAJ/7+OCv+XcAj/sYMJ/7GDCf+xgwn/sYMJ/591CP+GYwf/j2oH/4FfB/+/jgr/vo0K/4BfB/+Pagf/gWAH/6SNKv+wmCz/sJgs/7CYLP+uliz/' +
  'kn4l/6WPKf+TfiX/wKUw/8KnMP+okCv/zrIz/86yM//OsjP/zrIz/76kMf+xmCz/wacw/5qEJ/+RfiT/kX4k/52HKf/OsjP/zrIz/86yM//OsjP/po4r/6GL' +
  'KP+hiij/sZct/9/BOP/FqTL/sJgs/7+mLv+/pi7/v6Yu/7yjLv+bhif/spsr/5yHJ//RtTP/1Lgz/7SaLv/ixTf/4sU3/+LFN//ixTf/zrIz/8GmMP/TtzP/' +
  'oosp/5uHJv+bhyb/qJAr/+LFN//ixTf/4sU3/+LFN/+xmC3/rZYq/62WKv++ozD/9tY8/9a5Nf+Ufyb/nYYo/56IKP+qkSv/qJAr/5iCJ/+jjCn/k34m/9G1' +
  'M//UuDP/q5Ms/72jMf+9ozD/spkt/7WcLv+slCz/pY0r/62VLP+SfSb/m4cm/5uHJv+Ufif/spku/7CXLf+5ny//u6Ew/6SMK/+giSn/oYkp/76jMP/21jz/' +
  '1rk1/5+JJ/+rlCn/qpEr/+zNOf/szTn/7M05/+zNOf/DqTH/0bUz/9S4M/+5ny//9tY8//bWPP+ymS3/zbMy/82zMv/NszL/zbMy/5+JKP+bhyb/m4cm/5iC' +
  'Jv+/pi7/rZYr/9u9Nv/szTn/7M05/+zNOf/szTn/x6sz//bWPP/WuTX/n4kn/6uUKf+pkSv/7M05/+zNOf/szTn/7M05/8OpMf/RtTP/1Lgz/7mfL//21jz/' +
  '9tY8/7KZLf/NszL/zbMy/82zMv/NszL/n4ko/5uHJv+bhyb/mYMn/7+mLv+uliv/2702/+zNOf/szTn/7M05/+zNOf/HqzP/9tY8/9a5Nf+fiSf/q5Qp/52G' +
  'KP+6ny//uZ4v/5J9Jv+Ygif/kHwl/5J9Jv+SfSb/oIkp//bWPP/21jz/qpEs/7ugL/+wly3/o4wq/6uTLP+kjSr/oYsp/6GLKf+bhSj/v6Yu/66WK/+0mi7/' +
  'vqMw/6OMK/+XgSf/l4En/5J9Jv+Zgyf/j3sl/5+JJ/+rlCn/qJAq/9/CNv/cvjb/i3gj/5uHJv+bhyb/m4cm/5uHJv+iiyn/9tY8//bWPP/CpzH/7M05/9a5' +
  'Nf+8oy//zbMy/82zMv/NszL/zbMy/6SNKv+/pi7/rpYr/9a5Nf/nyTj/sJgt/5uHJv+bhyb/m4cm/5uHJv+OeyT/lYAm/5+JJ/+ljSr/38I2/9y+Nv+FcyL/' +
  'kX4k/5F+JP+RfiT/kX4k/5qEKP/fwTj/38E4/7+lMf/szTn/17k1/66WLP+8oy//vKMv/7yjL/+8oy//nIYo/7CZLP+kjSn/1rk1/+fJOP+wly3/kX4k/5F+' +
  'JP+RfiT/kX4k/4h1I//MsDT/38E4/72iMP/fwjb/3L42/6CKKf+3ni3/oIop/9CzNP/StjT/0rY0/9K2NP/StjT/vqMw/+zNOf/XuTX/tJot/8KnMP+jiyr/' +
  't54t/7eeLf+3ni3/t54t/6iRK//WuTX/58k4/72iMP/fwTj/38E4/7mfMP/fwTj/xaky/9/BOP/21jz/xqoy/9/CNv/cvjb/qpMr/8etMP+qkyv/5MU4/+fJ' +
  'OP/nyTj/58k4/+fJOP/ApTH/7M05/9e5Nf/CpzD/1Lgz/62ULP/HrTD/x60w/8etMP/HrTD/tJst/9a5Nf/nyTj/wKQx//bWPP/21jz/yKwz//bWPP/WuTX/' +
  'rJQt/7mfL/+jiyr/rZUs/6yTLP+pkiv/x60w/6qTK/+7oDD/vKEw/7OaLv+zmS3/s5kt/6GJKv+1my7/qpEr/8KnMP/UuDP/qZEr/7CXLf+wly3/po8r/6uT' +
  'LP+jiyr/tJou/7yhMP+qkS3/9tY8//bWPP+rki3/wKUx/62VLf+hiij/rZYq/62WKv+tlir/q5Mq/6mSKv/HrTD/qpMr/92+Nv/gwjb/q5Mr/7KbK/+ymyv/' +
  'spsr/7KbK/+ljyn/wqcw/9S4M/+3nS//9tY8//bWPP++ojD/4MI2/+DCNv/gwjb/4MI2/7yhMP/21jz/9tY8/7SbLv/UuDP/u6Eu/6GKKP+tlir/rZYq/62W' +
  'Kv+rkyr/qZIq/8etMP+qkyv/3b42/+DCNv+rkiv/spsr/7KbK/+ymyv/spsr/6WPKf/CpzD/1Lgz/7edL//21jz/9tY8/76iMP/gwjb/4MI2/+DCNv/gwjb/' +
  'vKEw//bWPP/21jz/tJsu/9S4M/+7oS7/nocp/6iQKv+ahCf/n4gp/56HKP+eiCn/qJEr/5eBJ//dvjb/4MI2/6mRK/+mjyr/po8q/5J9Jf+WgSb/kn0l/52H' +
  'KP+jjCn/oooq//bWPP/21jz/r5Yu/7yhL/+0my7/tZsu/7meL/+tlCz/waYx/8GmMf+vly3/1Lgz/7uhLv/WuTX/7M05/7yhL//NszL/zbMy/82zMv/NszL/' +
  'r5cs/92+Nv/gwjb/uJ4v/+DCNv/gwjb/nIYo/62WKv+tlir/rZYq/62WKv+kjSr/9tY8//bWPP/DpzH/7M05/9K1NP/StjT/4sU3/+LFN//ixTf/4sU3/7KZ' +
  'Lf/UuDP/u6Eu/97BPf/szTn/ya08/8yyMv/MsjL/zLIy/8yyMv++pjv/3L02/9/BNv/HrT3/4MI2/+DCNv+rlTf/rJUq/6yVKv+slSr/rJUq/7ObOf/11Dz/' +
  '9dQ8/9K2QP/szTn/3L89/9a6Ov/hwzf/4cM3/+HDN//hwzf/wKc8/9O3M//FrDn/4MI+/+zNOf/KsUf/wKpJ/8CpSf/Ks1D/2b9O/9vCUf/awU//2sFP/8uy' +
  'TP/gwjb/4MI2/7ulS//Aqkj/u6ZK/8KsTP/IsUr/zLVO/862TP/Otkz/zrRJ/+zNOf/ewT//tqFJ/7mjRv+4o0z/4cZQ/+HGUP/ix1P/4MVQ/9S8U//WuTX/' +
  '7M05/7ecLv+7oy7/uKAu/7yiL//ixTf/4sU3/+LFN//ixTf/uZ8v/+DCNv/gwjb/po8q/7+mLv+wmCz/u6Iv/8yyMv/MsjL/zLIy/8yyMv+4ny//7M05/9K1' +
  'NP+jjCj/rZYq/56IKP/szTn/7M05/+zNOf/szTn/zrIz/7qgL//KrjL/qZAr/7ujLv+4oC7/p5Aq/8KoMP/CqDD/wqgw/8KoMP+mjiv/waYw/8GmMP+jjCn/' +
  'v6Yu/7GZLP+mjyv/spot/7KaLf+ymi3/spot/6SOKv/KrjL/t50u/6WOKv+tlir/moQn/8quMv/KrjL/yq4y/8quMv+0my3/17o3/+zNO/+4nTD/u6Mu/7mg' +
  'Lv+4ni//2rw2/7eeL//KrjL/zLAy/8ywMv/MsDL/zLAy/6SNKv+/pi7/sJgs/7ugL//LrzL/sJct/+PEOP/jxDj/48Q4/+PEOP/LrzP/pY4q/62WKv+Zgyf/' +
  'xqsx/8arMf+Zgyf/rJUr/5yHKP/fwTj/9tY8/7ugMP+7oy7/uaAu/72kMP/ixTf/vaMv/9G1M//UuDP/1Lgz/9S4M//UuDP/pI0q/7+mLv+wmCz/waYw/9O3' +
  'M/+1my7/7M05/+zNOf/szTn/7M05/9K1NP+jjSn/rZYq/5mEJ//NszL/zbMy/5yGKP+ymyv/oIso/7WbL//CpzH/qI8s/6aPK/+mjiv/vaMw/+LFN/+8oy//' +
  'ooop/6OLKf+kjSr/s5kt/7OaLv+giSn/qpIr/6GKKf/BpjD/07cz/6iQK/+ulSz/rpUs/7WcLv/DpzL/t50v/6CKKf+kjSr/l4En/82zMv/NszL/mIIo/6eQ' +
  'K/+ahCj/zLAy/+DCNv/gwjb/4MI2/92+Nv+9oy//4sU3/7uiL/+ZhCb/m4cm/5yGKP/ixTf/4sU3/+LFN//ixTf/zrIz/8GnMP/TtzP/oosp/5uHJv+bhyb/' +
  'sZgt//bWPP/21jz/9tY8//bWPP/BpjH/zbMy/82zMv/DpzL/9tY8/9a5Nf/MrzL/38E2/9/BNv/fwTb/3L42/72jL//hxDf/u6Iv/5mEJv+bhyb/nIYo/+HE' +
  'N//hxDf/4cQ3/+HEN//OsjP/waYw/9K2M/+iiyn/m4cm/5uHJv+wmC3/9dU8//XVPP/11Tz/9dU8/8GmMf/NsjL/zbIy/8OoMv/21jz/1rk1/5R/Jv+dhyj/' +
  'mIIn/7GZLf+xmS3/r5cs/7KZLf+chij/mYQm/5uHJv+Ufyb/wKUx/8ClMf+ski3/xqsy/8WqMv/EqTL/xaoy/52GKP+bhyb/m4cm/5mEKP+/pTH/sZgu/7Oa' +
  'Lv+8ojD/uJ8v/7ifL/+4ny//wacx//bWPP/WuTX/pY8p/7KbK/+mjir/1Lgz/9S4M//UuDP/1Lgz/7GZLP+ZhCb/m4cm/5+IKP/szTn/7M05/8aqM//21jz/' +
  '9tY8//bWPP/21jz/s5kt/5uHJv+bhyb/qpIr/+fJOP/OsjP/0rY0/+LFN//ixTf/4sU3/+LFN//FqjL/9tY8/9a5Nf+ljyn/spsr/56IKP+0my3/tJst/7GZ' +
  'LP+ymi3/nYco/4x4JP+MeST/moQn/+zNOf/szTn/rpUu/8esMv/GqzL/yK0z/8mtM/+ehyn/jHkj/4x5I/+nkCv/58k4/86yM/+wly3/uqAv/7mgL/+8oi//' +
  'vKIv/6qSLP/JrjP/tJsu/6WPKf+ymyv/rZQs/+rKOf/oxzr/uqAv/92/Nv/dvzb/3b82/92/Nv+6oC//7M05/+zNOf+fiSn/rZcr/6KMKf/ApjD/0rYz/9K2' +
  'M//StjP/0rYz/7ieL//nyTj/zrIz/6aPKf+wmSv/n4gp/+DBN//gwTf/4ME3/+DBN//FqTH/pY8p/7KbK/+tlSz/7M05/+nJOf+8oS//38E2/9/BNv/fwTb/' +
  '38E2/7ugL//szTn/7M05/6CKKf+vmSv/pI8p/8KnMP/UuDP/1Lgz/9S4M//UuDP/uJ4v/+fJOP/OsjP/p5Ep/7KbK/+fiSn/4sQ3/+LEN//ixDf/4sQ3/8ar' +
  'Mf+okCv/s5ou/7CWLf/szTn/6ck5/6CJKf+1mi7/q5Is/8SnMv/FqDL/uZ4w/8msM//JrDP/nIco/6+ZK/+kjyn/s5ku/8GlMf+vli3/uZ4v/7mfL/+wly3/' +
  'wKUx/7CXLf+nkSn/spsr/52GKP/GqTL/xqky/6iQK/+tlCz/nocp/9/BOP/21jz/ya0z/+zNOf/pyTn/r5cs/82zMv+vlyz/8tI8//bWPP/21jz/9tY8//bW' +
  'PP+hiyr/r5kr/6SPKf/fwTj/9tY8/8OnMf/ixTf/4sU3/+LFN//ixTf/yq8y/6eRKf+ymyv/o4wq//bWPP/21jz/oYop/7KbK/+giyj/xaky/9a5Nf+0my7/' +
  'zrIz/8yvM/+fiSn/tZ0t/5+JKf/TtjX/1rk1/9a5Nf/WuTX/1rk1/5SAJ/+eiSj/loIm/8WpMv/WuTX/r5Yt/8asMf/GqzH/xqsx/8arMf+0my7/mIQm/6CK' +
  'KP+WgSf/1rk1/9a5Nf+Ufyb/oIso/5N/Jf9PYHT/UWJ3/1Fid/9RYnf/T2B0/09fdP9RYnf/Tl9z/0VUZ/9HVmn/SFhr/1Fid/9RYnf/UWJ3/1Fid/9PYHT/' +
  'RlVn/0dVaP9IV2r/UWJ3/1Fid/9NXXD/UWJ3/1Fid/9RYnf/UWJ3/0lZbP88SFj/PEhY/0pabv9RYnf/T2B0/1Fid/9UZnz/VGZ8/1RmfP9RY3j/UGF2/1Rm' +
  'fP9PYHX/RlVo/0hYa/9IWGv/VGZ8/1RmfP9UZnz/VGZ8/1Fid/9GVWj/SFdq/0hXaf9UZnz/VGZ8/01dcf9UZnz/VGZ8/1RmfP9UZnz/SVls/ztHV/87R1f/' +
  'Slpu/1RmfP9RYnf/TV1x/01dcv9NXnL/TV1y/0xccP9MXXH/TV1y/0xccf9GVWj/SFhr/0hYa/9NXXL/TV1y/01ecv9NXXL/TFxw/0dWaf9HVmn/SVhr/1Rm' +
  'fP9UZnz/TFxw/01dcv9NXnL/TV1y/01dcv9JWmz/QU9f/0FPX/9MXXH/VGZ8/1Fid/9RYnf/VGZ8/0xccP9UZnz/VGZ8/1RmfP9UZnz/T2B1/0ZVaP9IWGv/' +
  'SFhr/1RmfP9UZnz/TV1y/1RmfP9UZnz/VGZ8/1RmfP9NXXH/VGZ8/1RmfP9NXXH/VGZ8/1Fid/9RYnf/VGZ8/1RmfP9UZnz/VGZ8/01ecv9UZnz/UWJ3/1Fi' +
  'd/9UZnz/TFxw/1RmfP9UZnz/VGZ8/1RmfP9PYHX/RlVo/0hYa/9IWGv/VGZ8/1RmfP9NXXL/VGZ8/1RmfP9UZnz/VGZ8/01dcf9UZnz/VGZ8/01dcf9UZnz/' +
  'UWJ3/1Fid/9UZnz/VGZ8/1RmfP9UZnz/TV5y/1RmfP9RYnf/UWJ3/1RmfP9MXHD/TV1y/0xccP9MXXH/TV1y/01ec/9LW27/S1tu/0xbb/9UZnz/VGZ8/0tb' +
  'b/9NXXL/TFxw/0xccP9NXXL/TV5y/01dcv9NXXL/Tl5x/1RmfP9RYnf/Slpt/0tbbv9KWm3/TV1y/01dcv9NXnL/TV1y/01dcv9RYnf/VGZ8/0xccP9UZnz/' +
  'UWN4/1Bhdv9UZnz/VGZ8/1RmfP9UZnz/TV1x/1RmfP9UZnz/TV1y/1RmfP9RYnf/UWJ3/1RmfP9UZnz/VGZ8/1RmfP9NXXH/VGZ8/1Fid/9MXXD/T2B0/0pa' +
  'bv9UZnz/VGZ8/1RmfP9UZnz/UWJ3/09gdP9RYnf/TFxv/1RmfP9RY3j/T190/1Fid/9RYnf/UWJ3/1Fid/9NXXH/UWJ3/1Fid/9OXnP/VGZ8/1Fid/9PYHT/' +
  'UWJ3/1Fid/9RYnf/UWJ3/01dcP9RYnf/T2B0/0xdcP9PYHT/S1tv/1Fid/9RYnf/UWJ3/1Fid/9PYHT/T2B0/1Fid/9MXG//VGZ8/1FjeP9PX3T/UWJ3/09f' +
  'c/9LW27/TF1w/0xdcP9MXXD/TF1w/01ecv9UZnz/UWJ3/0dWaP9HVmn/SFhq/1Fid/9RYnf/UWJ3/1Fid/9PYHT/TF1w/09gdP9LW2//UWJ3/1Fid/9NXXH/' +
  'UWJ3/09gdP9RYnf/VGZ8/0xccP9UZnz/UWN4/1Bhdv9UZnz/UGF1/01dcf9PYHT/T2B0/09gdP9PYHT/TF1x/1RmfP9RYnf/R1Zp/0hYa/9IV2r/VGZ8/1Rm' +
  'fP9UZnz/VGZ8/1Fid/9MXXD/T2B0/0pabv9UZnz/VGZ8/01ecv9UZnz/UWJ3/0lYa/9IWGv/RlVn/0hYa/9HV2r/UGF2/1RmfP9QYXb/Slps/0tbbv9LW2//' +
  'S1tu/0tbbv9LW2//TV1y/01dcf9HVmn/SFhr/0hXav9NXXL/TV1y/01ecv9NXXL/TF1w/0pabf9LW27/Slpt/1RmfP9UZnz/Slpt/0tbbv9LW2//PEhY/ztH' +
  'V/87R1f/O0dX/zlFVP9PYHX/VGZ8/1Bhdv9RY3j/VGZ8/01dcf9UZnz/VGZ8/1RmfP9UZnz/UWJ3/0dWaf9IWGv/SFdq/1RmfP9UZnz/TV1x/1RmfP9UZnz/' +
  'VGZ8/1RmfP9NXXL/VGZ8/1RmfP9HVmn/SFhr/0dXav88SFj/O0dX/ztHV/87R1f/OUVU/09gdf9UZnz/UGF2/1FjeP9UZnz/TV1x/1RmfP9UZnz/VGZ8/1Rm' +
  'fP9RYnf/R1Zp/0hYa/9IV2r/VGZ8/1RmfP9NXXH/VGZ8/1RmfP9UZnz/VGZ8/01dcv9UZnz/VGZ8/0dWaf9IWGv/R1dq/0VUZf9EUmT/Q1Jj/0RSZP9EUmP/' +
  'TV1x/01dcf9NXXH/UWN4/1RmfP9NXXH/TV1x/01dcf9JWGv/RlRm/0VUZv9CUGH/QU9g/0ZVZ/9UZnz/VGZ8/0xccP9NXXH/TV1x/01dcf9NXXH/TFxw/01d' +
  'cf9NXXH/SFdq/0hYa/9HV2r/UWJ3/1RmfP9MXHD/VGZ8/1RmfP9UZnz/VGZ8/1Bhdv9RY3j/VGZ8/01dcf9UZnz/VGZ8/0BOXv87R1f/O0dX/ztHV/87R1f/' +
  'Qk9g/1RmfP9UZnz/TV1x/1RmfP9RYnf/UWJ3/1RmfP9UZnz/VGZ8/1RmfP9HVmn/SFhr/0dXav9RYnf/VGZ8/0xccP9TZXr/U2V6/1Nlev9TZXr/T2B1/1Bi' +
  'd/9TZXr/TV1x/1RmfP9UZnz/QE5e/zpGVv86Rlb/OkZW/zpGVv9CT2D/U2V6/1Nlev9NXXH/VGZ8/1Fid/9QYXb/U2V6/1Nlev9TZXr/U2V6/0dWaP9HV2r/' +
  'R1Zp/1Fid/9UZnz/SFhr/0JQYf9CT2D/TV1y/05fc/9PYHT/Tl9z/05fc/9NXXD/VGZ8/1RmfP9LW27/TF1x/0tbb/9LW2//TF1x/05fc/9OX3P/Tl9z/01e' +
  'cv9UZnz/UWJ3/0BNXv8/TF3/RFJk/05fc/9OX3P/Tl90/01ecv9NXXL/UWJ3/1RmfP9GVWf/QE5e/z5MW/9PYHX/VGZ8/1RmfP9UZnz/VGZ8/01dcf9UZnz/' +
  'VGZ8/01dcv9UZnz/UWJ3/1Fid/9UZnz/VGZ8/1RmfP9UZnz/TV1x/1RmfP9RYnf/O0dX/ztHV/9ATl7/VGZ8/1RmfP9UZnz/VGZ8/1Fid/9PYHT/UWJ3/0ZV' +
  'Z/9ATl7/Pkxb/05fc/9RYnf/UWJ3/1Fid/9RYnf/TV1y/1Fid/9RYnf/Tl5z/1RmfP9RYnf/T2B0/1Fid/9RYnf/UWJ3/1Fid/9NXnH/UWJ3/09gdf88SVj/' +
  'O0dX/0FPX/9RYnf/UWJ3/1Fid/9RYnf/UGB1/09fc/9RYnf/RVRm/0BOXv8+TFv/Tl5z/1Fid/9OXnL/RFNl/0VVZ/9FVWf/RVVn/0VVZ/9MXHD/VGZ8/1Fi' +
  'd/9FU2b/RVRm/0dWaP9RYnf/UWJ3/1Fid/9RYnf/T190/zxIWP87R1f/QE5e/1Fid/9RYnf/TFxw/1Fid/9PX3T/UWJ3/1RmfP9GVWf/QE5e/z5MW/9QYXb/' +
  'VGZ8/09gdf9GVWj/SFhr/0hYa/9IWGv/SFhr/0tbb/9UZnz/UWJ3/0dVaP9IV2r/SFdp/1RmfP9UZnz/VGZ8/1RmfP9RYnf/O0dX/ztHV/9ATl7/VGZ8/1Rm' +
  'fP9NXnL/VGZ8/1Fid/9NXHD/TV1x/0hXav9EUmT/Q1Jj/1Bhdv9UZnz/UGF2/0dWaf9IV2r/SFdq/0hXav9IV2r/S1tu/01dcf9NXXH/R1Vo/0hXav9IV2r/' +
  'TV1x/01dcf9OXnL/TV1x/01dcP9DUGH/Qk9g/0VUZv9UZnz/VGZ8/0tbb/9NXXH/TV1x/1Fid/9UZnz/VGZ8/1RmfP9RY3j/UGF2/1RmfP9QYXb/UWN4/1Rm' +
  'fP9NXXH/VGZ8/1RmfP9UZnz/VGZ8/1Fid/9HVWj/SFdq/0hXaf9UZnz/VGZ8/01dcf9UZnz/VGZ8/1RmfP9UZnz/TV1y/1RmfP9UZnz/TV5y/1RmfP9RYnf/' +
  'UGF2/1Nle/9TZXv/U2V7/1Fid/9QYXb/U2V7/1Bhdv9RY3j/VGZ8/01dcf9TZXv/U2V7/1Nle/9TZXv/UGF2/0dVZ/9IV2n/SFdp/1RmfP9UZnz/TV1x/1Nl' +
  'e/9TZXv/U2V7/1Nle/9NXXL/U2V7/1Nle/9NXnL/VGZ8/1Fid/9NXXH/Tl5z/0lZbP9HVmn/R1Zp/0hXav9HVmn/SFhr/1FjeP9UZnz/TV1x/05ec/9OXnP/' +
  'TFxv/05ec/9OX3P/TV5y/01dcf9MW2//VGZ8/1RmfP9LW27/S1tu/0tabv9MXXH/Tl5z/05fdP9OXnP/Tl5z/05fc/9UZnz/UWJ3/1Fid/9UZnz/SFhr/0hY' +
  'a/9IWGv/SFhr/0hYa/9IV2r/UWN4/1RmfP9NXXH/VGZ8/1RmfP9NXXL/VGZ8/1RmfP9UZnz/VGZ8/01dcf9UZnz/VGZ8/0tbbv9PYHT/TV1x/1Fid/9UZnz/' +
  'VGZ8/1RmfP9UZnz/TV5y/1RmfP9RYnf/UWJ3/1RmfP9KWm3/SFdq/0dXav9HV2r/R1Zp/0hYa/9NXnL/T2B0/01ccP9UZnz/VGZ8/0tbb/9OX3P/Tl90/09g' +
  'dP9PX3T/TFxv/09fdP9PX3T/S1tv/09gdP9NXXH/Tl5z/09gdf9QYHX/T2B0/09gdP9MXXD/T2B0/05fc/9RYnf/VGZ8/0xccP9SZHn/UGF2/0lZbf9KWm7/' +
  'Slpu/0pabv9KWm7/Slls/1RmfP9UZnz/QE5f/ztIV/88SVn/RlVn/0dWaf9HVmn/R1Zp/0dWaf9IV2r/T2B0/01dcf9QYHX/UmR5/0xbb/9LW3D/S1tw/0tb' +
  'cP9LW3D/Slpu/1Fid/9UZnz/TFxw/1RmfP9RY3j/Slpu/0xccP9MXHD/TFxw/0xccP9KWW3/VGZ8/1RmfP9AT2D/PElZ/z1KWv9HVmn/SFhr/0hYa/9IWGv/' +
  'SFhr/0hXav9PYHT/TV1x/1Fid/9UZnz/TFxw/01dcv9NXXL/TV1y/01dcv9LW2//TFtv/0xccP9KWm7/VGZ8/1FjeP9KWm3/SVls/0lZbP9JWGv/SVls/0ta' +
  'bv9MXHD/TFxw/0FPYP88SVn/PUpa/0hXav9IV2r/R1dp/0hXav9IV2r/Sllt/0pabf9KWm3/UWJ3/1RmfP9NXnL/Sllt/0pZbf9JWWz/Sllt/0pabv9RYnf/' +
  'VGZ8/0xccP9UZnz/UWN4/1Bhdv9UZnz/UGF2/1FjeP9UZnz/VGZ8/1RmfP9UZnz/QE9g/zxJWf89Slr/UWJ3/1RmfP9NXXH/VGZ8/1RmfP9UZnz/VGZ8/1Fi' +
  'd/9RYnf/VGZ8/01dcv9UZnz/VGZ8/01ecv9UZnz/UWJ3/09gdP9RYnf/TFxw/1Fid/9PYHT/T2B0/1Fid/9PYHT/T2B0/1Fid/9RYnf/UWJ3/1Fid/9DUmT/' +
  'Pktc/0BNXv9PYHT/UWJ3/01dcf9RYnf/UWJ3/1Fid/9RYnf/T2B0/09gdP9RYnf/TV1y/1Fid/9RYnf/TV5y/1Fid/9PYHX/XGl2/2NxgP9jcYD/Y3GA/2Jv' +
  'fv9SXWr/XWp4/1Ndav9seov/bXyN/15qeP90hJX/dISV/3SElf90hJX/a3qK/2RxgP9tfIz/V2Ju/1Jdaf9SXWn/WGRx/3SElf90hJX/dISV/3SElf9daXf/' +
  'W2d0/1tndP9jcH//fo+i/29+jv9jcYD/bHuM/2x7jP9se4z/anmJ/1djcP9lc4L/WGRx/3aGmP94iZv/ZXKB/4CSpf+AkqX/gJKl/4CSpf90hJX/bXuM/3iI' +
  'mv9bZ3T/WGRx/1hkcf9ea3n/gJKl/4CSpf+AkqX/gJKl/2Nxf/9icH7/YnB+/2t5if+Mn7T/eYmb/1Nea/9YZHH/WWVy/19sev9ea3n/VWBt/1tndf9SXWn/' +
  'doaY/3iJm/9gbHv/aniI/2p4iP9kcYD/ZnOC/2Fte/9daXb/YW59/1JcaP9YZHH/WGRx/1Nea/9kcoD/Y3B//2h2hf9pd4f/XGh1/1pmc/9aZnP/a3mJ/4yf' +
  'tP95iZv/WmZz/2Fuff9fa3r/hpis/4aYrP+GmKz/hpis/259jf92hpj/eImb/2h2hf+Mn7T/jJ+0/2Rxf/91hZb/dYWW/3WFlv91hZb/WWVy/1hkcf9YZHH/' +
  'VWBu/2x7jP9ib37/e4ye/4aYrP+GmKz/hpis/4aYrP9wfo//jJ+0/3mJm/9aZnP/YW59/19ref+GmKz/hpis/4aYrP+GmKz/bn2N/3aGmP94iZv/aHaF/4yf' +
  'tP+Mn7T/ZHF//3WFlv91hZb/dYWW/3WFlv9ZZXL/WGRx/1hkcf9WYW7/bHuM/2Jvfv97jJ7/hpis/4aYrP+GmKz/hpis/3B+j/+Mn7T/eYmb/1pmc/9hbn3/' +
  'WGNw/2h2hv9ndYX/Ul1o/1Vgbf9RXGj/Ul1p/1Jdaf9aZXP/jJ+0/4yftP9fa3n/aHeG/2Nwfv9bZ3X/YG17/1xodv9bZ3T/W2Z0/1djcP9se4z/Ym9+/2Vy' +
  'gf9reYn/XGh1/1RgbP9VYGz/Ul1p/1Zhbv9RW2f/WmZz/2Fuff9eanj/f5Cj/32NoP9PWWX/WGRx/1hkcf9YZHH/WGRx/1tndP+Mn7T/jJ+0/217jP+GmKz/' +
  'eYmb/2t5iP91hZb/dYWW/3WFlv91hZb/XGh2/2x7jP9ib37/eYmb/4OVqf9jcH//WGRx/1hkcf9YZHH/WGRx/1BbZ/9UX2z/WmZz/11odv9/kKP/fY2g/0tV' +
  'YP9SXWn/Ul1p/1Jdaf9SXWn/VmJu/36Pov9+j6L/bHqK/4aYrP95iZv/Y29+/2t5iP9reYj/a3mI/2t5iP9XY3D/Y3GA/1xodv95iZv/g5Wp/2Nwf/9SXWn/' +
  'Ul1p/1Jdaf9SXWn/TVdi/3OCk/9+j6L/aneH/3+Qo/99jaD/WmZz/2d2hf9aZnT/dYWW/3eHmP93h5j/d4eZ/3eHmP9reYn/hpis/3mJm/9lcoL/bXyN/1tn' +
  'df9ndoX/Z3aF/2d2hf9ndYX/X2x6/3mJm/+Dlan/aniI/36Pov9+j6L/aHWF/36Pov9vfo7/fo+i/4yftP9vfY7/f5Cj/32NoP9gbXv/cYGS/2BtfP+Bkqb/' +
  'g5Wp/4OVqf+Dlan/g5Wp/2x6iv+GmKz/eYmb/218jf94iZv/YG58/3GBkv9xgZL/cYGS/3GBkv9mdIP/eYmb/4OVqf9reor/jJ+0/4yftP9wf5D/jJ+0/3mJ' +
  'm/9hbnz/aHaF/1tmdP9ibn3/YW18/2Bte/9xgZL/YG18/2h2hf9pd4f/ZHKB/2Rygf9kcYH/WmVz/2Vzgv9fbHr/bXyN/3iJm/9fa3r/Ym9+/2Jvfv9danj/' +
  'YG17/1tndP9lcoH/aXeH/19ref+Mn7T/jJ+0/2Bsev9seov/YW59/1tndP9icH7/YnB+/2Jwfv9gbnz/X2x7/3GBkv9gbXv/fY2h/3+QpP9fbHv/ZXOC/2Vz' +
  'gv9lc4L/ZXOC/11qeP9tfI3/eImb/2Z0hP+Mn7T/jJ+0/2p4iP9/kKT/f5Ck/3+QpP9/kKT/aXeH/4yftP+Mn7T/ZXOC/3iJm/9peIj/W2d0/2Jwfv9icH7/' +
  'YnB+/2BufP9fbHv/cYGS/2Bte/99jaH/f5Ck/19se/9lc4L/ZXOC/2Vzgv9lc4L/XWp4/218jf94iZv/ZnSE/4yftP+Mn7T/aniI/3+QpP9/kKT/f5Ck/3+Q' +
  'pP9pd4f/jJ+0/4yftP9lc4L/eImb/2l4iP9ZZXH/Xmt5/1dib/9ZZXL/WGRx/1llcv9fa3n/VWBs/32Nof9/kKT/X2t5/11pd/9daXf/Ul1p/1RfbP9SXWn/' +
  'WGRx/1todf9aZnT/jJ+0/4yftP9ib33/aXeH/2Vygv9lcoL/Z3WF/2Bue/9se4v/bHuL/2Jvfv94iZv/aXiI/3mJm/+GmKz/aXeG/3WFlv91hZb/dYWW/3WF' +
  'lv9jcH//fY2h/3+QpP9ndIT/f5Ck/3+QpP9YZHD/YnB+/2Jwfv9icH7/YnB+/1xodv+Mn7T/jJ+0/218jP+GmKz/d4aY/3aHmP+AkqX/gJKl/4CSpf+AkqX/' +
  'ZHGA/3iJm/9peIj/gZGj/4aYrP92g5P/dISV/3SElf90hJX/dISV/3J/jv98jKD/fo+j/3aDk/9/kKT/f5Ck/2Zyf/9hb33/YW99/2Fvff9hb33/a3eF/4ue' +
  'sv+LnrL/fIub/4aYrP+AkKL/e4uc/3+RpP9/kaT/f5Gk/3+RpP9ygI7/d4ia/3SCkv+Ck6T/hpis/32JmP96hpT/eoaT/4KOnP+IlqX/i5mo/4iXpv+Il6b/' +
  'f4ya/3+QpP9/kKT/eYSQ/3qGlP94hJH/fYiV/3+Lmf+Dj53/go+d/4KPnf9/jJz/hpis/4KSpP92gY3/doGO/3iDj/+Mm6v/jJur/46drf+Mmqr/iZWj/3mJ' +
  'm/+GmKz/Z3SD/2t5if9pd4b/aniI/4CSpf+AkqX/gJKl/4CSpf9odoX/f5Ck/3+QpP9daXf/bHuM/2NxgP9qeIj/dISV/3SElf90hJX/dISV/2h1hP+GmKz/' +
  'd4aY/1xpdv9icH7/WWVy/4aYrP+GmKz/hpis/4aYrP90hJX/aXeH/3KBkv9fa3n/a3mJ/2l3hv9eanj/bX2N/219jf9tfY3/bX2N/11pd/9te4z/bXuM/1tn' +
  'df9se4z/ZHGA/15qeP9lcoH/ZXKB/2Vygf9lcoH/XWh2/3KBkv9ndIT/XWp3/2Jwfv9XYm//coGS/3KBkv9ygZL/coGS/2Vzgv95ipz/hpis/2d1hP9reYn/' +
  'aXeG/2d1hP97jJ7/Z3WE/3KBkv9zg5T/c4OU/3ODlP9zg5T/XGh2/2x7jP9jcYD/aXeH/3OCk/9jb37/gJGk/4CRpP+AkaT/gJGk/3OBk/9danj/YnB+/1Zi' +
  'bv9wf5D/cH+Q/1Zhbv9hbn3/WGRx/36Pov+Mn7T/aXeG/2t5if9pd4f/a3mJ/4CSpf9qeYj/doaY/3iJm/94iZv/eImb/3iJm/9caHb/bHuM/2NxgP9tfIz/' +
  'eIia/2Vygf+GmKz/hpis/4aYrP+GmKz/d4aY/1xpdv9icH7/VmJu/3WFlv91hZb/V2Nw/2Vzgv9aZ3T/ZXOC/218jP9danj/XWp4/11pd/9reYn/gJKl/2p5' +
  'iP9aZnT/W2d1/1xpdv9kcoD/ZHKB/1llcv9fbHr/WmZ0/218jP94iJr/X2p5/2Juff9ibn3/ZnOC/217jP9ndIP/WmZz/1xodv9UX2v/dYWW/3WFlv9VYGz/' +
  'Xmp4/1Zhbv9zgpT/f5Ck/3+QpP9/kKT/fY2h/2p5if+AkqX/aXiH/1Zib/9YZHH/V2Nw/4CSpf+AkqX/gJKl/4CSpf90hJX/bXyM/3iImv9bZ3T/WGRx/1hk' +
  'cf9jcYD/jJ+0/4yftP+Mn7T/jJ+0/2x7i/91hZb/dYWW/218jP+Mn7T/eYmb/3OClP9+j6P/fo+j/36Po/98jaD/anmJ/4CRpP9peIf/VmJv/1hkcf9XY3D/' +
  'gJGk/4CRpP+AkaT/gJGk/3SElf9te4v/eIeZ/1tndP9YZHH/WGRx/2Nwf/+LnrP/i56z/4ues/+LnrP/bHuL/3WElf91hJX/bnyM/4yftP95iZv/VF5q/1hk' +
  'cf9VYG3/ZHGA/2RxgP9ib37/ZHGA/1hjcP9WYm//WGRx/1Neav9seor/bHqK/2Bsev9vfo//b36O/259jf9vfo7/WGNw/1hkcf9YZHH/VmFu/2t6iv9jcX//' +
  'ZHKB/2p4iP9odYX/aHWF/2h1hf9te4v/jJ+0/3mJm/9danj/ZXOC/11pd/94iZv/eImb/3iJm/94iZv/ZHGA/1Zib/9YZHH/WWVy/4aYrP+GmKz/b36O/4yf' +
  'tP+Mn7T/jJ+0/4yftP9kcoH/WGRx/1hkcf9fbHr/g5Wp/3SElv92h5j/gJKl/4CSpf+AkqX/gJKl/29+jv+Mn7T/eYmb/11qeP9lc4L/WWRx/2Vzgv9lc4L/' +
  'ZHKA/2Rygf9YZHH/Tlll/09aZf9WYm//hpis/4aYrP9hbnz/cH+Q/3B/kP9xgJH/cYCR/1hkcf9PWWX/T1ll/15qef+Dlan/dISW/2Jwf/9od4b/aHeG/2p4' +
  'iP9qeIj/YGx6/3KBkv9lc4L/XWp4/2Vzgv9hbnz/hJaq/4OUp/9pd4f/fY6h/32Oof99jqH/fY6h/2l3hv+GmKz/hpis/1plcv9jcH7/XGh1/2x7i/92h5n/' +
  'doeZ/3aHmf92h5n/Z3WE/4OVqf90hJb/XWp4/2RygP9ZZXL/f5Cj/3+Qo/9/kKP/f5Cj/29+jv9danj/ZXOC/2FufP+GmKz/hJWp/2p4iP9/kKP/f5Cj/3+Q' +
  'o/9/kKP/aXeG/4aYrP+GmKz/WmZz/2RygP9danf/bXyN/3iJm/94iZv/eImb/3iJm/9ndYT/g5Wp/3SElv9ea3n/ZXOC/1lmc/+BkqX/gZKl/4GSpf+BkqX/' +
  'cH+Q/15qeP9kcYH/Ym99/4aYrP+Elan/WWVz/2Vzgf9gbXr/bXyM/258jf9ndYX/cH+Q/3B/kP9YY3D/ZHKA/11qd/9kcYH/a3qK/2Jvfv9ndYX/Z3WF/2Nv' +
  'fv9reYr/Ym9+/15ref9lc4L/WGRx/259jv9ufY7/Xmp4/2FtfP9ZZHL/fo+i/4yftP9xgJD/hpis/4SVqf9jcH//dYWW/2Nwf/+JnLD/jJ+0/4yftP+Mn7T/' +
  'jJ+0/1tndP9kcoD/XWp3/36Pov+Mn7T/bXyM/4CSpf+AkqX/gJKl/4CSpf9ygpP/Xmt5/2Vzgv9baHX/jJ+0/4yftP9aZnT/ZXOC/1pndP9vfo7/eYmb/2Vz' +
  'gf90hJX/c4KT/1plc/9ndYT/WmZz/3eHmf95iZv/eYmb/3mJm/95iZv/VF9r/1pmc/9VYG3/b36O/3mJm/9ib37/cH+Q/3B/kP9wf5D/cH+Q/2Zzg/9VYW7/' +
  'Wmd0/1RfbP95iZv/eYmb/1Nea/9aZ3T/U15q/6JXAP+iVwD/olcA/6JXAP+iVwD/olcA/6JXAP+iVwD/olcA/6JXAP+iVwD/olcA/6JXAP+iVwD/olcA/6JX' +
  'AP+iVwD/olcA/6JXAP+iVwD/olcA/6JXAP+iVwD/olcA/6JXAP+iVwD/olcA/6JXAP+iVwD/olcA/6JXAP+iVwD/zn0e/818Hv+wbR7/sG0e/7BtHv+wbR7/' +
  'sG0e/7BtHv+wbR7/sG0e/7BtHv+wbR7/sG0e/7BtHv+wbR7/sG0e/7BtHv+wbR7/sG0e/7BtHv+wbR7/sG0e/7BtHv+wbR7/sG0e/7BtHv+wbR7/sG0e/7Bt' +
  'Hv+wbR7/zXwe/859Hv/UcgD/0XEA/6JXAP+iVwD/olcA/6JXAP+iVwD/olcA/6JXAP+iVwD/olcA/6JXAP+iVwD/olcA/6JXAP+iVwD/olcA/6JXAP+iVwD/' +
  'olcA/6JXAP+iVwD/olcA/6JXAP+iVwD/olcA/6JXAP+iVwD/olcA/6JXAP/RcQD/1HIA/9RyAP/RcQD/olcA/6JXAP+iVwD/olcA/6JXAP+lWwX/sGoZ/69p' +
  'GP+lWgT/olcA/6JXAP+iVwD/olcA/6JXAP+iVwD/olcA/6JXAP+iVwD/olcA/6JXAP+kWQL/o1gC/6JXAP+iVwD/olcA/6JXAP+iVwD/olcA/9FxAP/UcgD/' +
  '1HIA/9FxAP+iVwD/olcA/6JXAP+nXgn/u3ks/7ZyJP+pYQ3/qmIO/7ZzJf+7eSz/plwH/6JXAP+iVwD/olcA/6JXAP+iVwD/olcA/6NYAv+3dCX/uHUn/7Vx' +
  'Iv+1ciP/uHUn/7ZyI/+jWAH/olcA/6JXAP+iVwD/0XEA/9RyAP/UcgD/0XEA/6JXAP+iVwD/qF8K/7p4LP+gVgH/h0kA/3lBAP95QQD/iUoA/6FXAf+7ei7/' +
  'plwH/6JXAP+iVwD/olcA/6JXAP+kWQP/vHou/6VbBv+OTQD/gEUA/4BFAP+QTQD/pl0I/7t5Lv+jWAL/olcA/6JXAP/RcQD/1HIA/9RyAP/RcQD/olcA/6JX' +
  'AP+7ei3/n1UB/3Q/AP9qOQD/ajkA/2o5AP9qOQD/dkAA/6FXAf+7eS3/olcA/6JXAP+iVwD/olcA/7l3Kv+iWAP/eUIA/2o5AP9qOQD/ajkA/2o5AP98QwD/' +
  'pFoF/7h1KP+iVwD/olcA/9FxAP/UcgD/1HIA/9FxAP+iVwD/qWAL/7NuHv+ERwD/ajkA/2o5AP9qOQD/ajkA/2o5AP9qOQD/h0kA/7ZyJP+mXAb/olcA/6JX' +
  'AP+mXAb/tXEi/4dJAP9qOQD/ajkA/2o5AP9qOQD/ajkA/2o5AP+KSgD/t3Qm/6RZA/+iVwD/0XEA/9RyAP/UcgD/0XEA/6JXAP+1ciL/pFoD/3M+AP9qOQD/' +
  'ajkA/2o5AP9qOQD/ajkA/2o5AP92QAD/qF8K/7JtHP+iVwD/olcA/7RvIP+mXAb/dD8A/2o5AP9qOQD/ajkA/2o5AP9qOQD/ajkA/3hBAP+qYQ3/sGoY/6JX' +
  'AP/RcQD/1HIA/9RyAP/RcQD/olcA/7ZyI/+kWQL/cj0A/2o5AP9qOQD/ajkA/2o5AP9qOQD/ajkA/3U/AP+nXQj/w4Q7/7h1J/+4dSf/xYY+/6NYAf9wPQD/' +
  'ajkA/2o5AP9qOQD/ajkA/2o5AP9qOQD/dD8A/6VbBv+zbh7/olcA/9FxAP/UcgD/1HIA/9FxAP+iVwD/qmIO/7FsG/9/RAD/ajkA/2o5AP9qOQD/ajkA/2o5' +
  'AP9qOQD/g0YA/7RwIf+nXQj/olcA/6JXAP+tZhT/rWYT/3xDAP9qOQD/ajkA/2o5AP9qOQD/ajkA/2o5AP+ARQD/sWsb/6lgDP+iVwD/0XEA/9RyAP/UcgD/' +
  '0XEA/6JXAP+iVwD/u3kt/5tUAP9vPAD/ajkA/2o5AP9qOQD/ajkA/3A8AP+dVAD/u3kt/6JXAP+iVwD/olcA/6JXAP+6dyr/mFIA/2w6AP9qOQD/ajkA/2o5' +
  'AP9qOQD/bTsA/5pTAP+5dyr/olcA/6JXAP/RcQD/1HIA/9RyAP/RcQD/olcA/6JXAP+qYg//t3Mm/5pTAP99QwD/bjsA/287AP9+RAD/nFQA/7l2Kf+oYAv/' +
  'olcA/6JXAP+iVwD/olcA/69oF/+wahn/llEA/3Y/AP9qOQD/azkA/3dAAP+YUgD/sm0d/61mE/+iVwD/olcA/9FxAP/UcgD/1HIA/9FxAP+iVwD/olcA/6JX' +
  'AP+qYg//u3kt/7FrGv+jWAL/o1kC/7JsHP+7ei3/qWAM/6JXAP+iVwD/olcA/6JXAP+iVwD/olcA/7BqGf+5dij/pVsG/59WAP+fVgD/pl0H/7l3Kv+vaBb/' +
  'olcA/6JXAP+iVwD/0XEA/9RyAP/UcgD/0XEA/6JXAP+iVwD/olcA/6JXAP+iVwD/q2MP/718MP/AfzP/qmEN/6JXAP+iVwD/olcA/6JXAP+iVwD/olcA/6JX' +
  'AP+iVwD/olcA/6RZA/+1cSH/vHsv/7x5K/+0cCD/o1kC/6JXAP+iVwD/olcA/6JXAP/RcQD/1HIA/9RyAP/RcQD/olcA/6JXAP+iVwD/olcA/6JXAP+iVwD/' +
  'rGQR/7BpF/+iVwD/olcA/6JXAP+iVwD/olcA/6JXAP+iVwD/olcA/6JXAP+iVwD/olcA/6JXAP+vaRj/rWQQ/6JXAP+iVwD/olcA/6JXAP+iVwD/olcA/9Fx' +
  'AP/UcgD/1HIA/9FxAP+iVwD/olcA/6JXAP+iVwD/olcA/6JXAP+sZBH/sGkX/6JXAP+iVwD/olcA/6JXAP+iVwD/olcA/6JXAP+iVwD/olcA/6JXAP+iVwD/' +
  'olcA/69pGP+tZBD/olcA/6JXAP+iVwD/olcA/6JXAP+iVwD/0XEA/9RyAP/UcgD/0XEA/6JXAP+iVwD/olcA/6JXAP+iVwD/o1gA/7FrGv+0bx7/olcA/6JX' +
  'AP+iVwD/olcA/6JXAP+iVwD/olcA/6JXAP+iVwD/olcA/6JXAP+jWAD/tG8g/7FqGP+iVwD/olcA/6JXAP+iVwD/olcA/6JXAP/RcQD/1HIA/9RyAP/RcQD/' +
  'olcA/6JXAP+iVwD/pFoE/7l2Kf+4dSf/sWsa/7FrG/+4dSf/uHUo/6NZAv+iVwD/olcA/6JXAP+iVwD/olcA/6JXAP+kWgT/uXYp/7h1J/+xaxr/sWwb/7h1' +
  'J/+4dSf/o1kC/6JXAP+iVwD/olcA/9FxAP/UcgD/1HIA/9FxAP+iVwD/olcA/6VbBf+7eS7/o1kD/4xLAP99QwD/fEMA/4tLAP+jWgT/u3ou/6RaA/+iVwD/' +
  'olcA/6JXAP+iVwD/pVsG/7t6Lf+iWAP/iksA/3xDAP99QwD/jUwA/6RaBP+7ey7/pFoD/6JXAP+iVwD/0XEA/9RyAP/UcgD/0XEA/6JXAP+iVwD/ungr/6FY' +
  'Af95QQD/ajkA/2o5AP9qOQD/ajkA/3ZAAP+hWAP/uXcq/6JXAP+iVwD/olcA/6JXAP+6eCv/oFcB/3U/AP9qOQD/ajkA/2o5AP9qOQD/ekIA/6NZA/+5din/' +
  'olcA/6JXAP/RcQD/1HIA/9RyAP/RcQD/olcA/6ddCP+0cCD/iUoA/2o5AP9qOQD/ajkA/2o5AP9qOQD/ajkA/4VIAP+3cyX/pFoE/6JXAP+iVwD/p10I/7Rv' +
  'IP+DRwD/ajkA/2o5AP9qOQD/ajkA/2o5AP9qOQD/i0sA/7dzJf+kWgT/olcA/9FxAP/UcgD/1HIA/9FxAP+iVwD/tHAg/6VbBf93QAD/ajkA/2o5AP9qOQD/' +
  'ajkA/2o5AP9qOQD/cz4A/6lgC/+xaxr/olcA/6JXAP+0cCH/pVsF/3I9AP9qOQD/ajkA/2o5AP9qOQD/ajkA/2o5AP95QQD/qWAL/7BqGf+iVwD/0XEA/9Ry' +
  'AP/UcgD/0XEA/6JXAP+1cSP/o1gB/3Q/AP9qOQD/ajkA/2o5AP9qOQD/ajkA/2o5AP9xPQD/pVwG/7NuHv+iVwD/olcA/7VyI/+jWAH/bzwA/2o5AP9qOQD/' +
  'ajkA/2o5AP9qOQD/ajkA/3ZAAP+mXAf/s24e/6JXAP/RcQD/1HIA/9RyAP/RcQD/olcA/6xkEf+vaBb/gUYA/2o5AP9qOQD/ajkA/2o5AP9qOQD/ajkA/35E' +
  'AP+ybR3/qF8K/6JXAP+iVwD/rGQR/65oFv98QwD/ajkA/2o5AP9qOQD/ajkA/2o5AP9qOQD/g0cA/7NtHf+oXwr/olcA/9FxAP/UcgD/1HIA/9FxAP+iVwD/' +
  'olcA/7p3Kv+cVAD/bzwA/2o5AP9qOQD/ajkA/2o5AP9tOwD/mlMA/7p3K/+iVwD/olcA/6JXAP+iVwD/ungq/5hSAP9tOwD/ajkA/2o5AP9qOQD/ajkA/3A8' +
  'AP+dVAD/ungq/6JXAP+iVwD/0XEA/9RyAP/UcgD/0XEA/6JXAP+iVwD/rWYT/7JuHv+aUwD/e0IA/2w6AP9rOgD/eUEA/5hSAP+0cCH/q2MQ/6JXAP+iVwD/' +
  'olcA/6JXAP+tZhP/sm4d/5dRAP94QQD/azoA/2w6AP98QwD/m1MA/7RwIf+rYxD/olcA/6JXAP/RcQD/1HIA/9RyAP/RcQD/olcA/6JXAP+iVwD/rmcV/7p3' +
  'K/+pYAz/olcA/6JXAP+qYg//ungr/6xlEv+iVwD/olcA/6JXAP+iVwD/olcA/6JXAP+tZxX/uncq/6lgDP+iVwD/olcA/6piD/+6eCv/rGQS/6JXAP+iVwD/' +
  'olcA/9FxAP/UcgD/1HIA/9FxAP+iVwD/olcA/6JXAP+iVwD/o1gB/7FsG/+2ciT/tnIk/7BqGf+iVwH/olcA/6JXAP+iVwD/olcA/6JXAP+iVwD/olcA/6JX' +
  'AP+jWAH/sWwb/7ZyJP+2ciT/sGoZ/6JXAP+iVwD/olcA/6JXAP+iVwD/0XEA/9RyAP/UcgD/0XEA/6JXAP+iVwD/olcA/6JXAP+iVwD/olcA/6JXAP+iVwD/' +
  'olcA/6JXAP+iVwD/olcA/6JXAP+iVwD/olcA/6JXAP+iVwD/olcA/6JXAP+iVwD/olcA/6JXAP+iVwD/olcA/6JXAP+iVwD/olcA/6JXAP/RcQD/1HIA/8d5' +
  'Hv/GeR7/qmke/6ppHv+qaR7/qmke/6ppHv+qaR7/qmke/6ppHv+qaR7/qmke/6ppHv+qaR7/qmke/6ppHv+qaR7/qmke/6ppHv+qaR7/qmke/6ppHv+qaR7/' +
  'qmke/6ppHv+qaR7/qmke/6ppHv+qaR7/qmke/8Z5Hv/HeR7/ajkA/2o5AP9qOQD/ajkA/2o5AP9qOQD/ajkA/2o5AP9qOQD/ajkA/2o5AP9qOQD/ajkA/2o5' +
  'AP9qOQD/ajkA/2o5AP9qOQD/ajkA/2o5AP9qOQD/ajkA/2o5AP9qOQD/ajkA/2o5AP9qOQD/ajkA/2o5AP9qOQD/ajkA/2o5AP//fgz//34M//9+DP//fgz/' +
  '/34M//9+DP//fgz//34M//9+DP//fgz//34M//9+DP//fgz//34M//9+DP//fgz//34M//9+DP//fgz//34M//9+DP//fgz//34M//9+DP//fgz//34M//9+' +
  'DP//fgz//34M//9+DP//fgz//34M//ysQ//8qkH//JAn//yQJ//8kCf//JAn//yQJ//8kCf//JAn//yQJ//8kCf//JAn//yQJ//8kCf//JAn//yQJ//8kCf/' +
  '/JAn//yQJ//8kCf//JAn//yQJ//8kCf//JAn//yQJ//8kCf//JAn//yQJ//8kCf//JAn//yqQf/8rEP//607//+qOP//fgz//34M//9+DP//fgz//34M//9+' +
  'DP//fgz//34M//9+DP//fgz//34M//9+DP//fgz//34M//9+DP//fgz//34M//9+DP//fgz//34M//9+DP//fgz//34M//9+DP//fgz//34M//9+DP//fgz/' +
  '/6o4//+tO///rTv//6o4//9+DP//fgz//34M//9+DP//fgz//4ER//+OIv//jSL//4EQ//9+DP//fgz//34M//9+DP//fgz//34M//9+DP//fgz//34M//9+' +
  'DP//fgz//4AO//9/Dv//fgz//34M//9+DP//fgz//34M//9+DP//qjj//607//+tO///qjj//34M//9+DP//fgz//4QU//+bNf//lS3//4YY//+HGf//li7/' +
  '/5s1//+CEv//fgz//34M//9+DP//fgz//34M//9+DP//fw3//5Yu//+XMP//lCv//5Qs//+XMP//lS3//38N//9+DP//fgz//34M//+qOP//rTv//607//+q' +
  'OP//fgz//34M//+EFf//mjT/+30M/9hpB//DXgT/xF4E/9tqB//9fQ3//5w2//+DEv//fgz//34M//9+DP//fgz//4AP//+cNv/+gRH/428I/81jBf/OYwX/' +
  '5XAI//+DE///mzX//38N//9+DP//fgz//6o4//+tO///rTv//6o4//9+DP//fgz//5s1//p8DP+9WgP/rlIB/65SAf+uUgH/rlIB/8BcA//8fQ3//5s1//9+' +
  'DP//fgz//34M//9+DP//mTL//X4O/8ReBP+uUgH/rlIB/65SAf+uUgH/x2AF//6BEf//lzD//34M//9+DP//qjj//607//+tO///qjj//34M//+GFv//kij/' +
  '0mYG/65SAf+uUgH/rlIB/65SAf+uUgH/rlIB/9hpB///lSz//4IS//9+DP//fgz//4IS//+UK//XaQf/rlIB/65SAf+uUgH/rlIB/65SAf+uUgH/3GwI//+W' +
  'L///gA7//34M//+qOP//rTv//607//+qOP//fgz//5Qr//+AD/+7WQP/rlIB/65SAf+uUgH/rlIB/65SAf+uUgH/wFwE//+FFf//kCX//34M//9+DP//kyn/' +
  '/4IR/7xaA/+uUgH/rlIB/65SAf+uUgH/rlIB/65SAf/BXAT//4cY//+NIv//fgz//6o4//+tO///rTv//6o4//9+DP//lSz//4AO/7lYA/+uUgH/rlIB/65S' +
  'Af+uUgH/rlIB/65SAf++WwP//4QU//+lQv//lzD//5cw//+mRf//fw3/uFcC/65SAf+uUgH/rlIB/65SAf+uUgH/rlIB/71aA///ghH//5Io//9+DP//qjj/' +
  '/607//+tO///qjj//34M//+HGf//kCX/zGIF/65SAf+uUgH/rlIB/65SAf+uUgH/rlIB/9FlBv//kyr//4QU//9+DP//fgz//4se//+LHv/IYAT/rlIB/65S' +
  'Af+uUgH/rlIB/65SAf+uUgH/zmMF//+QJf//hhf//34M//+qOP//rTv//607//+qOP//fgz//34M//+bNf/1eQv/tVYC/65SAf+uUgH/rlIB/65SAf+3VwL/' +
  '+HoL//+bNf//fgz//34M//9+DP//fgz//5ky//B2Cv+xVAL/rlIB/65SAf+uUgH/rlIB/7NVAv/0eAv//5oy//9+DP//fgz//6o4//+tO///rTv//6o4//9+' +
  'DP//fgz//4ga//+WLv/0eAv/yWEF/7RVAv+1VgL/zGIF//Z5C///mDL//4UW//9+DP//fgz//34M//9+DP//jSH//48j/+50Cv+/WwP/r1IB/69TAf/BXAT/' +
  '8HYK//+RJv//ix3//34M//9+DP//qjj//607//+tO///qjj//34M//9+DP//fgz//4ga//+bNf//jyT//38O//+ADv//kCb//5s1//+GF///fgz//34M//9+' +
  'DP//fgz//34M//9+DP//jiP//5gx//+CEf/7fAv/+3wL//+DE///mTL//40g//9+DP//fgz//34M//+qOP//rTv//607//+qOP//fgz//34M//9+DP//fgz/' +
  '/34M//+IGv//nTf//6A7//+HGP//fgz//34M//9+DP//fgz//34M//9+DP//fgz//34M//9+DP//gA///5Qr//+dN///mzT//5Mp//9/Dv//fgz//34M//9+' +
  'DP//fgz//6o4//+tO///rTv//6o4//9+DP//fgz//34M//9+DP//fgz//34M//+JG///jiH//34M//9+DP//fgz//34M//9+DP//fgz//34M//9+DP//fgz/' +
  '/34M//9+DP//fgz//44i//+KG///fgz//34M//9+DP//fgz//34M//9+DP//qjj//607//+tO///qjj//34M//9+DP//fgz//34M//9+DP//fgz//4kb//+O' +
  'If//fgz//34M//9+DP//fgz//34M//9+DP//fgz//34M//9+DP//fgz//34M//9+DP//jiL//4ob//9+DP//fgz//34M//9+DP//fgz//34M//+qOP//rTv/' +
  '/607//+qOP//fgz//34M//9+DP//fgz//34M//9/Df//jyT//5Mo//9+DP//fgz//34M//9+DP//fgz//34M//9+DP//fgz//34M//9+DP//fgz//38N//+T' +
  'Kf//jyL//34M//9+DP//fgz//34M//9+DP//fgz//6o4//+tO///rTv//6o4//9+DP//fgz//34M//+AD///mDH//5gw//+PJP//kCX//5gw//+XMP//gA7/' +
  '/34M//9+DP//fgz//34M//9+DP//fgz//4AP//+ZMf//mDD//48k//+QJf//mDD//5cw//+ADv//fgz//34M//9+DP//qjj//607//+tO///qjj//34M//9+' +
  'DP//ghH//5s1//5/D//gbQj/yWEF/8hgBf/ebAj//YAP//+cNv//gA///34M//9+DP//fgz//34M//+CEf//mzb//X4O/9xrCP/IYAX/yWEF/+FtCP/+gBD/' +
  '/5s2//+AD///fgz//34M//+qOP//rTv//607//+qOP//fgz//34M//+aM//9fg3/xF4E/65SAf+uUgH/rlIB/65SAf/AXAP//H4O//+ZMv//fgz//34M//9+' +
  'DP//fgz//5oz//t8Df++WwP/rlIB/65SAf+uUgH/rlIB/8VfBP/+fw///5ky//9+DP//fgz//6o4//+tO///rTv//6o4//9+DP//hBP//5Mp/9pqB/+uUgH/' +
  'rlIB/65SAf+uUgH/rlIB/65SAf/VZwf//5Yt//+BEP//fgz//34M//+EFP//kyn/02YG/65SAf+uUgH/rlIB/65SAf+uUgH/rlIB/91rB///li3//4AP//9+' +
  'DP//qjj//607//+tO///qjj//34M//+TKf//ghH/wVwE/65SAf+uUgH/rlIB/65SAf+uUgH/rlIB/7xZA///hhf//48k//9+DP//fgz//5Mq//+BEP+5WAP/' +
  'rlIB/65SAf+uUgH/rlIB/65SAf+uUgH/w10E//+GF///jyP//34M//+qOP//rTv//607//+qOP//fgz//5Qs//9/Df+9WgP/rlIB/65SAf+uUgH/rlIB/65S' +
  'Af+uUgH/uFcC//+CEv//kif//34M//9+DP//lCz//38N/7ZWAv+uUgH/rlIB/65SAf+uUgH/rlIB/65SAf/AWwT//4IS//+RJ///fgz//6o4//+tO///rTv/' +
  '/6o4//9+DP//iRv//40h/9BkBf+uUgH/rlIB/65SAf+uUgH/rlIB/65SAf/LYgX//5Em//+FFv//fgz//34M//+JHP//jCD/yGAE/65SAf+uUgH/rlIB/65S' +
  'Af+uUgH/rlIB/9JmBv//kSf//4UV//9+DP//qjj//607//+tO///qjj//34M//9+DP//mTL/9nkL/7VWAv+uUgH/rlIB/65SAf+uUgH/s1UC//N3C///mTP/' +
  '/34M//9+DP//fgz//34M//+ZM//xdwr/slQC/65SAf+uUgH/rlIB/65SAf+2VgL/93oL//+aM///fgz//34M//+qOP//rTv//607//+qOP//fgz//34M//+K' +
  'Hv//kSf/83gL/8dfBP+wUwH/sFMB/8ReBP/xdgr//5Mq//+JG///fgz//34M//9+DP//fgz//4se//+RJ//wdgr/w10E/7BTAf+xVAL/yGAE//R4C///kyr/' +
  '/4ga//9+DP//fgz//6o4//+tO///rTv//6o4//9+DP//fgz//34M//+LH///mjP//4YX//9+DP/+fgz//4cZ//+aM///ihz//34M//9+DP//fgz//34M//9+' +
  'DP//fgz//4sf//+aM///hhf//n4M//9+DP//iBn//5oz//+JHP//fgz//34M//9+DP//qjj//607//+tO///qjj//34M//9+DP//fgz//34M//9/Df//kCX/' +
  '/5Ut//+VLf//jiP//34N//9+DP//fgz//34M//9+DP//fgz//34M//9+DP//fgz//38N//+PJf//lS3//5Ut//+OI///fgz//34M//9+DP//fgz//34M//+q' +
  'OP//rTv//607//+qOP//fgz//34M//9+DP//fgz//34M//9+DP//fgz//34M//9+DP//fgz//34M//9+DP//fgz//34M//9+DP//fgz//34M//9+DP//fgz/' +
  '/34M//9+DP//fgz//34M//9+DP//fgz//34M//9+DP//fgz//6o4//+tO//ypkL/8qVA//KKJv/yiib/8oom//KKJv/yiib/8oom//KKJv/yiib/8oom//KK' +
  'Jv/yiib/8oom//KKJv/yiib/8oom//KKJv/yiib/8oom//KKJv/yiib/8oom//KKJv/yiib/8oom//KKJv/yiib/8oom//KKJv/ypUD/8qZC/65SAf+uUgH/' +
  'rlIB/65SAf+uUgH/rlIB/65SAf+uUgH/rlIB/65SAf+uUgH/rlIB/65SAf+uUgH/rlIB/65SAf+uUgH/rlIB/65SAf+uUgH/rlIB/65SAf+uUgH/rlIB/65S' +
  'Af+uUgH/rlIB/65SAf+uUgH/rlIB/65SAf+uUgH/UlBV/1JQVf9SUFX/UlBV/1JQVf9SUFX/UlBV/1JQVf9SUFX/UlBV/1JQVf9SUFX/UlBV/1JQVf9SUFX/' +
  'UlBV/1JQVf9SUFX/UlBV/1JQVf9SUFX/UlBV/1JQVf9SUFX/UlBV/1JQVf9SUFX/UlBV/1JQVf9SUFX/UlBV/1JQVf93dXr/d3V6/2hma/9oZmv/aGZr/2hm' +
  'a/9oZmv/aGZr/2hma/9oZmv/aGZr/2hma/9oZmv/aGZr/2hma/9oZmv/aGZr/2hma/9oZmv/aGZr/2hma/9oZmv/aGZr/2hma/9oZmv/aGZr/2hma/9oZmv/' +
  'aGZr/2hma/93dXr/d3V6/2tpbv9qaG3/UlBV/1JQVf9SUFX/UlBV/1JQVf9SUFX/UlBV/1JQVf9SUFX/UlBV/1JQVf9SUFX/UlBV/1JQVf9SUFX/UlBV/1JQ' +
  'Vf9SUFX/UlBV/1JQVf9SUFX/UlBV/1JQVf9SUFX/UlBV/1JQVf9SUFX/UlBV/2pobf9raW7/a2lu/2pobf9SUFX/UlBV/1JQVf9SUFX/UlBV/1ZUWf9lY2j/' +
  'ZWNo/1VTWP9SUFX/UlBV/1JQVf9SUFX/UlBV/1JQVf9SUFX/UlBV/1JQVf9SUFX/UlBV/1RSV/9TUVb/UlBV/1JQVf9SUFX/UlBV/1JQVf9SUFX/amht/2tp' +
  'bv9raW7/amht/1JQVf9SUFX/UlBV/1lXXP91c3j/bmxx/1xaX/9dW2D/b21y/3Ryd/9XVVr/UlBV/1JQVf9SUFX/UlBV/1JQVf9SUFX/U1FW/29tcv9wbnP/' +
  'bWtw/21rcP9xb3T/bWtw/1NRVv9SUFX/UlBV/1JQVf9qaG3/a2lu/2tpbv9qaG3/UlBV/1JQVf9aWF3/dHJ3/1FPVP9FQ0j/PjxB/z48Qf9FQ0j/UlBV/3Z0' +
  'ef9XVVr/UlBV/1JQVf9SUFX/UlBV/1VTWP92dHn/V1Va/0hGS/9BP0T/QT9E/0lHTP9YVlv/dXN4/1NRVv9SUFX/UlBV/2pobf9raW7/a2lu/2pobf9SUFX/' +
  'UlBV/3VzeP9RT1T/Ozk+/zY0Of82NDn/NjQ5/zY0Of89O0D/UlBV/3VzeP9SUFX/UlBV/1JQVf9SUFX/cnB1/1RSV/8+PEH/NjQ5/zY0Of82NDn/NjQ5/z89' +
  'Qv9WVFn/cW90/1JQVf9SUFX/amht/2tpbv9raW7/amht/1JQVf9bWV7/amht/0NBRv82NDn/NjQ5/zY0Of82NDn/NjQ5/zY0Of9FQ0j/bWtw/1dVWv9SUFX/' +
  'UlBV/1dVWv9sam//RUNI/zY0Of82NDn/NjQ5/zY0Of82NDn/NjQ5/0ZESf9wbnP/VFJX/1JQVf9qaG3/a2lu/2tpbv9qaG3/UlBV/21rcP9VU1j/Ojg9/zY0' +
  'Of82NDn/NjQ5/zY0Of82NDn/NjQ5/zw6P/9aWF3/aGZr/1JQVf9SUFX/amht/1dVWv87OT7/NjQ5/zY0Of82NDn/NjQ5/zY0Of82NDn/PTtA/1xaX/9lY2j/' +
  'UlBV/2pobf9raW7/a2lu/2pobf9SUFX/bWtw/1RSV/86OD3/NjQ5/zY0Of82NDn/NjQ5/zY0Of82NDn/PDo//1hWW/+AfoP/cG5z/3Buc/+CgIX/U1FW/zo4' +
  'Pf82NDn/NjQ5/zY0Of82NDn/NjQ5/zY0Of88Oj//VlRZ/2pobf9SUFX/amht/2tpbv9raW7/amht/1JQVf9dW2D/Z2Vq/0E/RP82NDn/NjQ5/zY0Of82NDn/' +
  'NjQ5/zY0Of9DQUb/a2lu/1lXXP9SUFX/UlBV/2FfZP9hX2T/QD5D/zY0Of82NDn/NjQ5/zY0Of82NDn/NjQ5/0E/RP9nZWr/W1le/1JQVf9qaG3/a2lu/2tp' +
  'bv9qaG3/UlBV/1JQVf91c3j/T01S/zk3PP82NDn/NjQ5/zY0Of82NDn/OTc8/1BOU/91c3j/UlBV/1JQVf9SUFX/UlBV/3Jwdf9NS1D/NzU6/zY0Of82NDn/' +
  'NjQ5/zY0Of84Njv/T01S/3Nxdv9SUFX/UlBV/2pobf9raW7/a2lu/2pobf9SUFX/UlBV/15cYf9vbXL/TkxR/0A+Q/84Njv/ODY7/0E/RP9PTVL/cnB1/1tZ' +
  'Xv9SUFX/UlBV/1JQVf9SUFX/ZGJn/2VjaP9MSk//PDo//zY0Of82NDn/PTtA/01LUP9pZ2z/YV9k/1JQVf9SUFX/amht/2tpbv9raW7/amht/1JQVf9SUFX/' +
  'UlBV/15cYf91c3j/ZmRp/1NRVv9UUlf/aGZr/3VzeP9cWl//UlBV/1JQVf9SUFX/UlBV/1JQVf9SUFX/ZmRp/3FvdP9XVVr/UU9U/1FPVP9YVlv/cnB1/2Nh' +
  'Zv9SUFX/UlBV/1JQVf9qaG3/a2lu/2tpbv9qaG3/UlBV/1JQVf9SUFX/UlBV/1JQVf9eXGH/d3V6/3p4ff9dW2D/UlBV/1JQVf9SUFX/UlBV/1JQVf9SUFX/' +
  'UlBV/1JQVf9SUFX/VFJX/2xqb/92dHn/dHJ3/2tpbv9UUlf/UlBV/1JQVf9SUFX/UlBV/2pobf9raW7/a2lu/2pobf9SUFX/UlBV/1JQVf9SUFX/UlBV/1JQ' +
  'Vf9fXWL/ZGJn/1JQVf9SUFX/UlBV/1JQVf9SUFX/UlBV/1JQVf9SUFX/UlBV/1JQVf9SUFX/UlBV/2RiZ/9fXWL/UlBV/1JQVf9SUFX/UlBV/1JQVf9SUFX/' +
  'amht/2tpbv9raW7/amht/1JQVf9SUFX/UlBV/1JQVf9SUFX/UlBV/19dYv9kYmf/UlBV/1JQVf9SUFX/UlBV/1JQVf9SUFX/UlBV/1JQVf9SUFX/UlBV/1JQ' +
  'Vf9SUFX/ZGJn/19dYv9SUFX/UlBV/1JQVf9SUFX/UlBV/1JQVf9qaG3/a2lu/2tpbv9qaG3/UlBV/1JQVf9SUFX/UlBV/1JQVf9TUVb/ZmRp/2pobf9SUFX/' +
  'UlBV/1JQVf9SUFX/UlBV/1JQVf9SUFX/UlBV/1JQVf9SUFX/UlBV/1NRVv9qaG3/ZWNo/1JQVf9SUFX/UlBV/1JQVf9SUFX/UlBV/2pobf9raW7/a2lu/2po' +
  'bf9SUFX/UlBV/1JQVf9VU1j/cW90/3Buc/9mZGn/Z2Vq/3FvdP9xb3T/VFJX/1JQVf9SUFX/UlBV/1JQVf9SUFX/UlBV/1VTWP9xb3T/cG5z/2Zkaf9nZWr/' +
  'cW90/3FvdP9UUlf/UlBV/1JQVf9SUFX/amht/2tpbv9raW7/amht/1JQVf9SUFX/VlRZ/3VzeP9UUlf/SEZL/z89Qv8/PUL/R0VK/1VTWP92dHn/VVNY/1JQ' +
  'Vf9SUFX/UlBV/1JQVf9WVFn/dXN4/1NRVv9GREn/Pz1C/z89Qv9IRkv/VVNY/3Z0ef9VU1j/UlBV/1JQVf9qaG3/a2lu/2tpbv9qaG3/UlBV/1JQVf9zcXb/' +
  'U1FW/z48Qf82NDn/NjQ5/zY0Of82NDn/PTtA/1NRVv9ycHX/UlBV/1JQVf9SUFX/UlBV/3Nxdv9SUFX/PDo//zY0Of82NDn/NjQ5/zY0Of8+PEH/VFJX/3Jw' +
  'df9SUFX/UlBV/2pobf9raW7/a2lu/2pobf9SUFX/WFZb/2tpbv9GREn/NjQ5/zY0Of82NDn/NjQ5/zY0Of82NDn/REJH/29tcv9VU1j/UlBV/1JQVf9ZV1z/' +
  'a2lu/0NBRv82NDn/NjQ5/zY0Of82NDn/NjQ5/zY0Of9HRUr/b21y/1VTWP9SUFX/amht/2tpbv9raW7/amht/1JQVf9raW7/VlRZ/z07QP82NDn/NjQ5/zY0' +
  'Of82NDn/NjQ5/zY0Of87OT7/W1le/2Zkaf9SUFX/UlBV/2tpbv9WVFn/Ojg9/zY0Of82NDn/NjQ5/zY0Of82NDn/NjQ5/z07QP9bWV7/ZmRp/1JQVf9qaG3/' +
  'a2lu/2tpbv9qaG3/UlBV/21rcP9TUVb/PDo//zY0Of82NDn/NjQ5/zY0Of82NDn/NjQ5/zo4Pf9XVVr/amht/1JQVf9SUFX/bWtw/1NRVv85Nzz/NjQ5/zY0' +
  'Of82NDn/NjQ5/zY0Of82NDn/PDo//1dVWv9pZ2z/UlBV/2pobf9raW7/a2lu/2pobf9SUFX/X11i/2NhZv9CQEX/NjQ5/zY0Of82NDn/NjQ5/zY0Of82NDn/' +
  'QD5D/2hma/9aWF3/UlBV/1JQVf9gXmP/Y2Fm/z89Qv82NDn/NjQ5/zY0Of82NDn/NjQ5/zY0Of9DQUb/aWds/1pYXf9SUFX/amht/2tpbv9raW7/amht/1JQ' +
  'Vf9SUFX/c3F2/09NUv85Nzz/NjQ5/zY0Of82NDn/NjQ5/zg2O/9OTFH/c3F2/1JQVf9SUFX/UlBV/1JQVf9zcXb/TUtQ/zg2O/82NDn/NjQ5/zY0Of82NDn/' +
  'OTc8/1BOU/9zcXb/UlBV/1JQVf9qaG3/a2lu/2tpbv9qaG3/UlBV/1JQVf9hX2T/aWds/05MUf8+PEH/NzU6/zc1Ov8+PEH/TUtQ/2xqb/9eXGH/UlBV/1JQ' +
  'Vf9SUFX/UlBV/2FfZP9pZ2z/TUtQ/z48Qf83NTr/NzU6/z89Qv9PTVL/bGpv/15cYf9SUFX/UlBV/2pobf9raW7/a2lu/2pobf9SUFX/UlBV/1JQVf9iYGX/' +
  'c3F2/1xaX/9SUFX/UlBV/11bYP9zcXb/YF5j/1JQVf9SUFX/UlBV/1JQVf9SUFX/UlBV/2JgZf9zcXb/XFpf/1JQVf9SUFX/XVtg/3Nxdv9gXmP/UlBV/1JQ' +
  'Vf9SUFX/amht/2tpbv9raW7/amht/1JQVf9SUFX/UlBV/1JQVf9TUVb/Z2Vq/25scf9ubHH/ZmRp/1JQVf9SUFX/UlBV/1JQVf9SUFX/UlBV/1JQVf9SUFX/' +
  'UlBV/1NRVv9nZWr/bmxx/25scf9lY2j/UlBV/1JQVf9SUFX/UlBV/1JQVf9qaG3/a2lu/2tpbv9qaG3/UlBV/1JQVf9SUFX/UlBV/1JQVf9SUFX/UlBV/1JQ' +
  'Vf9SUFX/UlBV/1JQVf9SUFX/UlBV/1JQVf9SUFX/UlBV/1JQVf9SUFX/UlBV/1JQVf9SUFX/UlBV/1JQVf9SUFX/UlBV/1JQVf9SUFX/UlBV/2pobf9raW7/' +
  'dHJ3/3Nxdv9lY2j/ZWNo/2VjaP9lY2j/ZWNo/2VjaP9lY2j/ZWNo/2VjaP9lY2j/ZWNo/2VjaP9lY2j/ZWNo/2VjaP9lY2j/ZWNo/2VjaP9lY2j/ZWNo/2Vj' +
  'aP9lY2j/ZWNo/2VjaP9lY2j/ZWNo/2VjaP9lY2j/c3F2/3Ryd/82NDn/NjQ5/zY0Of82NDn/NjQ5/zY0Of82NDn/NjQ5/zY0Of82NDn/NjQ5/zY0Of82NDn/' +
  'NjQ5/zY0Of82NDn/NjQ5/zY0Of82NDn/NjQ5/zY0Of82NDn/NjQ5/zY0Of82NDn/NjQ5/zY0Of82NDn/NjQ5/zY0Of82NDn/NjQ5/5uZnv+bmZ7/m5me/5uZ' +
  'nv+bmZ7/m5me/5uZnv+bmZ7/m5me/5uZnv+bmZ7/m5me/5uZnv+bmZ7/m5me/5uZnv+bmZ7/m5me/5uZnv+bmZ7/m5me/5uZnv+bmZ7/m5me/5uZnv+bmZ7/' +
  'm5me/5uZnv+bmZ7/m5me/5uZnv+bmZ7/xcPI/8TCx/+qqK3/qqit/6qorf+qqK3/qqit/6qorf+qqK3/qqit/6qorf+qqK3/qqit/6qorf+qqK3/qqit/6qo' +
  'rf+qqK3/qqit/6qorf+qqK3/qqit/6qorf+qqK3/qqit/6qorf+qqK3/qqit/6qorf+qqK3/xMLH/8XDyP/Jx8z/xsTJ/5uZnv+bmZ7/m5me/5uZnv+bmZ7/' +
  'm5me/5uZnv+bmZ7/m5me/5uZnv+bmZ7/m5me/5uZnv+bmZ7/m5me/5uZnv+bmZ7/m5me/5uZnv+bmZ7/m5me/5uZnv+bmZ7/m5me/5uZnv+bmZ7/m5me/5uZ' +
  'nv/GxMn/ycfM/8nHzP/GxMn/m5me/5uZnv+bmZ7/m5me/5uZnv+enKH/qaes/6mnrP+enKH/m5me/5uZnv+bmZ7/m5me/5uZnv+bmZ7/m5me/5uZnv+bmZ7/' +
  'm5me/5uZnv+dm6D/nJqf/5uZnv+bmZ7/m5me/5uZnv+bmZ7/m5me/8bEyf/Jx8z/ycfM/8bEyf+bmZ7/m5me/5uZnv+gnqP/tLK3/6+tsv+ioKX/o6Gm/7Cu' +
  's/+0srf/n52i/5uZnv+bmZ7/m5me/5uZnv+bmZ7/m5me/5yan/+xr7T/sa+0/6+tsv+vrbL/sa+0/6+tsv+cmp//m5me/5uZnv+bmZ7/xsTJ/8nHzP/Jx8z/' +
  'xsTJ/5uZnv+bmZ7/oZ+k/7Oxtv+Zl5z/gX+E/3Nxdv90cnf/goCF/5qYnf+1s7j/n52i/5uZnv+bmZ7/m5me/5uZnv+dm6D/tbO4/56cof+Ihov/enh9/3p4' +
  'ff+KiI3/n52i/7Syt/+cmp//m5me/5uZnv/GxMn/ycfM/8nHzP/GxMn/m5me/5uZnv+1s7j/mJab/29tcv9lY2j/ZWNo/2VjaP9lY2j/cW90/5qYnf+0srf/' +
  'm5me/5uZnv+bmZ7/m5me/7Oxtv+bmZ7/dHJ3/2VjaP9lY2j/ZWNo/2VjaP92dHn/nZug/7GvtP+bmZ7/m5me/8bEyf/Jx8z/ycfM/8bEyf+bmZ7/oqCl/6yq' +
  'r/99e4D/ZWNo/2VjaP9lY2j/ZWNo/2VjaP9lY2j/gX+E/6+tsv+fnaL/m5me/5uZnv+fnaL/r62y/4F/hP9lY2j/ZWNo/2VjaP9lY2j/ZWNo/2VjaP+Egof/' +
  'sa+0/52boP+bmZ7/xsTJ/8nHzP/Jx8z/xsTJ/5uZnv+urLH/nZug/21rcP9lY2j/ZWNo/2VjaP9lY2j/ZWNo/2VjaP9xb3T/oZ+k/6uprv+bmZ7/m5me/62r' +
  'sP+fnaL/b21y/2VjaP9lY2j/ZWNo/2VjaP9lY2j/ZWNo/3Jwdf+joab/qaes/5uZnv/GxMn/ycfM/8nHzP/GxMn/m5me/6+tsv+dm6D/bGpv/2VjaP9lY2j/' +
  'ZWNo/2VjaP9lY2j/ZWNo/3Buc/+gnqP/vLq//7GvtP+xr7T/vrzB/5yan/9raW7/ZWNo/2VjaP9lY2j/ZWNo/2VjaP9lY2j/b21y/56cof+sqq//m5me/8bE' +
  'yf/Jx8z/ycfM/8bEyf+bmZ7/o6Gm/6uprv95d3z/ZWNo/2VjaP9lY2j/ZWNo/2VjaP9lY2j/fXuA/66ssf+gnqP/m5me/5uZnv+mpKn/pqSp/3d1ev9lY2j/' +
  'ZWNo/2VjaP9lY2j/ZWNo/2VjaP96eH3/q6mu/6Kgpf+bmZ7/xsTJ/8nHzP/Jx8z/xsTJ/5uZnv+bmZ7/tbO4/5SSl/9qaG3/ZWNo/2VjaP9lY2j/ZWNo/2tp' +
  'bv+WlJn/tLK3/5uZnv+bmZ7/m5me/5uZnv+zsbb/kY+U/2dlav9lY2j/ZWNo/2VjaP9lY2j/aGZr/5SSl/+zsbb/m5me/5uZnv/GxMn/ycfM/8nHzP/GxMn/' +
  'm5me/5uZnv+joab/sK6z/5SSl/93dXr/aWds/2lnbP95d3z/lZOY/7Kwtf+hn6T/m5me/5uZnv+bmZ7/m5me/6imq/+pp6z/j42S/3Buc/9lY2j/ZmRp/3Jw' +
  'df+Rj5T/q6mu/6akqf+bmZ7/m5me/8bEyf/Jx8z/ycfM/8bEyf+bmZ7/m5me/5uZnv+joab/tLK3/6qorf+cmp//nJqf/6uprv+0srf/oqCl/5uZnv+bmZ7/' +
  'm5me/5uZnv+bmZ7/m5me/6mnrP+ysLX/npyh/5iWm/+Ylpv/n52i/7Kwtf+opqv/m5me/5uZnv+bmZ7/xsTJ/8nHzP/Jx8z/xsTJ/5uZnv+bmZ7/m5me/5uZ' +
  'nv+bmZ7/pKKn/7e1uv+5t7z/o6Gm/5uZnv+bmZ7/m5me/5uZnv+bmZ7/m5me/5uZnv+bmZ7/m5me/52boP+urLH/trS5/7WzuP+tq7D/nJqf/5uZnv+bmZ7/' +
  'm5me/5uZnv/GxMn/ycfM/8nHzP/GxMn/m5me/5uZnv+bmZ7/m5me/5uZnv+bmZ7/paOo/6mnrP+bmZ7/m5me/5uZnv+bmZ7/m5me/5uZnv+bmZ7/m5me/5uZ' +
  'nv+bmZ7/m5me/5uZnv+pp6z/pqSp/5uZnv+bmZ7/m5me/5uZnv+bmZ7/m5me/8bEyf/Jx8z/ycfM/8bEyf+bmZ7/m5me/5uZnv+bmZ7/m5me/5uZnv+lo6j/' +
  'qaes/5uZnv+bmZ7/m5me/5uZnv+bmZ7/m5me/5uZnv+bmZ7/m5me/5uZnv+bmZ7/m5me/6mnrP+mpKn/m5me/5uZnv+bmZ7/m5me/5uZnv+bmZ7/xsTJ/8nH' +
  'zP/Jx8z/xsTJ/5uZnv+bmZ7/m5me/5uZnv+bmZ7/nJqf/6qorf+tq7D/m5me/5uZnv+bmZ7/m5me/5uZnv+bmZ7/m5me/5uZnv+bmZ7/m5me/5uZnv+cmp//' +
  'rqyx/6qorf+bmZ7/m5me/5uZnv+bmZ7/m5me/5uZnv/GxMn/ycfM/8nHzP/GxMn/m5me/5uZnv+bmZ7/nZug/7Kwtf+ysLX/qqit/6qorf+ysLX/sa+0/5ya' +
  'n/+bmZ7/m5me/5uZnv+bmZ7/m5me/5uZnv+dm6D/srC1/7Kwtf+qqK3/qqit/7Kwtf+xr7T/nJqf/5uZnv+bmZ7/m5me/8bEyf/Jx8z/ycfM/8bEyf+bmZ7/' +
  'm5me/56cof+1s7j/nJqf/4aEif93dXr/dnR5/4SCh/+cmp//tbO4/52boP+bmZ7/m5me/5uZnv+bmZ7/npyh/7WzuP+bmZ7/hIKH/3Z0ef93dXr/h4WK/52b' +
  'oP+1s7j/nZug/5uZnv+bmZ7/xsTJ/8nHzP/Jx8z/xsTJ/5uZnv+bmZ7/s7G2/5qYnf9zcXb/ZWNo/2VjaP9lY2j/ZWNo/3FvdP+amJ3/srC1/5uZnv+bmZ7/' +
  'm5me/5uZnv+zsbb/mZec/3Buc/9lY2j/ZWNo/2VjaP9lY2j/dXN4/5yan/+ysLX/m5me/5uZnv/GxMn/ycfM/8nHzP/GxMn/m5me/6Ceo/+urLH/g4GG/2Vj' +
  'aP9lY2j/ZWNo/2VjaP9lY2j/ZWNo/399gv+wrrP/nZug/5uZnv+bmZ7/oJ6j/66ssf9+fIH/ZWNo/2VjaP9lY2j/ZWNo/2VjaP9lY2j/hIKH/7Cus/+dm6D/' +
  'm5me/8bEyf/Jx8z/ycfM/8bEyf+bmZ7/rqyx/56cof9xb3T/ZWNo/2VjaP9lY2j/ZWNo/2VjaP9lY2j/bmxx/6Kgpf+qqK3/m5me/5uZnv+urLH/npyh/2xq' +
  'b/9lY2j/ZWNo/2VjaP9lY2j/ZWNo/2VjaP9zcXb/oqCl/6qorf+bmZ7/xsTJ/8nHzP/Jx8z/xsTJ/5uZnv+urLH/nJqf/29tcv9lY2j/ZWNo/2VjaP9lY2j/' +
  'ZWNo/2VjaP9sam//npyh/6yqr/+bmZ7/m5me/6+tsv+cmp//amht/2VjaP9lY2j/ZWNo/2VjaP9lY2j/ZWNo/3FvdP+fnaL/rKqv/5uZnv/GxMn/ycfM/8nH' +
  'zP/GxMn/m5me/6WjqP+opqv/e3l+/2VjaP9lY2j/ZWNo/2VjaP9lY2j/ZWNo/3h2e/+sqq//oZ+k/5uZnv+bmZ7/paOo/6imq/92dHn/ZWNo/2VjaP9lY2j/' +
  'ZWNo/2VjaP9lY2j/fXuA/6yqr/+hn6T/m5me/8bEyf/Jx8z/ycfM/8bEyf+bmZ7/m5me/7Oxtv+Vk5j/amht/2VjaP9lY2j/ZWNo/2VjaP9oZmv/k5GW/7Ox' +
  'tv+bmZ7/m5me/5uZnv+bmZ7/s7G2/5KQlf9oZmv/ZWNo/2VjaP9lY2j/ZWNo/2pobf+WlJn/s7G2/5uZnv+bmZ7/xsTJ/8nHzP/Jx8z/xsTJ/5uZnv+bmZ7/' +
  'pqSp/6yqr/+TkZb/dXN4/2dlav9mZGn/dHJ3/5KQlf+urLH/pKKn/5uZnv+bmZ7/m5me/5uZnv+mpKn/rKqv/5GPlP9zcXb/ZmRp/2dlav92dHn/lJKX/66s' +
  'sf+koqf/m5me/5uZnv/GxMn/ycfM/8nHzP/GxMn/m5me/5uZnv+bmZ7/p6Wq/7Oxtv+ioKX/m5me/5uZnv+joab/s7G2/6WjqP+bmZ7/m5me/5uZnv+bmZ7/' +
  'm5me/5uZnv+npar/s7G2/6Kgpf+bmZ7/m5me/6Ohpv+zsbb/paOo/5uZnv+bmZ7/m5me/8bEyf/Jx8z/ycfM/8bEyf+bmZ7/m5me/5uZnv+bmZ7/nJqf/6qo' +
  'rf+vrbL/r62y/6mnrP+bmZ7/m5me/5uZnv+bmZ7/m5me/5uZnv+bmZ7/m5me/5uZnv+cmp//qqit/6+tsv+vrbL/qaes/5uZnv+bmZ7/m5me/5uZnv+bmZ7/' +
  'xsTJ/8nHzP/Jx8z/xsTJ/5uZnv+bmZ7/m5me/5uZnv+bmZ7/m5me/5uZnv+bmZ7/m5me/5uZnv+bmZ7/m5me/5uZnv+bmZ7/m5me/5uZnv+bmZ7/m5me/5uZ' +
  'nv+bmZ7/m5me/5uZnv+bmZ7/m5me/5uZnv+bmZ7/m5me/5uZnv/GxMn/ycfM/7+9wv+9u8D/o6Gm/6Ohpv+joab/o6Gm/6Ohpv+joab/o6Gm/6Ohpv+joab/' +
  'o6Gm/6Ohpv+joab/o6Gm/6Ohpv+joab/o6Gm/6Ohpv+joab/o6Gm/6Ohpv+joab/o6Gm/6Ohpv+joab/o6Gm/6Ohpv+joab/o6Gm/727wP+/vcL/ZWNo/2Vj' +
  'aP9lY2j/ZWNo/2VjaP9lY2j/ZWNo/2VjaP9lY2j/ZWNo/2VjaP9lY2j/ZWNo/2VjaP9lY2j/ZWNo/2VjaP9lY2j/ZWNo/2VjaP9lY2j/ZWNo/2VjaP9lY2j/' +
  'ZWNo/2VjaP9lY2j/ZWNo/2VjaP9lY2j/ZWNo/2VjaP8dMwr/JD8N/yVADf8kPg3/JkIN/yRADf8lQA3/J0QO/ylHDv8oRg7/JUAN/yM+Df8nRQ7/K0sP/ydF' +
  'Dv8jPw3/Iz4M/yVCDf8kQQ3/IjwM/yVBDf8rSw//KUkO/ydEDv8kPw3/JkMN/ylIDv8nRQ7/JD8N/yQ/Df8qSQ//JkIN/yI7DP8jPgz/Iz0M/yM9DP8hOwz/' +
  'Iz4M/yVADf8nRA7/JkMO/yVADf8nRA7/KkoP/yZEDf8kQA3/JkQN/yhGDv8lQQ3/IjwM/yI7DP8lQA3/KkoP/ytMD/8nRQ7/JkQN/yhHDv8nRQ7/JUIN/yVB' +
  'Df8nRQ7/KUkP/ydFDv8hOQz/JkIN/yhGD/8iPAz/HTIK/xgrCf8ZLQn/HDEK/xwxCv8bLwn/HDEK/yRADf8rTQ//JkQN/yM/DP8lQQ3/KUcO/yZCDv8hOQz/' +
  'IjsM/yhGDv8pSQ7/J0UO/yM9DP8oRw7/KUoO/ydFDv8kPw3/JUIN/ytMD/8rTQ//KEcO/yA3C/8hOgz/KksP/yVCDf8hOwz/Iz4M/yQ/Df8kPw3/JD8N/yVB' +
  'Df8oSA//HzUL/ydEDv8mRA3/KEUO/yZBDf8kPg3/IjwM/yVBDf8nRA7/JUEN/yVCDf8mRA3/IjoM/ydFDv8pSA//JUIN/ydEDv8qSg//KUkO/ylJD/8pSQ7/' +
  'HzcL/xwyCv8kQQ3/JkQN/yZCDf8hOwv/ITkM/yA5C/8hOwz/JkMN/yZEDf8aLgr/JUEN/ydGDv8pSQ7/JUIN/yA5C/8iPQz/K0sP/ytLD/8kPw3/Ij0M/ydF' +
  'Dv8iOwz/JUAN/yZEDf8pSA7/LE0P/ytND/8nRg7/JkUN/ydEDv8gNwv/HDEK/yA5C/8lQg3/KUkO/yVCDf8fNwv/IDkM/yM+DP8kPwz/Iz8N/xgrCf8mQg3/' +
  'JkQN/yVCDf8iPAz/JEAN/ydEDf8nRQ7/J0UO/ydEDf8mQw7/JUEN/x82C/8iOwz/KEYO/y9SEP8uURD/KkoP/ylJDv8mQw3/JUAN/yA4C/8fNgv/Ij0M/yE6' +
  'C/8lQA3/JUEN/yQ/Df8iPQz/Iz0M/yE6DP8hOgv/GSwJ/yVADf8kPw3/IToL/yVADf8rTA//KkkP/yRADf8kQA3/KkkP/ytMD/8lQg3/GzAK/yM8DP8rTQ//' +
  'LU8Q/yxNEP8rTA//KEUO/yZDDf8mQw3/IDgL/yA4DP8nRQ7/IjwM/x83C/8kPw3/K0wP/yhGDv8hOgz/IDkL/yI7DP8YKgn/Iz0N/yA5C/8jPgz/KUkO/ypK' +
  'D/8nRg7/JkMN/yZDDf8nRg7/KUgO/yZEDf8dMwv/Iz4M/ypKD/8qSg//KkoP/ylID/8nRQ7/KEcO/ylJDv8gOAv/HzcM/yZCDv8jPgz/ITsM/yI8DP8oRQ7/' +
  'J0YO/yVADf8gOgv/IToM/xcnCP8fNwv/IjwM/yZEDf8oRw7/JkIO/yZDDf8qSg//KkoP/yVCDf8kPw3/KUcO/yZBDf8jPgz/JkIN/yhGDv8nRQ7/J0UO/ylJ' +
  'D/8rTA//KUgO/x82C/8YKgn/HDEK/x00Cv8bLgr/JEAN/yE6DP8kQA3/KEYO/yZCDf8gNwv/FSQI/yA5DP8jPwz/JkMN/yQ/Df8lQQ3/KUcO/ytLD/8pSA//' +
  'JkMN/yVCDf8qSg//KkkP/yM+Df8fNwv/HTIK/x0zC/8gOAv/IjwM/yI7DP8fNgv/GiwJ/x82C/8jPg3/JkQO/x00Cv8mQg7/ITwM/yA5C/8mQg3/JkIO/yE5' +
  'DP8WJgj/IjwM/yM+DP8hOwz/Iz4M/yZDDf8oSA7/J0UO/yZDDf8pSA7/LU4Q/ylJDv8oRg7/K0sP/yhHDv8kPw3/JT8N/yhGDv8pRw7/JkMN/ydFDv8jPQ3/' +
  'ITkM/ypKD/8mRA3/GSwJ/yVBDf8mQw3/IjwM/yA3C/8hOQz/JUEN/xwxCv8iPAz/IToM/yA6C/8jPgz/JkMN/yVCDf8lQA3/J0UO/y1OEP8uUBD/K0sP/ydF' +
  'Df8mQw3/JkQN/ylID/8nRA7/JUAN/yRADf8mQw7/KUoP/yM+Df8jPw3/K00P/ydFDv8ZKwn/JUAN/yZEDf8kPw3/HzYL/x83C/8nRQ7/HzYL/yVBDf8gOQv/' +
  'IjwM/yM+DP8iPQz/Iz4M/yVCDf8rSw//K0wP/ytLD/8rTA//KEYO/yVBDf8mQw7/K0wP/ypJD/8kPg3/Iz0N/yhFDv8pSQ7/IDgM/yM9Df8nRg7/J0UO/xww' +
  'Cv8mQQ3/Iz0N/yE6C/8jPwz/JD8N/yI8DP8aLQn/J0UN/ydFDv8iPQz/IjsM/yA5C/8iPAz/KUcO/ylJDv8pSA7/KUkO/yhGDv8nRQ7/KUcP/ydFDf8mRA7/' +
  'J0MN/ydEDv8mQg7/JUAN/yVBDv8fNQv/HzcL/yZDDf8oRg7/HTMK/yZCDf8gOgv/IjwM/ylIDv8pSA7/IjwM/xcnCP8mRA7/K0wP/yZEDv8gOAv/IjoM/yVA' +
  'Df8mQQ3/JkQO/yZEDf8nRA7/JkMN/ylHD/8rTA//KEgO/yM/DP8kQA3/KUgO/ylIDv8kPw3/IjwM/x41C/8cMgr/JkIN/yZEDf8bLgr/Iz0M/yVBDf8nRA3/' +
  'J0QO/yZCDv8mQQ3/FicI/xwxCv8gOAv/IDgL/x82C/8dNAr/HjQL/x40C/8eNAr/HzYL/x81C/8hOQz/IjwM/yI8DP8gOAv/IDcL/yA3C/8gOAv/JEAN/yVB' +
  'Df8kPw3/HTIK/x0yCv8jPgz/JD8N/yE6DP8lQQ3/K00P/ypKD/8kQA3/JD8N/yhHDv8oRg7/IjwM/yA3C/8lQA3/LU4Q/yI8DP8fNwv/IjsM/yE6DP8hOgv/' +
  'JD8N/yVCDf8mQw3/JD8N/yZBDv8pSA//KEYP/x81C/8dMgv/JkQO/ydFDv8fNgv/HDIK/yE7DP8fNwv/JD4N/ylJDv8qSg//KEYP/ydEDv8mQw3/J0UO/ydE' +
  'Dv8lQA3/IjwM/yM+DP8pSA//JD8N/yRADf8hOwz/IToL/yM8DP8kPwz/JUIN/yM+DP8lQA3/KUcO/ypJD/8nRg7/ITkM/x40C/8mQQ7/KUcP/yQ/Df8bMAr/' +
  'HjYL/yE6DP8lQA3/KEYO/ydEDv8nRQ7/K0sP/ypLD/8lQg3/JD4N/ydDDv8rSw//JUIN/yM9DP8gNwv/JUEN/yVBDf8iOwz/Iz0M/yI9DP8hOgv/Iz0M/yZD' +
  'Df8oRg7/JkIO/yZCDf8jPA3/IDgM/yZCDv8oRg//Iz4N/xsvCf8gOQz/Iz4M/yVADf8jPQ3/JUIN/ypJD/8rTQ//KUkP/yZDDf8lQQ3/KUgP/ytMD/8pSQ//' +
  'JEAN/xsuCf8hOgz/KUkP/yhHDv8iPAz/IDkL/yE6DP8jPQz/JkIN/yM/Df8kPw3/JkIN/yM8Df8iPAz/KksP/ydFDv8gNgv/HTIK/yZDDf8jPgz/IjsM/yI8' +
  'DP8lQA3/KUgP/yhHD/8mQw3/KUgO/y5PEP8pSA7/J0UO/ylIDv8nRQ7/GzAK/x81C/8oRQ7/KkoP/yRADf8hOQv/IjsM/yM9DP8hOgz/IjwM/yQ/Df8mQg3/' +
  'Iz0M/yQ/Df8rTQ//KUcO/x81C/8gOAv/JkQN/yM+DP8iOwv/JT8N/yVADf8kPw3/JUAN/ydFDv8tTxD/L1IQ/ytMD/8nRA3/JUEN/yZDDf8jPAz/IjwM/yI8' +
  'DP8kPw3/J0UO/ydFDv8hOgv/IDgL/yA5C/8hOgz/JT8N/yZCDf8kPw3/IjsM/yhHDv8pSA7/HTQK/xotCf8eMwv/HTIK/xgqCf8lPw3/Iz4N/yI8DP8kPw3/' +
  'KUsP/ytND/8rTA//K00P/yhHDv8kPwz/JUIN/ylJDv8oRg7/IjsM/yE5C/8mRA7/KksP/yRADf8fNwv/IDkL/yE6C/8iPQz/JkMN/yI8DP8bLwr/HzYL/xwx' +
  'Cv8XKQj/HzYL/yVBDf8mQw3/HDEK/yQ+DP8hOwv/Iz0M/yZEDf8mRA3/KEgP/ylJDv8pRw7/KUcO/ylHD/8nRQ3/JkMO/yZADf8mQQ7/Iz0M/yE6C/8kPw3/' +
  'JUEN/yRADf8gOQv/ITsM/yM+DP8kPwz/IDcM/x40C/8iPAz/ITsL/yA4C/8gOQv/KEYO/yZEDf8bLwr/IjsM/yVADf8mQg3/JUIN/yZBDf8lQQ3/JkMO/yZE' +
  'Df8pSA7/K0wP/yhIDv8jPgz/JD4N/ydEDv8nRQ7/ITsM/x83C/8kPw3/J0UO/yZDDf8iPQz/IzwM/yI9DP8eNQv/Gy8K/yA6C/8mQw3/IjwM/yM9DP8rTA//' +
  'J0QO/xktCf8kPw3/KUkO/yhHDv8kPw3/JD8M/yM+Df8iPQz/JkUO/ylJDv8pSQ//J0UN/yZEDv8mQQ3/JkIO/yZBDv8lQA3/IjsM/yA5C/8lQg7/K00P/yhH' +
  'Dv8hOgv/ITkM/xwwCv8ZLQn/JEAN/yZEDf8gOQz/IjsM/ylHD/8mRA3/HDEK/yhHDv8pSQ7/J0UO/yZDDf8jPQz/IjwM/yQ+Df8lQQ3/J0UO/yZCDf8nRA7/' +
  'K0wP/ylJD/8jPg3/Iz0N/yZCDf8mQw3/Iz0M/yI8DP8nRQ7/KkoO/yZDDf8fNgv/Gy4J/xwwCv8kPgz/JkIN/x82C/8gOAz/JUEN/ylHDv8lQg3/IjsM/x82' +
  'C/8fNgr/HTMK/xwxCv8bMQr/HDEK/x0yCv8bLwr/HTMK/yA4C/8iOgz/HzYL/x0zCv8cMQr/HTIK/x82C/8hOQv/HDIK/xouCf8eNAv/HDIK/xouCf8ZKwn/' +
  'HjUL/yM9DP8jPQz/HjQL/yA3C/8nRA7/KksP/y5PEP8sThD/KUkP/yZDDf8mQQ3/JkMN/yZEDf8jPwz/ITsM/yM9DP8mQQ3/KEcO/ydEDv8mQw3/KUcO/ylH' +
  'Dv8mQw3/J0YO/ylJDv8nRQ7/Iz0M/x82C/8iOgz/KUgP/ylHD/8iOwz/IToM/yE7DP8aLQn/IjsM/y1OEP8qSw//KEYP/ypLD/8oRw7/JkIN/yZCDf8mRA3/' +
  'JkMN/yM9DP8hOgz/Iz0M/yVADf8iPAz/JD8N/yZDDf8oRg7/K0oP/yxNEP8mRA3/JkEN/yZDDf8iPAz/HzYL/yE5DP8nRQ7/K0sP/yZEDf8gOAv/HjUL/xkt' +
  'Cf8TIAf/GCkJ/xYnCP8VJAj/FSQI/xQkB/8VJQj/FSUI/xQkB/8TIQf/EyAH/xQiB/8TIAf/Eh8H/xIfBv8SHwf/FCQH/xUkB/8XKQn/GCkJ/xUlCP8UIgf/' +
  'EiAH/xIfBv8TIQf/EyAH/xIgB/8VJQj/FiYI/xEeBv8QHAb/DhkF/wIDAf8CAwH/AgMB/wIDAf8CAwH/AgMB/wIDAf8CAwH/AgMB/wIDAf8CAwH/AgMB/wID' +
  'Af8CAwH/AgMB/wIDAf8CAwH/AgMB/wIDAf8CAwH/AgMB/wIDAf8CAwH/AgMB/wIDAf8CAwH/AgMB/wIDAf8CAwH/AgMB/wIDAf8CAwH/XoIy/3CcOv9xnjr/' +
  'b5w5/3ShO/9xnjr/cZ46/3WiPP95pz3/dqU8/3CdOv9umzn/dqQ8/32qQP92pDz/b5s5/2+aOf90oDv/cZ46/2yYOP9xnTv/fapA/3moPf91ojv/cZ06/3Si' +
  'O/95pz3/dqQ8/2+cOv9wnDr/e6k//26WOP9ojzX/cJs5/22ZOf9tmjj/a5c4/2+aOf9xnTr/dqQ8/3WiPP9xnTr/daI8/3uqP/91ozv/cp46/3WjO/94pT3/' +
  'c546/22XOP9rljj/cJ06/3upP/99q0D/d6Q8/3ajO/94pj3/dqQ8/3OgO/9xnjr/daM8/3qpP/93pT3/Zow1/26WOP93pT3/bJg4/1+HM/9Xey//WH4w/12D' +
  'Mf9cgjH/W4Aw/16EMf9vmjn/fq1A/3ajPP9xnDn/cp86/3mmPf9znzv/aZQ3/2uWOP92pDz/eag9/3akPP9tlzj/d6Q9/3qpPv92ozz/cZw6/3OfO/99rED/' +
  'fq1A/3imPf9kijT/Zow1/3yrP/9zoDv/a5c4/26aOf9wnDr/b5s6/2+cOv9ynjr/eaY9/2KLNP91ojz/daM7/3akPP9ynzr/b5s5/2yYOP9xnTr/dKE8/3Ge' +
  'Ov9ynzr/dqM7/2qUN/92oj3/eac+/3KfOv91ozz/eqk+/3moPf95qD3/eag9/2SJM/9dgTH/cp47/3WjO/9zoDv/bJg3/2qVN/9plDf/a5Y4/3SiO/91ozv/' +
  'Wn8w/3GeOv92pDz/eag9/3KfO/9plTf/bZk5/32qQP99qkD/b5w5/22ZOP91ozz/aZQ3/3CbOv91ozv/eKc9/36tQP99rED/d6U8/3akO/92ozz/ZIo0/1yA' +
  'Mf9plDf/cp86/3moPf9ynzv/ZpI1/2iTNv9wmzn/cJw6/3CcOv9Xei7/c6A7/3WjO/9znzv/bJg4/3CcOv91ozz/dqQ8/3akPP91ozz/c587/3GeOv9jizT/' +
  'apQ3/3elPf+DtEL/grJC/3uqPv95qD3/dKE7/3KfOv9kijT/YYYz/22ZOf9rlzf/cZ46/3GeOv9wnDr/bZg4/22ZOf9rljj/apU4/1d7L/9xnjr/cJw6/2uX' +
  'N/9wnTr/fqtA/3uoP/9ynTr/cp06/3uoP/9+q0D/cp47/1yDMf9rlTj/fq1A/4CwQf9/rUH/fatA/3ekPP91ojv/dKE7/2SKNP9kijX/d6U9/2yYOP9mkTX/' +
  'b5s5/36rQP93pD3/apY4/2mUN/9rlzj/VXku/22ZOf9plDf/b5s5/3moPf97qT7/d6U8/3WhO/90oTv/d6U8/3mnPv91ozv/YYkz/22YOP96qT7/eqk+/3yp' +
  'P/96pz7/d6U9/3imPf95qD3/ZIo0/2KHNP90oTz/cJs5/2uWN/9smDj/dqM9/3elPP9xnjr/apU3/2qVOP9SdC3/Z5A2/2yYOf91ozv/d6Y8/3OgO/90oTv/' +
  'fKk//3ypP/9zoDv/cZ06/3inPf9xnTr/bZk4/3KfO/92pDz/d6Q8/3ekPf97qT//fatA/3imPf9hhzP/U3Mt/12CMf9ghjP/WoEx/3CcOf9qlTj/cJ06/3il' +
  'Pf90oDz/Z5E2/05uK/9pkjb/cZw5/3ShO/9xnDr/cZ46/3emPf98qj//eqg+/3ShO/9znzv/eqk+/3qoPv9tljj/Y4o0/16EMv9ghjP/ZYw1/2mSN/9pkjf/' +
  'Y4o0/1V2Lv9hhzP/bps5/3WjO/9hiTP/c6A7/2yXOP9plDf/cp87/3SgO/9plDf/T3Er/22YOP9vmjn/a5Y4/2+aOf90oTv/eKc9/3WkPP9zoTv/eag9/4Cv' +
  'QP95qD3/d6U8/32qQP94pT3/cJ05/2+cOv92pTz/d6Y9/3OhO/92pTz/aZA2/2aMNf98qj//daM7/1h8L/9xnjr/dKE7/22YOP9nkTb/aZM2/3GdO/9ehTL/' +
  'bJg4/2qVOP9qlTf/b5o5/3WiO/9znzv/cZ06/3WiPP+ArkH/grJB/32qP/92ozz/dKE7/3WjO/95pz7/daI8/3CdOv9wnDr/c6A7/3qpPv9qkTf/a5I3/36t' +
  'QP93pD3/V3sv/3GeOv91ozv/cJ46/2aPNP9mkDX/dqI9/2SMNf9ynzv/aZU3/2yYOP9wmzn/bZk5/2+aOf9znzv/fKo//36rQP98qz//fqtA/3elPf9ynzr/' +
  'dKI7/32rQP97qD//b5s5/22ZOf92pDz/eag9/2OKNP9qkDf/eKU9/3elPf9dhDL/cp86/26aOf9rlzf/b5w5/2+cOf9smDj/WH4v/3akPP92oj3/bZk4/2uW' +
  'OP9plDf/bJg5/3imPf95qD3/eac9/3moPf94pj3/d6U9/3mmPv92pDz/daI7/3WiPP92ozz/c6A7/3GeOv9xnjr/YYYz/2OJNP91ojv/d6U9/2CIM/9zoDv/' +
  'apU3/22ZOf94pz3/eKc9/2yYOP9SdS3/daE8/36rQP90oTz/aZM2/2uVOP9xnjr/cp87/3WjPP91ozv/daM8/3WiO/95pz3/fqtA/3mnPf9xnDn/cp06/3mn' +
  'Pf94pz3/b5s5/2yYOP9ghjP/XYIx/3OgO/91ozv/WoAw/22aOP9xnjr/daM8/3WjPP9znzv/cZ46/1F0LP9ehTL/ZYw1/2aPNf9ljTX/Yogz/2GIM/9iiDP/' +
  'Yogz/2SLNP9jijT/Z481/2qUN/9qkzf/Zo81/2WONf9ljjX/Z481/2+aOf9xnjr/b5w5/12DMf9dgzH/bps4/2+cOv9qlTf/cZ46/36tQP97qj//cZ06/3Gc' +
  'Ov93pT3/dqM8/2uWOP9mjzb/cJs5/3+uQf9qkzf/ZY01/2uVOP9qlDf/aZQ3/2+bOf9ynzr/c587/2+bOf9xnjr/eKY+/3akPf9jizT/X4cy/3SiPP93pT3/' +
  'YYgz/12CMf9qljf/Z5I1/26bOf95qD3/e6o+/3imPv92oz3/daE7/3akPP91ozz/cZ46/22YOP9wmzn/eqg+/26YOf9vmzr/a5Y4/2qVN/9tmTn/cZw6/3Og' +
  'Ov9umzj/cZ46/3mmPf96qD7/d6U8/2mSNv9hijP/cp87/3mnPv9rkTj/W30w/2aQNf9qlTf/cZ46/3elPP92ozz/d6Q9/32rQP98qz//cp86/26bOf91ojz/' +
  'fapA/3OfO/9tmTn/Zo81/3GdO/9ynzv/a5c4/22ZOf9umTn/apU3/26aOf91ojv/eKU9/3ShO/9zoDv/bJc4/2eRNv90oTz/eKY+/2qQOP9afTD/apM2/3Cb' +
  'Of9xnTr/bZk5/3OfO/97qT//fq1A/3qpPv9zoTv/cZ46/3qnPf99q0D/eqg+/3CcOf9agTH/apQ3/3upP/94pT3/bJc4/2mTN/9qlTj/bps5/3ShO/9vmzn/' +
  'cJ06/3ShO/9sljj/a5U4/3yrP/93pD3/Yoc0/16DMv90oTv/cJs5/2yYOP9smDj/cJ06/3mnPv93pT3/c6E7/3moPv+AsEH/eac9/3akPP95pz3/dqQ8/12D' +
  'Mf9jjDX/d6M9/3ypP/9wnTr/aZM3/2uXOP9tmjj/apY4/2yYOP9vnDr/dKE7/22XOP9umTn/faxA/3imPf9hhjP/ZIo0/3WiO/9wnDn/bJg4/3CdOv9xnjr/' +
  'b5w6/3CdOv91ozz/gLBB/4O0Qv99rED/daM8/3OfOv91ojv/bJY4/2uVN/9slzj/cJw6/3alPP92pDz/a5c3/2iTNv9plDf/a5c4/3CdOv9zoDv/bpo5/2mU' +
  'N/94pj3/eKc9/1+EMv9WeC7/X4Uz/16DMv9VeC3/cJ06/2+bOf9smDj/b5w6/3yqPv9+rUD/fKs//36tQP94pj3/cZw6/3OgO/95qD3/d6U9/2uWOP9pkzf/' +
  'daI8/3yrP/9wnDr/ZpI1/2mUN/9rlzf/bpo4/3WiO/9qlTf/W4Ix/2OLNP9dhDH/UXEs/2KIM/9ynzr/dKI7/16FMf9vmzn/a5g3/22aOf91ojv/daM7/3im' +
  'Pf95qD3/eaY9/3mmPf95pj7/dqQ8/3SiO/9xnjr/cp87/26aOf9rlzf/b5s5/3GeOv9wnTr/apU3/2uXOP9wmzn/cJw6/2aQNv9iijT/bJg4/2yYN/9jiTT/' +
  'ZIs0/3ilPf91ozv/XIIx/2uXN/9wnjr/cp87/3KfOv9ynzv/cp86/3SiO/91ozv/eac9/36rQP95pz3/bps4/2+cOf92pD3/d6U9/2qWN/9mkTX/b5w6/3el' +
  'Pf90oTz/bZk4/22YOf9tmTj/Y4s0/1yDMv9qlTf/c6E7/2eONf9pjzf/fqtA/3ajPP9Zfi//b5w5/3moPf93pj3/cZw6/3CcOf9umjn/bZk4/3WiPP95qD3/' +
  'eac+/3akPP90ojv/cp87/3KfO/9ynzv/cZ46/2uXOP9plDf/c6A8/36tQP93pT3/apU3/2mVOP9ehDL/WX8w/3CdOv91ozv/ZYs1/2iNNf95pj7/daM7/16G' +
  'Mv93pTz/eag9/3akPP90ojv/bpo5/2yYOP9vmzr/cp86/3WjPP9ynzr/dKI8/32rQP97qD7/bpo5/22ZOf9zoDv/daI7/26ZOf9smDj/dqM9/3qpPv9zoDv/' +
  'ZY40/1uBMP9dhDH/bps5/3OgO/9hhjP/ZIk0/3KfOv94pj3/cp46/2mSNv9jizT/Y4oz/2CGMv9ehDL/XIEx/12DMf9ehDL/W4Ex/1+GM/9mjjX/aJA2/2OL' +
  'NP9fhjL/XoMy/1+FMv9jijT/Zo81/16EMv9afjD/YIcz/12EMv9ZfS//VXgu/2KLNP9tmTj/bZk5/1+EMv9kijT/daI8/3yrP/+AsEH/gK1B/3qoPv90oTv/' +
  'cp87/3SiO/91ozv/cJs5/2uWOP9umTn/cp87/3emPf90ojv/dKE7/3mmPf94pT3/dKI7/3elPP95qD3/dqQ8/22ZOP9ljzX/apQ3/3mmPv95pj7/a5c4/2qV' +
  'OP9rljf/WHsv/2eONf9/r0H/fKs//3imPv98qj//eKY9/3OhO/9zoTv/daM7/3OhO/9tmjj/apY4/22aOf9wnTr/bZk4/3CdOv90oTv/d6U9/3yqP/9+rUD/' +
  'daM7/3KfO/90ojv/bZk4/2aQNP9plDf/d6M9/3yqP/90oTz/aJM3/2SNNP9Yei//QVck/0xnKv9KZCj/SGIo/0dgJ/9HYSf/SGIn/0hiJ/9HYSf/RF0m/0Nc' +
  'Jf9EXib/Q1wl/0JbJf9CWyX/Qlsl/0ZgJ/9HYSf/TGYq/0xnKv9HYSf/RV4m/0JcJf9CWyX/RF0m/0NcJf9CWyX/R2En/0ljKP9AWCT/PlUj/zlOIf8YHhL/' +
  'GB4S/xgeEv8YHhL/GB4S/xgeEv8YHhL/GB4S/xgeEv8YHhL/GB4S/xgeEv8YHhL/GB4S/xgeEv8YHhL/GB4S/xgeEv8YHhL/GB4S/xgeEv8YHhL/GB4S/xge' +
  'Ev8YHhL/GB4S/xgeEv8YHhL/GB4S/xgeEv8YHhL/GB4S/1ITCf9mGAv/aBgL/2YYC/9rGAv/aBgL/2kYC/9tGgv/cxoM/3EaDP9oGAv/ZhcL/3EaDP96HA3/' +
  'bxkM/2UXC/9lFwr/bRkL/2oYC/9iFgr/ahgL/3ocDf91Ggz/bRkM/2gYC/9uGgv/dBoM/28aDP9mGAv/ZhgL/3UcDP9pGAv/YBYK/2YXCv9iFwr/ZBcK/18W' +
  'Cv9lFwr/aBgL/28aC/9tGQv/aBgL/24ZDP94HA3/cBoL/2kYC/9tGAv/cBoL/2kYC/9hFwr/XxYK/2cYC/93Gw3/exwN/3EaDP9tGAv/cxoM/3EaDP9sGQv/' +
  'aRgL/28aDP92Gw3/cBoL/1wVCv9oGAv/cRoM/2EWCv9QEwn/RhAH/0gRCP9PEgj/ThII/0wRCP9QEgj/ZhcL/3scDf9wGgv/ZxcK/2kYC/9wGgv/ahgL/10W' +
  'Cv9fFgr/cBoM/3QaDP9vGgz/ZBgK/3MaDP92Ggz/bxoM/2cYC/9qGAv/ehwN/3wcDf9yGgz/WRQJ/10WCv94HAz/ahkL/14WCv9jFwr/ZxcL/2UXC/9mFwv/' +
  'ahkL/3QbDP9UFAn/bxoM/3AaC/9wGgz/aRgL/2QXC/9iFgr/aBgL/20ZDP9pGAv/ahgL/20YC/9eFgr/cRoM/3UbDf9qGAv/bxoM/3UbDf90Ggz/dRsN/3Ua' +
  'DP9aFAr/UBIJ/2kZC/9wGgv/axkL/18VCf9dFQr/WxUJ/14WCv9uGgv/cBoL/0oSCP9pGAv/bxoM/3QaDP9pGQv/XBUJ/2IXCv94HAz/eBwM/2cYC/9jFgr/' +
  'bhkM/18WCv9nGAv/cBoL/3UbDP98HA3/exwN/3IaDP9xGgv/bRkM/1kUCf9OEgj/WxUJ/2oYC/91Ggz/aRgL/1kUCf9bFQr/ZhcK/2cYCv9nGAv/RhAH/2sY' +
  'C/9tGAv/aRgL/2IWCv9nGAv/cBoL/3EbDP9xGwz/cBoL/2sZDP9pGAv/VhQK/18WCv9yGwz/hR4O/4IeDv93Gw3/dRoM/2oZC/9nFwr/WhUK/1YUCf9hFgr/' +
  'XhUJ/2gYC/9pGAv/ZxgL/2IWCv9jFwr/XhYK/10WCf9GEQj/aBgL/2UXC/9eFQn/ZxgL/3scDf94HA3/aBgL/2gYC/92HAz/eRwM/2kYC/9NEgj/YRcK/3wc' +
  'Df9/HQ7/fh0O/3scDf9vGQz/bBgL/2wZC/9cFgn/WhUJ/3AaC/9gFgr/WBQJ/2YYC/97HA3/choM/10WCv9bFQn/XxYK/0QQB/9iFwv/WxUJ/2MXCv90Ggz/' +
  'dxsN/3IbDP9uGgv/bhoL/3IbDP9zGgz/bRgL/1MTCf9lGAr/dxwN/3YbDf94Gw3/dBsM/3AaC/9xGgz/dRoM/1sWCv9YFAn/bBkL/2YXCv9eFgr/YhYK/3Aa' +
  'DP9yGwz/aBkL/10VCf9dFgr/Pw8H/1gUCf9fFgr/bRgL/3EaDP9rGQz/bRoL/3ocDf95HA3/bBkL/2cYC/9yGgz/aBgL/2UYCv9qGQv/cBoM/28ZDP9uGgv/' +
  'dhwN/3scDf9yGgz/VxQJ/0QQCP9OEgj/UxMJ/0oRCP9nFwv/XRYK/2cYC/9xGgv/ahkL/1kVCf86Dgf/WxUK/2YXCv9rGAv/ZxgL/2kYC/9yGgz/eBwN/3Ua' +
  'Df9sGAv/ahgL/3YbDf90Gwz/YxcL/1cUCv9REwj/UxQJ/1oVCv9gFgr/XhYK/1YUCf9HEAj/VxQJ/2UXC/9uGQz/UhQJ/2sZDP9fFgr/XBUJ/2gYC/9rGAv/' +
  'XRUK/z0PB/9iFwr/ZRcK/14WCv9lFwr/bhoL/3MaDP9vGgz/axgL/3MaDP9+HQ3/dBsM/3IbDP94HAz/cxsM/2gYC/9nGAv/cBoM/3IaDP9sGAv/bxkM/2EX' +
  'Cv9dFQr/dxsN/20ZC/9HEQj/aRgL/2sYC/9hFgr/WRUJ/10VCv9pGAv/TxMJ/2EWCv9cFgr/XBUJ/2UXCv9vGgv/bBkL/2gYC/9vGgz/fx0N/4IeDf95HA3/' +
  'cBoL/2sZC/9vGgv/dBsM/20ZDP9oGAv/ZxgL/2sZDP91Gwz/YxcK/2UXC/97HA3/cBoL/0YQB/9nGAv/bBgL/2YXC/9XFAn/WBQK/24aDP9WFQn/ahkL/1wV' +
  'Cf9hFgr/ZhcK/2IXCv9lFwr/ahgL/3kcDf97HA3/eRwN/3wcDf9xGgz/ZxcK/20ZC/94HAz/dRwM/2UXC/9jFwv/bhoM/3QaDP9aFQr/YhcK/3AaDP9wGgv/' +
  'ThMJ/2cXCv9iFwr/XhUJ/2QXCv9mFwv/YRYK/0kRCP9xGgv/cBoM/2IWCv9fFgr/XBUJ/2EXCv9yGgz/dBoM/3MaDP90Ggz/choM/3AaC/9zGwz/cRoL/28a' +
  'DP9sGQv/bRkM/2sZDP9oGAv/aBgM/1YUCf9ZFAr/bBgL/3EaDP9SEwn/ahgL/1wVCf9hFgr/cxoM/3MaDP9gFgr/Pw8H/24ZDP98HA3/bRkM/1wVCf9eFgr/' +
  'aBgL/2kZC/9tGQz/bhgL/20ZDP9sGAv/cxoM/3wcDf91Gwz/ZxcK/2gYC/9zGgz/dBoM/2UXC/9hFgr/VRQJ/1ISCf9rGQv/cBoL/0sSCP9kFwr/aBkL/20Z' +
  'C/9uGQz/ahkM/2kYC/8+Dwf/UBII/1oVCv9aFAn/VxQJ/1QTCf9UFAn/VBQJ/1QTCf9VFAn/VBMJ/1sVCv9gFgr/YRcL/1oVCf9ZFQr/WRQJ/1oVCv9mFwv/' +
  'aRgL/2YYC/9TEwn/UhMJ/2UXCv9mGAv/XhYK/2kYC/98HA3/dxwN/2gYC/9nGAv/cRoM/3AaDP9gFwr/WRUJ/2cYC/99Hg3/YBcL/1gUCf9gFgr/XhUK/10V' +
  'Cf9mFwv/ahgL/2sZC/9mGAv/aRgL/3MbDP9wGwz/VhQJ/1ETCf9tGQv/cBoL/1cUCf9REgn/XxYK/1kUCf9kFwv/dRoM/3cbDf9yGwz/bhoL/2wZC/9uGQz/' +
  'bhkM/2gYC/9iFwr/ZhcK/3UbDP9kFwv/ZhgL/10WCv9cFQn/YhcK/2cXCv9qGAv/ZRcK/2gYC/9wGgv/dBsM/3AZDP9cFQr/UhMI/2gYC/9zGwz/ZhcL/00S' +
  'Cf9XFAn/XRUK/2gYC/9wGgz/bhkM/28aC/96HA3/eBwN/2kYC/9lGAv/bRoM/3scDf9rGAv/YhcK/1gVCv9oGQv/aRkL/18WCv9iFwr/YxcK/10WCf9kFwr/' +
  'bBgL/28aC/9pGAv/ahgL/2EWCv9aFQn/ahkL/3IbDP9kFwv/SxII/1wVCv9mFwr/ZxgL/2MXC/9qGAv/dhwM/3ocDf92HA3/bhoL/2gYC/9yGwz/ehwN/3Ua' +
  'Df9mFwv/ShEI/10WCv91HAz/cRoM/2AWCv9cFQn/XRYK/2QXCv9rGAv/ZRcL/2UXCv9qGAv/YBYK/2AXCv94HA3/bxoL/1cVCf9QEwn/axgL/2YXCv9gFgr/' +
  'YhYK/2cYC/9zGwz/cRoM/20aC/92HAz/fx0N/3IaC/9vGQz/cxoM/24ZDP9MEgj/VRQJ/28aDP92HAz/ZxgL/1wVCf9fFgr/YxcK/14WCv9hFgr/ZRcK/2sY' +
  'C/9hFgr/ZRcL/3scDf9xGgz/VhQJ/1sVCf9tGAv/ZhcK/18WCf9lFwr/aBgL/2UYC/9nGAv/bxoM/4AdDv+EHg7/eRwN/24ZC/9pGAv/bBgL/2EWC/9fFgr/' +
  'YBYK/2YXC/9vGQz/bhkL/14VCf9aFQn/WxUJ/14WCf9lFwr/ahkL/2UXC/9fFgr/cxoM/3MaDP9TEwn/SREI/1ITCf9REwj/RA8H/2UXCv9jFwr/YRYK/2UX' +
  'C/93Gw3/fBwN/3ocDf98HA3/choM/2cXCv9qGAv/cxoM/3AaDP9fFgr/XBUJ/2wZC/94HAz/ZhgL/1kUCf9bFQn/XhUJ/2IWCv9vGgv/YRcK/0wSCP9XFAn/' +
  'TxII/0IPB/9YFQn/ZxcK/20ZC/9PEgj/ZBcK/18WCf9iFwr/bBgL/20YC/9yGgz/dRoM/3IaDP9xGgv/cxsM/24ZC/9sGQz/aBgL/2kZC/9iFgr/XhUJ/2UY' +
  'C/9pGAv/ZxgL/1wVCf9eFgr/ZhcK/2YYCv9aFgr/VRQJ/2AWCv9fFQn/WhUK/10WCf9yGwz/cBoL/00SCP9hFwr/aBgL/2oYC/9qGAv/aRgL/2kYC/9sGQz/' +
  'bRgL/3QaDP98HA3/dRsM/2UXCv9mGAv/bxoL/28aC/9dFgr/WBQJ/2UYC/9wGgv/bBkL/2MWCv9iFwr/YRYK/1UUCf9LEgj/XBUJ/2sYC/9gFgr/YxcK/3wc' +
  'Df9vGgz/SREI/2cYC/90Ggz/cRoM/2cYC/9mFwr/ZBcL/2MWCv9uGQz/dRoM/3UbDf9xGgv/bxoM/2kZC/9qGQv/aRgL/2YXCv9eFgr/WxUJ/2oZC/98HA3/' +
  'cRoM/10VCf9dFgr/TRIJ/0cRCP9mFwv/bRgL/10VCv9eFgn/cxoM/20YC/9PEgn/cRoM/3QaDP9uGQz/bBgL/2MXCv9hFgr/ZRgL/2kYC/9uGQz/ahgL/24a' +
  'DP94HAz/dBwM/2UXC/9jFwr/aRgL/2wYC/9iFgr/YhYK/3AaDP91Gwz/axgL/1YUCf9KEQj/TxMI/2UXCv9qGAv/VxQJ/1kVCf9nFwr/cRoM/2oZC/9fFgr/' +
  'VxQJ/1YUCf9SEwn/TxMI/04SCP9QEwj/UBMJ/00SCP9SEwn/WhUK/10WCv9XFAn/UhMJ/08SCP9REwn/VxQJ/1wVCv9QEwj/ShEI/1MTCf9QEgj/SREI/0UQ' +
  'B/9UFAn/YxcK/2MXCv9UEwn/WRQJ/2wZC/94HAz/fx4O/3sdDf91Gwz/axgL/2gYCv9rGAv/bRkL/2UXCv9eFgr/YxcK/2gYC/9wGgz/bRkM/2wZC/9xGgv/' +
  'cBoL/2sZC/9yGwz/dBsN/28ZDP9iFwr/VxQJ/14WCv9zGwz/choM/2AWCv9dFgr/XxYK/0kRCP9eFQr/fRwN/3gcDf9yGwz/dxwM/3MbDP9rGQv/bBkL/28a' +
  'C/9rGAv/YxcK/14WCv9kFwr/ZhcK/2EWCv9lGAv/axgL/28aC/91Gwz/ehwN/28aC/9pGQv/axgL/2EWCv9XFAn/XRUK/28aDP93HAz/bBkL/1sVCf9VFAn/' +
  'SBEI/zUMBv9CDwf/Pg4H/zsOBv86Dgb/Ow4G/zwOB/88Dgb/Ow4G/zYMBv81DAb/Nw0G/zUMBv8zDAb/MgsF/zMMBv85DQb/Og0G/0EPB/9CDwf/Ow0H/zcN' +
  'Bv80DAb/MgsF/zYMBv80DAb/MwwG/zsNB/89Dgf/MQsG/y0KBf8oCQX/BgEB/wYBAf8GAQH/BgEB/wYBAf8GAQH/BgEB/wYBAf8GAQH/BgEB/wYBAf8GAQH/' +
  'BgEB/wYBAf8GAQH/BgEB/wYBAf8GAQH/BgEB/wYBAf8GAQH/BgEB/wYBAf8GAQH/BgEB/wYBAf8GAQH/BgEB/wYBAf8GAQH/BgEB/wYBAf+mRy3/x1M0/8dW' +
  'Nf/GUzT/yVY2/8hUNP/IVTX/zFk3/9BcOP/OWjf/x1Y1/8VUNP/PXDj/1GA6/81ZN//EUzP/xlIz/8xYNv/IVzX/wVIy/8dXNf/UYDr/0Vw4/8tYNv/IUzT/' +
  'zVk3/9FcOP/NWjf/xVQ0/8VVNP/RXTn/uFQ0/7FOMf/HUzP/w1Iz/8VSM//AUDL/xlIz/8hVNf/NWjf/zFg2/8hUNf/MWDb/0185/85bN//JVTX/zFc2/81a' +
  'N//JVTT/wlAz/8BRMv/GVTT/0145/9VhOv/OWzf/y1g2/89bOP/PXDj/y1c1/8hWNf/MWjf/0V45/85bN/+uTTH/t1Q0/85bN//BUjL/rUgu/59CKv+iQyv/' +
  'qUct/6hHLf+nRSz/q0Yt/8FVNP/VYTr/zlo3/8hTNP/IVjX/zls3/8hXNf+9TzL/wFEz/81aN//RXDj/zVo3/8FUNP/OXDj/0l04/81ZN//IUzT/ylU1/9Ng' +
  'Ov/VYTr/zls4/6xLMP+uTjD/0185/8lYNf++UDL/w1Mz/8VVNP/DVDT/xFQ0/8hXNf/QXTj/s0sw/81aN//OWzf/zVo3/8hXNf/EVDT/wVIy/8dWNf/LWDb/' +
  'yFY1/8hWNf/LWDb/vFAy/8tbN//RXjn/yVc1/8xZN//QXTn/0F04/9FdOf/RXDj/rEsv/6RHLP/IVzX/zls3/8lYNf/BUDH/vlAx/7xOMf+/UDL/zVk3/85b' +
  'N/+mRCz/yFY1/81ZN//PXDj/x1Y1/71PMf/CUjP/1F85/9ReOf/GVTT/wlMy/8xZN/+8UDL/xVU1/85bN//RXTn/1WI7/9RgOv/PXDj/zls3/8xYNv+sSzD/' +
  'okYs/7xOMf/JVjX/0Vw4/8hWNf+6TjD/u08x/8ZSM//HUzT/x1M0/6JCKv/KVjb/zFc2/8hWNf/BUjL/xVU0/85bN//PWzf/z1s3/85bN//JWDb/yFY1/7NL' +
  'MP+9UDL/z1s4/9xmPf/aZTz/0l45/9FcOP/KVjX/x1Mz/61MMP+qSi//wlIz/8BQMf/HVjT/yFY1/8VVNP/BUzL/wlIz/75PMv+9TzL/okMr/8dWNf/FVDT/' +
  'wFAx/8ZVNP/VYTr/0185/8lUNP/JVDT/0145/9VfOf/IVjX/qUYs/75SM//VYTr/2GM7/9ZiO//VYDr/zVk3/8pXNv/LVzb/r04w/61NMP/OWzf/wVIz/7lO' +
  'MP/FVTT/1WE6/85bN/++UDL/vE4x/79RMv+eQSr/wlMz/7xOMf/DUzT/z1w4/9JeOf/PXDj/zVk3/81ZN//PXDj/0Fs4/8xXNv+vSS7/w1U0/9JeOf/SXTn/' +
  '0185/9FdOP/OWzf/zlo4/9FcOP+vTTD/q0sv/8tYNv/HUjP/v1Ay/8FSMv/MWjf/0Fw4/8hXNf+9TzH/vU8y/5k/Kf+6TTD/wFEz/8xXNv/OWjf/yVc2/8xZ' +
  'N//UYDr/1GA6/8tXNv/IUzT/z1o4/8RVNf/CVDT/yVc2/85aN//NWTf/zFk3/9JfOf/VYDr/z1s4/6pLL/+UQCn/p0cs/6xJLv+mRSz/xVU0/71PMv/HVjX/' +
  'zls3/8hXNv+5TTH/kjwn/71OMf/HUzT/y1Y2/8hTNP/IVTX/zls4/9NfOv/RXTj/y1Y2/8pWNf/RXTn/z1w5/71TM/+xTC//q0gu/61JLv+zTTH/uVAy/7lQ' +
  'Mv+wSy//l0Eq/6lKL//EVDP/zFg2/7BJL//JVzb/wFEy/7xOMf/HVjX/yVc1/71QMf+UPSj/wlIz/8ZSM/+/TzL/xlIz/81ZN//PXDj/zFo3/8pXNv/QWzj/' +
  '12E6/9BdOP/QXDj/1F85/9BdOP/IVTT/x1Q1/85aN//PWzj/ylc2/81ZN/+yUTL/rk0x/9JeOf/MVzb/o0Ir/8hWNf/KVzb/wFEy/7lNMf+8TzH/x1Y1/61H' +
  'Lf/BUjL/vU8y/71PMf/FUjP/zVo3/8tXNf/IVTX/zFo3/9diO//aYzv/1GA6/85bN//LVjb/zlo3/9FdOP/MWTb/x1Y1/8ZVNP/JVzb/0F04/7NSMv+0UzP/' +
  '1WE6/85aN/+iQir/yFM0/8xXNv/GVDT/uEww/7hOMP/MWTb/tEww/8lXNf+9TzH/wVIy/8dSM//DUTP/xlIz/8pVNf/TXzr/1WE6/9NfOv/VYTr/zls3/8hT' +
  'NP/MWDb/1V85/9JdOf/EVDT/wlMz/8xZN//PXDj/rEww/7JRMv/OWjf/zls3/6pHLf/IUzT/w1Ez/8BQMf/EUzP/xVU0/8FSMv+kRSz/z1w3/8xaN//CUzL/' +
  'wFAy/7xOMf/BUTP/zls4/89cOP/PWzj/z1w4/85bOP/OWzf/0Fw4/89cN//OWjf/y1c2/8tYN//JWDb/x1Y1/8dWNf+pSi//q0sv/8pXNv/OWzf/r0ku/8lW' +
  'Nf+9TzH/wVEz/85bOP/OWzj/wFEz/5k/KP/LWjf/1WE6/8tYNv+9TjH/v1Ay/8dWNf/IVjb/zFg2/8xXNv/LWDb/ylc2/89cOP/VYTr/0V05/8hTNP/IVDT/' +
  '0Fs4/9BcOP/EVDT/wVIy/6lJLv+lRyz/ylc2/85bN/+nRSz/xVIz/8hVNf/MWDf/zFc3/8lXNv/IVzX/mD4o/6tILf+zTTD/tUww/7RMMP+wSS7/r0ku/7BJ' +
  'Lv+wSS7/sUov/7BJLv+1TjD/ulEy/7pRM/+2TTH/tkww/7RMMP+0TTH/w1Q0/8hWNf/GVDT/p0ct/6dHLf/GUzP/xlU0/71QMv/IVjX/1WE6/9JeOf/IVDT/' +
  'yFM0/81aOP/KWjf/vlEz/7hNMP/EVDT/1WE7/7pRMv+1TTD/vVEy/71QMf+8TzH/w1Q0/8dWNf/IVzb/w1U0/8ZWNf/NXDj/y1s4/7NLL/+tSS7/y1k2/85b' +
  'N/+rSy//pUcs/8BQMv+6TjD/w1Q0/9FcOP/SXjn/z1w4/81ZN//MVzb/zVg3/8tZN//HVjX/wlIz/8dSM//SXDj/wVMz/8RUNP++UDL/vU8x/8RRM//IUzT/' +
  'ylU1/8ZTM//IVjX/zls3/9FdOP/NWjf/uU4y/7BJLv/IVDT/0F04/7RTM/+hRSz/uU0w/71QMv/HVjX/zVo3/8tYN//NWjf/1GA6/9NfOv/KVTX/xlM0/8tZ' +
  'N//UYDr/ylY1/8JSM/+2TTD/xlY1/8hXNf+/UTL/wlIz/8RRM/+9TzL/xVI0/8pXNv/NWjf/yVU0/8lVNf+/UTP/uU0x/8pWNf/PXDj/s1Iz/6BEK/+9TjH/' +
  'x1I0/8dVNf/CUzP/yFY1/9FdOf/VYTr/0l85/8xZN//IVTX/z1w4/9RgOv/QXTj/xVU0/6ZFLP+7UDL/0l05/85bN//AUjL/vE4x/75PMv/FUzP/yVY2/8RT' +
  'M//GUjP/yVU1/75RM/+9UjP/1GA5/81aN/+qSy//pUYt/8tWNv/HUjP/wVEy/8FSMv/GVjX/0Fw4/85bN//LWTf/0l85/9ljPP/PWzj/zVg3/89bOP/LWTf/' +
  'qEYs/7NLL//NWjb/0105/8dUNf+9TzH/wVAy/8RSM/+/UDL/wVIy/8VSM//JVjX/v1Iz/8FUNP/UYTr/zls4/6lKL/+uTTD/zFc2/8dTM//BUDL/xlIz/8dW' +
  'Nf/FVTT/x1U1/8xaN//YYzz/3GY9/9RfOv/MVzf/yVU1/8pXNv+9UTP/vVEy/8BSMv/GVDT/zVk3/8xZNv/AUTH/vE8x/7xOMf/AUDL/xlIz/8pVNf/DVDT/' +
  'vFAy/89cOP/OXDj/pkgt/5lCKv+rSC7/qkgt/51AKv/FUTP/xFIz/8FSMv/FVDT/0145/9VhOv/UXzr/1WE6/85bN//IUzT/ylY1/89cOP/NWjj/v1Ey/71P' +
  'Mf/KWDb/0185/8VVNP+6TjD/vE8x/8BQMf/DUTL/zVo3/79TM/+nRiz/sEwv/6hHLP+RPij/rEov/8hTNP/MWDb/rUYt/8VTNP/BUDL/w1Iz/8xXNv/MWDb/' +
  'z1s4/9FcOP/PWzf/zls3/9BcOP/NWDf/y1c2/8hWNf/IVzb/w1Mz/8BQMf/FVTT/yFY1/8ZWNf+9TzH/v1Ay/8dSM//HUzT/uU4x/7JLL//BUTL/wVEx/6xM' +
  'L/+vTzD/z1w4/85bN/+pRi3/wlEy/8dVNf/JVzb/yVY1/8hWNv/IVzX/y1c2/8xXNv/QXDj/1WE6/9FdOf/GUzT/xlQ0/81aN//OWjf/v1Ay/7lOMP/FVDT/' +
  'zls3/8pZNv/CUzL/wlIz/8FSMv+ySy//qUUt/71OMf/JVzb/sE8x/7JRMv/VYTr/zlk3/6VDK//GVDT/z1w4/85bOP/IUzT/x1M0/8NUM//CUzL/y1g2/9Fc' +
  'OP/RXTn/z1w3/81aN//JVzb/yVc2/8hUNP/HUjP/v1Ay/7xOMf/IVzb/1WE6/81bN/+9TzH/vU8y/6tHLf+kRCv/xlQ0/8xXNv+uTjH/r08w/9BbOP/MVzb/' +
  'rUgu/8xaN//PXDj/zVg3/8tWNv/DUjP/wVIy/8VUNP/IVzX/zFk3/8lXNf/MWjf/1V85/9JdOf/EVDP/wlIz/8lVNf/KVzb/wlIz/8FSMv/MWjf/0F05/8hX' +
  'Nv+2TDD/p0Us/6tHLf/GUzT/yVY1/6pKL/+sSi//yFM0/89aN//GVjX/uFAy/7FMMP+wSy//rEku/6lHLf+nRyz/qkct/6pILf+mRiz/rEku/7RNMf+3TzH/' +
  'sUwv/6xJLv+oRy3/q0gt/7BLL/+1TjH/qUgt/6JELP+sSi7/qEgt/6JEK/+dQSr/s0sv/8NSM//CUzP/p0ku/6xLMP/LVzb/0185/9hjO//WYTr/0l05/8tW' +
  'Nv/IUzT/y1Y1/8xXNv/FUzT/vlAy/8JSM//IUzT/zVo3/8pYN//KVzb/zls4/85aN//LVzb/z1w4/9BcOf/NWDf/wVEz/7dNMP+9UDL/z1w3/89bN//AUTL/' +
  'vU8y/79RMv+eQyv/sE4x/9ZhOv/TXzn/z1w4/9ReOf/RXTj/y1Y1/8tXNf/OWjf/y1Y2/8RSM/++TzL/xFIz/8dSM//DUTL/xlU0/8pXNv/OWTf/0V45/9Vg' +
  'Of/NWzf/yFc2/8tXNv/CUTL/uE0w/71QMf/MWjb/0145/8lXNv+7TjH/tUww/55DK/9tNCL/fzwm/3w6Jv96OSX/eTgl/3o5Jf97OSX/ezkl/3o5Jf92NSP/' +
  'djQj/3c1JP92NCP/dDMi/3MzIv90NCL/eTck/3o3Jf9+Oyb/fzwm/3o4Jf93NiT/dDQj/3MzIv92NSP/dDUi/3M0Iv95OCX/ezkl/3EzIv9tMSH/Yy0f/yYW' +
  'Ev8mFhL/JhYS/yYWEv8mFhL/JhYS/yYWEv8mFhL/JhYS/yYWEv8mFhL/JhYS/yYWEv8mFhL/JhYS/yYWEv8mFhL/JhYS/yYWEv8mFhL/JhYS/yYWEv8mFhL/' +
  'JhYS/yYWEv8mFhL/JhYS/yYWEv8mFhL/JhYS/yYWEv8mFhL/fw0G/4MNBv+OHxf/jRkR/4wPB/+EDgf/fScg/1gJBP9YCQT/gCgg/2cLBf9nCwX/jCkh/4wP' +
  'B/+MDwf/lyoh/4ANBv+BDQb/jB8X/40ZEf+MDwf/hA4H/3gnIP9RCQT/UAkE/44pIf+MDwf/jA8H/5QqIf+JDgb/iQ4G/5cqIf9/DQb/hA4G/44fF/+PGRH/' +
  'jg8H/4cOB/+AJyD/XAkE/1wJBP+CKCD/aAsF/2gLBf+NKSH/jg8H/44PB/+YKiH/gg0G/4QOBv+OHxf/jxkR/44PB/+HDgf/eycg/1YJBP9VCQT/jyoh/44P' +
  'B/+ODwf/lioh/4sOBv+LDgb/mCoh/5AkHP+TJBz/nDAn/5ssI/+aJh3/lCQc/5M2Lf94Ihv/eCIb/5Q1LP+CIxz/giMc/5w2Lf+aJh3/miYd/6M3Lf+SJBz/' +
  'kyQc/5wwJ/+bLCP/miYd/5QkHP+QNi3/cyEb/3IhG/+dNi3/miYd/5omHf+hNi3/mCUc/5glHP+iNy3/hxMM/4sUDP+TJBv/hRsU/4ESC/97Egv/gyki/2MP' +
  'Cv9iDwr/jysi/4gTC/+IEwv/lCwj/4sUDP+LFAz/lywj/2oQCv9rEAr/fSEa/40cFP+LFAz/hBML/5csI/+BEgv/gRIL/5QsI/+LFAz/ixQM/5IsI/98Egv/' +
  'fBIL/48rI/+KDwf/jg8H/5YhGP+GFxD/hA4G/3wNBv+DKCD/YgoF/2IKBf+PKSD/iw4G/4sOBv+VKiH/jg8H/44PB/+YKiH/aAsF/2gLBf97Hhf/jxkR/44P' +
  'B/+HDgf/mCoh/4QOBv+DDQb/lSoh/44PB/+ODwf/kyoh/34NBv9/DQb/kCkh/4kWDv+NFg7/lSYd/4cdFv+EFQ3/fhQN/4YrJP9mEgz/ZRIM/5EtI/+KFQ3/' +
  'ihUN/5YtJP+NFg7/jRYO/5guJP9tEw3/bhMN/4AjHP+PHxf/jRYO/4YVDv+ZLiT/hBUN/4QVDf+WLST/jRYO/40WDv+ULST/fhUN/34VDf+RLCT/lSMa/5gj' +
  'Gv+fLyb/hicf/38gGf97IBj/pjct/5gjGv+YIxr/kTMr/3UfGP90Hxj/ljQr/5gjGv+YIxr/oTUr/5YjGv+YIxr/ny8m/5gpIP+WIxr/kCIZ/5I0K/94IBn/' +
  'dyAZ/5w0K/+YIxr/mCMa/5s0K/9/IBn/fyAZ/5Q0K/+KDwf/jg8H/5YhGP9xFg//aAsF/2QLBf+eKyL/jg8H/44PB/+CKCD/XAkE/1wJBP+IKCD/jg8H/44P' +
  'B/+YKiH/jA8H/44PB/+WIRj/jRgQ/4sOBv+EDgb/gygg/2IKBf9iCgX/kSoh/44PB/+ODwf/jykh/2gLBf9oCwX/hSgg/4oPB/+ODwf/liEY/3EWD/9oCwX/' +
  'ZAsF/54rIv+ODwf/jg8H/4EoIP9bCQT/WwkE/4coIP+ODwf/jg8H/5gqIf+MDwf/jg8H/5YhGP+NGBD/iw4G/4MOBv+CJyD/YQoF/18KBf+QKSH/jg8H/44P' +
  'B/+PKSH/aAsF/2gLBf+FKCD/lCoh/5cqIf+eNCr/mS8m/5YqIf+RKSD/nDkv/4UoIP+FKCD/mzcu/4wpIf+MKSH/mDcu/38nIP+AKCD/lTcu/5EpIf+SKSH/' +
  'mzMq/5kvJv+XKiH/kikg/5M4L/93JyD/dycg/5s3Lv+SKSH/kikh/5k3Lv98JyD/fCcg/5I3Lv+KDwf/jg8H/5YhGP+PGRH/jg8H/4cOB/+JKSH/aAsF/2gL' +
  'Bf+LKSH/fg0G/34NBv+GKCD/YgoF/2IKBf+AKCD/gg0G/4QOBv+OHxf/jxkR/44PB/+HDgf/eycg/1YJBP9UCQT/iykg/4QOBv+EDgb/iCgg/1wJBP9cCQT/' +
  'fCcg/4oPB/+ODwf/liEY/48ZEf+ODwf/hg4H/4kpIf9oCwX/aAsF/4spIf99DQb/fQ0G/4YoIP9hCgX/YgoF/38oIP+CDQb/hA0G/44fF/+PGRH/jg8H/4YO' +
  'B/97JyD/VQkE/1QJBP+LKSD/hA0G/4QNBv+IKCD/WwkE/1wJBP98JyD/higg/4koIP+UMin/mS8m/5YqIf+RKSD/oDkw/40pIf+NKSH/nTgu/48pIf+PKSH/' +
  'mzcu/4opIP+KKSD/mzgu/5MqIf+UKiH/nDMq/44uJf+JKCD/hCcf/5o4L/+CKCD/gigg/503Lv+UKiH/lCoh/5k3Lv96JyD/eycg/5E3Lv9bCQX/YQoF/3Qd' +
  'Fv+PGRH/jg8H/4cOB/+cKiH/iw4G/4sOBv+SKSH/hA0G/4MNBv+TKSH/iw4G/4sOBv+XKiH/jA8H/44PB/+WIRj/aRUP/2IKBf9bCgX/lCoh/34NBv99DQb/' +
  'lCoh/44PB/+ODwf/iykh/1wJBP9cCQT/fCcg/1sJBf9iCgX/dB0W/48ZEf+ODwf/hw4H/5wqIf+LDgb/iw4G/5IpIf+EDgb/hA0G/5MpIf+LDgb/iw4G/5cq' +
  'If+MDwf/jg8H/5YhGP9qFQ//YgoF/1wKBf+UKiH/fg0G/30NBv+UKiH/jg8H/44PB/+LKSH/XAkE/1wJBP98JyD/fycg/4InIP+PMSn/lC4l/5IpIf+NKCD/' +
  'ojkv/5EpIP+RKSD/nTcu/5ApIf+QKSH/njgu/5UqIf+VKiH/oTku/5IqIf+UKiH/nDMq/4gsJf+CKCD/fSYf/505L/+JKSD/iSkg/583Lv+XKiH/lyoh/5s3' +
  'Lv9/JyD/gCcg/5M3Lv+KDwf/jg8H/5YhGP9kFA7/XAkE/1YJBP+CKCD/YQoF/2AKBf+JKSD/fQ0G/30NBv+RKSH/jg8H/44PB/+YKiH/aAsF/2gLBf97Hhf/' +
  'jxkR/44PB/+GDgf/eycg/1UJBP9TCQT/jykh/44PB/+ODwf/lyoh/44PB/+ODwf/mioh/4oPB/+ODwf/liEY/2YUDv9cCQT/VwkE/4MoIP9iCgX/YgoF/4kp' +
  'IP9+DQb/fg0G/5EpIf+ODwf/jg8H/5gqIf9oCwX/aAsF/3seF/+PGRH/jg8H/4cOB/97JyD/VgkE/1UJBP+PKiH/jg8H/44PB/+XKiH/jg8H/44PB/+aKiH/' +
  'lSMa/5gjGv+fLyb/fCYf/3UfGP9wHhj/kjQr/3ggGf93IBn/lzQr/4siGv+LIhr/nTQr/5gjGv+YIxr/oTUr/34gGf9/IBn/jS0l/5kqIf+YIxr/kiIZ/400' +
  'K/9vHhj/bh4Y/5s0K/+YIxr/mCMa/6A1K/+YIxr/mCMa/6I1K/+JFg7/jRYO/5UmHf+PHxf/jRYO/4YVDv+eLiX/jRYO/40WDv+EKyP/YhEM/2ERDP9+KyP/' +
  'YREM/2IRDP+BKyP/ixYO/40WDv+VJh3/jx8X/40WDv+GFQ7/jC0k/24TDf9tEw3/iCwk/24TDf9uEw3/jCwk/4QVDf+EFQ3/lS0k/4oPB/+ODwf/liEY/48Z' +
  'Ef+ODwf/hw4H/54rIv+ODwf/jg8H/4IoIP9cCQT/XAkE/3snIP9cCQT/XAkE/30nIP+MDwf/jg8H/5YhGP+PGRH/jg8H/4cOB/+JKSH/aAsF/2gLBf+EKCH/' +
  'aAsF/2gLBf+JKSH/hA0G/4QOBv+UKSH/iRYO/40WDv+VJh3/jx8X/40WDv+GFQ7/ni4l/40WDv+NFg7/hCsj/2IRDP9hEQz/fisj/2ERDP9iEQz/gSsj/4sW' +
  'Dv+NFg7/lSYd/48fF/+NFg7/hhUO/4wtJP9uEw3/bRMN/4gsJP9uEw3/bhMN/4wsJP+EFQ3/hBUN/5UtJP+VIxr/mCMa/58vJv+GJx//fyAZ/3sgGP+mNy3/' +
  'mCMa/5gjGv+fNSv/liMa/5YjGv+XNCv/eCAZ/3ggGf+QMyv/lCMa/5YjGv+dLyX/dyUf/28eGP9rHRj/pjct/5gjGv+YIxr/nzUr/5YjGv+WIxr/nzUr/5gj' +
  'Gv+YIxr/ojUr/4oPB/+ODwf/liEY/3EWD/9oCwX/ZAsF/54rIv+ODwf/jg8H/5UqIf+LDgb/iw4G/4opIP9iCgX/YgoF/4AoIP+KDgb/iw4G/5MgF/9fFA7/' +
  'VgkE/1AIBP+eKyL/jg8H/44PB/+VKiH/iw4G/4sOBv+WKiH/jg8H/44PB/+aKiH/ig8H/44PB/+WIRj/cRYP/2gLBf9kCwX/nisi/44PB/+ODwf/lSoh/4sO' +
  'Bv+LDgb/iSkg/2AKBf9hCgX/fycg/4kOBv+LDgb/kyAX/14TDv9UCQT/TggE/54rIv+ODwf/jg8H/5UqIf+LDgb/iw4G/5YqIf+ODwf/jg8H/5oqIf96Jx//' +
  'ficg/4syKf+ZLyb/lioh/5EpIP+mOjD/lyoh/5cqIf+fOC7/kikh/5IpIf+fNy7/lSoh/5UqIf+hOS//eCcg/3knIP+JMSn/ky4m/5ApIf+LKCD/oTkw/44p' +
  'If+OKSH/oDgu/5cqIf+XKiH/mzcu/38nIP+AKCD/kzcu/1cJBP9cCQT/cRwW/48ZEf+ODwf/hw4H/54rIv+ODwf/jg8H/5IpIf+EDgb/hA0G/5MpIf+ODwf/' +
  'jg8H/5cqIf9TCQT/VgkE/2scFv+GFxD/hA4G/3wNBv+UKiH/fw0G/30NBv+UKiH/jg8H/44PB/+MKSH/YgoF/2IKBf9/JyD/VwkE/1wJBP9wHBb/jxkR/44P' +
  'B/+GDgf/nisi/44PB/+ODwf/kikh/4QNBv+DDQb/kykh/44PB/+ODwf/lyoh/1IJBP9VCQT/axwW/4YXEP+EDQb/fA0G/5QqIf9+DQb/fQ0G/5QqIf+ODwf/' +
  'jg8H/4wpIf9hCgX/YgoF/38nIP+GKCD/iikh/5QyKf+YLyX/lSoh/5AoIP+jOTD/kSkh/5EpIf+fOC7/lCoh/5QqIf+gOC7/lioh/5YqIf+iOS//high/4co' +
  'If+TMin/jy4l/4opIf+HJyD/ozkw/5IpIf+SKSH/oDgu/5UqIf+VKiH/mjcu/3wnIP98JyD/kjcu/4oPB/+ODwf/liEY/40YEP+LDgb/hA4G/5QqIf9+DQb/' +
  'fQ0G/5QqIf+ODwf/jg8H/5YqIf+ODwf/jg8H/5gqIf+MDwf/jg8H/5YhGP9xFg//aAsF/2QLBf+eKyL/jg8H/44PB/+VKiH/iw4G/4sOBv+KKSD/XAkE/1wJ' +
  'BP98JyD/ig8H/44PB/+WIRj/jRgQ/4sOBv+EDgb/lCoh/38NBv99DQb/lCoh/44PB/+ODwf/lioh/44PB/+ODwf/mCoh/4wPB/+ODwf/liEY/3EWD/9oCwX/' +
  'ZAsF/54rIv+ODwf/jg8H/5UqIf+LDgb/iw4G/4opIP9cCQT/XAkE/3wnIP+VKiH/lyoh/540Kv+YLyb/lioh/5EoIP+gOjD/jSkh/40pIf+gOC7/lyoh/5cq' +
  'If+hOC//lyoh/5cqIf+jOS//lioh/5cqIf+fNCr/ii4l/4QoIP+BJx//pjow/5cqIf+XKiH/oTgu/5YqIf+WKiH/mjcu/3onIP97JyD/kjcu/7UvIv+5LyL/' +
  'vUU5/70+MP+/MiP/tzEi/6pPRP+RKR7/kSke/61PRf+fKyD/nysg/7dRRf+/MiP/vzIj/8FTRv+3LyL/uC8i/7xFOf+9PjD/vzIj/7cxIv+lTkT/iice/4kn' +
  'Hv+4UUb/vzIj/78yI/+/U0b/vTEj/70xI//BU0f/tS8i/7owI/+9RTn/vz4w/8EyI/+6MSL/rU9E/5QpHv+UKR7/rk9F/6ArIP+gKyD/uVFF/8EyI//BMiP/' +
  'wlNH/7gvIv+6MCP/vUU5/78+MP/BMiP/ujEi/6lORP+OKB7/jSge/7pRRv/BMiP/wTIj/8FTRv++MSP/vjEj/8JTR/++TD//wUxA/8VbT//FVUj/xk5B/8BM' +
  'P/+6YVb/qEg9/6dIPf+8YVb/sUo//7FKP//DYlb/xk5B/8ZOQf/JY1f/wExA/8FMQP/FW0//xVVI/8ZOQf/ATD//t2FW/6JHPf+hRz3/w2JW/8ZOQf/GTkH/' +
  'yGNW/8RNQP/ETUD/yGNX/7g2Kf+8Nyn/wEo+/7VANP+1NSj/rzQn/69SR/+ZMCX/mDAl/7lUSP+6Nin/ujYp/75VSf+8Nyn/vDcp/8BVSf+gMSb/oDEm/6xH' +
  'PP+7QjX/vDcp/7U2KP/CVUn/tTUo/7U1KP++VEn/vDcp/7w3Kf+8VEj/sDUn/7A1J/+6VEj/vTEj/8EyI//DRzr/uTsv/7owI/+yLiL/sFBE/5oqHv+aKh7/' +
  'ulJG/74xI/++MSP/wFNG/8EyI//BMiP/wlNH/6ArIP+gKyD/rEM4/78+MP/BMiP/ujEi/8RTR/+6MCP/uS8i/8BTRv/BMiP/wTIj/75SRv+0LyL/tS8i/7xS' +
  'Rv+6OSz/vjos/8FNQP+3Qzf/tzgs/7E3K/+xVEn/nDQo/5szKP+6Vkr/uzos/7s6LP/AV0v/vjos/746LP/BV0v/ozUq/6M1Kv+vST7/vUU3/746LP+3OSv/' +
  'w1hM/7c4LP+3OCz/wFdL/746LP++Oiz/vVZK/7E4K/+yOCv/u1ZK/8FKPf/FSz3/yFlN/7NPRP+vRjv/q0U6/81jVv/FSz3/xUs9/7leU/+lRDr/pEQ6/71f' +
  'VP/FSz3/xUs9/8hhVf/ESz3/xUs9/8hZTf/CUkb/w0o9/71JPP+7X1T/qUU6/6hFOv/DYFT/xUs9/8VLPf/DYFT/r0Y7/69GO/+8X1P/vTEj/8EyI//DRzr/' +
  'pTgt/6ArIP+cKiD/yVRH/8EyI//BMiP/rk9E/5QpHv+UKR7/tFBF/8EyI//BMiP/w1NH/8AyI//BMiP/w0c6/709MP++MSP/tzAi/7BQRP+aKh7/mioe/7xS' +
  'Rv/BMiP/wTIj/7tSRv+gKyD/oCsg/7JQRf+9MSP/wTIj/8NHOv+mOC3/oSsg/5wqIP/JVEf/wTIj/8EyI/+tT0T/lCke/5MpHv+zUEX/wTIj/8EyI//CU0f/' +
  'wDIj/8EyI//DRzr/vT0w/74xI/+3MCL/r09E/5oqHv+YKh7/u1JG/8EyI//BMiP/u1JG/6ErIP+hKyD/slBF/79SRv/CU0f/xl9T/8FZTP/BU0f/vFFF/8Jl' +
  'Wv+yUEX/slBF/8FkWP+4UUX/uFFF/75jWP+sT0T/rU9E/7xjWP+9Ukb/vVJG/8NeU//CWU3/wlNH/7xRRf+5ZFn/pE1D/6RNQ//AZFn/vVJG/71SRv+/ZFj/' +
  'qU5E/6lPRP+3Ylf/vTEj/8EyI//DRzr/vz4w/8EyI/+6MSL/tlFF/6ArIP+gKyD/uFFF/7QvIv+0LyL/slBF/5oqHv+aKh7/rU9E/7gvIv+6MCP/vUU5/78+' +
  'MP/BMiP/ujEi/6lORP+OKB7/jSge/7dQRf+6MCP/ujAj/7RQRf+UKR7/lCke/6lORP+9MSP/wTIj/8NHOv+/PjD/wTIj/7oxIv+2UUX/oCsg/6ArIP+4UUX/' +
  'sy8i/7MvIv+yUEX/mioe/5oqHv+sT0T/uC8i/7ovIv+9RTn/vz4w/8EyI/+6MSL/qE5E/44oHv+MKB7/t1BF/7ovIv+6LyL/tFBF/5QpHv+UKR7/qE5E/7FP' +
  'RP+1UEX/vF1S/8JZTf/BU0b/vFFE/8ZmWv+5UUb/uVFG/8NkWP+7Ukb/u1JG/8FkWP+1UUX/tlFF/8FkWf++Ukb/v1JG/8RfU/+3V0v/tVFF/7FPQ/+/ZVr/' +
  'r09E/65PRP/DZFj/v1JG/79SRv+/Y1j/p05E/6hORP+2Ylf/kyke/5oqHv+lQTb/vz4w/8EyI/+6MSL/x1RH/74xI/++MSP/vlJG/7ovIv+5LyL/vlJG/74x' +
  'I/++MSP/wVNH/8AyI//BMiP/w0c6/543LP+aKh7/kyke/8BTRv+0LyL/sy8i/79SRv/BMiP/wTIj/7ZRRf+UKR7/lCke/6lORP+UKR7/mioe/6VBNv+/PjD/' +
  'wTIj/7oxIv/HVEf/vjEj/74xI/++Ukb/ujAj/7ovIv++Ukb/vjEj/74xI//BU0f/wDIj/8EyI//DRzr/njcs/5oqHv+UKR7/wFNG/7QvIv+zLyL/v1JG/8Ey' +
  'I//BMiP/t1FF/5QpHv+UKR7/qU5E/6tORP+uT0T/t1xR/71YTP+8Ukb/t1BE/8hmWv+7Ukb/u1JG/8NkWP+8Ukb/vFJG/8RlWP/AUkb/wFJG/8ZlWf++U0b/' +
  'v1NG/8ReU/+yVkv/r09E/6pNQ//DZVr/tVBF/7RQRf/FZVn/wVNG/8FTRv/BZFn/rE9E/61PRP+5Y1j/vTEj/8EyI//DRzr/mTYs/5QpHv+OKB7/r1BE/5oq' +
  'Hv+ZKh7/tVFF/7MvIv+zLyL/vVJG/8EyI//BMiP/wlNH/6ErIP+hKyD/rEM4/78+MP/BMiP/ujEi/6hORP+NKB7/jCge/7lRRv/BMiP/wTIj/8FTRv/BMiP/' +
  'wTIj/8RUR/+9MSP/wTIj/8NHOv+aNiz/lCke/48oHv+wUET/mioe/5oqHv+1UUX/tC8i/7QvIv+9Ukb/wTIj/8EyI//CU0f/oCsg/6ArIP+sQzj/vz4w/8Ey' +
  'I/+6MSL/qU5E/44oHv+NKB7/ulFG/8EyI//BMiP/wVNG/8EyI//BMiP/xFRH/8FKPf/FSz3/yFlN/6hNQ/+lRDr/oEM5/7tfVP+pRTr/qEU6/79gVP+6STz/' +
  'ukk8/8RhVf/FSz3/xUs9/8hhVf+vRjv/r0Y7/7lXS//EU0b/xUs9/79JPP+1X1T/n0M5/59DOf/CYFT/xUs9/8VLPf/HYVX/xUs9/8VLPf/IYlX/ujks/746' +
  'LP/BTUD/vUU3/746LP+3OSv/x1hM/746LP++Oiz/r1RJ/5czKP+XMyj/qVNJ/5YzKP+XMyj/q1NJ/706LP++Oiz/wU1A/71FN/++Oiz/tzkr/7hVSv+jNSr/' +
  'ozUq/7NUSf+jNSr/ozUq/7dVSv+3OCz/tzgs/75XS/+9MSP/wTIj/8NHOv+/PjD/wTIj/7oxIv/JVEf/wTIj/8EyI/+uT0T/lCke/5QpHv+oTkT/lCke/5Qp' +
  'Hv+qT0T/wDIj/8EyI//DRzr/vz4w/8EyI/+6MSL/tlFF/6ArIP+gKyD/sVBF/6ArIP+gKyD/tlBF/7ovIv+6MCP/wFJG/7o5LP++Oiz/wU1A/71FN/++Oiz/' +
  'tzkr/8dYTP++Oiz/vjos/69USf+XMyj/lzMo/6lTSf+WMyj/lzMo/6tTSf+9Oiz/vjos/8FNQP+9RTf/vjos/7c5K/+4VUr/ozUq/6M1Kv+zVEn/ozUq/6M1' +
  'Kv+3VUr/tzgs/7c4LP++V0v/wUo9/8VLPf/IWU3/s09E/69GO/+rRTr/zWNW/8VLPf/FSz3/xmFU/8NKPf/DSj3/vl9U/6hFOv+pRTr/uF5T/8JKPf/DSj3/' +
  'xllN/6RMQv+fQzn/mkI4/81jVv/FSz3/xUs9/8ZhVP/DSj3/w0o9/8ZhVf/FSz3/xUs9/8hiVf+9MSP/wTIj/8NHOv+lOC3/oCsg/5wqIP/JVEf/wTIj/8Ey' +
  'I//AU0b/vjEj/74xI/+2UUX/mioe/5oqHv+tT0T/vTEj/74xI//BRzr/lDUr/44oHv+IJx3/yVRH/8EyI//BMiP/wFNG/74xI/++MSP/wFJG/8EyI//BMiP/' +
  'xFRH/70xI//BMiP/w0c6/6Y4Lf+hKyD/nCog/8lUR//BMiP/wTIj/8BTRv++MSP/vjEj/7VQRf+ZKh7/mSoe/6tPRP+9MSP/vjEj/8FHOv+SNSv/jSge/4Yn' +
  'Hf/JVEf/wTIj/8EyI//AU0b/vjEj/74xI//AUkb/wTIj/8EyI//EVEf/pk5D/6pPRP+0XFH/wVlM/8FTR/+8UUX/y2db/8JTR//BU0f/xWRZ/71SRv+9Ukb/' +
  'xWVZ/8BTRv/AU0b/xmVZ/6ROQ/+mTkP/sVtQ/71YTP+7UUb/t1BE/8ZmWv+6UUb/ulFG/8ZlWf/CU0f/wlNH/8JkWP+sT0T/rU9E/7pjV/+PKB7/lCke/6JB' +
  'Nv+/PjD/wTIj/7oxIv/JVEf/wTIj/8EyI/++Ukb/ujAj/7ovIv+/Ukb/wTIj/8EyI//CU0b/jCge/44oHv+cQDb/uTsv/7owI/+yLiL/wFNG/7UvIv+zLyL/' +
  'v1JG/8EyI//BMiP/uFFF/5oqHv+aKh7/rE9E/48oHv+UKR7/oUE2/78+MP/BMiP/ujEi/8lUR//BMiP/wTIj/75SRv+6LyL/uS8i/79SRv/BMiP/wTIj/8FT' +
  'Rv+LKB7/jige/5xANf+5Oy//ui8i/7IuIv/AU0b/tC8i/7MvIv+/Ukb/wTIj/8EyI/+4UUX/mioe/5oqHv+sT0T/sU9E/7ZQRf+8XVL/wVlN/8BTRv+8UUT/' +
  'yGda/71SRv+9Ukb/xWRY/79SRv+/Ukb/xmVY/8FTRv/BU0b/x2VZ/7FQRf+zUEX/u11R/7pXTP+3UUX/s09E/8lnWv++Ukb/vVJG/8VkWP/AU0b/wFNG/8Bk' +
  'WP+oTkT/qU5E/7diV/+9MSP/wTIj/8NHOv+9PTD/vjEj/7cwIv/AU0b/tC8i/7MvIv+/Ukb/wTIj/8EyI//BU0b/wTIj/8EyI//DU0f/wDIj/8EyI//DRzr/' +
  'pTgt/6ArIP+cKiD/yVRH/8EyI//BMiP/wFNG/74xI/++MSP/tlBF/5QpHv+UKR7/qU5E/70xI//BMiP/w0c6/709MP++MSP/tzAi/8BTRv+1LyL/sy8i/79S' +
  'Rv/BMiP/wTIj/8FTRv/BMiP/wTIj/8NTR//AMiP/wTIj/8NHOv+lOC3/oCsg/5wqIP/JVEf/wTIj/8EyI//AU0b/vjEj/74xI/+2UEX/lCke/5QpHv+pTkT/' +
  'v1JG/8FTRv/FX1P/wVlN/8BTRv+8UUX/xmda/7hRRf+4UUX/xmVZ/8FTRv/BU0b/x2VZ/8JTRv/CU0b/x2ZZ/8FTRv/BU0b/xl9T/7RXS/+xUEX/rk5D/8tn' +
  'W//AU0b/wFNG/8ZlWf/AU0b/wFNG/8BkWP+nTkT/qE5E/7hjWP/UcgD/2nUA/9iADv/efwj/5n0A/9p2AP+0cxf/mlMA/5hSAP+4dRf/rV0A/6xdAP/Jfxb/' +
  '5n0A/+Z9AP/aiBf/1nMA/9h0AP/Wfw7/3n8I/+Z9AP/adgD/rXAX/49NAP+NTAD/y4EX/+Z9AP/mfQD/1oYW/+N6AP/jegD/24gX/9RyAP/cdgD/2IAO/+CA' +
  'CP/pfgD/3XgA/7h2F/+gVgD/nlYA/7p3F/+wXgD/sF4A/8uAFv/pfgD/6X4A/9yJF//YdAD/3HYA/9iADv/ggAj/6X4A/914AP+xchf/l1EA/5RPAP/Oghf/' +
  '6X4A/+l+AP/ZiBb/5nsA/+Z7AP/diRf/1oIS/9qFE//bjRv/34wX/+SKE//bhhL/xoYh/7JvE/+xbxP/yIgg/793E/+/dxP/1I0g/+SKE//kihP/35Qh/9iE' +
  'E//ahRP/240b/9+MF//kihP/24YS/8GEIf+qaxP/qWoT/9WPIP/kihP/5IoT/92SIP/iiBP/4okT/96TIf/YeQT/33wE/9uFEf/OeQv/0nQE/8hvBP+7eRj/' +
  'pFsE/6JbBP/Mghj/3HkE/9x5BP/Uhxj/33wE/998BP/XiBj/rWAE/65hBP+5chH/2H4L/998BP/UdgT/2IkY/9J0BP/SdAT/04YY/998BP/ffAT/0IQY/8lw' +
  'BP/JcAT/zIMY/+J7AP/pfgD/4oYO/9R5CP/cdgD/0HAA/7x4F/+mWQD/plkA/8+CF//mewD/5nsA/9mHFv/pfgD/6X4A/9yJF/+vXgD/sF4A/7twDv/ggAj/' +
  '6X4A/914AP/ciRf/3HYA/9t1AP/Yhxf/6X4A/+l+AP/UhRb/0XEA/9NxAP/Qgxf/2XsG/+B+Bv/chhL/z3sN/9N3Bv/JcQb/vHsa/6ZfBv+lXgb/zYQZ/918' +
  'Bv/dfAb/1YgZ/99+Bv/gfgb/2IoZ/69jBv+xZAb/u3US/9mADf/gfgb/1XgG/9mKGv/Tdwb/03cG/9SIGf/gfgb/4H4G/9GGGf/Kcgb/ynIG/86EGf/ehhD/' +
  '44gR/+GPGv/AeRb/vXMR/7dwEP/kliD/44gR/+OIEf/GhR//rmwR/65rEf/MiR//44gR/+OIEf/ekh//4YcR/+OIEf/hjxr/3IgW/+GGEf/YghD/x4cg/7Rv' +
  'Ef+zbxH/1Y4f/+OIEf/jiBH/1Y0f/71zEf+9cxH/yYcg/+J7AP/pfgD/4oYO/7NnCP+wXgD/qlsA/+WOF//pfgD/6X4A/7p3F/+fVgD/n1YA/8R9Fv/pfgD/' +
  '6X4A/9yJF//mfQD/6X4A/+KGDv/efgj/5nsA/9t1AP+8eBf/plkA/6ZZAP/Rgxf/6X4A/+l+AP/Pghb/sF4A/7BeAP+/ehf/4nsA/+l+AP/ihg7/s2cI/7Be' +
  'AP+pWwD/5Y4X/+l+AP/pfgD/uHYX/51VAP+dVQD/wnwW/+l+AP/pfgD/3IkX/+Z9AP/pfgD/4oYO/91+CP/mewD/2nUA/7t4F/+lWQD/pFkA/9CDF//pfgD/' +
  '6X4A/86CFv+wXgD/sF4A/796F//Whhb/2ogX/9uQHv/Xihr/2YgX/9KEFv/RjiL/v3kX/755F//QjSH/yoAX/8qAF//LiyH/t3YX/7h2F//HiSL/0YMX/9KE' +
  'F//WjB7/14sa/9qIF//ThBb/w4ci/6tvF/+qbhf/0I0h/9KEF//ShBf/zowh/7JzF/+ycxf/woUi/+J7AP/pfgD/4oYO/+CACP/pfgD/3XgA/8R8F/+wXgD/' +
  'sF4A/8l/F//RcQD/0XEA/8F7Fv+mWQD/plkA/7h2F//YdAD/23YA/9iADv/ggAj/6X4A/914AP+xchf/llEA/5NPAP/Ifhf/23YA/9t2AP/EfBb/n1YA/6BW' +
  'AP+ycxf/4nsA/+l+AP/ihg7/4IAI/+l+AP/deAD/xHwX/7BeAP+vXgD/yX8X/9FxAP/QcQD/wHsW/6ZZAP+mWQD/t3UX/9h0AP/bdgD/2IAO/+CACP/pfgD/' +
  '3XgA/7ByF/+VUAD/k08A/8h+F//bdgD/23YA/8R8Fv+eVQD/n1YA/7JzF//Aexb/xn0W/8yHHv/Xihr/2YgW/9KEFf/YkiL/zIAW/8uAFv/TjyH/z4IW/8+C' +
  'Fv/RjSH/x34W/8d+Fv/QjSH/1IUW/9aGFv/Yjh7/x4Ea/8Z+Fv+/ehX/zo0i/7x4Fv+7eBb/048h/9aGFv/Vhhb/zowh/69yFv+wchb/wYUh/51VAP+mWQD/' +
  'sGsO/+CACP/pfgD/3XgA/+ONF//mewD/5nsA/9OEF//bdgD/23UA/9SFFv/mewD/5nsA/9uIF//mfQD/6X4A/+KGDv+oYgj/plkA/51VAP/Whhf/0nEA/9Bx' +
  'AP/Whhf/6X4A/+l+AP/Ifxb/nlYA/59WAP+ycxf/nlUA/6ZZAP+waw7/4IAI/+l+AP/deAD/440X/+Z7AP/mewD/04QX/9t2AP/bdgD/1IUW/+Z7AP/mewD/' +
  '24gX/+Z9AP/pfgD/4oYO/6liCP+mWQD/nlUA/9aGF//ScQD/0XEA/9aGF//pfgD/6X4A/8l/Fv+eVgD/n1YA/7JzF/+1dRb/u3cX/8ODHv/Rhxv/0oQX/8uA' +
  'Fv/akyP/0YMX/9GDF//UjyH/0YMX/9GDF//WkCH/2IcX/9iHF//akiL/04UX/9WGF//Yjh7/vn0b/7x3F/+1dBb/1JAj/8Z9F//GfRf/1pEh/9mIF//ZiBf/' +
  '0Y4h/7d1F/+4dhf/xYci/+J7AP/pfgD/4oYO/6FeCP+eVgD/lVAA/7t4F/+mWQD/pVkA/8Z+F//QcQD/0HEA/9KEFv/pfgD/6X4A/9yJF/+vXgD/sF4A/7pw' +
  'Dv/ggAj/6X4A/914AP+wchf/lE8A/5JOAP/Oghf/6X4A/+l+AP/ZiBb/6X4A/+l+AP/fixf/4nsA/+l+AP/ihg7/o18I/6BWAP+XUQD/vHgX/6ZZAP+mWQD/' +
  'xn4X/9JxAP/ScQD/0oQW/+l+AP/pfgD/3IkX/69eAP+wXgD/u3AO/+CACP/pfgD/3XgA/7FyF/+XUQD/lE8A/86CF//pfgD/6X4A/9mIFv/pfgD/6X4A/9+L' +
  'F//ehhD/44gR/+GPGv+ychb/r2wR/6hoEP/HhyD/tG8R/7NvEf/Oih//0X8R/9F/Ef/Xjh//44gR/+OIEf/dkh//vHMR/71zEf/GgRr/3ooW/+OIEf/ahBD/' +
  'v4Ig/6dnEf+lZxH/1I0f/+OIEf/jiBH/3JEf/+OIEf/jiBH/3pIg/9l7Bv/gfgb/3IYS/9mADf/gfgb/1XgG/+COGv/gfgb/334G/7t6Gf+fWwb/n1sG/7F1' +
  'Gf+fWwb/oFsG/7V3Gf/dfQb/4H4G/9yGEv/ZgA3/4H4G/9V4Bv/FgBr/sWQG/7BjBv+/fRn/sGQG/7BkBv/GgBn/03cG/9N3Bv/Thxn/4nsA/+l+AP/ihg7/' +
  '4IAI/+l+AP/deAD/5Y4X/+l+AP/pfgD/uncX/59WAP+fVgD/sHIW/59WAP+gVgD/s3QX/+Z9AP/pfgD/4oYO/+CACP/pfgD/3XgA/8V8F/+wXgD/sF4A/755' +
  'F/+wXgD/sF4A/8Z9Fv/bdgD/23YA/9aGF//Zewb/4H4G/9yGEv/ZgA3/4H4G/9V4Bv/gjhr/4H4G/99+Bv+7ehn/n1sG/59bBv+xdRn/n1sG/6BbBv+1dxn/' +
  '3X0G/+B+Bv/chhL/2YAN/+B+Bv/VeAb/xYAa/7FkBv+wYwb/v30Z/7BkBv+wZAb/xoAZ/9N3Bv/Tdwb/04cZ/96GEP/jiBH/4Y8a/8B5Fv+9cxH/t3AQ/+SW' +
  'IP/jiBH/44gR/9uRH//hhhH/4YYR/8+KH/+0bxH/tG8R/8SEH//fhRH/4YYR/9+OGv+sbxb/p2cR/6BkEP/kliD/44gR/+OIEf/bkR//4YYR/+GGEf/bkR//' +
  '44gR/+OIEf/ekiD/4nsA/+l+AP/ihg7/s2cI/7BeAP+qWwD/5Y4X/+l+AP/pfgD/2IcX/+Z7AP/mewD/x34W/6ZZAP+mWQD/uHYX/+R6AP/mewD/4IQO/5pa' +
  'CP+XUQD/jEsA/+WOF//pfgD/6X4A/9iHF//mewD/5nsA/9iHFv/pfgD/6X4A/9+LF//iewD/6X4A/+KGDv+zZwj/sF4A/6lbAP/ljhf/6X4A/+l+AP/Xhxf/' +
  '5nsA/+Z7AP/GfRb/pVkA/6VZAP+2dRf/4noA/+Z7AP/fhA7/l1gI/5NPAP+KSgD/5Y4X/+l+AP/pfgD/14cX/+Z7AP/mewD/2IcW/+l+AP/pfgD/34sX/69x' +
  'Fv+0dBf/v4Ae/9eKGv/ZiBf/0oQW/+CWIv/aiBf/2ogX/9aRIf/ShBf/0oQX/9aQIf/Xhxf/14cX/9mSIv+rbxf/rnAX/7p+Hv/Phhr/z4MX/8l/Fv/YkiL/' +
  'zYEX/82BF//XkSH/2ogX/9qIF//RjiH/t3UX/7h2F//FhyL/l1EA/6BWAP+saQ7/4IAI/+l+AP/deAD/5Y4X/+l+AP/pfgD/04QX/9t2AP/bdgD/1YYW/+l+' +
  'AP/pfgD/24kX/5FOAP+WUQD/o2QO/9R5CP/cdgD/0HAA/9aGF//ScQD/0XEA/9aGF//pfgD/6X4A/8qAFv+mWQD/plkA/7d1F/+WUQD/n1YA/6toDv/ggAj/' +
  '6X4A/914AP/ljhf/6X4A/+l+AP/ThBf/23YA/9t1AP/Vhhb/6X4A/+l+AP/biRf/kE0A/5VQAP+iZA7/1HkI/9t2AP/QcAD/1oYX/9FxAP/QcQD/1oYX/+l+' +
  'AP/pfgD/yoAW/6ZZAP+mWQD/t3UX/8F7Fv/Gfhb/zIce/9aKGv/Zhxb/0YMV/9uUIv/ShBb/0oQW/9aRIf/Whhb/1YYW/9iRIf/ZiBb/2YgW/9qTIf/Bexb/' +
  'w3wW/8qGHv/Jgxr/yH4W/8J7Ff/clCL/04UW/9OFFv/XkSH/2YcW/9mHFv/PjSH/sXMW/7JzFv/ChSH/4nsA/+l+AP/ihg7/3n4I/+Z7AP/bdQD/1oYX/9Jx' +
  'AP/QcQD/1oYX/+l+AP/pfgD/2YgW/+l+AP/pfgD/3IkX/+Z9AP/pfgD/4oYO/7NnCP+wXgD/qFsA/+WOF//pfgD/6X4A/9iHF//mewD/5nsA/8d+Fv+eVgD/' +
  'n1YA/7JzF//iewD/6X4A/+KGDv/efgj/5nsA/9t1AP/Whhf/0nEA/9FxAP/Whhf/6X4A/+l+AP/ZiBb/6X4A/+l+AP/ciRf/5n0A/+l+AP/ihg7/s2cI/7Be' +
  'AP+pWwD/5Y4X/+l+AP/pfgD/2IcX/+Z7AP/mewD/yH4W/59WAP+gVgD/snMX/9eHFv/aiBf/25Ae/9eKGv/Zhxf/0oMW/9iSI//MgRf/zIEX/9eRIv/biRf/' +
  '24kX/9mTIf/biRf/24kX/9uTIv/ZiBf/24kX/9yQHv/Bfhr/vXkX/7l2Fv/flyP/2ogX/9qIF//ZkiL/2YcX/9mHF//PjSH/sHIX/7ByF//ChiL/7agN//Gr' +
  'Df/tsiT/77Eb//axDf/uqw3/1aQy/8qKDf/KiQ3/1qUy/9iVDf/YlQ3/4a4y//axDf/2sQ3/6rYy/++pDf/wqg3/7LEk/++xG//2sQ3/7qsN/8+fMv/ChA3/' +
  'wYMN/+GvMv/2sQ3/9rEN/+m2Mv/2sQ3/9rEN/+y4Mv/tqA3/8q0N/+2yJP/wshv/97IN/++sDf/ZpjL/z44N/8+NDf/ZpzL/2pcN/9qXDf/isDL/97IN//ey' +
  'Df/ruDL/8KoN//KtDf/tsiT/8LIb//eyDf/vrA3/1KIy/8iJDf/HiA3/47Ay//eyDf/3sg3/6rcy//eyDf/3sg3/7bky/+qzK//utSv/7Ls6/+66NP/yuiv/' +
  '7LUq/96zQ//WoSv/1KAr/9+0Qv/fqCv/36gr/+a6Qv/yuiv/8ror/+y/Qv/ttSv/7rUr/+y7Ov/uujT/8ror/+y1Kv/asEP/0Jwr/8+bK//lukL/8ror//K6' +
  'K//rvkL/8bor//K6K//rv0L/7KwU//CvFP/stSj/5qsg/+qpFP/koxT/2ak1/9CSFP/PkhT/4bE1//CvFP/wrxT/5rU1//CvFP/wrxT/57Y1/9aXFP/XmBT/' +
  '2qQo/+qwIP/wrxT/6KkU/+q4Nf/rqRT/6qkU/+W1Nf/wrxT/8K8U/+SzNf/lpBT/5qUU/+KxNf/zrw3/97IN//G3JP/rrRv/8q0N/+qlDf/cqTL/1ZIN/9WS' +
  'Df/lsjL/97IN//eyDf/qtzL/97IN//eyDf/ruDL/2pcN/9qXDf/doyT/8LIb//eyDf/vrA3/7rky//KtDf/xrA3/6rYy//eyDf/3sg3/57Qy/+ynDf/tqA3/' +
  '5rIy/+ytF//wsRf/7LYr/+asI//rqxf/5KUX/9qrN//SlRf/0JQX/+KyNv/wsRf/8LEX/+e2N//wsRf/8LEX/+i3N//XmRf/2JoX/9umK//rsSP/8LEX/+mr' +
  'F//ruTf/66sX/+urF//mtjb/8LEX//CxF//ktDb/5qYX/+anF//jsjf/7rYn//G4KP/vvTf/3aox/96mKP/Zoif/8MJB//G4KP/xuCj/3LFA/9SeKP/TnSj/' +
  '4LVA//G4KP/xuCj/675A//C4KP/xuCj/7703/+25Mf/xuCj/67Qn/9+0Qf/Yoij/16Io/+a6QP/xuCj/8bgo/+a6QP/epij/3qYo/+C0QP/zrw3/97IN//G3' +
  'JP/ZnBv/2pcN/9WTDf/yvTL/97IN//eyDf/YpzL/z44N/8+NDf/drDL/97IN//eyDf/suDL/9rEN//eyDf/xtyT/8LIb//eyDf/vrA3/3Kky/9WSDf/Vkg3/' +
  '5bIy//eyDf/3sg3/5LEy/9qXDf/alw3/3aoy//OvDf/3sg3/8bck/9mcG//alw3/1JIN//K9Mv/3sg3/97IN/9emMv/OjA3/zowN/9yrMv/3sg3/97IN/+u4' +
  'Mv/2sQ3/97IN//G3JP/wshv/97IN/++sDf/aqDL/1JIN/9OSDf/ksjL/97IN//eyDf/ksTL/2pYN/9qXDf/cqjL/57Ux/+u3Mv/qvD7/57c5/+q2Mv/ksjD/' +
  '5LpG/92qMv/cqTL/4rlE/+KvMv/irzL/37ZE/9emMv/YpjL/3bVF/+azMv/ntDL/57o+/+i4Of/qtzL/5bMw/9myRv/OnjL/zZ0y/+K4RP/ntDL/57Qy/+G3' +
  'RP/TojL/06My/9ixRf/zrw3/97IN//G3JP/wshv/97IN/++sDf/hrTL/2pcN/9qXDf/irzL/7agN/+ynDf/dqzL/1ZIN/9WSDf/XpjL/8KoN//KtDf/tsiT/' +
  '8LIb//eyDf/vrA3/06Iy/8iJDf/Hhw3/4K4y//KsDf/yrA3/3qwy/8+NDf/Pjg3/06Iy//OvDf/3sg3/8bck//CyG//3sg3/76wN/+GtMv/alw3/2pcN/+Kv' +
  'Mv/spw3/7KcN/9yqMv/Vkg3/1ZIN/9emMv/wqg3/8qwN/+2yJP/wshv/97IN/++sDf/SoTL/x4gN/8aHDf/grjL/8awN//GsDf/eqzL/zowN/8+NDf/SojL/' +
  '26ox/96tMv/htD7/6Lg4/+q3Mv/lszH/6L5G/+SxMv/jsDL/5LpE/+WyMv/lsjL/47lE/+CuMv/grjL/4rlF/+i0Mv/ptTL/6bs+/96vOP/frTL/2akx/+G3' +
  'Rv/ZqDL/2Kcy/+S6RP/ptTL/6bUy/+C3RP/RoTL/0qEy/9ewRP/NjQ3/1ZIN/9WeJP/wshv/97IN/++sDf/yvTL/97IN//eyDf/otDL/8awN//GsDf/otTL/' +
  '97IN//eyDf/suDL/9rEN//eyDf/xtyT/0pcb/9WSDf/NjQ3/67Yy/+ynDf/spw3/6bUy//eyDf/3sg3/4K4y/86NDf/PjQ3/0qIy/86NDf/Vkg3/1p8k//Cy' +
  'G//3sg3/76wN//K9Mv/3sg3/97IN/+i0Mv/yrA3/8qwN/+i1Mv/3sg3/97IN/+y4Mv/2sQ3/97IN//G3JP/Tlxv/1ZIN/82NDf/rtjL/7agN/+ynDf/ptTL/' +
  '97IN//eyDf/grjL/z40N/8+ODf/TojL/1aQx/9moMv/csD7/47U5/+WzMv/grjD/6b9G/+azMv/lszL/5btE/+ayMv/msjL/5rxE/+q3Mv/qtzL/6L5F/+e0' +
  'Mv/otDL/6Ls+/9irOf/aqDL/1KQw/+W7Rv/frTL/3qwy/+a8RP/qtzL/6rcy/+K5RP/WpTL/16Yy/9uzRf/zrw3/97IN//G3JP/Mkhv/z40N/8aHDf/bqTL/' +
  '1ZIN/9OSDf/frTL/7KcN/+ynDf/mszL/97IN//eyDf/rtzL/2pYN/9qXDf/coyT/8LIb//eyDf/vrA3/0aEy/8eIDf/Fhg3/4rAy//eyDf/3sg3/6rcy//ey' +
  'Df/3sg3/7bky//OvDf/3sg3/8bck/86TG//Pjg3/yIgN/9ypMv/Vkg3/1ZIN/+CtMv/tqA3/7KcN/+ezMv/3sg3/97IN/+u4Mv/alw3/2pcN/92jJP/wshv/' +
  '97IN/++sDf/UojL/yIkN/8eIDf/jsDL/97IN//eyDf/qtzL/97IN//eyDf/tuTL/7rYn//G4KP/vvTf/06Ix/9SeKP/NmSf/37RB/9iiKP/Xoij/47ZA/+mw' +
  'KP/psCj/6LtA//G4KP/xuCj/675A/92lKP/epij/4bA3/+25Mf/xuCj/67Qn/9muQf/OmSj/zZgo/+W5QP/xuCj/8bgo/+q9QP/xuCj/8bgo/+u+QP/srRf/' +
  '8LEX/+y2K//rsSP/8LEX/+mrF//uvDf/8LEX//CxF//WqDb/zJAX/8yPF//Qozf/zI8X/8yQF//TpTf/768X//CxF//stiv/67Ej//CxF//pqxf/4K83/9ia' +
  'F//Xmhf/26s2/9iaF//Ymhf/3682/+urF//rqxf/5rU3//OvDf/3sg3/8bck//CyG//3sg3/76wN//K9Mv/3sg3/97IN/9inMv/Pjg3/z40N/9KiMv/PjQ3/' +
  'z44N/9WjMv/2sQ3/97IN//G3JP/wshv/97IN/++sDf/hrTL/2pcN/9qXDf/cqTL/2pcN/9qXDf/grTL/8qwN//KtDf/ptTL/7K0X//CxF//stiv/67Ej//Cx' +
  'F//pqxf/7rw3//CxF//wsRf/1qg2/8yQF//Mjxf/0KM3/8yPF//MkBf/06U3/++vF//wsRf/7LYr/+uxI//wsRf/6asX/+CvN//Ymhf/15oX/9urNv/Ymhf/' +
  '2JoX/9+vNv/rqxf/66sX/+a1N//utif/8bgo/++9N//dqjH/3qYo/9miJ//wwkH/8bgo//G4KP/qvUD/8bgo//G4KP/it0D/2KIo/9iiKP/csUD/8Lco//G4' +
  'KP/uvTf/zp4x/86ZKP/IlCf/8MJB//G4KP/xuCj/6r1A//G4KP/xuCj/6r1A//G4KP/xuCj/675A//OvDf/3sg3/8bck/9mcG//alw3/1ZMN//K9Mv/3sg3/' +
  '97IN/+q3Mv/3sg3/97IN/+CuMv/Vkg3/1ZIN/9imMv/2sQ3/97IN//G3JP/Hjhv/yIkN/8CDDf/yvTL/97IN//eyDf/qtzL/97IN//eyDf/qtzL/97IN//ey' +
  'Df/tuTL/868N//eyDf/xtyT/2Zwb/9qXDf/Ukg3/8r0y//eyDf/3sg3/6rYy//eyDf/3sg3/360y/9SSDf/Ukg3/1qUy//axDf/3sg3/8bck/8SMG//Ghw3/' +
  'vYAN//K9Mv/3sg3/97IN/+q2Mv/3sg3/97IN/+q2Mv/3sg3/97IN/+25Mv/QoDH/1aQy/9itPv/ntzn/6rYy/+SyMP/twkb/67cy/+q3Mv/mvET/57Qy/+e0' +
  'Mv/mvET/6LUy/+i1Mv/mvEX/zZ4y/9CgMv/Vqj7/47Q5/+SyMv/frjD/6b5G/+SxMv/ksTL/5r1E/+q3Mv/qtzL/4rlE/9emMv/YpjL/27NF/8iIDf/Pjg3/' +
  '0psk//CyG//3sg3/76wN//K9Mv/3sg3/97IN/+i0Mv/yrA3/8qwN/+i1Mv/3sg3/97IN/+q3Mv/Fhg3/yIkN/8yWJP/rrRv/8q0N/+qlDf/rtjL/7agN/+yn' +
  'Df/ptTL/97IN//eyDf/hrzL/1ZIN/9WSDf/WpjL/yIgN/8+NDf/RmiT/8LIb//eyDf/vrA3/8r0y//eyDf/3sg3/57Qy//GsDf/xrA3/6LUy//eyDf/3sg3/' +
  '6rcy/8SFDf/HiA3/y5Uk/+usG//yrA3/6qUN/+u2Mv/spw3/7KcN/+m1Mv/3sg3/97IN/+GvMv/Vkg3/1ZIN/9alMv/aqjH/360y/+C0Pv/ouDj/6rcy/+Wy' +
  'Mf/qv0b/57My/+azMv/mvET/6bUy/+m1Mv/nvET/6rcy/+q3Mv/ovUX/26ky/92rMv/fsz7/4LE4/+GuMv/cqjH/6r9G/+e0Mv/ntDL/5rxE/+q3Mv/qtzL/' +
  '4bhE/9KiMv/TozL/2LFE//OvDf/3sg3/8bck//CyG//3sg3/76wN/+u2Mv/spw3/7KcN/+m1Mv/3sg3/97IN/+q3Mv/3sg3/97IN/+y4Mv/2sQ3/97IN//G3' +
  'JP/ZnBv/2pcN/9WSDf/yvTL/97IN//eyDf/qtzL/97IN//eyDf/grjL/zo0N/8+NDf/SojL/868N//eyDf/xtyT/8LIb//eyDf/vrA3/67Yy/+2oDf/spw3/' +
  '6bUy//eyDf/3sg3/6rcy//eyDf/3sg3/7Lgy//axDf/3sg3/8bck/9mcG//alw3/1ZMN//K9Mv/3sg3/97IN/+q3Mv/3sg3/97IN/+CuMv/PjQ3/z44N/9Oi' +
  'Mv/otTH/6bYy/+m8Pv/ouDn/6rcy/+WzMP/nvUb/4rAy/+KwMv/mvEX/6rcy/+q3Mv/ovkX/6rcy/+q3Mv/ovkX/6bYy/+q3Mv/qvD7/2605/9upMv/XpTD/' +
  '7MFG/+m2Mv/ptjL/575F/+q3Mv/qtzL/4bhF/9GhMv/RojL/2LFF/5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg' +
  '//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//' +
  'luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg' +
  '//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//' +
  'luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg' +
  '//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//' +
  'luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg' +
  '//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//' +
  'luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg' +
  '//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//' +
  'luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg' +
  '//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//' +
  'luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg' +
  '//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//' +
  'luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg' +
  '//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//' +
  'luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg' +
  '//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//' +
  'luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg' +
  '//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//' +
  'luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg' +
  '//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//' +
  'luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg' +
  '//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//' +
  'luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg' +
  '//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//' +
  'luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg' +
  '//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//' +
  'luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg' +
  '//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//' +
  'luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg' +
  '//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//' +
  'luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg' +
  '//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//' +
  'luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg' +
  '//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//' +
  'luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg' +
  '//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//' +
  'luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg' +
  '//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//' +
  'luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg' +
  '//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//' +
  'luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg' +
  '//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//' +
  'luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg' +
  '//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//8bYpf/' +
  'G2KX/xtil/8bYpf/G2KX/xtil/8bYpf/G2KX/xtil/8bYpf/G2KX/xtil/8bYpf/G2KX/xtil/8bYpf/G2KX/xtil/8bYpf/G2KX/xtil/8bYpf/G2KX/xti' +
  'l/8bYpf/G2KX/xtil/8bYpf/G2KX/xtil/8bYpf/G2KX/x1qof8daqH/HWqh/xtkmP8hd7b/IXe2/x9wrP8ifL3/Iny9/yJ8vf8ifL3/H3Gs/x5uqP8cZZn/' +
  'HXWy/x2DuP8dg7j/HXaz/x1rov8bZJj/IXe2/yF3tv8fcKz/Iny9/yJ8vf8ifL3/Iny9/x9xrP8ebqj/HGSY/x1qof8daqH/I4HE/yOBxP8hebj/Hmqi/yB3' +
  'tP8gd7T/H3Cr/yJ9vf8ifb3/Iny8/yN/wP8liM7/JYjO/yF4tv8jgcT/I4HE/yOBxP8jgcT/IXm4/x5qov8gd7T/IHe0/x9wq/8ifb3/In29/yJ8vP8jf8D/' +
  'JYjO/yWIzv8heLb/I4HE/yOBxP8jgcT/I4HE/yBzsP8gc6//I4HD/yOBw/8jgcP/I4HD/yOBw/8jgcP/IHOv/yN+vv8jfr//H3Gt/yOBxP8emtD/I4HE/yOB' +
  'xP8gc7D/IHOv/yOBw/8jgcP/I4HD/yOBw/8jgcP/I4HD/yBzr/8jfr7/I36//x9xrf8jgcT/Hm2m/yOBxP8jgcT/IHWx/yF2s/8gdbL/IHaz/yB2s/8gdrP/' +
  'IHaz/yB2s/8cZZv/HWqi/x1qov8bYpb/IIHF/x+Vzv8jgcT/I4HE/yB1sf8hdrP/IHWy/yB2s/8gdrP/IHaz/yB2s/8gdrP/HGWb/x1qov8daqL/G2GV/yBz' +
  'r/8fcKr/IHWy/yB1sv8fcq3/JIPG/yF5uP8khMj/JITI/ySEyP8khMj/JITI/x9yrv8ie7v/Inu7/x9uqP8gdrP/HYe9/yB1sv8gdbL/H3Kt/ySDxv8hebj/' +
  'JITI/ySEyP8khMj/JITI/ySEyP8fcq7/Inu7/yJ7u/8fbqj/IHaz/x1pn/8heLf/IXi3/yByrv8khMj/JITI/ySEyP8ifb3/JIPG/ySDxv8kg8b/H3Gs/yF5' +
  'uf8hebn/IXe3/yB3tf8eisH/IXi3/yF4t/8gcq7/JITI/ySEyP8khMj/In29/ySDxv8kg8b/JIPG/x9xrP8hebn/IXm5/yF3t/8gd7X/Hmuj/yJ7u/8ie7v/' +
  'IHOu/ySEyP8khMj/JITI/yF4t/8heLb/IXi2/yF4tv8caJ7/Hm+q/x5vqv8ecKv/Hn2+/xyUyv8ie7v/Inu7/yBzrv8khMj/JITI/ySEyP8heLf/IXi2/yF4' +
  'tv8heLb/HGie/x5vqv8eb6r/Hm+q/x5ro/8cZZr/H3Cr/x9wq/8fcKr/JITI/ySEyP8khMj/JITI/ySEyP8khMj/JITI/x9xrP8gc6//IHOv/yByr/8ebqj/' +
  'HIO3/x9wq/8fcKv/H3Cq/ySEyP8khMj/JITI/ySEyP8khMj/JITI/ySEyP8fcaz/IHOv/yBzr/8gcq//Hm2n/xxjl/8jgcT/I4HE/yB0sf8khMj/JITI/ySE' +
  'yP8khMj/JITI/ySEyP8jgcP/IXm3/yaN1/8mjdf/JovV/yB2tP8gksz/I4HE/yOBxP8gdLH/JITI/ySEyP8khMj/JITI/ySEyP8khMj/I4HD/yF5t/8mjdf/' +
  'Jo3X/yaL1f8gdrT/IHOv/yBzsP8ebKT/HGWZ/yF2s/8hdrP/IXaz/yF2s/8gdrP/IHay/yF2s/8hebf/In7A/yWHzv8mi9X/IHa0/yCQy/8gksz/Hn/D/xxm' +
  'nP8hdrP/IXaz/yF2s/8hdrP/IHaz/yB2sv8hdrP/IXm3/yJ+wP8lh87/JovV/yB2tP8gdbP/I4HE/yOBxP8gc6//I4DD/yOAw/8jgMP/I4DD/yOAw/8jgMP/' +
  'I4DD/yF3tf8ifsH/Jo3X/yaL1f8gdrT/I4HE/yOBxP8jgcT/IHOv/yOAw/8jgMP/I4DD/yOAw/8jgMP/I4DD/yOAw/8hd7X/In7B/yaN1/8mi9X/IHa0/yOB' +
  'xP8jgcT/I4HE/yF5uf8gdrT/IHa0/yB2tP8gc7D/I4LG/yOCxv8jgcX/JITK/yJ+wf8mjdf/JovV/yB2tP8jgcT/I4HE/yOBxP8hebn/IHa0/yB2tP8gdrT/' +
  'IHOw/yOCxv8jgsb/I4HF/ySEyv8ifsH/Jo3X/yaL1f8gdrT/I4HE/yBzr/8gdLD/IHSw/yB0sP8gdLD/IHSw/x9vqf8if8H/In7B/yJ/wf8if8H/H3Ov/yOB' +
  'xf8mi9X/IHa0/yCWzf8gk83/IILG/yB0sf8gdLD/IHSw/yB0sP8fb6n/In/B/yJ+wf8if8H/In/B/x9zr/8jgcX/JovV/yB2tP8gcq7/I4HE/yOBxP8jgcT/' +
  'I4HE/yOBxP8jgcT/IXe2/ySGzP8khsz/JIbM/ySGzP8heLf/JITJ/ySEyv8gdrP/I4HE/yOBxP8jgcT/I4HE/yOBxP8jgcT/I4HE/yF3tv8khsz/JIbM/ySG' +
  'zP8khsz/IXi3/ySEyf8khMr/IHaz/yOBxP8jgcT/I4HE/yOBxP8jfr//I4HE/yOBxP8gdLD/I4DD/yOAw/8jgMP/I4DD/yBzr/8jgMP/IHOv/yN+wf8jgcT/' +
  'I4HE/yOBxP8jgcT/I36//yOBxP8jgcT/IHSw/yOAw/8jgMP/I4DD/yOAw/8gc6//I4DD/yBzr/8jfsH/I4HE/yOBxP8jgcT/I4HE/x5tpf8jgMP/I4HE/yF4' +
  't/8liM7/JYjO/x9yrf8iern/HWqh/yWIzv8heLb/I4HE/yOBxP8jgcT/I4HE/yOBxP8ebaX/I4DD/yOBxP8heLf/JYjO/yWIzv8fcq3/Inq5/x1qof8liM7/' +
  'IXi2/yOBxP8jgcT/IHSw/yB0sP8gdLD/HWqh/yOBxP8jgcT/IXi3/yWIzv8liM7/JYjO/yWIzv8gdbL/IXq5/x5spP8gf8H/IIzH/yCNx/8gf8H/IHSx/x1q' +
  'of8jgcT/I4HE/yF4t/8liM7/JYjO/yWIzv8liM7/IHWy/yF6uf8ea6P/IHSw/yB0sP8jgcT/I4HE/yF5uP8eaqL/IHe0/yB3tP8fcKv/In29/yJ9vf8ifLz/' +
  'I3/A/yWIzv8liM7/IXi2/yOBxP8jgcT/I4HE/yOBxP8hebj/Hmqi/yB3tP8gd7T/H3Cr/yJ9vf8ifb3/Iny8/yN/wP8liM7/JYjO/yF4tv8jgcT/I4HE/yOB' +
  'xP8jgcT/IHOw/yBzr/8jgcP/I4HD/yOBw/8jgcP/I4HD/yOBw/8gc6//I36+/yN+v/8fca3/I4HE/x6a0P8jgcT/I4HE/yBzsP8gc6//I4HD/yOBw/8jgcP/' +
  'I4HD/yOBw/8jgcP/IHOv/yN+vv8jfr//H3Gt/yOBxP8ebab/I4HE/yOBxP8gdbH/IXaz/yB1sv8gdrP/IHaz/yB2s/8gdrP/IHaz/xxlm/8daqL/HWqi/xti' +
  'lv8ggcX/H5XO/yOBxP8jgcT/IHWx/yF2s/8gdbL/IHaz/yB2s/8gdrP/IHaz/yB2s/8cZZv/HWqi/x1qov8bYZX/IHOv/x9wqv8gdbL/IHWy/x9yrf8kg8b/' +
  'IXm4/ySEyP8khMj/JITI/ySEyP8khMj/H3Ku/yJ7u/8ie7v/H26o/yB2s/8dh73/IHWy/yB1sv8fcq3/JIPG/yF5uP8khMj/JITI/ySEyP8khMj/JITI/x9y' +
  'rv8ie7v/Inu7/x9uqP8gdrP/HWmf/yF4t/8heLf/IHKu/ySEyP8khMj/JITI/yJ9vf8kg8b/JIPG/ySDxv8fcaz/IXm5/yF5uf8hd7f/IHe1/x6Kwf8heLf/' +
  'IXi3/yByrv8khMj/JITI/ySEyP8ifb3/JIPG/ySDxv8kg8b/H3Gs/yF5uf8hebn/IXe3/yB3tf8ea6P/Inu7/yJ7u/8gc67/JITI/ySEyP8khMj/IXi3/yF4' +
  'tv8heLb/IXi2/xxonv8eb6r/Hm+q/x5wq/8efb7/HJTK/yJ7u/8ie7v/IHOu/ySEyP8khMj/JITI/yF4t/8heLb/IXi2/yF4tv8caJ7/Hm+q/x5vqv8eb6r/' +
  'Hmuj/xxlmv8fcKv/H3Cr/x9wqv8khMj/JITI/ySEyP8khMj/JITI/ySEyP8khMj/H3Gs/yBzr/8gc6//IHKv/x5uqP8cg7f/H3Cr/x9wq/8fcKr/JITI/ySE' +
  'yP8khMj/JITI/ySEyP8khMj/JITI/x9xrP8gc6//IHOv/yByr/8ebaf/HGOX/yOBxP8jgcT/IHSx/ySEyP8khMj/JITI/ySEyP8khMj/JITI/yOBw/8hebf/' +
  'Jo3X/yaN1/8mi9X/IHa0/yCSzP8jgcT/I4HE/yB0sf8khMj/JITI/ySEyP8khMj/JITI/ySEyP8jgcP/IXm3/yaN1/8mjdf/JovV/yB2tP8gc6//IHOw/x5s' +
  'pP8cZZn/IXaz/yF2s/8hdrP/IXaz/yB2s/8gdrL/IXaz/yF5t/8ifsD/JYfO/yaL1f8gdrT/IJDL/yCSzP8ef8L/HGac/yF2s/8hdrP/IXaz/yF2s/8gdrP/' +
  'IHay/yF2s/8hebf/In7A/yWHzv8mi9X/IHa0/yB1s/8jgcT/I4HE/yBzr/8jgMP/I4DD/yOAw/8jgMP/I4DD/yOAw/8jgMP/IXe1/yJ+wf8mjdf/JovV/yB2' +
  'tP8jgcT/I4HE/yOBxP8gc6//I4DD/yOAw/8jgMP/I4DD/yOAw/8jgMP/I4DD/yF3tf8ifsH/Jo3X/yaL1f8gdrT/I4HE/yOBxP8jgcT/IXm5/yB2tP8gdrT/' +
  'IHa0/yBzsP8jgsb/I4LG/yOBxf8khMr/In7B/yaN1/8mi9X/IHa0/yOBxP8jgcT/I4HE/yF5uf8gdrT/IHa0/yB2tP8gc7D/I4LG/yOCxv8jgcX/JITK/yJ+' +
  'wf8mjdf/JovV/yB2tP8jgcT/F4zQ/xmGyP8ZhMb/GIrP/xmHyv8ZhMb/GIjL/xmLz/8ahsr/GYvP/xmM0f8Zg8X/GYrN/xmN0v8ZgsL/GYXH/xeM0P8ZhMb/' +
  'GYTG/xeM0P8Zhsj/GYTG/xiKzf8ais7/GobK/xmM0f8Zi8//GYPF/xmLz/8ZjNH/GYHC/xmHyf8RYZr/FGOc/xRjm/8SYpv/FGOd/xRim/8SYpz/E2Kc/xRi' +
  'm/8TYpz/E2Kd/xRim/8TYpz/EmKc/xRjm/8UY5v/EWGb/xRjnf8UY53/EWGa/xRjnP8UY5v/EmKb/xRjnf8UYpv/EmKc/xNinP8UYpv/E2Kc/xNinf8UYpv/' +
  'E2Kc/x5vqv8eb6r/Hm+q/x5vqv8eb6r/Hm+q/x5vqv8eb6r/Hm+q/x5vqv8eb6r/Hm+q/x5vqv8eb6r/Hm+q/x5vqv8eb6r/Hm+q/x5vqv8eb6r/Hm+q/x5v' +
  'qv8eb6r/Hm+q/x5vqv8eb6r/Hm+q/x5vqv8eb6r/Hm+q/x5vqv8eb6r/0cq4/9HLuP/KxLH/qKKQ/8jBrf/Hwa7/ycO0/8jCrv/Jw6//ysOv/8nCr//Jw6//' +
  'ycOv/8nCr//Jw7D/ycKv/8nCr//Jw6//ycKv/8nDr//Jwq//ycKv/8rDr//Jw6//yMKu/8nDtP/Hwa7/yMGt/6mjkf/KxLH/0cu4/9HLuP/Sy7n/y8Sx/6ik' +
  'lv9ramj/d3Np/4F/ef9+fn7/g4B3/4B7b/9/e2//eHRo/3h0aP94dGj/eHRo/3h0aP95dGj/eXRo/3h0aP94dGj/eHRo/3h0aP94dGj/f3tv/4B7b/+Cf3f/' +
  'fn5+/4KAev92c2n/bGpn/6eilv/KxLH/0su5/8rEsv+ppZj/TUtG/3t3af+CfnD/WVhV/1FRUf9VUEj/W1BC/2xdQv9RS0T/RERE/0NDQ/9ERET/RERE/0RE' +
  'RP9ERET/RERE/0RERP9DQ0P/RERE/09KQ/9sXUL/W1BC/1VQSP9SUlL/WllW/315bP98d2n/TUtH/6ijlv/KxLL/p6GQ/2hnZ/+Mh3j/yL+l/8vCqf96d3D/' +
  'ZWVk/4qFef/Qx67/0ciu/9HIr//AuaX/vrej/722ov+9tqL/vbai/722ov+9tqL/vbai/722ov+/uKP/z8at/8/Grf/Oxaz/jIh7/2VlZP9/fHX/y8Kp/8i/' +
  'pf+Mh3f/aGhn/6ehkf/Jwq7/hIB1/5GMff/Mw6r/z8at/8W9p/+wqZf/1cyz/9nQuP/a0rr/2tK6/9rSuf/a0rr/2dG5/9jQt//Y0Lf/2M+3/9fOtf/Yz7b/' +
  '2M+2/9fOtf/Xz7b/1861/9XMtP/Sya//squX/8O7pv/NxKv/y8Kp/5GMff+EgXX/ycKv/8jCrv+FgXb/lI+A/8/GrP/Uy7L/2dG4/9/Wvv/i2cL/49rD/+Pb' +
  'xP/j28T/49vE/+PbxP/j28T/4trD/+Pbw//i2sP/4trD/+Law//i2sL/4dnC/+HZwv/h2cL/39e//93UvP/Z0Lf/08qx/87FrP/Mw6r/lI6A/4WCdv/Iwq7/' +
  'ycKv/4WBdv+VkIH/0Meu/9jPt//g2MD/5dzF/+bfx//n38j/59/I/+ffyP/m38f/5t/H/+bfx//m3sf/5t7H/+bex//m3sf/5t7H/+bex//m3sf/5t7H/+be' +
  'x//l3cb/49vE/97Wvv/WzbT/0Meu/83Eq/+VkIH/hoJ2/8nCr//Jwq//hYF2/5eRg//SybD/29O6/+Tcxf/n38j/59/I/+ffyP/n38j/59/I/+ffyP/n38j/' +
  '59/I/+ffyP/n38j/59/I/+ffyP/n38j/59/I/+ffyP/n38j/59/I/+ffyP/l3cb/4dnB/9nRuP/RyK//zcSr/5aRgv+Fgnb/ycKv/8rDsP+FgXb/lpGD/9TL' +
  'sv/e1b3/5d3G/+ffyP/n38j/59/I/+ffyP/n38j/5t7H/+ffyP/n38j/5t7H/+ffyP/n38j/5t7H/+ffyP/n38j/5t7H/+ffyP/n38j/5t/I/+Xdxv/h2cL/' +
  '2tG5/9HIr//OxKz/lpGD/4WCdv/Kw7D/ysOv/4WBdv+XkYP/1Myz/+DYwP/l3sb/59/I/+ffyP/n38j/59/I/+ffyP/n38j/59/I/+ffyP/n38j/59/I/+ff' +
  'yP/n38j/59/I/+ffyP/n38j/59/I/+ffyP/n38j/5d3G/+HZwv/a0bn/0smw/87ErP+XkYP/hYJ3/8rDr//Jw6//fnpv/357cf/VzbT/4dnB/+Xexv/n38j/' +
  '59/I/+ffyf/n38j/59/I/+ffyf/n38j/59/I/+jgyf/n38j/59/I/+jgyf/n38j/59/I/+ffyf/n38j/59/I/+ffyP/l3cb/4dnB/9rSuf/TyrH/zsWs/357' +
  'cf9+em//ycOv/8rDsP9/e3D/TU1N/8S+qv/f18D/5t7H/+ffyP/m3sf/5t7H/+ffyP/n38j/5t7H/+ffyP/n38j/5t7H/+ffyP/n38j/5t7H/+ffyP/n38j/' +
  '5t7H/+ffyf/n38j/5t7H/+Tcxf/i2sL/29K6/9HIr/+9tqH/TU1N/397b//Kw7D/ysOw/397b/9OTk7/w7yp/+HZwv/m38f/59/I/+ffyP/n38n/59/J/+ff' +
  'yf/n38n/59/J/+ffyf/n38n/59/J/+ffyf/n38n/59/J/+ffyf/n38n/59/J/+ffyf/n38j/5d3G/+Lawv/b0rr/08qx/7uzoP9NTU3/f3tv/8rDsP/Kw7D/' +
  'f3tw/01NTf/Evar/4trD/+bex//n38j/59/J/+ffyf/n38n/59/J/+ffyf/n38n/59/J/+ffyf/n38n/59/J/+ffyf/n38n/59/J/+ffyf/n38n/59/J/+ff' +
  'yP/l3sb/4trC/9vSuv/Uy7H/u7Sg/01NTf9/e3D/ysOw/8rDsP9/e2//TU1N/8S9qv/h2cH/59/I/+ffyP/m3sf/5t7I/+ffyf/n38n/59/J/+ffyf/n38n/' +
  '59/J/+ffyf/n38n/59/J/+ffyf/n38n/59/J/+ffyf/n38n/5t7H/+Xdxv/i2sP/3NO7/9LJsP+7s6D/Tk5N/397b//Kw7D/ysOw/397cP9OTk7/xL6r/+Pb' +
  'w//n38j/59/I/+ffyf/n38n/59/J/+ffyf/n38n/59/J/+ffyf/n38n/59/J/+ffyf/n38n/59/J/+ffyf/n38n/59/J/+ffyf/n38n/5t7H/+Paw//c1Lz/' +
  '1Muy/7u0oP9OTk3/f3tw/8rDsP/Kw7D/f3tw/01NTf/Fvqv/49vE/+ffyP/n38j/59/J/+ffyf/n38n/59/J/+ffyf/n38n/59/J/+ffyf/n38n/59/J/+ff' +
  'yf/n38n/59/J/+ffyf/n38n/59/J/+ffyf/m3sf/49vE/93Vvf/Uy7P/u7Sh/05OTf9/e3D/ysOw/8rDsP9/e2//Tk5O/8W+q//i2sL/5t/I/+ffyP/m3sf/' +
  '5t7I/+ffyf/n38n/59/J/+ffyf/n38n/59/J/+ffyf/n38n/59/J/+ffyf/n38n/59/J/+ffyf/n38n/5t7H/+Xexv/k28T/3tW9/9PKsf+7tKD/TU1N/397' +
  'b//Kw7D/ysOw/397cP9NTU3/xb+s/+PbxP/m3sf/59/I/+ffyf/n38n/59/J/+ffyf/n38n/59/J/+ffyf/n38n/59/J/+ffyf/n38n/59/J/+ffyf/n38n/' +
  '59/J/+ffyf/n38n/5t7H/+Tcxf/e1b7/1c2z/7y0of9NTU3/f3tw/8rDsP/Kw7D/f3tv/01NTf/Fv6z/49vE/+ffyP/n38j/59/I/+ffyf/n38n/59/J/+ff' +
  'yf/n38n/59/J/+ffyf/n38n/59/J/+ffyf/n38n/59/J/+ffyf/n38n/59/J/+ffyf/m3sf/5NzF/9/Xv//VzbT/vLSh/05OTf9/e2//ysOw/8rDsP9/e3D/' +
  'TU1N/8fBrf/h2cL/5t/H/+ffyP/m3sf/597H/+ffyP/n38j/5t7H/+ffyP/n38j/5t7H/+ffyP/n38j/5t7H/+ffyP/n38j/5t7H/+ffyP/n38j/5t7H/+Xe' +
  'xv/k3MX/39e//9TMs/++t6P/Tk5N/397cP/Kw7D/ycOv/356b/9+e3H/2dC4/+Pbw//m3sf/59/I/+ffyP/n38n/59/I/+ffyP/n38n/59/I/+ffyP/o4Mn/' +
  '59/I/+ffyP/o4Mn/59/I/+ffyP/n38n/59/I/+ffyP/n38n/5t/I/+Tcxf/g2MD/1861/9DHrf9+e3H/fnpv/8nDr//Kw7D/hYF3/5eSg//Y0Lf/49vD/+be' +
  'x//n38j/59/I/+ffyP/n38j/59/I/+ffyP/n38j/59/I/+ffyP/n38j/59/I/+ffyP/n38j/59/I/+ffyP/n38j/59/I/+ffyP/n38j/5N3F/+DYwP/XzrX/' +
  '0Meu/5aRg/+Ggnb/ysOv/8rDsP+FgXb/lpGD/9jPt//h2cL/5d7G/+ffyP/n38j/59/I/+ffyP/n38j/5t7H/+ffyP/n38j/5t7H/+ffyP/n38j/5t7H/+ff' +
  'yP/n38j/5t7H/+ffyP/n38j/59/I/+bex//l3cb/4NjA/9bOtf/Qx67/lpGD/4WCdv/Kw7D/ycKv/4WBdv+WkYP/1862/+HZwv/l3sb/59/I/+ffyP/n38j/' +
  '59/I/+ffyP/n38j/59/I/+ffyP/n38j/59/I/+ffyP/n38j/59/I/+ffyP/n38j/59/I/+ffyP/n38j/59/I/+Tdxf/g2MH/1861/8/Grf+WkYP/hYJ2/8nC' +
  'r//Jwq//hYF2/5WQgf/Uy7L/39a//+Tcxf/l3sb/5t7H/+bex//m3sf/5t7H/+bex//m3sf/5t7H/+bex//m3sf/5t7H/+bex//m3sf/5t7H/+bex//m3sf/' +
  '5t7H/+bex//m3sf/5NzF/9/Xv//WzbX/z8as/5WQgf+Fgnb/ycKv/8jCrv+FgXb/lI+A/9HIr//Z0Lj/39a//+HZwv/i2sP/4trD/+Paw//j2sP/4trD/+Pa' +
  'w//j2sP/4trD/+Paw//j28T/49vE/+TbxP/k3MT/49vE/+TbxP/k28T/5NvE/+PcxP/h2cH/29K6/9PKsf/NxKv/lI+A/4WCdv/Jwq7/ycKv/4SAdf+RjH3/' +
  'zcSr/9LJsP/Iwav/squZ/9fOtv/b0rr/29O6/9vTuv/b0rr/29O6/9vTuv/a0rn/29O6/9vTuv/b07r/3NS8/93VvP/c1Lz/3dW9/93Vvf/d1bz/2NC3/7Gr' +
  'mP/Gv6n/z8at/8vDqf+RjH3/hIF1/8nCr/+oopH/aGhm/4yGeP/Iv6X/zMOq/356cv9lZWT/j4t8/9DHrv/Qx67/0civ/8G6pf+/uKP/v7ek/7+4o/+/uKT/' +
  'v7ik/7+4pP/AuaX/wLml/8K7p//TyrD/0smw/9HJsP+Uj4D/Y2Nj/4J+df/Lwqn/yL+l/4yHeP9oaGb/qKKS/8rEsv+opJf/S0lF/3p1Z/+CfW7/W1pW/1FR' +
  'Uf9XUUj/V00//2hZP/9OSED/RERE/0RERP9ERET/RERE/0RERP9ERET/RERE/0RERP9DQ0P/RERE/0xHQP9oWT//V00//1ZRSP9SUlL/WVhV/397b/96dWn/' +
  'TUxI/6ejlv/KxLL/0su5/8vEsf+no5b/amln/3dzav+CgHr/fn5+/4J/d/9/em7/fnpu/3dzZ/93c2f/d3Nn/3dzZ/94c2f/eHNn/3hzZ/93c2f/d3Nn/3dz' +
  'Z/93c2f/d3Nn/356bf9/em7/gX92/35+fv+CgHr/dnNp/2ppZv+mopX/ysOx/9LLuf/Ryrj/0cu4/8rEsf+oopD/yMGt/8fBrv/IwrT/yMGu/8nDr//Kw6//' +
  'ycKv/8nCr//Jw6//ycKv/8nDr//Jwq//ycKv/8nDsP/Jwq//ycOv/8nCr//Jwq//ysOv/8nDr//Iwa7/xcCz/8bArf/Iwa3/qaOR/8rEsf/Ry7j/0cq4/0tK' +
  'Sv8+PTz/PTw7/zw7Ov89PDv/PTw7/z48PP8+PTz/Pj08/z48PP89PDv/PTw7/zw7Ov89PDv/PTw7/zk4N/85ODf/PTw7/z08O/88Ozr/PTw7/z08O/8+PTz/' +
  'Pj08/z49PP8+PDz/PTw7/z08O/88Ozr/PTw7/z49PP9LS0r/SUlJ/3yJi/+gs7j/oLO4/6CzuP+gs7j/oLO4/5+zuf+gs7n/oLO4/6CzuP+gs7j/oLK4/6Cz' +
  'uP+gs7j/obO4/6GzuP+gs7j/oLO4/6CzuP+gs7j/oLO4/6CzuP+gs7j/n7O4/6CzuP+gsrj/oLO4/6CzuP+gs7j/fImL/0lJSf9ISUj/l6qt/8zm7//L5u//' +
  'zObv/8vm7//M5u//y+bv/8zm7//L5u//zObv/8zm7//M5u//y+bv/8zm7//M5u//zObv/8zm7//M5u//zObv/8zm7//M5u//y+bv/8zm7//L5u//zObv/8vm' +
  '7//M5u//y+bv/8zm7/+Xqq3/SElI/09OTv8/Pj3/ODc2/zg4N/85ODf/OTg3/zk4N/86OTj/OTg3/zk4N/85ODf/OTg3/zg3Nv85ODf/OTg3/zY1NP82NTT/' +
  'ODg3/zk4N/84Nzb/OTg3/zk4Nv85OTj/OTk3/zo5OP85ODf/OTg3/zk4N/84ODf/ODc2/z4+Pf9PTk7/V1dX/0NCQv+wihX/xZkR/8WZEf/GmRL/xpkS/8aZ' +
  'Ev/GmRL/w5gS/8WZEv/FmRH/xZkR/8WZEf/GmRL/w5cQ/8OXEP/GmhL/xpkR/8aZEf/GmRH/xpkS/8SYEv/GmhL/xpoS/8aZEv/GmRL/xpkR/8aZEf+xihX/' +
  'Q0JC/1dXV/9jYmP/SklI/9umBv/4uwH/+LsB//i7Af/4uwH/+LsB//i7Af/1uQH/+LsB//i7Af/4uwH/+LsB//i7Af/3ugH/97oB//i7Af/4uwH/+LsB//i7' +
  'Af/4uwH/9bkB//i7Af/4uwH/+LsB//i7Af/4uwH/+LsB/9umBv9KSUj/YmJj/2JiYv9JSEf/26YG//i7Af/4uwH/+LsB//i7Af/4uwH/+LsB//W5Af/4uwH/' +
  '+LsB//i7Af/4uwH/+LsB//e6Af/3ugH/+LsB//i7Af/4uwH/+LsB//i7Af/1uQH/+LsB//i7Af/4uwH/+LsB//i7Af/4uwH/26YG/0lIR/9iYmL/YmJi/0pJ' +
  'SP/bpgb/+LsB//i7Af/4uwH/+LsB//i7Af/4uwH/9bkB//i7Af/4uwH/+LsB//i7Af/4uwH/97oB//e6Af/4uwH/+LsB//i7Af/4uwH/+LsB//W5Af/4uwH/' +
  '+LsB//i7Af/4uwH/+LsB//i7Af/bpgb/SklI/2JiYv9jY2P/SklI/9ShBv/wtQH/8LQB//C1Af/wtQH/8LUB//C1Af/tsgH/8LUB//C1Af/wtAH/8LUB//C1' +
  'Af/vswH/77MB//C1Af/wtQH/8LQB//C1Af/wtAH/7bIB//C1Af/wtQH/8LUB//C0Af/wtQH/8LUB/9ShBv9LSUj/Y2Nj/2NjY/9LSkn/05gG/+6qAf/uqgH/' +
  '7qoB/+6qAf/uqgH/7qoB//G0Af/0uAH/9LgB//S4Af/0uAH/9LgB//O3Af/ztwH/9LgB//S4Af/0uAH/9LgB//S4Af/xtgH/9LgB//S4Af/0uAH/9LgB//S4' +
  'Af/0uAH/2KQG/0tKSf9jY2P/YmJi/0pJSP/Rjwb/7J8B/+yfAf/snwH/7J8B/+yfAf/snwH/9LYB//i7Af/4uwH/+LsB//i7Af/4uwH/97oB//e6Af/4uwH/' +
  '+LsB//i7Af/4uwH/+LsB//W5Af/4uwH/+LsB//i7Af/4uwH/+LsB//i7Af/bpgb/SklI/2JiYv9gYGD/SUhH/9GPBv/snwH/7J8B/+yfAf/snwH/7J8B/+yf' +
  'Af/0tgH/+LsB//i7Af/4uwH/+LsB//i7Af/3ugH/97oB//i7Af/4uwH/+LsB//i7Af/4uwH/9bkB//i7Af/4uwH/+LsB//i7Af/4uwH/+LsB/9umBv9JSEf/' +
  'YGBg/19fX/9IR0f/0Y8G/+yfAf/snwH/7J8B/+yfAf/snwH/7J8B//S2Af/4uwH/+LsB//i7Af/4uwH/+LsB//e6Af/3ugH/+LsB//i7Af/4uwH/+LsB//i7' +
  'Af/1uQH/+LsB//i7Af/4uwH/+LsB//i7Af/4uwH/26YG/0hHR/9fX1//X19f/0lIR//Rjwb/7J8B/+yfAf/snwH/7J8B/+yfAf/snwH/9LYB//i7Af/4uwH/' +
  '+LsB//i7Af/4uwH/97oB//e6Af/4uwH/+LsB//i7Af/4uwH/+LsB//W5Af/4uwH/+LsB//i7Af/4uwH/+LsB//i7Af/bpgb/SUhH/19fX/9gYGD/SUhH/9GP' +
  'Bv/snwH/7J8B/+yfAf/snwH/7J8B/+yfAf/0tgH/+LsB//i7Af/4uwH/+LsB//i7Af/3ugH/97oB//i7Af/4uwH/+LsB//i7Af/4uwH/9bkB//i7Af/4uwH/' +
  '+LsB//i7Af/4uwH/+LsB/9umBv9JSEf/YGBg/15eXv9JSEf/0I8G/+ufAf/rnwH/658B/+ufAf/rnwH/658B//O1Af/3ugH/97oB//e6Af/3ugH/97oB//a5' +
  'Af/2uQH/97oB//e6Af/3ugH/97oB//e6Af/0uAH/9rkB//a5Af/2uQH/9rkB//a5Af/2uQH/2qUG/0lIRv9eXl7/Xl5e/0lIRv/apQb/97oB//e6Af/3ugH/' +
  '97oB//e6Af/3ugH/9LgB//e6Af/3ugH/97oB//e6Af/3ugH/9rkB//a5Af/3ugH/97oB//e6Af/3ugH/97oB//O2Af/rngH/654B/+ueAf/rngH/654B/+ue' +
  'Af/Qjgb/SUhG/15eXv9gYGD/SUhH/9umBv/4uwH/+LsB//i7Af/4uwH/+LsB//i7Af/1uQH/+LsB//i7Af/4uwH/+LsB//i7Af/3ugH/97oB//i7Af/4uwH/' +
  '+LsB//i7Af/4uwH/9LcB/+yfAf/snwH/7J8B/+yfAf/snwH/7J8B/9GOBv9JSEf/YGBg/19fX/9JSEf/26YG//i7Af/4uwH/+LsB//i7Af/4uwH/+LsB//W5' +
  'Af/4uwH/+LsB//i7Af/4uwH/+LsB//e6Af/3ugH/+LsB//i7Af/4uwH/+LsB//i7Af/0twH/7J8B/+yfAf/snwH/7J8B/+yfAf/snwH/0Y4G/0lIR/9fX1//' +
  'X19f/0hIRv/bpgb/+LsB//i7Af/4uwH/+LsB//i7Af/4uwH/9bkB//i7Af/4uwH/+LsB//i7Af/4uwH/97oB//e6Af/4uwH/+LsB//i7Af/4uwH/+LsB//S3' +
  'Af/snwH/7J8B/+yfAf/snwH/7J8B/+yfAf/Rjwb/SEdH/19fX/9gYGD/SUhH/9umBv/4uwH/+LsB//i7Af/4uwH/+LsB//i7Af/1uQH/+LsB//i7Af/4uwH/' +
  '+LsB//i7Af/3ugH/97oB//i7Af/4uwH/+LsB//i7Af/4uwH/9LcB/+yfAf/snwH/7J8B/+yfAf/snwH/7J8B/9GOBv9JSEf/YGBg/2JiYv9KSUj/26YG//i7' +
  'Af/4uwH/+LsB//i7Af/4uwH/+LsB//W5Af/4uwH/+LsB//i7Af/4uwH/+LsB//e6Af/3ugH/+LsB//i7Af/4uwH/+LsB//i7Af/0twH/7J8B/+yfAf/snwH/' +
  '7J8B/+yfAf/snwH/0Y8G/0pJSP9iYmL/Y2Nj/0tKSf/YpAb/9LgB//S4Af/0uAH/9LgB//S4Af/0uAH/8bYB//S4Af/0uAH/9LgB//S4Af/0uAH/87cB//O3' +
  'Af/0uAH/9LgB//S4Af/0uAH/9LgB//G1Af/uqgH/7qoB/+6qAf/uqgH/7qoB/+6qAf/TmAb/S0pJ/2NjY/9jY2P/S0lI/86TBv/opQH/6aQB/+mlAf/ppQH/' +
  '6aUB/+mlAf/tsQH/8LQB//C1Af/wtAH/8LUB//C0Af/vswH/77QB//C1Af/wtQH/8LUB//C1Af/wtQH/7bMB//C1Af/wtQH/8LUB//C1Af/wtQH/8LUB/9Sh' +
  'Bv9KSUj/Y2Nj/2JiYv9KSUj/26YG//i7Af/4uwH/+LsB//i7Af/4uwH/+LsB//W5Af/4uwH/+LsB//i7Af/4uwH/+LsB//e6Af/3ugH/+LsB//i7Af/4uwH/' +
  '+LsB//i7Af/1uQH/+LsB//i7Af/4uwH/+LsB//i7Af/4uwH/26YG/0pJSP9iYmL/YmJi/0lIR//bpgb/+LsB//i7Af/4uwH/+LsB//i7Af/4uwH/9bkB//i7' +
  'Af/4uwH/+LsB//i7Af/4uwH/97oB//e6Af/4uwH/+LsB//i7Af/4uwH/+LsB//W5Af/4uwH/+LsB//i7Af/4uwH/+LsB//i7Af/bpgb/SkhH/2JiYv9jYmL/' +
  'SklI/9umBv/4uwH/+LsB//i7Af/4uwH/+LsB//i7Af/1uQH/+LsB//i7Af/4uwH/+LsB//i7Af/3ugH/97oB//i7Af/4uwH/+LsB//i7Af/4uwH/9bkB//i7' +
  'Af/4uwH/+LsB//i7Af/4uwH/+LsB/9umBv9KSUj/Y2Ji/1dXV/9DQ0L/sYoV/8aZEf/GmRH/xpkS/8aaEv/GmhL/xpoS/8SYEv/GmRL/xpkR/8aZEf/GmRH/' +
  'xpoS/8OXEP/DlxD/xpoS/8aZEf/GmRH/xpkR/8aZEv/EmBL/xpoS/8aaEv/GmhL/xpoS/8aZEf/GmRH/sYoV/0NCQv9XV1f/T05O/z8+Pf84Nzb/ODg3/zk4' +
  'N/85ODf/OTg3/zo5OP85ODf/OTg3/zk4Nv85ODf/ODc2/zk4N/85ODf/NjU0/zY1NP84ODf/OTg3/zg3Nv85ODf/OTg3/zk4OP85OTf/Ojk4/zk4N/85ODf/' +
  'OTg3/zg4N/84Nzb/Pz49/09OTv9ISUj/l6mt/8zm7//L5u//zObv/8vm7//M5u//y+bv/8vm7//L5u//zObv/8zm7//M5u//zObv/8zm7//M5u//zObv/8zm' +
  '7//M5u//zObv/8zm7//M5u//y+bv/8vm7//L5u//zObv/8vm7//M5u//zObv/8zm7/+Xqq3/SElI/0lJSf98iYv/oLO4/6CzuP+gs7j/oLK4/6CzuP+fs7j/' +
  'oLO5/6CyuP+gs7j/oLO4/6CyuP+gs7j/oLO4/6GzuP+hs7j/oLO4/6CzuP+gsrj/oLO4/6CzuP+gsrj/oLO4/5+zuf+gs7j/oLO4/6CzuP+gs7j/oLO4/3yJ' +
  'i/9JSUn/S0tK/z49PP89PDv/PDs6/z08O/89PDv/PTw8/z49PP8+PTz/Pj08/z08O/89PDv/PDs6/z08O/89PDv/OTg3/zk4N/89PDv/PTw7/zw7Ov89PDv/' +
  'PTw7/z49PP8+PTz/Pj08/z48PP89PDv/PTw7/zw7Ov89PDv/Pj08/0tKSv9XV1f/Q0JB/yQkJP8mJib/JCQk/ycnJ/8lJSX/JiYm/ykpKf8mJib/JCQk/yMj' +
  'I/8oKCj/KCgo/ycnJ/8mJib/JiYm/ygoKP8nJyf/KSkp/ygoKP8oKCj/Jycn/ycnJ/8mJib/Jycn/ygoKP8nJyf/JiYm/yYmJv9DQkH/V1dX/1hYWP9DQkH/' +
  'NTU1/zg4OP84ODj/OTk5/zg4OP83Nzf/Ojo6/zk5Of83Nzf/NTU1/zk5Of86Ojr/OTk5/zg4OP83Nzf/OTk5/zo6Ov86Ojr/OTk5/zg4OP86Ojr/ODg4/zk5' +
  'Of84ODj/OTk5/zk5Of85OTn/Nzc3/0NCQf9YWFj/WVlZ/0RDQv83Nzf/Ojo6/zo6Ov87Ozv/Ojo6/zk5Of87Ozv/Ojo6/zo6Ov84ODj/Ozs7/zs7O/87Ozv/' +
  'OTk5/zk5Of86Ojr/PDw8/zs7O/86Ojr/ODg4/zs7O/85OTn/Ozs7/zg4OP86Ojr/Ozs7/zs7O/85OTn/RENC/1lZWf9bW1v/RERC/zc3N/87Ozv/Ozs7/zo6' +
  'Ov86Ojr/ODg4/zw8PP86Ojr/Ojo6/zg4OP87Ozv/Ozs7/zs7O/85OTn/OTk5/zs7O/87Ozv/Ozs7/zo6Ov84ODj/Ozs7/zo6Ov87Ozv/ODg4/zo6Ov87Ozv/' +
  'Ozs7/zk5Of9EREL/W1tb/1VVVf9FREP/PDw8/z4+Pv8/Pz//Pj4+/0BAQP89PT3/Pz8//z4+Pv8/Pz//Pj4+/z8/P/8+Pj7/Pj4+/0BAQP8+Pj7/Pz8//z8/' +
  'P/8/Pz//QEBA/z09Pf8+Pj7/Pj4+/z8/P/89PT3/Pj4+/z4+Pv8+Pj7/Pj4+/0VEQ/9UVFT/V1dX/0hHRf8+Pj7/Pz8//0BAQP8/Pz//QUFB/z8/P/8/Pz//' +
  'Pz8//0BAQP8/Pz//QEBA/z4+Pv8/Pz//QEBA/0BAQP8/Pz//QEBA/0BAQP9CQkL/Pz8//z8/P/8/Pz//QEBA/z8/P/8/Pz//Pj4+/z8/P/8/Pz//SUdG/1ZW' +
  'Vv9WVlb/R0ZF/zg4OP87Ozv/PDw8/zs7O/85OTn/ODg4/zo6Ov87Ozv/Ojo6/zg4OP87Ozv/Ojo6/zs7O/85OTn/OTk5/zs7O/87Ozv/Ozs7/zo6Ov85OTn/' +
  'Ozs7/zs7O/86Ojr/Nzc3/zo6Ov86Ojr/Ozs7/zk5Of9IR0b/VVVV/1dWV/9IRkb/ODg4/zs7O/87Ozv/Ozs7/zk5Of84ODj/Ozs7/zs7O/86Ojr/ODg4/zs7' +
  'O/87Ozv/Ozs7/zk5Of84ODj/Ojo6/zw8PP86Ojr/Ojo6/zk5Of87Ozv/Ozs7/zo6Ov83Nzf/Ozs7/zo6Ov87Ozv/OTk5/0lHRv9VVVX/WFhY/0hHRv84ODj/' +
  'Ozs7/zs7O/88PDz/OTk5/zg4OP86Ojr/Ozs7/zo6Ov83Nzf/Ozs7/zs7O/87Ozv/OTk5/zk5Of86Ojr/Ozs7/zo6Ov86Ojr/OTk5/zs7O/87Ozv/Ojo6/zg4' +
  'OP87Ozv/Ozs7/zs7O/85OTn/SEdG/1dXV/9bW1v/RkRD/zg4OP87Ozv/PDw8/zs7O/85OTn/ODg4/zs7O/87Ozv/Ojo6/zg4OP87Ozv/PDw8/zs7O/85OTn/' +
  'OTk5/zo6Ov87Ozv/Ojo6/zo6Ov85OTn/Ozs7/zo6Ov86Ojr/ODg4/zs7O/87Ozv/Ozs7/zo6Ov9GRUT/Wlpa/1lZWv9EQ0L/ODg4/zs7O/88PDz/Ozs7/zk5' +
  'Of84ODj/Ojo6/zs7O/86Ojr/ODg4/zs7O/88PDz/Ojo6/zk5Of85OTn/Ozs7/zw8PP87Ozv/Ojo6/zk5Of87Ozv/Ojo6/zo6Ov84ODj/Ojo6/zs7O/86Ojr/' +
  'Ojo6/0VDQv9YWFj/WFhY/0RDQv84ODj/PDw8/zw8PP86Ojr/OTk5/zk5Of86Ojr/Ozs7/zo6Ov84ODj/Ozs7/zw8PP87Ozv/OTk5/zk5Of86Ojr/Ozs7/zs7' +
  'O/86Ojr/OTk5/zs7O/87Ozv/Ozs7/zg4OP86Ojr/Ozs7/zo6Ov86Ojr/RENC/1ZWVv9XV1f/Q0JB/zg4OP87Ozv/PDw8/zo6Ov86Ojr/ODg4/zo6Ov86Ojr/' +
  'Ojo6/zg4OP87Ozv/Ozs7/zs7O/85OTn/OTk5/zo6Ov87Ozv/Ozs7/zo6Ov84ODj/Ojo6/zs7O/87Ozv/ODg4/zo6Ov87Ozv/Ozs7/zo6Ov9DQkH/VlZW/1ZW' +
  'Vv9DQkH/Nzc3/zs7O/87Ozv/Ojo6/zo6Ov84ODj/Ojo6/zo6Ov86Ojr/ODg4/zs7O/87Ozv/Ozs7/zk5Of85OTn/Ojo6/zs7O/87Ozv/Ojo6/zg4OP86Ojr/' +
  'Ozs7/zs7O/84ODj/Ozs7/zs7O/87Ozv/Ojo6/0RDQf9WVlb/V1dX/0RCQf84ODj/Ozs7/zs7O/87Ozv/Ojo6/zg4OP87Ozv/Ojo6/zo6Ov84ODj/Ojo6/zs7' +
  'O/87Ozv/Ojo6/zk5Of86Ojr/Ozs7/zs7O/86Ojr/ODg4/zo6Ov87Ozv/Ojo6/zg4OP86Ojr/Ozs7/zs7O/86Ojr/RENC/1ZWVv9VVVX/Q0JB/zg4OP87Ozv/' +
  'Ozs7/zs7O/86Ojr/ODg4/zw8PP86Ojr/Ojo6/zg4OP86Ojr/Ozs7/zs7O/85OTn/OTk5/zo6Ov87Ozv/Ozs7/zo6Ov84ODj/Ojo6/zs7O/87Ozv/ODg4/zo6' +
  'Ov87Ozv/Ozs7/zo6Ov9DQkH/VVVV/1VVVf9DQkH/ODg4/zs7O/87Ozv/Ozs7/zo6Ov84ODj/Ozs7/zs7O/86Ojr/ODg4/zo6Ov87Ozv/Ozs7/zk5Of85OTn/' +
  'Ojo6/zs7O/87Ozv/Ojo6/zg4OP86Ojr/Ojo6/zs7O/84ODj/Ozs7/zs7O/87Ozv/Ojo6/0NCQf9UVVX/V1dX/0NCQf84ODj/Ozs7/zs7O/87Ozv/Ojo6/zg4' +
  'OP88PDz/Ozs7/zo6Ov84ODj/Ozs7/zs7O/87Ozv/ODg4/zk5Of86Ojr/PDw8/zs7O/86Ojr/ODg4/zs7O/87Ozv/Ozs7/zg4OP87Ozv/Ozs7/zs7O/85OTn/' +
  'RENC/1ZWVv9WVlb/Q0JB/zc3N/87Ozv/Ozs7/zo6Ov86Ojr/OTk5/zw8PP87Ozv/Ojo6/zg4OP87Ozv/Ozs7/zs7O/84ODj/OTk5/zo6Ov88PDz/Ozs7/zo6' +
  'Ov85OTn/Ozs7/zs7O/86Ojr/ODg4/zs7O/87Ozv/PDw8/zk5Of9EQ0H/VlZW/1dXV/9DQkH/Nzc3/zo6Ov87Ozv/Ojo6/zo6Ov84ODj/PDw8/zs7O/87Ozv/' +
  'Nzc3/zo6Ov87Ozv/Ozs7/zk5Of85OTn/Ojo6/zs7O/86Ojr/Ojo6/zk5Of87Ozv/Ozs7/zo6Ov84ODj/Ozs7/zs7O/88PDz/Ojo6/0NCQf9WVlb/WFhY/0ND' +
  'Qf83Nzf/Ojo6/zs7O/86Ojr/Ozs7/zg4OP87Ozv/Ozs7/zs7O/83Nzf/Ozs7/zs7O/87Ozv/OTk5/zk5Of86Ojr/Ozs7/zs7O/86Ojr/OTk5/zs7O/87Ozv/' +
  'OTk5/zc3N/87Ozv/Ozs7/zs7O/86Ojr/RENC/1ZWVv9ZWVn/RENC/zc3N/86Ojr/Ozs7/zs7O/87Ozv/ODg4/zs7O/87Ozv/Ojo6/zc3N/86Ojr/Ozs7/zs7' +
  'O/85OTn/OTk5/zo6Ov86Ojr/Ozs7/zo6Ov85OTn/Ozs7/zs7O/85OTn/ODg4/zs7O/87Ozv/Ozs7/zo6Ov9EQ0L/WFhY/1paWv9EQ0L/ODg4/zo6Ov87Ozv/' +
  'Ojo6/zo6Ov84ODj/Ozs7/zs7O/87Ozv/Nzc3/zs7O/87Ozv/Ojo6/zk5Of85OTn/OTk5/zs7O/87Ozv/OTk5/zk5Of86Ojr/Ojo6/zk5Of84ODj/Ojo6/zs7' +
  'O/88PDz/Ojo6/0VEQ/9YWFj/VVVV/z49PP83Nzf/Ozs7/zw8PP86Ojr/Ojo6/zk5Of87Ozv/Ozs7/zo6Ov84ODj/Ojo6/zs7O/87Ozv/OTk5/zk5Of86Ojr/' +
  'Ojo6/zw8PP86Ojr/ODg4/zo6Ov87Ozv/Ojo6/zg4OP86Ojr/Ojo6/zw8PP85OTn/Pz49/1RTU/9SUlL/PDo6/zc3N/87Ozv/Ozs7/zo6Ov86Ojr/OTk5/zs7' +
  'O/87Ozv/Ojo6/zg4OP87Ozv/Ozs7/zo6Ov85OTn/OTk5/zo6Ov87Ozv/Ozs7/zo6Ov84ODj/Ojo6/zs7O/85OTn/OTk5/zo6Ov86Ojr/PDw8/zk5Of88Ozn/' +
  'UVFR/1JSUv87Ojn/Nzc3/zs7O/87Ozv/Ozs7/zo6Ov85OTn/Ozs7/zs7O/86Ojr/ODg4/zo6Ov87Ozv/Ojo6/zk5Of85OTn/Ozs7/zs7O/87Ozv/Ojo6/zg4' +
  'OP87Ozv/Ozs7/zo6Ov85OTn/Ojo6/zo6Ov87Ozv/OTk5/zs6Of9RUVH/U1NT/z08O/83Nzf/Ozs7/zs7O/87Ozv/Ojo6/zk5Of87Ozv/Ojo6/zs7O/84ODj/' +
  'Ojo6/zs7O/86Ojr/Ojo6/zk5Of87Ozv/Ozs7/zs7O/86Ojr/ODg4/zs7O/87Ozv/Ojo6/zg4OP86Ojr/Ojo6/zs7O/85OTn/PTw7/1JSUv9ZWVn/RENC/zc3' +
  'N/87Ozv/Ozs7/zs7O/86Ojr/OTk5/zs7O/86Ojr/Ozs7/zg4OP86Ojr/Ozs7/zo6Ov86Ojr/OTk5/zs7O/86Ojr/Ozs7/zo6Ov85OTn/Ozs7/zs7O/86Ojr/' +
  'ODg4/zo6Ov87Ozv/Ojo6/zk5Of9EQ0L/WVlZ/1tbW/9FREP/Nzc3/zw8PP87Ozv/Ozs7/zo6Ov85OTn/Ozs7/zo6Ov87Ozv/ODg4/zo6Ov87Ozv/Ojo6/zk5' +
  'Of86Ojr/Ozs7/zs7O/87Ozv/Ojo6/zg4OP87Ozv/Ozs7/zo6Ov84ODj/Ozs7/zs7O/86Ojr/OTk5/0VEQ/9bW1v/WVlZ/0RDQv86Ojr/Pj4+/z09Pf89PT3/' +
  'PDw8/zs7O/89PT3/PT09/zw8PP86Ojr/PDw8/z09Pf88PDz/PDw8/zw8PP89PT3/PDw8/z09Pf89PT3/Ozs7/zw8PP88PDz/PDw8/zs7O/89PT3/PDw8/zw8' +
  'PP87Ozv/RENC/1lZWf9YWFj/Q0JB/0FBQP9BQUH/QUFB/0BAQP9ERET/QkJC/0FBQP9AQED/QUFB/0NDQ/9BQUD/QEBA/0BAQP9DQkL/Q0ND/0BAQP9BQUH/' +
  'QUFB/0VERP9CQkL/QEBA/0BAQP9AQED/Q0ND/0JBQf9AQED/QEBA/0JCQv9DQkH/WFhY/1dXV/9DQkH/NjU0/zY1NP83NjX/NzY1/zc2Nf83NjX/NzY2/zc2' +
  'Nv83NTX/NzY1/zU0NP83NjX/NzY1/zIxMf8yMTH/NjY1/zc2Nf82NDT/NzY1/zc1Nf83NjX/Nzc2/zc3Nv83NjX/NzY1/zc2Nf82NTT/NjU0/0NCQf9XV1f/' +
  'QUFA/05PTv9aW1v/Wlpb/1laWv9YWFn/UFFR/1ZWV/9UVVX/VVVW/1RUVP9YWFn/W1tb/09PUP9GR0f/RkdH/0ZGR/9HSEn/R0dI/0ZHR/9GR0f/RUZG/0dI' +
  'Sf9HR0j/R0dH/0ZHR/9ISEn/R0dI/0ZHR/9GR0f/R0hH/zw8Pf9DQ0P/UFBQ/1ZWVv9UVFT/TExM/0xMTP9NTU3/TExM/0xMTP9LS0v/TExM/0xMTP9MTEz/' +
  'S0tL/0xMTP9MTEz/TExM/0xMTP9MTEz/TU1N/0xMTP9MTEz/TExM/0xMTP9MS0v/TExM/0xMTP9MTEz/U1NT/1VWVf9QUFD/Q0ND/0FBQP9XV1f/ZGRk/1VV' +
  'Vf9OTk7/TU5O/01NTv9NTU3/TU1O/01NTf9NTU3/Tk5O/05OTv9NTEz/Tk5O/01NTf9NTU3/TU1N/05OTv9PTk//Tk1O/01NTf9NTU3/TU1N/01NTf9NTU3/' +
  'Tk5O/05OTv9UVVX/Y2Rj/1ZWVv9AQED/QUFB/1ZWVv9WVlb/W1tb/05OTv9OTk7/Tk5O/05OTv9OTk7/Tk5O/05OTv9OTk7/Tk5O/01NTf9PT0//Tk5O/05O' +
  'Tv9OTk7/T09P/09PT/9OTk7/Tk5O/05OTv9OTk7/Tk5O/05OTv9OTk7/Tk5O/1tbW/9VVVX/VVVV/0FBQf9HR0f/UFBQ/1BQUP9PT0//UFBQ/09PT/9PT0//' +
  'T09P/09PT/9PT0//T09P/09PT/9PT0//Tk5O/1BQUP9PT0//T09P/09PT/9QUFD/UVBR/09PT/9PT0//T09P/09PT/9PT0//T09P/09PT/9QUE//T09P/1BQ' +
  'UP9PT0//R0dH/0hISP9RUVH/T09P/09PT/9PT0//T09P/09PT/9QUFD/UFBQ/1BQUP9QUFD/UFBQ/1BQUP9PT0//UFBQ/09PT/9QUFD/T09P/1BQUP9RUVH/' +
  'UFBQ/1BQUP9QUFD/UFBQ/1BQUP9PT1D/UFBQ/1BQUP9QUFD/UFBQ/09PT/9ISEj/R0dH/09PT/9PT0//Tk5O/05OTv9OTk7/Tk5O/05OTv9OTk//Tk5O/05O' +
  'Tv9OTk7/T05O/01NTf9PT0//Tk5O/05OTv9NTU3/T09P/1BPT/9OTk7/Tk5O/05OTv9OTk7/Tk5O/05OTv9OTk7/Tk5O/05OTv9PT0//Tk5O/0ZGRv9HR0f/' +
  'T09P/09PT/9PT0//T09P/09PT/9OTk7/T09P/09PT/9PT0//T09P/09PT/9PT0//Tk5O/09PT/9OTk7/T09P/05OTv9PT0//UFBQ/09PT/9PT0//T09P/05O' +
  'Tv9OTk7/Tk5O/09PT/9PT0//Tk5O/09PT/9PT0//RkZG/0dHR/9QUFD/T09Q/09PT/9PT0//T09P/09PT/9PT0//T09P/09PT/9PT0//T09P/09PT/9OTk7/' +
  'UFBQ/09PT/9PT0//Tk5O/1BQUP9QUFD/T09P/09PT/9PT0//T09P/09PT/9PT0//T09P/09PT/9PT0//T09P/09PT/9GRkb/SEhI/1BQUP9QUFD/UFBQ/1BQ' +
  'UP9QUFD/T09P/09PUP9QUFD/T09P/09PT/9QUFD/T09P/09PT/9QUFD/UFBQ/1BQUP9PT0//UFBQ/1FRUf9QUFD/UFBQ/1BQUP9PT0//UFBQ/09PT/9QUFD/' +
  'UFBQ/09PT/9QUFD/UFBQ/0dHR/9GRkb/Tk5O/09PT/9OTk7/Tk5O/05OTv9OTk7/TU1N/05OTv9NTU3/TU1N/05OTv9OTk7/TE1N/05OTv9OTk7/Tk5O/05O' +
  'Tv9PT0//T09P/01NTf9NTU3/TU1N/01NTf9OTk7/Tk5O/05OTv9PT0//Tk5O/05OTv9NTU3/RUVF/0ZGRv9PT0//T09P/09PT/9PT0//T09P/05OTv9OTk7/' +
  'Tk5O/05OTv9OTk7/Tk5O/05OTv9NTU3/T09P/05PT/9PT0//Tk5O/09QUP9PT0//Tk5O/05OTv9OTk7/Tk5O/05OTv9OTk7/T09P/09PT/9OTk7/Tk5O/05O' +
  'Tv9GRkb/R0dH/09PT/9QUFD/T09P/09PT/9PT0//Tk5O/05OTv9OTk//Tk5O/05OTv9PT0//T09P/01NTv9PT0//Tk5O/05OTv9OTk7/T09P/1BQUP9OTk7/' +
  'Tk5O/05OTv9OTk7/Tk5O/05OTv9PT0//T09P/05OTv9PT0//Tk5O/0ZGRv9HR0f/T1BP/09PT/9PT0//T09P/09PT/9PT0//T09P/09PT/9PT0//T09P/09P' +
  'T/9PT0//Tk5O/1BQUP9PT0//T09P/09PT/9QUFD/UVBR/09PT/9PT0//T09P/09PT/9PT0//T09P/09PT/9PT0//T09P/09PT/9PT0//R0dH/0hISP9RUVH/' +
  'Tk5O/05OTv9OTk7/Tk5O/09PT/9QUFD/UFBQ/05OTv9PT0//UFBQ/1BQUP9PT0//UFBQ/05OTv9OTk7/TU1N/05OTv9RUVH/UFBQ/1BQUP9QUFD/UFBQ/1BQ' +
  'UP9PT0//T09P/09PT/9PT0//UFBQ/1BQUP9HR0f/RkZG/09PT/9PT0//Tk5O/05OTv9OTk7/Tk5O/05OTv9OTk7/Tk5O/05OTv9OTk7/Tk5O/05OTv9PT0//' +
  'T09P/05OTv9OTk7/T09P/09PT/9OTk7/Tk5O/05OTv9OTk7/Tk5O/05OTv9OTk7/Tk5O/05OTv9OTk7/Tk5O/0ZGRv9GRkb/T09P/1BQUP9PT0//T09P/09P' +
  'T/9OTk7/Tk5O/05OTv9OTk7/Tk5O/05OTv9OTk7/TU1N/05OTv9OTk7/T09P/05OTv9QUFD/T09P/05OTv9OTk7/Tk5O/05OTv9OTk7/Tk5O/09PT/9PT0//' +
  'Tk5O/05OTv9OTk7/RkZG/0dHR/9PT0//UFBQ/1BQUP9QUFD/UFBQ/09PT/9OTk7/Tk5O/05OTv9PT0//Tk5O/05OTv9OTk7/T09P/1BQUP9QUFD/UFBQ/1FR' +
  'Uf9QUFD/Tk5O/05OTv9OTk7/Tk5O/05OTv9PT0//UFBQ/1BQUP9PT1D/T09P/05OTv9GRkb/R0dH/1BQUP9PT0//Tk5O/05OTv9OTk7/Tk5O/09PT/9OT0//' +
  'T09P/09PT/9PT0//Tk5O/05OTv9PT0//Tk5O/05OTv9OTk7/T09P/1BQUP9PT0//T09P/05OTv9OTk7/T09P/05OTv9OTk7/Tk5O/05OTv9PT0//T09P/0ZG' +
  'Rv9ISEj/UVFR/09PT/9PT0//T09P/09PT/9PT0//UFBQ/1BQUP9PT0//T09P/1BQUP9QUFD/T09P/1BQUf9OTk7/T09P/05OTv9QUE//UVFR/1BQUP9QUFD/' +
  'UE9P/1BQUP9QUFD/T09P/09PT/9PT0//T09P/1BQUP9QUFD/R0dH/0dHR/9PT0//T09P/09PT/9PT0//T09P/05OTv9OTk7/Tk5O/05OTv9PT0//Tk5O/09P' +
  'Tv9NTU3/T09P/05OTv9OTk7/Tk5O/09PT/9QUFD/Tk5O/05OTv9OTk7/Tk5O/05OTv9OTk7/Tk5O/05OTv9OTk7/Tk5O/05OTv9GRkb/RkZG/09PT/9OTk7/' +
  'Tk5O/05OTv9OTk7/TU1N/05OTv9OTk7/T09P/09PT/9OTk7/Tk5O/01NTf9PT0//Tk5O/05OTv9NTU3/T09O/09PT/9OTk7/Tk5O/05OTv9OTk7/Tk5O/05O' +
  'Tv9OTk7/Tk5O/05OTv9OTk7/Tk5O/0ZGRv9HR0f/T09P/09PT/9PT0//T09P/09PT/9OTk7/Tk5O/05OTv9OTk7/Tk5O/05OTv9OTk7/Tk5O/09PT/9OT0//' +
  'T09P/05OTv9PT0//UFBQ/05OTv9PT0//Tk5O/05OTv9OTk7/Tk9O/09PT/9PT0//Tk5O/05OTv9OTk7/RkZG/0dHR/9PT0//T09P/09PT/9PT0//T09P/05O' +
  'Tv9PT0//T09P/05OTv9OTk7/T09P/05OTv9OTk7/T09P/09PT/9PT0//Tk5O/09PT/9QUFD/T09P/09PT/9OTk7/Tk5O/05OTv9PT0//T09P/09PT/9PT0//' +
  'T09P/09PT/9GRkb/SEhI/1BQUP9QUFD/UFBQ/09PT/9QUFD/T09P/09QUP9QUFD/T09P/05OTv9QUFD/T09P/09PT/9QUFD/T09P/1BQUP9PT0//UFBQ/1FR' +
  'Uf9QUFD/UFBQ/09PT/9QUFD/UFBQ/09PT/9QUFD/T09P/1BQUP9QUFD/UFBQ/0dHR/9HR0f/T09P/09PT/9PT0//Tk5O/05OTv9OTk7/T09P/09PT/9PT0//' +
  'T09P/09PTv9PT0//Tk5O/09PT/9OTk7/Tk5O/05OTv9PT0//UFBQ/05OTv9PT0//Tk5O/05OTv9OTk7/T09P/05OTv9OTk7/Tk5O/05OTv9PT0//RkZG/0ZG' +
  'Rv9PT0//T09P/09PT/9PT0//T09P/05OTv9OTk7/Tk5O/05OTv9PT0//Tk5O/05OTv9NTU3/T09P/09PT/9PT0//Tk5O/09PT/9PT0//Tk5O/05OTv9OTk7/' +
  'Tk5O/05OTv9OTk7/Tk5O/05OTv9OTk7/Tk5O/05OTv9GRkb/R0dH/09PT/9QUFD/T09P/09PT/9PT0//Tk5O/05OTv9OTk7/T09P/09PT/9OTk7/Tk5O/01N' +
  'Tf9PT0//Tk5O/05OTv9OTk7/T09P/1BQUP9OTk7/Tk5O/05OTv9OTk7/Tk5O/05OTv9OTk7/Tk5O/05OTv9OTk7/Tk5O/0ZGRv9BQUH/V1dX/1ZWVv9cXFz/' +
  'T09P/09PT/9PTk//Tk5O/09PT/9OT0//T09P/09PT/9PT0//Tk5O/09PT/9PT0//T09P/05OTv9PT0//UFBQ/09PT/9PT0//T09P/09PT/9OTk7/T09P/09P' +
  'T/9PT0//W1tb/1VVVf9VVVX/QUFB/0FCQf9ZWVn/ZWVl/1dXV/9PT0//T09P/09PT/9PT0//T09P/09PT/9PT0//T09P/09PT/9OTk7/UFBQ/09PT/9PT0//' +
  'T09P/1BQUP9RUVH/T09P/09PT/9PT0//T09P/09PT/9PT0//T09P/09PT/9WVlb/ZWVl/1hYWP9BQUD/RUVF/1RUVP9ZWVn/VlZW/09PT/9PT0//T09P/05O' +
  'Tv9PT0//Tk5O/09PT/9PT0//Tk5O/05OTv9PT0//Tk5O/09PTv9OTk7/T09P/1BQUP9PT0//T09P/05OTv9PT0//T09P/05OTv9PT0//T09P/1ZWVv9ZWVn/' +
  'U1NT/0VFRf8/Pz7/RkZF/0ZGRv9HR0f/RkZG/0dHR/9HR0f/RkZG/0ZHRv9HR0f/RkZG/0dHR/9HR0f/R0dH/0hISP9GRkb/RkZG/0ZGRv9HR0f/SEhI/0dH' +
  'R/9GRkb/RkZG/0dHR/9HR0f/R0dH/0ZGRv9GRkb/RkZG/0dHR/9JSUj/Pz8//wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZG' +
  'Rv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/' +
  'RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZG' +
  'Rv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/' +
  'RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZG' +
  'Rv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/' +
  'RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZG' +
  'Rv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/' +
  'RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZG' +
  'Rv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/' +
  'RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZG' +
  'Rv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/' +
  'RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZG' +
  'Rv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/' +
  'RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZG' +
  'Rv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/' +
  'RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZG' +
  'Rv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/' +
  'RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZG' +
  'Rv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/' +
  'RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZG' +
  'Rv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/' +
  'RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZG' +
  'Rv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/' +
  'RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZG' +
  'Rv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/' +
  'RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZG' +
  'Rv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/' +
  'RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZG' +
  'Rv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/' +
  'RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZG' +
  'Rv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/' +
  'RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZG' +
  'Rv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/' +
  'RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZG' +
  'Rv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/' +
  'RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZG' +
  'Rv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/' +
  'RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZG' +
  'Rv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/' +
  'RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZG' +
  'Rv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/' +
  'RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZG' +
  'Rv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/' +
  'RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZG' +
  'Rv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/' +
  'RkZG/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YA' +
  'AP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/' +
  '1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YA' +
  'AP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/' +
  '1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YA' +
  'AP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/' +
  '1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YA' +
  'AP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/' +
  '1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YA' +
  'AP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/' +
  '1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YA' +
  'AP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/' +
  '1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YA' +
  'AP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/' +
  '1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YA' +
  'AP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/' +
  '1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YA' +
  'AP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/' +
  '1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YA' +
  'AP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/' +
  '1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YA' +
  'AP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/' +
  '1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YA' +
  'AP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/' +
  '1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YA' +
  'AP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/' +
  '1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YA' +
  'AP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/' +
  '1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YA' +
  'AP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/' +
  '1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YA' +
  'AP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/' +
  '1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YA' +
  'AP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/' +
  '1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YA' +
  'AP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/' +
  '1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YA' +
  'AP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/' +
  '1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YA' +
  'AP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/' +
  '1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YA' +
  'AP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/' +
  '1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YA' +
  'AP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/' +
  '1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YA' +
  'AP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/' +
  'ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZ' +
  'AP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/' +
  'ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZ' +
  'AP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/' +
  'ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZ' +
  'AP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/' +
  'ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZ' +
  'AP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/' +
  'ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZ' +
  'AP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/' +
  'ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZ' +
  'AP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/' +
  'ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZ' +
  'AP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/' +
  'ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZ' +
  'AP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/' +
  'ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZ' +
  'AP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/' +
  'ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZ' +
  'AP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/' +
  'ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZ' +
  'AP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/' +
  'ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZ' +
  'AP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/' +
  'ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZ' +
  'AP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/' +
  'ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZ' +
  'AP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/' +
  'ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZ' +
  'AP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/' +
  'ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZ' +
  'AP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/' +
  'ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZ' +
  'AP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/' +
  'ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZ' +
  'AP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/' +
  'ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZ' +
  'AP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/' +
  'ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZ' +
  'AP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/' +
  'ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZ' +
  'AP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/' +
  'ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZ' +
  'AP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/' +
  'ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZ' +
  'AP8A2QD/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/' +
  'AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA' +
  '8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/' +
  'AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA' +
  '8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/' +
  'AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA' +
  '8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/' +
  'AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA' +
  '8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/' +
  'AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA' +
  '8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/' +
  'AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA' +
  '8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/' +
  'AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA' +
  '8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/' +
  'AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA' +
  '8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/' +
  'AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA' +
  '8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/' +
  'AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA' +
  '8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/' +
  'AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA' +
  '8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/' +
  'AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA' +
  '8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/' +
  'AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA' +
  '8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/' +
  'AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA' +
  '8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/' +
  'AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA' +
  '8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/' +
  'AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA' +
  '8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/' +
  'AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA' +
  '8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/' +
  'AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA' +
  '8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/' +
  'AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA' +
  '8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/' +
  'AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA' +
  '8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/' +
  'AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA' +
  '8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/' +
  'AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA' +
  '8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/' +
  'AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV' +
  '8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/' +
  '0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV' +
  '8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/' +
  '0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV' +
  '8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/' +
  '0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV' +
  '8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/' +
  '0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV' +
  '8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/' +
  '0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV' +
  '8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/' +
  '0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV' +
  '8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/' +
  '0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV' +
  '8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/' +
  '0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV' +
  '8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/' +
  '0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV' +
  '8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/' +
  '0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV' +
  '8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/' +
  '0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV' +
  '8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/' +
  '0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV' +
  '8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/' +
  '0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV' +
  '8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/' +
  '0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV' +
  '8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/' +
  '0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV' +
  '8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/' +
  '0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV' +
  '8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/' +
  '0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV' +
  '8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/' +
  '0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV' +
  '8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/' +
  '0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV' +
  '8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/' +
  '0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV' +
  '8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/' +
  '0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV' +
  '8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/' +
  '0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV' +
  '8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/' +
  '0tXz/9LV8/8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAC0AAAAKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAACAAAABYAAAA0AAAAP8AAADY' +
  'AAAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAQAAADkAAAA/wAAAP8AAAD/AAAA/wAAAP8AAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAApAAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAOQAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABcAAAAlAAAAOAAAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAXAAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAkAAAAbAAAALgAAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGAAAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAYAAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABgAAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAGAAAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAEAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAYAAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAABgAAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGAAAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAYAAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABgAAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAABA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGAAAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAYAAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAAQAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABgAAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AGAAAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAYAAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABgAAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFwAAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAADwAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAsWIA37Fj' +
  'AP+xYwD/sGMAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACxYgDfsWMA/7FjAP+wYwDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALFiAN+xYwD/sWMA/7BjAMAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAsWIA37FjAP+xYwD/sGMAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACxYgDfsWMA/7FjAP+wYwDAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAALFiAN+xYwD/sWMA/7BjAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAsWIA37FjAP+xYwD/sGMAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACxYwC4sWMA/7Fj' +
  'AP+wYgCYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALJmACiwYgDAsWMAtLRqABgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAxAAAAP8AAAD/AAAApAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAADfAAAA/wAAAP8AAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAN8AAAD/AAAA/wAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAA3wAAAP8AAAD/AAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADfAAAA/wAAAP8AAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAN8AAAD/AAAA/wAA' +
  'AMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA3wAAAP8AAAD/AAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADfAAAA/wAAAP8AAADAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAN8AAAD/AAAA/wAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA3wAAAP8AAAD/AAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADf' +
  'AAAA/wAAAP8AAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAN8AAAD/AAAA/wAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA3wAAAP8AAAD/AAAAwAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAADfAAAA/wAAAP8AAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAN8AAAD/AAAA/wAAAMAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAA3wAAAP8AAAD/AAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADfAAAA/wAAAP8AAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAN8AAAD/' +
  'AAAA/wAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA3wAAAP8AAAD/AAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADfAAAA/wAAAP8AAADAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAN8AAAD/AAAA/wAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA3wAAAP8AAAD/AAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAADfAAAA/wAAAP8AAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAN8AAAD/AAAA/wAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA3wAAAP8AAAD/' +
  'AAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADfAAAA/wAAAP8AAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAN8AAAD/AAAA/wAAAMAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAA3wAAAP8AAAD/AAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADfAAAA/wAAAP8AAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AN8AAAD/AAAA/wAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA3wAAAP8AAAD/AAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACoAAAA3wAAAN8AAACM' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMQAAAD/AAAA/wAAAKQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA3wAAAP8AAAD/AAAAwAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAADfAAAA/wAAAP8AAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAN8AAAD/AAAA/wAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA3wAA' +
  'AP8AAAD/AAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADfAAAA/wAAAP8AAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAN8AAAD/AAAA/wAAAMAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAA3wAAAP8AAAD/AAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADfAAAA/wAAAP8AAADAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAN8AAAD/AAAA/wAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA3wAAAP8AAAD/AAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADfAAAA/wAA' +
  'AP8AAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAN8AAAD/AAAA/wAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA3wAAAP8AAAD/AAAAwAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAADfAAAA/wAAAP8AAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAN8AAAD/AAAA/wAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAA3wAAAP8AAAD/AAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADfAAAA/wAAAP8AAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAN8AAAD/AAAA/wAA' +
  'AMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA3wAAAP8AAAD/AAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADfAAAA/wAAAP8AAADAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAN8AAAD/AAAA/wAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB3wAAAv8AAAL/AAABwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA3f' +
  'AAAN/wAADf8AAA3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAN8AAAD/AAAA/wAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA3wAAAP8AAAD/AAAAwAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAADfAAAA/wAAAP8AAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAN8AAAD/AAAA/wAAAMAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAA3wAAAP8AAAD/AAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADfAAAA/wAAAP8AAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAN8AAAD/' +
  'AAAA/wAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAqAAAAN8AAADfAAAAjAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4wDEAOQA/wDkAP8A4wCkAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAADkAN8A5AD/AOQA/wDjAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOQA3wDkAP8A5AD/AOMAwAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAA5ADfAOQA/wDkAP8A4wDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADkAN8A5AD/AOQA/wDjAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOQA3wDkAP8A5AD/' +
  'AOMAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA5ADfAOQA/wDkAP8A4wDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADkAN8A5AD/AOQA/wDjAMAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAOQA3wDkAP8A5AD/AOMAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA5ADfAOQA/wDkAP8A4wDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADk' +
  'AN8A5AD/AOQA/wDjAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOQA3wDkAP8A5AD/AOMAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA5ADfAOQA/wDkAP8A4wDA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAADkAN8A5AD/AOQA/wDjAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOQA3wDkAP8A5AD/AOMAwAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAA5ADfAOQA/wDkAP8A4wDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADkAN8A5AD/AOQA/wDjAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOQA3wDk' +
  'AP8A5AD/AOMAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA5ADfAOQA/wDkAP8A4wDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADkAN8A5AD/AOQA/wDjAMAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAOQA3wDkAP8A5AD/AOMAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA5ADfAOQA/wDkAP8A4wDAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAADhAN8A4QD/AOEA/wDgAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJ0A3wCeAP8AngD/AJ4AwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA5ADfAOQA/wDk' +
  'AP8A4wDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADkAN8A5AD/AOQA/wDjAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOQA3wDkAP8A5AD/AOMAwAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAA5ADfAOQA/wDkAP8A4wDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADkAN8A5AD/AOQA/wDjAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AOQA3wDkAP8A5AD/AOMAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA5ADfAOQA/wDkAP8A4wDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADjAKgA5ADfAOQA3wDj' +
  'AIwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/wAAxP8AAP//AAD//wAApAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AADf/wAA//8AAP//AADAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAP8AAN//AAD//wAA//8AAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/wAA3/8AAP//AAD//wAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AADf' +
  '/wAA//8AAP//AADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8AAN//AAD//wAA//8AAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/wAA3/8AAP//AAD//wAAwAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAD/AADf/wAA//8AAP//AADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8AAN//AAD//wAA//8AAMAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAA/wAA3/8AAP//AAD//wAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AADf/wAA//8AAP//AADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8AAN//AAD/' +
  '/wAA//8AAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/wAA3/8AAP//AAD//wAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AADf/wAA//8AAP//AADAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAP8AAN//AAD//wAA//8AAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/wAA3/8AAP//AAD//wAAwAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAD/AADf/wAA//8AAP//AADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8AAN//AAD//wAA//8AAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/wAA3/8AAP//AAD/' +
  '/wAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AADf/wAA//8AAP//AADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8AAN//AAD//wAA//8AAMAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAA/wAA3/8AAP//AAD//wAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD6AADf+gAA//oAAP/5AADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAK0A' +
  'AN+uAAD/rgAA/60AAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/wAA3/8AAP//AAD//wAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AADf/wAA//8AAP//AADA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8AAN//AAD//wAA//8AAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/wAA3/8AAP//AAD//wAAwAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAD/AADf/wAA//8AAP//AADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8AAN//AAD//wAA//8AAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/wAA3/8A' +
  'AP//AAD//wAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AACo/wAA3/8AAN//AACMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/jAMT/5AD//+QA///jAKQAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAA/+QA3//kAP//5AD//+MAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/5ADf/+QA///kAP//4wDAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAP/kAN//5AD//+QA///jAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+QA3//kAP//5AD//+MAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/5ADf/+QA///k' +
  'AP//4wDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/kAN//5AD//+QA///jAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+QA3//kAP//5AD//+MAwAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAD/5ADf/+QA///kAP//4wDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/kAN//5AD//+QA///jAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  '/+QA3//kAP//5AD//+MAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/5ADf/+QA///kAP//4wDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/kAN//5AD//+QA///j' +
  'AMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+QA3//kAP//5AD//+MAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/5ADf/+QA///kAP//4wDAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAP/kAN//5AD//+QA///jAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+QA3//kAP//5AD//+MAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/5ADf' +
  '/+QA///kAP//4wDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/kAN//5AD//+QA///jAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+QA3//kAP//5AD//+MAwAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAD/5ADf/+QA///kAP//4wDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/kAN//5AD//+QA///jAMAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAA+uEB3/rhAv/64QL/+eABwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACtnQ3frp4N/66eDf+tng3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/kAN//5AD/' +
  '/+QA///jAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+QA3//kAP//5AD//+MAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/5ADf/+QA///kAP//4wDAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAP/kAN//5AD//+QA///jAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+QA3//kAP//5AD//+MAwAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAD/5ADf/+QA///kAP//4wDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/kAN//5AD//+QA///jAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+MAqP/kAN//5ADf' +
  '/+MAjAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAD/jAYo/4YFmP+FBND/hgT//4YE//+GBP//hgT7/4UFzP+GBYz/iAkcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/4YEdP+GBPv/hgT//4YE//+GBP//hgT//4YE//+GBP//hgT//4YE//+G' +
  'BPP/hwVcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+GB0j/hgT/' +
  '/4YE//+GBP//hgT//4YE//+GBP//hgT//4YE//+GBP//hgT//4YE//+GBPf/igUwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/4YEvP+GBP//hgT//4YE//+GBP//hgT//4YE//+GBP//hgT//4YE//+GBP//hgT//4YE//+GBJwAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/lwbj/5cG//+XBv//lwb//5cG//+X' +
  'Bv//lwb//5cG//+XBv//lwb//5cG//+XBv//lwb//5YGxAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAP+yCLD/sgj//7II//+yCP//sgj//7II//+yCP//sgj//7II//+yCP//sgj//7II//+yCP//sgiQAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/7UJNP+yCP//sgj//7II//+yCP//sgj//7II//+yCP//sgj/' +
  '/7II//+yCP//sgj//7II+/+0ChgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAA/7II5/+yCP//sgj//7II//+yCP//sgj//7II//+yCP//sgj//7II//+yCP//sgjIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+/FQz/sgjY/7II//+yCP//sgj//7II//+yCP//sgj//7II//+yCP//sgj//7II//+x' +
  'B8D/vz8EAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/swss/7EI3P+yCP//sgj/' +
  '/7II//+yCP//sgj//7II//+yCP//sgj//7II//+yCP//sgj//7II//+xCMz/tgkcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAA/4cHZP+QBvf/kQf//5EH//+RB///kQf//5EH//+RB///kQf//5EH//+RB///kQf//5EH//+RB///kQf//5EH//+OBu//iQpM' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+HB2D/hgb//4YG//+GBv//hgb//4YG//+GBv//hgb//4YG//+G' +
  'Bv//hgb//4YG//+GBv//hgb//4YG//+GBv//hgb//4YG//+GBvv/hwdEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/kRIc' +
  '/4YG+/+GBv//hgb//4YG//+GBv//hgb//4YG//+GBv//hgb//4YG//+GBv//hgb//4YG//+GBv//hgb//4YG//+GBv//hgb//4YG//+GBu//nx8IAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+GB2j/hgb//4YG//+GBv//hgb//4YG//+GBv//hgb//4YG//+GBv//hgb//4YG//+GBv//hgb/' +
  '/4YG//+GBv//hgb//4YG//+GBv//hgb//4YG//+KCkgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/4YHjP+GBv//hgb//4YG//+G' +
  'Bv//hgb//4YG//+GBv//hgb//4YG//+GBv//hgb//4YG//+GBv//hgb//4YG//+GBv//hgb//4YG//+GBv//hgb//4YHbAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAD/hQZQ/4YG//+GBv//hgb//4YG//+GBv//hgb//4YG//+GBv//hgb//4YG//+GBv//hgb//4YG//+GBv//hgb//4YG//+G' +
  'Bv//hgb//4YG//+GBv//igowAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP9fHwj/RwLc/0gC//9IAv//SAL//0gC//9IAv//SAL/' +
  '/0gC//9IAv//SAL//0gC//9IAv//SAL//0gC//9IAv//SAL//0gC//9IAv//SAL//0cCxAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAP9HA0T/SAL//0gC//9IAv//SAL//0gC//9IAv//SAL//0gC//9IAv//SAL//0gC//9IAv//SAL//0gC//9IAv//SAL//0gC//9IAvv/TAYo' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP9IArD/SAL//0gC//9IAv//SAL//0gC//9IAv//SAL//0gC//9I' +
  'Av//SAL//0gC//9IAv//SAL//0gC//9IAv//SAL//0gDkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  '/0gCWP9IAv//SAL//0gC//9IAv//SAL//0gC//9IAv//SAL//0gC//9IAv//SAL//0gC//9IAv//SAL//0gC//9IAv//TQQ4AAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/RwLA/0gC//9IAv//SAL//0gC//9IAv//SAL//0gC//9IAv//SAL//0gC//9IAv//SAL/' +
  '/0gC//9IAv//SAL//0gC//9HA6AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/Pz8E8jgMjPc+Cf/3Pgn/9z4J//c+' +
  'Cf/3Pgn/9z4J//c+Cf/3Pgn/9z4J//c+Cf/3Pgn/9z4J//c+Cf/3Pgn/9z4J//c+Cf/3Pgn/9j0J+/E2D3QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAOktEqTpLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ks' +
  'E//pLBP/6SwT/+ksE4QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADnLBV46SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/' +
  '6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+orFFgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/z8/BOks' +
  'E+vpLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/' +
  '6CwT0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADsLRY46SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ks' +
  'E//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6TUfGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOkvFTDpLBP/6SwT/+ksE//pLBP/' +
  '6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//vLx8QAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAA3y8fEN0rEvfdKxP/3SsT/90rE//dKxP/3SsT/90rE//dKxP/3SsT/90rE//dKxP/3SsT/90rE//dKxP/3SsT/90rE//dKxP/' +
  '3SsT/90rE//dKxP/3SsT/90rE//dKxP/3CoS6AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA2ioThNkqEv/ZKhL/2SoS/9kqEv/ZKhL/2SoS/9kq' +
  'Ev/ZKhL/2SoS/9kqEv/ZKhL/2SoS/9kqEv/ZKhL/2SoS/9kqEv/ZKhL/2SoS/9kqEv/ZKhL/2SoS/9kqEv/YKxRkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAADpKhUM2SoSsNkqEv/ZKhL/2SoS/9kqEv/ZKhL/2SoS/9kqEv/ZKhL/2SoS/9kqEv/ZKhL/2SoS/9kqEv/ZKhL/2SoS/9kqEv/ZKhL/2SoS/9kq' +
  'Ev/ZKhL/2CkSmP8/PwQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA2SoSbNkqEtjZKhL/2SoS/9kqEv/ZKhL/2SoS/9kqEv/ZKhL/' +
  '2SoS/9kqEv/ZKhL/2SoS/9kqEv/ZKhL/2SoS/9kqEv/ZKhL/2CoSzNkrFFgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAANwsEzTYKxJw2SoTnNkqErzYKhLM2SoS39kqEt/ZKhLf2SoS39kqEt/ZKhLf2CoRyNkqErjYKRKY1ykTaNwuFywAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACpVAAwjYgCYH18AGAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAfUgAoJloEuDBrBNgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAaTwAwG08A2BtOAP9OXBX/oXkzgAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAcTQAkGEoASG1mIJyddzRcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAp381YKd/N0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACkfzVg' +
  'o3s3QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAeLEHJHetAmR5rQGAfK0BoH2sA6R9owOke5UBgJGBIJyRjxuAf6MDQHyWA0x9nAOcf6cC5H6sAud8rQKseK4CbH+vDxAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf78ACGyoA4RuqgL3b6oC/2+pAv9vqgL/cqsC/3asAv96rgL/fasC/3+oBP9+qQL/fa4C/3uv' +
  'Av93rgL/dK0C/3CrAv9vqwL/bqkC7GupAmh/vwAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAX78fCGKkA6BiowLzYqQC/2KiAf9iowL/' +
  'YqIB/2OjAv9kowL/ZaQC/2alAv9opgL/aqgC/2uqAv9qqAL/aKYC/2alAv9lpgL/ZKMC/2OkAv9ipQL/YqQC/2KhAtB/vwAEAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAABboQOAW6EC/1uhAv9boQL/W58C/1ugAv9boAL/W58B/1ufAf9coAL/XaEC/16jAv9eoQH/XqIC/16lAv9dogL/XKIC/1yhAv9cogL/' +
  'W6AC/1ugAv9bogL/W6AC/1ufBHgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVpwFLFScAvtUnQL/VJ0C/1ScAv9UnQL/VJ0C/1SdAv9UnAL/VJsC/1Wf' +
  'Av9WnwL/Vp8C/1aeAv9WnQL/VZ0C/1WeAv9VngL/VZ8C/1WgAv9UnwL/VJ4C/1SfAv9UnAL/U50C81GjCRwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABNmQK0' +
  'TpgC/06aAv9OmgL/TpkC/06bAv9OmwL/TpgC/06aAv9OmwL/TpkC/0+aAv9PmwL/T5oC/0+aAv9OmgL/TpsC/06bAv9OmwL/TpsC/06bAv9OngL/TpoC/06Z' +
  'Av9OmgL/TZkBlAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEmWAutJlwL/SZcC/0mZAv9JmQL/SZYC/0mYAv9JmAL/SZcC/0mXAv9JlwL/SZYC/0mZAv9JlwL/' +
  'SZYC/0mWAf9JlwL/SZgC/0maAv9JmAL/SZoC/0mZAv9JlwL/SZkC/0mYAv9JlwHMAAAAAAAAAAAAAAAAAAAAAAAAAABMmQwURJUC/0SUAv9ElAL/RJYC/0SV' +
  'Av9ElAL/RJMC/0SYAv9ElgL/RJUC/0SVAv9ElAL/RJQC/0SVAv9ElAL/RJcC/0SUAv9ElQL/RJQC/0SWAv9ElQL/RJUC/0STAv9ElAL/RJQC/0STAvMAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAEOXA0BBkwL/QZMC/0GUAv9BlAL/QZMC/0GVAv9BlAL/QZkC/0GTAv9BkgL/QZUC/0GTAv9BkgL/QZIC/0GTAv9BkwL/QZUC/0GU' +
  'Av9BlAL/QZYC/0GVAv9BkwL/QZQC/0GUAv9BkwL/QZIC/z+XByAAAAAAAAAAAAAAAAAAAAAAPZQCYD2SAv89kgL/PZMC/z2TAv89kQL/PY8B/z2RAv89kQL/' +
  'PZEC/z2UAv89kwL/PZQC/z2RAv89kQL/PZQC/z2SAv89kQL/PZEC/z2SAv89kwL/PZEC/z2TAv89lgL/PZEC/z2TAv89kgL/P5MDQAAAAAAAAAAAAAAAAAAA' +
  'AAA8jQNIOpIC/zqSAv86kAL/OpAC/zqPAv86kAL/Oo8B/zqPAv86kgL/OpMC/zqQAv86kQL/OpAC/zqTAv86kgL/OpAC/zqSAv86kAL/OpIC/zqRAv86jwH/' +
  'OpAC/zqRAv86kAL/OpAC/zqRAv85kgYoAAAAAAAAAAAAAAAAAAAAADePA0A3kQL/N5EC/zeRAv83kAL/N44C/zePAv83jgL/N40C/zeOAv83jQL/N44C/zeN' +
  'Av83kQL/N5IC/zeQAv83kQL/N5AC/zeRAv83kAL/N5AC/zePAv83jwL/N44C/zePAv83kAL/N48C/zePACAAAAAAAAAAAAAAAAAAAAAAOI0AJDSOAv80jQL/' +
  'NI4C/zSOAv80jQL/NI0C/zSNAv80iwH/NI4C/zSSAv80jgL/NI0C/zSNAv80jwL/NI4C/zSMAv80jQL/NI8C/zSQAv80jgL/NI8C/zSQAv80jgL/NI8C/zSQ' +
  'Av80jwL/P78ABAAAAAAAAAAAAAAAAAAAAAA/lAAMMowC9zOLAv8zjAL/M4wC/zOPAv8ziwL/M4sC/zOMAv8zjQL/M4wC/zOLAv8zigH/M4sC/zOPAv8ziwL/' +
  'M4wC/zOLAv8zjAL/M40C/zONAv8zjgL/M5AC/zOMAv8zjAL/M40C/zOKAuQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAyigK8MY0C/zGLAv8xiwL/MYoC/zGK' +
  'Av8xiwL/MY4C/zGLAv8xiwL/MY0C/zGMAv8xjAL/MYwC/zGLAv8xigL/MYsC/zGKAv8xigL/MYsC/zGKAv8xigL/MYsC/zGMAv8xjAL/Mo4BnAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAADCKAnQwigL/MIsC/zCLAv8wiwL/MI4C/zCLAv8wigL/MIoC/zCLAv8wiwL/MIwC/zCLAv8wigL/MI0C/zCMAv8wjAL/MI4C/zCM' +
  'Av8wigL/MI4C/zCKAv8wjAL/MIoC/zCLAv8wjgNUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM4wGKC+KAvswjAL/MIsC/zCNAv8wiwL/MIkC/zCLAv8wigL/' +
  'MIoB/zCKAv8wiwL/MIwC/zCKAv8wjgL/MIsC/zCLAv8wigL/MIwC/zCPAv8wigL/MIoC/zCMAv8wjAL/MIsC8y+PDxAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAL4oDoDCLAv8wjAL/MIsC/zCLAv8wjQL/MIwC/zCMAv8wigH/MIwC/zCNAv8wjwL/MIoC/zCLAv8wjAL/MIwC/zCMAv8wjQL/MIsC/zCMAv8wiwL/' +
  'MIwC/zCLAv8viwGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4jQckMYsC+zKLAv8yjAL/MowC/zKLAv8yjAL/MowC/zKLAv8yiwL/MowC/zKM' +
  'Av8yiwL/MowC/zKKAv8yiwL/Mo4C/zKMAv8yjAL/Mo4C/zKOAv8yjAL/MooC7y+PABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAzjQOA' +
  'NI4C/zSOAv80jgL/NI0C/zSNAv80jAH/NIwC/zSMAv80jgL/NI0C/zSOAv80jgL/NI0C/zSMAv80jQL/NI4C/zSNAv80jAL/NI0C/zSLAv81jAJgAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA3jwK0OI8C/ziOAv84jgH/OI0C/ziNAf84jgL/OI8C/ziPAv84jgL/OI8C/ziPAv84jwL/' +
  'OJAC/ziPAv84kAL/OJEC/ziPAv84jwL/N48BlAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD+UAAw8kQLYPZIC/z2S' +
  'Av89kgL/PZIC/z2RAv89kgL/PZEC/z2UAv89kAL/PZAC/z2QAv89kgL/PZEC/z2RAv89kgL/PZIC/zuPAsA/vwAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEaSBihElQLoRZUC/0WVAv9FlQL/RZUC/0WVAv9FlQL/RZQC/0WUAv9FlAL/RZUC/0WVAv9FmQL/RZcC/0WW' +
  'Av9EkwLYSpQKGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEyZBihOmgLoT5oC/0+aAv9PmQL/' +
  'T5sC/0+ZAv9PmQL/T5oC/0+aAv9PmwL/T5sC/0+aAv9PmwL/TZkC2EqfChgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAFmfBihanwLoWp4C/1qgAv9aoAL/Wp8C/1qfAv9aoQL/WqEC/1qfAv9aoQL/WqAC/1meAthVnwoYAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAG+vABBmpQJka6YCxG2pAt9tqQLfbakC322p' +
  'At9tqQLfbaoC32qnArhjowJcX58ACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAP+MBij/hgWY/4UE0P+GBP//hgT//4YE//+GBPv/hQXM/4YFjP+ICRwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/hgR0/4YE+/+GBP//hgT//4YE//+GBP//hgT//4YE//+GBP//hgT/' +
  '/4YE8/+HBVwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/4cDRP+G' +
  'BP//hgT//4YE//+GBP//hgT//4YE//+GBP//hgT//4YE//+GBP//hgT//4YE9/+LBSwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/hgS8/4YE//+GBP//hgT//4YE//+GBP//hgT//4YE//+GBP//hgT//4YE//+GBP//hgT//4YEnAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+SBeP/kQX//5EF//+RBf//kQX/' +
  '/5EF//+RBf//kQX//5EF//+RBf//kQX//5EF//+RBf//kQXEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAA/7IIsP+yCP//sgj//7II//+yCP//sgj//7II//+yCP//sgj//7II//+yCP//sgj//7II//+yCJAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/tAow/7II//+yCP//sgj//7II//+yCP//sgj//7II//+y' +
  'CP//sgj//7II//+yCP//sgj3/7QKGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAD/sgjn/7II//+yCP//sgj//7II//+yCP//sgj//7II//+yCP//sgj//7II//+yCMgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/78VDP+yCNj/sgj//7II//+yCP//sgj//7II//+yCP//sgj//7II//+yCP//sgj/' +
  '/7EHwP+/PwQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+zCyz/sgjY/7II//+y' +
  'CP//sgj//7II//+yCP//sgj//7II//+yCP//sgj//7II//+yCP//sgj//7IIyP+2CRwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAD/hwdk/5AG9/+RB///kQf//5EH//+RB///kQf//5EH//+RB///kQf//5EH//+RB///kQf//5EH//+RB///kQf//44G7/+J' +
  'CkwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/4cHYP+GBv//hgb//4YG//+GBv//hgb//4YG//+GBv//hgb/' +
  '/4YG//+GBv//hgb//4YG//+GBv//hgb//4YG//+GBv//hgb//4YG+/+HB0QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+R' +
  'Ehz/hgb7/4YG//+GBv//hgb//4YG//+GBv//hgb//4YG//+GBv//hgb//4YG//+GBv//hgb//4YG//+GBv//hgb//4YG//+GBv//hgb//4YG7/+fHwgAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/4cHZP+GBv//hgb//4YG//+GBv//hgb//4YG//+GBv//hgb//4YG//+GBv//hgb//4YG//+G' +
  'Bv//hgb//4YG//+GBv//hgb//4YG//+GBv//hgb//4oLRAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/hweI/4YG//+GBv//hgb/' +
  '/4YG//+GBv//hgb//4YG//+GBv//hgb//4YG//+GBv//hgb//4YG//+GBv//hgb//4YG//+GBv//hgb//4YG//+GBv//hgdoAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+FBlD/hgb//4YG//+GBv//hgb//4YG//+GBv//hgb//4YG//+GBv//hgb//4YG//+GBv//hgb//4YG//+GBv//hgb/' +
  '/4YG//+GBv//hgb//4YG//+KCjAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/18fCP9HAtz/SAL//0gC//9IAv//SAL//0gC//9I' +
  'Av//SAL//0gC//9IAv//SAL//0gC//9IAv//SAL//0gC//9IAv//SAL//0gC//9IAv//RwLEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAA/0cDRP9IAv//SAL//0gC//9IAv//SAL//0gC//9IAv//SAL//0gC//9IAv//SAL//0gC//9IAv//SAL//0gC//9IAv//SAL//0gC+/9M' +
  'BigAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/0gCsP9IAv//SAL//0gC//9IAv//SAL//0gC//9IAv//SAL/' +
  '/0gC//9IAv//SAL//0gC//9IAv//SAL//0gC//9IAv//SAOQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAD/SAJY/0gC//9IAv//SAL//0gC//9IAv//SAL//0gC//9IAv//SAL//0gC//9IAv//SAL//0gC//9IAv//SAL//0gC//9NBDgAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP9HAsD/SAL//0gC//9IAv//SAL//0gC//9IAv//SAL//0gC//9IAv//SAL//0gC//9I' +
  'Av//SAL//0gC//9IAv//SAL//0cDoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8/PwTyOAyM9z4J//c+Cf/3Pgn/' +
  '9z4J//c+Cf/3Pgn/9z4J//c+Cf/3Pgn/9z4J//c+Cf/3Pgn/9z4J//c+Cf/3Pgn/9z4J//c+Cf/2PQn78TYPdAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAA6S0SpOksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/' +
  '6SwT/+ksE//pLBP/6SwThAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOcsFXjpLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ks' +
  'E//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6isUWAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/Pz8E' +
  '6SwT6+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ks' +
  'E//oLBPQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOwtFjjpLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/' +
  '6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pNR8YAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA6S8VMOksE//pLBP/6SwT/+ks' +
  'E//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+8vHxAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAADfLx8Q3SsS990rE//dKxP/3SsT/90rE//dKxP/3SsT/90rE//dKxP/3SsT/90rE//dKxP/3SsT/90rE//dKxP/3SsT/90r' +
  'E//dKxP/3SsT/90rE//dKxP/3SsT/90rE//cKhLoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADaKhOE2SoS/9kqEv/ZKhL/2SoS/9kqEv/ZKhL/' +
  '2SoS/9kqEv/ZKhL/2SoS/9kqEv/ZKhL/2SoS/9kqEv/ZKhL/2SoS/9kqEv/ZKhL/2SoS/9kqEv/ZKhL/2SoS/9grFGQAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAN8/HwjZKhKw2SoS/9kqEv/ZKhL/2SoS/9kqEv/ZKhL/2SoS/9kqEv/ZKhL/2SoS/9kqEv/ZKhL/2SoS/9kqEv/ZKhL/2SoS/9kqEv/ZKhL/' +
  '2SoS/9kqEv/YKRKYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADZKhJs2SoS2NkqEv/ZKhL/2SoS/9kqEv/ZKhL/2SoS/9kq' +
  'Ev/ZKhL/2SoS/9kqEv/ZKhL/2SoS/9kqEv/ZKhL/2SoS/9kqEv/YKhLM2SsUWAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAA3CwTNNgrEnDZKhOc2SoSvNgqEszZKhLf2SoS39kqEt/ZKhLf2SoS39kqEt/YKhHI2SoSuNgpEpjXKRNo3C4XLAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAx5kx/8aQJP/GmDH/yZYr/8mWK//ImTL/ypMk/7yRMP+8kTD/ypMk/8iZMv/Jliz/yZYq/8iZMf/LkyX/yJkw/8eYMf/GkCT/' +
  'xpgx/8mWK/+7jCn/v5Qx/8qTJP+8kS//vJIw/8uTJP/ImTL/yZYr/8mWKv/ImTL/ypMl/8iZMP/ElzH/x5Aj/8SXMf/Fkyv/u4wo/7qQMP+7iCL/uo8v/7yR' +
  'L//KkyT/yJky/8iWK/+sgif/t44w/8uTJP/FlzD/xJcw/8aRJf/ElzH/xZQq/8mWK//ClTH/u4gi/8WYMf/ImTL/y5Mk/8iZMv/Iliv/rIEm/7eOMP/KkyX/' +
  'xZcw/8eZMv/GkCT/xpgy/8mWK//Jliv/yJkx/8qTJf/ImTH/yJky/8qTJP/ImjL/yJUr/6yBJ/+3jjD/ypMl/8iZMf/ImTH/ypMk/8iZMv/IlSv/onsm/7GK' +
  'L//KkyT/yJkx/8iZMf/KkyT/to0w/6uBKP+sgSb/t44w/8qTJf/ImTD/vJEw/8uTJP+/kzH/uYsp/6J6Jf+jfy3/oHYf/8OVMf/ImTL/ypMk/7aNMP+rgSj/' +
  'q4Em/7eOMP/LkyX/vJEv/7qPL/+7iCP/upAw/7uMKf/Jliv/uY8w/6B2H/+jfyz/qYQt/8uTJP/FmDL/xJMr/6yBJ/+shi//qn0h/7iOL//FlzH/u4gi/7qQ' +
  'MP+7jCn/yZYr/7mPMP+gdR//o38s/6mELf/LkyT/xZgy/8WUK//Klir/vZEw/6t9If/EljD/yJky/8qTJP+/kzD/u4wp/8mWK/+5jzD/oHYf/6N/LP+phC3/' +
  'ypMk/8WYMf/FlCv/yZYr/8eZMv/KkyX/yJkx/8iZMv/LkyT/yJky/8mWK//Jliv/yJkx/8qTJP+ogy3/qYQt/8qTJP/GmDL/xZQr/8mWKv/ImTL/y5Ml/8iZ' +
  'MP/ImTL/ypMk/8iZMv/Jliv/yZYr/8eZMv/KkyX/yJkx/8iZMf/LkyX/v5Qx/7uMKf/Jliv/yJoy/8qTJf/ImTH/yJkx/8qTJf+2jTD/rIIn/8iVK//ImTL/' +
  'y5Mk/8iZMf/FlzH/u4gi/7qQMP+6jCr/uoso/7+UMf/KkyX/yJkw/8iZMv/KkyT/t40w/6yBKP+rgSf/to0w/8qTJf/ImTH/xZcw/7uII//CljH/yJYr/7uM' +
  'Kf+/lDH/ypMl/8iZMf/ImTL/ypMl/8iZMv/IlSv/rIIn/7eOL//KkyT/yJkx/8iZMv/KkyT/yJoy/8mWK//Jlir/yJky/8qTJf/ImTD/x5kx/8aQJP/GmDH/' +
  'yZYr/8mWK//HmTL/ypMk/7yRL/+8kTD/ypMk/8iZMv/Jliz/yZUq/8iZMv/LkyX/yJkw//rnhP/64nb/+eeF//rlfv/65n7/+uiF//rjd//34oL/9+OC//vj' +
  'd//66Ib/+uZ///rlff/66IX/+uR4//rohP/66IT/+uJ2//nnhf/65X7/9uB7//fkhP/65Hj/9+OC//fjgv/743f/+uiF//rmf//65X7/+uiG//rkeP/66IT/' +
  '+eaE//ridf/55oT/+eR9//bgev/24oL/9t50//bhgf/344L/++R4//rnhv/65X7/8Nh5//Tgg//75Hj/+eeD//nmg//64nb/+eaE//nkff/65n7/+OaE//bd' +
  'dP/55oT/+uiF//vkd//66Ib/+uV///DXeP/04IL/+uR4//nmg//66IX/+uJ2//nnhf/65n//+uZ+//rnhv/65Hj/+ueF//rohf/743f/+uiF//rlf//w13n/' +
  '9OCD//rkeP/66IT/+uiF//vkd//66IX/+uV+/+zSd//y3YH/+uR4//rnhP/654X/++N3//Tfg//w13r/8Nd4//Tgg//65Hj/+uiE//fig//75Hf/9+SE//bf' +
  'e//s0Xf/7dV//+vOcf/45IT/+ueF//vjd//034L/8Nd5//DXef/04IP/+uR4//figv/24oL/9t10//bigv/24Hv/+uV+//Xhg//rznH/7NV+/+/YgP/75Hj/' +
  '+eeF//nkff/w13n/8NuB//DUc//14IH/+eeF//bddP/24oP/9uB7//rmfv/14IP/685w/+zVfv/v2ID/++N3//nnhf/55H3/+uV9//bihP/w1XP/+eaD//ro' +
  'hf/743f/9+WD//bge//65X7/9eGD/+vOcf/s1X7/79iA//vkd//554T/+eR9//rmff/66Ib/+uR4//rohP/66IX/++R3//rohv/65X7/+uV+//rnhf/65Hj/' +
  '7th//+/YgP/743f/+eeF//nkff/65X3/+uiG//rkeP/66IT/+uiF//vkd//66Ib/+uZ///rlfv/66Ib/+uR5//rnhP/654X/++R4//fkhP/24Hv/+uV+//ro' +
  'hv/65Hj/+uiE//rohf/75Hj/9N+D//DXef/65X7/+uiG//vjeP/654X/+eeE//bdc//24oP/9uB8//bfev/35IT/+uR4//rohP/66IX/++N3//Tgg//w2Hr/' +
  '8Nd5//Tggv/65Hj/+ueE//nmhP/23XT/+OWE//rlfv/24Hv/9+WE//rkeP/66IT/+uiF//vkeP/66IX/+uV+//HYev/04IP/+uR4//rnhf/66IX/++N3//ro' +
  'hv/65n//+uV9//rohv/65Hn/+uiE//rnhP/64nb/+eeF//rlfv/65n7/+uiF//rjd//34oL/9+OC//vjd//66IX/+uZ///rlff/66IX/+uR4//rohP8ARor/' +
  'AD18/wBFiv8AQoX/AEGF/wBGi/8APn7/AEOE/wBDhP8APX7/AEaM/wBChv8AQYT/AEaL/wA+f/8ARor/AEaK/wA9fP8ARor/AEKF/wA+fP8ARIf/AD5//wBC' +
  'g/8AQ4T/AD5//wBGi/8AQoX/AEKE/wBGi/8APn//AEaL/wBFif8APXz/AEWJ/wBBgv8APXv/AEKD/wA6df8AQoL/AEOE/wA+f/8ARoz/AEKE/wA5dP8AQoL/' +
  'AD5//wBFif8ARYn/AD18/wBGif8AQYL/AEKF/wBFiP8AOnX/AEWJ/wBGi/8APn//AEaM/wBChf8AOXP/AEGC/wA+gP8ARYj/AEaL/wA9fP8ARov/AEKF/wBC' +
  'hf8ARov/AD5//wBFi/8ARov/AD5//wBGjP8AQoX/ADl0/wBBg/8APn//AEaL/wBGi/8APn7/AEaL/wBChP8AN27/AEB//wA+f/8ARor/AEaL/wA+fv8AQYL/' +
  'ADp0/wA5c/8AQoL/AD5//wBFiv8AQoT/AD5+/wBEhv8APXv/ADdu/wA8dv8AMmf/AESH/wBGi/8APn//AEGC/wA6dP8AOXP/AEKD/wA+f/8AQoP/AEKD/wA6' +
  'df8AQoP/AD58/wBChf8AQoP/ADNn/wA8dv8APXr/AD5//wBGiv8AQYP/ADl0/wA+fP8ANm7/AEGB/wBFiv8AOXX/AEKD/wA+fP8AQoX/AEKE/wAyZv8APHX/' +
  'AD56/wA+f/8ARor/AEGD/wBChP8AQ4X/ADVu/wBFiP8ARov/AD5+/wBEhv8APnz/AEKE/wBCg/8AM2f/ADx1/wA9ef8APn//AEaK/wBBg/8AQoT/AEaM/wA+' +
  'f/8ARor/AEaL/wA+f/8ARoz/AEKF/wBChf8ARov/AD5//wA9eP8APXn/AD5//wBGiv8AQYP/AEGE/wBGjP8APn//AEaL/wBGjP8APn7/AEaM/wBChv8AQoT/' +
  'AEaM/wA/f/8ARov/AEaL/wA+f/8ARIb/AD58/wBChf8ARoz/AD5//wBGi/8ARov/AD5//wBBgv8AOnT/AEKE/wBGjP8APn//AEaL/wBFif8AOXT/AEKD/wA+' +
  'ff8APXv/AESH/wA+f/8ARor/AEaL/wA+f/8AQoL/ADp1/wA5c/8AQoL/AD5//wBFiv8ARYn/ADp1/wBEiP8AQoX/AD58/wBEh/8APn//AEaL/wBGi/8APn//' +
  'AEaL/wBChP8AOnX/AEGC/wA+f/8ARov/AEaL/wA9fv8ARoz/AEKG/wBBhP8ARoz/AD6A/wBGi/8ARor/AD18/wBGiv8AQoT/AEKF/wBGjP8APn7/AEKD/wBD' +
  'hP8APn7/AEaL/wBChf8AQYT/AEaL/wA+f/8ARor/AGnB/wBgt/8AaMH/AGS9/wBkvf8AaML/AGG4/wBlu/8AZbv/AGC4/wBpwv8AZb7/AGS8/wBpwv8AYbn/' +
  'AGjB/wBowf8AX7b/AGjB/wBlvf8AYLT/AGa9/wBhuf8AZbr/AGW7/wBhuf8AacL/AGW+/wBkvf8AacL/AGG5/wBowf8AZ8D/AF+2/wBnwP8AY7v/AF+0/wBk' +
  'uv8AXLD/AGS5/wBluv8AYbn/AGnC/wBkvP8AXKz/AGW5/wBhuf8AZ8D/AGfA/wBftv8AaMD/AGO7/wBlvf8AZ7//AFyv/wBowf8AacL/AGG5/wBpwv8AZb3/' +
  'AFyr/wBkuf8AYbn/AGfA/wBpwv8AX7b/AGjB/wBlvv8AZb3/AGnC/wBhuf8AaML/AGnC/wBhuf8AacL/AGW9/wBcrP8AZLj/AGG5/wBowv8AacL/AGG5/wBp' +
  'wv8AZb3/AFml/wBitP8AYbn/AGjC/wBowv8AYbn/AGS4/wBcrP8AXKv/AGS4/wBhuf8AaMH/AGW7/wBhuf8AZr3/AGC0/wBYpf8AXqz/AFSf/wBnvv8AacL/' +
  'AGG5/wBkuP8AXaz/AFyr/wBluf8AYbn/AGS6/wBkuv8AXK//AGS6/wBgtf8AZb3/AGW6/wBUn/8AXav/AF+v/wBhuf8AaMH/AGO7/wBcrP8AYbL/AFin/wBj' +
  'uP8AaMH/AFyv/wBkuv8AYLT/AGW9/wBluv8AU5//AF2r/wBgr/8AYLn/AGjB/wBku/8AZL3/AGa8/wBYp/8AZ7//AGnC/wBhuf8AZr3/AGC1/wBkvf8AZLn/' +
  'AFSf/wBdq/8AX6//AGG5/wBowf8AY7v/AGS9/wBpwv8AYbn/AGjC/wBpwv8AYbn/AGnC/wBlvf8AZb3/AGnC/wBhuf8AX67/AF+v/wBhuf8AaMH/AGS7/wBk' +
  'vf8AacL/AGG5/wBowv8AacL/AGG5/wBpwv8AZb7/AGW9/wBpwv8AYbn/AGjB/wBpwv8AYbn/AGa9/wBgtf8AZb3/AGnC/wBhuf8AacL/AGnC/wBhuf8AZLj/' +
  'AF2r/wBlvf8AacL/AGG4/wBpwv8AaMD/AFuu/wBluv8AYLX/AF+z/wBmvf8AYbn/AGnB/wBpwv8AYbn/AGS4/wBdrP8AXKv/AGS4/wBhuv8AaMH/AGjA/wBc' +
  'sP8AZ7//AGS9/wBgtP8AZ73/AGG5/wBpwv8AacL/AGG5/wBpwv8AZL3/AF2s/wBkuP8AYbn/AGnC/wBpwv8AYLn/AGnC/wBlvv8AZL3/AGnC/wBhuf8AaMH/' +
  'AGjB/wBgtv8AaMH/AGW9/wBlvf8AacL/AGG4/wBluv8AZbv/AGG4/wBpwv8AZb7/AGS8/wBpwv8AYbn/AGjB/zh7s/9FicP/OIC9/zmAvf9Fh8H/OHuz/zN2' +
  'r/9ChL3/S5HO/0OKx/9Kj8r/PX63/zN2r/89f7f/QIK7/zN2r/81eLD/Nn67/zZ/vf83f7z/NHWt/zF0rf8ydK3/QIS//0SMyv9EjMr/On21/zF0rf8xdK3/' +
  'Nnix/zF0rf8xdK3/QIO9/zZ/vf87g8H/QoS9/zJ1rv8yda7/QoO8/0eOy/9EjMr/SpDM/zl7s/8xdK3/Ony0/z1/t/8xdK3/OXuz/z+Hw/9Fh7//N3my/zh6' +
  'sv9EhLz/Onmw/zZ3rv9Cgrn/PoC4/zd5s/9Bgrr/O3Wo/zJsoP87dKf/RInE/zuCv/85gb//MnSs/zF0rf8zda7/NHOq/zBwp/8wcKf/NXau/zF0rf8xdK3/' +
  'NHKm/yphkf8qYZH/Mm+j/ziDwv84g8P/On22/zF0rf8zdq7/Onqx/zFwp/8wcKf/OXiv/zR2rv8xdK3/N3mx/zFpmv8qYZH/LmWV/zyCvf84g8P/O4XF/0CC' +
  'uv9EhLz/Ony0/z5/t/9DhLv/O3yz/z6At/9DhLz/Pn+3/z1+tv9CgLb/Q4S8/0KFvv9Nkc3/Q4fB/z2Auv80dq//M3Wt/zF0rf8ydK3/NXev/zF0rf8xdK3/' +
  'NXau/zF0rf8xdK3/OXu0/0SMyf9EjMr/QofE/zJ1rv8xdK3/Nneu/zF0rf8xdK3/NXev/zF0rP8xdK3/NHav/zJ0rP8xdK3/MnWu/0GGwf9EjMr/RIzK/zl8' +
  'tv8xdK3/MXSt/z98sf89frX/PH62/0OEvP89f7f/OXqx/0KCuf8/gLf/O321/0KEvf9Lj8n/QoS9/0OFvf9CgLX/O3qx/zt5rf8vZ5j/PIC6/zZ/vf83gL3/' +
  'PH21/zN2rv8xdK3/PH22/zuGxv84g8P/PIG8/zFsoP8taZ3/NXKm/zFpmf8qYZH/M3Cl/zZ/vf82f73/OH25/zJzq/8xdK3/M3av/zh/vP84g8P/OYPC/zNw' +
  'pf8taZ3/LWmd/zJuof8qYZH/KmGR/0GDu/85f7v/PYG8/0ODuv82eLH/Nneu/0SEuv8+hMH/OoC9/0OHwP87dqr/M3Gm/z16r/88d6r/MWyf/zlypP83ebH/' +
  'PXmt/y5qnv8uap7/PXeq/y5llf8qYZH/O3ap/zl7s/8xdK3/PX+3/0CIxv84g8P/QYnH/z1+tv8xdK3/NXat/y1pnP8taZ3/MW6j/yxklP8qYZH/LGSV/zR0' +
  'rP8xdK3/MXSt/zl9uf84g8P/OIPD/zl9uP8xdK3/MXSt/z57sf8wbaH/NXKm/z97r/8uZpj/L2eY/0B8sP83ebH/M3av/0CCuv9BiMX/OYPB/0KKyP8/gLn/' +
  'M3av/zx+tv+bw+j/rNDr/6LH6/+iyOv/qs7r/5vE6f+Xv+b/p8vq/7XW8f+u0O7/s9Pt/6DH6f+Xv+b/oMfp/6TK7P+Xv+b/mb/l/6DF6v+hx+z/osbq/5a9' +
  '5P+Uvuf/lb7m/6jJ6P+w0vH/sNLx/5/D5f+Uvuf/lL7n/5rA5f+Uvuf/lL7n/6bK6P+hx+z/pcvu/6bK6f+Vv+j/lb/o/6XL6f+y1PD/sNLx/7TV8P+bxOj/' +
  'lL7n/5zG6/+gx+r/lL7n/5vF6/+pzev/qczp/5rB5f+bwuf/p8vp/5rB5v+Yv+X/pMjo/6HH6f+bweb/pMnp/5W95P+Ltd//lLzk/6vP6/+lyOn/pMfp/5W9' +
  '5P+Uvuf/lr/m/5S74v+PuuX/j7rl/5e94v+Uvuf/lL7n/5K54P99rN3/fazd/4634f+lyuz/pcrt/5/E5f+Uvuf/lcDo/5zC5f+PuuX/j7rl/5nA5v+Wv+b/' +
  'lL7n/5rC6P+Hst7/fazd/4Gw3/+kyOr/pcrt/6fN7v+jyer/psvq/53D5/+hx+j/pcvq/53E5/+hx+j/psvq/6DH6P+gxej/ocjq/6bK5/+ny+z/tdfu/6nN' +
  '7P+ix+j/l7/m/5a95P+Uvuf/lb7m/5i+5P+Uvuf/lL7n/5i+4v+Uvuf/lL7n/57C5f+w0vD/sNLx/6vN7P+Vvub/lL7n/5i+4v+Uvuf/lL7n/5i/4/+Uveb/' +
  'lL7n/5e/5f+VveT/lL7n/5a/5v+qy+r/sNLx/7DS8f+fxOf/lL7n/5S+5/+ew+T/n8Xm/5/F5v+ny+j/ocbn/5vB5P+kyeb/ocfo/5/E5P+nyuf/s9Tr/6fK' +
  '6f+oyuf/ocfn/5vC5v+ZwOP/hLHg/6PH5/+hx+z/osjs/5/E5f+WwOj/lL7n/6DE5f+oze7/pcrt/6PH5/+Lt+L/iLTh/5K74/+Gst//fazd/5G33v+hx+z/' +
  'ocfs/6DE5/+UveT/lL7n/5e/5v+ixef/pcrt/6XK7P+RuN7/iLTh/4i04f+Ott7/fazd/32s3f+myOT/osbo/6XI5/+myOX/msDl/5m+4/+myeX/p8rp/6PG' +
  '5v+qzOf/mL7i/5K54P+bweT/l77i/4u03v+RuuH/mcLp/5rB5P+JteL/ibXi/5e/5P+BsOD/fazd/5a+4/+bxOr/lL7n/6DG6P+rz+3/pcrt/6vQ7v+fxun/' +
  'lL7n/5e94v+Is+D/iLTh/4634P+Brdv/fazd/4Gu3f+WvOL/lL7n/5S+5/+gw+X/pcrt/6XK7f+gxOf/lL7n/5S+5/+dw+X/jbbh/5G75P+cwuf/hLDe/4Sx' +
  '3/+cw+f/msLn/5e/5v+jyer/qs7r/6XJ6/+t0e7/osjp/5e/5v+exur/Yoo9/3GYTP9nj0H/Z49C/2+WS/9iiz3/XoY4/2yTSP95oVP/cppM/3aeUv9mjkL/' +
  'XoY4/2eOQf9qkkX/XoY4/1+HOv9kjT//ZY4//2aOQP9dhDj/W4Q1/1yENv9sk0j/c5xN/3OcTf9ljED/W4Q1/1uENf9giDv/W4Q1/1uENf9rkkb/ZY4//2mS' +
  'Q/9sk0j/XIU2/1yFNv9sk0f/dZ5Q/3OcTf93oFL/Yoo9/1uENf9jjD7/Zo9B/1uENf9iizz/bpVJ/2+WS/9hiTz/YYk8/22USf9hiTz/X4Y6/2uSR/9oj0P/' +
  'YYk8/2qSRv9ehTr/VX0w/12FOf9xmEz/aZFE/2iQQ/9chDb/W4Q1/1yFN/9bgzb/V4Ax/1eAMf9ehjr/W4Q1/1uENf9agTb/SXIj/0lyI/9XfzL/aZJD/2mS' +
  'Q/9ljEH/W4Q1/12GN/9iij7/V4Ay/1eAMf9giDv/XYU4/1uENf9giTv/Unkt/0lyI/9Ndif/aZFE/2mSQ/9slEb/apFF/2yUSP9jiz//Z49D/2yTSP9kjD//' +
  'aI9D/2yTSP9njkL/Zo5B/2mQRP9sk0j/bZVI/3mhVf9ulkr/aJBD/16GOP9chDj/W4Q1/1yENv9fhjr/W4Q1/1uENf9fhjr/W4Q1/1uENf9jiz//c5xN/3Oc' +
  'Tf9vl0r/XIU2/1uENf9fhjv/W4Q1/1uENf9fhzr/W4M1/1uENf9ehjn/XIQ3/1uENf9chTf/bpVJ/3OcTf9znE3/ZIw//1uENf9bhDX/ZYxC/2aNQv9mjUL/' +
  'bZNJ/2eOQ/9iiT7/apFH/2iPRP9ljEH/bJNJ/3eeU/9slEj/bZRJ/2iPRP9jij7/YYk9/094Kv9oj0P/ZY4//2aPQP9ljEH/XYY3/1uENf9mjEL/bJVG/2mS' +
  'Q/9okET/VX0v/1F6K/9agjX/UXks/0lyI/9ZgDX/ZY4//2WOP/9ljED/W4M2/1uENf9dhjj/Z45C/2mSQ/9pkkP/WYA1/1F6K/9Reiv/Vn4y/0lyI/9JciP/' +
  'a5FI/2aOQv9pkEX/bJJJ/2GIPP9fhjv/bZJJ/2yTR/9oj0T/b5VL/2CGPP9ZgTX/Y4k//2CGPP9VfDD/W4I3/2CJOv9iiT7/Unss/1J7LP9ghzz/TXYn/0ly' +
  'I/9fhjv/Yos8/1uENf9njkL/b5hK/2mSQ/9wmEr/Zo1B/1uENf9ehTn/UXkr/1F6K/9WfjL/THQn/0lyI/9MdSf/XYQ4/1uENf9bhDX/ZYxB/2mSQ/9pkkP/' +
  'ZYxA/1uENf9bhDX/ZItA/1V9MP9agjT/ZItA/093Kf9PeCr/ZYxB/2CJO/9dhjj/apFF/2+XSv9pkkT/cZlM/2iQRP9dhjj/ZY1A/6rRff+5247/sNSD/7DU' +
  'g/+32oz/qtF9/6bNef+014n/wuCY/7vbkv+/3Zb/rtSC/6bNef+u1IL/steG/6bNef+nzHv/rtKB/6/Ugf+v04L/pct4/6TMdf+kzHb/tNSL/73dk/+93ZP/' +
  'rc+D/6TMdf+kzHX/qM18/6TMdf+kzHX/s9WI/6/Ugf+z2IX/tNeJ/6XNdv+lzXb/s9eI/7/elf+93ZP/wN+X/6vRff+kzHX/rNN9/6/Ugv+kzHX/q9N8/7fY' +
  'i/+22Iz/qc59/6rPff+014n/qM98/6bMev+x1Yf/r9SE/6nOff+y1Yb/o8t4/5rDbf+iy3b/uNmP/7LUh/+x04b/pMt3/6TMdf+lzHf/osl2/5/JcP+fyXD/' +
  'psp6/6TMdf+kzHX/ocZ1/428Xv+NvF7/ncVx/7PVhv+z1ob/rdCC/6TMdf+lznb/qs5+/5/Jcf+fyXD/p857/6bNeP+kzHX/qc97/5bBaf+NvF7/kb9j/7HT' +
  'hv+z1ob/tdiI/7HWhv+02In/rNF//6/Ug/+z2Ij/q9F//6/UhP+02Ij/r9SD/67Tgv+v1oT/s9WJ/7TXi//C4Jn/ttqM/7DThf+mzHj/pcp4/6TMdf+kzHb/' +
  'p8t7/6TMdf+kzHX/psp7/6TMdf+kzHX/q86B/73dk/+93ZP/uNiP/6XMd/+kzHX/psp7/6TMdf+kzHX/p8t7/6TLdf+kzHX/psx5/6TLd/+kzHX/pcx3/7bW' +
  'jv+93ZP/vd2T/6zQgf+kzHX/pMx1/6vQgf+t0YP/rdGC/7TWiv+v0oT/qc5+/7HVh/+v1IT/rdCD/7TWiv+/3Zb/tNaL/7XVi/+v1IX/qc5//6fNfP+TwGX/' +
  'sNKF/6/Ugf+w1YL/rdCB/6bOd/+kzHX/rdCD/7bZif+z1ob/sdOG/5vHbf+YxGn/ocl0/5XCaP+NvF7/nsV0/6/Ugf+v1IH/rdCC/6PKdf+kzHX/psx4/6/R' +
  'hf+z1ob/s9WG/6DGdP+YxGn/mMRp/5zEcP+NvF7/jbxe/7PTiv+v0oT/sdOH/7PUiv+ozXz/p8t7/7PUiv+01or/sNGG/7bWjf+mzHv/oMd0/6nOfv+ly3r/' +
  'mcJt/6DIdP+o0Hr/qM99/5nFav+ZxWr/pc16/5HAYv+NvF7/pMt5/6vTfP+kzHX/rtOC/7najP+z1ob/uduN/67Ugf+kzHX/pcp6/5jDaf+YxGn/ncZw/5C9' +
  'Y/+NvF7/kL5i/6TJeP+kzHX/pMx1/63Pg/+z1ob/s9aG/63Qgv+kzHX/pMx1/6vQgP+cxm7/oMpz/6nQf/+Tv2X/lMBm/6rRf/+pz3z/psx4/7HWhv+42Y3/' +
  's9WH/7rbj/+w1YT/psx4/63UgP8eYzn/K3BG/xZbMf8WWzH/JGk//0WKYP8XXDL/GV40/xleNP8WWzH/Flsx/xZbMf8XXDL/HGE3/yxxR/8dYjj/K3BG/1OY' +
  'bv8bYDb/Flsx/xZbMf8WWzH/Flsx/xdcMv8XXDL/Flsx/xZbMf8WWzH/Flsx/xtgNv9TmG7/Km9F/xVaMP8dYjj/XaJ4/y5zSf8WWzH/Flsx/xVaMP9AhVv/' +
  'P4Ra/xZbMf8fZDr/GV40/yxxR/9TmG7/GV40/xZbMf8YXTP/HGE3/y90Sv8aXzX/Flsx/xZbMf8cYTf/JGk//zF2TP9Gi2H/Gl81/xZbMf8aXzX/K3BG/xxh' +
  'N/8YXTP/Imc9/xxhN/8pbkT/Gl81/xpfNf8scUf/HGE3/xdcMv8kaT//RYpg/xdcMv8WWzH/Gl81/yxxR/8cYTf/JWpA/z+EWv8WWzH/U5hu/ytwRv8rcEb/' +
  'U5hu/xdcMv8WWzH/FVow/xdcMv8WWzH/GF0z/y1ySP9TmG7/F1wy/z+EWv8XXDL/Flsx/xhdM/8cYTf/HGE3/xdcMv8WWzH/Flsx/ytwRv9Sl23/Flsx/0aL' +
  'Yf9Gi2H/F1wy/xZbMf8WWzH/GV40/xZbMf8WWzH/GF0z/ydsQv9IjWP/F1wy/zZ7Uf86f1X/Km9F/xZbMf8kaT//JWpA/xxhN/8WWzH/GV40/x5jOf8rcEb/' +
  'Flsx/xZbMf8kaT//RYpg/xdcMv81elD/OX5U/ytwRv8WWzH/Flsx/xdcMv8cYTf/Flsx/xleNP8rcEb/U5hu/xpfNf8WWzH/Flsx/xZbMf8WWzH/Flsx/ytw' +
  'Rv9Rlmz/Flsx/xZbMf8WWzH/GF0z/xZbMf8WWzH/FVow/xpfNf9coXf/LnNJ/xZbMf8WWzH/FVow/xZbMf8VWjD/F1wy/x9kOv8ZXjT/K3BG/1SZb/8XXDL/' +
  'Flsx/xhdM/8cYTf/LnNJ/xpfNf8WWzH/GF0z/0eMYv8kaT//GF0z/xxhN/8ZXjT/M3hO/zZ7Uf8obUP/HGE3/xhdM/8kaT//HGE3/yxxR/8bYDb/Flsx/xdc' +
  'Mv9FimD/LnNJ/yRpP/8cYTf/LHFH/zZ7Uf8yd03/Flsx/xxhN/8kaT//P4Ra/xhdM/9UmW//LHFH/xhdM/8WWzH/FVow/z2CWP8/hFr/GF0z/1SZb/8rcEb/' +
  'Flsx/xZbMf8YXTP/QIVb/xdcMv8WWzH/F1wy/0aLYf9Gi2H/FVow/xZbMf8WWzH/Flsx/xZbMf8YXTP/HGE3/xxhN/8YXTP/U5hu/ytwRv8ZXjT/Flsx/xZb' +
  'Mf8kaT//M3hO/0eMYv8XXDL/GV40/xleNP8WWzH/Flsx/xhdM/8ZXjT/HGE3/yhtQ/8dYjj/WJ1z/2Oofv9Nkmj/TZJo/12ieP+Bxpz/T5Rq/1OYbv9TmG7/' +
  'TZJo/02SaP9Nkmj/UJVr/1idc/9jqH7/V5xy/2Knff+L0Kb/U5hu/02SaP9Nkmj/TZJo/06Taf9PlGr/TpNp/06Taf9Nkmj/TZJo/02SaP9Sl23/i9Cm/2Kn' +
  'ff9Nkmj/VJlv/53iuP9orYP/TpNp/06Taf9MkWf/d7yS/3a7kf9Nkmj/XqN5/1OYbv9jqH7/i9Cm/1CVa/9Nkmj/UJVr/1idc/9qr4X/UZZs/0yRZ/9Ok2n/' +
  'WJ1z/12ieP9qr4X/g8ie/1SZb/9Ok2n/UZZs/2Oofv9YnXP/UJVr/1ugdv9YnXP/YKV7/1KXbf9Sl23/Y6h+/1idc/9QlWv/XaJ4/4LHnf9PlGr/TZJo/1KX' +
  'bf9jqH7/WJ1z/16jef92u5H/TZJo/4rPpf9jqH7/Yqd9/4vQpv9PlGr/TJFn/02SaP9PlGr/TpNp/1CVa/9kqX//i9Cm/0+Uav92u5H/T5Rq/06Taf9PlGr/' +
  'WJ1z/1idc/9Ok2n/TpNp/02SaP9jqH7/ic6k/02SaP+DyJ7/gsed/0+Uav9Ok2n/TpNp/1OYbv9Nkmj/TZJo/1CVa/9ip33/hMmf/0+Uav9wtYv/dLmP/2Kn' +
  'ff9Nkmj/XaJ4/2Cle/9YnXP/TZJo/1OYbv9YnXP/Y6h+/02SaP9Nkmj/XaJ4/4HGnP9PlGr/b7SK/3O4jv9jqH7/TZJo/02SaP9QlWv/WJ1z/06Taf9TmG7/' +
  'Yqd9/4rPpf9Sl23/TZJo/02SaP9Nkmj/TpNp/02SaP9ip33/ic6k/06Taf9Nkmj/TZJo/1CVa/9Ok2n/TZJo/02SaP9Sl23/nOG3/2itg/9Ok2n/TpNp/0yR' +
  'Z/9Nkmj/TZJo/0+Uav9eo3n/U5hu/2Oofv+L0Kb/TpNp/02SaP9QlWv/WJ1z/2itg/9Sl23/TJFn/0+Uav+DyJ7/XKF3/1CVa/9YnXP/U5hu/2uwhv9ssYf/' +
  'YKV7/1idc/9QlWv/XaJ4/1idc/9kqX//Updt/02SaP9PlGr/gcac/2esgv9donj/WJ1z/2Oofv9tsoj/aa6E/06Taf9YnXP/XaJ4/3a7kf9QlWv/i9Cm/2Sp' +
  'f/9PlGr/TpNp/02SaP90uY//druR/1CVa/+L0Kb/Y6h+/06Taf9Ok2n/T5Rq/3e8kv9PlGr/TpNp/06Taf+DyJ7/gsed/02SaP9Ok2n/TpNp/06Taf9Ok2n/' +
  'T5Rq/1idc/9YnXP/T5Rq/4vQpv9jqH7/U5hu/02SaP9Nkmj/XaJ4/22yiP+EyZ//T5Rq/1OYbv9TmG7/TZJo/02SaP9QlWv/U5hu/1idc/9fpHr/V5xy/16S' +
  'n/9pnar/U4eU/1OHlP9jl6T/h7vI/1WJlv9ZjZr/WY2a/1OHlP9Th5T/U4eU/1aKl/9ekp//aZ2q/12Rnv9onKn/kcXS/1mNmv9Th5T/U4eU/1OHlP9UiJX/' +
  'VYmW/1SIlf9UiJX/U4eU/1OHlP9Th5T/WIyZ/5HF0v9onKn/U4eU/1qOm/+j1+T/bqKv/1SIlf9UiJX/UoaT/32xvv98sL3/U4eU/2SYpf9ZjZr/aZ2q/5HF' +
  '0v9Wipf/U4eU/1aKl/9ekp//cKSx/1eLmP9ShpP/VIiV/16Sn/9jl6T/cKSx/4m9yv9ajpv/VIiV/1eLmP9pnar/XpKf/1aKl/9hlaL/XpKf/2aap/9YjJn/' +
  'WIyZ/2mdqv9ekp//VoqX/2OXpP+IvMn/VYmW/1OHlP9YjJn/aZ2q/16Sn/9kmKX/fLC9/1OHlP+QxNH/aZ2q/2icqf+RxdL/VYmW/1KGk/9Th5T/VYmW/1SI' +
  'lf9Wipf/ap6r/5HF0v9ViZb/fLC9/1WJlv9UiJX/VYmW/16Sn/9ekp//VIiV/1SIlf9Th5T/aZ2q/4/D0P9Th5T/ib3K/4i8yf9ViZb/VIiV/1SIlf9ZjZr/' +
  'U4eU/1OHlP9Wipf/aJyp/4q+y/9ViZb/dqq3/3quu/9onKn/U4eU/2OXpP9mmqf/XpKf/1OHlP9ZjZr/XpKf/2mdqv9Th5T/U4eU/2OXpP+Hu8j/VYmW/3Wp' +
  'tv95rbr/aZ2q/1OHlP9Th5T/VoqX/16Sn/9UiJX/WY2a/2icqf+QxNH/WIyZ/1OHlP9Th5T/U4eU/1SIlf9Th5T/aJyp/4/D0P9UiJX/U4eU/1OHlP9Wipf/' +
  'VIiV/1OHlP9Th5T/WIyZ/6LW4/9uoq//VIiV/1SIlf9ShpP/U4eU/1OHlP9ViZb/ZJil/1mNmv9pnar/kcXS/1SIlf9Th5T/VoqX/16Sn/9uoq//WIyZ/1KG' +
  'k/9ViZb/ib3K/2KWo/9Wipf/XpKf/1mNmv9xpbL/cqaz/2aap/9ekp//VoqX/2OXpP9ekp//ap6r/1iMmf9Th5T/VYmW/4e7yP9toa7/Y5ek/16Sn/9pnar/' +
  'c6e0/2+jsP9UiJX/XpKf/2OXpP98sL3/VoqX/5HF0v9qnqv/VYmW/1SIlf9Th5T/eq67/3ywvf9Wipf/kcXS/2mdqv9UiJX/VIiV/1WJlv99sb7/VYmW/1SI' +
  'lf9UiJX/ib3K/4i8yf9Th5T/VIiV/1SIlf9UiJX/VIiV/1WJlv9ekp//XpKf/1WJlv+RxdL/aZ2q/1mNmv9Th5T/U4eU/2OXpP9zp7T/ir7L/1WJlv9ZjZr/' +
  'WY2a/1OHlP9Th5T/VoqX/1mNmv9ekp//ZZmm/12Rnv+k1uL/rtzl/5jM2f+YzNn/qdbg/87r8P+aztr/n9Pg/5/T4P+Zzdr/mMzZ/5jM2f+c0N3/pNjl/6/d' +
  '5f+k1uL/rtzk/9f8/f+ez9z/mMzZ/5nN2v+YzNn/ms7b/5rO2v+azdr/ms7b/5nN2v+YzNn/mc3a/53P2//X/f3/rdvk/5jM2f+f0dz/6v7+/7Tc5f+Zzdr/' +
  'ms7b/5jM2f/D7PD/wevw/5nN2v+r3+z/n9Pg/6/c5f/X/f3/nM7a/5jM2f+c0N3/pdnm/7Xd5v+dz9v/mMzZ/5rO2/+l2eb/qNnj/7Xe5v/P7fH/odPg/5nN' +
  '2v+dz9v/r9zl/6XZ5v+c0N3/ptfi/6XY5f+s2+T/nc/b/53P2/+v3OX/pdjl/5zQ3f+p1eD/zuzw/5rO2v+YzNn/nc/b/6/c5f+l2OX/qtnj/8Hr8P+Zzdr/' +
  '1v39/67c5f+u3OT/1vz9/5rN2v+YzNn/mMzZ/5rN2v+aztv/m87b/7Dd5f/X/P3/ms3a/8Ls8P+azdr/ms7b/5rN2v+l2eb/pdnm/5nN2v+Zzdr/mc3a/67c' +
  '5P/V/P3/mMzZ/8/t8f/P7PD/ms3a/5nN2v+Zzdr/n9Pg/5nN2v+YzNn/nNDd/67a5P/Q7fH/m87a/73h6P/A4+r/rdvk/5jM2f+p1eD/rNjj/6TY5f+Zzdr/' +
  'n9Pg/6TW4v+u3OX/mMzZ/5jM2f+p1uD/zuvw/5rO2v+74Of/wOPp/67c5P+YzNn/mMzZ/5zQ3f+k2OX/mc3a/5/T4P+u3OT/1vz9/53P2/+YzNn/mc3a/5jM' +
  '2f+aztv/mc3a/67c5P/V/P3/mc3a/5jM2f+Zzdr/m87a/5rO2/+Zzdr/mMzZ/53P2//p/f7/tNzl/5nN2v+aztv/mMzZ/5jM2f+YzNn/ms7a/6vf7P+f0+D/' +
  'rtzl/9f9/f+azdr/mMzZ/5zQ3f+l2eX/tNzl/53P2/+YzNn/m87b/9Dt8f+o1eD/nNDd/6XY5f+g0+D/tuLp/7jj6v+s2+T/pdnm/5zQ3f+p2OP/pdjl/6/d' +
  '5f+dz9v/mMzZ/5vO2//O7PD/st3l/6nY4/+l2OX/r93l/7nk6v+04Oj/ms3a/6XY5f+p2eP/wevw/5vO2v/X/f3/r9zl/5vO2v+aztv/mMzZ/8Dq7//B6+//' +
  'm87a/9f9/f+u3OX/mc3a/5rO2/+aztr/wuzw/5rN2v+aztv/ms3a/8/t8f/P7PD/mMzZ/5nN2v+Zzdr/mc3a/5rO2/+azdr/pdnm/6XZ5v+aztr/1/39/67c' +
  '5P+f0+D/mc3a/5jM2f+p1eD/ud7m/9Dt8f+aztr/n9Pg/5/T4P+Zzdr/mMzZ/5zQ3f+f0+D/pNjl/6va5P+j1eH/NY/P/zeR0v83kdL/N5HS/zeR0v9MnNT/' +
  'WqTa/1ij2f9Yo9n/WqTa/0yc1P83kdL/N5HS/zeR0v83kdL/NY/P/zCMzv8visv/L4nL/y+Jy/8wjM//S5vU/1qk2v9Zo9n/WaPZ/1qk2f9Lm9T/MIzP/y+J' +
  'y/8vicv/L4nL/zCMzv8wjM3/L4nL/y+Jy/8vicv/MIzP/0WX0f9QndX/UJ3V/1Cd1f9QndX/RZfR/zCMz/8vicv/L4nL/y+Jy/8wjM3/MIzN/y+Jy/8vicv/' +
  'L4nL/zCMz/9Mm9T/W6Xa/1uk2v9bpNr/XKXa/0yb1P8wjM//L4nL/y+Jy/8vicv/MIzN/y+KzP8visz/L4rM/y+KzP8vi8z/TJvU/1qk2v9Yo9n/WKPZ/1qk' +
  '2v9Mm9T/MIvN/y+KzP8visz/L4rM/y+KzP8zicj/NYvJ/zWLyf81i8n/NYvJ/0yb0/9apNr/WKPZ/1ij2f9apNr/TJvT/zWLyf81i8n/NYvJ/zWLyf8zicj/' +
  'MIzO/zCLzf8wi83/MIvN/zCN0P9Mm9T/W6Xa/1qk2f9apNn/XKXa/0yb1P8wjM//MIvN/zCLzf8wi83/MIzO/zCMzf8vicv/L4nL/y+Jy/8wjM//R5nT/1Og' +
  '2P9ToNj/U6DY/1Og2P9HmdP/MIzP/y+Jy/8vicv/L4nL/zCMzf8wjM3/L4nL/y+Jy/8vicv/MIzP/02c1f9hqNv/YKjb/2Co2/9gqNv/TZzV/zCMz/8vicv/' +
  'L4nL/y+Jy/8wjM3/MIzN/zCLzf8wi83/MIvN/zCMz/9Mm9T/WqTa/1ij2f9Yo9n/WqTa/0yb1P8wjM//MIvN/zCLzf8wi83/MIzN/zGHxv8yiMX/MojF/zKI' +
  'xf8yiMX/TJvT/1qk2v9Yo9n/WKPZ/1qk2v9Mm9P/MojF/zKIxf8yiMX/MojF/zGHxv8xjc7/M47P/zONz/8zjs//M47Q/0yb1P9apNr/WKPZ/1ij2f9apNr/' +
  'TJvU/zOP0f8zjc//M47P/zOOz/8xjc7/MIzN/y+Jy/8vicv/L4nL/zCMz/9ImdP/VKHY/1Og2P9ToNj/U6DY/0iZ0/8wjM//L4nL/y+Jy/8vicv/MIzN/zCM' +
  'zf8vicv/L4nL/y+Jy/8wjM//T53V/2er3f9nq93/Z6vd/2er3f9PndX/MIzP/y+Jy/8vicv/L4nL/zCMzf8wjM3/L4nL/y+Jy/8vicv/MIzP/0yb1P9apNr/' +
  'WKPZ/1ij2f9apNr/TJvU/zCMz/8vicv/L4nL/y+Jy/8wjM3/LYXF/y2Fxf8thcX/LYXF/y2Fxf9LmtP/WqTa/1ij2f9Yo9n/WqTa/0ua0/8thcX/LYXF/y2F' +
  'xf8thcX/LYXF/23I8f9wyvL/cMry/3DK8v9vyvL/htLz/5bZ9f+U2PX/lNj1/5bZ9f+G0vP/b8ry/3DK8v9wyvL/cMry/23I8f9nxvD/Z8Xv/2fF7/9nxe//' +
  'aMbx/4XR8/+W2fX/ldj1/5XY9f+W2fX/hdHz/2jG8f9nxe//Z8Xv/2fF7/9nxvD/Z8bw/2fF7/9nxe//Z8Xv/2jG8f9/zvL/itPz/4rT8/+K0/P/itPz/3/O' +
  '8v9oxvH/Z8Xv/2fF7/9nxe//Z8bw/2fG8P9nxe//Z8Xv/2fF7/9oxvH/h9Lz/5fZ9f+X2fX/l9n1/5jZ9f+H0vP/aMbx/2fF7/9nxe//Z8Xv/2fG8P9nxe//' +
  'Z8Xv/2fF7/9nxe//Z8Xw/4fS8/+W2fX/lNj1/5TY9f+W2fX/h9Lz/2fF8P9nxe//Z8Xv/2fF7/9nxe//a8Tt/27F7f9uxe3/bsXt/23F7f+H0fL/ltn1/5TY' +
  '9f+U2PX/ltn1/4fR8v9txe3/bsXt/27F7f9uxe3/a8Tt/2fG8P9oxvD/aMbw/2jG8P9ox/H/h9Lz/5fZ9f+W2fX/ltn1/5ja9f+H0vP/aMfx/2jG8P9oxvD/' +
  'aMbw/2fG8P9nxvD/Z8Xv/2fF7/9nxe//aMbx/4HQ8/+O1vX/jtb1/47W9f+O1vX/gdDz/2jG8f9nxe//Z8Xv/2fF7/9nxvD/Z8bw/2fF7/9nxe//Z8Xv/2jG' +
  '8f+I0vP/ndz2/5zb9v+c2/b/nNv2/4jS8/9oxvH/Z8Xv/2fF7/9nxe//Z8bw/2fG8P9oxvD/aMbw/2jG8P9ox/H/h9Lz/5bZ9f+U2PX/lNj1/5bZ9f+H0vP/' +
  'aMfx/2jG8P9oxvD/aMbw/2fG8P9pwuz/asLs/2rC7P9qwuz/asLs/4fR8/+W2fX/lNj1/5TY9f+W2fX/h9Hz/2rC7P9qwuz/asLs/2rC7P9pwuz/acfw/2vI' +
  '8f9ryPH/a8jx/2vI8f+H0vP/ltn1/5TY9f+U2PX/ltn1/4fS8/9ryPL/a8jx/2vI8f9ryPH/acfw/2fG8P9nxe//Z8Xv/2fF7/9oxvH/gtDz/4/W9f+P1vX/' +
  'j9b1/4/W9f+C0PP/aMbx/2fF7/9nxe//Z8Xv/2fG8P9nxvD/Z8Xv/2fF7/9nxe//aMbx/4nT9P+j3ff/o933/6Pd9/+j3ff/idP0/2jG8f9nxe//Z8Xv/2fF' +
  '7/9nxvD/Z8bw/2fF7/9nxe//Z8Xv/2jG8f+G0vP/ltn1/5TY9f+U2PX/ltn1/4bS8/9oxvH/Z8Xv/2fF7/9nxe//Z8bw/2XA7P9lwOv/ZcDr/2XA6/9lwOv/' +
  'hdHy/5bZ9f+U2PX/lNj1/5bZ9f+F0fL/ZcDr/2XA6/9lwOv/ZcDr/2XA7P/PpjX/0qg3/9KoN//SqDf/0qg3/9SwTP/auFr/2bdY/9m3WP/auFr/1LBM/9Ko' +
  'N//SqDf/0qg3/9KoN//PpjX/zqMw/8uhL//LoS//y6Ev/8+kMP/UsEv/2rha/9m3Wf/Zt1n/2bha/9SwS//PpDD/y6Ev/8uhL//LoS//zqMw/82jMP/LoS//' +
  'y6Ev/8uhL//PpDD/0axF/9WxUP/VsVD/1bFQ/9WxUP/RrEX/z6Qw/8uhL//LoS//y6Ev/82jMP/NozD/y6Ev/8uhL//LoS//z6Qw/9SwTP/auFv/2rhb/9q4' +
  'W//auFz/1LBM/8+kMP/LoS//y6Ev/8uhL//NozD/zKIv/8yhL//MoS//zKEv/8yiL//UsEz/2rha/9m3WP/Zt1j/2rha/9SwTP/NozD/zKEv/8yhL//Moi//' +
  'zKIv/8igM//JojX/yaI1/8miNf/JojX/069M/9q4Wv/Zt1j/2bdY/9q4Wv/Tr0z/yaI1/8miNf/JojX/yaI1/8igM//OozD/zaMw/82jMP/NozD/0KUw/9Sw' +
  'TP/auFv/2bha/9m4Wv/auVz/1LBM/8+kMP/NozD/zaMw/82jMP/OozD/zaMw/8uhL//LoS//y6Ev/8+kMP/Trkf/2LVT/9i1U//YtVP/2LVT/9OuR//PpDD/' +
  'y6Ev/8uhL//LoS//zaMw/82jMP/LoS//y6Ev/8uhL//PpDD/1bFN/9u7Yf/bumD/27pg/9u6YP/VsU3/z6Qw/8uhL//LoS//y6Ev/82jMP/NozD/zaMw/82j' +
  'MP/NozD/z6Qw/9SwTP/auFr/2bdY/9m3WP/auFr/1LBM/8+kMP/NozD/zaMw/82jMP/NozD/xp4x/8WeMv/FnjL/xZ4y/8WeMv/Tr0z/2rha/9m3WP/Zt1j/' +
  '2rha/9OvTP/FnjL/xZ4y/8WeMv/FnjL/xp4x/86kMf/PpTP/z6Uz/8+lM//QpjP/1LBM/9q4Wv/Zt1j/2bdY/9q4Wv/UsEz/0aYz/8+lM//PpTP/z6Yz/86k' +
  'Mf/NozD/y6Ev/8uhL//LoS//z6Qw/9OuSP/YtVT/2LRT/9i0U//YtFP/065I/8+kMP/LoS//y6Ev/8uhL//NozD/zaMw/8uhL//LoS//y6Ev/8+kMP/Vsk//' +
  '3b5n/92+Z//dvmf/3b5n/9WyT//PpDD/y6Ev/8uhL//LoS//zaMw/82jMP/LoS//y6Ev/8uhL//PpDD/1LBM/9q4Wv/Zt1j/2bdY/9q4Wv/UsEz/z6Qw/8uh' +
  'L//LoS//y6Ev/82jMP/FnC3/xZwt/8WcLf/FnC3/xZwt/9OvS//auFr/2bdY/9m3WP/auFr/069L/8WcLf/FnC3/xZwt/8WcLf/FnC3/9eFs//bicP/24nD/' +
  '9uJw//bib//25ov/+Ouc//jrmv/465r/+Ouc//bmi//24m//9uJw//bicP/24nD/9eFs//XfZf/z3mT/895k//PeZP/132b/9uaJ//jrnf/465v/+Oub//jr' +
  'nP/25on/9d9m//PeZP/z3mT/895k//XfZf/132X/895k//PeZP/z3mT/9d9m//Xkgf/3547/9+eO//fnjv/3547/9eSB//XfZv/z3mT/895k//PeZP/132X/' +
  '9d9l//PeZP/z3mT/895k//XfZv/25or/+Oue//jrnf/4653/+Oue//bmiv/132b/895k//PeZP/z3mT/9d9l//TeZf/03mX/9N5l//TeZf/032X/9uaK//jr' +
  'nP/465r/+Oua//jrnP/25or/9N9l//TeZf/03mX/9N5l//TeZf/y3Wn/8t5s//LebP/y3mz/8t5s//bmiv/465z/+Oua//jrmv/465z/9uaK//LebP/y3mz/' +
  '8t5s//LebP/y3Wn/9d9l//TfZf/032X/9N9l//XgZv/25or/+Oue//jrnP/465z/+Oue//bmiv/14Gb/9N9l//TfZf/032X/9d9l//XfZf/z3mT/895k//Pe' +
  'ZP/132b/9uWE//fpk//36ZP/9+mT//fpk//25YT/9d9m//PeZP/z3mT/895k//XfZf/132X/895k//PeZP/z3mT/9d9m//bni//57KT/+eyk//nspP/57KT/' +
  '9ueL//XfZv/z3mT/895k//PeZP/132X/9d9l//TfZf/032X/9N9l//XgZv/25or/+Ouc//jrmv/465r/+Ouc//bmiv/14Gb/9N9l//TfZf/032X/9d9l//Hc' +
  'Z//x3Gj/8dxo//HcaP/x3Gj/9uaK//jrnP/465r/+Oua//jrnP/25or/8dxo//HcaP/x3Gj/8dxo//HcZ//14Gf/9eBp//Xgaf/14Gn/9eFp//bmiv/465z/' +
  '+Oua//jrmv/465z/9uaK//bhaf/14Gn/9eBp//Xgaf/14Gf/9d9l//PeZP/z3mT/895k//XfZv/25YX/+OmU//jplP/46ZT/+OmU//blhf/132b/895k//Pe' +
  'ZP/z3mT/9d9l//XfZf/z3mT/895k//PeZP/132b/9ueN//ntq//57av/+e2r//ntq//2543/9d9m//PeZP/z3mT/895k//XfZf/132X/895k//PeZP/z3mT/' +
  '9eBm//bmiv/465z/+Oub//jrmv/4653/9uaK//XfZv/z3mT/895k//PeZP/132X/8dpj//DaY//w2mP/8Npj//DaY//25Yr/+Ouc//jrmv/465r/+Ouc//bl' +
  'iv/w2mP/8Npj//DaY//w2mP/8dpj/zCFzv8whc7/RZPV/0ST1f8whc7/MIXO/0WT1f9Ek9X/MIXO/zCFzv9Fk9X/RJPV/zCFzv8whc7/RZPV/0ST1f8whc3/' +
  'MIXN/0CQ1P9AkNT/MIXN/zCFzf9AkNT/QJDU/zCFzf8whc3/QJDU/0CQ1P8whc3/MIXN/0CQ1P9AkNT/R5XW/0eV1v8whc3/MIXN/0eV1v9HlNX/MIXN/zCF' +
  'zf9Hldb/R5TV/zCFzf8whc3/RpXW/0aU1f8whc3/MIXN/0aU1v9GlNX/MIXO/zCFzv9GlNb/RpTV/zCFzv8whc7/RpTW/0aU1f8whc7/MIXO/0aU1v9GlNX/' +
  'MIXO/zCFzv8whc7/MIXO/0KR1P9CkdT/MIXO/zCFzv9CkdT/QpHU/zCFzv8whc7/QpHU/0KR1P8whc7/MIXO/0KR1P9CkdT/MIXN/zCFzf9Ek9X/RJPV/zCF' +
  'zv8whc7/RJPV/0ST1f8whc7/MIXO/0ST1f9Ek9X/MIXO/zCFzv9Ek9X/RJPV/0ST1f9Ek9X/MIXN/zCFzf9Ek9X/RJPV/zCFzv8whc7/RJPV/0ST1f8whc7/' +
  'MIXO/0ST1f9Ek9X/MIXO/zCFzv9Ek9X/RJPV/zCFzv8whc7/RJPV/0ST1f8whc7/MIXO/0ST1f9Dk9X/MIXO/zCFzv9Ek9X/RJPV/zCFzv8whc7/MIXO/zCF' +
  'zv9Ek9X/RJPV/zCFzv8whc7/RJPV/0ST1f8whc7/MIXO/0ST1f9Ek9X/MIXO/zCFzv9Ek9X/RJPV/zCFzf8whc3/RJPV/0ST1f8whc7/MIXO/0ST1f9Ek9X/' +
  'MIXO/zCFzv9Ek9X/RJPV/zCFzv8whc7/RJPV/0ST1f9Ek9X/RJPV/zCFzf8whc3/RJPV/0ST1f8whc7/MIXO/0ST1f9Ek9X/MIXO/zCFzv9Ek9X/RJPV/zCF' +
  'zv8whc7/RpTW/0aU1f8whc7/MIXO/0aU1v9GlNX/MIXO/zCFzv9GlNb/RpTV/zCFzv8whc7/RpTW/0aU1f8whc7/MIXO/zCFzv8whc7/QpHU/0KR1P8whc7/' +
  'MIXO/0KR1P9CkdT/MIXO/zCFzv9CkdT/QpHU/zCFzv8whc7/QpHU/0KR1P8whc3/MIXN/0WU1v9FlNX/MIXO/zCFzv9FlNb/RZTV/zCFzv8whc7/RZTW/0WU' +
  '1f8whc7/MIXO/0WU1v9FlNX/Q5LV/0OS1f8whc3/MIXN/0OS1f9DktX/MIXO/zCFzv9DktX/Q5LV/zCFzv8whc7/Q5LV/0OS1f8whc7/MIXO/0KR1P9CkdT/' +
  'MIXO/zCFzv9CktT/QpLU/zCFzv8whc7/QpLU/0KS1P8whc7/MIXO/0KS1P9CktT/MIXO/zCFzv+Fxu//hcbv/4TG7/+Exu//hcbv/4XG7/+Exu//hMbv/4XG' +
  '7/+Fxu//hMbv/4TG7/+Fxu//hcbv/4TG7/+Exu//hMbv/4TG7/+Fxu//hcbv/4TG7/+Exu//hcbv/4XG7/+Exu//hMbv/4XG7/+Fxu//hMbv/4TG7/+Fxu//' +
  'hcbv/4TG7/+Exu//hcbv/4XG7/+Exu//hMbv/4XG7/+Fxu//hMbv/4TG7/+Fxu//hcbv/4TG7/+Exu//hcbv/4XG7/+Fxu//hcbv/4TG7/+Exu//hcbv/4XG' +
  '7/+Exu//hMbv/4XG7/+Fxu//hMbv/4TG7/+Fxu//hcbv/4TG7/+Exu//hcbv/4XG7/+Exu//hMbv/4XG7/+Fxu//hcbv/4XG7/+Fxu//hcbv/4XG7/+Fxu//' +
  'hcbv/4XG7/+Fxu//hcbv/4TG7/+Exu//hcbv/4XG7/+Exu//hMbv/4XG7/+Fxu//hMbv/4TG7/+Fxu//hcbv/4TG7/+Exu//hcbv/4XG7/+Exu//hMbv/4XG' +
  '7/+Fxu//hcbv/4XG7/+Fxu//hcbv/4XG7/+Fxu//hcbv/4XG7/+Fxu//hcbv/4XG7/+Fxu//hcbv/4XG7/+Exu//hMbv/4XG7/+Fxu//hMbv/4TG7/+FxvD/' +
  'hcbv/4TG7/+Exu//hcbv/4XG7/+Exu//hMbv/4XG7/+Fxu//hMbv/4TG7/+Fxu//hcbv/4XG7/+FxvD/hcbv/4XG7/+Fxu//hcbv/4XG7/+Fxu//hcbv/4XG' +
  '8P+Exu//hMbv/4XG7/+Fxu//hMbv/4TG7/+Fxu//hcbv/4TG7/+Exu//hcbv/4XG7/+Exu//hMbv/4XG7/+Fxu//hMbv/4TG7/+Fxu//hcbv/4XG7/+Fxu//' +
  'hcbv/4XG7/+Fxu//hcbv/4XG7/+Fxu//hcbv/4XG7/+Fxu//hcbv/4XG7/+Fxu//hMbv/4TG7/+Fxu//hcbv/4TG7/+Exu//hcbv/4XG7/+Exu//hMbv/4XG' +
  '7/+Fxu//hMbv/4TG7/+Fxu//hcbv/4TG7/+Exu//hcbv/4XG7/+Fxu//hcbv/4XG7/+Fxu//hcbv/4XG7/+Fxu//hcbv/4XG7/+Fxu//hMbv/4TG7/+Fxu//' +
  'hcbv/4TG7/+Exu//hcbv/4XG7/+Exu//hMbv/4XG7/+Fxu//hMbv/4TG7/+Fxu//hcbv/4TG7/+Exu//hcbv/4XG7/+Fxu//hcbv/4XG7/+Fxu//hcbv/4XG' +
  '7/+Fxu//hcbv/4XG7/+Fxu//hcbv/4XG7/+Fxu//hcbv/4TG7/+Exu//hcbv/4XG7/+Exu//hMbv/4XG8P+Fxu//hMbv/4TG7/+Fxu//hcbv/4TG7/+Exu//' +
  'zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/8x3Mf/MdzH/zXcx/813Mf/MdzH/zHcx/813' +
  'Mf/NdzH/zHcx/8x3Mf/NdzH/zXcx/8x3Mf/MdzH/zXcx/813Mf/NdzH/zXcx/8x3Mf/MdzH/zXcx/813Mf/MdzH/zHcx/813Mf/NdzH/zHcx/8x3Mf/NdzH/' +
  'zXcx/8x3Mf/MdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813' +
  'Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/MdzH/zHcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/' +
  'zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/MdzH/zHcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813' +
  'Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/' +
  'zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zHcx/8x3Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813' +
  'Mf/NdzH/zXcx/813Mf/NdzH/zHcx/8x3Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/' +
  'zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813' +
  'Mf/NdzH/zXcx/813Mf/NdzH/zXcx/8x3Mf/MdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/' +
  'zXcx/8x3Mf/MdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813' +
  'Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/++9hf/vvYX/772F/++8hf/vvYX/772F/++9hf/vvIX/772F/++9hf/vvYX/77yF/++9hf/vvYX/' +
  '772F/++8hf/vvIX/77yF/++9hf/vvIX/77yF/++8hf/vvYX/77yF/++8hf/vvIX/772F/++8hf/vvIX/77yF/++9hf/vvIX/772F/++8hf/vvYX/772F/++9' +
  'hf/vvIX/772F/++9hf/vvYX/77yF/++9hf/vvYX/772F/++8hf/vvYX/772F/++9hf/vvIX/77yF/++8hf/vvYX/77yF/++8hf/vvIX/772F/++8hf/vvIX/' +
  '77yF/++9hf/vvIX/77yF/++8hf/vvYX/772F/++9hf/vvIX/772F/++9hf/vvYX/77yF/++9hf/vvYX/772F/++8hf/vvYX/772F/++9hf/vvIX/77yF/++8' +
  'hf/vvYX/77yF/++8hf/vvYX/772F/++8hf/vvIX/772F/++9hf/vvIX/77yF/++9hf/vvYX/77yF/++9hf/vvIX/772F/++9hf/vvYX/77yF/++9hf/vvYX/' +
  '772F/++8hf/vvYX/772F/++9hf/vvIX/772F/++9hf/vvYX/77yF/++8hf/vvIX/772F/++8hf/vvIX/772F/++9hf/vvIX/77yF/++9hf/vvYX/77yF/++8' +
  'hf/vvYX/772F/++9hf/vvYX/77yF/++9hf/vvYX/772F/++8hf/vvYX/772F/++9hf/vvIX/772F/++9hf/vvYX/77yF/++8hf/vvIX/772F/++8hf/vvIX/' +
  '772F/++9hf/vvIX/77yF/++9hf/vvYX/77yF/++8hf/vvYX/772F/++8hf/vvYX/77yF/++9hf/vvYX/772F/++8hf/vvYX/772F/++9hf/vvIX/772F/++9' +
  'hf/vvYX/77yF/++9hf/vvYX/772F/++8hf/vvIX/77yF/++9hf/vvIX/77yF/++9hf/vvYX/77yF/++8hf/vvYX/772F/++8hf/vvIX/772F/++9hf/vvYX/' +
  '772F/++8hf/vvYX/772F/++9hf/vvIX/772F/++9hf/vvYX/77yF/++9hf/vvYX/772F/++8hf/vvIX/77yF/++9hf/vvIX/77yF/++9hf/vvYX/77yF/++8' +
  'hf/vvYX/772F/++8hf/vvIX/772F/++9hf/vvIX/772F/++8hf/vvYX/772F/++9hf/vvIX/772F/++9hf/vvYX/77yF/++9hf/vvYX/772F/++8hf/vvYX/' +
  '772F/++9hf/vvIX/77yF/++8hf/vvYX/77yF/++8hf/vvYX/772F/++8hf/vvIX/772F/++9hf/vvIX/77yF/++9hf9IZkH/R2RA/01tRf9NbET/T29G/01s' +
  'RP9IZkH/SG9M/0hvTP9HZED/TW1F/01sRP9Pb0b/TWxE/0hmQP9IZkH/W4FR/1BySP9Xe07/VntN/1l+T/9YfU//V3tO/1eHW/9bgVH/UHJI/1d7Tv9We03/' +
  'WX5P/1h9T/9Xe07/V3xO/1d7Tv9Ud0v/VXlM/1d8Tv9XfE7/Tm9G/0xtRf9PhGH/V3tO/1R3S/9VeUz/V3xO/1d8Tv9Ob0b/TG1F/09wR/9Wek3/VntN/1yD' +
  'Uv9We03/V31O/09wR/9RdEr/TIVj/1Z6Tf9We03/XINS/1Z7Tf9XfU7/T3BH/1F0Sf9MbUX/VXlM/1Z6Tf9cg1L/XINS/1yCUv9Wek3/Wn9Q/05+WP9VeUz/' +
  'VnpN/1yDUv9cg1L/XIJS/1Z6Tf9af1D/Tm5G/1V4TP9Rc0n/VntN/1Z7Tf9We03/VntO/2KLV/9Vf1P/VYVd/1F0Sf9We03/VntN/1Z7Tf9We07/YotX/1V5' +
  'TP9Wek3/U3VK/1J1Sv9VeEz/WoBR/1d9T/9hiVb/VIFV/1aGXP9Tdkv/UnVK/1V4TP9agFH/V31P/2GJVv9UeEv/W4FR/1uAUf9bgVH/V3xO/1yDU/9XfE//' +
  'WX9Q/1l9T/9bgVH/W4BR/1uBUf9XfE7/XINT/1d8T/9Zf1D/WX1P/1Z6Tf9Rckn/W4FR/1qAUP9bglL/VHhM/1V5Tf9Wg1n/VoNZ/1FzSf9bgVH/WoBQ/1uC' +
  'Uv9UeEz/VXlM/1Z6Tf9bgVH/UHJI/1d7Tv9We03/WX5P/1h9T/9Xe07/V4db/1uBUf9Qckj/V3tO/1Z7Tf9Zfk//WH1P/1d7Tv9XfE7/V3tO/1R3S/9VeUz/' +
  'V3xO/1d8Tv9Ob0b/TG1F/0+EYf9Xe07/VHdL/1V5TP9XfE7/V3xO/05vRv9MbUX/T3BH/1Z6Tf9We03/XINS/1Z7Tf9XfU7/T3BH/1F0Sv9MhWP/VnpN/1Z7' +
  'Tf9cg1L/VntN/1d9Tv9PcEf/UXRJ/0xtRf9VeUz/VnpN/1yDUv9cg1L/XIJS/1Z6Tf9af1D/Tn5Y/1V5TP9Wek3/XINS/1yDUv9cglL/VnpN/1p/UP9Obkb/' +
  'VXhM/1FzSf9We03/VntN/1Z7Tf9We07/YotX/1V/U/9VhV3/UXRJ/1Z7Tf9We03/VntN/1Z7Tv9ii1f/VXlM/02Fbf9Kf2j/Sn5l/0uCa/9OhWr/ToRr/1KM' +
  'cf9Mf2b/TYVs/0qAaf9KfmT/S4Jr/06Fa/9OhGr/Uoxx/0uAZ/8/aVP/QGlS/0BpUf8/aVL/QGlR/0BpUf8/aVL/QWlQ/z9pUv8/aVL/QWlQ/z9pU/9AaVH/' +
  'QGlR/z9pU/9AaVD/m7mT/5m3kv+gv5f/n76X/6LBmf+fvpf/mriS/5u5k/+buZP/mbeS/6C/l/+fvpf/osGZ/5++l/+auJL/m7mT/6/QpP+kw5v/q8ug/6rK' +
  'oP+szaL/rMyi/6rKof+ry6H/r9Ck/6TDm/+ry6D/qsqg/6zNov+szKL/qsqh/6vLof+ry6D/p8ee/6nIn/+ry6H/q8uh/6HAmP+fvpf/osCZ/6vLoP+nx57/' +
  'qcif/6vLof+ry6H/ocCY/5++l/+iwJn/qsug/6rKoP+w0aX/qsqg/6vLof+iwZn/pcWc/5++l/+qy6D/qsqg/7DRpf+qyqD/q8uh/6LBmf+lxZz/n76X/6jJ' +
  'nv+qyqD/sNGl/7DRpf+w0KX/qcmg/63No/+hv5j/qMme/6rKoP+w0aX/sNGl/7DQpf+pyaD/rc2j/6G/mP+oyJ//pMOb/6rKoP+qyqD/qsqg/6rJoP+21qv/' +
  'qcif/6jIn/+kw5v/qsqg/6rKoP+qyqD/qsmg/7bWq/+pyJ//qsqg/6bFnf+lxZz/qMef/63NpP+ryqL/tNWq/6jHnv+qyqD/psWd/6XFnP+ox5//rc2k/6vK' +
  'ov+01ar/qMee/6/QpP+uz6T/r9Ck/6vLof+w0Kb/q8qi/63No/+szaL/r9Ck/67PpP+v0KT/q8uh/7DQpv+ryqL/rc2j/6zNov+qyqD/pMKb/6/QpP+tzqT/' +
  'r8+m/6fGn/+ox5//qsqg/6rKoP+kwpv/r9Ck/63OpP+vz6b/p8af/6jHn/+qyqD/r9Ck/6TDm/+ry6D/qsqg/6zNov+szKL/qsqh/6vLof+v0KT/pMOb/6vL' +
  'oP+qyqD/rM2i/6zMov+qyqH/q8uh/6vLoP+nx57/qcif/6vLof+ry6H/ocCY/5++l/+iwJn/q8ug/6fHnv+pyJ//q8uh/6vLof+hwJj/n76X/6LAmf+qy6D/' +
  'qsqg/7DRpf+qyqD/q8uh/6LBmf+lxZz/n76X/6rLoP+qyqD/sNGl/6rKoP+ry6H/osGZ/6XFnP+fvpf/qMme/6rKoP+w0aX/sNGl/7DQpf+pyaD/rc2j/6G/' +
  'mP+oyZ7/qsqg/7DRpf+w0aX/sNCl/6nJoP+tzaP/ob+Y/6jIn/+kw5v/qsqg/6rKoP+qyqD/qsmg/7bWq/+pyJ//qMif/6TDm/+qyqD/qsqg/6rKoP+qyaD/' +
  'ttar/6nIn/+g1LL/nM+u/5zOrf+d0bH/odOy/6DTsv+k2bf/ns+t/6DUsv+c0K//nM6s/53Rsf+h07L/odKy/6TZt/+e0K7/kbqj/5G6o/+Su6L/kbqj/5K6' +
  'ov+SuqL/kbqj/5O7of+RuqP/kbqj/5O7of+RuqP/krqi/5K6ov+RuqP/kruh/30dF/97HBb/hR8Y/4QeGf+IHxn/hB8Y/3wdF/99JiP/fSYj/3sdF/+FHxj/' +
  'hB4Z/4gfGf+EHxj/fB0X/30dF/+dIxz/iyAa/5YiHP+WIhz/mSMc/5kjHP+WIhv/ly4q/50jHP+LIBr/liIc/5YiHP+ZIxz/mSMc/5YiG/+XIhv/liIb/5Eh' +
  'G/+TIRv/lyIc/5ciHP+IHxn/hR8Z/4gzNP+WIhv/kSEb/5MhG/+XIhz/lyIc/4gfGf+FHxj/iB8Z/5UiG/+VIhz/nyQd/5YiHP+XIxz/iR8Z/44hGv+ENjn/' +
  'lSIb/5UiHP+fJB3/liIc/5cjHP+JHxn/jiEa/4QfGP+TIRv/lSIb/58kHf+fJB3/niQd/5UiG/+bJBz/hy4t/5MhG/+VIhv/nyQd/58kHf+eJB3/lSIb/5sk' +
  'HP+HHhj/kiEa/4wgGv+VIhv/lSIb/5UiG/+WIhv/qScf/5MpI/+SLiz/jCEa/5UiG/+VIhv/lSIb/5YiG/+pJx//kyEb/5UiG/+PIRr/jiAa/5MiG/+cJB3/' +
  'mCMc/6cmH/+SLCX/lS4r/48hGv+OIBr/kyIb/5wkHf+YIxz/pyYf/5IhGv+dIxz/nCMc/50jHP+XIhz/oCQe/5ciHP+aIxz/mSMc/50jHP+cIxz/nSMc/5ci' +
  'HP+gJB7/lyIc/5ojHP+ZIxz/lSIb/4sgGf+dIxz/nCMd/58kHf+SIRv/kyIb/5UrJ/+VKyf/iyAa/50jHP+cIx3/nyQd/5IhG/+TIhv/lSIb/50jHP+LIBr/' +
  'liIc/5YiHP+ZIxz/mSMc/5YiG/+XLir/nSMc/4sgGv+WIhz/liIc/5kjHP+ZIxz/liIb/5ciG/+WIhv/kSEb/5MhG/+XIhz/lyIc/4gfGf+FHxn/iDM0/5Yi' +
  'G/+RIRv/kyEb/5ciHP+XIhz/iB8Z/4UfGP+IHxn/lSIb/5UiHP+fJB3/liIc/5cjHP+JHxn/jiEa/4Q2Of+VIhv/lSIc/58kHf+WIhz/lyMc/4kfGf+OIRr/' +
  'hB8Y/5MhG/+VIhv/nyQd/58kHf+eJB3/lSIb/5skHP+HLi3/kyEb/5UiG/+fJB3/nyQd/54kHf+VIhv/myQc/4ceGP+SIRr/jCAa/5UiG/+VIhv/lSIb/5Yi' +
  'G/+pJx//kykj/5IuLP+MIRr/lSIb/5UiG/+VIhv/liIb/6knH/+TIRv/hTZC/380P/9/Mjz/gTZC/4c1P/+GNT//jTlD/4IzPP+FNkH/fzVA/38yO/+BNkH/' +
  'hzZA/4c1Pv+NOUP/gjM9/20pL/9uKC7/bycs/20pL/9vKC3/bigt/20pL/9wJyz/bSgu/20oLv9wJyz/bSkv/24oLf9vKC3/bSkv/28nLP/GcmH/xHFg/852' +
  'ZP/NdWT/0Hdl/812ZP/FcWH/xnJh/8ZyYf/EcWD/znZk/811ZP/Qd2X/zXZk/8VxYf/GcmH/4oNt/9F6Z//df2r/3H5q/9+Aa//dgGv/3H9q/9yAa//ig23/' +
  '0Xpn/91/av/cfmr/34Br/92Aa//cf2r/3IBr/9yAa//XfWj/2X5p/91/av/df2r/z3dl/812ZP/OeWb/3IBr/9d9aP/Zfmn/3X9q/91/av/Pd2X/zXZk/855' +
  'Zv/cfmr/3H5q/+WDbf/bf2r/3X9r/9B5Zv/Ve2f/zHZk/9x+av/cfmr/5YNt/9t/av/df2v/0Hlm/9V7Z//MdmT/2X5p/9t+av/lg23/5YNt/+SDbf/afmr/' +
  '34Fs/813Zf/Zfmn/235q/+WDbf/lg23/5INt/9p+av/fgWz/zXdl/9h+af/Semf/235q/9t+av/bfmr/2X9q/+qIcf/Zfmn/2H5p/9J6Z//bfmr/235q/9t+' +
  'av/Zf2r/6ohx/9l+af/af2r/1Xxo/9R8aP/WfWn/3oJs/9qAa//oh3D/2H1p/9p/av/VfGj/1Hxo/9Z9af/egmz/2oBr/+iHcP/YfWn/4oNt/+GDbf/ig23/' +
  '3IBq/+OEbf/agGv/3oFs/9+BbP/ig23/4YNt/+KDbf/cgGr/44Rt/9qAa//egWz/34Fs/9p/av/Remf/4oNt/+CCbP/ig23/1X1p/9h+af/af2r/2n9q/9F6' +
  'Z//ig23/4IJs/+KDbf/VfWn/2H5p/9p/av/ig23/0Xpn/91/av/cfmr/34Br/92Aa//cf2r/3IBr/+KDbf/Remf/3X9q/9x+av/fgGv/3YBr/9x/av/cgGv/' +
  '3IBr/9d9aP/Zfmn/3X9q/91/av/Pd2X/zXZk/855Zv/cgGv/131o/9l+af/df2r/3X9q/893Zf/NdmT/znlm/9x+av/cfmr/5YNt/9t/av/df2v/0Hlm/9V7' +
  'Z//MdmT/3H5q/9x+av/lg23/239q/91/a//QeWb/1Xtn/8x2ZP/Zfmn/235q/+WDbf/lg23/5INt/9p+av/fgWz/zXdl/9l+af/bfmr/5YNt/+WDbf/kg23/' +
  '2n5q/9+BbP/Nd2X/2H5p/9J6Z//bfmr/235q/9t+av/Zf2r/6ohx/9l+af/Yfmn/0npn/9t+av/bfmr/235q/9l/av/qiHH/2X5p/8qPh//Gi4P/xomB/8aN' +
  'hf/LjYT/yo2E/9CSif/IioH/yo6G/8WLhP/GiYD/xo2F/8uOhf/KjYT/0JKJ/8iKgv+zenb/tHp1/7Z5dP+0enb/tXl0/7V5df+zenb/t3l0/7R6dv+0enb/' +
  't3l0/7R6dv+1eXX/tXl0/7R6dv+2eXT/nnUI/6Z7CP+TbQj/kGsH/7SGCv+tgAn/xJEK/7qJCf+tgQn/iGUH/4tnB//EkQr/xJEK/5ZvCP+bcwj/xZIK/41o' +
  'B/+heAj/sIMJ/6R6CP++jgr/roEJ/66BCf+qfgn/p3wJ/4lmB/+IZQf/n3YI/7eICf+xgwn/rYAJ/9CbC/+Vbwf/pHoI/7OFCf+heAj/nnYI/7uLCf+7iwn/' +
  'rIAJ/6Z7CP+NaQf/iWYH/6R6CP+2hwn/r4II/6F3CP+ofQn/j2oH/66BCf+fdgj/iGUH/4hlB/+ugQn/vo0J/8uXCv+pfQj/soQJ/551CP+ddQj/yZUL/5Fr' +
  'CP+IZQf/gmAH/8mVCv+5iQn/rH8J/592CP/EkQv/x5QL/7aHCf/Llwr/roIJ/592CP+tgAn/o3kI/8mVC/+9jAr/vYwK/8WSCv+ZcQj/l3AI/5dwCP+nfAn/' +
  'tYcJ/5tzCP+acwj/mXII/7eJCv+qfgn/q38J/66BCf+1hwn/vY0K/7uLCv+pfgn/kmwH/5NtCP+Qawj/mHEI/8mWCv+WcAf/lW8I/45pB/+geAj/u4oK/7+O' +
  'Cv+2hwn/tYcJ/7CCCf+vggn/tIYK/82ZDP+xhAz/u4oJ/66CDP/IlQr/uYsN/62CDP+ddAj/nXQI/7qLDf/IlQ3/y5gM/8aTC//OmAr/t4kN/7WIDP/NmQz/' +
  'qYIW/6uDGv/JmRr/yZkZ/7uNEf+ziBL/p4EY/7GIGf+6jhn/sogX/8yZDP+eehj/s4ka/9CfGv/Flxv/uooK/6F4Cf+gdgn/r4IJ/7CDCv+qfgn/n3YI/6Z7' +
  'CP+jeQn/qHwJ/7CDCf+0hgn/mXEI/5x0CP+nfAn/nXUI/7uLCv+bcwj/oXcI/7uLCf+lewn/q38J/510CP+acgj/togK/6d8CP+5iQn/tocJ/5JsCP+fdgj/' +
  'oHYI/5JsB//Ajwr/y5gK/7eHCf+6ign/jGgH/6t+Cf/OmQr/w5AK/7WHCv+NaQf/lG0I/+CnC//gpwv/sYMJ/7KECf/Qmwv/kGsH/5tzCP+tgQn/oHcI/4xo' +
  'B/+ieAj/r4II/8eUCv/Hkwr/j2oH/41oB/+zhAr/s4QJ/7iICf+xgwn/0JsL/5tzCP+jeQj/q38J/6yBCf+heAj/tYYJ/7OFCf+jeQn/soUJ/592CP+acwj/' +
  'xpIL/5xzCP+nfAj/soUJ/7GECf+YcQj/t4gJ/7SGCf+xhAn/uooK/7GECf+mewj/mXII/6uACf+ugQn/pnsJ/7KECv+ddAj/o3kI/7aHCf+nfAn/xZIK/7aH' +
  'Cf+qfwn/oXcI/82YC//Qmwv/q38J/5FsCP/Fkgr/sIIJ/8COCv+1hgn/lG0I/6x/Cf+rfwn/kWsH/7GZLP+4ny3/po8q/6KMKP/KrjL/w6gx/9i8Nf/PszT/' +
  'wqcw/5qFJ/+chyj/2Lw1/9i8Nf+pkiv/r5cs/9y+N/+fiSj/uJ4u/8arMf+5oC7/07cz/8arMv/GqzL/v6Yw/7uiL/+ahSf/mYQm/7SbLf/PszT/x6wy/8Wp' +
  'Mf/myDn/pY8o/7uhL//JrTL/tp0u/7KaLf/RtTT/0rY0/8GnMP+6oS//oIoo/5yHKP+3ni3/zrIz/8WqMf+3ni7/vaMv/6CKJ//DqDD/spos/5aDJf+WgyX/' +
  'xKox/9a5Nv/hwzf/vaQv/8WrMf+ymi3/sJks/9/BN/+jjSn/loMl/5F9JP/gwjj/0LQ0/8GmMP+ymiz/2742/93ANv/OsjP/4sM3/8OoMP+0my3/v6Yv/7ee' +
  'Lf/fwTf/1bc1/9a5Nv/cvjf/rZUs/6uTK/+qkyv/uaAu/82wM/+xmCz/rpYr/66WK//LsDL/wqcx/8OoMf/EqTH/zLAz/9W4Nf/TtjX/v6Uw/6WOKf+ljin/' +
  'pI0p/6yVK//fwDb/q5Mr/6eRKf+giij/tp0t/9G1NP/WuTb/zLAy/8yvMv/IrDL/x6wy/8itMf/jxTn/yK00/82zMv/CqTP/3sA2/9C0Nv/CqDP/rZYq/62W' +
  'Kv/RtTf/4MI6/+LEOf/bvjf/4sQ3/82yNv/KrzP/5MU5/7+nO//AqD7/3sND/97DQ//RtTr/yK44/7ukO//ErD7/zbRA/8ivPv/ixDn/sJo4/8mwP//nykX/' +
  '3MBE/9K1Nf+2nS7/tJwt/8WrMf/HrDH/wKUw/7WcLf+4ny3/uJ4u/76kMP/HrDL/zLAz/6mSKv+xmCz/vaMv/7KZLf/TtjX/sZgt/7adLv/PtDP/u6Eu/8Cm' +
  'L/+zmi3/r5cs/8qvMv++ozD/z7Mz/86yNP+ljyr/s5st/7ScLf+ljyr/1rk0/+DCNv/NsTP/zrMz/5qGJv+/pTD/4sU3/9i7Nf/KrzL/n4ko/6aQKv/21jz/' +
  '9tY8/8esMv/IrTL/5sg5/6KMKf+xmCz/wqgw/7WcLf+ahib/uJ4u/8isM//ewDf/3cA3/6KLKP+eiSj/ya4z/8muMv/NsjP/yK0y/+bIOf+slSr/uqAv/8Kn' +
  'Mf/CqDD/tZwt/8uwMv/JrjL/t58u/8muMv+0my3/r5cs/9u+Nv+wmCz/vaMw/8quMv/JrTL/rZUr/82xM//MrzP/yKwy/9K0NP/KrjP/vKMv/6qUKv/DpzH/' +
  'xKkx/72jMP/JrjL/rZYq/7mfL//NsDP/vaMv/9y+N//OsjP/waYw/7ScLf/kxjn/5sg5/8CnMf+ijSn/3L43/8esMv/UuDT/yq8y/6SPKf/BpzH/wKYw/6GM' +
  'KP9RY3j/U2R6/1Bhdv9RYnf/R1Zp/01ecv9TZHr/UWN4/0dWaP9NXnL/UGF1/1Nkev9TZHr/QlBi/0NRY/9RY3j/UGF2/09fdP9QYXb/T2B1/0dXav9MXXH/' +
  'T2B1/1Bhd/9OXnP/UGB1/1Bhdv9QYXb/UGF2/01dcf9MXHD/U2R6/1Nkev9OX3T/UGF2/09gdv9JWWz/T2B1/1Bhdv9QYXf/UGF3/09gdP9PYHT/U2R6/09f' +
  'dP9QYXb/T2B1/1Bhdv9RY3j/UGF2/1Bid/9TZHr/U2R6/1Bhdf9QYXb/U2R6/1FjeP9TZHr/UGF1/1FjeP9OX3L/T190/1Nkev9RY3j/UWN4/1Bhdv9QYnf/' +
  'UWJ3/01dcf9OX3L/TV5y/1Nkev9HV2n/TV5y/1Nkev9RY3j/Tl9y/09fdP9QYXb/UWN4/0JQYf9BT2D/SFdq/1Jkef9PYHT/Tl5z/1Bhdf9QYXb/SFdq/0xc' +
  'cf9PYHT/UGJ3/09gdf9QYXb/Tl90/0lZbf9ATV7/P01d/0ZVZ/9QYHX/U2V6/09fdP9QYHX/TFxw/0VTZf9OXnL/UGF2/1Fid/9RYnf/T190/0xccP9IWGv/' +
  'U2R6/1Bhdv9UZnv/UmN4/1Jkef9RYnf/Slpt/ztHV/87R1f/S1pu/1Bhdv9TZHr/UmR5/1Rme/9NXnL/R1dq/1Nkev9EU2T/R1Zp/1FjeP9RY3j/UWJ2/1Bh' +
  'dv9PYHX/T2B1/1FjeP9PYHX/U2R6/z1KWv9KWWz/UWN4/1Bhdv9QYXX/Q1Fi/0ZVZ/9QYXb/S1tv/0pabv9MXHD/U2R6/0tabv9PX3P/UGF2/1Bhdv88SFj/' +
  'SVhr/1Bhdf9QYXb/UGB1/0VTZf9IWGv/UmN5/0dXav9IWGv/Sllt/1Bhdf9IVmn/TFxw/1Fid/9QYXX/P0tc/0tcb/9QYXb/UGF1/1Jkef9UZnz/UWJ3/1Jj' +
  'ef9TZXr/UGF2/1RmfP9SZHn/SFZp/05fc/9RYnf/VGZ8/1RmfP9QYXf/UGJ3/1Nkev9QYXb/SFhr/0hXav9IV2r/U2V6/09gdP9PX3T/UWJ4/1Fid/9QYXb/' +
  'UGF1/01dcP9QYXb/UWJ4/09gdf9TZHr/U2R6/0xccP9KWm7/SVls/0xdcf9QYHX/TV1y/0VUZv9LW27/Slpt/0pabv9OX3P/UGF2/05ecv9MXXH/TV1x/09g' +
  'df9QYXb/Tl9z/0tbbv9LWm7/TV1y/0hYa/89Slr/SFdq/0hYav9JWGv/TFxw/1Nkev9MXHD/S1tv/0tbb/9RY3j/T2B1/1Bhdv9RYnf/UWN4/1Nkev9KWm7/' +
  'Pktb/1FjeP9QYXX/U2R6/1FjeP9RY3j/UGF2/1Bhdv9RY3j/ZHKB/2h2hv9danj/W2h1/3KBk/9ufY3/eoud/3WFlv9ufI3/V2Nv/1hkcf96i53/eoud/19s' +
  'ev9jcH//fY2g/1pmc/9ndYX/cH+Q/2h2hv93iJr/cH6P/3B+j/9se4r/aniI/1dib/9WYm//ZXOC/3WElv9xgJD/b32O/4OUqP9eanj/aXeH/3GBkf9ndIT/' +
  'ZXKB/3eGmP93h5j/bXyM/2l4h/9aZnP/WGRx/2d1hf90hJX/b36O/2d1hP9reYn/WmZ0/259jf9lcoH/VWFt/1Vhbf9vfo7/eYmb/4CRpP9seon/cH+P/2Vy' +
  'gf9jcYD/fo+i/1xodv9VYW3/Ul1p/3+Qo/92hZf/bXuM/2Vzgv98jZ//fY6h/3SElf+AkaT/bn2O/2Vzgv9sfIz/Z3aF/36Pov94iJr/eYmb/32NoP9ib33/' +
  'YG17/2BtfP9pd4f/c4OU/2NxgP9ib37/Ym9+/3ODlP9te4z/bXyN/259jv9zgpT/eIia/3eHmf9seov/XWp3/11qd/9caXf/YW59/36Po/9gbXv/Xmt5/1pm' +
  'dP9mdIT/doaY/3mJm/9zgpT/c4KU/3CAkP9wf5D/cYGS/4KTpv9ygZH/dYWW/3B+jv9+jqL/d4aY/29+jv9icH7/YnB+/3iHmP+AkaP/gZKl/3yNn/+AkqX/' +
  'dYWW/3ODlP+Ck6b/cn+O/3SBj/+Flab/hJWm/3mJmv91g5T/cH6M/3eEk/97ipn/d4WV/4GSpf9rd4T/eYeW/4qarP+Ek6T/d4eY/2d1hP9mc4L/b3+P/3CA' +
  'kP9se4v/ZnOD/2h2hv9odYX/a3mJ/3F/kP9zgpP/YG17/2RxgP9reYn/ZHKB/3eHmf9kcYD/Z3WE/3WGl/9pd4f/bHuL/2Rygf9icH//c4KT/2t5if91hJb/' +
  'dIOV/11qd/9lc4H/ZnOC/11pd/95iZz/f5Ck/3ODlf91hZb/V2Nw/2x6iv+AkqX/eoud/3OCk/9aZnP/Xmp4/4yftP+Mn7T/cYCQ/3GAkf+DlKj/XGh1/2Rx' +
  'gP9ufY3/ZnSD/1djcP9odYX/cH+Q/36Pof99jqH/W2d1/1llc/9xgZL/cYGS/3SElf9xgJH/g5So/2Fvff9pd4b/bXyM/259jf9mdIP/c4KT/3KBkv9odoX/' +
  'cYGS/2Vzgv9jcH//fI2g/2Nxf/9reYn/coGS/3GBkf9hbn3/dIOU/3OCk/9xgJD/doaY/3KBkv9qeIj/YW58/218jf9ufo7/anmJ/3GAkv9ib37/aHaG/3SD' +
  'lP9reYn/fY2g/3SElf9te4z/ZnSD/4GTpv+DlKj/bXyM/1xpdv99jaD/cH+Q/3iJm/9ygpP/XWp3/218jP9te4z/W2h1/7hqD/+pYg//qWIP/6liD/+pYg//' +
  'qWIP/6liD/+pYg//qWIP/6liD/+pYg//qWIP/6liD/+pYg//qWIP/7hqD//TcgD/olcA/6JXAP+jWAH/qWAM/6NYAf+iVwD/olcA/6JXAP+iVwD/olcA/6NY' +
  'Af+iVwD/olcA/6JXAP/TcgD/03IA/6JXAP+rYxD/pmMU/5FRB/+nYxX/qmIP/6JXAP+iVwD/qWEN/6lkFf+bWxH/qWQV/6lgDP+iVwD/03IA/9NyAP+kWQP/' +
  'pGET/207AP9qOQD/bTsA/6ZjFf+jWAL/o1gC/6ZiFP9uOwD/ajkA/288AP+nYxX/o1gB/9NyAP/TcgD/rGUR/4tMAf9qOQD/ajkA/2o5AP+PTwX/tG8g/7Vw' +
  'If+LTAL/ajkA/2o5AP9qOQD/j08F/6piDv/TcgD/03IA/6RaBP+iXxL/azoA/2o5AP9sOgD/pGEU/6NZAv+lWwX/n10P/2s5AP9qOQD/azoA/6FfEf+kWQP/' +
  '03IA/9NyAP+iVwD/q2QR/6FfEv+JSgH/omAS/6tjEP+iVwD/olcA/6xlEv+bWAz/hUgA/5xaDP+sZRL/olcA/9NyAP/TcgD/olcA/6JXAP+kWgT/tnIj/6Ra' +
  'A/+iVwD/olcA/6JXAP+iVwD/p14J/7VwIf+nXgn/olcA/6JXAP/TcgD/03IA/6JXAP+iVwD/olcA/7BqGP+iVwD/olcA/6JXAP+iVwD/olcA/6JXAP+wahj/' +
  'olcA/6JXAP+iVwD/03IA/9NyAP+iVwD/qmEO/6hkFf+XVw3/qGQV/6lhDf+iVwD/olcA/6piDv+nZBX/l1cN/6hkFf+pYQ3/olcA/9NyAP/TcgD/o1kC/6Zj' +
  'E/9uOwD/ajkA/207AP+mYxX/o1gB/6NZAv+kYRP/bTsA/2o5AP9uOwD/qGMU/6NYAf/TcgD/03IA/6tkEf+NTQL/ajkA/2o5AP9qOQD/jU4E/6piDv+rZBH/' +
  'iksC/2o5AP9qOQD/ajkA/5BPBf+qYg7/03IA/9NyAP+lWgT/ol4Q/2s6AP9qOQD/azoA/6FfEv+kWQP/pVoE/59dEP9rOgD/ajkA/2w6AP+jYBL/pFkD/9Ny' +
  'AP/TcgD/olcA/6xlEv+eWw7/h0kA/51bD/+rZBH/olcA/6JXAP+sZRH/nVoO/4dJAP+fXA//q2QR/6JXAP/TcgD/03IA/6JXAP+iVwD/pl0H/6xlEv+mXAf/' +
  'olcA/6JXAP+iVwD/olcA/6ZdB/+sZRL/plwG/6JXAP+iVwD/03IA/5hZD/+KUQ//ilEP/4pRD/+KUQ//ilEP/4pRD/+KUQ//ilEP/4pRD/+KUQ//ilEP/4pR' +
  'D/+KUQ//ilEP/5hZD//+lSf//oca//6HGv/+hxr//oca//6HGv/+hxr//oca//6HGv/+hxr//oca//6HGv/+hxr//oca//6HGv/+lSf//6w6//9+DP//fgz/' +
  '/38N//+GF///fw3//34M//9+DP//fgz//34M//9+DP//fw3//34M//9+DP//fgz//6w6//+sOv//fgz//4ga//SGHf/hcg7/9oYe//+IGv//fgz//34M//+G' +
  'GP/4hx7/5nwY//mIHv//hhf//34M//+sOv//rDr//4AP//OEHP+yVAL/rlIB/7NVAv/1hh3//38O//9/Dv/1hR3/tFUC/65SAf+0VgL/9oce//9/Df//rDr/' +
  '/6w6//+JHP/dbAn/rlIB/65SAf+uUgH/33AM//+TKf//lCv/3W0J/65SAf+uUgH/rlIB/99wDP//hxn//6w6//+sOv//gA//8IIb/7BTAf+uUgH/sFMB//KD' +
  'HP//gA7//4ER/+5/GP+vUwH/rlIB/69TAf/wgRr//4AP//+sOv//rDr//34M//+JHP/vgRr/2msI//CCG///iBv//34M//9+DP//ih3/63oU/9VnBv/sfBX/' +
  '/4oc//9+DP//rDr//6w6//9+DP//fgz//4EQ//+VLP//gA///34M//9+DP//fgz//34M//+EFf//lCr//4QU//9+DP//fgz//6w6//+sOv//fgz//34M//9+' +
  'DP//jiL//34M//9+DP//fgz//34M//9+DP//fgz//48i//9+DP//fgz//34M//+sOv//rDr//34M//+HGP/3hx7/5HgV//aHHv//hxj//34M//9+DP//hxn/' +
  '9oce/+R4Ff/3hx7//4YY//9+DP//rDr//6w6//+ADv/1hRz/tFUC/65SAf+zVQL/9IUd//9/Df//gA7/84Qc/7JUAv+uUgH/tFUC//aGHf//fw3//6w6//+s' +
  'Ov//iRv/324J/65SAf+uUgH/rlIB/91uDP//hxn//4kc/9tsCf+uUgH/rlIB/65SAf/gcAz//4cZ//+sOv//rDr//4EQ//GBGf+wUwH/rlIB/69TAf/vgRr/' +
  '/4AP//+BEP/ufxj/r1MB/65SAf+wUwH/8oMb//+ADv//rDr//6w6//9+DP//iRz/7n4W/9dpB//tfRf//4kb//9+DP//fgz//4kc/+x9Fv/YaQf/738X//+J' +
  'G///fgz//6w6//+sOv//fgz//34M//+DE///ih3//4IS//9+DP//fgz//34M//9+DP//gxP//4od//+CEv//fgz//34M//+sOv/QfCH/0G4U/9BuFP/QbhT/' +
  '0G4U/9BuFP/QbhT/0G4U/9BuFP/QbhT/0G4U/9BuFP/QbhT/0G4U/9BuFP/QfCH/ZWNo/11bYP9dW2D/XVtg/11bYP9dW2D/XVtg/11bYP9dW2D/XVtg/11b' +
  'YP9dW2D/XVtg/11bYP9dW2D/ZWNo/2tpbv9SUFX/UlBV/1NRVv9cWl//U1FW/1JQVf9SUFX/UlBV/1JQVf9SUFX/U1FW/1JQVf9SUFX/UlBV/2tpbv9raW7/' +
  'UlBV/15cYf9eXGH/TUtQ/19dYv9eXGH/UlBV/1JQVf9cWl//YF5j/1dVWv9gXmP/W1le/1JQVf9raW7/a2lu/1RSV/9dW2D/NzU6/zY0Of84Njv/Xlxh/1NR' +
  'Vv9TUVb/Xlxh/zg2O/82NDn/ODY7/19dYv9TUVb/a2lu/2tpbv9gXmP/R0VK/zY0Of82NDn/NjQ5/0tJTv9raW7/bGpv/0hGS/82NDn/NjQ5/zY0Of9LSU7/' +
  'XVtg/2tpbv9raW7/VVNY/1tZXv83NTr/NjQ5/zc1Ov9dW2D/VFJX/1ZUWf9YVlv/NjQ5/zY0Of83NTr/W1le/1RSV/9raW7/a2lu/1JQVf9fXWL/Wlhd/0ZE' +
  'Sf9bWV7/X11i/1JQVf9SUFX/YF5j/1RSV/9EQkf/VVNY/2BeY/9SUFX/a2lu/2tpbv9SUFX/UlBV/1VTWP9ta3D/VVNY/1JQVf9SUFX/UlBV/1JQVf9ZV1z/' +
  'a2lu/1lXXP9SUFX/UlBV/2tpbv9raW7/UlBV/1JQVf9SUFX/ZWNo/1JQVf9SUFX/UlBV/1JQVf9SUFX/UlBV/2VjaP9SUFX/UlBV/1JQVf9raW7/a2lu/1JQ' +
  'Vf9dW2D/X11i/1NRVv9gXmP/XFpf/1JQVf9SUFX/XVtg/19dYv9TUVb/YF5j/1xaX/9SUFX/a2lu/2tpbv9UUlf/Xlxh/zg2O/82NDn/ODY7/15cYf9TUVb/' +
  'VFJX/11bYP84Njv/NjQ5/zg2O/9fXWL/U1FW/2tpbv9raW7/X11i/0lHTP82NDn/NjQ5/zY0Of9KSE3/XVtg/19dYv9HRUr/NjQ5/zY0Of82NDn/S0lO/11b' +
  'YP9raW7/a2lu/1VTWP9aWF3/NzU6/zY0Of83NTr/Wlhd/1RSV/9WVFn/WVdc/zc1Ov82NDn/NzU6/1xaX/9UUlf/a2lu/2tpbv9SUFX/YF5j/1dVWv9FQ0j/' +
  'V1Va/19dYv9SUFX/UlBV/2BeY/9XVVr/RUNI/1hWW/9fXWL/UlBV/2tpbv9raW7/UlBV/1JQVf9YVlv/YF5j/1dVWv9SUFX/UlBV/1JQVf9SUFX/WFZb/2Be' +
  'Y/9XVVr/UlBV/1JQVf9raW7/VVNY/05MUf9OTFH/TkxR/05MUf9OTFH/TkxR/05MUf9OTFH/TkxR/05MUf9OTFH/TkxR/05MUf9OTFH/VVNY/7Cus/+joab/' +
  'o6Gm/6Ohpv+joab/o6Gm/6Ohpv+joab/o6Gm/6Ohpv+joab/o6Gm/6Ohpv+joab/o6Gm/7Cus//Ixsv/m5me/5uZnv+cmp//oqCl/5yan/+bmZ7/m5me/5uZ' +
  'nv+bmZ7/m5me/5yan/+bmZ7/m5me/5uZnv/Ixsv/yMbL/5uZnv+koqf/n52i/4uJjv+gnqP/pKKn/5uZnv+bmZ7/oqCl/6Kgpf+Vk5j/oqCl/6Kgpf+bmZ7/' +
  'yMbL/8jGy/+dm6D/npyh/2hma/9lY2j/aGZr/6Ceo/+cmp//nJqf/6Ceo/9pZ2z/ZWNo/2lnbP+hn6T/nJqf/8jGy//Ixsv/paOo/4WDiP9lY2j/ZWNo/2Vj' +
  'aP+Jh4z/rauw/66ssf+Fg4j/ZWNo/2VjaP9lY2j/iYeM/6Ohpv/Ixsv/yMbL/52boP+bmZ7/ZmRp/2VjaP9nZWr/nZug/5yan/+enKH/mJab/2Zkaf9lY2j/' +
  'ZmRp/5uZnv+dm6D/yMbL/8jGy/+bmZ7/pKKn/5qYnf+DgYb/m5me/6Sip/+bmZ7/m5me/6WjqP+Ukpf/f32C/5WTmP+lo6j/m5me/8jGy//Ixsv/m5me/5uZ' +
  'nv+dm6D/sK6z/52boP+bmZ7/m5me/5uZnv+bmZ7/oJ6j/6+tsv+gnqP/m5me/5uZnv/Ixsv/yMbL/5uZnv+bmZ7/m5me/6mnrP+bmZ7/m5me/5uZnv+bmZ7/' +
  'm5me/5uZnv+qqK3/m5me/5uZnv+bmZ7/yMbL/8jGy/+bmZ7/o6Gm/6Kgpf+QjpP/oZ+k/6Kgpf+bmZ7/m5me/6Ohpv+hn6T/kI6T/6Kgpf+ioKX/m5me/8jG' +
  'y//Ixsv/nJqf/6Ceo/9pZ2z/ZWNo/2hma/+fnaL/nJqf/5yan/+enKH/aGZr/2VjaP9pZ2z/oZ+k/5yan//Ixsv/yMbL/6WjqP+HhYr/ZWNo/2VjaP9lY2j/' +
  'h4WK/6Ohpv+lo6j/hIKH/2VjaP9lY2j/ZWNo/4mHjP+joab/yMbL/8jGy/+enKH/m5me/2Zkaf9lY2j/ZmRp/5uZnv+dm6D/npyh/5mXnP9mZGn/ZWNo/2Zk' +
  'af+dm6D/nZug/8jGy//Ixsv/m5me/6WjqP+XlZr/gX+E/5eVmv+lo6j/m5me/5uZnv+lo6j/lpSZ/4F/hP+Ylpv/paOo/5uZnv/Ixsv/yMbL/5uZnv+bmZ7/' +
  'n52i/6WjqP+fnaL/m5me/5uZnv+bmZ7/m5me/5+dov+lo6j/n52i/5uZnv+bmZ7/yMbL/5KQlf+Egof/hIKH/4SCh/+Egof/hIKH/4SCh/+Egof/hIKH/4SC' +
  'h/+Egof/hIKH/4SCh/+Egof/hIKH/5KQlf8iOwz/JD4N/yQ/Df8mQg7/J0QO/yZDDv8nRQ7/JkQO/yQ/Df8jPg3/KUkP/ydGDv8mRA7/J0QO/yZDDv8mQg7/' +
  'JkMO/yE7DP8eNQv/IDgM/yE6DP8lQg3/JkMN/yZCDf8kPg3/JkIN/ydFDv8lQQ3/KEYO/ydEDv8qSw//JEAN/x83C/8nRA3/IjsM/yE7DP8lQQ3/HzcL/ydF' +
  'Dv8jPgz/J0QO/ydFDv8lQg3/IjsM/ypJDv8sTQ//J0YO/yM9DP8iPAz/IjsM/yZDDv8kPw3/IToM/x41C/8iPAz/KUgO/ydFDv8nRQ7/KEcO/yA3C/8rTA//' +
  'K0sP/ydFDv8kPwz/HjUL/x83C/8kPw3/JkMO/yI7DP8bLwr/JEEN/yZCDv8pSA7/KEYO/ydFDv8mQg3/IzwM/yM9Df8mQw7/IDgL/yM+Df8hOgz/JUEN/yI8' +
  'DP8jPQ3/HjQL/yE7DP8lQQ3/JkQO/ylIDv8sTQ//KEYO/ydFDv8mQg7/JkMO/yZDDv8mRA7/ITkM/yVBDf8iPAz/Iz4N/yE6DP8jPgz/IjwM/yVBDf8qSg//' +
  'KkoP/ydFDv8oRg7/J0QO/yZBDv8jPg3/IjwM/yI7DP8kPwz/JkMN/yZCDf8cMQr/JEAN/yA3C/8iOgz/Ij0M/yM9Df8mQw7/Iz4M/yM+DP8mQg3/IDkM/x83' +
  'C/8iPAz/KUgO/ydFDv8mRA7/JkIN/yM8DP8nRA7/IjsM/yI7DP8lQQ3/JUAN/ylGD/8kPw3/IjsN/yVADf8dNAv/JD4N/yZCDv8qSg//KEYO/yZDDv8pSQ//' +
  'ITkL/yVBDf8kPw3/ITsM/yVADf8lQg7/JT8N/yVADf8lQA3/IjwM/yM9DP8kPw3/J0QO/ylIDv8sTQ//J0UO/yM9DP8jPQz/JkQO/yM9DP8hOgz/Iz0N/yVA' +
  'Df8mRA7/JD4M/x82C/8eNAv/Iz4M/yQ/Df8pSQ//KkoP/yhFDv8nRQ7/JkEN/yM9DP8mQw7/IToM/yI8DP8jPQz/HzUL/x0zCv8mQg3/IDkM/yVBDf8mQw3/' +
  'JUAN/yVCDf8qSg//JkQN/yZBDv8lQA3/ITsM/ydGDv8kPwz/HzcL/x42C/8kPw3/JD8N/yRADf8lQA3/IjwM/x83C/8hOQz/IToM/yVBDf8iPAz/ITkM/yI8' +
  'DP8gOAv/Iz0M/xsvCv8gOAv/IjoM/yZBDf8rSw//KkoP/yZCDf8mRA3/IjwM/yQ/Df8lQg3/J0UO/ypID/8nRQ7/JUAN/yA4DP8pSA//IjwM/x0zCv8MFAX/' +
  'DBQF/wsUBP8MFAX/CxME/wsSBP8KEQT/ChEE/wsUBP8NFgX/CxME/woRBP8LEgT/CxME/wsTBP8JDwP/apI3/2+bOf9wnDr/c6A7/3WjPP90oTz/d6Q8/3Wi' +
  'O/9xnDr/bpo5/3qnP/93pDz/daI8/3WiPP90oTz/cpw6/3KdOv9qljj/Y4w1/2aPNv9pkjb/cZ06/3WiO/9zoDv/bpo5/3KeO/92pDz/cZw6/3elPf91ojz/' +
  'e6o//26YOP9ljTX/daM7/2yYOP9rljj/cp87/2WONf92pDz/bpo5/3WjPP92ozz/cp46/2qUN/96qT7/fq1A/3elPP9sljj/apQ4/2yYOP90oDv/b5s6/2qW' +
  'OP9jizT/bZk4/3mmPf92ozz/dqM8/3ilPf9ljjX/faw//32qQP93pDz/bZc4/2KHNP9ljjX/b5s6/3ShO/9slzj/XIEx/3KeOv9zoDv/eac+/3elPf92ozz/' +
  'cZ06/2qUN/9tlzj/c547/2SLNf9sljj/aZM2/3GeOv9slzj/bpk5/2KKM/9slzj/cp46/3SiPP94pj3/fq0//3ilPf92ozz/c6A7/3OhO/9xnDr/c507/2mS' +
  'N/9ynzr/bJg4/26aOf9pkzf/bpo5/2yYOP9ynjv/e6k+/3upPv92pD3/d6U9/3WiPP9ynzv/bJY4/2qTN/9qlDf/b5s5/3SiPP9ynzv/XoQy/2+aOv9njzb/' +
  'apM3/2yWOP9tmDj/c547/22YOP9umDj/cp86/2aPNf9ljjT/bJg4/3mnPf93pD3/daI8/3KfO/9tlzj/dKA8/2uVOP9rljj/cZ46/3CdOv93pT3/bpo5/2qV' +
  'N/9vmTr/YYcz/2+bOf9zoDv/e6k//3elPf90oTv/eqc+/2eRNv9ynjv/b5s6/2uWOP9xnjr/c6A7/3CcOv9xnTr/b5g6/2uUN/9umjn/b5w6/3ShPP94pz7/' +
  'fq5A/3ajPP9tmDj/bJc4/3WiPP9tmTn/apY3/26aOf9xnTr/c6A7/2yWOP9iiTT/YYkz/26bOf9vnDr/eqg+/3uqPv93pD3/dqQ8/3GeO/9umjn/c6A7/2qW' +
  'N/9tmTj/bZk5/2OMNP9fhjL/cZs6/2iSNv9xnjr/c6A7/3GdOv9zoDv/eqg+/3SiO/9yoDv/cZ46/2qWOP93pT3/b5s5/2aPNv9kjTX/bZc4/26XOP9vmzn/' +
  'b5s5/2uWN/9ljjX/Z5A2/2iSN/9wmzr/a5U3/2eQNv9rlTf/Z482/2uVOP9cgTD/Z5E2/2iRNv9wmjr/fKs//3ypP/9zoTv/dKI7/22YOP9vnDr/cqA7/3aj' +
  'PP96qD7/dqQ8/3GeOv9okjb/eaY+/2yYOf9ghjL/Lz8d/zFBHf8wPx3/MEAd/y8/HP8uPhz/LT0c/y09HP8vPx3/MkIe/y8/HP8tPRz/Lj0c/y4+HP8uPhz/' +
  'Kjga/2AWCv9lGAv/ZhcL/2sZC/9uGQz/bRkM/3EaDP9sGQv/ZxgL/2UXC/92Gw3/cBkM/28aDP9uGQz/bBkM/2sZC/9sGQv/XhYK/1YUCf9aFQr/XxYK/2kY' +
  'C/9uGQv/ahgL/2QXC/9pGAv/bxkM/2oZC/9xGgz/bRkM/3gbDf9nFwv/WRUJ/28ZC/9gFgr/XxYK/2sZC/9ZFQn/bhkM/2QXCv9vGgv/cBoM/2kYC/9fFgr/' +
  'dxwM/3wcDf9xGgz/YhYK/2AWCv9gFgr/bBkM/2UXC/9dFgr/VRQJ/2AWCv9zGgz/cBoM/3AaDP9xGgz/WhUJ/3ocDf95HA3/bxkM/2YYC/9WFAn/WBQJ/2YX' +
  'C/9tGgv/XxYK/0sSCP9nFwv/axkM/3QbDP9yGgz/bhkM/2kZC/9hFwr/YxcL/2wZDP9aFQr/ZBcL/10WCv9oGAv/YBYK/2QXC/9UFAn/XxYK/2oZC/9uGQz/' +
  'cxoM/3sdDf9xGwz/cBoM/2sZDP9sGQz/ahkL/20ZDP9dFgr/ZxgL/2AWCv9jFwv/XxYK/2QXCv9hFgr/aRgL/3cbDf93Gw3/bxoL/3EaDP9tGQz/aRkM/2MX' +
  'C/9hFgr/YBYK/2UXCv9sGQv/ahgL/08SCf9nGAv/WRUJ/14WCv9hFgr/YhYL/2wZDP9kFwr/ZBcL/2oYC/9cFQr/WhUK/2AWCv90Ggz/cBoM/20ZDP9qGQv/' +
  'YhcK/24aDP9fFgr/XhYK/2gYC/9oGAv/cBoM/2UXC/9eFgr/aBgL/1MTCf9lFwv/axkM/3YcDP9xGwz/axkM/3UbDf9bFQr/aRkL/2UXC/9eFgr/aBgL/2kY' +
  'C/9lFwv/ZxgL/2cYC/9hFgr/YxcK/2YXC/9sGQz/dRsM/3wcDf9uGQz/YhYL/2EXCv9tGQz/YhYK/14WCv9iFwr/ZxgL/20ZDP9jFwv/VxQJ/1QTCf9jFwr/' +
  'ZRcL/3UaDP93Gw3/bxoL/24ZDP9oGAv/YhYK/2sZC/9eFgr/YRYK/2QYCv9WFAn/UxMJ/2wZC/9dFgr/aRgL/2sZC/9nGAv/axgL/3cbDf9vGgv/ahkL/2cY' +
  'C/9eFgr/cRoM/2UXCv9YFQr/VRQJ/2UXC/9kFwr/ZhcL/2cYC/9hFgr/WBUJ/1wWCv9eFgr/ZxgL/2EXCv9bFQr/YBYK/1sVCv9hFgr/TBII/1sVCf9eFgr/' +
  'aBgL/3gcDf93HAz/axkL/20ZC/9hFwr/ZRcK/2kYC/9uGQv/cxsM/3AaDP9nGAv/WhUK/3MbDP9hFwr/URMJ/yEHBP8hCAT/IAgE/yEIBP8fBwT/HgcE/x0H' +
  'BP8cBgP/IAcE/yQIBP8gBwT/HQYD/x4HBP8fBwT/HwcE/xgFA/+5TzH/xVM0/8ZTNP/KVzb/zVk3/8tYNv/PWzj/y1c2/8dUNP/EVDP/0V45/81aN//NWTf/' +
  'zFk2/8pYNv/BVjX/wlc1/71RMv+ySy//tk4x/7tQMv/GVzX/zFk2/8lXNf/DVDT/yFY1/8xZN//GVzX/zls3/8xYNv/SXzn/vlM0/7NNMP/MWTb/wFEy/79Q' +
  'Mv/KVzb/t00w/8xZN//DUzP/zVo3/85aN//IVzX/vFAy/9NeOf/VYTv/zlo3/7tRMv+6UTL/wFIy/8pYNv/EVDT/vk8y/7JLL//BUTP/z1w4/85aN//OWjf/' +
  'zlo3/7ZOMP/UYDr/1GA6/81ZN/+/VDT/rEsv/7ZMMP/EVDT/y1k2/79RM/+pRiz/yFQ1/8pWNv/QXTn/z1s4/81YN//FVjX/vVEz/75SM//GWDb/sE0w/7tS' +
  'M/+7TzL/x1U1/79RMv/CUzP/sUov/8BQMv/JVjX/zFk2/89cOP/VYDr/z1s4/85aN//KVzb/ylg2/8FWNf/CWDb/ulAx/8hUNP/BUTL/w1Qz/7xRMv/DVDP/' +
  'wlAy/8hVNf/SXjn/0V45/81ZN//QWzf/y1g3/8hXNf+7UjP/uVAy/71RMv/FUzT/ylc2/8hXNv+qSC3/wlU0/7hNMP+8UDL/vlEy/79SM//GWDb/wVI0/8BS' +
  'M//IVzX/tk4w/7VMMP/AUjP/0Fw4/85aN//MVzb/x1c2/8FRM//JWDb/vVEy/79QMv/HVTX/xlU1/81bN//BVDT/vFAy/79WNP+uSS7/xVM0/8lXNv/SXjn/' +
  'z1s4/8pXNv/RXTj/uU4x/8dXNf/EVDT/v08y/8dVNf/IVTT/xFM0/8VVNf++VTT/u1Ay/8RSM//FVDT/y1g2/9BdOf/WYTv/zFg3/79SM/+/UjL/y1g2/8NS' +
  'M/+/UDL/w1Iz/8VUNP/IWDb/u1Iz/65KL/+wSi//xFIz/8VUNP/RXTj/0l45/81ZN//MWDf/x1Y1/8NTM//JWDb/vlEy/8JRMv/DVDT/s0wv/6pJLf/BVzX/' +
  'u08y/8hWNf/KVzb/x1U1/8lWNf/SXjn/zVo3/8lXNv/HVDT/vlAy/81bN//EVDP/t00w/7RLL/+9UzT/vVIz/8RUNP/BVTT/vVEz/7VNMP+4TzH/ulAy/8NV' +
  'Nf+9UjL/uE4x/7xRMv+2TjH/u1Iz/6dGLP+6TjH/t08x/79UNP/TXzn/0145/8pWNf/MVzb/wVEz/8VSM//IVjX/zFk3/9BcOP/NWzj/x1Q1/7pPMf/PXDf/' +
  'wFEz/6xJLv9OJxv/USgc/1AnHP9RKBz/Tycb/04lG/9OJRr/TSUa/1AnG/9SKRz/Tycb/00lGv9OJhr/TiYb/04mG/9HIxn/gQ0G/44cFP+JDwf/bBgS/24Z' +
  'Ev9oCwX/jRwU/5IdFP+CDQb/jhwU/4kPB/9nGBL/cRkT/40PB/+QHBT/kRwU/40cFP+UJx7/ixwU/3wkHf9/JB3/hRsU/5UnHv+YJx7/fxoT/5AmHv+PHBT/' +
  'hyUe/4klHv+THRX/kiYe/5EmHv+MEwv/jh8X/4ERCv90HBX/eh0V/4sSCv+SHxf/kx8X/2sPCf+GHhf/ihIL/44fFv+NHhb/jhML/4keFv+IHhb/kRkR/4sj' +
  'G/9yFg//myUc/44jG/9oFA7/kSQb/5gkG/+SGRH/lyQc/40YEP98Ihr/giIb/5MZEf+EIhv/gCIa/5EdFP+QJx7/fRoT/5MnHv+MJh3/dBkT/4slHf+PJh7/' +
  'jxwU/5YnHv+OHBP/eyQd/4AkHf+QHBT/gyUd/38kHf+MDwf/kx0V/4oPB/95GhP/ehoT/34NBv90GRP/cRkT/4MNBv+PHBT/ig8H/2gYEv9wGRL/hA4G/3IZ' +
  'Ev9sGBL/cxkT/4wmHv+PHBT/lSce/5ImHv+JGxT/kSYd/5ImHf+QHRT/iiYe/3MZEv+MJh7/jCYd/5EdFP9/JB3/eSQd/3AYE/+KJR3/jRwU/5cnHv+TJh3/' +
  'ihsU/5QmHv+WJx7/kB0U/4klHv9vGRL/jiYe/44mHf+THRT/gCQd/3skHf+MDwf/fhsT/1kJBP9yGRP/dRoT/34NBv+QHBT/kx0U/2gLBf+FHBT/ig8H/2gY' +
  'Ev9yGRP/jg8H/5MdFP+UHRT/kR0U/5AnHv9+GhP/jSYe/4glHf92GhP/hSUd/4clHf+FGxT/kycf/48cFP9+JR3/gCQd/4MbFP+SJh7/lSce/4wTC/+SIBf/' +
  'ihIL/5YgF/+IHhb/Xw0I/24bFf9vGxX/jRML/5IgF/+KEgv/ex0W/3gdFv9rDwn/hx4W/4weFv+RGRH/iyMb/3IWD/+bJRz/lyQb/5EZEP9/Ihr/eyEa/5AZ' +
  'EP+CIhr/YBMO/5slHP+XJBv/kRkQ/5ckG/+ZJBv/hBsT/4smHv99GhP/migf/5YnHv+PHBT/hyUd/4YlHf+BGxP/gyUd/28ZEv+XJx//lCce/5EcFP+QJh7/' +
  'jyYe/1oJBP+AGxT/ig8H/5YdFf+QHBT/hA0G/5EcFP+THRT/VAkE/3kaE/+ADQb/iRwU/4kcFP+ODwf/dxoT/3EZE/+KHBT/lCce/40cE/+SJh7/kCYe/5Ed' +
  'FP+XJx7/mCce/4ocFP+KJh3/dxoT/5gnH/+VJx7/kBwU/38kHf96JB3/kR0U/5YnHv+OHBP/kCce/5AmHv+THRT/lyce/5gnHv+SHRT/jCYe/3QZEv+aKB//' +
  'lyce/5EcFP9/JB3/eSQd/7cvIv++QjX/vDIj/588Mf+gPDL/oCsg/7xCNP/BQzX/uC8i/71CNf+8MiP/mjsx/6I8Mv/AMiP/v0I1/8BCNf+9QTT/wE9C/7tB' +
  'NP+rS0D/rUtA/7ZANP/BT0L/w09D/7A/M/+8TkL/vkI0/7RNQf+2TUH/wUM1/75OQf++TkL/vjYo/71FOP+1Myf/pkE1/6pBNv+9Nij/wEY4/8FGOP+iMCX/' +
  'tkQ3/7w2J/++RTn/vEQ4/8A2KP+4RDf/uEQ3/8E+MP+5Sj7/pjgt/8dNP/+7Sz7/nDcs/75LPv/ETD//wz8w/8NMP/+9PTD/rEg8/7BIPf/DPzD/s0k9/69I' +
  'Pf/AQjX/vE5C/68+M//AT0L/uE1B/6Y9Mv+4TUH/u05C/79CNf/BT0P/vUE0/6pLQP+uS0D/v0I1/7FMQf+tS0D/vzIj/8FDNf++MiP/qz4z/6w+M/+0LyL/' +
  'pj0y/6M9Mf+5LyL/vkI1/74yI/+bOzH/ojwy/7owI/+kPTL/njwx/6U9Mf+5TUH/vkI0/8FPQ/++TkL/ukE0/71OQv++TkL/wEI1/7dNQf+lPTH/uU5C/7lN' +
  'Qf/AQjX/rEtA/6dKP/+iPDH/tk1B/7xBNP/CT0P/v05C/7tBNP/AT0L/wU9C/8BDNf+2TUH/ojwx/7tOQv+7TkL/wUM1/65LQP+pSkD/vzIj/64/M/+RKR7/' +
  'pT0x/6c+Mv+0LyL/v0I1/8JDNf+hKyD/tkE0/74yI/+bOzH/oz0y/8EyI//BQzX/w0M1/8BCNf+8TkL/rz8z/7pOQv+1TUH/qT4y/7JNQf+0TUH/tkA0/79P' +
  'Qv++QjT/rEtA/65LQP+0QDT/v05C/8FPQv++Nij/wEY4/7w2J//ERjn/t0Q3/5YuI/+fPzX/oEA1/782KP/ARjj/vDYn/6xCNv+qQTb/ojAl/7hDN/+8RDj/' +
  'wT4w/7lKPv+mOC3/x00//8NMP//BPjD/rkg8/6pHPP/APjD/sEg9/5Q1K//HTT//w0w//8E+MP/DTD//xU0//7RAM/+4TUH/rz4z/8ZQQ//CT0L/vkI1/7VN' +
  'Qf+zTED/sUAz/7BMQP+hPDH/w09D/8BPQv/AQjX/vE5B/7tOQf+SKR7/sEAz/74yI//FQzX/wEI1/7ovIv/AQjX/wUM1/40oHv+rPjL/ti8i/7pBNP+5QTT/' +
  'wTIj/6k+Mv+jPTH/uUE0/79PQv+8QTT/vk9C/71OQv/AQjX/wk9C/8NPQv+5QTT/t01B/6o9Mv/EUEP/wU9C/79CNf+tS0D/p0o//8BCNf/CT0P/vEE0/71P' +
  'Qv+8TkL/wUM1/8NPQv/DUEL/wUM1/7lNQf+nPTL/xVBD/8JPQv+/QjX/rEtA/6dKQP/YdAD/3IAL/+J6AP+qZQz/qmUM/65eAP/Zfwv/4YMM/9l0AP/bgAv/' +
  '4noA/6FgDP+vaAz/6H4A/96BC//gggz/2n8L/9mGFP/WfQv/tnIU/7p1FP/OeAz/24cU/96JFP/Dcwz/04IU/92BC//FexT/yX0U/+KDDP/WhBT/1YQU/+F9' +
  'A//YgA3/0nQD/7FrDv+6bw7/4nwD/96DDf/fhA7/sGED/8x5Df/fewP/2YAO/9d/Dv/lfgP/0HwN/897Dv/jggj/zn0S/7RnCP/lixL/04ES/6dhCf/XgxL/' +
  '4ogS/+WDCf/fhxL/334I/7dyEv/AdhL/5oMJ/8R4Ev+9dRL/34IL/9KCFP/BcQv/2IUU/8x/FP+0awz/y38U/9GCFP/dgQz/24cU/9t/C/+0chT/vHYU/96B' +
  'DP/AeBT/uXQU/+Z9AP/hgwv/43sA/7ptDP+8bwz/0XEA/7NqC/+vZwz/2nUA/9yAC//jewD/o2EM/65nDP/bdgD/sWkL/6llDP+yagv/zX8U/9yBC//bhxT/' +
  '1oQU/9V8C//VgxP/1oQU/96CC//KfhT/smoL/81/FP/NgBT/34IL/7l1E/+xcBT/rWcL/8l9FP/Zfwv/3YgU/9iEFP/WfQz/2oYU/92HFP/eggz/yH0U/61m' +
  'C//RgRT/0YEU/+GDDP+8dhT/tHIU/+Z9AP/Ccgv/m1MA/7FpDP+2bAz/0XEA/96BC//jhAz/sF4A/814C//jewD/o2EM/7FoDP/pfgD/4YML/+SFDP/fggv/' +
  '0oIU/8NzC//PgRT/x3wU/7htDP/DehT/xXsU/854DP/WhBT/3YEL/7dzFP+6dRT/ynYM/9aEFP/ahhT/4X0D/96DDf/fewP/5IYO/897Dv+fWQP/qGYN/6pn' +
  'Dv/jfgP/3oMN/997A/+7cA7/t24O/7BhA//Pew3/1n8O/+OCCP/OfRL/tGcI/+WLEv/giBL/5IEJ/7x0Ev+2cRL/44AJ/8F3Ev+bWgj/5YsS/+CIEv/kgQn/' +
  '4IgS/+KJEv/MeAv/y34U/8FxC//iixT/3IgU/9yADP/GexT/w3oU/8h1DP/AeBT/rWcL/92IFP/ZhhT/4IIM/9KCFP/RghT/m1QA/8Z0C//jewD/54YM/96B' +
  'DP/bdgD/34IL/+KEDP+TTwD/u28L/9ZzAP/UfAz/03wM/+l+AP+4bQv/r2cM/9V9C//ZhRT/238L/9WEFP/UgxT/34IL/92IE//eiRT/1X0L/8p+FP+5bQv/' +
  '34kU/9uHFP/ggQv/uXUT/7FwFP/fggv/3YgU/9t/C//TgxT/04IU/+KEDP/eiRT/34kU/+GDDP/NfxT/tGoL/+KLFP/diBT/4IEM/7p1FP+xcBT/76oN/+6y' +
  'IP/zrw3/0pkg/9KZIP/Zlg3/7LAg//G0IP/wqw3/7rIg//OvDf/LlCD/05sg//eyDf/wtCD/8rUg/+2xIP/rtS7/668f/9ekLv/Zpi7/6Kwg/+y2Lv/tuC7/' +
  '4qYg/+iyLv/ush//4Ksu/+GtLv/xtSD/6bQu/+m0Lv/ysBL/7LIj/+upEv/XnyP/26Mj//SyEv/utCP/77Uj/9mYEv/lqyP/8K8S/+6zI//rsSP/9LIS/+et' +
  'I//nrSP/8rQa/+avKv/anRr/87oq/+exKv/Rlhv/6bMq//C4Kv/0tRv/77gq//GzGv/apCr/3qgq//S1G//hqir/3acq/++zH//nsi7/36Qf/+u1Lv/jry3/' +
  '2J4g/+KuLf/msS7/77Mg/+y3Lv/tsh//1aMu/9qmLf/vsyD/3agt/9ilLv/1sQ3/8bUg//OvDf/eoiD/3qMg/+ynDf/ZniD/1pwg//GrDf/vsiD/868N/82V' +
  'IP/TmyD/8qwN/9acIP/RmCD/154f/+SvLf/tsh//7bgu/+q0Lf/rryD/6bQt/+m0Lv/wsyD/464t/9edH//kry7/5K8t//C0IP/YpS3/06At/9SbH//hri7/' +
  '67Af/+64Lv/qtS3/7K8g/+y3Lf/tuC7/77Mg/+GtLv/Umx//57Iu/+axLf/xtSD/2qYt/9WiLv/1sQ3/36Ug/8uLDf/YniD/2qAg/+ynDf/vsyD/8bUg/9qX' +
  'Df/mqyD/868N/82VIP/UnCD/97IN//G1IP/ytiD/77Mf/+ayLv/fpR//5bEu/+CsLf/boCD/3aku/9+rLv/nqyD/6bQu/+2yH//YpC7/2aYt/+WpIP/ptC3/' +
  '67Yu//KwEv/utCP/8K8S//K3I//lrSP/zo8S/8+YI//RmiP/87ES/+60I//wrxL/3aMj/9qhI//ZmRL/560j/+uxI//ytBr/5q8q/9qdGv/zuir/77gq//S1' +
  'G//cpir/2KMq//S1G//dqCr/yI4a//O6Kv/vuCr/9LUb/++4Kv/wuCr/5Kkf/+KuLv/fpB//8Lou/+y3Lf/vsyD/4Kwt/96qLv/jqCD/26gu/9KaH//uuC7/' +
  '67Yt//G1IP/nsi3/5rEu/8yLDf/hpiD/868N//W4IP/vsyD/8qwN//C0IP/xtSD/xocN/9uhIP/uqQ3/7K8g/+uuIP/3sg3/26Eg/9acIP/prh//6rUt/+2y' +
  'H//qtC7/6LMt//C0IP/tty3/7bgu/+muIP/iri3/26Af/++5Lv/sti3/8bUg/9ilLf/ToS3/77Mf/+23Lv/tsh//6LMu/+eyLv/xtSD/7bgu/+24Lv/wtCD/' +
  '5K8u/9ieH//wui7/7Lcu//G1IP/YpS7/06Eu/5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg' +
  '//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//' +
  'luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg' +
  '//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//' +
  'luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg' +
  '//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//' +
  'luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg' +
  '//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//' +
  'luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg' +
  '//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//' +
  'luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg' +
  '//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//8cZpz/HGWa/x5tp/8ebKb/H2+q/x5spv8cZpz/' +
  'HG+m/xxvpv8cZZr/Hm2n/x5spv8fb6r/Hmym/xxmnP8cZpz/I4HE/yByrv8ifLz/Iny8/yN/wP8jfr//Iny8/yKHx/8jgcT/IHKu/yJ8vP8ifLz/I3/A/yN+' +
  'v/8ifLz/Iny9/yJ7u/8heLb/IXq5/yJ9vv8ifb7/H2+q/x5tp/8fhcH/Inu7/yF4tv8hern/In2+/yJ9vv8fb6r/Hm2n/x9xq/8iern/Inu7/ySEyP8ifLz/' +
  'I36+/x9wq/8gdLH/HoXA/yJ6uf8ie7v/JITI/yJ8vP8jfr7/H3Cr/yB0sf8ebaX/IXm4/yJ7u/8khMj/JITI/ySDx/8ie7r/I3/D/x9+uP8hebj/Inu7/ySE' +
  'yP8khMj/JIPH/yJ7uv8jf8P/H26o/yF4t/8gdLD/Inu7/yJ7u/8ie7v/Inu7/yaL1P8hf77/IYXG/yB0sP8ie7v/Inu7/yJ7u/8ie7v/JovU/yF5uP8ierr/' +
  'IHaz/yB1sv8hebj/I4DD/yJ9v/8lidL/IYG+/yKGx/8gdrT/IHWy/yF5uP8jgMP/In2//yWJ0v8heLf/I4HE/yOAw/8jgcT/Iny9/ySDyP8ifL3/I3/B/yJ+' +
  'v/8jgcT/I4DD/yOBxP8ifL3/JIPI/yJ8vf8jf8H/In6//yJ7uv8gc6//I4HE/yOAw/8kg8b/IXi3/yF6uP8ig8T/IoTE/yBzr/8jgcT/I4DD/ySDxv8heLf/' +
  'IXm4/yJ7uv8jgcT/IHKu/yJ8vP8ifLz/I3/A/yN+v/8ifLz/IofH/yOBxP8gcq7/Iny8/yJ8vP8jf8D/I36//yJ8vP8ifL3/Inu7/yF4tv8hern/In2+/yJ9' +
  'vv8fb6r/Hm2n/x+Fwf8ie7v/IXi2/yF6uf8ifb7/In2+/x9vqv8ebaf/H3Gr/yJ6uf8ie7v/JITI/yJ8vP8jfr7/H3Cr/yB0sf8ehcD/Inq5/yJ7u/8khMj/' +
  'Iny8/yN+vv8fcKv/IHSx/x5tpf8hebj/Inu7/ySEyP8khMj/JIPH/yJ7uv8jf8P/H364/yF5uP8ie7v/JITI/ySEyP8kg8f/Inu6/yN/w/8fbqj/IXi3/yB0' +
  'sP8ie7v/Inu7/yJ7u/8ie7v/JovU/yF/vv8hhcb/IHSw/yJ7u/8ie7v/Inu7/yJ7u/8mi9T/IXm4/x6FyP8df8H/HX6+/x2CxP8ehcn/HoTI/yCM0/8dgMD/' +
  'HoXI/xyAwf8dfr7/HYLE/x6Fyv8ehMj/IIzT/x2Awf8YaaP/GWmj/xlpo/8YaaP/GWmj/xlpo/8YaaP/GWmj/xhpo/8YaaP/GWmj/xlpo/8ZaaP/GWmj/xlp' +
  'o/8ZaaP/0Mm3/6GdkP+inY//paGW/6Wfj/+hm4z/oZuM/6GbjP+hm4z/oZuM/6GbjP+ln4//pKGW/6KdkP+inZD/0Mm3/6GckP+HgnP/iIR4/2VjXv+aj3j/' +
  'ioR3/4F9c/+BfXP/gX1z/4B9c/+Ig3b/mY53/2ZkXv+IhHj/h4Jz/6CckP+noZL/sKmV/9DIsP/SybP/3ta+/9/Xv//e1r//3dW9/93Uvf/d1bz/3NS8/9vT' +
  'u//Pxq7/zMSs/6+olP+nopL/p6KT/7Ssmf/e1r7/5t7H/+ffyP/n38j/59/I/+ffyP/n38j/59/I/+ffyP/m3sf/4trC/9TLsv+xqpb/p6KT/6iik/+1rpv/' +
  '4trC/+ffyP/n38j/59/I/+ffyP/n38j/59/I/+ffyP/n38j/59/I/+PbxP/WzbT/squY/6ijk/+kn5D/mZWH/+PbxP/n38j/59/I/+ffyP/n38j/59/I/+ff' +
  'yP/n38j/59/I/+ffyP/j28T/1s61/5aRg/+kn4//pZ+Q/4mFfP/k3MX/59/I/+ffyf/n38n/59/J/+ffyf/n38n/59/J/+ffyf/n38n/5NzE/9fOtv+EgHf/' +
  'pZ+Q/6WfkP+Jhnz/5d3F/+ffyP/n38n/59/J/+ffyf/n38n/59/J/+ffyf/n38n/59/J/+Tcxf/Yz7b/hYF3/6WfkP+ln5D/iYZ8/+Xdxv/n38j/59/J/+ff' +
  'yf/n38n/59/J/+ffyf/n38n/59/J/+ffyf/l3cX/2dC4/4SBd/+ln5D/pZ+Q/4mGff/l3cb/59/I/+ffyf/n38n/59/J/+ffyf/n38n/59/J/+ffyf/n38n/' +
  '5d3G/9rSuf+FgXf/pZ+Q/6SfkP+blon/5NzF/+ffyP/n38j/59/I/+ffyP/n38j/59/I/+ffyP/n38j/59/I/+Xdxv/b0rr/l5KE/6SfkP+oopP/t7Gd/+Tc' +
  'xf/n38j/59/I/+ffyP/n38j/59/I/+ffyP/n38j/59/I/+ffyP/m3sf/29O7/7Osmf+oo5P/p6KT/7avm//i2sP/5t/H/+ffyP/n38j/59/I/+ffyP/n38j/' +
  '59/I/+ffyP/n38j/5d7G/9vTu/+yq5f/p6KT/6ehkv+xqpb/1cy1/9PLtf/f1r//39a//9/Xv//f1r7/39e//+DYwP/g2MD/4djA/9PMtf/RyLD/r6mU/6ei' +
  'kv+hnZD/hoFy/4qFeP9nZV7/mI13/4mEdv+CfnT/gn50/4J+dP+CfnT/iYR3/5mOeP9oZV//iYV5/4eCdP+gnJD/0Mm3/6GdkP+inZD/pKCW/6Sfj/+gm4v/' +
  'oJuL/6Gbi/+gm4v/oJuL/6Cbi/+kn47/o6CV/6Kdj/+hnY//0Mm3/1RWV/9ud3n/b3h6/294ev9veHr/b3h6/253ef9ud3n/bnd5/253ef9veHr/b3h6/294' +
  'ev9vd3r/bnd5/1RXV/9bYGD/go+T/4KPk/+Dj5P/go+T/4OPk/+Cj5P/go6S/4KOkv+Cj5P/g4+T/4KQk/+Dj5P/go+T/4KPk/9bYGD/UlFR/9KhC//fqgn/' +
  '36oK/96pCv/fqgn/36oJ/96pCf/eqgn/36oJ/9+qCf/eqgr/36oK/9+qCf/ToQv/UlFR/1ZVVf/qsQT/+LsB//i7Af/3ugH/+LsB//i7Af/4uwH/+LsB//i7' +
  'Af/4uwH/97oB//i7Af/4uwH/6rEE/1ZVVf9XVlb/4aYE/++vAf/vsAH/77EB//K3Af/ytgH/8rYB//K2Af/ytgH/8rYB//G1Af/ytwH/8rYB/+StBP9XVlb/' +
  'VVVU/9+XBP/snwH/7J8B//CrAf/4uwH/+LsB//i7Af/4uwH/+LsB//i7Af/3ugH/+LsB//i7Af/qsQT/VVVU/1RTU//flwT/7J8B/+yfAf/wqwH/+LsB//i7' +
  'Af/4uwH/+LsB//i7Af/4uwH/97oB//i7Af/4uwH/6rEE/1RTU/9UVFP/3pcE/+yfAf/snwH/8KoB//i7Af/4uwH/97oB//e6Af/4uwH/+LsB//a5Af/3ugH/' +
  '97oB/+mwBP9UVFP/VFRT/+mwBP/4uwH/+LsB//a6Af/4uwH/+LsB//e6Af/3ugH/+LsB//i7Af/wqwH/7J8B/+yfAf/elgT/VFRT/1RUU//qsQT/+LsB//i7' +
  'Af/3ugH/+LsB//i7Af/4uwH/+LsB//i7Af/4uwH/8KsB/+yfAf/snwH/35cE/1RTU/9VVVT/6rEE//i7Af/4uwH/97oB//i7Af/4uwH/+LsB//i7Af/4uwH/' +
  '+LsB//CrAf/snwH/7J8B/9+XBP9VVVT/V1ZW/+GlBP/vrgH/768B/++xAf/ytgH/8rYB//K2Af/ytgH/8rcB//K3Af/vsgH/77AB/++wAf/hpgT/V1ZW/1ZV' +
  'Vf/qsQT/+LsB//i7Af/3ugH/+LsB//i7Af/4uwH/+LsB//i7Af/4uwH/97oB//i7Af/4uwH/6rEE/1ZVVf9SUVH/06EL/9+qCf/fqwr/3qoK/9+qCf/fqgn/' +
  '3qoJ/96qCf/fqgn/36oJ/96qCv/fqwr/36oJ/9OhC/9SUVH/W2Bg/4KPk/+Cj5P/g4+T/4KPk/+Dj5P/go+T/4KOkv+CjpL/go+T/4OPk/+Cj5P/g4+T/4KP' +
  'k/+Cj5P/W2Bg/1RXV/9ud3n/b3d6/294ev9veHr/b3h6/253ef9ud3n/bnd5/253ef9veHr/b3h6/294ev9veHr/bnd5/1RWV/9NTUz/Li4u/y8vL/8vLy//' +
  'MTEx/y0tLf8xMTH/MDAw/zAwMP8xMTH/MDAw/zAwMP8wMDD/MDAw/y8vL/9NTUz/T09O/zk5Of87Ozv/OTk5/zs7O/85OTn/Ozs7/zo6Ov86Ojr/Ozs7/zk5' +
  'Of86Ojr/Ojo6/zs7O/86Ojr/T09O/05OTf8+Pj7/Pz8//z8/P/8/Pz//Pz8//z8/P/8/Pz//Pz8//0BAQP9AQED/Pz8//z8/P/8+Pj7/Pz8//05NTf9PTk7/' +
  'Ojo6/zs7O/85OTn/Ozs7/zk5Of87Ozv/Ojo6/zo6Ov87Ozv/Ojo6/zs7O/85OTn/Ojo6/zo6Ov9PTk7/UFBP/zo6Ov88PDz/OTk5/zs7O/85OTn/Ozs7/zo6' +
  'Ov86Ojr/Ozs7/zo6Ov87Ozv/OTk5/zs7O/86Ojr/UE9P/05OTv86Ojr/Ozs7/zk5Of87Ozv/OTk5/zw8PP86Ojr/Ojo6/zs7O/86Ojr/Ozs7/zk5Of87Ozv/' +
  'Ojo6/05NTf9NTEz/OTk5/zs7O/85OTn/Ojo6/zk5Of87Ozv/Ojo6/zo6Ov87Ozv/OTk5/zs7O/86Ojr/Ozs7/zs7O/9NTEz/TUxM/zo6Ov87Ozv/OTk5/zs7' +
  'O/85OTn/Ozs7/zo6Ov86Ojr/Ozs7/zk5Of87Ozv/OTk5/zs7O/87Ozv/TUxM/01MTP86Ojr/Ozs7/zk5Of87Ozv/OTk5/zs7O/86Ojr/Ojo6/zs7O/85OTn/' +
  'Ozs7/zo6Ov87Ozv/Ojo6/0xMTP9NTEz/OTk5/zs7O/85OTn/PDw8/zk5Of87Ozv/Ojo6/zo6Ov87Ozv/Ojo6/zs7O/85OTn/Ozs7/zs7O/9NTEz/Tk5N/zk5' +
  'Of87Ozv/Ojo6/zs7O/85OTn/Ozs7/zo6Ov86Ojr/Ozs7/zo6Ov87Ozv/ODg4/zs7O/87Ozv/Tk1N/0xMS/85OTn/Ozs7/zk5Of87Ozv/OTk5/zs7O/86Ojr/' +
  'OTk5/zs7O/85OTn/Ojo6/zk5Of86Ojr/Ozs7/0xLS/9HRkb/OTk5/zs7O/86Ojr/Ozs7/zk5Of87Ozv/Ojo6/zo6Ov87Ozv/OTk5/zs7O/85OTn/Ojo6/zo6' +
  'Ov9GRkX/S0tK/zk5Of87Ozv/Ojo6/zs7O/86Ojr/Ozs7/zo6Ov86Ojr/Ozs7/zk5Of87Ozv/OTk5/zo6Ov86Ojr/S0tK/09PTv87Ozv/PDw8/zs7O/88PDz/' +
  'Ojo6/zw8PP87Ozv/PDw8/zw8PP87Ozv/PDw8/zo6Ov88PDz/Ozs7/09PTv9NTUz/PDs6/zw7O/89PTz/PDs7/z08PP87Ozr/Ozo6/zs7Ov88Ozv/PTw8/zw7' +
  'O/88PDz/PDs7/zw7O/9NTUz/SUlI/1hYWP9SU1P/UFBQ/1BQUf9RUVH/UFBR/0lKSv9JSkr/SkpK/0lJSf9KSkr/SUlJ/0pKSv9NTk7/RkZG/0xMTP9bW1v/' +
  'Tk5O/05OTv9OTk7/Tk5O/05NTf9OTk7/Tk5O/09PT/9OTk7/Tk5O/05OTv9OTk7/Wlpa/0tLS/9MTEz/T09P/09PT/9PT0//UFBQ/1BQUP9PT0//UFBQ/09P' +
  'T/9RUFH/UFBQ/1BQUP9PT1D/UFBQ/1BQUP9LS0v/S0tL/09PT/9PT0//Tk5O/09PT/9PT0//Tk5O/09PT/9OTk7/UE9P/09PT/9OTk7/Tk5O/09PT/9PT0//' +
  'SkpK/0xMTP9QUFD/UFBQ/09PT/9PT0//T09P/09PT/9QUFD/T09P/1BQUP9QUFD/T09P/09PT/9QUFD/T09P/0tLS/9KSkr/T09P/09PT/9OTk7/Tk5O/05O' +
  'Tv9NTk7/Tk9P/05OTv9PT0//Tk5O/05OTv9OTk7/T09P/05OTv9KSkr/S0tL/09PT/9PT0//T09P/09PT/9PT0//Tk5P/09PT/9PT0//UFBQ/09PT/9PT0//' +
  'T09P/09PT/9PT0//S0tL/0xMTP9OTk7/Tk5O/09PT/9PT0//T09P/09PT/9PT0//Tk5O/09PT/9PT0//T09P/09PT/9PT0//T09P/0tLS/9LS0v/UFBQ/1BQ' +
  'UP9OTk7/Tk5O/05OTv9OTk7/T09P/09PT/9QUFD/Tk5O/05OTv9OTk7/UFBQ/09PT/9KSkr/TExM/09PT/9PT0//T09P/09PT/9PT0//T09P/09PT/9OTk7/' +
  'UFBQ/1BQUP9PT0//T09P/09PT/9PT0//S0tL/0tLS/9PT0//T09P/05OTv9OTk7/T09P/05OTv9PT0//Tk5O/09PT/9OTk7/Tk5O/05OTv9OTk7/Tk5O/0pK' +
  'Sv9LS0v/T09P/09PT/9OTk7/Tk5O/05OTv9OTk7/T09P/09PT/9QUFD/T09P/05OTv9OT07/T09P/09PT/9KSkr/TExM/1BQUP9PT0//T09P/09PT/9PT0//' +
  'T09P/09PT/9PT0//UFBQ/09PT/9PT0//T09P/09PT/9PT0//S0tL/0tLS/9PT0//T09P/05OTv9OTk7/T09P/05OTv9PT0//Tk5O/09PT/9OTk7/Tk5O/05O' +
  'Tv9OTk7/Tk5O/0pKSv9NTU3/XFxc/09PT/9PT0//T09P/09PT/9PT0//T09P/09PT/9QUFD/T09P/09PT/9PT0//T09P/1tbW/9MTEz/SEhH/09PT/9LS0v/' +
  'S0tL/0tLS/9LS0v/S0tL/0tLS/9KSkr/TExM/0tLS/9LS0v/S0tL/0tLS/9PT0//SEhI/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/' +
  'RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZG' +
  'Rv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/' +
  'RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZG' +
  'Rv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/' +
  'RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZG' +
  'Rv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/' +
  'RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZG' +
  'Rv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/' +
  'RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZG' +
  'Rv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/' +
  'RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YA' +
  'AP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/' +
  '1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YA' +
  'AP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/' +
  '1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YA' +
  'AP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/' +
  '1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YA' +
  'AP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/' +
  '1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YA' +
  'AP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/' +
  '1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YA' +
  'AP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/' +
  '1gAA/9YAAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZ' +
  'AP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/' +
  'ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZ' +
  'AP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/' +
  'ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZ' +
  'AP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/' +
  'ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZ' +
  'AP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/' +
  'ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZ' +
  'AP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/' +
  'ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZ' +
  'AP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/' +
  'AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA' +
  '8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/' +
  'AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA' +
  '8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/' +
  'AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA' +
  '8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/' +
  'AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA' +
  '8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/' +
  'AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA' +
  '8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/' +
  'AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/9LV8//S1fP/0tXz/9LV' +
  '8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/' +
  '0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV' +
  '8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/' +
  '0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV' +
  '8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/' +
  '0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV' +
  '8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/' +
  '0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV' +
  '8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/' +
  '0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV' +
  '8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/' +
  '0tXz/9LV8//S1fP/0tXz/9LV8/8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQ' +
  'AAAATQAAAK0AAAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAArAAAA+AAAAP8AAAD/AAAAWQAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABcAAAC8AAAA9wAAAP8AAAD/AAAA/wAAAJgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHwAAADt' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAACgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACwAAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAAoAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAsAAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAALAAAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAACgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACwAAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAAoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAsAAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAKAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAALAAAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAACgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACwAAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAAoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVwAAAIAAAACAWTEA91gyAO8AAACAAAAAgAAAAE8AAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALFjAO+xYwDgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAACxYwDvsWMA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAsWMA77FjAOAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALFkAKiyZQCZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADoAAAA2QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAA7wAAAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAO8AAADgAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADvAAAA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAA7wAAAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAO8AAADgAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADvAAAA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA7wAAAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AO8AAADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADvAAAA4AAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA7wAAAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAO8AAADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADvAAAA4AAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA7wAAAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAO8AAADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADZ' +
  'AAAAywAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA6AAAANkAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAO8AAADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAADvAAAA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA7wAAAOAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAO8AAADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAADvAAAA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA7wAA' +
  'AOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAO8AAADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADvAAAA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAA7wAAAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAO8AAADgAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfvAAAH4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAA7wAAAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAO8AAADg' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADvAAAA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA2QAAAMsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAADkAOgA5ADZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA5ADvAOQA4AAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOQA7wDkAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAADkAO8A5ADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA5ADvAOQA4AAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOQA7wDkAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADkAO8A5ADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAA5ADvAOQA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOQA7wDkAOAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADkAO8A5ADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAA5ADvAOQA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAL8A7wC/AOAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADkAO8A5ADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA5ADvAOQA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AOQA7wDkAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADkANkA5ADLAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AADo/wAA2QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAA/wAA7/8AAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8AAO//AADgAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AADv/wAA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/wAA7/8AAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8A' +
  'AO//AADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AADv/wAA4AAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/wAA7/8AAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAP8AAO//AADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AADv/wAA4AAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/wAA7/8AAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAANQAAO/UAADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AADv' +
  '/wAA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/wAA7/8AAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8AAO//AADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAD/AADZ/wAAywAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+QA6P/kANkAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/kAO//5ADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAD/5ADv/+QA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+QA7//k' +
  'AOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/kAO//5ADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/5ADv/+QA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAA/+QA7//kAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/kAO//5ADgAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/5ADv/+QA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAA/+QA7//kAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/kAO//5ADg' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADUvwfv1L8H4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+QA7//kAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAP/kAO//5ADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/5ADv/+QA4AAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+QA2f/kAMsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAC/ZgRm/4YE2v+GBP//hgT+/4YF1r9lBVsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAQwNB/4YE//+GBP//hgT//4YE//+G' +
  'BP//hgT9gEQCMwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgFIEZf+lB///pQf//6UH//+lB///pQf//6UH/4BSBFUAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAEAtAg3/sgj5/7II//+yCP//sgj//7II//+yCPBALQMGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC/iQpF/7II9f+y' +
  'CP//sgj//7II//+yCP//sgjvv4oUOwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC/ZQVx/4sG/f+MB///jAf//4wH//+MB///jAf//4wH//+LBvu/ZgZj' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAACARgYh/4YG/v+GBv//hgb//4YG//+GBv//hgb//4YG//+GBv//hgb//4YG+4BKChQAAAAAAAAAAAAAAAAAAAAAgEMDN/+G' +
  'Bv//hgb//4YG//+GBv//hgb//4YG//+GBv//hgb//4YG//+GBv+ARAQnAAAAAAAAAAAAAAAAAAAAAEAYCAL/SALI/0gC//9IAv//SAL//0gC//9IAv//SAL/' +
  '/0gC//9IAv//SQO6AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgCQBQv9IAv//SAL//0gC//9IAv//SAL//0gC//9IAv//SAL/gCUCMgAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAQBAQAbovBpP7Qwb/+0MG//tDBv/7Qwb/+0MG//tDBv/7Qwb/+0MG/7ovB4QAAAAAAAAAAAAAAAAAAAAAAAAAAK4hD4fpLBP/6SwT/+ksE//pLBP/' +
  '6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/ryEPdwAAAAAAAAAAAAAAAHsbFQ/pLBP66SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ks' +
  'E/M6DQgGAAAAAAAAAAByGA0Q4ywT/eMsE//jLBP/4ywT/+MsE//jLBP/4ywT/+MsE//jLBP/4ywT/+MsE//jKxP5PAwIBAAAAAAAAAAAAAAAAN0qE5DZKhL/' +
  '2SoS/9kqEv/ZKhL/2SoS/9kqEv/ZKhL/2SoS/9kqEv/ZKhL/4i8egAAAAAAAAAAAAAAAAAAAAAAAAAAAbRUJUdorEqnZKhLW2SoS6tkqEu/ZKhLv2SoS6dkq' +
  'EtTZKxSlbBUKSQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcQAE7HUsBYgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAUOwBLPFcNuVA8GjcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFNA' +
  'GzBTPxwgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADtaASNzrQOgdasCyHmqA9KBnAnHg6EJsHykA7p6rALydawCxlaABVkgMAAB' +
  'AAAAAAAAAAAAAAAAAAAAAF6pCopfogL8X6EC/1+hAv9gogL/YqQC/2SlAv9jpQL/YaQC/2CiAv9fowL/ZqgCkwAAAAAAAAAAAAAAAClNAjhRmwL+UZsC/1Gc' +
  'Av9RmwL/UZwC/1OdAv9TnAL/UpwC/1KdAv9RnQL/UZ0C/1GbAvwoTwMsAAAAAAAAAAA2cQSAR5YC/0eXAv9HlQL/R5cC/0eWAv9HlgL/R5YC/0eWAv9HlwL/' +
  'R5cC/0eWAv9HlgL/I0sBcAAAAAAAAAAAQJQCqD+TAv8/kwL/P5IC/z+UAv8/lAL/P5MC/z+TAv8/kwL/P5MC/z+UAv8/lAL/P5MC/z+UBJgAAAAAAAAAADmQ' +
  'A6I5kQL/OY8C/zmPAv85jwL/OZAC/zmQAv85kgL/OZEC/zmRAv85kAL/OZAC/zmQAv84kAOSAAAAAAAAAAA3jwGKNI0C/zSOAv80jAL/NI0C/zSOAv80jAL/' +
  'NI4C/zSMAv80jgL/NI4C/zSPAv80jgL/KnYBegAAAAAAAAAAGUUBTDGLAv8xiwL/MYwC/zGLAv8xjAL/MYwC/zGMAv8xiwL/MYwC/zGLAv8xiwL/MYsC/xlH' +
  'ATwAAAAAAAAAAA0jAgowiwLmMIwC/zCLAv8wiwL/MIsC/zCNAv8wiwL/MIwC/zCMAv8wjAL/MIsC/zCLAtwMJAQEAAAAAAAAAAAAAAAAJ2kDaDONAv8zjQL/' +
  'M4wC/zOMAv8zjQL/M40C/zOMAv8zjQL/M40C/zONAv8maQFYAAAAAAAAAAAAAAAAAAAAAAAAAAA7kQKmO5AC/zuQAv87kAL/O5EC/zuQAv87kAL/O5AC/zuR' +
  'Av86mwGWAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEiUCCkmXA75KmAL/SpgC/0qXAv9KlwL/SpgC/0qZAv9ImASyEyUDBgAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAWKAIKYqQCl2OkAuhkpALvZKUC72OkAuVdoAKPFSgDBgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAL9mBGb/hgTa/4YE//+G' +
  'BP7/hgXWv2UFWwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIBDAkD/hgT//4YE//+GBP//hgT//4YE//+GBP2ARAIyAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAACAUQNl/6IH//+iB///ogf//6IH//+iB///ogf/gFEDVQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQC0DDP+y' +
  'CPn/sgj//7II//+yCP//sgj//7II70AtAwYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAL+JCkT/sgj1/7II//+yCP//sgj//7II//+yCO+/ihQ6' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAL9lBXH/iwb9/4wH//+MB///jAf//4wH//+MB///jAf//4sG+79mBmMAAAAAAAAAAAAAAAAAAAAAAAAAAIBG' +
  'BiD/hgb+/4YG//+GBv//hgb//4YG//+GBv//hgb//4YG//+GBv//hgb7gEoLEwAAAAAAAAAAAAAAAAAAAACAQwM2/4YG//+GBv//hgb//4YG//+GBv//hgb/' +
  '/4YG//+GBv//hgb//4YG/4BEBCYAAAAAAAAAAAAAAAAAAAAAQBgIAv9IAsj/SAL//0gC//9IAv//SAL//0gC//9IAv//SAL//0gC//9JA7oAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAACAJAFC/0gC//9IAv//SAL//0gC//9IAv//SAL//0gC//9IAv+AJQIyAAAAAAAAAAAAAAAAAAAAAAAAAABAEBABui8Gk/tDBv/7Qwb/' +
  '+0MG//tDBv/7Qwb/+0MG//tDBv/7Qwb/ui8HhAAAAAAAAAAAAAAAAAAAAAAAAAAAriEPh+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ks' +
  'E/+vIQ93AAAAAAAAAAAAAAAAexsVD+ksE/rpLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT/+ksE//pLBP/6SwT8zoNCAYAAAAAAAAAAHIYDRDjLBP9' +
  '4ywT/+MsE//jLBP/4ywT/+MsE//jLBP/4ywT/+MsE//jLBP/4ywT/+MrE/k8DAgEAAAAAAAAAAAAAAAA2y8Wj9kqEv/ZKhL/2SoS/9kqEv/ZKhL/2SoS/9kq' +
  'Ev/ZKhL/2SoS/9kqEv+iIA5/AAAAAAAAAAAAAAAAAAAAAAAAAABtFQlR2isSqdkqEtbZKhLq2SoS79kqEu/ZKhLp2SoS1NkrFKVsFQpJAAAAAAAAAAAAAAAA' +
  'x5Qr/8iXLv/DlC7/w5Iq/8OSKv/JmC//yZgu/8mWK//FlCr/xZUu/8CSLf+9jin/xpQq/8iYL/+yiCv/yJUq/8iVK//Ily//uY0s/8mWK//Jliv/vI8t/7KI' +
  'K//Jliv/v48q/7uPLf+yiCv/qoAn/8KRKv+7ji3/r4Yr/7qMKf/Fkyr/vI8t/8GTLv+ieib/uowp/8WWLv/Gli7/wJAq/8mWK//JmC//yJgu/8GRKv/CkSr/' +
  'wZMu/8mYLv/Jliv/yZYr/7GHLP+8jy3/yZYr/8CQKv/Aki7/vZAt/8mWK//IlSv/yJcu/72QLf/GlCr/xpQr/8mYL//Jly7/yZYr//rlff/65oL/+OWB//nj' +
  'ff/5433/+ueC//rngv/65n7/+uR9//nlgf/45ID/9+F7//rlfv/65oL/8tx+//rlfv/65n7/+ueC//Xff//65n7/++V+//bhgP/y3H7/+uZ+//jhfP/24X//' +
  '8tt+/+/Vef/44n3/9uB///Hafv/233z/+eR9//bif//444H/7NJ3//XefP/55oH/+eWB//fiff/75n7/+ueC//rmgv/34n3/+OJ9//jkgP/654L/+uZ+//vm' +
  'fv/y3H7/9uGA//rlfv/44nz/+OOA//fif//65n7/+uV+//rmgv/24oD/+eR+//rkff/654L/+ueB//rmfv8AQoP/AESI/wBChf8AQIH/AECB/wBEif8ARIj/' +
  'AEKF/wBBg/8AQ4b/AEKD/wA/ff8AQYP/AESI/wA9e/8AQoT/AEKE/wBEiP8AQH//AEKF/wBChf8AQYL/AD17/wBChf8AP3//AECA/wA+e/8AOXP/AECB/wBB' +
  'gf8APXr/AD58/wBBgv8AQYD/AEKE/wA3bv8APnz/AESH/wBDhv8AQID/AEKF/wBEif8ARIj/AECA/wBAgf8AQoT/AESI/wBChf8AQoX/AD57/wBBgf8AQoX/' +
  'AD9//wBCg/8AQYH/AEKF/wBChP8ARIf/AEGC/wBBg/8AQYP/AESJ/wBEiP8AQoX/AGS8/wBmv/8AZbz/AGO6/wBjuv8AZ8D/AGe//wBlvf8AY7v/AGW+/wBk' +
  'u/8AYbb/AGS8/wBnv/8AYLL/AGS9/wBlvf8AZ8D/AGK2/wBlvv8AZb7/AGS5/wBgsv8AZb3/AGK3/wBjuP8AYLL/AFuq/wBjuf8AY7j/AGCx/wBgtf8AZLv/' +
  'AGO4/wBlu/8AWKX/AGC0/wBmvv8AZr7/AGK4/wBlvv8AZ8D/AGfA/wBiuP8AY7n/AGW8/wBnwP8AZb7/AGW+/wBhsv8AZLn/AGW9/wBiuP8AZLv/AGO4/wBl' +
  'vf8AZb3/AGe//wBkuf8AZLv/AGS8/wBnwP8AZ7//AGW9/zp/uP84gL3/OXu0/zp9tv9Gjcr/PYC5/zZ4sf81eLH/P4S//zt/uf85erL/QIO8/0GFwP86erH/' +
  'OXet/zp/uf82erT/NHav/zFxqP81da3/M3Wu/y5nmf8ybqL/OYTD/zt8tf83ebH/OXuz/zp8tP83ebL/QYO8/0WKxv85fLb/OXmw/zl7tP82eLD/Onuz/zh7' +
  's/9FicT/QYO9/zZ3rv81dq3/N3+8/zV3r/82erT/OYTE/zNyqP8wbaD/LGOT/zx9tf83dq3/NnOo/zp4rf86frf/O3yz/z1/uf82dKr/NHKn/zVxpf8tZZX/' +
  'NnOp/zV4sf87g8H/PYO//zR3sP+gxun/osfr/5zD6P+fxOj/sdPw/6LH6f+Zwef/mcHo/6bL6v+gxun/m8Po/6XK6v+ozOz/msLn/5fA5v+gx+r/m8Lm/5fA' +
  '5/+QuuT/lb7l/5a/5/+Fsd7/jLfi/6bL7f+exOj/msLn/5zD5/+dxOf/msLo/6XK6v+u0O7/ncTo/5rB5f+dw+b/mcHm/5zD5v+cw+b/rc/s/6bK6v+XwOb/' +
  'lr7k/6HH6/+XwOb/m8Lm/6bL7f+Su+L/jLbh/3+u3v+fxOb/l7/k/5O74/+Yv+T/n8Xo/53D5v+hxuj/lL3k/5K64v+RuuP/gq/d/5O84/+Zwej/pcnq/6XK' +
  '6/+XwOj/Zo5B/2aPQf9iij3/ZYxA/3SdTv9nj0L/YIg6/2CIOv9rk0b/Zo5B/2KKPP9rkkb/bZVI/2GJPf9fhzr/Zo5A/2GJPP9ehjj/WIEz/12FOP9chTf/' +
  'UHgq/1Z+MP9qk0T/ZIw//2CJO/9jij7/ZIs//2GJO/9rk0b/cppN/2OMPv9hiT3/Y4s//2CIO/9jiz//Yoo+/3GZTP9rk0b/X4c5/12FOP9ljkD/XoY5/2GJ' +
  'PP9qk0T/WoI1/1V9L/9LdCX/ZYxB/16GOv9bgzf/YIc8/2WNQP9kiz//Z45C/1yEN/9agjX/WYE0/011J/9chDf/X4g6/2qSRf9qkkX/Xoc5/67Tgv+w1IL/' +
  'q9F+/63Rgf++3ZT/sNOE/6jPe/+oz3r/tNaI/6/Tgv+q0Hz/staI/7XYi/+pz3z/ps15/67Tgv+qz33/ps14/6DJcv+lzHf/pc13/5TAZ/+bxW7/tNaH/6zR' +
  'gP+pz3v/qtB+/6vRf/+p0Hz/s9aI/7vbkv+s0X//qc59/6vQf/+oznv/q9B//6vQfv+62pH/s9aJ/6bNef+ky3j/r9OC/6fNef+qzn3/tNeH/6HJdP+bxW7/' +
  'j75h/63Rgf+mzHn/ocl1/6bMe/+t0oH/q9B//6/Tg/+jy3b/ocl0/6DJc/+RvmP/osp1/6jPev+z1Yf/s9aH/6fOef8yd03/F1wy/yVqQP8XXDL/F1wy/xZb' +
  'Mf8ZXjT/MndN/xpfNf81elD/Flsx/yVqQP8zeE7/Gl81/zF2TP8ZXjT/JWpA/zB1S/8xdkz/GF0z/yVqQP8XXDL/MndN/yZrQf8XXDL/GV40/yluRP8eYzn/' +
  'OH1T/yZrQf8obUP/F1wy/zJ3Tf8XXDL/JWpA/x5jOf84fVP/Flsx/xhdM/8XXDL/GV40/zV6UP8XXDL/JmtB/xhdM/8hZjz/N3xS/xhdM/8ma0H/MndN/xdc' +
  'Mv8xdkz/JmtB/zh9U/8dYjj/JmtB/xdcMv8ma0H/NXpQ/xdcMv8XXDL/GV40/xpfNf8xdkz/aq+F/0+Uav9eo3n/UJVr/0+Uav9Nkmj/Updt/2qvhf9Sl23/' +
  'cLWL/06Taf9eo3n/bLGH/1WacP9proT/UZZs/16jef9orYP/aa6E/1GWbP9fpHr/T5Rq/2muhP9fpHr/T5Rq/1GWbP9jqH7/V5xy/3G2jP9fpHr/Yqd9/0+U' +
  'av9qr4X/TpNp/16jef9Wm3H/cLWL/02SaP9Rlmz/T5Rq/1KXbf9wtYv/TpNp/16jef9Rlmz/XKF3/2+0iv9Rlmz/X6R6/2muhP9Ok2n/aq+F/1+kev9wtYv/' +
  'VZpw/1+kev9PlGr/X6R6/3C1i/9QlWv/T5Rq/1GWbP9VmnD/aa6E/3Cksf9ViZb/ZJil/1aKl/9ViZb/U4eU/1iMmf9wpLH/WIyZ/3aqt/9UiJX/ZJil/3Km' +
  's/9bj5z/b6Ow/1eLmP9kmKX/bqKv/2+jsP9Xi5j/ZZmm/1WJlv9vo7D/ZZmm/1WJlv9Xi5j/aZ2q/12Rnv93q7j/ZZmm/2icqf9ViZb/cKSx/1SIlf9kmKX/' +
  'XJCd/3aqt/9Th5T/V4uY/1WJlv9YjJn/dqq3/1SIlf9kmKX/V4uY/2KWo/91qbb/V4uY/2WZpv9vo7D/VIiV/3Cksf9lmab/dqq3/1uPnP9lmab/VYmW/2WZ' +
  'pv92qrf/VoqX/1WJlv9Xi5j/W4+c/2+jsP+24+r/ms3a/6rX4f+bz9z/m8/c/5jM2f+e0d7/tuPq/57S3v+84un/mc3a/6rb5f+44ej/odXi/7Xh6f+d0d7/' +
  'qdrk/7Ph6P+04ej/ndDd/6rX4f+aztr/teHp/6vb5f+bz9z/ndHe/6/b5f+j0t7/vObs/6rX4f+u2uX/m8/c/7bj6v+Zzdr/qtfh/6LS3v+85uz/mMzZ/53R' +
  '3v+bz9z/ntHe/7zh6f+azdr/qtfh/53R3f+o2uX/uubs/53R3v+r2uX/teHp/5rO2v+24Of/q9rk/7vn7P+g0t7/q9vl/5vP3P+r1+H/vOHo/5vP3P+bz9z/' +
  'ndHe/6HV4f+14ur/M47P/zONz/9AldL/WaTa/1mk2f9AldL/M43P/zONz/8wi8z/L4nL/zyT0f9Wodj/VqHY/zyT0f8vicv/MIvM/zKKyv8yi8v/P5PP/1mk' +
  '2v9ZpNr/P5PP/zKLy/8yisr/MIvN/zCKzP89k9L/V6LZ/1ei2f89k9H/MIrM/zCLzf8wi83/MIrM/z6U0v9dptr/Xaba/z6U0v8wisz/MIvN/zKLyv8zi8r/' +
  'P5PP/1mk2v9ZpNr/P5PP/zOLyv8yi8r/MIvM/y+Jy/8+lNL/Xabb/12m2/8+lNL/L4nL/zCLzP8uiMn/LofI/z2Sz/9ZpNr/WaTa/z2Sz/8uh8j/LojJ/2vH' +
  '8f9syPH/ec3y/5XZ9f+V2fX/ec3y/2zI8f9rx/H/Z8bw/2fF7/92y/L/kdb0/5HW9P92y/L/Z8Xv/2fG8P9qxe7/a8Xu/3nL8f+V2fX/ldn1/3nL8f9rxe7/' +
  'asXu/2fG8P9oxvD/dszy/5LY9f+T2PX/dszy/2jG8P9nxvD/Z8bw/2jG8P94zPL/mdr2/5na9v94zPL/aMbw/2fG8P9qxe7/a8Xv/3nL8f+V2fX/ldn1/3nL' +
  '8f9rxe//asXu/2fG8P9nxe//d8zy/5na9v+Z2vb/d8zy/2fF7/9nxvD/ZsPu/2bD7f92yvD/ldn1/5XZ9f92yvD/ZsPt/2bD7v/PpTP/z6Uz/9KrQP/auFn/' +
  '2bhZ/9KrQP/PpTP/z6Uz/8yiMP/LoS//0ak8/9i1Vv/YtVb/0ak8/8uhL//MojD/yqEy/8uiMv/PqT//2rhZ/9q4Wf/PqT//y6Iy/8qiMv/NozD/zKIw/9Kq' +
  'Pf/Zt1f/2bdX/9GqPf/MojD/zaMw/82jMP/MojD/0qo+/9q5Xf/auV3/0qo+/8yiMP/NozD/yqEy/8qiM//PqT//2rhZ/9q4Wf/PqT//yqIz/8qiMv/MojD/' +
  'y6Ev/9KqPv/buV3/27ld/9KqPv/LoS//zKIw/8mfLv/Iny7/z6g9/9q4Wf/auFn/z6g9/8ifLv/Jny7/9eBp//Xgav/243r/+Ouc//jrm//243r/9eBq//Xg' +
  'af/032X/895k//Xidv/46Zb/+OmW//Xidv/z3mT/9N9l//PeaP/z3mn/9eJ5//jrm//465v/9eJ5//Peaf/z3mj/9N9l//TfZf/243f/+OqY//jqmP/243f/' +
  '9N9l//TfZf/032X/9N9l//bjeP/57KD/+eyg//bjeP/032X/9N9l//PeaP/z3mn/9eJ5//jrm//465v/9eJ5//Peaf/z3mj/9N9l//PeZP/243j/+eug//nr' +
  'oP/243j/895k//TfZf/y3GT/8txk//Thd//465v/+Oub//Thd//y3GT/8txk/zCFzv9CktX/MIXO/0KS1f8whc7/QpLV/zCFzv9CktX/R5XW/zCFzv9HlNb/' +
  'MIXO/0eU1v8whc7/RpTW/zCFzv8whc7/Q5LV/zCFzv9DktX/MIXO/0OS1f8whc7/Q5LV/0ST1f8whc7/RJPV/zCFzv9Ek9X/MIXO/0ST1f8whc7/MIXO/0ST' +
  '1f8whc7/RJPV/zCFzv9Ek9X/MIXO/0ST1f9FlNX/MIXO/0WU1f8whc7/RZTV/zCFzv9FlNX/MIXO/zCFzv9Ek9X/MIXO/0ST1f8whc7/RJPV/zCFzv9Ek9X/' +
  'Q5LV/zCFzv9DktX/MIXO/0OS1f8whc7/Q5LV/zCFzv+Fxu//hcbv/4XG7/+Fxu//hcbv/4XG7/+Fxu//hcbv/4XG7/+Fxu//hcbv/4XG7/+Fxu//hcbv/4XG' +
  '7/+Fxu//hcbv/4XG7/+Fxu//hcbv/4XG7/+Fxu//hcbv/4XG7/+Fxu//hcbv/4XG7/+Fxu//hcbv/4XG7/+Fxu//hcbv/4XG7/+Fxu//hcbv/4XG7/+Fxu//' +
  'hcbv/4XG7/+Fxu//hcbv/4XG7/+Fxu//hcbv/4XG7/+Fxu//hcbv/4XG7/+Fxu//hcbv/4XG7/+Fxu//hcbv/4XG7/+Fxu//hcbv/4XG7/+Fxu//hcbv/4XG' +
  '7/+Fxu//hcbv/4XG7/+Fxu//zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/' +
  'zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813' +
  'Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/' +
  'zXcx/++9hf/vvYX/772F/++9hf/vvYX/772F/++9hf/vvYX/772F/++9hf/vvYX/772F/++9hf/vvYX/772F/++9hf/vvYX/772F/++9hf/vvYX/772F/++9' +
  'hf/vvYX/772F/++9hf/vvYX/772F/++9hf/vvYX/772F/++9hf/vvYX/772F/++9hf/vvYX/772F/++9hf/vvYX/772F/++9hf/vvYX/772F/++9hf/vvYX/' +
  '772F/++9hf/vvYX/772F/++9hf/vvYX/772F/++9hf/vvYX/772F/++9hf/vvYX/772F/++9hf/vvYX/772F/++9hf/vvYX/772F/++9hf9Pb0f/UnRJ/1N2' +
  'Sv9Qdk7/T3JJ/1J0Sf9Tdkr/UHFH/1Z6Tf9YfU7/U3ZK/057Vf9Wek3/WH1O/1N2Sv9OcEf/VHhM/1l/UP9YfU//WIJV/1R7UP9Zf1D/WH1P/1h8Tv9YfE7/' +
  'VntN/1l/Uf9aglP/WH9S/1Z7Tf9Zf1H/Wn9Q/1V4TP9Zfk//WH1P/1aAVP9Vek//WX5P/1h9T/9We03/VnpN/1h9Tv9Tdkr/TntV/1Z6Tf9YfU7/U3ZK/05w' +
  'R/9UeEz/WX9Q/1h9T/9YglX/VHtQ/1l/UP9YfU//WHxO/0Z2X/9FdV3/R3de/0h3Xv9Fdl7/RXVd/0d3Xv9HeF//osGZ/6XFnP+mxp3/o8Ka/6LBmf+lxZz/' +
  'psad/6PCmv+qyqD/rMyh/6bGnf+hwJn/qsqg/6zMof+mxp3/ocCZ/6jInv+tzqP/q8uh/6vLof+oyJ7/rc6j/6vLof+ry6H/q8yh/6rKoP+tzKT/rc6j/6vM' +
  'of+qyqD/rcyk/63Oo/+oyJ//rM2i/6zMov+qyqD/qMif/6zNov+szKL/qsqg/6rKoP+szKH/psad/6HAmf+qyqD/rMyh/6bGnf+hwJn/qMie/63Oo/+ry6H/' +
  'q8uh/6jInv+tzqP/q8uh/6vLof+Yxqr/l8Wp/5nHqv+ax6r/mMaq/5fFqP+axqr/mciq/4gfGf+NIBr/kCEa/4olIP+IIhz/jSAa/5AhGv+KIBn/lCIb/5gi' +
  'HP+QIRv/iCoo/5QiG/+YIhz/kCEb/4ggGf+SIRv/miMc/5gjHP+YKSP/kiUf/5ojHP+YIxz/mCMc/5ciG/+VIhv/myMd/5smH/+XJR//lSIb/5sjHf+bIxz/' +
  'kiEb/5kjHP+ZIxz/lSci/5IkHv+ZIxz/mSMc/5UiG/+UIhv/mCIc/5AhG/+IKij/lCIb/5giHP+QIRv/iCAZ/5IhG/+aIxz/mCMc/5gpI/+SJR//miMc/5gj' +
  'HP+YIxz/eC84/3cuNv97Lzb/ey83/3gvN/93Ljb/ey82/3svN//PeGX/1Xpn/9Z7aP/ReWb/z3hl/9V6Z//We2j/0Xlm/9t+av/egGv/1nxo/894Zf/bfmr/' +
  '3oBr/9Z8aP/PeGX/2H1p/+CBbP/dgGv/3IBr/9h9af/ggWz/3YBr/9yAa//dgGv/2n9q/92CbP/fgmz/3YBr/9p/av/dgmz/34Js/9h+af/fgWv/3YBr/9t/' +
  'av/Yfmn/34Fr/92Aa//bf2r/235q/96Aa//WfGj/z3hl/9t+av/egGv/1nxo/894Zf/YfWn/4IFs/92Aa//cgGv/2H1p/+CBbP/dgGv/3IBr/76Eff++gnz/' +
  'wIN8/8GEff++g37/voJ8/8CDff/BhH3/nXQI/551CP+zhQr/toYJ/5lyCP+edQj/sYMJ/7eICv+edQj/n3YI/6R6CP+8jAn/pHkI/5pzCP+wggn/lW4I/62A' +
  'Cf+ieAn/t4gK/62BCf+sgAn/qn4J/76NCv+6igr/qX4K/6R6Cf+4igr/m3QJ/62ACv/CkQv/vo0K/7SGC/+0hw3/sYUS/7iKD/+ofw//roMR/7mLDf+iehH/' +
  'tooS/7iJCv+zhQn/ongJ/7KECf+ofQn/uYkJ/7GDCf+tgAn/mnMI/6l+Cf+heAj/s4UJ/6p+Cf+ofAn/rH8J/7mKCv+zhQn/rIAJ/8KQCv+fdgj/tIUJ/7OF' +
  'Cv+gdgj/pnsJ/7CYLP+ymiz/yq4y/8uwM/+slSv/sJks/8arMv/OsjP/sZks/7KaLP+3ny7/07Y0/7efLv+tliz/xasx/6eQKv/CqDH/tp0t/86yM//DqDD/' +
  'wacw/7+lMP/VuDX/0bU1/72kMP+4oC7/zrIz/66WLP/BpzH/2bw3/9S3Nf/KrzP/y7A2/8atOP/Osjj/vKMz/8KpN//PtDf/tZ0z/82yOf/PsjP/yK0y/7Wd' +
  'Lf/HrDH/vKMv/86zM//FqzH/wqgx/66WLP+/pTD/tZwt/8quM/+/pTD/vKMv/8GnMP/QtDT/ya4y/8KnMf/avDb/spst/8uvM//JrjL/s5st/7uhL/9RYnf/' +
  'UGF2/0pabv9RYnj/TV1x/1Fid/9NXXH/TV1x/1Fid/9RYnf/T2B0/1Fid/9RYnf/UWJ3/09gdP9RYnf/SVls/09gdP9OX3P/UGF2/0pabv9RYnf/T2B0/05f' +
  'dP9JWGv/T2B0/1FjeP9IV2r/RlVn/1Fid/9SY3j/Slpu/0tabf9MXHD/Tl9z/1Bgdf9PX3T/UWJ3/0NRYv9QYnb/T190/09gdf9NXXH/UGF2/0tabf9SY3j/' +
  'TFxw/1Fid/9OXnP/SVhs/1Bhdf9NXXH/Tl5y/01ecv9QYXb/T2B0/1Bhdv9PX3T/T2B1/0NSZP9MXXD/Tl9z/1Bhdv9OX3P/Y3GA/2Rygf9ygZL/c4KT/2Ju' +
  'ff9jcYD/cH+P/3WElf9kcYD/ZXKB/2h2hf93h5n/aHaF/2Jvfv9vfo//Xmt5/258jf9ndYT/dISV/259jf9tfIz/bHuL/3iIm/92hpj/bHqJ/2l3hv91hJb/' +
  'YnB+/258jf97jJ7/eIia/3KCk/91hJT/dIKS/3aGl/9te4r/cX+P/3eGl/9qd4X/d4aX/3WElv9xgZL/ZnSD/3CAkf9reYn/dYSW/3B/j/9ufI3/Y3B+/2x7' +
  'iv9mdIP/coGS/2x6i/9qeYn/bXyM/3aGl/9ygZL/bnyN/3uMnv9lc4L/coKT/3GBkv9lc4L/aniI/7ZlCP+mXQj/qF8L/6ZdCP+mXQj/pl0I/6ZdCP+2ZQj/' +
  'u2UB/5lZDv+ESgf/pV0K/6VdCf+HTQr/mlkO/7tlAP++aQX/gUgF/2s5AP+jXg//oV0O/2o5AP+BSAb/vWgE/7tlAP+lXQr/oV4O/6RaBP+lWwX/n1wO/6Rd' +
  'Cv+7ZQD/u2UA/6ZdCf+kXw//pFoD/6RaBP+kXw//pV0J/7tlAP+9aAX/g0kF/2s6AP+gWwr/n1oK/2s6AP+ESgb/vWgE/7tlAf+WVgz/fkYE/6VdCv+lXQn/' +
  'fkYE/5ZXDf+7ZQH/pl0I/5dWCf+aWQ7/llQI/5ZUCP+aWQ7/l1UJ/6ZdCP//kiL//4MT//+FFv//gxP//4MT//+DE///gxP//5Ii//+WJP/mehX/zmgM//2D' +
  'FP/9ghT/0GsO/+l7Ff//lSP//5go/8tlCv+vUgH/9IIY//KAF/+uUgH/y2YK//+YJ///lSP/+4IV//KBGP//gRD//4EQ//B+Fv/6ghT//5Uj//+VI//9gxT/' +
  '9oMY//+AD///gA//9oMY//2CFP//lSP//5gn/85nCv+vUwH/9H4U//N+FP+vUwH/zmcL//+YJ///liT/5HcT/8hjCP/7ghT/+4IU/8hjCP/keBT//5Yk/+iF' +
  'H//odxL/6HoW/+h2EP/odhD/6HoW/+h3Ev/ohR//YF5j/1hWW/9aWF3/WFZb/1hWW/9YVlv/WFZb/2BeY/9fXWL/VFJX/0dFSv9YVlv/WFZb/0lHTP9VU1j/' +
  'X11i/2NhZv9EQkf/NjQ5/1pYXf9ZV1z/NjQ5/0VDSP9iYGX/X11i/1hWW/9ZV1z/VVNY/1ZUWf9XVVr/WFZb/19dYv9fXWL/WFZb/1tZXv9VU1j/VVNY/1pY' +
  'Xf9YVlv/X11i/2JgZf9FQ0j/NzU6/1ZUWf9WVFn/NzU6/0ZESf9iYGX/X11i/1JQVf9CQEX/WFZb/1hWW/9CQEX/U1FW/19dYv9YVlv/UlBV/1VTWP9QTlP/' +
  'UE5T/1VTWP9RT1T/WFZb/66ssf+fnaL/oZ+k/5+dov+fnaL/n52i/5+dov+urLH/srC1/5KQlf9+fIH/n52i/56cof+Bf4T/lJKX/7Kwtf+1s7j/e3l+/2Zk' +
  'af+cmp//mpid/2VjaP98en//tLK3/7Kwtf+enKH/m5me/52boP+enKH/mZec/52boP+ysLX/srC1/5+dov+dm6D/nZug/52boP+enKH/n52i/7Kwtf+0srf/' +
  'fXuA/2Zkaf+Zl5z/mZec/2Zkaf9+fIH/tLK3/7Kwtf+PjZL/eXd8/56cof+enKH/eXd8/5COk/+ysLX/npyh/5GPlP+TkZb/kI6T/5COk/+TkZb/kY+U/56c' +
  'of8jPg3/IjwN/yVBDf8mRA7/JD8N/ydFDv8nRQ7/J0QO/yM9DP8jPg3/IToM/yVCDf8nRQ7/JD8N/ytLD/8lQg3/IDkM/yRADf8gNwz/JEAN/yhHDv8oRw7/' +
  'JUAN/yVADf8jPQ3/JEAN/yI7DP8iPAz/JUEN/ydEDv8lQg3/JD8N/yE5DP8oRg7/J0QO/yVBDf8jPg3/JD8N/yZCDv8kPw3/ITkM/yVADf8qSg//JkMO/yVA' +
  'Df8jPQ3/Iz4N/yI7DP8kPw3/JUAN/yM9DP8mQg3/JD4N/yM9DP8gOQv/IToM/xotCv8aLQn/GCkI/xcpCf8aLgr/GCoJ/xgpCf8VJAf/bZg5/2uWOP9xnTr/' +
  'daI7/3CcOv92ozz/dqM8/3SgO/9slzj/b5o5/2mUN/9znzv/dqM8/26ZOf99qz//cp46/2eQNv9wnDr/Zo81/3GdOv93pT3/d6U9/3CcOv9vmjn/bJY4/3Cd' +
  'Ov9qlDf/bJc4/3GcOv90oTz/cp46/26ZOf9okjb/eKU9/3WiPP9xnDr/bpk5/2+cOv9ynzv/bpk5/2eQNv9wnTr/e6o//3ShO/9wnDr/bZk5/26aOf9okjb/' +
  'bpg4/3CcOf9slzj/cp47/22ZOf9tmDn/Z5A2/2iSNv9TcS3/VHIt/1BuK/9Pbiv/VHMt/1FwLP9PbSv/SWUo/2QXC/9gFgr/aRgL/20ZC/9mGAv/cBoM/28a' +
  'DP9uGQz/YhcK/2QXC/9eFgr/aRgL/3AaDP9lFwv/ehwN/2oYC/9cFQr/ZxgL/1kVCv9nGAv/choM/3EbDP9oGAv/ZxgL/2MXC/9mGAv/XxYK/2EXCv9oGAv/' +
  'bRkM/2oYC/9lFwv/XRUK/3EaDP9tGgz/aBgL/2MXC/9mGAv/aRgL/2UYC/9cFQr/ZxgL/3cbDf9rGQz/ZhgL/2IXCv9kFwr/XhYK/2UXC/9nGAv/YhcK/2sZ' +
  'C/9jFwv/YxcL/1sVCv9dFgr/SREI/0kRCP9DEAf/Qg8H/0kRCP9FEAj/QxAI/zoOB/+/UzP/vlEz/8ZWNf/MWTb/xlU0/8xaN//NWTf/x1g2/75SM//DUzT/' +
  'vFAy/8hWNf/OWjf/wlQ0/9RgOv/FVjX/tk4x/8VVNP+3TTD/x1Q1/89bOP/OWjj/xVU1/8BVNP+9UjP/xlQ0/7xRMv/AUjL/xVU1/8lYNv/HVjX/wFQz/7pP' +
  'Mf/OWzj/y1g3/8VVNf/CUzP/xVQ0/8dWNf/AVDT/t04x/8ZVNP/SXjn/yVc2/8VVNP/CUzP/w1Mz/7hQMf+/UzT/xFU1/79SM//HVzb/wVMz/79TM/+3TjH/' +
  'uU8x/4xBKf+QQSr/iz0o/4o9J/+QQSr/jD8p/4k+J/+AOSX/jBsT/38aE/93GRL/kyIZ/4gaE/+CGhP/hxsT/5EhGf+OHBT/gRoT/38aEv+UIhn/hxsT/4gb' +
  'E/+MGxP/hSAY/5AcFP+FGxP/fhoS/4AfGP+OGxP/fxoS/4EaEv94Hxj/fh8Y/5IiGf+OIRn/kyYe/40hGf9/IBj/kCIZ/30kHf+LHBP/dhkS/3waEv+MIRn/' +
  'gRoT/4AaE/+BGhP/lCIZ/48cFP+LGxP/hBoS/3YeGP+MHBP/gBoT/4MaE/+RIRn/ehkS/44cFP+OGxP/jCEZ/3QZEv+EGhP/jxwT/4IgGf+RIhn/jyEZ/5Ei' +
  'Gf+YJx7/jSEZ/4chGf+TIhn/fCQd/71AM/+wPzL/qT0y/8BJPP+4QDP/sj8y/7ZAM/+/SDv/vUE0/7I+Mv+wPjL/wUk7/7hAM/+5QDP/vEAz/7VGOv+/QTT/' +
  'tj8z/7A+Mv+vRTr/vkE0/7A+Mv+yPjP/qEQ5/65FOf+/SDz/vUg7/79PQv+7SDv/r0U6/71IO/+rS0D/ukAz/6g9Mf+uPjL/ukg7/7M/M/+xPzL/sj8y/8FJ' +
  'PP++QTT/u0Az/7Q/Mv+mRDn/vEEz/7E/Mv+0PzP/v0g7/6w+Mf++QTT/v0E0/7pIO/+mPTH/tT8z/79BNP+xRjn/v0g8/71IO/+/SDz/w09C/7tIO/+3Rzv/' +
  'wEk8/6pLQP/afgv/xnQL/7hsC//dhRD/03oL/8l2C//Regv/2oMQ/9t/C//HdAv/xnML/96FEP/QeQv/1HsL/9l+C//IeRD/3oEL/854C//Dcwv/wHUQ/9x/' +
  'C//Fcwv/yXUL/7VvEP+9cxD/24QQ/9aAEP/ZhRT/1IAQ/790EP/YghD/t3MU/9Z9C/+4bAv/wnIL/9J/EP/IdQv/x3QL/8h0C//dhRD/3IAL/9d9C//Ndwv/' +
  'sW0Q/9l+C//HdAv/y3YL/9qDEP++cAv/238L/9yAC//TfxD/tmsL/814C//dgQv/w3YQ/9uDEP/YgRD/2oMQ/96JFP/TfxD/zHsQ/96EEP+1cxT/7bEf/+Kn' +
  'H//boB//7rUn/+qtH//jqB//56wf/+20J//usR7/5Kge/+KnH//utSf/6Kwf/+quHv/ssB//46sn/++zH//nqx//4aYf/96mJ//vsh//4aYf/+SoH//XoCf/' +
  '3KYm/+21J//rsif/67Yu/+mwJ//epif/67In/9ejLf/qrx//2qAf/+ClH//nryf/5Kgf/+GnH//ipx//7rUn/+6yHv/srx7/5qof/9WfJ//tsR//4qce/+aq' +
  'H//stCf/3aIf/+6xH//vsh//6LAn/9ieH//nqx//8LMf/+CoJ//ssyb/67Mn/+y0J//tuC7/6LAn/+WsJ//vtif/1qMu/5bg//+W4P//luD//5bg//+W4P//' +
  'luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg' +
  '//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//' +
  'luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//8fcKr/IHSx/yF2tP8fdrH/H3Kt/yB0sf8hdrT/H3Gs/yJ6' +
  'uf8ifr//IXe0/x97tv8iern/In6//yF3tP8fcKr/IXi3/yOAwv8jfb7/IoLD/yF7uv8jgML/I32+/yJ8vv8ifL3/Inu7/yN/wv8jgsT/In/B/yJ7u/8jf8L/' +
  'I4DC/yF4t/8jfsD/I36//yKAwP8he7n/I37A/yN+v/8ie7v/Inq5/yJ+v/8hd7T/H3u2/yJ6uf8ifr//IXe0/x9wqv8heLf/I4DC/yN9vv8igsP/IXu6/yOA' +
  'wv8jfb7/Iny+/xt2tP8bdbL/HHe2/xx4tv8bdrT/G3Wy/xx3tv8ceLf/pqGT/42Jf/+bk4P/kYyA/5GMgP+ak4L/jYp//6ahk/+tppX/2tG6/+Pbw//i2sP/' +
  '4trC/+HZwv/UzLT/rKaU/6ehkf/l3cb/59/I/+ffyP/n38j/59/I/93UvP+loI//l5KG/+bex//n38n/59/J/+ffyf/n38n/3tW9/5WQhP+Xk4b/5t7H/+ff' +
  'yf/n38n/59/J/+ffyf/f17//lZCE/6iikv/m3sf/59/I/+ffyP/n38j/59/I/+DYwf+moJD/raeW/9zUvf/j28T/49vD/+PbxP/k3MT/2dG6/6ymlP+moZL/' +
  'jop//5mTgv+RjYD/kY2A/5qTgv+Oin//pqGT/2hvcf95hIf/eYSH/3iDhv94g4b/eYSH/3mDh/9ob3H/mX4t/+yzBf/rsgX/67IF/+uzBf/rsgX/7LMF/5l+' +
  'Lf+bei3/7qcB//K0Af/1uQH/9bkB//W4Af/1uQH/n4It/5l1LP/snwH/9LMB//i7Af/4uwH/97oB//i7Af+fgiz/n4Is//i7Af/3uwH/+LsB//i7Af/0swH/' +
  '7J8B/5l1LP+egC3/9LUB//S3Af/1uQH/9bkB//K0Af/uqAH/m3ot/5l+Lf/sswX/67IF/+uzBf/rswX/67IF/+yzBf+Zfi3/aG9x/3mDh/95hIf/eIOG/3iD' +
  'hv95hIf/eYSH/2hvcf9BQUD/NTU1/zU1Nf82Njb/NjY2/zU1Nf81NTX/QUFB/0VFRf89PT3/PT09/z09Pf89PT3/PT09/zw8PP9GRUX/RUVE/zo6Ov86Ojr/' +
  'Ozs7/zs7O/87Ozv/Ojo6/0VERP9DQ0P/Ojo6/zo6Ov87Ozv/Ozs7/zo6Ov86Ojr/RERE/0NDQ/86Ojr/Ojo6/zs7O/87Ozv/Ojo6/zo6Ov9EQ0P/Q0ND/zo6' +
  'Ov86Ojr/Ozs7/zo6Ov86Ojr/Ojo6/0RERP9BQUH/Ozs7/zo6Ov87Ozv/Ozs7/zo6Ov86Ojr/QUFB/0VFRP88PDz/PDs7/zs7O/88PDv/PDw8/zw7O/9FRUT/' +
  'UlJS/1BQUP9PT1D/TU1O/0xMTP9MTEz/TExM/05OTv9NTU3/T09P/1BQUP9PT0//UE9P/09PT/9PT0//TU1N/01NTf9PT0//T09P/09PT/9PT0//T09P/09P' +
  'T/9NTU3/TU1N/09PT/9PT0//T09P/09PT/9PT0//T09P/01NTf9OTk7/T09P/09PT/9PT0//T09P/09PT/9PT0//TU1N/01NTf9PT0//Tk5O/09PT/9PT0//' +
  'Tk5O/05PTv9MTEz/Tk5O/09PT/9PT0//T09P/09PT/9PT0//T09P/01NTf9QUFD/TU1N/01NTf9NTU3/TU1N/01NTf9NTU3/UFBQ/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZG' +
  'Rv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/' +
  'RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZG' +
  'Rv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/' +
  '1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YA' +
  'AP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/' +
  '1gAA/9YAAP/WAAD/1gAA/9YAAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZ' +
  'AP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/' +
  'ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZ' +
  'AP8A2QD/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/' +
  'AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA' +
  '8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/9LV8//S1fP/' +
  '0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV' +
  '8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/' +
  '0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8/8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAAAAAAAAAAAAAAAAAACwAAAJUAAACCAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAGAAAADsAAAA/wAAAM4AAAAAAAAAAAAAAAAAAAAAAAAA2AAAAP8AAAD/AAAA0AAAAAAAAAAAAAAAAAAAAAAAAADYAAAA/wAAAP8AAADQAAAAAAAA' +
  'AAAAAAAAAAAAAAAAANgAAAD/AAAA/wAAANAAAAAAAAAAAAAAAAAAAAAAAAAAohYMAN0WDQDbAAAAnAAAAAAAAAAAAAAAAAAAAAAAAAAAWTIAeFkyAHAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAABZMgBmWTIAXgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHYAAABuAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeAAA' +
  'AHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB4AAAAcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHgAAABwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAeAAAAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB4AAAAcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHgAAABwAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAcgAAAGsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB2AAAAbgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHgAAABwAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAeAAAAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB4AAAAcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHgAAABwAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAACeAAAAnAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB4AAAAcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHIAAABr' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHIAdgByAG4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcgB4AHIAcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABy' +
  'AHgAcgBwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHIAeAByAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcgB4AHIAcAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAABpAHgAaQBwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHIAeAByAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcgByAHIAawAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAIAAAHaAAABuAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAeIAAAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAB4gAAAcAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAIAAAHiAAABwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAeIAAAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB1AAB4dQAAcAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAHiAAABwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAcoAAAGsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAcgB2' +
  'gHIAbgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIByAHiAcgBwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgHIAeIByAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AACAcgB4gHIAcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIByAHiAcgBwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAdWkCeHVpAnAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAACAcgB4gHIAcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIByAHKAcgBrAAAAAAAAAAAAAAAAAAAAAAAAAACQTANq/4YE9v+GBPWQTANjAAAAAAAA' +
  'AAAAAAAAAAAAALB2BZv/rAj//6wI/7B2BpMAAAAAAAAAAAAAAAAwGQEc75UIzv+fCP//nwj/75UKyTAaAhkAAAAAAAAAAMBlBZX/hgb//4YG//+GBv//hgb/' +
  'wGcHjQAAAAAAAAAAcCEDQ/9IAv//SAL//0gC//9IAv9gHAE7AAAAAAAAAACkIw6H8jgN//I4Df/yOA3/8jgN/5UfCn8AAAAAOw0JCOYsE/3mLBP/5iwT/+Ys' +
  'E//mLBP/5iwT+x4GBAMAAAAAiRoMeNkqEt/ZKhL22SoS9tkqE96KHA9yAAAAAAAAAAAAAAAAAAAAABs1BFAbIgcmAAAAAAAAAAAAAAAAAAAAAA8XAAk6VgFa' +
  'U2IKclVhCmM8VgFuHiwBFwAAAAAKEwEOWKAE4VieAv9aoAL/W6EC/1mgAv9aoQLjChQBCx5BAkpDlQL/Q5UC/0OVAv9DlQL/Q5UC/0OVAv8ZOAFCHEgBSzeP' +
  'Av83jgL/N48C/zePAv83jwL/N48C/xlCAUMKGgEWMYsC+TGLAv8xjAL/MYwC/zGMAv8xiwL2CRsBEAAAAAAlYgKDN44C/zePAv83jgL/N48C/yVkAXsAAAAA' +
  'AAAAAAUJAQNDfwKYV54C9VeeAvVBfgOSBQkBAgAAAAAAAAAAAAAAAJBMA2n/hgT2/4YE9ZBMA2MAAAAAAAAAAAAAAAAAAAAAsHUFmv+qCP//qgj/sHUFkgAA' +
  'AAAAAAAAAAAAADAZARzvlQjN/58I//+fCP/vlQrJMBoCGQAAAAAAAAAAwGUFlf+GBv//hgb//4YG//+GBv/AZweNAAAAAAAAAABwIQND/0gC//9IAv//SAL/' +
  '/0gC/2AcATsAAAAAAAAAAKQjDofyOA3/8jgN//I4Df/yOA3/lR8KfwAAAAA7DQkI5iwT/eYsE//mLBP/5iwT/+YsE//mLBP7HgYEAwAAAACIHAx42SoS39kq' +
  'EvbZKhL22SoT3noYC3IAAAAAxpUs/8GSLP/Hli3/w5Ms/8OTLP+4iyr/wZEs/7mMK//FlCz/u44r/8GSLP/GlSz/w5Is/8KSLP/ElC3/xpUs//rlf//4437/' +
  '+uWA//jkf//55H//9N19//jif//1337/+eV///Xffv/443//+eWA//jjf//443//+eR///nlf/8AQ4X/AEGC/wBChf8AQYP/AEGD/wA+ff8AQYL/AD9+/wBC' +
  'hP8AP3//AEGC/wBChf8AQoP/AEGD/wBChP8AQoX/AGW9/wBjuv8AZb3/AGS7/wBku/8AYbT/AGS6/wBhtf8AZbz/AGK2/wBkuv8AZb3/AGW7/wBku/8AZLz/' +
  'AGW8/zuBu/87fbb/QIO9/zh6sv83ebL/Nnev/zZ2rf86frj/OHqz/zd5sv86f7n/NXOo/zd2rP81caX/OX23/zl7tf+iyOr/n8Xp/6XK6/+awuj/m8Ln/5jA' +
  '5v+Xv+b/n8bp/5zC5/+awub/oMbo/5K85P+WvuT/kLni/5/F6P+cw+j/Z5BC/2WNQP9qk0X/YYk8/2GJPP9fhzr/XoY5/2WOQP9iij3/YYk8/2aOQf9bgzX/' +
  'XoU5/1mBNP9ljUD/Y4s+/7DUhP+t0oH/s9aI/6nQfP+pz3z/p856/6XNef+u0oL/qs9+/6nOfP+v04P/ocp0/6XMeP+fx3L/rdKA/6vRfv8ma0H/HmM5/x9k' +
  'Ov8lakD/IWY8/yRpP/8nbEL/JmtB/yZrQf8gZTv/Imc9/yBlO/8lakD/JWpA/yRpP/8kaT//X6R6/1eccv9XnHL/XqN5/1qfdf9donj/YKV7/16jef9fpHr/' +
  'WJ1z/1ugdv9YnXP/XqN5/16jef9coXf/XaJ4/2WZpv9dkZ7/XZGe/2SYpf9glKH/Y5ek/2aap/9kmKX/ZZmm/16Sn/9hlaL/XpKf/2SYpf9kmKX/Ypaj/2OX' +
  'pP+r2eP/otTf/6PU4P+q2uT/pdfi/6nY4v+r2eL/qtnk/6rZ4/+k09//ptfi/6TW4f+q2OP/qtjh/6jY4/+o2eT/MYzN/0ub1f9Lm9X/MYzN/zGLzP9Lm9X/' +
  'S5vV/zGLzP8xi8v/TZzV/02c1f8xi8v/L4nK/0yc1v9MnNb/L4nK/2nH8P+F0vP/hdLz/2nH8P9pxu//htLz/4bS8/9pxu//acbv/4jT9P+I0/T/acbv/2fE' +
  '7/+H0vP/h9Lz/2fE7//NozH/1bBL/9WwS//NozH/zKIx/9WxS//VsUv/zKIx/8uiMf/VsU3/1bFN/8uiMf/KoC//1rFM/9axTP/KoC//9N9n//fmif/35oj/' +
  '9N9n//TfZ//354n/9+eJ//TfZ//032f/9+eL//fni//032f/891k//fni//354v/891k/zqM0v86jNL/OozS/zqM0v86jNL/OozS/zqM0v86jNL/OozS/zqM' +
  '0v86jNL/OozS/zqM0v86jNL/OozS/zqM0v+Fxu//hcbv/4XG7/+Fxu//hcbv/4XG7/+Fxu//hcbv/4XG7/+Fxu//hcbv/4XG7/+Fxu//hcbv/4XG7/+Fxu//' +
  'zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/813Mf/NdzH/zXcx/++9hf/vvYX/772F/++9hf/vvYX/772F/++9' +
  'hf/vvYX/772F/++9hf/vvYX/772F/++9hf/vvYX/772F/++9hf9Ud0v/UXdO/1R3S/9Rc0n/V3xO/1mAUv9XfVD/WX5Q/1d7Tv9UfFH/V3xO/1R4S/9OeVb/' +
  'UHtY/055V/9Qelf/p8ee/6TEm/+nx57/pMSb/6vLof+szKL/q8uh/6zMov+ry6H/p8ee/6vLof+nx57/ocil/6LJpv+hyKX/osmm/5AhG/+NJB//kCIb/40h' +
  'Gv+WIhv/miUf/5YkHf+aIxz/liIc/5IlIP+WIxz/kiIb/4coKf+KKyv/hykq/4opKf/XfGj/03pn/9d8aP/Temf/3H9r/92BbP/cf2v/3YFs/9x/av/XfWn/' +
  '3H9q/9d9af/NgXT/z4J0/82BdP/PgnT/nnUI/7KECf+ddQj/q38J/6d8Cf+uggr/sYQK/7uLCv+0hw3/rYEM/7KFDP+ugg3/qX4J/62BCf+ugQn/q38J/7GZ' +
  'LP/IrTL/sJks/8CmMP+7oi//w6kx/8esMv/RtTX/yq81/8KoMv/HrTT/wqk0/76kMP/DqDH/xKkx/8CmMP9RYnf/T2B0/1Bhdv9PX3P/TFxw/05fc/9NXXH/' +
  'Tl90/01dcv9PX3T/T2B0/0xccP9OXnL/TFxw/01ecv9PYHX/ZHKB/3GAkf9kcYD/bXuL/2t5iP9ufY7/cYCR/3aGmP90g5T/bn2N/3KBkf9wfo7/bHqK/259' +
  'jf9ufo7/bXuL/6xgCP+eWQn/nlkJ/6xgCP+oXQX/lVQI/5RTCP+nXQX/qF0F/5VUB/+VUwf/qF0F/6RcCP+VVAn/lVQJ/6RcCP/5iRz/8n0S//N9Ev/6iRv/' +
  '8YUb/+V2EP/kdBD/8YUa//KGGv/mdQ//5nUP//KGGv/tghr/5XUR/+V1Ef/tgxr/W1le/1RSV/9UUlf/W1le/1hWW/9QTlP/T01S/1hWW/9YVlv/T01S/09N' +
  'Uv9YVlv/V1Va/1BOU/9QTlP/V1Va/6Sip/+XlZr/l5Wa/6WjqP+gnqP/j42S/46Mkf+gnqP/oZ+k/46Mkf+PjZL/oZ+k/5yan/+PjZL/j42S/5yan/8jPQ3/' +
  'JEAN/yZCDv8oRg7/Iz4N/yI8DP8nRQ7/JUAN/yQ+Df8nRQ7/JD8N/yQ/Df8fNgv/HjQL/x41C/8cMAr/bZg5/3GdOv9znzv/dqM8/22YOf9rljj/daI8/3Cb' +
  'Ov9umTn/daI8/2+bOv9umTn/YYYz/1+EMv9ghTP/Wn0w/2MXC/9nGAv/axkM/3AaDP9jFwv/YBcK/24aDP9oGAv/ZBcL/24aDP9kGAv/ZBcL/1gUCv9VFAn/' +
  'VRQK/00SCf/AUjP/xlU1/8lXNv/LWjf/wFIz/79RMv/LWTf/w1U0/8FTNP/LWTf/xFQ0/8FTM/+oSy//p0ku/6dKLv+eRSz/hxsT/4ceFv+GGxP/ih4W/4ke' +
  'Fv+IIBj/hh4W/4IgGP+HGxP/gR0V/4MbE/+KHhb/ih4W/5EhGf+DHRb/iCEZ/7dAM/+3Qzf/t0Az/7pEN/+5Qzf/t0c6/7ZDN/+xRTr/t0Az/7FCNv+0QDP/' +
  'ukQ3/7pEN/+/SDv/s0M3/7dHOv/ReQv/znoO/9B5C//TfQ7/0XwO/817EP/Neg7/w3YQ/9B6C//FdQ7/zHcL/9N9Dv/TfQ7/2oMQ/8l3Dv/NfBD/6Kwf/+as' +
  'I//orB//6a8j/+iuI//lrSf/5qwj/9+nJ//orB//4acj/+WqH//pryP/6a4j/+y0J//jqSP/5a0n/5bg//+W4P//luD//5bg//+W4P//luD//5bg//+W4P//' +
  'luD//5bg//+W4P//luD//5bg//+W4P//luD//5bg//8hd7X/IHi0/yF4tv8gdLD/Iny8/yOAwv8ifb7/I37A/yJ8vP8hfLr/Iny8/yF4tv8febj/H3y7/x96' +
  'uf8ferr/r6iY/7y1ov+8taL/raeX/8K8qf/n38n/59/J/722o//DvKr/59/J/+ffyf+/uKX/r6qZ/7y2ov+9tqP/rqmY/5qJS/+ym0b/sptG/5qJS//EjRf/' +
  '9bcB//a6Af/Lnhf/yp0X//a6Af/1twH/xI4X/5qJS/+ym0b/sptG/5qJS/8+Pj7/OTk5/zk5Of8+Pj7/Pz8//zs7O/87Ozv/Pz8//z8/P/87Ozv/Ojo6/z8/' +
  'P/8/Pz//Ozs7/zs7O/8/Pz//UFBQ/09PT/9OTk7/Tk5O/05OTv9PT0//T09P/05OTv9OTk7/T09P/09PT/9OTk7/T09P/05OTv9OTk7/Tk5O/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/RkZG/0ZGRv9GRkb/' +
  'RkZG/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP/WAAD/1gAA/9YAAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZ' +
  'AP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/ANkA/wDZAP8A2QD/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/AADz/wAA8/8AAPP/' +
  'AADz/wAA8/8AAPP/AADz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8//S1fP/0tXz/9LV8/8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAAAAAAAFYAAAC5AAAAAAAAAAAAAADsAAAA6AAAAAAAAAAA' +
  'BgMA1gYDANIAAAAAAAAAAC0ZADgtGQA0AAAAAAAAAAAAAAA8AAAAOAAAAAAAAAAAAAAAPAAAADgAAAAAAAAAAAAAADwAAAA4AAAAAAAAAAAAAAA7AAAANwAA' +
  'AAAAAAAAAAAAPAAAADgAAAAAAAAAAAAAADwAAAA4AAAAAAAAAAAAAAE8AAABOAAAAAAAAAAAAAAAOwAAADcAAAAAAAAAAAA5ADwAOQA4AAAAAAAAAAAAOQA8' +
  'ADkAOAAAAAAAAAAAADcAPAA3ADgAAAAAAAAAAAA5ADsAOQA3AAAAAAAAAABAAAA8QAAAOAAAAAAAAAAAQAAAPEAAADgAAAAAAAAAAD0AADw9AAA4AAAAAAAA' +
  'AABAAAA7QAAANwAAAAAAAAAAQDkAPEA5ADgAAAAAAAAAAEA5ADxAOQA4AAAAAAAAAAA9NwE8PTcBOAAAAAAAAAAAQDkAO0A5ADcAAAAAAAAAANB9Bb/QfQW7' +
  'AAAAADwgAiz7kAfz+5AI8jwgAipFEQQz+UAI//lACP89DwMvaxUKX+ArE/XgKxP1ZBQKXAQGAAIqOwRHKzYFPggLAAYxYgKOTpoC/0+bAv8wYQKMJF8CljSN' +
  'Av80jgL/I14CkgsbASJCjwLjQo4C4QsbAR8AAAAA0HwFvtB8BboAAAAAPCACLPuQB/P7kAjyPCACKkURBDP5QAj/+UAI/z0PAy9qFQpf4CsT9eArE/VgEwlc';

// The skybox (rs_maze_sky): 6 faces of DM_SKY_SIZE^2 RGBA, rt lf up dn ft bk,
// from games/dmlab_assets/sky/lg_sky_03_*.png; null where the level shows no sky.
const DM_SKY_SIZE = 64;
const DM_SKY_B64 =
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+K2P//itj//4rY//+K2P//itj//4rY//+K2P//itj//4rY//+K2P//itj//4rY//+K2P//itj//4rY//+K2P//itj//4rY' +
  '//+K2P//itj//4rY//+K2P//itj//4rY//+K2P//itj//4rY//+K2P//itj//4rY//+K2P//itj//4rY//+K2P//itj//4rY//+K2P//itj//4rY//+K2P//' +
  'itj//4rY//+K2P//itj//4rY//+K2P//itj//4rY//+K2P//itj//4rY//+K2P//itj//4rY//+K2P//itj//4rY//+K2P//itj//4rY//+K2P//itj//4rY' +
  '//+K2P//idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4fV//+H1f//' +
  'h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV' +
  '//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//' +
  'h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+G1P//htT//4bU//+G1P//htT//4bU' +
  '//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//' +
  'htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//jNj//5HZ+/+J1v//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU' +
  '//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///' +
  'hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT' +
  '//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//47Z//91nrH/fKm8/47V+P+H1P//hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///' +
  'hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR' +
  '//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4TS//+H1P//hNL//4PR//+D0f//g9H//4PR//+D0f//' +
  'g9H//4PR//+D0f//g9H//4PR//+M1///c52w/0xWXv9TYWr/icXh/4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR' +
  '//+D0f//g9H//4PR//+D0f//g9H//4PR//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//' +
  'gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+N2P//dZqr/43Y//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ' +
  '//+C0P//i9b//3Wgs/9MVV3/RkxT/32vxv+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//' +
  'gtD//4LQ//+C0P//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO' +
  '//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//jtj//1dncf+N1///gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4nU//92obT/' +
  'TFVd/0ZMU/95p7z/gc///4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//37M' +
  '//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//' +
  'fsz//37M//9+zP//fsz//4vR9/9WZW//i9b//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//+H0v//dqK1/0xVXf9GTFP/dZ+z/4DN' +
  '//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//98yv//fMr//3zK//98yv//' +
  'fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK' +
  '//+K0ff/VWVv/4rV//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//hdH//3aitv9MVV3/RkxT/3Sfs/9+y///fMr//3zK//98yv//' +
  'fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//esj//3rI//96yP//esj//3rI//96yP//esj//3rI' +
  '//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//3rI//96yP//iM/3/1Vlb/+J0///' +
  'esj//3rI//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//4TP//92obX/TFVd/0ZMU/90nrP/fMn//3rI//96yP//esj//3rI//96yP//esj//3rI' +
  '//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//3jG//94xv//eMb//3jG//94xv//eMb//3jG//94xv//eMb//3jG//94xv//' +
  'eMb//3jG//94xv//eMb//3jG//94xv//eMb//3jG//94xv//eMb//3jG//94xv//eMb//3jG//94xv//eMb//4fO9/9VZW//h9L//3jG//94xv//eMb//3jG' +
  '//94xv//eMb//3jG//94xv//eMb//3jG//+Czv//dqK1/0xVXf9GTFP/dJ6z/3rH//94xv//eMb//3jG//94xv//eMb//3jG//94xv//eMb//3jG//94xv//' +
  'eMb//3jG//94xv//eMb//3jG//94xv//eMb//3jG//92xP//dsT//3bE//92xP//dsT//3bE//92xP//dsT//3bE//92xP//dsT//3bE//92xP//dsT//3bE' +
  '//92xP//dsT//3bE//92xP//dsT//3bE//92xP//dsT//3bE//92xP//dsT//3bE//+Gzff/VmVw/4bR//92xP//dsT//3bE//92xP//dsT//3bE//92xP//' +
  'dsT//3bE//92xP//gMz//3ejt/9MVV3/RkxT/3Ses/94xf//dsT//3bE//92xP//dsT//3bE//92xP//dsT//3bE//92xP//dsT//3bE//92xP//dsT//3bE' +
  '//92xP//dsT//3bE//92xP//dML//3TC//90wv//dML//3TC//90wv//dML//3TC//90wv//dML//3TC//90wv//dML//3TC//90wv//dML//3TC//90wv//' +
  'dML//3TC//90wv//dML//3TC//90wv//dML//3TC//90wv//hcz3/1VlcP+F0P//dML//3TC//90wv//dML//3TC//90wv//dML//3TC//90wv//dML//3/K' +
  '//93pLf/TFVd/0ZMU/90nrP/dsP//3TC//90wv//dML//3TC//90wv//dML//3TC//90wv//dML//3TC//90wv//dML//3TC//90wv//dML//3TC//90wv//' +
  'dML//3LA//9ywP//csD//3LA//9ywP//csD//3LA//9ywP//csD//3LA//9ywP//csD//3LA//9ywP//csD//3LA//9ywP//csD//3LA//9ywP//csD//3LA' +
  '//9ywP//csD//3LA//9ywP//csD//4TL9/9VZXD/g87//3LA//9ywP//csD//3LA//9ywP//csD//3LA//9ywP//csD//3LA//99yf//d6O3/0xVXf9GTFP/' +
  'c52z/3TC//9ywP//csD//3LA//9ywP//csD//3LA//9ywP//csD//3LA//9ywP//csD//3LA//9ywP//csD//3LA//9ywP//csD//3LA//9wvv//cL7//3C+' +
  '//9wvv//cL7//3C+//9wvv//cL7//3C+//9wvv//cL7//3C+//9wvv//cL7//3C+//9wvv//cL7//3C+//9wvv//cL7//3C+//9wvv//cL7//3C+//9wvv//' +
  'cL7//3C+//+Cyff/VWRv/4LN//9wvv//cL7//3C+//9wvv//cL7//3C+//9wvv//cL7//3C+//9wvv//e8f//3aitv9MVV3/RkxT/3Kds/9ywP//cL7//3C+' +
  '//9wvv//cL7//3C+//9wvv//cb7//3K+//9xvv//cL7//3C+//9wvv//cL7//3C+//9wvv//cL7//3C+//9wvv//brz//268//9uvP//brz//268//9uvP//' +
  'brz//268//9uvP//brz//268//9uvP//brz//268//9uvP//brz//268//9uvP//brz//268//9uvP//brz//268//9uvP//brz//268//9uvP//gcj3/1Vk' +
  'b/+Ay///brz//268//9uvP//brz//268//9uvP//brz//268//9uvP//brz//3nF//92obX/TFVd/0ZMU/9ynLP/cL7//268//9uvP//brz//268//9uvP//' +
  'brz//3O8//+Lu/3/drz//268//9uvP//brz//268//9uvP//brz//268//9uvP//brz//2y6//9suv//bLr//2y6//9suv//bLr//2y6//9suv//bLr//2y6' +
  '//9suv//bLr//2y6//9suv//bLr//2y6//9suv//bLr//2y6//9suv//bLr//2y6//9suv//bLr//2y6//9suv//bLr//3/H9/9VZG//fsr//2y6//9suv//' +
  'bLr//2y6//9suv//bLr//2y6//9suv//bLr//2y6//94w///daG1/0xVXf9GTFP/cZyz/268//9suv//bLr//2y6//9suv//bLr//2y6//90uv//lLj7/3i6' +
  '//9suv//bLr//2y6//9suv//bLr//2y6//9suv//bLr//2y6//9quP//arj//2q4//9quP//arj//2q4//9quP//arj//2q4//9quP//arj//2q4//9quP//' +
  'arj//2q4//9quP//arj//2q4//9quP//arj//2q4//9quP//arj//2q4//9quP//arj//2q4//9+xff/VWRv/33I//9quP//arj//2q4//9quP//arj//2q4' +
  '//9quP//arj//2q4//9quP//dsL//3Whtf9MVV3/RkxT/3Gbs/9suv//arj//2q4//9quP//arj//2q4//9quP//crj//5O2+/93uP//arj//2q4//9quP//' +
  'arj//2q4//9quP//arj//2q4//9quP//aLb//2i2//9otv//aLb//2i2//9otv//aLb//2i2//9otv//aLb//2i2//9otv//aLb//2i2//9otv//aLb//2i2' +
  '//9otv//aLb//2i2//9otv//aLb//2i2//9otv//aLb//2i2//9otv//fcT3/1Rkb/98x///aLb//2i2//9otv//aLb//2i2//9otv//aLb//2i2//9otv//' +
  'aLb//3TA//91obX/TFVd/0ZMU/9wm7P/arj//2i2//9otv//aLb//2i2//9otv//aLb//3C2//+RtPv/dbb//2i2//9otv//aLb//2i2//9otv//aLb//2i2' +
  '//9otv//aLb//2a0//9mtP//ZrT//2a0//9mtP//ZrT//2a0//9mtP//ZrT//2a0//9mtP//ZrT//2a0//9mtP//ZrT//2a0//9mtP//ZrT//2a0//9mtP//' +
  'ZrT//2a0//9mtP//ZrT//2a0//9mtP//ZrT//3zD9/9UZG//esb//2a0//9mtP//ZrT//2a0//9mtP//ZrT//2a0//9mtP//ZrT//2a0//9yvv//daG1/0xV' +
  'Xf9GTFP/cJqz/2i2//9mtP//ZrT//2a0//9mtP//ZrT//2a0//9utP//kLP7/3O0//9mtP//ZrT//2a0//9mtP//ZrT//2a0//9mtP//ZrT//2a0//9ksv//' +
  'ZLL//2Sy//9ksv//ZLL//2Sy//9ksv//ZLL//2Sy//9ksv//ZLL//2Sy//9ksv//ZLL//2Sy//9ksv//ZLL//16c2f9ent3/YKXp/16c2f9enNn/XpzZ/16c' +
  '2f9enNn/XpzZ/16c2f92tOH/VGNu/3S15v9enNn/Yanu/2Sy//9ksv//ZLL//2Sy//9ksv//ZLL//2Sy//9ksv//cb3//3Whtf9MVV3/RkxT/26Vq/9ipeb/' +
  'Xp7d/1mMv/9Yibn/WIm5/1iJuf9Yibn/W4m5/2qIuP9cibn/WIm5/2Ot9v9ksv//ZLL//2Sy//9ksv//ZLL//2Sy//9ksv//YrD//2Kw//9isP//YrD//2Kw' +
  '//9isP//YrD//2Kw//9isP//YrD//2Kw//9isP//YrD//2Kw//9isP//YrD//2Kw//9Ufqn/VYOx/1qSzP9Ufqn/VH6p/1R+qf9Ufqn/VH6p/1R+qf9Ufqn/' +
  'cKLE/1RibP9tocX/VH6p/1ya2f9isP//YrD//2Kw//9isP//YrD//2Kw//9isP//YrD//2+7//91obX/TFVd/0ZMU/9skKT/V4Gr/1aFtP9bltL/XJnY/1iM' +
  'wv9Uf6r/VH6p/1R+qf9Vfqn/VH6p/1R+qf9gqvT/YrD//2Kw//9isP//YrD//2Kw//9isP//YrD//2Gv//9hr///Ya///2Gv//9hr///Ya///2Gv//9hr///' +
  'Ya///2Gv//9hr///Ya///2Gv//9hr///Ya///2Gv//9hr///U32p/1SCsf9Zkcz/U32p/1N9qf9Tfan/U32p/1N9qf9Tfan/U32p/3CixP9UYmz/baDF/1N9' +
  'qf9bmdn/Ya///2Gv//9hr///Ya///2Gv//9hr///Ya///2Gv//9uuv//daC1/0xVXf9GTFP/bJCj/1aAq/9Tfan/U32p/1N9qv9XisD/W5jX/1qV0/9Vhbf/' +
  'U32p/1N9qf9Tfan/X6n0/2Gv//9hr///Ya///2Gv//9hr///Ya///2Gv//9frf//X63//1+t//9frf//X63//1+t//9frf//X63//1+t//9frf//X63//1+t' +
  '//9frf//X63//1+t//9frf//X63//1J8qf9TgbH/V5DM/1J8qf9SfKn/Unyp/1J8qf9SfKn/Unyp/1J8qf9vocT/U2Js/2yfxf9SfKn/WZjZ/1+t//9frf//' +
  'X63//1+t//9frf//X63//1+t//9frf//bLn//3Wgtf9MVV3/RkxT/2yQo/9Vf6v/Unyp/1J8qf9SfKn/Unyp/1J8qf9Tf67/V4/L/1mX2P9XkMv/U3+u/12n' +
  '9P9frf//X63//1+t//9frf//X63//1+t//9frf//Xav//12r//9dq///Xav//12r//9dq///Xav//12r//9dq///Xav//12r//9dq///Xav//12r//9dq///' +
  'Xav//12r//9Re6n/UoCx/1aPzP9Re6n/UXup/1F7qf9Re6n/UXup/1F7qf9Re6n/bqHE/1NibP9rn8X/UXup/1iW2f9dq///Xav//12r//9dq///Xav//12r' +
  '//9dq///Xav//2u3//91oLX/TFVd/0ZMU/9rkKP/VH6r/1F7qf9Re6n/UXup/1F7qf9Re6n/UXup/1F7qf9Re6n/U4O2/1eT0/9dqfr/Xav//12r//9dq///' +
  'Xav//12r//9dq///Xav//1yq//9cqv//XKr//1yq//9cqv//XKr//1yq//9cqv//XKr//1yq//9cqv//XKr//1yq//9cqv//XKr//1yq//9cqv//UXup/1J/' +
  'sf9Vjsz/UXup/1F7qf9Re6n/UXup/1F7qf9Re6n/UXup/26hxP9TYWz/a5/F/1F7qf9Xldn/XKr//1yq//9cqv//XKr//1yq//9cqv//XKr//1yq//9qtv//' +
  'daC1/0xVXf9GTFP/a5Cj/1R+q/9Re6n/UXup/1F7qf9Re6n/UXup/1F7qf9Re6n/UXup/1F7qf9Re6n/W6T0/1yq//9cqv//XKr//1yq//9cqv//XKr//1yq' +
  '//9bqf//W6n//1up//9bqf//W6n//1up//9bqf//W6n//1up//9bqf//W6n//1up//9bqf//W6n//1up//9bqf//W6n//1B6qf9Rf7H/VY3M/1B6qf9Qeqn/' +
  'UHqp/1B6qf9Qeqn/UHqp/1B6qf9uoMX/U2Fs/2uexf9Qeqn/VpTZ/1up//9bqf//W6n//1up//9bqf//W6n//1up//9bqf//abX//3Wgtf9MVV3/RkxT/2uP' +
  'o/9Tfav/UHqp/1B6qf9Qeqn/UHqp/1B6qf9Qeqn/UHqp/1B6qf9Qeqn/UHqp/1qj9P9bqf//W6n//1up//9bqf//W6n//1up//9bqf//Waf//1mn//9Zp///' +
  'Waf//1mn//9Zp///Waf//1mn//9Zp///Waf//1mn//9Zp///Waf//1mn//9Zp///Waf//1mn//9Pean/UH2x/1OMzP9Pean/T3mp/095qf9Pean/T3mp/095' +
  'qf9Pean/baDF/1NhbP9qncX/T3mp/1WT2f9Zp///Waf//1mn//9Zp///Waf//1mn//9Zp///Waf//2ez//91oLX/TFVd/0ZMU/9rj6P/Unyr/095qf9Pean/' +
  'T3mp/095qf9Pean/T3mp/095qf9Pean/T3mp/095qf9YofT/Waf//1mn//9Zp///Waf//1mn//9Zp///Waf//1im//9Ypv//WKb//1im//9Ypv//WKb//1im' +
  '//9Ypv//WKb//1im//9Ypv//WKb//1im//9Ypfz/U4/U/1OP1P9Tj9T/T3mp/1B9sf9Ti8z/T3mp/095qf9Pean/T3mp/095qf9Pean/T3mp/22gxf9TYWz/' +
  'ap3F/095qf9Uktn/WKb//1im//9Ypv//WKb//1im//9Ypv//WKb//1im//9ms///daC1/0xVXf9GTFP/a4+j/1J8q/9Pean/T3mp/095qf9Pean/T3mp/095' +
  'qf9Pean/T3mp/095qf9Pean/V6D0/1im//9Ypv//WKb//1im//9Ypv//WKb//1im//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6T8/1OP1P9Tj9T/U4/U/054qf9PfLH/UorM/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9tn8X/U2Fs/2mdxf9OeKn/U5HZ/1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//ZrL//3Wgtf9MVV3/RkxT/2uPo/9Re6v/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/' +
  'Tnip/1af9P9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1ek' +
  '/P9Tj9T/U4/U/1OP1P9OeKn/T3yx/1KKzP9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/bZ/F/1NhbP9pncX/Tnip/1OR2f9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//2ay//91oLX/TFVd/0ZMU/9rj6P/UXur/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9Wn/T/V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9XpPz/U4/U/1OP1P9Tj9T/' +
  'Tnip/098sf9Sisz/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/22fxf9TYWz/aZzF/054qf9Tkdn/V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9msv//daC1/0xVXf9GTFP/a4+j/1F7q/9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Vp/0/1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6T8/1OP1P9Tj9T/U4/U/054qf9PfLH/UorM/054' +
  'qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9tn8X/U2Fs/2mcxf9OeKn/U5HZ/1el//9Xpf//V6X//1el//9Xpf//V6X//1ek/f9Xpf//ZbL//3Wgtf9MVV3/' +
  'RkxT/2uPo/9Re6v/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/1af9P9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1ek/P9Tj9T/U4/U/1OP1P9OeKn/T3yx/1KKzP9OeKn/Tnip/054qf9OeKn/' +
  'Tnip/054qf9OeKn/bZ/E/1NhbP9pnMX/Tnip/1OR2f9Xpf//V6X//1el//9Xpf//VqH3/1KN0f9RiMf/V6X//2Wy//91oLX/TFVd/0ZMU/9rj6P/UXur/054' +
  'qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9Wn/T/V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9XpPz/U4/U/1OP1P9Tj9T/Tnip/098sf9Sisz/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/22f' +
  'xf9TYWz/aZzF/054qf9Tkdn/V6X//1el//9Xpf//V6X//1CDv/9OeKn/UYbE/1el//9lsv//daC1/0xVXf9GTFP/ao+j/1F7q/9OeKn/Tnip/054qf9OeKn/' +
  'Tnip/054qf9OeKn/Tnip/054qf9OeKn/Vp/0/1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6T8/1OP1P9Tj9T/U4/U/054qf9PfLH/UorM/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9tn8X/U2Fs/2mcxf9OeKn/' +
  'U5HZ/1el//9Xpf//V6X//1el//9Qg7//Tnip/1GGxP9Xpf//ZbL//3Wgtf9MVV3/RkxT/2qPo/9Re6v/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054' +
  'qf9OeKn/Tnip/1af9P9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//VqD1/1af9P9Wn/T/Vp/0/1af9P9WoPb/' +
  'V6X//1ek/P9Tj9T/U4/U/1OP1P9OeKn/T3yx/1KKzP9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/bZ/F/1NhbP9pnMX/Tnip/1OR2f9Xpf//V6X//1el' +
  '//9Xpf//UIO//054qf9RhsT/V6X//2Wy//91oLX/TFVd/0ZMU/9qjqP/UXur/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9Wn/T/' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//097rv9OeKn/Tnip/054qf9OeKn/UIC5/1el//9XpPz/U4/U/1OP' +
  '1P9Tj9T/Tnip/098sf9Sisz/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/22fxf9TYWz/aZ3F/054qf9SjdD/Vp3v/1ad7/9Wne//Vp3v/1CBu/9OeKn/' +
  'UYbE/1el//9lsv//daC1/0xVXf9GTFP/ao6j/1F7q/9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Vp/0/1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Tkdj/U5DW/1OQ1v9TkNb/U5DW/1ST3v9Xpf//V6T8/1OP1P9Tj9T/U4/U/054qf9PfLH/' +
  'UorM/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9tn8X/U2Fs/2mcxf9OeKn/UYXB/1OP1P9Tj9T/U4/U/1OP1P9PfrT/Tnip/1GGxP9Xpf//ZbL//3Wg' +
  'tf9MVV3/RkxT/2qOo/9Re6v/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/1af9P9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//T3uu/054qf9OeKn/Tnip/054qf9QgLn/V6X//1ek/P9Tj9T/U4/U/1OP1P9OeKn/T3yx/1KKzP9OeKn/Tnip/054' +
  'qf9OeKn/Tnip/054qf9OeKn/baDF/1NhbP9pnMX/Tnip/1GFwf9Tj9T/U4/U/1OP1P9Tj9T/T360/054qf9RhsT/V6X//2Wy//91oLX/TFVd/0ZMU/9qjqP/' +
  'UXur/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9Wn/T/V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//097rv9OeKn/Tnip/054qf9OeKn/UIC5/1el//9XpPz/U4/U/1OP1P9Tj9T/Tnip/098sf9Sisz/Tnip/054qf9OeKn/Tnip/054qf9OeKn/' +
  'Tnip/22gxf9TYWz/aZ3F/054qf9RhcH/U4/U/1OP1P9Tj9T/U4/U/09+tP9OeKn/UYbE/1el//9lsv//daG1/0xVXf9GTFP/ao+j/1F7q/9OeKn/Tnip/054' +
  'qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Vp/0/1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Pe67/' +
  'Tnip/054qf9OeKn/Tnip/1CAuf9Xpf//V6T8/1OP1P9Tj9T/U4/U/054qf9PfLH/UorM/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9toMX/U2Js/2qd' +
  'xf9OeKn/UYXB/1OP1P9Tj9T/U4/U/1OP1P9PfrT/Tnip/1GGxP9Xpf//ZrL//3Witv9MVV3/RkxT/2uPo/9Re6z/Tnip/054qf9OeKn/Tnip/054qf9OeKn/' +
  'Tnip/054qf9OeKn/Tnip/1af9P9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//T3uu/054qf9OeKn/Tnip/054' +
  'qf9QgLn/V6X//1ek/P9Tj9T/U4/U/1OP1P9OeKn/T3yx/1KKzP9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/bqHG/1Ribf9qnsb/Tnip/1GFwf9Tj9T/' +
  'U4/U/1OP1P9Tj9T/T360/054qf9RhsT/V6X//2ay//92orf/TFVd/0ZMU/9rkKT/UXys/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054' +
  'qf9Wn/T/V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//097rv9OeKn/Tnip/054qf9OeKn/UIC5/1el//9XpPz/' +
  'U4/U/1OP1P9Tj9T/Tnip/098sf9Sisz/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/26hxv9UYm3/ap7G/054qf9RhcH/U4/U/1OP1P9Tj9T/U4/U/09+' +
  'tP9OeKn/UYbE/1el//9msv//dqO4/0xVXf9GTFP/a5Ck/1F8rP9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Vp/0/1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Pe67/Tnip/054qf9OeKn/Tnip/1CAuf9Xpf//V6T8/1OP1P9Tj9T/U4/U/054' +
  'qf9PfLH/UorM/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9uocb/VGJt/2qexv9OeKn/UYXB/1OP1P9Tj9T/U4/U/1OP1P9PfrT/Tnip/1GGxP9Xpf//' +
  'ZrL//3ait/9MVV3/RkxT/2uPo/9RfKz/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/1af9P9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//T3uu/054qf9OeKn/Tnip/054qf9QgLn/V6X//1ek/P9Tj9T/U4/U/1OP1P9OeKn/T3yx/1KKzP9OeKn/' +
  'Tnip/054qf9OeKn/Tnip/054qf9OeKn/baDF/1Nha/9pncX/Tnip/1GFwf9Tj9T/U4/U/1OP1P9Tj9T/T360/054qf9RhsT/V6X//2Wy//91obX/TFVd/0ZM' +
  'U/9qjqL/UXur/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9Wn/T/V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//097rv9OeKn/Tnip/054qf9OeKn/UIC5/1el//9XpPz/U4/U/1OP1P9Tj9T/Tnip/098sf9Sisz/Tnip/054qf9OeKn/Tnip/054' +
  'qf9OeKn/Tnip/22gxf9TYWv/aZzF/054qf9RhcH/U4/U/1OP1P9Tj9T/U4/U/09+tP9OeKn/UYbE/1el//9lsv//daC1/0xVXf9GTFP/ao6i/1F7q/9OeKn/' +
  'Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Vp/0/1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Pe67/Tnip/054qf9OeKn/Tnip/1CAuf9Xpf//V6T8/1OP1P9Tj9T/U4/U/054qf9PfLH/UorM/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9toMX/' +
  'U2Fr/2mcxf9OeKn/UYXB/1OP1P9Tj9T/U4/U/1OP1P9PfrT/Tnip/1GGxP9Xpf//ZbL//3Wgtf9MVV3/RkxT/2qOov9Re6v/Tnip/054qf9OeKn/Tnip/054' +
  'qf9OeKn/Tnip/054qf9OeKn/Tnip/1af9P9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//TXOe/01znv9Nc57/TXOe/01znv9Nc57/SmF7/0pfef9KX3n/' +
  'Sl95/0pfef9KY4D/TXOe/01znf9MaYv/TGmL/0xpi/9KX3n/SmF8/0tniP9KX3n/Sl95/0pfef9KX3n/Sl95/0pfef9KX3n/VnCF/0tXYv9VboX/Sl95/0tl' +
  'g/9MaYv/TGmL/0xpi/9MaYv/SmJ9/0pfef9LZYT/TXOe/1N4n/9ac4T/SVVh/0dRXP9VaXj/S2F6/0pfef9KX3n/Sl95/0pfef9KX3n/Sl95/0pfef9KX3n/' +
  'Sl95/0pfef9NcJn/TXOe/01znv9Nc57/TXOe/01znv9Nc57/TXOe/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4jW//+I1v//iNb//4jW//+I1v//iNb//4jW//+I1v//iNb//4jW//+I1v//iNb//4jW//+I1v//iNb//4jW//+I1v//iNb//4jW//+I1v//' +
  'iNb//4jW//+I1v//iNb//4jW//+I1v//iNb//4jW//+I1v//iNb//4jW//+I1v//iNb//4jW//+I1v//iNb//4jW//+I1v//iNb//4jW//+I1v//iNb//4jW' +
  '//+I1v//iNb//4jW//+I1v//iNb//4jW//+I1v//iNb//4jW//+I1v//iNb//4jW//+I1v//iNb//4jW//+I1v//iNb//4jW//+I1v//iNb//4jW//+H1f//' +
  'h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV' +
  '//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//' +
  'h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//htT//4bU//+G1P//htT//4bU' +
  '//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//' +
  'htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU' +
  '//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///' +
  'hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT' +
  '//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///' +
  'hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR' +
  '//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//' +
  'g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR' +
  '//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//' +
  'gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+R2v//jdj//4XS//+C0P//gtD//4LQ//+C0P//gtD//4LQ' +
  '//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//' +
  'gtD//4LQ//+C0P//gtD//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO' +
  '//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Bz///grnS/2eHmP96p73/jdHz/4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//' +
  'gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO' +
  '//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//' +
  'fsz//37M//9+zP//fsz//37M//9+zP//gM3//3qnvP9acX3/Y4CP/4C0y/+Czv//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M' +
  '//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fMr//3zK//98yv//' +
  'fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK' +
  '//98yv//fMr//37L//9znbH/RkxT/0ZMU/9tkaP/gs7//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//' +
  'fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3rI//96yP//esj//3rI//96yP//esj//3rI' +
  '//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//3rI//98yf//' +
  'c5yx/0ZMU/9GTFP/bJGj/4DM//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//3rI' +
  '//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//3rI//94xv//eMb//3jG//94xv//eMb//3jG//94xv//eMb//3jG//94xv//' +
  'eMb//3jG//94xv//eMb//3jG//94xv//eMb//3jG//94xv//eMb//3jG//94xv//eMb//3jG//94xv//eMb//3jG//94xv//esf//3Kcsf9GTFP/RkxT/2yR' +
  'o/9+yv//eMb//3jG//94xv//eMb//3jG//94xv//eMb//3jG//94xv//eMb//3jG//94xv//eMb//3jG//94xv//eMb//3jG//94xv//eMb//3jG//94xv//' +
  'eMb//3jG//94xv//eMb//3jG//94xv//eMb//3jG//94xv//dsT//3bE//92xP//dsT//3bE//92xP//dsT//3bE//92xP//dsT//3bE//92xP//dsT//3bE' +
  '//92xP//dsT//3bE//92xP//dsT//3bE//92xP//dsT//3bE//92xP//dsT//3bE//92xP//dsT//3jF//9ynLH/RkxT/0ZMU/9skKP/fMj//3bE//92xP//' +
  'dsT//3bE//92xP//dsT//3bE//92xP//dsT//3bE//92xP//dsT//3bE//92xP//dsT//3bE//92xP//dsT//3bE//92xP//dsT//3bE//92xP//dsT//3bE' +
  '//92xP//dsT//3bE//92xP//dsT//3TC//90wv//dML//3TC//90wv//dML//3TC//90wv//dML//3TC//90wv//dML//3TC//90wv//dML//3TC//90wv//' +
  'dML//3TC//90wv//dML//3TC//90wv//dML//3TC//90wv//dML//3TC//92w///cZux/0ZMU/9GTFP/a5Cj/3rG//90wv//dML//3TC//90wv//dML//3TC' +
  '//90wv//dML//3TC//90wv//dML//3TC//90wv//dML//3TC//90wv//dML//3TC//90wv//dML//3TC//90wv//dML//3TC//90wv//dML//3TC//90wv//' +
  'dML//3TC//9ywP//csD//3LA//9ywP//csD//3LA//9ywP//csD//3LA//9ywP//csD//3LA//9ywf//csH//3LC//9ywv//csH//3LA//9ywP//csD//3LA' +
  '//9ywP//csD//3LA//9ywP//csD//3LA//9ywP//dML//3Gbsf9GTFP/RkxT/2uQo/94xP//csD//3LA//9ywP//csD//3LA//9ywP//csD//3LA//9ywP//' +
  'c8H//4PL+P+Dyvf/fcn//3LA//9ywP//csD//3LA//9ywP//csD//3LA//9ywP//csD//3LA//9ywP//csD//3LA//9ywP//csD//3LA//9ywP//cL7//3C+' +
  '//9wvv//cL7//3C+//9wvv//cL7//3C+//9wvv//cL7//3C///9wxP//c87//3XT//911P//ddP//3TQ//9xyP//cMD//3C+//9wvv//cL7//3C+//9wvv//' +
  'cL7//3C+//9wvv//cL7//3LA//9xmrH/RkxT/0ZMU/9rj6P/dsL//3C+//9wvv//cL7//3C+//9wvv//cL7//3C+//9wvv//cL7//3PA//9+ssv/aoub/4TE' +
  '6f9wvv//cL7//3C+//9wvv//cL7//3C+//9wvv//cL7//3C+//9wvv//cL7//3C+//9wvv//cL7//3C+//9wvv//cL7//268//9uvP//brz//268//9uvP//' +
  'brz//268//9uvP//brz//268//9vwv//dNX//3HM//95zP//gMjw/4HQ+v90zf//dNT//3DJ//9uvP//brz//268//9uvP//brz//268//9uvP//brz//268' +
  '//9wvv//cJqx/0ZMU/9GTFP/a4+j/3TB//9uvP//brz//268//9uvP//brz//268//9uvP//brz//268//9xvv//bpSo/0hOVf99uNz/brz//268//9uvP//' +
  'brz//268//9uvP//brz//268//9uvP//brz//268//9uvP//brz//268//9uvP//brz//268//9suv//bLr//2y6//9suv//bLr//2y6//9suv//bLr//2y6' +
  '//9suv//bcD//3PU//9vy///gNH//1NfaP9wlqn/f9P//3PT//9vyP//bLr//2y6//9suv//bLr//2y6//9suv//bLr//2y6//9suv//brz//3Casf9GTFP/' +
  'RkxT/2qPo/9yv///bLr//2y6//9suv//bLr//2y6//9suv//bLr//2y6//9suv//cL3//2uPov9HTVT/fLfc/2y6//9suv//bLr//2y6//9suv//bLr//2y6' +
  '//9suv//bLr//2y6//9suv//bLr//2y6//9suv//bLr//2y6//9suv//arj//2q4//9quP//arj//2q4//9quP//arj//2q4//9quP//arj//2q4//9qv///' +
  'bsn//4HY//9QXmf/aYmY/4HR+P9rwv//arr//2q4//9quP//arj//2q4//9quP//arj//2q4//9quP//arj//2y6//9vmbH/RkxT/0ZMU/9qj6P/cL3//2q4' +
  '//9quP//arj//2q4//9quP//arj//2q4//9quP//arj//2+7//9qjJ3/R01U/3u33P9quP//arj//2q4//9quP//arj//2q4//9quP//arj//2q4//9quP//' +
  'abb8/2q4//9quP//arj//2q4//9quP//arj//2i2//9otv//aLb//2i2//9otv//aLb//2i2//9otv//aLb//2i2//9otv//aLb//2i3//98yP//UF1o/2eG' +
  'lv9+we7/aLb//2i2//9otv//aLb//2i2//9otv//aLb//2i2//9otv//aLb//2i2//9quP//b5mx/0ZMU/9GTFP/ao+j/2+7//9otv//aLb//2i2//9otv//' +
  'aLb//2i2//9dk8f/WYi0/1mItP9fjrj/ZoWU/0dNVP97ttz/aLb//2i2//9otv//aLb//2i2//9otv//aLb//2i2//9otv//Z7L5/1uOvv9otv//aLb//2i2' +
  '//9otv//aLb//2i2//9mtP//ZrT//2a0//9mtP//ZrT//2a0//9mtP//ZrT//2a0//9mtP//ZrT//2a0//9mtP//esb//1BdaP9mhZX/fcDv/2a0//9mtP//' +
  'ZrT//2a0//9mtP//ZrT//2a0//9mtP//ZrT//2a0//9mtP//abb//2+Zsf9GTFP/RkxT/2qOo/9tuf//ZrT//2a0//9mtP//ZrT//2a0//9mtP//Wo7B/1aC' +
  'rP9Wgqz/XIix/2WDk/9HTVT/erXc/2a0//9mtP//ZrT//2a0//9mtP//ZrT//2a0//9mtP//ZK71/1mJuP9WgKn/ZrT//2a0//9mtP//ZrT//2a0//9mtP//' +
  'ZLL//2Sy//9ksv//ZLL//2Sy//9ksv//ZLL//2Sy//9ksv//ZLL//2Sy//9ksv//ZLL//3nE//9QXWj/ZoWV/3y/7/9ksv//ZLL//2Sy//9ksv//ZLL//2Sy' +
  '//9ksv//ZLL//2Sy//9ksv//ZLL//2e0//9umbH/RkxT/0ZMU/9pjqP/a7f//2Sy//9ksv//ZLL//2Sy//9ksv//ZLL//16e3f9cl9L/XJfS/2Kd1P9mhpf/' +
  'R01U/3m03P9ksv//ZLL//2Sy//9ksv//ZLL//2Sy//9ksv//Yanw/1eEsv9Vf6n/VX+p/2Sy//9ksv//ZLL//2Sy//9ksv//ZLL//2Kw//9isP//YrD//2Kw' +
  '//9isP//YrD//2Kw//9isP//YrD//2Kw//9isP//YrD//2Kw//94w///UF1o/2aFlf96vu//YrD//2Kw//9isP//YrD//2Kw//9isP//YrD//2Kw//9isP//' +
  'YrD//2Kw//9lsv//bpix/0ZMU/9GTFP/aY6j/2m2//9isP//YrD//2Kw//9isP//YrD//2Kw//9Yi7//VH6p/1R+qf9aha7/ZYOT/0dNVP96tN3/YrD//2Kw' +
  '//9isP//YrD//2Kw//9isP//X6Pp/1WBrv9Ufqn/VH6p/1R+qf9isP//YrD//2Kw//9isP//YrD//2Kw//9hr///Ya///2Gv//9hr///Ya///2Gv//9hr///' +
  'Ya///2Gv//9hr///Ya///2Gv//9hr///d8L//1BdaP9nhpX/er3v/2Gv//9hr///Ya///2Gv//9hr///Ya///2Gv//9hr///Ya///2Gv//9hr///ZLH//26Y' +
  'sf9GTFP/RkxT/2mOo/9otf//Ya///2Gv//9hr///Ya///2Gv//9hr///V4q//1N9qf9Tfan/WYSu/2WEk/9HTVX/erTd/2Gv//9hr///Ya///2Gv//9hr///' +
  'XJ7h/1N+q/9Tfan/U32p/1N9qf9Tfan/Ya///2Gv//9hr///Ya///2Gv//9hr///X63//1+t//9frf//X63//1+t//9frf//X63//1+t//9frf//X63//1+t' +
  '//9frf//X63//3bB//9QXWj/Z4eX/3m97/9frf//X63//1+t//9frf//X63//1+t//9frf//X63//1+t//9frf//X63//2Kv//9umLH/RkxT/0ZMU/9pjqP/' +
  'Z7P//1+t//9frf//X63//1+t//9frf//X63//1WIv/9SfKn/Unyp/1iDrv9lg5P/R01V/3mz3f9frf//X63//1+t//9frf//Xqj2/1J8qv9SfKn/Unyp/1J8' +
  'qf9SfKn/Unyp/1+t//9frf//X63//1+t//9frf//X63//12r//9dq///Xav//12r//9dq///Xav//12r//9dq///Xav//12r//9dq///Xav//12r//91wP//' +
  'UF1o/2eHmP94vO//Xav//12r//9dq///Xav//12r//9dq///Xav//12r//9dq///Xav//12r//9grf//bZix/0ZMU/9GTFP/aY6j/2Wx//9dq///Xav//12r' +
  '//9dq///Xav//12r//9Uh7//UXup/1F7qf9Xgq7/ZYOT/0dNVP92st3/Xav//12r//9dq///Xav//1yl9P9Re6n/UXup/1F7qf9Re6n/UXup/1F7qf9dq///' +
  'Xav//12r//9dq///Xav//12r//9cqv//XKr//1yq//9cqv//XKr//1yq//9cqv//XKr//1yq//9cqv//XKr//1yq//9cqv//dL///1BdaP9nh5f/eLvv/1yq' +
  '//9cqv//XKr//1yq//9cqv//XKr//1yq//9cqv//XKr//1yq//9cqv//X6z//22Xsf9GTFP/RkxT/2mOo/9ksP//XKr//1yq//9cqv//XKr//1yq//9cqv//' +
  'VIe//1F7qf9Re6n/V4Ku/2WDk/9HTVT/dbHc/1yq//9cqv//XKr//1yq//9bpPT/UXup/1F7qf9Re6n/UXup/1F7qf9Re6n/XKr//1yq//9cqv//XKr//1yq' +
  '//9cqv//Wqj//1qo//9aqP//Wqj//1qo//9aqP//Wqj//1qo//9aqP//Wqj//1qo//9aqP//Wqj//3K+//9QXWj/Z4eW/3a67/9aqP//Wqj//1qo//9aqP//' +
  'WaDw/1KBtf9Rfa7/UX2u/1F9rv9Rfa7/UX2u/1SBsf9rj6P/RkxT/0ZMU/9nh5r/Woe2/1F9rv9Rfa7/WJ7r/1qo//9aqP//Wqj//1OGv/9Qeqn/UHqp/1aB' +
  'rv9kg5P/R01U/3Sw3P9aqP//Wqj//1qo//9aqP//WaL0/1B6qf9Qeqn/UHqp/1B6qf9Qeqn/UHqp/1qo//9aqP//Wqj//1qo//9aqP//Wqj//1mn//9Zp///' +
  'Waf//1mn//9Zp///Waf//1mn//9Zp///Waf//1mn//9Zp///Waf//1mn//9xvf//UF1o/2eGlv92ue//Waf//1mn//9Zp///V5zq/1B8r/9Rg7v/VZLW/1WS' +
  '1v9Vktb/VZLW/1WS1v9Yldf/bJOq/0ZMU/9GTFP/aIqe/12a2v9Vktb/VZLW/1ii9f9Zp///Waf//1mn//9Shb//T3mp/095qf9VgK//ZIKT/0dNVP90sNz/' +
  'Waf//1mn//9Zp///Waf//1ih9P9Pean/T3mp/095qf9Pean/T3mp/095qf9Zp///Waf//1mn//9Zp///Waf//1mn//9Ypv//WKb//1im//9Ypv//WKb//1im' +
  '//9Ypv//WKb//1im//9Ypv//WKb//1im//9Ypv//cLz//09daP9mhZX/dbju/1im//9Ypv//V6L2/096q/9Pean/T3mp/095qf9Pean/T3mp/095qf9Pean/' +
  'Un2s/2qOov9GTFP/RkxT/2eHmf9YhLH/T3mp/095qf9Wm+r/WKb//1im//9Ypv//UYS//095qf9Pean/VYCv/2SDk/9HTVT/c6/c/1im//9Ypv//WKb//1im' +
  '//9XoPT/T3mp/095qf9Pean/T3mp/095qf9Pean/WKb//1im//9Ypv//WKb//1im//9Ypv//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//3C7//9PXGj/ZoSU/3S47v9Xpf//V6X//1af9P9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/1F8rP9qjqL/RkxT/0ZM' +
  'U/9nh5n/V4Ox/054qf9OeKn/VZrq/1el//9Xpf//V6X//1CDv/9OeKn/Tnip/1SAr/9kg5P/R01U/3Ov3P9Xpf//V6X//1el//9Xpf//Vp/0/054qf9OeKn/' +
  'Tnip/054qf9OeKn/Tnip/1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9wu///T1xo/2aElP90uO7/V6X//1el//9Wn/T/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9RfKz/ao6i/0ZMU/9GTFP/Z4eZ/1eDsf9OeKn/' +
  'Tnip/1Wa6v9Xpf//V6X//1el//9Qg7//Tnip/054qf9UgK//ZIOT/0dNVP9zr9z/V6X//1el//9Xpf//V6X//1af9P9OeKn/Tnip/054qf9OeKn/Tnip/054' +
  'qf9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9WnfD/VZvs/1Wb7P9Vm+z/V6L4/1el//9Xpf//V6X//1el//9Xpf//cLv//09daP9mhJT/' +
  'dLju/1el//9Xpf//Vp/0/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/UXys/2qOov9GTFP/RkxT/2eHmf9Xg7H/Tnip/054qf9Vmur/V6X//1el' +
  '//9Xpf//UIO//054qf9OeKn/VICv/2SDk/9HTVT/cqzW/1ad7/9Wne//V6L5/1el//9Wn/T/Tnip/054qf9OeKn/Tnip/054qf9OeKn/V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//VJPc/1OP1P9Tj9T/U4/U/1ad7/9Xpf//V6X//1el//9Xpf//V6X//3C7//9PXWj/ZoST/3S47v9Xpf//V6X//1af' +
  '9P9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/1F8rP9qjqL/RkxT/0ZMU/9mh5n/V4Ox/054qf9OeKn/VZrq/1el//9Xpf//V6X//1CDv/9OeKn/' +
  'Tnip/1SAr/9kg5P/R01U/3Gmy/9Tj9T/U4/U/1ad7/9Xpf//Vp/0/054qf9OeKn/Tnip/054qf9OeKn/Tnip/1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1ST3P9Tj9T/U4/U/1OP1P9Wne//V6X//1el//9Xpf//V6X//1el//9wu///T11o/2aEk/90uO7/V6X//1el//9Wn/T/Tnip/054qf9OeKn/' +
  'Tnip/054qf9OeKn/Tnip/054qf9RfKz/ao2i/0ZMU/9GTFP/ZoeY/1eDsf9OeKn/Tnip/1Wa6v9Xpf//V6X//1el//9Qg7//Tnip/054qf9UgK//ZIOT/0dN' +
  'VP9xpsv/U4/U/1OP1P9Wne//V6X//1af9P9OeKn/Tnip/054qf9OeKn/Tnip/054qf9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Uk9z/' +
  'U4/U/1OP1P9Tj9T/Vp3v/1el//9Xpf//V6X//1el//9Xpf//cLv//09daP9lhJP/dLju/1el//9Xpf//Vp/0/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054' +
  'qf9OeKn/UXys/2qNov9GTFP/RkxT/2aHmP9Xg7H/Tnip/054qf9Vmur/V6X//1el//9Xpf//UIO//054qf9OeKn/VICv/2SDk/9HTVT/cabL/1OP1P9Tj9T/' +
  'Vp3v/1el//9Wn/T/Tnip/054qf9OeKn/Tnip/054qf9OeKn/V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//VJPc/1OP1P9Tj9T/U4/U/1ad' +
  '7/9Xpf//V6X//1el//9Xpf//V6X//3C7//9PXWj/ZYOT/3S47v9Xpf//V6X//1af9P9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/1F8rP9pjaH/' +
  'RkxT/0ZMU/9mhpj/V4Ox/054qf9OeKn/VZrq/1el//9Xpf//V6X//1CDv/9OeKn/Tnip/1WAr/9kg5P/R01U/3Gmy/9Tj9T/U4/U/1ad7/9Xpf//Vp/0/054' +
  'qf9OeKn/Tnip/054qf9OeKn/Tnip/1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1ST3P9Tj9T/U4/U/1OP1P9Wne//V6X//1el//9Xpf//' +
  'V6X//1el//9wu///T11o/2WDk/91uO7/V6X//1el//9Wn/T/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9RfKz/aY2h/0ZMU/9GTFP/ZoaY/1eC' +
  'sf9OeKn/Tnip/1Wa6v9Xpf//V6X//1el//9Qg7//Tnip/054qf9VgK//ZIOT/0dNVP9xpsv/U4/U/1OP1P9Wne//V6X//1af9P9OeKn/Tnip/054qf9OeKn/' +
  'Tnip/054qf9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Uk9z/U4/U/1OP1P9Tj9T/Vp3v/1el//9Xpf//V6X//1el//9Xpf//cLv//09d' +
  'aP9lg5P/dbju/1el//9Xpf//Vp/0/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/UXys/2mNof9GTFP/RkxT/2WFl/9WgrH/Tnip/054qf9Vmur/' +
  'V6X//1el//9Xpf//UIO//054qf9OeKn/VYCv/2SDk/9HTVT/cabL/1OP1P9Tj9T/Vp3v/1el//9Wn/T/Tnip/054qf9OeKn/Tnip/054qf9OeKn/V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//VJPc/1OP1P9Tj9T/U4/U/1ad7/9Xpf//V6X//1el//9Xpf//V6X//3C7//9QXWj/ZYOT/3W47v9Xpf//' +
  'V6X//1af9P9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/1F8rP9pjKH/RkxT/0ZMU/9lhZf/VoKx/054qf9OeKn/VZrq/1el//9Xpf//V6X//1CD' +
  'v/9OeKn/Tnip/1WAr/9kg5P/R01U/3Gmy/9Tj9T/U4/U/1ad7/9Xpf//Vp/0/054qf9OeKn/Tnip/054qf9OeKn/Tnip/1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1ST3P9Tj9T/U4/U/1OP1P9Wne//V6X//1el//9Xpf//V6X//1el//9wvP//UF1o/2WDk/91ue7/V6X//1el//9Wn/T/Tnip/054' +
  'qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9RfKz/aYyh/0ZMU/9GTFP/ZYWX/1aCsf9OeKn/Tnip/1OO0/9UluH/VJbh/1SW4f9PgLf/Tnip/054qf9VgK//' +
  'ZIOT/0dNVP9xpsv/U4/U/1OP1P9Wne//V6X//1af9P9OeKn/Tnip/054qf9OeKn/Tnip/054qf9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Uk9z/U4/U/1OP1P9Tj9T/Vp3v/1el//9Xpf//V6X//1el//9Xpf//cLz//1BdaP9lhJP/drnv/1el//9Xpf//Vp/0/054qf9OeKn/Tnip/054qf9OeKn/' +
  'Tnip/054qf9OeKn/UXys/2mMof9GTFP/RkxT/2WFl/9WgrH/Tnip/054qf9Sicn/U4/U/1OP1P9Tj9T/T360/054qf9OeKn/VYCv/2SDk/9HTVT/cabL/1OP' +
  '1P9Tj9T/Vp3v/1el//9Wn/T/Tnip/054qf9OeKn/Tnip/054qf9OeKn/V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//VJPc/1OP1P9Sisr/' +
  'UonJ/1SU3v9Vmur/VZrq/1ag9P9Vne//V6X//3C8//9QXWj/ZYST/3a67/9Xpf//V6X//1af9P9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/1F8' +
  'rP9pjKH/RkxT/0ZMU/9lhZf/VoKx/054qf9OeKn/UonJ/1OP1P9Tj9T/U4/U/09+tP9OeKn/Tnip/1WAr/9lg5P/R01U/3Gmy/9Tj9T/U4/U/1ad7/9Xpf//' +
  'Vp/0/054qf9OeKn/Tnip/054qf9OeKn/Tnip/1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1ST3P9Tj9T/Tnms/054qf9OeKn/Tnip/054' +
  'qf9Tj9T/UIO//1el//9wvP//UF1o/2WEk/92uu//V6X//1el//9Wn/T/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9RfKz/aYyh/0ZMU/9GTFP/' +
  'ZYWX/1aCsf9OeKn/Tnip/1KJyf9Tj9T/U4/U/1OP1P9PfrT/Tnip/054qf9VgK//ZYOT/0dNVP9ypsz/U4/U/1OP1P9Wne//V6X//1af9P9OeKn/Tnip/054' +
  'qf9OeKn/Tnip/054qf9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Uk9z/U4/U/055rP9OeKn/Tnip/054qf9OeKn/U4/U/1CDv/9Xpf//' +
  'cLz//1BdaP9lhJP/drrv/1el//9Xpf//Vp/0/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/UXys/2mMof9GTFP/RkxT/2WFl/9WgrH/Tnip/054' +
  'qf9Sicn/U4/U/1OP1P9Tj9T/T360/054qf9OeKn/VYCv/2WElP9HTVX/cqfM/1OP1P9Tj9T/Vp3v/1el//9Wn/T/Tnip/054qf9OeKn/Tnip/054qf9OeKn/' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//VJPc/1OP1P9Oeaz/Tnip/054qf9OeKn/Tnip/1OP1P9Qg7//V6X//3C7//9QXWj/ZYOS/3a5' +
  '7v9Xpf//V6X//1af9P9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/1F8rP9pjKH/RkxT/0ZMU/9lhZf/VoKx/054qf9OeKn/UonJ/1OP1P9Tj9T/' +
  'U4/U/09+tP9OeKn/Tnip/1WAr/9lhJT/R01V/3KnzP9Tj9T/U4/U/1ad7/9Xpf//Vp/0/054qf9OeKn/Tnip/054qf9OeKn/Tnip/1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1ST3P9Tj9T/Tnms/054qf9OeKn/Tnip/054qf9Tj9T/UIO//1el//9vu///T11o/2WCkf92ue7/V6X//1el//9Wn/T/' +
  'Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9RfKz/aYyh/0ZMU/9GTFP/ZYWX/1aCsf9OeKn/Tnip/1KJyf9Tj9T/U4/U/1OP1P9PfrT/Tnip/054' +
  'qf9VgK//ZYOT/0dNVP9yp8z/U4/U/1OP1P9Wne//V6X//1af9P9OeKn/Tnip/054qf9OeKn/Tnip/054qf9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Uk9z/U4/U/055rP9OeKn/Tnip/054qf9OeKn/U4/U/1CDv/9Xpf//b7v//09daP9lgpH/drnu/1el//9Xpf//Vp/0/054qf9OeKn/Tnip/054' +
  'qf9OeKn/Tnip/054qf9OeKn/UXys/2mMof9GTFP/RkxT/2WFl/9WgrH/Tnip/054qf9Sicn/U4/U/1OP1P9Tj9T/T360/054qf9OeKn/VYCv/2WDk/9HTVT/' +
  'cabL/1OP1P9Tj9T/Vp3v/1el//9Wn/T/Tnip/054qf9OeKn/Tnip/054qf9OeKn/V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//VJPc/1OP' +
  '1P9Oeaz/Tnip/054qf9OeKn/Tnip/1OP1P9Qg7//V6X//2+7//9PXWj/ZYKR/3a57v9Xpf//V6X//1af9P9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/' +
  'Tnip/1F8rP9pjKH/RkxT/0ZMU/9lhZf/VoKx/054qf9OeKn/UonJ/1OP1P9Tj9T/U4/U/09+tP9OeKn/Tnip/1WAr/9lg5P/R01U/3Gmy/9Tj9T/U4/U/1ad' +
  '7/9Xpf//Vp/0/054qf9OeKn/Tnip/054qf9OeKn/Tnip/1el//9Xpf//V6X//1el//9Xpf//V6X//01znv9Nc57/TXOe/0xrj/9MaYv/SmB6/0pfef9KX3n/' +
  'Sl95/0pfef9MaYv/SmSC/01znv9Zf6H/SlNc/1RlcP9bfJf/TXOe/01znv9NcJn/Sl95/0pfef9KX3n/Sl95/0pfef9KX3n/Sl95/0pfef9LYXr/Vmp3/0ZM' +
  'U/9GTFP/VGZx/01kff9KX3n/Sl95/0tnh/9MaYv/TGmL/0xpi/9KYn3/Sl95/0pfef9NY3z/VGVw/0ZNVP9adYr/TGmL/0xpi/9Nb5f/TXOe/01wmf9KX3n/' +
  'Sl95/0pfef9KX3n/Sl95/0pfef9Nc57/TXOe/01znv9Nc57/TXOe/01znv9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4rX//+K1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4zY//+i4P//q+P//47Z//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4zY//+h3///' +
  '4fX//+v4//+j4P//i9j//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4vY//+e3v//0/D//9jy///I7P//zu7//5fc' +
  '//+K1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4vY//+d3v//0O///7Ll///P7///o+D//7jn//++6f//kdr//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4vY//+b3f//zu7//6vj//+f3v//zO7//5Xb//+V2///yu3//6vj//+M2P//idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4rX//+M2P//i9j//4rX//+K1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4rX//+a3f//ze7//67j//+P2f//peH//8Tr//+P2f//itf//57e///R7///nN7//4rX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//47Z//+e3v//s+X//7Dk//+n4f//nd7//5nd//+X3P//ldv//5La' +
  '//+O2f//itf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+Q2f//' +
  'xuz//7Pl//+P2f//jdj//7zo//+v5P//i9j//4nX//+N2P//ruT//8Xr//+P2f//idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///i9j//5Tb//+x5P//tOb//5zd//+d3v//puH//6/k//+z5f//tOb//7Xm//+25v//tuf//5fc//+L2P//' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///k9v//8vt//+c3f//idf//5La' +
  '///L7f//n97//4nX//+J1///idf//5rd///L7f//ldv//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///jtn//6Pg//++6f//puH//5Ha//+L2P//itf//4rX//+L2P//jNj//43Z//+P2f//kdr//53e//+86P//nd7//4zY//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//5La///K7f//nd7//4nX//+Z3P//zO7//5bb//+J1///' +
  'idf//4nX//+W2///yu3//5fc//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//5ze' +
  '///d8///xOv//7bm//+v5P//pOD//5vd//+Y3P//ldv//5Pb//+R2v//j9n//47Z//+O2f//mNz//7nn//+m4f//j9n//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+Q2f//yO3//6Df//+K1///pOD//8fs//+P2f//idf//4nX//+J1///lNv//8rt' +
  '//+Z3f//idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+R2v//teb//7zo//+h3///' +
  'n97//6ni//+x5f//tOX//7Xm//+25v//tub//7bm//+15v//tOX//7Hk//+v5P//xOv//7Xm//+P2f//idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///jtn//8Xs//+k4P//jdj//7ro//+z5f//i9j//4nX//+J1///idf//5La///J7f//nN3//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4/Z//+p4v//teb//5bb//+P2f//jdj//43Y' +
  '//+O2f//kNn//5La//+U2///ltz//5nc//+e3v//r+T//83u///O7v//ktr//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//43Y//+/6f//quL//5La///J7f//oN///4nX//+J1///idf//4nX//+R2v//ye3//57e//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///jdn//6Lg//+45///teb//6bh//+X3P//ktr//43Z//+L2P//' +
  'idf//4nX//+N2P//mdz//7nn//+v5P//lNv//4rX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+M2P//uOf//7Ll//+a3f//yu3//5bc//+J1///idf//4nX//+J1///j9n//8fs//+h3///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+L2P//ktr//5jc//+o4v//teb//7bm//+15v//p+H//5jc//+W2///quL//7nn' +
  '//+b3f//jdj//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///i9j//6/k//+76P//' +
  'peD//8js//+Q2f//idf//4nX//+J1///idf//5Pa///I7P//pOD//4rX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///i9j//47Z//+S2v//mNz//6fh//+15v//uOf//6ri//+S2v//itf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4rX//+o4f//xOv//7vo//+25v//jNj//4nX' +
  '//+J1///i9j//5bc//+66P//ze7//5jc//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+L2P//jdn//4/Z//+M2P//idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///ouD//83u///N7v//od///4rX//+J1///jtn//6Hf///L7v//' +
  'vOj//5fc//+L2P//idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+K1///jNj//47Z//+L2P//idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//57e///V8f//0vD//5jc//+K1///lNv//7Pl///P7///p+H//5DZ//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///itf//43Y//+T2v//nN3//7Pl//+56P//nd7//4zY//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+c3f//2/P//87u//+V2///nd7//8fs///C6v//mt3//4zY//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///itf//5Tb//+y5f//t+f//7Ll//+c3f//mt3//7nn//+k4P//jtn//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///m93//+X2///G7P//sOT//9Dv//+t4///ktr//4rX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//5Pa//+45///od///5La//+M2P//itf//4rX//+T2v//tOX//6ri//+Q2f//idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//5nd' +
  '///p9///3PP//8js//+d3v//jdj//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//5DZ//+y5f//puH//43Y' +
  '//+J1///idf//4nX//+J1///itf//5Ha//+u5P//sOT//5La//+K1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+S2v//yu3//7fn//+U2///' +
  'itf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//47Z//+w5P//uuj//5vd//+W3P//l9z//5fc//+X3P//' +
  'mNz//5jc//+Z3P//od///73p//+/6f//ktr//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///itf//4/Z//+N2P//idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'i9j//4zY//+K1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+R2v//z+///83u//+86P//tub//7Xm//+z5f//tOb//7bm//+76P//wOn//9Hv' +
  '///Y8v//xuz//5La//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+M2P//k9r//6bh//+15v//n9///5La' +
  '//+M2P//idf//4nX//+J1///idf//4nX//+J1///i9j//5fc//+z5f//vOn//6Df//+U2///lNv//5vd//+v5P//uuj//7jn//+l4P//l9z//4/Z//+K1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4zY//+U2///qeL//7jn//+s4///nN3//7Hl//+55///rOP//5fc//+N2P//' +
  'idf//4nX//+J1///idf//4nX//+J1///jdj//5jc//+15v//uef//7fn//+25v//pOD//5Xb//+O2f//itf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+K1///jdj//5bc//+t4///u+j//63j//+b3f//ltv//5fc//+d3v//ruT//8vt///Z8v//nN7//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+K1///j9n//5bc//+V2///j9n//4rY//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+K1///md3//7rn///K7f//xuv//73p//+35///tub//7bm//+15v//suX//6ri//+r4///xOv//5Xb//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///jNj//7vo///X8v//' +
  'uuj//6Pg//+Z3P//ldv//5La//+Q2f//jtn//4zY//+R2v//teb//5/e//+L2P//idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+K1///itf//4vY//+K1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4rX//+T2///ruT//7nn//+Z3P//jdj//4nX' +
  '//+J1///idf//4nX//+N2f//pOD//7Hk//+O2f//idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///jNj//5Tb//+Y3P//nN7//6ni//+05v//lNv//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//43Y//+c3f//uuj//6fh//+Q2v//i9f//47Y//+W3P//' +
  'r+T//7fn//+T2///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+K1///ktr//6ri//+55///teb//7bm///F6///2vP//5ze//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///itf//5Pa//+u5P//t+f//5/e//+z5f//uOf//6Lf//+R2v//itf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///itf//43Y//+P2f//i9j//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+N2P//' +
  'm93//7nn//+p4v//k9r//5Tb//+v5P//t+f//73p//+W2///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///jtn//53e//+15v//nd7//5DZ//+L2P//idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+K1///jtn//5jc//+z5f//uOf//6ri//+V2///jdj//4rX//+J1///idf//4nX//+J1///idf//4rY//+T2v//reP//7jn//+Y3P//jdn//5La' +
  '//+y5f//rOP//5nc//+35v//kdr//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+K1///jNj//4rX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4rX//+P2f//mt3//7Xm' +
  '//+35///nt7//5jc//+o4v//u+j//7bn//+e3v//jtn//4nX//+J1///idf//47Z//+c3f//uef//6jh//+R2v//i9j//5Tb//+25v//puH//47Z//+W2///' +
  'teb//47Z//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///i9j//5Ha//+f3v//uef//7zo//+j4P//m93//5nc//+e3v//' +
  'reP//7ro///I7P//3fP//5rd//+J1///idf//4/Z//+u5P//t+b//5fc//+M2P//i9j//5fc//+66P//od///43Y//+M2P//od///7Ll//+M2P//idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///i9j//6Pg///L7f//1vH//8Lq//+76P//tub//7bm//+05v//sOT//6Lg//+b3f//quL//7zo' +
  '//+R2v//idf//4nX//+Y3P//uOf//5La//+K1///jNj//5vd//+86P//nN3//4zY//+N2P//od///7ro//+V2///itf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//43Y//+76P//z+///6ri//+a3f//lNv//5Ha//+P2f//jdj//4vY//+K1///k9r//7ro//+X3P//itf//4nX//+K1///' +
  'o+D//6vj//+L2P//jdj//6Df//+76P//mNz//4vY//+O2f//puH//7fm//+U2///itf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+K1///kNn//6Xh//+76P//nt7//47Z//+J1///idf//4nX//+K1///kdr//67k//+n4f//jNj//4nX//+J1///jNj//7Ll//+b3f//j9n//6Xg' +
  '//+35///ldv//4vY//+P2f//quL//7Pl//+T2v//itf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+M2P//l9z//7bm//+u5P//k9r//4zY//+R2v//n9///7fn//+v5P//kNn//4nX//+J1///idf//47Z//+25v//nN3//6ri//+z5f//k9r//4vX//+R2v//' +
  'ruT//6/k//+R2v//itf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4rX//+Q2f//' +
  'puH//7ro//+s4///uOf//7Hl//+X3P//jtn//4nX//+J1///idf//4nX//+S2v//ven//7nn//+y5f//l9z//5La//+X3P//s+X//6ri//+P2f//idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4zY//+X3P//p+H//5Xb' +
  '//+N2P//itf//4nX//+J1///idf//4nX//+J1///l9z//9ny///O7v//uuj//7bm//+25v//tub//6Tg//+O2f//idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4rX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//5DZ//+p4v//od///5jc//+V2///ktr//4/Z//+L2P//idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///itf//4rX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+T3///k9///5Pf//+T3///k9///5Pf//+T3///k9///5Pf//+T3///k9///5Pf//+T3///k9///5Pf//+T3///' +
  'k9///5Pf//+T3///k9///5Pf//+T3///k9///5Pf//+T3///k9///5Pf//+T3///k9///5Pf//+T3///k9///5Pf//+T3///k9///5Pf//+T3///k9///5Pf' +
  '//+T3///k9///5Pf//+T3///k9///5Pf//+T3///k9///5Pf//+T3///k9///5Pf//+T3///k9///5Pf//+T3///k9///5Pf//+T3///k9///5Pf//+T3///' +
  'k9///5Pf//+T3///V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///itj//4rY//+K2P//itj//4rY//+K2P//itj//4rY//+K2P//itj//4rY//+K2P//itj//4rY' +
  '//+K2P//itj//4rY//+K2P//itj//4rY//+K2P//itj//4rY//+K2P//itj//4rY//+K2P//itj//4rY//+K2P//itj//4rY//+K2P//itj//4rY//+K2P//' +
  'itj//4rY//+K2P//itj//4rY//+K2P//itj//4rY//+K2P//itj//4rY//+K2P//itj//4rY//+K2P//itj//4rY//+K2P//itj//4rY//+K2P//itj//4rY' +
  '//+K2P//itj//4rY//+K2P//itj//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV' +
  '//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//' +
  'h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//htT//4bU' +
  '//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//' +
  'htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU' +
  '//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4XT//+F0///hdP//4XT//+F0///' +
  'hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT' +
  '//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///' +
  'hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR' +
  '//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//' +
  'g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR' +
  '//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//' +
  'gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ' +
  '//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//' +
  'gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO' +
  '//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//' +
  'gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO' +
  '//+Azv//gM7//4DO//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//' +
  'fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M' +
  '//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//' +
  'fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK' +
  '//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//' +
  'fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3rI//96yP//esj//3rI' +
  '//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//4TQ//+K1P//f8v//3vI//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//3rI//96yP//' +
  'esj//3rI//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//3rI' +
  '//97yP//e8j//3rI//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//3rI//94xv//eMb//3jG//94xv//eMb//3jG//94xv//' +
  'eMb//3jG//94xv//eMb//3jG//+Gz/r/Wm16/3Kcsf+Iy/D/g8///3nH//94xv//eMb//3jG//94xv//eMb//3jG//94xv//eMb//3jG//94xv//eMb//3jG' +
  '//94xv//eMb//3jG//94xv//eMb//3jG//94xv//eMb//3jG//94xv//eMb//3jG//94xv//eMb//3jG//94xv//eMb//3jG//94xv//hMb//4jG/v95xv//' +
  'eMb//3jG//94xv//eMb//3jG//94xv//eMb//3jG//94xv//eMb//3jG//94xv//dsT//3bE//92xP//dsT//3bE//92xP//dsT//3bE//92xP//dsT//3bE' +
  '//92xP//hc78/01XX/9GTFP/SVFZ/2qPpP+F0P//dsT//3bE//92xP//dsT//3bE//92xP//dsT//3bE//92xP//dsT//3bE//92xP//dsT//3bE//92xP//' +
  'dsT//3bE//92xP//dsT//3bE//92xP//dsT//3bE//92xP//dsT//3bE//92xP//dsT//3bE//92xP//dsT//4/D/v+Vw/3/eMT//3bE//92xP//dsT//3bE' +
  '//92xP//dsT//3bE//92xP//dsT//3bE//92xP//dsT//3TC//90wv//dML//3TC//90wv//dML//3TC//90wv//dML//3TC//90wv//dML//4TO/f9XaHL/' +
  'S1Rb/0hPV/9UaHj/htD//3TC//90wv//dML//3TC//90wv//dcL//3fC//96wv//fcL//4LA+v+Ev/j/gsD6/33C//96wv//d8L//3XC//90wv//dML//3TC' +
  '//90wv//dML//3TC//90wv//dML//3TC//90wv//dML//3TC//90wv//dML//3XC//+Owf7/lMH9/3bC//90wv//dML//3TC//90wv//dML//3TC//90wv//' +
  'dML//3TC//90wv//dML//3TC//9ywP//csD//3LA//9ywP//csD//3LA//9ywP//csD//3LA//9ywP//csD//3LA//+Czf//Yn2M/2B8i/9jgZD/bJCk/4bQ' +
  '/v9ywP//csD//3LA//9ywP//dcD//4G++v+HvPf/hr33/4O9+P9+v/z/fMD+/36//P+Dvfj/hr34/4e89/+Bvfr/dcD//3LA//9ywP//csD//3LA//9ywP//' +
  'csD//3LA//9ywP//csD//3LA//9ywP//csD//3LA//9zwP//jMD+/5LA/f92wf//c8H//3LA//9ywP//csD//3LA//9ywP//csD//3LA//9ywP//csD//3LA' +
  '//9ywP//cL7//3C+//9wvv//cL7//3C+//9wvv//cL7//3C+//9wvv//cL7//3C+//9wvv//f8v//1FdZv9GTFP/RkxT/09ea/+Fz///cL7//3C+//9wvv//' +
  'cL7//328+/9/vfz/hcr4/4fE5v+GxOb/hsTm/4TA4f+FweL/hsPj/4vM7v97xf//f738/328+/9wvv//cL7//3C+//9wvv//cL7//3C+//9wvv//cL7//3C+' +
  '//9wvv//cL7//3C+//9+x/v/frnc/4Gx0P9/qcX/g73a/4LN//9wvv//cL7//3C+//9wvv//cL7//3C+//9wvv//cL7//3C+//9wvv//cL7//268//9uvP//' +
  'brz//268//9uvP//brz//268//9uvP//brz//268//9uvP//brz//33J//9TYmv/RkxT/0ZMU/9LVmH/hM7//268//9uvP//brz//268//92u/3/hLj3/4e+' +
  '5P9bcX7/WW56/1hseP9Xanb/V2p1/1Zpdf9tlKn/hcT8/4S49/92u/3/brz//268//9uvP//brz//268//9uvP//brz//268//9uvP//brz//268//9uvP//' +
  'fbrg/0NyZf9GVlj/RkxT/2SDk/+I0f//brz//268//9uvP//brz//268//9uvP//brz//268//9uvP//brz//268//9suv//bLr//2y6//9suv//bLr//2y6' +
  '//9suv//bLr//2y6//9suv//bLr//2y6//98x///VWRu/0ZMU/9GTFP/S1Zg/4TO//9suv//bLr//2y6//9suv//bbr//3C6//+CvOX/SVBX/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/ZoGV/4TD/P9wuv//bbr//2y6//9suv//bLr//2y6//9suv//bLr//2y6//9suv//bLr//2y6//9suv//bLr//3y43v89e2T/RlhZ/0ZM' +
  'U/9feon/itL+/2y6//9suv//bLr//2y6//9suv//bLr//2y6//9suv//bLr//2y6//9suv//arj//2q4//9quP//arj//2q4//9quP//arj//2q4//9quP//' +
  'arj//2q4//9quP//esj//1RjbP9GTFP/RkxT/0tWYP+CzP//arj//2q4//9quP//arj//2q4//9quP//ernj/0hPV/9GTFP/RkxT/0ZMU/9GTFP/RkxT/2GB' +
  'lv93w///arj//2q4//9quP//arj//2q4//9quP//arj//2q4//9quP//arj//2q4//9quP//arj//2q4//96tt3/PXtk/0ZYWf9GTFP/XnmH/4fQ//9quP//' +
  'arj//2q4//9quP//abP3/12Qv/9dkL//XZC//2Ok3/9quP//arj//2i2//9otv//aLb//2i2//9otv//aLb//2i2//9otv//aLb//2i2//9otv//aLb//3jH' +
  '//9UY2z/RkxT/0ZMU/9LVmD/gMv//2i2//9otv//aLb//2i2//9otv//aLb//3m44/9IT1f/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9ggJb/dcH//2i2//9otv//' +
  'aLb//2i2//9otv//aLb//2i2//9otv//aLb//2i2//9otv//aLb//2i2//9otv//ebXd/z17ZP9GWFn/RkxT/155h/+Gz///aLb//2i2//9otv//aLb//2av' +
  '9P9Xgan/V4Gp/1eBqf9gnNT/aLb//2i2//9mtP//ZrT//2a0//9mtP//ZrT//2a0//9mtP//ZrT//2a0//9mtP//ZrT//2a0//93wv//VGNs/0ZMU/9GTFP/' +
  'S1Zg/3/M//9mtP//ZrT//2a0//9mtP//ZrT//2a0//94t+P/SE9X/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/YICW/3S///9mtP//ZrT//2a0//9mtP//ZrT//2a0' +
  '//9mtP//ZrT//2a0//9mtP//ZrT//2a0//9mtP//ZrT//3i03f89e2T/RlhZ/0ZMU/9eeYf/hc3//2a0//9mtP//ZrT//2a0//9krvT/VoCp/1aAqf9WgKn/' +
  'XprU/2a0//9mtP//ZLL//2Sy//9ksv//ZLL//2Sy//9ksv//ZLL//2Sy//9ksv//ZLL//2Sy//9ksv//dcH//1RjbP9GTFP/RkxT/0pWYP9+yv//ZLL//2Sy' +
  '//9ksv//ZLL//2Sy//9ksv//d7bj/0hPV/9GTFP/RkxT/0ZMU/9GTFP/RkxT/2CAlv9yvv//ZLL//2Sy//9ksv//ZLL//2Sy//9ksv//ZLL//2Sy//9ksv//' +
  'ZLL//2Sy//9ksv//ZLL//2Sy//93s93/PXtk/0ZYWf9GTFP/XnmH/4PM//9ksv//ZLL//2Sy//9ksv//Yqz0/1V/qf9Vf6n/VX+p/12Z1P9ksv//ZLL//2Kw' +
  '//9isP//YrD//2Kw//9isP//YrD//2Kw//9isP//YrD//2Kw//9isP//YrD//3TA//9UY2z/RkxT/0ZMU/9KVWD/fcf//2Kw//9isP//YrD//2Kw//9isP//' +
  'YrD//3e25P9IT1f/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9ff5b/cb3//2Kw//9isP//YrD//2Kw//9isP//YrD//2Kw//9isP//YrD//2Kw//9isP//YrD//2Kw' +
  '//9isP//d7Pd/z17ZP9GWFn/RkxT/155iP+CzP//YrD//2Kw//9isP//YrD//2Cq9P9Ufqn/VH6p/1R+qf9bl9T/YrD//2Kw//9hr///Ya///2Gv//9hr///' +
  'Ya///2Gv//9hr///Ya///2Gv//9hr///Ya///2Gv//9zv///VGRt/0ZMU/9GTFP/SlVg/3zG//9hr///Ya///2Gv//9hr///Ya///2Gv//92teT/SE9X/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/X3+W/3C8//9hr///Ya///2Gv//9hr///Ya///2Gv//9hr///Ya///2Gv//9hr///Ya///2Gv//9hr///Ya///3ez3f89e2T/' +
  'RlhZ/0ZMU/9feoj/gsv//2Gv//9hr///Ya///2Gv//9fqfT/U32p/1N9qf9Tfan/WpbU/2Gv//9hr///X63//1+t//9frf//X63//1+t//9eqfj/XKHq/1yh' +
  '6v9coer/XKHq/1yh6v9coer/cLXv/1Vkbf9GTFP/RkxT/0pVYP97xv//X63//1qa3P9bneP/X63//1+t//9frf//drXk/0hPV/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/158kf9rrej/W5zh/1ue5P9frf//X63//1+t//9frf//X63//1+t//9frf//X63//1+t//9frf//X63//1+t//92st7/PXtk/0ZYWf9GTFP/X3qJ/4HK' +
  '//9frf//X63//1+t//9frf//Xaf0/1J8qf9SfKn/Unyp/1mV1P9frf//X63//12r//9dq///Xav//12r//9dq///WZzk/1F7qf9Re6n/UXup/1F7qf9Re6n/' +
  'UXup/2eZwP9VZG7/RkxT/0ZMU/9KVWD/esX//12r//9Xldf/WZnf/12r//9dq///Xav//3W05P9IUFf/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9deo//aKbd/1eT' +
  '1P9Xldf/Xav//12r//9dq///Xav//12r//9dq///Xav//12r//9dq///Xav//12r//9dq///dbLe/z17Zf9GWFn/RkxT/196if+Ayf//Xav//12r//9dq///' +
  'Xav//1yl9P9Re6n/UXup/1F7qf9Xk9T/Xav//12r//9cqv//XKr//1yq//9cqv//XKr//1mb5P9Re6n/UXup/1F7qf9Re6n/UXup/1F7qf9nmcD/VWRu/0ZM' +
  'U/9GTFP/SlVg/3nE//9cqv//VpTX/1iY3/9cqv//XKr//1yq//90tOT/SFBX/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/XXqP/2el3f9WktT/VpTX/1yq//9cqv//' +
  'XKr//1yq//9cqv//XKr//1yq//9cqv//XKr//1yq//9cqv//XKr//3Wx3f89e2T/RlhZ/0ZMU/9feon/f8j+/1yq//9cqv//XKr//1yq//9bpPT/UXup/1F7' +
  'qf9Re6n/V5PU/1yq//9cqv//W6n//1up//9bqf//W6n//1up//9YmuT/UHqp/1B6qf9Qeqn/UHqp/1B6qf9Qeqn/ZpjA/1Vkbf9GTFP/RkxT/0pVYP95w///' +
  'W6n//1aT1/9XmN//W6n//1up//9bqf//dLPk/0hQV/9GTFP/RkxT/0ZMU/9GTFP/RkxT/116j/9npd3/VpLU/1aT1/9bqf//W6n//1up//9bqf//W6n//1up' +
  '//9bqf//W6n//1up//9bqf//W6n//1up//90sd3/PXtk/0ZYWf9GTFP/X3qJ/37H/f9bqf//W6n//1up//9bqf//WqP0/1B6qf9Qeqn/UHqp/1aS1P9bqf//' +
  'W6n//1mn//9Zp///Waf//1mn//9Zp///Vpnk/095qf9Pean/T3mp/095qf9Pean/T3mp/2WXwP9VZG3/RkxT/0ZMU/9KVWD/d8L//1mn//9Ukdf/VZbf/1mn' +
  '//9Zp///Waf//3Oy5P9IUFf/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9deo//ZaPd/1SQ1P9Ukdf/Waf//1mn//9Zp///Waf//1mn//9Zp///Waf//1mn//9Zp///' +
  'Waf//1mn//9Zp///c7Dd/z17ZP9GWFn/RkxT/196if99xfz/Waf//1mn//9Zp///Waf//1ih9P9Pean/T3mp/095qf9UkNT/Waf//1mn//9Ypv//WKb//1im' +
  '//9Ypv//WKb//1WY5P9Pean/T3mp/095qf9Pean/T3mp/095qf9llsD/VGRt/0ZMU/9GTFP/SlVg/3bB//9Ypv//U5DX/1SV3/9Ypv//WKb//1im//9ysuT/' +
  'SFBX/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/XHmO/2Si3f9Tj9T/U5DX/1im//9Ypv//WKb//1im//9VmOT/U43P/1ONz/9Tjc//U43P/1ONz/9Tjc//U43P/3Gk' +
  'yf89e2T/RlhZ/0ZMU/9feoj/fMT7/1im//9Ypv//WKb//1im//9XoPT/T3mp/095qf9Pean/VJDU/1im//9Ypv//V6X//1el//9Xpf//V6X//1el//9Ul+T/' +
  'Tnip/054qf9OeKn/Tnip/054qf9OeKn/ZJbA/1Rjbf9GTFP/RkxT/0pVYP91wP//V6X//1OQ1/9Uld//V6X//1el//9Xpf//cbHk/0hQV/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/1x5jv9kot3/U4/U/1OQ1/9Xpf//V6X//1el//9Xpf//UozP/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9um7r/PXtk/0ZYWf9GTFP/' +
  'XnmH/3vC+v9Xpf//V6X//1el//9Xpf//Vp/0/054qf9OeKn/Tnip/1OP1P9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//VJfk/054qf9OeKn/Tnip/054' +
  'qf9OeKn/Tnip/2SVv/9UY2z/RkxT/0ZMU/9KVWD/dcD//1el//9TkNf/VJXf/1el//9Xpf//V6X//3Gx5P9IUFf/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9ceY7/' +
  'ZKLd/1OP1P9TkNf/V6X//1el//9Xpf//V6X//1KMz/9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/bpu5/z17ZP9GWFn/RkxT/155h/97wvr/V6X//1el' +
  '//9Xpf//V6X//1af9P9OeKn/Tnip/054qf9Tj9T/V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1SX5P9OeKn/Tnip/054qf9OeKn/Tnip/054qf9klb//' +
  'VGNs/0ZMU/9GTFP/SVVg/3XA//9Xpf//U5DX/1SV3/9Xpf//V6X//1el//9xseT/SFBX/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/XHmO/2Si3f9Tj9T/U5DX/1el' +
  '//9Xpf//V6X//1el//9Xo/z/VqL6/1WY5v9OeKn/Tnip/054qf9OeKn/Tnip/26buf89e2T/RlhZ/0ZMU/9eeIf/e8L6/1el//9Xpf//V6X//1el//9Wn/T/' +
  'Tnip/054qf9OeKn/U4/U/1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Ul+T/Tnip/054qf9OeKn/Tnip/054qf9OeKn/ZJW//1RjbP9GTFP/RkxT/0lV' +
  'YP91wP//V6X//1OQ1/9Uld//V6X//1el//9Xpf//cbHk/0hQV/9GTFP/RkxT/0ZMU/9GTFP/RkxT/1x5jv9kot3/U4/U/1OQ1/9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Vmur/Tnip/054qf9OeKn/Tnip/054qf9tmrn/PXtk/0ZYWf9GTFP/XniG/3vC+v9Xpf//V6X//1el//9Xpf//Vp/0/054qf9OeKn/Tnip/1OP' +
  '1P9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//VJfk/054qf9OeKn/Tnip/054qf9OeKn/Tnip/2SVv/9UY2z/RkxT/0ZMU/9JVWD/dcD//1el//9TkNf/' +
  'VJXf/1el//9Xpf//V6X//3Gx5f9IUFf/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9ceY7/ZKLd/1OP1P9TkNf/V6X//1el//9Xpf//V6X//1el//9Xpf//VZrq/054' +
  'qf9OeKn/Tnip/054qf9OeKn/bpu5/z17ZP9GWFn/RkxT/154hv97w/r/V6X//1el//9Xpf//V6X//1af9P9OeKn/Tnip/054qf9Tj9T/V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1SX5P9OeKn/Tnip/054qf9OeKn/Tnip/054qf9klr//VGNt/0ZMU/9GTFP/SlVg/3XA//9Xpf//U5DX/1SV3/9Xpf//V6X//1el' +
  '//9yseX/SFBX/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/XHmO/2Si3f9Tj9T/U5DX/1el//9Xpf//V6X//1el//9Xpf//V6X//1Wa6v9OeKn/Tnip/054qf9OeKn/' +
  'Tnip/26buf89e2T/RlhZ/0ZMU/9eeIf/e8P6/1el//9Xpf//V6X//1el//9Wn/T/Tnip/054qf9OeKn/U4/U/1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Ul+T/Tnip/054qf9OeKn/Tnip/054qf9OeKn/ZJbA/1Rkbf9GTFP/RkxT/0pVYP91wP//V6X//1OQ1/9Uld//V6X//1el//9Xpf//crLl/0hQV/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/1x5jv9kot3/U4/U/1OQ1/9Xpf//V6X//1el//9Xpf//Vp/z/1Wa6v9Tktr/Tnip/054qf9OeKn/Tnip/054qf9um7n/PXtk/0ZY' +
  'Wf9GTFP/XniH/3zD+v9Xpf//V6X//1el//9Xpf//Vp/0/054qf9OeKn/Tnip/1OP1P9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//VJfk/054qf9OeKn/' +
  'Tnip/054qf9OeKn/Tnip/2SWwP9VZG3/RkxT/0ZMU/9KVWD/dsD//1el//9TkNf/VJXf/1el//9Xpf//V6X//3Ky5f9IUFf/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9ceY//ZKLd/1OP1P9TkNf/V6X//1el//9Xpf//V6X//1KMz/9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/bpu5/z17ZP9GWFn/RkxT/155h/98xPv/' +
  'V6X//1el//9Xpf//V6X//1af9P9OeKn/Tnip/054qf9Tj9T/V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1SX5P9OeKn/Tnip/054qf9OeKn/Tnip/054' +
  'qf9llsD/VWRu/0ZMU/9GTFP/SVNd/3Kr2P9Qg7//T361/1B/t/9Qg7//UIO//1SW4/9ysub/SFBX/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/XHmP/2Si3f9Tj9T/' +
  'U5DX/1el//9Xpf//V6X//1el//9SjM//Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/26buv89e2T/RlhZ/0ZMU/9eeYf/fMT7/1el//9Xpf//V6X//1el' +
  '//9Wn/T/Tnip/054qf9OeKn/U4/U/1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Ul+T/Tnip/054qf9OeKn/Tnip/054qf9OeKn/ZZbA/1Vkbv9GTFP/' +
  'RkxT/0lSXP9wpcv/Tnip/054qf9OeKn/Tnip/054qf9Tkdn/c7Lm/0lQV/9GTFP/RkxT/0ZMU/9GTFP/RkxT/116j/9lo93/U4/U/1OQ1/9Xpf//V6X//1el' +
  '//9Xpf//UozP/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9unLr/PXtk/0ZYWf9GTFP/XnmH/3zE+/9Xpf//V6X//1el//9Xpf//Vp/0/054qf9OeKn/' +
  'Tnip/1OP1P9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//VJfk/054qf9OeKn/Tnip/054qf9OeKn/Tnip/2WWwP9VZW7/RkxT/0ZMU/9JUlz/cKXL/054' +
  'qf9OeKn/Tnip/054qf9OeKn/U5HZ/3Oz5v9JUFf/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9deo//ZaPd/1OP1P9TkNf/V6X//1el//9Xpf//V6X//1KMz/9OeKn/' +
  'Tnip/054qf9OeKn/Tnip/054qf9OeKn/bpy6/z17ZP9GWFn/RkxT/155h/97vu//VZnn/1WZ5/9Vmef/VZnn/1SU3/9OeKn/Tnip/054qf9Tj9T/V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1SX5P9OeKn/Tnip/054qf9OeKn/Tnip/054qf9llsD/VWRu/0ZMU/9GTFP/SVJc/3Cky/9OeKn/Tnip/054qf9OeKn/' +
  'Tnip/1OR2f9zs+b/SVBX/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/XXqP/2Wj3f9Tj9T/U5DX/1el//9Xpf//V6X//1el//9SjM//Tnip/054qf9OeKn/Tnip/054' +
  'qf9OeKn/Tnip/26buf89e2T/RlhZ/0ZMU/9eeIf/ernl/1OP1P9Tj9T/U4/U/1OP1P9SjM//Tnip/054qf9OeKn/U4/U/1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Ul+T/Tnip/054qf9OeKn/Tnip/054qf9OeKn/ZJbA/1Vkbf9GTFP/RkxT/0lSXP9vpMv/Tnip/054qf9OeKn/Tnip/054qf9Tkdn/crLm/0lQ' +
  'V/9GTFP/RkxT/0ZMU/9GTFP/RkxT/1x5j/9kot3/U4/U/1OQ1/9Xpf//V6X//1el//9Xpf//UozP/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9um7n/' +
  'PXtk/0ZYWf9GTFP/XniG/3q55f9Tj9T/U4/U/1OP1P9Tj9T/UozP/054qf9OeKn/Tnip/1OP1P9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//VJfk/054' +
  'qf9OeKn/Tnip/054qf9OeKn/Tnip/2SWv/9UY23/RkxT/0ZMU/9JUlz/b6PK/054qf9OeKn/Tnip/054qf9OeKn/U5HZ/3Ky5v9IUFf/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9ceY//ZKLd/1OP1P9TkNf/V6X//1el//9Xpf//V6X//1KMz/9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/bpq5/z17ZP9GWFn/RkxT/113' +
  'hf96uOX/U4/U/1OP1P9Tj9T/U4/U/1KMz/9OeKn/Tnip/054qf9Tj9T/V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1SX5P9OeKn/Tnip/054qf9OeKn/' +
  'Tnip/054qf9klb//VGNs/0ZMU/9GTFP/SVJc/2+jyv9OeKn/Tnip/054qf9OeKn/Tnip/1OR2f9yseX/SFBX/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/XHmO/2Si' +
  '3f9Tj9T/U5DX/1el//9Xpf//V6X//1el//9SjM//Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/22auP89e2T/RlhZ/0ZMU/9dd4X/ebjl/1OP1P9Tj9T/' +
  'U4/U/1OP1P9SjM//Tnip/054qf9OeKn/U4/U/1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Ul+T/Tnip/054qf9OeKn/Tnip/054qf9OeKn/ZJW//1Rj' +
  'bP9GTFP/RkxT/0lSXP9vo8r/Tnip/054qf9OeKn/Tnip/054qf9Tkdn/crHl/0hQV/9GTFP/RkxT/0ZMU/9GTFP/RkxT/1x5jv9kot3/U4/U/1OQ1/9Xpf//' +
  'V6X//1el//9Xpf//UozP/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9tmrj/PXtk/0ZYWf9GTFP/XXeF/3m45f9Tj9T/U4/U/1OP1P9Tj9T/UozP/054' +
  'qf9OeKn/Tnip/1OP1P9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//VJfk/054qf9OeKn/Tnip/054qf9OeKn/Tnip/2SVv/9UY2z/RkxT/0ZMU/9JUlz/' +
  'b6PK/054qf9OeKn/Tnip/054qf9OeKn/U5HZ/3Kx5f9IUFf/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9ceY7/ZKLd/1OP1P9TkNf/V6X//1el//9Xpf//V6X//1KM' +
  'z/9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/bZq4/z17ZP9GWFn/RkxT/113hf95uOX/U4/U/1OP1P9Tj9T/U4/U/1KMz/9OeKn/Tnip/054qf9Tj9T/' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1SX5P9OeKn/Tnip/054qf9OeKn/Tnip/054qf9klb//VGNs/0ZMU/9GTFP/SVJc/2+jyv9OeKn/Tnip/054' +
  'qf9OeKn/Tnip/1OR2f9yseX/SFBX/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/XHmO/2Si3f9Tj9T/U5DX/1el//9Xpf//V6X//1el//9SjM//Tnip/054qf9OeKn/' +
  'Tnip/054qf9OeKn/Tnip/22auP89e2T/RlhZ/0ZMU/9dd4X/ebjl/1OP1P9Tj9T/U4/U/1OP1P9SjM//Tnip/054qf9OeKn/U4/U/1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Ul+T/Tnip/054qf9OeKn/Tnip/054qf9OeKn/ZJW//1RjbP9GTFP/RkxT/0lSXP9vo8r/Tnip/054qf9OeKn/Tnip/054qf9Tkdn/' +
  'crHl/0hQV/9GTFP/RkxT/0ZMU/9GTFP/RkxT/1x5jv9kot3/U4/U/1OQ1/9Xpf//V6X//1el//9Xpf//UozP/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054' +
  'qf9tmrj/PXtk/0ZYWf9GTFP/XXeF/3m45f9Tj9T/U4/U/1OP1P9Tj9T/UozP/054qf9OeKn/Tnip/1OP1P9Xpf//V6X//01znv9Nc57/TXOe/01znv9Nc57/' +
  'TG2S/0pfef9KX3n/Sl95/0pfef9KX3n/Sl95/1RthP9NVl//RkxT/0ZMU/9HT1f/WXSK/0pfef9KX3n/Sl95/0pfef9KX3n/TGqO/1p6lv9HTlX/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9QYW7/VHOR/0xpi/9Mao3/TXOe/01znv9Nc57/TXOe/0toif9KX3n/Sl95/0pfef9KX3n/Sl95/0pfef9KX3n/WHCB/0JnXv9GU1b/' +
  'RkxT/1Fgav9efpf/TGmL/0xpi/9MaYv/TGmL/0toif9KX3n/Sl95/0pfef9MaYv/TXOe/01znv9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/+G1P//idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///htT//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4bU//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+G1P//idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///htT//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4bU//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///' +
  'idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX//+J1///idf//4nX' +
  '//+J1///idf//4nX//+J1///idf//4nX//+F0///iNb//4jW//+I1v//iNb//4jW//+I1v//iNb//4jW//+I1v//iNb//4jW//+I1v//iNb//4jW//+I1v//' +
  'iNb//4jW//+I1v//iNb//4jW//+I1v//iNb//4jW//+I1v//iNb//4jW//+I1v//iNb//4jW//+I1v//iNb//4jW//+I1v//iNb//4jW//+I1v//iNb//4jW' +
  '//+I1v//iNb//4jW//+I1v//iNb//4jW//+I1v//iNb//4jW//+I1v//iNb//4jW//+I1v//iNb//4jW//+I1v//iNb//4jW//+I1v//iNb//4jW//+I1v//' +
  'iNb//4jW//+I1v//hNL//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV' +
  '//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//' +
  'h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4fV//+H1f//h9X//4PR' +
  '//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//' +
  'htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU' +
  '//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+G1P//htT//4bU//+C0P//hdP//4XT//+F0///' +
  'hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT' +
  '//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///' +
  'hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///hdP//4XT//+F0///gM7//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR' +
  '//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//' +
  'g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR' +
  '//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//4PR//+D0f//g9H//3/N//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//' +
  'gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ' +
  '//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//+C0P//' +
  'gtD//4LQ//+C0P//gtD//4LQ//+C0P//gtD//4LQ//99y///gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO' +
  '//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//' +
  'gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO//+Azv//gM7//4DO' +
  '//+Azv//gM7//4DO//+Azv//fMr//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//' +
  'fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M' +
  '//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//fsz//37M//9+zP//' +
  'fsz//3rI//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK' +
  '//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//' +
  'fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//98yv//fMr//3zK//94xv//esj//3rI' +
  '//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//3rI//96yP//' +
  'esj//3rI//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//3rI//96yP//e8n//3zJ' +
  '//97yP//esj//3rI//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//3rI//96yP//esj//3rI//96yP//dsT//3jG//94xv//eMb//3jG//94xv//' +
  'eMb//3jG//94xv//eMb//3jG//94xv//eMb//3nG//95x///ecf//3nH//95x///ecf//3nH//95x///ecf//3jG//94xv//eMb//3jG//94xv//eMb//3jG' +
  '//94xv//eMb//3jG//94xv//eMb//3jG//94xv//eMb//3jG//94xv//eMb//3jG//94xv//eMb//3nH//+K0fn/hcPk/4K82v+CuNT/hdD//3jG//94xv//' +
  'eMb//3jG//94xv//eMb//3jG//94xv//eMb//3jG//94xv//eMb//3jG//94xv//eMb//3TC//92xP//dsT//3bE//92xP//dsT//3bE//92xP//dsT//3bE' +
  '//92xP//dsT//3bE//+Ez///hb7c/4K61/+Cutf/grrY/4TA4P+FwOD/hcHg/4nH5/9/y///d8T//3fF//93xf//d8X//3fF//93xf//dsT//3bE//92xP//' +
  'dsT//3bE//92xP//dsT//3bE//92xP//dsT//3bE//92xP//dsT//3bE//95xv//f7PM/2OAj/9jgI//Y3+O/4bL8f92xP//dsT//3bE//92xP//dsT//3bE' +
  '//92xP//dsT//3bE//92xP//dsT//3bE//92xP//dsT//3bE//9ywP//dML//3TC//90wv//dML//3TC//90wv//dML//3TC//90wv//dML//3TC//90wv//' +
  'gMz//22Ro/9gfIv/YHyL/2B8i/9gfIv/YHyL/2B8iv9kgpL/hMHi/4G94P9/uNn/f7jY/3+42P98stH/hL/d/3rH//90wv//dML//3TC//90wv//dML//3TC' +
  '//90wv//dML//3TC//90wv//dML//3TC//90wv//ecX//2uOn/9GTFP/RkxT/0ZMU/97r8v/dcP//3TC//90wv//dML//3TC//90wv//dML//3TC//90wv//' +
  'dML//3TC//90wv//dML//3TC//90wv//cL7//3LA//9ywP//csD//3LA//9ywP//csD//3LA//9ywP//csD//3LA//9ywP//csD//3zI//9ed4b/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0dNU/+HdUv/Sk9T/0ZMU/9GTFP/RkxT/2F7iP96xv//csD//3LA//9ywP//csD//3LA//9ywP//csD//3LA//9ywP//' +
  'csD//3LA//9ywP//csD//3jE//9mhJP/RkxT/0ZMU/9GTFP/c52z/3TB//9ywP//csD//3LA//9ywP//csD//3LA//9ywP//csD//3LA//9ywP//csD//3LA' +
  '//9ywP//csD//268//9wvv//cL7//3C+//9wvv//cL7//3C+//9wvv//cL7//3C+//9wvv//cL7//3C+//97xv//XneG/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9ITlP/u5U3/05SU/9GTFP/RkxT/0ZMU/9he4j/eMT//3C+//9wvv//cL7//3C+//9wvv//cL7//3C+//9wvv//cL7//3C+//9wvv//cL7//3C+' +
  '//93w///ZoST/0ZMU/9GTFP/RkxT/3Kds/9yv///cL7//3C+//9wvv//cL7//3C+//9wvv//cL7//3C+//9wvv//cL7//3C+//9wvv//cL7//3C+//9tu///' +
  'brz//268//9uvP//brz//268//9uvP//brz//268//9uvP//brz//268//9uvP//ecX//153hv9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/SE5T/7qV' +
  'N/9OUlP/RkxT/0ZMU/9GTFP/YXuI/3fD//9uvP//brz//268//9uvP//brz//268//9uvP//brz//268//9uvP//brz//268//9uvP//dcH//2aEk/9GTFP/' +
  'RkxT/0ZMU/9ynLP/cL3//268//9uvP//brz//268//9uvP//brz//268//9uvP//brz//268//9uvP//brz//268//9uvP//a7n//2y6//9suv//bLr//2y6' +
  '//9suv//bLr//2y6//9suv//bLr//2y6//9suv//bLr//3fD//9ed4b/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0hOU/+7lTf/TlJT/0ZMU/9GTFP/' +
  'RkxT/2F7iP91wf//bLr//2y6//9suv//bLr//2y6//9suv//bLr//2y6//9qtvj/ZKLZ/2Si2f9kotn/ZKLZ/2up3P9mg5H/RkxT/0ZMU/9GTFP/cZyz/267' +
  '//9suv//bLr//2y6//9suv//bLr//2y6//9suv//bLr//2y6//9suv//bLr//2y6//9suv//bLr//2m3//9quP//arj//2q4//9quP//arj//2q4//9quP//' +
  'arj//2q4//9quP//arj//2q4//92wf//XXeG/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9ITlP/upU3/05SU/9GTFP/RkxT/0ZMU/9he4j/c7///2q4' +
  '//9quP//arj//2q4//9quP//arj//2q4//9quP//aLP3/2Ge1v9hntb/YZ7W/2Ge1v9ppdn/ZYOR/0ZMU/9GTFP/RkxT/3Gcs/9suv//arj//2q4//9quP//' +
  'arj//2q4//9quP//arj//2q4//9quP//arj//2q4//9quP//arj//2q4//9ntf//aLb//2i2//9otv//aLb//2i2//9otv//aLb//2i2//9otv//aLb//2i2' +
  '//9otv//dMD//112hv9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/SE5T/7uVN/9OUlP/RkxT/0ZMU/9GTFP/YXuI/3G9//9otv//aLb//2i2//9otv//' +
  'aLb//2i2//9otv//aLb//2Ws7/9Xgan/V4Gp/1eBqf9Xgan/X4qw/2SBjv9GTFP/RkxT/0ZMU/9xm7P/arj//2i2//9otv//aLb//2i2//9otv//aLb//2i2' +
  '//9otv//aLb//2i2//9otv//aLb//2i2//9otv//ZbP//2a0//9mtP//ZrT//2a0//9mtP//ZrT//2a0//9mtP//ZrT//2a0//9mtP//ZrT//3K+//9ddob/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0hOU/+7lTf/TlJT/0ZMU/9GTFP/RkxT/2F7iP9vu///ZrT//2a0//9mtP//ZrT//2a0//9mtP//ZrT//2a0' +
  '//9jqu//VoCp/1aAqf9WgKn/VoCp/16JsP9kgY7/RkxT/0ZMU/9GTFP/cJ2z/2i5//9mtP//ZrT//2a0//9mtP//ZrT//2a0//9mtP//ZrT//2a0//9mtP//' +
  'ZrT//2a0//9mtP//ZrT//2Ox//9ksv//ZLL//2Sy//9ksv//ZLL//2Sy//9ksv//ZLL//2Sy//9ksv//ZLL//2Sy//9wvP//XXaG/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9ITlP/u5U3/05SU/9GTFP/RkxT/0ZMU/9ge4j/bbr//2Sy//9ksv//ZLL//2Sy//9ksv//ZLL//2Sy//9ksv//Yajv/1V/qf9Vf6n/' +
  'VX+p/1V/qf9diLD/ZIGO/0ZMU/9GTFP/RkxT/3Ces/9mvf//ZLL//2Sy//9ksv//Yafs/16c2f9enNn/XpzZ/16c2f9iq/P/ZLL//2Sy//9ksv//ZLL//2Sy' +
  '//9hr///YrD//2Kw//9isP//YrD//2Kw//9isP//YrD//2Kw//9isP//YrD//2Kw//9isP//b7v//112hv9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'SE5T/7qVN/9OUlP/RkxT/0ZMU/9GTFP/YHqI/2y4//9isP//YrD//2Kw//9isP//YrD//2Kw//9isP//YrD//1+n7/9Ufqn/VH6p/1R+qf9Ufqn/XIew/2SB' +
  'jv9GTFP/RkxT/0ZMU/9wnrP/ZsD//2Kx//9isP//Yaz4/1WCsP9Ufqn/VH6p/1R+qf9Ufqn/V4m7/2Kv/f9isP//YrD//2Kw//9isP//YK7//2Gv//9hr///' +
  'Ya///2Gv//9hr///Ya///2Gv//9hr///Ya///2Gv//9hr///Ya///266//9ddob/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0hOU/+7lTf/TlJT/0ZM' +
  'U/9GTFP/RkxT/2F7iP9rt///Ya///2Gv//9hr///Ya///2Gv//9hr///Ya///2Gv//9epu//U32p/1N9qf9Tfan/U32p/1uHsf9kgY//RkxT/0ZMU/9GTFP/' +
  'b5y0/2O6//9hr///Ya7//1iNxf9Tfan/U32p/1N9qf9Tfan/U32p/1N9qf9aldL/Ya///2Gv//9hr///Ya///1+t//9frf//X63//1+t//9frf//X63//1+t' +
  '//9frf//X63//1+t//9frf//X63//1+t//9suP//XXaG/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9ITlP/u5U3/05SU/9GTFP/RkxT/0ZMU/9he4n/' +
  'abX//1+t//9co+3/WJLP/1iSz/9Yks//W5/n/1+t//9frf//XaTv/1J8qf9SfKn/Unyp/1J8qf9ahrH/ZYGP/0ZMU/9GTFP/RkxT/2+atP9hr///X63//1uf' +
  '5v9SfKn/Unyp/1J8qf9SfKn/Unyp/1J8qf9SfKn/Unyp/12k7/9frf//X63//1+t//9dq///Xav//12r//9dq///Xav//12r//9dq///Xav//12r//9dq///' +
  'Xav//12r//9dq///a7f//112hv9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/SE5T/7qVN/9OUlP/RkxT/0ZMU/9GTFP/YXuJ/2e0//9dq///W6Pw/1iV' +
  '1/9Vi8X/Un6u/1eT1P9dq///Xav//1ui7/9Re6n/UXup/1F7qf9Re6n/WoWx/2WCkP9GTFP/RkxT/0ZMU/9vmrT/X63//12r//9Zmd//UXup/1F7qf9Re6n/' +
  'UXup/1F7qf9Re6n/UXup/1F7qf9an+r/Xav//12r//9dq///XKr//1yq//9cqv//XKr//1yq//9cqv//XKr//1yq//9cqv//XKr//1yq//9cqv//XKr//2q2' +
  '//9ddob/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0hOU/+7lTf/TlJT/0ZMU/9GTFP/RkxT/2F7if9ns///XKr//1iY3/9Re6r/U4W7/1aR0v9Zn+v/' +
  'XKr//1yq//9aoe//UXup/1F7qf9Re6n/UXup/1qFsf9lgpD/RkxT/0ZMU/9GTFP/b5q0/16s//9cqv//WJjf/1F7qf9Re6n/UXup/1F7qf9Re6n/UXup/1F7' +
  'qf9Re6n/WZ7q/1yq//9cqv//XKr//1qo//9aqP//Wqj//1qo//9aqP//Wqj//1qo//9aqP//WqX5/1aW3P9Wltz/Vpbc/1aW3P9osfn/XXaG/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9ITlP/upU3/05SU/9GTFP/RkxT/0ZMU/9he4n/ZbH//1qo//9Wl9//UHqp/1B6qf9Qeqn/VZHU/1qo//9aqP//WJ/v/1B6' +
  'qf9Qeqn/UHqp/1B6qf9ZhbH/ZYKQ/0ZMU/9GTFP/RkxT/2+atP9dqv//Wqj//1aX3/9Qeqn/UHqp/1B6qf9Qeqn/UHqp/1B6qf9Qeqn/UHqp/1id6v9aqP//' +
  'Wqj//1qo//9Zp///Waf//1mn//9Zp///Waf//1mn//9Zp///Waf//1ij9/9UkNT/VJDU/1SQ1P9UkNT/Zq/3/112hv9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/SE5T/7uVN/9OUlP/RkxT/0ZMU/9GTFP/YXuJ/2Sx//9Zp///VZbf/095qf9Pean/T3mp/1SQ1P9Zp///Waf//1ee7/9Pean/T3mp/095qf9Pean/' +
  'WISx/2WCkP9GTFP/RkxT/0ZMU/9vmrT/XKn//1mn//9Vlt//T3mp/095qf9Pean/T3mp/095qf9Pean/T3mp/095qf9XnOr/Waf//1mn//9Zp///WKb//1im' +
  '//9Ypv//WKb//1im//9Ypv//WKb//1im//9Xovf/U4/U/1OP1P9Tj9T/U4/U/2au9/9ddob/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0hOU/+6lTf/' +
  'TlJT/0ZMU/9GTFP/RkxT/2F6iP9hper/VZnn/1ON0P9Pean/T3mp/095qf9UkNT/WKb//1im//9Wnu//T3mp/095qf9Pean/T3mp/1iEsf9lgpD/RkxT/0ZM' +
  'U/9GTFP/b5q0/1uo//9Ypv//VZXf/095qf9Pean/T3mp/095qf9Pean/T3mp/095qf9Pean/Vpvq/1im//9Ypv//WKb//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//VqH3/1OP1P9Tj9T/U4/U/1OP1P9lrvf/XXaG/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9ITlP/upU3/05SU/9GTFP/RkxT/0ZM' +
  'U/9heoj/X5za/1OP1P9RhsT/Tnip/054qf9OeKn/U4/U/1el//9Xpf//VZ3v/054qf9OeKn/Tnip/054qf9Xg7H/ZYKQ/0ZMU/9GTFP/RkxT/2+atP9ap///' +
  'V6X//1SU3/9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/1Wa6v9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1ah' +
  '9/9Tj9T/U4/U/1OP1P9Tj9T/Za73/112hv9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/SE5T/7uVN/9OUlP/RkxT/0ZMU/9GTFP/YXqI/1+c2v9Tj9T/' +
  'UYbE/054qf9OeKn/Tnip/1OP1P9Xpf//V6X//1Wd7/9OeKn/Tnip/054qf9OeKn/V4Ox/2WCkP9GTFP/RkxT/0ZMU/9vmrT/Wqf//1el//9UlN//Tnip/054' +
  'qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9Vmur/V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Woff/U4/U/1OP1P9Tj9T/' +
  'U4/U/2Wu9/9ddob/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0hOU/+6lTf/TlJT/0ZMU/9GTFP/RkxT/2F6iP9fnNr/U4/U/1GGxP9OeKn/Tnip/054' +
  'qf9Tj9T/V6X//1el//9Vne//Tnip/054qf9OeKn/Tnip/1eDsf9lgpD/RkxT/0ZMU/9GTFP/b5q0/1qn//9Xpf//VJTf/054qf9OeKn/Tnip/054qf9OeKn/' +
  'Tnip/054qf9OeKn/VZrq/1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//VqH3/1OP1P9Tj9T/U4/U/1OP1P9lrvf/XXaG/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9ITlP/u5U3/05SU/9GTFP/RkxT/0ZMU/9heoj/X5za/1OP1P9RhsT/Tnip/054qf9OeKn/U4/U/1el//9Xpf//' +
  'VZ3v/054qf9OeKn/Tnip/054qf9Xg7H/ZYKQ/0ZMU/9GTFP/RkxT/2+atP9ap///V6X//1SU3/9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/1Wa' +
  '6v9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1ah9/9Tj9T/U4/U/1OP1P9Tj9T/Za73/112hv9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/SE5T/7uVN/9OUlP/RkxT/0ZMU/9GTFP/YXqI/1+b2v9Tj9T/UYbE/054qf9OeKn/Tnip/1B/tv9Sisv/V6X//1Wd7/9OeKn/Tnip/054' +
  'qf9OeKn/V4Ox/2WCkP9GTFP/RkxT/0ZMU/9vmrT/Wqf//1el//9UlN//Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9Vmur/V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Woff/U4/U/1OP1P9Tj9T/U4/U/2Wt9/9ddob/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0hO' +
  'U/+7lTf/TlJT/0ZMU/9GTFP/RkxT/2F6iP9fm9r/U4/U/1GGxP9OeKn/Tnip/054qf9OeKn/T360/1el//9Vne//Tnip/054qf9OeKn/Tnip/1eDsf9lgpD/' +
  'RkxT/0ZMU/9GTFP/bpat/1aT2P9TkNf/UYfG/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/VZrq/1el//9Xpf//V6X//1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//VqH3/1OP1P9Tj9T/U4/U/1OP1P9krff/XXaG/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9ITlP/u5U3/05SU/9GTFP/' +
  'RkxT/0ZMU/9geoj/Xpva/1OP1P9RhsT/Tnip/054qf9OeKn/Tnip/09+tP9Xpf//VZ3v/054qf9OeKn/Tnip/054qf9Xg7H/ZYKQ/0ZMU/9GTFP/RkxT/26W' +
  'rf9WktX/U4/U/1GGxP9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/1Wa6v9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1ah9/9Tj9T/U4/U/1OP1P9Tj9T/ZK33/112hv9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/SE5T/7uVN/9OUlP/RkxT/0ZMU/9GTFP/YHqI/16b' +
  '2v9Tj9T/UYbE/054qf9OeKn/Tnip/054qf9PfrT/V6X//1Wd7/9OeKn/Tnip/054qf9OeKn/V4Ox/2WBj/9GTFP/RkxT/0ZMU/9ulq3/VpLV/1OP1P9RhsT/' +
  'Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9Vmur/V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Vn/L/UIG7/1ST3P9QgLj/T3yx/098' +
  'sf9PfLH/T3yx/16SxP9cdIH/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0hOU/+7lTf/TlJT/0ZMU/9GTFP/RkxT/2B6h/9em9n/U4/U/1GGxP9OeKn/' +
  'Tnip/054qf9OeKn/T360/1el//9Vne//Tnip/054qf9OeKn/Tnip/1eDsf9kgY//RkxT/0ZMU/9GTFP/bZWs/1aS1f9Tj9T/UYbE/054qf9OeKn/Tnip/054' +
  'qf9OeKn/Tnip/054qf9OeKn/VZrq/1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//VZ3v/055q/9Tj9T/Tnip/054qf9OeKn/Tnip/054qf9di7j/' +
  'XHOA/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9ITlP/upU3/05SU/9GTFP/RkxT/0ZMU/9geof/XpvZ/1OP1P9RhsT/Tnip/054qf9OeKn/Tnip/09+' +
  'tP9Xpf//VZ3v/054qf9OeKn/Tnip/054qf9Xg7H/ZICO/0ZMU/9GTFP/RkxT/22VrP9WktX/U4/U/1GGxP9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/' +
  'Tnip/1Wa6v9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1Wd7/9Oeav/U4/U/054qf9OeKn/Tnip/054qf9OeKn/XYu3/1xzgP9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/SE5T/7uVN/9OUlP/RkxT/0ZMU/9GTFP/YHqH/16b2f9Tj9T/UYbE/054qf9OeKn/Tnip/054qf9PfrT/V6X//1Wd7/9OeKn/' +
  'Tnip/054qf9OeKn/V4Ox/2SAjv9GTFP/RkxT/0ZMU/9slKz/VpLV/1OP1P9RhsT/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9Vmur/V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//V6X//1el//9Vne//Tnmr/1OP1P9OeKn/Tnip/054qf9OeKn/Tnip/12Lt/9cc4D/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0hOU/+7lTf/TlJT/0ZMU/9GTFP/RkxT/2B5h/9em9n/U4/U/1GGxP9OeKn/Tnip/054qf9OeKn/T3yx/1WZ5/9Tk9v/Tnip/054qf9OeKn/Tnip/1eD' +
  'sf9jgI7/RkxT/0ZMU/9GTFP/bJSr/1aS1f9Tj9T/UYbE/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/VZrq/1el//9Xpf//V6X//1el//9Xpf//' +
  'V6X//1el//9Xpf//VZ3v/055q/9Tj9X/Tnip/054qf9OeKn/Tnip/054qf9di7f/XHOA/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9ITlP/u5U3/05S' +
  'U/9GTFP/RkxT/0ZMU/9geYf/XpvZ/1OP1P9RhsT/Tnip/054qf9OeKn/Tnip/097rv9Tj9T/UovM/054qf9OeKn/Tnip/054qf9Xg7H/Y4CO/0ZMU/9GTFP/' +
  'RkxT/2yUq/9WktX/U4/U/1GGxP9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/1Wa6v9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1Wd' +
  '7/9Oeav/U4/U/054qf9OeKn/Tnip/054qf9OeKn/XYu3/1xzgP9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/SE5T/7uVN/9OUlP/RkxT/0ZMU/9GTFP/' +
  'YHmH/16b2f9Tj9T/UYbE/054qf9OeKn/Tnip/054qf9Pe67/U4/U/1KLzP9OeKn/Tnip/054qf9OeKn/V4Ox/2OAjv9GTFP/RkxT/0ZMU/9slKv/VpLV/1OP' +
  '1P9RhsT/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9Vmur/V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Vne//Tnmr/1OP1P9OeKn/' +
  'Tnip/054qf9OeKn/Tnip/12Lt/9cc4D/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0hOU/+7lTf/TlJT/0ZMU/9GTFP/RkxT/2B5h/9em9n/U4/U/1GG' +
  'xP9OeKn/Tnip/054qf9OeKn/T3uu/1OP1P9Si8z/Tnip/054qf9OeKn/Tnip/1eDsf9jgI7/RkxT/0ZMU/9GTFP/bJSr/1aS1f9Tj9T/UYbE/054qf9OeKn/' +
  'Tnip/054qf9OeKn/Tnip/054qf9OeKn/VZrq/1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//VZ3v/055q/9Tj9T/Tnip/054qf9OeKn/Tnip/054' +
  'qf9di7f/XHOA/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9ITlP/u5U3/05SU/9GTFP/RkxT/0ZMU/9geYf/XpvZ/1OP1P9RhsT/Tnip/054qf9OeKn/' +
  'Tnip/097rv9Tj9T/UovM/054qf9OeKn/Tnip/054qf9Xg7H/Y4CO/0ZMU/9GTFP/RkxT/2yUq/9WktX/U4/U/1GGxP9OeKn/Tnip/054qf9OeKn/Tnip/054' +
  'qf9OeKn/Tnip/1Wa6v9Xpf//V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1Wd7/9Oeav/U4/U/054qf9OeKn/Tnip/054qf9OeKn/XYu3/1xzgP9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/SE5T/7uVN/9OUlP/RkxT/0ZMU/9GTFP/YHmH/16b2f9Tj9T/UYbE/054qf9OeKn/Tnip/054qf9Pe67/U4/U/1KL' +
  'zP9OeKn/Tnip/054qf9OeKn/V4Ox/2OAjv9GTFP/RkxT/0ZMU/9slKv/VpLV/1OP1P9RhsT/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9Vmur/' +
  'V6X//1el//9Xpf//V6X//1el//9Xpf//V6X//1el//9Vne//Tnmr/1OP1f9OeKn/Tnip/054qf9OeKn/Tnip/12Lt/9cc4D/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0hOU/+7lTf/TlJT/0ZMU/9GTFP/RkxT/2B5h/9em9n/U4/U/1GGxP9OeKn/Tnip/054qf9OeKn/T3uu/1OP1P9Si8z/Tnip/054qf9OeKn/' +
  'Tnip/1eDsf9jgI7/RkxT/0ZMU/9GTFP/bJSr/1aS1f9Tj9T/UYbE/054qf9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/VZrq/1el//9Xpf//V6X//1el' +
  '//9Xpf//V6X//1el//9Xpf//VZ3v/055q/9Tj9T/Tnip/054qf9OeKn/Tnip/054qf9di7f/XHOA/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9ITlP/' +
  'u5U3/05SU/9GTFP/RkxT/0ZMU/9geYf/XpvZ/1OP1P9RhsT/Tnip/054qf9OeKn/Tnip/097rv9Tj9T/UovM/054qf9OeKn/Tnip/054qf9Xg7H/Y4CO/0ZM' +
  'U/9GTFP/RkxT/2yUq/9WktX/U4/U/1GGxP9OeKn/Tnip/054qf9OeKn/Tnip/054qf9OeKn/Tnip/1Wa6v9Xpf//V6X//1el//9RhL//UYS//1GEv/9RhL//' +
  'UYS//09/tf9LaIr/Tnak/0toif9LaIn/S2iJ/0toif9LaIn/VHST/1RlcP9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/R01T/5mBRP9MUFP/RkxT/0ZM' +
  'U/9GTFP/V2l1/1V+qP9OdqT/TXCa/0toif9LaIn/S2iJ/0toif9MaYz/Tnak/05zn/9LaIn/S2iJ/0toif9LaIn/UG6O/1luef9GTFP/RkxT/0ZMU/9fe4z/' +
  'UHil/052pP9NcJr/S2iJ/0toif9LaIn/S2iJ/0toif9LaIn/S2iJ/0toif9PfbH/UYS//1GEv/9RhL//RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZM' +
  'U/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/' +
  'RkxT/0ZMU/9GTFP/RkxT/0ZMU/9GTFP/';

// ---- src/levels/rooms_keys_doors_puzzle.js ----
// GENERATED by tools/compile_rooms.py from reference/dumps/rooms_keys_doors_puzzle and games/dmlab_assets/maps. DO NOT EDIT.
// Geometry, placements and configs DMLab built: data, not code.
const DM_LEVEL = {"name":"rooms_keys_doors_puzzle","kind":"keys","episode_seconds":60,"sky":9033727,"seeds":[{"seed":0,"w":11,"h":12,"rows":["***********","***********","**  PI   **","**K K*   **","***H***H***","**   I   **","**   *K  **","***H***H***","**   I   **","**K  *  G**","***********","***********"],"doors":[[2,5,0],[4,3,0],[4,7,0],[5,5,0],[7,3,0],[7,7,0],[8,5,0]],"door_colours":["green","blue","black","red","red","green","white"],"door_boxes":[[5.46,0.01125,-10.0,5.54,1.01125,-9.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[3.0,0.01125,-7.54,4.0,1.01125,-7.46,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-7.54,8.0,1.01125,-7.46,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-7.0,5.54,1.01125,-6.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[3.0,0.01125,-4.54,4.0,1.01125,-4.46,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-4.54,8.0,1.01125,-4.46,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-4.0,5.54,1.01125,-3.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0]],"floor_boxes":[2.0,-0.06875,-10.0,9.0,0.01125,-9.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-9.0,5.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-9.0,9.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3.0,-0.06875,-8.0,4.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-8.0,8.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-7.0,9.0,0.01125,-6.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-6.0,5.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-6.0,9.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3.0,-0.06875,-5.0,4.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-5.0,8.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-4.0,9.0,0.01125,-3.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-3.0,5.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-3.0,9.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],"floor_z":1.125,"spawn":[450.0,950.0,25.125,-132.9290771484375],"items":[[250.0,850.0,0],[450.0,850.0,2],[650.0,550.0,1],[250.0,250.0,1],[850.0,250.0,3]],"cats":[[56,0.0964,0.8228,1.0,"blue"],[57,0.0964,0.8228,1.0,"green"],[58,0.0964,0.8228,1.0,"red"],[54,0.425,0.9225,50.0,null]],"goal":null,"pcells":[],"acells":[],"decals":[],"wall":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535],"floor":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535]},{"seed":1,"w":11,"h":9,"rows":["***********","***********","**   I   **","**K K*  G**","***H***H***","** P I   **","**  K*   **","***********","***********"],"doors":[[2,5,0],[4,3,0],[4,7,0],[5,5,0]],"door_colours":["blue","black","red","blue"],"door_boxes":[[5.46,0.01125,-7.0,5.54,1.01125,-6.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[3.0,0.01125,-4.54,4.0,1.01125,-4.46,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-4.54,8.0,1.01125,-4.46,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-4.0,5.54,1.01125,-3.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0]],"floor_boxes":[2.0,-0.06875,-7.0,9.0,0.01125,-6.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-6.0,5.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-6.0,9.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3.0,-0.06875,-5.0,4.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-5.0,8.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-4.0,9.0,0.01125,-3.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-3.0,5.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-3.0,9.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],"floor_z":1.125,"spawn":[350.0,350.0,25.125,149.6612548828125],"items":[[250.0,550.0,2],[450.0,550.0,1],[850.0,550.0,3],[450.0,250.0,0]],"cats":[[55,0.0964,0.8228,1.0,"black"],[56,0.0964,0.8228,1.0,"blue"],[59,0.0964,0.8228,1.0,"white"],[54,0.425,0.9225,50.0,null]],"goal":null,"pcells":[],"acells":[],"decals":[],"wall":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535],"floor":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535]},{"seed":2,"w":11,"h":12,"rows":["***********","***********","**P  I   **","**K  *   **","*** ***H***","**   I   **","**K  *  G**","***H*******","**   ******","**   ******","***********","***********"],"doors":[[2,5,0],[4,7,0],[5,5,0],[7,3,0]],"door_colours":["white","blue","black","black"],"door_boxes":[[5.46,0.01125,-10.0,5.54,1.01125,-9.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-7.54,8.0,1.01125,-7.46,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-7.0,5.54,1.01125,-6.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[3.0,0.01125,-4.54,4.0,1.01125,-4.46,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0]],"floor_boxes":[2.0,-0.06875,-10.0,9.0,0.01125,-9.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-9.0,5.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-9.0,9.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3.0,-0.06875,-8.0,4.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-8.0,8.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-7.0,9.0,0.01125,-6.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-6.0,5.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-6.0,9.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3.0,-0.06875,-5.0,4.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-4.0,5.0,0.01125,-3.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-3.0,5.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],"floor_z":1.125,"spawn":[250.0,950.0,25.125,-138.7298583984375],"items":[[250.0,850.0,1],[250.0,550.0,0],[850.0,550.0,2]],"cats":[[55,0.0964,0.8228,1.0,"black"],[59,0.0964,0.8228,1.0,"white"],[54,0.425,0.9225,50.0,null]],"goal":null,"pcells":[],"acells":[],"decals":[],"wall":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535],"floor":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535]},{"seed":3,"w":15,"h":12,"rows":["***************","***************","**********   **","**********  K**","***********H***","******   I   **","******K  *K  **","*******H***H***","**   I   I P **","**G  *  K*  K**","***************","***************"],"doors":[[4,11,0],[5,9,0],[7,7,0],[7,11,0],[8,5,0],[8,9,0]],"door_colours":["blue","red","white","white","black","blue"],"door_boxes":[[11.0,0.01125,-7.54,12.0,1.01125,-7.46,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[9.46,0.01125,-7.0,9.54,1.01125,-6.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-4.54,8.0,1.01125,-4.46,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[11.0,0.01125,-4.54,12.0,1.01125,-4.46,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-4.0,5.54,1.01125,-3.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[9.46,0.01125,-4.0,9.54,1.01125,-3.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0]],"floor_boxes":[10.0,-0.06875,-10.0,13.0,0.01125,-9.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,10.0,-0.06875,-9.0,13.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,11.0,-0.06875,-8.0,12.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-7.0,13.0,0.01125,-6.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-6.0,9.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,10.0,-0.06875,-6.0,13.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-5.0,8.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,11.0,-0.06875,-5.0,12.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-4.0,13.0,0.01125,-3.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-3.0,5.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-3.0,9.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,10.0,-0.06875,-3.0,13.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],"floor_z":1.125,"spawn":[1150.0,350.0,25.125,-153.8360595703125],"items":[[1250.0,850.0,0],[650.0,550.0,2],[1050.0,550.0,1],[250.0,250.0,4],[850.0,250.0,0],[1250.0,250.0,3]],"cats":[[55,0.0964,0.8228,1.0,"black"],[56,0.0964,0.8228,1.0,"blue"],[57,0.0964,0.8228,1.0,"green"],[59,0.0964,0.8228,1.0,"white"],[54,0.425,0.9225,50.0,null]],"goal":null,"pcells":[],"acells":[],"decals":[],"wall":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535],"floor":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535]},{"seed":4,"w":11,"h":12,"rows":["***********","***********","**   I   **","**  K*  G**","*** ***H***","**   I   **","** P *K  **","***H*******","**   ******","**   ******","***********","***********"],"doors":[[2,5,0],[4,7,0],[5,5,0],[7,3,0]],"door_colours":["white","white","black","blue"],"door_boxes":[[5.46,0.01125,-10.0,5.54,1.01125,-9.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-7.54,8.0,1.01125,-7.46,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-7.0,5.54,1.01125,-6.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[3.0,0.01125,-4.54,4.0,1.01125,-4.46,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0]],"floor_boxes":[2.0,-0.06875,-10.0,9.0,0.01125,-9.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-9.0,5.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-9.0,9.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3.0,-0.06875,-8.0,4.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-8.0,8.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-7.0,9.0,0.01125,-6.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-6.0,5.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-6.0,9.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3.0,-0.06875,-5.0,4.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-4.0,5.0,0.01125,-3.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-3.0,5.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],"floor_z":1.125,"spawn":[350.0,550.0,25.125,91.6864013671875],"items":[[450.0,850.0,1],[850.0,850.0,2],[650.0,550.0,0]],"cats":[[58,0.0964,0.8228,1.0,"red"],[59,0.0964,0.8228,1.0,"white"],[54,0.425,0.9225,50.0,null]],"goal":null,"pcells":[],"acells":[],"decals":[],"wall":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535],"floor":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535]},{"seed":5,"w":11,"h":9,"rows":["***********","***********","**   I  P**","**   *K  **","***H*** ***","**   I   **","**K G*   **","***********","***********"],"doors":[[2,5,0],[4,3,0],[5,5,0]],"door_colours":["blue","green","blue"],"door_boxes":[[5.46,0.01125,-7.0,5.54,1.01125,-6.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[3.0,0.01125,-4.54,4.0,1.01125,-4.46,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-4.0,5.54,1.01125,-3.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0]],"floor_boxes":[2.0,-0.06875,-7.0,9.0,0.01125,-6.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-6.0,5.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-6.0,9.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3.0,-0.06875,-5.0,4.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-5.0,8.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-4.0,9.0,0.01125,-3.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-3.0,5.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-3.0,9.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],"floor_z":1.125,"spawn":[850.0,650.0,25.125,50.99853515625],"items":[[650.0,550.0,0],[250.0,250.0,1],[450.0,250.0,2]],"cats":[[56,0.0964,0.8228,1.0,"blue"],[58,0.0964,0.8228,1.0,"red"],[54,0.425,0.9225,50.0,null]],"goal":null,"pcells":[],"acells":[],"decals":[],"wall":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535],"floor":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535]},{"seed":6,"w":15,"h":12,"rows":["***************","***************","******   I   **","******  G*   **","*******H***H***","**   I   I   **","**   *K  *KP **","*******H***H***","******   I   **","******K K*  K**","***************","***************"],"doors":[[2,9,0],[4,7,0],[4,11,0],[5,5,0],[5,9,0],[7,7,0],[7,11,0],[8,9,0]],"door_colours":["black","blue","green","white","green","black","red","green"],"door_boxes":[[9.46,0.01125,-10.0,9.54,1.01125,-9.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-7.54,8.0,1.01125,-7.46,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[11.0,0.01125,-7.54,12.0,1.01125,-7.46,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-7.0,5.54,1.01125,-6.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[9.46,0.01125,-7.0,9.54,1.01125,-6.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-4.54,8.0,1.01125,-4.46,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[11.0,0.01125,-4.54,12.0,1.01125,-4.46,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[9.46,0.01125,-4.0,9.54,1.01125,-3.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0]],"floor_boxes":[6.0,-0.06875,-10.0,13.0,0.01125,-9.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-9.0,9.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,10.0,-0.06875,-9.0,13.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-8.0,8.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,11.0,-0.06875,-8.0,12.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-7.0,13.0,0.01125,-6.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-6.0,5.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-6.0,9.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,10.0,-0.06875,-6.0,13.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-5.0,8.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,11.0,-0.06875,-5.0,12.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-4.0,13.0,0.01125,-3.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-3.0,9.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,10.0,-0.06875,-3.0,13.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],"floor_z":1.125,"spawn":[1150.0,550.0,25.125,-127.0843505859375],"items":[[850.0,850.0,4],[650.0,550.0,0],[1050.0,550.0,2],[650.0,250.0,3],[850.0,250.0,0],[1250.0,250.0,1]],"cats":[[56,0.0964,0.8228,1.0,"blue"],[57,0.0964,0.8228,1.0,"green"],[58,0.0964,0.8228,1.0,"red"],[59,0.0964,0.8228,1.0,"white"],[54,0.425,0.9225,50.0,null]],"goal":null,"pcells":[],"acells":[],"decals":[],"wall":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535],"floor":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535]},{"seed":7,"w":11,"h":12,"rows":["***********","***********","******   **","******   **","*******H***","**   I  P**","**   *   **","***H*** ***","**   I   **","**  G*K  **","***********","***********"],"doors":[[4,7,0],[5,5,0],[7,3,0],[8,5,0]],"door_colours":["red","green","blue","green"],"door_boxes":[[7.0,0.01125,-7.54,8.0,1.01125,-7.46,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-7.0,5.54,1.01125,-6.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[3.0,0.01125,-4.54,4.0,1.01125,-4.46,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-4.0,5.54,1.01125,-3.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0]],"floor_boxes":[6.0,-0.06875,-10.0,9.0,0.01125,-9.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-9.0,9.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-8.0,8.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-7.0,9.0,0.01125,-6.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-6.0,5.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-6.0,9.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3.0,-0.06875,-5.0,4.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-5.0,8.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-4.0,9.0,0.01125,-3.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-3.0,5.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-3.0,9.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],"floor_z":1.125,"spawn":[850.0,650.0,25.125,135.0933837890625],"items":[[450.0,250.0,1],[650.0,250.0,0]],"cats":[[57,0.0964,0.8228,1.0,"green"],[54,0.425,0.9225,50.0,null]],"goal":null,"pcells":[],"acells":[],"decals":[],"wall":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535],"floor":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535]},{"seed":8,"w":15,"h":12,"rows":["***************","***************","******   I   **","******K  *K  **","*******H***H***","**   I   I  P**","**   *K  *  K**","*******H***H***","******   I   **","******G  *K  **","***************","***************"],"doors":[[2,9,0],[4,7,0],[4,11,0],[5,5,0],[5,9,0],[7,7,0],[7,11,0],[8,9,0]],"door_colours":["blue","black","red","green","white","black","white","green"],"door_boxes":[[9.46,0.01125,-10.0,9.54,1.01125,-9.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-7.54,8.0,1.01125,-7.46,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[11.0,0.01125,-7.54,12.0,1.01125,-7.46,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-7.0,5.54,1.01125,-6.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[9.46,0.01125,-7.0,9.54,1.01125,-6.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-4.54,8.0,1.01125,-4.46,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[11.0,0.01125,-4.54,12.0,1.01125,-4.46,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[9.46,0.01125,-4.0,9.54,1.01125,-3.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0]],"floor_boxes":[6.0,-0.06875,-10.0,13.0,0.01125,-9.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-9.0,9.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,10.0,-0.06875,-9.0,13.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-8.0,8.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,11.0,-0.06875,-8.0,12.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-7.0,13.0,0.01125,-6.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-6.0,5.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-6.0,9.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,10.0,-0.06875,-6.0,13.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-5.0,8.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,11.0,-0.06875,-5.0,12.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-4.0,13.0,0.01125,-3.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-3.0,9.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,10.0,-0.06875,-3.0,13.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],"floor_z":1.125,"spawn":[1250.0,650.0,25.125,101.1566162109375],"items":[[650.0,850.0,0],[1050.0,850.0,3],[650.0,550.0,1],[1250.0,550.0,2],[650.0,250.0,4],[1050.0,250.0,1]],"cats":[[56,0.0964,0.8228,1.0,"blue"],[57,0.0964,0.8228,1.0,"green"],[58,0.0964,0.8228,1.0,"red"],[59,0.0964,0.8228,1.0,"white"],[54,0.425,0.9225,50.0,null]],"goal":null,"pcells":[],"acells":[],"decals":[],"wall":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535],"floor":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535]},{"seed":9,"w":15,"h":12,"rows":["***************","***************","**********   **","**********  K**","***********H***","******   I   **","******   *  K**","*******H***H***","**   I   IP  **","**G  *  K*K  **","***************","***************"],"doors":[[4,11,0],[5,9,0],[7,7,0],[7,11,0],[8,5,0],[8,9,0]],"door_colours":["black","red","green","white","green","black"],"door_boxes":[[11.0,0.01125,-7.54,12.0,1.01125,-7.46,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[9.46,0.01125,-7.0,9.54,1.01125,-6.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-4.54,8.0,1.01125,-4.46,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[11.0,0.01125,-4.54,12.0,1.01125,-4.46,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-4.0,5.54,1.01125,-3.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[9.46,0.01125,-4.0,9.54,1.01125,-3.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0]],"floor_boxes":[10.0,-0.06875,-10.0,13.0,0.01125,-9.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,10.0,-0.06875,-9.0,13.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,11.0,-0.06875,-8.0,12.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-7.0,13.0,0.01125,-6.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-6.0,9.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,10.0,-0.06875,-6.0,13.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-5.0,8.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,11.0,-0.06875,-5.0,12.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-4.0,13.0,0.01125,-3.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-3.0,5.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-3.0,9.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,10.0,-0.06875,-3.0,13.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],"floor_z":1.125,"spawn":[1050.0,350.0,25.125,17.20458984375],"items":[[1250.0,850.0,1],[1250.0,550.0,0],[250.0,250.0,3],[850.0,250.0,1],[1050.0,250.0,2]],"cats":[[55,0.0964,0.8228,1.0,"black"],[57,0.0964,0.8228,1.0,"green"],[59,0.0964,0.8228,1.0,"white"],[54,0.425,0.9225,50.0,null]],"goal":null,"pcells":[],"acells":[],"decals":[],"wall":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535],"floor":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535]},{"seed":10,"w":11,"h":12,"rows":["***********","***********","**   ******","**   ******","***H*******","**   I   **","**   *G  **","*** ***H***","**P  I   **","**K K*   **","***********","***********"],"doors":[[4,3,0],[5,5,0],[7,7,0],[8,5,0]],"door_colours":["white","white","red","black"],"door_boxes":[[3.0,0.01125,-7.54,4.0,1.01125,-7.46,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-7.0,5.54,1.01125,-6.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-4.54,8.0,1.01125,-4.46,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-4.0,5.54,1.01125,-3.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0]],"floor_boxes":[2.0,-0.06875,-10.0,5.0,0.01125,-9.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-9.0,5.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3.0,-0.06875,-8.0,4.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-7.0,9.0,0.01125,-6.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-6.0,5.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-6.0,9.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3.0,-0.06875,-5.0,4.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-5.0,8.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-4.0,9.0,0.01125,-3.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-3.0,5.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-3.0,9.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],"floor_z":1.125,"spawn":[250.0,350.0,25.125,69.620361328125],"items":[[650.0,550.0,2],[250.0,250.0,1],[450.0,250.0,0]],"cats":[[58,0.0964,0.8228,1.0,"red"],[59,0.0964,0.8228,1.0,"white"],[54,0.425,0.9225,50.0,null]],"goal":null,"pcells":[],"acells":[],"decals":[],"wall":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535],"floor":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535]},{"seed":11,"w":11,"h":9,"rows":["***********","***********","**   I   **","**  G*K  **","***H*** ***","**   I  P**","**   *   **","***********","***********"],"doors":[[2,5,0],[4,3,0],[5,5,0]],"door_colours":["red","red","white"],"door_boxes":[[5.46,0.01125,-7.0,5.54,1.01125,-6.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[3.0,0.01125,-4.54,4.0,1.01125,-4.46,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-4.0,5.54,1.01125,-3.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0]],"floor_boxes":[2.0,-0.06875,-7.0,9.0,0.01125,-6.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-6.0,5.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-6.0,9.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3.0,-0.06875,-5.0,4.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-5.0,8.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-4.0,9.0,0.01125,-3.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-3.0,5.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-3.0,9.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],"floor_z":1.125,"spawn":[850.0,350.0,25.125,121.2176513671875],"items":[[450.0,550.0,1],[650.0,550.0,0]],"cats":[[58,0.0964,0.8228,1.0,"red"],[54,0.425,0.9225,50.0,null]],"goal":null,"pcells":[],"acells":[],"decals":[],"wall":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535],"floor":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535]},{"seed":12,"w":15,"h":9,"rows":["***************","***************","**   I P I   **","**   *  K*  K**","***H***H***H***","**   I   I   **","**  K*K K*G  **","***************","***************"],"doors":[[2,5,0],[2,9,0],[4,3,0],[4,7,0],[4,11,0],[5,5,0],[5,9,0]],"door_colours":["red","red","black","white","blue","red","black"],"door_boxes":[[5.46,0.01125,-7.0,5.54,1.01125,-6.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[9.46,0.01125,-7.0,9.54,1.01125,-6.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[3.0,0.01125,-4.54,4.0,1.01125,-4.46,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-4.54,8.0,1.01125,-4.46,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[11.0,0.01125,-4.54,12.0,1.01125,-4.46,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-4.0,5.54,1.01125,-3.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[9.46,0.01125,-4.0,9.54,1.01125,-3.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0]],"floor_boxes":[2.0,-0.06875,-7.0,13.0,0.01125,-6.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-6.0,5.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-6.0,9.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,10.0,-0.06875,-6.0,13.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3.0,-0.06875,-5.0,4.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-5.0,8.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,11.0,-0.06875,-5.0,12.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-4.0,13.0,0.01125,-3.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-3.0,5.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-3.0,9.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,10.0,-0.06875,-3.0,13.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],"floor_z":1.125,"spawn":[750.0,650.0,25.125,88.604736328125],"items":[[850.0,550.0,3],[1250.0,550.0,0],[450.0,250.0,0],[650.0,250.0,2],[850.0,250.0,1],[1050.0,250.0,4]],"cats":[[56,0.0964,0.8228,1.0,"blue"],[57,0.0964,0.8228,1.0,"green"],[58,0.0964,0.8228,1.0,"red"],[59,0.0964,0.8228,1.0,"white"],[54,0.425,0.9225,50.0,null]],"goal":null,"pcells":[],"acells":[],"decals":[],"wall":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535],"floor":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535]},{"seed":13,"w":11,"h":12,"rows":["***********","***********","**   I   **","**  G*K  **","***H*** ***","**   IP  **","**   *   **","*******H***","******   **","******   **","***********","***********"],"doors":[[2,5,0],[4,3,0],[5,5,0],[7,7,0]],"door_colours":["black","red","black","red"],"door_boxes":[[5.46,0.01125,-10.0,5.54,1.01125,-9.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[3.0,0.01125,-7.54,4.0,1.01125,-7.46,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-7.0,5.54,1.01125,-6.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-4.54,8.0,1.01125,-4.46,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0]],"floor_boxes":[2.0,-0.06875,-10.0,9.0,0.01125,-9.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-9.0,5.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-9.0,9.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3.0,-0.06875,-8.0,4.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-8.0,8.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-7.0,9.0,0.01125,-6.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-6.0,5.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-6.0,9.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-5.0,8.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-4.0,9.0,0.01125,-3.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-3.0,9.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],"floor_z":1.125,"spawn":[650.0,650.0,25.125,110.6048583984375],"items":[[450.0,850.0,1],[650.0,850.0,0]],"cats":[[55,0.0964,0.8228,1.0,"black"],[54,0.425,0.9225,50.0,null]],"goal":null,"pcells":[],"acells":[],"decals":[],"wall":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535],"floor":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535]},{"seed":14,"w":15,"h":9,"rows":["***************","***************","**   I       **","**   *   *   **","***H***H***H***","**   I P I   **","**  K*K K*  G**","***************","***************"],"doors":[[2,5,0],[4,3,0],[4,7,0],[4,11,0],[5,5,0],[5,9,0]],"door_colours":["red","green","blue","green","blue","black"],"door_boxes":[[5.46,0.01125,-7.0,5.54,1.01125,-6.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[3.0,0.01125,-4.54,4.0,1.01125,-4.46,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-4.54,8.0,1.01125,-4.46,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[11.0,0.01125,-4.54,12.0,1.01125,-4.46,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-4.0,5.54,1.01125,-3.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[9.46,0.01125,-4.0,9.54,1.01125,-3.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0]],"floor_boxes":[2.0,-0.06875,-7.0,13.0,0.01125,-6.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-6.0,5.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-6.0,9.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,10.0,-0.06875,-6.0,13.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3.0,-0.06875,-5.0,4.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-5.0,8.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,11.0,-0.06875,-5.0,12.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-4.0,13.0,0.01125,-3.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-3.0,5.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-3.0,9.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,10.0,-0.06875,-3.0,13.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],"floor_z":1.125,"spawn":[750.0,350.0,25.125,13.392333984375],"items":[[450.0,250.0,1],[650.0,250.0,0],[850.0,250.0,1],[1250.0,250.0,2]],"cats":[[56,0.0964,0.8228,1.0,"blue"],[57,0.0964,0.8228,1.0,"green"],[54,0.425,0.9225,50.0,null]],"goal":null,"pcells":[],"acells":[],"decals":[],"wall":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535],"floor":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535]},{"seed":15,"w":15,"h":12,"rows":["***************","***************","******   I   **","******G  *  K**","*******H***H***","******   I   **","******  K*  K**","*******H*** ***","**   I   I   **","**   *   * P **","***************","***************"],"doors":[[2,9,0],[4,7,0],[4,11,0],[5,9,0],[7,7,0],[8,5,0],[8,9,0]],"door_colours":["blue","green","white","white","white","black","red"],"door_boxes":[[9.46,0.01125,-10.0,9.54,1.01125,-9.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-7.54,8.0,1.01125,-7.46,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[11.0,0.01125,-7.54,12.0,1.01125,-7.46,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[9.46,0.01125,-7.0,9.54,1.01125,-6.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-4.54,8.0,1.01125,-4.46,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-4.0,5.54,1.01125,-3.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[9.46,0.01125,-4.0,9.54,1.01125,-3.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0]],"floor_boxes":[6.0,-0.06875,-10.0,13.0,0.01125,-9.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-9.0,9.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,10.0,-0.06875,-9.0,13.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-8.0,8.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,11.0,-0.06875,-8.0,12.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-7.0,13.0,0.01125,-6.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-6.0,9.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,10.0,-0.06875,-6.0,13.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-5.0,8.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,11.0,-0.06875,-5.0,12.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-4.0,13.0,0.01125,-3.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-3.0,5.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-3.0,9.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,10.0,-0.06875,-3.0,13.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],"floor_z":1.125,"spawn":[1150.0,250.0,25.125,-49.15283203125],"items":[[650.0,850.0,2],[1250.0,850.0,0],[850.0,550.0,0],[1250.0,550.0,1]],"cats":[[57,0.0964,0.8228,1.0,"green"],[59,0.0964,0.8228,1.0,"white"],[54,0.425,0.9225,50.0,null]],"goal":null,"pcells":[],"acells":[],"decals":[],"wall":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535],"floor":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535]},{"seed":16,"w":11,"h":12,"rows":["***********","***********","**   I P **","**   *  K**","***H***H***","**   I   **","**  K*K K**","***H***H***","**   I   **","**G  *K  **","***********","***********"],"doors":[[2,5,0],[4,3,0],[4,7,0],[5,5,0],[7,3,0],[7,7,0],[8,5,0]],"door_colours":["green","blue","green","white","red","white","blue"],"door_boxes":[[5.46,0.01125,-10.0,5.54,1.01125,-9.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[3.0,0.01125,-7.54,4.0,1.01125,-7.46,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-7.54,8.0,1.01125,-7.46,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-7.0,5.54,1.01125,-6.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[3.0,0.01125,-4.54,4.0,1.01125,-4.46,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-4.54,8.0,1.01125,-4.46,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-4.0,5.54,1.01125,-3.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0]],"floor_boxes":[2.0,-0.06875,-10.0,9.0,0.01125,-9.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-9.0,5.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-9.0,9.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3.0,-0.06875,-8.0,4.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-8.0,8.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-7.0,9.0,0.01125,-6.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-6.0,5.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-6.0,9.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3.0,-0.06875,-5.0,4.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-5.0,8.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-4.0,9.0,0.01125,-3.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-3.0,5.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-3.0,9.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],"floor_z":1.125,"spawn":[750.0,950.0,25.125,162.7569580078125],"items":[[850.0,850.0,1],[450.0,550.0,2],[650.0,550.0,3],[850.0,550.0,0],[250.0,250.0,4],[650.0,250.0,2]],"cats":[[55,0.0964,0.8228,1.0,"black"],[57,0.0964,0.8228,1.0,"green"],[58,0.0964,0.8228,1.0,"red"],[59,0.0964,0.8228,1.0,"white"],[54,0.425,0.9225,50.0,null]],"goal":null,"pcells":[],"acells":[],"decals":[],"wall":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535],"floor":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535]},{"seed":17,"w":11,"h":12,"rows":["***********","***********","**   ******","**   ******","***H*******","**   I   **","** P *   **","*** ***H***","**   I   **","**K  *G  **","***********","***********"],"doors":[[4,3,0],[5,5,0],[7,7,0],[8,5,0]],"door_colours":["white","blue","red","blue"],"door_boxes":[[3.0,0.01125,-7.54,4.0,1.01125,-7.46,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-7.0,5.54,1.01125,-6.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-4.54,8.0,1.01125,-4.46,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-4.0,5.54,1.01125,-3.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0]],"floor_boxes":[2.0,-0.06875,-10.0,5.0,0.01125,-9.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-9.0,5.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3.0,-0.06875,-8.0,4.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-7.0,9.0,0.01125,-6.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-6.0,5.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-6.0,9.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3.0,-0.06875,-5.0,4.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-5.0,8.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-4.0,9.0,0.01125,-3.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-3.0,5.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-3.0,9.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],"floor_z":1.125,"spawn":[350.0,550.0,25.125,-159.9554443359375],"items":[[250.0,250.0,0],[650.0,250.0,1]],"cats":[[56,0.0964,0.8228,1.0,"blue"],[54,0.425,0.9225,50.0,null]],"goal":null,"pcells":[],"acells":[],"decals":[],"wall":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535],"floor":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535]},{"seed":18,"w":15,"h":12,"rows":["***************","***************","******   ******","******K  ******","*******H*******","**   I  PI   **","**   *K K*K K**","***H***H*******","**   I   ******","**  G*   ******","***************","***************"],"doors":[[4,7,0],[5,5,0],[5,9,0],[7,3,0],[7,7,0],[8,5,0]],"door_colours":["red","white","white","black","black","blue"],"door_boxes":[[7.0,0.01125,-7.54,8.0,1.01125,-7.46,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-7.0,5.54,1.01125,-6.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[9.46,0.01125,-7.0,9.54,1.01125,-6.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[3.0,0.01125,-4.54,4.0,1.01125,-4.46,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-4.54,8.0,1.01125,-4.46,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-4.0,5.54,1.01125,-3.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0]],"floor_boxes":[6.0,-0.06875,-10.0,9.0,0.01125,-9.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-9.0,9.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-8.0,8.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-7.0,13.0,0.01125,-6.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-6.0,5.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-6.0,9.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,10.0,-0.06875,-6.0,13.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3.0,-0.06875,-5.0,4.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-5.0,8.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-4.0,9.0,0.01125,-3.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-3.0,5.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-3.0,9.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],"floor_z":1.125,"spawn":[850.0,650.0,25.125,-92.8948974609375],"items":[[650.0,850.0,3],[650.0,550.0,0],[850.0,550.0,2],[1050.0,550.0,1],[1250.0,550.0,0],[450.0,250.0,4]],"cats":[[55,0.0964,0.8228,1.0,"black"],[57,0.0964,0.8228,1.0,"green"],[58,0.0964,0.8228,1.0,"red"],[59,0.0964,0.8228,1.0,"white"],[54,0.425,0.9225,50.0,null]],"goal":null,"pcells":[],"acells":[],"decals":[],"wall":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535],"floor":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535]},{"seed":19,"w":11,"h":12,"rows":["***********","***********","**   I   **","**K  *  G**","***H***H***","**   I   **","**K  *  K**","***H***H***","**P  I   **","**  K*   **","***********","***********"],"doors":[[2,5,0],[4,3,0],[4,7,0],[5,5,0],[7,3,0],[7,7,0],[8,5,0]],"door_colours":["red","blue","black","blue","white","red","white"],"door_boxes":[[5.46,0.01125,-10.0,5.54,1.01125,-9.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[3.0,0.01125,-7.54,4.0,1.01125,-7.46,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-7.54,8.0,1.01125,-7.46,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-7.0,5.54,1.01125,-6.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[3.0,0.01125,-4.54,4.0,1.01125,-4.46,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-4.54,8.0,1.01125,-4.46,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-4.0,5.54,1.01125,-3.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0]],"floor_boxes":[2.0,-0.06875,-10.0,9.0,0.01125,-9.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-9.0,5.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-9.0,9.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3.0,-0.06875,-8.0,4.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-8.0,8.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-7.0,9.0,0.01125,-6.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-6.0,5.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-6.0,9.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3.0,-0.06875,-5.0,4.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-5.0,8.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-4.0,9.0,0.01125,-3.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-3.0,5.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-3.0,9.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],"floor_z":1.125,"spawn":[250.0,350.0,25.125,-6.383056640625],"items":[[250.0,850.0,0],[850.0,850.0,3],[250.0,550.0,1],[850.0,550.0,0],[450.0,250.0,2]],"cats":[[55,0.0964,0.8228,1.0,"black"],[56,0.0964,0.8228,1.0,"blue"],[59,0.0964,0.8228,1.0,"white"],[54,0.425,0.9225,50.0,null]],"goal":null,"pcells":[],"acells":[],"decals":[],"wall":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535],"floor":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535]},{"seed":20,"w":15,"h":12,"rows":["***************","***************","**   I   ******","**  K*   ******","***H***H*******","**   I   ******","**   *K  ******","***H***H*******","**   I   I   **","**KPK*G  *   **","***************","***************"],"doors":[[2,5,0],[4,3,0],[4,7,0],[5,5,0],[7,3,0],[7,7,0],[8,5,0],[8,9,0]],"door_colours":["white","white","green","white","blue","black","red","green"],"door_boxes":[[5.46,0.01125,-10.0,5.54,1.01125,-9.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[3.0,0.01125,-7.54,4.0,1.01125,-7.46,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-7.54,8.0,1.01125,-7.46,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-7.0,5.54,1.01125,-6.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[3.0,0.01125,-4.54,4.0,1.01125,-4.46,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-4.54,8.0,1.01125,-4.46,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-4.0,5.54,1.01125,-3.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[9.46,0.01125,-4.0,9.54,1.01125,-3.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0]],"floor_boxes":[2.0,-0.06875,-10.0,9.0,0.01125,-9.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-9.0,5.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-9.0,9.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3.0,-0.06875,-8.0,4.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-8.0,8.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-7.0,9.0,0.01125,-6.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-6.0,5.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-6.0,9.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3.0,-0.06875,-5.0,4.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-5.0,8.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-4.0,13.0,0.01125,-3.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-3.0,5.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-3.0,9.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,10.0,-0.06875,-3.0,13.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],"floor_z":1.125,"spawn":[350.0,250.0,25.125,17.99560546875],"items":[[450.0,850.0,0],[650.0,550.0,0],[250.0,250.0,2],[450.0,250.0,1],[650.0,250.0,3]],"cats":[[55,0.0964,0.8228,1.0,"black"],[56,0.0964,0.8228,1.0,"blue"],[59,0.0964,0.8228,1.0,"white"],[54,0.425,0.9225,50.0,null]],"goal":null,"pcells":[],"acells":[],"decals":[],"wall":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535],"floor":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535]},{"seed":21,"w":15,"h":12,"rows":["***************","***************","**   I   I P **","**   *   *  K**","*******H***H***","******   I   **","******   *K K**","*******H***H***","******   I   **","******G  *  K**","***************","***************"],"doors":[[2,5,0],[2,9,0],[4,7,0],[4,11,0],[5,9,0],[7,7,0],[7,11,0],[8,9,0]],"door_colours":["black","red","blue","green","red","white","red","black"],"door_boxes":[[5.46,0.01125,-10.0,5.54,1.01125,-9.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[9.46,0.01125,-10.0,9.54,1.01125,-9.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-7.54,8.0,1.01125,-7.46,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[11.0,0.01125,-7.54,12.0,1.01125,-7.46,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[9.46,0.01125,-7.0,9.54,1.01125,-6.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-4.54,8.0,1.01125,-4.46,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[11.0,0.01125,-4.54,12.0,1.01125,-4.46,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[9.46,0.01125,-4.0,9.54,1.01125,-3.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0]],"floor_boxes":[2.0,-0.06875,-10.0,13.0,0.01125,-9.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-9.0,5.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-9.0,9.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,10.0,-0.06875,-9.0,13.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-8.0,8.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,11.0,-0.06875,-8.0,12.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-7.0,13.0,0.01125,-6.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-6.0,9.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,10.0,-0.06875,-6.0,13.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-5.0,8.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,11.0,-0.06875,-5.0,12.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-4.0,13.0,0.01125,-3.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-3.0,9.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,10.0,-0.06875,-3.0,13.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],"floor_z":1.125,"spawn":[1150.0,950.0,25.125,58.82080078125],"items":[[1250.0,850.0,0],[1050.0,550.0,2],[1250.0,550.0,1],[650.0,250.0,3],[1250.0,250.0,2]],"cats":[[57,0.0964,0.8228,1.0,"green"],[58,0.0964,0.8228,1.0,"red"],[59,0.0964,0.8228,1.0,"white"],[54,0.425,0.9225,50.0,null]],"goal":null,"pcells":[],"acells":[],"decals":[],"wall":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535],"floor":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535]},{"seed":22,"w":11,"h":12,"rows":["***********","***********","**   I   **","**  K*G  **","***H***H***","**   I   **","**K K*   **","*** ***H***","**   I   **","** P *   **","***********","***********"],"doors":[[2,5,0],[4,3,0],[4,7,0],[5,5,0],[7,7,0],[8,5,0]],"door_colours":["blue","green","red","green","white","green"],"door_boxes":[[5.46,0.01125,-10.0,5.54,1.01125,-9.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[3.0,0.01125,-7.54,4.0,1.01125,-7.46,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-7.54,8.0,1.01125,-7.46,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-7.0,5.54,1.01125,-6.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-4.54,8.0,1.01125,-4.46,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-4.0,5.54,1.01125,-3.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0]],"floor_boxes":[2.0,-0.06875,-10.0,9.0,0.01125,-9.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-9.0,5.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-9.0,9.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3.0,-0.06875,-8.0,4.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-8.0,8.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-7.0,9.0,0.01125,-6.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-6.0,5.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-6.0,9.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3.0,-0.06875,-5.0,4.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-5.0,8.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-4.0,9.0,0.01125,-3.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-3.0,5.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-3.0,9.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],"floor_z":1.125,"spawn":[350.0,250.0,25.125,83.397216796875],"items":[[450.0,850.0,1],[650.0,850.0,2],[250.0,550.0,0],[450.0,550.0,1]],"cats":[[57,0.0964,0.8228,1.0,"green"],[58,0.0964,0.8228,1.0,"red"],[54,0.425,0.9225,50.0,null]],"goal":null,"pcells":[],"acells":[],"decals":[],"wall":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535],"floor":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535]},{"seed":23,"w":11,"h":12,"rows":["***********","***********","******   **","******   **","*******H***","******   **","****** P **","******* ***","**   I   **","**  G*K K**","***********","***********"],"doors":[[4,7,0],[8,5,0]],"door_colours":["black","black"],"door_boxes":[[7.0,0.01125,-7.54,8.0,1.01125,-7.46,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-4.0,5.54,1.01125,-3.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0]],"floor_boxes":[6.0,-0.06875,-10.0,9.0,0.01125,-9.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-9.0,9.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-8.0,8.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-7.0,9.0,0.01125,-6.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-6.0,9.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-5.0,8.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-4.0,9.0,0.01125,-3.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-3.0,5.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-3.0,9.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],"floor_z":1.125,"spawn":[750.0,550.0,25.125,109.5501708984375],"items":[[450.0,250.0,2],[650.0,250.0,1],[850.0,250.0,0]],"cats":[[55,0.0964,0.8228,1.0,"black"],[57,0.0964,0.8228,1.0,"green"],[54,0.425,0.9225,50.0,null]],"goal":null,"pcells":[],"acells":[],"decals":[],"wall":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535],"floor":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535]},{"seed":24,"w":15,"h":12,"rows":["***************","***************","******   I   **","******   *  K**","******* ***H***","**   I P I   **","**  K*  K*  G**","*******H*******","******   ******","******   ******","***************","***************"],"doors":[[2,9,0],[4,11,0],[5,5,0],[5,9,0],[7,7,0]],"door_colours":["black","white","black","blue","black"],"door_boxes":[[9.46,0.01125,-10.0,9.54,1.01125,-9.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[11.0,0.01125,-7.54,12.0,1.01125,-7.46,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-7.0,5.54,1.01125,-6.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[9.46,0.01125,-7.0,9.54,1.01125,-6.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-4.54,8.0,1.01125,-4.46,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0]],"floor_boxes":[6.0,-0.06875,-10.0,13.0,0.01125,-9.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-9.0,9.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,10.0,-0.06875,-9.0,13.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-8.0,8.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,11.0,-0.06875,-8.0,12.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-7.0,13.0,0.01125,-6.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-6.0,5.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-6.0,9.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,10.0,-0.06875,-6.0,13.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-5.0,8.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-4.0,9.0,0.01125,-3.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-3.0,9.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],"floor_z":1.125,"spawn":[750.0,650.0,25.125,-123.0303955078125],"items":[[1250.0,850.0,1],[450.0,550.0,1],[850.0,550.0,0],[1250.0,550.0,2]],"cats":[[55,0.0964,0.8228,1.0,"black"],[59,0.0964,0.8228,1.0,"white"],[54,0.425,0.9225,50.0,null]],"goal":null,"pcells":[],"acells":[],"decals":[],"wall":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535],"floor":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535]},{"seed":25,"w":15,"h":12,"rows":["***************","***************","**P  I   I   **","**  K*K  *   **","***H***H*******","**   I   ******","**   *  K******","***H***H*******","**   I   ******","**  K*G  ******","***************","***************"],"doors":[[2,5,0],[2,9,0],[4,3,0],[4,7,0],[5,5,0],[7,3,0],[7,7,0],[8,5,0]],"door_colours":["white","green","red","blue","black","white","red","black"],"door_boxes":[[5.46,0.01125,-10.0,5.54,1.01125,-9.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[9.46,0.01125,-10.0,9.54,1.01125,-9.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[3.0,0.01125,-7.54,4.0,1.01125,-7.46,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-7.54,8.0,1.01125,-7.46,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-7.0,5.54,1.01125,-6.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[3.0,0.01125,-4.54,4.0,1.01125,-4.46,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-4.54,8.0,1.01125,-4.46,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-4.0,5.54,1.01125,-3.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0]],"floor_boxes":[2.0,-0.06875,-10.0,13.0,0.01125,-9.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-9.0,5.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-9.0,9.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,10.0,-0.06875,-9.0,13.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3.0,-0.06875,-8.0,4.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-8.0,8.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-7.0,9.0,0.01125,-6.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-6.0,5.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-6.0,9.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3.0,-0.06875,-5.0,4.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-5.0,8.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-4.0,9.0,0.01125,-3.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-3.0,5.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-3.0,9.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],"floor_z":1.125,"spawn":[250.0,950.0,25.125,-99.3109130859375],"items":[[450.0,850.0,2],[650.0,850.0,0],[850.0,550.0,1],[450.0,250.0,1],[650.0,250.0,3]],"cats":[[56,0.0964,0.8228,1.0,"blue"],[58,0.0964,0.8228,1.0,"red"],[59,0.0964,0.8228,1.0,"white"],[54,0.425,0.9225,50.0,null]],"goal":null,"pcells":[],"acells":[],"decals":[],"wall":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535],"floor":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535]},{"seed":26,"w":11,"h":9,"rows":["***********","***********","**   I   **","**  K*  G**","*** ***H***","**P  I   **","**   *   **","***********","***********"],"doors":[[2,5,0],[4,7,0],[5,5,0]],"door_colours":["white","blue","white"],"door_boxes":[[5.46,0.01125,-7.0,5.54,1.01125,-6.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-4.54,8.0,1.01125,-4.46,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-4.0,5.54,1.01125,-3.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0]],"floor_boxes":[2.0,-0.06875,-7.0,9.0,0.01125,-6.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-6.0,5.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-6.0,9.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3.0,-0.06875,-5.0,4.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-5.0,8.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-4.0,9.0,0.01125,-3.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-3.0,5.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-3.0,9.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],"floor_z":1.125,"spawn":[250.0,350.0,25.125,104.8260498046875],"items":[[450.0,550.0,0],[850.0,550.0,1]],"cats":[[59,0.0964,0.8228,1.0,"white"],[54,0.425,0.9225,50.0,null]],"goal":null,"pcells":[],"acells":[],"decals":[],"wall":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535],"floor":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535]},{"seed":27,"w":15,"h":12,"rows":["***************","***************","**P  I   I   **","**  K*  K*   **","*** ***H*******","**   I   ******","**  K*   ******","***H***H*******","**   I   ******","**K  *G  ******","***************","***************"],"doors":[[2,5,0],[2,9,0],[4,7,0],[5,5,0],[7,3,0],[7,7,0],[8,5,0]],"door_colours":["white","black","green","red","red","green","white"],"door_boxes":[[5.46,0.01125,-10.0,5.54,1.01125,-9.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[9.46,0.01125,-10.0,9.54,1.01125,-9.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-7.54,8.0,1.01125,-7.46,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-7.0,5.54,1.01125,-6.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[3.0,0.01125,-4.54,4.0,1.01125,-4.46,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-4.54,8.0,1.01125,-4.46,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-4.0,5.54,1.01125,-3.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0]],"floor_boxes":[2.0,-0.06875,-10.0,13.0,0.01125,-9.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-9.0,5.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-9.0,9.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,10.0,-0.06875,-9.0,13.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3.0,-0.06875,-8.0,4.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-8.0,8.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-7.0,9.0,0.01125,-6.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-6.0,5.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-6.0,9.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3.0,-0.06875,-5.0,4.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-5.0,8.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-4.0,9.0,0.01125,-3.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-3.0,5.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-3.0,9.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],"floor_z":1.125,"spawn":[250.0,950.0,25.125,96.5203857421875],"items":[[450.0,850.0,1],[850.0,850.0,0],[450.0,550.0,2],[250.0,250.0,1],[650.0,250.0,3]],"cats":[[56,0.0964,0.8228,1.0,"blue"],[57,0.0964,0.8228,1.0,"green"],[58,0.0964,0.8228,1.0,"red"],[54,0.425,0.9225,50.0,null]],"goal":null,"pcells":[],"acells":[],"decals":[],"wall":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535],"floor":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535]},{"seed":28,"w":15,"h":12,"rows":["***************","***************","**   I   ******","**  K*  K******","***H***H*******","**  PI   I   **","**K  *  K*   **","***H***H*******","**   I   ******","**K  *  G******","***************","***************"],"doors":[[2,5,0],[4,3,0],[4,7,0],[5,5,0],[5,9,0],[7,3,0],[7,7,0],[8,5,0]],"door_colours":["green","black","blue","white","white","white","green","red"],"door_boxes":[[5.46,0.01125,-10.0,5.54,1.01125,-9.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[3.0,0.01125,-7.54,4.0,1.01125,-7.46,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-7.54,8.0,1.01125,-7.46,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-7.0,5.54,1.01125,-6.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[9.46,0.01125,-7.0,9.54,1.01125,-6.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[3.0,0.01125,-4.54,4.0,1.01125,-4.46,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-4.54,8.0,1.01125,-4.46,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-4.0,5.54,1.01125,-3.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0]],"floor_boxes":[2.0,-0.06875,-10.0,9.0,0.01125,-9.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-9.0,5.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-9.0,9.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3.0,-0.06875,-8.0,4.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-8.0,8.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-7.0,13.0,0.01125,-6.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-6.0,5.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-6.0,9.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,10.0,-0.06875,-6.0,13.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3.0,-0.06875,-5.0,4.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-5.0,8.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-4.0,9.0,0.01125,-3.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-3.0,5.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-3.0,9.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],"floor_z":1.125,"spawn":[450.0,650.0,25.125,-60.567626953125],"items":[[450.0,850.0,3],[850.0,850.0,1],[250.0,550.0,0],[850.0,550.0,2],[250.0,250.0,2],[850.0,250.0,4]],"cats":[[55,0.0964,0.8228,1.0,"black"],[56,0.0964,0.8228,1.0,"blue"],[58,0.0964,0.8228,1.0,"red"],[59,0.0964,0.8228,1.0,"white"],[54,0.425,0.9225,50.0,null]],"goal":null,"pcells":[],"acells":[],"decals":[],"wall":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535],"floor":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535]},{"seed":29,"w":15,"h":9,"rows":["***************","***************","**   I  PI   **","**   *K K*G  **","*******H*******","******   ******","******   ******","***************","***************"],"doors":[[2,5,0],[2,9,0],[4,7,0]],"door_colours":["white","blue","blue"],"door_boxes":[[5.46,0.01125,-7.0,5.54,1.01125,-6.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[9.46,0.01125,-7.0,9.54,1.01125,-6.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-4.54,8.0,1.01125,-4.46,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0]],"floor_boxes":[2.0,-0.06875,-7.0,13.0,0.01125,-6.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-6.0,5.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-6.0,9.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,10.0,-0.06875,-6.0,13.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-5.0,8.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-4.0,9.0,0.01125,-3.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-3.0,9.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],"floor_z":1.125,"spawn":[850.0,650.0,25.125,-46.241455078125],"items":[[650.0,550.0,0],[850.0,550.0,1],[1050.0,550.0,2]],"cats":[[56,0.0964,0.8228,1.0,"blue"],[57,0.0964,0.8228,1.0,"green"],[54,0.425,0.9225,50.0,null]],"goal":null,"pcells":[],"acells":[],"decals":[],"wall":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535],"floor":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535]},{"seed":30,"w":11,"h":12,"rows":["***********","***********","******   **","******   **","*******H***","**   IP  **","**K  *K  **","***H***H***","**   I   **","**  G*K K**","***********","***********"],"doors":[[4,7,0],[5,5,0],[7,3,0],[7,7,0],[8,5,0]],"door_colours":["blue","blue","black","blue","green"],"door_boxes":[[7.0,0.01125,-7.54,8.0,1.01125,-7.46,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-7.0,5.54,1.01125,-6.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[3.0,0.01125,-4.54,4.0,1.01125,-4.46,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-4.54,8.0,1.01125,-4.46,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-4.0,5.54,1.01125,-3.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0]],"floor_boxes":[6.0,-0.06875,-10.0,9.0,0.01125,-9.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-9.0,9.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-8.0,8.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-7.0,9.0,0.01125,-6.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-6.0,5.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-6.0,9.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3.0,-0.06875,-5.0,4.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-5.0,8.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-4.0,9.0,0.01125,-3.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-3.0,5.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-3.0,9.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],"floor_z":1.125,"spawn":[650.0,650.0,25.125,-123.8983154296875],"items":[[250.0,550.0,1],[650.0,550.0,0],[450.0,250.0,3],[650.0,250.0,1],[850.0,250.0,2]],"cats":[[56,0.0964,0.8228,1.0,"blue"],[57,0.0964,0.8228,1.0,"green"],[59,0.0964,0.8228,1.0,"white"],[54,0.425,0.9225,50.0,null]],"goal":null,"pcells":[],"acells":[],"decals":[],"wall":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535],"floor":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535]},{"seed":31,"w":15,"h":12,"rows":["***************","***************","**   I   ******","**   *G  ******","***H***H*******","**  PI   I   **","**  K*  K*   **","***H***H*******","**   I   ******","**  K*  K******","***************","***************"],"doors":[[2,5,0],[4,3,0],[4,7,0],[5,5,0],[5,9,0],[7,3,0],[7,7,0],[8,5,0]],"door_colours":["blue","green","black","green","red","white","blue","green"],"door_boxes":[[5.46,0.01125,-10.0,5.54,1.01125,-9.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[3.0,0.01125,-7.54,4.0,1.01125,-7.46,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-7.54,8.0,1.01125,-7.46,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,53.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-7.0,5.54,1.01125,-6.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[9.46,0.01125,-7.0,9.54,1.01125,-6.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,49.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[3.0,0.01125,-4.54,4.0,1.01125,-4.46,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,52.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[7.0,0.01125,-4.54,8.0,1.01125,-4.46,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,51.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0],[5.46,0.01125,-4.0,5.54,1.01125,-3.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,50.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0]],"floor_boxes":[2.0,-0.06875,-10.0,9.0,0.01125,-9.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-9.0,5.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-9.0,9.0,0.01125,-8.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3.0,-0.06875,-8.0,4.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-8.0,8.0,0.01125,-7.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-7.0,13.0,0.01125,-6.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-6.0,5.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-6.0,9.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,10.0,-0.06875,-6.0,13.0,0.01125,-5.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3.0,-0.06875,-5.0,4.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,7.0,-0.06875,-5.0,8.0,0.01125,-4.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-4.0,9.0,0.01125,-3.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,-0.06875,-3.0,5.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,6.0,-0.06875,-3.0,9.0,0.01125,-2.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],"floor_z":1.125,"spawn":[450.0,650.0,25.125,-141.1358642578125],"items":[[650.0,850.0,3],[450.0,550.0,2],[850.0,550.0,0],[450.0,250.0,1],[850.0,250.0,0]],"cats":[[55,0.0964,0.8228,1.0,"black"],[57,0.0964,0.8228,1.0,"green"],[59,0.0964,0.8228,1.0,"white"],[54,0.425,0.9225,50.0,null]],"goal":null,"pcells":[],"acells":[],"decals":[],"wall":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535],"floor":[65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535,65535]}],"door_style":"fence"};

// ---- src/spawn/rooms_keys_doors_puzzle.js ----
// GENERATED by tools/fit_spawn.py from reference/dumps/rooms_keys_doors_puzzle (frame 0). DO NOT EDIT.
// The spawn effect's bands at frame 0: [u0, u1, opacity, r, g, b] (80_render.js).
const DM_SPAWN0 = [
  [-13, -12, 0.7, 255, 255, 255],
  [14, 15, 0.8, 231, 216, 255],
  [15, 16, 0.85, 218, 212, 255],
  [26, 27, 0.7, 255, 217, 255],
  [27, 29, 0.75, 255, 218, 255],
  [29, 30, 0.8, 255, 213, 255],
  [30, 31, 0.85, 255, 214, 249],
  [31, 32, 1.0, 255, 201, 216]
];

// ---- src/20_state.js ----
// 20_state.js - the whole mutable state of an episode, in one object.
function createState() {
  return {
    seedIdx: 0, maze: null,            // DM_LEVEL.seeds entry
    x: 0, y: 0, z: 0, vx: 0, vy: 0,    // DMLab world units, z up (2D walk; z is the spawn's)
    vz: 0, air: false, groundZ: 0,     // airborne after a teleport
    landT: 0,                          // ms left of the hard-landing hold
    wmArm: -1, wmHold: -1, wmGiven: 0, wmMs: 0,   // watermaze: button touched, held since, +1s given, ms to the next
    teleTouched: -1, teleRewardAt: -1, // teleport pad touched / its +1 due, or -1
    replayTeleports: null,
    picked: 0, endAt: -1,              // rooms: pickups taken, frame the episode ends
    doorOpen: false, doorAt: -1, bright: false,   // exploit: door state, floor
    carried: null,                     // keys_doors: colour of the key carried
    obsFeet: NaN,                      // skymaze: feet height the obstacles were built for
    spawnYaw: 0, acc: 0, phase: 0, n0: 0, yaw: 0,   // view accumulator (40_pmove.js)
    pacc: 0, pphase: 0, pn0: 0, pitch: 0,          // psychlab: the pitch accumulator (50_tasks/psychlab.js)
    gaze: [0, 0, 0],                               // psychlab: [on screen, x, y] on the screen
    screen: [],                                    // psychlab: what the screen shows (80_render.js)
    frame: 0,                          // engine frames this episode
    instr: '',                         // language levels: the instruction now (getInstruction)
    lcount: 0, lend: 0,                // language: the round counts goals / a pick ended it
    spawnFrame: 0,                     // the episode's first frame (spawn effect, render only)
    score: 0,
    items: [], alive: new Uint8Array(0),   // [x, y, category] and still-there flags
    doors: [],                         // [row, col, open]
    cellsVersion: 0,                   // bumps when doors change (renderer repacks)
    pendingAt: -1, pendingReward: 0,   // a touch's reward, reported a frame later
    restartAt: -1,                     // frame the map restarts, or -1
    placed: false,                     // this frame teleported the player
    holdLeft: -1, catchMs: 0, queue: [],   // post-restart hold (50_tasks/explore.js)
    pcg: pcgState(),
    // G3 replay inputs (null in play): oracle msec per frame, respawn poses.
    replayMsec: null, replayRespawns: null,
    obstacles: null,                   // per wall cell planes, built at load
  };
}

// ---- src/30_level.js ----
// 30_level.js - load one corpus maze into the state.
//
// The level is DATA: DM_LEVEL.seeds[i] holds a maze DMLab generated for seed
// i (src/levels/<level>.js). Episode seed s uses corpus entry s mod N, so the
// corpus seeds 0..N-1 are DMLab's own seeds 0..N-1.

// Doors (explore_obstructed_goals). A door cell holds a panel of no
// thickness across the middle of the cell, spanning it: an 'H' door (func_door
// angle 0) blocks y at the cell's centre, an 'I' door (angle 90) blocks x. A
// closed panel stays there; an open one has slid along its angle (+x for H,
// +y for I) to 94 units on, leaving a stub at the cell's edge (oracle stop
// positions, PROGRESS.md U05).
const DM_DOOR_OPEN_SLIDE = 94;

function _dmRect(x0, x1, y0, y1) {
  return Float32Array.from([-1, 0, F(-(x0 - DM_HALF)), 1, 0, F(x1 + DM_HALF),
    0, -1, F(-(y0 - DM_HALF)), 0, 1, F(y1 + DM_HALF)]);
}

// Fence doors (rooms_keys_doors_puzzle): a slab from 46 to 54 across the
// cell's middle (the oracle stops 15.125 short of it on either side) that
// collides with the player's true half-width; an opened one is gone.
const DM_FENCE_LO = 46, DM_FENCE_HI = 54;

function _dmDoorRect(m, r, c, open) {
  const x0 = c * DM_CELL, y0 = (m.h - 1 - r) * DM_CELL;
  if (DM_LEVEL.door_style === 'fence') {
    // `open` is the slide so far, 0 (shut) to DM_FENCE_SLIDE (rooms.js).
    const sl = open || 0;
    return m.rows[r][c] === 'H'
      ? _dmRectHalf(x0 + sl, x0 + DM_CELL + sl, y0 + DM_FENCE_LO, y0 + DM_FENCE_HI, DM_PLAYER_HALF)
      : _dmRectHalf(x0 + DM_FENCE_LO, x0 + DM_FENCE_HI, y0 + sl, y0 + DM_CELL + sl, DM_PLAYER_HALF);
  }
  const s = open ? DM_DOOR_OPEN_SLIDE : 0;
  if (m.rows[r][c] === 'H') {
    const yc = y0 + DM_CELL / 2;
    return _dmRect(x0 + s, x0 + DM_CELL + s, yc, yc);
  }
  const xc = x0 + DM_CELL / 2;
  return _dmRect(xc, xc, y0 + s, y0 + DM_CELL + s);
}

// Configuration-space obstacles per cell, as lists of convex polygons.
//
// A WALL CELL collides as a cross: two boxes, one spanning the cell's full
// width but inset DM_NOTCH from its north and south edges, one spanning its
// full height but inset DM_NOTCH from its west and east edges. So every
// convex corner has a DM_NOTCH x DM_NOTCH square notch; along a straight wall
// the neighbouring cell's cross fills it, and a box's flat face cannot enter
// it. Measured, not assumed (PROGRESS.md U05): the oracle's centre stops
// 16.125 from a flat face, but at convex corners it sits 0.874-0.875 inside
// BOTH faces (seed 22: held there with zero velocity - two inner faces make a
// crease) or creeps along a face at that depth. Each box is grown by DM_HALF.
//
// A DOOR panel is grown by DM_HALF too. Planes (nx, ny, d): inside n.p < d.
function dmBuildObstacles(m, doors) {
  const W = m.w, H = m.h;
  const out = new Array(W * H).fill(null);
  const add = (i, poly) => { (out[i] = out[i] || []).push(poly); };
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (m.rows[r][c] !== '*') continue;
      const x0 = c * DM_CELL, x1 = x0 + DM_CELL, y0 = (H - 1 - r) * DM_CELL, y1 = y0 + DM_CELL;
      add(r * W + c, _dmRect(x0, x1, y0 + DM_NOTCH, y1 - DM_NOTCH));
      add(r * W + c, _dmRect(x0 + DM_NOTCH, x1 - DM_NOTCH, y0, y1));
    }
  }
  for (const [r, c, open] of doors) {
    const rect = _dmDoorRect(m, r, c, open);
    if (rect !== null) add(r * W + c, rect);
  }
  return out;
}

// A box level (rooms family): the seed names a map of axis-aligned boxes
// (tools/compile_rooms.py). Collision is every solid box's footprint grown by
// the player's TRUE half-width, 15 (Quake's player box): the oracle's centre
// stops 15.126 from a brush face. The text mazes' 16.125 is 15.125 from wall
// brushes that reach 1 unit past their cell - which is also where the corner
// notch comes from. One flat list, walked whole.
const DM_PLAYER_HALF = 15;

function _dmRectHalf(x0, x1, y0, y1, h) {
  return Float32Array.from([-1, 0, F(-(x0 - h)), 1, 0, F(x1 + h), 0, -1, F(-(y0 - h)), 0, 1, F(y1 + h)]);
}
// Only boxes that reach into the player's body (origin -24 to +32, Quake's
// player box) block the 2D walk: floors and ceilings do not.
function _dmBlocks(b, z) { return b[4] < z + 32 && b[5] > z - 24; }

function _dmMapGeometry(name, z) {
  const map = DM_LEVEL.maps[name];
  if (!map._f32) {
    map._f32 = Float32Array.from(map.boxes);
    map._obs = map.solids.filter((b) => _dmBlocks(b, z)).map((b) => _dmRectHalf(b[0], b[2], b[1], b[3], DM_PLAYER_HALF));
    // non-axial brushes (rooms_watermaze): their own planes, already pushed
    // out by the player's half-width, behind Quake's axial bevels
    for (const pg of map.polys || []) {
      if (pg.z[0] < z + 32 && pg.z[1] > z - 24) map._obs.push(Float32Array.from(pg.planes));
    }
  }
  return map;
}

// The geometry a box level shows now: its static boxes (exploit levels have
// a dark and a bright floor variant) plus its doors at their current height.
function dmBoxGeometry(st) {
  const m = st.maze;
  const name = DM_LEVEL.kind === 'exploit' ? m.map + (st.bright ? '#bright' : '#dark') : m.map;
  const map = _dmMapGeometry(name, st.z);
  const doors = map.doors || [];
  if (doors.length === 0) {
    m.boxesF32 = map._f32; m.nBoxes = map._f32.length / 60; m.flatObstacles = map._obs;
    return;
  }
  const out = new Float32Array(map._f32.length + doors.length * 60);
  out.set(map._f32);
  const obs = map._obs.slice();
  for (let k = 0; k < doors.length; k++) {
    const d = doors[k], up = F(d.rise * dmDoorOpen(st, k));
    const rec = Float32Array.from(d.box);
    rec[1] = F(rec[1] + F(up / DM_CELL)); rec[4] = F(rec[4] + F(up / DM_CELL));
    out.set(rec, map._f32.length + k * 60);
    // It blocks until its bottom clears the player's head (origin + 32).
    if (d.solid[4] + up < st.z + 32 && d.solid[5] + up > st.z - 24) obs.push(_dmRectHalf(d.solid[0], d.solid[2], d.solid[1], d.solid[3], DM_PLAYER_HALF));
  }
  m.boxesF32 = out; m.nBoxes = out.length / 60; m.flatObstacles = obs;
}

// A door's open fraction: Quake's default door speed is 100 units/s.
const DM_DOOR_SPEED = 100;
function dmDoorOpen(st, k) {
  const d = DM_LEVEL.maps[st.maze.map + (DM_LEVEL.kind === 'exploit' ? '#dark' : '')].doors[k];
  if (st.doorOpen) return 1;
  if (st.doorAt < 0) return 0;
  const p = (st.frame - st.doorAt) / DM_FPS * DM_DOOR_SPEED / d.rise;
  return p >= 1 ? 1 : p;
}

function dmBoxMaze(sd) {
  return Object.assign({ flat: true, w: 0, h: 0, rows: [], doors: [], goal: null, pcells: [], acells: [] }, sd);
}

// A language round's maze (tier 2): the round's map from DM_LEVEL.lang.maps
// (a level's rounds may switch maps) over the seed's own data, its placeholder
// floors replaced by their colour composites for the round's room colours.
function dmLangMaze(base, name, floors) {
  const L = DM_LEVEL.lang;
  const g = (name && L.maps && L.maps[name]) || base;
  const m = Object.assign({}, base, {
    w: g.w, h: g.h, rows: g.rows, wall: g.wall, decals: g.decals,
    pcells: g.pcells, acells: g.acells, ocells: g.ocells, oregions: g.oregions || base.oregions,
  });
  m.floor = g.floor.map((t) => {
    const f = L.floor_tiles && L.floor_tiles[t];
    return f && floors && floors[f.region] ? f.colours[floors[f.region]] : t;
  });
  m.lname = name;
  return m;
}

function dmLoad(st, seed) {
  if (DM_LEVEL.kind === 'psychlab') { dmPsychLoad(st, seed); return; }
  const n = DM_LEVEL.seeds.length;
  st.seedIdx = ((seed >>> 0) % n);
  st.maze = DM_LEVEL.maps ? dmBoxMaze(DM_LEVEL.seeds[st.seedIdx]) : DM_LEVEL.seeds[st.seedIdx];
  if (st.maze.lang) st.maze = dmLangMaze(st.maze, st.maze.lang.map, st.maze.lang.floors);
  st.z = st.maze.spawn[2]; st.groundZ = st.z; st.vz = 0; st.air = false; st.landT = 0; st.teleTouched = -1;
  st.replayTeleports = null;
  st.picked = 0; st.endAt = -1; st.carried = null; st.doorStartAt = null;
  const cfg = st.maze.config || {};
  st.doorOpen = !!cfg.doorOpened; st.doorAt = -1; st.bright = !!cfg.doorOpened;
  if (DM_LEVEL.kind === 'water') {
    // the glass is the ground; a spawn above it is still falling
    st.groundZ = F(DM_LEVEL.maps[st.maze.map].stand_z);
    st.vz = F(st.maze.spawn_vz);
    st.air = st.z > st.groundZ + 0.25;
    dmWaterReset(st);
  }
  if (st.maze.flat) dmBoxGeometry(st);
  st.doors = st.maze.doors.map((d) => d.slice());
  dmDoorsChanged(st);
  dmSetItems(st, st.maze.items);
  if (st.maze.lang) {
    // language levels: this round's objects ([x, y, tile, w, h, reward, rgb1, rgb2]) and instruction
    dmSetItems(st, st.maze.lang.items);
    st.instr = st.maze.lang.instr;
    st.lcount = st.maze.lang.count || 0; st.lend = 0;
  }
  pcgSeed(st.pcg, seed >>> 0);
  const sp = st.maze.spawn;
  dmPlace(st, sp[0], sp[1], sp[3]);
  st.frame = 0;
  st.spawnFrame = 0;
  st.score = 0;
  st.pendingAt = -1; st.pendingReward = 0; st.restartAt = -1;
  st.holdLeft = -1; st.queue.length = 0;
  st.phase = 0;
  st.acc = 0;
  st.replayMsec = null;
  st.replayRespawns = null;
}

// Put the player at (x, y) facing yaw (degrees), at rest, counting the view
// from the accumulator's current value. A respawn restarts the accumulator
// with its own quantisation phase (50_tasks/explore.js): Quake's client view
// angles carry across the restart, so the phase relative to the new spawn
// angle is new, and in a G3 replay it is the oracle's (PROGRESS.md U04).
//
// The yaw reported on the placing frame is the raw spawn angle; from the next
// frame on it is that angle rounded to Quake angle units (oracle, U04).
function dmPlace(st, x, y, yaw) {
  st.x = F(x); st.y = F(y); st.vx = 0; st.vy = 0;
  st.spawnYaw = DM_U * Math.round(yaw / DM_U);
  st.n0 = dmYawCount(st);
  st.yaw = yaw;
}

// Doors and items of a (re)started map.
function dmShutMask(st) {
  const m = st.maze, shut = new Uint8Array(m.w * m.h);
  for (const d of st.doors) if (!d[2]) shut[d[0] * m.w + d[1]] = 1;
  return shut;
}

// skymaze: platforms are columns whose tops step by 20; void cells are
// walled off by invisible columns. A cell blocks the walk if it is void or
// stands more than Quake's step height (18) above the feet; walls are exact
// cells against the true half-width (the oracle stops 15.125 off).
const DM_STEP = 18;
function dmSkyObstacles(st) {
  const m = st.maze, W = m.w, H = m.h, feet = st.z - 24.125;
  const out = new Array(W * H).fill(null);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const t = m.tops[r * W + c];
      if (t >= 0 && t <= feet + DM_STEP) continue;
      const x0 = c * DM_CELL, y0 = (H - 1 - r) * DM_CELL;
      out[r * W + c] = [_dmRectHalf(x0, x0 + DM_CELL, y0, y0 + DM_CELL, DM_PLAYER_HALF)];
    }
  }
  st.obstacles = out;
  st.obsFeet = feet;
}

// The highest platform top under the player's box, or -1 over void.
function dmSkySupport(st) {
  const m = st.maze, W = m.w, H = m.h;
  const c0 = Math.floor((st.x - DM_PLAYER_HALF) / DM_CELL), c1 = Math.floor((st.x + DM_PLAYER_HALF) / DM_CELL);
  const r0 = H - 1 - Math.floor((st.y + DM_PLAYER_HALF) / DM_CELL), r1 = H - 1 - Math.floor((st.y - DM_PLAYER_HALF) / DM_CELL);
  let best = -1;
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    if (r < 0 || c < 0 || r >= H || c >= W) continue;
    const t = m.tops[r * W + c];
    if (t > best) best = t;
  }
  return best;
}

function dmDoorsChanged(st) {
  if (DM_LEVEL.kind === 'sky') { dmSkyObstacles(st); st.cellsVersion++; return; }
  if (st.maze.flat) { st.obstacles = null; st.cellsVersion++; return; }
  st.obstacles = dmBuildObstacles(st.maze, st.doors);
  st.cellsVersion++;
}

function dmSetDoors(st, doors) {
  st.doors = doors.map((d) => d.slice());
  dmDoorsChanged(st);
}

function dmSetItems(st, items) {
  st.items = items.map((it) => it.slice());
  st.alive = new Uint8Array(st.items.length).fill(1);
}

// ---- src/40_pmove.js ----
// 40_pmove.js - one engine frame of player movement and view.
//
// A Quake-3-style walk, written from the published behaviour of Quake 3
// movement (friction, accelerate toward the wish direction, slide move, snap)
// - not from any GPL source - with constants fitted to DMLab's own
// trajectories (10_constants.js; tools/pmove_fit.py is the double-precision
// prototype). Float32 throughout, Math.fround after every float op, so V8 and
// QuickJS agree bit for bit; Math.cos/sin are the engines' shared ieee754.
//
// World frame is DMLab's: x east, y north, z up, units of 1/100 cell. The walk
// is 2D: tier-1 levels before skymaze have one floor height.

// --- view ---------------------------------------------------------------
// yaw = spawnYaw - U * (SHORT(acc) - n0), SHORT(a) = floor((a + c) / U), c the
// quantisation phase (0 in play; the oracle's own in a G3 replay).
function dmYawCount(st) {
  return Math.floor((st.acc + st.phase) / DM_U);
}

function dmYawUpdate(st, lookPx) {
  st.acc = st.acc + lookPx * DM_LOOK;
  st.yaw = st.spawnYaw - DM_U * (dmYawCount(st) - st.n0);
}

// --- trace --------------------------------------------------------------
// A point trace of the player's centre from (ax, ay) to (bx, by) against the
// obstacles of the cells in [r0, r1] x [c0, c1]. Returns the fraction of the
// move that is free, with the end kept DM_EPS outside the plane it hits, and
// that plane's normal in _trN; fraction 1 and no normal when clear.
let _trNx = 0, _trNy = 0, _trHit = false;

function dmTrace(st, ax, ay, bx, by, r0, r1, c0, c1) {
  const m = st.maze, obs = st.obstacles;
  let best = 1;
  _trHit = false;
  if (m.flat) {
    // Box levels: one flat list, a few dozen boxes, walked whole.
    best = _dmTraceList(m.flatObstacles, ax, ay, bx, by, best);
    return best;
  }
  for (let r = r0; r <= r1; r++) {
    if (r < 0 || r >= m.h) continue;
    for (let c = c0; c <= c1; c++) {
      if (c < 0 || c >= m.w) continue;
      const list = obs[r * m.w + c];
      if (list === null) continue;
      for (let q = 0; q < list.length; q++) {
      const p = list[q];
      let enter = -1, leave = 1, hx = 0, hy = 0, have = false, startOut = false, miss = false;
      for (let i = 0; i < p.length; i += 3) {
        const nx = p[i], ny = p[i + 1], d = p[i + 2];
        const d1 = F(F(F(nx * ax) + F(ny * ay)) - d);
        const d2 = F(F(F(nx * bx) + F(ny * by)) - d);
        if (d1 > 0) startOut = true;
        if (d1 > 0 && (d2 >= DM_EPS || d2 >= d1)) { miss = true; break; }
        if (d1 <= 0 && d2 <= 0) continue;
        if (d1 > d2) {
          let f = F(F(d1 - DM_EPS) / F(d1 - d2));
          if (f < 0) f = 0;
          if (f > enter) { enter = f; hx = nx; hy = ny; have = true; }
        } else {
          const f = F(F(d1 + DM_EPS) / F(d1 - d2));
          if (f < leave) leave = f;
        }
      }
      if (miss || !have || enter > 1 || !startOut || !(enter < leave)) continue;
      const f = enter > 0 ? enter : 0;
      if (f < best) { best = f; _trNx = hx; _trNy = hy; _trHit = true; }
      }
    }
  }
  return best;
}

function _dmTraceList(list, ax, ay, bx, by, best) {
  for (let q = 0; q < list.length; q++) {
    const p = list[q];
    let enter = -1, leave = 1, hx = 0, hy = 0, have = false, startOut = false, miss = false;
    for (let i = 0; i < p.length; i += 3) {
      const nx = p[i], ny = p[i + 1], d = p[i + 2];
      const d1 = F(F(F(nx * ax) + F(ny * ay)) - d);
      const d2 = F(F(F(nx * bx) + F(ny * by)) - d);
      if (d1 > 0) startOut = true;
      if (d1 > 0 && (d2 >= DM_EPS || d2 >= d1)) { miss = true; break; }
      if (d1 <= 0 && d2 <= 0) continue;
      if (d1 > d2) {
        let f = F(F(d1 - DM_EPS) / F(d1 - d2));
        if (f < 0) f = 0;
        if (f > enter) { enter = f; hx = nx; hy = ny; have = true; }
      } else {
        const f = F(F(d1 + DM_EPS) / F(d1 - d2));
        if (f < leave) leave = f;
      }
    }
    if (miss || !have || enter > 1 || !startOut || !(enter < leave)) continue;
    const f = enter > 0 ? enter : 0;
    if (f < best) { best = f; _trNx = hx; _trNy = hy; _trHit = true; }
  }
  return best;
}

function _clip(vx, vy, nx, ny) {
  let back = F(F(vx * nx) + F(vy * ny));
  back = back < 0 ? F(back * DM_OVERCLIP) : F(back / DM_OVERCLIP);
  return [F(vx - F(nx * back)), F(vy - F(ny * back))];
}

// Quake's slide move in the plane: up to 4 bumps; the velocity is clipped
// against every plane touched this move; two planes that both block make a
// crease, which for two vertical planes is vertical, so the walk stops.
const _planes = new Float32Array(10);

function dmSlide(st, dt) {
  const m = st.maze;
  let x = st.x, y = st.y, vx = st.vx, vy = st.vy;
  const ex0 = F(x + F(vx * dt)), ey0 = F(y + F(vy * dt));
  // +-2 cells: an open door's panel reaches a cell beyond its own.
  const c0 = Math.floor((Math.min(x, ex0) - DM_HALF) / DM_CELL) - 2;
  const c1 = Math.floor((Math.max(x, ex0) + DM_HALF) / DM_CELL) + 1;
  const r0 = m.h - 1 - Math.floor((Math.max(y, ey0) + DM_HALF) / DM_CELL) - 1;
  const r1 = m.h - 1 - Math.floor((Math.min(y, ey0) - DM_HALF) / DM_CELL) + 2;
  let np = 0;
  let t = dt;
  for (let bump = 0; bump < 4; bump++) {
    const ex = F(x + F(vx * t)), ey = F(y + F(vy * t));
    const f = dmTrace(st, x, y, ex, ey, r0, r1, c0, c1);
    if (f > 0) { x = F(x + F(F(ex - x) * f)); y = F(y + F(F(ey - y) * f)); }
    if (!_trHit) break;
    t = F(t - F(t * f));
    if (np >= 5) { vx = 0; vy = 0; break; }
    const nx = _trNx, ny = _trNy;
    let same = false;
    for (let i = 0; i < np; i++) {
      if (F(F(nx * _planes[2 * i]) + F(ny * _planes[2 * i + 1])) > 0.99) { same = true; break; }
    }
    if (same) { vx = F(vx + nx); vy = F(vy + ny); continue; }
    _planes[2 * np] = nx; _planes[2 * np + 1] = ny; np++;
    for (let i = 0; i < np; i++) {
      const pix = _planes[2 * i], piy = _planes[2 * i + 1];
      if (F(F(vx * pix) + F(vy * piy)) >= 0.1) continue;
      let [cx, cy] = _clip(vx, vy, pix, piy);
      let stuck = false;
      for (let j = 0; j < np; j++) {
        if (j === i) continue;
        const pjx = _planes[2 * j], pjy = _planes[2 * j + 1];
        if (F(F(cx * pjx) + F(cy * pjy)) >= 0.1) continue;
        [cx, cy] = _clip(cx, cy, pjx, pjy);
        if (F(F(cx * pix) + F(cy * piy)) >= 0) continue;
        stuck = true;
        break;
      }
      if (stuck) { vx = 0; vy = 0; } else { vx = cx; vy = cy; }
      break;
    }
  }
  st.x = x; st.y = y; st.vx = vx; st.vy = vy;
}

// Integer snap, round half away from zero (fits the oracle's frame 0).
function _snap(v) {
  const f = Math.floor(v), d = v - f;
  return d > 0.5 ? f + 1 : d < 0.5 ? f : f % 2 === 0 ? f : f + 1;   // ties to even
}

// One engine frame: view, then the walk.
function dmPmove(st, act, msec) {
  dmYawUpdate(st, act[0]);
  dmWalk(st, act, msec);
}

// Quake chops a long command into pieces of at most 66 ms.
function dmWalkChopped(st, act, msec) {
  let left = msec;
  while (left > 0) {
    const m = left < 66 ? left : 66;
    dmWalk(st, act, m);
    left -= m;
  }
}

// Friction, accelerate, slide, snap, for one command of `msec` ms.
function dmWalk(st, act, msec) {
  let landVz = 0;
  if (DM_LEVEL.kind === 'sky') {
    // Grounded is decided where the command starts: off the platform's edge
    // the walk turns into a fall (oracle: the last ground frame already ends
    // with the box past the edge).
    const sup = dmSkySupport(st);
    st.groundZ = sup >= 0 ? F(sup + 24.125) : -1e9;
    if (!st.air && st.z > st.groundZ + 0.25) { st.air = true; st.vz = 0; }
    // A fall that ended within 0.25 of the ground, without touching it,
    // lands with its vertical speed: the walk keeps it (below).
    else if (!st.air && st.vz !== 0) { landVz = st.vz; st.vz = 0; }
    if (st.z - 24.125 !== st.obsFeet) dmSkyObstacles(st);
  }
  const dt = F(msec * F(0.001));
  const a = F(F(st.yaw) * F(Math.PI / 180));
  const cs = F(Math.cos(a)), sn = F(Math.sin(a));
  // forward (cos, sin), right (sin, -cos): yaw is counter-clockwise from +x.
  const move = act[3], strafe = act[2];
  const wx = F(F(cs * move) + F(sn * strafe));
  const wy = F(F(sn * move) - F(cs * strafe));
  const wl = F(Math.sqrt(F(F(wx * wx) + F(wy * wy))));
  let vx = st.vx, vy = st.vy;
  const sp = F(Math.sqrt(F(F(vx * vx) + F(vy * vy))));
  if (st.air) {
    // no friction in the air
  } else if (sp < 1) {
    vx = 0; vy = 0;
  } else {
    const control = sp < DM_STOP ? DM_STOP : sp;
    let ns = F(sp - F(F(control * DM_FRICTION) * dt));
    if (ns < 0) ns = 0;
    ns = F(ns / sp);
    vx = F(vx * ns); vy = F(vy * ns);
    landVz = F(landVz * ns);   // friction scales the whole vector
  }
  if (wl > 0) {
    const dx = F(wx / wl), dy = F(wy / wl);
    const cur = F(F(vx * dx) + F(vy * dy));
    const add = F(DM_SPEED - cur);
    if (add > 0) {
      let acc = F(F((st.air ? DM_AIR_ACCEL : DM_ACCEL) * dt) * DM_SPEED);
      if (acc > add) acc = add;
      vx = F(vx + F(acc * dx)); vy = F(vy + F(acc * dy));
    }
  }
  // A hard landing (falling faster than 200 u/s) holds the walk velocity for
  // 250 ms: walls still stop the box but no longer clip the velocity
  // (oracle: skymaze, against a void column right after a drop).
  if (landVz !== 0) {
    // The ground clip (overclip 1.001) leaves a small upward speed, and the
    // walk keeps the length the velocity had with the fall in it.
    const len = F(Math.sqrt(F(F(F(vx * vx) + F(vy * vy)) + F(landVz * landVz))));
    const uz = F(landVz - F(landVz * DM_OVERCLIP));
    const k = F(len / F(Math.sqrt(F(F(F(vx * vx) + F(vy * vy)) + F(uz * uz)))));
    vx = F(vx * k); vy = F(vy * k);
    st.z = F(st.z + F(F(uz * k) * dt));
  }
  if (st.landT > 0) st.landT = st.landT > msec ? st.landT - msec : 0;
  st.vx = vx; st.vy = vy;
  if (st.air && DM_LEVEL.kind === 'sky') {
    dmSkyAir(st, dt);
    st.vx = _snap(st.vx); st.vy = _snap(st.vy); st.vz = _snap(st.vz);
    return;
  }
  dmSlide(st, dt);
  if (st.landT > 0) { st.vx = vx; st.vy = vy; }
  if (st.air) {
    const vz0 = st.vz;
    const vz1 = F(st.vz - F(DM_GRAVITY * dt));
    st.z = F(st.z + F(F(F(st.vz + vz1) * F(0.5)) * dt));
    st.vz = vz1;
    if (st.z <= st.groundZ) {
      st.z = st.groundZ; st.vz = 0; st.air = false;
      if (vz0 < -200) st.landT = 250;
    }
    st.vz = _snap(st.vz);
  }
  st.vx = _snap(st.vx); st.vy = _snap(st.vy);
}

// --- skymaze: the fall in 3D ---------------------------------------------
// Every cell is a column: a platform up to its top, a void cell all the way
// up (invisible). The player is a box +-15 across, -24..+32 about its origin.
// An air move is Quake's step-slide (from its published behaviour): a slide
// with gravity; if anything was touched, the same move again from 18 units
// higher, then pushed down by those 18 onto whatever is below.
const DM_SKY_TOP = F(1e9);
let _s3f = 1, _s3x = 0, _s3y = 0, _s3z = 0, _s3all = false;

function _skyTrace(st, ax, ay, az, bx, by, bz) {
  const m = st.maze, W = m.w, H = m.h, h = DM_PLAYER_HALF;
  const c0 = Math.floor((Math.min(ax, bx) - h) / DM_CELL) - 1, c1 = Math.floor((Math.max(ax, bx) + h) / DM_CELL) + 1;
  const r0 = H - 1 - Math.floor((Math.max(ay, by) + h) / DM_CELL) - 1, r1 = H - 1 - Math.floor((Math.min(ay, by) - h) / DM_CELL) + 1;
  let best = 1;
  _s3f = 1; _s3all = false;
  for (let r = r0 < 0 ? 0 : r0; r <= r1 && r < H; r++) {
    for (let c = c0 < 0 ? 0 : c0; c <= c1 && c < W; c++) {
      const t = m.tops[r * W + c];
      const x0 = c * DM_CELL, y0 = (H - 1 - r) * DM_CELL;
      // planes in a brush's axial order: -x, +x, -y, +y, +z
      _skyP[0] = F(-(x0 - h)); _skyP[1] = F(x0 + DM_CELL + h);
      _skyP[2] = F(-(y0 - h)); _skyP[3] = F(y0 + DM_CELL + h);
      _skyP[4] = t >= 0 ? F(t + 24) : DM_SKY_TOP;
      let enter = -1, leave = 1, hn = -1, startOut = false, getOut = false, miss = false;
      for (let i = 0; i < 5; i++) {
        const k = i >> 1, sg = _skyS[i];
        const pa = k === 0 ? ax : (k === 1 ? ay : az), pb = k === 0 ? bx : (k === 1 ? by : bz);
        const d1 = F(F(sg * pa) - _skyP[i]), d2 = F(F(sg * pb) - _skyP[i]);
        if (d2 > 0) getOut = true;
        if (d1 > 0) startOut = true;
        if (d1 > 0 && (d2 >= DM_EPS || d2 >= d1)) { miss = true; break; }
        if (d1 <= 0 && d2 <= 0) continue;
        if (d1 > d2) {
          let f = F(F(d1 - DM_EPS) / F(d1 - d2));
          if (f < 0) f = 0;
          if (f > enter) { enter = f; hn = i; }
        } else {
          let f = F(F(d1 + DM_EPS) / F(d1 - d2));
          if (f > 1) f = 1;
          if (f < leave) leave = f;
        }
      }
      if (miss) continue;
      if (!startOut) { if (!getOut) { _s3all = true; best = 0; } continue; }
      if (enter < leave && enter > -1 && enter < best) {
        best = enter < 0 ? 0 : enter;
        const k = hn >> 1, sg = _skyS[hn];
        _s3x = k === 0 ? sg : 0; _s3y = k === 1 ? sg : 0; _s3z = k === 2 ? sg : 0;
      }
    }
  }
  _s3f = best;
  return best;
}
const _skyP = new Float32Array(5);
const _skyS = [-1, 1, -1, 1, 1];
const _skyPl = new Float32Array(15);

function _clip3(v, n) {
  let back = F(F(F(v[0] * n[0]) + F(v[1] * n[1])) + F(v[2] * n[2]));
  back = back < 0 ? F(back * DM_OVERCLIP) : F(back / DM_OVERCLIP);
  return [F(v[0] - F(n[0] * back)), F(v[1] - F(n[1] * back)), F(v[2] - F(n[2] * back))];
}
function _dot3(a, b) { return F(F(F(a[0] * b[0]) + F(a[1] * b[1])) + F(a[2] * b[2])); }
function _unit3(a) {
  const l = F(Math.sqrt(_dot3(a, a)));
  if (l === 0) return [0, 0, 0];
  const il = F(1 / l);
  return [F(a[0] * il), F(a[1] * il), F(a[2] * il)];
}

// One slide with gravity from the state's position and velocity (vz the
// speed at the command's start). Returns whether anything was touched.
function _skySlide(st, dt) {
  const vz1 = F(st.vz - F(DM_GRAVITY * dt));
  let v = [st.vx, st.vy, F(F(st.vz + vz1) * F(0.5))];
  let e = [st.vx, st.vy, vz1];
  const primal = [st.vx, st.vy, vz1];
  let x = st.x, y = st.y, z = st.z;
  const pl = [];
  pl.push(_unit3(v));
  let t = dt, bump = 0, dead = false;
  for (; bump < 4; bump++) {
    const ex = F(x + F(v[0] * t)), ey = F(y + F(v[1] * t)), ez = F(z + F(v[2] * t));
    const f = _skyTrace(st, x, y, z, ex, ey, ez);
    if (_s3all) { v[2] = 0; e = null; break; }
    if (f > 0) { x = F(x + F(F(ex - x) * f)); y = F(y + F(F(ey - y) * f)); z = F(z + F(F(ez - z) * f)); }
    if (f === 1) break;
    t = F(t - F(t * f));
    if (pl.length >= 5) { v = [0, 0, 0]; e = null; dead = true; break; }
    const n = [_s3x, _s3y, _s3z];
    let same = false;
    for (let i = 0; i < pl.length; i++) if (_dot3(n, pl[i]) > 0.99) { same = true; break; }
    if (same) { v = [F(v[0] + n[0]), F(v[1] + n[1]), F(v[2] + n[2])]; continue; }
    pl.push(n);
    for (let i = 0; i < pl.length; i++) {
      if (_dot3(v, pl[i]) >= 0.1) continue;
      let cv = _clip3(v, pl[i]), ce = _clip3(e, pl[i]);
      for (let j = 0; j < pl.length && !dead; j++) {
        if (j === i) continue;
        if (_dot3(cv, pl[j]) >= 0.1) continue;
        cv = _clip3(cv, pl[j]); ce = _clip3(ce, pl[j]);
        if (_dot3(cv, pl[i]) >= 0) continue;
        // along the crease of the two planes
        const a = pl[i], b = pl[j];
        const dir = _unit3([F(F(a[1] * b[2]) - F(a[2] * b[1])), F(F(a[2] * b[0]) - F(a[0] * b[2])), F(F(a[0] * b[1]) - F(a[1] * b[0]))]);
        const dv = _dot3(dir, v), de = _dot3(dir, e);
        cv = [F(dir[0] * dv), F(dir[1] * dv), F(dir[2] * dv)];
        ce = [F(dir[0] * de), F(dir[1] * de), F(dir[2] * de)];
        for (let k = 0; k < pl.length; k++) {
          if (k === i || k === j) continue;
          if (_dot3(cv, pl[k]) >= 0.1) continue;
          dead = true;   // a third plane: stop dead
          break;
        }
      }
      if (dead) { v = [0, 0, 0]; e = null; break; }
      v = cv; e = ce;
      break;
    }
    if (dead) break;
  }
  if (e !== null) v = e;
  if (st.landT > 0) v = primal;
  st.x = x; st.y = y; st.z = z; st.vx = v[0]; st.vy = v[1]; st.vz = v[2];
  return bump !== 0 || dead;
}

function dmSkyAir(st, dt) {
  const vz0 = st.vz, sx = st.x, sy = st.y, sz = st.z, svx = st.vx, svy = st.vy;
  if (_skySlide(st, dt)) {
    _skyTrace(st, sx, sy, sz, sx, sy, F(sz + DM_STEP));
    if (!_s3all) {
      const uz = F(sz + F(F(DM_STEP) * _s3f));
      const step = F(uz - sz);
      st.x = sx; st.y = sy; st.z = uz; st.vx = svx; st.vy = svy; st.vz = vz0;
      _skySlide(st, dt);
      const f = _skyTrace(st, st.x, st.y, st.z, st.x, st.y, F(st.z - step));
      if (!_s3all) st.z = F(st.z + F(F(-step) * f));
      if (f < 1) {
        const c = _clip3([st.vx, st.vy, st.vz], [_s3x, _s3y, _s3z]);
        st.vx = c[0]; st.vy = c[1]; st.vz = c[2];
      }
    }
  }
  // ground under the box within 0.25: landed (hard landings hold the walk)
  const sup = dmSkySupport(st);
  st.groundZ = sup >= 0 ? F(sup + 24.125) : -1e9;
  if (st.vz <= 1 && st.z <= F(st.groundZ + F(0.25))) {
    st.air = false;
    if (vz0 < -200) st.landT = 250;
  }
}

// ---- src/50_tasks/explore.js ----
// 50_tasks/explore.js - the explore family's task rules (DMLab-30 README and
// the explore factories, read as specification; timing from the oracle).
//
//   goal     explore_goal_locations / explore_obstructed_goals: reach the goal
//            for 10, restart at a spawn point; obstructed levels also re-draw
//            which doors are open at every restart.
//   objects  explore_object_locations: apples worth 1 each, not respawning;
//            when all are taken the map restarts with all of them back.
//   rewards  explore_object_rewards: objects of good (+2) and bad (-1)
//            categories; when every good one is taken the map restarts with
//            a new spawn and a new placement.
//   language (tier 2) language_select_described_object: pick the object the
//            instruction names (+10) or another (-10); any pick restarts the
//            map with a new round: objects, instruction, spawn. Items carry
//            their own reward and colours: [x, y, tile, w, h, reward, rgb1, rgb2].
//
// Timing (fitted, PROGRESS.md U04): a touch is tested on a frame's END
// position; its reward is reported on the NEXT frame; a restart it causes
// places the player on the frame after that. In a G3 replay the restart's
// pose, doors and items are the oracle's; in play they are drawn with the
// episode's PCG following the factories' rules (DMLab uses its own Lua RNG,
// which nothing here reproduces).

// After a restart the server holds the player `hold` frames and then runs
// the queued commands (90_playtrain.js). Play default: no hold, 17 ms.
const DM_RESPAWN_HOLD = 0, DM_RESPAWN_CATCH = 17;

function _dmTouches(st, ix, iy) {
  const dx = st.x - ix, dy = st.y - iy;
  return dx >= DM_TOUCH_X0 && dx <= DM_TOUCH_X1 && dy >= DM_TOUCH_Y0 && dy <= DM_TOUCH_Y1;
}

// Is the episode's task finished, so the map restarts?
function _dmFinished(st) {
  const m = st.maze, kind = DM_LEVEL.kind;
  if (kind === 'language') return st.lend === 1;   // a pick that ends the round (see dmTaskFrame)
  if (kind === 'objects') {
    for (let i = 0; i < st.alive.length; i++) if (st.alive[i]) return false;
    return st.alive.length > 0;
  }
  if (kind === 'rewards') {
    for (let i = 0; i < st.items.length; i++) {
      if (st.alive[i] && m.cats[st.items[i][2]][3] > 0) return false;
    }
    return true;
  }
  return false;
}

// Returns the reward reported this frame.
function dmTaskFrame(st) {
  if (DM_LEVEL.kind === 'water') return dmWaterFrame(st);
  if (st.maze.flat) return dmRoomsFrame(st);
  if (DM_LEVEL.kind === 'keys' || DM_LEVEL.kind === 'sky') return dmKeysFrame(st);
  let reward = 0;
  if (st.pendingAt >= 0 && st.frame === st.pendingAt + 1) {
    reward = st.pendingReward;
    st.pendingReward = 0;
  }
  if (st.restartAt === st.frame) {
    st.restartAt = -1;
    st.pendingAt = -1;
    dmRestart(st);
    return reward;
  }
  if (st.restartAt >= 0) return reward;
  const m = st.maze;
  let touched = 0, got = 0;
  if (m.goal !== null && _dmTouches(st, m.goal[0], m.goal[1])) {
    got += DM_GOAL_REWARD; touched = 1;
    st.restartAt = st.frame + 2;
  }
  for (let i = 0; i < st.items.length; i++) {
    if (!st.alive[i]) continue;
    const it = st.items[i];
    if (it.length > 9 && it[9]) continue;     // language: only to look at
    if (_dmTouches(st, it[0], it[1])) {
      st.alive[i] = 0;
      got += it.length >= 8 ? it[5] : m.cats[it[2]][3];
      touched = 1;
      if (it.length >= 8) {
        // language: a counting round ('Every ...') goes on until its last goal
        // object, which adds the bonus; any other pick ends the round
        if (st.lcount && it[8]) {
          let left = 0;
          for (let j = 0; j < st.items.length; j++) if (st.alive[j] && st.items[j][8]) left++;
          if (left === 0) { got += DM_LEVEL.lang.goal_reward; st.lend = 1; }
        } else {
          st.lend = 1;
        }
      }
    }
  }
  if (touched) {
    st.pendingAt = st.frame;
    st.pendingReward = F(st.pendingReward + got);
    if (st.restartAt < 0 && _dmFinished(st)) st.restartAt = st.frame + 2;
  }
  return reward;
}

// --- restarts -----------------------------------------------------------
function _dmOpenCell(m, r, c) {
  return r >= 0 && c >= 0 && r < m.h && c < m.w && m.rows[r][c] !== '*';
}

// Cells reachable from (r0, c0) through non-wall cells, doors counted open
// (the factories' visitFill), in BFS order.
function _dmReach(m, r0, c0) {
  const seen = new Uint8Array(m.w * m.h), out = [[r0, c0]];
  seen[r0 * m.w + c0] = 1;
  for (let k = 0; k < out.length; k++) {
    const [r, c] = out[k];
    for (const [dr, dc] of [[-1, 0], [0, 1], [1, 0], [0, -1]]) {
      const rr = r + dr, cc = c + dc;
      if (!_dmOpenCell(m, rr, cc) || seen[rr * m.w + cc]) continue;
      seen[rr * m.w + cc] = 1;
      out.push([rr, cc]);
    }
  }
  return out;
}

function _dmShuffle(st, a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = crRi(st.pcg, i + 1);
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function _dmCellOf(m, x, y) {
  return [m.h - 1 - Math.floor(y / DM_CELL), Math.floor(x / DM_CELL)];
}

// A random path from the goal to the spawn through open cells (randomised
// depth-first search); the doors on it are opened, then of the doors still
// shut, a (1 - doors_closed) share is opened at random.
function _dmDrawDoors(st, sr, sc) {
  const m = st.maze;
  const [gr, gc] = _dmCellOf(m, m.goal[0], m.goal[1]);
  const from = new Int32Array(m.w * m.h).fill(-1);
  const stack = [[gr, gc]];
  from[gr * m.w + gc] = gr * m.w + gc;
  while (stack.length) {
    const [r, c] = stack.pop();
    if (r === sr && c === sc) break;
    const nb = _dmShuffle(st, [[-1, 0], [0, 1], [1, 0], [0, -1]]);
    for (const [dr, dc] of nb) {
      const rr = r + dr, cc = c + dc;
      if (!_dmOpenCell(m, rr, cc) || from[rr * m.w + cc] >= 0) continue;
      from[rr * m.w + cc] = r * m.w + c;
      stack.push([rr, cc]);
    }
  }
  const onPath = new Uint8Array(m.w * m.h);
  for (let i = sr * m.w + sc; from[i] >= 0 && from[i] !== i; i = from[i]) onPath[i] = 1;
  const shut = [];
  for (const d of st.doors) {
    d[2] = onPath[d[0] * m.w + d[1]] ? 1 : 0;
    if (!d[2]) shut.push(d);
  }
  _dmShuffle(st, shut);
  const extra = Math.floor(shut.length * (1 - DM_LEVEL.doors_closed));
  for (let i = 0; i < extra; i++) shut[i][2] = 1;
}

// A new language round in play (language_select_described_object.lua, read as
// spec): a goal object and one of a different shape, each with a random
// pattern and two random named colours, on two random 'O' cells; the
// instruction names the goal's shape. DMLab adds colour noise; the port uses
// the named colours exactly.
function _dmLangRound(st) {
  st.lend = 0; st.lcount = 0;
  if (DM_LEVEL.lang.task === 'located') { _dmLocatedRound(st); return; }
  if (DM_LEVEL.lang.task === 'execute') { _dmExecuteRound(st); return; }
  if (DM_LEVEL.lang.task === 'answer') { _dmAnswerRound(st); return; }
  const m = st.maze, L = DM_LEVEL.lang;
  const keys = Object.keys(L.tiles).sort();
  const shapes = [...new Set(keys.map((k) => k.split('__')[0]))];
  const pats = [...new Set(keys.map((k) => k.split('__')[1]))];
  const cols = Object.keys(L.colors).sort();
  const g = shapes[crRi(st.pcg, shapes.length)];
  const others = shapes.filter((s) => s !== g);
  const o = others[crRi(st.pcg, others.length)];
  const cells = _dmShuffle(st, m.ocells.slice());
  const item = (shape, k, reward) => {
    const pat = pats[crRi(st.pcg, pats.length)];
    const t = L.tiles[shape + '__' + pat], sc = L.scales[shape] || 1;
    const c1 = L.colors[cols[crRi(st.pcg, cols.length)]];
    const c2 = pat === 'solid' ? c1 : L.colors[cols[crRi(st.pcg, cols.length)]];
    const [r, c] = cells[k];
    return [(c + 0.5) * DM_CELL, (m.h - r - 0.5) * DM_CELL, t[0], F(t[1] * sc), F(t[2] * sc), reward, c1, c2];
  };
  dmSetItems(st, [item(o, 1, -L.goal_reward), item(g, 0, L.goal_reward)]);
  st.instr = g;
}

// A new round of language_select_located_object in play (its level script,
// read as spec): a 2-room task (weight 2, on the two-area or two-room map), a
// 4-room or a 6-room one (weight 1 each). Rooms take shuffled distinct floor
// colours. Objects: the goal (random room and colour); one of another colour
// in its room; one of its colour in another room; one of the second's colour
// in the third's room (2-room) or anywhere; then 4 (4-room) or 8 (6-room)
// random ones anywhere. Each on a random free 'O' cell of its room, a random
// shape, solid. A distractor costs floor(10 / #distractors + 0.5).

const DM_LOCATED_TASKS = [[2, 'twoAreaMap_customFloors', 'twoRoomMap_customFloors'], [2, null, null],
  [4, 'fourRoomMap_customFloors'], [6, 'sixRoomMap_customFloors']];
function _dmLocatedRound(st) {
  const L = DM_LEVEL.lang, pick = (a) => a[crRi(st.pcg, a.length)];
  let task = pick(DM_LOCATED_TASKS);
  if (task[1] === null) task = DM_LOCATED_TASKS[0];       // weights 2:1:1
  const rooms = task[0], name = rooms === 2 ? task[1 + crRi(st.pcg, 2)] : task[1];
  const g = L.maps[name];
  const regions = [...new Set(g.oregions)].filter((v) => v !== '.' && v !== '0').sort();
  const cols = Object.keys(L.colors).sort();
  const order = _dmShuffle(st, cols.slice()), floors = {};
  regions.forEach((v, i) => { floors[v] = order[i]; });
  st.maze = dmLangMaze(DM_LEVEL.seeds[st.seedIdx], name, floors);
  st.doors = [];
  dmDoorsChanged(st);
  const other = (a, x) => pick(a.filter((v) => v !== x));
  const r1 = pick(regions), c1 = pick(cols), c2 = other(cols, c1), r3 = other(regions, r1);
  const want = [[r1, c1], [r1, c2], [r3, c1], [rooms === 2 ? r3 : 'any', c2]];
  for (let k = 0; k < (rooms === 2 ? 0 : rooms === 4 ? 4 : 8); k++) want.push(['any', pick(cols)]);
  const m = st.maze, free = m.ocells.map((rc, i) => [rc, m.oregions[i]]);
  const n = want.length - 1, bad = -Math.floor(L.goal_reward / n + 0.5);
  const items = [];
  want.forEach(([reg, col], k) => {
    const cand = free.filter(([, v]) => reg === 'any' || v === reg);
    const [rc] = pick(cand);
    free.splice(free.findIndex(([x]) => x === rc), 1);
    const shape = pick(Object.keys(L.tiles).map((s) => s.split('__')[0]));
    const t = L.tiles[shape + '__solid'], sc = L.scales[shape] || 1, rgb = L.colors[col];
    items.push([(rc[1] + 0.5) * DM_CELL, (m.h - rc[0] - 0.5) * DM_CELL, t[0], F(t[1] * sc), F(t[2] * sc),
      k === 0 ? L.goal_reward : bad, rgb, rgb]);
  });
  dmSetItems(st, items);
  st.instr = 'Pick the ' + c1 + ' object in the ' + floors[r1] + ' room';
}

// A new round of language_execute_random_task in play (its level script and
// language/*.lua, read as spec). One of 14 tasks by weight; each lists object
// groups whose colour, shape and room are drawn as random ('r'), shared by the
// whole group ('c'), the same as group g's (['s', g]) or different to every
// value groups gs used (['d', gs]). Unlisted attributes are random (the
// colour-near-colour task defaults shape to group 1's). Rewards are balanced:
// a goal-group pick +10, a distractor -floor(10 / #distractors + 0.5). The
// 'Every' tasks count instead: +1 per goal, the last adds 10 and ends the
// round, a distractor costs -floor((#goals + 10) / #distractors + 0.5) and
// ends it. Room tasks place each object on a free 'O' cell of its room, the
// others on random 'O' cells. Instructions use group 1 (goal) and group 2.
const DM_EXEC_PICK = [{}, { color: ['d', [1]], shape: ['d', [1]] }];
const DM_EXEC_BOTH = [{}, { color: ['s', 1], shape: ['d', [1]] }, { color: ['d', [1]], shape: ['s', 1] }];
const DM_EXEC_NEAR4 = (g1, g2, g3, g4, g5, g6, g7) => [
  Object.assign({ region: 'r' }, g1), Object.assign({ region: ['s', 1] }, g2),
  Object.assign({ region: ['d', [1]] }, g3), Object.assign({ region: ['s', 3] }, g4),
  Object.assign({ region: ['d', [1, 3]] }, g5), Object.assign({ region: ['s', 5] }, g6),
  Object.assign({ region: ['d', [1, 3, 5]] }, g7)];
const DM_EXEC_TASKS = [
  // [weight, rooms, groups, counts ('every' = 2..6 goals of at most 8), instructions, room placer, counting]
  [2, 2, DM_EXEC_PICK, [1, 2], ['C', 'S', 'C S']],
  [1, 4, DM_EXEC_PICK, [1, 4], ['C', 'S', 'C S']],
  [1, 6, DM_EXEC_PICK, [1, 8], ['C', 'S', 'C S']],
  [2, 2, DM_EXEC_BOTH, [1, 1, 1], ['C S']],
  [1, 4, DM_EXEC_BOTH, [1, 3, 3], ['C S']],
  [1, 6, DM_EXEC_BOTH, [1, 5, 5], ['C S']],
  [2, 2, [{ shape: 'c' }, { shape: ['d', [1]] }], [2, 2], ['Every S'], 0, 1],
  [1, 4, [{ shape: 'c' }, { shape: ['d', [1]] }], 'every', ['Every S'], 0, 1],
  [2, 2, [{ color: 'c' }, { color: ['d', [1]] }], [2, 2], ['Every C object'], 0, 1],
  [1, 4, [{ color: 'c' }, { color: ['d', [1]] }], 'every', ['Every C object'], 0, 1],
  [2, 2, [{ region: 'r' }, { shape: ['d', [1]], region: ['s', 1] }, { shape: ['s', 1], region: ['d', [1]] },
    { shape: ['d', [2]], region: ['s', 3] }], [1, 1, 1, 1], ['S near S2'], 1],
  [1, 4, DM_EXEC_NEAR4({}, { shape: ['d', [1]] }, { shape: ['s', 1] }, { shape: ['d', [2]] },
    { shape: ['s', 2] }, { shape: ['d', [1]] }, { shape: ['d', [1, 2]] }), [1, 1, 1, 1, 1, 1, 2], ['S near S2'], 1],
  [1, 4, DM_EXEC_NEAR4({}, { color: ['d', [1]] }, { shape: ['s', 1], color: ['d', [2]] }, { color: ['d', [2]] },
    { color: ['s', 2], shape: ['d', [1]] }, { shape: ['d', [1]] }, { shape: ['d', [1]], color: ['d', [2]] }),
  [1, 1, 1, 1, 1, 1, 2], ['S near C2 object'], 1],
  [1, 4, DM_EXEC_NEAR4({ shape: 'r' }, { color: ['d', [1]] }, { color: ['s', 1] }, { color: ['d', [2]] },
    { color: ['s', 2] }, { color: ['d', [1]] }, { color: ['d', [1, 2]] }), [1, 1, 1, 1, 1, 1, 2],
  ['C object near C2 object'], 1, 0, 1],
];
const DM_EXEC_MAPS = { 2: ['twoAreaMap', 'twoRoomMap'], 4: ['fourRoomMap'], 6: ['sixRoomMap'] };

// item_count.createGroupCounts{groupMin = {2, 2}, maxObjects = 8}
function _dmExecEvery(st) {
  const out = [2, 2], idx = _dmShuffle(st, [0, 1]);
  let left = crRi(st.pcg, 5);              // 4..8 objects in all
  while (left > 0) {
    for (const i of idx) {
      const v = out[i] + crRi(st.pcg, left + 1);
      left -= v - out[i]; out[i] = v;
    }
  }
  return out;
}

function _dmExecuteRound(st) {
  const L = DM_LEVEL.lang, pick = (a) => a[crRi(st.pcg, a.length)];
  let w = crRi(st.pcg, DM_EXEC_TASKS.reduce((s, t) => s + t[0], 0)), task = DM_EXEC_TASKS[0];
  for (const t of DM_EXEC_TASKS) { if (w < t[0]) { task = t; break; } w -= t[0]; }
  const [, rooms, groups, counts0, keys, byRoom, counting, sameShape] = task;
  const name = pick(DM_EXEC_MAPS[rooms]);
  st.maze = dmLangMaze(DM_LEVEL.seeds[st.seedIdx], name, {});
  st.doors = [];
  dmDoorsChanged(st);
  const m = st.maze;
  const vals = {
    color: Object.keys(L.colors).sort(),
    shape: [...new Set(Object.keys(L.tiles).map((s) => s.split('__')[0]))].sort(),
    region: [...new Set(m.oregions)].filter((v) => v !== '.' && v !== '0').sort(),
  };
  const counts = counts0 === 'every' ? _dmExecEvery(st) : counts0;
  const made = groups.map(() => []);
  groups.forEach((g, gi) => {
    for (let k = 0; k < counts[gi]; k++) {
      const o = {};
      for (const a of ['color', 'region', 'shape']) {
        let spec = g[a];
        if (spec === undefined) spec = a === 'region' ? (byRoom ? 'r' : 'any') : a === 'shape' && sameShape ? ['s', 1] : 'r';
        if (spec === 'any') o[a] = 'any';
        else if (spec === 'r') o[a] = pick(vals[a]);
        else if (spec === 'c') o[a] = k > 0 ? made[gi][0][a] : pick(vals[a]);
        else if (spec[0] === 's') o[a] = made[spec[1] - 1][0][a];
        else {
          const used = new Set(spec[1].flatMap((j) => made[j - 1].map((x) => x[a])));
          o[a] = pick(vals[a].filter((v) => !used.has(v)));
        }
      }
      made[gi].push(o);
    }
  });
  const goals = made[0].length, distract = made.slice(1).reduce((s, g) => s + g.length, 0);
  const bad = -Math.floor((counting ? goals + L.goal_reward : L.goal_reward) / distract + 0.5);
  const free = m.ocells.map((rc, i) => [rc, m.oregions[i]]);
  if (!byRoom) _dmShuffle(st, free);
  const items = [];
  made.forEach((g, gi) => g.forEach((o) => {
    let j = 0;
    if (byRoom) {
      const cand = free.map((f, i) => [f, i]).filter(([f]) => f[1] === o.region);
      j = pick(cand)[1];
    }
    const [rc] = free.splice(j, 1)[0];
    const t = L.tiles[o.shape + '__solid'], sc = L.scales[o.shape] || 1, rgb = L.colors[o.color];
    const reward = gi === 0 ? (counting ? 1 : L.goal_reward) : bad;
    items.push([(rc[1] + 0.5) * DM_CELL, (m.h - rc[0] - 0.5) * DM_CELL, t[0], F(t[1] * sc), F(t[2] * sc),
      reward, rgb, rgb, gi === 0 ? 1 : 0]);
  }));
  dmSetItems(st, items);
  st.lcount = counting ? goals : 0;
  const g1 = made[0][0], g2 = made[1][0];
  st.instr = pick(keys).replace(/C2|S2|C|S/g, (k) => ({ C: g1.color, S: g1.shape, C2: g2.color, S2: g2.shape }[k]));
}

// item_count.createGroupCounts (read as spec): min per group, max (-1 none),
// a fixed total; the remainder handed out in shuffled group order.
function _dmGroupCounts(st, min, max, total) {
  const out = min.slice(), idx = _dmShuffle(st, min.map((_, i) => i));
  let left = total - min.reduce((s, v) => s + v, 0);
  while (left > 0) {
    for (const i of idx) {
      const hi = max[i] >= 0 ? Math.min(max[i], out[i] + left) : out[i] + left;
      const v = out[i] + crRi(st.pcg, hi - out[i] + 1);
      left -= v - out[i]; out[i] = v;
    }
  }
  return out;
}

// A new round of language_answer_quantitative_question in play (its level
// script, read as spec). A question on the 4 'D' cells' objects, answered by
// picking the white 'yes' ball (room A) or the black 'no' ball (room B): +10
// when right, -10 when wrong; the other objects are only to look at. One of 4
// questions, the counts drawn so that yes and no come about equally often:
//   'Are all S objects C?'   1-4 S objects in C, the rest S in other colours
//   'Is any S C?'            S in C / S in another colour / another shape
//   'Is anything C?'         C / another colour / another colour
//   'Are most S objects C?'  as 'any', 7 count setups (4 yes, 3 no)
const DM_ANSWER_MOST = [[1, [1, 0, 0], [-1, 0, -1]], [1, [2, 0, 0], [-1, 1, -1]], [1, [3, 0, 0], [-1, 1, -1]],
  [1, [4, 0, 0], [-1, 0, -1]], [1, [0, 1, 0], [0, -1, -1]], [2, [0, 1, 0], [1, -1, -1]], [1, [0, 2, 0], [2, -1, -1]]];
const DM_ANSWER_COLOURS = ['red', 'green', 'blue', 'cyan', 'magenta', 'yellow'];
function _dmAnswerRound(st) {
  const L = DM_LEVEL.lang, pick = (a) => a[crRi(st.pcg, a.length)];
  st.maze = dmLangMaze(DM_LEVEL.seeds[st.seedIdx], 'quantificationSmallMap',
    { A: 'green', B: 'red', C: 'orange', D: 'black' });
  st.doors = [];
  dmDoorsChanged(st);
  const m = st.maze, cols = DM_ANSWER_COLOURS;
  const shapes = [...new Set(Object.keys(L.tiles).map((s) => s.split('__')[0]))].sort();
  const other = (a, x) => pick(a.filter((v) => v !== x));
  const task = crRi(st.pcg, 4), gs = pick(shapes), gc = pick(cols);
  let objs = [], truth, instr;
  if (task === 0) {
    const n = crRi(st.pcg, 2) === 0 ? [4, 0] : _dmGroupCounts(st, [1, 1], [-1, -1], 4);
    for (let k = 0; k < n[0]; k++) objs.push([gs, gc]);
    for (let k = 0; k < n[1]; k++) objs.push([gs, other(cols, gc)]);
    truth = n[1] === 0; instr = 'Are all ' + gs + ' objects ' + gc + '?';
  } else {
    let n;
    if (task === 3) {
      let w = crRi(st.pcg, 8), e = DM_ANSWER_MOST[0];
      for (const x of DM_ANSWER_MOST) { if (w < x[0]) { e = x; break; } w -= x[0]; }
      n = _dmGroupCounts(st, e[1], e[2], 4);
    } else {
      n = crRi(st.pcg, 2) === 0 ? _dmGroupCounts(st, [1, 0, 0], [-1, -1, -1], 4)
        : _dmGroupCounts(st, [0, 0, 0], [0, -1, -1], 4);
    }
    const anything = task === 2;
    for (let k = 0; k < n[0]; k++) objs.push([anything ? pick(shapes) : gs, gc]);
    for (let k = 0; k < n[1]; k++) objs.push([anything ? pick(shapes) : gs, other(cols, gc)]);
    for (let k = 0; k < n[2]; k++) objs.push(anything ? [pick(shapes), other(cols, gc)] : [other(shapes, gs), pick(cols)]);
    truth = task === 3 ? n[0] > n[1] : n[0] > 0;
    instr = task === 1 ? 'Is any ' + gs + ' ' + gc + '?' : task === 2 ? 'Is anything ' + gc + '?'
      : 'Are most ' + gs + ' objects ' + gc + '?';
  }
  const cells = (v) => m.ocells.filter((_, i) => m.oregions[i] === v);
  const free = _dmShuffle(st, cells('D'));
  const mk = ([r, c], shape, col, reward, goal, look) => {
    const t = L.tiles[shape + '__solid'], sc = L.scales[shape] || 1, rgb = L.colors[col];
    return [(c + 0.5) * DM_CELL, (m.h - r - 0.5) * DM_CELL, t[0], F(t[1] * sc), F(t[2] * sc), reward, rgb, rgb, goal, look];
  };
  const items = [mk(cells('A')[0], 'ball', 'white', truth ? L.goal_reward : -L.goal_reward, truth ? 1 : 0, 0),
    mk(cells('B')[0], 'ball', 'black', truth ? -L.goal_reward : L.goal_reward, truth ? 0 : 1, 0)];
  objs.forEach(([shape, col], k) => items.push(mk(free[k], shape, col, 0, 0, 1)));
  dmSetItems(st, items);
  st.instr = instr;
}

function dmRestart(st) {
  const m = st.maze;
  let ev = null;
  if (st.replayRespawns !== null) {
    for (const r of st.replayRespawns) if (r.frame === st.frame) { ev = r; break; }
  }
  if (ev !== null) {
    st.acc = 0; st.phase = ev.yaw_phase / 512 * DM_U;
    dmPlace(st, ev.pos[0], ev.pos[1], ev.rot);
    if (m.flat) { st.z = st.groundZ; st.vz = 0; st.air = false; }
    if (ev.doors) dmSetDoors(st, ev.doors);
    if (ev.lang) {
      st.maze = dmLangMaze(DM_LEVEL.seeds[st.seedIdx], ev.lang.map, ev.lang.floors);
      st.doors = [];
      dmDoorsChanged(st);
      dmSetItems(st, ev.lang.items);
      st.instr = ev.lang.instr;
      st.lcount = ev.lang.count || 0; st.lend = 0;
    }
    else if (ev.items) dmSetItems(st, ev.items);
    else st.alive.fill(1);
    st.holdLeft = ev.hold; st.catchMs = ev.catch; st.queue.length = 0;
    return;
  }
  if (m.flat) {
    // Box levels restart at their one spawn point, every item back.
    dmPlace(st, m.spawn[0], m.spawn[1], m.spawn[3]);
    st.z = st.groundZ; st.vz = 0; st.air = false;
    st.alive.fill(1);
    st.holdLeft = DM_RESPAWN_HOLD; st.catchMs = DM_RESPAWN_CATCH; st.queue.length = 0;
    return;
  }
  // Play: the factories' rules, the port's PCG.
  if (DM_LEVEL.kind === 'language') {
    // a new round first: it may switch the map the spawn is drawn on
    _dmLangRound(st);
    const mm = st.maze, [r, c] = mm.pcells[crRi(st.pcg, mm.pcells.length)];
    const yaw = F(F(crRf(st.pcg) * 360) - 180);
    st.acc = 0; st.phase = 0;
    dmPlace(st, (c + 0.5) * DM_CELL, (mm.h - r - 0.5) * DM_CELL, yaw);
    st.holdLeft = DM_RESPAWN_HOLD; st.catchMs = DM_RESPAWN_CATCH; st.queue.length = 0;
    return;
  }
  let reach = m.pcells;
  if (DM_LEVEL.kind === 'goal' && m.goal !== null) {
    const [gr, gc] = _dmCellOf(m, m.goal[0], m.goal[1]);
    const ok = new Set(_dmReach(m, gr, gc).map(([r, c]) => r * m.w + c));
    reach = m.pcells.filter(([r, c]) => ok.has(r * m.w + c));
  }
  const [r, c] = reach[crRi(st.pcg, reach.length)];
  const yaw = F(F(crRf(st.pcg) * 360) - 180);
  st.acc = 0; st.phase = 0;
  dmPlace(st, (c + 0.5) * DM_CELL, (m.h - r - 0.5) * DM_CELL, yaw);
  if (st.doors.length) { _dmDrawDoors(st, r, c); dmDoorsChanged(st); }
  if (DM_LEVEL.kind === 'objects') st.alive.fill(1);
  if (DM_LEVEL.kind === 'rewards') {
    const ok = new Set(_dmReach(m, r, c).map(([rr, cc]) => rr * m.w + cc));
    const locs = m.acells.filter(([rr, cc]) => ok.has(rr * m.w + cc));
    _dmShuffle(st, locs);
    const n = Math.floor(DM_LEVEL.pickup_density * locs.length);
    const items = [];
    for (let k = 0; k < n; k++) {
      const pc = k < m.pucats.length ? k : crRi(st.pcg, m.pucats.length);
      const [rr, cc] = locs[k];
      items.push([(cc + 0.5) * DM_CELL, (m.h - rr - 0.5) * DM_CELL, m.pucats[pc]]);
    }
    dmSetItems(st, items);
  }
  st.holdLeft = DM_RESPAWN_HOLD; st.catchMs = DM_RESPAWN_CATCH; st.queue.length = 0;
}

// ---- src/50_tasks/rooms.js ----
// 50_tasks/rooms.js - the rooms family's task rules (the rooms factories and
// level scripts, read as specification; timing from the oracle).
//
//   collect  rooms_collect_good_objects: 10 good (+1) and 10 bad (-1)
//            objects; the episode ends 0.2 s after the 10th pickup.
//   exploit  rooms_exploit_deferred_effects: apples (+1), cakes (+10, in the
//            second room) and a box (-3) whose pickup brightens the floor and
//            fires its target, the door between the rooms; the episode ends
//            0.2 s after the 10th pickup.
//
//   nonmatch rooms_select_nonmatching_object: a teleport pad (+1) carries the
//            player from the room with the example object to the room with
//            two choices; the non-matching one is +10, the matching one -10,
//            and either restarts the map at the spawn.
//
// A TELEPORT: the player's box (+-15, z -24..+32) overlapping the trigger's
// box at a frame's end gives +1 and, a frame later, places the player at the
// destination facing its angle, moving 400 units/s that way, in the air. In
// a G3 replay the frame the +1 arrives and the arrival's movement time are
// the oracle's (server timing varies 0-3 frames); the port must have touched
// the pad by then or nothing happens and the gate fails.
//
// Touch and reward timing are the explore family's (50_tasks/explore.js):
// tested on a frame's end position, the reward reported one frame later.
const DM_ROOMS_END_FRAMES = 12;   // 0.2 s at 60 fps after the last pickup
const DM_ROOMS_PICKUPS_TO_END = 10;

function _dmInTrigger(st, t) {
  return st.x + DM_PLAYER_HALF > t.min[0] && st.x - DM_PLAYER_HALF < t.max[0] &&
    st.y + DM_PLAYER_HALF > t.min[1] && st.y - DM_PLAYER_HALF < t.max[1] &&
    st.z + 32 > t.min[2] && st.z - 24 < t.max[2];
}

// Called by 90_playtrain.js INSTEAD of the frame's walk when a teleport lands
// this frame; returns true if it did.
function dmTeleportFrame(st, act) {
  const tps = DM_LEVEL.maps[st.maze.map] && DM_LEVEL.maps[st.maze.map].teleports;
  if (!tps || tps.length === 0 || st.teleTouched < 0) return false;
  let ms = 17, at = st.teleTouched + 1, ev = null;
  if (st.replayTeleports !== null) {
    ev = st.replayTeleports.find((e) => e.frame >= st.teleTouched && e.frame === st.frame);
    if (!ev) return false;
    ms = ev.ms;
  } else if (st.frame !== at) {
    return false;
  }
  const t = tps[0], a = t.yaw * Math.PI / 180;
  // The arrival frame's yaw is the destination's plus the looks made since the
  // touch; in a replay it is the oracle's, as a respawn's is.
  st.acc = 0; st.phase = ev ? ev.yaw_phase / 512 * DM_U : 0;
  dmPlace(st, t.dest[0], t.dest[1], ev ? ev.rot : t.yaw);
  if (!ev) dmYawUpdate(st, act[0]);
  st.z = F(t.dest[2]); st.vz = 0; st.air = true;
  st.vx = F(DM_TELEPORT_SPEED * F(Math.cos(a))); st.vy = F(DM_TELEPORT_SPEED * F(Math.sin(a)));
  // The arrival moves `ms`: all but this frame's own time under the command
  // that was held when the pad fired, then this frame's (oracle: the sideways
  // speed gained on arrival is one frame of air acceleration).
  const own = st.replayMsec !== null ? st.replayMsec[st.frame] : DM_MSEC_CYCLE[st.frame % 3];
  if (ms > own) dmWalkChopped(st, st.prevAct || act, ms - own);
  dmWalkChopped(st, act, ms > own ? own : ms);
  st.teleTouched = -1;
  return true;
}

function dmRoomsFrame(st) {
  let reward = 0;
  // the teleport pad
  const tps = DM_LEVEL.maps[st.maze.map] && DM_LEVEL.maps[st.maze.map].teleports;
  if (tps && tps.length && st.teleTouched < 0 && !st.air && _dmInTrigger(st, tps[0])) {
    st.teleTouched = st.frame;
    if (st.replayTeleports !== null) {
      const ev = st.replayTeleports.find((e) => e.reward_frame >= st.frame);
      st.teleRewardAt = ev ? ev.reward_frame : -1;
    } else {
      st.teleRewardAt = st.frame + 1;
    }
  }
  if (st.teleRewardAt === st.frame) { reward = F(reward + 1); st.teleRewardAt = -1; }
  if (st.restartAt === st.frame) {
    st.restartAt = -1;
    dmRestart(st);
  }
  if (st.pendingAt >= 0 && st.frame === st.pendingAt + 1) {
    reward = F(reward + st.pendingReward);
    st.pendingReward = 0;
    st.pendingAt = -1;
  }
  const m = st.maze;
  let got = 0, touched = 0;
  for (let i = 0; i < st.items.length; i++) {
    if (!st.alive[i]) continue;
    const it = st.items[i];
    if (_dmTouches(st, it[0], it[1])) {
      st.alive[i] = 0;
      got += m.cats[it[2]][3];
      touched = 1;
      st.picked++;
      if (DM_LEVEL.kind === 'nonmatch') st.restartAt = st.frame + 2;
      else if (st.picked === DM_ROOMS_PICKUPS_TO_END) st.endAt = st.frame + DM_ROOMS_END_FRAMES;
      if (m.cats[it[2]][4] === 'box_door') {
        st.bright = true;
        if (!st.doorOpen && st.doorAt < 0) st.doorAt = st.frame;
        dmBoxGeometry(st);
      }
    }
  }
  if (touched) {
    st.pendingAt = st.frame;
    st.pendingReward = F(st.pendingReward + got);
  }
  if (st.doorAt >= 0 && !st.doorOpen && (DM_LEVEL.maps[m.map + '#dark'].doors || []).length) {
    dmBoxGeometry(st);   // the door is moving
    if (dmDoorOpen(st, 0) >= 1) st.doorOpen = true;
  }
  return reward;
}

// rooms_keys_doors_puzzle: keys (+1; a new key replaces the one carried),
// fence doors that open (+1, the key is used up) when the player's box
// reaches the door's cell while carrying its colour, and the goal (+50; the
// episode ends 0.2 s later). keys_doors_puzzle_factory.lua, read as spec.
// A triggered fence door SLIDES along its angle (H +x, I +y) at 300 units/s,
// starting the frame after the touch, to 95 units, so a stub stays at the far
// end of the cell: a player pressed against that end never gets through
// (oracle seed 8), and the stub's face caps a player beside it at 15.125 off
// (seed 31: 379.875 = 395 - 15.125; the obstructed doors' 94 is the same face
// measured with the text maze's 16). The probe
// (reference/oracle/probe_fence_door.py) fixes the speed: touched at the end
// of frame 151, the gap passes the player's box between frames 165 and 166.
const DM_FENCE_SPEED = 300, DM_FENCE_SLIDE = 95;

function dmFenceSlide(st, k) {
  const t0 = st.doorStartAt ? st.doorStartAt[k] : -1;
  if (t0 < 0 || st.frame < t0) return 0;
  const s = (st.frame - t0 + 1) * 0.016 * DM_FENCE_SPEED;
  return s >= DM_FENCE_SLIDE ? DM_FENCE_SLIDE : F(s);
}

function dmKeysFrame(st) {
  let reward = 0;
  if (st.pendingAt >= 0 && st.frame === st.pendingAt + 1) {
    reward = st.pendingReward;
    st.pendingReward = 0;
    st.pendingAt = -1;
  }
  const m = st.maze;
  let got = 0, touched = 0;
  for (let i = 0; i < st.items.length; i++) {
    if (!st.alive[i]) continue;
    const it = st.items[i], cat = m.cats[it[2]];
    if (!_dmTouches(st, it[0], it[1])) continue;
    st.alive[i] = 0;
    got += cat[3]; touched = 1;
    if (cat[4] !== null) st.carried = cat[4];
    else st.endAt = st.frame + DM_ROOMS_END_FRAMES;   // the goal
  }
  let changed = false;
  if (!st.doorStartAt) st.doorStartAt = new Int32Array(st.doors.length).fill(-1);
  for (let k = 0; k < st.doors.length; k++) {
    const d = st.doors[k];
    if (st.doorStartAt[k] >= 0) {
      // moving (or fully open): its slab follows the slide
      const sl = dmFenceSlide(st, k);
      if (sl !== d[2]) { d[2] = sl; changed = true; }
      continue;
    }
    if (st.carried === null || m.door_colours[k] !== st.carried) continue;
    const x0 = d[1] * DM_CELL, y0 = (m.h - 1 - d[0]) * DM_CELL;
    if (st.x + DM_PLAYER_HALF > x0 && st.x - DM_PLAYER_HALF < x0 + DM_CELL &&
        st.y + DM_PLAYER_HALF > y0 && st.y - DM_PLAYER_HALF < y0 + DM_CELL) {
      st.doorStartAt[k] = st.frame + 1;
      st.carried = null; got += 1; touched = 1;
    }
  }
  if (changed) dmDoorsChanged(st);
  if (touched) {
    st.pendingAt = st.frame;
    st.pendingReward = F(st.pendingReward + got);
  }
  return reward;
}

// rooms_watermaze (navigate_watermaze_factory.lua, read as spec; timing from
// reference/oracle/probe_watermaze.py, two approaches that agree frame for
// frame). The platform's button is an octagon 64 across its flats about the
// platform's origin; the player's box touching it (tested on a frame's end)
// fires it, and 6 frames later the player is put on the platform's centre,
// at rest, and held there while it rises (DMLab's lua mover). +1 comes 10
// frames after that, then every 1000 ms of engine time; one period after the
// 5th the map restarts at a spawn point. The oracle re-centres the player
// every 6 frames and lets it walk in between; the port holds it every frame.
const DM_WATER_ARM = 6, DM_WATER_FIRST = 10, DM_WATER_PERIOD = 1000, DM_WATER_REWARDS = 5;
// the player's height, frames after the hold began (the platform rising
// 35 units a server tick and pushing it; both probes identical)
const DM_WATER_RISE = [40.125, 40.125, 40.125, 40.125, 40.125, 40.125, 75.0459, 74.7715, 74.2309,
  108.4888, 107.6684, 106.4648, 130.9502, 129.5838, 127.7172, 125.6126, 123.7002, 121.1706, 118.403, 118.125];

function dmWaterReset(st) {
  st.wmArm = -1; st.wmHold = -1; st.wmGiven = 0; st.wmMs = 0;
}

function _dmOnButton(st) {
  const P = st.maze.platform, dx = Math.abs(st.x - P[0]), dy = Math.abs(st.y - P[1]);
  return dx < 64 + DM_PLAYER_HALF && dy < 64 + DM_PLAYER_HALF && dx + dy < 90 + 2 * DM_PLAYER_HALF;
}

function dmWaterFrame(st) {
  let reward = 0;
  if (st.restartAt === st.frame) {
    st.restartAt = -1;
    dmWaterRestart(st);
    return 0;
  }
  if (st.wmHold < 0) {
    if (st.wmArm < 0 && _dmOnButton(st)) st.wmArm = st.frame;
    if (st.wmArm >= 0 && st.frame >= st.wmArm + DM_WATER_ARM) st.wmHold = st.frame;
  }
  if (st.wmHold >= 0) {
    const k = st.frame - st.wmHold, P = st.maze.platform;
    st.x = F(P[0]); st.y = F(P[1]); st.vx = 0; st.vy = 0; st.vz = 0; st.air = false;
    st.z = F(DM_WATER_RISE[k < DM_WATER_RISE.length ? k : DM_WATER_RISE.length - 1]);
    st.groundZ = st.z;
    if (k === DM_WATER_FIRST) { reward = 1; st.wmGiven = 1; st.wmMs = 0; }
    else if (k > DM_WATER_FIRST) {
      st.wmMs += st.replayMsec !== null ? st.replayMsec[st.frame] : DM_MSEC_CYCLE[st.frame % 3];
      if (st.wmMs >= DM_WATER_PERIOD) {
        st.wmMs -= DM_WATER_PERIOD;
        if (st.wmGiven >= DM_WATER_REWARDS) st.restartAt = st.frame + 1;
        else { reward = 1; st.wmGiven++; }
      }
    }
  }
  return reward;
}

// finishMap: the map loads again; the player starts at one of the map's
// spawn points (DMLab's pick: here the episode's PCG), facing anywhere.
function dmWaterRestart(st) {
  const map = DM_LEVEL.maps[st.maze.map];
  let x, y, yaw;
  if (st.replayRespawns !== null && st.replayRespawns.length) {
    const ev = st.replayRespawns.find((r) => r.frame === st.frame);
    if (ev) { x = ev.pos[0]; y = ev.pos[1]; yaw = ev.rot; st.phase = ev.yaw_phase / 512 * DM_U; }
  }
  if (x === undefined) {
    const sp = map.spawns[crRi(st.pcg, map.spawns.length)];
    x = sp[0]; y = sp[1]; yaw = F(F(crRf(st.pcg) * 360) - 180); st.phase = 0;
  }
  st.acc = 0;
  dmPlace(st, x, y, yaw);
  st.groundZ = F(map.stand_z); st.z = st.groundZ; st.vz = 0; st.air = false;
  dmWaterReset(st);
  st.holdLeft = DM_RESPAWN_HOLD; st.catchMs = DM_RESPAWN_CATCH; st.queue.length = 0;
}

// ---- src/80_render.js ----
// 80_render.js - the first-person frame: one mazeView call and the goal sprite.
//
// Every pixel comes from the rasterizer (crates/rasterizer/src/maze.rs); this
// file only says what to draw. The cell planes are packed once per episode:
// nothing in an explore maze changes while it is played.
const DM_VIEW_DIST = F(30.0);       // cells; the largest explore maze is 17 wide

// Human play only (an env never calls humanStart): pass mazeBoxes just the
// boxes some pixel's ray can reach, for 60 frames a second in the browser.
// A ray's hit point q (from the eye) has |q.right| <= q.fwd, |q.up| <= q.fwd
// and |q| <= DM_VIEW_DIST; a box with all eight corners past one of those
// planes, or wholly beyond the view distance, is never hit. Dropping it and
// keeping the rest in order leaves every pixel as it was.
const DM_CULL_MARGIN = 0.05;   // cells
let _dmCullBuf = null, _dmCulled = null;
function dmCullBoxes(bx, ex, ey, ez, yaw) {
  if (!dmHuman) return bx;
  const n = bx.length / 60;
  if (!_dmCullBuf || _dmCullBuf.length < bx.length) _dmCullBuf = new Float32Array(bx.length);
  const p = dmLookPitch * Math.PI / 180;
  const s = Math.sin(yaw), co = Math.cos(yaw), sp = Math.sin(p), cp = Math.cos(p);
  const f = [s * cp, -sp, -co * cp], u = [s * sp, cp, -co * sp], r = [co, 0, s];
  // outside the view when q.N > margin for every corner
  const planes = [
    [-f[0], -f[1], -f[2]],
    [r[0] - f[0], r[1] - f[1], r[2] - f[2]], [-r[0] - f[0], -r[1] - f[1], -r[2] - f[2]],
    [u[0] - f[0], u[1] - f[1], u[2] - f[2]], [-u[0] - f[0], -u[1] - f[1], -u[2] - f[2]],
  ];
  const far = DM_VIEW_DIST + DM_CULL_MARGIN;
  let k = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 60;
    const lo = [bx[o] - ex, bx[o + 1] - ey, bx[o + 2] - ez], hi = [bx[o + 3] - ex, bx[o + 4] - ey, bx[o + 5] - ez];
    // distance from the eye to the box
    let d2 = 0;
    for (let a = 0; a < 3; a++) { const g = lo[a] > 0 ? lo[a] : hi[a] < 0 ? -hi[a] : 0; d2 += g * g; }
    let out = d2 > far * far;
    for (let j = 0; j < planes.length && !out; j++) {
      const N = planes[j];
      // the corner furthest along -N: if even it is past the plane, all are
      const q = (N[0] < 0 ? hi[0] : lo[0]) * N[0] + (N[1] < 0 ? hi[1] : lo[1]) * N[1] + (N[2] < 0 ? hi[2] : lo[2]) * N[2];
      if (q > DM_CULL_MARGIN) out = true;
    }
    if (!out) { _dmCullBuf.set(bx.subarray(o, o + 60), k * 60); k++; }
  }
  return _dmCullBuf.subarray(0, k * 60);
}
const DM_PLANES = 8;
const DM_NONE = 0xFFFF;
const DM_SOLID = 0x100;
const DM_DECAL_LO = F(0.25), DM_DECAL_HI = F(0.75);   // poster square on a face
// Sprite sizes come from each model's bounding box (DM_LEVEL goal_size, cats).

let _dmAtlas = null;
// The atlas tile word of rs_maze_view/_boxes/_quads: the tile size, and in
// bits 16-23 the mip levels the atlas carries past the first (maze.rs, V2).
// Sprites always take level 0.
let _dmTileWord = typeof DM_ATLAS_TILE === 'undefined' ? 0 : DM_ATLAS_TILE | (DM_ATLAS_MIPS << 16);   // psychlab has no atlas
let _dmCells = null;
let _dmCellsFor = null;
let _dmCellsVersion = -1;

// The skybox over whatever the geometry left as sky (rs_maze_sky), drawn
// before the sprites so their soft edges blend over it; none where the
// level shows no sky (DM_SKY_B64 null, atlas/<level>.js).
let _dmSkyCube = null;
function _dmDrawSky(yaw) {
  if (DM_SKY_B64 === null) return;
  if (_dmSkyCube === null) _dmSkyCube = _dmDecode(DM_SKY_B64);
  mazeSky(yaw, _dmSkyCube, DM_SKY_SIZE, 0, 0, width, height);
}

function _dmDecode(b64) {
  if (typeof atob === 'function') {
    const s = atob(b64), out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

function dmPackCells(m, shut) {
  const n = m.w * m.h, p = new Uint16Array(n * DM_PLANES).fill(DM_NONE);
  for (let r = 0; r < m.h; r++) {
    for (let c = 0; c < m.w; c++) {
      const i = r * m.w + c;
      const door = shut[i] === 1;
      const solid = m.rows[r][c] === '*' || door;
      p[i] = door ? DM_LEVEL.door_tile : m.wall[i];
      p[n + i] = m.floor[i];
      p[2 * n + i] = DM_NONE;             // open sky: explore uses a skybox
      p[3 * n + i] = solid ? DM_SOLID : 0;
    }
  }
  for (const [r, c, face, tile] of m.decals) p[(4 + face) * n + r * m.w + c] = tile;
  return p;
}

function dmRenderBoxes(st) {
  const m = st.maze;
  background(0, 0, 0);
  // Primitive frame: x = X/100, y = Z/100, z = -Y/100.
  const ex = F(st.x / DM_CELL), ez = F(F(-st.y) / DM_CELL);
  const ey = F((st.z + DM_EYE_HEIGHT) / DM_CELL);
  const yaw = F(F(90 - st.yaw) * F(Math.PI / 180));
  mazeBoxes(_dmCulled = dmCullBoxes(m.boxesF32.subarray(0, m.nBoxes * 60), ex, ey, ez, yaw), _dmCulled.length / 60, ex, ey, ez, yaw, DM_VIEW_DIST,
    _dmAtlas, _dmTileWord, DM_ATLAS_COUNT, DM_LEVEL.sky, 0, 0, width, height);
  _dmDrawSky(yaw);
  const base = F((st.z - 24) / DM_CELL);   // the floor: origin minus the player's 24 below
  for (let i = 0; i < st.items.length; i++) {
    if (!st.alive[i]) continue;
    const it = st.items[i], cat = m.cats[it[2]];
    mazeSprite(ex, ey, ez, yaw, DM_VIEW_DIST, F(it[0] / DM_CELL), F(F(-it[1]) / DM_CELL), base, cat[1], cat[2],
      _dmAtlas, DM_ATLAS_TILE, DM_ATLAS_COUNT, cat[0], 0, 0, width, height);
  }
}

// rooms_watermaze: floor, glass, sky lid and the platform (risen with the
// player standing on it, else down under the floor) as boxes, then the arena's
// 16 wall faces and its eight landmark pictures as quads.
let _dmWaterBoxes = null, _dmWaterFor = null, _dmWaterLift = NaN;
function dmRenderWater(st) {
  const m = st.maze, map = DM_LEVEL.maps[m.map];
  // platform top: under the player's feet while held, at most fully raised
  let top = F(map.plat_top - map.plat_rise);
  if (st.wmHold >= 0) {
    const feet = F(st.z - 24.125);
    top = feet > map.plat_top ? F(map.plat_top) : (feet > top ? feet : top);
  }
  const lift = F(top - map.plat_top);
  if (_dmWaterFor !== m || lift !== _dmWaterLift) {
    const out = new Float32Array(map.boxes.length + map.plat_boxes.length);
    out.set(map.boxes);
    const n0 = map.boxes.length, P = m.platform;
    for (let i = 0; i < map.plat_boxes.length; i += 60) {
      const b = Float32Array.from(map.plat_boxes.slice(i, i + 60));
      // primitive frame: x = X/100, y = Z/100, z = -Y/100
      b[0] = F(b[0] + F(P[0] / DM_CELL)); b[3] = F(b[3] + F(P[0] / DM_CELL));
      b[1] = F(b[1] + F(lift / DM_CELL)); b[4] = F(b[4] + F(lift / DM_CELL));
      b[2] = F(b[2] - F(P[1] / DM_CELL)); b[5] = F(b[5] - F(P[1] / DM_CELL));
      out.set(b, n0 + i);
    }
    _dmWaterBoxes = out; _dmWaterFor = m; _dmWaterLift = lift;
  }
  background(0, 0, 0);
  const ex = F(st.x / DM_CELL), ez = F(F(-st.y) / DM_CELL);
  const ey = F((st.z + DM_EYE_HEIGHT) / DM_CELL);
  const yaw = F(F(90 - st.yaw) * F(Math.PI / 180));
  mazeBoxes(_dmCulled = dmCullBoxes(_dmWaterBoxes, ex, ey, ez, yaw), _dmCulled.length / 60, ex, ey, ez, yaw, DM_VIEW_DIST,
    _dmAtlas, _dmTileWord, DM_ATLAS_COUNT, DM_LEVEL.sky, 0, 0, width, height);
  // the arena's wall faces and the landmarks on them
  if (!map._quads) map._quads = Float32Array.from(map.quads);
  mazeQuads(map._quads, map._quads.length / 12, ex, ey, ez, yaw, DM_VIEW_DIST,
    _dmAtlas, _dmTileWord, DM_ATLAS_COUNT, 0, 0, width, height);
  _dmDrawSky(yaw);
}

// rooms_keys_doors_puzzle: a text maze with invisible walls, drawn as boxes -
// the compiled floor slabs and every fence door still shut.
let _dmKeysBoxes = null, _dmKeysFor = null, _dmKeysVersion = -1;
function dmRenderKeys(st) {
  const m = st.maze;
  if (_dmKeysFor !== m || _dmKeysVersion !== st.cellsVersion) {
    const parts = [m.floor_boxes];
    for (let k = 0; k < st.doors.length; k++) {
      // a fence door's slab, slid along its angle: H +x, I +y (primitive -z)
      const sl = F((st.doors[k][2] || 0) / DM_CELL), b = m.door_boxes[k].slice();
      if (m.rows[st.doors[k][0]][st.doors[k][1]] === 'H') { b[0] = F(b[0] + sl); b[3] = F(b[3] + sl); }
      else { b[2] = F(b[2] - sl); b[5] = F(b[5] - sl); }
      parts.push(b);
    }
    _dmKeysBoxes = Float32Array.from([].concat(...parts));
    _dmKeysFor = m; _dmKeysVersion = st.cellsVersion;
  }
  background(0, 0, 0);
  const ex = F(st.x / DM_CELL), ez = F(F(-st.y) / DM_CELL);
  const ey = F((st.z + DM_EYE_HEIGHT) / DM_CELL);
  const yaw = F(F(90 - st.yaw) * F(Math.PI / 180));
  mazeBoxes(_dmCulled = dmCullBoxes(_dmKeysBoxes, ex, ey, ez, yaw), _dmCulled.length / 60, ex, ey, ez, yaw, DM_VIEW_DIST,
    _dmAtlas, _dmTileWord, DM_ATLAS_COUNT, DM_LEVEL.sky, 0, 0, width, height);
  _dmDrawSky(yaw);
  const base = F(m.floor_z / DM_CELL);
  for (let i = 0; i < st.items.length; i++) {
    if (!st.alive[i]) continue;
    const it = st.items[i], cat = m.cats[it[2]];
    mazeSprite(ex, ey, ez, yaw, DM_VIEW_DIST, F(it[0] / DM_CELL), F(F(-it[1]) / DM_CELL), base, cat[1], cat[2],
      _dmAtlas, DM_ATLAS_TILE, DM_ATLAS_COUNT, cat[0], 0, 0, width, height);
  }
}

// skymaze: the compiled platform slabs and the goal on its platform.
let _dmSkyBoxes = null, _dmSkyFor = null;
function dmRenderSky(st) {
  const m = st.maze;
  if (_dmSkyFor !== m) { _dmSkyBoxes = Float32Array.from(m.sky_boxes); _dmSkyFor = m; }
  background(0, 0, 0);
  const ex = F(st.x / DM_CELL), ez = F(F(-st.y) / DM_CELL);
  const ey = F((st.z + DM_EYE_HEIGHT) / DM_CELL);
  const yaw = F(F(90 - st.yaw) * F(Math.PI / 180));
  mazeBoxes(_dmCulled = dmCullBoxes(_dmSkyBoxes, ex, ey, ez, yaw), _dmCulled.length / 60, ex, ey, ez, yaw, DM_VIEW_DIST,
    _dmAtlas, _dmTileWord, DM_ATLAS_COUNT, DM_LEVEL.sky, 0, 0, width, height);
  _dmDrawSky(yaw);
  for (let i = 0; i < st.items.length; i++) {
    if (!st.alive[i]) continue;
    const it = st.items[i], cat = m.cats[it[2]];
    const c = Math.floor(it[0] / DM_CELL), r = m.h - 1 - Math.floor(it[1] / DM_CELL);
    const base = F(m.tops[r * m.w + c] / DM_CELL);
    mazeSprite(ex, ey, ez, yaw, DM_VIEW_DIST, F(it[0] / DM_CELL), F(F(-it[1]) / DM_CELL), base, cat[1], cat[2],
      _dmAtlas, DM_ATLAS_TILE, DM_ATLAS_COUNT, cat[0], 0, 0, width, height);
  }
}

// DMLab's HUD as our own drawing (V1): its art is OpenArena's (GPL), so the
// port draws one flat box per element instead. Box [row0, row1, col0, col1]
// on the 64x64 view, opacity and colour fitted to the oracle's frames
// (least absolute error of (1 - a) * port + a * colour over 17 levels x 224
// frames, frame 0 left out for the spawn effect).
const DM_HUD = [
  [0, 1, 61, 62, 0.35, 124, 139, 158],     // top-right dot
  [54, 56, 60, 63, 0.5, 33, 51, 225],      // bottom-right icon
  [57, 62, 29, 32, 1.0, 60, 146, 143],     // the cyan figure
  [58, 63, 2, 9, 0.6, 125, 98, 14],        // the orange icon
  [58, 60, 11, 13, 1.0, 136, 255, 255],    // the small cyan icon
  [58, 63, 19, 27, 0.5, 110, 113, 116],    // the grey digits
];
function dmDrawHud() {
  const s = width / 64;
  noStroke();
  for (const [r0, r1, c0, c1, a, cr, cg, cb] of DM_HUD) {
    fill(cr, cg, cb, Math.round(a * 255));
    rect(c0 * s, r0 * s, (c1 - c0 + 1) * s, (r1 - r0 + 1) * s);
  }
}

// DMLab's spawn effect as our own drawing (V1b): rings around the player,
// so on screen a band between u0 and u1, where u = (row - 32) /
// sqrt(1 + ((col - 32) / 32)^2) is height over distance on a cylinder round
// the eye (the same at any pose). Frame 0: the level's DM_SPAWN0 bands
// (src/spawn/<level>.js, fitted to its oracle frame-0 dumps by
// tools/fit_spawn.py; the rings' phase there differs by level). From then on
// one band that fades out by frame 27 (fitted to reference/oracle/
// probe_spawn.py: no-op after reset). After the episode's first spawn only:
// drawn after restarts too, it made nonmatch's later frames worse.
const DM_SPAWN_BAND = [18, 21, 255, 250, 255], DM_SPAWN_END = 27;
function _dmBand(u0, u1, a, r, g, b) {
  const s = width / 64;
  fill(r, g, b, Math.round(a * 255));
  for (let c = 0; c < 64; c++) {
    const d = F(F(F(c + 0.5) - 32) / 32);
    const k = F(Math.sqrt(F(1 + F(d * d))));
    const y0 = F(32 + F(u0 * k)), y1 = F(32 + F(u1 * k));
    rect(c * s, y0 * s, s, F(y1 - y0) * s);
  }
}
function dmDrawSpawn(st) {
  const t = st.frame - st.spawnFrame;
  if (t < 0 || t >= DM_SPAWN_END) return;
  noStroke();
  if (t === 0) {
    for (const [u0, u1, a, r, g, b] of DM_SPAWN0) _dmBand(u0, u1, a, r, g, b);
    return;
  }
  const [u0, u1, r, g, b] = DM_SPAWN_BAND;
  _dmBand(u0, u1, Math.min(0.6, F(F(0.62 * (DM_SPAWN_END - t)) / 23)), r, g, b);
}

function dmRender(st) {
  if (DM_LEVEL.kind === 'psychlab') { dmRenderPsych(st); return; }
  // the maze primitives' pitch: a person's look up/down, 0 for an agent; set
  // every frame (the rasterizer keeps it per thread)
  if (typeof mazePitch === 'function') mazePitch(dmLookPitch * Math.PI / 180);
  dmRenderScene(st);
  dmDrawSpawn(st);
  if (!dmHuman) dmDrawHud();
}

function dmRenderScene(st) {
  if (_dmAtlas === null) _dmAtlas = _dmDecode(DM_ATLAS_B64);
  if (DM_LEVEL.kind === 'water') { dmRenderWater(st); return; }
  if (st.maze.flat) { dmRenderBoxes(st); return; }
  if (DM_LEVEL.kind === 'sky') { dmRenderSky(st); return; }
  if (DM_LEVEL.kind === 'keys') { dmRenderKeys(st); return; }
  const m = st.maze;
  if (_dmCellsFor !== m || _dmCellsVersion !== st.cellsVersion) {
    _dmCells = dmPackCells(m, dmShutMask(st));
    _dmCellsFor = m; _dmCellsVersion = st.cellsVersion;
  }
  background(0, 0, 0);
  // Grid x = column, z = row (row 0 is DMLab's north edge), y up, one cell a
  // unit; DMLab yaw is counter-clockwise from east, the primitive's yaw is
  // clockwise from north (-z).
  const ex = F(st.x / DM_CELL);
  const ez = F(m.h - F(st.y / DM_CELL));
  const ey = F((DM_FEET_Z + DM_EYE_HEIGHT - DM_FLOOR_Z) / DM_CELL);
  const yaw = F(F(90 - st.yaw) * F(Math.PI / 180));
  mazeView(_dmCells, m.w, m.h, ex, ey, ez, yaw, DM_VIEW_DIST,
    _dmAtlas, _dmTileWord, DM_ATLAS_COUNT, DM_LEVEL.sky, DM_DECAL_LO, DM_DECAL_HI,
    0, 0, width, height);
  _dmDrawSky(yaw);
  const g = m.goal;
  if (g !== null) {
    mazeSprite(ex, ey, ez, yaw, DM_VIEW_DIST,
      F(g[0] / DM_CELL), F(m.h - F(g[1] / DM_CELL)), 0, DM_LEVEL.goal_size[0], DM_LEVEL.goal_size[1],
      _dmAtlas, DM_ATLAS_TILE, DM_ATLAS_COUNT, DM_LEVEL.goal_tile, 0, 0, width, height);
  }
  for (let i = 0; i < st.items.length; i++) {
    if (!st.alive[i]) continue;
    const it = st.items[i];
    if (it.length >= 8) {
      // a language object: a two-colour tile, coloured as it draws (rs_maze_sprite2)
      mazeSprite2(ex, ey, ez, yaw, DM_VIEW_DIST,
        F(it[0] / DM_CELL), F(m.h - F(it[1] / DM_CELL)), 0, it[3], it[4],
        _dmAtlas, DM_ATLAS_TILE, DM_ATLAS_COUNT, it[2], 0, 0, width, height, it[6], it[7]);
      continue;
    }
    const cat = m.cats[it[2]];
    mazeSprite(ex, ey, ez, yaw, DM_VIEW_DIST,
      F(it[0] / DM_CELL), F(m.h - F(it[1] / DM_CELL)), 0, cat[1], cat[2],
      _dmAtlas, DM_ATLAS_TILE, DM_ATLAS_COUNT, cat[0], 0, 0, width, height);
  }
}

// --- psychlab (T7) -------------------------------------------------------
// The room is a cube panorama around the fixed eye (src/atlas/<level>.js,
// tools/psych_panorama.py); the screen and what it shows are solid quads on
// its plane (DM_LEVEL.screen), drawn over it by rs_maze_pview with the view's
// yaw and pitch. DMLab's HUD goes over the view as translucent cells
// (DM_PSY_HUD, captured with the room).
let _dmPano = null;

// st.screen: [x0, y0, x1, y1, r, g, b] rects in screen units (0..1, y down),
// later ones over earlier ones.
function dmPsychQuads(st) {
  const sc = DM_LEVEL.screen, e = DM_LEVEL.eye;
  const W = sc.x1 - sc.x0, H = sc.z1 - sc.z0;
  const q = new Float32Array(st.screen.length * 12);
  st.screen.forEach(([x0, y0, x1, y1, r, g, b], k) => {
    q.set([sc.x0 + x0 * W - e[0], sc.y - e[1], sc.z1 - y0 * H - e[2],
      (x1 - x0) * W, 0, 0, 0, 0, -(y1 - y0) * H, r, g, b], k * 12);
  });
  return q;
}

function dmRenderPsych(st) {
  if (_dmPano === null) _dmPano = _dmDecode(DM_PANO_B64);
  const q = dmPsychQuads(st);
  mazePview(st.yaw * Math.PI / 180, st.pitch * Math.PI / 180, 1.0, _dmPano, DM_PANO_SIZE,
    q, q.length / 12, 0, 0, width, height);
  const s = width / 64;
  noStroke();
  if (dmHuman) {
    // a person needs to see where they look: a crosshair at the view's centre
    const c = width / 2, l = width / 24, t = Math.max(1, width / 160);
    fill(0, 0, 0, 160);
    rect(c - l - t, c - 2 * t, 2 * (l + t), 4 * t); rect(c - 2 * t, c - l - t, 4 * t, 2 * (l + t));
    fill(255, 255, 255);
    rect(c - l, c - t, 2 * l, 2 * t); rect(c - t, c - l, 2 * t, 2 * l);
    return;
  }
  for (const [r, c, a, cr, cg, cb] of DM_PSY_HUD) {
    fill(cr, cg, cb, Math.round(a * 255));
    rect(c * s, r * s, s, s);
  }
}

// ---- src/90_playtrain.js ----
// 90_playtrain.js - the PlayTrain contract: setup, draw, resetGame,
// getGameState, and the keys that make up an action.
//
// One draw() is one agent step: DM_REPEAT engine frames with the same action
// (IMPALA's action repeat 4), then one frame rendered. Reward is the score
// delta; the episode is truncated at DMLab's episode length.
// The canvas a human sees. Agents still get 64x64: the runtime rasterizes
// at the observation size and the maze primitives take their rect in canvas
// units, so the same draw() renders either.
const CANVAS_SIZE = 256;
const DM_KEY = { W: 87, S: 83, A: 65, D: 68, LEFT: 37, RIGHT: 39, UP: 38, DOWN: 40, SPACE: 32 };

let gameState = null;
let gameOver = false;

function setup() {
  createCanvas(CANVAS_SIZE, CANVAS_SIZE);
  if (gameState === null) resetGame(0);
}

// The sidecar's actions hold these keys; this maps them back to the index.
function currentAction() {
  if (typeof keyIsDown !== 'function') return -1;
  const k = (c) => keyIsDown(c);
  if (k(DM_KEY.SPACE)) return 8;
  const fwd = k(DM_KEY.W), left = k(DM_KEY.LEFT), right = k(DM_KEY.RIGHT);
  if (fwd && left) return 6;
  if (fwd && right) return 7;
  if (left) return 4;
  if (right) return 5;
  if (DM_LEVEL.kind === 'psychlab' && k(DM_KEY.UP)) return 9;
  if (DM_LEVEL.kind === 'psychlab' && k(DM_KEY.DOWN)) return 10;
  if (fwd) return 0;
  if (k(DM_KEY.S)) return 1;
  if (k(DM_KEY.A)) return 2;
  if (k(DM_KEY.D)) return 3;
  return -1;   // no key: a human standing still (not in the agent's action set)
}

// One engine frame with action vector `act`. Returns the frame's reward.
function dmFrame(st, act) {
  const msec = st.replayMsec !== null ? st.replayMsec[st.frame]
    : DM_MSEC_CYCLE[st.frame % 3];
  if (DM_LEVEL.kind === 'psychlab') {
    const r = dmPsychFrame(st, act);
    st.prevAct = act;
    st.score = F(st.score + r);
    st.frame++;
    return r;
  }
  if (st.holdLeft >= 0) {
    // After a restart: the view turns, the walk waits, then catches up.
    dmYawUpdate(st, act[0]);
    st.queue.push([act, st.yaw, msec]);   // a queued command keeps the view and msec it was made with
    if (st.holdLeft > 0) {
      st.holdLeft--;
    } else {
      const yawNow = st.yaw;
      for (let i = 0; i < st.queue.length; i++) {
        st.yaw = st.queue[i][1];
        dmWalkChopped(st, st.queue[i][0], i === 0 ? st.catchMs : st.queue[i][2]);
      }
      st.yaw = yawNow;
      st.queue.length = 0;
      st.holdLeft = -1;
    }
  } else if (!(st.maze.flat && dmTeleportFrame(st, act))) {
    dmPmove(st, act, msec);
  }
  const r = dmTaskFrame(st);
  st.prevAct = act;
  st.score = F(st.score + r);
  st.frame++;
  return r;
}

function dmMaxFrames() { return DM_LEVEL.episode_seconds * DM_FPS; }

// Human play only. The play page calls humanStart() once and humanLook(dx, dy)
// on mouse moves; an env never does, so what an agent sees and does is
// unchanged. A person gets mouse look, a crosshair in psychlab, no approximate
// HUD, and every engine frame drawn: one frame a page tick at 60 fps, where an
// agent's step is DM_REPEAT frames with only the last one rendered (the page
// would show 15 fps). The game's speed is the same either way.
let dmHuman = false, dmLookDx = 0, dmLookDy = 0;
// mouse pixels to DMLab look pixels (0.1056 degrees each): 3 gives 0.32
// degrees a mouse pixel, a common first-person sensitivity
const DM_MOUSE = 3;
// The view's pitch for a person outside psychlab (degrees, positive looks
// down; PLAN.md section 12). Drawing only: Quake walks along the yaw alone, so
// pitch never moves the player (PROGRESS.md P0), and only humanLook changes it.
let dmLookPitch = 0;
var humanStart = function () { dmHuman = true; };
var humanLook = function (dx, dy) {
  dmLookDx += dx * DM_MOUSE;
  if (DM_LEVEL.kind === 'psychlab') { dmLookDy += dy * DM_MOUSE; return; }
  dmLookPitch = Math.max(-85, Math.min(85, dmLookPitch + dy * DM_MOUSE * DM_LOOK));
};

function draw() {
  if (gameState === null) resetGame(0);
  if (!gameOver) {
    const a = currentAction();
    let act = a < 0 ? DM_NOOP : DM_ACTIONS[a];
    if (dmLookDx !== 0 || dmLookDy !== 0) {
      // the whole move on this step's first frame; psychlab's pitch kept within 85 degrees
      act = act.slice();
      act[0] += dmLookDx;
      if (DM_LEVEL.kind === 'psychlab') {
        const p = gameState.pitch + dmLookDy * DM_LOOK;
        act[1] += p > 85 ? (85 - gameState.pitch) / DM_LOOK : p < -85 ? (-85 - gameState.pitch) / DM_LOOK : dmLookDy;
      }
      dmLookDx = 0; dmLookDy = 0;
    }
    // a person's arrow up / down outside psychlab: the look actions' rate
    // (20 px a frame), drawing only like the mouse's
    const frames = dmHuman ? 1 : DM_REPEAT;
    if (dmHuman && DM_LEVEL.kind !== 'psychlab' && typeof keyIsDown === 'function') {
      const step = frames * 20 * DM_LOOK;
      if (keyIsDown(DM_KEY.UP)) dmLookPitch = Math.max(-85, dmLookPitch - step);
      if (keyIsDown(DM_KEY.DOWN)) dmLookPitch = Math.min(85, dmLookPitch + step);
    }
    for (let i = 0; i < frames && !gameOver; i++) {
      dmFrame(gameState, i === 0 ? act : (a < 0 ? DM_NOOP : DM_ACTIONS[a]));
      if (gameState.frame >= dmMaxFrames()) gameOver = true;
      if (gameState.endAt >= 0 && gameState.frame >= gameState.endAt) gameOver = true;
    }
  }
  dmRender(gameState);
}

function resetGame(seed) {
  dmLookPitch = 0;
  if (gameState === null) gameState = createState();
  dmLoad(gameState, seed >>> 0);
  gameOver = false;
}

// The instruction (a text observation, info['instruction']): language levels only.
var getInstruction = DM_LEVEL.kind === 'language' ? function () { return gameState ? gameState.instr : ''; } : undefined;

function getGameState() {
  return {
    score: gameState === null ? 0 : gameState.score,
    lives: 1,
    gameState: gameOver ? 'GAMEOVER' : 'PLAYING',
  };
}
