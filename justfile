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
