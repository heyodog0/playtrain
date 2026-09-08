#!/usr/bin/env bash
# Drives the QJS engine-flag experiment: baseline -> -O3+march -> PGO, with
# probe_split (dec/s) after each stage and a bit-exact gate subset at the end.
set -uo pipefail
NATIVE=$HOME/node-gym-smoke/node-gym-git/native
ANALOGEN=$HOME/node-gym-smoke/consumer
export PATH="$HOME/.local-node/bin:$PATH"
export NODE_GYM_GAMES_DIR=$ANALOGEN/games/js
PGO=/tmp/qjspgo_$$; mkdir -p $PGO

probe() { # $1=label
  ( cd $ANALOGEN && PROBE_STEPS=400 uv run python ~/probe_split.py train analogen_cqhex2_teff 2>/dev/null \
      | sed "s/^RESULT/RESULT stage=$1/" )
}

echo "############ STAGE 0: baseline (current -O2 lib) ############"
probe baseline
probe baseline2

echo "############ STAGE 1: -O3 -march=native ############"
( cd $NATIVE && QJS_OPT="-O3 -march=native" bash ./exp_qjs_opt.sh ) || exit 1
probe o3native
probe o3native2

echo "############ STAGE 2: PGO ############"
( cd $NATIVE && QJS_OPT="-O3 -march=native -fprofile-generate=$PGO" bash ./exp_qjs_opt.sh ) || exit 1
# profile workload: qjs_host trace on 3 representative games (flushes .profraw at exit)
for g in analogen_cqhex2_teff analogen_cavequest_easy analogen_asteroids_medium_teff; do
  $NATIVE/build/qjs_host $NATIVE/../examples/games/js/$g.js trace 42 4000 > /dev/null 2>&1
  $NATIVE/build/qjs_host $NATIVE/../examples/games/js/$g.js trace 7 4000 > /dev/null 2>&1
done
llvm-profdata merge -o $PGO/merged.profdata $PGO/*.profraw || exit 1
( cd $NATIVE && QJS_OPT="-O3 -march=native -fprofile-use=$PGO/merged.profdata -Wno-profile-instr-unprofiled" bash ./exp_qjs_opt.sh ) || exit 1
probe pgo
probe pgo2

echo "############ STAGE 3: bit-exact gate (subset) ############"
cd $NATIVE
for g in analogen_cqhex2_teff analogen_cavequest_easy analogen_asteroids_medium_teff; do
  ./gate_qjs.sh "$g" 2500 1 42 || echo "GATEFAIL $g"
done
echo "############ DONE ############"
