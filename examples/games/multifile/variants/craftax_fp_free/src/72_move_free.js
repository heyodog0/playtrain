// 72_move_free.js — the one thing that makes this a different game.
//
// craftax_fp is Craftax-Classic with a first-person camera and NOTHING else
// changed: it reuses the dynamics by manifest path and a gate proves 49,061
// steps of byte-identical state. That costs it a control scheme. Craftax's
// `movePlayer` does `st.playerDir[0] = action` unconditionally before it
// moves, so every direction action is a turn AND a move: you cannot turn in
// place, and you cannot walk backwards while still watching what is in front
// of you. For an agent looking at a top-down tile view that is fine. For a
// human in a first-person view it is the whole feel of the game.
//
// So this variant ADDS six actions. It does not change any of the seventeen
// that were already there, and that is gated: stepped over the whole committed
// corpus, whose actions are all in 0..16, this game produces the same 6,880
// byte canonical state as craftax_classic, every step. The new actions are
// strictly additional.
//
// WHAT THAT COSTS. The dynamics are no longer Craftax's, because the action
// space is not Craftax's. An agent trained here is not comparable to one
// trained on craftax_classic, and this game must never be described as a
// parity port. It is Craftax-DERIVED. craftax_fp next door keeps the exact
// claim; this one is the playable sibling.

// Six new action indices, appended after Craftax's sixteen.
const ACT_MOVE_FORWARD = 17;
const ACT_MOVE_BACK = 18;
const ACT_STRAFE_LEFT = 19;
const ACT_STRAFE_RIGHT = 20;
const ACT_TURN_LEFT = 21;
const ACT_TURN_RIGHT = 22;
const NUM_ACTIONS_FREE = 23;

// Facing (1 west, 2 east, 3 north, 4 south) -> the facing a quarter turn away.
// Entry 0 is unreachable and mirrors north so a corrupt value cannot index off
// the end, the same convention the renderer's FP_YAW uses.
const TURN_L = [3, 4, 3, 1, 2];
const TURN_R = [3, 3, 4, 2, 1];

// Try to step to (nr, nc) under Craftax's OWN guards, in Craftax's order:
// bounds, then solid, then occupied. Facing is untouched — that is the whole
// point. Returns nothing; refusing to move is silent, exactly as upstream.
function _freeStepTo(st, nr, nc) {
  if (!inBounds(nr, nc)) return;
  if (isSolid(mapGet(st, nr, nc))) return;
  if (hasMobAt(st, nr, nc)) return;
  st.playerR[0] = nr;
  st.playerC[0] = nc;
}

// movePlayer, extended. Actions 1..4 fall through to Craftax's own function
// untouched, so their behaviour is upstream's by construction rather than by
// a copy that could drift.
function movePlayerFree(st, action) {
  if (action >= 1 && action <= 4) {
    movePlayer(st, action);
    return;
  }
  if (action === ACT_TURN_LEFT) { st.playerDir[0] = TURN_L[st.playerDir[0]]; return; }
  if (action === ACT_TURN_RIGHT) { st.playerDir[0] = TURN_R[st.playerDir[0]]; return; }

  // The four translations. Each resolves to one of Craftax's own direction
  // vectors, so a step is always exactly one cell on the grid.
  let dir = 0;
  if (action === ACT_MOVE_FORWARD) dir = st.playerDir[0];
  else if (action === ACT_MOVE_BACK) dir = TURN_L[TURN_L[st.playerDir[0]]];
  else if (action === ACT_STRAFE_LEFT) dir = TURN_L[st.playerDir[0]];
  else if (action === ACT_STRAFE_RIGHT) dir = TURN_R[st.playerDir[0]];
  else return;
  if (dir < 1 || dir > 4) return;
  _freeStepTo(st, st.playerR[0] + DIR_DR[dir], st.playerC[0] + DIR_DC[dir]);
}

// stepGame, overridden.
//
// The bundle is a plain concatenation and these are function DECLARATIONS, so
// this one replaces the definition in 70_step.js for every later call — and
// `stepGame` is looked up by name at call time, so the hosts get this one.
// That is deliberate and it is why this file must be listed AFTER 70_step.js
// in the manifest.
//
// The body is 70_step.js's, and must stay so. Exactly two lines differ:
// the clamp bound (NUM_ACTIONS_FREE, or every new action would be pinned to
// 16) and the mover. The call ORDER is untouched, because it is the
// specification: anything reordered changes which draws the RNG sees and
// therefore the whole episode.
function stepGame(st, action) {
  if (action < 0) action = 0;
  if (action >= NUM_ACTIONS_FREE) action = NUM_ACTIONS_FREE - 1;

  const oldHealth = st.health[0];
  _oldAchievements.set(st.achievements);

  const effAction = st.isSleeping[0] ? ACT_NOOP : action;
  doCrafting(st, effAction);
  if (effAction === ACT_DO) doAction(st);
  if (effAction >= ACT_PLACE_STONE && effAction <= ACT_PLACE_PLANT) placeBlock(st, effAction);
  movePlayerFree(st, effAction);
  updateMobs(st);
  spawnMobs(st);
  updatePlants(st);
  updateIntrinsics(st, action);

  for (let i = 0; i < NUM_INVENTORY; i++) {
    st.inv[i] = crClampI(st.inv[i], 0, 9);
  }

  st.timestep[0]++;
  st.lightLevel[0] = computeLightLevel(st.timestep[0]);

  let achR = F(0.0);
  for (let i = 0; i < NUM_ACHIEVEMENTS; i++) {
    achR = F(achR + ((st.achievements[i] && !_oldAchievements[i]) ? 1.0 : 0.0));
  }
  const hpR = F(F(st.health[0] - oldHealth) * F(0.1));
  const r = F(achR + hpR);
  st.score[0] = F(st.score[0] + r);
  st.episodeLength[0] += 1;

  let done = (st.timestep[0] >= MAX_TIMESTEPS) || (st.health[0] <= 0);
  if (inBounds(st.playerR[0], st.playerC[0])
      && mapGet(st, st.playerR[0], st.playerC[0]) === BLK_LAVA) {
    done = true;
  }

  return { reward: r, done: done };
}
