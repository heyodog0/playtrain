#!/bin/bash -l
#SBATCH -J t10_build
#SBATCH -o logs/%x_%j.out
#SBATCH -e logs/%x_%j.err
#SBATCH -p serial_requeue
#SBATCH -C genoa
#SBATCH -N 1
#SBATCH -c 16
#SBATCH --mem=32G
#SBATCH -t 0-02:00
# Round-4 last-push build: pc3/dv = tip (hygiene-re-landed rasterizer +
# adaptive dirty-skip host) on the rv2 recipe. env_step_frame changed (hot),
# so collect a fresh self-consistent C++ profile (tipnative2) first — the mh
# confound taught us not to build on a profile whose hot functions were
# discarded on hash mismatch. Rust profile: rust2.profdata (collected on the
# same rasterizer code; the hygiene edits don't change function content).
# pc3 and dv are the SAME .so — dv is measured with QJS_DIRTY=1.
set -uo pipefail
cd "${SLURM_SUBMIT_DIR:-.}"; mkdir -p logs
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
GDIR="$LIVE/examples/games/js"

echo "== rebuild rasterizer .a (hygiene code, plain v3 for the gen phase) =="
( cd crates/rasterizer && rm -f target/release/libplaytrain_rasterizer.a \
  && RUSTFLAGS="-C target-cpu=x86-64-v3" cargo rustc --release --lib --crate-type staticlib )

echo "== C++ instrumented build + profile (tipnative2) =="
rm -rf "$WT/pgo/tipnative2_raw"
PGO_MODE=gen PROFDIR="$WT/pgo/tipnative2_raw" bash native/build_qjs_vec_pgo.sh
cp native/build/libqjs_vec_pgogen.so "$V/libqjs_vec.t10gen.so"
cd "${SLURM_SUBMIT_DIR:-.}"
for G in breakout miner bigfish plunder maze chaser dodgeball coinrun; do
  echo "=== $G"
  LLVM_PROFILE_FILE="$WT/pgo/tipnative2_raw/%p-%m.profraw" \
    "$PY" "$WT/pgo/_t2prof_driver.py" "$WT/$V/libqjs_vec.t10gen.so" "$GDIR/$G.js" 30 \
    || echo "PROF_FAIL $G"
done
n=$(ls "$WT/pgo/tipnative2_raw"/*.profraw 2>/dev/null | wc -l) || n=0
echo "profraws: $n"; [ "$n" -gt 0 ] || { echo NO_PROFILES; exit 1; }
llvm-profdata merge -o "$WT/pgo/tipnative2.profdata" "$WT/pgo/tipnative2_raw"/*.profraw

echo "== pc3/dv = rv2 recipe on tip =="
cd "$WT"
CPP_MODE=use CPP_PROFDATA="$WT/pgo/tipnative2.profdata" VIS=1 \
  RUST_MODE=use RUST_PROFDATA="$WT/pgo/rust2.profdata" \
  OUT=build/libqjs_vec.so bash native/build_qjs_vec_tune.sh
cp native/build/libqjs_vec.so "$V/libqjs_vec.pc3.so"
cp native/build/libqjs_vec.so "$V/libqjs_vec.dv.so"
cp native/build/qjs_host "$V/qjs_host.pc3"
cp native/build/qjs_host "$V/qjs_host.dv"
cp -a "$RA" "$RA.rustpgo3"
( cd crates/rasterizer && rm -f target/release/libplaytrain_rasterizer.a \
  && RUSTFLAGS="-C target-cpu=x86-64-v3" cargo rustc --release --lib --crate-type staticlib )
cp "$V/libqjs_vec.rv2.so" native/build/libqjs_vec.so
md5sum "$V"/libqjs_vec.{pc3,rv2}.so "$V/qjs_host.pc3"
echo T10_BUILD_DONE
