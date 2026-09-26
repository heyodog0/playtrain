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
