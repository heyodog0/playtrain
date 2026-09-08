#!/usr/bin/env bash
#SBATCH -p sapphire
#SBATCH -c 1
#SBATCH -t 0-00:30
#SBATCH --mem=8G
#SBATCH -J qjsale
#SBATCH -o /n/home06/truong/sweep5.out
set -e
cd ~/node-gym-smoke/node-gym
GAMES="breakout space_invaders freeway frostbite asteroids"
CSV=$(echo $GAMES | tr ' ' ',')
echo "NODE: $(hostname)"
: > ~/qjs_atari_raw.txt
for g in $GAMES; do
  for t in 1 2 3 4 5 6 7; do
    s=$(native/build/qjs_host examples/games/js/$g.js bench 0 100000 2>/dev/null | grep -oE "[0-9]+ steps/sec" | grep -oE "^[0-9]+")
    echo "$g ${s:-0}" >> ~/qjs_atari_raw.txt
  done
  echo "done qjs $g"
done
# ALE on the SAME node (native 210x160), same 7-trial methodology
.venv/bin/python tools/bench_compare.py --backend ale --suite atari --frames 1500 --warmup 200 --trials 7 --fixed-actions >~/ale_bench5.log 2>&1
cp outputs/compare/ale_atari.json ~/ale_atari5.json
.venv/bin/python - <<'PY'
import statistics as st, json, collections, os, math
d=collections.defaultdict(list)
for line in open(os.path.expanduser("~/qjs_atari_raw.txt")):
    g,s=line.split(); d[g].append(float(s))
qm={g:st.fmean(v) for g,v in d.items()}; qs={g:st.stdev(v) for g,v in d.items()}
aj=json.load(open(os.path.expanduser("~/ale_atari5.json")))["results"]
am={r["game"]:r["fps_mean"] for r in aj}; as_={r["game"]:r["fps_std"] for r in aj}
games=sorted(qm,key=lambda g:-qm[g])
print(f'{"game":<16}{"QuickJS mean±std":>22}{"ALE mean±std":>20}{"ratio":>9}')
for g in games:
    q,qsd=qm[g],qs[g]; a,asd=am[g],as_.get(g,0); r=q/a
    rsd=r*math.sqrt((qsd/q)**2+(asd/a if a else 0)**2)
    print(f'{g:<16}{q:>13.0f} ±{qsd:>6.0f}{a:>13.0f} ±{asd:>4.0f}{r:>6.1f}±{rsd:.1f}')
def geo(x): return math.exp(st.fmean([math.log(v) for v in x]))
Qg=geo([qm[g] for g in games]); Ag=geo([am[g] for g in games])
Qa=st.fmean([qm[g] for g in games]); Aa=st.fmean([am[g] for g in games])
print("-"*67)
print(f'{"GEOMEAN":<16}{Qg:>13.0f}       {Ag:>13.0f}      {Qg/Ag:>5.1f}x')
print(f'{"ARITH-MEAN":<16}{Qa:>13.0f}       {Aa:>13.0f}      {Qa/Aa:>5.1f}x')
json.dump({"qjs":qm,"qjs_std":qs,"ale":am,"ale_std":as_,
           "geomean_qjs":Qg,"geomean_ale":Ag,"ratio_geo":Qg/Ag},
          open(os.path.expanduser("~/compare_atari5.json"),"w"),indent=1)
PY
echo SWEEP5_DONE
