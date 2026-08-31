#!/usr/bin/env bash
# build_qjs_vec_tune.sh — round-2 tuned builds of libqjs_vec.so on top of the
# PGO+thin-LTO pipeline (build_qjs_vec_pgo.sh). Linux/x86 only. Knobs (env):
#
#   CPP_MODE      use   : -fprofile-use=$CPP_PROFDATA            (default)
#                 csgen : use + -fcs-profile-generate=$CS_DIR    (instrumented)
#                 csuse : -fprofile-use=$CPP_PROFDATA (combined base+cs)
#   CPP_PROFDATA  path to .profdata (required)
#   CS_DIR        csgen only: where cs profraws land
#   RUST_MODE     prebuilt : use the existing rasterizer .a      (default)
#                 gen      : rebuild .a with -Cprofile-generate=$RUST_PROFDIR
#                 use      : rebuild .a with -Cprofile-use=$RUST_PROFDATA
#   VIS=1         -fvisibility=hidden everywhere + version script at link
#                 (vec_* stays exported via the pragma in qjs_vec_host.cpp)
#   XLTO=1        cross-language thin-LTO: rust emits bitcode
#                 (-Clinker-plugin-lto), final link through rust-lld (LLVM 22,
#                 reads both clang-21 and rustc bitcode). Implies RUST_MODE
#                 gen/use (needs a rebuilt .a).
#   OUT           output .so (default build/libqjs_vec.so)
#   SKIP_HOST=1   don't build the matching qjs_host (instrumented modes)
#
# Determinism flags (-ffp-contract=off -fno-fast-math) on every compile and
# on the link line. C++ thin-LTO is always on (the l12pgo baseline had it).
set -euo pipefail
cd "$(dirname "$0")"

CPP_MODE="${CPP_MODE:-use}"
CPP_PROFDATA="${CPP_PROFDATA:?set CPP_PROFDATA}"
RUST_MODE="${RUST_MODE:-prebuilt}"
VIS="${VIS:-0}"
XLTO="${XLTO:-0}"
OUT="${OUT:-build/libqjs_vec.so}"

FPFLAGS="-ffp-contract=off -fno-fast-math"
VISFLAG=""; [ "$VIS" = 1 ] && VISFLAG="-fvisibility=hidden"
CXXFLAGS="-std=c++17 -O3 $FPFLAGS $VISFLAG -Wno-c++11-narrowing -fPIC -I runtime -I qjs/src"
ENGFLAGS="-O3 -march=x86-64-v3 -ffp-contract=off $VISFLAG -DNDEBUG -D_GNU_SOURCE -fPIC"
SRCS="qjs/qjs_vec_host.cpp runtime/p5.cpp"

case "$CPP_MODE" in
  use)   PGO="-fprofile-use=$CPP_PROFDATA -flto=thin" ;;
  csgen) PGO="-fprofile-use=$CPP_PROFDATA -fcs-profile-generate=${CS_DIR:?set CS_DIR} -flto=thin"
         mkdir -p "$CS_DIR" ;;
  csuse) PGO="-fprofile-use=$CPP_PROFDATA -flto=thin" ;;
  *) echo "bad CPP_MODE"; exit 1 ;;
esac

# ---- rasterizer .a ----
RASTER_LIB="../crates/rasterizer/target/release/libplaytrain_rasterizer.a"
if [ "$RUST_MODE" != prebuilt ]; then
  RF="-C target-cpu=x86-64-v3"
  case "$RUST_MODE" in
    gen) RF="$RF -Cprofile-generate=${RUST_PROFDIR:?set RUST_PROFDIR}"; mkdir -p "$RUST_PROFDIR" ;;
    use) RF="$RF -Cprofile-use=${RUST_PROFDATA:?set RUST_PROFDATA}" ;;
  esac
  LTOENV=()
  if [ "$XLTO" = 1 ]; then
    RF="$RF -Clinker-plugin-lto -Cembed-bitcode=yes"
    LTOENV=(CARGO_PROFILE_RELEASE_LTO=false)   # rustc-internal LTO conflicts with plugin LTO
  fi
  ( cd ../crates/rasterizer && rm -f target/release/libplaytrain_rasterizer.a \
    && env "${LTOENV[@]}" RUSTFLAGS="$RF" cargo rustc --release --lib --crate-type staticlib )
fi
[ -f "$RASTER_LIB" ] || { echo "rasterizer .a missing"; exit 1; }
[ -f frozenmath/libfrozenmath_pic.a ] || { echo "run build_qjs_vec.sh once first"; exit 1; }

# ---- engine objects (flavor-specific build dir so nothing stale mixes) ----
BLD="qjs/bld_tune_${CPP_MODE}_v${VIS}_x${XLTO}"
mkdir -p "$BLD" build
for f in quickjs libregexp libunicode dtoa; do
  clang -c $ENGFLAGS $PGO -I qjs/src "qjs/src/$f.c" -o "$BLD/$f.o"
done
rm -f "$BLD/libqjs.a"
ar rcs "$BLD/libqjs.a" "$BLD"/quickjs.o "$BLD"/libregexp.o "$BLD"/libunicode.o "$BLD"/dtoa.o

# ---- link ----
LDEXTRA="$FPFLAGS"
[ "$VIS" = 1 ] && LDEXTRA="$LDEXTRA -Wl,--version-script,$(pwd)/vec_exports.map"
if [ "$XLTO" = 1 ]; then
  # rust-lld must be invoked as ld.lld to pick the GNU flavor
  LLDDIR="$(mktemp -d)"
  RUSTLLD="$(find "$HOME/.rustup/toolchains" -name rust-lld -path "*x86_64-unknown-linux-gnu/bin*" | head -1)"
  [ -n "$RUSTLLD" ] || { echo "rust-lld not found"; exit 1; }
  ln -s "$RUSTLLD" "$LLDDIR/ld.lld"
  LDEXTRA="$LDEXTRA -fuse-ld=lld --ld-path=$LLDDIR/ld.lld"
fi
clang++ $CXXFLAGS $PGO -shared \
  $SRCS "$RASTER_LIB" "$BLD/libqjs.a" frozenmath/libfrozenmath_pic.a \
  -lpthread -lm -ldl $LDEXTRA \
  -o "$OUT"
echo "built $OUT (CPP_MODE=$CPP_MODE RUST_MODE=$RUST_MODE VIS=$VIS XLTO=$XLTO)"

if [ "${SKIP_HOST:-0}" != 1 ]; then
  # matching qjs_host for the determinism gate (no version script — executable;
  # same PGO/vis/rust inputs so the gate exercises the same code)
  HOSTLD="$FPFLAGS"
  [ "$XLTO" = 1 ] && HOSTLD="$HOSTLD -fuse-ld=lld --ld-path=$LLDDIR/ld.lld"
  clang++ $CXXFLAGS $PGO \
    qjs/qjs_host.cpp runtime/p5.cpp "$RASTER_LIB" "$BLD/libqjs.a" \
    frozenmath/libfrozenmath_pic.a -lpthread -lm -ldl $HOSTLD \
    -o build/qjs_host
  echo "built build/qjs_host"
fi
