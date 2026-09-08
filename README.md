# PlayTrain

An RL framework for video-game environments that are generated and modified by a
language model. Every environment is a single JavaScript file. A person can play it. An
agent can train on the same game.

Building a new video-game environment has meant writing it by hand. So has changing an
existing one. PlayTrain replaces that with a JavaScript file an LLM writes from a short
prompt, plus a runtime that steps it as an ordinary Gymnasium environment. The runtime
is fast enough to train pixel-based agents end to end at over 1M agent-decisions per
second on a single GPU node, using the IMPALA and PPO trainers in
[playtrain-trainers](https://github.com/heyodog0/playtrain-trainers).

PlayTrain is the artifact behind *An Efficient Reinforcement Learning Framework for
LLM-Generated Adaptable JavaScript Games* ([arXiv][paper]).

## Three parts

- **`playtrain.runtime`** runs p5.js and Matter.js games as Gymnasium environments with
  no browser. The default backend embeds QuickJS and a native rasterizer, and
  `NativeVecEnv` is the vectorized backend used for training. A portable Node backend is
  the fallback for machines without the native build.
- **`playtrain.gen`** writes and modifies those games through an LLM, with a five-check
  validation harness that gates which generated games enter the catalog.
- **[playtrain-trainers](https://github.com/heyodog0/playtrain-trainers)** trains agents
  on them. IMPALA with V-trace and PPO, both configured by a JSON file. It is a separate
  package that depends on this one, and it produced every training number in the paper.
  See [Training](#training).

The catalog has 35 games. Some are clones of Atari and ProcGen games, some are original,
and several ship as deliberate variants of a base game. The project page is at
[playtrain.org](https://playtrain.org).

## Getting started

The [Colab notebook][colab] is the quickest look. It installs PlayTrain, steps an
environment, edits a game's source, measures throughput, and trains an agent. Nothing to
set up.

To run locally, `examples/quickstart.py` takes one command and installs nothing
system-wide. It needs [uv](https://docs.astral.sh/uv/), which reads the dependency
header in the script, and it builds the native backend, so clang and cargo need to be
on PATH.

```console
$ uv run https://raw.githubusercontent.com/heyodog0/playtrain/main/examples/quickstart.py
```

## Installation

Needs Python 3.11 or newer, plus clang and cargo. On macOS the default `python3` is
often older, so check with `python3 --version` first.

```console
$ git clone https://github.com/heyodog0/playtrain && cd playtrain
$ python3 -m venv .venv && .venv/bin/pip install -e .
```

Or with [uv](https://docs.astral.sh/uv/):

```console
$ git clone https://github.com/heyodog0/playtrain && cd playtrain
$ uv venv && uv pip install -e .
```

Either way this builds the native backend as part of the install, which takes about a
minute the first time. The backend is the default runtime engine, not an optional
add-on, which is why clang and cargo are needed.

The LLM generation pipeline is the `gen` extra, `pip install -e ".[gen]"`. Training is a
separate package, [playtrain-trainers](https://github.com/heyodog0/playtrain-trainers),
covered below.

## Quickstart

```python
from playtrain.runtime import GameEnv

env = GameEnv(game="flappy_bird")
obs, info = env.reset(seed=0)
for _ in range(1000):
    obs, reward, terminated, truncated, info = env.step(env.action_space.sample())
    if terminated or truncated:
        obs, info = env.reset()
env.close()
```

`obs` is a `(64, 64, 3)` uint8 array and the action is an integer in `[0, 8)`. For
training, use the vectorized backend, which runs N environments on an in-process C++
threadpool in a single process:

```python
from playtrain.runtime import NativeVecEnv

venv = NativeVecEnv(game="flappy_bird", num_envs=64, num_threads=8)
venv.reset(0)                      # seeds, positional
obs, reward, terminated, truncated = venv.step(actions)
```

## Training

The trainers are a separate package,
[playtrain-trainers](https://github.com/heyodog0/playtrain-trainers). It depends on
`playtrain` and reaches environments only through `playtrain.runtime`, so the split is
that this repo owns the games and that one owns the algorithms. Installing it pulls this
package in.

```console
$ git clone https://github.com/heyodog0/playtrain-trainers && cd playtrain-trainers
$ uv venv && uv pip install -e .
$ python -m playtrain_trainers.train_impala --config configs/impala_quickstart.json
```

Two are provided: IMPALA with V-trace, whose math is bit-exact against FAIR's torchbeast,
and PPO. Both are configured by a JSON file and both write TensorBoard scalars, where
`charts/mean_episode_return` is the number to watch.

A run names a game from this catalog:

```json
{ "game": "breakout", "env_backend": "playtrain", "inference_mode": "vec" }
```

`env_backend` has to be `"playtrain"`, since it defaults to `"minigrid"`. A game you
generated yourself is trained by naming it and pointing at its directory:

```json
{ "game": "my_game", "vec_games_dir": "games/js" }
```

That repo's README has the full config schemas for both trainers.

## Making a game

Games are written and modified by a language model. Install the extra with
`pip install -e ".[gen]"` and set `GEMINI_API_KEY`. The runtime and the trainers never
need a key.

### From scratch

Describe the game in a catalog, which is a JSON list with one object per game:

```json
[
  {
    "name": "breakout",
    "ref": "https://ale.farama.org/environments/breakout/",
    "actions_used": ["LEFT", "RIGHT", "D"],
    "mechanic": "paddle + ball + bricks"
  }
]
```

Only `name` is required. `actions_used` are the `default8` keys the game should use,
`mechanic` is a one-line description, and `ref` is a URL that gets fetched and pasted
into the prompt as plain text when you pass `--ref`.

```console
$ playtrain-generate --catalog my_games.json --name breakout --ref
$ playtrain-validate --game breakout
$ python tools/tester.py
```

The game is written to `games/js/`, the workspace, not to the catalog. Promote it with
`playtrain-variant --promote <name>` once it passes. `playtrain-validate` runs the five
checks that gate the catalog, and the tester lets you play it and send refinements.
Drop `--name` to generate every entry in the catalog. `just gen-game <catalog> <name>`
is the shorthand.

### From an existing game

Fork one with a prompt, play and refine it in the browser, then promote it into the
catalog:

```console
$ just variant breakout "three balls at once, losing one costs a life" breakout.multi
$ just tester
$ just promote breakout.multi
```

`just tester` serves a UI on localhost where you play the game, read its source, and send
refinement prompts.

Authoring is cheap. The six artifacts reported in the paper averaged under twenty cents
and under six minutes of model time each.

[`just`](https://just.systems) installs into the same venv with `pip install rust-just`,
or from brew, cargo or apt. Every recipe is a one-line wrapper, so it stays optional. The
same three steps without it:

```console
$ playtrain-variant --parent breakout --name breakout.multi \
    --prompt "three balls at once, losing one costs a life"
$ python tools/tester.py
$ playtrain-variant --promote breakout.multi
```

## Common tasks

```console
# runtime
just test                  # the pytest suite
just validate              # the five checks over the catalog
just bench                 # per-game throughput
just play flappy_bird      # play a game yourself
just build-native          # rebuild the native backend

# generation
just gen-game games/catalogs/atari_games.json breakout   # write a new game
just gen-validate                                        # validate the generated catalog
just variants                                            # list variants
```

`just --list` shows the rest.

## Design

- **Action space.** Action spaces are data, not code. They live in
  `runtime/action_spaces.json` and are chosen per environment, so adding one means
  editing a JSON file rather than touching the runtime:

  ```python
  GameEnv(game="caveflyer", action_space="thrust10")
  ```

  Five ship today. **`default8`** is the abstract directional and button set every game
  in the catalog is authored against, which is what lets one policy head train across
  the whole catalog. **`thrust10`** adds rotate-and-thrust, which `default8` cannot
  express. **`aimgrid18`** is a coarse aiming grid. **`mouse2d`** and **`gamepad2s`**
  are continuous box spaces over pointer and axis channels.

  A discrete action is a set of held key codes for the frame, optionally with a press
  key that also fires a `keyPressed()` event, and optionally with analog pointer or axis
  values. Analog values are quantized to uint16 at the wire, so replay and the
  cross-engine determinism gate stay bit-exact even under continuous control.
- **Observations.** 64x64x3 RGB, matching ProcGen conventions. One step is one rendered
  frame, with no frame skip and no frame stacking.
- **Determinism.** The same seed and the same actions produce the same trajectory,
  across engine paths and machines. This is what makes human and agent results
  comparable, and `native/gate_qjs.sh` checks it.
- **Validation.** A generated game enters the catalog only after passing five checks on
  shape, action space, determinism, throughput and episode bounds.
  [GAME_TEMPLATE.md](GAME_TEMPLATE.md) is the contract it is written against.

## Layout

| directory | what is in it |
|---|---|
| `examples/games/js/` | The catalog. One JavaScript file per environment. This is what `GameEnv("breakout")` loads. |
| `examples/colab/` | The quickstart notebook. |
| `src/playtrain/runtime/` | The environments: the Gymnasium classes and the vectorized backends. |
| `src/playtrain/gen/` | Generation, variants, and refinement through an LLM. Includes the validation suite that gates what ships. |
| `native/` | The QuickJS host, the build scripts, and the determinism gates. |
| `crates/rasterizer/` | The Rust rasterizer that turns draw calls into observations. |
| `runtime/` | The p5-compatible JavaScript shim the games are written against. |
| `games/` | Not the catalog and not games. Inputs and workspace for the generation pipeline: `catalogs/` to write from, `procgen_src/` as C reference, and an empty `js/` where `playtrain-generate` writes. |
| `benchmarks/` | Throughput measurement. One script per claim in the paper. Each states in its docstring what it measures and which access path. |
| `reproduction/` | Figure code, paper data, and the sweeps that produced the published figures. |
| `study/` | The browser harness that collected the human baseline, and the replay check that makes human and agent scores comparable. |
| `tools/` | Development scripts: the playtest UI, validation, profiling. |
| `tests/` | The test suite. |

## Reproducing the paper

```console
$ bash reproduction/reproduce.sh
```

This redraws every measured figure and table and prints the paper's number beside the
one it computed. Add `--all` to include the learning curves, which download 277 MB of
run data first. See [REPRODUCING.md](REPRODUCING.md).

## Getting help

Open an [issue](https://github.com/heyodog0/playtrain/issues) for bugs and feature
requests, or a [discussion](https://github.com/heyodog0/playtrain/discussions) for
questions.

## Version policy

PlayTrain is versioned `0.x`. The Python API may change between minor releases.

The game catalog is versioned with it. A game's behavior is fixed within a minor
release, so results stay comparable. Changes that alter an environment's dynamics are
listed in the release notes.

## Citation

```bibtex
@article{truong2026playtrain,
  title  = {PlayTrain: An Efficient Reinforcement Learning Framework for
            LLM-Generated Adaptable JavaScript Games},
  author = {Truong, Ryan and Ying, Lance and Gershman, Samuel J.
            and Irie, Kazuki},
  year   = {2026},
  url    = {https://playtrain.org}
}
```

## License

MIT. See [LICENSE](LICENSE).

The native backend statically links quickjs-ng and openlibm. Their notices are in
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

[paper]: https://arxiv.org/abs/XXXX.XXXXX
[colab]: https://colab.research.google.com/github/heyodog0/playtrain/blob/main/examples/colab/playtrain_quickstart.ipynb
