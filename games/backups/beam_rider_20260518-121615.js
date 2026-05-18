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

const LANES = 5;
const LANE_WIDTH = 400 / LANES;
const PLAYER_Y = 340;

let frameCountRL = 0;
let player;
let enemies = [];
let bullets = [];
let gridLines = [];

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
    lane: 2,
    moveTimer: 0,
    shootTimer: 0
  };

  enemies = [];
  bullets = [];
  
  gridLines = [];
  for (let i = 0; i < 400; i += 40) {
    gridLines.push(i);
  }
}

function updateInput() {
  if (player.moveTimer > 0) {
    player.moveTimer--;
  } else {
    if (keyIsDown(37) && player.lane > 0) { // LEFT
      player.lane--;
      player.moveTimer = 10;
    } else if (keyIsDown(39) && player.lane < LANES - 1) { // RIGHT
      player.lane++;
      player.moveTimer = 10;
    }
  }

  if (player.shootTimer > 0) {
    player.shootTimer--;
  } else {
    if (keyIsDown(32)) { // SPACE (D)
      bullets.push({
        lane: player.lane,
        y: PLAYER_Y - 20,
        vy: -12,
        isEnemy: false
      });
      player.shootTimer = 15;
    }
  }
}

function updateGameLogic() {
  // Update Background Grid
  for (let i = 0; i < gridLines.length; i++) {
    gridLines[i] += 3;
    if (gridLines[i] > 400) {
      gridLines[i] -= 400;
    }
  }

  // Spawn Enemies
  let spawnRate = Math.max(20, 60 - Math.floor(score / 50));
  if (frameCountRL % spawnRate === 0) {
    let type = rng() > 0.3 ? 'SHIP' : 'DEBRIS';
    let baseSpeed = 2 + (score / 1000);
    
    enemies.push({
      lane: Math.floor(rng() * LANES),
      y: -20,
      vy: type === 'SHIP' ? baseSpeed : baseSpeed * 1.5,
      type: type
    });
  }

  // Update Enemies
  for (let i = enemies.length - 1; i >= 0; i--) {
    let e = enemies[i];
    e.y += e.vy;

    // Enemy Shooting
    if (e.type === 'SHIP' && e.y > 0 && e.y < 200 && rng() < 0.015) {
      bullets.push({
        lane: e.lane,
        y: e.y + 20,
        vy: 6,
        isEnemy: true
      });
    }

    if (e.y > 420) {
      enemies.splice(i, 1);
    }
  }

  // Update Bullets
  for (let i = bullets.length - 1; i >= 0; i--) {
    let b = bullets[i];
    b.y += b.vy;

    if (b.y < -20 || b.y > 420) {
      bullets.splice(i, 1);
    }
  }

  // Collisions
  checkCollisions();
}

function checkCollisions() {
  // Bullet vs Enemy
  for (let i = bullets.length - 1; i >= 0; i--) {
    let b = bullets[i];
    if (b.isEnemy) continue;

    for (let j = enemies.length - 1; j >= 0; j--) {
      let e = enemies[j];
      
      if (b.lane === e.lane && Math.abs(b.y - e.y) < 25) {
        bullets.splice(i, 1);
        enemies.splice(j, 1);
        score += 10;
        break; // Bullet destroyed, move to next bullet
      }
    }
  }

  // Player collisions
  let playerHit = false;

  // Enemy Bullet vs Player
  for (let i = bullets.length - 1; i >= 0; i--) {
    let b = bullets[i];
    if (!b.isEnemy) continue;

    if (b.lane === player.lane && Math.abs(b.y - PLAYER_Y) < 20) {
      playerHit = true;
      break;
    }
  }

  // Enemy vs Player
  if (!playerHit) {
    for (let i = enemies.length - 1; i >= 0; i--) {
      let e = enemies[i];
      if (e.lane === player.lane && Math.abs(e.y - PLAYER_Y) < 30) {
        playerHit = true;
        break;
      }
    }
  }

  // Handle Player Death
  if (playerHit) {
    lives--;
    if (lives <= 0) {
      gameState = 'GAMEOVER';
    } else {
      // Clear board to prevent immediate death loop
      enemies = [];
      bullets = [];
      player.moveTimer = 20; // Short invulnerability/pause implicitly by resetting board
    }
  }
}

// ============================================================
// RENDERING
// ============================================================

function drawGame() {
  background(10, 10, 20); // Dark background

  // Draw Grid
  stroke(40, 40, 80);
  strokeWeight(2);
  for (let i = 0; i <= LANES; i++) {
    let lx = i * LANE_WIDTH;
    line(lx, 0, lx, 400);
  }
  for (let y of gridLines) {
    line(0, y, 400, y);
  }
  noStroke();

  // Draw Enemies
  for (let e of enemies) {
    let ex = e.lane * LANE_WIDTH + LANE_WIDTH / 2;
    if (e.type === 'SHIP') {
      fill(255, 40, 40); // Red ship
      rect(ex, e.y, 30, 30);
      fill(200, 0, 0);
      rect(ex, e.y - 10, 16, 10);
    } else {
      fill(140, 140, 140); // Gray debris
      ellipse(ex, e.y, 32, 32);
    }
  }

  // Draw Bullets
  for (let b of bullets) {
    let bx = b.lane * LANE_WIDTH + LANE_WIDTH / 2;
    if (b.isEnemy) {
      fill(255, 80, 255); // Magenta enemy bullet
      rect(bx, b.y, 10, 20);
    } else {
      fill(255, 255, 40); // Yellow player bullet
      rect(bx, b.y, 8, 24);
    }
  }

  // Draw Player
  let px = player.lane * LANE_WIDTH + LANE_WIDTH / 2;
  fill(40, 140, 255); // Blue player ship
  rect(px, PLAYER_Y, 36, 24);
  fill(80, 200, 255);
  rect(px, PLAYER_Y - 8, 12, 20);

  // Simple visual indicators for lives (optional per visual rules, small blocks)
  fill(0, 255, 0);
  for (let i = 0; i < lives; i++) {
    rect(10 + i * 12, 10, 8, 8);
  }
}