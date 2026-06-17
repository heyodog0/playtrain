// analogen_asteroids_easy
// The "easy" asteroids binding env: ONE obstacle, a small arena (so the ship is
// big in the 64x64 obs), no value items, and SPACE doubles as deliberate pickup
// AND the weapon fire. Pared down from analogen_asteroids_v7.
//
// What it keeps from v7: the per-episode binding principle. The 5 tool visual ids
// [6,7,12,14,17] are shuffled to 5 roles each episode via the SAME mulberry32 +
// Fisher-Yates. The agent must read the binding from pixels.
//
// THE single obstacle: a FULL-WIDTH LINE OF ASTEROIDS across the screen between
// the ship and the goal. No barrier walls — just the asteroid line. Each rock is
// solid until SHOT CLEAR with the PIERCER weapon; firing emits a bolt of the
// equipped gun and only PIERCER bolts break rock. So the task is: identify which
// glyph is the PIERCER, pick it up, blast a gap in the line, fly through, reach
// the goal. (Breaking a couple of rocks in your column opens a passage.)
//
// Roles (only PIERCER is functional here):
//   PIERCER  -> the wall-breaker gun (correct weapon)
//   BLASTER  -> a DECOY gun: its bolts are ABSORBED by rock (wasted) — a wrong-
//               weapon trap, same ammo-by-binding idea as v7.
//   HAT / BOOTS / BLUE_KEY -> inert distractors (no gate to use them on). Held
//               items still render on the ship, so the binding stays pixel-visible.
//
// SPACE (Discrete(8) actions 5/6/7), once per press (frame-skip safe):
//   - if the ship overlaps an uncollected item -> DELIBERATE PICKUP of that item
//   - otherwise -> FIRE the equipped gun (PIERCER/BLASTER)
//
// Inventory cap 1 (strict, like analogen_cavequest_easy): a wrong pickup evicts
// the held item. No value (reward/curse) items. Controls: LEFT/RIGHT rotate,
// UP thrust, DOWN brake; momentum + drag. Canvas 128x128 -> 64x64 obs (2:1).

const W = 128, H = 128;
const SHIP_R = 9;            // big relative to the small arena
const ROT_SPEED = 0.13;     // radians/frame
const THRUST = 0.10;        // accel/frame (scaled down for the small world)
const DRAG = 0.985;         // velocity damping per frame
const MAX_SPEED = 2.2;
const DEATH_PENALTY = 5000;
const STEP_PENALTY = 0.005; // per-frame living cost
const MAX_STEPS = 2000;

// --- firing ---
const BULLET_SPEED = 3.2;
const BULLET_LIFE = 64;     // frames before a bolt expires
const FIRE_COOLDOWN = 7;    // min frames between shots
const ROCK_BLOCK_W = 11;    // width of one breakable rock block

const ROLE_HAT      = 'HAT';
const ROLE_BLUE_KEY = 'BLUE_KEY';
const ROLE_BLASTER  = 'BLASTER';   // decoy gun (absorbed by rock)
const ROLE_BOOTS    = 'BOOTS';
const ROLE_PIERCER  = 'PIERCER';   // the wall-breaker gun

const TOOL_VISUAL_IDS  = [6, 7, 12, 14, 17];
const VALUE_VISUAL_IDS = [];       // no reward/curse items in the easy env
const MAX_INVENTORY = 1;
const DROP_COOLDOWN = 45;

// No walls: the asteroid line (at ASTEROID_Y) spans the full width. Items spawn
// in the bottom field below FIELD_TOP so they sit on the ship's side of the line.
const FIELD_TOP = 66;
const ASTEROID_Y = 50;     // y of the full-width asteroid line
const BAND_H = 7;          // half-thickness of the rock band

let gameState = 'PLAYING';
let score = 0;
let lives = 3;
let episodeSteps = 0;
let inventoryQueue = [];
let toolMapping = {};
let penaltyTimer = 0;
let fireCooldown = 0;

let ship = { x: 64, y: 112, vx: 0, vy: 0, angle: -Math.PI / 2 };
let startPose = { x: 64, y: 112, angle: -Math.PI / 2 };

let items = [];     // {x,y,r,kind:'tool', visualId, cooldown, taken}
let gates = [];     // {kind:'wall', role, y, alive, blocks}
let bullets = [];   // {x,y,vx,vy,life,role,visualId}
let walls = [];     // {x,y,w,h}
let stars = [];     // {x,y,b}
let goal = { x: 64, y: 14, r: 10 };

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
    fireCooldown = 0;
    episodeSteps = 0;
    gameState = 'PLAYING';
    bullets = [];
    shuffleRoles();
    initWorld();
    resetShip();
}

function shuffleRoles() {
    // Same draw order as v7's tool shuffle (5 roles, 1 functional here).
    const toolRoles = [ROLE_HAT, ROLE_BLUE_KEY, ROLE_BOOTS, ROLE_BLASTER, ROLE_PIERCER];
    shuffleInPlace(toolRoles);
    toolMapping = {};
    TOOL_VISUAL_IDS.forEach((vid, i) => { toolMapping[vid] = toolRoles[i]; });
}

function initWorld() {
    // No barrier walls — the only obstacle is the asteroid line.
    walls = [];

    // THE single obstacle: a FULL-WIDTH line of asteroids, cleared by PIERCER.
    gates = [
        { kind: 'wall', role: ROLE_PIERCER, y: ASTEROID_Y, alive: true, blocks: makeRockBlocks(ASTEROID_Y) },
    ];

    // 5 tool glyphs scattered in the bottom field. No value items.
    items = [];
    const placed = [];
    const tooClose = (x, y) => {
        if (dist(x, y, startPose.x, startPose.y) < 22) return true;
        for (const p of placed) if (dist(x, y, p.x, p.y) < 24) return true;
        return false;
    };
    const drawPos = () => {
        for (let tries = 0; tries < 80; tries++) {
            const x = 12 + rng() * (W - 24);
            const y = FIELD_TOP + 8 + rng() * (H - FIELD_TOP - 18);
            if (!tooClose(x, y)) return { x, y };
        }
        return { x: 12 + rng() * (W - 24), y: FIELD_TOP + 8 + rng() * (H - FIELD_TOP - 18) };
    };
    TOOL_VISUAL_IDS.forEach((vid) => {
        const p = drawPos(); placed.push(p);
        items.push({ x: p.x, y: p.y, r: 7, kind: 'tool', visualId: vid, cooldown: 0, taken: false });
    });

    // Static starfield (seeded, dim, sparse).
    stars = [];
    for (let i = 0; i < 14; i++) stars.push({ x: rng() * W, y: rng() * H, b: 40 + rng() * 50 });
}

function makeRockBlocks(yc) {
    // A row of breakable rock blocks spanning the channel = the PIERCER wall.
    const blocks = [];
    for (let cx = ROCK_BLOCK_W * 0.5 + 2; cx < W - 2; cx += ROCK_BLOCK_W) {
        const verts = [];
        const n = 8;
        for (let k = 0; k < n; k++) {
            const a = (k / n) * Math.PI * 2;
            const rr = 6 + rng() * 3;
            verts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
        }
        blocks.push({ x: cx, y: yc, alive: true, verts });
    }
    return blocks;
}

function resetShip() {
    ship.x = startPose.x; ship.y = startPose.y;
    ship.vx = 0; ship.vy = 0; ship.angle = startPose.angle;
}

function updateGame() {
    episodeSteps++;
    score -= STEP_PENALTY;
    if (penaltyTimer > 0) penaltyTimer--;
    if (fireCooldown > 0) fireCooldown--;
    for (const it of items) if (it.cooldown > 0) it.cooldown--;

    updateBullets();

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

function updateBullets() {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx; b.y += b.vy; b.life--;
        if (b.life <= 0 || b.x < 0 || b.x > W || b.y < 0 || b.y > H) { bullets.splice(i, 1); continue; }
        if (hitsSolidWall(b.x, b.y)) { bullets.splice(i, 1); continue; }
        if (resolveBulletGate(b)) { bullets.splice(i, 1); continue; }
    }
}

// A bolt vs the rock wall. Returns true if the bolt should be consumed.
// Ammo-by-binding: only PIERCER damages the rock; any other gun's bolt is still
// ABSORBED on contact (wasted), so mis-binding is punished.
function resolveBulletGate(b) {
    for (const g of gates) {
        if (!g.alive || g.kind !== 'wall') continue;
        for (const blk of g.blocks) {
            if (!blk.alive) continue;
            if (Math.abs(b.x - blk.x) < ROCK_BLOCK_W * 0.5 + 1 && Math.abs(b.y - blk.y) < 9) {
                if (b.role === ROLE_PIERCER) {
                    blk.alive = false;
                    if (g.blocks.every(k => !k.alive)) { g.alive = false; consumeItem(ROLE_PIERCER); score += 1000; }
                }
                return true;  // absorbed either way
            }
        }
    }
    return false;
}

// Fire the equipped gun. Called once per fire-action so it is frame-skip
// independent (polling keyIsDown(32) would multi-fire under skip).
function fireWeapon() {
    if (gameState !== 'PLAYING' || fireCooldown > 0) return;
    const gun = inventoryQueue.find(it => it.role === ROLE_PIERCER || it.role === ROLE_BLASTER);
    if (!gun) return;
    fireCooldown = FIRE_COOLDOWN;
    const dx = Math.cos(ship.angle), dy = Math.sin(ship.angle);
    bullets.push({
        x: ship.x + dx * (SHIP_R + 4), y: ship.y + dy * (SHIP_R + 4),
        vx: ship.vx * 0.3 + dx * BULLET_SPEED, vy: ship.vy * 0.3 + dy * BULLET_SPEED,
        life: BULLET_LIFE, role: gun.role, visualId: gun.visualId,
    });
}

// Deliberate pickup: grab an item the ship is overlapping. Returns true if it
// took one (so SPACE doesn't also fire on the same press).
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

// True if a point overlaps a channel wall or boundary (used for bolts).
function hitsSolidWall(x, y) {
    for (const wl of walls) {
        if (x > wl.x && x < wl.x + wl.w && y > wl.y && y < wl.y + wl.h) return true;
    }
    return false;
}

// True if the ship circle at (x,y) overlaps a wall or a live rock block.
function blocked(x, y) {
    for (const wl of walls) {
        if (x + SHIP_R > wl.x && x - SHIP_R < wl.x + wl.w &&
            y + SHIP_R > wl.y && y - SHIP_R < wl.y + wl.h) return true;
    }
    for (const g of gates) {
        if (!g.alive || g.kind !== 'wall') continue;
        for (const blk of g.blocks) {
            if (blk.alive && Math.abs(x - blk.x) < ROCK_BLOCK_W * 0.5 + SHIP_R &&
                Math.abs(y - blk.y) < 9 + SHIP_R) return true;
        }
    }
    return false;
}

function resolveContacts() {
    // The only contact effect left is reaching the goal (the rock wall is a
    // solid barrier handled in blocked(); pickups are deliberate via SPACE).
    if (dist(ship.x, ship.y, goal.x, goal.y) < SHIP_R + goal.r) handleVictory();
}

function handleVictory() {
    score += 50000 + lives * 10000;
    gameState = 'WIN';
}

function die() {
    score = Math.max(0, score - DEATH_PENALTY);
    lives--;
    bullets = [];
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
        items.push({ x: ship.x, y: ship.y, r: 7, kind: 'tool',
                     visualId: dropped.visualId, cooldown: DROP_COOLDOWN, taken: false });
    }
    inventoryQueue.push({ role, visualId });
}

// ---------------- rendering (asteroids aesthetic) ----------------

function drawGame() {
    for (const s of stars) { fill(s.b); rect(s.x, s.y, 1.5, 1.5); }

    for (const g of gates) drawGate(g);

    drawGoal();

    for (const it of items) {
        if (it.taken) continue;
        if (it.cooldown > 0 && frameCount % 10 < 5) continue;  // blink while disabled
        drawToolVisual(it.visualId, it.x, it.y, 1);
    }

    for (const b of bullets) drawBullet(b);

    drawShip();
}

function drawGate(g) {
    if (g.kind !== 'wall' || !g.alive) return;
    // ROCK WALL: jagged gray blocks; shoot with PIERCER ammo to break.
    for (const blk of g.blocks) {
        if (!blk.alive) continue;
        fill(120, 120, 138);
        beginShape();
        for (const v of blk.verts) vertex(blk.x + v[0], blk.y + v[1]);
        endShape(CLOSE);
        fill(78, 78, 96);
        rect(blk.x - 4, blk.y - 2, 4, 4); rect(blk.x + 1, blk.y + 1, 3, 3);
    }
}

function drawGoal() {
    // Chunky flat portal: concentric diamonds.
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

function getItemColor(vid) {
    if (vid === 6)  return [255, 100, 200];  // pink
    if (vid === 7)  return [40, 110, 255];   // blue
    if (vid === 17) return [0, 200, 80];     // green
    if (vid === 12) return [0, 220, 210];    // cyan
    if (vid === 14) return [170, 80, 255];   // purple
    return [255, 255, 255];
}

// Five DISTINCT "ship-module" pickup icons (color = stable identity; the role is
// shuffled per episode and only revealed when equipped on the ship). Themed as
// salvage gear — power cell / fuel canister / chip / energy core / tank pod — so
// they read as spaceship accessories rather than bare geometric glyphs. None of
// the shapes signals its role; the color is what carries over to the equipped
// render on the hull.
function drawToolVisual(id, x, y, s) {
    const rgb  = getItemColor(id);
    const lite = [Math.min(255, rgb[0] + 70), Math.min(255, rgb[1] + 70), Math.min(255, rgb[2] + 70)];
    const dark = [rgb[0] * 0.5, rgb[1] * 0.5, rgb[2] * 0.5];
    const R = 7 * s;
    if (id === 6) {
        // power cell: upright battery with a top terminal + highlight band
        fill(dark[0], dark[1], dark[2]); rect(x - R * 0.5, y - R - 2 * s, R, 2 * s);
        fill(rgb[0], rgb[1], rgb[2]);    rect(x - R * 0.8, y - R, R * 1.6, R * 2, 2);
        fill(lite[0], lite[1], lite[2]); rect(x - R * 0.8, y - R * 0.3, R * 1.6, R * 0.5);
    } else if (id === 7) {
        // fuel canister: horizontal capsule with two straps
        fill(rgb[0], rgb[1], rgb[2]);    rect(x - R, y - R * 0.65, R * 2, R * 1.3, 3);
        fill(dark[0], dark[1], dark[2]); rect(x - R * 0.45, y - R * 0.65, R * 0.3, R * 1.3);
        fill(dark[0], dark[1], dark[2]); rect(x + R * 0.15, y - R * 0.65, R * 0.3, R * 1.3);
    } else if (id === 12) {
        // chip module: square core with side pins + center contact
        fill(dark[0], dark[1], dark[2]);
        for (let k = -1; k <= 1; k++) {
            rect(x - R - 2 * s, y + k * R * 0.5 - s, 2 * s, 2 * s);
            rect(x + R,         y + k * R * 0.5 - s, 2 * s, 2 * s);
        }
        fill(rgb[0], rgb[1], rgb[2]);    rect(x - R * 0.85, y - R * 0.85, R * 1.7, R * 1.7, 1);
        fill(lite[0], lite[1], lite[2]); ellipse(x, y, R * 0.7);
    } else if (id === 14) {
        // energy core: faceted gem (octagon) with a bright center
        fill(rgb[0], rgb[1], rgb[2]);
        beginShape();
        for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + Math.PI / 8; vertex(x + Math.cos(a) * R, y + Math.sin(a) * R); }
        endShape(CLOSE);
        fill(lite[0], lite[1], lite[2]); ellipse(x, y, R * 0.8);
    } else if (id === 17) {
        // tank pod: upright capsule with a cap + porthole
        fill(dark[0], dark[1], dark[2]); rect(x - R * 0.5, y - R - 2 * s, R, 2.5 * s, 1);
        fill(rgb[0], rgb[1], rgb[2]);    rect(x - R * 0.7, y - R, R * 1.4, R * 2, R * 0.7);
        fill(lite[0], lite[1], lite[2]); ellipse(x, y - R * 0.3, R * 0.6);
    }
}

function drawBullet(b) {
    const rgb = getItemColor(b.visualId);
    push();
    translate(b.x, b.y);
    rotate(Math.atan2(b.vy, b.vx));
    fill(rgb[0], rgb[1], rgb[2]);
    if (b.role === ROLE_PIERCER) {
        rect(-5, -1.5, 11, 3);          // piercing lance: thin and long
    } else {
        ellipse(0, 0, 5, 5);            // blaster bolt: round pellet + tail
        fill(rgb[0], rgb[1], rgb[2], 140); rect(-5, -1, 4, 2);
    }
    pop();
}

function drawShip() {
    const cursed = penaltyTimer > 0 && penaltyTimer % 4 < 2;
    push();
    translate(ship.x, ship.y);
    rotate(ship.angle);   // ship points along +x in this frame

    // BOOTS: rear afterburner pod (inert distractor; still rendered when held).
    const boots = inventoryQueue.find(it => it.role === ROLE_BOOTS);
    if (boots) {
        const c = getItemColor(boots.visualId);
        const len = keyIsDown(UP_ARROW) ? 11 : 7;
        fill(c[0], c[1], c[2]);
        triangle(-SHIP_R + 1, -4, -SHIP_R + 1, 4, -SHIP_R - len, 0);
    } else if (keyIsDown(UP_ARROW)) {
        fill(255, 160, 40); triangle(-SHIP_R + 1, -3, -SHIP_R + 1, 3, -SHIP_R - 6, 0);
    }

    // Rocket fuselage: tapered body + two tail fins.
    fill(70, 80, 100);
    triangle(-SHIP_R + 2, -3, -SHIP_R - 2, -7, -2, -3);
    triangle(-SHIP_R + 2,  3, -SHIP_R - 2,  7, -2,  3);
    fill(cursed ? [255, 90, 90] : [225, 235, 250]);
    beginShape();
    vertex(SHIP_R + 3, 0);
    vertex(2, -SHIP_R * 0.62);
    vertex(-SHIP_R + 2, -SHIP_R * 0.5);
    vertex(-SHIP_R + 2,  SHIP_R * 0.5);
    vertex(2,  SHIP_R * 0.62);
    endShape(CLOSE);
    fill(120, 150, 200);
    ellipse(SHIP_R * 0.2, 0, 5, 4);

    // PIERCER: forward drill lance at the nose — the wall-breaker gun.
    const piercer = inventoryQueue.find(it => it.role === ROLE_PIERCER);
    if (piercer) {
        const c = getItemColor(piercer.visualId);
        fill(c[0], c[1], c[2]);
        triangle(SHIP_R + 8, 0, SHIP_R - 1, -2.5, SHIP_R - 1, 2.5);
    }

    // BLASTER: side cannon barrels (decoy gun).
    const blaster = inventoryQueue.find(it => it.role === ROLE_BLASTER);
    if (blaster) {
        const c = getItemColor(blaster.visualId);
        fill(c[0], c[1], c[2]);
        rect(0, -SHIP_R * 0.95, 7, 3);
        rect(0,  SHIP_R * 0.95 - 3, 7, 3);
    }

    // HAT: canopy dome over the cockpit (inert distractor).
    const hat = inventoryQueue.find(it => it.role === ROLE_HAT);
    if (hat) {
        const c = getItemColor(hat.visualId);
        fill(c[0], c[1], c[2]);
        ellipse(SHIP_R * 0.2, 0, 7, 6);
    }

    // BLUE_KEY: docking prong under the nose (inert distractor).
    const key = inventoryQueue.find(it => it.role === ROLE_BLUE_KEY);
    if (key) {
        const c = getItemColor(key.visualId);
        fill(c[0], c[1], c[2]);
        rect(SHIP_R - 3, 3, 4, 4);
    }

    pop();
}

function keyPressed() {
    // SPACE doubles as deliberate pickup AND weapon fire: grab an overlapping
    // item if there is one, otherwise fire the equipped gun. (Discrete(8) 5/6/7.)
    if (keyCode === 32) {
        if (!tryPickup()) fireWeapon();
    }
}
