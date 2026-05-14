#!/bin/bash
# Pull Worker-Threads probe results from FASRC back to this local checkout.
# Mirrors the pattern in analogen/pull_results.sh.
#
# Usage:
#   ./tools/pull_probe.sh                    # pull all wt_probe_* + alloc_*
#   ./tools/pull_probe.sh <jobid>            # pull only that job's files
#   ./tools/pull_probe.sh latest             # pull only the newest probe job
#   ./tools/pull_probe.sh alloc              # only allocator-sweep results
#   ./tools/pull_probe.sh wt                 # only Worker-Threads probe results
#
# Override host or path (matches analogen's pattern):
#   FASRC_HOST=user@host ./tools/pull_probe.sh
#   FASRC_PATH=/some/other/path ./tools/pull_probe.sh
#
# Assumes the FASRC-side path is the node-gym-dev worktree where SBATCH
# scripts wrote logs/{wt_probe,alloc_sweep,alloc_probe}_<jobid>.*

set -euo pipefail
cd "$(dirname "$0")/.."   # cd to repo root so logs/ is at the right level

FASRC_HOST="${FASRC_HOST:-truong@login.rc.fas.harvard.edu}"
FASRC_PATH="${FASRC_PATH:-/n/holylabs/gershman_lab/Users/rtruong/node-gym-dev}"
FILTER="${1:-all}"

# Collect glob patterns based on the filter. We pass multiple patterns to
# rsync as separate source args (rsync expands each remote-side).
PATTERNS=()
case "$FILTER" in
  all)
    PATTERNS=(
      "logs/wt_probe_*"
      "logs/alloc_sweep_*" "logs/alloc_probe_*"
      "logs/workload_sweep_*" "logs/workload_probe_*"
      "logs/perf_probe_*" "logs/cpuprof_*"
      "logs/skia_probe_*" "logs/skia_tune_*"
    )
    ;;
  wt)
    PATTERNS=("logs/wt_probe_*")
    ;;
  alloc)
    PATTERNS=("logs/alloc_sweep_*" "logs/alloc_probe_*")
    ;;
  workload)
    PATTERNS=("logs/workload_sweep_*" "logs/workload_probe_*")
    ;;
  perf)
    PATTERNS=("logs/perf_probe_*" "logs/cpuprof_*")
    ;;
  skia)
    PATTERNS=("logs/skia_probe_*" "logs/skia_tune_*")
    ;;
  latest)
    # Resolve the newest jobid (across ALL probe kinds) on the FASRC side.
    echo "==> Resolving latest probe job on $FASRC_HOST…"
    NEWEST=$(ssh "$FASRC_HOST" "
      ls -t ${FASRC_PATH}/logs/wt_probe_*.log \
            ${FASRC_PATH}/logs/alloc_sweep_*.out \
            ${FASRC_PATH}/logs/workload_sweep_*.out \
            ${FASRC_PATH}/logs/perf_probe_*.out \
            ${FASRC_PATH}/logs/skia_probe_*.out \
            ${FASRC_PATH}/logs/skia_tune_*.out 2>/dev/null \
        | head -1 \
        | xargs -n1 basename \
        | sed -E 's/^(wt_probe|alloc_sweep|workload_sweep|perf_probe|skia_probe|skia_tune)_([0-9]+|local)\.(log|out|err|tsv)$/\2/'
    ")
    if [ -z "${NEWEST:-}" ]; then
      echo "ERROR: no probe logs found under ${FASRC_PATH}/logs/ on $FASRC_HOST" >&2
      exit 1
    fi
    echo "    newest jobid: $NEWEST"
    PATTERNS=(
      "logs/wt_probe_${NEWEST}*"
      "logs/alloc_sweep_${NEWEST}*"     "logs/alloc_probe_${NEWEST}_*"
      "logs/workload_sweep_${NEWEST}*"  "logs/workload_probe_${NEWEST}_*"
      "logs/perf_probe_${NEWEST}*"      "logs/cpuprof_${NEWEST}/"
      "logs/skia_probe_${NEWEST}*"      "logs/skia_tune_${NEWEST}*"
    )
    ;;
  *)
    # Numeric jobid (or "local"). Pull anything matching that jobid.
    PATTERNS=(
      "logs/wt_probe_${FILTER}*"
      "logs/alloc_sweep_${FILTER}*"     "logs/alloc_probe_${FILTER}_*"
      "logs/workload_sweep_${FILTER}*"  "logs/workload_probe_${FILTER}_*"
      "logs/perf_probe_${FILTER}*"      "logs/cpuprof_${FILTER}/"
      "logs/skia_probe_${FILTER}*"      "logs/skia_tune_${FILTER}*"
    )
    ;;
esac

mkdir -p logs
echo "Pulling from ${FASRC_HOST}:${FASRC_PATH}"
for p in "${PATTERNS[@]}"; do echo "  pattern: $p"; done
echo

# Build the rsync source list. Each pattern becomes its own arg; rsync
# silently skips non-matching ones, so we won't error if e.g. alloc_*
# doesn't exist yet for this jobid.
SOURCES=()
for p in "${PATTERNS[@]}"; do SOURCES+=("${FASRC_HOST}:${FASRC_PATH}/${p}"); done

# -a archive, -v verbose, -z compress, --partial resume; files are tiny.
rsync -avz --partial "${SOURCES[@]}" logs/ 2>/dev/null \
  || { echo "WARN: nothing pulled (no match, or ssh failure)" >&2; exit 1; }

echo
echo "Done. Newest local files:"
ls -lt logs/wt_probe_* logs/alloc_sweep_* logs/alloc_probe_* \
       logs/workload_sweep_* logs/workload_probe_* 2>/dev/null | head -12

# Print any summary TSVs first (the headline tables). Sweep TSVs are the
# concise digest of each multi-variant run.
echo
for tsv in $(ls -t logs/workload_sweep_*.tsv logs/alloc_sweep_*.tsv 2>/dev/null | head -2); do
  echo "=== $tsv ==="
  if command -v column >/dev/null 2>&1; then column -t -s $'\t' "$tsv"
  else cat "$tsv"; fi
  echo
done

LATEST_LOG=$(ls -t logs/wt_probe_*.log 2>/dev/null | head -1 || true)
if [ -n "${LATEST_LOG:-}" ]; then
  echo "=== $LATEST_LOG ==="
  cat "$LATEST_LOG"
fi
