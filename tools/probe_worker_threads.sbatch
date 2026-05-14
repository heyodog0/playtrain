#!/bin/bash -l
#SBATCH -J nodegym-wt-probe
#SBATCH -p test
#SBATCH -c 24
#SBATCH --mem=16G
#SBATCH -t 0-00:20
#SBATCH -o logs/wt_probe_%j.out
#SBATCH -e logs/wt_probe_%j.err
# Compute notes:
#   -p test  : CPU-only partition; the probe doesn't need a GPU and CPU
#              queues drain faster. If `test` isn't available, override
#              with `sbatch -p shared probe_worker_threads.sbatch`.
#   -c 24    : enough physical cores to bench N up to ~24 without
#              thread-vs-core oversubscription. The probe is bound by
#              the slowest thread in the barrier, so even one shared
#              core under load destroys the efficiency number.
#   --mem=16G: each Worker Thread holds a V8 isolate + node-canvas
#              instance (~40–60 MB). At N=24 that's ~1.5 GB worker-side
#              plus the main-process Cairo/V8 baseline. 16G is comfy.
#   -t 20min : the actual probe is ~2–3 minutes wall. The cap is for
#              queue + module-load slop. Override with `-t 0-00:45` if
#              you're sweeping a larger thread list.
#
# Phase 0 of the Worker-Threads multi-env runtime (docs/WORKER_THREADS_MULTI_ENV.md):
# does node-canvas's Cairo binding actually parallelize across Node Worker
# Threads on FASRC's Linux/Xeon-EPYC cores? Apple Silicon showed a clean
# 91% at N=2 then degraded fast (likely P/E-core spillover). Linux uniform
# cores should scale further. We need this number before committing to
# Phase 1.
#
# Usage:
#   sbatch tools/probe_worker_threads.sbatch
#   sbatch tools/probe_worker_threads.sbatch --iters 5000 --threads 1,2,4,8,16
#   ITERS=2000 THREADS="1,4,8,16" sbatch tools/probe_worker_threads.sbatch
#
# Interactive (no SLURM, on a login or interactive shell that's already set up):
#   ./tools/probe_worker_threads.sbatch

set -euo pipefail
cd "${SLURM_SUBMIT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
mkdir -p logs

# ── CLI / env overrides ────────────────────────────────────────────────────
# Two layers of overrides, both optional:
#   1. positional CLI args (passed via `sbatch script.sbatch ARGS...`)
#   2. env vars (ITERS, THREADS) — convenient for one-off tweaks
ITERS_DEFAULT="${ITERS:-3000}"
THREADS_DEFAULT="${THREADS:-1,2,4,8,16,24}"

# If the user passed --iters/--threads via the CLI, those win; else fall
# back to env-var defaults above.
ARGS=("$@")
HAS_ITERS=0
HAS_THREADS=0
for a in "${ARGS[@]}"; do
  case "$a" in
    --iters) HAS_ITERS=1 ;;
    --threads) HAS_THREADS=1 ;;
  esac
done
if [ "$HAS_ITERS" -eq 0 ]; then ARGS+=(--iters "$ITERS_DEFAULT"); fi
if [ "$HAS_THREADS" -eq 0 ]; then ARGS+=(--threads "$THREADS_DEFAULT"); fi

# ── Modules (mirror analogen/throughput_compare.sh) ────────────────────────
if ! command -v node >/dev/null 2>&1; then
  module load nodejs/22.9.0-fasrc01 2>/dev/null \
    || module load nodejs/20.10.0-fasrc01 2>/dev/null \
    || module load nodejs/18.18.2-fasrc01 2>/dev/null \
    || module load nodejs 2>/dev/null \
    || true
fi
# Portable Node fallback path that setup_fasrc.sh writes binaries into.
[ -d "$HOME/.local-node/bin" ] && export PATH="$HOME/.local-node/bin:$PATH"
export PATH="$HOME/.local/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node not on PATH. Run setup_fasrc.sh on the login node first." >&2
  exit 1
fi
echo "node: $(node --version) at $(command -v node)"

# ── Install JS deps if needed ──────────────────────────────────────────────
# node-canvas builds against system cairo on first install (~30s on Linux).
# Worktrees don't share node_modules with the sibling node-gym checkout, so
# the dev worktree needs its own install on first probe run.
if [ ! -d node_modules ]; then
  echo "==> pnpm install (first run; builds node-canvas natively)"
  if command -v pnpm >/dev/null 2>&1; then
    pnpm install --prefer-offline
  else
    echo "WARN: pnpm not on PATH; falling back to npm"
    npm install
  fi
else
  echo "node_modules present (skip install)"
fi

# ── Run probe ──────────────────────────────────────────────────────────────
JOB_TAG="${SLURM_JOB_ID:-local}"
OUT="logs/wt_probe_${JOB_TAG}.log"

echo
echo "=== Worker-Threads probe (job ${JOB_TAG}) ==="
echo "CPU info:"
{ command -v lscpu >/dev/null && lscpu | head -20; } || true
echo
echo "Args: ${ARGS[*]}"
echo "Output also tee'd to $OUT"
echo

# tee so the human-readable table appears in both the SBATCH stdout log
# AND a per-job .log under logs/ (parallel to throughput_compare.sh).
node tools/probe_worker_threads.mjs "${ARGS[@]}" 2>&1 | tee "$OUT"

echo
echo "=== Probe complete (log: $OUT) ==="
