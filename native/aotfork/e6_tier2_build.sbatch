#!/bin/bash -l
#SBATCH -J e6_tier2_build
#SBATCH -o logs/%x_%j.out
#SBATCH -e logs/%x_%j.err
#SBATCH -p serial_requeue
#SBATCH -C genoa
#SBATCH -N 1
#SBATCH -c 32
#SBATCH --mem=64G
#SBATCH -t 0-03:00
# E6.2 step 1/2 — TIER-2 BUILD + GATE (HANDOFF-2026-09-04-round6-E3-adoption.md §6.1).
# Tier 2 = the game's AOT unit compiled WITHOUT -fprofile-use (UNIT_NOPGO=1: a never-
# profiled game), linked against the PGO'd + thin-LTO'd engine objects and host built
# from forkI24.profdata, with E3 intrinsics (INTR=1). TAG=IT2u.
# Non-exclusive: builds/gates need no node isolation. The banked A/B is e6_tier2_bank.sbatch
# (--exclusive), submitted with --dependency=afterok:<this job>.
# Writes only *IT2u*-tagged artifacts + out/e6build_<job>/.
set -uo pipefail
cd "${SLURM_SUBMIT_DIR:-.}"; mkdir -p logs
BASE=/n/holylabs/gershman_lab/Users/rtruong
WE=$BASE/playtrain-wt-engine; LIVE=$BASE/playtrain; TR=$BASE/playtrain-trainers
PY=$BASE/analogen-jaxbench/.venv/bin/python
export PATH="$HOME/.cargo/bin:/n/home06/truong/.local-node/bin:$PATH"
export PYTHONPATH="$TR/src:$WE/src" OMP_NUM_THREADS=1
echo "node=$(hostname) kernel=$(uname -r) job=${SLURM_JOB_ID:-none}"; lscpu | grep "Model name" | head -1
cd "$WE" || exit 1; git log --oneline -1
OUT=$WE/native/aotfork/out; GDIR=$LIVE/examples/games/js
PROCGEN="bigfish bossfight caveflyer chaser climber coinrun dodgeball fruitbot heist jumper leaper maze miner ninja plunder starpilot"
ALE="asteroids breakout freeway frostbite pong qbert seaquest space_invaders"
JOB="${SLURM_JOB_ID:-x}"; OUTD="$OUT/e6build_$JOB"; mkdir -p "$OUTD"
RA_PGO=$OUT/libplaytrain_rasterizer.a.rustpgo_adv
NGSO=$WE/native/build/libqjs_vec.so
for f in "$RA_PGO" "$NGSO" "$OUT/qjsc" "$OUT/forkI24.profdata" "$OUT/libqjs_vec.forkIT2.so" "$OUT/host_f0IT2"; do [ -e "$f" ] || { echo "missing $f — run e3_tune24 first"; exit 1; }; done
for g in $PROCGEN $ALE; do [ -f "$OUT/libqjs_vec.futIT2_$g.so" ] || { echo "missing futIT2 $g"; exit 1; }; done
cd native/aotfork
( "$OUT/qjsc" -h 2>&1 || true ) | grep -q -- '-P' || { echo "qjsc lacks -P"; exit 1; }

echo "== 1. tier-2 builds (TAG=IT2u: TUNE=use + UNIT_NOPGO=1 + INTR=1, Rust-PGO rasterizer) =="
export FORK_OUT=$OUT INTR=1 TUNE=use PROFDATA=$OUT/forkI24.profdata TAG=IT2u UNIT_NOPGO=1 RA=$RA_PGO
rm -rf "$OUT/objIT2u" "$OUT/picIT2u"
bash build_fork.sh engine 2>&1 | tail -1 || { echo ENGINE_BUILD_FAIL; exit 1; }
bash build_fork.sh f0 2>&1 | tail -1
bash build_fork.sh vec0 2>&1 | tail -1     # builds the PIC engine archives once, before the parallel vec1 calls
for g in $PROCGEN $ALE; do echo "$GDIR/$g.js"; done | xargs -P 12 -I{} bash -c 'bash build_fork.sh vec1 "$1" 2>&1 | grep -E "^built|error|failed" || echo "BUILD_FAIL vec1 $1"' _ {}
for f in "$WE"/examples/games/js/*.js; do echo "$f"; done | xargs -P 12 -I{} bash -c 'bash build_fork.sh f1 "$1" 2>&1 | grep -E "^built|error|failed" || echo "BUILD_FAIL f1 $1"' _ {}
NV=$(ls "$OUT"/libqjs_vec.futIT2u_*.so 2>/dev/null | wc -l); NH=$(ls "$OUT"/host_f1IT2u_* 2>/dev/null | wc -l)
echo "futIT2u .so built: $NV / 24; host_f1IT2u: $NH / 33"
[ "$NV" -eq 24 ] && [ "$NH" -eq 33 ] || { echo TIER2_BUILD_INCOMPLETE; exit 1; }
for f in libqjs_vec.forkIT2u.so libqjs_vec.futIT2u_miner.so libqjs_vec.futIT2_miner.so host_f0IT2u host_f1IT2u_miner; do echo "md5 $f $(md5sum "$OUT/$f" | cut -c1-32)"; done
# sanity: the unit object must differ from the tier-3 one (else the knob did nothing)
[ -f "$OUT/aotI_miner/game_aot_picIT2.o" ] && cmp -s "$OUT/aotI_miner/game_aot_picIT2u.o" "$OUT/aotI_miner/game_aot_picIT2.o" && { echo "UNIT_NOPGO_NOOP (tier-2 unit object identical to tier-3)"; exit 1; }
unset TUNE PROFDATA TAG UNIT_NOPGO

echo "== 2. gate: f0IT2u + f1IT2u on the 33 paper games x 3 seeds (vs V8 reference) =="
GT=$OUT/gateIT2u; rm -rf "$GT"; mkdir -p "$GT"; ln -sf "$OUT/host_f0IT2u" "$GT/host_f0"
for f in "$WE"/examples/games/js/*.js; do g=$(basename "$f" .js); [ -x "$OUT/host_f1IT2u_$g" ] && ln -sf "$OUT/host_f1IT2u_$g" "$GT/host_f1_$g"; done
REFDIR=$OUT/gate_ref GAMES_DIR=$WE/examples/games/js bash gate_fork.sh "$GT" --all 3000 2>&1 | tee "$OUTD/gateIT2u.txt" | grep -v "^  PASS"
grep -q "^  FAIL" "$OUTD/gateIT2u.txt" && { echo "GATE_FAIL (see $OUTD/gateIT2u.txt)"; exit 1; }
echo "== 2b. vec obs checksum 2000 x 24: ng (reference) vs futIT2u =="
QJS_DIRTY=1 WE=$WE GDIR=$GDIR "$PY" aot_obs_checksum.py 2000 "$(echo $PROCGEN $ALE | tr ' ' ',')" \
  ng="$NGSO" futIT2u="$OUT/libqjs_vec.futIT2u_{game}.so" 2>&1 | tee "$OUTD/checksumIT2u.txt" | grep -E "MISMATCH|MISSING|CHECKSUM"
grep -Eq "MISMATCH|MISSING" "$OUTD/checksumIT2u.txt" && { echo CHECKSUM_FAIL; exit 1; }
echo "== done $(date) =="
