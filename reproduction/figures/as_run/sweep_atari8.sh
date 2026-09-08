#!/usr/bin/env bash
#SBATCH -p sapphire
#SBATCH -c 1
#SBATCH -t 0-00:30
#SBATCH --mem=8G
#SBATCH -J qjsatari6
#SBATCH -o /n/home06/truong/sweep6.out
set -e
cd ~/node-gym-smoke/node-gym
GAMES="qbert seaquest pong breakout space_invaders frostbite freeway asteroids"
CSV=$(echo $GAMES | tr ' ' ',')
echo "NODE: $(hostname)"
: > ~/qjs_atari6_raw.txt
for g in $GAMES; do
  for t in 1 2 3 4 5 6 7; do
    s=$(native/build/qjs_host examples/games/js/$g.js bench 0 100000 2>/dev/null | grep -oE "[0-9]+ steps/sec" | grep -oE "^[0-9]+")
    echo "$g ${s:-0}" >> ~/qjs_atari6_raw.txt
  done
  echo "done qjs $g"
done
.venv/bin/python tools/bench_compare.py --backend ale --suite atari --games "$CSV" --frames 1500 --warmup 200 --trials 7 --fixed-actions >~/ale_bench6.log 2>&1
cp outputs/compare/ale_atari.json ~/ale_atari6.json
.venv/bin/python - <<'PY'
import statistics as st, json, collections, os, math
d=collections.defaultdict(list)
for line in open(os.path.expanduser("~/qjs_atari6_raw.txt")):
    g,s=line.split(); d[g].append(float(s))
qm={g:st.fmean(v) for g,v in d.items()}; qs={g:st.stdev(v) for g,v in d.items()}
aj=json.load(open(os.path.expanduser("~/ale_atari6.json")))["results"]
am={r["game"]:r.get("fps_mean") for r in aj if "fps_mean" in r}; as_={r["game"]:r.get("fps_std",0) for r in aj if "fps_mean" in r}
games=[g for g in ["qbert","seaquest","pong","breakout","space_invaders","frostbite"] if g in qm and g in am]
print(f'{"game":<16}{"QuickJS mean±std":>22}{"ALE mean±std":>22}{"ratio":>8}')
for g in games:
    q,qsd=qm[g],qs[g]; a,asd=am[g],as_.get(g,0); r=q/a
    print(f'{g:<16}{q:>13.0f} ±{qsd:>6.0f}{a:>13.0f} ±{asd:>6.0f}{r:>6.1f}x')
def geo(x): return math.exp(st.fmean([math.log(v) for v in x]))
Qg=geo([qm[g] for g in games]); Ag=geo([am[g] for g in games])
print("-"*68)
print(f'{"GEOMEAN":<16}{Qg:>13.0f}       {Ag:>13.0f}      {Qg/Ag:>5.1f}x')
json.dump({"qjs":qm,"qjs_std":qs,"ale":am,"ale_std":as_,"geomean_qjs":Qg,"geomean_ale":Ag,"ratio_geo":Qg/Ag},
          open(os.path.expanduser("~/compare_atari6.json"),"w"),indent=1)
PY
echo SWEEP6_DONE
