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
| T1 | `rs_voxel_view` in new `crates/rasterizer/src/voxel.rs`; 3 golden scenes (open field, corridor, wall at each yaw); `tests/wasm_voxel_check.mjs` | todo | | | Copy the two-part shape at the bottom of `three.rs` (`#[cfg(test)]` goldens + `THREE_SCENES_OUT` dump) and `tests/wasm_three_check.mjs`. Record µs/frame. |
| T2 | Bindings: `p5.hpp/.cpp`, `qjs_host.cpp`, `qjs_vec_host.cpp`, `p5-shim.mjs`, `raster.mjs` (pure-JS fallback, bit-identical), `raster-wasm.mjs`; `tests/games/voxel_smoke.js` + `tests/test_voxel.py` | todo | | | Gate: `uv run pytest tests/test_voxel.py -q`, all three backends hash-equal. Must rebuild + commit `runtime/p5/rasterizer.wasm`. |
| T3 | Game: `examples/games/multifile/variants/craftax_fp/` manifest + `80_render_fp.js` + `90_playtrain_fp.js`; bundle; play page | todo | | | Gate: `bundle_multifile.py --check` clean, `build-pages.mjs` builds, 64×64 frame has > 50 distinct colours. |
| T4 | Dynamics-invariance gate `tests/test_same_dynamics.py` over `traces/corpus/` + `traces/golden.json` | todo | | | Zero differing bytes of the 6,880-byte dump, plus symbolic obs equal. **Any diff = dynamics changed: mark blocked and stop.** |
| T5 | Cross-engine `tests/test_engines_fp.py` → `native/gate_qjs.sh craftax_fp 3000`, seeds 1 42 777 | todo | | | GATE PASS ×3 "bit-exact". Never run two `gate_qjs.sh` at once (fixed `/tmp/gateq_*`). |
| T6 | `rs_voxel_sprite` + `rs_dusk` (§4.4 option A) + night static with driver seed; goldens extended; wasm check; T5 rerun | todo | | | Also: a night frame at `light_level<0.5` must differ from its daylight twin. |
| T7 | Throughput: Mac `qjs_host bench` + V8 `envprof` for fp vs classic; one exclusive cluster job; `outputs/craftax_fp_bench.json` | todo | | | Cluster via `fasrc '<cmd>'`; `-c 64 --exclusive`, `unset OMP_NUM_THREADS`, `uv run --no-sync`. Classic baseline from the same harness beside every fp number. |
| T8 | Hand-off: play page at `dist/craftax-fp-play/`, serve command, what the human checks | todo | | | Hand-off stays a hand-off — do not simulate a human session. |
| T9 | Docs: variant `README.md` (layout diagram, absolute-controls caveat, exactness, throughput), `THIRD_PARTY_LICENSES` if needed, memory note | todo | | | |

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

## Log

Newest first. One line per iteration: date, task, what happened.

- 2026-09-15 — T0 — read the plan and every source it names; confirmed
  `cargo test --release` green, wasm target builds, native==wasm on the three
  existing 3D goldens, both hosts present. Wrote this ledger. No code changed.
