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

let bubbles;
let seaweeds;
let bgFishes;
let tick = 0;

const LANES = [100, 140, 180, 220, 260, 300, 340, 370];

function setup() {
  createCanvas(400, 400, WEBGL);
  noStroke();
}

function draw() {
  if (gameState !== 'PLAYING') {
    renderGame();
    return;
  }

  tick++;
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

  bubbles = [];
  seaweeds = [];
  bgFishes = [];
  tick = 0;

  for (let i = 0; i < 30; i++) {
    bubbles.push({
      x: rng() * width,
      y: 35 + rng() * (height - 35),
      z: -30 + rng() * 40,
      r: 1 + rng() * 3,
      speed: 1 + rng() * 2,
      seed: rng() * 100
    });
  }

  for (let i = 0; i < 20; i++) {
    seaweeds.push({
      x: rng() * width,
      y: height,
      h: 20 + rng() * 60,
      w: 2 + rng() * 4,
      swayOffset: rng() * 100
    });
  }

  for (let i = 0; i < 10; i++) {
    bgFishes.push({
      x: rng() * width,
      y: 70 + rng() * (height - 100),
      z: -40 - rng() * 40,
      vx: (rng() < 0.5 ? -1 : 1) * (0.5 + rng()),
      color: [50 + rng() * 150, 50 + rng() * 150, 150 + rng() * 100]
    });
  }
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
  // Bubbles
  for (let b of bubbles) {
    b.y -= b.speed * 0.5;
    if (b.y < 35) {
      b.y = height + 10;
    }
  }

  // Bg Fishes
  for (let f of bgFishes) {
    f.x += f.vx * 0.35;
    if (f.vx > 0 && f.x > width + 50) f.x = -50;
    if (f.vx < 0 && f.x < -50) f.x = width + 50;
  }

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
      w: type === 'sub' ? 24 : 28,
      h: type === 'sub' ? 14 : 12,
      vx: side === -1 ? (1.5 + rng() * 1.5) : -(1.5 + rng() * 1.5),
      type: type
    });
    
    enemyTimer = 30 + Math.floor(rng() * 40);
  }

  diverTimer--;
  if (diverTimer <= 0) {
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
  score = Math.max(0, score - 50);
  if (lives <= 0) {
    gameState = 'GAMEOVER';
  } else {
    resetLevel();
  }
}

function intersect(x1, y1, w1, h1, x2, y2, w2, h2) {
  return Math.abs(x1 - x2) < (w1 + w2) / 2 &&
         Math.abs(y1 - y2) < (h1 + h2) / 2;
}

function renderGame() {
  background(10, 30, 60);

  push();
  translate(-width / 2, -height / 2, 0);

  ambientLight(40, 80, 120);
  directionalLight(200, 240, 255, 0.5, 1, -0.5);
  pointLight(0, 255, 255, player.x, player.y, 100);

  // Ocean Floor
  push();
  translate(width / 2, height, -20);
  fill(160, 140, 100);
  ambientMaterial(160, 140, 100);
  box(width * 1.5, 40, 100);
  pop();

  // Surface Layer
  push();
  fill(0, 120, 200);
  ambientMaterial(0, 120, 200);
  translate(width / 2, 35, -10);
  box(width * 1.5, 70, 40);
  pop();

  // Seaweed
  fill(34, 139, 34);
  ambientMaterial(34, 139, 34);
  for (let sw of seaweeds) {
    push();
    translate(sw.x, sw.y - sw.h / 2, -10);
    rotateZ(Math.sin(tick * 0.05 + sw.swayOffset) * 0.1);
    cylinder(sw.w, sw.h);
    pop();
  }

  // Background Fishes
  for (let f of bgFishes) {
    push();
    translate(f.x, f.y, f.z);
    let dir = f.vx > 0 ? 0 : PI;
    rotateY(dir);
    fill(f.color[0], f.color[1], f.color[2]);
    ambientMaterial(f.color[0], f.color[1], f.color[2]);
    ellipsoid(8, 4, 2);
    translate(-6, 0, 0);
    box(2, 6, 1);
    pop();
  }

  // Bubbles
  fill(60, 110, 160);
  ambientMaterial(60, 110, 160);
  for (let b of bubbles) {
    push();
    translate(b.x + Math.sin(tick * 0.05 + b.seed) * 5, b.y, b.z);
    sphere(b.r * 0.6);
    pop();
  }

  // Oxygen Bar Background
  push();
  fill(20);
  ambientMaterial(20);
  translate(width / 2, height - 10, 5);
  box(width - 20, 10, 5);
  pop();

  // Oxygen Bar Fill
  let oxW = Math.max(0, (player.oxygen / 100) * (width - 20));
  push();
  fill(0, 255, 255);
  ambientMaterial(0, 255, 255);
  translate(10 + oxW / 2, height - 10, 6);
  box(oxW, 8, 6);
  pop();

  // Collected Divers Indicators
  fill(255, 100, 0);
  ambientMaterial(255, 100, 0);
  for (let i = 0; i < player.diverCount; i++) {
    push();
    translate(20 + i * 15, 20, 5);
    sphere(4);
    pop();
  }

  // Divers
  for (let d of divers) {
    push();
    translate(d.x, d.y, 0);
    let dDir = d.vx > 0 ? 1 : -1;
    rotateY(dDir === 1 ? 0 : PI);
    
    fill(255, 100, 0);
    ambientMaterial(255, 100, 0);
    
    // Body
    push();
    rotateZ(HALF_PI);
    cylinder(d.h / 2.5, d.w - 4);
    pop();
    
    // Head
    push();
    translate(d.w / 2, 0, 0);
    fill(255, 200, 150);
    ambientMaterial(255, 200, 150);
    sphere(d.h / 2.5);
    pop();
    
    // Flippers
    push();
    fill(20);
    ambientMaterial(20);
    translate(-d.w / 2, -2, 0);
    box(4, 2, 6);
    translate(0, 4, 0);
    box(4, 2, 6);
    pop();
    pop();
  }

  // Enemies
  for (let e of enemies) {
    push();
    translate(e.x, e.y, 0);
    let dir = e.vx > 0 ? 1 : -1;
    rotateY(dir === 1 ? 0 : PI);

    if (e.type === 'sub') {
      fill(220, 50, 50);
      specularMaterial(220, 50, 50);
      shininess(30);
      
      // Body
      push();
      rotateZ(HALF_PI);
      cylinder(e.h / 2, e.w - 6);
      pop();
      
      // Front dome
      push();
      translate((e.w / 2 - 3), 0, 0);
      sphere(e.h / 2);
      pop();
      
      // Back cone
      push();
      translate(-(e.w / 2 - 3), 0, 0);
      rotateZ(-HALF_PI);
      cone(e.h / 2, 6);
      pop();
      
      // Periscope
      push();
      translate(0, -e.h / 2 - 2, 0);
      box(2, 4, 2);
      pop();
    } else {
      fill(100, 130, 160);
      specularMaterial(100, 130, 160);
      shininess(10);
      
      // Body
      ellipsoid(e.w / 2, e.h / 2, e.h / 2);
      
      // Dorsal Fin
      push();
      translate(-2, -e.h / 2, 0);
      cone(e.h / 3, e.h);
      pop();
      
      // Tail Fin
      push();
      translate(-e.w / 2 - 2, 0, 0);
      box(4, e.h * 1.5, 2);
      pop();
    }
    pop();
  }

  // Player Bullets
  fill(255, 255, 0);
  ambientMaterial(255, 255, 0);
  for (let b of pBullets) {
    push();
    translate(b.x, b.y, 0);
    rotateZ(HALF_PI);
    cylinder(2, 6);
    pop();
  }

  // Enemy Bullets
  fill(255, 100, 0);
  ambientMaterial(255, 100, 0);
  for (let b of eBullets) {
    push();
    translate(b.x, b.y, 0);
    rotateZ(HALF_PI);
    cylinder(2, 6);
    pop();
  }

  // Player
  if (gameState === 'PLAYING') {
    push();
    translate(player.x, player.y, 0);
    rotateY(player.facing === 1 ? 0 : PI);

    fill(255, 220, 0);
    specularMaterial(255, 220, 0);
    shininess(40);
    
    // Body
    push();
    rotateZ(HALF_PI);
    cylinder(player.h / 2, player.w - 8);
    pop();
    
    // Front dome
    push();
    translate((player.w / 2 - 4), 0, 0);
    sphere(player.h / 2);
    pop();
    
    // Back cone
    push();
    translate(-(player.w / 2 - 4), 0, 0);
    rotateZ(-HALF_PI);
    cone(player.h / 2, 8);
    pop();
    
    // Periscope
    push();
    translate(0, -player.h / 2 - 2, 0);
    box(2, 4, 2);
    translate(2, -2, 0);
    box(4, 2, 2);
    pop();

    pop();
  }

  pop();
}