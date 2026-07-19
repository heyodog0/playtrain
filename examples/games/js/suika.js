let engine, world;
let score = 0;
let lives = 1;
let gameState = 'PLAYING';

let dropperX = 200;
let dropperY = 40;
let currentFruitLevel = -1;
let nextFruitLevel = 0;
let dropCooldown = 0;
let ticks = 0;

let pendingMerges = [];
let mergeSet = new Set();

const PLAY_WIDTH = 260;
const LEFT_WALL_X = 70;
const RIGHT_WALL_X = 330;
const OVERFLOW_Y = 100;

const FRUITS = [
  { r: 14, color: [255, 50, 50] },    // L0: Cherry
  { r: 20, color: [255, 100, 255] },  // L1: Strawberry
  { r: 28, color: [180, 100, 255] },  // L2: Grape
  { r: 36, color: [255, 180, 50] },   // L3: Dekopon
  { r: 46, color: [255, 255, 50] },   // L4: Orange
  { r: 58, color: [100, 255, 50] },   // L5: Apple
  { r: 72, color: [50, 255, 150] },   // L6: Pear
  { r: 88, color: [50, 200, 255] },   // L7: Peach
  { r: 106, color: [50, 100, 255] },  // L8: Pineapple
  { r: 126, color: [150, 50, 255] },  // L9: Melon
  { r: 140, color: [255, 255, 255] }  // L10: Watermelon
];

function setup() {
  createCanvas(400, 400);
}

function draw() {
  if (gameState !== 'PLAYING') {
    background(0);
    return;
  }

  Matter.Engine.update(engine, 1000 / 60);
  ticks++;

  // 1. Process Merges
  for (let m of pendingMerges) {
    if (m.a && m.b) {
      Matter.World.remove(world, m.a);
      Matter.World.remove(world, m.b);

      let newLevel = m.level + 1;
      score += (newLevel + 1) * 15;

      if (newLevel < FRUITS.length) {
        let nx = (m.a.position.x + m.b.position.x) / 2;
        let ny = (m.a.position.y + m.b.position.y) / 2;
        let newFruit = Matter.Bodies.circle(nx, ny, FRUITS[newLevel].r, {
          restitution: 0.4,
          friction: 0.1,
          density: 0.001 * (newLevel + 1)
        });
        newFruit.fruitLevel = newLevel;
        newFruit.spawnTick = ticks;
        Matter.World.add(world, newFruit);
      } else {
        score += 1000; // Max fruit bonus
      }
    }
  }
  pendingMerges = [];
  mergeSet.clear();

  // 2. Process Game Over (Overflow)
  let bodies = Matter.Composite.allBodies(world);
  for (let body of bodies) {
    if (!body.isStatic && body.fruitLevel !== undefined) {
      if (body.position.y - body.circleRadius < OVERFLOW_Y && (ticks - body.spawnTick) > 100) {
        lives = 0;
        gameState = 'GAMEOVER';
      }
    }
  }

  // 3. Input & Dropper Logic
  if (keyIsDown(37)) { dropperX -= 4; }
  if (keyIsDown(39)) { dropperX += 4; }

  let currentR = (currentFruitLevel === -1) ? FRUITS[0].r : FRUITS[currentFruitLevel].r;
  dropperX = Math.max(LEFT_WALL_X + currentR, Math.min(RIGHT_WALL_X - currentR, dropperX));

  if (keyIsDown(32) && dropCooldown <= 0 && currentFruitLevel !== -1) {
    let f = Matter.Bodies.circle(dropperX, dropperY, currentR, {
      restitution: 0.4,
      friction: 0.1,
      density: 0.001 * (currentFruitLevel + 1)
    });
    f.fruitLevel = currentFruitLevel;
    f.spawnTick = ticks;
    Matter.World.add(world, f);

    score += 1;
    currentFruitLevel = -1; // Set to empty to signal cooldown
    dropCooldown = 40;
  }

  if (dropCooldown > 0) {
    dropCooldown--;
    if (dropCooldown === 0) {
      currentFruitLevel = nextFruitLevel;
      nextFruitLevel = Math.floor(rng() * 4);
    }
  }

  // 4. Render
  background(15);

  // Draw Container
  fill(40);
  noStroke();
  rect(LEFT_WALL_X - 10, 0, 10, height);
  rect(RIGHT_WALL_X, 0, 10, height);
  rect(LEFT_WALL_X, height - 10, PLAY_WIDTH, 10);

  // Draw Overflow Line
  stroke(255, 0, 0);
  strokeWeight(2);
  line(LEFT_WALL_X, OVERFLOW_Y, RIGHT_WALL_X, OVERFLOW_Y);
  noStroke();

  // Draw Bodies
  for (let body of bodies) {
    if (!body.isStatic && body.fruitLevel !== undefined) {
      fill(FRUITS[body.fruitLevel].color);
      ellipse(body.position.x, body.position.y, body.circleRadius * 2);
    }
  }

  // Draw Dropper Preview
  if (currentFruitLevel !== -1) {
    fill(FRUITS[currentFruitLevel].color);
    ellipse(dropperX, dropperY, FRUITS[currentFruitLevel].r * 2);
  }

  // Draw Next Indicator (Top-Left)
  fill(40);
  rect(5, 5, 30, 30);
  if (nextFruitLevel !== -1) {
    fill(FRUITS[nextFruitLevel].color);
    rect(10, 10, 20, 20);
  }
}

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
  lives = 1;
  gameState = 'PLAYING';
  ticks = 0;
  dropperX = 200;
  dropCooldown = 0;
  pendingMerges = [];
  mergeSet.clear();

  engine = Matter.Engine.create();
  world = engine.world;
  engine.gravity.y = 1.2;

  Matter.Common.random = function(min, max) {
    min = (typeof min !== "undefined") ? min : 0;
    max = (typeof max !== "undefined") ? max : 1;
    return min + rng() * (max - min);
  };

  let ground = Matter.Bodies.rectangle(200, 405, 400, 30, { isStatic: true });
  let leftWall = Matter.Bodies.rectangle(LEFT_WALL_X - 5, 200, 10, 400, { isStatic: true });
  let rightWall = Matter.Bodies.rectangle(RIGHT_WALL_X + 5, 200, 10, 400, { isStatic: true });
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