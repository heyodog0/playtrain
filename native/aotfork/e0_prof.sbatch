#!/bin/bash -l
#SBATCH -J e0_prof
#SBATCH -o logs/%x_%j.out
#SBATCH -e logs/%x_%j.err
#SBATCH -p serial_requeue
#SBATCH -C genoa
#SBATCH -N 1
#SBATCH -c 16
#SBATCH --mem=48G
#SBATCH -t 0-02:30
# E0 (PLAN-engine-tier-round6.md §5): profile futT2. Rebuild the tuned recipe
# with DBG=1 (-g only; codegen unchanged) under TAG=T2dbg so no measured
# artifact is rewritten, SIGPROF the vec workload (prof_preload.so, ~1 kHz,
# 128 envs x 5 threads, 60 s) on the 5 profiled games + coinrun/heist, for BOTH
# arms: forkT2dbg (interpreter) and futT2dbg (qjsc -A). Symbolize --inlines,
# bucket (prof_buckets_aot.py): buckets / innermost frames / per-JS-function /
# per-opcode. Sanity: 20 s throughput of T2 vs T2dbg (no preload) per arm on two
# games; F1 stderr scanned for "Bytecode mismatch" (rule 9).
# Writes only *T2dbg* artifacts + out/e0_<job>/. No bench job may be queued
# concurrently (rule 7) — this job builds.
set -uo pipefail
cd "${SLURM_SUBMIT_DIR:-.}"; mkdir -p logs
BASE=/n/holylabs/gershman_lab/Users/rtruong
WE=$BASE/playtrain-wt-engine; WT=$BASE/playtrain-wt-tuning; LIVE=$BASE/playtrain; TR=$BASE/playtrain-trainers
PY=$BASE/analogen-jaxbench/.venv/bin/python
export PATH="$HOME/.cargo/bin:/n/home06/truong/.local-node/bin:$PATH"
export PYTHONPATH="$TR/src:$WE/src" OMP_NUM_THREADS=1
echo "node=$(hostname) kernel=$(uname -r) job=${SLURM_JOB_ID:-none}"; lscpu | grep "Model name" | head -1
cd "$WE" || exit 1; git log --oneline -1
OUT=$WE/native/aotfork/out; GDIR=$LIVE/examples/games/js
GAMES="breakout plunder bigfish miner maze coinrun heist"
JOB="${SLURM_JOB_ID:-x}"; OUTD="$OUT/e0_$JOB"; mkdir -p "$OUTD"
RA_PGO=$OUT/libplaytrain_rasterizer.a.rustpgo_adv
PRELOAD=$TR/benchmarks/prof_preload.so
for f in "$RA_PGO" "$OUT/qjsc" "$OUT/fork24.profdata" "$OUT/libqjs_vec.forkT2.so" "$PRELOAD"; do [ -e "$f" ] || { echo "missing $f"; exit 1; }; done
for g in $GAMES; do [ -f "$OUT/libqjs_vec.futT2_$g.so" ] || { echo "missing futT2 $g"; exit 1; }; done
cd native/aotfork; export FORK_OUT=$OUT

echo "== 1. debug-info builds of the tuned recipe (TAG=T2dbg, DBG=1) =="
export DBG=1 TUNE=use PROFDATA=$OUT/fork24.profdata TAG=T2dbg RA=$RA_PGO
rm -rf "$OUT/objT2dbg" "$OUT/picT2dbg"
bash build_fork.sh engine 2>&1 | tail -1
bash build_fork.sh vec0 2>&1 | tail -1
for g in $GAMES; do echo "$GDIR/$g.js"; done | xargs -P 7 -I{} bash -c 'bash build_fork.sh vec1 "$1" 2>&1 | grep "^built" || echo "BUILD_FAIL $1"' _ {}
unset DBG TUNE PROFDATA TAG RA
n=$(ls "$OUT"/libqjs_vec.futT2dbg_*.so 2>/dev/null | wc -l); echo "futT2dbg .so built: $n / 7"; [ "$n" -eq 7 ] || { echo BUILD_INCOMPLETE; exit 1; }
for g in breakout maze; do
  echo "dbg-has-symbols $g: $(llvm-symbolizer --obj="$OUT/libqjs_vec.futT2dbg_$g.so" --functions=linkage 0x$(nm -D --defined-only "$OUT/libqjs_vec.futT2dbg_$g.so" | awk '/ T vec_step/{print $1; exit}') | head -1)"
  echo "text-size T2 vs T2dbg $g: $(size "$OUT/libqjs_vec.futT2_$g.so" | tail -1 | awk '{print $1}') $(size "$OUT/libqjs_vec.futT2dbg_$g.so" | tail -1 | awk '{print $1}')"
done

echo "== 2. sanity: T2 vs T2dbg throughput, no preload, 20 s each (codegen should be identical) =="
for g in breakout maze; do
  for a in "futT2=$OUT/libqjs_vec.futT2_$g.so" "futT2dbg=$OUT/libqjs_vec.futT2dbg_$g.so" "forkT2=$OUT/libqjs_vec.forkT2.so" "forkT2dbg=$OUT/libqjs_vec.forkT2dbg.so"; do
    echo -n "  $g ${a%%=*}: "; QJS_DIRTY=1 "$PY" vec_prof_driver.py "${a#*=}" "$GDIR/$g.js" 20 2>&1 | grep -o '[0-9,]* steps/s' || echo RUN_FAIL
  done
done

echo "== 3. SIGPROF: 60 s per (arm, game), 128 envs x 5 threads =="
for g in $GAMES; do
  for a in fut fork; do
    if [ $a = fut ]; then LIB="$OUT/libqjs_vec.futT2dbg_$g.so"; AOTC="$OUT/aot_$g/game_aot.c"; else LIB="$OUT/libqjs_vec.forkT2dbg.so"; AOTC=""; fi
    DAT="$OUTD/prof_${a}_${g}.dat"; ERR="$OUTD/prof_${a}_${g}.stderr"
    echo; echo "################ $a $g  $(md5sum "$LIB" | cut -c1-32)"
    LD_PRELOAD="$PRELOAD" PROF_OUT="$DAT" QJS_DIRTY=1 "$PY" vec_prof_driver.py "$LIB" "$GDIR/$g.js" 60 2> "$ERR"
    grep -o '[0-9,]* steps/s.*' "$ERR" | tail -1
    if grep -q "Bytecode mismatch" "$ERR"; then echo "BYTECODE_MISMATCH $a $g"; grep -m3 "Bytecode mismatch" "$ERR"; fi
    [ -s "$DAT" ] || { echo "PROF_EMPTY $a $g"; continue; }
    "$PY" prof_buckets_aot.py "$DAT" "$LIB" $AOTC > "$OUTD/buckets_${a}_${g}.txt" 2>&1 || echo "BUCKET_FAIL $a $g"
    sed -n '1,22p' "$OUTD/buckets_${a}_${g}.txt"
  done
done

echo "== 4. summary: bucket table across games (fut = futT2dbg, fork = forkT2dbg) =="
"$PY" - "$OUTD" $GAMES <<'PYEOF'
import re, sys, os
outd, games = sys.argv[1], sys.argv[2:]
def load(a, g):
    p = f"{outd}/buckets_{a}_{g}.txt"
    if not os.path.exists(p): return {}, {}
    B, F, sec = {}, {}, None
    for line in open(p):
        if line.startswith("== buckets"): sec = "b"; continue
        if line.startswith("== opcode families"): sec = "f"; continue
        if line.startswith("=="): sec = None; continue
        m = re.match(r"\s+(.+?)\s+([\d.]+)%\s+([\d.]+)%", line)
        if sec == "b" and m: B[m.group(1).strip()] = float(m.group(2))
        m2 = re.match(r"\s+([\d.]+)%\s+(.+)$", line)
        if sec == "f" and m2: F[m2.group(2).strip()] = float(m2.group(1))
    return B, F
order = ["AOT residual", "interp dispatch", "property access", "refcount/free", "arith slow paths", "conversions", "strict_eq/str-cmp",
         "call machinery", "array ops", "gc/alloc", "atoms/strings", "math (fm/libm)", "rasterizer", "p5/host/blit", "other"]
for a in ("fut", "fork"):
    data = {g: load(a, g) for g in games}
    print(f"\n{a}: % of .so samples")
    print("%-20s" % "bucket" + "".join("%10s" % g[:9] for g in games))
    for b in order:
        row = [data[g][0].get(b, 0.0) for g in games]
        if any(row): print("%-20s" % b + "".join("%10.1f" % v for v in row))
    if a == "fut":
        print("%-20s" % "-- opcode families")
        fams = sorted({k for g in games for k in data[g][1]})
        for f in fams:
            print("%-20s" % f[:20] + "".join("%10.1f" % data[g][1].get(f, 0.0) for g in games))
PYEOF
echo "E0_PROF_DONE $(date)"
