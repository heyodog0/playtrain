#!/bin/bash -l
#SBATCH -J ep_best_7pt
#SBATCH -o logs/%x_%j.out
#SBATCH -e logs/%x_%j.err
#SBATCH -p serial_requeue
#SBATCH -C genoa
#SBATCH --mincpus=96
#SBATCH -N 1
#SBATCH --exclusive
#SBATCH --mem=0
#SBATCH -t 0-04:00
#
# EnvPool DOCUMENTED-BEST arm at the published 7-point grid (5/10/20/30/40/60/80).
#
# WHY: job 44545120's EnvPool arm used final_any's `async_numa` (numactl NUMA
# binding), NOT ep_best_sweep's documented-best (envpool's own
# thread_affinity_offset). That understates the baseline by 10-28%, worst at low
# thread counts, and would have inflated the 80-thread ProcGen ratio from the
# correct 2.58x to 2.88x. This job re-measures the tuned arm with
# ep_best_sweep.sbatch's child VERBATIM, widened to all seven points and to ALE.
# Sanity: at 80 threads BS works out to 120, matching the "bs120" on record.
#
# Also runs a PlayTrain tier3 anchor at 80 threads (24 games x 2) so that if this
# lands on a different node than 44545120 (holy8a28510) the offset is measurable
# rather than assumed. NOT node-pinned, per Ryan.
set -uo pipefail
BASE=/n/holylabs/gershman_lab/Users/rtruong
AJ=$BASE/analogen-jaxbench; TR=$BASE/playtrain-trainers
WT=$BASE/playtrain-wt-tuning; WE=$BASE/playtrain-wt-engine; LIVE=$BASE/playtrain
OUT=$WE/native/aotfork/out
cd "$AJ" || exit 2
mkdir -p logs outputs
PY="$AJ/.venv/bin/python"
JOB="${SLURM_JOB_ID:-x}"
export LD_LIBRARY_PATH="$AJ/.venv/lib/python3.13/site-packages/PyQt5/Qt5/lib:${LD_LIBRARY_PATH:-}"
echo "node=$(hostname) job=$JOB"; lscpu | grep -iE "model name|numa node\(s\)" | head -2
OUTD="$AJ/outputs/ep_best_7pt_${JOB}"; mkdir -p "$OUTD"

# ---------- PlayTrain tier3 anchor at 80 threads (node offset detector) ----------
ADV2="$WT/native/build/variants/libqjs_vec.adv.so"
WANT=1c5149364c32fb58ce9b81cda49fa763
got=$(md5sum "$ADV2" | awk '{print $1}')
[ "$got" = "$WANT" ] || { echo "FATAL adv2 md5 $got"; exit 2; }
SHADOW="${TMPDIR:-/tmp}/pttree_${JOB}"
rm -rf "$SHADOW"; mkdir -p "$SHADOW/native/build"
cp -a "$WT/src" "$SHADOW/src"; cp -a "$WT/runtime" "$SHADOW/runtime"
cp "$WT/pyproject.toml" "$SHADOW/pyproject.toml"; cp "$ADV2" "$SHADOW/native/build/libqjs_vec.so"
export PYTHONPATH="$TR/src:$SHADOW/src" OMP_NUM_THREADS=1 QJS_DIRTY=1 PLAYTRAIN_AOT=off SHADOW
"$PY" - <<'GATE' || { echo "FATAL provenance"; exit 2; }
import os, hashlib
from playtrain.runtime import native_vec_env as nve
p = str(nve._LIB_PATH); assert p.startswith(os.environ["SHADOW"]), p
print("SHADOW PROVENANCE OK", p, hashlib.md5(open(p,"rb").read()).hexdigest())
GATE
GAMES="bigfish bossfight caveflyer chaser climber coinrun dodgeball fruitbot heist jumper leaper maze miner ninja plunder starpilot asteroids breakout freeway frostbite pong qbert seaquest space_invaders"
echo "== PlayTrain tier3 anchor, 80 threads, 24 games x 2 =="
for R in 1 2; do for G in $GAMES; do
  src="$OUT/libqjs_vec.futIT2_$G.so"
  w=$(md5sum "$src" | awk '{print $1}'); cp "$src" "$SHADOW/native/build/libqjs_vec.so"
  g2=$(md5sum "$SHADOW/native/build/libqjs_vec.so" | awk '{print $1}')
  [ "$w" = "$g2" ] || { echo "FATAL md5 gate $G"; exit 2; }
  "$PY" "$TR/benchmarks/bench_vec_rollout.py" --game "$G" --games-dir "$LIVE/examples/games/js" \
    --no-model --device cpu --frame-skip 1 --steps 300 --max-steps 2000 \
    --envs 128 --workers 16 --env-threads 5 --out "$OUTD/anchor_${G}_tier3_w16_r${R}.json" >/dev/null 2>&1 \
    || echo "ANCHOR_FAIL $G r$R"
done; done
rm -rf "$SHADOW"
echo "ANCHOR_DONE $(date)"

# ---------- EnvPool documented-best, 7 points ----------
cat > "$OUTD/ep_aff_child.py" <<'CHILD'
import sys, time, json
import numpy as np, envpool
env_id, ne, nt, off, bs = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
kw = dict(batch_size=bs)
if env_id.endswith("-v5"):
    kw.update(img_height=64, img_width=64, gray_scale=False, stack_num=1, frame_skip=1)
env = envpool.make_gymnasium(env_id, num_envs=ne, num_threads=nt,
                             thread_affinity_offset=off, **kw)
na = env.action_space.n
env.async_reset()
def pump(sec):
    t0, n = time.time(), 0
    while time.time() - t0 < sec:
        out = env.recv(); ids = out[-1]["env_id"]
        env.send(np.random.randint(0, na, size=len(ids)).astype(np.int32), ids)
        n += len(ids)
    return n, time.time() - t0
pump(4.0); n, dt = pump(12.0)
print(json.dumps({"sps": n / dt}))
CHILD
OUTD="$OUTD" "$PY" - <<'PYEOF'
import glob, json, math, os, subprocess
NODES = sorted(int(p.split("node")[-1]) for p in glob.glob("/sys/devices/system/node/node[0-9]*"))
K = len(NODES); CPD = os.cpu_count() // K
OUTD = os.environ["OUTD"]
PYBIN = os.path.abspath(".venv/bin/python")
PG = ["BigfishEasy-v0","BossfightEasy-v0","CaveflyerEasy-v0","ChaserEasy-v0",
      "ClimberEasy-v0","CoinrunEasy-v0","DodgeballEasy-v0","FruitbotEasy-v0",
      "HeistEasy-v0","JumperEasy-v0","LeaperEasy-v0","MazeEasy-v0",
      "MinerEasy-v0","NinjaEasy-v0","PlunderEasy-v0","StarpilotEasy-v0"]
ALE = ["Asteroids-v5","Breakout-v5","Freeway-v5","Frostbite-v5",
       "Pong-v5","Qbert-v5","Seaquest-v5","SpaceInvaders-v5"]
rows, OUT = [], f"{OUTD}/ep_best_7pt.json"
print(f"K={K} NUMA domains, CPD={CPD} cpus/domain", flush=True)
for T in (5, 10, 20, 30, 40, 60, 80):
    envs = max(K, 2048 * T // 80)
    pe, pt = envs // K, max(1, T // K)
    BS = max(16, pt * 3)
    print(f"--- T={T} envs={envs} per_pool={pe} threads_per_pool={pt} bs={BS}", flush=True)
    for suite, ids in (("procgen", PG), ("ale", ALE)):
        for env_id in ids:
            procs = [subprocess.Popen(
                        [PYBIN, f"{OUTD}/ep_aff_child.py", env_id, str(pe), str(pt),
                         str(i * CPD), str(BS)],
                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                     for i in range(K)]
            tot, bad = 0.0, 0
            for p in procs:
                o, _ = p.communicate(timeout=600)
                try: tot += json.loads(o.strip().splitlines()[-1])["sps"]
                except Exception: bad += 1
            row = {"suite": suite, "env_id": env_id, "threads": T,
                   "best_aff": round(tot) if bad == 0 else None}
            rows.append(row); json.dump(rows, open(OUT, "w"), indent=1)
    print(f"    done T={T}", flush=True)
def geo(v): return math.exp(sum(map(math.log, v)) / len(v)) if v else 0
print("\n=== EnvPool documented-best geomeans, 7 points ===")
for suite in ("procgen", "ale"):
    vals = []
    for T in (5, 10, 20, 30, 40, 60, 80):
        v = [r["best_aff"] for r in rows if r["suite"] == suite and r["threads"] == T and r.get("best_aff")]
        vals.append(geo(v)); print(f"t{T:<3d} {suite:8s} {geo(v):>12,.0f}  (n={len(v)})", flush=True)
    print(f"  {suite} curve: " + " / ".join(f"{v:,.0f}" for v in vals))
PYEOF
echo "EP_BEST_7PT_DONE $(date)"
