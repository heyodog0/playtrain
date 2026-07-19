let rng = null;
let score = 0;
let lives = 0;
let gameState = 'PLAYING';

let player;
let enemies = [];
let pBalls = [];
let eBalls = [];
let walls = [];
let door;

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
  rectMode(CORNER);
  ellipseMode(CENTER);
  noStroke();
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
  lives = 1;
  gameState = 'PLAYING';

  player = {
    x: 200,
    y: 350,
    r: 8,
    speed: 3,
    facingX: 0,
    facingY: -1,
    fireCooldown: 0
  };

  enemies = [];
  pBalls = [];
  eBalls = [];
  walls = [];

  let thick = 20;
  walls.push({ x: 0, y: 0, w: 180, h: thick, isLava: false }); 
  walls.push({ x: 220, y: 0, w: 180, h: thick, isLava: false });
  walls.push({ x: 0, y: 400 - thick, w: 400, h: thick, isLava: false });
  walls.push({ x: 0, y: 0, w: thick, h: 400, isLava: false });
  walls.push({ x: 400 - thick, y: 0, w: thick, h: 400, isLava: false });

  door = { x: 180, y: 0, w: 40, h: thick, isLava: false };

  let rooms = [{ x: thick, y: thick, w: 400 - 2 * thick, h: 400 - 2 * thick }];
  for (let i = 0; i < 2; i++) {
    if (rooms.length === 0) break;
    let idx = Math.floor(rng() * rooms.length);
    let r = rooms[idx];
    rooms.splice(idx, 1);

    let splitHorizontal = rng() > 0.5;
    let wallT = 16;
    let gap = 50;

    if (splitHorizontal && r.h > 120) {
      let wy = r.y + r.h * 0.3 + rng() * (r.h * 0.4);
      let gx = r.x + rng() * (r.w - gap);
      
      let w1 = { x: r.x, y: wy, w: gx - r.x, h: wallT, isLava: true };
      let w2 = { x: gx + gap, y: wy, w: r.x + r.w - (gx + gap), h: wallT, isLava: true };
      
      tryAddWall(w1);
      tryAddWall(w2);

      rooms.push({ x: r.x, y: r.y, w: r.w, h: wy - r.y });
      rooms.push({ x: r.x, y: wy + wallT, w: r.w, h: r.y + r.h - (wy + wallT) });
    } else if (!splitHorizontal && r.w > 120) {
      let wx = r.x + r.w * 0.3 + rng() * (r.w * 0.4);
      let gy = r.y + rng() * (r.h - gap);
      
      let w1 = { x: wx, y: r.y, w: wallT, h: gy - r.y, isLava: true };
      let w2 = { x: wx, y: gy + gap, w: wallT, h: r.y + r.h - (gy + gap), isLava: true };

      tryAddWall(w1);
      tryAddWall(w2);

      rooms.push({ x: r.x, y: r.y, w: wx - r.x, h: r.h });
      rooms.push({ x: wx + wallT, y: r.y, w: r.x + r.w - (wx + wallT), h: r.h });
    } else {
      rooms.push(r);
    }
  }

  let numEnemies = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < numEnemies; i++) {
    let ex, ey;
    let valid = false;
    let attempts = 0;
    while (!valid && attempts < 100) {
      ex = 30 + rng() * 340;
      ey = 30 + rng() * 200;
      valid = true;
      for (let w of walls) {
        if (circleRectCollide(ex, ey, 12, w)) {
          valid = false;
          break;
        }
      }
      attempts++;
    }
    
    let evx = (rng() > 0.5 ? 1 : -1) * (1 + rng());
    let evy = (rng() > 0.5 ? 1 : -1) * (1 + rng());
    if (rng() > 0.5) evx = 0; else evy = 0;

    enemies.push({
      x: ex,
      y: ey,
      r: 8,
      vx: evx,
      vy: evy,
      speed: 1.5,
      fireCooldown: Math.floor(30 + rng() * 60)
    });
  }
}

function tryAddWall(w) {
  let safe1 = { x: 170, y: 320, w: 60, h: 60 };
  let safe2 = { x: 170, y: 0, w: 60, h: 40 };
  if (!rectsOverlap(w, safe1) && !rectsOverlap(w, safe2)) {
    walls.push(w);
  }
}

function draw() {
  background(20);

  if (gameState !== 'PLAYING') {
    renderGame();
    return;
  }

  updatePlayer();
  updateEnemies();
  updateBalls();
  checkWinCondition();

  renderGame();
}

function updatePlayer() {
  let dx = 0, dy = 0;
  if (keyIsDown(37)) dx -= 1;
  if (keyIsDown(39)) dx += 1;
  if (keyIsDown(38)) dy -= 1;
  if (keyIsDown(40)) dy += 1;

  let len = Math.sqrt(dx * dx + dy * dy);
  if (len > 0) {
    dx /= len;
    dy /= len;
    player.facingX = dx;
    player.facingY = dy;
  }

  player.x += dx * player.speed;
  checkPlayerWallCollision('x', dx);

  player.y += dy * player.speed;
  checkPlayerWallCollision('y', dy);

  if (player.fireCooldown > 0) player.fireCooldown--;
  if (keyIsDown(32) && player.fireCooldown <= 0) {
    pBalls.push({
      x: player.x,
      y: player.y,
      r: 4,
      vx: player.facingX * 6,
      vy: player.facingY * 6,
      life: 100
    });
    player.fireCooldown = 20;
  }
}

function checkPlayerWallCollision(axis, moveDir) {
  if (gameState !== 'PLAYING') return;
  
  let hitList = [...walls];
  if (enemies.length > 0) hitList.push(door);

  for (let w of hitList) {
    if (circleRectCollide(player.x, player.y, player.r, w)) {
      if (w.isLava) {
        lives = 0;
        gameState = 'GAMEOVER';
        return;
      } else {
        if (axis === 'x') player.x -= moveDir * player.speed;
        if (axis === 'y') player.y -= moveDir * player.speed;
      }
    }
  }
}

function updateEnemies() {
  let hitList = [...walls];
  hitList.push(door);

  for (let i = enemies.length - 1; i >= 0; i--) {
    let e = enemies[i];

    e.x += e.vx * e.speed;
    let hitWallX = false;
    for (let w of hitList) {
      if (circleRectCollide(e.x, e.y, e.r, w)) { hitWallX = true; break; }
    }
    if (hitWallX) {
      e.x -= e.vx * e.speed;
      e.vx *= -1;
      if (rng() < 0.2) { e.vx = 0; e.vy = rng() > 0.5 ? 1 : -1; }
    }

    e.y += e.vy * e.speed;
    let hitWallY = false;
    for (let w of hitList) {
      if (circleRectCollide(e.x, e.y, e.r, w)) { hitWallY = true; break; }
    }
    if (hitWallY) {
      e.y -= e.vy * e.speed;
      e.vy *= -1;
      if (rng() < 0.2) { e.vy = 0; e.vx = rng() > 0.5 ? 1 : -1; }
    }

    if (e.fireCooldown > 0) {
      e.fireCooldown--;
    } else {
      let pdx = player.x - e.x;
      let pdy = player.y - e.y;
      if (Math.abs(pdx) < 20) {
        let dir = pdy > 0 ? 1 : -1;
        eBalls.push({ x: e.x, y: e.y, r: 4, vx: 0, vy: dir * 4, life: 100 });
        e.vx = 0;
        e.vy = dir;
        e.fireCooldown = Math.floor(60 + rng() * 40);
      } else if (Math.abs(pdy) < 20) {
        let dir = pdx > 0 ? 1 : -1;
        eBalls.push({ x: e.x, y: e.y, r: 4, vx: dir * 4, vy: 0, life: 100 });
        e.vy = 0;
        e.vx = dir;
        e.fireCooldown = Math.floor(60 + rng() * 40);
      }
    }

    if (circlesCollide(e, player)) {
      lives = 0;
      gameState = 'GAMEOVER';
    }
  }
}

function updateBalls() {
  let hitList = [...walls];
  if (enemies.length > 0) hitList.push(door);

  for (let i = pBalls.length - 1; i >= 0; i--) {
    let b = pBalls[i];
    b.x += b.vx;
    b.y += b.vy;
    b.life--;

    let destroy = b.life <= 0;

    if (!destroy) {
      for (let w of hitList) {
        if (circleRectCollide(b.x, b.y, b.r, w)) { destroy = true; break; }
      }
    }

    if (!destroy) {
      for (let j = enemies.length - 1; j >= 0; j--) {
        if (circlesCollide(b, enemies[j])) {
          enemies.splice(j, 1);
          score += 2;
          destroy = true;
          break;
        }
      }
    }

    if (destroy) pBalls.splice(i, 1);
  }

  for (let i = eBalls.length - 1; i >= 0; i--) {
    let b = eBalls[i];
    b.x += b.vx;
    b.y += b.vy;
    b.life--;

    let destroy = b.life <= 0;

    if (!destroy) {
      for (let w of hitList) {
        if (circleRectCollide(b.x, b.y, b.r, w)) { destroy = true; break; }
      }
    }

    if (!destroy && circlesCollide(b, player)) {
      lives = 0;
      gameState = 'GAMEOVER';
      destroy = true;
    }

    if (destroy) eBalls.splice(i, 1);
  }
}

function checkWinCondition() {
  if (enemies.length === 0 && gameState === 'PLAYING') {
    if (circleRectCollide(player.x, player.y, player.r, door)) {
      score += 10;
      gameState = 'WIN';
    }
  }
}

function renderGame() {
  for (let w of walls) {
    if (w.isLava) {
      fill(255, 100, 0);
    } else {
      fill(100, 100, 100);
    }
    rect(w.x, w.y, w.w, w.h);
  }

  if (enemies.length === 0) {
    fill(50, 255, 50);
  } else {
    fill(150, 0, 150);
  }
  rect(door.x, door.y, door.w, door.h);

  fill(255, 50, 50);
  for (let e of enemies) {
    circle(e.x, e.y, e.r * 2);
  }

  fill(200, 255, 255);
  for (let b of pBalls) {
    circle(b.x, b.y, b.r * 2);
  }

  fill(255, 150, 50);
  for (let b of eBalls) {
    circle(b.x, b.y, b.r * 2);
  }

  if (lives > 0) {
    fill(50, 150, 255);
    circle(player.x, player.y, player.r * 2);
  }
}

function circleRectCollide(cx, cy, cr, rectObj) {
  let testX = cx;
  let testY = cy;

  if (cx < rectObj.x) testX = rectObj.x;
  else if (cx > rectObj.x + rectObj.w) testX = rectObj.x + rectObj.w;

  if (cy < rectObj.y) testY = rectObj.y;
  else if (cy > rectObj.y + rectObj.h) testY = rectObj.y + rectObj.h;

  let distX = cx - testX;
  let distY = cy - testY;
  let distance = Math.sqrt((distX * distX) + (distY * distY));

  return distance <= cr;
}

function circlesCollide(c1, c2) {
  let dx = c1.x - c2.x;
  let dy = c1.y - c2.y;
  return (dx * dx + dy * dy) < (c1.r + c2.r) * (c1.r + c2.r);
}

function rectsOverlap(r1, r2) {
  return !(r2.x >= r1.x + r1.w ||
           r2.x + r2.w <= r1.x ||
           r2.y >= r1.y + r1.h ||
           r2.y + r2.h <= r1.y);
}