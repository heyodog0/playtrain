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

let birds = [];
let fishes = [];
let birdSpawnTimer = 0;

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

  // Hardcode trees and bushes in the corners
  const staticDecorations = [
    { type: 'tree', x: 25, y: 25, scale: 1.0 },
    { type: 'bush', x: 65, y: 35, scale: 0.8 },
    { type: 'tree', x: 95, y: 20, scale: 0.9 },
    { type: 'tree', x: 305, y: 20, scale: 0.9 },
    { type: 'bush', x: 335, y: 35, scale: 0.8 },
    { type: 'tree', x: 375, y: 25, scale: 1.0 },
    { type: 'tree', x: 25, y: 340, scale: 1.0 },
    { type: 'bush', x: 65, y: 350, scale: 0.8 },
    { type: 'tree', x: 95, y: 335, scale: 0.9 },
    { type: 'tree', x: 305, y: 335, scale: 0.9 },
    { type: 'bush', x: 335, y: 350, scale: 0.8 },
    { type: 'tree', x: 375, y: 340, scale: 1.0 }
  ];

  for (let dec of staticDecorations) {
    decorations.push(dec);
  }

  birds = [];
  fishes = [];
  birdSpawnTimer = 100;

  for (let r = 1; r <= 4; r++) {
    fishes.push({
      row: r,
      x: 20 + rng() * 360,
      jumpTimer: 60 + rng() * 120,
      jumping: false,
      y: 0
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

  // Update fishes (Piranhas jumping)
  for (let f of fishes) {
    if (!f.jumping) {
      f.jumpTimer--;
      if (f.jumpTimer <= 0) {
        f.jumping = true;
        f.jumpTimer = 60;
        f.x = 20 + rng() * 360; 
      }
    } else {
      f.jumpTimer--;
      f.y = Math.sin((f.jumpTimer / 60) * Math.PI) * 40;
      if (f.jumpTimer <= 0) {
        f.jumping = false;
        f.jumpTimer = 100 + rng() * 200;
        f.y = 0;
      }
    }
  }

  // Update birds (Toucans flying)
  birdSpawnTimer--;
  if (birdSpawnTimer <= 0) {
    let row = 1 + Math.floor(rng() * 4); // Only fly over river (rows 1-4)
    let dir = rng() > 0.5 ? 1 : -1;
    birds.push({
      x: dir === 1 ? -40 : 440,
      row: row,
      speed: dir * (2 + rng() * 1.5),
      flap: 0
    });
    birdSpawnTimer = 150 + rng() * 150;
  }
  
  for (let i = birds.length - 1; i >= 0; i--) {
    let b = birds[i];
    b.x += b.speed;
    b.flap = (b.flap + 1) % 20;
    if (b.x < -60 || b.x > 460) {
      birds.splice(i, 1);
    }
  }
}

function killPlayer() {
  lives--;
  if (lives <= 0) {
    gameState = 'GAMEOVER';
  } else {
    // Respawn at bottom
    player.row = 5;
    player.oldRow = 5;
    player.x = 200;
    moveCooldown = 30; // Brief stun / invulnerability period
    player.jumpFrames = 0;
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

  // Calculate visual player Y for accurate hitbox checking
  let currentPy = player.row * 60 + 30;
  if (player.jumpFrames > 0) {
    let t = player.jumpFrames / 15.0; // 1 to 0
    let oldY = player.oldRow * 60 + 30;
    let baseY = oldY * t + (player.row * 60 + 30) * (1 - t);
    let arc = Math.sin(t * Math.PI);
    currentPy = baseY - arc * 20;
  }

  let dead = false;

  // Water & Log Collision
  if (player.row >= 1 && player.row <= 4) {
    if (player.jumpFrames === 0) {
      let r = riverRows[player.row - 1];
      let onLog = false;
      
      for (let l of r.logs) {
        let checkCollision = (lx) => player.x >= lx && player.x <= lx + l.w;
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

      if (!onLog) {
        dead = true;
      }
    }
  } else if (player.row === 0) {
    // Check if entered open temple
    if (player.jumpFrames === 0 && temple.open && player.x >= temple.x && player.x <= temple.x + temple.w) {
      score += 100;
      gameState = 'WIN';
    }
  }

  // Hazard Collision: Piranhas
  for (let f of fishes) {
    if (f.jumping) {
      let fy = f.row * 60 + 30 - f.y;
      let dx = player.x - f.x;
      let dy = currentPy - fy;
      if (Math.sqrt(dx * dx + dy * dy) < 18) {
        dead = true;
      }
    }
  }

  // Hazard Collision: Toucans
  for (let b of birds) {
    let by = b.row * 60 + 15;
    let dx = player.x - b.x;
    let dy = currentPy - by;
    if (Math.sqrt(dx * dx + dy * dy) < 20) {
      dead = true;
    }
  }

  if (dead) {
    killPlayer();
  }

  // Vertical Row Jumping (Discrete)
  if (moveCooldown === 0 && !dead) {
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

  // Minimal water animations
  fill(35, 80, 55);
  for (let i = 0; i < 12; i++) {
    let speed = (i % 2 === 0) ? 0.5 : 0.8;
    let x = (i * 45 + frameCount * speed) % 400;
    let y = 75 + (i % 5) * 45;
    rect(x, y, 40, 4, 2);
    if (x > 360) rect(x - 400, y, 40, 4, 2);
  }

  // Safe zones (Top and Bottom) - Grassy Banks
  // Top bank
  fill(30, 120, 40);
  rect(0, 0, 400, 60);
  fill(40, 140, 50);
  rect(0, 15, 400, 15);
  fill(20, 100, 30);
  rect(0, 40, 400, 10);
  // Top bank dirt edge
  fill(80, 50, 20);
  rect(0, 60, 400, 8);

  // Bottom bank
  fill(30, 120, 40);
  rect(0, 300, 400, 100);
  fill(40, 140, 50);
  rect(0, 310, 400, 20);
  fill(25, 105, 35);
  rect(0, 345, 400, 25);
  fill(45, 150, 55);
  rect(0, 380, 400, 20);
  // Bottom bank dirt inner edge
  fill(80, 50, 20);
  rect(0, 300, 400, 4);

  // Draw River Logs
  for (let r of riverRows) {
    for (let l of r.logs) {
      let thicknessColor = l.visited ? color(100, 60, 20) : color(60, 90, 40);
      let topColor = l.visited ? color(140, 90, 40) : color(80, 120, 50);
      let highlightColor = l.visited ? color(160, 110, 50) : color(100, 140, 60);

      fill(thicknessColor);
      rect(l.x, r.y + 16, l.w - 2, 40, 4);
      if (l.x + l.w > 400) rect(l.x - 400, r.y + 16, l.w - 2, 40, 4);

      fill(topColor);
      rect(l.x, r.y + 10, l.w - 2, 40, 4);
      if (l.x + l.w > 400) rect(l.x - 400, r.y + 10, l.w - 2, 40, 4);

      fill(highlightColor);
      rect(l.x + 4, r.y + 14, l.w - 10, 32, 2);
      if (l.x + l.w > 400) rect(l.x - 400 + 4, r.y + 14, l.w - 10, 32, 2);

      // Grassy character on logs
      fill(50, 130, 40);
      rect(l.x + 6, r.y + 12, 16, 8, 3);
      rect(l.x + l.w - 24, r.y + 36, 18, 10, 3);
      fill(40, 110, 30);
      rect(l.x + 10, r.y + 50, 6, 12, 3);
      rect(l.x + l.w - 20, r.y + 50, 8, 8, 3);

      if (l.x + l.w > 400) {
        fill(50, 130, 40);
        rect(l.x - 400 + 6, r.y + 12, 16, 8, 3);
        rect(l.x - 400 + l.w - 24, r.y + 36, 18, 10, 3);
        fill(40, 110, 30);
        rect(l.x - 400 + 10, r.y + 50, 6, 12, 3);
        rect(l.x - 400 + l.w - 20, r.y + 50, 8, 8, 3);
      }
    }
  }

  // Draw Fishes (Piranhas)
  for (let f of fishes) {
    let fy = f.row * 60 + 30; // center of the row 
    if (!f.jumping && f.jumpTimer < 30) {
      let rSize = 10 + (30 - f.jumpTimer);
      fill(200, 255, 255, 100);
      rect(f.x - rSize / 2, fy - rSize / 4 + 6, rSize, rSize / 2, 4);
    } else if (f.jumping) {
      let drawY = fy - f.y;
      if (f.jumpTimer > 50 || f.jumpTimer < 10) {
        fill(200, 255, 255, 200);
        rect(f.x - 12, fy + 2, 24, 8, 4);
      }
      
      // Draw Blocky Piranha
      fill(200, 50, 50);
      rect(f.x - 10, drawY - 8, 20, 16, 4); // body
      fill(180, 40, 40);
      rect(f.x - 16, drawY - 4, 6, 8, 2); // tail
      
      // Teeth
      fill(255);
      rect(f.x + 2, drawY + 4, 4, 4); 
      rect(f.x + 8, drawY + 4, 4, 4);
      
      // Eye
      fill(255);
      rect(f.x + 4, drawY - 4, 6, 6);
      fill(0);
      rect(f.x + 6, drawY - 2, 2, 2);
    }
  }

  let drawDecoration = (d) => {
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
  };

  // Draw vines behind the temple
  for (let d of decorations) {
    if (d.type === 'vine') {
      drawDecoration(d);
    }
  }

  // Draw Jungle Temple
  let templeThickColor = temple.open ? color(200, 180, 40) : color(100, 100, 110);
  let templeTopColor   = temple.open ? color(255, 220, 50) : color(130, 130, 140);

  fill(80, 80, 90);
  rect(temple.x, 16, temple.w, 40);
  fill(90, 90, 100);
  rect(temple.x, 10, temple.w, 40);
  fill(40, 40, 50);
  rect(temple.x + temple.w / 2 - 10, 30, 20, 26);

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
    
    fill(templeThickColor);
    rect(bx, by - bh + 4, bw - 1, bh);
    fill(templeTopColor);
    rect(bx, by - bh, bw - 1, bh);
  }
  
  if (temple.open) {
      fill(255, 240, 150);
      rect(temple.x + temple.w / 2 - 12, 34, 24, 22);
  }

  let drawY = 0, shadowY = 0, drawSize = 24, px = 0, py = 0, playerBaseY = -1;
  if (gameState !== 'GAMEOVER') {
    drawY = player.row * 60 + 30;
    shadowY = drawY + player.size / 2;
    drawSize = player.size;
    
    if (player.jumpFrames > 0) {
      let t = player.jumpFrames / 15.0; // 1 to 0
      let oldY = player.oldRow * 60 + 30;
      let currentY = player.row * 60 + 30;
      
      let baseY = oldY * t + currentY * (1 - t);
      drawY = baseY;
      shadowY = baseY + player.size / 2;
      
      let arc = Math.sin(t * Math.PI);
      drawY -= arc * 20;
      drawSize = player.size * (1 + arc * 0.3);
    }
    
    px = player.x - drawSize / 2;
    py = drawY - drawSize / 2;
    playerBaseY = shadowY;
  }

  // Draw decorations behind player
  for (let d of decorations) {
    if (d.type !== 'vine' && (playerBaseY === -1 || d.y < playerBaseY)) {
      drawDecoration(d);
    }
  }

  // Draw Player
  if (gameState !== 'GAMEOVER') {
    let d = drawSize;

    // Draw Drop Shadow
    fill(0, 0, 0, 80);
    noStroke();
    ellipse(player.x, shadowY, d * 1.2, d * 0.5);

    // Legs
    fill(70, 50, 30);
    rect(px + d * 0.2, py + d * 0.8 + 6, d * 0.2, d * 0.2);
    rect(px + d * 0.6, py + d * 0.8 + 6, d * 0.2, d * 0.2);
    fill(90, 60, 40);
    rect(px + d * 0.2, py + d * 0.8, d * 0.2, d * 0.2);
    rect(px + d * 0.6, py + d * 0.8, d * 0.2, d * 0.2);

    // Body Thickness
    fill(130, 120, 70);
    rect(px, py + d * 0.4 + 6, d, d * 0.5);
    // Body Top
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

    // Head / Hat base
    fill(90, 60, 30);
    rect(px + d * 0.1, py + 6, d * 0.8, d * 0.2);
    // Hat brim/top
    fill(120, 80, 40);
    rect(px - d * 0.1, py, d * 1.2, d * 0.2);
    rect(px + d * 0.15, py - d * 0.15, d * 0.7, d * 0.35);
  }

  // Draw decorations IN FRONT of player
  for (let dec of decorations) {
    if (dec.type !== 'vine' && playerBaseY !== -1 && dec.y >= playerBaseY) {
      drawDecoration(dec);
    }
  }

  // Draw Birds (Toucans)
  for (let b of birds) {
    let by = b.row * 60 + 15;
    let dir = b.speed > 0 ? 1 : -1;
    let flap = b.flap < 10 ? 1 : -1;
    
    push();
    translate(b.x, by);
    scale(dir, 1);
    
    // Toucan body
    fill(40, 40, 50);
    rect(-8, -6, 16, 12, 4);
    
    // Wing
    fill(60, 60, 70);
    if (flap === 1) {
      rect(-4, -12, 10, 8, 3);
    } else {
      rect(-4, 4, 10, 8, 3);
    }
    
    // Tail
    fill(30, 30, 40);
    rect(-14, -2, 8, 6, 2);
    
    // Beak
    fill(250, 150, 20);
    rect(8, -4, 12, 6, 2);
    fill(200, 80, 20);
    rect(8, 2, 10, 4, 2);
    
    // Eye
    fill(255);
    rect(2, -4, 4, 4);
    fill(0);
    rect(4, -2, 2, 2);
    
    pop();
  }

  // HUD
  for (let i = 0; i < temple.target; i++) {
    fill(100, 80, 20);
    rect(10 + (i % 6) * 14, 13 + Math.floor(i / 6) * 14, 10, 10);
    fill(i < temple.blocks ? color(255, 215, 0) : color(120, 120, 120));
    rect(10 + (i % 6) * 14, 10 + Math.floor(i / 6) * 14, 10, 10);
  }
}