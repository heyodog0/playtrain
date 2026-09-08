#!/bin/bash -l
#SBATCH -J webgl_gate
#SBATCH -o logs/%x_%j.out
#SBATCH -e logs/%x_%j.err
#SBATCH -p serial_requeue
#SBATCH -C genoa
#SBATCH --exclusive
#SBATCH -N 1
#SBATCH -c 16
#SBATCH --mem=48G
#SBATCH -t 0-03:00
# P5_WEBGL_PLAN.md tasks 2/5/7 on the cluster, in the p5-webgl worktree ONLY
# (never touches playtrain-wt-engine, -tuning, or the live tree):
#   1. build rasterizer .a (v3), stock qjs_host + libqjs_vec.so, fork engine,
#      F0, F1(seaquest.v3), vec0, vec1(seaquest.v3)
#   2. 2D gate: gate_qjs.sh --all (WEBGL games are SKIPped by the gate itself)
#   3. fork gate on five 2D games (Bytecode-mismatch scan) — proves the
#      intrinsics/createCanvas edits did not disturb the AOT path
#   4. seaquest.v3: stock == F0 == F1 trace over 3 seeds x 3000 (no V8 oracle
#      for WEBGL until Tier 2, so stock qjs_host is the reference), F1 stderr
#      must have "aot enabled" and no "Bytecode mismatch"
#   5. async/group gate: gate_async.py on seaquest.v3 + seaquest with the
#      stock, vec0 and vec1 libs (Hazard 1 — the trainer's path)
#   6. throughput: single-core bench (stock/F0/F1) and the pingpong number
set -uo pipefail
cd "${SLURM_SUBMIT_DIR:-.}"; mkdir -p logs
BASE=/n/holylabs/gershman_lab/Users/rtruong
WW=$BASE/playtrain-wt-webgl
WT=$BASE/playtrain-wt-tuning
PY=$BASE/analogen-jaxbench/.venv/bin/python
export PATH="$HOME/.cargo/bin:/n/home06/truong/.local-node/bin:$PATH"
echo "node=$(hostname) kernel=$(uname -r) job=${SLURM_JOB_ID:-none} $(date)"
cd "$WW" || exit 1
git log --oneline -1; git status -sb | head -1
OUT=$WW/native/aotfork/out; mkdir -p "$OUT"
GDIR=$WW/examples/games/js
FIVE="breakout plunder bigfish miner maze"
[ -d native/qjs/src ]    || cp -r "$WT/native/qjs/src" native/qjs/src
[ -d native/frozenmath ] || cp -r "$WT/native/frozenmath" native/frozenmath
[ -d "$OUT/src/.git" ]   || { git clone -q https://github.com/ivankra/quickjs "$OUT/src" && git -C "$OUT/src" checkout -q cee72b9c99fac98426a3bbb4fbfa493b7e5619f2; }

echo "== 1. builds =="
( cd crates/rasterizer && RUSTFLAGS="-C target-cpu=x86-64-v3" cargo rustc --release --lib --crate-type staticlib 2>&1 | tail -1 )
RA=$WW/crates/rasterizer/target/release/libplaytrain_rasterizer.a; ls -la "$RA" || exit 1
( cd crates/rasterizer && cargo test --release 2>&1 | grep -E "^test result|FAILED" )
( cd native && bash build_qjs.sh 2>&1 | tail -1 && bash build_qjs_vec.sh 2>&1 | tail -1 ) || exit 1
NG=$WW/native/build/qjs_host; NGLIB=$WW/native/build/libqjs_vec.so
cd native/aotfork
export RA FORK_OUT=$OUT INTR=1
bash build_fork.sh engine 2>&1 | grep -v "^warning\|note:" | tail -2 || exit 1
bash build_fork.sh f0 2>&1 | tail -1 || exit 1
bash build_fork.sh f1 "$GDIR/seaquest.v3.js" 2>&1 | tail -1 || exit 1
bash build_fork.sh vec0 2>&1 | tail -1 || exit 1
bash build_fork.sh vec1 "$GDIR/seaquest.v3.js" 2>&1 | tail -1 || exit 1
F0=$OUT/host_f0; F1=$OUT/host_f1_seaquest.v3; V0=$OUT/libqjs_vec.fork.so; V1=$OUT/libqjs_vec.fut_seaquest.v3.so
ls -la "$F0" "$F1" "$V0" "$V1" || exit 1

echo "== 2. 2D gate (V8 reference), all games, 3 seeds x 1000 =="
( cd .. && bash gate_qjs.sh --all 1000 2>&1 | grep -v "^  PASS" )

echo "== 3. fork gate on five 2D games (Bytecode-mismatch scan) =="
REFDIR=$OUT/gate_ref GAMES_DIR=$GDIR EXTRA_HOSTS="ng=$NG" bash gate_fork.sh "$OUT" $FIVE --steps 3000 2>&1 | grep -v "^  PASS"

echo "== 4. seaquest.v3: stock == F0 == F1, 3 seeds x 3000 =="
v3fail=0
for s in 1 42 777; do
  "$NG" "$GDIR/seaquest.v3.js" trace $s 3000 > "$OUT/v3_ng_$s.txt" 2>/dev/null
  "$F0" "$GDIR/seaquest.v3.js" trace $s 3000 > "$OUT/v3_f0_$s.txt" 2>/dev/null
  "$F1" "$GDIR/seaquest.v3.js" trace $s 3000 > "$OUT/v3_f1_$s.txt" 2> "$OUT/v3_f1_$s.err"
  cmp -s "$OUT/v3_ng_$s.txt" "$OUT/v3_f0_$s.txt" && echo "  PASS F0==stock seed=$s" || { echo "  FAIL F0!=stock seed=$s"; v3fail=1; }
  cmp -s "$OUT/v3_ng_$s.txt" "$OUT/v3_f1_$s.txt" && echo "  PASS F1==stock seed=$s" || { echo "  FAIL F1!=stock seed=$s"; v3fail=1; }
  grep -q "Bytecode mismatch" "$OUT/v3_f1_$s.err" && { echo "  FAIL Bytecode mismatch seed=$s"; v3fail=1; }
  grep -q "aot enabled" "$OUT/v3_f1_$s.err" || { echo "  FAIL F1 did not report 'aot enabled' seed=$s"; v3fail=1; }
  echo "  last: $(tail -1 "$OUT/v3_ng_$s.txt" | grep -o 'obshash=[0-9]*')"
done
[ $v3fail -eq 0 ] && echo "V3 FORK GATE PASS" || echo "V3 FORK GATE FAIL"

echo "== 5. async/group gate: seaquest.v3 + seaquest, stock/vec0/vec1, 2000 x 512 =="
# vec1 is the per-game AOT unit for seaquest.v3 (game baked in), so it is only
# valid for that game; the 2D control gets stock vs vec0 only.
WE=$WW GDIR=$GDIR "$PY" gate_async.py 2000 seaquest.v3 \
  stock="$NGLIB" vec0="$V0" vec1="$V1" 2>&1 | grep -E "FAIL|MISSING|ASYNC GATE|pp=" | tee "$OUT/v3_async.txt"
WE=$WW GDIR=$GDIR "$PY" gate_async.py 2000 seaquest \
  stock="$NGLIB" vec0="$V0" 2>&1 | grep -E "FAIL|MISSING|ASYNC GATE|pp=" | tee "$OUT/v3_async_2d.txt"

echo "== 6. throughput (this node only; ratios travel, absolutes don't) =="
for rep in 1 2; do
  for h in "$NG" "$F0" "$F1"; do printf "  %-22s " "$(basename "$h")"; "$h" "$GDIR/seaquest.v3.js" bench 0 20000 2>/dev/null | tail -1; done
  printf "  %-22s " "qjs_host(seaquest 2D)"; "$NG" "$GDIR/seaquest.js" bench 0 20000 2>/dev/null | tail -1
done
echo "done $(date)"
