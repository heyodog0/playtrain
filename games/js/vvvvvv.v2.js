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

let score, lives, gameState;
let player, blocks, hazards, coins, enemies, goal;
let maxReachedX, prevSpace, cameraX, levelLength;

function setup() {
  createCanvas(400, 400);
}

function getGameState() {
  return { score, lives, gameState };
}

function resetGame(seed) {
  rng = mulberry32(seed);
  score = 0;
  lives = 3;
  gameState = 'PLAYING';
  levelLength = 4000;
  prevSpace = false;
  maxReachedX = 80;

  player = { 
    x: 80, y: 200, 
    w: 20, h: 24, 
    vx: 0, vy: 0, 
    gravityDir: 1, 
    onGround: false,
    treadmillSpeed: 0
  };
  
  blocks = [];
  hazards = [];
  coins = [];
  enemies = [];

  // Generate static bounds (ceiling, floor, and left wall)
  // Shifted ceiling to start at y=20, h=40 so visible bottom edge is y=60, 
  // keeping it below the 40px HUD to prevent overlapping floating illusions.
  blocks.push({x: -200, y: 20, w: levelLength + 800, h: 40, speed: 0});
  blocks.push({x: -200, y: 340, w: levelLength + 800, h: 40, speed: 0});
  blocks.push({x: -200, y: 60, w: 200, h: 280, speed: 0});

  // Procedural obstacle generation
  let cursorX = 300;
  while (cursorX < levelLength - 300) {
    let type = Math.floor(rng() * 8);
    let w = 80 + rng() * 80;

    if (type === 0) {
      // Spikes on floor
      hazards.push({x: cursorX, y: 316, w: w, h: 24, type: 'UP'});
      coins.push({x: cursorX + w/2 - 10, y: 120, w: 20, h: 20, active: true});
    } else if (type === 1) {
      // Spikes on ceiling
      hazards.push({x: cursorX, y: 60, w: w, h: 24, type: 'DOWN'});
      coins.push({x: cursorX + w/2 - 10, y: 280, w: 20, h: 20, active: true});
    } else if (type === 2) {
      // Wall resting on floor
      blocks.push({x: cursorX, y: 220, w: w, h: 120, speed: 0});
      coins.push({x: cursorX + w/2 - 10, y: 150, w: 20, h: 20, active: true});
    } else if (type === 3) {
      // Wall attached to ceiling
      blocks.push({x: cursorX, y: 60, w: w, h: 120, speed: 0});
      coins.push({x: cursorX + w/2 - 10, y: 230, w: 20, h: 20, active: true});
    } else if (type === 4) {
      // Floor Treadmill
      let spd = rng() > 0.5 ? 4 : -4;
      blocks.push({x: cursorX, y: 320, w: w, h: 20, speed: spd});
      coins.push({x: cursorX + w/2 - 10, y: 200, w: 20, h: 20, active: true});
    } else if (type === 5) {
      // Ceiling Treadmill
      let spd = rng() > 0.5 ? 4 : -4;
      blocks.push({x: cursorX, y: 60, w: w, h: 20, speed: spd});
      coins.push({x: cursorX + w/2 - 10, y: 200, w: 20, h: 20, active: true});
    } else if (type === 6) {
      // Vertical Bouncing Enemy
      enemies.push({x: cursorX + w/2 - 12, y: 150, w: 24, h: 24, vx: 0, vy: 4});
      coins.push({x: cursorX + w/2 - 10, y: 200, w: 20, h: 20, active: true});
    } else if (type === 7) {
      // Horizontal Bouncing Enemy bounded between walls
      blocks.push({x: cursorX, y: 260, w: 20, h: 80, speed: 0});
      blocks.push({x: cursorX + w, y: 260, w: 20, h: 80, speed: 0});
      enemies.push({x: cursorX + 30, y: 316, w: 24, h: 24, vx: 4, vy: 0});
      coins.push({x: cursorX + w/2 - 10, y: 180, w: 20, h: 20, active: true});
    }
    
    // Ensure safe gap between obstacles
    cursorX += w + 200 + rng() * 100;
  }

  goal = {x: levelLength, y: 60, w: 200, h: 280};
  cameraX = 0;
}

function rectIntersect(a, b) {
  return a.x < b.x + b.w && 
         a.x + a.w > b.x && 
         a.y < b.y + b.h && 
         a.y + a.h > b.y;
}

function die() {
  lives--;
  score = Math.max(0, score - 50);
  if (lives <= 0) {
    gameState = 'GAMEOVER';
  } else {
    // Respawn safely at start
    player.x = 80;
    player.y = 200;
    player.vx = 0;
    player.vy = 0;
    player.gravityDir = 1;
    player.treadmillSpeed = 0;
  }
}

function updateLogic() {
  // Horizontal movement
  let baseVx = 0;
  if (keyIsDown(37)) baseVx = -5; // LEFT
  if (keyIsDown(39)) baseVx = 5;  // RIGHT
  player.vx = baseVx + player.treadmillSpeed;
  player.treadmillSpeed = 0; // reset for this frame's physics computation

  // Gravity flip mechanic
  let currentSpace = keyIsDown(32); // SPACE
  if (currentSpace && !prevSpace && player.onGround) {
    player.gravityDir *= -1;
    player.vy = 0;
  }
  prevSpace = currentSpace;

  // Apply quick gravity
  player.vy += player.gravityDir * 1.5;
  if (player.vy > 12) player.vy = 12;
  if (player.vy < -12) player.vy = -12;

  // X Axis Physics & Collision
  player.x += player.vx;
  for (let b of blocks) {
    if (rectIntersect(player, b)) {
      if (player.vx > 0) player.x = b.x - player.w;
      else if (player.vx < 0) player.x = b.x + b.w;
      player.vx = 0;
    }
  }

  // Prevent moving backward past start bounds
  if (player.x < 0) player.x = 0;

  // Y Axis Physics & Collision
  player.y += player.vy;
  player.onGround = false;
  
  for (let b of blocks) {
    if (rectIntersect(player, b)) {
      if (player.vy > 0) {
        player.y = b.y - player.h;
        if (player.gravityDir === 1) {
          player.onGround = true;
          if (b.speed) player.treadmillSpeed = b.speed;
        }
      } else if (player.vy < 0) {
        player.y = b.y + b.h;
        if (player.gravityDir === -1) {
          player.onGround = true;
          if (b.speed) player.treadmillSpeed = b.speed;
        }
      }
      player.vy = 0;
    }
  }

  if (player.x > maxReachedX) {
    maxReachedX = player.x;
  }

  // Smooth camera following
  cameraX = player.x - 200;
  if (cameraX < 0) cameraX = 0;
  if (cameraX > levelLength - width + 200) cameraX = levelLength - width + 200;

  // Enemy Updates
  for (let e of enemies) {
    e.x += e.vx;
    for (let b of blocks) {
      if (rectIntersect(e, b)) {
        if (e.vx > 0) e.x = b.x - e.w;
        else e.x = b.x + b.w;
        e.vx *= -1;
      }
    }
    e.y += e.vy;
    for (let b of blocks) {
      if (rectIntersect(e, b)) {
        if (e.vy > 0) e.y = b.y - e.h;
        else e.y = b.y + b.h;
        e.vy *= -1;
      }
    }
    if (rectIntersect(player, e)) {
      die();
      return;
    }
  }

  // Check Hazards
  for (let h of hazards) {
    if (rectIntersect(player, h)) {
      die();
      return;
    }
  }

  // Check Collectibles
  for (let c of coins) {
    if (c.active && rectIntersect(player, c)) {
      c.active = false;
      score += 50;
    }
  }

  // Check Win Condition
  if (rectIntersect(player, goal)) {
    // Terminal bonus. Without it reaching the goal pays nothing and truncates the
    // episode, so a return-maximizing policy is actively discouraged from
    // finishing: loitering among coins scores strictly better. 500 exceeds a
    // perfect coin sweep (~9 chunks x 50) so finishing dominates farming.
    score += 500;
    gameState = 'WIN';
  }
}

function draw() {
  if (gameState === 'PLAYING') {
    updateLogic();
  }

  // Render Background
  background(0);
  
  // Diverse mixed-in background shapes with parallax
  push();
  stroke(20, 30, 45);
  noFill();
  strokeWeight(2);
  let spacing = width + 400;
  for (let i = 0; i < 40; i++) {
    let rx = Math.sin(i * 123.456);
    let ry = Math.cos(i * 321.654);
    let pFactor = 0.2 + Math.abs(rx) * 0.2;
    let parallax = cameraX * pFactor;
    
    let baseBx = (rx * 0.5 + 0.5) * spacing;
    let bx = ((((baseBx - parallax) % spacing) + spacing) % spacing) - 100;
    let by = (ry * 0.5 + 0.5) * height;
    
    push();
    translate(bx, by);
    rotate((frameCount * 0.005) + i);
    let shapeType = i % 7;
    if (shapeType === 0) {
      rect(-25, -25, 50, 50);
    } else if (shapeType === 1) {
      circle(0, 0, 60);
    } else if (shapeType === 2) {
      triangle(-30, 25, 0, -25, 30, 25);
    } else if (shapeType === 3) {
      quad(0, -35, 35, 0, 0, 35, -35, 0); 
    } else if (shapeType === 4) {
      line(-30, 0, 30, 0); 
      line(0, -30, 0, 30);
    } else if (shapeType === 5) {
      beginShape(); 
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 3) {
        vertex(Math.cos(a) * 30, Math.sin(a) * 30);
      }
      endShape(CLOSE);
    } else {
      rect(-15, -35, 30, 70); 
    }
    pop();
  }
  pop();

  push();
  translate(-cameraX, 0);

  // Render Terrain (Blocks & Treadmills)
  for (let b of blocks) {
    if (b.speed) {
      // Treadmill render
      noStroke();
      fill(40, 60, 80);
      rect(b.x, b.y, b.w, b.h);
      fill(255, 150, 0);
      let offset = (frameCount * b.speed * 0.5) % 20;
      if (offset < 0) offset += 20;
      for (let tx = b.x + offset - 20; tx < b.x + b.w; tx += 20) {
        if (tx >= b.x && tx + 10 <= b.x + b.w) {
          rect(tx, b.y, 10, b.h);
        }
      }
      noFill();
      stroke(255, 150, 0);
      strokeWeight(2);
      rect(b.x, b.y, b.w, b.h);
      noStroke();
    } else {
      // Standard block render
      noStroke();
      fill(0, 100, 200);
      rect(b.x, b.y, b.w, b.h);
      fill(0, 20, 60);
      rect(b.x + 4, b.y + 4, b.w - 8, b.h - 8);
      fill(0, 255, 255);
      rect(b.x, b.y, 8, 8);
      rect(b.x + b.w - 8, b.y, 8, 8);
      rect(b.x, b.y + b.h - 8, 8, 8);
      rect(b.x + b.w - 8, b.y + b.h - 8, 8, 8);
    }
  }

  // Render Hazards
  noStroke();
  for (let h of hazards) {
    let spikeW = 16;
    let count = Math.floor(h.w / spikeW);
    let startX = h.x + (h.w - count * spikeW) / 2;
    for (let i = 0; i < count; i++) {
      let sx = startX + i * spikeW;
      fill(255, 0, 50);
      if (h.type === 'UP') {
        rect(sx, h.y + 16, 16, 8);
        rect(sx + 2, h.y + 8, 12, 8);
        rect(sx + 6, h.y, 4, 8);
        fill(255, 150, 150);
        rect(sx + 6, h.y, 4, 4);
      } else {
        rect(sx, h.y, 16, 8);
        rect(sx + 2, h.y + 8, 12, 8);
        rect(sx + 6, h.y + 16, 4, 8);
        fill(255, 150, 150);
        rect(sx + 6, h.y + 20, 4, 4);
      }
    }
  }

  // Render Enemies
  noStroke();
  for (let e of enemies) {
    fill(255, 0, 255);
    rect(e.x, e.y, e.w, e.h);
    fill(0);
    // Enemy Face
    rect(e.x + 4, e.y + 4, 4, 4);
    rect(e.x + e.w - 8, e.y + 4, 4, 4);
    rect(e.x + 4, e.y + e.h - 8, e.w - 8, 4);
  }

  // Render Coins
  let t = millis() / 200;
  for (let c of coins) {
    if (c.active) {
      let cx = c.x + c.w / 2;
      let cy = c.y + c.h / 2;
      let frame = Math.floor(t) % 4;
      noStroke();
      if (frame === 0 || frame === 2) {
        fill(255, 255, 0);
        rect(cx - 8, cy - 8, 16, 16);
        fill(0);
        rect(cx - 4, cy - 4, 8, 8);
      } else if (frame === 1) {
        fill(255, 255, 0);
        rect(cx - 4, cy - 8, 8, 16);
      } else {
        fill(255, 255, 0);
        rect(cx - 8, cy - 4, 16, 8);
      }
    }
  }

  // Render Goal
  noStroke();
  fill(0, 255, 100);
  rect(goal.x, goal.y, goal.w, goal.h);
  fill(0);
  for (let i = goal.y; i < goal.y + goal.h; i += 8) {
    rect(goal.x, i, goal.w, 4);
  }

  // Render Player
  let px = player.x;
  let py = player.y;
  let walk = (player.vx !== 0 && player.onGround) ? Math.floor(frameCount / 5) % 2 : 0;
  
  noStroke();
  if (player.gravityDir === 1) {
    fill(0, 255, 255);
    rect(px + 2, py, 16, 12); 
    fill(0);
    let look = player.vx > 0 ? 2 : (player.vx < 0 ? -2 : 0);
    rect(px + 4 + look, py + 4, 2, 2); 
    rect(px + 10 + look, py + 4, 2, 2); 
    rect(px + 6 + look, py + 8, 4, 2); 
    fill(0, 255, 255);
    rect(px + 4, py + 12, 12, 6); 
    if (walk === 0) {
      rect(px + 4, py + 18, 4, 6); 
      rect(px + 12, py + 18, 4, 6); 
    } else {
      rect(px + 2, py + 18, 4, 6); 
      rect(px + 14, py + 18, 4, 6); 
    }
  } else {
    fill(0, 255, 255);
    rect(px + 2, py + 12, 16, 12); 
    fill(0);
    let look = player.vx > 0 ? 2 : (player.vx < 0 ? -2 : 0);
    rect(px + 4 + look, py + 18, 2, 2); 
    rect(px + 10 + look, py + 18, 2, 2); 
    rect(px + 6 + look, py + 14, 4, 2); 
    fill(0, 255, 255);
    rect(px + 4, py + 6, 12, 6); 
    if (walk === 0) {
      rect(px + 4, py, 4, 6);
      rect(px + 12, py, 4, 6);
    } else {
      rect(px + 2, py, 4, 6);
      rect(px + 14, py, 4, 6);
    }
  }

  pop();

  // HUD Background
  fill(0);
  noStroke();
  rect(0, 0, width, 40);
  
  // HUD: Wider Progress bar
  fill(50);
  rect(width / 2 - 125, 15, 250, 10);
  fill(0, 255, 255);
  let progress = Math.min(maxReachedX, levelLength) / levelLength;
  rect(width / 2 - 125, 15, 250 * progress, 10);

  // HUD: Lives
  for (let i = 0; i < lives; i++) {
    fill(0, 255, 255);
    let lx = 20 + i * 18;
    rect(lx, 12, 10, 8); 
    rect(lx + 2, 20, 6, 4); 
    rect(lx + 2, 24, 2, 4); 
    rect(lx + 6, 24, 2, 4); 
  }

  // Gamestates Overlay
  if (gameState === 'GAMEOVER') {
    fill(0, 200);
    rect(0, 0, width, height);
  } else if (gameState === 'WIN') {
    fill(0, 200);
    rect(0, 0, width, height);
  }
}