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
