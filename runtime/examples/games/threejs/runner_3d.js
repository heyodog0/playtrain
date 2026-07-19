let THREE;
let scene, camera, renderer;
let player, shadow;
let objects = [];
let groundLines = [];

// Game state
let score = 0;
let distanceScore = 0;
let lives = 1;
let gameState = 'PLAYING';
let frame = 0;

// Movement & Logic State
let lane = 0; // -1 (Left), 0 (Center), 1 (Right)
let laneWidth = 3.0;
let lastAction = 0;
let yVel = 0;
let gravity = -35; 
let jumpForce = 13;
let isSliding = false;
let slideTimer = 0;
let baseHeight = 1.0; 
let speed = 20;
let distanceSinceLastSpawn = 0;

// Cached Geometries & Materials (for performance)
let geoLow, matLow;
let geoHigh, matHigh;
let geoWall, matWall;
let geoGem, matGem;

function setup(env) {
    THREE = env.THREE;
    renderer = env.renderer;
    const width = env.width;
    const height = env.height;

    globalThis.scene = new THREE.Scene();
    globalThis.scene.background = new THREE.Color(0x87CEEB);
    scene = globalThis.scene;

    globalThis.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 200);
    camera = globalThis.camera;
    camera.position.set(0, 5, 7);
    camera.lookAt(0, 1.5, -10);

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const dl = new THREE.DirectionalLight(0xffffff, 0.9);
    dl.position.set(-10, 20, 10);
    scene.add(dl);

    // Ground
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 300), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.z = -100;
    scene.add(ground);

    // Lane separators
    const lineMat = new THREE.MeshBasicMaterial({ color: 0x666666 });
    for (let i = -1; i <= 1; i += 2) {
        const line = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 300), lineMat);
        line.rotation.x = -Math.PI / 2;
        line.position.set(i * (laneWidth / 2), 0.01, -100);
        scene.add(line);
    }

    // Moving ground lines for sense of speed
    const moveLineMat = new THREE.MeshBasicMaterial({ color: 0xaaaaaa });
    for (let i = 0; i < 25; i++) {
        const line = new THREE.Mesh(new THREE.PlaneGeometry(12, 0.3), moveLineMat);
        line.rotation.x = -Math.PI / 2;
        line.position.set(0, 0.02, -i * 6);
        scene.add(line);
        groundLines.push(line);
    }

    // Player
    player = new THREE.Mesh(
        new THREE.BoxGeometry(1, 2, 1),
        new THREE.MeshLambertMaterial({ color: 0x00ccff })
    );
    scene.add(player);

    // Drop shadow
    shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ color: 0x111111 })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.03;
    scene.add(shadow);

    // Pre-create geometry/materials for obstacles to prevent GC pauses
    geoLow = new THREE.BoxGeometry(1.5, 1, 1);
    matLow = new THREE.MeshLambertMaterial({ color: 0xff6600 }); // Orange
    geoHigh = new THREE.BoxGeometry(1.5, 1, 1);
    matHigh = new THREE.MeshLambertMaterial({ color: 0x9900ff }); // Purple
    geoWall = new THREE.BoxGeometry(1.5, 3, 1);
    matWall = new THREE.MeshLambertMaterial({ color: 0xff0000 }); // Red
    geoGem = new THREE.OctahedronGeometry(0.4);
    matGem = new THREE.MeshLambertMaterial({ color: 0xffd700 }); // Gold
}

function spawnRow() {
    const dist = -80;
    const lanes = [-1, 0, 1];
    
    // Shuffle lanes
    for (let i = 2; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
    }

    // Determine obstacle/gem count pattern
    const r = Math.random();
    let obsCount = 1;
    let gemCount = 1;
    if (r < 0.1) { obsCount = 0; gemCount = 3; }
    else if (r < 0.5) { obsCount = 1; gemCount = 1; }
    else if (r < 0.85) { obsCount = 2; gemCount = 1; }
    else { obsCount = 2; gemCount = 0; }

    for (let i = 0; i < 3; i++) {
        const laneIdx = lanes[i];
        const xPos = laneIdx * laneWidth;

        if (i < obsCount) {
            // Spawn Obstacle
            const typeR = Math.random();
            let type, geo, mat, yPos, w, h, d;
            
            if (typeR < 0.35) {
                type = 'low';
                geo = geoLow; mat = matLow;
                w = 1.5; h = 1; d = 1; yPos = 0.5;
            } else if (typeR < 0.70) {
                type = 'high';
                geo = geoHigh; mat = matHigh;
                w = 1.5; h = 1; d = 1; yPos = 2.0; 
            } else {
                type = 'wall';
                geo = geoWall; mat = matWall;
                w = 1.5; h = 3; d = 1; yPos = 1.5;
            }
            
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(xPos, yPos, dist);
            scene.add(mesh);
            objects.push({ mesh, type, w, h, d, collected: false });
            
        } else if (i < obsCount + gemCount) {
            // Spawn Gem
            const mesh = new THREE.Mesh(geoGem, matGem);
            // Randomize gem height (grounded or jump-height)
            const yPos = Math.random() > 0.5 ? 0.6 : 2.5;
            mesh.position.set(xPos, yPos, dist);
            scene.add(mesh);
            objects.push({ mesh, type: 'gem', w: 0.6, h: 0.6, d: 0.6, collected: false });
        }
    }
}

function update(dt) {
    if (gameState !== 'PLAYING') return;
    frame++;

    const a = globalThis.currentAction;

    // Lateral Movement (Lane switching)
    if (a === 1 && lastAction !== 1 && lane > -1) lane--;
    if (a === 2 && lastAction !== 2 && lane < 1) lane++;

    // Vertical Movement (Jump and Slide)
    if (a === 3 && player.position.y === baseHeight && !isSliding) {
        yVel = jumpForce; // Jump
    }
    
    if (a === 4) {
        if (player.position.y > baseHeight) {
            yVel -= 100 * dt; // Fast-fall / Slam
        } else if (!isSliding) {
            isSliding = true;
            slideTimer = 0.75;
            player.scale.y = 0.5; // Visual duck
            player.position.y = baseHeight / 2;
        }
    }

    lastAction = a;

    // Apply horizontal physics (lerp for smooth visually, hitbox is exact)
    const targetX = lane * laneWidth;
    player.position.x += (targetX - player.position.x) * 15 * dt;

    // Apply vertical physics
    if (player.position.y > baseHeight || yVel !== 0) {
        yVel += gravity * dt;
        player.position.y += yVel * dt;
        
        // Ground collision
        if (player.position.y <= baseHeight && !isSliding) {
            player.position.y = baseHeight;
            yVel = 0;
        } else if (player.position.y <= baseHeight / 2 && isSliding) {
            player.position.y = baseHeight / 2;
            yVel = 0;
        }
    }

    // Slide timer
    if (isSliding) {
        slideTimer -= dt;
        if (slideTimer <= 0) {
            isSliding = false;
            player.scale.y = 1.0;
            player.position.y = player.position.y > baseHeight ? player.position.y : baseHeight;
        }
    }

    // Shadow logic
    shadow.position.x = player.position.x;
    const shadowScale = Math.max(0.2, 1.0 - (player.position.y - baseHeight) / 3.0);
    shadow.scale.set(shadowScale, shadowScale, 1);

    // World & Spawning logic
    distanceSinceLastSpawn += speed * dt;
    if (distanceSinceLastSpawn > 18) {
        spawnRow();
        distanceSinceLastSpawn = 0;
    }

    // Distance Score
    distanceScore += speed * dt;
    if (distanceScore >= 10) {
        score += 1;
        distanceScore = 0;
    }

    // Moving ground lines
    for (const line of groundLines) {
        line.position.z += speed * dt;
        if (line.position.z > 10) {
            line.position.z -= 150;
        }
    }

    // Player AABB Bounds
    const px = player.position.x;
    const py = player.position.y;
    const pz = player.position.z;
    const pw = 0.8;
    const ph = isSliding ? 1.0 : 2.0;
    const pd = 0.8;

    // Update Objects & Collision Detection
    for (let i = objects.length - 1; i >= 0; i--) {
        const obj = objects[i];
        obj.mesh.position.z += speed * dt;

        if (obj.type === 'gem') {
            obj.mesh.rotation.y += 3 * dt;
            obj.mesh.rotation.x += 2 * dt;
        }

        // Collision Check (AABB)
        const mx = obj.mesh.position.x;
        const my = obj.mesh.position.y;
        const mz = obj.mesh.position.z;

        // Make bounds slightly forgiving (-0.15 margin)
        const collisionX = Math.abs(px - mx) < (pw / 2 + obj.w / 2 - 0.15);
        const collisionY = Math.abs(py - my) < (ph / 2 + obj.h / 2 - 0.15);
        const collisionZ = Math.abs(pz - mz) < (pd / 2 + obj.d / 2 - 0.15);

        if (collisionX && collisionY && collisionZ && !obj.collected) {
            if (obj.type === 'gem') {
                score += 10;
                obj.collected = true;
                scene.remove(obj.mesh);
            } else {
                lives--;
                gameState = 'GAMEOVER';
            }
        }

        // Cleanup passed objects
        if (mz > 10) {
            if (!obj.collected) scene.remove(obj.mesh);
            objects.splice(i, 1);
        }
    }

    // Gradually increase speed
    speed += 0.3 * dt;
    if (speed > 50) speed = 50;
}

function render() {
    globalThis.renderer.render(globalThis.scene, globalThis.camera);
}

function resetGame(seed) {
    Math.random = mulberry32(seed >>> 0);
    score = 0;
    distanceScore = 0;
    lives = 1;
    gameState = 'PLAYING';
    frame = 0;
    
    lane = 0;
    lastAction = 0;
    yVel = 0;
    isSliding = false;
    slideTimer = 0;
    speed = 22;
    distanceSinceLastSpawn = 0;

    player.position.set(0, baseHeight, 0);
    player.scale.set(1, 1, 1);

    for (const obj of objects) {
        scene.remove(obj.mesh);
    }
    objects = [];

    // Reset ground lines
    for (let i = 0; i < groundLines.length; i++) {
        groundLines[i].position.z = -i * 6;
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