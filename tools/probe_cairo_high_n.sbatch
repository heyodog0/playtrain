#!/bin/bash -l
#SBATCH -J nodegym-cairo-highn
#SBATCH -p test
#SBATCH -c 32
#SBATCH --mem=32G
#SBATCH -t 0-00:45
#SBATCH -o logs/cairo_high_n_%j.out
#SBATCH -e logs/cairo_high_n_%j.err
# Phase 0.5 follow-up #3: Cairo high-N scaling characterization.
#
# Job 12899297 found Cairo + path2d_per_color reaches 134k iters/s at
# N=16 (66% efficiency, 94 μs/iter slowest). The remaining question
# for the architecture decision (B: DirectVecEnv vs C₁: Worker Threads
# + batched draws) is whether Cairo's batched-path performance keeps
# scaling beyond N=16.
#
# Key motivating question: DirectVecEnv is bounded by physical cores
# (separate processes, one per core). Worker Threads can in principle
# pack more envs into one process if the scaling holds. If Cairo
# path2d_per_color hits diminishing returns by N=24, B and C₁ are
# truly equivalent and we pick B for simplicity. If Cairo keeps
# scaling to N=32 (or beyond), C₁ has a higher ceiling and that's a
# real differentiator for the paper.
#
# Runs only the two winning variants from job 12899297:
#   path2d_per_color   (multi-color, production-realistic)
#   path2d_batch       (single color, theoretical upper bound)
#
# Sweep: N=8, 16, 24, 32. ITERS=5000 for clean numbers at high N.
#
# Resource notes:
#   -c 32  : enough cores to keep N=32 threads each on their own
#            physical core (no thread-vs-core oversubscription, which
#            would invalidate the contention numbers).
#   --mem=32G: each Worker Thread holds ~50 MB of V8 + canvas state.
#            At N=32 that's ~1.6 GB worker-side plus the main process.
#            32 GB is comfortable.
#   -t 45min: each variant × N runs in <30s; sweep takes ~5min total.
#            Cap covers queue + module-load slop.

set -u
cd "${SLURM_SUBMIT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
mkdir -p logs

THREADS="${THREADS:-8,16,24,32}"
ITERS="${ITERS:-5000}"

if ! command -v node >/dev/null 2>&1; then
  module load nodejs/22.9.0-fasrc01 2>/dev/null \
    || module load nodejs/20.10.0-fasrc01 2>/dev/null \
    || module load nodejs/18.18.2-fasrc01 2>/dev/null \
    || module load nodejs 2>/dev/null || true
fi
[ -d "$HOME/.local-node/bin" ] && export PATH="$HOME/.local-node/bin:$PATH"
export PATH="$HOME/.local/bin:$PATH"
command -v node >/dev/null || { echo "ERROR: node not on PATH" >&2; exit 1; }

if [ ! -d "node_modules/canvas" ]; then
  command -v pnpm >/dev/null && pnpm install --prefer-offline || npm install
fi

JOB_TAG="${SLURM_JOB_ID:-local}"
SUMMARY="logs/cairo_high_n_${JOB_TAG}.tsv"
printf "variant\tbaseline_us\tN\tslowest_us\tefficiency_pct\tagg_iters_s\n" > "$SUMMARY"

run_variant() {
  local variant="$1"
  local log="logs/cairo_high_n_${JOB_TAG}_${variant}.log"

  echo
  echo "════════════════════════════════════════════════════════════════"
  echo " variant: ${variant}"
  echo "════════════════════════════════════════════════════════════════"

  node tools/probe_cairo_tune.mjs \
    --variant "$variant" --iters "$ITERS" --threads "$THREADS" 2>&1 | tee "$log"

  # Parse ALL Worker rows (not just N_max) — we want the full scaling curve.
  python3 - "$log" "$variant" "$SUMMARY" <<'PY'
import re, sys
log_path, variant, summary_path = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(log_path).read()
m = re.search(r"baseline.*?\|\s*([\d.]+)\s*μs/iter", text, re.S)
baseline_us = float(m.group(1)) if m else 0.0
rows = re.findall(
    r"^\s*(\d+)\s+threads?\s+\(Worker\)\s+\d+\s+([\d.]+)\s+(\d+)\s+(\d+)%",
    text, re.M
)
with open(summary_path, "a") as f:
    for n_threads, slowest, agg, eff in rows:
        f.write(f"{variant}\t{baseline_us:.1f}\t{n_threads}\t{slowest}\t{eff}\t{agg}\n")
print(f"  → recorded {len(rows)} rows for variant={variant}, baseline={baseline_us:.1f}μs")
PY
}

# Only the two winners from job 12899297 — high-N matters most for
# the variants that actually scale.
run_variant "path2d_per_color"
run_variant "path2d_batch"

echo
echo "════════════════════════════════════════════════════════════════"
echo " Cairo high-N scaling summary (job ${JOB_TAG})"
echo "════════════════════════════════════════════════════════════════"
echo "Probe config: --iters ${ITERS} --threads ${THREADS}"
echo
echo "Reference (job 12899297 at N=16):"
echo "  path2d_per_color  baseline 62 μs   N=16 94 μs  66% eff  134k iters/s"
echo "  path2d_batch      baseline 63 μs   N=16 100 μs 63% eff  122k iters/s"
echo
echo "High-N results:"
if command -v column >/dev/null 2>&1; then
  column -t -s $'\t' "$SUMMARY"
else
  cat "$SUMMARY"
fi

echo
echo "Decision criteria:"
echo "  - If path2d_per_color slowest_us stays below ~130 μs through N=32,"
echo "    Worker Threads has real headroom past 16 envs. C₁ becomes the"
echo "    differentiated architecture (DirectVecEnv is capped at core count)."
echo "  - If path2d_per_color slowest_us spikes past 150 μs by N=24, the"
echo "    contention becomes prohibitive. B and C₁ are equivalent in practice;"
echo "    pick B for simpler implementation."
echo "  - Watch the absolute aggregate iters/s — that's the real number for"
echo "    the paper. Currently 134k at N=16; what does it peak at?"
