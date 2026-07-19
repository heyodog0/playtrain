let rng = null;
let score = 0;
let lives = 3;
let gameState = 'PLAYING';

let player;
let pBullets;
let eBullets;
let enemies;
let fleetX;
let fleetY;
let fleetDir;
let fleetSpeed;
let enemyShootChance;

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let n = Math.imul(t ^ (t >>> 15), t | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

function setup() {
  createCanvas(400, 400);
  rectMode(CENTER);
  noStroke();
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

  player = { x: 200, y: 370, w: 24, h: 12, speed: 5, cooldown: 0 };
  pBullets = [];
  eBullets = [];
  enemies = [];

  // ALE-aligned: fleet speed, shoot rate, and fleet size are now deterministic.
  // The original per-episode randomization (4x range on speed/shoot, 28-45
  // enemies) made each episode a different difficulty, capping JS-clone
  // learning at ~score 450 because no single policy worked across the
  // difficulty distribution. ALE Space Invaders has fixed 5x6 = 30 invaders.
  fleetX = 0;
  fleetY = 0;
  fleetDir = 1;
  fleetSpeed = 1.0;
  enemyShootChance = 0.02;

  let rows = 5;
  let cols = 6;

  let gridWidth = cols * 32;
  let startX = (400 - gridWidth) / 2 + 16;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      enemies.push({
        baseX: startX + c * 32,
        baseY: 40 + r * 24,
        w: 18,
        h: 14,
        alive: true
      });
    }
  }
}

function draw() {
  background(0);

  if (gameState === 'PLAYING') {
    if (keyIsDown(37)) {
      player.x -= player.speed;
    }
    if (keyIsDown(39)) {
      player.x += player.speed;
    }
    
    if (player.x < player.w / 2) player.x = player.w / 2;
    if (player.x > width - player.w / 2) player.x = width - player.w / 2;

    if (player.cooldown > 0) {
      player.cooldown--;
    }

    if (keyIsDown(32) && player.cooldown <= 0) {
      pBullets.push({ x: player.x, y: player.y - player.h, w: 6, h: 14 });
      player.cooldown = 15;
    }

    let hitEdge = false;
    let aliveEnemies = [];
    
    for (let e of enemies) {
      if (e.alive) {
        aliveEnemies.push(e);
        let currentX = e.baseX + fleetX;
        if (currentX + e.w / 2 > width - 4 || currentX - e.w / 2 < 4) {
          hitEdge = true;
        }
      }
    }

    if (aliveEnemies.length === 0) {
      score += 100;
      gameState = 'WIN';
    } else {
      if (hitEdge) {
        fleetDir *= -1;
        fleetY += 16;
      }
      fleetX += fleetDir * fleetSpeed;

      for (let e of aliveEnemies) {
        let currentY = e.baseY + fleetY;
        if (currentY + e.h / 2 >= player.y - player.h / 2) {
          lives = 0;
          gameState = 'GAMEOVER';
        }
      }

      if (rng() < enemyShootChance) {
        let shooter = aliveEnemies[Math.floor(rng() * aliveEnemies.length)];
        eBullets.push({
          x: shooter.baseX + fleetX,
          y: shooter.baseY + fleetY + shooter.h / 2,
          w: 6,
          h: 14
        });
      }
    }

    for (let i = pBullets.length - 1; i >= 0; i--) {
      let b = pBullets[i];
      b.y -= 8;
      
      let hit = false;
      for (let e of enemies) {
        if (e.alive) {
          let ex = e.baseX + fleetX;
          let ey = e.baseY + fleetY;
          if (Math.abs(b.x - ex) < (b.w + e.w) / 2 && Math.abs(b.y - ey) < (b.h + e.h) / 2) {
            e.alive = false;
            hit = true;
            score += 10;
            break;
          }
        }
      }
      
      if (hit || b.y < 0) {
        pBullets.splice(i, 1);
      }
    }

    for (let i = eBullets.length - 1; i >= 0; i--) {
      let b = eBullets[i];
      b.y += 5;
      
      if (Math.abs(b.x - player.x) < (b.w + player.w) / 2 && Math.abs(b.y - player.y) < (b.h + player.h) / 2) {
        // ALE-aligned: no death penalty. Reward fires only on alien kills /
        // wave-clear bonus. Getting hit just consumes a life.
        lives--;
        eBullets = [];
        if (lives <= 0) {
          gameState = 'GAMEOVER';
        }
        break;
      } else if (b.y > height) {
        eBullets.splice(i, 1);
      }
    }
  }

  fill(0, 150, 255);
  rect(player.x, player.y, player.w, player.h);
  rect(player.x, player.y - player.h/2, player.w/2, player.h/2);

  fill(255, 50, 50);
  for (let e of enemies) {
    if (e.alive) {
      rect(e.baseX + fleetX, e.baseY + fleetY, e.w, e.h);
    }
  }

  fill(255, 255, 0);
  for (let b of pBullets) {
    rect(b.x, b.y, b.w, b.h);
  }

  fill(255, 0, 255);
  for (let b of eBullets) {
    rect(b.x, b.y, b.w, b.h);
  }

  fill(0, 255, 0);
  for (let i = 0; i < lives; i++) {
    rect(16 + i * 16, 16, 10, 10);
  }
}