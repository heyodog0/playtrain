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
    pnpm install
    uv sync --extra test
    just build-native

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

# === human baseline study (tools/STUDY.md) ===

# Build the participant-facing study site into dist/study.
study-build upload="":
    node tools/build-study.mjs {{ if upload == "" { "" } else { "--upload " + upload } }}

# Play the study yourself. Serves it AND saves your session to dist/study-sessions,
# so a playtest can be replay-verified like a real participant's.
study-serve port="8080":
    node tools/study-serve.mjs --port {{port}}

# Did the participants play the games the agents trained on? Diffs a checkout, a commit, or a
# list of hashes from another machine against dist/study/build-manifest.json. Run it before
# launch and again before quoting agent numbers next to human ones -- it is the one error
# replay verification cannot catch.
#   just study-audit examples/games/js
#   just study-audit --ref 8e38a6e
#   just study-audit --remote-cmd /path/on/cluster/examples/games/js
study-audit *ARGS:
    node tools/study-audit.mjs {{ARGS}}

# Prove the participant's runtime and the agent's runtime agree, on the study's own games
# and seeds: browser rasterizer vs Rust rasterizer, and node+V8 vs QuickJS+Rust. The whole
# human-vs-agent comparison rests on this, and it was previously only a claim in a README.
study-parity nsteps="400" *SEEDS="90000 90001":
    tools/study-parity.sh {{nsteps}} {{SEEDS}}

# Does the participant's browser change the environment? Runs one trace program unchanged in
# node, Chromium, Firefox and WebKit and demands byte-identical frames and state. 2000 steps
# is a full maxSteps episode, which is the unit that has to hold. Needs playwright browsers.
study-browsers nsteps="2000":
    node tools/study-browser-check.mjs --steps {{nsteps}}

# Prove that check can fail: perturb Math.sin by eps in the browser and expect a catch.
study-browsers-selftest eps="1e-3":
    node tools/study-browser-check.mjs --steps 600 --engines chromium --perturb {{eps}} || true

# Is this machine set up to run and analyse the study? Prints the fix for anything missing.
study-doctor:
    node tools/study-doctor.mjs

# Pull collected sessions from Firebase -> dist/study-data (needs FIREBASE_SERVICE_ACCOUNT).
study-pull *ARGS:
    node tools/study-pull.mjs {{ARGS}}

# The numbers behind the figures: per-game mean + 95% CI, and within-block change.
study-stats *ARGS:
    node tools/study-stats.mjs {{ARGS}}

# What participants wrote. Digest to stdout, or --csv <path> for a spreadsheet.
study-feedback *ARGS:
    node tools/study-feedback.mjs {{ARGS}}

# Check a collected session replays identically through the headless env.
# This is the acceptance test behind "participants and agents play identical tasks".
study-verify file:
    node tools/verify-replay.mjs {{file}}

# Screenshot every screen at five display sizes -> dist/study-shots/index.html
study-shots game="caveflyer": study-build
    node tools/study-shots.mjs --game {{game}} --screens

# Screenshot every participant-facing phase in order -> dist/study-phases/index.html,
# one self-contained page you can send to someone. Builds its own copy of the site.
study-phases size="1440x820":
    node tools/study-phases.mjs --size {{size}}

# Render recorded rounds to video by replaying them -> dist/study-video.
# GIF needs nothing; `--format mp4` needs ffmpeg. Add --best for one clip per game.
study-video file *ARGS:
    node tools/replay-video.mjs {{file}} {{ARGS}}

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

# Build the self-contained tester for a games dir and deploy it to Vercel → a shareable URL.
# One-time setup (once per machine): type `! npx vercel login` in the prompt.
# Then:  just share                 (this project's bundled games)
#        just share games/js        (the generated catalog)
#        just share ../analogen/games/js
share dir="examples/games/js":
    node tools/build-pages.mjs --games "{{dir}}" --out dist/share
    npx vercel deploy dist/share --prod --yes

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
