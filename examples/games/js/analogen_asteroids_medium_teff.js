// analogen_asteroids_medium
// The "medium" asteroids binding env: the EXACT cavequest_medium map, ROTATED 90
// degrees counter-clockwise, realized in the continuous-physics asteroids world on
// a 252x252 arena. The cavequest grid is upscaled 2x to a 12x12 ASCII map (gates
// 2-wide, chunky obstacles). Gate/enemy correspondence (medium -> asteroids):
//   - BLUE_DOOR (consume key)  -> ASTEROID BELT  (consume PIERCER): a breakable
//       barrier; hold PIERCER and contact it to breach (CONSUMED, +1000, phase
//       through); wrong/none = die. Blocks movement until breached.
//   - LASER (hold boots)       -> RADIATION BAND (hold SUIT/BOOTS): a hold-to-pass
//       lethal field; does NOT block movement, but crossing is lethal UNLESS the
//       SUIT (BOOTS role) is held (NOT consumed). Grays out (safe) while held.
//   - stationary enemy '1' / patrol enemy '2' -> red UFOs ('1' fixed, '2' drifts).
//       RAM one while holding the BLASTER role -> CONSUMED, UFO destroyed (+1000);
//       ram without it = die. (medium's 2 swords / 2 enemies.)
// Rotation maps cavequest goal(top-right)->top-left, spawn(bottom-left)->bottom-
// right. Forced path: items(bottom room) -> BELT -> ROOM2 -> BAND -> ROOM3(goal).
//
// Built on analogen_asteroids_easy: momentum physics, mount-location binding cue,
// deliberate SPACE pickup. 6 glyphs [6,7,12,14,17,18] -> 6 roles (5 distinct):
// functional PIERCER (belt), BOOTS/SUIT (band), BLASTER x2 (enemies); distractors
// HAT, BLUE_KEY. Role is read from the hull MOUNT LOCATION. Inventory cap 2.

const GRID = 12;
const CELL = 18;
const W = GRID * CELL, H = GRID * CELL;   // 216 x 216 (compact -> elements fill more)
const SHIP_R = 12;
const ROT_SPEED = 0.13;
const THRUST = 0.12;
const DRAG = 0.985;
const MAX_SPEED = 2.6;
const DEATH_PENALTY = 5000;
// DISABLED (0): under abs_one the win clips to +1, but a medium win takes thousands
// of frames to traverse, so a 0.005/frame living cost accrued ~-15..-30 over the
// winning journey -> "die early" beat "complete the long win" and the policy
// un-learned wins. Zeroed so the win is unambiguously the best outcome.
const STEP_PENALTY = 0;
const MAX_STEPS = 2000;
const PHASE_FRAMES = 40;

const ROLE_HAT      = 'HAT';        // distractor
const ROLE_BLUE_KEY = 'BLUE_KEY';   // distractor
const ROLE_BLASTER  = 'BLASTER';    // enemy weapon (consumed on ram-kill)
const ROLE_BOOTS    = 'BOOTS';      // SUIT: hold-to-pass the radiation band (not consumed)
const ROLE_PIERCER  = 'PIERCER';    // breach the asteroid belt (consumed)

const TOOL_VISUAL_IDS  = [6, 7, 12, 14, 17, 18];
const VALUE_VISUAL_IDS = [];
const MAX_INVENTORY = 2;
const DROP_COOLDOWN = 45;
const ENEMY_R = 14;       // bigger UFOs
const ENEMY_SPEED = 1.15;  // patrol enemy bounces actively across its room

// ASCII map (12x12) = cavequest_medium rotated 90 CCW, upscaled 2x. Legend:
//   '#' wall   '.' open   'S' spawn   'G' goal
//   'A' asteroid-belt cell (PIERCER, breakable)   'B' radiation-band cell (SUIT/BOOTS)
//   '1' stationary enemy   '2' patrol (drifting) enemy
// cavequest_medium rotated 180 (two 90-CCW turns). Goal bottom-left, spawn top-
// right. The col6-7 vertical divider carries the BELT gate (rows 2-3) = medium's
// door; the rows4-5 left divider carries the BAND gate (cols 2-3) = medium's laser.
// ROOM1 = right side (cols 8-11, items+spawn), ROOM2 = upper-left, ROOM3 = lower-
// left (goal). Stationary enemy '1' in ROOM1, patrol '2' in ROOM3.
const MAP = [
    "......##....",
    "......##..S.",
    "......AA....",
    "......AA....",
    "##BB####....",
    "##BB####....",
    "......##.1..",
    "......##....",
    "......##....",
    "...G2.##....",
    "......##....",
    "......##....",
];

let gameState = 'PLAYING';
let score = 0;
let lives = 3;
let kills = 0;       // enemies ram-killed (with BLASTER) this episode; feeds the terminal teff bonus
let episodeSteps = 0;
let inventoryQueue = [];
let toolMapping = {};
let penaltyTimer = 0;
let phasing = 0;
let effects = [];

let ship = { x: 0, y: 0, vx: 0, vy: 0, angle: -Math.PI / 2 };
let startPose = { x: 0, y: 0, angle: -Math.PI / 2 };

let walls = [];      // {x,y,w,h}
let belt = null;     // {alive, blocks:[{x,y,alive,verts}]}
let bandCells = [];  // {x,y,w,h}  hold-to-pass field cells
let items = [];
let enemies = [];    // {x,y,vx,vy,r,alive}
let stars = [];
let goal = { x: 0, y: 0, r: 15 };

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
    createCanvas(W, H);
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
    kills = 0;
    inventoryQueue = [];
    penaltyTimer = 0;
    phasing = 0;
    effects = [];
    episodeSteps = 0;
    gameState = 'PLAYING';
    shuffleRoles();
    initWorld();
    resetShip();
}

function shuffleRoles() {
    const toolRoles = [ROLE_PIERCER, ROLE_BOOTS, ROLE_BLASTER, ROLE_BLASTER, ROLE_HAT, ROLE_BLUE_KEY];
    shuffleInPlace(toolRoles);
    toolMapping = {};
    TOOL_VISUAL_IDS.forEach((vid, i) => { toolMapping[vid] = toolRoles[i]; });
}

function cx(c) { return c * CELL + CELL / 2; }   // cell-col center x
function cy(r) { return r * CELL + CELL / 2; }   // cell-row center y

// Flood-fill the open room containing cell (c0,r0). Walls, belt AND band count as
// barriers (enemies can't cross the radiation band either), so the patrol stays in
// its room. Returns the pixel bounding box of the room, inset by ENEMY_R.
function roomBox(c0, r0) {
    const blocked = (c, r) => c < 0 || c >= GRID || r < 0 || r >= GRID ||
        MAP[r][c] === '#' || MAP[r][c] === 'A' || MAP[r][c] === 'B';
    const seen = new Set(); const stack = [[c0, r0]];
    let minC = GRID, maxC = -1, minR = GRID, maxR = -1;
    while (stack.length) {
        const [c, r] = stack.pop(); const k = c + ',' + r;
        if (seen.has(k) || blocked(c, r)) continue;
        seen.add(k);
        if (c < minC) minC = c; if (c > maxC) maxC = c; if (r < minR) minR = r; if (r > maxR) maxR = r;
        stack.push([c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]);
    }
    return { xMin: minC * CELL + ENEMY_R, xMax: (maxC + 1) * CELL - ENEMY_R,
             yMin: minR * CELL + ENEMY_R, yMax: (maxR + 1) * CELL - ENEMY_R };
}

function initWorld() {
    walls = []; bandCells = []; items = []; enemies = [];
    const beltBlocks = [];
    const itemCells = [];
    const enemyCells = [];

    for (let r = 0; r < GRID; r++) {
        for (let c = 0; c < GRID; c++) {
            const ch = MAP[r][c];
            const x = c * CELL, y = r * CELL;
            if (ch === '#') {
                walls.push({ x, y, w: CELL, h: CELL });
            } else if (ch === 'A') {
                const verts = [];
                for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; const rr = 9 + rng() * 3; verts.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
                beltBlocks.push({ x: cx(c), y: cy(r), alive: true, verts });
            } else if (ch === 'B') {
                bandCells.push({ x, y, w: CELL, h: CELL, cxv: cx(c), cyv: cy(r) });
            } else if (ch === 'S') {
                startPose.x = cx(c); startPose.y = cy(r);
            } else if (ch === 'G') {
                goal.x = cx(c); goal.y = cy(r);
            } else if (ch === '1' || ch === '2') {
                enemyCells.push({ x: cx(c), y: cy(r), c, r, patrol: ch === '2' });  // '1' stationary, '2' patrol
            }
            if (ch === '.' || ch === 'S') {
                if (c >= 8) itemCells.push({ x: cx(c), y: cy(r) });   // ROOM1 (right side) item candidates
            }
        }
    }
    belt = { alive: true, blocks: beltBlocks };

    // 6 item glyphs in ROOM1, spaced, away from the spawn, the stationary enemy
    // (no overlap), AND the asteroid belt (keep items clear of the belt).
    const statEnemy = enemyCells.find(e => !e.patrol);
    const cands = itemCells.filter(p =>
        dist(p.x, p.y, startPose.x, startPose.y) > CELL * 1.35 &&   // just clear of the ship at spawn
        (!statEnemy || dist(p.x, p.y, statEnemy.x, statEnemy.y) > CELL * 1.9) &&
        beltBlocks.every(b => dist(p.x, p.y, b.x, b.y) > CELL * 2.0));
    shuffleInPlace(cands);
    const placed = [];
    for (const p of cands) {
        if (placed.length >= TOOL_VISUAL_IDS.length) break;
        if (placed.every(q => dist(p.x, p.y, q.x, q.y) > CELL * 1.6)) placed.push(p);
    }
    while (placed.length < TOOL_VISUAL_IDS.length && cands.length) placed.push(cands[placed.length % cands.length]);
    TOOL_VISUAL_IDS.forEach((vid, i) => {
        const p = placed[i];
        items.push({ x: p.x, y: p.y, r: 10, kind: 'tool', visualId: vid, cooldown: 0, taken: false });
    });

    // Enemies: '1' stationary (fixed, no box). '2' patrols a FIXED diamond path,
    // confined to its room: it starts at the top-mid of the room box moving at 45
    // degrees, so it bounces top->right->bottom->left->top, tracing a diamond. The
    // room box (flood-filled, band/belt are barriers) keeps it from leaking out.
    for (const ec of enemyCells) {
        if (ec.patrol) {
            const box = roomBox(ec.c, ec.r);
            enemies.push({ x: (box.xMin + box.xMax) / 2, y: box.yMin,
                vx: ENEMY_SPEED, vy: ENEMY_SPEED, r: ENEMY_R, alive: true, box });
        } else {
            enemies.push({ x: ec.x, y: ec.y, vx: 0, vy: 0, r: ENEMY_R, alive: true, box: null });
        }
    }

    // Center the goal in the patrol's room so the diamond orbits around it.
    const patrolE = enemies.find(e => e.box);
    if (patrolE) {
        goal.x = (patrolE.box.xMin + patrolE.box.xMax) / 2;
        goal.y = (patrolE.box.yMin + patrolE.box.yMax) / 2;
    }

    stars = [];
    for (let i = 0; i < 26; i++) stars.push({ x: rng() * W, y: rng() * H, b: 35 + rng() * 45 });
}

function resetShip() {
    ship.x = startPose.x; ship.y = startPose.y;
    ship.vx = 0; ship.vy = 0; ship.angle = startPose.angle;
}

function updateGame() {
    episodeSteps++;
    score -= STEP_PENALTY;
    if (penaltyTimer > 0) penaltyTimer--;
    if (phasing > 0) phasing--;
    for (const it of items) if (it.cooldown > 0) it.cooldown--;

    moveEnemies();

    if (keyIsDown(LEFT_ARROW))  ship.angle -= ROT_SPEED;
    if (keyIsDown(RIGHT_ARROW)) ship.angle += ROT_SPEED;
    if (keyIsDown(UP_ARROW))   { ship.vx += Math.cos(ship.angle) * THRUST; ship.vy += Math.sin(ship.angle) * THRUST; }
    if (keyIsDown(DOWN_ARROW)) { ship.vx *= 0.88; ship.vy *= 0.88; }
    ship.vx *= DRAG; ship.vy *= DRAG;
    const sp = Math.hypot(ship.vx, ship.vy);
    if (sp > MAX_SPEED) { ship.vx *= MAX_SPEED / sp; ship.vy *= MAX_SPEED / sp; }

    let nx = ship.x + ship.vx;
    let ny = ship.y + ship.vy;
    if (blocked(nx, ship.y)) { ship.vx = 0; nx = ship.x; }
    if (blocked(ship.x, ny)) { ship.vy = 0; ny = ship.y; }
    ship.x = Math.max(SHIP_R, Math.min(W - SHIP_R, nx));
    ship.y = Math.max(SHIP_R, Math.min(H - SHIP_R, ny));

    resolveContacts();
}

function moveEnemies() {
    for (const e of enemies) {
        if (!e.alive || !e.box) continue;   // stationary enemies (no box) never move
        let nx = e.x + e.vx, ny = e.y + e.vy;
        // bounce off the room box edges -> fixed diamond path, confined to the room.
        if (nx < e.box.xMin) { e.vx = Math.abs(e.vx);  nx = e.box.xMin; }
        if (nx > e.box.xMax) { e.vx = -Math.abs(e.vx); nx = e.box.xMax; }
        if (ny < e.box.yMin) { e.vy = Math.abs(e.vy);  ny = e.box.yMin; }
        if (ny > e.box.yMax) { e.vy = -Math.abs(e.vy); ny = e.box.yMax; }
        e.x = nx; e.y = ny;
    }
}

// circle (x,y,r) overlaps any wall cell?
function wallHit(x, y, r) {
    for (const wl of walls) {
        if (x + r > wl.x && x - r < wl.x + wl.w && y + r > wl.y && y - r < wl.y + wl.h) return true;
    }
    return false;
}

// ship blocked by walls or (when not phasing) a live belt block.
function blocked(x, y) {
    if (wallHit(x, y, SHIP_R)) return true;
    if (phasing <= 0 && belt && belt.alive) {
        for (const blk of belt.blocks) {
            if (blk.alive && Math.abs(x - blk.x) < CELL * 0.5 + SHIP_R && Math.abs(y - blk.y) < CELL * 0.5 + SHIP_R) return true;
        }
    }
    return false;
}

function resolveBelt() {
    if (phasing > 0 || !belt || !belt.alive) return;
    for (const blk of belt.blocks) {
        if (!blk.alive) continue;
        if (Math.abs(ship.x - blk.x) < CELL * 0.5 + SHIP_R + 2 && Math.abs(ship.y - blk.y) < CELL * 0.5 + SHIP_R + 2) {
            if (hasItem(ROLE_PIERCER)) {
                consumeItem(ROLE_PIERCER);
                for (const b of belt.blocks) { if (b.alive) { b.alive = false; spawnRockBurst(b.x, b.y); } }
                belt.alive = false;
                phasing = PHASE_FRAMES;
                score += 1000;
            } else {
                die();
            }
            return;
        }
    }
}

function resolveBand() {
    for (const bc of bandCells) {
        if (ship.x + SHIP_R * 0.6 > bc.x && ship.x - SHIP_R * 0.6 < bc.x + bc.w &&
            ship.y + SHIP_R * 0.6 > bc.y && ship.y - SHIP_R * 0.6 < bc.y + bc.h) {
            if (!hasItem(ROLE_BOOTS)) die();
            return;
        }
    }
}

function resolveEnemies() {
    for (const e of enemies) {
        if (!e.alive) continue;
        if (dist(ship.x, ship.y, e.x, e.y) < SHIP_R + e.r) {
            if (hasItem(ROLE_BLASTER)) {
                consumeItem(ROLE_BLASTER); e.alive = false; kills++; score += 1000; spawnRockBurst(e.x, e.y);
            } else {
                die();
            }
            return;
        }
    }
}

function tryPickup() {
    for (const it of items) {
        if (it.taken || it.cooldown > 0) continue;
        if (dist(ship.x, ship.y, it.x, it.y) < SHIP_R + it.r) {
            addItem(toolMapping[it.visualId], it.visualId);
            it.taken = true;
            return true;
        }
    }
    return false;
}

function resolveContacts() {
    resolveBelt();
    if (gameState !== 'PLAYING') return;
    resolveBand();
    if (gameState !== 'PLAYING') return;
    resolveEnemies();
    if (gameState !== 'PLAYING') return;
    if (dist(ship.x, ship.y, goal.x, goal.y) < SHIP_R + goal.r) handleVictory();
}

function handleVictory() {
    // TERMINAL EFFICIENCY BONUS (asteroids_medium_teff): reward reaching the goal
    // FAST (direct flight path), with LIVES intact, having CLEARED enemies. All
    // three ride the single terminal win event through the learner's graded win
    // clip (win_bonus_slope), which maps the raw terminal into [win_bonus,
    // win_bonus_max] — so the policy learns efficiency WITHOUT weakening the
    // consolidation signal that pinned greedy=1.0. No per-step penalty -> no
    // exploration tax. Terminal range must fit the graded band without clamping:
    //   min = 50000 + 1*10000                 = 60000
    //   max = 50000 + 3*10000 + 2*20000 + 40000 = 160000
    // so configs set win_bonus_slope = 10/(160000-30000) = 0.00007692 (max->20).
    // KILL_BONUS=20000 (== 2 lives): killing costs a detour (lower speedBonus),
    // so it must outweigh the speed it burns to be worth engaging.
    const TEFF_MAX = 40000, TEFF_SPAN = 20000;  // asteroids wins take longer than cqhex2
    const KILL_BONUS = 20000;
    const speedBonus = TEFF_MAX * Math.max(0, 1 - frameCount / TEFF_SPAN);
    score += 50000 + lives * 10000 + kills * KILL_BONUS + speedBonus;
    gameState = 'WIN';
}

function die() {
    spawnDeath(ship.x, ship.y);
    score = Math.max(0, score - DEATH_PENALTY);
    lives--;
    phasing = 0;
    if (lives <= 0) gameState = 'GAMEOVER';
    else            resetShip();
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
        items.push({ x: ship.x, y: ship.y, r: 10, kind: 'tool', visualId: dropped.visualId, cooldown: DROP_COOLDOWN, taken: false });
    }
    inventoryQueue.push({ role, visualId });
}

// ---------------- cosmetic effects ----------------
function spawnRockBurst(x, y) {
    const n = 5;
    for (let k = 0; k < n; k++) {
        const ang = (k / n) * Math.PI * 2 + rng() * 0.8; const sp = 0.6 + rng() * 1.1; const life = 14 + (rng() * 8 | 0);
        effects.push({ kind: 'shard', x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, rot: rng() * Math.PI * 2, vrot: (rng() - 0.5) * 0.4, size: 2.2 + rng() * 1.6, life, max: life, col: [120, 120, 138], alpha: 230 });
    }
    const flife = 7;
    effects.push({ kind: 'flash', x, y, vx: 0, vy: 0, rot: 0, vrot: 0, grow: 2.4, size: 3, life: flife, max: flife, col: [220, 220, 235], alpha: 170 });
}

function spawnDeath(x, y) {
    const flife = 12;
    effects.push({ kind: 'flash', x, y, vx: 0, vy: 0, rot: 0, vrot: 0, grow: 3.0, size: 4, life: flife, max: flife, col: [255, 130, 60], alpha: 150 });
    const n = 6;
    for (let k = 0; k < n; k++) {
        const ang = (k / n) * Math.PI * 2 + rng() * 0.6; const sp = 0.8 + rng() * 1.3; const life = 12 + (rng() * 8 | 0);
        effects.push({ kind: 'spark', x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, rot: 0, vrot: 0, size: 2.4 + rng() * 1.2, life, max: life, col: k % 2 ? [255, 200, 90] : [255, 240, 220], alpha: 235 });
    }
}

function updateEffects() {
    for (let i = effects.length - 1; i >= 0; i--) {
        const e = effects[i];
        e.x += e.vx; e.y += e.vy; e.vx *= 0.90; e.vy *= 0.90; e.rot += e.vrot;
        if (--e.life <= 0) effects.splice(i, 1);
    }
}

function drawEffects() {
    for (const e of effects) {
        const t = e.life / e.max; const a = Math.max(0, e.alpha * t);
        if (e.kind === 'flash') {
            const r = e.size * (1 + (1 - t) * e.grow); fill(e.col[0], e.col[1], e.col[2], a); ellipse(e.x, e.y, r * 2, r * 2);
        } else if (e.kind === 'shard') {
            push(); translate(e.x, e.y); rotate(e.rot); fill(e.col[0], e.col[1], e.col[2], a); const s = e.size; triangle(-s, s * 0.6, s, s * 0.3, 0, -s); pop();
        } else if (e.kind === 'spark') {
            const s = e.size * (0.4 + t * 0.8); fill(e.col[0], e.col[1], e.col[2], a); rect(e.x - s * 0.5, e.y - s * 0.5, s, s);
        }
    }
}

// ---------------- rendering ----------------
function drawGame() {
    for (const s of stars) { fill(s.b); rect(s.x, s.y, 1.5, 1.5); }
    for (const bc of bandCells) drawBandCell(bc);
    // walls: single flat fill per cell (no inset border), so adjacent wall cells
    // merge into one seamless mass with no visible block/grid lines between them.
    for (const wl of walls) { fill(46, 33, 60); rect(wl.x, wl.y, wl.w, wl.h); }
    drawBelt();
    drawGoal();
    for (const e of enemies) if (e.alive) drawEnemy(e);
    for (const it of items) {
        if (it.taken) continue;
        if (it.cooldown > 0 && frameCount % 10 < 5) continue;
        drawToolVisual(it.visualId, it.x, it.y, 1.4);
    }
    drawShip();
    updateEffects();
    drawEffects();
}

function drawBandCell(bc) {
    const safe = hasItem(ROLE_BOOTS);
    if (safe) {
        fill(70, 70, 78); rect(bc.x, bc.y, bc.w, bc.h);
        fill(110, 110, 120); rect(bc.x, bc.cyv - 1, bc.w, 2);
    } else {
        fill(150, 50, 40, 170); rect(bc.x, bc.y, bc.w, bc.h);
        for (let yy = bc.y + 2; yy < bc.y + bc.h; yy += 5) { fill(255, 210, 70); rect(bc.x, yy, bc.w, 2); }
    }
}

function drawBelt() {
    if (!belt || !belt.alive) return;
    for (const blk of belt.blocks) {
        if (!blk.alive) continue;
        fill(120, 120, 138);
        beginShape();
        for (const v of blk.verts) vertex(blk.x + v[0], blk.y + v[1]);
        endShape(CLOSE);
        fill(78, 78, 96);
        rect(blk.x - 4, blk.y - 2, 4, 4); rect(blk.x + 1, blk.y + 1, 3, 3);
    }
}

function drawEnemy(e) {
    push();
    translate(e.x, e.y);
    fill(150, 30, 40); ellipse(0, 1, e.r * 2.2, e.r * 1.1);
    fill(230, 70, 80); ellipse(0, 0, e.r * 2.0, e.r * 0.9);
    fill(255, 200, 90); ellipse(0, -2, e.r * 0.9, e.r * 0.7);
    fill(120, 20, 30);
    for (let k = -1; k <= 1; k++) ellipse(k * e.r * 0.6, 2, 2.5, 2.5);
    pop();
}

function drawGoal() {
    const dia = (R, r, g2, b) => {
        fill(r, g2, b);
        beginShape();
        vertex(goal.x, goal.y - R); vertex(goal.x + R, goal.y); vertex(goal.x, goal.y + R); vertex(goal.x - R, goal.y);
        endShape(CLOSE);
    };
    dia(goal.r + 4, 0, 110, 84);
    dia(goal.r,     0, 220, 160);
    dia(goal.r - 5, 12, 30, 30);
    dia(goal.r - 9, 150, 255, 230);
}

function getItemColor(vid) {
    if (vid === 6)  return [255, 100, 200];
    if (vid === 7)  return [40, 110, 255];
    if (vid === 17) return [0, 200, 80];
    if (vid === 12) return [0, 220, 210];
    if (vid === 14) return [170, 80, 255];
    if (vid === 18) return [0, 200, 170];
    return [255, 255, 255];
}

function drawToolVisual(id, x, y, s) {
    const rgb  = getItemColor(id);
    const lite = [Math.min(255, rgb[0] + 70), Math.min(255, rgb[1] + 70), Math.min(255, rgb[2] + 70)];
    const dark = [rgb[0] * 0.5, rgb[1] * 0.5, rgb[2] * 0.5];
    const R = 7 * s;
    if (id === 6) {
        fill(dark[0], dark[1], dark[2]); rect(x - R * 0.5, y - R - 2 * s, R, 2 * s);
        fill(rgb[0], rgb[1], rgb[2]);    rect(x - R * 0.8, y - R, R * 1.6, R * 2, 2);
        fill(lite[0], lite[1], lite[2]); rect(x - R * 0.8, y - R * 0.3, R * 1.6, R * 0.5);
    } else if (id === 7) {
        fill(rgb[0], rgb[1], rgb[2]);    rect(x - R, y - R * 0.65, R * 2, R * 1.3, 3);
        fill(dark[0], dark[1], dark[2]); rect(x - R * 0.45, y - R * 0.65, R * 0.3, R * 1.3);
        fill(dark[0], dark[1], dark[2]); rect(x + R * 0.15, y - R * 0.65, R * 0.3, R * 1.3);
    } else if (id === 12) {
        fill(dark[0], dark[1], dark[2]);
        for (let k = -1; k <= 1; k++) {
            rect(x - R - 2 * s, y + k * R * 0.5 - s, 2 * s, 2 * s);
            rect(x + R,         y + k * R * 0.5 - s, 2 * s, 2 * s);
        }
        fill(rgb[0], rgb[1], rgb[2]);    rect(x - R * 0.85, y - R * 0.85, R * 1.7, R * 1.7, 1);
        fill(lite[0], lite[1], lite[2]); ellipse(x, y, R * 0.7);
    } else if (id === 14) {
        fill(rgb[0], rgb[1], rgb[2]);
        beginShape();
        for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + Math.PI / 8; vertex(x + Math.cos(a) * R, y + Math.sin(a) * R); }
        endShape(CLOSE);
        fill(lite[0], lite[1], lite[2]); ellipse(x, y, R * 0.8);
    } else if (id === 17) {
        fill(dark[0], dark[1], dark[2]); rect(x - R * 0.5, y - R - 2 * s, R, 2.5 * s, 1);
        fill(rgb[0], rgb[1], rgb[2]);    rect(x - R * 0.7, y - R, R * 1.4, R * 2, R * 0.7);
        fill(lite[0], lite[1], lite[2]); ellipse(x, y - R * 0.3, R * 0.6);
    } else if (id === 18) {
        fill(rgb[0], rgb[1], rgb[2]);    rect(x - R * 0.6, y - R, R * 1.2, R * 1.7, 2);
        fill(dark[0], dark[1], dark[2]); triangle(x - R * 0.6, y + R * 0.7, x + R * 0.6, y + R * 0.7, x, y + R * 1.5);
        fill(lite[0], lite[1], lite[2]); rect(x - R * 0.9, y - R * 0.4, R * 0.4, R * 0.9);
        fill(lite[0], lite[1], lite[2]); rect(x + R * 0.5, y - R * 0.4, R * 0.4, R * 0.9);
    }
}

function drawShip() {
    const cursed = penaltyTimer > 0 && penaltyTimer % 4 < 2;
    push();
    translate(ship.x, ship.y);

    for (const held of inventoryQueue) {
        const c = getItemColor(held.visualId);
        fill(c[0], c[1], c[2], phasing > 0 ? 90 : 45);
        ellipse(0, 0, SHIP_R * 2.8, SHIP_R * 2.8);
    }

    rotate(ship.angle);

    const boots = inventoryQueue.find(it => it.role === ROLE_BOOTS);
    if (boots) {
        const c = getItemColor(boots.visualId); const len = keyIsDown(UP_ARROW) ? 16 : 10;
        fill(c[0], c[1], c[2]); triangle(-SHIP_R + 1, -5.5, -SHIP_R + 1, 5.5, -SHIP_R - len, 0);
    } else if (keyIsDown(UP_ARROW)) {
        fill(255, 160, 40); triangle(-SHIP_R + 1, -5, -SHIP_R + 1, 5, -SHIP_R - 12, 0);
    }

    fill(70, 80, 100);
    triangle(-SHIP_R + 2, -3, -SHIP_R - 2, -7, -2, -3);
    triangle(-SHIP_R + 2,  3, -SHIP_R - 2,  7, -2,  3);
    fill(cursed ? [255, 90, 90] : [225, 235, 250]);
    beginShape();
    vertex(SHIP_R + 3, 0); vertex(2, -SHIP_R * 0.62); vertex(-SHIP_R + 2, -SHIP_R * 0.5); vertex(-SHIP_R + 2,  SHIP_R * 0.5); vertex(2,  SHIP_R * 0.62);
    endShape(CLOSE);
    // cockpit (the avatar) — enlarged
    fill(120, 150, 200); ellipse(SHIP_R * 0.2, 0, SHIP_R * 0.82, SHIP_R * 0.72);
    fill(185, 210, 240); ellipse(SHIP_R * 0.32, -SHIP_R * 0.12, SHIP_R * 0.32, SHIP_R * 0.28);

    const piercer = inventoryQueue.find(it => it.role === ROLE_PIERCER);
    if (piercer) { const c = getItemColor(piercer.visualId); fill(c[0], c[1], c[2]); triangle(SHIP_R + 8, 0, SHIP_R - 1, -2.5, SHIP_R - 1, 2.5); }

    const blaster = inventoryQueue.find(it => it.role === ROLE_BLASTER);
    if (blaster) { const c = getItemColor(blaster.visualId); fill(c[0], c[1], c[2]); rect(0, -SHIP_R * 0.95, 7, 3); rect(0, SHIP_R * 0.95 - 3, 7, 3); }

    const hat = inventoryQueue.find(it => it.role === ROLE_HAT);
    if (hat) { const c = getItemColor(hat.visualId); fill(c[0], c[1], c[2]); ellipse(SHIP_R * 0.2, 0, SHIP_R * 0.82, SHIP_R * 0.72); }

    const key = inventoryQueue.find(it => it.role === ROLE_BLUE_KEY);
    if (key) { const c = getItemColor(key.visualId); fill(c[0], c[1], c[2]); rect(SHIP_R - 3, 3, 4, 4); }

    pop();
}

function keyPressed() {
    if (keyCode === 32) tryPickup();
}
