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

**Pixel parity holds in daylight.** Verified against Craftax itself by
injecting our states into its `EnvState` and calling its own
`render_craftax_pixels`: at `light_level >= 0.5` our frame is byte-identical
to `render_craftax_pixels(state).astype(uint8)` — 147/147 and 81/81
consecutive frames on two trajectories.

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
| Craftax pixels, `light < 0.5` | **open — this is the next task** |

## The next task: night frames

See `reference/craftax_pixels/README.md` for the full analysis. Summary:

Craftax's night rendering adds per-pixel static:

```python
night_with_static = jax.random.uniform(state.state_rng, map_pixels.shape[:2]) * 95 + 32
night_pixels = jax.lax.select(daylight < 0.5, night_with_static, map_pixels)
```

`state_rng` is set in `game_logic.py` from the **caller's** step key
(`rng, _rng = jax.random.split(rng)`), so Craftax's night frame is not a
function of its environment state — two Craftax runs with different driver
seeds differ in 3086 of 3969 pixels.

**The environment therefore cannot derive the key. The renderer can still
accept one.** Implement threefry-2x32 + `jax.random.uniform` in JS, take
`state_rng` as an input, and the night path becomes reproducible for any
supplied key — which is what a comparison harness needs and what makes the
renderer complete.

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
