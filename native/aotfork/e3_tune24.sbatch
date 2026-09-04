#!/bin/bash -l
#SBATCH -J e3_tune24
#SBATCH -o logs/%x_%j.out
#SBATCH -e logs/%x_%j.err
#SBATCH -p serial_requeue
#SBATCH -C genoa
#SBATCH -N 1
#SBATCH -c 32
#SBATCH --mem=64G
# Non-exclusive (no idle genoa node 2026-09-04); compensated with more reps: 3 on the five
# profiled games, 2 on the other 19, 7 single-core. Ratios are same-job, same-node, interleaved.
#SBATCH -t 0-05:00
# E3 tuned build (PLAN-engine-tier-round6.md §4: tuned build only for a lever that
# passed the untuned probe). Same recipe as l1_tune24 (instrumented build -> vec
# profile ALL 24 games x 30 s + single-core 5 -> ONE merged .profdata ->
# -fprofile-use + thin-LTO + hidden vis + Rust-PGO rasterizer), with INTR=1
# (qjsc -P aot_intr.txt) on every arm built here. Rule 2: the engine source
# changed (aot-intrinsics.patch), so the profile is re-collected, not reused.
# Arms (vec, --lib-path, interleaved): adv | futT2 (banked) | futIT2 (lever)
# Arms (single-core qjs_host bench):    adv | f1T2 | f1IT2
# Gate: f0IT2 + f1IT2 on all 33 paper games x 3 seeds; checksum24 futIT2 vs ng.
# Writes only *Igen*/*IT2*-tagged artifacts + out/forkI24.profdata + out/e3tune_<job>/.
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
PROCGEN="bigfish bossfight caveflyer chaser climber coinrun dodgeball fruitbot heist jumper leaper maze miner ninja plunder starpilot"
ALE="asteroids breakout freeway frostbite pong qbert seaquest space_invaders"
FIVE="breakout plunder bigfish miner maze"
PROF8="$PROCGEN $ALE"     # ALL 24: an AOT TU with no profile is de-optimized by the PGO inliner (unprofiled call sites = cold); job 44425939 showed futT<fut on every unprofiled game
JOB="${SLURM_JOB_ID:-x}"; OUTD="$OUT/e3tune_$JOB"; mkdir -p "$OUTD"
RA_PLAIN=$WE/crates/rasterizer/target/release/libplaytrain_rasterizer.a
RA_PGO=$OUT/libplaytrain_rasterizer.a.rustpgo_adv
cp "$WT/crates/rasterizer/target/release/libplaytrain_rasterizer.a.rustpgo_adv" "$RA_PGO"   # read-only copy; rust sources identical (diff -rq)
NGSO=$WE/native/build/libqjs_vec.so; NGHOST=$WE/native/build/qjs_host
for f in "$RA_PLAIN" "$NGSO" "$NGHOST" "$OUT/qjsc" "$OUT/libqjs_vec.adv.so" "$OUT/qjs_host.adv" "$OUT/libqjs_vec.fork.so" "$OUT/host_f0"; do [ -e "$f" ] || { echo "missing $f — run l1_fork/l1_vec_ab first"; exit 1; }; done
cd native/aotfork; export FORK_OUT=$OUT INTR=1
for g in $PROCGEN $ALE; do [ -f "$OUT/libqjs_vec.futT2_$g.so" ] && [ -f "$OUT/libqjs_vec.futI_$g.so" ] || { echo "missing futT2/futI $g"; exit 1; }; done

echo "== 1. instrumented builds (TAG=Igen, INTR=1) =="
PROFDIR=$OUT/prof_rawI24; rm -rf "$PROFDIR"; mkdir -p "$PROFDIR"
export TUNE=gen PROFDIR TAG=Igen RA=$RA_PLAIN
rm -rf "$OUT/objIgen" "$OUT/picIgen"
bash build_fork.sh engine 2>&1 | tail -1
bash build_fork.sh f0 2>&1 | tail -1
bash build_fork.sh vec0 2>&1 | tail -1
for g in $PROF8; do echo "$GDIR/$g.js"; done | xargs -P 12 -I{} bash -c 'bash build_fork.sh vec1 "$1" 2>&1 | grep -E "^built|error|failed" || echo "BUILD_FAIL vec1 $1"' _ {}
for g in $FIVE; do echo "$GDIR/$g.js"; done | xargs -P 5 -I{} bash -c 'bash build_fork.sh f1 "$1" 2>&1 | grep "^built"' _ {}

echo "== 2. profiles: vec workload 30 s per game (fork + fut), single-core 10 s (f0 + f1) =="
for g in $PROF8; do
  LLVM_PROFILE_FILE="$PROFDIR/vfork-$g-%m-%p.profraw" QJS_DIRTY=1 "$PY" vec_prof_driver.py "$OUT/libqjs_vec.forkIgen.so" "$GDIR/$g.js" 30 || echo "PROF_FAIL fork $g"
  LLVM_PROFILE_FILE="$PROFDIR/vfut-$g-%m-%p.profraw"  QJS_DIRTY=1 "$PY" vec_prof_driver.py "$OUT/libqjs_vec.futIgen_$g.so" "$GDIR/$g.js" 30 || echo "PROF_FAIL fut $g"
done
for g in $FIVE; do
  LLVM_PROFILE_FILE="$PROFDIR/hf0-$g-%m-%p.profraw" QJS_DIRTY=1 "$OUT/host_f0Igen" "$GDIR/$g.js" bench 1 100000 >/dev/null 2>&1
  LLVM_PROFILE_FILE="$PROFDIR/hf1-$g-%m-%p.profraw" QJS_DIRTY=1 "$OUT/host_f1Igen_$g" "$GDIR/$g.js" bench 1 100000 >/dev/null 2>&1
done
n=$(ls "$PROFDIR"/*.profraw 2>/dev/null | wc -l); echo "profraws: $n"; [ "$n" -gt 0 ] || { echo NO_PROFILES; exit 1; }
[ "$(ls "$OUT"/libqjs_vec.futIgen_*.so | wc -l)" -eq 24 ] || { echo "INSTRUMENTED_BUILD_INCOMPLETE ($(ls "$OUT"/libqjs_vec.futIgen_*.so | wc -l)/24)"; exit 1; }
grep -c PROF_FAIL "logs/e3_tune24_$JOB.out" >/dev/null 2>&1 && grep -q PROF_FAIL "logs/e3_tune24_$JOB.out" && { echo "PROFILE_INCOMPLETE"; exit 1; }
llvm-profdata merge -o "$OUT/forkI24.profdata" "$PROFDIR"/*.profraw && ls -la "$OUT/forkI24.profdata"

echo "== 3. tuned builds (TAG=IT2): PGO-use + thin-LTO + hidden vis, Rust-PGO rasterizer =="
export TUNE=use PROFDATA=$OUT/forkI24.profdata TAG=IT2 RA=$RA_PGO; unset PROFDIR
rm -rf "$OUT/objIT2" "$OUT/picIT2"
bash build_fork.sh engine 2>&1 | tail -1
bash build_fork.sh f0 2>&1 | tail -1
bash build_fork.sh vec0 2>&1 | tail -1
for g in $PROCGEN $ALE; do echo "$GDIR/$g.js"; done | xargs -P 12 -I{} bash -c 'bash build_fork.sh vec1 "$1" 2>&1 | grep -E "^built|error|failed" || echo "BUILD_FAIL vec1 $1"' _ {}
for f in "$WE"/examples/games/js/*.js; do echo "$f"; done | xargs -P 12 -I{} bash -c 'bash build_fork.sh f1 "$1" 2>&1 | grep "^built"' _ {}
echo "futIT2 .so built: $(ls "$OUT"/libqjs_vec.futIT2_*.so | wc -l) / 24; host_f1IT2: $(ls "$OUT"/host_f1IT2_* | wc -l) / 33"
[ "$(ls "$OUT"/libqjs_vec.futIT2_*.so | wc -l)" -eq 24 ] || { echo TUNED_BUILD_INCOMPLETE; exit 1; }
for f in libqjs_vec.forkIT2.so libqjs_vec.futIT2_miner.so host_f0IT2 host_f1IT2_miner; do echo "md5 $f $(md5sum "$OUT/$f" | cut -c1-32)"; done
unset TUNE PROFDATA TAG

echo "== 4. gate: f0IT2 + f1IT2 on the 33 paper games x 3 seeds (vs V8 reference) =="
GT=$OUT/gateIT2; rm -rf "$GT"; mkdir -p "$GT"; ln -sf "$OUT/host_f0IT2" "$GT/host_f0"
for f in "$WE"/examples/games/js/*.js; do g=$(basename "$f" .js); [ -x "$OUT/host_f1IT2_$g" ] && ln -sf "$OUT/host_f1IT2_$g" "$GT/host_f1_$g"; done
REFDIR=$OUT/gate_ref GAMES_DIR=$WE/examples/games/js bash gate_fork.sh "$GT" --all 3000 2>&1 | tee "$OUTD/gateIT2.txt" | grep -v "^  PASS"
echo "== 4b. vec obs checksum 2000 x 24: ng (reference) vs forkIT2 vs futIT2 =="
QJS_DIRTY=1 WE=$WE GDIR=$GDIR "$PY" aot_obs_checksum.py 2000 "$(echo $PROCGEN $ALE | tr ' ' ',')" \
  ng="$NGSO" forkIT2="$OUT/libqjs_vec.forkIT2.so" futIT2="$OUT/libqjs_vec.futIT2_{game}.so" 2>&1 | tee "$OUTD/checksumIT2.txt" | grep -E "MISMATCH|MISSING|CHECKSUM"

bench() {  # game arm libpath rep
  local g=$1 a=$2 lib=$3 r=$4
  echo "=== $g rep$r $a $(md5sum "$lib" | cut -c1-32)"
  QJS_DIRTY=1 "$PY" "$TR/benchmarks/bench_vec_knobs.py" --game "$g" --games-dir "$GDIR" \
    --lib-path "$lib" --mode sync --envs 128 --workers 1 --env-threads 5 \
    --steps 300 --warmup 20 --max-steps 2000 --frame-skip 1 \
    --out "$OUTD/${g}_${a}_r${r}.json" 2>&1 | grep -o '"env_steps_per_s": [0-9]*' || echo "RUN_FAIL $g $a r$r"
}
arms() { echo "adv=$OUT/libqjs_vec.adv.so futT2=$OUT/libqjs_vec.futT2_$1.so futI=$OUT/libqjs_vec.futI_$1.so futIT2=$OUT/libqjs_vec.futIT2_$1.so"; }
echo "== 5. vec A/B: 5 games x 3 reps interleaved, then the other 19 x 2 reps =="
for g in $FIVE; do for r in 1 2 3; do for kv in $(arms $g); do bench "$g" "${kv%%=*}" "${kv#*=}" $r; done; done; done
for r in 1 2; do for g in $PROCGEN $ALE; do case " $FIVE " in *" $g "*) continue;; esac; for kv in $(arms $g); do bench "$g" "${kv%%=*}" "${kv#*=}" $r; done; done; done
echo "== 6. single-core: adv f1T2 f1I f1IT2, 5 games x 7 reps x 50k, QJS_DIRTY=1 =="
RAW=$OUTD/sc_raw.txt; : > "$RAW"
for g in $FIVE; do for r in 1 2 3 4 5 6 7; do
  for kv in "f1T2=$OUT/host_f1T2_$g" "f1I=$OUT/host_f1I_$g" "f1IT2=$OUT/host_f1IT2_$g" "adv=$OUT/qjs_host.adv"; do
    n=${kv%%=*}; b=${kv#*=}
    sps=$(QJS_DIRTY=1 "$b" "$GDIR/$g.js" bench 1 50000 2>/dev/null | sed -n 's/.*= \([0-9.]*\) steps\/sec/\1/p')
    echo "$n $g $r $sps" | tee -a "$RAW"
  done
done; done
echo "== summary =="
"$PY" - "$OUTD" <<'EOF'
import json, sys, glob, os, collections, statistics, math
gm = lambda xs: math.exp(sum(map(math.log, xs)) / len(xs)) if xs else float("nan")
FIVE = "breakout plunder bigfish miner maze".split()
def table(d, arms, ratios, title):
    print("\n" + title)
    games = sorted({g for g, _ in d}, key=lambda g: (g not in FIVE, g))
    print("%-14s" % "game" + "".join("%9s" % a for a in arms) + "".join("%11s" % (n + "/" + dn) for n, dn in ratios))
    R = collections.defaultdict(list)
    for g in games:
        m = {a: statistics.median(d[(g, a)]) for a in arms if (g, a) in d}
        row = "%-14s" % g + "".join("%9.0f" % m.get(a, float("nan")) for a in arms)
        for n, dn in ratios:
            if n in m and dn in m:
                v = m[n] / m[dn]; R[(n, dn, g in FIVE)].append(v); row += "%11.3f" % v
            else: row += "%11s" % "-"
        print(row)
    for five in (True, False):
        vals = [gm(R[(n, dn, True)] + ([] if five else R[(n, dn, False)])) for n, dn in ratios]
        print("%-14s" % ("geomean-5" if five else "geomean-all") + " " * (9 * len(arms)) + "".join("%11.3f" % v for v in vals))
d = collections.defaultdict(list)
for f in glob.glob(sys.argv[1] + "/*.json"):
    g, a, r = os.path.basename(f)[:-5].rsplit("_", 2); d[(g, a)].append(json.load(open(f))["env_steps_per_s"])
table(d, ["adv", "futT2", "futI", "futIT2"], [("futIT2", "futT2"), ("futIT2", "futI"), ("futIT2", "adv"), ("futT2", "adv")], "VEC (env steps/s, medians of 3 / 2)")
d2 = collections.defaultdict(list)
for line in open(sys.argv[1] + "/sc_raw.txt"):
    p = line.split()
    if len(p) == 4 and p[3]: d2[(p[1], p[0])].append(float(p[3]))
table(d2, ["adv", "f1T2", "f1I", "f1IT2"], [("f1IT2", "f1T2"), ("f1IT2", "f1I"), ("f1IT2", "adv")], "SINGLE-CORE (qjs_host bench steps/s, medians of 7)")
EOF
echo "== done $(date) =="
