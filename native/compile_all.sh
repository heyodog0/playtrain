#!/usr/bin/env bash
# compile_all.sh — transpile + compile + gate a list of games; summarize which
# reach TRANSPILE / COMPILE / GATE. Usage: ./compile_all.sh <game...>
cd "$(dirname "$0")"
RASTER_LIB="../crates/rasterizer/target/release/libplaytrain_rasterizer.a"
mkdir -p build/gen
N=4000
declare -a T_OK C_OK G_OK T_FAIL C_FAIL G_FAIL

for g in "$@"; do
  gen="build/gen/${g}.cpp"
  if ! node compile/transpile.mjs "../examples/games/js/${g}.js" > "$gen" 2>"build/gen/${g}.err"; then
    T_FAIL+=("$g: $(head -1 build/gen/${g}.err | sed 's/.*Error: //')"); continue
  fi
  T_OK+=("$g")
  if ! clang++ -std=c++17 -O2 -ffp-contract=off -fno-fast-math -Wno-c++11-narrowing -I runtime \
      runtime/main.cpp runtime/p5.cpp "$gen" "$RASTER_LIB" -o "build/gen/${g}" 2>"build/gen/${g}.cerr"; then
    C_FAIL+=("$g: $(grep -m1 'error:' build/gen/${g}.cerr | sed 's/.*error: //' | cut -c1-70)"); continue
  fi
  C_OK+=("$g")
  # gate on 3 seeds
  ok=1
  for S in 1 42 12345; do
    node reference_trace.mjs "$g" "$S" "$N" > "/tmp/ca_js.txt" 2>/dev/null
    "build/gen/${g}" trace "$S" "$N" > "/tmp/ca_nv.txt" 2>/dev/null
    diff -q /tmp/ca_js.txt /tmp/ca_nv.txt >/dev/null || { ok=0; cp /tmp/ca_js.txt "build/gen/${g}.js_$S"; cp /tmp/ca_nv.txt "build/gen/${g}.nv_$S"; break; }
  done
  if [ $ok -eq 1 ]; then G_OK+=("$g"); else G_FAIL+=("$g"); fi
done

echo "================ SUMMARY (${#@} games) ================"
echo "TRANSPILE ok: ${#T_OK[@]}   COMPILE ok: ${#C_OK[@]}   GATE PASS: ${#G_OK[@]}"
echo
echo "✅ GATE PASS (${#G_OK[@]}): ${G_OK[*]}"
[ ${#G_FAIL[@]} -gt 0 ] && { echo; echo "⚠️  COMPILED but GATE FAIL (${#G_FAIL[@]}): ${G_FAIL[*]}"; }
[ ${#C_FAIL[@]} -gt 0 ] && { echo; echo "❌ COMPILE FAIL (${#C_FAIL[@]}):"; printf '   %s\n' "${C_FAIL[@]}"; }
[ ${#T_FAIL[@]} -gt 0 ] && { echo; echo "❌ TRANSPILE FAIL (${#T_FAIL[@]}):"; printf '   %s\n' "${T_FAIL[@]}"; }
