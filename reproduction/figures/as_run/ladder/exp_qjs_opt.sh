#!/usr/bin/env bash
# exp_qjs_opt.sh — rebuild the QuickJS engine objects (PIC + non-PIC) with custom
# flags and relink qjs_host + libqjs_vec.so. Backs up originals on first run.
#   QJS_OPT="-O3 -march=native" ./exp_qjs_opt.sh
#   QJS_OPT="-O3 -march=native -fprofile-generate=/tmp/qjspgo" ./exp_qjs_opt.sh
#   QJS_OPT="-O3 -march=native -fprofile-use=/tmp/qjspgo/merged.profdata" ./exp_qjs_opt.sh
set -euo pipefail
cd "$(dirname "$0")"   # node-gym-git/native

OPT="${QJS_OPT:--O2}"
echo "=== engine flags: $OPT ==="

# one-time backups of the shipping artifacts
[ -f build/libqjs_vec.so.bakO2 ] || cp build/libqjs_vec.so build/libqjs_vec.so.bakO2
[ -f build/qjs_host.bakO2 ]      || cp build/qjs_host build/qjs_host.bakO2

# --- non-PIC engine (qjs_host / gate path) ---
( cd qjs/src && clang -c $OPT -ffp-contract=off -DNDEBUG -D_GNU_SOURCE -I. \
    quickjs.c libregexp.c libunicode.c dtoa.c )
ar rcs qjs/bld/libqjs.a qjs/src/quickjs.o qjs/src/libregexp.o qjs/src/libunicode.o qjs/src/dtoa.o

# --- PIC engine (libqjs_vec.so / training path) ---
mkdir -p qjs/bld_pic
for f in quickjs libregexp libunicode dtoa; do
  clang -c -fPIC $OPT -ffp-contract=off -DNDEBUG -D_GNU_SOURCE -I qjs/src qjs/src/$f.c -o qjs/bld_pic/$f.o
done
ar rcs qjs/bld_pic/libqjs.a qjs/bld_pic/quickjs.o qjs/bld_pic/libregexp.o qjs/bld_pic/libunicode.o qjs/bld_pic/dtoa.o

RASTER_LIB="../crates/rasterizer/target/release/libnode_gym_rasterizer.a"
CXXFLAGS="-std=c++17 -O3 -ffp-contract=off -fno-fast-math -Wno-c++11-narrowing -fPIC -I runtime -I qjs/src"
LINKOPT=""
case "$OPT" in *profile-generate*|*profile-use*) LINKOPT="$OPT";; esac

# relink qjs_host (mirror build_qjs.sh link line)
clang++ -std=c++17 -O3 -ffp-contract=off -fno-fast-math -Wno-c++11-narrowing $LINKOPT \
  -I runtime -I qjs/src \
  qjs/qjs_host.cpp runtime/p5.cpp "$RASTER_LIB" qjs/bld/libqjs.a frozenmath/libfrozenmath.a \
  -lpthread -lm -ldl -o build/qjs_host

# relink libqjs_vec.so (mirror build_qjs_vec.sh link line)
clang++ $CXXFLAGS $LINKOPT -shared \
  qjs/qjs_vec_host.cpp runtime/p5.cpp "$RASTER_LIB" qjs/bld_pic/libqjs.a frozenmath/libfrozenmath_pic.a \
  -lpthread -lm -ldl -o build/libqjs_vec.so

echo "rebuilt build/qjs_host + build/libqjs_vec.so with: $OPT"
