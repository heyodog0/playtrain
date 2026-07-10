# QuickJS runtime tracing JIT — design

**Goal:** win ALL games within QuickJS (no offline profiling, no JS→C++ transpiler) by
JIT-compiling hot loops to type-specialized native code at runtime. LuaJIT-model tracing JIT,
MIR codegen backend, deopt-to-interpreter safety net. Beats ProcGen across the board.

**Why (measured):** grid games are QuickJS-interpreter-bound — 63% of a coinrun frame is
interpreting the tile loop (string `t==='GROUND'` compares, `grid[x][y]` unbox, arithmetic);
C-call boundary is only 6%. AOT/baseline removes dispatch only → 1.6×. Full type-specialization
ceiling on our tile loop = **~19×** (0.05s C vs 0.96s interp). Need 2.4× to win worst game →
huge headroom; a realistic tracing JIT (LuaJIT-class, 5–10× on such loops) wins everything.

**Backend validated:** MIR (vnmakarov/mir) — runtime JIT, ~18µs/func compile, ~0.22ns/iter tight
loop (near gcc-O2). Owns regalloc/opt/codegen. `native/jit/mir/`, `libmir.a`.

## Architecture (tiers)

```
QuickJS interpreter (tier 0, always correct)
  └─ loop-backedge / call counters  → hot? → RECORD
        └─ trace recorder: run interpreter in record mode, emit typed IR + guards
              └─ trace optimizer: type-specialize (unbox), fold, hoist, DCE
                    └─ MIR lowering → native trace (tier 1)
                          └─ guard fail → snapshot restore → deopt to interpreter
```

## Components

1. **Profiling / hot detection** (task 14). Hook quickjs-ng `JS_CallInternal`: increment a counter
   on loop back-edges (`OP_goto` backward) and function entry. Threshold (e.g. 56, LuaJIT-like) →
   start recording at that bytecode (the trace anchor).

2. **Trace recorder** (task 14). Re-enter the interpreter in "recording" mode: for each executed
   bytecode, (a) do the normal interpretation, (b) emit a trace-IR node capturing OBSERVED types
   (guard: this JSValue is int32 / is a JSObject of shape S / is interned string X / this branch
   taken). Follow the actual control flow (linear trace). Stop at: loop back to anchor (loop trace),
   trace-length cap, or an UNSUPPORTED bytecode (abort trace, stay interpreted). Supporting only the
   ~30–50 bytecodes our game loops use (numeric ops, array get/set, string ===, get/put_field on
   stable shapes, for/while) keeps the recorder small; everything else safely aborts.

3. **Trace IR + optimizer** (task 15). SSA-ish linear IR. Passes: type-lowering (int-tagged JSValue
   → unboxed i64/f64 given guards), constant folding, CSE, loop-invariant hoisting (array base,
   lengths, TILE), array-bounds-check elimination when provable, allocation sinking. This is where
   the 5–10× comes from — the guarded types let us drop the dynamic dispatch.

4. **MIR lowering** (task 15). Emit MIR insns per optimized IR node (see `mir-tests/api-loop.h` for
   the builder pattern: `MIR_new_func`, `MIR_new_insn(MIR_ADD/MUL/BLT…)`, labels, `MIR_gen`).
   Guards → `MIR_BNE`/`MIR_BGE` to a side-exit stub carrying a snapshot id. `MIR_gen(ctx,func)`
   returns the native trace entry; store in a trace table keyed by anchor PC.

5. **Deopt / snapshots** (task 16 — hardest). At each guard, record a snapshot: the map from
   IR values → interpreter VM registers/stack slots at that point. Side-exit stub: materialize the
   snapshot back into the QuickJS frame (JSValues, correct **refcounts**) and jump to the interpreter
   at the guard's bytecode PC. Refcounting is the correctness minefield — traces manipulate unboxed
   values, so we must re-box + adjust refcounts exactly on exit. Gate every game against the
   differential harness (bit-exact vs the pure interpreter) — a JIT bug = a gate failure, never a
   silent divergence.

## Dispatch
`JSFunctionBytecode` gets a per-anchor trace table (cf. quickjit's `jitcode` field). In
`JS_CallInternal`, at a loop back-edge whose anchor has a compiled trace, jump into the native trace;
it runs until a side-exit returns control (with a PC) to the interpreter.

## IR-builder notes — real quickjs-ng bytecode is OPTIMIZED (grounded from handlers)
The peephole optimizer emits fused ops, not textbook get_loc/add/put_loc. Exact semantics
(from quickjs.c handlers) the int IR-builder must model:
- locals in `var_buf[idx]`, args in `arg_buf[idx]` (frame layout matters for marshaling).
- `add_loc idx` (1-byte operand): `var_buf[idx] += pop()` — fused local add.
- `get_loc_check idx` / `put_loc_check idx` (2-byte): var_buf load/store + TDZ check
  (`JS_IsUninitialized`); in a hot loop always initialized → compile as load/store + a
  one-time entry guard (or ignore for int).
- `get_arg/put_arg/set_arg idx` (2-byte): arg_buf load / store(pop) / store(peek, no pop).
- `push_const8 idx` (1-byte): push `b->cpool[idx]` (read its int value at build time).
- `push_minus1..push_7`: push immediate int. `post_inc`: int fast path (else float).
- CORRECTNESS: QuickJS `add/sub/mul` promote int→float on **overflow** — the int trace MUST
  guard overflow (MIR_ADDO/SUBO/MULO → side-exit) to match. Exits at stack-empty points
  (loop condition) resume with empty operand stack → only var_buf/arg_buf need restoring.

## Scope discipline
Trace only hot loops; support a bytecode subset; abort/deopt on everything else. Correctness is the
interpreter + gate; the JIT only ever makes correct code faster or safely bails. Base = quickjs-ng
(we build it already). Targets: arm64 (dev) + x86_64 (sapphire) — MIR supports both.
