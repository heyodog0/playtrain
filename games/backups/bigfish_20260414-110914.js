let player, enemies, fishEaten, score, lives, gameState, rInc, rng;
const FISH_QUOTA = 30;
const CANVAS_SIZE = 400;

function setup() {
  createCanvas(CANVAS_SIZE, CANVAS_SIZE);
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

function resetGame(seed) {
  rng = mulberry32(seed);
  score = 0;
  lives = 1;
  gameState = 'PLAYING';
  fishEaten = 0;
  
  const startR = 10;
  const maxR = 40;
  player = {
    x: CANVAS_SIZE / 2,
    y: CANVAS_SIZE / 2,
    r: startR,
    facing: 1
  };
  
  rInc = (maxR - startR) / FISH_QUOTA;
  enemies = [];
}

function draw() {
  if (gameState !== 'PLAYING') return;

  background(0, 0, 40); // Deep ocean blue

  // 1. Handle Input (Action Space Discrete 8)
  const moveSpeed = 4.0;
  if (keyIsDown(37)) { // LEFT
    player.x -= moveSpeed;
    player.facing = -1;
  }
  if (keyIsDown(39)) { // RIGHT
    player.x += moveSpeed;
    player.facing = 1;
  }
  if (keyIsDown(38)) { // UP
    player.y -= moveSpeed;
  }
  if (keyIsDown(40)) { // DOWN
    player.y += moveSpeed;
  }

  // 2. Constrain Player to screen bounds
  player.x = Math.max(player.r, Math.min(CANVAS_SIZE - player.r, player.x));
  player.y = Math.max(player.r, Math.min(CANVAS_SIZE - player.r, player.y));

  // 3. Procedural Spawning
  // ~5% chance per frame to spawn a fish
  if (rng() < 0.05) {
    const minR = 5;
    const maxR = 40;
    // Power of 1.4 biases towards smaller fish, providing early opportunities
    let entR = (maxR - minR) * Math.pow(rng(), 1.4) + minR;
    let movesRight = rng() < 0.5;
    let vx = (1.5 + rng() * 2.5) * (movesRight ? 1 : -1);
    let x = movesRight ? -entR : CANVAS_SIZE + entR;
    let y = rng() * (CANVAS_SIZE - 2 * entR) + entR;
    enemies.push({ x, y, vx, r: entR });
  }

  // 4. Update Entities and Detect Collisions
  for (let i = enemies.length - 1; i >= 0; i--) {
    let e = enemies[i];
    e.x += e.vx;

    // Circular collision check
    let dx = player.x - e.x;
    let dy = player.y - e.y;
    let distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < player.r + e.r) {
      if (e.r > player.r) {
        // Fatal collision with larger fish
        lives = 0;
        gameState = 'GAMEOVER';
      } else {
        // Eat smaller fish
        score += 1;
        fishEaten += 1;
        player.r += rInc; // Player grows
        enemies.splice(i, 1);

        if (fishEaten >= FISH_QUOTA) {
          score += 10;
          gameState = 'WIN';
        }
        continue;
      }
    }

    // Remove fish that leave the screen
    if ((e.vx > 0 && e.x > CANVAS_SIZE + e.r) || (e.vx < 0 && e.x < -e.r)) {
      enemies.splice(i, 1);
    }
  }

  // 5. Visual HUD (Non-text progress bar)
  noStroke();
  fill(60);
  rect(0, 0, CANVAS_SIZE, 8);
  fill(0, 255, 0);
  rect(0, 0, (fishEaten / FISH_QUOTA) * CANVAS_SIZE, 8);

  // 6. Render Player
  fill(0, 200, 255); // Cyan
  ellipse(player.x, player.y, player.r * 2);
  // Directional eye (white + black)
  fill(255);
  ellipse(player.x + (player.r * 0.4 * player.facing), player.y - player.r * 0.2, player.r * 0.4);
  fill(0);
  ellipse(player.x + (player.r * 0.5 * player.facing), player.y - player.r * 0.2, player.r * 0.2);

  // 7. Render Enemies
  for (let e of enemies) {
    // Determine visual color by size relative to player
    if (e.r > player.r) {
      fill(220, 50, 50); // Red = Dangerous
    } else {
      fill(255, 160, 0); // Orange = Edible
    }
    ellipse(e.x, e.y, e.r * 2);
    
    // Enemy eyes to indicate horizontal velocity direction
    let ef = e.vx > 0 ? 1 : -1;
    fill(255);
    ellipse(e.x + (e.r * 0.4 * ef), e.y - e.r * 0.2, e.r * 0.4);
    fill(0);
    ellipse(e.x + (e.r * 0.5 * ef), e.y - e.r * 0.2, e.r * 0.2);
  }
}

function getGameState() {
  return {
    score: score,
    lives: lives,
    gameState: gameState
  };
}

function keyPressed() {
  // Action SPACE maps to button D in some interpretations
  // Not used in this specific game logic but part of standard template
}

/**
 * BIGFISH MECHANICS SUMMARY:
 * - Use Arrow keys to move the player (Cyan fish).
 * - Eat smaller Orange fish to gain points and grow.
 * - Avoid larger Red fish; touching one results in Game Over.
 * - Eat 30 fish to win the level and receive a completion bonus.
 * - Difficulty increases naturally as larger fish appear more frequently early on.
 */