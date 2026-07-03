// ============================================================
// REQUIRED: p5.js lifecycle
// ============================================================

function setup() {
  createCanvas(400, 400);
  noStroke();
}

function draw() {
  if (gameState === 'PLAYING') {
    updatePhysics();
    updatePlayer();
  }
  render();
}

// ============================================================
// REQUIRED: RL interface
// ============================================================

let score = 0;
let lives = 3;
let gameState = 'PLAYING';

function getGameState() {
  return {
    score: score,
    lives: lives,
    gameState: gameState
  };
}

let player;
let riverRows;
let temple;
let moveCooldown;
let decorations = [];

function resetGame(seed) {
  rng = mulberry32(seed);
  score = 0;
  lives = 3;
  gameState = 'PLAYING';
  moveCooldown = 0;

  player = {
    x: 200,
    row: 5,
    oldRow: 5,
    jumpFrames: 0,
    size: 24
  };

  riverRows = [];
  let dirs = [-1, 1, -1, 1]; // Alternating river directions
  
  for (let r = 1; r <= 4; r++) {
    let speed = (1.5 + rng() * 1.5) * dirs[r - 1];
    let numLogs = 4;
    let spacing = 400 / numLogs;
    let rowOffset = rng() * 400;
    let logs = [];

    for (let i = 0; i < numLogs; i++) {
      logs.push({
        x: (i * spacing + rowOffset) % 400,
        w: 50 + rng() * 30, // Random log width between 50 and 80
        visited: false
      });
    }

    riverRows.push({
      row: r,
      y: r * 60,
      speed: speed,
      logs: logs
    });
  }

  temple = {
    x: 170,
    w: 60,
    blocks: 0,
    target: 12, // Needs 12 unique log visits to open
    open: false
  };

  // Generate deterministic jungle decorations
  decorations = [];
  
  // Hanging vines at the top
  for (let i = 0; i < 12; i++) {
    decorations.push({
      type: 'vine',
      x: rng() * 400,
      y: 10 + rng() * 30, // length
      scale: 0.5 + rng() * 1.0
    });
  }

  // Top bank trees & bushes
  for (let i = 0; i < 10; i++) {
    decorations.push({
      type: rng() > 0.5 ? 'tree' : 'bush',
      x: rng() * 400,
      y: 10 + rng() * 35,
      scale: 0.7 + rng() * 0.6
    });
  }

  // Bottom bank trees & bushes
  for (let i = 0; i < 18; i++) {
    decorations.push({
      type: rng() > 0.4 ? 'tree' : 'bush',
      x: rng() * 400,
      y: 310 + rng() * 80,
      scale: 0.7 + rng() * 0.7
    });
  }
}

// ============================================================
// REQUIRED: seeded RNG
// ============================================================

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

// ============================================================
// GAME LOGIC
// ============================================================

function updatePhysics() {
  // Move all river logs and wrap them around the screen
  for (let r of riverRows) {
    for (let l of r.logs) {
      l.x = (l.x + r.speed + 400) % 400;
    }
  }
}

function updatePlayer() {
  if (moveCooldown > 0) moveCooldown--;
  if (player.jumpFrames > 0) player.jumpFrames--;

  // Horizontal Movement (Continuous)
  if (keyIsDown(37)) player.x -= 3; // LEFT
  if (keyIsDown(39)) player.x += 3; // RIGHT

  // Apply river drift if player is on a river row
  if (player.row >= 1 && player.row <= 4) {
    player.x += riverRows[player.row - 1].speed;
  }

  // Constrain to screen bounds
  player.x = constrain(player.x, player.size / 2, 400 - player.size / 2);

  // Collision Logic (evaluated before jumping to ensure correct state checking)
  if (player.row >= 1 && player.row <= 4) {
    if (player.jumpFrames === 0) {
      let r = riverRows[player.row - 1];
      let onLog = false;
      
      for (let l of r.logs) {
        let checkCollision = (lx) => player.x >= lx && player.x <= lx + l.w;
        
        // Check collision with main log body or wrapped tail
        if (checkCollision(l.x) || (l.x + l.w > 400 && checkCollision(l.x - 400))) {
          onLog = true;
          if (!l.visited) {
            l.visited = true;
            score += 10;
            temple.blocks++;
            if (temple.blocks >= temple.target) {
              temple.open = true;
            }
          }
        }
      }

      // Fall in water
      if (!onLog) {
        lives--;
        if (lives <= 0) {
          gameState = 'GAMEOVER';
        } else {
          // Respawn at bottom
          player.row = 5;
          player.oldRow = 5;
          player.x = 200;
          moveCooldown = 30; // Brief stun
          player.jumpFrames = 0;
        }
      }
    }
  } else if (player.row === 0) {
    // Check if entered open temple
    if (player.jumpFrames === 0 && temple.open && player.x >= temple.x && player.x <= temple.x + temple.w) {
      score += 100;
      gameState = 'WIN';
    }
  }

  // Vertical Row Jumping (Discrete)
  if (moveCooldown === 0) {
    if (keyIsDown(38)) { // UP
      if (player.row > 0) {
        player.oldRow = player.row;
        player.row--;
        moveCooldown = 15;
        player.jumpFrames = 15;
      }
    } else if (keyIsDown(40)) { // DOWN
      if (player.row < 5) {
        player.oldRow = player.row;
        player.row++;
        moveCooldown = 15;
        player.jumpFrames = 15;
      }
    }
  }
}

function render() {
  // Murky jungle river background
  background(25, 60, 40);

  // Safe zones (Top and Bottom) - Grassy Banks
  // Top bank
  fill(30, 120, 40);
  rect(0, 0, 400, 60);
  // Top bank dirt edge
  fill(80, 50, 20);
  rect(0, 60, 400, 8);

  // Bottom bank
  fill(30, 120, 40);
  rect(0, 300, 400, 100);
  // Bottom bank dirt inner edge
  fill(80, 50, 20);
  rect(0, 300, 400, 4);

  // Draw Jungle Decorations (Trees, Bushes, Vines)
  for (let d of decorations) {
    if (d.type === 'vine') {
      fill(20, 60, 20);
      rect(d.x, 0, 4 * d.scale, d.y + 4);
      fill(40, 100, 30);
      rect(d.x, 0, 4 * d.scale, d.y);
    } else if (d.type === 'tree') {
      // Trunk shadow/bottom
      fill(50, 30, 10);
      rect(d.x - 4 * d.scale, d.y, 8 * d.scale, 24 * d.scale);
      // Trunk top
      fill(70, 40, 20);
      rect(d.x - 4 * d.scale, d.y - 2 * d.scale, 8 * d.scale, 24 * d.scale);

      // Leaves (Layered blocky foliage)
      fill(20, 70, 30);
      rect(d.x - 15 * d.scale, d.y - 20 * d.scale, 30 * d.scale, 30 * d.scale, 4);
      fill(30, 90, 40);
      rect(d.x - 12 * d.scale, d.y - 25 * d.scale, 24 * d.scale, 24 * d.scale, 4);
      fill(40, 110, 50);
      rect(d.x - 6 * d.scale, d.y - 28 * d.scale, 12 * d.scale, 12 * d.scale, 2);
    } else if (d.type === 'bush') {
      // Bush shadow/bottom
      fill(20, 60, 20);
      rect(d.x - 12 * d.scale, d.y, 24 * d.scale, 16 * d.scale, 4);
      // Bush top highlights
      fill(40, 100, 30);
      rect(d.x - 10 * d.scale, d.y - 4 * d.scale, 20 * d.scale, 16 * d.scale, 4);
      fill(50, 120, 40);
      rect(d.x - 6 * d.scale, d.y - 8 * d.scale, 12 * d.scale, 12 * d.scale, 4);
    }
  }

  // Draw River Logs
  for (let r of riverRows) {
    for (let l of r.logs) {
      // Logs are mossy green unvisited, and brown when visited
      let thicknessColor = l.visited ? color(100, 60, 20) : color(60, 90, 40);
      let topColor = l.visited ? color(140, 90, 40) : color(80, 120, 50);
      let highlightColor = l.visited ? color(160, 110, 50) : color(100, 140, 60);

      // Thickness (bottom face)
      fill(thicknessColor);
      rect(l.x, r.y + 16, l.w - 2, 40, 4);
      if (l.x + l.w > 400) {
        rect(l.x - 400, r.y + 16, l.w - 2, 40, 4);
      }

      // Top face
      fill(topColor);
      rect(l.x, r.y + 10, l.w - 2, 40, 4);
      if (l.x + l.w > 400) {
        rect(l.x - 400, r.y + 10, l.w - 2, 40, 4);
      }

      // Highlight inner (bark texture representation)
      fill(highlightColor);
      rect(l.x + 4, r.y + 14, l.w - 10, 32, 2);
      if (l.x + l.w > 400) {
        rect(l.x - 400 + 4, r.y + 14, l.w - 10, 32, 2);
      }
    }
  }

  // Draw Jungle Temple
  let templeThickColor = temple.open ? color(200, 180, 40) : color(100, 100, 110);
  let templeTopColor   = temple.open ? color(255, 220, 50) : color(130, 130, 140);

  // Temple Background frame (unbuilt ruins outline)
  fill(80, 80, 90);
  rect(temple.x, 16, temple.w, 40);
  fill(90, 90, 100);
  rect(temple.x, 10, temple.w, 40);
  // Doorway silhouette
  fill(40, 40, 50);
  rect(temple.x + temple.w / 2 - 10, 30, 20, 26);

  // Build Temple Block by Block (Stepped Pyramid)
  let bw = temple.w / 5;
  let bh = 8;
  for(let i = 0; i < temple.target; i++) {
    let built = i < temple.blocks;
    if (!built) continue; 
    
    let r_idx, c_idx;
    if (i < 5) { r_idx = 0; c_idx = i; }
    else if (i < 9) { r_idx = 1; c_idx = i - 5 + 0.5; }
    else if (i < 12) { r_idx = 2; c_idx = i - 9 + 1.0; }
    
    let bx = temple.x + c_idx * bw;
    let by = 50 - r_idx * bh;
    
    // thickness
    fill(templeThickColor);
    rect(bx, by - bh + 4, bw - 1, bh);
    // top
    fill(templeTopColor);
    rect(bx, by - bh, bw - 1, bh);
  }
  
  // Open doorway glowing overlay
  if (temple.open) {
      fill(255, 240, 150); // Glowing interior
      rect(temple.x + temple.w / 2 - 12, 34, 24, 22);
  }

  // HUD: Artifacts collected indicators (Top-left grid)
  for (let i = 0; i < temple.target; i++) {
    // Drop shadow
    fill(100, 80, 20);
    rect(10 + (i % 6) * 14, 13 + Math.floor(i / 6) * 14, 10, 10);

    // Idol face
    fill(i < temple.blocks ? color(255, 215, 0) : color(120, 120, 120));
    rect(10 + (i % 6) * 14, 10 + Math.floor(i / 6) * 14, 10, 10);
  }

  // Draw Player (Explorer Avatar)
  if (gameState !== 'GAMEOVER') {
    let drawY = player.row * 60 + 30;
    let shadowY = drawY + player.size / 2;
    let drawSize = player.size;
    
    if (player.jumpFrames > 0) {
      let t = player.jumpFrames / 15.0; // 1 to 0
      let oldY = player.oldRow * 60 + 30;
      let currentY = player.row * 60 + 30;
      
      // Linear interpolation between old row and current row
      let baseY = oldY * t + currentY * (1 - t);
      drawY = baseY;
      shadowY = baseY + player.size / 2;
      
      // Arc and scale effects
      let arc = Math.sin(t * Math.PI);
      drawY -= arc * 20; // Up to 20 pixels high
      drawSize = player.size * (1 + arc * 0.3); // Up to 30% larger at apex
    }
    
    let d = drawSize;
    let px = player.x - d / 2;
    let py = drawY - d / 2;

    // Draw Drop Shadow
    fill(0, 0, 0, 80);
    noStroke();
    ellipse(player.x, shadowY, d * 1.2, d * 0.5);

    // Legs (Brown pants)
    fill(70, 50, 30);
    rect(px + d * 0.2, py + d * 0.8 + 6, d * 0.2, d * 0.2);
    rect(px + d * 0.6, py + d * 0.8 + 6, d * 0.2, d * 0.2);
    fill(90, 60, 40);
    rect(px + d * 0.2, py + d * 0.8, d * 0.2, d * 0.2);
    rect(px + d * 0.6, py + d * 0.8, d * 0.2, d * 0.2);

    // Body Thickness
    fill(130, 120, 70);
    rect(px, py + d * 0.4 + 6, d, d * 0.5);
    // Body Top (Khaki shirt)
    fill(180, 170, 110);
    rect(px, py + d * 0.4, d, d * 0.5);

    // Belt
    fill(60, 40, 20);
    rect(px - d * 0.05, py + d * 0.75 + 6, d * 1.1, d * 0.15);
    fill(80, 50, 30);
    rect(px - d * 0.05, py + d * 0.75, d * 1.1, d * 0.15);

    // Face
    fill(255, 200, 150);
    rect(px + d * 0.15, py + d * 0.2, d * 0.7, d * 0.3);

    // Eyes
    fill(0);
    rect(px + d * 0.3, py + d * 0.25, d * 0.1, d * 0.1);
    rect(px + d * 0.6, py + d * 0.25, d * 0.1, d * 0.1);

    // Head / Hat base (Fedora)
    fill(90, 60, 30);
    rect(px + d * 0.1, py + 6, d * 0.8, d * 0.2);
    // Hat brim/top
    fill(120, 80, 40);
    rect(px - d * 0.1, py, d * 1.2, d * 0.2); // Brim
    rect(px + d * 0.15, py - d * 0.15, d * 0.7, d * 0.35); // Crown
  }
}