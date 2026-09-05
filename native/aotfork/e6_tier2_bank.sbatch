#!/bin/bash -l
#SBATCH -J e6_tier2_bank
#SBATCH -o logs/%x_%j.out
#SBATCH -e logs/%x_%j.err
#SBATCH -p serial_requeue
#SBATCH -C genoa
#SBATCH --exclusive
#SBATCH -N 1
#SBATCH --mem=128G
#SBATCH -t 0-06:00
# E6.2 step 2/2 — TIER-2 BANKED arm (HANDOFF-2026-09-04-round6-E3-adoption.md §6.1),
# same protocol as e3_bank: 16 workers x 128 envs x 5 env threads (--exclusive), all 24
# games, 300-step window, 3 interleaved trials, QJS_DIRTY=1.
# Arms: adv (adopted ng .so) | futIT2u (tier 2: PGO engine, unprofiled game unit)
#       | futIT2 (tier 3: fully profiled, banked 1.500x over adv in job 44482682)
# Panel C single-core ProcGen16: qjs_host.adv vs host_f1IT2u_<g> vs host_f1IT2_<g>.
# Requires e6_tier2_build artifacts (gated + checksummed there).
set -uo pipefail
cd "${SLURM_SUBMIT_DIR:-.}"; mkdir -p logs
BASE=/n/holylabs/gershman_lab/Users/rtruong
WE=$BASE/playtrain-wt-engine; LIVE=$BASE/playtrain; TR=$BASE/playtrain-trainers
PY=$BASE/analogen-jaxbench/.venv/bin/python
export PATH="$HOME/.cargo/bin:$PATH" PYTHONPATH="$TR/src:$WE/src" OMP_NUM_THREADS=1
echo "node=$(hostname) kernel=$(uname -r) job=${SLURM_JOB_ID:-none}"; lscpu | grep -E "Model name|^CPU\(s\)" | head -2
cd "$WE" || exit 1; git log --oneline -1
OUT=$WE/native/aotfork/out; GDIR=$LIVE/examples/games/js
PROCGEN="bigfish bossfight caveflyer chaser climber coinrun dodgeball fruitbot heist jumper leaper maze miner ninja plunder starpilot"
ALE="asteroids breakout freeway frostbite pong qbert seaquest space_invaders"
JOB="${SLURM_JOB_ID:-x}"; OUTD="$OUT/e6bank_$JOB"; mkdir -p "$OUTD"
for f in "$OUT/libqjs_vec.adv.so" "$OUT/qjs_host.adv"; do [ -e "$f" ] || { echo "missing $f"; exit 1; }; done
for g in $PROCGEN $ALE; do [ -f "$OUT/libqjs_vec.futIT2u_$g.so" ] && [ -f "$OUT/libqjs_vec.futIT2_$g.so" ] || { echo "MISSING futIT2u/futIT2 $g"; exit 1; }; done
for g in $PROCGEN; do [ -x "$OUT/host_f1IT2u_$g" ] && [ -x "$OUT/host_f1IT2_$g" ] || { echo "MISSING host_f1IT2u/f1IT2 $g"; exit 1; }; done
echo "md5 adv    $(md5sum "$OUT/libqjs_vec.adv.so" | cut -c1-32) (expect 1c5149364c32fb58ce9b81cda49fa763)"
echo "md5 futIT2_miner  $(md5sum "$OUT/libqjs_vec.futIT2_miner.so" | cut -c1-32) (expect e9ce216e…)"
echo "md5 futIT2u_miner $(md5sum "$OUT/libqjs_vec.futIT2u_miner.so" | cut -c1-32)"
echo "md5 host.adv $(md5sum "$OUT/qjs_host.adv" | cut -c1-32) (expect 5dcce14f4dfddc59a6b0f4e33d8a3127)"

cd native/aotfork

bench() {  # game arm libpath trial
  local g=$1 a=$2 lib=$3 r=$4
  echo "=== $g t$r $a $(md5sum "$lib" | cut -c1-32)"
  QJS_DIRTY=1 "$PY" "$TR/benchmarks/bench_vec_knobs.py" --game "$g" --games-dir "$GDIR" \
    --lib-path "$lib" --mode sync --envs 128 --workers 16 --env-threads 5 \
    --steps 300 --warmup 20 --max-steps 2000 --frame-skip 1 \
    --out "$OUTD/${g}_${a}_r${r}.json" 2>&1 | grep -o '"env_steps_per_s": [0-9]*' || echo "RUN_FAIL $g $a t$r"
}
echo "== BANKED: 24 games x 3 trials, interleaved adv, futIT2u, futIT2 (16 workers x 128 x 5) =="
for g in $PROCGEN $ALE; do for r in 1 2 3; do
  bench "$g" adv     "$OUT/libqjs_vec.adv.so" $r
  bench "$g" futIT2u "$OUT/libqjs_vec.futIT2u_$g.so" $r
  bench "$g" futIT2  "$OUT/libqjs_vec.futIT2_$g.so" $r
done; done

echo "== PANEL C: single-core, 16 ProcGen, QJS_DIRTY=1 bench 0 100000, 3 interleaved reps =="
RAW=$OUTD/panelc_raw.txt; : > "$RAW"
for g in $PROCGEN; do for r in 1 2 3; do
  for kv in "adv=$OUT/qjs_host.adv" "f1IT2u=$OUT/host_f1IT2u_$g" "f1IT2=$OUT/host_f1IT2_$g"; do
    n=${kv%%=*}; b=${kv#*=}
    sps=$(QJS_DIRTY=1 "$b" "$GDIR/$g.js" bench 0 100000 2>/dev/null | sed -n 's/.*= \([0-9.]*\) steps\/sec/\1/p')
    echo "$n $g $r $sps" | tee -a "$RAW"
  done
done; done

echo "== summary =="
"$PY" - "$OUTD" <<'PYEOF'
import json, sys, glob, os, collections, statistics, math
gm = lambda xs: math.exp(sum(map(math.log, xs)) / len(xs)) if xs else float("nan")
PG = "bigfish bossfight caveflyer chaser climber coinrun dodgeball fruitbot heist jumper leaper maze miner ninja plunder starpilot".split()
def table(d, arms, ratios, title):
    print("\n" + title)
    games = sorted({g for g, _ in d}, key=lambda g: (g not in PG, g))
    print("%-14s" % "game" + "".join("%10s" % a for a in arms) + "".join("%14s" % (n + "/" + dn) for n, dn in ratios))
    R = collections.defaultdict(list)
    for g in games:
        m = {a: statistics.median(d[(g, a)]) for a in arms if (g, a) in d}
        row = "%-14s" % g + "".join("%10.0f" % m.get(a, float("nan")) for a in arms)
        for n, dn in ratios:
            if n in m and dn in m:
                v = m[n] / m[dn]; R[(n, dn, g in PG)].append(v); row += "%14.3f" % v
            else: row += "%14s" % "-"
        print(row)
    for label, sel in (("geomean-PG16", [True]), ("geomean-ALE8", [False]), ("geomean-24", [True, False])):
        vals = [gm(sum((R[(n, dn, s)] for s in sel), [])) for n, dn in ratios]
        print("%-14s" % label + " " * (10 * len(arms)) + "".join("%14.3f" % v for v in vals))
    for a in arms:
        tot = sum(statistics.median(d[(g, a)]) for g in games if (g, a) in d)
        print("sum-of-medians %-8s %12.0f" % (a, tot))
d = collections.defaultdict(list)
for f in glob.glob(sys.argv[1] + "/*.json"):
    g, a, r = os.path.basename(f)[:-5].rsplit("_", 2); d[(g, a)].append(json.load(open(f))["env_steps_per_s"])
table(d, ["adv", "futIT2u", "futIT2"], [("futIT2u", "adv"), ("futIT2", "adv"), ("futIT2u", "futIT2")], "BANKED VEC 16x128x5 (env steps/s, medians of 3)")
d2 = collections.defaultdict(list)
for line in open(sys.argv[1] + "/panelc_raw.txt"):
    p = line.split()
    if len(p) == 4 and p[3]: d2[(p[1], p[0])].append(float(p[3]))
table(d2, ["adv", "f1IT2u", "f1IT2"], [("f1IT2u", "adv"), ("f1IT2", "adv"), ("f1IT2u", "f1IT2")], "PANEL C single-core ProcGen16 (steps/s, medians of 3)")
PYEOF
echo "== done $(date) =="
