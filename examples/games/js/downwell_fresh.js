// ============================================================
// REQUIRED: p5.js lifecycle
// ============================================================

function setup() {
  createCanvas(400, 400);
  noStroke();
}

function draw() {
  if (gameState !== 'PLAYING') {
    render();
    return;
  }

  update();
  render();
}

// ============================================================
// REQUIRED: RL interface
// ============================================================

let score = 0;
let lives = 4;
let gameState = 'PLAYING';

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
  lives = 4;
  gameState = 'PLAYING';

  cameraY = -200;
  nextGenY = 300;
  depthScore = 0;
  invulnTimer = 0;

  player = {
    x: 200, y: 100, w: 16, h: 16,
    vx: 0, vy: 0,
    grounded: false, ammo: 8, maxAmmo: 8, cooldown: 0
  };

  platforms = [];
  enemies = [];
  bullets = [];
  gems = [];

  // Starting floor with gaps on both sides
  platforms.push({ x: 140, y: 250, w: 120, h: 20 });
  generateChunks(1000);
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

let player;
let cameraY = 0;
let platforms = [];
let enemies = [];
let bullets = [];
let gems = [];
let nextGenY = 0;
let invulnTimer = 0;
let depthScore = 0;
const MAX_DEPTH = 10000;

function rectIntersect(r1, r2) {
  return !(
    r1.x + r1.w <= r2.x ||
    r1.x >= r2.x + r2.w ||
    r1.y + r1.h <= r2.y ||
    r1.y >= r2.y + r2.h
  );
}

function generateChunks(targetY) {
  while (nextGenY < targetY) {
    nextGenY += 80 + rng() * 60; // Gaps between 80 and 140

    let type = Math.floor(rng() * 4);
    let plats = [];
    
    if (type === 0) {
      // Left side platform
      plats.push({ x: 40, y: nextGenY, w: 100 + rng() * 80, h: 20 });
    } else if (type === 1) {
      // Right side platform
      let w = 100 + rng() * 80;
      plats.push({ x: 360 - w, y: nextGenY, w: w, h: 20 });
    } else if (type === 2) {
      // Two small side platforms
      plats.push({ x: 40, y: nextGenY, w: 80, h: 20 });
      plats.push({ x: 280, y: nextGenY, w: 80, h: 20 });
    } else {
      // Center platform
      plats.push({ x: 120 + rng() * 60, y: nextGenY, w: 100, h: 20 });
    }

    for (let p of plats) {
      platforms.push(p);

      // Spawn entities on platform
      let rand = rng();
      if (rand < 0.20) {
        enemies.push({
          x: p.x + p.w / 2 - 8,
          y: p.y - 16,
          w: 16, h: 16,
          vx: rng() > 0.5 ? 2 : -2,
          type: 'walker',
          plat: p
        });
      } else if (rand < 0.40) {
        enemies.push({
          x: p.x + p.w / 2 - 8,
          y: p.y - 40 - rng() * 30,
          w: 16, h: 16,
          vx: rng() > 0.5 ? 2 : -2,
          type: 'flyer'
        });
      } else if (rand < 0.60) {
        enemies.push({
          x: p.x + p.w / 2 - 8,
          y: p.y - 16,
          w: 16, h: 16,
          vx: rng() > 0.5 ? 1.5 : -1.5,
          vy: 0,
          type: 'hopper',
          plat: p
        });
      } else if (rand < 0.75) {
        enemies.push({
          x: p.x + p.w / 2 - 8,
          y: p.y - 16,
          w: 16, h: 16,
          vx: rng() > 0.5 ? 1 : -1,
          type: 'spiky',
          plat: p
        });
      } else if (rand < 0.85) {
        gems.push({
          x: p.x + p.w / 2 - 6,
          y: p.y - 18,
          w: 12, h: 12
        });
      }
    }
  }
}

function update() {
  // Input - Movement
  if (keyIsDown(37)) player.vx = -4; // LEFT
  else if (keyIsDown(39)) player.vx = 4; // RIGHT
  else player.vx = 0;

  // X Physics
  player.x += player.vx;
  
  // Wall bounds
  if (player.x < 40) player.x = 40;
  if (player.x > 360 - player.w) player.x = 360 - player.w;

  // Platform X collisions
  for (let p of platforms) {
    if (rectIntersect(player, p)) {
      if (player.vx > 0) player.x = p.x - player.w;
      else if (player.vx < 0) player.x = p.x + p.w;
    }
  }

  // Y Physics
  player.vy += 0.4; // Gravity
  if (player.vy > 8) player.vy = 8;
  player.y += player.vy;

  player.grounded = false;
  // Platform Y collisions
  for (let p of platforms) {
    if (rectIntersect(player, p)) {
      if (player.vy > 0) {
        player.y = p.y - player.h;
        player.vy = 0;
        player.grounded = true;
        player.ammo = player.maxAmmo;
      } else if (player.vy < 0) {
        player.y = p.y + p.h;
        player.vy = 0;
      }
    }
  }

  // Input - Jump / Shoot (Action 5 = SPACE = 32)
  if (player.cooldown > 0) player.cooldown--;
  
  if (keyIsDown(32) && player.cooldown === 0) {
    if (player.grounded) {
      player.vy = -8;
      player.grounded = false;
      player.cooldown = 15;
    } else if (player.ammo > 0) {
      player.ammo--;
      player.vy = -3; // Recoil / hover
      player.cooldown = 15;
      bullets.push({
        x: player.x + player.w / 2 - 4,
        y: player.y + player.h,
        w: 8, h: 16, vy: 12
      });
    }
  }

  // Update Bullets
  for (let i = bullets.length - 1; i >= 0; i--) {
    let b = bullets[i];
    b.y += b.vy;

    let hitPlatform = false;
    for (let p of platforms) {
      if (rectIntersect(b, p)) {
        hitPlatform = true; break;
      }
    }

    let hitEnemy = false;
    if (!hitPlatform) {
      for (let j = enemies.length - 1; j >= 0; j--) {
        if (rectIntersect(b, enemies[j])) {
          hitEnemy = true;
          enemies.splice(j, 1);
          score += 10;
          break;
        }
      }
    }

    if (hitPlatform || hitEnemy || b.y > cameraY + 600) {
      bullets.splice(i, 1);
    }
  }

  // Update Enemies
  for (let i = enemies.length - 1; i >= 0; i--) {
    let e = enemies[i];
    
    if (e.type === 'flyer') {
      e.x += e.vx;
      if (e.x < 40 || e.x + e.w > 360) {
        e.vx *= -1;
        e.x += e.vx;
      }
    } else if (e.type === 'hopper') {
      e.x += e.vx;
      e.vy = (e.vy || 0) + 0.3;
      e.y += e.vy;
      if (e.y + e.h >= e.plat.y && e.vy > 0) {
        e.y = e.plat.y - e.h;
        e.vy = -5; // bounce height
      }
      if (e.x < e.plat.x || e.x + e.w > e.plat.x + e.plat.w) {
        e.vx *= -1;
        e.x += e.vx;
      }
    } else {
      // walker and spiky
      e.x += e.vx;
      if (e.x < e.plat.x || e.x + e.w > e.plat.x + e.plat.w) {
        e.vx *= -1;
        e.x += e.vx;
      }
    }

    if (rectIntersect(player, e)) {
      // Stomp check
      if (player.vy > 0 && player.y + player.h - player.vy <= e.y + 6 && e.type !== 'spiky') {
        enemies.splice(i, 1);
        score += 10;
        player.vy = -7; // Stomp bounce
        player.ammo = player.maxAmmo;
      } else {
        // Player hurt
        if (invulnTimer === 0) {
          lives--;
          invulnTimer = 60;
          if (lives <= 0) gameState = 'GAMEOVER';
        }
      }
    }
  }

  if (invulnTimer > 0) invulnTimer--;

  // Update Gems
  for (let i = gems.length - 1; i >= 0; i--) {
    if (rectIntersect(player, gems[i])) {
      gems.splice(i, 1);
      score += 5;
    }
  }

  // Camera and Level Gen
  cameraY = player.y - 200; // Lock camera to player vertically
  
  if (player.y + 800 > nextGenY) {
    generateChunks(player.y + 1600);
  }

  // Depth score calculation
  let currentDepthFloor = Math.floor(player.y / 100);
  if (currentDepthFloor > depthScore && currentDepthFloor > 0) {
    depthScore = currentDepthFloor;
  }

  if (player.y > MAX_DEPTH) {
    gameState = 'WIN';
  }

  // Cleanup off-screen entities (memory management)
  let cullY = cameraY - 400;
  platforms = platforms.filter(p => p.y + p.h > cullY);
  enemies = enemies.filter(e => e.y + e.h > cullY);
  gems = gems.filter(g => g.y + g.h > cullY);
}

function render() {
  background(17, 17, 17); // Dark background

  // Render game elements relative to camera
  push();
  translate(0, -cameraY);

  // Platforms
  fill(170, 170, 170);
  for (let p of platforms) {
    rect(p.x, p.y, p.w, p.h);
  }

  // Gems
  fill(34, 255, 34);
  for (let g of gems) {
    ellipse(g.x + g.w / 2, g.y + g.h / 2, g.w, g.h);
  }

  // Enemies
  for (let e of enemies) {
    if (e.type === 'flyer') {
      fill(255, 80, 80);
      rect(e.x - 4, e.y + 4, 24, 4);
      fill(255, 34, 34);
      rect(e.x, e.y, e.w, e.h);
    } else if (e.type === 'spiky') {
      fill(200, 34, 255);
      triangle(e.x + e.w / 2, e.y, e.x, e.y + e.h, e.x + e.w, e.y + e.h);
    } else if (e.type === 'hopper') {
      fill(255, 150, 34);
      rect(e.x, e.y, e.w, e.h);
    } else {
      fill(255, 34, 34);
      rect(e.x, e.y, e.w, e.h);
    }
  }

  // Bullets
  fill(255, 255, 34);
  for (let b of bullets) {
    rect(b.x, b.y, b.w, b.h);
  }

  // Player (flash if invulnerable)
  if (invulnTimer === 0 || Math.floor(frameCount / 4) % 2 === 0) {
    fill(0, 136, 255);
    rect(player.x, player.y, player.w, player.h);
  }

  pop();

  // Screen-space UI and Borders
  fill(51, 51, 51);
  rect(0, 0, 40, height);       // Left wall border
  rect(360, 0, 40, height);     // Right wall border

  // HUD: Lives (Top Left, drawn over the left wall)
  fill(255, 34, 34);
  for (let i = 0; i < lives; i++) {
    rect(8, 10 + i * 16, 12, 12);
  }

  // HUD: Ammo (Top Right, drawn over the right wall)
  fill(255, 255, 34);
  for (let i = 0; i < player.ammo; i++) {
    rect(380, 10 + i * 12, 12, 8);
  }
}