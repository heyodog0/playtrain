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
// Game Logic
// ============================================================
const COLS = 15;
const ROWS = 15;
const CELL_W = 400 / COLS;
const CELL_H = 400 / ROWS;
const MAX_ENEMIES = 3;
const EGG_TIMEOUT = 50;
const EAT_TIMEOUT = 150;

let player;
let enemies = [];
let eggs = [];
let smallOrbs = [];
let largeOrbs = [];
let grid = []; 
let eatTimer = 0;
let score = 0;
let lives = 3;
let gameState = 'PLAYING';
let totalSmallOrbs = 0;
let orbsCollected = 0;

function setup() {
  createCanvas(400, 400);
}

function resetGame(seed) {
  rng = mulberry32(seed);
  score = 0;
  lives = 3;
  gameState = 'PLAYING';
  generateLevel();
}

function getGameState() {
  return { score: score, lives: lives, gameState: gameState };
}

function generateLevel() {
  grid = [];
  for (let c = 0; c < COLS; c++) {
    grid[c] = [];
    for (let r = 0; r < ROWS; r++) {
      grid[c][r] = 1; 
    }
  }
  
  let stack = [];
  let startC = 1;
  let startR = 1;
  grid[startC][startR] = 0;
  stack.push({c: startC, r: startR});
  
  let dirs = [{dc: 0, dr: -2}, {dc: 2, dr: 0}, {dc: 0, dr: 2}, {dc: -2, dr: 0}];
  
  while (stack.length > 0) {
    let curr = stack[stack.length - 1];
    
    // Shuffle directions for procedural generation
    for (let i = dirs.length - 1; i > 0; i--) {
      let j = Math.floor(rng() * (i + 1));
      let temp = dirs[i];
      dirs[i] = dirs[j];
      dirs[j] = temp;
    }
    
    let moved = false;
    for (let d of dirs) {
      let nc = curr.c + d.dc;
      let nr = curr.r + d.dr;
      if (nc > 0 && nc < COLS - 1 && nr > 0 && nr < ROWS - 1 && grid[nc][nr] === 1) {
        grid[curr.c + d.dc/2][curr.r + d.dr/2] = 0;
        grid[nc][nr] = 0;
        stack.push({c: nc, r: nr});
        moved = true;
        break;
      }
    }
    if (!moved) {
      stack.pop();
    }
  }
  
  // Remove dead ends to create a proper map
  for (let c = 1; c < COLS - 1; c++) {
    for (let r = 1; r < ROWS - 1; r++) {
      if (grid[c][r] === 0) {
        let wallCount = 0;
        let wallNeighbors = [];
        let neighbors = [{dc: 0, dr: -1}, {dc: 1, dr: 0}, {dc: 0, dr: 1}, {dc: -1, dr: 0}];
        for (let d of neighbors) {
          let nc = c + d.dc;
          let nr = r + d.dr;
          if (grid[nc][nr] === 1) {
            wallCount++;
            if (nc > 0 && nc < COLS - 1 && nr > 0 && nr < ROWS - 1) {
              wallNeighbors.push({c: nc, r: nr});
            }
          }
        }
        if (wallCount >= 3 && wallNeighbors.length > 0) {
          let breakIdx = Math.floor(rng() * wallNeighbors.length);
          let w = wallNeighbors[breakIdx];
          grid[w.c][w.r] = 0;
        }
      }
    }
  }
  
  let emptyCells = [];
  for (let c = 1; c < COLS - 1; c++) {
    for (let r = 1; r < ROWS - 1; r++) {
      if (grid[c][r] === 0) emptyCells.push({c: c, r: r});
    }
  }
  
  // Shuffle empty cells for placement
  for (let i = emptyCells.length - 1; i > 0; i--) {
    let j = Math.floor(rng() * (i + 1));
    let temp = emptyCells[i];
    emptyCells[i] = emptyCells[j];
    emptyCells[j] = temp;
  }
  
  let pCell = emptyCells.pop();
  player = {
    x: pCell.c * CELL_W + CELL_W/2,
    y: pCell.r * CELL_H + CELL_H/2,
    w: CELL_W * 0.6,
    h: CELL_H * 0.6,
    vx: 0, vy: 0
  };
  
  largeOrbs = [];
  for (let i = 0; i < 4; i++) {
    if (emptyCells.length > 0) {
      let cell = emptyCells.pop();
      largeOrbs.push({c: cell.c, r: cell.r, x: cell.c * CELL_W + CELL_W/2, y: cell.r * CELL_H + CELL_H/2, w: CELL_W * 0.5, h: CELL_H * 0.5});
    }
  }
  
  eggs = [];
  enemies = [];
  for (let i = 0; i < MAX_ENEMIES; i++) {
    if (emptyCells.length > 0) {
      let cell = emptyCells.pop();
      eggs.push({c: cell.c, r: cell.r, x: cell.c * CELL_W + CELL_W/2, y: cell.r * CELL_H + CELL_H/2, timer: EGG_TIMEOUT});
    }
  }
  
  smallOrbs = [];
  totalSmallOrbs = emptyCells.length;
  orbsCollected = 0;
  for (let cell of emptyCells) {
    smallOrbs.push({c: cell.c, r: cell.r, x: cell.c * CELL_W + CELL_W/2, y: cell.r * CELL_H + CELL_H/2, w: CELL_W * 0.25, h: CELL_H * 0.25, active: true});
  }
  
  eatTimer = 0;
}

function softReset() {
  let emptyList = [];
  for(let c=1; c<COLS-1; c++) {
    for(let r=1; r<ROWS-1; r++) {
      if (grid[c][r] === 0) emptyList.push({c:c, r:r});
    }
  }
  let pCell = emptyList[Math.floor(rng() * emptyList.length)];
  player.x = pCell.c * CELL_W + CELL_W/2;
  player.y = pCell.r * CELL_H + CELL_H/2;
  player.vx = 0; player.vy = 0;
  
  enemies = [];
  eggs = [];
  eatTimer = 0;
  
  for (let i = 0; i < MAX_ENEMIES; i++) {
    if (emptyList.length > 0) {
      let cell = emptyList[Math.floor(rng() * emptyList.length)];
      eggs.push({c: cell.c, r: cell.r, x: cell.c * CELL_W + CELL_W/2, y: cell.r * CELL_H + CELL_H/2, timer: EGG_TIMEOUT});
    }
  }
}

function resolveCollision(p, axis) {
  let leftC = Math.max(0, Math.floor((p.x - p.w/2) / CELL_W));
  let rightC = Math.min(COLS - 1, Math.floor((p.x + p.w/2) / CELL_W));
  let topR = Math.max(0, Math.floor((p.y - p.h/2) / CELL_H));
  let bottomR = Math.min(ROWS - 1, Math.floor((p.y + p.h/2) / CELL_H));
  
  if (axis === 'x') {
    if (p.vx > 0) {
      for (let r = topR; r <= bottomR; r++) {
        if (grid[rightC][r] === 1) {
          p.x = rightC * CELL_W - p.w/2 - 0.01;
          break;
        }
      }
    } else if (p.vx < 0) {
      for (let r = topR; r <= bottomR; r++) {
        if (grid[leftC][r] === 1) {
          p.x = (leftC + 1) * CELL_W + p.w/2 + 0.01;
          break;
        }
      }
    }
  } else if (axis === 'y') {
    if (p.vy > 0) {
      for (let c = leftC; c <= rightC; c++) {
        if (grid[c][bottomR] === 1) {
          p.y = bottomR * CELL_H - p.h/2 - 0.01;
          break;
        }
      }
    } else if (p.vy < 0) {
      for (let c = leftC; c <= rightC; c++) {
        if (grid[c][topR] === 1) {
          p.y = (topR + 1) * CELL_H + p.h/2 + 0.01;
          break;
        }
      }
    }
  }
}

function rectOverlap(x1, y1, w1, h1, x2, y2, w2, h2) {
  return Math.abs(x1 - x2) < (w1 + w2) / 2 && Math.abs(y1 - y2) < (h1 + h2) / 2;
}

function update() {
  if (eatTimer > 0) eatTimer--;
  
  player.vx = 0;
  player.vy = 0;
  let SPEED = CELL_W * 0.15;
  if (keyIsDown(37)) player.vx = -SPEED; // LEFT
  if (keyIsDown(39)) player.vx = SPEED;  // RIGHT
  if (keyIsDown(38)) player.vy = -SPEED; // UP
  if (keyIsDown(40)) player.vy = SPEED;  // DOWN

  player.x += player.vx;
  resolveCollision(player, 'x');
  player.y += player.vy;
  resolveCollision(player, 'y');
  
  for (let i = eggs.length - 1; i >= 0; i--) {
    let egg = eggs[i];
    egg.timer--;
    if (egg.timer <= 0) {
      enemies.push({
        c: egg.c, r: egg.r,
        x: egg.x, y: egg.y,
        dc: 0, dr: 0
      });
      eggs.splice(i, 1);
    }
  }
  
  if (enemies.length + eggs.length < MAX_ENEMIES) {
    let emptyList = [];
    for(let c=1; c<COLS-1; c++) {
      for(let r=1; r<ROWS-1; r++) {
        if (grid[c][r] === 0) emptyList.push({c:c, r:r});
      }
    }
    if (emptyList.length > 0) {
      let sc = emptyList[Math.floor(rng() * emptyList.length)];
      eggs.push({
        c: sc.c, r: sc.r,
        x: sc.c * CELL_W + CELL_W/2,
        y: sc.r * CELL_H + CELL_H/2,
        timer: EGG_TIMEOUT
      });
    }
  }
  
  for (let i = enemies.length - 1; i >= 0; i--) {
    let e = enemies[i];
    let targetX = e.c * CELL_W + CELL_W/2;
    let targetY = e.r * CELL_H + CELL_H/2;
    
    let dx = targetX - e.x;
    let dy = targetY - e.y;
    
    let distToCenter = Math.abs(dx) + Math.abs(dy);
    let vscale = eatTimer > 0 ? 0.5 : 1.0;
    let speed = CELL_W * 0.08 * vscale;
    
    if (distToCenter <= speed) {
      let remainder = speed - distToCenter;
      e.x = targetX;
      e.y = targetY;
      
      let adj = [];
      let neighbors = [{dc: 0, dr: -1}, {dc: 1, dr: 0}, {dc: 0, dr: 1}, {dc: -1, dr: 0}];
      for (let d of neighbors) {
        if (grid[e.c + d.dc] && grid[e.c + d.dc][e.r + d.dr] === 0) {
          if (e.dc !== 0 || e.dr !== 0) {
            if (d.dc === -e.dc && d.dr === -e.dr) continue;
          }
          adj.push(d);
        }
      }
      
      if (adj.length === 0) {
        adj.push({dc: -e.dc, dr: -e.dr});
      }
      
      let bestDirs = [];
      let bestDist = eatTimer > 0 ? -1 : 999999;
      
      let pc = Math.floor(player.x / CELL_W);
      let pr = Math.floor(player.y / CELL_H);
      
      for (let d of adj) {
        let nc = e.c + d.dc;
        let nr = e.r + d.dr;
        let dist = Math.abs(nc - pc) + Math.abs(nr - pr);
        
        if (eatTimer > 0) {
          if (dist > bestDist) {
            bestDist = dist;
            bestDirs = [d];
          } else if (dist === bestDist) {
            bestDirs.push(d);
          }
        } else {
          if (dist < bestDist) {
            bestDist = dist;
            bestDirs = [d];
          } else if (dist === bestDist) {
            bestDirs.push(d);
          }
        }
      }
      
      let chosen = bestDirs[Math.floor(rng() * bestDirs.length)];
      if (!chosen) chosen = {dc: 0, dr: 0}; 
      e.dc = chosen.dc;
      e.dr = chosen.dr;
      e.c += e.dc;
      e.r += e.dr;
      
      e.x += e.dc * remainder;
      e.y += e.dr * remainder;
    } else {
      e.x += e.dc * speed;
      e.y += e.dr * speed;
    }
  }
  
  for (let i = smallOrbs.length - 1; i >= 0; i--) {
    let o = smallOrbs[i];
    if (o.active && rectOverlap(player.x, player.y, player.w, player.h, o.x, o.y, o.w, o.h)) {
      o.active = false;
      score += 1;
      orbsCollected++;
    }
  }
  
  for (let i = largeOrbs.length - 1; i >= 0; i--) {
    let o = largeOrbs[i];
    if (rectOverlap(player.x, player.y, player.w, player.h, o.x, o.y, o.w, o.h)) {
      largeOrbs.splice(i, 1);
      score += 5;
      eatTimer = EAT_TIMEOUT;
    }
  }
  
  if (orbsCollected === totalSmallOrbs) {
    score += 50;
    gameState = 'WIN';
    return;
  }
  
  let playerHit = false;
  for (let i = enemies.length - 1; i >= 0; i--) {
    let e = enemies[i];
    if (rectOverlap(player.x, player.y, player.w, player.h, e.x, e.y, CELL_W*0.6, CELL_H*0.6)) {
      if (eatTimer > 0) {
        enemies.splice(i, 1);
        score += 10;
      } else {
        playerHit = true;
      }
    }
  }
  
  if (playerHit) {
    lives--;
    if (lives <= 0) {
      gameState = 'GAMEOVER';
    } else {
      softReset();
    }
  }
}

function draw() {
  if (gameState === 'PLAYING') {
    update();
  }
  
  background(20);
  
  noStroke();
  fill(100);
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      if (grid[c][r] === 1) {
        rect(c * CELL_W, r * CELL_H, CELL_W, CELL_H);
      }
    }
  }
  
  fill(0, 255, 0);
  for (let o of smallOrbs) {
    if (o.active) {
      rect(o.x - o.w/2, o.y - o.h/2, o.w, o.h);
    }
  }
  
  fill(255, 255, 0);
  for (let o of largeOrbs) {
    rect(o.x - o.w/2, o.y - o.h/2, o.w, o.h);
  }
  
  fill(150, 50, 150);
  for (let e of eggs) {
    ellipse(e.x, e.y, CELL_W * 0.5, CELL_H * 0.5);
  }
  
  for (let e of enemies) {
    if (eatTimer > 0) {
      if (eatTimer < 30 && Math.floor(eatTimer / 5) % 2 === 0) {
        fill(255, 50, 50);
      } else {
        fill(50, 255, 255);
      }
    } else {
      fill(255, 50, 50);
    }
    ellipse(e.x, e.y, CELL_W * 0.6, CELL_H * 0.6);
  }
  
  fill(50, 100, 255);
  rect(player.x - player.w/2, player.y - player.h/2, player.w, player.h);
}