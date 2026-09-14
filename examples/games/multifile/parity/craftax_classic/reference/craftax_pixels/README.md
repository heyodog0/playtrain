# Comparing our frame against Craftax-Classic-Pixels

Answers one question: is the port's observation byte-identical to the
published JAX benchmark's?

**Above `light_level` 0.5 it is. Below, it cannot be.** Numbers below are
measured, not estimated.

| condition | result |
|---|---|
| `light_level >= 0.5` | **byte-identical** — 147/147 and 81/81 consecutive frames |
| `light_level < 0.5` | not reproducible, by anything carrying this state |

## Why you cannot just compare by seed

Craftax's JAX environment uses threefry and its own world generator, so
seed *s* is a different world there than here. The only valid comparison is
to take a state **our** port produced, inject it into Craftax's `EnvState`,
and render both. That is what these scripts do.

```sh
# 1. export one of our canonical states
uv run python reference/craftax_pixels/export_state.py <seed> <nsteps> /tmp/state.json

# 2. render it through Craftax (needs jax + craftax; use a separate venv)
cd /tmp && uv init cxtest && cd cxtest && uv add craftax
uv run python <repo>/reference/craftax_pixels/render_craftax.py /tmp/state.json
# -> /tmp/craftax_ref.npy, a (63, 63, 3) float32 frame

# 3. diff against ours (obs[:63, :63])
```

## What it took

The first measurement showed 128 of 3969 pixels differing (terrain already
byte-identical). Three things closed that:

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

## The one gap that stays open

1. **Player tile, 4 px — closable.** Craftax composites with
   `pixels * (1 - alpha) + texture * alpha` in float32 and keeps the frame
   as float; `80_render.js` composites in integer with round-half-up. Match
   the float arithmetic and this goes to zero.

2. **Inventory, 124 px — closable.** Craftax's layout is specific and ours
   was guessed. It draws a 0.8-scale icon
   (`int(0.8 * 7) = 5` px at offset 0) and a 0.6-scale number
   (`int(0.6 * 7) = 4` px at offset 2) per slot, with slots at fixed
   coordinates: health (0,0), food (1,0), drink (2,0), energy (3,0),
   sapling (4,0), wood (5,0), stone (6,0), coal (7,0), iron (8,0),
   diamond (0,1), and the tools along row 1. Reimplement to match.

3. **Night, ~3086 px — NOT closable.** This is the finding that matters.
   When `light_level < 0.5` Craftax adds per-pixel random static:

   ```python
   night_with_static = jax.random.uniform(state.state_rng, map_pixels.shape[:2]) * 95 + 32
   night_pixels = jax.lax.select(daylight < 0.5, night_with_static, map_pixels)
   ```

   `state_rng` is a JAX threefry key. PufferLib's C — the thing this port is
   bit-exact with — has no such field; it carries one 64-bit PCG stream and
   nothing equivalent. Measured with `night_rng_probe.py`: at light 1.0 and
   0.7 two different `state_rng` values give identical frames; at light 0.4
   and 0.2 they differ in **3086 of 3969 pixels**.

   `light_level = 1 - |cos(pi * (t/300 mod 1 + 0.3))|^3` is below 0.5 for
   **4125 of 10000 timesteps (41%)** of an episode.

   Above 0.5 the night path is deterministic (luminance enhance, tint,
   daylight blend) and *is* reproducible — it is simply not implemented here
   yet, so any frame with `light_level < 1.0` also differs today.

## What can honestly be claimed

With gaps 1 and 2 closed and the deterministic dusk blending implemented:
**byte-identical to Craftax-Classic-Pixels whenever `light_level >= 0.5`,
which is 59% of an episode.** Never at night, for a reason that is in
Craftax's design rather than in this port.
