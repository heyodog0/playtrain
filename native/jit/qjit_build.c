// qjit_build.c — IR builder: recorded QOp trace -> trace IR via abstract-stack
// interpretation (LuaJIT-style: the operand stack is tracked as IR value refs;
// compare+branch fuse into a guard). Conservative: any unhandled shape aborts
// (returns nonzero) so the loop stays interpreted — never miscompiles.
#include "qjit_ir.h"

// abstract operand-stack entry: either an IR value ref, or a pending comparison
typedef struct { int is_cmp; int ref; int cmp_kind; int a, b; } StkEnt;

// map an exit resume-PC to a dense exit id (small number of exits per trace)
static int exit_id_for(int32_t pc, int32_t *pcs, int *n) {
  for (int i = 0; i < *n; i++) if (pcs[i] == pc) return i;
  pcs[*n] = pc; return (*n)++;
}

int qjit_build_ir(const TraceOp *ops, int n_ops, IRInsn *ir, int max_ir,
                  int *ir_n, int *n_exits, int32_t *out_exit_pcs,
                  unsigned char *out_slot_kind) {
  StkEnt stk[256]; int sp = 0;
  int32_t exit_pcs[32]; int nx = 0;
  int n = 0;  // ir length

#define EMIT0(o)          (ir[n] = (IRInsn){.op=o}, n++)
#define FAIL()            do { return 1; } while (0)
#define NEED(k)           do { if (sp < (k)) FAIL(); } while (0)
#define ROOM(k)           do { if (n + (k) > max_ir || sp + 1 > 256) FAIL(); } while (0)
#define PUSHV(r)          do { stk[sp].is_cmp = 0; stk[sp].ref = (r); sp++; } while (0)

  // helper: emit a value-producing insn, return its ir index
  // (kept inline via macros below to keep operand wiring explicit)

  for (int i = 0; i < n_ops; i++) {
    const TraceOp *t = &ops[i];
    switch (t->op) {
      case Q_GET_LOC: {
        ROOM(1); ir[n] = (IRInsn){.op = IR_LOAD_LOC, .slot = t->slot}; int r = n++; PUSHV(r);
      } break;
      case Q_PUSH_INT: {
        ROOM(1); ir[n] = (IRInsn){.op = IR_CONST, .imm = t->imm}; int r = n++; PUSHV(r);
      } break;
      case Q_PUT_LOC: {
        NEED(1); if (stk[sp-1].is_cmp) FAIL(); int a = stk[--sp].ref;
        ROOM(1); ir[n++] = (IRInsn){.op = IR_STORE_LOC, .slot = t->slot, .a = a};
      } break;
      case Q_SET_LOC: {  // store top, leave it on the stack (set_loc/set_arg)
        NEED(1); if (stk[sp-1].is_cmp) FAIL(); int a = stk[sp-1].ref;
        ROOM(1); ir[n++] = (IRInsn){.op = IR_STORE_LOC, .slot = t->slot, .a = a};
      } break;
      case Q_ADD_LOC: {  // locals[slot] += pop
        NEED(1); if (stk[sp-1].is_cmp) FAIL(); int a = stk[--sp].ref;
        ROOM(3);
        ir[n] = (IRInsn){.op = IR_LOAD_LOC, .slot = t->slot}; int ld = n++;
        ir[n] = (IRInsn){.op = IR_ADD, .a = ld, .b = a}; int su = n++;
        ir[n++] = (IRInsn){.op = IR_STORE_LOC, .slot = t->slot, .a = su};
      } break;
      case Q_ADD: case Q_SUB: case Q_MUL: {
        NEED(2); if (stk[sp-1].is_cmp || stk[sp-2].is_cmp) FAIL();
        int b = stk[--sp].ref, a = stk[--sp].ref;
        IROp o = t->op == Q_ADD ? IR_ADD : t->op == Q_SUB ? IR_SUB : IR_MUL;
        ROOM(1); ir[n] = (IRInsn){.op = o, .a = a, .b = b}; int r = n++; PUSHV(r);
      } break;
      case Q_LT: case Q_LE: case Q_GT: case Q_GE: {
        NEED(2); if (stk[sp-1].is_cmp || stk[sp-2].is_cmp) FAIL();
        int b = stk[--sp].ref, a = stk[--sp].ref;
        stk[sp].is_cmp = 1; stk[sp].cmp_kind = t->op; stk[sp].a = a; stk[sp].b = b; sp++;
      } break;
      case Q_IF_FALSE: {  // exit iff compare FALSE, continue iff TRUE
        NEED(1); if (!stk[sp-1].is_cmp) FAIL();
        StkEnt c = stk[--sp];
        int eid = exit_id_for(t->exit_pc, exit_pcs, &nx);
        // guard "continue iff (a cmp b)": direct mapping of the compare kind
        IROp g = c.cmp_kind == Q_LT ? IR_GUARD_LT : c.cmp_kind == Q_LE ? IR_GUARD_LE
               : c.cmp_kind == Q_GT ? IR_GUARD_GT : IR_GUARD_GE;
        ROOM(1); ir[n++] = (IRInsn){.op = g, .a = c.a, .b = c.b, .exit_id = eid};
      } break;
      case Q_GOTO_LOOP: {
        ROOM(1); EMIT0(IR_LOOP);
      } break;
      case Q_GET_ARRAY_EL: {  // arr[idx] -> unboxed int, with array/bounds/int guards
        NEED(2); if (stk[sp-1].is_cmp || stk[sp-2].is_cmp) FAIL();
        int idx = stk[--sp].ref, arr = stk[--sp].ref;
        // increment 1: the array base must come DIRECTLY from a local/arg load (no
        // nested arr[x][y] yet), and its slot is marshaled as a JSObject* (QK_ARRAY).
        if (ir[arr].op != IR_LOAD_LOC) FAIL();
        if (out_slot_kind) out_slot_kind[ir[arr].slot] = QK_ARRAY;
        ROOM(4);
        ir[n] = (IRInsn){.op = IR_ARRAY_COUNT, .a = arr}; int cnt = n++;
        ir[n++] = (IRInsn){.op = IR_GUARD_BOUNDS, .a = idx, .b = cnt};
        ir[n] = (IRInsn){.op = IR_ARRAY_VALUES, .a = arr}; int vals = n++;
        ir[n] = (IRInsn){.op = IR_ARRAY_EL_INT, .a = vals, .b = idx}; int el = n++;
        PUSHV(el);
      } break;
      case Q_DROP: { NEED(1); sp--; } break;
      case Q_DUP:  { NEED(1); if (stk[sp-1].is_cmp) FAIL(); ROOM(0); stk[sp] = stk[sp-1]; sp++; } break;
      case Q_NOP:  break;
      default: FAIL();
    }
  }
  // a well-formed loop trace ends balanced (operand stack empty) with a back-edge
  if (sp != 0) FAIL();
  int has_loop = 0; for (int i = 0; i < n; i++) if (ir[i].op == IR_LOOP) has_loop = 1;
  if (!has_loop) FAIL();
  // safety: an array-base slot (QK_ARRAY) must be loop-invariant — never stored in
  // the loop — else treating it as a fixed JSObject* pointer would be wrong.
  if (out_slot_kind)
    for (int i = 0; i < n; i++)
      if (ir[i].op == IR_STORE_LOC && out_slot_kind[ir[i].slot] == QK_ARRAY) FAIL();

  if (out_exit_pcs) for (int i = 0; i < nx; i++) out_exit_pcs[i] = exit_pcs[i];
  *ir_n = n; *n_exits = nx > 0 ? nx : 1;
  return 0;
#undef EMIT0
#undef FAIL
#undef NEED
#undef ROOM
#undef PUSHV
}
