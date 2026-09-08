#!/bin/bash -l
#SBATCH -J t11_full
#SBATCH -o logs/%x_%j.out
#SBATCH -e logs/%x_%j.err
#SBATCH -p serial_requeue
#SBATCH -C genoa
#SBATCH -N 1
#SBATCH --exclusive
#SBATCH --mem=128G
#SBATCH -t 0-08:00
# Round-4 banked run: published topology (16 workers x 128 envs x 5 threads),
# all 24 games, live vs rv2 vs dv (dv = pc3 .so with QJS_DIRTY=1: hygiene
# rasterizer + adaptive dirty-skip) in the same job, 3 interleaved trials.
# NOTE the 32-frame probe is ~11% of a 300-step run, so dv is UNDERSTATED
# here relative to production-length episodes.
set -uo pipefail
cd "${SLURM_SUBMIT_DIR:-$(dirname "$0")}"
mkdir -p logs outputs
WT=/n/holylabs/gershman_lab/Users/rtruong/playtrain-wt-tuning
LIVE=/n/holylabs/gershman_lab/Users/rtruong/playtrain
PY="$(cd ../analogen-jaxbench && pwd)/.venv/bin/python"
export PYTHONPATH="$(pwd)/src:$WT/src"
export OMP_NUM_THREADS=1
echo "node=$(hostname)"; uname -r
lscpu | grep -E "Model name|CPU\(s\):" | head -2
echo "live .so (untouched): $(md5sum $LIVE/native/build/libqjs_vec.so)"
md5sum "$WT"/native/build/variants/libqjs_vec.{live,rv2,dv}.so
GDIR="$LIVE/examples/games/js"
JOB="${SLURM_JOB_ID:-x}"
OUTD="outputs/tune_full_${JOB}"; mkdir -p "$OUTD"

PROCGEN="bigfish bossfight caveflyer chaser climber coinrun dodgeball fruitbot heist jumper leaper maze miner ninja plunder starpilot"
ALE="asteroids breakout freeway frostbite pong qbert seaquest space_invaders"
for G in $PROCGEN $ALE; do
  for R in 1 2 3; do
    for V in live rv2 dv; do
      cp "$WT/native/build/variants/libqjs_vec.$V.so" "$WT/native/build/libqjs_vec.so"
      case "$V" in dv*) export QJS_DIRTY=1;; *) unset QJS_DIRTY;; esac
      echo; echo "=== $G t$R $V $(md5sum "$WT/native/build/libqjs_vec.so" | cut -d' ' -f1) dirty=${QJS_DIRTY:-0}"
      "$PY" benchmarks/bench_vec_rollout.py --game "$G" --games-dir "$GDIR" \
        --no-model --device cpu --frame-skip 1 --steps 300 --max-steps 2000 \
        --envs 128 --workers 16 --env-threads 5 \
        --out "$OUTD/${G}_${V}_r${R}.json" || echo "RUN_FAIL $G $V t$R"
    done
  done
done
unset QJS_DIRTY
cp "$WT/native/build/variants/libqjs_vec.rv2.so" "$WT/native/build/libqjs_vec.so"
echo; echo "ALL_RUNS_DONE outputs in $OUTD"
