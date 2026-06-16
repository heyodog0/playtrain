// ============================================================
// REQUIRED: seeded RNG (copy this verbatim)
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
let score = 0;
let lives = 3;
let gameState = 'PLAYING';

let platforms = [];
let ladders = [];
let enemies = [];
let items = [];
let traps = [];

let door = { x: 0, y: 0, w: 0, h: 0, active: false };
let totalKeys = 2;
let keysCollected = 0;

let px, py, vx, vy, pw, ph;
let isGrounded = false;
let isClimbing = false;
let prevSpace = false;

// ============================================================
// REQUIRED: p5.js lifecycle
// ============================================================
function setup() {
  createCanvas(256, 256);
}

function resetGame(seed) {
  rng = mulberry32(seed);
  score = 0;
  lives = 3;
  gameState = 'PLAYING';
  
  prevSpace = false;
  initLevel();
}

function getGameState() {
  return {
    score: score,
    lives: Math.max(0, lives),
    gameState: gameState,
  };
}

// ============================================================
// LEVEL GENERATION
// ============================================================
function initLevel() {
  platforms = [];
  ladders = [];
  enemies = [];
  items = [];
  traps = [];
  keysCollected = 0;

  // Floor 1 (Bottom)
  platforms.push({ x: 0, y: 220, w: 256, h: 16 });
  
  // Trap (Lava below bottom floor)
  traps.push({ x: 0, y: 246, w: 256, h: 10 });

  // Floor 2 (Middle)
  let gapX1 = 40 + Math.floor(rng() * 4) * 32; // 40, 72, 104, 136
  platforms.push({ x: 0, y: 140, w: gapX1, h: 16 });
  platforms.push({ x: gapX1 + 40, y: 140, w: 256 - (gapX1 + 40), h: 16 });
  ladders.push({ x: gapX1 + 12, y: 120, w: 16, h: 100 }); // through floor 2 down to floor 1

  // Floor 3 (Top)
  let gapX2 = 80 + Math.floor(rng() * 3) * 32; // 80, 112, 144
  platforms.push({ x: 0, y: 60, w: gapX2, h: 16 });
  platforms.push({ x: gapX2 + 40, y: 60, w: 256 - (gapX2 + 40), h: 16 });
  ladders.push({ x: gapX2 + 12, y: 40, w: 16, h: 100 }); // through floor 3 down to floor 2

  // Door & Treasure
  door = { x: 32, y: 28, w: 8, h: 32, active: true };
  items.push({ type: 'TREASURE', x: 10, y: 44, w: 16, h: 16, active: true });

  // Keys
  items.push({ type: 'KEY', x: 200, y: 208, w: 10, h: 10, active: true }); // Bottom floor right
  
  let pMid = platforms[rng() > 0.5 ? 1 : 2]; // Left or right platform of middle floor
  let keyX = pMid.x + pMid.w / 2 - 5;
  items.push({ type: 'KEY', x: keyX, y: 128, w: 10, h: 10, active: true });

  // Enemies
  // Middle floor
  for (let i = 1; i <= 2; i++) {
    let p = platforms[i];
    if (p.w > 40 && rng() > 0.3) {
      enemies.push({ x: p.x + p.w / 2, y: 128, w: 12, h: 12, vx: (rng() > 0.5 ? 1.5 : -1.5), minX: p.x, maxX: p.x + p.w });
    }
  }
  // Top floor
  for (let i = 3; i <= 4; i++) {
    let p = platforms[i];
    if (p.w > 40 && rng() > 0.3) {
      let minX = p.x;
      if (p.x === 0) minX = door.x + door.w + 4; // Right of the door
      if (minX + 12 < p.x + p.w) {
        enemies.push({ x: minX + 10, y: 48, w: 12, h: 12, vx: 1.5, minX: minX, maxX: p.x + p.w });
      }
    }
  }

  resetPlayer();
}

function resetPlayer() {
  pw = 12;
  ph = 12;
  px = 10;
  py = 208;
  vx = 0;
  vy = 0;
  isGrounded = false;
  isClimbing = false;
}

function playerDie() {
  lives--;
  score = Math.max(0, score - 5);
  if (lives <= 0) {
    gameState = 'GAMEOVER';
  } else {
    resetPlayer();
  }
}

// ============================================================
// MAIN GAME LOOP
// ============================================================
function draw() {
  if (gameState !== 'PLAYING') {
    render();
    return;
  }

  updatePhysics();
  updateEntities();
  checkCollisions();
  render();
}

function updatePhysics() {
  let spaceDown = keyIsDown(32);
  let jumpPressed = spaceDown && !prevSpace;
  prevSpace = spaceDown;

  // 1. Ladder and Climbing Check
  let onLadder = false;
  let activeLadder = null;
  for (let l of ladders) {
    if (rectIntersect(px, py, pw, ph, l.x, l.y, l.w, l.h)) {
      onLadder = true;
      activeLadder = l;
      break;
    }
  }

  if (!onLadder) {
    isClimbing = false;
  } else {
    if (keyIsDown(38)) { // UP
      isClimbing = true;
      vy = -2;
      vx = 0;
    } else if (keyIsDown(40)) { // DOWN
      isClimbing = true;
      vy = 2;
      vx = 0;
    } else if (isClimbing) {
      vy = 0;
    }
  }

  // 2. Horizontal Input
  if (!isClimbing || keyIsDown(37) || keyIsDown(39)) {
    if (keyIsDown(37)) {
      vx = -2.5;
      isClimbing = false;
    } else if (keyIsDown(39)) {
      vx = 2.5;
      isClimbing = false;
    } else {
      vx = 0;
    }
  }

  // 3. Jump Input
  if (jumpPressed && isGrounded && !isClimbing) {
    vy = -6.5;
    isGrounded = false;
  }

  // 4. Gravity & Snapping
  if (!isClimbing) {
    vy += 0.35; // Gravity
    if (vy > 6) vy = 6;
  } else {
    // Snap gently to ladder center horizontally
    let lCenter = activeLadder.x + activeLadder.w / 2;
    let pCenter = px + pw / 2;
    px += (lCenter - pCenter) * 0.2;
  }

  // 5. Apply Horizontal Velocity
  px += vx;
  
  // Screen bounds
  if (px < 0) px = 0;
  if (px + pw > width) px = width - pw;

  // Door horizontal collision
  if (door.active && rectIntersect(px, py, pw, ph, door.x, door.y, door.w, door.h)) {
    if (vx > 0) px = door.x - pw;
    else if (vx < 0) px = door.x + door.w;
  }

  // 6. Apply Vertical Velocity
  py += vy;
  isGrounded = false;

  // Door vertical collision
  if (door.active && rectIntersect(px, py, pw, ph, door.x, door.y, door.w, door.h)) {
    if (vy > 0) {
      py = door.y - ph;
      isGrounded = true;
      vy = 0;
    } else if (vy < 0) {
      py = door.y + door.h;
      vy = 0;
    }
  }

  // 7. Platform Collisions
  if (!isClimbing) {
    for (let p of platforms) {
      if (rectIntersect(px, py, pw, ph, p.x, p.y, p.w, p.h)) {
        if (vy > 0 && (py - vy + ph) <= p.y + 4) { // Landing
          py = p.y - ph;
          isGrounded = true;
          vy = 0;
        } else if (vy < 0 && (py - vy) >= p.y + p.h - 4) { // Hit ceiling
          py = p.y + p.h;
          vy = 0;
        }
      }
    }
  }
}

function updateEntities() {
  // Update Enemies
  for (let e of enemies) {
    e.x += e.vx;
    if (e.x < e.minX || e.x + e.w > e.maxX) {
      e.vx *= -1;
      e.x = Math.max(e.minX, Math.min(e.x, e.maxX - e.w));
    }
  }

  // Open Door if all keys collected
  if (door.active && keysCollected >= totalKeys) {
    door.active = false;
    score += 20;
  }
}

function checkCollisions() {
  // Enemy Collisions
  for (let e of enemies) {
    if (rectIntersect(px, py, pw, ph, e.x, e.y, e.w, e.h)) {
      playerDie();
      return;
    }
  }

  // Trap Collisions (Lava, bottom pit)
  for (let t of traps) {
    if (rectIntersect(px, py, pw, ph, t.x, t.y, t.w, t.h)) {
      playerDie();
      return;
    }
  }
  if (py > height) {
    playerDie();
    return;
  }

  // Item Collisions
  for (let i of items) {
    if (i.active && rectIntersect(px, py, pw, ph, i.x, i.y, i.w, i.h)) {
      if (i.type === 'KEY') {
        i.active = false;
        keysCollected++;
        score += 10;
      } else if (i.type === 'TREASURE') {
        i.active = false;
        score += 100;
        gameState = 'WIN';
      }
    }
  }
}

function render() {
  background(20); // Dark background

  // Draw Platforms
  fill(160, 160, 160);
  noStroke();
  for (let p of platforms) {
    rect(p.x, p.y, p.w, p.h);
  }

  // Draw Ladders
  fill(255, 140, 0);
  for (let l of ladders) {
    rect(l.x, l.y, l.w, l.h);
  }

  // Draw Traps
  fill(255, 0, 255);
  for (let t of traps) {
    rect(t.x, t.y, t.w, t.h);
  }

  // Draw Door
  if (door.active) {
    fill(139, 69, 19);
    rect(door.x, door.y, door.w, door.h);
  }

  // Draw Items
  for (let i of items) {
    if (i.active) {
      if (i.type === 'KEY') fill(255, 255, 0);
      else if (i.type === 'TREASURE') fill(0, 255, 255);
      rect(i.x, i.y, i.w, i.h);
    }
  }

  // Draw Enemies
  fill(255, 0, 0);
  for (let e of enemies) {
    rect(e.x, e.y, e.w, e.h);
  }

  // Draw Player
  if (gameState !== 'GAMEOVER') {
    fill(0, 100, 255);
    rect(px, py, pw, ph);
  }

  // Draw Simple Indicators (Lives and Keys)
  for (let i = 0; i < lives; i++) {
    fill(0, 255, 0);
    rect(width - 15 - i * 12, 5, 8, 8);
  }
  for (let i = 0; i < keysCollected; i++) {
    fill(255, 255, 0);
    rect(5 + i * 12, 5, 8, 8);
  }
}

// Utility: AABB Collision
function rectIntersect(x1, y1, w1, h1, x2, y2, w2, h2) {
  return x1 < x2 + w2 && x1 + w1 > x2 && y1 < y2 + h2 && y1 + h1 > y2;
}