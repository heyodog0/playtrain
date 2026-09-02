#!/bin/bash -l
#SBATCH -J t5_build
#SBATCH -o logs/%x_%j.out
#SBATCH -e logs/%x_%j.err
#SBATCH -p serial_requeue
#SBATCH -C genoa
#SBATCH -N 1
#SBATCH -c 16
#SBATCH --mem=32G
#SBATCH -t 0-01:00
# Round-3 lever 2, phase 2: the cb candidate = rv2 recipe (self-consistent
# whole-.so PGO + thin-LTO + rust-PGO .a + hidden visibility) built from the
# tip+cmdbuf sources with pgo/cbnative.profdata. cb0 is the SAME binary
# measured with the flag off (isolates source-change cost from buffer gain).
set -uo pipefail
cd "${SLURM_SUBMIT_DIR:-.}"; mkdir -p logs
WT=/n/holylabs/gershman_lab/Users/rtruong/playtrain-wt-tuning
export PATH="$HOME/.cargo/bin:$PATH"
cd "$WT"
git log --oneline -1
RA=crates/rasterizer/target/release/libplaytrain_rasterizer.a
V=native/build/variants
echo "== cb =="
cp -a "$RA.rustpgo" "$RA"
CPP_MODE=use CPP_PROFDATA="$WT/pgo/cbnative.profdata" VIS=1 RUST_MODE=prebuilt \
  OUT=build/libqjs_vec.so bash native/build_qjs_vec_tune.sh
cp native/build/libqjs_vec.so "$V/libqjs_vec.cb.so"
cp native/build/qjs_host "$V/qjs_host.cb"
cp "$V/libqjs_vec.cb.so" "$V/libqjs_vec.cb0.so"
cp -a "$RA.v3" "$RA"
# leave the worktree default .so at rv2 (the round-2 winner)
cp "$V/libqjs_vec.rv2.so" native/build/libqjs_vec.so
md5sum "$V"/libqjs_vec.{cb,rv2,rv2r,rv2bolt}.so "$V/qjs_host.cb"
echo T5_BUILD_DONE
