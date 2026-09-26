#!/bin/bash -l
#SBATCH -J tier3_fig4a7
#SBATCH -o logs/%x_%j.out
#SBATCH -e logs/%x_%j.err
#SBATCH -p serial_requeue
#SBATCH -C genoa
#SBATCH --mincpus=96
#SBATCH -N 1
#SBATCH --exclusive
#SBATCH --mem=0
#SBATCH -t 0-10:00
#
# Fig 4A at the PUBLISHED thread resolution: 5/10/20/30/40/60/80 env threads.
# Job 44515188 measured only 10/20/40/80 -- the 4-point grid the adv-era
# redesign (handoff/fig_preview_2026-09-03/plot_4a_adv.py, T=[10,20,40,80])
# introduced. The published panel A (jobs 38145651 ProcGen / 39032276 ALE) used
# SEVEN points for both arms and both suites; 5/30/60 are exactly where the
# crossover and EnvPool's flattening are legible. This restores them.
#
# All FOUR arms in ONE job so the whole panel is same-node:
#   PlayTrain tier3 = out/libqjs_vec.futIT2_<game>.so   (per game, md5-gated)
#   PlayTrain adv2  = variants/libqjs_vec.adv.so        (reference)
#   EnvPool tuned      = async + NUMA-bound shards   (final_any's async_numa)
#   EnvPool as-shipped = single sync pool            (final_any's sync1)
# EnvPool arm code is final_any.sbatch's, verbatim, with the T loop widened to
# all seven points and ALE swept too (final_any swept ProcGen only, and took
# ALE at 80 alone).
set -uo pipefail
BASE=/n/holylabs/gershman_lab/Users/rtruong
AJ=$BASE/analogen-jaxbench
TR=$BASE/playtrain-trainers
WT=$BASE/playtrain-wt-tuning
WE=$BASE/playtrain-wt-engine
LIVE=$BASE/playtrain
OUT=$WE/native/aotfork/out
PY=$AJ/.venv/bin/python
JOB="${SLURM_JOB_ID:-x}"
cd "$AJ" || exit 2
mkdir -p logs outputs
echo "node=$(hostname) job=$JOB"; lscpu | grep -iE "model name|^CPU\(s\)|numa node\(s\)" | head -4

ADV2="$WT/native/build/variants/libqjs_vec.adv.so"
WANT=1c5149364c32fb58ce9b81cda49fa763
got=$(md5sum "$ADV2" | awk '{print $1}')
[ "$got" = "$WANT" ] || { echo "FATAL adv2 md5 $got != $WANT"; exit 2; }
echo "adv2 md5 OK $got"
PROCGEN="bigfish bossfight caveflyer chaser climber coinrun dodgeball fruitbot heist jumper leaper maze miner ninja plunder starpilot"
ALE="asteroids breakout freeway frostbite pong qbert seaquest space_invaders"
for g in $PROCGEN $ALE; do
  [ -f "$OUT/libqjs_vec.futIT2_$g.so" ] || { echo "FATAL missing tier3 .so $g"; exit 2; }
done

SHADOW="${TMPDIR:-/tmp}/pttree_${JOB}"
rm -rf "$SHADOW"; mkdir -p "$SHADOW/native/build"
cp -a "$WT/src" "$SHADOW/src"; cp -a "$WT/runtime" "$SHADOW/runtime"
cp "$WT/pyproject.toml" "$SHADOW/pyproject.toml"
cp "$ADV2" "$SHADOW/native/build/libqjs_vec.so"
export PYTHONPATH="$TR/src:$SHADOW/src" OMP_NUM_THREADS=1 QJS_DIRTY=1 PLAYTRAIN_AOT=off SHADOW
"$PY" - <<'GATE' || { echo "FATAL provenance"; exit 2; }
import os, hashlib
from playtrain.runtime import native_vec_env as nve
p = str(nve._LIB_PATH)
assert p.startswith(os.environ["SHADOW"]), p
print("SHADOW PROVENANCE OK", p, hashlib.md5(open(p, "rb").read()).hexdigest())
GATE

OUTD="$AJ/outputs/tier3_fig4a7_${JOB}"; mkdir -p "$OUTD"
SO="$SHADOW/native/build/libqjs_vec.so"
run_arm () {  # arm workers game outfile
  local arm=$1 w=$2 g=$3 of=$4 src want got
  case "$arm" in
    adv2)  src="$ADV2" ;;
    tier3) src="$OUT/libqjs_vec.futIT2_$g.so" ;;
  esac
  want=$(md5sum "$src" | awk '{print $1}'); cp "$src" "$SO"
  got=$(md5sum "$SO" | awk '{print $1}')
  [ "$got" = "$want" ] || { echo "FATAL md5 gate $g $arm"; exit 2; }
  "$PY" "$TR/benchmarks/bench_vec_rollout.py" --game "$g" --games-dir "$LIVE/examples/games/js" \
    --no-model --device cpu --frame-skip 1 --steps 300 --max-steps 2000 \
    --envs 128 --workers "$w" --env-threads 5 --out "$of" >/dev/null 2>&1 \
    || echo "RUN_FAIL $g $arm w$w"
}
echo "== PlayTrain: 24 games x 7 points x 2 arms, 2 trials (3 at w16) =="
for W in 1 2 4 6 8 12 16; do
  NT=2; [ "$W" = 16 ] && NT=3
  for R in $(seq 1 $NT); do
    for G in $PROCGEN $ALE; do
      for V in adv2 tier3; do
        run_arm "$V" "$W" "$G" "$OUTD/${G}_${V}_w${W}_r${R}.json"
      done
    done
  done
  echo "  done threads=$((W*5)) $(date +%H:%M:%S)"
done
echo "PT_DONE $(date)"

echo "== EnvPool: tuned (async+NUMA) and as-shipped (sync1), 7 points, 24 games =="
export LD_LIBRARY_PATH="$AJ/.venv/lib/python3.13/site-packages/PyQt5/Qt5/lib:${LD_LIBRARY_PATH:-}"
cat > "$OUTD/ep_sync_child.py" <<'CHILD'
import sys, time, json
import numpy as np, envpool
env_id, ne, nt = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
kw = {}
if env_id.endswith("-v5"):
    kw = dict(img_height=64, img_width=64, gray_scale=False, stack_num=1, frame_skip=1)
env = envpool.make_gymnasium(env_id, num_envs=ne, num_threads=nt, **kw)
env.reset()
acts = np.random.randint(0, env.action_space.n, size=(64, ne)).astype(np.int32)
for i in range(20):
    env.step(acts[i % 64])
t0, n = time.time(), 0
while time.time() - t0 < 12.0:
    env.step(acts[n % 64]); n += 1
print(json.dumps({"sps": n * ne / (time.time() - t0)}))
CHILD
cat > "$OUTD/ep_async_child.py" <<'CHILD'
import sys, time, json
import numpy as np, envpool
env_id, ne, nt, bs = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
kw = {}
if env_id.endswith("-v5"):
    kw = dict(img_height=64, img_width=64, gray_scale=False, stack_num=1, frame_skip=1)
env = envpool.make_gymnasium(env_id, num_envs=ne, num_threads=nt, batch_size=bs, **kw)
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
K = len(NODES)
OUTD = os.environ["OUTD"]
PYBIN = os.path.abspath(".venv/bin/python")
PG = ["BigfishEasy-v0","BossfightEasy-v0","CaveflyerEasy-v0","ChaserEasy-v0",
      "ClimberEasy-v0","CoinrunEasy-v0","DodgeballEasy-v0","FruitbotEasy-v0",
      "HeistEasy-v0","JumperEasy-v0","LeaperEasy-v0","MazeEasy-v0",
      "MinerEasy-v0","NinjaEasy-v0","PlunderEasy-v0","StarpilotEasy-v0"]
ALE = ["Asteroids-v5","Breakout-v5","Freeway-v5","Frostbite-v5",
       "Pong-v5","Qbert-v5","Seaquest-v5","SpaceInvaders-v5"]
def sync_child(env_id, ne, nt, node=None):
    pre = ["numactl", f"--cpunodebind={node}", f"--membind={node}"] if node is not None else []
    return pre + [PYBIN, f"{OUTD}/ep_sync_child.py", env_id, str(ne), str(nt)]
def run_sync1(env_id, envs, threads):
    try:
        p = subprocess.run(sync_child(env_id, envs, threads), capture_output=True, text=True, timeout=600)
        return round(json.loads(p.stdout.strip().splitlines()[-1])["sps"])
    except Exception:
        return None
def run_shards(env_id, nshards, pe, pt, bind, async_bs=None):
    procs = []
    for i in range(nshards):
        node = (i % K) if bind else None
        if async_bs is None:
            cmd = sync_child(env_id, pe, pt, node)
        else:
            pre = ["numactl", f"--cpunodebind={node}", f"--membind={node}"] if node is not None else []
            cmd = pre + [PYBIN, f"{OUTD}/ep_async_child.py", env_id, str(pe), str(pt), str(async_bs)]
        procs.append(subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True))
    tot, bad = 0.0, 0
    for p in procs:
        o, _ = p.communicate(timeout=600)
        try: tot += json.loads(o.strip().splitlines()[-1])["sps"]
        except Exception: bad += 1
    return round(tot) if bad == 0 else None
rows, OUT = [], f"{OUTD}/envpool_7pt.json"
for T in (5, 10, 20, 30, 40, 60, 80):
    tot_envs = max(K, 2048 * T // 80)
    pe_a, pt_a = max(1, tot_envs // K), max(1, T // K)
    for suite, ids in (("procgen", PG), ("ale", ALE)):
        for env_id in ids:
            row = {"suite": suite, "env_id": env_id, "threads": T,
                   "sync1": run_sync1(env_id, tot_envs, T),
                   "async_numa": run_shards(env_id, K, pe_a, pt_a, bind=True,
                                            async_bs=max(16, pt_a * 3))}
            print(row, flush=True); rows.append(row)
            json.dump(rows, open(OUT, "w"), indent=1)
def geo(v): return math.exp(sum(map(math.log, v)) / len(v)) if v else 0
print("\n=== EnvPool geomeans ===")
for T in (5, 10, 20, 30, 40, 60, 80):
    for suite in ("procgen", "ale"):
        sel = [r for r in rows if r["suite"] == suite and r["threads"] == T]
        for k in ("sync1", "async_numa"):
            v = [r[k] for r in sel if r.get(k)]
            if v: print(f"t{T:<3d} {suite:8s} {k:11s} {geo(v):>12,.0f}  (n={len(v)})", flush=True)
PYEOF
rm -rf "$SHADOW"
echo "TIER3_FIG4A7_DONE $(date)"
