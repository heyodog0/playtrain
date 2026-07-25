let score;
let lives;
let gameState;

let player;
let enemies;
let divers;
let pBullets;
let eBullets;
let bubbles;

let enemyTimer;
let diverTimer;
let ticks;

const LANES = [100, 140, 180, 220, 260, 300, 340, 370];

function setup() {
  createCanvas(400, 400);
}

function draw() {
  if (gameState !== 'PLAYING') {
    renderGame();
    return;
  }

  ticks++;
  updatePlayer();
  updateEntities();
  checkCollisions();
  spawnEntities();

  renderGame();
}

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
  lives = 3;
  gameState = 'PLAYING';
  
  resetLevel();
}

function resetLevel() {
  player = {
    x: 200,
    y: 200,
    w: 24,
    h: 14,
    speed: 4,
    facing: 1, 
    oxygen: 100, 
    diverCount: 0, 
    cooldown: 0
  };
  
  enemies = [];
  divers = [];
  pBullets = [];
  eBullets = [];
  bubbles = [];
  
  enemyTimer = 20;
  diverTimer = 50;
  ticks = 0;
}

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

function updatePlayer() {
  if (keyIsDown(37)) { 
    player.x -= player.speed;
    player.facing = -1;
  }
  if (keyIsDown(39)) { 
    player.x += player.speed;
    player.facing = 1;
  }
  if (keyIsDown(38)) { 
    player.y -= player.speed;
  }
  if (keyIsDown(40)) { 
    player.y += player.speed;
  }

  player.x = Math.max(12, Math.min(width - 12, player.x));
  player.y = Math.max(30, Math.min(height - 15, player.y));

  if (player.cooldown > 0) {
    player.cooldown--;
  }
  if (keyIsDown(32) && player.cooldown === 0) {
    pBullets.push({
      x: player.x + (player.facing * 14),
      y: player.y,
      w: 8,
      h: 4,
      vx: player.facing * 6
    });
    player.cooldown = 15;
  }

  if (player.y < 70) {
    if (player.diverCount > 0) {
      score += player.diverCount * 50;
      player.diverCount = 0;
    }
    player.oxygen = Math.min(100, player.oxygen + 2.0);
  } else {
    player.oxygen -= 0.1;
    if (player.oxygen <= 0) {
      loseLife();
    }
  }
}

function updateEntities() {
  for (let i = pBullets.length - 1; i >= 0; i--) {
    let b = pBullets[i];
    b.x += b.vx;
    if (b.x < 0 || b.x > width) {
      pBullets.splice(i, 1);
    }
  }

  for (let i = eBullets.length - 1; i >= 0; i--) {
    let b = eBullets[i];
    b.x += b.vx;
    if (b.x < 0 || b.x > width) {
      eBullets.splice(i, 1);
    }
  }

  for (let i = enemies.length - 1; i >= 0; i--) {
    let e = enemies[i];
    e.x += e.vx;
    
    if (e.type === 'sub' && rng() < 0.005) {
      let facing = e.vx > 0 ? 1 : -1;
      eBullets.push({
        x: e.x + (facing * 12),
        y: e.y,
        w: 8,
        h: 4,
        vx: facing * 4
      });
    }

    if ((e.vx > 0 && e.x > width + 20) || (e.vx < 0 && e.x < -20)) {
      enemies.splice(i, 1);
    }
  }

  for (let i = divers.length - 1; i >= 0; i--) {
    let d = divers[i];
    d.x += d.vx;
    if ((d.vx > 0 && d.x > width + 20) || (d.vx < 0 && d.x < -20)) {
      divers.splice(i, 1);
    }
  }

  for (let i = bubbles.length - 1; i >= 0; i--) {
    let b = bubbles[i];
    b.y -= b.speed;
    if (b.y < 50) {
      bubbles.splice(i, 1);
    }
  }
}

function checkCollisions() {
  for (let i = pBullets.length - 1; i >= 0; i--) {
    let b = pBullets[i];
    let hit = false;
    for (let j = enemies.length - 1; j >= 0; j--) {
      let e = enemies[j];
      if (intersect(b.x, b.y, b.w, b.h, e.x, e.y, e.w, e.h)) {
        enemies.splice(j, 1);
        score += 20;
        hit = true;
        break;
      }
    }
    if (hit) {
      pBullets.splice(i, 1);
    }
  }

  for (let i = divers.length - 1; i >= 0; i--) {
    let d = divers[i];
    if (intersect(player.x, player.y, player.w, player.h, d.x, d.y, d.w, d.h)) {
      score += 10;
      if (player.diverCount < 6) {
        player.diverCount++;
      }
      divers.splice(i, 1);
    }
  }

  let playerHit = false;
  for (let i = 0; i < enemies.length; i++) {
    let e = enemies[i];
    if (intersect(player.x, player.y, player.w, player.h, e.x, e.y, e.w, e.h)) {
      playerHit = true;
      break;
    }
  }
  for (let i = 0; i < eBullets.length; i++) {
    let b = eBullets[i];
    if (intersect(player.x, player.y, player.w, player.h, b.x, b.y, b.w, b.h)) {
      playerHit = true;
      break;
    }
  }

  if (playerHit) {
    loseLife();
  }
}

function spawnEntities() {
  enemyTimer--;
  if (enemyTimer <= 0) {
    let lane = LANES[Math.floor(rng() * LANES.length)];
    let side = rng() < 0.5 ? -1 : 1;
    let type = rng() < 0.6 ? 'sub' : 'shark';
    
    enemies.push({
      x: side === -1 ? -20 : width + 20,
      y: lane,
      w: type === 'sub' ? 20 : 24,
      h: type === 'sub' ? 14 : 10,
      vx: side === -1 ? (1.5 + rng() * 1.5) : -(1.5 + rng() * 1.5),
      type: type
    });
    
    enemyTimer = 30 + Math.floor(rng() * 40);
  }

  diverTimer--;
  if (diverTimer <= 0) {
    let laneIdx = 2 + Math.floor(rng() * (LANES.length - 2));
    let lane = LANES[laneIdx];
    let side = rng() < 0.5 ? -1 : 1;
    
    divers.push({
      x: side === -1 ? -20 : width + 20,
      y: lane,
      w: 10,
      h: 10,
      vx: side === -1 ? 0.6 : -0.6
    });
    
    diverTimer = 80 + Math.floor(rng() * 80);
  }

  if (rng() < 0.15) {
    bubbles.push({
      x: rng() * width,
      y: height + 20,
      size: 4 + rng() * 12,
      speed: 1 + rng() * 2
    });
  }
}

function loseLife() {
  lives--;
  score = Math.max(0, score - 50); 
  if (lives <= 0) {
    gameState = 'GAMEOVER';
  } else {
    resetLevel();
  }
}

function intersect(x1, y1, w1, h1, x2, y2, w2, h2) {
  return Math.abs(x1 - x2) < (w1 + w2) / 2 &&
         Math.abs(y1 - y2) < (h1 + h2) / 2;
}

function renderGame() {
  background(40, 10, 0);

  noStroke();
  for (let i = 0; i < 4; i++) {
    fill(70 + i * 20, 20 + i * 10, 0, 180);
    beginShape();
    let yBase = 120 + i * 70;
    vertex(0, height);
    vertex(0, yBase);
    vertex(width, yBase);
    vertex(width, height);
    endShape(CLOSE);
  }

  fill(255, 120, 0, 40);
  for (let b of bubbles) {
    circle(b.x, b.y, b.size);
  }

  rectMode(CORNER);
  
  fill(20, 25, 40);
  rect(0, 0, width, 70);
  
  fill(30, 35, 50);
  for (let i = 0; i < width; i += 20) {
    let drop = 10 + ((i * 7) % 20);
    triangle(i, 70, i + 10, 70 + drop, i + 20, 70);
  }

  fill(0);
  rect(0, height - 10, width, 10);
  
  let shieldRatio = player.oxygen / 100;
  fill(255 * (1 - shieldRatio), 200 * shieldRatio, 255 * shieldRatio);
  rect(0, height - 10, shieldRatio * width, 10);

  fill(0, 255, 255);
  for (let i = 0; i < player.diverCount; i++) {
    circle(15 + i * 14, 15, 10);
  }

  rectMode(CENTER);
  noStroke();

  for (let d of divers) {
    push();
    translate(d.x, d.y);
    fill(200, 200, 255);
    quad(0, -d.h / 2, d.w / 2, 0, 0, d.h / 2, -d.w / 2, 0);
    fill(0, 255, 255, 180);
    circle(0, 0, d.w * 0.5);
    pop();
  }

  for (let e of enemies) {
    push();
    translate(e.x, e.y);
    let dir = e.vx > 0 ? 1 : -1;
    scale(dir, 1);

    if (e.type === 'sub') {
      fill(180);
      rect(0, 0, e.w, e.h, 3);
      fill(255, 150, 0);
      rect(-e.w * 0.2, 0, e.w * 0.4, e.h * 0.5, 2);
      fill(255, 0, 0);
      circle(e.w * 0.3, -e.h * 0.1, 4);
      stroke(200);
      strokeWeight(1.5);
      line(e.w * 0.1, -e.h / 2, e.w * 0.2, -e.h / 2 - 4);
      noStroke();
    } else {
      fill(255, 80, 80);
      let wag = 0;
      circle(-e.w * 0.4, wag, e.h * 0.8);
      circle(-e.w * 0.1, -wag, e.h * 0.9);
      circle(e.w * 0.2, wag * 0.5, e.h);
      fill(255, 200, 0);
      triangle(e.w * 0.2, -e.h * 0.4 + wag * 0.5, e.w * 0.6, wag * 0.5, e.w * 0.2, e.h * 0.4 + wag * 0.5);
      fill(0);
      circle(e.w * 0.3, -e.h * 0.2 + wag * 0.5, 3);
    }
    pop();
  }

  for (let b of pBullets) {
    push();
    translate(b.x, b.y);
    fill(100, 200, 255);
    rect(0, 0, b.w, b.h, 2);
    fill(255);
    circle(b.vx > 0 ? b.w / 4 : -b.w / 4, 0, b.h * 0.6);
    pop();
  }

  for (let b of eBullets) {
    push();
    translate(b.x, b.y);
    fill(255);
    stroke(255, 0, 0);
    strokeWeight(2);
    ellipse(0, 0, b.w, b.h * 1.5);
    noStroke();
    pop();
  }

  if (gameState === 'PLAYING') {
    push();
    translate(player.x, player.y);
    
    let isMovingUp = keyIsDown(38);
    let isMovingDown = keyIsDown(40);
    
    if (isMovingUp) {
      fill(0, 255, 255);
      triangle(-player.w * 0.3, player.h / 2, player.w * 0.3, player.h / 2, 0, player.h + 8);
    } else if (isMovingDown) {
      fill(0, 255, 255);
      triangle(-player.w * 0.3, -player.h / 2, player.w * 0.3, -player.h / 2, 0, -player.h - 8);
    }

    fill(50, 60, 80);
    ellipse(0, 0, player.w, player.h);
    
    fill(100, 200, 255);
    ellipse(player.facing * 4, -2, player.w * 0.4, player.h * 0.5);
    
    fill(200, 200, 255, 150);
    ellipse(-player.facing * (player.w / 2 + 2), 0, 6, 8);

    fill(150);
    rect(player.facing * 12, 0, 8, 4);
    pop();
  } else if (gameState === 'GAMEOVER') {
    fill(0, 0, 0, 180);
    rectMode(CORNER);
    rect(0, 0, width, height);
  }
}