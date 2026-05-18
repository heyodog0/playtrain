let rng = null;
let score = 0;
let lives = 0;
let gameState = 'PLAYING';

let player = {};
let cpu = {};
let ball = {};

const PADDLE_W = 16;
const BALL_SIZE = 12;

function setup() {
    createCanvas(400, 400);
    noStroke();
}

function getGameState() {
    return {
        score: score,
        lives: lives,
        gameState: gameState
    };
}

function resetGame(seed) {
    rng = mulberry32(seed);
    score = 0;
    lives = 5;
    gameState = 'PLAYING';

    let cpuSpeed = 3.0 + rng() * 3.0;
    let cpuHeight = 48 + rng() * 32;

    player = { 
        x: 30, 
        y: 200, 
        w: PADDLE_W, 
        h: 64, 
        speed: 5, 
        dashSpeed: 9 
    };
    
    cpu = { 
        x: 370, 
        y: 200, 
        w: PADDLE_W, 
        h: cpuHeight, 
        speed: cpuSpeed 
    };

    resetBall();
}

function resetBall() {
    ball = {
        x: 200,
        y: 100 + rng() * 200,
        vx: -3.5 - rng() * 1.5,
        vy: (rng() > 0.5 ? 1 : -1) * (2 + rng() * 2.5),
        w: BALL_SIZE,
        h: BALL_SIZE
    };
}

function draw() {
    background(20);

    if (gameState === 'PLAYING') {
        updateGame();
    }

    drawGame();
}

function updateGame() {
    let currentSpeed = keyIsDown(32) ? player.dashSpeed : player.speed;
    
    if (keyIsDown(38)) {
        player.y -= currentSpeed;
    }
    if (keyIsDown(40)) {
        player.y += currentSpeed;
    }
    
    player.y = Math.max(player.h / 2, Math.min(400 - player.h / 2, player.y));

    if (ball.y < cpu.y - 12) {
        cpu.y -= cpu.speed;
    } else if (ball.y > cpu.y + 12) {
        cpu.y += cpu.speed;
    }
    
    cpu.y = Math.max(cpu.h / 2, Math.min(400 - cpu.h / 2, cpu.y));

    ball.x += ball.vx;
    ball.y += ball.vy;

    if (ball.y - ball.h / 2 < 0) {
        ball.y = ball.h / 2;
        ball.vy *= -1;
    } else if (ball.y + ball.h / 2 > 400) {
        ball.y = 400 - ball.h / 2;
        ball.vy *= -1;
    }

    if (ball.vx < 0 && checkCollision(ball, player)) {
        ball.vx *= -1.1; 
        ball.x = player.x + player.w / 2 + ball.w / 2;
        let hitOffset = (ball.y - player.y) / (player.h / 2);
        ball.vy += hitOffset * 3;
        score += 2; 
    } else if (ball.vx > 0 && checkCollision(ball, cpu)) {
        ball.vx *= -1.1; 
        ball.x = cpu.x - cpu.w / 2 - ball.w / 2;
        let hitOffset = (ball.y - cpu.y) / (cpu.h / 2);
        ball.vy += hitOffset * 3;
    }

    ball.vx = Math.max(-12, Math.min(12, ball.vx));
    ball.vy = Math.max(-10, Math.min(10, ball.vy));

    if (ball.x < 0) {
        lives -= 1;
        score -= 2;
        if (lives <= 0) {
            gameState = 'GAMEOVER';
        } else {
            resetBall();
        }
    } else if (ball.x > 400) {
        score += 10;
        if (score >= 50) {
            gameState = 'WIN';
        } else {
            resetBall();
        }
    }
}

function checkCollision(b, p) {
    let bLeft = b.x - b.w / 2;
    let bRight = b.x + b.w / 2;
    let bTop = b.y - b.h / 2;
    let bBottom = b.y + b.h / 2;

    let pLeft = p.x - p.w / 2;
    let pRight = p.x + p.w / 2;
    let pTop = p.y - p.h / 2;
    let pBottom = p.y + p.h / 2;

    return !(bRight < pLeft || bLeft > pRight || bBottom < pTop || bTop > pBottom);
}

function drawGame() {
    rectMode(CENTER);

    fill(60);
    rect(200, 200, 4, 400);

    fill(50, 150, 255);
    rect(player.x, player.y, player.w, player.h);

    fill(255, 50, 50);
    rect(cpu.x, cpu.y, cpu.w, cpu.h);

    fill(255, 255, 50);
    rect(ball.x, ball.y, ball.w, ball.h);
}

function mulberry32(seed) {
    let t = seed >>> 0;
    return () => {
        t += 0x6D2B79F5;
        let n = Math.imul(t ^ (t >>> 15), t | 1);
        n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
        return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
    };
}