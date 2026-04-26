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

# First-time setup: clone node-gym sibling if missing, install deps in both repos.
bootstrap:
    [ -d ../node-gym ] || git clone https://github.com/heyodog0/node-gym ../node-gym
    just sync-all

# Install Node + Python deps (npm install + uv sync)
setup:
    npm install
    uv sync

# Pull latest node-gym (sibling repo) + reinstall its node deps + uv sync here.
# Run this after pulling fast-llm-games if node-gym may have changed too.
sync-all:
    cd ../node-gym && git pull && pnpm install
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
gen-game catalog name model="pro":
    uv run python tools/generate.py --catalog {{catalog}} --name {{name}} --model {{model}}

# Generate every game across every catalog
gen-all model="pro":
    uv run python tools/generate.py --all --model {{model}}

# Generate one Three.js (v2) game. SKIPS if file exists — see gen-three-force / gen-three-v2.
gen-three name model="pro":
    uv run python tools/generate_threejs.py --name {{name}} --model {{model}} --ref

# Generate one Three.js (v2) game, FORCING overwrite (existing file is backed up to games/backups/ first).
gen-three-force name model="pro":
    uv run python tools/generate_threejs.py --name {{name}} --model {{model}} --ref --force

# Generate one Three.js (v2) game with _v2 suffix — original is preserved untouched.
# Output goes to games/threejs/<name>_v2.js
gen-three-v2 name model="pro":
    uv run python tools/generate_threejs.py --name {{name}} --model {{model}} --ref --suffix _v2

# Generate every Three.js game in the SIMPLE catalog. Skips existing files by default.
gen-three-all model="pro":
    uv run python tools/generate_threejs.py --model {{model}} --ref

# Generate one Three.js (v2 complex tier) game (Zelda OoT, Mario 3D, Monster Hunter, etc.)
gen-three-complex name model="pro":
    uv run python tools/generate_threejs.py --catalog games/catalogs/threejs_complex_games.json --name {{name}} --model {{model}} --ref

# Generate every Three.js game in the complex catalog
gen-three-complex-all model="pro":
    uv run python tools/generate_threejs.py --catalog games/catalogs/threejs_complex_games.json --model {{model}} --ref

# Browser game-tester UI for p5 games (http://localhost:3000)
tester:
    uv run python tools/tester.py

# Browser tester for Three.js v2 games (http://localhost:3001)
tester-three:
    uv run python tools/tester_threejs.py

# === notebooks (marimo) ===

# Open a marimo notebook for editing (default: all_games_benchmark)
notebook name="all_games_benchmark":
    uv run marimo edit docs/notebooks/{{name}}.py

# Export a notebook to static HTML
nb-export name:
    uv run marimo export html docs/notebooks/{{name}}.py -o docs/notebooks/{{name}}.html

# === Node.js benchmarks ===

# Run the all-games headless Node.js benchmark
bench-headless game="" frames="500":
    #!/usr/bin/env bash
    if [ -n "{{game}}" ]; then
        node docs/benchmarks/all-games-bench.mjs --game {{game}} --frames {{frames}}
    else
        node docs/benchmarks/all-games-bench.mjs --frames {{frames}}
    fi

# === sweeps (multi-seed, multi-game) ===
#
# These run LOCALLY — meant for smoking the sweep driver, debugging a single
# failed cell, or tiny experiments. Paper-grade sweeps go through `fasrc-submit`.

# Foreground sweep — sees output live, runs sequentially
sweep algo games seeds config=CONFIG:
    uv run fast-games-sweep --algo {{algo}} --games {{games}} \
        --seeds {{seeds}} --config {{config}} --foreground

# Background sweep — detaches, writes outputs/sweeps/{sweep_id}/manifest.json
# Example: just sweep-bg ppo "all" "0 1 2" configs/full_run.json
sweep-bg algo games seeds config=CONFIG max_parallel="1":
    #!/usr/bin/env bash
    set -eu
    sweep_id="{{algo}}_$(date +%Y%m%d_%H%M%S)"
    log="outputs/sweeps/${sweep_id}/sweep.log"
    mkdir -p "outputs/sweeps/${sweep_id}"
    nohup uv run fast-games-sweep \
        --algo {{algo}} --games {{games}} --seeds {{seeds}} \
        --config {{config}} --max-parallel {{max_parallel}} \
        --sweep-id "${sweep_id}" \
        > "${log}" 2>&1 &
    echo "$!" > "outputs/sweeps/${sweep_id}/sweep.pid"
    echo "started sweep ${sweep_id} (pid $(cat outputs/sweeps/${sweep_id}/sweep.pid))"
    echo "tail with: just sweep-tail ${sweep_id}"

# Multigame sweep variant (one run per seed, all 30 games per run)
sweep-multi seeds config=CONFIG max_parallel="1":
    #!/usr/bin/env bash
    set -eu
    sweep_id="multigame_$(date +%Y%m%d_%H%M%S)"
    log="outputs/sweeps/${sweep_id}/sweep.log"
    mkdir -p "outputs/sweeps/${sweep_id}"
    nohup uv run fast-games-sweep \
        --algo multigame --seeds {{seeds}} \
        --config {{config}} --max-parallel {{max_parallel}} \
        --sweep-id "${sweep_id}" \
        > "${log}" 2>&1 &
    echo "$!" > "outputs/sweeps/${sweep_id}/sweep.pid"
    echo "started sweep ${sweep_id} (pid $(cat outputs/sweeps/${sweep_id}/sweep.pid))"

# Tail the sweep driver log
sweep-tail sweep_id:
    tail -f outputs/sweeps/{{sweep_id}}/sweep.log

# Status: count completed/failed runs vs. manifest
sweep-status sweep_id:
    #!/usr/bin/env bash
    root="outputs/sweeps/{{sweep_id}}"
    if [ ! -d "$root" ]; then echo "no such sweep: {{sweep_id}}"; exit 1; fi
    expected=$(jq -r '.n_runs // "?"' "$root/manifest.json" 2>/dev/null || echo "?")
    completed=$(find "$root" -name "final_model.zip" 2>/dev/null | wc -l | tr -d ' ')
    failed=$(jq -r '.failures // [] | length' "$root/manifest.json" 2>/dev/null || echo "0")
    pid_file="$root/sweep.pid"
    if [ -f "$pid_file" ] && kill -0 "$(cat $pid_file)" 2>/dev/null; then
        running="yes (pid $(cat $pid_file))"
    else
        running="no"
    fi
    echo "sweep   : {{sweep_id}}"
    echo "running : $running"
    echo "expected: $expected"
    echo "complete: $completed"
    echo "failed  : $failed"

# Stop a running background sweep (gentle SIGTERM, then SIGKILL)
sweep-stop sweep_id:
    #!/usr/bin/env bash
    pid_file="outputs/sweeps/{{sweep_id}}/sweep.pid"
    if [ ! -f "$pid_file" ]; then echo "no pid file"; exit 1; fi
    pid=$(cat "$pid_file")
    echo "stopping sweep {{sweep_id}} (pid $pid)"
    kill "$pid" 2>/dev/null || true
    sleep 5
    kill -9 "$pid" 2>/dev/null || true

# === figures ===

# Generate fig2/fig3/fig4 PDFs from a finished sweep
figures sweep_id:
    uv run fast-games-figures --sweep {{sweep_id}}

# === FASRC (SLURM) orchestration ===
#
# On FASRC: `just fasrc-submit` launches a SLURM job array. Each array task
# runs one (game, seed) cell via `just _fasrc-cell` (called inside sbatch).
# Figures are generated by a dependent sbatch job after the array finishes.

# Submit a full paper sweep (30 games × given seeds, full_run config)
# Usage: just fasrc-submit "0 1 2"       # 90-cell array, sapphire, 12h each
fasrc-submit seeds="0 1 2" games="all" config=FULL_CFG:
    scripts/fasrc_submit.sh --seeds {{seeds}} --games {{games}} --config {{config}}

# Submit a smoke-sized FASRC sweep (1 game × 1 seed, 1h walltime)
# Confirms uv bootstrap + node bootstrap + module wiring all work.
fasrc-smoke:
    scripts/fasrc_submit.sh --seeds 0 --games breakout --smoke

# Submit the multigame variant (one policy across all games, one cell per seed)
fasrc-submit-multi seeds="0 1 2" config=FULL_CFG:
    scripts/fasrc_submit.sh --algo multigame --seeds {{seeds}} --config {{config}}

# Status: running/queued counts + completed/failed from file system
fasrc-status sweep_id:
    #!/usr/bin/env bash
    root="outputs/sweeps/{{sweep_id}}"
    if [ ! -d "$root" ]; then echo "no such sweep: {{sweep_id}}"; exit 1; fi
    n_cells=$(wc -l < "$root/cells.txt" | tr -d ' ')
    completed=$(find "$root" -name "final_model.zip" 2>/dev/null | wc -l | tr -d ' ')
    if command -v squeue >/dev/null 2>&1; then
        running=$(squeue -u $USER -h -n "{{sweep_id}}" 2>/dev/null | wc -l | tr -d ' ')
    else
        running="n/a (not on SLURM head node)"
    fi
    echo "sweep     : {{sweep_id}}"
    echo "n_cells   : $n_cells"
    echo "complete  : $completed"
    echo "running/Q : $running"
    echo "array_job : $(cat $root/array_job_id.txt 2>/dev/null || echo '?')"

# Run figures on a finished FASRC sweep (called from fasrc_aggregate.sbatch,
# but also fine to run locally after `just pull-results`).
fasrc-figures sweep_id:
    uv run fast-games-figures --sweep {{sweep_id}}

# Internal: runs ONE (game, seed) cell inside an sbatch array task.
# Not intended for direct use — called by scripts/fasrc_cell.sbatch.
_fasrc-cell algo game seed sweep_id config:
    #!/usr/bin/env bash
    set -eu
    run_dir="outputs/sweeps/{{sweep_id}}/{{game}}/seed{{seed}}"
    mkdir -p "$run_dir"
    case "{{algo}}" in
      ppo)
        uv run fast-games-train \
            --game {{game}} --config {{config}} \
            --seed {{seed}} --output-dir "$run_dir" ;;
      dqn)
        uv run fast-games-train-dqn \
            --game {{game}} --config {{config}} \
            --seed {{seed}} --output-dir "$run_dir" ;;
      multigame)
        run_dir="outputs/sweeps/{{sweep_id}}/multigame/seed{{seed}}"
        mkdir -p "$run_dir"
        uv run fast-games-train-multi \
            --all-games --config {{config}} \
            --seed {{seed}} --output-dir "$run_dir" ;;
      *) echo "unknown algo: {{algo}}"; exit 1 ;;
    esac

# === server orchestration ===

# Push code (no outputs, no node_modules) to a remote server
# Usage: just push-code USER@HOST:/path/to/dest/
push-code dest:
    rsync -avz --delete \
        --exclude .venv --exclude node_modules --exclude __pycache__ \
        --exclude outputs --exclude .git --exclude reference \
        --exclude '*.pyc' \
        ./ {{dest}}/

# Pull a finished (or in-progress) sweep back from server
# Usage: just pull-results USER@HOST:/path/to/repo SWEEP_ID
pull-results src sweep_id:
    mkdir -p outputs/sweeps/{{sweep_id}}
    rsync -avz {{src}}/outputs/sweeps/{{sweep_id}}/ outputs/sweeps/{{sweep_id}}/
    @echo "pulled {{sweep_id}} into outputs/sweeps/"

# Pull random-agent baselines (cheap, useful before figures)
pull-baselines src:
    mkdir -p outputs/baselines
    rsync -avz {{src}}/outputs/baselines/ outputs/baselines/

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
