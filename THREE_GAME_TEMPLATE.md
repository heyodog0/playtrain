# Three.js Game Template Specification (v2 — DRAFT)

Standard interface for LLM-generated **Three.js** games targeting headless RL training via WebGPU/Dawn. Parallel to the p5 `GAME_TEMPLATE.md` — same action space, same observation contract, different lifecycle and rendering path.

> **Status:** draft. The headless runtime in `node-gym` does not yet support Three.js. Games written to this spec can be playtested in a browser today; the headless gauntlet (`just validate`, `just bench`) will work once `node-gym/runtime/three/` ships.

## Action Space

**Discrete(8)** — identical to p5 path. Same indices, same intent:

| Index | Name | Typical 3D meaning |
|---|---|---|
| 0 | NOOP | hold position |
| 1 | LEFT | strafe / turn left / lane left |
| 2 | RIGHT | strafe / turn right / lane right |
| 3 | UP | move forward / jump / pitch up |
| 4 | DOWN | move back / slide / pitch down |
| 5 | D | fire / boost / jump / interact |
| 6 | LEFT+D | strafe-and-fire combos |
| 7 | RIGHT+D | strafe-and-fire combos |

Unlike p5 (where input arrives via `keyIsDown` + `keyPressed`), Three.js games read the **current action index directly** from a global the runtime sets each frame:

```javascript
// Runtime sets this before every update(dt). 0..7.
globalThis.currentAction;
```

Games may map the integer to internal semantics however they want.

## Observation Space

- Renderer renders to a 64×64 (or larger) WebGPU texture; runtime reads it back as **64×64×3 uint8 RGB**.
- No frame stacking. Final shape: `(64, 64, 3)` — same as p5 path.
- The game does NOT downscale. Just render the scene; the runtime handles texture readback.

Recommended render target size: 256×256 to 512×512. Anything readable at 64×64.

## Required Game Interface

Every game is a single `.js` file that defines these globals:

```javascript
// ============================================================
// REQUIRED: Three.js lifecycle
// ============================================================

// Called once. Build scene, camera, lights, geometry, materials.
// Do NOT generate level layout here — defer to resetGame().
function setup({ THREE, renderer, width, height }) {
  // THREE: the three module passed in by the runtime
  // renderer: WebGPURenderer instance, already initialized
  // width, height: render-target dimensions in pixels
  globalThis.scene = new THREE.Scene();
  globalThis.camera = new THREE.PerspectiveCamera(70, width / height, 0.1, 100);
  // ... add lights, persistent meshes, etc.
}

// Called every frame, BEFORE render. Mutate scene state based on currentAction.
// dt is seconds since last update (fixed at 1/60 in headless mode).
function update(dt) {
  const action = globalThis.currentAction;  // 0..7
  // ... move player, advance physics, spawn obstacles, update score
}

// Called every frame, AFTER update. Render the scene.
function render() {
  globalThis.renderer.render(globalThis.scene, globalThis.camera);
}

// Called by the runtime on env.reset(). Initialize seeded state.
function resetGame(seed) {
  // Seed the RNG (mulberry32 pattern, same as p5 path)
  // Reset score, lives, gameState, scene contents
  // After this, getGameState().gameState should be 'PLAYING'
}

// Returns a small, stable JSON-serializable state object.
// Same shape as p5 path. Used for reward computation + termination.
function getGameState() {
  return {
    score: 0,        // monotonic; reward = score - lastScore
    lives: 1,
    gameState: 'PLAYING',  // or 'GAMEOVER', 'WIN', 'EXIT'
    // ... any extra fields useful for debugging (player position, etc.)
  };
}
```

## Determinism

Same contract as p5: **same seed + same action sequence ⇒ same trajectory.**

Achieve this by:
- Seeding `Math.random` in `resetGame(seed)` via mulberry32 (the runtime provides this).
- Using fixed timestep `dt = 1/60` (the runtime drives this).
- Avoiding any direct `Date.now()` / `performance.now()` in game logic — use frame counter instead.

The runtime's headless test harness will call `resetGame(seed)` then run a fixed action sequence twice, comparing the resulting frames pixel-for-pixel. Any divergence is a game bug.

## Rendering Constraints (from threejs-v2.md)

To keep generation reliable and headless throughput practical:

- **Primitive geometry only** at first: `BoxGeometry`, `SphereGeometry`, `PlaneGeometry`, `CylinderGeometry`, `ConeGeometry`. No imported models.
- **Minimal materials**: `MeshBasicMaterial`, `MeshNormalMaterial`, `MeshLambertMaterial`. Skip `MeshStandardMaterial`/PBR.
- **Minimal lighting**: at most one `AmbientLight` + one `DirectionalLight`.
- **No post-processing**, no shadows, no anti-aliasing, no `EffectComposer`.
- **No external assets**: no textures, no glTF, no audio. Color is enough.
- **No animation pipelines**: no `AnimationMixer`, no skinned meshes. Tween via direct property mutation.

These constraints exist because (a) every external asset is a generation failure mode, (b) post-processing and PBR balloon GPU memory and step time, (c) the goal is *the simplest 3D thing that's still 3D*.

## Reward & Termination

- `reward = state.score - lastScore` each step (delta on the monotonic score). Same as p5.
- `terminated = true` when `state.gameState ∈ {'GAMEOVER', 'WIN', 'EXIT'}`.
- `truncated = true` when step count hits `max_steps` (default 2000). Runtime handles this.

## Example: minimum viable game

A trivial one-action runner that demonstrates the full contract:

```javascript
let player, ground;
let frame = 0;
let score = 0;
let gameState = 'PLAYING';

function setup({ THREE, renderer, width, height }) {
  globalThis.scene = new THREE.Scene();
  globalThis.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);
  globalThis.camera.position.set(0, 2, 5);
  globalThis.camera.lookAt(0, 0, 0);

  ground = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 100),
    new THREE.MeshNormalMaterial(),
  );
  ground.rotation.x = -Math.PI / 2;
  globalThis.scene.add(ground);

  player = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.5, 0.5),
    new THREE.MeshNormalMaterial(),
  );
  globalThis.scene.add(player);
}

function update(dt) {
  if (gameState !== 'PLAYING') return;
  const action = globalThis.currentAction;
  if (action === 1) player.position.x -= 2 * dt;  // LEFT
  if (action === 2) player.position.x += 2 * dt;  // RIGHT
  player.position.x = Math.max(-5, Math.min(5, player.position.x));
  frame++;
  score = frame;  // survival = reward
  if (frame > 600) gameState = 'WIN';
}

function render() {
  globalThis.renderer.render(globalThis.scene, globalThis.camera);
}

function resetGame(seed) {
  frame = 0;
  score = 0;
  gameState = 'PLAYING';
  if (player) player.position.set(0, 0.25, 0);
}

function getGameState() {
  return { score, lives: 1, gameState };
}
```

## Open Questions (TODO before this leaves draft)

- **Determinism on GPU**: WebGPU pipeline state caching may introduce frame-1 vs frame-N differences. Need to verify two runs from same seed produce byte-identical pixels.
- **Throughput target**: p5 hits 5K–8K RL FPS per worker. Three.js will be slower — what's the floor we accept? threejs-v2.md says "not browser-automation speed" but doesn't pin a number.
- **Action injection vs key emulation**: this draft uses `globalThis.currentAction`. An alternative is to keep the p5-style `keyIsDown`/`keyPressed` shim so games written for p5 with optional Three.js renderer share more code. Decide before generating the catalog.
- **Single render target vs ping-pong**: currently `render()` writes to the configured swap-chain. For deterministic readback we may need an offscreen `RenderTarget`. Decide once the runtime is built.
