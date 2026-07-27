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
// GAME GLOBALS
// ============================================================

let score, lives, gameState;
let player, blocks, hazards, coins, goal;
let maxReachedX, prevSpace, cameraX, levelLength;

// ============================================================
// REQUIRED: p5.js lifecycle
// ============================================================

function setup() {
  createCanvas(400, 400);
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
  levelLength = 3000;
  prevSpace = false;
  maxReachedX = 50;

  player = { 
    x: 50, y: 200, 
    w: 12, h: 12, 
    vx: 0, vy: 0, 
    gravityDir: 1, 
    onGround: false 
  };
  
  blocks = [];
  hazards = [];
  coins = [];

  // Generate static bounds (ceiling, floor, and left wall)
  blocks.push({x: -100, y: 0, w: levelLength + 500, h: 40});
  blocks.push({x: -100, y: 360, w: levelLength + 500, h: 40});
  blocks.push({x: -100, y: 40, w: 100, h: 320});

  // Procedural obstacle generation
  let cursorX = 200;
  while (cursorX < levelLength - 200) {
    let type = Math.floor(rng() * 4);
    let w = 50 + rng() * 50;

    if (type === 0) {
      // Spikes on floor
      hazards.push({x: cursorX, y: 340, w: w, h: 20});
      coins.push({x: cursorX + w/2 - 6, y: 60, w: 12, h: 12, active: true});
    } else if (type === 1) {
      // Spikes on ceiling
      hazards.push({x: cursorX, y: 40, w: w, h: 20});
      coins.push({x: cursorX + w/2 - 6, y: 328, w: 12, h: 12, active: true});
    } else if (type === 2) {
      // Wall resting on floor
      blocks.push({x: cursorX, y: 200, w: w, h: 160});
      coins.push({x: cursorX + w/2 - 6, y: 100, w: 12, h: 12, active: true});
    } else if (type === 3) {
      // Wall attached to ceiling
      blocks.push({x: cursorX, y: 40, w: w, h: 160});
      coins.push({x: cursorX + w/2 - 6, y: 288, w: 12, h: 12, active: true});
    }
    
    // Ensure safe gap between obstacles
    cursorX += w + 120 + rng() * 80;
  }

  goal = {x: levelLength, y: 40, w: 100, h: 320};
  cameraX = 0;
}

// ============================================================
// GAME LOGIC
// ============================================================

function rectIntersect(a, b) {
  return a.x < b.x + b.w && 
         a.x + a.w > b.x && 
         a.y < b.y + b.h && 
         a.y + a.h > b.y;
}

function die() {
  lives--;
  score = Math.max(0, score - 50);
  if (lives <= 0) {
    gameState = 'GAMEOVER';
  } else {
    // Respawn safely at start
    player.x = 50;
    player.y = 200;
    player.vx = 0;
    player.vy = 0;
    player.gravityDir = 1;
  }
}

function updateLogic() {
  // Horizontal movement
  player.vx = 0;
  if (keyIsDown(37)) player.vx = -4; // LEFT
  if (keyIsDown(39)) player.vx = 4;  // RIGHT

  // Gravity flip mechanic
  let currentSpace = keyIsDown(32); // SPACE (D Action)
  if (currentSpace && !prevSpace && player.onGround) {
    player.gravityDir *= -1;
    player.vy = 0;
  }
  prevSpace = currentSpace;

  // Apply gravity
  player.vy += player.gravityDir * 0.6;
  if (player.vy > 8) player.vy = 8;
  if (player.vy < -8) player.vy = -8;

  // X Axis Physics & Collision
  player.x += player.vx;
  for (let b of blocks) {
    if (rectIntersect(player, b)) {
      if (player.vx > 0) player.x = b.x - player.w;
      else if (player.vx < 0) player.x = b.x + b.w;
      player.vx = 0;
    }
  }

  // Prevent moving backward past start bounds
  if (player.x < 0) player.x = 0;

  // Y Axis Physics & Collision
  player.y += player.vy;
  player.onGround = false;
  
  for (let b of blocks) {
    if (rectIntersect(player, b)) {
      if (player.vy > 0) {
        player.y = b.y - player.h;
        if (player.gravityDir === 1) player.onGround = true;
      } else if (player.vy < 0) {
        player.y = b.y + b.h;
        if (player.gravityDir === -1) player.onGround = true;
      }
      player.vy = 0;
    }
  }

  if (player.x > maxReachedX) {
    maxReachedX = player.x;
  }

  // Smooth camera following
  cameraX = player.x - 150;
  if (cameraX < 0) cameraX = 0;
  if (cameraX > levelLength - 400 + 100) cameraX = levelLength - 400 + 100;

  // Check Hazards
  for (let h of hazards) {
    if (rectIntersect(player, h)) {
      die();
      return;
    }
  }

  // Check Collectibles
  for (let c of coins) {
    if (c.active && rectIntersect(player, c)) {
      c.active = false;
      score += 50;
    }
  }

  // Check Win Condition
  if (rectIntersect(player, goal)) {
    gameState = 'WIN';
  }
}

function draw() {
  if (gameState === 'PLAYING') {
    updateLogic();
  }

  // Render Background
  background(10, 15, 30);
  
  push();
  translate(-cameraX, 0);
  noStroke();

  // Render Terrain (Gray)
  fill(120);
  for (let b of blocks) {
    rect(b.x, b.y, b.w, b.h);
  }

  // Render Hazards (Red)
  fill(255, 0, 0);
  for (let h of hazards) {
    rect(h.x, h.y, h.w, h.h);
  }

  // Render Coins (Yellow)
  fill(255, 200, 0);
  for (let c of coins) {
    if (c.active) {
      rect(c.x, c.y, c.w, c.h);
    }
  }

  // Render Goal (Green)
  fill(0, 255, 0);
  rect(goal.x, goal.y, goal.w, goal.h);

  // Render Player (Cyan)
  fill(0, 255, 255);
  rect(player.x, player.y, player.w, player.h);

  pop();

  // HUD: Progress bar at the top edge
  noStroke();
  fill(50);
  rect(0, 0, width, 5);
  fill(0, 255, 0);
  rect(0, 0, (maxReachedX / levelLength) * width, 5);

  // HUD: Lives indicator (Red squares)
  fill(255, 0, 0);
  for (let i = 0; i < lives; i++) {
    rect(5 + i * 15, 10, 10, 10);
  }
}