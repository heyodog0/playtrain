# QuickJS-ng JIT — coverage matrix + roadmap (ordered like a real engine JIT)

This is a tracing JIT **for the quickjs-ng bytecode ISA + JSValue model**, not for any game.
Coverage is driven by this matrix and proven by an engine-level differential fuzzer
(`fuzz_jit.mjs`: random hot loops, OFF==ON), never by whether a hand-picked game fires.
A game accelerates iff its hot loop uses only SUPPORTED ops; else the trace aborts and it
runs on the interpreter, **bit-exact**. Unseen LLM-emitted games are never broken.

## The tracing-JIT contract (how V8 / LuaJIT actually work — 100% is neither goal nor real)
- **You JIT hot inner loops, not the whole language.** LuaJIT ships a documented **NYI list**
  (bytecodes/lib fns that abort a trace → fall back → blacklist after repeated aborts).
  V8/TurboFan **deopts** to the interpreter on any speculation miss. Aborting/deopting is the
  model, not failure.
- **The only permanent aborts are trace-incompatible ops** — they never appear in hot loops
  and don't fit a linear trace: `throw`/`catch` unwinding, generators/async `yield` (can't
  span a suspend), `eval` (code that doesn't exist yet — V8 won't optimize eval'ing fns),
  `with` (dynamic scope). LuaJIT aborts these too.
- **Everything on a hot path is a TODO, not a wall.** Calls aren't aborts — LuaJIT traces
  *through* them by inlining. Floats aren't special — LuaJIT is dual-number, V8 has Smi +
  HeapNumber. Property access isn't hard — V8 makes it fast with inline caches (shape guards).

## Priority order — mirrors what makes V8 fast on real code
V8 tiers Ignition→Sparkplug→Maglev→TurboFan; its wins come, in order, from: (1) a complete
**number model** (Smi int fast path + overflow→HeapNumber double), (2) **property access via
inline caches** (hidden-class/"map" guard + fixed-offset load), (3) **array element-kind**
specialization, (4) feedback-directed **call inlining**, (5) deopt for the rest. Our workload
(numeric loops, grids/entity arrays, `entity.x` fields, render calls) maps onto the same order:

| # | Milestone | Why it's here (engine rationale) | Status |
|---|---|---|---|
| 0 | **Branch-direction correctness** | a recorded branch may take OR fall through; the guard's exit must be the other way, at the right PC. Fuzzer-found bug; blocks trusting any conditional. | ✅ done |
| 1 | **Float specialization** (f64 regs, `tag==FLOAT64` guard) | THE headline gap. V8=Smi+HeapNumber, LuaJIT=dual-number. Most game loops (positions, velocities, physics) are float. int-only can't touch them. | ✅ done |
| 2 | Full **numeric ISA** on int+float | bitwise `and/or/xor/shl/sar/not` (int32), `neg`, int `mod`, `inc`/`dec`/`post_inc`/`post_dec`. **Deferred:** `div` + float `mod` (`js_number` → dynamic int-vs-float result, breaks monomorphic slots), `>>>` (`js_uint32` → float escape), `pow` (transcendental, needs `fm_pow` helper). | ✅ done¹ |
| 3 | **Property access** `get_field`/`put_field` via shape guard (our inline cache) | V8's crown jewel — real JS is property-access-dominated; games do `e.x`,`e.vy`,`grid.w`. Guard the object's JSShape, load/store at the cached property offset; deopt on shape change. THE unlock for real games to fire. | ⬜ next |
| 4 | **Array element write** `put_array_el` (+ element-kind sense) | grids/entity lists get mutated. Needs refcount (free old, incref new) — the correctness minefield; V8 has element-kinds, we guard fast_array + int/heap element. | ⬜ |
| 5 | **Call inlining** (LuaJIT-style: record through JS calls) + method `this` | stop aborting recording on JS→JS calls; inline the callee into the trace with a target guard. Native calls already emitted. | ⬜ |
| 6 | Loose `==`/`!=`, general `strict_eq`, misc hot ops | coercion via helper or abort. | ⬜ |
| ∞ | **Permanent abort** | throw/catch, generators/async, eval, with, proxies, bigint, spread, for-in/of iterators. | ⛔ by design |

## Supported today (✅ — fires, gated OFF==ON)
- stack/const: push_0-7/i8/i16/i32/minus1/const8+const(int **or float**)/atom_value, drop, dup, nop
- locals/args: get/put/set_loc(+0-3,8,check), get_loc0_loc1 (fused), get/put/set_arg(+0-3); int
  OR **float** (QK_FLOAT) payload, OR object-temp via store-to-load forwarding (QK_SKIP)
- int arith: add, sub, mul (overflow→deopt), add_loc, inc_loc, dec_loc
- **float arith: add, sub, mul, div (f64, no overflow/deopt); int→float promotion (I2F) on mixed
  operands; float add_loc/put_loc. Entry guards tag==FLOAT64; writeback via `js_float64` (raw,
  matches the interpreter — no int normalization).**
- **int32 bitwise/shift: and, or, xor, not (`^ -1`), shl (`<<`), sar (`>>`) — abort if an operand
  is float (JS would ToInt32); shift counts masked `& 31`. int mod (`%`, guarded a>=0 && b>0 else
  deopt). neg (int: deopt on `-0`/`INT32_MIN`; float: `× -1.0`). inc/dec/post_inc/post_dec decode
  to dup/push/add (reusing the overflow-guarded int add + float promotion).**
- compare: lt, lte, gt, gte (int **and float**; float guards carry a NEG flag so NaN resolves to
  the interpreter's `!(a<b)` direction — `!(a<b) != (a>=b)` under NaN, so negation is NOT folded);
  strict_eq (element === interned atom, via js_strict_eq helper)
- control: goto/8/16 back-edge; if_false/8 (recorded direction — milestone 0)
- heap: get_array_el (int/string/object element), get_length, get_var (global fast-array or fn)
- call: call (global fn, int args, result dropped — via JS_Call helper)

### Float — measured (milestone 1)
`test_floop.js` (pure-float hot loop) fires and is **24.5× the interpreter** (11.4k→279k steps/s),
bit-exact OFF==ON. Float fuzzer corpus (`node fuzz_jit.mjs 24 <dir> float`): 24 programs × 4 seeds
bit-exact, 19/24 fire. Unit tests: `qjit_fir_test` 21/21 (IR+codegen incl. NaN both polarities,
mixed int/float, fail-closed type-mixed slot); `qjit_build_test` +10 float builder cases.
Real games stay bit-exact but don't fire yet — their hot loops read object fields (milestone 3).

### Numeric ISA — measured (milestone 2)
¹ "done" = the mechanical int32 ops (bitwise/shift/neg/mod/inc-family). `div`, float `mod`, `>>>`,
and `pow` are **deferred** (see table) — they produce dynamically-typed or transcendental results
that don't fit the fixed-per-slot-type model; they abort → interpret → bit-exact (never wrong).
`test_numops.js` (shl/xor/and/or/sar/mod/neg/inc hot loop) fires and is **~13× the interpreter**
(5.7k→73k steps/s), bit-exact OFF==ON. Unit: `qjit_build_test` +11 cases (bitwise int32 ref,
and/or/mod/sar, neg clean + `-0` deopt, bitwise-on-float abort). Int fuzzer corpus now emits
bitwise/mod/neg forms: 24 programs × 4 seeds bit-exact, 24/24 fire.

## Invariant (unchanged, non-negotiable)
Unsupported or uncertain → abort/deopt → interpreter → bit-exact. The JIT only ever makes a
correct loop faster or safely bails. Every milestone lands with C unit tests + fuzzer cases +
a green OFF==ON gate before the next.
