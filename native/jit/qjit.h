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
// `anchor_off` = byte offset of the loop-header (branch target) in b's bytecode.
void qjit_backedge(const void *b, int32_t anchor_off);

// Print the hottest loops (needs ctx to resolve function names). Call at shutdown.
void qjit_report(void *ctx);

// Provided by quickjs.c: resolve a JSFunctionBytecode* to its function name.
const char *qjit_fn_name(void *ctx, const void *b);

#ifdef __cplusplus
}
#endif
#endif
