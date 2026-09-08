// ============================================================
// REQUIRED: p5.js lifecycle
// ============================================================

const WIDTH = 400;
const HEIGHT = 400;
const TILE = 25;
const ROWS = 16;

const TYPE_SAFE = 0;
const TYPE_ROAD = 1;
const TYPE_WATER = 2;
const TYPE_GOAL = 3;

let score = 0;
let lives = 5;
let gameState = 'PLAYING';

let player;
let lanes = [];
let prevKeys = {};
let minRowReached = ROWS - 1;

function setup() {
  createCanvas(WIDTH, HEIGHT);
  noStroke();
}

function draw() {
  if (gameState !== 'PLAYING') return;

  // Input handling
  let keys = {
    37: keyIsDown(37),
    38: keyIsDown(38),
    39: keyIsDown(39),
    40: keyIsDown(40)
  };

  if (keys[38] && !prevKeys[38]) player.y -= TILE;
  if (keys[40] && !prevKeys[40]) player.y += TILE;
  if (keys[37] && !prevKeys[37]) player.x -= TILE;
  if (keys[39] && !prevKeys[39]) player.x += TILE;
  prevKeys = keys;

  // Clamp player to canvas bounds initially
  player.x = Math.max(0, Math.min(WIDTH - player.w, player.x));
  player.y = Math.max(0, Math.min(HEIGHT - player.h, player.y));

  updateLanes();

  let centerY = player.y + player.h / 2;
  let currentRow = Math.floor(centerY / TILE);
  
  // Scoring for forward progress
  if (currentRow < minRowReached) {
    score += 1;
    minRowReached = currentRow;
  }

  let dead = false;
  let onLog = false;
  let lane = lanes[currentRow];

  if (lane && lane.type === TYPE_ROAD) {
    for (let e of lane.entities) {
      if (overlap(player.x, player.y, player.w, player.h, e.x, e.y, e.w, e.h)) {
        dead = true;
        break;
      }
    }
  } else if (lane && lane.type === TYPE_WATER) {
    let safe = false;
    for (let e of lane.entities) {
      if (overlap(player.x, player.y, player.w, player.h, e.x, e.y, e.w, e.h)) {
        safe = true;
        onLog = true;
        player.x += lane.speed;
        break;
      }
    }
    if (!safe) dead = true;
  }

  // Enforce strict canvas bounds, especially if pushed by log
  if (player.x < 0 || player.x + player.w > WIDTH) {
    dead = true;
  }

  if (dead) {
    lives--;
    if (lives <= 0) {
      gameState = 'GAMEOVER';
    } else {
      resetPlayer();
    }
  } else if (lane && lane.type === TYPE_GOAL) {
    score += 10;
    gameState = 'WIN';
  }

  render();
}

function updateLanes() {
  for (let l of lanes) {
    if (l.type === TYPE_ROAD || l.type === TYPE_WATER) {
      l.timer++;
      if (l.timer >= l.interval) {
        l.timer = 0;
        let startX = l.speed > 0 ? -l.entityWidth : WIDTH;
        l.entities.push({ x: startX, y: l.y, w: l.entityWidth, h: TILE });
      }

      for (let i = l.entities.length - 1; i >= 0; i--) {
        let e = l.entities[i];
        e.x += l.speed;
        if ((l.speed > 0 && e.x > WIDTH) || (l.speed < 0 && e.x < -e.w)) {
          l.entities.splice(i, 1);
        }
      }
    }
  }
}

function render() {
  background(0);
  
  // Draw background lanes
  for (let l of lanes) {
    if (l.type === TYPE_SAFE) fill(0, 80, 0);       // Dark Green
    else if (l.type === TYPE_ROAD) fill(50);        // Dark Gray
    else if (l.type === TYPE_WATER) fill(0, 0, 150);// Dark Blue
    else if (l.type === TYPE_GOAL) fill(200, 200, 0); // Yellow
    rect(0, l.y, WIDTH, TILE);

    // Draw entities
    for (let e of l.entities) {
      if (l.type === TYPE_ROAD) fill(220, 20, 20);      // Red cars
      else if (l.type === TYPE_WATER) fill(139, 69, 19); // Brown logs
      rect(e.x, e.y, e.w, e.h);
    }
  }

  // Draw Player
  fill(0, 255, 255); // Cyan frog
  rect(player.x, player.y, player.w, player.h);
}

function overlap(x1, y1, w1, h1, x2, y2, w2, h2) {
  return x1 < x2 + w2 && x1 + w1 > x2 && y1 < y2 + h2 && y1 + h1 > y2;
}

// ============================================================
// REQUIRED: RL interface
// ============================================================

function getGameState() {
  return { score, lives, gameState };
}

function resetGame(seed) {
  rng = mulberry32(seed);
  score = 0;
  lives = 5;
  gameState = 'PLAYING';
  
  lanes = [];
  for (let i = 0; i < ROWS; i++) {
    let type = TYPE_SAFE;
    if (i === 0) type = TYPE_GOAL;
    else if (i >= 1 && i <= 3) type = TYPE_WATER;
    else if (i === 4) type = TYPE_SAFE;
    else if (i >= 5 && i <= 8) type = TYPE_WATER;
    else if (i === 9) type = TYPE_SAFE;
    else if (i >= 10 && i <= 13) type = TYPE_ROAD;
    else type = TYPE_SAFE; // 14, 15

    let speed = 0;
    let interval = 0;
    let entityWidth = 0;

    if (type === TYPE_ROAD) {
      speed = (rng() * 1.5 + 1.0) * (rng() < 0.5 ? 1 : -1);
      entityWidth = 25 + rng() * 20;
      interval = Math.floor((entityWidth + 60 + rng() * 60) / Math.abs(speed));
    } else if (type === TYPE_WATER) {
      speed = (rng() * 1.0 + 0.8) * (rng() < 0.5 ? 1 : -1);
      entityWidth = 80 + rng() * 40;
      interval = Math.floor((entityWidth + 25 + rng() * 25) / Math.abs(speed));
    }

    lanes.push({
      y: i * TILE,
      type: type,
      speed: speed,
      interval: interval,
      timer: interval > 0 ? Math.floor(rng() * interval) : 0,
      entityWidth: entityWidth,
      entities: []
    });
  }

  // Pre-simulate to populate the screen with logs and cars immediately
  for (let step = 0; step < 300; step++) {
    updateLanes();
  }

  resetPlayer();
}

function resetPlayer() {
  player = {
    w: 14,
    h: 14,
    x: 0,
    y: 0
  };
  player.x = WIDTH / 2 - player.w / 2;
  player.y = (ROWS - 1) * TILE + (TILE - player.h) / 2;
  minRowReached = ROWS - 1;
  prevKeys = { 37: false, 38: false, 39: false, 40: false };
}

// ============================================================
// REQUIRED: seeded RNG
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