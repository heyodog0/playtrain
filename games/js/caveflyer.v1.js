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

let score = 0;
let lives = 3;
let gameState = 'PLAYING';

let baseSeed = 0;
let overrides = {};
let blockHits = {};

let player = {
    x: 0, y: 0, w: 24, h: 24,
    facing: {dx: 0, dy: 1},
    mineCooldown: 0,
    invul: 0
};
let enemies = [];
let enemyTimer = 0;

function setup() {
  createCanvas(400, 400);
}

function getGameState() {
  return { score: score, lives: lives, gameState: gameState };
}

function resetGame(seed) {
    rng = mulberry32(seed);
    baseSeed = Math.floor(rng() * 1000000);
    score = 0;
    lives = 3;
    gameState = 'PLAYING';
    
    overrides = {};
    blockHits = {};
    enemies = [];
    enemyTimer = 0;
    
    player.x = 4;
    player.y = 4;
    player.facing = {dx: 0, dy: 1};
    player.mineCooldown = 0;
    player.invul = 0;
}

function hash2d(x, y, seed) {
    x = (x + 1000000) >>> 0;
    y = (y + 1000000) >>> 0;
    let n = (Math.imul(x, 1619) + Math.imul(y, 31337) + seed) >>> 0;
    n = Math.imul(n ^ (n >>> 14), 0x45d9f3b) >>> 0;
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b) >>> 0;
    n = (n ^ (n >>> 16)) >>> 0;
    return n / 4294967296;
}

function smoothNoise(x, y, seed) {
    let ix = Math.floor(x);
    let iy = Math.floor(y);
    let fx = x - ix;
    let fy = y - iy;
    
    let ux = fx * fx * (3 - 2 * fx);
    let uy = fy * fy * (3 - 2 * fy);
    
    let v00 = hash2d(ix, iy, seed);
    let v10 = hash2d(ix + 1, iy, seed);
    let v01 = hash2d(ix, iy + 1, seed);
    let v11 = hash2d(ix + 1, iy + 1, seed);
    
    let v0 = v00 * (1 - ux) + v10 * ux;
    let v1 = v01 * (1 - ux) + v11 * ux;
    return v0 * (1 - uy) + v1 * uy;
}

function getBlock(x, y) {
    let key = x + "," + y;
    if (overrides[key] !== undefined) return overrides[key];
    
    if (Math.abs(x) <= 1 && Math.abs(y) <= 1) return 0;
    
    let n = smoothNoise(x * 0.15, y * 0.15, baseSeed);
    if (n < 0.35) return 0;
    if (n < 0.45) return 1;
    
    let oreHash = hash2d(x, y, baseSeed + 1);
    if (oreHash < 0.01) return 5;
    if (oreHash < 0.03) return 4;
    if (oreHash < 0.10) return 3;
    
    return 2;
}

function getBlockMaxHits(type) {
    if (type === 1) return 1;
    if (type === 2) return 3;
    if (type === 3) return 2;
    if (type === 4) return 3;
    if (type === 5) return 4;
    return 1;
}

function getCollidingBlocks(x, y, w, h) {
    let minX = Math.floor(x / 32);
    let maxX = Math.floor((x + w - 0.001) / 32);
    let minY = Math.floor(y / 32);
    let maxY = Math.floor((y + h - 0.001) / 32);
    let blocks = [];
    for(let bx = minX; bx <= maxX; bx++) {
        for(let by = minY; by <= maxY; by++) {
            let b = getBlock(bx, by);
            if(b !== 0) {
                blocks.push({x: bx, y: by, type: b});
            }
        }
    }
    return blocks;
}

function rectIntersect(x1, y1, w1, h1, x2, y2, w2, h2) {
    return x1 < x2 + w2 && x1 + w1 > x2 && y1 < y2 + h2 && y1 + h1 > y2;
}

function updateEnemies() {
    enemyTimer++;
    if (enemyTimer > 90) {
        enemyTimer = 0;
        if (enemies.length < 8) {
            let angle = rng() * Math.PI * 2;
            let dist = 240; 
            let cx = player.x + player.w/2 + Math.cos(angle)*dist;
            let cy = player.y + player.h/2 + Math.sin(angle)*dist;
            let bx = Math.floor(cx/32);
            let by = Math.floor(cy/32);
            if (getBlock(bx, by) === 0) {
                enemies.push({ x: cx - 10, y: cy - 10, w: 20, h: 20, hp: 3 });
            }
        }
    }
    
    for (let i = enemies.length - 1; i >= 0; i--) {
        let e = enemies[i];
        let ex = e.x + e.w/2;
        let ey = e.y + e.h/2;
        let px = player.x + player.w/2;
        let py = player.y + player.h/2;
        let ang = Math.atan2(py - ey, px - ex);
        
        let dsq = (px-ex)*(px-ex) + (py-ey)*(py-ey);
        if (dsq > 600*600) {
            enemies.splice(i, 1);
            continue;
        }
        
        let evx = Math.cos(ang) * 1.5;
        let evy = Math.sin(ang) * 1.5;
        
        e.x += evx;
        if (getCollidingBlocks(e.x, e.y, e.w, e.h).length > 0) e.x -= evx;
        e.y += evy;
        if (getCollidingBlocks(e.x, e.y, e.w, e.h).length > 0) e.y -= evy;
        
        if (rectIntersect(player.x, player.y, player.w, player.h, e.x, e.y, e.w, e.h)) {
            if (player.invul <= 0) {
                lives--;
                player.invul = 60;
                enemies.splice(i, 1);
                if (lives <= 0) gameState = 'GAMEOVER';
                continue;
            }
        }
    }
}

function draw() {
    if (gameState === 'PLAYING') {
        updateGame();
    }
    renderGame();
}

function updateGame() {
    let dx = 0, dy = 0;
    if (keyIsDown(37)) { dx -= 1; player.facing = {dx: -1, dy: 0}; }
    if (keyIsDown(39)) { dx += 1; player.facing = {dx: 1, dy: 0}; }
    if (keyIsDown(38)) { dy -= 1; player.facing = {dx: 0, dy: -1}; }
    if (keyIsDown(40)) { dy += 1; player.facing = {dx: 0, dy: 1}; }
    
    if (dx !== 0 && dy !== 0) {
        let len = Math.sqrt(dx*dx + dy*dy);
        dx /= len;
        dy /= len;
    }
    
    let speed = 3;
    dx *= speed;
    dy *= speed;
    
    player.x += dx;
    if (getCollidingBlocks(player.x, player.y, player.w, player.h).length > 0) {
        if (dx > 0) player.x = Math.floor((player.x + player.w)/32) * 32 - player.w - 0.001;
        else if (dx < 0) player.x = Math.floor(player.x/32) * 32 + 32;
    }
    
    player.y += dy;
    if (getCollidingBlocks(player.x, player.y, player.w, player.h).length > 0) {
        if (dy > 0) player.y = Math.floor((player.y + player.h)/32) * 32 - player.h - 0.001;
        else if (dy < 0) player.y = Math.floor(player.y/32) * 32 + 32;
    }
    
    if (player.mineCooldown > 0) player.mineCooldown--;
    if (player.invul > 0) player.invul--;
    
    let centerCx = Math.floor((player.x + player.w/2) / 32);
    let centerCy = Math.floor((player.y + player.h/2) / 32);
    let targetBx = centerCx + player.facing.dx;
    let targetBy = centerCy + player.facing.dy;
    
    if (keyIsDown(32) && player.mineCooldown <= 0) {
        player.mineCooldown = 15;
        
        let hitEnemy = false;
        let tr = { x: targetBx*32, y: targetBy*32, w: 32, h: 32 };
        for (let i = enemies.length - 1; i >= 0; i--) {
            let e = enemies[i];
            if (rectIntersect(tr.x, tr.y, tr.w, tr.h, e.x, e.y, e.w, e.h)) {
                e.hp--;
                hitEnemy = true;
                if (e.hp <= 0) {
                    enemies.splice(i, 1);
                    score += 2;
                }
            }
        }
        
        if (!hitEnemy) {
            let b = getBlock(targetBx, targetBy);
            if (b !== 0) {
                let key = targetBx + "," + targetBy;
                if (blockHits[key] === undefined) blockHits[key] = getBlockMaxHits(b);
                blockHits[key]--;
                
                if (blockHits[key] <= 0) {
                    overrides[key] = 0;
                    if (b === 3) score += 1;
                    else if (b === 4) score += 5;
                    else if (b === 5) score += 10;
                }
            }
        }
    }
    
    updateEnemies();
    
    if (score >= 100) {
        gameState = 'WIN';
    }
}

function renderGame() {
    background(0);
    
    push();
    translate(Math.floor(width/2 - (player.x + player.w/2)), Math.floor(height/2 - (player.y + player.h/2)));
    
    let startCol = Math.floor((player.x - 250) / 32);
    let endCol = Math.floor((player.x + 250) / 32);
    let startRow = Math.floor((player.y - 250) / 32);
    let endRow = Math.floor((player.y + 250) / 32);

    noStroke();
    for (let c = startCol; c <= endCol; c++) {
        for (let r = startRow; r <= endRow; r++) {
            let b = getBlock(c, r);
            let px = c * 32;
            let py = r * 32;
            
            fill(30, 30, 30);
            rect(px, py, 32, 32);
            
            if (b !== 0) {
                if (b === 1) fill(101, 67, 33);
                else fill(128, 128, 128);
                
                rect(px, py, 32, 32);
                
                if (b === 3) { fill(40); rect(px+8, py+8, 16, 16); }
                else if (b === 4) { fill(255, 215, 0); rect(px+8, py+8, 16, 16); }
                else if (b === 5) { fill(0, 255, 255); rect(px+8, py+8, 16, 16); }
                
                let key = c + "," + r;
                if (blockHits[key] !== undefined) {
                    let maxH = getBlockMaxHits(b);
                    let hp = blockHits[key];
                    if (hp < maxH) {
                        fill(0, 0, 0, 100);
                        rect(px, py, 32, 32);
                        stroke(0);
                        line(px, py, px + 32 * (1 - hp/maxH), py + 32);
                        noStroke();
                    }
                }
            }
        }
    }
    
    let centerCx = Math.floor((player.x + player.w/2) / 32);
    let centerCy = Math.floor((player.y + player.h/2) / 32);
    let targetBx = centerCx + player.facing.dx;
    let targetBy = centerCy + player.facing.dy;
    stroke(255, 255, 255, 150);
    strokeWeight(2);
    noFill();
    rect(targetBx*32, targetBy*32, 32, 32);
    noStroke();
    
    for (let e of enemies) {
        fill(200, 50, 50);
        rect(e.x, e.y, e.w, e.h, 5);
        fill(255);
        rect(e.x + 4, e.y + 4, 4, 4);
        rect(e.x + 12, e.y + 4, 4, 4);
    }
    
    if (player.invul % 10 < 5) {
        fill(50, 150, 255);
        rect(player.x, player.y, player.w, player.h, 4);
        
        fill(255);
        let cx = player.x + player.w/2;
        let cy = player.y + player.h/2;
        ellipse(cx + player.facing.dx * 8, cy + player.facing.dy * 8, 6, 6);
        
        if (player.mineCooldown > 0) {
            push();
            translate(cx, cy);
            rotate(Math.atan2(player.facing.dy, player.facing.dx) + (15 - player.mineCooldown)*0.1);
            stroke(200);
            strokeWeight(2);
            line(0, 0, 16, 0);
            fill(150);
            noStroke();
            rect(14, -6, 6, 12);
            pop();
        }
    }
    
    pop();
    
    fill(255);
    textSize(16);
    textAlign(LEFT, TOP);
    text("Score: " + score + " / 100", 10, 10);
    text("Lives: " + lives, 10, 30);
    
    if (gameState === 'GAMEOVER') {
        fill(255, 0, 0);
        textAlign(CENTER, CENTER);
        textSize(32);
        text("GAME OVER", width/2, height/2);
    } else if (gameState === 'WIN') {
        fill(0, 255, 0);
        textAlign(CENTER, CENTER);
        textSize(32);
        text("YOU WIN!", width/2, height/2);
    }
}