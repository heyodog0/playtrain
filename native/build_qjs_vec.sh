#!/usr/bin/env bash
# build_qjs_vec.sh — build the vectorized (threadpool) QuickJS backend as a shared
# library (build/libqjs_vec.{dylib,so}), loaded from Python via ctypes.
# Reuses the rasterizer + QuickJS + frozenmath staticlibs from build_qjs.sh
# (run build_qjs.sh at least once first so those are present).
set -euo pipefail
cd "$(dirname "$0")"

RASTER_LIB="../crates/rasterizer/target/release/libnode_gym_rasterizer.a"
[ -f "$RASTER_LIB" ] || (cd ../crates/rasterizer && cargo rustc --release --lib --crate-type staticlib)
[ -f frozenmath/libfrozenmath.a ] || { echo "run build_qjs.sh first (frozenmath missing)"; exit 1; }
[ -f qjs/bld/libqjs.a ] || { echo "run build_qjs.sh first (libqjs missing)"; exit 1; }

mkdir -p build
CXXFLAGS="-std=c++17 -O3 -ffp-contract=off -fno-fast-math -Wno-c++11-narrowing -fPIC -I runtime -I qjs/src"
SRCS="qjs/qjs_vec_host.cpp runtime/p5.cpp"

case "$(uname)" in
  Darwin)
    # dylibs tolerate the existing (non-PIC-archived) staticlibs directly.
    clang++ $CXXFLAGS -dynamiclib \
      $SRCS "$RASTER_LIB" qjs/bld/libqjs.a frozenmath/libfrozenmath.a \
      -o build/libqjs_vec.dylib
    echo "built build/libqjs_vec.dylib"
    ;;
  *)
    # Linux shared objects require position-independent deps. The rasterizer (Rust
    # staticlib) is already PIC; quickjs + frozenmath (plain `clang -c`) are not,
    # so build PIC copies here, kept separate from the non-PIC libs qjs_host uses.
    if [ ! -f qjs/bld_pic/libqjs.a ] || [ qjs/src/quickjs.c -nt qjs/bld_pic/libqjs.a ]; then
      mkdir -p qjs/bld_pic
      for f in quickjs libregexp libunicode dtoa; do
        clang -c -fPIC -O2 -DNDEBUG -D_GNU_SOURCE -I qjs/src qjs/src/$f.c -o qjs/bld_pic/$f.o
      done
      ar rcs qjs/bld_pic/libqjs.a qjs/bld_pic/quickjs.o qjs/bld_pic/libregexp.o qjs/bld_pic/libunicode.o qjs/bld_pic/dtoa.o
    fi
    if [ ! -f frozenmath/libfrozenmath_pic.a ]; then
      A="$(pwd)/frozenmath/src"
      mkdir -p frozenmath/pic
      for f in e_pow e_atan2 s_atan s_scalbn; do
        clang -c -fPIC -O2 -DNDEBUG -w -Datan=fm_atan -I"$A/include" -I"$A/src" \
          frozenmath/src/src/$f.c -o frozenmath/pic/$f.o
      done
      ar rcs frozenmath/libfrozenmath_pic.a frozenmath/pic/e_pow.o frozenmath/pic/e_atan2.o frozenmath/pic/s_atan.o frozenmath/pic/s_scalbn.o
    fi
    clang++ $CXXFLAGS -shared \
      $SRCS "$RASTER_LIB" qjs/bld_pic/libqjs.a frozenmath/libfrozenmath_pic.a \
      -lpthread -lm -ldl \
      -o build/libqjs_vec.so
    echo "built build/libqjs_vec.so"
    ;;
esac
