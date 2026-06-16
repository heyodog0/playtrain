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

function randInt(min, max) {
  return Math.floor(rng() * (max - min)) + min;
}

// ============================================================
// GAME GLOBALS
// ============================================================
let score = 0;
let lives = 3;
let gameState = 'PLAYING';

let grid = []; // 20x20 grid, 20px per cell
let items = [];
let enemies = [];
let ladders = [];

let player = {
  x: 25, y: 60,
  w: 12, h: 16,
  vx: 0, vy: 0,
  onGround: false,
  onLadder: false,
  hasKey: false
};

const GRAVITY = 0.5;
const MAX_FALL_SPEED = 8;
const MOVE_SPEED = 3;
const JUMP_FORCE = -8;
const LADDER_SPEED = 3;

// ============================================================
// REQUIRED: p5.js lifecycle
// ============================================================
function setup() {
  createCanvas(400, 400);
}

function draw() {
  background(30);

  if (gameState === 'PLAYING') {
    updateGame();
  }
  
  renderLevel();
}

// ============================================================
// REQUIRED: RL interface
// ============================================================
function getGameState() {
  return { score, lives, gameState };
}

function resetGame(seed) {
  rng = mulberry32(seed);
  score = 0;
  lives = 3;
  gameState = 'PLAYING';
  
  generateLevel();
  resetPlayer();
}

// ============================================================
// GAME LOGIC
// ============================================================
function generateLevel() {
  grid = [];
  items = [];
  enemies = [];
  ladders = [];

  // Initialize empty grid with border walls
  for (let y = 0; y < 20; y++) {
    grid[y] = [];
    for (let x = 0; x < 20; x++) {
      if (x === 0 || x === 19 || y === 0 || y === 19) grid[y][x] = 1; // Wall
      else grid[y][x] = 0; // Empty
    }
  }

  // Generate 4 floors
  for (let f = 0; f < 4; f++) {
    let fy = 4 + f * 4; // y = 4, 8, 12, 16
    let lx = randInt(3, 17);
    ladders.push(lx);

    for (let x = 1; x < 19; x++) {
      if (x === lx) {
        grid[fy][x] = 2; // Ladder top
        // Create shaft to the next floor if not the bottom one
        if (f < 3) {
          grid[fy + 1][x] = 2;
          grid[fy + 2][x] = 2;
          grid[fy + 3][x] = 2;
        }
      } else {
        grid[fy][x] = 1; // Platform
      }
    }
  }

  // Add Fire Hazards
  for (let f = 0; f < 3; f++) {
    let fy = 4 + f * 4;
    let numHazards = randInt(1, 3);
    for (let i = 0; i < numHazards; i++) {
      let hx = randInt(2, 18);
      let safe = true;
      for (let l of ladders) {
        if (Math.abs(hx - l) <= 2) safe = false;
      }
      if (safe) {
        grid[fy][hx] = 3; // Hazard replaces floor
      }
    }
  }

  // Key placement (Floor 0 or 1)
  let keyFloor = randInt(0, 2);
  let kx = randInt(3, 17);
  while (Math.abs(kx - ladders[keyFloor]) <= 1) {
    kx = randInt(3, 17);
  }
  items.push({ type: 'key', x: kx * 20 + 5, y: (keyFloor * 4 + 3) * 20 + 10, w: 10, h: 10, active: true });

  // Door placement (Blocks Ladder 2)
  let doorLx = ladders[2];
  items.push({ type: 'door', x: doorLx * 20, y: 13 * 20, w: 20, h: 60, active: true });

  // Treasure placement (Floor 3)
  let tx = randInt(3, 17);
  while (Math.abs(tx - ladders[3]) <= 2) {
    tx = randInt(3, 17);
  }
  items.push({ type: 'treasure', x: tx * 20, y: 15 * 20, w: 20, h: 20, active: true });

  // Enemies
  for (let f = 0; f < 4; f++) {
    if (rng() > 0.4) {
      let fy = 4 + f * 4;
      let ex = randInt(3, 17);
      if (grid[fy][ex] === 1) {
        enemies.push({
          x: ex * 20, y: (fy - 1) * 20 + 4,
          w: 16, h: 16,
          vx: (rng() > 0.5 ? 1 : -1) * 1.5
        });
      }
    }
  }
}

function resetPlayer() {
  player.x = 25;
  player.y = 60; // Safely above Floor 0, x=1
  player.vx = 0;
  player.vy = 0;
  player.onGround = false;
  player.onLadder = false;
  player.hasKey = false;
}

function checkCollision(nx, ny) {
  let left = Math.floor(nx / 20);
  let right = Math.floor((nx + player.w - 1) / 20);
  let top = Math.floor(ny / 20);
  let bottom = Math.floor((ny + player.h - 1) / 20);

  // Bounds & Grid Walls
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      if (y < 0 || y >= 20 || x < 0 || x >= 20) return true;
      if (grid[y][x] === 1) return true;
    }
  }

  // Active Doors
  for (let item of items) {
    if (item.type === 'door' && item.active) {
      if (nx < item.x + item.w && nx + player.w > item.x &&
          ny < item.y + item.h && ny + player.h > item.y) {
        return true;
      }
    }
  }

  return false;
}

function updateGame() {
  // Input processing
  let K_LEFT = keyIsDown(37);
  let K_RIGHT = keyIsDown(39);
  let K_UP = keyIsDown(38);
  let K_DOWN = keyIsDown(40);
  let K_JUMP = keyIsDown(32);

  // Ladder logic
  let cx = Math.floor((player.x + player.w / 2) / 20);
  let cy = Math.floor((player.y + player.h / 2) / 20);
  let cyDown = Math.floor((player.y + player.h) / 20);

  let onLadderBlock = false;
  if (cy >= 0 && cy < 20 && cx >= 0 && cx < 20 && grid[cy][cx] === 2) onLadderBlock = true;
  if (cyDown >= 0 && cyDown < 20 && cx >= 0 && cx < 20 && grid[cyDown][cx] === 2) onLadderBlock = true;

  if (onLadderBlock) {
    if (K_UP) {
      player.vy = -LADDER_SPEED;
      player.onLadder = true;
    } else if (K_DOWN) {
      player.vy = LADDER_SPEED;
      player.onLadder = true;
    } else if (player.onLadder) {
      player.vy = 0; // Hang on ladder
    } else {
      player.vy += GRAVITY; // Falling past a ladder without grabbing
    }
  } else {
    player.onLadder = false;
    player.vy += GRAVITY;
  }

  if (player.vy > MAX_FALL_SPEED) player.vy = MAX_FALL_SPEED;

  // Jump logic
  if (K_JUMP && player.onGround && !player.onLadder) {
    player.vy = JUMP_FORCE;
    player.onGround = false;
  }

  // Horizontal movement
  if (K_LEFT) player.vx = -MOVE_SPEED;
  else if (K_RIGHT) player.vx = MOVE_SPEED;
  else player.vx = 0;

  // X Collision
  let nextX = player.x + player.vx;
  if (!checkCollision(nextX, player.y)) {
    player.x = nextX;
  } else {
    let step = Math.sign(player.vx);
    while (step !== 0 && !checkCollision(player.x + step, player.y)) {
      player.x += step;
    }
    player.vx = 0;
  }

  // Y Collision
  player.onGround = false;
  let nextY = player.y + player.vy;
  if (!checkCollision(player.x, nextY)) {
    player.y = nextY;
  } else {
    let step = Math.sign(player.vy);
    while (step !== 0 && !checkCollision(player.x, player.y + step)) {
      player.y += step;
    }
    if (step > 0) player.onGround = true;
    player.vy = 0;
  }

  // Unlock Doors with Key
  if (player.hasKey) {
    let pad = 2; // slightly expanded check for adjacent touching
    for (let item of items) {
      if (item.type === 'door' && item.active) {
        if (player.x - pad < item.x + item.w && player.x + player.w + pad > item.x &&
            player.y - pad < item.y + item.h && player.y + player.h + pad > item.y) {
          item.active = false;
          player.hasKey = false;
          score += 50;
        }
      }
    }
  }

  // Collect Items
  for (let item of items) {
    if (!item.active || item.type === 'door') continue;
    if (player.x < item.x + item.w && player.x + player.w > item.x &&
        player.y < item.y + item.h && player.y + player.h > item.y) {
      if (item.type === 'key') {
        item.active = false;
        player.hasKey = true;
        score += 20;
      } else if (item.type === 'treasure') {
        item.active = false;
        score += 100;
        gameState = 'WIN';
      }
    }
  }

  // Enemy Update & AI
  for (let e of enemies) {
    let enX = e.x + e.vx;
    let hit = false;
    let checkX = e.vx > 0 ? enX + e.w : enX;
    let gx = Math.floor(checkX / 20);
    let gy = Math.floor((e.y + e.h / 2) / 20);

    if (gx < 0 || gx > 19) hit = true;
    else if (grid[gy][gx] === 1 || grid[gy][gx] === 4) hit = true;
    else {
      let gyDown = Math.floor((e.y + e.h + 2) / 20);
      if (gyDown > 19) hit = true;
      else if (grid[gyDown][gx] !== 1) hit = true; // Avoid gaps, ladders, hazards
    }

    if (hit) {
      e.vx *= -1;
    } else {
      e.x = enX;
    }
  }

  // Death Checks (Hazards & Enemies)
  let isDead = false;
  let px = player.x + 2; // Reduced hitbox
  let py = player.y + 2;
  let pw = player.w - 4;
  let ph = player.h - 4;

  let left = Math.floor(px / 20);
  let right = Math.floor((px + pw) / 20);
  let top = Math.floor(py / 20);
  let bottom = Math.floor((py + ph) / 20);

  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      if (y >= 0 && y < 20 && x >= 0 && x < 20 && grid[y][x] === 3) isDead = true;
    }
  }

  for (let e of enemies) {
    if (px < e.x + e.w && px + pw > e.x &&
        py < e.y + e.h && py + ph > e.y) {
      isDead = true;
    }
  }

  if (isDead) {
    lives--;
    score -= 10;
    if (lives <= 0) {
      gameState = 'GAMEOVER';
    } else {
      resetPlayer();
    }
  }
}

function renderLevel() {
  noStroke();

  // Draw Grid
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 20; x++) {
      let tile = grid[y][x];
      if (tile === 1) {
        fill(139, 69, 19); // Wall
        rect(x * 20, y * 20, 20, 20);
      } else if (tile === 2) {
        fill(0, 150, 150); // Ladder Shaft
        rect(x * 20 + 5, y * 20, 10, 20);
        fill(0, 255, 255); // Ladder Rungs
        rect(x * 20 + 5, y * 20 + 4, 10, 2);
        rect(x * 20 + 5, y * 20 + 12, 10, 2);
      } else if (tile === 3) {
        fill(255, 69, 0); // Fire pit base
        rect(x * 20, y * 20 + 10, 20, 10);
        fill(255, 0, 0); // Fire core
        rect(x * 20 + 5, y * 20 + 12, 10, 8);
      }
    }
  }

  // Draw Items
  for (let item of items) {
    if (!item.active) continue;
    if (item.type === 'key') {
      fill(255, 255, 0);
      rect(item.x, item.y, item.w, item.h);
    } else if (item.type === 'door') {
      fill(255, 0, 255);
      rect(item.x, item.y, item.w, item.h);
    } else if (item.type === 'treasure') {
      fill(255, 215, 0);
      ellipse(item.x + item.w / 2, item.y + item.h / 2, item.w, item.h);
    }
  }

  // Draw Enemies
  fill(255, 0, 0);
  for (let e of enemies) {
    ellipse(e.x + e.w / 2, e.y + e.h / 2, e.w, e.h);
  }

  // Draw Player
  if (gameState !== 'GAMEOVER' || lives > 0) {
    fill(0, 100, 255);
    rect(player.x, player.y, player.w, player.h);
    if (player.hasKey) {
      fill(255, 255, 0);
      rect(player.x + 4, player.y + 4, 4, 4);
    }
  }

  // Draw HUD (Simple Blocks)
  fill(0, 100, 255);
  for (let i = 0; i < lives; i++) {
    rect(380 - i * 15, 5, 10, 10);
  }
  fill(255, 255, 0);
  rect(5, 5, Math.max(0, Math.min(score, 170)), 5);
}