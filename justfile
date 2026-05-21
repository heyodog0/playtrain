# gym-gen — task runner
#
# Generates and modifies p5.js / Three.js RL environments using LLMs, and
# validates the resulting games against ProcGen-style criteria.
#
# Install just: `brew install just` (or see https://just.systems)
# List recipes:  `just`           (or `just --list`)

set shell := ["bash", "-cu"]

# === default ===

default:
    @just --list --unsorted

# === setup ===

# First-time setup: clone node-gym sibling if missing, install deps.
bootstrap:
    [ -d ../node-gym ] || git clone https://github.com/heyodog0/node-gym ../node-gym
    just sync-all

setup:
    npm install
    uv sync

sync-all:
    cd ../node-gym && git pull && pnpm install
    uv sync

install: setup

# === validation ===

# Run the 5-check ProcGen-style validation suite on p5 games (default: all)
validate game="--all":
    #!/usr/bin/env bash
    if [ "{{game}}" = "--all" ]; then
        uv run gym-gen-validate --all
    else
        uv run gym-gen-validate --game {{game}}
    fi

# Run the same suite against bundled three.js games (default: all)
validate-three game="--all":
    #!/usr/bin/env bash
    if [ "{{game}}" = "--all" ]; then
        uv run gym-gen-validate-three --all
    else
        uv run gym-gen-validate-three --game {{game}}
    fi

# Benchmark step throughput (FPS) per game (default: all games)
bench game="--all":
    #!/usr/bin/env bash
    if [ "{{game}}" = "--all" ]; then
        uv run gym-gen-bench --all
    else
        uv run gym-gen-bench --game {{game}}
    fi

# === game generation ===

# Generate one Gemini-built game from a catalog
gen-game catalog name model="pro":
    uv run python tools/generate.py --catalog {{catalog}} --name {{name}} --model {{model}} --ref

# Generate every game across every catalog
gen-all model="pro":
    uv run python tools/generate.py --all --model {{model}} --ref

# Generate one Three.js game. SKIPS if file exists — see gen-three-force.
gen-three name model="pro":
    uv run python tools/generate_threejs.py --name {{name}} --model {{model}} --ref

# Generate one Three.js game, FORCING overwrite. Existing file backed up first.
gen-three-force name model="pro":
    uv run python tools/generate_threejs.py --name {{name}} --model {{model}} --ref --force

# Generate every Three.js game in the SIMPLE catalog. Skips existing.
gen-three-all model="pro":
    uv run python tools/generate_threejs.py --model {{model}} --ref

# Generate one Three.js (v2 complex tier) game
gen-three-complex name model="pro":
    uv run python tools/generate_threejs.py --catalog games/catalogs/threejs_complex_games.json --name {{name}} --model {{model}} --ref

# Generate every Three.js game in the complex catalog
gen-three-complex-all model="pro":
    uv run python tools/generate_threejs.py --catalog games/catalogs/threejs_complex_games.json --model {{model}} --ref

# === game tester (browser UI) ===

tester:
    uv run python tools/tester.py

tester-three:
    uv run python tools/tester_threejs.py

# === notebooks ===

notebook name="all_games_benchmark":
    uv run marimo edit docs/notebooks/{{name}}.py

nb-export name:
    uv run marimo export html docs/notebooks/{{name}}.py -o docs/notebooks/{{name}}.html

# === CI ===

ci:
    just validate
    just bench
