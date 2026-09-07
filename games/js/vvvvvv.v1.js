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
// GAME GLOBALS
// ============================================================

let score, lives, gameState;
let player, blocks, hazards, coins, goal, checkpoints;
let maxReachedX, prevSpace, cameraX, levelLength;
let spawnX, spawnY, spawnGravity;
let particles = [];
let themes = [
  [0, 255, 255],
  [255, 0, 100],
  [100, 255, 0],
  [255, 200, 0],
  [200, 100, 255]
];
let themeColor;
let bgColor = [10, 10, 20];

// ============================================================
// REQUIRED: p5.js lifecycle
// ============================================================

function setup() {
  createCanvas(400, 400);
  noSmooth();
  textFont('monospace');
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
  lives = 5;
  gameState = 'PLAYING';
  levelLength = 4000;
  prevSpace = false;
  maxReachedX = 100;

  spawnX = 100;
  spawnY = 200;
  spawnGravity = 1;

  player = { 
    x: 100, y: 200, 
    w: 20, h: 28, 
    vx: 0, vy: 0, 
    gravityDir: 1, 
    onGround: false 
  };
  
  blocks = [];
  hazards = [];
  coins = [];
  checkpoints = [];
  particles = [];
  
  themeColor = themes[Math.floor(rng() * themes.length)];

  // Generate static bounds (ceiling, floor, and left wall)
  blocks.push({x: -100, y: 0, w: levelLength + 500, h: 40});
  blocks.push({x: -100, y: 360, w: levelLength + 500, h: 40});
  blocks.push({x: -100, y: 40, w: 100, h: 320});

  // Procedural obstacle generation
  let cursorX = 300;
  let lastCheckpointX = 0;
  
  while (cursorX < levelLength - 300) {
    // Generate Checkpoints
    if (cursorX - lastCheckpointX > 800) {
      checkpoints.push({x: cursorX, y: 160, w: 40, h: 40, active: true});
      lastCheckpointX = cursorX;
      cursorX += 150; // Ensure a safe gap around checkpoints
    }

    let type = Math.floor(rng() * 6);
    let w = 60 + rng() * 80;
    w = Math.max(40, Math.floor(w / 20) * 20); // Align for spikes

    if (type === 0) {
      // Spikes on floor
      hazards.push({x: cursorX, y: 360 - 30, w: w, h: 30, hType: 'floor'});
      coins.push({x: cursorX + w/2 - 12, y: 100, w: 24, h: 24, active: true});
    } else if (type === 1) {
      // Spikes on ceiling
      hazards.push({x: cursorX, y: 40, w: w, h: 30, hType: 'ceiling'});
      coins.push({x: cursorX + w/2 - 12, y: 260, w: 24, h: 24, active: true});
    } else if (type === 2) {
      // Wall resting on floor
      blocks.push({x: cursorX, y: 220, w: w, h: 140});
      coins.push({x: cursorX + w/2 - 12, y: 140, w: 24, h: 24, active: true});
    } else if (type === 3) {
      // Wall attached to ceiling
      blocks.push({x: cursorX, y: 40, w: w, h: 140});
      coins.push({x: cursorX + w/2 - 12, y: 240, w: 24, h: 24, active: true});
    } else if (type === 4) {
      // Floating block
      blocks.push({x: cursorX, y: 160, w: w, h: 80});
      coins.push({x: cursorX + w/2 - 12, y: 80, w: 24, h: 24, active: true});
      coins.push({x: cursorX + w/2 - 12, y: 280, w: 24, h: 24, active: true});
    } else if (type === 5) {
      // Spikes on both floor and ceiling
      hazards.push({x: cursorX, y: 360 - 30, w: w, h: 30, hType: 'floor'});
      hazards.push({x: cursorX, y: 40, w: w, h: 30, hType: 'ceiling'});
      coins.push({x: cursorX + w/2 - 12, y: 200 - 12, w: 24, h: 24, active: true});
    }
    
    // Ensure safe gap between obstacles
    cursorX += w + 140 + rng() * 60;
  }

  goal = {x: levelLength, y: 40, w: 100, h: 320};
  cameraX = 0;
}

// ============================================================
// GAME LOGIC
// ============================================================

function rectIntersect(a, b) {
  return a.x < b.x + b.w && 
         a.x + a.w > b.x && 
         a.y < b.y + b.h && 
         a.y + a.h > b.y;
}

function createParticles(x, y, colorArr) {
  for (let i = 0; i < 15; i++) {
    particles.push({
      x: x, y: y,
      vx: (rng() - 0.5) * 10,
      vy: (rng() - 0.5) * 10,
      life: 20 + rng() * 20,
      c: colorArr
    });
  }
}

function die() {
  lives--;
  score = Math.max(0, score - 20);
  createParticles(player.x + player.w/2, player.y + player.h/2, [0, 255, 255]);
  
  if (lives <= 0) {
    gameState = 'GAMEOVER';
  } else {
    player.x = spawnX;
    player.y = spawnY;
    player.vx = 0;
    player.vy = 0;
    player.gravityDir = spawnGravity;
  }
}

function updateLogic() {
  // Horizontal movement
  player.vx = 0;
  if (keyIsDown(37)) player.vx = -5; // LEFT
  if (keyIsDown(39)) player.vx = 5;  // RIGHT

  // Gravity flip mechanic
  let currentSpace = keyIsDown(32); // SPACE (D Action)
  if (currentSpace && !prevSpace && player.onGround) {
    player.gravityDir *= -1;
    player.vy = 0;
  }
  prevSpace = currentSpace;

  // Apply gravity
  player.vy += player.gravityDir * 0.8;
  if (player.vy > 10) player.vy = 10;
  if (player.vy < -10) player.vy = -10;

  // X Axis Physics & Collision
  player.x += player.vx;
  for (let b of blocks) {
    if (rectIntersect(player, b)) {
      if (player.vx > 0) player.x = b.x - player.w;
      else if (player.vx < 0) player.x = b.x + b.w;
      player.vx = 0;
    }
  }

  // Prevent moving backward past start bounds
  if (player.x < 0) player.x = 0;

  // Y Axis Physics & Collision
  player.y += player.vy;
  player.onGround = false;
  
  for (let b of blocks) {
    if (rectIntersect(player, b)) {
      if (player.vy > 0) {
        player.y = b.y - player.h;
        if (player.gravityDir === 1) player.onGround = true;
      } else if (player.vy < 0) {
        player.y = b.y + b.h;
        if (player.gravityDir === -1) player.onGround = true;
      }
      player.vy = 0;
    }
  }

  if (player.x > maxReachedX) {
    maxReachedX = player.x;
  }

  // Smooth camera following
  cameraX = player.x - 150;
  if (cameraX < 0) cameraX = 0;
  if (cameraX > levelLength - 400 + 100) cameraX = levelLength - 400 + 100;

  // Check Checkpoints
  for (let cp of checkpoints) {
    if (cp.active && rectIntersect(player, cp)) {
      cp.active = false;
      spawnX = cp.x;
      spawnY = 200;
      spawnGravity = player.gravityDir;
      createParticles(cp.x + cp.w/2, cp.y + cp.h/2, [0, 255, 0]);
    }
  }

  // Check Hazards
  for (let h of hazards) {
    if (rectIntersect(player, h)) {
      die();
      return;
    }
  }

  // Check Collectibles
  for (let c of coins) {
    if (c.active && rectIntersect(player, c)) {
      c.active = false;
      score += 50;
      createParticles(c.x + c.w/2, c.y + c.h/2, [255, 255, 0]);
    }
  }

  // Check Win Condition
  if (rectIntersect(player, goal)) {
    gameState = 'WIN';
  }
}

// ============================================================
// RENDERING
// ============================================================

function drawBackground() {
  background(bgColor[0], bgColor[1], bgColor[2]);
  
  // Retro moving grid
  stroke(themeColor[0]*0.2, themeColor[1]*0.2, themeColor[2]*0.2);
  strokeWeight(2);
  let offsetX = (cameraX * 0.5) % 50;
  for (let x = -offsetX; x < width; x += 50) {
    line(x, 0, x, height);
  }
  let offsetY = (frameCount * 0.5) % 50;
  for (let y = -offsetY; y < height; y += 50) {
    line(0, y, width, y);
  }
}

function drawBlocks() {
  stroke(themeColor[0], themeColor[1], themeColor[2]);
  strokeWeight(3);
  fill(0);
  for (let b of blocks) {
    rect(b.x, b.y, b.w, b.h);
    stroke(themeColor[0]*0.5, themeColor[1]*0.5, themeColor[2]*0.5);
    strokeWeight(1);
    rect(b.x + 6, b.y + 6, b.w - 12, b.h - 12);
    stroke(themeColor[0], themeColor[1], themeColor[2]);
    strokeWeight(3);
  }
}

function drawHazards() {
  fill(255, 0, 50);
  stroke(255, 100, 100);
  strokeWeight(2);
  for (let h of hazards) {
    let spikeW = 20;
    let numSpikes = Math.floor(h.w / spikeW);
    let actualW = numSpikes * spikeW;
    let startX = h.x + (h.w - actualW) / 2;
    
    for (let i = 0; i < numSpikes; i++) {
      let sx = startX + i * spikeW;
      if (h.hType === 'floor') {
        triangle(sx, h.y + h.h, sx + spikeW/2, h.y, sx + spikeW, h.y + h.h);
      } else {
        triangle(sx, h.y, sx + spikeW/2, h.y + h.h, sx + spikeW, h.y);
      }
    }
  }
}

function drawCheckpoints() {
  for (let cp of checkpoints) {
    push();
    translate(cp.x + cp.w/2, cp.y + cp.h/2);
    if (cp.active) {
      stroke(100);
      fill(50);
    } else {
      stroke(0, 255, 0);
      fill(0, 100, 0);
    }
    strokeWeight(2);
    rect(-cp.w/2, -cp.h/2, cp.w, cp.h);
    
    fill(255);
    noStroke();
    textAlign(CENTER, CENTER);
    textSize(24);
    text("C", 0, 0);
    pop();
  }
}

function drawTrinkets() {
  for (let c of coins) {
    if (c.active) {
      push();
      translate(c.x + c.w/2, c.y + c.h/2);
      rotate(frameCount * 0.05);
      stroke(200, 255, 255);
      strokeWeight(2);
      fill(0, 150, 255);
      quad(0, -c.h/2, c.w/2, 0, 0, c.h/2, -c.w/2, 0);
      noStroke();
      fill(255);
      quad(0, -c.h/4, c.w/4, 0, 0, c.h/4, -c.w/4, 0);
      pop();
    }
  }
}

function drawGoal() {
  push();
  translate(goal.x, goal.y);
  fill(0, 255, 0, 50);
  stroke(0, 255, 0);
  strokeWeight(4);
  rect(0, 0, goal.w, goal.h);
  
  let pulse = 10 + Math.sin(frameCount * 0.1) * 10;
  strokeWeight(2);
  rect(pulse, pulse, goal.w - pulse*2, goal.h - pulse*2);
  
  fill(255);
  noStroke();
  textSize(24);
  textAlign(CENTER, CENTER);
  push();
  translate(goal.w/2, goal.h/2);
  rotate(-Math.PI/2);
  text("RESCUE", 0, 0);
  pop();
  pop();
}

function drawPlayer() {
  push();
  translate(player.x + player.w/2, player.y + player.h/2);
  if (player.gravityDir === -1) {
    scale(1, -1);
  }
  
  fill(0, 255, 255);
  noStroke();
  
  // Body
  rect(-10, -10, 20, 20);
  
  // Eyes
  fill(bgColor[0], bgColor[1], bgColor[2]);
  rect(-6, -6, 4, 4);
  rect(2, -6, 4, 4);
  
  // Legs
  fill(0, 255, 255);
  let legAnim = (Math.abs(player.vx) > 0) ? Math.floor(Math.sin(frameCount * 0.5) * 3) : 0;
  rect(-8, 10, 6, 4 + legAnim);
  rect(2, 10, 6, 4 - legAnim);
  
  pop();
}

function updateAndDrawParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    let p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life--;
    
    noStroke();
    fill(p.c[0], p.c[1], p.c[2], Math.max(0, (p.life / 40) * 255));
    rect(p.x, p.y, 6, 6);
    
    if (p.life <= 0) {
      particles.splice(i, 1);
    }
  }
}

function drawHUD() {
  fill(10, 15, 30, 230);
  noStroke();
  rect(0, 0, width, 40);
  
  stroke(themeColor[0], themeColor[1], themeColor[2]);
  strokeWeight(2);
  line(0, 40, width, 40);
  
  noStroke();
  fill(255);
  textSize(14);
  textAlign(LEFT, CENTER);
  text("ENERGY", 10, 20);
  
  for (let i = 0; i < 5; i++) {
    if (i < lives) {
      fill(255, 50, 50);
      stroke(255, 100, 100);
    } else {
      fill(50, 10, 10);
      stroke(30, 0, 0);
    }
    strokeWeight(2);
    rect(70 + i * 18, 10, 12, 20);
  }
  
  let pX = 180;
  let pW = 100;
  fill(50);
  noStroke();
  rect(pX, 15, pW, 10);
  fill(themeColor[0], themeColor[1], themeColor[2]);
  rect(pX, 15, (maxReachedX / levelLength) * pW, 10);
  
  fill(255);
  noStroke();
  textSize(16);
  textAlign(RIGHT, CENTER);
  text("TRINKETS:" + (score/50), width - 10, 20);
}

function drawOverlay(title, subtitle) {
  fill(0, 0, 0, 150);
  noStroke();
  rect(0, 0, width, height);
  
  fill(themeColor[0], themeColor[1], themeColor[2]);
  textAlign(CENTER, CENTER);
  textSize(40);
  text(title, width/2, height/2 - 20);
  
  fill(255);
  textSize(20);
  text(subtitle, width/2, height/2 + 30);
}

function draw() {
  if (gameState === 'PLAYING') {
    updateLogic();
  }

  drawBackground();
  
  push();
  translate(-cameraX, 0);
  
  drawBlocks();
  drawHazards();
  drawCheckpoints();
  drawTrinkets();
  drawGoal();
  drawPlayer();
  updateAndDrawParticles();
  
  pop();
  
  drawHUD();
  
  // CRT Scanlines Overlay
  fill(0, 0, 0, 40);
  noStroke();
  for (let y = 0; y < height; y += 4) {
    rect(0, y, width, 2);
  }
  
  if (gameState === 'GAMEOVER') {
    drawOverlay("GAME OVER", "SYSTEM FAILURE");
  } else if (gameState === 'WIN') {
    drawOverlay("V V V V V V", "RESCUE SUCCESSFUL");
  }
}