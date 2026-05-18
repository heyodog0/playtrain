// ============================================================
// REQUIRED: p5.js lifecycle
// ============================================================

let score = 0;
let lives = 0;
let gameState = 'PLAYING';

let grid = [];
let player = {};
let enemies = [];
let moveTimer = 0;
let gameTick = 0;

let ROWS = 6;
let visitedCubes = 0;
let totalCubes = 0;

let cubeSize = 20;
let xSpacing = 40;
let ySpacing = 35;

let colorUnvisited;
let colorVisited;
let colorPlayer;
let colorEnemy;

function setup() {
  createCanvas(400, 400);
  noStroke();
}

function draw() {
  if (gameState !== 'PLAYING') {
    renderGame();
    return;
  }

  // Handle Input
  if (moveTimer <= 0) {
    let moved = false;
    let dr = 0, dc = 0;

    // Map arrow keys to isometric diagonal hops
    if (keyIsDown(38)) { // UP -> Up-Right
      dr = -1; dc = 0; moved = true;
    } else if (keyIsDown(39)) { // RIGHT -> Down-Right
      dr = 1; dc = 1; moved = true;
    } else if (keyIsDown(40)) { // DOWN -> Down-Left
      dr = 1; dc = 0; moved = true;
    } else if (keyIsDown(37)) { // LEFT -> Up-Left
      dr = -1; dc = -1; moved = true;
    }

    if (moved) {
      movePlayer(dr, dc);
      moveTimer = 10; // Cooldown frames
    }
  } else {
    moveTimer--;
  }

  if (gameState !== 'PLAYING') {
    renderGame();
    return;
  }

  // Update Game State
  gameTick++;
  
  // Enemy Spawning
  let spawnRate = Math.floor(60 - (ROWS * 2));
  if (gameTick % spawnRate === 0) {
    // Spawn at row 1 to avoid unavoidable instant death at (0,0)
    if (ROWS > 1) {
      let spawnC = rng() < 0.5 ? 0 : 1;
      enemies.push({ r: 1, c: spawnC, timer: 25 });
    }
  }

  // Enemy Movement
  for (let i = enemies.length - 1; i >= 0; i--) {
    let e = enemies[i];
    e.timer--;
    if (e.timer <= 0) {
      e.r += 1;
      e.c += rng() < 0.5 ? 0 : 1; // move down-left or down-right
      e.timer = 25;

      if (e.r >= ROWS) {
        enemies.splice(i, 1);
      }
    }
  }

  checkCollisions();
  renderGame();
}

// ============================================================
// GAME LOGIC
// ============================================================

function movePlayer(dr, dc) {
  let newR = player.r + dr;
  let newC = player.c + dc;

  // Check if fell off pyramid
  if (newR < 0 || newR >= ROWS || newC < 0 || newC > newR) {
    die();
    return;
  }

  player.r = newR;
  player.c = newC;

  // Color cube if unvisited
  if (!grid[newR][newC]) {
    grid[newR][newC] = true;
    visitedCubes++;
    score += 10;
  }

  checkCollisions();

  // Win condition
  if (gameState === 'PLAYING' && visitedCubes === totalCubes) {
    score += 50;
    gameState = 'WIN';
  }
}

function checkCollisions() {
  for (let e of enemies) {
    if (e.r === player.r && e.c === player.c) {
      die();
      return;
    }
  }
}

function die() {
  lives--;
  score = Math.max(0, score - 5); // Small penalty for dying/falling
  
  if (lives <= 0) {
    gameState = 'GAMEOVER';
  } else {
    // Reset player position and clear board of enemies
    player.r = 0;
    player.c = 0;
    enemies = [];
    moveTimer = 0;
  }
}

function getScreenPos(r, c) {
  let centerX = 200;
  let totalHeight = (ROWS - 1) * ySpacing;
  let startY = 200 - totalHeight / 2 + 20; // +20 offsets a bit for score bar
  
  let x = centerX + (c - r / 2) * xSpacing;
  let y = startY + r * ySpacing;
  return { x, y };
}

function renderGame() {
  background(20); // Dark background for high contrast

  // Draw Pyramid Grid
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c <= r; c++) {
      let pos = getScreenPos(r, c);
      let col = grid[r][c] ? colorVisited : colorUnvisited;
      
      fill(col[0], col[1], col[2]);
      beginShape();
      vertex(pos.x, pos.y - cubeSize / 2);
      vertex(pos.x + cubeSize, pos.y);
      vertex(pos.x, pos.y + cubeSize / 2);
      vertex(pos.x - cubeSize, pos.y);
      endShape(CLOSE);
    }
  }

  // Draw Enemies (Red Circles)
  fill(colorEnemy[0], colorEnemy[1], colorEnemy[2]);
  for (let e of enemies) {
    let pos = getScreenPos(e.r, e.c);
    ellipse(pos.x, pos.y - 10, 16, 16);
  }

  // Draw Player (White/Distinct Square)
  fill(colorPlayer[0], colorPlayer[1], colorPlayer[2]);
  let pPos = getScreenPos(player.r, player.c);
  rect(pPos.x - 8, pPos.y - 24, 16, 16);

  // HUD: Lives (Squares top left)
  fill(colorPlayer[0], colorPlayer[1], colorPlayer[2]);
  for (let i = 0; i < lives; i++) {
    rect(10 + i * 15, 10, 10, 10);
  }

  // HUD: Progress Bar (Bottom edge)
  fill(colorVisited[0], colorVisited[1], colorVisited[2]);
  rect(0, 390, width * (visitedCubes / totalCubes), 10);
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

  // Procedurally determine pyramid height (5 to 7 rows)
  ROWS = Math.floor(rng() * 3) + 5;
  
  // Adjust scaling slightly based on row count
  cubeSize = Math.floor(400 / (ROWS * 3));
  xSpacing = cubeSize * 2;
  ySpacing = cubeSize * 1.5;

  // Procedurally select color palettes
  let palettes = [
    { u: [52, 152, 219], v: [241, 196, 15] },  // Blue -> Yellow
    { u: [155, 89, 182], v: [46, 204, 113] },  // Purple -> Green
    { u: [230, 126, 34], v: [52, 152, 219] },  // Orange -> Blue
  ];
  let pal = palettes[Math.floor(rng() * palettes.length)];
  colorUnvisited = pal.u;
  colorVisited = pal.v;
  colorPlayer = [255, 255, 255]; 
  colorEnemy = [231, 76, 60];    

  // Initialize Pyramid Grid
  grid = [];
  totalCubes = 0;
  for (let r = 0; r < ROWS; r++) {
    let row = [];
    for (let c = 0; c <= r; c++) {
      row.push(false);
      totalCubes++;
    }
    grid.push(row);
  }

  // Reset entities
  player = { r: 0, c: 0 };
  grid[0][0] = true;
  visitedCubes = 1;

  enemies = [];
  moveTimer = 0;
  gameTick = 0;
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