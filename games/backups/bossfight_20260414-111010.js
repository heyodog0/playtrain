let rng = null;

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) | 0;
    let n = Math.imul(t ^ (t >>> 15), t | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

let player, boss, barriers, playerBullets, enemyBullets;
let score, lives, gameState;
let gameTimer = 0;
let lastFireTime = 0;
let bossPhaseTimer = 0;
let bossTargetX, bossTargetY;
let bossAttackMode = 0;

const CANVAS_SIZE = 400;
const PLAYER_SIZE = 20;
const BOSS_SIZE = 50;
const SHIELD_SIZE = 70;
const BULLET_SIZE = 8;
const BARRIER_SIZE = 30;

const PLAYER_SPEED = 4;
const BOSS_SPEED = 2;
const BULLET_SPEED = 5;
const FIRE_COOLDOWN = 15;

function setup() {
  createCanvas(CANVAS_SIZE, CANVAS_SIZE);
  noStroke();
}

function resetGame(seed) {
  rng = mulberry32(seed);
  score = 0;
  lives = 3;
  gameState = 'PLAYING';
  gameTimer = 0;

  player = {
    x: CANVAS_SIZE / 2,
    y: CANVAS_SIZE - 40,
    w: PLAYER_SIZE,
    h: PLAYER_SIZE
  };

  boss = {
    x: CANVAS_SIZE / 2,
    y: 80,
    r: BOSS_SIZE / 2,
    health: 20,
    maxHealth: 20,
    shieldUp: true,
    vx: 0,
    vy: 0,
    nextMoveTime: 0
  };

  bossTargetX = boss.x;
  bossTargetY = boss.y;

  barriers = [];
  let numBarriers = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < numBarriers; i++) {
    barriers.push({
      x: 50 + rng() * (CANVAS_SIZE - 100),
      y: 150 + rng() * 100,
      w: BARRIER_SIZE,
      h: BARRIER_SIZE,
      hp: 5
    });
  }

  playerBullets = [];
  enemyBullets = [];
}

function draw() {
  if (gameState !== 'PLAYING') return;

  background(0);
  gameTimer++;

  updatePlayer();
  updateBoss();
  updateBullets();
  checkCollisions();

  drawBarriers();
  drawBullets();
  drawBoss();
  drawPlayer();
  drawHUD();
}

function updatePlayer() {
  if (keyIsDown(37)) player.x -= PLAYER_SPEED; // LEFT
  if (keyIsDown(39)) player.x += PLAYER_SPEED; // RIGHT
  if (keyIsDown(38)) player.y -= PLAYER_SPEED; // UP
  if (keyIsDown(40)) player.y += PLAYER_SPEED; // DOWN

  player.x = constrain(player.x, player.w / 2, CANVAS_SIZE - player.w / 2);
  player.y = constrain(player.y, player.h / 2, CANVAS_SIZE - player.h / 2);

  if (keyIsDown(32) && gameTimer - lastFireTime > FIRE_COOLDOWN) {
    playerBullets.push({
      x: player.x,
      y: player.y - 10,
      vx: 0,
      vy: -BULLET_SPEED
    });
    lastFireTime = gameTimer;
  }
}

function updateBoss() {
  // Movement
  if (gameTimer >= boss.nextMoveTime) {
    bossTargetX = BOSS_SIZE + rng() * (CANVAS_SIZE - BOSS_SIZE * 2);
    bossTargetY = BOSS_SIZE + rng() * 100;
    let angle = atan2(bossTargetY - boss.y, bossTargetX - boss.x);
    boss.vx = cos(angle) * BOSS_SPEED;
    boss.vy = sin(angle) * BOSS_SPEED;
    boss.nextMoveTime = gameTimer + 60 + rng() * 60;
  }

  boss.x += boss.vx;
  boss.y += boss.vy;

  // Phase logic
  bossPhaseTimer++;
  if (bossPhaseTimer > 180) {
    boss.shieldUp = !boss.shieldUp;
    bossPhaseTimer = 0;
    bossAttackMode = Math.floor(rng() * 4);
  }

  // Attack logic
  if (boss.shieldUp) {
    if (gameTimer % 20 === 0) {
      if (bossAttackMode === 0) { // Fan
        for (let i = -2; i <= 2; i++) {
          spawnEnemyBullet(boss.x, boss.y, i * 0.4, BULLET_SPEED * 0.7);
        }
      } else if (bossAttackMode === 1) { // Radial
        let count = 8;
        for (let i = 0; i < count; i++) {
          let a = (i / count) * TWO_PI + (gameTimer * 0.05);
          spawnEnemyBullet(boss.x, boss.y, cos(a) * 3, sin(a) * 3);
        }
      } else if (bossAttackMode === 2) { // Spinning streams
        let a = gameTimer * 0.1;
        spawnEnemyBullet(boss.x, boss.y, cos(a) * 4, sin(a) * 4);
        spawnEnemyBullet(boss.x, boss.y, cos(a + PI) * 4, sin(a + PI) * 4);
      } else { // Focused
        let a = atan2(player.y - boss.y, player.x - boss.x);
        spawnEnemyBullet(boss.x, boss.y, cos(a) * 5, sin(a) * 5);
      }
    }
  } else {
    // Passive fire when vulnerable
    if (gameTimer % 40 === 0) {
      spawnEnemyBullet(boss.x, boss.y, (rng() - 0.5) * 2, 4);
    }
  }
}

function spawnEnemyBullet(x, y, vx, vy) {
  enemyBullets.push({ x, y, vx, vy });
}

function updateBullets() {
  for (let i = playerBullets.length - 1; i >= 0; i--) {
    let b = playerBullets[i];
    b.x += b.vx;
    b.y += b.vy;
    if (b.y < 0 || b.y > CANVAS_SIZE || b.x < 0 || b.x > CANVAS_SIZE) {
      playerBullets.splice(i, 1);
    }
  }

  for (let i = enemyBullets.length - 1; i >= 0; i--) {
    let b = enemyBullets[i];
    b.x += b.vx;
    b.y += b.vy;
    if (b.y < 0 || b.y > CANVAS_SIZE || b.x < 0 || b.x > CANVAS_SIZE) {
      enemyBullets.splice(i, 1);
    }
  }
}

function checkCollisions() {
  // Player bullets hits
  for (let i = playerBullets.length - 1; i >= 0; i--) {
    let b = playerBullets[i];

    // Hit Barriers
    let hitBarrier = false;
    for (let bar of barriers) {
      if (rectCircleIntersect(bar.x, bar.y, bar.w, bar.h, b.x, b.y, BULLET_SIZE / 2)) {
        bar.hp--;
        playerBullets.splice(i, 1);
        hitBarrier = true;
        break;
      }
    }
    if (hitBarrier) continue;

    // Hit Boss
    let distToBoss = dist(b.x, b.y, boss.x, boss.y);
    if (boss.shieldUp) {
      if (distToBoss < SHIELD_SIZE / 2) {
        // Reflect bullet
        b.vy = -b.vy * 0.5;
        b.vx = (rng() - 0.5) * 4;
        enemyBullets.push(b);
        playerBullets.splice(i, 1);
        continue;
      }
    } else {
      if (distToBoss < boss.r) {
        boss.health--;
        score += 10;
        playerBullets.splice(i, 1);
        if (boss.health <= 0) {
          score += 500;
          gameState = 'WIN';
        }
        continue;
      }
    }
  }

  // Enemy bullets hits player
  for (let i = enemyBullets.length - 1; i >= 0; i--) {
    let b = enemyBullets[i];
    if (dist(b.x, b.y, player.x, player.y) < (PLAYER_SIZE / 2 + BULLET_SIZE / 2)) {
      enemyBullets.splice(i, 1);
      lives--;
      score = Math.max(0, score - 50);
      if (lives <= 0) {
        gameState = 'GAMEOVER';
      }
    }
  }

  // Barriers removal
  for (let i = barriers.length - 1; i >= 0; i--) {
    if (barriers[i].hp <= 0) {
      barriers.splice(i, 1);
      score += 20;
    }
  }
}

function rectCircleIntersect(rx, ry, rw, rh, cx, cy, cr) {
  let testX = cx;
  let testY = cy;
  if (cx < rx) testX = rx;
  else if (cx > rx + rw) testX = rx + rw;
  if (cy < ry) testY = ry;
  else if (cy > ry + rh) testY = ry + rh;
  let d = dist(cx, cy, testX, testY);
  return d <= cr;
}

function drawPlayer() {
  fill(0, 0, 255);
  rectMode(CENTER);
  rect(player.x, player.y, player.w, player.h);
}

function drawBoss() {
  if (boss.shieldUp) {
    fill(0, 255, 255, 100);
    ellipse(boss.x, boss.y, SHIELD_SIZE);
    stroke(0, 255, 255);
    noFill();
    ellipse(boss.x, boss.y, SHIELD_SIZE + 4 * sin(gameTimer * 0.1));
    noStroke();
  }
  fill(255, 0, 0);
  ellipse(boss.x, boss.y, boss.r * 2);
  
  // Health bar
  fill(50);
  rect(boss.x, boss.y - 40, 60, 6);
  fill(255, 0, 0);
  rectMode(CORNER);
  rect(boss.x - 30, boss.y - 43, 60 * (boss.health / boss.maxHealth), 6);
  rectMode(CENTER);
}

function drawBarriers() {
  fill(100);
  for (let bar of barriers) {
    rectMode(CORNER);
    rect(bar.x, bar.y, bar.w, bar.h);
    // Health indicator
    fill(150);
    rect(bar.x, bar.y, bar.w * (bar.hp / 5), 4);
    fill(100);
  }
  rectMode(CENTER);
}

function drawBullets() {
  fill(0, 255, 0);
  for (let b of playerBullets) {
    rect(b.x, b.y, BULLET_SIZE, BULLET_SIZE);
  }
  fill(255, 165, 0);
  for (let b of enemyBullets) {
    ellipse(b.x, b.y, BULLET_SIZE);
  }
}

function drawHUD() {
  // Score indicator
  fill(255);
  rectMode(CORNER);
  rect(10, 10, score * 0.1, 10);
  
  // Lives indicator
  fill(0, 0, 255);
  for (let i = 0; i < lives; i++) {
    rect(10 + i * 15, 25, 10, 10);
  }
}

function getGameState() {
  return {
    score: score,
    lives: lives,
    gameState: gameState
  };
}