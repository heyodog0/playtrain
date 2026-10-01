// ---- CXNN's random byte: jax.random.randint(subkey, (), 0, 256, uint8) ----
// Octax draws CXNN as `key, subkey = split(state.rng); randint(subkey, (), 0, 256, uint8)`
// (octax/instructions/memory.py execute_random). The threefry block function, PRNGKey,
// split and 32-bit bits are the shared ../../common/threefry2x32.js (bundled before this
// file). Mirrored from jax 0.6.2, jax_threefry_partitionable=True (the oracle venv):
//   * bits (prng.py _threefry_random_bits_partitionable): scalar shape -> counter (0, 0),
//     the two output words XORed, truncated to the dtype;
//   * randint (random.py _randint) with maxval 256 out of range for uint8: span wraps to 0,
//     XLA's rem-by-zero returns the dividend, the multiplier becomes 0, and the result is
//     `lower_bits` alone, i.e. the low 8 bits of bits(split(subkey)[1]).
// Checked: G1 (11 CXNN vectors from Octax's tests) and G2 (10k keys, tests/test_threefry.py).

const c8SplitTmp = new Uint32Array(4);

// jax.random.bits(key, (), uint32): counter (0, 0), words XORed.
function c8ThreefryBits32(k0, k1) {
  return threefryRandomBits32(k0, k1, 0);
}

// jax.random.randint(key, (), 0, 256, uint8): the low byte of bits(split(key)[1]).
function c8Randint8(k0, k1) {
  threefrySplit(k0, k1, c8SplitTmp);
  return c8ThreefryBits32(c8SplitTmp[2], c8SplitTmp[3]) & 0xFF;
}
