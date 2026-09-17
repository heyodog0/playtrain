#!/bin/bash -l
#SBATCH -J tier3_fig4a
#SBATCH -o logs/%x_%j.out
#SBATCH -e logs/%x_%j.err
#SBATCH -p serial_requeue
#SBATCH -C genoa
#SBATCH --mincpus=96
#SBATCH -N 1
#SBATCH --exclusive
#SBATCH --mem=0
#SBATCH -t 0-08:00
#
# Fig 4A env-only scaling ABSOLUTES under the engine tier (HANDOFF-2026-09-05).
# Arms, both PlayTrain, both QJS_DIRTY=1, interleaved per game per trial:
#   adv2  = out/libqjs_vec.adv.so          (md5 1c5149364c32fb58ce9b81cda49fa763)
#   tier3 = out/libqjs_vec.futIT2_<game>.so (per-game, compile-at-load production path)
# Protocol identical to adv_anchor.sbatch (which produced the adv curve in
# HANDOFF-2026-09-04 §1): bench_vec_rollout.py, 128 envs/worker, 5 env-threads,
# 300 steps, max-steps 2000, frame-skip 1, --no-model --device cpu.
#   w=16 (80 env threads): 24 games x 3 trials
#   w=2/4/8 (10/20/40):    24 games x 2 trials
# NOT NODE-PINNED (Ryan 2026-09-05). Both arms are in this one job, so every
# tier3/adv2 ratio and the whole curve are same-node by construction.
# The .so is NEVER swapped in a shared tree: a job-private shadow tree in
# $TMPDIR holds native/build/libqjs_vec.so and is md5-gated before every run.
set -uo pipefail
BASE=/n/holylabs/gershman_lab/Users/rtruong
AJ=$BASE/analogen-jaxbench
TR=$BASE/playtrain-trainers
WT=$BASE/playtrain-wt-tuning
WE=$BASE/playtrain-wt-engine
LIVE=$BASE/playtrain
OUT=$WE/native/aotfork/out
PY=$AJ/.venv/bin/python
JOB="${SLURM_JOB_ID:-x}"
mkdir -p "$AJ/logs" "$AJ/outputs"
echo "node=$(hostname) job=$JOB kernel=$(uname -r)"
lscpu | grep -iE "model name|^CPU\(s\)|numa node\(s\)" | head -4

ADV2="$OUT/libqjs_vec.adv.so"
ADV2_MD5_WANT=1c5149364c32fb58ce9b81cda49fa763
[ -f "$ADV2" ] || { echo "FATAL missing $ADV2"; exit 2; }
got=$(md5sum "$ADV2" | awk '{print $1}')
[ "$got" = "$ADV2_MD5_WANT" ] || { echo "FATAL adv2 md5 $got != $ADV2_MD5_WANT"; exit 2; }
echo "adv2 md5 OK $got"

PROCGEN="bigfish bossfight caveflyer chaser climber coinrun dodgeball fruitbot heist jumper leaper maze miner ninja plunder starpilot"
ALE="asteroids breakout freeway frostbite pong qbert seaquest space_invaders"
for g in $PROCGEN $ALE; do
  [ -f "$OUT/libqjs_vec.futIT2_$g.so" ] || { echo "FATAL missing tier3 .so for $g"; exit 2; }
done
echo "tier3 .so present for all 24"

# ---- job-private shadow tree (never touch $WT/native/build) ----
SHADOW="${TMPDIR:-/tmp}/pttree_${JOB}"
rm -rf "$SHADOW"; mkdir -p "$SHADOW/native/build"
cp -a "$WT/src" "$SHADOW/src"
[ -d "$WT/runtime" ] && cp -a "$WT/runtime" "$SHADOW/runtime"
cp "$WT/pyproject.toml" "$SHADOW/pyproject.toml"
cp "$ADV2" "$SHADOW/native/build/libqjs_vec.so"
export PYTHONPATH="$TR/src:$SHADOW/src"
export OMP_NUM_THREADS=1
export QJS_DIRTY=1
export PLAYTRAIN_AOT=off          # no-op for the tuning tree; belt and braces
export SHADOW
"$PY" - <<'GATEEOF' || { echo "FATAL shadow-tree provenance check failed"; exit 2; }
import os, hashlib
from playtrain.runtime import native_vec_env as nve
p = str(nve._LIB_PATH)
assert p.startswith(os.environ["SHADOW"]), "shadow tree not selected: " + p
print("SHADOW PROVENANCE OK", p, hashlib.md5(open(p, "rb").read()).hexdigest())
GATEEOF

OUTD="$AJ/outputs/tier3_fig4a_${JOB}"; mkdir -p "$OUTD"
SO="$SHADOW/native/build/libqjs_vec.so"

run_arm () {  # $1 arm  $2 workers  $3 game  $4 outfile
  local arm=$1 w=$2 g=$3 of=$4 src want got
  case "$arm" in
    adv2)  src="$ADV2" ;;
    tier3) src="$OUT/libqjs_vec.futIT2_$g.so" ;;
    *) echo "FATAL unknown arm $arm"; exit 2 ;;
  esac
  want=$(md5sum "$src" | awk '{print $1}')
  cp "$src" "$SO"
  got=$(md5sum "$SO" | awk '{print $1}')
  [ "$got" = "$want" ] || { echo "FATAL md5 gate $g $arm: $got != $want"; exit 2; }
  echo "=== $g w$w $arm md5=$got"
  "$PY" "$TR/benchmarks/bench_vec_rollout.py" --game "$g" --games-dir "$LIVE/examples/games/js" \
    --no-model --device cpu --frame-skip 1 --steps 300 --max-steps 2000 \
    --envs 128 --workers "$w" --env-threads 5 \
    --out "$of" || echo "RUN_FAIL $g $arm w$w"
}

echo "== w=16 (80 env threads), 24 games x 3 trials, interleaved =="
for G in $PROCGEN $ALE; do for R in 1 2 3; do for V in adv2 tier3; do
  run_arm "$V" 16 "$G" "$OUTD/${G}_${V}_w16_r${R}.json"
done; done; done

echo "== w=2/4/8 (10/20/40 env threads), 24 games x 2 trials, interleaved =="
for W in 2 4 8; do for R in 1 2; do for G in $PROCGEN $ALE; do for V in adv2 tier3; do
  run_arm "$V" "$W" "$G" "$OUTD/${G}_${V}_w${W}_r${R}.json"
done; done; done; done

echo "== summary =="
"$PY" - "$OUTD" <<'PYEOF'
import json, sys, glob, os, collections, statistics, math
gm = lambda xs: math.exp(sum(map(math.log, xs)) / len(xs)) if xs else float("nan")
PG = "bigfish bossfight caveflyer chaser climber coinrun dodgeball fruitbot heist jumper leaper maze miner ninja plunder starpilot".split()
d = collections.defaultdict(list)
for f in glob.glob(sys.argv[1] + "/*.json"):
    b = os.path.basename(f)[:-5]
    g, v, w, r = b.rsplit("_", 3)
    try: d[(g, v, w)].append(json.load(open(f))["env_steps_per_s"])
    except Exception as e: print("BAD", b, e)
for w in ("w2", "w4", "w8", "w16"):
    print("\n--- %s (%s env threads) ---" % (w, int(w[1:]) * 5))
    print("%-16s%12s%12s%8s" % ("game", "adv2", "tier3", "ratio"))
    R = {True: [], False: []}
    A = {True: [], False: []}; T = {True: [], False: []}
    for g in PG + "asteroids breakout freeway frostbite pong qbert seaquest space_invaders".split():
        a = d.get((g, "adv2", w)); t = d.get((g, "tier3", w))
        if not a or not t: continue
        am, tm = statistics.median(a), statistics.median(t)
        ispg = g in PG
        A[ispg].append(am); T[ispg].append(tm); R[ispg].append(tm / am)
        print("%-16s%12.0f%12.0f%8.3f" % (g, am, tm, tm / am))
    for lab, sel in (("ProcGen16", [True]), ("ALE8", [False]), ("all-24", [True, False])):
        a = sum((A[s] for s in sel), []); t = sum((T[s] for s in sel), []); r = sum((R[s] for s in sel), [])
        if a: print("GEOMEAN %-10s adv2=%12.0f  tier3=%12.0f  ratio=%.3f" % (lab, gm(a), gm(t), gm(r)))
PYEOF
rm -rf "$SHADOW"
echo "TIER3_FIG4A_DONE $(date)"
