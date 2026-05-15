#!/bin/bash -l
#SBATCH -J nodegym-wkload-sweep
#SBATCH -p test
#SBATCH -c 24
#SBATCH --mem=16G
#SBATCH -t 0-00:30
#SBATCH -o logs/workload_sweep_%j.out
#SBATCH -e logs/workload_sweep_%j.err
# Workload-localization sweep for the Worker-Threads contention investigation.
#
# Phase 0 + allocator sweep ruled out:
#   - node-canvas being unsafe (works at N=2 with 81% efficiency)
#   - glibc malloc arena contention (arena1..arena24 all within ~10%)
#
# This sweep runs five workload variants under the same Worker-Threads
# scaffold, isolating different layers of the stack to localize where
# the per-thread slowdown at N=16 actually comes from.
#
#   full           — baseline (draw + downsample + readback)
#   pure_js        — no canvas at all (pure compute + alloc churn)
#   draw_only      — fillRects only, no readback
#   readback_only  — pre-rendered canvas, just drawImage + toBuffer
#   small          — same as full but 128×96 canvas (1/14 the pixels)
#
# Interpretation matrix (efficiency @ N=16):
#
#   pure_js high (≥80%)        → Worker Threads + V8 + allocator are fine.
#                                Contention is in node-canvas/Cairo land.
#   pure_js low (<50%)         → V8 GC, OS scheduling, or memory bus is
#                                the issue. Architectural design needs
#                                rethinking — not a node-canvas problem.
#
#   draw_only ≈ readback_only  → contention is pervasive (Cairo global lock,
#       (both low)              libpixman shared state) — hard to fix
#                                without replacing the rasterizer.
#
#   draw_only fine, readback_only bad
#                              → pixman downscale or toBuffer readback path
#                                serializes. Maybe replaceable with a
#                                small native addon that bypasses pixman.
#
#   draw_only bad, readback_only fine
#                              → Cairo's fillRect / surface state contends.
#                                Less common; harder to work around.
#
#   small ≫ full at high N     → bandwidth or L3 cache is the limit.
#                                Fundamental constraint; reduce per-env
#                                pixel count or batch differently.
#   small ≈ full at high N     → not bandwidth-bound; it's a software lock.
#
# Usage:
#   sbatch tools/probe_workload_sweep.sbatch
#   sbatch tools/probe_workload_sweep.sbatch --threads 1,8,16 --iters 3000

set -euo pipefail
cd "${SLURM_SUBMIT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
mkdir -p logs

ITERS="${ITERS:-2000}"
THREADS="${THREADS:-1,8,16}"
ARGS=("$@")
for ((i=0; i<${#ARGS[@]}; i++)); do
  case "${ARGS[i]}" in
    --iters)   ITERS="${ARGS[$((i+1))]}";   ((i++)) ;;
    --threads) THREADS="${ARGS[$((i+1))]}"; ((i++)) ;;
  esac
done

# ── Modules ────────────────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  module load nodejs/22.9.0-fasrc01 2>/dev/null \
    || module load nodejs/20.10.0-fasrc01 2>/dev/null \
    || module load nodejs/18.18.2-fasrc01 2>/dev/null \
    || module load nodejs 2>/dev/null \
    || true
fi
[ -d "$HOME/.local-node/bin" ] && export PATH="$HOME/.local-node/bin:$PATH"
export PATH="$HOME/.local/bin:$PATH"
command -v node >/dev/null || { echo "ERROR: node not on PATH" >&2; exit 1; }

if [ ! -d node_modules ]; then
  echo "==> pnpm install (first run)"
  command -v pnpm >/dev/null && pnpm install --prefer-offline || npm install
fi

JOB_TAG="${SLURM_JOB_ID:-local}"
SUMMARY="logs/workload_sweep_${JOB_TAG}.tsv"
printf "workload\tbaseline_us\tN_max\tslowest_us\tefficiency_pct\tagg_iters_s\n" > "$SUMMARY"

run_workload() {
  local workload="$1"
  local log="logs/workload_probe_${JOB_TAG}_${workload}.log"

  echo
  echo "════════════════════════════════════════════════════════════════"
  echo " workload: ${workload}"
  echo "════════════════════════════════════════════════════════════════"

  node tools/probe_worker_threads.mjs \
    --iters "$ITERS" --threads "$THREADS" --workload "$workload" 2>&1 | tee "$log"

  python3 - "$log" "$workload" "$SUMMARY" <<'PY'
import re, sys
log_path, workload, summary_path = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(log_path).read()
m = re.search(r"baseline.*?\|\s*([\d.]+)\s*μs/iter", text, re.S)
baseline_us = float(m.group(1)) if m else 0.0
rows = re.findall(
    r"^\s*(\d+)\s+threads?\s+\(Worker\)\s+\d+\s+([\d.]+)\s+(\d+)\s+(\d+)%",
    text, re.M
)
if rows:
    n_max, slowest, agg, eff = max(rows, key=lambda r: int(r[0]))
    with open(summary_path, "a") as f:
        f.write(f"{workload}\t{baseline_us:.1f}\t{n_max}\t{slowest}\t{eff}\t{agg}\n")
    print(f"  → recorded workload={workload} N={n_max} slowest={slowest}μs eff={eff}% agg={agg}/s")
else:
    print(f"  WARN: no Worker rows parsed from {log_path}")
PY
}

for w in full pure_js draw_only readback_only small; do
  run_workload "$w"
done

# ── Summary table ──────────────────────────────────────────────────────────
echo
echo "════════════════════════════════════════════════════════════════"
echo " workload-localization summary (job ${JOB_TAG})"
echo "════════════════════════════════════════════════════════════════"
echo "Probe config: --iters $ITERS --threads $THREADS"
echo
if command -v column >/dev/null 2>&1; then
  column -t -s $'\t' "$SUMMARY"
else
  cat "$SUMMARY"
fi

echo
echo "Interpretation hints:"
echo "  • Compare 'efficiency_pct' across rows at the same N_max."
echo "  • pure_js high  → Worker Threads work fine; contention is canvas-side."
echo "  • pure_js low   → V8/GC/OS issue; design needs different angle."
echo "  • draw_only vs readback_only tells you which Cairo path serializes."
echo "  • small ≫ full  → bandwidth-bound; smaller obs or fewer envs help."
echo "  • small ≈ full  → it's a software lock, not memory bus."
echo
echo "Logs: logs/workload_probe_${JOB_TAG}_*.log    Summary: $SUMMARY"
