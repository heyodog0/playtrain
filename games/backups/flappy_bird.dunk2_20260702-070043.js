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
  background(113, 197, 207);

  fill(255, 255, 255, 200);
  noStroke();
  for(let i = 0; i < 4; i++) {
    let cx = ((frames * 0.5) + i * 250) % 650 - 100;
    let cy = 80 + (i * 40) % 100;
    ellipse(400 - cx, cy, 70, 50);
    ellipse(400 - cx + 25, cy - 15, 70, 50);
    ellipse(400 - cx + 50, cy, 70, 50);
  }

  fill(142, 204, 87);
  stroke(113, 163, 69);
  strokeWeight(2);
  for(let i = 0; i < 6; i++) {
    let bx = ((frames * 1.5) + i * 100) % 500 - 50;
    arc(400 - bx, height - 20, 100, 80, PI, TWO_PI);
  }

  let groundY = height - 20;
  fill(222, 216, 149);
  stroke(115, 191, 46);
  strokeWeight(4);
  rect(-10, groundY, width + 20, 30);

  stroke(200, 190, 120);
  strokeWeight(3);
  for(let i = -1; i <= width / 30 + 1; i++) {
    let lx = i * 30 - ((frames * PIPE_SPEED) % 30);
    line(lx + 10, groundY + 5, lx, height);
  }

  for (let p of pipes) {
    let hw = HOOP_WIDTH;
    let hh = 15;
    
    fill(255, 255, 255, 150);
    stroke(200);
    strokeWeight(2);
    let bbW = 12;
    let bbH = 60;
    rect(p.x + hw + 5, p.y - 45, bbW, bbH, 3);
    
    stroke(255, 0, 0);
    strokeWeight(2);
    noFill();
    rect(p.x + hw + 5, p.y - 20, 4, 20);

    stroke(150, 40, 0);
    noFill();
    strokeWeight(4);
    arc(p.x + hw/2, p.y + 3, hw, hh, PI, TWO_PI);
    stroke(200, 50, 0);
    arc(p.x + hw/2, p.y, hw, hh, PI, TWO_PI);

    stroke(255, 150);
    strokeWeight(1.5);
    let segments = 6;
    let netH = 35;
    for (let i = 0; i <= segments; i++) {
      let topX = p.x + (hw / segments) * i;
      if (i < segments) {
        let botX = p.x + hw/2 + ((i+1) - segments/2) * (hw/segments * 0.6);
        line(topX, p.y, botX, p.y + netH);
      }
      if (i > 0) {
        let botX = p.x + hw/2 + ((i-1) - segments/2) * (hw/segments * 0.6);
        line(topX, p.y, botX, p.y + netH);
      }
    }
  }

  push();
  translate(bird.x, bird.y);
  
  let isFlapping = bird.vy < 0;
  let flapAngle = isFlapping ? -PI/4 : PI/6;
  fill(255);
  stroke(0);
  strokeWeight(1.5);
  push();
  translate(-10, -5);
  rotate(flapAngle);
  ellipse(-8, 0, 20, 12);
  line(-15, -2, -10, -5);
  line(-17, 2, -12, 1);
  pop();

  rotate(frames * 0.1);
  
  fill(150, 70, 0);
  noStroke();
  circle(2, 2, bird.size);

  fill(255, 140, 0);
  stroke(0);
  strokeWeight(1.5);
  circle(0, 0, bird.size);

  noFill();
  stroke(0);
  strokeWeight(1.5);
  arc(-bird.size/4, 0, bird.size/1.5, bird.size, -PI/2.5, PI/2.5);
  arc(bird.size/4, 0, bird.size/1.5, bird.size, PI - PI/2.5, PI + PI/2.5);
  line(-bird.size/2, 0, bird.size/2, 0);
  line(0, -bird.size/2, 0, bird.size/2);
  pop();

  for (let p of pipes) {
    let hw = HOOP_WIDTH;
    let hh = 15;
    
    stroke(255, 220);
    strokeWeight(2);
    let segments = 6;
    let netH = 35;
    for (let i = 0; i <= segments; i++) {
      let topX = p.x + (hw / segments) * i;
      if (i < segments) {
        let botX = p.x + hw/2 + ((i+1) - segments/2) * (hw/segments * 0.6);
        line(topX, p.y, botX, p.y + netH);
      }
      if (i > 0) {
        let botX = p.x + hw/2 + ((i-1) - segments/2) * (hw/segments * 0.6);
        line(topX, p.y, botX, p.y + netH);
      }
    }

    stroke(180, 50, 0);
    noFill();
    strokeWeight(4);
    arc(p.x + hw/2, p.y + 3, hw, hh, 0, PI);
    stroke(255, 80, 0);
    arc(p.x + hw/2, p.y, hw, hh, 0, PI);
    
    fill(180, 50, 0);
    noStroke();
    circle(p.x, p.y + 3, 5);
    circle(p.x + hw, p.y + 3, 5);

    fill(255, 80, 0);
    circle(p.x, p.y, 5);
    circle(p.x + hw, p.y, 5);
  }

  if (gameState === 'PLAYING') {
    fill(255);
    stroke(0);
    strokeWeight(4);
    textSize(40);
    textAlign(CENTER, TOP);
    text(score, width / 2, 30);
  } else if (gameState === 'GAMEOVER') {
    fill(0, 150);
    noStroke();
    rectMode(CORNER);
    rect(0, 0, width, height);
    
    fill(222, 216, 149);
    stroke(84, 56, 71);
    strokeWeight(4);
    rectMode(CENTER);
    rect(width / 2, height / 2, 280, 180, 10);
    
    fill(255);
    stroke(0);
    strokeWeight(4);
    textSize(36);
    textAlign(CENTER, CENTER);
    text("GAME OVER", width / 2, height / 2 - 50);
    
    fill(255, 200, 0);
    textSize(28);
    text("Score: " + score, width / 2, height / 2 + 10);
    
    fill(255);
    textSize(18);
    strokeWeight(2);
    text("Press SPACE to Restart", width / 2, height / 2 + 60);
    
    rectMode(CORNER);
  }
}