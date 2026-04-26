const {
    setupGame, setBackground, drawCubeV, removeMesh, clearWorld,
    CAMERA_FREE, smoothLerp, updateTransients, spawnParticleBurst,
    getCurrentAction, mulberry32,
    PINK, MAGENTA, PURPLE, VIOLET, BLUE, SKYBLUE, GREEN, LIME, YELLOW, GOLD, ORANGE, RED, GRAY, DARKGRAY, WHITE
} = engine;

let world, camera;
let score = 0, lives = 1, gameState = 'PLAYING';
let blocks = [];
let fallingBlocks = [];
let currentBlock = null;

let level = 0;
let axis = 'x';
let dir = 1;
let speed = 5;
let lastAction = 0;
let camLookY = 0;

const PALETTE = [PINK, MAGENTA, PURPLE, VIOLET, BLUE, SKYBLUE, GREEN, LIME, YELLOW, GOLD, ORANGE, RED];

function setup({ THREE, renderer, width, height }) {
    ({ world, camera } = setupGame({
        THREE, renderer, width, height,
        cameraMode: CAMERA_FREE,
    }));
    setBackground(world, DARKGRAY);

    camera.position.set(8, 8, 8);
    camera.lookAt(0, 0, 0);
}

function spawnNextBlock(topPos, topSize) {
    level++;
    axis = (level % 2 === 1) ? 'x' : 'z';
    
    let startPos = { x: topPos.x, y: level * 0.5, z: topPos.z };
    dir = Math.random() < 0.5 ? 1 : -1;
    startPos[axis] -= dir * 8;
    
    let color = PALETTE[level % PALETTE.length];
    let mesh = drawCubeV(world, [startPos.x, startPos.y, startPos.z], [topSize.x, topSize.y, topSize.z], color);
    
    currentBlock = {
        pos: startPos,
        size: { ...topSize },
        mesh: mesh,
        color: color
    };
    
    speed = 5 + level * 0.15;
}

function spawnSlice(min, max, cur) {
    let size = { ...cur.size };
    size[axis] = max - min;
    let pos = { ...cur.pos };
    pos[axis] = min + size[axis] / 2;
    
    let mesh = drawCubeV(world, [pos.x, pos.y, pos.z], [size.x, size.y, size.z], cur.color);
    
    let isPositiveSide = pos[axis] > cur.pos[axis];
    let rx = 0, rz = 0;
    if (axis === 'x') {
        rz = isPositiveSide ? -2 : 2;
    } else {
        rx = isPositiveSide ? 2 : -2;
    }
    
    fallingBlocks.push({ mesh: mesh, vy: -1, rx, rz });
}

function update(dt) {
    dt = Math.min(dt, 0.1);
    
    let targetLookY = level * 0.5;
    camLookY = smoothLerp(camLookY, targetLookY, dt, 5);
    camera.position.y = camLookY + 8;
    camera.lookAt(0, camLookY, 0);

    const a = getCurrentAction();
    const justPressed = a > 0 && lastAction === 0;
    lastAction = a;

    if (gameState === 'PLAYING') {
        if (currentBlock) {
            currentBlock.pos[axis] += speed * dir * dt;
            let limit = 7;
            if (currentBlock.pos[axis] > limit) {
                currentBlock.pos[axis] = limit;
                dir = -1;
            } else if (currentBlock.pos[axis] < -limit) {
                currentBlock.pos[axis] = -limit;
                dir = 1;
            }
            
            currentBlock.mesh.position.x = currentBlock.pos.x;
            currentBlock.mesh.position.z = currentBlock.pos.z;
            
            if (justPressed) {
                let top = blocks[blocks.length - 1];
                let cur = currentBlock;
                
                let delta = cur.pos[axis] - top.pos[axis];
                let perfect = Math.abs(delta) <= 0.15;
                
                let overlapMin, overlapMax;
                if (perfect) {
                    delta = 0;
                    cur.pos[axis] = top.pos[axis];
                    overlapMin = top.pos[axis] - top.size[axis] / 2;
                    overlapMax = top.pos[axis] + top.size[axis] / 2;
                    
                    spawnParticleBurst(world, cur.mesh.position, WHITE, { count: 12, speed: 3, life: 0.5 });
                } else {
                    overlapMin = Math.max(cur.pos[axis] - cur.size[axis] / 2, top.pos[axis] - top.size[axis] / 2);
                    overlapMax = Math.min(cur.pos[axis] + cur.size[axis] / 2, top.pos[axis] + top.size[axis] / 2);
                }
                
                if (overlapMax <= overlapMin) {
                    gameState = 'GAMEOVER';
                    let isPositiveSide = cur.pos[axis] > top.pos[axis];
                    let rx = 0, rz = 0;
                    if (axis === 'x') {
                        rz = isPositiveSide ? -2 : 2;
                    } else {
                        rx = isPositiveSide ? 2 : -2;
                    }
                    fallingBlocks.push({ mesh: cur.mesh, vy: 2, rx, rz });
                    currentBlock = null;
                } else {
                    let newSize = { ...cur.size };
                    newSize[axis] = overlapMax - overlapMin;
                    
                    let newPos = { ...cur.pos };
                    newPos[axis] = overlapMin + newSize[axis] / 2;
                    
                    if (!perfect) {
                        let curMax = cur.pos[axis] + cur.size[axis] / 2;
                        if (curMax > overlapMax + 0.001) {
                            spawnSlice(overlapMax, curMax, cur);
                        }
                        let curMin = cur.pos[axis] - cur.size[axis] / 2;
                        if (curMin < overlapMin - 0.001) {
                            spawnSlice(curMin, overlapMin, cur);
                        }
                    }
                    
                    removeMesh(world, cur.mesh);
                    let placedMesh = drawCubeV(world, [newPos.x, newPos.y, newPos.z], [newSize.x, newSize.y, newSize.z], cur.color);
                    
                    blocks.push({
                        pos: newPos,
                        size: newSize,
                        mesh: placedMesh,
                        color: cur.color
                    });
                    
                    score += 1;
                    spawnNextBlock(newPos, newSize);
                }
            }
        }
    }
    
    for (let i = fallingBlocks.length - 1; i >= 0; i--) {
        let f = fallingBlocks[i];
        f.vy -= 20 * dt;
        f.mesh.position.y += f.vy * dt;
        if (f.rx) f.mesh.rotation.x += f.rx * dt;
        if (f.rz) f.mesh.rotation.z += f.rz * dt;
        
        if (f.mesh.position.y < -15) {
            removeMesh(world, f.mesh);
            fallingBlocks.splice(i, 1);
        }
    }
    
    updateTransients(world, dt);
}

function render() {
    engine.render(world);
}

function resetGame(seed) {
    Math.random = mulberry32(seed >>> 0);
    score = 0;
    lives = 1;
    gameState = 'PLAYING';
    
    clearWorld(world);
    
    drawCubeV(world, [0, -5.25, 0], [3, 10, 3], GRAY);
    
    blocks = [];
    fallingBlocks = [];
    currentBlock = null;
    level = 0;
    lastAction = 0;
    camLookY = 0;
    
    let baseSize = { x: 3, y: 0.5, z: 3 };
    let basePos = { x: 0, y: 0, z: 0 };
    let baseColor = PALETTE[0];
    let baseMesh = drawCubeV(world, [basePos.x, basePos.y, basePos.z], [baseSize.x, baseSize.y, baseSize.z], baseColor);
    
    blocks.push({
        pos: basePos,
        size: baseSize,
        mesh: baseMesh,
        color: baseColor
    });
    
    spawnNextBlock(basePos, baseSize);
    
    camera.position.set(8, 8, 8);
    camera.lookAt(0, 0, 0);
}

function getGameState() {
    return { score, lives, gameState };
}

globalThis.setup = setup;
globalThis.update = update;
globalThis.render = render;
globalThis.resetGame = resetGame;
globalThis.getGameState = getGameState;