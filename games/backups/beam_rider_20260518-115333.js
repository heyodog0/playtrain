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
let explosions = [];
let stars = [];

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
  spawnRate = 60;
  enemySpeed = 2;
  
  // Generate background stars deterministically
  stars = [];
  for (let i = 0; i < 40; i++) {
    stars.push({ x: rng() * 400, y: rng() * 120, size: rng() * 2 + 1 });
  }
  
  // Pre-warm the level with a few staggered enemies appearing from horizon
  for (let i = 0; i < 4; i++) {
    spawnEnemy(i * 80);
  }
}

function spawnEnemy(yOffset = 0) {
  let beamIndex = Math.floor(rng() * 9);
  let beamX = 40 + beamIndex * 40;
  // Start further back to match the horizon perspective (-80)
  enemies.push({ x: beamX, y: -80 + yOffset, w: 24, h: 24, speed: enemySpeed });
}

function getGameState() {
  return { score, lives, gameState };
}

// Pseudo-3D Projection function
// Maps logic coordinates (0 to 400 plane) to a visual perspective grid
function project(x, y) {
  // y ranges from -80 (horizon) to 400 (bottom of screen)
  let t = Math.max(0, (y + 80) / 480);
  let y_screen = 120 + 280 * (t * t); // Accelerates visually as it approaches
  let scale = (y_screen - 120) / 280;
  let x_screen = 200 + (x - 200) * scale;
  return { x: x_screen, y: y_screen, s: Math.max(0.01, scale) };
}

function draw() {
  if (gameState === 'PLAYING') {
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
      if (lasers[i].y < -80) { // Despawn at horizon
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
        // AABB Collision (Logic remains strictly 2D flat AABB)
        if (Math.abs(e.x - l.x) < (e.w + l.w) / 2 && Math.abs(e.y - l.y) < (e.h + l.h) / 2) {
          score += 10;
          if (score >= 500) {
            gameState = 'WIN';
          }
          
          // Death explosion animation
          let parts = [];
          for (let k = 0; k < 8; k++) {
            let angle = k * Math.PI / 4;
            parts.push({ vx: Math.cos(angle) * 3, vy: Math.sin(angle) * 3 });
          }
          explosions.push({ x: e.x, y: e.y, ticks: 0, maxTicks: 25, particles: parts });
          
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
        
        let parts = [];
        for (let k = 0; k < 12; k++) {
          let angle = k * Math.PI / 6;
          parts.push({ vx: Math.cos(angle) * 5, vy: Math.sin(angle) * 5 });
        }
        explosions.push({ x: e.x, y: e.y, ticks: 0, maxTicks: 30, particles: parts });
        
        enemies.splice(i, 1);
        if (lives <= 0) {
          gameState = 'GAMEOVER';
        }
        continue;
      }
      
      // Remove if off screen bottom
      if (e.y > 420) {
        enemies.splice(i, 1);
      }
    }
    
    // Update Explosions
    for (let i = explosions.length - 1; i >= 0; i--) {
      explosions[i].ticks++;
      if (explosions[i].ticks >= explosions[i].maxTicks) {
        explosions.splice(i, 1);
      }
    }
  }
  
  // ============================================================
  // Render Frame
  // ============================================================
  background(10, 10, 30); // Deep space background
  
  // Draw starry sky
  fill(255);
  noStroke();
  for (let s of stars) {
    ellipse(s.x, s.y, s.size);
  }
  
  // Horizon glow
  fill(20, 20, 50, 150);
  rectMode(CORNER);
  rect(0, 0, 400, 120);
  
  // Draw Grid (Perspective)
  stroke(40, 100, 200);
  strokeWeight(2);
  
  // Vertical converging lanes
  for (let i = 0; i < 9; i++) {
    let bx = 40 + i * 40;
    let p1 = project(bx, -80);
    let p2 = project(bx, 400);
    line(p1.x, p1.y, p2.x, p2.y);
  }
  
  // Horizontal moving grid lines to simulate forward movement
  let gridSpeed = (gameState === 'PLAYING') ? 4 : 0;
  let y_logic = -80 + ((ticks * gridSpeed) % 80);
  for (; y_logic <= 400; y_logic += 80) {
    if (y_logic < -80) continue;
    let pL = project(40, y_logic);
    let pR = project(360, y_logic);
    line(pL.x, pL.y, pR.x, pR.y);
  }
  
  noStroke();
  
  // Draw Lasers
  stroke(255, 255, 0);
  for (let l of lasers) {
    let p1 = project(l.x, l.y - l.h / 2);
    let p2 = project(l.x, l.y + l.h / 2);
    strokeWeight(Math.max(2, l.w * p1.s));
    line(p1.x, p1.y, p2.x, p2.y);
  }
  noStroke();
  
  // Draw Explosions
  for (let ex of explosions) {
    let life = ex.ticks / ex.maxTicks;
    fill(255, 255 * (1 - life), 0, 255 * (1 - life));
    for (let p of ex.particles) {
      let lx = ex.x + p.vx * ex.ticks;
      let ly = ex.y + p.vy * ex.ticks;
      let proj = project(lx, ly);
      ellipse(proj.x, proj.y, Math.max(1, 10 * proj.s * (1 - life)));
    }
  }
  
  // Draw Enemies
  for (let e of enemies) {
    let p = project(e.x, e.y);
    let w = e.w * p.s;
    let h = e.h * p.s;
    
    fill(255, 50, 50); // Red enemies
    quad(p.x, p.y - h/2, p.x + w, p.y, p.x, p.y + h/2, p.x - w, p.y);
    fill(255, 150, 150); // Highlight center
    ellipse(p.x, p.y, w/2, h/2);
  }
  
  // Draw Player (flicker if invulnerable)
  if (player.invuln === 0 || (player.invuln > 0 && Math.floor(ticks / 4) % 2 === 0)) {
    let p = project(player.x, player.y);
    let pw = player.w * p.s * 1.5;
    let ph = player.h * p.s * 1.5;
    
    push();
    translate(p.x, p.y);
    fill(50, 255, 50); // Green base wings
    triangle(-pw, ph/2, pw, ph/2, 0, -ph/2);
    
    fill(30, 150, 30); // Core nose
    triangle(-pw/2, ph/2, pw/2, ph/2, 0, -ph);
    
    // Thruster flame animation
    if (gameState === 'PLAYING' && ticks % 4 < 2) {
      fill(255, 150, 0);
      triangle(-pw/4, ph/2, pw/4, ph/2, 0, ph/2 + ph/2);
    }
    pop();
  }
  
  // Draw HUD (Lives indicated by simple squares at top left)
  fill(50, 255, 50);
  noStroke();
  rectMode(CORNER);
  for (let i = 0; i < lives; i++) {
    rect(10 + i * 15, 10, 10, 10);
  }
  
  // Score display
  fill(255);
  textSize(16);
  textAlign(RIGHT, TOP);
  text("SCORE: " + score, 390, 10);
  
  // Draw overlays for Game Over or Win states
  if (gameState !== 'PLAYING') {
    fill(0, 150);
    rect(0, 0, 400, 400);
    fill(255);
    textAlign(CENTER, CENTER);
    textSize(32);
    text(gameState === 'WIN' ? "YOU WIN!" : "GAME OVER", 200, 200);
  }
}