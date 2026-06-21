// ===== cavequest_hard_explore: exploration-friendly hard variant =====
// Same as analogen_cavequest_hard EXCEPT two exploration changes:
//   (1) DEATH_PENALTY = 0 — death no longer reduces score, so banked gate
//       rewards are permanent (under abs_one the old penalty erased them: dying
//       after grabbing a gate gave -1, making the policy risk-averse and parking
//       it at ~2000). Dying still costs a life/respawn.
//   (2) First laser cross grants +1000 (one-time, flagged so back-and-forth
//       can't farm it) — shortens the unrewarded prefix (laser->spike) so the
//       agent gets an earlier reward gradient up the forced gate chain.
// ======================================================================
//
// ===== cavequest_hard: medium-pickup port (this revision) =====
// Brings the cavequest_medium pickup mechanics into hard:
//   - DELIBERATE standalone pickup: walking onto an item no longer collects it;
//     tool/value tokens and evicted drops are taken only via the pure-SPACE
//     pickup action (tryPickup), gated by a cooldown.
//   - 14-frame PICKUP_COOLDOWN throttles re-pickup (medium v1.8b).
//   - Tool pickups grant NO reward. Only the value items (coin/diamond bound to
//     REWARD/CURSE) pay out (+1000 / -1000 by binding). Enemy kills, door-open,
//     and spike-clear still grant +1000 each.
//   - The 6-item-mod 2nd enemy (by the blue door at (4,1)) now PATROLS up/down
//     (col 4, rows 0-3), like the medium env's patroller. Bottom enemy (3,6)
//     stays stationary.
//   - Intended reward_clipping = abs_one (set in the config).
// NOTE: STEP_PENALTY (0.005/frame) is unchanged and was sized for symlog; under
// abs_one it survives clipping while the win collapses to +1 (see handoff).
// ==============================================================
//
// analogen_nomemory_grid_v7
// Copy of analogen_nomemory_grid_v5_stepcost (keeps the per-step living cost)
// with four changes:
//   (1) NEW binding pair ARMOR <-> SPIKE replaces the duplicate SWORD. The role
//       pool was [HAT, BLUE_KEY, BOOTS, SWORD, SWORD]; the 2nd SWORD becomes
//       ARMOR. ARMOR is a CONSUMABLE like SWORD/BLUE_KEY (NOT a protective
//       hold-to-pass item like HAT/BOOTS): stepping onto the SPIKE tile (id 9)
//       with armor consumes it, clears the spike (+1000), and passes; without
//       armor the spike is lethal. Consumable (one-and-done) is what keeps the
//       env solvable on the 2-slot inventory — a third *held* gate alongside
//       BOOTS(laser)+HAT(sunbeam) would deadlock the inventory. Armor still
//       transforms the body: a chest plate over the torso while held, the torso
//       member of the head(HAT)/torso(ARMOR)/feet(BOOTS) cue set.
//   (2) The moving (patrol) top enemy at (4,2) is removed, along with its two
//       "pillar" walls at (4,0)/(4,3), so the top-middle room is now a clean
//       2x4. The new SPIKE gate spans the full width of the top-right room at
//       row 2 (spikes at (6,2) AND (7,2)) — a 2-tile-wide forced barrier on the
//       laser->door corridor. One stationary enemy (bottom) + one SWORD remain.
//   (3) HAT no longer morphs the item into a generic hat silhouette. The HAT
//       role's bound item is instead drawn as its OWN icon sitting on top of
//       the head — position is the cue, the shape stays the item's true icon
//       (like the key, which shows its real icon rather than a key shape).
//   (4) The cell directly below the laser, (7,5), never spawns a pickup.
//
//   (5) [6-item / 2-sword mod] Item count goes 5 -> 6. A 6th visual token
//       (id 18, a teal breastplate icon) joins TOOL_VISUAL_IDS, and the role
//       pool gains a SECOND SWORD:
//         [HAT, BLUE_KEY, BOOTS, SWORD, ARMOR, SWORD]  (6 roles, 5 distinct).
//       The duplicate SWORD is paired with a SECOND enemy: a stationary guard
//       at (4,1), directly left of the BLUE DOOR. (4,1) is the only cell the
//       door opens onto, i.e. the chokepoint into the top-middle room, so it is
//       a FORCED sword gate on the door->sunbeam leg (mirrors v5's 2-sword /
//       2-enemy pairing, but stationary — the v5 patrol stays retired). 6 tool
//       tokens + 2 value tokens still fill the same 8 bottom-room pickup spots.
//
// ----- original v5_stepcost header -----
// analogen_nomemory_grid_v5_stepcost
// Identical to analogen_nomemory_grid_v5 EXCEPT for a per-step living cost:
// every frame the game is PLAYING, score is decremented by STEP_PENALTY (see
// below). This is the env-side time penalty (MiniGrid-style "time is
// expensive", encoded per-step rather than as a decayed terminal reward so it
// also punishes idling on non-winning paths). It exists to kill the post-task
// argmax oscillation seen on the abs_one v5 LSTM runs (jobs 18565971/18565989),
// where the greedy policy farmed pickups then ping-ponged to the 2000-step
// truncation. NOTE: STEP_PENALTY is sized for a symlog-transformed reward
// (reward_clip="symlog"): symlog(x)~=x for small x, so the raw 0.005 lands at
// ~0.005/step in the agent's symlog reward space (~ -10 over a full 2000-step
// episode, roughly one symlog'd win). Under raw reward (reward_clip="none") it
// would be negligible vs the +500..+50000 deltas and need to be ~1-10 instead.
//
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
const ROWS = 8;  // v4: 8x8 → canvas 256, downsamples to 64 at exact 4:1.
const COLS = 8;
const PATROL_INTERVAL = 12;  // frames between patrol-enemy moves (2x player cooldown)
const DEATH_PENALTY = 0;  // explore variant: death no longer reduces score (banked gate
                          // rewards become permanent; dying only costs a life/respawn).
// Per-frame living cost. DISABLED (0): at the 35000-frame horizon the old
// 0.005/frame accrued ~-175/episode, swamping the abs_one +1 win and making the
// greedy policy idle the whole episode (observed greedy_return=-175). Zeroed to
// unblock learning. `score -= STEP_PENALTY` below is now a no-op.
const STEP_PENALTY = 0;
const MOVE_COOLDOWN = 6;
const LASER_CYCLE = 120;

const ROLE_HAT      = 'HAT';
const ROLE_BLUE_KEY = 'BLUE_KEY';
const ROLE_SWORD    = 'SWORD';
const ROLE_BOOTS    = 'BOOTS';
const ROLE_ARMOR    = 'ARMOR';  // v7: replaces the duplicate SWORD; pairs with SPIKE
const ROLE_REWARD   = 'REWARD';
const ROLE_CURSE    = 'CURSE';

const TOOL_VISUAL_IDS  = [6, 7, 12, 14, 17, 18];  // 6-item mod: id 18 = teal breastplate token (6th slot)
const VALUE_VISUAL_IDS = [8, 15];
const PICKUP_COOLDOWN = 14;   // ported from medium (v1.8b): re-pickup lockout frames
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
let pickupCooldown = 0;  // frames remaining before the next standalone pickup is allowed
let laserTimer = 0;
let laserRewarded = false;  // explore variant: one-time +1000 for the first laser cross
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
    laserRewarded = false;
    enemies = [];
    gameState = 'PLAYING';
    shuffleRoles();
    initRoom();
    resetPlayer();
}

function shuffleRoles() {
    // 6-item mod: 6 roles for the 6 visual tokens, 5 distinct. The 6th role is a
    // SECOND SWORD (mirrors v5's duplicate SWORD), paired with the 2nd enemy.
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
    // 0=floor, 1=wall, 4=sunbeam, 5=blue door, 9=spike (NEW, v7), 10=laser,
    // 11=goal, 13=enemy.
    // 8x8, no outer-border walls (out-of-bounds enforced by tryMove).
    // Top: 4 floor rows (0-3) split into 3 rooms by internal walls at
    // cols 2 and 5. Doors at (2,1) RED and (5,1) BLUE. Goal at (0,0) —
    // top-LEFT corner of top-left room. v7: the middle-top patrol enemy at
    // (4,2) is REMOVED, and so are its two "pillar" walls at (4,0) and (4,3),
    // leaving the top-middle room a clean 2x4 (cols 3-4, rows 0-3). The
    // top-right room (cols 6-7, rows 0-3) gets a 2-tile-wide SPIKE gate:
    // spikes at (6,2) AND (7,2) span the full width of row 2, so the only way
    // up from the laser-entry row to the BLUE_DOOR row is through the spikes
    // (forced; engage with ARMOR to consume it and clear both). Main wall row
    // 4 with laser at (7,4). Bottom: rows 5-7 (3 floor rows). Spawn at (1,7).
    // Two stationary enemies (6-item mod): one at (3,6) in the bottom room and
    // one at (4,1) left of the BLUE_DOOR; the two pair with the two SWORD roles.
    // Forced path:
    //   LASER(7,4) -> (7,3)/(6,3) -> SPIKES(6,2)+(7,2) -> top-right ->
    //   BLUE_DOOR(5,1) -> ENEMY(4,1) -> top-middle(3-4) -> SUNBEAM(2,1) ->
    //   top-left(0-1,0-3) -> GOAL(0,0).
    mapData = [
        [11,0,1,0,0,1,0,0],
        [0,0,4,0,13,5,0,0],
        [0,0,1,0,0,1,9,9],
        [0,0,1,0,0,1,0,0],
        [1,1,1,1,1,1,1,10],
        [0,0,0,0,0,0,0,0],
        [0,0,0,13,0,0,0,0],
        [0,0,0,0,0,0,0,0],
    ];
    startCell = { c: 1, r: 7 };

    // 8 pickup spots, position randomized per seed. Enumerate all floor
    // cells in the bottom area (rows 5-7 × cols 0-7), exclude:
    //   - the spawn cell
    //   - the 8 cells within Chebyshev distance 1 of the spawn (so the
    //     agent always has at least 1 free move before auto-pickup kicks
    //     in — otherwise a spawn-adjacent item forces a pickup on move 1,
    //     turning the puzzle into "navigate the swap dance from a bad
    //     starting inventory")
    //   - the bottom enemy's cell
    // Then shuffle and take the first 8.
    const candidates = [];
    for (let r = 5; r <= 7; r++) {
        for (let c = 0; c <= 7; c++) {
            if (Math.abs(c - startCell.c) <= 1 && Math.abs(r - startCell.r) <= 1) continue;
            if (c === 3 && r === 6) continue;  // bottom enemy spawn
            if (c === 7 && r === 5) continue;  // v7: cell directly below the laser stays empty
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
                // The 6-item-mod 2nd enemy by the blue door at (4,1) now PATROLS
                // up/down (col 4, rows 0-3; row 4 is the wall row) like the medium
                // env's patroller — a timing-based sword gate on the door->sunbeam
                // leg. The bottom enemy at (3,6) stays stationary.
                const patrol = (c === 4 && r === 1);
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
    // Per-step living cost: every PLAYING frame bleeds STEP_PENALTY from score
    // (emitted as part of the node-gym per-step reward delta). Applied before
    // the moveCooldown early-return so it accrues on every frame, not just on
    // move frames. Only winning (or dying) ends the bleed — this is what kills
    // the argmax oscillation. The win/pickup deltas dwarf it, so it only
    // dominates on zero-reward (idle/wander) steps.
    score -= STEP_PENALTY;
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

    if (pickupCooldown > 0) pickupCooldown--;

    // Deliberate pickup (ported from medium): fires ONLY on a STANDALONE space
    // press (the pure-SPACE action) — not while a movement key is held — and is
    // gated by the pickup cooldown. Grabbing costs a dedicated turn, so items
    // can't be swept up by walking or cycled rapidly at a gate.
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

    // Deliberate-pickup variant (ported from medium): walking onto an item does
    // NOT collect it. Tool/value tokens and evicted drops are taken only via the
    // explicit standalone-pickup action (updateGame -> tryPickup). tryMove
    // resolves movement, the pre-move door/enemy gates (above), and the terminal
    // hazard/goal tiles only.
    const here = mapData[player.r][player.c];
    if (here === 10) {
        // Always-active: lethal without boots, safe with boots. No timing cycle.
        if (!hasItem(ROLE_BOOTS)) { die(); return; }
        // explore variant: reward the FIRST successful laser cross (+1000, one-time
        // so walking back and forth can't farm it). Shortens the unrewarded prefix
        // before the spike so the agent gets an earlier gradient up the chain.
        if (!laserRewarded) { score += 1000; laserRewarded = true; }
    }
    if (here === 4) {
        // Sunbeam: lethal without hat, safe with hat. Mirror of laser/boots.
        if (!hasItem(ROLE_HAT)) { die(); return; }
    }
    if (here === 9) {
        // Spike trap (v7): a CONSUMABLE obstacle, not a hold-to-pass gate.
        // Engaging it with ARMOR consumes the armor and clears the spike for
        // good (+1000) — same shape as SWORD vs an enemy / BLUE_KEY vs the
        // door. Without armor it is lethal.
        if (hasItem(ROLE_ARMOR)) { consumeItem(ROLE_ARMOR); clearDoor(9); score += 1000; }
        else { die(); return; }
    }
    if (here === 11) { handleVictory(); return; }
}

// Explicit pickup (ported from medium): collect a tool/value token or an evicted
// drop on the player's current cell. Called only when the standalone pickup
// action fires (pure SPACE, no movement key) and the pickup cooldown has elapsed.
function tryPickup() {
    const here = mapData[player.r][player.c];
    if (TOOL_VISUAL_IDS.includes(here)) {
        const role = toolMapping[here];
        mapData[player.r][player.c] = 0;
        addItem(role, here);
        // Tool pickups grant NO reward (only value items / kills / gates pay out).
        pickupCooldown = PICKUP_COOLDOWN;
        return;
    }
    if (VALUE_VISUAL_IDS.includes(here)) {
        const role = valueMapping[here];
        mapData[player.r][player.c] = 0;
        // Value items pay out by their binding: REWARD coin +1000, CURSE -1000.
        if (role === ROLE_REWARD) { score += 1000; }
        else                       { score -= 1000; penaltyTimer = 30; }
        pickupCooldown = PICKUP_COOLDOWN;
        return;
    }
    const dropKey = `${player.c},${player.r}`;
    const drop = persistentDrops[dropKey];
    if (drop && drop.cooldown <= 0) {
        delete persistentDrops[dropKey];
        addItem(drop.role, drop.visualId);
        pickupCooldown = PICKUP_COOLDOWN;
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
    } else if (TOOL_VISUAL_IDS.includes(type)) {
        drawToolVisual(type, x + 16, y + 16);
    } else if (VALUE_VISUAL_IDS.includes(type)) {
        drawValueVisual(type, x + 16, y + 16);
    } else if (type === 10) {
        // Boots visibly disable the laser: yellow (lethal) without boots,
        // gray (safe) with boots. Same render rect as v1.
        fill(hasItem(ROLE_BOOTS) ? color(60) : color(255, 255, 0));
        rect(x + 2, y + 14, 28, 4);
    } else if (type === 9) {
        // Spike trap (v7): always-spiked light-gray upward spikes. It is a
        // CONSUMABLE obstacle (engaging with ARMOR consumes the armor and
        // clears the tile), so it does NOT gray out / retract when armor is
        // held — it stays visibly lethal until actually cleared. Physical
        // hazard, distinct from the yellow laser/sunbeam beams.
        fill(210);
        // Three tall, sharp, separated spikes (narrow bases with gaps between).
        triangle(x + 2,  y + 28, x + 5,  y + 5, x + 8,  y + 28);   // left
        triangle(x + 13, y + 28, x + 16, y + 5, x + 19, y + 28);   // middle
        triangle(x + 24, y + 28, x + 27, y + 5, x + 30, y + 28);   // right
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

    // Hat (v7): the HAT role's bound item is drawn as its OWN icon sitting on
    // top of the head — NOT morphed into a generic hat silhouette (the pre-v7
    // behavior). Position (above the head) is the role cue; the shape stays the
    // item's true icon, exactly like the key shows its real icon on the belt.
    const hat = inventoryQueue.find(it => it.role === ROLE_HAT);
    if (hat) {
        drawToolVisual(hat.visualId, 0, -20);   // bound icon, centered above the head
    }

    // Armor (v7): chest plate over the torso, colored by the equipped armor's
    // visualId. Completes the body-region cue set — HAT on the head, ARMOR the
    // torso, BOOTS the feet.
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
        } else if (item.role !== ROLE_BOOTS && item.role !== ROLE_ARMOR && item.role !== ROLE_HAT) {
            push(); scale(0.6); translate(-12 + idx * 10, 12); drawToolVisual(item.visualId, 0, 0); pop();
        }
    });

    pop();
}

function keyPressed() {}
