// 30_level.js - load one corpus maze into the state.
//
// The level is DATA: DM_LEVEL.seeds[i] holds a maze DMLab generated for seed
// i (src/levels/<level>.js). Episode seed s uses corpus entry s mod N, so the
// corpus seeds 0..N-1 are DMLab's own seeds 0..N-1.

// Doors (explore_obstructed_goals). A door cell holds a panel of no
// thickness across the middle of the cell, spanning it: an 'H' door (func_door
// angle 0) blocks y at the cell's centre, an 'I' door (angle 90) blocks x. A
// closed panel stays there; an open one has slid along its angle (+x for H,
// +y for I) to 94 units on, leaving a stub at the cell's edge (oracle stop
// positions, PROGRESS.md U05).
const DM_DOOR_OPEN_SLIDE = 94;

function _dmRect(x0, x1, y0, y1) {
  return Float32Array.from([-1, 0, F(-(x0 - DM_HALF)), 1, 0, F(x1 + DM_HALF),
    0, -1, F(-(y0 - DM_HALF)), 0, 1, F(y1 + DM_HALF)]);
}

// Fence doors (rooms_keys_doors_puzzle): a slab from 46 to 54 across the
// cell's middle (the oracle stops 15.125 short of it on either side) that
// collides with the player's true half-width; an opened one is gone.
const DM_FENCE_LO = 46, DM_FENCE_HI = 54;

function _dmDoorRect(m, r, c, open) {
  const x0 = c * DM_CELL, y0 = (m.h - 1 - r) * DM_CELL;
  if (DM_LEVEL.door_style === 'fence') {
    // `open` is the slide so far, 0 (shut) to DM_FENCE_SLIDE (rooms.js).
    const sl = open || 0;
    return m.rows[r][c] === 'H'
      ? _dmRectHalf(x0 + sl, x0 + DM_CELL + sl, y0 + DM_FENCE_LO, y0 + DM_FENCE_HI, DM_PLAYER_HALF)
      : _dmRectHalf(x0 + DM_FENCE_LO, x0 + DM_FENCE_HI, y0 + sl, y0 + DM_CELL + sl, DM_PLAYER_HALF);
  }
  const s = open ? DM_DOOR_OPEN_SLIDE : 0;
  if (m.rows[r][c] === 'H') {
    const yc = y0 + DM_CELL / 2;
    return _dmRect(x0 + s, x0 + DM_CELL + s, yc, yc);
  }
  const xc = x0 + DM_CELL / 2;
  return _dmRect(xc, xc, y0 + s, y0 + DM_CELL + s);
}

// Configuration-space obstacles per cell, as lists of convex polygons.
//
// A WALL CELL collides as a cross: two boxes, one spanning the cell's full
// width but inset DM_NOTCH from its north and south edges, one spanning its
// full height but inset DM_NOTCH from its west and east edges. So every
// convex corner has a DM_NOTCH x DM_NOTCH square notch; along a straight wall
// the neighbouring cell's cross fills it, and a box's flat face cannot enter
// it. Measured, not assumed (PROGRESS.md U05): the oracle's centre stops
// 16.125 from a flat face, but at convex corners it sits 0.874-0.875 inside
// BOTH faces (seed 22: held there with zero velocity - two inner faces make a
// crease) or creeps along a face at that depth. Each box is grown by DM_HALF.
//
// A DOOR panel is grown by DM_HALF too. Planes (nx, ny, d): inside n.p < d.
function dmBuildObstacles(m, doors) {
  const W = m.w, H = m.h;
  const out = new Array(W * H).fill(null);
  const add = (i, poly) => { (out[i] = out[i] || []).push(poly); };
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (m.rows[r][c] !== '*') continue;
      const x0 = c * DM_CELL, x1 = x0 + DM_CELL, y0 = (H - 1 - r) * DM_CELL, y1 = y0 + DM_CELL;
      add(r * W + c, _dmRect(x0, x1, y0 + DM_NOTCH, y1 - DM_NOTCH));
      add(r * W + c, _dmRect(x0 + DM_NOTCH, x1 - DM_NOTCH, y0, y1));
    }
  }
  for (const [r, c, open] of doors) {
    const rect = _dmDoorRect(m, r, c, open);
    if (rect !== null) add(r * W + c, rect);
  }
  return out;
}

// A box level (rooms family): the seed names a map of axis-aligned boxes
// (tools/compile_rooms.py). Collision is every solid box's footprint grown by
// the player's TRUE half-width, 15 (Quake's player box): the oracle's centre
// stops 15.126 from a brush face. The text mazes' 16.125 is 15.125 from wall
// brushes that reach 1 unit past their cell - which is also where the corner
// notch comes from. One flat list, walked whole.
const DM_PLAYER_HALF = 15;

function _dmRectHalf(x0, x1, y0, y1, h) {
  return Float32Array.from([-1, 0, F(-(x0 - h)), 1, 0, F(x1 + h), 0, -1, F(-(y0 - h)), 0, 1, F(y1 + h)]);
}
// Only boxes that reach into the player's body (origin -24 to +32, Quake's
// player box) block the 2D walk: floors and ceilings do not.
function _dmBlocks(b, z) { return b[4] < z + 32 && b[5] > z - 24; }

function _dmMapGeometry(name, z) {
  const map = DM_LEVEL.maps[name];
  if (!map._f32) {
    map._f32 = Float32Array.from(map.boxes);
    map._obs = map.solids.filter((b) => _dmBlocks(b, z)).map((b) => _dmRectHalf(b[0], b[2], b[1], b[3], DM_PLAYER_HALF));
    // non-axial brushes (rooms_watermaze): their own planes, already pushed
    // out by the player's half-width, behind Quake's axial bevels
    for (const pg of map.polys || []) {
      if (pg.z[0] < z + 32 && pg.z[1] > z - 24) map._obs.push(Float32Array.from(pg.planes));
    }
  }
  return map;
}

// The geometry a box level shows now: its static boxes (exploit levels have
// a dark and a bright floor variant) plus its doors at their current height.
function dmBoxGeometry(st) {
  const m = st.maze;
  const name = DM_LEVEL.kind === 'exploit' ? m.map + (st.bright ? '#bright' : '#dark') : m.map;
  const map = _dmMapGeometry(name, st.z);
  const doors = map.doors || [];
  if (doors.length === 0) {
    m.boxesF32 = map._f32; m.nBoxes = map._f32.length / 60; m.flatObstacles = map._obs;
    return;
  }
  const out = new Float32Array(map._f32.length + doors.length * 60);
  out.set(map._f32);
  const obs = map._obs.slice();
  for (let k = 0; k < doors.length; k++) {
    const d = doors[k], up = F(d.rise * dmDoorOpen(st, k));
    const rec = Float32Array.from(d.box);
    rec[1] = F(rec[1] + F(up / DM_CELL)); rec[4] = F(rec[4] + F(up / DM_CELL));
    out.set(rec, map._f32.length + k * 60);
    // It blocks until its bottom clears the player's head (origin + 32).
    if (d.solid[4] + up < st.z + 32 && d.solid[5] + up > st.z - 24) obs.push(_dmRectHalf(d.solid[0], d.solid[2], d.solid[1], d.solid[3], DM_PLAYER_HALF));
  }
  m.boxesF32 = out; m.nBoxes = out.length / 60; m.flatObstacles = obs;
}

// A door's open fraction: Quake's default door speed is 100 units/s.
const DM_DOOR_SPEED = 100;
function dmDoorOpen(st, k) {
  const d = DM_LEVEL.maps[st.maze.map + (DM_LEVEL.kind === 'exploit' ? '#dark' : '')].doors[k];
  if (st.doorOpen) return 1;
  if (st.doorAt < 0) return 0;
  const p = (st.frame - st.doorAt) / DM_FPS * DM_DOOR_SPEED / d.rise;
  return p >= 1 ? 1 : p;
}

function dmBoxMaze(sd) {
  return Object.assign({ flat: true, w: 0, h: 0, rows: [], doors: [], goal: null, pcells: [], acells: [] }, sd);
}

// A language round's maze (tier 2): the round's map from DM_LEVEL.lang.maps
// (a level's rounds may switch maps) over the seed's own data, its placeholder
// floors replaced by their colour composites for the round's room colours.
function dmLangMaze(base, name, floors) {
  const L = DM_LEVEL.lang;
  const g = (name && L.maps && L.maps[name]) || base;
  const m = Object.assign({}, base, {
    w: g.w, h: g.h, rows: g.rows, wall: g.wall, decals: g.decals,
    pcells: g.pcells, acells: g.acells, ocells: g.ocells, oregions: g.oregions || base.oregions,
  });
  m.floor = g.floor.map((t) => {
    const f = L.floor_tiles && L.floor_tiles[t];
    return f && floors && floors[f.region] ? f.colours[floors[f.region]] : t;
  });
  m.lname = name;
  return m;
}

function dmLoad(st, seed) {
  if (DM_LEVEL.kind === 'psychlab') { dmPsychLoad(st, seed); return; }
  const n = DM_LEVEL.seeds.length;
  st.seedIdx = ((seed >>> 0) % n);
  st.maze = DM_LEVEL.maps ? dmBoxMaze(DM_LEVEL.seeds[st.seedIdx]) : DM_LEVEL.seeds[st.seedIdx];
  if (st.maze.lang) st.maze = dmLangMaze(st.maze, st.maze.lang.map, st.maze.lang.floors);
  st.z = st.maze.spawn[2]; st.groundZ = st.z; st.vz = 0; st.air = false; st.landT = 0; st.teleTouched = -1;
  st.replayTeleports = null;
  st.picked = 0; st.endAt = -1; st.carried = null; st.doorStartAt = null;
  const cfg = st.maze.config || {};
  st.doorOpen = !!cfg.doorOpened; st.doorAt = -1; st.bright = !!cfg.doorOpened;
  if (DM_LEVEL.kind === 'water') {
    // the glass is the ground; a spawn above it is still falling
    st.groundZ = F(DM_LEVEL.maps[st.maze.map].stand_z);
    st.vz = F(st.maze.spawn_vz);
    st.air = st.z > st.groundZ + 0.25;
    dmWaterReset(st);
  }
  if (st.maze.flat) dmBoxGeometry(st);
  st.doors = st.maze.doors.map((d) => d.slice());
  dmDoorsChanged(st);
  dmSetItems(st, st.maze.items);
  if (st.maze.lang) {
    // language levels: this round's objects ([x, y, tile, w, h, reward, rgb1, rgb2]) and instruction
    dmSetItems(st, st.maze.lang.items);
    st.instr = st.maze.lang.instr;
    st.lcount = st.maze.lang.count || 0; st.lend = 0;
  }
  pcgSeed(st.pcg, seed >>> 0);
  const sp = st.maze.spawn;
  dmPlace(st, sp[0], sp[1], sp[3]);
  st.frame = 0;
  st.spawnFrame = 0;
  st.score = 0;
  st.pendingAt = -1; st.pendingReward = 0; st.restartAt = -1;
  st.holdLeft = -1; st.queue.length = 0;
  st.phase = 0;
  st.acc = 0;
  st.replayMsec = null;
  st.replayRespawns = null;
}

// Put the player at (x, y) facing yaw (degrees), at rest, counting the view
// from the accumulator's current value. A respawn restarts the accumulator
// with its own quantisation phase (50_tasks/explore.js): Quake's client view
// angles carry across the restart, so the phase relative to the new spawn
// angle is new, and in a G3 replay it is the oracle's (PROGRESS.md U04).
//
// The yaw reported on the placing frame is the raw spawn angle; from the next
// frame on it is that angle rounded to Quake angle units (oracle, U04).
function dmPlace(st, x, y, yaw) {
  st.x = F(x); st.y = F(y); st.vx = 0; st.vy = 0;
  st.spawnYaw = DM_U * Math.round(yaw / DM_U);
  st.n0 = dmYawCount(st);
  st.yaw = yaw;
}

// Doors and items of a (re)started map.
function dmShutMask(st) {
  const m = st.maze, shut = new Uint8Array(m.w * m.h);
  for (const d of st.doors) if (!d[2]) shut[d[0] * m.w + d[1]] = 1;
  return shut;
}

// skymaze: platforms are columns whose tops step by 20; void cells are
// walled off by invisible columns. A cell blocks the walk if it is void or
// stands more than Quake's step height (18) above the feet; walls are exact
// cells against the true half-width (the oracle stops 15.125 off).
const DM_STEP = 18;
function dmSkyObstacles(st) {
  const m = st.maze, W = m.w, H = m.h, feet = st.z - 24.125;
  const out = new Array(W * H).fill(null);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const t = m.tops[r * W + c];
      if (t >= 0 && t <= feet + DM_STEP) continue;
      const x0 = c * DM_CELL, y0 = (H - 1 - r) * DM_CELL;
      out[r * W + c] = [_dmRectHalf(x0, x0 + DM_CELL, y0, y0 + DM_CELL, DM_PLAYER_HALF)];
    }
  }
  st.obstacles = out;
  st.obsFeet = feet;
}

// The highest platform top under the player's box, or -1 over void.
function dmSkySupport(st) {
  const m = st.maze, W = m.w, H = m.h;
  const c0 = Math.floor((st.x - DM_PLAYER_HALF) / DM_CELL), c1 = Math.floor((st.x + DM_PLAYER_HALF) / DM_CELL);
  const r0 = H - 1 - Math.floor((st.y + DM_PLAYER_HALF) / DM_CELL), r1 = H - 1 - Math.floor((st.y - DM_PLAYER_HALF) / DM_CELL);
  let best = -1;
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    if (r < 0 || c < 0 || r >= H || c >= W) continue;
    const t = m.tops[r * W + c];
    if (t > best) best = t;
  }
  return best;
}

function dmDoorsChanged(st) {
  if (DM_LEVEL.kind === 'sky') { dmSkyObstacles(st); st.cellsVersion++; return; }
  if (st.maze.flat) { st.obstacles = null; st.cellsVersion++; return; }
  st.obstacles = dmBuildObstacles(st.maze, st.doors);
  st.cellsVersion++;
}

function dmSetDoors(st, doors) {
  st.doors = doors.map((d) => d.slice());
  dmDoorsChanged(st);
}

function dmSetItems(st, items) {
  st.items = items.map((it) => it.slice());
  st.alive = new Uint8Array(st.items.length).fill(1);
}
