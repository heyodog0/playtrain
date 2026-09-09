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
    x: 200, y: 100, w: 24, h: 24,
    vx: 0, vy: 0,
    grounded: false, ammo: 8, maxAmmo: 8, cooldown: 0,
    facing: 1, squashT: 0, lastGrounded: false
  };

  platforms = [];
  enemies = [];
  bullets = [];
  gems = [];

  // Starting floor with gaps on both sides
  platforms.push({ x: 140, y: 250, w: 120, h: 30 });
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
    nextGenY += 90 + rng() * 70; // Slightly larger gaps due to bigger platforms

    let type = Math.floor(rng() * 4);
    let plats = [];
    
    if (type === 0) {
      // Left side platform
      plats.push({ x: 40, y: nextGenY, w: 100 + rng() * 80, h: 30 });
    } else if (type === 1) {
      // Right side platform
      let w = 100 + rng() * 80;
      plats.push({ x: 360 - w, y: nextGenY, w: w, h: 30 });
    } else if (type === 2) {
      // Two small side platforms
      plats.push({ x: 40, y: nextGenY, w: 80, h: 30 });
      plats.push({ x: 280, y: nextGenY, w: 80, h: 30 });
    } else {
      // Center platform
      plats.push({ x: 120 + rng() * 60, y: nextGenY, w: 100, h: 30 });
    }

    for (let p of plats) {
      platforms.push(p);

      // Spawn entities on platform
      let rand = rng();
      if (rand < 0.20) {
        enemies.push({
          x: p.x + p.w / 2 - 12,
          y: p.y - 24,
          w: 24, h: 24,
          vx: rng() > 0.5 ? 2 : -2,
          type: 'walker',
          plat: p
        });
      } else if (rand < 0.40) {
        enemies.push({
          x: p.x + p.w / 2 - 12,
          y: p.y - 50 - rng() * 30,
          w: 24, h: 24,
          vx: rng() > 0.5 ? 2 : -2,
          type: 'flyer'
        });
      } else if (rand < 0.60) {
        enemies.push({
          x: p.x + p.w / 2 - 12,
          y: p.y - 24,
          w: 24, h: 24,
          vx: rng() > 0.5 ? 1.5 : -1.5,
          vy: 0,
          type: 'hopper',
          plat: p
        });
      } else if (rand < 0.75) {
        enemies.push({
          x: p.x + p.w / 2 - 12,
          y: p.y - 24,
          w: 24, h: 24,
          vx: rng() > 0.5 ? 1 : -1,
          type: 'spiky',
          plat: p
        });
      } else if (rand < 0.85) {
        gems.push({
          x: p.x + p.w / 2 - 9,
          y: p.y - 28,
          w: 18, h: 18
        });
      }
    }
  }
}

function update() {
  // Input - Movement
  if (keyIsDown(37)) player.vx = -4.5; // LEFT
  else if (keyIsDown(39)) player.vx = 4.5; // RIGHT
  else player.vx = 0;

  if (player.vx > 0) player.facing = 1;
  else if (player.vx < 0) player.facing = -1;

  if (player.squashT > 0) player.squashT--;

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

  let fellV = player.vy;

  // Y Physics
  player.vy += 0.4; // Gravity
  if (player.vy > 8) player.vy = 8;
  player.y += player.vy;

  player.lastGrounded = player.grounded;
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

  if (!player.lastGrounded && player.grounded && fellV > 2) {
    player.squashT = 6;
  }

  // Input - Jump / Shoot (Action 5 = SPACE = 32)
  if (player.cooldown > 0) player.cooldown--;
  
  if (keyIsDown(32) && player.cooldown === 0) {
    if (player.grounded) {
      player.vy = -8.5;
      player.grounded = false;
      player.squashT = 0; // Clear squash to immediately stretch
      player.cooldown = 15;
    } else if (player.ammo > 0) {
      player.ammo--;
      player.vy = -3; // Recoil / hover
      player.cooldown = 15;
      bullets.push({
        x: player.x + player.w / 2 - 6,
        y: player.y + player.h,
        w: 12, h: 24, vy: 12
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
        e.vy = -6; // bounce height
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
      if (player.vy > 0 && player.y + player.h - player.vy <= e.y + 10 && e.type !== 'spiky') {
        enemies.splice(i, 1);
        score += 10;
        player.vy = -7.5; // Stomp bounce
        player.squashT = 0; // Clear squash on stomp jump
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
  background(12, 14, 18); // Darker slate background for better contrast

  // Parallax Background Layer 1 (Far - Slow dots)
  fill(20, 23, 28);
  let bgMod1 = (-cameraY * 0.3) % 60;
  if (bgMod1 < 0) bgMod1 += 60;
  for (let y = bgMod1 - 60; y < height + 60; y += 60) {
    for (let x = 60; x < 360; x += 60) {
      // Use absolute world Y for consistent row alternating
      let rowIdx = Math.round((y + cameraY * 0.3) / 60);
      let xOffset = (Math.abs(rowIdx) % 2 === 0) ? 30 : 0;
      ellipse(x + xOffset, y, 6, 6);
    }
  }

  // Parallax Background Layer 2 (Mid - Medium vertical dashes)
  fill(26, 30, 36);
  let bgMod2 = (-cameraY * 0.6) % 140;
  if (bgMod2 < 0) bgMod2 += 140;
  for (let y = bgMod2 - 140; y < height + 140; y += 140) {
    for (let x = 70; x < 330; x += 100) {
      // Use absolute world Y for consistent row alternating
      let rowIdx = Math.round((y + cameraY * 0.6) / 140);
      let xOffset = (Math.abs(rowIdx) % 2 === 0) ? 50 : 0;
      rect(x + xOffset, y, 4, 32, 2);
    }
  }

  // Render game elements relative to camera
  push();
  translate(0, -cameraY);

  // Platforms
  for (let p of platforms) {
    // Platform thickness
    fill(80, 85, 95);
    rect(p.x, p.y + 9, p.w, p.h, 6);
    
    // Platform top
    fill(160, 165, 175);
    rect(p.x, p.y, p.w, p.h, 6);
    
    // Platform highlight
    fill(200, 205, 215);
    rect(p.x + 3, p.y + 3, p.w - 6, p.h / 3, 3);
    
    // Platform brick details
    fill(130, 135, 145);
    rect(p.x + p.w * 0.2, p.y, 6, p.h);
    rect(p.x + p.w * 0.7, p.y, 6, p.h);
  }

  // Gems
  for (let g of gems) {
    let gw = g.w, gh = g.h;
    let pulse = Math.sin(frameCount * 0.1) * 2;
    
    // Shadow
    fill(20, 120, 40);
    rect(g.x, g.y + 6 + pulse, gw, gh, 6);
    
    // Top
    fill(50, 220, 80);
    rect(g.x, g.y + pulse, gw, gh, 6);
    
    // Highlight
    fill(180, 255, 200);
    rect(g.x + gw * 0.2, g.y + gh * 0.2 + pulse, gw * 0.6, gh * 0.4, 3);
  }

  // Enemies
  for (let e of enemies) {
    if (e.type === 'flyer') {
      let flap = Math.sin(frameCount * 0.3) * 6;
      // Wings Shadow
      fill(140, 30, 30);
      rect(e.x - 9, e.y + 12 - flap, e.w + 18, 9, 3);
      // Wings Top
      fill(230, 60, 60);
      rect(e.x - 9, e.y + 6 - flap, e.w + 18, 9, 3);
      
      // Body Shadow
      fill(120, 20, 20);
      rect(e.x, e.y + 6, e.w, e.h, 6);
      // Body Top
      fill(220, 40, 40);
      rect(e.x, e.y, e.w, e.h, 6);
      
      // Face / Eyes
      fill(255);
      rect(e.x + e.w * 0.1, e.y + e.h * 0.2, e.w * 0.3, e.h * 0.3, 2);
      rect(e.x + e.w * 0.6, e.y + e.h * 0.2, e.w * 0.3, e.h * 0.3, 2);
      fill(0);
      rect(e.x + e.w * 0.2, e.y + e.h * 0.3, e.w * 0.1, e.h * 0.1);
      rect(e.x + e.w * 0.7, e.y + e.h * 0.3, e.w * 0.1, e.h * 0.1);

    } else if (e.type === 'spiky') {
      // Body Shadow
      fill(120, 20, 160);
      rect(e.x, e.y + e.h - 6, e.w, 12, 3);
      // Body Base
      fill(180, 40, 220);
      rect(e.x, e.y + e.h - 12, e.w, 12, 3);
      
      // Spike Shadow
      fill(100, 20, 140);
      triangle(e.x + e.w / 2, e.y + 6, e.x, e.y + e.h - 6, e.x + e.w, e.y + e.h - 6);
      // Spike Top
      fill(210, 80, 240);
      triangle(e.x + e.w / 2, e.y, e.x + 3, e.y + e.h - 6, e.x + e.w - 3, e.y + e.h - 6);
      
      // Eye
      fill(255);
      rect(e.x + e.w / 2 - 6, e.y + e.h / 2, 12, 9, 3);
      fill(0);
      rect(e.x + e.w / 2 - 3, e.y + e.h / 2 + 3, 6, 6);

    } else if (e.type === 'hopper') {
      // Shadow
      fill(180, 90, 20);
      rect(e.x, e.y + 6, e.w, e.h, 6);
      // Body
      fill(240, 140, 30);
      rect(e.x, e.y, e.w, e.h, 6);
      // Highlight
      fill(255, 180, 60);
      rect(e.x + 3, e.y + 3, e.w - 6, e.h / 3, 3);
      
      // Frog Eyes
      fill(255);
      rect(e.x - 3, e.y - 6, 12, 12, 3);
      rect(e.x + e.w - 9, e.y - 6, 12, 12, 3);
      fill(0);
      rect(e.x + 1, e.y - 2, 4, 4);
      rect(e.x + e.w - 5, e.y - 2, 4, 4);

    } else {
      // Default Walker
      fill(140, 20, 20);
      rect(e.x, e.y + 6, e.w, e.h, 4);
      fill(220, 40, 40);
      rect(e.x, e.y, e.w, e.h, 4);
      
      fill(255);
      rect(e.x + e.w * 0.15, e.y + e.h * 0.25, 8, 8, 3);
      rect(e.x + e.w - e.w * 0.15 - 8, e.y + e.h * 0.25, 8, 8, 3);
      fill(0);
      rect(e.x + e.w * 0.25, e.y + e.h * 0.35, 4, 4);
      rect(e.x + e.w - e.w * 0.15 - 4, e.y + e.h * 0.35, 4, 4);
    }
  }

  // Bullets
  for (let b of bullets) {
    fill(180, 180, 20);
    rect(b.x, b.y + 3, b.w, b.h, 3);
    fill(255, 255, 40);
    rect(b.x, b.y, b.w, b.h, 3);
    fill(255, 255, 180);
    rect(b.x + 2, b.y + 2, b.w - 4, b.h * 0.5, 2);
  }

  // Player (flash if invulnerable)
  if (invulnTimer === 0 || Math.floor(frameCount / 4) % 2 === 0) {
    let px = player.x, py = player.y, pw = player.w, ph = player.h;
    let dir = player.facing;
    let airborne = !player.grounded;

    // Squash and stretch
    let sw = 1, sh = 1;
    if (player.squashT > 0) {
      let t = player.squashT / 6;
      sw = 1 + 0.4 * t;
      sh = 1 - 0.32 * t;
    } else if (airborne) {
      sw = 0.92;
      sh = 1.1;
    }

    let nw = pw * sw;
    let nh = ph * sh;
    let drawX = px + (pw - nw) / 2;
    let drawY = py + (ph - nh);

    // Run cycle phase
    let phase = 0;
    if (!airborne && Math.abs(player.vx) > 0.1) {
      phase = Math.floor(frameCount / 5) % 2 === 0 ? 1 : -1;
    }

    // BOOTS & GUNS computations
    let legW = nw * 0.4;
    let legH = 12 * sh;
    let leftLegY = drawY + nh - 8 * sh;
    let rightLegY = drawY + nh - 8 * sh;
    let leftLegX = drawX;
    let rightLegX = drawX + nw * 0.6;
    
    if (airborne) {
       leftLegY -= 4;
       rightLegY -= 4;
       leftLegX += dir * 2;
       rightLegX += dir * 2;
    } else if (phase !== 0) {
       leftLegY -= (phase === 1 ? 3 : 0);
       rightLegY -= (phase === -1 ? 3 : 0);
       leftLegX += phase * 2 * dir;
       rightLegX -= phase * 2 * dir;
    }

    let recoil = (player.cooldown > 10 && airborne) ? 4 : 0;

    // Back arm (drawn behind body)
    if (phase !== 0) {
      fill(0, 70, 150);
      rect(drawX + nw * 0.5 - dir * phase * 4 - 3, drawY + nh * 0.35, 6, 10, 3);
    } else if (airborne) {
      fill(0, 70, 150);
      rect(drawX + nw * 0.5 - 3, drawY + nh * 0.2, 6, 10, 3);
    }

    // Draw Boots behind body bounds (but body has shadow, so boots act as background layer for legs)
    fill(40, 40, 45);
    rect(leftLegX, leftLegY, legW, legH, 3);
    rect(rightLegX, rightLegY, legW, legH, 3);

    // Gun-barrel tips
    fill(150, 150, 160);
    rect(leftLegX + legW * 0.25, leftLegY + legH - 2 + recoil, legW * 0.5, 6);
    rect(rightLegX + legW * 0.25, rightLegY + legH - 2 + recoil, legW * 0.5, 6);

    // Body shadow
    fill(0, 90, 180);
    rect(drawX, drawY + 6 * sh, nw, nh - 8 * sh, 6);
    
    // Body top
    fill(30, 150, 255);
    rect(drawX, drawY, nw, nh - 8 * sh, 6);
    
    // Suit Highlight
    fill(120, 200, 255);
    rect(drawX + 3, drawY + 3, nw - 6, (nh - 8 * sh) * 0.3, 3);

    // Front arm (drawn in front of body)
    if (phase !== 0) {
      fill(30, 150, 255);
      rect(drawX + nw * 0.5 + dir * phase * 4 - 3, drawY + nh * 0.35, 6, 10, 3);
    } else if (!airborne) {
      fill(30, 150, 255);
      rect(drawX + nw * 0.5 - 3, drawY + nh * 0.4, 6, 10, 3);
    } else {
      fill(30, 150, 255);
      rect(drawX + nw * 0.5 - 3, drawY + nh * 0.2, 6, 10, 3);
    }

    // Visor / Face
    fill(255);
    let visorX = drawX + nw * 0.1 + (dir === 1 ? nw * 0.1 : (dir === -1 ? -nw * 0.1 : 0));
    rect(visorX, drawY + nh * 0.2, nw * 0.8, nh * 0.3, 3);
    
    // Eyes directional logic
    fill(20, 20, 30);
    if (dir === 1) {
      rect(visorX + nw * 0.25, drawY + nh * 0.25, nw * 0.15, nh * 0.15);
      rect(visorX + nw * 0.6, drawY + nh * 0.25, nw * 0.15, nh * 0.15);
    } else if (dir === -1) {
      rect(visorX + nw * 0.05, drawY + nh * 0.25, nw * 0.15, nh * 0.15);
      rect(visorX + nw * 0.4, drawY + nh * 0.25, nw * 0.15, nh * 0.15);
    } else {
      rect(visorX + nw * 0.15, drawY + nh * 0.25, nw * 0.15, nh * 0.15);
      rect(visorX + nw * 0.5, drawY + nh * 0.25, nw * 0.15, nh * 0.15);
    }
  }

  pop();

  // Screen-space UI and Borders
  
  // Left wall base
  fill(30, 30, 35);
  rect(0, 0, 40, height);
  fill(60, 60, 65);
  rect(0, 0, 35, height);
  fill(80, 80, 85);
  rect(0, 0, 10, height);

  // Right wall base
  fill(30, 30, 35);
  rect(360, 0, 40, height);
  fill(60, 60, 65);
  rect(365, 0, 35, height);
  fill(80, 80, 85);
  rect(390, 0, 10, height);

  // Wall panning textures (bricks)
  fill(40, 40, 45);
  let wallMod = (-cameraY) % 60;
  if (wallMod < 0) wallMod += 60;
  
  for (let y = wallMod - 60; y < height + 60; y += 60) {
    // Left bricks
    rect(0, y, 35, 6);
    rect(15, y + 30, 20, 6);
    // Right bricks
    rect(365, y, 35, 6);
    rect(365, y + 30, 20, 6);
  }

  // HUD: Lives (Top Left, drawn over the left wall)
  for (let i = 0; i < lives; i++) {
    // Shadow
    fill(150, 20, 20);
    rect(9, 15 + i * 24, 18, 18, 3);
    // Top
    fill(255, 34, 34);
    rect(9, 10 + i * 24, 18, 18, 3);
    // Highlight
    fill(255, 100, 100);
    rect(12, 13 + i * 24, 6, 6, 2);
  }

  // HUD: Ammo (Top Right, drawn over the right wall)
  for (let i = 0; i < player.ammo; i++) {
    // Shadow
    fill(150, 150, 20);
    rect(371, 15 + i * 18, 18, 12, 3);
    // Top
    fill(255, 255, 34);
    rect(371, 10 + i * 18, 18, 12, 3);
    // Highlight
    fill(255, 255, 150);
    rect(374, 13 + i * 18, 6, 3, 1);
  }
}