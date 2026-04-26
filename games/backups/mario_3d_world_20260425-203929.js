let THREE, scene, camera, renderer, width, height;
let globalTime = 0;

let geos = {};
let mats = {};

let score = 0, lives = 1, gameState = 'PLAYING';

let platforms = [];
let goombas = [];
let coins = [];
let particles = [];
let oneUps = [];
let goal = null;

let player = {
    group: null,
    position: null,
    box: null,
    size: null,
    vx: 0, vy: 0, vz: 0,
    grounded: false,
    isLongJumping: false,
    jumpHeld: false
};

function setup({ THREE: threeArg, renderer: renArg, width: wArg, height: hArg }) {
    THREE = threeArg;
    renderer = renArg;
    width = wArg;
    height = hArg;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.Fog(0x87ceeb, 20, 80);

    camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 200);

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const dl = new THREE.DirectionalLight(0xffffff, 0.8);
    dl.position.set(10, 20, 10);
    scene.add(dl);

    geos.box = new THREE.BoxGeometry(1, 1, 1);
    geos.sphere = new THREE.SphereGeometry(1, 16, 16);
    geos.cylinder = new THREE.CylinderGeometry(1, 1, 1, 16);

    mats.grass = new THREE.MeshLambertMaterial({ color: 0x4CAF50 });
    mats.dirt = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
    mats.platform = [mats.dirt, mats.dirt, mats.grass, mats.dirt, mats.dirt, mats.dirt];
    
    mats.marioRed = new THREE.MeshLambertMaterial({ color: 0xE52521 });
    mats.marioBlue = new THREE.MeshLambertMaterial({ color: 0x00439C });
    mats.goomba = new THREE.MeshLambertMaterial({ color: 0x5C3A21 });
    mats.coin = new THREE.MeshLambertMaterial({ color: 0xFFD700 });
    mats.oneUp = new THREE.MeshLambertMaterial({ color: 0x00FF00 });
    mats.pole = new THREE.MeshLambertMaterial({ color: 0xDDDDDD });
    mats.flag = new THREE.MeshLambertMaterial({ color: 0x8BC34A });
    mats.particle = new THREE.MeshBasicMaterial({ color: 0xFFFFFF });

    player.group = new THREE.Group();
    let body = new THREE.Mesh(geos.box, mats.marioRed);
    body.scale.set(0.8, 0.6, 0.8);
    body.position.y = 0.3;
    let pants = new THREE.Mesh(geos.box, mats.marioBlue);
    pants.scale.set(0.8, 0.6, 0.8);
    pants.position.y = -0.3;
    player.group.add(body);
    player.group.add(pants);
    scene.add(player.group);

    player.size = new THREE.Vector3(0.8, 1.2, 0.8);
    player.box = new THREE.Box3();
    player.position = new THREE.Vector3();
}

function resetGame(seed) {
    Math.random = mulberry32(seed >>> 0);
    score = 0;
    lives = 1;
    gameState = 'PLAYING';
    globalTime = 0;

    for (let p of platforms) scene.remove(p.mesh);
    for (let g of goombas) scene.remove(g.mesh);
    for (let c of coins) scene.remove(c.mesh);
    for (let o of oneUps) scene.remove(o.mesh);
    for (let p of particles) scene.remove(p.mesh);
    if (goal) {
        scene.remove(goal.poleMesh);
        scene.remove(goal.flagMesh);
    }

    platforms = []; goombas = []; coins = []; oneUps = []; particles = []; goal = null;

    player.position.set(0, 5, 0);
    player.vx = 0; player.vy = 0; player.vz = 0;
    player.grounded = false;
    player.isLongJumping = false;
    player.jumpHeld = false;
    player.group.rotation.x = 0;
    player.group.position.copy(player.position);

    camera.position.set(0, 10, 10);

    generateLevel();
}

function generateLevel() {
    let curZ = 0;
    let curY = 0;
    
    for (let i = 0; i < 8; i++) {
        if (i === 0) {
            createPlatform(0, 0, curZ, 10, 2, 10);
            curZ -= 5;
        } else if (i === 7) {
            let gap = 3 + Math.random() * 3;
            curZ -= gap + 6;
            curY += (Math.random() - 0.5) * 2;
            createPlatform(0, curY, curZ, 12, 2, 12);
            createGoal(0, curY + 1, curZ - 2);
        } else {
            let gap = 3 + Math.random() * 3;
            let length = 8 + Math.random() * 8;
            curZ -= (gap + length / 2);
            curY += (Math.random() * 2 - 1);

            let type = Math.floor(Math.random() * 3);
            let pX = (Math.random() - 0.5) * 6;

            if (type === 0) {
                createPlatform(pX, curY, curZ, 6, 2, length);
                if (Math.random() > 0.3) spawnGoomba(pX, curY + 1.5, curZ, 6);
                spawnCoinsLine(pX, curY + 1.5, curZ, length - 2);
            } else if (type === 1) {
                createPlatform(pX - 3, curY, curZ + length / 4, 4, 2, 4);
                createPlatform(pX + 3, curY + 0.5, curZ - length / 4, 4, 2, 4);
                spawnCoinsArc(pX, curY + 2, curZ);
                if (Math.random() > 0.5) spawnGoomba(pX + 3, curY + 2, curZ - length / 4, 4);
            } else if (type === 2) {
                createPlatform(pX, curY, curZ, 12, 2, length);
                spawnGoomba(pX - 3, curY + 1.5, curZ + 2, 5);
                spawnGoomba(pX + 3, curY + 1.5, curZ - 2, 5);
                spawnCoinsLine(pX, curY + 1.5, curZ, length - 4);
            }

            if (i === 4) {
                spawnOneUp(pX, curY + 1.5, curZ);
            }

            curZ -= length / 2;
        }
    }
}

function createPlatform(x, y, z, w, h, d) {
    let mesh = new THREE.Mesh(geos.box, mats.platform);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    scene.add(mesh);
    let box = new THREE.Box3().setFromCenterAndSize(mesh.position, new THREE.Vector3(w, h, d));
    platforms.push({ mesh, box, w, h, d });
}

function spawnGoomba(x, y, z, moveW) {
    let mesh = new THREE.Mesh(geos.sphere, mats.goomba);
    mesh.scale.set(0.6, 0.4, 0.6);
    mesh.position.set(x, y, z);
    scene.add(mesh);
    goombas.push({
        mesh, x, y, z,
        minX: x - moveW / 2 + 0.6,
        maxX: x + moveW / 2 - 0.6,
        dir: (Math.random() > 0.5 ? 1 : -1),
        speed: 2 + Math.random() * 2,
        dead: false
    });
}

function spawnCoinsLine(x, y, z, length) {
    let count = Math.max(1, Math.floor(length / 2));
    for (let i = 0; i < count; i++) {
        createCoin(x, y, z - length / 2 + i * 2);
    }
}

function spawnCoinsArc(x, y, z) {
    for (let i = 0; i < 5; i++) {
        createCoin(x + (i - 2) * 1.5, y + Math.sin(i / 4 * Math.PI) * 2, z);
    }
}

function createCoin(x, y, z) {
    let mesh = new THREE.Mesh(geos.cylinder, mats.coin);
    mesh.scale.set(0.4, 0.1, 0.4);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, y, z);
    scene.add(mesh);
    coins.push({ mesh, x, y, z, collected: false });
}

function spawnOneUp(x, y, z) {
    let mesh = new THREE.Group();
    let stem = new THREE.Mesh(geos.cylinder, mats.pole);
    stem.scale.set(0.2, 0.4, 0.2);
    stem.position.y = -0.2;
    let cap = new THREE.Mesh(geos.sphere, mats.oneUp);
    cap.scale.set(0.5, 0.4, 0.5);
    cap.position.y = 0.1;
    mesh.add(stem);
    mesh.add(cap);
    mesh.position.set(x, y, z);
    scene.add(mesh);
    oneUps.push({ mesh, x, y, z, collected: false });
}

function createGoal(x, y, z) {
    let poleMesh = new THREE.Mesh(geos.cylinder, mats.pole);
    poleMesh.scale.set(0.2, 6, 0.2);
    poleMesh.position.set(x, y + 3, z);
    scene.add(poleMesh);

    let flagMesh = new THREE.Mesh(geos.box, mats.flag);
    flagMesh.scale.set(1.5, 1, 0.1);
    flagMesh.position.set(x + 0.8, y + 5.5, z);
    scene.add(flagMesh);

    goal = { poleMesh, flagMesh, x, y, z };
}

function spawnParticles(pos, colorHex, count) {
    let mat = new THREE.MeshBasicMaterial({ color: colorHex });
    for (let i = 0; i < count; i++) {
        let mesh = new THREE.Mesh(geos.box, mat);
        mesh.scale.set(0.2, 0.2, 0.2);
        mesh.position.copy(pos);
        scene.add(mesh);
        let vel = new THREE.Vector3(
            (Math.random() - 0.5) * 10,
            Math.random() * 10,
            (Math.random() - 0.5) * 10
        );
        particles.push({ mesh, vel, life: 0.3 + Math.random() * 0.4 });
    }
}

function update(dt) {
    if (gameState !== 'PLAYING') return;
    dt = Math.min(dt, 0.05);
    globalTime += dt;

    let a = globalThis.currentAction;
    let inputX = 0, inputZ = 0, jumpPressed = false;
    
    if ([1, 5, 7, 11].includes(a)) inputX = -1;
    if ([2, 6, 8, 12].includes(a)) inputX = 1;
    if ([3, 5, 6, 13].includes(a)) inputZ = -1;
    if ([4, 7, 8, 14].includes(a)) inputZ = 1;
    if ([9, 11, 12, 13, 14].includes(a)) jumpPressed = true;

    if (jumpPressed && player.grounded && !player.jumpHeld) {
        if (a === 13) {
            player.vy = 12;
            player.vz = -22;
            player.isLongJumping = true;
        } else {
            player.vy = 16;
            player.isLongJumping = false;
        }
    }
    player.jumpHeld = jumpPressed;

    let acc = 60;
    let fric = 40;
    let maxSpdX = 12;
    let maxSpdZ = player.isLongJumping ? 22 : 12;

    if (inputX !== 0) {
        player.vx += inputX * acc * dt;
        player.vx = THREE.MathUtils.clamp(player.vx, -maxSpdX, maxSpdX);
    } else {
        if (player.vx > 0) player.vx = Math.max(0, player.vx - fric * dt);
        if (player.vx < 0) player.vx = Math.min(0, player.vx + fric * dt);
    }

    if (inputZ !== 0) {
        player.vz += inputZ * acc * dt;
        player.vz = THREE.MathUtils.clamp(player.vz, -maxSpdZ, maxSpdZ);
    } else {
        if (player.vz > 0) player.vz = Math.max(0, player.vz - fric * dt);
        if (player.vz < 0) player.vz = Math.min(0, player.vz + fric * dt);
    }

    player.vy -= 60 * dt;
    player.vy = Math.max(player.vy, -30);

    player.position.x += player.vx * dt;
    player.box.setFromCenterAndSize(player.position, player.size);
    for (let p of platforms) {
        if (player.box.intersectsBox(p.box)) {
            if (player.vx > 0) player.position.x = p.box.min.x - player.size.x / 2;
            else if (player.vx < 0) player.position.x = p.box.max.x + player.size.x / 2;
            player.vx = 0;
            player.box.setFromCenterAndSize(player.position, player.size);
        }
    }

    player.position.z += player.vz * dt;
    player.box.setFromCenterAndSize(player.position, player.size);
    for (let p of platforms) {
        if (player.box.intersectsBox(p.box)) {
            if (player.vz > 0) player.position.z = p.box.min.z - player.size.z / 2;
            else if (player.vz < 0) player.position.z = p.box.max.z + player.size.z / 2;
            player.vz = 0;
            player.box.setFromCenterAndSize(player.position, player.size);
        }
    }

    player.position.y += player.vy * dt;
    player.box.setFromCenterAndSize(player.position, player.size);
    player.grounded = false;
    for (let p of platforms) {
        if (player.box.intersectsBox(p.box)) {
            if (player.vy < 0) {
                player.position.y = p.box.max.y + player.size.y / 2;
                player.grounded = true;
                if (player.isLongJumping) player.isLongJumping = false;
            } else if (player.vy > 0) {
                player.position.y = p.box.min.y - player.size.y / 2;
            }
            player.vy = 0;
            player.box.setFromCenterAndSize(player.position, player.size);
        }
    }

    player.group.position.copy(player.position);

    if (!player.grounded && player.isLongJumping) {
        player.group.rotation.x -= 15 * dt;
    } else {
        player.group.rotation.x = THREE.MathUtils.lerp(player.group.rotation.x, 0, 15 * dt);
    }

    if (player.grounded && (Math.abs(player.vx) > 1 || Math.abs(player.vz) > 1)) {
        player.group.position.y += Math.abs(Math.sin(globalTime * 20)) * 0.2;
    }

    if (player.position.y < -10) {
        gameState = 'GAMEOVER';
    }

    for (let i = goombas.length - 1; i >= 0; i--) {
        let g = goombas[i];
        if (g.dead) continue;

        g.x += g.dir * g.speed * dt;
        if (g.x > g.maxX) { g.x = g.maxX; g.dir = -1; }
        if (g.x < g.minX) { g.x = g.minX; g.dir = 1; }
        g.mesh.position.x = g.x;

        if (player.position.distanceTo(g.mesh.position) < 1.2) {
            let pBottom = player.position.y - player.size.y / 2;
            if (player.vy < 0 && pBottom > g.mesh.position.y - 0.2) {
                g.dead = true;
                player.vy = 14;
                score += 100;
                scene.remove(g.mesh);
                spawnParticles(g.mesh.position, 0x5C3A21, 8);
                goombas.splice(i, 1);
            } else {
                g.dead = true;
                scene.remove(g.mesh);
                goombas.splice(i, 1);
                lives--;
                if (lives <= 0) gameState = 'GAMEOVER';
            }
        }
    }

    for (let c of coins) {
        c.mesh.rotation.y += 3 * dt;
        if (!c.collected && player.position.distanceTo(c.mesh.position) < 1.5) {
            c.collected = true;
            score += 10;
            scene.remove(c.mesh);
            spawnParticles(c.mesh.position, 0xFFD700, 5);
        }
    }

    for (let o of oneUps) {
        if (!o.collected && player.position.distanceTo(o.mesh.position) < 1.5) {
            o.collected = true;
            lives++;
            score += 50;
            scene.remove(o.mesh);
            spawnParticles(o.mesh.position, 0x00FF00, 8);
        }
    }

    if (goal && player.position.distanceTo(goal.poleMesh.position) < 2.0) {
        gameState = 'WIN';
        score += 1000;
    }

    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.mesh.position.addScaledVector(p.vel, dt);
        p.life -= dt;
        p.mesh.scale.multiplyScalar(0.9);
        if (p.life <= 0) {
            scene.remove(p.mesh);
            particles.splice(i, 1);
        }
    }

    let targetCamX = player.position.x;
    let targetCamY = player.position.y + 6;
    let targetCamZ = player.position.z + 10;
    camera.position.x += (targetCamX - camera.position.x) * 5 * dt;
    camera.position.y += (targetCamY - camera.position.y) * 5 * dt;
    camera.position.z += (targetCamZ - camera.position.z) * 5 * dt;
    camera.lookAt(player.position.x, player.position.y + 1, player.position.z - 5);
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