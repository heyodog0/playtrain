# Comparing our frame against Craftax-Classic-Pixels

Answers one question: is the port's observation byte-identical to the
published JAX benchmark's?

**Above `light_level` 0.5 it is. Below, it cannot be.** Numbers below are
measured, not estimated.

| condition | result |
|---|---|
| `light_level >= 0.5` | **byte-identical** — 147/147 and 81/81 consecutive frames |
| `light_level < 0.5` | not reproducible — the frame depends on the caller's PRNG key, not on the state |

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

## The one gap that stays open, and why

Below `light_level` 0.5 Craftax adds per-pixel random static:

```python
night_with_static = jax.random.uniform(state.state_rng, map_pixels.shape[:2]) * 95 + 32
night_pixels = jax.lax.select(daylight < 0.5, night_with_static, map_pixels)
```

**The reason this cannot be reproduced is not that the PRNG is exotic.**
`jax.random.uniform` is threefry-2x32: add/rotate/xor on uint32, fully
specified, and no harder to port than the PCG already in `common/`. Given a
key, the static is deterministic — rendering the same state twice gives
identical frames.

The reason is where the key comes from. In `game_logic.py`:

```python
rng, _rng = jax.random.split(rng)
state = state.replace(timestep=..., light_level=..., state_rng=_rng)
```

`rng` there is the **step key the caller passes in** — the training loop's own
PRNG. So `state_rng` is not derived from the environment state at all; it is
threaded in from outside.

Two consequences:

1. **Craftax's night observation is not a function of its environment state.**
   Two runs from an identical state with different driver keys produce
   different frames — measured: 3086 of 3969 pixels differ. So night frames
   are not reproducible even between two Craftax runs, unless the driver's
   RNG stream is also reproduced.

2. There is therefore nothing for this port to derive the key *from*. Our
   dynamics follow PufferLib's C, which is not JAX-exact in the first place
   (it has its own PCG stream and derives from `Infatoshi/craftax.c` — see
   PLAN section 0), so even a threefry implementation here would have no
   correct key to feed it.

**What would close it**, for the record:

- *As a renderer:* implement threefry-2x32 and accept `state_rng` as an
  input. A comparison harness could then feed Craftax's key and match night
  frames exactly. This is real work but entirely tractable, and it would make
  the renderer complete.
- *As an environment:* impossible without also making the dynamics JAX-exact,
  i.e. porting Craftax's own game logic instead of PufferLib's C — a
  different port against a different reference (PufferLib's own
  `craftax_parity.h` is the analogue for full Craftax).

## What can honestly be claimed

With gaps 1 and 2 closed and the deterministic dusk blending implemented:
**byte-identical to Craftax-Classic-Pixels whenever `light_level >= 0.5`,
which is 59% of an episode.** Never at night — because Craftax's night
frame depends on the caller's PRNG key rather than on the environment state,
which no implementation can derive.
