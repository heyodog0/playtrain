#!/usr/bin/env bash
# gate.sh — differential bit-exact gate for a compiled game twin.
# Runs the JS (V8, wasm rasterizer) reference and the native twin on matched
# seeds+actions and asserts byte-identical trajectories (state + obs frame hash).
#   ./gate.sh <game> [nsteps] [seed1 seed2 ...]
set -euo pipefail
cd "$(dirname "$0")"

GAME="${1:-bigfish}"
N="${2:-20000}"
shift $(( $# > 2 ? 2 : $# )) || true
SEEDS=("$@"); [ ${#SEEDS[@]} -eq 0 ] && SEEDS=(1 42 777 12345 99999)

[ -x "build/${GAME}" ] || ./build.sh "$GAME"

fail=0
for S in "${SEEDS[@]}"; do
  node reference_trace.mjs "$GAME" "$S" "$N" > "/tmp/gate_js_${GAME}_${S}.txt" 2>/dev/null
  "./build/${GAME}" trace "$S" "$N"          > "/tmp/gate_nv_${GAME}_${S}.txt"
  if diff -q "/tmp/gate_js_${GAME}_${S}.txt" "/tmp/gate_nv_${GAME}_${S}.txt" >/dev/null; then
    echo "  ✅ ${GAME} seed=${S}: ${N} steps bit-exact"
  else
    echo "  ❌ ${GAME} seed=${S}: DIVERGES"
    diff "/tmp/gate_js_${GAME}_${S}.txt" "/tmp/gate_nv_${GAME}_${S}.txt" | head -8
    fail=1
  fi
done
[ $fail -eq 0 ] && echo "GATE PASS: ${GAME}" || { echo "GATE FAIL: ${GAME}"; exit 1; }
