// ============================================================
// REQUIRED: p5.js lifecycle
// ============================================================

let score = 0;
let lives = 3;
let gameState = 'PLAYING';

let playerLane = 2;
let moveCooldown = 0;
let laserCooldown = 0;
let torpedoCooldown = 0;

let sector = 1;
let saucersKilled = 0;
let torpedoAmmo = 3;
let sectorClearTimer = 0;

let enemies = [];
let lasers = [];
let torpedoes = [];
let sentinel = null;
let spawnTimer = 0;

function setup() {
  createCanvas(400, 400);
}

function draw() {
  if (gameState !== 'PLAYING') {
    render();
    return;
  }

  updateInput();
  updateGameLogic();
  render();
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

  playerLane = 2;
  moveCooldown = 0;
  laserCooldown = 0;
  torpedoCooldown = 0;

  sector = 1;
  saucersKilled = 0;
  torpedoAmmo = 3;
  sectorClearTimer = 0;

  enemies = [];
  lasers = [];
  torpedoes = [];
  sentinel = { active: false, x: 0, dir: 1, done: false };
  spawnTimer = 30;
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

// ============================================================
// GAME LOGIC
// ============================================================

function getPosX(lane, y) {
  let vp_x = 200;
  let vp_y = 50;
  let bp_x = 40 + lane * 80; // Bottom points: 40, 120, 200, 280, 360
  let bp_y = 350;
  let t = (y - vp_y) / (bp_y - vp_y);
  return vp_x + t * (bp_x - vp_x);
}

function updateInput() {
  if (moveCooldown > 0) moveCooldown--;
  if (laserCooldown > 0) laserCooldown--;
  if (torpedoCooldown > 0) torpedoCooldown--;

  // LEFT (1)
  if (keyIsDown(37) && moveCooldown <= 0) {
    playerLane = Math.max(0, playerLane - 1);
    moveCooldown = 8;
  }
  // RIGHT (2)
  if (keyIsDown(39) && moveCooldown <= 0) {
    playerLane = Math.min(4, playerLane + 1);
    moveCooldown = 8;
  }
  // UP / TORPEDO (3)
  if (keyIsDown(38) && torpedoCooldown <= 0 && torpedoAmmo > 0) {
    torpedoes.push({ lane: playerLane, y: 350 });
    torpedoAmmo--;
    torpedoCooldown = 30;
  }
  // D / SPACE / LASER (5)
  if (keyIsDown(32) && laserCooldown <= 0) {
    lasers.push({ lane: playerLane, y: 350 });
    laserCooldown = 12;
  }
}

function updateGameLogic() {
  // Update Lasers
  for (let i = lasers.length - 1; i >= 0; i--) {
    lasers[i].y -= 12;
    if (lasers[i].y < 50) lasers.splice(i, 1);
  }

  // Update Torpedoes
  for (let i = torpedoes.length - 1; i >= 0; i--) {
    torpedoes[i].y -= 8;
    if (torpedoes[i].y < 40) torpedoes.splice(i, 1);
  }

  // Enemy Speed multiplier based on sector
  let currentEnemySpeed = 2.0 + (sector * 0.5);

  // Update Enemies
  for (let i = enemies.length - 1; i >= 0; i--) {
    let e = enemies[i];
    e.y += currentEnemySpeed;
    let e_removed = false;

    // Torpedo collision
    for (let j = torpedoes.length - 1; j >= 0; j--) {
      let t = torpedoes[j];
      if (t.lane === e.lane && Math.abs(t.y - e.y) < 20) {
        score += 50;
        torpedoes.splice(j, 1);
        enemies.splice(i, 1);
        e_removed = true;
        break;
      }
    }
    if (e_removed) continue;

    // Laser collision
    for (let j = lasers.length - 1; j >= 0; j--) {
      let l = lasers[j];
      if (l.lane === e.lane && Math.abs(l.y - e.y) < 20) {
        if (e.type === 0) {
          // Saucer: killed by laser
          score += 25;
          saucersKilled = Math.min(15, saucersKilled + 1);
          enemies.splice(i, 1);
          e_removed = true;
          lasers.splice(j, 1);
          break;
        } else if (e.type === 2) {
          // Rejuvenator: turns into debris if shot
          e.type = 1;
          lasers.splice(j, 1);
          break;
        }
        // If type === 1 (Debris), laser ignores it (passes through)
      }
    }
    if (e_removed) continue;

    // Player collision
    if (e.lane === playerLane && e.y >= 340 && e.y <= 360) {
      if (e.type === 2) {
        // Collect Rejuvenator
        score += 100;
        lives++;
      } else {
        // Hit by Saucer or Debris
        lives--;
        if (lives <= 0) gameState = 'GAMEOVER';
      }
      enemies.splice(i, 1);
      continue;
    }

    // Out of bounds
    if (e.y > 380) {
      enemies.splice(i, 1);
    }
  }

  // Spawning logic
  if (saucersKilled < 15) {
    spawnTimer--;
    if (spawnTimer <= 0) {
      let r = rng();
      let type = 0; // 0: Saucer, 1: Debris, 2: Rejuvenator
      if (r < 0.6) {
        type = 0;
      } else if (r < 0.9) {
        type = 1;
      } else {
        type = 2;
      }
      enemies.push({ lane: Math.floor(rng() * 5), y: 50, type: type });
      spawnTimer = Math.max(20, 60 - sector * 5);
    }
  } else if (!sentinel.active && !sentinel.done) {
    // Spawn Sentinel once 15 saucers are destroyed
    sentinel.active = true;
    sentinel.done = true;
    sentinel.dir = rng() < 0.5 ? 1 : -1;
    sentinel.x = sentinel.dir === 1 ? -20 : 420;
  }

  // Sentinel logic
  if (sentinel.active) {
    sentinel.x += sentinel.dir * (3 + sector * 0.2);

    // Sentinel Hit by Torpedo
    for (let j = torpedoes.length - 1; j >= 0; j--) {
      let t = torpedoes[j];
      let tx = getPosX(t.lane, t.y);
      if (t.y < 70 && Math.abs(tx - sentinel.x) < 30) {
        score += 300 + (torpedoAmmo * 50);
        sentinel.active = false;
        torpedoes.splice(j, 1);
        break;
      }
    }

    // Sentinel escapes
    if (sentinel.dir === 1 && sentinel.x > 450) sentinel.active = false;
    if (sentinel.dir === -1 && sentinel.x < -50) sentinel.active = false;
  }

  // Sector Clear logic
  if (sentinel.done && !sentinel.active && enemies.length === 0) {
    sectorClearTimer++;
    if (sectorClearTimer > 40) {
      sector++;
      score += 200;
      saucersKilled = 0;
      torpedoAmmo = 3;
      sentinel.done = false;
      sectorClearTimer = 0;
    }
  }
}

// ============================================================
// RENDERING
// ============================================================

function render() {
  background(0);

  // Draw Horizon and Perspective Grid
  stroke(0, 150, 150);
  strokeWeight(2);
  line(0, 50, 400, 50);
  for (let i = 0; i < 5; i++) {
    line(200, 50, 40 + i * 80, 350);
  }

  // Draw Lasers
  stroke(0, 255, 0);
  strokeWeight(3);
  for (let l of lasers) {
    let lx1 = getPosX(l.lane, l.y);
    let lx2 = getPosX(l.lane, l.y - 15);
    line(lx1, l.y, lx2, l.y - 15);
  }

  // Draw Torpedoes
  for (let t of torpedoes) {
    let tx1 = getPosX(t.lane, t.y);
    let tx2 = getPosX(t.lane, t.y - 20);
    stroke(255, 128, 0);
    strokeWeight(4);
    line(tx1, t.y, tx2, t.y - 20);
    noStroke();
    fill(255, 255, 0);
    ellipse(tx2, t.y - 20, 8, 8);
  }

  // Draw Enemies
  noStroke();
  for (let e of enemies) {
    let ex = getPosX(e.lane, e.y);
    let s = Math.max(0.15, (e.y - 50) / 300);

    if (e.type === 0) {
      // White Saucer
      fill(255);
      ellipse(ex, e.y, 40 * s, 20 * s);
      fill(0);
      ellipse(ex, e.y, 16 * s, 6 * s);
    } else if (e.type === 1) {
      // Brown Debris
      fill(150, 75, 0);
      rectMode(CENTER);
      rect(ex, e.y, 30 * s, 30 * s);
      rectMode(CORNER);
    } else if (e.type === 2) {
      // Yellow Rejuvenator
      fill(255, 255, 0);
      quad(
        ex, e.y - 20 * s,
        ex + 15 * s, e.y,
        ex, e.y + 20 * s,
        ex - 15 * s, e.y
      );
    }
  }

  // Draw Sentinel
  if (sentinel.active) {
    fill(255, 0, 255);
    noStroke();
    rect(sentinel.x - 20, 40, 40, 20);
    fill(0);
    rect(sentinel.x - 10, 45, 20, 10);
  }

  // Draw Player
  let px = getPosX(playerLane, 350);
  fill(0, 200, 255);
  noStroke();
  triangle(px, 340, px - 15, 360, px + 15, 360);

  // HUD: Sector Progress (Top Left)
  noStroke();
  for (let i = 0; i < 15; i++) {
    if (i < saucersKilled) fill(255);
    else fill(100);
    rect(10 + i * 8, 10, 6, 6);
  }

  // HUD: Lives (Bottom Left)
  fill(0, 200, 255);
  for (let i = 0; i < lives; i++) {
    rect(10 + i * 12, 380, 8, 8);
  }

  // HUD: Torpedo Ammo (Bottom Right)
  fill(255, 128, 0);
  for (let i = 0; i < torpedoAmmo; i++) {
    rect(380 - i * 12, 375, 6, 16);
  }
}