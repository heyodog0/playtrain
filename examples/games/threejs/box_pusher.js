let player = { x: 0, z: 0, mesh: null };
let boxes = [];
let pads = [];
let score = 0;
let lives = 1;
let gameState = 'PLAYING';
let maxBoxesPlaced = 0;

let isMoving = false;
let tweenTimer = 0;
const tweenDuration = 0.15;
let playerStart = { x: 0, z: 0 }, playerTarget = { x: 0, z: 0 };
let pushedBox = null;
let boxStart = { x: 0, z: 0 }, boxTarget = { x: 0, z: 0 };

let mats = {};
let geos = {};

function setup({ THREE, renderer, width, height }) {
    globalThis.THREE = THREE;
    globalThis.scene = new THREE.Scene();
    globalThis.scene.background = new THREE.Color(0x1a1a2e);
    globalThis.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);

    // Center of 8x8 grid is (3.5, 3.5)
    globalThis.camera.position.set(3.5, 9, 7);
    globalThis.camera.lookAt(3.5, 0, 3.5);

    globalThis.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dl = new THREE.DirectionalLight(0xffffff, 0.8);
    dl.position.set(5, 15, 5);
    globalThis.scene.add(dl);

    globalThis.levelGroup = new THREE.Group();
    globalThis.scene.add(globalThis.levelGroup);

    // Materials
    mats.wall = new THREE.MeshLambertMaterial({ color: 0x8aaae5 });
    mats.floor1 = new THREE.MeshLambertMaterial({ color: 0x2a2a3e });
    mats.floor2 = new THREE.MeshLambertMaterial({ color: 0x3a3a4e });
    mats.player = new THREE.MeshLambertMaterial({ color: 0xffffff });

    mats.box_r = new THREE.MeshLambertMaterial({ color: 0xff4d4d });
    mats.box_g = new THREE.MeshLambertMaterial({ color: 0x4dff4d });
    mats.box_b = new THREE.MeshLambertMaterial({ color: 0x4d4dff });

    mats.pad_r = new THREE.MeshLambertMaterial({ color: 0xaa3333 });
    mats.pad_g = new THREE.MeshLambertMaterial({ color: 0x33aa33 });
    mats.pad_b = new THREE.MeshLambertMaterial({ color: 0x3333aa });

    // Geometries
    geos.wall = new THREE.BoxGeometry(1, 1, 1);
    geos.floor = new THREE.PlaneGeometry(1, 1);
    geos.box = new THREE.BoxGeometry(0.7, 0.7, 0.7);
    geos.pad = new THREE.BoxGeometry(0.8, 0.05, 0.8);
    geos.player = new THREE.SphereGeometry(0.35, 16, 16);
}

function update(dt) {
    if (gameState !== 'PLAYING') return;

    if (isMoving) {
        tweenTimer += dt;
        let t = tweenTimer / tweenDuration;
        if (t >= 1.0) {
            t = 1.0;
            isMoving = false;
            checkWin();
        }
        
        player.mesh.position.x = playerStart.x + (playerTarget.x - playerStart.x) * t;
        player.mesh.position.z = playerStart.z + (playerTarget.z - playerStart.z) * t;

        if (pushedBox) {
            pushedBox.mesh.position.x = boxStart.x + (boxTarget.x - boxStart.x) * t;
            pushedBox.mesh.position.z = boxStart.z + (boxTarget.z - boxStart.z) * t;
        }
        return;
    }

    const a = globalThis.currentAction;
    let dx = 0, dz = 0;
    if (a === 1) dx = -1;      // LEFT
    else if (a === 2) dx = 1;  // RIGHT
    else if (a === 3) dz = -1; // UP
    else if (a === 4) dz = 1;  // DOWN

    if (dx === 0 && dz === 0) return;

    const tx = player.x + dx;
    const tz = player.z + dz;

    // Outer wall boundaries
    if (tx < 1 || tx > 6 || tz < 1 || tz > 6) return;

    let hitBox = boxes.find(b => b.x === tx && b.z === tz);
    if (hitBox) {
        const bx = tx + dx;
        const bz = tz + dz;
        
        // Box wall collision
        if (bx < 1 || bx > 6 || bz < 1 || bz > 6) return;
        
        // Box-to-box collision
        if (boxes.some(b => b.x === bx && b.z === bz)) return;

        pushedBox = hitBox;
        boxStart = { x: hitBox.x, z: hitBox.z };
        boxTarget = { x: bx, z: bz };
        hitBox.x = bx;
        hitBox.z = bz;
    } else {
        pushedBox = null;
    }

    playerStart = { x: player.x, z: player.z };
    playerTarget = { x: tx, z: tz };
    player.x = tx;
    player.z = tz;

    isMoving = true;
    tweenTimer = 0;
}

function checkWin() {
    let placed = 0;
    for (let b of boxes) {
        let pad = pads.find(p => p.x === b.x && p.z === b.z);
        if (pad && pad.c === b.c) {
            placed++;
        }
    }
    
    // Monotonic score increment
    if (placed > maxBoxesPlaced) {
        score += (placed - maxBoxesPlaced) * 10;
        maxBoxesPlaced = placed;
    }
    
    if (placed === boxes.length) {
        gameState = 'WIN';
        score += 50;
    }
}

function render() {
    globalThis.renderer.render(globalThis.scene, globalThis.camera);
}

function resetGame(seed) {
    Math.random = mulberry32(seed >>> 0);
    score = 0;
    lives = 1;
    gameState = 'PLAYING';
    isMoving = false;
    tweenTimer = 0;

    while (globalThis.levelGroup.children.length > 0) {
        globalThis.levelGroup.remove(globalThis.levelGroup.children[0]);
    }

    // Generate guaranteed solvable layout via reverse random walk
    pads = [];
    boxes = [];
    const colors = ['r', 'g', 'b'];
    
    for (let i = 0; i < 3; i++) {
        let px, pz;
        while (true) {
            px = 2 + Math.floor(Math.random() * 4);
            pz = 2 + Math.floor(Math.random() * 4);
            if (!pads.some(p => p.x === px && p.z === pz)) break;
        }
        pads.push({ x: px, z: pz, c: colors[i] });
        boxes.push({ x: px, z: pz, c: colors[i] });
    }

    player.x = boxes[0].x + 1;
    player.z = boxes[0].z;

    const dirs = [ {dx: 1, dz: 0}, {dx: -1, dz: 0}, {dx: 0, dz: 1}, {dx: 0, dz: -1} ];

    for (let step = 0; step < 300; step++) {
        let d = dirs[Math.floor(Math.random() * dirs.length)];
        let pBackX = player.x - d.dx;
        let pBackZ = player.z - d.dz;
        let pFrontX = player.x + d.dx;
        let pFrontZ = player.z + d.dz;

        if (pBackX < 1 || pBackX > 6 || pBackZ < 1 || pBackZ > 6) continue;
        if (boxes.some(b => b.x === pBackX && b.z === pBackZ)) continue;

        let boxToPull = boxes.find(b => b.x === pFrontX && b.z === pFrontZ);

        if (boxToPull && Math.random() < 0.7) {
            boxToPull.x = player.x;
            boxToPull.z = player.z;
            player.x = pBackX;
            player.z = pBackZ;
        } else {
            player.x = pBackX;
            player.z = pBackZ;
        }
    }

    // Build Scene Graph from Logical State
    for (let x = 0; x <= 7; x++) {
        for (let z = 0; z <= 7; z++) {
            if (x === 0 || x === 7 || z === 0 || z === 7) {
                let w = new globalThis.THREE.Mesh(geos.wall, mats.wall);
                w.position.set(x, 0.5, z);
                globalThis.levelGroup.add(w);
            } else {
                let f = new globalThis.THREE.Mesh(geos.floor, (x + z) % 2 === 0 ? mats.floor1 : mats.floor2);
                f.rotation.x = -Math.PI / 2;
                f.position.set(x, 0, z);
                globalThis.levelGroup.add(f);
            }
        }
    }

    for (let p of pads) {
        let m = new globalThis.THREE.Mesh(geos.pad, mats['pad_' + p.c]);
        m.position.set(p.x, 0.025, p.z);
        globalThis.levelGroup.add(m);
    }

    for (let b of boxes) {
        b.mesh = new globalThis.THREE.Mesh(geos.box, mats['box_' + b.c]);
        b.mesh.position.set(b.x, 0.35, b.z);
        globalThis.levelGroup.add(b.mesh);
    }

    player.mesh = new globalThis.THREE.Mesh(geos.player, mats.player);
    player.mesh.position.set(player.x, 0.35, player.z);
    globalThis.levelGroup.add(player.mesh);

    // Initial score alignment
    maxBoxesPlaced = 0;
    for (let b of boxes) {
        let pad = pads.find(p => p.x === b.x && p.z === b.z);
        if (pad && pad.c === b.c) maxBoxesPlaced++;
    }
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