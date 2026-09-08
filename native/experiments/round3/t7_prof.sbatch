#!/bin/bash -l
#SBATCH -J t7_prof
#SBATCH -o logs/%x_%j.out
#SBATCH -e logs/%x_%j.err
#SBATCH -p serial_requeue
#SBATCH -C genoa
#SBATCH -N 1
#SBATCH -c 16
#SBATCH --mem=32G
#SBATCH -t 0-01:30
# Helper histogram probe (post-round-3): where does the 55-70% interpreter
# share actually go? Rebuild rv2 with -g (DBG=1: debug info only, codegen
# unchanged), SIGPROF the vec workload, attribute samples to INLINED helpers
# via llvm-symbolizer --inlines, bucket into strict_eq / property access /
# conversions / GC / atoms / dispatch-residual etc. This bounds what an
# interpreter-level inline-cache layer could reclaim BEFORE anyone builds one
# (and re-tests the archived qjit finding that dispatch is ~free).
set -uo pipefail
cd "${SLURM_SUBMIT_DIR:-.}"; mkdir -p logs outputs
WT=/n/holylabs/gershman_lab/Users/rtruong/playtrain-wt-tuning
LIVE=/n/holylabs/gershman_lab/Users/rtruong/playtrain
PY="$(cd ../analogen-jaxbench && pwd)/.venv/bin/python"
export PYTHONPATH="$(pwd)/src:$WT/src"
export PATH="$HOME/.cargo/bin:$PATH"
echo "node=$(hostname)"; uname -r
cd "$WT"
git log --oneline -1
RA=crates/rasterizer/target/release/libplaytrain_rasterizer.a
V=native/build/variants

echo "== build rv2g (rv2 recipe + DBG=1) =="
cp -a "$RA.rustpgo" "$RA"
CPP_MODE=use CPP_PROFDATA="$WT/pgo/tipnative.profdata" VIS=1 DBG=1 SKIP_HOST=1 \
  RUST_MODE=prebuilt OUT=build/libqjs_vec.so bash native/build_qjs_vec_tune.sh
cp native/build/libqjs_vec.so "$V/libqjs_vec.rv2g.so"
cp -a "$RA.v3" "$RA"
cp "$V/libqjs_vec.rv2.so" native/build/libqjs_vec.so   # restore the default
LIB="$WT/$V/libqjs_vec.rv2g.so"
md5sum "$LIB"

cd "${SLURM_SUBMIT_DIR:-.}"
GDIR="$LIVE/examples/games/js"
JOB="${SLURM_JOB_ID:-x}"
for G in breakout miner bigfish plunder maze; do
  echo; echo "################ $G"
  DAT="outputs/r3prof_${G}_${JOB}.dat"
  LD_PRELOAD="$(pwd)/benchmarks/prof_preload.so" PROF_OUT="$DAT" \
    "$PY" "$WT/pgo/_t2prof_driver.py" "$LIB" "$GDIR/$G.js" 60
  "$PY" "$WT/native/round3/prof_buckets.py" "$DAT" "$LIB" \
    > "outputs/r3prof_${G}_${JOB}.txt" 2>&1 || echo "BUCKET_FAIL $G"
  sed -n '1,20p' "outputs/r3prof_${G}_${JOB}.txt"
done
echo T7_PROF_DONE
