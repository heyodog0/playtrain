// ============================================================
// REQUIRED: seeded RNG (copy this verbatim)
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
// GAME GLOBALS
// ============================================================

let score = 0;
let lives = 1;
let gameState = 'PLAYING';

let worldW = 400;
let worldH = 2000;
let player;
let entities = [];
let bullets = [];
let cooldown = 0;

// ============================================================
// REQUIRED: p5.js lifecycle
// ============================================================

function setup() {
  createCanvas(400, 400);
}

// ============================================================
// REQUIRED: RL interface
// ============================================================

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
  lives = 1;
  gameState = 'PLAYING';

  worldW = 400;
  worldH = 2000;

  // Player starts near the bottom of the long world
  player = { x: worldW / 2 - 8, y: worldH - 60, w: 16, h: 16 };
  entities = [];
  bullets = [];
  cooldown = 0;

  // Level Generation Parameters
  let currH = worldH - 150;
  let min_sep = 100;
  let num_walls = 16;
  let wall_thickness = 20;

  // 1. Generate Walls, Gaps, Doors, and Locks
  for (let i = 0; i < num_walls; i++) {
    let dy = min_sep + Math.floor(rng() * 50);
    currH -= dy;
    if (currH < 100) break;

    let use_door = rng() < 0.3; // 30% chance for a gap to have a locked door
    let min_pct = 0.2;
    let pct = min_pct + 0.2 * rng();
    if (use_door) pct += 0.1;

    let gapW = pct * worldW;
    let w1 = rng() * (worldW - gapW);
    let w2 = worldW - w1 - gapW;

    // Left wall segment
    entities.push({ type: 'WALL', x: 0, y: currH, w: w1, h: wall_thickness });
    // Right wall segment
    entities.push({ type: 'WALL', x: worldW - w2, y: currH, w: w2, h: wall_thickness });

    if (use_door) {
      // Locked Door blocking the gap
      entities.push({ type: 'DOOR', x: w1, y: currH, w: gapW, h: wall_thickness });
      // Lock placed just below the door
      entities.push({ type: 'LOCK', x: w1 + gapW / 2 - 10, y: currH + wall_thickness + 5, w: 20, h: 20, doorY: currH });
    }
  }

  // 2. Generate Present (Level Complete Goal) at the very top
  entities.push({ type: 'PRESENT', x: 0, y: 0, w: worldW, h: 40 });

  // 3. Scatter Collectibles (Good) and Hazards (Bad)
  let addScattered = (type, count, w, h) => {
    for (let i = 0; i < count; i++) {
      let placed = false;
      let tries = 0;
      while (!placed && tries < 20) {
        let gx = rng() * (worldW - w);
        let gy = 100 + rng() * (worldH - 200);
        let rect = { x: gx, y: gy, w: w, h: h };
        
        // Ensure they don't spawn inside a wall, door, or lock
        let overlaps = false;
        for (let e of entities) {
          if (e.type === 'WALL' || e.type === 'DOOR' || e.type === 'LOCK') {
            if (AABB(rect, e)) { overlaps = true; break; }
          }
        }
        
        if (!overlaps) {
          entities.push({ type: type, x: gx, y: gy, w: w, h: h });
          placed = true;
        }
        tries++;
      }
    }
  };

  addScattered('GOOD', 35, 14, 14); // Fruits
  addScattered('BAD', 35, 14, 14);  // Junk Food
}

// Simple Axis-Aligned Bounding Box Collision
function AABB(r1, r2) {
  return r1.x < r2.x + r2.w &&
         r1.x + r1.w > r2.x &&
         r1.y < r2.y + r2.h &&
         r1.y + r1.h > r2.y;
}

function draw() {
  if (gameState === 'PLAYING') {
    
    // Auto upward movement - agent must react to what's coming
    let speedY = -2;
    if (keyIsDown(38)) speedY = -4;     // UP arrow accelerates progression
    if (keyIsDown(40)) speedY = -0.5;   // DOWN arrow slows down progression

    player.y += speedY;

    if (keyIsDown(37)) player.x -= 4; // LEFT arrow
    if (keyIsDown(39)) player.x += 4; // RIGHT arrow

    player.x = constrain(player.x, 0, worldW - player.w);
    player.y = constrain(player.y, 0, worldH - player.h);

    if (cooldown > 0) cooldown--;
    
    // Spacebar to shoot at locks
    if (keyIsDown(32) && cooldown <= 0) {
      bullets.push({ x: player.x + player.w / 2 - 4, y: player.y - 10, w: 8, h: 12 });
      cooldown = 15;
    }

    // Determine active camera view window
    let camY = player.y - 300;
    if (camY < 0) camY = 0;
    if (camY > worldH - height) camY = worldH - height;

    // Update bullets
    for (let i = bullets.length - 1; i >= 0; i--) {
      let b = bullets[i];
      b.y -= 8;
      
      let hit = false;
      for (let j = entities.length - 1; j >= 0; j--) {
        let e = entities[j];
        if (AABB(b, e)) {
          if (e.type === 'WALL' || e.type === 'DOOR') {
            hit = true;
            break;
          } else if (e.type === 'LOCK') {
            hit = true;
            let dY = e.doorY;
            entities.splice(j, 1); // Remove Lock
            
            // Find and remove associated Door
            for (let k = entities.length - 1; k >= 0; k--) {
              if (entities[k].type === 'DOOR' && entities[k].y === dY) {
                entities.splice(k, 1);
              }
            }
            break;
          }
        }
      }
      
      // Erase bullet if it hit something or flew off the top of the screen
      if (hit || b.y < camY) {
        bullets.splice(i, 1);
      }
    }

    // Check Player Collisions
    for (let i = entities.length - 1; i >= 0; i--) {
      let e = entities[i];
      if (AABB(player, e)) {
        if (e.type === 'WALL' || e.type === 'DOOR' || e.type === 'LOCK') {
          gameState = 'GAMEOVER';
          lives = 0;
        } else if (e.type === 'GOOD') {
          score += 1;
          entities.splice(i, 1);
        } else if (e.type === 'BAD') {
          score -= 4;
          entities.splice(i, 1);
        } else if (e.type === 'PRESENT') {
          score += 10;
          gameState = 'WIN';
        }
      }
    }
  }

  // ==========================================================
  // RENDERING
  // ==========================================================
  
  background(20);

  // Compute camera translation (smooth scroll matching player)
  let drawCamY = player.y - 300;
  if (drawCamY < 0) drawCamY = 0;
  if (drawCamY > worldH - height) drawCamY = worldH - height;

  push();
  translate(0, -drawCamY);
  noStroke();

  // Render Entities
  for (let e of entities) {
    if (e.type === 'WALL') {
      fill(120, 120, 120);
      rect(e.x, e.y, e.w, e.h);
    } else if (e.type === 'DOOR') {
      fill(255, 200, 0);
      rect(e.x, e.y, e.w, e.h);
    } else if (e.type === 'LOCK') {
      fill(255, 100, 0);
      rect(e.x, e.y, e.w, e.h);
    } else if (e.type === 'GOOD') {
      fill(0, 255, 0);
      ellipse(e.x + e.w / 2, e.y + e.h / 2, e.w, e.h);
    } else if (e.type === 'BAD') {
      fill(255, 0, 0);
      ellipse(e.x + e.w / 2, e.y + e.h / 2, e.w, e.h);
    } else if (e.type === 'PRESENT') {
      fill(255, 0, 255);
      rect(e.x, e.y, e.w, e.h);
    }
  }

  // Render Bullets
  fill(0, 255, 255);
  for (let b of bullets) {
    rect(b.x, b.y, b.w, b.h);
  }

  // Render Player
  if (gameState === 'PLAYING' || gameState === 'WIN') {
    fill(0, 150, 255);
    rect(player.x, player.y, player.w, player.h);
  }

  pop();
}