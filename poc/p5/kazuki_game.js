/**
 * MONTEZUMA'S REVENGE - RL Randomized Edition
 * Fix: Changed file type to HTML to resolve the "react" block compilation error.
 * Feature: Keys now appear on the player's belt when held.
 */

const TILE_SIZE = 32;
const ROWS = 14;
const COLS = 20;
const GRAVITY = 0.45;
const JUMP_FORCE = -9.8;
const WALK_SPEED = 3.5;
const DEATH_PENALTY = 5000; 

const ROLE_RED_KEY = "RED_KEY";
const ROLE_BLUE_KEY = "BLUE_KEY";
const ROLE_SWORD = "SWORD";
const ROLE_BOOTS = "BOOTS";
const ROLE_REWARD = "REWARD";
const ROLE_CURSE = "CURSE";

const TOOL_VISUAL_IDS = [6, 7, 12, 14]; 
const VALUE_VISUAL_IDS = [8, 15];        

let gameState = 'START';
let currentRoom = { x: 1, y: 1 }; 
let score = 0;
let lives = 3;
let terminalBonus = 0;
let inventory = { redKey: 0, blueKey: 0, sword: 0, boots: 0 };

let toolMapping = {};  
let valueMapping = {}; 

let penaltyTimer = 0; 
let spawnSafetyTimer = 0; 
let floatingTexts = []; 
let killedSentinels = new Set();

let player = {
    x: 100, y: 100, vx: 0, vy: 0,
    w: 20, h: 28,
    grounded: false, climbing: false,
    direction: 1, animFrame: 0, coyoteFrames: 0
};

let skulls = [];
let spiders = [];
let sentinels = [];
let laserTimer = 0;
let rooms = {};

function setup() {
    const canvas = createCanvas(COLS * TILE_SIZE, ROWS * TILE_SIZE);
    canvas.parent('canvas-container');
    initPyramid();
    textFont('Courier New');
}

function shuffleRoles() {
    let toolRoles = [ROLE_RED_KEY, ROLE_BLUE_KEY, ROLE_SWORD, ROLE_BOOTS];
    for (let i = toolRoles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [toolRoles[i], toolRoles[j]] = [toolRoles[j], toolRoles[i]];
    }
    toolMapping = {};
    TOOL_VISUAL_IDS.forEach((vid, index) => { toolMapping[vid] = toolRoles[index]; });

    let valueRoles = [ROLE_REWARD, ROLE_CURSE];
    if (Math.random() > 0.5) valueRoles.reverse();
    valueMapping = {};
    VALUE_VISUAL_IDS.forEach((vid, index) => { valueMapping[vid] = valueRoles[index]; });
}

function initPyramid() {
    // Room 1,1: Start
    rooms["1,1"] = [
        [1,1,1,1,1,2,2,1,1,1,1,1,1,2,2,1,1,1,1,1],
        [1,0,0,0,0,2,2,0,0,0,0,0,0,2,2,0,0,0,0,1],
        [1,0,0,0,0,2,2,0,0,0,0,0,0,2,2,0,0,0,0,1],
        [1,3,3,3,3,2,2,3,3,3,3,3,3,2,2,3,3,3,3,1],
        [1,0,0,0,2,2,0,0,2,2,0,0,0,0,0,2,2,0,0,1],
        [0,0,0,0,2,2,0,0,2,2,0,0,0,0,0,2,2,0,0,0],
        [0,0,0,0,2,2,0,0,2,2,0,0,0,0,0,2,2,0,0,0],
        [1,3,3,3,3,3,3,0,2,2,0,0,3,3,3,3,3,3,1,1],
        [1,0,0,0,2,2,0,0,2,2,0,0,0,0,2,2,0,0,0,1],
        [1,0,0,0,2,2,0,10,2,2,10,0,0,0,2,2,0,0,0,1],
        [1,0,0,0,2,2,0,1,2,2,1,1,0,0,2,2,0,0,0,1],
        [1,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,1],
        [1,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,0,0,1],
        [1,1,1,1,1,1,1,1,2,2,1,1,1,1,1,1,1,1,1,1]
    ];

    // Room 0,1: Left (Hazardous, many items)
    // Shortcut hole at columns 11, 12 in Row 3
    rooms["0,1"] = [
        [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
        [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
        [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
        [1,3,3,3,3,3,3,3,3,3,3,0,0,3,3,3,3,3,0,1],
        [1,0,0,2,2,0,0,0,0,16,0,0,0,0,2,2,0,0,1,1], // Cleaned up right edge to allow exit
        [1,0,0,2,2,0,0,0,0,0,0,0,0,0,2,2,0,0,0,0],
        [1,0,0,2,2,0,0,3,3,3,3,3,0,0,2,2,0,0,0,0],
        [1,1,1,2,2,0,0,0,0,2,2,0,0,0,2,2,0,1,1,1],
        [1,0,0,2,2,13,0,0,0,2,2,0,0,0,13,2,2,0,0,1],
        [1,0,0,3,3,3,3,3,3,2,2,3,3,3,3,3,3,0,0,1],
        [1,0,0,0,0,0,0,9,0,2,2,0,0,0,0,0,0,0,0,1],
        [1,0,0,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,1],
        [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
        [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]
    ];

    // Room 2,1: Right
    rooms["2,1"] = [
        [1,1,1,1,1,1,1,1,5,5,1,1,1,1,1,1,1,1,1,1],
        [1,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,0,0,1],
        [1,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,0,0,1],
        [3,3,3,3,0,0,0,3,3,3,3,3,3,3,0,0,3,3,3,1],
        [0,0,0,2,2,0,0,0,2,2,0,0,0,0,0,0,0,2,2,1],
        [0,0,0,2,2,0,0,0,2,2,0,0,0,0,0,0,0,2,2,1],
        [0,0,0,2,2,0,0,0,2,2,0,0,0,0,0,0,0,2,2,1],
        [1,1,3,3,3,3,3,3,2,2,3,3,3,3,3,3,3,3,0,1],
        [1,0,0,0,2,2,0,0,2,2,0,13,0,0,2,2,0,0,1,1],
        [1,0,0,0,2,2,0,0,4,4,0,0,0,0,2,2,0,0,0,1],
        [1,0,0,0,2,2,0,0,4,4,0,0,0,0,2,2,0,0,0,1],
        [1,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,1],
        [1,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,0,0,1],
        [1,1,1,1,1,1,1,1,2,2,1,1,1,1,1,1,1,1,1,1]
    ];

    // Room 2,0: Treasure Room
    rooms["2,0"] = [
        [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
        [1,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,1],
        [1,1,1,1,1,1,1,1,4,4,1,1,1,1,1,1,1,1,1,1],
        [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
        [1,0,0,0,15,0,0,0,2,2,0,0,0,0,15,0,0,0,0,1],
        [1,3,3,3,3,3,3,3,2,2,3,3,3,3,3,3,3,3,3,1],
        [1,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,0,0,1],
        [1,0,10,0,10,0,10,0,2,2,0,0,10,0,10,0,10,0,0,1],
        [1,0,8,0,8,0,8,0,2,2,0,8,0,8,0,8,0,8,0,1],
        [1,3,3,3,3,3,3,3,2,2,3,3,3,3,3,3,3,3,3,1],
        [1,0,15,0,0,0,0,0,2,2,0,0,0,0,0,0,0,15,0,1],
        [1,1,1,1,1,1,1,1,2,2,1,1,1,1,1,1,1,1,1,1],
        [1,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,0,0,1],
        [1,1,1,1,1,1,1,1,2,2,1,1,1,1,1,1,1,1,1,1]
    ];

    distributeItemsRandomly();
}

function distributeItemsRandomly() {
    let validSpots = [];
    const searchableRooms = ["1,1", "0,1", "2,1"];

    searchableRooms.forEach(rk => {
        let grid = rooms[rk];
        for (let y = 1; y < ROWS - 1; y++) {
            for (let x = 1; x < COLS - 1; x++) {
                if (grid[y][x] === 0 && [1, 3, 2].includes(grid[y+1][x])) {
                    validSpots.push({ rk, x, y });
                }
            }
        }
    });

    for (let i = validSpots.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [validSpots[i], validSpots[j]] = [validSpots[j], validSpots[i]];
    }

    TOOL_VISUAL_IDS.forEach((vid, i) => {
        if (validSpots.length > 0) {
            let spot = validSpots.pop();
            rooms[spot.rk][spot.y][spot.x] = vid;
        }
    });

    for (let i = 0; i < 4; i++) {
        if (validSpots.length > 0) {
            let spot = validSpots.pop();
            rooms[spot.rk][spot.y][spot.x] = VALUE_VISUAL_IDS[0];
        }
        if (validSpots.length > 0) {
            let spot = validSpots.pop();
            rooms[spot.rk][spot.y][spot.x] = VALUE_VISUAL_IDS[1];
        }
    }
}

function spawnEnemies() {
    skulls = []; spiders = []; sentinels = [];
    let rk = `${currentRoom.x},${currentRoom.y}`;
    let data = rooms[rk];
    if (!data) return;
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            let tile = data[y][x];
            if (tile === 9) skulls.push({ x: x * TILE_SIZE, y: y * TILE_SIZE + 8, dir: 1, speed: 2.5, w: 24, h: 24 });
            if (tile === 13) spiders.push({ x: x * TILE_SIZE, y: y * TILE_SIZE + 4, speed: 1.2, w: 28, h: 24 });
            if (tile === 16) {
                let id = `${rk}_${x}_${y}`;
                if (!killedSentinels.has(id)) {
                    sentinels.push({ x: x * TILE_SIZE, y: y * TILE_SIZE, dir: 1, speed: 1.8, w: 32, h: 32, id: id });
                }
            }
        }
    }
}

function resetPlayerToRoom(rx, ry) {
    currentRoom.x = rx; currentRoom.y = ry;
    player.x = width / 2 - player.w / 2;
    player.y = (11 * TILE_SIZE) - player.h - 5;
    player.vx = 0; player.vy = 0; player.climbing = false; player.grounded = true;
    player.coyoteFrames = 0;
    spawnSafetyTimer = 60; penaltyTimer = 0;
    spawnEnemies();
}

function draw() {
    background(0);
    if (gameState === 'START') drawStartScreen();
    else {
        updateGame();
        drawGame();
        if (gameState === 'GAMEOVER') drawGameOver();
        if (gameState === 'EXIT') drawExit();
        if (gameState === 'WIN') drawWin();
    }
}

function updateGame() {
    if (gameState !== 'PLAYING') return;
    if (penaltyTimer > 0) penaltyTimer--;
    if (spawnSafetyTimer > 0) spawnSafetyTimer--;
    handleInput();
    applyPhysics();
    checkCollisions();
    updateHazards();
    checkRoomTransition();
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
        floatingTexts[i].y -= 1; floatingTexts[i].life--;
        if (floatingTexts[i].life <= 0) floatingTexts.splice(i, 1);
    }
}

function handleInput() {
    player.vx = 0;
    let tx = Math.floor((player.x + player.w/2) / TILE_SIZE);
    let ty = Math.floor((player.y + player.h/2) / TILE_SIZE);
    let overLadder = getTile(tx, ty) === 2 || getTile(tx, Math.floor((player.y + player.h - 1)/TILE_SIZE)) === 2 || getTile(tx, Math.floor((player.y + 1)/TILE_SIZE)) === 2;

    if (keyIsDown(LEFT_ARROW)) { player.vx = -WALK_SPEED; player.direction = -1; }
    else if (keyIsDown(RIGHT_ARROW)) { player.vx = WALK_SPEED; player.direction = 1; }

    if (overLadder) {
        if (keyIsDown(UP_ARROW)) { player.climbing = true; player.vy = -WALK_SPEED; player.x = lerp(player.x, (tx * TILE_SIZE) + (TILE_SIZE - player.w)/2, 0.2); }
        else if (keyIsDown(DOWN_ARROW)) { player.climbing = true; player.vy = WALK_SPEED; player.y += 2; player.x = lerp(player.x, (tx * TILE_SIZE) + (TILE_SIZE - player.w)/2, 0.2); }
        else if (player.climbing) player.vy = 0; 
    } else player.climbing = false;

    if (player.vx !== 0 || (player.climbing && player.vy !== 0)) {
        if (frameCount % 8 === 0) player.animFrame = (player.animFrame + 1) % 2;
    }
}

function applyPhysics() {
    if (!player.climbing) player.vy += GRAVITY;
    player.x += player.vx; player.y += player.vy;
    if (player.vy > 12) player.vy = 12;
    if (player.grounded) player.coyoteFrames = 8; else player.coyoteFrames--;
}

function checkCollisions() {
    player.grounded = false;
    let left = Math.floor(player.x / TILE_SIZE), right = Math.floor((player.x + player.w) / TILE_SIZE);
    let top = Math.floor(player.y / TILE_SIZE), bottom = Math.floor((player.y + player.h) / TILE_SIZE);

    for (let i = left; i <= right; i++) {
        for (let j = top; j <= bottom; j++) {
            let tile = getTile(i, j);
            
            if (TOOL_VISUAL_IDS.includes(tile)) {
                let role = toolMapping[tile];
                setTile(i, j, 0);
                if (role === ROLE_RED_KEY) { inventory.redKey++; }
                else if (role === ROLE_BLUE_KEY) { inventory.blueKey++; }
                else if (role === ROLE_SWORD) { inventory.sword++; }
                else if (role === ROLE_BOOTS) { inventory.boots++; }
                score += 500;
                spawnFloatingText(player.x, player.y, "TOOL ACQUIRED");
                return;
            }

            if (VALUE_VISUAL_IDS.includes(tile)) {
                let role = valueMapping[tile];
                setTile(i, j, 0);
                if (role === ROLE_REWARD) {
                    score += 1000;
                    spawnFloatingText(player.x, player.y, "VALUE GAIN");
                } else if (role === ROLE_CURSE) {
                    score = Math.max(0, score - 1000); 
                    spawnFloatingText(player.x, player.y, "VALUE LOSS", [255, 0, 255]);
                    penaltyTimer = 30;
                }
                return;
            }

            if (tile === 11) { handleVictory(); return; }

            if (tile === 4 && inventory.redKey > 0) { 
                if (currentRoom.x === 2 && currentRoom.y === 1) {
                    handleExit(); 
                } else {
                    clearDoor(4); 
                    inventory.redKey--; 
                }
                return; 
            }
            if (tile === 5 && inventory.blueKey > 0) { clearDoor(5); inventory.blueKey--; return; }

            if (player.climbing) {
                if ((tile === 1 && j > 0) || tile === 4 || tile === 5) resolveCollision(i, j, tile);
                continue;
            }
            if (tile === 1 || tile === 4 || tile === 5 || tile === 3 || tile === 2) resolveCollision(i, j, tile);
        }
    }
}

function handleVictory() {
    terminalBonus = 20000 + (lives * 10000);
    score += terminalBonus;
    gameState = 'WIN';
    noLoop();
}

function handleExit() {
    terminalBonus = 5000;
    score += terminalBonus;
    gameState = 'EXIT';
    noLoop();
}

function resolveCollision(tx, ty, type) {
    let tileX = tx * TILE_SIZE, tileY = ty * TILE_SIZE;
    if (type === 3 || type === 2) {
        if (player.vy >= 0 && (player.y + player.h) <= tileY + 12 && (player.y + player.h) >= tileY) {
            player.y = tileY - player.h; player.vy = 0; player.grounded = true;
        }
        return;
    }
    let dx = (player.x + player.w/2) - (tileX + TILE_SIZE/2), dy = (player.y + player.h/2) - (tileY + TILE_SIZE/2);
    if (Math.abs(dx) > Math.abs(dy)) {
        if (dx > 0) player.x = tileX + TILE_SIZE; else player.x = tileX - player.w;
    } else {
        if (dy > 0) { player.y = tileY + TILE_SIZE; player.vy = 0; }
        else { player.y = tileY - player.h; player.vy = 0; player.grounded = true; }
    }
}

function clearDoor(type) {
    let rk = `${currentRoom.x},${currentRoom.y}`;
    if (!rooms[rk]) return;
    for(let y = 0; y < ROWS; y++) {
        for(let x = 0; x < COLS; x++) if (rooms[rk][y][x] === type) rooms[rk][y][x] = 0;
    }
    spawnFloatingText(player.x, player.y, "BARRIER REMOVED", [255, 255, 0]);
}

function spawnFloatingText(x, y, txt, color = [0, 255, 0]) {
    floatingTexts.push({ x, y, txt, color, life: 80 });
}

function updateHazards() {
    if (spawnSafetyTimer > 0) return; 
    laserTimer = (laserTimer + 1) % 120;
    
    let hasProtection = inventory.boots > 0;
    if (laserTimer < 60 && !hasProtection) {
        let tx = Math.floor((player.x + player.w/2) / TILE_SIZE), ty = Math.floor((player.y + player.h/2) / TILE_SIZE);
        if (getTile(tx, ty) === 10) { die(); return; }
    }

    for (let i = skulls.length - 1; i >= 0; i--) {
        let s = skulls[i]; s.x += s.dir * s.speed;
        let tx = Math.floor((s.x + (s.dir === 1 ? s.w : 0)) / TILE_SIZE);
        if (getTile(tx, Math.floor(s.y/TILE_SIZE)) === 1) s.dir *= -1;
        if (rectIntersect(player.x, player.y, player.w, player.h, s.x, s.y, s.w, s.h)) {
            if (inventory.boots > 0 && player.vy > 0 && player.y + player.h < s.y + s.h/2) {
                player.vy = -7; score += 500; spawnFloatingText(s.x, s.y, "+500"); skulls.splice(i, 1);
            } else { die(); return; }
        }
    }
    for (let i = spiders.length - 1; i >= 0; i--) {
        let s = spiders[i];
        if (player.x < s.x) s.x -= s.speed; else if (player.x > s.x) s.x += s.speed;
        if (rectIntersect(player.x, player.y, player.w, player.h, s.x, s.y, s.w, s.h)) {
            if (inventory.boots > 0 && player.vy > 0 && player.y + player.h < s.y + s.h/2) {
                player.vy = -7; score += 1000; spawnFloatingText(s.x, s.y, "+1000"); spiders.splice(i, 1);
            } else if (inventory.sword > 0) {
                inventory.sword--; score += 1000; spawnFloatingText(s.x, s.y, "+1000"); spiders.splice(i, 1);
            } else { die(); return; }
        }
    }
    for (let i = sentinels.length - 1; i >= 0; i--) {
        let s = sentinels[i]; s.x += s.dir * s.speed;
        let tx = Math.floor((s.x + (s.dir === 1 ? s.w : 0)) / TILE_SIZE);
        if (getTile(tx, Math.floor(s.y/TILE_SIZE)) === 1) s.dir *= -1;
        if (rectIntersect(player.x, player.y, player.w, player.h, s.x, s.y, s.w, s.h)) {
            if (inventory.sword > 0) {
                inventory.sword--; 
                score += 2500; 
                spawnFloatingText(s.x, s.y, "+2500 SENTINEL DEFEATED", [255, 255, 255]);
                killedSentinels.add(s.id);
                sentinels.splice(i, 1);
            } else { die(); return; }
        }
    }
}

function checkRoomTransition() {
    let changed = false; let oldRoom = { ...currentRoom };
    if (player.x < -player.w) { currentRoom.x--; player.x = width - player.w - 5; changed = true; }
    else if (player.x > width) { currentRoom.x++; player.x = 5; changed = true; }
    if (player.y < -player.h) { currentRoom.y--; player.y = height - player.h - 10; changed = true; }
    else if (player.y > height) { currentRoom.y++; player.y = 10; changed = true; }
    if (changed) {
        let rk = `${currentRoom.x},${currentRoom.y}`;
        if (!rooms[rk]) { 
            currentRoom.x = oldRoom.x; currentRoom.y = oldRoom.y; 
            player.x = constrain(player.x, 0, width - player.w); 
            player.y = constrain(player.y, 0, height - player.h); 
        } else {
            spawnEnemies();
        }
    }
}

function die() {
    score = Math.max(0, score - DEATH_PENALTY);
    spawnFloatingText(player.x, player.y, `-${DEATH_PENALTY} LOSS`, [255, 50, 50]);
    lives--;
    if (lives <= 0) { gameState = 'GAMEOVER'; noLoop(); } else resetPlayerToRoom(1, 1);
}

function keyPressed() {
    if (['START', 'GAMEOVER', 'WIN', 'EXIT'].includes(gameState)) {
        if (keyCode === ENTER) {
            score = 0; lives = 3; terminalBonus = 0;
            inventory = {redKey:0, blueKey:0, sword:0, boots:0};
            floatingTexts = [];
            killedSentinels.clear(); 
            shuffleRoles(); 
            initPyramid(); resetPlayerToRoom(1, 1);
            gameState = 'PLAYING'; loop();
        }
    } else if (gameState === 'PLAYING') {
        if (keyCode === UP_ARROW && (player.grounded || player.coyoteFrames > 0) && !player.climbing) {
            player.vy = JUMP_FORCE; player.grounded = false; player.coyoteFrames = 0;
        }
    }
}

function getTile(x, y) {
    let rk = `${currentRoom.x},${currentRoom.y}`;
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return 0;
    return rooms[rk] ? rooms[rk][y][x] : 0;
}

function setTile(x, y, v) {
    let rk = `${currentRoom.x},${currentRoom.y}`;
    if (rooms[rk]) rooms[rk][y][x] = v;
}

function rectIntersect(x1, y1, w1, h1, x2, y2, w2, h2) {
    return x2 < x1 + w1 && x2 + w2 > x1 && y2 < y1 + h1 && y2 + h2 > y1;
}

function drawGame() {
    let rk = `${currentRoom.x},${currentRoom.y}`;
    let data = rooms[rk]; if (!data) return;
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) drawTile(x * TILE_SIZE, y * TILE_SIZE, data[y][x]);
    }
    for (let s of skulls) drawSkull(s.x, s.y);
    for (let sp of spiders) drawSpider(sp.x, sp.y);
    for (let sn of sentinels) drawSentinel(sn.x, sn.y);
    drawPlayer(player.x, player.y);
    for (let ft of floatingTexts) {
        fill(ft.color[0], ft.color[1], ft.color[2], map(ft.life, 0, 80, 0, 255));
        textSize(14); textAlign(CENTER); text(ft.txt, ft.x + 10, ft.y);
    }
    drawUI();
}

function drawTile(x, y, type) {
    if (type === 1) { fill(100, 50, 0); rect(x, y, 32, 32); stroke(0, 50); line(x, y+16, x+32, y+16); noStroke(); }
    else if (type === 2) { fill(255, 255, 150); rect(x+6, y, 4, 32); rect(x+22, y, 4, 32); for(let i=4; i<32; i+=8) rect(x+6, y+i, 20, 2); }
    else if (type === 3) { fill(255, 140, 0); rect(x, y, 32, 10); }
    else if (type === 4) { fill(200, 0, 0); rect(x+4, y, 24, 32); fill(255, 255, 0); ellipse(x+16, y+16, 6); }
    else if (type === 5) { fill(0, 80, 200); rect(x+4, y, 24, 32); fill(255, 255, 0); ellipse(x+16, y+16, 6); }
    else if (TOOL_VISUAL_IDS.includes(type)) { drawToolVisual(type, x+16, y+16); }
    else if (VALUE_VISUAL_IDS.includes(type)) { drawValueVisual(type, x+16, y+16); }
    else if (type === 10) { 
        let active = laserTimer < 60 && inventory.boots === 0;
        fill(active ? 255 : 40, active ? 255 : 40, 0); 
        rect(x+14, y, 4, 32); 
    }
    else if (type === 11) { fill(255, 215, 0); rect(x, y, 32, 32); fill(0); textSize(10); textAlign(CENTER); text("GOLD", x+16, y+20); }
}

function drawToolVisual(id, x, y) {
    if (id === 6) { fill(255, 0, 0); ellipse(x, y-4, 10); rect(x-2, y-4, 4, 12); }
    else if (id === 7) { fill(0, 150, 255); ellipse(x, y-4, 10); rect(x-2, y-4, 4, 12); }
    else if (id === 12) { push(); translate(x, y); rotate(PI/4); fill(200); rect(-2, -10, 4, 16); fill(150, 75, 0); rect(-6, 6, 12, 3); rect(-2, 6, 4, 6); pop(); }
    else if (id === 14) { fill(150, 0, 255); rect(x-8, y-8, 12, 8, 2); rect(x-8, y, 18, 6, 2); }
}

function drawValueVisual(id, x, y) {
    if (id === 8) { fill(255, 255, 0); ellipse(x, y, 14); fill(255, 150, 0); ellipse(x, y, 8); }
    else if (id === 15) { fill(40); beginShape(); vertex(x, y-12); vertex(x+10, y); vertex(x, y+12); vertex(x-10, y); endShape(CLOSE); fill(150, 0, 255); ellipse(x, y, 6); }
}

function drawSkull(x, y) { fill(255); ellipse(x+12, y+12, 24, 20); fill(0); ellipse(x+7, y+10, 6); ellipse(x+17, y+10, 6); }

function drawSpider(x, y) {
    fill(100, 200, 100); ellipse(x+14, y+12, 16, 12); stroke(100, 200, 100); strokeWeight(2);
    for (let i = -1; i <= 1; i += 0.6) { line(x+14, y+12, x+14 + i*15, y+2); line(x+14, y+12, x+14 + i*15, y+22); }
    noStroke(); fill(0); ellipse(x+10, y+10, 3); ellipse(x+18, y+10, 3);
}

function drawSentinel(x, y) {
    fill(180); rect(x+4, y+4, 24, 24, 4); 
    fill(255, 0, 0); ellipse(x+16, y+16, 12); 
    fill(100); rect(x+2, y+20, 28, 6); 
    stroke(255, 0, 0); line(x+10, y+16, x+22, y+16); noStroke();
}

function drawPlayer(x, y) {
    push(); translate(x + player.w/2, y + player.h/2);
    if (player.direction === -1) scale(-1, 1);
    let isCursed = (penaltyTimer > 0 && penaltyTimer % 4 < 2);
    let isInvulnerable = (spawnSafetyTimer > 0 && frameCount % 6 < 3);
    if (isInvulnerable) tint(255, 128); 
    
    // Body / Suit
    fill(isCursed ? 100 : 255, isCursed ? 100 : 200, 0); rect(-10, -18, 20, 8);
    fill(isCursed ? 150 : 255, isCursed ? 150 : 224, isCursed ? 150 : 189); rect(-8, -10, 16, 10);
    fill(isCursed ? 50 : 200, 0, 0); rect(-10, 0, 20, 10);
    
    // Equipment - Boots
    if (inventory.boots > 0) {
        let bootVID = TOOL_VISUAL_IDS.find(id => toolMapping[id] === ROLE_BOOTS);
        fill(255); 
        if (bootVID === 6) fill(255, 0, 0);
        else if (bootVID === 7) fill(0, 150, 255);
        else if (bootVID === 12) fill(200);
        else if (bootVID === 14) fill(150, 0, 255);
        rect(-8, 10, 6, 8); rect(2, 10, 6, 8);
    }
    
    // Equipment - Keys (Visible on belt)
    if (inventory.redKey > 0) {
        let redKeyVID = TOOL_VISUAL_IDS.find(id => toolMapping[id] === ROLE_RED_KEY);
        push(); scale(0.6); translate(-12, 10); drawToolVisual(redKeyVID, 0, 0); pop();
    }
    if (inventory.blueKey > 0) {
        let blueKeyVID = TOOL_VISUAL_IDS.find(id => toolMapping[id] === ROLE_BLUE_KEY);
        push(); scale(0.6); translate(-2, 10); drawToolVisual(blueKeyVID, 0, 0); pop();
    }

    // Equipment - Sword
    if (inventory.sword > 0) {
        let swordVID = TOOL_VISUAL_IDS.find(id => toolMapping[id] === ROLE_SWORD);
        push(); translate(12, 0); rotate(PI/6); drawToolVisual(swordVID, 0, 0); pop();
    }
    pop();
}

function drawUI() {
    fill(255); textSize(16); textAlign(LEFT);
    let invStr = "INV: ";
    if (inventory.redKey > 0) invStr += "T_" + TOOL_VISUAL_IDS.find(id => toolMapping[id] === ROLE_RED_KEY) + " ";
    if (inventory.blueKey > 0) invStr += "T_" + TOOL_VISUAL_IDS.find(id => toolMapping[id] === ROLE_BLUE_KEY) + " ";
    if (inventory.sword > 0) invStr += "T_" + TOOL_VISUAL_IDS.find(id => toolMapping[id] === ROLE_SWORD) + " ";
    if (inventory.boots > 0) invStr += "T_" + TOOL_VISUAL_IDS.find(id => toolMapping[id] === ROLE_BOOTS) + " ";
    
    text(`SCORE: ${score}  LIVES: ${lives}  ${invStr}`, 20, 25);
}

function drawStartScreen() {
    textAlign(CENTER); fill(255, 165, 0); textSize(36); text("RANDOMIZED SEARCH", width/2, height/2 - 20);
    fill(255); textSize(16); text("MULTIPLE EXIT STRATEGY ENABLED", width/2, height/2 + 30);
    textSize(14); text("Room (2,1) Red Door: Safety Exit (+5,000)", width/2, height/2 + 60);
    text("Room (2,0) Gold: True Victory (+20,000+)", width/2, height/2 + 80);
    text("PRESS ENTER TO INITIALIZE", width/2, height/2 + 120);
}

function drawGameOver() {
    background(0, 200); textAlign(CENTER); fill(255, 0, 0); textSize(40); text("GAME OVER", width/2, height/2);
    fill(255); textSize(16); text("PRESS ENTER TO RE-INITIALIZE", width/2, height/2 + 40);
}

function drawExit() {
    background(0, 200); textAlign(CENTER); fill(200, 200, 255); textSize(40); text("SAFETY EXIT", width/2, height/2 - 40);
    fill(255); textSize(18); text("PYRAMID EVACUATED", width/2, height/2 + 10);
    fill(0, 255, 255); text(`EXIT BONUS: ${terminalBonus}`, width/2, height/2 + 40);
    fill(255, 215, 0); textSize(24); text("FINAL SCORE: " + score, width/2, height/2 + 85);
    fill(200); textSize(14); text("PRESS ENTER TO RESTART", width/2, height/2 + 130);
}

function drawWin() {
    background(0, 230); textAlign(CENTER); fill(255, 215, 0); textSize(40); text("TRUE VICTORY!", width/2, height/2 - 60);
    fill(255); textSize(18); text("VAULT ACCESSED", width/2, height/2 - 10);
    fill(0, 255, 0); text(`REWARD BONUS: ${terminalBonus}`, width/2, height/2 + 20);
    stroke(255); strokeWeight(1); line(width/2 - 100, height/2 + 40, width/2 + 100, height/2 + 40); noStroke();
    fill(255, 215, 0); textSize(24); text("FINAL SCORE: " + score, width/2, height/2 + 75);
    fill(200); textSize(14); text("PRESS ENTER TO RESTART", width/2, height/2 + 120);
}

