# Native C++ compile — P1/P2 results (bigfish end-to-end)

First game (`bigfish`) compiled to a native C++ twin, linked against the Rust
rasterizer staticlib, **bit-exact to V8** and benchmarked. This validates the
whole runtime + correctness-gate + speed path before generalizing codegen.

## What was built (`native/`)
- `runtime/raster_abi.h` — C decls for the Rust rasterizer's `extern "C"` surface.
- `runtime/jsmath.h` — JS-semantics math (imul, jround, psin/pcos, Mulberry32, …).
- `runtime/p5.hpp/.cpp` — native p5 API, mirrors `p5-shim.mjs` onto the rasterizer.
- `runtime/game.hpp`, `runtime/env.hpp` — lifecycle contract + GameEnv reimpl.
- `runtime/main.cpp` — driver (`trace` for the gate, `bench` for throughput).
- `games/bigfish.cpp` — hand-port; the **codegen output contract** for the transpiler.
- `build.sh`, `gate.sh`, `reference_trace.mjs`, `bench_js.mjs`.
- `crates/rasterizer/Cargo.toml` — added `staticlib` crate-type (native link).

## Correctness — differential bit-exact gate: PASS
Native vs the real V8 env (wasm rasterizer), same seed + action formula
`(i*3+1)%8`, comparing per-frame reward/term/trunc/score/lives/gameState **and an
FNV-1a hash of the full 64×64×3 obs**.

- 5 seeds × 20,000 steps = **100,000 frames byte-identical**, including ~250
  episode resets, collisions, mid-frame `resetLevel()` (rng advance), and `pow()`.
- **`Math.pow` matched `std::pow`** on macOS/clang for these inputs — no fdlibm
  port needed yet (the gate is the arbiter; port only if a game diverges).

## Throughput (Apple Silicon, single core, 64×64 RGB obs, frameSkip=1)
| build | steps/sec | note |
|---|---|---|
| game **logic only** (no draw, no obs) | **18,400,000** | logic is ~0.05 µs/frame |
| rasterize, no obs readback | 202,000 | |
| full, two-pass BGRA readback (initial) | 87,000 | readback was 57% of the frame! |
| **full, one-pass RGB readback (current)** | **194,000** | still bit-exact |
| V8 same machine, same env | 47,000 | native = **4.1× V8/core** |

## The headline finding: **the rasterizer is the whole cost; logic is free.**
- Game logic is **0.5%** of a frame (18.4M sps). Rasterization + readback is 99.5%.
- So native-compiling *logic* is not itself the speedup — both V8 and native run
  the *same* Rust rasterizer. Native wins (4×) by (a) calling the rasterizer
  **directly in-process** instead of crossing the JS→wasm boundary per primitive,
  and (b) a one-pass readback.
- Implication for the compiler: producing a native twin is **required** to unlock
  the direct-call path, but the throughput **ceiling is set by the rasterizer**,
  not codegen. Invest in the transpiler (to get a twin at all) *and* in the
  rasterizer fill (to raise the ceiling — this is the "own the rasterizer" lever).
- The one-pass readback (skip `rs_to_bgra`; read internal opaque RGBA straight to
  RGB) is bit-identical and 2.2×. **The production JS runtime does the same
  wasteful two-pass BGRA round-trip** — a direct-RGB wasm readback export would
  speed up the JS path too. (spin-off win, not yet applied)

## The compiler itself (`compile/transpile.mjs`) — JS → C++ codegen
Acorn-parses the game JS and emits the same shape as the hand-port. Key decisions:
- **All JS numbers → `double`** (JS has no int type). Avoids `auto x=0`⇒`int` bugs
  (integer division would diverge); `%`→`js::mod`, array indices get `(long)` casts.
- **Struct-shape inference**: object literals grouped by key-set → one struct each,
  named from the variable/array they flow into (`player`→Player, `fishes`→Fish).
- **Function signature table** (return-type + param inference), mulberry32 recognized
  as an intrinsic, `getGameState` return → `game::State`, `text()` args dropped (no-op).

### Coverage on the 31 GREEN games (transpile → compile → gate, `compile_all.sh`)
- **Transpile 19/31, compile 4/31, GATE PASS 3/31**: **bigfish, pong, sonic** are
  fully bit-exact end-to-end (each 120k frames × 6 seeds). Throughput: pong 382k,
  sonic 139k, bigfish 194k sps.
- Remaining blockers are the documented P3/P5 feature buckets, in priority order:
  **spread `...`** (8 games), **object-as-dict / `unordered_map`** (leaper, miner,
  asteroids*), **2D arrays** (breakout, chaser, maze), **helper struct-params**
  (freeway, jetpack), deeper type inference (mario, ninja, coinrun, vvvvvv), and
  one compiles-but-diverges bug (bossfight — a bit-exactness issue to chase).
- The gate makes this safe to grind: extend a feature, re-run `compile_all.sh`,
  and only bit-exact games are accepted.

## Boxing experiment — dynamic dicts stay bit-exact AND rasterizer-bound
Tests whether the YELLOW dynamic-object path (`js::Object`/`js::Value`,
`runtime/jsvalue.h`) can be both correct and fast, using a differential microtest
(`tests/dict_diff.{mjs,cpp}`) that mirrors cavequest's `persistentDrops` usage.
- **(a) Bit-exact: PASS.** 80k ops × 4 seeds byte-identical to a V8 object —
  including the ES2015 `for..in` order (integer-index keys ascending, then string
  keys in insertion order), numeric→string key coercion, and delete/re-insert
  repositioning. A plain `std::unordered_map` would reorder draw calls and fail;
  the insertion-ordered `js::Object` is what makes it work.
- **(b) Rasterizer-bound: PASS.** A realistic cavequest-style frame (nested boxed
  `{role,visualId,cooldown}` values, per-frame `for..in` cooldown pass, intermittent
  churn) costs **~820 ns/frame** (pessimistic alloc-every-frame: ~1490 ns) vs the
  ~4950 ns rasterizer frame → rasterizer is still **~86%** of the frame. A dict game
  lands at **~155–173k sps**, still ~3.5–4× V8. Boxing is affordable exactly because
  logic (even dynamic, boxed logic) is a small slice of a rasterizer-bound frame.
- **Conclusion:** the hybrid architecture is validated — static path for the easy
  majority, `js::Object`/`js::Value` box for the dynamic remainder, at ~zero
  throughput cost. Robustness comes from the box + the V8 fallback + the gate, not
  from perfect static inference.

## x86 VERIFICATION — native beats ProcGen per-core (CONFIRMED)
Ran on a FASRC sapphire compute node (Intel Xeon Platinum 8480+, `holy8a24105`),
all three engines same node, bigfish, frameskip=1, 64×64 RGB obs:

| engine | steps/sec | vs V8 |
|---|---|---|
| **Native (C++ AOT twin)** | **79,700** | **3.96×** |
| ProcGen (hand-optimized C++) | 39,659 | 1.97× |
| V8 (node-gym runtime, wasm rasterizer) | 20,150 | 1.0× |

- **Native / V8 = 3.96×** — the Apple-Silicon 4.1× **transfers to x86** (throughput is
  CPU-sensitive, but the native advantage is architectural — no per-primitive JS→wasm
  boundary — so it holds across ISAs).
- **Native / ProcGen = 2.01×** — the native-compiled twin is **twice as fast as ProcGen
  per core.** This flips the paper's story from "ProcGen ~2.9× faster" to "native
  node-gym is ~2× faster than ProcGen per-core," while keeping full generality.
- **Bit-exactness holds on x86 too**: the gate passed 100k frames × 5 seeds on the
  sapphire node (glibc/clang `pow` matches V8's x86 `pow` — no fdlibm port needed).

### Honest caveats
- One game (bigfish), render-bound and favorable. Logic-heavy or primitive-heavy games
  will differ (though both effects tend to *favor* native: free logic + more boundary
  crossings avoided). Needs a multi-game sweep once the transpiler covers them.
- Single-core. Aggregate throughput depends on parallel scaling — node-gym had ~63%
  sharding efficiency vs ProcGen ~100% in the earlier study, so per-core 2× may not
  fully translate to aggregate 2×. Separate measurement.
- Rasterizer is shared native/V8 (Rust, linked static vs wasm), so the comparison is clean.

## Reproduce on FASRC
Deploy (no GitHub auth on the node): tarball `native/` + `crates/rasterizer/` → pipe
`base64 | fasrc 'base64 -d | tar xz -C ~/node-gym-smoke/node-gym'`. Build:
`cargo rustc --release --lib --crate-type staticlib` (staticlib-only; the cdylib half
fails to link on this x86 `cc` with `--version-script`), then clang++ link. Bench on a
compute node: `srun -p sapphire -c 4 -t 0:15:00 --mem=8G bash -c '...'`.
