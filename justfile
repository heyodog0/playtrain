# fast-llm-games — task runner
#
# Install just: `brew install just` (or see https://just.systems)
# List recipes:  `just`           (or `just --list`)
# Run anything:  `just <recipe> [args...]`
#
# Recipes are thin wrappers around `uv run` (Python) or `node` (JS),
# so the underlying commands remain available if you prefer them.

set shell := ["bash", "-cu"]

# Defaults shared across recipes
GAME       := "breakout"
CONFIG     := "configs/short_run.json"
SMOKE_CFG  := "configs/smoke_test.json"
SHORT_CFG  := "configs/short_run.json"
FULL_CFG   := "configs/full_run.json"

# === default ===

# List all recipes (default action when running `just` with no args)
default:
    @just --list --unsorted

# === setup ===

# Install Node + Python deps (npm install + uv sync)
setup:
    npm install
    uv sync

# Alias for `setup`
install: setup

# === validation ===

# Run the 5-check ProcGen-style validation suite (default: all games)
validate game="--all":
    #!/usr/bin/env bash
    if [ "{{game}}" = "--all" ]; then
        uv run fast-games-validate --all
    else
        uv run fast-games-validate --game {{game}}
    fi

# Benchmark step throughput (FPS) per game (default: all games)
bench game="--all":
    #!/usr/bin/env bash
    if [ "{{game}}" = "--all" ]; then
        uv run fast-games-bench --all
    else
        uv run fast-games-bench --game {{game}}
    fi

# Collect random-agent baseline scores (needed for normalization)
baselines game="--all" episodes="100":
    #!/usr/bin/env bash
    if [ "{{game}}" = "--all" ]; then
        uv run fast-games-baselines --all --episodes {{episodes}}
    else
        uv run fast-games-baselines --game {{game}} --episodes {{episodes}}
    fi

# === training ===

# Train PPO on a single game (default game/config: breakout / short_run)
train game=GAME config=CONFIG:
    uv run fast-games-train --game {{game}} --config {{config}}

# Train DQN on a single game
train-dqn game=GAME config=CONFIG:
    uv run fast-games-train-dqn --game {{game}} --config {{config}}

# ProcGen-style multi-game PPO across every game in games/js/
train-multi config=CONFIG:
    uv run fast-games-train-multi --all-games --config {{config}}

# Multi-game PPO restricted to a subset of games
train-multi-some config=CONFIG +games="breakout flappy_bird mario":
    uv run fast-games-train-multi --games {{games}} --config {{config}}

# 30-second smoke test (PPO single-game, smoke_test.json)
smoke game=GAME:
    just train {{game}} {{SMOKE_CFG}}

# === evaluation ===

# Evaluate a trained model on train + test seed splits
eval game model mode="both":
    uv run fast-games-eval --game {{game}} --model {{model}} --mode {{mode}}

# Aggregate every run under outputs/experiments/ into IQM-normalized scores
aggregate:
    uv run fast-games-aggregate

# === game generation / tester ===

# Generate one Gemini-built game from a catalog
gen-game catalog name model="flash":
    uv run python tools/generate.py --catalog {{catalog}} --name {{name}} --model {{model}}

# Generate every game across every catalog
gen-all model="flash":
    uv run python tools/generate.py --all --model {{model}}

# Browser game-tester UI (http://localhost:3000)
tester:
    uv run python tools/tester.py

# === notebooks (marimo) ===

# Open a marimo notebook for editing (default: all_games_benchmark)
notebook name="all_games_benchmark":
    uv run marimo edit notebooks/{{name}}.py

# Export a notebook to static HTML
nb-export name:
    uv run marimo export html notebooks/{{name}}.py -o notebooks/{{name}}.html

# === Node.js benchmarks ===

# Compare old single-game env vs new multi-game env (legacy)
bench-kazuki:
    npm run bench:kazuki

# Run the all-games headless Node.js benchmark
bench-headless game="" frames="500":
    #!/usr/bin/env bash
    if [ -n "{{game}}" ]; then
        node benchmarks/all-games-bench.mjs --game {{game}} --frames {{frames}}
    else
        node benchmarks/all-games-bench.mjs --frames {{frames}}
    fi

# === workflow recipes (compose atomic ones) ===

# Quick reproduction loop (~5 min): validate breakout + smoke train it
reproduce game=GAME:
    just validate {{game}}
    just smoke {{game}}

# Full paper-grade run: validate, baselines, multi-game PPO, aggregate
paper-run:
    just validate
    just baselines
    just train-multi {{FULL_CFG}}
    just aggregate

# What CI would run on every PR
ci:
    just validate
    just bench

# === maintenance ===

# Clean throwaway outputs (smoke runs, tb logs). Does NOT touch baselines/results.
clean-smoke:
    rm -rf outputs/experiments/*/ppo/*smoke* outputs/experiments/*/dqn/*smoke* 2>/dev/null || true
    @echo "smoke outputs cleared"

# Print the resolved Python interpreter and key package versions
versions:
    @uv run python -c 'import sys, gymnasium, stable_baselines3 as sb3, numpy; print("python   ", sys.version.split()[0]); print("gymnasium", gymnasium.__version__); print("sb3      ", sb3.__version__); print("numpy    ", numpy.__version__)'
