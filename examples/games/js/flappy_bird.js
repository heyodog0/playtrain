let score = 0;
let lives = 1;
let gameState = 'PLAYING';

let bird = { x: 100, y: 200, vy: 0, size: 20 };
let pipes = [];
let frames = 0;
let prevSpaceDown = false;
// The episode opens with the bird held still until the first flap. Without this the bird falls
// from frame 0, so anyone still orienting dies inside half a second and the round restarts --
// 23% of collected flappy_bird episodes had no key press at all, every one of them a sub-30-frame
// death. Nothing else in the study can kill you before you have looked at it.
let started = false;

function mulberry32(seed) {
  let t = seed !== undefined ? seed >>> 0 : 42;
  return function() {
    t += 0x6D2B79F5;
    let n = Math.imul(t ^ (t >>> 15), t | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

// Initialize globally to prevent crashes if draw() is invoked before setup()
let rng = mulberry32(42);

const GRAVITY = 0.5;
const FLAP_STRENGTH = -8;
const PIPE_SPEED = 4;
const PIPE_SPAWN_RATE = 70;
const PIPE_WIDTH = 50;

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
    size: 20
  };

  pipes = [];
  frames = 0;
  prevSpaceDown = false;
  started = false;
}

function getGameState() {
  return {
    score: score,
    lives: lives,
    gameState: gameState
  };
}

function draw() {
  let spaceDown = keyIsDown(32); // 32 is SPACE key
  
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
  // Held still until the first flap: no gravity, no pipes, no frame advance. The rising edge
  // that starts the episode IS the first flap, so the input is not swallowed.
  if (!started) {
    if (spaceDown && !prevSpaceDown) {
      started = true;
    } else {
      prevSpaceDown = spaceDown;
      return;
    }
  }

  if (spaceDown && !prevSpaceDown) {
    bird.vy = FLAP_STRENGTH;
  }
  prevSpaceDown = spaceDown;

  bird.vy += GRAVITY;
  bird.y += bird.vy;

  if (frames % PIPE_SPAWN_RATE === 0) {
    let gapSize = 100 + Math.floor(rng() * 40);
    let h = (typeof height !== 'undefined' && height > 0) ? height : 400;
    let w = (typeof width !== 'undefined' && width > 0) ? width : 400;
    let gapY = 50 + Math.floor(rng() * Math.max(10, h - gapSize - 100));
    
    pipes.push({
      x: w,
      top: gapY,
      bottom: gapY + gapSize,
      passed: false
    });
  }

  for (let i = pipes.length - 1; i >= 0; i--) {
    let p = pipes[i];
    p.x -= PIPE_SPEED;

    let birdLeft = bird.x - bird.size / 2;
    let birdRight = bird.x + bird.size / 2;
    let birdTop = bird.y - bird.size / 2;
    let birdBottom = bird.y + bird.size / 2;

    let pipeLeft = p.x;
    let pipeRight = p.x + PIPE_WIDTH;

    if (birdRight > pipeLeft && birdLeft < pipeRight) {
      if (birdTop < p.top || birdBottom > p.bottom) {
        die();
      }
    }

    if (birdLeft > pipeRight && !p.passed) {
      p.passed = true;
      score += 1;
    }

    if (p.x + PIPE_WIDTH < 0) {
      pipes.splice(i, 1);
    }
  }

  let h = (typeof height !== 'undefined' && height > 0) ? height : 400;
  if (bird.y - bird.size / 2 < 0 || bird.y + bird.size / 2 > h) {
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

  fill(0, 200, 0);
  let h = (typeof height !== 'undefined' && height > 0) ? height : 400;
  
  for (let p of pipes) {
    rect(p.x, 0, PIPE_WIDTH, p.top);
    rect(p.x, p.bottom, PIPE_WIDTH, h - p.bottom);
  }

  fill(0, 150, 255);
  rectMode(CENTER);
  rect(bird.x, bird.y, bird.size, bird.size);
  rectMode(CORNER);
}