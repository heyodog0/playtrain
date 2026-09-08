#!/usr/bin/env bash
# gate_fork.sh — differential bit-exact gate for the L1 fork harness.
# Same protocol as ../gate_qjs.sh (V8+wasm reference via reference_trace.mjs,
# 3 seeds x N steps, byte-identical stdout), but for the F0 (fork interpreter)
# and F1 (qjsc -A per game) hosts, and it also runs any extra host binaries
# given via EXTRA_HOSTS (e.g. the adopted ng qjs_host) so all lineages are
# gated in ONE job on ONE node against ONE reference run.
#
#   gate_fork.sh <out_dir> --all [nsteps]        # every game in $GAMES_DIR
#   gate_fork.sh <out_dir> <game>... [--steps N]
# Env: GAMES_DIR (default ../../examples/games/js), SEEDS ("1 42 777"),
#      EXTRA_HOSTS ("name=/path/to/host ..."), REFDIR (cache of reference traces).
# F1 stderr is scanned for "Bytecode mismatch": an AOT'd function that fell back
# to the interpreter is a FAIL here even when the trace matches (it would silently
# undercount the AOT effect in the bench).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$1"; shift
GAMES_DIR="${GAMES_DIR:-$HERE/../../examples/games/js}"
SEEDS="${SEEDS:-1 42 777}"
N=3000
REFDIR="${REFDIR:-$OUT/gate_ref}"; mkdir -p "$REFDIR" "$OUT/gate_tmp"
GAMES=()
if [ "${1:-}" = "--all" ]; then shift; [ -n "${1:-}" ] && N="$1"; for f in "$GAMES_DIR"/*.js; do GAMES+=("$(basename "$f" .js)"); done
else while [ $# -gt 0 ]; do case "$1" in --steps) N="$2"; shift 2;; *) GAMES+=("$1"); shift;; esac; done; fi

pass=0; fail=0; failed=()
for g in "${GAMES[@]}"; do
  for s in $SEEDS; do
    ref="$REFDIR/${g}_${s}_${N}.txt"
    [ -s "$ref" ] || ( cd "$HERE/.." && node reference_trace.mjs "$g" "$s" "$N" > "$ref" 2>/dev/null )
    hosts=("f0=$OUT/host_f0")
    [ -x "$OUT/host_f1_$g" ] && hosts+=("f1=$OUT/host_f1_$g")
    for kv in ${EXTRA_HOSTS:-}; do hosts+=("$kv"); done
    for kv in "${hosts[@]}"; do
      name="${kv%%=*}"; bin="${kv#*=}"
      [ -x "$bin" ] || { echo "  SKIP $g seed=$s $name: no binary $bin"; continue; }
      o="$OUT/gate_tmp/${name}_${g}_${s}.txt"; e="$OUT/gate_tmp/${name}_${g}_${s}.err"
      "$bin" "$GAMES_DIR/$g.js" trace "$s" "$N" > "$o" 2> "$e"
      if ! cmp -s "$ref" "$o"; then
        echo "  FAIL $g seed=$s $name: DIVERGES"; diff "$ref" "$o" | head -4 | sed 's/^/      /'
        fail=$((fail+1)); failed+=("$name:$g:$s")
      elif [ "$name" = f1 ] && grep -q "Bytecode mismatch" "$e"; then
        echo "  FAIL $g seed=$s $name: trace exact but $(grep -c 'Bytecode mismatch' "$e") function(s) NOT AOT-compiled"
        fail=$((fail+1)); failed+=("$name:$g:$s:mismatch")
      else
        echo "  PASS $g seed=$s $name"; pass=$((pass+1))
      fi
    done
  done
done
echo "GATE: $pass PASS, $fail FAIL (${#GAMES[@]} games x $(echo $SEEDS | wc -w | tr -d ' ') seeds x $N steps)"
[ $fail -eq 0 ] || { printf '  %s\n' "${failed[@]}"; exit 1; }
