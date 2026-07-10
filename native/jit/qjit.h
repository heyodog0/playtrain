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

// ---- stage 3: live trace store + entry (recorder -> compiled trace -> run) ----
// After a trace is recorded, quickjs.c reads it via these getters, decodes operands,
// builds+compiles it, and stores it keyed by (b, anchor). At a hot back-edge it looks
// the trace up and runs it (marshaling int locals), else falls back to the interpreter.
int         qjit_rec_ready(void);          // a freshly-recorded trace is available
const void *qjit_rec_b(void);
int         qjit_rec_anchor_off(void);
int         qjit_rec_count(void);          // number of recorded bytecodes
int         qjit_rec_off(int i);           // bytecode offset of recorded op i
int         qjit_rec_opcode(int i);        // opcode of recorded op i
void        qjit_rec_consume(void);        // clear rec_ready (compiled or rejected)

// A compiled trace + the metadata quickjs.c needs to marshal/resume.
typedef struct {
  const void *b; int32_t anchor; int valid;
  void *fn;                        // qjit_trace_fn
  int n_live;                      // number of live frame slots (L[] layout)
  unsigned char live_is_arg[64];   // per L index: 1 = arg_buf, 0 = var_buf
  int          live_idx[64];       // per L index: frame slot index
  int n_exits; int32_t exit_pc[8]; // exit id -> resume bytecode offset
} QjitTrace;

// Build IR-provided trace (already compiled by qjit_ir_compile) into the table.
void       qjit_store_trace(const QjitTrace *t);
QjitTrace *qjit_lookup_trace(const void *b, int32_t anchor);

#ifdef __cplusplus
}
#endif
#endif
