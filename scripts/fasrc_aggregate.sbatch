#!/bin/bash -l
#SBATCH -J fastgames-agg
#SBATCH -c 2
#SBATCH --mem=8G

# Runs `just figures $SWEEP_ID` on FASRC after the array job finishes.
# SLURM boilerplate (partition, walltime, logs) is set by the submitter via
# sbatch flags in scripts/fasrc_submit.sh.

set -euo pipefail
cd "${SLURM_SUBMIT_DIR:-$(dirname "$0")/..}"

export PATH="$HOME/.local/bin:$HOME/.local/node/bin:$PATH"

: "${SWEEP_ID:?SWEEP_ID must be set}"

echo "=== aggregate ${SWEEP_ID} ==="
echo "Host: $(hostname)"
echo "Date: $(date)"

# Minimal env — no node needed, just Python for the plotting path.
uv sync --frozen --extra experiment --extra notebook 2>&1 | tail -3

just fasrc-figures "${SWEEP_ID}"

echo
echo "=== aggregate done | $(date) ==="
