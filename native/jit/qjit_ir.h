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
  IR_GUARD_LE,   // if !(r(a) <= r(b)) side-exit exit_id
  IR_GUARD_GT,   // if !(r(a) >  r(b)) side-exit exit_id
  IR_GUARD_GE,   // if !(r(a) >= r(b)) side-exit exit_id
  IR_LOOP        // jump to trace top (loop back-edge)
} IROp;

typedef struct {
  IROp op;
  int a, b;       // operand IR-value indices (for value/guard ops)
  int slot;       // local slot (LOAD/STORE)
  int64_t imm;    // CONST
  int exit_id;    // GUARD
} IRInsn;

// Native trace signature: run the loop over `locals`, return the exit taken:
//   >= 0            -> control-flow exit id (locals flushed; resume at that exit's PC)
//   QJIT_DEOPT (-1) -> overflow/type deopt (locals = iteration-START; resume at header,
//                      i.e. re-run this iteration in the interpreter)
typedef int64_t (*qjit_trace_fn)(int64_t *locals);
#define QJIT_DEOPT ((int64_t)-1)

// Compile an IR trace to a native function via MIR. n_exits = number of distinct
// exit ids used by guards. Returns NULL on failure. Not thread-safe (one ctx).
qjit_trace_fn qjit_ir_compile(const IRInsn *ir, int n, int n_exits);

// One-time init/teardown of the MIR context used by qjit_ir_compile.
void qjit_ir_init(void);
void qjit_ir_finish(void);

// ---------------------------------------------------------------------------
// IR BUILDER: recorded trace (QOp sequence) -> trace IR (abstract-stack -> SSA).
// QOp is a small engine-independent opcode set; the live recorder maps quickjs-ng
// OP_* -> QOp (capturing operands + resolving push_const to its int value), and
// unit tests construct QOp sequences directly. Anything not in this set -> abort
// (build returns nonzero) so the loop stays interpreted (correct).
// ---------------------------------------------------------------------------
typedef enum {
  Q_GET_LOC,    // push locals[slot]                (operand: slot)
  Q_PUT_LOC,    // locals[slot] = pop               (operand: slot)
  Q_SET_LOC,    // locals[slot] = peek (NO pop)     (operand: slot)   [set_loc/set_arg]
  Q_ADD_LOC,    // locals[slot] += pop              (operand: slot)   [fused]
  Q_PUSH_INT,   // push imm                         (operand: imm)
  Q_ADD, Q_SUB, Q_MUL,  // b=pop,a=pop, push a op b
  Q_LT, Q_LE, Q_GT, Q_GE, // b=pop,a=pop, push compare(a,b)  (consumed by IF)
  Q_IF_FALSE,   // pop compare; guard: continue iff TRUE, side-exit(exit_pc) iff false
  Q_GOTO_LOOP,  // loop back-edge -> IR_LOOP        (operand: -)
  Q_DROP,       // pop
  Q_DUP,        // push top
  Q_NOP         // label / no-op
} QOp;

typedef struct {
  QOp op;
  int slot;        // GET/PUT/ADD_LOC
  int64_t imm;     // PUSH_INT
  int32_t exit_pc; // IF_FALSE resume PC (maps to an exit id)
} TraceOp;

// Build IR from a QOp sequence. Writes up to `max_ir` IRInsn into `ir`, sets
// *ir_n and *n_exits. Returns 0 on success, nonzero on abort (unsupported op /
// stack underflow / control shape not handled).
// out_exit_pcs (may be NULL): filled with exit-id -> resume bytecode PC (from the
// IF_FALSE exit_pc values, in the same id order the codegen uses).
int qjit_build_ir(const TraceOp *ops, int n_ops, IRInsn *ir, int max_ir,
                  int *ir_n, int *n_exits, int32_t *out_exit_pcs);

#endif
