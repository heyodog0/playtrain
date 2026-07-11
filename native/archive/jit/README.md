# Archived: custom tracing JIT for QuickJS (archived 2026-07-11)

This is the profile-guided tracing JIT for the embedded QuickJS host
(`qjs_host`). It was **archived, not deleted**, because it is not currently
paying off:

- It is **off by default** (`QJIT_ENABLE`-gated in `qjit_try_enter`).
- When enabled it is a **net slowdown** on the render-bound ProcGen-clone games
  (~5% slower on coinrun; the workload is rasterizer-bound, so JIT'ing the game
  logic — already ~0.5% of a frame — cannot help and its back-edge counting +
  trace-entry marshaling costs). See `../../HANDOFF-coinrun-perf.md`.

The bit-exact interpreter + native rasterizer stack (stock quickjs-ng) is the
current baseline. The path to beating ProcGen on the tile-heavy games bit-exactly
is **AOT** (`../../compile/transpile.mjs`), not this in-interpreter JIT.

## Contents
- `qjit.c` — stage 1/2: hot-loop back-edge detection + trace recorder.
- `qjit_build.c` — recorded bytecode trace → SSA IR.
- `qjit_ir.{c,h}` — IR + MIR-backend codegen.
- `quickjs-qjit.patch` — instrumentation hooks into `quickjs.c` (`JS_CallInternal`
  back-edges, per-op `QJIT_REC`).
- `qjit_*_test.c`, `test_*.js`, `fuzz_jit.mjs` — unit/differential/fuzz harnesses.
- `DESIGN.md`, `HEAP_DESIGN.md`, `OPCODES.md` — design notes.

**Not archived (regenerable):** the vendored MIR backend (`mir/`, ~98 MB — re-clone
from https://github.com/vnmakarov/mir and `make` `libmir.a`), the `fuzz*/` corpora,
and all `*.o`.

## To restore into the build
1. `git mv native/archive/jit native/jit`
2. Re-fetch/build MIR into `native/jit/mir/` (need `libmir.a` + `mir.h`).
3. In `native/build_qjs.sh`, restore (see git history for commit that archived this):
   - apply `jit/quickjs-qjit.patch` to `qjs/src` before building QuickJS objects,
   - compile `qjit.o`, `qjit_ir.o`, `qjit_build.o`,
   - `ar` them into `libqjs.a`,
   - add `-I jit` and `jit/mir/libmir.a` to the final `clang++` link.
4. In `native/qjs/qjs_host.cpp`, restore `#include "../jit/qjit.h"` and the
   `if (getenv("QJIT_REPORT")) qjit_report(ctx);` line in bench mode.
5. `rm native/qjs/bld/libqjs.a` and rebuild.
