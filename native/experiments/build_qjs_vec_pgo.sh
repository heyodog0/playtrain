#!/usr/bin/env bash
# build_qjs_vec_pgo.sh — PGO (optionally +LTO) build of libqjs_vec.so.
# Two-phase:
#   PGO_MODE=gen PROFDIR=/abs/dir   ./build_qjs_vec_pgo.sh   # instrumented .so
#   PGO_MODE=use PROFDATA=/abs/f.profdata [LTO=1] ./build_qjs_vec_pgo.sh
# Output: build/libqjs_vec_pgogen.so (gen) or build/libqjs_vec.so (use),
# plus build/qjs_host (use mode) so the determinism gate runs the same build.
# Determinism flags (-ffp-contract=off -fno-fast-math) are kept on every
# compile AND on the link line — LTO re-optimizes at link time. Linux/x86 only.
set -euo pipefail
cd "$(dirname "$0")"

MODE="${PGO_MODE:?set PGO_MODE=gen or use}"
RASTER_LIB="../crates/rasterizer/target/release/libplaytrain_rasterizer.a"
[ -f "$RASTER_LIB" ] || { echo "rasterizer .a missing — build it first"; exit 1; }
[ -f frozenmath/libfrozenmath_pic.a ] || { echo "run build_qjs_vec.sh once first"; exit 1; }

FPFLAGS="-ffp-contract=off -fno-fast-math"
CXXFLAGS="-std=c++17 -O3 $FPFLAGS -Wno-c++11-narrowing -fPIC -I runtime -I qjs/src"
ENGFLAGS="-O3 -march=x86-64-v3 -ffp-contract=off -DNDEBUG -D_GNU_SOURCE -fPIC"
SRCS="qjs/qjs_vec_host.cpp runtime/p5.cpp"

if [ "$MODE" = gen ]; then
  PROFDIR="${PROFDIR:?set PROFDIR}"
  mkdir -p "$PROFDIR"
  PGO="-fprofile-generate=$PROFDIR"
  OUT=build/libqjs_vec_pgogen.so
  BLD=qjs/bld_pgo_gen
else
  PROFDATA="${PROFDATA:?set PROFDATA}"
  PGO="-fprofile-use=$PROFDATA"
  OUT=build/libqjs_vec.so
  BLD=qjs/bld_pgo_use
  if [ "${LTO:-0}" = 1 ]; then PGO="$PGO -flto=thin"; fi
fi

mkdir -p "$BLD" build
for f in quickjs libregexp libunicode dtoa; do
  clang -c $ENGFLAGS $PGO -I qjs/src "qjs/src/$f.c" -o "$BLD/$f.o"
done
rm -f "$BLD/libqjs.a"
ar rcs "$BLD/libqjs.a" "$BLD"/quickjs.o "$BLD"/libregexp.o "$BLD"/libunicode.o "$BLD"/dtoa.o

LDEXTRA=""
if [ "$MODE" = use ] && [ "${LTO:-0}" = 1 ] && command -v ld.lld >/dev/null; then
  LDEXTRA="-fuse-ld=lld"
fi
clang++ $CXXFLAGS $PGO -shared \
  $SRCS "$RASTER_LIB" "$BLD/libqjs.a" frozenmath/libfrozenmath_pic.a \
  -lpthread -lm -ldl $LDEXTRA \
  -o "$OUT"
echo "built $OUT"

if [ "$MODE" = use ]; then
  clang++ $CXXFLAGS $PGO \
    qjs/qjs_host.cpp runtime/p5.cpp "$RASTER_LIB" "$BLD/libqjs.a" \
    frozenmath/libfrozenmath_pic.a -lpthread -lm -ldl $LDEXTRA \
    -o build/qjs_host
  echo "built build/qjs_host (pgo)"
fi
