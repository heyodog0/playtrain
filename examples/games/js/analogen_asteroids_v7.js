// analogen_asteroids_v7
// A NEW DOMAIN that derives the EXACT SAME binding principles as
// analogen_nomemory_grid_v7, but with asteroids-style continuous physics
// (rotate + thrust + momentum + drift) instead of grid movement.
//
// Same semantics as v7 (the research principle is identical):
//   - 5 tool visual ids [6,7,12,14,17] are shuffled to 5 roles each episode
//     (HAT, BLUE_KEY, BOOTS, SWORD, ARMOR) via the SAME mulberry32 + Fisher-Yates
//     as v7. The agent must read the per-episode binding from pixels.
//   - 2 PROTECTIVE hold-to-pass hazards (lethal unless the bound item is held):
//       LASER band  <- BOOTS      RADIATION band <- HAT
//   - 3 CONSUMABLE contact-gates (engage by contact, item consumed, +1000):
//       FORCE-FIELD <- BLUE_KEY (blocked, no death, until opened)
//       ASTEROIDS   <- ARMOR    (lethal without; cleared with)
//       UFO enemy   <- SWORD    (lethal without; killed with)
//   - Inventory cap 2 with drops, +500 pickup, +1000 gate/reward, -1000 curse,
//     -5000 death, win = +50000 + lives*10000, per-frame living cost.
//   - Forced path: collect items in the bottom field (managing the 2-slot
//     inventory), then fly UP a walled channel through
//     LASER -> ASTEROIDS -> FORCE-FIELD -> RADIATION -> GOAL.
//   Solvable on cap 2 the same way v7 is: BOOTS persists (channel mouth),
//   ARMOR/KEY are consumed one-and-done, HAT is held on the final approach.
//
// Controls (asteroids): LEFT/RIGHT rotate, UP thrusts along heading, DOWN brakes;
// momentum + drag. Interactions are by contact (ram a gate while holding the
// matching item). The fire button is unused (collision-based, like v7's "walk
// into it"). Canvas 256x256 -> 64x64 obs at the usual 4:1 downsample.

const W = 256, H = 256;
const SHIP_R = 9;
const ROT_SPEED = 0.13;     // radians/frame
const THRUST = 0.16;        // accel/frame
const DRAG = 0.985;         // velocity damping per frame
const MAX_SPEED = 3.6;
const DEATH_PENALTY = 5000;
const STEP_PENALTY = 0.005; // per-frame living cost (sized for symlog, as in v7)
const MAX_STEPS = 2000;

const ROLE_HAT      = 'HAT';
const ROLE_BLUE_KEY = 'BLUE_KEY';
const ROLE_SWORD    = 'SWORD';
const ROLE_BOOTS    = 'BOOTS';
const ROLE_ARMOR    = 'ARMOR';
const ROLE_REWARD   = 'REWARD';
const ROLE_CURSE    = 'CURSE';

const TOOL_VISUAL_IDS  = [6, 7, 12, 14, 17];
const VALUE_VISUAL_IDS = [8, 15];
const MAX_INVENTORY = 2;
const DROP_COOLDOWN = 45;

// Walled channel geometry. Field (bottom) is full width below CHANNEL_BOTTOM;
// above it the only passage is the channel x in [CH_L, CH_R].
const CH_L = 96, CH_R = 160, CHANNEL_BOTTOM = 152;
const BAND_H = 9;  // half-thickness of a hazard/gate band

let gameState = 'PLAYING';
let score = 0;
let lives = 3;
let episodeSteps = 0;
let inventoryQueue = [];
let toolMapping = {};
let valueMapping = {};
let penaltyTimer = 0;

let ship = { x: 128, y: 224, vx: 0, vy: 0, angle: -Math.PI / 2 };
let startPose = { x: 128, y: 224, angle: -Math.PI / 2 };

let items = [];     // {x,y,r,kind:'tool'|'value', visualId, cooldown}
let gates = [];     // {kind:'protect'|'door'|'asteroids', role, y, alive, rocks?}
let enemies = [];   // {x,y,r,dir,role}
let walls = [];     // {x,y,w,h}
let stars = [];     // {x,y,b}
let goal = { x: 128, y: 26, r: 12 };

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
    inventoryQueue = [];
    penaltyTimer = 0;
    episodeSteps = 0;
    gameState = 'PLAYING';
    shuffleRoles();
    initWorld();
    resetShip();
}

function shuffleRoles() {
    const toolRoles = [ROLE_HAT, ROLE_BLUE_KEY, ROLE_BOOTS, ROLE_SWORD, ROLE_ARMOR];
    shuffleInPlace(toolRoles);
    toolMapping = {};
    TOOL_VISUAL_IDS.forEach((vid, i) => { toolMapping[vid] = toolRoles[i]; });

    const valueRoles = [ROLE_REWARD, ROLE_CURSE];
    if (rng() > 0.5) valueRoles.reverse();
    valueMapping = {};
    VALUE_VISUAL_IDS.forEach((vid, i) => { valueMapping[vid] = valueRoles[i]; });
}

function initWorld() {
    // Channel walls: everything above CHANNEL_BOTTOM except x in [CH_L,CH_R].
    walls = [
        { x: 0,    y: 0, w: CH_L,       h: CHANNEL_BOTTOM },
        { x: CH_R, y: 0, w: W - CH_R,   h: CHANNEL_BOTTOM },
    ];

    // Forced sequence up the channel (bottom -> top):
    //   LASER(boots) -> ASTEROIDS(armor) -> FORCE-FIELD(key) -> RADIATION(hat) -> GOAL
    gates = [
        { kind: 'protect',   role: ROLE_BOOTS,    y: 144 },
        { kind: 'asteroids', role: ROLE_ARMOR,    y: 112, alive: true, rocks: makeRocks(112) },
        { kind: 'door',      role: ROLE_BLUE_KEY, y: 82,  alive: true },
        { kind: 'protect',   role: ROLE_HAT,      y: 50 },
    ];

    // One UFO enemy patrolling the field (SWORD kills it; avoidable distractor).
    enemies = [{ x: 70 + rng() * 116, y: 184, r: 10, dir: rng() > 0.5 ? 1 : -1, role: ROLE_SWORD }];

    // Items scattered in the bottom field. 5 tool ids + the rest value items.
    items = [];
    const placed = [];
    const tooClose = (x, y) => {
        if (dist(x, y, startPose.x, startPose.y) < 34) return true;
        for (const p of placed) if (dist(x, y, p.x, p.y) < 30) return true;
        return false;
    };
    const drawPos = () => {
        for (let tries = 0; tries < 60; tries++) {
            const x = 24 + rng() * (W - 48);
            const y = CHANNEL_BOTTOM + 12 + rng() * (H - CHANNEL_BOTTOM - 30);
            if (!tooClose(x, y)) return { x, y };
        }
        return { x: 24 + rng() * (W - 48), y: CHANNEL_BOTTOM + 12 + rng() * (H - CHANNEL_BOTTOM - 30) };
    };
    TOOL_VISUAL_IDS.forEach((vid) => {
        const p = drawPos(); placed.push(p);
        items.push({ x: p.x, y: p.y, r: 8, kind: 'tool', visualId: vid, cooldown: 0 });
    });
    // A couple of value-item distractors (reward/curse).
    for (let k = 0; k < 3; k++) {
        const p = drawPos(); placed.push(p);
        const vid = VALUE_VISUAL_IDS[rng() > 0.5 ? 0 : 1];
        items.push({ x: p.x, y: p.y, r: 8, kind: 'value', visualId: vid, cooldown: 0 });
    }

    // Static starfield (seeded, dim, sparse so it never masks the binding cue).
    stars = [];
    for (let i = 0; i < 22; i++) stars.push({ x: rng() * W, y: rng() * H, b: 40 + rng() * 50 });
}

function makeRocks(yc) {
    // A row of jagged asteroids spanning the channel = one ARMOR gate.
    const rocks = [];
    for (let cx = CH_L + 12; cx <= CH_R - 12; cx += 22) {
        const verts = [];
        const n = 8;
        for (let k = 0; k < n; k++) {
            const a = (k / n) * Math.PI * 2;
            const rr = 9 + rng() * 5;
            verts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
        }
        rocks.push({ x: cx, y: yc, verts });
    }
    return rocks;
}

function resetShip() {
    ship.x = startPose.x; ship.y = startPose.y;
    ship.vx = 0; ship.vy = 0; ship.angle = startPose.angle;
}

function updateGame() {
    episodeSteps++;
    score -= STEP_PENALTY;
    if (penaltyTimer > 0) penaltyTimer--;
    for (const it of items) if (it.cooldown > 0) it.cooldown--;

    // --- enemy patrol (field) ---
    for (const e of enemies) {
        e.x += e.dir * 0.7;
        if (e.x < 24 || e.x > W - 24) e.dir *= -1;
    }

    // --- ship physics ---
    if (keyIsDown(LEFT_ARROW))  ship.angle -= ROT_SPEED;
    if (keyIsDown(RIGHT_ARROW)) ship.angle += ROT_SPEED;
    if (keyIsDown(UP_ARROW))   { ship.vx += Math.cos(ship.angle) * THRUST; ship.vy += Math.sin(ship.angle) * THRUST; }
    if (keyIsDown(DOWN_ARROW)) { ship.vx *= 0.88; ship.vy *= 0.88; }
    ship.vx *= DRAG; ship.vy *= DRAG;
    const sp = Math.hypot(ship.vx, ship.vy);
    if (sp > MAX_SPEED) { ship.vx *= MAX_SPEED / sp; ship.vy *= MAX_SPEED / sp; }

    // integrate with separable wall/boundary collision (slide along walls)
    let nx = ship.x + ship.vx;
    let ny = ship.y + ship.vy;
    if (blocked(nx, ship.y)) { ship.vx = 0; nx = ship.x; }
    if (blocked(ship.x, ny)) { ship.vy = 0; ny = ship.y; }
    ship.x = Math.max(SHIP_R, Math.min(W - SHIP_R, nx));
    ship.y = Math.max(SHIP_R, Math.min(H - SHIP_R, ny));

    resolveContacts();
}

// True if the ship circle at (x,y) overlaps a wall, a locked door, or a live
// asteroid gate (these act as solid barriers).
function blocked(x, y) {
    for (const wl of walls) {
        if (x + SHIP_R > wl.x && x - SHIP_R < wl.x + wl.w &&
            y + SHIP_R > wl.y && y - SHIP_R < wl.y + wl.h) return true;
    }
    for (const g of gates) {
        if (g.kind === 'door' && g.alive && inChannel(x) && Math.abs(y - g.y) < BAND_H + SHIP_R) {
            if (!hasItem(ROLE_BLUE_KEY)) return true;  // locked = solid; with key it opens on contact
        }
    }
    return false;
}

function inChannel(x) { return x > CH_L && x < CH_R; }

function resolveContacts() {
    const x = ship.x, y = ship.y;

    // --- hazards / gates in the channel ---
    for (const g of gates) {
        const overlap = inChannel(x) && Math.abs(y - g.y) < BAND_H + SHIP_R;
        if (!overlap) continue;
        if (g.kind === 'protect') {
            if (!hasItem(g.role)) { die(); return; }       // laser/radiation: lethal without item
        } else if (g.kind === 'asteroids') {
            if (!g.alive) continue;
            if (hasItem(g.role)) { consumeItem(g.role); g.alive = false; score += 1000; }
            else { die(); return; }
        } else if (g.kind === 'door') {
            if (g.alive && hasItem(g.role)) { consumeItem(g.role); g.alive = false; score += 1000; }
            // locked door without key is handled as solid in blocked(); no death.
        }
    }

    // --- enemies (UFOs) ---
    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        if (dist(x, y, e.x, e.y) < SHIP_R + e.r) {
            if (hasItem(e.role)) { consumeItem(e.role); score += 1000; enemies.splice(i, 1); }
            else { die(); return; }
        }
    }

    // --- item pickups ---
    for (const it of items) {
        if (it.taken || it.cooldown > 0) continue;
        if (dist(x, y, it.x, it.y) < SHIP_R + it.r) {
            if (it.kind === 'tool') {
                const role = toolMapping[it.visualId];
                addItem(role, it.visualId);
                score += 500;
                it.taken = true;
            } else {
                const role = valueMapping[it.visualId];
                if (role === ROLE_REWARD) score += 1000;
                else { score -= 1000; penaltyTimer = 30; }
                it.taken = true;
            }
        }
    }

    // --- goal ---
    if (dist(x, y, goal.x, goal.y) < SHIP_R + goal.r) handleVictory();
}

function handleVictory() {
    score += 50000 + lives * 10000;
    gameState = 'WIN';
}

function die() {
    score = Math.max(0, score - DEATH_PENALTY);
    lives--;
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
        // Drop the oldest item back into space at the ship, with a re-pickup
        // cooldown (mirrors v7's persistentDrops).
        const dropped = inventoryQueue.shift();
        items.push({ x: ship.x, y: ship.y, r: 8, kind: 'tool',
                     visualId: dropped.visualId, cooldown: DROP_COOLDOWN, taken: false });
    }
    inventoryQueue.push({ role, visualId });
}

// ---------------- rendering (asteroids aesthetic) ----------------

function drawGame() {
    for (const s of stars) { fill(s.b); rect(s.x, s.y, 1.5, 1.5); }

    // walls = asteroid-belt boundary
    for (const wl of walls) {
        fill(34, 34, 52); rect(wl.x, wl.y, wl.w, wl.h);
        fill(50, 50, 74);
        for (let i = 0; i < 6; i++) {
            const sx = wl.x + ((i * 53) % Math.max(1, wl.w));
            rect(sx, wl.y + ((i * 41) % Math.max(1, wl.h)), 3, 3);
        }
    }

    // gates / hazards (bands span the channel)
    for (const g of gates) drawGate(g);

    drawGoal();

    for (const it of items) {
        if (it.taken) continue;
        if (it.cooldown > 0 && frameCount % 10 < 5) continue;  // blink while disabled
        if (it.kind === 'tool') drawToolVisual(it.visualId, it.x, it.y, 1);
        else drawValueVisual(it.visualId, it.x, it.y);
    }

    for (const e of enemies) drawUFO(e.x, e.y);

    drawShip();
}

function drawGate(g) {
    const yTop = g.y - BAND_H, h = BAND_H * 2;
    if (g.kind === 'protect' && g.role === ROLE_BOOTS) {
        // LASER band: flat red bars; gray when BOOTS held.
        const on = !hasItem(ROLE_BOOTS);
        fill(on ? 230 : 70, on ? 45 : 70, on ? 45 : 70);
        for (let yy = yTop; yy < yTop + h; yy += 5) rect(CH_L, yy, CH_R - CH_L, 3);
    } else if (g.kind === 'protect' && g.role === ROLE_HAT) {
        // RADIATION band: flat green with darker chevrons; gray when HAT held.
        const on = !hasItem(ROLE_HAT);
        fill(on ? 60 : 64, on ? 215 : 64, on ? 110 : 64);
        rect(CH_L, yTop, CH_R - CH_L, h);
        fill(on ? 25 : 38, on ? 120 : 38, on ? 64 : 38);
        for (let xx = CH_L; xx < CH_R; xx += 12) rect(xx, yTop, 5, h);
    } else if (g.kind === 'door') {
        if (!g.alive) return;
        // FORCE-FIELD: flat blue barrier + bright core line.
        fill(0, 110, 230); rect(CH_L, yTop, CH_R - CH_L, h);
        fill(150, 210, 255); rect(CH_L, g.y - 1, CH_R - CH_L, 3);
    } else if (g.kind === 'asteroids') {
        if (!g.alive) return;
        for (const rk of g.rocks) {
            fill(120, 120, 138);
            beginShape();
            for (const v of rk.verts) vertex(rk.x + v[0], rk.y + v[1]);
            endShape(CLOSE);
            fill(78, 78, 96);
            rect(rk.x - 4, rk.y - 2, 4, 4); rect(rk.x + 1, rk.y + 1, 3, 3);
        }
    }
}

function drawGoal() {
    // Chunky flat portal: concentric diamonds, no glow.
    const dia = (R, r, g2, b) => {
        fill(r, g2, b);
        beginShape();
        vertex(goal.x, goal.y - R); vertex(goal.x + R, goal.y);
        vertex(goal.x, goal.y + R); vertex(goal.x - R, goal.y);
        endShape(CLOSE);
    };
    dia(goal.r + 4, 0, 110, 84);
    dia(goal.r,     0, 220, 160);
    dia(goal.r - 5, 12, 30, 30);
    dia(goal.r - 9, 150, 255, 230);
}

// Returns [r,g,b] (the shim's color() yields a string, so we keep raw channels
// for glow/alpha use and spread into fill()/stroke()).
function getItemColor(vid) {
    if (vid === 6)  return [255, 100, 200];  // pink
    if (vid === 7)  return [40, 110, 255];   // blue
    if (vid === 17) return [0, 200, 80];     // green
    if (vid === 12) return [0, 220, 210];    // cyan (was gray; gray collided with the white ship)
    if (vid === 14) return [170, 80, 255];   // purple
    return [255, 255, 255];
}

// Five DISTINCT power-up glyphs (shape + color) so the binding is unambiguous.
// scale s lets the same glyph render small on the ship as held-equipment.
function drawToolVisual(id, x, y, s) {
    const rgb = getItemColor(id);
    fill(rgb[0], rgb[1], rgb[2]);   // flat fill, no glow, no outline
    const R = 7 * s;
    if (id === 6) {              // circle
        ellipse(x, y, R * 2);
    } else if (id === 7) {       // square
        rect(x - R, y - R, R * 2, R * 2);
    } else if (id === 12) {      // triangle
        triangle(x, y - R, x - R, y + R, x + R, y + R);
    } else if (id === 14) {      // diamond
        beginShape(); vertex(x, y - R); vertex(x + R, y); vertex(x, y + R); vertex(x - R, y); endShape(CLOSE);
    } else if (id === 17) {      // plus
        rect(x - R, y - R * 0.4, R * 2, R * 0.8);
        rect(x - R * 0.4, y - R, R * 0.8, R * 2);
    }
}

function drawValueVisual(id, x, y) {
    // Flat ring "orbs" — distinct from the solid tool glyphs; warm colors that
    // no tool uses (yellow=8, orange=15).
    const c = (id === 8) ? [255, 210, 40] : [255, 110, 0];
    fill(c[0], c[1], c[2]); ellipse(x, y, 14);
    fill(0);                ellipse(x, y, 7);
    fill(c[0], c[1], c[2]); ellipse(x, y, 3);
}

function drawUFO(x, y) {
    fill(150, 160, 180); ellipse(x, y + 2, 22, 8);     // saucer body
    fill(120, 130, 150); ellipse(x, y, 12, 9);          // hull
    fill(120, 255, 230); ellipse(x, y - 2, 8, 6);       // dome
    fill(40, 60, 80);
    for (let i = -1; i <= 1; i++) ellipse(x + i * 6, y + 3, 2.5);
}

function drawShip() {
    const cursed = penaltyTimer > 0 && penaltyTimer % 4 < 2;
    push();
    translate(ship.x, ship.y);
    rotate(ship.angle);   // ship points along +x in this frame

    // BOOTS: rear thruster glow (drawn behind the hull, in role color).
    const boots = inventoryQueue.find(it => it.role === ROLE_BOOTS);
    if (boots) {
        fill(getItemColor(boots.visualId));
        triangle(-SHIP_R, -4, -SHIP_R, 4, -SHIP_R - 7, 0);
    } else if (keyIsDown(UP_ARROW)) {
        fill(255, 160, 40); triangle(-SHIP_R, -3, -SHIP_R, 3, -SHIP_R - 6, 0);
    }

    // Hull: flat-filled triangle (no outline).
    fill(cursed ? [255, 90, 90] : [225, 235, 250]);
    triangle(SHIP_R + 2, 0, -SHIP_R * 0.7, -SHIP_R * 0.8, -SHIP_R * 0.7, SHIP_R * 0.8);

    // ARMOR: flat hull plate band across the middle (torso), role color.
    const armor = inventoryQueue.find(it => it.role === ROLE_ARMOR);
    if (armor) {
        fill(getItemColor(armor.visualId));
        rect(-4, -SHIP_R * 0.65, 5, SHIP_R * 1.3);
    }

    // HAT: nose-cone at the front tip (head-equivalent), role color.
    const hat = inventoryQueue.find(it => it.role === ROLE_HAT);
    if (hat) {
        fill(getItemColor(hat.visualId));
        triangle(SHIP_R + 2, 0, SHIP_R - 4, -3, SHIP_R - 4, 3);
    }

    // Other held items (KEY/SWORD): flat square glyphs beside the hull (the "belt").
    const carried = inventoryQueue.filter(it =>
        it.role !== ROLE_BOOTS && it.role !== ROLE_ARMOR && it.role !== ROLE_HAT);
    carried.forEach((it, i) => {
        fill(getItemColor(it.visualId));
        rect(-5, (i === 0 ? -1 : 1) * (SHIP_R + 1) - 2, 5, 5);
    });

    pop();
}

function keyPressed() {}
