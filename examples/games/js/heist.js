// ============================================================
// REQUIRED: p5.js lifecycle
// ============================================================

let score = 0;
let lives = 1;
let gameState = 'PLAYING';

const GRID_S = 15;
let CELL_SIZE;

let grid = [];
let keysArr = [];
let keysHeld = [false, false, false];
let exitCol, exitRow;

let player = {
  x: 0,
  y: 0,
  speed: 3
};

const COLORS = [
  [230, 40, 40],   // Red (Key/Door 0)
  [40, 230, 40],   // Green (Key/Door 1)
  [40, 100, 250]   // Blue (Key/Door 2)
];

function setup() {
  createCanvas(400, 400);
  CELL_SIZE = width / GRID_S;
}

function draw() {
  if (gameState !== 'PLAYING') return;

  // 1. Process Input
  let dx = 0, dy = 0;
  if (keyIsDown(37)) dx -= player.speed; // LEFT
  if (keyIsDown(39)) dx += player.speed; // RIGHT
  if (keyIsDown(38)) dy -= player.speed; // UP
  if (keyIsDown(40)) dy += player.speed; // DOWN

  if (dx !== 0 && dy !== 0) {
    let inv_sqrt2 = 0.70710678;
    dx *= inv_sqrt2;
    dy *= inv_sqrt2;
  }

  // 2. Resolve Collisions & Move
  let px = player.x + dx;
  let py = player.y;
  if (checkCollide(px, py)) px = player.x; 

  let py_new = py + dy;
  if (checkCollide(px, py_new)) py_new = py; 

  player.x = px;
  player.y = py_new;

  // 3. Process Overlaps (Keys, Exit)
  // Check Keys
  for (let k of keysArr) {
    if (k.active) {
      let kx = k.c * CELL_SIZE + CELL_SIZE / 2;
      let ky = k.r * CELL_SIZE + CELL_SIZE / 2;
      let dist = Math.hypot(player.x - kx, player.y - ky);
      if (dist < CELL_SIZE * 0.6) {
        k.active = false;
        keysHeld[k.color] = true;
        score += 5; // Reward for finding a key
      }
    }
  }

  // Check Exit
  let ex = exitCol * CELL_SIZE + CELL_SIZE / 2;
  let ey = exitRow * CELL_SIZE + CELL_SIZE / 2;
  if (Math.hypot(player.x - ex, player.y - ey) < CELL_SIZE * 0.6) {
    gameState = 'WIN';
    score += 15; // Reward for completing level
  }

  // 4. Render
  background(20, 20, 30);
  noStroke();

  // Draw Grid (Walls and Doors)
  for (let r = 0; r < GRID_S; r++) {
    for (let c = 0; c < GRID_S; c++) {
      let val = grid[r][c];
      if (val === 1) {
        fill(100, 100, 110);
        rect(c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE + 0.5, CELL_SIZE + 0.5);
      } else if (val >= 10 && val <= 12) {
        let colorIdx = val - 10;
        let col = COLORS[colorIdx];
        fill(col[0], col[1], col[2]);
        rect(c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE + 0.5, CELL_SIZE + 0.5);
      }
    }
  }

  // Draw Keys
  for (let k of keysArr) {
    if (k.active) {
      let col = COLORS[k.color];
      fill(col[0], col[1], col[2]);
      let s = CELL_SIZE * 0.4;
      rect(k.c * CELL_SIZE + CELL_SIZE / 2 - s / 2, k.r * CELL_SIZE + CELL_SIZE / 2 - s / 2, s, s);
    }
  }

  // Draw Exit (Diamond shape)
  fill(255, 230, 40);
  let es = CELL_SIZE * 0.4;
  quad(ex, ey - es, ex + es, ey, ex, ey + es, ex - es, ey);

  // Draw Player
  fill(255);
  ellipse(player.x, player.y, CELL_SIZE * 0.6, CELL_SIZE * 0.6);

  // Draw Held Keys UI (at top edge)
  for (let i = 0; i < 3; i++) {
    if (keysHeld[i]) {
      let col = COLORS[i];
      fill(col[0], col[1], col[2]);
      rect(8 + i * 14, 8, 10, 10);
    }
  }
}

function checkCollide(nx, ny) {
  let hs = CELL_SIZE * 0.35; // Player bounding box half-size
  let L = Math.floor((nx - hs) / CELL_SIZE);
  let R = Math.floor((nx + hs) / CELL_SIZE);
  let T = Math.floor((ny - hs) / CELL_SIZE);
  let B = Math.floor((ny + hs) / CELL_SIZE);

  // First pass: Open unlocked doors on touch
  for (let r = T; r <= B; r++) {
    for (let c = L; c <= R; c++) {
      if (r >= 0 && r < GRID_S && c >= 0 && c < GRID_S) {
        let val = grid[r][c];
        if (val >= 10 && val <= 12) {
          let k_idx = val - 10;
          if (keysHeld[k_idx]) {
            grid[r][c] = 0; // Open the door
            score += 5; // Reward for progressing
          }
        }
      }
    }
  }

  // Second pass: Real solid collision check
  for (let r = T; r <= B; r++) {
    for (let c = L; c <= R; c++) {
      if (r < 0 || r >= GRID_S || c < 0 || c >= GRID_S) return true;
      let val = grid[r][c];
      if (val === 1 || (val >= 10 && val <= 12)) return true;
    }
  }
  return false;
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
  lives = 1;
  gameState = 'PLAYING';
  
  keysHeld = [false, false, false];
  keysArr = [];

  // Generate Maze grid (1=wall, 0=empty)
  grid = [];
  for (let r = 0; r < GRID_S; r++) {
    let row = [];
    for (let c = 0; c < GRID_S; c++) row.push(1);
    grid.push(row);
  }

  // Randomized Depth-First Search for maze carving
  let stack = [[1, 1]];
  grid[1][1] = 0;
  while (stack.length > 0) {
    let curr = stack[stack.length - 1];
    let cc = curr[0], cr = curr[1];
    let dirs = [[0, -2], [0, 2], [-2, 0], [2, 0]];
    
    // Shuffle directions
    for (let i = 3; i > 0; i--) {
      let j = Math.floor(rng() * (i + 1));
      let tmp = dirs[i];
      dirs[i] = dirs[j];
      dirs[j] = tmp;
    }
    
    let moved = false;
    for (let d of dirs) {
      let nc = cc + d[0], nr = cr + d[1];
      if (nc > 0 && nc < GRID_S - 1 && nr > 0 && nr < GRID_S - 1 && grid[nr][nc] === 1) {
        grid[cr + d[1] / 2][cc + d[0] / 2] = 0; // break wall
        grid[nr][nc] = 0; // clear cell
        stack.push([nc, nr]);
        moved = true;
        break;
      }
    }
    if (!moved) stack.pop();
  }

  // Find shortest path from Start (1,1) to Exit (GRID_S-2, GRID_S-2)
  exitCol = GRID_S - 2;
  exitRow = GRID_S - 2;
  
  let q = [[1, 1]];
  let parent = {};
  let visited = new Set();
  visited.add(`1,1`);
  
  while (q.length > 0) {
    let [c, r] = q.shift();
    if (c === exitCol && r === exitRow) break;
    
    for (let d of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      let nc = c + d[0], nr = r + d[1];
      if (grid[nr][nc] === 0 && !visited.has(`${nc},${nr}`)) {
        visited.add(`${nc},${nr}`);
        parent[`${nc},${nr}`] = `${c},${r}`;
        q.push([nc, nr]);
      }
    }
  }

  let path = [];
  let currStr = `${exitCol},${exitRow}`;
  while (currStr) {
    let pts = currStr.split(',');
    path.push([parseInt(pts[0]), parseInt(pts[1])]);
    currStr = parent[currStr];
  }
  path = path.reverse();

  // Place Doors evenly along the path
  let maxKeys = 3;
  let numKeys = Math.min(maxKeys, Math.floor((path.length - 2) / 4));
  if (numKeys < 0) numKeys = 0;

  for (let i = 0; i < numKeys; i++) {
    let pIdx = Math.floor(path.length * ((i + 1) / (numKeys + 1)));
    let dc = path[pIdx][0], dr = path[pIdx][1];
    grid[dr][dc] = 10 + i; // Door IDs: 10, 11, 12
  }

  // Place Keys in reachable sections *before* their corresponding door
  for (let i = 0; i < numKeys; i++) {
    let sq = [[1, 1]];
    let sVisited = new Set();
    sVisited.add(`1,1`);
    let reachable = [];
    
    while (sq.length > 0) {
      let [c, r] = sq.shift();
      reachable.push([c, r]);
      
      for (let d of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        let nc = c + d[0], nr = r + d[1];
        if (nc >= 0 && nc < GRID_S && nr >= 0 && nr < GRID_S) {
          let val = grid[nr][nc];
          // Can walk through empty cells and doors we've conceptually unlocked
          if ((val === 0 || (val >= 10 && val < 10 + i)) && !sVisited.has(`${nc},${nr}`)) {
            sVisited.add(`${nc},${nr}`);
            sq.push([nc, nr]);
          }
        }
      }
    }
    
    let validSpots = reachable.filter(pt => {
      let c = pt[0], r = pt[1];
      if (c === 1 && r === 1) return false; // Not on player start
      if (grid[r][c] !== 0) return false; // Must be entirely empty
      for (let k of keysArr) if (k.c === c && k.r === r) return false; // Not on another key
      return true;
    });
    
    if (validSpots.length > 0) {
      let choice = validSpots[Math.floor(rng() * validSpots.length)];
      keysArr.push({ c: choice[0], r: choice[1], color: i, active: true });
    }
  }

  // Initialize player position in Start cell
  player.x = 1 * CELL_SIZE + CELL_SIZE / 2;
  player.y = 1 * CELL_SIZE + CELL_SIZE / 2;
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