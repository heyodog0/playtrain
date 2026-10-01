// ============================================================
// REQUIRED: p5.js lifecycle
// ============================================================

const GRID_COLS = 5;
const GRID_ROWS = 4;
const CELL_SIZE = 60;
const MARGIN_X = 50;
const MARGIN_Y = 70;

let score = 0;
let lives = 3;
let gameState = 'PLAYING';
let seed = 0;
let level = 1;

let jumps = 3;
let freeze_timer = 0;

let h_edges, v_edges, cells;
let corner_bonus;

let player;
let enemies = [];
let player_spawn;
let enemy_spawns = [];
let spaceWasDown = false;

function setup() {
    createCanvas(400, 400);
}

function draw() {
    background(20);

    if (gameState === 'GAMEOVER') {
        renderGame();
        return;
    }

    handleInput();
    updatePlayer();
    
    if (freeze_timer > 0) {
        freeze_timer--;
    } else {
        updateEnemies();
        checkCollisions();
    }

    renderGame();
}

// ============================================================
// REQUIRED: RL interface
// ============================================================

function getGameState() {
    return { score, lives, gameState };
}

function resetGame(s) {
    seed = s;
    rng = mulberry32(seed);
    score = 0;
    lives = 3;
    gameState = 'PLAYING';
    level = 1;
    initLevel();
}

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
// GAME LOGIC
// ============================================================

function initLevel() {
    h_edges = Array(GRID_ROWS + 1).fill().map(() => Array(GRID_COLS).fill(false));
    v_edges = Array(GRID_ROWS).fill().map(() => Array(GRID_COLS + 1).fill(false));
    cells = Array(GRID_ROWS).fill().map(() => Array(GRID_COLS).fill(false));
    corner_bonus = false;
    jumps = 3;
    freeze_timer = 0;

    // Seed-controlled spawns
    player_spawn = {
        gx: Math.floor(rng() * (GRID_COLS + 1)),
        gy: GRID_ROWS
    };

    let num_enemies = 4 + (level > 2 ? 1 : 0);
    enemy_spawns = [];
    for (let i = 0; i < num_enemies; i++) {
        enemy_spawns.push({
            gx: Math.floor(rng() * (GRID_COLS + 1)),
            gy: Math.floor(rng() * 2), // top half
            type: (rng() < 0.3 || i === 0) ? 'pursuit' : 'patrol',
            bias: Math.floor(rng() * 4)
        });
    }

    resetPositions();
}

function resetPositions() {
    player = {
        gx: player_spawn.gx, gy: player_spawn.gy,
        tx: player_spawn.gx, ty: player_spawn.gy,
        progress: 0,
        dx: 0, dy: 0,
        intent_dx: 0, intent_dy: 0,
        moving: false,
        speed: 2.5
    };

    let e_speed = 1.5 + (level - 1) * 0.2;
    enemies = [];
    for (let s of enemy_spawns) {
        enemies.push({
            gx: s.gx, gy: s.gy,
            tx: s.gx, ty: s.gy,
            progress: 0,
            dx: 0, dy: 0,
            moving: false,
            type: s.type,
            bias: s.bias,
            speed: e_speed
        });
    }
}

function handleInput() {
    if (keyIsDown(37)) { player.intent_dx = -1; player.intent_dy = 0; }
    if (keyIsDown(39)) { player.intent_dx = 1;  player.intent_dy = 0; }
    if (keyIsDown(38)) { player.intent_dx = 0;  player.intent_dy = -1; }
    if (keyIsDown(40)) { player.intent_dx = 0;  player.intent_dy = 1; }

    if (keyIsDown(32)) {
        if (!spaceWasDown && jumps > 0 && freeze_timer === 0) {
            jumps--;
            freeze_timer = 120;
        }
        spaceWasDown = true;
    } else {
        spaceWasDown = false;
    }
}

function canMove(gx, gy, dx, dy) {
    if (dx === 0 && dy === 0) return false;
    let nx = gx + dx;
    let ny = gy + dy;
    if (nx < 0 || nx > GRID_COLS) return false;
    if (ny < 0 || ny > GRID_ROWS) return false;
    return true;
}

function tryStartMove(ent, isPlayer) {
    if (isPlayer) {
        if (canMove(ent.gx, ent.gy, ent.intent_dx, ent.intent_dy)) {
            ent.dx = ent.intent_dx;
            ent.dy = ent.intent_dy;
            ent.tx = ent.gx + ent.dx;
            ent.ty = ent.gy + ent.dy;
            ent.moving = true;
        } else if (canMove(ent.gx, ent.gy, ent.dx, ent.dy)) {
            ent.tx = ent.gx + ent.dx;
            ent.ty = ent.gy + ent.dy;
            ent.moving = true;
        } else {
            ent.dx = 0;
            ent.dy = 0;
            ent.moving = false;
        }
    } else {
        let dirs = [ {dx:0, dy:-1}, {dx:1, dy:0}, {dx:0, dy:1}, {dx:-1, dy:0} ];
        let valid = [];
        for (let d of dirs) {
            if (canMove(ent.gx, ent.gy, d.dx, d.dy)) {
                if (ent.dx !== 0 || ent.dy !== 0) {
                    if (d.dx === -ent.dx && d.dy === -ent.dy) continue; // no reverse
                }
                valid.push(d);
            }
        }

        if (valid.length === 0) {
            ent.dx = -ent.dx;
            ent.dy = -ent.dy;
        } else {
            if (ent.type === 'pursuit') {
                valid.sort((a, b) => {
                    let distA = Math.abs(ent.gx + a.dx - player.tx) + Math.abs(ent.gy + a.dy - player.ty);
                    let distB = Math.abs(ent.gx + b.dx - player.tx) + Math.abs(ent.gy + b.dy - player.ty);
                    return distA - distB;
                });
                ent.dx = valid[0].dx;
                ent.dy = valid[0].dy;
            } else {
                let choice = valid[ent.bias % valid.length];
                ent.dx = choice.dx;
                ent.dy = choice.dy;
            }
        }
        ent.tx = ent.gx + ent.dx;
        ent.ty = ent.gy + ent.dy;
        ent.moving = true;
    }
}

function updatePlayer() {
    if (!player.moving) {
        tryStartMove(player, true);
    }

    if (player.moving) {
        player.progress += player.speed;
        if (player.progress >= CELL_SIZE) {
            paintEdge(player.gx, player.gy, player.tx, player.ty);
            player.gx = player.tx;
            player.gy = player.ty;
            player.progress = 0;
            player.moving = false;
            
            checkCells();
            if (gameState === 'PLAYING') {
                tryStartMove(player, true);
            }
        }
    }
}

function updateEnemies() {
    for (let e of enemies) {
        if (!e.moving) {
            tryStartMove(e, false);
        }
        
        if (e.moving) {
            e.progress += e.speed;
            if (e.progress >= CELL_SIZE) {
                e.gx = e.tx;
                e.gy = e.ty;
                e.progress = 0;
                e.moving = false;
                tryStartMove(e, false);
            }
        }
    }
}

function paintEdge(x1, y1, x2, y2) {
    if (x1 !== x2) {
        let c = Math.min(x1, x2);
        let r = y1;
        if (!h_edges[r][c]) {
            h_edges[r][c] = true;
            score += 5;
        }
    } else if (y1 !== y2) {
        let c = x1;
        let r = Math.min(y1, y2);
        if (!v_edges[r][c]) {
            v_edges[r][c] = true;
            score += 5;
        }
    }
}

function checkCells() {
    let filled_count = 0;
    
    for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
            if (!cells[r][c]) {
                if (h_edges[r][c] && h_edges[r+1][c] && v_edges[r][c] && v_edges[r][c+1]) {
                    cells[r][c] = true;
                    score += 50;
                }
            }
            if (cells[r][c]) filled_count++;
        }
    }

    if (!corner_bonus && cells[0][0] && cells[0][GRID_COLS-1] && cells[GRID_ROWS-1][0] && cells[GRID_ROWS-1][GRID_COLS-1]) {
        corner_bonus = true;
        score += 150;
    }

    if (filled_count === GRID_ROWS * GRID_COLS) {
        score += 400;
        level++;
        initLevel();
    }
}

function checkCollisions() {
    let px = MARGIN_X + player.gx * CELL_SIZE + (player.moving ? player.dx * player.progress : 0);
    let py = MARGIN_Y + player.gy * CELL_SIZE + (player.moving ? player.dy * player.progress : 0);

    for (let e of enemies) {
        let epx = MARGIN_X + e.gx * CELL_SIZE + (e.moving ? e.dx * e.progress : 0);
        let epy = MARGIN_Y + e.gy * CELL_SIZE + (e.moving ? e.dy * e.progress : 0);
        
        if (Math.abs(px - epx) < 12 && Math.abs(py - epy) < 12) {
            lives--;
            if (lives <= 0) {
                gameState = 'GAMEOVER';
            } else {
                resetPositions();
                freeze_timer = 60; // Brief spawn invulnerability
            }
            break;
        }
    }
}

function renderGame() {
    let themeIdx = level % 2;
    let paintedColor = themeIdx === 1 ? color(0, 255, 255) : color(255, 255, 0);
    let cellColor = themeIdx === 1 ? color(0, 100, 100) : color(100, 100, 0);

    // Draw Lattice
    for (let r = 0; r <= GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
            strokeWeight(4);
            if (h_edges[r][c]) {
                stroke(paintedColor);
            } else {
                stroke(60);
            }
            line(MARGIN_X + c * CELL_SIZE, MARGIN_Y + r * CELL_SIZE, MARGIN_X + (c + 1) * CELL_SIZE, MARGIN_Y + r * CELL_SIZE);
        }
    }

    for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c <= GRID_COLS; c++) {
            strokeWeight(4);
            if (v_edges[r][c]) {
                stroke(paintedColor);
            } else {
                stroke(60);
            }
            line(MARGIN_X + c * CELL_SIZE, MARGIN_Y + r * CELL_SIZE, MARGIN_X + c * CELL_SIZE, MARGIN_Y + (r + 1) * CELL_SIZE);
        }
    }

    // Draw Filled Cells
    noStroke();
    fill(cellColor);
    for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
            if (cells[r][c]) {
                rect(MARGIN_X + c * CELL_SIZE + 6, MARGIN_Y + r * CELL_SIZE + 6, CELL_SIZE - 12, CELL_SIZE - 12);
            }
        }
    }

    // Draw HUD
    fill(255, 255, 0);
    for (let i = 0; i < jumps; i++) {
        ellipse(MARGIN_X + i * 15, 360, 10, 10);
    }
    
    fill(255, 50, 50);
    for (let i = 0; i < lives; i++) {
        rect(380 - MARGIN_X - i * 15, 355, 10, 10);
    }

    // Draw Player
    let px = MARGIN_X + player.gx * CELL_SIZE + (player.moving ? player.dx * player.progress : 0);
    let py = MARGIN_Y + player.gy * CELL_SIZE + (player.moving ? player.dy * player.progress : 0);
    
    noStroke();
    if (themeIdx === 1) {
        fill(0, 255, 255);
        rect(px - 8, py - 6, 16, 12);
    } else {
        fill(255, 128, 0);
        rect(px - 6, py - 6, 12, 12);
    }

    // Draw Enemies
    for (let e of enemies) {
        let epx = MARGIN_X + e.gx * CELL_SIZE + (e.moving ? e.dx * e.progress : 0);
        let epy = MARGIN_Y + e.gy * CELL_SIZE + (e.moving ? e.dy * e.progress : 0);
        
        if (freeze_timer > 0) {
            fill(freeze_timer % 10 < 5 ? 255 : 100);
        } else {
            fill(themeIdx === 1 ? color(255, 0, 255) : color(255, 0, 0));
        }
        
        if (themeIdx === 1) {
            triangle(epx, epy - 6, epx - 6, epy + 6, epx + 6, epy + 6);
        } else {
            ellipse(epx, epy, 12, 12);
        }
    }
}