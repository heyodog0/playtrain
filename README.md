# fast-llm-games

Headless runtime for running LLM-generated browser games at native speed for RL training. No browser required.

## Setup

### Requirements

- Node.js `24+`
- Python `3.11+`
- `uv`
- For the WebGPU POC only: a working GPU backend
  - macOS: Metal
  - Linux: Vulkan
- For the Playwright benchmark only: a local Chrome or Chromium install

### Install JavaScript Dependencies

```bash
npm install
```

### Install Python Dependencies

Python in this repo is managed with `uv`.

```bash
uv sync
```

This creates `.venv/` and installs:

- `gymnasium`
- `stable-baselines3`
- `torch`
- the local `fast_llm_games` package

### Quick Sanity Checks

Headless p5 POC:

```bash
npm run poc:p5
```

Python wrapper smoke test:

```bash
uv run python -c "from fast_llm_games import KazukiGymEnv; env = KazukiGymEnv(); obs, info = env.reset(seed=123); print(obs.shape, info['gameState']); env.close()"
```

### Optional Pieces

Three.js + Dawn WebGPU smoke test:

```bash
npm run smoke:dawn
```

Strict browser-vs-headless benchmark:

```bash
npm run bench:kazuki
```

Short PPO run with logging:

```bash
uv run python -m fast_llm_games.train_sb3_ppo --config configs/kazuki_short_ppo.json
```

## Project Structure

```
benchmarks/               # Comparison scripts (headless runtime vs Playwright)
  kazuki-compare.mjs      # Main browserless vs browser benchmark

configs/                  # Training presets
  kazuki_short_ppo.json   # Short SB3 PPO config with eval logging

envs/                     # Reusable Node-side environment runtime
  kazuki-env.mjs          # Reset/step/close API around the p5 game
  kazuki-worker.mjs       # JSON-line worker used by Python Gymnasium

games/                    # Source browser game files
  kazuki_game.html        # Montezuma's Revenge clone (p5.js, Canvas 2D)

outputs/                  # Generated benchmark, eval, verification, and model files
  ...                     # Safe to delete and regenerate

poc/
  p5/                     # Headless Canvas 2D POC and helpers
    p5-shim.mjs           # Minimal p5.js API on top of node-canvas
    kazuki_game.js        # Game logic extracted from HTML
    obs.mjs               # Shared 84x84 grayscale preprocessing
    poc-p5.mjs            # Headless p5 proof of concept
  webgpu/                 # Three.js + Dawn (WebGPU) headless rendering POC
    smoke-dawn.mjs        # Dawn smoke test
    shims.mjs             # Fake browser environment for Three.js
    poc.mjs               # Headless Three.js render/readback test

src/fast_llm_games/       # Python package for Gymnasium + PPO tooling
  kazuki_gym_env.py       # Python Gymnasium wrapper around the Node worker
  train_sb3_ppo.py        # Minimal SB3 PPO training entrypoint
  eval_sb3_ppo.py         # Deterministic evaluation script
  bench_kazuki_gym.py     # Python-side throughput benchmark

llm-games-rl-pipeline.md  # Design doc / research notes
package.json              # Node scripts and JS dependencies
pyproject.toml            # Python project metadata for uv
```

## Running the POCs

### 1. Dawn smoke test

Verifies the Dawn WebGPU bindings can talk to your GPU.

```bash
npm run smoke:dawn
```

### 2. Three.js WebGPU POC

Renders a Three.js scene (cube with MeshNormalMaterial) headlessly via Dawn and reads pixels back. Validates that Three.js WebGPURenderer works without a browser.

```bash
npm run poc:webgpu
```

### 3. p5.js game POC (kazuki game)

Runs the Montezuma's Revenge clone headlessly. Starts the game, injects keyboard actions, renders frames, and reports both render-only throughput and a fuller RL-step throughput.

```bash
npm run poc:p5
```

## How It Works

**Three.js path** (3D games): V8 runs game JS with fake browser shims. `canvas.getContext('webgpu')` routes to Dawn (Google's WebGPU implementation) which renders via Metal/Vulkan. Pixels are read back from GPU textures. In this repo, that path is still a rendering/readback POC rather than a reusable RL runtime.

**p5.js path** (2D games): A minimal p5-compatible API layer wraps node-canvas (Cairo). The bundled kazuki game logic runs unchanged once loaded into the shim. Pixels are already in CPU memory -- no GPU readback needed.

The p5 POC exposes the pieces needed for manual stepping: `tick()` to advance one frame, simulated keyboard state, pixel readback, and game state access (score, lives, terminal conditions). The WebGPU POC currently demonstrates headless rendering and pixel readback only.

## Throughput Notes

The p5 POC is fast because it avoids a browser entirely. Game logic, input injection, rendering, and pixel access all stay in one Node.js process, and pixels are read directly from canvas memory instead of going through screenshot capture and PNG encoding.

`npm run poc:p5` now prints two measurements:

- `Render-only (action + tick)`: useful for isolating game update and draw cost.
- `RL step (action + tick + pixels + state)`: a better proxy for training throughput because it includes observation readback and state access.

Treat the RL-step number as the meaningful one. Exact FPS depends on hardware, Node.js version, canvas backend, and the specific game.

## Minimal PPO Baseline

Python work in this repo uses `uv`.

```bash
uv sync
```

The Node worker lives at `envs/kazuki-worker.mjs`. The Python wrapper is `KazukiGymEnv`, which exposes:

- discrete action space with 8 actions
- `84x84x4` stacked grayscale observations
- reward as score delta
- `terminated` on `WIN`, `EXIT`, or `GAMEOVER`
- `truncated` on max episode length

Run a short SB3 PPO baseline:

```bash
uv run python -m fast_llm_games.train_sb3_ppo --total-timesteps 50000 --save-path outputs/models/kazuki_ppo
```

Run the bundled short preset with eval logging:

```bash
uv run python -m fast_llm_games.train_sb3_ppo --config configs/kazuki_short_ppo.json
```

This writes:

- `outputs/sb3/kazuki_short/train_monitor.csv`
- `outputs/sb3/kazuki_short/eval_monitor.csv`
- `outputs/sb3/kazuki_short/eval/evaluations.npz`
- `outputs/sb3/kazuki_short/best_model/best_model.zip`

Run a quick evaluation pass on a saved model:

```bash
uv run python -m fast_llm_games.eval_sb3_ppo --model-path outputs/models/kazuki_ppo.zip
```

Benchmark the Python `Gymnasium` wrapper itself:

```bash
uv run python -m fast_llm_games.bench_kazuki_gym --frames 1000
```

Smoke test the wrapper directly:

```bash
uv run python -c "from fast_llm_games import KazukiGymEnv; env = KazukiGymEnv(); obs, info = env.reset(seed=123); print(obs.shape, info['gameState']); env.close()"
```
