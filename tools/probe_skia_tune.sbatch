#!/bin/bash -l
#SBATCH -J nodegym-skia-tune
#SBATCH -p test
#SBATCH -c 24
#SBATCH --mem=16G
#SBATCH -t 0-00:45
#SBATCH -o logs/skia_tune_%j.out
#SBATCH -e logs/skia_tune_%j.err
# Phase 0.5 follow-up: Skia configuration tuning sweep.
#
# Job 12893502 showed Skia is 1.7× slower per-iter than Cairo at single
# thread (136 vs 81 μs). This sweep tests whether Skia's baseline can
# be improved with configuration changes, and whether the improvements
# preserve Skia's scaling-efficiency advantage at N=16.
#
# Variants tested:
#   default           — current setup (matches job 12893502 baseline)
#   no_aa             — anti-aliasing off everywhere
#   read_freq         — { willReadFrequently: true } context option
#   path2d_batch      — single Path2D + fill instead of 50 fillRects
#                       (note: same-color, so simpler than default)
#   same_color        — 50 fillRects but all same color (1 fillStyle set/iter)
#   getimg_readback   — getImageData() readback instead of canvas.data()
#
# Each variant runs at --threads 1,8,16 by default → six tables, one per
# variant. Final summary picks the variant with the best (slowest_us @ N=16
# × efficiency) product.
#
# Decision tree after sweep:
#   - If any variant gets Skia N=16 slowest_us < 175 μs   → Worker Threads
#     revives (would beat current SubprocVecEnv at 173 μs/step). Investigate
#     production migration.
#   - If best variant still has slowest_us > 200 μs       → DirectVecEnv
#     decision stands. The Skia tuning result becomes paper-quality
#     evidence: "we tuned every plausible Skia knob and still couldn't
#     beat per-process parallelism."
#
# Usage:
#   sbatch tools/probe_skia_tune.sbatch
#   sbatch tools/probe_skia_tune.sbatch --threads 1,4,8,16,24 --iters 3000

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

if [ ! -d "node_modules/@napi-rs/canvas" ]; then
  echo "==> installing @napi-rs/canvas (first run for this worktree)"
  command -v pnpm >/dev/null && pnpm install --prefer-offline || npm install
fi

JOB_TAG="${SLURM_JOB_ID:-local}"
SUMMARY="logs/skia_tune_${JOB_TAG}.tsv"
printf "variant\tbaseline_us\tN_max\tslowest_us\tefficiency_pct\tagg_iters_s\n" > "$SUMMARY"

run_variant() {
  local variant="$1"
  local log="logs/skia_tune_${JOB_TAG}_${variant}.log"

  echo
  echo "════════════════════════════════════════════════════════════════"
  echo " variant: ${variant}"
  echo "════════════════════════════════════════════════════════════════"

  local extra_args=()
  [ "$HAS_ITERS" -eq 0 ]   && extra_args+=(--iters "$ITERS")
  [ "$HAS_THREADS" -eq 0 ] && extra_args+=(--threads "$THREADS")

  node tools/probe_skia_tune.mjs --variant "$variant" \
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

for v in default no_aa read_freq path2d_batch same_color getimg_readback; do
  run_variant "$v"
done

# ── Summary + Cairo comparison ─────────────────────────────────────────────
echo
echo "════════════════════════════════════════════════════════════════"
echo " Skia tuning summary (job ${JOB_TAG})"
echo "════════════════════════════════════════════════════════════════"
echo "Probe config: --iters ${ITERS} --threads ${THREADS}"
echo
echo "Cairo reference (job 12891926):"
echo "  default       81.0 μs  N=16  277 μs  29% eff  53k iters/s"
echo
echo "Skia tuning results:"
if command -v column >/dev/null 2>&1; then
  column -t -s $'\t' "$SUMMARY"
else
  cat "$SUMMARY"
fi

echo
echo "Decision threshold:"
echo "  If any Skia variant has slowest_us @ N=16 < 175 μs, Worker Threads"
echo "  + tuned Skia could beat current SubprocVecEnv (~173 μs/step) and the"
echo "  multi-env architecture revives."
echo "  Otherwise the DirectVecEnv pivot per §10.7 of MULTI_ENV_RUNTIME.md"
echo "  is confirmed with stronger evidence (we tuned every plausible knob)."
