#!/usr/bin/env bash
# build_browser.sh — build the browser wasm module (build/qjs_browser.{mjs,wasm}):
# QuickJS + p5 bindings + native rasterizer + frozen fdlibm, all in ONE emscripten
# module. Same stack as training -> frames a human sees are bit-identical to the
# agent's obs. Requires the emscripten SDK on PATH (source ~/emsdk/emsdk_env.sh).
#
# Serve for play:  (from repo root)  python3 -m http.server
#                  open http://localhost:8000/native/browser/index.html
set -euo pipefail
cd "$(dirname "$0")"
command -v emcc >/dev/null || { echo "emcc not found — run: source ~/emsdk/emsdk_env.sh"; exit 1; }

# 1) rasterizer for emscripten (staticlib archive emcc can link)
RAST=../crates/rasterizer/target/wasm32-unknown-emscripten/release/libnode_gym_rasterizer.a
if [ ! -f "$RAST" ]; then
  rustup target add wasm32-unknown-emscripten
  ( cd ../crates/rasterizer && cargo rustc --release --target wasm32-unknown-emscripten --lib --crate-type staticlib )
fi

# 2) frozenmath sources (openlibm, fm_* symbols) — cloned/patched by build_qjs.sh
[ -d frozenmath/src ] || { echo "run ./build_qjs.sh first (fetches+patches frozenmath)"; exit 1; }

# 3) one emscripten module
mkdir -p build
emcc -O2 -w -I runtime -I qjs/src -I frozenmath/src/include -I frozenmath/src/src -Datan=fm_atan \
  qjs/qjs_browser.cpp runtime/p5.cpp \
  qjs/src/quickjs.c qjs/src/libregexp.c qjs/src/libunicode.c qjs/src/dtoa.c \
  frozenmath/src/src/e_pow.c frozenmath/src/src/e_atan2.c frozenmath/src/src/s_atan.c frozenmath/src/src/s_scalbn.c \
  "$RAST" \
  -sEXPORTED_FUNCTIONS=_qb_init,_qb_reset,_qb_step,_qb_pixels,_qb_obs_dim,_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=ccall,cwrap,HEAPU8 \
  -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=33554432 -sMODULARIZE=1 -sEXPORT_ES6=1 \
  -o build/qjs_browser.mjs

echo "built build/qjs_browser.mjs (+ .wasm)"
