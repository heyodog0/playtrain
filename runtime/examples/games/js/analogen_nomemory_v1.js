// analogen_nomemory_v1
// Faithful port of reference/analogen_nomemory_v1.html to the node-gym
// GAME_TEMPLATE contract. Only the following are changed vs. the HTML:
//   - mulberry32(seed) seeded RNG; every Math.random() -> rng()
//   - resetGame(seed) entrypoint (no START screen, no ENTER-to-restart)
//   - getGameState() returns { score, lives, gameState }
//   - No DOM (canvas.parent removed); no text rendering (HUD / overlays /
//     floating-text / GOLD-tile label) since text is unreadable at 64x64.
// All physics, tile sizes, entity sizes, map layout, spider behavior, drop
// behavior, inventory rendering, and animation logic are preserved verbatim.
//
// MONTEZUMA'S REVENGE - VISUAL AVATAR GAUNTLET
// 2 Doors (Red/Blue), 2 Spiders, 2 Swords (visuals), 1 Boots.
// Inventory OBSCURED: only IDs shown.
// Logic: Boots on feet, Sword in hand.

const TILE_SIZE = 32;
const ROWS = 14;
const COLS = 20;
const GRAVITY = 0.45;
const JUMP_FORCE = -9.8;
const WALK_SPEED = 3.5;
const DEATH_PENALTY = 5000;

const ROLE_RED_KEY  = 'RED_KEY';
const ROLE_BLUE_KEY = 'BLUE_KEY';
const ROLE_SWORD    = 'SWORD';
const ROLE_BOOTS    = 'BOOTS';
const ROLE_EMPTY    = 'EMPTY';
const ROLE_REWARD   = 'REWARD';
const ROLE_CURSE    = 'CURSE';

// 5 Visual Tool slots
const TOOL_VISUAL_IDS  = [6, 7, 12, 14, 17];
const VALUE_VISUAL_IDS = [8, 15];

let gameState = 'PLAYING';
let score = 0;
let lives = 3;
let inventoryQueue = [];
const MAX_INVENTORY = 2;
let persistentDrops = {};
let toolMapping = {};
let valueMapping = {};
let penaltyTimer = 0;
let spawnSafetyTimer = 0;
let killedEnemies = new Set();

let player = {
    x: 0, y: 0, vx: 0, vy: 0, w: 20, h: 28,
    grounded: false, climbing: false, direction: 1, animFrame: 0, coyoteFrames: 0,
};

let spiders = [];
let laserTimer = 0;
let mapData = [];

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
// REQUIRED: p5 lifecycle
// ============================================================
function setup() {
    createCanvas(COLS * TILE_SIZE, ROWS * TILE_SIZE);
    resetGame(0);
}

function draw() {
    background(0);
    updateGame();
    drawGame();
}

// ============================================================
// REQUIRED: RL interface
// ============================================================
function getGameState() {
    return { score: score, lives: lives, gameState: gameState };
}

function resetGame(seed) {
    rng = mulberry32(seed);
    score = 0;
    lives = 3;
    inventoryQueue = [];
    persistentDrops = { '0,0': [] };
    killedEnemies.clear();
    penaltyTimer = 0;
    spawnSafetyTimer = 0;
    laserTimer = 0;
    shuffleRoles();
    initRoom();
    resetPlayer();
    gameState = 'PLAYING';
}

// ============================================================
// Procedural setup (seeded)
// ============================================================
function shuffleRoles() {
    // Two Sword roles to match the two spiders.
    let toolRoles = [ROLE_RED_KEY, ROLE_BLUE_KEY, ROLE_BOOTS, ROLE_SWORD, ROLE_SWORD];
    for (let i = toolRoles.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [toolRoles[i], toolRoles[j]] = [toolRoles[j], toolRoles[i]];
    }
    toolMapping = {};
    TOOL_VISUAL_IDS.forEach((vid, index) => { toolMapping[vid] = toolRoles[index]; });

    let valueRoles = [ROLE_REWARD, ROLE_CURSE];
    if (rng() > 0.5) valueRoles.reverse();
    valueMapping = {};
    VALUE_VISUAL_IDS.forEach((vid, index) => { valueMapping[vid] = valueRoles[index]; });
}

function initRoom() {
    mapData = [
        [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
        [1,1,1,1,1,1,0,0,0,0,11,11,1,1,1,1,1,1,1,1],
        [1,1,1,1,1,1,1,1,2,2,1,1,1,1,1,1,1,1,1,1],
        [1,1,1,1,1,1,4,4,4,4,1,1,1,1,1,1,1,1,1,1],
        [1,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,0,0,1],
        [1,1,1,1,1,1,5,5,5,5,1,1,1,1,1,1,1,1,1,1],
        [1,0,0,0,0,0,0,0,2,2,13,0,0,0,0,0,0,0,0,1],
        [1,1,1,1,1,1,1,1,10,10,1,1,1,1,1,1,1,1,1,1],
        [1,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,0,0,1],
        // Note: original HTML row has 21 entries; getTile() bounds-clamps so
        // the trailing element is unreachable. Preserved for fidelity.
        [1,1,1,1,1,1,1,1,13,2,2,1,1,1,1,1,1,1,1,1,1],
        [1,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,0,0,1],
        [1,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,0,0,1],
        [1,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,0,0,1],
        [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    ];

    let spots = [
        {x: 2, y: 12}, {x: 4, y: 12}, {x: 6, y: 12}, {x: 13, y: 12},
        {x: 15, y: 12}, {x: 17, y: 12}, {x: 3, y: 11}, {x: 16, y: 11},
    ];
    for (let i = spots.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [spots[i], spots[j]] = [spots[j], spots[i]];
    }

    TOOL_VISUAL_IDS.forEach((vid) => {
        let spot = spots.pop();
        mapData[spot.y][spot.x] = vid;
    });

    while (spots.length > 0) {
        let spot = spots.pop();
        mapData[spot.y][spot.x] = VALUE_VISUAL_IDS[rng() > 0.5 ? 0 : 1];
    }
}

function spawnEnemies() {
    spiders = [];
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            if (mapData[y][x] === 13) {
                let id = `0,0_${x}_${y}`;
                if (!killedEnemies.has(id)) {
                    spiders.push({ x: x * TILE_SIZE, y: y * TILE_SIZE + 4, speed: 1.2, w: 28, h: 24, id: id });
                }
            }
        }
    }
}

function resetPlayer() {
    player.x = width / 2 - player.w / 2;
    player.y = (13 * TILE_SIZE) - player.h - 5;
    player.vx = 0; player.vy = 0;
    player.climbing = false; player.grounded = true;
    spawnSafetyTimer = 60;
    spawnEnemies();
}

// ============================================================
// Update
// ============================================================
function updateGame() {
    if (gameState !== 'PLAYING') return;
    if (penaltyTimer > 0) penaltyTimer--;
    if (spawnSafetyTimer > 0) spawnSafetyTimer--;
    handleInput();
    applyPhysics();
    updateDroppedItems();
    checkCollisions();
    updateHazards();
}

function handleInput() {
    player.vx = 0;
    let tx = Math.floor((player.x + player.w / 2) / TILE_SIZE);
    let ty = Math.floor((player.y + player.h / 2) / TILE_SIZE);
    let tyBelow = Math.floor((player.y + player.h + 2) / TILE_SIZE);
    let overLadder = getTile(tx, ty) === 2 || getTile(tx, Math.floor((player.y + player.h - 1) / TILE_SIZE)) === 2;
    let standingOnLadder = getTile(tx, tyBelow) === 2;

    if (keyIsDown(LEFT_ARROW))      { player.vx = -WALK_SPEED; player.direction = -1; }
    else if (keyIsDown(RIGHT_ARROW)) { player.vx =  WALK_SPEED; player.direction =  1; }

    if (overLadder || (standingOnLadder && keyIsDown(DOWN_ARROW))) {
        if (keyIsDown(UP_ARROW)) {
            player.climbing = true; player.vy = -WALK_SPEED;
            player.x = lerp(player.x, (tx * TILE_SIZE) + (TILE_SIZE - player.w) / 2, 0.3);
        } else if (keyIsDown(DOWN_ARROW)) {
            player.climbing = true; player.vy = WALK_SPEED;
            player.x = lerp(player.x, (tx * TILE_SIZE) + (TILE_SIZE - player.w) / 2, 0.3);
            if (!overLadder && standingOnLadder) player.y += 4;
        } else if (player.climbing) {
            player.vy = 0;
        }
    } else {
        player.climbing = false;
    }

    if (player.vx !== 0 || (player.climbing && player.vy !== 0)) {
        if (frameCount % 8 === 0) player.animFrame = (player.animFrame + 1) % 2;
    }
    if (!player.climbing && keyIsDown(UP_ARROW) && (player.grounded || player.coyoteFrames > 0)) {
        player.vy = JUMP_FORCE; player.grounded = false; player.coyoteFrames = 0;
    }
}

function applyPhysics() {
    if (!player.climbing) player.vy += GRAVITY;
    player.x += player.vx; player.y += player.vy;
    if (player.vy > 12) player.vy = 12;
    if (player.grounded) player.coyoteFrames = 8; else player.coyoteFrames--;
}

function updateDroppedItems() {
    let drops = persistentDrops['0,0'];
    if (!drops) return;
    for (let i = drops.length - 1; i >= 0; i--) {
        let d = drops[i];
        if (d.cooldown > 0) d.cooldown--;
        if (d.cooldown <= 0 && rectIntersect(player.x, player.y, player.w, player.h, d.x - 12, d.y - 12, 24, 24)) {
            drops.splice(i, 1);
            addItem(d.role, d.visualId);
        }
    }
}

function checkCollisions() {
    player.grounded = false;
    let left = Math.floor(player.x / TILE_SIZE), right = Math.floor((player.x + player.w) / TILE_SIZE);
    let top = Math.floor(player.y / TILE_SIZE), bottom = Math.floor((player.y + player.h) / TILE_SIZE);
    for (let i = left; i <= right; i++) {
        for (let j = top; j <= bottom; j++) {
            let tile = getTile(i, j);
            if (TOOL_VISUAL_IDS.includes(tile)) {
                let role = toolMapping[tile]; setTile(i, j, 0);
                if (role !== ROLE_EMPTY) addItem(role, tile);
                score += 500;
                return;
            }
            if (VALUE_VISUAL_IDS.includes(tile)) {
                let role = valueMapping[tile]; setTile(i, j, 0);
                if (role === ROLE_REWARD) { score += 1000; }
                else if (role === ROLE_CURSE) { score -= 1000; penaltyTimer = 45; }
                return;
            }
            if (tile === 11) { handleVictory(); return; }
            if (tile === 4 && hasItem(ROLE_RED_KEY))  { clearDoor(4); consumeItem(ROLE_RED_KEY);  return; }
            if (tile === 5 && hasItem(ROLE_BLUE_KEY)) { clearDoor(5); consumeItem(ROLE_BLUE_KEY); return; }
            if (player.climbing) {
                if ((tile === 1 && j > 0) || tile === 4 || tile === 5) resolveCollision(i, j, tile);
                continue;
            }
            if (tile === 1 || tile === 4 || tile === 5 || tile === 3 || tile === 2) resolveCollision(i, j, tile);
        }
    }
}

function handleVictory() { score += 50000 + (lives * 10000); gameState = 'WIN'; }

function resolveCollision(tx, ty, type) {
    let tileX = tx * TILE_SIZE, tileY = ty * TILE_SIZE;
    if (type === 3 || type === 2) {
        if (player.vy >= 0 && (player.y + player.h) <= tileY + 12 && (player.y + player.h) >= tileY) {
            player.y = tileY - player.h; player.vy = 0; player.grounded = true;
        }
        return;
    }
    let dx = (player.x + player.w / 2) - (tileX + TILE_SIZE / 2);
    let dy = (player.y + player.h / 2) - (tileY + TILE_SIZE / 2);
    if (Math.abs(dx) > Math.abs(dy)) {
        if (dx > 0) player.x = tileX + TILE_SIZE; else player.x = tileX - player.w;
    } else {
        if (dy > 0) { player.y = tileY + TILE_SIZE; player.vy = 0; }
        else        { player.y = tileY - player.h; player.vy = 0; player.grounded = true; }
    }
}

function clearDoor(type) {
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) if (mapData[y][x] === type) mapData[y][x] = 0;
    }
}

function updateHazards() {
    if (spawnSafetyTimer > 0) return;
    laserTimer = (laserTimer + 1) % 120;
    let hasBoots = hasItem(ROLE_BOOTS);
    if (laserTimer < 60 && !hasBoots) {
        let tx = Math.floor((player.x + player.w / 2) / TILE_SIZE);
        let ty = Math.floor((player.y + player.h / 2) / TILE_SIZE);
        if (getTile(tx, ty) === 10) { die(); return; }
    }
    for (let i = spiders.length - 1; i >= 0; i--) {
        let s = spiders[i];
        if (player.x < s.x) s.x -= s.speed;
        else if (player.x > s.x) s.x += s.speed;
        if (rectIntersect(player.x, player.y, player.w, player.h, s.x, s.y, s.w, s.h)) {
            if (hasBoots && player.vy > 0 && player.y + player.h < s.y + s.h / 2) {
                player.vy = -7; score += 1000; killedEnemies.add(s.id); spiders.splice(i, 1);
            } else if (hasItem(ROLE_SWORD)) {
                consumeItem(ROLE_SWORD); score += 1000; killedEnemies.add(s.id); spiders.splice(i, 1);
            } else {
                die();
                return;
            }
        }
    }
}

function die() {
    score = Math.max(0, score - DEATH_PENALTY); lives--;
    if (lives <= 0) gameState = 'GAMEOVER'; else resetPlayer();
}

// ============================================================
// Helpers
// ============================================================
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

function hasItem(role) { return inventoryQueue.some(item => item.role === role); }

function consumeItem(role) {
    const idx = inventoryQueue.findIndex(item => item.role === role);
    if (idx !== -1) { inventoryQueue.splice(idx, 1); return true; }
    return false;
}

function addItem(role, visualId) {
    if (inventoryQueue.length >= MAX_INVENTORY) {
        let dropped = inventoryQueue.shift();
        persistentDrops['0,0'].push({
            x: player.x + 10, y: player.y + 14,
            role: dropped.role, visualId: dropped.visualId, cooldown: 45,
        });
    }
    inventoryQueue.push({ role: role, visualId: visualId });
}

// ============================================================
// Render (faithful to the HTML; text-rendering removed for the agent obs)
// ============================================================
function drawGame() {
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) drawTile(x * TILE_SIZE, y * TILE_SIZE, mapData[y][x]);
    }
    let drops = persistentDrops['0,0'];
    for (let d of drops) {
        if (!(d.cooldown > 0 && frameCount % 10 < 5)) drawToolVisual(d.visualId, d.x, d.y);
    }
    for (let sp of spiders) drawSpider(sp.x, sp.y);
    drawPlayer(player.x, player.y);
}

function drawTile(x, y, type) {
    if (type === 1) {
        fill(80, 40, 0); rect(x, y, 32, 32);
        stroke(0, 40); line(x, y + 16, x + 32, y + 16); noStroke();
    } else if (type === 2) {
        fill(255, 255, 150);
        rect(x + 10, y, 2, 32); rect(x + 20, y, 2, 32);
        for (let i = 4; i < 32; i += 8) rect(x + 10, y + i, 10, 2);
    } else if (type === 4) {
        fill(200, 0, 0); rect(x + 2, y, 28, 32);
        fill(255, 255, 0); ellipse(x + 16, y + 16, 6);
    } else if (type === 5) {
        fill(0, 80, 200); rect(x + 2, y, 28, 32);
        fill(255, 255, 0); ellipse(x + 16, y + 16, 6);
    } else if (TOOL_VISUAL_IDS.includes(type)) {
        drawToolVisual(type, x + 16, y + 16);
    } else if (VALUE_VISUAL_IDS.includes(type)) {
        drawValueVisual(type, x + 16, y + 16);
    } else if (type === 10) {
        let active = laserTimer < 60 && !hasItem(ROLE_BOOTS);
        fill(active ? color(255, 255, 0) : color(40));
        rect(x, y + 14, 32, 4);
    } else if (type === 11) {
        // Original drew the word "GOLD" here; text is unreadable at 64x64 so
        // we render the goal as a solid gold tile (color encodes meaning).
        fill(255, 215, 0); rect(x, y, 32, 32);
    }
}

function getItemColor(vid) {
    if (vid === 6)  return color(255, 0, 0);
    if (vid === 7)  return color(0, 150, 255);
    if (vid === 17) return color(0, 150, 0);
    if (vid === 12) return color(200);
    if (vid === 14) return color(150, 0, 255);
    return color(255);
}

function drawToolVisual(id, x, y) {
    let c = getItemColor(id); fill(c);
    if (id === 6 || id === 7 || id === 17) {
        ellipse(x, y - 4, 10);
        rect(x - 2, y - 4, 4, 12);
    } else if (id === 12) {
        push();
        translate(x, y); rotate(PI / 4);
        rect(-2, -10, 4, 16);
        fill(150, 75, 0); rect(-6, 6, 12, 3);
        pop();
    } else if (id === 14) {
        rect(x - 8, y - 8, 12, 8, 2);
        rect(x - 8, y, 18, 6, 2);
    }
}

function drawValueVisual(id, x, y) {
    if (id === 8) {
        fill(255, 255, 0); ellipse(x, y, 14);
        fill(255, 150, 0); ellipse(x, y, 8);
    } else if (id === 15) {
        fill(40);
        beginShape();
        vertex(x, y - 12); vertex(x + 10, y); vertex(x, y + 12); vertex(x - 10, y);
        endShape(CLOSE);
        fill(150, 0, 255); ellipse(x, y, 6);
    }
}

function drawSpider(x, y) {
    fill(100, 200, 100); ellipse(x + 14, y + 12, 16, 12);
    stroke(100, 200, 100); strokeWeight(2);
    for (let i = -1; i <= 1; i += 0.6) {
        line(x + 14, y + 12, x + 14 + i * 15, y + 2);
        line(x + 14, y + 12, x + 14 + i * 15, y + 22);
    }
    noStroke();
    fill(0); ellipse(x + 10, y + 10, 3); ellipse(x + 18, y + 10, 3);
}

function drawPlayer(x, y) {
    push();
    translate(x + player.w / 2, y + player.h / 2);
    if (player.direction === -1) scale(-1, 1);
    let isCursed = (penaltyTimer > 0 && penaltyTimer % 4 < 2);
    fill(isCursed ? 100 : 255, isCursed ? 100 : 200, 0); rect(-10, -18, 20, 8);
    fill(isCursed ? 150 : 255, 224, 189);                  rect(-8, -10, 16, 10);
    fill(200, 0, 0);                                        rect(-10, 0, 20, 10);

    inventoryQueue.forEach((item, idx) => {
        if (item.role === ROLE_BOOTS) {
            if      (item.visualId === 6)  fill(255, 0, 0);
            else if (item.visualId === 7)  fill(0, 150, 255);
            else if (item.visualId === 12) fill(200);
            else if (item.visualId === 14) fill(150, 0, 255);
            else if (item.visualId === 17) fill(0, 150, 0);
            else                            fill(255);
            rect(-8, 10, 6, 8); rect(2, 10, 6, 8);
        } else if (item.role === ROLE_SWORD) {
            push(); translate(12, 0); rotate(PI / 6); drawToolVisual(item.visualId, 0, 0); pop();
        } else {
            push(); scale(0.6); translate(-12 + (idx * 10), 10); drawToolVisual(item.visualId, 0, 0); pop();
        }
    });
    pop();
}

// Runtime calls resetGame() directly — no ENTER-to-restart needed.
function keyPressed() {}
