let playerMesh, starMesh;
let platformMeshes = [];
let platformsData = [];

let score = 0;
let lives = 1;
let gameState = 'PLAYING';
let frame = 0;

let vel = { x: 0, y: 0, z: 0 };
let groundedLastFrame = false;
let lastInputX = 0;
let lastInputZ = 0;

function setup({ THREE, renderer, width, height }) {
  globalThis.scene = new THREE.Scene();
  globalThis.scene.background = new THREE.Color(0x87CEEB); 
  
  globalThis.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);

  globalThis.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const dl = new THREE.DirectionalLight(0xffffff, 0.8);
  dl.position.set(10, 20, 10);
  globalThis.scene.add(dl);

  playerMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.4, 2, 8),
    new THREE.MeshLambertMaterial({ color: 0xff0000 })
  );
  globalThis.scene.add(playerMesh);

  const platGeo = new THREE.BoxGeometry(1, 1, 1);
  const platMat = new THREE.MeshLambertMaterial({ color: 0x228B22 });
  for (let i = 0; i < 4; i++) {
    let mesh = new THREE.Mesh(platGeo, platMat);
    platformMeshes.push(mesh);
    globalThis.scene.add(mesh);
  }

  starMesh = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.6),
    new THREE.MeshLambertMaterial({ color: 0xFFD700 })
  );
  globalThis.scene.add(starMesh);
}

function update(dt) {
  if (gameState !== 'PLAYING') return;
  frame++;

  const a = globalThis.currentAction;

  let inputX = 0;
  let inputZ = 0;
  let jump = false;

  if (a === 1) { inputX = -1; inputZ = 0; }
  else if (a === 2) { inputX = 1; inputZ = 0; }
  else if (a === 3) { inputX = 0; inputZ = -1; }
  else if (a === 4) { inputX = 0; inputZ = 1; }
  else if (a === 5) {
    inputX = lastInputX;
    inputZ = lastInputZ;
    jump = true;
  }
  else if (a === 6) { inputX = -1; inputZ = 0; jump = true; }
  else if (a === 7) { inputX = 1; inputZ = 0; jump = true; }

  if (a !== 5 && a !== 0) {
    lastInputX = inputX;
    lastInputZ = inputZ;
  } else if (a === 0) {
    lastInputX = 0;
    lastInputZ = 0;
  }

  const gravity = 30;
  const moveSpeed = 8;
  const jumpForce = 14;

  vel.y -= gravity * dt;

  let targetVx = inputX * moveSpeed;
  let targetVz = inputZ * moveSpeed;

  let control = groundedLastFrame ? 15 : 5;
  vel.x += (targetVx - vel.x) * control * dt;
  vel.z += (targetVz - vel.z) * control * dt;

  if (jump && groundedLastFrame) {
    vel.y = jumpForce;
    groundedLastFrame = false;
  }

  playerMesh.position.x += vel.x * dt;
  playerMesh.position.y += vel.y * dt;
  playerMesh.position.z += vel.z * dt;

  groundedLastFrame = false;

  for (let p of platformsData) {
    let dx = playerMesh.position.x - p.x;
    let dy = playerMesh.position.y - p.y;
    let dz = playerMesh.position.z - p.z;

    let intersectX = (0.4 + p.w / 2) - Math.abs(dx);
    let intersectY = (1.0 + p.h / 2) - Math.abs(dy);
    let intersectZ = (0.4 + p.d / 2) - Math.abs(dz);

    if (intersectX > 0 && intersectY > 0 && intersectZ > 0) {
      if (intersectX < intersectY && intersectX < intersectZ) {
        playerMesh.position.x += Math.sign(dx) * intersectX;
        vel.x = 0;
      } else if (intersectZ < intersectX && intersectZ < intersectY) {
        playerMesh.position.z += Math.sign(dz) * intersectZ;
        vel.z = 0;
      } else {
        playerMesh.position.y += Math.sign(dy) * intersectY;
        if (dy > 0) {
          vel.y = 0;
          groundedLastFrame = true;
        } else {
          vel.y = 0; 
        }
      }
    }
  }

  starMesh.rotation.y += 2 * dt;
  let starBaseY = platformsData[3].y + platformsData[3].h / 2 + 1.0;
  starMesh.position.y = starBaseY + Math.sin(frame * 0.05) * 0.3;

  let sx = playerMesh.position.x - starMesh.position.x;
  let sy = playerMesh.position.y - starMesh.position.y;
  let sz = playerMesh.position.z - starMesh.position.z;
  if (sx * sx + sy * sy + sz * sz < 2.25) { 
    score += 10;
    gameState = 'WIN';
  }

  if (playerMesh.position.y < -10) {
    lives = 0;
    gameState = 'GAMEOVER';
  }

  if (frame > 1800) {
    gameState = 'GAMEOVER';
  }

  let targetCamX = playerMesh.position.x;
  let targetCamY = playerMesh.position.y + 4;
  let targetCamZ = playerMesh.position.z + 8;

  globalThis.camera.position.x += (targetCamX - globalThis.camera.position.x) * 5 * dt;
  globalThis.camera.position.y += (targetCamY - globalThis.camera.position.y) * 5 * dt;
  globalThis.camera.position.z += (targetCamZ - globalThis.camera.position.z) * 5 * dt;
  globalThis.camera.lookAt(playerMesh.position.x, playerMesh.position.y + 1, playerMesh.position.z);
}

function render() {
  globalThis.renderer.render(globalThis.scene, globalThis.camera);
}

function resetGame(seed) {
  Math.random = mulberry32(seed >>> 0);
  score = 0;
  lives = 1;
  gameState = 'PLAYING';
  frame = 0;

  vel = { x: 0, y: 0, z: 0 };
  groundedLastFrame = false;
  lastInputX = 0;
  lastInputZ = 0;

  playerMesh.position.set(0, 1, 0);

  platformsData = [];
  platformsData.push({ x: 0, y: -1, z: 0, w: 5, h: 2, d: 5 });

  let currX = 0, currY = 0, currZ = 0;
  for (let i = 1; i <= 3; i++) {
    let angle = (Math.random() - 0.5) * Math.PI * 0.5;
    let dist = 4.0 + Math.random() * 2.0;
    currX += Math.sin(angle) * dist;
    currZ -= Math.cos(angle) * dist;
    currY += 1.0 + Math.random() * 1.5;

    let w = 2.5 + Math.random() * 1.5;
    let d = 2.5 + Math.random() * 1.5;

    platformsData.push({ x: currX, y: currY - 1, z: currZ, w, h: 2, d });
  }

  for (let i = 0; i < 4; i++) {
    let p = platformsData[i];
    platformMeshes[i].position.set(p.x, p.y, p.z);
    platformMeshes[i].scale.set(p.w, p.h, p.d);
  }

  let lastP = platformsData[3];
  starMesh.position.set(lastP.x, lastP.y + lastP.h / 2 + 1.5, lastP.z);

  globalThis.camera.position.set(
    playerMesh.position.x, 
    playerMesh.position.y + 4, 
    playerMesh.position.z + 8
  );
  globalThis.camera.lookAt(playerMesh.position.x, playerMesh.position.y + 1, playerMesh.position.z);
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