# Plan: p5 WEBGL mode in the native pipeline (software 3D renderer)

Handoff document, 2026-08-28. Everything in "Verified current state" was checked
by reading the tree at `7654e84` (local branch `continuous-input`). Relationship
to `PLAYTRAIN_3D_PLAN.md`: this is a third architecture option for 3D — extend
the existing Rust rasterizer with a software 3D pipeline so p5-WEBGL games run
through the SAME QuickJS/C++/wasm stack as the 2D games. Unlike the archived
three.js/Dawn path, this keeps every 2D pillar: cross-engine bit-exactness,
envpool-class vectorization, unmodified trainer, and human-play pixel identity.

## Goal

Two tiers. Tier 1 is independently shippable; do not start Tier 2 until Tier 1's
throughput number is measured and reported.

1. **Tier 1 — trainable.** `games/js/seaquest.v3.js` (and a template-conformant
   sibling) steps in `NativeVecEnv` and `PingPongVecEnv` and trains under the
   unmodified IMPALA/PPO trainers. Native only. Est. 1.5–2.5 weeks.
2. **Tier 2 — full pillar parity.** The same renderer compiled to wasm drives
   the Node path and the browser study harness; `gate_qjs.sh` extended with 3D
   golden checks passes cross-engine; a `P5_3D_TEMPLATE.md` + validator exist
   and at least one fresh 3D game is generated end to end. Est. +2–3 weeks.

**Non-goals.** Full p5-WEBGL parity (we implement a declared subset); pixel
parity with browser-GPU p5 (impossible and not needed — humans see OUR
renderer's pixels via the wasm + `putImageData` path, same as 2D); the three.js
dialect (`threejs-archive` games are a different contract); `texture()`,
`text()` in 3D, `ortho()`, `camera()`, stroke rendering in WEBGL mode.

## Why this shape

The 2D architecture is already single-source, multi-target:

- `crates/rasterizer/` (Rust, 719 LoC) — the ONE rasterizer. Cargo.toml:
  "Compiles to wasm32 (in-process, no system deps) and native. Port of
  runtime/p5/raster.mjs; differential-tested against it."
- `native/runtime/p5.cpp` (C++, for the QuickJS hosts) and
  `runtime/p5/p5-shim.mjs` (JS, for Node/browser) are thin forwarders into it.
- Frozen transcendentals live in `native/qjs/v8libm` (vendored fdlibm/openlibm),
  and `native/build_qjs.sh` notes "same source native + wasm".
- The browser study page blits rasterizer output with `putImageData`
  (`tools/study-templates.mjs:437`) — the human already looks at rasterizer
  pixels, not Canvas2D. This is what makes browser pixel-parity FREE once the
  renderer itself is shared.

**Core design decision (make it explicitly, in code review, before task 3):**
ALL 3D state — matrix stack, projection, lights, material state, z-buffer,
tessellation caches — lives INSIDE `crates/rasterizer` behind new `rs_*` ABI
calls. The C++ p5 layer and the JS shim stay thin forwarders, exactly like 2D.
If any 3D math leaks into `p5.cpp` or `p5-shim.mjs`, it must be duplicated in
the other and parity becomes a maintenance treadmill. The alternative (transforms
in the p5 layers) is rejected for that reason.

## Verified current state

- **No WEBGL anywhere today**: zero grep hits for `WEBGL|webgl` in `native/`,
  `runtime/`, `src/playtrain/runtime/`. `createCanvas`'s third argument is
  ignored; `box()` etc. are undefined → ReferenceError on first `draw()`.
- **`games/js/seaquest.v3.js`** (614 lines, committed, last touched in the
  package restructure): p5-WEBGL dialect. Not in `examples/games/js/`, so the
  trainer cannot resolve it by name today.
- **Its exact API surface** (counts from grep — this IS the Tier 1 subset spec):

  | call | uses | | call | uses |
  |---|---|---|---|---|
  | push/pop | 34/27 | | box | 11 |
  | translate | 27 | | cylinder | 6 |
  | fill | 16 | | sphere | 5 |
  | ambientMaterial | 13 | | cone | 3 |
  | rotateZ / rotateY | 8/4 | | specularMaterial | 3 |
  | ambientLight / directionalLight / pointLight | 1/1/1 | | noStroke, background, createCanvas(WEBGL) | 1 each |

  Notably ABSENT: `rotateX`, `camera`, `perspective`, `texture`, `scale`,
  `torus`, `plane`, stroke in 3D. Implement `rotateX` anyway (trivial once
  Y/Z exist); everything else absent stays out of the subset.
- **Input is standard**: `keyIsDown(37/39/38/40)` + `keyIsDown(32)` and it
  already has `getGameState()`/`resetGame(seed)` — the default8 action space
  and the env contract need NOTHING. Verify `keyIsDown(32)` fires under the
  press-key semantics of default8 action 5 (space is a PRESS key: sets
  `keyCode` + calls `keyPressed()`; check whether `keyIsDown(32)` also reads
  true during that step — if not, either the game or the action table needs a
  one-line adjustment; measure, don't assume).
- **Rust rasterizer ABI pattern**: `#[no_mangle] pub extern "C" fn rs_*`,
  per-env state via `rs_state_new/select/free` (the vec hosts select per-env
  state before each step — 3D state must ride the same objects).
- **Recoverable prior art**: `threejs-archive:runtime/three/three-cpu-fast*.mjs`
  — a working CPU 3D design (bake static meshes to world-space tri buffer once,
  per-frame transform, near-clip, tight monomorphic raster loop, vertex colors,
  no lighting). Read it before writing the raster core; port the design, not
  the code.

## Renderer spec (the declared subset)

- **Coordinate convention**: p5 WEBGL mode — origin at canvas CENTER, x right,
  y down, z toward the viewer. This differs from the 2D mode's top-left origin;
  the mode switch happens at `createCanvas(w, h, WEBGL)`.
- **Default camera** (no `camera()`/`perspective()` calls in scope): p5's
  documented default — perspective with fov = PI/3, aspect = w/h,
  eye at z = (h/2) / tan(PI/6), near = 0.1·eyeZ, far = 10·eyeZ. Hard-code it;
  cite the p5 reference in a comment.
- **Primitives**: box(w,h,d), sphere(r), cylinder(r,h), cone(r,h) tessellated
  to triangle lists. Use FIXED detail constants (document them; p5 defaults are
  sphere 24×16, cylinder/cone 24) and CACHE unit-primitive tessellations once
  per state — only the transform varies per call.
- **Transforms**: 4×4 f64 matrix stack; translate/rotateX/Y/Z/push/pop.
  Trig ONLY through the vendored v8libm sin/cos — never libm/std.
- **Shading**: per-vertex N·L Lambert. Final color =
  ambientLight·ambientMaterial + Σ light·diffuse. `specularMaterial` in Tier 1
  may alias to ambientMaterial with a TODO (the game reads fine without
  highlights); if implemented, Blinn-Phong with a fixed shininess. `pointLight`
  = positional diffuse, no attenuation (declare it). `fill()` in WEBGL mode
  acts as the base material color when no material call is active (match what
  the game expects — read its usage per entity before deciding).
- **Raster**: screen-space triangle fill with a per-env f32 z-buffer, integer
  edge functions (deterministic tie-breaking, same top-left rule in one shared
  implementation), near-plane clip only. No perspective-correct interpolation
  needed for flat/per-vertex color at 64×64.
- **Determinism rules** (the whole point):
  - one Rust source, two targets (native cdylib + wasm32) — semantics identical
    by construction for IEEE add/mul/div/sqrt;
  - no `f64::sin` etc. — v8libm only;
  - no FMA: verify the native build does not emit fused ops (Rust does not fuse
    by default; do NOT enable `-C target-cpu=native` style flags for this crate);
  - golden-image tests, not epsilon tests.

## Tasks, in order (each has a gate; stop at a failed gate)

1. **Branch** off `main` (plain branch; nothing parallel to protect). Note the
   local `continuous-input` branch has unpushed commits — do not build on it.
2. **Baseline**: `native/build_qjs.sh`, `native/build_qjs_vec.sh`,
   `native/gate_qjs.sh` all pass UNTOUCHED. Record the 2D golden hashes. If the
   baseline does not build locally, stop and say so (FASRC-only verification
   changes the plan's shape).
3. **Rasterizer crate, 3D module** (`crates/rasterizer/src/three.rs` or
   similar): matrix stack, camera, tessellators, z-buffer raster, lighting.
   Pure-Rust unit tests with golden PNG/hash outputs: one tri, one lit box,
   one full seaquest-like scene composed manually. Gate: `cargo test` both
   native and wasm32 targets produce IDENTICAL buffer hashes.
4. **ABI**: add `rs_3d_begin(w,h)`, `rs_3d_push/pop`, `rs_3d_translate/rotate*`,
   `rs_3d_fill/ambient_material/specular_material`,
   `rs_3d_ambient_light/directional_light/point_light`,
   `rs_3d_box/sphere/cylinder/cone`, `rs_3d_frame_end`. Keep the 2D ABI
   untouched. Per-env state rides `rs_state_new/select` unchanged.
5. **C++ p5 layer + QuickJS hosts**: register the new globals in `p5.cpp`;
   `createCanvas(w,h,'WEBGL')` (and the `WEBGL` constant) flips the state into
   3D mode. BOTH hosts (`qjs_host.cpp`, `qjs_vec_host.cpp`) — they must not
   drift (same rule as the action-space work). Gate: 2D `gate_qjs.sh` still
   passes bit-identically (proves 2D untouched).
6. **Single-env native run**: copy `seaquest.v3.js` into `examples/games/js/`
   ONLY when it passes; drive it via `GameEnv(game=<absolute .js path>)` first
   (the `PLAYTRAIN_GAMES_DIR` trap from `handoff/HANDOFF.md` §3 — the env var
   does NOT reach QuickJSEnv; pass absolute paths). Gate: 2,000-step episode,
   sane obs (not all-black / all-one-color), score moves under scripted play.
7. **Vec + throughput**: `PingPongVecEnv` with 256 envs; measure steps/s per
   core and at the 8-env vec-host config, and REPORT the number before
   proceeding — it decides whether Tier 2 is worth it and what the paper may
   someday claim. Expectation to beat: the archived Dawn path's ~1.7k FPS/env;
   hope: within ~5–20× of comparable 2D games.
8. **Train one agent** (Tier 1 exit): 10–25M steps IMPALA, default8, confirm
   return moves. Deliverable: the curve + the throughput number.
9. **(Tier 2) wasm + Node/browser**: build wasm32 target; extend
   `raster-wasm.mjs`/`p5-shim.mjs` forwarders; study harness needs nothing new
   (it already blits whatever the rasterizer produced).
10. **(Tier 2) determinism gate**: extend `native/gate_qjs.sh` with 3D goldens
    (seaquest.v3 fixed seed, N steps, obs hash) across QuickJS-native and
    V8-wasm. Budget the most slack here — one-ulp hunts live in this task.
11. **(Tier 2) template + validation + generation**: `P5_3D_TEMPLATE.md`
    documenting exactly the subset above; validator extended; port seaquest.v3
    to formal conformance; generate 1–2 fresh 3D games through the normal
    pipeline as the existence proof.

## Hazards (collected from prior handoffs — do not rediscover these)

- `PLAYTRAIN_GAMES_DIR` does not work with `GameEnv`; pass absolute paths.
- Game fixes must land in BOTH `games/js/` and `examples/games/js/` — the
  runtime loads the latter.
- Never `uv sync` against `analogen-jaxbench/.venv` on the cluster.
- Node-to-node clock spread is 1.56×; any published 3D throughput number needs
  the same one-node discipline as everything else.
- The 2D rasterizer is "differential-tested against raster.mjs" — there is NO
  3D raster.mjs to differ against; the golden-image tests in task 3 replace
  that role. Do not skip them.
- `frameCount % N` blink animations broke a vec backend once
  (`train_ppo_clean.py` comment) — if seaquest.v3's `tick` drives visuals,
  fine (it is game state); nothing reads global frameCount, verified? — check
  during task 6.

## Reporting back

The paper (limitations paragraph, `PLAYTRAIN_3D_PLAN.md`, and any future 3D
appendix) needs, from this work, explicitly:

1. the measured single-core and vec steps/s for seaquest.v3;
2. whether cross-engine bit-exactness held for 3D and what it cost to get;
3. the final declared subset (the template is the artifact);
4. whether a fresh 3D game generated end to end with zero pipeline changes;
5. one sentence on what did NOT transfer, honestly.
