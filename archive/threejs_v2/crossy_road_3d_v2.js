// crossy_road_3d_v2 — hand-ported reference implementation using engine/three.
//
// This is the same game as crossy_road_3d.js but written against the new
// Raylib-style engine API. Used as the reference example included in the
// LLM generation prompt — shows the API in idiomatic use.
//
// The runtime injects `globalThis.engine` before loading this file.

// NOTE: do NOT destructure `render` from engine — the tester harness appends
// `window.render = typeof render==='function'?render:undefined;` after the
// source runs, which would pick up engine.render and shadow our local render.
// Call engine.render(world) explicitly instead.
const {
  setupGame, setBackground, drawCube, drawSphere, removeMesh,
  updateCamera, mulberry32, getCurrentAction,
  CAMERA_FOLLOW_2D,
  palette,
  SKYBLUE, GREEN, DARKGRAY, BLUE, BROWN, RED, GOLD, WHITE, DARKGREEN,
  smoothLerp, lerp,
} = engine;

// Game state
let world, camera;
let score = 0, lives = 1, gameState = 'PLAYING';

let player;
let playerTargetX = 0, playerTargetZ = 0;
let playerJumpTimer = 0;
let onLog = null;
let maxZ_reached = 0;

let lanes = [];          // array of { z, type, mesh, entities, speed, dir }
let prevType = 0, typeCount = 0;
let lowestZ_generated = 5;

const PLAY_WIDTH = 6;
const JUMP_DURATION = 0.15;

const LANE_TYPE_GRASS = 0;
const LANE_TYPE_ROAD = 1;
const LANE_TYPE_RIVER = 2;

function setup(args) {
  ({ world, camera } = setupGame({
    ...args,
    cameraMode: CAMERA_FOLLOW_2D,
    cameraOpts: { position: [0, 10, 6], target: [0, 0, 0], fovy: 60 },
  }));
  setBackground(world, SKYBLUE);

  player = drawCube(world, [0, 0.8, 0], 0.6, 0.6, 0.6, WHITE);
}

function generateLane(z) {
  let type = LANE_TYPE_GRASS;
  if (z < 0) {
    const r = Math.random();
    if (r < 0.4) type = LANE_TYPE_ROAD;
    else if (r < 0.7) type = LANE_TYPE_RIVER;
    else type = LANE_TYPE_GRASS;

    if (type === prevType) {
      typeCount++;
      if (typeCount > 2) {
        type = (type + 1) % 3;
        typeCount = 1;
      }
    } else {
      prevType = type;
      typeCount = 1;
    }
  }

  const laneColor = type === LANE_TYPE_GRASS ? GREEN
                  : type === LANE_TYPE_ROAD ? DARKGRAY
                  : BLUE;
  const laneMesh = drawCube(world, [0, 0, z], 20, 1, 1, laneColor);

  const lane = { z, type, mesh: laneMesh, entities: [], speed: 0, dir: 1 };

  if (type === LANE_TYPE_GRASS) {
    // Trees scattered as obstacles
    const numTrees = Math.floor(Math.random() * 4) + 1;
    const usedX = new Set();
    for (let i = 0; i < numTrees; i++) {
      const tx = Math.floor(Math.random() * (PLAY_WIDTH * 2 + 1)) - PLAY_WIDTH;
      if (tx === 0 && z >= -2 && z <= 2) continue;       // never block spawn
      if (usedX.has(tx)) continue;
      usedX.add(tx);
      const tree = drawCube(world, [tx, 1, z], 1, 1, 1, DARKGREEN);
      lane.entities.push({ mesh: tree, x: tx, isTree: true });
    }
    // Boundary walls (out-of-play markers)
    const w1 = drawCube(world, [-PLAY_WIDTH - 1, 1, z], 1, 1, 1, DARKGREEN);
    const w2 = drawCube(world, [PLAY_WIDTH + 1, 1, z], 1, 1, 1, DARKGREEN);
    lane.entities.push({ mesh: w1, x: -PLAY_WIDTH - 1, isTree: true });
    lane.entities.push({ mesh: w2, x: PLAY_WIDTH + 1, isTree: true });
  } else if (type === LANE_TYPE_ROAD) {
    lane.dir = Math.random() < 0.5 ? 1 : -1;
    lane.speed = 3 + Math.random() * 4;
    const numCars = Math.floor(Math.random() * 2) + 1;
    const carColors = [RED, BLUE, GOLD];
    const carColor = carColors[Math.floor(Math.random() * carColors.length)];
    for (let i = 0; i < numCars; i++) {
      const cx = Math.random() * 20 - 10;
      const car = drawCube(world, [cx, 0.9, z], 1.5, 0.8, 0.8, carColor);
      lane.entities.push({ mesh: car, x: cx, w: 1.5 });
    }
  } else if (type === LANE_TYPE_RIVER) {
    lane.dir = Math.random() < 0.5 ? 1 : -1;
    lane.speed = 2 + Math.random() * 3;
    const numLogs = Math.floor(Math.random() * 3) + 2;
    for (let i = 0; i < numLogs; i++) {
      const lx = Math.random() * 20 - 10;
      const len = 2.5 + Math.random() * 2;
      const log = drawCube(world, [lx, 0.8, z], len, 0.6, 0.8, BROWN);
      lane.entities.push({ mesh: log, x: lx, w: len });
    }
  }

  lanes.push(lane);
}

function checkLanding() {
  const currentLane = lanes.find(l => l.z === Math.round(playerTargetZ));
  if (currentLane && currentLane.type === LANE_TYPE_RIVER) {
    let landed = false;
    for (const e of currentLane.entities) {
      if (Math.abs(playerTargetX - e.x) < e.w / 2 + 0.3) {
        onLog = { lane: currentLane, entity: e };
        landed = true;
        player.position.y = 1.4;
        break;
      }
    }
    if (!landed) {
      gameState = 'GAMEOVER';
      player.position.y = 0.4;
    }
  } else {
    player.position.y = 0.8;
  }
}

function checkCollisions() {
  for (const l of lanes) {
    if (Math.abs(l.z - player.position.z) < 0.6 && l.type === LANE_TYPE_ROAD) {
      for (const e of l.entities) {
        if (Math.abs(player.position.x - e.x) < e.w / 2 + 0.3) {
          gameState = 'GAMEOVER';
        }
      }
    }
  }
  if (playerJumpTimer <= 0) {
    const currentLane = lanes.find(l => l.z === Math.round(playerTargetZ));
    if (currentLane && currentLane.type === LANE_TYPE_RIVER && !onLog) {
      gameState = 'GAMEOVER';
    }
    if (player.position.x < -PLAY_WIDTH - 0.5 || player.position.x > PLAY_WIDTH + 0.5) {
      gameState = 'GAMEOVER';
    }
    if (playerTargetZ > maxZ_reached + 4) {
      gameState = 'GAMEOVER';
    }
  }
}

function update(dt) {
  if (gameState !== 'PLAYING') return;
  dt = Math.min(dt, 0.1);

  const a = getCurrentAction();
  let dx = 0, dz = 0;

  if (playerJumpTimer <= 0) {
    if (a === 1) dx = -1;
    else if (a === 2) dx = 1;
    else if (a === 3) dz = -1;
    else if (a === 4) dz = 1;

    if (dx !== 0 || dz !== 0) {
      const nx = Math.round(playerTargetX + dx);
      const nz = Math.round(playerTargetZ + dz);
      if (nx >= -PLAY_WIDTH && nx <= PLAY_WIDTH) {
        let blocked = false;
        const targetLane = lanes.find(l => l.z === nz);
        if (targetLane && targetLane.type === LANE_TYPE_GRASS) {
          for (const e of targetLane.entities) {
            if (e.isTree && Math.round(e.x) === nx) { blocked = true; break; }
          }
        }
        if (!blocked) {
          // Store starting position for smooth linear interpolation
          player.userData.startX = player.position.x;
          player.userData.startZ = player.position.z;
          playerTargetX = nx;
          playerTargetZ = nz;
          playerJumpTimer = JUMP_DURATION;
          player.userData.startY = onLog ? 1.4 : 0.8;
          onLog = null;
        }
      }
    }
  }

  if (playerJumpTimer > 0) {
    playerJumpTimer -= dt;
    let t = 1 - playerJumpTimer / JUMP_DURATION;
    if (t > 1) t = 1;

    // Lerp from fixed start position to prevent nonlinear snapping/jerking
    const sx = player.userData.startX !== undefined ? player.userData.startX : playerTargetX;
    const sz = player.userData.startZ !== undefined ? player.userData.startZ : playerTargetZ;
    
    player.position.x = lerp(sx, playerTargetX, t);
    player.position.z = lerp(sz, playerTargetZ, t);

    const targetLane = lanes.find(l => l.z === Math.round(playerTargetZ));
    const targetY = (targetLane && targetLane.type === LANE_TYPE_RIVER) ? 1.4 : 0.8;
    const startY = player.userData.startY ?? 0.8;
    const baseY = lerp(startY, targetY, t);
    player.position.y = baseY + Math.sin(t * Math.PI) * 0.8;

    if (playerJumpTimer <= 0) {
      player.position.x = playerTargetX;
      player.position.z = playerTargetZ;
      checkLanding();
    }
  }

  // Animate cars + logs
  for (const l of lanes) {
    if (l.type === LANE_TYPE_ROAD || l.type === LANE_TYPE_RIVER) {
      for (const e of l.entities) {
        e.x += l.speed * l.dir * dt;
        if (l.dir === 1 && e.x > 12) e.x = -12;
        if (l.dir === -1 && e.x < -12) e.x = 12;
        e.mesh.position.x = e.x;
      }
    }
  }

  // Drift on log
  if (onLog && playerJumpTimer <= 0) {
    const drift = onLog.lane.speed * onLog.lane.dir * dt;
    playerTargetX += drift;
    player.position.x = playerTargetX;
  }

  checkCollisions();

  const currentZScore = -Math.round(playerTargetZ);
  if (currentZScore > score) score = currentZScore;
  if (playerTargetZ < maxZ_reached) maxZ_reached = playerTargetZ;

  // Stream world: generate ahead, remove behind
  while (lowestZ_generated > playerTargetZ - 30) {
    generateLane(lowestZ_generated);
    lowestZ_generated--;
  }
  for (let i = lanes.length - 1; i >= 0; i--) {
    if (lanes[i].z > playerTargetZ + 10) {
      removeMesh(world, lanes[i].mesh);
      for (const e of lanes[i].entities) removeMesh(world, e.mesh);
      lanes.splice(i, 1);
    }
  }

  // Fix camera X to 0 so it doesn't track horizontal motion and only scrolls smoothly forward
  const camTarget = { position: { x: 0, y: 0, z: player.position.z } };
  updateCamera(camera, camTarget, dt, { distance: 6, height: 10, smoothing: 10, mode: CAMERA_FOLLOW_2D });
}

function render() { engine.render(world); }

function resetGame(seed) {
  Math.random = mulberry32(seed >>> 0);
  score = 0;
  lives = 1;
  gameState = 'PLAYING';

  for (const l of lanes) {
    removeMesh(world, l.mesh);
    for (const e of l.entities) removeMesh(world, e.mesh);
  }
  lanes = [];
  prevType = 0; typeCount = 0;
  maxZ_reached = 0;
  playerTargetX = 0; playerTargetZ = 0; playerJumpTimer = 0;
  onLog = null;
  player.position.set(0, 0.8, 0);

  lowestZ_generated = 5;
  while (lowestZ_generated >= -30) {
    generateLane(lowestZ_generated);
    lowestZ_generated--;
  }

  // Snap camera once
  updateCamera(camera, player, 1, { distance: 6, height: 10, smoothing: 100, mode: CAMERA_FOLLOW_2D });
}

function getGameState() { return { score, lives, gameState }; }

// Expose required globals for the runtime. (The harness ALSO does this via
// `window.X = typeof X==='function'?X:undefined` — ours runs first, theirs
// runs second, so as long as our local symbol names match the contract,
// either path works.)
globalThis.setup = setup;
globalThis.update = update;
globalThis.render = render;
globalThis.resetGame = resetGame;
globalThis.getGameState = getGameState;
