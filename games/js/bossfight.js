// ============================================================
// REQUIRED: p5.js lifecycle
// ============================================================

let score = 0;
let lives = 3;
let gameState = 'PLAYING';

let player;
let boss;
let bullets = [];
let enemyBullets = [];
let barriers = [];
let tickCount = 0;

function setup() {
  createCanvas(400, 400);
  noStroke();
}

function draw() {
  if (gameState !== 'PLAYING') {
    return;
  }

  background(20);
  tickCount++;

  // 1. Player Input & Movement
  let dx = 0;
  let dy = 0;
  if (keyIsDown(37)) dx -= 1; // LEFT
  if (keyIsDown(39)) dx += 1; // RIGHT
  if (keyIsDown(38)) dy -= 1; // UP
  if (keyIsDown(40)) dy += 1; // DOWN

  player.x += dx * player.speed;
  player.y += dy * player.speed;

  // Clamp player to screen
  player.x = constrain(player.x, 0, width - player.size);
  player.y = constrain(player.y, 0, height - player.size);

  // Player Shooting
  if (keyIsDown(32) && player.cd <= 0) { // SPACE (D Action)
    bullets.push({
      x: player.x + player.size / 2 - 4,
      y: player.y,
      w: 8,
      h: 16,
      vy: -8
    });
    player.cd = 10;
  }
  if (player.cd > 0) player.cd--;

  // 2. Boss Logic
  // Shield Swap
  boss.timer--;
  if (boss.timer <= 0) {
    boss.shieldsUp = !boss.shieldsUp;
    boss.timer = boss.shieldsUp ? 120 + Math.floor(rng() * 60) : 100 + Math.floor(rng() * 40);
    boss.attackMode = Math.floor(rng() * 4);
  }

  // Boss Movement
  boss.moveTimer--;
  if (boss.moveTimer <= 0) {
    boss.targetX = 20 + rng() * (width - 40 - boss.size);
    boss.targetY = 20 + rng() * 120; // Stay in upper region
    boss.moveTimer = 40 + Math.floor(rng() * 40);
  }
  boss.x += (boss.targetX - boss.x) * 0.05;
  boss.y += (boss.targetY - boss.y) * 0.05;

  // Boss Firing
  boss.fireTimer--;
  if (boss.fireTimer <= 0) {
    if (boss.shieldsUp) {
      fireBossPattern(boss.attackMode);
      boss.fireTimer = 35; 
    } else {
      // Passive firing when vulnerable
      let angle = Math.atan2((player.y - boss.y), (player.x - boss.x));
      fireEnemyBullet(boss.x + boss.size / 2, boss.y + boss.size / 2, Math.cos(angle) * 4, Math.sin(angle) * 4);
      boss.fireTimer = 50;
    }
  }

  // 3. Update Player Bullets
  for (let i = bullets.length - 1; i >= 0; i--) {
    let b = bullets[i];
    b.y += b.vy;
    let hit = false;

    // Hit Barriers
    for (let j = barriers.length - 1; j >= 0; j--) {
      let bar = barriers[j];
      if (aabb(b.x, b.y, b.w, b.h, bar.x, bar.y, bar.w, bar.h)) {
        hit = true;
        bar.hp--;
        if (bar.hp <= 0) barriers.splice(j, 1);
        break;
      }
    }
    if (hit) {
      bullets.splice(i, 1);
      continue;
    }

    // Hit Boss
    if (aabb(b.x, b.y, b.w, b.h, boss.x, boss.y, boss.size, boss.size)) {
      if (boss.shieldsUp) {
        // Reflected bullet
        enemyBullets.push({
          x: b.x, y: b.y, w: 10, h: 10,
          vx: (rng() - 0.5) * 6, vy: 5
        });
      } else {
        // Damage boss
        boss.hp--;
        score += 1;
        if (boss.hp <= 0) {
          boss.rounds--;
          if (boss.rounds <= 0) {
            score += 50;
            gameState = 'WIN';
          } else {
            score += 10;
            boss.hp = boss.maxHp;
            boss.shieldsUp = true;
            boss.timer = 150;
          }
        }
      }
      bullets.splice(i, 1);
      continue;
    }

    // Off screen
    if (b.y < -20) bullets.splice(i, 1);
  }

  // 4. Update Enemy Bullets
  for (let i = enemyBullets.length - 1; i >= 0; i--) {
    let b = enemyBullets[i];
    b.x += b.vx;
    b.y += b.vy;
    let hit = false;

    // Hit Barriers
    for (let j = barriers.length - 1; j >= 0; j--) {
      let bar = barriers[j];
      if (aabb(b.x, b.y, b.w, b.h, bar.x, bar.y, bar.w, bar.h)) {
        hit = true;
        bar.hp--;
        if (bar.hp <= 0) barriers.splice(j, 1);
        break;
      }
    }
    if (hit) {
      enemyBullets.splice(i, 1);
      continue;
    }

    // Hit Player
    if (aabb(b.x, b.y, b.w, b.h, player.x, player.y, player.size, player.size)) {
      lives--;
      score -= 5;
      if (lives <= 0) gameState = 'GAMEOVER';
      enemyBullets.splice(i, 1);
      continue;
    }

    // Off screen
    if (b.x < -20 || b.x > width + 20 || b.y < -20 || b.y > height + 20) {
      enemyBullets.splice(i, 1);
    }
  }

  // 5. Render
  // Draw Barriers
  fill(120);
  for (let bar of barriers) {
    rect(bar.x, bar.y, bar.w, bar.h);
  }

  // Draw Player Bullets
  fill(255, 255, 50);
  for (let b of bullets) {
    rect(b.x, b.y, b.w, b.h);
  }

  // Draw Enemy Bullets
  fill(255, 100, 50);
  for (let b of enemyBullets) {
    rect(b.x, b.y, b.w, b.h);
  }

  // Draw Player
  fill(50, 150, 255);
  rect(player.x, player.y, player.size, player.size);

  // Draw Boss
  if (boss.shieldsUp) {
    fill(50, 200, 255);
    rect(boss.x - 6, boss.y - 6, boss.size + 12, boss.size + 12);
  }
  fill(220, 50, 50);
  rect(boss.x, boss.y, boss.size, boss.size);

  // Boss HP indicator
  fill(0);
  rect(boss.x, boss.y - 12, boss.size, 6);
  fill(0, 255, 0);
  rect(boss.x, boss.y - 12, boss.size * (boss.hp / boss.maxHp), 6);

  // Draw Lives
  fill(0, 255, 0);
  for (let i = 0; i < lives; i++) {
    rect(10 + i * 15, height - 15, 10, 10);
  }
}

// ============================================================
// GAME LOGIC HELPERS
// ============================================================

function aabb(x1, y1, w1, h1, x2, y2, w2, h2) {
  return x1 < x2 + w2 && x1 + w1 > x2 && y1 < y2 + h2 && y1 + h1 > y2;
}

function fireEnemyBullet(bx, by, vx, vy) {
  enemyBullets.push({ x: bx - 5, y: by - 5, w: 10, h: 10, vx: vx, vy: vy });
}

function fireBossPattern(mode) {
  let bx = boss.x + boss.size / 2;
  let by = boss.y + boss.size / 2;
  
  if (mode === 0) {
    // Spread
    for (let i = -2; i <= 2; i++) {
      fireEnemyBullet(bx, by, i * 1.5, 4);
    }
  } else if (mode === 1) {
    // Cross
    let offset = rng() * Math.PI;
    for (let i = 0; i < 4; i++) {
      let a = offset + i * (Math.PI / 2);
      fireEnemyBullet(bx, by, Math.cos(a) * 4, Math.sin(a) * 4);
    }
  } else if (mode === 2) {
    // Ring
    for (let i = 0; i < 8; i++) {
      let a = (i / 8) * Math.PI * 2;
      fireEnemyBullet(bx, by, Math.cos(a) * 3, Math.sin(a) * 3);
    }
  } else if (mode === 3) {
    // Directed noisy shot
    let angle = Math.atan2((player.y - boss.y), (player.x - boss.x));
    angle += (rng() - 0.5) * 1.0;
    fireEnemyBullet(bx, by, Math.cos(angle) * 5, Math.sin(angle) * 5);
    boss.fireTimer = 20; 
  }
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
  lives = 3;
  gameState = 'PLAYING';
  tickCount = 0;

  player = {
    x: 188,
    y: 350,
    size: 24,
    speed: 5,
    cd: 0
  };

  let numRounds = 2 + Math.floor(rng() * 3); 
  let hpPerRound = 15;
  boss = {
    x: 176,
    y: 40,
    size: 48,
    rounds: numRounds,
    hp: hpPerRound,
    maxHp: hpPerRound,
    shieldsUp: true,
    timer: 100,
    vx: 0,
    vy: 0,
    targetX: 176,
    targetY: 40,
    attackMode: Math.floor(rng() * 4),
    moveTimer: 0,
    fireTimer: 30
  };

  bullets = [];
  enemyBullets = [];
  barriers = [];

  // Spawn barriers
  let numBarriers = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < numBarriers; i++) {
    barriers.push({
      x: 30 + rng() * (width - 80),
      y: 160 + rng() * 100,
      w: 30 + rng() * 20,
      h: 20 + rng() * 10,
      hp: 3 + Math.floor(rng() * 4)
    });
  }
}

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