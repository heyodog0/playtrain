# Comparing our frame against Craftax-Classic-Pixels

Answers one question: is the port's observation byte-identical to the
published JAX benchmark's?

**Yes, at every light level — given Craftax's night key.** Numbers below are
measured, not estimated.

| condition | result |
|---|---|
| `light_level >= 0.5` | **byte-identical** — 147/147 frames (seed 11) and 120/120 (seed 3, through the death frame) |
| `light_level < 0.5`, renderer given `state_rng` | **byte-identical** — 74/74 frames (seed 11), 26 of them asleep |
| `light_level < 0.5`, through a host | the static is omitted — no host can supply the key, and the environment cannot derive it |

## Why you cannot just compare by seed

Craftax's JAX environment uses threefry and its own world generator, so
seed *s* is a different world there than here. The only valid comparison is
to take a state **our** port produced, inject it into Craftax's `EnvState`,
and render both. That is what these scripts do.

```sh
# 1. export the C states for a trajectory, plus our frames for it, with a
#    night key chosen per frame and recorded in meta.json
uv run python reference/craftax_pixels/compare.py --seed 11 --steps 220 --out /tmp/night

# 2. render the same states through Craftax, with the same keys
#    (needs jax + craftax; use a separate venv)
cd /tmp && uv init cxtest && cd cxtest && uv add craftax
uv run python <repo>/reference/craftax_pixels/render_craftax_batch.py /tmp/night

# 3. diff, split by light level
uv run python reference/craftax_pixels/compare.py --diff /tmp/night

# 4. (optional) pin verified frames in the committed fixture
uv run python reference/craftax_pixels/make_fixture.py /tmp/night --seed 11 --below 0.5 --every 6 --sleeping
```

`export_state.py` and `render_craftax.py` are the single-state versions of
steps 1 and 2. `night_rng_probe.py` is the experiment that established that
the night frame depends on the key (below).

## What it took

The first measurement showed 128 of 3969 pixels differing (terrain already
byte-identical). Three things closed daylight:

1. **Float32 compositing, truncated.** Craftax's observation is float32 and
   its composited pixels are not integral (13.447, 93.631 ...). Our uint8
   frame can at best equal that frame cast to uint8, and `.astype(uint8)`
   truncates — so the composite is done in float32, in Craftax's operation
   order, and truncated. Rounding half-up was wrong on 4 px of the player.

2. **The real inventory layout.** 5x5 icons (`int(0.8 * 7)`) at offset 0 and
   4x4 digits (`int(0.6 * 7)`) at offset 2, with fixed slots — and the slot
   order is not a left-to-right fill: row 0 ends at iron, and **diamond
   starts row 1**. Icons are a hard overwrite, digits a stencil (alpha is
   clamped to 0/1 upstream), neither ever blended. Upstream is also
   inconsistent about which icons get `apply_alpha`, which is reproduced item
   by item.

3. **The dusk pass, which runs for ANY `light_level < 1.0`.** This was the
   big one and it is easy to miss: a luminance "enhance" (0.4), a blue tint
   toward `[0, 16, 64]`, then a blend back toward the lit image. Omitting it
   left 3087 of 3969 pixels wrong on every frame that was not exactly full
   daylight — and almost no frame is, since the reset tick alone puts
   `light_level` at 0.806.

Two more closed the rest:

4. **The night static, given the key.** Below 0.5 Craftax draws

   ```python
   night_static_intensity = jnp.maximum(2 * (0.5 - daylight), 0.0)
   night_with_static = jax.random.uniform(state.state_rng, map_pixels.shape[:2]) * 95 + 32
   night_static_mask = night_static_intensity * textures["night_noise_intensity_texture"]
   night_with_static = (1 - night_static_mask) * map_pixels + night_static_mask * night_with_static[:, :, None]
   night_pixels = jax.lax.select(daylight < 0.5, night_with_static, map_pixels)
   ```

   `src/16_threefry.js` is JAX's threefry-2x32 and `uniform`, checked
   against `jax.random.uniform` on 15,435 values over five keys. Two details
   decide whether it matches: the installed JAX (0.11.1) runs the
   **partitionable** layout (`jax_threefry_partitionable`, default since
   0.5), where element *i* is hashed with the 64-bit counter *i* split into
   two words and the two outputs XORed — not the older halves-of-an-iota
   layout; and `uniform` builds the float from the top 23 bits
   (`(bits >> 9) | 0x3f800000`, bitcast, minus 1). The noise texture is a
   radial `1 - exp(...)` over a `linspace` meshgrid; it is baked in
   `15_atlas.js` (bit-identical to Craftax's cached texture) because
   `Math.exp` differs between QuickJS and V8, and only `cos`/`sin` are pinned
   in PlayTrain's engines. `setNightKey(k0, k1)` installs a key; with none
   installed the static is skipped.

5. **The death frame.** Health goes negative in PufferLib's C (int8, no
   clamp; min 1 - 7 = -6) while Craftax's never does — and Craftax indexes
   `number_textures[health]` unconditionally, a 10-entry table, so JAX's
   negative indexing draws digit `10 + health`. Reproduced. This frame was
   8 pixels off, and the earlier daylight runs had not reached a death.

## Why the environment still cannot do it alone

**The reason is not that the PRNG is exotic** — see item 4. The reason is
where the key comes from. In `game_logic.py`:

```python
rng, _rng = jax.random.split(rng)
state = state.replace(timestep=..., light_level=..., state_rng=_rng)
```

`rng` there is the **step key the caller passes in** — the training loop's own
PRNG. So `state_rng` is not derived from the environment state at all; it is
threaded in from outside. Two consequences:

1. **Craftax's night observation is not a function of its environment state.**
   Two runs from an identical state with different driver keys produce
   different frames — measured: 3086 of 3969 pixels differ. So night frames
   are not reproducible even between two Craftax runs, unless the driver's
   RNG stream is also reproduced.

2. There is therefore nothing for this port to derive the key *from*. Our
   dynamics follow PufferLib's C, which is not JAX-exact in the first place
   (it has its own PCG stream and derives from `Infatoshi/craftax.c` — see
   PLAN section 0). Making the environment produce Craftax's night frame
   would mean porting Craftax's own game logic and driver key schedule — a
   different port against a different reference.

That is why the hosts' night frames omit the static: PlayTrainEnv, qjs_host,
the node GameEnv and the browser expose setup/draw/reset and nothing that
could carry a key, so `setNightKey` is never called there. Our night frames
for the comparison come from `tests/jsrender.py` instead — the same
concatenated sources, in node, with a rasterizer stub — and `compare.py`
refuses to proceed if that stub differs from PlayTrainEnv on any daylight
frame of the trajectory.

## What can honestly be claimed

**The renderer is byte-identical to Craftax-Classic-Pixels at every light
level, given Craftax's `state_rng`.** Through a host — that is, as an
environment — the frame is byte-identical whenever `light_level >= 0.5`,
and at night it is Craftax's frame minus the static, because the key is the
caller's and not the state's, which no implementation can derive.

The committed fixture (`traces/craftax_pixels/`, 59 frames: 24 daylight
from the original run, 34 night with their keys, and the seed-3 death frame)
guards all of this in `tests/test_render.py` with node and no JAX.
