#!/bin/bash -l
#SBATCH -J t1a_t3fix
#SBATCH -o logs/%x_%A_%a.out
#SBATCH -e logs/%x_%A_%a.err
#SBATCH -p kempner_h100
#SBATCH -A kempner_gershman_lab
#SBATCH --exclude=holygpu8a13401,holygpu8a13402,holygpu8a13403,holygpu8a13404,holygpu8a17601
#SBATCH -N 1
#SBATCH -c 92
#SBATCH --gres=gpu:4
#SBATCH --mem=300G
#SBATCH -t 0-00:45
#SBATCH --array=0-23%1
#
# Table 1(a) under the FIXED tier 3 (futIT2fix2_<game>.so, envs pinned to owner
# workers in async mode -- handoff/INVESTIGATE-aot-async-regression.md ss0.2).
#
# This is t1a_adv2.sbatch with EXACTLY ONE change: the binary. Same array
# structure (one game per task, %1, fresh MPS per task, job-private shadow tree,
# md5 gate), same partition/resources/exclude list, same row templates, same
# windows/max-minutes. Every other knob is byte-identical so the comparison
# against jobs 44670988/44670899/44670900/44670901 (adv2) is like-for-like.
#
# UNPINNED (no --nodelist). Node per task is echoed and in sacct.
# ROW is passed with --export=ALL,ROW=<impala_nature|impala_icnn|ppo_nature|ppo_impala>
set -uo pipefail
cd "${SLURM_SUBMIT_DIR:-$(dirname "$0")}"
mkdir -p logs outputs
: "${ROW:?set ROW=impala_nature|impala_icnn|ppo_nature|ppo_impala}"
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
echo "=== ROW=$ROW task=$SLURM_ARRAY_TASK_ID game=$G node=$(hostname) $(date) ==="
echo "NODE_RECORD ROW=$ROW game=$G node=$(hostname)"
[ -f "$LIB" ] || { echo "FATAL missing $LIB" >&2; exit 2; }
WANT=$(md5sum "$LIB" | awk '{print $1}')
echo "fix2 lib $LIB md5=$WANT"
export PTTREE="${TMPDIR:-/tmp}/pttree_${A}_${SLURM_ARRAY_TASK_ID}"
rm -rf "$PTTREE"; mkdir -p "$PTTREE/native/build"
cp -a "$WT/src" "$PTTREE/src"
cp -a "$WT/runtime" "$PTTREE/runtime"
cp "$WT/pyproject.toml" "$PTTREE/pyproject.toml"
cp "$LIB" "$PTTREE/native/build/libqjs_vec.so"
got=$(md5sum "$PTTREE/native/build/libqjs_vec.so" | awk '{print $1}')
[ "$got" = "$WANT" ] || { echo "FATAL shadow copy md5 $got != $WANT" >&2; exit 2; }
export WANT_MD5="$WANT" QJS_DIRTY=1 PLAYTRAIN_AOT=off
export PYTHONPATH="$(cd ../playtrain-trainers && pwd)/src:$PTTREE/src:${PYTHONPATH:-}"
module load cuda/12.4.1-fasrc01 2>/dev/null || module load cuda 2>/dev/null || true
source scripts/mps_warm.sh
mps_up
"$PY" - <<'GATE' || { echo "PROVENANCE CHECK FAILED" >&2; exit 2; }
import hashlib, os
import playtrain
from playtrain.runtime import native_vec_env as nve
p = str(nve._LIB_PATH); md5 = hashlib.md5(open(p, "rb").read()).hexdigest()
assert p.startswith(os.environ["PTTREE"]), "shadow tree not selected: " + p
assert md5 == os.environ["WANT_MD5"], "loaded .so is not the fix2 tier3 lib for this game"
assert os.environ.get("QJS_DIRTY"), "QJS_DIRTY not set"
print("TIER3FIX PROVENANCE OK", p, md5)
GATE
O="outputs/t1a_t3fix_${ROW}_${A}_${G}.json"
case "$ROW" in
  impala_nature)
    CFG="outputs/t1a_t3fix_tpl_nature_${A}.json"
    [ -f "$CFG" ] || $PY tools/_mk_sweep_cfg.py configs/pt_throughput/pt_bigfish_nature_fullnode.json "$CFG" 15 5 256
    $PY tools/bench_train_suite.py --template "$CFG" --games "$G" \
        --windows 4 --max-minutes 6 --out "$O" ;;
  impala_icnn)
    $PY tools/bench_train_suite.py --template ../playtrain-trainers/configs/impala_fullnode_throughput.json \
        --games "$G" --windows 4 --max-minutes 6 --out "$O" ;;
  ppo_nature|ppo_impala)
    NET="${ROW#ppo_}"
    CFG="outputs/t1a_t3fix_tpl_${ROW}_${A}.json"
    if [ ! -f "$CFG" ]; then
      $PY - "$CFG" "$NET" <<'PYEOF'
import json, sys
out, net = sys.argv[1], sys.argv[2]
c = json.load(open("outputs/pv_p_breakout_s0/config.json"))
c.update(net=net, n_envs=768, n_steps=128, n_minibatches=32,
         ddp=True, native_env_threads=12, compile_mode=None,
         double_buffer=False, bf16=(net == "impala"), use_wandb=False)
json.dump(c, open(out, "w"), indent=1)
PYEOF
    fi
    $PY tools/bench_ppo_suite.py --template "$CFG" --games "$G" \
        --windows 3 --window-steps 2000000 --warmup-steps 2000000 \
        --max-minutes 6 --nproc 4 --out "$O" ;;
  *) echo "FATAL unknown ROW=$ROW" >&2; exit 2 ;;
esac
rc=$?
rm -rf "$PTTREE"
echo "TASK_DONE ROW=$ROW $G rc=$rc node=$(hostname) $(date)"
exit $rc
