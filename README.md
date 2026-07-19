# PlayTrain

**LLM-generated 2D game environments + a headless RL runtime for Gymnasium.**

PlayTrain has two halves, shipped as one installable Python package (`playtrain`):

- **`playtrain.runtime`** — a headless Node.js / QuickJS runtime that runs JavaScript games (p5.js, Matter.js, Three.js) as Gymnasium RL environments, with no browser. Fast (mean ~4300 FPS/env for p5 on an M4 Pro) via binary IPC + mmap observation transfer, plus an envpool-class native C++ vectorized backend.
- **`playtrain.gen`** — LLM (Gemini) generation and natural-language modification of p5.js games, with a 5-check ProcGen-style validation harness that gates which generated games ship.

> Training, evaluation, and paper-figure code live in the sibling `paper/` repo (`gym-gen-experiments`). This repo owns the runtime, the game catalog, the generation pipeline, and the validation contract.

## Setup

Requires Node.js ≥18, Python ≥3.11, [`uv`](https://docs.astral.sh/uv/), [`pnpm`](https://pnpm.io), and [`just`](https://just.systems). `bootstrap.sh` installs whichever of uv/pnpm/just are missing.

```bash
git clone https://github.com/heyodog0/playtrain
cd PlayTrain
./bootstrap.sh      # only if you don't already have uv / pnpm / just
just install        # pnpm install + uv sync
just test           # runtime smoke tests
```

## Quickstart

```python
from playtrain.runtime import PlayTrainEnv

env = PlayTrainEnv(game="flappy_bird")
obs, info = env.reset(seed=0)
for _ in range(1000):
    obs, reward, terminated, truncated, info = env.step(env.action_space.sample())
    if terminated or truncated:
        obs, info = env.reset()
env.close()
```

`obs` is a `(64, 64, 3)` uint8 array; `action` is a discrete int in `[0, 8)`. For RL training use the vectorized `from playtrain.runtime import PlayTrainVecEnv` (one process, N Node workers, zero-copy mmap batch), or the native C++ backend `NativeVecEnv` once built (see below).

## Common tasks

```bash
# runtime
just validate           # 5-check suite over bundled p5 games
just bench              # per-game FPS
just play flappy_bird   # browser game picker

# generation (playtrain.gen)
just gen-game games/catalogs/atari_games.json breakout   # generate a game via Gemini
just gen-validate       # validate the generated catalog (games/js)
just variant breakout "3x faster ball" fastball          # fork a game via natural language
just tester             # browser playtest UI + Gemini refinement
```

Run `just` with no args to see every recipe.

## Repo map

```text
src/playtrain/
  runtime/        headless env classes (PlayTrainEnv, QuickJSEnv, PlayTrainVecEnv, NativeVecEnv, …)
  gen/            generation catalog + ProcGen-style validation harness
runtime/          the JS runtime (p5 / three.js workers + shims) that the Python envs spawn
native/           C++/QuickJS native backend (embedded engine + rasterizer, envpool-class vec host)
crates/           Rust rasterizer crate -> runtime/p5/rasterizer.wasm
examples/games/   bundled p5 + three.js games (the runtime's default catalog)
games/            the generated p5 catalog, catalogs/, procgen refs, variants
tools/            dev scripts: generation, refinement, validation, benchmarks, tester, site build
tests/            runtime pytest suite
docs/             design docs, protocol, LLM prompts, validation write-ups
GAME_TEMPLATE.md  the p5.js game contract used by the generator
```

## Native backend (optional, fastest)

The default `QuickJSEnv` and the vectorized `NativeVecEnv` build an embedded QuickJS + rasterizer host:

```bash
bash native/build_qjs.sh        # rasterizer + quickjs staticlibs, qjs_host
bash native/build_qjs_vec.sh    # libqjs_vec (envpool-class threadpool backend)
```

## Design

- **Action space**: Discrete(8) for p5 (Discrete(15) for the three.js runtime) — abstract directional + button, identical across games of a kind.
- **Observations**: 64×64×3 RGB (p5), matching ProcGen conventions.
- **Seed-based determinism**: same seed + actions ⇒ same trajectory.
- **Validation**: shape, action-space, determinism, throughput, and episode-bounds checks; a generated game must pass all five before entering the catalog. See `GAME_TEMPLATE.md` and `docs/llm/VALIDATION.md`.

## License

MIT
