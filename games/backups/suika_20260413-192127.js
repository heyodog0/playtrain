// ============================================================
// REQUIRED: p5.js lifecycle
// ============================================================

let engine, world;
let score = 0;
let lives = 3;
let gameState = 'PLAYING';

let dropperX = 200;
let dropperY = 30;
let currentFruitLevel = 0;
let nextFruitLevel = 0;
let dropCooldown = 0;
let ticks = 0;

let pendingMerges = [];
let mergeSet = new Set();

const FRUITS = [
  { r: 12, color: [255, 0, 0] },       // L0: Red
  { r: 16, color: [255, 128, 128] },   // L1: Pink
  { r: 22, color: [200, 0, 200] },     // L2: Purple
  { r: 28, color: [255, 165, 0] },     // L3: Orange
  { r: 36, color: [255, 215, 0] },     // L4: Gold
  { r: 44, color: [128, 255, 0] },     // L5: Lime
  { r: 54, color: [0, 255, 0] },       // L6: Green
  { r: 66, color: [0, 255, 255] },     // L7: Cyan
  { r: 80, color: [0, 128, 255] },     // L8: Light Blue
  { r: 96, color: [0, 0, 255] },       // L9: Blue
  { r: 114, color: [255, 255, 255] }   // L10: White
];

function setup() {
  createCanvas(400, 400);
}

function draw() {
  if (gameState !== 'PLAYING') {
    background(17);
    return;
  }

  Matter.Engine.update(engine, 1000 / 60);
  ticks++;

  // 1. Process Merges
  for (let m of pendingMerges) {
    Matter.World.remove(world, m.a);
    Matter.World.remove(world, m.b);

    let newLevel = m.level + 1;
    score += newLevel * 10;

    if (newLevel < FRUITS.length) {
      let nx = (m.a.position.x + m.b.position.x) / 2;
      let ny = (m.a.position.y + m.b.position.y) / 2;
      let newFruit = Matter.Bodies.circle(nx, ny, FRUITS[newLevel].r, {
        restitution: 0.2,
        friction: 0.2,
        density: 0.001 * (newLevel + 1)
      });
      newFruit.fruitLevel = newLevel;
      newFruit.spawnTick = ticks;
      Matter.World.add(world, newFruit);
    } else {
      score += 500;
    }
  }
  pendingMerges = [];
  mergeSet.clear();

  // 2. Process Life Loss (Overflow)
  let fruitsToDestroy = [];
  for (let body of Matter.Composite.allBodies(world)) {
    if (!body.isStatic && body.fruitLevel !== undefined) {
      if (body.position.y - body.circleRadius < 80 && ticks - body.spawnTick > 120) {
        fruitsToDestroy.push(body);
      }
    }
  }

  if (fruitsToDestroy.length > 0) {
    for (let b of fruitsToDestroy) {
      Matter.World.remove(world, b);
    }
    lives -= 1;
    score -= 50; // Penalty for overflow
    if (lives <= 0) {
      gameState = 'GAMEOVER';
      return;
    }
  }

  // 3. Input & Dropper Logic
  if (keyIsDown(37)) {
    dropperX -= 5;
  }
  if (keyIsDown(39)) {
    dropperX += 5;
  }

  let currentR = FRUITS[currentFruitLevel].r;
  dropperX = Math.max(currentR, Math.min(width - currentR, dropperX));

  if (keyIsDown(32) && dropCooldown <= 0) {
    let f = Matter.Bodies.circle(dropperX, dropperY, currentR, {
      restitution: 0.2,
      friction: 0.2,
      density: 0.001 * (currentFruitLevel + 1)
    });
    f.fruitLevel = currentFruitLevel;
    f.spawnTick = ticks;
    Matter.World.add(world, f);

    score += 1;
    currentFruitLevel = nextFruitLevel;
    nextFruitLevel = Math.floor(rng() * 4);
    dropCooldown = 45; 
  }

  if (dropCooldown > 0) dropCooldown--;

  // 4. Render
  background(17);

  stroke(255, 0, 0);
  strokeWeight(4);
  line(0, 80, width, 80);
  noStroke();

  for (let body of Matter.Composite.allBodies(world)) {
    if (!body.isStatic && body.fruitLevel !== undefined) {
      fill(FRUITS[body.fruitLevel].color);
      ellipse(body.position.x, body.position.y, FRUITS[body.fruitLevel].r * 2);
    }
  }

  if (dropCooldown <= 0) {
    fill(FRUITS[currentFruitLevel].color);
    ellipse(dropperX, dropperY, FRUITS[currentFruitLevel].r * 2);
  }
}

// ============================================================
// REQUIRED: RL interface
// ============================================================

function getGameState() {
  return {
    score: score,
    lives: lives,
    gameState: gameState,
  };
}

function resetGame(seed) {
  rng = mulberry32(seed);
  score = 0;
  lives = 3;
  gameState = 'PLAYING';
  ticks = 0;
  dropperX = 200;
  dropCooldown = 0;
  pendingMerges = [];
  mergeSet.clear();

  Matter.Common.random = function(min, max) {
    min = (typeof min !== "undefined") ? min : 0;
    max = (typeof max !== "undefined") ? max : 1;
    return min + rng() * (max - min);
  };

  engine = Matter.Engine.create();
  world = engine.world;
  engine.gravity.y = 1;

  let ground = Matter.Bodies.rectangle(200, 410, 400, 40, { isStatic: true });
  let leftWall = Matter.Bodies.rectangle(-20, 200, 40, 400, { isStatic: true });
  let rightWall = Matter.Bodies.rectangle(420, 200, 40, 400, { isStatic: true });
  Matter.World.add(world, [ground, leftWall, rightWall]);

  currentFruitLevel = Math.floor(rng() * 4);
  nextFruitLevel = Math.floor(rng() * 4);

  Matter.Events.on(engine, 'collisionStart', function(event) {
    for (let pair of event.pairs) {
      let a = pair.bodyA;
      let b = pair.bodyB;
      if (a.fruitLevel !== undefined && b.fruitLevel !== undefined && a.fruitLevel === b.fruitLevel) {
        if (!mergeSet.has(a.id) && !mergeSet.has(b.id)) {
          mergeSet.add(a.id);
          mergeSet.add(b.id);
          pendingMerges.push({ a: a, b: b, level: a.fruitLevel });
        }
      }
    }
  });
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