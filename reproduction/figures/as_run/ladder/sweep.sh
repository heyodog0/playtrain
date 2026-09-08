#!/usr/bin/env bash
cd ~/node-gym-smoke/node-gym
GAMES="bigfish bossfight caveflyer chaser climber coinrun dodgeball fruitbot heist jumper leaper maze miner ninja plunder starpilot"
echo "NODE=$(hostname)"
echo "=== QUICKJS (steps/sec) ==="
for g in $GAMES; do
  r=$(native/build/qjs_host examples/games/js/$g.js bench 0 400000 2>/dev/null | grep -oE '[0-9]+ steps/sec' | grep -oE '^[0-9]+')
  echo "$g ${r:-ERR}"
done
echo "=== PROCGEN (fps_median) ==="
CSV=$(echo $GAMES | tr ' ' ',')
.venv-procgen/bin/python tools/bench_compare.py --backend procgen --suite procgen --games "$CSV" --frames 1500 --warmup 200 --trials 5 --fixed-actions 2>&1 | grep -iE "median"
