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
