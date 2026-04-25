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
just setup       # npm install + uv sync
```

Requires Node.js 24+, Python 3.11+, [`uv`](https://docs.astral.sh/uv/), and [`just`](https://just.systems) (`brew install just`). Run `just` (no args) at any time to see every available command.

## Game Generation

Generate games from catalogs using Gemini:

```bash
export GEMINI_API_KEY=your-key

just gen-game games/catalogs/atari_games.json breakout         # one game
just gen-all                                                   # everything
just gen-all pro                                               # use Gemini Pro
```

Long form: `uv run python tools/generate.py --catalog ... --name ...`.

## Game Tester

Playtest games in the browser and refine them via Gemini feedback:

```bash
just tester      # http://localhost:3000
```

## Validation

Validate all games against ProcGen-style criteria (API compliance, determinism, observation sanity, reward/terminal correctness, throughput):

```bash
just validate           # all games
just validate breakout  # one game
just bench              # FPS per game
```

Long form: `uv run fast-games-validate --all` (or `uv run python -m fast_games.validate.validate --all`).

## RL Training

### Per-game training

```bash
just smoke breakout                              # ~30 sec sanity check
just train breakout                              # short_run.json (~5 min)
just train breakout configs/full_run.json        # full run (cluster)
just train-dqn breakout                          # DQN instead of PPO
```

### Multi-game ProcGen-style training

Train a single CNN policy across multiple games simultaneously:

```bash
just train-multi                                 # all 14 games, short_run.json
just train-multi configs/full_run.json           # full run
just train-multi-some configs/short_run.json breakout mario flappy_bird
```

Uses ProcGen conventions: train seeds 0-199, test seeds 1000-1099, fixed game assignment per env.

### Evaluation

```bash
just baselines                                                                        # random-agent normalization scores
just eval breakout outputs/experiments/breakout/ppo/<timestamp>/final_model.zip       # train + test split
just aggregate                                                                        # IQM across all runs
```

Add `--use-wandb` to any underlying training command (or call the long form) for W&B logging — requires the `experiment` extra: `uv sync --extra experiment`.

## Workflow recipes

Higher-level flows that compose the atomic recipes above:

| Recipe | What it does |
|---|---|
| `just reproduce` | `validate` + `smoke breakout` — quick end-to-end check, ~5 min |
| `just paper-run` | `validate` + `baselines` + `train-multi configs/full_run.json` + `aggregate` — full benchmark |
| `just ci`        | `validate` + `bench` — what a CI run should cover |

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
justfile                  task runner — `just` lists every command
tools/                    game generator + browser tester
games/
  catalogs/               game lists — 4 JSON files, 25 each
  js/                     generated p5.js game files
  backups/                auto-saved before each refinement
  logs/                   generation + refinement logs
src/fast_games/
  env.py                  Gymnasium wrapper (GameGymEnv) + multi-game utilities
  metrics.py              normalized scoring, IQM
  train/
    _common.py            shared boilerplate (config, output dir, wandb, eval cb)
    ppo.py                per-game PPO training
    dqn.py                per-game DQN training
    multigame.py          ProcGen-style multi-game training
  eval/
    evaluate.py           evaluation with train/test seed split
    baselines.py          random agent baseline scores
    aggregate.py          experiment results aggregation
  validate/
    validate.py           ProcGen-style validation suite
    bench.py              throughput benchmarks
  archive/                compatibility shim — actual sources live in /archive/
envs/
  kazuki-env.mjs          original single-game environment (legacy)
  kazuki-worker.mjs       IPC worker for the legacy kazuki path
poc/p5/                   headless p5.js shim + obs preprocessing (kept for benchmarks/legacy)
notebooks/                marimo notebooks (benchmarks, visualization)
benchmarks/               Node.js benchmark scripts (headless + Playwright)
configs/                  training presets (smoke, short, full)
outputs/                  experiments, models, validation, benchmarks
archive/                  quarantined predecessors (kazuki-only scripts, orphaned configs)
reference/                external repos kept for reference (train-procgen, reinforcement_learning)
GAME_TEMPLATE.md          strict spec for LLM-generated games
```

## Design

See `GAME_TEMPLATE.md` for the full game spec. Key points:

- **Action space**: Discrete(8) — abstract directional + button, identical across all games
- **Observations**: 64x64x3 RGB (matches ProcGen)
- **Seed-based determinism**: same seed + actions = same trajectory
- **Train/test split**: seeds 0-199 for training, 1000-1099 for generalization testing
- **Metrics**: normalized scores via random baselines, Interquartile Mean (IQM) across games

See `llm/llm-games-rl-pipeline.md` for the broader research motivation and `llm/threejs-v2.md` for the Three.js / WebGPU v2 direction.
