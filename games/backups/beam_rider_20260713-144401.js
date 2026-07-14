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

let sector = 1;
let saucersDestroyed = 0;
let torpedoes = 3;
let playerLane = 2;

let enemies = [];
let bullets = [];
let sentinel = null;

let gridOffset = 0;
let spawnTimer = 0;
let laserCooldown = 0;
let torpedoCooldown = 0;

let prevLeft = false;
let prevRight = false;
let prevUp = false;

const VP_X = 200;
const VP_Y = 120;
const PLAYER_Y = 380;
const BOTTOM_X = [40, 120, 200, 280, 360];

function getScreenY(z) {
  return VP_Y + (PLAYER_Y - VP_Y) / z;
}

function getScreenX(lane, z) {
  return VP_X + (BOTTOM_X[lane] - VP_X) / z;
}

function randomInt(min, max) {
  return Math.floor(min + rng() * (max - min + 1));
}

function setup() {
  createCanvas(400, 400);
}

function resetGame(seed) {
  rng = mulberry32(seed);
  score = 0;
  lives = 3;
  gameState = 'PLAYING';
  
  sector = 1;
  saucersDestroyed = 0;
  torpedoes = 3;
  playerLane = 2;
  
  enemies = [];
  bullets = [];
  sentinel = null;
  
  gridOffset = 0;
  spawnTimer = 60;
  laserCooldown = 0;
  torpedoCooldown = 0;
  
  prevLeft = false;
  prevRight = false;
  prevUp = false;
}

function getGameState() {
  return { score: score, lives: lives, gameState: gameState };
}

function clearSector() {
  score += 200;
  sector++;
  saucersDestroyed = 0;
  torpedoes = 3;
  enemies = [];
  bullets = [];
  sentinel = null;
  spawnTimer = 30;
}

function draw() {
  background('#000000');
  
  if (gameState !== 'PLAYING') {
    return;
  }

  // --- Input Handling ---
  let leftDown = keyIsDown(37);
  let rightDown = keyIsDown(39);
  let upDown = keyIsDown(38);
  let dDown = keyIsDown(32);

  if (leftDown && !prevLeft) playerLane = Math.max(0, playerLane - 1);
  if (rightDown && !prevRight) playerLane = Math.min(4, playerLane + 1);
  
  if (dDown && laserCooldown <= 0) {
    bullets.push({ type: 'laser', lane: playerLane, z: 1.0, prevZ: 1.0, active: true });
    laserCooldown = 12;
  }
  
  if (upDown && !prevUp && torpedoCooldown <= 0 && torpedoes > 0) {
    bullets.push({ type: 'torpedo', lane: playerLane, z: 1.0, prevZ: 1.0, active: true });
    torpedoes--;
    torpedoCooldown = 20;
  }

  if (laserCooldown > 0) laserCooldown--;
  if (torpedoCooldown > 0) torpedoCooldown--;
  
  prevLeft = leftDown;
  prevRight = rightDown;
  prevUp = upDown;

  // --- Update Grid ---
  let baseGridSpeed = 0.1 + (sector * 0.02);
  gridOffset += baseGridSpeed;

  // --- Update & Spawn Enemies ---
  if (!sentinel) {
    spawnTimer--;
    if (spawnTimer <= 0 && enemies.length < 3 + sector && saucersDestroyed < 15) {
      let r = rng();
      let eType = 'saucer';
      if (r < 0.25) eType = 'debris';
      else if (r < 0.35) eType = 'rejuv';

      enemies.push({
        type: eType,
        lane: randomInt(0, 4),
        z: 20,
        prevZ: 20,
        speed: 0.1 + (sector * 0.015) + rng() * 0.05,
        active: true
      });
      spawnTimer = Math.max(15, 50 - sector * 5);
    }
    
    if (saucersDestroyed >= 15 && enemies.length === 0) {
      sentinel = {
        x: rng() > 0.5 ? 40 : 360,
        dir: 0,
        z: 15,
        speed: 1.5 + sector * 0.5
      };
      sentinel.dir = sentinel.x < 200 ? 1 : -1;
    }
  }

  if (sentinel) {
    sentinel.x += sentinel.dir * sentinel.speed;
    if (sentinel.x < 20 || sentinel.x > 380) {
      sentinel.dir *= -1;
    }
  }

  for (let e of enemies) {
    e.prevZ = e.z;
    e.z -= e.speed;
  }

  for (let b of bullets) {
    b.prevZ = b.z;
    b.z += (b.type === 'laser' ? 0.8 : 0.6);
  }

  // --- Collisions ---
  for (let b of bullets) {
    if (!b.active) continue;

    if (sentinel && b.type === 'torpedo') {
      if (b.prevZ <= sentinel.z && b.z >= sentinel.z) {
        let t = 1 / sentinel.z;
        let bx = VP_X + (BOTTOM_X[b.lane] - VP_X) * t;
        if (Math.abs(bx - sentinel.x) < 40) {
          score += 300 + torpedoes * 50;
          clearSector();
          continue; 
        }
      }
    }

    for (let e of enemies) {
      if (!e.active || !b.active || b.lane !== e.lane) continue;
      
      if (b.prevZ <= e.prevZ && b.z >= e.z) {
        b.active = false;
        if (b.type === 'laser') {
          if (e.type === 'saucer') {
            e.active = false;
            score += 25;
            saucersDestroyed++;
          } else if (e.type === 'rejuv') {
            e.type = 'debris';
          }
        } else if (b.type === 'torpedo') {
          e.active = false;
          score += 50;
          if (e.type === 'saucer') saucersDestroyed++;
        }
      }
    }
  }

  for (let e of enemies) {
    if (!e.active) continue;
    if (e.z < 1.0 && e.prevZ >= 1.0) {
      if (e.lane === playerLane) {
        if (e.type === 'saucer' || e.type === 'debris') {
          lives--;
          if (lives <= 0) gameState = 'GAMEOVER';
        } else if (e.type === 'rejuv') {
          score += 100;
          if (lives < 5) lives++;
        }
      }
      e.active = false;
    }
  }

  bullets = bullets.filter(b => b.active && b.z < 25);
  enemies = enemies.filter(e => e.active && e.z > 0.5);

  // --- Render Grid ---
  // Vertical lane dots
  fill('#00aaff');
  noStroke();
  for (let lane = 0; lane < 5; lane++) {
    for (let i = 0; i < 20; i++) {
      let z = (i * 1.5) - (gridOffset % 1.5);
      if (z >= 1 && z <= 20) {
        let sy = getScreenY(z);
        let sx = getScreenX(lane, z);
        let sz = Math.max(2, 6 / z);
        rect(sx - sz/2, sy - sz/2, sz, sz);
      }
    }
  }

  // Horizontal bounding lines
  stroke('#00aaff');
  strokeWeight(2);
  for (let i = 0; i < 10; i++) {
    let z = (i * 4) - (gridOffset % 4);
    if (z >= 1 && z <= 20) {
      let y = getScreenY(z);
      let x1 = getScreenX(0, z);
      let x2 = getScreenX(4, z);
      line(x1, y, x2, y);
    }
  }

  // --- Render Entities ---
  for (let e of enemies) {
    let sx = getScreenX(e.lane, e.z);
    let sy = getScreenY(e.z);
    let sz = Math.max(8, 40 / e.z);
    
    noStroke();
    if (e.type === 'saucer') {
      fill('#ffffff');
      quad(sx, sy - sz/2, sx + sz*1.2, sy, sx, sy + sz/2, sx - sz*1.2, sy);
    } else if (e.type === 'debris') {
      fill('#aa5500');
      rect(sx - sz/2, sy - sz/2, sz, sz);
    } else if (e.type === 'rejuv') {
      fill('#ffff00');
      rect(sx - sz/2, sy - sz/6, sz, sz/3);
      rect(sx - sz/6, sy - sz/2, sz/3, sz);
    }
  }

  if (sentinel) {
    let sy = getScreenY(sentinel.z);
    let sz = Math.max(10, 50 / sentinel.z);
    fill('#ff00ff');
    noStroke();
    ellipse(sentinel.x, sy, sz * 3, sz);
  }

  for (let b of bullets) {
    let sx = getScreenX(b.lane, b.z);
    let sy = getScreenY(b.z);
    let sz = Math.max(4, 20 / b.z);
    
    noStroke();
    if (b.type === 'laser') {
      fill('#ffffff');
      rect(sx - sz/4, sy - sz, sz/2, sz*2);
    } else {
      fill('#ff8800');
      ellipse(sx, sy, sz, sz*1.5);
    }
  }

  // Player
  let px = getScreenX(playerLane, 1);
  let py = getScreenY(1);
  
  stroke('#ffff00');
  strokeWeight(2);
  noFill();
  beginShape();
  vertex(px - 15, py + 10);
  vertex(px - 8, py - 5);
  vertex(px + 8, py - 5);
  vertex(px + 15, py + 10);
  endShape(CLOSE);
  line(px - 8, py - 5, px - 8, py - 12);
  line(px + 8, py - 5, px + 8, py - 12);

  // --- Render HUD ---
  fill('#000000');
  noStroke();
  rect(0, 0, 400, 40);

  fill('#00ffff');
  for (let i = 0; i < lives; i++) {
    triangle(20 + i * 15, 25, 25 + i * 15, 15, 30 + i * 15, 25);
  }

  fill('#ff8800');
  for (let i = 0; i < torpedoes; i++) {
    rect(370 - i * 15, 15, 8, 12);
  }

  for (let i = 0; i < 15; i++) {
    if (i < saucersDestroyed) {
      fill('#ffffff');
      rect(100 + i * 13, 20, 8, 8);
    } else {
      fill('#000000');
      stroke('#ffffff');
      strokeWeight(1);
      rect(100 + i * 13, 20, 8, 8);
      noStroke();
    }
  }
}