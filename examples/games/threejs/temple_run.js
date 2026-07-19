let THREE;
let scene, camera, renderer;
let player;
let floorGeo, beamGeo, playerGeo;
let floorMat, beamMat, playerMat;

// Game State
let score = 0;
let lives = 1;
let gameState = 'PLAYING';
let speed = 15;
let distanceRun = 0;
let turnBonuses = 0;

// Player State
let px = 0, pz = 0, py = 0;
let vY = 0;
let dirX = 0, dirZ = -1;
let isSliding = false;
let slideTimer = 0;

// Path State
let segments = [];
let currentSegIndex = 0;
let distAlongSeg = 0;

function setup(args) {
    THREE = args.THREE;
    renderer = args.renderer;
    
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111122);
    
    camera = new THREE.PerspectiveCamera(60, args.width / args.height, 0.1, 200);
    
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const dl = new THREE.DirectionalLight(0xffffff, 0.8);
    dl.position.set(10, 20, 10);
    scene.add(dl);

    floorGeo = new THREE.BoxGeometry(1, 1, 1);
    beamGeo = new THREE.BoxGeometry(4, 1, 1);
    playerGeo = new THREE.BoxGeometry(1, 1, 1);

    floorMat = new THREE.MeshLambertMaterial({ color: 0x44aa44 });
    beamMat = new THREE.MeshLambertMaterial({ color: 0x884400 });
    playerMat = new THREE.MeshLambertMaterial({ color: 0x00ffff });

    player = new THREE.Mesh(playerGeo, playerMat);
    scene.add(player);
}

function generateSegment(startX, startZ, dx, dz, isFirst = false) {
    let length = 40 + Math.random() * 60; // 40 to 100 units
    let endX = startX + dx * length;
    let endZ = startZ + dz * length;
    
    // Determine next turn direction
    let turnLeft = Math.random() > 0.5;
    let nextDirX = turnLeft ? dz : -dz;
    let nextDirZ = turnLeft ? -dx : dx;

    let obstacles = [];
    let numObs = isFirst ? 0 : 1 + Math.floor(Math.random() * 3);
    let lastD = 10;
    for(let i = 0; i < numObs; i++) {
        let d = lastD + 10 + Math.random() * 15;
        if (d > length - 15) break;
        obstacles.push({
            type: Math.random() > 0.5 ? 'GAP' : 'BEAM',
            d: d
        });
        lastD = d;
    }

    let segMeshes = [];
    let lastDrawD = 0;

    obstacles.forEach(obs => {
        if (obs.type === 'GAP') {
            let span = (obs.d - 2.5) - lastDrawD;
            if (span > 0) {
                let centerD = lastDrawD + span / 2;
                let mesh = new THREE.Mesh(floorGeo, floorMat);
                mesh.scale.set(4, 1, span);
                mesh.position.set(startX + dx * centerD, -0.5, startZ + dz * centerD);
                if (dx !== 0) mesh.rotation.y = Math.PI / 2;
                scene.add(mesh);
                segMeshes.push(mesh);
            }
            lastDrawD = obs.d + 2.5; // gap width is 5
        } else if (obs.type === 'BEAM') {
            let mesh = new THREE.Mesh(beamGeo, beamMat);
            mesh.position.set(startX + dx * obs.d, 1.5, startZ + dz * obs.d); // Bottom at 1.0, top at 2.0
            if (dx !== 0) mesh.rotation.y = Math.PI / 2;
            scene.add(mesh);
            segMeshes.push(mesh);
        }
    });

    let span = length - lastDrawD;
    if (span > 0) {
        let centerD = lastDrawD + span / 2;
        let mesh = new THREE.Mesh(floorGeo, floorMat);
        mesh.scale.set(4, 1, span);
        mesh.position.set(startX + dx * centerD, -0.5, startZ + dz * centerD);
        if (dx !== 0) mesh.rotation.y = Math.PI / 2;
        scene.add(mesh);
        segMeshes.push(mesh);
    }

    // Junction platform
    let jMesh = new THREE.Mesh(floorGeo, floorMat);
    jMesh.scale.set(4, 1, 4);
    jMesh.position.set(endX, -0.5, endZ);
    scene.add(jMesh);
    segMeshes.push(jMesh);

    return { startX, startZ, dx, dz, length, endX, endZ, nextDirX, nextDirZ, obstacles, meshes: segMeshes, hasTurned: false };
}

function update(dt) {
    if (gameState !== 'PLAYING') return;

    const action = globalThis.currentAction;
    let seg = segments[currentSegIndex];
    let distToEnd = seg.length - distAlongSeg;
    const turnWindow = 4.0;

    // 1. Turn Logic
    if (!seg.hasTurned && py > -1.0 && Math.abs(distToEnd) < turnWindow) {
        if (action === 1 || action === 2) { // 1 = LEFT, 2 = RIGHT
            let attemptDx = (action === 1) ? seg.dz : -seg.dz;
            let attemptDz = (action === 1) ? -seg.dx : seg.dx;
            
            if (attemptDx === seg.nextDirX && attemptDz === seg.nextDirZ) {
                seg.hasTurned = true;
                px = seg.endX;
                pz = seg.endZ;
                dirX = seg.nextDirX;
                dirZ = seg.nextDirZ;
                currentSegIndex++;
                distAlongSeg = 0;
                turnBonuses += 50;
                
                segments.push(generateSegment(px, pz, dirX, dirZ, false));
                
                if (currentSegIndex >= 2) {
                    let oldSeg = segments.shift();
                    for (let m of oldSeg.meshes) scene.remove(m);
                    currentSegIndex--;
                }
                seg = segments[currentSegIndex];
            } else {
                gameState = 'GAMEOVER';
            }
        }
    }

    // 2. Check Over Ground
    let overGround = true;
    if (distAlongSeg > seg.length + 2.0) {
        overGround = false; // Ran past junction
    } else {
        for (let obs of seg.obstacles) {
            if (obs.type === 'GAP' && Math.abs(distAlongSeg - obs.d) < 2.5) {
                overGround = false;
                break;
            }
        }
    }

    // 3. Action Logic (Jump / Slide)
    if (action === 3 && py === 0 && overGround) { // UP
        vY = 12;
        isSliding = false;
    }
    if (action === 4 && py === 0 && overGround) { // DOWN
        isSliding = true;
        slideTimer = 0.6;
    }

    // 4. Physics & Movement
    vY -= 40 * dt; // Gravity
    py += vY * dt;

    if (overGround) {
        if (py <= 0 && py > -0.5) {
            py = 0;
            vY = 0;
        } else if (py <= -0.5) {
            gameState = 'GAMEOVER'; // Hit the edge of a gap
        }
    }

    distAlongSeg += speed * dt;
    px = seg.startX + dirX * distAlongSeg;
    pz = seg.startZ + dirZ * distAlongSeg;

    if (isSliding) {
        slideTimer -= dt;
        if (slideTimer <= 0) isSliding = false;
    }

    // 5. Obstacle Collision (Beam)
    for (let obs of seg.obstacles) {
        if (obs.type === 'BEAM') {
            if (Math.abs(distAlongSeg - obs.d) < 1.0) {
                let playerTop = py + (isSliding ? 1.0 : 2.0);
                if (playerTop > 1.1) {
                    gameState = 'GAMEOVER';
                }
            }
        }
    }

    if (py < -5) gameState = 'GAMEOVER';

    // 6. Visual Updates
    player.position.set(px, py + (isSliding ? 0.5 : 1.0), pz);
    player.scale.y = isSliding ? 1.0 : 2.0;

    camera.position.x = px - dirX * 10;
    camera.position.y = py + 7;
    camera.position.z = pz - dirZ * 10;
    camera.lookAt(px + dirX * 5, py + 1, pz + dirZ * 5);

    // 7. Score and Difficulty
    speed = Math.min(35, speed + 0.1 * dt);
    distanceRun += speed * dt;
    score = Math.floor(distanceRun) + turnBonuses;
}

function render() {
    renderer.render(scene, camera);
}

function resetGame(seed) {
    Math.random = mulberry32(seed >>> 0);
    
    score = 0;
    lives = 1;
    gameState = 'PLAYING';
    speed = 15;
    distanceRun = 0;
    turnBonuses = 0;

    px = 0; pz = 0; py = 0;
    vY = 0;
    dirX = 0; dirZ = -1;
    isSliding = false;
    slideTimer = 0;

    for (let seg of segments) {
        for (let m of seg.meshes) scene.remove(m);
    }
    segments = [];
    currentSegIndex = 0;
    distAlongSeg = 0;

    segments.push(generateSegment(0, 0, 0, -1, true));
    let s0 = segments[0];
    segments.push(generateSegment(s0.endX, s0.endZ, s0.nextDirX, s0.nextDirZ, false));
    
    player.position.set(0, 1, 0);
    camera.position.set(0, 7, 10);
    camera.lookAt(0, 1, -5);
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