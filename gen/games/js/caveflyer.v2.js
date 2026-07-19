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
let lives = 3;
let gameState = 'PLAYING';

const GRID_W = 20;
const GRID_H = 20;
const CELL = 20;

let grid = [];
let playerStart, player, goal, enemies, bullets;
let goalX = 0, goalY = 0;
let goalRevealed = false;

function setup() {
  createCanvas(400, 400);
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
  lives = 3;
  gameState = 'PLAYING';
  
  generateLevel();
}

function generateLevel() {
  for (let x = 0; x < GRID_W; x++) {
    grid[x] = [];
    for (let y = 0; y < GRID_H; y++) {
      if (x === 0 || x === GRID_W - 1 || y === 0 || y === GRID_H - 1) {
        grid[x][y] = 2; 
      } else {
        grid[x][y] = (rng() < 0.1) ? 3 : 1; 
      }
    }
  }

  playerStart = [2, 2];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      grid[playerStart[0] + dx][playerStart[1] + dy] = 0;
    }
  }

  let validGoalLocations = [];
  for (let x = 1; x < GRID_W - 1; x++) {
    for (let y = 1; y < GRID_H - 1; y++) {
      if (grid[x][y] === 1 || grid[x][y] === 3) {
        let dx = x - playerStart[0];
        let dy = y - playerStart[1];
        if (dx * dx + dy * dy > 25) {
          validGoalLocations.push([x, y]);
        }
      }
    }
  }
  
  if (validGoalLocations.length > 0) {
    let g = validGoalLocations[Math.floor(rng() * validGoalLocations.length)];
    goalX = g[0];
    goalY = g[1];
  } else {
    for(let x=1; x<GRID_W-1; x++){
      for(let y=1; y<GRID_H-1; y++){
        if ((grid[x][y] === 1 || grid[x][y] === 3) && (x!==playerStart[0] || y!==playerStart[1])) {
          goalX = x; goalY = y; break;
        }
      }
    }
  }
  
  goalRevealed = false;
  goal = {
    x: goalX * CELL + CELL / 2,
    y: goalY * CELL + CELL / 2,
    r: 8
  };
  
  player = {
    x: playerStart[0] * CELL + CELL / 2,
    y: playerStart[1] * CELL + CELL / 2,
    vx: 0,
    vy: 0,
    angle: 0,
    r: 6,
    cooldown: 0,
    thrusting: false,
    backing: false
  };
  
  enemies = [];
  bullets = [];
}

function draw() {
  if (gameState !== 'PLAYING') return;
  updateGame();
  renderGame();
}

function updateGame() {
  player.thrusting = false;
  player.backing = false;

  if (keyIsDown(37)) player.angle -= 0.1;
  if (keyIsDown(39)) player.angle += 0.1;
  
  if (keyIsDown(38)) {
    player.vx += Math.cos(player.angle) * 0.6;
    player.vy += Math.sin(player.angle) * 0.6;
    player.thrusting = true;
  }
  if (keyIsDown(40)) {
    player.vx -= Math.cos(player.angle) * 0.6;
    player.vy -= Math.sin(player.angle) * 0.6;
    player.backing = true;
  }
  
  player.vx *= 0.75;
  player.vy *= 0.75;
  
  let steps = 4;
  let dx = player.vx / steps;
  let dy = player.vy / steps;
  for(let i=0; i<steps; i++){
    if(!circleCollidesWall(player.x + dx, player.y, player.r)) {
      player.x += dx;
    } else {
      player.vx = 0;
    }
    if(!circleCollidesWall(player.x, player.y + dy, player.r)) {
      player.y += dy;
    } else {
      player.vy = 0;
    }
  }
  
  if (keyIsDown(32) && player.cooldown <= 0) {
    bullets.push({
      x: player.x + Math.cos(player.angle)*(player.r+2),
      y: player.y + Math.sin(player.angle)*(player.r+2),
      vx: Math.cos(player.angle)*8,
      vy: Math.sin(player.angle)*8,
      r: 4,
      life: 30
    });
    player.cooldown = 10;
  }
  if(player.cooldown > 0) player.cooldown--;
  
  for(let i=bullets.length-1; i>=0; i--){
    let b = bullets[i];
    b.x += b.vx;
    b.y += b.vy;
    b.life--;
    
    let hit = false;
    if (b.life <= 0) {
      hit = true;
    } else {
      let minX = Math.floor((b.x - b.r) / CELL);
      let maxX = Math.floor((b.x + b.r) / CELL);
      let minY = Math.floor((b.y - b.r) / CELL);
      let maxY = Math.floor((b.y + b.r) / CELL);
      
      for(let x=minX; x<=maxX; x++){
        for(let y=minY; y<=maxY; y++){
          if(x>=0 && x<GRID_W && y>=0 && y<GRID_H){
            if (grid[x][y] === 1 || grid[x][y] === 2 || grid[x][y] === 3) {
              let closestX = clamp(b.x, x*CELL, x*CELL+CELL);
              let closestY = clamp(b.y, y*CELL, y*CELL+CELL);
              let bdx = b.x - closestX;
              let bdy = b.y - closestY;
              if(bdx*bdx + bdy*bdy <= b.r*b.r){
                hit = true;
                if (grid[x][y] === 1 || grid[x][y] === 3) {
                  let pts = (grid[x][y] === 3) ? 25 : 5;
                  grid[x][y] = 0;
                  score += pts;
                  if (x === goalX && y === goalY) {
                    goalRevealed = true;
                  }
                  if (rng() < 0.08) {
                    enemies.push({
                      x: x*CELL + CELL/2,
                      y: y*CELL + CELL/2,
                      r: 6,
                      vx: (rng() - 0.5) * 3,
                      vy: (rng() - 0.5) * 3
                    });
                  }
                }
                break;
              }
            }
          }
        }
        if (hit) break;
      }
      
      if (!hit) {
        for (let j = enemies.length - 1; j >= 0; j--) {
          let e = enemies[j];
          if (distSq(b.x, b.y, e.x, e.y) < (b.r + e.r) ** 2) {
            enemies.splice(j, 1);
            score += 20;
            hit = true;
            break;
          }
        }
      }
    }
    
    if (hit) bullets.splice(i, 1);
  }
  
  for(let e of enemies){
    let nextX = e.x + e.vx;
    let nextY = e.y + e.vy;
    if(circleCollidesWall(nextX, e.y, e.r)) e.vx *= -1;
    else e.x = nextX;
    
    if(circleCollidesWall(e.x, nextY, e.r)) e.vy *= -1;
    else e.y = nextY;
  }
  
  let playerHit = false;
  
  if(goalRevealed && distSq(player.x, player.y, goal.x, goal.y) < (player.r + goal.r)**2){
    score += 100;
    gameState = 'WIN';
    return;
  }
  
  for(let e of enemies){
    if(distSq(player.x, player.y, e.x, e.y) < (player.r + e.r)**2) playerHit = true;
  }
  
  if(playerHit){
    lives--;
    score = Math.max(0, score - 20);
    if(lives <= 0){
      gameState = 'GAMEOVER';
    } else {
      player.x = playerStart[0]*CELL + CELL/2;
      player.y = playerStart[1]*CELL + CELL/2;
      player.vx = 0;
      player.vy = 0;
      player.angle = 0;
      enemies = enemies.filter(e => distSq(e.x, e.y, player.x, player.y) > 10000);
    }
  }
}

function renderGame() {
  background(20);
  
  noStroke();
  for(let x=0; x<GRID_W; x++){
    for(let y=0; y<GRID_H; y++){
      if(grid[x][y] === 1){
        fill(120, 80, 40);
        rect(x*CELL, y*CELL, CELL, CELL);
        fill(100, 60, 30);
        rect(x*CELL + 2, y*CELL + 2, CELL - 4, CELL - 4);
      } else if (grid[x][y] === 3) {
        fill(150, 110, 20);
        rect(x*CELL, y*CELL, CELL, CELL);
        fill(180, 140, 30);
        rect(x*CELL + 2, y*CELL + 2, CELL - 4, CELL - 4);
      } else if (grid[x][y] === 2) {
        fill(60);
        rect(x*CELL, y*CELL, CELL, CELL);
      }
    }
  }
  
  if (goalRevealed) {
    fill(0, 255, 255);
    rectMode(CENTER);
    rect(goal.x, goal.y, goal.r*2, goal.r*2);
    fill(255);
    ellipse(goal.x, goal.y, goal.r, goal.r);
    rectMode(CORNER);
  }
  
  for(let e of enemies){
    fill(200, 50, 50);
    ellipse(e.x, e.y, e.r*2, e.r*2);
    fill(255);
    ellipse(e.x - 2, e.y - 2, 2, 2);
    ellipse(e.x + 2, e.y - 2, 2, 2);
  }
  
  fill(255, 255, 0);
  for(let b of bullets){
    ellipse(b.x, b.y, b.r*2, b.r*2);
  }
  
  push();
  translate(player.x, player.y);
  rotate(player.angle);
  
  if (player.thrusting) {
    fill(255, 120, 0);
    triangle(-player.r - 2, -player.r*0.5, -player.r - 2, player.r*0.5, -player.r - 10, 0);
  }
  if (player.backing) {
    fill(255, 120, 0);
    ellipse(player.r + 4, 0, 6, 6);
  }
  
  fill(0, 150, 255);
  triangle(-player.r, -player.r*0.9, -player.r, player.r*0.9, player.r * 1.5, 0);
  pop();

  fill(255);
  textSize(16);
  textAlign(LEFT, TOP);
  text("Score: " + score, 10, 10);
  text("Lives: " + lives, 10, 30);
}

function circleCollidesWall(cx, cy, r) {
  let minX = Math.floor((cx - r) / CELL);
  let maxX = Math.floor((cx + r) / CELL);
  let minY = Math.floor((cy - r) / CELL);
  let maxY = Math.floor((cy + r) / CELL);
  
  for(let x=minX; x<=maxX; x++){
    for(let y=minY; y<=maxY; y++){
      if(x<0 || x>=GRID_W || y<0 || y>=GRID_H || grid[x][y] === 1 || grid[x][y] === 2 || grid[x][y] === 3){
        let closestX = clamp(cx, x*CELL, x*CELL+CELL);
        let closestY = clamp(cy, y*CELL, y*CELL+CELL);
        let dx = cx - closestX;
        let dy = cy - closestY;
        if(dx*dx + dy*dy < r*r) return true;
      }
    }
  }
  return false;
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function distSq(x1, y1, x2, y2){
  return (x1-x2)*(x1-x2) + (y1-y2)*(y1-y2);
}