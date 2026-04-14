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

let score;
let lives;
let gameState;
let player;
let cameraY;
let platforms;
let enemies;
let bullets;
let nextGenY;
let enemiesKilled;
let maxDepthReached;

const WIN_DEPTH = 15000;
const MAX_AMMO = 8;

// ============================================================
// REQUIRED: p5.js lifecycle
// ============================================================

function setup() {
  createCanvas(400, 400);
}

// Intersect check for AABB
function rectIntersect(r1, r2) {
  return r1.x < r2.x + r2.w && r1.x + r1.w > r2.x &&
         r1.y < r2.y + r2.h && r1.y + r1.h > r2.y;
}

function generateEnvironment(targetY) {
  while (nextGenY < targetY) {
    if (nextGenY >= WIN_DEPTH) {
      platforms.push({ x: 20, y: WIN_DEPTH, w: 360, h: 60 });
      nextGenY = WIN_DEPTH + 1000; // Stop generating
      break;
    }

    // Force at least one platform per chunk to ensure landing spots
    let pw1 = 80 + rng() * 100;
    let px1 = 20 + rng() * (360 - pw1);
    let py1 = nextGenY + rng() * 60;
    platforms.push({ x: px1, y: py1, w: pw1, h: 16 });

    // Optional second platform in this chunk
    if (rng() > 0.5) {
      let pw2 = 60 + rng() * 80;
      let px2 = 20 + rng() * (360 - pw2);
      let py2 = nextGenY + 100 + rng() * 60;
      platforms.push({ x: px2, y: py2, w: pw2, h: 16 });
    }

    // Enemies (spawned somewhat near platforms)
    if (rng() > 0.4) {
      let numEnemies = Math.floor(rng() * 3) + 1; // 1 to 3
      for (let i = 0; i < numEnemies; i++) {
        let ex = 40 + rng() * 290;
        let ey = py1 - 40 - rng() * 40;
        let type = rng() > 0.5 ? 'static' : 'patrol';
        let vx = type === 'patrol' ? (rng() > 0.5 ? 3 : -3) : 0;
        enemies.push({ x: ex, y: ey, w: 24, h: 24, vx: vx, active: true });
      }
    }

    nextGenY += 200;
  }
}

function draw() {
  background(15); // Dark background for high contrast

  if (gameState === 'PLAYING') {
    // --- Update Logic ---

    // Timers
    if (player.cooldown > 0) player.cooldown--;
    if (player.invuln > 0) player.invuln--;

    // Horizontal Movement (Actions 1 and 2: LEFT and RIGHT)
    player.vx = 0;
    if (keyIsDown(37)) player.vx = -5; // LEFT
    if (keyIsDown(39)) player.vx = 5;  // RIGHT
    player.x += player.vx;

    // Wall constraints
    if (player.x < 20) player.x = 20;
    if (player.x + player.w > 380) player.x = 380 - player.w;

    // Vertical Movement & Gravity
    let oldY = player.y;
    player.vy += 0.5; // Gravity
    if (player.vy > 10) player.vy = 10; // Terminal velocity

    // Shooting (Action 5: D -> Space)
    if (keyIsDown(32) && player.cooldown <= 0 && player.ammo > 0) {
      bullets.push({ 
        x: player.x + player.w / 2 - 6, 
        y: player.y + player.h, 
        w: 12, h: 20, vy: 16, active: true 
      });
      // Kickback / Hover effect
      player.vy -= 5;
      if (player.vy < -5) player.vy = -5; // Cap upward kick
      player.cooldown = 12;
      player.ammo--;
    }

    player.y += player.vy;

    // Platform Collisions (Only when falling)
    if (player.vy > 0) {
      for (let p of platforms) {
        if (player.x < p.x + p.w && player.x + player.w > p.x) {
          if (oldY + player.h <= p.y && player.y + player.h >= p.y) {
            player.y = p.y - player.h;
            player.vy = 0;
            player.ammo = MAX_AMMO; // Reload on landing
            if (player.y >= WIN_DEPTH) gameState = 'WIN';
          }
        }
      }
    }

    // Camera heavily follows player downward
    cameraY = player.y - 150;
    generateEnvironment(cameraY + 500);

    // Update Bullets
    for (let b of bullets) {
      if (!b.active) continue;
      b.y += b.vy;
      if (b.y > cameraY + 450) b.active = false;
    }

    // Update Enemies
    for (let e of enemies) {
      if (!e.active) continue;
      
      // Patrol movement
      e.x += e.vx;
      if (e.x < 20) { e.x = 20; e.vx *= -1; }
      if (e.x + e.w > 380) { e.x = 380 - e.w; e.vx *= -1; }

      // Enemy hit by bullet
      for (let b of bullets) {
        if (b.active && rectIntersect(b, e)) {
          b.active = false;
          e.active = false;
          enemiesKilled++;
        }
      }

      // Player collides with enemy
      if (e.active && rectIntersect(player, e)) {
        if (player.vy > 0 && oldY + player.h <= e.y + 12) {
          // Stomp (Player falling from above)
          e.active = false;
          player.vy = -7; // Bounce
          player.ammo = MAX_AMMO; // Reload on stomp
          enemiesKilled++;
        } else if (player.invuln <= 0) {
          // Player takes damage
          lives--;
          player.invuln = 60;
          player.vy = -5; // Knockback
          if (lives <= 0) gameState = 'GAMEOVER';
        }
      }
    }

    // Garbage collect off-screen entities (above the camera)
    platforms = platforms.filter(p => p.y > cameraY - 100);
    enemies = enemies.filter(e => e.active && e.y > cameraY - 100);
    bullets = bullets.filter(b => b.active);

    // Update Score: deeper depth and enemies killed yield points
    maxDepthReached = Math.max(maxDepthReached, player.y);
    score = Math.floor(maxDepthReached / 50) + enemiesKilled * 10;
  }

  // --- Rendering ---
  push();
  translate(0, -cameraY);

  // Walls
  fill(60);
  rect(0, cameraY, 20, 400);
  rect(380, cameraY, 20, 400);

  // Goal Line
  fill(0, 255, 0);
  rect(20, WIN_DEPTH, 360, 60);

  // Platforms
  fill(220); // Off-white
  for (let p of platforms) {
    rect(p.x, p.y, p.w, p.h);
  }

  // Enemies
  fill(255, 40, 40); // Bright Red
  for (let e of enemies) {
    rect(e.x, e.y, e.w, e.h);
  }

  // Bullets
  fill(255, 255, 0); // Bright Yellow
  for (let b of bullets) {
    rect(b.x, b.y, b.w, b.h);
  }

  // Player
  if (gameState !== 'PLAYING' || player.invuln % 10 < 5) {
    fill(50, 150, 255); // Blue
    rect(player.x, player.y, player.w, player.h);
  }

  pop();

  // --- HUD ---
  // Health / Lives
  fill(255, 0, 0);
  for (let i = 0; i < lives; i++) {
    rect(10 + i * 20, 10, 15, 15);
  }

  // Ammo
  fill(255, 255, 0);
  for (let i = 0; i < player.ammo; i++) {
    rect(375 - i * 15, 10, 10, 15);
  }
}

// ============================================================
// REQUIRED: RL interface
// ============================================================

function getGameState() {
  return { score, lives, gameState };
}

function resetGame(seed) {
  rng = mulberry32(seed);
  score = 0;
  lives = 3;
  gameState = 'PLAYING';
  
  // Initialize player near the top center
  player = { 
    x: 188, y: 50, 
    w: 24, h: 24, 
    vx: 0, vy: 0, 
    ammo: MAX_AMMO, 
    cooldown: 0, 
    invuln: 0 
  };
  
  cameraY = 0;
  platforms = [];
  enemies = [];
  bullets = [];
  nextGenY = 200;
  enemiesKilled = 0;
  maxDepthReached = 0;
  
  // Pre-generate initial chunks
  generateEnvironment(cameraY + 500);
}