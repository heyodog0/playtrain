// threefry2x32.js — JAX's threefry-2x32 block function, PRNGKey, split and 32-bit
// random bits, bit for bit, for every game whose reference draws from jax.random.
//
// Users: parity/craftax_classic (night static via threefryUniformF32, the
// per-step state_rng via split) and parity/chip8 (CXNN: split + randint uint8).
//
// What is mirrored, from jax/_src/prng.py with `jax_threefry_partitionable=True`
// (the default since jax 0.5; checked against 0.11.1 for craftax and 0.6.2 for
// chip8's oracle, identical bits):
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
//   * split (`_threefry_split_foldlike`): output key j is the two words of
//     threefry(key, counter (0, j)).
//
// Pure uint32 work: `>>> 0` after every add, no BigInt, so V8 and QuickJS agree.

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

// jax.random.PRNGKey(seed) for a 32-bit seed: `_threefry_seed` puts the
// seed's high 32 bits in the first word and the low 32 in the second, so a
// seed below 2^32 is [0, seed].
function threefryPRNGKey(seed) {
  return [0, seed >>> 0];
}

// jax.random.split(key) under the partitionable layout
// (`_threefry_split_foldlike`): output key j is the two words of
// threefry(key, counter (0, j)). Writes [a0, a1, b0, b1] into out, where
// [a0, a1] is split(key)[0] and [b0, b1] is split(key)[1].
function threefrySplit(k0, k1, out) {
  _threefry2x32(k0, k1, 0, 0);
  out[0] = _tfOut[0]; out[1] = _tfOut[1];
  _threefry2x32(k0, k1, 0, 1);
  out[2] = _tfOut[0]; out[3] = _tfOut[1];
  return out;
}
