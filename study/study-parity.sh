#!/usr/bin/env bash
# study-parity.sh — prove the participant's runtime and the agent's runtime agree, on the
# games and seeds the study actually uses.
#
# The human plays the JS shim with the pure-JS rasterizer in a browser; the agent runs a C++
# p5 reimplementation on QuickJS over the Rust rasterizer (src/playtrain/runtime/__init__.py:14
# binds GameEnv = QuickJSEnv). Those are three implementations of one game file, so their
# equivalence is a measurement, not a construction -- and it is the measurement the whole
# human-vs-agent comparison rests on. crates/rasterizer/README.md asserts the js-vs-wasm sweep
# was bit-identical, but nothing re-ran it; this does, scoped to the study set.
#
#   study/study-parity.sh                  # 9 study games, study seeds
#   study/study-parity.sh 800 90000 90001  # steps and seeds
#
# Link 1  browser rasterizer  vs  Rust rasterizer   (PLAYTRAIN_RASTERIZER=js vs =wasm)
# Link 2  node+V8+wasm        vs  QuickJS+Rust       (native/gate_qjs.sh)
#
# Link 2 needs native/build/qjs_host (native/build_qjs.sh); it is reported as SKIPPED rather
# than failing the run, so this stays useful on a machine that has not built the native host.
set -uo pipefail
cd "$(dirname "$0")/.."

NSTEPS="${1:-400}"
shift || true
SEEDS=("${@:-90000}")
# The study set, in study-config.json order, plus the practice game.
GAMES=(pong breakout plunder seaquest caveflyer asteroids coinrun flappy_bird vvvvvv)
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fails=0

echo "== link 1: pure-JS rasterizer (browser) vs Rust rasterizer =="
for g in "${GAMES[@]}"; do
  for s in "${SEEDS[@]}"; do
    PLAYTRAIN_RASTERIZER=js   node native/reference_trace.mjs "$g" "$s" "$NSTEPS" > "$TMP/$g.$s.js"   2>"$TMP/$g.$s.jserr"
    PLAYTRAIN_RASTERIZER=wasm node native/reference_trace.mjs "$g" "$s" "$NSTEPS" > "$TMP/$g.$s.wasm" 2>"$TMP/$g.$s.wasmerr"
    if [ ! -s "$TMP/$g.$s.js" ] || [ ! -s "$TMP/$g.$s.wasm" ]; then
      echo "  ERROR $g seed=$s: a trace produced no output"
      head -3 "$TMP/$g.$s.jserr" "$TMP/$g.$s.wasmerr" | sed 's/^/         /'
      fails=$((fails + 1))
    elif diff -q "$TMP/$g.$s.js" "$TMP/$g.$s.wasm" >/dev/null; then
      echo "  PASS  $g seed=$s ($NSTEPS steps, obs hashes bit-identical)"
    else
      echo "  FAIL  $g seed=$s: rasterizers disagree"
      diff "$TMP/$g.$s.js" "$TMP/$g.$s.wasm" | head -4 | sed 's/^/         /'
      fails=$((fails + 1))
    fi
  done
done

echo
echo "== link 2: node+V8+wasm vs native QuickJS+Rust (the training backend) =="
if [ ! -x native/build/qjs_host ]; then
  echo "  SKIPPED: native/build/qjs_host not built (run native/build_qjs.sh)"
else
  for g in "${GAMES[@]}"; do
    if native/gate_qjs.sh "$g" "$NSTEPS" "${SEEDS[@]}" 2>&1 | grep -qE "^  FAIL|DIVERGES"; then
      echo "  FAIL  $g: diverges from the native backend"
      native/gate_qjs.sh "$g" "$NSTEPS" "${SEEDS[@]}" 2>&1 | grep -A3 -E "^  FAIL" | head -6 | sed 's/^/         /'
      fails=$((fails + 1))
    else
      echo "  PASS  $g (${NSTEPS} steps × ${#SEEDS[@]} seed(s) bit-exact)"
    fi
  done
fi

echo
if [ "$fails" -eq 0 ]; then
  echo "parity holds: the participant's pixels and dynamics match the training backend."
  echo "NOTE: this proves V8 == QuickJS. It says nothing about Safari's JavaScriptCore or"
  echo "      Firefox's SpiderMonkey, where a last-bit Math difference could diverge a"
  echo "      trajectory -- see study/README.md. verify-replay is the per-session backstop."
else
  echo "$fails parity failure(s) -- the human is NOT playing the agent's environment."
  exit 1
fi
