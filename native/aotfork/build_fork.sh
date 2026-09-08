#!/usr/bin/env bash
# build_fork.sh — L1 harness (PLAN-engine-tier.md §5 L1): the ivankra QuickJS
# fork (Bellard lineage, tail-call dispatch, `qjsc -A` Futamura AOT) hosting the
# unchanged game JS through the SAME p5 bindings/rasterizer as qjs_host.
#
#   build_fork.sh engine            # clone (pinned), patch, build qjsc + libs
#   build_fork.sh f0                # F0 = fork interpreter host  -> out/host_f0
#   build_fork.sh f1 <game.js>...   # F1 = qjsc -A per game       -> out/host_f1_<game>
#   build_fork.sh all <game.js>...  # engine + f0 + f1 for each game
#   build_fork.sh vec0              # vec host .so, fork interpreter -> out/libqjs_vec.fork.so
#   build_fork.sh vec1 <game.js>... # vec host .so, qjsc -A per game -> out/libqjs_vec.fut_<game>.so
#
# Env: FORK_OUT (default ./out), NATIVE (default ..), RA (rasterizer .a),
#      QJS_ARCH (default -march=x86-64-v3 on x86_64, empty otherwise),
#      OPT (default -O3), DBG=1 (-g everywhere, codegen unchanged), INTR=1 (E3 p5 intrinsics),
#      UNIT_NOPGO=1 (tier 2: game unit without -fprofile-use; needs TUNE=use). Engine objects, F0 and F1 all use the same
#      $OPT $QJS_ARCH -ffp-contract=off so F1/F0 isolates AOT only.
# Never touches native/build/ or native/build/variants/.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
NATIVE="${NATIVE:-$(cd "$HERE/.." && pwd)}"
OUT="${FORK_OUT:-$HERE/out}"
SRC="$OUT/src"
FORK_REPO="${FORK_REPO:-https://github.com/ivankra/quickjs}"
FORK_COMMIT="${FORK_COMMIT:-cee72b9c99fac98426a3bbb4fbfa493b7e5619f2}"   # branch aot, "QuickJS-AOT 20251209"
OPT="${OPT:--O3}"
if [ -z "${QJS_ARCH+x}" ]; then
  QJS_ARCH=""; case "$(uname -m)" in x86_64|amd64) QJS_ARCH="-march=x86-64-v3";; esac
fi
# -funsigned-char -fwrapv: the fork's Makefile relies on both (semantics, not tuning).
CDEFS="-D_GNU_SOURCE -DNDEBUG -DCONFIG_VERSION=\"2025-09-13\" -funsigned-char -fwrapv"
CFLAGS="$OPT $QJS_ARCH -ffp-contract=off $CDEFS"
# ---- tuned builds (mirror build_qjs_vec_tune.sh: PGO + thin-LTO + hidden vis) ----
#   TUNE=gen PROFDIR=<dir>     instrumented (-fprofile-generate); profraws land in $PROFDIR
#   TUNE=use PROFDATA=<file>   -fprofile-use + -flto=thin + -fvisibility=hidden
#   TAG=<suffix>               appended to every output/obj-dir name (e.g. "gen", "T")
# Engine objects, AOT TU and host all get the same $TUNEFLAGS, so a `use` build
# is self-consistent with its own `gen` profile (the "mh confound" rule).
TUNE="${TUNE:-}"; TAG="${TAG:-}"; TUNEFLAGS=""; VISFLAG=""
case "$TUNE" in
  gen) TUNEFLAGS="-fprofile-generate=${PROFDIR:?set PROFDIR}"; mkdir -p "$PROFDIR" ;;
  use) TUNEFLAGS="-fprofile-use=${PROFDATA:?set PROFDATA} -flto=thin -Wno-profile-instr-unprofiled -Wno-profile-instr-out-of-date"; VISFLAG="-fvisibility=hidden" ;;
  "") ;;
  *) echo "bad TUNE=$TUNE" >&2; exit 1 ;;
esac
# DBG=1: -g on engine objects, AOT unit and host (debug info only; codegen unchanged) for SIGPROF symbolization
DBGFLAG=""; [ "${DBG:-}" = 1 ] && DBGFLAG="-g"
CFLAGS="$CFLAGS $TUNEFLAGS $VISFLAG $DBGFLAG"
# UNIT_NOPGO=1 (E6.2 "tier 2"): the game's AOT unit is compiled WITHOUT -fprofile-use
# (a never-profiled game), while engine objects and host keep the full PGO+LTO flags.
# Only the two game_aot.c compiles (vec1, f1) use UNITFLAGS. Requires TUNE=use.
UNITFLAGS="$CFLAGS"
if [ "${UNIT_NOPGO:-}" = 1 ]; then
  [ "$TUNE" = use ] || { echo "UNIT_NOPGO=1 requires TUNE=use" >&2; exit 1; }
  UNITFLAGS="${CFLAGS//-fprofile-use=$PROFDATA/}"
  [ "$UNITFLAGS" != "$CFLAGS" ] || { echo "UNIT_NOPGO: profile flag not found in CFLAGS" >&2; exit 1; }
fi
# INTR=1 (E3): qjsc -P <intrinsics> -> guarded direct calls to the p5 bindings in the
# emitted C; the list is derived from aot_intr_list.h (single source), and the
# emitted C goes to out/aotI_<game>/ so the plain arms' game_aot.c stay untouched.
QJSC_INTR=""; AOTDIR=""
if [ "${INTR:-}" = 1 ]; then
  # written atomically (tmp + mv): parallel vec1/f1 invocations regenerate it concurrently, and a
  # reader must never see a truncated file (7/24 instrumented builds died that way in job 44471503)
  _t="$(mktemp "$OUT/aot_intr.XXXXXX")"
  sed -nE 's/^AOT_INTR\(([A-Za-z_0-9]+), *([0-9]+),.*/\1 \2/p; s/^AOT_INTRM\(([A-Za-z_0-9]+), *([A-Za-z_0-9]+), *([0-9]+),.*/\1.\2 \3/p' "$HERE/aot_intr_list.h" > "$_t"
  [ "$(wc -l < "$_t")" -ge 10 ] || { echo "aot_intr.txt derivation failed" >&2; rm -f "$_t"; exit 1; }
  mv -f "$_t" "$OUT/aot_intr.txt"
  QJSC_INTR="-P $OUT/aot_intr.txt"; AOTDIR="I"
fi
RA="${RA:-$NATIVE/../crates/rasterizer/target/release/libplaytrain_rasterizer.a}"
FROZEN="$NATIVE/frozenmath/libfrozenmath.a"
EXTRA=""; case "$(uname)" in Linux) EXTRA="-lpthread -lm -ldl";; esac
mkdir -p "$OUT"

need() { [ -f "$1" ] || { echo "missing $1" >&2; exit 1; }; }

engine() {
  if [ ! -d "$SRC/.git" ]; then
    git clone -q "$FORK_REPO" "$SRC"
    ( cd "$SRC" && git checkout -q "$FORK_COMMIT" )
  fi
  ( cd "$SRC" && git checkout -q "$FORK_COMMIT" -- qjsc.c quickjs.c quickjs.h && git apply "$HERE/qjsc-hostmode.patch" && git apply "$HERE/aot-intrinsics.patch" )
  echo "fork: $(cd "$SRC" && git log -1 --format='%h %s') + qjsc-hostmode.patch + aot-intrinsics.patch"
  cd "$SRC"
  # 1. preprocessed interpreter (what every `qjsc -A` output #includes) + the
  #    opcode-body table qjsc uses to stitch handlers.
  clang $CFLAGS -DQUICKOMURA_PREPROCESS -E -c -o quickjs.i quickjs.c
  python3 ./aot-parse.py < quickjs.i > aot-table.h
  # 2. engine objects with OUR flags (F0 arm). quickjs.o pulls in aot-table.h.
  mkdir -p "$OUT/obj$TAG"
  for f in quickjs dtoa libregexp libunicode cutils quickjs-libc; do
    clang $CFLAGS -Wno-everything -c -o "$OUT/obj$TAG/$f.o" "$f.c"
  done
  ar rcs "$OUT/libqjs_fork$TAG.a"    "$OUT"/obj$TAG/quickjs.o "$OUT"/obj$TAG/dtoa.o "$OUT"/obj$TAG/libregexp.o "$OUT"/obj$TAG/libunicode.o "$OUT"/obj$TAG/cutils.o "$OUT"/obj$TAG/quickjs-libc.o
  ar rcs "$OUT/libqjs_forkaot$TAG.a" "$OUT"/obj$TAG/dtoa.o "$OUT"/obj$TAG/libregexp.o "$OUT"/obj$TAG/libunicode.o "$OUT"/obj$TAG/cutils.o "$OUT"/obj$TAG/quickjs-libc.o
  # 3. qjsc itself (compiler; plain objects of its own — never instrumented/LTO'd)
  if [ ! -x "$OUT/qjsc" ] || [ "$HERE/aot-intrinsics.patch" -nt "$OUT/qjsc" ] || [ "$HERE/qjsc-hostmode.patch" -nt "$OUT/qjsc" ]; then
    mkdir -p "$OUT/qjscobj"
    for f in quickjs dtoa libregexp libunicode cutils quickjs-libc qjsc; do
      clang -O2 $CDEFS -Wno-everything -c -o "$OUT/qjscobj/$f.o" "$f.c"
    done
    clang -o "$OUT/qjsc" "$OUT"/qjscobj/*.o $EXTRA
  fi
  # 4. the prelude, extracted from the host source so it can never drift
  sed -n '/^static const char\* PRELUDE = R"JS(/,/^)JS";/p' "$HERE/qjs_host_fork.cpp" | sed '1d;$d' > "$OUT/prelude.js"
  [ "$(wc -l < "$OUT/prelude.js")" -ge 5 ] || { echo "prelude extraction failed" >&2; exit 1; }
  # host include dir: only quickjs.h (a -I on the fork tree itself would let
  # macOS's case-insensitive FS resolve <version> to the fork's VERSION file)
  mkdir -p "$OUT/include" && cp quickjs.h "$OUT/include/"
  echo "engine built: $OUT/{qjsc,libqjs_fork$TAG.a,libqjs_forkaot$TAG.a} (TUNE=${TUNE:-none})"
}

host_common() {  # $1 = output, rest = extra objects/flags/archives (linked AFTER the sources: GNU ld order)
  local out="$1"; shift
  need "$RA"; need "$FROZEN"
  clang++ -std=c++17 $OPT $QJS_ARCH -ffp-contract=off -fno-fast-math -Wno-c++11-narrowing $TUNEFLAGS $DBGFLAG \
    -I "$NATIVE/runtime" -I "$NATIVE/qjs" -I "$OUT/include" \
    "$HERE/qjs_host_fork.cpp" "$NATIVE/runtime/p5.cpp" "$@" "$RA" "$FROZEN" $EXTRA -o "$out"
}

# ---- vec host (.so loaded by ctypes; the Fig-4A / trainer path) ----------------
# PIC copies of the engine objects, kept apart from the non-PIC ones qjs_host uses
# (same split as build_qjs_vec.sh). vec_exports.map makes everything but vec_*
# DSO-local so intra-library calls skip the PLT, as in the adopted .so.
FROZEN_PIC="$NATIVE/frozenmath/libfrozenmath_pic.a"
PIC="$OUT/pic$TAG"
engine_pic() { (
  mkdir -p "$PIC"; cd "$SRC"
  for f in quickjs dtoa libregexp libunicode cutils quickjs-libc; do
    [ -f "$PIC/$f.o" ] || clang $CFLAGS -fPIC -Wno-everything -c -o "$PIC/$f.o" "$f.c"
  done
  ar rcs "$PIC/libqjs_fork.a"    "$PIC"/quickjs.o "$PIC"/dtoa.o "$PIC"/libregexp.o "$PIC"/libunicode.o "$PIC"/cutils.o "$PIC"/quickjs-libc.o
  ar rcs "$PIC/libqjs_forkaot.a" "$PIC"/dtoa.o "$PIC"/libregexp.o "$PIC"/libunicode.o "$PIC"/cutils.o "$PIC"/quickjs-libc.o
) }
vec_common() {  # $1 = output .so, rest = extra flags/objects/archives
  local out="$1"; shift
  need "$RA"
  local so_flags="-shared -Wl,--version-script=$NATIVE/vec_exports.map"; local frozen="$FROZEN_PIC"
  case "$(uname)" in Darwin) so_flags="-dynamiclib"; frozen="$FROZEN";; esac
  [ -f "$frozen" ] || { echo "missing $frozen (run build_qjs_vec.sh once, or copy frozenmath/ from the tuning tree)" >&2; exit 1; }
  clang++ -std=c++17 $OPT $QJS_ARCH -ffp-contract=off -fno-fast-math -Wno-c++11-narrowing -fPIC $TUNEFLAGS $VISFLAG $DBGFLAG $so_flags \
    -I "$NATIVE/runtime" -I "$NATIVE/qjs" -I "$OUT/include" \
    "$HERE/qjs_vec_host_fork.cpp" "$NATIVE/runtime/p5.cpp" "$@" "$RA" "$frozen" $EXTRA -o "$out"
}
vec0() { engine_pic; vec_common "$OUT/libqjs_vec.fork$TAG.so" "$PIC/libqjs_fork.a"; echo "built $OUT/libqjs_vec.fork$TAG.so"; }
vec1() {
  local game g; game="$(abspath "$1")"; g="$(basename "$game" .js)"
  local tmp="$OUT/aot${AOTDIR}_$g"
  if [ ! -s "$tmp/game_aot.c" ]; then mkdir -p "$tmp"; cp "$game" "$tmp/game.js"; cp "$OUT/prelude.js" "$tmp/prelude.js"
    ( cd "$tmp" && QJSC_HOST_MODE=1 "$OUT/qjsc" -A -c $QJSC_INTR -o game_aot.c prelude.js game.js ); fi
  # build the PIC engine archives once (vec0 does it); parallel vec1 calls racing
  # on the same .o/.a files produced corrupt archives (2/24 links failed per job)
  [ -f "$PIC/libqjs_forkaot.a" ] || engine_pic
  clang $UNITFLAGS -fPIC -Wno-everything -I "$SRC" -c -o "$tmp/game_aot_pic$TAG.o" "$tmp/game_aot.c"
  # build-time identity of the game source, checked by env_init against what Python hands over
  read -r fnv len < <(python3 - "$game" <<'PY'
import sys; b=open(sys.argv[1],'rb').read(); h=0xcbf29ce484222325
for c in b: h=((h^c)*0x100000001b3)&0xFFFFFFFFFFFFFFFF
print(h, len(b))
PY
)
  vec_common "$OUT/libqjs_vec.fut${TAG}_$g.so" -DHOST_AOT -DAOT_GAME_FNV=${fnv}ULL -DAOT_GAME_LEN=$len "$tmp/game_aot_pic$TAG.o" "$PIC/libqjs_forkaot.a"
  echo "built $OUT/libqjs_vec.fut${TAG}_$g.so"
}

f0() {
  host_common "$OUT/host_f0$TAG" "$OUT/libqjs_fork$TAG.a"
  echo "built $OUT/host_f0$TAG"
}

abspath() { echo "$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"; }
f1() {
  local game g; game="$(abspath "$1")"; g="$(basename "$game" .js)"
  local tmp="$OUT/aot${AOTDIR}_$g"; mkdir -p "$tmp"
  cp "$game" "$tmp/game.js"               # c_name of the blob := "game"
  cp "$OUT/prelude.js" "$tmp/prelude.js"  # c_name := "prelude"; compiled first
  # -A: Futamura projection; -c: bytecode+aot funcs only (no main). Host mode =
  # one shared compile context, no std helpers (qjsc-hostmode.patch).
  [ -s "$tmp/game_aot.c" ] || ( cd "$tmp" && QJSC_HOST_MODE=1 "$OUT/qjsc" -A -c $QJSC_INTR -o game_aot.c prelude.js game.js )
  # the generated C #includes quickjs.i (the whole interpreter) — same flags as quickjs.o
  clang $UNITFLAGS -Wno-everything -I "$SRC" -c -o "$tmp/game_aot$TAG.o" "$tmp/game_aot.c"
  host_common "$OUT/host_f1${TAG}_$g" -DHOST_AOT "$tmp/game_aot$TAG.o" "$OUT/libqjs_forkaot$TAG.a"
  echo "built $OUT/host_f1${TAG}_$g ($(grep -c '^static const uint8_t aot[0-9]*_bytecode' "$tmp/game_aot.c") functions AOT-compiled)"
}

case "${1:-}" in
  engine) engine ;;
  f0) f0 ;;
  f1) shift; for g in "$@"; do f1 "$g"; done ;;
  vec0) vec0 ;;
  vec1) shift; for g in "$@"; do vec1 "$g"; done ;;
  all) shift; engine; f0; for g in "$@"; do f1 "$g"; done ;;
  *) sed -n '2,12p' "$0"; exit 1 ;;
esac
