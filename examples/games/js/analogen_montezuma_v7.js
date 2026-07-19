// analogen_montezuma_v7
// A faithful clone of Montezuma's Revenge ROOM 1 (the starting chamber), ported
// to the node-gym GAME_TEMPLATE contract. Built on the proven tile-platformer
// engine from analogen_nomemory_v1 (gravity / jump / ladder-climb / tile
// collision), scaled to a 16x16 tile room (256x256 -> 64x64 obs at 4:1).
//
// Faithful room-1 layout & mechanics:
//   - Panama Joe spawns on the central start platform.
//   - A center ladder descends from the start platform to the bottom floor.
//   - The bottom floor runs the full width; the rolling SKULL bounces along it
//     left<->right at constant speed (it does NOT track you, and it cannot be
//     killed in room 1 — you avoid it or jump over it; contact is lethal).
//   - The KEY sits on the lower-left of the floor.
//   - Two side ladders (left & right) climb from the floor to the top platforms.
//   - Two DOORS sit at the top-left and top-right. Reaching a door WITH the key
//     opens it and escapes the room (win).
//   - No lava, no sword, no torch in room 1 — those belong to later chambers.
//
// Loop: descend center ladder -> cross the floor past the skull -> grab the key
// (lower-left) -> climb the left side ladder -> enter the top-left door. (The
// right side is symmetric.)
//
// node-gym contract: seeded resetGame(seed) varies the skull's start side/phase;
// the room geometry is fixed (faithful). getGameState() returns {score, lives,
// gameState}. No text rendering (unreadable at 64x64).
//
// Score: +500 key, door-with-key = +50000 + lives*10000 (win), -5000 death.
// Controls: LEFT/RIGHT walk, UP/DOWN climb on a ladder, UP jumps when grounded
// (off a ladder) — same dual-use UP as v1. Discrete(5): NOOP/LEFT/RIGHT/UP/DOWN.

const TILE_SIZE = 16;
const ROWS = 16;
const COLS = 16;
const GRAVITY = 0.25;
const JUMP_FORCE = -5.0;
const WALK_SPEED = 1.8;
const MAX_VY = 6;
const DEATH_PENALTY = 5000;

let gameState = 'PLAYING';
let score = 0;
let lives = 3;
let hasKey = false;
let spawnSafetyTimer = 0;

let player = {
    x: 0, y: 0, vx: 0, vy: 0, w: 10, h: 14,
    grounded: false, climbing: false, direction: 1, coyoteFrames: 0,
};

let skull = null;
let mapData = [];

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

function setup() {
    createCanvas(COLS * TILE_SIZE, ROWS * TILE_SIZE);
    noStroke();
    resetGame(0);
}

function draw() {
    background(0);
    if (gameState === 'PLAYING') updateGame();
    drawGame();
}

function getGameState() {
    return { score: score, lives: lives, gameState: gameState };
}

function resetGame(seed) {
    rng = mulberry32(seed);
    score = 0;
    lives = 3;
    hasKey = false;
    spawnSafetyTimer = 0;
    gameState = 'PLAYING';
    initRoom();
    resetPlayer();
}

function initRoom() {
    // Tiles: 0 empty, 1 brick (solid), 2 ladder, 4 door, 6 key, 13 skull spawn.
    // Room 1: central start platform (r4, cols 5-10, ladder gap at col7), a
    // center ladder (col7) down to the floor, two side ladders (col3 left,
    // col12 right) from the floor up to the top platforms (r2), two doors
    // (r1, cols 1 & 14) on those platforms, the key (lower-left, r12 col2), and
    // the rolling skull on the floor.
    mapData = [
        [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],   // r0  ceiling
        [1,4,0,0,0,0,0,0,0,0,0,0,0,0,4,1],   // r1  doors (L col1, R col14)
        [1,1,1,2,0,0,0,0,0,0,0,0,2,1,1,1],   // r2  top platforms + side-ladder tops
        [1,0,0,2,0,0,0,0,0,0,0,0,2,0,0,1],   // r3
        [1,0,0,2,0,1,1,2,1,1,1,0,2,0,0,1],   // r4  start platform (col7 = ladder gap)
        [1,0,0,2,0,0,0,2,0,0,0,0,2,0,0,1],   // r5
        [1,0,0,2,0,0,0,2,0,0,0,0,2,0,0,1],   // r6
        [1,0,0,2,0,0,0,2,0,0,0,0,2,0,0,1],   // r7
        [1,0,0,2,0,0,0,2,0,0,0,0,2,0,0,1],   // r8
        [1,0,0,2,0,0,0,2,0,0,0,0,2,0,0,1],   // r9
        [1,0,0,2,0,0,0,2,0,0,0,0,2,0,0,1],   // r10
        [1,0,0,2,0,0,0,2,0,0,0,0,2,0,0,1],   // r11
        [1,0,6,2,0,0,0,2,0,0,0,0,2,0,0,1],   // r12  key (col2); skull rolls here
        [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],   // r13  bottom floor
        [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],   // r14
        [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],   // r15
    ];

    // Skull bounces along the floor between the side walls. Seed its start side
    // + phase so episodes differ while the room stays faithful/fixed.
    const dir = rng() > 0.5 ? 1 : -1;
    const startX = (dir > 0 ? 2 : 13) * TILE_SIZE + rng() * 4 * TILE_SIZE;
    skull = { x: startX, y: 12 * TILE_SIZE + 3, w: 14, h: 13, speed: 0.7, dir };
}

function resetPlayer() {
    // Stand on the central start platform (col 8, on top of r4).
    player.x = 8 * TILE_SIZE + (TILE_SIZE - player.w) / 2;
    player.y = 4 * TILE_SIZE - player.h;
    player.vx = 0; player.vy = 0;
    player.climbing = false; player.grounded = true;
    spawnSafetyTimer = 45;
}

// ---------------- update ----------------

function updateGame() {
    if (spawnSafetyTimer > 0) spawnSafetyTimer--;
    handleInput();
    applyPhysics();
    checkCollisions();
    updateSkull();
}

function handleInput() {
    player.vx = 0;
    const tx = Math.floor((player.x + player.w / 2) / TILE_SIZE);
    const ty = Math.floor((player.y + player.h / 2) / TILE_SIZE);
    const tyBelow = Math.floor((player.y + player.h + 2) / TILE_SIZE);
    const overLadder = getTile(tx, ty) === 2 ||
                       getTile(tx, Math.floor((player.y + player.h - 1) / TILE_SIZE)) === 2;
    const standingOnLadder = getTile(tx, tyBelow) === 2;

    if (keyIsDown(LEFT_ARROW))       { player.vx = -WALK_SPEED; player.direction = -1; }
    else if (keyIsDown(RIGHT_ARROW)) { player.vx =  WALK_SPEED; player.direction =  1; }

    if (overLadder || (standingOnLadder && keyIsDown(DOWN_ARROW))) {
        if (keyIsDown(UP_ARROW)) {
            player.climbing = true; player.vy = -WALK_SPEED;
            player.x = lerp(player.x, tx * TILE_SIZE + (TILE_SIZE - player.w) / 2, 0.3);
        } else if (keyIsDown(DOWN_ARROW)) {
            player.climbing = true; player.vy = WALK_SPEED;
            player.x = lerp(player.x, tx * TILE_SIZE + (TILE_SIZE - player.w) / 2, 0.3);
            if (!overLadder && standingOnLadder) player.y += 3;
        } else if (player.climbing) {
            player.vy = 0;
        }
    } else {
        player.climbing = false;
    }

    if (!player.climbing && keyIsDown(UP_ARROW) && (player.grounded || player.coyoteFrames > 0)) {
        player.vy = JUMP_FORCE; player.grounded = false; player.coyoteFrames = 0;
    }
}

function applyPhysics() {
    if (!player.climbing) player.vy += GRAVITY;
    player.x += player.vx; player.y += player.vy;
    if (player.vy > MAX_VY) player.vy = MAX_VY;
    if (player.grounded) player.coyoteFrames = 6; else player.coyoteFrames--;
}

function checkCollisions() {
    player.grounded = false;
    const left = Math.floor(player.x / TILE_SIZE);
    const right = Math.floor((player.x + player.w) / TILE_SIZE);
    const top = Math.floor(player.y / TILE_SIZE);
    const bottom = Math.floor((player.y + player.h) / TILE_SIZE);
    for (let i = left; i <= right; i++) {
        for (let j = top; j <= bottom; j++) {
            const tile = getTile(i, j);
            if (tile === 6) {                       // key pickup
                setTile(i, j, 0); hasKey = true; score += 500; return;
            }
            if (tile === 4) {                       // door
                if (hasKey) { handleVictory(); return; }
                resolveCollision(i, j, tile);       // locked = solid
                continue;
            }
            if (player.climbing) {
                if (tile === 1 && j > 0) resolveCollision(i, j, tile);
                continue;
            }
            if (tile === 1 || tile === 2) resolveCollision(i, j, tile);
        }
    }
}

function handleVictory() { score += 50000 + lives * 10000; gameState = 'WIN'; }

function resolveCollision(tx, ty, type) {
    const tileX = tx * TILE_SIZE, tileY = ty * TILE_SIZE;
    if (type === 2) {
        // Ladder = one-way platform: land on top only when falling onto it.
        if (player.vy >= 0 && (player.y + player.h) <= tileY + 6 && (player.y + player.h) >= tileY) {
            player.y = tileY - player.h; player.vy = 0; player.grounded = true;
        }
        return;
    }
    const dx = (player.x + player.w / 2) - (tileX + TILE_SIZE / 2);
    const dy = (player.y + player.h / 2) - (tileY + TILE_SIZE / 2);
    if (Math.abs(dx) > Math.abs(dy)) {
        if (dx > 0) player.x = tileX + TILE_SIZE; else player.x = tileX - player.w;
    } else {
        if (dy > 0) { player.y = tileY + TILE_SIZE; player.vy = 0; }
        else        { player.y = tileY - player.h; player.vy = 0; player.grounded = true; }
    }
}

function updateSkull() {
    if (spawnSafetyTimer > 0) return;
    skull.x += skull.speed * skull.dir;
    const minX = 1 * TILE_SIZE, maxX = (COLS - 1) * TILE_SIZE - skull.w;
    if (skull.x < minX) { skull.x = minX; skull.dir = 1; }
    if (skull.x > maxX) { skull.x = maxX; skull.dir = -1; }
    if (rectIntersect(player.x, player.y, player.w, player.h, skull.x, skull.y, skull.w, skull.h)) {
        die();
    }
}

function die() {
    score = Math.max(0, score - DEATH_PENALTY);
    lives--;
    if (lives <= 0) gameState = 'GAMEOVER';
    else            resetPlayer();   // keep the key if already collected
}

// ---------------- helpers ----------------

function getTile(x, y) {
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return 1;
    return mapData[y][x];
}
function setTile(x, y, v) {
    if (x >= 0 && x < COLS && y >= 0 && y < ROWS) mapData[y][x] = v;
}
function rectIntersect(x1, y1, w1, h1, x2, y2, w2, h2) {
    return x2 < x1 + w1 && x2 + w2 > x1 && y2 < y1 + h1 && y2 + h2 > y1;
}

// ---------------- render (flat Atari look) ----------------

function drawGame() {
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) drawTile(x * TILE_SIZE, y * TILE_SIZE, mapData[y][x]);
    }
    drawSkull(skull.x, skull.y);
    drawPlayer(player.x, player.y);
}

function drawTile(x, y, type) {
    if (type === 1) {
        fill(160, 88, 36); rect(x, y, TILE_SIZE, TILE_SIZE);
        fill(120, 60, 22); rect(x, y + TILE_SIZE - 2, TILE_SIZE, 2);
    } else if (type === 2) {
        fill(214, 184, 120);
        rect(x + 3, y, 2, TILE_SIZE); rect(x + TILE_SIZE - 5, y, 2, TILE_SIZE);
        for (let i = 3; i < TILE_SIZE; i += 6) rect(x + 3, y + i, TILE_SIZE - 6, 2);
    } else if (type === 4) {
        // Door: teal panel with a frame + knob. (Open doors are just removed.)
        fill(48, 160, 140); rect(x + 2, y - TILE_SIZE + 2, TILE_SIZE - 4, TILE_SIZE * 2 - 4);
        fill(28, 110, 96);
        rect(x + 4, y - TILE_SIZE + 2, 2, TILE_SIZE * 2 - 4);
        rect(x + TILE_SIZE - 6, y - TILE_SIZE + 2, 2, TILE_SIZE * 2 - 4);
        fill(230, 210, 90); rect(x + TILE_SIZE - 7, y - 4, 3, 3);   // knob
    } else if (type === 6) {
        drawKey(x + TILE_SIZE / 2, y + TILE_SIZE / 2);
    }
}

function drawKey(cx, cy) {
    fill(232, 196, 60);
    ellipse(cx - 3, cy - 2, 7, 7);            // bow
    fill(0);     ellipse(cx - 3, cy - 2, 3, 3);
    fill(232, 196, 60);
    rect(cx - 1, cy - 1, 7, 2);               // shaft
    rect(cx + 4, cy + 1, 2, 3); rect(cx + 1, cy + 1, 2, 2);   // teeth
}

function drawSkull(x, y) {
    // Flat white rolling skull: cranium + dark eyes + jaw teeth.
    fill(232);
    rect(x + 1, y, 12, 10);
    rect(x + 2, y + 10, 10, 3);
    fill(20);
    rect(x + 3, y + 3, 3, 3); rect(x + 8, y + 3, 3, 3);   // eyes
    rect(x + 6, y + 7, 2, 2);                              // nose
    fill(232);
    for (let i = 0; i < 4; i++) rect(x + 2 + i * 3, y + 11, 1, 2);   // teeth gaps
}

function drawPlayer(x, y) {
    push();
    translate(x + player.w / 2, y + player.h / 2);
    if (player.direction === -1) scale(-1, 1);
    // Panama Joe: flesh head, white shirt, blue legs (flat blocks).
    fill(240, 205, 160); rect(-5, -7, 10, 4);    // head
    fill(235);           rect(-5, -3, 10, 5);     // shirt
    fill(60, 70, 190);   rect(-5, 2, 4, 5); rect(1, 2, 4, 5);   // legs
    // Key on the belt when held (so possession is pixel-visible).
    if (hasKey) { fill(232, 196, 60); rect(3, -1, 4, 3); }
    pop();
}

function keyPressed() {}
