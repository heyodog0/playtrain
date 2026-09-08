// ============================================================
// REQUIRED: p5.js lifecycle
// ============================================================

const W = 20;
const H = 20;
const TILE = 20; // 20 * 20 = 400x400 canvas

const SPACE = 0;
const BOULDER = 1;
const DIAMOND = 2;
const MOVING_BOULDER = 3;
const MOVING_DIAMOND = 4;
const EXIT = 6;
const DIRT = 9;

let score = 0;
let lives = 0;
let gameState = 'PLAYING';

let grid = [];
let agent = {};
let enemies = [];
let diamonds_remaining = 0;
let tickCount = 0;

function setup() {
  createCanvas(400, 400);
  noStroke();
}

function draw() {
  if (gameState === 'PLAYING') {
    tickCount++;
    if (tickCount % 6 === 0) {
      updateGame();
    }
  }
  drawGame();
}

// ============================================================
// REQUIRED: RL interface
// ============================================================

function getGameState() {
  return {
    score: score,
    lives: lives,
    gameState: gameState
  };
}

function resetGame(seed) {
  rng = mulberry32(seed);
  score = 0;
  lives = 3;
  gameState = 'PLAYING';
  tickCount = 0;

  grid = Array.from({ length: W }, () => Array(H).fill(DIRT));

  let num_diamonds = Math.floor((12 / 400) * (W * H));
  let num_boulders = Math.floor((80 / 400) * (W * H));

  let indices = [];
  for (let i = 0; i < W * H; i++) indices.push(i);
  for (let i = indices.length - 1; i > 0; i--) {
    let j = Math.floor(rng() * (i + 1));
    let temp = indices[i];
    indices[i] = indices[j];
    indices[j] = temp;
  }

  agent.x = indices[0] % W;
  agent.y = Math.floor(indices[0] / W);
  grid[agent.x][agent.y] = SPACE;

  for (let i = 0; i < num_diamonds; i++) {
    let idx = indices[i + 1];
    grid[idx % W][Math.floor(idx / W)] = DIAMOND;
  }
  for (let i = 0; i < num_boulders; i++) {
    let idx = indices[i + 1 + num_diamonds];
    grid[idx % W][Math.floor(idx / W)] = BOULDER;
  }

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      let nx = agent.x + dx;
      let ny = agent.y + dy;
      if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
        if (grid[nx][ny] === BOULDER) {
          grid[nx][ny] = DIRT;
        }
      }
    }
  }

  let dirt_cells = [];
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      if (grid[x][y] === DIRT) dirt_cells.push({ x, y });
    }
  }
  let exit_idx = Math.floor(rng() * dirt_cells.length);
  let ep = dirt_cells[exit_idx];
  grid[ep.x][ep.y] = EXIT;

  enemies = [];
  let num_enemies = 4;
  for (let i = 0; i < num_enemies; i++) {
    for (let tries = 0; tries < 50; tries++) {
      let ex = Math.floor(rng() * W);
      let ey = Math.floor(rng() * H);
      if (Math.abs(ex - agent.x) > 3 || Math.abs(ey - agent.y) > 3) {
        if (grid[ex][ey] === DIRT || grid[ex][ey] === SPACE) {
          enemies.push({ x: ex, y: ey, vx: 1, vy: 0, dead: false });
          grid[ex][ey] = SPACE;
          break;
        }
      }
    }
  }

  diamonds_remaining = num_diamonds;
}

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

// ============================================================
// GAME LOGIC
// ============================================================

function is_moving(type) {
  return type === MOVING_BOULDER || type === MOVING_DIAMOND;
}

function get_moving(type) {
  if (type === BOULDER) return MOVING_BOULDER;
  if (type === DIAMOND) return MOVING_DIAMOND;
  return type;
}

function get_stat(type) {
  if (type === MOVING_BOULDER) return BOULDER;
  if (type === MOVING_DIAMOND) return DIAMOND;
  return type;
}

function is_free(x, y) {
  if (x < 0 || x >= W || y < 0 || y >= H) return false;
  if (grid[x][y] !== SPACE) return false;
  if (agent.x === x && agent.y === y) return false;
  for (let e of enemies) {
    if (e.x === x && e.y === y) return false;
  }
  return true;
}

function updateGame() {
  let dx = 0, dy = 0;
  if (keyIsDown(37)) dx = -1;
  else if (keyIsDown(39)) dx = 1;
  else if (keyIsDown(38)) dy = -1;
  else if (keyIsDown(40)) dy = 1;

  // 1. Agent Movement
  if (dx !== 0 || dy !== 0) {
    let nx = agent.x + dx;
    let ny = agent.y + dy;

    if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
      let enemy_there = enemies.find(e => e.x === nx && e.y === ny);
      if (enemy_there) {
        lives--;
        if (lives <= 0) gameState = 'GAMEOVER';
        agent.x = nx;
        agent.y = ny;
      } else {
        let target = grid[nx][ny];
        if (dy === 0 && (target === BOULDER || target === MOVING_BOULDER)) {
          let pushX = nx + dx;
          if (pushX >= 0 && pushX < W && grid[pushX][ny] === SPACE) {
            let push_enemy_there = enemies.find(e => e.x === pushX && e.y === ny);
            if (!push_enemy_there && !(agent.x === pushX && agent.y === ny)) {
              grid[pushX][ny] = BOULDER;
              grid[nx][ny] = SPACE;
              agent.x = nx;
              agent.y = ny;
            }
          }
        } else if (target === SPACE || target === DIRT || target === DIAMOND || target === MOVING_DIAMOND || target === EXIT) {
          if (target === DIAMOND || target === MOVING_DIAMOND) {
            score += 1;
            diamonds_remaining--;
            grid[nx][ny] = SPACE;
          } else if (target === DIRT) {
            grid[nx][ny] = SPACE;
          }

          agent.x = nx;
          agent.y = ny;

          if (target === EXIT && diamonds_remaining <= 0) {
            score += 10;
            gameState = 'WIN';
          }
        }
      }
    }
  }

  // 2. Falling Objects
  let moved = Array.from({ length: W }, () => Array(H).fill(false));

  for (let y = H - 1; y >= 0; y--) {
    for (let x = 0; x < W; x++) {
      if (moved[x][y]) continue;

      let obj = grid[x][y];
      if (obj === BOULDER || obj === MOVING_BOULDER || obj === DIAMOND || obj === MOVING_DIAMOND) {
        let below_y = y + 1;
        if (below_y < H) {
          let obj_below = grid[x][below_y];
          let agent_below = (agent.x === x && agent.y === below_y);
          let enemy_below = enemies.find(e => e.x === x && e.y === below_y);

          if (obj_below === SPACE && !agent_below && !enemy_below) {
            grid[x][y] = SPACE;
            grid[x][below_y] = get_moving(obj);
            moved[x][below_y] = true;
          } else if (agent_below && is_moving(obj)) {
            lives--;
            if (lives <= 0) gameState = 'GAMEOVER';
            grid[x][y] = get_stat(obj);
          } else if (enemy_below && is_moving(obj)) {
            enemy_below.dead = true;
            score += 2;
            grid[x][y] = SPACE;
            grid[x][below_y] = get_stat(obj);
            moved[x][below_y] = true;
          } else if (obj_below === BOULDER || obj_below === MOVING_BOULDER || obj_below === DIAMOND || obj_below === MOVING_DIAMOND) {
            if (x > 0 && is_free(x - 1, y) && is_free(x - 1, below_y)) {
              grid[x][y] = SPACE;
              grid[x - 1][y] = get_stat(obj);
              moved[x - 1][y] = true;
            } else if (x < W - 1 && is_free(x + 1, y) && is_free(x + 1, below_y)) {
              grid[x][y] = SPACE;
              grid[x + 1][y] = get_stat(obj);
              moved[x + 1][y] = true;
            } else {
              grid[x][y] = get_stat(obj);
            }
          } else {
            grid[x][y] = get_stat(obj);
          }
        } else {
          grid[x][y] = get_stat(obj);
        }
      }
    }
  }

  enemies = enemies.filter(e => !e.dead);

  // 3. Enemy Movement
  for (let e of enemies) {
    if (rng() < 0.15) {
      if (rng() < 0.5) { e.vx = (rng() < 0.5 ? 1 : -1); e.vy = 0; }
      else { e.vx = 0; e.vy = (rng() < 0.5 ? 1 : -1); }
    }

    let nx = e.x + e.vx;
    let ny = e.y + e.vy;

    if (nx >= 0 && nx < W && ny >= 0 && ny < H && grid[nx][ny] === SPACE && !(agent.x === nx && agent.y === ny && gameState !== 'PLAYING')) {
      if (nx === agent.x && ny === agent.y) {
        lives--;
        if (lives <= 0) gameState = 'GAMEOVER';
        e.x = nx; e.y = ny;
      } else {
        e.x = nx; e.y = ny;
      }
    } else {
      e.vx *= -1; e.vy *= -1;
    }
  }

  // Final check for enemy collision
  for (let e of enemies) {
    if (e.x === agent.x && e.y === agent.y && gameState === 'PLAYING') {
      lives--;
      if (lives <= 0) gameState = 'GAMEOVER';
    }
  }
}

function drawGame() {
  background(0);

  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      let px = x * TILE;
      let py = y * TILE;
      let obj = grid[x][y];

      if (obj === DIRT) {
        fill(139, 69, 19);
        rect(px, py, TILE, TILE);
      } else if (obj === BOULDER || obj === MOVING_BOULDER) {
        fill(128);
        ellipse(px + TILE / 2, py + TILE / 2, TILE * 0.8, TILE * 0.8);
      } else if (obj === DIAMOND || obj === MOVING_DIAMOND) {
        fill(0, 255, 255);
        rect(px + TILE * 0.2, py + TILE * 0.2, TILE * 0.6, TILE * 0.6);
      } else if (obj === EXIT) {
        if (diamonds_remaining <= 0) {
          fill(255, 255, 0);
          rect(px, py, TILE, TILE);
          fill(0);
          rect(px + TILE * 0.2, py + TILE * 0.2, TILE * 0.6, TILE * 0.6);
        } else {
          fill(128, 128, 0);
          rect(px, py, TILE, TILE);
          fill(50, 50, 0);
          rect(px + TILE * 0.2, py + TILE * 0.2, TILE * 0.6, TILE * 0.6);
        }
      }
    }
  }

  fill(255, 0, 0);
  for (let e of enemies) {
    let cx = e.x * TILE + TILE / 2;
    let cy = e.y * TILE + TILE / 2;
    triangle(cx, cy - TILE * 0.4, cx - TILE * 0.4, cy + TILE * 0.4, cx + TILE * 0.4, cy + TILE * 0.4);
  }

  fill(0, 255, 0);
  rect(agent.x * TILE, agent.y * TILE, TILE, TILE);
}