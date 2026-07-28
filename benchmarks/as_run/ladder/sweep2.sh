#!/usr/bin/env bash
cd ~/node-gym-smoke/node-gym
GAMES="bigfish bossfight caveflyer chaser climber coinrun dodgeball fruitbot heist jumper leaper maze miner ninja plunder starpilot"
CSV=$(echo $GAMES | tr ' ' ',')
: > ~/qjs_raw.txt
for g in $GAMES; do
  for t in 1 2 3 4 5; do
    s=$(native/build/qjs_host examples/games/js/$g.js bench 0 250000 2>/dev/null | grep -oE '[0-9]+ steps/sec' | grep -oE '^[0-9]+')
    echo "$g ${s:-0}" >> ~/qjs_raw.txt
  done
  echo "done $g" >&2
done
# ProcGen (writes outputs/compare/procgen_procgen.json with fps_median/fps_std)
.venv-procgen/bin/python tools/bench_compare.py --backend procgen --suite procgen --games "$CSV" --frames 1500 --warmup 200 --trials 7 --fixed-actions >~/procgen_bench.log 2>&1
# build QuickJS JSON in bench_compare format (median + std across trials)
.venv-procgen/bin/python - <<'PY'
import statistics, json, collections, os
d = collections.defaultdict(list)
for line in open(os.path.expanduser("~/qjs_raw.txt")):
    g, s = line.split(); d[g].append(float(s))
res = [{"game": g, "fps_median": statistics.median(v), "fps_mean": statistics.fmean(v),
        "fps_std": statistics.pstdev(v)} for g, v in d.items()]
json.dump({"backend": "quickjs", "suite": "procgen", "results": res},
          open(os.path.expanduser("~/qjs_sweep.json"), "w"))
print("wrote qjs_sweep.json:", len(res), "games")
PY
echo SWEEP2_DONE
