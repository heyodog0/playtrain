# Comparing our frame against Craftax-Classic-Pixels

These scripts answer one question. Is the port's observation byte-identical to
the frame the JAX benchmark renders? Yes, at every light level, given the
driver seed that Craftax itself needs.

| condition | result |
|---|---|
| daylight, `light_level >= 0.5` | byte-identical, 147/147 frames (seed 11) and 120/120 (seed 3, through the death frame) |
| night, same driver seed on both sides | byte-identical, 74/74 frames (seed 11, driver seed 7), 26 of them asleep |
| night, through today's hosts | the night static is left out, because no host passes a driver seed yet |

## Run it

Seed *s* is a different world in Craftax than in the port, so the scripts
compare states, not seeds. They take a state our port produced, load it into
Craftax's `EnvState`, and render both.

```sh
# 1. our states and frames for one trajectory
uv run python reference/craftax_pixels/compare.py --seed 11 --steps 220 --driver-seed 7 --out /tmp/night

# 2. the same states through Craftax (needs jax and craftax, in a separate venv)
cd /tmp && uv init cxtest && cd cxtest && uv add craftax
uv run python <repo>/reference/craftax_pixels/render_craftax_batch.py /tmp/night

# 3. diff, split by light level
uv run python reference/craftax_pixels/compare.py --diff /tmp/night

# 4. optional: pin verified frames in the committed fixture
uv run python reference/craftax_pixels/make_fixture.py /tmp/night --seed 11 --below 0.5 --every 6 --sleeping
```

`export_state.py` and `render_craftax.py` do steps 1 and 2 for a single state.
`night_rng_probe.py` is the experiment that showed the night frame depends on
the key. `tests/test_render.py` replays the committed fixture in
`traces/craftax_pixels/` with node and no JAX.

## Where the night key comes from

Craftax draws its night static from `state.state_rng`, which comes from the
step key the caller passes in. JAX cannot branch on values, so every step does
the same number of splits. `state_rng` therefore depends only on the driver's
seed and the step index, not on actions or the world. With the usual driver
loop:

```python
dk = jax.random.PRNGKey(driver_seed)
for each step:
    dk, sk = jax.random.split(dk)
    rng = sk
    for _ in range(5):
        rng, sub = jax.random.split(rng)
    state_rng = sub
```

This matched real `env.step` for driver seeds 7, 123 and 2024, in JAX and in
our JS. In the game, `setDriverSeed(d)` in `90_playtrain.js` stores the seed
and `nightTick()` advances the chain once per `draw()`. The key lives only in
the renderer. It never touches the game's PCG or the state the lockstep gate
compares.

## What it took

The first diff had 128 of 3,969 pixels wrong. Six fixes closed it.

1. Composite in float32 in Craftax's order, then truncate, as `.astype(uint8)`
   does. Rounding was wrong on 4 pixels of the player.
2. Use the real inventory layout: 5x5 icons, 4x4 digits, fixed slots, and the
   same inconsistent `apply_alpha` per icon as upstream.
3. Run the dusk pass whenever `light_level < 1.0`. Leaving it out broke 3,087
   pixels on almost every frame, since the reset tick already sits at 0.806.
4. Draw the night static with JAX's own threefry, `split` and `uniform`, in the
   partitionable layout JAX has used since 0.5. `src/16_threefry.js` matches
   JAX on 15,435 uniforms and 820 split words.
5. Treat constants as float32, as JAX does. `F(0.299)` times `r`, not
   `F(0.299 * r)`. One pixel on one night frame needed this.
6. Draw the death frame like Craftax. PufferLib's health can go negative, and
   Craftax's digit table then wraps to `10 + health`.

## The open item

Through today's hosts the frame is byte-identical in daylight and is Craftax's
frame minus the static at night. Matching at night everywhere needs the hosts
to accept a driver seed. Until then our comparison frames come from
`tests/jsrender.py`, and `compare.py` refuses to run if that renderer differs
from PlayTrainEnv on any daylight frame.
