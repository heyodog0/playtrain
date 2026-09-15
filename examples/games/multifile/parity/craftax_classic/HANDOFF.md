# Handoff — Craftax-Classic parity port

Written 2026-09-14. Branch `release`, ~45 unpushed commits.

## Where it stands

A bit-exact JavaScript Craftax-Classic: one flat catalog file plus a sidecar,
trainable, human-playable, **116 gate tests green** (repo's own suite: 100).

**Dynamics parity holds.** G2 compares full canonical state, per-step reward
as float32 bits, and the done flag against PufferLib's C over **210 episodes
/ 49,061 steps**. G0 (RNG: 10^6 draws, 1000 seeds) and G1 (worldgen, 1000
seeds) are green. The 1345-float symbolic observation matches the C on every
step of every episode.

**Pixel parity holds, given the driver seed.** Verified against Craftax
itself by injecting our states into its `EnvState` and calling its own
`render_craftax_pixels`: our frame is byte-identical to
`render_craftax_pixels(state).astype(uint8)` on 147/147 daylight and 74/74
night frames of one trajectory (seed 11, driver seed 7) and 120/120 frames
of another (seed 3, driver seed 2024, to the death frame). The night frames
need the driver's `PRNGKey` seed, the same input Craftax needs; the game
derives `state_rng` from it (`setDriverSeed`). No host passes one yet, so
what the hosts draw at night is the dusk image without Craftax's static.
The fixture in `traces/craftax_pixels/` records driver seeds per
trajectory, and `tests/test_render.py` checks it with node and no JAX.

| gate | state |
|---|---|
| G0 rng / G1 worldgen / **G2 lockstep** | green |
| G2 golden chains (no compiler needed) | green |
| G3 coverage | **blocked at 96.43%** — corpus never reaches iron/diamond |
| G4 engines (V8 vs QuickJS, 3000 steps x 3 seeds) | green |
| G4 AOT tier | **blocked** — no engine-tier toolchain on either machine |
| G5 validate | **blocked** — step wire packs `score` as int32 |
| G6 human session | **handoff** — prerequisites built and verified |
| symbolic obs, all three hosts | green |
| Craftax pixels, `light >= 0.5` | green |
| Craftax pixels, `light < 0.5`, given the driver seed | green |
| Craftax pixels, `light < 0.5`, through a host | **open** — no host passes a driver seed; see below |

## Night frames: closed

See `reference/craftax_pixels/README.md`. Craftax's static below
`light_level` 0.5 is `jax.random.uniform(state.state_rng, (49, 63))`, and
`state_rng` is set in `game_logic.py` from the **caller's** step key. An
earlier version of this file concluded the environment could not derive it.
That was wrong: JAX cannot branch control flow on values, so `craftax_step`
performs a fixed number of splits, and `state_rng` is a function of the
driver's `PRNGKey` seed and the step index alone. Measured: same driver key
with different actions or a different world gives identical `state_rng`;
the chain is `dk, sk = split(dk)` per step, then five `rng, sub = split(rng)`
from `sk`, and `sub` is `state_rng`. Verified against real `env.step` for
driver seeds 7, 123, 2024 (and re-anchored on every `render_craftax_batch.py`
run).

- `src/16_threefry.js`: threefry-2x32, `uniform`, `split`, `PRNGKey`, and
  `craftaxStateRng` (the chain), under the partitionable layout the
  installed JAX (0.11.1) uses. `split` checked on 205 keys, `uniform` on
  15,435 values. `night_noise_intensity_texture` is baked in `15_atlas.js`
  because `Math.exp` is not the same function in QuickJS and V8.
- `src/90_playtrain.js`: `setDriverSeed(d)` (null clears); `resetGame`
  restarts the chain at `PRNGKey(d)`; `nightTick()` advances it once per
  `draw()` and hands the renderer the key. Render-side state only, outside
  the parity buffer; the PCG is untouched. `getStateRng()` for gates.

The comparison loop is `compare.py --driver-seed D` (exports states + our
frames, our game deriving keys) -> `render_craftax_batch.py` (Craftax in
the jax venv, deriving keys from D with JAX's own `split`, anchored to real
stepping, and checking our JS-derived keys agree) -> `compare.py --diff`;
`make_fixture.py` appends verified frames. Our frames come from
`tests/jsrender.py` — the same JS in node with a rasterizer stub, since no
host carries a driver seed — and that stub is held equal to PlayTrainEnv on
every daylight frame.

**What is still open**: a host-side way to pass the driver seed
(`PlayTrainEnv(...)`, qjs_host, GameEnv). Until then the shipped hosts
render night without the static. Every gate assumes no driver seed.

Found on the way: the **death frame**. Health goes negative in the C (int8,
no clamp) and Craftax indexes `number_textures[health]` unconditionally, so
JAX's negative indexing draws digit `10 + health`. Reproduced; that frame
was 8 pixels off before.

## The other open items

| # | What | Why it stopped |
|---|---|---|
| 3b-ii | G3 coverage 96.43% (567/588) | 21 uncovered lines, all from 4 unreached achievements (iron, diamond, iron tools, skeleton). Five approaches tried and measured; "burrow at dusk" is the untried one. |
| 8b | G5 reward check | `game-worker.mjs:30` packs `info.score` as int32; this is the first game with a fractional score. Two-line fix but it changes `info["score"]` for every game — a decision, not a quiet edit. |
| 9b / 12 | AOT tier, cluster bench, PPO | No engine-tier toolchain on either machine; the FASRC checkout predates that work and this branch is unpushed. |
| 10b | Human session (G6) | Needs a person. `node study/quickplay.mjs craftax_classic --seconds 100`. |
| 11 | Website Play tab | Built and gated; needs eyes on the page. |

## Things not to rediscover

- `native/frozenmath` is openlibm and does **not** match V8; the engines'
  `Math.cos` is `native/qjs/v8libm/ieee754.cc`.
- The `cosf` redirect cannot go on the command line: glibc's `math.h`
  token-pastes the function name. Apple libc doesn't, so it only breaks on
  FASRC.
- `puf_step` auto-resets over the terminal state — hence the driver's
  transcription, which is cross-checked against the real function every step.
- A PlayTrain episode is the C's episode **with a NOOP prepended** (the reset
  tick). Declared in `not_matched`.
- Run JS as a concatenated file, never `node -e`.
- The vec host reuses one obs slab — copy before comparing.
- Craftax's dusk pass runs for **any** `light_level < 1.0`, not just < 0.5.
  Missing it costs 3087 of 3969 pixels on nearly every frame.
- Craftax's observation is float32 and its composited pixels are not
  integral; the uint8 target is `.astype(uint8)`, i.e. truncation.
- JAX's `jax_threefry_partitionable` defaults to True since 0.5: element i
  is hashed with counter (0, i) and the two words XORed. The older layout
  (halves of a flat iota, concatenated) gives different bits.
- The engine gate never sets a driver seed. To exercise the static path
  across engines, append `setDriverSeed(7)` to a scratch copy of the bundle
  and run `gate_qjs.sh` on that.
- Textures must be baked to 7x7 at build time: Craftax resizes with PIL
  NEAREST (`floor((x+0.5)*16/7)`), the rasterizer blits with
  `floor(x*16/7)` — different pixels.

## Local dev

```sh
node tools/build-pages.mjs --games examples/games/multifile/parity/craftax_classic/dist \
  --out dist/craftax-play
python3 -m http.server 8123 -d dist/craftax-play
# http://localhost:8123/game/craftax_classic/
```
