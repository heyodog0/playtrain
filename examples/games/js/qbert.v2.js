let score = 0;
let lives = 0;
let gameState = 'PLAYING';

let grid = [];
let player = {};
let enemies = [];
let gameTick = 0;

// Map trimmed 40x40 -> 20x20 for training cost (same open-map + camera-pan
// concept; 40x40 drew ~1,600 iso cubes/frame and ran ~10x slower).
let ROWS = 20;
let COLS = 20;
let visitedCubes = 0;
let totalCubes = 0;

let cubeSize = 16;
let xSpacing = 16;
let ySpacing = 8;

let camX = 0;
let camY = 0;
let startPos = { r: 0, c: 0 };

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
  
  if (player.r < 0 || player.r >= ROWS || player.c < 0 || player.c >= COLS || !grid[player.r][player.c].active) {
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
    // Handle Input (Arrow keys mapped to isometric diagonals)
    let dr = 0, dc = 0, moved = false;
    if (keyIsDown(37)) { dr = 0; dc = -1; moved = true; } // LEFT -> Up-Left
    else if (keyIsDown(38)) { dr = -1; dc = 0; moved = true; } // UP -> Up-Right
    else if (keyIsDown(39)) { dr = 0; dc = 1; moved = true; } // RIGHT -> Down-Right
    else if (keyIsDown(40)) { dr = 1; dc = 0; moved = true; } // DOWN -> Down-Left

    if (moved) {
      startMove(dr, dc);
    }
  }

  if (gameState !== 'PLAYING') {
    renderGame();
    return;
  }

  // Camera tracking
  let pIso = getIsoPosInterp(player);
  camX = lerp(camX, pIso.x, 0.1);
  camY = lerp(camY, pIso.y, 0.1);

  // Handle Enemy Spawning
  let spawnRate = 90;
  if (gameTick % spawnRate === 0 && enemies.length < 20) {
    let isTracker = rng() < 0.4;
    let activeCells = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (grid[r][c].active && (Math.abs(r - player.r) + Math.abs(c - player.c)) > 5) {
          activeCells.push({r, c});
        }
      }
    }
    if (activeCells.length > 0) {
      let spawnCell = activeCells[Math.floor(rng() * activeCells.length)];
      enemies.push({ 
        r: spawnCell.r, c: spawnCell.c, 
        prevR: spawnCell.r, prevC: spawnCell.c, 
        animProgress: 1.0, 
        timer: 45,
        falling: false,
        tracker: isTracker,
        color: isTracker ? colorTracker : colorEnemy
      });
    }
  }

  // Handle Enemy Animation & Movement.
  // checkCollisions() inside this loop can call die(), which on respawn
  // reassigns `enemies = []`. Snapshot the ref and bail on reassignment
  // (same guard as the base qbert.js — prevents a worker-killing crash).
  const enemiesRef = enemies;
  for (let i = enemies.length - 1; i >= 0; i--) {
    if (enemies !== enemiesRef) break;
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

        let moves = [[1,0], [-1,0], [0,1], [0,-1]];
        if (e.tracker && !player.falling) {
          let bestDist = Infinity;
          let bestMoves = [];
          for (let m of moves) {
            let nr = e.r + m[0];
            let nc = e.c + m[1];
            if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && grid[nr][nc].active) {
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
            let chosen = moves[Math.floor(rng() * moves.length)];
            e.r += chosen[0];
            e.c += chosen[1];
          }
        } else {
          let validMoves = [];
          for (let m of moves) {
            let nr = e.r + m[0];
            let nc = e.c + m[1];
            if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && grid[nr][nc].active) {
               validMoves.push(m);
            }
          }
          if (validMoves.length > 0) {
            let chosen = validMoves[Math.floor(rng() * validMoves.length)];
            e.r += chosen[0];
            e.c += chosen[1];
          } else {
            let chosen = moves[Math.floor(rng() * moves.length)];
            e.r += chosen[0];
            e.c += chosen[1];
          }
        }

        if (e.r >= ROWS || e.r < 0 || e.c < 0 || e.c >= COLS || !grid[e.r][e.c].active) {
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
    player.r = startPos.r;
    player.c = startPos.c;
    player.prevR = startPos.r;
    player.prevC = startPos.c;
    player.animProgress = 1.0;
    player.falling = false;
    enemies = [];
    
    let pIso = getIsoPosInterp(player);
    camX = pIso.x;
    camY = pIso.y;
  }
}

function getIsoPos(r, c) {
  return {
    x: (c - r) * xSpacing,
    y: (c + r) * ySpacing
  };
}

function getIsoPosInterp(ent) {
  let currR = lerp(ent.prevR, ent.r, Math.min(1.0, ent.animProgress));
  let currC = lerp(ent.prevC, ent.c, Math.min(1.0, ent.animProgress));
  return getIsoPos(currR, currC);
}

function getScreenPos(r, c) {
  let iso = getIsoPos(r, c);
  return {
    x: width / 2 + iso.x - camX,
    y: height / 2 + iso.y - camY
  };
}

function getVisualPos(ent) {
  let iso = getIsoPosInterp(ent);
  let pos = {
    x: width / 2 + iso.x - camX,
    y: height / 2 + iso.y - camY
  };
  
  if (!ent.falling || ent.animProgress <= 1.0) {
    let hop = Math.sin(Math.min(1.0, ent.animProgress) * Math.PI) * 12;
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

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!grid[r][c].active) continue;
      let pos = getScreenPos(r, c);
      if (pos.x < -40 || pos.x > width + 40 || pos.y < -40 || pos.y > height + 40) continue;

      let col = grid[r][c].visited ? colorVisited : colorUnvisited;
      drawList.push({
        type: 'cube',
        depth: r + c,
        r: r,
        c: c,
        pos: pos,
        col: col
      });
    }
  }

  for (let e of enemies) {
    let rVal = e.falling ? e.r : Math.max(e.prevR, e.r);
    let cVal = e.falling ? e.c : Math.max(e.prevC, e.c);
    drawList.push({
      type: 'enemy',
      depth: rVal + cVal + 0.1,
      entity: e
    });
  }

  if (player.animProgress <= 3.0) {
    let rVal = player.falling ? player.r : Math.max(player.prevR, player.r);
    let cVal = player.falling ? player.c : Math.max(player.prevC, player.c);
    drawList.push({
      type: 'player',
      depth: rVal + cVal + 0.1,
      entity: player
    });
  }

  drawList.sort((a, b) => a.depth - b.depth);

  for (let item of drawList) {
    if (item.type === 'cube') {
      let pos = item.pos;
      let col = item.col;
      
      // Top face
      fill(col[0], col[1], col[2]);
      beginShape();
      vertex(pos.x, pos.y - 8);
      vertex(pos.x + cubeSize, pos.y);
      vertex(pos.x, pos.y + 8);
      vertex(pos.x - cubeSize, pos.y);
      endShape(CLOSE);

      // Left face
      fill(col[0] * 0.7, col[1] * 0.7, col[2] * 0.7);
      beginShape();
      vertex(pos.x - cubeSize, pos.y);
      vertex(pos.x, pos.y + 8);
      vertex(pos.x, pos.y + 24);
      vertex(pos.x - cubeSize, pos.y + 16);
      endShape(CLOSE);

      // Right face
      fill(col[0] * 0.5, col[1] * 0.5, col[2] * 0.5);
      beginShape();
      vertex(pos.x + cubeSize, pos.y);
      vertex(pos.x, pos.y + 8);
      vertex(pos.x, pos.y + 24);
      vertex(pos.x + cubeSize, pos.y + 16);
      endShape(CLOSE);
    } else if (item.type === 'enemy') {
      push();
      stroke(0);
      strokeWeight(2);
      fill(item.entity.color[0], item.entity.color[1], item.entity.color[2]);
      let pos = getVisualPos(item.entity);
      ellipse(pos.x, pos.y - 12, 14, 14);
      pop();
    } else if (item.type === 'player') {
      fill(colorPlayer[0], colorPlayer[1], colorPlayer[2]);
      let pPos = getVisualPos(item.entity);
      ellipse(pPos.x, pPos.y - 12, 16, 16);
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

function keepLargestComponent() {
  let visitedNodes = new Set();
  let components = [];
  let drList = [1, -1, 0, 0];
  let dcList = [0, 0, 1, -1];
  
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c].active && !visitedNodes.has(r + "," + c)) {
        let comp = [];
        let queue = [{r, c}];
        visitedNodes.add(r + "," + c);
        
        while(queue.length > 0) {
          let curr = queue.shift();
          comp.push(curr);
          for (let i = 0; i < 4; i++) {
            let nr = curr.r + drList[i];
            let nc = curr.c + dcList[i];
            if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
              if (grid[nr][nc].active && !visitedNodes.has(nr + "," + nc)) {
                visitedNodes.add(nr + "," + nc);
                queue.push({r: nr, c: nc});
              }
            }
          }
        }
        components.push(comp);
      }
    }
  }
  
  if (components.length > 0) {
    components.sort((a, b) => b.length - a.length);
    let largest = components[0];
    
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        grid[r][c].active = false;
      }
    }
    
    for (let cell of largest) {
      grid[cell.r][cell.c].active = true;
    }
    return largest;
  }
  return [];
}

function resetGame(seed) {
  rng = mulberry32(seed);
  score = 0;
  lives = 3;
  gameState = 'PLAYING';

  ROWS = 40;
  COLS = 40;
  cubeSize = 16;
  xSpacing = 16;
  ySpacing = 8;

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
      for (let c = 0; c < COLS; c++) {
        row.push({ active: rng() > 0.45, visited: false });
      }
      grid.push(row);
    }
    
    for (let i = 0; i < 4; i++) {
      let newGrid = [];
      for (let r = 0; r < ROWS; r++) {
        let newRow = [];
        for (let c = 0; c < COLS; c++) {
          let neighbors = 0;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (dr === 0 && dc === 0) continue;
              let nr = r + dr, nc = c + dc;
              if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
                if (grid[nr][nc].active) neighbors++;
              }
            }
          }
          newRow.push({ active: neighbors >= 4, visited: false });
        }
        newGrid.push(newRow);
      }
      grid = newGrid;
    }
    
    let largest = keepLargestComponent();
    
    if (largest.length > 150) {
      for (let i = 0; i < Math.floor(largest.length * 0.2); i++) {
        let cell = largest[Math.floor(rng() * largest.length)];
        grid[cell.r][cell.c].active = false;
      }
      
      largest = keepLargestComponent();
      
      if (largest.length > 100) {
        totalCubes = largest.length;
        
        let center = { r: Math.floor(ROWS/2), c: Math.floor(COLS/2) };
        let bestDist = Infinity;
        for (let cell of largest) {
          let d = Math.abs(cell.r - center.r) + Math.abs(cell.c - center.c);
          if (d < bestDist) {
            bestDist = d;
            player.r = cell.r;
            player.c = cell.c;
          }
        }
        break;
      }
    }
    attempts++;
  }

  if (attempts >= 100) {
    totalCubes = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        grid[r][c].active = (r > 10 && r < 30 && c > 10 && c < 30);
        if (grid[r][c].active) totalCubes++;
      }
    }
    player.r = 20;
    player.c = 20;
  }

  player.prevR = player.r;
  player.prevC = player.c;
  player.animProgress = 1.0;
  player.falling = false;
  
  startPos = { r: player.r, c: player.c };
  let pIso = getIsoPos(player.r, player.c);
  camX = pIso.x;
  camY = pIso.y;
  
  grid[player.r][player.c].visited = true;
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