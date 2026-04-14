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
  background(10, 10, 20);

  // Safe zones (Top and Bottom)
  fill(80, 80, 90);
  rect(0, 0, 400, 60);
  rect(0, 300, 400, 100);

  // Draw River Floes
  for (let r of riverRows) {
    for (let f of r.floes) {
      // Visited floes are bright blue, unvisited are white
      fill(f.visited ? color(0, 200, 255) : color(255, 255, 255));
      
      // Main body
      rect(f.x, r.y + 10, f.w, 40);
      
      // Wrapped body if crossing screen boundary
      if (f.x + f.w > 400) {
        rect(f.x - 400, r.y + 10, f.w, 40);
      }
    }
  }

  // Draw Igloo
  fill(igloo.open ? color(0, 255, 0) : color(200, 100, 0));
  rect(igloo.x, 10, igloo.w, 40);
  
  // Igloo Doorway
  fill(80, 80, 90); // Matches safe zone background
  rect(igloo.x + 20, 30, 20, 20);

  // HUD: Blocks collected indicators (Top-left grid)
  for (let i = 0; i < igloo.target; i++) {
    fill(i < igloo.blocks ? color(0, 200, 255) : color(50, 50, 60));
    rect(10 + (i % 6) * 14, 10 + Math.floor(i / 6) * 14, 10, 10);
  }

  // Draw Player
  if (gameState !== 'GAMEOVER') {
    // Magenta block for player
    fill(255, 0, 200);
    
    let drawY = player.row * 60 + 30;
    let drawSize = player.size;
    
    if (player.jumpFrames > 0) {
      let t = player.jumpFrames / 15.0; // 1 to 0
      let oldY = player.oldRow * 60 + 30;
      let currentY = player.row * 60 + 30;
      
      // Linear interpolation between old row and current row
      drawY = oldY * t + currentY * (1 - t);
      
      // Arc and scale effects
      let arc = Math.sin(t * Math.PI);
      drawY -= arc * 20; // Up to 20 pixels high
      drawSize = player.size * (1 + arc * 0.3); // Up to 30% larger at apex
    }
    
    // Center player drawing coordinates
    rect(player.x - drawSize / 2, drawY - drawSize / 2, drawSize, drawSize);
  }
}