// analogen_asteroids_v7
// A NEW DOMAIN that shares analogen_nomemory_grid_v7's per-episode binding
// principle, but with asteroids-style continuous physics (rotate + thrust +
// momentum + drift) AND a ranged-weapon dynamic the grid env cannot express.
//
// Binding principle (same as v7): 5 tool visual ids [6,7,12,14,17] are shuffled
// to 5 roles each episode via the SAME mulberry32 + Fisher-Yates as v7. The
// agent must read the per-episode binding from pixels.
//
// The 5 roles and the forced channel sequence (bottom -> top):
//   LASER band     <- BOOTS    hold-to-pass (lethal without; gray when held)
//   ROCK WALL      <- PIERCER  SHOOT to clear: piercer ammo breaks the rock
//                              blocks; the wall is solid until cleared.
//   FORCE-FIELD    <- BLUE_KEY consumable contact-gate (opens on contact)
//   TURRET band    <- BLASTER  SHOOT to clear: blaster ammo kills the turret;
//                              the band is lethal on contact until killed.
//   RADIATION band <- HAT      hold-to-pass (lethal without; gray when held)
//
// AMMO-BY-BINDING (the new research wrinkle): firing emits a projectile whose
// TYPE is the equipped gun (PIERCER or BLASTER), colored by its bound glyph.
//   - piercer bolts break ROCK but are ABSORBED by the turret (no effect)
//   - blaster bolts kill the TURRET but are ABSORBED by rock (no effect)
// So the agent must read WHICH glyph is the wall-breaker vs the turret-killer
// and bring/fire the right one. Wrong ammo is wasted. Inventory/held items
// render on the ship, so the binding stays fully pixel-visible (Markov).
//
// Inventory cap 2 with drops, +500 pickup, +1000 gate/clear, -1000 curse,
// -5000 death, win = +50000 + lives*10000, per-frame living cost. Solvable on
// cap 2 the same way v7 is: BOOTS persists at the laser mouth, HAT is held on
// the final approach, PIERCER/KEY/BLASTER are spent one-and-done in sequence.
//
// Controls: LEFT/RIGHT rotate, UP thrusts along heading, DOWN brakes; momentum
// + drag. SPACE fires (Discrete(8) actions 5/6/7). Item/door/hazard contacts as
// in v7. Canvas 256x256 -> 64x64 obs at the usual 4:1 downsample.

const W = 256, H = 256;
const SHIP_R = 9;
const ROT_SPEED = 0.13;     // radians/frame
const THRUST = 0.16;        // accel/frame
const DRAG = 0.985;         // velocity damping per frame
const MAX_SPEED = 3.6;
const DEATH_PENALTY = 5000;
const STEP_PENALTY = 0.005; // per-frame living cost (sized for symlog, as in v7)
const MAX_STEPS = 2000;

// --- firing ---
const BULLET_SPEED = 4.6;
const BULLET_LIFE = 64;     // frames before a bolt expires
const FIRE_COOLDOWN = 7;    // min frames between shots
const ROCK_BLOCK_W = 13;    // width of one breakable rock block
const TURRET_HP = 2;        // blaster hits to clear the turret band
// Optional turret return-fire (a dodge challenge). Default OFF for trainability.
const TURRET_FIRES = false;
const TURRET_FIRE_PERIOD = 70;
const TURRET_BULLET_SPEED = 2.2;

const ROLE_HAT      = 'HAT';
const ROLE_BLUE_KEY = 'BLUE_KEY';
const ROLE_BLASTER  = 'BLASTER';   // was SWORD: kills the TURRET band
const ROLE_BOOTS    = 'BOOTS';
const ROLE_PIERCER  = 'PIERCER';   // was ARMOR: breaks the ROCK WALL
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
let fireCooldown = 0;

let ship = { x: 128, y: 224, vx: 0, vy: 0, angle: -Math.PI / 2 };
let startPose = { x: 128, y: 224, angle: -Math.PI / 2 };

let items = [];     // {x,y,r,kind:'tool'|'value', visualId, cooldown}
let gates = [];     // {kind:'protect'|'door'|'wall'|'turret', role, y, alive, ...}
let bullets = [];   // {x,y,vx,vy,life,role,visualId}   player bolts
let turretBullets = []; // {x,y,vy,life}
let walls = [];     // {x,y,w,h}
let stars = [];     // {x,y,b}
let goal = { x: 128, y: 20, r: 12 };

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
    turretBullets = [];
    shuffleRoles();
    initWorld();
    resetShip();
}

function shuffleRoles() {
    const toolRoles = [ROLE_HAT, ROLE_BLUE_KEY, ROLE_BOOTS, ROLE_BLASTER, ROLE_PIERCER];
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
    //   LASER(boots) -> ROCK WALL(piercer) -> FORCE-FIELD(key)
    //               -> TURRET(blaster) -> RADIATION(hat) -> GOAL
    gates = [
        { kind: 'protect', role: ROLE_BOOTS,    y: 140 },
        { kind: 'wall',    role: ROLE_PIERCER,  y: 112, alive: true, blocks: makeRockBlocks(112) },
        { kind: 'door',    role: ROLE_BLUE_KEY, y: 86,  alive: true },
        { kind: 'turret',  role: ROLE_BLASTER,  y: 58,  alive: true, hp: TURRET_HP,
                           tx: 128, dir: rng() > 0.5 ? 1 : -1, fireTimer: TURRET_FIRE_PERIOD },
        { kind: 'protect', role: ROLE_HAT,      y: 34 },
    ];

    // Items scattered in the bottom field. 5 tool ids + a few value distractors.
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

function makeRockBlocks(yc) {
    // A row of breakable rock blocks spanning the channel = the PIERCER wall.
    const blocks = [];
    for (let cx = CH_L + ROCK_BLOCK_W * 0.5 + 1; cx < CH_R - 1; cx += ROCK_BLOCK_W) {
        const verts = [];
        const n = 8;
        for (let k = 0; k < n; k++) {
            const a = (k / n) * Math.PI * 2;
            const rr = 7 + rng() * 4;
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

    updateTurrets();
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

function updateTurrets() {
    for (const g of gates) {
        if (g.kind !== 'turret' || !g.alive) continue;
        g.tx += g.dir * 0.6;
        if (g.tx < CH_L + 12 || g.tx > CH_R - 12) g.dir *= -1;
        if (TURRET_FIRES) {
            g.fireTimer--;
            if (g.fireTimer <= 0) {
                g.fireTimer = TURRET_FIRE_PERIOD;
                turretBullets.push({ x: g.tx, y: g.y + BAND_H, vy: TURRET_BULLET_SPEED, life: 200 });
            }
        }
    }
    for (let i = turretBullets.length - 1; i >= 0; i--) {
        const b = turretBullets[i];
        b.y += b.vy; b.life--;
        if (b.life <= 0 || b.y > H || blocked(b.x, b.y)) { turretBullets.splice(i, 1); continue; }
        if (dist(b.x, b.y, ship.x, ship.y) < SHIP_R + 2) { turretBullets.splice(i, 1); die(); return; }
    }
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

// A bolt vs the channel gates. Returns true if the bolt should be consumed.
// Ammo-by-binding: only the matching ammo type damages its gate; the wrong
// ammo is still ABSORBED on contact (wasted), so mis-binding is punished.
function resolveBulletGate(b) {
    for (const g of gates) {
        if (!g.alive) continue;
        if (g.kind === 'wall') {
            for (const blk of g.blocks) {
                if (!blk.alive) continue;
                if (Math.abs(b.x - blk.x) < ROCK_BLOCK_W * 0.5 + 1 && Math.abs(b.y - blk.y) < 10) {
                    if (b.role === ROLE_PIERCER) {
                        blk.alive = false;
                        if (g.blocks.every(k => !k.alive)) { g.alive = false; consumeItem(ROLE_PIERCER); score += 1000; }
                    }
                    return true;  // absorbed either way
                }
            }
        } else if (g.kind === 'turret') {
            if (inChannel(b.x) && Math.abs(b.y - g.y) < BAND_H + 2) {
                if (b.role === ROLE_BLASTER) {
                    g.hp--;
                    if (g.hp <= 0) { g.alive = false; consumeItem(ROLE_BLASTER); score += 1000; }
                }
                return true;  // absorbed either way
            }
        } else if (g.kind === 'door') {
            // Locked force-field absorbs bolts; open door lets them pass.
            if (inChannel(b.x) && Math.abs(b.y - g.y) < BAND_H + 2) return true;
        }
    }
    return false;
}

// Fire the equipped gun. Called once per fire-action from keyPressed(), so it is
// frame-skip independent (polling keyIsDown(32) would multi-fire under skip).
function fireWeapon() {
    if (gameState !== 'PLAYING' || fireCooldown > 0) return;
    // Equipped gun = front-of-queue PIERCER/BLASTER (deterministic, mirrors drop order).
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

// True if a point overlaps a channel wall or boundary (used for bolts).
function hitsSolidWall(x, y) {
    for (const wl of walls) {
        if (x > wl.x && x < wl.x + wl.w && y > wl.y && y < wl.y + wl.h) return true;
    }
    return false;
}

// True if the ship circle at (x,y) overlaps a wall, a locked door, or a live
// rock wall (these act as solid barriers).
function blocked(x, y) {
    for (const wl of walls) {
        if (x + SHIP_R > wl.x && x - SHIP_R < wl.x + wl.w &&
            y + SHIP_R > wl.y && y - SHIP_R < wl.y + wl.h) return true;
    }
    for (const g of gates) {
        if (!g.alive) continue;
        if (g.kind === 'door' && inChannel(x) && Math.abs(y - g.y) < BAND_H + SHIP_R) {
            if (!hasItem(ROLE_BLUE_KEY)) return true;  // locked = solid; with key it opens on contact
        } else if (g.kind === 'wall') {
            for (const blk of g.blocks) {
                if (blk.alive && Math.abs(x - blk.x) < ROCK_BLOCK_W * 0.5 + SHIP_R &&
                    Math.abs(y - blk.y) < 9 + SHIP_R) return true;
            }
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
            if (!hasItem(g.role)) { die(); return; }   // laser/radiation: lethal without item
        } else if (g.kind === 'turret') {
            if (g.alive) { die(); return; }            // lethal band until shot down
        } else if (g.kind === 'door') {
            if (g.alive && hasItem(g.role)) { consumeItem(g.role); g.alive = false; score += 1000; }
            // locked door without key is handled as solid in blocked(); no death.
        }
        // 'wall' is purely a solid barrier (handled in blocked()); no contact effect.
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
    bullets = [];
    turretBullets = [];
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

    for (const b of bullets) drawBullet(b);
    for (const b of turretBullets) { fill(255, 80, 80); ellipse(b.x, b.y, 5); }

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
    } else if (g.kind === 'wall') {
        if (!g.alive) return;
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
    } else if (g.kind === 'turret') {
        if (!g.alive) return;
        // TURRET band: lethal red emitter row + a tracking gun body. Shoot with
        // BLASTER ammo to kill (band clears on death).
        fill(150, 40, 40);
        for (let xx = CH_L; xx < CH_R; xx += 8) rect(xx, g.y - 2, 5, 4);
        fill(90, 95, 110); ellipse(g.tx, g.y, 16, 12);     // hull
        fill(60, 65, 80);  rect(g.tx - 2, g.y + 2, 4, 8);  // downward barrel
        fill(255, 90, 90);  ellipse(g.tx, g.y - 1, 5, 5);   // core (hp glow)
        if (g.hp <= 1) { fill(255, 200, 80); ellipse(g.tx, g.y - 1, 2.5, 2.5); }
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

function drawBullet(b) {
    const rgb = getItemColor(b.visualId);
    push();
    translate(b.x, b.y);
    rotate(Math.atan2(b.vy, b.vx));
    fill(rgb[0], rgb[1], rgb[2]);
    if (b.role === ROLE_PIERCER) {
        // piercing lance: thin and long
        rect(-5, -1.5, 11, 3);
    } else {
        // blaster bolt: round pellet with a short tail
        ellipse(0, 0, 5, 5);
        fill(rgb[0], rgb[1], rgb[2], 140); rect(-5, -1, 4, 2);
    }
    pop();
}

function drawShip() {
    const cursed = penaltyTimer > 0 && penaltyTimer % 4 < 2;
    push();
    translate(ship.x, ship.y);
    rotate(ship.angle);   // ship points along +x in this frame

    // BOOTS: rear afterburner pod (drawn behind the hull, in role color).
    const boots = inventoryQueue.find(it => it.role === ROLE_BOOTS);
    if (boots) {
        const c = getItemColor(boots.visualId);
        const len = keyIsDown(UP_ARROW) ? 11 : 7;
        fill(c[0], c[1], c[2]);
        triangle(-SHIP_R + 1, -4, -SHIP_R + 1, 4, -SHIP_R - len, 0);
    } else if (keyIsDown(UP_ARROW)) {
        fill(255, 160, 40); triangle(-SHIP_R + 1, -3, -SHIP_R + 1, 3, -SHIP_R - 6, 0);
    }

    // Rocket fuselage (flat-filled, no outline): tapered body + two tail fins.
    fill(70, 80, 100);                       // fins (behind hull)
    triangle(-SHIP_R + 2, -3, -SHIP_R - 2, -7, -2, -3);
    triangle(-SHIP_R + 2,  3, -SHIP_R - 2,  7, -2,  3);
    fill(cursed ? [255, 90, 90] : [225, 235, 250]);   // hull
    beginShape();
    vertex(SHIP_R + 3, 0);                   // nose tip
    vertex(2, -SHIP_R * 0.62);
    vertex(-SHIP_R + 2, -SHIP_R * 0.5);
    vertex(-SHIP_R + 2,  SHIP_R * 0.5);
    vertex(2,  SHIP_R * 0.62);
    endShape(CLOSE);
    fill(120, 150, 200);                     // cockpit canopy
    ellipse(SHIP_R * 0.2, 0, 5, 4);

    // PIERCER: forward drill lance at the nose (role color) — the wall-breaker gun.
    const piercer = inventoryQueue.find(it => it.role === ROLE_PIERCER);
    if (piercer) {
        const c = getItemColor(piercer.visualId);
        fill(c[0], c[1], c[2]);
        triangle(SHIP_R + 8, 0, SHIP_R - 1, -2.5, SHIP_R - 1, 2.5);
    }

    // BLASTER: side cannon barrels on the flanks (role color) — the turret-killer gun.
    const blaster = inventoryQueue.find(it => it.role === ROLE_BLASTER);
    if (blaster) {
        const c = getItemColor(blaster.visualId);
        fill(c[0], c[1], c[2]);
        rect(0, -SHIP_R * 0.95, 7, 3);
        rect(0,  SHIP_R * 0.95 - 3, 7, 3);
    }

    // HAT: canopy dome shield over the cockpit (role color) — radiation shield.
    const hat = inventoryQueue.find(it => it.role === ROLE_HAT);
    if (hat) {
        const c = getItemColor(hat.visualId);
        fill(c[0], c[1], c[2]);
        ellipse(SHIP_R * 0.2, 0, 7, 6);
    }

    // BLUE_KEY: docking prong under the nose (role color).
    const key = inventoryQueue.find(it => it.role === ROLE_BLUE_KEY);
    if (key) {
        const c = getItemColor(key.visualId);
        fill(c[0], c[1], c[2]);
        rect(SHIP_R - 3, 3, 4, 4);
    }

    pop();
}

function keyPressed() {
    if (keyCode === 32) fireWeapon();   // SPACE = fire (Discrete(8) actions 5/6/7)
}
