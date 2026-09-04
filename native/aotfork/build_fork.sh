#!/usr/bin/env bash
# build_fork.sh — L1 harness (PLAN-engine-tier.md §5 L1): the ivankra QuickJS
# fork (Bellard lineage, tail-call dispatch, `qjsc -A` Futamura AOT) hosting the
# unchanged game JS through the SAME p5 bindings/rasterizer as qjs_host.
#
#   build_fork.sh engine            # clone (pinned), patch, build qjsc + libs
#   build_fork.sh f0                # F0 = fork interpreter host  -> out/host_f0
#   build_fork.sh f1 <game.js>...   # F1 = qjsc -A per game       -> out/host_f1_<game>
#   build_fork.sh all <game.js>...  # engine + f0 + f1 for each game
#
# Env: FORK_OUT (default ./out), NATIVE (default ..), RA (rasterizer .a),
#      QJS_ARCH (default -march=x86-64-v3 on x86_64, empty otherwise),
#      OPT (default -O3). Engine objects, F0 and F1 all use the same
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
  ( cd "$SRC" && git checkout -q "$FORK_COMMIT" -- qjsc.c && git apply "$HERE/qjsc-hostmode.patch" )
  echo "fork: $(cd "$SRC" && git log -1 --format='%h %s') + qjsc-hostmode.patch"
  cd "$SRC"
  # 1. preprocessed interpreter (what every `qjsc -A` output #includes) + the
  #    opcode-body table qjsc uses to stitch handlers.
  clang $CFLAGS -DQUICKOMURA_PREPROCESS -E -c -o quickjs.i quickjs.c
  python3 ./aot-parse.py < quickjs.i > aot-table.h
  # 2. engine objects with OUR flags (F0 arm). quickjs.o pulls in aot-table.h.
  for f in quickjs dtoa libregexp libunicode cutils quickjs-libc; do
    clang $CFLAGS -Wno-everything -c -o "$OUT/$f.o" "$f.c"
  done
  ar rcs "$OUT/libqjs_fork.a"    "$OUT"/quickjs.o "$OUT"/dtoa.o "$OUT"/libregexp.o "$OUT"/libunicode.o "$OUT"/cutils.o "$OUT"/quickjs-libc.o
  ar rcs "$OUT/libqjs_forkaot.a" "$OUT"/dtoa.o "$OUT"/libregexp.o "$OUT"/libunicode.o "$OUT"/cutils.o "$OUT"/quickjs-libc.o
  # 3. qjsc itself (compiler; its own opt level is irrelevant to the measurement)
  clang -O2 $CDEFS -Wno-everything -c -o "$OUT/qjsc.o" qjsc.c
  clang -o "$OUT/qjsc" "$OUT/qjsc.o" "$OUT/libqjs_fork.a" $EXTRA
  # 4. the prelude, extracted from the host source so it can never drift
  sed -n '/^static const char\* PRELUDE = R"JS(/,/^)JS";/p' "$HERE/qjs_host_fork.cpp" | sed '1d;$d' > "$OUT/prelude.js"
  [ "$(wc -l < "$OUT/prelude.js")" -ge 5 ] || { echo "prelude extraction failed" >&2; exit 1; }
  # host include dir: only quickjs.h (a -I on the fork tree itself would let
  # macOS's case-insensitive FS resolve <version> to the fork's VERSION file)
  mkdir -p "$OUT/include" && cp quickjs.h "$OUT/include/"
  echo "engine built: $OUT/{qjsc,libqjs_fork.a,libqjs_forkaot.a}"
}

host_common() {  # $1 = output, rest = extra objects/flags
  local out="$1"; shift
  need "$RA"; need "$FROZEN"
  clang++ -std=c++17 $OPT $QJS_ARCH -ffp-contract=off -fno-fast-math -Wno-c++11-narrowing \
    -I "$NATIVE/runtime" -I "$NATIVE/qjs" -I "$OUT/include" \
    "$@" "$HERE/qjs_host_fork.cpp" "$NATIVE/runtime/p5.cpp" "$RA" "$FROZEN" $EXTRA -o "$out"
}

f0() {
  host_common "$OUT/host_f0" "$OUT/libqjs_fork.a"
  echo "built $OUT/host_f0"
}

f1() {
  local game="$1" g; g="$(basename "$game" .js)"
  local tmp="$OUT/aot_$g"; mkdir -p "$tmp"
  cp "$game" "$tmp/game.js"               # c_name of the blob := "game"
  cp "$OUT/prelude.js" "$tmp/prelude.js"  # c_name := "prelude"; compiled first
  # -A: Futamura projection; -c: bytecode+aot funcs only (no main). Host mode =
  # one shared compile context, no std helpers (qjsc-hostmode.patch).
  ( cd "$tmp" && QJSC_HOST_MODE=1 "$OUT/qjsc" -A -c -o game_aot.c prelude.js game.js )
  # the generated C #includes quickjs.i (the whole interpreter) — same flags as quickjs.o
  clang $CFLAGS -Wno-everything -I "$SRC" -c -o "$tmp/game_aot.o" "$tmp/game_aot.c"
  host_common "$OUT/host_f1_$g" -DHOST_AOT "$tmp/game_aot.o" "$OUT/libqjs_forkaot.a"
  echo "built $OUT/host_f1_$g ($(grep -c '^static const uint8_t aot[0-9]*_bytecode' "$tmp/game_aot.c") functions AOT-compiled)"
}

case "${1:-}" in
  engine) engine ;;
  f0) f0 ;;
  f1) shift; for g in "$@"; do f1 "$g"; done ;;
  all) shift; engine; f0; for g in "$@"; do f1 "$g"; done ;;
  *) sed -n '2,12p' "$0"; exit 1 ;;
esac
