let world, camera, player;
let ground, lane1, lane2;
let score = 0, distanceScore = 0, gemScore = 0, lives = 1, gameState = 'PLAYING';
let lane = 1;
let yVel = 0;
let isJumping = false, isSliding = false, slideTimer = 0;
let baseZSpeed = 15;
let nextSpawnZ = -20;
let entities = [];
let prevActionL = false, prevActionR = false;

function setup({ THREE, renderer, width, height }) {
    const res = engine.setupGame({
        THREE, renderer, width, height,
        cameraMode: engine.CAMERA_FREE,
    });
    world = res.world;
    camera = res.camera;
}

function resetGame(seed) {
    Math.random = engine.mulberry32(seed >>> 0);
    engine.clearWorld(world);

    score = 0;
    distanceScore = 0;
    gemScore = 0;
    lives = 1;
    gameState = 'PLAYING';
    lane = 1;
    yVel = 0;
    isJumping = false;
    isSliding = false;
    slideTimer = 0;
    baseZSpeed = 15;
    nextSpawnZ = -20;
    entities = [];
    prevActionL = false;
    prevActionR = false;

    ground = engine.drawCube(world, [0, -0.5, 0], 10, 1, 200, engine.palette.ground);
    lane1 = engine.drawCube(world, [-1, 0.01, 0], 0.05, 0.02, 200, engine.LIGHTGRAY);
    lane2 = engine.drawCube(world, [1, 0.01, 0], 0.05, 0.02, 200, engine.LIGHTGRAY);

    player = engine.drawCube(world, [0, 0.5, 0], 0.8, 1.0, 0.8, engine.BLUE);

    for (let i = 0; i < 15; i++) {
        spawnRow();
    }
}

function spawnRow() {
    let z = nextSpawnZ;
    nextSpawnZ -= 15;

    let r = Math.random();
    let lanes = [-2, 0, 2];

    for (let i = lanes.length - 1; i > 0; i--) {
        let j = Math.floor(Math.random() * (i + 1));
        [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
    }

    if (r < 0.2) {
        spawnObstacle(lanes[0], z, 'full');
        spawnGem(lanes[1], z);
        spawnGem(lanes[2], z);
    } else if (r < 0.4) {
        spawnObstacle(lanes[0], z, 'full');
        spawnObstacle(lanes[1], z, 'full');
        spawnGem(lanes[2], z);
    } else if (r < 0.6) {
        spawnObstacle(lanes[0], z, 'high');
        spawnGem(lanes[1], z);
    } else if (r < 0.8) {
        spawnObstacle(lanes[0], z, 'low');
        spawnGem(lanes[1], z);
    } else {
        spawnGem(lanes[0], z);
        spawnGem(lanes[1], z);
        spawnGem(lanes[2], z);
    }
}

function spawnObstacle(x, z, type) {
    let obs;
    if (type === 'full') {
        obs = engine.drawCube(world, [x, 2.0, z], 1.8, 4.0, 1.0, engine.RED);
        obs.hitbox = { w: 1.8, h: 4.0, d: 1.0 };
    } else if (type === 'high') {
        obs = engine.drawCube(world, [x, 0.85, z], 1.8, 0.5, 1.0, engine.RED);
        obs.hitbox = { w: 1.8, h: 0.5, d: 1.0 };
    } else if (type === 'low') {
        obs = engine.drawCube(world, [x, 0.25, z], 1.8, 0.5, 1.0, engine.RED);
        obs.hitbox = { w: 1.8, h: 0.5, d: 1.0 };
    }
    obs.type = 'obstacle';
    entities.push(obs);
}

function spawnGem(x, z) {
    let gem = engine.drawOctahedron(world, [x, 0.5, z], 0.3, engine.GOLD);
    gem.type = 'gem';
    gem.hitbox = { w: 0.6, h: 0.6, d: 0.6 };
    entities.push(gem);
}

function update(dt) {
    if (gameState !== 'PLAYING') return;

    let action = engine.getCurrentAction();
    let actionL = action === 1;
    let actionR = action === 2;
    let actionU = action === 3;
    let actionD = action === 4;

    if (actionL && !prevActionL) if (lane > 0) lane--;
    if (actionR && !prevActionR) if (lane < 2) lane++;
    if (actionU && !isJumping && !isSliding) {
        isJumping = true;
        yVel = 12;
    }
    if (actionD && !isSliding) {
        isSliding = true;
        slideTimer = 0.8;
        if (isJumping) yVel -= 15;
    }

    prevActionL = actionL;
    prevActionR = actionR;

    let targetX = (lane - 1) * 2;
    player.position.x += (targetX - player.position.x) * 15 * dt;

    let playerHeight = isSliding ? 0.4 : 1.0;

    if (isJumping) {
        yVel -= 35 * dt;
        player.position.y += yVel * dt;
        let groundY = playerHeight / 2;
        if (player.position.y <= groundY) {
            player.position.y = groundY;
            isJumping = false;
            yVel = 0;
        }
    } else {
        player.position.y = playerHeight / 2;
    }
    player.scale.y = playerHeight;

    if (isSliding) {
        slideTimer -= dt;
        if (slideTimer <= 0) {
            isSliding = false;
            playerHeight = 1.0;
            if (!isJumping) player.position.y = playerHeight / 2;
            player.scale.y = playerHeight;
        }
    }

    baseZSpeed += 0.2 * dt;
    player.position.z -= baseZSpeed * dt;

    distanceScore += baseZSpeed * dt * 0.1;
    score = Math.floor(distanceScore) + gemScore;

    if (player.position.z - 60 < nextSpawnZ) {
        spawnRow();
    }

    ground.position.z = player.position.z;
    lane1.position.z = player.position.z;
    lane2.position.z = player.position.z;

    camera.position.x = engine.lerp(camera.position.x, player.position.x * 0.3, 10 * dt);
    camera.position.y = 4.0;
    camera.position.z = player.position.z + 6;
    camera.lookAt(player.position.x * 0.1, 1.0, player.position.z - 10);

    let pBox = {
        x: player.position.x,
        y: player.position.y,
        z: player.position.z,
        width: 0.8,
        height: playerHeight,
        depth: 0.8
    };

    for (let i = entities.length - 1; i >= 0; i--) {
        let ent = entities[i];

        if (ent.type === 'gem') {
            ent.rotation.y += 3 * dt;
        }

        let eBox = {
            x: ent.position.x,
            y: ent.position.y,
            z: ent.position.z,
            width: ent.hitbox.w,
            height: ent.hitbox.h,
            depth: ent.hitbox.d
        };

        if (engine.checkCollisionBoxes(pBox, eBox)) {
            if (ent.type === 'gem') {
                gemScore += 10;
                score = Math.floor(distanceScore) + gemScore;
                engine.spawnParticleBurst(world, ent.position, engine.GOLD);
                engine.removeMesh(world, ent);
                entities.splice(i, 1);
                continue;
            } else if (ent.type === 'obstacle') {
                engine.spawnParticleBurst(world, player.position, engine.RED);
                lives = 0;
                gameState = 'GAMEOVER';
            }
        }

        if (ent.position.z > player.position.z + 5) {
            engine.removeMesh(world, ent);
            entities.splice(i, 1);
        }
    }

    engine.updateTransients(world, dt);
}

function render() {
    engine.render(world);
}

function getGameState() {
    return { score, lives, gameState };
}