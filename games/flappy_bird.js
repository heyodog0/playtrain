let score = 0;
let lives = 1;
let gameState = 'PLAYING';
let rng = null;

let bird;
let pipes;
let frames;
let prevSpaceDown = false;

const GRAVITY = 0.5;
const FLAP_STRENGTH = -8;
const PIPE_SPEED = 4;
const PIPE_SPAWN_RATE = 70;
const PIPE_WIDTH = 50;

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
    size: 20
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
  if (gameState === 'PLAYING') {
    updateGame();
  }
  render();
}

function updateGame() {
  let spaceDown = keyIsDown(32); // 32 is SPACE key (Action D)
  if (spaceDown && !prevSpaceDown) {
    bird.vy = FLAP_STRENGTH;
  }
  prevSpaceDown = spaceDown;

  bird.vy += GRAVITY;
  bird.y += bird.vy;

  if (frames % PIPE_SPAWN_RATE === 0) {
    let gapSize = 100 + Math.floor(rng() * 40);
    let gapY = 50 + Math.floor(rng() * (height - gapSize - 100));
    pipes.push({
      x: width,
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

  if (bird.y - bird.size / 2 < 0 || bird.y + bird.size / 2 > height) {
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
  for (let p of pipes) {
    rect(p.x, 0, PIPE_WIDTH, p.top);
    rect(p.x, p.bottom, PIPE_WIDTH, height - p.bottom);
  }

  fill(0, 150, 255);
  rectMode(CENTER);
  rect(bird.x, bird.y, bird.size, bird.size);
  rectMode(CORNER);
}

let t;
function mulberry32(seed) {
  t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let n = Math.imul(t ^ (t >>> 15), t | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}