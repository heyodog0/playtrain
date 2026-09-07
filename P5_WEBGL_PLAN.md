# Plan: p5 WEBGL mode in the native pipeline (software 3D renderer)

Handoff document. Written 2026-08-28 against `7654e84` (branch
`continuous-input`); **revised 2026-09-07 against `main` 51365ce**, after the
engine tier (Futamura AOT) merged. Every claim in "Verified current state" was
re-checked at 51365ce on 2026-09-07 unless marked otherwise.

Relationship to `PLAYTRAIN_3D_PLAN.md`: this is a third architecture option for
3D — extend the existing Rust rasterizer with a software 3D pipeline so
p5-WEBGL games run through the SAME QuickJS/C++/wasm stack as the 2D games.
Unlike the archived three.js/Dawn path, this keeps every 2D pillar:
cross-engine bit-exactness, envpool-class vectorization, unmodified trainer,
and human-play pixel identity.

## 0. Start here (fresh agent, no context)

Read in this order, then come back:

1. this file, end to end;
2. `handoff/HANDOFF-2026-09-04-engine-tier-L1.md` §1, §4, §4b — what the AOT
   engine tier is and what a brand-new game gets from it;
3. `handoff/INVESTIGATE-aot-async-regression.md` §0 — the malloc-arena convoy.
   This is the single most likely way a 3D renderer breaks the trainer, and the
   mechanism is rasterizer allocation. Do not skip it;
4. `handoff/HANDOFF.md` §3 — the `PLAYTRAIN_GAMES_DIR` trap.

Then run task 2 (baseline) before writing any code.

**One-paragraph orientation.** The 2D stack is: game JS runs on embedded
QuickJS; p5 drawing calls are C bindings (`native/qjs/qjs_host.cpp` BINDINGS
table) that forward into a Rust rasterizer (`crates/rasterizer`), which
compiles to both native and wasm so QuickJS-native and V8-wasm produce
bit-identical pixels. Since 2026-09-04 there is a fourth thing: each game's
bytecode is optionally AOT-compiled to C (`qjsc -A`, ivankra QuickJS fork) and
built into a per-game `.so`, resolved at env construction by
`src/playtrain/runtime/aot_cache.py`. 3D adds `rs_3d_*` calls to the
rasterizer and new bindings to the hosts. **It does not touch the engine.**

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

(Engine-tier integration is inside these estimates and is ~1 day of it; see §
"Engine tier". It does not change the shape of either tier.)

**Non-goals.** Full p5-WEBGL parity (we implement a declared subset); pixel
parity with browser-GPU p5 (impossible and not needed — humans see OUR
renderer's pixels via the wasm + `putImageData` path, same as 2D); the three.js
dialect (`threejs-archive` games are a different contract); `texture()`,
`text()` in 3D, `ortho()`, `camera()`, stroke rendering in WEBGL mode.

## Why this shape

The 2D architecture is already single-source, multi-target:

- `crates/rasterizer/` (Rust, 796 LoC at 51365ce) — the ONE rasterizer.
  Cargo.toml: "Compiles to wasm32 (in-process, no system deps) and native.
  Port of runtime/p5/raster.mjs; differential-tested against it."
- `native/runtime/p5.cpp` (C++, 412 LoC, for the QuickJS hosts) and
  `runtime/p5/p5-shim.mjs` (JS, for Node/browser) are thin forwarders into it.
- Frozen transcendentals live in `native/qjs/v8libm` (vendored fdlibm/openlibm),
  and `native/build_qjs.sh` notes "same source native + wasm".
- The browser study page blits rasterizer output with `putImageData`
  (`tools/study-templates.mjs:577`) — the human already looks at rasterizer
  pixels, not Canvas2D. This is what makes browser pixel-parity FREE once the
  renderer itself is shared.

**Core design decision (make it explicitly, in code review, before task 3):**
ALL 3D state — matrix stack, projection, lights, z-buffer, tessellation caches
— lives INSIDE `crates/rasterizer` behind new `rs_3d_*` ABI calls. The C++ p5
layer and the JS shim stay thin forwarders, exactly like 2D. If any 3D math
leaks into `p5.cpp` or `p5-shim.mjs`, it must be duplicated in the other and
parity becomes a maintenance treadmill. The alternative (transforms in the p5
layers) is rejected for that reason.

This decision is also what makes the engine tier a non-event: with the math
behind the ABI, a 3D p5 call is indistinguishable from `rect()` to QuickJS.

## Verified current state (re-checked at 51365ce, 2026-09-07)

- **No WEBGL anywhere today**: zero grep hits for `WEBGL|webgl` in `native/`,
  `runtime/`, `src/playtrain/runtime/`, `crates/`. `createCanvas` is registered
  with `nargs = 2`, so its third argument is dropped; `box()` etc. are
  undefined → ReferenceError on first `draw()`.
- **`games/js/seaquest.v3.js`** (613 lines): p5-WEBGL dialect. NOT in
  `examples/games/js/`, so the trainer cannot resolve it by name today.
  **Name collision:** `examples/games/js/seaquest.js` already exists and is a
  different, 2D game (zero WEBGL hits). Do not install v3 under that name.
- **Its exact API surface** (grep counts re-derived at 51365ce; unchanged from
  the 08-28 table — this IS the Tier 1 subset spec):

  | call | uses | | call | uses |
  |---|---|---|---|---|
  | push/pop | 34/27 | | box | 11 |
  | translate | 27 | | cylinder | 6 |
  | fill | 16 | | sphere | 5 |
  | ambientMaterial | 13 | | cone | 3 |
  | rotateZ / rotateY | 8/4 | | specularMaterial | 3 |
  | ambientLight / directionalLight / pointLight | 1/1/1 | | noStroke, background, createCanvas(WEBGL) | 1 each |

  Notably ABSENT: `rotateX`, `camera`, `perspective`, `texture`, `scale`,
  `torus`, `plane`, `normalMaterial`, `emissiveMaterial`, stroke in 3D.
  Implement `rotateX` anyway (trivial once Y/Z exist); everything else absent
  stays out of the subset.
- **Input is standard**: `keyIsDown(37/39/38/40)` + `keyIsDown(32)` at lines
  146–169, and it already has `getGameState()`/`resetGame(seed)` — the default8
  action space and the env contract need NOTHING.
- **RESOLVED (was an open question in the 08-28 draft): `keyIsDown(32)` does
  fire under default8 action 5.** `native/qjs/action_table.hpp:74-85`:
  `install()` unions the `press` key into the held row, and the header comment
  states the intent explicitly ("games polling `keyIsDown(press)` (idiomatic p5
  for continuous fire) and games handling `keyPressed()` … both see it").
  No game change and no action-table change is needed. Confirm empirically at
  task 6 anyway, but do not budget design time for it.
- **RESOLVED (was an open question): seaquest.v3 does not read global
  `frameCount`.** Zero hits. The `frameCount % N` blink hazard does not apply
  to this game.
- **Rust rasterizer ABI pattern**: `#[no_mangle] pub extern "C" fn rs_*`,
  per-env state via `rs_state_new/select/free` (`crates/rasterizer/src/lib.rs:178`);
  the active state is a thread-local raw pointer to a leaked `RState`. The vec
  hosts select per-env state before each step — 3D state must ride the same
  objects. Full 2D surface is declared in `native/runtime/raster_abi.h`.
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
- **Allocation rule (NEW, 2026-09-07 — read the hazard section first):** every
  3D buffer — z-buffer, transformed-vertex scratch, clipped-triangle list,
  tessellation caches — is allocated ONCE in `rs_state_new` and reused. Zero
  heap allocation in the per-frame 3D path. This is not a micro-optimization;
  see "Hazard 1".
- **Determinism rules** (the whole point):
  - one Rust source, two targets (native cdylib + wasm32) — semantics identical
    by construction for IEEE add/mul/div/sqrt;
  - no `f64::sin` etc. — v8libm only;
  - no FMA: verify the native build does not emit fused ops. Rust does not fuse
    by default and the engine-tier builds already pass `-ffp-contract=off`; do
    NOT enable `-C target-cpu=native` style flags for this crate;
  - golden-image tests, not epsilon tests.

## Engine tier: how 3D interacts with the AOT/interpreter work (NEW 2026-09-07)

Short version: **WebGL does not touch QuickJS.** A 3D p5 call is another
`JSCFunction` in the same BINDINGS table as `rect()` — no new syntax, no new
builtins, no new object shapes, nothing `qjsc -A` has to learn. `-A` specializes
the *game's* bytecode; bindings are ordinary C the AOT unit calls into.

Four mechanical touch points, none of them design work:

1. **Atom ordering — already safe, do not break it.** In the AOT hosts the AOT
   blobs are `JS_ReadObject`'d IMMEDIATELY after `JS_NewContext`
   (`native/aotfork/qjs_host_fork.cpp:252`), and bindings are installed
   afterwards (line 264). Nothing may create an atom in between or the engine
   silently falls back to interpreting ("Bytecode mismatch" on stderr; the run
   scripts grep for it). Adding new global names is safe because they land
   after the read. Do not move any 3D setup above the blob read.
2. **E3 intrinsics list** (`native/aotfork/aot_intr_list.h`): APPEND
   `box`, `sphere`, `cylinder`, `cone`, `ambientMaterial`, `specularMaterial`,
   `ambientLight`, `directionalLight`, `pointLight`, `rotateX/Y/Z`. The header
   says "Order defines the index k … append only" — inserting shifts every
   cached blob's intrinsic indices. Get `min_argc` right: it must equal the
   number of arguments the C function reads unconditionally, because a call
   with fewer arguments keeps the generic path, whose undefined-padding is
   observable.
3. **`createCanvas` nargs 2 → 3.** That changes the function's `length`, which
   the intrinsic table keys on. Change it in all four hosts and the intrinsics
   list in one commit, then re-gate.
4. **Compile-at-load cache invalidation.** `aot_cache.py:113` keys on sha256 of
   game source + qjsc + prelude + `aot_intr_list.h` + `qjs_vec_host_fork.cpp` +
   `p5.cpp` + `p5.hpp` + `build_fork.sh` + engine archive + profdata +
   rasterizer archive + clang version. Touching `p5.cpp` or the intrinsics list
   **invalidates every game's cached tier-2/tier-3 `.so`**. Rebuilds are
   automatic (detached builder, tier 1 serves meanwhile), but budget ~25–40 s
   clang per game for tier 2, and re-bank the ratios before quoting any number.

**Four hosts, not two.** The 08-28 draft said "BOTH hosts". It is now
`native/qjs/qjs_host.cpp`, `native/qjs/qjs_vec_host.cpp`,
`native/aotfork/qjs_host_fork.cpp`, `native/aotfork/qjs_vec_host_fork.cpp`.
The fork hosts are line-for-line copies of the stock ones plus `#ifdef
HOST_AOT`; every binding change lands in all four or they drift.

**`p5_cmdbuf.hpp` is off by default** (`PLAYTRAIN_QJS_CMDBUF`), so 3D calls may
bypass it in Tier 1. If it is ever enabled, 3D ops need opcodes there too or
frame ordering breaks. Note the opcode enum is also append-only in spirit.

**What the engine tier will and will not buy a 3D game — set expectations
before task 7.** The gain is a function of the game's engine share, and this is
measured, not guessed. `handoff/tuning_notes.md` (E6 holdout): "the engine-tier
gain depends on the game's engine share, from ~1.05 (rasterizer-bound) to ~2.1
(engine-bound)". The rasterizer-bound holdouts (qbert.v2 at 2.4k steps/s,
frostbite.jungle at 25k) got 1.05–1.08 from tier 3; bigfish, at 41% rasterizer,
is where the whole PGO recipe helps least. A software 3D pipeline — Lambert
shading, z-buffer, 24×16 tessellated spheres — will be far more
rasterizer-bound than any 2D game in the set.

Consequences, both of which belong in the task-7 report:
- **Expect seaquest.v3 at the ~1.05 end.** The AOT tier will not rescue 3D
  throughput. Task 7's gate must be won by the Rust raster loop alone.
- **3D cannot hurt the banked 2D numbers.** Every game is its own `.so`, its
  own link. The risk to the 2D numbers is the binding/intrinsics edits, which
  task 5's bit-identical `gate_qjs.sh` gate catches.

## Tasks, in order (each has a gate; stop at a failed gate)

1. **Branch** off `main` at 51365ce (plain branch; nothing parallel to
   protect). Note `main` has uncommitted website/ edits at time of writing —
   branch clean or stash them; they are unrelated.
2. **Baseline**: `native/build_qjs.sh`, `native/build_qjs_vec.sh`,
   `native/gate_qjs.sh` all pass UNTOUCHED. Record the 2D golden hashes. If the
   baseline does not build locally, stop and say so (FASRC-only verification
   changes the plan's shape). The engine-tier toolchain is cluster-only;
   `aot_cache.py` falls back to the stock `.so` on a laptop, so local work is
   unaffected by it.
3. **Rasterizer crate, 3D module** (`crates/rasterizer/src/three.rs` or
   similar): matrix stack, camera, tessellators, z-buffer raster, lighting, all
   buffers owned by `RState` and allocated in `rs_state_new`. Pure-Rust unit
   tests with golden PNG/hash outputs: one tri, one lit box, one full
   seaquest-like scene composed manually. Gate: `cargo test` both native and
   wasm32 targets produce IDENTICAL buffer hashes.
4. **ABI**: add `rs_3d_begin(w,h)`, `rs_3d_push/pop`, `rs_3d_translate/rotate*`,
   `rs_3d_fill/ambient_material/specular_material`,
   `rs_3d_ambient_light/directional_light/point_light`,
   `rs_3d_box/sphere/cylinder/cone`, `rs_3d_frame_end`. Declare them in
   `native/runtime/raster_abi.h`. Keep the 2D ABI untouched. Per-env state
   rides `rs_state_new/select` unchanged.
5. **C++ p5 layer + ALL FOUR QuickJS hosts**: register the new globals in
   `p5.cpp`; `createCanvas(w,h,WEBGL)` (and the `WEBGL` constant via `setConst`)
   flips the state into 3D mode. Append to `aot_intr_list.h`. Gate: 2D
   `gate_qjs.sh` still passes bit-identically (proves 2D untouched), and
   `native/aotfork/gate_fork.sh` shows no "Bytecode mismatch" on stderr for any
   F1 binary.
6. **Single-env native run**: copy `seaquest.v3.js` into `examples/games/js/`
   ONLY when it passes, and NOT as `seaquest.js` (collision, see above); drive
   it via `GameEnv(game=<absolute .js path>)` first (the `PLAYTRAIN_GAMES_DIR`
   trap from `handoff/HANDOFF.md` §3 — the env var does NOT reach QuickJSEnv;
   pass absolute paths). Gate: 2,000-step episode, sane obs (not all-black /
   all-one-color), score moves under scripted play.
7. **Vec + throughput + async gate**: `PingPongVecEnv` with 256 envs; measure
   steps/s per core and at the 8-env vec-host config. **Run
   `native/aotfork/gate_async.py` on seaquest.v3 specifically** before believing
   any number — its allocation profile is the worst case for Hazard 1, and no
   other gate exercises the async/group path the double-buffered trainer uses.
   REPORT the number before proceeding — it decides whether Tier 2 is worth it
   and what the paper may someday claim. Expectation to beat: the archived Dawn
   path's ~1.7k FPS/env; hope: within ~5–20× of comparable 2D games. Report the
   engine-tier ratio (tier3/tier1) for this game alongside it; ~1.05 is the
   expected, non-alarming answer.
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

**Hazard 1 — glibc malloc arena convoys. The big one.** Read
`handoff/INVESTIGATE-aot-async-regression.md` §0. The shipped tier-3 build was
**6× slower** on the async path (8,788 vs 61,629 pingpong steps/s, 2.8M
voluntary context switches, 21.2 s sys time) because the 2D rasterizer's
per-frame `Vec<Point>` allocations in `rs_begin_path`/`rs_ellipse_path` were
freed on a different thread than the one that allocated them, so every free
took another thread's arena mutex. >95% of futex calls were
`__lll_lock_wait_private` under `_int_free`/`realloc`. Fixed by pinning env `i`
to worker `i % T` for its whole life, in both vec hosts; `gate_async.py` guards
it. You inherit the fix, but a 3D pipeline allocates strictly more per frame
than the 2D one, and the fix is a threshold effect, not immunity. Hence the
"zero per-frame allocation" rule in the renderer spec. Gate it at task 7.

**Other hazards:**
- `PLAYTRAIN_GAMES_DIR` does not work with `GameEnv`; pass absolute paths.
- Game fixes must land in BOTH `games/js/` and `examples/games/js/` — the
  runtime loads the latter. And `examples/games/js/seaquest.js` is a DIFFERENT
  2D game; pick another basename for v3.
- Binding changes must land in all FOUR hosts (see § Engine tier).
- `aot_intr_list.h` is append-only; so is `p5cb`'s opcode enum.
- Touching `p5.cpp`/`p5.hpp`/`aot_intr_list.h` invalidates every cached AOT
  `.so`. Expected, automatic, but not free — do not measure across an
  invalidation boundary.
- Never `uv sync` against `analogen-jaxbench/.venv` on the cluster.
- Node-to-node clock spread is 1.56×; any published 3D throughput number needs
  the same one-node discipline as everything else. Ratios are same-job; only
  ratios travel.
- The 2D rasterizer is "differential-tested against raster.mjs" — there is NO
  3D raster.mjs to differ against; the golden-image tests in task 3 replace
  that role. Do not skip them.
- The live `examples/games/js` on the cluster has ~115 files (analogen,
  `a-cq-*`); the paper's 33 are the worktree's. Gates must use the latter.
- `serial_requeue` preempts on FASRC; a job whose build phase writes artifacts
  another job reads is a hazard. Build and measure in separate jobs, or pin.
- `frameCount % N` blink animations broke a vec backend once
  (`train_ppo_clean.py` comment). **Does not apply to seaquest.v3** — verified
  zero `frameCount` reads — but applies to any fresh 3D game from task 11.

## Reporting back

The paper (limitations paragraph, `PLAYTRAIN_3D_PLAN.md`, and any future 3D
appendix) needs, from this work, explicitly:

1. the measured single-core and vec steps/s for seaquest.v3, plus its
   engine-tier ratio (expected ~1.05, i.e. rasterizer-bound);
2. whether cross-engine bit-exactness held for 3D and what it cost to get;
3. the final declared subset (the template is the artifact);
4. whether a fresh 3D game generated end to end with zero pipeline changes;
5. one sentence on what did NOT transfer, honestly.
