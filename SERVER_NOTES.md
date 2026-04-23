# Server runbook

How to run the ProcGen-style baseline sweep on a remote server. Primary path
is **FASRC CPU (`sapphire`)** — see the FASRC section below. The GPU
instructions further down are for a generic single-host server.

---

## Quick path — FASRC CPU (paper sweep)

```bash
# 1. From local — push code to FASRC ($HOME or $SCRATCH, your call)
just push-code truongtruong@login.rc.fas.harvard.edu:/n/home??/truongtruong/fast-llm-games

# 2. On FASRC login node
cd ~/fast-llm-games

# Smoke test (1 cell, ~1 h walltime) — confirms uv + node bootstrap, env spawn,
# training loop, and figure pipeline all work on the cluster before the real
# sweep. The first submit also installs uv + Node into $HOME/.local/ if missing,
# so no manual `module load` or `npm install` needed up front.
just fasrc-smoke

# Paper sweep: 30 games × 3 seeds × full_run.json
#   → submits a 90-element SLURM array on `sapphire` (32 cores / 32 GB / 12 h each)
#   → submits a dependent aggregate job that runs `just figures` once the array finishes
just fasrc-submit "0 1 2"

# Monitor any time
just fasrc-status <sweep_id>
squeue -u $USER | grep <sweep_id>
tail -f logs/fasrc/<sweep_id>_<jobid>_<arrayidx>.out

# Multigame variant (one policy, 3 seeds — smaller sweep, harder problem)
just fasrc-submit-multi "0 1 2"
```

### FASRC files

| Path | Role |
|---|---|
| `scripts/fasrc_submit.sh` | builds the (game, seed) cell list and submits the SLURM array + dependent aggregate |
| `scripts/fasrc_cell.sbatch` | one array-task: uv+node bootstrap, then `just _fasrc-cell` |
| `scripts/fasrc_aggregate.sbatch` | runs after the array with `afterany` dependency; calls `just fasrc-figures` |
| `logs/fasrc/` | per-array-task stdout/stderr; sweep driver output |

### What each FASRC recipe does

| Recipe | Under the hood |
|---|---|
| `just fasrc-submit SEEDS [GAMES] [CONFIG]` | `scripts/fasrc_submit.sh --seeds ... --games ... --config ...` |
| `just fasrc-submit-multi SEEDS [CONFIG]` | same, but `--algo multigame` |
| `just fasrc-smoke` | 1 cell × smoke_test.json, `sapphire`, 1h — pipeline-verify, not a real result |
| `just fasrc-status SWEEP_ID` | counts completed cells, parses squeue, reports running/queued |
| `just fasrc-figures SWEEP_ID` | calls `uv run fast-games-figures --sweep SWEEP_ID` (auto-run by aggregate sbatch, but safe to rerun) |
| `just _fasrc-cell ALGO GAME SEED SWEEP_ID CONFIG` | internal — invoked from the sbatch with the resolved cell |

### Expected wall-clock

- **1 cell (5M steps, sapphire, 32 cores, 32 envs)**: ~1.5–3 h
- **90-cell paper sweep**: 3–5 calendar days including queue waits
- **Aggregate step**: ~5 min

### Scaling up to the full paper numbers

`configs/full_run.json` is 5M steps by default — pilot-grade. For ProcGen-paper-comparable numbers, edit:

```json
{
  "total_timesteps": 25000000,
  "n_envs": 32,
  "n_envs_per_game": 2,
  ...
}
```

At 25M × ~750 FPS on `sapphire`, each cell is ~9 h (fits in the 12 h walltime).

### Pull the finished sweep back

```bash
# On local
just pull-results truongtruong@login.rc.fas.harvard.edu:/n/home??/truongtruong/fast-llm-games <sweep_id>
just figures <sweep_id>      # figures/<sweep_id>/{fig2,fig3,fig4}.pdf
```

---

## Generic single-host server (GPU)

## One-time server setup

```bash
# on server
git clone <repo> fast-llm-games  # or `just push-code` from local
cd fast-llm-games
just setup                          # npm install + uv sync
uv sync --extra experiment          # adds tensorboard + wandb
just validate                       # confirm 30/30 games pass
just baselines                      # ~10 min — needed for normalization
```

### Pushing code to the server

From local:

```bash
just push-code user@server:/path/to/fast-llm-games
```

`outputs/`, `node_modules/`, `.venv/`, `.git/`, and `reference/` are excluded — the server has its own.

### Launching a paper-grade sweep

The canonical sweep is **30 games × 3 seeds × full_run.json (5M steps)**. On a 4-GPU box with `max_parallel=4`, expect ~70 GPU-hours total.

```bash
# on server, in tmux
just sweep-paper "0 1 2" 4
# → started sweep ppo_20260424_180000 (pid 12345)

# check on it any time
just sweep-status ppo_20260424_180000

# tail driver log (per-run logs are at outputs/sweeps/<id>/<game>/seed<N>/sweep.log)
just sweep-tail ppo_20260424_180000
```

Equivalent canonical multigame sweep (one PPO policy across all games, 3 seeds):

```bash
just sweep-multi "0 1 2" configs/full_run.json 2
```

### Pulling results back

When the sweep finishes (or any time mid-run):

```bash
# on local
just pull-baselines user@server:/path/to/fast-llm-games
just pull-results user@server:/path/to/fast-llm-games <sweep_id>
```

Then locally:

```bash
just figures <sweep_id>
# → figures/<sweep_id>/{fig2_per_game_test,fig3_mean_normalized,fig4_train_test_gap}.pdf
```

### Sweep directory layout

```
outputs/sweeps/<sweep_id>/
├── manifest.json                    # algo, games, seeds, config, host, timing
├── sweep.log                        # driver-level log
├── sweep.pid                        # for `just sweep-stop`
├── breakout/
│   ├── seed0/
│   │   ├── config.json              # full hyperparam snapshot + git_hash
│   │   ├── final_model.zip
│   │   ├── best_model/best_model.zip
│   │   ├── vecnormalize.pkl         # for reload-and-eval
│   │   ├── eval/evaluations.npz     # what figures.py reads
│   │   ├── train_monitor.monitor.csv
│   │   ├── tb/
│   │   └── sweep.log                # this run's stdout/stderr
│   ├── seed1/...
│   └── seed2/...
├── breakout/...
└── ...
```

For multigame sweeps, the layout is `outputs/sweeps/<id>/multigame/seed<N>/` with both `eval/` (test seeds 1000–1099) and `eval_train/` (train seeds 0–199) — needed for the Fig 4 generalization gap.

### Disk + cost estimates

- Per-run footprint (5M steps, 1 game): ~50 MB (tb logs dominate)
- Full sweep (30 × 3): ~5 GB
- Network: rsync downloads only the deltas; full pull < 5 min on a decent link
- GPU: PPO at 64 envs is comfortably 8–10k FPS on a single A100; ~50 min/run

### Scaling knobs

| Parameter | File | Meaning |
|---|---|---|
| `n_envs` | `configs/full_run.json` | parallel rollout envs (per single-game run) |
| `n_envs_per_game` | `configs/full_run.json` | parallel envs PER game in multigame mode |
| `--max-parallel` | justfile recipe | concurrent runs in one sweep (N GPUs ⇒ N) |
| `total_timesteps` | `configs/full_run.json` | currently 5M; ProcGen paper used 25–200M |

### When the sweep dies

If a single run crashes, the sweep driver records it in `manifest.json["failures"]` and continues. To rerun just the failed cells:

```bash
# inspect failures
jq '.failures' outputs/sweeps/<id>/manifest.json
# rerun a specific cell (it'll write into a new timestamped dir under the same game/seed)
just sweep ppo "<game>" "<seed>" configs/full_run.json
```
