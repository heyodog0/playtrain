let THREE;
let score = 0, lives = 1, gameState = 'PLAYING';
let blockGroup, fallingGroup;
let currentBlock, topBlockData;
let moveAxis, moveDir, speed;
let baseHue;
let actionPressed = false;
let towerHeight = 1;

function setup({ THREE: threeModule, renderer, width, height }) {
    THREE = threeModule;
    globalThis.scene = new THREE.Scene();
    globalThis.scene.background = new THREE.Color(0x202030);
    
    globalThis.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);
    
    globalThis.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const dl = new THREE.DirectionalLight(0xffffff, 0.8);
    dl.position.set(10, 20, 15);
    globalThis.scene.add(dl);

    blockGroup = new THREE.Group();
    globalThis.scene.add(blockGroup);

    fallingGroup = new THREE.Group();
    globalThis.scene.add(fallingGroup);
}

function update(dt) {
    updateFalling(dt);

    if (gameState !== 'PLAYING') return;

    const a = globalThis.currentAction;
    const isDrop = (a === 5 || a === 6 || a === 7); // Action D
    
    if (isDrop && !actionPressed) {
        actionPressed = true;
        handleDrop();
        if (gameState !== 'PLAYING') return; // Ended via drop
    } else if (!isDrop) {
        actionPressed = false;
    }

    // Move current block
    currentBlock.position[moveAxis] += moveDir * speed * dt;

    // Ping-pong movement
    const offset = currentBlock.position[moveAxis] - topBlockData[moveAxis];
    if (offset > 6 && moveDir === 1) {
        moveDir = -1;
    } else if (offset < -6 && moveDir === -1) {
        moveDir = 1;
    }

    // Smooth camera follow
    const targetY = towerHeight + 8;
    globalThis.camera.position.y += (targetY - globalThis.camera.position.y) * 4 * dt;
    globalThis.camera.lookAt(0, globalThis.camera.position.y - 8, 0);
}

function handleDrop() {
    const axis = moveAxis;
    const currentPos = currentBlock.position[axis];
    const topPos = topBlockData[axis];
    const currentDim = axis === 'x' ? topBlockData.w : topBlockData.d;
    const delta = currentPos - topPos;

    // Complete Miss
    if (Math.abs(delta) > currentDim) {
        gameState = 'GAMEOVER';
        lives = 0;
        blockGroup.remove(currentBlock);
        currentBlock.userData = { 
            vy: 0, 
            rx: (Math.random() - 0.5) * 5, 
            rz: (Math.random() - 0.5) * 5 
        };
        fallingGroup.add(currentBlock);
        return;
    }

    // Perfect Match Tolerance
    if (Math.abs(delta) <= 0.15) {
        currentBlock.position[axis] = topPos;
    } 
    // Slice
    else {
        const overlapSize = currentDim - Math.abs(delta);
        const overhangSize = Math.abs(delta);
        const newCenter = topPos + delta / 2;
        const overhangCenter = topPos + Math.sign(delta) * (currentDim / 2 + overhangSize / 2);

        // Update tracking data
        topBlockData[axis] = newCenter;
        if (axis === 'x') topBlockData.w = overlapSize;
        else topBlockData.d = overlapSize;

        // Resize placed block
        currentBlock.position[axis] = newCenter;
        currentBlock.geometry.dispose();
        currentBlock.geometry = new THREE.BoxGeometry(topBlockData.w, 1, topBlockData.d);

        // Generate falling overhang
        const overColor = currentBlock.material.color.clone();
        const overGeo = new THREE.BoxGeometry(
            axis === 'x' ? overhangSize : topBlockData.w,
            1,
            axis === 'z' ? overhangSize : topBlockData.d
        );
        const overMat = new THREE.MeshLambertMaterial({ color: overColor });
        const overhang = new THREE.Mesh(overGeo, overMat);

        overhang.position.copy(currentBlock.position);
        overhang.position[axis] = overhangCenter;
        overhang.userData = { 
            vy: -1, 
            rx: (Math.random() - 0.5) * 3, 
            rz: (Math.random() - 0.5) * 3 
        };
        fallingGroup.add(overhang);
    }

    // Prepare for next level
    score += 1;
    towerHeight += 1;
    speed = Math.min(speed + 0.3, 16);
    moveAxis = moveAxis === 'x' ? 'z' : 'x';
    moveDir = Math.random() > 0.5 ? 1 : -1;
    
    spawnNextBlock();
}

function spawnNextBlock() {
    const hue = (baseHue + towerHeight * 0.04) % 1.0;
    const color = new THREE.Color().setHSL(hue, 0.75, 0.6);
    const geo = new THREE.BoxGeometry(topBlockData.w, 1, topBlockData.d);
    const mat = new THREE.MeshLambertMaterial({ color });
    
    currentBlock = new THREE.Mesh(geo, mat);
    currentBlock.position.set(topBlockData.x, towerHeight, topBlockData.z);
    
    // Offset for entry
    currentBlock.position[moveAxis] = topBlockData[moveAxis] - moveDir * 6;
    
    blockGroup.add(currentBlock);
}

function updateFalling(dt) {
    for (let i = fallingGroup.children.length - 1; i >= 0; i--) {
        const f = fallingGroup.children[i];
        f.userData.vy -= 40 * dt; // Gravity
        f.position.y += f.userData.vy * dt;
        f.rotation.x += f.userData.rx * dt;
        f.rotation.z += f.userData.rz * dt;
        
        if (f.position.y < towerHeight - 30) {
            f.geometry.dispose();
            f.material.dispose();
            fallingGroup.remove(f);
        }
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
    actionPressed = false;
    towerHeight = 1;
    
    speed = 7 + Math.random() * 4;
    baseHue = Math.random();
    moveAxis = Math.random() > 0.5 ? 'x' : 'z';
    moveDir = Math.random() > 0.5 ? 1 : -1;
    
    topBlockData = { x: 0, z: 0, w: 5, d: 5 };

    // Clear existing blocks
    while(blockGroup.children.length > 0) {
        const b = blockGroup.children[0];
        if(b.geometry) b.geometry.dispose();
        if(b.material) b.material.dispose();
        blockGroup.remove(b);
    }
    while(fallingGroup.children.length > 0) {
        const f = fallingGroup.children[0];
        if(f.geometry) f.geometry.dispose();
        if(f.material) f.material.dispose();
        fallingGroup.remove(f);
    }

    // Construct base pillar
    const baseColor = new THREE.Color().setHSL(baseHue, 0.75, 0.6);
    const baseGeo = new THREE.BoxGeometry(topBlockData.w, 50, topBlockData.d);
    const baseMat = new THREE.MeshLambertMaterial({ color: baseColor });
    const baseBlock = new THREE.Mesh(baseGeo, baseMat);
    // Center at y = -24.5 so the top face aligns exactly at y = 0.5
    baseBlock.position.set(0, -24.5, 0); 
    blockGroup.add(baseBlock);

    spawnNextBlock();

    // Snap camera to start
    globalThis.camera.position.set(12, towerHeight + 8, 12);
    globalThis.camera.lookAt(0, towerHeight, 0);
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