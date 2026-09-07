#!/bin/bash -l
#SBATCH -J webgl_train
#SBATCH -o logs/%x_%j.out
#SBATCH -e logs/%x_%j.err
#SBATCH -p kempner_h100
#SBATCH -A kempner_gershman_lab
#SBATCH -c 23
#SBATCH --gres=gpu:1
#SBATCH --mem=64G
#SBATCH -t 0-03:00
# P5_WEBGL_PLAN.md task 8 (Tier 1 exit): IMPALA on seaquest.v3, default8,
# unmodified trainer, 20M steps, double-buffered native vec path (the
# PingPongVecEnv arm that gate_async.py guards). The trainer is the cluster's
# analogen-jaxbench venv; PYTHONPATH puts the p5-webgl worktree's
# playtrain.runtime ahead of the editable live-tree install so the 3D-capable
# libqjs_vec.so built by webgl_gate.sbatch is what loads. PLAYTRAIN_AOT=off
# keeps compile-at-load out of the run: this is a "does it train" number, the
# engine-tier ratio for this game is measured separately (webgl_gate step 6).
#   sbatch --dependency=afterok:<webgl_gate job> webgl_train.sbatch [config]
set -uo pipefail
cd "${SLURM_SUBMIT_DIR:-.}"; mkdir -p logs
BASE=/n/holylabs/gershman_lab/Users/rtruong
WW=$BASE/playtrain-wt-webgl
JB=$BASE/analogen-jaxbench
CONFIG="${1:-$WW/native/aotfork/configs/impala_seaquest_v3_20m.json}"
export PATH="$HOME/.local/bin:/n/home06/truong/.local-node/bin:$PATH"
module load cuda/12.4.1-fasrc01 2>/dev/null || module load cuda 2>/dev/null || true
export PYTHONPATH="$WW/src${PYTHONPATH:+:$PYTHONPATH}"
export PLAYTRAIN_AOT=off
echo "node=$(hostname) job=${SLURM_JOB_ID:-none} $(date)"
echo "worktree: $(git -C "$WW" log --oneline -1)"
[ -f "$WW/native/build/libqjs_vec.so" ] || { echo "FAIL: $WW/native/build/libqjs_vec.so missing — run webgl_gate.sbatch first"; exit 1; }
"$JB/.venv/bin/python" -c "
import playtrain.runtime.native_vec_env as m, torch
print('runtime =', m.__file__)
print('torch', torch.__version__, 'cuda', torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else '')
from playtrain.runtime.native_vec_env import NativeVecEnv
e = NativeVecEnv('seaquest.v3', num_envs=4, games_dir='$WW/examples/games/js'); e.reset(); o,_,_,_ = e.step([0,1,2,3]); print('probe obs', o.shape, o.dtype, int(o.max())); e.close()
" || exit 1
cd "$JB"
# never `uv sync` here (it prunes hand-installed packages from this venv); the
# venv already has playtrain_trainers + torch, so call its python directly.
"$JB/.venv/bin/python" -m playtrain_trainers.train_impala --config "$CONFIG" 2>&1 | tail -60
echo "EXIT=${PIPESTATUS[0]} $(date)"
