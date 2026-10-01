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
// GLOBAL STATE
// ============================================================

let score;
let lives;
let gameState;

let wave;
let enemiesKilled;
let waveQuota;

let scrollSpeed;
let airSpawnRate;
let groundFireChance;

let player;
let terrainCols = [];
const COL_W = 20;

let enemies = [];
let bullets = [];
let enemyBullets = [];

let airSpawnTimer;

// ============================================================
// REQUIRED: p5.js lifecycle
// ============================================================

function setup() {
  createCanvas(400, 400);
}

function resetGame(seed) {
  rng = mulberry32(seed);
  score = 0;
  lives = 3;
  gameState = 'PLAYING';
  
  wave = 1;
  enemiesKilled = 0;
  waveQuota = 12;
  
  scrollSpeed = 3;
  airSpawnRate = 60;
  groundFireChance = 0.15;
  
  player = {
    x: 50, y: 100, w: 12, h: 10,
    speed: 4, cooldown: 0, invuln: 0
  };
  
  terrainCols = [];
  let th = 80;
  for(let i = 0; i <= Math.ceil(width / COL_W) + 1; i++) {
    terrainCols.push({x: i * COL_W, h: th});
    th = getNextTerrainHeight(th);
  }
  
  enemies = [];
  bullets = [];
  enemyBullets = [];
  airSpawnTimer = airSpawnRate;
}

function getGameState() {
  return {
    score: score,
    lives: lives,
    gameState: gameState
  };
}

function draw() {
  background(10, 10, 30); // Very dark blue/black space
  
  if (gameState === 'PLAYING') {
    updatePlayer();
    updateTerrain();
    updateSpawns();
    updateEntities();
    checkCollisions();
  }
  
  drawTerrain();
  drawEntities();
  drawPlayer();
  drawHUD();
}

// ============================================================
// UPDATE LOGIC
// ============================================================

function getNextTerrainHeight(prev) {
  let delta = (rng() - 0.5) * 60;
  let h = prev + delta;
  return constrain(h, 40, 220); // Ensures min safe sky above and jagged floor below
}

function updatePlayer() {
  if (keyIsDown(37)) player.x -= player.speed; // LEFT
  if (keyIsDown(39)) player.x += player.speed; // RIGHT
  if (keyIsDown(38)) player.y -= player.speed; // UP
  if (keyIsDown(40)) player.y += player.speed; // DOWN
  
  player.x = constrain(player.x, 0, width - player.w);
  player.y = constrain(player.y, 0, height - player.h);
  
  if (player.cooldown > 0) player.cooldown--;
  if (player.invuln > 0) player.invuln--;
  
  // D (Space) for shooting
  if (keyIsDown(32) && player.cooldown <= 0 && bullets.length < 3) {
    bullets.push({
      x: player.x + player.w, 
      y: player.y + player.h/2 - 2, 
      w: 8, h: 4, vx: 10
    });
    player.cooldown = 6;
  }
}

function updateTerrain() {
  for (let col of terrainCols) {
    col.x -= scrollSpeed;
  }
  
  if (terrainCols[0].x <= -COL_W) {
    terrainCols.shift();
    let lastCol = terrainCols[terrainCols.length - 1];
    let newH = getNextTerrainHeight(lastCol.h);
    let newX = lastCol.x + COL_W;
    terrainCols.push({x: newX, h: newH});
    
    // Chance to spawn ground turret on the new terrain segment
    if (rng() < groundFireChance) {
      enemies.push({
        type: 'turret',
        w: 16, h: 16,
        x: newX + (COL_W - 16)/2,
        y: height - newH - 16,
        cooldown: Math.floor(30 + rng() * 30),
        shot: null
      });
    }
  }
}

function updateSpawns() {
  airSpawnTimer--;
  if (airSpawnTimer <= 0) {
    let isBomber = rng() < 0.5;
    if (isBomber) {
      enemies.push({
        type: 'bomber',
        w: 12, h: 12,
        x: width, 
        y: rng() * (height - 150),
        baseY: rng() * (height - 150),
        time: rng() * 10,
        vx: -(2 + wave * 0.4)
      });
    } else {
      enemies.push({
        type: 'fighter',
        w: 14, h: 10,
        x: width, 
        y: 20 + rng() * (height - 180),
        vx: -(4 + wave * 0.6)
      });
    }
    airSpawnTimer = airSpawnRate;
  }
}

function updateEntities() {
  // Player Bullets
  for (let i = bullets.length - 1; i >= 0; i--) {
    let b = bullets[i];
    b.x += b.vx;
    if (b.x > width) bullets.splice(i, 1);
  }
  
  // Enemies
  for (let i = enemies.length - 1; i >= 0; i--) {
    let e = enemies[i];
    
    if (e.type === 'turret') {
      e.x -= scrollSpeed;
      if (e.cooldown > 0) e.cooldown--;
      else {
        // Fire aimed shot
        let dx = (player.x + player.w/2) - (e.x + e.w/2);
        let dy = (player.y + player.h/2) - (e.y + e.h/2);
        let dist = Math.sqrt(dx*dx + dy*dy);
        if (dist > 0 && e.x < width) {
          let speed = 3 + wave * 0.2;
          let vx = (dx / dist) * speed;
          let vy = (dy / dist) * speed;
          e.shot = { x: e.x + e.w/2 - 3, y: e.y - 6, w: 6, h: 6, vx: vx, vy: vy, turret: e };
          enemyBullets.push(e.shot);
          e.cooldown = Math.max(30, 90 - wave * 5);
        }
      }
      if (e.x + e.w < 0) enemies.splice(i, 1);
      
    } else if (e.type === 'bomber') {
      e.x += e.vx;
      // Swoop gently toward player Y
      e.baseY += (player.y - e.baseY) * 0.015;
      e.time += 0.05;
      e.y = e.baseY + Math.sin(e.time) * 40;
      if (e.x + e.w < 0) enemies.splice(i, 1);
      
    } else if (e.type === 'fighter') {
      e.x += e.vx;
      if (e.x + e.w < 0) enemies.splice(i, 1);
    }
  }
  
  // Enemy Bullets
  for (let i = enemyBullets.length - 1; i >= 0; i--) {
    let eb = enemyBullets[i];
    eb.x += eb.vx;
    eb.y += eb.vy;
    if (eb.x < 0 || eb.x > width || eb.y < 0 || eb.y > height) {
      enemyBullets.splice(i, 1);
    }
  }
}

function rectIntersect(a, b) {
  return a.x < b.x + b.w &&
         a.x + a.w > b.x &&
         a.y < b.y + b.h &&
         a.y + a.h > b.y;
}

function checkCollisions() {
  // 1. Bullets vs Enemies
  for (let i = bullets.length - 1; i >= 0; i--) {
    let b = bullets[i];
    let hit = false;
    for (let j = enemies.length - 1; j >= 0; j--) {
      let e = enemies[j];
      if (rectIntersect(b, e)) {
        hit = true;
        
        // Award points
        if (e.type === 'turret') {
          score += 60;
          if (e.shot) {
            let idx = enemyBullets.indexOf(e.shot);
            if (idx !== -1) enemyBullets.splice(idx, 1);
          }
        } else if (e.type === 'bomber') {
          score += 25;
        } else if (e.type === 'fighter') {
          score += 30;
        }
        
        enemies.splice(j, 1);
        enemiesKilled++;
        
        if (enemiesKilled >= waveQuota) {
          completeWave();
        }
        break; 
      }
    }
    if (hit) bullets.splice(i, 1);
  }

  // Allow collision interactions below only if player is vulnerable
  if (player.invuln > 0) return;

  // 2. Player vs Terrain
  for (let col of terrainCols) {
    let colRect = { x: col.x, y: height - col.h, w: COL_W, h: col.h };
    if (rectIntersect(player, colRect)) {
      player.y = Math.max(0, height - col.h - player.h - 5); // push out
      takeDamage();
      return; 
    }
  }

  // 3. Player vs Enemies
  for (let e of enemies) {
    if (rectIntersect(player, e)) {
      takeDamage();
      return;
    }
  }

  // 4. Player vs Enemy Bullets
  for (let i = enemyBullets.length - 1; i >= 0; i--) {
    let eb = enemyBullets[i];
    if (rectIntersect(player, eb)) {
      enemyBullets.splice(i, 1);
      takeDamage();
      return;
    }
  }
}

function completeWave() {
  score += 200;
  wave++;
  enemiesKilled = 0;
  waveQuota += 3;
  
  // Escalate difficulty
  scrollSpeed = Math.min(8, scrollSpeed + 0.3);
  airSpawnRate = Math.max(15, airSpawnRate - 5);
  groundFireChance = Math.min(0.6, groundFireChance + 0.05);
  
  // Re-roll terrain ahead immediately to shake up the safe zone
  let lastCol = terrainCols[terrainCols.length - 1];
  lastCol.h = rng() * 120 + 80;
}

function takeDamage() {
  lives--;
  if (lives <= 0) {
    gameState = 'GAMEOVER';
  } else {
    player.invuln = 60; // ~1 second of I-frames
  }
}

// ============================================================
// DRAWING
// ============================================================

function drawTerrain() {
  fill(34, 139, 34); // Forest Green
  noStroke();
  for (let col of terrainCols) {
    // Add +1 to width to overlap and prevent 1px visual gaps during fractional scrolling
    rect(Math.floor(col.x), height - col.h, COL_W + 1, col.h);
  }
}

function drawEntities() {
  noStroke();
  
  // Player Lasers (White)
  fill(255);
  for (let b of bullets) {
    rect(b.x, b.y, b.w, b.h);
  }
  
  // Enemies
  for (let e of enemies) {
    if (e.type === 'turret') {
      fill(200, 50, 50); // Red base
      rect(Math.floor(e.x), Math.floor(e.y), e.w, e.h);
      fill(150, 50, 50); // Darker barrel
      rect(Math.floor(e.x + e.w/2 - 2), Math.floor(e.y - 4), 4, 4);
      
    } else if (e.type === 'bomber') {
      fill(200, 50, 200); // Magenta 
      rect(Math.floor(e.x), Math.floor(e.y), e.w, e.h);
      
    } else if (e.type === 'fighter') {
      fill(255, 150, 0); // Orange
      rect(Math.floor(e.x), Math.floor(e.y), e.w, e.h);
    }
  }
  
  // Enemy Bullets (Yellow)
  fill(255, 255, 0);
  for (let eb of enemyBullets) {
    rect(Math.floor(eb.x), Math.floor(eb.y), eb.w, eb.h);
  }
}

function drawPlayer() {
  if (player.invuln > 0 && Math.floor(player.invuln / 4) % 2 === 0) {
    return; // Blink logic
  }
  
  noStroke();
  fill(0, 255, 255); // Cyan body
  rect(Math.floor(player.x), Math.floor(player.y), player.w, player.h);
  
  fill(255); // White cockpit
  rect(Math.floor(player.x + player.w - 4), Math.floor(player.y + 2), 4, 4);
}

function drawHUD() {
  noStroke();
  
  // Lives: Small cyan blocks
  fill(0, 255, 255);
  for (let i = 0; i < lives; i++) {
    rect(10 + i * 12, 10, 8, 8);
  }
  
  // Wave progress: Gray background bar
  fill(100);
  rect(10, 22, 100, 4);
  
  // Wave progress: Green fill
  fill(0, 255, 0);
  let progress = enemiesKilled / waveQuota;
  rect(10, 22, 100 * progress, 4);
}