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
let stars = [];

let gridOffset = 0;
let spawnTimer = 0;
let laserCooldown = 0;
let torpedoCooldown = 0;

let prevLeft = false;
let prevRight = false;
let prevUp = false;

const VP_X = 200;
const VP_Y = 100; 
const PLAYER_Y = 320;

function getScale(z) {
  return 1 / (1 + z * 0.08);
}

function getScreenY(z) {
  return VP_Y + (PLAYER_Y - VP_Y) * getScale(z);
}

function getScreenX(lane, z) {
  let bottomX = 200 + (lane - 2) * 80;
  return VP_X + (bottomX - VP_X) * getScale(z);
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

  stars = [];
  for (let i = 0; i < 40; i++) {
    stars.push({
      x: rng() * 400,
      y: rng() * 400,
      speed: 0.05 + rng() * 0.1
    });
  }
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
  spawnTimer = 60;
}

function draw() {
  background('#000000');

  // --- Render Starfield ---
  fill('#ffffff');
  noStroke();
  for (let s of stars) {
    if (gameState === 'PLAYING') {
      s.y += s.speed;
    }
    if (s.y > 400) {
      s.y = 0;
      s.x = rng() * 400;
    }
    rect(s.x, s.y, 1.5, 1.5);
  }
  
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
    laserCooldown = 20;
  }
  
  if (upDown && !prevUp && torpedoCooldown <= 0 && torpedoes > 0) {
    bullets.push({ type: 'torpedo', lane: playerLane, z: 1.0, prevZ: 1.0, active: true });
    torpedoes--;
    torpedoCooldown = 35;
  }

  if (laserCooldown > 0) laserCooldown--;
  if (torpedoCooldown > 0) torpedoCooldown--;
  
  prevLeft = leftDown;
  prevRight = rightDown;
  prevUp = upDown;

  // --- Update Grid ---
  let baseGridSpeed = 0.015 + (sector * 0.002);
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
        z: 45,
        prevZ: 45,
        speed: 0.025 + (sector * 0.005) + rng() * 0.01,
        active: true
      });
      spawnTimer = Math.max(60, 160 - sector * 10);
    }
    
    if (saucersDestroyed >= 15 && enemies.length === 0) {
      sentinel = {
        x: rng() > 0.5 ? 40 : 360,
        dir: 0,
        z: 40,
        speed: 0.8 + sector * 0.1
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
    b.z += (b.type === 'laser' ? 0.15 : 0.12);
  }

  // --- Collisions ---
  for (let b of bullets) {
    if (!b.active) continue;

    if (sentinel && b.type === 'torpedo') {
      if (b.prevZ <= sentinel.z && b.z >= sentinel.z) {
        let sy = getScreenY(sentinel.z);
        let bScale = getScale(sentinel.z);
        let bx = getScreenX(b.lane, sentinel.z);
        
        if (Math.abs(bx - sentinel.x) < 30) {
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

  bullets = bullets.filter(b => b.active && b.z < 60);
  enemies = enemies.filter(e => e.active && e.z > -1.0);

  // --- Render Grid ---
  stroke('#2288cc');
  for (let i = -2; i < 45; i++) {
    let z = (i * 2.0) - (gridOffset % 2.0);
    if (z > -2.0 && z < 70) {
      let sy = getScreenY(z);
      if (sy > VP_Y && sy < 400) { 
        let sx1 = getScreenX(-0.5, z);
        let sx2 = getScreenX(4.5, z);
        
        strokeWeight(2);
        line(sx1, sy, sx2, sy);
      }
    }
  }

  // --- Render Entities ---
  for (let e of enemies) {
    let sx = getScreenX(e.lane, e.z);
    let sy = getScreenY(e.z);
    let sz = Math.max(4, 12 * getScale(e.z));
    
    noStroke();
    if (e.type === 'saucer') {
      fill('#ffffff');
      beginShape();
      vertex(sx, sy - sz*0.6);
      vertex(sx + sz*0.8, sy);
      vertex(sx, sy + sz*0.6);
      vertex(sx - sz*0.8, sy);
      endShape(CLOSE);
      fill('#00ffff');
      circle(sx, sy, sz*0.4);
    } else if (e.type === 'debris') {
      fill('#cc6600');
      beginShape();
      vertex(sx - sz*0.6, sy - sz*0.6);
      vertex(sx + sz*0.5, sy - sz*0.8);
      vertex(sx + sz*0.7, sy + sz*0.5);
      vertex(sx - sz*0.5, sy + sz*0.7);
      endShape(CLOSE);
    } else if (e.type === 'rejuv') {
      fill('#ff3399');
      rect(sx - sz*0.6, sy - sz*0.2, sz*1.2, sz*0.4);
      rect(sx - sz*0.2, sy - sz*0.6, sz*0.4, sz*1.2);
    }
  }

  if (sentinel) {
    let sy = getScreenY(sentinel.z);
    let sz = Math.max(6, 15 * getScale(sentinel.z));
    fill('#aa00ff');
    noStroke();
    ellipse(sentinel.x, sy, sz*3, sz*1.2);
    fill('#ff00ff');
    ellipse(sentinel.x, sy, sz*1.5, sz*0.6);
  }

  for (let b of bullets) {
    let sx = getScreenX(b.lane, b.z);
    let sy = getScreenY(b.z);
    let sz = Math.max(2, 6 * getScale(b.z));
    
    noStroke();
    if (b.type === 'laser') {
      fill('#ffff00');
      rect(sx - sz/2, sy - sz, sz, sz*2);
    } else {
      fill('#00ffff');
      circle(sx, sy, sz*1.5);
      fill('#ffffff');
      circle(sx, sy, sz*0.8);
    }
  }

  // --- Render Player ---
  let px = getScreenX(playerLane, 0);
  let py = getScreenY(0);
  
  stroke('#FFFF00');
  strokeWeight(2);
  noFill();
  
  // Outer outline
  beginShape();
  vertex(px, py - 10);
  vertex(px + 8, py + 6);
  vertex(px + 4, py + 6);
  vertex(px + 3, py + 2);
  vertex(px - 3, py + 2);
  vertex(px - 4, py + 6);
  vertex(px - 8, py + 6);
  endShape(CLOSE);
  
  // Inner detail
  fill('#FFFF00');
  noStroke();
  rect(px - 1.5, py - 4, 3, 6);

  // --- Render HUD ---
  noStroke();
  fill('#33cc33');
  for (let i = 0; i < lives; i++) {
    rect(20 + i * 14, 15, 10, 10);
  }

  fill('#cc33cc');
  for (let i = 0; i < torpedoes; i++) {
    rect(370 - i * 14, 15, 10, 10);
  }

  for (let i = 0; i < 15; i++) {
    let w = 6;
    let h = 6;
    let spacing = 8;
    let startX = 200 - (15 * spacing) / 2;
    if (i < saucersDestroyed) {
      fill('#ffffff');
    } else {
      fill('#444444');
    }
    rect(startX + i * spacing, 17, w, h);
  }
}