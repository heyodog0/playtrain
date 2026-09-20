#!/bin/bash -l
#SBATCH -J ps_nodevec
#SBATCH -o logs/%x_%j.out
#SBATCH -e logs/%x_%j.err
#SBATCH -p serial_requeue
#SBATCH -C sapphirerapids
#SBATCH -N 1
#SBATCH -c 96
#SBATCH --mem=48G
#SBATCH -t 0-01:30
# PuzzleScript bundles: node backends vs the QuickJS vec host, many cores. Worktree = branch puzzlescript.
set -uo pipefail
L=/n/holylabs/gershman_lab/Users/rtruong
WT=$L/playtrain-wt-puzzlescript
cd "$WT"; mkdir -p logs
export PATH=/n/home06/truong/.local-node/bin:$PATH
PY=$L/playtrain-trainers-bbf/.venv/bin/python
export PYTHONPATH=$WT/src
export PLAYTRAIN_GAMES_DIR=$WT/examples/games/multifile/parity/puzzlescript/dist
export PS_QJS_LIB=$L/playtrain-wt-tuning/native/build/libqjs_vec.so
echo "node=$(hostname) commit=$(git log --oneline -1)"; lscpu | grep -E "Model name|CPU max MHz|CPU MHz" | head -3; nproc
"$PY" benchmarks/node_vec_proto/cluster_bench.py --games sokoban_basic kettle notsnake --ns 1 8 16 32 64 96 --steps 400
