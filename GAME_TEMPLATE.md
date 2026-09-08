# Game Template Specification

Standard interface for LLM-generated p5.js games targeting headless RL training.

All games MUST conform to this spec. A single RL agent with a fixed CNN policy trains across all games — the template guarantees a uniform action space, observation space, and state interface.

## Action Space

**Discrete(8)** (`default8`) — identical across all games. Actions are abstract — games interpret them however they want. An agent learns what each action does from pixels and rewards, not from labels.

This follows ProcGen's design: ProcGen uses Discrete(15) with abstract directional + button combinations. Each of its 16 games interprets the same actions differently.

The runtime itself supports any discrete space declared in `runtime/action_spaces.json` (each action = held keys + optional press key + optional pointer/buttons/axes), selected per env by the operator (`action_space=` on every env class). **Generated games do not declare their own space**: they are authored against `default8` below — a game must remain playable under it, which is what keeps one fixed-policy-head agent trainable across the whole catalog. A custom space is a training-side choice layered on top.

### Pointer tier (mouse / gamepad input)

A game may additionally read the pointer through standard p5 globals — `mouseX`, `mouseY`, `mouseIsPressed`, and the `mousePressed()` callback — plus `gamepadAxes` (an array of 4 floats in [-1,1]). These exist in every runtime (headless native, headless Node, browser) and rest at `0 / false / centered`. Pointer games are driven by:

- **discrete analog presets** — actions carrying `pointer: [x, y]` (in [0,1]², canvas-relative; *latched* — it stays where the last action put it), `buttons: ["mouse"]` (*absolute* per step; a press edge fires `mousePressed()`), and `axes` (*absolute*; snap back to center). See `aimgrid18`.
- **box spaces** — `{"type": "box", "channels": [...]}` exposing a continuous `gym.spaces.Box` over `pointer_x` / `pointer_y` / `button:*` / `axis:*` / `key:*` channels, every channel absolute each step. See `mouse2d`, `gamepad2s`.

All analog values are **quantized to uint16 at the producer** (`q = floor(clamp(v01)·65535 + 0.5)`, dequantized `q/65535` identically in every engine) — continuous from the policy's view, bit-exact for replay and the cross-engine gate. A human playing in the browser tester goes through the same quantized channel.

Pointer games must still boot and terminate under keyboard-only random play (the validation suite runs `default8`), and should not depend on inherited stroke/fill state (`tests/games/aim_trainer.js` is the reference).

| Index | Name | Keys Held | Key Pressed |
|-------|------|-----------|-------------|
| 0 | NOOP | — | — |
| 1 | LEFT | ← | — |
| 2 | RIGHT | → | — |
| 3 | UP | ↑ | — |
| 4 | DOWN | ↓ | — |
| 5 | D | — | SPACE |
| 6 | LEFT+D | ← | SPACE |
| 7 | RIGHT+D | → | SPACE |

**D is a generic action button.** Each game decides what it means:

| Game type | LEFT/RIGHT | UP/DOWN | D |
|-----------|------------|---------|---|
| Platformer | Move | Climb/duck | Jump |
| Shooter | Move | Aim | Fire |
| Angry Birds | Aim angle | Adjust power | Launch |
| Suika | Move drop pos | — | Drop |
| Snake | Turn left/right | Turn up/down | — (unused) |
| Breakout | Move paddle | — | — (unused) |

Games that don't need all 8 actions simply ignore the extras.

Games read input through `keyIsDown(code)` and the `keyPressed()` callback — same as standard p5.js. The runtime injects key state before each `draw()` call.

Key codes: LEFT_ARROW=37, UP_ARROW=38, RIGHT_ARROW=39, DOWN_ARROW=40, SPACE=32.

**FIRE / action 5 contract:** Actions 5/6/7 deliver SPACE as a one-frame
press. Both detection patterns work — use whichever fits the game:

- `keyIsDown(32)` returns `true` for exactly one frame per press (idiomatic
  for arcade shoot loops, e.g. `if (keyIsDown(32) && cooldown === 0) fire()`).
- `keyPressed()` is also invoked once per press with `keyCode === 32`
  (idiomatic for one-shot menu/launch logic).

Do **not** assume SPACE is held across multiple frames the way arrow keys
are while their action is selected — each "press" is a discrete one-frame
event regardless of how many consecutive steps choose action 5.

**Runtime action mapping (for reference):**

```javascript
const ACTIONS = [
  { name: 'NOOP',    held: [],   press: null },
  { name: 'LEFT',    held: [37], press: null },
  { name: 'RIGHT',   held: [39], press: null },
  { name: 'UP',      held: [38], press: null },
  { name: 'DOWN',    held: [40], press: null },
  { name: 'D',       held: [],   press: 32 },
  { name: 'LEFT+D',  held: [37], press: 32 },
  { name: 'RIGHT+D', held: [39], press: 32 },
];
```

## Observation Space

- Canvas: any size in-game, downscaled to **64x64 RGB** by the runtime
- **No frame stacking** — single frame, 3 color channels → final observation shape: `(64, 64, 3)` uint8
- The game does NOT handle downscaling or color conversion
- This matches ProcGen's observation spec exactly

Recommended canvas size: 256x256 to 512x512. Anything that looks readable at 64x64.

## Required Game Interface

Every game file is a single `.js` file that defines these globals:

```javascript
// ============================================================
// REQUIRED: p5.js lifecycle
// ============================================================

function setup() {
  // Create canvas, initialize constants.
  // Do NOT generate level here — that happens in resetGame().
  createCanvas(400, 400);
}

function draw() {
  // Main game loop. Called once per tick by the runtime.
  // Read input via keyIsDown(), update state, render frame.
  // For Matter.js games: call Matter.Engine.update(engine, 16.67) here.
}

// ============================================================
// REQUIRED: RL interface
// ============================================================

function getGameState() {
  // Return current game state. Called by the runtime after every draw().
  return {
    score: Number,       // cumulative score (reward = delta per step)
    lives: Number,       // remaining lives; 0 triggers GAMEOVER
    gameState: String,   // one of: 'PLAYING', 'WIN', 'GAMEOVER'
  };
}

function resetGame(seed) {
  // Full reset. Called by the runtime to start a new episode.
  // MUST:
  //   1. Initialize the seeded RNG: rng = mulberry32(seed)
  //   2. Reset score to 0, lives to starting value
  //   3. Set gameState to 'PLAYING'
  //   4. Generate the level procedurally using rng
  //   5. Reset all entity positions, timers, and physics state
  // For Matter.js games: clear and rebuild the Matter.js world here.
}

// ============================================================
// REQUIRED: seeded RNG (copy this verbatim)
// ============================================================

let rng = null;

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let n = Math.imul(t ^ (t >>> 15), t | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

// Use rng() instead of Math.random() for ALL randomness.
// Example: let x = Math.floor(rng() * width);
```

## What the Seed Controls (game-specific procedural generation)

The seed MUST determine:
- Level layout (terrain, platforms, walls, maze structure)
- Entity spawn positions (enemies, collectibles, obstacles)
- Item/powerup placement and types
- Any randomized parameters (enemy speed, gap sizes, spawn timing)
- Visual variation (color palettes, decorative elements) — encouraged but optional

The seed MUST NOT affect:
- Core mechanics (gravity, movement speed, rules)
- Action mappings
- Reward structure
- Canvas size

## Reward Design

- `score` starts at 0 on reset
- `score` must increase when the agent does something good (collect item, clear obstacle, kill enemy, progress further)
- `score` may decrease on bad events (lose life, hit obstacle) — use negative deltas sparingly
- The runtime computes `reward = score_now - score_prev` each step
- Design scores so that a random agent gets near-zero reward and a skilled agent gets high reward

## Terminal Conditions

| gameState | Meaning | When |
|-----------|---------|------|
| `'PLAYING'` | Episode in progress | Default after reset |
| `'WIN'` | Agent completed the objective | Level cleared, goal reached |
| `'GAMEOVER'` | Agent failed | Lives == 0, fatal collision |

The runtime also enforces a `maxSteps` truncation (default 2000). Games do not need to handle this.

## Matter.js Games (Physics)

For games requiring rigid body physics (Angry Birds, Suika, etc.):

```javascript
// Matter.js is available as a global: Matter
// Access via: Matter.Engine, Matter.World, Matter.Bodies, etc.

let engine, world;

function setup() {
  createCanvas(400, 400);
  // Do NOT create the engine here — do it in resetGame()
}

function resetGame(seed) {
  rng = mulberry32(seed);
  score = 0;
  lives = 3;
  gameState = 'PLAYING';

  // Create fresh physics world each reset
  engine = Matter.Engine.create();
  world = engine.world;
  engine.gravity.y = 1;

  // Add ground, walls, etc.
  let ground = Matter.Bodies.rectangle(200, 390, 400, 20, { isStatic: true });
  Matter.World.add(world, [ground]);

  // Procedurally generate level using rng
  generateLevel(rng);
}

function draw() {
  // Fixed timestep physics update (deterministic)
  Matter.Engine.update(engine, 1000 / 60);

  // Render: read body positions, draw with p5.js
  background(200);
  for (let body of Matter.Composite.allBodies(world)) {
    // ... draw body using rect(), ellipse(), etc.
  }

  // Game logic: check collisions, update score, etc.
}
```

**Determinism guarantee**: Matter.js with fixed timestep + identical initial conditions = identical simulation. All initial conditions come from the seeded RNG, so replays are bit-identical.

## File Structure

```
examples/games/js/
  flappy_bird.js     # Game source (conforms to this template)
  bigfish.js         # ProcGen replica
  qbert.js           # Atari replica
  jump_king.js
  ...
```

Each file is a self-contained game. No imports, no modules — all game code in a single file. The runtime provides p5.js globals and (optionally) Matter.js globals before execution.

## Visual Design Rules

The agent sees the game as a **64x64 RGB image**. Every visual decision must serve that constraint. Think ProcGen / Atari 2600, not modern mobile game.

### Color and Contrast
- **Black or dark background** — maximizes contrast with game elements
- **Use color to encode meaning** — red = danger/enemies, green = collectibles/safe, blue = player, yellow = coins/points. The agent has full RGB, so color IS information
- **Distinct color per element type**: player, enemies, collectibles, and terrain should each be a different hue. Don't use similar colors for different entity types
- **No gradients, shadows, glow effects, or alpha transparency** — these become muddy blobs at 64x64
- **Solid fills only** — `fill()` + `rect()`/`ellipse()`, no complex rendering

### Size and Shape
- **Minimum entity size: 6x6 pixels** on the source canvas (scales to ~1px at 64x64 — edge of visibility). Prefer 10x10+ for important entities
- **Player should be at least 12x12 pixels** on the source canvas
- **Use distinct shapes per entity type**: player = rectangle, enemies = circles, collectibles = small squares, terrain = large rectangles. Shape + color differentiation helps the CNN
- **No fine detail** — no 1px lines, no small dots, no intricate patterns

### HUD and Text
- **No text-based HUD** — text is unreadable at 64x64. The agent cannot read "Score: 150"
- **No title screens, menus, or instructions** — `resetGame()` goes straight to gameplay
- **No pause screens or cutscenes** — every frame is gameplay
- If you must show score visually, use a **bar or block indicator** at the screen edge, not text

### What NOT to Render
- Decorative backgrounds (starfields, clouds, grass patterns)
- Particle effects (explosions, sparkles, trails)
- Screen shake or visual transitions
- Drop shadows or outlines on entities
- Antialiased or rounded visual flourishes

### Reference Style
Think: **ProcGen**. Flat colored rectangles, circles, and lines on a dark background. Bright, distinct colors per entity type. Every pixel on screen either means something to gameplay or is background.

## Mechanical Simplicity Rules

Games must be simple enough that an RL agent can learn a basic policy within 1-5 million steps. Complexity kills learning.

### Core Mechanic
- **One core mechanic per game** — "jump over obstacles", "shoot enemies", "collect items while avoiding hazards". Not all three combined
- **The core mechanic must be exercisable within 10 steps** — the agent shouldn't need 500 steps of preamble before gameplay starts
- **No multi-phase gameplay** — no "first collect keys, then unlock doors, then fight boss". One continuous loop
- **No inventory, crafting, or resource management** beyond simple counters (lives, ammo)

### Difficulty and Pacing
- **Immediate reward signal** — the agent should encounter its first positive reward opportunity within 20-50 steps of random play
- **Frequent scoring opportunities** — at least one chance to score every 50-100 steps
- **Gradual difficulty** — early seeds/levels should be easy enough that random agents occasionally score; later seeds should be challenging
- **Death should be possible but not instant** — give the agent a few lives so it can learn from mistakes within an episode

### What NOT to Include
- Shops, upgrades, or progression systems
- Multiple weapon types or character classes
- Story, dialogue, or narrative elements
- Tutorial sequences
- Complex state machines (charge attacks, combo systems, stance switching)

## Constraints for LLM Generation

When prompting an LLM to generate games:

1. **Single file, no imports** — all game code in one `.js` file
2. **No DOM access** — no `document.getElementById`, no CSS, no HTML elements
3. **No async/await** — `draw()` is synchronous
4. **No images/audio** — render everything with drawing primitives (rect, ellipse, line, text)
5. **No setTimeout/setInterval** — the runtime controls frame timing via `tick()`
6. **All randomness via `rng()`** — never use `Math.random()`
7. **Keyboard input only** — no mouse, no touch, no gamepad
8. **Score must be meaningful** — a random-action agent should score near zero; a skilled agent should score high
9. **Episodes must terminate** — games must reach WIN or GAMEOVER within reasonable play, not run forever
10. **ProcGen-style visuals** — dark background, distinct colors per entity type, solid shapes, no text HUD, no decorations (see Visual Design Rules above)
11. **One core mechanic** — simple, learnable, immediate reward (see Mechanical Simplicity Rules above)

## Validation Checklist

A game passes validation if:

- [ ] `resetGame(seed)` runs without error
- [ ] `getGameState()` returns `{ score: Number, lives: Number, gameState: 'PLAYING' }`
- [ ] 200 steps with seed=42 + identical actions produce bit-identical frames (determinism)
- [ ] Frames are non-degenerate (not all one color, multiple unique pixel values)
- [ ] Score changes at least once in 500 random-action steps
- [ ] Game reaches GAMEOVER or WIN within 5000 random-action steps
- [ ] No errors/exceptions during 1000 random-action steps
