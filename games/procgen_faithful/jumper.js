// jumper -- faithful port of ProcGen's jumper.cpp (easy distribution mode).
//
// Ported from games/procgen_src/jumper.cpp plus the shared engine pieces it
// depends on: basic-abstract-game.cpp (physics, swept collision, camera),
// mazegen.cpp (randomized-Kruskal maze) and roomgen.cpp (cellular automata,
// flood fill, BFS, dilation). The simulation runs in ProcGen's frame: tile
// units, y increasing UPWARD. Only the renderer flips y into p5 screen space.
//
// The level pipeline, in ProcGen's order:
//   1. 6x6 no-dead-ends maze, upscaled 3x onto the 20x20 world
//   2. per-cell noise: 80% wall inside maze walls, 20% inside maze corridors
//   3. two cellular-automata smoothing passes (>=5 wall neighbours -> wall)
//   4. CAVEWALL border, then keep only the largest connected open room
//   5. pick a goal cell and an agent cell standing on ground
//   6. BFS the agent->goal path, dilate it by 4, and carve ONLY that --
//      this is what makes jumper's caves narrow, winding corridors
//   7. sprinkle spikes on flat ground, break up long vertical walls
//
// Physics and reward are ProcGen's: maxspeed .5, mixrate .5, jump impulse 1.0,
// gravity .15 applied after the move, DOUBLE jump with a 3-step cooldown,
// +10 for the goal and nothing else, spike contact ends the episode.
//
// The compass HUD is ported too (jumper.cpp draw_compass) -- it is not
// decoration. The goal is off-screen almost always in a 12-tile view, and
// without the needle and distance bar the task is close to unlearnable.

// ============================================================
// REQUIRED: seeded RNG
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

// ProcGen RandGen surface, on top of mulberry32.
function randn(n) { return Math.floor(rng() * n); }
function rand01() { return rng(); }
function chooseOne(arr) { return arr[randn(arr.length)]; }

// ============================================================
// Constants (jumper.cpp + basic-abstract-game.cpp, EasyMode)
// ============================================================

const SPACE = 100;          // object-ids.h
const WALL_OBJ = 51;
const SPIKE = 2;
const CAVEWALL = 6;
const CAVEWALL_TOP = 7;

const MAIN_W = 20;          // choose_world_dim, EasyMode
const MAIN_H = 20;
const MAZE_SCALE = 3;
const MAZE_DIM = Math.floor(MAIN_W / MAZE_SCALE);   // 6
const ARRAY_DIM = MAZE_DIM + 2;                     // 8
const MAZE_OFFSET = 1;

const MIXRATE = 0.5;
const MAXSPEED = 0.5;
const GRAVITY = 0.15;
const JUMP_COOLDOWN = 3;
const AGENT_RX = 0.254;
const AGENT_RY = 0.4;
const SPIKE_RX = 0.23;
const SPIKE_RY = 0.4;
const GOAL_R = 0.5;
const SPIKE_PROB = 0.2;

const GOAL_REWARD = 10;

const VISIBILITY = 12;      // EasyMode
const COMPASS_DIM = 3;      // EasyMode
const UNIT = 32;            // logical px per tile -> 384x384 canvas
const CANVAS = VISIBILITY * UNIT;

const WALL_THEMES = [
  { top: [142, 154, 168], mid: [74, 82, 92] },
  { top: [111, 207, 90], mid: [47, 122, 52] },
  { top: [176, 122, 74], mid: [109, 69, 38] },
  { top: [168, 111, 208], mid: [92, 58, 128] },
];
const COL_BG = [10, 10, 15];
const COL_PLAYER = [47, 107, 255];
const COL_GOAL = [0, 229, 255];
const COL_SPIKE = [255, 43, 43];
const COL_COMPASS = [168, 166, 158];    // jumper.cpp clock_color
const COL_NEEDLE = [252, 186, 3];       // jumper.cpp highlight_color

// ============================================================
// State
// ============================================================

let score = 0;
let lives = 1;
let gameState = 'PLAYING';

let grid = null;            // Int16Array, index = y * MAIN_W + x
let oobObject = WALL_OBJ;   // out_of_bounds_object -- changes during generation
let agent = null;
let goal = null;
let spikes = [];
let wallTheme = 0;

let curTime = 0;
let jumpCount = 0;
let jumpDelta = 0;
let jumpTime = 0;
let hasSupport = false;
let actionVx = 0;
let actionVy = 0;
let stepRandInt = 0;

// ============================================================
// Grid helpers (basic-abstract-game.cpp)
// ============================================================

function getObj(x, y) {
  if (x < 0 || x >= MAIN_W || y < 0 || y >= MAIN_H) return oobObject;
  return grid[y * MAIN_W + x];
}

function getObjIdx(idx) {
  if (idx < 0 || idx >= MAIN_W * MAIN_H) return oobObject;
  return grid[idx];
}

function getObjFromFloats(i, j) {
  if (i < 0) return oobObject;
  if (j < 0) return oobObject;
  return getObj(Math.floor(i), Math.floor(j));
}

function setObj(x, y, v) {
  if (x < 0 || x >= MAIN_W || y < 0 || y >= MAIN_H) return;
  grid[y * MAIN_W + x] = v;
}

function isWall(t) { return t === CAVEWALL || t === CAVEWALL_TOP; }
function canSupport(t) { return isWall(t) || t === oobObject; }

function isSpaceOnGround(x, y) {
  if (getObj(x, y) !== SPACE) return false;
  if (getObj(x, y + 1) !== SPACE) return false;
  const below = getObj(x, y - 1);
  return below === CAVEWALL || below === oobObject;
}

function isLeftWall(x, y) { return getObj(x, y) === CAVEWALL && getObj(x + 1, y) === SPACE; }
function isRightWall(x, y) { return getObj(x, y) === CAVEWALL && getObj(x - 1, y) === SPACE; }
function isTopWall(x, y) { return getObj(x, y) === CAVEWALL && getObj(x, y + 1) === SPACE; }

// ============================================================
// Swept collision (basic_step_object / sub_step)
// ============================================================
// jumper adds no entity-vs-entity blocking or reflection, so sub_step's
// entity pass is a no-op and is omitted. Only the agent smart_steps.

function isBlocked(obj, target) {
  if (target === WALL_OBJ) return true;
  if (target === oobObject) return true;
  if (obj.isPlayer && isWall(target)) return true;
  return false;
}

function subStep(obj, vx, vy) {
  let nx = obj.x + vx;
  let ny = obj.y + vy;
  const margin = 0.98;
  const isHorizontal = vx !== 0;

  let block = false;
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const t = getObjFromFloats(
        nx + obj.rx * margin * (2 * i - 1),
        ny + obj.ry * margin * (2 * j - 1),
      );
      if (isBlocked(obj, t)) block = true;
    }
  }

  if (block) {
    if (isHorizontal) {
      nx = vx > 0 ? Math.floor(nx + obj.rx) - obj.rx : Math.ceil(nx - obj.rx) + obj.rx;
    } else {
      ny = vy > 0 ? Math.floor(ny + obj.ry) - obj.ry : Math.ceil(ny - obj.ry) + obj.ry;
    }
  }

  obj.x = nx;
  obj.y = ny;
  return block;
}

function basicStepObject(obj) {
  let numSubSteps = Math.floor(4 * Math.sqrt(obj.vx * obj.vx + obj.vy * obj.vy));
  if (numSubSteps < 4) numSubSteps = 4;
  const pct = 1 / numSubSteps;

  const cmp = Math.abs(obj.vx) - Math.abs(obj.vy);
  let stepXFirst = cmp === 0 ? (stepRandInt % 2 === 0) : (cmp > 0);
  if (obj.isPlayer) {
    if (actionVx !== 0) stepXFirst = true;
    if (actionVy !== 0) stepXFirst = false;
  }

  let vxPct = 0;
  let vyPct = 0;

  for (let s = 0; s < numSubSteps; s++) {
    let blockX = false;
    let blockY = false;
    if (stepXFirst) {
      blockX = subStep(obj, obj.vx * pct, 0);
      blockY = subStep(obj, 0, obj.vy * pct);
    } else {
      blockY = subStep(obj, 0, obj.vy * pct);
      blockX = subStep(obj, obj.vx * pct, 0);
    }
    if (!blockX) vxPct += 1;
    if (!blockY) vyPct += 1;
    if (blockX && blockY) break;
  }

  obj.vx *= vxPct / numSubSteps;
  obj.vy *= vyPct / numSubSteps;
}

function hasCollision(a, b) {
  return Math.abs(a.x - b.x) < (a.rx + b.rx) && Math.abs(a.y - b.y) < (a.ry + b.ry);
}

// ============================================================
// MazeGen (mazegen.cpp) -- randomized Kruskal on a 6x6 lattice
// ============================================================

function generateMazeNoDeadEnds() {
  const m = new Int16Array(ARRAY_DIM * ARRAY_DIM).fill(WALL_OBJ);
  const mSet = (x, y, v) => { m[y * ARRAY_DIM + x] = v; };
  const mGet = (x, y) => m[y * ARRAY_DIM + x];

  // MazeGen::get_obj -- the outer ring is never a valid cell
  const mObj = (idx) => {
    const x = idx % ARRAY_DIM;
    const y = Math.floor(idx / ARRAY_DIM);
    if (x <= 0 || x >= ARRAY_DIM - 1) return -1;
    if (y <= 0 || y >= ARRAY_DIM - 1) return -1;
    return m[idx];
  };

  // MazeGen::get_neighbors -- 4-connected, in C++ loop order
  const DIRS = [[-1, 0], [0, -1], [0, 1], [1, 0]];
  const neighbors = (idx, type) => {
    const x = idx % ARRAY_DIM;
    const y = Math.floor(idx / ARRAY_DIM);
    const out = [];
    for (const [dx, dy] of DIRS) {
      const n = (y + dy) * ARRAY_DIM + (x + dx);
      if (mObj(n) === type) out.push(n);
    }
    return out;
  };

  mSet(MAZE_OFFSET, MAZE_OFFSET, 0);

  const setFreeCell = (x, y) => { mSet(x + MAZE_OFFSET, y + MAZE_OFFSET, SPACE); };

  const cellSets = [];
  const cellSetsIdxs = new Int32Array(MAZE_DIM * MAZE_DIM);
  for (let i = 0; i < MAZE_DIM * MAZE_DIM; i++) {
    cellSets.push(new Set([i]));
    cellSetsIdxs[i] = i;
  }
  const lookup = (x, y) => cellSetsIdxs[MAZE_DIM * y + x];

  const walls = [];
  for (let i = 1; i < MAZE_DIM; i += 2) {
    for (let j = 0; j < MAZE_DIM; j += 2) {
      if (i > 0 && i < MAZE_DIM - 1) walls.push([i - 1, j, i + 1, j]);
    }
  }
  for (let i = 0; i < MAZE_DIM; i += 2) {
    for (let j = 1; j < MAZE_DIM; j += 2) {
      if (j > 0 && j < MAZE_DIM - 1) walls.push([i, j - 1, i, j + 1]);
    }
  }

  while (walls.length > 0) {
    const n = randn(walls.length);
    const [x1, y1, x2, y2] = walls[n];

    const s0Idx = lookup(x1, y1);
    const s1Idx = lookup(x2, y2);
    const x0 = (x1 + x2) / 2;
    const y0 = (y1 + y2) / 2;
    const center = MAZE_DIM * y0 + x0;

    const canRemove = mGet(x0 + MAZE_OFFSET, y0 + MAZE_OFFSET) === WALL_OBJ && s0Idx !== s1Idx;

    if (canRemove) {
      setFreeCell(x1, y1);
      setFreeCell(x0, y0);
      setFreeCell(x2, y2);

      const s0 = cellSets[s0Idx];
      const s1 = cellSets[s1Idx];
      for (const v of s0) s1.add(v);
      s1.add(center);
      for (const v of s1) cellSetsIdxs[v] = s1Idx;
    }

    walls.splice(n, 1);
  }

  // no dead ends
  for (let i = 0; i < ARRAY_DIM * ARRAY_DIM; i++) {
    if (mObj(i) !== SPACE) continue;
    const adjSpace = neighbors(i, SPACE);
    if (adjSpace.length !== 1) continue;
    const adjWall = neighbors(i, WALL_OBJ);
    if (adjWall.length > 0) m[adjWall[randn(adjWall.length)]] = SPACE;
  }

  return mGet;
}

// ============================================================
// RoomGenerator (roomgen.cpp)
// ============================================================

function countNeighbors(idx, type) {
  const x = idx % MAIN_W;
  const y = Math.floor(idx / MAIN_W);
  let n = 0;
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      if (getObj(x + i, y + j) === type) n++;
    }
  }
  return n;
}

function caUpdate() {
  const next = new Int16Array(MAIN_W * MAIN_H);
  for (let i = 0; i < MAIN_W * MAIN_H; i++) {
    next[i] = countNeighbors(i, WALL_OBJ) >= 5 ? WALL_OBJ : SPACE;
  }
  grid.set(next);
}

// roomgen.cpp build_room: note the seed cell is only added if a neighbour
// expands back into it -- reproduced as written.
function buildRoom(idx, room) {
  if (getObjIdx(idx) !== SPACE) return;
  const queue = [idx];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    if (getObjIdx(cur) !== SPACE) continue;
    const x = cur % MAIN_W;
    const y = Math.floor(cur / MAIN_W);
    for (const [dx, dy] of [[-1, 0], [0, -1], [0, 1], [1, 0]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= MAIN_W || ny < 0 || ny >= MAIN_H) continue;
      const n = ny * MAIN_W + nx;
      if (!room.has(n) && getObjIdx(n) === SPACE) {
        queue.push(n);
        room.add(n);
      }
    }
  }
}

function findBestRoom() {
  const all = new Set();
  let best = new Set();
  for (let i = 0; i < MAIN_W * MAIN_H; i++) {
    if (getObjIdx(i) !== SPACE || all.has(i)) continue;
    const room = new Set();
    buildRoom(i, room);
    for (const v of room) all.add(v);
    if (room.size > best.size) best = room;
  }
  return best;
}

function findPath(src, dst) {
  if (getObjIdx(src) !== SPACE) return [];
  const expanded = [src];
  const parents = [-1];
  const covered = new Set([src]);
  let searchIdx = 0;

  while (searchIdx < expanded.length) {
    const cur = expanded[searchIdx];
    if (cur === dst) break;
    const x = cur % MAIN_W;
    const y = Math.floor(cur / MAIN_W);
    for (const [dx, dy] of [[-1, 0], [0, -1], [0, 1], [1, 0]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= MAIN_W || ny < 0 || ny >= MAIN_H) continue;
      const n = ny * MAIN_W + nx;
      if (!covered.has(n) && getObjIdx(n) === SPACE) {
        expanded.push(n);
        parents.push(searchIdx);
        covered.add(n);
      }
    }
    searchIdx++;
  }

  if (searchIdx >= expanded.length || expanded[searchIdx] !== dst) return [];

  const path = [];
  let i = searchIdx;
  while (i >= 0) { path.push(expanded[i]); i = parents[i]; }
  path.reverse();
  return path;
}

// roomgen.cpp expand_room -- 8-connected dilation, n rounds, SPACE only
function expandRoom(set, n) {
  let cur = new Set(set);
  for (let loop = 0; loop < n; loop++) {
    const next = new Set();
    for (const idx of cur) {
      if (getObjIdx(idx) !== SPACE) continue;
      const x = idx % MAIN_W;
      const y = Math.floor(idx / MAIN_W);
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          if (i === 0 && j === 0) continue;
          const nx = x + i;
          const ny = y + j;
          if (nx < 0 || nx >= MAIN_W || ny < 0 || ny >= MAIN_H) continue;
          const nIdx = ny * MAIN_W + nx;
          if (!set.has(nIdx) && getObjIdx(nIdx) === SPACE) {
            set.add(nIdx);
            next.add(nIdx);
          }
        }
      }
    }
    cur = next;
  }
}

// ============================================================
// REQUIRED: RL interface
// ============================================================

function resetGame(seed) {
  rng = mulberry32(seed);

  score = 0;
  lives = 1;
  gameState = 'PLAYING';

  grid = new Int16Array(MAIN_W * MAIN_H).fill(SPACE);
  spikes = [];
  curTime = 0;
  jumpCount = 0;
  jumpDelta = 0;
  jumpTime = 0;
  hasSupport = false;
  actionVx = 0;
  actionVy = 0;
  stepRandInt = 0;

  agent = { isPlayer: true, x: 0.4, y: 0.4, vx: 0, vy: 0, rx: 0.4, ry: 0.4 };

  oobObject = WALL_OBJ;
  wallTheme = randn(WALL_THEMES.length);

  // 1. maze, upscaled 3x with per-cell noise
  const mGet = generateMazeNoDeadEnds();
  for (let i = 0; i < MAIN_W * MAIN_H; i++) {
    const obj = mGet(Math.floor((i % MAIN_W) / MAZE_SCALE) + 1,
                     Math.floor(Math.floor(i / MAIN_W) / MAZE_SCALE) + 1);
    const prob = obj === WALL_OBJ ? 0.8 : 0.2;
    grid[i] = rand01() < prob ? WALL_OBJ : SPACE;
  }

  // 2. cellular automata smoothing
  caUpdate();
  caUpdate();

  // 3. border cells (solvability + bottom-row tile rendering)
  for (let i = 0; i < MAIN_W; i++) {
    setObj(i, 0, CAVEWALL);
    setObj(i, MAIN_H - 1, CAVEWALL);
  }
  for (let i = 0; i < MAIN_H; i++) {
    setObj(0, i, CAVEWALL);
    setObj(MAIN_W - 1, i, CAVEWALL);
  }

  // 4. keep only the largest open room
  const bestRoom = findBestRoom();
  grid.fill(CAVEWALL);
  const freeCells = [...bestRoom].sort((a, b) => a - b);
  for (const i of freeCells) grid[i] = SPACE;

  if (freeCells.length === 0) {
    // Degenerate CA outcome: no open room at all. Carve a small chamber so the
    // level is still playable rather than a solid block. ProcGen asserts here.
    for (let x = 1; x < MAIN_W - 1; x++) {
      for (let y = 1; y < 4; y++) { setObj(x, y, SPACE); freeCells.push(y * MAIN_W + x); }
    }
    freeCells.sort((a, b) => a - b);
  }

  const goalCell = chooseOne(freeCells);

  // 5. agent spawn: standing on ground
  const agentCandidates = [];
  for (let i = 0; i < MAIN_W * MAIN_H; i++) {
    if (isSpaceOnGround(i % MAIN_W, Math.floor(i / MAIN_W))) agentCandidates.push(i);
  }
  const agentCell = agentCandidates.length > 0 ? chooseOne(agentCandidates) : chooseOne(freeCells);

  // 6. carve only the dilated agent->goal path
  const goalPath = findPath(agentCell, goalCell);
  const widePath = new Set(goalPath.length > 0 ? goalPath : [agentCell, goalCell]);
  expandRoom(widePath, 4);
  grid.fill(CAVEWALL);
  for (const i of widePath) grid[i] = SPACE;

  goal = {
    isGoal: true,
    x: (goalCell % MAIN_W) + 0.5,
    y: Math.floor(goalCell / MAIN_W) + 0.5,
    rx: GOAL_R,
    ry: GOAL_R,
  };

  // 7. spikes on flat ground
  for (let i = 0; i < MAIN_W * MAIN_H; i++) {
    const x = i % MAIN_W;
    const y = Math.floor(i / MAIN_W);
    if (isSpaceOnGround(x, y) && isSpaceOnGround(x - 1, y) && isSpaceOnGround(x + 1, y)) {
      if (rand01() < SPIKE_PROB) setObj(x, y, SPIKE);
    }
  }

  // 8. break up long vertical walls (solvability)
  for (let i = 0; i < MAIN_W * MAIN_H; i++) {
    const x = i % MAIN_W;
    const y = Math.floor(i / MAIN_W);
    if (isLeftWall(x, y) && isLeftWall(x, y + 1) && isLeftWall(x, y + 2)) {
      setObj(x, y + randn(3), SPACE);
    }
    if (isRightWall(x, y) && isRightWall(x, y + 1) && isRightWall(x, y + 2)) {
      setObj(x, y + randn(3), SPACE);
    }
  }

  agent.x = (agentCell % MAIN_W) + 0.5;
  agent.y = Math.floor(agentCell / MAIN_W) + agent.ry;   // ry is still 0.4 here

  // 9. spike cells become entities
  for (let i = 0; i < MAIN_W * MAIN_H; i++) {
    if (grid[i] !== SPIKE) continue;
    grid[i] = SPACE;
    spikes.push({
      x: (i % MAIN_W) + 0.5,
      y: Math.floor(i / MAIN_W) + SPIKE_RY,
      rx: SPIKE_RX,
      ry: SPIKE_RY,
    });
  }

  // 10. lit caps on wall tops (visual)
  for (let i = 0; i < MAIN_W * MAIN_H; i++) {
    const x = i % MAIN_W;
    const y = Math.floor(i / MAIN_W);
    if (isTopWall(x, y)) setObj(x, y, CAVEWALL_TOP);
  }

  agent.rx = AGENT_RX;
  agent.ry = AGENT_RY;

  oobObject = CAVEWALL;
}

function getGameState() {
  return { score: score, lives: lives, gameState: gameState };
}

function setup() {
  createCanvas(CANVAS, CANVAS);
  noStroke();
}

// ============================================================
// Step (game_step + set_action_xy + update_agent_velocity)
// ============================================================

// PlayTrain exposes Discrete(8); jumper only reads action_vx in {-1,0,1} and
// action_vy in {0,1}. UP and D both jump so LEFT+D / RIGHT+D recover ProcGen's
// diagonal jumps, which the 8-action set has no LEFT+UP for.
function setActionXY() {
  const left = keyIsDown(37);
  const right = keyIsDown(39);
  const jump = keyIsDown(38) || keyIsDown(32);

  actionVx = 0;
  if (left) actionVx -= 1;
  if (right) actionVx += 1;
  actionVy = jump ? 1 : 0;

  const objBelow1 = getObjFromFloats(agent.x - (agent.rx - 0.01), agent.y - (agent.ry + 0.01));
  const objBelow2 = getObjFromFloats(agent.x + (agent.rx - 0.01), agent.y - (agent.ry + 0.01));

  jumpDelta = 0;
  hasSupport = canSupport(objBelow1) || canSupport(objBelow2);

  if (hasSupport) jumpCount = 2;

  if (actionVy === 1 && jumpCount > 0 && (curTime - jumpTime > JUMP_COOLDOWN)) {
    jumpCount -= 1;
    jumpDelta = -1;
  } else {
    actionVy = 0;
  }

  if (actionVy > 0) jumpTime = curTime;
}

function updateAgentVelocity() {
  agent.vx = (1 - MIXRATE) * agent.vx + MIXRATE * MAXSPEED * actionVx;
  if (actionVy !== 0) agent.vy = MAXSPEED * actionVy * 2;
}

function gameStep() {
  curTime += 1;
  stepRandInt = randn(1000000);

  setActionXY();
  updateAgentVelocity();
  basicStepObject(agent);

  // handle_agent_collision
  if (hasCollision(goal, agent)) {
    score += GOAL_REWARD;
    gameState = 'WIN';
    return;
  }
  for (const s of spikes) {
    if (hasCollision(s, agent)) {
      lives = 0;
      gameState = 'GAMEOVER';
      return;
    }
  }

  // gravity is applied AFTER the move in jumper.cpp game_step
  if (agent.vy > -2) agent.vy -= GRAVITY;

  // is_out_of_bounds(agent)
  if (agent.x + agent.rx < 0 || agent.y + agent.ry < 0 ||
      agent.x - agent.rx > MAIN_W || agent.y - agent.ry > MAIN_H) {
    lives = 0;
    gameState = 'GAMEOVER';
  }
}

// ============================================================
// Render (choose_center + prepare_for_drawing + draw_foreground + compass)
// ============================================================

let centerX = 0;
let centerY = 0;

function sx(x) { return UNIT * (x - centerX + VISIBILITY / 2); }
function sy(y) { return UNIT * (VISIBILITY / 2 + centerY - y); }

function drawCompass() {
  // jumper.cpp draw_compass -- absolute screen coords, no y flip
  const cw = COMPASS_DIM * UNIT;
  const cxLeft = (VISIBILITY - COMPASS_DIM - 0.25) * UNIT;
  const cyTop = 0.25 * UNIT;
  const cx = cxLeft + cw / 2;
  const cy = cyTop + cw / 2;
  const cr = (cw / 2) * 0.95;

  noStroke();
  fill(COL_COMPASS[0], COL_COMPASS[1], COL_COMPASS[2]);
  ellipse(cx, cy, cw, cw);

  // ProcGen strokes the needle at rect.width()/(256/compass_dim). The PlayTrain
  // rasterizer applies strokeWeight in DEVICE pixels and clamps it to >= 1, so a
  // stroked line would be a fat wedge at 64x64 and hairline-thin in a browser.
  // A filled quad keeps ProcGen's proportion under both render paths.
  const theta = Math.atan2(goal.y - agent.y, goal.x - agent.x);
  const ex = cx + cr * Math.cos(theta);
  const ey = cy - cr * Math.sin(theta);
  const half = (CANVAS * COMPASS_DIM / 256) / 2;
  const px = Math.sin(theta) * half;
  const py = Math.cos(theta) * half;
  fill(COL_NEEDLE[0], COL_NEEDLE[1], COL_NEEDLE[2]);
  quad(cx + px, cy + py, ex + px, ey + py, ex - px, ey - py, cx - px, cy - py);

  const dx = goal.x - agent.x;
  const dy = goal.y - agent.y;
  const distPct = Math.sqrt(dx * dx + dy * dy) / (MAIN_W * Math.SQRT2);
  fill(COL_NEEDLE[0], COL_NEEDLE[1], COL_NEEDLE[2]);
  rect(cxLeft, (0.25 + COMPASS_DIM) * UNIT, cw * distPct, (COMPASS_DIM / 8) * UNIT);
}

function drawWorld() {
  centerX = agent.x;
  centerY = agent.y;

  background(COL_BG[0], COL_BG[1], COL_BG[2]);

  const theme = WALL_THEMES[wallTheme];
  const margin = VISIBILITY / 2 + 1;
  const lowX = Math.floor(centerX - margin);
  const highX = Math.ceil(centerX + margin);
  const lowY = Math.floor(centerY - margin);
  const highY = Math.ceil(centerY + margin);

  for (let x = lowX; x <= highX; x++) {
    for (let y = lowY; y <= highY; y++) {
      const t = getObj(x, y);
      if (t === SPACE) continue;
      const c = t === CAVEWALL_TOP ? theme.top : theme.mid;
      fill(c[0], c[1], c[2]);
      rect(sx(x), sy(y + 1), UNIT, UNIT);
    }
  }

  fill(COL_GOAL[0], COL_GOAL[1], COL_GOAL[2]);
  rect(sx(goal.x - goal.rx), sy(goal.y + goal.ry), 2 * goal.rx * UNIT, 2 * goal.ry * UNIT);

  fill(COL_SPIKE[0], COL_SPIKE[1], COL_SPIKE[2]);
  for (const s of spikes) {
    const l = sx(s.x - s.rx);
    const r = sx(s.x + s.rx);
    const top = sy(s.y + s.ry);
    const bot = sy(s.y - s.ry);
    triangle(l, bot, (l + r) / 2, top, r, bot);
  }

  // double-jump indicator: ProcGen draws it on the frame an airborne jump fires
  if (jumpDelta < 0 && !hasSupport) {
    fill(255, 255, 255);
    ellipse(sx(agent.x), sy(agent.y - agent.ry * 0.66), 2 * agent.rx * UNIT, (2 * agent.ry * UNIT) / 3);
  }

  fill(COL_PLAYER[0], COL_PLAYER[1], COL_PLAYER[2]);
  rect(sx(agent.x - agent.rx), sy(agent.y + agent.ry), 2 * agent.rx * UNIT, 2 * agent.ry * UNIT);

  drawCompass();
}

// ============================================================
// REQUIRED: p5.js lifecycle
// ============================================================

function draw() {
  if (gameState === 'PLAYING') gameStep();
  drawWorld();
}

// ============================================================
// Deviations from procgen_src/jumper.cpp
// ============================================================
//
// 1. Rendering. Flat fills on a dark background instead of Kenney sprites over
//    a photographic background, per PlayTrain's visual rules. Tile geometry and
//    entity radii are unchanged, so the 64x64 layout matches.
// 2. Goal color. ProcGen's carrot is orange, which at 64x64 in flat fill is hard
//    to separate from the red spikes. The goal is cyan -- the one saturated hue
//    that clashes with neither the red spikes, the blue player, nor any of the
//    four wall themes (green in particular ruled out the obvious green goal).
// 3. Player color is fixed blue rather than themed.
// 4. Action space. Discrete(8) instead of Discrete(15); the 6 (vx, jump)
//    combinations jumper actually uses are all reachable.
// 5. No TRAIL entities. ProcGen spawns a fading trail behind a moving agent;
//    the template forbids particle effects and they carry no task information.
// 6. Reward is sparse ON PURPOSE: +10 for the goal and nothing else, exactly as
//    in ProcGen. That sparsity is what makes jumper the hardest ProcGen game;
//    adding breadcrumb coins (as the previous PlayTrain jumper did) changes the
//    task. A random agent scores ~0 here, and that is correct behavior.
// 7. Degenerate-level guards. ProcGen asserts that the best room and the
//    agent->goal path are non-empty; with mulberry32 those asserts are
//    reachable, so both fall back rather than producing an unplayable level.
// 8. Episode length. ProcGen times out at 1000 steps; the PlayTrain runtime
//    truncates at maxSteps (default 2000).
