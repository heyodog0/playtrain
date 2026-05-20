// ALE-aligned scoring: first side to 21 points wins. `lives` and `cpuLives`
// count down points-remaining (start at 21, hit 0 to lose). Reward fires only
// on completed-point events (matches ALE pong's ±1 per scored point semantics;
// magnitude is irrelevant under reward_clip=sign). No per-paddle-hit shaping.
let score = 0;
let lives = 21;
let gameState = 'PLAYING';
let cpuLives = 21;

let player = { x: 0, y: 0, w: 16, h: 60, speed: 8 };
let cpu = { x: 0, y: 0, w: 16, h: 60, speed: 5 };
let ball = { x: 0, y: 0, size: 14, vx: 0, vy: 0, active: false };

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

function setup() {
  createCanvas(400, 400);
}

function resetGame(seed) {
  rng = mulberry32(seed);
  score = 0;
  lives = 21;
  cpuLives = 21;
  gameState = 'PLAYING';

  player.x = width - 20;
  player.y = height / 2;
  cpu.x = 20;
  cpu.y = height / 2;
  
  cpu.speed = 4 + rng() * 3.5;

  resetBall();
}

function resetBall() {
  ball.x = width / 2;
  ball.y = height / 2;
  ball.active = false;
  ball.vx = 0;
  ball.vy = 0;
}

function serveBall() {
  ball.active = true;
  ball.vx = 7;
  let angle = (rng() - 0.5) * Math.PI / 2.5;
  ball.vy = 7 * Math.sin(angle);
}

function getGameState() {
  return {
    score: score,
    lives: lives,
    gameState: gameState
  };
}

function draw() {
  background(20);

  if (gameState === 'PLAYING') {
    if (keyIsDown(38)) {
      player.y -= player.speed;
    }
    if (keyIsDown(40)) {
      player.y += player.speed;
    }
    if (!ball.active && keyIsDown(32)) {
      serveBall();
    }

    player.y = constrain(player.y, player.h / 2, height - player.h / 2);

    if (ball.active) {
      if (cpu.y < ball.y - 6) cpu.y += cpu.speed;
      else if (cpu.y > ball.y + 6) cpu.y -= cpu.speed;
    } else {
      if (cpu.y < height / 2 - 6) cpu.y += cpu.speed;
      else if (cpu.y > height / 2 + 6) cpu.y -= cpu.speed;
    }
    cpu.y = constrain(cpu.y, cpu.h / 2, height - cpu.h / 2);

    if (ball.active) {
      ball.x += ball.vx;
      ball.y += ball.vy;

      if (ball.y - ball.size / 2 <= 0) {
        ball.y = ball.size / 2;
        ball.vy *= -1;
      } else if (ball.y + ball.size / 2 >= height) {
        ball.y = height - ball.size / 2;
        ball.vy *= -1;
      }

      if (ball.vx > 0 &&
          ball.x + ball.size / 2 >= player.x - player.w / 2 &&
          ball.x - ball.size / 2 <= player.x + player.w / 2 &&
          ball.y + ball.size / 2 >= player.y - player.h / 2 &&
          ball.y - ball.size / 2 <= player.y + player.h / 2) {
        
        ball.x = player.x - player.w / 2 - ball.size / 2;
        ball.vx *= -1.1;
        if (ball.vx < -16) ball.vx = -16;
        let hitFactor = (ball.y - player.y) / (player.h / 2);
        ball.vy = hitFactor * 9;
      }

      if (ball.vx < 0 &&
          ball.x - ball.size / 2 <= cpu.x + cpu.w / 2 &&
          ball.x + ball.size / 2 >= cpu.x - cpu.w / 2 &&
          ball.y + ball.size / 2 >= cpu.y - cpu.h / 2 &&
          ball.y - ball.size / 2 <= cpu.y + cpu.h / 2) {
        
        ball.x = cpu.x + cpu.w / 2 + ball.size / 2;
        ball.vx *= -1.1;
        if (ball.vx > 16) ball.vx = 16;
        let hitFactor = (ball.y - cpu.y) / (cpu.h / 2);
        ball.vy = hitFactor * 9;
      }

      if (ball.x < 0) {
        score += 5;
        cpuLives -= 1;
        if (cpuLives <= 0) gameState = 'WIN';
        else resetBall();
      } else if (ball.x > width) {
        score -= 2;
        lives -= 1;
        if (lives <= 0) gameState = 'GAMEOVER';
        else resetBall();
      }
    }
  }

  rectMode(CENTER);
  noStroke();

  fill(0, 150, 255);
  rect(player.x, player.y, player.w, player.h);

  fill(255, 50, 0);
  rect(cpu.x, cpu.y, cpu.w, cpu.h);

  fill(255, 255, 0);
  rect(ball.x, ball.y, ball.size, ball.size);

  // Score bars: width proportional to points scored (out of 21). Bars rather
  // than discrete pips because 21 pips would clutter the 400-px canvas.
  rectMode(CORNER);
  fill(0, 150, 255);
  rect(width / 2 + 15, 15, (21 - cpuLives) * 5, 10);

  fill(255, 50, 0);
  rect(width / 2 - 15 - (21 - lives) * 5, 15, (21 - lives) * 5, 10);
}