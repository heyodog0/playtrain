let THREE, scene, camera, renderer;
let geos = {}, mats = {};
let score = 0, lives = 1, gameState = 'PLAYING';
let board = [[null,null,null,null], [null,null,null,null], [null,null,null,null], [null,null,null,null]];
let inputLocked = 0;
let dyingMeshes = [];
let scenery = [];

function setup({ THREE: threeArg, renderer: renArg, width, height }) {
    THREE = threeArg;
    renderer = renArg;
    
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    scene.fog = new THREE.Fog(0x1a1a2e, 5, 15);
    
    camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);
    camera.position.set(0, 6.5, 4.5);
    camera.lookAt(0, 0, -0.5);
    
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    let dl = new THREE.DirectionalLight(0xffffff, 0.8);
    dl.position.set(3, 10, 5);
    scene.add(dl);
    
    geos.box = new THREE.BoxGeometry(1, 1, 1);
    
    mats.board = new THREE.MeshLambertMaterial({ color: 0x333333 });
    mats.cell = new THREE.MeshLambertMaterial({ color: 0x222222 });
    
    let boardMesh = new THREE.Mesh(geos.box, mats.board);
    boardMesh.scale.set(4.7, 0.2, 4.7);
    boardMesh.position.y = -0.1;
    scene.add(boardMesh);
    
    for (let x = 0; x < 4; x++) {
        for (let z = 0; z < 4; z++) {
            let cell = new THREE.Mesh(geos.box, mats.cell);
            cell.scale.set(1.0, 0.22, 1.0);
            cell.position.set((x - 1.5) * 1.1, -0.1, (z - 1.5) * 1.1);
            scene.add(cell);
        }
    }
}

function getTileMaterial(val) {
    if (!mats[val]) {
        let power = Math.log2(val);
        let h = Math.max(0, 0.6 - (power - 1) * 0.055);
        let color = new THREE.Color().setHSL(h, 0.8, 0.6);
        mats[val] = new THREE.MeshLambertMaterial({ color: color });
    }
    return mats[val];
}

function spawnTile() {
    let empty = [];
    for(let x=0; x<4; x++) {
        for(let z=0; z<4; z++) {
            if(!board[x][z]) empty.push({x,z});
        }
    }
    if(empty.length === 0) return;
    
    let spot = empty[Math.floor(Math.random() * empty.length)];
    let val = Math.random() < 0.9 ? 2 : 4;
    
    let mesh = new THREE.Mesh(geos.box, getTileMaterial(val));
    let tX = (spot.x - 1.5) * 1.1;
    let tZ = (spot.z - 1.5) * 1.1;
    mesh.position.set(tX, 0.2, tZ);
    mesh.scale.set(0, 0, 0); 
    mesh.userData = { tX: tX, tZ: tZ };
    scene.add(mesh);
    
    board[spot.x][spot.z] = {
        val: val,
        mesh: mesh,
        xIdx: spot.x,
        zIdx: spot.z
    };
}

function checkGameOver() {
    for(let x=0; x<4; x++) {
        for(let z=0; z<4; z++) {
            if(!board[x][z]) return;
        }
    }
    for(let x=0; x<4; x++) {
        for(let z=0; z<4; z++) {
            let v = board[x][z].val;
            if(x < 3 && board[x+1][z] && board[x+1][z].val === v) return;
            if(z < 3 && board[x][z+1] && board[x][z+1].val === v) return;
        }
    }
    gameState = 'GAMEOVER';
}

function resetGame(seed) {
    Math.random = mulberry32(seed >>> 0);
    score = 0;
    lives = 1;
    gameState = 'PLAYING';
    inputLocked = 0;
    
    for(let x=0; x<4; x++) {
        for(let z=0; z<4; z++) {
            if(board[x][z]) scene.remove(board[x][z].mesh);
            board[x][z] = null;
        }
    }
    
    for (let dm of dyingMeshes) scene.remove(dm);
    dyingMeshes = [];
    
    for (let s of scenery) scene.remove(s);
    scenery = [];
    
    for (let i = 0; i < 12; i++) {
        let val = Math.pow(2, Math.floor(Math.random() * 10) + 1);
        let sMesh = new THREE.Mesh(geos.box, getTileMaterial(val));
        let angle = Math.random() * Math.PI * 2;
        let dist = 4.5 + Math.random() * 4;
        sMesh.position.set(Math.cos(angle)*dist, -0.5 + Math.random(), Math.sin(angle)*dist - 1);
        sMesh.scale.setScalar(0.3 + Math.random() * 0.6);
        sMesh.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, 0);
        scene.add(sMesh);
        scenery.push(sMesh);
    }
    
    spawnTile();
    spawnTile();
}

function update(dt) {
    if (gameState !== 'PLAYING') return;
    dt = Math.min(dt, 0.1);
    
    if (inputLocked <= 0) {
        let a = globalThis.currentAction;
        if (a >= 1 && a <= 4) {
            let moved = false;
            let dir = a;
            
            for (let i = 0; i < 4; i++) {
                let line = [];
                for(let step=0; step<4; step++) {
                    let x, z;
                    if(dir === 1) { x = step; z = i; }
                    else if(dir === 2) { x = 3 - step; z = i; }
                    else if(dir === 3) { x = i; z = step; }
                    else if(dir === 4) { x = i; z = 3 - step; }
                    
                    if(board[x][z]) {
                        line.push(board[x][z]);
                        board[x][z] = null;
                    }
                }
                
                let newLine = [];
                let k = 0;
                while(k < line.length) {
                    if (k < line.length - 1 && line[k].val === line[k+1].val) {
                        newLine.push({ 
                            val: line[k].val * 2, 
                            mesh: line[k].mesh, 
                            mergedMesh: line[k+1].mesh,
                            xIdx: line[k].xIdx,
                            zIdx: line[k].zIdx
                        });
                        score += line[k].val * 2;
                        k += 2;
                    } else {
                        newLine.push(line[k]);
                        k++;
                    }
                }
                
                for(let step=0; step<newLine.length; step++) {
                    let x, z;
                    if(dir === 1) { x = step; z = i; }
                    else if(dir === 2) { x = 3 - step; z = i; }
                    else if(dir === 3) { x = i; z = step; }
                    else if(dir === 4) { x = i; z = 3 - step; }
                    
                    let tile = newLine[step];
                    board[x][z] = tile;
                    
                    if (tile.xIdx !== x || tile.zIdx !== z || tile.mergedMesh) {
                        moved = true;
                    }
                    
                    tile.xIdx = x;
                    tile.zIdx = z;
                    tile.mesh.userData.tX = (x - 1.5) * 1.1;
                    tile.mesh.userData.tZ = (z - 1.5) * 1.1;
                    
                    if (tile.mergedMesh) {
                        tile.mergedMesh.userData.tX = tile.mesh.userData.tX;
                        tile.mergedMesh.userData.tZ = tile.mesh.userData.tZ;
                        dyingMeshes.push(tile.mergedMesh);
                        tile.mergedMesh = null;
                        
                        tile.mesh.material = getTileMaterial(tile.val);
                        tile.mesh.scale.set(1.3, 0.6, 1.3);
                    }
                }
            }
            
            if (moved) {
                spawnTile();
                inputLocked = 0.15;
                checkGameOver();
            }
        }
    }
    
    if (inputLocked > 0) {
        inputLocked -= dt;
        if (inputLocked <= 0) {
            for(let x=0; x<4; x++) {
                for(let z=0; z<4; z++) {
                    let tile = board[x][z];
                    if(tile) {
                        tile.mesh.position.x = tile.mesh.userData.tX;
                        tile.mesh.position.z = tile.mesh.userData.tZ;
                    }
                }
            }
            for (let dm of dyingMeshes) scene.remove(dm);
            dyingMeshes = [];
        }
    }
    
    for (let i = dyingMeshes.length - 1; i >= 0; i--) {
        let dm = dyingMeshes[i];
        dm.position.x = THREE.MathUtils.lerp(dm.position.x, dm.userData.tX, 20 * dt);
        dm.position.z = THREE.MathUtils.lerp(dm.position.z, dm.userData.tZ, 20 * dt);
        dm.scale.x *= (1 - 10 * dt);
        dm.scale.y *= (1 - 10 * dt);
        dm.scale.z *= (1 - 10 * dt);
        if (dm.scale.x < 0.05) {
            scene.remove(dm);
            dyingMeshes.splice(i, 1);
        }
    }
    
    for(let x=0; x<4; x++) {
        for(let z=0; z<4; z++) {
            let tile = board[x][z];
            if(tile) {
                let m = tile.mesh;
                m.position.x = THREE.MathUtils.lerp(m.position.x, m.userData.tX, 20 * dt);
                m.position.z = THREE.MathUtils.lerp(m.position.z, m.userData.tZ, 20 * dt);
                
                m.scale.x = THREE.MathUtils.lerp(m.scale.x, 1.0, 15 * dt);
                m.scale.y = THREE.MathUtils.lerp(m.scale.y, 0.4, 15 * dt);
                m.scale.z = THREE.MathUtils.lerp(m.scale.z, 1.0, 15 * dt);
            }
        }
    }
    
    for (let s of scenery) {
        s.rotation.y += 0.5 * dt;
        s.rotation.x += 0.3 * dt;
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