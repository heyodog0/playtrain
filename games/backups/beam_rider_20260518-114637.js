let score = 0;
let lives = 0;
let gameState = 'PLAYING';

let player = null;
let enemies = [];
let lasers = [];
let frameCounter = 0;

let moveCooldown = 0;
let shootCooldown = 0;

const WIDTH = 256;
const HEIGHT = 256;
const LANE_COUNT = 5;
const LANE_WIDTH = WIDTH / LANE_COUNT;
const MAX_SCORE = 1000;

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
// REQUIRED: p5.js lifecycle
// ============================================================
function setup() {
  createCanvas(WIDTH, HEIGHT);
  noSmooth(); // Hard edges for 64x64 downscaling
}

function draw() {
  background(0);

  if (gameState === 'PLAYING') {
    handleInput();
    updatePhysics();
  }

  drawGrid();
  drawPlayer();
  drawEnemies();
  drawLasers();
  drawHUD();
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
  lives = 3;
  gameState = 'PLAYING';
  frameCounter = 0;
  
  player = {
    lane: 2,
    y: HEIGHT - 30
  };
  
  enemies = [];
  lasers = [];
  
  moveCooldown = 0;
  shootCooldown = 0;
}

// ============================================================
// Game Logic
// ============================================================
function handleInput() {
  if (moveCooldown > 0) moveCooldown--;
  if (shootCooldown > 0) shootCooldown--;

  // LEFT / RIGHT Movement
  if (moveCooldown === 0) {
    if (keyIsDown(37)) { // LEFT
      if (player.lane > 0) {
        player.lane--;
        moveCooldown = 10;
      }
    } else if (keyIsDown(39)) { // RIGHT
      if (player.lane < LANE_COUNT - 1) {
        player.lane++;
        moveCooldown = 10;
      }
    }
  }

  // SHOOT (D)
  if (shootCooldown === 0) {
    if (keyIsDown(32)) { // SPACE
      lasers.push({
        lane: player.lane,
        y: player.y - 10
      });
      shootCooldown = 15;
    }
  }
}

function updatePhysics() {
  frameCounter++;

  // Move Lasers
  for (let i = lasers.length - 1; i >= 0; i--) {
    lasers[i].y -= 8;
    if (lasers[i].y < 0) {
      lasers.splice(i, 1);
    }
  }

  // Spawn Enemies
  // Difficulty increases as frameCounter goes up
  let spawnRate = Math.max(25, 70 - Math.floor(frameCounter / 100));
  if (frameCounter % spawnRate === 0) {
    let lane = Math.floor(rng() * LANE_COUNT);
    enemies.push({
      lane: lane,
      y: -20,
      speed: 1.5 + rng() * 1.5
    });
  }

  // Move Enemies & Check Collisions
  for (let i = enemies.length - 1; i >= 0; i--) {
    let e = enemies[i];
    e.y += e.speed;

    // Check collision with player
    if (e.lane === player.lane && Math.abs(e.y - player.y) < 16) {
      lives--;
      enemies.splice(i, 1);
      if (lives <= 0) {
        gameState = 'GAMEOVER';
      }
      continue; // Enemy destroyed, skip further checks
    }

    // Check if enemy passed bottom
    if (e.y > HEIGHT + 20) {
      enemies.splice(i, 1);
      continue;
    }

    // Check collision with lasers
    let hit = false;
    for (let j = lasers.length - 1; j >= 0; j--) {
      let l = lasers[j];
      if (l.lane === e.lane && Math.abs(l.y - e.y) < 14) {
        score += 10;
        hit = true;
        lasers.splice(j, 1);
        break;
      }
    }

    if (hit) {
      enemies.splice(i, 1);
    }
  }

  if (score >= MAX_SCORE) {
    gameState = 'WIN';
  }
}

// ============================================================
// Rendering
// ============================================================
function getLaneCenterX(laneIndex) {
  return (laneIndex * LANE_WIDTH) + (LANE_WIDTH / 2);
}

function drawGrid() {
  fill(0, 0, 100);
  noStroke();
  // Draw thick vertical lines to represent the beams/lanes
  for (let i = 0; i < LANE_COUNT; i++) {
    let cx = getLaneCenterX(i);
    rect(cx - 4, 0, 8, HEIGHT);
  }
}

function drawPlayer() {
  if (!player) return;
  fill(0, 255, 0);
  noStroke();
  let cx = getLaneCenterX(player.lane);
  
  // Triangle-like shape for the ship
  rect(cx - 12, player.y, 24, 12);
  rect(cx - 6, player.y - 8, 12, 8);
  rect(cx - 2, player.y - 14, 4, 6);
}

function drawEnemies() {
  fill(255, 0, 0);
  noStroke();
  for (let e of enemies) {
    let cx = getLaneCenterX(e.lane);
    ellipse(cx, e.y, 16, 16);
    // Draw an inner core to give the enemy distinct shape
    fill(255, 100, 0);
    ellipse(cx, e.y, 8, 8);
    fill(255, 0, 0); // Restore fill for next enemy
  }
}

function drawLasers() {
  fill(255, 255, 0);
  noStroke();
  for (let l of lasers) {
    let cx = getLaneCenterX(l.lane);
    rect(cx - 3, l.y - 8, 6, 16);
  }
}

function drawHUD() {
  noStroke();
  
  // Draw lives as discrete green blocks in the top left
  fill(0, 255, 0);
  for (let i = 0; i < lives; i++) {
    rect(8 + i * 14, 8, 10, 10);
  }

  // Draw score as a progress bar along the top edge
  fill(255, 255, 0);
  let barWidth = (score / MAX_SCORE) * WIDTH;
  rect(0, 0, barWidth, 4);
}