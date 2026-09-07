#!/bin/bash -l
#SBATCH -J webgl_sweep
#SBATCH -o logs/%x_%j.out
#SBATCH -e logs/%x_%j.err
#SBATCH -p kempner_h100
#SBATCH -A kempner_gershman_lab
#SBATCH -c 23
#SBATCH --gres=gpu:1
#SBATCH --mem=64G
#SBATCH -t 0-01:15
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

echo "== 0. env-only ceiling on this node =="
"$PY" - <<EOF
import time, numpy as np
from playtrain.runtime.native_vec_env import NativeVecEnv, PingPongVecEnv
G="$WW/examples/games/js/seaquest.v3.js"
def pp(group, threads, steps=150):
    env = PingPongVecEnv(G, group_size=group, num_threads=threads, obs_size=64, max_steps=2000)
    env.reset(seeds=np.arange(2*group, dtype=np.int32))
    rng = np.random.default_rng(0); acts = rng.integers(0, 8, size=(steps, group)).astype(np.int32)
    env.send(0, acts[0]); env.send(1, acts[0]); k=[0,0]; t=None; n0=0
    for i in range(2*steps):
        g = i & 1; env.wait(g)
        if i == 40: t = time.perf_counter(); n0 = i
        k[g] += 1
        if k[g] < steps: env.send(g, acts[k[g]])
    dt = time.perf_counter() - t; env.close()
    return (2*steps - n0 - 1) * group / dt
def sync(n, threads, steps=150):
    env = NativeVecEnv(G, num_envs=n, num_threads=threads, obs_size=64, max_steps=2000); env.reset()
    rng = np.random.default_rng(0); acts = rng.integers(0, 8, size=(steps, n)).astype(np.int32)
    for i in range(20): env.step(acts[i])
    t = time.perf_counter()
    for i in range(steps): env.step(acts[i])
    dt = time.perf_counter() - t; env.close(); return steps * n / dt
for th in (5, 20):
    print(f"  pingpong group256 threads={th:<2}: {pp(256, th):>9,.0f} steps/s", flush=True)
print(f"  sync 512 envs threads=20   : {sync(512, 20):>9,.0f} steps/s", flush=True)
print(f"  sync 512 envs threads=5    : {sync(512, 5):>9,.0f} steps/s", flush=True)
EOF

echo "== 1. training arms (2M steps each) =="
BASECFG=$WW/native/aotfork/configs/impala_seaquest_v3_20m.json
arm() {  # name workers threads double_buffer extra-env...
  local name=$1 w=$2 t=$3 db=$4; shift 4
  local cfg=$OUT/cfg_$name.json
  "$PY" - "$BASECFG" "$cfg" "$w" "$t" "$db" "$OUT/run_$name" <<'EOF'
import json, sys
src, dst, w, t, db, ld = sys.argv[1:]
c = json.load(open(src)); c.update(total_steps=2_000_000, vec_workers=int(w), vec_env_threads=int(t),
    vec_double_buffer=(db == "1"), log_dir=ld, stats_log_every=20)
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
arm base   4 5 1 X=1
arm omp1   4 5 1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1
arm w2t8   2 8 1 X=1
arm w6t3   6 3 1 X=1
arm single 4 5 0 X=1
echo "done $(date)"
