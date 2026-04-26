# gym-gen

ProcGen-style RL benchmark with LLM-generated games. Built on [`node-gym`](https://github.com/heyodog0/node-gym) (the headless runtime); this repo adds the game catalog, multi-game PPO/DQN training, train/test seed splits, and SLURM-based sweep orchestration.

- **Game generation**: Gemini generates p5.js (Discrete(8), 64×64 RGB) and Three.js (Discrete(15), 84×84 RGB) games from strict templates
- **Headless runtime**: Games run in Node.js via `node-canvas` (p5) or Dawn/WebGPU (three.js) — no browser. Runtime lives in the sibling [`node-gym`](https://github.com/heyodog0/node-gym) repo.
- **RL training**: Python Gymnasium wrapper + PPO/DQN via SB3, validated against ProcGen-style criteria
- **Multi-game training**: ProcGen-style single policy across all games with train/test seed splits
- **Game tester**: Browser UI for playtesting + Gemini-powered refinement via feedback

## Setup

Requires Node.js 24+, Python 3.11+, [`uv`](https://docs.astral.sh/uv/), and [`just`](https://just.systems) (`brew install just`).

```bash
git clone https://github.com/heyodog0/gym-gen
cd gym-gen
just bootstrap   # clones sibling node-gym + installs deps in both repos
```

After future pulls, run `just sync-all` to refresh both repos.

## Commands

Run `just` (no args) to see every recipe with a one-line description. The most common ones:

```bash
just sync-all                # pull node-gym + reinstall deps in both repos
just tester                  # browser playtest UI (localhost:3000)
just validate                # run 5-check ProcGen validation suite
just bench                   # FPS per game
just smoke breakout          # ~30 sec sanity training
just train breakout          # short_run.json (~5 min)
just train-multi             # multi-game ProcGen-style training
just eval <game> <model>     # train (seeds 0-199) vs test (1000-1099) split
just aggregate               # IQM across all runs
```

Generate a new game from a Gemini catalog (the `games/catalogs/*.json` files — `atari`, `arcade`, `mobile`, `nes`, `procgen` — each list 25 game specs). The second arg matches the `name` field inside the catalog JSON:

```bash
just gen-game games/catalogs/atari_games.json breakout
just gen-game games/catalogs/procgen_games.json caveflyer
```

Higher-level meta-recipes that compose the above:

| Recipe | What it does |
|---|---|
| `just reproduce` | `validate breakout` + `smoke breakout` — ~5 min smoke check |
| `just paper-run` | Local approximation of the paper pipeline: validate + baselines + 5M-step `train-multi` + aggregate. Overnight on a workstation; real paper sweeps go through `fasrc-submit`. |
| `just ci`        | `validate` + `bench` — what a CI pipeline should cover |

Add `--use-wandb` (or use the long form) for W&B logging — requires `uv sync --extra experiment`.

## Games

**p5 (30)** in `games/js/` — Discrete(8), 64×64 RGB, seeded determinism. Two use Matter.js physics (`angry_birds`, `suika`); the rest are pure p5. **Three.js (16)** in `games/threejs/` — Discrete(15), 84×84 RGB, Dawn/WebGPU.

Generation pipeline writes to `games/js/` and `games/threejs/`, with backups in `games/backups/` and Gemini logs in `games/logs/`. See `GAME_TEMPLATE.md` (p5) and `THREE_GAME_TEMPLATE.md` (three.js) for the per-game contracts.

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
