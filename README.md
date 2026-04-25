# browserless-game-RL

Generate p5.js games via LLM and train RL agents on them at native speed — no browser.

- **Game generation**: Gemini generates p5.js games from a strict template with fixed Discrete(8) action space and 64×64 RGB observations (matching ProcGen)
- **Headless runtime**: Games run in Node.js via a p5.js shim on `node-canvas` — no browser process, no DOM. Runtime lives in the sibling [`node-gym`](https://github.com/heyodog0/node-gym) repo.
- **RL training**: Python Gymnasium wrapper + PPO/DQN via SB3, validated against ProcGen-style criteria
- **Multi-game training**: ProcGen-style single policy across all games with train/test seed splits
- **Game tester**: Browser UI for playtesting + Gemini-powered refinement via feedback

## Setup

Clone this repo **and** [`node-gym`](https://github.com/heyodog0/node-gym) side-by-side under one parent directory, then:

```bash
just setup       # npm install + uv sync
```

Requires Node.js 24+, Python 3.11+, [`uv`](https://docs.astral.sh/uv/), and [`just`](https://just.systems) (`brew install just`).

After pulling either repo, run `just sync-all` to refresh both.

## Commands

Run `just` (no args) to see every recipe with a one-line description. The most common ones:

```bash
just gen-game games/catalogs/atari_games.json breakout    # generate one game
just tester                                                # browser playtest UI (localhost:3000)
just validate                                              # run 5-check ProcGen validation suite
just bench                                                 # FPS per game
just smoke breakout                                        # ~30 sec sanity training
just train breakout                                        # short_run.json (~5 min)
just train-multi                                           # multi-game ProcGen-style
just eval breakout outputs/experiments/breakout/ppo/<ts>/final_model.zip
just aggregate                                             # IQM across all runs
```

Higher-level meta-recipes that compose the above:

| Recipe | What it does |
|---|---|
| `just reproduce` | Quick end-to-end check, ~5 min |
| `just paper-run` | Full benchmark: validate + baselines + multi-game train + aggregate |
| `just ci`        | What a CI run should cover |

Add `--use-wandb` (or use the long form) for W&B logging — requires `uv sync --extra experiment`.

## Games

30 games across 4 catalogs in `games/js/`. All share Discrete(8) actions, 64×64 RGB observations, seeded determinism, and deterministic replay. Two use Matter.js physics (`angry_birds`, `suika`); the rest are pure p5.

Generation pipeline writes to `games/js/`, with backups in `games/backups/` and Gemini logs in `games/logs/`. See `GAME_TEMPLATE.md` for the full per-game contract.

## Notebooks

Interactive [marimo](https://marimo.io) notebooks for visualization and benchmarking:

```bash
just notebook all_games_benchmark    # open in marimo
just nb-export all_games_benchmark   # export to static HTML
```

| Notebook | Description |
|----------|-------------|
| `all_games_benchmark.py` | Per-game RL throughput, sub-step breakdown, sample frames |
| `headless_node_vs_playwright.py` | Why headless Node beats Playwright — architecture, IPC, pixel transfer |

## Configs

| Config | Timesteps | Envs | Use case |
|--------|----------:|-----:|----------|
| `smoke_test.json` | 50K | 2 | Verify pipeline works (~30 sec) |
| `short_run.json`  | 500K | 4 | Quick learning signal (~5 min) |
| `full_run.json`   | 5M | 8 | Real experiments (cluster) |

## Repo Map

```text
src/fast_games/   training, eval, validation
games/            game source + catalogs
configs/          training presets
scripts/          FASRC sbatch + submit
docs/             notebooks, benchmarks, slides, write-ups
archive/          legacy / quarantined predecessors
reference/        external repos kept for reference
```

The Node.js runtime (game worker + p5 shim) lives in sibling [`node-gym`](https://github.com/heyodog0/node-gym).

## Design

- **Action space**: Discrete(8) — abstract directional + button, identical across all games
- **Observations**: 64×64×3 RGB (matches ProcGen)
- **Seed-based determinism**: same seed + actions ⇒ same trajectory
- **Train/test split**: seeds 0–199 for training, 1000–1099 for generalization testing
- **Metrics**: normalized scores via random baselines, Interquartile Mean (IQM) across games

See `GAME_TEMPLATE.md` for the per-game spec, `docs/llm/llm-games-rl-pipeline.md` for the broader research motivation, and `docs/llm/threejs-v2.md` for the Three.js / WebGPU v2 direction.
