#!/usr/bin/env bash
# build_qjs_vec.sh — build the vectorized (threadpool) QuickJS backend as a shared
# library (build/libqjs_vec.{dylib,so}), loaded from Python via ctypes.
# Reuses the rasterizer + QuickJS + frozenmath staticlibs from build_qjs.sh
# (run build_qjs.sh at least once first so those are present).
set -euo pipefail
cd "$(dirname "$0")"

RASTER_LIB="../crates/rasterizer/target/release/libplaytrain_rasterizer.a"
if [ ! -f "$RASTER_LIB" ]; then
  # Match the engine's -march=x86-64-v3 (see QJS_ARCH below); integer-only
  # rasterizer, so vectorization cannot change output — the gate still runs.
  RUST_ARCH=""; case "$(uname -m)" in x86_64|amd64) RUST_ARCH="-C target-cpu=${PLAYTRAIN_ARCH:-x86-64-v3}";; esac
  (cd ../crates/rasterizer && RUSTFLAGS="${RUSTFLAGS:-} $RUST_ARCH" cargo rustc --release --lib --crate-type staticlib)
fi
[ -f frozenmath/libfrozenmath.a ] || { echo "run build_qjs.sh first (frozenmath missing)"; exit 1; }
[ -f qjs/bld/libqjs.a ] || { echo "run build_qjs.sh first (libqjs missing)"; exit 1; }

bash gen_matter_header.sh          # qjs/matter_bundle.h, compiled into the host
mkdir -p build
CXXFLAGS="-std=c++17 -O3 -ffp-contract=off -fno-fast-math -Wno-c++11-narrowing -fPIC -I runtime -I qjs/src"
# V8's ieee754.cc gets its own object with FMA contraction set the way node's own
# V8 build has it: clang's default (on) for arm64, which is what Apple-silicon node
# ships, and off for x86-64, where node targets baseline x86-64 without FMA. One
# input in suika (sin(3*pi/20)) is 1 ULP apart between the two settings, and the
# gate needs the reference's. Everything else in the host stays -ffp-contract=off.
case "$(uname -m)" in arm64|aarch64) V8_FPC="-ffp-contract=on";; *) V8_FPC="-ffp-contract=off";; esac
clang++ -std=c++17 -O3 $V8_FPC -fno-fast-math -fPIC -c qjs/v8libm/ieee754.cc -o build/v8_ieee754.o
SRCS="qjs/qjs_vec_host.cpp runtime/p5.cpp build/v8_ieee754.o"

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
      # Same engine flags as build_qjs.sh (-O3 + x86-64-v3, no FMA): +6% env
      # throughput, gate-passed. Keep the two builds' flags in lockstep — the
      # gate runs qjs_host but training loads this .so.
      QJS_ARCH=""; case "$(uname -m)" in x86_64|amd64) QJS_ARCH="-march=${PLAYTRAIN_ARCH:-x86-64-v3}";; esac
      for f in quickjs libregexp libunicode dtoa; do
        clang -c -fPIC -O3 $QJS_ARCH -ffp-contract=off -DNDEBUG -D_GNU_SOURCE -I qjs/src qjs/src/$f.c -o qjs/bld_pic/$f.o
      done
      ar rcs qjs/bld_pic/libqjs.a qjs/bld_pic/quickjs.o qjs/bld_pic/libregexp.o qjs/bld_pic/libunicode.o qjs/bld_pic/dtoa.o
    fi
    if [ ! -f frozenmath/libfrozenmath_pic.a ] || ! nm frozenmath/libfrozenmath_pic.a 2>/dev/null | grep -q fm_sin; then
      A="$(pwd)/frozenmath/src"
      mkdir -p frozenmath/pic
      rm -f frozenmath/pic/*.o frozenmath/libfrozenmath_pic.a
      for f in e_pow e_atan2 s_atan s_scalbn k_sin k_cos e_rem_pio2 k_rem_pio2; do
        clang -c -fPIC -O2 -DNDEBUG -w -Datan=fm_atan -I"$A/include" -I"$A/src" \
          frozenmath/src/src/$f.c -o frozenmath/pic/$f.o
      done
      # fm_sin/fm_cos: fdlibm sin/cos (game-visible Math.sin — see build_qjs.sh)
      clang -c -fPIC -O2 -DNDEBUG -w -Dsin=fm_sin -I"$A/include" -I"$A/src" \
        frozenmath/src/src/s_sin.c -o frozenmath/pic/s_sin.o
      clang -c -fPIC -O2 -DNDEBUG -w -Dcos=fm_cos -I"$A/include" -I"$A/src" \
        frozenmath/src/src/s_cos.c -o frozenmath/pic/s_cos.o
      ar rcs frozenmath/libfrozenmath_pic.a frozenmath/pic/*.o
    fi
    clang++ $CXXFLAGS -shared \
      $SRCS "$RASTER_LIB" qjs/bld_pic/libqjs.a frozenmath/libfrozenmath_pic.a \
      -lpthread -lm -ldl \
      -o build/libqjs_vec.so
    echo "built build/libqjs_vec.so"
    ;;
esac
