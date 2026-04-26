const {
    setupGame,
    drawSphere,
    drawCube,
    drawPlane,
    CAMERA_FREE,
    palette,
    mulberry32,
    getCurrentAction,
    checkCollisionBoxes,
    clearWorld,
    THREE
} = engine;

let world, camera, player;
let score = 0;
let lives = 1;
let gameState = 'PLAYING';
let speed = 15;

// Player state
let playerDir;
let velY = 0;
let slideTimer = 0;
const JUMP_VEL = 12;
const GRAVITY = 35;
const PLAYER_RADIUS = 0.4;
const PATH_WIDTH = 4;

// World state
let chunks = [];
let headPos;
let headDir;
let turnCooldown = 0;

function setup({ THREE: ThreeJS, renderer, width, height }) {
    ({ world, camera } = setupGame({
        THREE: ThreeJS,
        renderer,
        width,
        height,
        cameraMode: CAMERA_FREE,
    }));
    
    // Light ambient to match flat palette runner style
    world.scene.background = new ThreeJS.Color(palette.sky);
}

function spawnChunk() {
    const chunk = {
        meshes: [],
        bounds: [],
        obstacles: [],
        junctions: []
    };

    const length = 30 + Math.floor(Math.random() * 30);
    const start = headPos.clone();
    const end = headPos.clone().add(headDir.clone().multiplyScalar(length));

    // Calculate center and size for the path segment
    const center = start.clone().lerp(end, 0.5);
    const sizeX = headDir.x === 0 ? PATH_WIDTH : length + PATH_WIDTH;
    const sizeZ = headDir.z === 0 ? PATH_WIDTH : length + PATH_WIDTH;

    // Floor Mesh
    const floor = drawCube(world, center.clone().setY(0), sizeX, 1, sizeZ, palette.ground);
    chunk.meshes.push(floor);

    // Floor Bounds (expanded slightly to allow cornering leeway)
    chunk.bounds.push({
        minX: Math.min(start.x, end.x) - PATH_WIDTH / 2 - 1,
        maxX: Math.max(start.x, end.x) + PATH_WIDTH / 2 + 1,
        minZ: Math.min(start.z, end.z) - PATH_WIDTH / 2 - 1,
        maxZ: Math.max(start.z, end.z) + PATH_WIDTH / 2 + 1,
    });

    // Obstacles along the path (skip near start/end)
    for (let d = 15; d < length - 10; d += 15 + Math.random() * 10) {
        const obsPos = start.clone().add(headDir.clone().multiplyScalar(d));
        const isHigh = Math.random() > 0.5;
        
        let oSizeX = headDir.x === 0 ? PATH_WIDTH : 1;
        let oSizeZ = headDir.z === 0 ? PATH_WIDTH : 1;
        
        if (isHigh) {
            // High Beam (Slide under) - Y from 0.8 to 2.0
            const mesh = drawCube(world, obsPos.clone().setY(1.4), oSizeX, 1.2, oSizeZ, palette.hostile);
            chunk.meshes.push(mesh);
            chunk.obstacles.push({
                min: { x: obsPos.x - oSizeX/2, y: 0.8, z: obsPos.z - oSizeZ/2 },
                max: { x: obsPos.x + oSizeX/2, y: 2.0, z: obsPos.z + oSizeZ/2 }
            });
        } else {
            // Low Hurdle (Jump over) - Y from 0.5 to 1.3
            const mesh = drawCube(world, obsPos.clone().setY(0.9), oSizeX, 0.8, oSizeZ, palette.hazard);
            chunk.meshes.push(mesh);
            chunk.obstacles.push({
                min: { x: obsPos.x - oSizeX/2, y: 0.5, z: obsPos.z - oSizeZ/2 },
                max: { x: obsPos.x + oSizeX/2, y: 1.3, z: obsPos.z + oSizeZ/2 }
            });
        }
    }

    // Junction setup
    const junctionPos = end.clone();
    chunk.junctions.push({ pos: junctionPos, active: true });
    
    // Visual turn indicator
    const marker = drawPlane(world, junctionPos.clone().setY(0.51), [PATH_WIDTH-1, PATH_WIDTH-1], palette.safe);
    chunk.meshes.push(marker);
    
    // Pick next direction (ensure 90 degree turn)
    const turn = Math.random() < 0.5 ? 1 : -1;
    const newDir = new THREE.Vector3(headDir.z * turn, 0, -headDir.x * turn);

    headPos.copy(junctionPos);
    headDir.copy(newDir);

    chunks.push(chunk);

    // Dynamic unloading
    if (chunks.length > 6) {
        const oldChunk = chunks.shift();
        oldChunk.meshes.forEach(m => engine.removeMesh(world, m));
    }
}

function resetGame(seed) {
    Math.random = mulberry32(seed >>> 0);
    clearWorld(world);
    
    score = 0;
    lives = 1;
    gameState = 'PLAYING';
    speed = 15;
    chunks = [];
    turnCooldown = 0;

    headPos = new THREE.Vector3(0, 0, 0);
    headDir = new THREE.Vector3(0, 0, -1);

    playerDir = new THREE.Vector3(0, 0, -1);
    velY = 0;
    slideTimer = 0;

    player = drawSphere(world, new THREE.Vector3(0, 0.9, 0), PLAYER_RADIUS, palette.player);
    
    // Pre-warm track
    for (let i = 0; i < 4; i++) spawnChunk();
}

function update(dt) {
    if (gameState !== 'PLAYING') return;

    const action = getCurrentAction();
    if (turnCooldown > 0) turnCooldown -= dt;

    // Actions
    if (action === 1 && player.position.y <= 0.91 && velY <= 0) {
        velY = JUMP_VEL; // UP -> Jump
    } else if (action === 2 && player.position.y <= 0.91 && slideTimer <= 0) {
        slideTimer = 0.8; // DOWN -> Slide
    }

    // Handling Turn (LEFT = 3, RIGHT = 4)
    if ((action === 3 || action === 4) && turnCooldown <= 0) {
        let bestJunction = null;
        let minDist = 4.0;

        for (const chunk of chunks) {
            for (const j of chunk.junctions) {
                if (!j.active) continue;
                const d = player.position.distanceTo(j.pos);
                if (d < minDist) {
                    minDist = d;
                    bestJunction = j;
                }
            }
        }

        if (bestJunction) {
            bestJunction.active = false;
            turnCooldown = 0.5;

            if (action === 3) {
                playerDir.set(playerDir.z, 0, -playerDir.x); // Left
            } else {
                playerDir.set(-playerDir.z, 0, playerDir.x); // Right
            }

            // Snap to junction axis
            if (Math.abs(playerDir.x) > 0.5) player.position.z = bestJunction.pos.z;
            if (Math.abs(playerDir.z) > 0.5) player.position.x = bestJunction.pos.x;
        }
    }

    // Slide state visual update
    const scaleY = slideTimer > 0 ? 0.4 : 1.0;
    player.scale.set(1, scaleY, 1);
    if (slideTimer > 0) slideTimer -= dt;

    // Movement
    player.position.add(playerDir.clone().multiplyScalar(speed * dt));
    score += speed * dt * 0.1;
    speed = Math.min(30, 15 + score * 0.05);

    // Gravity & Ground Check
    let overPath = false;
    for (const chunk of chunks) {
        for (const b of chunk.bounds) {
            if (player.position.x >= b.minX && player.position.x <= b.maxX &&
                player.position.z >= b.minZ && player.position.z <= b.maxZ) {
                overPath = true; break;
            }
        }
        if (overPath) break;
    }

    player.position.y += velY * dt;
    velY -= GRAVITY * dt;

    if (overPath) {
        if (player.position.y <= 0.9 && velY <= 0) {
            player.position.y = 0.9;
            velY = 0;
        }
    } else {
        // Fall off edge
        if (player.position.y < -3) {
            gameState = 'GAMEOVER';
            lives = 0;
        }
    }

    // Obstacle Collisions
    const py = player.position.y;
    const playerBox = {
        min: { x: player.position.x - 0.3, y: py - PLAYER_RADIUS * scaleY, z: player.position.z - 0.3 },
        max: { x: player.position.x + 0.3, y: py + PLAYER_RADIUS * scaleY, z: player.position.z + 0.3 }
    };

    for (const chunk of chunks) {
        for (const obs of chunk.obstacles) {
            if (checkCollisionBoxes(playerBox, obs)) {
                gameState = 'GAMEOVER';
                lives = 0;
            }
        }
    }

    // Spawn new track when nearing end
    if (player.position.distanceTo(headPos) < 100) {
        spawnChunk();
    }

    // Custom 3rd Person Snap Camera
    const camOffset = playerDir.clone().multiplyScalar(-8).add(new THREE.Vector3(0, 5, 0));
    const targetPos = player.position.clone().add(camOffset);
    camera.position.lerp(targetPos, 8 * dt);
    
    const lookTarget = player.position.clone().add(playerDir.clone().multiplyScalar(4));
    camera.lookAt(lookTarget);
}

function render() {
    engine.render(world, camera);
}

function getGameState() {
    return { score: Math.floor(score), lives, gameState };
}