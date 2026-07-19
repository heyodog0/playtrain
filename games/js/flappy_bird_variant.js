// Visual reskin of flappy_bird.js — IDENTICAL gameplay (same physics, pipes,
// flap, scoring, collisions). Only render() and the color/shape styling differ.
// Atari-simple shapes throughout; a "candy dusk" palette instead of the
// black / green-pipe / blue-square look.

let score = 0;
let lives = 1;
let gameState = 'PLAYING';

let bird = { x: 100, y: 200, vy: 0, size: 20 };
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

// Initialize globally to prevent crashes if draw() is invoked before setup()
let rng = mulberry32(42);

// Decorative-only RNG (background stars). Kept SEPARATE from `rng` so pipe
// generation stays byte-for-byte identical to the original game.
let decoRng = mulberry32(43);
let stars = [];

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

  // decorative starfield — deterministic, but on its own RNG stream so it
  // never perturbs the pipe sequence
  decoRng = mulberry32(s + 1);
  let w = (typeof width !== 'undefined' && width > 0) ? width : 400;
  let h = (typeof height !== 'undefined' && height > 0) ? height : 400;
  stars = [];
  for (let i = 0; i < 45; i++) {
    stars.push({
      x: decoRng() * w,
      y: decoRng() * h,
      s: decoRng() < 0.25 ? 2 : 1
    });
  }
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
  let h = (typeof height !== 'undefined' && height > 0) ? height : 400;

  // --- dusk-purple sky instead of pure black ---
  background(28, 22, 58);

  // decorative stars
  fill(220, 220, 255);
  for (let st of stars) {
    rect(st.x, st.y, st.s, st.s);
  }

  // --- pipes: candy-magenta bodies with bright pink caps ---
  for (let p of pipes) {
    // bodies (same rects/positions as the original — collision is unchanged)
    fill(210, 50, 130);
    rect(p.x, 0, PIPE_WIDTH, p.top);
    rect(p.x, p.bottom, PIPE_WIDTH, h - p.bottom);

    // caps at the gap edges (cosmetic, slightly wider)
    fill(250, 120, 180);
    let capH = 12;
    rect(p.x - 4, p.top - capH, PIPE_WIDTH + 8, capH);
    rect(p.x - 4, p.bottom, PIPE_WIDTH + 8, capH);
  }

  // --- bird: golden circle with a beak and eye, instead of a blue square ---
  // (hitbox is still the same bird.size box used by updateGame)
  fill(255, 210, 40);
  ellipse(bird.x, bird.y, bird.size, bird.size);

  // beak
  fill(255, 130, 0);
  triangle(
    bird.x + bird.size / 2 - 2, bird.y - 3,
    bird.x + bird.size / 2 + 5, bird.y,
    bird.x + bird.size / 2 - 2, bird.y + 3
  );

  // eye
  fill(20, 20, 30);
  rect(bird.x + 2, bird.y - bird.size / 4, 3, 3);
}
