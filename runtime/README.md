# node-gym

**Headless Node.js game environments for Python Gymnasium.** Run JavaScript games — p5.js sketches, Matter.js physics simulations, Three.js scenes — as RL environments without a browser.

- **30 p5 + 16 three.js bundled games** (Procgen-inspired, plus classics like Flappy Bird, Breakout, Suika; 3D titles inspired by Mario 64, Zelda, Temple Run)
- **Standard Gymnasium API** — drop into Stable-Baselines3, CleanRL, RLlib, or your own training loop
- **Headless** — pure Node.js subprocess, no Selenium / Playwright / Chromium
- **Fast** — mean ~4300 FPS (p5) / ~1300 FPS (three.js + WebGPU/Dawn) per env on M4 Pro; binary IPC + mmap obs transfer

## Install

Requires Node ≥18 and `uv`, `pnpm`, `just`. The repo's `bootstrap.sh` installs whichever of those three are missing (idempotent — safe to re-run). `uv` handles Python itself, no system Python needed.

```bash
git clone https://github.com/heyodog0/node-gym
cd node-gym
./bootstrap.sh             # only if you don't already have uv / pnpm / just
just install               # pnpm install + uv sync
just test                  # boot every bundled game + API checks (53 tests)
```

## Quickstart

```python
from node_gym import NodeGymEnv

env = NodeGymEnv(game="flappy_bird")
obs, info = env.reset(seed=0)

for _ in range(1000):
    action = env.action_space.sample()
    obs, reward, terminated, truncated, info = env.step(action)
    if terminated or truncated:
        obs, info = env.reset()

env.close()
```

`obs` is a `(64, 64, 3)` uint8 numpy array; `action` is a discrete int in `[0, 8)`.

## Vectorised env (`NodeVecEnv`)

For RL training, use `NodeVecEnv` instead of wrapping `NodeGymEnv` in
`SubprocVecEnv`. One Python process drives N Node workers via direct
stdin/stdout pipes + mmap obs (zero-copy into a pre-allocated batch).
Eliminates the per-env child Python process and obs pickle round-trip.

```python
from node_gym import NodeVecEnv

venv = NodeVecEnv(games=["flappy_bird"] * 8, obs_size=64,
                  autoreset_mode="next_step")  # Gymnasium 1.0 default
obs, info = venv.reset(seed=0)
for _ in range(1000):
    actions = venv.action_space.sample()
    obs, rewards, terms, truncs, info = venv.step(actions)
venv.close()
```

Subclasses `gymnasium.vector.VectorEnv` with all three Gymnasium 1.0
autoreset modes:

| `autoreset_mode=` | Behavior |
|---|---|
| `"next_step"` (default) | Gymnasium 1.0 spec — terminal obs returned this step; env reset before next step (the next step's action for that env is discarded) |
| `"same_step"` | SB3-compatible — terminal obs stashed in `info["final_observation"]` (mask in `info["_final_observation"]`); reset obs returned this step |
| `"disabled"` | Caller resets terminated envs explicitly |

**Benchmarks (FASRC, job 12978195, real torch+cuda training-loop A/B):**

| game | N | SubprocVecEnv | NodeVecEnv | Δ |
|---|---|---|---|---|
| flappy_bird | 8 | 6,171 sps | 7,267 sps | **+17.8%** |
| analogen grid_v4 | 8 | 5,520 sps | 6,281 sps | **+13.8%** |
| analogen grid_v4 | 16 | 5,402 sps | 6,133 sps | +13.5% |

Pure env throughput is +71-121% (job 12972050); the +14% training-loop
delta is what survives once GPU-side compute (~64% of per-update wall)
is in the loop. See `docs/MULTI_ENV_RUNTIME.md` for the full design.

**Limitations**: action space hardcoded to `Discrete(8)` (matches
`NodeGymEnv`); not yet a drop-in for SB3's `VecEnvWrapper`-based
trainers (use SAME_STEP mode + a thin shim if needed); single-game per
worker (multi-game support exists but lightly tested).

## Using node-gym in another project

`just install` only sets up node-gym's own venv. To consume from a different project:

```bash
cd ~/my-rl-project
uv pip install -e /path/to/node-gym       # or: pip install -e /path/to/node-gym
```

The Python wrapper resolves the JS runtime via `<cloned-repo>/runtime/`, so `pnpm install` must have been run inside the cloned `node-gym/` (its own `node_modules/` provides `canvas`, `matter-js`). Override the runtime location via `NodeGymEnv(runtime_dir=...)` or the `NODE_GYM_RUNTIME` env var.

## Play a game in your browser

```bash
just play                 # picker UI at http://localhost:5050
just play flappy_bird     # jump straight to one
```

Each game page runs the game directly (no headless runtime in the loop) with a Reset button + live `getGameState()` overlay.

## Action space

8 discrete actions, ProcGen-compatible:

| Action | Meaning            |
|--------|--------------------|
| 0      | NOOP               |
| 1      | LEFT               |
| 2      | RIGHT              |
| 3      | UP                 |
| 4      | DOWN               |
| 5      | D / SPACE          |
| 6      | LEFT + D           |
| 7      | RIGHT + D          |

## Bundled games

**p5 (30):** `angry_birds`, `asteroids`, `bigfish`, `bossfight`, `breakout`, `caveflyer`, `chaser`, `climber`, `coinrun`, `crossy_road`, `dodgeball`, `downwell`, `flappy_bird`, `freeway`, `frostbite`, `fruitbot`, `heist`, `jetpack_joyride`, `jumper`, `leaper`, `mario`, `maze`, `miner`, `ninja`, `plunder`, `sonic`, `space_invaders`, `starpilot`, `suika`, `vvvvvv`

**three.js (16):** `ball_roller`, `bomberman_3d`, `box_pusher`, `crossy_road_3d`, `helix_jump`, `mario_3d_world`, `mario_64`, `megaman_3d`, `metroid_prime`, `runner_3d`, `snake_3d`, `stack_drop`, `temple_run`, `tile_2048`, `zelda_dungeon`, `zelda_oot_world`

## Custom games

Drop your own p5.js / Matter.js game into a directory and point at it:

```python
env = NodeGymEnv(game="my_game", games_dir="/path/to/my/games")
```

Each game is a single `.js` file exposing `setup()`, `draw()`, `resetGame()`, and `getGameState()`. See [`examples/games/js/flappy_bird.js`](examples/games/js/flappy_bird.js) for the simplest example.

## Train/test seed splits

ProcGen-style generalization splits via `SeedRangeWrapper`:

```python
from node_gym import NodeGymEnv, SeedRangeWrapper

train_env = SeedRangeWrapper(NodeGymEnv(game="coinrun"), seed_low=0,    seed_high=200)
test_env  = SeedRangeWrapper(NodeGymEnv(game="coinrun"), seed_low=1000, seed_high=1100)
```

## Configuration

| Constructor arg | Default            | Env var override        |
|-----------------|--------------------|-------------------------|
| `game`          | required           | —                       |
| `games_dir`     | bundled examples   | `NODE_GYM_GAMES_DIR`    |
| `runtime_dir`   | bundled `runtime/` | `NODE_GYM_RUNTIME`      |
| `obs_size`      | 64                 | —                       |
| `obs_mode`      | `"rgb"`            | —                       |
| `frame_stack`   | 1                  | —                       |
| `max_steps`     | 2000               | —                       |
| `node_bin`      | `"node"`           | —                       |

## Validation

Check bundled games against ProcGen-style criteria — Gymnasium API compliance, determinism, observation sanity, reward/terminal correctness, and step throughput:

```bash
just validate                  # all 30 p5 games (~1 min with throughput)
just validate-one breakout     # single p5 game
just validate-three            # all 16 three.js games (~3 min)
just validate-three-one ball_roller
```

Results are written to `outputs/validation/{summary,three_summary}.json` (gitignored). Currently **30/30 p5** and **16/16 three.js** games pass all five checks.

## Benchmarks

```bash
just bench                     # all p5 games, 3 trials each
just bench-three               # all three.js games
just bench-one flappy_bird     # single game
```

Per-env step throughput on an M4 Pro is roughly **mean ~4300 FPS for p5** (range 1100–5600) and **mean ~1300 FPS for three.js + WebGPU/Dawn** (range 750–1900). Numbers are single-env with no policy forward pass — true RL throughput is ~10–30% lower depending on policy size and `SubprocVecEnv` worker count, but scales near-linearly with N envs. Run `just bench` / `just bench-three` to see the full per-game numbers on your own hardware; results are written to `outputs/bench/{p5,three}.json`.

## How it works

The Python `NodeGymEnv` (p5) or `NodeGymThreeEnv` (three.js) spawns a Node.js subprocess running `runtime/p5/game-worker.mjs` or `runtime/three/game-worker.mjs`. The p5 worker loads the JS game inside a VM context with a custom p5.js shim drawing onto a `node-canvas` (cairo) surface. The three.js worker uses a Dawn-backed WebGPU context for offscreen rendering. Actions flow in over stdin (JSON-framed), observations flow out via mmap'd shared memory with a binary step header (sentinel signals readiness over the pipe). See [docs/PROTOCOL.md](docs/PROTOCOL.md).

## Status

v0.1.0 — alpha. API may change. Bug reports and PRs welcome.

## License

MIT
