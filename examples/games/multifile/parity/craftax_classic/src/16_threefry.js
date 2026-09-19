// 16_threefry.js — jax.random.uniform and Craftax's per-step state_rng, on the
// shared threefry core in ../../common/threefry2x32.js (block function, PRNGKey,
// split, 32-bit bits).
//
// This is NOT the game's RNG. The dynamics use the PCG in common/rng_pcg32.js,
// which mirrors PufferLib's C. This file exists because Craftax draws its
// per-pixel night static with `jax.random.uniform(state.state_rng, (49, 63))`,
// and reproducing that frame means reproducing JAX's generator bit for bit,
// given the same key. It is stateless: same key, same bits, every call.
//
// uniform (`_uniform`): the top 23 random bits become the mantissa of a float32
// with exponent 0, i.e. `(bits >>> 9) | 0x3f800000`, bitcast to a float in
// [1, 2), minus 1. With minval 0 and maxval 1 the trailing
// `floats * (max - min) + min` and `max(min, ...)` are identities.

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
