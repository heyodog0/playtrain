#!/bin/bash -l
#SBATCH -J e6_holdout
#SBATCH -o logs/%x_%j.out
#SBATCH -e logs/%x_%j.err
#SBATCH -p serial_requeue
#SBATCH -C genoa
#SBATCH -N 1
#SBATCH -c 16
#SBATCH --mem=64G
#SBATCH -t 0-04:00
# E6.2 step 2 — HOLDOUT (HANDOFF-2026-09-04-round6-E3-adoption.md §6.2): the 9 paper
# games that were never profiled or measured. For each: tier 2 (UNIT_NOPGO unit on the
# forkI24 PGO engine, TAG=IT2u) and tier 3 (instrumented run of THIS game only, its
# profraw merged INTO a copy of forkI24.profdata, engine + unit rebuilt with the merged
# profile, TAG=IT3h_<g>) — tier 3 here is exactly what compile-at-load tier 3 will do.
# Bench adv / tier2 / tier3, 1 worker x 128 x 5, 3 interleaved reps. Exactness: vec obs
# checksum vs ng for tier2 and tier3 on the 9 (tier-2 hosts were gated in e6_tier2_build).
# Pass: geomean tier2/adv on the 9 within ~5% of the 24-game tier-2 number; tier3/tier2 ~ 1.05-1.10.
# aim_trainer is mouse-driven; a RUN_FAIL there is reported, not fatal.
# Writes only futIT2u_<9>, futIgen_<9>, *IT3h_* artifacts, hold_<g>.profdata, out/e6hold_<job>/.
set -uo pipefail
cd "${SLURM_SUBMIT_DIR:-.}"; mkdir -p logs
BASE=/n/holylabs/gershman_lab/Users/rtruong
WE=$BASE/playtrain-wt-engine; LIVE=$BASE/playtrain; TR=$BASE/playtrain-trainers
PY=$BASE/analogen-jaxbench/.venv/bin/python
export PATH="$HOME/.cargo/bin:/n/home06/truong/.local-node/bin:$PATH"
export PYTHONPATH="$TR/src:$WE/src" OMP_NUM_THREADS=1
echo "node=$(hostname) kernel=$(uname -r) job=${SLURM_JOB_ID:-none}"; lscpu | grep "Model name" | head -1
cd "$WE" || exit 1; git log --oneline -1
OUT=$WE/native/aotfork/out; GDIR=$LIVE/examples/games/js
HOLD="aim_trainer breakout.multi downwell_fresh flappy_bird flappy_bird.dunk2 frostbite.jungle jump_king qbert.v2 vvvvvv"
JOB="${SLURM_JOB_ID:-x}"; OUTD="$OUT/e6hold_$JOB"; mkdir -p "$OUTD"
RA_PGO=$OUT/libplaytrain_rasterizer.a.rustpgo_adv; RA_PLAIN=$WE/crates/rasterizer/target/release/libplaytrain_rasterizer.a
NGSO=$WE/native/build/libqjs_vec.so
for f in "$RA_PGO" "$RA_PLAIN" "$NGSO" "$OUT/qjsc" "$OUT/prelude.js" "$OUT/forkI24.profdata" "$OUT/libqjs_vec.adv.so" "$OUT/picIT2u/libqjs_forkaot.a" "$OUT/picIgen/libqjs_forkaot.a"; do [ -e "$f" ] || { echo "missing $f — run e3_tune24 + e6_tier2_build first"; exit 1; }; done
for g in $HOLD; do [ -f "$GDIR/$g.js" ] || { echo "missing game $g"; exit 1; }; done
cd native/aotfork; export FORK_OUT=$OUT INTR=1
export TUNE=use PROFDATA=$OUT/forkI24.profdata TAG=IT2u UNIT_NOPGO=1 RA=$RA_PGO
echo "== 1. tier-2 vec builds for the 9 (TAG=IT2u; engine archives from e6_tier2_build) =="
for g in $HOLD; do echo "$GDIR/$g.js"; done | xargs -P 9 -I{} bash -c 'bash build_fork.sh vec1 "$1" 2>&1 | grep -E "^built|error|failed" || echo "BUILD_FAIL vec1 $1"' _ {}
n=0; for g in $HOLD; do [ -f "$OUT/libqjs_vec.futIT2u_$g.so" ] && n=$((n+1)); done; echo "tier-2 .so: $n / 9"; [ "$n" -eq 9 ] || { echo TIER2_BUILD_INCOMPLETE; exit 1; }

echo "== 2. tier-3 rehearsal: instrumented unit (TAG=Igen) -> 30 s profile -> merge into forkI24 -> full rebuild (TAG=IT3h_<g>) =="
export TUNE=gen PROFDIR=$OUT/prof_rawI24 TAG=Igen RA=$RA_PLAIN; unset PROFDATA UNIT_NOPGO
for g in $HOLD; do echo "$GDIR/$g.js"; done | xargs -P 9 -I{} bash -c 'bash build_fork.sh vec1 "$1" 2>&1 | grep -E "^built|error|failed" || echo "BUILD_FAIL vec1 $1"' _ {}
n=0; for g in $HOLD; do [ -f "$OUT/libqjs_vec.futIgen_$g.so" ] && n=$((n+1)); done; echo "instrumented .so: $n / 9"; [ "$n" -eq 9 ] || { echo GEN_BUILD_INCOMPLETE; exit 1; }
unset TUNE PROFDIR TAG
for g in $HOLD; do
  PD=$OUT/prof_hold_$g; rm -rf "$PD"; mkdir -p "$PD"
  t0=$(date +%s)
  LLVM_PROFILE_FILE="$PD/vfut-$g-%m-%p.profraw" QJS_DIRTY=1 "$PY" vec_prof_driver.py "$OUT/libqjs_vec.futIgen_$g.so" "$GDIR/$g.js" 30 || { echo "PROF_FAIL $g"; continue; }
  llvm-profdata merge -o "$OUT/hold_$g.profdata" "$OUT/forkI24.profdata" "$PD"/*.profraw || { echo "MERGE_FAIL $g"; continue; }
  rm -rf "$OUT/picIT3h_$g"
  ( export TUNE=use PROFDATA=$OUT/hold_$g.profdata TAG=IT3h_$g RA=$RA_PGO; bash build_fork.sh vec1 "$GDIR/$g.js" 2>&1 | grep -E "^built|error|failed" ) || echo "BUILD_FAIL tier3 $g"
  echo "tier3 $g: $(( $(date +%s) - t0 )) s (profile + merge + engine rebuild + link)"
done
n=0; for g in $HOLD; do [ -f "$OUT/libqjs_vec.futIT3h_${g}_$g.so" ] && n=$((n+1)); done; echo "tier-3 .so: $n / 9"

echo "== 3. exactness: vec obs checksum 2000 x 9: ng vs tier2 vs tier3 =="
QJS_DIRTY=1 WE=$WE GDIR=$GDIR "$PY" aot_obs_checksum.py 2000 "$(echo $HOLD | tr ' ' ',')" \
  ng="$NGSO" tier2="$OUT/libqjs_vec.futIT2u_{game}.so" tier3="$OUT/libqjs_vec.futIT3h_{game}_{game}.so" 2>&1 | tee "$OUTD/checksum9.txt" | grep -E "MISMATCH|MISSING|CHECKSUM|FAIL"

bench() {  # game arm libpath rep
  local g=$1 a=$2 lib=$3 r=$4
  [ -f "$lib" ] || { echo "SKIP $g $a (no lib)"; return; }
  echo "=== $g rep$r $a $(md5sum "$lib" | cut -c1-32)"
  QJS_DIRTY=1 "$PY" "$TR/benchmarks/bench_vec_knobs.py" --game "$g" --games-dir "$GDIR" \
    --lib-path "$lib" --mode sync --envs 128 --workers 1 --env-threads 5 \
    --steps 300 --warmup 20 --max-steps 2000 --frame-skip 1 \
    --out "$OUTD/${g}_${a}_r${r}.json" 2>&1 | grep -o '"env_steps_per_s": [0-9]*' || echo "RUN_FAIL $g $a rep$r"
}
echo "== 4. vec A/B: 9 games x 3 reps interleaved adv / tier2 / tier3 (1 worker x 128 x 5) =="
for r in 1 2 3; do for g in $HOLD; do
  bench "$g" adv   "$OUT/libqjs_vec.adv.so" $r
  bench "$g" tier2 "$OUT/libqjs_vec.futIT2u_$g.so" $r
  bench "$g" tier3 "$OUT/libqjs_vec.futIT3h_${g}_$g.so" $r
done; done
echo "== summary =="
"$PY" - "$OUTD" <<'PYEOF'
import json, sys, glob, os, collections, statistics, math
gm = lambda xs: math.exp(sum(map(math.log, xs)) / len(xs)) if xs else float("nan")
d = collections.defaultdict(list)
for f in glob.glob(sys.argv[1] + "/*.json"):
    g, a, r = os.path.basename(f)[:-5].rsplit("_", 2); d[(g, a)].append(json.load(open(f))["env_steps_per_s"])
arms = ["adv", "tier2", "tier3"]; ratios = [("tier2", "adv"), ("tier3", "adv"), ("tier3", "tier2")]
print("\nHOLDOUT 9 (1 worker x 128 x 5, env steps/s, medians of 3)")
print("%-18s" % "game" + "".join("%10s" % a for a in arms) + "".join("%12s" % (n + "/" + dn) for n, dn in ratios))
R = collections.defaultdict(list)
for g in sorted({g for g, _ in d}):
    m = {a: statistics.median(d[(g, a)]) for a in arms if (g, a) in d}
    row = "%-18s" % g + "".join("%10.0f" % m.get(a, float("nan")) for a in arms)
    for n, dn in ratios:
        if n in m and dn in m: v = m[n] / m[dn]; R[(n, dn)].append(v); row += "%12.3f" % v
        else: row += "%12s" % "-"
    print(row)
print("%-18s" % ("geomean-%d" % max(len(v) for v in R.values())) + " " * 30 + "".join("%12.3f" % gm(R[k]) for k in ratios))
PYEOF
echo "== done $(date) =="
