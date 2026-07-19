# Native Compilation of PlayTrain Games (design doc)

**Status:** proposal + go/no-go evidence. Not started.
**Goal:** close the ~2.9×/core raw-env-throughput gap to ProcGen by AOT-compiling
each generated game to a native binary, while keeping JavaScript as the authored,
LLM-generated, browser-playable source of truth.

> **Scope honesty up front.** This helps *pure-env throughput* (eval, LLM-game
> validation, dataset/human-baseline collection, the paper's speed number). It does
> **not** speed up RL training — training is learner/GPU-bound (~11k SPS at 42% GPU
> util; the env already produces 79–92k/node, ~7–8× more than the learner consumes).
> Build this for the speed story, not for faster agents.

---

## 1. What this is (and what it is not)

- **Is:** a compiler `JS game (constrained subset) → Zig logic + linked native
  rasterizer → one native binary per game`, with an **automatic bit-exact-to-V8
  gate** and **V8 fallback** for anything outside the subset.
- **Is not:** "getting V8 to emit C++." V8 is a JIT — it lowers JS to machine code
  *in memory* and never emits portable source. There is no V8→C++/Zig path. AOT
  JS→native exists only for typed subsets (Static Hermes, Porffor, AssemblyScript).
- **Is not the Bun path.** Bun is a *runtime* in Zig that *embeds JavaScriptCore*;
  it runs user JS on a JIT engine, it does not compile user JS to Zig. A Bun-style
  runtime rewrite leaves game logic JIT'd (~JS speed) → it does **not** close the gap
  to ProcGen's native logic. Closing the gap *requires* compiling the game logic.

---

## 2. Coverage — is the subset broad enough? (static scan, 87 shipped games)

Heuristic feature scan (`tools/` one-off; feature-presence, not a full parser — treat
as an upper-bound estimate):

| bucket | count | % |
|---|---|---|
| **GREEN** — pure v0 subset (structs + vectors + immediate closures + p5 API) | 31 | 36% |
| **YELLOW** — compilable, needs runtime support (HashMap / Set / dict-iter) | 56 | 64% |
| **RED** — V8 fallback | **0** | **0%** |
| **Compilable (GREEN+YELLOW)** | **87** | **100%** |

**RED games: none.** (An earlier scan flagged 2 — a `class` and a `generator` — but both
were the *words* "class"/"yield" inside code comments; `tools/subset_scan.py` now strips
comments/strings before scanning. No game in the current catalog needs V8 fallback.)

**What YELLOW needs (bounded runtime additions, in frequency order):**
- **dynamic-key dictionary** — 47 games (`delete obj[key]`, object-as-hashmap, e.g.
  `persistentDrops[key]`) → native **HashMap**.
- **Set** — 7 games (BFS/pathfinding `new Set()` + stack) → native **HashSet**.
- `.sort(cmp)` 3, `typeof` 2, `Object.keys/values` 1, object-spread 1 — minor.

**Takeaway:** the subset is broad enough. Beyond structs + vectors, the one
load-bearing runtime feature is a **dynamic-key HashMap** (plus Set). Add those to the
runtime library and 98% of the current catalog is in scope, with 2 fallbacks.

---

## 3. Architecture

```
generate JS game  (unchanged; LLM authors p5.js as today)
   │
   ├─ parse → infer shapes/types → emit Zig logic
   │     • object literals      → structs (one struct type per entity kind)
   │     • dynamic arrays        → std vectors (push/pop/splice/filter/find/forEach/map)
   │     • object-as-dict        → HashMap ; new Set() → HashSet
   │     • immediate arrow cbs   → Zig closures (by-ref capture; no escaping)
   │     • p5 draw calls         → calls into the native rasterizer (C ABI)
   │     • Math.* / mulberry32    → the v8-libm shim (bit-exact; see §5)
   │     • arena allocator per episode; resetGame() frees the arena
   │
   ├─ link the existing Rust rasterizer via C ABI  →  one native binary
   │
   ├─ AUTO differential gate:  native vs V8, same seed + action sequence
   │        ├─ byte-identical frames  → register the native twin (fast path)
   │        └─ mismatch / unsupported → V8 fallback (general path, unchanged)
   │
   └─ runtime picks native twin if present, else V8
```

### Why this shape
- **Rust rasterizer stays** — it's already native, deterministic (integer scanline,
  `psin/pcos`, `clamp_u8`), and compiles to native *and* wasm from one source. Reuse it.
- **Zig for the generated logic**, not Rust: auto-generated game code (mutable entity
  arrays, closures mutating shared state, aliasing) fights Rust's borrow checker; you'd
  emit `Rc<RefCell>`/`unsafe` everywhere. Zig has no borrow checker, `comptime` for the
  API table, clean C ABI to the Rust rasterizer, and **arena-per-episode** maps exactly
  onto episodic games (reset = free arena; fast, leak-free, deterministic). (C is a fine
  alternative; avoid Rust-as-target.)
- **Hybrid, not replacement.** JS remains the source of truth: authoring, LLM
  generation, browser playability, and the fallback. Compilation produces a *native twin*
  for the fast path. This preserves the generality thesis — a game only leaves JS for the
  subset it provably fits, and the JS version stays canonical.

---

## 4. The compilable subset (v0 spec)

Grounded in the survey of the 87 games.

- **Lifecycle contract (fixed):** `setup` / `draw` / `resetGame(seed)` /
  `getGameState()→{score,lives,gameState}` → methods on a `Game` struct.
- **Type/shape stability (the load-bearing rule):** every var / array element / object
  field holds one type for its lifetime — `f64`/`i32`, `bool`, small `string`, a struct
  (fixed named fields), a `Vec<T>`, or a `HashMap<K,V>`. No union/shape-shifting types.
- **Data:** object literals → structs; arrays → vectors with
  `push/pop/shift/splice/filter/find/forEach/map/includes/slice/sort`; object-as-dict →
  HashMap; `Set` → HashSet.
- **Control flow:** `if/else/for/while/ternary/switch/break/continue`, top-level funcs.
- **Closures:** arrow functions **only as immediate array-method callbacks** (compiled
  to by-ref lambdas). No storing/returning closures (no escaping).
- **p5 API — closed, extensible mapping table** (the modifiability knob; one row per
  call): `fill,stroke,noStroke,noFill,strokeWeight,color,background,rectMode,
  rect,ellipse,circle,line,triangle,quad,arc,point, beginShape/vertex/endShape,
  push/pop/translate/rotate/scale, text/textSize/textAlign, keyIsDown, frameCount,
  width, height`.
- **RNG/Math:** `mulberry32` (imul, exact); `Math.floor/abs/max/min/ceil/sqrt/pow/
  hypot/atan/sin/cos/PI`; p5 helpers `dist/constrain/lerp/map/random`.
- **Fallback → V8:** `class` (or lower to struct+methods later), generators, `eval`,
  `Symbol`/`Proxy`, async, getters/setters, real regex, escaping closures,
  heterogeneous arrays.

---

## 5. Bit-exact-to-V8 (correctness gate)

Native trajectories must match V8 byte-for-byte so the *played/validated* game equals
the *trained* game (play/train equivalence + validation transfer).

- **f64 arithmetic (+−×÷):** bit-identical if compiled with **`-ffp-contract=off`**
  (no `a*b+c`→fma fusion) and IEEE operation order preserved.
- **Integers / `Math.imul` / bitwise / `mulberry32`:** exact u32 wrapping — **already
  bit-identical** (done for the WASM rasterizer).
- **Transcendentals — the only real work, and it is bounded.** V8 uses fdlibm-flavored
  functions differing from `std`/libm by ULPs. Games use only
  `sin, cos, atan, pow, hypot` (+ `sqrt`, IEEE-exact). `sin/cos` are **already matched**
  (`psin/pcos`). Remaining: a small **v8-libm** with bit-exact `atan`, `pow`, `hypot`.
- **Verification is automatic:** the differential gate runs native vs V8 on the same
  seed + action sequence and requires byte-identical frames (your existing zero-tolerance
  replay harness, extended cross-engine). Pass → ship native; fail → V8 fallback. So
  bit-exactness is a *checked property per game*, not a manual promise.

---

## 6. Automatic pipeline

1. Generation emits JS (unchanged).
2. Compiler runs automatically: parse → infer → emit Zig → link Rust rasterizer → build.
3. Differential bit-exact gate (native vs V8) runs automatically.
4. Registry records `native` (pass) or `v8` (fail/unsupported) per game.
5. Runtime dispatches to the native twin when present, else V8.

No hand-porting; adding coverage = extend the p5 table or the subset, re-run the gate.

---

## 7. Phased plan

- **P0 — derisk (done):** static coverage scan → 98% compilable, dominant need =
  HashMap+Set, 2 fallbacks. ✅ green-light.
- **P1 — v8-libm:** bit-exact `atan/pow/hypot` (sin/cos exist); differential-test vs V8.
- **P2 — codegen core:** structs + vectors + immediate closures + p5 table → Zig,
  linked to the Rust rasterizer; GREEN games (30) compile + pass the gate.
- **P3 — runtime features:** HashMap + Set + dict-iteration → unlock the 55 YELLOW games.
- **P4 — pipeline:** wire the compiler + differential gate into generation; V8 fallback.
- **P5 — shape inference hardening / optional typed-generation contract** to push the
  compilable fraction toward 100% and guarantee new games compile.

---

## 8. Expected outcome & honest ROI

- **Per-core:** parity with ProcGen (you *become* native for compiled games).
- **Aggregate:** parity via sharding/independent processes (the coordinator, not the
  substrate, was PlayTrain's ~79k cap; sharded PlayTrain already hit ~295k).
- **"Faster than ProcGen"** only via the *further* dirty-rectangle rasterizer edge
  (render only changed regions vs ProcGen's full-frame redraw) — a separate, stackable win.
- **Cost:** a real multi-month compiler (P1–P4), narrower than Bun (a few dozen p5 calls,
  ~5 Math functions, stereotyped entity/closure patterns) → feasible for a focused effort.
- **Does not help training** (learner-bound). Justified only if the pure-env / paper
  speed story is worth it.
