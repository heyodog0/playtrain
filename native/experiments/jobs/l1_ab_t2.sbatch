#!/bin/bash -l
#SBATCH -J l1_ab_t2
#SBATCH -o logs/%x_%j.out
#SBATCH -e logs/%x_%j.err
#SBATCH -p serial_requeue
#SBATCH -C genoa
#SBATCH --exclusive
#SBATCH -N 1
#SBATCH --mem=64G
#SBATCH -t 0-02:30
# A/B-ONLY re-run of l1_tune24 steps 5-6 (job 44430166 was preempted after its
# builds/gate/checksum had completed; a restart would rebuild the T2 .so files
# while l1_bank loads them). Reads artifacts only; builds nothing.
# L1 tuned-vs-tuned, SECOND cut: profile ALL 24 games (job 44425939 profiled 8;
# the 16 unprofiled AOT TUs lost 2-8% to the PGO inliner). Otherwise identical.
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
PROF8="$PROCGEN $ALE"     # ALL 24: an AOT TU with no profile is de-optimized by the PGO inliner (unprofiled call sites = cold); job 44425939 showed futT<fut on every unprofiled game
JOB="${SLURM_JOB_ID:-x}"; OUTD="$OUT/abT2_$JOB"; mkdir -p "$OUTD"
RA_PLAIN=$WE/crates/rasterizer/target/release/libplaytrain_rasterizer.a
RA_PGO=$OUT/libplaytrain_rasterizer.a.rustpgo_adv
cp "$WT/crates/rasterizer/target/release/libplaytrain_rasterizer.a.rustpgo_adv" "$RA_PGO"   # read-only copy; rust sources identical (diff -rq)
NGSO=$WE/native/build/libqjs_vec.so; NGHOST=$WE/native/build/qjs_host
for f in "$RA_PLAIN" "$NGSO" "$NGHOST" "$OUT/qjsc" "$OUT/libqjs_vec.adv.so" "$OUT/qjs_host.adv" "$OUT/libqjs_vec.fork.so" "$OUT/host_f0"; do [ -e "$f" ] || { echo "missing $f — run l1_fork/l1_vec_ab first"; exit 1; }; done
cd native/aotfork
for g in $PROCGEN $ALE; do [ -f "$OUT/libqjs_vec.futT2_$g.so" ] || { echo "missing futT2 $g"; exit 1; }; done
for g in $FIVE; do [ -x "$OUT/host_f1T2_$g" ] || { echo "missing host_f1T2_$g"; exit 1; }; done

bench() {  # game arm libpath rep
  local g=$1 a=$2 lib=$3 r=$4
  echo "=== $g rep$r $a $(md5sum "$lib" | cut -c1-32)"
  QJS_DIRTY=1 "$PY" "$TR/benchmarks/bench_vec_knobs.py" --game "$g" --games-dir "$GDIR" \
    --lib-path "$lib" --mode sync --envs 128 --workers 1 --env-threads 5 \
    --steps 300 --warmup 20 --max-steps 2000 --frame-skip 1 \
    --out "$OUTD/${g}_${a}_r${r}.json" 2>&1 | grep -o '"env_steps_per_s": [0-9]*' || echo "RUN_FAIL $g $a r$r"
}
arms() { echo "adv=$OUT/libqjs_vec.adv.so fut=$OUT/libqjs_vec.fut_$1.so futT=$OUT/libqjs_vec.futT_$1.so forkT2=$OUT/libqjs_vec.forkT2.so futT2=$OUT/libqjs_vec.futT2_$1.so"; }
echo "== 5. vec A/B: 5 games x 2 reps interleaved, then all-24 x 1 =="
for g in $FIVE; do for r in 1 2; do for kv in $(arms $g); do bench "$g" "${kv%%=*}" "${kv#*=}" $r; done; done; done
for g in $PROCGEN $ALE; do case " $FIVE " in *" $g "*) continue;; esac; for kv in $(arms $g); do bench "$g" "${kv%%=*}" "${kv#*=}" 1; done; done
echo "== 6. single-core: adv f0 f1 f0T f1T, 5 games x 5 reps x 50k, QJS_DIRTY=1 =="
RAW=$OUTD/sc_raw.txt; : > "$RAW"
for g in $FIVE; do for r in 1 2 3 4 5; do
  for kv in "f1=$OUT/host_f1_$g" "f1T=$OUT/host_f1T_$g" "f0T2=$OUT/host_f0T2" "f1T2=$OUT/host_f1T2_$g" "adv=$OUT/qjs_host.adv"; do
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
table(d, ["adv", "fut", "futT", "forkT2", "futT2"], [("futT2", "forkT2"), ("futT2", "futT"), ("futT2", "fut"), ("futT2", "adv"), ("forkT2", "adv")], "VEC (env steps/s, medians)")
d2 = collections.defaultdict(list)
for line in open(sys.argv[1] + "/sc_raw.txt"):
    p = line.split()
    if len(p) == 4 and p[3]: d2[(p[1], p[0])].append(float(p[3]))
table(d2, ["adv", "f1", "f1T", "f0T2", "f1T2"], [("f1T2", "f0T2"), ("f1T2", "f1T"), ("f1T2", "f1"), ("f1T2", "adv"), ("f0T2", "adv")], "SINGLE-CORE (qjs_host bench steps/s, medians of 5)")
EOF
echo "== done $(date) =="
