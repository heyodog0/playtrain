#!/bin/bash -l
#SBATCH -J final_any
#SBATCH -o logs/%x_%j.out
#SBATCH -e logs/%x_%j.err
#SBATCH -p serial_requeue
#SBATCH -C genoa
#SBATCH -N 1
#SBATCH --exclusive
#SBATCH --mem=0
#SBATCH -t 0-08:00
#
# The ANY-NODE superset: every paper-pass number measured on ONE node in ONE
# job, so all ratios and curves are same-silicon by construction. Supersedes
# the pinned 17402 pair (43246914 + 43542348) if it lands first; those stay
# queued as a free published-node tie-in.
#   PT arms : live / rv2 / dv at published topology (16w x 128e x 5t),
#             all 24 games, 3 interleaved trials (t11_full methodology).
#             dv runs with QJS_DIRTY=1.
#   EP arms : sync1, sync16, sync16n, async+NUMA at 80 threads (24 games);
#             thread sweeps 10/20/40/80 on ProcGen16 for sync1 / sync16n /
#             async+NUMA. PT dv+live sweep 10/20/40/80 too (Fig 4A curves).
# Submit with: sbatch final_any.sbatch
# DO NOT uv sync analogen-jaxbench/.venv (hand-installed envpool).
set -uo pipefail
BASE=/n/holylabs/gershman_lab/Users/rtruong
AJ=$BASE/analogen-jaxbench
TR=$BASE/playtrain-trainers
WT=$BASE/playtrain-wt-tuning
LIVE=$BASE/playtrain
PY=$AJ/.venv/bin/python
JOB="${SLURM_JOB_ID:-x}"
mkdir -p "$AJ/logs" "$AJ/outputs"
echo "node=$(hostname)"; uname -r
lscpu | grep -iE "model name|numa node" | head -4

# ---------------- Part 1: PlayTrain live / rv2 / dv ----------------
cd "$TR"
export PYTHONPATH="$TR/src:$WT/src"
export OMP_NUM_THREADS=1
echo "live .so (untouched): $(md5sum $LIVE/native/build/libqjs_vec.so)"
md5sum "$WT"/native/build/variants/libqjs_vec.{live,rv2,dv}.so
GDIR="$LIVE/examples/games/js"
OUTD="$AJ/outputs/final_any_pt_${JOB}"; mkdir -p "$OUTD"
PROCGEN="bigfish bossfight caveflyer chaser climber coinrun dodgeball fruitbot heist jumper leaper maze miner ninja plunder starpilot"
ALE="asteroids breakout freeway frostbite pong qbert seaquest space_invaders"
for G in $PROCGEN $ALE; do
  for R in 1 2 3; do
    for V in live rv2 dv; do
      cp "$WT/native/build/variants/libqjs_vec.$V.so" "$WT/native/build/libqjs_vec.so"
      case "$V" in dv*) export QJS_DIRTY=1;; *) unset QJS_DIRTY;; esac
      echo; echo "=== $G t$R $V $(md5sum "$WT/native/build/libqjs_vec.so" | cut -d' ' -f1) dirty=${QJS_DIRTY:-0}"
      "$PY" benchmarks/bench_vec_rollout.py --game "$G" --games-dir "$GDIR" \
        --no-model --device cpu --frame-skip 1 --steps 300 --max-steps 2000 \
        --envs 128 --workers 16 --env-threads 5 \
        --out "$OUTD/${G}_${V}_r${R}.json" || echo "RUN_FAIL $G $V t$R"
    done
  done
done
# --- PT thread sweep (Fig 4A curve): dv + live, ProcGen16, 2 trials/point ---
for W in 2 4 8 16; do
  for R in 1 2; do
    for V in live dv; do
      cp "$WT/native/build/variants/libqjs_vec.$V.so" "$WT/native/build/libqjs_vec.so"
      case "$V" in dv*) export QJS_DIRTY=1;; *) unset QJS_DIRTY;; esac
      for G in $PROCGEN; do
        "$PY" benchmarks/bench_vec_rollout.py --game "$G" --games-dir "$GDIR"           --no-model --device cpu --frame-skip 1 --steps 300 --max-steps 2000           --envs 128 --workers "$W" --env-threads 5           --out "$OUTD/sweep_${G}_${V}_w${W}_r${R}.json" || echo "RUN_FAIL sweep $G $V w$W t$R"
      done
    done
  done
done
unset QJS_DIRTY
cp "$WT/native/build/variants/libqjs_vec.rv2.so" "$WT/native/build/libqjs_vec.so"
echo "PT_DONE outputs in $OUTD"

# ---------------- Part 2: EnvPool re-anchors ----------------
cd "$AJ"
export LD_LIBRARY_PATH="$AJ/.venv/lib/python3.13/site-packages/PyQt5/Qt5/lib:${LD_LIBRARY_PATH:-}"
cat > /tmp/ep_sync_child.py <<'CHILD'
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
cat > /tmp/ep_async_child.py <<'CHILD'
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
"$PY" - <<'PYEOF'
import glob, json, math, os, subprocess
NODES = sorted(int(p.split("node")[-1]) for p in glob.glob("/sys/devices/system/node/node[0-9]*"))
K = len(NODES)
PYBIN = os.path.abspath(".venv/bin/python")
JOB = os.environ.get("SLURM_JOB_ID", "x")
PG = ["BigfishEasy-v0","BossfightEasy-v0","CaveflyerEasy-v0","ChaserEasy-v0",
      "ClimberEasy-v0","CoinrunEasy-v0","DodgeballEasy-v0","FruitbotEasy-v0",
      "HeistEasy-v0","JumperEasy-v0","LeaperEasy-v0","MazeEasy-v0",
      "MinerEasy-v0","NinjaEasy-v0","PlunderEasy-v0","StarpilotEasy-v0"]
ALE = ["Asteroids-v5","Breakout-v5","Freeway-v5","Frostbite-v5",
      "Pong-v5","Qbert-v5","Seaquest-v5","SpaceInvaders-v5"]
def sync_child(env_id, ne, nt, node=None):
    pre = ["numactl", f"--cpunodebind={node}", f"--membind={node}"] if node is not None else []
    return pre + [PYBIN, "/tmp/ep_sync_child.py", env_id, str(ne), str(nt)]
def run_sync1(env_id, envs, threads):
    p = subprocess.run(sync_child(env_id, envs, threads), capture_output=True, text=True, timeout=600)
    try: return round(json.loads(p.stdout.strip().splitlines()[-1])["sps"])
    except Exception: return None
def run_shards(env_id, nshards, pe, pt, bind, async_bs=None):
    procs = []
    for i in range(nshards):
        node = (i % K) if bind else None
        if async_bs is None:
            cmd = sync_child(env_id, pe, pt, node)
        else:
            pre = ["numactl", f"--cpunodebind={node}", f"--membind={node}"] if node is not None else []
            cmd = pre + [PYBIN, "/tmp/ep_async_child.py", env_id, str(pe), str(pt), str(async_bs)]
        procs.append(subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True))
    tot, bad = 0.0, 0
    for p in procs:
        o, _ = p.communicate(timeout=600)
        try: tot += json.loads(o.strip().splitlines()[-1])["sps"]
        except Exception: bad += 1
    return round(tot) if bad == 0 else None
def arms80(env_id):
    pe, pt = 2048 // K, 80 // K
    return {
        "sync1":      run_sync1(env_id, 2048, 80),
        "sync16":     run_shards(env_id, 16, 128, 5, bind=False),
        "sync16n":    run_shards(env_id, 16, 128, 5, bind=True),
        "async_numa": run_shards(env_id, K, pe, pt, bind=True, async_bs=max(16, pt * 3)),
    }
rows, OUT = [], f"outputs/ep_final_any_{JOB}.json"
for suite, ids in (("procgen", PG), ("ale", ALE)):
    for env_id in ids:
        row = {"suite": suite, "env_id": env_id, "threads": 80, **arms80(env_id)}
        print(row, flush=True); rows.append(row)
        json.dump(rows, open(OUT, "w"), indent=1)
# thread sweeps, ProcGen16 only: sync1 / sync16n / async+numa at 10,20,40 (80 above)
for T in (10, 20, 40):
    nsh = max(2, T // 5)
    pe_s, pt_s = 2048 * T // 80 // nsh, 5
    pe_a, pt_a = 2048 * T // 80 // K, T // K
    for env_id in PG:
        row = {"suite": "procgen", "env_id": env_id, "threads": T,
               "sync1":      run_sync1(env_id, 2048 * T // 80, T),
               "sync16n":    run_shards(env_id, nsh, pe_s, pt_s, bind=True),
               "async_numa": run_shards(env_id, K, pe_a, max(1, pt_a), bind=True,
                                        async_bs=max(16, max(1, pt_a) * 3))}
        print(row, flush=True); rows.append(row)
        json.dump(rows, open(OUT, "w"), indent=1)
def geo(v): return math.exp(sum(map(math.log, v)) / len(v)) if v else 0
for T in (80, 40, 20, 10):
    for suite in ("procgen", "ale"):
        sel = [r for r in rows if r["suite"] == suite and r["threads"] == T]
        for k in ("sync1", "sync16", "sync16n", "async_numa"):
            v = [r[k] for r in sel if r.get(k)]
            if v: print(f"GEOMEAN t{T:<3d} {suite:8s} {k:10s} {geo(v):>12,.0f}  (n={len(v)})", flush=True)
PYEOF
echo ALL_DONE
