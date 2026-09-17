#!/bin/bash -l
#SBATCH -J ep_best_sweep
#SBATCH -o logs/%x_%j.out
#SBATCH -e logs/%x_%j.err
#SBATCH -p serial_requeue
#SBATCH -C genoa
#SBATCH -N 1
#SBATCH --exclusive
#SBATCH --mem=0
#SBATCH -t 0-01:30
#
# Fig-4A curve for the FINAL EnvPool documented-best config:
# async + one pool per NUMA domain + in-pool thread affinity + bs=3x threads.
# 10/20/40 threads, ProcGen16 + ALE8 (the 80th points exist: 1.414M / 351k,
# job 43570992). Submit -w holy8a24307 for same-silicon with the matrix.
# DO NOT uv sync analogen-jaxbench/.venv.
set -uo pipefail
cd "${SLURM_SUBMIT_DIR:-$(dirname "$0")}"
mkdir -p logs outputs
PY="$(pwd)/.venv/bin/python"
export LD_LIBRARY_PATH="$(pwd)/.venv/lib/python3.13/site-packages/PyQt5/Qt5/lib:${LD_LIBRARY_PATH:-}"
echo "node=$(hostname)"
cat > /tmp/ep_aff_child.py <<'CHILD'
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
"$PY" - <<'PYEOF'
import glob, json, math, os, subprocess
NODES = sorted(int(p.split("node")[-1]) for p in glob.glob("/sys/devices/system/node/node[0-9]*"))
K = len(NODES)
CPD = os.cpu_count() // K
PYBIN = os.path.abspath(".venv/bin/python")
JOB = os.environ.get("SLURM_JOB_ID", "x")
PG = ["BigfishEasy-v0","BossfightEasy-v0","CaveflyerEasy-v0","ChaserEasy-v0",
      "ClimberEasy-v0","CoinrunEasy-v0","DodgeballEasy-v0","FruitbotEasy-v0",
      "HeistEasy-v0","JumperEasy-v0","LeaperEasy-v0","MazeEasy-v0",
      "MinerEasy-v0","NinjaEasy-v0","PlunderEasy-v0","StarpilotEasy-v0"]
ALE = ["Asteroids-v5","Breakout-v5","Freeway-v5","Frostbite-v5",
      "Pong-v5","Qbert-v5","Seaquest-v5","SpaceInvaders-v5"]
rows, OUT = [], f"outputs/ep_best_sweep_{JOB}.json"
for T in (10, 20, 40):
    envs = 2048 * T // 80
    pe, pt = envs // K, max(1, T // K)
    BS = max(16, pt * 3)
    for suite, ids in (("procgen", PG), ("ale", ALE)):
        for env_id in ids:
            procs = [subprocess.Popen(
                        [PYBIN, "/tmp/ep_aff_child.py", env_id, str(pe), str(pt),
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
            print(row, flush=True); rows.append(row)
            json.dump(rows, open(OUT, "w"), indent=1)
def geo(v): return math.exp(sum(map(math.log, v)) / len(v)) if v else 0
for T in (10, 20, 40):
    for suite in ("procgen", "ale"):
        v = [r["best_aff"] for r in rows if r["suite"] == suite and r["threads"] == T and r.get("best_aff")]
        if v: print(f"GEOMEAN t{T:<3d} {suite:8s} best_aff {geo(v):>12,.0f}  (n={len(v)})", flush=True)
PYEOF
echo BEST_SWEEP_DONE
