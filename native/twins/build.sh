#!/usr/bin/env bash
# build.sh — build native/twins/build/libtwin_vec.{dylib,so} (the vec_* ABI over native twins) and build/twin_host.
# Same flags and staticlibs as native/build_qjs_vec.sh (rasterizer, frozenmath, V8 ieee754 object); never touches
# native/build/. DEBUG=1 builds -O1 -g with -fsanitize=address,undefined (T1/T2 run under it first).
set -euo pipefail
cd "$(dirname "$0")"
NATIVE=..
OUT=build; mkdir -p "$OUT"
RASTER_LIB="$NATIVE/../crates/rasterizer/target/release/libplaytrain_rasterizer.a"
[ -f "$RASTER_LIB" ] || { echo "missing $RASTER_LIB (run native/build_qjs.sh once)"; exit 1; }
FROZEN="$NATIVE/frozenmath/libfrozenmath.a"; [ -f "$FROZEN" ] || { echo "missing $FROZEN (run native/build_qjs.sh once)"; exit 1; }
case "$(uname -m)" in arm64|aarch64) V8_FPC="-ffp-contract=on";; *) V8_FPC="-ffp-contract=off";; esac
[ -f "$OUT/v8_ieee754.o" ] || clang++ -std=c++17 -O3 $V8_FPC -fno-fast-math -fPIC -c "$NATIVE/qjs/v8libm/ieee754.cc" -o "$OUT/v8_ieee754.o"
OPT="-O3"; SAN=""
if [ "${DEBUG:-}" = 1 ]; then OPT="-O1 -g"; SAN="-fsanitize=address,undefined -fno-omit-frame-pointer"; fi
CXX="clang++ -std=c++17 $OPT $SAN -ffp-contract=off -fno-fast-math -Wall -Wno-unused-parameter -fPIC -I $NATIVE/runtime -I common -I third_party"
DEFS=""
SRCS="common/vec_host.cpp common/registry.cpp common/blank_twin.cpp $NATIVE/runtime/p5.cpp $OUT/v8_ieee754.o"
for fam in chip8 vgdl puzzlescript; do
  if ls $fam/*.cpp >/dev/null 2>&1; then SRCS="$SRCS $(ls $fam/*.cpp | tr '\n' ' ')"; DEFS="$DEFS -DTWIN_HAVE_$(echo $fam | tr a-z A-Z)"; fi
done
EXTRA=""; case "$(uname)" in Linux) EXTRA="-lpthread -lm -ldl";; esac
case "$(uname)" in
  Darwin) $CXX $DEFS -dynamiclib $SRCS "$RASTER_LIB" "$FROZEN" -o "$OUT/libtwin_vec.dylib"; LIB="$OUT/libtwin_vec.dylib";;
  *)      $CXX $DEFS -shared $SRCS "$RASTER_LIB" "$NATIVE/frozenmath/libfrozenmath_pic.a" $EXTRA -o "$OUT/libtwin_vec.so"; LIB="$OUT/libtwin_vec.so";;
esac
$CXX $DEFS $SRCS common/twin_host.cpp "$RASTER_LIB" "$FROZEN" $EXTRA -o "$OUT/twin_host"
if [ -f chip8/cpu.cpp ]; then $CXX tests/test_vectors.cpp chip8/cpu.cpp chip8/threefry.cpp -o "$OUT/test_vectors"; fi
if [ -f puzzlescript/vm.cpp ]; then $CXX tests/test_ps_reference.cpp puzzlescript/vm.cpp -o "$OUT/test_ps_reference"; fi
echo "built $LIB and $OUT/twin_host ($DEFS)"
