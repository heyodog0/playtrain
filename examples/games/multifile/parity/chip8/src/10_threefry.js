// ---- JAX threefry2x32: split + randint(0, 256, uint8), for CXNN ----
// Octax draws CXNN as `key, subkey = split(state.rng); randint(subkey, (), 0, 256, uint8)`
// (octax/instructions/memory.py execute_random). Mirrored from jax 0.6.2 with
// jax_threefry_partitionable=True (the default since 0.5, and what the oracle venv runs):
//   * split (prng.py _threefry_split_foldlike): output key j = threefry(key, counter (0, j));
//   * bits (prng.py _threefry_random_bits_partitionable): scalar shape -> counter (0, 0),
//     the two output words XORed, truncated to the dtype;
//   * randint (random.py _randint) with maxval 256 out of range for uint8: span wraps to 0,
//     XLA's rem-by-zero returns the dividend, the multiplier becomes 0, and the result is
//     `lower_bits` alone, i.e. the low 8 bits of bits(split(subkey)[1]).
// Block function copied from ../craftax_classic/src/16_threefry.js (U03 moves the shared
// core to ../../common/). Pure uint32: `>>> 0` after every add, no BigInt.

const C8_THREEFRY_C240 = 0x1BD11BDA;

function c8Rotl32(x, r) {
  return ((x << r) | (x >>> (32 - r))) >>> 0;
}

const c8TfOut = new Uint32Array(2);

// Threefry-2x32, 20 rounds, of counter (x0, x1) under key (k0, k1). Result in c8TfOut.
function c8Threefry2x32(k0, k1, x0, x1) {
  const ks0 = k0 >>> 0, ks1 = k1 >>> 0;
  const ks2 = (ks0 ^ ks1 ^ C8_THREEFRY_C240) >>> 0;
  let v0 = (x0 + ks0) >>> 0;
  let v1 = (x1 + ks1) >>> 0;

  v0 = (v0 + v1) >>> 0; v1 = c8Rotl32(v1, 13); v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + v1) >>> 0; v1 = c8Rotl32(v1, 15); v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + v1) >>> 0; v1 = c8Rotl32(v1, 26); v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + v1) >>> 0; v1 = c8Rotl32(v1, 6);  v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + ks1) >>> 0; v1 = (v1 + ks2 + 1) >>> 0;

  v0 = (v0 + v1) >>> 0; v1 = c8Rotl32(v1, 17); v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + v1) >>> 0; v1 = c8Rotl32(v1, 29); v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + v1) >>> 0; v1 = c8Rotl32(v1, 16); v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + v1) >>> 0; v1 = c8Rotl32(v1, 24); v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + ks2) >>> 0; v1 = (v1 + ks0 + 2) >>> 0;

  v0 = (v0 + v1) >>> 0; v1 = c8Rotl32(v1, 13); v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + v1) >>> 0; v1 = c8Rotl32(v1, 15); v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + v1) >>> 0; v1 = c8Rotl32(v1, 26); v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + v1) >>> 0; v1 = c8Rotl32(v1, 6);  v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + ks0) >>> 0; v1 = (v1 + ks1 + 3) >>> 0;

  v0 = (v0 + v1) >>> 0; v1 = c8Rotl32(v1, 17); v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + v1) >>> 0; v1 = c8Rotl32(v1, 29); v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + v1) >>> 0; v1 = c8Rotl32(v1, 16); v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + v1) >>> 0; v1 = c8Rotl32(v1, 24); v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + ks1) >>> 0; v1 = (v1 + ks2 + 4) >>> 0;

  v0 = (v0 + v1) >>> 0; v1 = c8Rotl32(v1, 13); v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + v1) >>> 0; v1 = c8Rotl32(v1, 15); v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + v1) >>> 0; v1 = c8Rotl32(v1, 26); v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + v1) >>> 0; v1 = c8Rotl32(v1, 6);  v1 = (v0 ^ v1) >>> 0;
  v0 = (v0 + ks2) >>> 0; v1 = (v1 + ks0 + 5) >>> 0;

  c8TfOut[0] = v0;
  c8TfOut[1] = v1;
}

// jax.random.split(key) -> [a0, a1, b0, b1] written into out (foldlike layout).
function c8ThreefrySplit(k0, k1, out) {
  c8Threefry2x32(k0, k1, 0, 0);
  out[0] = c8TfOut[0]; out[1] = c8TfOut[1];
  c8Threefry2x32(k0, k1, 0, 1);
  out[2] = c8TfOut[0]; out[3] = c8TfOut[1];
  return out;
}

// jax.random.bits(key, (), uint32): counter (0, 0), words XORed.
function c8ThreefryBits32(k0, k1) {
  c8Threefry2x32(k0, k1, 0, 0);
  return (c8TfOut[0] ^ c8TfOut[1]) >>> 0;
}

const c8SplitTmp = new Uint32Array(4);

// jax.random.randint(key, (), 0, 256, uint8): the low byte of bits(split(key)[1]).
function c8Randint8(k0, k1) {
  c8ThreefrySplit(k0, k1, c8SplitTmp);
  return c8ThreefryBits32(c8SplitTmp[2], c8SplitTmp[3]) & 0xFF;
}

// jax.random.PRNGKey(seed) for a seed below 2^32 is [0, seed].
function c8PRNGKey(seed) {
  return [0, seed >>> 0];
}
