#!/bin/bash -l
#SBATCH -J nodegym-skia-probe
#SBATCH -p test
#SBATCH -c 24
#SBATCH --mem=16G
#SBATCH -t 0-00:30
#SBATCH -o logs/skia_probe_%j.out
#SBATCH -e logs/skia_probe_%j.err
# Phase 0.5 Option 1: Skia (@napi-rs/canvas) multi-env scaling probe.
#
# Direct apples-to-apples comparison against the Cairo Worker-Threads
# probe at N=16 (job 12891926, commit 7c1f7ce). Same workload, same
# scaffold, only the rasterizer library differs.
#
# Decision after this:
#   - Skia at N=16 shows efficiency ≫ Cairo's 29%  →  per-thread
#     slowdown is library-specific. Worker Threads + Skia revives
#     the original architecture.
#   - Skia at N=16 shows efficiency ≈ Cairo's 29%  →  contention is
#     library-independent (hardware-level: L3, TLB, memory controller).
#     Confirms the "pivot to DirectVecEnv" decision from §10.7.
#
# Usage:
#   sbatch tools/probe_skia.sbatch
#   sbatch tools/probe_skia.sbatch --threads 1,2,4,8,16,24 --iters 3000

set -u
cd "${SLURM_SUBMIT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
mkdir -p logs

THREADS="${THREADS:-1,2,4,8,16,24}"
ITERS="${ITERS:-3000}"
WORKLOAD="${WORKLOAD:-full}"
ARGS=("$@")
HAS_ITERS=0; HAS_THREADS=0; HAS_WORKLOAD=0
for a in "${ARGS[@]}"; do
  case "$a" in
    --iters) HAS_ITERS=1 ;;
    --threads) HAS_THREADS=1 ;;
    --workload) HAS_WORKLOAD=1 ;;
  esac
done
[ "$HAS_ITERS" -eq 0 ]    && ARGS+=(--iters "$ITERS")
[ "$HAS_THREADS" -eq 0 ]  && ARGS+=(--threads "$THREADS")
[ "$HAS_WORKLOAD" -eq 0 ] && ARGS+=(--workload "$WORKLOAD")

# ── Modules ────────────────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  module load nodejs/22.9.0-fasrc01 2>/dev/null \
    || module load nodejs/20.10.0-fasrc01 2>/dev/null \
    || module load nodejs/18.18.2-fasrc01 2>/dev/null \
    || module load nodejs 2>/dev/null || true
fi
[ -d "$HOME/.local-node/bin" ] && export PATH="$HOME/.local-node/bin:$PATH"
export PATH="$HOME/.local/bin:$PATH"
command -v node >/dev/null || { echo "ERROR: node not on PATH" >&2; exit 1; }

# @napi-rs/canvas is in devDependencies — make sure pnpm pulled it.
# A fresh worktree might not have it yet; reinstall to be safe.
if [ ! -d "node_modules/@napi-rs/canvas" ]; then
  echo "==> installing @napi-rs/canvas (first run for this worktree)"
  if command -v pnpm >/dev/null 2>&1; then
    pnpm install --prefer-offline
  else
    npm install
  fi
fi

# Confirm Skia actually loaded — if the prebuilt binary for this glibc
# isn't compatible, fail loudly here instead of mid-run.
if ! node -e "import('@napi-rs/canvas').then(m => { m.createCanvas(2,2); console.log('skia OK'); })" 2>&1 | grep -q "skia OK"; then
  echo "ERROR: @napi-rs/canvas couldn't be loaded on this node." >&2
  echo "       Possible cause: prebuilt binary glibc mismatch. Try `npm install --build-from-source`." >&2
  exit 1
fi

JOB_TAG="${SLURM_JOB_ID:-local}"
LOG="logs/skia_probe_${JOB_TAG}.log"

# ── Skia library version info (analogous to Cairo lib-versions probe) ──────
{
  echo "=== Environment ==="
  echo "node: $(node --version)  ($(command -v node))"
  echo
  echo "=== @napi-rs/canvas ==="
  node -e "
    const pkg = require('@napi-rs/canvas/package.json');
    console.log('  version: ' + pkg.version);
    console.log('  bin    : ' + JSON.stringify(Object.keys(pkg.napi?.triples || {})));
  "
  echo
  echo "=== Skia .node binary deps ==="
  for f in node_modules/@napi-rs/canvas-linux-x64*/skia.linux-x64-*.node node_modules/@napi-rs/canvas/skia.linux-x64-*.node; do
    [ -f "$f" ] || continue
    echo "  $f"
    command -v ldd >/dev/null && ldd "$f" 2>/dev/null | sed 's/^/    /' | awk 'NR<=20'
  done
  echo
} | tee "logs/skia_probe_${JOB_TAG}_environment.txt"

# ── Run probe ──────────────────────────────────────────────────────────────
echo
echo "════════════════════════════════════════════════════════════════"
echo " Skia probe (job ${JOB_TAG})"
echo "════════════════════════════════════════════════════════════════"
echo "Args: ${ARGS[*]}"
echo

node tools/probe_worker_threads_skia.mjs "${ARGS[@]}" 2>&1 | tee "$LOG"

echo
echo "════════════════════════════════════════════════════════════════"
echo " Direct comparison vs Cairo at the same N=16 row (job 12891926)"
echo "════════════════════════════════════════════════════════════════"
echo "  Cairo:  slowest 277 μs/iter   29% eff   53k iters/s   (3.4× slowdown vs baseline)"
echo "  Skia:   <see table above>"
echo
echo "If Skia efficiency at N=16 ≫ 29%, library upgrade is the path forward."
echo "If Skia efficiency at N=16 ≈ 29%, the contention is hardware-level →"
echo "  pivot to DirectVecEnv per §10.7 of docs/MULTI_ENV_RUNTIME.md."
