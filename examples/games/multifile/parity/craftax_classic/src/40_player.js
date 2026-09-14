// 40_player.js — the player's half of a step.
//
// do_crafting, do_action, place_block, move_player and their helpers, from
// craftax_classic.h lines 243-644. Function for function, branch for branch,
// and — the part that matters most — draw for draw: do_action takes one
// cr_rf when the facing block is grass, and only then, so any reordering of
// the switch would shift the whole RNG stream.
//
// All integer work. The int8 fields wrap through their Int8Array views the
// way the C's int8_t does, which is why nothing here masks by hand.

// --- helpers, lines 243-288 ----------------------------------------------

function isSolid(b) {
  return b === BLK_WATER || b === BLK_STONE || b === BLK_TREE ||
         b === BLK_COAL || b === BLK_IRON || b === BLK_DIAMOND ||
         b === BLK_TABLE || b === BLK_FURNACE ||
         b === BLK_PLANT || b === BLK_RIPE_PLANT;
}

function l1Dist(r1, c1, r2, c2) {
  let dr = r1 - r2; if (dr < 0) dr = -dr;
  let dc = c1 - c2; if (dc < 0) dc = -dc;
  return dr + dc;
}

function crClampI(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function crMinI(a, b) { return a < b ? a : b; }
function crMaxI(a, b) { return a > b ? a : b; }
function crMinF(a, b) { return a < b ? a : b; }
function crSignI(v) { return (v > 0 ? 1 : 0) - (v < 0 ? 1 : 0); }

function hasMobAt(st, r, c) {
  if ((r >>> 0) >= MAP_SIZE || (c >>> 0) >= MAP_SIZE) return false;
  return mbGet(st.mobBits, r, c) !== 0;
}

// The 8 neighbours, in the C's order. Order is immaterial to the result —
// it returns on the first hit — but keeping it makes the two diffable.
const NEAR_DR8 = [0, 0, -1, 1, -1, -1, 1, 1];
const NEAR_DC8 = [-1, 1, 0, 0, -1, 1, -1, 1];

function isNearBlock(st, blk) {
  const pr = st.playerR[0];
  const pc = st.playerC[0];
  for (let i = 0; i < 8; i++) {
    const nr = pr + NEAR_DR8[i];
    const nc = pc + NEAR_DC8[i];
    if (inBounds(nr, nc) && mapGet(st, nr, nc) === blk) return true;
  }
  return false;
}

function getDamage(st) {
  if (st.inv[INV_ISWORD] > 0) return 5;
  if (st.inv[INV_SSWORD] > 0) return 3;
  if (st.inv[INV_WSWORD] > 0) return 2;
  return 1;
}

// --- do_crafting, lines 502-515 -------------------------------------------
// Note the C tests every recipe with a separate `if`, not else-if. Two
// recipes can never both match one action, so this is only a shape
// difference, but it is kept as written.

function doCrafting(st, action) {
  const inv = st.inv;
  const t = isNearBlock(st, BLK_TABLE);
  const f = isNearBlock(st, BLK_FURNACE);
  if (action === ACT_MAKE_WOOD_PICK && t && inv[0] >= 1) {
    inv[0]--; inv[6]++; st.achievements[ACH_MAKE_WOOD_PICK] = 1;
  }
  if (action === ACT_MAKE_STONE_PICK && t && inv[0] >= 1 && inv[1] >= 1) {
    inv[0]--; inv[1]--; inv[7]++; st.achievements[ACH_MAKE_STONE_PICK] = 1;
  }
  if (action === ACT_MAKE_IRON_PICK && t && f && inv[0] >= 1 && inv[1] >= 1 && inv[3] >= 1 && inv[2] >= 1) {
    inv[0]--; inv[1]--; inv[3]--; inv[2]--; inv[8]++; st.achievements[ACH_MAKE_IRON_PICK] = 1;
  }
  if (action === ACT_MAKE_WOOD_SWORD && t && inv[0] >= 1) {
    inv[0]--; inv[9]++; st.achievements[ACH_MAKE_WOOD_SWORD] = 1;
  }
  if (action === ACT_MAKE_STONE_SWORD && t && inv[0] >= 1 && inv[1] >= 1) {
    inv[0]--; inv[1]--; inv[10]++; st.achievements[ACH_MAKE_STONE_SWORD] = 1;
  }
  if (action === ACT_MAKE_IRON_SWORD && t && f && inv[0] >= 1 && inv[1] >= 1 && inv[3] >= 1 && inv[2] >= 1) {
    inv[0]--; inv[1]--; inv[3]--; inv[2]--; inv[11]++; st.achievements[ACH_MAKE_IRON_SWORD] = 1;
  }
}

// --- do_action, lines 517-605 ---------------------------------------------

function doAction(st) {
  const dir = st.playerDir[0];
  const tr = st.playerR[0] + DIR_DR[dir];
  const tc = st.playerC[0] + DIR_DC[dir];
  if (!inBounds(tr, tc)) return;
  const dmg = getDamage(st);
  let attacked = false;

  // Slot order matters: the first matching slot is the one that takes the
  // hit, and spawns fill the first free slot, so the pairing is stable.
  for (let i = 0; i < MAX_ZOMBIES && !attacked; i++) {
    if (st.zombieMask[i] && st.zombieR[i] === tr && st.zombieC[i] === tc) {
      st.zombieHp[i] -= dmg;
      if (st.zombieHp[i] <= 0) {
        st.zombieMask[i] = 0;
        mbClear(st.mobBits, tr, tc); mbClear(st.zombieBits, tr, tc);
        st.achievements[ACH_DEFEAT_ZOMBIE] = 1;
      }
      attacked = true;
    }
  }
  for (let i = 0; i < MAX_COWS && !attacked; i++) {
    if (st.cowMask[i] && st.cowR[i] === tr && st.cowC[i] === tc) {
      st.cowHp[i] -= dmg;
      if (st.cowHp[i] <= 0) {
        st.cowMask[i] = 0;
        mbClear(st.mobBits, tr, tc); mbClear(st.cowBits, tr, tc);
        st.achievements[ACH_EAT_COW] = 1;
        st.food[0] = crMinI(9, st.food[0] + 6);
        st.hunger[0] = 0;
      }
      attacked = true;
    }
  }
  for (let i = 0; i < MAX_SKELETONS && !attacked; i++) {
    if (st.skelMask[i] && st.skelR[i] === tr && st.skelC[i] === tc) {
      st.skelHp[i] -= dmg;
      if (st.skelHp[i] <= 0) {
        st.skelMask[i] = 0;
        mbClear(st.mobBits, tr, tc); mbClear(st.skelBits, tr, tc);
        st.achievements[ACH_DEFEAT_SKELETON] = 1;
      }
      attacked = true;
    }
  }
  if (attacked) return;

  const blk = mapGet(st, tr, tc);
  switch (blk) {
    case BLK_TREE:
      mapSet(st, tr, tc, BLK_GRASS);
      st.inv[0] = crMinI(9, st.inv[0] + 1);
      st.achievements[ACH_COLLECT_WOOD] = 1;
      break;
    case BLK_STONE:
      if (st.inv[6] > 0 || st.inv[7] > 0 || st.inv[8] > 0) {
        mapSet(st, tr, tc, BLK_PATH);
        st.inv[1] = crMinI(9, st.inv[1] + 1);
        st.achievements[ACH_COLLECT_STONE] = 1;
      }
      break;
    case BLK_COAL:
      if (st.inv[6] > 0 || st.inv[7] > 0 || st.inv[8] > 0) {
        mapSet(st, tr, tc, BLK_PATH);
        st.inv[2] = crMinI(9, st.inv[2] + 1);
        st.achievements[ACH_COLLECT_COAL] = 1;
      }
      break;
    case BLK_IRON:
      if (st.inv[7] > 0 || st.inv[8] > 0) {
        mapSet(st, tr, tc, BLK_PATH);
        st.inv[3] = crMinI(9, st.inv[3] + 1);
        st.achievements[ACH_COLLECT_IRON] = 1;
      }
      break;
    case BLK_DIAMOND:
      if (st.inv[8] > 0) {
        mapSet(st, tr, tc, BLK_PATH);
        st.inv[4] = crMinI(9, st.inv[4] + 1);
        st.achievements[ACH_COLLECT_DIAMOND] = 1;
      }
      break;
    case BLK_GRASS:
      // The one RNG draw in the player half. It happens whenever the facing
      // block is grass and no mob was attacked, whether or not a sapling
      // results, so the stream position depends on where the player looks.
      if (crRf(st.pcg) < F(0.1)) {
        st.inv[5] = crMinI(9, st.inv[5] + 1);
        st.achievements[ACH_COLLECT_SAPLING] = 1;
      }
      break;
    case BLK_WATER:
      st.drink[0] = crMinI(9, st.drink[0] + 1);
      st.thirst[0] = 0;
      st.achievements[ACH_COLLECT_DRINK] = 1;
      break;
    case BLK_RIPE_PLANT:
      mapSet(st, tr, tc, BLK_PLANT);
      st.food[0] = crMinI(9, st.food[0] + 4);
      st.hunger[0] = 0;
      st.achievements[ACH_EAT_PLANT] = 1;
      for (let i = 0; i < MAX_PLANTS; i++) {
        if (st.plantMask[i] && st.plantR[i] === tr && st.plantC[i] === tc) {
          st.plantAge[i] = 0;
          break;
        }
      }
      break;
    default:
      break;
  }
}

// --- place_block, lines 607-632 -------------------------------------------

function placeBlock(st, action) {
  const dir = st.playerDir[0];
  const tr = st.playerR[0] + DIR_DR[dir];
  const tc = st.playerC[0] + DIR_DC[dir];
  if (!inBounds(tr, tc)) return;
  if (hasMobAt(st, tr, tc)) return;
  const blk = mapGet(st, tr, tc);
  const inv = st.inv;
  if (action === ACT_PLACE_TABLE && inv[0] >= 2 && !isSolid(blk)) {
    mapSet(st, tr, tc, BLK_TABLE);
    inv[0] -= 2;
    st.achievements[ACH_PLACE_TABLE] = 1;
  } else if (action === ACT_PLACE_FURNACE && inv[1] >= 1 && !isSolid(blk)) {
    mapSet(st, tr, tc, BLK_FURNACE);
    inv[1] -= 1;
    st.achievements[ACH_PLACE_FURNACE] = 1;
  } else if (action === ACT_PLACE_STONE && inv[1] >= 1 && (!isSolid(blk) || blk === BLK_WATER)) {
    // The only place_block branch that overwrites a solid block: stone can
    // be dropped into water.
    mapSet(st, tr, tc, BLK_STONE);
    inv[1] -= 1;
    st.achievements[ACH_PLACE_STONE] = 1;
  } else if (action === ACT_PLACE_PLANT && inv[5] >= 1 && blk === BLK_GRASS) {
    mapSet(st, tr, tc, BLK_PLANT);
    inv[5] -= 1;
    st.achievements[ACH_PLACE_PLANT] = 1;
    for (let i = 0; i < MAX_PLANTS; i++) {
      if (!st.plantMask[i]) {
        st.plantR[i] = tr;
        st.plantC[i] = tc;
        st.plantAge[i] = 0;
        st.plantMask[i] = 1;
        break;
      }
    }
  }
}

// --- move_player, lines 634-643 -------------------------------------------

function movePlayer(st, action) {
  if (action < 1 || action > 4) return;
  const nr = st.playerR[0] + DIR_DR[action];
  const nc = st.playerC[0] + DIR_DC[action];
  // Facing changes even when the move is refused. That is how the player
  // turns to face a solid block or a mob in order to act on it.
  st.playerDir[0] = action;
  if (!inBounds(nr, nc)) return;
  if (isSolid(mapGet(st, nr, nc))) return;
  if (hasMobAt(st, nr, nc)) return;
  st.playerR[0] = nr;
  st.playerC[0] = nc;
}
