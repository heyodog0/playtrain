// ============================================================
// REQUIRED: p5.js lifecycle
// ============================================================

let rng = null;
let score = 0;
let lives = 0;
let gameState = 'PLAYING';

const TILE_SIZE = 20;
const GRAVITY = 0.5;
const JUMP_FORCE = -8;
const SPEED = 4;
const MAX_FALL_SPEED = 10;

let player;
let grid = [];
let enemies = [];
let coin;
let cameraX = 0;
let max_tile_x = 0;

function setup() {
  createCanvas(400, 400);
  noSmooth();
}

function draw() {
  background(30, 30, 40);

  if (gameState === 'PLAYING') {
    updateGame();
  }

  // Camera tracking
  let desiredCamera = player.x - width / 2.5;
  if (desiredCamera < 0) desiredCamera = 0;
  cameraX = desiredCamera;

  push();
  translate(Math.floor(-cameraX), 0);

  noStroke();

  // Draw grid (Terrain, Hazards, Crates)
  let startCol = Math.max(0, Math.floor(cameraX / TILE_SIZE));
  let endCol = Math.min(grid.length - 1, startCol + Math.ceil(width / TILE_SIZE) + 1);

  for (let x = startCol; x <= endCol; x++) {
    if (!grid[x]) continue;
    for (let y = 0; y < grid[x].length; y++) {
      let t = grid[x][y];
      if (!t) continue;

      if (t === 'GROUND' || t === 'DIRT') {
        fill(80, 140, 60);
        rect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      } else if (t === 'CRATE') {
        fill(200, 120, 40);
        rect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      } else if (t === 'LAVA') {
        fill(240, 60, 20);
        rect(x * TILE_SIZE, y * TILE_SIZE + 4, TILE_SIZE, TILE_SIZE - 4);
      }
    }
  }

  // Draw Enemies
  fill(220, 20, 80);
  for (let e of enemies) {
    rect(e.x, e.y, e.w, e.h);
  }

  // Draw Coin (Goal)
  if (coin) {
    fill(255, 220, 0);
    rect(coin.x, coin.y, coin.w, coin.h);
  }

  // Draw Player
  fill(40, 160, 255);
  rect(player.x, player.y, player.w, player.h);

  pop();

  // Draw Lives HUD
  fill(220, 20, 80);
  for (let i = 0; i < lives; i++) {
    rect(10 + i * 15, 10, 10, 10);
  }
}

function updateGame() {
  // Player Input
  player.vx = 0;
  if (keyIsDown(37)) player.vx = -SPEED;
  if (keyIsDown(39)) player.vx = SPEED;

  if ((keyIsDown(38) || keyIsDown(32)) && player.grounded) {
    player.vy = JUMP_FORCE;
    player.grounded = false;
  }

  player.vy += GRAVITY;
  if (player.vy > MAX_FALL_SPEED) player.vy = MAX_FALL_SPEED;

  moveAndCollide(player);

  if (player.y > height + TILE_SIZE) {
    die();
  }

  // Score progression
  let currentTileX = Math.floor(player.x / TILE_SIZE);
  if (currentTileX > max_tile_x) {
    score += (currentTileX - max_tile_x);
    max_tile_x = currentTileX;
  }

  // Update Enemies
  for (let e of enemies) {
    e.vy += GRAVITY;
    if (e.vy > MAX_FALL_SPEED) e.vy = MAX_FALL_SPEED;

    // Turn around at cliffs
    let checkX = e.vx > 0 ? e.x + e.w + 1 : e.x - 1;
    let floorTileX = Math.floor(checkX / TILE_SIZE);
    let floorTileY = Math.floor((e.y + e.h + 2) / TILE_SIZE);
    if (!isSolid(floorTileX, floorTileY) && !isLava(floorTileX, floorTileY)) {
      e.vx *= -1;
    }

    moveAndCollide(e);

    if (intersect(player, e)) {
      die();
    }
  }

  // Win Condition
  if (coin && intersect(player, coin)) {
    score += 100;
    gameState = 'WIN';
  }
}

function moveAndCollide(ent) {
  // X movement
  ent.x += ent.vx;
  let minX = Math.floor(ent.x / TILE_SIZE);
  let maxX = Math.floor((ent.x + ent.w - 0.01) / TILE_SIZE);
  let minY = Math.floor(ent.y / TILE_SIZE);
  let maxY = Math.floor((ent.y + ent.h - 0.01) / TILE_SIZE);

  let hitWall = false;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (isSolid(x, y)) {
        hitWall = true;
        if (ent.vx > 0) {
          ent.x = x * TILE_SIZE - ent.w;
        } else if (ent.vx < 0) {
          ent.x = (x + 1) * TILE_SIZE;
        }
      } else if (isLava(x, y)) {
        if (ent === player) die();
      }
    }
  }

  if (hitWall) {
    if (ent === player) ent.vx = 0;
    else ent.vx *= -1;
  }

  // Y movement
  ent.y += ent.vy;
  ent.grounded = false;
  minX = Math.floor(ent.x / TILE_SIZE);
  maxX = Math.floor((ent.x + ent.w - 0.01) / TILE_SIZE);
  minY = Math.floor(ent.y / TILE_SIZE);
  maxY = Math.floor((ent.y + ent.h - 0.01) / TILE_SIZE);

  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      if (isSolid(x, y)) {
        if (ent.vy > 0) {
          ent.y = y * TILE_SIZE - ent.h;
          ent.vy = 0;
          ent.grounded = true;
        } else if (ent.vy < 0) {
          ent.y = (y + 1) * TILE_SIZE;
          ent.vy = 0;
        }
      } else if (isLava(x, y)) {
        if (ent === player) die();
      }
    }
  }
}

function isSolid(x, y) {
  if (!grid[x]) return false;
  let t = grid[x][y];
  return t === 'GROUND' || t === 'DIRT' || t === 'CRATE';
}

function isLava(x, y) {
  if (!grid[x]) return false;
  return grid[x][y] === 'LAVA';
}

function intersect(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
}

function die() {
  if (gameState !== 'PLAYING') return;
  lives--;
  if (lives <= 0) {
    gameState = 'GAMEOVER';
  } else {
    respawn();
  }
}

// ============================================================
// REQUIRED: RL interface
// ============================================================

function getGameState() {
  return {
    score: score,
    lives: lives,
    gameState: gameState,
  };
}

function resetGame(seed) {
  rng = mulberry32(seed);
  score = 0;
  lives = 3;
  gameState = 'PLAYING';
  max_tile_x = 0;
  cameraX = 0;

  grid = [];
  for (let i = 0; i < 300; i++) {
    grid[i] = [];
  }
  enemies = [];
  coin = null;

  generateLevel();
  respawn();
}

function respawn() {
  player = {
    x: 2 * TILE_SIZE,
    y: 10 * TILE_SIZE,
    vx: 0,
    vy: 0,
    w: 14,
    h: 14,
    grounded: false
  };
}

function generateLevel() {
  let cx = 2;
  let cy = 14;
  let mapWidth = 150;

  // Starting platform
  for (let i = 0; i < cx + 3; i++) {
    grid[i][cy] = 'GROUND';
    for (let j = cy + 1; j <= 19; j++) grid[i][j] = 'DIRT';
  }
  cx += 3;

  while (cx < mapWidth - 10) {
    let dx = Math.floor(rng() * 5) + 3;
    let dy = Math.floor(rng() * 5) - 2;
    cy += dy;
    if (cy < 6) cy = 6;
    if (cy > 15) cy = 15;

    let isPit = rng() < 0.3;

    if (isPit) {
      let pitWidth = Math.floor(rng() * 3) + 2;
      for (let i = 0; i < pitWidth; i++) {
        grid[cx + i][19] = 'LAVA';
        grid[cx + i][18] = 'LAVA';
      }
      cx += pitWidth;
    }

    let hasEnemy = rng() < 0.35 && dx >= 3;
    let hasCrates = !hasEnemy && rng() < 0.3;

    for (let i = 0; i < dx; i++) {
      grid[cx + i][cy] = 'GROUND';
      for (let j = cy + 1; j <= 19; j++) grid[cx + i][j] = 'DIRT';
    }

    if (hasEnemy) {
      let enemyX = cx + 1 + Math.floor(rng() * (dx - 2));
      enemies.push({
        x: enemyX * TILE_SIZE,
        y: cy * TILE_SIZE - 14,
        w: 14,
        h: 14,
        vx: (rng() < 0.5 ? -1 : 1) * 1.5,
        vy: 0
      });
    }

    if (hasCrates) {
      let numCrates = Math.floor(rng() * 2) + 1;
      let crateX = cx + 1 + Math.floor(rng() * (dx - 2));
      for (let k = 0; k < numCrates; k++) {
        grid[crateX][cy - 1 - k] = 'CRATE';
      }
    }

    cx += dx;
  }

  // Goal platform
  for (let i = cx; i < cx + 8; i++) {
    grid[i][cy] = 'GROUND';
    for (let j = cy + 1; j <= 19; j++) grid[i][j] = 'DIRT';
  }

  coin = {
    x: (cx + 4) * TILE_SIZE,
    y: cy * TILE_SIZE - TILE_SIZE,
    w: TILE_SIZE,
    h: TILE_SIZE
  };
}

// ============================================================
// REQUIRED: seeded RNG
// ============================================================

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let n = Math.imul(t ^ (t >>> 15), t | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}