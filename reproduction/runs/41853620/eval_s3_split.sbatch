#!/bin/bash -l
#SBATCH -J eval_s3b
#SBATCH -o logs/%x_%A_%a.out
#SBATCH -e logs/%x_%A_%a.err
#SBATCH -p kempner_h100
#SBATCH -A kempner_gershman_lab
#SBATCH -N 1
#SBATCH -c 23
#SBATCH --gres=gpu:1
#SBATCH --mem=96G
#SBATCH -t 0-06:00
# One task per (encoder, seed): eval_final_agents.py keys its output dict by
# game, so feeding it all 144 runs collapses them to 24 rows and keeps only
# whichever ran last. One run per game per invocation avoids that entirely.
set -uo pipefail
cd "${SLURM_SUBMIT_DIR:-$(dirname "$0")}"
mkdir -p logs outputs
PY="$(pwd)/.venv/bin/python"
export PYTHONPATH="$(cd ../playtrain-trainers && pwd)/src:$(cd ../playtrain && pwd)/src:${PYTHONPATH:-}"
module load cuda/12.4.1-fasrc01 2>/dev/null || module load cuda 2>/dev/null || true
COMBO=$(sed -n "${SLURM_ARRAY_TASK_ID}p" outputs/_suite3/eval_combos.txt)
NET=$(echo "$COMBO" | cut -d' ' -f1); SEED=$(echo "$COMBO" | cut -d' ' -f2)
DIRS=$(ls -d outputs/s3_${NET}_*_s${SEED}/)
echo "node=$(hostname) net=$NET seed=$SEED runs=$(echo "$DIRS" | wc -l)"
"$PY" tools/eval_final_agents.py outputs/eval_s3_${NET}_s${SEED}.json \
      --episodes 8 --max-steps 3000 $DIRS
echo DONE
