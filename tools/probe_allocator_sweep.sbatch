#!/bin/bash -l
#SBATCH -J nodegym-alloc-sweep
#SBATCH -p test
#SBATCH -c 24
#SBATCH --mem=16G
#SBATCH -t 0-00:30
#SBATCH -o logs/alloc_sweep_%j.out
#SBATCH -e logs/alloc_sweep_%j.err
# Allocator-contention sweep for the Worker-Threads probe.
#
# Phase 0 on FASRC showed per-thread time at N=16 was 3.4× baseline
# (277 μs vs 81 μs). The most likely cause is glibc malloc arena
# contention — at high thread counts the allocator's per-thread arenas
# multiply, but inter-arena coordination still serializes hot paths.
# Cairo allocates many small buffers per draw op so allocator
# contention is plausible here.
#
# This sweep runs the same probe under several allocator configs in one
# SLURM job, prints a side-by-side summary so the answer is obvious at
# a glance. If MALLOC_ARENA_MAX=24 or jemalloc/tcmalloc dramatically
# reduces per-thread slowdown at N=16, allocator contention is
# confirmed; otherwise the contention lives deeper (libpixman, V8 GC,
# Cairo internals) and we need a different angle.
#
# Usage:
#   sbatch tools/probe_allocator_sweep.sbatch
#   sbatch tools/probe_allocator_sweep.sbatch --threads 1,4,16,24 --iters 3000

set -euo pipefail
cd "${SLURM_SUBMIT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
mkdir -p logs

# ── Parse CLI overrides (defaults are tight to keep total wall short) ──────
ITERS="${ITERS:-2000}"
THREADS="${THREADS:-1,8,16}"
ARGS=("$@")
for ((i=0; i<${#ARGS[@]}; i++)); do
  case "${ARGS[i]}" in
    --iters)   ITERS="${ARGS[$((i+1))]}";   ((i++)) ;;
    --threads) THREADS="${ARGS[$((i+1))]}"; ((i++)) ;;
  esac
done

# ── Modules (mirror throughput_compare.sh) ─────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  module load nodejs/22.9.0-fasrc01 2>/dev/null \
    || module load nodejs/20.10.0-fasrc01 2>/dev/null \
    || module load nodejs/18.18.2-fasrc01 2>/dev/null \
    || module load nodejs 2>/dev/null \
    || true
fi
[ -d "$HOME/.local-node/bin" ] && export PATH="$HOME/.local-node/bin:$PATH"
export PATH="$HOME/.local/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node not on PATH" >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "==> pnpm install (first run)"
  if command -v pnpm >/dev/null 2>&1; then
    pnpm install --prefer-offline
  else
    npm install
  fi
fi

JOB_TAG="${SLURM_JOB_ID:-local}"
SUMMARY="logs/alloc_sweep_${JOB_TAG}.tsv"
printf "variant\tbaseline_us\tN_max\tslowest_us\tefficiency_pct\tagg_iters_s\n" > "$SUMMARY"

# ── Variant runner ─────────────────────────────────────────────────────────
# Run the probe in a subshell with the given env vars, tee output, and
# parse the per-variant numbers into the TSV summary.
run_variant() {
  local tag="$1"; shift
  local env_args=("$@")
  local log="logs/alloc_probe_${JOB_TAG}_${tag}.log"

  echo
  echo "════════════════════════════════════════════════════════════════"
  echo " variant: ${tag}    env: ${env_args[*]:-default}"
  echo "════════════════════════════════════════════════════════════════"

  if [ ${#env_args[@]} -gt 0 ]; then
    env "${env_args[@]}" node tools/probe_worker_threads.mjs \
      --iters "$ITERS" --threads "$THREADS" 2>&1 | tee "$log"
  else
    node tools/probe_worker_threads.mjs \
      --iters "$ITERS" --threads "$THREADS" 2>&1 | tee "$log"
  fi

  # Parse the probe output we just wrote. The probe prints:
  #   baseline (main thread, single)…
  #     242.7 ms total | 80.9 μs/iter | ...
  #   16 threads (Worker)       896  277.5  53578  29%
  # We pull baseline_us, plus the highest-N row's numbers.
  python3 - "$log" "$tag" "$SUMMARY" <<'PY'
import re, sys
log_path, tag, summary_path = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(log_path).read()

m = re.search(r"baseline.*?\|\s*([\d.]+)\s*μs/iter", text, re.S)
baseline_us = float(m.group(1)) if m else 0.0

# Worker rows look like:
#   "16 threads (Worker)       896  277.5  53578  29%"
rows = re.findall(
    r"^\s*(\d+)\s+threads?\s+\(Worker\)\s+\d+\s+([\d.]+)\s+(\d+)\s+(\d+)%",
    text, re.M
)
if rows:
    n_max, slowest, agg, eff = max(rows, key=lambda r: int(r[0]))
    with open(summary_path, "a") as f:
        f.write(f"{tag}\t{baseline_us:.1f}\t{n_max}\t{slowest}\t{eff}\t{agg}\n")
    print(f"  → recorded variant={tag} N={n_max} slowest={slowest}μs eff={eff}% agg={agg}/s")
else:
    print(f"  WARN: no Worker rows parsed from {log_path}")
PY
}

# ── The variants ────────────────────────────────────────────────────────────
# Order goes: default → progressively more-arenas → drop-in allocators.
# Worst case first (arena=1) and default establish endpoints; the middle
# values map the curve.

run_variant "default"
run_variant "arena1"  MALLOC_ARENA_MAX=1
run_variant "arena4"  MALLOC_ARENA_MAX=4
run_variant "arena24" MALLOC_ARENA_MAX=24

# jemalloc / tcmalloc via LD_PRELOAD, only if findable. We search common
# Linux paths AND module-provided locations.
find_lib() {
  local pattern="$1"
  # ldconfig -p is the most reliable way to enumerate available shared libs.
  local hit
  hit=$(ldconfig -p 2>/dev/null | awk -v p="$pattern" '$1 ~ p {print $NF; exit}')
  if [ -n "$hit" ] && [ -f "$hit" ]; then echo "$hit"; return 0; fi
  # Fall back to a brute glob over common locations.
  for d in /usr/lib/x86_64-linux-gnu /usr/lib64 /usr/lib /lib/x86_64-linux-gnu /lib64; do
    for f in "$d"/$pattern*; do [ -f "$f" ] && { echo "$f"; return 0; }; done
  done
  return 1
}

if JEMALLOC=$(find_lib "libjemalloc.so"); then
  run_variant "jemalloc" LD_PRELOAD="$JEMALLOC"
else
  echo
  echo "(jemalloc not found on this node; skipping)"
fi

if TCMALLOC=$(find_lib "libtcmalloc.so"); then
  run_variant "tcmalloc" LD_PRELOAD="$TCMALLOC"
else
  echo
  echo "(tcmalloc not found on this node; skipping)"
fi

# ── Final comparison table ─────────────────────────────────────────────────
echo
echo "════════════════════════════════════════════════════════════════"
echo " allocator-contention summary (job ${JOB_TAG})"
echo "════════════════════════════════════════════════════════════════"
echo "Probe config: --iters $ITERS --threads $THREADS"
echo
if command -v column >/dev/null 2>&1; then
  column -t -s $'\t' "$SUMMARY"
else
  cat "$SUMMARY"
fi

echo
echo "Reading:"
echo "  • Compare 'slowest_us' across variants at the same N_max. Lower is better."
echo "  • If jemalloc / tcmalloc / arena=N greatly reduces slowest_us at high N,"
echo "    allocator contention IS the dominant cost and the Worker-Threads"
echo "    design becomes a clean win."
echo "  • If everything is within ~10%, the contention lives deeper (libpixman,"
echo "    V8 GC, Cairo internals) and we need a different investigation angle."
echo
echo "Logs: logs/alloc_probe_${JOB_TAG}_*.log    Summary: $SUMMARY"
