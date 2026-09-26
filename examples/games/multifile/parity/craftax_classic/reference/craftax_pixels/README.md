# Comparing our frame against Craftax-Classic-Pixels

Answers one question: is the port's observation byte-identical to the
published JAX benchmark's?

**Yes, at every light level, given the driver seed Craftax itself needs.**
Numbers below are measured, not estimated.

| condition | result |
|---|---|
| `light_level >= 0.5` | **byte-identical** — 147/147 frames (seed 11) and 120/120 (seed 3, through the death frame) |
| `light_level < 0.5`, same driver seed on both sides | **byte-identical** — 74/74 frames (seed 11, driver seed 7), 26 of them asleep |
| `light_level < 0.5`, through today's hosts | the static is omitted — no host passes a driver seed yet |

## Why you cannot just compare by seed

Craftax's JAX environment uses threefry and its own world generator, so
seed *s* is a different world there than here. The only valid comparison is
to take a state **our** port produced, inject it into Craftax's `EnvState`,
and render both. That is what these scripts do.

```sh
# 1. export the C states for a trajectory, plus our frames for it. Our game
#    derives state_rng itself from the driver seed; meta.json records both.
uv run python reference/craftax_pixels/compare.py --seed 11 --steps 220 --driver-seed 7 --out /tmp/night

# 2. render the same states through Craftax, deriving state_rng from the
#    same driver seed with JAX's own split (needs jax + craftax; separate venv)
cd /tmp && uv init cxtest && cd cxtest && uv add craftax
uv run python <repo>/reference/craftax_pixels/render_craftax_batch.py /tmp/night

# 3. diff, split by light level
uv run python reference/craftax_pixels/compare.py --diff /tmp/night

# 4. (optional) pin verified frames in the committed fixture
uv run python reference/craftax_pixels/make_fixture.py /tmp/night --seed 11 --below 0.5 --every 6 --sleeping
```

Nothing is handed across in step 2. Both renderers see the driver seed and
nothing else; the JAX script also steps a real Craftax environment with that
seed and checks its derived chain against `state.state_rng` on 40 steps, and
checks our JS-derived keys against its own. `export_state.py` and
`render_craftax.py` are the single-state versions of steps 1 and 2.
`night_rng_probe.py` is the experiment that showed the night frame depends on
the key.

## Where the key comes from

Craftax draws its night static from `state.state_rng`, set in `game_logic.py`
by

```python
rng, _rng = jax.random.split(rng)
state = state.replace(timestep=..., light_level=..., state_rng=_rng)
```

where `rng` is the step key the **caller** passes in. An earlier version of
this file concluded that the environment therefore could not derive it. That
was wrong, and the reason it is wrong is what makes it derivable: JAX cannot
branch control flow on values, so `craftax_step` performs the same number of
splits every step, whatever the action and whatever the world. `state_rng` is
a function of the driver's `PRNGKey` seed and the step index alone. Measured:

```
same driver key, different ACTIONS -> identical state_rng: True
same driver key, different WORLD   -> identical state_rng: True
different driver key               -> identical state_rng: False
```

and the chain is short. With the usual driver pattern `dk, sk = split(dk)`
per step, `state_rng` is the second output of the fifth `rng, sub = split(rng)`
starting from `sk`:

```python
dk = jax.random.PRNGKey(driver_seed)
for each step:
    dk, sk = jax.random.split(dk)
    rng = sk
    for _ in range(5):
        rng, sub = jax.random.split(rng)
    state_rng = sub
```

Verified against real `env.step` for driver seeds 7, 123 and 2024, in JAX
and in our JS. Two Craftax runs still differ at night if their drivers use
different seeds (3086 of 3969 pixels), but that is true of Craftax against
Craftax, and it is the input the benchmark takes. We take the same one.

In the game, `setDriverSeed(d)` (in `90_playtrain.js`) stores the seed;
`resetGame` restarts the chain at `PRNGKey(d)`; `nightTick()` advances it
once per `draw()`, including the reset tick (Craftax's step 0), and installs
the key in the renderer. This is render-side state. It is not in the parity
buffer, which G0 to G2 compare against PufferLib's C, and it never touches
the game's PCG. With no driver seed, no key is derived and the static is
skipped, which is what every host does today.

## What it took

The first measurement showed 128 of 3969 pixels differing (terrain already
byte-identical). Three things closed daylight:

1. **Float32 compositing, truncated.** Craftax's observation is float32 and
   its composited pixels are not integral (13.447, 93.631 ...). Our uint8
   frame can at best equal that frame cast to uint8, and `.astype(uint8)`
   truncates, so the composite is done in float32, in Craftax's operation
   order, and truncated. Rounding half-up was wrong on 4 px of the player.

2. **The real inventory layout.** 5x5 icons (`int(0.8 * 7)`) at offset 0 and
   4x4 digits (`int(0.6 * 7)`) at offset 2, with fixed slots, and the slot
   order is not a left-to-right fill: row 0 ends at iron, and diamond starts
   row 1. Icons are a hard overwrite, digits a stencil (alpha is clamped to
   0/1 upstream), neither ever blended. Upstream is also inconsistent about
   which icons get `apply_alpha`, which is reproduced item by item.

3. **The dusk pass, which runs for ANY `light_level < 1.0`.** A luminance
   "enhance" (0.4), a blue tint toward `[0, 16, 64]`, then a blend back
   toward the lit image. Omitting it left 3087 of 3969 pixels wrong on every
   frame that was not exactly full daylight, and almost no frame is, since
   the reset tick alone puts `light_level` at 0.806.

Three more closed the rest:

4. **The night static.** Below 0.5 Craftax draws

   ```python
   night_static_intensity = jnp.maximum(2 * (0.5 - daylight), 0.0)
   night_with_static = jax.random.uniform(state.state_rng, map_pixels.shape[:2]) * 95 + 32
   night_static_mask = night_static_intensity * textures["night_noise_intensity_texture"]
   night_with_static = (1 - night_static_mask) * map_pixels + night_static_mask * night_with_static[:, :, None]
   night_pixels = jax.lax.select(daylight < 0.5, night_with_static, map_pixels)
   ```

   `src/16_threefry.js` is JAX's threefry-2x32, `uniform`, `split` and
   `PRNGKey`, checked against JAX on 15,435 uniform values over five keys and
   820 split words over 205 keys. Two details decide whether it matches: the
   installed JAX (0.11.1) runs the partitionable layout
   (`jax_threefry_partitionable`, default since 0.5), where element *i* is
   hashed with the 64-bit counter *i* split into two words and the outputs
   XORed, and `split(key)[j]` is threefry of counter (0, j); and `uniform`
   builds the float from the top 23 bits (`(bits >> 9) | 0x3f800000`,
   bitcast, minus 1). The noise texture is a radial `1 - exp(...)` over a
   `linspace` meshgrid, baked in `15_atlas.js` (bit-identical to Craftax's
   cached texture) because `Math.exp` differs between QuickJS and V8.

5. **Constants as float32.** JAX converts a Python literal to the array's
   dtype before multiplying, so `0.299 * r` is float32(0.299) times `r`.
   `F(0.299 * r)` in JS multiplies the double 0.299 in double precision and
   rounds once, which is not the same number in the last bit. The daylight
   runs never hit a case where it mattered; the derived-key night run did,
   on one pixel of 74 frames (green 81.99999 truncating to 81 against
   Craftax's exact 82.0). The constants are now `F(0.299)` etc., and a
   float32 x float32 product is exact in a double, so `F(c * r)` is the
   correctly rounded float32 product.

6. **The death frame.** Health goes negative in PufferLib's C (int8, no
   clamp; min 1 - 7 = -6) while Craftax's never does, and Craftax indexes
   `number_textures[health]` unconditionally, a 10-entry table, so JAX's
   negative indexing draws digit `10 + health`. Reproduced. This frame was
   8 pixels off, and the earlier daylight runs had not reached a death.

## What can honestly be claimed

**Byte-identical to Craftax-Classic-Pixels at every light level, given the
driver seed, which Craftax needs too.** Through today's hosts (PlayTrainEnv,
qjs_host, the node GameEnv, the browser) no driver seed is passed, so there
the frame is byte-identical whenever `light_level >= 0.5` and is Craftax's
frame minus the static at night. Adding that input to the hosts is the one
open item.

Our frames for the comparison come from `tests/jsrender.py`, the same
concatenated sources in node with a rasterizer stub, because the hosts have
no way to take a driver seed; `compare.py` refuses to proceed if that stub
differs from PlayTrainEnv on any daylight frame of the trajectory.

The committed fixture (`traces/craftax_pixels/`) records the driver seed per
trajectory, and `tests/test_render.py` replays it, checks the derived
`state_rng` against the recorded one, and checks byte identity, with node and
no JAX.
