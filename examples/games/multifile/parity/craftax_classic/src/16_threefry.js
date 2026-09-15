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

// Craftax's state_rng for one step, from the DRIVER's key.
//
// JAX cannot branch control flow on values, so craftax_step performs the same
// number of splits every step whatever the action or the world. Measured
// (reference/craftax_pixels/README.md): state_rng after a step is the second
// output of the fifth `rng, _rng = split(rng)` starting from the key the
// driver passed to that step, and the driver's own pattern is
// `dk, sk = split(dk)` once per step. So the whole chain is
//
//   dk, sk = split(dk); rng = sk
//   repeat 5: rng, sub = split(rng)
//   state_rng = sub
//
// `dk` holds the driver key [d0, d1] and is advanced in place; the step's
// state_rng is written into `out` (two words).
const _splitTmp = new Uint32Array(4);

function craftaxStateRng(dk, out) {
  threefrySplit(dk[0], dk[1], _splitTmp);
  dk[0] = _splitTmp[0]; dk[1] = _splitTmp[1];          // dk = split(dk)[0]
  let r0 = _splitTmp[2], r1 = _splitTmp[3];             // rng = split(dk)[1]
  for (let i = 0; i < 5; i++) {
    threefrySplit(r0, r1, _splitTmp);
    r0 = _splitTmp[0]; r1 = _splitTmp[1];
    out[0] = _splitTmp[2]; out[1] = _splitTmp[3];
  }
  return out;
}
