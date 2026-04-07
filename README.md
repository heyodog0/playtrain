# browserless-game-rl

Run browser-authored games as RL environments without a browser process.

This repo currently focuses on one p5.js game, `kazuki_game`, and provides:

- a headless Node runtime for stepping the game and producing `84x84` grayscale observations
- a Python `Gymnasium` wrapper over that runtime
- a minimal SB3 PPO baseline
- browser-vs-browserless benchmarks against Playwright/Chromium

## What Exists Today

- `poc/p5/`: working headless Canvas 2D runtime for the Kazuki game
- `envs/`: reusable Node env and JSON-line worker
- `src/fast_llm_games/`: Python wrapper, PPO training, evaluation, and env benchmark scripts
- `benchmarks/`: headless vs Playwright comparison
- `configs/`: short PPO config preset

The WebGPU / Three.js path is still a POC, not a full RL runtime.

## Setup

### Requirements

- Node.js `24+`
- Python `3.11+`
- `uv`
- For browser benchmarks: a local Chrome or Chromium install
- For the WebGPU POC only: a working GPU backend
  - macOS: Metal
  - Linux: Vulkan

### Install

```bash
npm install
uv sync
```

## Quickstart

Headless p5 POC:

```bash
npm run poc:p5
```

Python wrapper smoke test:

```bash
uv run python -c "from fast_llm_games import KazukiGymEnv; env = KazukiGymEnv(); obs, info = env.reset(seed=123); print(obs.shape, info['gameState']); env.close()"
```

Strict browserless vs Playwright benchmark:

```bash
npm run bench:kazuki
```

Python-side env throughput benchmark:

```bash
uv run python -m fast_llm_games.bench_kazuki_gym --frames 1000
```

## PPO

Run the bundled short PPO config:

```bash
uv run python -m fast_llm_games.train_sb3_ppo --config configs/kazuki_short_ppo.json
```

Run a larger manual PPO job:

```bash
uv run python -m fast_llm_games.train_sb3_ppo --total-timesteps 50000 --save-path outputs/models/kazuki_ppo
```

Evaluate a saved model:

```bash
uv run python -m fast_llm_games.eval_sb3_ppo --model-path outputs/models/kazuki_ppo.zip
```

The PPO environment uses:

- discrete action space with 8 actions
- `84x84x4` stacked grayscale observations
- reward = score delta
- `terminated` on `WIN`, `EXIT`, or `GAMEOVER`
- `truncated` on max episode length

## Benchmarks

The important comparison in this repo is not just render speed, but RL-step speed with matched `84x84` grayscale observations.

Latest snapshot on an Apple M4 Pro:

| Baseline | FPS | Delta vs Python Gym | Speedup |
|---|---:|---:|---:|
| Node headless RL step | 1799 | +371 | 1.26x |
| Python `KazukiGymEnv` RL step | 1428 | 0 | 1.00x |
| Playwright `getImageData()` RL step | 78 | -1350 | 18.2x slower |
| Playwright screenshot RL step | 24 | -1404 | 59.8x slower |

This is the practical baseline split:

- raw Node headless runtime is fastest
- the Python `Gymnasium` wrapper adds overhead, but is still much faster than browser automation
- Playwright only becomes remotely competitive if you ignore realistic observation transfer costs

Measured per-step breakdown:

| Component | Browserless Node | Playwright `getImageData()` | Playwright screenshot |
|---|---:|---:|---:|
| Render-only step | `0.349 ms` | `0.478 ms` | `0.478 ms` |
| Observation + state overhead | `0.207 ms` | `12.280 ms` | `41.394 ms` |
| Total RL step | `0.556 ms` | `12.758 ms` | `41.872 ms` |
| Effective FPS | `1799` | `78` | `24` |

And for the actual Python PPO-facing wrapper:

| Component | Python `KazukiGymEnv` |
|---|---:|
| Total RL step | `0.700 ms` |
| Effective FPS | `1428` |

The main bottleneck is not game rendering itself. The large gap comes from observation extraction and transfer out of the browser process.

Current artifacts are written under `outputs/`, including:

- browserless vs Playwright benchmark summaries
- Python Gym wrapper benchmark summaries
- PPO monitor logs and evaluation summaries
- saved models

Two useful commands:

```bash
npm run bench:kazuki
uv run python -m fast_llm_games.bench_kazuki_gym --frames 1000
```

## Repo Map

```text
benchmarks/               browserless vs Playwright benchmark scripts
configs/                  PPO presets
envs/                     reusable Node-side environment runtime
games/                    source browser game files
outputs/                  generated benchmarks, evals, and models
poc/p5/                   headless p5 runtime and helpers
poc/webgpu/               Three.js + Dawn POC
src/fast_llm_games/       Python Gymnasium + PPO tooling
```

## Notes

- Python in this repo is managed with `uv`.
- Generated artifacts under `outputs/` are disposable.
- Design notes and broader motivion live in `llm-games-rl-pipeline.md`.
