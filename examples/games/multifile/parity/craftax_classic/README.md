# Craftax-Classic

A JavaScript port of Craftax-Classic that steps exactly like PufferLib's C
implementation. It trains on pixels and plays in the browser from the same
file.

Reference: PufferLib `ocean/craftax_classic/craftax_classic.h` at
[`6ffa5b1`](https://github.com/PufferAI/PufferLib), MIT. Craftax itself is
Matthews et al., [ICML 2024](https://arxiv.org/abs/2402.16801).

## Play it

```console
$ node tools/build-pages.mjs --games examples/games/multifile/parity/craftax_classic/dist \
    --out dist/craftax-play --title "Craftax-Classic"
$ uv run python -m http.server -d dist/craftax-play 8000
```

Open <http://localhost:8000/game/craftax_classic/>. The game runs at 8 steps/s.
Arrows move, SPACE interacts and TAB sleeps. Keys 1 to 4 place stone, a table, a
furnace and a sapling. Keys 5 to 7 craft wood, stone and iron pickaxes, and 8, 9
and 0 craft the swords. Crafting needs a table nearby, and iron also needs a
furnace.

## Train an agent

Install [playtrain-trainers](https://github.com/heyodog0/playtrain-trainers) and
write a config:

```json
{
  "game": "craftax_classic",
  "env_backend": "playtrain",
  "inference_mode": "vec",
  "num_actions": 17,
  "obs_shape": [3, 64, 64],
  "net": "impala",
  "total_steps": 10000000,
  "log_dir": "outputs/craftax_classic"
}
```

```console
$ python -m playtrain_trainers.train_impala --config craftax_classic.json
```

PlayTrain reads the 17 actions and the 10,000-step limit from
`dist/craftax_classic.json`. From your own code:

```python
import numpy as np
from playtrain.runtime import NativeVecEnv

env = NativeVecEnv(game="craftax_classic", num_envs=64, num_threads=8, autoreset=True)
obs = env.reset(np.arange(64, dtype=np.int32))    # (64, 64, 64, 3) uint8
```

## Observation and actions

The frame is Craftax-Classic-Pixels' 63x63 view, padded to 64x64 with one black
row and column. A 1,345-float symbolic observation is also available with
`obs_mode="symbolic"`.

| # | action | # | action |
|---|---|---|---|
| 0 | NOOP | 7-10 | place stone, table, furnace, sapling |
| 1-4 | move left, right, up, down | 11-13 | make wood, stone, iron pickaxe |
| 5 | interact | 14-16 | make wood, stone, iron sword |
| 6 | sleep | | |

## What is exact

- Full game state, every step, against the C: RNG, map, mobs, player,
  inventory and achievements. The corpus is 210 episodes and 49,061 steps.
- The pixels match Craftax's own `render_craftax_pixels` in daylight. At night
  Craftax adds random static that needs the trainer's JAX key, which no host
  passes yet. See [`reference/craftax_pixels`](reference/craftax_pixels).
- Not matched. PufferLib keeps one RNG stream across auto-resets and we restart
  it. `reset()` also takes one NOOP step before your first action, as every
  PlayTrain game does.

The C has two bugs that the port keeps on purpose. Lava never generates, and
one sand bound can never be reached. `manifest.json` lists both.

## Tests

```console
$ uv run pytest examples/games/multifile/parity/craftax_classic/tests -q
```

CI runs the golden hashes. The lockstep tests against the C need the reference
driver. Build it with `reference/build.sh`. Without it they skip.
