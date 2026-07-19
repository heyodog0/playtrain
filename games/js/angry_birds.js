let engine, world;
let score = 0;
let lives = 3;
let gameState = 'PLAYING';
let rng = null;

let aimAngle = -Math.PI / 4;
let aimPower = 15;
let statePhase = 'AIMING';
let birdBody = null;
let pigs = [];
let blocks = [];
let ground;
let frameTimer = 0;

const SLING_X = 50;
const SLING_Y = 280;

function setup() {
  createCanvas(400, 400);
  rectMode(CENTER);
}

function resetGame(seed) {
  rng = mulberry32(seed);
  score = 0;
  lives = 3;
  gameState = 'PLAYING';
  statePhase = 'AIMING';
  aimAngle = -Math.PI / 4;
  aimPower = 15;
  frameTimer = 0;
  birdBody = null;
  pigs = [];
  blocks = [];

  engine = Matter.Engine.create();
  world = engine.world;
  engine.gravity.y = 1;
  engine.gravity.scale = 0.001;

  ground = Matter.Bodies.rectangle(200, 390, 400, 40, { isStatic: true, friction: 0.8 });
  Matter.World.add(world, ground);

  let startX = 200 + Math.floor(rng() * 100);
  let type = Math.floor(rng() * 3);

  if (type === 0) {
    addBlock(startX, 340, 20, 60);
    addPig(startX, 300);
  } else if (type === 1) {
    addBlock(startX, 340, 15, 60);
    addBlock(startX + 60, 340, 15, 60);
    addPig(startX + 30, 350);
    addBlock(startX + 30, 305, 100, 15);
    addPig(startX + 30, 285);
  } else {
    addBlock(startX, 340, 15, 60);
    addBlock(startX + 40, 340, 15, 60);
    addBlock(startX + 80, 340, 15, 60);
    addPig(startX + 20, 350);
    addPig(startX + 60, 350);
    addBlock(startX + 40, 305, 120, 15);
    addPig(startX + 40, 285);
  }
}

function addBlock(x, y, w, h) {
  let b = Matter.Bodies.rectangle(x, y, w, h, { friction: 0.5, restitution: 0.2, density: 0.001 });
  b.w = w;
  b.h = h;
  blocks.push(b);
  Matter.World.add(world, b);
}

function addPig(x, y) {
  let p = Matter.Bodies.circle(x, y, 12, { friction: 0.3, restitution: 0.4, density: 0.001 });
  p.r = 12;
  pigs.push(p);
  Matter.World.add(world, p);
}

function draw() {
  Matter.Engine.update(engine, 1000 / 60);

  background(20);

  if (gameState !== 'PLAYING') {
    drawWorld();
    return;
  }

  if (statePhase === 'AIMING') {
    if (keyIsDown(37)) aimAngle = Math.max(aimAngle - 0.05, -Math.PI / 2);
    if (keyIsDown(39)) aimAngle = Math.min(aimAngle + 0.05, Math.PI / 8);
    if (keyIsDown(38)) aimPower = Math.min(aimPower + 0.5, 25);
    if (keyIsDown(40)) aimPower = Math.max(aimPower - 0.5, 5);

    if (keyIsDown(32)) {
      birdBody = Matter.Bodies.circle(SLING_X, SLING_Y, 10, { density: 0.005, friction: 0.3, restitution: 0.5 });
      Matter.World.add(world, birdBody);
      
      let vx = Math.cos(aimAngle) * aimPower;
      let vy = Math.sin(aimAngle) * aimPower;
      Matter.Body.setVelocity(birdBody, { x: vx, y: vy });

      statePhase = 'FLYING';
      frameTimer = 0;
    }
  } else if (statePhase === 'FLYING') {
    frameTimer++;

    for (let i = pigs.length - 1; i >= 0; i--) {
      let p = pigs[i];
      if (p.position.y > 400 || p.speed > 3.0) {
        Matter.World.remove(world, p);
        pigs.splice(i, 1);
        score += 100;
      }
    }

    for (let i = blocks.length - 1; i >= 0; i--) {
      let b = blocks[i];
      if (b.position.y > 400 || b.speed > 4.0) {
        Matter.World.remove(world, b);
        blocks.splice(i, 1);
        score += 10;
      }
    }

    if (pigs.length === 0) {
      gameState = 'WIN';
    } else if (frameTimer > 240) {
      lives--;
      if (lives <= 0) {
        gameState = 'GAMEOVER';
      } else {
        statePhase = 'AIMING';
        if (birdBody) {
          Matter.World.remove(world, birdBody);
          birdBody = null;
        }
      }
    }
  }

  drawWorld();
}

function drawWorld() {
  fill(100);
  noStroke();
  rect(SLING_X, SLING_Y + 45, 10, 90);

  fill(80);
  rect(ground.position.x, ground.position.y, 400, 40);

  if (statePhase === 'AIMING') {
    stroke(255, 255, 0);
    strokeWeight(3);
    let indX = SLING_X + Math.cos(aimAngle) * aimPower * 3;
    let indY = SLING_Y + Math.sin(aimAngle) * aimPower * 3;
    line(SLING_X, SLING_Y, indX, indY);
    noStroke();

    fill(255, 50, 50);
    ellipse(SLING_X, SLING_Y, 20, 20);
  } else if (birdBody) {
    fill(255, 50, 50);
    noStroke();
    push();
    translate(birdBody.position.x, birdBody.position.y);
    rotate(birdBody.angle);
    ellipse(0, 0, 20, 20);
    pop();
  }

  fill(50, 150, 255);
  noStroke();
  for (let b of blocks) {
    push();
    translate(b.position.x, b.position.y);
    rotate(b.angle);
    rect(0, 0, b.w, b.h);
    pop();
  }

  fill(50, 255, 50);
  noStroke();
  for (let p of pigs) {
    push();
    translate(p.position.x, p.position.y);
    rotate(p.angle);
    ellipse(0, 0, p.r * 2, p.r * 2);
    pop();
  }

  fill(255, 50, 50);
  noStroke();
  for (let i = 0; i < lives; i++) {
    ellipse(20 + i * 15, 20, 10, 10);
  }
}

function getGameState() {
  return {
    score: score,
    lives: lives,
    gameState: gameState
  };
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let n = Math.imul(t ^ (t >>> 15), t | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}