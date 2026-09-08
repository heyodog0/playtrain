// ============================================================
// REQUIRED: p5.js lifecycle
// ============================================================

let score = 0;
let lives = 3;
let gameState = 'PLAYING';
let tick = 0;

let player;
let pBullets = [];
let enemies = [];
let eBullets = [];
let spawners = [];
let stars = [];
let WIN_TICK = 1500;

function setup() {
  createCanvas(400, 400);
  rectMode(CENTER);
  noStroke();
}

function draw() {
  background(0, 0, 30);
  
  // Draw and update stars
  fill(255);
  for (let s of stars) {
    if (gameState === 'PLAYING') {
      s.x -= s.speed;
      if (s.x < 0) {
        s.x += 400;
        s.y = rng() * 400;
      }
    }
    rect(s.x, s.y, 2, 2);
  }

  if (gameState === 'PLAYING') {
    updateGame();
  }

  drawGame();
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
  lives = 3;
  gameState = 'PLAYING';
  tick = 0;
  
  player = { x: 50, y: 200, w: 16, h: 16, speed: 5, cooldown: 0, invuln: 0 };
  pBullets = [];
  enemies = [];
  eBullets = [];
  spawners = [];
  stars = [];
  
  for (let i = 0; i < 50; i++) {
    stars.push({ x: rng() * 400, y: rng() * 400, speed: 1 + rng() * 2 });
  }
  
  let t = 60;
  let idCounter = 0;
  while (t < WIN_TICK) {
    let r = rng();
    let type, group = 1;
    
    if (r < 0.4) { 
      type = 0; // Flyer
      group = Math.floor(rng() * 3) + 1; 
    } else if (r < 0.7) { 
      type = 1; // Fast Flyer
      group = Math.floor(rng() * 2) + 1; 
    } else if (r < 0.9) { 
      type = 2; // Turret
      group = 1; 
    } else { 
      type = 3; // Meteor
      group = 1; 
    }
    
    let baseY = 30 + rng() * 340;
    for (let i = 0; i < group; i++) {
      let spawnY = baseY + (rng() - 0.5) * 40;
      spawnY = constrain(spawnY, 20, 380);
      spawners.push({ time: t + i * 15, type: type, y: spawnY, id: idCounter++ });
    }
    t += 40 + rng() * 60;
  }
  
  spawners.sort((a, b) => a.time - b.time);
}

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
// Game Logic
// ============================================================

function overlap(a, b) {
  return Math.abs(a.x - b.x) * 2 < (a.w + b.w) && Math.abs(a.y - b.y) * 2 < (a.h + b.h);
}

function hurtPlayer() {
  if (player.invuln > 0) return;
  lives--;
  player.invuln = 30;
  if (lives <= 0) {
    gameState = 'GAMEOVER';
  }
}

function updateGame() {
  // Input processing
  if (keyIsDown(37)) player.x -= player.speed;
  if (keyIsDown(39)) player.x += player.speed;
  if (keyIsDown(38)) player.y -= player.speed;
  if (keyIsDown(40)) player.y += player.speed;
  
  player.x = constrain(player.x, player.w/2, 400 - player.w/2);
  player.y = constrain(player.y, player.h/2, 400 - player.h/2);
  
  if (player.cooldown > 0) player.cooldown--;
  if (player.invuln > 0) player.invuln--;
  
  if (keyIsDown(32) && player.cooldown <= 0) {
    pBullets.push({ x: player.x + 10, y: player.y, w: 8, h: 4, speed: 8 });
    player.cooldown = 12;
  }
  
  // Spawner logic
  while (spawners.length > 0 && spawners[0].time <= tick) {
    let s = spawners.shift();
    let e = { x: 420, y: s.y, id: s.id, type: s.type };
    if (s.type === 0) { // Flyer
      e.hp = 2; e.w = 16; e.h = 16; e.vx = -2; e.fireDelay = 80; e.c = [255, 50, 50]; e.pts = 1;
    } else if (s.type === 1) { // Fast Flyer
      e.hp = 1; e.w = 12; e.h = 12; e.vx = -4; e.fireDelay = 0; e.c = [255, 50, 255]; e.pts = 1;
    } else if (s.type === 2) { // Turret
      e.hp = 5; e.w = 24; e.h = 24; e.vx = -1; e.fireDelay = 50; e.c = [50, 255, 50]; e.pts = 2;
    } else if (s.type === 3) { // Meteor
      e.hp = 15; e.w = 32; e.h = 32; e.vx = -1; e.fireDelay = 0; e.c = [150, 150, 150]; e.pts = 3;
    }
    enemies.push(e);
  }
  
  if (tick === WIN_TICK) {
    enemies.push({ isFinish: true, x: 420, y: 200, w: 40, h: 400, vx: -2, c: [255, 255, 255] });
  }

  // Update Player Bullets
  for (let i = pBullets.length - 1; i >= 0; i--) {
    let pb = pBullets[i];
    pb.x += pb.speed;
    let hit = false;
    
    for (let j = enemies.length - 1; j >= 0; j--) {
      let e = enemies[j];
      if (e.isFinish) continue;
      if (overlap(pb, e)) {
        e.hp--;
        hit = true;
        if (e.hp <= 0) {
          score += e.pts;
          enemies.splice(j, 1);
        }
        break;
      }
    }
    
    if (hit || pb.x > 420) {
      pBullets.splice(i, 1);
    }
  }

  // Update Enemies
  for (let i = enemies.length - 1; i >= 0; i--) {
    let e = enemies[i];
    e.x += e.vx;
    
    if (!e.isFinish && e.fireDelay > 0 && (tick + e.id) % e.fireDelay === 0) {
      let dx = player.x - e.x;
      let dy = player.y - e.y;
      let dist = Math.sqrt(dx*dx + dy*dy);
      if (dist === 0) dist = 1;
      eBullets.push({
        x: e.x, y: e.y, w: 6, h: 6,
        vx: (dx/dist) * 3, vy: (dy/dist) * 3
      });
    }
    
    if (overlap(player, e)) {
      if (e.isFinish) {
        score += 10;
        gameState = 'WIN';
      } else {
        hurtPlayer();
        enemies.splice(i, 1);
        continue;
      }
    }
    
    if (e.x < -e.w) {
      enemies.splice(i, 1);
    }
  }

  // Update Enemy Bullets
  for (let i = eBullets.length - 1; i >= 0; i--) {
    let eb = eBullets[i];
    eb.x += eb.vx;
    eb.y += eb.vy;
    
    if (overlap(player, eb)) {
      hurtPlayer();
      eBullets.splice(i, 1);
      continue;
    }
    
    if (eb.x < -10 || eb.x > 410 || eb.y < -10 || eb.y > 410) {
      eBullets.splice(i, 1);
    }
  }
  
  tick++;
}

function drawGame() {
  // Draw enemies
  for (let e of enemies) {
    fill(e.c[0], e.c[1], e.c[2]);
    rect(e.x, e.y, e.w, e.h);
  }
  
  // Draw player bullets
  fill(255, 255, 0);
  for (let pb of pBullets) {
    rect(pb.x, pb.y, pb.w, pb.h);
  }
  
  // Draw enemy bullets
  fill(255, 120, 0);
  for (let eb of eBullets) {
    rect(eb.x, eb.y, eb.w, eb.h);
  }
  
  // Draw player
  if (player.invuln === 0 || Math.floor(millis() / 100) % 2 === 0) {
    fill(50, 150, 255);
    rect(player.x, player.y, player.w, player.h);
  }
  
  // Draw HUD (lives)
  fill(50, 150, 255);
  for (let i = 0; i < lives; i++) {
    rect(15 + i * 15, 15, 10, 10);
  }
}