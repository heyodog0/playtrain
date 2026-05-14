#!/bin/bash
# Pull Worker-Threads probe results from FASRC back to this local checkout.
# Mirrors the pattern in analogen/pull_results.sh.
#
# Usage:
#   ./tools/pull_probe.sh                    # pull all logs/wt_probe_*
#   ./tools/pull_probe.sh <jobid>            # pull only that job's files
#   ./tools/pull_probe.sh latest             # pull only the newest probe (single job)
#
# Override host or path (matches analogen's pattern):
#   FASRC_HOST=user@host ./tools/pull_probe.sh
#   FASRC_PATH=/some/other/path ./tools/pull_probe.sh
#
# Assumes the FASRC-side path is the node-gym-dev worktree where the SBATCH
# script wrote logs/wt_probe_<jobid>.{out,err,log}.

set -euo pipefail
cd "$(dirname "$0")/.."   # cd to repo root so logs/ is at the right level

FASRC_HOST="${FASRC_HOST:-truong@login.rc.fas.harvard.edu}"
FASRC_PATH="${FASRC_PATH:-/n/holylabs/gershman_lab/Users/rtruong/node-gym-dev}"
FILTER="${1:-all}"

case "$FILTER" in
  all)
    PATTERN="logs/wt_probe_*"
    ;;
  latest)
    # Resolve the newest jobid on the FASRC side, then pull just that.
    echo "==> Resolving latest probe on $FASRC_HOST…"
    NEWEST=$(ssh "$FASRC_HOST" \
      "ls -t ${FASRC_PATH}/logs/wt_probe_*.log 2>/dev/null | head -1 | xargs -n1 basename" \
      | sed -E 's/^wt_probe_([0-9]+|local)\.log$/\1/')
    if [ -z "${NEWEST:-}" ]; then
      echo "ERROR: no wt_probe_*.log found under ${FASRC_PATH}/logs/ on $FASRC_HOST" >&2
      exit 1
    fi
    echo "    newest jobid: $NEWEST"
    PATTERN="logs/wt_probe_${NEWEST}*"
    ;;
  *)
    # Numeric jobid (or "local" for interactive runs)
    PATTERN="logs/wt_probe_${FILTER}*"
    ;;
esac

mkdir -p logs
echo "Pulling from ${FASRC_HOST}:${FASRC_PATH}"
echo "  pattern: $PATTERN"
echo

# -a archive (preserve perms/mtimes), -v verbose, -z compress, --partial
# resume interrupted transfers. Files are tiny (KB), so this is fast.
rsync -avz --partial \
  "${FASRC_HOST}:${FASRC_PATH}/${PATTERN}" logs/ 2>/dev/null \
  || { echo "WARN: nothing pulled (no match, or ssh failure)" >&2; exit 1; }

echo
echo "Done. Newest local probe files:"
ls -lt logs/wt_probe_* 2>/dev/null | head -6

# If we just pulled a single jobid's results, print the table immediately —
# saves the user a step.
echo
LATEST_LOG=$(ls -t logs/wt_probe_*.log 2>/dev/null | head -1 || true)
if [ -n "$LATEST_LOG" ]; then
  echo "=== $LATEST_LOG ==="
  cat "$LATEST_LOG"
fi
