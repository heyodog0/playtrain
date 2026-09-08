#!/usr/bin/env bash
# build_qjs.sh — build the QuickJS-hosted native backend (build/qjs_host).
# Builds: rasterizer staticlib (cargo) + QuickJS staticlib (clang) + qjs_host.
set -euo pipefail
cd "$(dirname "$0")"

RASTER_LIB="../crates/rasterizer/target/release/libplaytrain_rasterizer.a"
[ -f "$RASTER_LIB" ] || (cd ../crates/rasterizer && cargo rustc --release --lib --crate-type staticlib)

# frozen transcendentals (vendored fdlibm/openlibm) — same source native + wasm so
# pow/atan2/sin/cos are bit-identical across platforms/engines. Exposed as fm_*.
# sin/cos were added when a generated asteroids clone exposed that the psin/pcos
# polynomial in jsmath.h diverges from V8's fdlibm sine once game logic calls
# Math.sin (the poly is only for rasterizer-internal geometry). fm_sin/fm_cos
# are fdlibm with full Payne-Hanek reduction — the same lineage V8 ships.
if [ ! -f frozenmath/libfrozenmath.a ] || ! nm frozenmath/libfrozenmath.a 2>/dev/null | grep -q fm_sin; then
  [ -d frozenmath/src ] || git clone --depth 1 https://github.com/JuliaMath/openlibm.git frozenmath/src
  # rename the public symbols to fm_* so they never collide with the platform libm
  sed -i.bak -e 's/#define[[:space:]]*__ieee754_pow[[:space:]]*pow/#define __ieee754_pow fm_pow/' \
             -e 's/#define[[:space:]]*__ieee754_atan2[[:space:]]*atan2/#define __ieee754_atan2 fm_atan2/' \
             frozenmath/src/src/math_private.h
  ( cd frozenmath && A=$(pwd)/src && rm -f *.o libfrozenmath.a \
    && clang -c -O2 -DNDEBUG -w -Datan=fm_atan -I"$A/include" -I"$A/src" \
      src/src/e_pow.c src/src/e_atan2.c src/src/s_atan.c src/src/s_scalbn.c \
      src/src/k_sin.c src/src/k_cos.c src/src/e_rem_pio2.c src/src/k_rem_pio2.c \
    && clang -c -O2 -DNDEBUG -w -Dsin=fm_sin -I"$A/include" -I"$A/src" -o s_sin.o src/src/s_sin.c \
    && clang -c -O2 -DNDEBUG -w -Dcos=fm_cos -I"$A/include" -I"$A/src" -o s_cos.o src/src/s_cos.c \
    && ar rcs libfrozenmath.a e_pow.o e_atan2.o s_atan.o s_scalbn.o \
         s_sin.o s_cos.o k_sin.o k_cos.o e_rem_pio2.o k_rem_pio2.o )
fi
FROZEN="frozenmath/libfrozenmath.a"

# QuickJS static lib — STOCK quickjs-ng. A custom tracing JIT was tried and dropped on
# 2026-07-11: off by default, and a net slowdown on the render-bound games.
if [ ! -f qjs/bld/libqjs.a ]; then
  [ -d qjs/src ] || git clone --depth 1 https://github.com/quickjs-ng/quickjs.git qjs/src
  mkdir -p qjs/bld
  # Engine at -O3 (+x86-64-v3 on Intel/AMD): +6% env throughput vs -O2; v3
  # beat -march=native (AVX-512 codegen hurt). -ffp-contract=off keeps JS
  # float math FMA-free (bit-exact gate arbitrates). PGO measured -11.5% —
  # don't. Measured 2026-07-20 on cqhex2_teff, gate-passed all 52 games.
  # PLAYTRAIN_ARCH overrides the default for portable (wheel) builds; see hatch_build.py.
  QJS_ARCH=""; case "$(uname -m)" in x86_64|amd64) QJS_ARCH="-march=${PLAYTRAIN_ARCH:-x86-64-v3}";; esac
  ( cd qjs/src && clang -c -O3 $QJS_ARCH -ffp-contract=off -DNDEBUG -D_GNU_SOURCE -I. quickjs.c libregexp.c libunicode.c dtoa.c )
  ar rcs qjs/bld/libqjs.a qjs/src/quickjs.o qjs/src/libregexp.o qjs/src/libunicode.o qjs/src/dtoa.o
fi

mkdir -p build
# extra libs: pthread/m/dl needed by quickjs on Linux (harmless on macOS)
EXTRA=""
case "$(uname)" in Linux) EXTRA="-lpthread -lm -ldl";; esac
clang++ -std=c++17 -O3 -ffp-contract=off -fno-fast-math -Wno-c++11-narrowing \
  -I runtime -I qjs/src \
  qjs/qjs_host.cpp runtime/p5.cpp "$RASTER_LIB" qjs/bld/libqjs.a "$FROZEN" $EXTRA \
  -o build/qjs_host

echo "built build/qjs_host"
