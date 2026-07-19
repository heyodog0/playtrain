// analogen_nomemory_grid_v1
// Grid-world variant of analogen_nomemory_v1. Strips the platformer
// (gravity / ladders / jumping) but preserves the binding test exactly:
//
//   5 tool-icons (visual IDs 6,7,12,14,17) are shuffled per-seed to roles
//     {RED_KEY, BLUE_KEY, BOOTS, SWORD, SWORD}.
//   2 value-icons (visual IDs 8, 15) are shuffled per-seed to roles
//     {REWARD, CURSE}.
//   The mapping changes every episode -- the agent cannot memorize
//   "red icon = sword". It must read its current binding from pixels:
//   inventory is rendered ON the player sprite (legs recolor for boots,
//   sword drawn in hand) so a feedforward CNN can ground icon -> role
//   from this episode's evidence.
//
// Mechanics (simpler than the platformer; same logic):
//   - Move one cell per step in chosen direction (LEFT/RIGHT/UP/DOWN).
//   - Walk into a tool/value tile to pick it up.
//   - Walk into a door tile: opens iff matching key in inventory (consumed).
//   - Walk into an enemy:
//       * if BOOTS in inventory -> kill it (boots NOT consumed, like stomp)
//       * else if SWORD in inventory -> kill it (sword consumed, one-shot)
//       * else -> die
//   - Walk onto a laser tile: die unless BOOTS in inventory.
//   - Walk onto the goal tile -> WIN.
//   - 3 lives. Death respawns at start; lives==0 -> GAMEOVER.
//
// Score deltas match the platformer:
//   +500 pickup, +1000 reward, -1000 curse, +1000 enemy kill,
//   -5000 death, +50000 + lives*10000 win.
//
// Action mapping (Discrete(8)):
//   0 NOOP, 1 LEFT, 2 RIGHT, 3 UP, 4 DOWN, 5 D, 6 LEFT+D, 7 RIGHT+D
//   D and combos are ignored in this game.

const TILE_SIZE = 32;
const ROWS = 11;
const COLS = 15;
const DEATH_PENALTY = 5000;
const MOVE_COOLDOWN = 6;  // frames between grid moves (smooths random play)

const ROLE_RED_KEY  = 'RED_KEY';
const ROLE_BLUE_KEY = 'BLUE_KEY';
const ROLE_SWORD    = 'SWORD';
const ROLE_BOOTS    = 'BOOTS';
const ROLE_REWARD   = 'REWARD';
const ROLE_CURSE    = 'CURSE';

const TOOL_VISUAL_IDS  = [6, 7, 12, 14, 17];
const VALUE_VISUAL_IDS = [8, 15];
const MAX_INVENTORY = 2;

const DROP_COOLDOWN = 45;  // frames before a dropped item can be re-picked up
                            // (matches platformer; long enough for the blink
                            // animation to be visually obvious)

let gameState = 'PLAYING';
let score = 0;
let lives = 3;
let inventoryQueue = [];
let toolMapping = {};
let valueMapping = {};
let penaltyTimer = 0;
let moveCooldown = 0;
// Items dropped because inventory was full. Keyed by "c,r"; value is
// { role, visualId, cooldown }. Matches the platformer's persistentDrops
// behavior so the agent can swap items instead of losing them.
let persistentDrops = {};

let player = { c: 0, r: 0, direction: 1 };
let startCell = { c: 0, r: 0 };
let enemies = [];
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

function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

// ============================================================
// p5 lifecycle
// ============================================================
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

// ============================================================
// RL interface
// ============================================================
function getGameState() {
    return { score: score, lives: lives, gameState: gameState };
}

function resetGame(seed) {
    rng = mulberry32(seed);
    score = 0;
    lives = 3;
    inventoryQueue = [];
    persistentDrops = {};
    penaltyTimer = 0;
    moveCooldown = 0;
    enemies = [];
    gameState = 'PLAYING';
    shuffleRoles();
    initRoom();
    resetPlayer();
}

// ============================================================
// Procedural setup (seeded)
// ============================================================
function shuffleRoles() {
    const toolRoles = [ROLE_RED_KEY, ROLE_BLUE_KEY, ROLE_BOOTS, ROLE_SWORD, ROLE_SWORD];
    shuffleInPlace(toolRoles);
    toolMapping = {};
    TOOL_VISUAL_IDS.forEach((vid, i) => { toolMapping[vid] = toolRoles[i]; });

    const valueRoles = [ROLE_REWARD, ROLE_CURSE];
    if (rng() > 0.5) valueRoles.reverse();
    valueMapping = {};
    VALUE_VISUAL_IDS.forEach((vid, i) => { valueMapping[vid] = valueRoles[i]; });
}

function initRoom() {
    // 0=floor, 1=wall, 4=red door, 5=blue door, 10=laser, 11=goal,
    // 13=enemy spawn marker (consumed at spawn-time, then becomes 0)
    mapData = [
        [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
        [1,0,0,0,0,1,0,0,0,0,1,0,0,11,1],
        [1,0,0,0,0,4,0,0,0,0,5,0,0,0,1],
        [1,0,0,0,0,1,0,0,0,0,1,0,0,0,1],
        [1,0,0,0,0,1,0,13,0,0,1,0,0,0,1],
        [1,1,1,0,1,1,1,0,1,1,1,1,0,1,1],
        [1,0,0,0,0,0,0,0,0,0,10,0,0,0,1],
        [1,0,0,0,0,0,0,0,0,0,1,0,0,0,1],
        [1,0,0,0,13,0,0,0,0,0,1,0,0,0,1],
        [1,0,0,0,0,0,0,0,0,0,1,0,0,0,1],
        [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    ];
    startCell = { c: 1, r: 9 };

    // Eight pickup slots distributed across the three "rooms" of the map.
    // The bottom-right pair sits behind the laser AND behind the blue door,
    // so reaching either requires already-acquired BOOTS or BLUE_KEY. If a
    // shuffle places BOTH BOOTS and BLUE_KEY in those two spots, the seed is
    // unsolvable. Reject and reshuffle until the invariant holds.
    const SPOTS_BASE = [
        { c: 1, r: 1 }, { c: 3, r: 1 }, { c: 1, r: 3 }, { c: 3, r: 3 },
        { c: 6, r: 1 }, { c: 8, r: 1 }, { c: 11, r: 7 }, { c: 13, r: 9 },
    ];
    const isBottomRight = (s) => (s.c === 11 && s.r === 7) || (s.c === 13 && s.r === 9);

    let spots;
    let attempts = 0;
    while (true) {
        spots = SPOTS_BASE.map(s => ({ c: s.c, r: s.r }));
        shuffleInPlace(spots);
        // Tools are popped from the end: iteration i takes spots[len-1-i].
        // Predict where BOOTS and BLUE_KEY will land via toolMapping.
        let bootsSpot = null, blueSpot = null;
        for (let i = 0; i < TOOL_VISUAL_IDS.length; i++) {
            const role = toolMapping[TOOL_VISUAL_IDS[i]];
            const s = spots[spots.length - 1 - i];
            if (role === ROLE_BOOTS)    bootsSpot = s;
            if (role === ROLE_BLUE_KEY) blueSpot  = s;
        }
        if (!(bootsSpot && blueSpot && isBottomRight(bootsSpot) && isBottomRight(blueSpot))) break;
        attempts++;
        if (attempts > 50) break;  // safety bail; should never trigger
    }

    TOOL_VISUAL_IDS.forEach((vid) => {
        const s = spots.pop();
        mapData[s.r][s.c] = vid;
    });
    while (spots.length > 0) {
        const s = spots.pop();
        mapData[s.r][s.c] = VALUE_VISUAL_IDS[rng() > 0.5 ? 0 : 1];
    }

    // Spawn enemies from 13-markers, then clear the markers.
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (mapData[r][c] === 13) {
                enemies.push({ c, r, id: `${c}_${r}` });
                mapData[r][c] = 0;
            }
        }
    }
}

function resetPlayer() {
    player.c = startCell.c;
    player.r = startCell.r;
    player.direction = 1;
}

// ============================================================
// Update
// ============================================================
function updateGame() {
    if (penaltyTimer > 0) penaltyTimer--;
    for (const key in persistentDrops) {
        if (persistentDrops[key].cooldown > 0) persistentDrops[key].cooldown--;
    }
    if (moveCooldown > 0) { moveCooldown--; return; }

    let dc = 0, dr = 0;
    if      (keyIsDown(LEFT_ARROW))  { dc = -1; player.direction = -1; }
    else if (keyIsDown(RIGHT_ARROW)) { dc =  1; player.direction =  1; }
    else if (keyIsDown(UP_ARROW))    { dr = -1; }
    else if (keyIsDown(DOWN_ARROW))  { dr =  1; }
    else return;

    moveCooldown = MOVE_COOLDOWN;
    tryMove(player.c + dc, player.r + dr);
}

function tryMove(nc, nr) {
    if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) return;
    const tile = mapData[nr][nc];

    // Walls block.
    if (tile === 1) return;

    // Doors: open iff matching key, then walk through.
    if (tile === 4) {
        if (hasItem(ROLE_RED_KEY))  { consumeItem(ROLE_RED_KEY);  clearDoor(4); }
        else return;
    }
    if (tile === 5) {
        if (hasItem(ROLE_BLUE_KEY)) { consumeItem(ROLE_BLUE_KEY); clearDoor(5); }
        else return;
    }

    // Enemy: kill with boots (free) or sword (consumed) -- else die.
    const enemyIdx = enemies.findIndex(e => e.c === nc && e.r === nr);
    if (enemyIdx !== -1) {
        if (hasItem(ROLE_BOOTS)) {
            score += 1000; enemies.splice(enemyIdx, 1);
        } else if (hasItem(ROLE_SWORD)) {
            consumeItem(ROLE_SWORD); score += 1000; enemies.splice(enemyIdx, 1);
        } else {
            die(); return;
        }
    }

    player.c = nc;
    player.r = nr;

    // Tile effects on the cell we just stepped onto.
    const here = mapData[player.r][player.c];

    if (TOOL_VISUAL_IDS.includes(here)) {
        const role = toolMapping[here];
        mapData[player.r][player.c] = 0;
        addItem(role, here);
        score += 500;
        return;
    }
    if (VALUE_VISUAL_IDS.includes(here)) {
        const role = valueMapping[here];
        mapData[player.r][player.c] = 0;
        if (role === ROLE_REWARD) { score += 1000; }
        else                       { score -= 1000; penaltyTimer = 30; }
        return;
    }
    if (here === 10) {
        if (!hasItem(ROLE_BOOTS)) { die(); return; }
        // boots: walk over harmlessly
    }
    if (here === 11) { handleVictory(); return; }

    // Pick up a previously-dropped item if one is on this cell and its
    // re-pickup cooldown has elapsed. Mirrors the platformer's behavior.
    const dropKey = `${player.c},${player.r}`;
    const drop = persistentDrops[dropKey];
    if (drop && drop.cooldown <= 0) {
        delete persistentDrops[dropKey];
        addItem(drop.role, drop.visualId);
    }
}

function handleVictory() {
    score += 50000 + lives * 10000;
    gameState = 'WIN';
}

function clearDoor(type) {
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) if (mapData[r][c] === type) mapData[r][c] = 0;
    }
}

function die() {
    score = Math.max(0, score - DEATH_PENALTY);
    lives--;
    if (lives <= 0) gameState = 'GAMEOVER';
    else            resetPlayer();
}

// ============================================================
// Helpers
// ============================================================
function hasItem(role)     { return inventoryQueue.some(it => it.role === role); }
function consumeItem(role) {
    const idx = inventoryQueue.findIndex(it => it.role === role);
    if (idx !== -1) { inventoryQueue.splice(idx, 1); return true; }
    return false;
}
function addItem(role, visualId) {
    // NO-DROP variant: displaced items are discarded (matches the pre-drop
    // grid_v1 behavior). Used as a baseline to isolate the effect of drops
    // on training difficulty.
    if (inventoryQueue.length >= MAX_INVENTORY) inventoryQueue.shift();
    inventoryQueue.push({ role, visualId });
}

// ============================================================
// Render
// ============================================================
function drawGame() {
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) drawTile(c * TILE_SIZE, r * TILE_SIZE, mapData[r][c]);
    }
    // Dropped items: small icon at the cell. Blinks while cooldown is active
    // so the agent can visually distinguish "not yet pickable" from ready.
    for (const key in persistentDrops) {
        const d = persistentDrops[key];
        const [dc, dr] = key.split(',').map(Number);
        if (d.cooldown > 0 && frameCount % 10 < 5) continue;  // blink while disabled
        drawToolVisual(d.visualId, dc * TILE_SIZE + 16, dr * TILE_SIZE + 16);
    }
    for (const e of enemies) drawEnemy(e.c * TILE_SIZE, e.r * TILE_SIZE);
    drawPlayer(player.c * TILE_SIZE, player.r * TILE_SIZE);
}

function drawTile(x, y, type) {
    if (type === 1) {
        fill(80, 40, 0); rect(x, y, 32, 32);
    } else if (type === 4) {
        fill(200, 0, 0); rect(x + 2, y + 2, 28, 28);
        fill(255, 255, 0); ellipse(x + 16, y + 16, 6);
    } else if (type === 5) {
        fill(0, 80, 200); rect(x + 2, y + 2, 28, 28);
        fill(255, 255, 0); ellipse(x + 16, y + 16, 6);
    } else if (TOOL_VISUAL_IDS.includes(type)) {
        drawToolVisual(type, x + 16, y + 16);
    } else if (VALUE_VISUAL_IDS.includes(type)) {
        drawValueVisual(type, x + 16, y + 16);
    } else if (type === 10) {
        fill(255, 255, 0); rect(x + 2, y + 14, 28, 4);
    } else if (type === 11) {
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

function drawEnemy(x, y) {
    fill(100, 200, 100); ellipse(x + 16, y + 16, 18, 14);
    stroke(100, 200, 100); strokeWeight(2);
    for (let i = -1; i <= 1; i += 0.6) {
        line(x + 16, y + 16, x + 16 + i * 14, y + 4);
        line(x + 16, y + 16, x + 16 + i * 14, y + 28);
    }
    noStroke();
    fill(0); ellipse(x + 12, y + 14, 3); ellipse(x + 20, y + 14, 3);
}

function drawPlayer(x, y) {
    push();
    translate(x + 16, y + 16);
    if (player.direction === -1) scale(-1, 1);

    const cursed = penaltyTimer > 0 && penaltyTimer % 4 < 2;

    // Head
    fill(cursed ? 100 : 255, cursed ? 100 : 200, 0); rect(-10, -14, 20, 6);
    // Face
    fill(cursed ? 150 : 255, 224, 189); rect(-8, -8, 16, 8);

    // Legs (red, OR boots-color if BOOTS in inventory)
    let legColor = color(200, 0, 0);
    const boots = inventoryQueue.find(it => it.role === ROLE_BOOTS);
    if (boots) legColor = getItemColor(boots.visualId);
    fill(legColor); rect(-10, 0, 20, 8);

    // Held items: sword in hand; non-boots/non-sword as small icons at base.
    inventoryQueue.forEach((item, idx) => {
        if (item.role === ROLE_SWORD) {
            push(); translate(12, 0); rotate(PI / 6); drawToolVisual(item.visualId, 0, 0); pop();
        } else if (item.role !== ROLE_BOOTS) {
            push(); scale(0.6); translate(-12 + idx * 10, 12); drawToolVisual(item.visualId, 0, 0); pop();
        }
    });

    pop();
}

function keyPressed() {}
