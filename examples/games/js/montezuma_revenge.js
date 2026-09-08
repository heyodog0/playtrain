// montezuma_revenge — gym-gen p5 game (Discrete(8), 64x64 RGB, seeded)
// Conforms to GAME_TEMPLATE.md. "Faithful" = FEEL + a real PUZZLE STRUCTURE:
//   - movement (walk/jump/climb) measured from real ALE RAM capture; committed jumps.
//   - PROCEDURAL map: the seed lays rooms on a tier grid and wires a random (solvable)
//     graph, so the topology VARIES — exit counts differ per room and per seed, and
//     interior rooms can have 3 or 4 exits (left/right/top/bottom). You descend the
//     pyramid, find the KEY (off the direct path), open a LOCKED DOOR, reach the GOAL.
//   - Montezuma elements: ROPES (hang in mid-air, climb UP only, mount/dismount by
//     jumping), a QUICKSAND pit (sink + die if you linger; cross fast or jump), and a
//     DISAPPEARING/REAPPEARING floor (toggles solid<->gone on a timer).
//   - Doors are opened DELIBERATELY: stand at the door with the key and press UP. The
//     key is consumed; only then can you pass.
//   - Death respawns you in the SAME room and removes the hazard that killed you.

// ============================================================
// REQUIRED: seeded RNG (verbatim from template)
// ============================================================
let rng = null;
function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let n = Math.imul(t ^ (t >>> 15), t | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================
// Constants
// ============================================================
const COLS = 16, ROWS = 12;
let cellW, cellH;
const PLAYER_W = 16, PLAYER_H = 28;
const WALK_SPEED = 2.5, CLIMB_SPEED = 2.5, JUMP_V0 = -8.8, GRAVITY = 0.8, FALL_MAX = 10.0;
const LASER_PERIOD = 150, LASER_ON = 55;
const DISAPPEAR_PERIOD = 150, DISAPPEAR_ON = 95;   // solid 95/150 of the cycle
const ROPE_COOLDOWN = 13;                           // frames after leaving a rope before you can re-grab
const ROPE_LAUNCH = 3.8;                            // horizontal leap off a rope (> walk, so you clear the catch zone)
const SQUASH_FRAMES = 6;                            // landing squash duration
const INVULN_FRAMES = 48;                           // mercy invulnerability (with a blink) after respawning
const CONVEYOR_SPEED = 1.4;                         // belt push (< WALK_SPEED so you can walk against it)
const BLINK_PERIOD = 200, BLINK_ON = 135;          // dedicated blink-floor room: solid long enough to cross a half-width

const ROOM_BONUS = 10, KEY_BONUS = 20, UNLOCK_BONUS = 25, GOAL_BONUS = 50;
const JEWEL_BONUS = 3, DEATH_PENALTY = 2, SHAPE = 0.01;

// ============================================================
// State
// ============================================================
let score = 0, lives = 3, gameState = 'PLAYING', frame = 0;
let world = null, roomIndex = 0, visited = [], spawnIdx = 0;
let room = null, player, hasKey = false, bestDist = Infinity;

function setup() { createCanvas(400, 400); }
function getGameState() { return { score: score, lives: lives, gameState: gameState }; }
// horizontal edges pair left<->right, vertical edges pair top<->bottom
function opp(side) { return side === 'left' ? 'right' : side === 'right' ? 'left' : side === 'top' ? 'bottom' : 'top'; }

// ============================================================
// World generation — procedural tier-grid graph (variable topology, solvable)
// ============================================================
function resetGame(seed) {
  rng = mulberry32(seed);
  score = 0; lives = 3; gameState = 'PLAYING'; hasKey = false; frame = 0;
  cellW = width / COLS; cellH = height / ROWS;

  let layout = null;
  for (let attempt = 0; attempt < 16 && !layout; attempt++) layout = tryGenerate();
  if (!layout) layout = fallbackLayout();

  world = { rooms: layout.rooms, n: layout.rooms.length };
  const moving = (h) => h.type === 'skull' || h.type === 'floatskull';
  const hspan = (h) => moving(h) ? [h.lo, h.hi + h.w] : [h.x, h.x + h.w];
  for (const rm of world.rooms) {
    const lad = rm.ladders.map((L) => [L.x, L.x + L.w]);
    // ENEMIES NEVER OVERLAP LADDERS: confine each enemy to the ladder-free segment it sits in
    for (const h of rm.hazards) {
      if (moving(h)) {
        const cx = h.x + h.w / 2; let lo = cellW, hi = (COLS - 1) * cellW - h.w;
        for (const [a, b] of lad) {
          if (b <= cx) lo = Math.max(lo, b);
          else if (a >= cx) hi = Math.min(hi, a - h.w);
          else if (cx - a < b - cx) hi = Math.min(hi, a - h.w); else lo = Math.max(lo, b);   // straddles -> push to nearer side
        }
        h.lo = lo; h.hi = Math.max(lo, hi); h.x = Math.max(h.lo, Math.min(h.hi, h.x));
      } else {   // spider or laser: a fixed x — slide it off any ladder column
        let guard = 0;
        while (lad.some(([a, b]) => h.x + h.w > a && h.x < b) && guard++ < COLS) { h.x += cellW; if (h.x + h.w > (COLS - 1) * cellW) h.x = cellW; }
      }
    }
    // hard guarantee: drop anything (enemy OR laser) still overlapping a ladder after the shift
    rm.hazards = rm.hazards.filter((h) => !lad.some(([a, b]) => { const [s, e] = hspan(h); return e > a && s < b; }));
    // no stacked items: drop jewels whose column overlaps a hazard (e.g. a jewel sitting on a spider)
    rm.jewels = rm.jewels.filter((j) => !rm.hazards.some((h) => { const [a, b] = hspan(h); return j.x + j.w > a && j.x < b; }));
    // remove hazards whose column overlaps the goal, so nothing sits on the treasure
    if (rm.goal) rm.hazards = rm.hazards.filter((h) => { const [a, b] = hspan(h); return !(rm.goal.x + rm.goal.w > a && rm.goal.x < b); });
  }
  visited = new Array(world.n).fill(false);
  spawnIdx = layout.spawnIdx;
  gotoRoom(spawnIdx, 'spawn');
}

function bfs(adj, src, N) {
  const d = new Array(N).fill(Infinity); d[src] = 0; const q = [src]; let h = 0;
  while (h < q.length) { const u = q[h++]; for (const v of adj[u]) if (d[v] === Infinity) { d[v] = d[u] + 1; q.push(v); } }
  return d;
}

// One attempt: spanning tree over a TIERS x WIDE grid + a few extra edges (cycles -> 3/4-exit
// rooms). Goal = farthest degree-1 room reached by a HORIZONTAL edge (so its door is a normal
// vertical door); that edge is LOCKED. Key = farthest other room. Returns null to retry.
function tryGenerate() {
  const TIERS = rng() < 0.5 ? 2 : 3;
  const WIDE = 3;                                            // >=6 rooms, so there's always room for a blink + laser room
  const N = TIERS * WIDE;
  if (N < 3) return null;
  const id = (t, c) => t * WIDE + c;
  const cellOf = (i) => [Math.floor(i / WIDE), i % WIDE];
  const adj = Array.from({ length: N }, () => []);

  // randomized-DFS spanning tree; spawn at the top tier
  const seen = new Set();
  const startC = Math.floor(rng() * WIDE);
  const spawnIdx = id(0, startC);
  const stack = [[0, startC]]; seen.add(spawnIdx);
  while (stack.length) {
    const [t, c] = stack[stack.length - 1];
    const nb = [];
    for (const [dt, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nt = t + dt, nc = c + dc;
      if (nt >= 0 && nt < TIERS && nc >= 0 && nc < WIDE && !seen.has(id(nt, nc))) nb.push([nt, nc]);
    }
    if (!nb.length) { stack.pop(); continue; }
    const [nt, nc] = nb[Math.floor(rng() * nb.length)];
    seen.add(id(nt, nc));
    adj[id(t, c)].push(id(nt, nc)); adj[id(nt, nc)].push(id(t, c));
    stack.push([nt, nc]);
  }

  const dist = bfs(adj, spawnIdx, N);
  const isHoriz = (a, b) => cellOf(a)[0] === cellOf(b)[0];
  let goalIdx = -1, best = -1;
  for (let i = 0; i < N; i++) {
    if (i === spawnIdx || adj[i].length !== 1) continue;
    if (!isHoriz(i, adj[i][0])) continue;
    if (dist[i] > best) { best = dist[i]; goalIdx = i; }
  }
  if (goalIdx < 0) return null;
  const goalParent = adj[goalIdx][0];

  // extra edges -> cycles -> multi-exit rooms (never touch the goal, keep it degree-1)
  for (let i = 0; i < N; i++) for (const [dt, dc] of [[1, 0], [0, 1]]) {
    const [t, c] = cellOf(i), nt = t + dt, nc = c + dc;
    if (nt < 0 || nt >= TIERS || nc < 0 || nc >= WIDE) continue;
    const j = id(nt, nc);
    if (adj[i].includes(j) || i === goalIdx || j === goalIdx) continue;
    if (rng() < 0.45) { adj[i].push(j); adj[j].push(i); }
  }

  let keyIdx = -1, kb = -1;
  for (let i = 0; i < N; i++) { if (i === spawnIdx || i === goalIdx || i === goalParent) continue; if (dist[i] > kb) { kb = dist[i]; keyIdx = i; } }   // never in the door room
  if (keyIdx < 0) return null;

  const sideBetween = (a, b) => { const [ta, ca] = cellOf(a), [tb, cb] = cellOf(b); return ta === tb ? (cb > ca ? 'right' : 'left') : (tb > ta ? 'bottom' : 'top'); };

  // resolve each room's exits + which is the locked door
  const sidesOf = [], lockedOf = [];
  for (let i = 0; i < N; i++) {
    const sides = {};
    for (const j of adj[i]) sides[sideBetween(i, j)] = { to: j, toSide: opp(sideBetween(i, j)) };
    sidesOf[i] = sides; lockedOf[i] = i === goalParent ? sideBetween(i, goalIdx) : null;
  }

  // "plain" rooms (not spawn/key/goal/door) get assigned room TYPES — blink + laser GUARANTEED,
  // the rest filled with rope / platform / hallway variety.
  const plainIdx = [];
  for (let i = 0; i < N; i++) if (!(i === spawnIdx || i === goalIdx || i === keyIdx || lockedOf[i])) plainIdx.push(i);
  for (let k = plainIdx.length - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); [plainIdx[k], plainIdx[j]] = [plainIdx[j], plainIdx[k]]; }
  if (plainIdx.length < 2) return null;                      // need at least a blink + a laser room
  const fillers = ['platform', 'platform', 'rope', 'hallway', 'normal'];   // platform-heavy filler mix
  const styleOf = {};
  plainIdx.forEach((idx, k) => { styleOf[idx] = k === 0 ? 'blink' : k === 1 ? 'laser' : fillers[Math.floor(rng() * fillers.length)]; });

  const rooms = new Array(N);
  for (let i = 0; i < N; i++) {
    const sides = sidesOf[i], skeys = Object.keys(sides), lockedSide = lockedOf[i], st = styleOf[i];
    let rm;
    if (i === keyIdx) rm = buildPlatformRoom(skeys, { hasKeyHere: true });            // KEY always in a platforming room
    else if (i === spawnIdx || i === goalIdx || lockedSide) rm = buildRoom(skeys, { isSpawn: i === spawnIdx, isGoal: i === goalIdx, lockedSide });
    else if (st === 'blink') rm = buildBlinkRoom(skeys);
    else if (st === 'laser') rm = buildLaserRoom(skeys);
    else if (st === 'hallway') rm = buildHallway(skeys);
    else if (st === 'rope' && sides.left && sides.right) rm = buildRopeRoom(skeys);
    else if (st === 'platform') rm = buildPlatformRoom(skeys);
    else rm = buildRoom(skeys, {});
    rooms[i] = rm;
    rooms[i].exits = sides;
    if (lockedSide) rooms[i].exits[lockedSide].locked = true;
  }
  return { rooms, spawnIdx };
}

// minimal guaranteed-solvable chain, used only if generation keeps failing
function fallbackLayout() {
  const r0 = buildRoom(['right'], { isSpawn: true });
  const r1 = buildRoom(['left', 'right'], { hasKeyHere: true, lockedSide: 'right' });
  const r2 = buildRoom(['left'], { isGoal: true });
  r0.exits = { right: { to: 1, toSide: 'left' } };
  r1.exits = { left: { to: 0, toSide: 'right' }, right: { to: 2, toSide: 'left', locked: true } };
  r2.exits = { left: { to: 1, toSide: 'right' } };
  return { rooms: [r0, r1, r2], spawnIdx: 0 };
}

// ============================================================
// Room construction — one floor + ladders/ropes for vertical exits; every exit reaches
// the floor, so any exit-set is internally traversable. Then decorate (hazards/sand/etc).
// ============================================================
function blankGrid() {
  const g = Array.from({ length: ROWS }, () => Array(COLS).fill('.'));
  for (let c = 0; c < COLS; c++) g[0][c] = '#';
  for (let r = 0; r < ROWS; r++) { g[r][0] = '#'; g[r][COLS - 1] = '#'; }
  return g;
}
const Hh = (g, r, c0, c1) => { for (let c = Math.max(1, c0); c <= Math.min(COLS - 2, c1); c++) g[r][c] = '#'; };

function buildRoom(sides, opts) {
  opts = opts || {};
  const g = blankGrid();
  const mrow = 6 + Math.floor(rng() * 3);               // floor row 6..8
  Hh(g, mrow, 1, COLS - 2);
  const openings = {};
  if (sides.includes('left')) { g[mrow - 1][0] = '.'; openings.left = mrow; }
  if (sides.includes('right')) { g[mrow - 1][COLS - 1] = '.'; openings.right = mrow; }

  const used = [];
  const pickCol = () => { let c, k = 0; do { c = 3 + Math.floor(rng() * (COLS - 6)); k++; } while (used.some((u) => Math.abs(u - c) < 2) && k < 20); used.push(c); return c; };
  if (sides.includes('top')) { const uc = pickCol(); for (let r = 0; r < mrow; r++) g[r][uc] = 'H'; openings.top = uc; }     // up-ladder to the ceiling opening
  if (sides.includes('bottom')) { const dc = pickCol(); for (let r = mrow; r < ROWS; r++) g[r][dc] = 'H'; openings.bottom = dc; } // down-ladder to the bottom edge

  const onFloor = (c) => g[mrow][c] === '#' && g[mrow - 1][c] === '.';
  const safeCol = (c) => { for (let d = 0; d < COLS; d++) { if (onFloor(c)) return c; c = c >= COLS - 2 ? 2 : c + 1; } return c; };
  if (opts.isSpawn) g[mrow - 1][safeCol(2 + Math.floor(rng() * (COLS - 4)))] = 'P';
  if (opts.hasKeyHere) g[mrow - 1][safeCol(2 + Math.floor(rng() * (COLS - 4)))] = 'K';
  if (opts.isGoal) g[mrow - 1][safeCol(2 + Math.floor(rng() * (COLS - 4)))] = 'G';

  // floor decorations: at most one of {quicksand, disappearing floor}, plus an optional rope.
  // pick a 2-3 cell clear span of floor not under a marker/ladder hole.
  const clearSpan = (len) => {
    const starts = [];
    for (let c = 2; c <= COLS - 2 - len; c++) { let ok = true; for (let k = 0; k < len; k++) if (!(onFloor(c + k) && '#'.includes(g[mrow][c + k]) && g[mrow - 1][c + k] === '.')) ok = false; if (ok) starts.push(c); }
    return starts.length ? starts[Math.floor(rng() * starts.length)] : -1;
  };
  // floor decorations: LETHAL sand (jump over it) or a conveyor belt (common). Disappearing
  // floors and purposeful ropes get their own dedicated room types (below).
  const sand = [], conveyors = [], extraRopes = [];
  if (!opts.isSpawn && !opts.isGoal) {                       // goal room stays bare: just the treasure
    const roll = rng();
    if (roll < 0.28) {
      const len = 2 + (rng() < 0.5 ? 1 : 0), c0 = clearSpan(len);
      if (c0 >= 0) {
        sand.push({ x: c0 * cellW, y: mrow * cellH - 4, w: len * cellW, h: 10 });
        const rc = c0 + Math.floor(len / 2);                 // a rope over the sand so it's always crossable
        extraRopes.push({ x: rc * cellW, w: cellW, topY: cellH, botY: mrow * cellH - 6 });   // hangs almost to the ground
      }
    } else if (roll < 0.68) { const len = 3 + Math.floor(rng() * 3), c0 = clearSpan(len); if (c0 >= 0) conveyors.push({ x: c0 * cellW, y: mrow * cellH - 3, w: len * cellW, h: 9, dir: rng() < 0.5 ? -1 : 1 }); }
  }

  const parsed = parseGrid(g);
  for (const rp of extraRopes) parsed.ropes.push(rp);
  const r = baseRoom(parsed, openings);
  r.isGoal = !!opts.isGoal;
  r.sand = sand;
  r.conveyors = conveyors;
  if (opts.lockedSide === 'left' || opts.lockedSide === 'right') {
    const s = opts.lockedSide;
    r.door = { x: s === 'left' ? 0 : (COLS - 1) * cellW, y: (mrow - 1) * cellH, w: cellW, h: cellH, side: s };
  }
  if (!opts.isSpawn && !opts.isGoal && rng() < 0.6) { const col = 4 + Math.floor(rng() * (COLS - 8)); const h = mkHazard(rollKind(), col, mrow); if (h) r.hazards.push(h); }
  r.jewels = opts.isGoal ? [] : jewelsOnLedge(g, mrow, 2, COLS - 3, 1 + Math.floor(rng() * 2));
  return r;
}

// DEDICATED disappearing-floor room (left+right, never bottom): solid floor on the outer
// ~25% each side, a CENTERED ~50% blink zone on a LONG cycle, and a lethal SAND PIT below it.
// Walk the solid side, time your dash across the blink zone; mistime it and you fall into sand.
function buildBlinkRoom(sides) {
  const g = blankGrid();
  const mrow = 6 + Math.floor(rng() * 2);
  const bL = 5, bR = 10;                                      // central blink zone cols 5..10 (~50%)
  Hh(g, mrow, 1, bL - 1); Hh(g, mrow, bR + 1, COLS - 2);      // solid side floors
  const openings = {};
  if (sides.includes('left')) { g[mrow - 1][0] = '.'; openings.left = mrow; }
  if (sides.includes('right')) { g[mrow - 1][COLS - 1] = '.'; openings.right = mrow; }
  if (sides.includes('top')) { for (let r = 0; r < mrow; r++) g[r][2] = 'H'; openings.top = 2; }              // ladder up the LEFT solid side
  if (sides.includes('bottom')) { for (let r = mrow; r < ROWS; r++) g[r][COLS - 3] = 'H'; openings.bottom = COLS - 3; }  // down the RIGHT solid side (clear of the pit)
  const r = baseRoom(parseGrid(g), openings);
  const phase = Math.floor(rng() * BLINK_PERIOD);
  r.disappearing = [{ x: bL * cellW, y: mrow * cellH, w: (bR - bL + 1) * cellW, h: cellH, phase, period: BLINK_PERIOD, on: BLINK_ON }];
  r.sand = [{ x: bL * cellW, y: (ROWS - 1) * cellH, w: (bR - bL + 1) * cellW, h: cellH }];   // lethal pit under the blink zone
  if (rng() < 0.6) r.jewels = jewelsOnLedge(g, mrow, 1, bL - 1, 1);
  return r;
}

// DEDICATED rope room: a lethal gap splits the floor; the ROPE is the only bridge. Jump onto
// it, jump off to the far platform (which holds a reward / the onward exit). Purposeful ropes.
function buildRopeRoom(sides) {
  const g = blankGrid();
  const mrow = 6 + Math.floor(rng() * 2);
  const g0 = 5 + Math.floor(rng() * 2), gw = 3, g1 = g0 + gw - 1;   // 3-cell lethal gap
  for (let c = 1; c < g0; c++) g[mrow][c] = '#';
  for (let c = g1 + 1; c <= COLS - 2; c++) g[mrow][c] = '#';
  g[mrow - 1][0] = '.'; g[mrow - 1][COLS - 1] = '.';
  const openings = { left: mrow, right: mrow };
  if (sides.includes('top')) { const uc = 2 + Math.floor(rng() * 2); for (let r = 0; r < mrow; r++) g[r][uc] = 'H'; openings.top = uc; }
  if (sides.includes('bottom')) { const dc = COLS - 4 - Math.floor(rng() * 2); for (let r = mrow; r < ROWS; r++) g[r][dc] = 'H'; openings.bottom = dc; }
  const parsed = parseGrid(g);
  const rc = Math.floor((g0 + g1) / 2);
  parsed.ropes.push({ x: rc * cellW, w: cellW, topY: cellH, botY: mrow * cellH - 6 });   // hangs over the gap, almost to the ground
  const r = baseRoom(parsed, openings);
  r.jewels = jewelsOnLedge(g, mrow, g1 + 1, COLS - 2, 1);    // reward on the far platform
  if (rng() < 0.4) { const h = mkHazard('spider', g1 + 2, mrow); if (h) r.hazards.push(h); }
  return r;
}

// DEDICATED laser-gate room (the Montezuma corridor): solid floor, 3-4 full-height vertical
// laser gates spaced across it and PHASED into a wave, so you run through as each one blinks off.
function buildLaserRoom(sides) {
  const g = blankGrid();
  const mrow = 7 + Math.floor(rng() * 2);
  Hh(g, mrow, 1, COLS - 2);
  const openings = {}, ladderCols = [];
  if (sides.includes('left')) { g[mrow - 1][0] = '.'; openings.left = mrow; }
  if (sides.includes('right')) { g[mrow - 1][COLS - 1] = '.'; openings.right = mrow; }
  if (sides.includes('top')) { for (let r = 0; r < mrow; r++) g[r][2] = 'H'; openings.top = 2; ladderCols.push(2); }
  if (sides.includes('bottom')) { const dc = COLS - 3; for (let r = mrow; r < ROWS; r++) g[r][dc] = 'H'; openings.bottom = dc; ladderCols.push(dc); }
  const r = baseRoom(parseGrid(g), openings);
  const ng = 3 + Math.floor(rng() * 2), gap = Math.floor((COLS - 7) / (ng - 1));
  for (let i = 0; i < ng; i++) {
    let c = 3 + i * gap;
    if (ladderCols.includes(c)) c += (c < COLS - 3 ? 1 : -1);     // don't drop a gate onto a ladder
    r.hazards.push({ type: 'laser', x: c * cellW + cellW / 2 - 4, y: cellH, w: 8, h: (mrow - 1) * cellH, phase: Math.floor(i * LASER_PERIOD / ng), dead: false });
  }
  return r;
}

// DEDICATED platforming room (the central-room feel): a top platform, two mid ledges, and a
// bottom floor with a patrolling skull, all laced with ladders. Left/right exits at the bottom.
function buildPlatformRoom(sides, opts) {
  opts = opts || {};
  const g = blankGrid();
  const mt = 3, mm = 6, mb = 9;
  Hh(g, mb, 1, COLS - 2);                                     // bottom floor
  Hh(g, mm, 1, 5); Hh(g, mm, 10, COLS - 2);                   // two mid ledges
  Hh(g, mt, 5, 10);                                           // top platform (center)
  for (let r = mt; r < mb; r++) g[r][7] = 'H';                // center ladder: top platform -> bottom
  for (let r = mm; r < mb; r++) g[r][3] = 'H';                // left ladder: mid-left -> bottom
  for (let r = mm; r < mb; r++) g[r][12] = 'H';               // right ladder: mid-right -> bottom
  const openings = {};
  if (sides.includes('left')) { g[mb - 1][0] = '.'; openings.left = mb; }
  if (sides.includes('right')) { g[mb - 1][COLS - 1] = '.'; openings.right = mb; }
  if (sides.includes('top')) { for (let r = 0; r < mt; r++) g[r][8] = 'H'; openings.top = 8; }
  if (sides.includes('bottom')) { for (let r = mb; r < ROWS; r++) g[r][13] = 'H'; openings.bottom = 13; }
  if (opts.hasKeyHere) g[mt - 1][6] = 'K';                    // KEY perched on the top platform — climb for it
  const parsed = parseGrid(g);
  parsed.ropes.push({ x: 9 * cellW, w: cellW, topY: (mt + 1) * cellH, botY: mb * cellH - 6 });   // rope down the central gap
  const r = baseRoom(parsed, openings);
  r.hazards = [makeSkull(2, COLS - 3, mb)];
  r.jewels = jewelsOnLedge(g, mm, 1, 5, 1).concat(jewelsOnLedge(g, mt, 5, 10, opts.hasKeyHere ? 0 : 1)).concat(jewelsOnLedge(g, mm, 10, COLS - 2, 1));
  if (rng() < 0.4) { const c0 = 2 + Math.floor(rng() * 3); r.conveyors.push({ x: c0 * cellW, y: mb * cellH - 3, w: 4 * cellW, h: 9, dir: rng() < 0.5 ? -1 : 1 }); }
  return r;
}

// HALLWAY filler: a plain corridor that carries an enemy (often a floating skull) and sometimes a
// laser gate — connective tissue between the set-piece rooms, honoring whatever exits it has.
function buildHallway(sides) {
  const g = blankGrid();
  const mrow = 6 + Math.floor(rng() * 3);
  Hh(g, mrow, 1, COLS - 2);
  const openings = {}, ladderCols = [];
  if (sides.includes('left')) { g[mrow - 1][0] = '.'; openings.left = mrow; }
  if (sides.includes('right')) { g[mrow - 1][COLS - 1] = '.'; openings.right = mrow; }
  if (sides.includes('top')) { for (let r = 0; r < mrow; r++) g[r][2] = 'H'; openings.top = 2; ladderCols.push(2); }
  if (sides.includes('bottom')) { const dc = COLS - 3; for (let r = mrow; r < ROWS; r++) g[r][dc] = 'H'; openings.bottom = dc; ladderCols.push(dc); }
  const r = baseRoom(parseGrid(g), openings);
  const roll = rng();
  if (roll < 0.45) r.hazards.push(makeFloatSkull(4, COLS - 4, mrow));
  else if (roll < 0.85) r.hazards.push(makeSkull(4, COLS - 4, mrow));
  if (rng() < 0.4) { let c = 8; if (!ladderCols.includes(c)) r.hazards.push({ type: 'laser', x: c * cellW + cellW / 2 - 4, y: cellH, w: 8, h: (mrow - 1) * cellH, phase: Math.floor(rng() * LASER_PERIOD), dead: false }); }
  r.jewels = jewelsOnLedge(g, mrow, 2, COLS - 3, 1);
  return r;
}

// --- parse: '#' block · 'H' ladder · 'r' rope · 'P'/'K'/'G' markers ('d' = disappearing, skipped) ---
function parseGrid(g) {
  const R = g.length, C = g[0].length;
  const blocks = [], ladders = [], ropes = [];
  let key = null, goal = null, spawn = null;
  for (let r = 0; r < R; r++) { let c = 0; while (c < C) { if (g[r][c] === '#') { const c0 = c; while (c < C && g[r][c] === '#') c++; blocks.push({ x: c0 * cellW, y: r * cellH, w: (c - c0) * cellW, h: cellH }); } else c++; } }
  for (let c = 0; c < C; c++) { let r = 0; while (r < R) { if (g[r][c] === 'H') { const r0 = r; while (r < R && g[r][c] === 'H') r++; ladders.push({ x: c * cellW, w: cellW, topY: r0 * cellH, botY: r * cellH }); } else r++; } }
  for (let c = 0; c < C; c++) { let r = 0; while (r < R) { if (g[r][c] === 'r') { const r0 = r; while (r < R && g[r][c] === 'r') r++; ropes.push({ x: c * cellW, w: cellW, topY: r0 * cellH, botY: r * cellH }); } else r++; } }
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const ch = g[r][c], cx = (c + 0.5) * cellW;
    if (ch === 'P') spawn = { x: c * cellW + (cellW - PLAYER_W) / 2, y: (r + 1) * cellH - PLAYER_H };
    else if (ch === 'K') key = { x: cx - 7, y: (r + 1) * cellH - 14, w: 14, h: 14, taken: false };
    else if (ch === 'G') goal = { x: cx - 9, y: (r + 1) * cellH - 18, w: 18, h: 18 };
  }
  return { blocks, ladders, ropes, key, goal, spawn };
}

function jewelsOnLedge(g, row, c0, c1, n) {
  const cand = [];
  for (let c = Math.max(1, c0); c <= Math.min(COLS - 2, c1); c++) if (g[row][c] === '#' && g[row - 1][c] === '.') cand.push(c);
  for (let k = cand.length - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); [cand[k], cand[j]] = [cand[j], cand[k]]; }
  // float them above the ledge (bottom clears a standing player) so you must JUMP to collect
  return cand.slice(0, n).map((c) => ({ x: (c + 0.5) * cellW - 6, y: row * cellH - 48, w: 12, h: 12, taken: false }));
}

function baseRoom(parsed, openings) {
  return { ...parsed, hazards: [], jewels: [], sand: [], conveyors: [], disappearing: [], door: null, openings, exits: {}, unlocked: false, isGoal: false, lastEnter: 'spawn' };
}

function makeSkull(loCol, hiCol, row) {
  const w = 18, lo = loCol * cellW, hi = Math.max(lo + 1, hiCol * cellW - w);
  return { type: 'skull', w, h: w, x: (lo + hi) / 2, y: row * cellH - w, lo, hi, vx: (rng() < 0.5 ? -1 : 1) * (0.6 + rng() * 0.4), dead: false };
}
// floating skull: bobs UP AND DOWN (and drifts slowly sideways) — time your dash under it when it's high
function makeFloatSkull(loCol, hiCol, row) {
  const w = 18, lo = loCol * cellW, hi = Math.max(lo + 1, hiCol * cellW - w), baseY = row * cellH - 30;
  return { type: 'floatskull', w, h: w, x: (lo + hi) / 2, y: baseY, lo, hi, vx: (rng() < 0.5 ? -1 : 1) * (0.45 + rng() * 0.35),
    ylo: baseY - 22, yhi: baseY + 10, vy: (rng() < 0.5 ? -1 : 1) * 1.1, dead: false };
}
function mkHazard(kind, col, row) {
  if (kind === 'laser') return { type: 'laser', x: col * cellW + cellW / 2 - 4, y: (row - 3) * cellH, w: 8, h: 3 * cellH, phase: 0, dead: false };
  if (kind === 'skull') return makeSkull(Math.max(1, col - 1), Math.min(COLS - 2, col + 2), row);
  if (kind === 'spider') return { type: 'spider', x: (col + 0.5) * cellW - 10, y: row * cellH - 16, w: 20, h: 16, dead: false };
  return null;
}
function rollKind() { return ['laser', 'laser', 'skull', 'spider'][Math.floor(rng() * 4)]; }

// ============================================================
// Room loading / transitions
// ============================================================
function gotoRoom(i, enterSide) {
  roomIndex = i;
  room = world.rooms[i];
  room.lastEnter = enterSide;
  let px, py, climbing = false;
  if (enterSide === 'spawn') { px = room.spawn.x; py = room.spawn.y; }
  else if (enterSide === 'left') { px = cellW; py = room.openings.left * cellH - PLAYER_H; }
  else if (enterSide === 'right') { px = width - cellW - PLAYER_W; py = room.openings.right * cellH - PLAYER_H; }
  else if (enterSide === 'top') { px = (room.openings.top + 0.5) * cellW - PLAYER_W / 2; py = 6; climbing = true; }
  else { px = (room.openings.bottom + 0.5) * cellW - PLAYER_W / 2; py = height - PLAYER_H - 6; climbing = true; }
  player = { x: px, y: py, vx: 0, vy: 0, w: PLAYER_W, h: PLAYER_H, supported: !climbing, climbing, climbingRope: false, rope: null, ropeCooldown: 0, sinkT: 0, facing: 1, squashT: 0, invT: 0 };
  if (!visited[i]) { visited[i] = true; if (i !== spawnIdx) score += ROOM_BONUS; }
  bestDist = distToSubgoal();
}

function activeBlocks() {
  const out = room.blocks.slice();
  if (room.door && !room.unlocked) out.push(room.door);
  for (const d of room.disappearing) if (((frame + d.phase) % (d.period || DISAPPEAR_PERIOD)) < (d.on || DISAPPEAR_ON)) out.push(d);
  return out;
}

// ============================================================
// Helpers
// ============================================================
function AABB(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
function centerX(o) { return o.x + o.w / 2; }
function centerY(o) { return o.y + o.h / 2; }
function subgoalPoint() {
  if (room.key && !room.key.taken) return { x: centerX(room.key), y: centerY(room.key) };
  if (room.goal) return { x: centerX(room.goal), y: centerY(room.goal) };
  return null;
}
function distToSubgoal() { const s = subgoalPoint(); return s ? Math.abs(centerX(player) - s.x) + Math.abs(centerY(player) - s.y) : Infinity; }

function startClimb(L) { player.climbing = true; player.x = L.x + L.w / 2 - player.w / 2; player.vx = 0; player.vy = 0; }
function ladderAt(p) { const cx = centerX(p); for (const L of room.ladders) if (cx >= L.x && cx <= L.x + L.w && p.y + p.h >= L.topY - 6 && p.y <= L.botY + 6) return L; return null; }
function ropeAt(p) { const cx = centerX(p); for (const R of room.ropes) if (cx >= R.x - 8 && cx <= R.x + R.w + 8 && p.y + p.h >= R.topY && p.y <= R.botY) return R; return null; }
function doorAdjacent() { if (!room.door) return false; const d = room.door; return AABB(player, { x: d.x - 8, y: d.y - 4, w: d.w + 16, h: d.h + 8 }); }

// ============================================================
// Main loop
// ============================================================
function draw() {
  if (gameState !== 'PLAYING') return;
  frame++;
  if (player.ropeCooldown > 0) player.ropeCooldown--;
  if (player.squashT > 0) player.squashT--;
  if (player.invT > 0) player.invT--;

  const L = ladderAt(player);
  const up = keyIsDown(38), down = keyIsDown(40), lf = keyIsDown(37), rt = keyIsDown(39), jump = keyIsDown(32);
  const jumpNewlyPressed = jump && !player.lastJump;
  player.lastJump = jump;

  if (lf) player.facing = -1; else if (rt) player.facing = 1;
  const cols = activeBlocks();

  // touch the locked door with the key in hand and it opens (consumes the key)
  if (room.door && !room.unlocked && hasKey && doorAdjacent()) {
    room.unlocked = true; hasKey = false; score += UNLOCK_BONUS;
  }

  if (L && !player.climbing && !player.climbingRope) {
    if (up && player.y + player.h > L.topY + 2) startClimb(L);
    else if (down && player.y + player.h < L.botY - 2) startClimb(L);
  }
  if (player.climbing && (lf || rt)) player.climbing = false;
  if (!L) player.climbing = false;

  if (player.climbingRope) {
    const R = player.rope;
    if (up) player.y -= CLIMB_SPEED;                                            // climb UP only
    if (player.y < R.topY) player.y = R.topY;
    if (player.y + player.h > R.botY) player.y = R.botY - player.h;
    if (jump) { player.climbingRope = false; player.vy = JUMP_V0; player.vx = rt ? ROPE_LAUNCH : lf ? -ROPE_LAUNCH : 0; player.supported = false; player.ropeCooldown = ROPE_COOLDOWN; }
    else if (lf || rt) { player.climbingRope = false; player.vx = rt ? ROPE_LAUNCH : -ROPE_LAUNCH; player.vy = JUMP_V0 * 0.4; player.supported = false; player.ropeCooldown = ROPE_COOLDOWN; }
  } else if (player.climbing) {
    if (up) player.y -= CLIMB_SPEED;
    if (down) player.y += CLIMB_SPEED;
    if (player.y + player.h <= L.topY) { player.y = L.topY - player.h; player.climbing = false; player.supported = true; }
    else if (player.y + player.h >= L.botY) { player.y = L.botY - player.h; player.climbing = false; player.supported = true; }
  } else {
    const wasSup = player.supported;
    if (player.supported) { let t = 0; if (lf) t = -WALK_SPEED; if (rt) t = WALK_SPEED; player.vx = t; }
    if (jump && player.supported) { player.vy = JUMP_V0; player.supported = false; }

    if (!wasSup && !player.supported && jumpNewlyPressed) {
      let touchDir = 0;
      player.x -= 2; for (const b of cols) if (AABB(player, b)) touchDir = -1; player.x += 2;
      if (touchDir === 0) {
        player.x += 2; for (const b of cols) if (AABB(player, b)) touchDir = 1; player.x -= 2;
      }
      if (touchDir === -1 && lf) {
        player.vy = JUMP_V0; player.vx = WALK_SPEED; player.facing = 1;
      } else if (touchDir === 1 && rt) {
        player.vy = JUMP_V0; player.vx = -WALK_SPEED; player.facing = -1;
      }
    }

    player.vy += GRAVITY; if (player.vy > FALL_MAX) player.vy = FALL_MAX;

    player.x += player.vx;
    for (const b of cols) if (AABB(player, b)) { if (player.vx > 0) player.x = b.x - player.w; else if (player.vx < 0) player.x = b.x + b.w; player.vx = 0; }
    const fellV = player.vy;
    player.y += player.vy;
    player.supported = false;
    for (const b of cols) if (AABB(player, b)) {
      if (player.vy > 0) { player.y = b.y - player.h; player.supported = true; }
      else if (player.vy < 0) player.y = b.y + b.h;
      player.vy = 0;
    }
    if (!wasSup && player.supported && fellV > 3) player.squashT = SQUASH_FRAMES;   // squash on landing
    // ladder top is standable (player narrower than the ladder cell), so you can step/jump off it
    if (!player.supported && player.vy >= 0 && !down) {
      const cx = centerX(player);
      for (const Lr of room.ladders) if (cx >= Lr.x && cx <= Lr.x + Lr.w && player.y + player.h >= Lr.topY - 2 && player.y + player.h <= Lr.topY + 8) { player.y = Lr.topY - player.h; player.vy = 0; player.supported = true; break; }
    }
    // grab a mid-air rope (it hangs over a gap; this is how you cross)
    if (!player.supported && player.ropeCooldown <= 0) {
      const Rp = ropeAt(player);
      if (Rp) { player.climbingRope = true; player.rope = Rp; player.x = Rp.x + Rp.w / 2 - player.w / 2; player.vx = 0; player.vy = 0; }
    }
  }

  // CONVEYOR BELT: while standing on a belt you're pushed sideways (walk against it to resist)
  if (player.supported) for (const cv of room.conveyors) if (AABB(player, cv)) {
    player.x += cv.dir * CONVEYOR_SPEED;
    for (const b of cols) if (AABB(player, b)) { if (cv.dir > 0) player.x = b.x - player.w; else player.x = b.x + b.w; }
    break;
  }
  // QUICKSAND: lethal on contact — you must jump over it
  for (const sd of room.sand) if (AABB(player, sd)) { loseLife(null); if (gameState !== 'PLAYING') return; renderAndShape(); return; }

  if (player.y > height) { loseLife(null); if (gameState !== 'PLAYING') return; renderAndShape(); return; }

  for (const h of room.hazards) {
    if (h.dead) continue;
    const vuln = player.invT <= 0;
    if (h.type === 'laser') { if (((frame + h.phase) % LASER_PERIOD) < LASER_ON && vuln && AABB(player, h)) loseLife(h); }
    else if (h.type === 'skull') { h.x += h.vx; if (h.x <= h.lo || h.x >= h.hi) { h.vx *= -1; h.x += h.vx; } if (vuln && AABB(player, h)) loseLife(h); }
    else if (h.type === 'floatskull') { h.x += h.vx; if (h.x <= h.lo || h.x >= h.hi) { h.vx *= -1; h.x += h.vx; } h.y += h.vy; if (h.y <= h.ylo || h.y >= h.yhi) { h.vy *= -1; h.y += h.vy; } if (vuln && AABB(player, h)) loseLife(h); }
    else if (h.type === 'spider') { if (vuln && AABB(player, h)) loseLife(h); }
    if (gameState !== 'PLAYING') return;
  }

  for (const j of room.jewels) if (!j.taken && AABB(player, j)) { j.taken = true; score += JEWEL_BONUS; }
  if (room.key && !room.key.taken && AABB(player, room.key)) { room.key.taken = true; hasKey = true; score += KEY_BONUS; bestDist = distToSubgoal(); }
  if (room.goal && AABB(player, room.goal)) { score += GOAL_BONUS; gameState = 'WIN'; return; }

  handleTransitions();
  if (gameState !== 'PLAYING') return;
  renderAndShape();
}

function renderAndShape() {
  const d = distToSubgoal();
  if (d < bestDist) { score += (bestDist - d) * SHAPE; bestDist = d; }
  render();
}

function handleTransitions() {
  const feet = player.y + player.h, cx = centerX(player);
  for (const side of ['left', 'right']) {
    const ex = room.exits[side];
    if (!ex || room.openings[side] == null) continue;
    const atEdge = side === 'right' ? (player.x + player.w >= width - 1) : (player.x <= 1);
    if (!atEdge) continue;
    if (Math.abs(feet - room.openings[side] * cellH) >= cellH) continue;
    if (ex.locked && !room.unlocked) continue;          // door must be opened deliberately first
    gotoRoom(ex.to, ex.toSide);
    return;
  }
  const tx = room.exits.top;
  if (tx && room.openings.top != null && (!tx.locked || room.unlocked) && player.y <= 2 && Math.abs(cx - (room.openings.top + 0.5) * cellW) < cellW) { gotoRoom(tx.to, tx.toSide); return; }
  const bx = room.exits.bottom;
  if (bx && room.openings.bottom != null && (!bx.locked || room.unlocked) && feet >= height - 2 && Math.abs(cx - (room.openings.bottom + 0.5) * cellW) < cellW) { gotoRoom(bx.to, bx.toSide); return; }
}

function loseLife(killer) {
  if (gameState !== 'PLAYING') return;
  lives -= 1; score -= DEATH_PENALTY;
  if (killer && (killer.type === 'skull' || killer.type === 'floatskull' || killer.type === 'spider')) killer.dead = true;   // only enemies vanish (not lasers)
  if (lives <= 0) { gameState = 'GAMEOVER'; return; }
  gotoRoom(roomIndex, room.lastEnter);                  // respawn in the SAME room
  player.invT = INVULN_FRAMES;                          // brief mercy invulnerability
}

// ============================================================
// Render
// ============================================================
// Palette: verified RGBs sampled from real ALE frame captures (the green level).
// wall/key/joe/skull are bit-exact to the 2600; gym-only abstractions take distinct hues.
const PAL = {
  bg:     [  0,   0,   0],   // black
  ladder: [ 66, 158, 130],   // ladder — same green as the walls (the rail+rung shape sets it apart)
  wall:   [ 66, 158, 130],   // green platform
  rope:   [180, 140,  90],   // hanging rope (tan)
  sand:   [205, 175, 105],   // quicksand (lethal)
  ghost:  [110, 140, 200],   // disappearing floor (blue-ish; reads as "temporary")
  beltL:  [110, 110, 170],   // conveyor pushing left (cool)
  beltR:  [170, 130, 110],   // conveyor pushing right (warm)
  key:    [232, 204,  99],   // key gold
  joe:    [200,  72,  72],   // Panama Joe — shirt
  skin:   [230, 184, 140],   // Joe — head/limbs
  skull:  [236, 236, 236],   // skull
  door:   [150,  60, 220],   // locked door (purple)
  jewel:  [120, 200, 255],   // jewel
  goal:   [ 60, 230, 200],   // treasure (cyan)
  spider: [110, 215,  95],   // spider (green)
  laser:  [255,  80, 180],   // laser gate (pink)
  dim:    [ 60,  60,  70],   // unvisited room marker
};
function fillc(c) { fill(c[0], c[1], c[2]); }

// Panama Joe — minimal blocky figure with run/jump poses + a landing squash. Only rect/fill so
// it also runs under the headless validator (which stubs p5 to rect/ellipse/fill).
function drawPlayer() {
  const p = player;
  if (p.invT > 0 && Math.floor(frame / 4) % 2 === 0) return;     // blink while invulnerable
  const climbing = p.climbing || p.climbingRope;
  let w = p.w, h = p.h, x = p.x, y = p.y;
  const airborne = !p.supported && !climbing;
  // squash-and-stretch (not while climbing): compress on landing, stretch tall while airborne
  let sw = 1, sh = 1;
  if (!climbing) { if (p.squashT > 0) { const t = p.squashT / SQUASH_FRAMES; sw = 1 + 0.4 * t; sh = 1 - 0.32 * t; } else if (airborne) { sw = 0.92; sh = 1.1; } }
  const nw = w * sw, nh = h * sh; x += (w - nw) / 2; y += h - nh; w = nw; h = nh;
  const cx = x + w / 2, dir = p.facing >= 0 ? 1 : -1, hs = w * 0.62, legW = w * 0.3;
  const drawHead = (frontEyes) => {
    fillc(PAL.skin); rect(cx - hs / 2, y + h * 0.08, hs, h * 0.3);
    fillc(PAL.key); rect(cx - hs / 2 - 2, y + h * 0.08, hs + 4, 3); rect(cx - hs * 0.35, y, hs * 0.7, h * 0.08);
    fill(25, 25, 25);
    if (frontEyes) { rect(cx - 3.5, y + h * 0.17, 2.5, 2.5); rect(cx + 1, y + h * 0.17, 2.5, 2.5); }
    else rect(cx + dir * hs * 0.12 - 1.5, y + h * 0.17, 3, 3);
  };

  if (climbing) {                                  // CLIMB: front-on, arms gripping up the rungs, limbs alternate as you move
    const cph = Math.floor(p.y / 5) % 2 ? 1 : -1;
    fillc(PAL.skin);
    rect(cx - w * 0.46, y + h * 0.14 + (cph > 0 ? -2 : 3), w * 0.22, h * 0.28);
    rect(cx + w * 0.24, y + h * 0.14 + (cph > 0 ? 3 : -2), w * 0.22, h * 0.28);
    rect(cx - legW - 1, y + h * 0.7, legW, h * 0.3 - (cph > 0 ? 0 : 4));
    rect(cx + 1, y + h * 0.7, legW, h * 0.3 - (cph > 0 ? 4 : 0));
    fillc(PAL.joe); rect(cx - w * 0.38, y + h * 0.36, w * 0.76, h * 0.4);
    drawHead(true);
    return;
  }

  fillc(PAL.skin);
  if (airborne) {                                  // JUMP (subtle): legs tuck together, leaning toward the jump direction
    const off = dir * w * 0.16;
    rect(cx - legW - 1 + off, y + h * 0.72, legW, h * 0.24); rect(cx + 1 + off, y + h * 0.72, legW, h * 0.24);
    rect(cx - w * 0.54, y + h * 0.36, w * 0.22, h * 0.2); rect(cx + w * 0.32, y + h * 0.36, w * 0.22, h * 0.2);
  } else if (p.supported && Math.abs(p.vx) > 0.1) {   // RUN: stride + arm swing
    const ph = Math.floor(frame / 5) % 2 ? 1 : -1;
    rect(cx - legW - 1 + ph * 2, y + h * 0.72, legW, h * 0.28 - Math.abs(ph * 2)); rect(cx + 1 - ph * 2, y + h * 0.72, legW, h * 0.28 - Math.abs(ph * 2));
    rect(cx - w * 0.5, y + h * 0.4 + ph * 2, w * 0.18, h * 0.22); rect(cx + w * 0.32, y + h * 0.4 - ph * 2, w * 0.18, h * 0.22);
  } else {                                            // idle
    rect(cx - legW - 1, y + h * 0.72, legW, h * 0.28); rect(cx + 1, y + h * 0.72, legW, h * 0.28);
    rect(cx - w * 0.5, y + h * 0.4, w * 0.18, h * 0.22); rect(cx + w * 0.32, y + h * 0.4, w * 0.18, h * 0.22);
  }
  fillc(PAL.joe); rect(cx - w * 0.4, y + h * 0.36, w * 0.8, h * 0.4);
  drawHead(false);
}
function drawSkull(h) {
  const cx = centerX(h), cy = centerY(h), w = h.w;
  fillc(PAL.skull); ellipse(cx, cy - w * 0.05, w, w * 0.92); rect(cx - w * 0.26, cy + w * 0.2, w * 0.52, w * 0.22);   // cranium + jaw
  fill(20, 20, 20); ellipse(cx - w * 0.2, cy - w * 0.02, w * 0.24, w * 0.28); ellipse(cx + w * 0.2, cy - w * 0.02, w * 0.24, w * 0.28); // eye sockets
  rect(cx - w * 0.07, cy + w * 0.12, w * 0.14, w * 0.12);   // nose
}
function drawSpider(h) {
  const cx = centerX(h), cy = centerY(h), w = h.w;
  fillc(PAL.spider);
  // legs splayed out to both sides (drawn first, body sits on top)
  for (let i = 0; i < 3; i++) { const ly = cy - h.h * 0.18 + i * h.h * 0.22; rect(cx - w * 0.5, ly, w * 0.42, 2); rect(cx + w * 0.08, ly, w * 0.42, 2); }
  ellipse(cx, cy + h.h * 0.12, w * 0.5, h.h * 0.5);          // round abdomen
  ellipse(cx, cy - h.h * 0.14, w * 0.32, h.h * 0.34);        // head
  fill(20, 20, 20); ellipse(cx - w * 0.08, cy - h.h * 0.16, w * 0.08, w * 0.08); ellipse(cx + w * 0.08, cy - h.h * 0.16, w * 0.08, w * 0.08);   // eyes
}
function render() {
  background(PAL.bg[0], PAL.bg[1], PAL.bg[2]);
  noStroke();

  fillc(PAL.ladder);
  for (const L of room.ladders) {                            // two rails + rungs (reads as a ladder)
    const rw = Math.max(2, L.w * 0.16);
    rect(L.x + L.w * 0.22, L.topY, rw, L.botY - L.topY);
    rect(L.x + L.w * 0.78 - rw, L.topY, rw, L.botY - L.topY);
    for (let yy = L.topY + 5; yy < L.botY - 2; yy += 9) rect(L.x + L.w * 0.22, yy, L.w * 0.56, 2);
  }
  fillc(PAL.rope); for (const R of room.ropes) rect(R.x + R.w * 0.4, R.topY, R.w * 0.2, R.botY - R.topY);
  fillc(PAL.wall); for (const b of room.blocks) rect(b.x, b.y, b.w, b.h);
  fillc(PAL.ghost); for (const d of room.disappearing) if (((frame + d.phase) % (d.period || DISAPPEAR_PERIOD)) < (d.on || DISAPPEAR_ON)) rect(d.x, d.y, d.w, d.h);
  for (const cv of room.conveyors) {
    fillc(cv.dir > 0 ? PAL.beltR : PAL.beltL); rect(cv.x, cv.y, cv.w, cellH * 0.5);
    fillc(cv.dir > 0 ? [215, 185, 160] : [165, 165, 215]);   // scrolling stripes show direction + motion
    const period = 12, off = ((frame * 1.3 * cv.dir) % period + period) % period;
    for (let xx = cv.x + off - period; xx < cv.x + cv.w; xx += period) { const sx = Math.max(cv.x, xx), e = Math.min(cv.x + cv.w, xx + 3); if (e > sx) rect(sx, cv.y + 2, e - sx, cellH * 0.34); }
  }
  fillc(PAL.sand); for (const s of room.sand) rect(s.x, s.y, s.w, cellH * 0.5);

  if (room.door && !room.unlocked) { fillc(PAL.door); rect(room.door.x, room.door.y, room.door.w, room.door.h); }

  fillc(PAL.jewel); for (const j of room.jewels) if (!j.taken) rect(j.x, j.y + Math.sin((frame + j.x) * 0.12) * 1.5, j.w, j.h);
  if (room.key && !room.key.taken) { const k = room.key; fillc(PAL.key); rect(k.x, k.y + Math.sin(frame * 0.1) * 2, k.w, k.h); }
  if (room.goal) { const g = room.goal, s = 2 + Math.max(0, Math.sin(frame * 0.12)) * 2; fillc(PAL.goal); rect(g.x - s, g.y - s, g.w + 2 * s, g.h + 2 * s); }

  for (const h of room.hazards) {
    if (h.dead) continue;
    if (h.type === 'laser') { if (((frame + h.phase) % LASER_PERIOD) < LASER_ON) { fillc(PAL.laser); rect(h.x, h.y, h.w, h.h); } }
    else if (h.type === 'skull' || h.type === 'floatskull') drawSkull(h);
    else if (h.type === 'spider') drawSpider(h);
  }

  drawPlayer();

  // edge HUD: lives + key + rooms-visited
  fillc(PAL.joe); for (let i = 0; i < lives; i++) rect(6 + i * 10, 6, 7, 7);
  if (hasKey) { fillc(PAL.key); rect(6, 18, 7, 7); }
  for (let i = 0; i < world.n; i++) { if (visited[i]) fillc(PAL.goal); else fillc(PAL.dim); rect(width - 6 - (world.n - i) * 10, 6, 7, 7); }
}
