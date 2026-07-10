#!/usr/bin/env bash
# build_qjs.sh — build the QuickJS-hosted native backend (build/qjs_host).
# Builds: rasterizer staticlib (cargo) + QuickJS staticlib (clang) + qjs_host.
set -euo pipefail
cd "$(dirname "$0")"

RASTER_LIB="../crates/rasterizer/target/release/libnode_gym_rasterizer.a"
[ -f "$RASTER_LIB" ] || (cd ../crates/rasterizer && cargo rustc --release --lib --crate-type staticlib)

# QuickJS static lib (clone quickjs-ng if absent; build core objects -> .a)
if [ ! -f qjs/bld/libqjs.a ]; then
  [ -d qjs/src ] || git clone --depth 1 https://github.com/quickjs-ng/quickjs.git qjs/src
  mkdir -p qjs/bld
  ( cd qjs/src && clang -c -O2 -DNDEBUG -D_GNU_SOURCE -I. quickjs.c libregexp.c libunicode.c dtoa.c \
    && ar rcs ../bld/libqjs.a quickjs.o libregexp.o libunicode.o dtoa.o )
fi

mkdir -p build
# extra libs: pthread/m/dl needed by quickjs on Linux (harmless on macOS)
EXTRA=""
case "$(uname)" in Linux) EXTRA="-lpthread -lm -ldl";; esac
clang++ -std=c++17 -O3 -ffp-contract=off -fno-fast-math -Wno-c++11-narrowing \
  -I runtime -I qjs/src \
  qjs/qjs_host.cpp runtime/p5.cpp "$RASTER_LIB" qjs/bld/libqjs.a $EXTRA \
  -o build/qjs_host

echo "built build/qjs_host"
