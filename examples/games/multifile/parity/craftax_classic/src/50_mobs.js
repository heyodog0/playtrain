// 50_mobs.js — update_mobs, try_spawn, spawn_mobs, can_move_mob.
//
// craftax_classic.h lines 645-842. The RNG call order here is the most
// delicate part of the port: zombies, cows, skeletons and arrows are updated
// in that order, each mob draws a variable number of values depending on
// branches taken, and spawn_mobs draws again. A single misplaced draw shifts
// every later mob decision and every worldgen-independent roll for the rest
// of the episode.
//
// The bitmaps are state, not a cache: has_mob_at and can_move_mob read them,
// so every move must clear the old cell and set the new one in both the
// combined mob_bits and the per-type map, exactly where the C does.

// --- can_move_mob, lines 645-653 -----------------------------------------

function canMoveMob(st, r, c) {
  if (!inBounds(r, c)) return false;
  const blk = mapGet(st, r, c);
  if (isSolid(blk)) return false;
  if (blk === BLK_LAVA) return false;          // unreachable: see quirk 1
  if (hasMobAt(st, r, c)) return false;
  if (r === st.playerR[0] && c === st.playerC[0]) return false;
  return true;
}

// --- update_mobs, lines 655-784 -------------------------------------------

function updateMobs(st) {
  const pr = st.playerR[0];
  const pc = st.playerC[0];

  // Zombies.
  for (let i = 0; i < MAX_ZOMBIES; i++) {
    if (!st.zombieMask[i]) continue;
    const zr = st.zombieR[i];
    const zc = st.zombieC[i];
    const dist = l1Dist(zr, zc, pr, pc);
    if (dist >= MOB_DESPAWN_DIST) {
      st.zombieMask[i] = 0;
      mbClear(st.mobBits, zr, zc); mbClear(st.zombieBits, zr, zc);
      continue;
    }
    if (dist <= 1 && st.zombieCd[i] <= 0) {
      // 7 damage against a sleeping player, 2 otherwise. health is int8 and
      // is never clamped, so this can and does go negative.
      const dmg = st.isSleeping[0] ? 7 : 2;
      st.health[0] -= dmg;
      st.zombieCd[i] = 5;
      st.isSleeping[0] = 0;
    }
    st.zombieCd[i] = crMaxI(0, st.zombieCd[i] - 1);

    let dr = 0, dc = 0;
    if (dist < 10 && crRf(st.pcg) < F(0.75)) {
      const adr = Math.abs(pr - zr);
      const adc = Math.abs(pc - zc);
      // The tie-break draw only happens when adr === adc, so the number of
      // values consumed depends on the geometry.
      if (adr > adc || (adr === adc && crRf(st.pcg) < F(0.5))) dr = crSignI(pr - zr);
      else dc = crSignI(pc - zc);
    } else {
      const d = crRi(st.pcg, 4);
      dr = DIR_DR[d + 1]; dc = DIR_DC[d + 1];
    }
    const nr = zr + dr, nc = zc + dc;
    if (canMoveMob(st, nr, nc)) {
      mbClear(st.mobBits, zr, zc); mbClear(st.zombieBits, zr, zc);
      st.zombieR[i] = nr; st.zombieC[i] = nc;
      mbSet(st.mobBits, nr, nc); mbSet(st.zombieBits, nr, nc);
    }
  }

  // Cows. One draw each, always.
  for (let i = 0; i < MAX_COWS; i++) {
    if (!st.cowMask[i]) continue;
    const cr = st.cowR[i];
    const cc = st.cowC[i];
    const dist = l1Dist(cr, cc, pr, pc);
    if (dist >= MOB_DESPAWN_DIST) {
      st.cowMask[i] = 0;
      mbClear(st.mobBits, cr, cc); mbClear(st.cowBits, cr, cc);
      continue;
    }
    const d = crRi(st.pcg, 8);
    if (d < 4) {
      const dr = DIR_DR[d + 1], dc2 = DIR_DC[d + 1];
      const nr = cr + dr, nc = cc + dc2;
      if (canMoveMob(st, nr, nc)) {
        mbClear(st.mobBits, cr, cc); mbClear(st.cowBits, cr, cc);
        st.cowR[i] = nr; st.cowC[i] = nc;
        mbSet(st.mobBits, nr, nc); mbSet(st.cowBits, nr, nc);
      }
    }
  }

  // Skeletons: fire at range 4-5, keep their distance, flee when too close.
  for (let i = 0; i < MAX_SKELETONS; i++) {
    if (!st.skelMask[i]) continue;
    const sr = st.skelR[i];
    const sc = st.skelC[i];
    const dist = l1Dist(sr, sc, pr, pc);
    if (dist >= MOB_DESPAWN_DIST) {
      st.skelMask[i] = 0;
      mbClear(st.mobBits, sr, sc); mbClear(st.skelBits, sr, sc);
      continue;
    }
    if (dist >= 4 && dist <= 5 && st.skelCd[i] <= 0) {
      for (let a = 0; a < MAX_ARROWS; a++) {
        if (!st.arrowMask[a]) {
          st.arrowMask[a] = 1;
          st.arrowR[a] = sr; st.arrowC[a] = sc;
          mbSet(st.arrowBits, sr, sc);
          const adr = Math.abs(pr - sr), adc = Math.abs(pc - sc);
          st.arrowDr[a] = (adr > 0) ? crSignI(pr - sr) : 0;
          st.arrowDc[a] = (adc > 0) ? crSignI(pc - sc) : 0;
          break;
        }
      }
      // Set whether or not a free arrow slot was found, as in the C: the
      // assignment is after the loop, not inside it.
      st.skelCd[i] = 4;
    }
    st.skelCd[i] = crMaxI(0, st.skelCd[i] - 1);

    let dr = 0, dc = 0;
    let randomMove = crRf(st.pcg) < F(0.15);
    if (!randomMove) {
      if (dist >= 10) {
        const adr = Math.abs(pr - sr), adc = Math.abs(pc - sc);
        if (adr > adc || (adr === adc && crRf(st.pcg) < F(0.5))) dr = crSignI(pr - sr);
        else dc = crSignI(pc - sc);
      } else if (dist <= 3) {
        const adr = Math.abs(pr - sr), adc = Math.abs(pc - sc);
        if (adr > adc || (adr === adc && crRf(st.pcg) < F(0.5))) dr = -crSignI(pr - sr);
        else dc = -crSignI(pc - sc);
      } else {
        // Mid range: hold position by falling through to a random step. The
        // draw below still happens, which is why randomMove is reassigned
        // rather than the branch returning early.
        randomMove = true;
      }
    }
    if (randomMove) {
      const d = crRi(st.pcg, 4);
      dr = DIR_DR[d + 1]; dc = DIR_DC[d + 1];
    }
    const nr = sr + dr, nc = sc + dc;
    if (canMoveMob(st, nr, nc)) {
      mbClear(st.mobBits, sr, sc); mbClear(st.skelBits, sr, sc);
      st.skelR[i] = nr; st.skelC[i] = nc;
      mbSet(st.mobBits, nr, nc); mbSet(st.skelBits, nr, nc);
    }
  }

  // Arrows. No RNG; they fly until something stops them.
  for (let i = 0; i < MAX_ARROWS; i++) {
    if (!st.arrowMask[i]) continue;
    const ar = st.arrowR[i];
    const ac = st.arrowC[i];
    const nr = ar + st.arrowDr[i];
    const nc = ac + st.arrowDc[i];
    if (!inBounds(nr, nc)) {
      st.arrowMask[i] = 0; mbClear(st.arrowBits, ar, ac); continue;
    }
    const blk = mapGet(st, nr, nc);
    if (isSolid(blk) && blk !== BLK_WATER) {
      // An arrow destroys a table or furnace it hits, leaving path.
      if (blk === BLK_FURNACE || blk === BLK_TABLE) mapSet(st, nr, nc, BLK_PATH);
      st.arrowMask[i] = 0; mbClear(st.arrowBits, ar, ac); continue;
    }
    if (nr === pr && nc === pc) {
      st.health[0] -= 2;
      st.isSleeping[0] = 0;
      st.arrowMask[i] = 0; mbClear(st.arrowBits, ar, ac); continue;
    }
    mbClear(st.arrowBits, ar, ac);
    st.arrowR[i] = nr; st.arrowC[i] = nc;
    mbSet(st.arrowBits, nr, nc);
  }
}

// --- try_spawn, lines 785-801 ---------------------------------------------
// Returns the chosen cell through the caller's two-element scratch array,
// mirroring the C's out-parameters. Up to 20 attempts, two draws each, and
// it stops at the first acceptable cell — so its RNG cost varies.

function trySpawn(st, minD, maxD, needGrass, needPath, out) {
  const pr = st.playerR[0];
  const pc = st.playerC[0];
  for (let att = 0; att < 20; att++) {
    const r = crRi(st.pcg, MAP_SIZE);
    const c = crRi(st.pcg, MAP_SIZE);
    const dist = l1Dist(r, c, pr, pc);
    if (dist < minD || dist >= maxD) continue;
    if (hasMobAt(st, r, c)) continue;
    if (r === pr && c === pc) continue;
    const blk = mapGet(st, r, c);
    if (needGrass && blk !== BLK_GRASS) continue;
    if (needPath && blk !== BLK_PATH) continue;
    // With neither flag set the cell must still be grass or path, so mobs
    // never spawn in stone, water or sand.
    if (!needGrass && !needPath && blk !== BLK_GRASS && blk !== BLK_PATH) continue;
    out[0] = r; out[1] = c;
    return true;
  }
  return false;
}

// --- spawn_mobs, lines 803-842 --------------------------------------------

const _spawnOut = new Int32Array(2);

function spawnMobs(st) {
  let nCows = 0, nZ = 0, nSk = 0;
  for (let i = 0; i < MAX_COWS; i++) nCows += st.cowMask[i];
  for (let i = 0; i < MAX_ZOMBIES; i++) nZ += st.zombieMask[i];
  for (let i = 0; i < MAX_SKELETONS; i++) nSk += st.skelMask[i];

  // The chance draw happens only when there is a free slot, so a full slot
  // table changes the stream as well as the outcome.
  if (nCows < MAX_COWS && crRf(st.pcg) < F(0.1)) {
    if (trySpawn(st, 3, MOB_DESPAWN_DIST, true, false, _spawnOut)) {
      const r = _spawnOut[0], c = _spawnOut[1];
      for (let i = 0; i < MAX_COWS; i++) {
        if (!st.cowMask[i]) {
          st.cowMask[i] = 1; st.cowR[i] = r; st.cowC[i] = c; st.cowHp[i] = 3;
          mbSet(st.mobBits, r, c); mbSet(st.cowBits, r, c);
          break;
        }
      }
    }
  }

  // Zombie chance rises as the light falls: 0.02 at full light, 0.12 at
  // none. float32 throughout, and light_level is itself a float32 from the
  // cosine in step, so this is where a light divergence would first show.
  const l = st.lightLevel[0];
  const zombieChance = F(F(0.02) + F(F(0.1) * F(F(1.0 - l) * F(1.0 - l))));
  if (nZ < MAX_ZOMBIES && crRf(st.pcg) < zombieChance) {
    if (trySpawn(st, 9, MOB_DESPAWN_DIST, false, false, _spawnOut)) {
      const r = _spawnOut[0], c = _spawnOut[1];
      for (let i = 0; i < MAX_ZOMBIES; i++) {
        if (!st.zombieMask[i]) {
          st.zombieMask[i] = 1; st.zombieR[i] = r; st.zombieC[i] = c;
          st.zombieHp[i] = 5; st.zombieCd[i] = 0;
          mbSet(st.mobBits, r, c); mbSet(st.zombieBits, r, c);
          break;
        }
      }
    }
  }

  // Skeletons need path, which only exists where stone has been mined.
  if (nSk < MAX_SKELETONS && crRf(st.pcg) < F(0.05)) {
    if (trySpawn(st, 9, MOB_DESPAWN_DIST, false, true, _spawnOut)) {
      const r = _spawnOut[0], c = _spawnOut[1];
      for (let i = 0; i < MAX_SKELETONS; i++) {
        if (!st.skelMask[i]) {
          st.skelMask[i] = 1; st.skelR[i] = r; st.skelC[i] = c;
          st.skelHp[i] = 3; st.skelCd[i] = 0;
          mbSet(st.mobBits, r, c); mbSet(st.skelBits, r, c);
          break;
        }
      }
    }
  }
}
