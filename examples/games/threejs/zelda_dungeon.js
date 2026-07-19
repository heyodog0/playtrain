let player, sword, enemy, switchMesh, door, goal;
let walls = [];
let score = 0, lives = 1, gameState = 'PLAYING', frame = 0;
let doorOpen = false, enemyAlive = true;
let playerFacing = { x: 0, z: 1 };
let swordTimer = 0;
let enemyPatrol = { startX: 0, startZ: 0, axis: 'x' };

function setup({ THREE, renderer, width, height }) {
    globalThis.scene = new THREE.Scene();
    globalThis.scene.background = new THREE.Color(0x1a1a24);
    
    globalThis.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);
    globalThis.camera.position.set(0, 22, 12);
    globalThis.camera.lookAt(0, 0, 0);

    globalThis.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const dl = new THREE.DirectionalLight(0xffffff, 0.8);
    dl.position.set(5, 20, 10);
    globalThis.scene.add(dl);

    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(20, 20),
        new THREE.MeshLambertMaterial({ color: 0x444455 })
    );
    floor.rotation.x = -Math.PI / 2;
    globalThis.scene.add(floor);

    const boxBase = new THREE.BoxGeometry(1, 1, 1);

    player = new THREE.Mesh(boxBase, new THREE.MeshLambertMaterial({ color: 0x22cc44 }));
    globalThis.scene.add(player);

    sword = new THREE.Mesh(boxBase, new THREE.MeshLambertMaterial({ color: 0xeeeeee }));
    globalThis.scene.add(sword);
    sword.visible = false;

    enemy = new THREE.Mesh(boxBase, new THREE.MeshLambertMaterial({ color: 0xcc2222 }));
    globalThis.scene.add(enemy);

    switchMesh = new THREE.Mesh(boxBase, new THREE.MeshLambertMaterial({ color: 0xffaa00 }));
    switchMesh.scale.set(1.2, 0.2, 1.2);
    globalThis.scene.add(switchMesh);

    door = new THREE.Mesh(boxBase, new THREE.MeshLambertMaterial({ color: 0x885533 }));
    globalThis.scene.add(door);

    goal = new THREE.Mesh(boxBase, new THREE.MeshLambertMaterial({ color: 0xffff00 }));
    globalThis.scene.add(goal);

    for (let i = 0; i < 5; i++) {
        let w = new THREE.Mesh(boxBase, new THREE.MeshLambertMaterial({ color: 0x333333 }));
        walls.push(w);
        globalThis.scene.add(w);
    }
}

function resetGame(seed) {
    Math.random = mulberry32(seed >>> 0);
    score = 0;
    lives = 1;
    gameState = 'PLAYING';
    frame = 0;
    doorOpen = false;
    enemyAlive = true;
    swordTimer = 0;
    playerFacing = { x: 0, z: 1 };

    player.position.set(0, 0.5, 0);
    sword.visible = false;
    
    enemy.visible = true;
    switchMesh.position.y = 0.1;
    switchMesh.material.color.setHex(0xffaa00);
    door.position.y = 1;

    const sides = ['N', 'S', 'E', 'W'];
    const doorSide = sides[Math.floor(Math.random() * 4)];
    let wallConfigs = [];
    
    if (doorSide === 'N') {
        wallConfigs = [
            {s:[8,2,2], p:[-6,1,-10]}, {s:[8,2,2], p:[6,1,-10]},
            {s:[20,2,2], p:[0,1,10]}, {s:[2,2,20], p:[10,1,0]}, {s:[2,2,20], p:[-10,1,0]}
        ];
        door.scale.set(4, 2, 2); door.position.set(0, 1, -10);
        goal.scale.set(4, 0.1, 4); goal.position.set(0, 0.05, -12);
    } else if (doorSide === 'S') {
        wallConfigs = [
            {s:[8,2,2], p:[-6,1,10]}, {s:[8,2,2], p:[6,1,10]},
            {s:[20,2,2], p:[0,1,-10]}, {s:[2,2,20], p:[10,1,0]}, {s:[2,2,20], p:[-10,1,0]}
        ];
        door.scale.set(4, 2, 2); door.position.set(0, 1, 10);
        goal.scale.set(4, 0.1, 4); goal.position.set(0, 0.05, 12);
    } else if (doorSide === 'E') {
        wallConfigs = [
            {s:[2,2,8], p:[10,1,-6]}, {s:[2,2,8], p:[10,1,6]},
            {s:[2,2,20], p:[-10,1,0]}, {s:[20,2,2], p:[0,1,-10]}, {s:[20,2,2], p:[0,1,10]}
        ];
        door.scale.set(2, 2, 4); door.position.set(10, 1, 0);
        goal.scale.set(4, 0.1, 4); goal.position.set(12, 0.05, 0);
    } else if (doorSide === 'W') {
        wallConfigs = [
            {s:[2,2,8], p:[-10,1,-6]}, {s:[2,2,8], p:[-10,1,6]},
            {s:[2,2,20], p:[10,1,0]}, {s:[20,2,2], p:[0,1,-10]}, {s:[20,2,2], p:[0,1,10]}
        ];
        door.scale.set(2, 2, 4); door.position.set(-10, 1, 0);
        goal.scale.set(4, 0.1, 4); goal.position.set(-12, 0.05, 0);
    }

    for(let i=0; i<5; i++) {
        walls[i].scale.set(...wallConfigs[i].s);
        walls[i].position.set(...wallConfigs[i].p);
    }

    let valid = false;
    while(!valid) {
        switchMesh.position.x = (Math.random() - 0.5) * 14;
        switchMesh.position.z = (Math.random() - 0.5) * 14;
        let dCenter = Math.hypot(switchMesh.position.x, switchMesh.position.z);
        let dDoor = Math.hypot(switchMesh.position.x - door.position.x, switchMesh.position.z - door.position.z);
        if(dCenter > 3 && dDoor > 4) valid = true;
    }

    valid = false;
    while(!valid) {
        enemyPatrol.startX = (Math.random() - 0.5) * 10;
        enemyPatrol.startZ = (Math.random() - 0.5) * 10;
        let dCenter = Math.hypot(enemyPatrol.startX, enemyPatrol.startZ);
        let dDoor = Math.hypot(enemyPatrol.startX - door.position.x, enemyPatrol.startZ - door.position.z);
        let dSwitch = Math.hypot(enemyPatrol.startX - switchMesh.position.x, enemyPatrol.startZ - switchMesh.position.z);
        if(dCenter > 4 && dDoor > 4 && dSwitch > 3) valid = true;
    }
    enemyPatrol.axis = Math.random() < 0.5 ? 'x' : 'z';
    enemy.position.set(enemyPatrol.startX, 0.5, enemyPatrol.startZ);
}

function intersect(ax, az, aw, ad, bx, bz, bw, bd) {
    return (Math.abs(ax - bx) < (aw + bw) / 2) &&
           (Math.abs(az - bz) < (ad + bd) / 2);
}

function update(dt) {
    if (gameState !== 'PLAYING') return;
    frame++;
    const a = globalThis.currentAction;
    const speed = 8;

    let dx = 0, dz = 0;
    if (a === 1 || a === 6) { dx = -speed * dt; playerFacing = {x: -1, z: 0}; }
    if (a === 2 || a === 7) { dx =  speed * dt; playerFacing = {x: 1, z: 0}; }
    if (a === 3) { dz = -speed * dt; playerFacing = {x: 0, z: -1}; }
    if (a === 4) { dz =  speed * dt; playerFacing = {x: 0, z: 1}; }

    if (dx !== 0) {
        let nextX = player.position.x + dx;
        let collision = false;
        for(let w of walls) {
            if (intersect(nextX, player.position.z, 0.8, 0.8, w.position.x, w.position.z, w.scale.x, w.scale.z)) collision = true;
        }
        if (!doorOpen && intersect(nextX, player.position.z, 0.8, 0.8, door.position.x, door.position.z, door.scale.x, door.scale.z)) collision = true;
        if (!collision) player.position.x = nextX;
    }
    
    if (dz !== 0) {
        let nextZ = player.position.z + dz;
        let collision = false;
        for(let w of walls) {
            if (intersect(player.position.x, nextZ, 0.8, 0.8, w.position.x, w.position.z, w.scale.x, w.scale.z)) collision = true;
        }
        if (!doorOpen && intersect(player.position.x, nextZ, 0.8, 0.8, door.position.x, door.position.z, door.scale.x, door.scale.z)) collision = true;
        if (!collision) player.position.z = nextZ;
    }

    if ((a === 5 || a === 6 || a === 7) && swordTimer <= 0) {
        swordTimer = 0.25;
    }

    if (swordTimer > 0) {
        swordTimer -= dt;
        sword.visible = true;
        sword.position.x = player.position.x + playerFacing.x * 1.0;
        sword.position.z = player.position.z + playerFacing.z * 1.0;
        sword.position.y = 0.5;

        let sw = 1.0, sd = 1.0;
        if (playerFacing.x !== 0) {
            sword.scale.set(1.5, 0.2, 0.5);
            sw = 1.5; sd = 0.5;
        } else {
            sword.scale.set(0.5, 0.2, 1.5);
            sw = 0.5; sd = 1.5;
        }

        if (enemyAlive && intersect(sword.position.x, sword.position.z, sw, sd, enemy.position.x, enemy.position.z, 1.0, 1.0)) {
            enemyAlive = false;
            enemy.visible = false;
            score += 10;
            if (!doorOpen) {
                doorOpen = true;
                door.position.y = -5;
            }
        }
    } else {
        sword.visible = false;
    }

    if (enemyAlive) {
        if (enemyPatrol.axis === 'x') {
            enemy.position.x = enemyPatrol.startX + Math.sin(frame * 0.05) * 3;
        } else {
            enemy.position.z = enemyPatrol.startZ + Math.sin(frame * 0.05) * 3;
        }

        if (intersect(player.position.x, player.position.z, 0.8, 0.8, enemy.position.x, enemy.position.z, 0.8, 0.8)) {
            gameState = 'GAMEOVER';
            lives = 0;
        }
    }

    if (!doorOpen && intersect(player.position.x, player.position.z, 0.8, 0.8, switchMesh.position.x, switchMesh.position.z, 1.2, 1.2)) {
        doorOpen = true;
        switchMesh.material.color.setHex(0x00ffaa);
        switchMesh.position.y = 0.05;
        door.position.y = -5;
        score += 10;
    }

    if (intersect(player.position.x, player.position.z, 0.8, 0.8, goal.position.x, goal.position.z, goal.scale.x, goal.scale.z)) {
        gameState = 'WIN';
        score += 50;
    }
}

function render() {
    globalThis.renderer.render(globalThis.scene, globalThis.camera);
}

function getGameState() {
    return { score, lives, gameState };
}

function mulberry32(seed) {
    let t = seed >>> 0;
    return () => {
        t += 0x6d2b79f5;
        let n = Math.imul(t ^ (t >>> 15), t | 1);
        n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
        return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
    };
}