#!/bin/bash -l
#SBATCH -J webgl_sweep2
#SBATCH -o logs/%x_%j.out
#SBATCH -e logs/%x_%j.err
#SBATCH -p kempner_h100
#SBATCH -A kempner_gershman_lab
#SBATCH -c 23
#SBATCH --gres=gpu:1
#SBATCH --mem=64G
#SBATCH -t 0-00:45
# Follow-up to webgl_sweep (job 45209147): env ceiling 134k, every env-side arm 19-21k.
# Why is seaquest.v3 training at 18k SPS when the env alone should give ~3x
# that? One job, one pinned 17xxx node (fast-clock end; see the benchmark
# hazards), so every number below is on the same silicon:
#   0. env-only ceiling: PingPongVecEnv group 256 at 5 and 20 threads, and
#      NativeVecEnv sync 512 envs at 20 threads
#   1. training arms, 2M steps each, unmodified IMPALA config otherwise:
#        base   4 workers x 5 env threads, double-buffered (the task-8 run)
#        omp1   same, OMP/MKL_NUM_THREADS=1 (oversubscription hypothesis)
#        w2t8   2 workers x 8 threads
#        w6t3   6 workers x 3 threads
#        single 4 x 5, vec_double_buffer=false (double-buffer-shape hypothesis)
# SPS is the trainer's own "sps=" log line (median of the last 6).
set -uo pipefail
cd "${SLURM_SUBMIT_DIR:-.}"; mkdir -p logs
BASE=/n/holylabs/gershman_lab/Users/rtruong
WW=$BASE/playtrain-wt-webgl
JB=$BASE/analogen-jaxbench
PY=$JB/.venv/bin/python
OUT=$WW/native/aotfork/out/sweep_${SLURM_JOB_ID:-local}; mkdir -p "$OUT"
export PATH="$HOME/.local/bin:/n/home06/truong/.local-node/bin:$PATH"
module load cuda/12.4.1-fasrc01 2>/dev/null || module load cuda 2>/dev/null || true
export PYTHONPATH="$WW/src${PYTHONPATH:+:$PYTHONPATH}"
export PLAYTRAIN_AOT=off
echo "node=$(hostname) job=${SLURM_JOB_ID:-none} $(date) cpus=${SLURM_CPUS_ON_NODE:-?}"
grep -m1 "model name" /proc/cpuinfo; lscpu | grep -i "mhz" | head -3
echo "worktree: $(git -C "$WW" log --oneline -1)"

echo "== 1. training arms (2M steps each) =="
BASECFG=$WW/native/aotfork/configs/impala_seaquest_v3_20m.json
arm() {  # name workers threads double_buffer extra-env...
  local name=$1 w=$2 t=$3 db=$4; shift 4
  local cfg=$OUT/cfg_$name.json
  "$PY" - "$BASECFG" "$cfg" "$w" "$t" "$db" "$OUT/run_$name" <<'EOF'
import json, sys
src, dst, w, t, db, ld = sys.argv[1:]
import os
c = json.load(open(src)); c.update(total_steps=2_000_000, vec_workers=int(w), vec_env_threads=int(t),
    vec_double_buffer=(db == "1"), log_dir=ld, stats_log_every=20)
c.update(json.loads(os.environ.get("ARM_OVERRIDES", "{}")))
json.dump(c, open(dst, "w"), indent=1)
EOF
  echo "--- arm $name: workers=$w threads=$t double_buffer=$db env: $*"
  local t0=$(date +%s)
  ( cd "$JB" && env "$@" "$PY" -m playtrain_trainers.train_impala --config "$cfg" > "$OUT/log_$name.txt" 2>&1 )
  local rc=$? t1=$(date +%s)
  local sps=$(grep -o "sps=[0-9.]*" "$OUT/log_$name.txt" | tail -6 | cut -d= -f2 | sort -n | sed -n 3p)
  local ret=$(grep -o "'mean_episode_return': [0-9.]*" "$OUT/log_$name.txt" | tail -1 | cut -d' ' -f2)
  echo "RESULT $name workers=$w threads=$t db=$db sps_median6=${sps:-NA} final_return=${ret:-NA} wall=$((t1-t0))s rc=$rc"
  [ $rc -ne 0 ] && tail -5 "$OUT/log_$name.txt"
}
# learner-side hypothesis: the ~20k cap is batch_size=32 (inherited from
# impala_quickstart); the 2D paper configs use 256 + bf16 + compiled learner.
ARM_OVERRIDES='{"batch_size": 32}'  arm b32       4 5 1 X=1
ARM_OVERRIDES='{"batch_size": 128}' arm b128      4 5 1 X=1
ARM_OVERRIDES='{"batch_size": 256}' arm b256      4 5 1 X=1
ARM_OVERRIDES='{"batch_size": 256, "learner_precision": "bf16", "vec_infer_bf16": true}' arm b256bf16 4 5 1 X=1
ARM_OVERRIDES='{"batch_size": 256, "learner_precision": "bf16", "vec_infer_bf16": true, "vec_workers": 2, "vec_env_threads": 8}' arm b256w2t8 2 8 1 X=1
echo "done $(date)"
