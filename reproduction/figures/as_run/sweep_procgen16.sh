#!/usr/bin/env bash
#SBATCH -p sapphire
#SBATCH -c 1
#SBATCH -t 0-00:45
#SBATCH --mem=8G
#SBATCH -J qjsweep4
#SBATCH -o /n/home06/truong/sweep4.out
set -e
cd ~/node-gym-smoke/node-gym
GAMES="bigfish bossfight caveflyer chaser climber coinrun dodgeball fruitbot heist jumper leaper maze miner ninja plunder starpilot"
CSV=$(echo $GAMES | tr ' ' ',')
echo "NODE: $(hostname)"
: > ~/qjs_raw4.txt
for g in $GAMES; do
  for t in 1 2 3 4 5 6 7; do
    s=$(native/build/qjs_host examples/games/js/$g.js bench 0 100000 2>/dev/null | grep -oE "[0-9]+ steps/sec" | grep -oE "^[0-9]+")
    echo "$g ${s:-0}" >> ~/qjs_raw4.txt
  done
  echo "done qjs $g"
done
.venv-procgen/bin/python tools/bench_compare.py --backend procgen --suite procgen --games "$CSV" --frames 1500 --warmup 200 --trials 7 --fixed-actions >~/procgen_bench4.log 2>&1
cp outputs/compare/procgen_procgen.json ~/procgen4.json
.venv-procgen/bin/python - <<'PY'
import statistics as st, json, collections, os, math
d=collections.defaultdict(list)
for line in open(os.path.expanduser("~/qjs_raw4.txt")):
    g,s=line.split(); d[g].append(float(s))
qm={g:st.fmean(v) for g,v in d.items()}
qs={g:st.stdev(v) for g,v in d.items()}
pj=json.load(open(os.path.expanduser("~/procgen4.json")))["results"]
pm={r["game"]:r["fps_mean"] for r in pj}
ps={r["game"]:r["fps_std"] for r in pj}
games=sorted(qm,key=lambda g:-qm[g])
print(f'{"game":<11}{"QuickJS mean±std":>22}{"ProcGen mean±std":>22}{"ratio":>8}')
for g in games:
    q,qsd=qm[g],qs[g]; p,psd=pm[g],ps.get(g,0)
    r=q/p; rsd=r*math.sqrt((qsd/q)**2+(psd/p if p else 0)**2)
    print(f'{g:<11}{q:>13.0f} ±{qsd:>6.0f}{p:>13.0f} ±{psd:>6.0f}{r:>6.2f}±{rsd:.2f}')
n=len(games)
Q=st.fmean([qm[g] for g in games]); P=st.fmean([pm[g] for g in games])
# propagated measurement error on the arithmetic mean (independent per-game trial noise)
Qe=math.sqrt(sum((qs[g]/7**0.5)**2 for g in games))/n   # SEM of each game-mean, propagated
Pe=math.sqrt(sum((ps.get(g,0)/7**0.5)**2 for g in games))/n
R=Q/P; Re=R*math.sqrt((Qe/Q)**2+(Pe/P)**2)
# cross-game dispersion (heterogeneity, NOT measurement error)
Qsd_games=st.stdev([qm[g] for g in games])
print("-"*63)
print(f'{"MEAN":<11}{Q:>13.0f} ±{Qe:>6.0f}{P:>13.0f} ±{Pe:>6.0f}{R:>6.2f}±{Re:.2f}')
print(f'  (measurement error on the mean is tiny; cross-game spread of QJS game-means = ±{Qsd_games:.0f}, i.e. real per-game heterogeneity)')
print(f'  per-game QJS trial CV: min={min(qs[g]/qm[g] for g in games)*100:.2f}%  max={max(qs[g]/qm[g] for g in games)*100:.2f}%')
PY
echo SWEEP4_DONE
