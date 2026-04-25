# node-gym

**Headless Node.js game environments for Python Gymnasium.** Run JavaScript games — p5.js sketches, Matter.js physics simulations, Three.js scenes — as RL environments without a browser.

- **30 bundled games** (Procgen-inspired, plus classics like Flappy Bird, Breakout, Suika)
- **Standard Gymnasium API** — drop into Stable-Baselines3, CleanRL, RLlib, or your own training loop
- **Headless** — pure Node.js subprocess, no Selenium / Playwright / Chromium
- **Fast** — direct canvas pixel access, binary IPC, no DOM overhead

## Install

You need **both** packages — JS runtime + Python wrapper.

### Prerequisites

| Tool   | Why          | Install                                                                   |
|--------|--------------|---------------------------------------------------------------------------|
| Node.js ≥18 | runtime  | https://nodejs.org or `brew install node`                                  |
| `uv`   | Python deps + Python itself | `curl -LsSf https://astral.sh/uv/install.sh \| sh`                |
| `pnpm` | JS deps      | `corepack enable && corepack prepare pnpm@latest --activate`              |
| `just` | task runner  | `brew install just` · `cargo install just` · or [just.systems](https://just.systems) |

You don't need to install Python separately — `uv` reads `requires-python = ">=3.11"` from `pyproject.toml` and downloads a matching interpreter on first `uv sync`.

If you'd rather not install each by hand, the repo ships a `bootstrap.sh` that detects and installs whichever of `uv` / `pnpm` / `just` are missing (idempotent — safe to re-run):

```bash
./bootstrap.sh
```

### From source (recommended for now)

```bash
git clone https://github.com/heyodog0/node-gym
cd node-gym
./bootstrap.sh             # only if you don't already have uv / pnpm / just
just install               # pnpm install + uv sync
just test                  # smoke suite (~5s)
```

Plain equivalent without `just`/`uv`: requires a system Python ≥3.11 and `pip`, then `pnpm install && pip install -e .[test] && pytest tests/`.

### From registries (once published)

```bash
pnpm add node-gym
pip install node-gym       # or: uv pip install node-gym
```

## Play a game in your browser

The fastest way to see what node-gym actually does is to play one of the bundled games:

```bash
just play                 # picker UI listing all bundled games
just play flappy_bird     # jump straight to one
node tools/play.mjs path/to/your_game.js   # arbitrary file
```

The picker is at `http://localhost:5050`. Each game page loads p5.js (and Matter.js if the game needs it) from CDN, runs the game directly (no headless runtime in the loop), and shows a **Reset** button plus a live overlay of `getGameState()`.

## Using node-gym in your own project

`just install` only sets up the cloned repo's local environment (`node-gym/.venv` and `node-gym/node_modules`). To use the package from a different project directory, install it into *that* project's environment:

```bash
cd ~/my-rl-project
uv pip install -e /path/to/node-gym       # or: pip install -e /path/to/node-gym
```

The Python wrapper resolves the JS runtime via `<cloned-repo>/runtime/`, so the JS dependencies (`canvas`, `matter-js`) live inside the cloned `node-gym/` repo — make sure `pnpm install` has been run there. The cloned repo stays where it is; your project just imports through it.

If you want to point at a runtime in a different location:

```python
NodeGymEnv(game="flappy_bird", runtime_dir="/path/to/runtime")
# or set NODE_GYM_RUNTIME in the environment
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

```python
from node_gym import list_available_games
print(list_available_games())
```

## Custom games

Drop your own p5.js / Matter.js game into a directory and point at it:

```python
env = NodeGymEnv(
    game="my_game",
    games_dir="/path/to/my/games",
)
```

Each game is a single `.js` file exposing `setup()`, `draw()`, `resetGame()`, and `getGameState()`. See [`examples/games/flappy_bird.js`](examples/games/flappy_bird.js) for the simplest example and any other bundled game for richer patterns.

## Train/test seed splits

ProcGen-style generalization splits via `SeedRangeWrapper`:

```python
from node_gym import NodeGymEnv, SeedRangeWrapper

train_env = SeedRangeWrapper(NodeGymEnv(game="coinrun"), seed_low=0, seed_high=200)
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

The bundled games can be checked against ProcGen-style criteria — Gymnasium API compliance, determinism, observation sanity, reward/terminal correctness, and step throughput:

```bash
just validate                  # all bundled games (~1 min with throughput)
just validate-one breakout     # single game
uv run python tools/validate.py --all --skip-throughput   # faster, no FPS bench
```

Useful when adding a custom game to the bundled set or debugging a regression. Results are written to `outputs/validation/summary.json` (gitignored).

## How it works

The Python `NodeGymEnv` spawns a Node.js subprocess running `runtime/game-worker.mjs`. The worker loads the JS game inside a VM context with a custom p5.js shim drawing onto a `node-canvas` surface. Actions and observations flow over stdin/stdout using a binary protocol — see [docs/PROTOCOL.md](docs/PROTOCOL.md).

## Status

v0.1.0 — alpha. API may change. Bug reports and PRs welcome.

## License

MIT
