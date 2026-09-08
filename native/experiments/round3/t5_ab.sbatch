#!/bin/bash -l
#SBATCH -J t5_ab
#SBATCH -o logs/%x_%j.out
#SBATCH -e logs/%x_%j.err
#SBATCH -p serial_requeue
#SBATCH -C genoa
#SBATCH -N 1
#SBATCH --exclusive
#SBATCH --mem=64G
#SBATCH -t 0-03:00
# Round-3 A/B: every variant in ONE job on ONE node, interleaved reps.
# Arms: live (null), rv2 (round-2 winner = base arm), rv2r (rv2 + emit-relocs,
# BOLT's input — should be a null), rv2bolt (lever 1), cb (lever 2, runs with
# PLAYTRAIN_QJS_CMDBUF=1), cb0 (cb binary with the flag off — lineage arm).
# On-node obs checksums for all non-live arms come first.
set -uo pipefail
cd "${SLURM_SUBMIT_DIR:-$(dirname "$0")}"
mkdir -p logs outputs
WT=/n/holylabs/gershman_lab/Users/rtruong/playtrain-wt-tuning
LIVE=/n/holylabs/gershman_lab/Users/rtruong/playtrain
PY="$(cd ../analogen-jaxbench && pwd)/.venv/bin/python"
export PYTHONPATH="$(pwd)/src:$WT/src"
export OMP_NUM_THREADS=1
echo "node=$(hostname)"; uname -r
lscpu | grep -E "Model name|CPU MHz|CPU\(s\):" | head -3
echo "live .so (untouched): $(md5sum $LIVE/native/build/libqjs_vec.so)"
md5sum "$WT"/native/build/variants/libqjs_vec.{rv2,cb,cb0}.so
GDIR="$LIVE/examples/games/js"
JOB="${SLURM_JOB_ID:-x}"
OUTD="outputs/tune_ab_${JOB}"; mkdir -p "$OUTD"

echo "=== obs checksum on $(hostname)"
"$PY" "$WT/native/round3/obs_checksum_r3.py" 300 "${CHECKS:-rv2,rv2r,rv2bolt,cb,cb0}" \
  || echo CHECKSUM_FAILED

VARIANTS="${VARIANTS:-live rv2 rv2r rv2bolt cb cb0}"
GAMES="${GAMES:-plunder bigfish breakout maze miner}"
REPS="${REPS:-1 2}"
for G in $GAMES; do
  for R in $REPS; do
    for V in $VARIANTS; do
      cp "$WT/native/build/variants/libqjs_vec.$V.so" "$WT/native/build/libqjs_vec.so" \
        || { echo "MISSING_VARIANT $V — skipped"; continue; }
      if [ "$V" = cb ]; then export PLAYTRAIN_QJS_CMDBUF=1; else unset PLAYTRAIN_QJS_CMDBUF; fi
      case "$V" in dv*) export QJS_DIRTY=1;; *) unset QJS_DIRTY;; esac
      echo; echo "=== $G rep$R $V $(md5sum "$WT/native/build/libqjs_vec.so" | cut -d' ' -f1) cmdbuf=${PLAYTRAIN_QJS_CMDBUF:-0}"
      "$PY" benchmarks/bench_vec_rollout.py --game "$G" --games-dir "$GDIR" \
        --no-model --device cpu --frame-skip 1 --steps 300 --max-steps 2000 \
        --envs 128 --workers 1 --env-threads 5 \
        --out "$OUTD/${G}_${V}_r${R}.json" || echo "RUN_FAIL $G $V r$R"
    done
  done
done
unset PLAYTRAIN_QJS_CMDBUF
# live variant source is the live tree's .so, staged as variants/libqjs_vec.live.so
# by round 1 — verify it is still the byte-copy
cmp -s "$WT/native/build/variants/libqjs_vec.live.so" "$LIVE/native/build/libqjs_vec.so" \
  && echo "live variant == live tree .so" || echo "WARN: live variant diverges from live tree"
echo; echo "ALL_RUNS_DONE outputs in $OUTD"
