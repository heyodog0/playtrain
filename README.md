# PlayTrain

[![PyPI](https://img.shields.io/pypi/v/playtrain.svg)](https://pypi.org/project/playtrain/)
[![Python](https://img.shields.io/pypi/pyversions/playtrain.svg)](https://pypi.org/project/playtrain/)
[![License](https://img.shields.io/pypi/l/playtrain.svg)](https://github.com/heyodog0/playtrain/blob/main/LICENSE)

An RL framework for video-game environments that are generated and modified by a
language model. Every environment is a single JavaScript file: a person can play it,
and an agent can train on the same game.

Developing a new video-game environment, or modifying an existing one, has meant
extensive hand-coding. PlayTrain replaces that with a JS file an LLM writes from a short
prompt, and a runtime that steps it as an ordinary Gymnasium environment — fast enough
to train pixel-based agents end-to-end at over 1M agent-decisions per second on a single
GPU node.

PlayTrain is the artifact behind *An Efficient Reinforcement Learning Framework for
LLM-Generated Adaptable JavaScript Games* ([arXiv][paper]).

## Highlights

- Every environment is source you can read: a p5-style JavaScript file, typically around
  200 lines, not a compiled binary.
- Modify a game in natural language — fork `breakout` into "three balls at once", then
  train on it. Novel test sets, procedural generation, and altered dynamics are edits to
  one file.
- The same file is playable in a browser and trainable headless, so human and agent
  performance are measured on identical tasks.
- Ordinary Gymnasium: `reset`, `step`, `Box` observations. It drops into the trainer you
  already use.
- Clones of well-known Atari and ProcGen games, plus originals: 34 in the catalog.

## Getting started

Run it without installing anything:

```console
$ uv run https://raw.githubusercontent.com/heyodog0/playtrain/main/examples/quickstart.py
```

Or open the [Colab notebook][colab], which trains an agent end to end in the browser.

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
$ uv add playtrain          # or: pip install playtrain
```

Wheels bundle the native runtime, so no compiler is needed. Add the trainers with
`uv add playtrain-trainers`, or the LLM generation pipeline with `playtrain[gen]`.

## Reproducing the paper

Every figure and table redraws from committed data on a laptop; see
[REPRODUCING.md](REPRODUCING.md). Re-running the measurements themselves needs the
hardware they were measured on, which that document also states.

## Getting help

Open an [issue](https://github.com/heyodog0/playtrain/issues) for bugs and feature
requests, or a [discussion](https://github.com/heyodog0/playtrain/discussions) for
questions.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup, the test suite, and
how to add a game — [GAME_TEMPLATE.md](GAME_TEMPLATE.md) is the contract a new game has
to satisfy.

## Version policy

PlayTrain is versioned `0.x` and the Python API may change between minor releases. The
game catalog is versioned with it: a game's behavior is fixed within a minor release, so
results stay comparable. Changes that alter an environment's dynamics are called out in
the release notes.

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

The wheels bundle a native backend that statically links quickjs-ng and openlibm; their
notices are in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

[paper]: https://arxiv.org/abs/XXXX.XXXXX
[colab]: https://colab.research.google.com/github/heyodog0/playtrain/blob/main/examples/colab/playtrain_quickstart.ipynb
[docs]: https://playtrain.org
