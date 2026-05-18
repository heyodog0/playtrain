// ============================================================
// REQUIRED: p5.js lifecycle
// ============================================================

function setup() {
  createCanvas(400, 400);
  rectMode(CENTER);
  noStroke();
}

function draw() {
  if (gameState !== 'PLAYING') {
    background(0);
    fill(255);
    textAlign(CENTER, CENTER);
    textSize(32);
    if (gameState === 'GAMEOVER') {
      text("GAME OVER", 200, 180);
      textSize(16);
      text("Score: " + score, 200, 220);
    }
    return;
  }

  frameCountRL++;
  updateInput();
  updateGameLogic();
  drawGame();
}

// ============================================================
// REQUIRED: RL interface
// ============================================================

let score = 0;
let lives = 3;
let gameState = 'PLAYING';

function getGameState() {
  return {
    score: score,
    lives: lives,
    gameState: gameState,
  };
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
// GAME VARIABLES & CONSTANTS
// ============================================================

const HORIZON_Y = 150;
const BOTTOM_Y = 380;
const LANES = 5;
const BEAM_X_COORDS = [-2, -1, 0, 1, 2]; // World space lane center positions

let player = { wx: 0, wz: 0.9, shootTimer: 0 };
let enemies = [];
let bullets = [];
let gridZs = [0.1, 0.3, 0.5, 0.7, 0.9];
let frameCountRL = 0;

// ============================================================
// HELPERS
// ============================================================

function project(wx, wz) {
  // wz ranges from 0 (horizon) to 1 (bottom)
  let y = HORIZON_Y + wz * (BOTTOM_Y - HORIZON_Y);
  let maxWidth = 340;
  let currentWidth = wz * maxWidth;
  let x = 200 + (wx / 2) * (currentWidth / 2);
  let scale = wz;
  return { x, y, scale };
}

// ============================================================
// GAME LOGIC
// ============================================================

function resetGame(seed) {
  rng = mulberry32(seed);
  score = 0;
  lives = 3;
  gameState = 'PLAYING';
  frameCountRL = 0;

  player = {
    wx: 0,
    wz: 0.9,
    shootTimer: 0
  };

  enemies = [];
  bullets = [];
  gridZs = [0.1, 0.3, 0.5, 0.7, 0.9];
}

function updateInput() {
  const moveSpeed = 0.08;
  if (keyIsDown(37)) { // LEFT
    player.wx -= moveSpeed;
  }
  if (keyIsDown(39)) { // RIGHT
    player.wx += moveSpeed;
  }
  
  // Boundary constraints (approx width of beams at bottom)
  player.wx = constrain(player.wx, -2.2, 2.2);

  if (player.shootTimer > 0) {
    player.shootTimer--;
  } else {
    if (keyIsDown(32)) { // SPACE
      bullets.push({
        wx: player.wx,
        wz: player.wz,
        vz: -0.04,
        isEnemy: false
      });
      player.shootTimer = 12;
    }
  }
}

function updateGameLogic() {
  // Update Background Grid movement
  for (let i = 0; i < gridZs.length; i++) {
    gridZs[i] += 0.01;
    if (gridZs[i] > 1) gridZs[i] = 0;
  }

  // Spawn Enemies
  let spawnRate = Math.max(15, 45 - Math.floor(score / 100));
  if (frameCountRL % spawnRate === 0) {
    let laneIdx = Math.floor(rng() * LANES);
    enemies.push({
      wx: BEAM_X_COORDS[laneIdx],
      wz: 0,
      vz: 0.01 + (score / 2000),
      sideDir: rng() > 0.5 ? 1 : -1,
      movePhase: rng() * PI * 2,
      type: rng() > 0.2 ? 'SHIP' : 'DEBRIS'
    });
  }

  // Update Enemies
  for (let i = enemies.length - 1; i >= 0; i--) {
    let e = enemies[i];
    e.wz += e.vz;
    
    // Beamrider-style side-to-side movement logic
    if (e.type === 'SHIP') {
      e.wx += Math.sin(frameCountRL * 0.05 + e.movePhase) * 0.03;
    }

    // Enemy Shooting
    if (e.type === 'SHIP' && e.wz > 0.1 && e.wz < 0.5 && rng() < 0.01) {
      bullets.push({
        wx: e.wx,
        wz: e.wz,
        vz: 0.02,
        isEnemy: true
      });
    }

    if (e.wz > 1.1) {
      enemies.splice(i, 1);
    }
  }

  // Update Bullets
  for (let i = bullets.length - 1; i >= 0; i--) {
    let b = bullets[i];
    b.wz += b.vz;

    if (b.wz < 0 || b.wz > 1.1) {
      bullets.splice(i, 1);
    }
  }

  checkCollisions();
}

function checkCollisions() {
  // Player Bullet vs Enemy
  for (let i = bullets.length - 1; i >= 0; i--) {
    let b = bullets[i];
    if (b.isEnemy) continue;

    for (let j = enemies.length - 1; j >= 0; j--) {
      let e = enemies[j];
      // Collision in normalized space
      if (Math.abs(b.wx - e.wx) < 0.3 && Math.abs(b.wz - e.wz) < 0.05) {
        bullets.splice(i, 1);
        enemies.splice(j, 1);
        score += 10;
        break;
      }
    }
  }

  // Player collisions
  let playerHit = false;

  // Enemy Bullet vs Player
  for (let i = bullets.length - 1; i >= 0; i--) {
    let b = bullets[i];
    if (!b.isEnemy) continue;
    if (Math.abs(b.wx - player.wx) < 0.3 && Math.abs(b.wz - player.wz) < 0.05) {
      playerHit = true;
      bullets.splice(i, 1);
      break;
    }
  }

  // Enemy vs Player
  if (!playerHit) {
    for (let i = enemies.length - 1; i >= 0; i--) {
      let e = enemies[i];
      if (Math.abs(e.wx - player.wx) < 0.3 && Math.abs(e.wz - player.wz) < 0.05) {
        playerHit = true;
        enemies.splice(i, 1);
        break;
      }
    }
  }

  if (playerHit) {
    lives--;
    if (lives <= 0) {
      gameState = 'GAMEOVER';
    } else {
      enemies = [];
      bullets = [];
    }
  }
}

// ============================================================
// RENDERING
// ============================================================

function drawGame() {
  background(5, 5, 15);

  // Draw perspective beams
  stroke(0, 100, 255, 150);
  strokeWeight(2);
  for (let bx of BEAM_X_COORDS) {
    let p0 = project(bx, 0);
    let p1 = project(bx, 1);
    line(p0.x, p0.y, p1.x, p1.y);
  }

  // Draw horizontal grid lines
  for (let gz of gridZs) {
    let pLeft = project(-2, gz);
    let pRight = project(2, gz);
    stroke(0, 80, 200, 100);
    line(pLeft.x, pLeft.y, pRight.x, pRight.y);
  }
  noStroke();

  // Draw Enemies
  for (let e of enemies) {
    let p = project(e.wx, e.wz);
    let sz = p.scale * 40;
    if (e.type === 'SHIP') {
      fill(255, 50, 50);
      rect(p.x, p.y, sz, sz * 0.6);
      fill(200, 0, 0);
      rect(p.x, p.y - sz * 0.2, sz * 0.4, sz * 0.4);
    } else {
      fill(150, 150, 150);
      ellipse(p.x, p.y, sz, sz);
    }
  }

  // Draw Bullets
  for (let b of bullets) {
    let p = project(b.wx, b.wz);
    let sz = p.scale * 20;
    if (b.isEnemy) {
      fill(255, 100, 255);
      rect(p.x, p.y, sz * 0.4, sz);
    } else {
      fill(255, 255, 100);
      rect(p.x, p.y, sz * 0.3, sz * 0.8);
    }
  }

  // Draw Player
  let pp = project(player.wx, player.wz);
  let psz = 40;
  fill(50, 150, 255);
  rect(pp.x, pp.y, psz, psz * 0.5, 2);
  fill(100, 220, 255);
  rect(pp.x, pp.y - 5, psz * 0.4, psz * 0.4, 2);
  
  // HUD
  fill(255);
  textSize(14);
  textAlign(LEFT, TOP);
  text("Score: " + score, 10, 10);
  text("Lives: " + lives, 10, 25);
  
  // Life icons
  fill(0, 255, 0);
  for (let i = 0; i < lives; i++) {
    rect(380 - i * 15, 20, 10, 10);
  }
}