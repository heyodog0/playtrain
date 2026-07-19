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

let score = 0;
let lives = 3;
let gameState = 'PLAYING';

let player;
let platforms = [];
let enemies = [];
let coins = [];
let goal = null;
let cameraX = 0;

function setup() {
  createCanvas(400, 400);
}

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
  
  initLevel();
}

function initLevel() {
  player = { x: 50, y: 50, vx: 0, vy: 0, w: 20, h: 20, onGround: false, invincible: 0 };
  platforms = [];
  enemies = [];
  coins = [];
  cameraX = 0;
  
  let curX = 0;
  let levelLength = 2500;
  let groundY = 320;
  
  platforms.push({ x: 0, y: groundY, w: 250, h: 400 - groundY });
  curX = 250;
  
  while (curX < levelLength) {
    let gapType = Math.floor(rng() * 3);
    if (gapType === 1) curX += 40;
    else if (gapType === 2) curX += 80;
    
    let pw = 120 + Math.floor(rng() * 150);
    let py = groundY - Math.floor(rng() * 4) * 30;
    if (py > 360) py = 360;
    if (py < 200) py = 200;
    
    platforms.push({ x: curX, y: py, w: pw, h: 400 - py });
    
    if (rng() > 0.2) {
      let numCoins = 1 + Math.floor(rng() * 3);
      for (let i = 0; i < numCoins; i++) {
        let cx = curX + (pw / (numCoins + 1)) * (i + 1) - 6;
        let cy = py - 30 - Math.floor(rng() * 2) * 30;
        coins.push({ x: cx, y: cy, w: 12, h: 12, active: true });
      }
    }
    
    if (rng() > 0.4 && pw > 100) {
      let ex = curX + pw / 2 - 9;
      let ey = py - 18;
      let dir = rng() > 0.5 ? 1 : -1;
      let spd = 0.5 + rng() * 1.5;
      enemies.push({ x: ex, y: ey, vx: dir * spd, w: 18, h: 18, active: true, startX: curX, endX: curX + pw });
    }
    
    curX += pw;
  }
  
  curX += 50;
  platforms.push({ x: curX, y: groundY, w: 300, h: 400 - groundY });
  goal = { x: curX + 100, y: groundY - 150, w: 40, h: 150 };
}

function rectIntersect(r1, r2) {
  return r1.x < r2.x + r2.w &&
         r1.x + r1.w > r2.x &&
         r1.y < r2.y + r2.h &&
         r1.y + r1.h > r2.y;
}

function updatePhysics() {
  if (gameState !== 'PLAYING') return;
  
  if (keyIsDown(37)) player.vx -= 1.0;
  if (keyIsDown(39)) player.vx += 1.0;
  
  player.vx *= 0.8;
  
  if (keyIsDown(32) && player.onGround) {
    player.vy = -10.5;
    player.onGround = false;
  }
  
  player.vy += 0.5;
  if (player.vy > 12) player.vy = 12;
  
  player.x += player.vx;
  checkCollisions(true);
  
  let prevY = player.y;
  player.y += player.vy;
  player.onGround = false;
  checkCollisions(false);
  
  cameraX = player.x - 120;
  if (cameraX < 0) cameraX = 0;
  
  if (player.y > 450) {
    die();
  }
  
  for (let i = 0; i < enemies.length; i++) {
    let e = enemies[i];
    if (!e.active) continue;
    
    e.x += e.vx;
    if (e.x <= e.startX) { e.x = e.startX; e.vx *= -1; }
    if (e.x + e.w >= e.endX) { e.x = e.endX - e.w; e.vx *= -1; }
    
    if (player.invincible === 0 && rectIntersect(player, e)) {
      if (player.vy > 0 && prevY + player.h <= e.y + 10) {
        e.active = false;
        player.vy = -8;
        score += 20;
      } else {
        die();
      }
    }
  }
  
  for (let i = 0; i < coins.length; i++) {
    let c = coins[i];
    if (c.active && rectIntersect(player, c)) {
      c.active = false;
      score += 10;
    }
  }
  
  if (rectIntersect(player, goal)) {
    score += 100;
    gameState = 'WIN';
  }
  
  if (player.invincible > 0) {
    player.invincible--;
  }
}

function checkCollisions(isX) {
  for (let i = 0; i < platforms.length; i++) {
    let p = platforms[i];
    if (rectIntersect(player, p)) {
      if (isX) {
        if (player.vx > 0) {
          player.x = p.x - player.w;
          player.vx = 0;
        } else if (player.vx < 0) {
          player.x = p.x + p.w;
          player.vx = 0;
        }
      } else {
        if (player.vy > 0) {
          player.y = p.y - player.h;
          player.vy = 0;
          player.onGround = true;
        } else if (player.vy < 0) {
          player.y = p.y + p.h;
          player.vy = 0;
        }
      }
    }
  }
}

function die() {
  lives--;
  score = Math.max(0, score - 20);
  if (lives <= 0) {
    gameState = 'GAMEOVER';
  } else {
    player.x = 50;
    player.y = 50;
    player.vx = 0;
    player.vy = 0;
    cameraX = 0;
    player.invincible = 60;
  }
}

function draw() {
  updatePhysics();
  
  background(20, 20, 30);
  
  push();
  translate(-cameraX, 0);
  
  fill(34, 139, 34);
  noStroke();
  for (let i = 0; i < platforms.length; i++) {
    let p = platforms[i];
    rect(p.x, p.y, p.w, p.h);
  }
  
  fill(0, 255, 255);
  rect(goal.x, goal.y, goal.w, goal.h);
  
  fill(255, 255, 0);
  for (let i = 0; i < coins.length; i++) {
    let c = coins[i];
    if (c.active) {
      rect(c.x, c.y, c.w, c.h);
    }
  }
  
  fill(255, 50, 50);
  for (let i = 0; i < enemies.length; i++) {
    let e = enemies[i];
    if (e.active) {
      ellipse(e.x + e.w / 2, e.y + e.h / 2, e.w, e.h);
    }
  }
  
  if (player.invincible % 8 < 4) {
    fill(50, 150, 255);
    rect(player.x, player.y, player.w, player.h);
  }
  
  pop();
  
  fill(255, 50, 50);
  for (let i = 0; i < lives; i++) {
    rect(10 + i * 16, 10, 12, 12);
  }
  
  fill(255, 255, 0);
  rect(10, 28, Math.min(score, 1000) * 0.2, 8);
}