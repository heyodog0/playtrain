#!/bin/bash -l
#SBATCH -J nodegym-perf-probe
#SBATCH -p test
#SBATCH -c 24
#SBATCH --mem=16G
#SBATCH -t 0-00:45
#SBATCH -o logs/perf_probe_%j.out
#SBATCH -e logs/perf_probe_%j.err
# Phase 0.5 experiment #1: attribute the N=16 Cairo contention to a
# specific C symbol via Linux `perf`.
#
# The workload sweep (commit 71f9dc4, job 12889388) localized contention
# to "C-level canvas libraries" — Cairo, libpixman, or the node-canvas
# binding. This SBATCH attaches `perf record` to the probe at N=16, runs
# long enough to get dense samples, and produces a flat report + a
# folded-stack file you can render as a flame graph.
#
# Also captures, for completeness:
#   - library versions (cairo, pixman, fontconfig)
#   - shared libraries node-canvas links against (ldd)
#   - syscall counts via strace -c (futex contention proxy)
#
# Output goes to logs/perf_probe_<jobid>_*.{txt,folded,svg}
#
# Usage:
#   sbatch tools/probe_perf.sbatch
#   sbatch tools/probe_perf.sbatch --threads 16 --iters 8000

# NOTE: deliberately NOT using `set -e` / `pipefail` here. This script
# composes lots of best-effort diagnostic commands (ldd | head, strace,
# perf record, version probes) that occasionally exit non-zero or
# trigger SIGPIPE on inner pipe stages. With `set -e`, those abort the
# whole job silently — exactly the bug that made job 12891628 produce
# a truncated environment log and nothing else. Failures are
# individually tolerated; the script's invariant is "do as many
# experiments as we can, log what happened for each".
set -u
cd "${SLURM_SUBMIT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
mkdir -p logs

# Phase 0.5 wants dense samples at N=16 specifically — that's where the
# contention shows up. Iters are higher than the basic probe (more time
# under perf attachment = more samples per symbol = higher attribution
# confidence). The probe spawns its threads then runs for ~5–15s wall.
THREADS="${THREADS:-16}"
ITERS="${ITERS:-8000}"
ARGS=("$@")
for ((i=0; i<${#ARGS[@]}; i++)); do
  case "${ARGS[i]}" in
    --threads) THREADS="${ARGS[$((i+1))]}"; ((i++)) ;;
    --iters)   ITERS="${ARGS[$((i+1))]}";   ((i++)) ;;
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

if [ ! -d node_modules ]; then
  command -v pnpm >/dev/null && pnpm install --prefer-offline || npm install
fi

JOB_TAG="${SLURM_JOB_ID:-local}"
ENV_LOG="logs/perf_probe_${JOB_TAG}_environment.txt"

# ── 1. Library version inspection (experiment #3 from §10.1) ──────────────
{
  echo "=== Environment ==="
  echo "node:    $(node --version)  ($(command -v node))"
  echo "kernel:  $(uname -srvmo)"
  echo
  echo "=== Library versions ==="
  for cmd in "cairo --version" "pkg-config --modversion cairo" "pkg-config --modversion pixman-1" "pkg-config --modversion fontconfig"; do
    out=$(eval "$cmd" 2>/dev/null) && echo "$cmd  →  $out" || echo "$cmd  →  (not available)"
  done
  echo
  echo "=== node-canvas native binding (.node files) ==="
  find node_modules -name '*.node' 2>/dev/null | while read -r f; do
    echo "  $f"
    if command -v ldd >/dev/null 2>&1; then
      # awk-based line limit: reads full stdin so upstream ldd doesn't
      # get SIGPIPE (a previous `| head -25` aborted the whole script
      # under set -e — see job 12891628).
      ldd "$f" 2>/dev/null | sed 's/^/    /' | awk 'NR<=30'
    fi
  done
  echo
  echo "=== /proc/sys/kernel/perf_event_paranoid ==="
  cat /proc/sys/kernel/perf_event_paranoid 2>/dev/null || echo "(not readable)"
  echo "  (-1 = anyone, 0 = kernel events, 1 = user events, 2 = no kernel symbols, 3+ = disabled)"
  echo
} | tee "$ENV_LOG"

# ── 2. strace -c (experiment #2 from §10.1) ────────────────────────────────
# Run the probe under strace, counting syscalls. High futex calls at N=16
# vs N=1 directly evidences userspace locking somewhere.
STRACE_LOG="logs/perf_probe_${JOB_TAG}_strace.txt"
if command -v strace >/dev/null 2>&1; then
  echo
  echo "════════════════════════════════════════════════════════════════"
  echo " strace -c -f at N=${THREADS}"
  echo "════════════════════════════════════════════════════════════════"
  # -c = counts only, -f = follow threads, -e = focus on the syscalls
  # that matter for contention (futex is the big one)
  strace -c -f -e trace=futex,mmap,munmap,brk,clock_nanosleep,sched_yield \
    node tools/probe_worker_threads.mjs \
    --iters "$ITERS" --threads "$THREADS" --workload full \
    > /dev/null 2> "$STRACE_LOG" || true
  echo "→ syscall counts at N=${THREADS}:"
  cat "$STRACE_LOG"

  # Also run at N=1 for baseline so we can compare
  STRACE_LOG_N1="logs/perf_probe_${JOB_TAG}_strace_n1.txt"
  echo
  echo "→ syscall counts at N=1 (baseline):"
  strace -c -f -e trace=futex,mmap,munmap,brk,clock_nanosleep,sched_yield \
    node tools/probe_worker_threads.mjs \
    --iters "$ITERS" --threads 1 --workload full \
    > /dev/null 2> "$STRACE_LOG_N1" || true
  cat "$STRACE_LOG_N1"
else
  echo "(strace not available; skipping syscall counts)"
fi

# ── 3. perf record (experiment #1 from §10.1) ──────────────────────────────
PARANOID=$(cat /proc/sys/kernel/perf_event_paranoid 2>/dev/null || echo 99)

if command -v perf >/dev/null 2>&1 && [ "$PARANOID" -le 2 ]; then
  echo
  echo "════════════════════════════════════════════════════════════════"
  echo " perf record at N=${THREADS} (paranoid=${PARANOID})"
  echo "════════════════════════════════════════════════════════════════"

  PERF_DATA="logs/perf_probe_${JOB_TAG}.data"
  PERF_REPORT="logs/perf_probe_${JOB_TAG}_report.txt"
  PERF_FOLDED="logs/perf_probe_${JOB_TAG}_folded.txt"

  # -F 99 = 99 Hz sampling (avoids fixed-period correlation with anything)
  # -g    = capture call graphs
  # --    = run command and record its execution end-to-end
  perf record -F 99 -g -o "$PERF_DATA" -- \
    node tools/probe_worker_threads.mjs \
      --iters "$ITERS" --threads "$THREADS" --workload full \
      > /dev/null 2>&1 || true

  if [ -f "$PERF_DATA" ]; then
    echo "→ Top symbols by self-time (perf report --stdio):"
    # awk NR<=80 instead of `head -80` for the same SIGPIPE reason above.
    perf report -i "$PERF_DATA" --stdio --no-children --percent-limit 0.5 \
      2>/dev/null | awk 'NR<=80' | tee "$PERF_REPORT"

    # Folded stacks for FlameGraph rendering. flamegraph.pl is small enough
    # to vendor in tools/ if not installed; here we just produce the folded
    # form, which can be rendered locally with Brendan Gregg's flamegraph.pl.
    echo
    echo "→ Folded stacks written to $PERF_FOLDED (render locally with"
    echo "  flamegraph.pl < $PERF_FOLDED > flamegraph.svg)"
    perf script -i "$PERF_DATA" 2>/dev/null | \
      awk '
        /^$/ { if (stack != "") print sample " " stack; sample=""; stack=""; next }
        /^[a-zA-Z0-9_-]+ +[0-9]+ +/ { if (sample) { print sample" "stack } sample=$1; stack=""; next }
        { sym=$NF; if (stack=="") stack=sym; else stack=sym";"stack }
        END { if (sample) print sample" "stack }
      ' 2>/dev/null > "$PERF_FOLDED" || true
  else
    echo "(perf record produced no data — likely permission/paranoid issue)"
  fi
else
  # perf not allowed → fall back to Node's --cpu-prof, which doesn't need
  # kernel-level access. Less powerful (won't see native C frames clearly)
  # but always available.
  echo
  echo "════════════════════════════════════════════════════════════════"
  echo " perf unavailable (paranoid=${PARANOID:-99}); using --cpu-prof"
  echo "════════════════════════════════════════════════════════════════"
  mkdir -p logs/cpuprof_${JOB_TAG}
  node --cpu-prof --cpu-prof-dir="logs/cpuprof_${JOB_TAG}" \
    tools/probe_worker_threads.mjs \
    --iters "$ITERS" --threads "$THREADS" --workload full \
    > "logs/perf_probe_${JOB_TAG}_cpuprof_run.log" 2>&1 || true
  echo "→ .cpuprofile files: logs/cpuprof_${JOB_TAG}/"
  echo "  Render locally with: uv run python tools/profile_view.py <path>"
fi

echo
echo "════════════════════════════════════════════════════════════════"
echo " Phase 0.5 perf probe complete (job ${JOB_TAG})"
echo "════════════════════════════════════════════════════════════════"
echo "Artifacts:"
ls -la "logs/perf_probe_${JOB_TAG}"* 2>/dev/null || true
ls -la "logs/cpuprof_${JOB_TAG}"/ 2>/dev/null || true
