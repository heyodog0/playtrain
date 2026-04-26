let stageGroup, ball, goal;
let obstaclePool = [];
let activeObstacles = [];
let pitch = 0, roll = 0;
let vx = 0, vz = 0, vy = 0;
let falling = false;
let score = 0, lives = 1, gameState = 'PLAYING';
let maxProgress = 0;
let frame = 0;

const BALL_RADIUS = 0.5;
const FLOOR_WIDTH = 20;
const FLOOR_LENGTH = 40;

function setup({ THREE, renderer, width, height }) {
  globalThis.scene = new THREE.Scene();
  globalThis.scene.background = new THREE.Color(0x87CEEB); 
  
  globalThis.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);

  const ambient = new THREE.AmbientLight(0xffffff, 0.5);
  globalThis.scene.add(ambient);
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
  dirLight.position.set(10, 20, 10);
  globalThis.scene.add(dirLight);

  stageGroup = new THREE.Group();
  globalThis.scene.add(stageGroup);

  // Floor
  const floorMat = new THREE.MeshLambertMaterial({ color: 0x228B22 }); // Forest Green
  const floorGeom = new THREE.BoxGeometry(FLOOR_WIDTH, 1, FLOOR_LENGTH);
  const floor = new THREE.Mesh(floorGeom, floorMat);
  floor.position.y = -0.5; 
  stageGroup.add(floor);

  // Ball
  const ballMat = new THREE.MeshNormalMaterial();
  const ballGeom = new THREE.SphereGeometry(BALL_RADIUS, 16, 16);
  ball = new THREE.Mesh(ballGeom, ballMat);
  stageGroup.add(ball);

  // Goal Pad
  const goalMat = new THREE.MeshLambertMaterial({ color: 0xFFD700 }); // Gold
  const goalGeom = new THREE.CylinderGeometry(1.5, 1.5, 0.2, 16);
  goal = new THREE.Mesh(goalGeom, goalMat);
  goal.position.y = 0.1;
  stageGroup.add(goal);

  // Obstacle Pool
  const obsMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 }); // SaddleBrown
  for(let i = 0; i < 20; i++) {
    const obs = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), obsMat);
    stageGroup.add(obs);
    obstaclePool.push(obs);
  }
}

function update(dt) {
  if (gameState !== 'PLAYING') return;
  frame++;
  
  const a = globalThis.currentAction;
  let targetPitch = 0;
  let targetRoll = 0;
  const maxTilt = 0.35; // Max stage rotation in radians

  // Action mapping: 1=LEFT, 2=RIGHT, 3=UP, 4=DOWN
  if (a === 1) targetRoll = maxTilt;    // Tilt right-side up -> rolls left (-X)
  if (a === 2) targetRoll = -maxTilt;   // Tilt left-side up -> rolls right (+X)
  if (a === 3) targetPitch = maxTilt;   // Tilt near-side up -> rolls forward (-Z)
  if (a === 4) targetPitch = -maxTilt;  // Tilt far-side up -> rolls backward (+Z)

  // Smoothly rotate stage
  pitch += (targetPitch - pitch) * 5 * dt;
  roll += (targetRoll - roll) * 5 * dt;
  stageGroup.rotation.x = pitch;
  stageGroup.rotation.z = roll;

  // Pulse the goal visually
  goal.scale.set(1 + 0.1 * Math.sin(frame * 0.1), 1, 1 + 0.1 * Math.sin(frame * 0.1));

  if (!falling) {
    // Gravity application relative to stage tilt
    const ax = -25.0 * Math.sin(roll);
    const az = -25.0 * Math.sin(pitch);

    vx += ax * dt;
    vz += az * dt;

    // Friction
    vx *= 0.98;
    vz *= 0.98;

    ball.position.x += vx * dt;
    ball.position.z += vz * dt;

    // AABB Obstacle Collisions
    for (let i = 0; i < activeObstacles.length; i++) {
      const obs = activeObstacles[i];
      const closestX = Math.max(obs.minX, Math.min(ball.position.x, obs.maxX));
      const closestZ = Math.max(obs.minZ, Math.min(ball.position.z, obs.maxZ));

      const dx = ball.position.x - closestX;
      const dz = ball.position.z - closestZ;
      const distSq = dx * dx + dz * dz;

      if (distSq < BALL_RADIUS * BALL_RADIUS) {
        if (distSq === 0) {
          // Deep penetration (center is inside), push out to nearest edge
          const dMinX = ball.position.x - obs.minX;
          const dMaxX = obs.maxX - ball.position.x;
          const dMinZ = ball.position.z - obs.minZ;
          const dMaxZ = obs.maxZ - ball.position.z;
          const minD = Math.min(dMinX, dMaxX, dMinZ, dMaxZ);
          
          if (minD === dMinX) { ball.position.x = obs.minX - BALL_RADIUS; vx *= -0.5; }
          else if (minD === dMaxX) { ball.position.x = obs.maxX + BALL_RADIUS; vx *= -0.5; }
          else if (minD === dMinZ) { ball.position.z = obs.minZ - BALL_RADIUS; vz *= -0.5; }
          else { ball.position.z = obs.maxZ + BALL_RADIUS; vz *= -0.5; }
        } else {
          // Standard resolution
          const dist = Math.sqrt(distSq);
          const push = BALL_RADIUS - dist;
          const nx = dx / dist;
          const nz = dz / dist;

          ball.position.x += nx * push;
          ball.position.z += nz * push;

          // Reflect velocity along collision normal
          const dot = vx * nx + vz * nz;
          if (dot < 0) {
            const restitution = 1.3; 
            vx -= restitution * dot * nx;
            vz -= restitution * dot * nz;
          }
        }
      }
    }

    // Check bounds (falling)
    if (Math.abs(ball.position.x) > FLOOR_WIDTH / 2 || Math.abs(ball.position.z) > FLOOR_LENGTH / 2) {
      falling = true;
    }

    // Goal overlap
    const gdx = ball.position.x - goal.position.x;
    const gdz = ball.position.z - goal.position.z;
    if (gdx * gdx + gdz * gdz < (1.5 + BALL_RADIUS) * (1.5 + BALL_RADIUS)) {
      score += 500;
      gameState = 'WIN';
    }

    // Reward dense progress
    const progress = (FLOOR_LENGTH / 2 - 4) - ball.position.z;
    if (progress > maxProgress) {
      score += Math.floor((progress - maxProgress) * 10);
      maxProgress = progress;
    }

  } else {
    // Falling animation
    vy -= 30 * dt;
    ball.position.y += vy * dt;
    ball.position.x += vx * dt;
    ball.position.z += vz * dt;

    if (ball.position.y < -15) {
      lives = 0;
      gameState = 'GAMEOVER';
    }
  }

  // Camera follows ball but remains aligned to world
  const ballWorld = new THREE.Vector3();
  ball.getWorldPosition(ballWorld);

  const targetCamPos = ballWorld.clone().add(new THREE.Vector3(0, 8, 12));
  globalThis.camera.position.lerp(targetCamPos, 8 * dt);
  globalThis.camera.lookAt(ballWorld);
}

function render() {
  globalThis.renderer.render(globalThis.scene, globalThis.camera);
}

function resetGame(seed) {
  Math.random = mulberry32(seed >>> 0);
  
  score = 0;
  lives = 1;
  gameState = 'PLAYING';
  maxProgress = 0;
  frame = 0;

  pitch = 0;
  roll = 0;
  stageGroup.rotation.set(0, 0, 0);

  vx = 0; 
  vz = 0; 
  vy = 0;
  falling = false;

  // Position Ball
  ball.position.set(0, BALL_RADIUS, FLOOR_LENGTH / 2 - 4);

  // Randomize Goal location
  const goalX = (Math.random() - 0.5) * (FLOOR_WIDTH - 6);
  goal.position.set(goalX, 0.1, -FLOOR_LENGTH / 2 + 4);

  // Procedural Obstacles
  activeObstacles = [];
  const numObs = 8 + Math.floor(Math.random() * 8);

  for (let i = 0; i < obstaclePool.length; i++) {
    const obs = obstaclePool[i];
    if (i < numObs) {
      obs.visible = true;
      const w = 2 + Math.random() * 4;
      const h = 2;
      const d = 2 + Math.random() * 4;
      obs.scale.set(w, h, d);

      let ox, oz;
      let valid = false;
      let attempts = 0;
      
      while (!valid && attempts < 100) {
        ox = (Math.random() - 0.5) * (FLOOR_WIDTH - w);
        oz = (Math.random() - 0.5) * (FLOOR_LENGTH - d - 10); // keep central
        
        // Don't overlap start area
        if (Math.abs(ox - 0) < w/2 + 2 && Math.abs(oz - ball.position.z) < d/2 + 4) {
          attempts++; continue;
        }
        // Don't overlap goal area
        if (Math.abs(ox - goal.position.x) < w/2 + 3 && Math.abs(oz - goal.position.z) < d/2 + 3) {
          attempts++; continue;
        }
        valid = true;
      }

      obs.position.set(ox, h / 2, oz);

      activeObstacles.push({
        minX: ox - w / 2, maxX: ox + w / 2,
        minZ: oz - d / 2, maxZ: oz + d / 2
      });
    } else {
      obs.visible = false;
    }
  }

  // Snap camera to start to avoid wild swings between episodes
  const ballWorld = new THREE.Vector3();
  ball.getWorldPosition(ballWorld);
  globalThis.camera.position.copy(ballWorld).add(new THREE.Vector3(0, 8, 12));
  globalThis.camera.lookAt(ballWorld);
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