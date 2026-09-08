# PlayTrain

An RL framework for video-game environments that are generated and modified by a
language model. Every environment is a single JavaScript file. A person can play it. An
agent can train on the same game.

Building a new video-game environment has meant writing it by hand. So has changing an
existing one. PlayTrain replaces that with a JavaScript file an LLM writes from a short
prompt, plus a runtime that steps it as an ordinary Gymnasium environment. The runtime
is fast enough to train pixel-based agents end to end at over 1M agent-decisions per
second on a single GPU node.

PlayTrain is the artifact behind *An Efficient Reinforcement Learning Framework for
LLM-Generated Adaptable JavaScript Games* ([arXiv][paper]).

## Highlights

- Every environment is source you can read. It is a p5-style JavaScript file of about
  200 lines, not a compiled binary.
- You can modify a game in natural language. Fork `breakout` into "three balls at once"
  and train on it. New test sets, procedural generation, and changed dynamics are all
  edits to one file.
- The same file is playable in a browser and trainable headless. Human and agent
  performance are measured on identical tasks.
- The API is ordinary Gymnasium. It has `reset`, `step`, and `Box` observations, so it
  works with the trainer you already use.
- The catalog has 34 games. Some are clones of Atari and ProcGen games. Others are
  original.

## Getting started

The [Colab notebook][colab] is the quickest look. It installs PlayTrain, steps an
environment, edits a game's source, measures throughput, and trains an agent. Nothing to
set up.

To run locally, `examples/quickstart.py` takes one command and installs nothing
system-wide. It builds the native backend, so clang and cargo need to be on PATH.

```console
$ uv run https://raw.githubusercontent.com/heyodog0/playtrain/main/examples/quickstart.py
```

```python
from playtrain.runtime import GameEnv

env = GameEnv(game="breakout")
obs, info = env.reset(seed=0)
obs, reward, terminated, truncated, info = env.step(env.action_space.sample())
```

`NativeVecEnv` is the vectorized backend used for training. See the
[documentation][docs] for it, the catalog, and writing your own game.

## Installation

```console
$ git clone https://github.com/heyodog0/playtrain && cd playtrain
$ just install
```

`just install` syncs the Python environment and builds the native backend. The native
backend is the default runtime engine, not an optional add-on. It needs clang and cargo.
See [CONTRIBUTING.md](CONTRIBUTING.md).

Training also needs
[playtrain-trainers](https://github.com/heyodog0/playtrain-trainers). The LLM generation
pipeline is the `gen` extra.

## Layout

| directory | what is in it |
|---|---|
| `examples/games/js/` | The catalog. One JavaScript file per environment. This is what `GameEnv("breakout")` loads. |
| `examples/colab/` | The quickstart notebook. |
| `src/playtrain/runtime/` | The environments: the Gymnasium classes and the vectorized backends. |
| `src/playtrain/gen/` | Generation, variants, and refinement through an LLM. Includes the validation suite that gates what ships. |
| `native/` | The QuickJS host, the build scripts, and the determinism gates. `experiments/` holds the tuning-round job scripts and is not needed to build. |
| `crates/rasterizer/` | The Rust rasterizer that turns draw calls into observations. |
| `runtime/` | The p5-compatible JavaScript shim the games are written against. |
| `games/` | The generation workspace and reference material, not the shipped catalog. |
| `benchmarks/` | Throughput measurement, nine scripts. [BENCHMARKS.md](BENCHMARKS.md) states the methodology. |
| `reproduction/` | Figure code, paper data, the human-study harness, and the sweeps that produced the published figures. |
| `tools/` | Development scripts: the playtest UI, validation, profiling. |
| `tests/` | The test suite. |

## Reproducing the paper

Every figure and table redraws from committed data on a laptop. See
[REPRODUCING.md](REPRODUCING.md). Re-running the measurements needs the hardware they
were measured on. That document says which hardware.

## Getting help

Open an [issue](https://github.com/heyodog0/playtrain/issues) for bugs and feature
requests, or a [discussion](https://github.com/heyodog0/playtrain/discussions) for
questions.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup, the test suite, and
how to add a game. [GAME_TEMPLATE.md](GAME_TEMPLATE.md) is the contract a new game has
to satisfy.

## Version policy

PlayTrain is versioned `0.x`. The Python API may change between minor releases.

The game catalog is versioned with it. A game's behavior is fixed within a minor
release, so results stay comparable. Changes that alter an environment's dynamics are
listed in the release notes.

## Citation

```bibtex
@inproceedings{truong2027playtrain,
  title     = {PlayTrain: An Efficient Reinforcement Learning Framework for
               LLM-Generated Adaptable JavaScript Games},
  author    = {Truong, Ryan and Ying, Lance and Gershman, Samuel J. and Irie, Kazuki},
  booktitle = {International Conference on Learning Representations},
  year      = {2027},
}
```

## License

MIT. See [LICENSE](LICENSE).

The native backend statically links quickjs-ng and openlibm. Their notices are in
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

[paper]: https://arxiv.org/abs/XXXX.XXXXX
[colab]: https://colab.research.google.com/github/heyodog0/playtrain/blob/main/examples/colab/playtrain_quickstart.ipynb
[docs]: https://playtrain.org
