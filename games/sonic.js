// ============================================================
// REQUIRED: p5.js lifecycle
// ============================================================

let score = 0;
let lives = 3;
let gameState = 'PLAYING';

let player;
let blocks = [];
let rings = [];
let enemies = [];
let spikes = [];
let goal;

let cameraX = 0;
let invulnTimer = 0;

const MAX_SPEED = 5;
const ACCEL = 0.15;
const FRICTION = 0.92;
const ROLL_FRICTION = 0.98;
const GRAVITY = 0.3;
const JUMP_FORCE = -7;
const MAX_FALL = 8;

function setup() {
  createCanvas(400, 400);
  noStroke();
}

function draw() {
  background(20);

  if (gameState !== 'PLAYING') {
    drawMap();
    drawHUD();
    return;
  }

  updatePlayer();
  updateEnemies();
  checkInteractions();

  cameraX = Math.max(0, player.x - width * 0.4);

  push();
  translate(-cameraX, 0);
  drawMap();
  pop();

  drawHUD();
}

// ============================================================
// REQUIRED: RL interface
// ============================================================

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
  lives = 3;
  gameState = 'PLAYING';
  
  generateLevel();
  respawnPlayer();
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
// GAME LOGIC
// ============================================================

function generateLevel() {
  blocks = [];
  rings = [];
  enemies = [];
  spikes = [];
  
  blocks.push({ x: -100, y: 0, w: 100, h: 400 }); // Left bounds wall
  blocks.push({ x: 0, y: 300, w: 600, h: 100 });  // Start area
  
  let cx = 600;
  let cy = 300;
  
  while (cx < 4000) {
    let isGap = rng() > 0.6;
    if (isGap) {
      cx += 40 + Math.floor(rng() * 60); 
    }
    
    let w = 150 + Math.floor(rng() * 250);
    let h = 150;
    
    // Vary height slightly
    let yChange = (Math.floor(rng() * 3) - 1) * 40; 
    cy += yChange;
    if (cy < 150) cy = 150;
    if (cy > 350) cy = 350;
    
    blocks.push({ x: cx, y: cy, w: w, h: h });
    
    // Spawn entities
    let rType = rng();
    if (rType > 0.6) {
      // Rings
      for (let i = 0; i < 3; i++) {
        rings.push({ x: cx + 40 + i * 30, y: cy - 30, w: 10, h: 10, collected: false });
      }
    } else if (rType > 0.3) {
      // Enemy
      enemies.push({
        x: cx + w / 2, y: cy - 16, w: 16, h: 16,
        minX: cx + 10, maxX: cx + w - 26,
        vx: 1 + rng(), alive: true
      });
    } else if (rType > 0.1) {
      // Spikes
      spikes.push({ x: cx + w / 2 - 10, y: cy - 10, w: 20, h: 10 });
    }
    
    cx += w;
  }
  
  // Goal area
  goal = { x: cx + 100, y: 100, w: 60, h: 300 };
  blocks.push({ x: cx, y: cy, w: 800, h: 150 });
}

function respawnPlayer() {
  player = {
    x: 50, y: 100, w: 16, h: 16,
    vx: 0, vy: 0,
    grounded: false,
    rolling: false,
    jumpHeld: false,
    rings: 0
  };
  cameraX = 0;
  invulnTimer = 60;
}

function updatePlayer() {
  if (invulnTimer > 0) invulnTimer--;

  // Input Mapping
  let left = keyIsDown(37);
  let right = keyIsDown(39);
  let down = keyIsDown(40);
  let jump = keyIsDown(32);

  // Horizontal Movement
  if (left) player.vx -= ACCEL;
  if (right) player.vx += ACCEL;

  // Rolling State
  if (player.grounded) {
    if (down && Math.abs(player.vx) > 2) {
      player.rolling = true;
    }
    if (Math.abs(player.vx) < 0.5) {
      player.rolling = false;
    }
  }

  // Friction
  let friction = player.rolling ? ROLL_FRICTION : FRICTION;
  if (!left && !right) {
    player.vx *= friction;
  }
  
  if (player.vx > MAX_SPEED) player.vx = MAX_SPEED;
  if (player.vx < -MAX_SPEED) player.vx = -MAX_SPEED;

  // Jump
  if (jump) {
    if (player.grounded && !player.jumpHeld) {
      player.vy = JUMP_FORCE;
      player.grounded = false;
    }
    player.jumpHeld = true;
  } else {
    if (!player.grounded && player.vy < 0) {
      player.vy *= 0.5; // Short hop
    }
    player.jumpHeld = false;
  }

  // Gravity
  player.vy += GRAVITY;
  if (player.vy > MAX_FALL) player.vy = MAX_FALL;

  // Move and Collide X
  player.x += player.vx;
  checkCollisionsX();

  // Move and Collide Y
  player.y += player.vy;
  checkCollisionsY();

  // Pit Death
  if (player.y > height + 50) {
    handleDeath();
  }
}

function checkCollisionsX() {
  let hx = player.w / 2;
  for (let b of blocks) {
    if (collideEntity(player.x, player.y, player.w, player.h, b.x, b.y, b.w, b.h)) {
      if (player.vx > 0) {
        player.x = b.x - hx;
        player.vx = 0;
      } else if (player.vx < 0) {
        player.x = b.x + b.w + hx;
        player.vx = 0;
      }
    }
  }
}

function checkCollisionsY() {
  let hy = player.h / 2;
  player.grounded = false;
  for (let b of blocks) {
    if (collideEntity(player.x, player.y, player.w, player.h, b.x, b.y, b.w, b.h)) {
      if (player.vy > 0) {
        player.y = b.y - hy;
        player.vy = 0;
        player.grounded = true;
      } else if (player.vy < 0) {
        player.y = b.y + b.h + hy;
        player.vy = 0;
      }
    }
  }
}

function updateEnemies() {
  for (let e of enemies) {
    if (!e.alive) continue;
    e.x += e.vx;
    if (e.x < e.minX || e.x > e.maxX) {
      e.vx *= -1;
      e.x = Math.max(e.minX, Math.min(e.x, e.maxX));
    }
  }
}

function checkInteractions() {
  // Rings
  for (let r of rings) {
    if (!r.collected && collideEntity(player.x, player.y, player.w, player.h, r.x, r.y, r.w, r.h)) {
      r.collected = true;
      player.rings++;
      score += 10;
    }
  }

  // Enemies
  let isAttacking = player.rolling || !player.grounded;
  for (let e of enemies) {
    if (!e.alive) continue;
    if (collideEntity(player.x, player.y, player.w, player.h, e.x, e.y, e.w, e.h)) {
      if (isAttacking) {
        e.alive = false;
        score += 50;
        player.vy = -4; // Bounce off enemy
      } else {
        takeDamage();
      }
    }
  }

  // Spikes
  for (let s of spikes) {
    if (collideEntity(player.x, player.y, player.w, player.h, s.x, s.y, s.w, s.h)) {
      takeDamage();
    }
  }

  // Goal
  if (collideEntity(player.x, player.y, player.w, player.h, goal.x, goal.y, goal.w, goal.h)) {
    gameState = 'WIN';
    score += 1000;
  }
}

function takeDamage() {
  if (invulnTimer > 0) return;
  if (player.rings > 0) {
    player.rings = 0;
    score -= 20;
    invulnTimer = 60;
    player.vy = -3;
    player.vx = player.vx > 0 ? -2 : 2;
  } else {
    handleDeath();
  }
}

function handleDeath() {
  lives--;
  score -= 50;
  if (lives <= 0) {
    gameState = 'GAMEOVER';
  } else {
    respawnPlayer();
  }
}

// Helper: entity px,py is center. ex,ey is top-left
function collideEntity(px, py, pw, ph, ex, ey, ew, eh) {
  return (px - pw / 2 < ex + ew &&
          px + pw / 2 > ex &&
          py - ph / 2 < ey + eh &&
          py + ph / 2 > ey);
}

function drawMap() {
  // Goal
  fill(0, 255, 255);
  rect(goal.x, goal.y, goal.w, goal.h);

  // Blocks
  fill(0, 200, 0);
  for (let b of blocks) {
    rect(b.x, b.y, b.w, b.h);
  }

  // Rings
  fill(255, 255, 0);
  for (let r of rings) {
    if (!r.collected) {
      ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w, r.h);
    }
  }

  // Spikes
  fill(255, 0, 0);
  for (let s of spikes) {
    triangle(s.x + s.w / 2, s.y, s.x, s.y + s.h, s.x + s.w, s.y + s.h);
  }

  // Enemies
  fill(255, 0, 255);
  for (let e of enemies) {
    if (e.alive) {
      rect(e.x, e.y, e.w, e.h);
    }
  }

  // Player
  if (invulnTimer > 0) {
    fill(150, 150, 255);
  } else {
    fill(0, 0, 255);
  }
  
  if (player.rolling || !player.grounded) {
    ellipse(player.x, player.y, player.w, player.h);
  } else {
    rect(player.x - player.w / 2, player.y - player.h / 2, player.w, player.h);
  }
}

function drawHUD() {
  // Rings
  fill(255, 255, 0);
  for (let i = 0; i < Math.min(player.rings, 10); i++) {
    rect(10 + i * 14, 10, 10, 10);
  }
  
  // Lives
  fill(0, 0, 255);
  for (let i = 0; i < lives; i++) {
    rect(10 + i * 14, 26, 10, 10);
  }
}