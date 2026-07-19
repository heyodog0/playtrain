// ============================================================
// REQUIRED: p5.js lifecycle
// ============================================================

let score = 0;
let lives = 1;
let gameState = 'PLAYING';

let player;
let bullets = [];
let ships = [];
let lanes = [];
let targetColor;
let distractorColors = [];
let juice = 1.0;
let targetQuota = 20;
let shootCooldown = 0;

const COLORS = [
  [255, 50, 50],   // Red
  [50, 255, 50],   // Green
  [255, 255, 50],  // Yellow
  [50, 255, 255],  // Cyan
  [255, 50, 255],  // Magenta
  [255, 150, 50]   // Orange
];

function setup() {
  createCanvas(400, 400);
  noSmooth(); // Helps maintain distinct colors when downscaled
}

function draw() {
  if (gameState === 'PLAYING') {
    // Player Input
    if (keyIsDown(37)) player.x -= player.speed; // LEFT
    if (keyIsDown(39)) player.x += player.speed; // RIGHT
    player.x = constrain(player.x, 60, width - player.w / 2); // Prevent overlapping legend horizontally

    // Shooting
    if (keyIsDown(32) && shootCooldown <= 0) { // SPACE (D)
      bullets.push({ x: player.x, y: player.y - 15, w: 6, h: 12, speed: 8 });
      shootCooldown = 15;
      juice -= 0.02; // Costs juice to shoot
    }
    if (shootCooldown > 0) shootCooldown--;

    juice -= 0.0015; // Continuous juice drain

    // Spawning Ships
    if (rng() < 0.06) {
      let laneIndex = Math.floor(rng() * lanes.length);
      let lane = lanes[laneIndex];
      let isTarget = rng() < 0.5;
      let color = isTarget ? targetColor : distractorColors[Math.floor(rng() * distractorColors.length)];
      
      let canSpawn = true;
      for (let s of ships) {
        if (s.y === lane.y) {
          if (lane.dir === 1 && s.x < 30) canSpawn = false;
          if (lane.dir === -1 && s.x > width - 30) canSpawn = false;
        }
      }

      if (canSpawn) {
        ships.push({
          y: lane.y,
          w: 28,
          h: 18,
          color: color,
          isTarget: isTarget,
          dir: lane.dir,
          speed: lane.speed,
          x: lane.dir === 1 ? -20 : width + 20
        });
      }
    }

    // Update Bullets & Handle Collisions
    for (let i = bullets.length - 1; i >= 0; i--) {
      let b = bullets[i];
      b.y -= b.speed;
      
      if (b.y < 0) {
        bullets.splice(i, 1);
        continue;
      }
      
      let hit = false;
      for (let j = ships.length - 1; j >= 0; j--) {
        let s = ships[j];
        // AABB Collision
        if (Math.abs(b.x - s.x) < (b.w + s.w) / 2 && Math.abs(b.y - s.y) < (b.h + s.h) / 2) {
          hit = true;
          if (s.isTarget) {
            score += 1;
            juice += 0.1;
          } else {
            juice -= 0.1;
          }
          ships.splice(j, 1);
          break;
        }
      }
      
      if (hit) {
        bullets.splice(i, 1);
      }
    }

    // Update Ships
    for (let i = ships.length - 1; i >= 0; i--) {
      let s = ships[i];
      s.x += s.dir * s.speed;
      if ((s.dir === 1 && s.x > width + 30) || (s.dir === -1 && s.x < -30)) {
        ships.splice(i, 1);
      }
    }

    // Clamp juice and check win/loss
    juice = Math.max(0, Math.min(juice, 1.0));

    if (juice <= 0) {
      lives = 0;
      gameState = 'GAMEOVER';
    } else if (score >= targetQuota) {
      gameState = 'WIN';
    }
  }

  // Render Frame
  background(20);

  // Draw Legend (Target Indicator)
  fill(50);
  noStroke();
  rect(10, 20, 32, 32); // Legend background
  fill(targetColor[0], targetColor[1], targetColor[2]);
  rect(16, 26, 20, 20); // Actual target color

  // Draw Player
  fill(50, 150, 255);
  rect(player.x - player.w / 2, player.y - player.h / 2, player.w, player.h);

  // Draw Bullets
  fill(255);
  for (let b of bullets) {
    rect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
  }

  // Draw Ships
  for (let s of ships) {
    fill(s.color[0], s.color[1], s.color[2]);
    rect(s.x - s.w / 2, s.y - s.h / 2, s.w, s.h);
  }

  // Draw Progress Bar (Top) - Pink
  fill(50);
  rect(0, 0, width, 10);
  fill(255, 50, 150);
  rect(0, 0, width * (score / targetQuota), 10);

  // Draw Juice Bar (Bottom) - Green
  fill(50);
  rect(0, height - 10, width, 10);
  fill(50, 255, 100);
  rect(0, height - 10, width * juice, 10);
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
  lives = 1;
  gameState = 'PLAYING';

  player = { x: 200, y: 360, w: 24, h: 24, speed: 5 };
  bullets = [];
  ships = [];
  juice = 1.0;
  shootCooldown = 0;

  // Setup colors (1 target, 2 distractors)
  let shuffledColors = [...COLORS];
  for (let i = shuffledColors.length - 1; i > 0; i--) {
    let j = Math.floor(rng() * (i + 1));
    [shuffledColors[i], shuffledColors[j]] = [shuffledColors[j], shuffledColors[i]];
  }

  targetColor = shuffledColors[0];
  distractorColors = [shuffledColors[1], shuffledColors[2]];

  // Setup 5 lanes
  lanes = [];
  for (let i = 0; i < 5; i++) {
    lanes.push({
      y: 70 + i * 50,
      dir: rng() < 0.5 ? 1 : -1,
      speed: 1.5 + rng() * 1.5
    });
  }
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