#!/bin/bash -l
#SBATCH -J ep_affinity
#SBATCH -o logs/%x_%j.out
#SBATCH -e logs/%x_%j.err
#SBATCH -p serial_requeue
#SBATCH -C genoa
#SBATCH -N 1
#SBATCH --exclusive
#SBATCH --mem=0
#SBATCH -t 0-01:30
#
# Closes the last documented EnvPool knob: thread_affinity_offset.
# Same node as the final_any matrix (submit -w holy8a24307) so ratios are
# same-silicon with 43543523. Two arms, 24 env ids each:
#   sync1_aff  : 2048 envs, 80 threads, thread_affinity_offset=0
#   async_aff  : K NUMA-domain shards, per-shard thread_affinity_offset
#                (in-pool pinning INSTEAD of numactl; the documented knob)
# DO NOT uv sync analogen-jaxbench/.venv (hand-installed envpool).
set -uo pipefail
cd "${SLURM_SUBMIT_DIR:-$(dirname "$0")}"
mkdir -p logs outputs
PY="$(pwd)/.venv/bin/python"
export LD_LIBRARY_PATH="$(pwd)/.venv/lib/python3.13/site-packages/PyQt5/Qt5/lib:${LD_LIBRARY_PATH:-}"
echo "node=$(hostname)"; lscpu | grep -i "numa node" | head -4
cat > /tmp/ep_aff_child.py <<'CHILD'
import sys, time, json
import numpy as np, envpool
env_id, ne, nt, off = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
bs = int(sys.argv[5]) if len(sys.argv) > 5 else 0
kw = {}
if env_id.endswith("-v5"):
    kw = dict(img_height=64, img_width=64, gray_scale=False, stack_num=1, frame_skip=1)
if bs > 0:
    kw["batch_size"] = bs
env = envpool.make_gymnasium(env_id, num_envs=ne, num_threads=nt,
                             thread_affinity_offset=off, **kw)
na = env.action_space.n
if bs > 0:
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
else:
    env.reset()
    acts = np.random.randint(0, na, size=(64, ne)).astype(np.int32)
    for i in range(20):
        env.step(acts[i % 64])
    t0, n = time.time(), 0
    while time.time() - t0 < 12.0:
        env.step(acts[n % 64]); n += 1
    print(json.dumps({"sps": n * ne / (time.time() - t0)}))
CHILD
"$PY" - <<'PYEOF'
import glob, json, math, os, subprocess
NODES = sorted(int(p.split("node")[-1]) for p in glob.glob("/sys/devices/system/node/node[0-9]*"))
K = len(NODES)
CORES_PER_DOMAIN = os.cpu_count() // K
pe, pt = 2048 // K, 80 // K
BS = max(16, pt * 3)
PYBIN = os.path.abspath(".venv/bin/python")
JOB = os.environ.get("SLURM_JOB_ID", "x")
print(f"domains={K} cores/domain={CORES_PER_DOMAIN} shard envs={pe} threads={pt} bs={BS}", flush=True)
PG = ["BigfishEasy-v0","BossfightEasy-v0","CaveflyerEasy-v0","ChaserEasy-v0",
      "ClimberEasy-v0","CoinrunEasy-v0","DodgeballEasy-v0","FruitbotEasy-v0",
      "HeistEasy-v0","JumperEasy-v0","LeaperEasy-v0","MazeEasy-v0",
      "MinerEasy-v0","NinjaEasy-v0","PlunderEasy-v0","StarpilotEasy-v0"]
ALE = ["Asteroids-v5","Breakout-v5","Freeway-v5","Frostbite-v5",
      "Pong-v5","Qbert-v5","Seaquest-v5","SpaceInvaders-v5"]
rows, OUT = [], f"outputs/ep_affinity_{JOB}.json"
for suite, ids in (("procgen", PG), ("ale", ALE)):
    for env_id in ids:
        row = {"suite": suite, "env_id": env_id}
        p = subprocess.run([PYBIN, "/tmp/ep_aff_child.py", env_id, "2048", "80", "0"],
                           capture_output=True, text=True, timeout=600)
        try: row["sync1_aff"] = round(json.loads(p.stdout.strip().splitlines()[-1])["sps"])
        except Exception: row["sync1_aff"] = None
        procs = [subprocess.Popen(
                    [PYBIN, "/tmp/ep_aff_child.py", env_id, str(pe), str(pt),
                     str(i * CORES_PER_DOMAIN), str(BS)],
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                 for i in range(K)]
        tot, bad = 0.0, 0
        for p2 in procs:
            o, _ = p2.communicate(timeout=600)
            try: tot += json.loads(o.strip().splitlines()[-1])["sps"]
            except Exception: bad += 1
        row["async_aff"] = round(tot) if bad == 0 else None
        print(row, flush=True); rows.append(row)
        json.dump(rows, open(OUT, "w"), indent=1)
def geo(v): return math.exp(sum(map(math.log, v)) / len(v)) if v else 0
for suite in ("procgen", "ale"):
    sel = [r for r in rows if r["suite"] == suite]
    for k in ("sync1_aff", "async_aff"):
        v = [r[k] for r in sel if r.get(k)]
        if v: print(f"GEOMEAN {suite:8s} {k:10s} {geo(v):>12,.0f}  (n={len(v)})", flush=True)
PYEOF
echo AFF_DONE
