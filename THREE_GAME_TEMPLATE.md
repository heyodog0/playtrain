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

## Rendering Constraints

To keep generation reliable and headless throughput practical, use only:

- **Geometry**: `BoxGeometry`, `SphereGeometry`, `PlaneGeometry`, `CylinderGeometry`, `ConeGeometry`, `OctahedronGeometry`. No imported models, no `BufferGeometry` from raw vertices unless trivially small.
- **Materials**: `MeshBasicMaterial`, `MeshNormalMaterial`, `MeshLambertMaterial`. Skip `MeshStandardMaterial`/`MeshPhysicalMaterial` (PBR is slow + nondeterministic across drivers).
- **Lights**: at most one `AmbientLight` + one `DirectionalLight`. No point/spot/area lights.
- **No post-processing**: no `EffectComposer`, no shadow maps, no anti-aliasing, no tone-mapping passes.
- **No external assets**: no textures, no glTF/OBJ, no audio. Color the geometry directly.
- **No animation pipelines**: no `AnimationMixer`, no skinned meshes. Tween via direct property mutation in `update()`.

These constraints exist because (a) every external asset is a generation failure mode, (b) post-processing balloons GPU memory and per-step cost, (c) the goal is *the simplest 3D thing that's still 3D*.

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

---

## Complete Example: `cube_collector`

A minimal but complete game showing reset, scoring, and a state transition:

```javascript
let player, goal;
let score = 0, lives = 3, gameState = 'PLAYING';
let frame = 0;

function setup({ THREE, renderer, width, height }) {
  globalThis.scene = new THREE.Scene();
  globalThis.scene.background = new THREE.Color(0x202030);
  globalThis.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);
  globalThis.camera.position.set(0, 8, 8);
  globalThis.camera.lookAt(0, 0, 0);

  globalThis.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dl = new THREE.DirectionalLight(0xffffff, 0.8);
  dl.position.set(5, 10, 5);
  globalThis.scene.add(dl);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshLambertMaterial({ color: 0x303040 }),
  );
  ground.rotation.x = -Math.PI / 2;
  globalThis.scene.add(ground);

  player = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({ color: 0x4dc3ff }),
  );
  globalThis.scene.add(player);

  goal = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.5),
    new THREE.MeshLambertMaterial({ color: 0xffd54d }),
  );
  globalThis.scene.add(goal);
}

function update(dt) {
  if (gameState !== 'PLAYING') return;
  frame++;
  const a = globalThis.currentAction;
  const speed = 6;
  if (a === 1) player.position.x -= speed * dt;
  if (a === 2) player.position.x += speed * dt;
  if (a === 3) player.position.z -= speed * dt;
  if (a === 4) player.position.z += speed * dt;
  player.position.x = Math.max(-9, Math.min(9, player.position.x));
  player.position.z = Math.max(-9, Math.min(9, player.position.z));

  // Bobbing goal animation (deterministic — uses frame, not wall clock)
  goal.position.y = 0.5 + 0.2 * Math.sin(frame * 0.1);

  const dx = player.position.x - goal.position.x;
  const dz = player.position.z - goal.position.z;
  if (dx * dx + dz * dz < 1.0) {
    score += 10;
    goal.position.set((Math.random() - 0.5) * 16, 0.5, (Math.random() - 0.5) * 16);
  }

  if (frame >= 1800) gameState = 'WIN';
}

function render() {
  globalThis.renderer.render(globalThis.scene, globalThis.camera);
}

function resetGame(seed) {
  Math.random = mulberry32(seed >>> 0);
  score = 0;
  lives = 3;
  frame = 0;
  gameState = 'PLAYING';
  player.position.set(0, 0.5, 0);
  goal.position.set((Math.random() - 0.5) * 16, 0.5, (Math.random() - 0.5) * 16);
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
