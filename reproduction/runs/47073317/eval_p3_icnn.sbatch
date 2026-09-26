#!/bin/bash -l
#SBATCH -J eval_p3_icnn
#SBATCH -p kempner_h100
#SBATCH -A kempner_gershman_lab
#SBATCH -c 8
#SBATCH --gres=gpu:1
#SBATCH --mem=48G
#SBATCH -t 0-02:00
#SBATCH --array=0-2
#SBATCH -o logs/%x_%A_%a.out
#SBATCH -e logs/%x_%A_%a.err
# tab:eval protocol on the 3-seed 100M PPO + IMPALA-CNN suite runs (p3_icnn_*),
# one array task per seed, mirroring eval_s3_split.sbatch (job 41853620) for the
# IMPALA arm. Script: tools/eval_final_agents_ppo.py (2026-09-18).
set -uo pipefail
cd "${SLURM_SUBMIT_DIR:-$(dirname "$0")}"
mkdir -p logs outputs
PY="$(pwd)/.venv/bin/python"
export PYTHONPATH="$(cd ../playtrain-trainers && pwd)/src:$(cd ../playtrain && pwd)/src:${PYTHONPATH:-}"
module load cuda/12.4.1-fasrc01 2>/dev/null || module load cuda 2>/dev/null || true
SEED=$SLURM_ARRAY_TASK_ID
DIRS=$(ls -d outputs/p3_icnn_*_s${SEED}/)
echo "node=$(hostname) seed=$SEED runs=$(echo "$DIRS" | wc -l)"
"$PY" tools/eval_final_agents_ppo.py outputs/eval_p3_icnn_s${SEED}.json \
      --episodes 8 --max-steps 3000 $DIRS
echo DONE
