# PlayTrain

**LLM-generated 2D game environments + a headless RL runtime for Gymnasium.**

PlayTrain has two halves, shipped as one installable Python package (`playtrain`):

- **`playtrain.runtime`** — a headless runtime that runs p5.js / Matter.js games as Gymnasium RL environments, with no browser. The **default backend is `QuickJSEnv`** (aliased `GameEnv`): an embedded QuickJS engine + native rasterizer — 100% JS coverage, deterministic, and the fastest path — plus an envpool-class native C++ vectorized backend (`NativeVecEnv`). A portable pure-Node backend (`PlayTrainEnv`) is available as a fallback.
- **`playtrain.gen`** — LLM (Gemini) generation and natural-language modification of p5.js games, with a 5-check ProcGen-style validation harness that gates which generated games ship.

> Training, evaluation, and paper-figure code live in the sibling `paper/` repo (`gym-gen-experiments`). This repo owns the runtime, the game catalog, the generation pipeline, and the validation contract.

## Setup

Requires Node.js ≥18, Python ≥3.11, a C/C++ toolchain (clang), the Rust toolchain (cargo), [`uv`](https://docs.astral.sh/uv/), [`pnpm`](https://pnpm.io), and [`just`](https://just.systems). `bootstrap.sh` installs whichever of uv/pnpm/just are missing.

```bash
git clone https://github.com/heyodog0/playtrain
cd playtrain
./bootstrap.sh      # only if you don't already have uv / pnpm / just
just install        # pnpm install + uv sync + build the native QuickJS backend
just test           # runtime smoke tests
```

`just install` builds the native QuickJS backend (`native/build_qjs.sh` + `build_qjs_vec.sh`) — it is the default runtime engine, not an optional add-on.

## Quickstart

```python
from playtrain.runtime import GameEnv   # QuickJSEnv — the default backend

env = GameEnv(game="flappy_bird")
obs, info = env.reset(seed=0)
for _ in range(1000):
    obs, reward, terminated, truncated, info = env.step(env.action_space.sample())
    if terminated or truncated:
        obs, info = env.reset()
env.close()
```

`obs` is a `(64, 64, 3)` uint8 array; `action` is a discrete int in `[0, 8)`. For RL training use the envpool-class native vectorized backend `from playtrain.runtime import NativeVecEnv` (one process, N QuickJS envs on an in-process C++ threadpool). A pure-Node fallback (`PlayTrainEnv` / `PlayTrainVecEnv`) exists for environments without the native build.

## Common tasks

```bash
# runtime
just validate           # 5-check suite over bundled p5 games
just bench              # per-game FPS (see benchmarks/README.md for methodology)
just build-native       # rebuild the native QuickJS backend
just play flappy_bird   # browser game picker

# generation (playtrain.gen)
just gen-game games/catalogs/atari_games.json breakout   # generate a game via Gemini
just gen-validate       # validate the generated catalog (games/js)
just variant breakout "3x faster ball" fastball          # fork a game via natural language
just tester             # browser playtest UI + Gemini refinement
```

Run `just` with no args to see every recipe.

## From prompt to trained agent

The full loop — author a game in natural language, play it, train on it:

```bash
export GEMINI_API_KEY=...   # generation only; runtime and training need no key

# 1. Generate (or fork) a game
uv run playtrain-variant --parent breakout --prompt "3 simultaneous balls, lost balls cost a life" --name breakout.multi
uv run playtrain-refine --game breakout.multi --feedback "make random play score less"

# 2. Play it yourself — same file, same engine as the agent
just play breakout.multi

# 3. Validate and train
uv run playtrain-validate --game breakout.multi
pip install playtrain-trainers   # or: git+https://github.com/heyodog0/playtrain-trainers
python -m playtrain_trainers.train_impala --config configs/impala_quickstart.json
```

Generation costs are small (the six authored artifacts in the paper averaged
under \$0.20 and under six minutes of model time each), and training runs at
up to ~350k agent-steps/s per learner GPU pair on the vectorized backend.


## Repo map

```text
src/playtrain/
  runtime/        headless env classes (QuickJSEnv/GameEnv default, NativeVecEnv, PlayTrainEnv, …)
  gen/            generation catalog + ProcGen-style validation harness
runtime/          the JS runtime (p5 workers + shims) that the Node fallback spawns
native/           C++/QuickJS native backend (embedded engine + rasterizer, envpool-class vec host)
crates/           Rust rasterizer crate -> runtime/p5/rasterizer.wasm
examples/games/   bundled p5 games (the runtime's default catalog)
games/            the generated p5 catalog, catalogs/, procgen refs, variants
tools/            dev scripts: generation, refinement, validation, tester, site build
benchmarks/       throughput benchmarks + the methodology behind every reported number
tests/            runtime pytest suite
GAME_TEMPLATE.md  the p5.js game contract used by the generator
```

## Native backend (the default)

The default `GameEnv` (`QuickJSEnv`) and the vectorized `NativeVecEnv` run on an embedded QuickJS + rasterizer host, built by `just install`. To (re)build it directly:

```bash
bash native/build_qjs.sh        # rasterizer + quickjs staticlibs, qjs_host
bash native/build_qjs_vec.sh    # libqjs_vec (envpool-class threadpool backend)
```

## Design

- **Action space**: Discrete(8) (`default8`) — abstract directional + button, identical across games. Any space can be declared in `runtime/action_spaces.json` and selected per env via `action_space=`: discrete tables (held keys + optional press key + optional pointer/buttons/axes per action) or continuous **box spaces** over pointer/button/axis channels (`mouse2d`, `gamepad2s` → `gym.spaces.Box`). Analog values are quantized to uint16 at the wire, so replay and the cross-engine gate stay bit-exact even with continuous control. The catalog and all generated games are authored against `default8`; pointer games (see `GAME_TEMPLATE.md` pointer tier) are a separate family.
- **Observations**: 64×64×3 RGB, matching ProcGen conventions.
- **Seed-based determinism**: same seed + actions ⇒ same trajectory.
- **Validation**: shape, action-space, determinism, throughput, and episode-bounds checks; a generated game must pass all five before entering the catalog. See `GAME_TEMPLATE.md`.

## License

MIT
