#!/usr/bin/env bash
# gate_qjs.sh — differential bit-exact gate for the QuickJS backend.
# Runs the JS (V8, wasm rasterizer — the production path analogen models were
# trained on) reference and qjs_host on matched seeds+actions and asserts
# byte-identical trajectories (reward/term/score/lives/state + obs frame hash).
#   ./gate_qjs.sh <game> [nsteps] [seed1 seed2 ...]
#   ./gate_qjs.sh --all-analogen [nsteps]   # every analogen_*/a-cq-* game
set -euo pipefail
cd "$(dirname "$0")"

N=3000
SEEDS_DEFAULT=(1 42 777)

gate_one() {
  local GAME="$1" NSTEPS="$2"; shift 2
  local SEEDS=("$@")
  local fail=0
  for S in "${SEEDS[@]}"; do
    node reference_trace.mjs "$GAME" "$S" "$NSTEPS" > "/tmp/gateq_js_${GAME}_${S}.txt" 2>/dev/null
    ./build/qjs_host "../examples/games/js/${GAME}.js" trace "$S" "$NSTEPS" > "/tmp/gateq_qjs_${GAME}_${S}.txt" 2>/dev/null
    if diff -q "/tmp/gateq_js_${GAME}_${S}.txt" "/tmp/gateq_qjs_${GAME}_${S}.txt" >/dev/null; then
      echo "  PASS ${GAME} seed=${S} (${NSTEPS} steps bit-exact)"
    else
      echo "  FAIL ${GAME} seed=${S}: DIVERGES"
      diff "/tmp/gateq_js_${GAME}_${S}.txt" "/tmp/gateq_qjs_${GAME}_${S}.txt" | head -4
      fail=1
    fi
  done
  return $fail
}

if [ "${1:-}" = "--all-analogen" ]; then
  NSTEPS="${2:-$N}"
  overall=0
  for f in ../examples/games/js/analogen_*.js ../examples/games/js/a-cq-*.js; do
    g="$(basename "$f" .js)"
    gate_one "$g" "$NSTEPS" "${SEEDS_DEFAULT[@]}" || overall=1
  done
  [ $overall -eq 0 ] && echo "GATE PASS: all analogen games" || { echo "GATE FAIL"; exit 1; }
else
  GAME="${1:-bigfish}"
  NSTEPS="${2:-$N}"
  shift $(( $# > 2 ? 2 : $# )) || true
  SEEDS=("$@"); [ ${#SEEDS[@]} -eq 0 ] && SEEDS=("${SEEDS_DEFAULT[@]}")
  gate_one "$GAME" "$NSTEPS" "${SEEDS[@]}" && echo "GATE PASS: ${GAME}" || { echo "GATE FAIL: ${GAME}"; exit 1; }
fi
