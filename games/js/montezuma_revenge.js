// montezuma_revenge — gym-gen p5 game (Discrete(8), 64x64 RGB, seeded)
// Conforms to GAME_TEMPLATE.md. "Faithful" = FEEL + a real PUZZLE STRUCTURE:
//   - movement (walk/jump/climb) measured from real ALE RAM capture; committed jumps.
//   - The world is a BRANCHING ROOM GRAPH, not a linear chain. You spawn in a HUB with a
//     LEFT and a RIGHT exit. One branch is a dead-end KEY shaft (climb down for the key,
//     climb back up). The other branch holds a LOCKED DOOR -> the GOAL. You hit the door,
//     can't pass, BACKTRACK through the hub to the key branch, return, then unlock & win.
//     -> meaningful exploration + backtracking (the key is OFF the direct path to the goal).
//   - Seed mirrors which side holds the key vs the door, and varies geometry/hazards/jewels.
//   - One screen per room; connections are bidirectional left/right doors.

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
const WALK_SPEED = 2.5, CLIMB_SPEED = 2.5, JUMP_V0 = -8.0, GRAVITY = 0.8, FALL_MAX = 10.0;
const LASER_PERIOD = 150, LASER_ON = 55;

const ROOM_BONUS = 10, KEY_BONUS = 20, UNLOCK_BONUS = 25, GOAL_BONUS = 50;
const JEWEL_BONUS = 3, DEATH_PENALTY = 2, SHAPE = 0.01;
const MROW = 6;                              // ledge row for flat rooms
const SHAFT_TOP = 4, SHAFT_BOT = 9;          // key-shaft ledges

// ============================================================
// State
// ============================================================
let score = 0, lives = 3, gameState = 'PLAYING', frame = 0;
let world = null, roomIndex = 0, visited = [];
let room = null, player, hasKey = false, bestDist = Infinity;

function setup() { createCanvas(400, 400); }
function getGameState() { return { score: score, lives: lives, gameState: gameState }; }
function opp(side) { return side === 'left' ? 'right' : 'left'; }

// ============================================================
// World generation — branching graph: hub + key branch + door branch + goal
// ============================================================
function resetGame(seed) {
  rng = mulberry32(seed);
  score = 0; lives = 3; gameState = 'PLAYING'; hasKey = false; frame = 0;
  cellW = width / COLS; cellH = height / ROWS;

  const keySide = rng() < 0.5 ? 'left' : 'right';   // which hub exit leads to the key branch
  const doorSide = opp(keySide);                    // the other exit leads toward the goal
  const back = opp(doorSide);                        // door corridors are entered from the hub side

  // Spatial coherence: exiting side S of a room enters the neighbor at side opp(S)
  // (exit right -> appear on the left of the next room, continuing the motion).
  const rooms = [makeHub()];                         // idx 0
  const keyEnter = opp(keySide);                     // key room's opening faces the hub
  const keyIdx = rooms.push(makeKeyShaft(keyEnter)) - 1;
  rooms[0].exits[keySide] = { to: keyIdx, toSide: keyEnter };
  rooms[keyIdx].exits[keyEnter] = { to: 0, toSide: keySide };

  // door branch: 1-2 corridors, then the LOCKED door into the goal (graph-length variety)
  const doorDepth = 1 + (rng() < 0.5 ? 1 : 0);
  let prev = 0, prevSide = doorSide;
  for (let d = 0; d < doorDepth; d++) {
    const last = d === doorDepth - 1;
    const idx = rooms.push(makeCorridor(back, doorSide, last)) - 1;
    rooms[prev].exits[prevSide] = { to: idx, toSide: back };
    rooms[idx].exits[back] = { to: prev, toSide: prevSide };
    prev = idx; prevSide = doorSide;
  }
  const gIdx = rooms.push(makeGoal(back)) - 1;
  rooms[prev].exits[doorSide] = { to: gIdx, toSide: back, locked: true };
  rooms[gIdx].exits[back] = { to: prev, toSide: doorSide };

  world = { rooms, n: rooms.length };
  visited = new Array(rooms.length).fill(false);
  gotoRoom(0, 'spawn');
}

// --- shared parse: turn a char grid into geometry ---
function parseGrid(g) {
  const R = g.length, C = g[0].length;
  const blocks = [], ladders = [];
  let key = null, goal = null, spawn = null;
  for (let r = 0; r < R; r++) {
    let c = 0;
    while (c < C) {
      if (g[r][c] === '#') { const c0 = c; while (c < C && g[r][c] === '#') c++; blocks.push({ x: c0 * cellW, y: r * cellH, w: (c - c0) * cellW, h: cellH }); }
      else c++;
    }
  }
  for (let c = 0; c < C; c++) {
    let r = 0;
    while (r < R) {
      if (g[r][c] === 'H') { const r0 = r; while (r < R && g[r][c] === 'H') r++; ladders.push({ x: c * cellW, w: cellW, topY: r0 * cellH, botY: r * cellH }); }
      else r++;
    }
  }
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const ch = g[r][c], cx = (c + 0.5) * cellW;
    if (ch === 'P') spawn = { x: c * cellW + (cellW - PLAYER_W) / 2, y: (r + 1) * cellH - PLAYER_H };
    else if (ch === 'K') key = { x: cx - 7, y: (r + 1) * cellH - 14, w: 14, h: 14 };
    else if (ch === 'G') goal = { x: cx - 9, y: (r + 1) * cellH - 18, w: 18, h: 18 };
  }
  return { blocks, ladders, key, goal, spawn };
}

function blankGrid() {
  const g = Array.from({ length: ROWS }, () => Array(COLS).fill('.'));
  for (let c = 0; c < COLS; c++) g[0][c] = '#';
  for (let r = 0; r < ROWS; r++) { g[r][0] = '#'; g[r][COLS - 1] = '#'; }
  return g;
}
const Hh = (g, r, c0, c1) => { for (let c = Math.max(1, c0); c <= Math.min(COLS - 2, c1); c++) g[r][c] = '#'; };
const Vv = (g, c, r0, r1) => { for (let r = r0; r <= r1; r++) g[r][c] = 'H'; };

function jewelsOnLedge(g, row, c0, c1, n) {
  const cand = [];
  for (let c = Math.max(1, c0); c <= Math.min(COLS - 2, c1); c++) if (g[row][c] === '#' && g[row - 1][c] === '.') cand.push(c);
  for (let k = cand.length - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); [cand[k], cand[j]] = [cand[j], cand[k]]; }
  return cand.slice(0, n).map((c) => ({ x: (c + 0.5) * cellW - 6, y: row * cellH - 12, w: 12, h: 12, taken: false }));
}

function baseRoom(parsed, openings) {
  return { ...parsed, hazards: [], jewels: [], door: null, openings, exits: {}, unlocked: false, isGoal: false };
}

function makeSkull(loCol, hiCol, row) {
  const w = 18, lo = loCol * cellW, hi = Math.max(lo + 1, hiCol * cellW - w);
  return { type: 'skull', w, h: w, x: (lo + hi) / 2, y: row * cellH - w, lo, hi, vx: (rng() < 0.5 ? -1 : 1) * (1.0 + rng() * 0.4) };
}
function mkHazard(kind, col, row) {
  if (kind === 'laser') return { type: 'laser', x: col * cellW + cellW / 2 - 4, y: (row - 3) * cellH, w: 8, h: 3 * cellH };
  if (kind === 'skull') return makeSkull(Math.max(1, col - 1), Math.min(COLS - 2, col + 2), row);
  if (kind === 'snake') return { type: 'snake', x: (col + 0.5) * cellW - 9, y: row * cellH - 18, w: 18, h: 18 };
  return null;
}
function rollKind() { return ['laser', 'laser', 'skull', 'snake'][Math.floor(rng() * 4)]; }

// HUB — two style variants for replay variety.
function makeHub() { return rng() < 0.5 ? hubTower() : hubFlat(); }

// Tower: spawn on a top platform, central ladder DOWN to the exit level (room-1 feel).
function hubTower() {
  const g = blankGrid();
  const lad = 6 + Math.floor(rng() * 4);
  const top = 2 + Math.floor(rng() * 2);
  const low = 7 + Math.floor(rng() * 2);
  Hh(g, top + 1, lad - 2, lad + 3);
  g[top][lad - 1] = 'P';
  Vv(g, lad, top + 1, low - 1);
  Hh(g, low, 1, COLS - 2);
  const pitLeft = rng() < 0.5;
  const pit = pitLeft ? 2 + Math.floor(rng() * 2) : 11 + Math.floor(rng() * 2);
  g[low][pit] = '.';
  g[low - 1][0] = '.'; g[low - 1][COLS - 1] = '.';
  const room = baseRoom(parseGrid(g), { left: low, right: low });
  room.hazards = [pitLeft ? makeSkull(9, 13, low) : makeSkull(2, 6, low)]; // skull on the non-pit side
  room.jewels = jewelsOnLedge(g, top + 1, lad - 2, lad + 3, 1).concat(jewelsOnLedge(g, low, 1, COLS - 2, 1));
  return room;
}

// Flat: single ledge, lethal pit between the two exits, spawn left, optional skull right.
function hubFlat() {
  const g = blankGrid();
  const row = 5 + Math.floor(rng() * 3);
  Hh(g, row, 1, COLS - 2);
  const pit = 7 + Math.floor(rng() * 3);
  g[row][pit] = '.';
  g[row - 1][0] = '.'; g[row - 1][COLS - 1] = '.';
  g[row - 1][3] = 'P';
  const room = baseRoom(parseGrid(g), { left: row, right: row });
  if (rng() < 0.6) room.hazards = [makeSkull(pit + 2, COLS - 3, row)];
  room.jewels = jewelsOnLedge(g, row, 4, pit - 1, 1).concat(jewelsOnLedge(g, row, pit + 2, COLS - 3, 1));
  return room;
}

// KEY SHAFT: enter `enterSide`, climb DOWN to the key, climb back up. Varied depth/ladder; an
// optional laser on the bottom ledge (timeable, no run-up needed).
function makeKeyShaft(enterSide) {
  const g = blankGrid();
  const lad = 6 + Math.floor(rng() * 4);
  const top = 3 + Math.floor(rng() * 2);
  const bot = 8 + Math.floor(rng() * 2);
  if (enterSide === 'right') { Hh(g, top, lad, COLS - 2); g[top - 1][COLS - 1] = '.'; Hh(g, bot, 1, lad + 1); g[bot - 1][2] = 'K'; }
  else { Hh(g, top, 1, lad); g[top - 1][0] = '.'; Hh(g, bot, lad - 1, COLS - 2); g[bot - 1][COLS - 3] = 'K'; }
  Vv(g, lad, top, bot - 1);
  const room = baseRoom(parseGrid(g), { [enterSide]: top });
  if (rng() < 0.5) { const lc = enterSide === 'right' ? Math.max(2, lad - 3) : Math.min(COLS - 3, lad + 3); room.hazards = [mkHazard('laser', lc, bot)]; }
  room.jewels = jewelsOnLedge(g, bot, 1, COLS - 2, 1 + Math.floor(rng() * 2));
  return room;
}

// CORRIDOR (door room): enter `enterSide`; LOCKED door on `lockedSide` -> next. Rolled hazard.
function makeCorridor(enterSide, lockedSide, locked) {
  const g = blankGrid();
  const mrow = 5 + Math.floor(rng() * 3);
  Hh(g, mrow, 1, COLS - 2);
  g[mrow - 1][enterSide === 'left' ? 0 : COLS - 1] = '.';
  g[mrow - 1][lockedSide === 'left' ? 0 : COLS - 1] = '.';
  const room = baseRoom(parseGrid(g), { [enterSide]: mrow, [lockedSide]: mrow });
  if (locked) room.door = { x: (lockedSide === 'left' ? 0 : (COLS - 1) * cellW), y: (mrow - 1) * cellH, w: cellW, h: cellH, side: lockedSide };
  room.hazards = [mkHazard(rollKind(), 6 + Math.floor(rng() * 4), mrow)].filter(Boolean);
  room.jewels = jewelsOnLedge(g, mrow, 2, COLS - 3, 1);
  return room;
}

// GOAL: enter `enterSide`; treasure at the far end. Optional laser guard (timeable).
function makeGoal(enterSide) {
  const g = blankGrid();
  const mrow = 5 + Math.floor(rng() * 3);
  Hh(g, mrow, 1, COLS - 2);
  g[mrow - 1][enterSide === 'left' ? 0 : COLS - 1] = '.';
  const gcol = enterSide === 'left' ? COLS - 3 : 2;
  g[mrow - 1][gcol] = 'G';
  const room = baseRoom(parseGrid(g), { [enterSide]: mrow });
  room.isGoal = true;
  if (rng() < 0.5) { const col = enterSide === 'left' ? gcol - 3 : gcol + 3; if (col > 1 && col < COLS - 2) room.hazards = [mkHazard('laser', col, mrow)]; }
  room.jewels = jewelsOnLedge(g, mrow, enterSide === 'left' ? 2 : 5, enterSide === 'left' ? COLS - 5 : COLS - 3, 1);
  return room;
}

// ============================================================
// Room loading / transitions
// ============================================================
function gotoRoom(i, enterSide) {
  roomIndex = i;
  room = world.rooms[i];
  let px, py;
  if (enterSide === 'spawn') { px = room.spawn.x; py = room.spawn.y; }
  else { const r = room.openings[enterSide]; px = enterSide === 'left' ? cellW : width - cellW - PLAYER_W; py = r * cellH - PLAYER_H; }
  player = { x: px, y: py, vx: 0, vy: 0, w: PLAYER_W, h: PLAYER_H, supported: true, climbing: false };
  if (!visited[i]) { visited[i] = true; if (i !== 0) score += ROOM_BONUS; }
  bestDist = distToSubgoal();
}

function activeBlocks() {
  const out = room.blocks.slice();
  if (room.door && !hasKey) out.push(room.door);
  return out;
}

// ============================================================
// Helpers
// ============================================================
function AABB(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
function centerX(o) { return o.x + o.w / 2; }
function centerY(o) { return o.y + o.h / 2; }
function subgoalPoint() {
  if (room.key && !hasKey) return { x: centerX(room.key), y: centerY(room.key) };
  if (room.goal) return { x: centerX(room.goal), y: centerY(room.goal) };
  return null;
}
function distToSubgoal() { const s = subgoalPoint(); return s ? Math.abs(centerX(player) - s.x) + Math.abs(centerY(player) - s.y) : Infinity; }

function startClimb(L) { player.climbing = true; player.x = L.x + L.w / 2 - player.w / 2; player.vx = 0; player.vy = 0; }
function ladderAt(p) {
  const cx = centerX(p);
  for (const L of room.ladders) if (cx >= L.x && cx <= L.x + L.w && p.y + p.h >= L.topY - 6 && p.y <= L.botY + 6) return L;
  return null;
}

// ============================================================
// Main loop
// ============================================================
function draw() {
  if (gameState !== 'PLAYING') return;
  frame++;

  const L = ladderAt(player);
  const up = keyIsDown(38), down = keyIsDown(40), lf = keyIsDown(37), rt = keyIsDown(39);
  const cols = activeBlocks();

  if (L && !player.climbing) {
    if (up && player.y + player.h > L.topY + 2) startClimb(L);
    else if (down && player.y + player.h < L.botY - 2) startClimb(L);
  }
  if (player.climbing && (lf || rt)) player.climbing = false;
  if (!L) player.climbing = false;

  if (player.climbing) {
    if (up) player.y -= CLIMB_SPEED;
    if (down) player.y += CLIMB_SPEED;
    if (player.y + player.h <= L.topY) { player.y = L.topY - player.h; player.climbing = false; player.supported = true; }
    else if (player.y + player.h >= L.botY) { player.y = L.botY - player.h; player.climbing = false; player.supported = true; }
  } else {
    if (player.supported) { let t = 0; if (lf) t = -WALK_SPEED; if (rt) t = WALK_SPEED; player.vx = t; }
    if (keyIsDown(32) && player.supported) { player.vy = JUMP_V0; player.supported = false; }
    player.vy += GRAVITY; if (player.vy > FALL_MAX) player.vy = FALL_MAX;

    player.x += player.vx;
    for (const b of cols) if (AABB(player, b)) { if (player.vx > 0) player.x = b.x - player.w; else if (player.vx < 0) player.x = b.x + b.w; player.vx = 0; }
    player.y += player.vy;
    player.supported = false;
    for (const b of cols) if (AABB(player, b)) {
      if (player.vy > 0) { player.y = b.y - player.h; player.supported = true; }
      else if (player.vy < 0) player.y = b.y + b.h;
      player.vy = 0;
    }
    // Ladder top is standable: the player is narrower than the ladder's cell hole, so without
    // this it falls straight back down after climbing up. Standing here lets you jump/step off.
    if (!player.supported && player.vy >= 0 && !down) {
      const cx = centerX(player);
      for (const Lr of room.ladders) {
        if (cx >= Lr.x && cx <= Lr.x + Lr.w && player.y + player.h >= Lr.topY - 2 && player.y + player.h <= Lr.topY + 8) {
          player.y = Lr.topY - player.h; player.vy = 0; player.supported = true; break;
        }
      }
    }
  }

  if (player.y > height) { loseLife(); if (gameState !== 'PLAYING') return; renderAndShape(); return; }

  for (const h of room.hazards) {
    if (h.type === 'laser') { if ((frame % LASER_PERIOD) < LASER_ON && AABB(player, h)) loseLife(); }
    else if (h.type === 'skull') { h.x += h.vx; if (h.x <= h.lo || h.x >= h.hi) { h.vx *= -1; h.x += h.vx; } if (AABB(player, h)) loseLife(); }
    else if (h.type === 'snake') { if (AABB(player, h)) loseLife(); }
    if (gameState !== 'PLAYING') return;
  }

  for (const j of room.jewels) if (!j.taken && AABB(player, j)) { j.taken = true; score += JEWEL_BONUS; }
  if (room.key && !hasKey && AABB(player, room.key)) { hasKey = true; score += KEY_BONUS; bestDist = distToSubgoal(); }
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
  const feet = player.y + player.h;
  for (const side of ['left', 'right']) {
    const ex = room.exits[side];
    if (!ex || room.openings[side] == null) continue;
    const atEdge = side === 'right' ? (player.x + player.w >= width - 1) : (player.x <= 1);
    if (!atEdge) continue;
    if (Math.abs(feet - room.openings[side] * cellH) >= cellH) continue;
    if (ex.locked && !hasKey) continue;                 // door block already prevents reaching here
    if (ex.locked && hasKey && !room.unlocked) { room.unlocked = true; score += UNLOCK_BONUS; }
    gotoRoom(ex.to, ex.toSide);
    return;
  }
}

function loseLife() {
  if (gameState !== 'PLAYING') return;
  lives -= 1; score -= DEATH_PENALTY;
  if (lives <= 0) { gameState = 'GAMEOVER'; return; }
  // respawn at the hub (keeps the world state; player keeps the key)
  gotoRoom(0, 'spawn');
}

// ============================================================
// Render
// ============================================================
function render() {
  background(18, 18, 28);
  noStroke();

  fill(200, 200, 200);
  for (const L of room.ladders) rect(L.x + L.w * 0.25, L.topY, L.w * 0.5, L.botY - L.topY);

  fill(190, 130, 60);
  for (const b of room.blocks) rect(b.x, b.y, b.w, b.h);

  if (room.door && !hasKey) { fill(150, 60, 220); rect(room.door.x, room.door.y, room.door.w, room.door.h); } // locked door: purple

  for (const j of room.jewels) if (!j.taken) { fill(240, 240, 255); rect(j.x, j.y, j.w, j.h); }
  if (room.key && !hasKey) { fill(255, 230, 40); rect(room.key.x, room.key.y, room.key.w, room.key.h); }
  if (room.goal) { fill(40, 230, 90); rect(room.goal.x, room.goal.y, room.goal.w, room.goal.h); }

  for (const h of room.hazards) {
    if (h.type === 'laser' && (frame % LASER_PERIOD) < LASER_ON) { fill(255, 80, 180); rect(h.x, h.y, h.w, h.h); }
    else if (h.type === 'skull') { fill(230, 40, 40); ellipse(centerX(h), centerY(h), h.w, h.h); }
    else if (h.type === 'snake') { fill(250, 160, 30); ellipse(centerX(h), centerY(h), h.w, h.h); }
  }

  fill(60, 120, 255); rect(player.x, player.y, player.w, player.h);

  // edge HUD: lives + key + rooms-visited
  fill(60, 120, 255); for (let i = 0; i < lives; i++) rect(6 + i * 10, 6, 7, 7);
  if (hasKey) { fill(255, 230, 40); rect(6, 18, 7, 7); }
  for (let i = 0; i < world.n; i++) { if (visited[i]) fill(80, 220, 120); else fill(60, 60, 70); rect(width - 6 - (world.n - i) * 10, 6, 7, 7); }
}
