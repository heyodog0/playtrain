let score = 0;
let lives = 1;
let gameState = 'PLAYING';

let bird = { x: 80, y: 200, vy: 0, size: 24 };
let pipes = [];
let frames = 0;
let prevSpaceDown = false;
let groundScroll = 0;
let bgScroll = 0;

function mulberry32(seed) {
  let t = seed !== undefined ? seed >>> 0 : 42;
  return function() {
    t += 0x6D2B79F5;
    let n = Math.imul(t ^ (t >>> 15), t | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

let rng = mulberry32(42);

const GRAVITY = 0.5;
const FLAP_STRENGTH = -7;
const PIPE_SPEED = 3;
const PIPE_SPAWN_RATE = 90;
const PIPE_WIDTH = 52;
const GAP_SIZE = 120;
const GROUND_Y = 350;

function setup() {
  createCanvas(400, 400);
  resetGame(42);
}

function resetGame(seed) {
  let s = seed !== undefined ? seed : 42;
  rng = mulberry32(s);
  score = 0;
  lives = 1;
  gameState = 'PLAYING';

  bird = {
    x: 80,
    y: 200,
    vy: 0,
    size: 24
  };

  pipes = [];
  frames = 0;
  prevSpaceDown = false;
  groundScroll = 0;
  bgScroll = 0;
}

function getGameState() {
  return {
    score: score,
    lives: lives,
    gameState: gameState
  };
}

function draw() {
  let spaceDown = keyIsDown(32);
  
  if (gameState === 'PLAYING') {
    updateGame(spaceDown);
  } else if (gameState === 'GAMEOVER') {
    if (spaceDown && !prevSpaceDown) {
      resetGame(42);
    }
    prevSpaceDown = spaceDown;
  }
  
  render();
}

function circleRectCollide(cx, cy, cr, rx, ry, rw, rh) {
  let testX = cx;
  let testY = cy;

  if (cx < rx) testX = rx;
  else if (cx > rx + rw) testX = rx + rw;

  if (cy < ry) testY = ry;
  else if (cy > ry + rh) testY = ry + rh;

  let distX = cx - testX;
  let distY = cy - testY;
  let distance = Math.sqrt((distX * distX) + (distY * distY));

  return distance <= cr;
}

function updateGame(spaceDown) {
  if (spaceDown && !prevSpaceDown) {
    bird.vy = FLAP_STRENGTH;
  }
  prevSpaceDown = spaceDown;

  bird.vy += GRAVITY;
  if (bird.vy > 10) bird.vy = 10;
  bird.y += bird.vy;

  groundScroll = (groundScroll + PIPE_SPEED) % 20;
  bgScroll = (bgScroll + PIPE_SPEED * 0.5) % 450;

  if (frames % PIPE_SPAWN_RATE === 0) {
    let maxGapTop = GROUND_Y - 50 - GAP_SIZE;
    let gapTop = 50 + Math.floor(rng() * (maxGapTop - 50));
    
    pipes.push({
      x: width,
      gapTop: gapTop,
      gapBottom: gapTop + GAP_SIZE,
      passed: false
    });
  }

  let r = bird.size / 2;
  for (let i = pipes.length - 1; i >= 0; i--) {
    let p = pipes[i];
    p.x -= PIPE_SPEED;

    let capH = 20;
    
    if (circleRectCollide(bird.x, bird.y, r, p.x, 0, PIPE_WIDTH, p.gapTop)) die();
    if (circleRectCollide(bird.x, bird.y, r, p.x - 2, p.gapTop - capH, PIPE_WIDTH + 4, capH)) die();
    
    if (circleRectCollide(bird.x, bird.y, r, p.x, p.gapBottom, PIPE_WIDTH, GROUND_Y - p.gapBottom)) die();
    if (circleRectCollide(bird.x, bird.y, r, p.x - 2, p.gapBottom, PIPE_WIDTH + 4, capH)) die();

    if (!p.passed && p.x + PIPE_WIDTH < bird.x - r) {
      p.passed = true;
      score += 1;
    }

    if (p.x + PIPE_WIDTH + 4 < 0) {
      pipes.splice(i, 1);
    }
  }

  if (bird.y + r > GROUND_Y) {
    die();
  } else if (bird.y - r < 0) {
    bird.y = r;
    bird.vy = 0;
  }

  frames++;
}

function die() {
  gameState = 'GAMEOVER';
  lives = 0;
}

function render() {
  background(112, 197, 206);
  
  noStroke();
  fill(255, 255, 255, 200);
  for(let i = 0; i < 3; i++) {
    let cx = ((i * 180 - bgScroll) % 450 + 450) % 450 - 50;
    ellipse(cx, 100, 40, 40);
    ellipse(cx + 20, 110, 30, 30);
    ellipse(cx - 20, 110, 30, 30);
    rect(cx - 20, 95, 40, 30);
  }

  let capH = 20;
  for (let p of pipes) {
    stroke(84, 56, 71);
    strokeWeight(3);
    fill(115, 191, 46);
    
    rect(p.x, 0, PIPE_WIDTH, p.gapTop);
    rect(p.x - 2, p.gapTop - capH, PIPE_WIDTH + 4, capH);
    
    rect(p.x, p.gapBottom, PIPE_WIDTH, GROUND_Y - p.gapBottom);
    rect(p.x - 2, p.gapBottom, PIPE_WIDTH + 4, capH);
    
    noStroke();
    fill(156, 229, 83);
    rect(p.x + 4, 0, 4, p.gapTop - capH);
    rect(p.x + 2, p.gapTop - capH + 2, 4, capH - 4);
    
    rect(p.x + 4, p.gapBottom + capH, 4, GROUND_Y - p.gapBottom - capH);
    rect(p.x + 2, p.gapBottom + 2, 4, capH - 4);
  }

  stroke(84, 56, 71);
  strokeWeight(3);
  fill(222, 216, 149);
  rect(-1, GROUND_Y, width + 2, height - GROUND_Y);
  
  fill(115, 191, 46);
  rect(-1, GROUND_Y, width + 2, 12);
  
  stroke(84, 56, 71);
  strokeWeight(3);
  for (let i = 0; i < width / 20 + 2; i++) {
    let sx = i * 20 - groundScroll;
    line(sx, GROUND_Y, sx - 10, GROUND_Y + 12);
  }

  push();
  translate(bird.x, bird.y);
  let angle = map(bird.vy, FLAP_STRENGTH, 10, -PI/6, PI/2);
  angle = constrain(angle, -PI/6, PI/2);
  rotate(angle);
  
  stroke(84, 56, 71);
  strokeWeight(2);
  fill(244, 205, 43);
  ellipse(0, 0, bird.size, bird.size);
  
  fill(255);
  ellipse(6, -5, 10, 10);
  fill(0);
  ellipse(8, -5, 4, 4);
  
  fill(240, 100, 20);
  arc(5, 3, 16, 12, 0, PI);
  line(5, 3, 13, 3);
  
  fill(255);
  let wingY = (frames % 12 < 6 && gameState === 'PLAYING') ? 2 : -2;
  ellipse(-5, wingY, 14, 10);
  pop();

  if (gameState === 'PLAYING') {
    fill(255);
    stroke(0);
    strokeWeight(4);
    textSize(32);
    textAlign(CENTER, TOP);
    text(score, width / 2, 20);
  }

  if (gameState === 'GAMEOVER') {
    fill(0, 150);
    noStroke();
    rectMode(CORNER);
    rect(0, 0, width, height);
    
    fill(255);
    stroke(0);
    strokeWeight(4);
    textSize(40);
    textAlign(CENTER, CENTER);
    text("GAME OVER", width / 2, height / 2 - 20);
    textSize(20);
    text("Score: " + score, width / 2, height / 2 + 30);
    text("Press SPACE to Restart", width / 2, height / 2 + 70);
  }
}