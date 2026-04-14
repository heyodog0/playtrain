let rng = null;
let score = 0;
let lives = 1;
let gameState = 'PLAYING';
let gameStep = 0;

let grid = [];
const gridW = 40;
const gridH = 40;
const cellSize = 10;

let player = {
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  rotation: 0,
  r: 6
};

let bullets = [];
let targets = [];
let enemies = [];
let obstacles = [];
let goal = { x: 0, y: 0 };
let lastFired = 0;

function setup() {
  createCanvas(400, 400);
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) | 0;
    let n = Math.imul(t ^ (t >>> 15), t | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

function resetGame(seed) {
  rng = mulberry32(seed);
  score = 0;
  lives = 1;
  gameState = 'PLAYING';
  gameStep = 0;
  bullets = [];
  targets = [];
  enemies = [];
  obstacles = [];
  lastFired = 0;

  generateCave();
  placeEntities();
}

function generateCave() {
  // Initialize random grid
  grid = new Array(gridW * gridH);
  for (let i = 0; i < gridW * gridH; i++) {
    let x = i % gridW;
    let y = Math.floor(i / gridW);
    // Borders are always walls
    if (x === 0 || x === gridW - 1 || y === 0 || y === gridH - 1) {
      grid[i] = 1;
    } else {
      grid[i] = rng() < 0.45 ? 1 : 0;
    }
  }

  // Smooth walls using Cellular Automata
  for (let iter = 0; iter < 4; iter++) {
    let newGrid = [...grid];
    for (let y = 1; y < gridH - 1; y++) {
      for (let x = 1; x < gridW - 1; x++) {
        let neighbors = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (grid[(y + dy) * gridW + (x + dx)] === 1) neighbors++;
          }
        }
        if (neighbors > 4) newGrid[y * gridW + x] = 1;
        else if (neighbors < 4) newGrid[y * gridW + x] = 0;
      }
    }
    grid = newGrid;
  }

  // Find the largest open space and keep only that (flood fill)
  let bestRoom = [];
  let visited = new Set();
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === 0 && !visited.has(i)) {
      let currentRoom = [];
      let queue = [i];
      visited.add(i);
      while (queue.length > 0) {
        let curr = queue.shift();
        currentRoom.push(curr);
        let cx = curr % gridW;
        let cy = Math.floor(curr / gridW);
        let dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        for (let [dx, dy] of dirs) {
          let nx = cx + dx;
          let ny = cy + dy;
          let idx = ny * gridW + nx;
          if (nx >= 0 && nx < gridW && ny >= 0 && ny < gridH && grid[idx] === 0 && !visited.has(idx)) {
            visited.add(idx);
            queue.push(idx);
          }
        }
      }
      if (currentRoom.length > bestRoom.length) bestRoom = currentRoom;
    }
  }

  // Fill everything not in the best room
  let roomSet = new Set(bestRoom);
  for (let i = 0; i < grid.length; i++) {
    if (!roomSet.has(i)) grid[i] = 1;
  }
  
  // Save open cells for entity placement
  this.openCells = bestRoom;
}

function placeEntities() {
  let cells = this.openCells;
  // Pick player pos
  let pIdx = Math.floor(rng() * cells.length);
  let pCell = cells.splice(pIdx, 1)[0];
  player.x = (pCell % gridW) * cellSize + cellSize / 2;
  player.y = Math.floor(pCell / gridW) * cellSize + cellSize / 2;
  player.vx = 0;
  player.vy = 0;
  player.rotation = -PI / 2;

  // Pick goal pos (farthest cell from player)
  let maxDist = -1;
  let gIdx = 0;
  for (let i = 0; i < cells.length; i++) {
    let cx = (cells[i] % gridW) * cellSize;
    let cy = Math.floor(cells[i] / gridW) * cellSize;
    let d = dist(player.x, player.y, cx, cy);
    if (d > maxDist) {
      maxDist = d;
      gIdx = i;
    }
  }
  let gCell = cells.splice(gIdx, 1)[0];
  goal.x = (gCell % gridW) * cellSize + cellSize / 2;
  goal.y = Math.floor(gCell / gridW) * cellSize + cellSize / 2;

  // Fill other entities
  let numTargets = Math.floor(cells.length / 40);
  let numEnemies = Math.floor(cells.length / 60);
  let numObstacles = Math.floor(cells.length / 50);

  for (let i = 0; i < numTargets; i++) {
    let c = cells.splice(Math.floor(rng() * cells.length), 1)[0];
    targets.push({ x: (c % gridW) * cellSize + cellSize / 2, y: Math.floor(c / gridW) * cellSize + cellSize / 2, r: 8, health: 3 });
  }
  for (let i = 0; i < numEnemies; i++) {
    let c = cells.splice(Math.floor(rng() * cells.length), 1)[0];
    let vx = (rng() - 0.5) * 2;
    let vy = (rng() - 0.5) * 2;
    enemies.push({ x: (c % gridW) * cellSize + cellSize / 2, y: Math.floor(c / gridW) * cellSize + cellSize / 2, r: 8, vx, vy });
  }
  for (let i = 0; i < numObstacles; i++) {
    let c = cells.splice(Math.floor(rng() * cells.length), 1)[0];
    obstacles.push({ x: (c % gridW) * cellSize + cellSize / 2, y: Math.floor(c / gridW) * cellSize + cellSize / 2, r: 10 });
  }
}

function draw() {
  if (gameState !== 'PLAYING') return;

  background(0);
  gameStep++;

  handleInput();
  updatePhysics();
  checkCollisions();
  render();
}

function handleInput() {
  // Rotation
  if (keyIsDown(37)) player.rotation -= 0.1; // LEFT
  if (keyIsDown(39)) player.rotation += 0.1; // RIGHT

  // Thrust
  if (keyIsDown(38)) { // UP
    player.vx += cos(player.rotation) * 0.2;
    player.vy += sin(player.rotation) * 0.2;
  }

  // Shooting (Action D / Space)
  if (keyIsDown(32) && gameStep - lastFired > 15) {
    bullets.push({
      x: player.x + cos(player.rotation) * 10,
      y: player.y + sin(player.rotation) * 10,
      vx: cos(player.rotation) * 5,
      vy: sin(player.rotation) * 5,
      life: 60
    });
    lastFired = gameStep;
  }
}

function updatePhysics() {
  // Player movement
  player.x += player.vx;
  player.y += player.vy;
  player.vx *= 0.98; // Friction
  player.vy *= 0.98;

  // Bullets
  for (let i = bullets.length - 1; i >= 0; i--) {
    let b = bullets[i];
    b.x += b.vx;
    b.y += b.vy;
    b.life--;
    if (b.life <= 0 || isWall(b.x, b.y)) {
      bullets.splice(i, 1);
    }
  }

  // Enemies
  for (let e of enemies) {
    let nx = e.x + e.vx;
    let ny = e.y + e.vy;
    if (isWall(nx, ny)) {
      e.vx *= -1;
      e.vy *= -1;
    } else {
      e.x = nx;
      e.y = ny;
    }
  }
}

function isWall(x, y) {
  let gx = Math.floor(x / cellSize);
  let gy = Math.floor(y / cellSize);
  if (gx < 0 || gx >= gridW || gy < 0 || gy >= gridH) return true;
  return grid[gy * gridW + gx] === 1;
}

function checkCollisions() {
  // Player vs Walls
  if (isWall(player.x, player.y)) {
    gameState = 'GAMEOVER';
    lives = 0;
  }

  // Player vs Goal
  if (dist(player.x, player.y, goal.x, goal.y) < 15) {
    score += 10;
    gameState = 'WIN';
  }

  // Player vs Entities
  for (let o of obstacles) {
    if (dist(player.x, player.y, o.x, o.y) < player.r + o.r) {
      gameState = 'GAMEOVER';
      lives = 0;
    }
  }
  for (let e of enemies) {
    if (dist(player.x, player.y, e.x, e.y) < player.r + e.r) {
      gameState = 'GAMEOVER';
      lives = 0;
    }
  }
  for (let t of targets) {
    if (dist(player.x, player.y, t.x, t.y) < player.r + t.r) {
      gameState = 'GAMEOVER';
      lives = 0;
    }
  }

  // Bullets vs Targets
  for (let i = bullets.length - 1; i >= 0; i--) {
    let b = bullets[i];
    for (let j = targets.length - 1; j >= 0; j--) {
      let t = targets[j];
      if (dist(b.x, b.y, t.x, t.y) < t.r) {
        t.health--;
        bullets.splice(i, 1);
        if (t.health <= 0) {
          targets.splice(j, 1);
          score += 3;
        }
        break;
      }
    }
  }
}

function render() {
  // Walls
  noStroke();
  fill(80);
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === 1) {
      let x = (i % gridW) * cellSize;
      let y = Math.floor(i / gridW) * cellSize;
      rect(x, y, cellSize, cellSize);
    }
  }

  // Goal
  fill(0, 255, 0);
  ellipse(goal.x, goal.y, 16, 16);

  // Obstacles
  fill(150, 75, 0);
  for (let o of obstacles) {
    rect(o.x - o.r, o.y - o.r, o.r * 2, o.r * 2);
  }

  // Targets
  fill(255, 255, 0);
  for (let t of targets) {
    ellipse(t.x, t.y, t.r * 2, t.r * 2);
  }

  // Enemies
  fill(255, 0, 0);
  for (let e of enemies) {
    push();
    translate(e.x, e.y);
    rotate(frameCount * 0.1);
    rect(-e.r, -e.r, e.r * 2, e.r * 2);
    pop();
  }

  // Bullets
  fill(0, 255, 255);
  for (let b of bullets) {
    ellipse(b.x, b.y, 4, 4);
  }

  // Player
  push();
  translate(player.x, player.y);
  rotate(player.rotation);
  fill(0, 100, 255);
  triangle(10, 0, -5, -6, -5, 6);
  // Exhaust
  if (keyIsDown(38)) {
    fill(255, 150, 0);
    triangle(-5, 0, -10, -3, -10, 3);
  }
  pop();
}

function getGameState() {
  return {
    score: score,
    lives: lives,
    gameState: gameState
  };
}