#!/bin/bash -l
#SBATCH -J l1_fork
#SBATCH -o logs/%x_%j.out
#SBATCH -e logs/%x_%j.err
#SBATCH -p serial_requeue
#SBATCH -C genoa
#SBATCH --exclusive
#SBATCH -N 1
#SBATCH -c 16
#SBATCH --mem=48G
#SBATCH -t 0-04:00
# L1 (PLAN-engine-tier.md §5): Futamura AOT of bytecode via the ivankra fork's
# `qjsc -A`, measured as a STANDALONE harness. Four single-core arms, same node,
# same flags family, interleaved:
#   f0  = fork interpreter (Bellard lineage + tail-call dispatch), -O3 v3
#   f1  = f0 + `qjsc -A` per game (prelude + game compiled to C)
#   ng  = stock quickjs-ng host built here by build_qjs.sh, -O3 v3 (engine-swap control)
#   adv = the ADOPTED tuned ng host (variants/qjs_host.adv, read-only copy; PGO/LTO)
# Ratios that matter: f1/f0 (what -A buys, engine held constant) and f0/ng (what
# the engine swap costs/buys on its own). Kill: f1/f0 < 1.15 geomean on the 5.
# Runs in the engine-tier worktree ONLY; never touches playtrain-wt-tuning/build.
set -uo pipefail
cd "${SLURM_SUBMIT_DIR:-.}"; mkdir -p logs
BASE=/n/holylabs/gershman_lab/Users/rtruong
WE=$BASE/playtrain-wt-engine
WT=$BASE/playtrain-wt-tuning
LIVE=$BASE/playtrain
export PATH="$HOME/.cargo/bin:/n/home06/truong/.local-node/bin:$PATH"
echo "node=$(hostname) kernel=$(uname -r) job=${SLURM_JOB_ID:-none}"
cd "$WE" || exit 1
git log --oneline -1; git status -sb | head -1
OUT=$WE/native/aotfork/out; mkdir -p "$OUT"
GDIR=$LIVE/examples/games/js
PROCGEN="bigfish bossfight caveflyer chaser climber coinrun dodgeball fruitbot heist jumper leaper maze miner ninja plunder starpilot"
ALE="asteroids breakout freeway frostbite pong qbert seaquest space_invaders"
FIVE="breakout plunder bigfish miner maze"

# Untracked build inputs the tuning worktree has and this one lacks; copied
# READ-ONLY from it (never written back). Idempotent; also run on the login node
# before sbatch in case compute nodes have no GitHub egress.
[ -d native/qjs/src ]    || cp -r "$WT/native/qjs/src" native/qjs/src          # quickjs-ng 0.15.1 (what adv was built from)
[ -d native/frozenmath ] || cp -r "$WT/native/frozenmath" native/frozenmath   # fdlibm objects (V8-exact pow/atan2/sin/cos)
[ -d "$OUT/src/.git" ]   || { git clone -q https://github.com/ivankra/quickjs "$OUT/src" && git -C "$OUT/src" checkout -q cee72b9c99fac98426a3bbb4fbfa493b7e5619f2; }
echo "ng src: $(head -c 200 native/qjs/src/VERSION 2>/dev/null || grep -m1 -o 'CONFIG_VERSION.*' native/qjs/src/quickjs.c | head -1)"

echo "== rasterizer .a (v3, plain — same as every non-PGO arm) =="
( cd crates/rasterizer && RUSTFLAGS="-C target-cpu=x86-64-v3" cargo rustc --release --lib --crate-type staticlib 2>&1 | tail -1 )
RA=$WE/crates/rasterizer/target/release/libplaytrain_rasterizer.a; ls -la "$RA" || exit 1

echo "== ng control host (stock quickjs-ng, -O3 v3, this worktree's build/) =="
( cd native && bash build_qjs.sh 2>&1 | tail -1 )
NG=$WE/native/build/qjs_host; ADV=$WT/native/build/variants/qjs_host.adv
cp "$ADV" "$OUT/qjs_host.adv"   # read-only copy; the tuning tree is never written
echo "md5 ng  $(md5sum "$NG" | cut -c1-32)"; echo "md5 adv $(md5sum "$OUT/qjs_host.adv" | cut -c1-32) (expect 46ea49991fe2c6321cb5a0a9b558aebe)"

echo "== fork engine + F0 =="
cd native/aotfork
export RA FORK_OUT=$OUT
bash build_fork.sh engine 2>&1 | grep -v "^warning\|note:" | tail -3 || exit 1
bash build_fork.sh f0 2>&1 | tail -1 || exit 1
echo "== F1 for all games (parallel; each TU includes the whole interpreter) =="
ls "$GDIR"/*.js | xargs -P 12 -I{} bash -c 'bash build_fork.sh f1 "$1" 2>&1 | grep "^built"' _ {}
echo "F1 hosts built: $(ls "$OUT"/host_f1_* | wc -l) / $(ls "$GDIR"/*.js | wc -l)"
for h in f0 f1_bigfish f1_miner; do echo "md5 $h $(md5sum "$OUT/host_$h" | cut -c1-32)"; done

echo "== GATE: all games x 3 seeds x 3000, arms f0 f1 ng adv, one reference run =="
GAMES_DIR=$GDIR EXTRA_HOSTS="ng=$NG adv=$OUT/qjs_host.adv" bash gate_fork.sh "$OUT" --all 3000 2>&1 | tee "$OUT/gate_all.txt" | grep -v "^  PASS"
echo "== GATE (QJS_DIRTY=1 forced, 5 games): dirty-skip path under the fork =="
QJS_DIRTY=1 GAMES_DIR=$GDIR EXTRA_HOSTS="ng=$NG adv=$OUT/qjs_host.adv" bash gate_fork.sh "$OUT" $FIVE 2>&1 | tee "$OUT/gate_dirty5.txt" | grep -v "^  PASS"

echo "== BENCH A: 5 profiled games, QJS_DIRTY=1 (published single-core protocol), 5 reps x 50k =="
QJS_DIRTY=1 GAMES_DIR=$GDIR EXTRA_HOSTS="ng=$NG adv=$OUT/qjs_host.adv" bash bench_fork.sh "$OUT" "$FIVE" 5 50000 2>&1 | tee "$OUT/bench_five_dirty.txt" | tail -9
cp "$OUT/bench_raw.txt" "$OUT/bench_raw_five_dirty.txt"
echo "== BENCH B: 5 profiled games, no dirty-skip (larger rasterizer share), 3 reps x 50k =="
env -u QJS_DIRTY GAMES_DIR=$GDIR EXTRA_HOSTS="ng=$NG adv=$OUT/qjs_host.adv" bash bench_fork.sh "$OUT" "$FIVE" 3 50000 2>&1 | tee "$OUT/bench_five_nodirty.txt" | tail -9
cp "$OUT/bench_raw.txt" "$OUT/bench_raw_five_nodirty.txt"
echo "== BENCH C: ProcGen16 + ALE8, QJS_DIRTY=1, 3 reps x 30k =="
QJS_DIRTY=1 GAMES_DIR=$GDIR EXTRA_HOSTS="ng=$NG adv=$OUT/qjs_host.adv" bash bench_fork.sh "$OUT" "$PROCGEN $ALE" 3 30000 2>&1 | tee "$OUT/bench_24_dirty.txt" | tail -28
cp "$OUT/bench_raw.txt" "$OUT/bench_raw_24_dirty.txt"
echo "== done $(date) =="
