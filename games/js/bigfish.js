let score = 0;
let lives = 0;
let gameState = 'PLAYING';
let rng = null;

let player;
let fishes;
let fishEaten;
const FISH_QUOTA = 30;

function setup() {
  createCanvas(400, 400);
  noStroke();
}

function resetGame(seed) {
  rng = mulberry32(seed);
  score = 0;
  lives = 3;
  gameState = 'PLAYING';
  fishEaten = 0;
  resetLevel();
}

function resetLevel() {
  player = { x: 200, y: 200, r: 15, speed: 5 };
  fishes = [];
  // Seed a few initial fish so the first observation has visual variety.
  if (rng) {
    for (let i = 0; i < 4; i++) {
      let r = 8 + Math.pow(rng(), 1.4) * 30;
      let y = r + rng() * (400 - 2 * r);
      let movesRight = rng() < 0.5;
      let x = movesRight ? rng() * 400 : (400 - rng() * 400);
      let vx = (1.5 + rng() * 3.5) * (movesRight ? 1 : -1);
      fishes.push({ x, y, r, vx });
    }
  }
}

function getGameState() {
  return { score, lives, gameState };
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let n = Math.imul(t ^ (t >>> 15), t | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

function draw() {
  if (gameState !== 'PLAYING') return;

  // Player movement
  if (keyIsDown(37)) player.x -= player.speed;
  if (keyIsDown(39)) player.x += player.speed;
  if (keyIsDown(38)) player.y -= player.speed;
  if (keyIsDown(40)) player.y += player.speed;

  // Clamp player to screen
  player.x = Math.max(player.r, Math.min(width - player.r, player.x));
  player.y = Math.max(player.r, Math.min(height - player.r, player.y));

  // Spawn fish
  if (rng() < 0.04) {
    let r = 8 + Math.pow(rng(), 1.4) * 42; // Skew towards smaller fish
    let y = r + rng() * (height - 2 * r);
    let movesRight = rng() < 0.5;
    let x = movesRight ? -r : width + r;
    let vx = (1.5 + rng() * 3.5) * (movesRight ? 1 : -1);
    fishes.push({ x, y, r, vx });
  }

  // Update fishes and check collisions
  for (let i = fishes.length - 1; i >= 0; i--) {
    let f = fishes[i];
    f.x += f.vx;

    // Remove if fully off screen
    if ((f.vx > 0 && f.x - f.r > width) || (f.vx < 0 && f.x + f.r < 0)) {
      fishes.splice(i, 1);
      continue;
    }

    // Collision check
    let dx = f.x - player.x;
    let dy = f.y - player.y;
    let distSq = dx * dx + dy * dy;
    let rSum = f.r + player.r;

    if (distSq < rSum * rSum) {
      if (f.r >= player.r) {
        // Player eaten by larger fish
        lives--;
        if (lives <= 0) {
          gameState = 'GAMEOVER';
        } else {
          resetLevel();
          break; // Stop processing further collisions this frame
        }
      } else {
        // Player eats smaller fish
        score++;
        fishEaten++;
        player.r += 1.5;
        fishes.splice(i, 1);

        if (fishEaten >= FISH_QUOTA) {
          score += 10; // Completion bonus
          gameState = 'WIN';
        }
      }
    }
  }

  // Render
  background(0);

  // Draw fishes
  for (let f of fishes) {
    if (f.r < player.r) {
      fill(0, 255, 0); // Green: smaller, safe to eat
    } else {
      fill(255, 0, 0); // Red: larger, dangerous
    }
    ellipse(f.x, f.y, f.r * 2, f.r * 2);
  }

  // Draw player
  fill(0, 100, 255); // Blue
  ellipse(player.x, player.y, player.r * 2, player.r * 2);

  // Draw lives HUD (visual only)
  fill(0, 100, 255);
  for (let i = 0; i < lives; i++) {
    rect(10 + i * 20, 10, 12, 12);
  }
}