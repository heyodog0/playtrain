let THREE, scene, camera, renderer;
let geos = {}, mats = {};
let score = 0, lives = 1, gameState = 'PLAYING';

let snake = [];
let obstacles = [];
let food = null;

let moveTimer = 0;
let moveInterval = 0.15;
let currentDir = { x: 1, z: 0 };
let nextDir = { x: 1, z: 0 };

const BOARD_SIZE = 10;

function setup({ THREE: threeArg, renderer: renArg, width, height }) {
    THREE = threeArg;
    renderer = renArg;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111);

    camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);
    
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const dl = new THREE.DirectionalLight(0xffffff, 0.8);
    dl.position.set(5, 20, 10);
    scene.add(dl);

    geos.box = new THREE.BoxGeometry(0.9, 0.9, 0.9);
    geos.food = new THREE.OctahedronGeometry(0.45);
    geos.board = new THREE.PlaneGeometry(21, 21);
    geos.wallH = new THREE.BoxGeometry(23, 1, 1);
    geos.wallV = new THREE.BoxGeometry(1, 1, 21);

    mats.head = new THREE.MeshLambertMaterial({ color: 0xffffff });
    mats.body = new THREE.MeshLambertMaterial({ color: 0x22cc22 });
    mats.food = new THREE.MeshLambertMaterial({ color: 0xffcc00 });
    mats.obstacle = new THREE.MeshLambertMaterial({ color: 0x666666 });
    mats.board = new THREE.MeshLambertMaterial({ color: 0x113311 });
    mats.wall = new THREE.MeshLambertMaterial({ color: 0x333333 });

    const boardMesh = new THREE.Mesh(geos.board, mats.board);
    boardMesh.rotation.x = -Math.PI / 2;
    boardMesh.position.y = -0.46;
    scene.add(boardMesh);

    const wN = new THREE.Mesh(geos.wallH, mats.wall);
    wN.position.set(0, 0, -11);
    scene.add(wN);

    const wS = new THREE.Mesh(geos.wallH, mats.wall);
    wS.position.set(0, 0, 11);
    scene.add(wS);

    const wE = new THREE.Mesh(geos.wallV, mats.wall);
    wE.position.set(11, 0, 0);
    scene.add(wE);

    const wW = new THREE.Mesh(geos.wallV, mats.wall);
    wW.position.set(-11, 0, 0);
    scene.add(wW);
}

function spawnFood() {
    if (food) {
        scene.remove(food.mesh);
        food = null;
    }
    
    let freeSpaces = [];
    for (let x = -BOARD_SIZE; x <= BOARD_SIZE; x++) {
        for (let z = -BOARD_SIZE; z <= BOARD_SIZE; z++) {
            let taken = false;
            for (let s of snake) if (s.x === x && s.z === z) taken = true;
            for (let o of obstacles) if (o.x === x && o.z === z) taken = true;
            if (!taken) freeSpaces.push({ x, z });
        }
    }
    
    if (freeSpaces.length > 0) {
        let pos = freeSpaces[Math.floor(Math.random() * freeSpaces.length)];
        let m = new THREE.Mesh(geos.food, mats.food);
        m.position.set(pos.x, 0, pos.z);
        scene.add(m);
        food = { x: pos.x, z: pos.z, mesh: m, t: 0 };
    } else {
        gameState = 'WIN';
    }
}

function resetGame(seed) {
    Math.random = mulberry32(seed >>> 0);
    score = 0;
    lives = 1;
    gameState = 'PLAYING';
    
    moveInterval = 0.15;
    moveTimer = 0;
    currentDir = { x: 1, z: 0 };
    nextDir = { x: 1, z: 0 };

    for (let s of snake) scene.remove(s.mesh);
    snake = [];
    
    for (let o of obstacles) scene.remove(o.mesh);
    obstacles = [];

    if (food) {
        scene.remove(food.mesh);
        food = null;
    }

    for (let i = 0; i < 3; i++) {
        let m = new THREE.Mesh(geos.box, i === 0 ? mats.head : mats.body);
        m.position.set(-i, 0, 0);
        scene.add(m);
        snake.push({ x: -i, z: 0, mesh: m });
    }

    let numObstacles = 8 + Math.floor(Math.random() * 12);
    for (let i = 0; i < numObstacles; i++) {
        let ox = Math.floor(Math.random() * 21) - 10;
        let oz = Math.floor(Math.random() * 21) - 10;

        if (Math.abs(ox) < 4 && Math.abs(oz) < 4) continue;

        let duplicate = obstacles.some(o => o.x === ox && o.z === oz);
        if (!duplicate) {
            let m = new THREE.Mesh(geos.box, mats.obstacle);
            m.position.set(ox, 0, oz);
            scene.add(m);
            obstacles.push({ x: ox, z: oz, mesh: m });
        }
    }

    spawnFood();

    camera.position.set(0, 22, 14);
    camera.lookAt(0, 0, -2);
}

function update(dt) {
    if (gameState !== 'PLAYING') return;
    dt = Math.min(dt, 0.1);

    let a = globalThis.currentAction;
    if (a === 1 && currentDir.x === 0) nextDir = { x: -1, z: 0 };
    if (a === 2 && currentDir.x === 0) nextDir = { x: 1, z: 0 };
    if (a === 3 && currentDir.z === 0) nextDir = { x: 0, z: -1 };
    if (a === 4 && currentDir.z === 0) nextDir = { x: 0, z: 1 };

    if (food) {
        food.t += dt;
        food.mesh.rotation.y = food.t * 3;
        food.mesh.position.y = Math.sin(food.t * 6) * 0.15;
    }

    moveTimer += dt;
    if (moveTimer >= moveInterval) {
        moveTimer -= moveInterval;
        currentDir = { x: nextDir.x, z: nextDir.z };

        let head = snake[0];
        let nx = head.x + currentDir.x;
        let nz = head.z + currentDir.z;

        if (nx < -BOARD_SIZE || nx > BOARD_SIZE || nz < -BOARD_SIZE || nz > BOARD_SIZE) {
            gameState = 'GAMEOVER';
            return;
        }

        for (let o of obstacles) {
            if (o.x === nx && o.z === nz) {
                gameState = 'GAMEOVER';
                return;
            }
        }

        let eating = (food && nx === food.x && nz === food.z);
        let checkLen = eating ? snake.length : snake.length - 1;
        
        for (let i = 0; i < checkLen; i++) {
            if (snake[i].x === nx && snake[i].z === nz) {
                gameState = 'GAMEOVER';
                return;
            }
        }

        if (eating) {
            score++;
            let oldTail = snake[snake.length - 1];
            let newMesh = new THREE.Mesh(geos.box, mats.body);
            newMesh.position.copy(oldTail.mesh.position);
            scene.add(newMesh);
            
            snake.push({ x: oldTail.x, z: oldTail.z, mesh: newMesh });
            
            spawnFood();
            moveInterval = Math.max(0.06, moveInterval - 0.002);
        }

        for (let i = snake.length - 1; i > 0; i--) {
            snake[i].x = snake[i - 1].x;
            snake[i].z = snake[i - 1].z;
        }

        snake[0].x = nx;
        snake[0].z = nz;
    }

    for (let s of snake) {
        s.mesh.position.x += (s.x - s.mesh.position.x) * 15 * dt;
        s.mesh.position.z += (s.z - s.mesh.position.z) * 15 * dt;
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