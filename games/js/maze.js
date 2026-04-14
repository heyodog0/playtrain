let score = 0;
let lives = 1;
let gameState = 'PLAYING';
let rng = null;

const GRID_SIZE = 21;
const CELL_SIZE = 20;
const CANVAS_SIZE = GRID_SIZE * CELL_SIZE;
const PLAYER_SIZE = 10;
const GOAL_SIZE = 14;
const SPEED = 3;

let grid = [];
let player = { x: 0, y: 0 };
let goal = { r: 0, c: 0 };

function setup() {
    createCanvas(CANVAS_SIZE, CANVAS_SIZE);
    noStroke();
}

function resetGame(seed) {
    rng = mulberry32(seed);
    score = 0;
    lives = 1;
    gameState = 'PLAYING';

    grid = [];
    for (let r = 0; r < GRID_SIZE; r++) {
        let row = [];
        for (let c = 0; c < GRID_SIZE; c++) {
            row.push(0);
        }
        grid.push(row);
    }

    let stack = [];
    let startR = 1;
    let startC = 1;
    grid[startR][startC] = 1;
    stack.push({ r: startR, c: startC });

    let maxDist = 0;
    goal = { r: startR, c: startC };

    while (stack.length > 0) {
        let current = stack[stack.length - 1];
        let neighbors = [];
        let dirs = [
            { dr: -2, dc: 0 }, { dr: 2, dc: 0 },
            { dr: 0, dc: -2 }, { dr: 0, dc: 2 }
        ];

        for (let d of dirs) {
            let nr = current.r + d.dr;
            let nc = current.c + d.dc;
            if (nr > 0 && nr < GRID_SIZE - 1 && nc > 0 && nc < GRID_SIZE - 1) {
                if (grid[nr][nc] === 0) {
                    neighbors.push({ r: nr, c: nc, dr: d.dr, dc: d.dc });
                }
            }
        }

        if (neighbors.length > 0) {
            let next = neighbors[Math.floor(rng() * neighbors.length)];
            grid[current.r + next.dr / 2][current.c + next.dc / 2] = 1;
            grid[next.r][next.c] = 1;
            stack.push({ r: next.r, c: next.c });

            if (stack.length > maxDist) {
                maxDist = stack.length;
                goal = { r: next.r, c: next.c };
            }
        } else {
            stack.pop();
        }
    }

    player.x = startC * CELL_SIZE + CELL_SIZE / 2;
    player.y = startR * CELL_SIZE + CELL_SIZE / 2;
}

function checkWallCollision(px, py) {
    let left = Math.floor((px - PLAYER_SIZE / 2) / CELL_SIZE);
    let right = Math.floor((px + PLAYER_SIZE / 2) / CELL_SIZE);
    let top = Math.floor((py - PLAYER_SIZE / 2) / CELL_SIZE);
    let bottom = Math.floor((py + PLAYER_SIZE / 2) / CELL_SIZE);

    for (let r = top; r <= bottom; r++) {
        for (let c = left; c <= right; c++) {
            if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE || grid[r][c] === 0) {
                return true;
            }
        }
    }
    return false;
}

function draw() {
    if (gameState === 'PLAYING') {
        let dx = 0;
        let dy = 0;
        if (keyIsDown(37)) dx -= SPEED;
        if (keyIsDown(39)) dx += SPEED;
        if (keyIsDown(38)) dy -= SPEED;
        if (keyIsDown(40)) dy += SPEED;

        if (dx !== 0) {
            player.x += dx;
            if (checkWallCollision(player.x, player.y)) {
                player.x -= dx;
            }
        }
        
        if (dy !== 0) {
            player.y += dy;
            if (checkWallCollision(player.x, player.y)) {
                player.y -= dy;
            }
        }

        let gx = goal.c * CELL_SIZE + CELL_SIZE / 2;
        let gy = goal.r * CELL_SIZE + CELL_SIZE / 2;
        
        if (Math.abs(player.x - gx) < (PLAYER_SIZE + GOAL_SIZE) / 2 &&
            Math.abs(player.y - gy) < (PLAYER_SIZE + GOAL_SIZE) / 2) {
            score += 10;
            gameState = 'WIN';
        }
    }

    background(0);
    
    fill(120);
    for (let r = 0; r < GRID_SIZE; r++) {
        for (let c = 0; c < GRID_SIZE; c++) {
            if (grid[r][c] === 0) {
                rect(c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, CELL_SIZE);
            }
        }
    }

    fill(0, 255, 0);
    rect(goal.c * CELL_SIZE + (CELL_SIZE - GOAL_SIZE) / 2, goal.r * CELL_SIZE + (CELL_SIZE - GOAL_SIZE) / 2, GOAL_SIZE, GOAL_SIZE);

    fill(0, 150, 255);
    rect(player.x - PLAYER_SIZE / 2, player.y - PLAYER_SIZE / 2, PLAYER_SIZE, PLAYER_SIZE);
}

function getGameState() {
    return { score, lives, gameState };
}

function mulberry32(seed) {
    let t = seed >>> 0;
    return () => {
        t += 0x6D2B79F5;
        let n = Math.imul(t ^ (t >>> 15), t | 1);
        n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
        return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
    };
}