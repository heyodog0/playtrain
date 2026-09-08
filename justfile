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

# Install deps AND build the native QuickJS backend (the default runtime engine).
install:
    uv sync --extra test
    just build-native

# Node tooling for the playable-page builders (tools/build-pages.mjs, just play).
install-web:
    pnpm install

# Build the native QuickJS + rasterizer backend (QuickJSEnv / NativeVecEnv — the default).
build-native:
    bash native/build_qjs.sh
    bash native/build_qjs_vec.sh

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

# Quick smoke: spawn the default (QuickJS) backend on flappy_bird, run 100 steps.
smoke:
    uv run python -c "from playtrain.runtime import GameEnv; e = GameEnv(game='flappy_bird'); e.reset(seed=0); r = sum(e.step(e.action_space.sample())[1] for _ in range(100)); print(f'reward over 100 steps: {r:.2f}'); e.close()"

# 5-check validation suite over all bundled p5 games (~1 min).
validate:
    uv run python tools/validate.py --all

# Validate a single bundled p5 game.
validate-one game:
    uv run python tools/validate.py --game {{game}}

# Benchmark step throughput across all bundled p5 games.
bench:
    uv run python benchmarks/bench.py --all

bench-one game:
    uv run python benchmarks/bench.py --game {{game}}

# Aggregate throughput of the in-process C++ threadpool backend (NativeVecEnv).
bench-vec n="8":
    uv run python benchmarks/bench_native_vec.py --n {{n}}

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
    uv run playtrain-generate --catalog {{catalog}} --name {{name}} --model {{model}} --ref {{ if mechanic == "no" { "--no-mechanic" } else { "" } }}

# Generate every game across every catalog.
gen-all model="pro" mechanic="yes":
    uv run playtrain-generate --all --model {{model}} --ref {{ if mechanic == "no" { "--no-mechanic" } else { "" } }}

# Closed-loop refine a generated clone against the REAL Atari ROM (needs ale-py + GEMINI_API_KEY).
refine-vs-rom name iters="3" feedback="" model="pro":
    uv run --extra rom AutoROM --accept-license
    uv run --extra rom python tools/refine_vs_rom.py --game {{name}} --iters {{iters}} --model {{model}} --feedback "{{feedback}}"

# === game variants (prototype forks) ===

variant parent prompt name="" model="pro":
    uv run playtrain-variant --parent {{parent}} --prompt {{quote(prompt)}} --name {{name}} --model {{model}}

variants:
    uv run playtrain-variant --list

promote name:
    uv run playtrain-variant --promote {{name}}

unvariant name:
    uv run playtrain-variant --delete {{name}}

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

# The distributable wheel, exactly as CI builds it (native backend bundled).
wheel:
    uv build --wheel

pack:
    pnpm pack

# Build a self-contained static playtest site from the bundled games into dist/pages/.
build-pages:
    node tools/build-pages.mjs

serve-pages: build-pages
    cd dist/pages && python3 -m http.server 5051

# === human study harness (study/README.md) ===

# Play the study yourself. Builds it, serves it, and saves your session.
study-serve port="8080":
    node study/study-serve.mjs --port {{port}}

# Build the participant-facing static site into dist/study.
study-build upload="":
    node study/build-study.mjs {{ if upload == "" { "" } else { "--upload " + upload } }}

# Replay a collected session through the headless env and check the scores reproduce.
study-verify +SESSIONS:
    node study/verify-replay.mjs {{SESSIONS}}

# Re-render a recorded episode to GIF from its logged actions.
study-video session *ARGS:
    node study/replay-video.mjs {{session}} {{ARGS}}

# Did the participants play the same game files the agents trained on?
study-audit *ARGS:
    node study/study-audit.mjs {{ARGS}}

# Pure-JS rasterizer vs Rust rasterizer vs native QuickJS, on the study games.
study-parity nsteps="400" *SEEDS="90000 90001":
    bash study/study-parity.sh {{nsteps}} {{SEEDS}}

# Chromium, Firefox and WebKit produce identical traces. Needs Playwright browsers.
study-browsers nsteps="2000":
    node study/study-browser-check.mjs --steps {{nsteps}}

# === CI ===

ci:
    just validate
    just bench
