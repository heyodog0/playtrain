#!/usr/bin/env bash
#SBATCH -p sapphire
#SBATCH -c 1
#SBATCH --mem=8G
#SBATCH -t 0-02:30
#SBATCH -J tier3_pcd
#SBATCH -o /n/holylabs/gershman_lab/Users/rtruong/analogen-jaxbench/logs/tier3_pcd_%j.out
#SBATCH -e /n/holylabs/gershman_lab/Users/rtruong/analogen-jaxbench/logs/tier3_pcd_%j.err
#
# Fig 4 panels C/D (single-core vs ProcGen C++ / ALE) and the backend-ladder
# QuickJS rung, under the engine tier. Same partition/class as the adv sweeps
# (43783363/64/67, sapphire, holy8a32607) but NOT node-pinned (Ryan 2026-09-05):
# both arms live in this one job so every ratio is same-node.
#   adv2  = out/qjs_host.adv        (md5 5dcce14f4dfddc59a6b0f4e33d8a3127)
#   tier3 = out/host_f1IT2_<game>   (per-game single-core AOT host)
# Baselines REUSED, not re-run (binary-independent, re-measured 2026-09-01 on
# the same class): ~/procgen4_adv.json, ~/ale_atari6_adv.json, and the
# Playwright / V8 rungs in ~/backend_ladder_fasrc_adv.json (502 / 4,374).
#
# GAMES-DIR CAVEAT: the tier hosts were built against the LIVE tree's game
# sources; ~/node-gym-smoke/node-gym/examples/games/js differs for maze and
# freeway. Panel C/D ratios are taken on the LIVE dir (both arms). adv2 is
# ALSO run on the node-gym dir for all 24 so the published-protocol absolutes
# remain bridgeable.
set -uo pipefail
BASE=/n/holylabs/gershman_lab/Users/rtruong
WE=$BASE/playtrain-wt-engine
LIVE=$BASE/playtrain
OUT=$WE/native/aotfork/out
NG=$HOME/node-gym-smoke/node-gym
GLIVE=$LIVE/examples/games/js
GNG=$NG/examples/games/js
JOB="${SLURM_JOB_ID:-x}"
OUTD=$BASE/analogen-jaxbench/outputs/tier3_pcd_$JOB; mkdir -p "$OUTD"
echo "node=$(hostname) job=$JOB"
lscpu | grep -iE "model name" | head -1

ADVH="$OUT/qjs_host.adv"
ADVH_MD5_WANT=5dcce14f4dfddc59a6b0f4e33d8a3127
[ -x "$ADVH" ] || { echo "FATAL missing $ADVH"; exit 2; }
got=$(md5sum "$ADVH" | awk '{print $1}')
[ "$got" = "$ADVH_MD5_WANT" ] || { echo "FATAL adv2 host md5 $got != $ADVH_MD5_WANT"; exit 2; }
echo "adv2 host md5 OK $got"

PROCGEN="bigfish bossfight caveflyer chaser climber coinrun dodgeball fruitbot heist jumper leaper maze miner ninja plunder starpilot"
ALE="qbert seaquest pong breakout space_invaders frostbite freeway asteroids"
for g in $PROCGEN $ALE; do
  [ -x "$OUT/host_f1IT2_$g" ] || { echo "FATAL missing host_f1IT2_$g"; exit 2; }
done
echo "tier3 hosts present for all 24"
for f in ~/procgen4_adv.json ~/ale_atari6_adv.json ~/backend_ladder_fasrc_adv.json; do
  [ -f "$f" ] || { echo "FATAL reused baseline missing: $f"; exit 2; }
done
echo "reused baselines present"

cd "$WE/native/aotfork" || exit 2

RAW=$OUTD/raw_panelc.txt; : > "$RAW"
one () {  # arm host gamesdir game -> steps/sec
  QJS_DIRTY=1 "$2" "$3/$4.js" bench 0 100000 2>/dev/null | sed -n 's/.*= \([0-9.]*\) steps\/sec/\1/p'
}
echo "== PANEL C/D single-core, 24 games x 7 trials, interleaved =="
for g in $PROCGEN $ALE; do
  for t in 1 2 3 4 5 6 7; do
    s=$(one adv2 "$ADVH" "$GLIVE" "$g");                 echo "adv2 $g $t ${s:-0}" >> "$RAW"
    s=$(one tier3 "$OUT/host_f1IT2_$g" "$GLIVE" "$g");   echo "tier3 $g $t ${s:-0}" >> "$RAW"
    s=$(one adv2ng "$ADVH" "$GNG" "$g");                 echo "adv2ng $g $t ${s:-0}" >> "$RAW"
  done
  echo "done $g"
done

RAWL=$OUTD/raw_ladder.txt; : > "$RAWL"
echo "== LADDER QuickJS rung, 24 games x 3 reps, bench 0 80000 =="
for g in $PROCGEN $ALE; do
  for t in 1 2 3; do
    s=$(QJS_DIRTY=1 "$ADVH" "$GLIVE/$g.js" bench 0 80000 2>/dev/null | sed -n 's/.*= \([0-9.]*\) steps\/sec/\1/p')
    echo "adv2 $g $t ${s:-0}" >> "$RAWL"
    s=$(QJS_DIRTY=1 "$OUT/host_f1IT2_$g" "$GLIVE/$g.js" bench 0 80000 2>/dev/null | sed -n 's/.*= \([0-9.]*\) steps\/sec/\1/p')
    echo "tier3 $g $t ${s:-0}" >> "$RAWL"
  done
done
echo "== summary =="
python3 - "$OUTD" <<'PY'
import json, os, sys, math, collections, statistics as st
OUTD = sys.argv[1]; H = os.path.expanduser("~")
gm = lambda xs: math.exp(st.fmean([math.log(x) for x in xs]))
PG = "bigfish bossfight caveflyer chaser climber coinrun dodgeball fruitbot heist jumper leaper maze miner ninja plunder starpilot".split()
ALE = "qbert seaquest pong breakout space_invaders frostbite freeway asteroids".split()
def load(p):
    d = collections.defaultdict(list)
    for line in open(p):
        f = line.split()
        if len(f) == 4 and float(f[3]) > 0: d[(f[0], f[1])].append(float(f[3]))
    return d
d = load(OUTD + "/raw_panelc.txt")
mean = {k: st.fmean(v) for k, v in d.items()}
sd = {k: (st.stdev(v) if len(v) > 1 else 0.0) for k, v in d.items()}
pg_base = {r["game"]: r["fps_mean"] for r in json.load(open(H + "/procgen4_adv.json"))["results"]}
ale_raw = json.load(open(H + "/ale_atari6_adv.json"))["results"]
ale_base = {r["game"]: r["fps_mean"] for r in ale_raw if "fps_mean" in r}
print("\n=== PANEL C: 16 ProcGen, single core (steps/s, mean of 7) ===")
print("%-14s%12s%12s%9s%12s%9s%9s" % ("game", "adv2", "tier3", "t3/adv2", "procgen", "adv2/pg", "t3/pg"))
ra, rt, wins = [], [], 0
for g in PG:
    a, t, p = mean.get(("adv2", g)), mean.get(("tier3", g)), pg_base.get(g)
    if not (a and t and p): print("%-14s MISSING" % g); continue
    ra.append(a / p); rt.append(t / p); wins += t > p
    print("%-14s%12.0f%12.0f%9.3f%12.0f%9.2f%9.2f" % (g, a, t, t / a, p, a / p, t / p))
print("geomean vs ProcGen: adv2 %.3f  tier3 %.3f   | arith mean: adv2 %.3f tier3 %.3f | tier3 wins %d/16"
      % (gm(ra), gm(rt), st.fmean(ra), st.fmean(rt), wins))
print("tier3/adv2 geomean (PG16): %.3f" % gm([mean[("tier3", g)] / mean[("adv2", g)] for g in PG if ("tier3", g) in mean and ("adv2", g) in mean]))
print("\n=== PANEL D: ALE, single core (steps/s, mean of 7) ===")
print("%-16s%12s%12s%9s%12s%9s%9s" % ("game", "adv2", "tier3", "t3/adv2", "ale", "adv2/ale", "t3/ale"))
qa, qt, ba = [], [], []
for g in ALE:
    a, t, p = mean.get(("adv2", g)), mean.get(("tier3", g)), ale_base.get(g)
    line = "%-16s%12.0f%12.0f%9.3f" % (g, a or 0, t or 0, (t / a) if (a and t) else 0)
    if p: line += "%12.0f%9.1f%9.1f" % (p, a / p, t / p); qa.append(a); qt.append(t); ba.append(p)
    else: line += "%12s" % "-"
    print(line)
if ba: print("GEOMEAN over %d ALE games with a baseline: adv2 %.1fx  tier3 %.1fx" % (len(ba), gm(qa) / gm(ba), gm(qt) / gm(ba)))
print("tier3/adv2 geomean (ALE8): %.3f" % gm([mean[("tier3", g)] / mean[("adv2", g)] for g in ALE if ("tier3", g) in mean and ("adv2", g) in mean]))
print("\n=== node-gym games-dir cross-check (adv2 on both dirs) ===")
for g in PG + ALE:
    a, n = mean.get(("adv2", g)), mean.get(("adv2ng", g))
    if a and n: print("%-16s live %10.0f  node-gym %10.0f  ratio %.3f" % (g, a, n, n / a))
print("\n=== BACKEND LADDER, QuickJS rung ===")
L = json.load(open(H + "/backend_ladder_fasrc_adv.json"))
dl = load(OUTD + "/raw_ladder.txt")
ml = {k: st.fmean(v) for k, v in dl.items()}
games = [g for g in L["games"] if ("tier3", g) in ml]
pw = gm([L["playwright"][g] for g in games]); v8 = gm([L["v8"][g] for g in games])
qa = gm([ml[("adv2", g)] for g in games]); qt = gm([ml[("tier3", g)] for g in games])
print("games=%d  playwright %.0f (reused)  v8 %.0f (reused)  quickjs adv2 %.0f  quickjs tier3 %.0f" % (len(games), pw, v8, qa, qt))
print("adv2 : PW->V8 %.1fx  V8->QJS %.1fx  PW->QJS %.0fx" % (v8 / pw, qa / v8, qa / pw))
print("tier3: PW->V8 %.1fx  V8->QJS %.1fx  PW->QJS %.0fx" % (v8 / pw, qt / v8, qt / pw))
json.dump({"panelc_mean": {f"{k[0]}|{k[1]}": v for k, v in mean.items()},
           "panelc_sd": {f"{k[0]}|{k[1]}": v for k, v in sd.items()},
           "ladder_mean": {f"{k[0]}|{k[1]}": v for k, v in ml.items()},
           "ladder_reused": {"playwright": pw, "v8": v8, "games": games}},
          open(OUTD + "/summary.json", "w"), indent=1)
PY
echo "TIER3_PCD_DONE $(date)"
