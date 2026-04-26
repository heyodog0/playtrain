# engine/three — Raylib-style API on Three.js + Dawn WebGPU

A small, opinionated game-engine layer designed for **LLM-authored 3D RL games**. The API mimics [Raylib](https://www.raylib.com/cheatsheet/cheatsheet.html)'s naming and signatures (which LLMs have seen thousands of times in training data) but the implementation runs on Three.js + Dawn WebGPU for headless rendering.

**Why this exists**: pure Three.js requires every game to invent its own camera/lighting/palette/polish patterns from scratch. Output quality varied wildly (some great, some bland). This module standardizes the boring parts (visual quality floor, determinism, RL contract) so the LLM can focus on game-specific mechanics.

**Architecture**: thin retained-mode wrapper. Despite raylib-style verbs (`drawCube`, `drawSphere`), the entities you create persist across frames. Mutate their `.position`/`.scale` in `update()`, call `render()` once per frame.

**Reference**: `reference/raylib/raylib.h` is the canonical source; this module ports a subset.

---

## Quickstart

```js
const engine = await import('engine/three/index.mjs');
const {
  setupGame, drawSphere, drawOctahedron, drawPlane, drawGrid,
  CAMERA_THIRD_PERSON, palette, BLUE, GOLD, DARKGRAY, LIGHTGRAY,
  checkCollisionSpheres, mulberry32, getCurrentAction, render,
} = engine;

let world, camera, player, goal;
let score = 0, lives = 1, gameState = 'PLAYING';

function setup({ THREE, renderer, width, height }) {
  ({ world, camera } = setupGame({
    THREE, renderer, width, height,
    cameraMode: CAMERA_THIRD_PERSON,
    cameraOpts: { position: [0, 8, 8], target: [0, 0, 0] },
  }));

  drawPlane(world, [0, 0, 0], [20, 20], DARKGRAY);
  drawGrid(world, 20, 1, LIGHTGRAY);
  player = drawSphere(world, [0, 0.5, 0], 0.4, BLUE);
  goal = drawOctahedron(world, [4, 0.5, 4], 0.4, GOLD);
}

function update(dt) {
  if (gameState !== 'PLAYING') return;
  const a = getCurrentAction();
  if (a === 1) player.position.x -= 5 * dt;
  if (a === 2) player.position.x += 5 * dt;
  if (a === 3) player.position.z -= 5 * dt;
  if (a === 4) player.position.z += 5 * dt;
  goal.rotation.y += 2 * dt;

  if (checkCollisionSpheres(player.position, 0.4, goal.position, 0.4)) {
    score += 10;
    gameState = 'WIN';
  }
}

function renderFn() { render(world); }

function resetGame(seed) {
  Math.random = mulberry32(seed >>> 0);
  score = 0;
  gameState = 'PLAYING';
  player.position.set(0, 0.5, 0);
  goal.position.set((Math.random() - 0.5) * 8, 0.5, (Math.random() - 0.5) * 8);
}

function getGameState() { return { score, lives, gameState }; }
```

That's a complete game in ~40 lines. The engine handles camera, lighting, palette, geometry/material pooling, and the rendering pipeline.

---

## Color palette (use these — never hardcode hex)

Ported from raylib. Saturated, semantically usable.

**Function-encoded** (use these for game-state semantics):
- `palette.goal` (gold) — collectibles, win targets
- `palette.hostile` (red) — enemies, instant-death obstacles
- `palette.passive` (sky blue) — neutral entities
- `palette.player` (white) — the player avatar
- `palette.safe` (green) — safe zones
- `palette.hazard` (maroon) — dangerous surfaces
- `palette.pickup` (gold) — score-bumping items
- `palette.ground` (dark gray) — floor planes
- `palette.wall` (gray) — walls / obstacles
- `palette.sky` (sky blue) — backgrounds

**Raw colors** (use directly when semantic doesn't fit):
```
RAYWHITE, LIGHTGRAY, GRAY, DARKGRAY,
YELLOW, GOLD, ORANGE, PINK, RED, MAROON,
GREEN, LIME, DARKGREEN,
SKYBLUE, BLUE, DARKBLUE,
PURPLE, VIOLET, DARKPURPLE,
BEIGE, BROWN, DARKBROWN,
WHITE, BLACK, MAGENTA, BLANK
```

Each is an integer hex value usable directly with any draw function.

---

## Camera modes

```js
CAMERA_FREE          // game manages camera explicitly
CAMERA_FIRST_PERSON  // POV — uses target.yaw + target.position
CAMERA_THIRD_PERSON  // chase cam — smooth lerp toward target + offset
CAMERA_ORBITAL       // orbits around target at fixed distance
CAMERA_FIXED_TOPDOWN // static iso-ish for grid games (recommended for box_pusher / snake / tetris-like)
CAMERA_FOLLOW_2D     // sidewalls runner — follows on z, fixed x/y
```

`updateCamera(camera, target, dt, opts)` smoothly updates the camera based on the mode + target entity. Call once per frame:

```js
function update(dt) {
  // ... game logic ...
  updateCamera(camera, player, dt, { distance: 8, height: 4, smoothing: 8 });
}
```

For `CAMERA_FIXED_TOPDOWN`, set the camera once in setup and don't call updateCamera (or pass mode CAMERA_CUSTOM).

---

## API surface

### World setup (call once in setup())

```js
const { world, camera } = setupGame({ THREE, renderer, width, height, cameraMode, cameraOpts });
// or step-by-step:
const world = initWorld({ THREE, renderer, width, height });
const camera = new Camera3D({ THREE, position, target, fovy, mode });
beginMode3D(world, camera);

setBackground(world, SKYBLUE);
setupLighting(world, '3point' | 'ambient' | 'dramatic');  // '3point' is the default
```

### Drawing primitives — all return a Mesh handle (mutate .position/.rotation/.scale freely)

```js
drawCube(world, position, width, height, length, color)
drawCubeV(world, position, sizeVec3, color)
drawSphere(world, centerPos, radius, color, opts?)         // opts.segments default 16
drawCylinder(world, position, radiusTop, radiusBottom, height, sides, color)
drawCone(world, position, radius, height, sides, color)
drawOctahedron(world, position, radius, color)             // great for goals/pickups
drawPlane(world, centerPos, sizeVec2, color)               // XZ plane (auto rotated)
drawGrid(world, slices, spacing, color?)                   // line grid for visual depth
drawLine3D(world, startPos, endPos, color)
removeMesh(world, mesh)
clearWorld(world)                                          // remove ALL meshes (call from resetGame)
```

`position` accepts `[x, y, z]` arrays, `{x, y, z}` objects, or `THREE.Vector3` instances.

### Camera & render

```js
beginMode3D(world, camera)        // set active camera
endMode3D(world)                   // no-op (kept for raylib parity)
render(world, camera?)             // draw scene; uses active camera if not passed
updateCamera(camera, target, dt, opts?)   // preset-mode camera update
```

### Collision

```js
checkCollisionSpheres(c1, r1, c2, r2)         // → bool
checkCollisionBoxes(box1, box2)                // boxes can be {min, max} or {x, y, z, width, height, depth}
checkCollisionBoxSphere(box, center, radius)
```

### Math

```js
clamp(v, lo, hi), lerp(a, b, t), smoothLerp(current, target, dt, k=8)
Vector3.add(a, b), .sub(a, b), .scale(v, s)
Vector3.distance(a, b), .distanceSq(a, b), .length(v), .normalize(v)
Vector3.zero(), .one()
```

### Determinism / RL contract

```js
mulberry32(seed)            // → seeded RNG. Always do `Math.random = mulberry32(seed)` in resetGame.
getCurrentAction()          // → globalThis.currentAction (integer 0..14)
```

### Polish (deterministic, RL-safe)

```js
spawnParticleBurst(world, pos, color, opts?)   // opts: count=8, speed=4, life=0.5, size=0.1
updateTransients(world, dt)                     // call once per frame to advance/cull particles
flashFor(mesh, flashColor, frames=6)            // set deterministic flash counter
tickFlashes(world, [meshes...])                 // advance counters + restore materials
```

`hitFlash(world, mesh, color, durationMs)` is also exported but uses `setTimeout` — **non-deterministic, browser-only**. Use `flashFor` + `tickFlashes` for headless RL.

---

## Required game contract (unchanged from previous template)

Every game must define these globals:

```js
function setup({ THREE, renderer, width, height })  // once at session start
function update(dt)                                  // per frame, before render
function render()                                    // per frame, after update
function resetGame(seed)                             // per episode
function getGameState() { return { score, lives, gameState }; }
```

- `gameState ∈ {'PLAYING', 'WIN', 'GAMEOVER', 'EXIT'}`
- `reward = score - lastScore` each step (engine-internal — make `score` monotonic)
- `terminated` when gameState ≠ 'PLAYING'
- `truncated` when step count hits `max_steps` (default 2000)
- Action is `globalThis.currentAction`, integer 0..14 (Discrete(15))

---

## What this engine does for you (vs writing pure Three.js)

| Without the engine | With the engine |
|---|---|
| Invent camera setup per game | `setupGame({ cameraMode: CAMERA_THIRD_PERSON })` |
| Choose lighting per game | Auto: 3-point lighting that flatters primitives |
| Pick colors ad hoc | Semantic palette (`palette.goal`, `palette.hostile`) |
| Hit Dawn shader bugs at scale | Pooled materials/geometries — never N distinct material IDs |
| Write tween/particle from scratch | `spawnParticleBurst` / `flashFor` / `smoothLerp` ready |
| Copy-paste mulberry32 each game | Imported, RL contract documented |
| Variable visual quality | Consistent floor — ground, lighting, palette baked in |

Variance drops; novelty stays high (you still write the gameplay).

---

## What this engine does NOT do (yet)

- **Physics**: no Rapier3d/Cannon-es integration. For physics-needing games (marble tilt, projectiles), use the helpers + manual integration. Future: optional `engine/three/physics.mjs` wrapper.
- **Input handling**: read `globalThis.currentAction` directly. The browser tester maps keys; the headless runtime injects per step.
- **Audio**: not relevant for headless RL.
- **Asset loading**: no glTF/textures by design — primitive geometry only.
- **Animation system**: deterministic frame-counter-based motion only. No AnimationMixer.

---

## Performance

Smoke-tested on M4 Pro at 84×84 render target via Dawn WebGPU:
- ~993K tick FPS (game logic only)
- ~4300 render FPS (with WebGPU draw)
- ~2500 RL step FPS (with pixel readback)

Material/geometry pooling means N entities of the same color/shape share one Material+Geometry, avoiding the Three.js NodeMaterial pipeline blow-up that affected first-gen v2 games.

---

## References

- [Raylib cheat sheet](https://www.raylib.com/cheatsheet/cheatsheet.html) — canonical API surface
- [Raylib examples / models](https://github.com/raysan5/raylib/tree/main/examples/models) — 30+ 3D usage examples
- [DMLab paper (Beattie et al. 2016)](https://arxiv.org/abs/1612.03801) — engine + level architecture this echoes
- [ProcGen (Cobbe et al. 2019)](https://arxiv.org/abs/1912.01588) — Discrete(15) + train/test seed split convention
- `reference/raylib/raylib.h` — local copy of the header we port from
