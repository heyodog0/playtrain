#!/bin/bash -l
#SBATCH -J suite3
#SBATCH -o logs/%x_%A_%a.out
#SBATCH -e logs/%x_%A_%a.err
#SBATCH -p kempner_h100
#SBATCH -A kempner_gershman_lab
#SBATCH -N 1
#SBATCH -c 92
#SBATCH --gres=gpu:4
#SBATCH --mem=96G
#SBATCH -t 0-02:00
#
# Rerun the 8 human-study games under both trainers, 3 seeds each, from the
# configs that already worked -- only game/seed/log_dir/budget differ. Fresh runs
# also pick up the CURRENT game files, which matters for flappy_bird: its
# dynamics changed after the existing agents trained, so those agents and our
# participants played different games.
#
# 2 GPUs because the IMPALA config sets vec_worker_device=cuda:0,cuda:1; PPO uses
# one and ignores the second. 46c/2gpu is exactly the partition's 23c/GPU cap.
#
# Uses .venv/bin/python directly, NOT `uv run` -- a sync against this tree prunes
# the hand-installed envpool and PyQt5 out from under any concurrent job.

set -uo pipefail
cd "${SLURM_SUBMIT_DIR:-$(dirname "$0")}"
mkdir -p logs

LINE=$(sed -n "${SLURM_ARRAY_TASK_ID}p" outputs/_suite3/manifest.txt)
TRAINER=$(echo "$LINE" | awk '{print $1}')
CFG=$(echo "$LINE" | awk '{print $2}')
[ -n "$CFG" ] || { echo "no config for task $SLURM_ARRAY_TASK_ID" >&2; exit 2; }

PY="$(pwd)/.venv/bin/python"
export PYTHONPATH="$(cd ../playtrain-trainers && pwd)/src:$(cd ../playtrain && pwd)/src:${PYTHONPATH:-}"
export LD_LIBRARY_PATH="$(pwd)/.venv/lib/python3.13/site-packages/PyQt5/Qt5/lib:${LD_LIBRARY_PATH:-}"
module load cuda/12.4.1-fasrc01 2>/dev/null || module load cuda 2>/dev/null || true

case "$TRAINER" in
  impala) MOD=playtrain_trainers.train_impala ;;
  ppo)    MOD=playtrain_trainers.train_ppo_clean ;;
  *) echo "unknown trainer $TRAINER" >&2; exit 2 ;;
esac

echo "task=$SLURM_ARRAY_TASK_ID trainer=$TRAINER cfg=$CFG node=$(hostname) gpus=$CUDA_VISIBLE_DEVICES"
"$PY" -m "$MOD" --config "$CFG" 2>&1 | tail -20
echo "EXIT=$? node=$(hostname)"
