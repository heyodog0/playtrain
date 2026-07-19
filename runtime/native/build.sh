#!/usr/bin/env bash
# Build a native game twin: link the C++ game + runtime against the Rust
# rasterizer staticlib. Usage: ./build.sh <game_basename>   (default: bigfish)
set -euo pipefail
cd "$(dirname "$0")"

GAME="${1:-bigfish}"
RASTER_LIB="../crates/rasterizer/target/release/libnode_gym_rasterizer.a"

if [ ! -f "$RASTER_LIB" ]; then
  echo "building rasterizer staticlib..."
  (cd ../crates/rasterizer && cargo build --release --lib)
fi

mkdir -p build
# -ffp-contract=off: forbid a*b+c -> fma fusion, so f64 arithmetic is bit-identical
# to V8 (see NATIVE_COMPILE.md §5). -O3 for the throughput story.
clang++ -std=c++17 -O3 -ffp-contract=off -fno-fast-math -Wno-c++11-narrowing \
  -I runtime \
  runtime/main.cpp runtime/p5.cpp "games/${GAME}.cpp" \
  "$RASTER_LIB" \
  -o "build/${GAME}"

echo "built build/${GAME}"
