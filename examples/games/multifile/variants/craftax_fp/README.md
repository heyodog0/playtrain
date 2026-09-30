# Craftax-Classic, first person

Craftax-Classic with the top-down view replaced by a first-person voxel view.
The game underneath is unchanged. It has the same world, the same rules and
the same 17 actions as `craftax_classic`.

This is a variant, not a parity port. No first-person Craftax exists to match
against. What is exact is the dynamics (see below).

If you want to play it yourself, try `craftax_fp_free` next door. It adds
turn-in-place and strafing, at the cost of no longer being Craftax's action
space.

## Train an agent

Install [playtrain-trainers](https://github.com/heyodog0/playtrain-trainers)
(it pulls in this repo), then write a config:

```json
{
  "game": "craftax_fp",
  "env_backend": "playtrain",
  "inference_mode": "vec",
  "num_actions": 17,
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
  "log_dir": "outputs/craftax_fp"
}
```

```console
$ python -m playtrain_trainers.train_impala --config craftax_fp.json
$ tensorboard --logdir outputs/craftax_fp/tb
```

Watch `charts/mean_episode_return`. The game name is enough. PlayTrain finds
the bundle in `dist/` and reads the 17 actions and the 10,000-step episode
limit from its sidecar, `dist/craftax_fp.json`.

PPO works the same way. Set `"game": "craftax_fp"` in a PPO config and run
`python -m playtrain_trainers.train_ppo_clean --config <config>.json`.

To step the environment from your own code:

```python
import numpy as np
from playtrain.runtime import NativeVecEnv

env = NativeVecEnv(game="craftax_fp", num_envs=64, num_threads=8, autoreset=True)
obs = env.reset(np.arange(64, dtype=np.int32))    # (64, 64, 64, 3) uint8
obs, reward, terminated, truncated, info = env.step(np.zeros(64, dtype=np.int32))
```

`GameEnv` does not read the sidecar, so pass the actions yourself:

```python
import json
from playtrain.runtime import GameEnv

path = "examples/games/multifile/variants/craftax_fp/dist/craftax_fp.js"
actions = json.load(open(path.replace(".js", ".json")))["actions"]
env = GameEnv(game=path, action_space=actions, max_steps=10000)
```

## Observation

A 64x64 RGB frame:

```
rows  0-48   first-person view, 64 wide, 90° FOV, one ray per pixel
rows 49-62   Craftax inventory strip, identical to craftax_classic's
row  63      black
```

The eye sits at the centre of the player's cell, at half a block high. Solid
blocks (trees, stone, tables, plants and so on) are cubes. Everything else,
including water, is drawn as floor. View distance is 9 blocks, and past that
you see sky. Night darkens the frame the way it does in Craftax.

A 1,345-float symbolic observation is also available (`obs_mode="symbolic"`),
identical to `craftax_classic`'s.

## Actions

The 17 Craftax actions, unchanged. Movement is absolute: action 1 always moves
west, whichever way the camera faces. Every move also turns you to face that
way, so there is no turn-in-place.

| # | action | # | action |
|---|---|---|---|
| 0 | NOOP | 9 | PLACE_FURNACE |
| 1-4 | LEFT, RIGHT, UP, DOWN | 10 | PLACE_PLANT |
| 5 | DO (interact ahead) | 11-13 | MAKE_WOOD/STONE/IRON_PICK |
| 6 | SLEEP | 14-16 | MAKE_WOOD/STONE/IRON_SWORD |
| 7 | PLACE_STONE | | |
| 8 | PLACE_TABLE | | |

## What is exact

- **Dynamics.** The variant loads `craftax_classic`'s source files directly.
  Over the committed corpus (210 episodes, 49,061 steps) the full game state
  and the symbolic observation match `craftax_classic` byte for byte. In turn,
  `craftax_classic` matches PufferLib's C implementation byte for byte.
- **Engines.** QuickJS (native Rust raycast), V8 (the same Rust as wasm) and
  the browser's JS fallback produce identical frames.
- **Inventory strip.** Matches `craftax_classic` pixel for pixel.

The first-person image has nothing to be exact to. What the tests check is
that every backend draws the same one.

Two quirks carry over from `craftax_classic`. The RNG stream restarts on
auto-reset, and `reset()` takes one NOOP step before the first action.

## Play it

```console
$ node tools/build-pages.mjs --games examples/games/multifile/variants/craftax_fp/dist \
    --out dist/craftax-fp-play --title "Craftax first-person"
$ uv run python -m http.server -d dist/craftax-fp-play 8000
```

Then open <http://localhost:8000/game/craftax_fp/>. The game runs at 8 steps/s.
The page makes the arrows relative to where you face and animates the camera
between steps. Neither changes what the agent sees. SPACE interacts, TAB
sleeps, 1-4 place, 5-7 craft pickaxes and 8-0 craft swords.

## Speed

One core, one env, on an M4 Mac:

| host | craftax_fp | craftax_classic |
|---|---|---|
| QuickJS (no JIT) | 5,935 SPS | 397 SPS |
| V8 (JIT) | 11,020 SPS | 10,962 SPS |

Under QuickJS the first-person renderer is 13x faster than classic's, because
the ray casting runs in native Rust. Under V8 the two are even. Full numbers
are in `bench.json`.

## Tests

```console
$ uv run pytest examples/games/multifile/variants/craftax_fp/tests -q
$ uv run pytest tests/test_voxel.py -q
```

The first checks dynamics, engines and the frame. The second checks that the
renderer backends agree.

If you change the Rust rasterizer, rebuild in this order. Otherwise the hosts
link stale code.

```console
$ cd crates/rasterizer
$ cargo rustc --release --lib --crate-type staticlib
$ cargo build --release --target wasm32-unknown-unknown
$ cp target/wasm32-unknown-unknown/release/playtrain_rasterizer.wasm ../../runtime/p5/rasterizer.wasm
$ cd ../../native && bash build_qjs.sh && bash build_qjs_vec.sh
```
