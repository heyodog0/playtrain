# Three.js Game Template Specification (v2)

Standard interface for LLM-generated **Three.js** games targeting headless RL training via WebGPU/Dawn. Parallel to the p5 `GAME_TEMPLATE.md`: same action space, same observation contract, same determinism guarantees — different lifecycle and rendering path.

A single RL agent with a fixed CNN policy will train across all v2 games. The template guarantees a uniform action space, observation space, and game state interface. Anything game-specific lives inside `update(dt)` and `resetGame(seed)`.

---

## Action Space

**Discrete(8)** — identical indices and intent as the p5 path:

| Index | Name    | Typical 3D meaning                       |
|------:|---------|------------------------------------------|
| 0     | NOOP    | hold position                            |
| 1     | LEFT    | strafe / turn left / lane left           |
| 2     | RIGHT   | strafe / turn right / lane right         |
| 3     | UP      | forward / jump / pitch up                |
| 4     | DOWN    | back / slide / pitch down                |
| 5     | D       | fire / boost / jump / interact           |
| 6     | LEFT+D  | strafe-and-fire combos                   |
| 7     | RIGHT+D | strafe-and-fire combos                   |

Games may interpret each index however they want; an agent learns the mapping from pixels and rewards. Games that don't need all 8 actions just ignore the extras.

Unlike the p5 path (which exposes `keyIsDown(code)` and `keyPressed()`), Three.js games read the **current action index directly** from a global the runtime sets each frame:

```javascript
// Set by the runtime BEFORE every update(dt). Integer in [0, 8).
globalThis.currentAction;
```

Games may map the integer to internal semantics however they want.

---

## Observation Space

- The runtime renders the scene to a WebGPU render target, then reads pixels back as **64×64×3 uint8 RGB**.
- Final shape: `(64, 64, 3)`. No frame stacking, no preprocessing on the game side.
- The game does NOT downscale. Just render the scene at any resolution; the runtime handles the readback path.

Recommended internal render-target size: **256×256 to 512×512**. Anything readable at 64×64.

---

## Required Game Interface

Every game is a single `.js` file that defines these globals. The runtime calls them in this order each step: `update(dt)` → `render()`. Once at session start: `setup({...})`. Once per episode: `resetGame(seed)`.

### `setup({ THREE, renderer, width, height })`

Called **once**, immediately after the runtime constructs the WebGPU device and renderer.

| Argument   | What you get                                                  |
|------------|---------------------------------------------------------------|
| `THREE`    | The `three/webgpu` module — use this instead of `import`-ing  |
| `renderer` | A `WebGPURenderer`, already initialized and sized             |
| `width`    | Render-target width in pixels                                 |
| `height`   | Render-target height in pixels                                |

Build persistent scene objects here: scene, camera, lights, geometry templates. **Do NOT generate level layout here** — defer to `resetGame()` so episodes are seeded.

```javascript
function setup({ THREE, renderer, width, height }) {
  globalThis.scene = new THREE.Scene();
  globalThis.camera = new THREE.PerspectiveCamera(70, width / height, 0.1, 100);
  globalThis.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
}
```

### `update(dt)`

Called **every frame**, before render. Mutate scene state based on `globalThis.currentAction`.

`dt` is seconds since the previous update. The runtime drives a fixed `dt = 1/60` in headless mode for determinism.

```javascript
function update(dt) {
  if (gameState !== 'PLAYING') return;
  const a = globalThis.currentAction;
  if (a === 1) player.position.x -= 4 * dt;   // LEFT
  if (a === 2) player.position.x += 4 * dt;   // RIGHT
  // ... advance physics, spawn obstacles, update score, check terminal conditions
}
```

### `render()`

Called **every frame**, after update. Just render the scene to the renderer. The runtime handles pixel readback after this returns.

```javascript
function render() {
  globalThis.renderer.render(globalThis.scene, globalThis.camera);
}
```

### `resetGame(seed)`

Called **once per episode**, on `env.reset()`. Reseed RNG, reset all per-episode state (score, lives, gameState), tear down + rebuild any per-episode scene objects (player position, level layout, enemies).

```javascript
function resetGame(seed) {
  Math.random = mulberry32(seed >>> 0);   // see Determinism section
  score = 0;
  lives = 1;
  gameState = 'PLAYING';
  player.position.set(0, 0.5, 0);
  // ... clear and rebuild level objects
}
```

After `resetGame()` returns, `getGameState().gameState` MUST be `'PLAYING'`.

### `getGameState()`

Returns a small JSON-serializable object the runtime reads after every step. Same shape as the p5 path.

```javascript
function getGameState() {
  return {
    score: 0,                    // monotonic; reward = score - lastScore
    lives: 1,
    gameState: 'PLAYING',        // 'PLAYING' | 'GAMEOVER' | 'WIN' | 'EXIT'
    // optional debug fields (player position, etc.) are fine
  };
}
```

---

## Reward & Termination

The runtime, not the game, computes:

- **`reward = state.score - lastScore`** each step. Make `score` monotonic.
- **`terminated = true`** when `state.gameState ∈ {'GAMEOVER', 'WIN', 'EXIT'}`.
- **`truncated = true`** when episode step count hits `max_steps` (default 2000).

Games signal terminal conditions purely by setting `gameState`. Don't try to terminate from inside `update()` by other means.

---

## Per-Seed Variation (procedural generation)

**Different seeds MUST produce visibly different episodes.** This is what makes ProcGen-style train/test splits meaningful — seeds 0–199 are training levels, 1000–1099 are held-out test levels. If your `resetGame(seed)` ignores `seed` (or only uses it for cosmetic noise), train and test scores will be identical by construction and the eval signal is dead.

What "varies by seed" should look like depends on the game:

| Game shape          | What to vary per seed                                                     |
|---------------------|---------------------------------------------------------------------------|
| Endless runner      | Obstacle pattern, lane sequence, gem placements                           |
| Grid puzzle         | Box positions, target positions, wall layout (within solvable constraints)|
| Maze nav            | Maze topology                                                             |
| First-person room   | Enemy/target positions, switch locations, room dimensions within bounds   |
| Marble/tilt stage   | Stage hazard placement, goal location                                     |
| Tube/lane shooter   | Spike sequence, ring placements                                           |
| Tower / Stack       | Initial block size, slide speed, color sequence                           |
| 3D platformer slice | Platform positions, star location                                         |

The variation should be **broad enough that a policy trained only on seeds 0–199 cannot trivially memorize them**, but **narrow enough that the game stays the same game** (don't randomize the action mappings, the win condition, or the obstacle types).

Implementation: do all randomization in `resetGame(seed)` AFTER reseeding `Math.random` via `mulberry32(seed)`. Don't draw random numbers in `setup()` — that runs once before any seed exists, and any RNG draws there leak across episodes.

```javascript
function resetGame(seed) {
  Math.random = mulberry32(seed >>> 0);
  // Now every Math.random() call is seeded:
  for (let i = 0; i < 12; i++) {
    obstacles[i].position.x = (Math.random() - 0.5) * 20;
    obstacles[i].position.z = -10 - Math.random() * 80;
  }
  // ...
}
```

## Determinism

**Same `seed` + same action sequence ⇒ byte-identical pixel trajectory.** This is non-negotiable; validation runs each game twice and diffs frames.

Three rules:

1. **Seed `Math.random` in `resetGame()`** using `mulberry32`. The runtime injects this helper as a global, but you can also paste it inline:

   ```javascript
   function mulberry32(seed) {
     let t = seed >>> 0;
     return () => {
       t += 0x6d2b79f5;
       let n = Math.imul(t ^ (t >>> 15), t | 1);
       n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
       return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
     };
   }
   ```

2. **Use the `dt` from `update(dt)`**, not `performance.now()` or `Date.now()`. The runtime guarantees fixed-timestep `dt = 1/60` in headless mode.

3. **Avoid wall-clock effects** — no real-time animation curves keyed off `Date.now()`, no `setTimeout`/`setInterval`. If you need a delay, count frames.

---

## Rendering Palette

These are the tools available to you. They look minimal, but the worked example below shows that 300+ lines of expressive game can be built from them.

**Geometry** (use freely, mix at least 3 types per scene):
- `BoxGeometry`, `SphereGeometry`, `PlaneGeometry`, `CylinderGeometry`, `ConeGeometry`, `OctahedronGeometry`, `TorusGeometry`, `RingGeometry`, `TetrahedronGeometry`, `IcosahedronGeometry`
- Custom `BufferGeometry` is fine if you set vertex positions directly (small ones — particle clouds, simple custom shapes)

**Materials**:
- `MeshBasicMaterial`, `MeshNormalMaterial`, `MeshLambertMaterial` — your defaults
- `MeshPhongMaterial` — fine if you want a specular highlight on something
- `PointsMaterial` — use with `Points` to draw particle clouds, dust, sparks
- `LineBasicMaterial` — for `Line` overlays (aim indicators, debug grids, motion trails)
- Per-vertex colors via `geometry.setAttribute('color', ...)` + `vertexColors: true` — useful for gradients without textures
- Skip `MeshStandardMaterial`/`MeshPhysicalMaterial` (PBR is slow and nondeterministic across drivers)

**Lights** (up to 3 total in any scene):
- `AmbientLight` — base fill
- `DirectionalLight` — main key light
- One additional `DirectionalLight` (rim light), `HemisphereLight`, or stationary low-cost light

**Atmosphere & color**:
- `scene.background = new THREE.Color(...)` — always set; never leave default black
- `scene.fog = new THREE.Fog(color, near, far)` — great for depth cues in nav games
- `THREE.Color().setHSL(h, s, l)` for procedural color palettes

**Animation** (do these, they're cheap and deterministic):
- Direct property mutation in `update(dt)` (preferred — no animation system needed)
- Smooth tweens via `pos.x += (target - pos.x) * k * dt` (used in every good v2 game)
- Bobbing / pulsing via `Math.sin(frame * 0.05)` keyed off frame counter (NOT wall clock)
- Particle bursts: spawn N short-lived `Mesh` objects with `userData.life`, decrement in `update`, dispose when life ≤ 0

**What NOT to use** (these break determinism, throughput, or generation reliability):
- No imported assets (no glTF, OBJ, textures, audio)
- No `EffectComposer` / post-processing pipeline
- No shadow maps (`receiveShadow`, `castShadow`)
- No `AnimationMixer` or skinned meshes
- No `setTimeout` / `setInterval` / `Date.now()` for timing — use frame counter or accumulated `dt`

---

## Common Pitfalls

| Pitfall                                                         | Why it breaks                              | Fix                                         |
|-----------------------------------------------------------------|--------------------------------------------|---------------------------------------------|
| `import * as THREE from 'three'` at top of file                 | Runtime executes file in a VM context; bare imports fail | Use the `THREE` argument passed to `setup()` |
| Reading `currentAction` inside `setup()` instead of `update()`  | `setup()` runs once before any action     | Only read in `update()`                      |
| Mutating scene during `render()`                                | Pixel readback may capture inconsistent state | All mutation in `update()`, render is read-only |
| Resetting in `setup()` instead of `resetGame()`                 | Reset is per-episode, not per-session     | Move all per-episode init to `resetGame(seed)` |
| Calling `Math.random()` outside `resetGame()`-seeded paths      | Breaks determinism                        | Always go through the seeded RNG            |
| Scaling reward by `dt`                                          | Reward must be monotonic on `score` delta | Increment `score` directly, runtime does the diff |
| Not setting `gameState = 'WIN'` or `'GAMEOVER'`                 | Episode never terminates, just truncates  | Explicitly set on win/lose conditions       |
| `resetGame(seed)` builds the same level regardless of `seed`    | Train/test eval signal collapses (memorization) | Do all per-episode randomization AFTER `Math.random = mulberry32(seed)` |

---

## Reference Game: `crossy_road_3d`

This is a complete, working v2 game that meets the bar. **Use it as your quality target.** Note in particular:

- ~330 lines — that's the expected scale of a complete v2 game (not 80, not 500)
- **5 entity types**: player, grass lanes, road lanes (cars), river lanes (logs), trees — each with distinct geometry/scale and a saturated color
- **Color encodes function**: green grass (safe), gray road (hazard surface), blue river (instant-death), brown logs (rideable), red/blue/gold cars (hazards), green trees (blockers)
- **Single dominant action loop** (hop one tile per discrete input) plus a sub-state (riding a log)
- **Smooth 0.15s tween** on player movement via `THREE.MathUtils.lerp` plus a `Math.sin(t * Math.PI)` jump arc on the y axis — small touches that make discrete moves feel intentional
- **Static-with-smooth-follow camera** (`camera.position.z` lerps toward `player.z + 6`) — never a chase cam through identical scenery
- **Procedural variety per seed** in 4+ dimensions: lane type sequence, tree positions, car positions/speeds/directions, log positions/sizes/speeds
- **Streaming world**: lanes generated ahead of player, removed behind — keeps memory flat for long episodes
- **Sky-blue background** + **directional + ambient lighting** that makes primitives pop instead of looking like wireframes

```javascript
let THREE, scene, camera, renderer;
let geos = {}, mats = {};
let score = 0, lives = 1, gameState = 'PLAYING';
let player, playerTargetX = 0, playerTargetZ = 0, playerJumpTimer = 0;
let jumpDuration = 0.15;
let onLog = null;
let maxZ_reached = 0;
let lanes = [];
let prevType = 0, typeCount = 0;
let PLAY_WIDTH = 6;
let lowestZ_generated = 5;

function setup({ THREE: threeArg, renderer: renArg, width, height }) {
    THREE = threeArg;
    renderer = renArg;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);

    camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dl = new THREE.DirectionalLight(0xffffff, 0.8);
    dl.position.set(5, 10, 5);
    scene.add(dl);

    geos.box = new THREE.BoxGeometry(1, 1, 1);
    geos.lane = new THREE.BoxGeometry(20, 1, 1);

    mats.player = new THREE.MeshLambertMaterial({color: 0xffffff});
    mats.grass = new THREE.MeshLambertMaterial({color: 0x7cfc00});
    mats.road = new THREE.MeshLambertMaterial({color: 0x333333});
    mats.river = new THREE.MeshLambertMaterial({color: 0x1e90ff});
    mats.tree = new THREE.MeshLambertMaterial({color: 0x228b22});
    mats.wood = new THREE.MeshLambertMaterial({color: 0x8b4513});
    mats.car1 = new THREE.MeshLambertMaterial({color: 0xff3333});
    mats.car2 = new THREE.MeshLambertMaterial({color: 0x3333ff});
    mats.car3 = new THREE.MeshLambertMaterial({color: 0xffd700});

    player = new THREE.Mesh(geos.box, mats.player);
    player.scale.set(0.6, 0.6, 0.6);
    scene.add(player);
}

function generateLane(z) {
    let type = 0;
    if (z >= 0) {
        type = 0;
    } else {
        let r = Math.random();
        if (r < 0.4) type = 1;
        else if (r < 0.7) type = 2;
        else type = 0;

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

    let laneMat = type === 0 ? mats.grass : (type === 1 ? mats.road : mats.river);
    let laneMesh = new THREE.Mesh(geos.lane, laneMat);
    laneMesh.position.set(0, 0, z);
    scene.add(laneMesh);

    let lane = { z: z, type: type, mesh: laneMesh, entities: [], speed: 0, dir: 1 };

    if (type === 0) {
        let numTrees = Math.floor(Math.random() * 4) + 1;
        let usedX = new Set();
        for (let i = 0; i < numTrees; i++) {
            let tx = Math.floor(Math.random() * (PLAY_WIDTH * 2 + 1)) - PLAY_WIDTH;
            if (tx === 0 && z >= -2 && z <= 2) continue;
            if (!usedX.has(tx)) {
                usedX.add(tx);
                let tree = new THREE.Mesh(geos.box, mats.tree);
                tree.position.set(tx, 1, z);
                scene.add(tree);
                lane.entities.push({ mesh: tree, x: tx, isTree: true });
            }
        }
        let w1 = new THREE.Mesh(geos.box, mats.tree); w1.position.set(-PLAY_WIDTH - 1, 1, z); scene.add(w1); lane.entities.push({ mesh: w1, x: -PLAY_WIDTH - 1, isTree: true });
        let w2 = new THREE.Mesh(geos.box, mats.tree); w2.position.set(PLAY_WIDTH + 1, 1, z); scene.add(w2); lane.entities.push({ mesh: w2, x: PLAY_WIDTH + 1, isTree: true });
    } else if (type === 1) {
        lane.dir = Math.random() < 0.5 ? 1 : -1;
        lane.speed = 3 + Math.random() * 4;
        let numCars = Math.floor(Math.random() * 2) + 1;
        let carMat = [mats.car1, mats.car2, mats.car3][Math.floor(Math.random() * 3)];
        for (let i = 0; i < numCars; i++) {
            let cx = (Math.random() * 20 - 10);
            let car = new THREE.Mesh(geos.box, carMat);
            car.scale.set(1.5, 0.8, 0.8);
            car.position.set(cx, 0.9, z);
            scene.add(car);
            lane.entities.push({ mesh: car, x: cx, w: 1.5 });
        }
    } else if (type === 2) {
        lane.dir = Math.random() < 0.5 ? 1 : -1;
        lane.speed = 2 + Math.random() * 3;
        let numLogs = Math.floor(Math.random() * 3) + 2;
        for (let i = 0; i < numLogs; i++) {
            let lx = (Math.random() * 20 - 10);
            let len = 2.5 + Math.random() * 2;
            let log = new THREE.Mesh(geos.box, mats.wood);
            log.scale.set(len, 0.6, 0.8);
            log.position.set(lx, 0.8, z);
            scene.add(log);
            lane.entities.push({ mesh: log, x: lx, w: len });
        }
    }

    lanes.push(lane);
}

function resetGame(seed) {
    Math.random = mulberry32(seed >>> 0);
    score = 0;
    lives = 1;
    gameState = 'PLAYING';

    for (let l of lanes) {
        scene.remove(l.mesh);
        for (let e of l.entities) scene.remove(e.mesh);
    }
    lanes = [];
    prevType = 0;
    typeCount = 0;
    maxZ_reached = 0;

    playerTargetX = 0;
    playerTargetZ = 0;
    playerJumpTimer = 0;
    onLog = null;
    player.position.set(0, 0.8, 0);

    lowestZ_generated = 5;
    while (lowestZ_generated >= -30) {
        generateLane(lowestZ_generated);
        lowestZ_generated--;
    }

    updateCamera(0);
}

function update(dt) {
    if (gameState !== 'PLAYING') return;
    dt = Math.min(dt, 0.1);

    let a = globalThis.currentAction;
    let dx = 0, dz = 0;

    if (playerJumpTimer <= 0) {
        if (a === 1) dx = -1;
        else if (a === 2) dx = 1;
        else if (a === 3) dz = -1;
        else if (a === 4) dz = 1;

        if (dx !== 0 || dz !== 0) {
            let nx = Math.round(playerTargetX + dx);
            let nz = Math.round(playerTargetZ + dz);

            if (nx >= -PLAY_WIDTH && nx <= PLAY_WIDTH) {
                let blocked = false;
                let targetLane = lanes.find(l => l.z === nz);
                if (targetLane && targetLane.type === 0) {
                    for (let e of targetLane.entities) {
                        if (e.isTree && Math.round(e.x) === nx) {
                            blocked = true; break;
                        }
                    }
                }

                if (!blocked) {
                    playerTargetX = nx;
                    playerTargetZ = nz;
                    playerJumpTimer = jumpDuration;
                    player.userData.startY = onLog ? 1.4 : 0.8;
                    onLog = null;
                }
            }
        }
    }

    if (playerJumpTimer > 0) {
        playerJumpTimer -= dt;
        let t = 1 - (playerJumpTimer / jumpDuration);
        if (t > 1) t = 1;

        player.position.x = THREE.MathUtils.lerp(player.position.x, playerTargetX, t);
        player.position.z = THREE.MathUtils.lerp(player.position.z, playerTargetZ, t);

        let targetLane = lanes.find(l => l.z === Math.round(playerTargetZ));
        let targetY = (targetLane && targetLane.type === 2) ? 1.4 : 0.8;
        let startY = player.userData.startY || 0.8;
        let baseY = THREE.MathUtils.lerp(startY, targetY, t);

        player.position.y = baseY + Math.sin(t * Math.PI) * 0.8;

        if (playerJumpTimer <= 0) {
            player.position.x = playerTargetX;
            player.position.z = playerTargetZ;
            checkLanding();
        }
    }

    for (let l of lanes) {
        if (l.type === 1 || l.type === 2) {
            for (let e of l.entities) {
                e.x += l.speed * l.dir * dt;
                if (l.dir === 1 && e.x > 12) e.x = -12;
                if (l.dir === -1 && e.x < -12) e.x = 12;
                e.mesh.position.x = e.x;
            }
        }
    }

    if (onLog && playerJumpTimer <= 0) {
        let drift = onLog.lane.speed * onLog.lane.dir * dt;
        playerTargetX += drift;
        player.position.x = playerTargetX;
    }

    checkCollisions();

    let currentZScore = -Math.round(playerTargetZ);
    if (currentZScore > score) {
        score = currentZScore;
    }
    if (playerTargetZ < maxZ_reached) {
        maxZ_reached = playerTargetZ;
    }

    while (lowestZ_generated > playerTargetZ - 30) {
        generateLane(lowestZ_generated);
        lowestZ_generated--;
    }

    for (let i = lanes.length - 1; i >= 0; i--) {
        if (lanes[i].z > playerTargetZ + 10) {
            scene.remove(lanes[i].mesh);
            for (let e of lanes[i].entities) scene.remove(e.mesh);
            lanes.splice(i, 1);
        }
    }

    updateCamera(dt);
}

function checkLanding() {
    let currentLane = lanes.find(l => l.z === Math.round(playerTargetZ));
    if (currentLane && currentLane.type === 2) {
        let landed = false;
        for (let e of currentLane.entities) {
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
    for (let l of lanes) {
        if (Math.abs(l.z - player.position.z) < 0.6) {
            if (l.type === 1) {
                for (let e of l.entities) {
                    if (Math.abs(player.position.x - e.x) < (e.w / 2 + 0.3)) {
                        gameState = 'GAMEOVER';
                    }
                }
            }
        }
    }

    if (playerJumpTimer <= 0) {
        let currentLane = lanes.find(l => l.z === Math.round(playerTargetZ));
        if (currentLane && currentLane.type === 2 && !onLog) {
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

function updateCamera(dt) {
    let targetCamZ = player.position.z + 6;
    if (dt === 0) {
        camera.position.set(0, 10, targetCamZ);
    } else {
        camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetCamZ, 10 * dt);
    }
    camera.lookAt(0, 0, camera.position.z - 6);
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
```

---

## Status

This template is ready for game generation. The headless runtime implementation in `node-gym/runtime/three/` is in progress — until it lands, generated games can be playtested in a browser via the node-gym tester but cannot be stepped headlessly for RL.

Open design questions tracked in `docs/llm/threejs-v2.md`.
