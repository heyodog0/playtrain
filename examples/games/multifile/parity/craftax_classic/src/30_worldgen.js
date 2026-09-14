// 30_worldgen.js — generate_world, craftax_classic.h lines 291-497.
//
// This is the float-heaviest code in the game and the only place where a
// missing Math.fround shows up as a different world rather than a different
// last bit. Every arithmetic step is wrapped in F(), in the C's evaluation
// order (C's * and + are left-associative, and each intermediate is rounded
// to float32 before the next operation).
//
// Two things about which C we are mirroring:
//
//   The SCALAR path. PufferLib has an AVX-512 block for the same maths, and
//   it uses FMA, so it already disagrees with its own scalar fallback in the
//   last bit. reference/build.sh never defines __AVX512F__ and compiles with
//   -ffp-contract=off, pinning the scalar no-FMA path. That is what this
//   mirrors.
//
//   cosf/sinf are V8's ieee754. The driver redirects the C's calls there
//   (PLAN 1.4), and Math.cos/Math.sin in every PlayTrain engine resolve to
//   the same function, so F(Math.cos(a)) here is (float)cosf(a) there.

const WORLDGEN_GRID = 10;
// The C pads its gradient tables by 16 floats so an AVX-512 permute-load at
// the last grid row cannot read out of bounds. The scalar path never reads
// past GRID*GRID, but the padding is kept so the two are visibly the same
// table, and because the padded entries are zeroed in the C too.
const WORLDGEN_GRID_PAD = WORLDGEN_GRID * WORLDGEN_GRID + 16;

// perlin_interp: t*t*t*(t*(t*6-15)+10), left-associated exactly as written.
function perlinInterp(t) {
  const t3 = F(F(t * t) * t);
  const inner = F(F(t * F(F(t * 6.0) - 15.0)) + 10.0);
  return F(t3 * inner);
}

// Scratch, allocated once. generate_world runs on reset, not per step, but
// allocating 64 KB of noise per episode is pointless.
const _wgCosA = [
  new Float32Array(WORLDGEN_GRID_PAD), new Float32Array(WORLDGEN_GRID_PAD),
  new Float32Array(WORLDGEN_GRID_PAD), new Float32Array(WORLDGEN_GRID_PAD),
];
const _wgSinA = [
  new Float32Array(WORLDGEN_GRID_PAD), new Float32Array(WORLDGEN_GRID_PAD),
  new Float32Array(WORLDGEN_GRID_PAD), new Float32Array(WORLDGEN_GRID_PAD),
];
// noise[k][r][c] flattened as k*4096 + r*64 + c.
const _wgNoise = new Float32Array(4 * MAP_SIZE * MAP_SIZE);

function generateWorld(st) {
  // Reset maps and bitmaps. memset(map_packed, BLK_GRASS, ...) writes the
  // byte 2 everywhere, which is what fill does here.
  st.mapPacked.fill(BLK_GRASS);
  st.mobBits.fill(0);
  st.zombieBits.fill(0);
  st.cowBits.fill(0);
  st.skelBits.fill(0);
  st.arrowBits.fill(0);

  // Gradient tables: one random angle per grid point per layer, stored as
  // its cosine and sine. This is the only RNG use in worldgen before the ore
  // and tree rolls, and it consumes 4 * 100 draws in this exact order.
  for (let layer = 0; layer < 4; layer++) {
    const cosA = _wgCosA[layer];
    const sinA = _wgSinA[layer];
    for (let i = 0; i < WORLDGEN_GRID * WORLDGEN_GRID; i++) {
      const a = F(F(crRf(st.pcg) * 2.0) * PI_F);
      cosA[i] = F(Math.cos(a));
      sinA[i] = F(Math.sin(a));
    }
    for (let i = WORLDGEN_GRID * WORLDGEN_GRID; i < WORLDGEN_GRID_PAD; i++) {
      cosA[i] = 0;
      sinA[i] = 0;
    }
  }

  const scale = F(F(MAP_SIZE) / F(WORLDGEN_GRID - 1));
  const invScale = F(1.0 / scale);
  const center = (MAP_SIZE / 2) | 0;

  for (let r = 0; r < MAP_SIZE; r++) {
    const nr = F(r * invScale);
    const x0 = nr | 0;                       // (int)nr; nr >= 0, so truncation
    const fx = F(nr - x0);
    const fx1 = F(fx - 1.0);
    const u = perlinInterp(fx);
    const row0 = x0 * WORLDGEN_GRID;
    const row1 = row0 + WORLDGEN_GRID;
    for (let c = 0; c < MAP_SIZE; c++) {
      const nc = F(c * invScale);
      const y0 = nc | 0;
      const fy = F(nc - F(y0));
      const fy1 = F(fy - 1.0);
      const v = perlinInterp(fy);
      const y1 = y0 + 1;
      for (let k = 0; k < 4; k++) {
        const cosA = _wgCosA[k];
        const sinA = _wgSinA[k];
        const c00 = cosA[row0 + y0];
        const c10 = cosA[row1 + y0];
        const c01 = cosA[row0 + y1];
        const c11 = cosA[row1 + y1];
        const s00 = sinA[row0 + y0];
        const s10 = sinA[row1 + y0];
        const s01 = sinA[row0 + y1];
        const s11 = sinA[row1 + y1];
        const n00 = F(F(c00 * fx) + F(s00 * fy));
        const n10 = F(F(c10 * fx1) + F(s10 * fy));
        const n01 = F(F(c01 * fx) + F(s01 * fy1));
        const n11 = F(F(c11 * fx1) + F(s11 * fy1));
        const nx0 = F(n00 + F(u * F(n10 - n00)));
        const nx1 = F(n01 + F(u * F(n11 - n01)));
        _wgNoise[k * 4096 + r * MAP_SIZE + c] =
          F(F(F(nx0 + F(v * F(nx1 - nx0))) + 1.0) * 0.5);
      }
    }
  }

  // Tile-logic sweep. Reads the precomputed noise, writes blocks, and draws
  // from the RNG for ore and trees — in row-major order, so the stream
  // position depends on the whole sweep.
  for (let r = 0; r < MAP_SIZE; r++) {
    for (let c = 0; c < MAP_SIZE; c++) {
      const waterNoise = _wgNoise[0 * 4096 + r * MAP_SIZE + c];
      const mountainNoise = _wgNoise[1 * 4096 + r * MAP_SIZE + c];
      const treeNoise = _wgNoise[2 * 4096 + r * MAP_SIZE + c];
      const pathNoise = _wgNoise[3 * 4096 + r * MAP_SIZE + c];

      const d2 = (r - center) * (r - center) + (c - center) * (c - center);
      const dist = F(Math.sqrt(F(d2)));
      const q = F(dist / 20.0);
      const prox = F(1.0 - (q < 1.0 ? q : 1.0));      // 1 - cr_min_f(dist/20, 1)

      const waterVal = F(waterNoise - F(prox * 0.3));
      const mountainVal = F(mountainNoise - F(prox * 0.3));

      let blk = BLK_GRASS;
      if (waterVal > F(0.7)) {
        blk = BLK_WATER;
      } else if (waterVal > F(0.6) && waterVal <= F(0.75)) {
        // Reference quirk 2: the <= 0.75 bound is dead, the branch above has
        // already taken everything over 0.7. Kept as written.
        blk = BLK_SAND;
      } else if (mountainVal > F(0.7)) {
        blk = BLK_STONE;
        if (pathNoise > F(0.8)) blk = BLK_PATH;
        if (mountainVal > F(0.85) && waterNoise > F(0.4)) blk = BLK_PATH;
        // Reference quirk 1: lava needs mountain_val > 0.85 and tree_noise >
        // 0.7 together, which no seed in 500 produced. Kept as written.
        if (mountainVal > F(0.85) && treeNoise > F(0.7)) blk = BLK_LAVA;
      }
      if (blk === BLK_STONE) {
        const ore = crRf(st.pcg);
        if (ore < F(0.005) && mountainVal > F(0.8)) blk = BLK_DIAMOND;
        else if (ore < F(0.035)) blk = BLK_IRON;
        else if (ore < F(0.075)) blk = BLK_COAL;
      }
      if (blk === BLK_GRASS && treeNoise > F(0.5) && crRf(st.pcg) > F(0.8)) {
        blk = BLK_TREE;
      }
      mapSet(st, r, c, blk);
    }
  }

  mapSet(st, center, center, BLK_GRASS);   // player spawn is always grass

  // Diamond guarantee: if the ore rolls produced none, convert one stone.
  // The 1000-attempt loop draws two values per attempt and stops at the
  // first hit, so its RNG cost depends on the map.
  let hasDiamond = false;
  for (let r = 0; r < MAP_SIZE && !hasDiamond; r++) {
    for (let c = 0; c < MAP_SIZE && !hasDiamond; c++) {
      if (mapGet(st, r, c) === BLK_DIAMOND) hasDiamond = true;
    }
  }
  if (!hasDiamond) {
    for (let att = 0; att < 1000; att++) {
      const r = crRi(st.pcg, MAP_SIZE);
      const c = crRi(st.pcg, MAP_SIZE);
      if (mapGet(st, r, c) === BLK_STONE) {
        mapSet(st, r, c, BLK_DIAMOND);
        break;
      }
    }
  }

  // Initial intrinsics, inventory and mobs.
  st.playerR[0] = center;
  st.playerC[0] = center;
  st.playerDir[0] = 4;
  st.health[0] = 9;
  st.food[0] = 9;
  st.drink[0] = 9;
  st.energy[0] = 9;
  st.isSleeping[0] = 0;
  st.recover[0] = 0;
  st.hunger[0] = 0;
  st.thirst[0] = 0;
  st.fatigue[0] = 0;
  st.inv.fill(0);
  st.zombieMask.fill(0);
  st.zombieHp.fill(0);
  st.zombieCd.fill(0);
  st.cowMask.fill(0);
  st.cowHp.fill(0);
  st.skelMask.fill(0);
  st.skelHp.fill(0);
  st.skelCd.fill(0);
  st.arrowMask.fill(0);
  st.plantMask.fill(0);
  st.plantAge.fill(0);
  st.achievements.fill(0);
  st.timestep[0] = 0;
  st.lightLevel[0] = 1.0;
}
