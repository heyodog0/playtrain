let rng = null;
let score = 0;
let lives = 0;
let cpuLives = 0;
let gameState = 'PLAYING';

let player = { x: 0, y: 0, w: 10, h: 40, speed: 5.0 };
let cpu = { x: 0, y: 0, w: 10, h: 40, speed: 3.5 };
let ball = { x: 0, y: 0, size: 8, vx: 0, vy: 0, speed: 4.0 };

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
  createCanvas(256, 256);
}

function getGameState() {
  return {
    score: score,
    lives: lives,
    gameState: gameState
  };
}

function resetBall() {
  ball.x = 128;
  ball.y = 128;
  ball.speed = 4.0;
  let angle = (rng() * Math.PI / 2) - Math.PI / 4;
  let dir = rng() > 0.5 ? 1 : -1;
  ball.vx = dir * ball.speed * Math.cos(angle);
  ball.vy = ball.speed * Math.sin(angle);
}

function resetGame(seed) {
  rng = mulberry32(seed);
  score = 0;
  lives = 5;
  cpuLives = 5;
  gameState = 'PLAYING';

  player.x = 256 - 20;
  player.y = 128 - 20;
  player.w = 10;
  player.h = 40;
  player.speed = 5.0;

  cpu.x = 10;
  cpu.y = 128 - 20;
  cpu.w = 10;
  cpu.h = 40;
  cpu.speed = 3.0 + rng() * 1.5; 

  ball.size = 8;
  resetBall();
}

function draw() {
  if (gameState === 'PLAYING') {
    if (keyIsDown(38)) {
      player.y -= player.speed;
    }
    if (keyIsDown(40)) {
      player.y += player.speed;
    }
    player.y = Math.max(0, Math.min(256 - player.h, player.y));

    let cpuCenter = cpu.y + cpu.h / 2;
    if (Math.abs(cpuCenter - ball.y) > cpu.speed) {
      if (cpuCenter < ball.y) {
        cpu.y += cpu.speed;
      } else {
        cpu.y -= cpu.speed;
      }
    }
    cpu.y = Math.max(0, Math.min(256 - cpu.h, cpu.y));

    ball.x += ball.vx;
    ball.y += ball.vy;

    if (ball.y < ball.size / 2) {
      ball.y = ball.size / 2;
      ball.vy *= -1;
    } else if (ball.y > 256 - ball.size / 2) {
      ball.y = 256 - ball.size / 2;
      ball.vy *= -1;
    }

    if (ball.vx < 0 &&
        ball.x - ball.size/2 <= cpu.x + cpu.w &&
        ball.x + ball.size/2 >= cpu.x &&
        ball.y + ball.size/2 >= cpu.y &&
        ball.y - ball.size/2 <= cpu.y + cpu.h) {

      ball.x = cpu.x + cpu.w + ball.size/2;
      ball.vx *= -1;
      let intersectY = (ball.y - (cpu.y + cpu.h/2)) / (cpu.h/2);
      ball.vy += intersectY * 2.5;
      let currentSpeed = Math.sqrt(ball.vx*ball.vx + ball.vy*ball.vy);
      ball.speed = Math.min(ball.speed + 0.5, 9.0);
      ball.vx = (ball.vx / currentSpeed) * ball.speed;
      ball.vy = (ball.vy / currentSpeed) * ball.speed;
    }

    if (ball.vx > 0 &&
        ball.x + ball.size/2 >= player.x &&
        ball.x - ball.size/2 <= player.x + player.w &&
        ball.y + ball.size/2 >= player.y &&
        ball.y - ball.size/2 <= player.y + player.h) {

      ball.x = player.x - ball.size/2;
      ball.vx *= -1;
      let intersectY = (ball.y - (player.y + player.h/2)) / (player.h/2);
      ball.vy += intersectY * 2.5;
      let currentSpeed = Math.sqrt(ball.vx*ball.vx + ball.vy*ball.vy);
      ball.speed = Math.min(ball.speed + 0.5, 9.0);
      ball.vx = (ball.vx / currentSpeed) * ball.speed;
      ball.vy = (ball.vy / currentSpeed) * ball.speed;
      score += 1;
    }

    if (ball.x < 0) {
      score += 10;
      cpuLives--;
      if (cpuLives <= 0) {
        gameState = 'WIN';
      } else {
        resetBall();
      }
    } else if (ball.x > 256) {
      score -= 10;
      lives--;
      if (lives <= 0) {
        gameState = 'GAMEOVER';
      } else {
        resetBall();
      }
    }
  }

  background(0);

  fill(100);
  noStroke();
  for (let i = 0; i < 256; i += 16) {
    rect(128 - 1, i, 2, 8);
  }

  fill(0, 100, 255);
  rect(player.x, player.y, player.w, player.h);

  fill(255, 50, 50);
  rect(cpu.x, cpu.y, cpu.w, cpu.h);

  fill(255, 255, 0);
  rect(ball.x - ball.size/2, ball.y - ball.size/2, ball.size, ball.size);

  fill(255, 50, 50);
  for (let i = 0; i < cpuLives; i++) {
    rect(10 + i * 12, 10, 8, 8);
  }
  fill(0, 100, 255);
  for (let i = 0; i < lives; i++) {
    rect(256 - 18 - i * 12, 10, 8, 8);
  }
}