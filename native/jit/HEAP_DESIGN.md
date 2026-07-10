# QuickJS tracing JIT — heap/refcount + call extension (task 17)

The integer JIT fires + is bit-exact (24× on `test_intloop`, 89/89 games unchanged; see
[[DESIGN.md]]). Games don't fire yet because their hot loops touch **heap values** (arrays,
strings, objects) and **calls**. This doc grounds the extension in the real quickjs-ng layout
and the real shape of the coinrun tile loop, and lays out an incremental, gate-per-step plan.

## Ground truth: the coinrun tile loop (the flagship losing game)

Source (`coinrun.js` draw), inner loop over `grid[x][y]`:
```js
for (let y = 0; y < grid[x].length; y++) {
  let t = grid[x][y];
  if (!t) continue;
  if (t === 'GROUND' || t === 'DIRT') { fill(80,140,60); rect(x*TS, y*TS, TS, TS); }
  else if (t === 'CRATE') { ... } else if (t === 'LAVA') { ... }
}
```
Recorder VERIFIED: this records fully (`draw@257`, 22 bytecodes) — **the recorder does NOT
abort on the native `fill`/`rect` calls** (they run in-frame; no `JS_CallInternal` recursion,
no `b` change). So for coinrun the blocker is NOT recording; it's the decoder/codegen. The
ops in the loop body (from the recorded trace, cross-checked vs disasm):
- `get_loc_check` / `get_var` (globals: grid, TILE_SIZE, fill, rect) — **loop-invariant**
- `get_array_el` — `grid[x]` (array→array), `grid[x][y]` (array→string)
- `strict_eq` vs `push_atom_value` — `t === 'GROUND'` (interned-atom compare)
- `if_true`/`if_false` control (the `!t` continue + the else-if chain), `goto16` back-edge
- **native call** `fill(...)` / `rect(...)` (op `call`) — must be emitted from the trace

NOTE: other games (cavequest `drawGame`→`drawEnemy`) have **JS** calls in the loop → the
recorder DOES abort (`b != rec_b`). Those need cross-fn trace recording (inline the callee).
Coinrun does not — so tackle heap+native-call first (higher value: coinrun is a target loss),
cross-fn recording second.

## The ABI fact that drives everything: JSValue is 16 bytes on 64-bit

`JS_NAN_BOXING` is only set for 32-bit builds. Our arm64/x86_64 build uses the struct form:
```c
typedef struct JSValue { JSValueUnion u; int64_t tag; } JSValue;   // 16 bytes
// u at offset 0 (int32 / double / ptr all overlap at 0); tag (int64) at offset 8
```
So a JSValue does NOT fit in one `int64`. Current int trace ABI (`int64_t *locals`, all-int)
stays for int-specialized scalars. Heap operands are handled two ways:
- **Loop-invariant heap locals** (the array `grid`, the fns `fill`/`rect`): at trace ENTRY,
  guard the type, extract the `JSObject*` (`v.u.ptr`) once, and pass it as an `int64` slot
  (a pointer fits in 64-bit). The trace treats it as a raw base pointer — no per-iteration
  reboxing, no refcount churn (the frame's var_buf still owns the reference for the whole call).
- **Loaded heap elements that don't escape** (the string `t`): keep as unboxed `(tag, ptr)`
  in registers for the lifetime of the compares; never rebox, never incref/decref (LuaJIT-style
  "sunk" allocation). Correct because the container (`grid`) is not mutated during the trace and
  `t` never outlives the iteration. If a future loop lets a heap temp escape a side-exit, THAT
  exit must rebox+incref — flagged per-exit, not globally.

Struct offsets (JSObject fast array, `JS_CLASS_ARRAY`, `fast_array==1`):
- `class_id` (uint16), the `fast_array` bit, `u.array.count` (uint32), `u.array.u.values`
  (`JSValue*`). Do NOT hand-compute offsets — bake them from `offsetof`/bitfield probes in the
  patched quickjs.c (which sees the structs) into `extern const` ints that qjit_ir.c reads.
  A one-time self-check asserts the probed offsets against a live array at startup.

## get_array_el fast path (from the interpreter, must match bit-for-bit)
```c
if (tag(obj)==OBJECT && tag(idx)==INT) {
  p = obj.u.ptr;
  if (p->class_id == JS_CLASS_ARRAY && (uint32)idx < p->u.array.count) {
    val = js_dup(p->u.array.u.values[idx]);  // incref if heap element
    JS_FreeValue(ctx, obj); ...              // decref the popped array
  }
}
```
In a trace the array is loop-invariant (never popped/freed each iter), and an int element has
no refcount → the net refcount delta the interpreter would do (incref elem via js_dup, decref
array via JS_FreeValue) is exactly cancelled by the fact that we keep both live in regs/frame.
So the int-element fast path needs NO refcount ops. Guards: class==ARRAY, idx<count, elem
tag==INT; any miss → deopt (resume header, re-run iteration interpreted). Non-fast-array or
OOB or non-int elem → deopt (interpreter takes the slow JS_GetPropertyValue path correctly).

## Incremental plan (each step: C unit tests + JS micro-bench that fires + OFF==ON gate)
1. **Guarded fast-array INT-element load** (`for(i<n) s+=arr[i]`). Introduces guard-array +
   bounds-guard + element-load + elem-int-guard + the JSObject*-as-int64 entry marshaling. No
   refcount, no calls, no strings. ← START HERE (task 19).
2. **strict_eq vs interned atom** (`for(i<n) if(arr[i]===K) c++`, K a string const). Element is
   a heap string; compare tag==STRING && ptr==atom_ptr (interned → pointer identity). Non-escaping
   → no refcount. Introduces push_atom_value (read cpool atom) + strict_eq lowering.
3. **Object-element load + nested index** (`grid[x][y]`): element is itself an array/object;
   load its JSObject* for the next index. Introduces heap-element-as-pointer chaining + guards.
4. **Native call emission** (`fill`/`rect`): resolve the callee at record time (loop-invariant
   C function), emit a call to a marshaling helper `qjit_call_native(ctx, fn_val, this, argc,
   args[])` that boxes the int args → JSValue[], invokes, frees the return. The rasterizer side
   effects (the actual draw) happen in the C call — correctness = same call, same args, same order.
5. **Integrate → fire coinrun tile loop**, gate OFF==ON across all games + seeds.
6. **Cross-fn trace recording** (inline JS callees like cavequest `drawEnemy`): allow the recorder
   to follow `b` changes across a call/return within the loop body (bounded depth), so JS-call
   loops record. Then their heap codegen reuses 1–4.

## Invariants (unchanged from the int JIT)
Correctness is the interpreter + the OFF==ON gate. The JIT only ever makes a correct loop faster
or safely deopts. Every new op is conservative: if any assumption (type, shape, bounds, escape)
isn't provable at record/entry time, ABORT the trace or DEOPT — never miscompile. Refcounting is
the minefield: the rule is "unboxed heap temps that don't cross a side-exit need no refcount;
anything reboxed at an exit must incref." Gate every increment bit-exact before the next.
