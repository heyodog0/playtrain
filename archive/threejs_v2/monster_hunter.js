const engine = globalThis.engine;
const {
    setupGame, drawSphere, drawCube, drawOctahedron, drawPlane, drawGrid, drawCylinder,
    CAMERA_THIRD_PERSON, palette, BLUE, GOLD, DARKGRAY, LIGHTGRAY, RED, GREEN, YELLOW, GRAY, MAGENTA, BLACK, WHITE,
    checkCollisionSpheres, mulberry32, getCurrentAction, updateCamera, spawnParticleBurst, flashFor, tickFlashes, updateTransients
} = engine;

let THREE;
let world, camera;
let player, playerWeapon;
let monsterParts = {};
let monsterProjectiles = [];
let rocks = [];
let flashMeshes = [];

let pBarBG, pBarFG, sBarBG, sBarFG, mBarBG, mBarFG;

let score = 0, lives = 1, gameState = 'PLAYING';
let frameCount = 0;
const ARENA_RADIUS = 25;

let camTarget = { position: null };

let pState = {
    hp: 100, stamina: 100, state: 'IDLE', timer: 0,
    dodgeDir: null, combo: 0, invincible: false,
    attackCooldown: 0, hitLanded: false, iFrameTimer: 0
};

let mState = {
    pos: null, dir: null, hp: 100, stage: 1, state: 'IDLE', timer: 0,
    cooldown: 2.0, actionData: null
};

function setup(args) {
    THREE = args.THREE;
    const setupData = setupGame({
        THREE: args.THREE,
        renderer: args.renderer,
        width: args.width,
        height: args.height,
        cameraMode: CAMERA_THIRD_PERSON,
        cameraOpts: { position: [0, 15, 25], target: [0, 0, 0] },
    });
    world = setupData.world;
    camera = setupData.camera;
    
    camTarget.position = new THREE.Vector3();

    // Environment
    drawPlane(world, [0, 0, 0], [60, 60], palette.ground);
    drawGrid(world, 60, 2, DARKGRAY);
    for (let i = 0; i < 36; i++) {
        let angle = (i / 36) * Math.PI * 2;
        let x = Math.cos(angle) * ARENA_RADIUS;
        let z = Math.sin(angle) * ARENA_RADIUS;
        drawCylinder(world, [x, 1, z], 0.5, 0.5, 2, 8, palette.wall);
    }
    for (let i = 0; i < 15; i++) {
        rocks.push(drawOctahedron(world, [0, 0, 0], 1, DARKGRAY));
    }

    // Player
    player = drawSphere(world, [0, 0.5, 10], 0.4, BLUE);
    playerWeapon = drawCube(world, [0, 0, 0], 1, 1, 1, WHITE);
    
    pState.dodgeDir = new THREE.Vector3(0, 0, -1);
    flashMeshes.push(player);

    // Boss Parts
    mState.pos = new THREE.Vector3(0, 0, -5);
    mState.dir = new THREE.Vector3(0, 0, 1);
    
    monsterParts.coreG = drawOctahedron(world, [0, 0, 0], 2.0, GREEN);
    monsterParts.coreY = drawOctahedron(world, [0, 0, 0], 2.0, YELLOW);
    monsterParts.coreR = drawOctahedron(world, [0, 0, 0], 2.0, RED);
    monsterParts.body1 = drawCube(world, [0, 0, 0], 2.5, 2.5, 2.5, DARKGRAY);
    monsterParts.body2 = drawCube(world, [0, 0, 0], 2.0, 2.0, 2.0, DARKGRAY);
    monsterParts.head  = drawCube(world, [0, 0, 0], 1.5, 1.5, 2.5, GRAY);
    monsterParts.tail  = drawCube(world, [0, 0, 0], 1.2, 1.2, 3.5, GRAY);

    flashMeshes.push(monsterParts.coreG, monsterParts.coreY, monsterParts.coreR);
    flashMeshes.push(monsterParts.body1, monsterParts.body2, monsterParts.head, monsterParts.tail);

    // UI Bars
    pBarBG = drawCube(world, [0,0,0], 2.2, 0.3, 0.1, BLACK);
    pBarFG = drawCube(world, [0,0,0], 2.0, 0.2, 0.1, GREEN);
    sBarBG = drawCube(world, [0,0,0], 2.2, 0.2, 0.1, BLACK);
    sBarFG = drawCube(world, [0,0,0], 2.0, 0.15, 0.1, YELLOW);
    mBarBG = drawCube(world, [0,0,0], 6.2, 0.6, 0.1, BLACK);
    mBarFG = drawCube(world, [0,0,0], 6.0, 0.5, 0.1, RED);
}

function resetGame(seed) {
    Math.random = mulberry32(seed >>> 0);
    score = 0;
    lives = 1;
    gameState = 'PLAYING';
    frameCount = 0;

    rocks.forEach(r => {
        let angle = Math.random() * Math.PI * 2;
        let dist = 8 + Math.random() * (ARENA_RADIUS - 9);
        r.position.set(Math.cos(angle) * dist, Math.random() * 0.5, Math.sin(angle) * dist);
        let s = 0.5 + Math.random() * 2.0;
        r.scale.set(s, s, s);
        r.rotation.set(Math.random(), Math.random(), Math.random());
    });

    player.position.set(0, 0.5, 15);
    pState = {
        hp: 100, stamina: 100, state: 'IDLE', timer: 0,
        dodgeDir: new THREE.Vector3(0, 0, -1), combo: 0, invincible: false,
        attackCooldown: 0, hitLanded: false, iFrameTimer: 0
    };
    playerWeapon.scale.set(0.01, 0.01, 0.01);

    mState = {
        pos: new THREE.Vector3(0, 0, -5),
        dir: new THREE.Vector3(0, 0, 1),
        hp: 100, stage: 1, state: 'IDLE', timer: 0,
        cooldown: 2.0 + Math.random(), actionData: null
    };

    monsterProjectiles.forEach(p => engine.removeMesh(world, p.mesh));
    monsterProjectiles = [];
}

function update(dt) {
    if (gameState !== 'PLAYING') return;
    frameCount++;

    const a = getCurrentAction();
    const up = [1, 5, 6, 11].includes(a);
    const down = [2, 7, 8, 12].includes(a);
    const left = [3, 5, 7, 13].includes(a);
    const right = [4, 6, 8, 14].includes(a);
    const btnA = [9, 11, 12, 13, 14].includes(a);
    const btnB = (a === 10);

    const camForward = new THREE.Vector3();
    camera.getWorldDirection(camForward);
    camForward.y = 0;
    if (camForward.lengthSq() < 0.01) camForward.set(0, 0, -1);
    else camForward.normalize();
    const camRight = new THREE.Vector3().crossVectors(camForward, new THREE.Vector3(0, 1, 0)).normalize();

    let moveVec = new THREE.Vector3();
    if (up) moveVec.add(camForward);
    if (down) moveVec.sub(camForward);
    if (left) moveVec.sub(camRight);
    if (right) moveVec.add(camRight);
    if (moveVec.lengthSq() > 0) moveVec.normalize();

    // Player State Update
    if (pState.attackCooldown > 0) pState.attackCooldown -= dt;
    if (pState.iFrameTimer > 0) pState.iFrameTimer -= dt;

    pState.invincible = (pState.iFrameTimer > 0 || pState.state === 'DODGE');
    player.visible = !(pState.iFrameTimer > 0 && Math.floor(pState.iFrameTimer * 15) % 2 === 0);

    if (pState.state === 'IDLE' || pState.state === 'RUN') {
        pState.stamina = Math.min(100, pState.stamina + 25 * dt); // Regen
        
        if (btnB && pState.stamina >= 30) {
            pState.stamina -= 30;
            pState.state = 'DODGE';
            pState.timer = 0.5;
            if (moveVec.lengthSq() > 0) pState.dodgeDir.copy(moveVec);
        } else if (btnA && pState.stamina >= 15 && pState.attackCooldown <= 0) {
            pState.stamina -= 15;
            pState.state = 'ATTACK';
            pState.timer = 0.35;
            pState.attackCooldown = 0.45;
            pState.hitLanded = false;
            pState.combo = (pState.combo + 1) % 2;
        } else if (moveVec.lengthSq() > 0) {
            pState.state = 'RUN';
            player.position.addScaledVector(moveVec, 12 * dt);
            pState.dodgeDir.copy(moveVec);
        } else {
            pState.state = 'IDLE';
        }
    }

    // Process Actions
    if (pState.state === 'DODGE') {
        player.position.addScaledVector(pState.dodgeDir, 18 * dt);
        player.scale.set(1, 0.4, 1);
        pState.timer -= dt;
        if (pState.timer <= 0) {
            pState.state = 'IDLE';
            player.scale.set(1, 1, 1);
        }
    } else if (pState.state === 'ATTACK') {
        player.scale.set(1, 1, 1);
        if (moveVec.lengthSq() > 0) {
            player.position.addScaledVector(moveVec, 5 * dt);
        }
        
        pState.timer -= dt;
        let progress = 1.0 - (pState.timer / 0.35);
        let angle = pState.combo === 0 ? Math.PI/1.5 - progress * Math.PI*1.2 : -Math.PI/1.5 + progress * Math.PI*1.2;
        
        let forward = pState.dodgeDir.clone().normalize();
        let rightVec = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0,1,0)).normalize();
        let offset = forward.clone().multiplyScalar(1.2).add(rightVec.clone().multiplyScalar(Math.cos(angle)*1.5)).add(new THREE.Vector3(0, 0.5, 0));
        
        playerWeapon.position.copy(player.position).add(offset);
        playerWeapon.lookAt(player.position.clone().add(forward).add(new THREE.Vector3(0,0.5,0)));
        playerWeapon.scale.set(0.3, 0.1, 3.5);

        if (!pState.hitLanded && checkCollisionSpheres(playerWeapon.position, 2.0, mState.pos, 4.0)) {
            damageMonster(10);
            pState.hitLanded = true;
        }

        // Combo window detection
        if (btnA && pState.timer < 0.1 && pState.stamina >= 15) {
            pState.stamina -= 15;
            pState.timer = 0.35;
            pState.attackCooldown = 0.45;
            pState.hitLanded = false;
            pState.combo = (pState.combo + 1) % 2;
        }

        if (pState.timer <= 0) {
            pState.state = 'IDLE';
            playerWeapon.scale.set(0.01, 0.01, 0.01);
        }
    } else {
        player.scale.set(1, 1, 1);
        playerWeapon.scale.set(0.01, 0.01, 0.01);
    }

    if (player.position.lengthSq() > ARENA_RADIUS * ARENA_RADIUS) {
        player.position.normalize().multiplyScalar(ARENA_RADIUS);
    }

    // Monster Logic
    let s1 = mState.hp > 66;
    let s2 = mState.hp > 33 && mState.hp <= 66;
    let s3 = mState.hp <= 33;
    mState.stage = s1 ? 1 : (s2 ? 2 : 3);
    
    monsterParts.coreG.visible = s1;
    monsterParts.coreY.visible = s2;
    monsterParts.coreR.visible = s3;

    if (mState.cooldown > 0) {
        mState.cooldown -= dt;
        let toP = player.position.clone().sub(mState.pos);
        toP.y = 0;
        if (toP.lengthSq() > 0.1) {
            let rotSpeed = mState.stage === 1 ? 2 : (mState.stage === 2 ? 3 : 5);
            mState.dir.lerp(toP.normalize(), dt * rotSpeed).normalize();
        }
    } else if (mState.state === 'IDLE') {
        let r = Math.random();
        if (r < 0.4) {
            mState.state = 'LUNGE';
            mState.timer = 1.0;
            mState.actionData = mState.dir.clone();
        } else if (r < 0.7) {
            mState.state = 'SWEEP';
            mState.timer = 1.5;
        } else {
            mState.state = 'SPIT';
            mState.timer = 0.5;
        }
    }

    if (mState.state === 'LUNGE') {
        mState.timer -= dt;
        let speed = (4 - mState.stage) * -5 + 30; // 15, 20, 25
        mState.pos.addScaledVector(mState.actionData, speed * dt);
        if (!pState.invincible && checkCollisionSpheres(mState.pos, 3.5, player.position, 0.5)) {
            damagePlayer(20);
        }
        if (mState.timer <= 0) endMonsterAction();
    } else if (mState.state === 'SWEEP') {
        mState.timer -= dt;
        let spinSpeed = (2.0 - mState.timer) * 12; 
        mState.dir.applyAxisAngle(new THREE.Vector3(0,1,0), spinSpeed * dt);
        if (!pState.invincible && checkCollisionSpheres(mState.pos, 6.5, player.position, 0.5)) {
            damagePlayer(15);
        }
        if (mState.timer <= 0) endMonsterAction();
    } else if (mState.state === 'SPIT') {
        mState.timer -= dt;
        if (mState.timer <= 0) {
            let toP = player.position.clone().sub(mState.pos);
            toP.y = 0;
            if (toP.lengthSq() > 0.01) toP.normalize();
            else toP = mState.dir.clone();
            
            let projMesh = drawSphere(world, mState.pos.clone().setY(2.5).addScaledVector(toP, 3), 0.8, MAGENTA);
            monsterProjectiles.push({ mesh: projMesh, dir: toP, speed: 25 + mState.stage*5, life: 3.0 });
            endMonsterAction();
        }
    }

    if (mState.pos.lengthSq() > (ARENA_RADIUS - 2) * (ARENA_RADIUS - 2)) {
        mState.pos.normalize().multiplyScalar(ARENA_RADIUS - 2);
    }

    function endMonsterAction() {
        mState.state = 'IDLE';
        mState.cooldown = mState.stage === 1 ? 2.5 : (mState.stage === 2 ? 1.5 : 0.8);
    }

    // Update Monster Parts Visuals
    let t = frameCount * 0.05;
    let bob = Math.sin(t) * 0.2;
    let coreY = 2.5 + bob;
    
    monsterParts.coreG.position.copy(mState.pos).setY(coreY);
    monsterParts.coreY.position.copy(mState.pos).setY(coreY);
    monsterParts.coreR.position.copy(mState.pos).setY(coreY);

    monsterParts.coreG.rotation.y += dt * 2;
    monsterParts.coreY.rotation.y += dt * 4;
    monsterParts.coreR.rotation.y += dt * 8;

    let backDir = mState.dir.clone().negate();
    monsterParts.body1.position.copy(mState.pos).addScaledVector(backDir, 1.8).setY(2.0 + bob * 0.8);
    monsterParts.body1.rotation.y = Math.atan2(mState.dir.x, mState.dir.z);

    monsterParts.body2.position.copy(mState.pos).addScaledVector(backDir, 3.5).setY(1.5 + bob * 0.5);
    monsterParts.body2.rotation.y = Math.atan2(mState.dir.x, mState.dir.z);

    monsterParts.tail.position.copy(mState.pos).addScaledVector(backDir, 5.5).setY(1.0 + bob * 0.2);
    monsterParts.tail.rotation.y = Math.atan2(mState.dir.x, mState.dir.z) + Math.sin(t * (mState.state==='SWEEP'?3:1)) * 0.5;

    monsterParts.head.position.copy(mState.pos).addScaledVector(mState.dir, 2.0).setY(2.5 + bob * 1.2);
    monsterParts.head.rotation.y = Math.atan2(mState.dir.x, mState.dir.z) + Math.sin(t*2)*0.1;

    // Projectiles
    for (let i = monsterProjectiles.length - 1; i >= 0; i--) {
        let p = monsterProjectiles[i];
        p.mesh.position.addScaledVector(p.dir, p.speed * dt);
        p.life -= dt;
        if (!pState.invincible && checkCollisionSpheres(p.mesh.position, 0.8, player.position, 0.5)) {
            damagePlayer(15);
            p.life = 0;
        }
        if (p.life <= 0) {
            engine.removeMesh(world, p.mesh);
            monsterProjectiles.splice(i, 1);
        }
    }

    // Camera
    camTarget.position.lerpVectors(player.position, mState.pos, 0.35);
    updateCamera(camera, camTarget, dt, { distance: 22, height: 12, smoothing: 8 });

    // UI Updates
    updateUIBar(pBarBG, pBarFG, player.position.clone().add(new THREE.Vector3(0, 2.2, 0)), pState.hp/100, 1.0);
    updateUIBar(sBarBG, sBarFG, player.position.clone().add(new THREE.Vector3(0, 1.8, 0)), pState.stamina/100, 1.0);
    updateUIBar(mBarBG, mBarFG, mState.pos.clone().add(new THREE.Vector3(0, 5.0, 0)), Math.max(0, mState.hp/100), 1.0);

    tickFlashes(world, flashMeshes);
    updateTransients(world, dt);

    if (mState.hp <= 0) {
        score += 1000;
        gameState = 'WIN';
    } else if (pState.hp <= 0) {
        gameState = 'GAMEOVER';
        lives = 0;
    }
}

function updateUIBar(bg, fg, pos, pct, scaleMax) {
    let toCam = camera.position.clone().sub(pos).normalize();
    bg.position.copy(pos).addScaledVector(toCam, 0.05);
    fg.position.copy(pos).addScaledVector(toCam, 0.1);
    
    bg.lookAt(camera.position);
    fg.lookAt(camera.position);
    
    fg.scale.set(Math.max(0.01, pct), 1, 1);
}

function damageMonster(amount) {
    mState.hp -= amount;
    score += amount;
    spawnParticleBurst(world, mState.pos, mState.stage === 1 ? GREEN : (mState.stage === 2 ? YELLOW : RED));
    flashFor(monsterParts.coreG, WHITE, 4);
    flashFor(monsterParts.coreY, WHITE, 4);
    flashFor(monsterParts.coreR, WHITE, 4);
    flashFor(monsterParts.head, WHITE, 4);
    flashFor(monsterParts.body1, WHITE, 4);
    flashFor(monsterParts.tail, WHITE, 4);
}

function damagePlayer(amount) {
    pState.hp -= amount;
    pState.iFrameTimer = 1.0;
    spawnParticleBurst(world, player.position, RED);
    flashFor(player, RED, 8);
}

function render() {
    engine.render(world, camera);
}

function getGameState() {
    return { score, lives, gameState };
}

window.setup = setup;
window.update = update;
window.resetGame = resetGame;
window.render = render;
window.getGameState = getGameState;