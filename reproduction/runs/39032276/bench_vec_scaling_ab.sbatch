#!/bin/bash -l
#SBATCH -J bench_vec_scaling_ab
#SBATCH -o logs/%x_%j.out
#SBATCH -e logs/%x_%j.err
#SBATCH -p kempner_h100
#SBATCH -A kempner_gershman_lab
#SBATCH -N 1
#SBATCH -c 92
#SBATCH --gres=gpu:4
#SBATCH --mem=200G
#SBATCH -t 0-03:00
#
# Matched worker-scaling curve: PlayTrain vs the original ProcGen C++ through
# EnvPool, both arms in ONE job on ONE node.
#
# WHY ONE JOB: kempner_h100 nodes differ by up to 1.56x in clock (holygpu8a134xx
# ~2.35 GHz vs 17xxx ~3.8 GHz). Ratios survive that; absolute numbers do not. Two
# arms in two jobs can land on different nodes and the comparison is then
# meaningless. Pin with --nodelist=holygpu8a17201 (or any 17xxx) for a figure
# that goes in the paper.
#
# WHAT IS MATCHED:
#   games        the 16 ProcGen games only -- EnvPool has no CHIP-8, no generated
#                games, so a 24-game geomean against a 16-game one compares
#                different work.
#   observation  64x64x3 RGB both sides.
#   axis         env threads, not "workers". PlayTrain runs w workers x 5 env
#                threads; EnvPool runs one C++ pool of num_threads. The shared
#                quantity is threads, so both sweep 5w for w in the worker list.
#   env count    PlayTrain holds 128 envs/worker, so total = 128w. EnvPool is
#                given num_envs=128w at num_threads=5w.
#
# env-only on both sides (--no-model): this isolates stepping, no learner, no
# inference, no GPU contention. GPUs are requested only because the partition
# refuses more than 23 cores per GPU.
#
# DO NOT run `uv sync` against analogen-jaxbench/.venv -- envpool and PyQt5 are
# hand-installed there and are in no lockfile. A sync prunes both silently.
#
# Submit:  sbatch --nodelist=holygpu8a17201 benchmarks/bench_vec_scaling_ab.sbatch

set -uo pipefail
cd "${SLURM_SUBMIT_DIR:-$(dirname "$0")/..}"
mkdir -p logs outputs results

GAMES_DIR="$(cd ../playtrain 2>/dev/null && pwd)/examples/games/js"
# SUITE=procgen (default) or SUITE=ale. Submit the Atari arm with
#   sbatch --export=ALL,SUITE=ale --nodelist=<same node> benchmarks/bench_vec_scaling_ab.sbatch
SUITE="${SUITE:-procgen}"
if [ "$SUITE" = "ale" ]; then
  # The 8 Atari games, PlayTrain name and EnvPool id, index-matched.
  PT_GAMES="asteroids breakout freeway frostbite pong qbert seaquest space_invaders"
  EP_IDS="Asteroids-v5 Breakout-v5 Freeway-v5 Frostbite-v5 Pong-v5 Qbert-v5 Seaquest-v5 SpaceInvaders-v5"
  # EnvPool's Atari defaults are 84x84 GRAYSCALE, stack 4, frame_skip 4. Left
  # alone they make the EnvPool arm look 4x faster and compare different
  # observations. Match PlayTrain exactly: 64x64 RGB, one frame per step.
  EP_KWARGS='{"img_height": 64, "img_width": 64, "gray_scale": false, "stack_num": 1, "frame_skip": 1}'
else
  # The 16 ProcGen games, PlayTrain name and EnvPool id, index-matched.
  PT_GAMES="bigfish bossfight caveflyer chaser climber coinrun dodgeball fruitbot heist jumper leaper maze miner ninja plunder starpilot"
  EP_IDS="BigfishEasy-v0 BossfightEasy-v0 CaveflyerEasy-v0 ChaserEasy-v0 ClimberEasy-v0 CoinrunEasy-v0 DodgeballEasy-v0 FruitbotEasy-v0 HeistEasy-v0 JumperEasy-v0 LeaperEasy-v0 MazeEasy-v0 MinerEasy-v0 NinjaEasy-v0 PlunderEasy-v0 StarpilotEasy-v0"
  # ProcGen through EnvPool is already 64x64x3, one frame per step.
  EP_KWARGS='{}'
fi

WORKERS="${WORKERS:-1,2,4,6,8,12,16}"
ENVS="${ENVS:-128}"
ENV_THREADS="${ENV_THREADS:-5}"
FRAME_SKIP="${FRAME_SKIP:-1}"
STEPS="${STEPS:-300}"
MAX_STEPS="${MAX_STEPS:-2000}"
MEASURE_S="${MEASURE_S:-12}"

export PATH="$HOME/.local/bin:$PATH"
module load cuda/12.4.1-fasrc01 2>/dev/null || module load cuda 2>/dev/null || true

REPO="$(pwd)"
: "${VENV:=$(cd .. && pwd)/analogen-jaxbench/.venv}"
PY="$VENV/bin/python"
[ -x "$PY" ] || { echo "ERROR: no venv at $VENV" >&2; exit 2; }
export PYTHONPATH="$REPO/src:$(cd ../playtrain 2>/dev/null && pwd)/src:${PYTHONPATH:-}"
export LD_LIBRARY_PATH="$VENV/lib/python3.13/site-packages/PyQt5/Qt5/lib:${LD_LIBRARY_PATH:-}"

J="${SLURM_JOB_ID:-local}"
echo "node=$(hostname)  workers=$WORKERS  envs/worker=$ENVS  env_threads=$ENV_THREADS"
echo "clock: $(lscpu | grep -i 'CPU max MHz' || true)"
echo

# Fail early rather than after an hour of PlayTrain runs.
"$PY" -c "import envpool; print('envpool', envpool.__version__)" || {
  echo "ERROR: envpool missing from $VENV." >&2
  echo "  fix: uv pip install --python $PY envpool PyQt5" >&2
  exit 2; }
echo

echo "########## ARM A: PlayTrain ##########"
for G in $PT_GAMES; do
  GJS="$GAMES_DIR/$G.js"
  [ -f "$GJS" ] || { echo "SKIP $G (no $GJS)"; continue; }
  echo "##### $G"
  "$PY" benchmarks/bench_vec_rollout.py --game "$GJS" \
      --workers "$WORKERS" --envs "$ENVS" --env-threads "$ENV_THREADS" \
      --frame-skip "$FRAME_SKIP" --steps "$STEPS" --max-steps "$MAX_STEPS" \
      --no-model --out "results/ab_pt_${G}_${J}.json" 2>&1 | tail -3
done

echo
echo "########## ARM B: original ProcGen C++ through EnvPool ##########"
WORKERS="$WORKERS" ENVS="$ENVS" ENV_THREADS="$ENV_THREADS" \
MEASURE_S="$MEASURE_S" EP_IDS="$EP_IDS" EP_KWARGS="$EP_KWARGS" J="$J" "$PY" - <<'PYEOF'
import json, os, re, time
import numpy as np
import envpool

workers = [int(x) for x in os.environ["WORKERS"].split(",")]
envs_per_w = int(os.environ["ENVS"])
threads_per_w = int(os.environ["ENV_THREADS"])
measure_s = float(os.environ["MEASURE_S"])
job = os.environ["J"]
# Suite-specific env construction kwargs (Atari needs its observation
# format forced to PlayTrain's; ProcGen already matches).
extra = json.loads(os.environ.get("EP_KWARGS") or "{}")

for env_id in os.environ["EP_IDS"].split():
    rows = []
    for w in workers:
        n_envs, n_threads = envs_per_w * w, threads_per_w * w
        try:
            env = envpool.make_gymnasium(env_id, num_envs=n_envs,
                                         num_threads=n_threads, **extra)
            env.reset()
            acts = np.random.randint(0, env.action_space.n,
                                     size=(64, n_envs)).astype(np.int32)
            for i in range(20):                      # warmup
                env.step(acts[i % 64])
            t0, n = time.time(), 0
            while time.time() - t0 < measure_s:
                env.step(acts[n % 64]); n += 1
            dps = n * n_envs / (time.time() - t0)
            env.close()
            rows.append(dict(workers=w, envs=n_envs, threads=n_threads,
                             decisions_per_s=round(dps)))
            print(f"ENVPOOL {env_id} w={w:>2} threads={n_threads:>2} "
                  f"envs={n_envs:>4}: {dps:,.0f} env-steps/s", flush=True)
        except Exception as e:
            print(f"ENVPOOL {env_id} w={w}: FAILED {repr(e)[:140]}", flush=True)
    if rows:
        base = env_id.replace("Easy-v0", "").split("-v")[0]
        game = re.sub(r"(?<!^)(?=[A-Z])", "_", base).lower()
        with open(f"results/ab_ep_{game}_{job}.json", "w") as f:
            json.dump(rows, f, indent=2)
PYEOF

echo
echo "=== matched summary (geomean over the shared games) ==="
"$PY" - "$J" <<'PYEOF'
import glob, json, math, os, sys
J = sys.argv[1]
def load(prefix):
    per_w = {}
    for f in glob.glob(f"results/ab_{prefix}_*_{J}.json"):
        g = os.path.basename(f)[len(f"ab_{prefix}_"):-len(f"_{J}.json")]
        for r in json.load(open(f)):
            per_w.setdefault(r["workers"], {})[g] = r["decisions_per_s"]
    return per_w
pt, ep = load("pt"), load("ep")
geo = lambda v: math.exp(sum(map(math.log, v)) / len(v))
print(f"{'w':>3} {'threads':>8} {'PlayTrain':>12} {'EnvPool':>12} {'ratio':>7} "
      f"{'PT eff':>7} {'EP eff':>7}   n")
b_pt = b_ep = None
for w in sorted(set(pt) & set(ep)):
    shared = sorted(set(pt[w]) & set(ep[w]))
    if not shared:
        continue
    a = geo([pt[w][g] for g in shared]); b = geo([ep[w][g] for g in shared])
    if b_pt is None: b_pt, b_ep = a, b
    print(f"{w:>3} {w*5:>8} {a:>12,.0f} {b:>12,.0f} {a/b:>6.2f}x "
          f"{a/b_pt/w:>6.0%} {b/b_ep/w:>6.0%}   {len(shared)}")
PYEOF
echo DONE
