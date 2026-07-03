let score = 0;
let lives = 1;
let gameState = 'PLAYING';

let bird = { x: 100, y: 200, vy: 0, size: 24, prevY: 200 };
let pipes = [];
let frames = 0;
let prevSpaceDown = false;

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

const GRAVITY = 0.4;
const FLAP_STRENGTH = -6;
const PIPE_SPEED = 3;
const PIPE_SPAWN_RATE = 80;
const HOOP_WIDTH = 80;

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
    y: 200,
    vy: 0,
    size: 24,
    prevY: 200
  };

  pipes = [];
  frames = 0;
  prevSpaceDown = false;
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
  if (bird.vy > 10) bird.vy = 10;
  bird.y += bird.vy;

  if (frames % PIPE_SPAWN_RATE === 0) {
    let h = (typeof height !== 'undefined' && height > 0) ? height : 400;
    let w = (typeof width !== 'undefined' && width > 0) ? width : 400;
    let gapY = 150 + Math.floor(rng() * Math.max(10, h - 250));
    
    pipes.push({
      x: w,
      y: gapY,
      passed: false
    });
  }

  for (let i = pipes.length - 1; i >= 0; i--) {
    let p = pipes[i];
    p.x -= PIPE_SPEED;

    if (!p.passed) {
      if (bird.x > p.x && bird.x < p.x + HOOP_WIDTH) {
        if (bird.prevY <= p.y && bird.y > p.y) {
          p.passed = true;
          score += 1;
        }
      }
    }

    if (!p.passed && p.x + HOOP_WIDTH < bird.x - bird.size / 2) {
      die();
    }

    let r = bird.size / 2;
    
    let dLeft = dist(bird.x, bird.y, p.x, p.y);
    if (dLeft < r) {
      if (bird.y < p.y) {
        bird.y = p.y - r;
        bird.vy = -4;
      } else {
        bird.y = p.y + r;
        bird.vy = 2;
      }
    }
    
    let dRight = dist(bird.x, bird.y, p.x + HOOP_WIDTH, p.y);
    if (dRight < r) {
      if (bird.y < p.y) {
        bird.y = p.y - r;
        bird.vy = -4;
      } else {
        bird.y = p.y + r;
        bird.vy = 2;
      }
    }

    if (p.x + HOOP_WIDTH < 0) {
      pipes.splice(i, 1);
    }
  }

  let h = (typeof height !== 'undefined' && height > 0) ? height : 400;
  if (bird.y + bird.size / 2 > h) {
    die();
  }

  frames++;
}

function die() {
  gameState = 'GAMEOVER';
  lives = 0;
}

function render() {
  background(240, 245, 250);

  if (gameState === 'PLAYING' || gameState === 'GAMEOVER') {
    fill(220, 225, 230);
    noStroke();
    textSize(150);
    textAlign(CENTER, CENTER);
    text(score, width / 2, height / 2);
  }

  for (let p of pipes) {
    let hw = HOOP_WIDTH;
    let hh = 15;
    
    stroke(200);
    strokeWeight(1);
    fill(255, 255, 255, 180);
    beginShape();
    vertex(p.x, p.y);
    vertex(p.x + 10, p.y + 40);
    vertex(p.x + hw - 10, p.y + 40);
    vertex(p.x + hw, p.y);
    endShape(CLOSE);
    
    stroke(220);
    for(let i = 1; i <= 3; i++) {
      let topX = p.x + i * hw/4;
      let botX = p.x + 10 + i * (hw-20)/4;
      line(topX, p.y, botX, p.y + 40);
      line(p.x + i * hw/4, p.y, p.x + 10 + (i-1) * (hw-20)/4, p.y + 40);
      line(p.x + (i-1) * hw/4, p.y, p.x + 10 + i * (hw-20)/4, p.y + 40);
    }
    
    stroke(220, 50, 0);
    noFill();
    strokeWeight(4);
    arc(p.x + hw/2, p.y, hw, hh, PI, TWO_PI);
  }

  push();
  translate(bird.x, bird.y);
  rotate(frames * 0.05);
  
  fill(255, 140, 0);
  noStroke();
  circle(0, 0, bird.size);
  
  stroke(50);
  strokeWeight(1.5);
  noFill();
  
  arc(-bird.size/4, 0, bird.size/2, bird.size, -PI/2, PI/2);
  arc(bird.size/4, 0, bird.size/2, bird.size, PI/2, 3*PI/2);
  line(0, -bird.size/2, 0, bird.size/2);
  line(-bird.size/2, 0, bird.size/2, 0);
  pop();

  for (let p of pipes) {
    let hw = HOOP_WIDTH;
    let hh = 15;
    
    stroke(255, 80, 0);
    noFill();
    strokeWeight(4);
    arc(p.x + hw/2, p.y, hw, hh, 0, PI);
    
    fill(255, 80, 0);
    noStroke();
    circle(p.x, p.y, 4);
    circle(p.x + hw, p.y, 4);
  }

  if (gameState === 'GAMEOVER') {
    fill(0, 150);
    rectMode(CORNER);
    rect(0, 0, width, height);
    
    fill(255);
    noStroke();
    textSize(40);
    textAlign(CENTER, CENTER);
    text("GAME OVER", width / 2, height / 2 - 20);
    textSize(20);
    text("Score: " + score, width / 2, height / 2 + 30);
    text("Press SPACE to Restart", width / 2, height / 2 + 70);
  }
}