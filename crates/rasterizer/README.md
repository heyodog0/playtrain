# playtrain-rasterizer

A tiny 2D rasterizer for the exact primitive surface the p5 shim exposes
(`rect`/`ellipse`/`line`/`triangle`/`quad`/polygon + transform stack + fill/stroke).
Compiles to **`wasm32-unknown-unknown`** (in-process, zero system deps — no Cairo) and is the
default renderer for PlayTrain's p5 games.

## Why

Profiling the slowest games (`miner`, `chaser`, …) showed **57–73% of every frame is
rasterization** through node-canvas/Cairo, dominated by `rect`/`ellipse`. The shim enumerates
only ~10 primitives, so Cairo's general path machinery is overkill. Owning a ~400-line
rasterizer that renders **directly at observation resolution** gives **~4–4.8× on the floor
games** (and drops the deps to zero). It also renders **bit-identically across platforms**
(deterministic), unlike Cairo which has per-platform pixel drift.

## Design

- **Raw `extern "C"` numeric API, no wasm-bindgen / wasm-pack.** All interop is scalar
  `f64`/`u32` + reading output buffers from linear memory. The self-contained 48 KB `.wasm`
  has zero imports (dlmalloc bundled). JS glue: `runtime/p5/raster-wasm.mjs`.
- **Renders at device (obs) resolution.** A base transform bakes the logical→device scale, so
  the game draws in its own coordinates (e.g. 400) while we rasterize at 64.
- **Pixels** are RGBA `u8`; `rs_to_bgra` emits BGRA-premultiplied to match node-canvas'
  `toBuffer('raw')`, so the existing obs path is unchanged.

## Spec + verification: `runtime/p5/raster.mjs`

This crate is a **direct port of the pure-JS rasterizer `runtime/p5/raster.mjs`**, which is its
spec and differential-test oracle. The two are held to **bitwise equality**: the full-catalog
sweep (57 games × 40-frame rollouts) is **bit-identical (Δ=0)**. Reaching that required three
exact-match fixes, all worth knowing if you edit either file:

1. **Rounding** — JS `Uint8ClampedArray` rounds half-to-even; Rust `as u8` truncates. Use
   `clamp_u8` for any fractional (alpha-blended) write.
2. **Internal trig** — V8 fdlibm vs Rust libm differ ~1 ULP. Both use an identical Taylor-9
   `psin`/`pcos` (= `_rsin`/`_rcos` in raster.mjs) for ellipse/rotate/roundRect. **Do not**
   use `f64::sin/cos` here. (This is *not* the game-facing `sin()`/`cos()`, which stay real
   `Math.*` for game-logic fidelity.)
3. **Color parse** must round (`Math.round`), matching the JS glue and spec.

Note: this is **not** bit-identical to *Cairo* — different AA algorithm (Cairo does smooth
coverage AA; this does hard-edged fills). That's by design; nothing needs to match Cairo. Games
are re-baselined on this renderer.

## Build

```sh
cargo build --target wasm32-unknown-unknown --release
# artifact: <repo>/target/wasm32-unknown-unknown/release/playtrain_rasterizer.wasm
cp <repo>/target/wasm32-unknown-unknown/release/playtrain_rasterizer.wasm runtime/p5/rasterizer.wasm
```

(Requires `rustup target add wasm32-unknown-unknown`. The built `rasterizer.wasm` is committed,
so end users don't need the Rust toolchain — this crate is only for rebuilding it.)

## Backends (selected in `runtime/p5/p5-shim.mjs`)

`PLAYTRAIN_RASTERIZER` ∈ `{ wasm` (default)`, js, cairo }`. `wasm` and `js` are bit-identical;
`js` is the zero-build pure-JS fallback (used automatically if the wasm fails to load) and the
browser variant. `cairo` is the legacy node-canvas backend.
