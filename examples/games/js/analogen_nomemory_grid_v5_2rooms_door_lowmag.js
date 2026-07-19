// analogen_nomemory_grid_v5_2rooms_door_lowmag (rewards divided by 50: +10 pickup, +20 door, +1000 goal, +200 lives — same env mechanics as v5_2rooms_door, just compressed dynamic range to test whether the 100x reward magnitude was destabilizing value-function learning)
// Variant of v5_2rooms that swaps the laser obstacle for a KEY-locked
// door at (3,4), and rewards opening that door with +1000. The +50000
// goal at (7,0) is unchanged — agent must open the door AND reach the
// goal to win.
//
// Hypothesis: in v5_2rooms the only signal teaching the BOOTS binding
// was "absence of death at the laser tile" — a weak gradient. v4
// taught each binding via a dedicated +1000 (sword→kill, blue_key→door,
// boots→kill). This variant restores that dedicated signal for BOOTS
// without restoring enemies. Opening the door is the BOOTS-binding
// equivalent of v4's blue-door reward.
//
// Vs v5_2rooms:
//   - tile 10 (laser, lethal-without-boots) at (3,4) replaced with
//     tile 2 (key-door, blocks-without-key) at (3,4).
//   - Walking onto the door with BLUE_KEY: opens it (clear all tile=2),
//     consumes the key, score += 1000.
//   - Walking onto the door without BLUE_KEY: blocked, no death.
//     Removes the laser's "punishment cliff" entirely.
//
// Forced path: items -> DOOR(3,4) with BLUE_KEY -> right room -> GOAL(7,0).
//
// Vs v5: only ONE obstacle (laser) and ONE binding to identify (BOOTS).
// BLUE_KEY, SWORD, and HAT roles still appear in the shuffle pool but
// bind to no-op distractor items (no blue door, no enemy, no sunbeam).
// This isolates the single role-binding test that defines AnaloGen
// while leaving the spatial-exploration component roughly intact.
//
// All other v5 mechanics preserved: inventory cap 2, drops, curses,
// sword consumption (no enemy → swords are pure distractors here),
// score deltas, 8x8 canvas / 64x64 obs downsample geometry.
//
// ----- original v5 header -----
// Same 8x8 layout/puzzle as v4 with two role-binding changes:
//   - RED KEY / RED DOOR replaced by HAT / SUNBEAM. The hat sits on top
//     of the avatar's head (parallel to BOOTS at the bottom). The sunbeam
//     is a vertical yellow beam through a tile. Mirrors the laser/boots
//     pair: sunbeam is lethal without HAT, deactivated (safe + grayed
//     visually) when HAT is in inventory. HAT is retained, no +1000.
//   - SWORD is now the only enemy killer. BOOTS no longer kills enemies;
//     each sword is consumed on enemy contact (2 swords per seed pairs
//     with the 2 enemies on the map).
//   - BOOTS no longer recolor the legs. Instead, two small boot rects
//     are drawn below the legs when boots are equipped. The leg color
//     stays default red. This makes the boots unambiguously a "bottom
//     of avatar" signal, paired symmetrically with the hat on top.
// Blue key / blue door / sword / enemy / laser all unchanged.
//
// ----- original v4 header -----
// 8x8 successor to v3. Same puzzle logic, smaller and cleaner-downsampling.
// Changes vs v3:
//   (1) 8x8 grid (was 11x11). Canvas 256x256 (8 tiles x 32px), downsamples
//       to 64x64 at exact 4:1 ratio — every tile = 8 obs px uniformly,
//       no deformation.
//   (2) No outer-border walls. Out-of-bounds is enforced by tryMove's
//       index check, so the brown perimeter ring is gone — every cell is
//       gameplay, no wasted edge.
//   (3) Bottom room is now 3 rows tall (was 4 in v3). Top is 4 floor
//       rows + 1 main wall row + 3 bottom rows = 8 total.
//   (4) Goal at top-LEFT corner of canvas (0,0).
//   (5) Patrolling middle-top enemy: starts at (4,2), bounded by walls
//       at (4,0) and (4,3) → bounces between (4,1) and (4,2).
//   (6) Item positions in bottom room randomized per seed (24 candidate
//       cells minus spawn and bottom enemy → pick 8).
//   (7) Inherits v3's static laser w/ BOOTS-disables-it visual logic and
//       +1000 door rewards.
//
// Inventory cap stays at 2.
//
// Score deltas: +500 pickup, +1000 reward, -1000 curse, +1000 enemy kill,
//   +1000 blue-door open, -5000 death, +50000 + lives*10000 win.
//   (v5: sunbeam is now a hazard like the laser — no reward for passing.)
//
// ----- original v2 header -----
// Minor-tweak variant of analogen_nomemory_grid_v1. Same overall feel
// (multi-room grid with open passages and varied walls), but two changes
// fix the things that made v1 imperfect:
//
//   (1) All 8 pickup spots in the bottom room (where the player spawns),
//       so the agent never has to clear an obstacle before reaching items.
//       Closes the v1 failure mode where BOOTS / BLUE_KEY could spawn
//       behind their own gate.
//   (2) The path from the bottom room to the goal is now a forced
//       sequence: LASER -> BLUE DOOR -> SUNBEAM -> GOAL. No bypass path,
//       no parallel routes. Mirrors the platformer's design while keeping
//       grid mechanics.
//
// Spatial layout (15 cols × 11 rows):
//
//   .................   r0  outer wall
//   . . .G . . . . .    r1  top-LEFT room with GOAL at (3,1)
//   . . . . R . . . .   r2  SUNBEAM at (5,2) between top-left and top-middle (R=sunbeam tile, kept from v4 layout for path symmetry)
//   . . . . . . . . .   r3  top-middle / top-right corridor
//   . . . . . . E . B   r4  enemy at (7,4); BLUE DOOR at (10,2) above
//   # # # # # # # # # L #  r5  WALL row with single laser passage at (11,5)
//   . . . . . . . . . .    r6  bottom room (single big open area)
//   . . . . . . . . . .    r7
//   . . . . E . . . . .    r8  enemy at (4,8)
//   . S . . . . . . . .    r9  spawn at (1,9); pickup spots scattered here
//
// Laser blinks on a 120-frame cycle (60 active / 60 inactive). With BOOTS
// the laser is always safe. Same timing-based design as the platformer.
//
// Score deltas match v1: +500 pickup, +1000 reward, -1000 curse,
//   +1000 enemy kill, -5000 death, +50000 + lives*10000 win.

const TILE_SIZE = 32;
const ROWS = 8;  // v5_2rooms: 8x8, horizontal left/right split.
const COLS = 8;
const PATROL_INTERVAL = 12;  // frames between patrol-enemy moves (2x player cooldown)
const DEATH_PENALTY = 5000;
const MOVE_COOLDOWN = 6;
const LASER_CYCLE = 120;

const ROLE_HAT      = 'HAT';
const ROLE_BLUE_KEY = 'BLUE_KEY';
const ROLE_SWORD    = 'SWORD';
const ROLE_BOOTS    = 'BOOTS';
const ROLE_REWARD   = 'REWARD';
const ROLE_CURSE    = 'CURSE';

const TOOL_VISUAL_IDS  = [6, 7, 12, 14, 17];
const VALUE_VISUAL_IDS = [8, 15];
const MAX_INVENTORY = 2;
const DROP_COOLDOWN = 45;  // frames; matches platformer for visible blink

let gameState = 'PLAYING';
let score = 0;
let lives = 3;
let inventoryQueue = [];
let toolMapping = {};
let valueMapping = {};
let penaltyTimer = 0;
let moveCooldown = 0;
let laserTimer = 0;
// Items dropped because inventory was full. Keyed by "c,r"; value is
// { role, visualId, cooldown }. Matches the platformer's persistentDrops.
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
    inventoryQueue = [];
    persistentDrops = {};
    penaltyTimer = 0;
    moveCooldown = 0;
    laserTimer = 0;
    enemies = [];
    gameState = 'PLAYING';
    shuffleRoles();
    initRoom();
    resetPlayer();
}

function shuffleRoles() {
    const toolRoles = [ROLE_HAT, ROLE_BLUE_KEY, ROLE_BOOTS, ROLE_SWORD, ROLE_SWORD];
    shuffleInPlace(toolRoles);
    toolMapping = {};
    TOOL_VISUAL_IDS.forEach((vid, i) => { toolMapping[vid] = toolRoles[i]; });

    const valueRoles = [ROLE_REWARD, ROLE_CURSE];
    if (rng() > 0.5) valueRoles.reverse();
    valueMapping = {};
    VALUE_VISUAL_IDS.forEach((vid, i) => { valueMapping[vid] = valueRoles[i]; });
}

function initRoom() {
    // 0=floor, 1=wall, 2=key-door (NEW), 11=goal. (4/5/10/13 unused.)
    // 8x8, no outer-border walls (out-of-bounds enforced by tryMove).
    // Left room (cols 0-2): spawn + items. Wall col 3 (full height)
    // with a single KEY-locked door at (3,4). Right room (cols 4-7):
    // empty, goal at (7,0). Forced path: items -> DOOR(3,4) -> GOAL.
    mapData = [
        [0,0,0,1,0,0,0,11],
        [0,0,0,1,0,0,0,0],
        [0,0,0,1,0,0,0,0],
        [0,0,0,1,0,0,0,0],
        [0,0,0,2,0,0,0,0],
        [0,0,0,1,0,0,0,0],
        [0,0,0,1,0,0,0,0],
        [0,0,0,1,0,0,0,0],
    ];
    startCell = { c: 1, r: 7 };

    // 8 pickup spots, randomized per seed across the left room (cols
    // 0-2, all rows). Excludes the spawn cell and the 8 cells within
    // Chebyshev distance 1 of the spawn — same buffer as v5 / v5_easy
    // so the agent gets at least one free move before auto-pickup.
    const candidates = [];
    for (let r = 0; r <= 7; r++) {
        for (let c = 0; c <= 2; c++) {
            if (Math.abs(c - startCell.c) <= 1 && Math.abs(r - startCell.r) <= 1) continue;
            candidates.push({ c, r });
        }
    }
    shuffleInPlace(candidates);
    const spots = candidates.slice(0, 8);

    TOOL_VISUAL_IDS.forEach((vid) => {
        const s = spots.pop();
        mapData[s.r][s.c] = vid;
    });
    while (spots.length > 0) {
        const s = spots.pop();
        mapData[s.r][s.c] = VALUE_VISUAL_IDS[rng() > 0.5 ? 0 : 1];
    }

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (mapData[r][c] === 13) {
                // Middle-top room enemies patrol vertically; bottom enemies stay put.
                const patrol = (r >= 0 && r <= 3 && c >= 3 && c <= 4);
                enemies.push({ c, r, id: `${c}_${r}`, direction: 1, patrol });
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

function updateGame() {
    laserTimer = (laserTimer + 1) % LASER_CYCLE;
    if (penaltyTimer > 0) penaltyTimer--;
    for (const key in persistentDrops) {
        if (persistentDrops[key].cooldown > 0) persistentDrops[key].cooldown--;
    }

    // Patrol-enemy movement. Steps every PATROL_INTERVAL frames so the enemy
    // is slower and more predictable than the player. Each patrol enemy
    // tries to move 1 cell in its current direction; on a non-floor cell
    // it reverses direction. If it walks into the player, same collision
    // rules as the player walking into an enemy.
    if (frameCount % PATROL_INTERVAL === 0) {
        for (let i = enemies.length - 1; i >= 0; i--) {
            const e = enemies[i];
            if (!e.patrol) continue;
            const nr = e.r + e.direction;
            const blocked = nr < 0 || nr >= ROWS || mapData[nr][e.c] !== 0;
            if (blocked) {
                e.direction *= -1;
                continue;
            }
            e.r = nr;
            if (e.r === player.r && e.c === player.c) {
                if (hasItem(ROLE_SWORD)) {
                    consumeItem(ROLE_SWORD);
                    score += 20;
                    enemies.splice(i, 1);
                } else {
                    die();
                }
            }
        }
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

function laserActive() { return laserTimer < LASER_CYCLE / 2; }

function tryMove(nc, nr) {
    if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) return;
    const tile = mapData[nr][nc];

    if (tile === 1) return;

    if (tile === 5) {
        if (hasItem(ROLE_BLUE_KEY)) { consumeItem(ROLE_BLUE_KEY); clearDoor(5); score += 20; }
        else return;
    }

    // Key-locked door: opens with BLUE_KEY held; key is consumed
    // (matches v4 blue-door semantics). Opening grants +1000 and clears
    // all tile=2 cells. Without BLUE_KEY the move is blocked (no death).
    if (tile === 2) {
        if (hasItem(ROLE_BLUE_KEY)) { consumeItem(ROLE_BLUE_KEY); clearDoor(2); score += 20; }
        else return;
    }

    const enemyIdx = enemies.findIndex(e => e.c === nc && e.r === nr);
    if (enemyIdx !== -1) {
        if (hasItem(ROLE_SWORD)) {
            consumeItem(ROLE_SWORD); score += 20; enemies.splice(enemyIdx, 1);
        } else {
            die(); return;
        }
    }

    player.c = nc;
    player.r = nr;

    const here = mapData[player.r][player.c];

    if (TOOL_VISUAL_IDS.includes(here)) {
        const role = toolMapping[here];
        mapData[player.r][player.c] = 0;
        addItem(role, here);
        score += 10;
        return;
    }
    if (VALUE_VISUAL_IDS.includes(here)) {
        const role = valueMapping[here];
        mapData[player.r][player.c] = 0;
        if (role === ROLE_REWARD) { score += 20; }
        else                       { score -= 20; penaltyTimer = 30; }
        return;
    }
    // (laser tile 10 removed in v5_2rooms_door — replaced by key-door
    // tile 2, handled pre-move above.)
    if (here === 4) {
        // Sunbeam: lethal without hat, safe with hat. Mirror of laser/boots.
        if (!hasItem(ROLE_HAT)) { die(); return; }
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
    score += 1000 + lives * 200;
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

function hasItem(role)     { return inventoryQueue.some(it => it.role === role); }
function consumeItem(role) {
    const idx = inventoryQueue.findIndex(it => it.role === role);
    if (idx !== -1) { inventoryQueue.splice(idx, 1); return true; }
    return false;
}
function addItem(role, visualId) {
    if (inventoryQueue.length >= MAX_INVENTORY) {
        const dropped = inventoryQueue.shift();
        persistentDrops[`${player.c},${player.r}`] = {
            role: dropped.role, visualId: dropped.visualId, cooldown: DROP_COOLDOWN,
        };
    }
    inventoryQueue.push({ role, visualId });
}

function drawGame() {
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) drawTile(c * TILE_SIZE, r * TILE_SIZE, mapData[r][c]);
    }
    // Dropped items: small icon at the cell. Blinks while cooldown is active.
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
        // Sunbeam: vertical yellow beam. Lethal without hat, deactivated
        // (grayed) when HAT in inventory — mirror of the laser/boots cue.
        if (hasItem(ROLE_HAT)) {
            fill(80);            rect(x + 10, y, 12, 32);
            fill(120);           rect(x + 14, y, 4, 32);
        } else {
            fill(255, 220, 80);  rect(x + 10, y, 12, 32);
            fill(255, 255, 200); rect(x + 14, y, 4, 32);
        }
    } else if (type === 5) {
        fill(0, 80, 200); rect(x + 2, y + 2, 28, 28);
        fill(255, 255, 0); ellipse(x + 16, y + 16, 6);
    } else if (type === 2) {
        // Key-door: blue panel matching the canonical BLUE_KEY color
        // (0,80,200) so the visual cue points at the correct binding.
        // Identical render to tile 5 (v4 blue door); tile 5 is not
        // placed on the 2rooms map, so there is no collision.
        fill(0, 80, 200); rect(x + 2, y + 2, 28, 28);
        fill(255, 255, 0); ellipse(x + 16, y + 16, 6);
    } else if (TOOL_VISUAL_IDS.includes(type)) {
        drawToolVisual(type, x + 16, y + 16);
    } else if (VALUE_VISUAL_IDS.includes(type)) {
        drawValueVisual(type, x + 16, y + 16);
    } else if (type === 11) {
        fill(255, 215, 0); rect(x, y, 32, 32);
    }
}

function getItemColor(vid) {
    // v5: id 6 is the hat (was the red key in v4). Bright "hot pink" —
    // pushed away from purple boots (150,0,255) into the pink end of the
    // spectrum (less B, more G). RGB distances: face (255,224,189) ≈ 128,
    // purple boots ≈ 158, red legs (200,0,0) ≈ 235, background ≈ 333.
    // Brightness chosen to be unambiguously "pink" not "magenta" at 64x64.
    if (vid === 6)  return color(255, 100, 200);
    if (vid === 7)  return color(0, 150, 255);
    if (vid === 17) return color(0, 150, 0);
    if (vid === 12) return color(200);
    if (vid === 14) return color(150, 0, 255);
    return color(255);
}

function drawToolVisual(id, x, y) {
    let c = getItemColor(id); fill(c);
    if (id === 6) {
        // Hat: monochrome in the role color (pink). Enlarged vs the
        // initial v5: 20x5 brim + 12x10 crown so the hat survives the
        // 4:1 downsample with ~5 obs px to spare. Keeping it monochrome
        // means future hat variants (other seeds, other colors) all share
        // the same brim+crown silhouette but get a unique color signal.
        rect(x - 10, y + 2, 20, 5);   // brim
        rect(x - 6, y - 8, 12, 10);   // crown
    } else if (id === 7 || id === 17) {
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

    fill(cursed ? 100 : 255, cursed ? 100 : 200, 0); rect(-10, -14, 20, 6);   // hair
    fill(cursed ? 150 : 255, 224, 189); rect(-8, -8, 16, 8);                  // face
    fill(200, 0, 0); rect(-10, 0, 20, 8);                                     // legs (always default red in v5)

    // Hat on top of head (replaces the v4 leg-recolor for the role item).
    // Drawn above the hair when equipped; uses the hat item's color.
    const hat = inventoryQueue.find(it => it.role === ROLE_HAT);
    if (hat) {
        // Monochrome hat in the role color. Enlarged vs the initial v5:
        // brim 26x5 (was 24x3) so it survives 4:1 downsample to ~1+ obs px;
        // crown 16x8 (was 14x6) so the role-color block is ~2 obs px tall.
        // Hat sits above the hair (-14..-8); brim covers y=-18..-13.
        fill(getItemColor(hat.visualId));
        rect(-13, -18, 26, 5);  // brim
        rect(-8, -26, 16, 8);   // crown
    }

    // Boots at the feet. Two small rects below the legs, colored by the
    // equipped boots' visualId. v4 recolored the legs; v5 draws separate
    // boots so the "bottom-of-avatar" signal is unambiguous.
    const boots = inventoryQueue.find(it => it.role === ROLE_BOOTS);
    if (boots) {
        fill(getItemColor(boots.visualId));
        rect(-10, 8, 8, 4);     // left boot
        rect(2, 8, 8, 4);       // right boot
    }

    inventoryQueue.forEach((item, idx) => {
        if (item.role === ROLE_SWORD) {
            push(); translate(12, 0); rotate(PI / 6); drawToolVisual(item.visualId, 0, 0); pop();
        } else if (item.role !== ROLE_BOOTS && item.role !== ROLE_HAT) {
            push(); scale(0.6); translate(-12 + idx * 10, 12); drawToolVisual(item.visualId, 0, 0); pop();
        }
    });

    pop();
}

function keyPressed() {}
