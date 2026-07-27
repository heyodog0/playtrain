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
let lives = 0;
let gameState = 'PLAYING';

let player, enemies, bullets, pickups, platforms, door, levelWidth, maxXReached;

function setup() {
  createCanvas(400, 400);
}

function resetGame(seed) {
  rng = mulberry32(seed);
  score = 0;
  lives = 3;
  gameState = 'PLAYING';
  levelWidth = 2500;
  maxXReached = 50;

  player = {
    x: 50, y: 300, w: 24, h: 24,
    vx: 0, vy: 0,
    facing: 1, aimUp: false, grounded: false,
    cooldown: 0, invuln: 0,
    gunLevel: 1, gunExp: 0
  };

  bullets = [];
  enemies = [];
  pickups = [];
  platforms = [];

  platforms.push({ x: 0, y: 360, w: levelWidth, h: 40 });
  platforms.push({ x: -20, y: 0, w: 20, h: 400 });
  platforms.push({ x: levelWidth, y: 0, w: 20, h: 400 });

  let curX = 300;
  while (curX < levelWidth - 400) {
    if (rng() > 0.4) {
      let py = 260 + Math.floor(rng() * 60) - 30;
      platforms.push({ x: curX, y: py, w: 80, h: 20 });
      if (rng() > 0.5) {
        enemies.push(createEnemy(curX + 30, py - 24));
      }
    } else {
      enemies.push(createEnemy(curX + 30, 360 - 24));
    }
    curX += 120 + Math.floor(rng() * 100);
  }

  door = { x: levelWidth - 80, y: 300, w: 40, h: 60 };
}

function createEnemy(x, y) {
  return {
    x: x, y: y, w: 24, h: 24,
    hp: 2,
    vx: (rng() > 0.5 ? 1 : -1) * 1.5,
    vy: 0
  };
}

function getGameState() {
  return { score: score, lives: lives, gameState: gameState };
}

function rectIntersect(r1, r2) {
  return r1.x < r2.x + r2.w &&
         r1.x + r1.w > r2.x &&
         r1.y < r2.y + r2.h &&
         r1.y + r1.h > r2.y;
}

function takeDamage() {
  lives--;
  if (lives <= 0) {
    gameState = 'GAMEOVER';
    return;
  }
  if (player.gunLevel > 1) {
    player.gunLevel--;
    player.gunExp = 0;
  }
  player.invuln = 60;
  score = Math.max(0, score - 5);
}

function draw() {
  if (gameState !== 'PLAYING') return;

  let moveX = 0;
  if (keyIsDown(37)) moveX = -1;
  if (keyIsDown(39)) moveX = 1;

  if (moveX !== 0) {
    player.vx = moveX * 4;
    player.facing = moveX;
  } else {
    player.vx = 0;
  }

  player.aimUp = keyIsDown(38);

  if (keyIsDown(32) && player.grounded) {
    player.vy = -10;
    player.grounded = false;
  }

  player.vy += 0.6; 

  player.x += player.vx;
  for (let p of platforms) {
    if (rectIntersect(player, p)) {
      if (player.vx > 0) player.x = p.x - player.w;
      else if (player.vx < 0) player.x = p.x + p.w;
      player.vx = 0;
    }
  }

  player.y += player.vy;
  player.grounded = false;
  for (let p of platforms) {
    if (rectIntersect(player, p)) {
      if (player.vy > 0) {
        player.y = p.y - player.h;
        player.grounded = true;
      } else if (player.vy < 0) {
        player.y = p.y + p.h;
      }
      player.vy = 0;
    }
  }

  if (player.x < 0) player.x = 0;
  if (player.y > 400) {
    lives = 0;
    gameState = 'GAMEOVER';
  }

  if (player.x > maxXReached) {
    let diff = player.x - maxXReached;
    if (diff >= 20) {
      score += Math.floor(diff / 20);
      maxXReached = player.x;
    }
  }

  if (player.cooldown <= 0) {
    let bw = 8 + player.gunLevel * 2;
    let bh = 8 + player.gunLevel * 2;
    let bvx = 0, bvy = 0;
    let speed = 6 + player.gunLevel * 2;
    
    if (player.aimUp) {
      bvy = -speed;
    } else {
      bvx = player.facing * speed;
    }
    
    bullets.push({
      x: player.x + player.w / 2 - bw / 2,
      y: player.y + player.h / 2 - bh / 2,
      w: bw, h: bh,
      vx: bvx, vy: bvy,
      life: 40,
      dmg: player.gunLevel
    });
    player.cooldown = 18 - (player.gunLevel * 2);
  } else {
    player.cooldown--;
  }

  for (let i = bullets.length - 1; i >= 0; i--) {
    let b = bullets[i];
    b.x += b.vx;
    b.y += b.vy;
    b.life--;
    let hit = false;
    
    if (b.life <= 0) hit = true;

    for (let p of platforms) {
      if (rectIntersect(b, p)) hit = true;
    }

    for (let j = enemies.length - 1; j >= 0; j--) {
      let e = enemies[j];
      if (rectIntersect(b, e)) {
        e.hp -= b.dmg;
        hit = true;
        if (e.hp <= 0) {
          score += 10;
          pickups.push({
            x: e.x + e.w / 2 - 6,
            y: e.y + e.h / 2 - 6,
            w: 12, h: 12, vy: -4
          });
          enemies.splice(j, 1);
        }
      }
    }
    if (hit) bullets.splice(i, 1);
  }

  for (let e of enemies) {
    e.vy += 0.6;
    e.x += e.vx;
    for (let p of platforms) {
      if (rectIntersect(e, p)) {
        if (e.vx > 0) e.x = p.x - e.w;
        else if (e.vx < 0) e.x = p.x + p.w;
        e.vx *= -1;
      }
    }
    
    e.y += e.vy;
    for (let p of platforms) {
      if (rectIntersect(e, p)) {
        if (e.vy > 0) e.y = p.y - e.h;
        else if (e.vy < 0) e.y = p.y + p.h;
        e.vy = 0;
      }
    }

    if (player.invuln <= 0 && rectIntersect(e, player)) {
      takeDamage();
    }
  }

  for (let i = pickups.length - 1; i >= 0; i--) {
    let pk = pickups[i];
    pk.vy += 0.6;
    pk.y += pk.vy;
    for (let p of platforms) {
      if (rectIntersect(pk, p)) {
        if (pk.vy > 0) {
          pk.y = p.y - pk.h;
          pk.vy = 0;
        }
      }
    }
    
    if (rectIntersect(pk, player)) {
      score += 5;
      player.gunExp++;
      if (player.gunLevel === 1 && player.gunExp >= 5) {
        player.gunLevel = 2;
        player.gunExp = 0;
      } else if (player.gunLevel === 2 && player.gunExp >= 5) {
        player.gunLevel = 3;
        player.gunExp = 0;
      }
      pickups.splice(i, 1);
    }
  }

  if (rectIntersect(player, door)) {
    score += 20;
    gameState = 'WIN';
  }

  if (player.invuln > 0) player.invuln--;

  background(20);
  noStroke();

  push();
  let camX = player.x - 100;
  if (camX < 0) camX = 0;
  if (camX > levelWidth - width) camX = levelWidth - width;
  translate(-camX, 0);

  fill(0, 255, 255);
  rect(door.x, door.y, door.w, door.h);

  fill(120);
  for (let p of platforms) rect(p.x, p.y, p.w, p.h);

  fill(0, 255, 0);
  for (let pk of pickups) rect(pk.x, pk.y, pk.w, pk.h);

  fill(255, 255, 0);
  for (let b of bullets) rect(b.x, b.y, b.w, b.h);

  fill(255, 40, 40);
  for (let e of enemies) rect(e.x, e.y, e.w, e.h);

  if (player.invuln === 0 || Math.floor(player.invuln / 5) % 2 === 0) {
    fill(0, 100, 255);
    rect(player.x, player.y, player.w, player.h);
    fill(255);
    if (player.aimUp) {
      rect(player.x + player.w / 2 - 4, player.y - 4, 8, 8);
    } else {
      rect(player.x + (player.facing > 0 ? player.w - 4 : -4), player.y + player.h / 2 - 4, 8, 8);
    }
  }
  pop();

  fill(255, 0, 0);
  for (let i = 0; i < lives; i++) rect(10 + i * 20, 10, 16, 16);
  
  fill(0, 200, 255);
  for (let i = 0; i < player.gunLevel; i++) rect(10 + i * 20, 32, 16, 16);
}