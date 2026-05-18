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
let explosions, gridOffset;

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
  explosions = [];
  gridOffset = 0;
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
  let type = Math.floor(rng() * 3);
  enemies.push({ x: beamX, y: -20 + yOffset, w: 24, h: 24, speed: enemySpeed, type: type });
}

function getGameState() {
  return { score, lives, gameState };
}

// Pseudo-3D Projection
function project(x, y) {
  let z = 360 - y;
  if (z < -100) z = -100;
  let scale = 150 / (z + 150);
  return {
    x: 200 + (x - 200) * scale,
    y: 360 * scale,
    s: scale
  };
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
  
  // Update Explosions
  for (let i = explosions.length - 1; i >= 0; i--) {
    explosions[i].life--;
    if (explosions[i].life <= 0) {
      explosions.splice(i, 1);
    }
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
      // AABB Collision (Logical coordinates)
      if (Math.abs(e.x - l.x) < (e.w + l.w) / 2 && Math.abs(e.y - l.y) < (e.h + l.h) / 2) {
        score += 10;
        if (score >= 500) {
          gameState = 'WIN';
        }
        explosions.push({ x: e.x, y: e.y, life: 20, maxLife: 20 });
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
      explosions.push({ x: e.x, y: e.y, life: 30, maxLife: 30 });
      explosions.push({ x: player.x, y: player.y, life: 40, maxLife: 40 });
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
  
  // Update visual grid offset
  gridOffset = (gridOffset + enemySpeed) % 40;
  
  // ============================================================
  // Render Frame
  // ============================================================
  background(10, 10, 30); // Deep space background
  
  // Horizon Glow
  noStroke();
  for (let i = 0; i < 15; i++) {
    fill(40, 100, 255, 15 - i);
    rectMode(CENTER);
    rect(200, i * 2, 400, 4);
  }
  
  // Vertical perspective grid lines
  stroke(40, 40, 150);
  strokeWeight(2);
  for (let i = 0; i < 9; i++) {
    let bx = 40 + i * 40;
    let pFar = project(bx, -2000);
    let pNear = project(bx, 420);
    line(pFar.x, pFar.y, pNear.x, pNear.y);
  }
  
  // Horizontal perspective grid lines
  for (let y = -800; y <= 420; y += 40) {
    let py = y + gridOffset;
    if (py > 420) continue;
    let pLeft = project(0, py);
    let pRight = project(400, py);
    let alpha = map(py, -800, 360, 0, 255);
    stroke(40, 100, 255, Math.max(0, Math.min(255, alpha)));
    strokeWeight(Math.max(0.5, 2 * pLeft.s));
    line(pLeft.x, pLeft.y, pRight.x, pRight.y);
  }
  
  // Draw Explosions
  for (let ex of explosions) {
    let ep = project(ex.x, ex.y);
    let progress = 1 - (ex.life / ex.maxLife);
    let radius = progress * 80 * ep.s;
    let alpha = (ex.life / ex.maxLife) * 255;
    
    noFill();
    stroke(255, 100, 50, alpha);
    strokeWeight(3 * ep.s);
    ellipse(ep.x, ep.y, radius, radius);
    
    fill(255, 200, 50, alpha);
    noStroke();
    for (let j = 0; j < 8; j++) {
      let angle = j * (Math.PI * 2) / 8 + progress * Math.PI;
      let dist = progress * 50 * ep.s;
      let fx = ep.x + Math.cos(angle) * dist;
      let fy = ep.y + Math.sin(angle) * dist;
      ellipse(fx, fy, 6 * ep.s, 6 * ep.s);
    }
  }
  
  // Draw Lasers
  strokeCap(ROUND);
  for (let l of lasers) {
    let pFront = project(l.x, l.y - l.h / 2);
    let pBack = project(l.x, l.y + l.h / 2);
    
    stroke(255, 255, 0);
    strokeWeight(Math.max(2, l.w * pFront.s));
    line(pFront.x, pFront.y, pBack.x, pBack.y);
    
    stroke(255, 255, 255);
    strokeWeight(Math.max(1, (l.w / 2) * pFront.s));
    line(pFront.x, pFront.y, pBack.x, pBack.y);
  }
  
  // Draw Enemies
  for (let e of enemies) {
    let ep = project(e.x, e.y);
    push();
    translate(ep.x, ep.y);
    scale(ep.s);
    if (e.type === 1) {
      fill(50, 150, 255);
      stroke(150, 200, 255);
      strokeWeight(1);
      triangle(-12, 10, 12, 10, 0, -12);
      fill(0, 50, 200);
      noStroke();
      ellipse(0, 4, 8, 8);
    } else if (e.type === 2) {
      fill(255, 255, 50);
      stroke(255, 255, 150);
      strokeWeight(1);
      rectMode(CENTER);
      rect(0, 0, 20, 20, 4);
      fill(200, 150, 0);
      noStroke();
      rect(0, 0, 8, 8, 2);
    } else {
      fill(255, 50, 50);
      stroke(255, 150, 150);
      strokeWeight(1);
      quad(0, -12, 12, 0, 0, 12, -12, 0);
      fill(200, 0, 0);
      noStroke();
      ellipse(0, 0, 10, 10);
    }
    pop();
  }
  
  // Draw Player
  if (player.invuln === 0 || (player.invuln > 0 && Math.floor(ticks / 4) % 2 === 0)) {
    let p = project(player.x, player.y);
    push();
    translate(p.x, p.y);
    scale(p.s);
    
    fill(50, 255, 50);
    stroke(150, 255, 150);
    strokeWeight(1);
    triangle(0, -15, -15, 10, 15, 10);
    
    fill(30, 200, 30);
    noStroke();
    rectMode(CENTER);
    rect(0, 5, 24, 8);
    rect(0, -10, 6, 15);
    pop();
  }
  
  // Draw HUD
  fill(50, 255, 50);
  noStroke();
  for (let i = 0; i < lives; i++) {
    let lx = 20 + i * 20;
    let ly = 20;
    triangle(lx, ly - 6, lx - 6, ly + 4, lx + 6, ly + 4);
  }
}