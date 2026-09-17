#!/bin/bash -l
#SBATCH -J dbuf_t3_24
#SBATCH -p kempner_h100
#SBATCH -A kempner_gershman_lab
#SBATCH --nodelist=holygpu8a15203
#SBATCH -N 1
#SBATCH -c 92
#SBATCH --gres=gpu:4
#SBATCH --mem=300G
#SBATCH -t 0-00:45
#SBATCH --array=0-23%1
#SBATCH -o logs/%x_%A_%a.out
#SBATCH -e logs/%x_%A_%a.err
#
# tab:dbuf-ablation RE-BASE under the FIXED tier 3, all 24 suite games.
#
# This is ladder_adv15203.sbatch with EXACTLY ONE change: the binary. Same
# driver (tools/bench_ladder.py), same template, same a4/a3 arm definitions
# (15 workers, double/single buffered), same statistic (median of 60s sps
# windows, first discarded), same windows/max-minutes defaults, and the SAME
# NODE. Only libqjs_vec.adv.so -> per-game libqjs_vec.futIT2fix2_<game>.so.
#
# WHY THE NODE IS PINNED: the dbuf ratio is a node property, not just a config
# property -- 15203 measured 1.325x against 17402's 1.038x on the same day with
# the same binaries (see ladder_adv15203.sbatch). 15203 is where the published
# job 37689188 ran and where the adv re-base 43783186 ran, so pinning it keeps
# the entire dbuf lineage on one node and leaves the binary as the only varying term.
# Absolutes are therefore 15203's, not a fast 17xxx node's -- deliberate.
#
# One game per array task, %1 so tasks never share the node. Fresh MPS per task,
# job-private shadow tree, md5 gate before measuring (t1a_t3fix.sbatch pattern).
#
# Submit (from analogen-jaxbench):  sbatch dbuf_t3_24.sbatch
set -uo pipefail
cd "${SLURM_SUBMIT_DIR:-$(dirname "$0")}"
mkdir -p logs outputs
PY=".venv/bin/python"
BASE=/n/holylabs/gershman_lab/Users/rtruong
WT=$BASE/playtrain-wt-tuning
WE=$BASE/playtrain-wt-engine
OUT=$WE/native/aotfork/out
GAMES=(plunder bigfish bossfight ninja starpilot heist leaper maze dodgeball
       jumper chaser caveflyer coinrun fruitbot climber miner pong freeway
       seaquest space_invaders asteroids frostbite breakout qbert)
G="${GAMES[$SLURM_ARRAY_TASK_ID]}"
A="${SLURM_ARRAY_JOB_ID}"
LIB="$OUT/libqjs_vec.futIT2fix2_${G}.so"

echo "=== dbuf_t3 task=$SLURM_ARRAY_TASK_ID game=$G node=$(hostname) $(date) ==="
echo "NODE_RECORD game=$G node=$(hostname)"
lscpu | grep -i "mhz" || true
[ -f "$LIB" ] || { echo "FATAL missing $LIB" >&2; exit 2; }
WANT=$(md5sum "$LIB" | awk '{print $1}')
echo "tier3 fix2 lib $LIB md5=$WANT"

module load cuda/12.4.1-fasrc01 2>/dev/null || module load cuda 2>/dev/null || true
export CUDA_MPS_PIPE_DIRECTORY="${TMPDIR:-/tmp}/mps_pipe_${A}_${SLURM_ARRAY_TASK_ID}"
export CUDA_MPS_LOG_DIRECTORY="${TMPDIR:-/tmp}/mps_log_${A}_${SLURM_ARRAY_TASK_ID}"
mkdir -p "$CUDA_MPS_PIPE_DIRECTORY" "$CUDA_MPS_LOG_DIRECTORY"
source scripts/mps_warm.sh
mps_up
trap 'echo quit | nvidia-cuda-mps-control 2>/dev/null || true' EXIT

# --- job-private tier3 shadow tree -----------------------------------------
export PTTREE="${TMPDIR:-/tmp}/pttree_${A}_${SLURM_ARRAY_TASK_ID}"
rm -rf "$PTTREE"; mkdir -p "$PTTREE/native/build"
cp -a "$WT/src" "$PTTREE/src"        # REAL copy: a symlinked src escapes to the worktree
cp -a "$WT/runtime" "$PTTREE/runtime"
cp "$WT/pyproject.toml" "$PTTREE/pyproject.toml"
cp "$LIB" "$PTTREE/native/build/libqjs_vec.so"
got=$(md5sum "$PTTREE/native/build/libqjs_vec.so" | awk '{print $1}')
[ "$got" = "$WANT" ] || { echo "FATAL shadow copy md5 $got != $WANT" >&2; exit 2; }
export WANT_MD5="$WANT" QJS_DIRTY=1 PLAYTRAIN_AOT=off
export PYTHONPATH="$PTTREE/src"

"$PY" - <<'GATE' || { echo "PROVENANCE CHECK FAILED - aborting" >&2; exit 2; }
import hashlib, os
import playtrain
from playtrain.runtime import native_vec_env as nve
p = str(nve._LIB_PATH); md5 = hashlib.md5(open(p, "rb").read()).hexdigest()
print("playtrain:", playtrain.__file__); print("_LIB_PATH:", p, md5)
assert p.startswith(os.environ["PTTREE"]), "shadow tree not selected: " + p
assert md5 == os.environ["WANT_MD5"], "loaded .so is not this game's fix2 tier3 lib"
assert os.environ.get("QJS_DIRTY"), "QJS_DIRTY not set"
print("TIER3FIX PROVENANCE OK")
GATE

"$PY" tools/bench_ladder.py \
    --template configs/pt_throughput/pt_bigfish_nature_fullnode.json \
    --games "$G" \
    --arms a4,a3 \
    --out "outputs/dbuf_t3_${A}_${G}.json"
rc=$?
rm -rf "$PTTREE"
echo "TASK_DONE game=$G rc=$rc node=$(hostname) $(date)"
exit $rc
