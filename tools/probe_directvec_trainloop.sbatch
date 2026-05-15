#!/bin/bash -l
#SBATCH -J nodegym-trainloop
#SBATCH -p gpu_test
#SBATCH -c 16
#SBATCH --mem=16G
#SBATCH --gres=gpu:1
#SBATCH -t 0-00:30
#SBATCH -o logs/directvec_trainloop_%j.out
#SBATCH -e logs/directvec_trainloop_%j.err
# Training-loop A/B: NodeVecEnv vs SubprocVecEnv under realistic PPO timing.
#
# The pure-env bench (probe_directvec_bench.sbatch, job 12972050) showed +71%
# aggregate sps for grid_v4 N=8 on FASRC. But that's env-only — the real
# question is: how much of that survives once GPU updates are in the loop?
#
# This probe runs the actual rollout-then-update pattern with a small
# IMPALA-shaped CNN on cuda. The only thing that changes between arms is
# the VecEnv class. Both arms have SB3-style autoreset enabled.
#
# Mac sleep-mode reference (n_envs=8 n_steps=256 grid_v4 gpu_sim_ms=80):
#   SubprocVecEnv : 4,704 sps  env 111.6 ms (25.6%) gpu 323.7 ms (74.4%)
#   NodeVecEnv    : 5,198 sps  env  70.3 ms (17.8%) gpu 323.7 ms (82.1%)
#   delta         : +10.5%
#
# FASRC torch-mode result is the number that actually predicts what analogen
# would see if we patched train_ppo_clean.py to use NodeVecEnv.
#
# Sweeps:
#   - flappy_bird @ N=8 (light env baseline)
#   - analogen_nomemory_grid_v4 @ N=8 (the chart's grid_v4 setting)
#   - analogen_nomemory_grid_v4 @ N=16 (does the win get bigger? the env
#     bench showed SubprocVec stops scaling past N=8 here)
#
# -c 16: enough cores for SubprocVecEnv N=16 without oversubscription.
# --gres=gpu:1: real GPU for torch path.
# -t 30min: 3 configs × ~30 updates ≈ <10 min real work.
#
# Usage:
#   sbatch tools/probe_directvec_trainloop.sbatch
#   ANALOGEN_GAMES_DIR=/path/to/analogen/games/js \
#     sbatch tools/probe_directvec_trainloop.sbatch

set -u
cd "${SLURM_SUBMIT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
mkdir -p logs

# ── Modules ────────────────────────────────────────────────────────────────
module load cuda/12.4.1-fasrc01 2>/dev/null \
  || module load cuda/12.2.0-fasrc01 2>/dev/null \
  || module load cuda 2>/dev/null \
  || echo "WARN: no cuda module loaded; relying on torch wheel-bundled libs"

if ! command -v node >/dev/null 2>&1; then
  module load nodejs/22.9.0-fasrc01 2>/dev/null \
    || module load nodejs/20.10.0-fasrc01 2>/dev/null \
    || module load nodejs/18.18.2-fasrc01 2>/dev/null \
    || module load nodejs 2>/dev/null || true
fi
[ -d "$HOME/.local-node/bin" ] && export PATH="$HOME/.local-node/bin:$PATH"
export PATH="$HOME/.local/bin:$PATH"
command -v node >/dev/null || { echo "ERROR: node not on PATH"; exit 1; }
echo "==> Using node: $(command -v node)  ($(node --version))"

# node_modules (canvas etc.) — install if missing
if [ ! -d "node_modules/canvas" ]; then
  command -v pnpm >/dev/null && pnpm install --prefer-offline || npm install
fi

# uv venv with torch. node-gym's pyproject doesn't list torch, so we need to
# install it explicitly into the .venv. Prefer cuda wheels.
if ! command -v uv >/dev/null 2>&1; then
  echo "ERROR: uv not on PATH; trainloop needs uv-managed env for torch"
  exit 1
fi
uv sync 2>/dev/null || true
# Install torch into the venv if missing. Use the index that matches the cuda
# version available; pip will pick CPU wheels if no GPU drivers visible.
if ! .venv/bin/python -c "import torch" 2>/dev/null; then
  echo "==> Installing torch into .venv (no torch found)"
  uv pip install torch 2>&1 | tail -10
fi
PY="uv run python"
echo "==> torch version + cuda check:"
$PY -c "import torch; print(f'  torch={torch.__version__}, cuda_available={torch.cuda.is_available()}, device_count={torch.cuda.device_count()}')"

JOB_TAG="${SLURM_JOB_ID:-local}"
SUMMARY="logs/directvec_trainloop_summary_${JOB_TAG}.tsv"
# Header is written by the harness on first append.

DEFAULT_ANALOGEN_DIR="/n/holylabs/gershman_lab/Users/rtruong/analogen/games/js"
ANALOGEN_GAMES_DIR="${ANALOGEN_GAMES_DIR:-$DEFAULT_ANALOGEN_DIR}"

# Decide gpu_mode based on whether cuda is available. If yes → real torch.
if $PY -c "import torch; exit(0 if torch.cuda.is_available() else 1)"; then
  GPU_MODE="torch"
  DEVICE="cuda"
  EXTRA_ARGS=("--gpu-mode" "torch" "--device" "cuda" "--batch-size" "256" "--n-mini-epochs" "4")
else
  echo "WARN: cuda not available; falling back to sleep-mode (gpu_sim_ms=60)"
  GPU_MODE="sleep"
  EXTRA_ARGS=("--gpu-mode" "sleep" "--gpu-sim-ms" "60" "--n-mini-epochs" "4")
fi

run_one () {
  local game="$1" n="$2" games_dir="$3" n_steps="$4"
  local out_file="logs/directvec_trainloop_${game}_n${n}_${JOB_TAG}.out"
  echo
  echo "════════════════════════════════════════════════════════════════"
  echo " ${game}  N=${n}  n_steps=${n_steps}  gpu_mode=${GPU_MODE}"
  echo "════════════════════════════════════════════════════════════════"
  NODE_GYM_GAMES_DIR="$games_dir" PYTHONPATH=tools \
    $PY tools/probe_directvec_trainloop.py \
      --n-envs "$n" --n-steps "$n_steps" --n-updates 30 \
      --game "$game" "${EXTRA_ARGS[@]}" \
      --summary-tsv "$SUMMARY" \
    2>&1 | tee "$out_file"
}

# Bundled games arm — always runs
run_one "flappy_bird" 8 "examples/games/js" 256

# Analogen games arm — only if found
if [ -d "$ANALOGEN_GAMES_DIR" ]; then
  echo
  echo "==> Found analogen games at $ANALOGEN_GAMES_DIR"
  run_one "analogen_nomemory_grid_v4" 8  "$ANALOGEN_GAMES_DIR" 256
  run_one "analogen_nomemory_grid_v4" 16 "$ANALOGEN_GAMES_DIR" 256
else
  echo
  echo "NOTE: analogen games dir not found at $ANALOGEN_GAMES_DIR"
  echo "      Set ANALOGEN_GAMES_DIR to enable the grid_v4 arm."
fi

echo
echo "════════════════════════════════════════════════════════════════"
echo " Trainloop A/B summary (job ${JOB_TAG})"
echo "════════════════════════════════════════════════════════════════"
if command -v column >/dev/null 2>&1; then
  column -t -s $'\t' "$SUMMARY"
else
  cat "$SUMMARY"
fi

echo
echo "Pure env bench reference (job 12972050, FASRC):"
echo "  flappy_bird N=8 :  SubprocVecEnv 25,456 sps  →  NodeVecEnv 56,270 sps  (+121%)"
echo "  grid_v4     N=8 :  SubprocVecEnv 12,791 sps  →  NodeVecEnv 21,846 sps  (+71%)"
echo "  grid_v4     N=16:  SubprocVecEnv 11,922 sps  →  NodeVecEnv 18,797 sps  (+58%)"
echo
echo "Decision criterion (training-loop sps, what analogen would actually see):"
echo "  - If grid_v4 N=8 trainloop delta >5% → patch analogen to use NodeVecEnv"
echo "  - If <2%                              → SubprocVec env-side cost is fully"
echo "                                          masked by GPU; not worth changing"
echo "                                          API surface for analogen"
