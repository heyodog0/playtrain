#!/bin/bash -l
#SBATCH -J adv_recut
#SBATCH -o logs/%x_%j.out
#SBATCH -e logs/%x_%j.err
#SBATCH -p serial_requeue
#SBATCH -C genoa
#SBATCH -w holy8a28510
#SBATCH -N 1
#SBATCH -c 16
#SBATCH --mem=32G
#SBATCH -t 0-04:00
# ADV RE-CUT (HANDOFF-2026-09-04-round6-E3-adoption.md §6.4). The adopted adv
# (b3709b39…, job 43780730, holy8a28510) was built from tuning commit 5a42f71, which
# PREDATES the style-cache determinism fix ef74835 (one qbert terminal frame differs
# from the V8 reference). This re-cuts the SAME recipe (analogen-jaxbench/adopt_build.sbatch:
# plain-v3 rasterizer for the gen phase, C++ PGO profile on 8 games x 30 s, then
# PGO-use + thin-LTO + hidden vis + Rust-PGO rasterizer with rust2.profdata) from the
# engine-tier tree = main's native code (ef74835 + the OFF-by-default draw counters
# d336297) + native/aotfork. Same node as adv. Outputs go to out/*.adv2*; the tree's
# stock artifacts (native/build/libqjs_vec.so = the checksum reference, qjs_host, the
# plain rasterizer .a) are backed up and restored. Then: gate adv vs adv2 vs V8 on the
# 33 paper games x 3 seeds; checksum24 ng / adv / adv2; null A/B adv vs adv2, 24 x 3.
# Whether adv2 REPLACES adv as the paper baseline is Ryan's call.
set -uo pipefail
cd "${SLURM_SUBMIT_DIR:-.}"; mkdir -p logs
BASE=/n/holylabs/gershman_lab/Users/rtruong
WE=$BASE/playtrain-wt-engine; WT=$BASE/playtrain-wt-tuning; TR=$BASE/playtrain-trainers
PY=$BASE/analogen-jaxbench/.venv/bin/python
export PATH="$HOME/.cargo/bin:/n/home06/truong/.local-node/bin:$PATH" PYTHONPATH="$TR/src:$WE/src" OMP_NUM_THREADS=1
echo "node=$(hostname) kernel=$(uname -r) job=${SLURM_JOB_ID:-none}"; lscpu | grep "Model name" | head -1
cd "$WE" || exit 1; git log --oneline -1
OUT=$WE/native/aotfork/out; GDIR=$WE/examples/games/js
PROCGEN="bigfish bossfight caveflyer chaser climber coinrun dodgeball fruitbot heist jumper leaper maze miner ninja plunder starpilot"
ALE="asteroids breakout freeway frostbite pong qbert seaquest space_invaders"
JOB="${SLURM_JOB_ID:-x}"; OUTD="$OUT/adv2_$JOB"; mkdir -p "$OUTD"
RA=$WE/crates/rasterizer/target/release/libplaytrain_rasterizer.a
for f in "$WT/pgo/_t2prof_driver.py" "$WT/pgo/rust2.profdata" "$OUT/libqjs_vec.adv.so" "$OUT/qjs_host.adv" native/build/libqjs_vec.so native/build/qjs_host "$RA" native/frozenmath/libfrozenmath_pic.a; do [ -e "$f" ] || { echo "missing $f"; exit 1; }; done
git merge-base --is-ancestor ef74835 HEAD || { echo "tree lacks ef74835"; exit 1; }

echo "== 0. back up the tree's stock artifacts (restored on exit) =="
BK=$OUTD/backup; mkdir -p "$BK"
cp -a native/build/libqjs_vec.so native/build/qjs_host "$BK/"; cp -a "$RA" "$BK/libplaytrain_rasterizer.a"
restore() { cp -a "$BK/libqjs_vec.so" "$BK/qjs_host" native/build/ && cp -a "$BK/libplaytrain_rasterizer.a" "$RA" && echo "restored stock artifacts: $(md5sum native/build/libqjs_vec.so | cut -c1-8) (expect $(md5sum "$BK/libqjs_vec.so" | cut -c1-8))"; }
trap restore EXIT
echo "stock ng $(md5sum native/build/libqjs_vec.so | cut -c1-32)  adv $(md5sum "$OUT/libqjs_vec.adv.so" | cut -c1-32) (expect b3709b3980193d0890856dedc923e923 = adv1; since 2026-09-04 out/libqjs_vec.adv.so IS adv2 1c514936)"

echo "== 1. plain-v3 rasterizer for the gen phase =="
( cd crates/rasterizer && rm -f target/release/libplaytrain_rasterizer.a && RUSTFLAGS="-C target-cpu=x86-64-v3" cargo rustc -q --release --lib --crate-type staticlib ) || { echo RUST_BUILD_FAIL; exit 1; }

echo "== 2. C++ instrumented build + profile (8 games x 30 s, the adopted set) =="
PROFDIR=$OUTD/raw; rm -rf "$PROFDIR"; mkdir -p "$PROFDIR"
PGO_MODE=gen PROFDIR="$PROFDIR" bash native/build_qjs_vec_pgo.sh 2>&1 | tail -2 || { echo GEN_BUILD_FAIL; exit 1; }
for g in breakout miner bigfish plunder maze chaser dodgeball coinrun; do
  LLVM_PROFILE_FILE="$PROFDIR/%p-%m.profraw" "$PY" "$WT/pgo/_t2prof_driver.py" "$WE/native/build/libqjs_vec_pgogen.so" "$GDIR/$g.js" 30 || echo "PROF_FAIL $g"
done
n=$(ls "$PROFDIR"/*.profraw 2>/dev/null | wc -l); echo "profraws: $n"; [ "$n" -ge 8 ] || { echo PROFILE_INCOMPLETE; exit 1; }
llvm-profdata merge -o "$OUTD/adv2.profdata" "$PROFDIR"/*.profraw

echo "== 3. tuned build: PGO-use + thin-LTO + VIS + Rust-PGO (rust2.profdata) =="
CPP_MODE=use CPP_PROFDATA="$OUTD/adv2.profdata" VIS=1 RUST_MODE=use RUST_PROFDATA="$WT/pgo/rust2.profdata" OUT=build/libqjs_vec.so bash native/build_qjs_vec_tune.sh 2>&1 | tail -3 || { echo TUNE_BUILD_FAIL; exit 1; }
cp native/build/libqjs_vec.so "$OUT/libqjs_vec.adv2.so"; cp native/build/qjs_host "$OUT/qjs_host.adv2"; cp -a "$RA" "$OUT/libplaytrain_rasterizer.a.rustpgo_adv2"
cp "$OUTD/adv2.profdata" "$OUT/adv2.profdata"
restore; trap - EXIT
for f in libqjs_vec.adv.so libqjs_vec.adv2.so qjs_host.adv qjs_host.adv2 libplaytrain_rasterizer.a.rustpgo_adv libplaytrain_rasterizer.a.rustpgo_adv2; do echo "md5 $f $(md5sum "$OUT/$f" | cut -c1-32)"; done

cd native/aotfork
echo "== 4. gate vs V8: adv2 (as f0) and adv, 33 paper games x 3 seeds x 3000 =="
GT=$OUT/gate_adv2; rm -rf "$GT"; mkdir -p "$GT"; ln -sf "$OUT/qjs_host.adv2" "$GT/host_f0"
REFDIR=$OUT/gate_ref GAMES_DIR=$GDIR EXTRA_HOSTS="adv=$OUT/qjs_host.adv" bash gate_fork.sh "$GT" --all 3000 2>&1 | tee "$OUTD/gate.txt" | grep -v "^  PASS"
echo "== 4b. checksum 2000 x 24: ng (stock, reference) vs adv vs adv2 =="
QJS_DIRTY=1 WE=$WE GDIR=$GDIR "$PY" aot_obs_checksum.py 2000 "$(echo $PROCGEN $ALE | tr ' ' ',')" \
  ng="$WE/native/build/libqjs_vec.so" adv="$OUT/libqjs_vec.adv.so" adv2="$OUT/libqjs_vec.adv2.so" 2>&1 | tee "$OUTD/checksum.txt" | grep -E "MISMATCH|MISSING|CHECKSUM"
echo "== 2b. async/group gate (PingPongVecEnv path: vec_create_async + vec_set_group_mode), 300 x 512 x 24 =="
# The path double-buffered training uses; no other gate runs it (a 6x async-only
# regression shipped through checksum + gate_fork + holdout unnoticed, see
# handoff/INVESTIGATE-aot-async-regression.md). Digests must equal the reference
# lib's SYNC digest; pingpong throughput must clear 0.8x the reference lib and
# 0.6x the lib's own sync path.
QJS_DIRTY=1 WE=$WE GDIR=$GDIR "$PY" gate_async.py 300 "$(echo $PROCGEN $ALE | tr ' ' ',')" \
  ng="$WE/native/build/libqjs_vec.so" adv2="$OUT/libqjs_vec.adv2.so" 2>&1 | tee "$OUTD/async.txt" | grep -E "FAIL|MISSING|ASYNC GATE"
grep -q "FAIL" "$OUTD/async.txt" && echo "ASYNC_GATE_FAIL (see $OUTD/async.txt)"

bench() {  # game arm libpath rep
  local g=$1 a=$2 lib=$3 r=$4
  echo "=== $g rep$r $a $(md5sum "$lib" | cut -c1-32)"
  QJS_DIRTY=1 "$PY" "$TR/benchmarks/bench_vec_knobs.py" --game "$g" --games-dir "$GDIR" \
    --lib-path "$lib" --mode sync --envs 128 --workers 1 --env-threads 5 \
    --steps 300 --warmup 20 --max-steps 2000 --frame-skip 1 \
    --out "$OUTD/${g}_${a}_r${r}.json" 2>&1 | grep -o '"env_steps_per_s": [0-9]*' || echo "RUN_FAIL $g $a rep$r"
}
echo "== 5. null A/B adv vs adv2, 24 games x 3 reps interleaved (1 worker x 128 x 5) =="
for r in 1 2 3; do for g in $PROCGEN $ALE; do bench "$g" adv "$OUT/libqjs_vec.adv.so" $r; bench "$g" adv2 "$OUT/libqjs_vec.adv2.so" $r; done; done
echo "== summary =="
"$PY" - "$OUTD" <<'PYEOF'
import json, sys, glob, os, collections, statistics, math
gm = lambda xs: math.exp(sum(map(math.log, xs)) / len(xs)) if xs else float("nan")
PG = "bigfish bossfight caveflyer chaser climber coinrun dodgeball fruitbot heist jumper leaper maze miner ninja plunder starpilot".split()
d = collections.defaultdict(list)
for f in glob.glob(sys.argv[1] + "/*.json"):
    g, a, r = os.path.basename(f)[:-5].rsplit("_", 2); d[(g, a)].append(json.load(open(f))["env_steps_per_s"])
print("\nNULL A/B adv vs adv2 (1 worker x 128 x 5, env steps/s, medians of 3)")
print("%-16s%10s%10s%10s" % ("game", "adv", "adv2", "adv2/adv"))
R = collections.defaultdict(list)
for g in sorted({g for g, _ in d}, key=lambda g: (g not in PG, g)):
    if (g, "adv") in d and (g, "adv2") in d:
        a, b = statistics.median(d[(g, "adv")]), statistics.median(d[(g, "adv2")]); R[g in PG].append(b / a)
        print("%-16s%10.0f%10.0f%10.3f" % (g, a, b, b / a))
print("%-36s%10.3f" % ("geomean-PG16", gm(R[True]))); print("%-36s%10.3f" % ("geomean-ALE8", gm(R[False]))); print("%-36s%10.3f" % ("geomean-24", gm(R[True] + R[False])))
PYEOF
echo "== done $(date) =="
