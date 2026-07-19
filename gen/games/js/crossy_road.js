// ============================================================
// REQUIRED: p5.js lifecycle
// ============================================================

function setup() {
  createCanvas(400, 400);
  noStroke();
}

function draw() {
  if (gameState === 'PLAYING') {
    updateGame();
  }
  drawGame();
}

// ============================================================
// REQUIRED: RL interface
// ============================================================

let score = 0;
let lives = 3;
let gameState = 'PLAYING';

function getGameState() {
  return {
    score: score,
    lives: lives,
    gameState: gameState
  };
}

let lanes = [];
let player = { x: 10, y: 18 };
let moveCooldown = 0;
let waterCount = 0;
let roadCount = 0;
let globalY = 0;
let maxGlobalY = 0;

function resetGame(seed) {
  rng = mulberry32(seed);
  score = 0;
  lives = 3;
  gameState = 'PLAYING';
  maxGlobalY = 0;
  initBoard();
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

function initBoard() {
  lanes = [];
  waterCount = 0;
  roadCount = 0;
  globalY = 0;
  
  // Generate 20 rows from top (0) to bottom (19)
  for (let i = 0; i < 20; i++) {
    // Make the starting area fully safe
    if (i >= 18) {
      lanes.push(generateLane(true));
    } else {
      lanes.push(generateLane(false));
    }
  }
  player = { x: 10, y: 18 };
  moveCooldown = 0;
}

function generateLane(isSafe) {
  if (isSafe) {
    roadCount = 0;
    waterCount = 0;
    return { type: 0, dir: 1, tickDelay: 10, tickCounter: 0, entities: [] };
  }

  let r = rng();
  let type = 0; // 0: GRASS, 1: ROAD, 2: WATER
  
  if (r < 0.2 && waterCount === 0 && roadCount === 0) {
    type = 0;
  } else if (r < 0.6) {
    type = 1;
  } else {
    type = 2;
  }

  // Enforce clustering rules
  if (type === 1) { roadCount++; waterCount = 0; }
  else if (type === 2) { waterCount++; roadCount = 0; }
  else { roadCount = 0; waterCount = 0; }

  // Max 3 consecutive hazardous lane types
  if (roadCount > 3) { type = 0; roadCount = 0; }
  if (waterCount > 3) { type = 0; waterCount = 0; }

  let dir = rng() > 0.5 ? 1 : -1;
  let delay = Math.floor(rng() * 15) + 5; // 5 to 19 frames
  let entities = [];

  if (type === 1) { // ROAD -> Cars
    let numCars = Math.floor(rng() * 3) + 1; // 1 to 3
    let spacing = 20 / numCars;
    for (let i = 0; i < numCars; i++) {
      let x = Math.floor(rng() * spacing) + i * spacing;
      let size = Math.floor(rng() * 2) + 1; // 1 or 2
      entities.push({ x: Math.floor(x), size: size });
    }
  } else if (type === 2) { // WATER -> Logs
    let numLogs = Math.floor(rng() * 2) + 3; // 3 to 4
    let spacing = 20 / numLogs;
    for (let i = 0; i < numLogs; i++) {
      let x = Math.floor(rng() * spacing) + i * spacing;
      let size = Math.floor(rng() * 2) + 2; // 2 or 3
      entities.push({ x: Math.floor(x), size: size });
    }
  }

  return { type: type, dir: dir, tickDelay: delay, tickCounter: 0, entities: entities };
}

function collides(px, ex, esize) {
  return px >= ex && px < ex + esize;
}

function die() {
  lives--;
  if (lives <= 0) {
    gameState = 'GAMEOVER';
  } else {
    initBoard();
  }
}

function updateGame() {
  // Update lane obstacles
  for (let r = 0; r < 20; r++) {
    let lane = lanes[r];
    if (lane.type === 0) continue;

    lane.tickCounter++;
    if (lane.tickCounter >= lane.tickDelay) {
      lane.tickCounter = 0;

      // Check if player is carried by a log before moving logs
      let playerCarried = false;
      if (lane.type === 2 && player.y === r) {
        for (let e of lane.entities) {
          if (collides(player.x, e.x, e.size)) {
            playerCarried = true;
            break;
          }
        }
      }

      // Move entities
      for (let e of lane.entities) {
        e.x += lane.dir;
        // Wrap around logic
        if (lane.dir === 1 && e.x > 19) e.x = -e.size;
        if (lane.dir === -1 && e.x < -e.size) e.x = 19;
      }

      // Move player with log
      if (playerCarried) {
        player.x += lane.dir;
      }
    }
  }

  // Handle Input
  if (moveCooldown > 0) {
    moveCooldown--;
  } else {
    let dx = 0;
    let dy = 0;
    
    if (keyIsDown(38)) dy = -1; // UP
    else if (keyIsDown(40)) dy = 1; // DOWN
    else if (keyIsDown(37)) dx = -1; // LEFT
    else if (keyIsDown(39)) dx = 1; // RIGHT

    if (dx !== 0 || dy !== 0) {
      let targetX = player.x + dx;
      let targetY = player.y + dy;

      // Clamp movement locally
      if (targetX >= 0 && targetX <= 19 && targetY <= 19) {
        player.x = targetX;
        player.y = targetY;
        
        if (dy === -1) globalY++;
        if (dy === 1) globalY--;

        // Reward for reaching new absolute progress
        if (globalY > maxGlobalY) {
          score++;
          maxGlobalY = globalY;
        }

        // Camera scroll
        if (player.y < 10) {
          lanes.pop();
          lanes.unshift(generateLane(false));
          player.y++; // Shift player down visually to match shifted grid
        }
      }
      moveCooldown = 8;
    }
  }

  // General Collision Check
  if (player.x < 0 || player.x > 19) {
    die();
  } else {
    let pLane = lanes[player.y];
    if (pLane.type === 1) {
      // ROAD: Die if hitting a car
      let hit = false;
      for (let e of pLane.entities) {
        if (collides(player.x, e.x, e.size)) hit = true;
      }
      if (hit) die();
    } else if (pLane.type === 2) {
      // WATER: Die if NOT on a log
      let safe = false;
      for (let e of pLane.entities) {
        if (collides(player.x, e.x, e.size)) safe = true;
      }
      if (!safe) die();
    }
  }
}

function drawGame() {
  background(0);

  // Draw lanes and entities
  for (let r = 0; r < 20; r++) {
    let lane = lanes[r];
    
    if (lane.type === 0) fill(34, 139, 34);      // GRASS
    else if (lane.type === 1) fill(80, 80, 80);  // ROAD
    else if (lane.type === 2) fill(0, 0, 128);   // WATER
    
    rect(0, r * 20, 400, 20);

    if (lane.type === 1) fill(255, 50, 50);      // CAR
    else if (lane.type === 2) fill(139, 69, 19); // LOG

    for (let e of lane.entities) {
      rect(e.x * 20, r * 20, e.size * 20, 20);
    }
  }

  // Draw player
  fill(0, 200, 255);
  rect(player.x * 20, player.y * 20, 20, 20);
}