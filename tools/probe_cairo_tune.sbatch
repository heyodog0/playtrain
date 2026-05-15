#!/bin/bash -l
#SBATCH -J nodegym-cairo-tune
#SBATCH -p test
#SBATCH -c 24
#SBATCH --mem=16G
#SBATCH -t 0-00:30
#SBATCH -o logs/cairo_tune_%j.out
#SBATCH -e logs/cairo_tune_%j.err
# Phase 0.5 follow-up #2: Cairo (node-canvas) configuration tuning.
#
# Same workload + tuning matrix as the Skia tuning probe (job 12895792
# / 12897259), but using node-canvas (Cairo binding) instead of
# @napi-rs/canvas (Skia). The decisive question: does the
# `path2d_per_color` batching strategy (50 multi-color rects → ~9
# native fill() calls per iter, batched via ctx.beginPath/rect/fill)
# give Cairo the same ~93% N=16 scaling that Skia gets?
#
# Cairo's single-thread baseline is ~2× faster than Skia (~80 vs
# ~160 μs). If the same scaling efficiency applies, Worker Threads +
# Cairo + path2d_per_color lands around ~107 μs/step at N=16 — which
# would BEAT current SubprocVecEnv (~173 μs/step) substantially and
# match DirectVecEnv's (~90-110) projected total.
#
# Variants tested (mirrors skia_tune.sbatch where applicable):
#   default            current production-style call pattern
#   no_aa              imageSmoothingEnabled=false + low quality
#   read_freq          { willReadFrequently: true } context option
#   path2d_batch       beginPath + 50 rects + 1 fill (1 native fill)
#   same_color         50 fillRects, 1 fillStyle set (no batching)
#   path2d_per_color   ⭐ 50 multi-color rects → 9 path fills
#   path2d_50_per_iter sanity check: 50 separate beginPath+rect+fill
#
# Usage:
#   sbatch tools/probe_cairo_tune.sbatch
#   sbatch tools/probe_cairo_tune.sbatch --threads 1,4,8,16,24 --iters 3000

set -u
cd "${SLURM_SUBMIT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
mkdir -p logs

THREADS="${THREADS:-1,8,16}"
ITERS="${ITERS:-2000}"
ARGS=("$@")
HAS_ITERS=0; HAS_THREADS=0
for a in "${ARGS[@]}"; do
  case "$a" in
    --iters)   HAS_ITERS=1 ;;
    --threads) HAS_THREADS=1 ;;
  esac
done

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

if [ ! -d "node_modules/canvas" ]; then
  echo "==> installing canvas (first run for this worktree)"
  command -v pnpm >/dev/null && pnpm install --prefer-offline || npm install
fi

JOB_TAG="${SLURM_JOB_ID:-local}"
SUMMARY="logs/cairo_tune_${JOB_TAG}.tsv"
printf "variant\tbaseline_us\tN_max\tslowest_us\tefficiency_pct\tagg_iters_s\n" > "$SUMMARY"

run_variant() {
  local variant="$1"
  local log="logs/cairo_tune_${JOB_TAG}_${variant}.log"

  echo
  echo "════════════════════════════════════════════════════════════════"
  echo " variant: ${variant}"
  echo "════════════════════════════════════════════════════════════════"

  local extra_args=()
  [ "$HAS_ITERS" -eq 0 ]   && extra_args+=(--iters "$ITERS")
  [ "$HAS_THREADS" -eq 0 ] && extra_args+=(--threads "$THREADS")

  node tools/probe_cairo_tune.mjs --variant "$variant" \
    "${extra_args[@]}" "${ARGS[@]}" 2>&1 | tee "$log"

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
if rows:
    n_max, slowest, agg, eff = max(rows, key=lambda r: int(r[0]))
    with open(summary_path, "a") as f:
        f.write(f"{variant}\t{baseline_us:.1f}\t{n_max}\t{slowest}\t{eff}\t{agg}\n")
    print(f"  → recorded variant={variant} baseline={baseline_us:.1f}μs N={n_max} slowest={slowest}μs eff={eff}% agg={agg}/s")
else:
    print(f"  WARN: no Worker rows parsed from {log_path}")
PY
}

for v in default no_aa read_freq path2d_batch same_color path2d_per_color path2d_50_per_iter; do
  run_variant "$v"
done

# ── Summary + cross-library comparison ─────────────────────────────────────
echo
echo "════════════════════════════════════════════════════════════════"
echo " Cairo tuning summary (job ${JOB_TAG})"
echo "════════════════════════════════════════════════════════════════"
echo "Probe config: --iters ${ITERS} --threads ${THREADS}"
echo
echo "Skia reference (job 12897259, commit 0dee9bb):"
echo "  default              138.7 μs  N=16  347 μs   40% eff   43k iters/s"
echo "  path2d_batch         115.0 μs  N=16  125 μs   92% eff  105k iters/s"
echo "  path2d_per_color     159.4 μs  N=16  172 μs   93% eff   76k iters/s   ⭐"
echo "  path2d_50_per_iter   426.3 μs  N=16  425 μs  100% eff   34k iters/s"
echo
echo "Cairo tuning results:"
if command -v column >/dev/null 2>&1; then
  column -t -s $'\t' "$SUMMARY"
else
  cat "$SUMMARY"
fi

echo
echo "Decision threshold for Architecture C₁ (Worker Threads + path2d_per_color):"
echo "  If Cairo path2d_per_color N=16 slowest_us < 130 μs (≈90 baseline / 0.7),"
echo "  Worker Threads + Cairo + path2d_per_color beats current SubprocVecEnv."
echo "  If it lands closer to Skia's 172 μs, the architectures are tied."
