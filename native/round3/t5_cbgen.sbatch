#!/bin/bash -l
#SBATCH -J t5_cbgen
#SBATCH -o logs/%x_%j.out
#SBATCH -e logs/%x_%j.err
#SBATCH -p serial_requeue
#SBATCH -C genoa
#SBATCH -N 1
#SBATCH -c 16
#SBATCH --mem=32G
#SBATCH -t 0-01:30
# Round-3 lever 2 (p5 command buffer), phase 1: self-consistent PGO profile
# for the cmdbuf sources. Instrumented tip+cmdbuf build, on-node cmdbuf
# on/off obs parity check (abort early if the lever is broken), then the
# 8-game x 30 s profile with PLAYTRAIN_QJS_CMDBUF=1 (the arm's operating
# point), merged to pgo/cbnative.profdata.
# Submit from the playtrain-trainers repo root (like the t3/t4 chain).
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
cp -a "$RA.v3" "$RA"
rm -rf "$WT/pgo/cb_raw"
PGO_MODE=gen PROFDIR="$WT/pgo/cb_raw" bash native/build_qjs_vec_pgo.sh
cp native/build/libqjs_vec_pgogen.so native/build/variants/libqjs_vec.cbgen.so
cd "${SLURM_SUBMIT_DIR:-.}"
GDIR="$LIVE/examples/games/js"
LIB="$WT/native/build/variants/libqjs_vec.cbgen.so"

echo "== cmdbuf on/off parity on the instrumented build =="
"$PY" - "$LIB" "$GDIR" <<'PYEOF' || { echo CB_PARITY_FAIL; exit 1; }
import hashlib, os, sys
import numpy as np
sys.path.insert(0, "/n/holylabs/gershman_lab/Users/rtruong/playtrain-wt-tuning/src")
from playtrain.runtime.native_vec_env import NativeVecEnv
lib, gdir = sys.argv[1], sys.argv[2]
def run(game, on):
    os.environ["PLAYTRAIN_QJS_CMDBUF"] = "1" if on else "0"
    env = NativeVecEnv(game, num_envs=16, obs_size=64, max_steps=2000,
                       num_threads=2, autoreset=True, frame_skip=1,
                       games_dir=gdir, lib_path=lib)
    h = hashlib.md5()
    h.update(np.ascontiguousarray(env.reset(seeds=np.arange(16, dtype=np.int32))).tobytes())
    rng = np.random.default_rng(3)
    for _ in range(200):
        out = env.step(rng.integers(0, 8, 16).astype(np.int32))
        for x in (out if isinstance(out, tuple) else (out,)):
            if isinstance(x, np.ndarray):
                h.update(np.ascontiguousarray(x).tobytes())
    env.close()
    return h.hexdigest()
for g in ["breakout", "bigfish", "maze"]:
    a, b = run(g, False), run(g, True)
    print(g, "OK" if a == b else "MISMATCH", flush=True)
    assert a == b, g
print("CB_PARITY_OK")
PYEOF

echo "== profile (cmdbuf ON) =="
for G in breakout miner bigfish plunder maze chaser dodgeball coinrun; do
  echo "=== $G"
  PLAYTRAIN_QJS_CMDBUF=1 LLVM_PROFILE_FILE="$WT/pgo/cb_raw/%p-%m.profraw" \
    "$PY" "$WT/pgo/_t2prof_driver.py" "$LIB" "$GDIR/$G.js" 30 || echo "PROF_FAIL $G"
done
n=$(ls "$WT/pgo/cb_raw"/*.profraw 2>/dev/null | wc -l) || n=0
echo "profraws: $n"
[ "$n" -gt 0 ] || { echo NO_PROFILES; exit 1; }
llvm-profdata merge -o "$WT/pgo/cbnative.profdata" "$WT/pgo/cb_raw"/*.profraw
echo T5_CBGEN_DONE
