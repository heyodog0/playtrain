#!/usr/bin/env bash
#SBATCH -p sapphire
#SBATCH -c 1
#SBATCH -t 0-00:45
#SBATCH --mem=8G
#SBATCH -J qjsweep
#SBATCH -o /n/home06/truong/sweep3.out
set -e
cd ~/node-gym-smoke/node-gym
GAMES="bigfish bossfight caveflyer chaser climber coinrun dodgeball fruitbot heist jumper leaper maze miner ninja plunder starpilot"
CSV=$(echo $GAMES | tr ' ' ',')
echo "NODE: $(hostname)"
lscpu | grep -E "Model name" | sed 's/  */ /g'
: > ~/qjs_raw_new.txt
for g in $GAMES; do
  for t in 1 2 3; do
    s=$(native/build/qjs_host examples/games/js/$g.js bench 0 100000 2>/dev/null | grep -oE "[0-9]+ steps/sec" | grep -oE "^[0-9]+")
    echo "$g ${s:-0}" >> ~/qjs_raw_new.txt
  done
  echo "done qjs $g"
done
.venv-procgen/bin/python tools/bench_compare.py --backend procgen --suite procgen --games "$CSV" --frames 1500 --warmup 200 --trials 7 --fixed-actions >~/procgen_bench_new.log 2>&1
cp outputs/compare/procgen_procgen.json ~/procgen_new.json
.venv-procgen/bin/python - <<'PY'
import statistics, json, collections, os
d=collections.defaultdict(list)
for line in open(os.path.expanduser("~/qjs_raw_new.txt")):
    g,s=line.split(); d[g].append(float(s))
qjs={g:statistics.median(v) for g,v in d.items()}
pg={r["game"]:r["fps_median"] for r in json.load(open(os.path.expanduser("~/procgen_new.json")))["results"]}
games=sorted(qjs, key=lambda g:-qjs[g])
print(f'{"game":<11}{"QuickJS":>10}{"ProcGen":>10}{"QJS/PG":>8}')
qs=[];ps=[]
for g in games:
    q=qjs[g]; p=pg.get(g,0); qs.append(q); ps.append(p)
    print(f'{g:<11}{q:>10.0f}{p:>10.0f}{(q/p if p else 0):>8.2f}')
mq=statistics.fmean(qs); mp=statistics.fmean(ps)
print("-"*39)
print(f'{"MEAN":<11}{mq:>10.0f}{mp:>10.0f}{mq/mp:>8.2f}')
json.dump({"qjs":qjs,"procgen":pg,"mean_qjs":mq,"mean_pg":mp,"ratio":mq/mp},
          open(os.path.expanduser("~/compare_new.json"),"w"),indent=1)
PY
echo SWEEP3_DONE
