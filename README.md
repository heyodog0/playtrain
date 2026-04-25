# node-gym

**Headless Node.js game environments for Python Gymnasium.** Run JavaScript games — p5.js sketches, Matter.js physics simulations, Three.js scenes — as RL environments without a browser.

- **30 bundled games** (Procgen-inspired, plus classics like Flappy Bird, Breakout, Suika)
- **Standard Gymnasium API** — drop into Stable-Baselines3, CleanRL, RLlib, or your own training loop
- **Headless** — pure Node.js subprocess, no Selenium / Playwright / Chromium
- **Fast** — direct canvas pixel access, binary IPC, no DOM overhead

## Install

Requires Node ≥18 and `uv`, `pnpm`, `just`. The repo's `bootstrap.sh` installs whichever of those three are missing (idempotent — safe to re-run). `uv` handles Python itself, no system Python needed.

```bash
git clone https://github.com/heyodog0/node-gym
cd node-gym
./bootstrap.sh             # only if you don't already have uv / pnpm / just
just install               # pnpm install + uv sync
just test                  # boot every bundled game + API checks (~3s, 36 tests)
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

`angry_birds`, `asteroids`, `bigfish`, `bossfight`, `breakout`, `caveflyer`, `chaser`, `climber`, `coinrun`, `crossy_road`, `dodgeball`, `downwell`, `flappy_bird`, `freeway`, `frostbite`, `fruitbot`, `heist`, `jetpack_joyride`, `jumper`, `leaper`, `mario`, `maze`, `miner`, `ninja`, `plunder`, `sonic`, `space_invaders`, `starpilot`, `suika`, `vvvvvv`

## Custom games

Drop your own p5.js / Matter.js game into a directory and point at it:

```python
env = NodeGymEnv(game="my_game", games_dir="/path/to/my/games")
```

Each game is a single `.js` file exposing `setup()`, `draw()`, `resetGame()`, and `getGameState()`. See [`examples/games/flappy_bird.js`](examples/games/flappy_bird.js) for the simplest example.

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
just validate                  # all bundled games (~1 min with throughput)
just validate-one breakout     # single game
```

Results are written to `outputs/validation/summary.json` (gitignored).

## How it works

The Python `NodeGymEnv` spawns a Node.js subprocess running `runtime/game-worker.mjs`. The worker loads the JS game inside a VM context with a custom p5.js shim drawing onto a `node-canvas` surface. Actions and observations flow over stdin/stdout using a binary protocol — see [docs/PROTOCOL.md](docs/PROTOCOL.md).

## Status

v0.1.0 — alpha. API may change. Bug reports and PRs welcome.

## License

MIT
