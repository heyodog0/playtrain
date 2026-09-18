#!/bin/bash -l
#SBATCH -J ep_best_t5fix
#SBATCH -o logs/%x_%j.out
#SBATCH -e logs/%x_%j.err
#SBATCH -p serial_requeue
#SBATCH -C genoa
#SBATCH --mincpus=96
#SBATCH -N 1
#SBATCH --exclusive
#SBATCH --mem=0
#SBATCH -t 0-01:00
#
# FIX for the T=5 point of 44601287. That job split every point across K=2 NUMA
# pools with pt = max(1, T//K), so T=5 gave 2 pools x 2 threads = FOUR threads,
# not five -- EnvPool was under-threaded by 20% at that point only. It shows as
# impossible superlinear growth 5->10 (2.40x ProcGen, 2.48x ALE) and inflates
# our ratio there (1.53x vs 1.28x at ten threads). Every other point is exact:
# t10/20/40/80 reproduce the reused documented-best within 0.5%.
# Here T=5 runs as ONE pool of 5 threads, 128 envs, bs=16, affinity offset 0.
set -uo pipefail
BASE=/n/holylabs/gershman_lab/Users/rtruong
AJ=$BASE/analogen-jaxbench
cd "$AJ" || exit 2
mkdir -p logs outputs
PY="$AJ/.venv/bin/python"
JOB="${SLURM_JOB_ID:-x}"
export LD_LIBRARY_PATH="$AJ/.venv/lib/python3.13/site-packages/PyQt5/Qt5/lib:${LD_LIBRARY_PATH:-}"
OUTD="$AJ/outputs/ep_t5fix_${JOB}"; mkdir -p "$OUTD"
echo "node=$(hostname) job=$JOB"
cp "$AJ/outputs/ep_best_7pt_44601287/ep_aff_child.py" "$OUTD/ep_aff_child.py"
OUTD="$OUTD" "$PY" - <<'PYEOF'
import json, math, os, subprocess
OUTD = os.environ["OUTD"]; PYBIN = os.path.abspath(".venv/bin/python")
PG = ["BigfishEasy-v0","BossfightEasy-v0","CaveflyerEasy-v0","ChaserEasy-v0",
      "ClimberEasy-v0","CoinrunEasy-v0","DodgeballEasy-v0","FruitbotEasy-v0",
      "HeistEasy-v0","JumperEasy-v0","LeaperEasy-v0","MazeEasy-v0",
      "MinerEasy-v0","NinjaEasy-v0","PlunderEasy-v0","StarpilotEasy-v0"]
ALE = ["Asteroids-v5","Breakout-v5","Freeway-v5","Frostbite-v5",
       "Pong-v5","Qbert-v5","Seaquest-v5","SpaceInvaders-v5"]
rows, OUT = [], f"{OUTD}/ep_t5.json"
T, ENVS, NT, BS = 5, 128, 5, 16     # ONE pool, five real threads
print(f"T={T} single pool envs={ENVS} threads={NT} bs={BS}", flush=True)
for suite, ids in (("procgen", PG), ("ale", ALE)):
    for env_id in ids:
        p = subprocess.run([PYBIN, f"{OUTD}/ep_aff_child.py", env_id,
                            str(ENVS), str(NT), "0", str(BS)],
                           capture_output=True, text=True, timeout=600)
        try: v = round(json.loads(p.stdout.strip().splitlines()[-1])["sps"])
        except Exception: v = None
        rows.append({"suite": suite, "env_id": env_id, "threads": T, "best_aff": v})
        json.dump(rows, open(OUT, "w"), indent=1)
def geo(v): return math.exp(sum(map(math.log, v)) / len(v)) if v else 0
for suite in ("procgen", "ale"):
    v = [r["best_aff"] for r in rows if r["suite"] == suite and r.get("best_aff")]
    print(f"t5 {suite:8s} single-pool {geo(v):>12,.0f}  (n={len(v)})", flush=True)
PYEOF
echo "EP_T5FIX_DONE $(date)"
