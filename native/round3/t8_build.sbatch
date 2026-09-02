#!/bin/bash -l
#SBATCH -J t8_build
#SBATCH -o logs/%x_%j.out
#SBATCH -e logs/%x_%j.err
#SBATCH -p serial_requeue
#SBATCH -C genoa
#SBATCH -N 1
#SBATCH -c 16
#SBATCH --mem=32G
#SBATCH -t 0-02:00
# Round-4 lever pc (rasterizer ellipse-offset cache + flat edge prepass):
# the rust code changed, so RA.rustpgo is stale — regenerate the rust profile
# on the new code (instrumented build -> 8-game x 30s workload -> merge with
# RUST's llvm-profdata, never the system one), then build the pc candidate
# with the rv2 recipe (tipnative C++ PGO + thin-LTO + VIS + fresh rust-PGO).
# C++ sources are unchanged, so tipnative.profdata stays self-consistent.
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

echo "== rust-instrumented build (new rasterizer code) =="
rm -rf "$WT/pgo/rust2_raw"; mkdir -p "$WT/pgo/rust2_raw"
CPP_MODE=use CPP_PROFDATA="$WT/pgo/tipnative.profdata" \
  RUST_MODE=gen RUST_PROFDIR="$WT/pgo/rust2_raw" SKIP_HOST=1 \
  OUT=build/libqjs_vec_rustgen.so bash native/build_qjs_vec_tune.sh
cp native/build/libqjs_vec_rustgen.so "$V/libqjs_vec.rustgen2.so"

echo "== rust profile workload =="
GDIR="$LIVE/examples/games/js"
LIB="$WT/$V/libqjs_vec.rustgen2.so"
LLVM_PROFILE_FILE="$WT/pgo/rust2_raw/%p-%m.profraw" \
  "$PY" "$WT/pgo/_t2prof_driver.py" "$LIB" "$GDIR/breakout.js" 10
n=$(ls "$WT/pgo/rust2_raw"/*.profraw 2>/dev/null | wc -l) || n=0
echo "smoke profraws: $n"; [ "$n" -gt 0 ] || { echo NO_RUST_PROFILES; exit 1; }
for G in breakout miner bigfish plunder maze chaser dodgeball coinrun; do
  echo "=== rust $G"
  LLVM_PROFILE_FILE="$WT/pgo/rust2_raw/%p-%m.profraw" \
    "$PY" "$WT/pgo/_t2prof_driver.py" "$LIB" "$GDIR/$G.js" 30 || echo "PROF_FAIL $G"
done
RPROFDATA=$(find "$HOME/.rustup/toolchains" -name llvm-profdata -path "*x86_64-unknown-linux-gnu*" | head -1)
[ -n "$RPROFDATA" ] || { echo "rust llvm-profdata not found"; exit 1; }
"$RPROFDATA" merge -o "$WT/pgo/rust2.profdata" "$WT/pgo/rust2_raw"/*.profraw
echo "rust2.profdata: $(ls -la "$WT/pgo/rust2.profdata")"

echo "== pc = rv2 recipe + new rasterizer + fresh rust-PGO =="
CPP_MODE=use CPP_PROFDATA="$WT/pgo/tipnative.profdata" VIS=1 \
  RUST_MODE=use RUST_PROFDATA="$WT/pgo/rust2.profdata" \
  OUT=build/libqjs_vec.so bash native/build_qjs_vec_tune.sh
cp native/build/libqjs_vec.so "$V/libqjs_vec.pc.so"
cp native/build/qjs_host "$V/qjs_host.pc"
cp -a "$RA" "$RA.rustpgo2"
# leave a plain-v3 build of the NEW code as the tree's default .a, and the
# worktree default .so back at rv2
( cd crates/rasterizer && rm -f target/release/libplaytrain_rasterizer.a \
  && RUSTFLAGS="-C target-cpu=x86-64-v3" cargo rustc --release --lib --crate-type staticlib )
cp "$V/libqjs_vec.rv2.so" native/build/libqjs_vec.so
md5sum "$V"/libqjs_vec.{pc,rv2}.so "$V/qjs_host.pc"
echo T8_BUILD_DONE
