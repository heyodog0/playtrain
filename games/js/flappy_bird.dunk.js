let score = 0;
let lives = 1;
let gameState = 'PLAYING';

let bird = { x: 100, y: 150, vy: 0, size: 20, angle: 0, prevY: 150 };
let pipes = [];
let frames = 0;
let prevSpaceDown = false;
let lastHoopY = 200;

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
const FLAP_STRENGTH = -7.5;
const PIPE_SPEED = 3;
const PIPE_SPAWN_RATE = 110;
const HOOP_WIDTH = 100;

function setup() {
  createCanvas(400, 400);
  noStroke();
  resetGame(42);
}

function resetGame(seed) {
  let s = seed !== undefined ? seed : 42;
  rng = mulberry32(s);
  score = 0;
  lives = 1;
  gameState = 'PLAYING';

  bird = {
    x: 100,
    y: 150,
    vy: 0,
    size: 20,
    angle: 0,
    prevY: 150
  };

  pipes = [];
  frames = 0;
  prevSpaceDown = false;
  lastHoopY = 200;
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

function updateGame(spaceDown) {
  if (spaceDown && !prevSpaceDown) {
    bird.vy = FLAP_STRENGTH;
  }
  prevSpaceDown = spaceDown;

  bird.prevY = bird.y;
  bird.vy += GRAVITY;
  bird.y += bird.vy;
  bird.angle += bird.vy * 0.03 + 0.05;

  if (frames % PIPE_SPAWN_RATE === 0) {
    let h = (typeof height !== 'undefined' && height > 0) ? height : 400;
    let w = (typeof width !== 'undefined' && width > 0) ? width : 400;
    
    let range = 120;
    let nextY = lastHoopY + (rng() * range * 2 - range);
    nextY = Math.max(120, Math.min(h - 120, nextY));
    lastHoopY = nextY;
    
    pipes.push({
      x: w,
      y: nextY,
      w: HOOP_WIDTH,
      passed: false,
      missed: false
    });
  }

  for (let i = pipes.length - 1; i >= 0; i--) {
    let p = pipes[i];
    p.x -= PIPE_SPEED;

    let birdR = bird.size / 2;
    let rimR = 5;
    let leftRim = { x: p.x, y: p.y };
    let rightRim = { x: p.x + p.w, y: p.y };

    let dLeft = Math.hypot(bird.x - leftRim.x, bird.y - leftRim.y);
    let dRight = Math.hypot(bird.x - rightRim.x, bird.y - rightRim.y);

    if (dLeft < birdR + rimR || dRight < birdR + rimR) {
      die();
    }

    if (bird.x > p.x && bird.x < p.x + p.w && !p.passed) {
      if (bird.prevY <= p.y && bird.y > p.y) {
        p.passed = true;
        score += 1;
      }
    }

    if (p.x + p.w < bird.x - birdR) {
      if (!p.passed && !p.missed) {
        p.missed = true;
        die();
      }
    }

    if (p.x + p.w < -50) {
      pipes.splice(i, 1);
    }
  }

  let h = (typeof height !== 'undefined' && height > 0) ? height : 400;
  if (bird.y + bird.size / 2 > h || bird.y < -50) {
    die();
  }

  frames++;
}

function die() {
  gameState = 'GAMEOVER';
  lives = 0;
}

function render() {
  let w = (typeof width !== 'undefined' && width > 0) ? width : 400;
  let h = (typeof height !== 'undefined' && height > 0) ? height : 400;

  background(30, 25, 45);

  fill(45, 35, 55);
  noStroke();
  rect(0, h - 40, w, 40);

  stroke(70, 50, 80);
  strokeWeight(2);
  for (let i = 0; i < w; i += 40) {
    let x = (i - (frames * PIPE_SPEED * 0.5) % 40 + w) % w;
    line(x, h - 40, x - 15, h);
  }

  for (let p of pipes) {
    stroke(255, 255, 255, 80);
    strokeWeight(1);
    for (let j = 0; j <= 5; j++) {
      let startX = p.x + 10 + (p.w - 20) * (j / 5);
      let endX = p.x + 25 + (p.w - 50) * (j / 5);
      line(startX, p.y, endX, p.y + 40);
    }
    
    stroke(200, 50, 10);
    strokeWeight(4);
    noFill();
    arc(p.x + p.w / 2, p.y, p.w, 24, PI, TWO_PI);

    noStroke();
    fill(220, 220, 235, 180);
    rect(p.x + p.w, p.y - 40, 8, 70, 2);
    stroke(255);
    strokeWeight(2);
    noFill();
    rect(p.x + p.w, p.y - 40, 8, 70, 2);
  }

  push();
  translate(bird.x, bird.y);
  rotate(bird.angle);
  
  let r = bird.size / 2;

  noStroke();
  fill(255, 120, 0);
  circle(0, 0, bird.size);

  fill(255, 255, 255, 40);
  arc(0, 0, bird.size, bird.size, PI, TWO_PI);
  fill(0, 0, 0, 40);
  arc(0, 0, bird.size, bird.size, 0, PI);

  stroke(50, 15, 0);
  strokeWeight(1.5);
  noFill();
  arc(0, 0, r, r * 2, -PI / 2, PI / 2);
  line(-r, 0, r, 0);
  pop();

  for (let p of pipes) {
    stroke(255, 80, 20);
    strokeWeight(4);
    noFill();
    arc(p.x + p.w / 2, p.y, p.w, 24, 0, PI);

    stroke(255, 255, 255, 160);
    strokeWeight(1.5);
    for (let j = 0; j <= 5; j++) {
      let startX = p.x + 5 + (p.w - 10) * (j / 5);
      let endX = p.x + 15 + (p.w - 30) * (j / 5);
      line(startX, p.y + 11, endX, p.y + 40);
    }
    
    stroke(255, 255, 255, 120);
    arc(p.x + p.w / 2, p.y + 40, p.w - 30, 8, 0, PI);

    noStroke();
    fill(255, 110, 40);
    circle(p.x, p.y, 10);
    circle(p.x + p.w, p.y, 10);
  }

  fill(255);
  noStroke();
  textSize(24);
  textAlign(LEFT, TOP);
  text("Score: " + score, 10, 10);

  if (gameState === 'GAMEOVER') {
    fill(0, 0, 0, 150);
    rect(0, 0, w, h);
    fill(255);
    textAlign(CENTER, CENTER);
    textSize(32);
    text("GAME OVER", w / 2, h / 2 - 20);
    textSize(16);
    text("Press SPACE to Restart", w / 2, h / 2 + 20);
  }
}