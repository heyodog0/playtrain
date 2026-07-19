// analogen_nomemory_grid_v7_2rooms_door_6x6_inv1_pickup_v1p9
// "v1.9" = v1.8b (cd14, no pickup reward, abs_one — the locked env) with a
//   RENDER-ONLY change: visual id 7 changes from a BLUE KEY to a SECOND SWORD
//   (crimson, upright broadsword), so there is now ONE key-shaped icon (id17,
//   GREEN — deliberately NOT the blue door's color) and TWO sword-shaped icons
//   (id12 gray-diagonal, id7 crimson-upright). We replace the BLUE key (not the
//   green) so NO item shares the door's blue, removing any "grab the door-colored
//   item" shortcut and forcing the body-placement cue. Bindings / roles /
//   placement / held-out logic are UNCHANGED (held-out is still id12 = BLUE_KEY).
//   Consequence: training bindings where id7 = key now show "a sword is the key",
//   so the held-out (id12 = key) becomes a WITHIN-sword-category transfer test
//   rather than a fully-novel one. Only getItemColor(7) and drawToolVisual(7)
//   changed vs v1.8b.
//
// ----- v1.8b header -----
// "v1.8b" = v1.7 with ONE change: the pickup COOLDOWN is LOWERED to 14 frames
//   (= 2 agent decisions at frame_skip 7, down from v1.7's 49 = 7). This is the
//   low-but-nonzero bracket partner to v1.8 (cooldown 0). Same motivation: the
//   v1.7 N-sweep dipped at high N (128:0.22, 256:0.43, 300:0.28) with TRAIN return
//   ~90k (not undertraining), consistent with the 49-frame cooldown capping the
//   in-episode item-search budget. v1.8 (0) and v1.8b (14) bracket how the curve's
//   high-N dip and gradation move with search budget vs v1.7 (49).
//
// ----- v1.7 header -----
// "v1.7" = v1.6 with ONE change: the +500 pickup reward is REMOVED (like v2).
//   This removes the incentive to grab items at all, so the only reward signal
//   left is opening the BLUE_KEY door (+1000) and the step-decayed win bonus.
//   The deliberate-pickup mechanic + cooldown are kept; the cooldown is bumped
//   to PICKUP_COOLDOWN = 49 (= exactly 7 agent decisions at frame_skip 7, up
//   from v1.6's 45 ~= 6.4). Motivation: v1.6 (with +500 kept) left a nonzero
//   N=1 held-out floor (mean 0.032, 2 greenkey seeds at chance) — removing the
//   grab reward should make incidental/binding-agnostic collect-all even less
//   attractive, pushing the N=1 floor toward 0.
//   Binding is tool-only (VALUE_VISUAL_IDS = []): 360 distinct, 60 held-out, 300 train.
//
// ----- v1.6 header -----
// "v1.6" = v1.5 + two changes:
//   (1) PICKUP COOLDOWN: after grabbing an item you cannot grab again for
//       PICKUP_COOLDOWN frames, so you can't rapidly cycle items at the door
//       (throttles trial-and-error). +500 pickup reward is KEPT (still v1.5).
//   (2) Value items removed (VALUE_VISUAL_IDS = []) -> a binding is tool-only:
//       360 distinct, 60 held-out (sword=key), 300 train.
//
// ----- v1.5 header -----
// analogen_nomemory_grid_v7_2rooms_door_6x6_inv1_pickup_v1p5
// "v1.5": the base (v1) env + a DELIBERATE standalone-space pickup, but KEEPING
// v1's +500 pickup reward. It sits between v1 (walk-over, +500) and v2 (strict).
// Changes vs the base v1:
//   (1) Items are NOT auto-collected by walking onto them.
//   (2) Pickup fires ONLY on a STANDALONE space press (the pure-SPACE action),
//       not while a movement key is held (L+SP / R+SP do NOT pick up). Grabbing
//       costs a dedicated turn — no grab-while-sweeping — so collecting an item
//       is a deliberate choice.
//   (3) The +500 pickup reward is RETAINED (unlike v2, which removes it). This
//       isolates the "standalone deliberate pickup" mechanic from the "remove the
//       grab incentive" change: v1.5 tests whether blocking move+grab alone is
//       enough, while the +500 still rewards grabbing.
// Everything else (binding/placement mapping, door-row-cleared spawns, inv cap 1)
// is identical; the RNG draw order is unchanged.
//
// ----- _pickup header -----
// DELIBERATE-PICKUP variant of analogen_nomemory_grid_v7_2rooms_door_6x6_inv1.
// ONE mechanic change: items are NOT auto-collected by walking onto them. The
// agent must take the explicit pickup action (which presses space, keycode 32 —
// node-gym ACTIONS 5/6/7) while standing on an item's cell. This removes
// "incidental" pickups, so collecting the key is a deliberate, binding-contingent
// choice rather than a side effect of navigating to the door. Item spawns
// (door row kept clear), the +500 pickup reward, the BLUE_KEY door, inventory
// cap 1, and the seed->binding/placement mapping are identical to the base
// 6x6 inv1 (the RNG draw order is unchanged — only tryMove/updateGame differ).
//
// ----- base header: analogen_nomemory_grid_v7_2rooms_door_6x6_inv1 -----
// Copy of analogen_nomemory_grid_v5_2rooms_door_6x6_inv1 with two changes vs
// that inv1 base:
//   (1) The duplicate SWORD in the tool-role pool is replaced by ARMOR (the v7
//       torso item). ARMOR is added purely as a DISTRACTOR — there is NO spike
//       tile and no armor-gated obstacle (unlike v7, where ARMOR<->SPIKE is a
//       consumable gate).
//   (2) [6-item / 2-sword mod, mirrors v7.js change (5)] Item count goes
//       5 -> 6. A 6th visual token (id 18, a teal breastplate icon) joins
//       TOOL_VISUAL_IDS and the role pool gains a SECOND SWORD:
//         [HAT, BLUE_KEY, BOOTS, SWORD, ARMOR, SWORD]  (6 roles, 5 distinct).
//       Unlike v7 there is NO enemy on the 6x6 map, so BOTH swords (like ARMOR,
//       HAT, BOOTS) are pure no-op distractors — one more wrong-binding trap on
//       top of the single BLUE_KEY binding the locked door actually needs.
// The map, the BLUE_KEY-locked door at (2,2), inventory cap 1, and every other
// mechanic are identical to the inv1 base. ARMOR binds to one of the 6 shuffled
// visual ids and, when held, renders as a chest plate over the torso (the v7
// head/torso/feet = HAT/ARMOR/BOOTS body-region cue), but it gates nothing —
// grabbing it instead of BLUE_KEY just wastes the single inventory slot, i.e.
// one more wrong-binding trap on top of HAT/BOOTS/SWORD.
//
// ----- original v5_2rooms_door_6x6_inv1 header -----
// analogen_nomemory_grid_v5_2rooms_door_6x6_inv1 (identical to
// v5_2rooms_door_6x6 in every mechanic, layout, and render — BLUE_KEY-locked
// door, key consumed on open, 6x6 two-room grid — EXCEPT the inventory cap is
// 1 instead of 2. The avatar can hold only a single item: picking up a second
// item immediately evicts (drops) the one currently held.)
//
// Why: with cap 2 the agent can grab a distractor and still keep BLUE_KEY, so
// the binding test tolerates sloppy pickups. With cap 1 the forced path
// (pick up BLUE_KEY -> open door -> goal) still needs only one item at a time
// and stays solvable, but ANY wrong pickup after the key evicts it — the agent
// must read the per-episode visual->role binding and pick up *only* BLUE_KEY.
// A strictly harder single-binding test; everything else is held constant for
// a clean A/B vs v5_2rooms_door_6x6. Only `MAX_INVENTORY` changed (2 -> 1).
//
// ----- original v5_2rooms_door_6x6 header -----
// analogen_nomemory_grid_v5_2rooms_door_6x6 (same mechanics + rendering as v5_2rooms_door — BLUE_KEY-locked door, key consumed on open — but grid shrunk from 8x8 to 6x6 with smaller rooms and fewer pickup spots, to make the env easier without changing the research-relevant consumption mechanic.)
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
// All other v5 mechanics preserved: inventory cap 1 (see top header; v5 was 2), drops, curses,
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
// Inventory cap is 1 in this inv1 variant (v4/v5 used 2).
//
// Score deltas: +500 pickup, +1000 reward, -1000 curse, +1000 enemy kill,
//   +1000 blue-door open, -5000 death.
//   (v5: sunbeam is now a hazard like the laser — no reward for passing.)
//
// Win reward (modified for exploration benchmark comparability with
// MiniGrid): step-decay formula `WIN_REWARD_SCALE * (1 - 0.9 * frameCount
// / MAX_STEPS)`, floored at 0.1. Faster wins → higher reward. MAX_STEPS
// defaults to 2000 (node-gym episode budget). Failure (death, timeout)
// gives whatever intermediate score was accumulated — typically near 0
// if the agent doesn't reach late-game pickups. To make this a pure
// MiniGrid-style sparse-reward game, also zero out the +500/+1000
// intermediate deltas above.
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
const ROWS = 6;  // v5_2rooms_door_6x6: shrunk from 8x8 to 6x6.
const COLS = 6;
const PATROL_INTERVAL = 12;  // frames between patrol-enemy moves (2x player cooldown)
const DEATH_PENALTY = 5000;
const MOVE_COOLDOWN = 6;
const LASER_CYCLE = 120;

// MiniGrid-style step-decay win reward: faster wins → higher reward.
// On success: WIN_REWARD_SCALE * (1 - 0.9 * (frameCount / MAX_STEPS)).
// On failure (death, timeout): score stays at whatever intermediate
// pickups/kills/curses accumulated (or 0 if you also zero those out).
// MAX_STEPS should match the env-side truncation budget; node-gym's
// default is 2000 frames per episode for these grid games.
const MAX_STEPS = 2000;
const WIN_REWARD_SCALE = 100000;  // keeps magnitude similar to old 50k-80k win bonus

const ROLE_HAT      = 'HAT';
const ROLE_BLUE_KEY = 'BLUE_KEY';
const ROLE_SWORD    = 'SWORD';
const ROLE_BOOTS    = 'BOOTS';
const ROLE_ARMOR    = 'ARMOR';  // v7 torso item; pure distractor here (no spike gate)
const ROLE_REWARD   = 'REWARD';
const ROLE_CURSE    = 'CURSE';

const TOOL_VISUAL_IDS  = [6, 7, 12, 14, 17, 18];  // 6-item mod: id 18 = teal breastplate token (6th slot)
const VALUE_VISUAL_IDS = [];  // v1.6: coin REWARD (8) / diamond CURSE (15) removed -> tool-only binding (360/60/300)
const PICKUP_COOLDOWN = 14;   // v1.8b: 14 frames = 2 agent decisions at frame_skip 7 (down from 49)
const MAX_INVENTORY = 1;  // inv1 variant: avatar holds only ONE item (was 2).
const DROP_COOLDOWN = 45;  // frames; matches platformer for visible blink

let gameState = 'PLAYING';
let score = 0;
let lives = 3;
// Per-episode step counter (resets in resetGame). Distinct from p5's
// `frameCount`, which is monotonic across the lifetime of the worker
// and would degrade the step-decay reward after the first episode.
let episodeSteps = 0;
let inventoryQueue = [];
let toolMapping = {};
let valueMapping = {};
let penaltyTimer = 0;
let moveCooldown = 0;
let pickupCooldown = 0;  // v1.6: frames remaining before the next pickup is allowed
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
    pickupCooldown = 0;
    laserTimer = 0;
    enemies = [];
    gameState = 'PLAYING';
    episodeSteps = 0;
    shuffleRoles();
    initRoom();
    resetPlayer();
}

function shuffleRoles() {
    // 6-item mod (mirrors v7.js): 6 roles for the 6 visual tokens, 5 distinct.
    // The 6th role is a SECOND SWORD; with no enemy on the 6x6 map both swords
    // are pure distractors.
    const toolRoles = [ROLE_HAT, ROLE_BLUE_KEY, ROLE_BOOTS, ROLE_SWORD, ROLE_ARMOR, ROLE_SWORD];
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
    // 6x6 layout: left room cols 0-1 (12 cells), wall at col 2 (full
    // height), right room cols 3-5 (18 cells). Door at (col=2, row=2),
    // goal at (col=5, row=0), spawn at (col=0, row=5). Min path length
    // spawn->door->goal ~10 steps; 2000-step horizon gives 200x slack.
    mapData = [
        [0,0,1,0,0,11],
        [0,0,1,0,0,0],
        [0,0,2,0,0,0],
        [0,0,1,0,0,0],
        [0,0,1,0,0,0],
        [0,0,1,0,0,0],
    ];
    startCell = { c: 0, r: 5 };

    // 6 pickup spots (one per tool role), randomized per seed across the
    // left room (cols 0-1). Excludes the spawn cell + the 4 cells within
    // Chebyshev distance 1 of the spawn, AND the door's row (row 2) so no
    // item sits on the spawn->door crossing and can be grabbed incidentally.
    // That leaves exactly 6 candidate cells (rows 0,1,3 x cols 0,1) for the
    // 6 items, so every item is placed and only the visual->cell assignment
    // varies per seed. No value-item distractors in 6x6.
    const DOOR_ROW = 2;  // BLUE_KEY door is at (col 2, row 2)
    const candidates = [];
    for (let r = 0; r <= 5; r++) {
        for (let c = 0; c <= 1; c++) {
            if (Math.abs(c - startCell.c) <= 1 && Math.abs(r - startCell.r) <= 1) continue;
            if (r === DOOR_ROW) continue;  // keep the door's row clear of items
            candidates.push({ c, r });
        }
    }
    shuffleInPlace(candidates);
    const spots = candidates.slice(0, 6);

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
    // Per-episode step counter; the win-reward step-decay reads this. One
    // tick == one Python env.step (per runtime/p5/game-env.mjs).
    episodeSteps++;
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
                    score += 1000;
                    enemies.splice(i, 1);
                } else {
                    die();
                }
            }
        }
    }

    if (pickupCooldown > 0) pickupCooldown--;  // v1.6: throttle between pickups

    // Strict deliberate pickup: fires ONLY on a STANDALONE space press (the
    // pure-SPACE action) — not while a movement key is held, so the move+SPACE
    // actions (L+SP / R+SP) cannot grab. Grabbing costs a dedicated turn, which
    // blocks the "sweep-and-grab" exploit. No walk-over pickup either. v1.6:
    // also gated by the pickup cooldown so items can't be cycled rapidly.
    if (pickupCooldown <= 0 && keyIsDown(32) && !keyIsDown(LEFT_ARROW)
        && !keyIsDown(RIGHT_ARROW) && !keyIsDown(UP_ARROW) && !keyIsDown(DOWN_ARROW)) {
        tryPickup();
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
        if (hasItem(ROLE_BLUE_KEY)) { consumeItem(ROLE_BLUE_KEY); clearDoor(5); score += 1000; }
        else return;
    }

    // Key-locked door: opens with BLUE_KEY held; key is consumed
    // (matches v4 blue-door semantics). Opening grants +1000 and clears
    // all tile=2 cells. Without BLUE_KEY the move is blocked (no death).
    if (tile === 2) {
        if (hasItem(ROLE_BLUE_KEY)) { consumeItem(ROLE_BLUE_KEY); clearDoor(2); score += 1000; }
        else return;
    }

    const enemyIdx = enemies.findIndex(e => e.c === nc && e.r === nr);
    if (enemyIdx !== -1) {
        if (hasItem(ROLE_SWORD)) {
            consumeItem(ROLE_SWORD); score += 1000; enemies.splice(enemyIdx, 1);
        } else {
            die(); return;
        }
    }

    player.c = nc;
    player.r = nr;

    // Deliberate-pickup variant: walking onto an item does NOT collect it.
    // Items and evicted drops are only taken via the explicit pickup action
    // (handled in updateGame -> tryPickup). tryMove resolves movement, the
    // door (pre-move above), and terminal tiles only.
    const here = mapData[player.r][player.c];
    if (here === 4) {
        // Sunbeam: lethal without hat (no sunbeam tile on the 6x6 map; kept for parity).
        if (!hasItem(ROLE_HAT)) { die(); return; }
    }
    if (here === 11) { handleVictory(); return; }
}

// Explicit pickup: collect a tool/value token or an evicted drop on the
// player's current cell. Called only when the pickup action (space) is taken.
function tryPickup() {
    const here = mapData[player.r][player.c];
    if (TOOL_VISUAL_IDS.includes(here)) {
        const role = toolMapping[here];
        mapData[player.r][player.c] = 0;
        addItem(role, here);
        // v1.7: +500 pickup reward REMOVED (like v2) — no incentive to grab items.
        pickupCooldown = PICKUP_COOLDOWN;  // v1.6: block re-pickup for a while
        return;
    }
    if (VALUE_VISUAL_IDS.includes(here)) {
        const role = valueMapping[here];
        mapData[player.r][player.c] = 0;
        if (role === ROLE_REWARD) { score += 1000; }
        else                       { score -= 1000; penaltyTimer = 30; }
        return;
    }
    const dropKey = `${player.c},${player.r}`;
    const drop = persistentDrops[dropKey];
    if (drop && drop.cooldown <= 0) {
        delete persistentDrops[dropKey];
        addItem(drop.role, drop.visualId);
    }
}

function handleVictory() {
    // MiniGrid-style step-decay reward: linear from WIN_REWARD_SCALE * 1.0 at
    // step 0 down to WIN_REWARD_SCALE * 0.1 at step MAX_STEPS. Faster wins
    // are rewarded more, matching the standard exploration-benchmark recipe
    // (RIDE, BeBold, NovelD all use this shape on MiniGrid-DoorKey-6x6).
    // Uses `episodeSteps` (per-episode counter), NOT p5's monotonic
    // `frameCount` — the latter never resets across episodes and would
    // collapse the decay to its 0.1 floor after the first ~2000-frame
    // milestone in the worker's lifetime.
    const decay = Math.max(0.1, 1.0 - 0.9 * (episodeSteps / MAX_STEPS));
    score += WIN_REWARD_SCALE * decay;
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
    // v1.9: id 7 changes from a BLUE KEY to a SECOND SWORD (crimson, upright).
    // We replace the BLUE key (not the green one) so NO item shares the blue
    // door's color -> removes any "grab the door-colored item" shortcut; the sole
    // remaining key is green (id17), forcing the body-placement cue.
    if (vid === 7)  return color(220, 30, 40);
    if (vid === 17) return color(0, 150, 0);   // green key (the only key-shaped icon)
    if (vid === 12) return color(200);
    if (vid === 14) return color(150, 0, 255);
    // 6-item mod: teal breastplate token. Teal is the open hue in the palette
    // (pink/blue/green/gray/purple already taken) and stays clear of the
    // yellow/orange value icons.
    if (vid === 18) return color(0, 200, 170);
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
    } else if (id === 17) {
        // Green key (the only key-shaped icon now): round bow + shaft.
        ellipse(x, y - 4, 10);
        rect(x - 2, y - 4, 4, 12);
    } else if (id === 12) {
        // Sword 1: thin GRAY blade at 45deg with a brown crossguard.
        push();
        translate(x, y); rotate(PI / 4);
        rect(-2, -10, 4, 16);
        fill(150, 75, 0); rect(-6, 6, 12, 3);
        pop();
    } else if (id === 7) {
        // v1.9 Sword 2: UPRIGHT crimson broadsword — distinct from id12 by both
        // orientation (vertical vs 45deg) and color (crimson vs gray), so the two
        // sword visuals are unambiguous at the 4:1 (64x64) downsample. `c` (=fill)
        // is the crimson role color set at the top of drawToolVisual.
        rect(x - 3, y - 11, 6, 15);          // blade: thick, vertical
        fill(150, 75, 0);
        rect(x - 7, y + 2, 14, 3);           // crossguard: horizontal, brown
        rect(x - 2, y + 5, 4, 4);            // grip / pommel
    } else if (id === 14) {
        rect(x - 8, y - 8, 12, 8, 2);
        rect(x - 8, y, 18, 6, 2);
    } else if (id === 18) {
        // Breastplate / cuirass: a torso plate flanked by two shoulder pauldrons.
        // Distinct silhouette from the other tokens, sized to survive the 4:1
        // downsample.
        rect(x - 7, y - 5, 14, 13, 3);   // chest plate
        rect(x - 11, y - 7, 6, 5, 2);    // left pauldron
        rect(x + 5,  y - 7, 6, 5, 2);    // right pauldron
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

    // Armor (v7 item): chest plate over the torso, colored by the equipped
    // armor's visualId. Completes the body-region cue set — HAT on the head,
    // ARMOR the torso, BOOTS the feet. Distractor here (no spike to use it on),
    // but still rendered so the bound item is visible while held.
    const armor = inventoryQueue.find(it => it.role === ROLE_ARMOR);
    if (armor) {
        fill(getItemColor(armor.visualId));
        rect(-10, -2, 20, 7);   // chest plate across the body center
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
        } else if (item.role !== ROLE_BOOTS && item.role !== ROLE_HAT && item.role !== ROLE_ARMOR) {
            push(); scale(0.6); translate(-12 + idx * 10, 12); drawToolVisual(item.visualId, 0, 0); pop();
        }
    });

    pop();
}

function keyPressed() {}
