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
let gameTick = 0;

const LANES = [100, 140, 180, 220, 260, 300, 340, 370];

function setup() {
  createCanvas(400, 400);
}

function draw() {
  if (gameState !== 'PLAYING') {
    renderGame();
    return;
  }
  
  gameTick++;

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
  gameTick = 0;
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

  // Sugar Rush (Oxygen) & Cloud Surfacing Logic
  if (player.y < 70) {
    // Cloud zone
    if (player.diverCount > 0) {
      score += player.diverCount * 50;
      player.diverCount = 0;
    }
    player.oxygen = Math.min(100, player.oxygen + 2.0);
  } else {
    // Syrup sea
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
    
    // Jawbreakers (subs) have a chance to shoot
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

  // Jellybeans (Divers)
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

  // Player hits Jellybean
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
    // Jellybeans spawn in lower lanes
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

// ============================================================
// RENDERING
// ============================================================

function renderGame() {
  drawBackground();
  
  rectMode(CENTER);
  noStroke();

  for (let d of divers) {
    drawJellybean(d);
  }

  for (let e of enemies) {
    if (e.type === 'sub') {
      drawJawbreaker(e);
    } else {
      drawLicoriceFish(e);
    }
  }

  for (let b of pBullets) {
    drawStarBullet(b);
  }

  for (let b of eBullets) {
    drawCandyCorn(b);
  }

  if (gameState === 'PLAYING') {
    drawPlayer(player);
  }

  drawUI();
}

function drawBackground() {
  // Syrup Ocean
  background(130, 70, 180);
  
  noStroke();
  // Rising bubbles/sprinkles in syrup
  for(let i = 0; i < 30; i++) {
    let seedVal = (i * 997);
    let startX = (seedVal * 13) % width;
    let speed = 0.5 + ((seedVal % 10) / 10);
    let currentY = height - ((gameTick * speed + (seedVal % height)) % (height - 70));
    
    if (currentY > 70) {
      fill(255, 255, 255, 60);
      ellipse(startX + Math.sin(gameTick * 0.05 + i) * 5, currentY, 4 + (i % 3), 4 + (i % 3));
    }
  }
  
  // Frosting Surface
  fill(255, 140, 180); 
  rectMode(CORNER);
  rect(0, 0, width, 70);
  
  // Frosting drips/clouds at the bottom of the surface
  fill(255, 140, 180);
  for(let i = -20; i <= width + 20; i += 30) {
    let dripY = Math.sin((gameTick * 0.02) + i) * 6;
    ellipse(i + 15, 70 + dripY, 45, 25);
  }
  
  // Sprinkles on the frosting
  for(let i = 0; i < 20; i++) {
    let sx = (i * 41) % width;
    let sy = (i * 23) % 55;
    fill((i % 2 === 0) ? 255 : 100, (i % 3 === 0) ? 255 : 150, (i % 5 === 0) ? 255 : 200);
    push();
    translate(sx, sy);
    rotate((i * 11) % Math.PI);
    rectMode(CENTER);
    rect(0, 0, 6, 2, 2);
    pop();
  }
}

function drawJellybean(d) {
  push();
  translate(d.x, d.y);
  rotate(Math.sin(gameTick * 0.1 + d.x) * 0.2); 
  fill(50, 255, 100); 
  noStroke();
  ellipse(0, 0, 14, 10);
  fill(255, 255, 255, 150);
  ellipse(-3, -2, 4, 2);
  pop();
}

function drawJawbreaker(e) {
  push();
  translate(e.x, e.y);
  rotate(gameTick * 0.05 * Math.sign(e.vx));
  noStroke();
  fill(255, 80, 80);
  ellipse(0, 0, 20, 20); 
  fill(255, 255, 255);
  ellipse(0, 0, 14, 14);
  fill(80, 80, 255);
  ellipse(0, 0, 8, 8);
  pop();
}

function drawLicoriceFish(e) {
  push();
  translate(e.x, e.y);
  let dir = e.vx > 0 ? 1 : -1;
  scale(dir, 1);
  noStroke();
  
  fill(40, 10, 10); 
  ellipse(4, 0, 14, 10);
  let tailY = Math.sin(gameTick * 0.3) * 3;
  ellipse(-4, tailY * 0.5, 10, 8);
  ellipse(-10, tailY, 8, 6);
  
  fill(255, 50, 50);
  ellipse(7, -2, 3, 3);
  pop();
}

function drawStarBullet(b) {
  push();
  translate(b.x, b.y);
  rotate(gameTick * 0.2);
  fill(255, 255, 50);
  noStroke();
  beginShape();
  vertex(0, -6);
  vertex(2, -2);
  vertex(6, 0);
  vertex(2, 2);
  vertex(0, 6);
  vertex(-2, 2);
  vertex(-6, 0);
  vertex(-2, -2);
  endShape(CLOSE);
  pop();
}

function drawCandyCorn(b) {
  push();
  translate(b.x, b.y);
  let dir = b.vx > 0 ? 1 : -1;
  scale(dir, 1);
  noStroke();
  fill(255, 150, 0); 
  ellipse(0, 0, 10, 6);
  fill(255, 255, 0);
  ellipse(-3, 0, 4, 6); 
  pop();
}

function drawPlayer(p) {
  push();
  translate(p.x, p.y);
  scale(p.facing, 1); 
  noStroke();
  
  fill(0, 200, 255); 
  ellipse(0, 0, 20, 14); 
  
  ellipse(8, -6, 12, 12);
  ellipse(4, -10, 4, 4);
  ellipse(10, -11, 4, 4);
  
  let armY = Math.sin(gameTick * 0.2) * 3;
  fill(0, 180, 230);
  ellipse(2, 2 + armY, 10, 6); 
  
  fill(255);
  ellipse(10, -7, 4, 4);
  fill(0);
  ellipse(11, -7, 2, 2);
  
  pop();
}

function drawUI() {
  rectMode(CORNER);
  fill(0);
  rect(0, height - 10, width, 10);
  fill(255, 50, 150);
  rect(0, height - 10, (player.oxygen / 100) * width, 10);

  noStroke();
  for (let i = 0; i < player.diverCount; i++) {
    fill(50, 255, 100);
    ellipse(15 + i * 14, 15, 10, 14);
    fill(255, 255, 255, 150);
    ellipse(13 + i * 14, 12, 3, 5); 
  }
  rectMode(CENTER);
}