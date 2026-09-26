#!/bin/bash -l
#SBATCH -J ale_sweep
#SBATCH -o logs/%x_%j.out
#SBATCH -e logs/%x_%j.err
#SBATCH -p serial_requeue
#SBATCH -C genoa
#SBATCH -N 1
#SBATCH --exclusive
#SBATCH --mem=0
#SBATCH -t 0-02:00
#
# ALE8 thread-sweep add-on to the final_any matrix (43543523). Same node
# (submit -w holy8a24307). Fills the 10/20/40-thread ALE points:
#   PT live/dv at w=2/4/8 (x5 threads), 2 trials
#   EP sync1 + async+numa at 10/20/40 threads
# 80-thread ALE anchors already exist in 43543523.
# DO NOT uv sync analogen-jaxbench/.venv.
set -uo pipefail
BASE=/n/holylabs/gershman_lab/Users/rtruong
AJ=$BASE/analogen-jaxbench
TR=$BASE/playtrain-trainers
WT=$BASE/playtrain-wt-tuning
LIVE=$BASE/playtrain
PY=$AJ/.venv/bin/python
JOB="${SLURM_JOB_ID:-x}"
mkdir -p "$AJ/logs" "$AJ/outputs"
echo "node=$(hostname)"

# ---- PT ALE sweep ----
cd "$TR"
export PYTHONPATH="$TR/src:$WT/src"
export OMP_NUM_THREADS=1
GDIR="$LIVE/examples/games/js"
OUTD="$AJ/outputs/ale_sweep_pt_${JOB}"; mkdir -p "$OUTD"
ALE="asteroids breakout freeway frostbite pong qbert seaquest space_invaders"
for W in 2 4 8; do
  for R in 1 2; do
    for V in live dv; do
      cp "$WT/native/build/variants/libqjs_vec.$V.so" "$WT/native/build/libqjs_vec.so"
      case "$V" in dv*) export QJS_DIRTY=1;; *) unset QJS_DIRTY;; esac
      for G in $ALE; do
        "$PY" benchmarks/bench_vec_rollout.py --game "$G" --games-dir "$GDIR" \
          --no-model --device cpu --frame-skip 1 --steps 300 --max-steps 2000 \
          --envs 128 --workers "$W" --env-threads 5 \
          --out "$OUTD/sweep_${G}_${V}_w${W}_r${R}.json" || echo "RUN_FAIL $G $V w$W t$R"
      done
    done
  done
done
unset QJS_DIRTY
cp "$WT/native/build/variants/libqjs_vec.rv2.so" "$WT/native/build/libqjs_vec.so"
echo "PT_ALE_SWEEP_DONE"

# ---- EP ALE sweep ----
cd "$AJ"
export LD_LIBRARY_PATH="$AJ/.venv/lib/python3.13/site-packages/PyQt5/Qt5/lib:${LD_LIBRARY_PATH:-}"
cat > /tmp/ep_sync_child.py <<'CHILD'
import sys, time, json
import numpy as np, envpool
env_id, ne, nt = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
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
kw = dict(img_height=64, img_width=64, gray_scale=False, stack_num=1, frame_skip=1,
          batch_size=bs)
env = envpool.make_gymnasium(env_id, num_envs=ne, num_threads=nt, **kw)
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
ALE = ["Asteroids-v5","Breakout-v5","Freeway-v5","Frostbite-v5",
      "Pong-v5","Qbert-v5","Seaquest-v5","SpaceInvaders-v5"]
rows, OUT = [], f"outputs/ep_ale_sweep_{JOB}.json"
for T in (10, 20, 40):
    envs = 2048 * T // 80
    pe, pt = envs // K, max(1, T // K)
    BS = max(16, pt * 3)
    for env_id in ALE:
        row = {"suite": "ale", "env_id": env_id, "threads": T}
        p = subprocess.run([PYBIN, "/tmp/ep_sync_child.py", env_id, str(envs), str(T)],
                           capture_output=True, text=True, timeout=600)
        try: row["sync1"] = round(json.loads(p.stdout.strip().splitlines()[-1])["sps"])
        except Exception: row["sync1"] = None
        procs = [subprocess.Popen(
                    ["numactl", f"--cpunodebind={n}", f"--membind={n}",
                     PYBIN, "/tmp/ep_async_child.py", env_id, str(pe), str(pt), str(BS)],
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                 for n in NODES]
        tot, bad = 0.0, 0
        for p2 in procs:
            o, _ = p2.communicate(timeout=600)
            try: tot += json.loads(o.strip().splitlines()[-1])["sps"]
            except Exception: bad += 1
        row["async_numa"] = round(tot) if bad == 0 else None
        print(row, flush=True); rows.append(row)
        json.dump(rows, open(OUT, "w"), indent=1)
def geo(v): return math.exp(sum(map(math.log, v)) / len(v)) if v else 0
for T in (10, 20, 40):
    sel = [r for r in rows if r["threads"] == T]
    for k in ("sync1", "async_numa"):
        v = [r[k] for r in sel if r.get(k)]
        if v: print(f"GEOMEAN t{T:<3d} ale {k:10s} {geo(v):>12,.0f}  (n={len(v)})", flush=True)
PYEOF
echo ALE_SWEEP_DONE
