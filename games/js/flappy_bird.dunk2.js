let score = 0;
let lives = 1;
let gameState = 'PLAYING';

let bird = { x: 100, y: 200, vy: 0, size: 24, prevY: 200 };
let pipes = [];
let frames = 0;
let prevFlapDown = false;

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

const GRAVITY = 0.4;
const FLAP_STRENGTH = -6;
const PIPE_SPEED = 3;
const PIPE_SPAWN_RATE = 80;
const HOOP_WIDTH = 80;

function setup() {
  createCanvas(400, 400);
  noStroke();
}

function resetGame(seed) {
  rng = mulberry32(seed);
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
  prevFlapDown = false;
}

function getGameState() {
  return {
    score: score,
    lives: lives,
    gameState: gameState
  };
}

function draw() {
  // Map both SPACE (32) and UP (38) to jump/flap action
  let flapDown = keyIsDown(32) || keyIsDown(38);
  
  if (gameState === 'PLAYING') {
    updateGame(flapDown);
  } else if (gameState === 'GAMEOVER') {
    if (flapDown && !prevFlapDown) {
      resetGame(42); // Fallback for manual human replay
    }
    prevFlapDown = flapDown;
  }
  
  render();
}

function updateGame(flapDown) {
  if (flapDown && !prevFlapDown) {
    bird.vy = FLAP_STRENGTH;
  }
  prevFlapDown = flapDown;

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
  background(0);

  for (let p of pipes) {
    let hw = HOOP_WIDTH;
    
    // Draw bridge/target zone indicating where to fall through
    if (!p.passed) {
      fill(0, 255, 0);
      noStroke();
      rect(p.x, p.y - 4, hw, 8);
    }
    
    // Draw solid shapes for hoop endpoints (red for danger)
    fill(255, 0, 0);
    noStroke();
    circle(p.x, p.y, 16);
    circle(p.x + hw, p.y, 16);
  }

  // Draw bird
  fill(0, 100, 255);
  noStroke();
  circle(bird.x, bird.y, bird.size);
}