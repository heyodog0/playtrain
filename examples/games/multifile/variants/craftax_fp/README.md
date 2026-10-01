# Craftax-Classic, first person

Craftax-Classic with the top-down view replaced by a first-person voxel view.
The game underneath is `craftax_classic`, unchanged. It has the same world,
rules and 17 actions.

To play it yourself, try [`craftax_fp_free`](../craftax_fp_free). It adds turn in
place and strafing, so it is no longer Craftax's action space.

## Play it

```console
$ node tools/build-pages.mjs --games examples/games/multifile/variants/craftax_fp/dist \
    --out dist/craftax-fp-play --title "Craftax first-person"
$ uv run python -m http.server -d dist/craftax-fp-play 8000
```

Open <http://localhost:8000/game/craftax_fp/>. The game runs at 8 steps/s. On
the page the arrows follow your facing, and the camera glides between steps.
Neither changes what the agent sees. The other keys are `craftax_classic`'s.

## Train an agent

Use the `craftax_classic` config with `"game": "craftax_fp"`:

```console
$ python -m playtrain_trainers.train_impala --config craftax_fp.json
```

```python
import numpy as np
from playtrain.runtime import NativeVecEnv

env = NativeVecEnv(game="craftax_fp", num_envs=64, num_threads=8, autoreset=True)
obs = env.reset(np.arange(64, dtype=np.int32))    # (64, 64, 64, 3) uint8
```

`GameEnv` does not read the sidecar, so pass the actions yourself:

```python
import json
from playtrain.runtime import GameEnv

path = "examples/games/multifile/variants/craftax_fp/dist/craftax_fp.js"
actions = json.load(open(path.replace(".js", ".json")))["actions"]
env = GameEnv(game=path, action_space=actions, max_steps=10000)
```

## Observation and actions

```
rows  0-48   first-person view, 90° field of view, 9 blocks of view distance
rows 49-62   the Craftax inventory strip, identical to craftax_classic's
row  63      black
```

Solid blocks are cubes and everything else is floor. Night darkens the frame.
The 1,345-float symbolic observation is `craftax_classic`'s.

The 17 actions are Craftax's. Movement is absolute. Action 1 always moves
west, whichever way you face, and every move also turns you.

## What is exact

- Dynamics. Over the 210-episode corpus the game state and the symbolic
  observation match `craftax_classic` byte for byte, and through it PufferLib's C.
- Engines. QuickJS, V8 and the browser draw identical frames.

There is no first-person Craftax to compare the image against. The tests check
that every backend draws the same one.

## Speed

One core, one env, M4 Mac: 5,935 steps/s on QuickJS and 11,020 on V8. The ray
casting runs in native Rust, so under QuickJS this is 13x faster than
`craftax_classic`. Full numbers are in `bench.json`.

## Tests

```console
$ uv run pytest examples/games/multifile/variants/craftax_fp/tests tests/test_voxel.py -q
```

If you change the Rust rasterizer, rebuild the static library, the wasm and the
native hosts before testing, or they link stale code:

```console
$ cd crates/rasterizer
$ cargo rustc --release --lib --crate-type staticlib
$ cargo build --release --target wasm32-unknown-unknown
$ cp target/wasm32-unknown-unknown/release/playtrain_rasterizer.wasm ../../runtime/p5/rasterizer.wasm
$ cd ../../native && bash build_qjs.sh && bash build_qjs_vec.sh
```
