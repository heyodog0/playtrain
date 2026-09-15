# First-person Craftax — plan for a fresh agent

Status: plan only. Nothing below exists yet except the prerequisites in §2.
Written 2026-09-15 from a long design session; the reasoning behind every
decision is in §1 and §9 so you do not have to re-derive it.

Read this whole file before touching code. Then read `PLAN.md` §1–4 and
`README.md` in this directory, `PROGRESS.md` for how progress was tracked
last time, and the source files named in §2. Track your own progress in
`FIRST_PERSON_PROGRESS.md` next to this file, one row per task in §7.

---

## 0. One-paragraph brief

Build `craftax_fp`: Craftax-Classic with **unchanged, bit-exact dynamics**
and a **first-person textured voxel observation** instead of the top-down
tile view. The 64×64 world grid is extruded into unit blocks; the agent
sees it from eye height through a per-pixel voxel raycast (DDA) that runs
as **one new Rust rasterizer primitive**, so the frame is native code on
QuickJS, V8+wasm and the browser, byte-identical on all three. Humans play
it first-person in the browser and see exactly the training frame. It is a
*variant* of Craftax-Classic — same task underneath, different observation
function — and must be described that way, never as "Craftax parity".

---

## 1. Why these decisions (read this; it saves you from repeating our mistakes)

**Why a variant and not another parity port.** `craftax_classic` is already
bit-exact to PufferLib's C over 210 episodes / 49,061 lockstep steps (G2)
and its top-down frame is byte-identical to Craftax-Classic-Pixels
(147/147 daylight, 74/74 night frames given the driver seed). There is no
first-person Craftax anywhere to be exact against. The value here is a new
observation on a *certified* task: same seeds, same dynamics, different
view — a clean experimental axis nobody has.

**Why the render must be native.** We measured craftax_classic's step:
~97% of it is `renderGame` running per-pixel float loops in JS. Under
QuickJS (no JIT) that is 410 SPS on a Mac, 189 on the cluster; with the
game's drawing disabled the same QuickJS run does 12,789 SPS (31×). V8
goes 17k → 121k (7×). The dynamics themselves are ~120k SPS in V8. PlayTrain
is fast when pixels are made in native code and the JS only says what to
draw. Do not write a per-pixel loop in JS again.

**Why a raycast and not the triangle pipeline.** `crates/rasterizer/src/three.rs`
is a working CPU 3D pipeline but has **no camera** (view rotation assumed
identity) and **no textures**. Adding both is the DMLab-sized job. A voxel
world does not need triangles: one Amanatides-Woo DDA ray per pixel through
the block grid returns the first solid block and its hit face; a texture
lookup on that face gives the pixel. No camera matrix, no z-buffer, no
scene graph, no meshing. For a 64×64 frame with a 9-cell view distance
that is ~4,096 rays × ~10–15 steps ≈ tens of µs in Rust. The idea comes
from netherite's "semantic camera" (`Infatoshi/netherite`,
`blaze/core/obs_camera.h`) which stops at block ids; we add the texture
fetch. That repo is **unlicensed** — take the idea, write your own code,
never translate a function from it.

**Why textures may be reused.** `games/craftax_assets/` (59 PNGs, MIT,
Michael Matthews) is already vendored and baked by `tools/craftax_atlas.py`
into `src/15_atlas.js` as base64 RGBA. Craftax has no side-face art; a
block's single 16×16 texture is used on every face of its cube. Floors are
the same textures seen from above (that is what the top-down view already
shows).

**Why the dynamics must not move by one bit.** The entire claim "same task"
rests on `cc_ref` lockstep and the canonical 6,880-byte dump. The variant
reuses the classic source files unchanged and adds files; a gate (T4)
asserts the dump sequence is identical to `craftax_classic` for the whole
corpus. If you need to touch `20_state.js`–`70_step.js`, stop: you are
building a different game.

---

## 2. What exists that you will use

| thing | where | note |
|---|---|---|
| Certified dynamics | `src/00_header.js 10_constants.js 15_atlas.js 16_threefry.js 20_state.js 30_worldgen.js 40_player.js 50_mobs.js 60_world_tick.js 70_step.js` | reuse verbatim via the manifest; never edit |
| Top-down renderer | `src/80_render.js` | read for: `ATLAS['block_'+blk]` indexing, `_playerSprite(dir, asleep)`, the dusk pass (`ENHANCE`, `NIGHT_TINT`, `SLEEP_TINT`, `LUM_*`, `setNightKey`), `INV_SLOTS` |
| Symbolic obs | `src/85_obs_symbolic.js` | unchanged; `PLAYTRAIN_QJS_OBS_MODE=symbolic` still works |
| Host glue | `src/90_playtrain.js` | `draw()` = `stepGame` → `nightTick()` → `renderGame`; `setDriverSeed`; `CANVAS_SIZE = 64` with the 63×63 frame + 1px pad. **Harnesses fix obs at 64×64; do not use 63.** |
| State field names | `src/20_state.js` | `playerR`, `playerC`, `playerDir`, `isSleeping`, `lightLevel`, `pcg`, map arrays, mob arrays — read the `STATE_FIELDS_*` tables for exact names/widths; `MAP_SIZE = 64` in `10_constants.js` |
| Bitmap precedent (ABI + 4 hosts + shims) | `crates/rasterizer/src/lib.rs` (`rs_load_rgba`, `rs_draw_image`), `native/runtime/p5.cpp/.hpp` (`createBitmap`, `loadBitmap`), `native/qjs/qjs_host.cpp`, `native/qjs/qjs_vec_host.cpp` (`js_createBitmap`, `js_loadBitmap`), `runtime/p5/p5-shim.mjs`, `runtime/p5/raster.mjs`, `runtime/p5/raster-wasm.mjs` | this is the exact pattern for adding a primitive end to end; copy its shape |
| Deterministic trig in Rust | `crates/rasterizer/src/three.rs` `ksin/kcos` (fdlibm kernels, pure IEEE, bit-identical native/wasm) | or a sin LUT; either is fine, libm `sin/cos` is not |
| Golden-hash test pattern | `#[cfg(test)]` block at the bottom of `crates/rasterizer/src/three.rs` (`GOLD_SEA`, `GOLD_ROT`, `box_front`; `THREE_SCENES_OUT=<file>` dumps scenes) + `crates/rasterizer/tests/wasm_three_check.mjs` replaying them through the wasm build | native == wasm byte-for-byte; copy this two-part shape |
| Bundler | `tools/bundle_multifile.py <manifest> [--check]` | plain concatenation in `sources` order → `dist/<name>.js` + sidecar `.json`; `.gitignore` already un-ignores `examples/games/multifile/*/*/dist/` |
| Differential gate | `native/gate_qjs.sh <game> <steps> [seeds]` with `PLAYTRAIN_GAMES_DIR=<dist dir>` and `PLAYTRAIN_QJS_ACTIONS=<json actions>` | V8 vs QuickJS trace incl. obs hash. **Writes fixed `/tmp/gateq_*` paths: never run two at once** |
| Test scaffolding | `tests/jsrun.py jsrender.py ccref.py`, `tests/test_engines.py`, `tests/test_bundle_fresh.py`, `tests/test_website.py` | copy patterns |
| Play page | `node tools/build-pages.mjs --games <dist> --out dist/<x> --title <t>`; serve with `uv run python -m http.server` | browser twin |
| Bench | `native/build/qjs_host <game.js> bench 1 <n>` (always renders; ignores obs mode), `crates/rasterizer` `bench_frame` | see §8 |

Build the native hosts if absent: `bash native/build_qjs.sh && bash native/build_qjs_vec.sh`.
wasm: `PATH=~/.cargo/bin:$PATH cargo build --release --target wasm32-unknown-unknown` in
`crates/rasterizer` (Homebrew rustc lacks the target), then copy to `runtime/p5/rasterizer.wasm`
(a committed artifact).

---

## 3. Rules (carry-overs from the classic port, all still binding)

- **Python is `uv run` / `uv add`.** Never pip, never bare python.
- **Never `rm -rf`.** `git rm` / `git mv` / `git clean` on build dirs only.
- **Never edit `games/craftax_src/`** or the classic `src/00`–`70` files.
- **Never weaken a gate to pass it.** No tolerances on integer/bit compares, no fields dropped, no shortened corpus, no xfail. Blocked = record the exact failing comparison and stop.
- **No BigInt.** 64-bit state is two uint32 words.
- **`Math.fround` after every float op** in anything that feeds pixels or dynamics on the JS side. In Rust use `f32` and only `+ - * / sqrt` and compares; **no libm `sin/cos/tan/pow`**; build with `-ffp-contract=off`-equivalent (Rust does not contract by default; do not enable `mul_add`). Every constant like `tan(fov/2)` is a compile-time literal.
- **Runtime/host changes are normally forbidden.** This plan *authorizes exactly one*: the new primitive and its bindings in the seven files listed in §2 "Bitmap precedent". Nothing else in `native/`, `runtime/`, or the catalog changes. If something else seems necessary, write it down as blocked.
- **Commit when a gate turns green**, short-phrase message, no trailer except the session line the harness requires, **no Claude authorship line**. `dist/` is tracked: commit the rebuilt bundle with source changes.
- **Cluster work uses `fasrc '<cmd>'`**; first call may sit silent ~60 s. `nproc` lies there (`OMP_NUM_THREADS=1`); `--exclusive` still needs `-c N`. Pre-sync the venv and use `uv run --no-sync` inside jobs.
- Hand-offs stay hand-offs: the browser check and any human session get prerequisites and a note, never a simulated human.
- End every iteration by updating `FIRST_PERSON_PROGRESS.md`; one task per iteration.

---

## 4. Specification

### 4.1 World geometry
- Grid cell `(r, c)` of the 64×64 map → unit block whose footprint is `x∈[c, c+1)`, `z∈[r, r+1)`.
- **Floor**: every cell has a floor at `y = 0` textured with the cell's block texture.
- **Solid**: cells whose Craftax block type is impassable for the player (stone, tree, table, furnace, plants? — derive the set from `40_player.js` movement rules; do not guess) are additionally a full cube `y∈[0,1)` textured on all four side faces and the top with the same texture. Water and lava are floors (Craftax never generates lava — a documented reference quirk).
- **Sky**: rays that exit the view distance or the map without hitting a solid, and rays above the horizon that hit nothing, return sky colour `SKY_RGB` (pick from the Craftax palette; constant; document it).
- Eye at `(playerC + 0.5, EYE_Y = 0.5, playerR + 0.5)`. Player stands on the floor of a passable cell.
- **Facing**: `playerDir` ∈ {0..3} → yaw ∈ {0°, 90°, 180°, 270°}, matched to Craftax's direction vectors in `40_player.js` so the cell the player would interact with is centred on screen. Pitch fixed at 0. Camera snaps; no smoothing (actions are discrete and one action = one step).
- View distance `VIEW_DIST = 9.0` blocks (Craftax's 9×7 view radius); rays terminate there.
- FOV: horizontal 90°, vertical 90° on the square 64×64 frame; `tan(45°) = 1.0` exactly, which makes the ray-direction math trivially exact.

### 4.2 The primitive
```
rs_voxel_view(canvas: u32,
              grid: *const u16, w: u32, h: u32,      // packed cell = (atlas_tile << 1) | solid
              eye_x: f32, eye_y: f32, eye_z: f32,
              yaw_q: u32,                              // 0..3 quarter turns
              view_dist: f32,
              atlas: *const u8, tile_px: u32, n_tiles: u32,   // RGBA tiles, tile_px×tile_px each
              sky_rgb: u32,
              dst_x: u32, dst_y: u32, dst_w: u32, dst_h: u32) // where in the canvas
```
- For each pixel `(px, py)` in the destination rect: build ray dir in f32 from the pixel centre, rotate by `yaw_q` with exact 0/±1 swaps (no trig needed for quarter turns — **this is deliberate**; if you ever add free yaw, use `ksin/kcos`), DDA through cells until a solid cell or `view_dist` or map edge.
- On hit: determine the struck face (the DDA axis of the last step) and the face-local UV in f32; sample the tile with **nearest** filtering (`(u * tile_px) as i32` clamped); write RGB.
- Floor: if the ray's y descends to 0 before hitting a solid, sample the floor cell's tile at `(x frac, z frac)`.
- Zero heap allocation per call. All state passed in; nothing static.
- Output must be **byte-identical on native and wasm32**: golden-hash tests as in `three_golden`; `tests/wasm_voxel_check.mjs` mirrors `wasm_three_check.mjs`.

### 4.3 Sprites (mobs, arrows, plants that are not solid)
Second pass, JS-side list → one call per sprite: `rs_voxel_sprite(canvas, eye..., yaw_q, view_dist, sprite_x, sprite_z, atlas_tile, ...)` draws an upright billboard 1×1 at the entity's cell centre, **depth-tested against the ray depths of pass 1** (so keep a per-pixel depth buffer inside the canvas struct, filled by `rs_voxel_view`, consumed by sprites, reused across frames). Nearest sampling, alpha from the tile (Craftax mob PNGs have alpha; note the atlas baker's per-item `apply_alpha` inconsistency in `tools/craftax_atlas.py` and reproduce whatever it bakes). Classic sprite-casting; no perspective-correct issues since a billboard is a flat quad facing the eye.

### 4.4 Dusk / night
After the world+sprites are in the canvas, apply Craftax's dusk pass over the 3D region using the **same** f32 formula as `80_render.js` (luma → enhance → tint → daylight lerp; static from `state_rng` when `daylight < 0.5` and a driver seed is set). Two options, pick A unless measured otherwise:
- **A (native):** `rs_dusk(canvas, x,y,w,h, daylight: f32, key0,key1, use_static, intensity_tex...)` — port the formula in the same op order; threefry uniform per pixel already exists in JS (`16_threefry.js`); porting it to Rust is mechanical and must be validated against `jax_uniform.json` the same way the JS was.
- **B (JS):** keep it in JS as today (`readPixels` → loop → upload). It is the slowest part of the classic renderer under QuickJS; only acceptable as a first cut.

### 4.5 Frame layout (64×64 canvas)
- Rows 0–48: first-person view (64 wide × 49 tall) — same height as the classic map region so the inventory strip stays where it is.
- Rows 49–62: the classic inventory strip drawn exactly as today via the existing bitmap path (`_upload(_invPx, ...)`), so inventory pixels are byte-identical to `craftax_classic`.
- Row 63: black pad (as today).
Document the layout in the variant README with a diagram.

### 4.6 Actions, obs, sidecar
- Action space, keymap, controls text, `max_steps`: copy from `manifest.json`. Movement stays **absolute** (Craftax's up/down/left/right move in world directions and set `playerDir`) because relative "turn/forward" controls would change dynamics. Say so in the README; it is the price of "same task".
- `obs.mode` pixel default; symbolic unchanged (`85_obs_symbolic.js` reused).
- `reference` block: `name: "craftax_classic (this repo) + PufferLib craftax_classic 6ffa5b1 dynamics"`, `not_matched` lists: "observation is first-person; not Craftax-Classic-Pixels".

---

## 5. Layout of the new game

```
examples/games/multifile/variants/craftax_fp/
  manifest.json          # sources = ../../parity/craftax_classic/src/{00..70,85}.js + local files
  src/
    15_atlas_fp.js       # GENERATED: same tiles as classic + packed grid table helpers if needed
    80_render_fp.js      # renderGame(st): build grid u16 (once per episode + on block change), eye/yaw, calls the primitives, inventory strip, dusk
    90_playtrain_fp.js   # copy of 90_playtrain.js with CANVAS_SIZE 64, setDriverSeed, draw()
  tests/                 # see §7 gates
  dist/                  # committed
  README.md
```
`tools/bundle_multifile.py` resolves each entry as `(manifest_dir / rel).resolve()` (line ~76), so `../../parity/craftax_classic/src/20_state.js` should work as-is. Confirm there is no containment check after that line; if there is, extend it minimally to allow relative paths rather than copying files. Single-sourcing the dynamics is the point — a copied file is a second source of truth. Either way, `tests/test_bundle_fresh.py`'s pattern (rebuild and compare) applies to the fp bundle too.

Grid packing: rebuild the `u16` grid from the map array **only when a block changes** (Craftax mutates few cells per step) — keep a dirty flag in the FP render module; never re-pack 4,096 cells every frame if you can avoid it, but correctness first: T3 may start with a full re-pack and T7 measures whether it matters.

---

## 6. Determinism contract (the gates enforce this)

1. `rs_voxel_view/_sprite/_dusk` are pure functions of their arguments.
2. f32 only; `+ - * / sqrt` and compares; no `mul_add`; no libm.
3. Native (QuickJS host, x86-64 and arm64) == wasm32 (V8, browser) byte-for-byte: golden hashes + `gate_qjs.sh`.
4. The canonical 6,880-byte dynamics dump of `craftax_fp` equals `craftax_classic`'s for every corpus trajectory (T4).
5. With `PLAYTRAIN_QJS_OBS_MODE=symbolic`, the symbolic vector equals classic's (already implied by 4; assert it anyway).

---

## 7. Tasks and gates

| # | task | done when (the gate) |
|---|---|---|
| T0 | Read §1–6, the classic `README.md`, `PLAN.md` §1–4, `80_render.js`, `90_playtrain.js`, `lib.rs` bitmap fns, `three.rs` header, `p5.cpp` `createBitmap`. Write `FIRST_PERSON_PROGRESS.md`. Confirm hosts + wasm toolchain build on this machine. | progress file exists; `native/build/qjs_host` and `libqjs_vec.so` present; `cargo test --release` green in `crates/rasterizer` |
| T1 | `rs_voxel_view` in `lib.rs` (new file `voxel.rs` behind `rs_voxel_*`), unit tests with 3 golden scenes (open field, corridor, facing a wall at each yaw), `tests/wasm_voxel_check.mjs`. | `cargo test --release` green; wasm check PASS byte-identical; `bench_frame`-style bench reports µs/frame (record it) |
| T2 | Bindings: `p5.hpp/.cpp` (`voxelView(...)`), `qjs_host.cpp`, `qjs_vec_host.cpp`, `p5-shim.mjs`, `raster.mjs` (pure-JS fallback **must** produce identical bytes — port the same f32 algorithm with `Math.fround`; this is the one place JS per-pixel code is allowed, it is the browser fallback only), `raster-wasm.mjs`. A tiny `tests/games/voxel_smoke.js` at repo root + `tests/test_voxel.py` like `tests/test_bitmap.py`. | `uv run pytest tests/test_voxel.py -q` green: all three backends hash-equal |
| T3 | Game: manifest, `80_render_fp.js` (grid pack, eye/yaw, primitive call, inventory strip), `90_playtrain_fp.js`; bundle; play page renders without errors. | `uv run python tools/bundle_multifile.py <manifest> --check` clean; `node tools/build-pages.mjs …` builds; a 64×64 frame has > 50 distinct colours (not a stub) |
| T4 | **Dynamics-invariance gate** `tests/test_same_dynamics.py`: for every trajectory in the classic `traces/corpus.json` / `traces/corpus/` (built by `reference/build_corpus.py`; `traces/golden.json` too), step both bundles in node and compare the canonical dump (see `tests/jsrun.py` for how the classic tests obtain it) every step. | zero differing bytes over the full corpus and golden set; also symbolic obs equal |
| T5 | Cross-engine: `tests/test_engines_fp.py` driving `native/gate_qjs.sh craftax_fp 3000` with `PLAYTRAIN_GAMES_DIR` = fp dist; seeds 1 42 777. | GATE PASS, 3× "bit-exact" |
| T6 | Sprites (`rs_voxel_sprite`) + dusk (§4.4 option A) + night static with driver seed; goldens extended; wasm check; T5 rerun. | T1/T2/T5 gates green again; a night frame at `light_level<0.5` differs from its daylight twin (not vacuous) |
| T7 | Throughput: Mac `qjs_host bench` and `envprof`-style V8 run for fp vs classic; then one exclusive cluster job (`test` partition, `-c 64 --exclusive`, `unset OMP_NUM_THREADS`, `uv run --no-sync`) on both. Save `outputs/craftax_fp_bench.json`. | numbers recorded in README §Throughput with host, node, commit; no claim without the same-harness classic baseline beside it |
| T8 | **Hand-off:** play page at `dist/craftax-fp-play/`, serve command, what the human should check (facing centred on interact cell; inventory strip identical to classic; night static present with driver seed). | note in PROGRESS; do not simulate the human |
| T9 | Docs: variant `README.md` (layout diagram, absolute-controls caveat, what is and is not exact, throughput table), update `THIRD_PARTY_LICENSES` if any new asset, add a memory note for the next agent. | files committed |

Stop and write "blocked" with the exact failing comparison if: T4 shows any dump difference (you changed dynamics), T5 differs between engines (an f32/libm leak — find it, do not tolerance it), or the wasm check differs from native.

---

## 8. Numbers to beat / compare against (measured, this repo)

| config | SPS | where |
|---|---|---|
| craftax_classic, QuickJS, pixel (today) | 410 Mac / 189 cluster (Xeon 8480CL) | `qjs_host bench` |
| craftax_classic, QuickJS, drawing disabled | 12,789 Mac | scratch experiment |
| craftax_classic, V8, pixel / symbolic / no draw | 14,006 / 17,298 / 120,929 Mac | `envprof.mjs` |
| PufferLib C `puf_step` | 1.77M Mac (0.56 µs) | `reference/` bench |
| 32-env cluster ceiling, classic QuickJS | 5,903 | job 46542078 |

Target for `craftax_fp` under QuickJS with native render: **≥ 8k SPS/core on the Mac** (dynamics ~78 µs + render ≲ 40 µs). If you land far below, profile before optimising; the classic experience says the fix is "move it out of JS", not "make the JS faster".

Traps already hit: `GameEnv` loads the sidecar `.json` next to the game path — a bundle copied without its `.json` silently runs an 8-action space and every comparison looks like a divergence. `qjs_host bench` always renders and ignores obs mode. `reference_trace.mjs` spends ~57% of its time in `fnv1a` — never read its timing as env throughput.

---

## 9. Non-goals (do not drift into these)

- Free-look yaw/pitch, relative movement, mouse input — changes dynamics or the action space.
- Triangles, `three.rs` camera work, DMLab, Minecraft — separate plans.
- Matching Craftax-Classic-Pixels — impossible by construction; say "variant".
- Lightmaps, bilinear filtering, mipmaps — not needed at 9 cells; nearest is the spec.
- Any change to `craftax_classic` itself.

---

## 10. Reporting

When done, the summary must state plainly: dynamics gate result (bytes compared, differences), cross-engine result, wasm==native result, measured SPS for fp and classic on the same harness, and what the human still has to check. If any of those is not green, say which and why, in the first sentence.
