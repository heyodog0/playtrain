# Craftax-Classic, first person (variant)

Craftax-Classic with **unchanged dynamics** and a **first-person textured
voxel observation** instead of the top-down tile view. The 64×64 world grid is
extruded into unit blocks and seen from eye height through one per-pixel
raycast, which runs as a Rust rasterizer primitive: native code under QuickJS,
the same Rust compiled to wasm32 under V8, and a hand port in JS for the
browser. All three produce the same bytes, and that is gated rather than
asserted.

This is a **variant** of Craftax-Classic — same task underneath, different
observation function. It is **not** "Craftax parity": there is no first-person
Craftax anywhere to be exact against. `PLAN.md` for the classic port is next
door; `FIRST_PERSON_PLAN.md` is the design for this one and
`FIRST_PERSON_PROGRESS.md` is the task ledger.

## Status

See `FIRST_PERSON_PROGRESS.md` for the task ledger. T0-T8 are done or handed
off; the cluster throughput run (T7b) is blocked on there being no checkout of
this branch on FASRC.

## The frame

A 64x64 observation, the same shape every PlayTrain game uses:

```
     col 0                                                    63
     +------------------------------------------------------+--+
row 0|                                                      |  |
     |   first-person view, 64 wide x 49 tall                |  |
     |   one DDA ray per pixel, 90 deg FOV both axes         |  |
     |   horizon at row 24 (pitch is fixed at 0)             |  |
  48 |                                                      |  |
     +---------------------------------------------------+--+--+
  49 |   Craftax inventory strip, 63 x 14                 |pad  |
     |   byte-identical to craftax_classic's              |     |
  62 +---------------------------------------------------+-----+
  63 |   black padding                                          |
     +----------------------------------------------------------+
```

The view is 64 wide where classic's map region is 63: it is cast per pixel and
has no tile grid to stay aligned to, so the extra column is free. The
inventory strip keeps classic's 63 exactly, and column 63 of those rows stays
padding.

Why 64x64 at all, rather than Craftax's 63x63: every harness in this repo
fixes the observation at 64 (`reference_trace.mjs` hardcodes it, `qjs_host`
has `static const int OBS = 64`), so a 63 canvas gets resampled on readback
and the two backends resample differently. The classic port's
`90_playtrain.js` has the long version of that story.

## World geometry

- Grid cell `(r, c)` is the unit square `x in [c, c+1)`, `z in [r, r+1)`; `y`
  is up.
- **Every** cell has a floor at `y = 0`, textured with that cell's block.
- A cell whose block is **impassable** is additionally a full cube `y in
  [0, 1)`, textured on all four sides and the top with the same texture.
  Craftax has no side-face art, so one texture per block is all there is.
- The impassable set is **derived**, not chosen: it is `isSolid()` from
  `40_player.js` — the set that refuses a move is the set that stops a ray —
  minus **water**, which is impassable but drawn as a floor, because a lake
  you can see across reads better than a glass wall and you still cannot walk
  into it. Lava is not in `isSolid` at all and Craftax never generates it
  anyway (reference quirk 1 in the classic README).
- **Plants are cubes.** `isSolid` includes `BLK_PLANT` and `BLK_RIPE_PLANT`.
- Eye at the centre of the player's cell, `y = 0.5` — inside the block layer,
  which is why you can never see the top face of a block.
- View distance 9.0 blocks, Euclidean. Past it, rays return sky.
- **Sky is a choice, not a reproduction**: `0x87CEEB`. Craftax's view is
  top-down and its asset set has no sky texture and no palette entry for one.

## Controls are absolute, and that is the price of "same task"

Arrows move and face in **world** directions, not relative to the camera. Left
always steps west, whichever way you are looking; the camera snaps to face the
way you moved.

Relative turn-and-walk controls would need different actions, which would
change the action space and therefore the dynamics — and the whole claim here
is that the dynamics are untouched. So the camera follows `playerDir` and the
keys stay Craftax's.

## What is exact, and what is not

**Exact: the dynamics.** The variant reuses craftax_classic's dynamics files
*by manifest path* — not copies — and a gate steps both bundles over the whole
committed corpus and compares the full 6,880-byte canonical state every step:
**210 episodes, 49,061 steps, zero differing bytes**, plus the 1,345-float
symbolic observation, also byte-identical. classic itself is bit-exact to
PufferLib's C (G2, re-run on this machine: 210 episodes, 49,061 steps), so the
chain fp == classic == C is measured, not inferred.
`tests/test_same_dynamics.py`.

**Exact: across engines.** `native/gate_qjs.sh craftax_fp 3000` passes on
seeds 1, 42 and 777 with the observation hash compared every step — QuickJS
running the raycast compiled natively, V8 running the same Rust compiled to
wasm32. The pure-JS fallback in `runtime/p5/raster.mjs` is bit-identical too.

**Exact: the inventory strip.** Rows 49-62 are compared pixel for pixel
against craftax_classic's over a trajectory that moves the inventory.

**NOT exact, and cannot be: the first-person image.** There is no first-person
Craftax to be exact against. This is a variant — same task, different
observation function — and must never be described as Craftax parity.

**NOT exact: the compositing arithmetic.** Craftax composites into a float32
buffer that stays float for a whole frame; the voxel primitives read and write
the uint8 canvas, so each pass quantises at its boundary. Since there is
nothing to be exact *to*, the simpler thing is the right thing. What is
required, and gated, is that every backend agrees.

**Inherited unchanged from craftax_classic:** auto-reset does not continue the
RNG stream across episodes, and `GameEnv.reset()` consumes one NOOP step
before the first agent action.

## Gates

```sh
# the game: bundle freshness, frame layout, yaw, solid blocks, mobs, night
uv run pytest examples/games/multifile/variants/craftax_fp/tests -q

# the primitive: goldens, geometry, depth, threefry
cd crates/rasterizer && PATH=~/.cargo/bin:$PATH cargo test --release

# native == wasm32, byte for byte
VOXEL_SCENES_OUT=/tmp/voxel.jsonl cargo test --release
PATH=~/.cargo/bin:$PATH cargo build --release --target wasm32-unknown-unknown
node tests/wasm_voxel_check.mjs /tmp/voxel.jsonl \
     target/wasm32-unknown-unknown/release/playtrain_rasterizer.wasm

# all four backends agree on the primitive
uv run pytest tests/test_voxel.py -q
```

| gate | test | what it holds |
|---|---|---|
| dynamics unchanged | `tests/test_same_dynamics.py` | 6,880-byte state + symbolic obs == craftax_classic, whole corpus |
| cross-engine | `tests/test_engines_fp.py` | V8 vs QuickJS bit-exact, 3000 steps x 3 seeds |
| the frame | `tests/test_render_fp.py` | layout, yaw, solid blocks, mobs, dusk, night static |
| the primitive | `crates/rasterizer` unit tests | goldens + geometry + depth units |
| native == wasm | `crates/rasterizer/tests/wasm_voxel_check.mjs` | 8 scenes, hash for hash |
| four backends | `tests/test_voxel.py` | native, wasm, pure-JS, and the differential gate |

**After changing anything in Rust**, rebuild in this order or the hosts link
stale code and the gates compare two old things:

```sh
cd crates/rasterizer
PATH=~/.cargo/bin:$PATH cargo rustc --release --lib --crate-type staticlib
PATH=~/.cargo/bin:$PATH cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/playtrain_rasterizer.wasm ../../runtime/p5/rasterizer.wasm
cd ../../native && bash build_qjs.sh && bash build_qjs_vec.sh
```

`native/build_qjs.sh` only builds the rasterizer staticlib **if the `.a` is
missing**, which is why the first line is not optional.

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

**13.4× faster.** This is the number the variant exists for: the classic
renderer spends almost its whole step in per-pixel JS loops, and an
interpreter runs those slowly. (It was 14.9× before face shading, fog and the
sky gradient were added; the look costs about 20 µs a step.)

### Vectorised host — `NativeVecEnv`

Worker threads are `min(num_envs, performance-core count)`; this M4 has 4 P and
6 E cores.

| envs | SPS total | cores busy |
|---|---|---|
| 1 | 10,573 | 1.00 |
| 2 | 18,605 | 1.92 |
| 4 | 18,493 | 4.07 |
| 8 | 16,372 | 3.88 |
| 16 | 17,193 | 3.89 |

**It plateaus at ~18.5k from two envs upward, and that is a host limitation,
not the machine's.** Four cores are busy at 4 envs but per-core throughput has
halved. The discriminating experiment: **four separate processes with one env
each total 33,522 SPS**, where one process with four envs gets 18,493 — so the
same cores deliver 1.8× more when the envs do not share a process. The likely
causes are the per-step spin barrier (it waits for the slowest shard, and
Python dispatches every step) and shared-cache pressure from four ~64 KB
per-env working sets on the M4's single P-core cluster. Fixing it would mean
changing `native/qjs/qjs_vec_host.cpp`, which this plan authorises only for the
voxel bindings, so it is recorded rather than changed.

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
