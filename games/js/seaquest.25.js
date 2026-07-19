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
  lives--;
  score = Math.max(0, score - 50); // Penalty for dying
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
  noStroke();
  // Water Background Gradient
  rectMode(CORNER);
  for (let i = 0; i <= height; i += 20) {
    let inter = i / height;
    fill(30 - inter * 20, 80 - inter * 60, 140 - inter * 80);
    rect(0, i, width, 20);
  }

  // Surface Layer Animated Waves
  fill(20, 100, 160);
  beginShape();
  vertex(0, 0);
  vertex(width, 0);
  vertex(width, 70);
  for (let i = width; i >= 0; i -= 10) {
    vertex(i, 70 + sin((frameCount + i) * 0.05) * 5);
  }
  endShape(CLOSE);

  // Surface Top Layer (gives 2.5D feel to surface)
  fill(40, 120, 180);
  beginShape();
  vertex(0, 0);
  vertex(width, 0);
  vertex(width, 65);
  for (let i = width; i >= 0; i -= 10) {
    vertex(i, 65 + sin((frameCount + i) * 0.05) * 5);
  }
  endShape(CLOSE);

  rectMode(CORNER);
  // Oxygen Bar Background
  fill(0);
  rect(0, height - 10, width, 10);
  // Oxygen Bar Fill
  fill(0, 255, 255);
  rect(0, height - 10, (player.oxygen / 100) * width, 10);

  // Collected Divers Indicators (top left)
  for (let i = 0; i < player.diverCount; i++) {
    fill(0, 200, 0);
    rect(10 + i * 14, 10, 10, 10);
    // Top face
    fill(0, 150, 0);
    quad(10 + i * 14, 10, 10 + i * 14 + 3, 10 - 3, 20 + i * 14 + 3, 10 - 3, 20 + i * 14, 10);
    // Right face
    fill(0, 100, 0);
    quad(20 + i * 14, 10, 20 + i * 14 + 3, 10 - 3, 20 + i * 14 + 3, 20 - 3, 20 + i * 14, 20);
  }

  rectMode(CENTER);

  // Helper for drawing 2.5D boxes
  let drawBox = (x, y, w, h, r, g, b, depth) => {
    // Right side face
    fill(r * 0.6, g * 0.6, b * 0.6);
    quad(
      x + w / 2, y - h / 2,
      x + w / 2 + depth, y - h / 2 - depth,
      x + w / 2 + depth, y + h / 2 - depth,
      x + w / 2, y + h / 2
    );
    // Top face
    fill(r * 0.8, g * 0.8, b * 0.8);
    quad(
      x - w / 2, y - h / 2,
      x - w / 2 + depth, y - h / 2 - depth,
      x + w / 2 + depth, y - h / 2 - depth,
      x + w / 2, y - h / 2
    );
    // Front face
    fill(r, g, b);
    rect(x, y, w, h);
  };

  // Draw Divers
  for (let d of divers) {
    let bob = sin(frameCount * 0.1 + d.x * 0.1) * 3;
    drawBox(d.x, d.y + bob, d.w, d.h, 0, 255, 0, 4);
    // Diver goggles
    fill(255);
    rect(d.x + 2, d.y + bob - 2, 4, 4);
  }

  // Draw Enemies
  for (let e of enemies) {
    let bob = sin(frameCount * 0.1 + e.x * 0.05) * 2;
    if (e.type === 'sub') {
      drawBox(e.x, e.y + bob, e.w, e.h, 220, 20, 60, 6);
    } else {
      drawBox(e.x, e.y + bob, e.w, e.h, 120, 0, 120, 5);
      // shark fin
      fill(80, 0, 80);
      triangle(e.x, e.y + bob - e.h / 2, e.x - 5, e.y + bob - e.h / 2 - 10, e.x + 5, e.y + bob - e.h / 2);
    }
    // Draw snout/tail to indicate direction
    let dir = e.vx > 0 ? 1 : -1;
    let snR = e.type === 'sub' ? 180 : 100;
    let snG = e.type === 'sub' ? 15 : 0;
    let snB = e.type === 'sub' ? 50 : 100;
    drawBox(e.x + (dir * e.w * 0.4), e.y - 2 + bob, e.w * 0.4, e.h * 0.4, snR, snG, snB, 3);
  }

  // Draw Player Bullets
  for (let b of pBullets) {
    drawBox(b.x, b.y, b.w, b.h, 255, 255, 0, 2);
  }

  // Draw Enemy Bullets
  for (let b of eBullets) {
    drawBox(b.x, b.y, b.w, b.h, 255, 100, 0, 2);
  }

  // Draw Player
  if (gameState === 'PLAYING') {
    let bob = sin(frameCount * 0.1) * 2;

    // Exhaust bubble animation
    fill(255, 255, 255, 150);
    let b1 = (frameCount * 1.5) % 30;
    ellipse(player.x - player.facing * (player.w / 2 + 5), player.y + bob - b1 + 10, 4, 4);
    let b2 = (frameCount * 2) % 40;
    ellipse(player.x - player.facing * (player.w / 2 + 10), player.y + bob - b2 + 15, 3, 3);

    drawBox(player.x, player.y + bob, player.w, player.h, 0, 150, 255, 8);
    // Player gun barrel
    drawBox(player.x + (player.facing * 12), player.y + bob, 8, 4, 0, 120, 200, 3);

    // Submarine window
    fill(150, 200, 255);
    ellipse(player.x, player.y + bob, 6, 6);
  }
}