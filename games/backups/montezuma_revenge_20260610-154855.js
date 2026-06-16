let rng = null;
let score = 0;
let lives = 3;
let gameState = 'PLAYING';

const TILE_SIZE = 20;
const COLS = 20;
const ROWS = 20;
const GRAVITY = 0.6;
const MAX_FALL = 8;
const JUMP_FORCE = -8.5;
const SPEED = 3.5;
const CLIMB_SPEED = 2.5;

let mapGrid = [];
let enemies = [];
let keysList = [];
let treasure = null;
let player = null;

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
  lives = 3;
  gameState = 'PLAYING';
  generateLevel();
}

function generateLevel() {
  for (let r = 0; r < ROWS; r++) {
    mapGrid[r] = [];
    for (let c = 0; c < COLS; c++) {
      if (r === 0 || r === ROWS - 1 || c === 0 || c === COLS - 1) mapGrid[r][c] = 1;
      else mapGrid[r][c] = 0;
    }
  }

  let floorRows = [4, 9, 14, 18];
  for (let f of floorRows) {
    for (let c = 1; c < COLS - 1; c++) {
      mapGrid[f][c] = 1;
    }
  }

  let ladders = [];
  for (let i = 0; i < floorRows.length - 1; i++) {
    let topR = floorRows[i];
    let botR = floorRows[i + 1];
    let ladC = Math.floor(rng() * 14) + 3;
    mapGrid[topR][ladC] = 4; 
    for (let r = topR + 1; r < botR; r++) {
      mapGrid[r][ladC] = 2;
    }
    ladders.push({ f: topR, c: ladC });
  }

  for (let f of floorRows) {
    if (f !== 18) {
      let gap;
      let valid;
      let attempts = 0;
      do {
        valid = true;
        gap = Math.floor(rng() * 13) + 3;
        for (let l of ladders) {
          if (Math.abs(l.f - f) <= 5 && Math.abs(l.c - gap) <= 2) {
            valid = false;
          }
        }
        attempts++;
      } while (!valid && attempts < 50);

      if (valid) {
        mapGrid[f][gap] = 0;
        mapGrid[f][gap + 1] = 0;
      }
    }
  }

  mapGrid[2][14] = 1; 
  mapGrid[3][14] = 3; 
  treasure = { x: 17 * TILE_SIZE + TILE_SIZE / 2, y: 4 * TILE_SIZE - 6, active: true };

  keysList = [];
  let keyF = floorRows[Math.floor(rng() * 2) + 1]; 
  let keyC = Math.floor(rng() * 10) + 2;
  if (mapGrid[keyF][keyC] === 0) keyC++;
  keysList.push({ x: keyC * TILE_SIZE + TILE_SIZE / 2, y: keyF * TILE_SIZE - 5, active: true });

  enemies = [];
  for (let i = 1; i <= 3; i++) {
    let f = floorRows[i];
    let eCol = Math.floor(rng() * 10) + 5;
    if (mapGrid[f][eCol] === 0) continue; 
    enemies.push({
      x: eCol * TILE_SIZE + TILE_SIZE / 2,
      y: f * TILE_SIZE - 6,
      vx: (rng() > 0.5 ? 1 : -1) * (1 + rng() * 1.5),
      w: 12, h: 12
    });
  }

  player = {
    x: 2 * TILE_SIZE + TILE_SIZE / 2,
    y: 18 * TILE_SIZE - 6 - 0.1,
    w: 12, h: 12,
    vx: 0, vy: 0,
    isClimbing: false,
    keys: 0
  };
}

function getTile(c, r) {
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return 1;
  return mapGrid[r][c];
}

function checkCollisions(px, py, w, h, vy, downPressed) {
  let left = Math.floor((px - w / 2 + 0.1) / TILE_SIZE);
  let right = Math.floor((px + w / 2 - 0.1) / TILE_SIZE);
  let top = Math.floor((py - h / 2 + 0.1) / TILE_SIZE);
  let bottom = Math.floor((py + h / 2 - 0.1) / TILE_SIZE);

  for (let r = top; r <= bottom; r++) {
    for (let c = left; c <= right; c++) {
      let t = getTile(c, r);
      if (t === 1) return true;
      if (t === 3) {
        if (player.keys > 0) {
          mapGrid[r][c] = 0;
          player.keys--;
          score += 20;
          return false;
        }
        return true;
      }
      if (t === 4) {
        if (vy >= 0 && !downPressed && r === bottom) {
          return true;
        }
      }
    }
  }
  return false;
}

function die() {
  lives--;
  score = Math.max(0, score - 10);
  if (lives <= 0) {
    gameState = 'GAMEOVER';
  } else {
    player.x = 2 * TILE_SIZE + TILE_SIZE / 2;
    player.y = 18 * TILE_SIZE - player.h / 2 - 0.1;
    player.vx = 0;
    player.vy = 0;
    player.isClimbing = false;
  }
}

function draw() {
  if (gameState !== 'PLAYING') return;

  background(0);

  let downPressed = keyIsDown(40);
  
  if (keyIsDown(37) && !player.isClimbing) {
    player.vx = -SPEED;
  } else if (keyIsDown(39) && !player.isClimbing) {
    player.vx = SPEED;
  } else if (!player.isClimbing) {
    player.vx = 0;
  }

  player.x += player.vx;
  if (checkCollisions(player.x, player.y, player.w, player.h, 0, false)) {
    player.x -= player.vx;
  }

  let isGrounded = checkCollisions(player.x, player.y + 1.2, player.w, player.h, 1, downPressed);

  let cCenter = Math.floor(player.x / TILE_SIZE);
  let rCenter = Math.floor(player.y / TILE_SIZE);
  let rBottom = Math.floor((player.y + player.h / 2) / TILE_SIZE);
  let tCenter = getTile(cCenter, rCenter);
  let tBottom = getTile(cCenter, rBottom);

  if ((tCenter === 2 || tCenter === 4 || tBottom === 2 || tBottom === 4) && !player.isClimbing) {
    if (keyIsDown(38) || (keyIsDown(40) && !isGrounded)) {
      player.isClimbing = true;
      player.x = cCenter * TILE_SIZE + TILE_SIZE / 2; 
      player.vx = 0;
    }
  }

  if (player.isClimbing) {
    let tC = getTile(Math.floor(player.x / TILE_SIZE), Math.floor(player.y / TILE_SIZE));
    let tB = getTile(Math.floor(player.x / TILE_SIZE), Math.floor((player.y + player.h / 2) / TILE_SIZE));
    if (tC !== 2 && tC !== 4 && tB !== 2 && tB !== 4) {
      player.isClimbing = false;
    }
  }

  if (player.isClimbing) {
    player.vx = 0;
    if (keyIsDown(38)) player.vy = -CLIMB_SPEED;
    else if (keyIsDown(40)) player.vy = CLIMB_SPEED;
    else player.vy = 0;

    if (keyIsDown(37)) { player.isClimbing = false; player.vx = -SPEED; }
    if (keyIsDown(39)) { player.isClimbing = false; player.vx = SPEED; }
  } else {
    if (!isGrounded) {
      player.vy += GRAVITY;
      if (player.vy > MAX_FALL) player.vy = MAX_FALL;
    } else {
      player.vy = 0;
      player.y = Math.floor((player.y + player.h / 2 + 1) / TILE_SIZE) * TILE_SIZE - player.h / 2 - 0.1;
    }
  }

  if (player.vy !== 0 && !player.isClimbing) {
    player.y += player.vy;
    if (checkCollisions(player.x, player.y, player.w, player.h, player.vy, downPressed)) {
      if (player.vy > 0) {
        player.y = Math.floor((player.y + player.h / 2) / TILE_SIZE) * TILE_SIZE - player.h / 2 - 0.1;
        isGrounded = true;
      } else if (player.vy < 0) {
        player.y = Math.floor((player.y - player.h / 2) / TILE_SIZE + 1) * TILE_SIZE + player.h / 2 + 0.1;
      }
      player.vy = 0;
    }
  } else if (player.isClimbing) {
    player.y += player.vy;
    if (checkCollisions(player.x, player.y, player.w, player.h, player.vy, true)) {
      player.y -= player.vy;
      player.vy = 0;
    }
  }

  if (keyIsDown(32) && isGrounded && !player.isClimbing) {
    player.vy = JUMP_FORCE;
    player.y -= 1.2; 
  }

  for (let e of enemies) {
    e.x += e.vx;
    let dir = e.vx > 0 ? 1 : -1;
    let nextCol = Math.floor((e.x + (e.w / 2 + 1) * dir) / TILE_SIZE);
    let row = Math.floor(e.y / TILE_SIZE);
    let eFloorRow = Math.floor((e.y + e.h / 2 + 2) / TILE_SIZE);
    let eTileUnder = getTile(nextCol, eFloorRow);
    let eTileAhead = getTile(nextCol, row);

    if (eTileAhead === 1 || eTileAhead === 3 || eTileUnder === 0 || eTileUnder === 2) {
      e.vx *= -1;
    }

    if (Math.abs(player.x - e.x) < (player.w / 2 + e.w / 2) &&
        Math.abs(player.y - e.y) < (player.h / 2 + e.h / 2)) {
      die();
    }
  }

  for (let k of keysList) {
    if (k.active && Math.abs(player.x - k.x) < 15 && Math.abs(player.y - k.y) < 15) {
      k.active = false;
      player.keys++;
      score += 50;
    }
  }

  if (treasure.active && Math.abs(player.x - treasure.x) < 15 && Math.abs(player.y - treasure.y) < 15) {
    treasure.active = false;
    score += 1000;
    gameState = 'WIN';
  }

  noStroke();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      let t = mapGrid[r][c];
      if (t === 1 || t === 4) {
        fill(140, 70, 20); 
        rect(c * TILE_SIZE, r * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
      if (t === 4) {
        fill(0, 200, 255);
        rect(c * TILE_SIZE + 4, r * TILE_SIZE, TILE_SIZE - 8, 4);
      }
      if (t === 2) {
        fill(0, 200, 255);
        rect(c * TILE_SIZE + 4, r * TILE_SIZE, 3, TILE_SIZE);
        rect(c * TILE_SIZE + 13, r * TILE_SIZE, 3, TILE_SIZE);
        rect(c * TILE_SIZE + 4, r * TILE_SIZE + 4, 12, 3);
        rect(c * TILE_SIZE + 4, r * TILE_SIZE + 12, 12, 3);
      }
      if (t === 3) {
        fill(0, 255, 0); 
        rect(c * TILE_SIZE, r * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  fill(255, 255, 0);
  for (let k of keysList) {
    if (k.active) {
      rect(k.x - 5, k.y - 5, 10, 10);
    }
  }

  if (treasure.active) {
    fill(255, 0, 255);
    push();
    translate(treasure.x, treasure.y);
    rotate(PI / 4);
    rect(-7, -7, 14, 14);
    pop();
  }

  fill(255, 0, 0);
  for (let e of enemies) {
    ellipse(e.x, e.y, e.w, e.h);
  }

  fill(0, 100, 255);
  rect(player.x - player.w / 2, player.y - player.h / 2, player.w, player.h);

  fill(255, 0, 0);
  for (let i = 0; i < lives; i++) {
    rect(10 + i * 15, 10, 10, 10);
  }

  fill(255, 255, 0);
  for (let i = 0; i < player.keys; i++) {
    rect(380 - i * 15, 10, 10, 10);
  }
}