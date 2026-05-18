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

let score, lives, gameState;
let player;
let enemies = [];
let bullets = [];
let oxygen;

const MAX_OXYGEN = 600;
const SURFACE_Y = 60;
const BOTTOM_Y = 380;

function setup() {
  createCanvas(400, 400);
}

function resetGame(seed) {
  rng = mulberry32(seed);
  score = 0;
  lives = 3;
  gameState = 'PLAYING';
  
  resetPlayer();
  enemies = [];
  bullets = [];
  
  for (let i = 0; i < 5; i++) {
    spawnEnemy();
  }
}

function resetPlayer() {
  player = {
    x: 200,
    y: SURFACE_Y,
    w: 24,
    h: 16,
    speed: 4,
    facing: 1,
    cooldown: 0
  };
  oxygen = MAX_OXYGEN;
}

function getGameState() {
  return { score, lives, gameState };
}

function draw() {
  if (gameState === 'PLAYING') {
    updateGame();
  }
  drawGame();
}

function updateGame() {
  if (keyIsDown(37)) { // LEFT
    player.x -= player.speed;
    player.facing = -1;
  }
  if (keyIsDown(39)) { // RIGHT
    player.x += player.speed;
    player.facing = 1;
  }
  if (keyIsDown(38)) { // UP
    player.y -= player.speed;
  }
  if (keyIsDown(40)) { // DOWN
    player.y += player.speed;
  }
  
  player.x = constrain(player.x, 0, width - player.w);
  player.y = constrain(player.y, 20, BOTTOM_Y - player.h);
  
  if (player.cooldown > 0) player.cooldown--;
  
  if (keyIsDown(32) && player.cooldown === 0) { // SPACE / D
    bullets.push({
      x: player.facing === 1 ? player.x + player.w : player.x - 8,
      y: player.y + player.h / 2 - 2,
      w: 8,
      h: 4,
      vx: player.facing * 8
    });
    player.cooldown = 15;
  }
  
  for (let i = bullets.length - 1; i >= 0; i--) {
    let b = bullets[i];
    b.x += b.vx;
    if (b.x < -20 || b.x > width + 20) {
      bullets.splice(i, 1);
      continue;
    }
    
    let hit = false;
    for (let j = enemies.length - 1; j >= 0; j--) {
      let e = enemies[j];
      if (checkAABB(b, e)) {
        score += 10;
        bullets.splice(i, 1);
        enemies.splice(j, 1);
        hit = true;
        break;
      }
    }
    if (hit) continue;
  }
  
  for (let i = enemies.length - 1; i >= 0; i--) {
    let e = enemies[i];
    e.x += e.vx;
    
    if (checkAABB(e, player)) {
      loseLife();
      return; 
    }
    
    if (e.x < -50 || e.x > width + 50) {
      enemies.splice(i, 1);
    }
  }
  
  if (player.y <= SURFACE_Y + player.h / 2) {
    oxygen = Math.min(MAX_OXYGEN, oxygen + 15);
  } else {
    oxygen -= 1;
  }
  
  if (oxygen <= 0) {
    loseLife();
    return;
  }
  
  if (rng() < 0.04) {
    spawnEnemy();
  }
}

function spawnEnemy() {
  let isLeft = rng() > 0.5;
  let speed = 1.5 + rng() * 2.5;
  let yPos = SURFACE_Y + 10 + rng() * (BOTTOM_Y - SURFACE_Y - 30);
  
  enemies.push({
    x: isLeft ? -30 : width + 10,
    y: yPos,
    w: 20,
    h: 12,
    vx: isLeft ? speed : -speed
  });
}

function loseLife() {
  lives--;
  if (lives <= 0) {
    gameState = 'GAMEOVER';
  } else {
    resetPlayer();
    enemies = [];
    bullets = [];
  }
}

function checkAABB(a, b) {
  return a.x < b.x + b.w &&
         a.x + a.w > b.x &&
         a.y < b.y + b.h &&
         a.y + a.h > b.y;
}

function drawGame() {
  background(0, 10, 40);
  
  fill(0, 100, 200);
  rect(0, 0, width, SURFACE_Y);
  
  fill(255, 255, 0);
  for (let b of bullets) {
    rect(b.x, b.y, b.w, b.h);
  }
  
  for (let e of enemies) {
    fill(255, 0, 50);
    rect(e.x, e.y, e.w, e.h);
    fill(0);
    if (e.vx > 0) {
      rect(e.x + e.w - 6, e.y + 2, 4, 4);
    } else {
      rect(e.x + 2, e.y + 2, 4, 4);
    }
  }
  
  if (gameState !== 'GAMEOVER') {
    fill(0, 255, 255);
    rect(player.x, player.y, player.w, player.h);
    
    fill(255);
    if (player.facing === 1) {
      rect(player.x + player.w - 6, player.y, 6, player.h);
    } else {
      rect(player.x, player.y, 6, player.h);
    }
  }
  
  fill(40, 40, 40);
  rect(0, BOTTOM_Y, width, 20);
  
  if (oxygen > MAX_OXYGEN * 0.3) {
    fill(0, 200, 0);
  } else {
    fill(255, 0, 0);
  }
  let oxWidth = (Math.max(0, oxygen) / MAX_OXYGEN) * width;
  rect(0, BOTTOM_Y, oxWidth, 20);
}