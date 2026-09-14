#!/usr/bin/env bash
# build.sh — build the Craftax-Classic parity reference driver (build/cc_ref).
#
# Compiles games/craftax_src/craftax_classic.h UNMODIFIED. Everything the
# header needs and we do not have comes from stubs/. See PLAN.md section 4.2.
#
# The three things this build pins, and why:
#
#  -ffp-contract=off   no FMA contraction, so the scalar Perlin path in
#                      generate_world rounds after every operation, the way
#                      Math.fround does in JS. (PufferLib's own AVX-512 path
#                      uses FMA and so already disagrees with its scalar path
#                      in the last bit; we pin the scalar path.)
#  no AVX-512          __AVX512F__ is never defined, so the vector worldgen
#                      block compiles out. On x86 we go further and target
#                      x86-64-v2, which has no FMA at all — belt and braces,
#                      in case the contract flag is ever lost. On arm64 the
#                      contract flag is the only guard, which is why it is
#                      also asserted below.
#  -Dcosf/-Dsinf       the header's transcendentals are redirected to V8's
#                      ieee754, the same code PlayTrain's QuickJS host binds
#                      Math.cos/Math.sin to (native/runtime/jsmath.h). This is
#                      the one libm dependency in the C, and binding it to the
#                      JS engine's own implementation is what the parity claim
#                      means. The build verifies with nm that no cosf/sinf
#                      symbol survives.
#
# V8's ieee754.cc is built with node's own FMA setting per architecture, copied
# from native/build_qjs.sh: contraction ON for arm64 (what Apple-silicon node
# ships) and OFF for x86-64. One suika input is 1 ULP apart between the two and
# the engine gates need the reference's.
set -euo pipefail
cd "$(dirname "$0")"

ROOT=$(cd ../../../../../.. && pwd)          # repo root
SRC="$ROOT/games/craftax_src"
V8="$ROOT/native/qjs/v8libm"
OUT=build
mkdir -p "$OUT"

[ -f "$SRC/craftax_classic.h" ] || { echo "build.sh: missing $SRC/craftax_classic.h" >&2; exit 1; }
[ -f "$V8/ieee754.cc" ]         || { echo "build.sh: missing $V8/ieee754.cc" >&2; exit 1; }

case "$(uname -m)" in
  x86_64|amd64) ARCH_FLAGS="-march=x86-64-v2"; V8_FPC="-ffp-contract=off" ;;
  arm64|aarch64) ARCH_FLAGS="";                V8_FPC="-ffp-contract=on"  ;;
  *)            ARCH_FLAGS="";                 V8_FPC="-ffp-contract=off" ;;
esac

CC=${CC:-clang}
CXX=${CXX:-clang++}

$CXX -std=c++17 -O3 $V8_FPC -fno-fast-math -w -c "$V8/ieee754.cc" -o "$OUT/v8_ieee754.o"
$CXX -std=c++17 -O2 -ffp-contract=off -fno-fast-math -c v8_shim.cc -o "$OUT/v8_shim.o"

$CC -O2 -std=c11 -ffp-contract=off -fno-fast-math $ARCH_FLAGS \
    -Dcosf=pt_cosf -Dsinf=pt_sinf \
    -I "$SRC" -I stubs \
    -c cc_ref_driver.c -o "$OUT/cc_ref_driver.o"

$CXX -O2 -o "$OUT/cc_ref" "$OUT/cc_ref_driver.o" "$OUT/v8_shim.o" "$OUT/v8_ieee754.o" -lm

# The redirect is the whole parity claim for transcendentals; check it held.
if nm "$OUT/cc_ref_driver.o" | grep -qE '(^| )_?(cosf|sinf)$'; then
    echo "build.sh: cosf/sinf survived the redirect in cc_ref_driver.o" >&2
    nm "$OUT/cc_ref_driver.o" | grep -E '(^| )_?(cosf|sinf)$' >&2
    exit 1
fi

echo "built $OUT/cc_ref"
