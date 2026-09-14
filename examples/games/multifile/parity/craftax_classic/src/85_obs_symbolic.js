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

function getObservation(st) {
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
