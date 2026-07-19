# node-gym dev tasks
# Run `just` to see all recipes.

default:
    @just --list

# Install JS + Python dependencies
install:
    pnpm install
    uv sync --extra test

# Run smoke tests
test:
    uv run pytest tests/ -v

# Run a single test by name (e.g. `just test-one test_step_loop`)
test-one name:
    uv run pytest tests/ -v -k {{name}}

# Build Python wheel + sdist into dist/
build:
    uv build

# Build the npm tarball into the current directory (for inspection before publish)
pack:
    pnpm pack

# Remove caches, lockfile-managed envs, and build artifacts
clean:
    rm -rf node_modules .venv .pytest_cache build dist *.egg-info python/node_gym/__pycache__

# Quick smoke: spawn worker on flappy_bird, run 100 steps, print reward
smoke:
    uv run python -c "from node_gym import NodeGymEnv; e = NodeGymEnv(game='flappy_bird'); e.reset(seed=0); r = sum(e.step(e.action_space.sample())[1] for _ in range(100)); print(f'reward over 100 steps: {r:.2f}'); e.close()"

# Browser tester. `just play` opens a game picker; `just play flappy_bird` jumps to one.
play game="":
    node tools/play.mjs {{game}}

# Refresh the analogen-tree games from the sibling ../analogen/games/js/.
# These used to be symlinks but had to become real files for Vercel deploys
# (Vercel only checks out this repo, not the sibling). Run this after editing
# the originals in ../analogen and before committing.
#
# Two groups are synced:
#   (1) analogen_*.js — the AnaloGen role-binding envs (glob-matched).
#   (2) The JS-Atari-6 clones (pong, breakout, beam_rider, space_invaders,
#       qbert, seaquest) used by validate_jsatari.sh. These don't carry the
#       analogen_ prefix, so they're enumerated explicitly rather than
#       globbed — that keeps the sync from quietly grabbing every new
#       top-level .js someone drops in ../analogen/games/js/.
sync-analogen:
    #!/usr/bin/env bash
    set -euo pipefail
    src="../analogen/games/js"
    if [ ! -d "$src" ]; then echo "missing: $src" >&2; exit 1; fi
    n=0
    copy_one() {
      local f="$1"
      local dest="examples/games/js/$(basename "$f")"
      # `rm -f` first so this works whether the destination is a stale
      # symlink (resolves to $f, would trip macOS cp's same-inode guard),
      # a regular file, or missing entirely.
      rm -f "$dest"
      cp "$f" "$dest"
      n=$((n+1))
    }
    for f in "$src"/analogen_*.js; do
      copy_one "$f"
    done
    for g in pong breakout beam_rider space_invaders qbert seaquest; do
      f="$src/$g.js"
      if [ ! -f "$f" ]; then echo "missing: $f" >&2; exit 1; fi
      copy_one "$f"
    done
    echo "synced $n files from $src"
    git status --short examples/games/js/ || echo "(no changes)"

# Build the shareable static playtest site into dist/pages/ (for Vercel).
build-pages:
    node tools/build-pages.mjs

# Preview the built static site locally on http://localhost:5051
serve-pages: build-pages
    cd dist/pages && python3 -m http.server 5051

# Run the 5-check validation suite against all bundled p5 games (~1 min)
validate:
    uv run python tools/validate.py --all

# Validate a single p5 game
validate-one game:
    uv run python tools/validate.py --game {{game}}

# Run the same 5-check suite against all bundled three.js games (slower; ~3 min)
validate-three:
    uv run python tools/validate_three.py --all

# Validate a single three.js game
validate-three-one game:
    uv run python tools/validate_three.py --game {{game}}

# Benchmark step throughput across all bundled p5 games (3 trials each)
bench:
    uv run python tools/bench.py --backend p5 --all

# Benchmark a single p5 game
bench-one game:
    uv run python tools/bench.py --backend p5 --game {{game}}

# Benchmark step throughput across all bundled three.js games (3 trials each)
bench-three:
    uv run python tools/bench.py --backend three --all

# Benchmark a single three.js game
bench-three-one game:
    uv run python tools/bench.py --backend three --game {{game}}

# Per-phase step profile for one p5 game (draw / downsample / swap / info / framing)
profile game="flappy_bird":
    uv run python tools/profile.py --game {{game}}

# Same, but also writes a V8 .cpuprofile under outputs/profile/ for Chrome DevTools
profile-cpu game="flappy_bird":
    uv run python tools/profile.py --game {{game}} --cpu-prof

# Render the newest .cpuprofile as a terminal table (Left Heavy view)
profile-view by="self":
    uv run python tools/profile_view.py --by {{by}}
