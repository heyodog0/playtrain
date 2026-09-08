// ============================================================
// REQUIRED: p5.js lifecycle
// ============================================================

let score = 0;
let lives = 1;
let gameState = 'PLAYING';
let player = { x: 192, y: 376, size: 16, speed: 4 };
let cars = [];

const LANE_HEIGHT = 32;

function setup() {
  createCanvas(400, 400);
  noStroke();
}

function draw() {
  // Background
  background(30, 30, 30);
  
  // Safe zones (Bottom: Green, Top: Blue)
  fill(40, 100, 40);
  rect(0, 360, width, 40);
  fill(40, 40, 100);
  rect(0, 0, width, 40);

  if (gameState === 'PLAYING') {
    // Process input
    if (keyIsDown(38)) player.y -= player.speed; // UP
    if (keyIsDown(40)) player.y += player.speed; // DOWN

    // Clamp player to bottom boundary
    if (player.y > height - player.size) {
      player.y = height - player.size;
    }

    // Check goal condition (reached top safe zone)
    if (player.y < 40) {
      score++;
      player.y = 376; // Back to the start for the next crossing
    }

    // Update traffic
    for (let c of cars) {
      c.x += c.speed * c.dir;

      // Screen wrap
      if (c.dir === 1 && c.x > width) {
        c.x = -c.w;
      }
      if (c.dir === -1 && c.x + c.w < 0) {
        c.x = width;
      }

      // Check collision
      if (isColliding(player, c)) {
        player.y = Math.min(376, player.y + LANE_HEIGHT);
      }
    }
  }

  // Draw Player
  fill(255, 255, 0); // Yellow
  rect(player.x, player.y, player.size, player.size);

  // Draw Traffic
  fill(255, 50, 50); // Red
  for (let c of cars) {
    rect(c.x, c.y, c.w, c.h);
  }

  // Draw HUD
  drawHUD();
}

function isColliding(p, c) {
  let shrink = 2; // Forgiving hitbox
  return p.x + shrink < c.x + c.w && 
         p.x + p.size - shrink > c.x &&
         p.y + shrink < c.y + c.h && 
         p.y + p.size - shrink > c.y;
}

function drawHUD() {
  // Score indicator (Yellow blocks at top)
  fill(255, 255, 0);
  for (let i = 0; i < score; i++) {
    rect(10 + i * 15, 10, 10, 10);
  }

  // Lives indicator (Green blocks at bottom)
  fill(50, 255, 50);
  for (let i = 0; i < lives; i++) {
    rect(10 + i * 15, 380, 10, 10);
  }
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

  player.x = 192;
  player.y = 376;

  cars = [];
  let numLanes = 10;
  let laneHeight = 32;
  let startY = 40;

  for (let i = 0; i < numLanes; i++) {
    let laneY = startY + i * laneHeight;
    let speed = 1.0 + rng() * 2.0; // Speed 1.0 to 3.0 (Slower cars)
    let dir = rng() > 0.5 ? 1 : -1;
    let numCars = Math.floor(rng() * 2) + 1; // 1 to 2 cars per lane (Easier)
    let carLen = 30 + rng() * 40; // Length 30 to 70
    let spacing = width / numCars;

    for (let j = 0; j < numCars; j++) {
      let startX = j * spacing + rng() * (spacing - carLen);
      cars.push({
        x: startX,
        y: laneY + (laneHeight - 16) / 2, // Centered in lane
        w: carLen,
        h: 16,
        speed: speed,
        dir: dir
      });
    }
  }
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