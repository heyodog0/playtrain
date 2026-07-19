// ============================================================
// REQUIRED: p5.js lifecycle
// ============================================================

let score;
let lives;
let gameState;

let player;
let enemies;
let divers;
let pBullets;
let eBullets;

let enemyTimer;
let diverTimer;

const LANES = [100, 140, 180, 220, 260, 300, 340, 370];

function setup() {
  createCanvas(400, 400);
}

function draw() {
  if (gameState !== 'PLAYING') {
    renderGame();
    return;
  }

  updatePlayer();
  updateEntities();
  checkCollisions();
  spawnEntities();

  renderGame();
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
  
  resetLevel();
}

function resetLevel() {
  player = {
    x: 200,
    y: 200,
    w: 24,
    h: 14,
    speed: 4,
    facing: 1, 
    oxygen: 100,
    diverCount: 0,
    cooldown: 0
  };
  
  enemies = [];
  divers = [];
  pBullets = [];
  eBullets = [];
  
  enemyTimer = 20;
  diverTimer = 50;
}

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
// GAME LOGIC
// ============================================================

function updatePlayer() {
  // Movement
  if (keyIsDown(37)) { // LEFT
    player.x -= player.speed;
    player.facing = -1;
  }
  if (keyIsDown(39)) { // RIGHT
    player.x += player.speed;
    player.facing = 1;
  }
  if (keyIsDown(38)) { // UP
    player.y -= player.speed;
  }
  if (keyIsDown(40)) { // DOWN
    player.y += player.speed;
  }

  // Constrain to screen boundaries
  player.x = Math.max(12, Math.min(width - 12, player.x));
  player.y = Math.max(30, Math.min(height - 15, player.y));

  // Shooting
  if (player.cooldown > 0) {
    player.cooldown--;
  }
  if (keyIsDown(32) && player.cooldown === 0) {
    pBullets.push({
      x: player.x + (player.facing * 14),
      y: player.y,
      w: 8,
      h: 4,
      vx: player.facing * 6
    });
    player.cooldown = 15;
  }

  // Oxygen & Surfacing Logic
  if (player.y < 70) {
    // Surface zone
    if (player.diverCount > 0) {
      score += player.diverCount * 50;
      player.diverCount = 0;
    }
    player.oxygen = Math.min(100, player.oxygen + 2.0);
  } else {
    // Underwater
    player.oxygen -= 0.1;
    if (player.oxygen <= 0) {
      loseLife();
    }
  }
}

function updateEntities() {
  // Player Bullets
  for (let i = pBullets.length - 1; i >= 0; i--) {
    let b = pBullets[i];
    b.x += b.vx;
    if (b.x < 0 || b.x > width) {
      pBullets.splice(i, 1);
    }
  }

  // Enemy Bullets
  for (let i = eBullets.length - 1; i >= 0; i--) {
    let b = eBullets[i];
    b.x += b.vx;
    if (b.x < 0 || b.x > width) {
      eBullets.splice(i, 1);
    }
  }

  // Enemies
  for (let i = enemies.length - 1; i >= 0; i--) {
    let e = enemies[i];
    e.x += e.vx;
    
    // Submarines have a chance to shoot
    if (e.type === 'sub' && rng() < 0.005) {
      let facing = e.vx > 0 ? 1 : -1;
      eBullets.push({
        x: e.x + (facing * 12),
        y: e.y,
        w: 8,
        h: 4,
        vx: facing * 4
      });
    }

    if ((e.vx > 0 && e.x > width + 20) || (e.vx < 0 && e.x < -20)) {
      enemies.splice(i, 1);
    }
  }

  // Divers
  for (let i = divers.length - 1; i >= 0; i--) {
    let d = divers[i];
    d.x += d.vx;
    if ((d.vx > 0 && d.x > width + 20) || (d.vx < 0 && d.x < -20)) {
      divers.splice(i, 1);
    }
  }
}

function checkCollisions() {
  // PBullets hit Enemies
  for (let i = pBullets.length - 1; i >= 0; i--) {
    let b = pBullets[i];
    let hit = false;
    for (let j = enemies.length - 1; j >= 0; j--) {
      let e = enemies[j];
      if (intersect(b.x, b.y, b.w, b.h, e.x, e.y, e.w, e.h)) {
        enemies.splice(j, 1);
        score += 20;
        hit = true;
        break;
      }
    }
    if (hit) {
      pBullets.splice(i, 1);
    }
  }

  // Player hits Diver
  for (let i = divers.length - 1; i >= 0; i--) {
    let d = divers[i];
    if (intersect(player.x, player.y, player.w, player.h, d.x, d.y, d.w, d.h)) {
      score += 10;
      if (player.diverCount < 6) {
        player.diverCount++;
      }
      divers.splice(i, 1);
    }
  }

  // Player hits Enemy or EBullet
  let playerHit = false;
  for (let i = 0; i < enemies.length; i++) {
    let e = enemies[i];
    if (intersect(player.x, player.y, player.w, player.h, e.x, e.y, e.w, e.h)) {
      playerHit = true;
      break;
    }
  }
  for (let i = 0; i < eBullets.length; i++) {
    let b = eBullets[i];
    if (intersect(player.x, player.y, player.w, player.h, b.x, b.y, b.w, b.h)) {
      playerHit = true;
      break;
    }
  }

  if (playerHit) {
    loseLife();
  }
}

function spawnEntities() {
  enemyTimer--;
  if (enemyTimer <= 0) {
    let lane = LANES[Math.floor(rng() * LANES.length)];
    let side = rng() < 0.5 ? -1 : 1;
    let type = rng() < 0.6 ? 'sub' : 'shark';
    
    enemies.push({
      x: side === -1 ? -20 : width + 20,
      y: lane,
      w: type === 'sub' ? 20 : 24,
      h: type === 'sub' ? 14 : 10,
      vx: side === -1 ? (1.5 + rng() * 1.5) : -(1.5 + rng() * 1.5),
      type: type
    });
    
    enemyTimer = 30 + Math.floor(rng() * 40);
  }

  diverTimer--;
  if (diverTimer <= 0) {
    // Divers spawn in lower lanes
    let laneIdx = 2 + Math.floor(rng() * (LANES.length - 2));
    let lane = LANES[laneIdx];
    let side = rng() < 0.5 ? -1 : 1;
    
    divers.push({
      x: side === -1 ? -20 : width + 20,
      y: lane,
      w: 10,
      h: 10,
      vx: side === -1 ? 0.6 : -0.6
    });
    
    diverTimer = 80 + Math.floor(rng() * 80);
  }
}

function loseLife() {
  // ALE-aligned: no death penalty. Reward fires only on positive scoring events
  // (kills, diver pickups, surfacing). Death just consumes a life.
  lives--;
  if (lives <= 0) {
    gameState = 'GAMEOVER';
  } else {
    resetLevel();
  }
}

// AABB Collision (using center coordinates)
function intersect(x1, y1, w1, h1, x2, y2, w2, h2) {
  return Math.abs(x1 - x2) < (w1 + w2) / 2 &&
         Math.abs(y1 - y2) < (h1 + h2) / 2;
}

function renderGame() {
  // Water Background
  background(10, 20, 60);

  rectMode(CORNER);
  // Surface Layer
  fill(30, 80, 120);
  rect(0, 0, width, 70);

  // Oxygen Bar Background
  fill(0);
  rect(0, height - 10, width, 10);
  // Oxygen Bar Fill
  fill(0, 255, 255);
  rect(0, height - 10, (player.oxygen / 100) * width, 10);

  // Collected Divers Indicators (top left)
  fill(0, 255, 0);
  for (let i = 0; i < player.diverCount; i++) {
    rect(10 + i * 14, 10, 10, 10);
  }

  rectMode(CENTER);
  noStroke();

  // Draw Divers
  fill(0, 255, 0);
  for (let d of divers) {
    rect(d.x, d.y, d.w, d.h);
  }

  // Draw Enemies
  for (let e of enemies) {
    if (e.type === 'sub') {
      fill(220, 20, 60); // Red for sub
    } else {
      fill(120, 0, 120); // Purple for shark
    }
    rect(e.x, e.y, e.w, e.h);
    // Draw snout/tail to indicate direction
    let dir = e.vx > 0 ? 1 : -1;
    rect(e.x + (dir * e.w * 0.4), e.y - 2, e.w * 0.4, e.h * 0.4);
  }

  // Draw Player Bullets
  fill(255, 255, 0);
  for (let b of pBullets) {
    rect(b.x, b.y, b.w, b.h);
  }

  // Draw Enemy Bullets
  fill(255, 100, 0);
  for (let b of eBullets) {
    rect(b.x, b.y, b.w, b.h);
  }

  // Draw Player
  if (gameState === 'PLAYING') {
    fill(0, 150, 255);
    rect(player.x, player.y, player.w, player.h);
    // Player gun barrel
    rect(player.x + (player.facing * 12), player.y, 8, 4);
  }
}