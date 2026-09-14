// 60_world_tick.js — update_plants, update_intrinsics, and the light level.
//
// craftax_classic.h lines 844-876, plus the light calculation that lives
// inline in puf_step (lines 983-985) and is kept here because it is the
// other half of the day cycle.
//
// The intrinsics accumulators move by +/-0.5, 1 and 2, all dyadic, so they
// are exact in float32 and in double alike. They are still wrapped in F()
// because the rule is uniform and because a future change to one of those
// constants should not silently start relying on double precision.

// --- update_plants, lines 844-855 -----------------------------------------

function updatePlants(st) {
  for (let i = 0; i < MAX_PLANTS; i++) {
    if (!st.plantMask[i]) continue;
    st.plantAge[i]++;
    if (st.plantAge[i] >= 600) {
      const r = st.plantR[i], c = st.plantC[i];
      // Only ripens if the cell is still a plant: the player can have mined
      // or built over it, and the slot stays live either way.
      if (inBounds(r, c) && mapGet(st, r, c) === BLK_PLANT) {
        mapSet(st, r, c, BLK_RIPE_PLANT);
      }
    }
  }
}

// --- update_intrinsics, lines 856-876 -------------------------------------
// Takes the RAW action, not the sleep-masked effective one. That is what
// lets ACT_SLEEP start a sleep while every other action is suppressed.

function updateIntrinsics(st, action) {
  if (action === ACT_SLEEP && st.energy[0] < 9) st.isSleeping[0] = 1;
  if (st.energy[0] >= 9 && st.isSleeping[0]) {
    st.isSleeping[0] = 0;
    st.achievements[ACH_WAKE_UP] = 1;
  }
  const mul = st.isSleeping[0] ? F(0.5) : F(1.0);

  st.hunger[0] = F(st.hunger[0] + mul);
  if (st.hunger[0] > F(25.0)) { st.food[0]--; st.hunger[0] = 0; }

  st.thirst[0] = F(st.thirst[0] + mul);
  if (st.thirst[0] > F(20.0)) { st.drink[0]--; st.thirst[0] = 0; }

  if (st.isSleeping[0]) st.fatigue[0] = F(st.fatigue[0] - F(1.0));
  else st.fatigue[0] = F(st.fatigue[0] + F(1.0));
  if (st.fatigue[0] > F(30.0)) { st.energy[0]--; st.fatigue[0] = 0; }
  if (st.fatigue[0] < F(-10.0)) {
    // Sleeping is the only way energy comes back.
    st.energy[0] = crMinI(st.energy[0] + 1, 9);
    st.fatigue[0] = 0;
  }

  const ok = (st.food[0] > 0) && (st.drink[0] > 0) && (st.energy[0] > 0 || st.isSleeping[0]);
  if (ok) st.recover[0] = F(st.recover[0] + (st.isSleeping[0] ? F(2.0) : F(1.0)));
  else st.recover[0] = F(st.recover[0] + (st.isSleeping[0] ? F(-0.5) : F(-1.0)));
  if (st.recover[0] > F(25.0)) {
    st.recover[0] = 0;
    st.health[0] = crMinI(st.health[0] + 1, 9);
  }
  if (st.recover[0] < F(-15.0)) { st.health[0]--; st.recover[0] = 0; }
}

// --- light level, puf_step lines 983-985 ----------------------------------
// light = 1 - |cos(pi * (fmod(t/300, 1) + 0.3))|^3
//
// The second cosf in the game, and the other place the V8 ieee754 binding
// matters. Note this is NOT periodic in float32: (float)t/300 rounds
// differently for each t, so a 300-entry table would be wrong.

function computeLightLevel(timestep) {
  const tFrac = F(F(F(F(timestep) / F(DAY_LENGTH)) % F(1.0)) + F(0.3));
  const cv = F(Math.cos(F(PI_F * tFrac)));
  return F(F(1.0) - Math.abs(F(F(cv * cv) * cv)));
}
