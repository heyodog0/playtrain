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
let igloo;
let moveCooldown;

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
    let numFloes = 4;
    let spacing = 400 / numFloes;
    let rowOffset = rng() * 400;
    let floes = [];

    for (let i = 0; i < numFloes; i++) {
      floes.push({
        x: (i * spacing + rowOffset) % 400,
        w: 50 + rng() * 30, // Random floe width between 50 and 80
        visited: false
      });
    }

    riverRows.push({
      row: r,
      y: r * 60,
      speed: speed,
      floes: floes
    });
  }

  igloo = {
    x: 170,
    w: 60,
    blocks: 0,
    target: 12, // Needs 12 unique floe visits to open
    open: false
  };
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
  // Move all ice floes and wrap them around the screen
  for (let r of riverRows) {
    for (let f of r.floes) {
      f.x = (f.x + r.speed + 400) % 400;
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
      let onFloe = false;
      
      for (let f of r.floes) {
        let checkCollision = (fx) => player.x >= fx && player.x <= fx + f.w;
        
        // Check collision with main floe body or wrapped tail
        if (checkCollision(f.x) || (f.x + f.w > 400 && checkCollision(f.x - 400))) {
          onFloe = true;
          if (!f.visited) {
            f.visited = true;
            score += 10;
            igloo.blocks++;
            if (igloo.blocks >= igloo.target) {
              igloo.open = true;
            }
          }
        }
      }

      // Fall in water
      if (!onFloe) {
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
    // Check if entered open igloo
    if (player.jumpFrames === 0 && igloo.open && player.x >= igloo.x && player.x <= igloo.x + igloo.w) {
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
  // Dark blue water background
  background(15, 25, 45);

  // Safe zones (Top and Bottom) - Snowy Banks
  // Top bank
  fill(230, 240, 250);
  rect(0, 0, 400, 60);
  // Top bank edge (gives depth)
  fill(180, 200, 220);
  rect(0, 60, 400, 8);

  // Bottom bank
  fill(230, 240, 250);
  rect(0, 300, 400, 100);
  // Bottom bank inner edge
  fill(200, 220, 240);
  rect(0, 300, 400, 4);

  // Draw River Floes (Ice Blocks)
  for (let r of riverRows) {
    for (let f of r.floes) {
      let thicknessColor = f.visited ? color(0, 120, 200) : color(180, 200, 210);
      let topColor = f.visited ? color(0, 180, 255) : color(240, 250, 255);
      let highlightColor = f.visited ? color(100, 220, 255) : color(255, 255, 255);

      // Thickness (bottom face)
      fill(thicknessColor);
      rect(f.x, r.y + 16, f.w - 2, 40, 4);
      if (f.x + f.w > 400) {
        rect(f.x - 400, r.y + 16, f.w - 2, 40, 4);
      }

      // Top face
      fill(topColor);
      rect(f.x, r.y + 10, f.w - 2, 40, 4);
      if (f.x + f.w > 400) {
        rect(f.x - 400, r.y + 10, f.w - 2, 40, 4);
      }

      // Highlight inner
      fill(highlightColor);
      rect(f.x + 4, r.y + 14, f.w - 10, 32, 2);
      if (f.x + f.w > 400) {
        rect(f.x - 400 + 4, r.y + 14, f.w - 10, 32, 2);
      }
    }
  }

  // Draw Igloo
  let iglooThickColor = igloo.open ? color(0, 180, 0) : color(160, 200, 230);
  let iglooTopColor   = igloo.open ? color(0, 255, 0) : color(220, 240, 255);

  // Igloo Background frame (unbuilt outline)
  fill(200, 210, 220);
  rect(igloo.x, 16, igloo.w, 40);
  fill(210, 220, 230);
  rect(igloo.x, 10, igloo.w, 40);
  // Doorway silhouette
  fill(180, 190, 200);
  rect(igloo.x + igloo.w / 2 - 10, 30, 20, 26);

  // Build Igloo Block by Block
  let bw = igloo.w / 5;
  let bh = 8;
  for(let i = 0; i < igloo.target; i++) {
    let built = i < igloo.blocks;
    if (!built) continue; 
    
    let r_idx, c_idx;
    if (i < 5) { r_idx = 0; c_idx = i; }
    else if (i < 9) { r_idx = 1; c_idx = i - 5 + 0.5; }
    else if (i < 12) { r_idx = 2; c_idx = i - 9 + 1.0; }
    else if (i < 14) { r_idx = 3; c_idx = i - 12 + 1.5; }
    else { r_idx = 4; c_idx = 2.0; }
    
    let bx = igloo.x + c_idx * bw;
    let by = 50 - r_idx * bh;
    
    // thickness
    fill(iglooThickColor);
    rect(bx, by - bh + 4, bw - 1, bh);
    // top
    fill(iglooTopColor);
    rect(bx, by - bh, bw - 1, bh);
  }
  
  // Open doorway overlay so player can clearly enter
  if (igloo.open) {
      fill(10, 15, 25); // Dark interior
      rect(igloo.x + igloo.w / 2 - 12, 34, 24, 22);
  }

  // HUD: Blocks collected indicators (Top-left grid)
  for (let i = 0; i < igloo.target; i++) {
    // Drop shadow / Extrusion
    fill(130, 140, 150);
    rect(10 + (i % 6) * 14, 13 + Math.floor(i / 6) * 14, 10, 10);

    // Block face
    fill(i < igloo.blocks ? color(0, 180, 255) : color(180, 190, 200));
    rect(10 + (i % 6) * 14, 10 + Math.floor(i / 6) * 14, 10, 10);
  }

  // Draw Player (Frostbite Bailey-like Avatar)
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

    // Legs
    fill(30);
    rect(px + d * 0.2, py + d * 0.8 + 6, d * 0.2, d * 0.2);
    rect(px + d * 0.6, py + d * 0.8 + 6, d * 0.2, d * 0.2);
    fill(60);
    rect(px + d * 0.2, py + d * 0.8, d * 0.2, d * 0.2);
    rect(px + d * 0.6, py + d * 0.8, d * 0.2, d * 0.2);

    // Parka Body Thickness
    fill(110, 40, 160);
    rect(px, py + d * 0.4 + 6, d, d * 0.5);
    // Parka Body Top
    fill(150, 60, 220);
    rect(px, py + d * 0.4, d, d * 0.5);

    // Fur Trim at bottom
    fill(180, 180, 190);
    rect(px - d * 0.05, py + d * 0.75 + 6, d * 1.1, d * 0.15);
    fill(240, 240, 255);
    rect(px - d * 0.05, py + d * 0.75, d * 1.1, d * 0.15);

    // Hood Thickness
    fill(110, 40, 160);
    rect(px + d * 0.1, py + 6, d * 0.8, d * 0.5);
    // Hood Top
    fill(150, 60, 220);
    rect(px + d * 0.1, py, d * 0.8, d * 0.5);

    // Hood Fur / Face opening
    fill(220, 220, 230);
    rect(px + d * 0.15, py + d * 0.1, d * 0.7, d * 0.4);
    
    // Face
    fill(255, 200, 150);
    rect(px + d * 0.25, py + d * 0.15, d * 0.5, d * 0.3);

    // Eyes
    fill(0);
    rect(px + d * 0.35, py + d * 0.2, d * 0.1, d * 0.1);
    rect(px + d * 0.55, py + d * 0.2, d * 0.1, d * 0.1);
  }
}