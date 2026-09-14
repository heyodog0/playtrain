// ============================================================================
// craftax_classic v0.1.0 — GENERATED, DO NOT EDIT
//
// Built by tools/bundle_multifile.py from 17 sources listed in
// examples/games/multifile/parity/craftax_classic/manifest.json
// Source hash (sha256 over the concatenated sources): cdc9d360157c80d19646720868d36f8c6fcdf44ef7b959bf9f17dd2b1ef3e8c3
//
// Edit the files under src/ and common/, then run:
//     just bundle craftax_classic
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

// ---- ../../common/u64bits.js ----
// u64bits.js — the per-row uint64 occupancy bitmaps, as uint32 pairs.
//
// The C keeps five `uint64_t bits[64]` arrays (mob, zombie, cow, skeleton,
// arrow) and *reads them back* in has_mob_at and can_move_mob, so they are
// state, not a cache, and the parity dump carries them.
//
// JS has no uint64 in a typed array that arithmetic can touch cheaply, so
// each row is two uint32 words in a Uint32Array of length 128: word 2*r is
// bits 0..31 of row r, word 2*r+1 is bits 32..63. That is also the order the
// canonical dump writes them in, so the serializer copies straight through.
//
// Column indices are 0..63 and always in range here — the callers check
// in_bounds first, exactly as the C does.

const U64BITS_ROWS = 64;
const U64BITS_WORDS = U64BITS_ROWS * 2;

function mbSet(bits, r, c) {
  bits[2 * r + (c >>> 5)] |= (1 << (c & 31));
}

function mbClear(bits, r, c) {
  bits[2 * r + (c >>> 5)] &= ~(1 << (c & 31));
}

function mbGet(bits, r, c) {
  return (bits[2 * r + (c >>> 5)] >>> (c & 31)) & 1;
}

// ---- ../../common/parity.js ----
// parity.js — the canonical state serializer and its hash.
//
// Writes exactly the bytes `cc_ref_driver.c`'s cc_serialize writes: the Env
// fields PLAN 1.1 calls state, in declaration order, fixed width, no padding,
// little-endian, with the step's reward appended. `cc_ref layout` prints the
// table; tests/test_layout.py checks this file against it field by field.
//
// The game state lives in one ArrayBuffer (see src/20_state.js), and most of
// it is already in canonical order and width, but not all — so this walks the
// fields explicitly rather than memcpy-ing the buffer. Explicit is what makes
// the C and JS sides diffable side by side, which is the whole point.

// A little-endian byte writer over a fixed-size Uint8Array.
class ParityWriter {
  constructor(size) {
    this.bytes = new Uint8Array(size);
    this.n = 0;
    this._f32 = new Float32Array(1);
    this._u32 = new Uint32Array(this._f32.buffer);
  }

  u8(v) {
    this.bytes[this.n++] = v & 0xff;
  }

  i8(v) {
    this.bytes[this.n++] = v & 0xff;
  }

  u16(v) {
    this.bytes[this.n++] = v & 0xff;
    this.bytes[this.n++] = (v >>> 8) & 0xff;
  }

  i16(v) {
    this.u16(v & 0xffff);
  }

  u32(v) {
    this.bytes[this.n++] = v & 0xff;
    this.bytes[this.n++] = (v >>> 8) & 0xff;
    this.bytes[this.n++] = (v >>> 16) & 0xff;
    this.bytes[this.n++] = (v >>> 24) & 0xff;
  }

  i32(v) {
    this.u32(v >>> 0);
  }

  f32(v) {
    this._f32[0] = v;
    this.u32(this._u32[0]);
  }

  // A uint64 as the C writes it: low word first.
  u64(hi, lo) {
    this.u32(lo);
    this.u32(hi);
  }

  bytesFrom(arr) {
    for (let i = 0; i < arr.length; i++) this.bytes[this.n++] = arr[i] & 0xff;
  }

  // The uint32-pair bitmaps of u64bits.js are already in canonical order.
  words(arr) {
    for (let i = 0; i < arr.length; i++) this.u32(arr[i]);
  }
}

// FNV-1a 64 over bytes, as two uint32 words so there is no BigInt.
//
//   h = 14695981039346656037
//   for each byte: h ^= byte; h *= 1099511628211
//
// The prime is 0x00000100000001B3. Multiplying (hi, lo) by it in 16-bit limbs
// keeps every intermediate exact in a double.
const FNV64_OFFSET_HI = 0xcbf29ce4;
const FNV64_OFFSET_LO = 0x84222325;
const FNV64_PRIME_HI = 0x00000100;
const FNV64_PRIME_LO = 0x000001b3;

function fnv1a64(bytes) {
  let hi = FNV64_OFFSET_HI;
  let lo = FNV64_OFFSET_LO;
  for (let i = 0; i < bytes.length; i++) {
    lo = (lo ^ bytes[i]) >>> 0;
    // (hi, lo) * prime, low 64 bits.
    const al = lo & 0xffff;
    const ah = lo >>> 16;
    const bl = FNV64_PRIME_LO & 0xffff;
    const bh = FNV64_PRIME_LO >>> 16;
    const ll = al * bl;
    const lh = al * bh;
    const hl = ah * bl;
    const hh = ah * bh;
    const mid = (ll >>> 16) + (lh & 0xffff) + (hl & 0xffff);
    const newLo = (((mid & 0xffff) << 16) | (ll & 0xffff)) >>> 0;
    const carry = (hh + (lh >>> 16) + (hl >>> 16) + (mid >>> 16)) >>> 0;
    hi = (carry + Math.imul(lo, FNV64_PRIME_HI) + Math.imul(hi, FNV64_PRIME_LO)) >>> 0;
    lo = newLo;
  }
  return { hi: hi >>> 0, lo: lo >>> 0 };
}

// Lower-case hex, high word first, matching how the driver's chains print.
function fnv1a64Hex(bytes) {
  const h = fnv1a64(bytes);
  return h.hi.toString(16).padStart(8, '0') + h.lo.toString(16).padStart(8, '0');
}

// ---- src/00_header.js ----
// Craftax-Classic — a bit-exact port of PufferLib's craftax_classic.h.
//
// GENERATED BUNDLE WARNING: if you are reading this inside
// dist/craftax_classic.js, do not edit it. Edit the files under src/ and
// common/ and re-run `just bundle craftax_classic`.
//
// Parity: full canonical state, every step, against PufferLib
// ocean/craftax_classic/craftax_classic.h at commit 6ffa5b10, built scalar,
// no FMA, with cosf/sinf bound to V8's ieee754. What is NOT matched:
// PufferLib's auto-reset RNG continuation across episodes. The pixels are
// Craftax-Classic-Pixels', byte-identical given Craftax's night key — which
// no host supplies, so the hosts' night frames omit Craftax's static. See
// README.md and manifest.json.
//
// conforms-to: GAME_TEMPLATE.md

// ---- src/10_constants.js ----
// 10_constants.js — the C's constants, mirrored.
//
// Every name here is the craftax_classic.h name with the same value. They are
// duplicated rather than derived because a wrong constant is a divergence,
// and the layout gate plus G1/G2 are what catch one.

const MAP_SIZE = 64;
const MAP_PACKED_ROW = MAP_SIZE;
const MAP_PACKED_SIZE = MAP_SIZE * MAP_PACKED_ROW;

const MAX_ZOMBIES = 3;
const MAX_COWS = 3;
const MAX_SKELETONS = 2;
const MAX_ARROWS = 3;
const MAX_PLANTS = 10;
const NUM_ACHIEVEMENTS = 22;
const NUM_ACTIONS = 17;
const NUM_BLOCK_TYPES = 17;
const NUM_INVENTORY = 12;
const OBS_DIM = 1345;
const MAX_TIMESTEPS = 10000;
const DAY_LENGTH = 300;
const MOB_DESPAWN_DIST = 14;

// Block types. 17 of them, so one per byte: a nibble holds 0..15 and would
// turn every BLK_RIPE_PLANT into BLK_INVALID, which is the bug the C's own
// comment at MAP_PACKED_ROW records.
const BLK_INVALID = 0;
const BLK_OUT_OF_BOUNDS = 1;
const BLK_GRASS = 2;
const BLK_WATER = 3;
const BLK_STONE = 4;
const BLK_TREE = 5;
const BLK_WOOD = 6;
const BLK_PATH = 7;
const BLK_COAL = 8;
const BLK_IRON = 9;
const BLK_DIAMOND = 10;
const BLK_TABLE = 11;
const BLK_FURNACE = 12;
const BLK_SAND = 13;
const BLK_LAVA = 14;
const BLK_PLANT = 15;
const BLK_RIPE_PLANT = 16;

// Actions. These indices are also the sidecar's action indices, so an action
// file is valid for the C and the JS with no mapping.
const ACT_NOOP = 0;
const ACT_LEFT = 1;
const ACT_RIGHT = 2;
const ACT_UP = 3;
const ACT_DOWN = 4;
const ACT_DO = 5;
const ACT_SLEEP = 6;
const ACT_PLACE_STONE = 7;
const ACT_PLACE_TABLE = 8;
const ACT_PLACE_FURNACE = 9;
const ACT_PLACE_PLANT = 10;
const ACT_MAKE_WOOD_PICK = 11;
const ACT_MAKE_STONE_PICK = 12;
const ACT_MAKE_IRON_PICK = 13;
const ACT_MAKE_WOOD_SWORD = 14;
const ACT_MAKE_STONE_SWORD = 15;
const ACT_MAKE_IRON_SWORD = 16;

// Achievements, indices into the achievements array.
const ACH_COLLECT_WOOD = 0;
const ACH_PLACE_TABLE = 1;
const ACH_EAT_COW = 2;
const ACH_COLLECT_SAPLING = 3;
const ACH_COLLECT_DRINK = 4;
const ACH_MAKE_WOOD_PICK = 5;
const ACH_MAKE_WOOD_SWORD = 6;
const ACH_PLACE_PLANT = 7;
const ACH_DEFEAT_ZOMBIE = 8;
const ACH_COLLECT_STONE = 9;
const ACH_PLACE_STONE = 10;
const ACH_EAT_PLANT = 11;
const ACH_DEFEAT_SKELETON = 12;
const ACH_MAKE_STONE_PICK = 13;
const ACH_MAKE_STONE_SWORD = 14;
const ACH_WAKE_UP = 15;
const ACH_PLACE_FURNACE = 16;
const ACH_COLLECT_COAL = 17;
const ACH_COLLECT_IRON = 18;
const ACH_COLLECT_DIAMOND = 19;
const ACH_MAKE_IRON_PICK = 20;
const ACH_MAKE_IRON_SWORD = 21;

const ACH_NAMES = [
  'collect_wood', 'place_table', 'eat_cow', 'collect_sapling',
  'collect_drink', 'make_wood_pick', 'make_wood_sword', 'place_plant',
  'defeat_zombie', 'collect_stone', 'place_stone', 'eat_plant',
  'defeat_skeleton', 'make_stone_pick', 'make_stone_sword', 'wake_up',
  'place_furnace', 'collect_coal', 'collect_iron', 'collect_diamond',
  'make_iron_pick', 'make_iron_sword',
];

// Inventory slots, in the C's order.
const INV_WOOD = 0;
const INV_STONE = 1;
const INV_COAL = 2;
const INV_IRON = 3;
const INV_DIAMOND = 4;
const INV_SAPLING = 5;
const INV_WPICK = 6;
const INV_SPICK = 7;
const INV_IPICK = 8;
const INV_WSWORD = 9;
const INV_SSWORD = 10;
const INV_ISWORD = 11;

// Direction tables. Index by player_dir, which is 1..4; slot 0 is the C's
// unused padding entry and must stay, because player_dir is read straight
// into these arrays.
const DIR_DR = [0, 0, 0, -1, 1];
const DIR_DC = [0, -1, 1, 0, 0];

// ---- src/15_atlas.js ----
// 15_atlas.js — GENERATED by tools/craftax_atlas.py. DO NOT EDIT.
//
// Craftax's own textures, baked to 7x7 RGBA and base64'd so the bundle
// stays one flat script with no assets to load at runtime.
//
// The 7x7 size is not a choice: Craftax renders the agent view at
// BLOCK_PIXEL_SIZE_AGENT = 7, resizing each 16x16 asset with PIL NEAREST.
// That resize is done at bake time, by the same rule, so the runtime blit is
// 1:1 and needs no resampling — see tools/craftax_atlas.py for why blitting
// 16x16 down to 7x7 at runtime would give a different image.
//
// Source: github.com/MichaelTMatthews/Craftax, MIT, vendored at
// games/craftax_assets/ (see its README for the pinned commit).

const ATLAS_TILE = 7;
const ATLAS_COUNT = 29;
const ATLAS_STRIDE = ATLAS_TILE * ATLAS_TILE * 4;

// Sprite index by name; multiply by ATLAS_STRIDE for the byte offset.
const ATLAS = {
  block_0: 0,
  block_1: 1,
  block_2: 2,
  block_3: 3,
  block_4: 4,
  block_5: 5,
  block_6: 6,
  block_7: 7,
  block_8: 8,
  block_9: 9,
  block_10: 10,
  block_11: 11,
  block_12: 12,
  block_13: 13,
  block_14: 14,
  block_15: 15,
  block_16: 16,
  player_left: 17,
  player_right: 18,
  player_up: 19,
  player_down: 20,
  player_sleep: 21,
  zombie: 22,
  cow: 23,
  skeleton: 24,
  arrow_up: 25,
  arrow_down: 26,
  arrow_left: 27,
  arrow_right: 28,
};

const ATLAS_B64 =
  '/wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD/' +
  '//8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A' +
  '////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD//4CAgP+AgID/gICA/4CAgP+AgID/gICA/4CAgP+A' +
  'gID/gICA/4CAgP+AgID/gICA/4CAgP+AgID/gICA/4CAgP+AgID/gICA/4CAgP+AgID/gICA/4CAgP+AgID/gICA/4CAgP+AgID/' +
  'gICA/4CAgP+AgID/gICA/4CAgP+AgID/gICA/4CAgP+AgID/gICA/4CAgP+AgID/gICA/4CAgP+AgID/gICA/4CAgP+AgID/gICA' +
  '/4CAgP+AgID/gICA/4CAgP8bvAD/E58S/xOfEv8TnxL/FYYC/xOfEv8TnxL/G7wA/xOfEv8TnxL/FYYC/xWGAv8bvAD/E58S/xu8' +
  'AP8TnxL/E58S/xWGAv8bvAD/G7wA/xOfEv8TnxL/E58S/xOfEv8VhgL/G7wA/xWGAv8TnxL/E58S/xWGAv8TnxL/E58S/xOfEv8V' +
  'hgL/G7wA/xOfEv8VhgL/G7wA/xu8AP8TnxL/FYYC/xu8AP8TnxL/FYYC/xu8AP8bvAD/E58S/xWGAv8TnxL/QY7m/0GO5v8KSI//' +
  'QY7m/wBRrP8AUaz/AFGs/y17v/8te7//LXu//0GO5v8KSI//QY7m/0GO5v9Bjub/CkiP/0GO5v8te7//LXu//0GO5v9Bjub/LXu/' +
  '/y17v/9Bjub/QY7m/wBRrP8te7//CkiP/0GO5v8ZZb3/LXu//y17v/8te7//QY7m/wBRrP9Bjub/QY7m/0GO5v8AUaz/GWW9/0GO' +
  '5v9Bjub/AFGs/0GO5v8te7//QY7m/0GO5v8te7//QY7m/25ubv9/f3//j4+P/4iIiP+BgYH/eHh4/3h4eP+EhIT/hISE/3h4eP9v' +
  'b2//jo6O/3R0dP+BgYH/mZmZ/3d3d/+Pj4//eHh4/3d3d/+Hh4f/jo6O/3d3d/+IiIj/b29v/2FhYf93d3f/eHh4/2pqav9iYmL/' +
  'jo6O/5WVlf94eHj/d3d3/46Ojv+VlZX/fHx8/5mZmf94eHj/eHh4/4aGhv+BgYH/eXl5/46Ojv97e3v/eXl5/4eHh/9mZmb/jo6O' +
  '/29vb/8TnxL/AFsA/wBbAP8BOgH/AFsA/wE6Af8TnxL/AFsA/wAyAP9HLRr/AFsA/xp6Gv8BOgH/Gnoa/0ctGv8BOgH/kWZE/0ct' +
  'Gv9zVDr/mHZY/wBbAP9zVDr/mHZY/wE6Af9zVDr/AToB/2VDKf8BOgH/E58S/xWGAv8TnxL/c1Q6/xKbEf8HTAH/DHMA/xOfEv8V' +
  'hgL/G7wA/3NUOv8GWwb/B0wB/wtsAP8TnxL/FYYC/3NUOv9HLRr/UTMb/wdMAf8TnxL/j3NA/6OIVf9zXDH/j3NA/49zQP+jiFX/' +
  'c1wx/49zQP+jiFX/c1wx/49zQP+Pc0D/o4hV/3NcMf+Pc0D/o4hV/3NcMf+Pc0D/j3NA/6OIVf9zXDH/j3NA/6OIVf9zXDH/j3NA' +
  '/49zQP+jiFX/c1wx/49zQP+jiFX/c1wx/49zQP+Pc0D/o4hV/3NcMf+Pc0D/o4hV/3NcMf+Pc0D/j3NA/6OIVf9zXDH/j3NA/6OI' +
  'Vf9zXDH/j3NA/49zQP+jiFX/c1wx/35nPP94ZTz/eGU8/3hlPP+EcE7/eGU8/4FtTP+FcE//hXBP/3hlPP+Cbk3/iXRS/4BsTP94' +
  'ZTz/jHdT/4FtTP+JdFL/hHBO/4FtTP+GcVD/iXRS/4FtTP+GcVD/gm5N/3lmRf+BbUz/gW1M/3hlPP94Zkj/cV49/3hlPP94ZTz/' +
  'eGU8/3FePf9+Zzz/gm5N/4x3U/9+Zzz/fmc8/4ZxUP+EcE7/gW1M/35qRP+Cbk3/hnBM/35nPP96aEn/f2tJ/3hlPP9TU1P/nZ2d' +
  '/8/Pz/8wMDD/U1NT/3x8fP+dnZ3/fHx8/3x8fP8wMDD/MDAw/3x8fP98fHz/U1NT/52dnf9TU1P/AAAA/wAAAP9TU1P/nZ2d/3x8' +
  'fP9TU1P/U1NT/3x8fP9TU1P/z8/P/zAwMP9TU1P/U1NT/zAwMP8wMDD/AAAA/1NTU/8AAAD/fHx8/3x8fP+dnZ3/MDAw/wAAAP98' +
  'fHz/U1NT/52dnf9TU1P/fHx8/52dnf98fHz/U1NT/3x8fP98fHz/U1NT/9u6nf+dnZ3/U1NT/5aWlv/bup3/nZ2d/5aWlv+5g1L/' +
  'llY6/3x8fP+WVjr/lUUi/5VFIv+dnZ3/U1NT/11dXf9dXV3/U1NT/5ZWOv98fHz/U1NT/5aWlv/bup3/uYNS/3x8fP98fHz/U1NT' +
  '/1NTU/98fHz/llY6/7mDUv9TU1P/lpaW/3x8fP98fHz/27qd/3x8fP98fHz/lpaW/7mDUv+dnZ3/U1NT/3x8fP+WVjr/XV1d/1NT' +
  'U/9dXV3/lpaW/1NTU/+dnZ3/nZ2d/1NTU/9TU1P/fHx8/52dnf98fHz/fHx8//////98fHz//////wD7//9TU1P/nZ2d/wD7//8A' +
  '+///fHx8/wD7//8AwsX/fHx8/1NTU/9TU1P/fHx8/1NTU/+dnZ3/fHx8/1NTU/9TU1P/fHx8/wD7//8A+///APv//wDCxf98fHz/' +
  'fHx8/52dnf8A+///AMLF/3x8fP9TU1P/nZ2d/1NTU/98fHz/nZ2d/3x8fP9TU1P/fHx8/3x8fP+jiFX/c1wx/49zQP+jiFX/ZGVm' +
  '/3NcMf+Pc0D/clMb/3JTG/9yUxv/UzoN/2RlZv9zXDH/j3NA/6OIVf9zXDH/j3NA/6OIVf+jiFX/c1wx/49zQP+jiFX/c1wx/49z' +
  'QP+jiFX/o4hV/xRAmf8bUb3/o4hV/3NcMf+Pc0D/lpaW/5aWlv8bUb3/j3NA/6OIVf+pqan/lpaW/2RlZv+Pc0D/c1wx/49zQP+j' +
  'iFX/c1wx/49zQP+jiFX/j3NA/3NcMf+Pc0D/RERE/11dXf9ERET/XV1d/5CQkP8tLS3/RERE/11dXf8tLS3/LS0t/y0tLf9dXV3/' +
  'kJCQ/11dXf+QkJD/XV1d/wAAAP8AAAD/AAAA/11dXf+QkJD/XV1d/0RERP8AAAD//5FE/wAAAP95eXn/XV1d/11dXf8tLS3/zWMX' +
  '/9s5D//bOQ//eXl5/11dXf+QkJD/RERE/81jF//bOQ///5FE/3l5ef+QkJD/XV1d/y0tLf89PT3/PT09/yMjI/9ERET/XV1d/9HB' +
  'd//bzIf/28yH/9vMh//bzIf/0cF3/9HBd//RwXf/wK9h/9vMh//RwXf/28yH/9vMh//RwXf/28yH/9vMh//RwXf/wK9h/9HBd//b' +
  'zIf/28yH/9vMh//RwXf/28yH/9HBd//bzIf/0cF3/9HBd//bzIf/28yH/9HBd//RwXf/28yH/9HBd//bzIf/0cF3/9vMh//bzIf/' +
  '28yH/9HBd//RwXf/28yH/9vMh//RwXf/0cF3/9HBd//RwXf/0cF3/9HBd///VwD//69U//+mAP//VwD//69U//96AP//pgD//69U' +
  '/9ZDA//WQwP//1cA//96AP//VwD//1cA//+mAP//egD//5FU//+mAP//pgD//1cA//+mAP/WQwP//1cA/9ZDA///kVT//6YA//9X' +
  'AP//VwD//1cA/9ZDA///egD//1cA//96AP//VwD//6YA//9XAP//egD//6YA//+mAP/WQwP//3oA/9ZDA//WQwP//6YA//9XAP//' +
  'VwD//6YA//9XAP//kVT/G7wA/xOfEv8TnxL/E58S/xWGAv8TnxL/E58S/xRfFP8ARwD/AEcA/xWGAv8UXxT/AEcA/wBHAP8ARwD/' +
  'E58S/xRfFP8ARwD/E4MA/xODAP8BagD/E58S/xRfFP8UXxT/AEcA/xu8AP8PXgH/DW8N/xOfEv8VhgL/E58S/wBHAP8Nbw3/FYYC' +
  '/xODAP8TnxL/FYYC/xu8AP8ARwD/DW8N/xWGAv8bvAD/E58S/xWGAv8bvAD/AEcA/xOfEv8VhgL/E58S/xu8AP8TnxL/E58S/xOf' +
  'Ev8VhgL/E58S/xOfEv8UXxT/AEcA/wBHAP8VhgL/FF8U/wBHAP8ARwD/AEcA/xOfEv8UXxT/AEcA/xODAP8TgwD/AWoA/xOfEv8U' +
  'XxT/FF8U/wBHAP/NZj7/D14B/w1vDf8TnxL/vDQA/7w0AP8ARwD/lSkA/w9eAf8TgwD/E58S/5UpAP8TgwD/AEcA/w1vDf8VhgL/' +
  'G7wA/xOfEv8VhgL/G7wA/wBHAP8TnxL/FYYC/xOfEv8AAAAAAAAAAAAAAADfp3D/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA36dw' +
  '/wAAAAAAAAAAAAAAAAAAAAD//wD/HJ+w/xyfsP8cn7D/FnB8/wAAAAD//wD///8A/3/O2P8cn7D/FnB8/3/O2P8AAAAAAAAAAP//' +
  'AP/GqZX/kmZH/2dHMf/y2L7/AAAAgAAAAAAAAAAAxqmV/wAAAABnRzH/AAAAgAAAAAAAAAAAAAAAAMaplf8AAACAZ0cx/wAAAIAA' +
  'AACAAAAAAAAAAAAAAAAA36dw/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAN+ncP8AAAAAAAAAAAAAAAAAAAAAf87Y/xyfsP8cn7D/' +
  'HJ+w////AP8AAAAAAAAAABZwfP9/ztj/HJ+w/xZwfP///wD///8A/wAAAADfp3D/xqmV/5JmR/9nRzH///8A/wAAAIAAAAAAAAAA' +
  'AMaplf8AAAAAZ0cx/wAAAIAAAAAAAAAAAAAAAADGqZX/AAAAgGdHMf8AAACAAAAAgAAAAAAAAAAAAAAAAP//AP8AAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAP//AP///wD///8A/wAAAAAAAAAAAAAAAH/O2P8cn7D/HJ+w/xyfsP8WcHz/AAAAAAAAAAAWcHz/f87Y/xyfsP8W' +
  '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';

// Inventory icons, 5x5 (int(0.8 * 7)). Drawn with a hard overwrite,
// so alpha is already resolved into the bytes here.
const ICON_TILE = 5;
const ICON_STRIDE = ICON_TILE * ICON_TILE * 4;
const ICONS = {
  health: 0,
  food: 1,
  drink: 2,
  energy: 3,
  inv_sapling: 4,
  inv_wood: 5,
  inv_stone: 6,
  inv_coal: 7,
  inv_iron: 8,
  inv_diamond: 9,
  inv_wpick: 10,
  inv_spick: 11,
  inv_ipick: 12,
  inv_wsword: 13,
  inv_ssword: 14,
  inv_isword: 15,
};
const ICONS_B64 =
  'AAAA//3c3P8AAAD/+szM/wAAAP/9wsL//Z6e//uYmP/2gID/0UtL//p4eP/7Pz//+C0t/94gIP+lEBD/AAAA/+4ZGf/iCQn/uAcH' +
  '/wAAAP8AAAD/AAAA/7gCAv8AAAD/AAAA/wAAAP8AAAD/onFP/6x5V/+xf13/AAAA/wAAAP97VTv/hFs//6RzUP8AAAD/OSMS/1Q1' +
  'HP9ZOiP/AAAA///////T09P/PSYS/wAAAP8AAAD/srKy//////8AAAD/AAAA/wAAAP8AAAD/AAAA/6ez5f8AAAD/AAAA/wAAAP8A' +
  'AAD/hpjb/wAAAP8AAAD/AAAA/6u35/9EbdP/FFO7/wAAAP8AAAD/e5Da/yBbyP8FR6b/AAAA/wAAAP9FZr3/CUWh/wE0f/8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/Oqs3/wAAAP8AAAD/AAAA/wAAAP8NfQ7/DYoP/wxvDf8AAAD/AAAA/wAAAP8XiBX/AAAA' +
  '/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/xOfEv8AAAD/G7wA/wAAAP8AAAD/AAAA/wAA' +
  'AP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP+Pc0D/j3NA/3NcMf9zXDH/c1wx/49zQP+P' +
  'c0D/c1wx/3NcMf9zXDH/j3NA/49zQP9zXDH/c1wx/3NcMf+Pc0D/j3NA/3NcMf9zXDH/c1wx/49zQP+Pc0D/c1wx/3NcMf9zXDH/' +
  'bm5u/3x8fP9hYWH/g4OD/3h4eP+Pj4//hISE/2ZmZv+Pj4//gYGB/5WVlf9vb2//d3d3/5WVlf9qamr/g4OD/4GBgf94eHj/fHx8' +
  '/4mJif+Ojo7/nZ2d/5KSkv+Ojo7/b29v/1NTU/98fHz/U1NT/52dnf+dnZ3/nZ2d/zAwMP8AAAD/nZ2d/1NTU/98fHz/z8/P/1NT' +
  'U/8wMDD/U1NT/52dnf8wMDD/AAAA/3x8fP+dnZ3/U1NT/52dnf+dnZ3/fHx8/3x8fP9TU1P/uYNS/1NTU//bup3/nZ2d/52dnf+W' +
  'Vjr/U1NT/7mDUv9TU1P/fHx8/3x8fP+5g1L/fHx8/1NTU/+dnZ3/lpaW/5ZWOv+Wlpb/nZ2d/1NTU/+WVjr/nZ2d/3x8fP+Wlpb/' +
  'U1NT/3x8fP9TU1P/nZ2d/52dnf+dnZ3/APv//1NTU/8A+///U1NT/3x8fP98fHz/U1NT/wD7//9TU1P/nZ2d/wD7//98fHz/AMLF' +
  '/52dnf9TU1P/nZ2d/52dnf98fHz/fHx8/wAAAP8AAAD/o4hV/wAAAP8AAAD/AAAA/wAAAP8AAAD/j3NA/wAAAP8AAAD/AAAA/3Nc' +
  'Mf8AAAD/o4hV/wAAAP+Pc0D/AAAA/wAAAP8AAAD/j3NA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/5WVlf8AAAD/AAAA/wAAAP8A' +
  'AAD/AAAA/3h4eP8AAAD/AAAA/wAAAP9zXDH/AAAA/5WVlf8AAAD/j3NA/wAAAP8AAAD/AAAA/49zQP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP/s7Oz/AAAA/wAAAP8AAAD/AAAA/wAAAP/Dw8P/AAAA/wAAAP8AAAD/c1wx/wAAAP/s7Oz/AAAA/49zQP8AAAD/AAAA' +
  '/wAAAP+Pc0D/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP+Pc0D/AAAA/wAAAP8AAAD/j3NA/wAAAP8AAAD/j3NA/49z' +
  'QP8AAAD/AAAA/wAAAP+Pc0D/j3NA/wAAAP8AAAD/j3NA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/eHh4/wAAAP8A' +
  'AAD/AAAA/3h4eP8AAAD/AAAA/3h4eP94eHj/AAAA/wAAAP8AAAD/j3NA/3h4eP8AAAD/AAAA/3h4eP8AAAD/AAAA/wAAAP8AAAD/' +
  'AAAA/wAAAP8AAAD/AAAA/8PDw/8AAAD/AAAA/wAAAP/Dw8P/AAAA/wAAAP/Dw8P/w8PD/wAAAP8AAAD/AAAA/49zQP/Dw8P/AAAA' +
  '/wAAAP/Dw8P/AAAA/wAAAP8AAAD/AAAA/w==';

// Count digits, 4x4 (int(0.6 * 7)), index 0 = digit 1. Drawn as a
// stencil: alpha is 0 or 255 and never blended.
const DIGIT_TILE = 4;
const DIGIT_STRIDE = DIGIT_TILE * DIGIT_TILE * 4;
const DIGITS_B64 =
  '35mNAP//////////0nJlAP///wD///8A/////8w+PgDDbk4A9CUlAP////+dWjMAlHlJAP///////////////wAAAAD/////////' +
  '//////8AAAAAAAAAAP//////////AAAAAP//////////AAAAAAAAAAD///////////////8AAAAA////////////////AAAAAAAA' +
  'AAD//////////wAAAAAAAAAA//////////8AAAAA/////////////////////////wAAAAAAAAAAAP////8AAAAA/////wAAAAD/' +
  '////////////////////AAAAAAAAAAD/////AAAAAAAAAAD///////////////8AAAAA//////////8AAAAAAAAAAAAAAAAAAAAA' +
  '/////wAAAAD//////////wAAAAAAAAAA////////////////AAAAAP//////////AAAAAAAAAAD/////AAAAAP////8AAAAA////' +
  '//////8AAAAAAAAAAP///////////////wAAAAAAAAAA//////////8AAAAAAAAAAP////8AAAAAAAAAAP////8AAAAAAAAAAAAA' +
  'AAD/////////AP////////8A////////////////////AP////////8A/////wAAAAD///////////////8AAAAA////////////' +
  '////AAAAAP////8AAAAA/////wAAAAAAAAAA//////////8AAAAA//////////8AAAAA';

// Craftax's night_noise_intensity_texture: 49 rows x 63 cols of
// float32, little-endian, row-major. A radial falloff that scales the night
// static toward the edges of the view. Baked rather than computed because
// Math.exp is not the same function in every engine — see the tool.
const NIGHT_NOISE_ROWS = 49;
const NIGHT_NOISE_COLS = 63;
const NIGHT_NOISE_B64 =
  'q097PzCtej8k+3k/Ejl5P6xmeD/Sg3c/lpB2P0WNdT9renQ/1lhzP5kpcj8P7nA/36dvP/NYbj9+A20/86lrPwFPaj+K9Wg/nKBn' +
  'P2NTZj8gEWU/G91jP5W6Yj+4rGE/jLZgP+TaXz9VHF8/JH1ePz//XT8ypF0/G21dP6taXT8bbV0/MqRdPz//XT8kfV4/VRxfP+Ta' +
  'Xz+MtmA/uKxhP5W6Yj8b3WM/IBFlP2NTZj+coGc/ivVoPwFPaj/zqWs/fgNtP/NYbj/fp28/D+5wP5kpcj/WWHM/a3p0P0WNdT+W' +
  'kHY/0oN3P6xmeD8SOXk/JPt5PzCtej+rT3s/43p6P5y7eT8A6ng/hwV4P9UNdz/EAnY/auR0PyKzcz+Pb3I/pRpxP6a1bz8uQm4/' +
  'K8JsP+A3az/kpWk/GQ9oP6Z2Zj/y32Q/lE5jP0nGYT/mSmA/SOBeP0GKXT+PTFw/vypbPycoWj/QR1k/Z4xYPzL4Vz8AjVc/JkxX' +
  'P3A2Vz8mTFc/AI1XPzL4Vz9njFg/0EdZPycoWj+/Kls/j0xcP0GKXT9I4F4/5kpgP0nGYT+UTmM/8t9kP6Z2Zj8ZD2g/5KVpP+A3' +
  'az8rwmw/LkJuP6a1bz+lGnE/j29yPyKzcz9q5HQ/xAJ2P9UNdz+HBXg/AOp4P5y7eT/jeno/6It5P0aseD84t3c/HKx2P4aKdT9K' +
  'UnQ/gwNzP5qecT9OJHA/vJVuP170bD8TQms/HoFpPyW0Zz8u3mU/lgJkPxAlYj+USWA/VXReP7KpXD8m7lo/NEZZP1a2Vz/pQlY/' +
  'FvBUP8PBUz97u1I/YOBRPxozUT/ItVA/9WlQP5RQUD/1aVA/yLVQPxozUT9g4FE/e7tSP8PBUz8W8FQ/6UJWP1a2Vz80Rlk/Ju5a' +
  'P7KpXD9VdF4/lElgPxAlYj+WAmQ/Lt5lPyW0Zz8egWk/E0JrP170bD+8lW4/TiRwP5qecT+DA3M/SlJ0P4aKdT8crHY/OLd3P0as' +
  'eD/oi3k/34F4Pzt+dz+3YXY/mCt1P2Dbcz/dcHI/LexwP8tNbz+Vlm0/1MdrP0HjaT8H62c/x+FlP5TKYz/uqGE/woBfP1dWXT9K' +
  'Lls/ew1ZP/74Vj8F9lQ/zglTP405UT9Qik8/7gBOP+yhTD9ocUs/BnNKP9ipST9YGEk/UMBIP9miSD9QwEg/WBhJP9ipST8Gc0o/' +
  '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' +
  'aYwtPyElKT/v4iQ/69AgPxf6HD8paRk/XigWP0lBEz+hvBA/GKIOPzT4DD8txAs/0AkLP2/LCj/QCQs/LcQLPzT4DD8Yog4/obwQ' +
  'P0lBEz9eKBY/KWkZPxf6HD/r0CA/7+IkPyElKT9pjC0/xQ0yP3aeNj8qNDs/HsU/Pz9IRD9FtUg/wgRNPzMwUT8MMlU/sgVZP4Kn' +
  'XD/BFGA/m0tjPwtLZj/QEmk/WKNrP6r9bT9TI3A/tcFxPyTUbz9Jt20/wWlrP57qaD9/OWY/nlZjP+RCYD/3/1w/SZBZPyD3VT+d' +
  'OFI/vFlOP1ZgSj8VU0Y/azlCP34bPj8QAjo/Z/Y1PykCMj83Ly4/iYcqPwEVJz884SM/bvUgPy1aHj9OFxw/ujMaP0y1GD+0oBc/' +
  'XPkWP1jBFj9c+RY/tKAXP0y1GD+6Mxo/ThccPy1aHj9u9SA/POEjPwEVJz+Jhyo/Ny8uPykCMj9n9jU/EAI6P34bPj9rOUI/FVNG' +
  'P1ZgSj+8WU4/nThSPyD3VT9JkFk/9/9cP+RCYD+eVmM/fzlmP57qaD/BaWs/SbdtPyTUbz+1wXE/d0xzP1WUcT8Ism8/U6RtP2Jq' +
  'az/eA2k/+3BmP4iyYz8AymA/j7ldPyCEWj9iLVc/x7lTP4YuUD+RkUw/i+lIP7c9RT/nlUE/Xfo9P7VzOj+/Cjc/XsgzP2G1MD9d' +
  '2i0/hD8rP4DsKD9M6CY/EzklPwzkIz9m7SI/LFgiPzkmIj8sWCI/Zu0iPwzkIz8TOSU/TOgmP4DsKD+EPys/XdotP2G1MD9eyDM/' +
  'vwo3P7VzOj9d+j0/55VBP7c9RT+L6Ug/kZFMP4YuUD/HuVM/Yi1XPyCEWj+PuV0/AMpgP4iyYz/7cGY/3gNpP2Jqaz9TpG0/CLJv' +
  'P1WUcT93THM/jcB0P8g6cz+sj3E/IL5vP2fFbT81pWs/uF1pP6jvZj9TXGQ/pqVhPzfOXj9I2Vs/y8pYP1ynVT9AdFI/VjdPPw/3' +
  'Sz9Vukg/eohFPx5pQj8NZD8/J4E8PznIOT/cQDc/UvI0P2XjMj9EGjE/Y5wvP2JuLj/2ky0/zw8tP5PjLD/PDy0/9pMtP2JuLj9j' +
  'nC8/RBoxP2XjMj9S8jQ/3EA3PznIOT8ngTw/DWQ/Px5pQj96iEU/VbpIPw/3Sz9WN08/QHRSP1ynVT/Lylg/SNlbPzfOXj+mpWE/' +
  'U1xkP6jvZj+4XWk/NaVrP2fFbT8gvm8/rI9xP8g6cz+NwHQ/tBt2P+3EdD9PTXM/47NxPwX4bz9vGW4/ShhsPzn1aT9isWc/dU5l' +
  'P7nOYj8NNWA/5oRdP1TCWj/58Vc//xhVPw89Uj8/ZE8//pRMPwHWST8kLkc/U6REP2s/Qj8aBkA/w/49P10vPD9YnTo/gU05P+pD' +
  'OD/Tgzc/mw83P7ToNj+bDzc/04M3P+pDOD+BTTk/WJ06P10vPD/D/j0/GgZAP2s/Qj9TpEQ/JC5HPwHWST/+lEw/P2RPPw89Uj//' +
  'GFU/+fFXP1TCWj/mhF0/DTVgP7nOYj91TmU/YrFnPzn1aT9KGGw/bxluPwX4bz/js3E/T01zP+3EdD+0G3Y/alx3Pwwxdj8B6XQ/' +
  'b4NzP8f/cT/OXXA/p51uP9+/bD93xWo/6a9oPzOBZj/VO2Q/1uJhP8B5Xz+gBF0/+YdaP7sIWD85jFU/EBhTPxuyUD9YYE4/1ChM' +
  'P4sRSj9VIEg/w1pGPw7GRD/zZkM/pUFCP7FZQT/tsUA/bkxAP3QqQD9uTEA/7bFAP7FZQT+lQUI/82ZDPw7GRD/DWkY/VSBIP4sR' +
  'Sj/UKEw/WGBOPxuyUD8QGFM/OYxVP7sIWD/5h1o/oARdP8B5Xz/W4mE/1TtkPzOBZj/pr2g/d8VqP9+/bD+nnW4/zl1wP8f/cT9v' +
  'g3M/Ael0Pwwxdj9qXHc/34F4Pzt+dz+3YXY/mCt1P2Dbcz/dcHI/LexwP8tNbz+Vlm0/1MdrP0HjaT8H62c/x+FlP5TKYz/uqGE/' +
  'woBfP1dWXT9KLls/ew1ZP/74Vj8F9lQ/zglTP405UT9Qik8/7gBOP+yhTD9ocUs/BnNKP9ipST9YGEk/UMBIP9miSD9QwEg/WBhJ' +
  'P9ipST8Gc0o/aHFLP+yhTD/uAE4/UIpPP405UT/OCVM/BfZUP/74Vj97DVk/Si5bP1dWXT/CgF8/7qhhP5TKYz/H4WU/B+tnP0Hj' +
  'aT/Ux2s/lZZtP8tNbz8t7HA/3XByP2Dbcz+YK3U/t2F2Pzt+dz/fgXg/6It5P0aseD84t3c/HKx2P4aKdT9KUnQ/gwNzP5qecT9O' +
  'JHA/vJVuP170bD8TQms/HoFpPyW0Zz8u3mU/lgJkPxAlYj+USWA/VXReP7KpXD8m7lo/NEZZP1a2Vz/pQlY/FvBUP8PBUz97u1I/' +
  'YOBRPxozUT/ItVA/9WlQP5RQUD/1aVA/yLVQPxozUT9g4FE/e7tSP8PBUz8W8FQ/6UJWP1a2Vz80Rlk/Ju5aP7KpXD9VdF4/lElg' +
  'PxAlYj+WAmQ/Lt5lPyW0Zz8egWk/E0JrP170bD+8lW4/TiRwP5qecT+DA3M/SlJ0P4aKdT8crHY/OLd3P0aseD/oi3k/43p6P5y7' +
  'eT8A6ng/hwV4P9UNdz/EAnY/auR0PyKzcz+Pb3I/pRpxP6a1bz8uQm4/K8JsP+A3az/kpWk/GQ9oP6Z2Zj/y32Q/lE5jP0nGYT/m' +
  'SmA/SOBeP0GKXT+PTFw/vypbPycoWj/QR1k/Z4xYPzL4Vz8AjVc/JkxXP3A2Vz8mTFc/AI1XPzL4Vz9njFg/0EdZPycoWj+/Kls/' +
  'j0xcP0GKXT9I4F4/5kpgP0nGYT+UTmM/8t9kP6Z2Zj8ZD2g/5KVpP+A3az8rwmw/LkJuP6a1bz+lGnE/j29yPyKzcz9q5HQ/xAJ2' +
  'P9UNdz+HBXg/AOp4P5y7eT/jeno/q097PzCtej8k+3k/Ejl5P6xmeD/Sg3c/lpB2P0WNdT9renQ/1lhzP5kpcj8P7nA/36dvP/NY' +
  'bj9+A20/86lrPwFPaj+K9Wg/nKBnP2NTZj8gEWU/G91jP5W6Yj+4rGE/jLZgP+TaXz9VHF8/JH1ePz//XT8ypF0/G21dP6taXT8b' +
  'bV0/MqRdPz//XT8kfV4/VRxfP+TaXz+MtmA/uKxhP5W6Yj8b3WM/IBFlP2NTZj+coGc/ivVoPwFPaj/zqWs/fgNtP/NYbj/fp28/' +
  'D+5wP5kpcj/WWHM/a3p0P0WNdT+WkHY/0oN3P6xmeD8SOXk/JPt5PzCtej+rT3s/';

// ---- src/16_threefry.js ----
// 16_threefry.js — JAX's threefry-2x32 and jax.random.uniform, for the
// night static in 80_render.js.
//
// This is NOT the game's RNG. The dynamics use the PCG in common/rng_pcg32.js,
// which mirrors PufferLib's C. This file exists because Craftax draws its
// per-pixel night static with `jax.random.uniform(state.state_rng, (49, 63))`,
// and reproducing that frame means reproducing JAX's generator bit for bit,
// given the same key. It is stateless: same key, same bits, every call.
//
// What is mirrored, from jax/_src/random/threefry2x32.py and core.py at
// jax 0.11.1 with `jax_threefry_partitionable=True` (the default since 0.5):
//
//   * the Threefry-2x32 block function, 20 rounds, rotations
//     [13, 15, 26, 6] / [17, 29, 16, 24], key schedule ks = [k0, k1,
//     k0 ^ k1 ^ 0x1BD11BDA], injected every 4 rounds with the round-group
//     index added to the second word (`_threefry2x32_lowering`);
//   * the PARTITIONABLE counter layout: element i of the output array is
//     hashed with the 64-bit counter i split as (hi, lo) uint32 words
//     (`iota_2x32_shape`), and the two output words are XORed together
//     (`_threefry_random_bits_partitionable`, bit_width 32). The older
//     layout — halves of a flat iota, outputs concatenated — gives different
//     bits and is not what the installed JAX runs;
//   * uniform: the top 23 random bits become the mantissa of a float32 with
//     exponent 0, i.e. `(bits >>> 9) | 0x3f800000`, bitcast to a float in
//     [1, 2), minus 1 (`_uniform`). With minval 0 and maxval 1 the trailing
//     `floats * (max - min) + min` and `max(min, ...)` are identities.
//
// Pure uint32 work: `>>> 0` after every add, no BigInt, so V8 and QuickJS
// agree. Arrays here are small (3087 elements) and hashed one at a time.

const THREEFRY_C240 = 0x1BD11BDA;

function _rotl32(x, r) {
  return ((x << r) | (x >>> (32 - r))) >>> 0;
}

// Scratch for the two output words, so the hot loop allocates nothing.
const _tfOut = new Uint32Array(2);

// Threefry-2x32 of counter (x0, x1) under key (k0, k1). Result in _tfOut.
function _threefry2x32(k0, k1, x0, x1) {
  const ks0 = k0 >>> 0, ks1 = k1 >>> 0;
  const ks2 = (ks0 ^ ks1 ^ THREEFRY_C240) >>> 0;
  let v0 = (x0 + ks0) >>> 0;
  let v1 = (x1 + ks1) >>> 0;

  // Four rounds with rotations R, then a key injection.
  // apply_round: v0 += v1; v1 = rotl(v1, r); v1 ^= v0.
  v0 = (v0 + v1) >>> 0; v1 = _rotl32(v1, 13); v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + v1) >>> 0; v1 = _rotl32(v1, 15); v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + v1) >>> 0; v1 = _rotl32(v1, 26); v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + v1) >>> 0; v1 = _rotl32(v1, 6);  v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + ks1) >>> 0; v1 = (v1 + ks2 + 1) >>> 0;

  v0 = (v0 + v1) >>> 0; v1 = _rotl32(v1, 17); v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + v1) >>> 0; v1 = _rotl32(v1, 29); v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + v1) >>> 0; v1 = _rotl32(v1, 16); v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + v1) >>> 0; v1 = _rotl32(v1, 24); v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + ks2) >>> 0; v1 = (v1 + ks0 + 2) >>> 0;

  v0 = (v0 + v1) >>> 0; v1 = _rotl32(v1, 13); v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + v1) >>> 0; v1 = _rotl32(v1, 15); v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + v1) >>> 0; v1 = _rotl32(v1, 26); v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + v1) >>> 0; v1 = _rotl32(v1, 6);  v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + ks0) >>> 0; v1 = (v1 + ks1 + 3) >>> 0;

  v0 = (v0 + v1) >>> 0; v1 = _rotl32(v1, 17); v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + v1) >>> 0; v1 = _rotl32(v1, 29); v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + v1) >>> 0; v1 = _rotl32(v1, 16); v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + v1) >>> 0; v1 = _rotl32(v1, 24); v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + ks1) >>> 0; v1 = (v1 + ks2 + 4) >>> 0;

  v0 = (v0 + v1) >>> 0; v1 = _rotl32(v1, 13); v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + v1) >>> 0; v1 = _rotl32(v1, 15); v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + v1) >>> 0; v1 = _rotl32(v1, 26); v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + v1) >>> 0; v1 = _rotl32(v1, 6);  v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + ks2) >>> 0; v1 = (v1 + ks0 + 5) >>> 0;

  _tfOut[0] = v0;
  _tfOut[1] = v1;
}

// jax.random.bits(key, (n,), uint32) under the partitionable layout: element
// i is threefry(key, hi(i), lo(i)) with the two words XORed. n < 2^32 here,
// so the high counter word is always 0.
function threefryRandomBits32(k0, k1, i) {
  _threefry2x32(k0, k1, 0, i >>> 0);
  return (_tfOut[0] ^ _tfOut[1]) >>> 0;
}

// jax.random.uniform(key, (n,)) as float32 in [0, 1), written into out[0..n).
// Row-major, so a (rows, cols) array's element (y, x) is out[y * cols + x].
function threefryUniformF32(k0, k1, n, out) {
  for (let i = 0; i < n; i++) {
    const bits = threefryRandomBits32(k0, k1, i);
    const fb = ((bits >>> 9) | 0x3f800000) >>> 0;
    out[i] = F(bitsToF32(fb) - 1);
  }
  return out;
}

// ---- src/20_state.js ----
// 20_state.js — the game state, in one ArrayBuffer.
//
// Mirrors `struct Env` (craftax_classic.h lines 162-230), restricted to the
// fields PLAN 1.1 calls state. The observation buffer, the log struct and the
// reward scratch are not state and are not here.
//
// Three things this buys, all of them about parity rather than speed:
//
//   Wrap semantics for free. `health -= 7` on an Int8Array wraps exactly like
//   C's int8_t, so the zombie-hits-a-sleeper case (-7, and the C does not
//   clamp health) needs no hand-written masking.
//
//   One place to serialise. getParityState() walks a single table, and
//   cc_ref_driver.c's cc_serialize walks the same table in the same order.
//
//   Reset is fill(0) plus what generate_world sets.
//
// STORAGE ORDER IS NOT DUMP ORDER. Typed-array views need their natural
// alignment, and the canonical dump is packed with no padding — it puts a
// float32 at offset 6674, which is not 4-aligned. So fields are stored
// grouped by width (4-byte, then 2-byte, then 1-byte) and the serializer
// reorders on the way out. PARITY_ORDER below is the dump order and is the
// one that has to match the C.

// --- storage layout -------------------------------------------------------
// [name, kind, count]. Kind picks both the view type and the C type it
// mirrors. Order within each width group is the struct's order.
const STATE_FIELDS_U32 = [
  ['pcg', 2],            // the 64-bit PCG state as two uint32 words, lo then hi
  ['mobBits', 128],      // 64 rows x 2 words; see common/u64bits.js
  ['zombieBits', 128],
  ['cowBits', 128],
  ['skelBits', 128],
  ['arrowBits', 128],
];
const STATE_FIELDS_F32 = [
  ['recover', 1], ['hunger', 1], ['thirst', 1], ['fatigue', 1],
  ['lightLevel', 1],
];
const STATE_FIELDS_I32 = [
  ['timestep', 1],
];
const STATE_FIELDS_I16 = [
  ['playerR', 1], ['playerC', 1],
  ['zombieR', MAX_ZOMBIES], ['zombieC', MAX_ZOMBIES],
  ['cowR', MAX_COWS], ['cowC', MAX_COWS],
  ['skelR', MAX_SKELETONS], ['skelC', MAX_SKELETONS],
  ['arrowR', MAX_ARROWS], ['arrowC', MAX_ARROWS],
  ['plantR', MAX_PLANTS], ['plantC', MAX_PLANTS], ['plantAge', MAX_PLANTS],
];
const STATE_FIELDS_I8 = [
  ['playerDir', 1],
  ['health', 1], ['food', 1], ['drink', 1], ['energy', 1],
  ['inv', NUM_INVENTORY],
  ['zombieHp', MAX_ZOMBIES], ['zombieCd', MAX_ZOMBIES],
  ['cowHp', MAX_COWS],
  ['skelHp', MAX_SKELETONS], ['skelCd', MAX_SKELETONS],
  ['arrowDr', MAX_ARROWS], ['arrowDc', MAX_ARROWS],
];
const STATE_FIELDS_U8 = [
  ['mapPacked', MAP_PACKED_SIZE],
  ['isSleeping', 1],
  ['zombieMask', MAX_ZOMBIES],
  ['cowMask', MAX_COWS],
  ['skelMask', MAX_SKELETONS],
  ['arrowMask', MAX_ARROWS],
  ['plantMask', MAX_PLANTS],
  ['achievements', NUM_ACHIEVEMENTS],
];

// The canonical dump: [canonicalName, jsName, kind]. This is struct
// declaration order, fixed width, no padding, little-endian, and it must
// match `cc_ref layout` exactly. 'u64pairs' means uint32 words that are
// already lo, hi per row and pass through unchanged.
const PARITY_ORDER = [
  ['pcg', 'pcg', 'u32'],
  ['map_packed', 'mapPacked', 'u8'],
  ['mob_bits', 'mobBits', 'u32'],
  ['zombie_bits', 'zombieBits', 'u32'],
  ['cow_bits', 'cowBits', 'u32'],
  ['skel_bits', 'skelBits', 'u32'],
  ['arrow_bits', 'arrowBits', 'u32'],
  ['player_r', 'playerR', 'i16'],
  ['player_c', 'playerC', 'i16'],
  ['player_dir', 'playerDir', 'i8'],
  ['health', 'health', 'i8'],
  ['food', 'food', 'i8'],
  ['drink', 'drink', 'i8'],
  ['energy', 'energy', 'i8'],
  ['is_sleeping', 'isSleeping', 'u8'],
  ['recover', 'recover', 'f32'],
  ['hunger', 'hunger', 'f32'],
  ['thirst', 'thirst', 'f32'],
  ['fatigue', 'fatigue', 'f32'],
  ['inv', 'inv', 'i8'],
  ['zombie_r', 'zombieR', 'i16'],
  ['zombie_c', 'zombieC', 'i16'],
  ['zombie_hp', 'zombieHp', 'i8'],
  ['zombie_cd', 'zombieCd', 'i8'],
  ['zombie_mask', 'zombieMask', 'u8'],
  ['cow_r', 'cowR', 'i16'],
  ['cow_c', 'cowC', 'i16'],
  ['cow_hp', 'cowHp', 'i8'],
  ['cow_mask', 'cowMask', 'u8'],
  ['skel_r', 'skelR', 'i16'],
  ['skel_c', 'skelC', 'i16'],
  ['skel_hp', 'skelHp', 'i8'],
  ['skel_cd', 'skelCd', 'i8'],
  ['skel_mask', 'skelMask', 'u8'],
  ['arrow_r', 'arrowR', 'i16'],
  ['arrow_c', 'arrowC', 'i16'],
  ['arrow_dr', 'arrowDr', 'i8'],
  ['arrow_dc', 'arrowDc', 'i8'],
  ['arrow_mask', 'arrowMask', 'u8'],
  ['plant_r', 'plantR', 'i16'],
  ['plant_c', 'plantC', 'i16'],
  ['plant_age', 'plantAge', 'i16'],
  ['plant_mask', 'plantMask', 'u8'],
  ['light_level', 'lightLevel', 'f32'],
  ['achievements', 'achievements', 'u8'],
  ['timestep', 'timestep', 'i32'],
  // reward is appended by the serializer; it is the step's value, not a field
];

const PARITY_WIDTH = { u8: 1, i8: 1, i16: 2, i32: 4, u32: 4, f32: 4 };

function parityStateBytes() {
  let n = 0;
  for (let i = 0; i < PARITY_ORDER.length; i++) {
    const [, jsName, kind] = PARITY_ORDER[i];
    n += PARITY_WIDTH[kind] * stateFieldCount(jsName);
  }
  return n + 4;   // + reward
}

// Element counts, built from the tables above so they are known before any
// state exists — parityStateBytes() is used to size the writer.
const _STATE_COUNTS = (function () {
  const out = {};
  const all = [STATE_FIELDS_U32, STATE_FIELDS_F32, STATE_FIELDS_I32,
               STATE_FIELDS_I16, STATE_FIELDS_I8, STATE_FIELDS_U8];
  for (let g = 0; g < all.length; g++) {
    for (let i = 0; i < all[g].length; i++) out[all[g][i][0]] = all[g][i][1];
  }
  return out;
})();

function stateFieldCount(name) {
  return _STATE_COUNTS[name];
}

// Build the buffer. Widest views first so every view is naturally aligned.
function createState() {
  const groups = [
    [STATE_FIELDS_U32, 4], [STATE_FIELDS_F32, 4], [STATE_FIELDS_I32, 4],
    [STATE_FIELDS_I16, 2], [STATE_FIELDS_I8, 1], [STATE_FIELDS_U8, 1],
  ];
  let size = 0;
  for (let g = 0; g < groups.length; g++) {
    const [fields, width] = groups[g];
    for (let i = 0; i < fields.length; i++) size += fields[i][1] * width;
  }
  const buffer = new ArrayBuffer(size);
  const st = { buffer, byteLength: size };

  let off = 0;
  const bind = (fields, width, make) => {
    for (let i = 0; i < fields.length; i++) {
      const [name, count] = fields[i];
      st[name] = make(buffer, off, count);
      off += count * width;
    }
  };
  bind(STATE_FIELDS_U32, 4, (b, o, n) => new Uint32Array(b, o, n));
  bind(STATE_FIELDS_F32, 4, (b, o, n) => new Float32Array(b, o, n));
  bind(STATE_FIELDS_I32, 4, (b, o, n) => new Int32Array(b, o, n));
  bind(STATE_FIELDS_I16, 2, (b, o, n) => new Int16Array(b, o, n));
  bind(STATE_FIELDS_I8, 1, (b, o, n) => new Int8Array(b, o, n));
  bind(STATE_FIELDS_U8, 1, (b, o, n) => new Uint8Array(b, o, n));
  // Episode accumulators live outside the parity buffer; see 70_step.js.
  if (typeof attachEpisodeAccumulators === 'function') attachEpisodeAccumulators(st);
  return st;
}

// Zero everything. generate_world sets the rest; the PCG state is NOT reset
// here, because reseeding is resetGame's job (PLAN 3.4).
function clearState(st) {
  new Uint8Array(st.buffer).fill(0);
}

// --- the canonical dump ---------------------------------------------------
// Writes exactly cc_serialize's bytes. Single-element fields are still typed
// arrays, so everything is indexed uniformly.
function getParityState(st, reward) {
  const w = new ParityWriter(parityStateBytes());
  for (let i = 0; i < PARITY_ORDER.length; i++) {
    const [, jsName, kind] = PARITY_ORDER[i];
    const arr = st[jsName];
    for (let k = 0; k < arr.length; k++) {
      switch (kind) {
        case 'u8': w.u8(arr[k]); break;
        case 'i8': w.i8(arr[k]); break;
        case 'i16': w.i16(arr[k]); break;
        case 'i32': w.i32(arr[k]); break;
        case 'u32': w.u32(arr[k]); break;
        case 'f32': w.f32(arr[k]); break;
      }
    }
  }
  w.f32(reward);
  return w.bytes;
}

// --- map accessors, mirroring lines 236-242 -------------------------------
function mapGet(st, r, c) {
  return st.mapPacked[r * MAP_SIZE + c];
}

function mapSet(st, r, c, v) {
  st.mapPacked[r * MAP_SIZE + c] = v;
}

function inBounds(r, c) {
  return (r >>> 0) < MAP_SIZE && (c >>> 0) < MAP_SIZE;
}

// ---- src/30_worldgen.js ----
// 30_worldgen.js — generate_world, craftax_classic.h lines 291-497.
//
// This is the float-heaviest code in the game and the only place where a
// missing Math.fround shows up as a different world rather than a different
// last bit. Every arithmetic step is wrapped in F(), in the C's evaluation
// order (C's * and + are left-associative, and each intermediate is rounded
// to float32 before the next operation).
//
// Two things about which C we are mirroring:
//
//   The SCALAR path. PufferLib has an AVX-512 block for the same maths, and
//   it uses FMA, so it already disagrees with its own scalar fallback in the
//   last bit. reference/build.sh never defines __AVX512F__ and compiles with
//   -ffp-contract=off, pinning the scalar no-FMA path. That is what this
//   mirrors.
//
//   cosf/sinf are V8's ieee754. The driver redirects the C's calls there
//   (PLAN 1.4), and Math.cos/Math.sin in every PlayTrain engine resolve to
//   the same function, so F(Math.cos(a)) here is (float)cosf(a) there.

const WORLDGEN_GRID = 10;
// The C pads its gradient tables by 16 floats so an AVX-512 permute-load at
// the last grid row cannot read out of bounds. The scalar path never reads
// past GRID*GRID, but the padding is kept so the two are visibly the same
// table, and because the padded entries are zeroed in the C too.
const WORLDGEN_GRID_PAD = WORLDGEN_GRID * WORLDGEN_GRID + 16;

// perlin_interp: t*t*t*(t*(t*6-15)+10), left-associated exactly as written.
function perlinInterp(t) {
  const t3 = F(F(t * t) * t);
  const inner = F(F(t * F(F(t * 6.0) - 15.0)) + 10.0);
  return F(t3 * inner);
}

// Scratch, allocated once. generate_world runs on reset, not per step, but
// allocating 64 KB of noise per episode is pointless.
const _wgCosA = [
  new Float32Array(WORLDGEN_GRID_PAD), new Float32Array(WORLDGEN_GRID_PAD),
  new Float32Array(WORLDGEN_GRID_PAD), new Float32Array(WORLDGEN_GRID_PAD),
];
const _wgSinA = [
  new Float32Array(WORLDGEN_GRID_PAD), new Float32Array(WORLDGEN_GRID_PAD),
  new Float32Array(WORLDGEN_GRID_PAD), new Float32Array(WORLDGEN_GRID_PAD),
];
// noise[k][r][c] flattened as k*4096 + r*64 + c.
const _wgNoise = new Float32Array(4 * MAP_SIZE * MAP_SIZE);

function generateWorld(st) {
  // Reset maps and bitmaps. memset(map_packed, BLK_GRASS, ...) writes the
  // byte 2 everywhere, which is what fill does here.
  st.mapPacked.fill(BLK_GRASS);
  st.mobBits.fill(0);
  st.zombieBits.fill(0);
  st.cowBits.fill(0);
  st.skelBits.fill(0);
  st.arrowBits.fill(0);

  // Gradient tables: one random angle per grid point per layer, stored as
  // its cosine and sine. This is the only RNG use in worldgen before the ore
  // and tree rolls, and it consumes 4 * 100 draws in this exact order.
  for (let layer = 0; layer < 4; layer++) {
    const cosA = _wgCosA[layer];
    const sinA = _wgSinA[layer];
    for (let i = 0; i < WORLDGEN_GRID * WORLDGEN_GRID; i++) {
      const a = F(F(crRf(st.pcg) * 2.0) * PI_F);
      cosA[i] = F(Math.cos(a));
      sinA[i] = F(Math.sin(a));
    }
    for (let i = WORLDGEN_GRID * WORLDGEN_GRID; i < WORLDGEN_GRID_PAD; i++) {
      cosA[i] = 0;
      sinA[i] = 0;
    }
  }

  const scale = F(F(MAP_SIZE) / F(WORLDGEN_GRID - 1));
  const invScale = F(1.0 / scale);
  const center = (MAP_SIZE / 2) | 0;

  for (let r = 0; r < MAP_SIZE; r++) {
    const nr = F(r * invScale);
    const x0 = nr | 0;                       // (int)nr; nr >= 0, so truncation
    const fx = F(nr - x0);
    const fx1 = F(fx - 1.0);
    const u = perlinInterp(fx);
    const row0 = x0 * WORLDGEN_GRID;
    const row1 = row0 + WORLDGEN_GRID;
    for (let c = 0; c < MAP_SIZE; c++) {
      const nc = F(c * invScale);
      const y0 = nc | 0;
      const fy = F(nc - F(y0));
      const fy1 = F(fy - 1.0);
      const v = perlinInterp(fy);
      const y1 = y0 + 1;
      for (let k = 0; k < 4; k++) {
        const cosA = _wgCosA[k];
        const sinA = _wgSinA[k];
        const c00 = cosA[row0 + y0];
        const c10 = cosA[row1 + y0];
        const c01 = cosA[row0 + y1];
        const c11 = cosA[row1 + y1];
        const s00 = sinA[row0 + y0];
        const s10 = sinA[row1 + y0];
        const s01 = sinA[row0 + y1];
        const s11 = sinA[row1 + y1];
        const n00 = F(F(c00 * fx) + F(s00 * fy));
        const n10 = F(F(c10 * fx1) + F(s10 * fy));
        const n01 = F(F(c01 * fx) + F(s01 * fy1));
        const n11 = F(F(c11 * fx1) + F(s11 * fy1));
        const nx0 = F(n00 + F(u * F(n10 - n00)));
        const nx1 = F(n01 + F(u * F(n11 - n01)));
        _wgNoise[k * 4096 + r * MAP_SIZE + c] =
          F(F(F(nx0 + F(v * F(nx1 - nx0))) + 1.0) * 0.5);
      }
    }
  }

  // Tile-logic sweep. Reads the precomputed noise, writes blocks, and draws
  // from the RNG for ore and trees — in row-major order, so the stream
  // position depends on the whole sweep.
  for (let r = 0; r < MAP_SIZE; r++) {
    for (let c = 0; c < MAP_SIZE; c++) {
      const waterNoise = _wgNoise[0 * 4096 + r * MAP_SIZE + c];
      const mountainNoise = _wgNoise[1 * 4096 + r * MAP_SIZE + c];
      const treeNoise = _wgNoise[2 * 4096 + r * MAP_SIZE + c];
      const pathNoise = _wgNoise[3 * 4096 + r * MAP_SIZE + c];

      const d2 = (r - center) * (r - center) + (c - center) * (c - center);
      const dist = F(Math.sqrt(F(d2)));
      const q = F(dist / 20.0);
      const prox = F(1.0 - (q < 1.0 ? q : 1.0));      // 1 - cr_min_f(dist/20, 1)

      const waterVal = F(waterNoise - F(prox * 0.3));
      const mountainVal = F(mountainNoise - F(prox * 0.3));

      let blk = BLK_GRASS;
      if (waterVal > F(0.7)) {
        blk = BLK_WATER;
      } else if (waterVal > F(0.6) && waterVal <= F(0.75)) {
        // Reference quirk 2: the <= 0.75 bound is dead, the branch above has
        // already taken everything over 0.7. Kept as written.
        blk = BLK_SAND;
      } else if (mountainVal > F(0.7)) {
        blk = BLK_STONE;
        if (pathNoise > F(0.8)) blk = BLK_PATH;
        if (mountainVal > F(0.85) && waterNoise > F(0.4)) blk = BLK_PATH;
        // Reference quirk 1: lava needs mountain_val > 0.85 and tree_noise >
        // 0.7 together, which no seed in 500 produced. Kept as written.
        if (mountainVal > F(0.85) && treeNoise > F(0.7)) blk = BLK_LAVA;
      }
      if (blk === BLK_STONE) {
        const ore = crRf(st.pcg);
        if (ore < F(0.005) && mountainVal > F(0.8)) blk = BLK_DIAMOND;
        else if (ore < F(0.035)) blk = BLK_IRON;
        else if (ore < F(0.075)) blk = BLK_COAL;
      }
      if (blk === BLK_GRASS && treeNoise > F(0.5) && crRf(st.pcg) > F(0.8)) {
        blk = BLK_TREE;
      }
      mapSet(st, r, c, blk);
    }
  }

  mapSet(st, center, center, BLK_GRASS);   // player spawn is always grass

  // Diamond guarantee: if the ore rolls produced none, convert one stone.
  // The 1000-attempt loop draws two values per attempt and stops at the
  // first hit, so its RNG cost depends on the map.
  let hasDiamond = false;
  for (let r = 0; r < MAP_SIZE && !hasDiamond; r++) {
    for (let c = 0; c < MAP_SIZE && !hasDiamond; c++) {
      if (mapGet(st, r, c) === BLK_DIAMOND) hasDiamond = true;
    }
  }
  if (!hasDiamond) {
    for (let att = 0; att < 1000; att++) {
      const r = crRi(st.pcg, MAP_SIZE);
      const c = crRi(st.pcg, MAP_SIZE);
      if (mapGet(st, r, c) === BLK_STONE) {
        mapSet(st, r, c, BLK_DIAMOND);
        break;
      }
    }
  }

  // Initial intrinsics, inventory and mobs.
  st.playerR[0] = center;
  st.playerC[0] = center;
  st.playerDir[0] = 4;
  st.health[0] = 9;
  st.food[0] = 9;
  st.drink[0] = 9;
  st.energy[0] = 9;
  st.isSleeping[0] = 0;
  st.recover[0] = 0;
  st.hunger[0] = 0;
  st.thirst[0] = 0;
  st.fatigue[0] = 0;
  st.inv.fill(0);
  st.zombieMask.fill(0);
  st.zombieHp.fill(0);
  st.zombieCd.fill(0);
  st.cowMask.fill(0);
  st.cowHp.fill(0);
  st.skelMask.fill(0);
  st.skelHp.fill(0);
  st.skelCd.fill(0);
  st.arrowMask.fill(0);
  st.plantMask.fill(0);
  st.plantAge.fill(0);
  st.achievements.fill(0);
  st.timestep[0] = 0;
  st.lightLevel[0] = 1.0;
}

// ---- src/40_player.js ----
// 40_player.js — the player's half of a step.
//
// do_crafting, do_action, place_block, move_player and their helpers, from
// craftax_classic.h lines 243-644. Function for function, branch for branch,
// and — the part that matters most — draw for draw: do_action takes one
// cr_rf when the facing block is grass, and only then, so any reordering of
// the switch would shift the whole RNG stream.
//
// All integer work. The int8 fields wrap through their Int8Array views the
// way the C's int8_t does, which is why nothing here masks by hand.

// --- helpers, lines 243-288 ----------------------------------------------

function isSolid(b) {
  return b === BLK_WATER || b === BLK_STONE || b === BLK_TREE ||
         b === BLK_COAL || b === BLK_IRON || b === BLK_DIAMOND ||
         b === BLK_TABLE || b === BLK_FURNACE ||
         b === BLK_PLANT || b === BLK_RIPE_PLANT;
}

function l1Dist(r1, c1, r2, c2) {
  let dr = r1 - r2; if (dr < 0) dr = -dr;
  let dc = c1 - c2; if (dc < 0) dc = -dc;
  return dr + dc;
}

function crClampI(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function crMinI(a, b) { return a < b ? a : b; }
function crMaxI(a, b) { return a > b ? a : b; }
function crMinF(a, b) { return a < b ? a : b; }
function crSignI(v) { return (v > 0 ? 1 : 0) - (v < 0 ? 1 : 0); }

function hasMobAt(st, r, c) {
  if ((r >>> 0) >= MAP_SIZE || (c >>> 0) >= MAP_SIZE) return false;
  return mbGet(st.mobBits, r, c) !== 0;
}

// The 8 neighbours, in the C's order. Order is immaterial to the result —
// it returns on the first hit — but keeping it makes the two diffable.
const NEAR_DR8 = [0, 0, -1, 1, -1, -1, 1, 1];
const NEAR_DC8 = [-1, 1, 0, 0, -1, 1, -1, 1];

function isNearBlock(st, blk) {
  const pr = st.playerR[0];
  const pc = st.playerC[0];
  for (let i = 0; i < 8; i++) {
    const nr = pr + NEAR_DR8[i];
    const nc = pc + NEAR_DC8[i];
    if (inBounds(nr, nc) && mapGet(st, nr, nc) === blk) return true;
  }
  return false;
}

function getDamage(st) {
  if (st.inv[INV_ISWORD] > 0) return 5;
  if (st.inv[INV_SSWORD] > 0) return 3;
  if (st.inv[INV_WSWORD] > 0) return 2;
  return 1;
}

// --- do_crafting, lines 502-515 -------------------------------------------
// Note the C tests every recipe with a separate `if`, not else-if. Two
// recipes can never both match one action, so this is only a shape
// difference, but it is kept as written.

function doCrafting(st, action) {
  const inv = st.inv;
  const t = isNearBlock(st, BLK_TABLE);
  const f = isNearBlock(st, BLK_FURNACE);
  if (action === ACT_MAKE_WOOD_PICK && t && inv[0] >= 1) {
    inv[0]--; inv[6]++; st.achievements[ACH_MAKE_WOOD_PICK] = 1;
  }
  if (action === ACT_MAKE_STONE_PICK && t && inv[0] >= 1 && inv[1] >= 1) {
    inv[0]--; inv[1]--; inv[7]++; st.achievements[ACH_MAKE_STONE_PICK] = 1;
  }
  if (action === ACT_MAKE_IRON_PICK && t && f && inv[0] >= 1 && inv[1] >= 1 && inv[3] >= 1 && inv[2] >= 1) {
    inv[0]--; inv[1]--; inv[3]--; inv[2]--; inv[8]++; st.achievements[ACH_MAKE_IRON_PICK] = 1;
  }
  if (action === ACT_MAKE_WOOD_SWORD && t && inv[0] >= 1) {
    inv[0]--; inv[9]++; st.achievements[ACH_MAKE_WOOD_SWORD] = 1;
  }
  if (action === ACT_MAKE_STONE_SWORD && t && inv[0] >= 1 && inv[1] >= 1) {
    inv[0]--; inv[1]--; inv[10]++; st.achievements[ACH_MAKE_STONE_SWORD] = 1;
  }
  if (action === ACT_MAKE_IRON_SWORD && t && f && inv[0] >= 1 && inv[1] >= 1 && inv[3] >= 1 && inv[2] >= 1) {
    inv[0]--; inv[1]--; inv[3]--; inv[2]--; inv[11]++; st.achievements[ACH_MAKE_IRON_SWORD] = 1;
  }
}

// --- do_action, lines 517-605 ---------------------------------------------

function doAction(st) {
  const dir = st.playerDir[0];
  const tr = st.playerR[0] + DIR_DR[dir];
  const tc = st.playerC[0] + DIR_DC[dir];
  if (!inBounds(tr, tc)) return;
  const dmg = getDamage(st);
  let attacked = false;

  // Slot order matters: the first matching slot is the one that takes the
  // hit, and spawns fill the first free slot, so the pairing is stable.
  for (let i = 0; i < MAX_ZOMBIES && !attacked; i++) {
    if (st.zombieMask[i] && st.zombieR[i] === tr && st.zombieC[i] === tc) {
      st.zombieHp[i] -= dmg;
      if (st.zombieHp[i] <= 0) {
        st.zombieMask[i] = 0;
        mbClear(st.mobBits, tr, tc); mbClear(st.zombieBits, tr, tc);
        st.achievements[ACH_DEFEAT_ZOMBIE] = 1;
      }
      attacked = true;
    }
  }
  for (let i = 0; i < MAX_COWS && !attacked; i++) {
    if (st.cowMask[i] && st.cowR[i] === tr && st.cowC[i] === tc) {
      st.cowHp[i] -= dmg;
      if (st.cowHp[i] <= 0) {
        st.cowMask[i] = 0;
        mbClear(st.mobBits, tr, tc); mbClear(st.cowBits, tr, tc);
        st.achievements[ACH_EAT_COW] = 1;
        st.food[0] = crMinI(9, st.food[0] + 6);
        st.hunger[0] = 0;
      }
      attacked = true;
    }
  }
  for (let i = 0; i < MAX_SKELETONS && !attacked; i++) {
    if (st.skelMask[i] && st.skelR[i] === tr && st.skelC[i] === tc) {
      st.skelHp[i] -= dmg;
      if (st.skelHp[i] <= 0) {
        st.skelMask[i] = 0;
        mbClear(st.mobBits, tr, tc); mbClear(st.skelBits, tr, tc);
        st.achievements[ACH_DEFEAT_SKELETON] = 1;
      }
      attacked = true;
    }
  }
  if (attacked) return;

  const blk = mapGet(st, tr, tc);
  switch (blk) {
    case BLK_TREE:
      mapSet(st, tr, tc, BLK_GRASS);
      st.inv[0] = crMinI(9, st.inv[0] + 1);
      st.achievements[ACH_COLLECT_WOOD] = 1;
      break;
    case BLK_STONE:
      if (st.inv[6] > 0 || st.inv[7] > 0 || st.inv[8] > 0) {
        mapSet(st, tr, tc, BLK_PATH);
        st.inv[1] = crMinI(9, st.inv[1] + 1);
        st.achievements[ACH_COLLECT_STONE] = 1;
      }
      break;
    case BLK_COAL:
      if (st.inv[6] > 0 || st.inv[7] > 0 || st.inv[8] > 0) {
        mapSet(st, tr, tc, BLK_PATH);
        st.inv[2] = crMinI(9, st.inv[2] + 1);
        st.achievements[ACH_COLLECT_COAL] = 1;
      }
      break;
    case BLK_IRON:
      if (st.inv[7] > 0 || st.inv[8] > 0) {
        mapSet(st, tr, tc, BLK_PATH);
        st.inv[3] = crMinI(9, st.inv[3] + 1);
        st.achievements[ACH_COLLECT_IRON] = 1;
      }
      break;
    case BLK_DIAMOND:
      if (st.inv[8] > 0) {
        mapSet(st, tr, tc, BLK_PATH);
        st.inv[4] = crMinI(9, st.inv[4] + 1);
        st.achievements[ACH_COLLECT_DIAMOND] = 1;
      }
      break;
    case BLK_GRASS:
      // The one RNG draw in the player half. It happens whenever the facing
      // block is grass and no mob was attacked, whether or not a sapling
      // results, so the stream position depends on where the player looks.
      if (crRf(st.pcg) < F(0.1)) {
        st.inv[5] = crMinI(9, st.inv[5] + 1);
        st.achievements[ACH_COLLECT_SAPLING] = 1;
      }
      break;
    case BLK_WATER:
      st.drink[0] = crMinI(9, st.drink[0] + 1);
      st.thirst[0] = 0;
      st.achievements[ACH_COLLECT_DRINK] = 1;
      break;
    case BLK_RIPE_PLANT:
      mapSet(st, tr, tc, BLK_PLANT);
      st.food[0] = crMinI(9, st.food[0] + 4);
      st.hunger[0] = 0;
      st.achievements[ACH_EAT_PLANT] = 1;
      for (let i = 0; i < MAX_PLANTS; i++) {
        if (st.plantMask[i] && st.plantR[i] === tr && st.plantC[i] === tc) {
          st.plantAge[i] = 0;
          break;
        }
      }
      break;
    default:
      break;
  }
}

// --- place_block, lines 607-632 -------------------------------------------

function placeBlock(st, action) {
  const dir = st.playerDir[0];
  const tr = st.playerR[0] + DIR_DR[dir];
  const tc = st.playerC[0] + DIR_DC[dir];
  if (!inBounds(tr, tc)) return;
  if (hasMobAt(st, tr, tc)) return;
  const blk = mapGet(st, tr, tc);
  const inv = st.inv;
  if (action === ACT_PLACE_TABLE && inv[0] >= 2 && !isSolid(blk)) {
    mapSet(st, tr, tc, BLK_TABLE);
    inv[0] -= 2;
    st.achievements[ACH_PLACE_TABLE] = 1;
  } else if (action === ACT_PLACE_FURNACE && inv[1] >= 1 && !isSolid(blk)) {
    mapSet(st, tr, tc, BLK_FURNACE);
    inv[1] -= 1;
    st.achievements[ACH_PLACE_FURNACE] = 1;
  } else if (action === ACT_PLACE_STONE && inv[1] >= 1 && (!isSolid(blk) || blk === BLK_WATER)) {
    // The only place_block branch that overwrites a solid block: stone can
    // be dropped into water.
    mapSet(st, tr, tc, BLK_STONE);
    inv[1] -= 1;
    st.achievements[ACH_PLACE_STONE] = 1;
  } else if (action === ACT_PLACE_PLANT && inv[5] >= 1 && blk === BLK_GRASS) {
    mapSet(st, tr, tc, BLK_PLANT);
    inv[5] -= 1;
    st.achievements[ACH_PLACE_PLANT] = 1;
    for (let i = 0; i < MAX_PLANTS; i++) {
      if (!st.plantMask[i]) {
        st.plantR[i] = tr;
        st.plantC[i] = tc;
        st.plantAge[i] = 0;
        st.plantMask[i] = 1;
        break;
      }
    }
  }
}

// --- move_player, lines 634-643 -------------------------------------------

function movePlayer(st, action) {
  if (action < 1 || action > 4) return;
  const nr = st.playerR[0] + DIR_DR[action];
  const nc = st.playerC[0] + DIR_DC[action];
  // Facing changes even when the move is refused. That is how the player
  // turns to face a solid block or a mob in order to act on it.
  st.playerDir[0] = action;
  if (!inBounds(nr, nc)) return;
  if (isSolid(mapGet(st, nr, nc))) return;
  if (hasMobAt(st, nr, nc)) return;
  st.playerR[0] = nr;
  st.playerC[0] = nc;
}

// ---- src/50_mobs.js ----
// 50_mobs.js — update_mobs, try_spawn, spawn_mobs, can_move_mob.
//
// craftax_classic.h lines 645-842. The RNG call order here is the most
// delicate part of the port: zombies, cows, skeletons and arrows are updated
// in that order, each mob draws a variable number of values depending on
// branches taken, and spawn_mobs draws again. A single misplaced draw shifts
// every later mob decision and every worldgen-independent roll for the rest
// of the episode.
//
// The bitmaps are state, not a cache: has_mob_at and can_move_mob read them,
// so every move must clear the old cell and set the new one in both the
// combined mob_bits and the per-type map, exactly where the C does.

// --- can_move_mob, lines 645-653 -----------------------------------------

function canMoveMob(st, r, c) {
  if (!inBounds(r, c)) return false;
  const blk = mapGet(st, r, c);
  if (isSolid(blk)) return false;
  if (blk === BLK_LAVA) return false;          // unreachable: see quirk 1
  if (hasMobAt(st, r, c)) return false;
  if (r === st.playerR[0] && c === st.playerC[0]) return false;
  return true;
}

// --- update_mobs, lines 655-784 -------------------------------------------

function updateMobs(st) {
  const pr = st.playerR[0];
  const pc = st.playerC[0];

  // Zombies.
  for (let i = 0; i < MAX_ZOMBIES; i++) {
    if (!st.zombieMask[i]) continue;
    const zr = st.zombieR[i];
    const zc = st.zombieC[i];
    const dist = l1Dist(zr, zc, pr, pc);
    if (dist >= MOB_DESPAWN_DIST) {
      st.zombieMask[i] = 0;
      mbClear(st.mobBits, zr, zc); mbClear(st.zombieBits, zr, zc);
      continue;
    }
    if (dist <= 1 && st.zombieCd[i] <= 0) {
      // 7 damage against a sleeping player, 2 otherwise. health is int8 and
      // is never clamped, so this can and does go negative.
      const dmg = st.isSleeping[0] ? 7 : 2;
      st.health[0] -= dmg;
      st.zombieCd[i] = 5;
      st.isSleeping[0] = 0;
    }
    st.zombieCd[i] = crMaxI(0, st.zombieCd[i] - 1);

    let dr = 0, dc = 0;
    if (dist < 10 && crRf(st.pcg) < F(0.75)) {
      const adr = Math.abs(pr - zr);
      const adc = Math.abs(pc - zc);
      // The tie-break draw only happens when adr === adc, so the number of
      // values consumed depends on the geometry.
      if (adr > adc || (adr === adc && crRf(st.pcg) < F(0.5))) dr = crSignI(pr - zr);
      else dc = crSignI(pc - zc);
    } else {
      const d = crRi(st.pcg, 4);
      dr = DIR_DR[d + 1]; dc = DIR_DC[d + 1];
    }
    const nr = zr + dr, nc = zc + dc;
    if (canMoveMob(st, nr, nc)) {
      mbClear(st.mobBits, zr, zc); mbClear(st.zombieBits, zr, zc);
      st.zombieR[i] = nr; st.zombieC[i] = nc;
      mbSet(st.mobBits, nr, nc); mbSet(st.zombieBits, nr, nc);
    }
  }

  // Cows. One draw each, always.
  for (let i = 0; i < MAX_COWS; i++) {
    if (!st.cowMask[i]) continue;
    const cr = st.cowR[i];
    const cc = st.cowC[i];
    const dist = l1Dist(cr, cc, pr, pc);
    if (dist >= MOB_DESPAWN_DIST) {
      st.cowMask[i] = 0;
      mbClear(st.mobBits, cr, cc); mbClear(st.cowBits, cr, cc);
      continue;
    }
    const d = crRi(st.pcg, 8);
    if (d < 4) {
      const dr = DIR_DR[d + 1], dc2 = DIR_DC[d + 1];
      const nr = cr + dr, nc = cc + dc2;
      if (canMoveMob(st, nr, nc)) {
        mbClear(st.mobBits, cr, cc); mbClear(st.cowBits, cr, cc);
        st.cowR[i] = nr; st.cowC[i] = nc;
        mbSet(st.mobBits, nr, nc); mbSet(st.cowBits, nr, nc);
      }
    }
  }

  // Skeletons: fire at range 4-5, keep their distance, flee when too close.
  for (let i = 0; i < MAX_SKELETONS; i++) {
    if (!st.skelMask[i]) continue;
    const sr = st.skelR[i];
    const sc = st.skelC[i];
    const dist = l1Dist(sr, sc, pr, pc);
    if (dist >= MOB_DESPAWN_DIST) {
      st.skelMask[i] = 0;
      mbClear(st.mobBits, sr, sc); mbClear(st.skelBits, sr, sc);
      continue;
    }
    if (dist >= 4 && dist <= 5 && st.skelCd[i] <= 0) {
      for (let a = 0; a < MAX_ARROWS; a++) {
        if (!st.arrowMask[a]) {
          st.arrowMask[a] = 1;
          st.arrowR[a] = sr; st.arrowC[a] = sc;
          mbSet(st.arrowBits, sr, sc);
          const adr = Math.abs(pr - sr), adc = Math.abs(pc - sc);
          st.arrowDr[a] = (adr > 0) ? crSignI(pr - sr) : 0;
          st.arrowDc[a] = (adc > 0) ? crSignI(pc - sc) : 0;
          break;
        }
      }
      // Set whether or not a free arrow slot was found, as in the C: the
      // assignment is after the loop, not inside it.
      st.skelCd[i] = 4;
    }
    st.skelCd[i] = crMaxI(0, st.skelCd[i] - 1);

    let dr = 0, dc = 0;
    let randomMove = crRf(st.pcg) < F(0.15);
    if (!randomMove) {
      if (dist >= 10) {
        const adr = Math.abs(pr - sr), adc = Math.abs(pc - sc);
        if (adr > adc || (adr === adc && crRf(st.pcg) < F(0.5))) dr = crSignI(pr - sr);
        else dc = crSignI(pc - sc);
      } else if (dist <= 3) {
        const adr = Math.abs(pr - sr), adc = Math.abs(pc - sc);
        if (adr > adc || (adr === adc && crRf(st.pcg) < F(0.5))) dr = -crSignI(pr - sr);
        else dc = -crSignI(pc - sc);
      } else {
        // Mid range: hold position by falling through to a random step. The
        // draw below still happens, which is why randomMove is reassigned
        // rather than the branch returning early.
        randomMove = true;
      }
    }
    if (randomMove) {
      const d = crRi(st.pcg, 4);
      dr = DIR_DR[d + 1]; dc = DIR_DC[d + 1];
    }
    const nr = sr + dr, nc = sc + dc;
    if (canMoveMob(st, nr, nc)) {
      mbClear(st.mobBits, sr, sc); mbClear(st.skelBits, sr, sc);
      st.skelR[i] = nr; st.skelC[i] = nc;
      mbSet(st.mobBits, nr, nc); mbSet(st.skelBits, nr, nc);
    }
  }

  // Arrows. No RNG; they fly until something stops them.
  for (let i = 0; i < MAX_ARROWS; i++) {
    if (!st.arrowMask[i]) continue;
    const ar = st.arrowR[i];
    const ac = st.arrowC[i];
    const nr = ar + st.arrowDr[i];
    const nc = ac + st.arrowDc[i];
    if (!inBounds(nr, nc)) {
      st.arrowMask[i] = 0; mbClear(st.arrowBits, ar, ac); continue;
    }
    const blk = mapGet(st, nr, nc);
    if (isSolid(blk) && blk !== BLK_WATER) {
      // An arrow destroys a table or furnace it hits, leaving path.
      if (blk === BLK_FURNACE || blk === BLK_TABLE) mapSet(st, nr, nc, BLK_PATH);
      st.arrowMask[i] = 0; mbClear(st.arrowBits, ar, ac); continue;
    }
    if (nr === pr && nc === pc) {
      st.health[0] -= 2;
      st.isSleeping[0] = 0;
      st.arrowMask[i] = 0; mbClear(st.arrowBits, ar, ac); continue;
    }
    mbClear(st.arrowBits, ar, ac);
    st.arrowR[i] = nr; st.arrowC[i] = nc;
    mbSet(st.arrowBits, nr, nc);
  }
}

// --- try_spawn, lines 785-801 ---------------------------------------------
// Returns the chosen cell through the caller's two-element scratch array,
// mirroring the C's out-parameters. Up to 20 attempts, two draws each, and
// it stops at the first acceptable cell — so its RNG cost varies.

function trySpawn(st, minD, maxD, needGrass, needPath, out) {
  const pr = st.playerR[0];
  const pc = st.playerC[0];
  for (let att = 0; att < 20; att++) {
    const r = crRi(st.pcg, MAP_SIZE);
    const c = crRi(st.pcg, MAP_SIZE);
    const dist = l1Dist(r, c, pr, pc);
    if (dist < minD || dist >= maxD) continue;
    if (hasMobAt(st, r, c)) continue;
    if (r === pr && c === pc) continue;
    const blk = mapGet(st, r, c);
    if (needGrass && blk !== BLK_GRASS) continue;
    if (needPath && blk !== BLK_PATH) continue;
    // With neither flag set the cell must still be grass or path, so mobs
    // never spawn in stone, water or sand.
    if (!needGrass && !needPath && blk !== BLK_GRASS && blk !== BLK_PATH) continue;
    out[0] = r; out[1] = c;
    return true;
  }
  return false;
}

// --- spawn_mobs, lines 803-842 --------------------------------------------

const _spawnOut = new Int32Array(2);

function spawnMobs(st) {
  let nCows = 0, nZ = 0, nSk = 0;
  for (let i = 0; i < MAX_COWS; i++) nCows += st.cowMask[i];
  for (let i = 0; i < MAX_ZOMBIES; i++) nZ += st.zombieMask[i];
  for (let i = 0; i < MAX_SKELETONS; i++) nSk += st.skelMask[i];

  // The chance draw happens only when there is a free slot, so a full slot
  // table changes the stream as well as the outcome.
  if (nCows < MAX_COWS && crRf(st.pcg) < F(0.1)) {
    if (trySpawn(st, 3, MOB_DESPAWN_DIST, true, false, _spawnOut)) {
      const r = _spawnOut[0], c = _spawnOut[1];
      for (let i = 0; i < MAX_COWS; i++) {
        if (!st.cowMask[i]) {
          st.cowMask[i] = 1; st.cowR[i] = r; st.cowC[i] = c; st.cowHp[i] = 3;
          mbSet(st.mobBits, r, c); mbSet(st.cowBits, r, c);
          break;
        }
      }
    }
  }

  // Zombie chance rises as the light falls: 0.02 at full light, 0.12 at
  // none. float32 throughout, and light_level is itself a float32 from the
  // cosine in step, so this is where a light divergence would first show.
  const l = st.lightLevel[0];
  const zombieChance = F(F(0.02) + F(F(0.1) * F(F(1.0 - l) * F(1.0 - l))));
  if (nZ < MAX_ZOMBIES && crRf(st.pcg) < zombieChance) {
    if (trySpawn(st, 9, MOB_DESPAWN_DIST, false, false, _spawnOut)) {
      const r = _spawnOut[0], c = _spawnOut[1];
      for (let i = 0; i < MAX_ZOMBIES; i++) {
        if (!st.zombieMask[i]) {
          st.zombieMask[i] = 1; st.zombieR[i] = r; st.zombieC[i] = c;
          st.zombieHp[i] = 5; st.zombieCd[i] = 0;
          mbSet(st.mobBits, r, c); mbSet(st.zombieBits, r, c);
          break;
        }
      }
    }
  }

  // Skeletons need path, which only exists where stone has been mined.
  if (nSk < MAX_SKELETONS && crRf(st.pcg) < F(0.05)) {
    if (trySpawn(st, 9, MOB_DESPAWN_DIST, false, true, _spawnOut)) {
      const r = _spawnOut[0], c = _spawnOut[1];
      for (let i = 0; i < MAX_SKELETONS; i++) {
        if (!st.skelMask[i]) {
          st.skelMask[i] = 1; st.skelR[i] = r; st.skelC[i] = c;
          st.skelHp[i] = 3; st.skelCd[i] = 0;
          mbSet(st.mobBits, r, c); mbSet(st.skelBits, r, c);
          break;
        }
      }
    }
  }
}

// ---- src/60_world_tick.js ----
// 60_world_tick.js — update_plants, update_intrinsics, and the light level.
//
// craftax_classic.h lines 844-876, plus the light calculation that lives
// inline in puf_step (lines 983-985) and is kept here because it is the
// other half of the day cycle.
//
// The intrinsics accumulators move by +/-0.5, 1 and 2, all dyadic, so they
// are exact in float32 and in double alike. They are still wrapped in F()
// because the rule is uniform and because a future change to one of those
// constants should not silently start relying on double precision.

// --- update_plants, lines 844-855 -----------------------------------------

function updatePlants(st) {
  for (let i = 0; i < MAX_PLANTS; i++) {
    if (!st.plantMask[i]) continue;
    st.plantAge[i]++;
    if (st.plantAge[i] >= 600) {
      const r = st.plantR[i], c = st.plantC[i];
      // Only ripens if the cell is still a plant: the player can have mined
      // or built over it, and the slot stays live either way.
      if (inBounds(r, c) && mapGet(st, r, c) === BLK_PLANT) {
        mapSet(st, r, c, BLK_RIPE_PLANT);
      }
    }
  }
}

// --- update_intrinsics, lines 856-876 -------------------------------------
// Takes the RAW action, not the sleep-masked effective one. That is what
// lets ACT_SLEEP start a sleep while every other action is suppressed.

function updateIntrinsics(st, action) {
  if (action === ACT_SLEEP && st.energy[0] < 9) st.isSleeping[0] = 1;
  if (st.energy[0] >= 9 && st.isSleeping[0]) {
    st.isSleeping[0] = 0;
    st.achievements[ACH_WAKE_UP] = 1;
  }
  const mul = st.isSleeping[0] ? F(0.5) : F(1.0);

  st.hunger[0] = F(st.hunger[0] + mul);
  if (st.hunger[0] > F(25.0)) { st.food[0]--; st.hunger[0] = 0; }

  st.thirst[0] = F(st.thirst[0] + mul);
  if (st.thirst[0] > F(20.0)) { st.drink[0]--; st.thirst[0] = 0; }

  if (st.isSleeping[0]) st.fatigue[0] = F(st.fatigue[0] - F(1.0));
  else st.fatigue[0] = F(st.fatigue[0] + F(1.0));
  if (st.fatigue[0] > F(30.0)) { st.energy[0]--; st.fatigue[0] = 0; }
  if (st.fatigue[0] < F(-10.0)) {
    // Sleeping is the only way energy comes back.
    st.energy[0] = crMinI(st.energy[0] + 1, 9);
    st.fatigue[0] = 0;
  }

  const ok = (st.food[0] > 0) && (st.drink[0] > 0) && (st.energy[0] > 0 || st.isSleeping[0]);
  if (ok) st.recover[0] = F(st.recover[0] + (st.isSleeping[0] ? F(2.0) : F(1.0)));
  else st.recover[0] = F(st.recover[0] + (st.isSleeping[0] ? F(-0.5) : F(-1.0)));
  if (st.recover[0] > F(25.0)) {
    st.recover[0] = 0;
    st.health[0] = crMinI(st.health[0] + 1, 9);
  }
  if (st.recover[0] < F(-15.0)) { st.health[0]--; st.recover[0] = 0; }
}

// --- light level, puf_step lines 983-985 ----------------------------------
// light = 1 - |cos(pi * (fmod(t/300, 1) + 0.3))|^3
//
// The second cosf in the game, and the other place the V8 ieee754 binding
// matters. Note this is NOT periodic in float32: (float)t/300 rounds
// differently for each t, so a 300-entry table would be wrong.

function computeLightLevel(timestep) {
  const tFrac = F(F(F(F(timestep) / F(DAY_LENGTH)) % F(1.0)) + F(0.3));
  const cv = F(Math.cos(F(PI_F * tFrac)));
  return F(F(1.0) - Math.abs(F(F(cv * cv) * cv)));
}

// ---- src/70_step.js ----
// 70_step.js — puf_step, craftax_classic.h lines 957-1009.
//
// The call order below IS the specification (PLAN 1.3). Anything reordered
// changes the RNG stream and therefore the whole episode.
//
// One deliberate difference from the reference, and only one: the C
// auto-resets on the terminal step — it calls add_log and puf_reset, which
// runs generate_world and destroys the state the parity gate needs to
// compare. PlayTrain calls resetGame(seed) instead, so this returns `done`
// and leaves the state alone. PufferLib's auto-reset RNG continuation across
// episodes is listed under not_matched in the manifest, and the reference
// driver's `run` mode makes the same choice (see PLAN 4.2 correction 3).

// Score and episode length are NOT parity state — the C keeps them in
// episode_return_accum and episode_length_accum, which PLAN 1.1 excludes
// from the dump. They live outside the parity buffer so they cannot
// accidentally be serialized, but score is still a float32 running sum so
// that getGameState() matches the C bit for bit (PLAN 3.5).
function attachEpisodeAccumulators(st) {
  st.score = new Float32Array(1);
  st.episodeLength = new Int32Array(1);
}

function resetEpisodeAccumulators(st) {
  st.score[0] = 0;
  st.episodeLength[0] = 0;
}

// Scratch for the reward comparison, mirroring the C's old_health and
// old_achievements. Also not parity state.
const _oldAchievements = new Uint8Array(NUM_ACHIEVEMENTS);

function stepGame(st, action) {
  // clamp, as the C does: out-of-range actions are pinned, not rejected
  if (action < 0) action = 0;
  if (action >= NUM_ACTIONS) action = NUM_ACTIONS - 1;

  const oldHealth = st.health[0];
  _oldAchievements.set(st.achievements);

  const effAction = st.isSleeping[0] ? ACT_NOOP : action;
  doCrafting(st, effAction);
  if (effAction === ACT_DO) doAction(st);
  if (effAction >= ACT_PLACE_STONE && effAction <= ACT_PLACE_PLANT) placeBlock(st, effAction);
  movePlayer(st, effAction);
  updateMobs(st);
  spawnMobs(st);
  updatePlants(st);
  // The RAW action, not effAction: sleeping suppresses everything else but
  // ACT_SLEEP still has to be seen here to start a sleep.
  updateIntrinsics(st, action);

  // Inventory is clamped once, after every sub-step, not inside each one.
  for (let i = 0; i < NUM_INVENTORY; i++) {
    st.inv[i] = crClampI(st.inv[i], 0, 9);
  }

  st.timestep[0]++;
  st.lightLevel[0] = computeLightLevel(st.timestep[0]);

  // Reward: one per newly unlocked achievement, plus a tenth of the health
  // change. Accumulated in float32, as in the C.
  let achR = F(0.0);
  for (let i = 0; i < NUM_ACHIEVEMENTS; i++) {
    achR = F(achR + ((st.achievements[i] && !_oldAchievements[i]) ? 1.0 : 0.0));
  }
  const hpR = F(F(st.health[0] - oldHealth) * F(0.1));
  const r = F(achR + hpR);
  st.score[0] = F(st.score[0] + r);
  st.episodeLength[0] += 1;

  let done = (st.timestep[0] >= MAX_TIMESTEPS) || (st.health[0] <= 0);
  // Standing on lava ends the episode. Unreachable in practice — no seed
  // generates lava (README quirk 1) — but kept because the reference has it.
  if (inBounds(st.playerR[0], st.playerC[0])
      && mapGet(st, st.playerR[0], st.playerC[0]) === BLK_LAVA) {
    done = true;
  }

  return { reward: r, done: done };
}

// A fresh episode for `seed`, seeded exactly as c_init does (PLAN 3.4).
function newEpisode(st, seed) {
  clearState(st);
  resetEpisodeAccumulators(st);
  pcgSeed(st.pcg, seed);
  generateWorld(st);
}

// ---- src/80_render.js ----
// 80_render.js — Craftax's frame, reproduced.
//
// The observation is 63x63: a 9-wide by 7-tall map view plus 2 inventory
// rows, every tile 7x7. That is OBS_DIM and BLOCK_PIXEL_SIZE_AGENT from
// craftax_classic/constants.py, and the textures are Craftax's own, baked to
// 7x7 (icons 5x5, digits 4x4) at build time by tools/craftax_atlas.py.
//
// This mirrors Craftax's renderer step for step, including the parts that are
// easy to miss:
//
//   * the dusk pass runs for ANY light_level < 1.0, not just at night — a
//     luminance "enhance", a blue tint, then a blend back toward the lit
//     image. Skipping it left 3087 of 3969 pixels wrong on every frame that
//     was not exactly full daylight;
//   * the player and mobs alpha-blend in float32; the result is NOT integral
//     (13.447, 93.631 ...) because Craftax's observation is float32;
//   * inventory icons are a hard overwrite and the count digits a stencil —
//     neither is ever blended — and the slot order is fixed, with diamond
//     starting the second row.
//
// Composition happens in a JS buffer rather than tile-by-tile blits, because
// the dusk and sleep passes are per-pixel over the whole map region. The
// buffer is uploaded once per region and blitted 1:1.
//
// WHAT THIS BUYS. Our uint8 frame equals Craftax's float32 frame cast to
// uint8 — `render_craftax_pixels(state).astype(uint8)` — at every light
// level, PROVIDED the night key is supplied. Below light_level 0.5 Craftax
// adds per-pixel static drawn with jax.random.uniform from state_rng, and
// state_rng is set from the CALLER's step key, not from anything in the
// environment state — so the state does not determine the frame, and this
// renderer cannot derive the key. It can accept one: setNightKey(k0, k1)
// installs the two uint32 words of Craftax's state_rng, and the static is
// then reproduced bit for bit (16_threefry.js). With no key installed
// (the default, and what every host does) the static is skipped and the
// frame is the deterministic dusk image. See
// reference/craftax_pixels/README.md.

const RENDER_TILE = 7;              // BLOCK_PIXEL_SIZE_AGENT
const RENDER_COLS = 9;              // OBS_DIM[1]
const RENDER_ROWS = 7;              // OBS_DIM[0]
const RENDER_INV_ROWS = 2;          // INVENTORY_OBS_HEIGHT
const RENDER_W = RENDER_TILE * RENDER_COLS;              // 63
const RENDER_MAP_H = RENDER_TILE * RENDER_ROWS;          // 49
const RENDER_INV_H = RENDER_TILE * RENDER_INV_ROWS;      // 14

// Craftax's night constants.
const NIGHT_TINT = [0, 16, 64];     // night_texture
const SLEEP_TINT = [0, 0, 16];
const ENHANCE = 0.4;

let _atlasRaw = null, _iconRaw = null, _digitRaw = null;
let _mapBmp = -1, _invBmp = -1;
let _mapPx = null, _invPx = null;

// --- night static -----------------------------------------------------------
// Craftax's state_rng, as two uint32 words, or null for "no key": the static
// branch is then skipped and the frame is the deterministic dusk image. This
// is render-only state — it is not part of the game state, never touches the
// PCG, and nothing in the host contract sets it. A comparison harness calls
// setNightKey() with the key Craftax was given for the same frame.
let _nightKey = null;
let _nightNoise = null;             // float32 (49 x 63) night_noise_intensity_texture
let _nightStatic = null;            // float32 (49 x 63) scratch for the uniform draw

function setNightKey(k0, k1) {
  _nightKey = [k0 >>> 0, k1 >>> 0];
}

function clearNightKey() {
  _nightKey = null;
}

// float32 little-endian bytes -> Float32Array, byte by byte so the result
// does not depend on the host's endianness.
function _decodeF32(bytes, n) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    out[i] = bitsToF32((bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0);
  }
  return out;
}

function _decodeB64(s) {
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lut = new Int16Array(256).fill(-1);
  for (let i = 0; i < 64; i++) lut[B64.charCodeAt(i)] = i;
  let pad = 0;
  for (let i = s.length - 1; i >= 0 && s[i] === '='; i--) pad++;
  const out = new Uint8Array((s.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const a = lut[s.charCodeAt(i)], b = lut[s.charCodeAt(i + 1)];
    const c = lut[s.charCodeAt(i + 2)], d = lut[s.charCodeAt(i + 3)];
    const n = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d);
    if (o < out.length) out[o++] = (n >> 16) & 0xff;
    if (o < out.length) out[o++] = (n >> 8) & 0xff;
    if (o < out.length) out[o++] = n & 0xff;
  }
  return out;
}

function initRender() {
  _atlasRaw = _decodeB64(ATLAS_B64);
  _iconRaw = _decodeB64(ICONS_B64);
  _digitRaw = _decodeB64(DIGITS_B64);
  _nightNoise = _decodeF32(_decodeB64(NIGHT_NOISE_B64), NIGHT_NOISE_ROWS * NIGHT_NOISE_COLS);
  _nightStatic = new Float32Array(RENDER_W * RENDER_MAP_H);
  // float32 working buffers, one channel triple per pixel
  _mapPx = new Float32Array(RENDER_W * RENDER_MAP_H * 3);
  _invPx = new Float32Array(RENDER_W * RENDER_INV_H * 3);
  _mapBmp = createBitmap(RENDER_W, RENDER_MAP_H);
  _invBmp = createBitmap(RENDER_W, RENDER_INV_H);
}

// --- map composition --------------------------------------------------------

function _putTile(buf, bufW, px, py, spriteIdx) {
  const off = spriteIdx * ATLAS_STRIDE;
  for (let y = 0; y < RENDER_TILE; y++) {
    for (let x = 0; x < RENDER_TILE; x++) {
      const s = off + (y * RENDER_TILE + x) * 4;
      const d = ((py + y) * bufW + (px + x)) * 3;
      buf[d] = _atlasRaw[s];
      buf[d + 1] = _atlasRaw[s + 1];
      buf[d + 2] = _atlasRaw[s + 2];
    }
  }
}

// Craftax: pixels * (1 - alpha) + texture * alpha, float32, alpha = a / 255.
function _overTile(buf, bufW, px, py, spriteIdx) {
  const off = spriteIdx * ATLAS_STRIDE;
  for (let y = 0; y < RENDER_TILE; y++) {
    for (let x = 0; x < RENDER_TILE; x++) {
      const s = off + (y * RENDER_TILE + x) * 4;
      const d = ((py + y) * bufW + (px + x)) * 3;
      const a = F(_atlasRaw[s + 3] / 255);
      const ia = F(1 - a);
      buf[d] = F(F(buf[d] * ia) + F(_atlasRaw[s] * a));
      buf[d + 1] = F(F(buf[d + 1] * ia) + F(_atlasRaw[s + 1] * a));
      buf[d + 2] = F(F(buf[d + 2] * ia) + F(_atlasRaw[s + 2] * a));
    }
  }
}

function _playerSprite(dir, asleep) {
  if (asleep) return ATLAS.player_sleep;
  if (dir === 1) return ATLAS.player_left;
  if (dir === 2) return ATLAS.player_right;
  if (dir === 3) return ATLAS.player_up;
  return ATLAS.player_down;
}

function _arrowSprite(dr, dc) {
  if (dr < 0) return ATLAS.arrow_up;
  if (dr > 0) return ATLAS.arrow_down;
  if (dc < 0) return ATLAS.arrow_left;
  return ATLAS.arrow_right;
}

// --- inventory --------------------------------------------------------------
// left  = (7 - int(0.8 * 7)) // 2 - 1 = 0    icon 5x5 at (0, 0) in the tile
// number_size = int(0.6 * 7) = 4, drawn at offset (7 - 4) - 1 = 2
const INV_LEFT = 0;
const INV_NUM_OFF = 2;

// Craftax's slot coordinates. Row 0 ends at iron and diamond starts row 1 —
// not a left-to-right fill.
const INV_SLOTS = [
  ['health', 0, 0], ['food', 1, 0], ['drink', 2, 0], ['energy', 3, 0],
  ['inv_sapling', 4, 0], ['inv_wood', 5, 0], ['inv_stone', 6, 0],
  ['inv_coal', 7, 0], ['inv_iron', 8, 0],
  ['inv_diamond', 0, 1], ['inv_wpick', 1, 1], ['inv_spick', 2, 1],
  ['inv_ipick', 3, 1], ['inv_wsword', 4, 1], ['inv_ssword', 5, 1],
  ['inv_isword', 6, 1],
];

function _putIcon(key, col, row) {
  const off = ICONS[key] * ICON_STRIDE;
  const px = col * RENDER_TILE + INV_LEFT;
  const py = row * RENDER_TILE + INV_LEFT;
  for (let y = 0; y < ICON_TILE; y++) {
    for (let x = 0; x < ICON_TILE; x++) {
      const s = off + (y * ICON_TILE + x) * 4;
      const d = ((py + y) * RENDER_W + (px + x)) * 3;
      _invPx[d] = _iconRaw[s];
      _invPx[d + 1] = _iconRaw[s + 1];
      _invPx[d + 2] = _iconRaw[s + 2];
    }
  }
}

// Stencil: multiply by (1 - alpha), then add the premultiplied texture. With
// alpha clamped to 0/1 upstream this is a hard replace where the digit is
// opaque and a no-op elsewhere.
function _putDigit(n, col, row) {
  const off = (n - 1) * DIGIT_STRIDE;
  const px = col * RENDER_TILE + INV_NUM_OFF;
  const py = row * RENDER_TILE + INV_NUM_OFF;
  for (let y = 0; y < DIGIT_TILE; y++) {
    for (let x = 0; x < DIGIT_TILE; x++) {
      const s = off + (y * DIGIT_TILE + x) * 4;
      if (_digitRaw[s + 3] !== 255) continue;
      const d = ((py + y) * RENDER_W + (px + x)) * 3;
      _invPx[d] = _digitRaw[s];
      _invPx[d + 1] = _digitRaw[s + 1];
      _invPx[d + 2] = _digitRaw[s + 2];
    }
  }
}

// --- upload -----------------------------------------------------------------
// float32 -> uint8 with truncation, which is what .astype(uint8) does to
// Craftax's float frame.
const _rgba = new Uint8Array(RENDER_W * RENDER_MAP_H * 4);

function _upload(buf, bmp, w, h, x, y) {
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const s = i * 3, d = i * 4;
    _rgba[d] = buf[s] | 0;
    _rgba[d + 1] = buf[s + 1] | 0;
    _rgba[d + 2] = buf[s + 2] | 0;
    _rgba[d + 3] = 255;
  }
  loadBitmap(bmp, _rgba.subarray(0, n * 4));
  image(bmp, x, y, w, h);
}

function renderGame(st) {
  if (_atlasRaw === null) initRender();

  const pr = st.playerR[0];
  const pc = st.playerC[0];
  background(0, 0, 0);

  // --- map ----------------------------------------------------------------
  for (let vr = 0; vr < RENDER_ROWS; vr++) {
    for (let vc = 0; vc < RENDER_COLS; vc++) {
      const r = pr + vr - 3;
      const c = pc + vc - 4;
      const blk = inBounds(r, c) ? mapGet(st, r, c) : BLK_OUT_OF_BOUNDS;
      _putTile(_mapPx, RENDER_W, vc * RENDER_TILE, vr * RENDER_TILE, ATLAS['block_' + blk]);
    }
  }

  // Player first, then mobs, then arrows — Craftax's order.
  _overTile(_mapPx, RENDER_W, 4 * RENDER_TILE, 3 * RENDER_TILE,
            _playerSprite(st.playerDir[0], st.isSleeping[0]));

  const drawMob = (bits, sprite) => {
    for (let vr = 0; vr < RENDER_ROWS; vr++) {
      for (let vc = 0; vc < RENDER_COLS; vc++) {
        const r = pr + vr - 3, c = pc + vc - 4;
        if (!inBounds(r, c) || !mbGet(bits, r, c)) continue;
        _overTile(_mapPx, RENDER_W, vc * RENDER_TILE, vr * RENDER_TILE, sprite);
      }
    }
  };
  drawMob(st.zombieBits, ATLAS.zombie);
  drawMob(st.cowBits, ATLAS.cow);
  drawMob(st.skelBits, ATLAS.skeleton);
  for (let i = 0; i < MAX_ARROWS; i++) {
    if (!st.arrowMask[i]) continue;
    const vr = st.arrowR[i] - pr + 3, vc = st.arrowC[i] - pc + 4;
    if (vr < 0 || vr >= RENDER_ROWS || vc < 0 || vc >= RENDER_COLS) continue;
    _overTile(_mapPx, RENDER_W, vc * RENDER_TILE, vr * RENDER_TILE,
              _arrowSprite(st.arrowDr[i], st.arrowDc[i]));
  }

  // --- dusk ---------------------------------------------------------------
  // Runs for any daylight < 1. Craftax, in order:
  //   night_pixels = daylight < 0.5 ? static-blended map : map
  //   enhance + tint on night_pixels
  //   map = daylight * map + (1 - daylight) * night_pixels
  // The static branch needs state_rng; with no key installed it is skipped
  // and night_pixels is the map itself (see setNightKey above).
  const daylight = st.lightLevel[0];
  if (daylight < 1.0) {
    const inv = F(1 - daylight);
    const n = RENDER_W * RENDER_MAP_H;
    const withStatic = daylight < 0.5 && _nightKey !== null;
    let intensity = 0;
    if (withStatic) {
      // night_static_intensity = max(2 * (0.5 - daylight), 0); positive here
      intensity = F(2 * F(0.5 - daylight));
      // jax.random.uniform(state_rng, (49, 63)), row-major like the buffer
      threefryUniformF32(_nightKey[0], _nightKey[1], n, _nightStatic);
    }
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      const r0 = _mapPx[o], g0 = _mapPx[o + 1], b0 = _mapPx[o + 2];
      let r1 = r0, g1 = g0, b1 = b0;
      if (withStatic) {
        // night_with_static = uniform * 95 + 32
        // mask = intensity * night_noise_intensity_texture
        // night_pixels = (1 - mask) * map + mask * night_with_static
        const s = F(F(_nightStatic[i] * 95) + 32);
        const m = F(intensity * _nightNoise[i]);
        const im = F(1 - m);
        r1 = F(F(im * r0) + F(m * s));
        g1 = F(F(im * g0) + F(m * s));
        b1 = F(F(im * b0) + F(m * s));
      }
      const lum = F(F(F(0.299 * r1) + F(0.587 * g1)) + F(0.114 * b1));
      let nr = F(F(r1 * ENHANCE) + F(F(1 - ENHANCE) * lum));
      let ng = F(F(g1 * ENHANCE) + F(F(1 - ENHANCE) * lum));
      let nb = F(F(b1 * ENHANCE) + F(F(1 - ENHANCE) * lum));
      nr = F(F(0.5 * nr) + F(0.5 * NIGHT_TINT[0]));
      ng = F(F(0.5 * ng) + F(0.5 * NIGHT_TINT[1]));
      nb = F(F(0.5 * nb) + F(0.5 * NIGHT_TINT[2]));
      _mapPx[o] = F(F(daylight * r0) + F(inv * nr));
      _mapPx[o + 1] = F(F(daylight * g0) + F(inv * ng));
      _mapPx[o + 2] = F(F(daylight * b0) + F(inv * nb));
    }
  }

  // --- sleep --------------------------------------------------------------
  if (st.isSleeping[0]) {
    const n = RENDER_W * RENDER_MAP_H;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      const lum = F(F(F(0.299 * _mapPx[o]) + F(0.587 * _mapPx[o + 1])) + F(0.114 * _mapPx[o + 2]));
      _mapPx[o] = F(F(0.5 * lum) + F(0.5 * SLEEP_TINT[0]));
      _mapPx[o + 1] = F(F(0.5 * lum) + F(0.5 * SLEEP_TINT[1]));
      _mapPx[o + 2] = F(F(0.5 * lum) + F(0.5 * SLEEP_TINT[2]));
    }
  }

  _upload(_mapPx, _mapBmp, RENDER_W, RENDER_MAP_H, 0, 0);

  // --- inventory ----------------------------------------------------------
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
    // Icon: Craftax selects the empty (black) texture unless the count is > 0.
    if (n > 0) _putIcon(key, col, row);
    // Digit: Craftax always indexes number_textures[n], a 10-entry table
    // (blank, then 1..9), with JAX's indexing rules — above 9 clamps to 9,
    // and a NEGATIVE index counts from the end, so -5 draws the digit 5.
    // Negative only happens on the death frame: health is int8 and the C
    // does not clamp it (min 1 - 7 = -6). Craftax itself never has negative
    // health, so this is its renderer's behaviour on our state, reproduced
    // so the terminal frame matches too.
    let d = n > 9 ? 9 : n;
    if (d < 0) d += 10;
    if (d <= 0) continue;              // the blank entry
    _putDigit(d, col, row);
  }
  _upload(_invPx, _invBmp, RENDER_W, RENDER_INV_H, 0, RENDER_MAP_H);
}

// ---- src/85_obs_symbolic.js ----
// 85_obs_symbolic.js — the 1345-float symbolic observation.
//
// compute_observations, craftax_classic.h lines 878-917. This is the
// Craftax-Classic-Symbolic-v1 layout, which the C's own header says it
// matches exactly:
//
//   63 tiles (a 7x9 window, dr -3..3 by dc -4..4)
//      x 21 channels (17 block one-hot + zombie/cow/skeleton/arrow)  = 1323
//   12 inventory / 10                                               =   12
//    4 intrinsics (health, food, drink, energy) / 10                =    4
//    4 direction one-hot (player_dir 1..4)                          =    4
//    1 light level                                                  =    1
//    1 is_sleeping                                                  =    1
//                                                                     ----
//                                                                     1345
//
// Two details that are easy to get wrong and are what the gate checks:
//
//   Out of bounds is BLK_OUT_OF_BOUNDS (1), a real one-hot channel, not a
//   zero vector. Only a block id outside 0..16 produces all zeros, which
//   cannot happen here.
//
//   The mob flags come from the per-type bitmaps, NOT from mob_bits, and an
//   out-of-range cell reads 0 for all four rather than inheriting the row.
//
// The /10 scalings are float32 multiplies by 0.1f, wrapped in F() like
// everything else. Worth knowing if you mutation-test this file: dropping the
// F() here does NOT fail the gate. Over the 256 int8 values, F(n * F(0.1))
// and F(n * 0.1) differ for 48 of them, but all of those have |n| >= 67 —
// inventory is clamped to 0..9 and the lowest health anywhere in the corpus
// is -3, so the game never reaches a value where the two disagree. The F()
// stays because health is an unclamped int8 and a large negative is
// representable, not because a test would catch its absence today.

const OBS_DIM_SYMBOLIC = 1345;

// Allocated once. getObservation() overwrites it in place and the caller is
// expected to read or copy it before the next step, which is how the hosts
// use the frame buffer too.
const _obsSymbolic = new Float32Array(OBS_DIM_SYMBOLIC);

// Named for the state it reads. 90_playtrain.js wraps this as the no-arg
// getObservation() the host contract expects (PLAN 3.6).
function computeSymbolicObs(st) {
  const obs = _obsSymbolic;
  const pr = st.playerR[0];
  const pc = st.playerC[0];
  let idx = 0;

  for (let dr = -3; dr <= 3; dr++) {
    const r = pr + dr;
    const rowOk = (r >>> 0) < MAP_SIZE;
    for (let dc = -4; dc <= 4; dc++) {
      const c = pc + dc;
      const inView = rowOk && (c >>> 0) < MAP_SIZE;
      const blk = inView ? mapGet(st, r, c) : BLK_OUT_OF_BOUNDS;
      for (let b = 0; b < NUM_BLOCK_TYPES; b++) obs[idx + b] = 0.0;
      if ((blk >>> 0) < NUM_BLOCK_TYPES) obs[idx + blk] = 1.0;
      idx += NUM_BLOCK_TYPES;
      obs[idx++] = inView && mbGet(st.zombieBits, r, c) ? 1.0 : 0.0;
      obs[idx++] = inView && mbGet(st.cowBits, r, c) ? 1.0 : 0.0;
      obs[idx++] = inView && mbGet(st.skelBits, r, c) ? 1.0 : 0.0;
      obs[idx++] = inView && mbGet(st.arrowBits, r, c) ? 1.0 : 0.0;
    }
  }

  for (let i = 0; i < NUM_INVENTORY; i++) obs[idx++] = F(st.inv[i] * F(0.1));
  obs[idx++] = F(st.health[0] * F(0.1));
  obs[idx++] = F(st.food[0] * F(0.1));
  obs[idx++] = F(st.drink[0] * F(0.1));
  obs[idx++] = F(st.energy[0] * F(0.1));
  for (let d = 1; d <= 4; d++) obs[idx++] = st.playerDir[0] === d ? 1.0 : 0.0;
  obs[idx++] = st.lightLevel[0];
  obs[idx++] = st.isSleeping[0] ? 1.0 : 0.0;

  return obs;
}

// ---- src/90_playtrain.js ----
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
