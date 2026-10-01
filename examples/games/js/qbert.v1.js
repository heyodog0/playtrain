let score = 0;
let lives = 0;
let gameState = 'PLAYING';

let grid = [];
let player = {};
let enemies = [];
let gameTick = 0;

let ROWS = 10;
let visitedCubes = 0;
let totalCubes = 0;

let cubeSize = 14;
let xSpacing = 28;
let ySpacing = 21;

let colorUnvisited;
let colorVisited;
let colorPlayer;
let colorEnemy;
let colorTracker;

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
  
  if (player.r < 0 || player.r >= ROWS || player.c < 0 || player.c > player.r || !grid[player.r][player.c].active) {
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
        if (!grid[player.r][player.c].visited) {
          grid[player.r][player.c].visited = true;
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
  let spawnRate = 90;
  if (gameTick % spawnRate === 0) {
    let isTracker = rng() < 0.4;
    enemies.push({ 
      r: 0, c: 0, 
      prevR: -1, prevC: 0, 
      animProgress: 0.0, 
      timer: 45,
      falling: false,
      tracker: isTracker,
      color: isTracker ? colorTracker : colorEnemy
    });
  }

  // Handle Enemy Animation & Movement
  for (let i = enemies.length - 1; i >= 0; i--) {
    let e = enemies[i];
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
        e.animProgress = 0.0;
        e.timer = 45;

        if (e.tracker && !player.falling) {
          let moves = [[1,0], [1,1], [-1,0], [-1,-1]];
          let bestDist = Infinity;
          let bestMoves = [];
          for (let m of moves) {
            let nr = e.r + m[0];
            let nc = e.c + m[1];
            if (nr >= 0 && nr < ROWS && nc >= 0 && nc <= nr && grid[nr][nc].active) {
               let dist = Math.abs(player.r - nr) + Math.abs(player.c - nc);
               if (dist < bestDist) {
                 bestDist = dist;
                 bestMoves = [m];
               } else if (dist === bestDist) {
                 bestMoves.push(m);
               }
            }
          }
          if (bestMoves.length > 0) {
            let chosen = bestMoves[Math.floor(rng() * bestMoves.length)];
            e.r += chosen[0];
            e.c += chosen[1];
          } else {
            e.r += 1;
            e.c += rng() < 0.5 ? 0 : 1;
          }
        } else {
          e.r += 1;
          e.c += rng() < 0.5 ? 0 : 1;
        }

        if (e.r >= ROWS || e.c < 0 || e.c > e.r || !grid[e.r][e.c].active) {
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
  lives--;
  score = Math.max(0, score - 5); 
  
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
    let hop = Math.sin(Math.min(1.0, ent.animProgress) * Math.PI) * 15;
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
      if (!grid[r][c].active) continue;
      let pos = getScreenPos(r, c);
      let col = grid[r][c].visited ? colorVisited : colorUnvisited;
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
      strokeWeight(2);
      fill(item.entity.color[0], item.entity.color[1], item.entity.color[2]);
      let pos = getVisualPos(item.entity);
      ellipse(pos.x, pos.y - 8, 14, 14);
      pop();
    } else if (item.type === 'player') {
      fill(colorPlayer[0], colorPlayer[1], colorPlayer[2]);
      let pPos = getVisualPos(item.entity);
      ellipse(pPos.x, pPos.y - 10, 16, 16);
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

  ROWS = 10;
  cubeSize = 14;
  xSpacing = 28;
  ySpacing = 21;

  let palettes = [
    { u: [52, 152, 219], v: [241, 196, 15] },
    { u: [155, 89, 182], v: [46, 204, 113] },
    { u: [230, 126, 34], v: [52, 152, 219] },
    { u: [44, 62, 80], v: [26, 188, 156] }
  ];
  let pal = palettes[Math.floor(rng() * palettes.length)];
  colorUnvisited = pal.u;
  colorVisited = pal.v;
  colorPlayer = [255, 255, 255]; 
  colorEnemy = [231, 76, 60];    
  colorTracker = [142, 68, 173];

  let attempts = 0;
  while(attempts < 100) {
    grid = [];
    for (let r = 0; r < ROWS; r++) {
      let row = [];
      for (let c = 0; c <= r; c++) {
        let active = (r === 0 && c === 0) ? true : (rng() > 0.2); 
        row.push({ active: active, visited: false });
      }
      grid.push(row);
    }
    
    let visitedNodes = new Set();
    let queue = [{r: 0, c: 0}];
    visitedNodes.add("0,0");
    
    let drList = [1, 1, -1, -1];
    let dcList = [0, 1, 0, -1];
    
    while(queue.length > 0) {
      let curr = queue.shift();
      for (let i = 0; i < 4; i++) {
        let nr = curr.r + drList[i];
        let nc = curr.c + dcList[i];
        if (nr >= 0 && nr < ROWS && nc >= 0 && nc <= nr) {
          if (grid[nr][nc].active && !visitedNodes.has(nr + "," + nc)) {
            visitedNodes.add(nr + "," + nc);
            queue.push({r: nr, c: nc});
          }
        }
      }
    }
    
    if (visitedNodes.size > 30) {
      totalCubes = 0;
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c <= r; c++) {
          if (!visitedNodes.has(r + "," + c)) {
            grid[r][c].active = false;
          } else {
            totalCubes++;
          }
        }
      }
      break;
    }
    attempts++;
  }

  if (attempts >= 100) {
    totalCubes = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c <= r; c++) {
        grid[r][c].active = true;
        totalCubes++;
      }
    }
  }

  player = { r: 0, c: 0, prevR: 0, prevC: 0, animProgress: 1.0, falling: false };
  grid[0][0].visited = true;
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