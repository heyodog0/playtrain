const TILE_SIZE = 30;
const PLAYER_SIZE = 20;
const ENEMY_SIZE = 20;
const ORB_SIZE = 6;
const L_ORB_SIZE = 12;

let grid = [];
let mazeDim = 15;
let player = { x: 0, y: 0, vx: 0, vy: 0 };
let enemies = [];
let orbs = [];
let largeOrbs = [];
let score = 0;
let lives = 3;
let gameState = 'PLAYING';
let powerUpTimer = 0;
const POWER_UP_DURATION = 300;
let totalOrbs = 0;
let collectedOrbs = 0;

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

function setup() {
  createCanvas(450, 450);
}

function resetGame(seed) {
  rng = mulberry32(seed);
  score = 0;
  lives = 1; // Standard Procgen chaser often has 1 life or simple death
  gameState = 'PLAYING';
  powerUpTimer = 0;
  collectedOrbs = 0;
  
  // Initialize Maze
  mazeDim = 15;
  grid = [];
  for (let y = 0; y < mazeDim; y++) {
    grid[y] = [];
    for (let x = 0; x < mazeDim; x++) {
      grid[y][x] = 1; // Wall
    }
  }

  // Recursive Backtracker for Maze
  let stack = [];
  let startX = 1, startY = 1;
  grid[startY][startX] = 0;
  stack.push([startX, startY]);

  while (stack.length > 0) {
    let [cx, cy] = stack[stack.length - 1];
    let neighbors = [];
    let dirs = [[0, -2], [0, 2], [-2, 0], [2, 0]];
    for (let [dx, dy] of dirs) {
      let nx = cx + dx, ny = cy + dy;
      if (nx > 0 && nx < mazeDim - 1 && ny > 0 && ny < mazeDim - 1 && grid[ny][nx] === 1) {
        neighbors.push([nx, ny]);
      }
    }

    if (neighbors.length > 0) {
      let [nx, ny] = neighbors[Math.floor(rng() * neighbors.length)];
      grid[ny][nx] = 0;
      grid[cy + (ny - cy) / 2][cx + (nx - cx) / 2] = 0;
      stack.push([nx, ny]);
    } else {
      stack.pop();
    }
  }

  // Break some walls to remove dead ends (as per reference)
  for (let i = 0; i < 15; i++) {
    let rx = Math.floor(rng() * (mazeDim - 2)) + 1;
    let ry = Math.floor(rng() * (mazeDim - 2)) + 1;
    grid[ry][rx] = 0;
  }

  // Populate Orbs and Entities
  orbs = [];
  largeOrbs = [];
  enemies = [];
  let freeCells = [];

  for (let y = 1; y < mazeDim - 1; y++) {
    for (let x = 1; x < mazeDim - 1; x++) {
      if (grid[y][x] === 0) {
        freeCells.push({ x, y });
        orbs.push({ x: x * TILE_SIZE + TILE_SIZE / 2, y: y * TILE_SIZE + TILE_SIZE / 2, active: true });
      }
    }
  }
  totalOrbs = orbs.length;

  // Player start
  let pCell = freeCells.splice(Math.floor(rng() * freeCells.length), 1)[0];
  player.x = pCell.x * TILE_SIZE + TILE_SIZE / 2;
  player.y = pCell.y * TILE_SIZE + TILE_SIZE / 2;
  player.vx = 0;
  player.vy = 0;

  // Power orbs (4 corners ideally)
  for (let i = 0; i < 4; i++) {
    if (freeCells.length > 0) {
      let idx = Math.floor(rng() * freeCells.length);
      let c = freeCells.splice(idx, 1)[0];
      largeOrbs.push({ x: c.x * TILE_SIZE + TILE_SIZE / 2, y: c.y * TILE_SIZE + TILE_SIZE / 2, active: true });
      // Remove small orb at same spot
      let sIdx = orbs.findIndex(o => o.x === c.x * TILE_SIZE + TILE_SIZE / 2 && o.y === c.y * TILE_SIZE + TILE_SIZE / 2);
      if (sIdx !== -1) orbs.splice(sIdx, 1);
    }
  }
  totalOrbs = orbs.length;

  // Enemies
  let numEnemies = 3;
  for (let i = 0; i < numEnemies; i++) {
    if (freeCells.length > 0) {
      let idx = Math.floor(rng() * freeCells.length);
      let c = freeCells.splice(idx, 1)[0];
      enemies.push({
        x: c.x * TILE_SIZE + TILE_SIZE / 2,
        y: c.y * TILE_SIZE + TILE_SIZE / 2,
        vx: 0,
        vy: 0,
        speed: 1.5,
        type: 'ACTIVE',
        respawnTimer: 0
      });
    }
  }
}

function draw() {
  if (gameState !== 'PLAYING') return;

  background(0);

  // Input
  let speed = 2.5;
  player.vx = 0;
  player.vy = 0;
  if (keyIsDown(37)) player.vx = -speed;
  else if (keyIsDown(39)) player.vx = speed;
  else if (keyIsDown(38)) player.vy = -speed;
  else if (keyIsDown(40)) player.vy = speed;

  // Update Player
  moveEntity(player, PLAYER_SIZE);

  // Update Timers
  if (powerUpTimer > 0) powerUpTimer--;

  // Collisions: Orbs
  for (let o of orbs) {
    if (o.active && dist(player.x, player.y, o.x, o.y) < 15) {
      o.active = false;
      score += 5;
      collectedOrbs++;
    }
  }

  for (let lo of largeOrbs) {
    if (lo.active && dist(player.x, player.y, lo.x, lo.y) < 15) {
      lo.active = false;
      powerUpTimer = POWER_UP_DURATION;
      score += 20;
    }
  }

  if (collectedOrbs >= totalOrbs) {
    gameState = 'WIN';
    score += 500;
  }

  // Update Enemies
  for (let e of enemies) {
    if (e.type === 'EGG') {
      e.respawnTimer--;
      if (e.respawnTimer <= 0) e.type = 'ACTIVE';
      continue;
    }

    // AI logic (Simplified Chase/Flee)
    if (Math.abs(e.x % TILE_SIZE - TILE_SIZE / 2) < 2 && Math.abs(e.y % TILE_SIZE - TILE_SIZE / 2) < 2) {
      // Junction decision
      let directions = [[0, -1], [0, 1], [-1, 0], [1, 0]];
      let bestDir = null;
      let maxDist = powerUpTimer > 0 ? -1 : 1000000;

      for (let d of directions) {
        let nx = Math.floor(e.x / TILE_SIZE) + d[0];
        let ny = Math.floor(e.y / TILE_SIZE) + d[1];
        if (grid[ny] && grid[ny][nx] === 0) {
          let dToP = dist(nx * TILE_SIZE, ny * TILE_SIZE, player.x, player.y);
          if (powerUpTimer > 0) {
            if (dToP > maxDist) { maxDist = dToP; bestDir = d; }
          } else {
            if (dToP < maxDist) { maxDist = dToP; bestDir = d; }
          }
        }
      }
      if (bestDir) {
        e.vx = bestDir[0] * e.speed;
        e.vy = bestDir[1] * e.speed;
      }
    }
    
    moveEntity(e, ENEMY_SIZE);

    // Collision with player
    if (dist(player.x, player.y, e.x, e.y) < 20) {
      if (powerUpTimer > 0) {
        // Eat enemy
        score += 100;
        e.type = 'EGG';
        e.respawnTimer = 180;
        // Move back to a random free cell
        e.x = Math.floor(mazeDim / 2) * TILE_SIZE + TILE_SIZE / 2;
        e.y = Math.floor(mazeDim / 2) * TILE_SIZE + TILE_SIZE / 2;
      } else {
        gameState = 'GAMEOVER';
      }
    }
  }

  // Render
  // Walls
  noStroke();
  fill(60);
  for (let y = 0; y < mazeDim; y++) {
    for (let x = 0; x < mazeDim; x++) {
      if (grid[y][x] === 1) rect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }

  // Orbs
  fill(0, 255, 0);
  for (let o of orbs) {
    if (o.active) rect(o.x - ORB_SIZE / 2, o.y - ORB_SIZE / 2, ORB_SIZE, ORB_SIZE);
  }
  fill(255, 255, 0);
  for (let lo of largeOrbs) {
    if (lo.active) rect(lo.x - L_ORB_SIZE / 2, lo.y - L_ORB_SIZE / 2, L_ORB_SIZE, L_ORB_SIZE);
  }

  // Enemies
  for (let e of enemies) {
    if (e.type === 'EGG') fill(100, 0, 0);
    else if (powerUpTimer > 0) fill(150, 150, 255);
    else fill(255, 0, 0);
    ellipse(e.x, e.y, ENEMY_SIZE);
  }

  // Player
  fill(0, 100, 255);
  rect(player.x - PLAYER_SIZE / 2, player.y - PLAYER_SIZE / 2, PLAYER_SIZE, PLAYER_SIZE);
}

function moveEntity(ent, size) {
  let r = size / 2;
  
  // X movement
  let nextX = ent.x + ent.vx;
  if (!checkWallCollision(nextX, ent.y, r)) {
    ent.x = nextX;
  } else {
    // Snap to grid
    ent.x = Math.floor(ent.x / TILE_SIZE) * TILE_SIZE + TILE_SIZE / 2;
  }

  // Y movement
  let nextY = ent.y + ent.vy;
  if (!checkWallCollision(ent.x, nextY, r)) {
    ent.y = nextY;
  } else {
    ent.y = Math.floor(ent.y / TILE_SIZE) * TILE_SIZE + TILE_SIZE / 2;
  }
}

function checkWallCollision(px, py, r) {
  let gridX1 = Math.floor((px - r) / TILE_SIZE);
  let gridX2 = Math.floor((px + r) / TILE_SIZE);
  let gridY1 = Math.floor((py - r) / TILE_SIZE);
  let gridY2 = Math.floor((py + r) / TILE_SIZE);

  if (gridX1 < 0 || gridX2 >= mazeDim || gridY1 < 0 || gridY2 >= mazeDim) return true;

  return (grid[gridY1][gridX1] === 1 ||
          grid[gridY1][gridX2] === 1 ||
          grid[gridY2][gridX1] === 1 ||
          grid[gridY2][gridX2] === 1);
}

function getGameState() {
  return {
    score: score,
    lives: lives,
    gameState: gameState
  };
}

// Action Mapping handled in draw() via keyIsDown