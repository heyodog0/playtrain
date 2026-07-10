// qjit.h — runtime tracing JIT for quickjs-ng (stage 1: hot-loop detection).
// The interpreter (quickjs.c) calls qjit_backedge() on every BACKWARD branch
// (loop back-edge). We count per (function, loop-header) and surface the hottest
// loops — the future trace anchors. See native/jit/DESIGN.md.
#ifndef QJIT_H
#define QJIT_H
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

// Called from JS_CallInternal on a backward branch. `b` = JSFunctionBytecode*,
// `source_off` = the back-branch instruction offset (loop bottom), `target_off` =
// the loop-header offset (branch target). The loop body is [target_off, source_off].
void qjit_backedge(const void *b, int32_t source_off, int32_t target_off);

// Stage 2 — trace recording. When a loop goes hot, qjit_backedge arms recording;
// the interpreter's dispatch calls qjit_record() per bytecode (guarded by the hot
// global qjit_rec_active so steady-state cost is one predicted-untaken branch).
extern int qjit_rec_active;
void qjit_record(const void *b, int32_t off, int opcode);
const char *qjit_opcode_name(int op);  // provided by quickjs.c (opcode_info table)

// Print the hottest loops (needs ctx to resolve function names). Call at shutdown.
void qjit_report(void *ctx);

// Provided by quickjs.c: resolve a JSFunctionBytecode* to its function name.
const char *qjit_fn_name(void *ctx, const void *b);

#ifdef __cplusplus
}
#endif
#endif
