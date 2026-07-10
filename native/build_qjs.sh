#!/usr/bin/env bash
# build_qjs.sh — build the QuickJS-hosted native backend (build/qjs_host).
# Builds: rasterizer staticlib (cargo) + QuickJS staticlib (clang) + qjs_host.
set -euo pipefail
cd "$(dirname "$0")"

RASTER_LIB="../crates/rasterizer/target/release/libnode_gym_rasterizer.a"
[ -f "$RASTER_LIB" ] || (cd ../crates/rasterizer && cargo rustc --release --lib --crate-type staticlib)

# frozen transcendentals (vendored fdlibm/openlibm) — same source native + wasm so
# pow/atan2 are bit-identical across platforms/engines. Exposed as fm_pow/fm_atan2.
if [ ! -f frozenmath/libfrozenmath.a ]; then
  [ -d frozenmath/src ] || git clone --depth 1 https://github.com/JuliaMath/openlibm.git frozenmath/src
  # rename the public symbols to fm_* so they never collide with the platform libm
  sed -i.bak -e 's/#define[[:space:]]*__ieee754_pow[[:space:]]*pow/#define __ieee754_pow fm_pow/' \
             -e 's/#define[[:space:]]*__ieee754_atan2[[:space:]]*atan2/#define __ieee754_atan2 fm_atan2/' \
             frozenmath/src/src/math_private.h
  ( cd frozenmath && A=$(pwd)/src && clang -c -O2 -DNDEBUG -w -Datan=fm_atan -I"$A/include" -I"$A/src" \
      src/src/e_pow.c src/src/e_atan2.c src/src/s_atan.c src/src/s_scalbn.c \
    && ar rcs libfrozenmath.a e_pow.o e_atan2.o s_atan.o s_scalbn.o )
fi
FROZEN="frozenmath/libfrozenmath.a"

# QuickJS static lib (clone quickjs-ng if absent; apply qjit instrumentation
# patch; build core objects + qjit.o -> .a). jit/quickjs-qjit.patch adds the
# tracing-JIT hooks (hot-loop back-edge counters) to the interpreter.
if [ ! -f qjs/bld/libqjs.a ]; then
  [ -d qjs/src ] || git clone --depth 1 https://github.com/quickjs-ng/quickjs.git qjs/src
  ( cd qjs/src && git apply --reverse --check ../../jit/quickjs-qjit.patch 2>/dev/null \
    || git apply ../../jit/quickjs-qjit.patch )   # apply once (idempotent-ish)
  mkdir -p qjs/bld
  ( cd qjs/src && clang -c -O2 -DNDEBUG -D_GNU_SOURCE -I. -I../../jit quickjs.c libregexp.c libunicode.c dtoa.c )
  clang -c -O2 -I jit jit/qjit.c -o jit/qjit.o
  ar rcs qjs/bld/libqjs.a qjs/src/quickjs.o qjs/src/libregexp.o qjs/src/libunicode.o qjs/src/dtoa.o jit/qjit.o
fi

mkdir -p build
# extra libs: pthread/m/dl needed by quickjs on Linux (harmless on macOS)
EXTRA=""
case "$(uname)" in Linux) EXTRA="-lpthread -lm -ldl";; esac
clang++ -std=c++17 -O3 -ffp-contract=off -fno-fast-math -Wno-c++11-narrowing \
  -I runtime -I qjs/src -I jit \
  qjs/qjs_host.cpp runtime/p5.cpp "$RASTER_LIB" qjs/bld/libqjs.a "$FROZEN" $EXTRA \
  -o build/qjs_host

echo "built build/qjs_host"
