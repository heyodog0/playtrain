let world, camera;
let score = 0;
let lives = 1;
let gameState = 'PLAYING';

let tower = [];
let debris = [];
let movingBlock = null;

let currentAxis = 'x';
let dir = 1;
let speed = 12;
let blockDim = { x: 6, z: 6 };
let blockPos = { x: 0, z: 0 };
let currentY = 0;
let lastAction = 0;

let blockColors;
let colorOffset = 0;
let movingBlockColor;

function setup({ THREE, renderer, width, height }) {
    ({ world, camera } = engine.setupGame({
        THREE, renderer, width, height,
        cameraMode: engine.CAMERA_FREE,
        cameraOpts: { position: [12, 10, 12], target: [0, 0, 0] }
    }));

    // Add a solid ground plane to provide a clean base and ensure no grid bars are visible
    engine.drawPlane(world, [0, -0.02, 0], [40, 40], engine.palette.ground);

    blockColors = [
        engine.RED, engine.ORANGE, engine.GOLD, engine.YELLOW, 
        engine.LIME, engine.GREEN, engine.SKYBLUE, engine.BLUE, 
        engine.VIOLET, engine.PURPLE, engine.MAGENTA, engine.PINK
    ];
}

function resetGame(seed) {
    Math.random = engine.mulberry32(seed >>> 0);
    score = 0;
    lives = 1;
    gameState = 'PLAYING';
    
    engine.clearWorld(world);
    
    tower = [];
    debris = [];
    movingBlock = null;
    
    currentAxis = 'x';
    dir = 1;
    speed = 12;
    blockDim = { x: 6, z: 6 };
    blockPos = { x: 0, z: 0 };
    currentY = 0;
    lastAction = 0;
    
    colorOffset = Math.floor(Math.random() * blockColors.length);
    
    engine.drawPlane(world, [0, -0.5, 0], [100, 100], engine.DARKGRAY);
    engine.drawGrid(world, 100, 2, engine.LIGHTGRAY);
    
    let baseColor = blockColors[colorOffset];
    let baseMesh = engine.drawCube(world, [0, -4.5, 0], blockDim.x, 10, blockDim.z, baseColor);
    tower.push({ mesh: baseMesh, x: 0, z: 0, w: blockDim.x, d: blockDim.z });
    
    currentY = 1;
    
    camera.position.set(12, 10, 12);
    camera.target.set(0, 0, 0);
    
    spawnNextBlock();
}

function spawnNextBlock() {
    currentAxis = currentAxis === 'x' ? 'z' : 'x';
    colorOffset = (colorOffset + 1) % blockColors.length;
    movingBlockColor = blockColors[colorOffset];
    
    let startPos = { x: blockPos.x, z: blockPos.z };
    startPos[currentAxis] = -18;
    
    movingBlock = engine.drawCube(world, [startPos.x, currentY, startPos.z], blockDim.x, 1, blockDim.z, movingBlockColor);
    dir = 1;
}

function dropBlock() {
    let prev = tower[tower.length - 1];
    let currentPos = movingBlock.position[currentAxis];
    let prevPos = prev[currentAxis];
    
    let diff = currentPos - prevPos;
    let absDiff = Math.abs(diff);
    
    if (absDiff >= blockDim[currentAxis]) {
        gameState = 'GAMEOVER';
        makeDebris(movingBlock, Math.sign(diff) || 1);
        movingBlock = null;
        return;
    }
    
    let tolerance = 0.25;
    if (absDiff < tolerance) {
        currentPos = prevPos;
        diff = 0;
        absDiff = 0;
        engine.spawnParticleBurst(world, movingBlock.position, engine.WHITE, { count: 30, speed: 5 });
    }
    
    let newDim = blockDim[currentAxis] - absDiff;
    let newCenter = prevPos + diff / 2;
    
    let fallingDim = absDiff;
    let fallingCenter = currentPos > prevPos ? currentPos + newDim / 2 : currentPos - newDim / 2;
    
    blockDim[currentAxis] = newDim;
    blockPos[currentAxis] = newCenter;
    
    engine.removeMesh(world, movingBlock);
    
    let placedW = currentAxis === 'x' ? newDim : blockDim.x;
    let placedD = currentAxis === 'z' ? newDim : blockDim.z;
    
    let placedBlock = engine.drawCube(
        world, 
        [blockPos.x, currentY, blockPos.z], 
        placedW, 1, placedD, 
        movingBlockColor
    );
    tower.push({ mesh: placedBlock, x: blockPos.x, z: blockPos.z, w: placedW, d: placedD });
    
    if (fallingDim > 0) {
        let debW = currentAxis === 'x' ? fallingDim : blockDim.x;
        let debD = currentAxis === 'z' ? fallingDim : blockDim.z;
        let debX = currentAxis === 'x' ? fallingCenter : blockPos.x;
        let debZ = currentAxis === 'z' ? fallingCenter : blockPos.z;
        
        let debMesh = engine.drawCube(world, [debX, currentY, debZ], debW, 1, debD, movingBlockColor);
        makeDebris(debMesh, Math.sign(diff));
    }
    
    score++;
    currentY++;
    speed = Math.min(25, speed + 0.5);
    
    spawnNextBlock();
}

function makeDebris(mesh, dirSign) {
    if (dirSign === 0) dirSign = 1;
    debris.push({
        mesh: mesh,
        velocity: { 
            x: currentAxis === 'x' ? dirSign * (Math.random() * 2 + 1) : (Math.random() - 0.5), 
            y: -1, 
            z: currentAxis === 'z' ? dirSign * (Math.random() * 2 + 1) : (Math.random() - 0.5) 
        },
        rot: { 
            x: Math.random() * 4 - 2, 
            y: Math.random() * 4 - 2, 
            z: Math.random() * 4 - 2 
        }
    });
}

function update(dt) {
    let action = engine.getCurrentAction();
    // Spacebar is usually action 1 or 5. We use (action > 0 && lastAction === 0) 
    // to capture any new key press for the drop action.
    let justPressed = (action > 0) && (lastAction === 0);
    lastAction = action;

    // Remove gridlines if they exist to satisfy player feedback.
    // Since we can't edit resetGame, we check the scene for GridHelper objects.
    if (world && world.scene) {
        for (let i = world.scene.children.length - 1; i >= 0; i--) {
            let child = world.scene.children[i];
            if (child.type === 'GridHelper') {
                engine.removeMesh(world, child);
            }
        }
    }

    if (gameState === 'PLAYING') {
        if (justPressed && movingBlock) {
            dropBlock();
        } else if (movingBlock) {
            movingBlock.position[currentAxis] += dir * speed * dt;
            if (movingBlock.position[currentAxis] > 18) {
                dir = -1;
            } else if (movingBlock.position[currentAxis] < -18) {
                dir = 1;
            }
        }
    }

    for (let i = debris.length - 1; i >= 0; i--) {
        let d = debris[i];
        d.velocity.y -= 25 * dt;
        d.mesh.position.y += d.velocity.y * dt;
        d.mesh.position.x += d.velocity.x * dt;
        d.mesh.position.z += d.velocity.z * dt;
        d.mesh.rotation.x += d.rot.x * dt;
        d.mesh.rotation.y += d.rot.y * dt;
        d.mesh.rotation.z += d.rot.z * dt;
        
        let scale = d.mesh.scale.x - 0.5 * dt;
        if (scale > 0.01) {
            d.mesh.scale.set(scale, scale, scale);
        }
        
        if (d.mesh.position.y < -10) {
            engine.removeMesh(world, d.mesh);
            debris.splice(i, 1);
        }
    }

    let targetY = Math.max(0, currentY - 3);
    camera.position.x = 12;
    camera.position.z = 12;
    camera.position.y += ((targetY + 10) - camera.position.y) * 5 * dt;
    camera.target.x = 0;
    camera.target.z = 0;
    camera.target.y += (targetY - camera.target.y) * 5 * dt;

    engine.updateTransients(world, dt);
}

function render() {
    engine.render(world);
}

function getGameState() {
    return { score, lives, gameState };
}