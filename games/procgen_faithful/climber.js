// climber -- faithful port of ProcGen's climber.cpp (easy distribution mode).
//
// Ported from games/procgen_src/climber.cpp plus the shared engine in
// procgen/src/basic-abstract-game.cpp. The simulation runs in ProcGen's own
// frame: tile units, y increasing UPWARD, entities as (x, y, rx, ry) AABBs.
// Only the renderer flips y into p5's screen space.
//
// Kept from the original:
//   - 16x64 world (easy mode), agent at (1.5, 1.5), coins are the whole task
//   - platform generator: difficulty tier -> platform count, delta_y from the
//     jump arc, run direction flipped at the margins, coin on ~half of the
//     platforms and always on the last one
//   - floating patrol enemies spawned BELOW the next platform, +-4 tile patrol
//   - physics: gravity .2, max_jump 1.5, air_control .15, maxspeed .5,
//     mixrate .5, and the sub-stepped swept collision from basic_step_object
//   - camera: fixed x, agent pinned 2.5 tiles above the bottom edge
//   - reward: +1 per coin, +10 completion, enemy contact ends the episode
//
// Deliberate deviations (see the notes at the bottom of this file):
//   flat colors instead of textured sprites, dark background, fixed player color.

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
// Constants (climber.cpp + basic-abstract-game.cpp, EasyMode)
// ============================================================

const SPACE = 0;
const WALL_MID = 15;
const WALL_TOP = 16;

const MAIN_W = 16;          // choose_world_dim, EasyMode
const MAIN_H = 64;

const GRAVITY = 0.2;
const MAX_JUMP = 1.5;
const AIR_CONTROL = 0.15;
const MAXSPEED = 0.5;
const MIXRATE = 0.5;
const AGENT_R = 0.5;

const COIN_R = 0.3;
const ENEMY_RY = 0.5;
const ENEMY_RX = 0.6875;    // match_aspect_ratio: .5 * (44/32) for enemySwimming_1
const ENEMY_SPEED = 0.15;
const PATROL_RANGE = 4;
const ENEMY_PROB = 0.2;     // EasyMode

const COIN_REWARD = 1;
const COMPLETION_BONUS = 10;

const VISIBILITY = MAIN_W;  // choose_center sets visibility = main_width
const UNIT = 24;            // logical px per tile -> 384x384 canvas
const CANVAS = VISIBILITY * UNIT;

const WALL_THEMES = [
  { top: [142, 154, 168], mid: [74, 82, 92] },
  { top: [111, 207, 90], mid: [47, 122, 52] },
  { top: [176, 122, 74], mid: [109, 69, 38] },
  { top: [168, 111, 208], mid: [92, 58, 128] },
];
const COL_BG = [10, 10, 15];
const COL_PLAYER = [47, 107, 255];
const COL_COIN = [255, 255, 0];
const COL_ENEMY = [255, 43, 43];

// ============================================================
// State
// ============================================================

let score = 0;
let lives = 1;
let gameState = 'PLAYING';

let grid = null;            // Int16Array, index = y * MAIN_W + x
let agent = null;
let entities = [];          // coins and enemies
let wallTheme = 0;
let coinQuota = 0;
let coinsCollected = 0;
let hasSupport = false;
let actionVx = 0;
let actionVy = 0;
let stepRandInt = 0;

// ============================================================
// Grid helpers (basic-abstract-game.cpp)
// ============================================================

// out_of_bounds_object = WALL_MID (set in the Climber constructor)
function getObj(x, y) {
  if (x < 0 || x >= MAIN_W || y < 0 || y >= MAIN_H) return WALL_MID;
  return grid[y * MAIN_W + x];
}

function getObjFromFloats(i, j) {
  if (i < 0) return WALL_MID;
  if (j < 0) return WALL_MID;
  return getObj(Math.floor(i), Math.floor(j));
}

function setObj(x, y, v) {
  if (x < 0 || x >= MAIN_W || y < 0 || y >= MAIN_H) return;
  grid[y * MAIN_W + x] = v;
}

function fillElem(x, y, dx, dy, v) {
  for (let i = 0; i < dx; i++) {
    for (let j = 0; j < dy; j++) setObj(x + i, y + j, v);
  }
}

function isWall(t) { return t === WALL_MID || t === WALL_TOP; }
function canSupport(t) { return isWall(t); }   // out_of_bounds_object is WALL_MID

// ============================================================
// Swept collision (basic_step_object / sub_step)
// ============================================================
// Climber has no entity-vs-entity blocking or reflection -- is_blocked only
// fires on wall grid types and will_reflect only on (ENEMY, wall) -- so the
// entity pass of sub_step is a no-op here and is omitted.

function isBlocked(obj, target) {
  if (target === WALL_MID) return true;           // == out_of_bounds_object
  if (obj.isPlayer && isWall(target)) return true;
  return false;
}

function willReflect(obj, target) {
  return obj.isEnemy && isWall(target);
}

function subStep(obj, vx, vy) {
  let nx = obj.x + vx;
  let ny = obj.y + vy;
  const margin = 0.98;
  const isHorizontal = vx !== 0;

  let block = false;
  let reflect = false;

  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const t = getObjFromFloats(
        nx + obj.rx * margin * (2 * i - 1),
        ny + obj.ry * margin * (2 * j - 1),
      );
      if (isBlocked(obj, t)) block = true;
      if (willReflect(obj, t)) reflect = true;
    }
  }

  if (reflect) {
    if (isHorizontal) {
      const delta = vx < 0
        ? Math.ceil(nx - obj.rx) - (nx - obj.rx)
        : Math.floor(nx + obj.rx) - (nx + obj.rx);
      obj.vx = -obj.vx;
      nx = nx + 2 * delta;
    } else {
      const delta = vy < 0
        ? Math.ceil(ny - obj.ry) - (ny - obj.ry)
        : Math.floor(ny + obj.ry) - (ny + obj.ry);
      obj.vy = -obj.vy;
      ny = ny + 2 * delta;
    }
  } else if (block) {
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
// Level generation (climber.cpp)
// ============================================================

function initFloorAndWalls() {
  fillElem(0, 0, MAIN_W, 1, WALL_TOP);
  fillElem(0, 0, 1, MAIN_H, WALL_MID);
  fillElem(MAIN_W - 1, 0, 1, MAIN_H, WALL_MID);
  fillElem(0, MAIN_H - 1, MAIN_W, 1, WALL_MID);
}

function chooseDeltaY() {
  const maxDy = Math.floor(MAX_JUMP * MAX_JUMP / (2 * GRAVITY));  // 5
  const minDy = 3;
  return randn(maxDy - minDy + 1) + minDy;
}

function generatePlatforms() {
  const difficulty = randn(3);
  const minPlatforms = difficulty * difficulty + 1;
  const maxPlatforms = (difficulty + 1) * (difficulty + 1) + 1;
  const numPlatforms = randn(maxPlatforms - minPlatforms + 1) + minPlatforms;

  coinQuota = 0;
  coinsCollected = 0;

  let currX = randn(MAIN_W - 4) + 2;
  let currY = 0;
  const marginX = 3;

  for (let i = 0; i < numPlatforms; i++) {
    const deltaY = chooseDeltaY();

    // only spawn enemies that won't be trapped in tight spaces
    const canSpawnEnemy = (currX >= marginX) && (currX <= MAIN_W - marginX);

    if (canSpawnEnemy && rand01() < ENEMY_PROB) {
      entities.push({
        isEnemy: true,
        x: currX + 0.5,
        y: currY + randn(2) + 2 + 0.5,
        vx: 0.15 * (randn(2) * 2 - 1),
        vy: 0,
        rx: ENEMY_RX,
        ry: ENEMY_RY,
        spawnX: currX + 0.5,
      });
    }

    currY += deltaY;
    const platLen = 2 + randn(10);

    let vx = randn(2) * 2 - 1;
    if (currX < marginX) vx = 1;
    if (currX > MAIN_W - marginX) vx = -1;

    const candidates = [];
    for (let j = 0; j < platLen; j++) {
      const nx = currX + (j + 1) * vx;
      if (nx <= 0 || nx >= MAIN_W - 1) break;
      candidates.push(nx);
      setObj(nx, currY, WALL_TOP);
    }

    if (candidates.length === 0) continue;

    if (rand01() < 0.5 || i === numPlatforms - 1) {
      const coinX = chooseOne(candidates);
      entities.push({
        isCoin: true,
        x: coinX + 0.5,
        y: currY + 1.5,
        vx: 0,
        vy: 0,
        rx: COIN_R,
        ry: COIN_R,
      });
      coinQuota += 1;
    }

    currX = chooseOne(candidates);
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
  entities = [];
  hasSupport = false;
  actionVx = 0;
  actionVy = 0;
  stepRandInt = 0;

  agent = {
    isPlayer: true,
    x: 1 + AGENT_R,
    y: 1 + AGENT_R,
    vx: 0,
    vy: 0,
    rx: AGENT_R,
    ry: AGENT_R,
  };

  wallTheme = randn(WALL_THEMES.length);

  initFloorAndWalls();
  generatePlatforms();

  // ProcGen forces a coin onto the last platform, so coin_quota is >= 1 in
  // practice. Guard the degenerate case anyway: quota 0 would mean
  // "coins_collected == coin_quota" on step 1, i.e. an instant free +10.
  if (coinQuota === 0) {
    entities.push({ isCoin: true, x: MAIN_W / 2, y: 1.5, vx: 0, vy: 0, rx: COIN_R, ry: COIN_R });
    coinQuota = 1;
  }
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

// PlayTrain exposes Discrete(8); ProcGen's climber only ever reads
// action_vx in {-1,0,1} and action_vy in {0,1}. UP and D both mean jump so
// that LEFT+D / RIGHT+D recover ProcGen's diagonal jump actions, which the
// 8-action set has no LEFT+UP for.
function readAction() {
  const left = keyIsDown(37);
  const right = keyIsDown(39);
  const jump = keyIsDown(38) || keyIsDown(32);

  actionVx = 0;
  if (left) actionVx -= 1;
  if (right) actionVx += 1;
  actionVy = jump ? 1 : 0;
}

function setActionXY() {
  readAction();

  const objBelow1 = getObjFromFloats(agent.x - (agent.rx - 0.01), agent.y - (agent.ry + 0.01));
  const objBelow2 = getObjFromFloats(agent.x + (agent.rx - 0.01), agent.y - (agent.ry + 0.01));
  hasSupport = canSupport(objBelow1) || canSupport(objBelow2);

  if (!(hasSupport && actionVy === 1)) actionVy = 0;
}

function updateAgentVelocity() {
  const mixrateX = hasSupport ? MIXRATE : (MIXRATE * AIR_CONTROL);
  agent.vx = (1 - mixrateX) * agent.vx + mixrateX * MAXSPEED * actionVx;
  if (actionVy > 0) agent.vy = MAX_JUMP;

  if (!hasSupport) {
    if (agent.vy > -2) agent.vy -= GRAVITY;
  }
}

function gameStep() {
  stepRandInt = randn(1000000);

  setActionXY();
  updateAgentVelocity();

  // step_entities: reverse order, smart_step objects sweep, the rest drift
  for (let i = entities.length - 1; i >= 0; i--) {
    const e = entities[i];
    if (e.isEnemy) basicStepObject(e);
  }
  basicStepObject(agent);

  // agent collisions (handle_agent_collision)
  for (let i = entities.length - 1; i >= 0; i--) {
    const e = entities[i];
    if (!hasCollision(e, agent)) continue;

    if (e.isEnemy) {
      lives = 0;
      gameState = 'GAMEOVER';
      return;
    }
    if (e.isCoin) {
      score += COIN_REWARD;
      coinsCollected += 1;
      entities.splice(i, 1);
    }
  }

  // enemy patrol clamp
  for (const e of entities) {
    if (!e.isEnemy) continue;
    if (e.x > e.spawnX + PATROL_RANGE) e.vx = -Math.abs(e.vx);
    else if (e.x < e.spawnX - PATROL_RANGE) e.vx = Math.abs(e.vx);
    // a reflection off a side wall can zero vx out; keep the patrol alive
    if (e.vx === 0) e.vx = ENEMY_SPEED;
  }

  if (coinQuota === coinsCollected) {
    score += COMPLETION_BONUS;
    gameState = 'WIN';
    return;
  }

  // is_out_of_bounds(agent)
  if (agent.y + agent.ry < 0 || agent.y - agent.ry > MAIN_H) {
    lives = 0;
    gameState = 'GAMEOVER';
  }
}

// ============================================================
// Render (choose_center + prepare_for_drawing + draw_foreground)
// ============================================================

let centerX = 0;
let centerY = 0;

function sx(x) { return UNIT * (x - centerX + VISIBILITY / 2); }
function sy(y) { return UNIT * (VISIBILITY / 2 + centerY - y); }

function drawWorld() {
  // choose_center
  centerX = MAIN_W / 2;
  centerY = agent.y + MAIN_W / 2 - 5 * agent.ry;

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
      const c = t === WALL_TOP ? theme.top : theme.mid;
      fill(c[0], c[1], c[2]);
      rect(sx(x), sy(y + 1), UNIT, UNIT);
    }
  }

  for (const e of entities) {
    if (e.isCoin) {
      fill(COL_COIN[0], COL_COIN[1], COL_COIN[2]);
      rect(sx(e.x - e.rx), sy(e.y + e.ry), 2 * e.rx * UNIT, 2 * e.ry * UNIT);
    } else if (e.isEnemy) {
      fill(COL_ENEMY[0], COL_ENEMY[1], COL_ENEMY[2]);
      ellipse(sx(e.x), sy(e.y), 2 * e.rx * UNIT, 2 * e.ry * UNIT);
    }
  }

  fill(COL_PLAYER[0], COL_PLAYER[1], COL_PLAYER[2]);
  rect(sx(agent.x - agent.rx), sy(agent.y + agent.ry), 2 * agent.rx * UNIT, 2 * agent.ry * UNIT);
}

// ============================================================
// REQUIRED: p5.js lifecycle
// ============================================================

function draw() {
  if (gameState === 'PLAYING') gameStep();
  drawWorld();
}

// ============================================================
// Deviations from procgen_src/climber.cpp
// ============================================================
//
// 1. Rendering. ProcGen composites Kenney sprite tiles over a photographic
//    background. PlayTrain's visual rules require flat fills on a dark
//    background, so walls/coins/enemies/player are solid shapes. Geometry,
//    tile sizes and entity radii are unchanged, so the 64x64 layout matches.
// 2. Player color is fixed blue. ProcGen calls choose_random_theme(agent),
//    which can make the player red -- indistinguishable from a red enemy once
//    the sprite texture is gone. wall_theme IS still randomized (4 palettes),
//    since that is level variation the template explicitly wants.
// 3. Action space. Discrete(8) instead of Discrete(15); the 6 (vx, jump)
//    combinations climber actually uses are all reachable (see readAction).
// 4. Episode length. ProcGen times out at 1000 steps; the PlayTrain runtime
//    truncates at maxSteps (default 2000).
// 5. Enemy patrol gets a vx floor. A wall reflection during the same step that
//    the patrol clamp fires can leave vx at 0 and freeze an enemy; ProcGen's
//    float path makes this vanishingly rare, mulberry32 makes it reachable.
