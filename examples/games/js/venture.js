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
  lives = 3;
  gameState = 'PLAYING';
  level = 1;
  generateLevel();
}

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
// GAME STATE & GLOBALS
// ============================================================

let score = 0;
let lives = 3;
let gameState = 'PLAYING';
let scaleMode = 'OVERWORLD'; 
let currentRoomIdx = -1;
let level = 1;
let lingerTimer = 0;

let player, arrow, roomHm;
let rooms = [];
let hallmonsters = [];

const overworldWalls = [
  {x:0, y:0, w:400, h:20},
  {x:0, y:380, w:400, h:20},
  {x:0, y:0, w:20, h:400},
  {x:380, y:0, w:20, h:400},
  {x:60, y:60, w:100, h:100},
  {x:240, y:60, w:100, h:100},
  {x:60, y:240, w:100, h:100},
  {x:240, y:240, w:100, h:100}
];

const doors = [
  { idx: 0, x: 160, y: 110, w: 10, h: 20, spawn: {x: 360, y: 200}, exit: {x: 175, y: 110} },
  { idx: 1, x: 230, y: 110, w: 10, h: 20, spawn: {x: 40, y: 200}, exit: {x: 215, y: 110} },
  { idx: 2, x: 110, y: 230, w: 20, h: 10, spawn: {x: 200, y: 40}, exit: {x: 110, y: 215} },
  { idx: 3, x: 290, y: 230, w: 20, h: 10, spawn: {x: 200, y: 40}, exit: {x: 290, y: 215} }
];

function generateLevel() {
  scaleMode = 'OVERWORLD';
  currentRoomIdx = -1;
  
  player = { x: 196, y: 196, w: 8, h: 8, speed: 3, lastDir: {x: 1, y: 0}, spaceWasDown: false };
  arrow = { active: false, x: 0, y: 0, w: 4, h: 4, vx: 0, vy: 0, speed: 6 };
  roomHm = null;

  rooms = [];
  for (let i = 0; i < 4; i++) {
    let walls = [
      {x:0, y:0, w:400, h:20},
      {x:0, y:380, w:400, h:20},
      {x:0, y:0, w:20, h:400},
      {x:380, y:0, w:20, h:400}
    ];

    for (let j = 0; j < 3; j++) {
      walls.push({
        x: 40 + rng() * 280,
        y: 40 + rng() * 280,
        w: 20 + rng() * 40,
        h: 20 + rng() * 40
      });
    }

    let mSpeed = 1.5 + (level - 1) * 0.25;
    let monsters = [];
    for (let j = 0; j < 3; j++) {
      let mpos = getRandomEmptyPos(12, 12, walls, doors[i].spawn.x, doors[i].spawn.y, 100);
      monsters.push({
        x: mpos.x, y: mpos.y, w: 12, h: 12,
        startX: mpos.x, startY: mpos.y,
        alive: true, type: j % 3, speed: mSpeed,
        vx: 0, vy: 0, state: 'wait', timer: 30
      });
    }

    let tpos = getRandomEmptyPos(10, 10, walls, doors[i].spawn.x, doors[i].spawn.y, 100);
    rooms.push({
      idx: i,
      cleared: false,
      walls: walls,
      monsters: monsters,
      corpses: [],
      treasure: { x: tpos.x, y: tpos.y, w: 10, h: 10, collected: false }
    });
  }

  hallmonsters = [];
  let corners = [{x: 30, y: 30}, {x: 350, y: 30}, {x: 30, y: 350}];
  for (let i = 0; i < 3; i++) {
    hallmonsters.push({
      x: corners[i].x, y: corners[i].y, w: 10, h: 20,
      startX: corners[i].x, startY: corners[i].y,
      speed: 2 + (level - 1) * 0.2
    });
  }
}

function collide(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function getRandomEmptyPos(w, h, walls, avoidX, avoidY, avoidRadius) {
  for (let i = 0; i < 100; i++) {
    let x = 20 + rng() * (360 - w);
    let y = 20 + rng() * (360 - h);
    let box = {x, y, w, h};
    let overlap = false;
    for (let wall of walls) {
      if (collide(box, wall)) { overlap = true; break; }
    }
    if (!overlap) {
      let dist = Math.hypot((x + w/2) - avoidX, (y + h/2) - avoidY);
      if (dist > avoidRadius) return {x, y};
    }
  }
  return {x: 200, y: 200};
}

function moveWithCollision(ent, dx, dy, walls) {
  ent.x += dx;
  for (let w of walls) {
    if (collide(ent, w)) {
      if (dx > 0) ent.x = w.x - ent.w;
      if (dx < 0) ent.x = w.x + w.w;
    }
  }
  ent.y += dy;
  for (let w of walls) {
    if (collide(ent, w)) {
      if (dy > 0) ent.y = w.y - ent.h;
      if (dy < 0) ent.y = w.y + w.h;
    }
  }
}

function die() {
  lives--;
  if (lives <= 0) {
    gameState = 'GAMEOVER';
    return;
  }
  if (scaleMode === 'ROOM') {
    let r = rooms[currentRoomIdx];
    player.x = doors[currentRoomIdx].spawn.x;
    player.y = doors[currentRoomIdx].spawn.y;
    player.lastDir = {x: 1, y: 0};
    arrow.active = false;
    for (let m of r.monsters) {
      m.x = m.startX;
      m.y = m.startY;
      m.state = 'wait';
      m.timer = 30;
    }
    lingerTimer = Math.max(180, 600 - (level - 1) * 60);
    roomHm = null;
  } else {
    player.x = 196;
    player.y = 196;
    player.lastDir = {x: 1, y: 0};
    for (let hm of hallmonsters) {
      hm.x = hm.startX;
      hm.y = hm.startY;
    }
  }
}

function updateGame() {
  if (gameState !== 'PLAYING') return;

  // Input
  let dx = 0, dy = 0;
  if (keyIsDown(37)) dx = -1;
  else if (keyIsDown(39)) dx = 1;
  else if (keyIsDown(38)) dy = -1;
  else if (keyIsDown(40)) dy = 1;

  if (dx !== 0 || dy !== 0) {
    player.lastDir = {x: dx, y: dy};
  }

  let spaceDown = keyIsDown(32);
  if (spaceDown && !player.spaceWasDown && !arrow.active && scaleMode === 'ROOM') {
    arrow.active = true;
    arrow.x = player.x + player.w/2 - arrow.w/2;
    arrow.y = player.y + player.h/2 - arrow.h/2;
    arrow.vx = player.lastDir.x * arrow.speed;
    arrow.vy = player.lastDir.y * arrow.speed;
  }
  player.spaceWasDown = spaceDown;

  let activeWalls = scaleMode === 'OVERWORLD' ? overworldWalls : rooms[currentRoomIdx].walls;
  moveWithCollision(player, dx * player.speed, dy * player.speed, activeWalls);

  if (scaleMode === 'OVERWORLD') {
    // Hallmonsters logic
    for (let hm of hallmonsters) {
      let hx = Math.sign(player.x - hm.x) * hm.speed;
      let hy = Math.sign(player.y - hm.y) * hm.speed;
      moveWithCollision(hm, hx, hy, overworldWalls);
      if (collide(player, hm)) {
        die();
        return;
      }
    }

    // Door logic
    for (let d of doors) {
      if (!rooms[d.idx].cleared && collide(player, d)) {
        scaleMode = 'ROOM';
        currentRoomIdx = d.idx;
        player.x = d.spawn.x;
        player.y = d.spawn.y;
        player.w = 12;
        player.h = 16;
        arrow.active = false;
        lingerTimer = Math.max(180, 600 - (level - 1) * 60);
        roomHm = null;
        break;
      }
    }
  } else {
    // ROOM logic
    let r = rooms[currentRoomIdx];

    lingerTimer--;
    if (lingerTimer <= 0 && !roomHm) {
      roomHm = {
        x: doors[currentRoomIdx].spawn.x,
        y: doors[currentRoomIdx].spawn.y,
        w: 10, h: 20, speed: 2 + (level - 1) * 0.2
      };
    }

    if (roomHm) {
      let hx = Math.sign(player.x - roomHm.x) * roomHm.speed;
      let hy = Math.sign(player.y - roomHm.y) * roomHm.speed;
      moveWithCollision(roomHm, hx, hy, r.walls);
      if (collide(player, roomHm)) {
        die();
        return;
      }
    }

    for (let c of r.corpses) {
      if (collide(player, c)) {
        die();
        return;
      }
    }

    for (let m of r.monsters) {
      if (!m.alive) continue;
      if (m.type === 0) { // Chase
        let mx = Math.sign(player.x - m.x) * m.speed;
        let my = Math.sign(player.y - m.y) * m.speed;
        moveWithCollision(m, mx, my, r.walls);
      } else if (m.type === 1) { // Patrol
        if (m.vx === 0 && m.vy === 0) m.vx = m.speed;
        let oldX = m.x;
        moveWithCollision(m, m.vx, 0, r.walls);
        if (m.x === oldX) m.vx *= -1;
      } else if (m.type === 2) { // Burst
        m.timer--;
        if (m.state === 'wait') {
          if (m.timer <= 0) {
            m.state = 'move';
            m.timer = 30 + rng() * 20;
            let dirs = [[1,0], [-1,0], [0,1], [0,-1]];
            let d = dirs[Math.floor(rng() * 4)];
            m.vx = d[0] * m.speed * 2;
            m.vy = d[1] * m.speed * 2;
          }
        } else {
          let oldX = m.x, oldY = m.y;
          moveWithCollision(m, m.vx, m.vy, r.walls);
          if (m.x === oldX && m.y === oldY) m.timer = 0;
          if (m.timer <= 0) {
            m.state = 'wait';
            m.timer = 30 + rng() * 40;
          }
        }
      }

      if (collide(player, m)) {
        die();
        return;
      }
    }

    if (arrow.active) {
      arrow.x += arrow.vx;
      arrow.y += arrow.vy;
      for (let w of r.walls) {
        if (collide(arrow, w)) { arrow.active = false; break; }
      }
      if (arrow.active) {
        for (let m of r.monsters) {
          if (m.alive && collide(arrow, m)) {
            arrow.active = false;
            m.alive = false;
            score += 50;
            r.corpses.push({x: m.x, y: m.y, w: 12, h: 12});
            break;
          }
        }
      }
    }

    if (!r.cleared && collide(player, r.treasure)) {
      r.treasure.collected = true;
      r.cleared = true;
      score += 200;
      
      scaleMode = 'OVERWORLD';
      player.x = doors[currentRoomIdx].exit.x;
      player.y = doors[currentRoomIdx].exit.y;
      player.w = 8;
      player.h = 8;

      let allCleared = true;
      for (let rm of rooms) if (!rm.cleared) allCleared = false;
      if (allCleared) {
        score += 500;
        level++;
        generateLevel();
      } else {
        let corners = [{x: 30, y: 30}, {x: 350, y: 30}, {x: 30, y: 350}];
        for (let i = 0; i < hallmonsters.length; i++) {
          hallmonsters[i].x = corners[i].x;
          hallmonsters[i].y = corners[i].y;
        }
      }
    }
  }
}

function draw() {
  updateGame();
  background(0);

  noStroke();
  
  if (scaleMode === 'OVERWORLD') {
    fill(0, 0, 150);
    for (let w of overworldWalls) {
      rect(w.x, w.y, w.w, w.h);
    }
    for (let d of doors) {
      if (rooms[d.idx].cleared) fill(40);
      else fill(150);
      rect(d.x, d.y, d.w, d.h);
    }
    
    fill(255, 0, 255);
    for (let hm of hallmonsters) {
      rect(hm.x, hm.y, hm.w, hm.h);
    }
    
    fill(255, 255, 0);
    rect(player.x, player.y, player.w, player.h);

  } else {
    let r = rooms[currentRoomIdx];
    
    fill(0, 0, 150);
    for (let w of r.walls) rect(w.x, w.y, w.w, w.h);
    
    if (!r.cleared) {
      fill(0, 255, 0);
      rect(r.treasure.x, r.treasure.y, r.treasure.w, r.treasure.h);
    }
    
    fill(100, 0, 0);
    for (let c of r.corpses) rect(c.x, c.y, c.w, c.h);
    
    fill(255, 0, 0);
    for (let m of r.monsters) {
      if (m.alive) rect(m.x, m.y, m.w, m.h);
    }
    
    if (roomHm) {
      fill(255, 0, 255);
      rect(roomHm.x, roomHm.y, roomHm.w, roomHm.h);
    }
    
    if (arrow.active) {
      fill(255);
      rect(arrow.x, arrow.y, arrow.w, arrow.h);
    }
    
    fill(0, 255, 255);
    rect(player.x, player.y, player.w, player.h);
  }

  fill(255, 255, 0);
  for (let i = 0; i < lives; i++) {
    rect(5 + i * 10, 5, 6, 6);
  }
}