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

let particles = [];
let stars = [];
let craters = [];

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
  
  player = { x: 60, y: 200, w: 30, h: 30, vy: 0 };
  coins = [];
  zappers = [];
  distance = 0;
  nextSpawnDist = 150; 
  frames = 0;
  
  particles = [];
  initEnvironment();
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

function initEnvironment() {
  stars = [];
  for (let i = 0; i < 60; i++) {
    let pseudoRand = Math.sin(i * 123.456) * 10000;
    pseudoRand -= Math.floor(pseudoRand);
    let pseudoRand2 = Math.cos(i * 321.654) * 10000;
    pseudoRand2 -= Math.floor(pseudoRand2);
    let pseudoRand3 = Math.sin(i * 999.111) * 10000;
    pseudoRand3 -= Math.floor(pseudoRand3);
    
    stars.push({
      id: i,
      x: pseudoRand * 400,
      y: pseudoRand2 * 400,
      size: pseudoRand3 * 2 + 1,
      speed: pseudoRand * 0.3 + 0.1
    });
  }
  
  craters = [];
  for (let i = 0; i < 15; i++) {
    let pseudoRand = Math.sin(i * 555.555) * 10000;
    pseudoRand -= Math.floor(pseudoRand);
    let pseudoRand2 = Math.cos(i * 777.777) * 10000;
    pseudoRand2 -= Math.floor(pseudoRand2);
    
    craters.push({
      x: pseudoRand * 400,
      y: pseudoRand2 < 0.5 ? 20 : 380,
      r: pseudoRand * 20 + 10
    });
  }
}

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

function drawLightning(x1, y1, x2, y2, segments, offsetAmount) {
  beginShape();
  vertex(x1, y1);
  for(let i = 1; i < segments; i++) {
    let t = i / segments;
    let lx = lerp(x1, x2, t);
    let ly = lerp(y1, y2, t);
    let offX = Math.sin(frames * 0.5 + i * 1.2 + x1) * offsetAmount;
    let offY = Math.cos(frames * 0.4 + i * 1.5 + y1) * offsetAmount;
    
    if (abs(x2 - x1) > abs(y2 - y1)) {
      ly += offY;
    } else {
      lx += offX;
    }
    vertex(lx, ly);
  }
  vertex(x2, y2);
  endShape();
}

function drawEnvironment() {
  background(15, 15, 30); 

  noStroke();
  for (let s of stars) {
    fill(255, 255, 255, 150 + Math.sin(frames * 0.05 + s.id * 10) * 100);
    if (gameState === 'PLAYING') {
      s.x -= s.speed;
      if (s.x < 0) s.x += width;
    }
    rect(s.x, s.y, s.size, s.size);
  }
  
  fill(80);
  rect(0, 0, width, 20);
  rect(0, 380, width, 20);
  
  for (let c of craters) {
    if (gameState === 'PLAYING') {
      c.x -= scrollSpeed;
      if (c.x < -30) {
        c.x = width + 30;
      }
    }
    fill(50);
    ellipse(c.x, c.y, c.r * 2.2, c.r * 1.2);
    fill(80);
    ellipse(c.x, c.y, c.r * 1.8, c.r * 0.8);
  }

  fill(0, 255, 200);
  stroke(0, 150, 150);
  strokeWeight(1);
  for (let c of coins) {
    let pulse = Math.sin(frames * 0.1 + c.x * 0.05) * 3;
    push();
    translate(c.x + c.w / 2, c.y + c.h / 2 + pulse);
    rotate(frames * 0.05 + c.x * 0.01);
    beginShape();
    vertex(0, -8);
    vertex(6, 0);
    vertex(0, 8);
    vertex(-6, 0);
    endShape(CLOSE);
    pop();
  }
  noStroke();

  for (let z of zappers) {
    let isHoriz = z.w > z.h;
    
    fill(100);
    if (isHoriz) {
      rect(z.x, z.y - 2, 10, z.h + 4, 3);
      rect(z.x + z.w - 10, z.y - 2, 10, z.h + 4, 3);
    } else {
      rect(z.x - 2, z.y, z.w + 4, 10, 3);
      rect(z.x - 2, z.y + z.h - 10, z.w + 4, 10, 3);
    }

    let pulse = Math.sin(frames * 0.15 + z.x * 0.01) * 3;
    fill(255, 0, 100, 120);
    if (isHoriz) {
      rect(z.x + 10, z.y - pulse, z.w - 20, z.h + pulse*2, 5);
    } else {
      rect(z.x - pulse, z.y + 10, z.w + pulse*2, z.h - 20, 5);
    }
    
    fill(255, 100, 150, 200);
    if (isHoriz) {
      rect(z.x + 10, z.y + z.h/2 - 2, z.w - 20, 4);
    } else {
      rect(z.x + z.w/2 - 2, z.y + 10, 4, z.h - 20);
    }
    
    stroke(255);
    strokeWeight(1.5);
    noFill();
    if (isHoriz) {
      drawLightning(z.x + 10, z.y + z.h/2, z.x + z.w - 10, z.y + z.h/2, Math.max(1, Math.floor(z.w/15)), 4);
    } else {
      drawLightning(z.x + z.w/2, z.y + 10, z.x + z.w/2, z.y + z.h - 10, Math.max(1, Math.floor(z.h/15)), 4);
    }
    noStroke();
  }

  push();
  translate(player.x, player.y);
  let tilt = player.vy * 0.05;
  translate(15, 15);
  rotate(tilt);
  translate(-15, -15);

  fill(160);
  rect(-3, 6, 9, 18, 3);
  
  fill(240);
  rect(6, 3, 18, 21, 6);
  
  fill(50, 200, 255);
  rect(15, 6, 9, 7.5, 3);
  
  fill(240);
  let onGround = (player.y + player.h >= 379);
  let legB1, legB2;
  if (onGround && gameState === 'PLAYING') {
    let runPhase = Math.sin(frames * 0.6);
    legB1 = runPhase > 0 ? 4.5 : 0;
    legB2 = runPhase <= 0 ? 4.5 : 0;
  } else {
    legB1 = player.vy < -1 ? 0 : 4.5; 
    legB2 = player.vy < -1 ? 4.5 : 0;
  }
  rect(9, 21, 6, 6 + legB1, 3);
  rect(18, 21, 6, 6 + legB2, 3);

  fill(200);
  rect(12, 12, 4.5, 7.5, 3);
  pop();

  if (gameState === 'PLAYING' && keyIsDown(32)) {
    particles.push({
      x: player.x + 1.5,
      y: player.y + 24,
      vx: -scrollSpeed * 0.5 - Math.sin(frames * 0.5),
      vy: 2 + Math.cos(frames * 0.5) * 2,
      life: 255
    });
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    let p = particles[i];
    if (gameState === 'PLAYING') {
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 20;
    }
    fill(50, 200, 255, p.life);
    rect(p.x, p.y, 4, 4, 2);
    if (p.life <= 0) {
      particles.splice(i, 1);
    }
  }
}