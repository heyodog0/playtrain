// ============================================================
// REQUIRED: p5.js lifecycle
// ============================================================

function setup() {
  createCanvas(256, 256);
}

function draw() {
  if (gameState !== 'PLAYING') return;

  updatePlayer();
  updateBoss();
  updateBarriers();
  updateBullets();
  checkCollisions();

  drawGame();
}

// ============================================================
// REQUIRED: RL interface
// ============================================================

let score = 0;
let lives = 1;
let gameState = 'PLAYING';

function getGameState() {
  return {
    score: score,
    lives: lives,
    gameState: gameState
  };
}

let player;
let boss;
let playerBullets = [];
let enemyBullets = [];
let barriers = [];
let frameCounter = 0;

function resetGame(seed) {
  rng = mulberry32(seed);
  score = 0;
  lives = 1;
  gameState = 'PLAYING';
  frameCounter = 0;

  player = {
    x: 128, y: 230, w: 14, h: 14, speed: 4, cooldown: 0
  };

  boss = {
    x: 128, y: 64, r: 24, targetX: 128, targetY: 64, speed: 1.5,
    health: 30, maxHealth: 30,
    shielded: true, shieldTimer: 150,
    attackMode: Math.floor(rng() * 4), attackCooldown: 0
  };

  playerBullets = [];
  enemyBullets = [];
  barriers = [];

  let numBarriers = Math.floor(rng() * 3) + 2;
  for (let i = 0; i < numBarriers; i++) {
    barriers.push({
      x: 20 + rng() * 216,
      y: 120 + rng() * 60,
      w: 32,
      h: 12,
      vx: (rng() > 0.5 ? 1 : -1) * (1 + rng() * 1.5)
    });
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

// ============================================================
// GAME LOGIC
// ============================================================

function updatePlayer() {
  if (keyIsDown(37)) player.x -= player.speed;
  if (keyIsDown(39)) player.x += player.speed;
  if (keyIsDown(38)) player.y -= player.speed;
  if (keyIsDown(40)) player.y += player.speed;

  player.x = Math.max(player.w / 2, Math.min(256 - player.w / 2, player.x));
  player.y = Math.max(player.h / 2, Math.min(256 - player.h / 2, player.y));

  if (player.cooldown > 0) player.cooldown--;

  if (keyIsDown(32) && player.cooldown === 0) {
    playerBullets.push({
      x: player.x,
      y: player.y - player.h,
      vx: 0,
      vy: -6,
      w: 6,
      h: 10
    });
    player.cooldown = 10;
  }
}

function updateBoss() {
  frameCounter++;

  let dx = boss.targetX - boss.x;
  let dy = boss.targetY - boss.y;
  let dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 2) {
    boss.targetX = 40 + rng() * 176;
    boss.targetY = 40 + rng() * 60;
  } else {
    boss.x += (dx / dist) * boss.speed;
    boss.y += (dy / dist) * boss.speed;
  }

  boss.shieldTimer--;
  if (boss.shieldTimer <= 0) {
    boss.shielded = !boss.shielded;
    boss.shieldTimer = boss.shielded ? 200 : 100; 
    if (boss.shielded) {
      boss.attackMode = Math.floor(rng() * 4);
    }
  }

  boss.attackCooldown--;
  if (boss.attackCooldown <= 0) {
    if (boss.shielded) {
      bossActiveAttack();
    } else {
      bossPassiveAttack();
    }
  }
}

function bossFire(velX, velY) {
  enemyBullets.push({
    x: boss.x, y: boss.y, vx: velX, vy: velY, w: 8, h: 8
  });
}

function bossActiveAttack() {
  let mode = boss.attackMode;
  let speed = 3;
  
  if (mode === 0) {
    let px = player.x - boss.x;
    let py = player.y - boss.y;
    let mag = Math.sqrt(px * px + py * py) || 1;
    let spread = (rng() - 0.5) * 0.5;
    bossFire((px / mag + spread) * speed, (py / mag) * speed);
    boss.attackCooldown = 15;
  } else if (mode === 1) {
    for (let i = 0; i < 6; i++) {
      let angle = (Math.PI * 2 * i) / 6 + frameCounter * 0.1;
      bossFire(Math.cos(angle) * speed, Math.sin(angle) * speed);
    }
    boss.attackCooldown = 40;
  } else if (mode === 2) {
    let angle = (frameCounter % 60) * (Math.PI * 2 / 60);
    bossFire(Math.cos(angle) * speed, Math.sin(angle) * Math.abs(speed));
    boss.attackCooldown = 8;
  } else if (mode === 3) {
    bossFire((rng() - 0.5) * 4, speed * (0.5 + rng()));
    boss.attackCooldown = 10;
  }
}

function bossPassiveAttack() {
  if (rng() < 0.2) {
    bossFire((rng() - 0.5) * 2, 2 + rng() * 2);
  }
  boss.attackCooldown = 15;
}

function updateBarriers() {
  for (let b of barriers) {
    b.x += b.vx;
    if (b.x < 0) b.x = 256;
    if (b.x > 256) b.x = 0;
  }
}

function updateBullets() {
  for (let i = playerBullets.length - 1; i >= 0; i--) {
    let b = playerBullets[i];
    b.x += b.vx;
    b.y += b.vy;
    if (b.y < 0 || b.y > 256 || b.x < 0 || b.x > 256) {
      playerBullets.splice(i, 1);
    }
  }

  for (let i = enemyBullets.length - 1; i >= 0; i--) {
    let b = enemyBullets[i];
    b.x += b.vx;
    b.y += b.vy;
    if (b.y < 0 || b.y > 256 || b.x < 0 || b.x > 256) {
      enemyBullets.splice(i, 1);
    }
  }
}

function aabb(x1, y1, w1, h1, x2, y2, w2, h2) {
  return x1 - w1 / 2 < x2 + w2 / 2 &&
         x1 + w1 / 2 > x2 - w2 / 2 &&
         y1 - h1 / 2 < y2 + h2 / 2 &&
         y1 + h1 / 2 > y2 - h2 / 2;
}

function checkCollisions() {
  for (let i = playerBullets.length - 1; i >= 0; i--) {
    let pb = playerBullets[i];
    let hitBarrier = false;
    
    for (let b of barriers) {
      if (aabb(pb.x, pb.y, pb.w, pb.h, b.x, b.y, b.w, b.h)) {
        playerBullets.splice(i, 1);
        hitBarrier = true;
        break;
      }
    }
    if (hitBarrier) continue;

    let bossHitboxR = boss.shielded ? boss.r + 6 : boss.r;
    if (aabb(pb.x, pb.y, pb.w, pb.h, boss.x, boss.y, bossHitboxR * 2, bossHitboxR * 2)) {
      playerBullets.splice(i, 1);
      
      if (boss.shielded) {
        enemyBullets.push({
          x: pb.x, y: pb.y,
          vx: (rng() - 0.5) * 4, vy: 4,
          w: 8, h: 8
        });
      } else {
        boss.health--;
        score += 1;
        if (boss.health <= 0) {
          score += 10;
          gameState = 'WIN';
          return;
        }
      }
    }
  }

  for (let i = enemyBullets.length - 1; i >= 0; i--) {
    let eb = enemyBullets[i];
    let hitBarrier = false;
    for (let b of barriers) {
      if (aabb(eb.x, eb.y, eb.w, eb.h, b.x, b.y, b.w, b.h)) {
        enemyBullets.splice(i, 1);
        hitBarrier = true;
        break;
      }
    }
    if (hitBarrier) continue;

    if (aabb(eb.x, eb.y, eb.w, eb.h, player.x, player.y, player.w, player.h)) {
      lives = 0;
      gameState = 'GAMEOVER';
      return;
    }
  }

  for (let b of barriers) {
    if (aabb(player.x, player.y, player.w, player.h, b.x, b.y, b.w, b.h)) {
      lives = 0;
      gameState = 'GAMEOVER';
      return;
    }
  }

  let bossHitboxR = boss.shielded ? boss.r + 6 : boss.r;
  if (aabb(player.x, player.y, player.w, player.h, boss.x, boss.y, bossHitboxR * 2, bossHitboxR * 2)) {
    lives = 0;
    gameState = 'GAMEOVER';
    return;
  }
}

function drawGame() {
  background(20, 20, 30);

  noStroke();
  
  fill(150, 150, 150);
  for (let b of barriers) {
    rectMode(CENTER);
    rect(b.x, b.y, b.w, b.h);
  }

  fill(0, 255, 0);
  for (let b of playerBullets) {
    rectMode(CENTER);
    rect(b.x, b.y, b.w, b.h);
  }

  fill(255, 150, 0);
  for (let b of enemyBullets) {
    ellipse(b.x, b.y, b.w, b.h);
  }

  if (boss.shielded) {
    fill(255, 0, 255);
    ellipse(boss.x, boss.y, (boss.r + 8) * 2, (boss.r + 8) * 2);
  }
  
  if (boss.shieldTimer < 30 && frameCounter % 4 < 2) {
    fill(255, 255, 255);
  } else {
    fill(255, 50, 50);
  }
  ellipse(boss.x, boss.y, boss.r * 2, boss.r * 2);

  let hpWidth = 40;
  let hpFill = (boss.health / boss.maxHealth) * hpWidth;
  fill(100, 0, 0);
  rect(boss.x, boss.y - boss.r - 15, hpWidth, 4);
  fill(0, 255, 0);
  rectMode(CORNER);
  rect(boss.x - hpWidth/2, boss.y - boss.r - 17, hpFill, 4);
  rectMode(CENTER);

  fill(0, 150, 255);
  rectMode(CENTER);
  rect(player.x, player.y, player.w, player.h);
  
  fill(0, 200, 255);
  rect(player.x, player.y - player.h/2, player.w - 6, player.h - 6);

  fill(255, 255, 0);
  rectMode(CORNER);
  let scoreW = Math.min(score * 2, 256);
  rect(0, 252, scoreW, 4);
}