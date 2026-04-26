let THREE, scene, camera, renderer;
let geos = {}, mats = {};
let score = 0, lives = 1, gameState = 'PLAYING';
let player, playerTargetX = 0, playerTargetZ = 0, playerJumpTimer = 0;
let jumpDuration = 0.15;
let onLog = null;
let maxZ_reached = 0;
let lanes = [];
let prevType = 0, typeCount = 0;
let PLAY_WIDTH = 6;
let lowestZ_generated = 5;

function setup({ THREE: threeArg, renderer: renArg, width, height }) {
    THREE = threeArg;
    renderer = renArg;
    
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    
    camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);
    
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dl = new THREE.DirectionalLight(0xffffff, 0.8);
    dl.position.set(5, 10, 5);
    scene.add(dl);

    geos.box = new THREE.BoxGeometry(1, 1, 1);
    geos.lane = new THREE.BoxGeometry(20, 1, 1);

    mats.player = new THREE.MeshLambertMaterial({color: 0xffffff});
    mats.grass = new THREE.MeshLambertMaterial({color: 0x7cfc00});
    mats.road = new THREE.MeshLambertMaterial({color: 0x333333});
    mats.river = new THREE.MeshLambertMaterial({color: 0x1e90ff});
    mats.tree = new THREE.MeshLambertMaterial({color: 0x228b22});
    mats.wood = new THREE.MeshLambertMaterial({color: 0x8b4513});
    mats.car1 = new THREE.MeshLambertMaterial({color: 0xff3333});
    mats.car2 = new THREE.MeshLambertMaterial({color: 0x3333ff});
    mats.car3 = new THREE.MeshLambertMaterial({color: 0xffd700});

    player = new THREE.Mesh(geos.box, mats.player);
    player.scale.set(0.6, 0.6, 0.6);
    scene.add(player);
}

function generateLane(z) {
    let type = 0;
    if (z > 0) {
        type = 0;
    } else {
        let r = Math.random();
        if (r < 0.4) type = 1;
        else if (r < 0.7) type = 2;
        else type = 0;

        if (type === prevType) {
            typeCount++;
            if (typeCount > 2) {
                type = (type + 1) % 3;
                typeCount = 1;
            }
        } else {
            prevType = type;
            typeCount = 1;
        }
    }

    let laneMat = type === 0 ? mats.grass : (type === 1 ? mats.road : mats.river);
    let laneMesh = new THREE.Mesh(geos.lane, laneMat);
    laneMesh.position.set(0, 0, z);
    scene.add(laneMesh);

    let lane = { z: z, type: type, mesh: laneMesh, entities: [], speed: 0, dir: 1 };

    if (type === 0) {
        let numTrees = Math.floor(Math.random() * 4) + 1;
        let usedX = new Set();
        for (let i = 0; i < numTrees; i++) {
            let tx = Math.floor(Math.random() * (PLAY_WIDTH * 2 + 1)) - PLAY_WIDTH;
            if (tx === 0 && z >= -2 && z <= 2) continue;
            if (!usedX.has(tx)) {
                usedX.add(tx);
                let tree = new THREE.Mesh(geos.box, mats.tree);
                tree.position.set(tx, 1, z);
                scene.add(tree);
                lane.entities.push({ mesh: tree, x: tx, isTree: true });
            }
        }
        let w1 = new THREE.Mesh(geos.box, mats.tree); w1.position.set(-PLAY_WIDTH - 1, 1, z); scene.add(w1); lane.entities.push({ mesh: w1, x: -PLAY_WIDTH - 1, isTree: true });
        let w2 = new THREE.Mesh(geos.box, mats.tree); w2.position.set(PLAY_WIDTH + 1, 1, z); scene.add(w2); lane.entities.push({ mesh: w2, x: PLAY_WIDTH + 1, isTree: true });
    } else if (type === 1) {
        lane.dir = Math.random() < 0.5 ? 1 : -1;
        lane.speed = 3 + Math.random() * 4;
        let numCars = Math.floor(Math.random() * 2) + 1;
        let carMat = [mats.car1, mats.car2, mats.car3][Math.floor(Math.random() * 3)];
        for (let i = 0; i < numCars; i++) {
            let cx = (Math.random() * 20 - 10);
            let car = new THREE.Mesh(geos.box, carMat);
            car.scale.set(1.5, 0.8, 0.8);
            car.position.set(cx, 0.9, z);
            scene.add(car);
            lane.entities.push({ mesh: car, x: cx, w: 1.5 });
        }
    } else if (type === 2) {
        lane.dir = Math.random() < 0.5 ? 1 : -1;
        lane.speed = 2 + Math.random() * 3;
        let numLogs = Math.floor(Math.random() * 3) + 2;
        for (let i = 0; i < numLogs; i++) {
            let lx = (Math.random() * 20 - 10);
            let len = 2.5 + Math.random() * 2;
            let log = new THREE.Mesh(geos.box, mats.wood);
            log.scale.set(len, 0.6, 0.8);
            log.position.set(lx, 0.8, z);
            scene.add(log);
            lane.entities.push({ mesh: log, x: lx, w: len });
        }
    }

    lanes.push(lane);
}

function resetGame(seed) {
    Math.random = mulberry32(seed >>> 0);
    score = 0;
    lives = 1;
    gameState = 'PLAYING';

    for (let l of lanes) {
        scene.remove(l.mesh);
        for (let e of l.entities) scene.remove(e.mesh);
    }
    lanes = [];
    prevType = 0;
    typeCount = 0;
    maxZ_reached = 0;

    playerTargetX = 0;
    playerTargetZ = 0;
    playerJumpTimer = 0;
    onLog = null;
    player.position.set(0, 0.8, 0);

    lowestZ_generated = 5;
    while (lowestZ_generated >= -30) {
        generateLane(lowestZ_generated);
        lowestZ_generated--;
    }

    updateCamera(0);
}

function update(dt) {
    if (gameState !== 'PLAYING') return;
    dt = Math.min(dt, 0.1);

    let a = globalThis.currentAction;
    let dx = 0, dz = 0;

    if (playerJumpTimer <= 0) {
        if (a === 1) dx = -1;
        else if (a === 2) dx = 1;
        else if (a === 3) dz = -1;
        else if (a === 4) dz = 1;

        if (dx !== 0 || dz !== 0) {
            let nx = Math.round(playerTargetX + dx);
            let nz = Math.round(playerTargetZ + dz);

            if (nx >= -PLAY_WIDTH && nx <= PLAY_WIDTH) {
                let blocked = false;
                let targetLane = lanes.find(l => l.z === nz);
                if (targetLane && targetLane.type === 0) {
                    for (let e of targetLane.entities) {
                        if (e.isTree && Math.round(e.x) === nx) {
                            blocked = true; break;
                        }
                    }
                }

                if (!blocked) {
                    playerTargetX = nx;
                    playerTargetZ = nz;
                    playerJumpTimer = jumpDuration;
                    onLog = null;
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
        player.position.y = 0.8 + Math.sin(t * Math.PI) * 0.8;

        if (playerJumpTimer <= 0) {
            player.position.x = playerTargetX;
            player.position.z = playerTargetZ;
            player.position.y = 0.8;
            checkLanding();
        }
    }

    for (let l of lanes) {
        if (l.type === 1 || l.type === 2) {
            for (let e of l.entities) {
                e.x += l.speed * l.dir * dt;
                if (l.dir === 1 && e.x > 12) e.x = -12;
                if (l.dir === -1 && e.x < -12) e.x = 12;
                e.mesh.position.x = e.x;
            }
        }
    }

    if (onLog && playerJumpTimer <= 0) {
        let drift = onLog.lane.speed * onLog.lane.dir * dt;
        playerTargetX += drift;
        player.position.x = playerTargetX;
    }

    checkCollisions();

    let currentZScore = -Math.round(playerTargetZ);
    if (currentZScore > score) {
        score = currentZScore;
    }
    if (playerTargetZ < maxZ_reached) {
        maxZ_reached = playerTargetZ;
    }

    while (lowestZ_generated > playerTargetZ - 30) {
        generateLane(lowestZ_generated);
        lowestZ_generated--;
    }

    for (let i = lanes.length - 1; i >= 0; i--) {
        if (lanes[i].z > playerTargetZ + 10) {
            scene.remove(lanes[i].mesh);
            for (let e of lanes[i].entities) scene.remove(e.mesh);
            lanes.splice(i, 1);
        }
    }

    updateCamera(dt);
}

function checkLanding() {
    let currentLane = lanes.find(l => l.z === Math.round(playerTargetZ));
    if (currentLane && currentLane.type === 2) {
        let landed = false;
        for (let e of currentLane.entities) {
            if (Math.abs(playerTargetX - e.x) < e.w / 2 + 0.3) {
                onLog = { lane: currentLane, entity: e };
                landed = true;
                break;
            }
        }
        if (!landed) {
            gameState = 'GAMEOVER';
        }
    }
}

function checkCollisions() {
    for (let l of lanes) {
        if (Math.abs(l.z - player.position.z) < 0.6) {
            if (l.type === 1) {
                for (let e of l.entities) {
                    if (Math.abs(player.position.x - e.x) < (e.w / 2 + 0.3)) {
                        gameState = 'GAMEOVER';
                    }
                }
            }
        }
    }

    if (playerJumpTimer <= 0) {
        let currentLane = lanes.find(l => l.z === Math.round(playerTargetZ));
        if (currentLane && currentLane.type === 2 && !onLog) {
            gameState = 'GAMEOVER';
        }
        if (player.position.x < -PLAY_WIDTH - 0.5 || player.position.x > PLAY_WIDTH + 0.5) {
            gameState = 'GAMEOVER';
        }
        if (playerTargetZ > maxZ_reached + 4) {
            gameState = 'GAMEOVER';
        }
    }
}

function updateCamera(dt) {
    let targetCamZ = player.position.z + 6;
    if (dt === 0) {
        camera.position.set(0, 10, targetCamZ);
    } else {
        camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetCamZ, 10 * dt);
    }
    camera.lookAt(0, 0, camera.position.z - 6);
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