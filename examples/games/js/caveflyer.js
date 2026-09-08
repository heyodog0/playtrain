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
let playerStart, player, goal, obstacles, targets, enemies, bullets;

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
  bullets = [];
}

function generateLevel() {
  let success = false;
  let attempts = 0;
  let freeCells = [];

  while (!success && attempts < 20) {
    attempts++;
    
    for(let x=0; x<GRID_W; x++){
      grid[x] = [];
      for(let y=0; y<GRID_H; y++){
        grid[x][y] = (rng() < 0.5) ? 1 : 0;
      }
    }
    
    for(let i=0; i<4; i++){
      let newGrid = [];
      for(let x=0; x<GRID_W; x++){
        newGrid[x] = [];
        for(let y=0; y<GRID_H; y++){
          let n = countNeighbors(x, y);
          newGrid[x][y] = (n >= 5) ? 1 : 0;
        }
      }
      grid = newGrid;
    }
    
    for(let x=0; x<GRID_W; x++){
      grid[x][0] = 1; 
      grid[x][GRID_H-1] = 1;
    }
    for(let y=0; y<GRID_H; y++){
      grid[0][y] = 1; 
      grid[GRID_W-1][y] = 1;
    }
    
    let visited = Array(GRID_W).fill().map(()=>Array(GRID_H).fill(false));
    let components = [];
    
    for(let x=0; x<GRID_W; x++){
      for(let y=0; y<GRID_H; y++){
        if(grid[x][y] === 0 && !visited[x][y]){
          let comp = [];
          let q = [[x, y]];
          visited[x][y] = true;
          while(q.length > 0){
            let [cx, cy] = q.shift();
            comp.push([cx, cy]);
            let dirs = [[1,0],[-1,0],[0,1],[0,-1]];
            for(let d of dirs){
              let nx = cx+d[0];
              let ny = cy+d[1];
              if(nx>=0 && nx<GRID_W && ny>=0 && ny<GRID_H && grid[nx][ny]===0 && !visited[nx][ny]){
                visited[nx][ny] = true;
                q.push([nx, ny]);
              }
            }
          }
          components.push(comp);
        }
      }
    }
    
    if (components.length > 0) {
      components.sort((a,b) => b.length - a.length);
      let largest = components[0];
      if (largest.length >= 15) {
        success = true;
        for(let i=1; i<components.length; i++){
          for(let c of components[i]){
            grid[c[0]][c[1]] = 1;
          }
        }
        freeCells = largest;
      }
    }
  }
  
  if (!success) {
    for(let x=0; x<GRID_W; x++){
      grid[x] = [];
      for(let y=0; y<GRID_H; y++){
        grid[x][y] = 1;
      }
    }
    freeCells = [];
    for(let x=5; x<15; x++){
      for(let y=5; y<15; y++){
        grid[x][y] = 0;
        freeCells.push([x, y]);
      }
    }
  }
  
  for(let i = freeCells.length - 1; i > 0; i--){
    let j = Math.floor(rng() * (i + 1));
    [freeCells[i], freeCells[j]] = [freeCells[j], freeCells[i]];
  }

  playerStart = freeCells[0];
  let goalCell = freeCells[1];
  
  player = {
    x: playerStart[0]*CELL + CELL/2,
    y: playerStart[1]*CELL + CELL/2,
    vx: 0,
    vy: 0,
    angle: -Math.PI/2,
    r: 6,
    cooldown: 0,
    thrusting: false,
    backing: false
  };
  
  goal = {
    x: goalCell[0]*CELL + CELL/2,
    y: goalCell[1]*CELL + CELL/2,
    r: 10
  };
  
  obstacles = [];
  targets = [];
  enemies = [];
  
  let chunk = Math.max(1, Math.floor(freeCells.length / 50));
  let idx = 2;
  
  for(let i=0; i<chunk && idx < freeCells.length; i++){
    obstacles.push({x: freeCells[idx][0]*CELL + CELL/2, y: freeCells[idx][1]*CELL + CELL/2, r: 8});
    idx++;
  }
  for(let i=0; i<chunk && idx < freeCells.length; i++){
    targets.push({x: freeCells[idx][0]*CELL + CELL/2, y: freeCells[idx][1]*CELL + CELL/2, r: 8, hp: 3});
    idx++;
  }
  for(let i=0; i<chunk && idx < freeCells.length; i++){
    let vx = (rng()*2 - 1) * 1.5;
    let vy = (rng()*2 - 1) * 1.5;
    enemies.push({x: freeCells[idx][0]*CELL + CELL/2, y: freeCells[idx][1]*CELL + CELL/2, r: 8, vx: vx, vy: vy});
    idx++;
  }
}

function countNeighbors(x, y){
  let count = 0;
  for(let dx=-1; dx<=1; dx++){
    for(let dy=-1; dy<=1; dy++){
      let nx = x+dx;
      let ny = y+dy;
      if(nx<0 || nx>=GRID_W || ny<0 || ny>=GRID_H) count++;
      else if(grid[nx][ny] === 1) count++;
    }
  }
  return count;
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
    player.vx += Math.cos(player.angle) * 0.3;
    player.vy += Math.sin(player.angle) * 0.3;
    player.thrusting = true;
  }
  if (keyIsDown(40)) {
    player.vx -= Math.cos(player.angle) * 0.3;
    player.vy -= Math.sin(player.angle) * 0.3;
    player.backing = true;
  }
  
  player.vx *= 0.95;
  player.vy *= 0.95;
  
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
      vx: player.vx + Math.cos(player.angle)*6,
      vy: player.vy + Math.sin(player.angle)*6,
      r: 3,
      life: 60
    });
    player.cooldown = 15;
  }
  if(player.cooldown > 0) player.cooldown--;
  
  for(let i=bullets.length-1; i>=0; i--){
    let b = bullets[i];
    b.x += b.vx;
    b.y += b.vy;
    b.life--;
    
    let hit = false;
    if (b.life <= 0 || circleCollidesWall(b.x, b.y, b.r)) {
      hit = true;
    } else {
      for(let j=targets.length-1; j>=0; j--){
        let t = targets[j];
        if(distSq(b.x, b.y, t.x, t.y) < (b.r + t.r)**2){
          t.hp--;
          hit = true;
          if(t.hp <= 0){
            targets.splice(j, 1);
            score += 3;
          }
          break;
        }
      }
      if(!hit){
        for(let j=enemies.length-1; j>=0; j--){
          let e = enemies[j];
          if(distSq(b.x, b.y, e.x, e.y) < (b.r + e.r)**2){
            enemies.splice(j, 1);
            score += 1;
            hit = true;
            break;
          }
        }
      }
      if(!hit){
        for(let j=obstacles.length-1; j>=0; j--){
          let o = obstacles[j];
          if(distSq(b.x, b.y, o.x, o.y) < (b.r + o.r)**2){
            hit = true;
            break;
          }
        }
      }
      if(!hit){
        if(distSq(b.x, b.y, goal.x, goal.y) < (b.r + goal.r)**2){
          hit = true;
        }
      }
    }
    if(hit) bullets.splice(i, 1);
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
  
  if(distSq(player.x, player.y, goal.x, goal.y) < (player.r + goal.r)**2){
    score += 10;
    gameState = 'WIN';
    return;
  }
  
  for(let o of obstacles){
    if(distSq(player.x, player.y, o.x, o.y) < (player.r + o.r)**2) playerHit = true;
  }
  for(let t of targets){
    if(distSq(player.x, player.y, t.x, t.y) < (player.r + t.r)**2) playerHit = true;
  }
  for(let e of enemies){
    if(distSq(player.x, player.y, e.x, e.y) < (player.r + e.r)**2) playerHit = true;
  }
  
  if(playerHit){
    lives--;
    score = Math.max(0, score - 2);
    if(lives <= 0){
      gameState = 'GAMEOVER';
    } else {
      player.x = playerStart[0]*CELL + CELL/2;
      player.y = playerStart[1]*CELL + CELL/2;
      player.vx = 0;
      player.vy = 0;
      player.angle = -Math.PI/2;
    }
  }
}

function renderGame() {
  background(20);
  
  fill(100, 70, 40);
  noStroke();
  for(let x=0; x<GRID_W; x++){
    for(let y=0; y<GRID_H; y++){
      if(grid[x][y] === 1){
        rect(x*CELL, y*CELL, CELL, CELL);
      }
    }
  }
  
  fill(0, 255, 0);
  rectMode(CENTER);
  rect(goal.x, goal.y, goal.r*2, goal.r*2);
  rectMode(CORNER);
  
  fill(150);
  for(let o of obstacles){
    ellipse(o.x, o.y, o.r*2, o.r*2);
  }
  
  for(let t of targets){
    fill(255, 0, 0);
    ellipse(t.x, t.y, t.r*2, t.r*2);
    fill(180, 0, 0);
    ellipse(t.x, t.y, t.r, t.r);
  }
  
  fill(255, 0, 255);
  for(let e of enemies){
    push();
    translate(e.x, e.y);
    let heading = Math.atan2(e.vy, e.vx);
    rotate(heading);
    triangle(-e.r, -e.r*0.8, -e.r, e.r*0.8, e.r * 1.5, 0);
    pop();
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
}

function circleCollidesWall(cx, cy, r) {
  let minX = Math.floor((cx - r) / CELL);
  let maxX = Math.floor((cx + r) / CELL);
  let minY = Math.floor((cy - r) / CELL);
  let maxY = Math.floor((cy + r) / CELL);
  
  for(let x=minX; x<=maxX; x++){
    for(let y=minY; y<=maxY; y++){
      if(x<0 || x>=GRID_W || y<0 || y>=GRID_H || grid[x][y]===1){
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