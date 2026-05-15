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
# This SBATCH uses analogen's existing .venv directly instead of installing
# torch into node-gym-dev's .venv. analogen already has torch 2.11.0+cu128
# working with FASRC's CUDA 12.9 driver — no point paying the 30+ min torch
# install in node-gym-dev's venv every time.
#
# Mechanism:
#   - PY                = analogen's .venv/bin/python (has torch+cu128+gymnasium)
#   - PYTHONPATH        = node-gym-dev/python  : node-gym-dev/tools  : (others)
#     The dev path is FIRST so 'import node_gym' picks up dev's NodeVecEnv,
#     not analogen's editable install of the older node-gym/. The tools dir
#     is needed so the trainloop can do `from probe_directvec_bench import ...`.
#
# Verify the dev module wins:
#   $PY -c "import node_gym; print(node_gym.__file__)"
#   → should print .../node-gym-dev/python/node_gym/__init__.py
#
# Job 12973443 ran the same harness in sleep-mode (no cuda) and showed:
#   game         N    SubprocVec  NodeVec   delta
#   flappy_bird  8    6,232 sps   7,235 sps +16.1%
#   grid_v4      8    5,518 sps   6,264 sps +13.5%
#   grid_v4      16   8,040 sps   9,828 sps +22.2%
#
# This run uses real torch+cuda for honest training-loop numbers.
#
# Usage:
#   sbatch tools/probe_directvec_trainloop.sbatch
#   ANALOGEN_VENV=/path/to/analogen/.venv sbatch tools/probe_directvec_trainloop.sbatch
#   ANALOGEN_GAMES_DIR=/path/to/games/js  sbatch tools/probe_directvec_trainloop.sbatch

set -u
cd "${SLURM_SUBMIT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
mkdir -p logs

# ── CUDA module (so torch can find the driver libs at runtime) ────────────
module load cuda/12.4.1-fasrc01 2>/dev/null \
  || module load cuda/12.2.0-fasrc01 2>/dev/null \
  || module load cuda 2>/dev/null \
  || echo "WARN: no cuda module loaded; relying on torch wheel-bundled libs"

# ── Node bringup (mirrors probe_cairo_high_n.sbatch) ──────────────────────
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

# ── Use analogen's venv (already has torch+cu128+cuda working) ────────────
DEFAULT_ANALOGEN_VENV="/n/holylabs/gershman_lab/Users/rtruong/analogen/.venv"
ANALOGEN_VENV="${ANALOGEN_VENV:-$DEFAULT_ANALOGEN_VENV}"
if [ ! -x "${ANALOGEN_VENV}/bin/python" ]; then
  echo "ERROR: analogen venv not found at ${ANALOGEN_VENV}/bin/python"
  echo "       Set ANALOGEN_VENV=/path/to/analogen/.venv and re-submit."
  exit 1
fi
PY="${ANALOGEN_VENV}/bin/python"

# Put node-gym-dev's python/ FIRST so we get this branch's NodeVecEnv,
# not analogen's editable install of the older node-gym/.
DEV_ROOT="$(pwd)"
export PYTHONPATH="${DEV_ROOT}/python${PYTHONPATH:+:$PYTHONPATH}"

# PYTHONSAFEPATH=1 disables Python's auto-prepend of the script's directory
# to sys.path. Without it, `python tools/probe_directvec_trainloop.py` puts
# tools/ on sys.path, and tools/profile.py shadows stdlib 'profile' — which
# torch._dynamo lazily imports via cProfile and crashes on. PEP 540 / py3.11+.
export PYTHONSAFEPATH=1

echo "==> Using Python: $PY"
echo "==> PYTHONPATH (front): ${DEV_ROOT}/python"
echo "==> PYTHONSAFEPATH=1 (prevents tools/profile.py shadowing stdlib)"
$PY -c "
import sys, node_gym, torch
print(f'  node_gym from: {node_gym.__file__}')
print(f'  has NodeVecEnv: {hasattr(node_gym, \"NodeVecEnv\")}')
print(f'  torch={torch.__version__}, cuda_available={torch.cuda.is_available()}, '
      f'device_count={torch.cuda.device_count()}')
assert hasattr(node_gym, 'NodeVecEnv'), 'NodeVecEnv missing — wrong node_gym!'
"

JOB_TAG="${SLURM_JOB_ID:-local}"
SUMMARY="logs/directvec_trainloop_summary_${JOB_TAG}.tsv"

DEFAULT_ANALOGEN_DIR="/n/holylabs/gershman_lab/Users/rtruong/analogen/games/js"
ANALOGEN_GAMES_DIR="${ANALOGEN_GAMES_DIR:-$DEFAULT_ANALOGEN_DIR}"

# Decide gpu_mode based on whether cuda is actually available.
if $PY -c "import torch; exit(0 if torch.cuda.is_available() else 1)"; then
  GPU_MODE="torch"
  EXTRA_ARGS=("--gpu-mode" "torch" "--device" "cuda" "--batch-size" "256" "--n-mini-epochs" "4")
  echo "==> GPU mode: torch+cuda (real CNN forward+backward)"
else
  GPU_MODE="sleep"
  EXTRA_ARGS=("--gpu-mode" "sleep" "--gpu-sim-ms" "60" "--n-mini-epochs" "4")
  echo "==> GPU mode: sleep (cuda not available — falling back to time-modeled)"
fi

run_one () {
  local game="$1" n="$2" games_dir="$3" n_steps="$4"
  local out_file="logs/directvec_trainloop_${game}_n${n}_${JOB_TAG}.out"
  echo
  echo "════════════════════════════════════════════════════════════════"
  echo " ${game}  N=${n}  n_steps=${n_steps}  gpu_mode=${GPU_MODE}"
  echo "════════════════════════════════════════════════════════════════"
  NODE_GYM_GAMES_DIR="$games_dir" \
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
echo "Sleep-mode trainloop reference (job 12973443, FASRC, 240ms fixed gpu):"
echo "  flappy_bird N=8 :  6,232 → 7,235  (+16.1%)"
echo "  grid_v4     N=8 :  5,518 → 6,264  (+13.5%)"
echo "  grid_v4     N=16:  8,040 → 9,828  (+22.2%)"
echo
echo "Decision criterion:"
echo "  - If grid_v4 N=8 trainloop delta >5% → patch analogen to use NodeVecEnv"
echo "  - If <2%                              → keep SubprocVecEnv; not worth churn"
