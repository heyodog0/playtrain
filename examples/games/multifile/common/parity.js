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
