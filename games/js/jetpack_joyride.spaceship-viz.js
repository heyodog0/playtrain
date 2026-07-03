// ============================================================
// REQUIRED: p5.js lifecycle
// ============================================================

let score = 0;
let lives = 1;
let gameState = 'PLAYING';

let player;
let coins = [];
let zappers = [];
let distance = 0;
let nextSpawnDist = 0;
let scrollSpeed = 6;
let frames = 0;

function setup() {
  createCanvas(400, 400);
}

function draw() {
  if (gameState !== 'PLAYING') {
    drawEnvironment();
    return;
  }

  frames++;
  if (frames % 10 === 0) {
    score += 1; 
  }

  if (keyIsDown(32)) {
    player.vy -= 1.2;
  }
  player.vy += 0.6;
  player.vy = constrain(player.vy, -8, 8);
  player.y += player.vy;

  if (player.y < 20) {
    player.y = 20;
    if (player.vy < 0) player.vy = 0;
  }
  if (player.y + player.h > 380) {
    player.y = 380 - player.h;
    if (player.vy > 0) player.vy = 0;
  }

  distance += scrollSpeed;
  if (distance > nextSpawnDist) {
    spawnEntities();
  }

  for (let i = coins.length - 1; i >= 0; i--) {
    coins[i].x -= scrollSpeed;
    if (rectCollide(player, coins[i])) {
      score += 10;
      coins.splice(i, 1);
      continue;
    }
    if (coins[i].x < -50) coins.splice(i, 1);
  }

  for (let i = zappers.length - 1; i >= 0; i--) {
    zappers[i].x -= scrollSpeed;
    
    let hitbox = {
      x: zappers[i].x + 3,
      y: zappers[i].y + 3,
      w: zappers[i].w - 6,
      h: zappers[i].h - 6
    };
    
    if (rectCollide(player, hitbox)) {
      lives = 0;
      gameState = 'GAMEOVER';
    }
    if (zappers[i].x < -300) zappers.splice(i, 1);
  }

  drawEnvironment();
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
  
  player = { x: 60, y: 200, w: 20, h: 20, vy: 0 };
  coins = [];
  zappers = [];
  distance = 0;
  nextSpawnDist = 150; 
  frames = 0;
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
// GAME LOGIC & RENDERING
// ============================================================

function spawnEntities() {
  let r = rng();
  
  if (distance < 500) {
    r = 0.1;
  }

  if (r < 0.4) {
    let cy = 80 + Math.floor(rng() * 240);
    let pattern = Math.floor(rng() * 3);
    
    if (pattern === 0) {
      for (let i = 0; i < 5; i++) {
        coins.push({ x: 400 + i * 25, y: cy, w: 15, h: 15 });
      }
    } else if (pattern === 1) {
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          coins.push({ x: 400 + i * 25, y: cy + j * 25 - 25, w: 15, h: 15 });
        }
      }
    } else {
      for (let i = 0; i < 5; i++) {
        coins.push({ x: 400 + i * 25, y: cy + Math.sin(i) * 30, w: 15, h: 15 });
      }
    }
    nextSpawnDist = distance + 150 + Math.floor(rng() * 100);
    
  } else {
    let obstaclePos = rng();
    if (obstaclePos < 0.3) {
      let zw = 100 + Math.floor(rng() * 150);
      zappers.push({ x: 400, y: 0, w: zw, h: 40 });
    } else if (obstaclePos < 0.6) {
      let zw = 100 + Math.floor(rng() * 150);
      zappers.push({ x: 400, y: 360, w: zw, h: 40 });
    } else {
      let isVert = rng() < 0.5;
      if (isVert) {
        let zh = 100 + Math.floor(rng() * 100);
        let zy = 40 + Math.floor(rng() * (320 - zh));
        zappers.push({ x: 400, y: zy, w: 20, h: zh });
      } else {
        let zw = 100 + Math.floor(rng() * 100);
        let zy = 60 + Math.floor(rng() * 260);
        zappers.push({ x: 400, y: zy, w: zw, h: 20 });
      }
    }
    nextSpawnDist = distance + 150 + Math.floor(rng() * 100);
  }
}

function rectCollide(r1, r2) {
  return r1.x < r2.x + r2.w &&
         r1.x + r1.w > r2.x &&
         r1.y < r2.y + r2.h &&
         r1.y + r1.h > r2.y;
}

function drawEnvironment() {
  // Deep space tunnel background
  background(15, 15, 35);

  // Tunnel walls
  fill(30, 30, 50);
  noStroke();
  rect(0, 0, width, 20);
  rect(0, 380, width, 20);

  // Tunnel neon borders
  fill(0, 255, 255);
  rect(0, 18, width, 2);
  rect(0, 380, width, 2);

  // Energy Crystals (Coins)
  fill(0, 255, 200);
  for (let c of coins) {
    push();
    translate(c.x + c.w / 2, c.y + c.h / 2);
    rotate(PI / 4);
    rect(-c.w / 2, -c.h / 2, c.w, c.h);
    pop();
  }

  // Laser Obstacles (Zappers)
  for (let z of zappers) {
    fill(255, 50, 100);
    rect(z.x, z.y, z.w, z.h);
    
    // Bright laser core
    fill(255, 200, 255);
    if (z.w > z.h) {
       rect(z.x, z.y + z.h / 2 - 2, z.w, 4);
    } else {
       rect(z.x + z.w / 2 - 2, z.y, 4, z.h);
    }
  }

  // Triangle Spaceship Player
  fill(255, 220, 50);
  triangle(
    player.x, player.y, 
    player.x, player.y + player.h, 
    player.x + player.w, player.y + player.h / 2
  );

  // Spaceship Thruster Flame
  if (keyIsDown(32)) {
    fill(255, 100, 0);
    triangle(
      player.x - 12, player.y + player.h / 2,
      player.x, player.y + player.h * 0.2,
      player.x, player.y + player.h * 0.8
    );
  }
}