let THREE, scene, camera, renderer;
let geos = {}, mats = {};
let score = 0, lives = 3, gameState = 'PLAYING';

let player, swordPivot, swordMesh, shieldMesh;
let enemies = [], items = [], environment = [], colliders = [];
let dungeonPad;

let isAttacking = false;
let attackTimer = 0;
let isShielding = false;
let invulnTimer = 0;
let enemiesHitThisSwing = new Set();

let timeAcc = 0;

function setup({ THREE: threeArg, renderer: renArg, width, height }) {
    THREE = threeArg;
    renderer = renArg;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    scene.fog = new THREE.Fog(0x1a1a2e, 20, 80);

    camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 150);

    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    let dl = new THREE.DirectionalLight(0xffffff, 0.8);
    dl.position.set(20, 30, 10);
    scene.add(dl);
    let dl2 = new THREE.DirectionalLight(0xaaaaaa, 0.3);
    dl2.position.set(-20, 10, -10);
    scene.add(dl2);

    // Geometries
    geos.cylinder = new THREE.CylinderGeometry(0.4, 0.4, 1, 8);
    geos.sphere = new THREE.SphereGeometry(0.35, 8, 8);
    geos.sword = new THREE.BoxGeometry(0.1, 0.1, 1.4);
    geos.shield = new THREE.BoxGeometry(0.6, 0.6, 0.1);
    geos.trunk = new THREE.CylinderGeometry(0.3, 0.4, 1.2, 6);
    geos.leaves = new THREE.ConeGeometry(1.4, 3.5, 6);
    geos.rock = new THREE.DodecahedronGeometry(0.8, 0);
    geos.enemy = new THREE.BoxGeometry(1, 1, 1);
    geos.rupee = new THREE.OctahedronGeometry(0.3, 0);
    geos.heart = new THREE.OctahedronGeometry(0.3, 0);
    geos.pad = new THREE.CylinderGeometry(2, 2, 0.2, 16);
    geos.floor = new THREE.BoxGeometry(1, 1, 1); // scalable

    // Materials
    mats.player = new THREE.MeshLambertMaterial({color: 0x228b22}); // Green tunic
    mats.skin = new THREE.MeshLambertMaterial({color: 0xffe4c4});
    mats.sword = new THREE.MeshLambertMaterial({color: 0xdddddd});
    mats.shield = new THREE.MeshLambertMaterial({color: 0x8b4513});
    mats.wood = new THREE.MeshLambertMaterial({color: 0x4a3c31});
    mats.leaves = new THREE.MeshLambertMaterial({color: 0x114a11});
    mats.stone = new THREE.MeshLambertMaterial({color: 0x666666});
    mats.enemy = new THREE.MeshLambertMaterial({color: 0xaa0000}); // Red boxes
    mats.rupee = new THREE.MeshLambertMaterial({color: 0x00ffff}); // Cyan
    mats.heart = new THREE.MeshLambertMaterial({color: 0xff0000}); // Red
    mats.grass1 = new THREE.MeshLambertMaterial({color: 0x3cb371});
    mats.grass2 = new THREE.MeshLambertMaterial({color: 0x2e8b57});
    mats.road = new THREE.MeshLambertMaterial({color: 0x8b7355});
    mats.pad = new THREE.MeshBasicMaterial({color: 0xffd700}); // Glowing yellow

    // Player Object
    player = new THREE.Group();
    let body = new THREE.Mesh(geos.cylinder, mats.player);
    body.position.y = 0.5;
    player.add(body);
    let head = new THREE.Mesh(geos.sphere, mats.skin);
    head.position.y = 1.2;
    player.add(head);

    swordPivot = new THREE.Group();
    swordPivot.position.set(0, 0.5, 0);
    swordMesh = new THREE.Mesh(geos.sword, mats.sword);
    swordMesh.position.set(0, 0, 0.8); // Points along local +Z (forward)
    swordPivot.add(swordMesh);
    player.add(swordPivot);

    shieldMesh = new THREE.Mesh(geos.shield, mats.shield);
    shieldMesh.position.set(0, 0.5, 0.55);
    player.add(shieldMesh);

    scene.add(player);
}

function clearScene() {
    for (let e of enemies) scene.remove(e.mesh);
    for (let i of items) scene.remove(i.mesh);
    for (let e of environment) scene.remove(e.mesh);
    enemies = [];
    items = [];
    environment = [];
    colliders = [];
}

function isWalkable(x, z) {
    const m = 0.35; // player physical radius
    const areas = [
        { minX: -20+m, maxX: 20-m, minZ: -20, maxZ: 20-m },       // Field
        { minX: -4+m,  maxX: 4-m,  minZ: -30, maxZ: -20 },        // Path 1
        { minX: -15+m, maxX: 15-m, minZ: -70, maxZ: -30 },        // Forest
        { minX: -4+m,  maxX: 4-m,  minZ: -80, maxZ: -70 },        // Path 2
        { minX: -10+m, maxX: 10-m, minZ: -110+m, maxZ: -80 }      // Dungeon entrance
    ];
    for (let a of areas) {
        if (x >= a.minX && x <= a.maxX && z >= a.minZ && z <= a.maxZ) return true;
    }
    return false;
}

function checkCollision(nx, nz) {
    if (!isWalkable(nx, nz)) return true;
    for (let c of colliders) {
        if (Math.abs(nx - c.x) < c.r + 0.3 && Math.abs(nz - c.z) < c.r + 0.3) return true;
    }
    return false;
}

function getRandomPointInArea(minX, maxX, minZ, maxZ) {
    for (let i = 0; i < 20; i++) {
        let x = minX + 1 + Math.random() * (maxX - minX - 2);
        let z = minZ + 1 + Math.random() * (maxZ - minZ - 2);
        // keep clear of central paths to avoid blocking progression
        if (Math.abs(x) < 5 && (Math.abs(z - minZ) < 6 || Math.abs(z - maxZ) < 6)) continue;
        // keep clear of spawn point
        if (Math.abs(x) < 4 && Math.abs(z - 15) < 4) continue;
        return { x, z };
    }
    return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
}

function addFloor(cx, cz, w, d, mat) {
    let mesh = new THREE.Mesh(geos.floor, mat);
    mesh.scale.set(w, 1, d);
    mesh.position.set(cx, -0.5, cz);
    scene.add(mesh);
    environment.push({ mesh });
}

function addTree(x, z) {
    let group = new THREE.Group();
    let trunk = new THREE.Mesh(geos.trunk, mats.wood);
    trunk.position.y = 0.6;
    let leaves = new THREE.Mesh(geos.leaves, mats.leaves);
    leaves.position.y = 2.4;
    group.add(trunk);
    group.add(leaves);
    group.position.set(x, 0, z);
    
    // Slight random variation
    let s = 0.8 + Math.random() * 0.4;
    group.scale.set(s, s, s);
    group.rotation.y = Math.random() * Math.PI;

    scene.add(group);
    environment.push({ mesh: group });
    colliders.push({ x, z, r: 0.6 * s });
}

function addRock(x, z) {
    let rock = new THREE.Mesh(geos.rock, mats.stone);
    rock.position.set(x, 0.4, z);
    let s = 0.8 + Math.random() * 0.6;
    rock.scale.set(s, s * 0.8, s);
    rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
    scene.add(rock);
    environment.push({ mesh: rock });
    colliders.push({ x, z, r: 0.7 * s });
}

function addEnemy(x, z, size, hp, bounds) {
    let mesh = new THREE.Mesh(geos.enemy, mats.enemy);
    mesh.scale.set(size, size, size);
    mesh.position.set(x, size / 2, z);
    scene.add(mesh);
    enemies.push({
        mesh, hp, size, bounds,
        targetX: x, targetZ: z, timer: 0
    });
}

function addRupee(x, z) {
    let mesh = new THREE.Mesh(geos.rupee, mats.rupee);
    mesh.position.set(x, 0.6, z);
    scene.add(mesh);
    items.push({ mesh, type: 'rupee' });
}

function addHeart(x, z) {
    let mesh = new THREE.Mesh(geos.heart, mats.heart);
    mesh.position.set(x, 0.6, z);
    scene.add(mesh);
    items.push({ mesh, type: 'heart' });
}

function populateArea(minX, maxX, minZ, maxZ, config) {
    const bounds = { minX, maxX, minZ, maxZ };
    for (let i = 0; i < config.trees; i++) {
        let p = getRandomPointInArea(minX, maxX, minZ, maxZ);
        addTree(p.x, p.z);
    }
    for (let i = 0; i < config.rocks; i++) {
        let p = getRandomPointInArea(minX, maxX, minZ, maxZ);
        addRock(p.x, p.z);
    }
    for (let i = 0; i < config.enemies; i++) {
        let p = getRandomPointInArea(minX, maxX, minZ, maxZ);
        let size = config.bigEnemies ? 1.5 : 1.0;
        let hp = config.bigEnemies ? 3 : 1;
        addEnemy(p.x, p.z, size, hp, bounds);
    }
    for (let i = 0; i < config.rupees; i++) {
        let p = getRandomPointInArea(minX, maxX, minZ, maxZ);
        addRupee(p.x, p.z);
    }
    for (let i = 0; i < config.hearts; i++) {
        let p = getRandomPointInArea(minX, maxX, minZ, maxZ);
        addHeart(p.x, p.z);
    }
}

function resetGame(seed) {
    Math.random = mulberry32(seed >>> 0);
    score = 0;
    lives = 3;
    gameState = 'PLAYING';
    
    isAttacking = false;
    attackTimer = 0;
    isShielding = false;
    invulnTimer = 0;
    timeAcc = 0;

    clearScene();

    // Map zones
    addFloor(0, 0, 40, 40, mats.grass1);     // Area 1: Field
    addFloor(0, -25, 8, 10, mats.road);      // Path 1
    addFloor(0, -50, 30, 40, mats.grass2);   // Area 2: Forest
    addFloor(0, -75, 8, 10, mats.road);      // Path 2
    addFloor(0, -95, 20, 30, mats.stone);    // Area 3: Dungeon Entrance

    dungeonPad = new THREE.Mesh(geos.pad, mats.pad);
    dungeonPad.position.set(0, 0.1, -105);
    scene.add(dungeonPad);
    environment.push({ mesh: dungeonPad });

    populateArea(-18, 18, -18, 18, { trees: 8, rocks: 5, enemies: 5, rupees: 6, hearts: 1, bigEnemies: false });
    populateArea(-13, 13, -68, -32, { trees: 18, rocks: 3, enemies: 8, rupees: 5, hearts: 1, bigEnemies: false });
    populateArea(-8, 8, -100, -82, { trees: 0, rocks: 4, enemies: 2, rupees: 3, hearts: 1, bigEnemies: true });

    // Decorative border trees (creates visually bounded forest)
    for (let i = 0; i < 200; i++) {
        let tx = (Math.random() - 0.5) * 100;
        let tz = 15 - Math.random() * 140;
        if (!isWalkable(tx, tz) && !isWalkable(tx, tz + 4) && !isWalkable(tx, tz - 4)) {
            addTree(tx, tz);
        }
    }

    player.position.set(0, 0, 15);
    player.rotation.y = Math.PI; // Face -Z

    camera.position.set(0, 15, 30);
    camera.lookAt(player.position);
}

function angleDifference(a, b) {
    let diff = (a - b + Math.PI) % (2 * Math.PI) - Math.PI;
    return diff < -Math.PI ? diff + 2 * Math.PI : diff;
}

function update(dt) {
    if (gameState !== 'PLAYING') return;
    if (dt > 0.1) dt = 0.1;
    timeAcc += dt;

    let a = globalThis.currentAction;
    let dx = 0, dz = 0;
    let tryAttack = false;
    isShielding = false;

    // Decode action
    if (a === 1 || a === 5 || a === 7 || a === 11) dx = -1;
    if (a === 2 || a === 6 || a === 8 || a === 12) dx = 1;
    if (a === 3 || a === 5 || a === 6 || a === 13) dz = -1; // UP moves -Z
    if (a === 4 || a === 7 || a === 8 || a === 14) dz = 1;  // DOWN moves +Z
    if (a === 9 || (a >= 11 && a <= 14)) tryAttack = true;
    if (a === 10) isShielding = true;

    // Movement
    let speed = isShielding ? 4 : 8;
    if (dx !== 0 || dz !== 0) {
        let dist = Math.sqrt(dx * dx + dz * dz);
        let moveX = (dx / dist) * speed * dt;
        let moveZ = (dz / dist) * speed * dt;

        if (!checkCollision(player.position.x + moveX, player.position.z)) {
            player.position.x += moveX;
        }
        if (!checkCollision(player.position.x, player.position.z + moveZ)) {
            player.position.z += moveZ;
        }

        let targetAngle = Math.atan2(dx, dz);
        let angleDiff = angleDifference(targetAngle, player.rotation.y);
        player.rotation.y += angleDiff * 12 * dt;
    }

    // Shielding state
    shieldMesh.visible = isShielding;

    // Attacking state
    if (tryAttack && !isAttacking) {
        isAttacking = true;
        attackTimer = 0.25;
        enemiesHitThisSwing = new Set();
    }

    if (isAttacking) {
        attackTimer -= dt;
        let progress = 1 - (attackTimer / 0.25);
        if (progress > 1) progress = 1;
        
        swordPivot.rotation.y = -Math.PI / 2.5 + (Math.PI / 1.25) * progress;
        swordMesh.visible = true;

        // Weapon collision with enemies
        for (let i = enemies.length - 1; i >= 0; i--) {
            let e = enemies[i];
            if (!enemiesHitThisSwing.has(e)) {
                let dist = player.position.distanceTo(e.mesh.position);
                if (dist < 3.5) {
                    let angleToEnemy = Math.atan2(e.mesh.position.x - player.position.x, e.mesh.position.z - player.position.z);
                    let angleDiff = Math.abs(angleDifference(angleToEnemy, player.rotation.y));
                    if (angleDiff < Math.PI / 2.5) {
                        e.hp--;
                        enemiesHitThisSwing.add(e);
                        // Knockback
                        e.mesh.position.x += Math.sin(angleToEnemy) * 2.0;
                        e.mesh.position.z += Math.cos(angleToEnemy) * 2.0;
                        
                        if (e.hp <= 0) {
                            scene.remove(e.mesh);
                            enemies.splice(i, 1);
                            score += 5;
                        }
                    }
                }
            }
        }

        if (attackTimer <= 0) {
            isAttacking = false;
            swordMesh.visible = false;
        }
    } else {
        swordMesh.visible = false;
        swordPivot.rotation.y = 0;
    }

    // Invulnerability blinking
    if (invulnTimer > 0) {
        invulnTimer -= dt;
        player.visible = (Math.floor(invulnTimer * 12) % 2 === 0);
    } else {
        player.visible = true;
    }

    // Enemy AI & Player Damage
    for (let e of enemies) {
        // Wandering logic
        if (e.timer > 0) e.timer -= dt;
        else {
            e.targetX = e.bounds.minX + 1 + Math.random() * (e.bounds.maxX - e.bounds.minX - 2);
            e.targetZ = e.bounds.minZ + 1 + Math.random() * (e.bounds.maxZ - e.bounds.minZ - 2);
            e.timer = 1.5 + Math.random() * 2.5;
        }

        let edx = e.targetX - e.mesh.position.x;
        let edz = e.targetZ - e.mesh.position.z;
        let edist = Math.sqrt(edx * edx + edz * edz);
        if (edist > 0.1) {
            e.mesh.position.x += (edx / edist) * 2.5 * dt;
            e.mesh.position.z += (edz / edist) * 2.5 * dt;
            e.mesh.rotation.y = Math.atan2(edx, edz);
        }

        // Damage Player
        if (invulnTimer <= 0) {
            let distToPlayer = player.position.distanceTo(e.mesh.position);
            if (distToPlayer < e.size / 2 + 0.6) {
                let angleToPlayer = Math.atan2(player.position.x - e.mesh.position.x, player.position.z - e.mesh.position.z);
                let angleDiff = Math.abs(angleDifference(angleToPlayer + Math.PI, player.rotation.y));
                
                if (isShielding && angleDiff < Math.PI / 2) {
                    // Blocked! Knock enemy back
                    e.mesh.position.x -= Math.sin(angleToPlayer) * 1.5;
                    e.mesh.position.z -= Math.cos(angleToPlayer) * 1.5;
                } else {
                    // Hurt
                    lives--;
                    invulnTimer = 1.2;
                    let kbX = -Math.sin(angleToPlayer) * 1.5;
                    let kbZ = -Math.cos(angleToPlayer) * 1.5;
                    if (!checkCollision(player.position.x + kbX, player.position.z)) player.position.x += kbX;
                    if (!checkCollision(player.position.x, player.position.z + kbZ)) player.position.z += kbZ;
                    
                    if (lives <= 0) gameState = 'GAMEOVER';
                }
            }
        }
    }

    // Items
    for (let i = items.length - 1; i >= 0; i--) {
        let item = items[i];
        item.mesh.rotation.y += 2.5 * dt;
        item.mesh.position.y = 0.6 + Math.sin(timeAcc * 4 + item.mesh.position.x) * 0.15;
        
        if (item.mesh.position.distanceTo(player.position) < 1.5) {
            if (item.type === 'rupee') score += 1;
            if (item.type === 'heart') lives = Math.min(3, lives + 1);
            scene.remove(item.mesh);
            items.splice(i, 1);
        }
    }

    // Dungeon Pad Win Condition
    dungeonPad.rotation.y += dt * 0.5;
    if (player.position.distanceTo(dungeonPad.position) < 2.5) {
        gameState = 'WIN';
    }

    // Camera smoothly tracks player
    let camTargetX = player.position.x;
    let camTargetY = player.position.y + 14;
    let camTargetZ = player.position.z + 16;
    
    camera.position.x += (camTargetX - camera.position.x) * 5 * dt;
    camera.position.y += (camTargetY - camera.position.y) * 5 * dt;
    camera.position.z += (camTargetZ - camera.position.z) * 5 * dt;
    
    camera.lookAt(player.position);
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