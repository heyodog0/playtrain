#!/bin/bash
# Submit a gym-gen sweep to FASRC as a SLURM job array.
#
# Usage (or via `just fasrc-submit`):
#   scripts/fasrc_submit.sh --seeds 0 1 2 --games all --config configs/full_run.json
#   scripts/fasrc_submit.sh --seeds 0 --games breakout --config configs/smoke_test.json --smoke
#   scripts/fasrc_submit.sh --algo multigame --seeds 0 1 2 --config configs/full_run.json
#
# The submitter:
#   1. Builds a flat (game, seed) cell list under outputs/sweeps/$SWEEP_ID/cells.txt
#   2. Writes manifest.json so later tooling (figures, status) knows what was launched
#   3. sbatch --array=0-(N-1) scripts/fasrc_cell.sbatch
#   4. sbatch --dependency=afterany:$ARRAY_JOB_ID the aggregate step

set -euo pipefail
cd "$(dirname "$0")/.."

ALGO="ppo"
GAMES="all"
SEEDS=""
CONFIG="configs/full_run.json"
WALLTIME="0-12:00"
PARTITION="sapphire"
SMOKE="false"

while [ $# -gt 0 ]; do
  case "$1" in
    --algo)    ALGO="$2"; shift 2 ;;
    --games)   GAMES="$2"; shift 2 ;;
    --seeds)
      shift
      while [ $# -gt 0 ] && [[ "$1" != --* ]]; do
        SEEDS="$SEEDS $1"; shift
      done ;;
    --config)  CONFIG="$2"; shift 2 ;;
    --walltime) WALLTIME="$2"; shift 2 ;;
    --partition) PARTITION="$2"; shift 2 ;;
    --smoke)
      SMOKE="true"
      CONFIG="configs/smoke_test.json"
      WALLTIME="0-1:00"
      PARTITION="sapphire"
      shift ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

SEEDS="${SEEDS# }"
if [ -z "$SEEDS" ]; then
  echo "ERROR: --seeds is required (e.g. --seeds 0 1 2)"
  exit 1
fi

# --------- resolve game list ----------
if [ "$ALGO" = "multigame" ]; then
  # multigame runs the whole catalog per-run; one cell per seed
  GAME_LIST="multigame"
elif [ "$GAMES" = "all" ]; then
  GAME_LIST=$(uv run python -c "from fast_games.constants import CANONICAL_GAMES; print('\n'.join(CANONICAL_GAMES))")
else
  GAME_LIST=$(echo "$GAMES" | tr ',' '\n' | tr ' ' '\n' | awk 'NF')
fi

# --------- build the cell list ----------
SWEEP_ID="${ALGO}_$(date +%Y%m%d_%H%M%S)"
SWEEP_ROOT="outputs/sweeps/${SWEEP_ID}"
mkdir -p "$SWEEP_ROOT" logs/fasrc

CELLS_FILE="${SWEEP_ROOT}/cells.txt"
: > "$CELLS_FILE"
while IFS= read -r game; do
  for seed in $SEEDS; do
    echo "$game $seed" >> "$CELLS_FILE"
  done
done <<< "$GAME_LIST"

N_CELLS=$(wc -l < "$CELLS_FILE" | tr -d ' ')

# --------- manifest ----------
cat > "${SWEEP_ROOT}/manifest.json" <<EOF
{
  "sweep_id": "${SWEEP_ID}",
  "algo": "${ALGO}",
  "games": "${GAMES}",
  "seeds": "${SEEDS}",
  "config": "${CONFIG}",
  "partition": "${PARTITION}",
  "walltime": "${WALLTIME}",
  "smoke": ${SMOKE},
  "n_cells": ${N_CELLS},
  "started_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "host": "$(hostname)"
}
EOF

echo "=== sweep ${SWEEP_ID} ==="
echo "  algo:      ${ALGO}"
echo "  games:     ${GAMES}"
echo "  seeds:     ${SEEDS}"
echo "  config:    ${CONFIG}"
echo "  partition: ${PARTITION}"
echo "  walltime:  ${WALLTIME}"
echo "  n_cells:   ${N_CELLS}"
echo "  cells:     ${CELLS_FILE}"
echo

# --------- submit the array ----------
# Pass the resolved context via --export so each array task knows which cell it owns.
ARRAY_JOB=$(sbatch --parsable \
  --array="0-$((N_CELLS - 1))" \
  --partition="$PARTITION" \
  --time="$WALLTIME" \
  --job-name="${SWEEP_ID}" \
  --export=ALL,SWEEP_ID="${SWEEP_ID}",ALGO="${ALGO}",CONFIG="${CONFIG}",CELLS_FILE="${CELLS_FILE}" \
  scripts/fasrc_cell.sbatch)

echo "submitted array job: ${ARRAY_JOB}"
echo "${ARRAY_JOB}" > "${SWEEP_ROOT}/array_job_id.txt"

# --------- submit the aggregate step (depends on the array) ----------
AGG_JOB=$(sbatch --parsable \
  --dependency="afterany:${ARRAY_JOB}" \
  --partition="$PARTITION" \
  --time="0-0:30" \
  --cpus-per-task=2 \
  --mem=8G \
  --job-name="${SWEEP_ID}-figs" \
  --output="logs/fasrc/${SWEEP_ID}-figs_%j.out" \
  --error="logs/fasrc/${SWEEP_ID}-figs_%j.err" \
  --export=ALL,SWEEP_ID="${SWEEP_ID}" \
  scripts/fasrc_aggregate.sbatch)

echo "submitted aggregate job: ${AGG_JOB} (depends on ${ARRAY_JOB})"
echo "${AGG_JOB}" > "${SWEEP_ROOT}/aggregate_job_id.txt"

echo
echo "track:"
echo "  squeue -u \$USER | grep ${SWEEP_ID}"
echo "  just fasrc-status ${SWEEP_ID}"
echo "  just fasrc-figures ${SWEEP_ID}  # once all cells are done"
