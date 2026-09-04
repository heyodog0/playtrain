#!/bin/bash -l
#SBATCH -J l1_tune
#SBATCH -o logs/%x_%j.out
#SBATCH -e logs/%x_%j.err
#SBATCH -p serial_requeue
#SBATCH -C genoa
#SBATCH --exclusive
#SBATCH -N 1
#SBATCH --mem=64G
#SBATCH -t 0-05:00
# L1, tuned-vs-tuned (PLAN-engine-tier.md §2 rule 2: every engine change
# re-collects PGO). Mirrors the adopted recipe (adopt_build.sbatch /
# build_qjs_vec_tune.sh): instrumented build -> vec profile on the 8 profile
# games x 30 s -> ONE merged .profdata -> -fprofile-use + thin-LTO + hidden vis
# + version script, with the Rust-PGO'd rasterizer .a adv uses.
# ONE merged profile for every object in a link is mandatory: ThinLTO rejects
# objects built against different .profdata ("ProfileSummary IDs conflict").
# Arms (vec, --lib-path, interleaved): adv | fork | fut | forkT | futT
# Arms (single-core qjs_host bench):    adv | f0 | f1 | f0T | f1T
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
PROF8="breakout miner bigfish plunder maze chaser dodgeball coinrun"     # same 8 as adopt_build
JOB="${SLURM_JOB_ID:-x}"; OUTD="$OUT/tune_$JOB"; mkdir -p "$OUTD"
RA_PLAIN=$WE/crates/rasterizer/target/release/libplaytrain_rasterizer.a
RA_PGO=$OUT/libplaytrain_rasterizer.a.rustpgo_adv
cp "$WT/crates/rasterizer/target/release/libplaytrain_rasterizer.a.rustpgo_adv" "$RA_PGO"   # read-only copy; rust sources identical (diff -rq)
NGSO=$WE/native/build/libqjs_vec.so; NGHOST=$WE/native/build/qjs_host
for f in "$RA_PLAIN" "$NGSO" "$NGHOST" "$OUT/qjsc" "$OUT/libqjs_vec.adv.so" "$OUT/qjs_host.adv" "$OUT/libqjs_vec.fork.so" "$OUT/host_f0"; do [ -e "$f" ] || { echo "missing $f — run l1_fork/l1_vec_ab first"; exit 1; }; done
cd native/aotfork; export FORK_OUT=$OUT

echo "== 1. instrumented builds (TAG=gen) =="
PROFDIR=$OUT/prof_raw; rm -rf "$PROFDIR"; mkdir -p "$PROFDIR"
export TUNE=gen PROFDIR TAG=gen RA=$RA_PLAIN
bash build_fork.sh engine 2>&1 | tail -1
bash build_fork.sh f0 2>&1 | tail -1
bash build_fork.sh vec0 2>&1 | tail -1
for g in $PROF8; do echo "$GDIR/$g.js"; done | xargs -P 8 -I{} bash -c 'bash build_fork.sh vec1 "$1" 2>&1 | grep "^built"' _ {}
for g in $FIVE; do echo "$GDIR/$g.js"; done | xargs -P 5 -I{} bash -c 'bash build_fork.sh f1 "$1" 2>&1 | grep "^built"' _ {}

echo "== 2. profiles: vec workload 30 s per game (fork + fut), single-core 10 s (f0 + f1) =="
for g in $PROF8; do
  LLVM_PROFILE_FILE="$PROFDIR/vfork-$g-%m-%p.profraw" QJS_DIRTY=1 "$PY" vec_prof_driver.py "$OUT/libqjs_vec.forkgen.so" "$GDIR/$g.js" 30 || echo "PROF_FAIL fork $g"
  LLVM_PROFILE_FILE="$PROFDIR/vfut-$g-%m-%p.profraw"  QJS_DIRTY=1 "$PY" vec_prof_driver.py "$OUT/libqjs_vec.futgen_$g.so" "$GDIR/$g.js" 30 || echo "PROF_FAIL fut $g"
done
for g in $FIVE; do
  LLVM_PROFILE_FILE="$PROFDIR/hf0-$g-%m-%p.profraw" QJS_DIRTY=1 "$OUT/host_f0gen" "$GDIR/$g.js" bench 1 100000 >/dev/null 2>&1
  LLVM_PROFILE_FILE="$PROFDIR/hf1-$g-%m-%p.profraw" QJS_DIRTY=1 "$OUT/host_f1gen_$g" "$GDIR/$g.js" bench 1 100000 >/dev/null 2>&1
done
n=$(ls "$PROFDIR"/*.profraw 2>/dev/null | wc -l); echo "profraws: $n"; [ "$n" -gt 0 ] || { echo NO_PROFILES; exit 1; }
llvm-profdata merge -o "$OUT/fork.profdata" "$PROFDIR"/*.profraw && ls -la "$OUT/fork.profdata"

echo "== 3. tuned builds (TAG=T): PGO-use + thin-LTO + hidden vis, Rust-PGO rasterizer =="
export TUNE=use PROFDATA=$OUT/fork.profdata TAG=T RA=$RA_PGO; unset PROFDIR
rm -rf "$OUT/objT" "$OUT/picT"
bash build_fork.sh engine 2>&1 | tail -1
bash build_fork.sh f0 2>&1 | tail -1
bash build_fork.sh vec0 2>&1 | tail -1
for g in $PROCGEN $ALE; do echo "$GDIR/$g.js"; done | xargs -P 12 -I{} bash -c 'bash build_fork.sh vec1 "$1" 2>&1 | grep "^built"' _ {}
for g in $FIVE; do echo "$GDIR/$g.js"; done | xargs -P 5 -I{} bash -c 'bash build_fork.sh f1 "$1" 2>&1 | grep "^built"' _ {}
echo "futT .so built: $(ls "$OUT"/libqjs_vec.futT_*.so | wc -l) / 24"
for f in libqjs_vec.forkT.so libqjs_vec.futT_miner.so host_f0T host_f1T_miner; do echo "md5 $f $(md5sum "$OUT/$f" | cut -c1-32)"; done
unset TUNE PROFDATA TAG

echo "== 4. gate: f0T/f1T on the 33 paper games x 3 seeds (vs V8 reference) =="
# gate_fork.sh looks for host_f0 / host_f1_<g>; point it at the T binaries via a shim dir
GT=$OUT/gateT; mkdir -p "$GT"; ln -sf "$OUT/host_f0T" "$GT/host_f0"
for g in $FIVE; do ln -sf "$OUT/host_f1T_$g" "$GT/host_f1_$g"; done
REFDIR=$OUT/gate_ref GAMES_DIR=$WE/examples/games/js bash gate_fork.sh "$GT" --all 3000 2>&1 | tee "$OUTD/gateT.txt" | grep -v "^  PASS"
echo "== 4b. vec obs checksum 2000 x 24: ng (reference) vs forkT vs futT =="
QJS_DIRTY=1 WE=$WE GDIR=$GDIR "$PY" aot_obs_checksum.py 2000 "$(echo $PROCGEN $ALE | tr ' ' ',')" \
  ng="$NGSO" forkT="$OUT/libqjs_vec.forkT.so" futT="$OUT/libqjs_vec.futT_{game}.so" 2>&1 | tee "$OUTD/checksumT.txt" | grep -E "MISMATCH|MISSING|CHECKSUM"

bench() {  # game arm libpath rep
  local g=$1 a=$2 lib=$3 r=$4
  echo "=== $g rep$r $a $(md5sum "$lib" | cut -c1-32)"
  QJS_DIRTY=1 "$PY" "$TR/benchmarks/bench_vec_knobs.py" --game "$g" --games-dir "$GDIR" \
    --lib-path "$lib" --mode sync --envs 128 --workers 1 --env-threads 5 \
    --steps 300 --warmup 20 --max-steps 2000 --frame-skip 1 \
    --out "$OUTD/${g}_${a}_r${r}.json" 2>&1 | grep -o '"env_steps_per_s": [0-9]*' || echo "RUN_FAIL $g $a r$r"
}
arms() { echo "adv=$OUT/libqjs_vec.adv.so fork=$OUT/libqjs_vec.fork.so fut=$OUT/libqjs_vec.fut_$1.so forkT=$OUT/libqjs_vec.forkT.so futT=$OUT/libqjs_vec.futT_$1.so"; }
echo "== 5. vec A/B: 5 games x 2 reps interleaved, then all-24 x 1 =="
for g in $FIVE; do for r in 1 2; do for kv in $(arms $g); do bench "$g" "${kv%%=*}" "${kv#*=}" $r; done; done; done
for g in $PROCGEN $ALE; do case " $FIVE " in *" $g "*) continue;; esac; for kv in $(arms $g); do bench "$g" "${kv%%=*}" "${kv#*=}" 1; done; done
echo "== 6. single-core: adv f0 f1 f0T f1T, 5 games x 5 reps x 50k, QJS_DIRTY=1 =="
RAW=$OUTD/sc_raw.txt; : > "$RAW"
for g in $FIVE; do for r in 1 2 3 4 5; do
  for kv in "f0=$OUT/host_f0" "f1=$OUT/host_f1_$g" "f0T=$OUT/host_f0T" "f1T=$OUT/host_f1T_$g" "adv=$OUT/qjs_host.adv"; do
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
table(d, ["adv", "fork", "fut", "forkT", "futT"], [("futT", "forkT"), ("forkT", "fork"), ("futT", "fut"), ("futT", "adv"), ("forkT", "adv")], "VEC (env steps/s, medians)")
d2 = collections.defaultdict(list)
for line in open(sys.argv[1] + "/sc_raw.txt"):
    p = line.split()
    if len(p) == 4 and p[3]: d2[(p[1], p[0])].append(float(p[3]))
table(d2, ["adv", "f0", "f1", "f0T", "f1T"], [("f1T", "f0T"), ("f0T", "f0"), ("f1T", "f1"), ("f1T", "adv"), ("f0T", "adv")], "SINGLE-CORE (qjs_host bench steps/s, medians of 5)")
EOF
echo "== done $(date) =="
