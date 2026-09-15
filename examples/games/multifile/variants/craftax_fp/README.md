# Craftax-Classic, first person (variant)

Craftax-Classic with **unchanged dynamics** and a **first-person textured
voxel observation** instead of the top-down tile view. The 64×64 world grid is
extruded into unit blocks and seen from eye height through one per-pixel
raycast, which runs as a Rust rasterizer primitive — so the frame is native
code under QuickJS, wasm under V8 and in the browser, and byte-identical on
all three.

This is a **variant** of Craftax-Classic — same task underneath, different
observation function. It is **not** "Craftax parity": there is no first-person
Craftax anywhere to be exact against. `PLAN.md` for the classic port is next
door; `FIRST_PERSON_PLAN.md` is the design for this one and
`FIRST_PERSON_PROGRESS.md` is the task ledger.

## Status

Under construction. See `FIRST_PERSON_PROGRESS.md` for what is built and what
is not.

## Playing it in the browser (hand-off)

The build side is done and gated (`tests/test_render_fp.py`). What is left is
someone opening the page and looking at it.

```sh
node tools/build-pages.mjs --games examples/games/multifile/variants/craftax_fp/dist \
     --out dist/craftax-fp-play --title "Craftax first-person"
uv run python -m http.server -d dist/craftax-fp-play 8000
# then open http://localhost:8000/game/craftax_fp/
```

`dist/` is gitignored, so build it fresh; it takes about a second.

**What to expect.** The game ticks at **8 steps/s**, not 60, from the
sidecar's `human.steps_per_second` — Craftax is turn-based. Controls come from
the sidecar and are the classic port's, with one caveat that matters here:

> Arrows move and face in **world** directions, not relative to the camera —
> the camera snaps to the way you face. SPACE interacts with the cell ahead.
> TAB sleeps. 1-4 place stone/table/furnace/sapling. 5-7 craft pickaxes,
> 8-9-0 craft swords.

Absolute movement is deliberate and is the price of "same task": relative
turn-and-walk controls would change the action space and therefore the
dynamics. Pressing Left always steps west, whichever way you are looking.

**What to check by eye.**

1. **Facing is centred on the interact cell.** Face a tree and press SPACE;
   the block you chop should be the one in the middle of the screen. If the
   view is rotated 90° from where SPACE acts, the `playerDir` → yaw table in
   `80_render_fp.js` is wrong.
2. **The inventory strip is identical to craftax_classic's.** Open the classic
   page side by side (same seed, same keys) and compare the bottom two rows.
   A test asserts this already; eyes are the backstop for it.
3. **Walls look like walls.** Blocks should be a fixed height with a visible
   top edge against the sky, growing as you approach and shrinking as you back
   away. Textures should not swim or shear.
4. **Mobs stand upright at cell centres** and are hidden when something solid
   is between you and them.
5. **It gets dark and comes back.** Around 150 steps in, the frame should tint
   blue and dim, then recover. Sleeping (TAB) should grey it further.

**What you cannot check here, and why.** The **night static is not visible in
the browser**. Craftax draws it from `state_rng`, which the game derives from
the *driver's* seed, and no host — including this page — passes one. Below
`light_level` 0.5 you get the deterministic dusk image without the static. The
static itself is gated in `tests/test_render_fp.py` (three different driver
seeds, three different frames) rather than by eye.

**One thing worth knowing about the page.** It runs the **pure-JS** rasterizer,
not wasm: `tools/play-templates.mjs` inlines `rasterizer.wasm` only for games
whose source mentions `WEBGL`, and this one does not — it calls `voxelView`
instead. That is safe, because the JS port is bit-identical to the Rust
(`tests/test_voxel.py`, and verified again for this game over 41 frames), so
what you see IS the training frame. It is the slow path, but at 8 steps/s
there is a lot of headroom. Making the page use wasm would mean widening that
`WEBGL` test, which touches every game's page and was left alone.

## Throughput

Measured on this machine, single core, single env. Every first-person number
has the craftax_classic number from the **same harness** beside it; a figure
without its baseline is not a claim.

Host: arm64 Apple Silicon Mac (darwin 25.3.0), node v25.7.0, rustc 1.97.1.
Commit: see `bench.json` next to this file, which carries the full detail.
The plan asks for the same JSON at `outputs/craftax_fp_bench.json`; it is
written there too, but `outputs/` is gitignored, so the tracked copy is the
one beside this README.

### QuickJS — `native/build/qjs_host <game.js> bench 1 20000`

This is the native host, and it has **no JIT**. It always renders and ignores
the observation mode, so it measures pixel throughput and nothing else.

| game | SPS | µs/step |
|---|---|---|
| `craftax_fp` | **5,935** | 168.5 |
| `craftax_classic` | 397 | 2,518.9 |

**14.9× faster.** This is the number the variant exists for: the classic
renderer spends almost its whole step in per-pixel JS loops, and an
interpreter runs those slowly.

### V8 — `tests/envprof.mjs` (node `GameEnv`, in process)

| game | pixel | symbolic | dynamics only |
|---|---|---|---|
| `craftax_fp` | 11,020 SPS (90.7 µs) | 13,038 SPS (76.7 µs) | 620,781 SPS (1.61 µs) |
| `craftax_classic` | 10,962 SPS (91.2 µs) | 13,150 SPS (76.0 µs) | 600,062 SPS (1.67 µs) |

**Under V8 the two are a wash, and that is the honest result.** V8 JITs
classic's per-pixel float loops down to about the same cost as the wasm
raycast — roughly 14 µs of render in both games. The first-person render is a
large win exactly where there is no JIT, and neutral where there is one.

Note the three columns are not three renderers: `symbolic` still computes the
1,345-float observation, and `dynamics only` steps the bundle's `stepGame`
with no host, no observation and no renderer at all. The gap between
`dynamics only` (1.6 µs) and `symbolic` (77 µs) is host and observation
overhead, not the game.

### Where the QuickJS step goes

Measured by disabling one stage at a time in a scratch copy of the bundle:

| stage | µs/step, before | µs/step, now |
|---|---|---|
| dynamics (craftax_classic's, unchanged) | 69.1 | 69.1 |
| grid repack | 108.7 | ~12 |
| inventory strip | 109.9 | ~5 |
| `voxelView` (native) | 60.6 | 60.6 |
| `voxelDusk` (native) | 13.1 | 13.1 |
| **total** | **345.9** | **168.5** |

Two things moved. The grid repack now covers only a 21×21 window around the
player instead of all 4,096 cells — exact rather than approximate, because
rays terminate at 9 blocks so nothing outside the window can be sampled. The
inventory strip is recomposed only when one of its 20 counts changes; the
blit still happens every frame, because `background()` clears the canvas.

### The plan's target, not met

`FIRST_PERSON_PLAN.md` §8 asks for **≥ 8,000 SPS/core** under QuickJS, budgeting
"dynamics ~78 µs + render ≲ 40 µs". Dynamics measure 69 µs and the native
render measures 74 µs (`voxelView` 61 + `voxelDusk` 13), so the floor is about
143 µs — roughly 7.0k SPS — before a single line of JS. At 168.5 µs the
measured 5,935 SPS is 26% short of the target and about 15% short of that
floor. The budget was optimistic about the render, not wrong about the
approach.

### Cluster

**Not measured.** No checkout of this branch exists on FASRC: the only tree is
`/n/home06/truong/node-gym-smoke/playtrain`, on `main` at `29e1e7f`, with 69
dirty files and no `examples/games/multifile/variants/`. The `release` branch
is 75 commits unpushed, and pushing it is the user's call. This is the same
wall as `craftax_classic/PROGRESS.md` tasks 9b and 12.
