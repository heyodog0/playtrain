let THREE, scene, camera, renderer;
let geos = {}, mats = {};
let score = 0, lives = 1, gameState = 'PLAYING';

let player, playerTargetX = -6, playerTargetZ = -6, playerJumpTimer = 0;
let jumpDuration = 0.15;

const GRID_SIZE = 6; 
let grid = new Map();
let blocks = new Map();
let bombs = [];
let activeExplosions = [];
let staticMeshes = [];

let goal = {x: 0, z: 0};
let goalRevealed = false;
let goalMesh;

function setup({ THREE: threeArg, renderer: renArg, width, height }) {
    THREE = threeArg;
    renderer = renArg;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x222222);

    camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);
    camera.position.set(0, 16, 12);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const dl = new THREE.DirectionalLight(0xffffff, 0.8);
    dl.position.set(5, 15, 5);
    scene.add(dl);

    geos.player = new THREE.BoxGeometry(0.7, 0.7, 0.7);
    geos.wall = new THREE.BoxGeometry(1, 1, 1);
    geos.block = new THREE.BoxGeometry(0.9, 0.9, 0.9);
    geos.bomb = new THREE.SphereGeometry(0.4, 16, 16);
    geos.explosion = new THREE.BoxGeometry(0.9, 0.9, 0.9);
    geos.goal = new THREE.BoxGeometry(0.6, 0.6, 0.6);
    geos.floor = new THREE.PlaneGeometry(15, 15);

    mats.player = new THREE.MeshLambertMaterial({color: 0x00a8ff});
    mats.wall = new THREE.MeshLambertMaterial({color: 0x7f7f7f});
    mats.block = new THREE.MeshLambertMaterial({color: 0xc2a077});
    mats.bomb = new THREE.MeshLambertMaterial({color: 0x111111});
    mats.explosion = new THREE.MeshBasicMaterial({color: 0xff4500});
    mats.goal = new THREE.MeshBasicMaterial({color: 0xffd700});
    mats.floor = new THREE.MeshLambertMaterial({color: 0x3a5a40});

    player = new THREE.Mesh(geos.player, mats.player);
    scene.add(player);

    goalMesh = new THREE.Mesh(geos.goal, mats.goal);

    let floor = new THREE.Mesh(geos.floor, mats.floor);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    scene.add(floor);
}

function resetGame(seed) {
    Math.random = mulberry32(seed >>> 0);
    score = 0;
    lives = 1;
    gameState = 'PLAYING';

    for (let m of staticMeshes) scene.remove(m);
    staticMeshes = [];
    for (let m of blocks.values()) scene.remove(m);
    blocks.clear();
    for (let b of bombs) scene.remove(b.mesh);
    bombs = [];
    for (let ex of activeExplosions) {
        for (let m of ex.meshes) scene.remove(m);
    }
    activeExplosions = [];
    if (goalMesh.parent) scene.remove(goalMesh);
    grid.clear();

    for (let x = -GRID_SIZE - 1; x <= GRID_SIZE + 1; x++) {
        for (let z = -GRID_SIZE - 1; z <= GRID_SIZE + 1; z++) {
            if (x < -GRID_SIZE || x > GRID_SIZE || z < -GRID_SIZE || z > GRID_SIZE) {
                let m = new THREE.Mesh(geos.wall, mats.wall);
                m.position.set(x, 0.5, z);
                scene.add(m);
                staticMeshes.push(m);
            }
        }
    }

    let possibleGoals = [];
    for (let x = -GRID_SIZE; x <= GRID_SIZE; x++) {
        for (let z = -GRID_SIZE; z <= GRID_SIZE; z++) {
            let isPillar = Math.abs(x) % 2 === 1 && Math.abs(z) % 2 === 1;
            let isSafeZone = (x === -6 && z === -6) || (x === -5 && z === -6) || (x === -6 && z === -5);
            
            if (isPillar) {
                grid.set(`${x},${z}`, 1);
                let m = new THREE.Mesh(geos.wall, mats.wall);
                m.position.set(x, 0.5, z);
                scene.add(m);
                staticMeshes.push(m);
            } else if (!isSafeZone) {
                if (Math.random() < 0.6) {
                    grid.set(`${x},${z}`, 2);
                    let m = new THREE.Mesh(geos.block, mats.block);
                    m.position.set(x, 0.5, z);
                    scene.add(m);
                    blocks.set(`${x},${z}`, m);
                    possibleGoals.push({x, z});
                } else {
                    grid.set(`${x},${z}`, 0);
                }
            } else {
                grid.set(`${x},${z}`, 0);
            }
        }
    }

    goalRevealed = false;
    if (possibleGoals.length > 0) {
        let gIdx = Math.floor(Math.random() * possibleGoals.length);
        goal = possibleGoals[gIdx];
    } else {
        goal = {x: 6, z: 6};
        goalRevealed = true;
        goalMesh.position.set(goal.x, 0.5, goal.z);
        scene.add(goalMesh);
    }

    playerTargetX = -6;
    playerTargetZ = -6;
    playerJumpTimer = 0;
    player.position.set(playerTargetX, 0.5, playerTargetZ);
    player.scale.set(1, 1, 1);
}

function createExplosion(bx, bz) {
    let cells = [{x: bx, z: bz}];
    const dirs = [[1,0], [-1,0], [0,1], [0,-1]];
    const EXPLOSION_RANGE = 2;

    for (let d of dirs) {
        for (let r = 1; r <= EXPLOSION_RANGE; r++) {
            let nx = bx + d[0] * r;
            let nz = bz + d[1] * r;
            
            if (nx < -GRID_SIZE || nx > GRID_SIZE || nz < -GRID_SIZE || nz > GRID_SIZE) break;
            
            let cell = grid.get(`${nx},${nz}`);
            if (cell === 1) break; 
            
            cells.push({x: nx, z: nz});
            
            if (cell === 2) {
                grid.set(`${nx},${nz}`, 0);
                let bMesh = blocks.get(`${nx},${nz}`);
                if (bMesh) {
                    scene.remove(bMesh);
                    blocks.delete(`${nx},${nz}`);
                }
                score += 10;
                
                if (goal.x === nx && goal.z === nz) {
                    goalRevealed = true;
                    goalMesh.position.set(nx, 0.5, nz);
                    scene.add(goalMesh);
                }
                break;
            }
            
            let bIdx = bombs.findIndex(b => b.x === nx && b.z === nz);
            if (bIdx >= 0 && bombs[bIdx].timer > 0.1) {
                bombs[bIdx].timer = 0.1; 
            }
        }
    }
    
    let meshes = [];
    for (let c of cells) {
        let m = new THREE.Mesh(geos.explosion, mats.explosion);
        m.position.set(c.x, 0.5, c.z);
        scene.add(m);
        meshes.push(m);
    }
    activeExplosions.push({ timer: 0.5, cells: cells, meshes: meshes });
}

function update(dt) {
    if (gameState !== 'PLAYING') return;
    dt = Math.min(dt, 0.1);
    
    let a = globalThis.currentAction || 0;
    let dx = 0, dz = 0, dropBomb = false;

    if (a === 1 || a === 11) dx = -1;
    if (a === 2 || a === 12) dx = 1;
    if (a === 3 || a === 13) dz = -1;
    if (a === 4 || a === 14) dz = 1;
    if (a === 9 || a === 11 || a === 12 || a === 13 || a === 14) dropBomb = true;

    if (playerJumpTimer <= 0) {
        if (dropBomb) {
            let hasBomb = bombs.some(b => b.x === playerTargetX && b.z === playerTargetZ);
            if (!hasBomb) {
                let bombMesh = new THREE.Mesh(geos.bomb, mats.bomb);
                bombMesh.position.set(playerTargetX, 0.5, playerTargetZ);
                scene.add(bombMesh);
                bombs.push({ x: playerTargetX, z: playerTargetZ, timer: 2.0, mesh: bombMesh });
            }
        }

        if (dx !== 0 || dz !== 0) {
            let nx = Math.round(playerTargetX + dx);
            let nz = Math.round(playerTargetZ + dz);
            
            if (nx >= -GRID_SIZE && nx <= GRID_SIZE && nz >= -GRID_SIZE && nz <= GRID_SIZE) {
                let cell = grid.get(`${nx},${nz}`);
                let hasBomb = bombs.some(b => b.x === nx && b.z === nz);
                if (cell === 0 && !hasBomb) {
                    playerTargetX = nx;
                    playerTargetZ = nz;
                    playerJumpTimer = jumpDuration;
                }
            }
        }
    }

    if (playerJumpTimer > 0) {
        playerJumpTimer -= dt;
        let t = 1 - (playerJumpTimer / jumpDuration);
        if (t > 1) t = 1;

        player.position.x = THREE.MathUtils.lerp(player.position.x, playerTargetX, t);
        player.position.z = THREE.MathUtils.lerp(player.position.z, playerTargetZ, t);
        player.position.y = 0.5 + Math.sin(t * Math.PI) * 0.3;

        if (playerJumpTimer <= 0) {
            player.position.x = playerTargetX;
            player.position.z = playerTargetZ;
            player.position.y = 0.5;
        }
    }

    for (let i = bombs.length - 1; i >= 0; i--) {
        let b = bombs[i];
        b.timer -= dt;
        let scale = 0.8 + Math.sin(b.timer * 15) * 0.2;
        b.mesh.scale.setScalar(scale);

        if (b.timer <= 0) {
            scene.remove(b.mesh);
            createExplosion(b.x, b.z);
            bombs.splice(i, 1);
        }
    }

    for (let i = activeExplosions.length - 1; i >= 0; i--) {
        let ex = activeExplosions[i];
        ex.timer -= dt;
        for (let m of ex.meshes) m.scale.setScalar(ex.timer / 0.5);
        
        if (ex.timer <= 0) {
            for (let m of ex.meshes) scene.remove(m);
            activeExplosions.splice(i, 1);
        }
    }

    if (goalRevealed && goalMesh) {
        goalMesh.rotation.y += dt * 3;
    }

    let actX = Math.round(player.position.x);
    let actZ = Math.round(player.position.z);
    
    for (let ex of activeExplosions) {
        for (let c of ex.cells) {
            if ((actX === c.x && actZ === c.z) || (playerTargetX === c.x && playerTargetZ === c.z)) {
                gameState = 'GAMEOVER';
                lives = 0;
                player.scale.setScalar(0.1);
            }
        }
    }

    if (gameState === 'PLAYING' && goalRevealed && playerTargetX === goal.x && playerTargetZ === goal.z) {
        gameState = 'WIN';
        score += 100;
    }
}

function render() {
    renderer.render(scene, camera);
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