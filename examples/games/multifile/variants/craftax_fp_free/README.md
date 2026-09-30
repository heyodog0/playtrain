# Craftax-Classic, first person, free movement

`craftax_fp` with six extra actions, so you can turn in place, walk backwards
and strafe. The world and the renderer are the same as in `craftax_fp`.

This is not Craftax's task. The action space has 23 actions instead of 17, so
an agent trained here is not comparable to one trained on `craftax_classic` or
`craftax_fp`. Use `craftax_fp` if you need exact Craftax dynamics.

## Why

In Craftax every move also turns you to face that way. There is no way to
turn without moving or move without turning. From above that does not matter.
In first person it means you cannot back away from a zombie while watching it.

## Train an agent

Install [playtrain-trainers](https://github.com/heyodog0/playtrain-trainers),
then use the same config as `craftax_fp` with the game and action count
changed:

```json
{
  "game": "craftax_fp_free",
  "env_backend": "playtrain",
  "inference_mode": "vec",
  "num_actions": 23,
  "obs_shape": [3, 64, 64],
  "net": "impala",
  "total_steps": 10000000,
  "batch_size": 32,
  "unroll_length": 64,
  "vec_workers": 4,
  "vec_env_threads": 2,
  "vec_double_buffer": true,
  "learning_rate": 0.0005,
  "device": "auto",
  "log_dir": "outputs/craftax_fp_free"
}
```

```console
$ python -m playtrain_trainers.train_impala --config craftax_fp_free.json
$ tensorboard --logdir outputs/craftax_fp_free/tb
```

PlayTrain reads the 23 actions and the 10,000-step episode limit from
`dist/craftax_fp_free.json`. PPO works too, via
`playtrain_trainers.train_ppo_clean` with the same `game`.

From your own code:

```python
import numpy as np
from playtrain.runtime import NativeVecEnv

env = NativeVecEnv(game="craftax_fp_free", num_envs=64, num_threads=8, autoreset=True)
obs = env.reset(np.arange(64, dtype=np.int32))    # (64, 64, 64, 3) uint8
```

## Actions

Actions 0-16 are Craftax's, unchanged (see `craftax_fp`). The new ones:

| # | action | facing | position |
|---|---|---|---|
| 17 | MOVE_FORWARD | same | one cell ahead |
| 18 | MOVE_BACK | same | one cell behind |
| 19 | STRAFE_LEFT | same | one cell left |
| 20 | STRAFE_RIGHT | same | one cell right |
| 21 | TURN_LEFT | quarter turn left | same |
| 22 | TURN_RIGHT | quarter turn right | same |

New moves use Craftax's own collision checks, so you still cannot walk
through walls, water or mobs.

## What is still exact

Actions 0-16 behave exactly as in `craftax_classic`. Over the committed corpus
(210 episodes, 49,061 steps) the game state and symbolic observation match
byte for byte. That shows the new actions did not disturb the old ones. It
does not make this the same task.

QuickJS and V8 produce identical frames, as in `craftax_fp`.

## How it is built

`src/72_move_free.js` is the only new code. It redefines `stepGame` to accept
23 actions and route the new ones to `movePlayerFree`. Actions 1-4 still call
Craftax's own `movePlayer`. The bundle is a plain concatenation, so the later
definition wins. That is why `manifest.json` must list `72_move_free.js` after
`70_step.js`. Everything else comes from `craftax_classic` and `craftax_fp`.

## Play it

```console
$ node tools/build-pages.mjs --games examples/games/multifile/variants/craftax_fp_free/dist \
    --out dist/craftax-fp-free-play --title "Craftax first-person (free movement)"
$ uv run python -m http.server -d dist/craftax-fp-free-play 8001
```

Then open <http://localhost:8001/game/craftax_fp_free/>.

UP/DOWN walk forward and back, LEFT/RIGHT turn in place, A/D strafe. SPACE
interacts, TAB sleeps, 1-4 place, 5-7 craft pickaxes, 8-0 craft swords.
I/J/K/L are Craftax's original absolute moves.

## Tests

```console
$ uv run pytest examples/games/multifile/variants/craftax_fp_free/tests -q
```

These check that actions 0-16 match `craftax_classic`, that turning does not
move you and moving does not turn you, that every action has a key, and that
QuickJS and V8 agree.
