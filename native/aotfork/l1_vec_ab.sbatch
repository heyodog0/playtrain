#!/bin/bash -l
#SBATCH -J l1_vec_ab
#SBATCH -o logs/%x_%j.out
#SBATCH -e logs/%x_%j.err
#SBATCH -p serial_requeue
#SBATCH -C genoa
#SBATCH --exclusive
#SBATCH -N 1
#SBATCH --mem=64G
#SBATCH -t 0-04:00
# L1 step 6 (PLAN-engine-tier.md §4 iteration protocol) on the VEC host — the
# Fig-4A / trainer path. Arms, all loaded by explicit --lib-path (no .so swap):
#   adv  = adopted tuned ng .so (variants/libqjs_vec.adv.so, md5 b3709b39…; PGO/LTO)
#   ng   = stock quickjs-ng .so built here by build_qjs_vec.sh (-O3 v3, no PGO)
#   fork = fork interpreter vec host (libqjs_vec.fork.so)            [F0]
#   fut  = fork + qjsc -A per game (libqjs_vec.fut_<game>.so)        [F1]
# fut/fork is the AOT effect; fork/ng the engine swap; fut/adv is what a paper
# reader would see (tuned-vs-untuned confound: fork arms have NO PGO yet).
# Protocol: 1 worker, 128 envs, 5 env threads, 300 steps, 20 warmup, max 2000,
# frame-skip 1, QJS_DIRTY=1 on every arm, interleaved A,B,C,D x 2 reps, same node.
# Proceed threshold (plan §4): fut/fork >= +5% geomean on the 5 profiled games.
set -uo pipefail
cd "${SLURM_SUBMIT_DIR:-.}"; mkdir -p logs
BASE=/n/holylabs/gershman_lab/Users/rtruong
WE=$BASE/playtrain-wt-engine; WT=$BASE/playtrain-wt-tuning; LIVE=$BASE/playtrain
TR=$BASE/playtrain-trainers
PY=$BASE/analogen-jaxbench/.venv/bin/python
export PATH="$HOME/.cargo/bin:$PATH"
export PYTHONPATH="$TR/src:$WE/src" OMP_NUM_THREADS=1
echo "node=$(hostname) kernel=$(uname -r) job=${SLURM_JOB_ID:-none}"
lscpu | grep -E "Model name" | head -1
cd "$WE" || exit 1; git log --oneline -1
OUT=$WE/native/aotfork/out; mkdir -p "$OUT"
GDIR=$LIVE/examples/games/js
PROCGEN="bigfish bossfight caveflyer chaser climber coinrun dodgeball fruitbot heist jumper leaper maze miner ninja plunder starpilot"
ALE="asteroids breakout freeway frostbite pong qbert seaquest space_invaders"
FIVE="breakout plunder bigfish miner maze"
JOB="${SLURM_JOB_ID:-x}"; OUTD="$OUT/vec_ab_$JOB"; mkdir -p "$OUTD"

[ -d native/qjs/src ]    || cp -r "$WT/native/qjs/src" native/qjs/src
[ -d native/frozenmath ] || cp -r "$WT/native/frozenmath" native/frozenmath
[ -d "$OUT/src/.git" ]   || { git clone -q https://github.com/ivankra/quickjs "$OUT/src" && git -C "$OUT/src" checkout -q cee72b9c99fac98426a3bbb4fbfa493b7e5619f2; }
RA=$WE/crates/rasterizer/target/release/libplaytrain_rasterizer.a
[ -f "$RA" ] || ( cd crates/rasterizer && RUSTFLAGS="-C target-cpu=x86-64-v3" cargo rustc --release --lib --crate-type staticlib 2>&1 | tail -1 )

echo "== ng control .so (stock quickjs-ng, -O3 v3, engine worktree build/) =="
( cd native && [ -f qjs/bld/libqjs.a ] || bash build_qjs.sh 2>&1 | tail -1; bash build_qjs_vec.sh 2>&1 | tail -1 )
NGSO=$WE/native/build/libqjs_vec.so
cp "$WT/native/build/variants/libqjs_vec.adv.so" "$OUT/libqjs_vec.adv.so"
echo "md5 adv  $(md5sum "$OUT/libqjs_vec.adv.so" | cut -c1-32) (expect b3709b3980193d0890856dedc923e923)"
echo "md5 ng   $(md5sum "$NGSO" | cut -c1-32)"

echo "== fork vec .so: F0 + F1 for ProcGen16 + ALE8 =="
cd native/aotfork; export RA FORK_OUT=$OUT
[ -x "$OUT/qjsc" ] || bash build_fork.sh engine 2>&1 | tail -1
bash build_fork.sh vec0 2>&1 | tail -1
for g in $PROCGEN $ALE; do echo "$GDIR/$g.js"; done | xargs -P 12 -I{} bash -c 'bash build_fork.sh vec1 "$1" 2>&1 | grep "^built"' _ {}
echo "fut .so built: $(ls "$OUT"/libqjs_vec.fut_*.so | wc -l) / 24"
echo "md5 fork $(md5sum "$OUT/libqjs_vec.fork.so" | cut -c1-32)"

echo "== obs checksum, 2000 steps, all 24 games: adv (reference) vs ng vs fork vs fut =="
QJS_DIRTY=1 WE=$WE GDIR=$GDIR "$PY" aot_obs_checksum.py 2000 "$(echo $PROCGEN $ALE | tr ' ' ',')" \
  adv="$OUT/libqjs_vec.adv.so" ng="$NGSO" fork="$OUT/libqjs_vec.fork.so" fut="$OUT/libqjs_vec.fut_{game}.so" \
  2>&1 | tee "$OUTD/checksum24.txt" | grep -E "MISMATCH|MISSING|CHECKSUM"

bench() {  # game arm libpath rep
  local g=$1 a=$2 lib=$3 r=$4
  echo "=== $g rep$r $a $(md5sum "$lib" | cut -c1-32)"
  QJS_DIRTY=1 "$PY" "$TR/benchmarks/bench_vec_knobs.py" --game "$g" --games-dir "$GDIR" \
    --lib-path "$lib" --mode sync --envs 128 --workers 1 --env-threads 5 \
    --steps 300 --warmup 20 --max-steps 2000 --frame-skip 1 \
    --out "$OUTD/${g}_${a}_r${r}.json" 2>&1 | grep -o '"env_steps_per_s": [0-9]*' || echo "RUN_FAIL $g $a r$r"
}
echo "== A/B: 5 profiled games x 2 reps, interleaved adv,ng,fork,fut =="
for g in $FIVE; do for r in 1 2; do
  bench "$g" adv  "$OUT/libqjs_vec.adv.so" $r
  bench "$g" ng   "$NGSO" $r
  bench "$g" fork "$OUT/libqjs_vec.fork.so" $r
  bench "$g" fut  "$OUT/libqjs_vec.fut_$g.so" $r
done; done
echo "== all-24 x 1 rep, interleaved (information only) =="
for g in $PROCGEN $ALE; do case " $FIVE " in *" $g "*) continue;; esac
  bench "$g" adv  "$OUT/libqjs_vec.adv.so" 1
  bench "$g" ng   "$NGSO" 1
  bench "$g" fork "$OUT/libqjs_vec.fork.so" 1
  bench "$g" fut  "$OUT/libqjs_vec.fut_$g.so" 1
done
echo "== summary =="
"$PY" - "$OUTD" <<'EOF'
import json, sys, glob, os, collections, statistics, math
d = collections.defaultdict(list)
for f in glob.glob(sys.argv[1] + "/*.json"):
    g, a, r = os.path.basename(f)[:-5].rsplit("_", 2)
    d[(g, a)].append(json.load(open(f))["env_steps_per_s"])
arms = ["adv", "ng", "fork", "fut"]
games = sorted({g for g, _ in d}, key=lambda g: (g not in "breakout plunder bigfish miner maze".split(), g))
print("%-14s" % "game" + "".join("%9s" % a for a in arms) + "%10s%10s%10s" % ("fut/fork", "fork/ng", "fut/adv"))
R = collections.defaultdict(list)
for g in games:
    m = {a: statistics.median(d[(g, a)]) for a in arms if (g, a) in d}
    row = "%-14s" % g + "".join("%9.0f" % m.get(a, float("nan")) for a in arms)
    for num, den in (("fut", "fork"), ("fork", "ng"), ("fut", "adv")):
        if num in m and den in m:
            v = m[num] / m[den]; R[(num, den, g in "breakout plunder bigfish miner maze".split())].append(v); row += "%10.3f" % v
        else: row += "%10s" % "-"
    print(row)
gm = lambda xs: math.exp(sum(map(math.log, xs)) / len(xs)) if xs else float("nan")
for five in (True, False):
    vals = [gm(R[(n, dn, five)] + ([] if five else R[(n, dn, True)])) for n, dn in (("fut", "fork"), ("fork", "ng"), ("fut", "adv"))]
    print("%-14s" % ("geomean-5" if five else "geomean-24") + " " * 36 + "".join("%10.3f" % v for v in vals))
EOF
echo "== done $(date) =="
