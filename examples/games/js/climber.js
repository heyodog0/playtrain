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
let blocks = [];
let coins = [];
let enemies = [];
let coin_quota = 0;
let cameraY = 0;

let spawnX, spawnY;

const BLOCK_SIZE = 20;
const WORLD_W = 20;
const WORLD_H = 64;

function setup() {
  createCanvas(400, 400);
}

function resetGame(seed) {
  rng = mulberry32(seed);
  score = 0;
  lives = 3;
  gameState = 'PLAYING';

  blocks = [];
  coins = [];
  enemies = [];
  coin_quota = 0;

  for (let y = 0; y < WORLD_H; y++) {
    blocks.push({ x: 0, y: y * BLOCK_SIZE, w: BLOCK_SIZE, h: BLOCK_SIZE });
    blocks.push({ x: (WORLD_W - 1) * BLOCK_SIZE, y: y * BLOCK_SIZE, w: BLOCK_SIZE, h: BLOCK_SIZE });
  }
  for (let x = 0; x < WORLD_W; x++) {
    blocks.push({ x: x * BLOCK_SIZE, y: (WORLD_H - 1) * BLOCK_SIZE, w: BLOCK_SIZE, h: BLOCK_SIZE });
    blocks.push({ x: x * BLOCK_SIZE, y: 0, w: BLOCK_SIZE, h: BLOCK_SIZE });
  }

  let curr_x = Math.floor(rng() * 12) + 4;
  let curr_y = WORLD_H - 1;

  spawnX = curr_x * BLOCK_SIZE;
  spawnY = curr_y * BLOCK_SIZE - 16;

  player = {
    x: spawnX,
    y: spawnY,
    w: 12,
    h: 16,
    vx: 0,
    vy: 0,
    supported: false
  };

  while (curr_y > 5) {
    let dy = Math.floor(rng() * 2) + 3; 
    curr_y -= dy;

    let plat_len = Math.floor(rng() * 6) + 3;
    let dir = rng() < 0.5 ? 1 : -1;
    if (curr_x < 5) dir = 1;
    if (curr_x > WORLD_W - 5) dir = -1;

    let plat_blocks = [];
    for (let j = 0; j < plat_len; j++) {
      let bx = curr_x + j * dir;
      if (bx <= 0 || bx >= WORLD_W - 1) break;
      blocks.push({ x: bx * BLOCK_SIZE, y: curr_y * BLOCK_SIZE, w: BLOCK_SIZE, h: BLOCK_SIZE });
      plat_blocks.push(bx);
    }

    if (plat_blocks.length >= 3 && rng() < 0.4) {
      let ex = plat_blocks[1];
      enemies.push({
        x: ex * BLOCK_SIZE + 4,
        y: curr_y * BLOCK_SIZE - 14,
        w: 12,
        h: 12,
        vx: (rng() < 0.5 ? -1 : 1) * 1.5,
        left_bound: Math.min(...plat_blocks) * BLOCK_SIZE,
        right_bound: Math.max(...plat_blocks) * BLOCK_SIZE + BLOCK_SIZE
      });
    }

    if (rng() < 0.5 || curr_y <= 8) {
      let cx = plat_blocks[Math.floor(rng() * plat_blocks.length)];
      coins.push({
        x: cx * BLOCK_SIZE + 5,
        y: curr_y * BLOCK_SIZE - 15,
        w: 10,
        h: 10
      });
      coin_quota++;
    }

    curr_x = plat_blocks[Math.floor(rng() * plat_blocks.length)];
  }
}

function getGameState() {
  return {
    score: score,
    lives: lives,
    gameState: gameState
  };
}

function AABB(r1, r2) {
  return r1.x < r2.x + r2.w &&
         r1.x + r1.w > r2.x &&
         r1.y < r2.y + r2.h &&
         r1.y + r1.h > r2.y;
}

function draw() {
  if (gameState !== 'PLAYING') return;

  let target_vx = 0;
  if (keyIsDown(37)) target_vx = -3.5;
  if (keyIsDown(39)) target_vx = 3.5;

  if (player.supported) {
    player.vx += (target_vx - player.vx) * 0.4;
  } else {
    player.vx += (target_vx - player.vx) * 0.15;
  }

  if ((keyIsDown(38) || keyIsDown(32)) && player.supported) {
    player.vy = -8.5;
    player.supported = false;
  }

  player.vy += 0.4;
  if (player.vy > 10) player.vy = 10;

  player.x += player.vx;
  for (let b of blocks) {
    if (AABB(player, b)) {
      if (player.vx > 0) player.x = b.x - player.w;
      else if (player.vx < 0) player.x = b.x + b.w;
      player.vx = 0;
    }
  }

  player.y += player.vy;
  player.supported = false;
  for (let b of blocks) {
    if (AABB(player, b)) {
      if (player.vy > 0) {
        player.y = b.y - player.h;
        player.supported = true;
      } else if (player.vy < 0) {
        player.y = b.y + b.h;
      }
      player.vy = 0;
    }
  }

  for (let i = enemies.length - 1; i >= 0; i--) {
    let e = enemies[i];
    e.x += e.vx;
    if (e.x <= e.left_bound || e.x + e.w >= e.right_bound) {
      e.vx *= -1;
      e.x += e.vx;
    }

    if (AABB(player, e)) {
      lives--;
      score -= 2;
      if (lives <= 0) {
        gameState = 'GAMEOVER';
      } else {
        player.x = spawnX;
        player.y = spawnY;
        player.vx = 0;
        player.vy = 0;
      }
    }
  }

  for (let i = coins.length - 1; i >= 0; i--) {
    let c = coins[i];
    if (AABB(player, c)) {
      score += 1;
      coins.splice(i, 1);
    }
  }

  if (coins.length === 0 && coin_quota > 0) {
    score += 10;
    gameState = 'WIN';
  }

  cameraY = player.y - 250;
  let maxCamY = WORLD_H * BLOCK_SIZE - height;
  if (cameraY > maxCamY) cameraY = maxCamY;
  if (cameraY < 0) cameraY = 0;

  background(17, 17, 17);
  push();
  translate(0, -cameraY);

  noStroke();
  fill(136, 136, 136);
  for (let b of blocks) {
    if (b.y + b.h > cameraY && b.y < cameraY + height) {
      rect(b.x, b.y, b.w, b.h);
    }
  }

  fill(255, 255, 0);
  for (let c of coins) {
    if (c.y + c.h > cameraY && c.y < cameraY + height) {
      rect(c.x, c.y, c.w, c.h);
    }
  }

  fill(255, 0, 0);
  for (let e of enemies) {
    if (e.y + e.h > cameraY && e.y < cameraY + height) {
      ellipse(e.x + e.w / 2, e.y + e.h / 2, Math.max(e.w, e.h));
    }
  }

  fill(0, 0, 255);
  rect(player.x, player.y, player.w, player.h);

  pop();
}