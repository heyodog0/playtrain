#!/bin/bash -l
#SBATCH -J t1a_adv2
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
# Table 1(a) under adv2 (the pre-tier interpreter build). PLAN A.
#
# WHY: the AOT tiers degrade the environment ~6x under double-buffering on ALL
# 24 games (job 44649737, env-only CPU repro). Table 1(a) is the only
# double-buffered output in the paper, so it is the only one that cannot use
# tier 3. Fig 4A, panels B/C/D and Table 1(b) all run the SYNC path and are
# unaffected -- sync AOT is genuinely 1.19-1.43x faster and those stand.
#
# Same array structure as 44602115-118, which ran 96/96 tasks with zero
# deadlocks: one game per task, fresh MPS per task, shadow tree + md5 gate.
# Only the binary changes: adv2 for every game (not per-game tier3).
# IMPALA+Nature is INCLUDED here: its earlier adv2 value (994,596, job 44515752)
# came from a single-job in-process run whose ICNN row deadlocked 14/18 and whose
# per-game rate was ~2.5x slower than the array form, so that environment was
# demonstrably degraded. Re-running it here makes all four rows one harness.
# ROW is passed with --export=ALL,ROW=<impala_nature|impala_icnn|ppo_nature|ppo_impala>
set -uo pipefail
cd "${SLURM_SUBMIT_DIR:-$(dirname "$0")}"
mkdir -p logs outputs
: "${ROW:?set ROW=impala_nature|impala_icnn|ppo_nature|ppo_impala}"
PY=".venv/bin/python"
BASE=/n/holylabs/gershman_lab/Users/rtruong
WT=$BASE/playtrain-wt-tuning
ADV2="$WT/native/build/variants/libqjs_vec.adv.so"
WANT=1c5149364c32fb58ce9b81cda49fa763
GAMES=(plunder bigfish bossfight ninja starpilot heist leaper maze dodgeball
       jumper chaser caveflyer coinrun fruitbot climber miner pong freeway
       seaquest space_invaders asteroids frostbite breakout qbert)
G="${GAMES[$SLURM_ARRAY_TASK_ID]}"
A="${SLURM_ARRAY_JOB_ID}"
echo "=== ROW=$ROW task=$SLURM_ARRAY_TASK_ID game=$G node=$(hostname) $(date) ==="
got=$(md5sum "$ADV2" | awk '{print $1}')
[ "$got" = "$WANT" ] || { echo "FATAL adv2 md5 $got != $WANT" >&2; exit 2; }
export PTTREE="${TMPDIR:-/tmp}/pttree_${A}_${SLURM_ARRAY_TASK_ID}"
rm -rf "$PTTREE"; mkdir -p "$PTTREE/native/build"
cp -a "$WT/src" "$PTTREE/src"
cp -a "$WT/runtime" "$PTTREE/runtime"
cp "$WT/pyproject.toml" "$PTTREE/pyproject.toml"
cp "$ADV2" "$PTTREE/native/build/libqjs_vec.so"
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
assert md5 == os.environ["WANT_MD5"], "loaded .so is not adv2"
assert os.environ.get("QJS_DIRTY"), "QJS_DIRTY not set"
print("ADV2 PROVENANCE OK", p, md5)
GATE
O="outputs/t1a_adv2_${ROW}_${A}_${G}.json"
case "$ROW" in
  impala_nature)
    CFG="outputs/t1a_adv2_tpl_nature_${A}.json"
    [ -f "$CFG" ] || $PY tools/_mk_sweep_cfg.py configs/pt_throughput/pt_bigfish_nature_fullnode.json "$CFG" 15 5 256
    $PY tools/bench_train_suite.py --template "$CFG" --games "$G" \
        --windows 4 --max-minutes 6 --out "$O" ;;
  impala_icnn)
    $PY tools/bench_train_suite.py --template ../playtrain-trainers/configs/impala_fullnode_throughput.json \
        --games "$G" --windows 4 --max-minutes 6 --out "$O" ;;
  ppo_nature|ppo_impala)
    NET="${ROW#ppo_}"
    CFG="outputs/t1a_adv2_tpl_${ROW}_${A}.json"
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
echo "TASK_DONE ROW=$ROW $G rc=$rc $(date)"
exit $rc
