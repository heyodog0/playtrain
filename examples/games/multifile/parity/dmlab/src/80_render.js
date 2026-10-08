// 80_render.js - the first-person frame: one mazeView call and the goal sprite.
//
// Every pixel comes from the rasterizer (crates/rasterizer/src/maze.rs); this
// file only says what to draw. The cell planes are packed once per episode:
// nothing in an explore maze changes while it is played.
const DM_VIEW_DIST = F(30.0);       // cells; the largest explore maze is 17 wide

// Human play only (an env never calls humanStart): pass mazeBoxes just the
// boxes some pixel's ray can reach, for 60 frames a second in the browser.
// A ray's hit point q (from the eye) has |q.right| <= q.fwd, |q.up| <= q.fwd
// and |q| <= DM_VIEW_DIST; a box with all eight corners past one of those
// planes, or wholly beyond the view distance, is never hit. Dropping it and
// keeping the rest in order leaves every pixel as it was.
const DM_CULL_MARGIN = 0.05;   // cells
let _dmCullBuf = null, _dmCulled = null;
function dmCullBoxes(bx, ex, ey, ez, yaw) {
  if (!dmHuman) return bx;
  const n = bx.length / 60;
  if (!_dmCullBuf || _dmCullBuf.length < bx.length) _dmCullBuf = new Float32Array(bx.length);
  const p = dmLookPitch * Math.PI / 180;
  const s = Math.sin(yaw), co = Math.cos(yaw), sp = Math.sin(p), cp = Math.cos(p);
  const f = [s * cp, -sp, -co * cp], u = [s * sp, cp, -co * sp], r = [co, 0, s];
  // outside the view when q.N > margin for every corner
  const planes = [
    [-f[0], -f[1], -f[2]],
    [r[0] - f[0], r[1] - f[1], r[2] - f[2]], [-r[0] - f[0], -r[1] - f[1], -r[2] - f[2]],
    [u[0] - f[0], u[1] - f[1], u[2] - f[2]], [-u[0] - f[0], -u[1] - f[1], -u[2] - f[2]],
  ];
  const far = DM_VIEW_DIST + DM_CULL_MARGIN;
  let k = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 60;
    const lo = [bx[o] - ex, bx[o + 1] - ey, bx[o + 2] - ez], hi = [bx[o + 3] - ex, bx[o + 4] - ey, bx[o + 5] - ez];
    // distance from the eye to the box
    let d2 = 0;
    for (let a = 0; a < 3; a++) { const g = lo[a] > 0 ? lo[a] : hi[a] < 0 ? -hi[a] : 0; d2 += g * g; }
    let out = d2 > far * far;
    for (let j = 0; j < planes.length && !out; j++) {
      const N = planes[j];
      // the corner furthest along -N: if even it is past the plane, all are
      const q = (N[0] < 0 ? hi[0] : lo[0]) * N[0] + (N[1] < 0 ? hi[1] : lo[1]) * N[1] + (N[2] < 0 ? hi[2] : lo[2]) * N[2];
      if (q > DM_CULL_MARGIN) out = true;
    }
    if (!out) { _dmCullBuf.set(bx.subarray(o, o + 60), k * 60); k++; }
  }
  return _dmCullBuf.subarray(0, k * 60);
}
const DM_PLANES = 8;
const DM_NONE = 0xFFFF;
const DM_SOLID = 0x100;
const DM_DECAL_LO = F(0.25), DM_DECAL_HI = F(0.75);   // poster square on a face
// Sprite sizes come from each model's bounding box (DM_LEVEL goal_size, cats).

let _dmAtlas = null;
// The atlas tile word of rs_maze_view/_boxes/_quads: the tile size, and in
// bits 16-23 the mip levels the atlas carries past the first (maze.rs, V2).
// Sprites always take level 0.
let _dmTileWord = typeof DM_ATLAS_TILE === 'undefined' ? 0 : DM_ATLAS_TILE | (DM_ATLAS_MIPS << 16);   // psychlab has no atlas
let _dmCells = null;
let _dmCellsFor = null;
let _dmCellsVersion = -1;

// The skybox over whatever the geometry left as sky (rs_maze_sky), drawn
// before the sprites so their soft edges blend over it; none where the
// level shows no sky (DM_SKY_B64 null, atlas/<level>.js).
let _dmSkyCube = null;
function _dmDrawSky(yaw) {
  if (DM_SKY_B64 === null) return;
  if (_dmSkyCube === null) _dmSkyCube = _dmDecode(DM_SKY_B64);
  mazeSky(yaw, _dmSkyCube, DM_SKY_SIZE, 0, 0, width, height);
}

function _dmDecode(b64) {
  if (typeof atob === 'function') {
    const s = atob(b64), out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

function dmPackCells(m, shut) {
  const n = m.w * m.h, p = new Uint16Array(n * DM_PLANES).fill(DM_NONE);
  for (let r = 0; r < m.h; r++) {
    for (let c = 0; c < m.w; c++) {
      const i = r * m.w + c;
      const door = shut[i] === 1;
      const solid = m.rows[r][c] === '*' || door;
      p[i] = door ? DM_LEVEL.door_tile : m.wall[i];
      p[n + i] = m.floor[i];
      p[2 * n + i] = DM_NONE;             // open sky: explore uses a skybox
      p[3 * n + i] = solid ? DM_SOLID : 0;
    }
  }
  for (const [r, c, face, tile] of m.decals) p[(4 + face) * n + r * m.w + c] = tile;
  return p;
}

function dmRenderBoxes(st) {
  const m = st.maze;
  background(0, 0, 0);
  // Primitive frame: x = X/100, y = Z/100, z = -Y/100.
  const ex = F(st.x / DM_CELL), ez = F(F(-st.y) / DM_CELL);
  const ey = F((st.z + DM_EYE_HEIGHT) / DM_CELL);
  const yaw = F(F(90 - st.yaw) * F(Math.PI / 180));
  mazeBoxes(_dmCulled = dmCullBoxes(m.boxesF32.subarray(0, m.nBoxes * 60), ex, ey, ez, yaw), _dmCulled.length / 60, ex, ey, ez, yaw, DM_VIEW_DIST,
    _dmAtlas, _dmTileWord, DM_ATLAS_COUNT, DM_LEVEL.sky, 0, 0, width, height);
  _dmDrawSky(yaw);
  const base = F((st.z - 24) / DM_CELL);   // the floor: origin minus the player's 24 below
  for (let i = 0; i < st.items.length; i++) {
    if (!st.alive[i]) continue;
    const it = st.items[i], cat = m.cats[it[2]];
    mazeSprite(ex, ey, ez, yaw, DM_VIEW_DIST, F(it[0] / DM_CELL), F(F(-it[1]) / DM_CELL), base, cat[1], cat[2],
      _dmAtlas, DM_ATLAS_TILE, DM_ATLAS_COUNT, cat[0], 0, 0, width, height);
  }
}

// rooms_watermaze: floor, glass, sky lid and the platform (risen with the
// player standing on it, else down under the floor) as boxes, then the arena's
// 16 wall faces and its eight landmark pictures as quads.
let _dmWaterBoxes = null, _dmWaterFor = null, _dmWaterLift = NaN;
function dmRenderWater(st) {
  const m = st.maze, map = DM_LEVEL.maps[m.map];
  // platform top: under the player's feet while held, at most fully raised
  let top = F(map.plat_top - map.plat_rise);
  if (st.wmHold >= 0) {
    const feet = F(st.z - 24.125);
    top = feet > map.plat_top ? F(map.plat_top) : (feet > top ? feet : top);
  }
  const lift = F(top - map.plat_top);
  if (_dmWaterFor !== m || lift !== _dmWaterLift) {
    const out = new Float32Array(map.boxes.length + map.plat_boxes.length);
    out.set(map.boxes);
    const n0 = map.boxes.length, P = m.platform;
    for (let i = 0; i < map.plat_boxes.length; i += 60) {
      const b = Float32Array.from(map.plat_boxes.slice(i, i + 60));
      // primitive frame: x = X/100, y = Z/100, z = -Y/100
      b[0] = F(b[0] + F(P[0] / DM_CELL)); b[3] = F(b[3] + F(P[0] / DM_CELL));
      b[1] = F(b[1] + F(lift / DM_CELL)); b[4] = F(b[4] + F(lift / DM_CELL));
      b[2] = F(b[2] - F(P[1] / DM_CELL)); b[5] = F(b[5] - F(P[1] / DM_CELL));
      out.set(b, n0 + i);
    }
    _dmWaterBoxes = out; _dmWaterFor = m; _dmWaterLift = lift;
  }
  background(0, 0, 0);
  const ex = F(st.x / DM_CELL), ez = F(F(-st.y) / DM_CELL);
  const ey = F((st.z + DM_EYE_HEIGHT) / DM_CELL);
  const yaw = F(F(90 - st.yaw) * F(Math.PI / 180));
  mazeBoxes(_dmCulled = dmCullBoxes(_dmWaterBoxes, ex, ey, ez, yaw), _dmCulled.length / 60, ex, ey, ez, yaw, DM_VIEW_DIST,
    _dmAtlas, _dmTileWord, DM_ATLAS_COUNT, DM_LEVEL.sky, 0, 0, width, height);
  // the arena's wall faces and the landmarks on them
  if (!map._quads) map._quads = Float32Array.from(map.quads);
  mazeQuads(map._quads, map._quads.length / 12, ex, ey, ez, yaw, DM_VIEW_DIST,
    _dmAtlas, _dmTileWord, DM_ATLAS_COUNT, 0, 0, width, height);
  _dmDrawSky(yaw);
}

// rooms_keys_doors_puzzle: a text maze with invisible walls, drawn as boxes -
// the compiled floor slabs and every fence door still shut.
let _dmKeysBoxes = null, _dmKeysFor = null, _dmKeysVersion = -1;
function dmRenderKeys(st) {
  const m = st.maze;
  if (_dmKeysFor !== m || _dmKeysVersion !== st.cellsVersion) {
    const parts = [m.floor_boxes];
    for (let k = 0; k < st.doors.length; k++) {
      // a fence door's slab, slid along its angle: H +x, I +y (primitive -z)
      const sl = F((st.doors[k][2] || 0) / DM_CELL), b = m.door_boxes[k].slice();
      if (m.rows[st.doors[k][0]][st.doors[k][1]] === 'H') { b[0] = F(b[0] + sl); b[3] = F(b[3] + sl); }
      else { b[2] = F(b[2] - sl); b[5] = F(b[5] - sl); }
      parts.push(b);
    }
    _dmKeysBoxes = Float32Array.from([].concat(...parts));
    _dmKeysFor = m; _dmKeysVersion = st.cellsVersion;
  }
  background(0, 0, 0);
  const ex = F(st.x / DM_CELL), ez = F(F(-st.y) / DM_CELL);
  const ey = F((st.z + DM_EYE_HEIGHT) / DM_CELL);
  const yaw = F(F(90 - st.yaw) * F(Math.PI / 180));
  mazeBoxes(_dmCulled = dmCullBoxes(_dmKeysBoxes, ex, ey, ez, yaw), _dmCulled.length / 60, ex, ey, ez, yaw, DM_VIEW_DIST,
    _dmAtlas, _dmTileWord, DM_ATLAS_COUNT, DM_LEVEL.sky, 0, 0, width, height);
  _dmDrawSky(yaw);
  const base = F(m.floor_z / DM_CELL);
  for (let i = 0; i < st.items.length; i++) {
    if (!st.alive[i]) continue;
    const it = st.items[i], cat = m.cats[it[2]];
    mazeSprite(ex, ey, ez, yaw, DM_VIEW_DIST, F(it[0] / DM_CELL), F(F(-it[1]) / DM_CELL), base, cat[1], cat[2],
      _dmAtlas, DM_ATLAS_TILE, DM_ATLAS_COUNT, cat[0], 0, 0, width, height);
  }
}

// skymaze: the compiled platform slabs and the goal on its platform.
let _dmSkyBoxes = null, _dmSkyFor = null;
function dmRenderSky(st) {
  const m = st.maze;
  if (_dmSkyFor !== m) { _dmSkyBoxes = Float32Array.from(m.sky_boxes); _dmSkyFor = m; }
  background(0, 0, 0);
  const ex = F(st.x / DM_CELL), ez = F(F(-st.y) / DM_CELL);
  const ey = F((st.z + DM_EYE_HEIGHT) / DM_CELL);
  const yaw = F(F(90 - st.yaw) * F(Math.PI / 180));
  mazeBoxes(_dmCulled = dmCullBoxes(_dmSkyBoxes, ex, ey, ez, yaw), _dmCulled.length / 60, ex, ey, ez, yaw, DM_VIEW_DIST,
    _dmAtlas, _dmTileWord, DM_ATLAS_COUNT, DM_LEVEL.sky, 0, 0, width, height);
  _dmDrawSky(yaw);
  for (let i = 0; i < st.items.length; i++) {
    if (!st.alive[i]) continue;
    const it = st.items[i], cat = m.cats[it[2]];
    const c = Math.floor(it[0] / DM_CELL), r = m.h - 1 - Math.floor(it[1] / DM_CELL);
    const base = F(m.tops[r * m.w + c] / DM_CELL);
    mazeSprite(ex, ey, ez, yaw, DM_VIEW_DIST, F(it[0] / DM_CELL), F(F(-it[1]) / DM_CELL), base, cat[1], cat[2],
      _dmAtlas, DM_ATLAS_TILE, DM_ATLAS_COUNT, cat[0], 0, 0, width, height);
  }
}

// DMLab's HUD as our own drawing (V1): its art is OpenArena's (GPL), so the
// port draws one flat box per element instead. Box [row0, row1, col0, col1]
// on the 64x64 view, opacity and colour fitted to the oracle's frames
// (least absolute error of (1 - a) * port + a * colour over 17 levels x 224
// frames, frame 0 left out for the spawn effect).
const DM_HUD = [
  [0, 1, 61, 62, 0.35, 124, 139, 158],     // top-right dot
  [54, 56, 60, 63, 0.5, 33, 51, 225],      // bottom-right icon
  [57, 62, 29, 32, 1.0, 60, 146, 143],     // the cyan figure
  [58, 63, 2, 9, 0.6, 125, 98, 14],        // the orange icon
  [58, 60, 11, 13, 1.0, 136, 255, 255],    // the small cyan icon
  [58, 63, 19, 27, 0.5, 110, 113, 116],    // the grey digits
];
function dmDrawHud() {
  const s = width / 64;
  noStroke();
  for (const [r0, r1, c0, c1, a, cr, cg, cb] of DM_HUD) {
    fill(cr, cg, cb, Math.round(a * 255));
    rect(c0 * s, r0 * s, (c1 - c0 + 1) * s, (r1 - r0 + 1) * s);
  }
}

// DMLab's spawn effect as our own drawing (V1b): rings around the player,
// so on screen a band between u0 and u1, where u = (row - 32) /
// sqrt(1 + ((col - 32) / 32)^2) is height over distance on a cylinder round
// the eye (the same at any pose). Frame 0: the level's DM_SPAWN0 bands
// (src/spawn/<level>.js, fitted to its oracle frame-0 dumps by
// tools/fit_spawn.py; the rings' phase there differs by level). From then on
// one band that fades out by frame 27 (fitted to reference/oracle/
// probe_spawn.py: no-op after reset). After the episode's first spawn only:
// drawn after restarts too, it made nonmatch's later frames worse.
const DM_SPAWN_BAND = [18, 21, 255, 250, 255], DM_SPAWN_END = 27;
function _dmBand(u0, u1, a, r, g, b) {
  const s = width / 64;
  fill(r, g, b, Math.round(a * 255));
  for (let c = 0; c < 64; c++) {
    const d = F(F(F(c + 0.5) - 32) / 32);
    const k = F(Math.sqrt(F(1 + F(d * d))));
    const y0 = F(32 + F(u0 * k)), y1 = F(32 + F(u1 * k));
    rect(c * s, y0 * s, s, F(y1 - y0) * s);
  }
}
function dmDrawSpawn(st) {
  const t = st.frame - st.spawnFrame;
  if (t < 0 || t >= DM_SPAWN_END) return;
  noStroke();
  if (t === 0) {
    for (const [u0, u1, a, r, g, b] of DM_SPAWN0) _dmBand(u0, u1, a, r, g, b);
    return;
  }
  const [u0, u1, r, g, b] = DM_SPAWN_BAND;
  _dmBand(u0, u1, Math.min(0.6, F(F(0.62 * (DM_SPAWN_END - t)) / 23)), r, g, b);
}

function dmRender(st) {
  if (DM_LEVEL.kind === 'psychlab') { dmRenderPsych(st); return; }
  // the maze primitives' pitch: a person's look up/down, 0 for an agent; set
  // every frame (the rasterizer keeps it per thread)
  if (typeof mazePitch === 'function') mazePitch(dmLookPitch * Math.PI / 180);
  dmRenderScene(st);
  dmDrawSpawn(st);
  if (!dmHuman) dmDrawHud();
}

function dmRenderScene(st) {
  if (_dmAtlas === null) _dmAtlas = _dmDecode(DM_ATLAS_B64);
  if (DM_LEVEL.kind === 'water') { dmRenderWater(st); return; }
  if (st.maze.flat) { dmRenderBoxes(st); return; }
  if (DM_LEVEL.kind === 'sky') { dmRenderSky(st); return; }
  if (DM_LEVEL.kind === 'keys') { dmRenderKeys(st); return; }
  const m = st.maze;
  if (_dmCellsFor !== m || _dmCellsVersion !== st.cellsVersion) {
    _dmCells = dmPackCells(m, dmShutMask(st));
    _dmCellsFor = m; _dmCellsVersion = st.cellsVersion;
  }
  background(0, 0, 0);
  // Grid x = column, z = row (row 0 is DMLab's north edge), y up, one cell a
  // unit; DMLab yaw is counter-clockwise from east, the primitive's yaw is
  // clockwise from north (-z).
  const ex = F(st.x / DM_CELL);
  const ez = F(m.h - F(st.y / DM_CELL));
  const ey = F((DM_FEET_Z + DM_EYE_HEIGHT - DM_FLOOR_Z) / DM_CELL);
  const yaw = F(F(90 - st.yaw) * F(Math.PI / 180));
  mazeView(_dmCells, m.w, m.h, ex, ey, ez, yaw, DM_VIEW_DIST,
    _dmAtlas, _dmTileWord, DM_ATLAS_COUNT, DM_LEVEL.sky, DM_DECAL_LO, DM_DECAL_HI,
    0, 0, width, height);
  _dmDrawSky(yaw);
  const g = m.goal;
  if (g !== null) {
    mazeSprite(ex, ey, ez, yaw, DM_VIEW_DIST,
      F(g[0] / DM_CELL), F(m.h - F(g[1] / DM_CELL)), 0, DM_LEVEL.goal_size[0], DM_LEVEL.goal_size[1],
      _dmAtlas, DM_ATLAS_TILE, DM_ATLAS_COUNT, DM_LEVEL.goal_tile, 0, 0, width, height);
  }
  for (let i = 0; i < st.items.length; i++) {
    if (!st.alive[i]) continue;
    const it = st.items[i];
    if (it.length >= 8) {
      // a language object: a two-colour tile, coloured as it draws (rs_maze_sprite2)
      mazeSprite2(ex, ey, ez, yaw, DM_VIEW_DIST,
        F(it[0] / DM_CELL), F(m.h - F(it[1] / DM_CELL)), 0, it[3], it[4],
        _dmAtlas, DM_ATLAS_TILE, DM_ATLAS_COUNT, it[2], 0, 0, width, height, it[6], it[7]);
      continue;
    }
    const cat = m.cats[it[2]];
    mazeSprite(ex, ey, ez, yaw, DM_VIEW_DIST,
      F(it[0] / DM_CELL), F(m.h - F(it[1] / DM_CELL)), 0, cat[1], cat[2],
      _dmAtlas, DM_ATLAS_TILE, DM_ATLAS_COUNT, cat[0], 0, 0, width, height);
  }
}

// --- psychlab (T7) -------------------------------------------------------
// The room is a cube panorama around the fixed eye (src/atlas/<level>.js,
// tools/psych_panorama.py); the screen and what it shows are solid quads on
// its plane (DM_LEVEL.screen), drawn over it by rs_maze_pview with the view's
// yaw and pitch. DMLab's HUD goes over the view as translucent cells
// (DM_PSY_HUD, captured with the room).
let _dmPano = null;

// st.screen: [x0, y0, x1, y1, r, g, b] rects in screen units (0..1, y down),
// later ones over earlier ones.
function dmPsychQuads(st) {
  const sc = DM_LEVEL.screen, e = DM_LEVEL.eye;
  const W = sc.x1 - sc.x0, H = sc.z1 - sc.z0;
  const q = new Float32Array(st.screen.length * 12);
  st.screen.forEach(([x0, y0, x1, y1, r, g, b], k) => {
    q.set([sc.x0 + x0 * W - e[0], sc.y - e[1], sc.z1 - y0 * H - e[2],
      (x1 - x0) * W, 0, 0, 0, 0, -(y1 - y0) * H, r, g, b], k * 12);
  });
  return q;
}

function dmRenderPsych(st) {
  if (_dmPano === null) _dmPano = _dmDecode(DM_PANO_B64);
  const q = dmPsychQuads(st);
  mazePview(st.yaw * Math.PI / 180, st.pitch * Math.PI / 180, 1.0, _dmPano, DM_PANO_SIZE,
    q, q.length / 12, 0, 0, width, height);
  const s = width / 64;
  noStroke();
  if (dmHuman) {
    // a person needs to see where they look: a crosshair at the view's centre
    const c = width / 2, l = width / 24, t = Math.max(1, width / 160);
    fill(0, 0, 0, 160);
    rect(c - l - t, c - 2 * t, 2 * (l + t), 4 * t); rect(c - 2 * t, c - l - t, 4 * t, 2 * (l + t));
    fill(255, 255, 255);
    rect(c - l, c - t, 2 * l, 2 * t); rect(c - t, c - l, 2 * t, 2 * l);
    return;
  }
  for (const [r, c, a, cr, cg, cb] of DM_PSY_HUD) {
    fill(cr, cg, cb, Math.round(a * 255));
    rect(c * s, r * s, s, s);
  }
}
