# PlayTrain for agents

Orientation for a coding agent working in this repo. Read this before searching.

## What this is

A catalog of 2D game environments plus a runtime that steps them fast. A game is a
single p5-style JavaScript file of about 200 lines. The runtime embeds QuickJS and a
Rust rasterizer. It exposes Gymnasium environments.

## The API, in full

```python
from playtrain.runtime import GameEnv, NativeVecEnv, list_available_games

list_available_games()                     # -> ["asteroids", "bigfish", ...]

env = GameEnv(game="breakout", obs_size=64)          # one env, Gymnasium API
obs, info = env.reset(seed=0)                        # Box(0,255,(64,64,3),uint8)
obs, reward, terminated, truncated, info = env.step(action)   # Discrete(8)

venv = NativeVecEnv(game="breakout", num_envs=64, num_threads=8, obs_size=64)
venv.reset(0)                                        # NOTE: `seeds`, positional
obs, rew, term, trunc = venv.step(actions)           # actions: (num_envs,) int64
venv.close()
```

`NativeVectorEnv` wraps `NativeVecEnv` in the Gymnasium `VectorEnv` API. Use it to plug
into an existing trainer. `AsyncNativeVecEnv` and `PingPongVecEnv` are the
double-buffered path.

## Pitfalls that have actually cost time

- **`NativeVecEnv.reset()` takes `seeds` positionally**, not `seed=`. `reset(0)` seeds
  every env with 0. `reset([0,1,2,...])` seeds them individually. `GameEnv.reset()` does
  take `seed=`, matching Gymnasium. The two differ.
- **Never name a directory `playtrain` next to your working directory.** It shadows the
  installed package and you get `ImportError: cannot import name 'GameEnv' from
  'playtrain.runtime' (unknown location)`, which looks like a broken install.
- **`examples/games/js/` is the catalog. `games/js/` is not.** Nine games differ between
  them, `breakout` included. `GameEnv("breakout")` loads the former.
- **The engine tier degrades silently.** Without clang or the AOT toolchain,
  `resolve_lib` falls back to the stock `.so`. Everything still works, only slower. If a
  throughput number looks low, check that first.
- **Three access paths cost very different amounts per step.** They are the C loop, the
  in-process threadpool, and the subprocess pipe, which is about 4x slower.
  Each script in `benchmarks/` names its path in its docstring. Do not compare
  numbers across them.
- **`getGameState()` returns `{score, lives, gameState}`.** That is reward bookkeeping,
  not an observation. Observations are rendered pixels.

## Layout

| path | what |
|---|---|
| `src/playtrain/runtime/` | the environments and the vectorized backends |
| `src/playtrain/gen/` | LLM generation, variants, refinement (needs the `gen` extra) |
| `examples/games/js/` | **the catalog** |
| `games/js/` | generation workspace, not shipped |
| `native/` | QuickJS host, build scripts, determinism gates |
| `crates/rasterizer/` | the Rust rasterizer |
| `benchmarks/` | throughput measurement, one script per paper claim |
| `reproduction/` | paper data, figures, the human-study harness |
| `tests/` | pytest suite |

## Running things

```bash
just test                 # tests
just bench                # catalog throughput
just validate             # the 5-check suite over the catalog
uvx playtrain games       # the catalog, no install
uvx playtrain bench       # throughput, no install
```

## Determinism is the invariant

A game's dynamics must be identical across engine paths, machines, and releases. Agent
and human results are only comparable because of that. `native/gate_qjs.sh` and
`native/aotfork/gate_async.py` check it. Changing a game's behavior is a versioned
decision: it needs a version bump and a release note.
