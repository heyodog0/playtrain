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
// Game Variables
// ============================================================
let ticks, score, lives, gameState;
let player, enemies, lasers, spawnRate, enemySpeed;

// ============================================================
// REQUIRED: p5.js lifecycle
// ============================================================

function setup() {
  createCanvas(400, 400);
}

function resetGame(seed) {
  rng = mulberry32(seed);
  ticks = 0;
  score = 0;
  lives = 3;
  gameState = 'PLAYING';
  
  player = { x: 200, y: 360, w: 24, h: 24, cooldown: 0, invuln: 0 };
  enemies = [];
  lasers = [];
  spawnRate = 60;
  enemySpeed = 2;
  
  // Pre-warm the level with a few staggered enemies
  for (let i = 0; i < 4; i++) {
    spawnEnemy(i * 80);
  }
}

function spawnEnemy(yOffset = 0) {
  let beamIndex = Math.floor(rng() * 9);
  let beamX = 40 + beamIndex * 40;
  enemies.push({ x: beamX, y: -20 + yOffset, w: 24, h: 24, speed: enemySpeed });
}

function getGameState() {
  return { score, lives, gameState };
}

function draw() {
  if (gameState !== 'PLAYING') {
    return;
  }
  
  ticks++;
  
  // Increase difficulty progressively
  if (ticks % 300 === 0) {
    spawnRate = Math.max(20, spawnRate - 5);
    enemySpeed = Math.min(6, enemySpeed + 0.2);
  }
  
  // Handle Input (Action Space: LEFT=37, RIGHT=39, SPACE/D=32)
  if (keyIsDown(37)) { player.x -= 4; }
  if (keyIsDown(39)) { player.x += 4; }
  
  // Clamp player to screen
  player.x = Math.max(20, Math.min(380, player.x));
  
  if (player.cooldown > 0) player.cooldown--;
  if (player.invuln > 0) player.invuln--;
  
  if (keyIsDown(32) && player.cooldown === 0) {
    lasers.push({ x: player.x, y: player.y - player.h / 2, w: 10, h: 20, speed: 8 });
    player.cooldown = 15;
  }
  
  // Spawn new enemies
  if (ticks % spawnRate === 0) {
    spawnEnemy();
  }
  
  // Update Lasers
  for (let i = lasers.length - 1; i >= 0; i--) {
    lasers[i].y -= lasers[i].speed;
    if (lasers[i].y < -20) {
      lasers.splice(i, 1);
    }
  }
  
  // Update Enemies and check collisions
  for (let i = enemies.length - 1; i >= 0; i--) {
    let e = enemies[i];
    e.y += e.speed;
    
    // Check laser hit
    let hit = false;
    for (let j = lasers.length - 1; j >= 0; j--) {
      let l = lasers[j];
      // AABB Collision
      if (Math.abs(e.x - l.x) < (e.w + l.w) / 2 && Math.abs(e.y - l.y) < (e.h + l.h) / 2) {
        score += 10;
        if (score >= 500) {
          gameState = 'WIN';
        }
        lasers.splice(j, 1);
        hit = true;
        break;
      }
    }
    
    if (hit) {
      enemies.splice(i, 1);
      continue;
    }
    
    // Check player hit
    if (player.invuln === 0 && Math.abs(e.x - player.x) < (e.w + player.w) / 2 && Math.abs(e.y - player.y) < (e.h + player.h) / 2) {
      lives--;
      player.invuln = 30; // Brief invulnerability after being hit
      enemies.splice(i, 1);
      if (lives <= 0) {
        gameState = 'GAMEOVER';
      }
      continue;
    }
    
    // Remove if off screen
    if (e.y > 420) {
      enemies.splice(i, 1);
    }
  }
  
  // ============================================================
  // Render Frame
  // ============================================================
  background(20); // Dark background for high contrast
  
  // Draw vertical beams (lanes)
  stroke(40, 40, 100);
  strokeWeight(4);
  for (let i = 0; i < 9; i++) {
    let bx = 40 + i * 40;
    line(bx, 0, bx, 400);
  }
  noStroke();
  
  // Draw Lasers
  rectMode(CENTER);
  fill(255, 255, 0); // Yellow lasers
  for (let l of lasers) {
    rect(l.x, l.y, l.w, l.h);
  }
  
  // Draw Enemies
  fill(255, 50, 50); // Red enemies
  for (let e of enemies) {
    ellipse(e.x, e.y, e.w, e.h);
  }
  
  // Draw Player (flicker if invulnerable)
  if (player.invuln === 0 || (player.invuln > 0 && Math.floor(ticks / 4) % 2 === 0)) {
    fill(50, 255, 50); // Green base
    rect(player.x, player.y, player.w, player.h);
    fill(30, 200, 30); // Darker green cannon
    rect(player.x, player.y - player.h / 2, 8, 12);
  }
  
  // Draw HUD (Lives indicated by simple squares at top left)
  fill(50, 255, 50);
  rectMode(CORNER);
  for (let i = 0; i < lives; i++) {
    rect(10 + i * 15, 10, 10, 10);
  }
}