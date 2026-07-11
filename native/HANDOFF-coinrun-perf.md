# Handoff — coinrun perf / layer-caching / shim safety (2026-07-10)

## TL;DR
Chasing "run every ProcGen clone faster than the original" in the **native QuickJS path**
(`qjs_host` + `native/runtime/p5.cpp` + native rasterizer staticlib). coinrun/miner are
**logic-bound**, not render-bound. Bit-exact source optimization tops out ~**1.4×**. The 3.2×
`nodraw` ceiling is **not bit-exactly reachable** — see the pixel-math wall below. The only
bit-exact path to 3×+ is **AOT coverage**.

## What's done & pushed (all bit-exact or off-by-default)
- Tracing-JIT milestones: float, numeric ISA, property access, lnot, set_loc_uninitialized —
  all gated by the differential OFF==ON bit-exact test.
- Rasterizer **packed-u32 opaque-span fill** — real 1.5–1.8× on *render-bound* games. Bit-exact.
- **Dirty-rect** (whole-frame record/replay + hash): proven **NEGATIVE** (draw() runs every frame;
  only fill is skippable; render-bound games have 0 identical frames). Left **OFF by default**
  (`QJS_DIRTY`); known qbert divergence at frame 118 documented, gate catches it.
- **coinrun_fast.js** (`examples/games/js/coinrun_fast.js`): flat `Uint8Array` int-tile grid
  (idx `x*GH+y`) + run-batching (collapse contiguous GROUND/DIRT into one rect). **Obs bit-exact**
  vs coinrun.js (7 seeds × 800 frames). **1.40×**. Committed (f383f62).

## The layer-caching wall (why 3.2× is NOT bit-exact)
coinrun renders **64×64 device from 400 logical** (scale 0.16); camera is
`translate(Math.floor(-cameraX), 0)` — integer in *logical* space.
- A cached tile layer must be blitted at the camera offset each frame.
- Device camera offset = `floor(cameraX) × 0.16` → **fractional** (cameraX moves ~4 logical/frame).
- Blitting a cached raster at a fractional device offset (or caching at logical res + rescaling)
  is **floor-then-scale ≠ scale-then-floor**, and pre-rasterized-then-rescaled ≠ rasterized-at-
  target-res. Pixels won't match direct rendering → **obs gate fails**.
- Conclusion: **layer-caching cannot fast-path any scaled-camera game bit-exactly.** The `nodraw`
  3.2× ceiling just *deletes* tiles (also not bit-exact). Bit-exact source ceiling ≈ 1.4–1.7×.

## Shim-change safety (verified — analogen clones UNAFFECTED)
Two separate rendering paths:
| | Production / **analogen training** | My work (**qjs_host experiments**) |
|---|---|---|
| Engine | node/V8 | embedded QuickJS |
| Shim | `runtime/p5/p5-shim.mjs` (JS) | `native/runtime/p5.cpp` (C++) |
| Rasterizer | `runtime/p5/rasterizer.wasm` (**prebuilt, never rebuilt this session**) | native staticlib |

My changes live in `crates/rasterizer/src/lib.rs` (rebuilt **only** the native staticlib) and the
native shim/host. analogen executes **different files/artifacts** → zero effect. Even IF the
production WASM were rebuilt: fill=bit-exact, dirty-rect/hooks=off-by-default, new API=additive
(existing games never call it). Rule (qbert-stroke-leak lesson): only a *non-bit-exact* shim change
to a game a model trained on invalidates that model — none of these are that.

## RESOLVED decision (2026-07-10): chose (b) — built the shim + gate. Receipt below.
User chose **(b)**: build `createGraphics`+`image()` and gate a `coinrun_fast_layered`
variant to *prove* the layer-cache wall empirically. **Done. The obs gate FAILS exactly as
predicted, and the layered path is also SLOWER — layer-caching is a dead end, confirming AOT
(path (a)) as the only bit-exact route to 3×+.**

### What was built (committed)
- **Shim (`p5.{hpp,cpp}`):** `createGraphics(w,h)` (offscreen rasterized 1:1 at logical res),
  `setTarget/clearTarget` (retarget the singleton `_h`, invalidate style cache), `image(h,x,y,w,h)`
  (logical→device via main-canvas base scale, then `rs_draw_image` nearest-neighbor resample).
  `createCanvas` now records `_devSx/_devSy`.
- **Host (`qjs_host.cpp`):** `js_createGraphics/js_setTarget/js_clearTarget/js_image` bindings
  (`image` guarded by `NODRAW`).
- **Game (`examples/games/js/coinrun_fast_layered.js`):** identical logic/RNG to `coinrun_fast.js`;
  static terrain rendered into a 400×400 offscreen layer, then `image()`-blitted down to the 64px
  obs (pre-rasterize-then-rescale). Dynamic entities/HUD still drawn direct.

### Receipt (`qjs_host trace`, coinrun_fast vs coinrun_fast_layered, 800 frames × 7 seeds)
| result | value |
|---|---|
| **Logic** (score/lives/state/reward/term) | **byte-IDENTICAL, 7/7 seeds** (seeds 1,42,777,12345,99999,7,2024) |
| **obshash** | **DIVERGENT on 801/801 frames, every seed** |
| **Speed** (`bench`, 30k steps) | direct **28.5k** sps → layered **16.3k** sps (**0.57×, SLOWER**) |

**Two independent nails in the coffin:** (1) obs diverges every frame — pre-rasterize-at-logical-
res-then-rescale ≠ rasterize-at-target-res, gate fails. (2) It's *slower*: the scrolling camera
changes the visible window each frame, so the layer must be re-rasterized every frame (400×400 clear
+ fill + resample ≫ direct 64×64). True cache-once-blit-window is impossible with the current ABI —
`rs_draw_image` blits the *whole* src into a dest rect (no src-subrect), and even with one the
fractional device offset (`floor(cameraX)×0.16`) still breaks bit-exactness. **→ AOT it is.**

## Deferred
- `gym-gen/GAME_TEMPLATE.md`: ~35-line "Performance & Representation Rules" (flat typed-array int
  grids, int compares, alloc-free hot loops, batch same-color runs) + throughput gate (≥20k sps via
  qjs_host bench) + retained determinism gate. Drafted, NOT written.

## Key files
- `examples/games/js/coinrun_fast.js` (done, 1.40×) / `coinrun.js` (original, 2D string grid)
- `crates/rasterizer/src/lib.rs` (multi-canvas; `rs_new_canvas`, `rs_draw_image`, packed-u32 fill, dirty-rect)
- `native/runtime/p5.{hpp,cpp}` (native shim) / `native/runtime/raster_abi.h`
- `native/qjs/qjs_host.cpp` (host: trace/bench/serve/framediff/dirtycheck modes)
