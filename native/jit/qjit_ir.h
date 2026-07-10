// qjit_ir.h — trace IR + MIR codegen for the QuickJS tracing JIT.
//
// A recorded loop trace lowers to this linear SSA-ish IR, which is then compiled
// to a native loop by MIR. Values live in a `locals` array (the specialized view
// of the QuickJS frame's int slots); loads/stores are memory ops MIR can hoist.
// Guards compile to conditional branches to side-exit blocks that RETURN an exit
// id — the interpreter deopts by resuming at that exit's bytecode PC.
//
// Stage 15/16 scope: INTEGER loops only (ints are tagged immediates in QuickJS →
// no refcounting), so the fast path is provably correct + the deopt is trivial.
#ifndef QJIT_IR_H
#define QJIT_IR_H
#include <stdint.h>
#include <stddef.h>

typedef enum {
  IR_LOAD_LOC,   // r = locals[slot]
  IR_STORE_LOC,  // locals[slot] = r(a)
  IR_CONST,      // r = imm
  IR_ADD, IR_SUB, IR_MUL,       // r = r(a) op r(b)
  IR_GUARD_LT,   // if !(r(a) <  r(b)) side-exit exit_id
  IR_GUARD_GE,   // if !(r(a) >= r(b)) side-exit exit_id
  IR_GUARD_LE,   // if !(r(a) <= r(b)) side-exit exit_id
  IR_LOOP        // jump to trace top (loop back-edge)
} IROp;

typedef struct {
  IROp op;
  int a, b;       // operand IR-value indices (for value/guard ops)
  int slot;       // local slot (LOAD/STORE)
  int64_t imm;    // CONST
  int exit_id;    // GUARD
} IRInsn;

// Native trace signature: run the loop over `locals`, return the exit id taken.
typedef int64_t (*qjit_trace_fn)(int64_t *locals);

// Compile an IR trace to a native function via MIR. n_exits = number of distinct
// exit ids used by guards. Returns NULL on failure. Not thread-safe (one ctx).
qjit_trace_fn qjit_ir_compile(const IRInsn *ir, int n, int n_exits);

// One-time init/teardown of the MIR context used by qjit_ir_compile.
void qjit_ir_init(void);
void qjit_ir_finish(void);

#endif
