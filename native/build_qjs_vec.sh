#!/usr/bin/env bash
# build_qjs_vec.sh — build the vectorized (threadpool) QuickJS backend as a shared
# library (build/libqjs_vec.{dylib,so}), loaded from Python via ctypes.
# Reuses the same rasterizer + QuickJS + frozenmath staticlibs as build_qjs.sh
# (run build_qjs.sh at least once first so those are present).
set -euo pipefail
cd "$(dirname "$0")"

RASTER_LIB="../crates/rasterizer/target/release/libnode_gym_rasterizer.a"
[ -f "$RASTER_LIB" ] || (cd ../crates/rasterizer && cargo rustc --release --lib --crate-type staticlib)
[ -f frozenmath/libfrozenmath.a ] || { echo "run build_qjs.sh first (frozenmath missing)"; exit 1; }
[ -f qjs/bld/libqjs.a ] || { echo "run build_qjs.sh first (libqjs missing)"; exit 1; }
FROZEN="frozenmath/libfrozenmath.a"

mkdir -p build
case "$(uname)" in
  Darwin) EXT="dylib"; SOFLAGS="-dynamiclib";;
  *)      EXT="so";    SOFLAGS="-shared -lpthread -lm -ldl";;
esac

clang++ -std=c++17 -O3 -ffp-contract=off -fno-fast-math -Wno-c++11-narrowing -fPIC $SOFLAGS \
  -I runtime -I qjs/src \
  qjs/qjs_vec_host.cpp runtime/p5.cpp "$RASTER_LIB" qjs/bld/libqjs.a "$FROZEN" \
  -o "build/libqjs_vec.$EXT"

echo "built build/libqjs_vec.$EXT"
