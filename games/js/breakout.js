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

let score = 0;
let lives = 0;
let gameState = 'PLAYING';

let paddle = null;
let ball = null;
let bricks = [];

function setup() {
  createCanvas(400, 400);
}

function resetGame(seed) {
  rng = mulberry32(seed);
  score = 0;
  lives = 3;
  gameState = 'PLAYING';

  paddle = {
    w: 80,
    h: 12,
    x: 160,
    y: 370,
    speed: 8
  };

  resetBall();

  bricks = [];
  let rows = 4 + Math.floor(rng() * 4);
  let cols = 8;
  let bw = 400 / cols;
  let bh = 20;

  for (let r = 0; r < rows; r++) {
    let rColor = [
      50 + Math.floor(rng() * 205),
      50 + Math.floor(rng() * 205),
      50 + Math.floor(rng() * 205)
    ];
    for (let c = 0; c < cols; c++) {
      if (rng() > 0.1) {
        bricks.push({
          x: c * bw + 2,
          y: r * bh + 30,
          w: bw - 4,
          h: bh - 4,
          active: true,
          color: rColor
        });
      }
    }
  }
}

function resetBall() {
  ball = {
    r: 6,
    x: paddle.x + paddle.w / 2,
    y: paddle.y - 6,
    vx: 0,
    vy: 0,
    active: false,
    timer: 30
  };
}

function getGameState() {
  return {
    score: score,
    lives: lives,
    gameState: gameState
  };
}

function draw() {
  background(0);

  if (gameState !== 'PLAYING') {
    drawEntities();
    return;
  }

  if (keyIsDown(37)) {
    paddle.x -= paddle.speed;
  }
  if (keyIsDown(39)) {
    paddle.x += paddle.speed;
  }

  paddle.x = Math.max(0, Math.min(width - paddle.w, paddle.x));

  if (!ball.active) {
    ball.x = paddle.x + paddle.w / 2;
    ball.y = paddle.y - ball.r;
    ball.timer--;
    
    if (keyIsDown(32) || ball.timer <= 0) {
      ball.active = true;
      let angle = (rng() - 0.5) * (Math.PI / 2.5);
      let speed = 6;
      ball.vx = speed * Math.sin(angle);
      ball.vy = -speed * Math.cos(angle);
    }
  } else {
    ball.x += ball.vx;
    ball.y += ball.vy;

    if (ball.x - ball.r < 0) {
      ball.x = ball.r;
      ball.vx *= -1;
    } else if (ball.x + ball.r > width) {
      ball.x = width - ball.r;
      ball.vx *= -1;
    }

    if (ball.y - ball.r < 0) {
      ball.y = ball.r;
      ball.vy *= -1;
    }

    if (ball.y + ball.r > height) {
      lives--;
      if (lives <= 0) {
        gameState = 'GAMEOVER';
      } else {
        resetBall();
      }
    }

    if (ball.vy > 0 && ball.y + ball.r >= paddle.y && ball.y - ball.r <= paddle.y + paddle.h) {
      if (ball.x >= paddle.x && ball.x <= paddle.x + paddle.w) {
        ball.y = paddle.y - ball.r;
        let hitPoint = (ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2);
        hitPoint = Math.max(-1, Math.min(1, hitPoint));
        let angle = hitPoint * (Math.PI / 3);
        let speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
        ball.vx = speed * Math.sin(angle);
        ball.vy = -speed * Math.cos(angle);
      }
    }

    for (let i = 0; i < bricks.length; i++) {
      let b = bricks[i];
      if (!b.active) continue;

      let testX = ball.x;
      let testY = ball.y;

      if (ball.x < b.x) testX = b.x;
      else if (ball.x > b.x + b.w) testX = b.x + b.w;

      if (ball.y < b.y) testY = b.y;
      else if (ball.y > b.y + b.h) testY = b.y + b.h;

      let distX = ball.x - testX;
      let distY = ball.y - testY;
      let distance = Math.sqrt((distX * distX) + (distY * distY));

      if (distance <= ball.r) {
        b.active = false;
        score += 10;

        if (Math.abs(distX) > Math.abs(distY)) {
          ball.vx *= -1;
          if (distX > 0) ball.x = b.x + b.w + ball.r;
          else ball.x = b.x - ball.r;
        } else {
          ball.vy *= -1;
          if (distY > 0) ball.y = b.y + b.h + ball.r;
          else ball.y = b.y - ball.r;
        }
        break;
      }
    }

    if (Math.abs(ball.vy) < 1.5) {
      ball.vy = ball.vy < 0 ? -1.5 : 1.5;
    }
  }

  let allCleared = true;
  for (let i = 0; i < bricks.length; i++) {
    if (bricks[i].active) {
      allCleared = false;
      break;
    }
  }
  if (allCleared && gameState === 'PLAYING') {
    gameState = 'WIN';
  }

  drawEntities();
}

function drawEntities() {
  noStroke();

  for (let i = 0; i < bricks.length; i++) {
    let b = bricks[i];
    if (b.active) {
      fill(b.color[0], b.color[1], b.color[2]);
      rect(b.x, b.y, b.w, b.h);
    }
  }

  fill(0, 150, 255);
  rect(paddle.x, paddle.y, paddle.w, paddle.h);

  fill(255);
  ellipse(ball.x, ball.y, ball.r * 2, ball.r * 2);

  fill(0, 255, 0);
  for (let i = 0; i < lives; i++) {
    rect(10 + i * 20, 5, 15, 10);
  }
}