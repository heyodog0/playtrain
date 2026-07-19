let score = 0;
let lives = 0;
let gameState = 'PLAYING';

let grid = [];
let player = {};
let enemies = [];
let gameTick = 0;

let ROWS = 7;
let visitedCubes = 0;
let totalCubes = 0;

let cubeSize = 18;
let xSpacing = 36;
let ySpacing = 27;

let colorUnvisited;
let colorVisited;
let colorPlayer;
let colorEnemy;

function setup() {
  createCanvas(400, 400);
  noStroke();
}

function startMove(dr, dc) {
  player.prevR = player.r;
  player.prevC = player.c;
  player.r = player.prevR + dr;
  player.c = player.prevC + dc;
  player.animProgress = 0.0;
  
  if (player.r < 0 || player.r >= ROWS || player.c < 0 || player.c > player.r) {
    player.falling = true;
  } else {
    player.falling = false;
  }
}

function draw() {
  if (gameState !== 'PLAYING') {
    renderGame();
    return;
  }

  gameTick++;

  // Handle Player Animation & Movement
  if (player.animProgress < 1.0 || player.falling) {
    if (player.falling && player.animProgress >= 1.0) {
      player.animProgress += 0.05;
      if (player.animProgress > 3.0) {
        die();
      }
    } else {
      player.animProgress += 0.1;
      if (player.animProgress >= 0.99 && !player.falling) {
        player.animProgress = 1.0;
        if (!grid[player.r][player.c]) {
          grid[player.r][player.c] = true;
          visitedCubes++;
          score += 10;
        }
        checkCollisions();
        
        if (gameState === 'PLAYING' && visitedCubes === totalCubes) {
          score += 50;
          gameState = 'WIN';
        }
      }
    }
  } else {
    // Handle Input
    let dr = 0, dc = 0, moved = false;
    if (keyIsDown(38)) { dr = -1; dc = 0; moved = true; } // UP -> Up-Right
    else if (keyIsDown(39)) { dr = 1; dc = 1; moved = true; } // RIGHT -> Down-Right
    else if (keyIsDown(40)) { dr = 1; dc = 0; moved = true; } // DOWN -> Down-Left
    else if (keyIsDown(37)) { dr = -1; dc = -1; moved = true; } // LEFT -> Up-Left

    if (moved) {
      startMove(dr, dc);
    }
  }

  if (gameState !== 'PLAYING') {
    renderGame();
    return;
  }

  // Handle Enemy Spawning
  let spawnRate = 120; // Slower spawn rate
  if (gameTick % spawnRate === 0) {
    let spawnC = rng() < 0.5 ? 0 : 1;
    enemies.push({ 
      r: 1, c: spawnC, 
      prevR: 0, prevC: 0, 
      animProgress: 0.0, 
      timer: 45,
      falling: false 
    });
  }

  // Handle Enemy Animation & Movement.
  // checkCollisions() inside this loop can call die(), which on respawn
  // reassigns `enemies = []`. Snapshot the array ref so we can detect
  // that reassignment and bail instead of indexing the new empty array
  // (which would surface as "Cannot read properties of undefined
  // (reading 'animProgress')" and kill the worker).
  const enemiesRef = enemies;
  for (let i = enemies.length - 1; i >= 0; i--) {
    if (enemies !== enemiesRef) break;
    let e = enemies[i];
    if (!e) continue;
    if (e.animProgress < 1.0 || e.falling) {
      if (e.falling && e.animProgress >= 1.0) {
        e.animProgress += 0.05;
        if (e.animProgress > 3.0) {
          enemies.splice(i, 1);
          continue;
        }
      } else {
        e.animProgress += 0.1;
        if (e.animProgress >= 0.99 && !e.falling) {
          e.animProgress = 1.0;
          checkCollisions();
        }
      }
    } else {
      e.timer--;
      if (e.timer <= 0) {
        e.prevR = e.r;
        e.prevC = e.c;
        e.r += 1;
        e.c += rng() < 0.5 ? 0 : 1;
        e.animProgress = 0.0;
        e.timer = 45;

        if (e.r >= ROWS) {
          e.falling = true;
        }
      }
    }
  }

  checkCollisions();
  renderGame();
}

function checkCollisions() {
  if (player.falling) return;
  
  let pCurrR = lerp(player.prevR, player.r, Math.min(1.0, player.animProgress));
  let pCurrC = lerp(player.prevC, player.c, Math.min(1.0, player.animProgress));
  
  for (let e of enemies) {
    if (e.falling && e.animProgress > 1.0) continue;
    
    let eCurrR = lerp(e.prevR, e.r, Math.min(1.0, e.animProgress));
    let eCurrC = lerp(e.prevC, e.c, Math.min(1.0, e.animProgress));
    
    let dR = pCurrR - eCurrR;
    let dC = pCurrC - eCurrC;
    let distSq = dR * dR + dC * dC;
    
    if (distSq < 0.25) {
      die();
      return;
    }
  }
}

function die() {
  // ALE-aligned: no death penalty. Reward fires only on positive scoring events
  // (cube visits, full clear). Death just consumes a life.
  lives--;

  if (lives <= 0) {
    gameState = 'GAMEOVER';
  } else {
    player.r = 0;
    player.c = 0;
    player.prevR = 0;
    player.prevC = 0;
    player.animProgress = 1.0;
    player.falling = false;
    enemies = [];
  }
}

function getScreenPos(r, c) {
  let centerX = 200;
  let totalHeight = (ROWS - 1) * ySpacing;
  let startY = 200 - totalHeight / 2 + 20; 
  
  let x = centerX + (c - r / 2) * xSpacing;
  let y = startY + r * ySpacing;
  return { x, y };
}

function getVisualPos(ent) {
  let r = lerp(ent.prevR, ent.r, Math.min(1.0, ent.animProgress));
  let c = lerp(ent.prevC, ent.c, Math.min(1.0, ent.animProgress));
  let pos = getScreenPos(r, c);
  
  if (!ent.falling || ent.animProgress <= 1.0) {
    let hop = Math.sin(Math.min(1.0, ent.animProgress) * Math.PI) * 20;
    pos.y -= hop;
  } else {
    let fallT = ent.animProgress - 1.0;
    pos.y += fallT * fallT * 150; 
  }
  return pos;
}

function renderGame() {
  background(20); 

  let drawList = [];

  // Add cubes
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c <= r; c++) {
      let pos = getScreenPos(r, c);
      let col = grid[r][c] ? colorVisited : colorUnvisited;
      drawList.push({
        type: 'cube',
        depth: r,
        r: r,
        c: c,
        pos: pos,
        col: col
      });
    }
  }

  // Add enemies
  for (let e of enemies) {
    let rVal = e.falling ? e.r : Math.max(e.prevR, e.r);
    drawList.push({
      type: 'enemy',
      depth: rVal + 0.1,
      entity: e
    });
  }

  // Add player
  if (player.animProgress <= 3.0) {
    let rVal = player.falling ? player.r : Math.max(player.prevR, player.r);
    drawList.push({
      type: 'player',
      depth: rVal + 0.1,
      entity: player
    });
  }

  // Sort drawList
  drawList.sort((a, b) => a.depth - b.depth);

  // Draw everything in depth order
  for (let item of drawList) {
    if (item.type === 'cube') {
      let pos = item.pos;
      let col = item.col;
      
      // Top face
      fill(col[0], col[1], col[2]);
      beginShape();
      vertex(pos.x, pos.y - cubeSize / 2);
      vertex(pos.x + cubeSize, pos.y);
      vertex(pos.x, pos.y + cubeSize / 2);
      vertex(pos.x - cubeSize, pos.y);
      endShape(CLOSE);

      // Left face
      fill(col[0] * 0.7, col[1] * 0.7, col[2] * 0.7);
      beginShape();
      vertex(pos.x - cubeSize, pos.y);
      vertex(pos.x, pos.y + cubeSize / 2);
      vertex(pos.x, pos.y + cubeSize * 1.5);
      vertex(pos.x - cubeSize, pos.y + cubeSize);
      endShape(CLOSE);

      // Right face
      fill(col[0] * 0.5, col[1] * 0.5, col[2] * 0.5);
      beginShape();
      vertex(pos.x + cubeSize, pos.y);
      vertex(pos.x, pos.y + cubeSize / 2);
      vertex(pos.x, pos.y + cubeSize * 1.5);
      vertex(pos.x + cubeSize, pos.y + cubeSize);
      endShape(CLOSE);
    } else if (item.type === 'enemy') {
      push();
      stroke(0);
      strokeWeight(3);
      fill(colorEnemy[0], colorEnemy[1], colorEnemy[2]);
      let pos = getVisualPos(item.entity);
      ellipse(pos.x, pos.y - 10, 16, 16);
      pop();
    } else if (item.type === 'player') {
      fill(colorPlayer[0], colorPlayer[1], colorPlayer[2]);
      let pPos = getVisualPos(item.entity);
      ellipse(pPos.x, pPos.y - 12, 18, 18);
    }
  }

  // HUD: Lives
  fill(colorPlayer[0], colorPlayer[1], colorPlayer[2]);
  for (let i = 0; i < lives; i++) {
    rect(10 + i * 15, 10, 10, 10);
  }

  // HUD: Target Color
  push();
  fill(colorVisited[0], colorVisited[1], colorVisited[2]);
  rect(width - 34, 10, 24, 24);
  pop();

  // HUD: Progress Bar
  fill(colorVisited[0], colorVisited[1], colorVisited[2]);
  rect(0, 390, width * (visitedCubes / totalCubes), 10);
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

  ROWS = 7;
  cubeSize = 18;
  xSpacing = 36;
  ySpacing = 27;

  let palettes = [
    { u: [52, 152, 219], v: [241, 196, 15] },
    { u: [155, 89, 182], v: [46, 204, 113] },
    { u: [230, 126, 34], v: [52, 152, 219] },
  ];
  let pal = palettes[Math.floor(rng() * palettes.length)];
  colorUnvisited = pal.u;
  colorVisited = pal.v;
  colorPlayer = [255, 255, 255]; 
  colorEnemy = [231, 76, 60];    

  grid = [];
  totalCubes = 0;
  for (let r = 0; r < ROWS; r++) {
    let row = [];
    for (let c = 0; c <= r; c++) {
      row.push(false);
      totalCubes++;
    }
    grid.push(row);
  }

  player = { r: 0, c: 0, prevR: 0, prevC: 0, animProgress: 1.0, falling: false };
  grid[0][0] = true;
  visitedCubes = 1;

  enemies = [];
  gameTick = 0;
}

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