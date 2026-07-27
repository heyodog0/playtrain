// ============================================================
// REQUIRED: p5.js lifecycle
// ============================================================

let rng = null;
let score = 0;
let lives = 1;
let gameState = 'PLAYING';

// Game-specific globals
let platforms = [];
let player = {};
let cameraY = 0;
let maxReachedY = 0;

function setup() {
  createCanvas(400, 400);
}

function draw() {
  if (gameState !== 'PLAYING') return;

  updatePlayer();
  updateCamera();

  // Score update: reward for reaching new heights
  if (player.y < maxReachedY) {
    score += (maxReachedY - player.y);
    maxReachedY = player.y;
  }

  // Render
  background(20);
  
  push();
  translate(0, -cameraY);

  // Draw platforms
  noStroke();
  for (let p of platforms) {
    // Basic view frustum culling
    if (p.y + p.h > cameraY && p.y < cameraY + height) {
      if (p.type === 'goal') {
        fill(255, 215, 0); // Gold
      } else {
        fill(34, 139, 34); // Forest Green
      }
      rect(p.x, p.y, p.w, p.h);
    }
  }

  stroke(0);
  strokeWeight(1);
  // Draw player
  let chargeRatio = player.charge / 25; // Max charge is 25
  let c1 = color(30, 144, 255); // Blue (Idle)
  let c2 = color(255, 69, 0);   // Red (Charged)
  fill(lerpColor(c1, c2, chargeRatio));
  rect(player.x, player.y, player.w, player.h);

  // Charge indicator bar
  if (player.state === 1) {
    fill(255, 0, 0);
    noStroke();
    rect(player.x, player.y - 8, player.w * chargeRatio, 4);
  }

  pop();

  // HUD: Progress bar on the right edge
  noStroke();
  fill(50);
  rect(width - 8, 0, 8, height);
  fill(0, 255, 0);
  let totalDist = 400 - (-3100);
  let currentDist = 400 - maxReachedY;
  let progress = Math.max(0, Math.min(1, currentDist / totalDist));
  let pHeight = progress * height;
  rect(width - 8, height - pHeight, 8, pHeight);
}

function updatePlayer() {
  const GRAVITY = 0.5;
  const MAX_CHARGE = 25;
  const CHARGE_RATE = 1;
  const WALK_SPEED = 2;

  // Input Handling & State Machine
  if (player.state === 0) { // Idle on ground
    if (keyIsDown(32)) {
      player.state = 1;
      player.charge = 0;
    } else {
      if (keyIsDown(37)) player.x -= WALK_SPEED;
      if (keyIsDown(39)) player.x += WALK_SPEED;
      
      // Keep in bounds
      if (player.x < 0) player.x = 0;
      if (player.x > width - 8 - player.w) player.x = width - 8 - player.w;
    }
  } 
  else if (player.state === 1) { // Charging
    if (keyIsDown(37)) player.jumpDir = -1;
    else if (keyIsDown(39)) player.jumpDir = 1;
    else player.jumpDir = 0;

    if (keyIsDown(32)) {
      player.charge += CHARGE_RATE;
      if (player.charge >= MAX_CHARGE) {
        doJump(); // Auto-jump if max charge reached
      }
    } else {
      doJump(); // Jump on release
    }
  } 
  else if (player.state === 2) { // Airborne
    player.vy += GRAVITY; // No air control, just gravity
  }

  // Continuous Collision Detection using Substeps
  let steps = Math.ceil(Math.max(Math.abs(player.vx), Math.abs(player.vy)) / 5);
  steps = Math.max(1, steps);
  let svx = player.vx / steps;
  let svy = player.vy / steps;

  for (let s = 0; s < steps; s++) {
    // X-Axis Resolution
    player.x += svx;
    
    // Screen bounds bounce
    if (player.x < 0) { 
      player.x = 0; 
      player.vx *= -1; 
      svx *= -1; 
    }
    if (player.x + player.w > width - 8) { // -8 avoids UI bar
      player.x = width - 8 - player.w; 
      player.vx *= -1; 
      svx *= -1; 
    }

    // Platform X bounce
    for (let p of platforms) {
      if (overlap(player, p)) {
        if (svx > 0) player.x = p.x - player.w;
        else player.x = p.x + p.w;
        player.vx *= -1; 
        svx *= -1;
      }
    }

    // Y-Axis Resolution
    player.y += svy;
    
    // Floor collision
    if (player.y + player.h > 400) {
      player.y = 400 - player.h;
      player.vy = 0;
      svy = 0;
    }

    // Platform Y collision
    for (let p of platforms) {
      if (overlap(player, p)) {
        if (svy > 0) { // Landing
          player.y = p.y - player.h;
          player.vy = 0;
          svy = 0;
          if (p.type === 'goal') gameState = 'WIN';
        } else if (svy < 0) { // Bonking head
          player.y = p.y + p.h;
          player.vy = 0;
          svy = 0;
        }
      }
    }
  }

  // Ground Support Check (in case walked off edge)
  let supported = false;
  if (player.y + player.h >= 400) {
    supported = true;
  } else {
    player.y += 1;
    for (let p of platforms) {
      if (overlap(player, p)) {
        supported = true;
        break;
      }
    }
    player.y -= 1;
  }

  // Update states based on support
  if (supported) {
    if (player.state === 2) {
      player.state = 0;
      player.vx = 0; // Friction
    }
  } else {
    if (player.state !== 2) {
      player.state = 2; // Fell off
      player.charge = 0;
    }
  }
}

function doJump() {
  let p = player.charge / 25; // 0.0 to 1.0
  player.vy = -(6 + p * 9); // -6 to -15
  player.vx = player.jumpDir * (3 + p * 3); // 3 to 6
  player.state = 2;
  player.charge = 0;
}

function updateCamera() {
  let targetCameraY = player.y - height * 0.7; // Keep player in lower third
  cameraY += (targetCameraY - cameraY) * 0.1;
  if (cameraY > 0) cameraY = 0; // Don't scroll below bottom
  cameraY = Math.floor(cameraY); // Prevent sub-pixel rendering blur
}

function overlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
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
  lives = 1;
  gameState = 'PLAYING';
  platforms = [];

  // Generate Procedural Vertical Level
  let currentY = 350; // Floor is at 400
  let platW = 120;
  let platX = (width - 8) / 2 - platW / 2;
  platforms.push({x: platX, y: currentY, w: platW, h: 20, type: 'normal'});

  while (currentY > -3000) {
    // Gap vertically
    let vGap = rng() * 40 + 60; 
    currentY -= vGap; 
    
    // Width and position logic ensuring no direct vertical overlap
    let pW = rng() * 40 + 60;
    let prevCenterX = platX + platW / 2;
    
    let offset = rng() * 60 + 60; 
    let direction = rng() < 0.5 ? -1 : 1;
    
    if (prevCenterX - offset - pW / 2 < 0) direction = 1;
    if (prevCenterX + offset + pW / 2 > width - 8) direction = -1;
    
    let newCenterX = prevCenterX + direction * offset;
    platX = newCenterX - pW / 2;
    
    platX = Math.max(0, Math.min(width - 8 - pW, platX));
    platW = pW;
    
    platforms.push({x: platX, y: currentY, w: platW, h: 15, type: 'normal'});

    // Extra platforms for horizontal mechanics
    if (rng() < 0.4) {
      let extraW = rng() * 30 + 40;
      let extraX = -1;
      if (platX > width / 2) {
         let space = platX - 20 - extraW;
         if (space > 0) extraX = rng() * space;
      } else {
         let space = (width - 8) - (platX + platW + 20) - extraW;
         if (space > 0) extraX = platX + platW + 20 + rng() * space;
      }
      
      if (extraX !== -1) {
        platforms.push({x: extraX, y: currentY + (rng() * 40 - 20), w: extraW, h: 15, type: 'normal'});
      }
    }
  }
  
  // Goal platform at the very top
  currentY -= 100;
  platforms.push({x: 0, y: currentY, w: width - 8, h: 20, type: 'goal'});

  // Initialize Player
  player = {
    x: (width - 8) / 2 - 8,
    y: 350 - 16,
    w: 16, h: 16,
    vx: 0, vy: 0,
    state: 0, // 0: Idle, 1: Charging, 2: Air
    charge: 0,
    jumpDir: 0
  };

  cameraY = 0;
  maxReachedY = player.y;
}

// ============================================================
// REQUIRED: seeded RNG
// ============================================================
function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let n = Math.imul(t ^ (t >>> 15), t | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}