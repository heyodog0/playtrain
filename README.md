# PlayTrain

[![PyPI](https://img.shields.io/pypi/v/playtrain.svg)](https://pypi.org/project/playtrain/)
[![Python](https://img.shields.io/pypi/pyversions/playtrain.svg)](https://pypi.org/project/playtrain/)
[![License](https://img.shields.io/pypi/l/playtrain.svg)](https://github.com/heyodog0/playtrain/blob/main/LICENSE)

A catalog of 2D reinforcement-learning environments that run fast enough to stop being
the bottleneck — each one a readable JavaScript file you can edit.

<!-- TODO(release): throughput figure -->

PlayTrain is the artifact behind *[paper title]* ([arXiv][paper]). Environments are
generated and modified by an LLM, then run headless on an embedded QuickJS engine and a
native rasterizer.

## Highlights

- ⚡️ **3.6M environment steps/s** on one 80-thread node — 2.6× a tuned EnvPool and 20× ALE
- 📖 **Every environment is source you can read** — ~200 lines of p5-style JavaScript, not a compiled binary
- ✍️ **Change the game in natural language** — fork `breakout` into "three balls at once" and train on it
- 🔌 **Ordinary Gymnasium** — `reset`, `step`, `Box` observations; drop it into the trainer you already use
- 🧵 **Near-linear worker scaling**, and a vectorized backend that keeps a GPU learner fed
- 🎮 **34 games** in the default catalog, from ProcGen and Atari clones to originals

## Getting started

Try it without installing anything:

```console
$ uv run https://raw.githubusercontent.com/heyodog0/playtrain/main/examples/quickstart.py
```

Or open the [Colab notebook][colab] to train an agent end to end in the browser.

```python
from playtrain.runtime import GameEnv

env = GameEnv(game="breakout")
obs, info = env.reset(seed=0)
obs, reward, terminated, truncated, info = env.step(env.action_space.sample())
```

For the vectorized backend, the game catalog, and writing your own game, see the
[documentation][docs].

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

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup — building the native
runtime from source, the test suite, and how to add a game to the catalog
([GAME_TEMPLATE.md](GAME_TEMPLATE.md) is the contract a new game has to satisfy).

## Version policy

PlayTrain is versioned `0.x` and the Python API may change between minor releases. The
game catalog is versioned with it: a game's behavior is fixed within a minor release, so
results stay comparable. Changes that alter an environment's dynamics are called out in
the release notes.

## Citation

```bibtex
@inproceedings{playtrain,
  title  = {...},
  author = {...},
  year   = {2027},
}
```

## License

MIT. See [LICENSE](LICENSE).

[paper]: https://arxiv.org/abs/XXXX.XXXXX
[colab]: https://colab.research.google.com/github/heyodog0/playtrain/blob/main/examples/colab/playtrain_quickstart.ipynb
[docs]: https://playtrain.org
