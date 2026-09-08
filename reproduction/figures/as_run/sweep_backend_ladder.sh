#!/usr/bin/env bash
#SBATCH -p sapphire
#SBATCH -c 1
#SBATCH -t 0-00:40
#SBATCH --mem=8G
#SBATCH -J ladder
#SBATCH -o /n/home06/truong/sweep7.out
set -e
export PATH=/n/home06/truong/.local-node/bin:$PATH
PROCGEN="bigfish,bossfight,caveflyer,chaser,climber,coinrun,dodgeball,fruitbot,heist,jumper,leaper,maze,miner,ninja,plunder,starpilot"
ATARI="qbert,seaquest,pong,breakout,space_invaders,frostbite,freeway,asteroids"
ALL="bigfish bossfight caveflyer chaser climber coinrun dodgeball fruitbot heist jumper leaper maze miner ninja plunder starpilot qbert seaquest pong breakout space_invaders frostbite freeway asteroids"
echo "NODE: $(hostname)"
cd ~/node-gym-smoke/node-gym

echo "=== Playwright ==="
node ~/pw_bench_fasrc.mjs --frames 500 2>&1 | tail -1

echo "=== V8 (NodeGymEnv, production) ==="
.venv/bin/python tools/bench_compare.py --backend node --suite procgen --games "$PROCGEN" --frames 500 --warmup 50 --trials 5 --fixed-actions >~/node_pg.log 2>&1
cp outputs/compare/node_procgen.json ~/node_pg.json
.venv/bin/python tools/bench_compare.py --backend node --suite atari --games "$ATARI" --frames 500 --warmup 50 --trials 5 --fixed-actions >~/node_at.log 2>&1
cp outputs/compare/node_atari.json ~/node_at.json

echo "=== QuickJS ==="
: > ~/qjs_fasrc.txt
for g in $ALL; do
  fps=$(native/build/qjs_host examples/games/js/$g.js bench 0 80000 2>/dev/null | grep -oE "[0-9]+ steps/sec" | grep -oE "^[0-9]+")
  echo "$g ${fps:-0}" >> ~/qjs_fasrc.txt
done

python3 - <<'PY'
import json,math
pw=json.load(open('/n/home06/truong/pw_fasrc.json'))['results']
v8={}
for f in ['node_pg.json','node_at.json']:
    for r in json.load(open('/n/home06/truong/'+f))['results']:
        if 'fps_median' in r: v8[r['game']]=r['fps_median']
qjs={l.split()[0]:float(l.split()[1]) for l in open('/n/home06/truong/qjs_fasrc.txt') if len(l.split())==2}
games=[g for g in pw if g in v8 and g in qjs and v8.get(g,0)>0 and qjs.get(g,0)>0]
geo=lambda xs: math.exp(sum(math.log(x) for x in xs)/len(xs))
G={'playwright':round(geo([pw[g] for g in games])),'v8':round(geo([v8[g] for g in games])),'quickjs':round(geo([qjs[g] for g in games]))}
print('LADDER (%d games):'%len(games), G)
print('PW->V8 %.1fx  V8->QJS %.1fx  PW->QJS %.0fx'%(G['v8']/G['playwright'],G['quickjs']/G['v8'],G['quickjs']/G['playwright']))
json.dump({'machine':'FASRC sapphire','games':games,'playwright':{g:pw[g] for g in games},'v8':{g:v8[g] for g in games},'quickjs':{g:qjs[g] for g in games},'geomean':G},open('/n/home06/truong/backend_ladder_fasrc.json','w'),indent=1)
PY
echo LADDER_DONE
