#!/bin/bash -l
#SBATCH -J nodegym-directvec
#SBATCH -p test
#SBATCH -c 16
#SBATCH --mem=16G
#SBATCH -t 0-00:30
#SBATCH -o logs/directvec_%j.out
#SBATCH -e logs/directvec_%j.err
# DirectVecEnv (NodeVecEnv) vs hand-rolled SubprocVecEnv A/B on FASRC.
#
# Mac bench (500 steps + 50 warmup) showed a strong delta:
#   game        N    SubprocVecEnv  →  NodeVecEnv      Δ%      μs saved
#   flappy_bird 8    25,512 sps        66,295 sps      +160%   ~193
#   grid_v4     4    13,343 sps        20,121 sps      +51%    ~101
#   grid_v4     8    18,531 sps        33,462 sps      +81%    ~193
#   grid_v4     16   19,997 sps        35,730 sps      +79%    ~352
#   grid_v1     8    15,751 sps        25,611 sps      +63%    ~196
#
# Coordination overhead is roughly 24 μs × N for SubprocVecEnv on Mac (one
# pickle round-trip per child Python proc). Linux IPC is faster, so the
# absolute delta is likely smaller. This probe measures the actual delta on
# the hardware analogen trains on.
#
# Sweeps N=4, 8, 16 across:
#   - flappy_bird (light env, baseline)
#   - analogen_nomemory_grid_v4 (heavy env, analogen's actual training env;
#     only runs if ANALOGEN_GAMES_DIR is set or the default path exists)
#
# Resource notes:
#   -c 16   : enough cores to host SubprocVecEnv N=16 without oversubscribing
#             (16 child Python procs + 16 Node procs). Per-env contention
#             confounds a coordination-overhead measurement.
#   --mem=16G : each Node worker is ~70 MB resident; child Python ~30 MB.
#               Peak ≈ 16 × (70+30) MB = 1.6 GB. Comfortable.
#   -t 30min : each (game × N) run ~10–30s; sweep <10 min total.
#
# Usage:
#   sbatch tools/probe_directvec_bench.sbatch
#   ANALOGEN_GAMES_DIR=/path/to/analogen/games/js sbatch tools/probe_directvec_bench.sbatch
#   # Local dry-run (no SLURM):
#   ./tools/probe_directvec_bench.sbatch

set -u
cd "${SLURM_SUBMIT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
mkdir -p logs

# ── Node bringup (mirrors probe_cairo_high_n.sbatch) ──────────────────────
# Try module load first; on the FASRC test partition the modules are often
# missing, so $HOME/.local-node/bin is the real fallback that works.
if ! command -v node >/dev/null 2>&1; then
  module load nodejs/22.9.0-fasrc01 2>/dev/null \
    || module load nodejs/20.10.0-fasrc01 2>/dev/null \
    || module load nodejs/18.18.2-fasrc01 2>/dev/null \
    || module load nodejs 2>/dev/null || true
fi
[ -d "$HOME/.local-node/bin" ] && export PATH="$HOME/.local-node/bin:$PATH"
export PATH="$HOME/.local/bin:$PATH"
command -v node >/dev/null || { echo "ERROR: node not on PATH" >&2; exit 1; }
echo "==> Using node: $(command -v node)  ($(node --version))"

# node_modules — install if missing (matches probe_cairo_high_n.sbatch).
if [ ! -d "node_modules/canvas" ]; then
  command -v pnpm >/dev/null && pnpm install --prefer-offline || npm install
fi

# Python venv resolution. Prefer uv (matches analogen's throughput_compare.sh).
# Fall back to .venv if present, then to system python3.
if command -v uv >/dev/null 2>&1; then
  # Make sure deps are present (numpy, gymnasium) — node-gym's pyproject covers it.
  uv sync 2>/dev/null || true
  PY="uv run python"
elif [ -x ".venv/bin/python" ]; then
  PY=".venv/bin/python"
else
  PY="python3"
fi
echo "==> Using Python: $PY"
$PY -c "import numpy, gymnasium; print(f'  numpy={numpy.__version__} gymnasium={gymnasium.__version__}')"

JOB_TAG="${SLURM_JOB_ID:-local}"
SUMMARY="logs/directvec_summary_${JOB_TAG}.tsv"
echo -e "game\tn\tarm\tagg_sps\tmean_step_us\tp95_us" > "$SUMMARY"

# Default analogen games path on FASRC (override with ANALOGEN_GAMES_DIR env var)
DEFAULT_ANALOGEN_DIR="/n/holylabs/gershman_lab/Users/rtruong/analogen/games/js"
ANALOGEN_GAMES_DIR="${ANALOGEN_GAMES_DIR:-$DEFAULT_ANALOGEN_DIR}"

run_one () {
  local game="$1" n="$2" games_dir="$3"
  local out_file="logs/directvec_${game}_n${n}_${JOB_TAG}.out"
  echo
  echo "════════════════════════════════════════════════════════════════"
  echo " ${game}  N=${n}  (games_dir=${games_dir})"
  echo "════════════════════════════════════════════════════════════════"
  NODE_GYM_GAMES_DIR="$games_dir" $PY tools/probe_directvec_bench.py \
    --n "$n" --game "$game" --steps 500 --warmup 50 \
    2>&1 | tee "$out_file"

  # Parse SubprocVecEnv + NodeVecEnv lines into the TSV summary.
  # Use python -c (not heredoc) — matches throughput_compare.sh pattern;
  # tmp dir on FASRC nodes is sometimes full mid-job.
  $PY -c "
import re, sys
text = open('${out_file}').read()
def parse(prefix):
    for line in text.splitlines():
        if line.strip().startswith(prefix):
            m = re.search(r'agg\s+(\d+)\s+sps.*mean\s+(\d+)\s+μs.*p95\s+(\d+)', line)
            if m:
                return m.groups()
    return (None, None, None)
sub = parse('SubprocVecEnv')
direct = parse('NodeVecEnv')
with open('${SUMMARY}', 'a') as f:
    if sub[0]:    f.write('${game}\t${n}\tSubprocVecEnv\t' + '\t'.join(sub) + '\n')
    if direct[0]: f.write('${game}\t${n}\tNodeVecEnv\t' + '\t'.join(direct) + '\n')
"
}

# ── Bundled-game arm (always runs) ────────────────────────────────────────
for n in 4 8 16; do
  run_one "flappy_bird" "$n" "examples/games/js"
done

# ── Analogen-game arm (only if games dir present) ─────────────────────────
if [ -d "$ANALOGEN_GAMES_DIR" ]; then
  echo
  echo "==> Found analogen games at $ANALOGEN_GAMES_DIR — running grid_v4 arm"
  for n in 4 8 16; do
    run_one "analogen_nomemory_grid_v4" "$n" "$ANALOGEN_GAMES_DIR"
  done
else
  echo
  echo "NOTE: analogen games dir not found at $ANALOGEN_GAMES_DIR"
  echo "      Skipping grid_v4 arm. Set ANALOGEN_GAMES_DIR to enable."
fi

# ── Final summary ──────────────────────────────────────────────────────────
echo
echo "════════════════════════════════════════════════════════════════"
echo " A/B summary (job ${JOB_TAG})"
echo "════════════════════════════════════════════════════════════════"
if command -v column >/dev/null 2>&1; then
  column -t -s $'\t' "$SUMMARY"
else
  cat "$SUMMARY"
fi

echo
echo "Mac reference (for comparison):"
echo "  flappy_bird N=8 :  SubprocVecEnv 25,512 sps  →  NodeVecEnv 66,295 sps  (+160%)"
echo "  grid_v4     N=8 :  SubprocVecEnv 18,531 sps  →  NodeVecEnv 33,462 sps  (+81%)"
echo
echo "Decision criteria:"
echo "  - If FASRC delta >30% on grid_v4 N=8 → ship NodeVecEnv to analogen"
echo "  - If FASRC delta <10%                → SubprocVecEnv overhead was a Mac"
echo "                                          artifact; NodeVecEnv not worth the"
echo "                                          API surface for this hardware."
echo "  - In between                         → run training-loop A/B before deciding."
