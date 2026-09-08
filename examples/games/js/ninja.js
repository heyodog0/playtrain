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

let player, goal;
let walls = [];
let bombs = [];
let stars = [];
let lavas = [];

function setup() {
  createCanvas(400, 400);
  noStroke();
}

function resetGame(seed) {
  rng = mulberry32(seed);
  score = 0;
  lives = 3;
  gameState = 'PLAYING';
  generateLevel();
}

function resetPlayer() {
  player = {
    x: 20,
    y: 160,
    w: 12,
    h: 12,
    vx: 0,
    vy: 0,
    charge: 0,
    facingRight: true,
    cooldown: 0,
    hasSupport: false
  };
  stars = [];
}

function generateLevel() {
  walls = [];
  bombs = [];
  lavas = [];
  stars = [];
  
  walls.push({ x: -20, y: 0, w: 20, h: 400 });
  walls.push({ x: 400, y: 0, w: 20, h: 400 });
  walls.push({ x: 0, y: -20, w: 400, h: 20 });
  
  lavas.push({ x: 0, y: 380, w: 400, h: 20 });
  
  walls.push({ x: 0, y: 200, w: 80, h: 200 });
  
  let cx = 80;
  let cy = 200;
  
  while (cx < 320) {
    let gap = 20 + Math.floor(rng() * 40);
    cx += gap;
    if (cx >= 320) break;
    
    cy += Math.floor(rng() * 80) - 40;
    cy = Math.max(100, Math.min(300, cy));
    
    let w = 40 + Math.floor(rng() * 40);
    if (cx + w > 340) w = 340 - cx;
    
    walls.push({ x: cx, y: cy, w: w, h: 400 - cy });
    
    if (rng() < 0.3) {
      bombs.push({ x: cx + w / 2 - 5, y: cy - 10, w: 10, h: 10 });
    }
    
    cx += w;
  }
  
  walls.push({ x: 340, y: cy, w: 60, h: 400 - cy });
  goal = { x: 360, y: cy - 20, w: 20, h: 20 };
  
  resetPlayer();
}

function getGameState() {
  return { score, lives, gameState };
}

function aabb(r1, r2) {
  return r1.x < r2.x + r2.w &&
         r1.x + r1.w > r2.x &&
         r1.y < r2.y + r2.h &&
         r1.y + r1.h > r2.y;
}

function update() {
  if (gameState !== 'PLAYING') return;

  let tx = 0;
  if (keyIsDown(37)) { tx = -1; player.facingRight = false; }
  if (keyIsDown(39)) { tx = 1; player.facingRight = true; }

  let mix = player.hasSupport ? 0.4 : 0.1;
  player.vx = player.vx * (1 - mix) + (tx * 5) * mix;

  if (keyIsDown(38)) {
    player.charge += 0.08;
    if (player.charge > 1) player.charge = 1;
  } else {
    if (player.charge > 0) {
      player.vy = -5 - (player.charge * 7);
      player.charge = 0;
      player.hasSupport = false;
    }
  }

  if (!player.hasSupport) {
    player.vy += 0.5;
  }

  if (player.cooldown > 0) player.cooldown--;
  
  if (keyIsDown(32) && player.cooldown === 0) {
    stars.push({
      x: player.x + player.w / 2 - 3,
      y: player.y + player.h / 2 - 3,
      w: 6,
      h: 6,
      vx: player.facingRight ? 8 : -8,
      vy: 0,
      life: 40
    });
    player.cooldown = 15;
  }

  player.x += player.vx;
  for (let w of walls) {
    if (aabb(player, w)) {
      if (player.vx > 0) player.x = w.x - player.w;
      else if (player.vx < 0) player.x = w.x + w.w;
      player.vx = 0;
    }
  }

  player.y += player.vy;
  player.hasSupport = false;
  for (let w of walls) {
    if (aabb(player, w)) {
      if (player.vy > 0) {
        player.y = w.y - player.h;
        player.hasSupport = true;
      } else if (player.vy < 0) {
        player.y = w.y + w.h;
      }
      player.vy = 0;
    }
  }

  for (let i = stars.length - 1; i >= 0; i--) {
    let s = stars[i];
    s.x += s.vx;
    s.life--;
    
    let hitWall = false;
    for (let w of walls) {
      if (aabb(s, w)) { hitWall = true; break; }
    }
    
    if (hitWall || s.life <= 0) {
      stars.splice(i, 1);
      continue;
    }
    
    let hitBomb = false;
    for (let j = bombs.length - 1; j >= 0; j--) {
      if (aabb(s, bombs[j])) {
        bombs.splice(j, 1);
        hitBomb = true;
        score += 2;
        break;
      }
    }
    
    if (hitBomb) {
      stars.splice(i, 1);
    }
  }

  let dead = false;
  for (let l of lavas) { if (aabb(player, l)) dead = true; }
  for (let b of bombs) { if (aabb(player, b)) dead = true; }
  if (player.y > 400) dead = true;

  if (dead) {
    lives--;
    score = Math.max(0, score - 2);
    if (lives > 0) {
      resetPlayer();
    } else {
      gameState = 'GAMEOVER';
    }
    return;
  }

  if (aabb(player, goal)) {
    score += 10;
    gameState = 'WIN';
  }
}

function draw() {
  update();

  background(17, 17, 17);
  noStroke();

  fill(85, 85, 85);
  for (let w of walls) rect(w.x, w.y, w.w, w.h);

  fill(255, 102, 0);
  for (let l of lavas) rect(l.x, l.y, l.w, l.h);

  fill(255, 221, 0);
  rect(goal.x, goal.y, goal.w, goal.h);

  fill(255, 0, 0);
  for (let b of bombs) ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w, b.h);

  fill(0, 255, 255);
  for (let s of stars) rect(s.x, s.y, s.w, s.h);

  fill(0, 136, 255);
  rect(player.x, player.y, player.w, player.h);

  if (player.charge > 0) {
    fill(0, 255, 0);
    rect(player.x, player.y - 6, player.w * player.charge, 4);
  }
}