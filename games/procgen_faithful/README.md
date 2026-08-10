# procgen_faithful

Literal ports of ProcGen games from `games/procgen_src/*.cpp`, kept **out** of
`games/js/` and `examples/games/js/` so they don't shadow the catalog versions
or change what any existing benchmark number refers to.

| game | ported from | mode |
|---|---|---|
| `climber.js` | `games/procgen_src/climber.cpp` | easy |
| `jumper.js` | `games/procgen_src/jumper.cpp` | easy |

Both simulate in ProcGen's own frame — tile units, y increasing **upward** —
and only flip at render time, so the code reads against the C++ line by line.
They also port the engine pieces those games inherit: the sub-stepped swept
collision and camera from `basic-abstract-game.cpp`, and for jumper the
randomized-Kruskal maze (`mazegen.cpp`) and the cellular automata / flood fill /
BFS / dilation pipeline (`roomgen.cpp`).

Each file ends with a `Deviations from procgen_src/<game>.cpp` block listing
every place it knowingly differs (flat colors, fixed player color, Discrete(8)
action mapping, jumper's cyan goal, degenerate-level guards).

## Running them

The tooling hardcodes its game directory (`list_available_games` globs
`games/js/*.js`, non-recursively; `tools/play.mjs` reads `examples/games/js`),
so `just play` and `playtrain-validate` will **not** find these. Pass the path
directly instead — `QuickJSEnv` accepts a full `.js` path as `game`:

```python
from playtrain.runtime import QuickJSEnv
env = QuickJSEnv(game="games/procgen_faithful/jumper.js")
obs, info = env.reset(seed=0)
```

To validate:

```python
from pathlib import Path
from playtrain.runtime import QuickJSEnv
from playtrain.runtime.validate import run_validation

GD = Path("games/procgen_faithful").resolve()
run_validation(
    env_factory=lambda *, game, **kw: QuickJSEnv(game=str(GD / f"{game}.js"), **kw),
    games=["climber", "jumper"], expected_shape=(64, 64, 3), n_actions=8,
    determinism_tolerance=0.0, output_path=None,
)
```

Both pass all 5 checks (QuickJS backend, ~15k FPS), are deterministic over 60
seeds x 2000 steps, and render byte-identically on the QuickJS and Node backends.

## Fidelity

Checked against the real ProcGen env driven through the *same* 8 actions
PlayTrain exposes, mapped onto ProcGen's move encoding, 300 seeds, easy mode:

| | climber port / real | jumper port / real |
|---|---|---|
| mean episode length | 645 / 713 | 328 / 304 |
| mean return | 2.68 / 2.15 | 3.73 / 4.30 |
| win / death | 64 / 89 vs 48 / 84 | 115 / 135 vs 121 / 131 |

Exact agreement is not possible — PlayTrain requires mulberry32 while ProcGen
uses its own RandGen, so the two generate different levels from the same seed.
Matching distributions across all three measures is the available signal.

Note jumper's reward is sparse **by design**: +10 for the goal and nothing else,
exactly as in ProcGen. A random agent scoring ~0 is correct.
