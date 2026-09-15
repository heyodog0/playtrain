# First-person Craftax — progress ledger

Task ledger for `FIRST_PERSON_PLAN.md` §7. Statuses: `todo`, `in-progress`,
`done`, `blocked`, `handoff`. One row per task; add sub-task rows under a
parent, never delete a row. The agent edits only Status / Gate result /
Commit / Notes.

Gate rule (plan §3, and the loop prompt): a task is done only when its §7
"done when" gate is green **on this machine**. Never weaken a gate. If it
cannot pass, write `blocked` with the exact failing comparison (seed, step,
field or pixel, expected, actual) and stop.

| # | Task | Status | Gate result (last line) | Commit | Notes |
|---|---|---|---|---|---|
| T0 | Read §1–6 + classic README/PLAN/render/host/rasterizer sources; write this file; confirm hosts + wasm toolchain | done | `cargo test --release`: `test result: ok. 7 passed; 0 failed; 1 ignored`; wasm three-check `PASS` ×3 | 2a0b714 | See "T0 findings" below. |
| T1 | `rs_voxel_view` in new `crates/rasterizer/src/voxel.rs`; 6 golden scenes (open field, corridor, wall at each of 4 yaws); `tests/wasm_voxel_check.mjs` | done | `cargo test --release`: `13 passed; 0 failed; 2 ignored`; wasm check `PASS` ×6, native hash == wasm hash; **44.87 µs/frame** | 5b5ca36 | See "T1 findings" below for the ABI T2 must bind and the depth-buffer decision. |
| T2 | Bindings: `p5.hpp/.cpp`, `qjs_host.cpp`, `qjs_vec_host.cpp`, `p5-shim.mjs`, `raster.mjs` (pure-JS fallback, bit-identical), `raster-wasm.mjs`; `tests/games/voxel_smoke.js` + `tests/test_voxel.py` | done | `uv run pytest tests/test_voxel.py -q`: `5 passed in 1.20s`; `GATE PASS: voxel_smoke` (200 steps × 3 seeds bit-exact) | dcfdbf0 | See "T2 findings" below. Repo suite `105 passed, 3 skipped`; classic parity suite `117 passed` — no regressions from the wasm rebuild. |
| T3 | Game: `examples/games/multifile/variants/craftax_fp/` manifest + `15_atlas_fp.js` + `80_render_fp.js` + `90_playtrain_fp.js`; bundle; play page | done | `uv run pytest examples/games/multifile/variants/craftax_fp/tests -q`: `18 passed in 0.44s`; bundle `--check` → `ok craftax_fp`; `built 1 games` | 8c57ca2 | See "T3 findings". Repo suite `106 passed, 3 skipped`. Both gates mutation-checked. |
| T4 | Dynamics-invariance gate `tests/test_same_dynamics.py` over `traces/corpus/` + `traces/golden.json` | done | `uv run pytest .../craftax_fp/tests/test_same_dynamics.py -q`: `6 passed in 5.11s`; driver: `210 episodes, 49061 steps, 0 differing bytes` | f665b4f | Symbolic obs equal too. G2 re-run here: `3 passed` (classic == C). See "T4 findings" for the golden-chain anomaly. |
| T5 | Cross-engine `tests/test_engines_fp.py` → `native/gate_qjs.sh craftax_fp 3000`, seeds 1 42 777 | done | `8 passed in 8.56s`; `GATE PASS: craftax_fp`, 3× `3000 steps bit-exact` | f70b6d0 | Symbolic mode agrees too; vectorised host deterministic and equal to the single env. Whole variant suite `32 passed`. |
| T6a | Sprites: `rs_voxel_sprite`, bindings, goldens extended, mobs/arrows wired into the game | done | `cargo test --release`: `22 passed; 0 failed; 2 ignored`; wasm check `PASS` ×7; `test_voxel.py` `5 passed`; fp suite `32 passed`; T5 `8 passed`; **49.08 µs/frame** | 896b25c | Found and fixed a real depth-units bug — see "T6a findings". |
| T6b | Dusk (§4.4 option A: `rs_dusk`) + night static from the driver seed; threefry ported to Rust; goldens extended; T5 rerun | done | `cargo test --release`: `29 passed; 0 failed; 2 ignored`; wasm check `PASS` ×8; `test_voxel.py` `5 passed`; fp suite `37 passed`; T5 `8 passed`; **49.09 µs/frame** | 9bbc453 | Night frame differs from its daylight twin on all 3136 pixels; static depends on the driver seed. Plan §4.4 corrected in the same commit. |
| T7a | Throughput, Mac: `qjs_host bench` + a new V8 `tests/envprof.mjs`, fp vs classic; `bench.json` + README §Throughput | done | QuickJS **fp 5,935 SPS vs classic 397 = 14.9×**; V8 fp 11,020 vs classic 10,962 (a wash); fp suite `37 passed`, repo `106 passed, 3 skipped` | a657e02 | Target (≥8k) NOT met — see "T7a findings". Two render-side fixes landed here. |
| T7b | Throughput, cluster: one exclusive job (`test` partition, `-c 64 --exclusive`, `unset OMP_NUM_THREADS`, `uv run --no-sync`) on fp and classic | blocked | not run | | **No checkout of this branch exists on FASRC.** Only tree is `/n/home06/truong/node-gym-smoke/playtrain`, on `main` at `29e1e7f`, 69 dirty files, no `examples/games/multifile/variants/`. `release` is 75 commits unpushed and pushing it is the user's call. Same wall as classic PROGRESS 9b/12. |
| T8 | Hand-off: play page at `dist/craftax-fp-play/`, serve command, what the human checks | handoff | build side gated: `37 passed` (`tests/test_render_fp.py`); page builds, carries the JS voxel port, paces at 8 steps/s | 67f30f3 | **Ready for a person. Do not simulate.** Instructions in the variant README under "Playing it in the browser". See "T8 findings" for what is NOT checkable. |
| T9 | Docs: variant `README.md` (layout diagram, absolute-controls caveat, exactness, throughput), `THIRD_PARTY_LICENSES`, memory note | done | full sweep: repo `106 passed, 3 skipped`, fp `37 passed`, classic `117 passed`, `cargo test --release` `29 passed`, wasm check `PASS` ×8 | 7fc20bc | README covers frame layout, world geometry, absolute controls, exact/not-exact, gates, hand-off, throughput. |

## T0 findings (what T1+ must know)

Machine: arm64 Mac, `rustc 1.97.1`, `node v25.7.0`, branch `release` at
`d47ca67`.

**Gates run and green.**

- `cargo test --release` in `crates/rasterizer`: `7 passed; 0 failed; 1 ignored`
  (the ignored one is `three::tests::bench_frame`).
- Wasm toolchain works: `wasm32-unknown-unknown` is installed for
  `~/.cargo/bin` (Homebrew's rustc still lacks it — always prefix
  `PATH=~/.cargo/bin:$PATH`). `cargo build --release --target
  wasm32-unknown-unknown` succeeds.
- Cross-target replay green:
  `THREE_SCENES_OUT=<f> cargo test --release` then
  `node tests/wasm_three_check.mjs <f> target/wasm32-unknown-unknown/release/playtrain_rasterizer.wasm`
  → `PASS box_front`, `PASS box_rot`, `PASS seaquest_like`, native hash ==
  wasm hash in all three. This is the exact shape T1's
  `tests/wasm_voxel_check.mjs` must copy.
- Hosts already built: `native/build/qjs_host` and `native/build/libqjs_vec.dylib`
  are present (the plan says `.so`; on macOS it is `.dylib` — not a problem,
  just do not go looking for the `.so`).

**Watch out (found while checking, relevant to T2/T6).**

- The committed `runtime/p5/rasterizer.wasm` is **not** byte-identical to a
  fresh local build of the same source:
  committed `e05fd9ff0b50008d…`, fresh `49352042bac8e40a…`. It was built by a
  different rustc. That is fine for the three-check (which replays the
  freshly built artifact), but T2 must rebuild and commit the wasm, and after
  that commit the browser/V8 path runs *this* machine's codegen. Pixel output
  must still be byte-identical — that is what the voxel wasm check proves —
  but do not treat the committed blob's hash as a fixture.

**Sources read, and the specific thing each one gives T1–T3.**

- `crates/rasterizer/src/lib.rs`: `Canvas { dw, dh, sx, sy, px: Vec<u8> (RGBA,
  straight alpha), out, … }`, handles are indices into `rs().canvases`;
  `cv(h)` fetches one. `rs_new_canvas(lw, lh, dw, dh)`, `rs_load_rgba(h, ptr,
  len)` (plain `copy_nonoverlapping`, min of the two lengths),
  `rs_pixels_ptr`, `rs_buf_len`, `rs_draw_image(dst, src, dx, dy, dw, dh)`
  (integer nearest-neighbour, no float at all). The voxel primitive writes
  into `cv(canvas).px` the same way. **A per-pixel depth buffer for §4.3
  sprites has to live somewhere**: the plan says "inside the canvas struct",
  which means one new `Vec<f32>` field on `Canvas`, allocated in
  `rs_new_canvas` — sized `dw*dh`, so zero per-call allocation. Decide that
  in T1, not T6, or `rs_voxel_view` gets rewritten.
- `crates/rasterizer/src/three.rs` header: the determinism rules verbatim
  (IEEE add/mul/div/sqrt only, `ksin`/`kcos` fdlibm kernels, all buffers
  allocated at canvas creation, zero per-frame heap, golden hashes pinned by
  unit tests). §4.2's quarter-turn yaw needs **no** trig, so `ksin/kcos` are
  only a fallback if free yaw ever appears.
- `native/runtime/p5.cpp`: `createBitmap(w,h) → rs_new_canvas(w,h,w,h)` (1:1
  device scale on purpose — texture data must keep its texel grid),
  `loadBitmap(h, data, len) → rs_load_rgba`, `image(src,x,y,w,h) →
  rs_draw_image` scaled by `_devSx/_devSy`. `p5.hpp` declares them at lines
  135/137. `voxelView(...)` copies this shape exactly.
- `craftax_classic/src/80_render.js`: 63×49 map region + 63×14 inventory
  region, each a `Float32Array` composed in JS then `_upload()`ed (truncate to
  uint8, `loadBitmap`, `image`). The FP variant keeps `_invPx` / `_putIcon` /
  `_putDigit` / `INV_SLOTS` **unchanged** so §4.5 rows 49–62 stay
  byte-identical to classic; only the map region is replaced. The dusk pass
  (`ENHANCE=F(0.4)`, `ENHANCE_INV=F(1-0.4)`, `LUM_R/G/B`, `NIGHT_TINT=[0,16,64]`,
  `SLEEP_TINT=[0,0,16]`, static via `threefryUniformF32` when
  `daylight < 0.5 && _nightKey !== null`) is the exact op order T6 must port
  to `rs_dusk`. Note the sleep pass is a *separate* pass after dusk.
- `craftax_classic/src/90_playtrain.js`: `CANVAS_SIZE = 64` (and the long
  comment on why 63 fails — every harness fixes obs at 64), `draw()` =
  `stepGame` → `nightTick()` → `renderGame`, `setDriverSeed` / `nightTick` /
  `getStateRng`, `currentAction()` keymap, `resetGame`, `getObservation()` →
  `computeSymbolicObs`. `90_playtrain_fp.js` is this file with `renderGame`
  pointing at the FP renderer; everything else copies verbatim.
- Classic `README.md` / `PLAN.md` §1–4: the parity claim, the two reference
  quirks (lava never generates; the dead sand upper bound), the
  V8-`ieee754` binding for `cosf`/`sinf`, and the one-NOOP-at-reset
  convention (`GameEnv.reset()` steps once before the first `env.step()`) —
  which matters to T4 if it ever compares through `GameEnv` rather than by
  stepping the bundle directly.
- Classic `PROGRESS.md`: the ledger shape this file copies, plus two standing
  blockers that are **not** this plan's to fix — 8b (the step wire packs
  `score` as int32, so `validate.py`'s REW check fails for any fractional
  score) and 9b/12 (no engine-tier toolchain / no clean cluster checkout of
  this branch). T7 will meet the second one.

**Still unknown, to settle inside the task that needs it.**

- The solid-block set (§4.1) must be *derived* from `40_player.js` movement
  rules, not guessed — T3's job, before the grid packer is written.
- `SKY_RGB` is unchosen; T1 picks it from the Craftax palette and documents it.
- Whether `tools/bundle_multifile.py` accepts `../../parity/craftax_classic/src/…`
  without a containment check (plan §5 says confirm at ~line 76) — T3.

## T1 findings (the ABI T2 binds, and why it looks like this)

**Gate.** `cargo test --release` in `crates/rasterizer` → `13 passed; 0
failed; 2 ignored` (the two ignored are the benches). Cross-target:

```sh
VOXEL_SCENES_OUT=/tmp/voxel.jsonl cargo test --release
PATH=~/.cargo/bin:$PATH cargo build --release --target wasm32-unknown-unknown
node tests/wasm_voxel_check.mjs /tmp/voxel.jsonl \
     target/wasm32-unknown-unknown/release/playtrain_rasterizer.wasm
```

→ `PASS` on all six scenes, native hash == wasm hash byte for byte.

**Measured: 44.87 µs/frame** (`cargo test --release bench_voxel -- --ignored
--nocapture`), 64×49 rays, the `corridor` scene, arm64 Mac. Plan §8 budgets
"dynamics ~78 µs + render ≲ 40 µs" for ≥ 8k SPS; 78 + 45 = 123 µs ≈ **8.1k
SPS**, so this lands on target with no margin. Do not treat that as the
number — `qjs_host` adds the JS-side grid pack and the inventory strip. T7
measures for real. If T7 comes in low, the corridor scene is a near-worst
case (side-face hits every ray) and the profile knob is the DDA step count,
not the JS.

**Frame layout already exercised.** The goldens render into dst rect
`(0, 0, 64, 49)` of a 64×64 canvas — plan §4.5's map region exactly — and a
test asserts rows 49+ are left untouched, so T3 can drop the inventory strip
under it without the primitive scribbling on it.

**The ABI T2 has to bind (three exports, not one).**

```
rs_voxel_view(canvas, grid, gw, gh, eye_x, eye_y, eye_z, yaw_q, view_dist,
              atlas, tile_px, n_tiles, sky_rgb, dst_x, dst_y, dst_w, dst_h)
rs_voxel_grid_ptr(cells)  -> *mut u16
rs_voxel_atlas_ptr(bytes) -> *mut u8
```

`rs_voxel_view` is the plan §4.2 signature unchanged. The two `_ptr` exports
are **new and necessary**: the plan's signature takes raw pointers, and JS
cannot manufacture a pointer into wasm linear memory — there is no allocator
export in this crate and adding one is worse. They hand out pointers to
per-env staging buffers that JS writes through, which is exactly what
`raster-wasm.mjs`'s `loadRGBA` already does with `rs_pixels_ptr`. They grow
only when the requested size grows, so the steady state allocates nothing.
Native hosts may ignore them and pass their own buffers straight in. **This
is an addition to the plan's §4.2, not a change** — noted here rather than
editing the plan because the plan's signature is intact.

**Depth buffer: on `Canvas`, not on the voxel state.** Plan §4.3 says "inside
the canvas struct", so `Canvas` gained `pub(crate) depth: Vec<f32>`, appended
last (the codegen-hygiene rule the `ell_cache`/`three` comments in `lib.rs`
record). It is an empty `Vec` until the first `rs_voxel_view` on that canvas,
so every 2D catalog game's canvases cost exactly what they did. Values are
**Euclidean** distance (rays are normalised with one `sqrt`), +inf for sky —
so T6's `rs_voxel_sprite` compares billboard distance directly with no unit
conversion.

**Geometry decisions T3 and T6 inherit.**

- Yaw: `q0` faces −z (row−), `q1` +x, `q2` +z, `q3` −x, right-hand vector
  following from each. Applied as exact swaps/negations, no trig. **T3 must
  map Craftax's `playerDir` (1..4 = left, right, up, down) onto these four,
  reading the direction vectors out of `40_player.js` — do not guess.**
- FOV is 90° both ways, so `tan(45°) = 1` and the ray needs no constant at
  all. Horizon sits at the middle row of the dst rect (pitch fixed 0).
- **Top faces are unreachable from eye height 0.5 and that is correct**: the
  eye is inside the block layer (blocks are y∈[0,1)), so a descending ray
  never crosses y=1. The top-face branch is implemented and exercised only if
  someone raises `EYE_Y` above 1. Do not "fix" its apparent deadness.
- Side-face `u` is flipped by the step sign so opposite faces of a cube are
  not mirror images; `v` runs down from the block top, so texture row 0 is up.
  Floor and top faces both use cell-local (x, z), which is what the top-down
  view already shows.
- `SKY_RGB` is a **parameter**, not a baked constant: Craftax ships no sky
  texture and no palette entry for one. The goldens use `0x87CEEB`. T3 picks
  the game's value and documents it in the variant README.
- Out of grid, past `view_dist`, or over the blocks with nothing in the way →
  sky. Floors exist in every in-bounds cell; out-of-bounds cells have none.

**Determinism notes.** f32 throughout; only `+ - * / sqrt` and compares.
`floor` is a cast plus one compare (`ffloor`), not libm. A zero direction
component uses a literal `1.0e30` in place of +inf so the DDA can never
compute `inf * 0 = NaN`. No `mul_add` anywhere; Rust does not contract.

**Not done here, on purpose.** `runtime/p5/rasterizer.wasm` is **not**
rebuilt in this commit — that is T2's, together with the host bindings, so
the committed artifact and the JS glue that calls it land together.

## T2 findings

**Gate.** `uv run pytest tests/test_voxel.py -q` → `5 passed in 1.20s`. The
five cover the four backends the plan names plus the trajectory gate:
wasm-under-node, the pure-JS port, native-Rust-under-QuickJS, and
`gate_qjs.sh voxel_smoke 200` → `GATE PASS`, `200 steps bit-exact` on each of
seeds 1, 42, 777.

**The pure-JS port was bit-identical to Rust on the first run.** No pixel
differs between `PLAYTRAIN_RASTERIZER=js` and `=wasm`. That is the one result
worth not taking on trust later: the test compares full frames with no
tolerance and reports the first differing pixel with both values, so if a
future edit to either side drifts, it will say exactly where.

**Regression checks.** Repo suite `105 passed, 3 skipped`; craftax_classic
parity suite `117 passed in 120.34s`. The rebuilt `runtime/p5/rasterizer.wasm`
(now `e544f141…`, built by this machine's rustc 1.97.1) changes nothing for
the existing games.

**The game-facing call** — this is what `80_render_fp.js` writes in T3:

```js
voxelView(gridU16, gw, gh, eyeX, eyeY, eyeZ, yawQ, viewDist,
          atlasU8, tilePx, nTiles, skyRgb, dstX, dstY, dstW, dstH)
```

16 positional numeric args, one global, installed in `p5-shim.mjs` and in both
QuickJS hosts' binding tables. `grid` must be a **Uint16Array** and `atlas` a
**Uint8Array** — the native hosts read both typed arrays in place with
`JS_GetTypedArrayBuffer`, so any other array type silently does nothing. The
dst rect is in **device** pixels, unlike `image()`, which scales by
`_devSx/_devSy`: the view is authored at observation resolution, so there is
nothing to scale.

**Where the declaration went, and why.** `rs_voxel_view`'s `extern "C"`
prototype is declared **inside `native/runtime/p5.cpp`**, not in
`native/runtime/raster_abi.h` where every other `rs_*` lives. `raster_abi.h`
is not one of the nine files plan §3 authorises, and a local prototype is the
smallest thing that respects that. If a later task earns the right to touch
that header, moving the declaration there is the tidier home — keep the two
signatures in step either way.

**Both hosts flush before rendering.** `js_voxelView` drains the p5 command
buffer first, exactly as `js_loadBitmap` does, because it writes canvas memory
directly; recorded draws to that canvas must land before the pixels do. It is
**not** added to the `p5cb` record/replay op set — same treatment as
`loadBitmap`, and for the same reason.

**Rebuild order that actually works.** `native/build_qjs.sh` only builds the
rasterizer staticlib **if the `.a` is missing**, so after changing Rust you
must force it or the host links yesterday's code and the gate compares two
stale things:

```sh
cd crates/rasterizer && cargo rustc --release --lib --crate-type staticlib
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/playtrain_rasterizer.wasm ../../runtime/p5/rasterizer.wasm
cd ../../native && bash build_qjs.sh && bash build_qjs_vec.sh
```

(all with `PATH=~/.cargo/bin:$PATH`). T6 changes Rust again and will need the
whole sequence.

**Depth buffer in the JS backends.** `raster.mjs`'s `Context2D` grows a
`this.depth` `Float32Array` lazily on the first `voxelView`, mirroring
`Canvas::depth` in Rust. `raster-wasm.mjs` has no JS-side copy — the depth
lives in wasm memory where `rs_voxel_sprite` will read it. T6 needs a way to
reach it from the JS fallback but not from wasm; plan for that asymmetry.

## T3 findings

**Gate.** `uv run pytest examples/games/multifile/variants/craftax_fp/tests -q`
→ `18 passed in 0.44s`. That covers the plan's three: `bundle_multifile.py
--check` → `ok craftax_fp`, `build-pages.mjs` → `built 1 games`, and the
64×64 frame's distinct-colour count on five seeds (59, 67, 59, 67, 63 — all
over the plan's 50).

**Read the colour count correctly.** The **whole 64×64 frame** clears 50 on
every seed. The first-person region alone runs **20–28**, and that is honest,
not broken: `grass.png` has exactly **three** colours in it, so a player who
spawns in open grass is looking at three greens and a sky. Do not "fix" this,
and do not quote the view-only number as a failure.

**Two gates were mutation-checked, and the first one I wrote was useless.**

- Replacing the yaw table with a constant `[0,0,0,0,0]` **passed** the obvious
  test ("the four move actions give four different frames"). In Craftax a move
  action changes the player's **position** as well as its facing, so the frames
  differ for the wrong reason. Isolating yaw needs the facing changed and
  nothing else, which no action can do.
- So `tests/fp_probe.mjs` exists: it runs the bundle as one script with the six
  rasterizer calls backed by the **real wasm rasterizer** (a stubbed
  `voxelView` would test nothing), then sets `gameState.playerDir` by hand.
  The yaw mutation now fails 1 test; making nothing solid fails 7.
- The solid-set gate counts **non-sky pixels above the horizon**. Only a cube
  can put anything there — floors are all at y=0, below eye height — so
  "everything is floor" reports zero. Measured on seeds 1, 2, 3, 7, 11, 13, 21
  × 4 facings: never zero, range 34–1536. Craftax scatters trees and stone
  densely enough that something is always in view.

**Decisions this task had to make, with the evidence.**

- **Solid set is `isSolid()` from `40_player.js`, minus WATER.** Derived, not
  guessed: `isSolid` is exactly the set that refuses a move, so it is exactly
  the set that should stop a ray. Plan §4.1 carves out water — impassable, but
  drawn as a floor — and that is what shipped. LAVA is not in `isSolid` at all
  (you can walk onto it; it kills you) and Craftax never generates it anyway.
  **Plants ARE cubes**, because `isSolid` includes `BLK_PLANT` and
  `BLK_RIPE_PLANT`. Note plan §4.3 calls them "plants that are not solid" when
  listing sprite candidates — that phrasing disagrees with the code. The code
  won here; **T6 must decide** whether a plant should become a billboard
  instead, and say so.
- **playerDir → yaw is `FP_YAW = [0, 3, 1, 0, 2]`**, read off `DIR_DR`/`DIR_DC`
  in `10_constants.js`: dir 1 left (dc −1) → yaw 3, dir 2 right (dc +1) → yaw
  1, dir 3 up (dr −1) → yaw 0, dir 4 down (dr +1) → yaw 2. Index 0 is
  unreachable and mirrors dir 3 so a corrupt value cannot index off the end.
- **`SKY_RGB = 0x87CEEB`.** Craftax has no sky texture and no palette entry for
  one, so this is a choice and the README must say so.
- **A second atlas, `tools/craftax_atlas_fp.py` → `src/15_atlas_fp.js`.**
  Craftax's assets are 16×16; the classic baker downscales to 7×7 because
  Craftax's agent view uses 7px tiles, and that downscale is parity-critical
  *there*. Here a wall face fills much of the screen, so 7×7 would be a smear.
  The variant ships both: 15_atlas.js still supplies the inventory icons and
  digits, 15_atlas_fp.js the 16×16 blocks and mob tiles. 24 tiles, 24,576 bytes.
- **The field is `st.mapPacked`, not `st.map`** — cost one failed run; the
  packer reads it directly rather than through `mapGet` to avoid 4,096 calls.

**The bundler takes relative paths out of the directory** — plan §5 asked this
to be confirmed, and it is: `build()` does `(root / rel).resolve()` with **no
containment check**, so the 13 classic sources are single-sourced by path.
Nothing was copied.

**`80_render.js` is IN the fp manifest, and `renderGame` is never called.**
The first-person renderer reuses classic's `_invPx`, `_putIcon`, `_putDigit`,
`_upload`, `INV_SLOTS` and buffer sizes, so the inventory helpers are the same
code rather than a copy of it. Only the ~20-line slot loop is duplicated, as
`_fpInventory` — that code is inline in a function the variant must replace,
and extracting it would mean editing craftax_classic, which plan §9 forbids.
**Keep the two in step**; T4 is the natural place to add a gate asserting the
fp inventory rows equal classic's for the same state.

**Full grid repack every frame**, 4,096 cells, one table lookup and one store
each (`FP_PACK`, 17 entries). Plan §5 suggests a dirty flag; correctness first,
and T7 measures whether it is worth the state.

## T4 findings

**Gate, green.** `tests/same_dynamics.cjs` steps both bundles over the whole
corpus in one node process and compares in memory:

```
{ "ok": true, "episodes": 210, "steps": 49061,
  "symbolic_steps": 49061, "chain_steps": 49061, "state_bytes": 6880 }
```

**Zero differing bytes** of the 6,880-byte canonical dump over all 49,061
steps, and zero differing bytes of the 1,345-float symbolic observation.
Reward bits and the done flag match the committed `traces/golden/` chains at
every step. `uv run pytest ... -q` → `6 passed in 5.11s`.

**Mutation-checked.** Adding one line to `isSolid` in the built fp bundle
(making sand impassable) fails the gate with
`corpus/uniform_000.bin seed 0 step 198: canonical state byte 4365 fp 16 vs
classic 32` — the exact episode, step, offset and both values.

**G2 was re-run on this machine**, because T4 only proves fp == classic and
the claim people care about is fp == the C. `reference/build.sh` builds clean
here (`built build/cc_ref`), and
`uv run pytest .../craftax_classic/tests/test_lockstep.py -q` → **`3 passed in
11.93s`**: classic == PufferLib's C, full canonical state, 210 episodes /
49,061 steps. So the chain **fp == classic == C** is measured end to end on
this machine, not inferred from the manifest. `reference/build/` is
gitignored; rebuild it before quoting G2 again.

**The golden chains' hash column cannot be reproduced, and that is the C
driver's problem, not this variant's.** Worth writing down because the next
person will try it and lose an hour.

- `cc_ref_driver.c` computes `h = fnv1a64(buf, nb)` and then
  `fwrite(buf, 1, nb, stdout)` — the same buffer, no re-serialisation between
  them. So the stored hash ought to be FNV-1a of the bytes that follow it.
- It is not. Running `cc_ref run 0 traces/corpus/uniform_000.bin
  --dump-every 1` directly: step 1 stores **`8400bbda888c0c14`** and dumps a
  state whose FNV-1a is **`0e925c8efd402f7a`**. That holds for all 201 steps
  of the episode, and for every prefix length of the dump (checked
  exhaustively, 0..6880), and for FNV-1 and a signed-char variant.
- The JS `fnv1a64` in `common/parity.js` is **correct** — it reproduces the
  standard vectors (`""`, `"a"`, `"foobar"`) and a BigInt reference — and the
  JS dump hashes to `0e925c8efd402f7a`, i.e. **the JS dump is byte-identical
  to the C's dumped state**. Nothing is wrong with the port.
- So T4 compares the chains' **reward bits and done flag** (both match, all
  49,061 steps) and not the hash column. Gating on that column would mean
  gating on a reference-driver quirk. Recorded here rather than "fixed":
  investigating it belongs with the classic port, not this plan.

**The inventory strip is gated now**, closing T3's open item. `rows 49..62,
cols 0..62` of the fp frame are compared pixel for pixel against
craftax_classic's over a 64-step trajectory that moves the inventory, plus a
companion test asserting the strip is not blank and does change — the equality
test alone would pass on two blank strips. This is what keeps the duplicated
slot loop honest.

**Note for T5 and after:** the corpus driver runs in ~5 s, so it is cheap to
re-run after any change to the fp sources. Do that before trusting a pixel
gate; a dynamics divergence would otherwise show up as a confusing image diff.

## T5 findings

**Gate, green first run.**

```
PASS craftax_fp seed=1 (3000 steps bit-exact)
PASS craftax_fp seed=42 (3000 steps bit-exact)
PASS craftax_fp seed=777 (3000 steps bit-exact)
GATE PASS: craftax_fp
```

Invocation (the sidecar's action table must be passed explicitly to
`qjs_host`; the node side reads it from the sidecar itself):

```sh
cd native
FPD=../examples/games/multifile/variants/craftax_fp/dist
PLAYTRAIN_GAMES_DIR=$FPD \
PLAYTRAIN_QJS_ACTIONS="$(jq -c .actions $FPD/craftax_fp.json)" \
  ./gate_qjs.sh craftax_fp 3000
```

This is the strongest cross-target evidence for the voxel primitive so far:
3,000 steps × 3 seeds of a real trajectory, with the observation hash compared
every step, where QuickJS runs the Rust compiled **natively** and V8 runs the
same Rust compiled to **wasm32**. T1's six golden scenes pinned that equality
on hand-built grids; this pins it on 9,000 frames of actual Craftax worlds.

**`uv run pytest .../craftax_fp/tests/test_engines_fp.py -q` → `8 passed in
8.56s`.** Beyond the gate itself:

- **Symbolic mode still agrees** across engines (600 steps × 3 seeds), and the
  companion test proves it is not silently falling back to pixels — the
  symbolic obshash must differ from the pixel one.
- **The vectorised host matches the single env frame for frame.** This is the
  sharp end of "rasterizer state is per-env": the voxel primitive keeps a depth
  buffer on the canvas and grid/atlas staging on the per-env `RState`, and if
  either leaked between envs, two envs in one process would not reproduce one
  env in its own process. They do.
- **Anti-vacuity is specific to this variant:** fp and classic share a seed and
  have identical dynamics (T4), so the only thing that can make their
  observation hashes differ is the renderer. The test asserts they differ —
  a craftax_fp that somehow rendered the top-down frame would pass the
  differential gate happily but fails this.

**What T5 does not do, deliberately.** There is no forced-divergence mutation
check here. Making the two engines genuinely disagree would mean breaking the
Rust and rebuilding both hosts, and `gate_qjs.sh` is the repo's established
differential gate with its own history of catching exactly this. The vacuity
risk that *is* specific to craftax_fp — a green gate over the wrong frame — is
covered by the test above.

## T6a findings

**T6 was split.** Sprites (this row) and the dusk/night pass (T6b) are
independent, and the plan's gate for T6 mixes both. T6a is done; T6b is the
dusk half and still carries the "a night frame differs from its daylight twin"
requirement.

**Gates, all green after the change:** `cargo test --release` `22 passed`;
`wasm_voxel_check.mjs` `PASS` on **7** scenes (the new `sprites` scene
included), native hash == wasm hash; `tests/test_voxel.py` `5 passed` with
billboards now in the smoke game, so all four backends including the pure-JS
port are compared with sprites in frame; fp suite `32 passed`; T5's
`gate_qjs.sh craftax_fp 3000` `8 passed`. Repo suite `106 passed, 3 skipped`;
classic parity suite `117 passed`.

**Measured: 49.08 µs/frame** (was 44.87 before sprites, same corridor scene —
the scene has no sprites, so the delta is noise, not the sprite pass).

**A real bug, found by asking why a mob three cells ahead drew nothing.**

`rs_voxel_view` stored **Euclidean** distance along the ray; `rs_voxel_sprite`
naturally computes a billboard's **forward** distance (camera-space z). Those
differ by the ray's length, up to sqrt(3) at a frame corner with a 90° FOV in
both axes. Comparing one against the other let a sprite draw **through a wall**
near the edges of the frame: the wall's stored Euclidean depth can exceed the
sprite's forward depth even when the wall is genuinely in front.

Fixed by storing `t_hit / len` — the forward distance — in the depth buffer.
`view_dist` is still compared against Euclidean t, so the draw distance stays a
circle instead of becoming a slab. Mirrored in `raster.mjs`.

Two tests pin it, and both fail if the line is reverted:
- `wall_depth_is_constant_across_a_flat_wall` — a wall row perpendicular to the
  view is the same forward distance at every pixel, so its stored depth must be
  flat. Under Euclidean it fans out **4.504 .. 6.325**. The assertion is on the
  *shape* of the error (`hi/lo < 1.0001`), not a bit compare, because `t / len`
  rounds and the constant comes out as 4.4999995 on some pixels; a 1-ULP spread
  and a 1.4x spread are five orders of magnitude apart, so the test still
  discriminates. Cross-backend bit-exactness is a separate gate.
- `a_sprite_behind_a_wall_is_occluded_off_axis`.

**The original symptom was not a bug.** A zombie 3+ cells ahead in seed 1
really is behind a tree. `sprite_falloff_is_smooth_in_an_open_field` exists so
the next person can tell the two cases apart without spending an hour:
800, 208, 90, 56, 30, 30, 12, 12 pixels at forward distances 1..8.

**Game wiring.** `_fpSprites` reads the mob **arrays** (`zombieMask`/`R`/`C`
etc.), not the per-row bitmaps `80_render.js` scans — a billboard needs the
entity's actual cell, and the arrays are short (3 zombies, 3 cows, 2 skeletons,
3 arrows), so it is at most 11 calls a frame with no search. Craftax's draw
order is kept but does not matter: the depth buffer decides what is in front.
**The player is deliberately not drawn** — you are the player.

**Plants stay cubes.** `isSolid` includes `BLK_PLANT` and `BLK_RIPE_PLANT`, so
the plan §4.3 aside about "plants that are not solid" does not match the code
it points at. A plant you cannot walk through reads better as a block. T3
flagged this for T6; it is decided.

**`tests/fp_probe.mjs --mob <dRow> <dCol>`** injects a zombie at an offset from
the player and reports the pixels it changed, rendering once with every mob
mask cleared as the baseline. Mobs are rare and never where a test wants them,
so this is the only way to gate the billboard pass through the game's own
renderer. Three tests use it.

**zsh does not word-split unquoted variables.** `for off in "-2 0"; do node ...
--mob $off ...` passes ONE argument in zsh and two in bash. Use `bash -c` for
loops like that; it cost a confusing "usage:" error.

## T6b findings

**Gates.** `cargo test --release` `29 passed`; `wasm_voxel_check.mjs` `PASS`
on **8** scenes (new: `night_static`, which runs dusk + static + sleep in one
frame), native hash == wasm hash; `tests/test_voxel.py` `5 passed` with the
smoke game now cycling daylight / static / sleep every 32 frames, so all four
backends are compared through the dusk pass **including the pure-JS threefry**;
fp suite `37 passed`; T5 `8 passed`. Repo suite `106 passed, 3 skipped`;
classic parity `117 passed`. **49.09 µs/frame** (unchanged — the bench scene is
full daylight, where dusk returns immediately).

**The plan's §4.4 cited a fixture that does not exist, and the plan is now
corrected in the same commit** (the loop's rule for a gate proving the plan
wrong). It said to validate the Rust threefry "against `jax_uniform.json` the
same way the JS was". There is no `jax_uniform.json` anywhere in the repo, and
that is not how the JS was validated either: `16_threefry.js` is checked by
`craftax_classic/tests/test_render.py`, which renders whole **night frames**
and compares them byte for byte with Craftax's own `render_craftax_pixels`
output in `traces/craftax_pixels/` — at least 8 night frames, each carrying the
driver seed Craftax was run with. The static is inside those pixels, so that
test is the ground truth. The Rust port is pinned to the JS with a vector
printed from `threefryUniformF32` itself (4 keys × 8 elements, compared as
float **bits**), making the chain **Rust == JS == Craftax**. It matched first
run.

**The night gate, and why it is not vacuous.** `fp_probe.mjs --night
[driverSeed]` walks forward until `light_level < 0.5` (147 steps on seed 1,
light 0.4946), renders, then renders **the same state** with `light_level`
forced to 1.0 — where the dusk pass is a no-op — and diffs. Comparing two
different states would prove nothing; one state at two light levels isolates
the pass. Result: **3136 of 3136 pixels differ**. The static is checked
separately by frame hash: no driver seed `5292e4b8`, seed 7 `c0d9fa82`, seed 99
`e11ea595` — all three distinct, so the static both fires and depends on the
key. With no driver seed there is no key and the static is skipped, which is
what every host does today.

**A test of mine was wrong and the dusk pass exposed it.**
`test_sky_is_above_the_horizon_and_world_below` asserted the sky equals raw
`SKY_RGB`. It does not, and never did after T6b: Craftax's `light_level` at the
**reset** frame is about **0.81**, not 1.0, and the dusk pass runs at any
daylight below 1 — not just at night. The test now asserts the sky band is
**flat** (one colour, since nothing is drawn there), that the ground differs,
and that the sky is `SKY_RGB` darkened rather than something unrelated. Worth
remembering when reading any fp frame: **there is no untinted frame in normal
play.**

**New export `rs_voxel_noise_ptr`,** a third staging buffer alongside grid and
atlas, for the same reason: JS cannot make a pointer into wasm linear memory.

**A second night-noise texture is baked,** `NIGHT_NOISE_FP_*` in
`15_atlas_fp.js`, at **49×64**. The classic one is 49×63 because that is the
classic map region; the first-person view is one column wider. Same numpy
expression, evaluated at the new size. Baked rather than computed at runtime
for the classic port's reason: `Math.exp` is QuickJS's libm in one engine and
ieee754's in another, and only sin/cos are pinned across PlayTrain's engines.

**Composition order** is `voxelView` → `voxelSprite` → `voxelDusk` →
inventory, matching `80_render.js`: Craftax darkens the composited world with
its mobs in it, and the inventory strip is drawn afterwards and never darkened.
The sleep tint is a **separate second pass inside `rs_dusk`**, after the dusk
blend, as in classic.

**Not Craftax-exact, by construction and on purpose.** Craftax composites into
a float32 buffer that stays float for the whole frame; `rs_dusk` reads and
writes the uint8 canvas, so each pass quantises at its boundary. The
first-person frame has nothing to be exact against, so the simpler thing is the
right thing. What must hold — and is gated — is that every backend agrees.

**T6 is now complete** (T6a sprites + T6b dusk). Next is T7, throughput.

## T7a findings

**The headline, with its baseline beside it.** QuickJS (the native host, no
JIT): **craftax_fp 5,935 SPS vs craftax_classic 397 SPS — 14.9×**, both from
`qjs_host bench 1 20000` on this Mac. That is what the variant exists for.

**Under V8 the two are a wash, and that is the honest result.** fp 11,020 SPS
vs classic 10,962 in pixel mode, ~14 µs of render each. V8 JITs classic's
per-pixel float loops down to roughly the cost of the wasm raycast, so the
first-person render is a large win exactly where there is no JIT and neutral
where there is one. Do not quote the QuickJS speedup without this beside it.

**`tests/envprof.mjs` is new** (the plan names `envprof` but no such file
existed). It drives the node `GameEnv` in-process — Python's `PlayTrainEnv`
adds an IPC round trip per step that would swamp what is being measured — and
reports three columns per game: pixel, symbolic, and **dynamics only**
(stepping the bundle's own `stepGame` with no host, observation or renderer).
That third column matters: `symbolic` is NOT no-draw, it still computes the
1,345-float vector. Dynamics alone are **1.6 µs/step** under V8; the gap up to
77 µs is host and observation overhead, not the game.

**Where the QuickJS step went, before and after (µs):** dynamics 69.1 → 69.1,
grid repack **108.7 → ~12**, inventory strip **109.9 → ~5**, `voxelView` 60.6,
`voxelDusk` 13.1; total **345.9 → 168.5**. Measured by disabling one stage at a
time in a scratch copy of the bundle.

**Two fixes, both of which plan §5 or the profile asked for.**

1. **The grid repack now covers a 21×21 window around the player**, not all
   4,096 cells. Plan §5 deferred this to T7 to decide; the profile says it was
   a third of the whole step. It is **exact, not an approximation**: rays
   terminate at `FP_VIEW_DIST` (9.0) and sprites are skipped past it, so
   nothing outside a radius-10 window can be sampled. Cells outside keep stale
   values that nothing reads.
2. **The inventory strip is recomposed only when one of its 20 counts
   changes.** The blit still happens every frame — `background()` clears the
   canvas — but `loadBitmap` and the 2,646-float clear are what cost.

Frames are **bit-identical before and after**: checked by hashing all four
facings and both night frames against the pre-change bundle from `git show
HEAD:`. All 37 fp tests and the repo suite stay green.

**A third fix, in `raster-wasm.mjs`: the atlas was re-copied into wasm memory
on every call**, including once per sprite — about 300 KB a frame for a 24 KB
atlas across one view call and up to eleven sprite calls. It is now staged
once and keyed by array identity (the native hosts never copy at all; they
read the caller's memory). Worth ~0.5 µs/step under V8, but it was making the
wasm backend look worse than it is and would have been much worse on a bigger
atlas.

**A test of mine had been passing for the wrong reason since T6b, and this
task caught it.** `test_solid_blocks_are_actually_cubes` counted pixels above
the horizon that differ from the raw `SKY_RGB` constant. From T6b the dusk
pass tints the sky at any `light_level` below 1 — and the reset frame sits at
about 0.81 — so **every** above-horizon pixel differed and the count was always
1536, whatever the grid contained. It now counts **distinct colours** above the
horizon: an all-floor world shows exactly one (the sky), any block in view
shows more. Re-mutation-checked: making nothing solid now fails 7 tests again.
The lesson is the general one — a metric written against a constant stops
measuring when the pipeline starts transforming that constant.

**The plan's ≥8k SPS target is NOT met, and the budget was optimistic about
the render, not wrong about the approach.** §8 assumed dynamics ~78 µs +
render ≲40 µs. Dynamics are 69 µs and the *native* render is 74 µs
(`voxelView` 61 + `voxelDusk` 13), so the floor is ~143 µs ≈ 7.0k SPS before
any JS at all. At 168.5 µs we are 26% short of 8k and ~15% above that floor.
Closing the rest would mean making the raycast itself cheaper (fewer DDA steps
or a coarser view distance), which is a spec change, not an optimisation.

**T7b is blocked, not skipped.** The cluster half needs a checkout of this
branch on FASRC and there is none — `main` at `29e1e7f`, 69 dirty files, no
`variants/` directory. `release` is 75 commits unpushed and the classic
PROGRESS records that pushing it is the user's call. Nothing was pushed and
the live tree was not touched.

## T8 findings

**Built and gated; the page needs eyes.** Instructions are in the variant
`README.md` under "Playing it in the browser (hand-off)": build with
`tools/build-pages.mjs`, serve with `uv run python -m http.server`. `dist/` is
gitignored, so it is built fresh each time (about a second).

**The page runs the PURE-JS rasterizer, not wasm.** `tools/play-templates.mjs`
inlines `rasterizer.wasm` only for games whose source matches `/\bWEBGL\b/`,
and craftax_fp does not — it calls `voxelView`/`voxelSprite`/`voxelDusk`. This
is safe: the JS port is bit-identical to the Rust, gated by
`tests/test_voxel.py` and verified again **for this game specifically** over 41
frames through `PLAYTRAIN_RASTERIZER=js` vs `=wasm` (identical, including the
dusk pass). So what the human sees IS the training frame. It is the slow path,
but at 8 steps/s there is enormous headroom.

Widening that `WEBGL` test to cover voxel games would let the page use the real
Rust. It touches `tools/play-templates.mjs`, which affects **every** game's
page, so it was left alone — a note, not a change. If it is ever done, the gate
is that all 38 catalog pages still build unchanged.

`test_the_play_page_builds` now asserts the page carries the JS bodies of all
three voxel functions and the sidecar's `1000 / 8` pacing, because a page
missing either is a blank canvas and a console error for the human.

**What the human CANNOT check, stated plainly in the README rather than left as
a trap:** the **night static is not visible in the browser**. Craftax draws it
from `state_rng`, derived from the *driver's* seed, and no host — this page
included — passes one. Below `light_level` 0.5 the page shows the
deterministic dusk image without the static. The plan's T8 row lists "night
static present with driver seed" as something to check; it is not checkable
through any host today, so it is gated in `tests/test_render_fp.py` instead
(three driver seeds, three distinct frames) and the README says so.

**The five things that ARE worth a human's eyes**, in the README: facing
centred on the interact cell (face a tree, press SPACE, the block you chop
should be the middle of the screen); the inventory strip identical to
craftax_classic's side by side; walls with a visible top edge that grow and
shrink correctly and do not swim; mobs upright at cell centres and occluded by
solid blocks; and the day/night cycle around step 150, plus TAB to sleep.

**Nothing was simulated.** No browser session was run or reported.

## T9 findings

**The variant README is now the document to read**, in this order: the frame
layout (with a diagram), world geometry and the derived solid set, why the
controls are absolute, **what is exact and what is not**, the gates and how to
run them, the browser hand-off, and throughput.

**No new assets, so `THIRD_PARTY_LICENSES.md` needed only an amendment.** The
first-person atlas bakes **the same vendored Craftax PNGs** as the classic
port; `tools/craftax_atlas_fp.py` differs only in keeping the authored 16×16
resolution instead of downscaling to 7×7. Same provenance, same MIT licence,
same "baked in, nothing loaded at runtime". Both the table row and the Craftax
section say so now.

**One claim in the README intro was wrong and is fixed.** It said the frame is
"wasm under V8 and in the browser". The browser runs the **pure-JS** port (T8),
so it now reads: native under QuickJS, wasm32 under V8, a hand port in JS for
the browser, all three producing the same bytes and gated rather than asserted.

**A Gates section was added** with the exact commands, a table of what each
gate holds, and the rebuild order after any Rust change — that last one
because `native/build_qjs.sh` only builds the staticlib if the `.a` is
missing, which silently compares stale code against stale code.

**Memory note written** for the next agent at
`~/.claude/projects/.../memory/craftax-fp-variant.md`, indexed in `MEMORY.md`:
what is measured, the V8-is-a-wash caveat that must travel with the 14.9×
number, the blocked cluster run, and the six traps that cost time here.

## T10 (post-plan, user-requested): look, and the vectorised-host plateau

Not in the plan's §7; asked for after T9. Commits `b810694` (look) and
`b378e8f` (plateau).

**Three additions to `rs_voxel_view`, all literals in `voxel.rs`, so no ABI
change and no re-binding:**

- **Face shading** — `SHADE_X = 0.62` for x-normal faces, `SHADE_Z = 0.80` for
  z-normal, `1.0` for block tops and floors. This was the real fix: Craftax has
  no side-face art, so a cube was the same texture at the same brightness on
  every visible face and two faces meeting at an edge were indistinguishable.
  A stone wall read as a field of noise rather than as blocks.
- **Distance fog** — starts at `0.55 * view_dist`, full at `view_dist`, blending
  toward the sky. The world used to end in a hard circle.
- **Sky gradient** — zenith at `0.66` of the sky colour, horizon at the sky
  colour.

Sprites gained fog too (so a far mob fades with the terrain rather than staying
crisp and popping), which required **one new argument, `sky_rgb`**, on
`rs_voxel_sprite` — the only ABI change, threaded through both hosts, the shim
and both JS backends. Face shading is deliberately NOT applied to sprites: a
billboard always faces the eye, so it has no face to shade.

**Cost: 5,935 → 5,315 SPS** under QuickJS, about 20 µs a step, still 13.4×
classic. All gates re-run green, goldens re-pinned (all 8 changed, as expected),
native == wasm on all 8, four backends still agree, dynamics untouched.

**Three of my own tests asserted a flat sky and broke** — `test_voxel.py`'s
smoke check, the fp `test_sky_is_above_the_horizon_and_world_below`, and the
Rust `open_field_is_floor_below_sky_above`. All three now assert the gradient's
SHAPE (flat across each row, brightening downward, never brighter than
`SKY_RGB`) instead of equality with a constant. **That is the third time a
test written against `SKY_RGB` has gone wrong as the pipeline grew** — first
vacuous after the dusk pass in T6b, now broken by the gradient. The lesson is
worth keeping: do not assert against a constant that later stages transform.

**The vectorised-host plateau, profiled.** Worker threads are
`min(num_envs, P-cores)` = 4 here. Throughput saturates at ~18.5k SPS from
**two** envs upward even though four cores are busy at four envs — per-core
throughput halves between 2 and 4.

The discriminating experiment: **four separate processes with one env each
total 33,522 SPS** (9442 + 8736 + 7793 + 7551); one process with four envs gets
**18,493**. So the cap is **intra-process**, and the vectorised host reaches
about 55% of what the same cores deliver across processes. Likely the per-step
spin barrier (it waits for the slowest shard, and Python dispatches every step)
plus shared-cache pressure from four ~64 KB per-env working sets on the M4's
single P-core cluster — the same family as the glibc arena convoys that hit the
async AOT host, fixed there by env pinning.

**Not fixed:** that means changing `native/qjs/qjs_vec_host.cpp`, which this
plan authorises only for the voxel bindings. Recorded in `bench.json` and the
README for whoever picks it up; ~1.8× is on the table.

**Open, and the obvious next visual lever:** every block is exactly 1 unit
tall, so from an eye at y=0.5 a block three cells away subtends about 7° and
the world reads as a flat plain with pebbles on it rather than somewhere you
are standing. Giving blocks a height greater than 1 — or a per-block-type
height, trees taller than stone — is a render-only change (the grid is 2D and
the dynamics never see it) and would do more for the look than all three
changes above combined. Not done; not asked for.

## T11 (post-plan, user-requested): smooth display camera; fog reverted

Commit `d283759`.

**Distance fog reverted** at the user's request. Face shading and the sky
gradient stay — shading was the change that actually made cubes legible. The
`sky_rgb` argument that `rs_voxel_sprite` had grown purely to fog billboards
was removed again, so that ABI is back to the plan's shape.

**Smooth camera, display only.** The play page already ran a 60fps
`requestAnimationFrame` loop and skipped the game step between ticks; those
spare frames now call `renderInterpolated(alpha)` if the game defines it, with
alpha running 0→1 across the gap. The camera eases from its pre-step pose to
its current one. Yaw is unwrapped to the nearest branch first, so west→east
sweeps through north instead of spinning 270° the wrong way.

**The training path is untouched and that is gated, not asserted.** `draw()`
still renders the snapped frame once per step. The new test asserts (a) the
five sampled alphas give five DIFFERENT frames, so something is actually
interpolating, and (b) **alpha=1 is byte-identical to the frame `draw()`
produces**, so the animation ends in the state the game is really in.

**How free yaw was added without disturbing the goldens.** New entry points
`rs_voxel_view_free` / `rs_voxel_sprite_free` take a yaw in radians and derive
the camera basis with the rasterizer's own `psin`/`pcos` — the pair
`raster.mjs` already mirrors exactly as `_rsin`/`_rcos`, so wasm and pure-JS
still agree. The quarter-turn entry points keep their exact 0/±1 basis.

The refactor that made this possible — pulling the four hard-coded direction
cases out into a `(fwd, rgt)` basis — was **proved bit-identical before being
kept**: with fog removed, hashes were dumped with the basis version and with
the original `match` restored, and the two files were identical. Worth
repeating that method; "it should be exact because multiplying by 1.0 is
exact" is an argument, not evidence.

**Page hook is opt-in per game.** `tools/play-templates.mjs` calls
`renderInterpolated` only when the game defines it. Verified all **38 catalog
pages still build**, and `tests/test_website.py` is green, because that file is
shared by every game's page.

**Cost: 5,285 SPS** (from 5,935 before any look work). Reverting fog did *not*
recover the difference — the free-yaw basis refactor costs about what fog did.
Still 13.3× classic.

All gates re-run green: fp suite `38 passed`, cross-engine `8 passed`, repo
`106 passed, 3 skipped`, `cargo test --release` `29 passed`, wasm check PASS on
all 8 scenes, dynamics untouched.

## Final state

**T0–T9 complete except T7b (cluster throughput), which is blocked.**

Everything the plan asked for is built and gated on this machine:

| claim | evidence |
|---|---|
| dynamics unchanged | 210 episodes / 49,061 steps, **zero differing bytes** of the 6,880-byte state and of the symbolic obs |
| fp == classic == PufferLib's C | the above, plus G2 re-run here (`3 passed`) |
| every engine agrees | `GATE PASS: craftax_fp`, 3000 steps × 3 seeds bit-exact |
| native == wasm32 | 8 golden scenes, hash for hash |
| all four backends agree | `tests/test_voxel.py`, `5 passed` |
| inventory identical to classic | pixel-for-pixel over a trajectory that moves it |
| throughput | QuickJS **5,935 vs 397 SPS = 14.9×**; V8 a wash (~11k both) |

**The two things a reader must not lose:**

1. The 14.9× is a **QuickJS** number. Under V8 the two games are the same
   speed, because V8 JITs classic's per-pixel loops down to the wasm raycast's
   cost. The win is real and it is where PlayTrain's native host runs, but it
   is not a universal win.
2. The plan's ≥8k SPS target is **not met** (5,935). Dynamics 69 µs + native
   render 74 µs is a ~143 µs floor before any JS, so the budget was optimistic
   about the render. Closing it means a cheaper raycast — fewer DDA steps or a
   shorter view distance — which is a spec change, not an optimisation.

**What is left for a human:** open the play page and look at it (T8, five
checks listed in the variant README), and decide whether to push `release` so
the cluster run (T7b) can happen.

## Log

Newest first. One line per iteration: date, task, what happened.

- 2026-09-15 — T9 — wrote the variant README in full (frame diagram, world
  geometry, absolute-controls caveat, exact/not-exact, gates + rebuild order,
  throughput), amended `THIRD_PARTY_LICENSES.md` for the second atlas baker
  (no new assets), fixed a wrong claim in the README intro about the browser
  using wasm, and left a memory note for the next agent. Full gate sweep green.
  Commit `7fc20bc`. **T0–T9 complete except T7b, blocked.**
- 2026-09-15 — T8 — built the play page and gated its prerequisites: it
  carries the JS voxel port and the 8 steps/s pacing. Verified the pure-JS
  backend (which is what the browser runs, since the page does not inline
  wasm) renders craftax_fp identically to wasm over 41 frames. Wrote the
  hand-off note in the README with the five things to check by eye and the one
  thing — the night static — that no host can show. Commit `67f30f3`.
- 2026-09-15 — T7a — benched fp vs classic on the Mac: QuickJS 5,935 vs 397
  SPS (14.9×), V8 a wash at ~11k both. Wrote `tests/envprof.mjs` with a
  dynamics-only column. Profiled the QuickJS step and cut it 346 → 168 µs by
  windowing the grid repack (plan §5's open question) and caching the
  inventory composition, both verified frame-identical; also stopped
  `raster-wasm.mjs` re-copying the atlas per call. Found that
  `test_solid_blocks_are_actually_cubes` had been vacuous since T6b and fixed
  the metric. Target ≥8k not met and the shortfall is explained. T7b (cluster)
  blocked: no checkout of this branch on FASRC. Commit `a657e02`.
- 2026-09-15 — T6b — added `rs_dusk` (Craftax's dusk blend, the threefry night
  static, and the sleep tint) plus `rs_voxel_noise_ptr`, ported JAX's
  threefry-2x32 to Rust and pinned it to the JS by float bits, baked a 49×64
  night-noise texture, bound it all through both hosts and both JS backends,
  and added an 8th golden scene. Night frame differs from its daylight twin on
  all 3136 pixels and the static tracks the driver seed. Corrected plan §4.4,
  which cited a fixture that does not exist. Commit `9bbc453`.
- 2026-09-15 — T6a — added `rs_voxel_sprite` (upright billboards, depth-tested,
  alpha-blended), bound it through both hosts, the shim and both JS backends,
  extended the goldens to 7 scenes and the smoke game to draw sprites, and
  wired mobs and arrows into the fp renderer. Found that the depth buffer held
  Euclidean distance while sprites compare forward distance — sprites could
  draw through walls near the frame edges — and switched the buffer to forward
  depth, with two tests that catch the regression. 49.08 µs/frame. Commit
  `896b25c`.
- 2026-09-15 — T5 — ran `gate_qjs.sh craftax_fp 3000`: GATE PASS, 3 seeds ×
  3000 steps bit-exact, first run. Wrote `test_engines_fp.py` (8 tests):
  pixel gate, symbolic gate plus its non-vacuity check, an fp-vs-classic
  obshash test so the gate cannot pass on the wrong frame, and vectorised-host
  determinism and equality with the single env. Commit `f70b6d0`.
- 2026-09-15 — T4 — wrote `same_dynamics.cjs` (both bundles in one node
  process, compared in memory) and `test_same_dynamics.py`. 210 episodes,
  49,061 steps, zero differing bytes of state or symbolic obs. Built the C
  driver and re-ran G2 green, so fp == classic == C is measured here. Found
  and documented that the golden chains' hash column is not FNV-1a of the
  state the C dumps — the reward/done columns are compared instead. Added the
  inventory-strip equality gate T3 flagged. Commit `f665b4f`.
- 2026-09-15 — T3 — built `variants/craftax_fp`: manifest single-sourcing the
  13 classic files by relative path, a 16×16 atlas from a new
  `tools/craftax_atlas_fp.py`, `80_render_fp.js` (grid pack, eye/yaw,
  `voxelView`, classic's inventory strip) and `90_playtrain_fp.js`. Bundle and
  play page build; 18 tests pass. Mutation-checked the yaw map and the solid
  set — the first yaw test was useless and was replaced with `fp_probe.mjs`.
  Commit `8c57ca2`.
- 2026-09-15 — T2 — bound `voxelView` into `p5.hpp`/`p5.cpp`, both QuickJS
  hosts, the shim, and both JS rasterizer backends; hand-ported the ray march
  into `raster.mjs` and it matched Rust bit for bit first try; rebuilt the
  wasm artifact and both native hosts. `tests/games/voxel_smoke.js` +
  `tests/test_voxel.py`, 5 passed, `GATE PASS`. Commit `dcfdbf0`.
- 2026-09-15 — T1 — wrote `crates/rasterizer/src/voxel.rs` (`rs_voxel_view`
  + two staging-pointer exports), added `Canvas::depth` and `RState::voxel`,
  six golden scenes with four behavioural tests beside them, and
  `tests/wasm_voxel_check.mjs`. Native == wasm on all six. 44.87 µs/frame.
  Commit `5b5ca36`.
- 2026-09-15 — T0 — read the plan and every source it names; confirmed
  `cargo test --release` green, wasm target builds, native==wasm on the three
  existing 3D goldens, both hosts present. Wrote this ledger. No code changed.
