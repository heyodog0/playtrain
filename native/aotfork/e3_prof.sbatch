#!/bin/bash -l
#SBATCH -J e3_prof
#SBATCH -o logs/%x_%j.out
#SBATCH -e logs/%x_%j.err
#SBATCH -p serial_requeue
#SBATCH -C genoa
#SBATCH -N 1
#SBATCH -c 16
#SBATCH --mem=48G
#SBATCH -t 0-02:30
# E3 re-profile: E0 recipe on the tuned intrinsic build. TAG=IT2dbg (-g only) rebuilt
# from forkI24.profdata with INTR=1; SIGPROF the vec workload on the 7 games; arms
# futIT2dbg (lever) and, for the delta, the existing futT2dbg. Writes only *IT2dbg*
# artifacts + out/e3prof_<job>/. Answers: what is left after E3 (E2/E4/fields sizing).
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
JOB="${SLURM_JOB_ID:-x}"; OUTD="$OUT/e3prof_$JOB"; mkdir -p "$OUTD"
RA_PGO=$OUT/libplaytrain_rasterizer.a.rustpgo_adv
PRELOAD=$TR/benchmarks/prof_preload.so
for f in "$RA_PGO" "$OUT/qjsc" "$OUT/forkI24.profdata" "$OUT/libqjs_vec.forkT2dbg.so" "$PRELOAD"; do [ -e "$f" ] || { echo "missing $f"; exit 1; }; done
for g in $GAMES; do [ -f "$OUT/libqjs_vec.futIT2_$g.so" ] && [ -f "$OUT/libqjs_vec.futT2dbg_$g.so" ] || { echo "missing futIT2/futT2dbg $g"; exit 1; }; done
cd native/aotfork; export FORK_OUT=$OUT

echo "== 1. debug-info builds of the tuned intrinsic recipe (TAG=IT2dbg, DBG=1, INTR=1) =="
export DBG=1 INTR=1 TUNE=use PROFDATA=$OUT/forkI24.profdata TAG=IT2dbg RA=$RA_PGO
rm -rf "$OUT/objIT2dbg" "$OUT/picIT2dbg"
bash build_fork.sh engine 2>&1 | tail -1
bash build_fork.sh vec0 2>&1 | tail -1
for g in $GAMES; do echo "$GDIR/$g.js"; done | xargs -P 7 -I{} bash -c 'bash build_fork.sh vec1 "$1" 2>&1 | grep "^built" || echo "BUILD_FAIL $1"' _ {}
unset DBG INTR TUNE PROFDATA TAG RA
n=$(ls "$OUT"/libqjs_vec.futIT2dbg_*.so 2>/dev/null | wc -l); echo "futIT2dbg .so built: $n / 7"; [ "$n" -eq 7 ] || { echo BUILD_INCOMPLETE; exit 1; }
for g in breakout maze; do
  echo "text-size IT2 vs IT2dbg $g: $(size "$OUT/libqjs_vec.futIT2_$g.so" | tail -1 | awk '{print $1}') $(size "$OUT/libqjs_vec.futIT2dbg_$g.so" | tail -1 | awk '{print $1}')"
done

echo "== 2. sanity: T2 vs T2dbg throughput, no preload, 20 s each (codegen should be identical) =="
for g in breakout maze; do
  for a in "futIT2=$OUT/libqjs_vec.futIT2_$g.so" "futIT2dbg=$OUT/libqjs_vec.futIT2dbg_$g.so"; do
    echo -n "  $g ${a%%=*}: "; QJS_DIRTY=1 "$PY" vec_prof_driver.py "${a#*=}" "$GDIR/$g.js" 20 2>&1 | grep -o '[0-9,]* steps/s' || echo RUN_FAIL
  done
done

echo "== 3. SIGPROF: 60 s per (arm, game), 128 envs x 5 threads =="
for g in $GAMES; do
  for a in fut fork; do   # fut = futIT2dbg (lever); fork = the E0 futT2dbg build, re-profiled here on the same node for the delta
    if [ $a = fut ]; then LIB="$OUT/libqjs_vec.futIT2dbg_$g.so"; AOTC="$OUT/aotI_$g/game_aot.c"; else LIB="$OUT/libqjs_vec.futT2dbg_$g.so"; AOTC="$OUT/aot_$g/game_aot.c"; fi
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

echo "== 4. summary: bucket table across games (fut = futIT2dbg, fork = futT2dbg) =="
"$PY" e0_summary.py "$OUTD" $GAMES
echo "E3_PROF_DONE $(date)"
