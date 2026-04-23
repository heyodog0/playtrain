#!/bin/bash -l
#SBATCH -J fastgames-cell
#SBATCH -p sapphire
#SBATCH -c 32
#SBATCH --mem=32G
#SBATCH -t 0-12:00
#SBATCH -o logs/fasrc/%x_%A_%a.out
#SBATCH -e logs/fasrc/%x_%A_%a.err
#SBATCH --mail-type=FAIL
#SBATCH --mail-user=truongtruong@g.harvard.edu

# One array-task per (game, seed) cell in a fast-llm-games sweep.
# Submitted via scripts/fasrc_submit.sh or `just fasrc-submit`.
#
# Expected env (set by the submitter via sbatch --export):
#   SWEEP_ID     e.g. ppo_20260424_180000
#   ALGO         ppo | dqn | multigame
#   CONFIG       path to configs/*.json (full_run, short_run, smoke_test)
#   CELLS_FILE   path to a file whose N-th line is "GAME SEED" (1-indexed);
#                SLURM_ARRAY_TASK_ID selects the line
#
# Reads its assigned (game, seed) from CELLS_FILE, runs the training via
# the justfile (`just _fasrc-cell ...`), writes outputs under
# outputs/sweeps/$SWEEP_ID/$GAME/seed$SEED/.

set -euo pipefail
cd "${SLURM_SUBMIT_DIR:-$(dirname "$0")/..}"
mkdir -p logs/fasrc

echo "=== fast-llm-games cell | sweep=${SWEEP_ID} array=${SLURM_ARRAY_JOB_ID}_${SLURM_ARRAY_TASK_ID} ==="
echo "Host: $(hostname)"
echo "Date: $(date)"
echo "PWD:  $(pwd)"
if [ -n "${SLURM_JOB_ID:-}" ]; then
  echo "SLURM job: ${SLURM_JOB_ID}, CPUs: ${SLURM_CPUS_PER_TASK:-?}, mem: ${SLURM_MEM_PER_NODE:-?}"
fi
echo

# ----------------------------------------------------------------------------
# Pin BLAS threading. We run n_envs SubprocVec workers in the trainer; if
# each worker launched 32 BLAS threads on a 32-core node we'd get
# catastrophic oversubscription. PyTorch + PPO forward/backward is the main
# math, handled by torch at the SB3 level — one thread per worker process is
# enough at our env/model sizes.
# ----------------------------------------------------------------------------

NCPU="${SLURM_CPUS_PER_TASK:-32}"
export OMP_NUM_THREADS=1
export OPENBLAS_NUM_THREADS=1
export MKL_NUM_THREADS=1
export NUMEXPR_NUM_THREADS=1

# ----------------------------------------------------------------------------
# uv bootstrap (idempotent, installs to $HOME/.local/bin)
# ----------------------------------------------------------------------------

export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
if ! command -v uv >/dev/null 2>&1; then
  echo "Installing uv to \$HOME/.local/bin ..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi
command -v uv >/dev/null 2>&1 || { echo "uv not found after install attempt"; exit 1; }
echo "uv: $(uv --version)"

# ----------------------------------------------------------------------------
# Node.js bootstrap — required because our envs spawn node-canvas subprocesses.
# Try module load first, fall back to a pinned tarball in $HOME/.local/node.
# ----------------------------------------------------------------------------

export PATH="$HOME/.local/node/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "=== Node.js not found — attempting module load ==="
  for mod in nodejs/24 nodejs/22 nodejs/20 nodejs; do
    if module load "$mod" 2>/dev/null; then
      echo "Loaded $mod"
      break
    fi
  done
fi

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "=== Bootstrapping standalone Node.js to \$HOME/.local/node ==="
  NODE_VERSION="v24.9.0"
  NODE_TARBALL="node-${NODE_VERSION}-linux-x64.tar.xz"
  NODE_URL="https://nodejs.org/dist/${NODE_VERSION}/${NODE_TARBALL}"
  if [ ! -d "$HOME/.local/node" ]; then
    tmp=$(mktemp -d)
    curl -fsSL "$NODE_URL" -o "$tmp/$NODE_TARBALL"
    tar -xJf "$tmp/$NODE_TARBALL" -C "$tmp"
    mkdir -p "$HOME/.local"
    mv "$tmp/node-${NODE_VERSION}-linux-x64" "$HOME/.local/node"
    rm -rf "$tmp"
  fi
  export PATH="$HOME/.local/node/bin:$PATH"
fi

command -v node >/dev/null 2>&1 || {
  echo "ERROR: node not found after module load + bootstrap attempts."; exit 1;
}
echo "node: $(node --version) ($(command -v node))"

# ----------------------------------------------------------------------------
# Project env: uv sync (with experiment extras for tensorboard + wandb)
# First cell on a fresh clone also runs npm install.
# ----------------------------------------------------------------------------

if [ ! -d node_modules ]; then
  echo "=== npm install (first-time) ==="
  npm install 2>&1 | tail -5
fi

echo "=== uv sync --frozen --extra experiment ==="
uv sync --frozen --extra experiment 2>&1 | tail -3

# ----------------------------------------------------------------------------
# Resolve this array task's cell
# ----------------------------------------------------------------------------

: "${CELLS_FILE:?CELLS_FILE must be set in submit env}"
: "${SWEEP_ID:?SWEEP_ID must be set}"
: "${ALGO:?ALGO must be set}"
: "${CONFIG:?CONFIG must be set}"

idx="${SLURM_ARRAY_TASK_ID:?not a SLURM array task}"
line=$(sed -n "$((idx + 1))p" "$CELLS_FILE")
if [ -z "$line" ]; then
  echo "ERROR: cells file has no entry for array index $idx"
  exit 1
fi
GAME=$(echo "$line" | awk '{print $1}')
SEED=$(echo "$line" | awk '{print $2}')
echo "cell: game=$GAME seed=$SEED"

# ----------------------------------------------------------------------------
# Run the cell via the justfile
# ----------------------------------------------------------------------------

just _fasrc-cell "$ALGO" "$GAME" "$SEED" "$SWEEP_ID" "$CONFIG"

echo
echo "=== cell done | $(date) ==="
