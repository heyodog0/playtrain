#!/bin/bash -l
#SBATCH -J adv_anchor
#SBATCH -o logs/%x_%j.out
#SBATCH -e logs/%x_%j.err
#SBATCH -p serial_requeue
#SBATCH -C genoa
#SBATCH -N 1
#SBATCH --exclusive
#SBATCH --mem=0
#SBATCH -t 0-05:00
#
# The adopted binary's Fig-4A numbers, same node as the EnvPool matrix
# (submit -w holy8a24307, --dependency=afterok:<adopt_build>).
#   80 threads: adv + live (null check), 24 games x 3 trials.
#   Thread sweep: adv + live at w=2/4/8, ProcGen16 + ALE8, 2 trials.
# adv runs with QJS_DIRTY=1 (dirty-skip is inside the measurement claims
# per the adoption decision).
set -uo pipefail
BASE=/n/holylabs/gershman_lab/Users/rtruong
AJ=$BASE/analogen-jaxbench
TR=$BASE/playtrain-trainers
WT=$BASE/playtrain-wt-tuning
LIVE=$BASE/playtrain
PY=$AJ/.venv/bin/python
JOB="${SLURM_JOB_ID:-x}"
mkdir -p "$AJ/logs" "$AJ/outputs"
echo "node=$(hostname)"
cd "$TR"
export PYTHONPATH="$TR/src:$WT/src"
export OMP_NUM_THREADS=1
md5sum "$WT"/native/build/variants/libqjs_vec.{live,adv}.so
GDIR="$LIVE/examples/games/js"
OUTD="$AJ/outputs/adv_anchor_${JOB}"; mkdir -p "$OUTD"
PROCGEN="bigfish bossfight caveflyer chaser climber coinrun dodgeball fruitbot heist jumper leaper maze miner ninja plunder starpilot"
ALE="asteroids breakout freeway frostbite pong qbert seaquest space_invaders"
run_arm () {  # $1 variant  $2 workers  $3 game  $4 outfile
  cp "$WT/native/build/variants/libqjs_vec.$1.so" "$WT/native/build/libqjs_vec.so"
  case "$1" in adv) export QJS_DIRTY=1;; *) unset QJS_DIRTY;; esac
  "$PY" benchmarks/bench_vec_rollout.py --game "$3" --games-dir "$GDIR" \
    --no-model --device cpu --frame-skip 1 --steps 300 --max-steps 2000 \
    --envs 128 --workers "$2" --env-threads 5 \
    --out "$4" || echo "RUN_FAIL $1 w$2 $3"
}
for G in $PROCGEN $ALE; do
  for R in 1 2 3; do
    for V in live adv; do
      run_arm "$V" 16 "$G" "$OUTD/${G}_${V}_r${R}.json"
    done
  done
done
for W in 2 4 8; do
  for R in 1 2; do
    for V in live adv; do
      for G in $PROCGEN $ALE; do
        run_arm "$V" "$W" "$G" "$OUTD/sweep_${G}_${V}_w${W}_r${R}.json"
      done
    done
  done
done
unset QJS_DIRTY
cp "$WT/native/build/variants/libqjs_vec.adv.so" "$WT/native/build/libqjs_vec.so"
echo ADV_ANCHOR_DONE
