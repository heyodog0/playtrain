// ============================================================
// REQUIRED: p5.js lifecycle
// ============================================================

let score = 0;
let lives = 1;
let gameState = 'PLAYING';
let rng = null;

// Game constants
const TILE_SIZE = 20;
const GRAVITY = 0.4;
const JUMP_V = -7.5;
const MAX_SPEED = 4;
const ACCEL = 1.0;
const FRICTION = 0.7;

// Entities
let player;
let goal;
let solidBlocks = [];
let spikes = [];
let coins = [];
let prevJumpPressed = false;

function setup() {
  createCanvas(400, 400);
  noStroke();
}

function draw() {
  background(30, 30, 36);

  if (gameState === 'PLAYING') {
    updatePhysics();
    checkCollisions();
  }

  renderEnvironment();
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
  lives = 1;
  gameState = 'PLAYING';

  solidBlocks = [];
  spikes = [];
  coins = [];
  prevJumpPressed = false;

  let grid = Array(20).fill().map(() => Array(20).fill(false));

  // Build borders
  for (let i = 0; i < 20; i++) {
    addBlock(i * TILE_SIZE, 0, grid, i, 0);                    // Top
    addBlock(i * TILE_SIZE, 19 * TILE_SIZE, grid, i, 19);      // Bottom
    addBlock(0, i * TILE_SIZE, grid, 0, i);                    // Left
    addBlock(19 * TILE_SIZE, i * TILE_SIZE, grid, 19, i);      // Right
  }

  // Pre-calculate gap positions for each floor to prevent blocking paths
  let floorGaps = {};
  let lastGapX = -1;
  for (let y = 16; y >= 4; y -= 3) {
    let gapWidth = Math.floor(rng() * 2) + 3; // 3 or 4 tiles gap
    let gapX;
    do {
      gapX = Math.floor(rng() * (18 - gapWidth)) + 1;
    } while (lastGapX !== -1 && Math.abs(gapX - lastGapX) < 2);
    lastGapX = gapX;
    floorGaps[y] = { gapX, gapWidth };
  }

  // Generate cavern platforms with gaps
  for (let y = 16; y >= 4; y -= 3) {
    let { gapX, gapWidth } = floorGaps[y];

    for (let x = 1; x < 19; x++) {
      if (x < gapX || x >= gapX + gapWidth) {
        addBlock(x * TILE_SIZE, y * TILE_SIZE, grid, x, y);
      }
    }

    // Breadcrumb coins above the gaps
    coins.push({ x: gapX * TILE_SIZE + 6, y: (y - 1) * TILE_SIZE + 6, w: 8, h: 8 });
    if (gapWidth >= 4) {
      coins.push({ x: (gapX + 1) * TILE_SIZE + 6, y: (y - 1) * TILE_SIZE + 6, w: 8, h: 8 });
    }

    // Occasional spikes on the edges of gaps
    let spikeCount = 0;
    for (let x = 1; x < 19; x++) {
      if (grid[y][x] && !grid[y - 1][x]) {
        if (x === gapX - 1 || x === gapX + gapWidth) {
          if (rng() < 0.25 && spikeCount < 1) {
            spikes.push({ x: x * TILE_SIZE + 2, y: y * TILE_SIZE - 8, w: 16, h: 8 });
            spikeCount++;
          }
        }
      }
    }

    // Vertical dividers to create a maze-like structure
    if (y > 4) {
      let nextGap = floorGaps[y - 3];
      if (rng() < 0.5) {
        // Divider on the right side of the gap
        let minX = gapX + gapWidth + 1;
        // Ensure the divider doesn't block the path to the next gap
        minX = Math.max(minX, nextGap.gapX + nextGap.gapWidth);
        let maxX = 18;
        if (maxX > minX) {
          let divX = minX + Math.floor(rng() * (maxX - minX));
          addBlock(divX * TILE_SIZE, (y - 1) * TILE_SIZE, grid, divX, y - 1);
          addBlock(divX * TILE_SIZE, (y - 2) * TILE_SIZE, grid, divX, y - 2);
        }
      } else {
        // Divider on the left side of the gap
        let minX = 1;
        let maxX = gapX - 1;
        // Ensure the divider doesn't block the path to the next gap
        maxX = Math.min(maxX, nextGap.gapX - 1);
        if (maxX > minX) {
          let divX = minX + Math.floor(rng() * (maxX - minX));
          addBlock(divX * TILE_SIZE, (y - 1) * TILE_SIZE, grid, divX, y - 1);
          addBlock(divX * TILE_SIZE, (y - 2) * TILE_SIZE, grid, divX, y - 2);
        }
      }
    }
  }

  // Player starts at bottom
  player = {
    x: 40,
    y: 19 * TILE_SIZE - 16, // rests exactly on bottom floor (y=19)
    w: 12,
    h: 16,
    vx: 0,
    vy: 0,
    jumpCount: 0
  };

  // Goal at the top platform (y=4)
  let topGapX = floorGaps[4].gapX;
  let goalX = (topGapX < 10) ? 17 * TILE_SIZE + 4 : 2 * TILE_SIZE + 4;
  goal = { x: goalX, y: 3 * TILE_SIZE + 8, w: 12, h: 12 };
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

// ============================================================
// GAME LOGIC & RENDERING
// ============================================================

function addBlock(x, y, grid, gx, gy) {
  solidBlocks.push({ x, y, w: TILE_SIZE, h: TILE_SIZE });
  grid[gy][gx] = true;
}

function rectOverlap(r1, r2) {
  return r1.x < r2.x + r2.w &&
         r1.x + r1.w > r2.x &&
         r1.y < r2.y + r2.h &&
         r1.y + r1.h > r2.y;
}

function updatePhysics() {
  // Horizontal movement
  if (keyIsDown(37)) player.vx -= ACCEL; // LEFT
  if (keyIsDown(39)) player.vx += ACCEL; // RIGHT
  
  player.vx *= FRICTION;
  if (Math.abs(player.vx) < 0.1) player.vx = 0;
  if (player.vx > MAX_SPEED) player.vx = MAX_SPEED;
  if (player.vx < -MAX_SPEED) player.vx = -MAX_SPEED;

  player.x += player.vx;
  for (let b of solidBlocks) {
    if (rectOverlap(player, b)) {
      if (player.vx > 0) { player.x = b.x - player.w; player.vx = 0; }
      else if (player.vx < 0) { player.x = b.x + b.w; player.vx = 0; }
    }
  }

  // Vertical movement & jumping
  player.vy += GRAVITY;
  if (player.vy > 8) player.vy = 8;

  let jumpPressed = keyIsDown(38) || keyIsDown(32); // UP or SPACE
  if (jumpPressed && !prevJumpPressed && player.jumpCount > 0) {
    player.vy = JUMP_V;
    player.jumpCount--;
  }
  prevJumpPressed = jumpPressed;

  player.y += player.vy;
  let onGround = false;
  
  for (let b of solidBlocks) {
    if (rectOverlap(player, b)) {
      if (player.vy > 0) {
        player.y = b.y - player.h;
        player.vy = 0;
        onGround = true;
      } else if (player.vy < 0) {
        player.y = b.y + b.h;
        player.vy = 0;
      }
    }
  }

  if (onGround) {
    player.jumpCount = 2; // Supports double jump mechanics
  }
}

function checkCollisions() {
  // Coins
  for (let i = coins.length - 1; i >= 0; i--) {
    if (rectOverlap(player, coins[i])) {
      coins.splice(i, 1);
      score += 1;
    }
  }

  // Spikes
  for (let s of spikes) {
    if (rectOverlap(player, s)) {
      lives = 0;
      gameState = 'GAMEOVER';
      return;
    }
  }

  // Goal
  if (rectOverlap(player, goal)) {
    score += 10;
    gameState = 'WIN';
  }
}

function renderEnvironment() {
  // Draw blocks (walls)
  fill(69, 75, 102);
  for (let b of solidBlocks) {
    rect(b.x, b.y, b.w, b.h);
  }

  // Draw coins
  fill(255, 235, 59);
  for (let c of coins) {
    rect(c.x, c.y, c.w, c.h);
  }

  // Draw goal
  fill(255, 152, 0);
  rect(goal.x, goal.y, goal.w, goal.h);

  // Draw spikes
  fill(244, 67, 54);
  for (let s of spikes) {
    triangle(s.x, s.y + s.h, s.x + s.w / 2, s.y, s.x + s.w, s.y + s.h);
  }

  // Draw player
  fill(76, 175, 80);
  rect(player.x, player.y, player.w, player.h);
}

