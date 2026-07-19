# PlayTrain — task runner
#
# Monorepo for the PlayTrain project:
#   - playtrain.runtime : headless JS game envs for Gymnasium (runtime/, native/, examples/)
#   - playtrain.gen     : LLM game generation + ProcGen-style validation (games/, tools/)
#
# Install just: `brew install just` (or see https://just.systems)
# List recipes:  `just`  (or `just --list`)

set shell := ["bash", "-cu"]

default:
    @just --list --unsorted

# === setup ===

# Install JS + Python dependencies for the whole monorepo.
install:
    pnpm install
    uv sync --extra test

# Remove caches, envs, and build artifacts.
clean:
    rm -rf node_modules .venv .pytest_cache build dist *.egg-info
    find . -name __pycache__ -type d -prune -exec rm -rf {} +

# === runtime: tests, validation, benchmarks ===

# Run the runtime smoke tests.
test:
    uv run pytest tests/ -v

# Run a single test by name (e.g. `just test-one test_step_loop`).
test-one name:
    uv run pytest tests/ -v -k {{name}}

# Quick smoke: spawn a worker on flappy_bird, run 100 steps, print reward.
smoke:
    uv run python -c "from playtrain.runtime import PlayTrainEnv; e = PlayTrainEnv(game='flappy_bird'); e.reset(seed=0); r = sum(e.step(e.action_space.sample())[1] for _ in range(100)); print(f'reward over 100 steps: {r:.2f}'); e.close()"

# 5-check validation suite over all bundled p5 games (~1 min).
validate:
    uv run python tools/validate.py --all

# Validate a single bundled p5 game.
validate-one game:
    uv run python tools/validate.py --game {{game}}

# Same suite over all bundled three.js games (~3 min).
validate-three:
    uv run python tools/validate_three.py --all

validate-three-one game:
    uv run python tools/validate_three.py --game {{game}}

# Benchmark step throughput across all bundled p5 games.
bench:
    uv run python tools/bench.py --backend p5 --all

bench-one game:
    uv run python tools/bench.py --backend p5 --game {{game}}

bench-three:
    uv run python tools/bench.py --backend three --all

bench-three-one game:
    uv run python tools/bench.py --backend three --game {{game}}

# Per-phase step profile for one p5 game.
profile game="flappy_bird":
    uv run python tools/profile.py --game {{game}}

profile-cpu game="flappy_bird":
    uv run python tools/profile.py --game {{game}} --cpu-prof

profile-view by="self":
    uv run python tools/profile_view.py --by {{by}}

# === generation (playtrain.gen) ===

# Validate the generated p5 catalog (games/js) — the gen-side ProcGen suite.
gen-validate game="--all":
    #!/usr/bin/env bash
    if [ "{{game}}" = "--all" ]; then
        uv run playtrain-validate --all
    else
        uv run playtrain-validate --game {{game}}
    fi

# Throughput of the generated catalog.
gen-bench game="--all":
    #!/usr/bin/env bash
    if [ "{{game}}" = "--all" ]; then
        uv run playtrain-bench --all
    else
        uv run playtrain-bench --game {{game}}
    fi

# Generate one Gemini-built game from a catalog. mechanic="no" omits the catalog mechanic.
gen-game catalog name model="pro" mechanic="yes":
    uv run python tools/generate.py --catalog {{catalog}} --name {{name}} --model {{model}} --ref {{ if mechanic == "no" { "--no-mechanic" } else { "" } }}

# Generate every game across every catalog.
gen-all model="pro" mechanic="yes":
    uv run python tools/generate.py --all --model {{model}} --ref {{ if mechanic == "no" { "--no-mechanic" } else { "" } }}

# Closed-loop refine a generated clone against the REAL Atari ROM (needs ale-py + GEMINI_API_KEY).
refine-vs-rom name iters="3" feedback="" model="pro":
    uv run --extra rom AutoROM --accept-license
    uv run --extra rom python tools/refine_vs_rom.py --game {{name}} --iters {{iters}} --model {{model}} --feedback "{{feedback}}"

# === game variants (prototype forks) ===

variant parent prompt name="" model="pro":
    uv run python tools/variant.py --parent {{parent}} --prompt {{quote(prompt)}} --name {{name}} --model {{model}}

variants:
    uv run python tools/variant.py --list

promote name:
    uv run python tools/variant.py --promote {{name}}

unvariant name:
    uv run python tools/variant.py --delete {{name}}

# === testers (browser UIs) ===

# Generated-catalog tester + Gemini refinement (localhost:3000).
tester:
    uv run python tools/tester.py

# Runtime game picker: `just play` for the picker, `just play flappy_bird` to jump in.
play game="":
    node tools/play.mjs {{game}}

# === packaging / site ===

build:
    uv build

pack:
    pnpm pack

# Build the shareable static playtest site into dist/pages/ (for Vercel).
build-pages:
    node tools/build-pages.mjs

serve-pages: build-pages
    cd dist/pages && python3 -m http.server 5051

# Refresh analogen-tree games from the sibling ../analogen/games/js/.
sync-analogen:
    #!/usr/bin/env bash
    set -euo pipefail
    src="../analogen/games/js"
    if [ ! -d "$src" ]; then echo "missing: $src" >&2; exit 1; fi
    n=0
    copy_one() {
      local f="$1"
      local dest="examples/games/js/$(basename "$f")"
      rm -f "$dest"
      cp "$f" "$dest"
      n=$((n+1))
    }
    for f in "$src"/analogen_*.js; do copy_one "$f"; done
    for g in pong breakout beam_rider space_invaders qbert seaquest; do
      f="$src/$g.js"
      if [ ! -f "$f" ]; then echo "missing: $f" >&2; exit 1; fi
      copy_one "$f"
    done
    echo "synced $n files from $src"
    git status --short examples/games/js/ || echo "(no changes)"

# === CI ===

ci:
    just validate
    just bench
