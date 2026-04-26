# What the FASRC sweep actually does

A step-by-step walkthrough of every script and shell env var in the
`just fasrc-submit` path. Read this before launching the real sweep if you
want to understand *exactly* what's getting executed on the cluster.

See `SERVER_NOTES.md` for the quick command reference. This document is the
"why and how" companion.

---

## The three-file tree

```
scripts/
├── fasrc_submit.sh          ← you run this (via `just fasrc-submit`)
├── fasrc_cell.sbatch        ← SLURM runs this, 90 times, as a job array
└── fasrc_aggregate.sbatch   ← SLURM runs this once, after the array finishes
```

**`fasrc_submit.sh`** is a local bash script that builds the grid and hands off
to `sbatch`. Everything below happens on the cluster, supervised by SLURM.

---

## Step 1 — `just fasrc-submit "0 1 2"` on the login node

Expands to:

```bash
scripts/fasrc_submit.sh --seeds 0 1 2 --games all --config configs/full_run.json
```

`fasrc_submit.sh` runs on the login node (not on a compute node — nothing
heavy happens here, it's just SLURM paperwork). It does five things:

### 1a. Parse args and resolve the game list

```bash
GAME_LIST=$(uv run python -c "from fast_games.constants import CANONICAL_GAMES;
                              print('\n'.join(CANONICAL_GAMES))")
```

This reads `src/fast_games/constants.py:CANONICAL_GAMES` — the committed,
paper-frozen list of 30 games. The alternative is `--games breakout,mario` for
ad-hoc sweeps. For `--algo multigame`, the list becomes a single entry
`multigame` (one run trains on all games jointly per seed).

### 1b. Build the flat (game, seed) cell list

```text
outputs/sweeps/ppo_20260424_180000/cells.txt
───────────────────────────────────────────
angry_birds    0
angry_birds    1
angry_birds    2
asteroids      0
asteroids      1
asteroids      2
bigfish        0
...
vvvvvv         2
```

90 lines total. The N-th line is the (game, seed) that array task N will own.
This file is the single source of truth for which cell each task runs — no
computed indices, no game-order assumptions.

### 1c. Write `manifest.json`

Captures the sweep's identity at submit time: algo, games, seeds, config,
partition, walltime, n_cells, host, start time. Every downstream tool
(figures, status, pull-results) reads this first.

### 1d. Submit the SLURM job array

```bash
sbatch --parsable \
  --array="0-89" \
  --partition=sapphire \
  --time=0-12:00 \
  --job-name=ppo_20260424_180000 \
  --export=ALL,SWEEP_ID=...,ALGO=ppo,CONFIG=...,CELLS_FILE=... \
  scripts/fasrc_cell.sbatch
```

Key flags:

- **`--array=0-89`** — creates 90 independent SLURM jobs that share a job ID
  but each have their own `SLURM_ARRAY_TASK_ID ∈ {0..89}`. They're scheduled
  independently; failures don't cascade.
- **`--partition=sapphire`** — FASRC's general-purpose CPU partition (Sapphire
  Rapids, 56 cores/node). Default for all our cells.
- **`--time=0-12:00`** — per-cell walltime ceiling. Cells finish in ~2 h
  typically; 12 h is the generous ceiling that fits comfortably inside
  sapphire's usage policy. SLURM reclaims unused time, so overestimating is
  free.
- **`--export=ALL,VAR=value,...`** — the submit-time env vars that each array
  task inherits. This is how a task knows which sweep it belongs to and which
  cell to run.

### 1e. Submit the dependent aggregate job

```bash
sbatch --dependency=afterany:$ARRAY_JOB \
  --time=0-0:30 --cpus-per-task=2 --mem=8G \
  --export=ALL,SWEEP_ID=... \
  scripts/fasrc_aggregate.sbatch
```

`afterany` means "run regardless of whether the array job succeeded or
failed" — so even a partially failed sweep still gets figures for the cells
that did complete. SLURM queues this up immediately but won't schedule it
until the array is fully done.

### 1f. Exit

The submit script returns, you're back at the login-node prompt with two
job IDs written to `outputs/sweeps/<id>/{array_job_id.txt,aggregate_job_id.txt}`.

---

## Step 2 — one array task fires: `fasrc_cell.sbatch`

SLURM assigns each task to a compute node when cores/memory free up. On that
node, it runs `scripts/fasrc_cell.sbatch` with the env vars from `--export`.
This script has five phases.

### 2a. `set -euo pipefail` + working directory

```bash
cd "${SLURM_SUBMIT_DIR:-$(dirname "$0")/..}"
```

`SLURM_SUBMIT_DIR` is where you ran `sbatch` (the login-node clone of the
repo). Array tasks inherit this, so they land in the same repo on the compute
node's view of shared storage. (FASRC uses Lustre — the repo is visible from
every node.)

### 2b. BLAS threading pin

```bash
export OMP_NUM_THREADS=1
export OPENBLAS_NUM_THREADS=1
export MKL_NUM_THREADS=1
export NUMEXPR_NUM_THREADS=1
```

**This is critical.** Without it, PyTorch / NumPy would each spin up 32 BLAS
threads per worker by default. Since PPO's `SubprocVecEnv` spawns 32 env
worker processes, that would be 32 × 32 = 1,024 BLAS threads fighting for 32
cores — a thread-pileup that can slow training by 5–10×.

By pinning each worker to 1 BLAS thread, we get:

- 32 env worker processes × 1 BLAS thread = 32 threads, one per core ✓
- 1 main PyTorch process on the coordinator, handling forward/backward
- PPO's CNN forward/backward runs single-threaded per process (fine — the
  bottleneck is env stepping, not matmul, on CPU)

The pattern is copied directly from the bilevel-SSUP pipeline's
`run_server_pipeline.sh` where the same reasoning applies.

### 2c. `uv` bootstrap

```bash
if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi
```

`uv` installs to `$HOME/.local/bin`. FASRC `$HOME` is persistent across jobs,
so this is a one-time cost on the first ever run. Every subsequent task sees
`uv` already present.

### 2d. Node.js bootstrap (the tricky part)

Our envs require Node.js 24+ (for the p5.js shim + node-canvas). FASRC may
have node modules available via `module load`, but not at version 24, and
module availability changes between clusters. The script tries three paths:

1. **`module load nodejs/24`** (preferred, if available)
2. **Pinned tarball to `$HOME/.local/node/`**: downloads
   `node-v24.9.0-linux-x64.tar.xz` once, unpacks to `$HOME/.local/node/`,
   adds `$HOME/.local/node/bin` to PATH. Idempotent — subsequent tasks skip
   the download.
3. **Fail hard** with a clear message if neither works.

Why the fallback matters: the `module load` approach depends on FASRC
admins keeping specific Node versions available. The `$HOME/.local` tarball
doesn't — it's pinned to v24.9.0 and survives module reshuffles.

### 2e. Python env (`uv sync`)

```bash
uv sync --frozen --extra experiment
```

- `--frozen` enforces `uv.lock` — every cell sees bit-identical packages
  (reproducibility requirement for a paper sweep).
- `--extra experiment` pulls in `tensorboard` + `wandb`, which the training
  scripts need. Without this flag, `uv sync` would remove them (they're
  declared as optional in `pyproject.toml`).

### 2f. Resolve this task's cell

```bash
idx="${SLURM_ARRAY_TASK_ID}"             # e.g. 47
line=$(sed -n "$((idx + 1))p" "$CELLS_FILE")
GAME=$(echo "$line" | awk '{print $1}')   # e.g. maze
SEED=$(echo "$line" | awk '{print $2}')   # e.g. 1
```

The array task reads its assigned line out of the cells file. No shared state,
no race condition — each task owns exactly one line.

### 2g. Run the cell via the justfile

```bash
just _fasrc-cell "$ALGO" "$GAME" "$SEED" "$SWEEP_ID" "$CONFIG"
```

This is the whole point of the justfile delegation. The sbatch script is
purely environmental scaffolding; the actual training command lives in the
justfile so local and cluster runs invoke the same code path:

```just
_fasrc-cell algo game seed sweep_id config:
    case "{{algo}}" in
      ppo)
        uv run fast-games-train \
            --game {{game}} --config {{config}} \
            --seed {{seed}} --output-dir "$run_dir" ;;
      ...
    esac
```

What `fast-games-train` does with those args, in one line: creates a 32-env
`SubprocVecEnv`, wraps in `VecMonitor → VecTransposeImage → VecNormalize`,
instantiates `PPO("CnnPolicy", ..., policy_kwargs={IMPALA-CNN})`, calls
`model.learn(total_timesteps=5_000_000, callback=[EvalCallback])`, saves
`final_model.zip` + `best_model/` + `vecnormalize.pkl` + `eval/evaluations.npz`
to `outputs/sweeps/<sweep_id>/<game>/seed<seed>/`.

---

## Step 3 — the aggregate job fires after the array

`fasrc_aggregate.sbatch` is tiny (~30 lines). It runs when SLURM reports the
array job is done (successful or not — `afterany` dependency).

```bash
uv sync --frozen --extra experiment --extra notebook
just fasrc-figures "${SWEEP_ID}"
```

`--extra notebook` pulls in `matplotlib` (only used here, not during training).
Then `just fasrc-figures $SWEEP_ID` is just `uv run fast-games-figures --sweep
$SWEEP_ID`, which walks `outputs/sweeps/<id>/` finding every
`eval/evaluations.npz` and renders three PDFs into `figures/<sweep_id>/`:

- **fig2_per_game_test.pdf** — grid of training curves, one panel per game,
  mean ± seed-std from 3 seeds
- **fig3_mean_normalized.pdf** — one curve: mean normalized return
  `(agent − random) / (best − random)` across all games over time
- **fig4_train_test_gap.pdf** — bar chart of final train-set vs. test-set
  return per game. Only produced when `--algo multigame --dual-eval` was on
  (dual EvalCallback writes both `eval/` and `eval_train/`).

Figures land in a different directory from sweep outputs, so you can rsync
figures without pulling 5 GB of model checkpoints.

---

## Step 4 — pull results back to local

From your laptop:

```bash
just pull-results truongtruong@login.rc.fas.harvard.edu:~/llm-gg <sweep_id>
```

Expands to `rsync -avz <remote>/outputs/sweeps/<sweep_id>/ outputs/sweeps/<sweep_id>/`.
Pulls everything — models, eval npz, tb logs, manifest. Network cost: ~5 GB
for a full 90-cell sweep, usually <5 min.

Optionally regenerate figures locally (the cluster aggregate job already did
this; pulling them back is one more flag):

```bash
just figures <sweep_id>
# figures/<sweep_id>/{fig2,fig3,fig4}.pdf
```

---

## Where the data flows

```
[ login node ]
  just fasrc-submit
    └── fasrc_submit.sh
         ├── writes cells.txt, manifest.json
         ├── sbatch --array=0-89 (array job)
         └── sbatch --dependency=afterany (aggregate job)

               │
               ▼

[ compute node × 90 ]
  fasrc_cell.sbatch (one per array task)
    ├── uv/node bootstrap (first time only)
    ├── uv sync --extra experiment
    ├── reads cells.txt line N → (game, seed)
    └── just _fasrc-cell
         └── uv run fast-games-train
              └── writes outputs/sweeps/<id>/<game>/seed<N>/{
                     final_model.zip,
                     best_model/,
                     vecnormalize.pkl,
                     eval/evaluations.npz,
                     tb/,
                     config.json
                  }

               │
               ▼  (after ALL array tasks finish or fail)

[ compute node × 1 ]
  fasrc_aggregate.sbatch
    └── just fasrc-figures <sweep_id>
         └── uv run fast-games-figures
              └── writes figures/<sweep_id>/{fig2,fig3,fig4}.pdf

               │
               ▼

[ local laptop ]
  just pull-results <sweep_id>
    └── rsync outputs/sweeps/<sweep_id>/
  just figures <sweep_id>   # optional — cluster already did this
```

---

## The env-var contract

`fasrc_cell.sbatch` depends on four env vars being set by the submitter.
They're documented here so any future debugging has one place to look.

| Var | Example | Set by | Read by |
|---|---|---|---|
| `SWEEP_ID` | `ppo_20260424_180000` | `fasrc_submit.sh` | cell script (output paths) |
| `ALGO` | `ppo` \| `dqn` \| `multigame` | `fasrc_submit.sh` | cell script → `just _fasrc-cell` |
| `CONFIG` | `configs/full_run.json` | `fasrc_submit.sh` | cell script → `just _fasrc-cell` |
| `CELLS_FILE` | `outputs/sweeps/<id>/cells.txt` | `fasrc_submit.sh` | cell script (reads line `$SLURM_ARRAY_TASK_ID`) |
| `SLURM_ARRAY_TASK_ID` | `0` to `89` | SLURM | cell script (picks cells line) |
| `SLURM_CPUS_PER_TASK` | `32` | SLURM (from `#SBATCH -c 32`) | cell script (BLAS budget) |

If you need to add a new env var (e.g. a flag to training), pass it through
all three: `--export=...,NEW_VAR=...` in `fasrc_submit.sh`, read it in
`fasrc_cell.sbatch`, forward it to `just _fasrc-cell` via a new parameter.

---

## Failure modes and what to do

| Symptom | Cause | Fix |
|---|---|---|
| `just fasrc-smoke` fails with `node: command not found` | Tarball bootstrap didn't complete | Check `$HOME/.local/node/` exists; delete it and resubmit to force re-download |
| Array tasks hit 12 h walltime | Cell genuinely needs more time (25M-step config) | Bump `--time` in `fasrc_cell.sbatch` header, or split 25M into two 12.5M runs and checkpoint |
| One cell OOMs | `mem=32G` too tight for some game + SubprocVec spike | Bump to `mem=48G` in `fasrc_cell.sbatch` and resubmit the failed cell |
| `just fasrc-status` shows 0 complete, 0 running | Array job never got scheduled | Check `squeue -u $USER` for pending reason; usually fair-share or partition limits |
| Aggregate job ran but no PDFs | Array had zero successful cells | Array failures cascade to aggregate producing nothing useful; inspect per-cell `sweep.log` |

---

## What this runbook deliberately does not do

- **Multi-node parallelism within a single cell.** Each cell is 32 cores, one
  node. We get parallelism from `--array`, not `--nodes` + MPI. Adding MPI
  would complicate the SubprocVec env spawning.
- **Checkpointing mid-cell.** If a cell dies at 80% completion, we throw away
  the first 80%. SB3 does support `model.learn(... reset_num_timesteps=False)`
  with loaded weights, but wiring it up isn't worth the complexity at 5M
  steps. Relevant once we move to 25M+.
- **Cross-cell early stopping.** If 70 of 90 cells have converged and 20 are
  lagging, we let them run to walltime. No speculative kill.
- **Automatic resubmit of failed cells.** `manifest.json["failures"]` records
  them; you manually re-run with `just fasrc-submit` passing only the failed
  cells once you know why they failed.
