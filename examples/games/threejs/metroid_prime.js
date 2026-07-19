let THREE, scene, camera, renderer;
let score = 0, lives = 1, gameState = 'PLAYING';

let geos = {};
let mats = {};

let player = { x: 0, z: 0, yaw: 0, bob: 0 };
let fireCooldown = 0;
let frame = 0;

let floor, ceiling;
let boxes = [];
let projectiles = [];
let decors = [];

function setup({ THREE: threeArg, renderer: renArg, width, height }) {
    THREE = threeArg;
    renderer = renArg;

    scene = new THREE.Scene();
    // Cool blue/teal palette for Metroid Prime vibe
    scene.background = new THREE.Color(0x05101a);
    scene.fog = new THREE.Fog(0x05101a, 2, 35);

    camera = new THREE.PerspectiveCamera(70, width / height, 0.1, 100);
    camera.rotation.order = "YXZ";

    scene.add(new THREE.AmbientLight(0x204060, 1.2));
    const dl = new THREE.DirectionalLight(0x88ccff, 1.5);
    dl.position.set(5, 10, -5);
    scene.add(dl);

    geos.box = new THREE.BoxGeometry(1, 1, 1);
    geos.plane = new THREE.PlaneGeometry(1, 1);
    geos.sphere = new THREE.SphereGeometry(0.2, 8, 8);
    geos.target = new THREE.IcosahedronGeometry(1.2, 0);
    geos.decor = new THREE.CylinderGeometry(0.2, 0.2, 4, 8);

    mats.floor = new THREE.MeshLambertMaterial({ color: 0x0a1522 });
    mats.ceiling = new THREE.MeshLambertMaterial({ color: 0x050a11 });
    mats.wall = new THREE.MeshLambertMaterial({ color: 0x1a3344 });
    mats.obstacle = new THREE.MeshLambertMaterial({ color: 0x778899 });
    mats.target = new THREE.MeshBasicMaterial({ color: 0xff3333 });
    mats.projectile = new THREE.MeshBasicMaterial({ color: 0x00ffff });
    mats.decor = new THREE.MeshBasicMaterial({ color: 0x0088cc });

    floor = new THREE.Mesh(geos.plane, mats.floor);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    ceiling = new THREE.Mesh(geos.plane, mats.ceiling);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = 4;
    scene.add(ceiling);

    // Simple HUD reticle (visor aesthetic)
    let retMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.015, 4, 4),
        new THREE.MeshBasicMaterial({ color: 0x00ffff })
    );
    retMesh.position.set(0, 0, -1);
    camera.add(retMesh);
    scene.add(camera);
}

function addBox(cx, cz, w, h, d, type, mat) {
    let mesh = new THREE.Mesh(type === 'TARGET' ? geos.target : geos.box, mat);
    if (type !== 'TARGET') {
        mesh.scale.set(w, h, d);
        mesh.position.set(cx, h / 2, cz);
        scene.add(mesh);
        boxes.push({ type, mesh, minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, active: true });
    } else {
        mesh.position.set(cx, 2, cz);
        scene.add(mesh);
        boxes.push({ type, mesh, minX: cx - 1.2, maxX: cx + 1.2, minZ: cz - 1.2, maxZ: cz + 1.2, active: true });
    }
}

function resetGame(seed) {
    Math.random = mulberry32(seed >>> 0);
    score = 0;
    lives = 1;
    gameState = 'PLAYING';
    frame = 0;

    for (let b of boxes) scene.remove(b.mesh);
    boxes = [];
    for (let p of projectiles) scene.remove(p.mesh);
    projectiles = [];
    for (let d of decors) scene.remove(d.mesh);
    decors = [];

    player.x = 0;
    player.z = 8;
    player.yaw = 0;
    player.bob = 0;
    fireCooldown = 0;

    // Procedural room size
    let rw = 25 + Math.random() * 10;
    let rd = 25 + Math.random() * 10;

    floor.scale.set(rw, rd, 1);
    ceiling.scale.set(rw, rd, 1);

    // Boundary walls
    addBox(-rw / 2 - 0.5, 0, 1, 4, rd, 'WALL', mats.wall); // Left
    addBox(rw / 2 + 0.5, 0, 1, 4, rd, 'WALL', mats.wall);  // Right
    addBox(0, -rd / 2 - 0.5, rw, 4, 1, 'WALL', mats.wall); // Front
    addBox(0, rd / 2 + 0.5, rw, 4, 1, 'WALL', mats.wall);  // Back

    // Indestructible Obstacle
    let ox = (Math.random() - 0.5) * (rw - 10);
    let oz = (Math.random() - 0.5) * (rd - 10);
    if (Math.abs(ox) < 4 && Math.abs(oz - 8) < 4) ox += 6; 
    let ow = 3 + Math.random() * 3;
    let od = 3 + Math.random() * 3;
    addBox(ox, oz, ow, 4, od, 'OBSTACLE', mats.obstacle);

    // Breakable Target
    let tx = 0, tz = 0;
    for (let i = 0; i < 50; i++) {
        tx = (Math.random() - 0.5) * (rw - 6);
        tz = (Math.random() - 0.5) * (rd - 6);
        let dSpawn = Math.hypot(tx, tz - 8);
        let dObs = Math.hypot(tx - ox, tz - oz);
        if (dSpawn > 10 && dObs > 6) break;
    }
    addBox(tx, tz, 2.4, 2.4, 2.4, 'TARGET', mats.target);

    // Decorative columns
    let numDecors = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < numDecors; i++) {
        let dx = (Math.random() - 0.5) * (rw - 4);
        let dz = (Math.random() - 0.5) * (rd - 4);
        let dmesh = new THREE.Mesh(geos.decor, mats.decor);
        dmesh.position.set(dx, 2, dz);
        scene.add(dmesh);
        decors.push({ mesh: dmesh });
    }

    updateCamera(0);
}

function checkCollision(px, pz, radius) {
    for (let b of boxes) {
        if (!b.active) continue;
        let closestX = Math.max(b.minX, Math.min(px, b.maxX));
        let closestZ = Math.max(b.minZ, Math.min(pz, b.maxZ));
        let dx = px - closestX;
        let dz = pz - closestZ;
        if ((dx * dx + dz * dz) < radius * radius) return b;
    }
    return null;
}

function updateCamera(dt) {
    camera.position.x = player.x;
    camera.position.z = player.z;
    camera.position.y = 1.5 + Math.sin(player.bob * 0.4) * 0.05; // Head bob
    camera.rotation.y = player.yaw;
    camera.rotation.x = 0;
    camera.rotation.z = 0;
}

function update(dt) {
    if (gameState !== 'PLAYING') return;
    frame++;

    let a = globalThis.currentAction;

    // Movement mappings:
    // 1: LEFT, 2: RIGHT, 3: UP, 4: DOWN, 5: D, 6: LEFT+D, 7: RIGHT+D
    if (a === 1 || a === 6) player.yaw += 3.0 * dt;
    if (a === 2 || a === 7) player.yaw -= 3.0 * dt;

    let moveSpeed = 8.0;
    let dx = 0, dz = 0;
    if (a === 3) {
        dx = -Math.sin(player.yaw) * moveSpeed * dt;
        dz = -Math.cos(player.yaw) * moveSpeed * dt;
    }
    if (a === 4) {
        dx = Math.sin(player.yaw) * moveSpeed * dt;
        dz = Math.cos(player.yaw) * moveSpeed * dt;
    }

    if (dx !== 0 || dz !== 0) {
        player.x += dx;
        if (checkCollision(player.x, player.z, 0.4)) player.x -= dx;
        player.z += dz;
        if (checkCollision(player.x, player.z, 0.4)) player.z -= dz;
        player.bob += Math.hypot(dx, dz);
    }

    fireCooldown -= dt;
    if ((a === 5 || a === 6 || a === 7) && fireCooldown <= 0) {
        fireCooldown = 0.4;
        let px = player.x - Math.sin(player.yaw) * 0.5;
        let pz = player.z - Math.cos(player.yaw) * 0.5;
        let pmesh = new THREE.Mesh(geos.sphere, mats.projectile);
        pmesh.position.set(px, 1.4, pz);
        scene.add(pmesh);
        projectiles.push({
            mesh: pmesh, x: px, z: pz,
            vx: -Math.sin(player.yaw) * 25,
            vz: -Math.cos(player.yaw) * 25,
            life: 1.5
        });
    }

    for (let i = projectiles.length - 1; i >= 0; i--) {
        let p = projectiles[i];
        p.x += p.vx * dt;
        p.z += p.vz * dt;
        p.life -= dt;
        p.mesh.position.x = p.x;
        p.mesh.position.z = p.z;

        let hitBox = checkCollision(p.x, p.z, 0.2);
        if (hitBox) {
            if (hitBox.type === 'TARGET' && hitBox.active) {
                hitBox.active = false;
                scene.remove(hitBox.mesh);
                gameState = 'WIN';
                score += 10;
            }
            scene.remove(p.mesh);
            projectiles.splice(i, 1);
        } else if (p.life <= 0) {
            scene.remove(p.mesh);
            projectiles.splice(i, 1);
        }
    }

    for (let b of boxes) {
        if (b.type === 'TARGET' && b.active) {
            b.mesh.rotation.y += dt;
            b.mesh.rotation.x += dt * 0.5;
            let s = 1.0 + Math.sin(frame * 0.05) * 0.1;
            b.mesh.scale.set(s, s, s);
        }
    }

    for (let d of decors) {
        d.mesh.rotation.y += dt * 2;
    }

    updateCamera(dt);
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