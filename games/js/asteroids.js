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
// GAME VARIABLES
// ============================================================

let score;
let lives;
let gameState;

let ship;
let asteroids;
let bullets;
let currentLevel;

// ============================================================
// REQUIRED: p5.js lifecycle
// ============================================================

function setup() {
  createCanvas(400, 400);
  noSmooth();
}

function draw() {
  if (gameState !== 'PLAYING') {
    renderGame();
    return;
  }

  updateGame();
  renderGame();
}

// ============================================================
// REQUIRED: RL interface
// ============================================================

function getGameState() {
  return {
    score: score,
    lives: Math.max(0, lives),
    gameState: gameState,
  };
}

function resetGame(seed) {
  rng = mulberry32(seed);
  score = 0;
  lives = 3;
  gameState = 'PLAYING';
  currentLevel = 1;

  ship = {
    x: width / 2,
    y: height / 2,
    vx: 0,
    vy: 0,
    angle: -Math.PI / 2,
    cooldown: 0
  };

  bullets = [];
  initLevel(currentLevel);
}

// ============================================================
// GAME LOGIC
// ============================================================

function initLevel(level) {
  asteroids = [];
  let numAsteroids = 3 + level;
  
  for (let i = 0; i < numAsteroids; i++) {
    let ax, ay;
    // Ensure asteroids don't spawn right on top of the ship
    do {
      ax = rng() * width;
      ay = rng() * height;
    } while (dist(ax, ay, ship.x, ship.y) < 100);
    
    let angle = rng() * Math.PI * 2;
    let speed = 0.5 + rng() * 0.5 * level;
    
    asteroids.push({
      x: ax,
      y: ay,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      stage: 3,
      radius: 30,
      dead: false
    });
  }
}

function updateGame() {
  // --- INPUT HANDLING ---
  if (keyIsDown(37)) { // LEFT
    ship.angle -= 0.1;
  }
  if (keyIsDown(39)) { // RIGHT
    ship.angle += 0.1;
  }
  if (keyIsDown(38)) { // UP (Thrust)
    ship.vx += Math.cos(ship.angle) * 0.25;
    ship.vy += Math.sin(ship.angle) * 0.25;
  }
  if (keyIsDown(32)) { // SPACE (Shoot)
    if (ship.cooldown <= 0) {
      bullets.push({
        x: ship.x + Math.cos(ship.angle) * 15,
        y: ship.y + Math.sin(ship.angle) * 15,
        vx: Math.cos(ship.angle) * 8,
        vy: Math.sin(ship.angle) * 8,
        life: 45,
        dead: false
      });
      ship.cooldown = 15;
    }
  }

  if (ship.cooldown > 0) ship.cooldown--;

  // --- PHYSICS & MOVEMENT ---
  
  // Ship speed limit and friction
  let speedSq = ship.vx * ship.vx + ship.vy * ship.vy;
  if (speedSq > 25) {
    let speed = Math.sqrt(speedSq);
    ship.vx = (ship.vx / speed) * 5;
    ship.vy = (ship.vy / speed) * 5;
  }
  ship.vx *= 0.99;
  ship.vy *= 0.99;

  ship.x += ship.vx;
  ship.y += ship.vy;
  wrap(ship);

  // Bullets
  for (let b of bullets) {
    b.x += b.vx;
    b.y += b.vy;
    b.life--;
    wrap(b);
  }

  // Asteroids
  for (let a of asteroids) {
    a.x += a.vx;
    a.y += a.vy;
    wrap(a);
  }

  // --- COLLISIONS ---

  // Bullets vs Asteroids
  for (let b of bullets) {
    if (b.life <= 0 || b.dead) continue;
    for (let a of asteroids) {
      if (a.dead) continue;
      
      if (dist(b.x, b.y, a.x, a.y) < a.radius + 3) {
        b.dead = true;
        a.dead = true;
        
        // Scoring: Stage 3 = 10, Stage 2 = 20, Stage 1 = 40
        let points = (a.stage === 3) ? 10 : (a.stage === 2) ? 20 : 40;
        score += points;
        
        splitAsteroid(a);
        break; // Bullet is dead, stop checking this bullet
      }
    }
  }

  // Cleanup dead entities
  bullets = bullets.filter(b => !b.dead && b.life > 0);
  asteroids = asteroids.filter(a => !a.dead);

  // Ship vs Asteroids
  let shipHit = false;
  for (let a of asteroids) {
    // Ship radius approximation is about 12
    if (dist(ship.x, ship.y, a.x, a.y) < a.radius + 12) {
      shipHit = true;
      break;
    }
  }

  if (shipHit) {
    lives--;
    score = Math.max(0, score - 20); // Penalty for dying
    if (lives <= 0) {
      gameState = 'GAMEOVER';
    } else {
      // Respawn logic: reset to center, push asteroids away safely
      ship.x = width / 2;
      ship.y = height / 2;
      ship.vx = 0;
      ship.vy = 0;
      ship.angle = -Math.PI / 2;
      
      for (let a of asteroids) {
        let d = dist(a.x, a.y, ship.x, ship.y);
        let safeDist = a.radius + 60;
        if (d < safeDist) {
          let pushAngle = Math.atan2(a.y - ship.y, a.x - ship.x);
          a.x = ship.x + Math.cos(pushAngle) * safeDist;
          a.y = ship.y + Math.sin(pushAngle) * safeDist;
        }
      }
    }
  }

  // --- LEVEL PROGRESSION ---
  if (asteroids.length === 0 && gameState === 'PLAYING') {
    currentLevel++;
    score += 100; // Level clear bonus
    initLevel(currentLevel);
  }
}

function splitAsteroid(a) {
  if (a.stage > 1) {
    let newStage = a.stage - 1;
    let newRadius = (newStage === 2) ? 18 : 10;
    
    for (let i = 0; i < 2; i++) {
      let angle = rng() * Math.PI * 2;
      let baseSpeed = Math.sqrt(a.vx * a.vx + a.vy * a.vy);
      let newSpeed = baseSpeed * (1.2 + rng() * 0.4);
      
      asteroids.push({
        x: a.x,
        y: a.y,
        vx: Math.cos(angle) * newSpeed,
        vy: Math.sin(angle) * newSpeed,
        stage: newStage,
        radius: newRadius,
        dead: false
      });
    }
  }
}

function wrap(obj) {
  if (obj.x < 0) obj.x += width;
  else if (obj.x > width) obj.x -= width;
  if (obj.y < 0) obj.y += height;
  else if (obj.y > height) obj.y -= height;
}

// ============================================================
// RENDERING
// ============================================================

function renderGame() {
  background(0); // Dark background

  noStroke();

  // Draw Asteroids (Red)
  fill(255, 50, 50);
  for (let a of asteroids) {
    ellipse(a.x, a.y, a.radius * 2, a.radius * 2);
  }

  // Draw Bullets (Yellow)
  fill(255, 255, 0);
  for (let b of bullets) {
    rect(b.x - 3, b.y - 3, 6, 6);
  }

  // Draw Ship (Blue)
  if (lives > 0) {
    push();
    translate(ship.x, ship.y);
    rotate(ship.angle);
    fill(50, 150, 255);
    triangle(15, 0, -10, -10, -10, 10);
    pop();
  }

  // Draw HUD (Lives as tiny blue squares at top left for visual agents)
  fill(50, 150, 255);
  for (let i = 0; i < lives; i++) {
    rect(10 + i * 15, 10, 10, 10);
  }
  
  // Score indicator at top right (Yellow blocks)
  fill(255, 255, 0);
  let scoreBlocks = Math.min(10, Math.floor(score / 50));
  for (let i = 0; i < scoreBlocks; i++) {
    rect(width - 20 - i * 15, 10, 10, 10);
  }
}