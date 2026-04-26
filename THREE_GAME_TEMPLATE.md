# Three.js Game Template Specification (v2)

Standard interface for LLM-generated **Three.js** games targeting headless RL training via WebGPU/Dawn. Parallel to the p5 `GAME_TEMPLATE.md` but **independent action space and observation contract** — v1 (p5) and v2 (Three.js) are separate benchmarks.

A single RL agent with a fixed CNN policy will train across all v2 games. The template guarantees a uniform action space, observation space, and game state interface. Anything game-specific lives inside `update(dt)` and `resetGame(seed)`.

> **Note**: For richer AAA-inspired games (Zelda OoT, Mario 3D, Monster Hunter, etc.), see `THREE_COMPLEX_TEMPLATE.md` — same action/observation contract, but targets larger multi-system games.

---

## Action Space

**Discrete(15)** — matches ProcGen exactly. Larger than v1's Discrete(8) so first-person 3D games can express turn + move + fire simultaneously without losing simultaneity to combos.

| Index | Name      | Typical 3D meaning                                  |
|------:|-----------|-----------------------------------------------------|
| 0     | NOOP      | hold position                                       |
| 1     | LEFT      | turn left / strafe left / lane left                 |
| 2     | RIGHT     | turn right / strafe right / lane right              |
| 3     | UP        | move forward / pitch up / jump                      |
| 4     | DOWN      | move back / pitch down / slide                      |
| 5     | UP+LEFT   | diagonal forward-left / forward-and-turn-left       |
| 6     | UP+RIGHT  | diagonal forward-right / forward-and-turn-right     |
| 7     | DOWN+LEFT | diagonal back-left                                  |
| 8     | DOWN+RIGHT| diagonal back-right                                 |
| 9     | A         | primary action — fire / interact / jump             |
| 10    | B         | secondary — alt-fire / strafe-mode / boost          |
| 11    | LEFT+A    | strafe-fire / lane-shift-fire                       |
| 12    | RIGHT+A   | strafe-fire / lane-shift-fire                       |
| 13    | UP+A      | move-and-fire (huge for FP shooters)                |
| 14    | DOWN+A    | back-and-fire                                       |

Games may interpret each index however they want; an agent learns the mapping from pixels and rewards. Games that don't need all 15 actions just ignore the extras (Stack uses ~1, Snake uses 4, Crossy Road uses 4 — same pattern as ProcGen where each game uses a subset).

Three.js games read the **current action index directly** from a global the runtime sets each frame (no `keyIsDown` / `keyPressed`):

```javascript
// Set by the runtime BEFORE every update(dt). Integer in [0, 15).
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


## Status

This template is ready for game generation. The headless runtime implementation in `node-gym/runtime/three/` is in progress — until it lands, generated games can be playtested in a browser via the node-gym tester but cannot be stepped headlessly for RL.

Open design questions tracked in `docs/llm/threejs-v2.md`.
