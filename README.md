# browserless-game-RL

Generate p5.js games via LLM and train RL agents on them at native speed — no browser.

- **Game generation**: Gemini generates p5.js games from a strict template with fixed Discrete(8) action space and 64x64 RGB observations (matching ProcGen)
- **Headless runtime**: Games run in Node.js via a p5.js shim on `node-canvas` — no browser process, no DOM
- **RL training**: Python Gymnasium wrapper + PPO/DQN via SB3, validated against ProcGen-style criteria
- **Multi-game training**: ProcGen-style single policy across all games with train/test seed splits
- **Game tester**: Browser UI for playtesting + Gemini-powered refinement via feedback

## Games

14 implemented games across 4 catalogs (100 total cataloged):

| Game | Type | Physics |
|------|------|---------|
| breakout | Paddle | - |
| flappy_bird | Platformer | - |
| space_invaders | Shooter | - |
| freeway | Lane crossing | - |
| frostbite | Platformer | - |
| asteroids | Shooter | - |
| crossy_road | Grid movement | - |
| downwell | Vertical shooter | - |
| jetpack_joyride | Horizontal scroller | - |
| mario | Platformer | - |
| sonic | Platformer | - |
| vvvvvv | Gravity flip | - |
| angry_birds | Physics puzzle | Matter.js |
| suika | Drop & merge | Matter.js |

All games share: Discrete(8) actions, 64x64 RGB observations, seeded RNG, deterministic replay.

## Setup

```bash
npm install
uv sync
```

Requires Node.js 24+, Python 3.11+, and `uv`.

## Game Generation

Generate games from catalogs using Gemini:

```bash
export GEMINI_API_KEY=your-key

# Generate one game
uv run python tools/generate.py --catalog games/catalogs/atari_games.json --name breakout

# Generate all Atari games with reference context
uv run python tools/generate.py --catalog games/catalogs/atari_games.json --ref

# Generate all games (all catalogs) with Gemini Pro
uv run python tools/generate.py --all --model pro
```

## Game Tester

Playtest games in the browser and refine them via Gemini feedback:

```bash
uv run python tools/tester.py
# open http://localhost:3000
```

## Validation

Validate all games against ProcGen-style criteria (API compliance, determinism, observation sanity, reward/terminal correctness, throughput):

```bash
# Validate all games
uv run python -m fast_llm_games.validate_games --all

# Validate one game
uv run python -m fast_llm_games.validate_games --game breakout

# Benchmark throughput
uv run python -m fast_llm_games.bench_games --all
```

## RL Training

### Per-game training

```bash
# Smoke test (~30 sec)
uv run python -m fast_llm_games.train_ppo --game breakout --config configs/smoke_test.json

# Short run (~5 min)
uv run python -m fast_llm_games.train_ppo --game breakout --config configs/short_run.json

# Full run (cluster)
uv run python -m fast_llm_games.train_ppo --game breakout --config configs/full_run.json

# DQN
uv run python -m fast_llm_games.train_dqn --game breakout --config configs/smoke_test.json
```

### Multi-game ProcGen-style training

Train a single CNN policy across multiple games simultaneously:

```bash
# All 14 games
uv run python -m fast_llm_games.train_multigame --all-games --total-timesteps 100000

# Specific games
uv run python -m fast_llm_games.train_multigame --games breakout mario vvvvvv flappy_bird
```

Uses ProcGen conventions: train seeds 0-199, test seeds 1000-1099, fixed game assignment per env.

### Evaluation

```bash
# Eval with train/test seed separation
uv run python -m fast_llm_games.eval_model --game breakout --model outputs/experiments/breakout/ppo/.../final_model.zip

# Collect random agent baselines (needed for score normalization)
uv run python -m fast_llm_games.collect_baselines --all

# Aggregate results across experiments
uv run python -m fast_llm_games.aggregate_results
```

Add `--use-wandb` to any training command for W&B logging (requires `uv pip install wandb`).

## Notebooks

Interactive [marimo](https://marimo.io) notebooks for visualization and benchmarking:

```bash
# Run a notebook
uv run marimo edit notebooks/all_games_benchmark.py

# Export to static HTML
uv run marimo export html notebooks/all_games_benchmark.py -o notebooks/all_games_benchmark.html
```

| Notebook | Description |
|----------|-------------|
| `all_games_benchmark.py` | All 14 games benchmarked: RL step throughput, headless Node vs Playwright + base64, sub-step breakdown, 64x64 RGB sample frames |
| `headless_node_vs_playwright.py` | Deep dive into why headless Node is faster than Playwright — architecture diagrams, pixel transfer analysis, base64 optimization, IPC protocol |

## Benchmarks

Apple M4 Pro, 64x64 RGB observations:

| Approach | FPS |
|---|---:|
| Raw env step (breakout) | ~4,600 |
| PPO training (1 env) | ~450 |
| PPO training (4 envs) | ~1,500 |

The environment is never the bottleneck — training FPS is bounded by CNN inference and gradient updates.

## Configs

| Config | Timesteps | Envs | Use case |
|--------|----------:|-----:|----------|
| `smoke_test.json` | 50K | 2 | Verify pipeline works (~30 sec) |
| `short_run.json` | 500K | 4 | Quick learning signal (~5 min) |
| `full_run.json` | 5M | 8 | Real experiments (cluster) |

## Repo Map

```text
tools/                    game generator + browser tester
games/
  catalogs/               game lists — 4 JSON files, 25 each
  js/                     generated p5.js game files
  backups/                auto-saved before each refinement
  logs/                   generation + refinement logs
src/fast_llm_games/
  game_gym_env.py         Gymnasium wrapper (GameGymEnv) + multi-game utilities
  train_ppo.py            per-game PPO training
  train_dqn.py            per-game DQN training
  train_multigame.py      ProcGen-style multi-game training
  eval_model.py           evaluation with train/test seed split
  collect_baselines.py    random agent baseline scores
  validate_games.py       ProcGen-style validation suite
  bench_games.py          throughput benchmarks
  metrics.py              normalized scoring, IQM
  aggregate_results.py    experiment results aggregation
envs/
  game-env.mjs            parameterized game environment
  game-worker.mjs         IPC worker (binary protocol)
  kazuki-env.mjs          original single-game environment (legacy)
poc/p5/                   headless p5.js shim + observation preprocessing
notebooks/                marimo notebooks (benchmarks, visualization)
benchmarks/               Node.js benchmark scripts (headless + Playwright)
configs/                  training presets (smoke, short, full)
outputs/                  experiments, models, validation, benchmarks
GAME_TEMPLATE.md          strict spec for LLM-generated games
```

## Design

See `GAME_TEMPLATE.md` for the full game spec. Key points:

- **Action space**: Discrete(8) — abstract directional + button, identical across all games
- **Observations**: 64x64x3 RGB (matches ProcGen)
- **Seed-based determinism**: same seed + actions = same trajectory
- **Train/test split**: seeds 0-199 for training, 1000-1099 for generalization testing
- **Metrics**: normalized scores via random baselines, Interquartile Mean (IQM) across games

See `llm-games-rl-pipeline.md` for the broader research motivation.
