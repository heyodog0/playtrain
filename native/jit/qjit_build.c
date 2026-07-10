// qjit_build.c — IR builder: recorded QOp trace -> trace IR via abstract-stack
// interpretation (LuaJIT-style: the operand stack is tracked as IR value refs;
// compare+branch fuse into a guard). Conservative: any unhandled shape aborts
// (returns nonzero) so the loop stays interpreted — never miscompiles.
#include "qjit_ir.h"

// abstract operand-stack entry. Exactly one "kind" holds:
//   plain value (default): `ref` is its IR value index
//   is_cmp: a pending integer comparison (fused into a guard by if_false)
//   is_func: a global-fn reference from get_var (consumed by call); `atom` set
//   is_void: a dropped call result
//   is_atom: an interned atom (from push_atom_value); `atom` set (consumed by strict_eq)
//   is_elem: a DEFERRED array element — `e_values`/`e_idx` are the IR refs for the
//            array's values pointer and the index; the consumer materializes it (int
//            load for arithmetic, or a fused strict_eq).
typedef struct { int is_cmp, is_func, is_void, is_atom, is_elem, is_bool;
                 int ref; int cmp_kind; int a, b; int64_t atom; int e_values, e_idx; } StkEnt;

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
  int ind_slot = -1, ind_lt = 0;  // loop-induction slot + whether its guard is strict `<`

#define EMIT0(o)          (ir[n] = (IRInsn){.op=o}, n++)
#define FAIL()            do { return 1; } while (0)
#define NEED(k)           do { if (sp < (k)) FAIL(); } while (0)
#define ROOM(k)           do { if (n + (k) > max_ir || sp + 1 > 256) FAIL(); } while (0)
// Materialize a deferred array element at stack slot `si` into a plain INT value
// (guarded fast-array int load). No-op if already a plain value. Must be called before
// an int consumer reads the operand.
#define MATINT(si) do { if (stk[si].is_elem) { \
    if (n + 1 > max_ir) FAIL(); \
    ir[n] = (IRInsn){.op = IR_ARRAY_EL_INT, .a = stk[si].e_values, .b = stk[si].e_idx}; \
    int _r = n++; stk[si] = (StkEnt){0}; stk[si].ref = _r; } } while (0)
// not a plain int value (after MATINT, is_elem is resolved to a value)
#define NOTVAL(i)         (stk[i].is_cmp || stk[i].is_func || stk[i].is_void || stk[i].is_atom || stk[i].is_elem)
#define PUSHV(r)          do { stk[sp] = (StkEnt){0}; stk[sp].ref = (r); sp++; } while (0)

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
        NEED(1); MATINT(sp-1); if (NOTVAL(sp-1)) FAIL(); int a = stk[--sp].ref;
        ROOM(1); ir[n++] = (IRInsn){.op = IR_STORE_LOC, .slot = t->slot, .a = a};
      } break;
      case Q_SET_LOC: {  // store top, leave it on the stack (set_loc/set_arg)
        NEED(1); MATINT(sp-1); if (NOTVAL(sp-1)) FAIL(); int a = stk[sp-1].ref;
        ROOM(1); ir[n++] = (IRInsn){.op = IR_STORE_LOC, .slot = t->slot, .a = a};
      } break;
      case Q_ADD_LOC: {  // locals[slot] += pop
        NEED(1); MATINT(sp-1); if (NOTVAL(sp-1)) FAIL(); int a = stk[--sp].ref;
        // Safe loop increment: induction slot `+= 1` under a strict `i < n` guard can't
        // overflow (i+1 <= n <= INT_MAX) -> emit guard-free so it may follow a call.
        int safe = (t->slot == ind_slot && ind_lt && ir[a].op == IR_CONST && ir[a].imm == 1);
        ROOM(3);
        ir[n] = (IRInsn){.op = IR_LOAD_LOC, .slot = t->slot}; int ld = n++;
        ir[n] = (IRInsn){.op = safe ? IR_ADD_SAFE : IR_ADD, .a = ld, .b = a}; int su = n++;
        ir[n++] = (IRInsn){.op = IR_STORE_LOC, .slot = t->slot, .a = su};
      } break;
      case Q_ADD: case Q_SUB: case Q_MUL: {
        NEED(2); MATINT(sp-1); MATINT(sp-2); if (NOTVAL(sp-1) || NOTVAL(sp-2)) FAIL();
        int b = stk[--sp].ref, a = stk[--sp].ref;
        IROp o = t->op == Q_ADD ? IR_ADD : t->op == Q_SUB ? IR_SUB : IR_MUL;
        ROOM(1); ir[n] = (IRInsn){.op = o, .a = a, .b = b}; int r = n++; PUSHV(r);
      } break;
      case Q_LT: case Q_LE: case Q_GT: case Q_GE: {
        NEED(2); MATINT(sp-1); MATINT(sp-2); if (NOTVAL(sp-1) || NOTVAL(sp-2)) FAIL();
        int b = stk[--sp].ref, a = stk[--sp].ref;
        stk[sp] = (StkEnt){0}; stk[sp].is_cmp = 1; stk[sp].cmp_kind = t->op; stk[sp].a = a; stk[sp].b = b; sp++;
      } break;
      case Q_IF_FALSE: {  // exit iff FALSE, continue iff TRUE
        NEED(1);
        int eid = exit_id_for(t->exit_pc, exit_pcs, &nx);
        if (!stk[sp-1].is_cmp) {
          // if_false on a boolean VALUE (only a strict_eq result — is_bool): side-exit iff
          // ==0. Reject if_false on arbitrary values (e.g. int truthiness) -> abort, so a
          // degenerate `push k; if_false; loop` can't build a never-exiting trace.
          if (!stk[sp-1].is_bool) FAIL();
          int v = stk[--sp].ref;
          ROOM(1); ir[n++] = (IRInsn){.op = IR_GUARD_TRUE, .a = v, .exit_id = eid};
          break;
        }
        StkEnt c = stk[--sp];
        // guard "continue iff (a cmp b)": direct mapping of the compare kind
        IROp g = c.cmp_kind == Q_LT ? IR_GUARD_LT : c.cmp_kind == Q_LE ? IR_GUARD_LE
               : c.cmp_kind == Q_GT ? IR_GUARD_GT : IR_GUARD_GE;
        // first guard = loop condition: remember the induction slot (guard.a from a load)
        // and whether the test is strict `<` (needed to prove `i+=1` can't overflow).
        if (ind_slot < 0 && ir[c.a].op == IR_LOAD_LOC) { ind_slot = ir[c.a].slot; ind_lt = (c.cmp_kind == Q_LT); }
        ROOM(1); ir[n++] = (IRInsn){.op = g, .a = c.a, .b = c.b, .exit_id = eid};
      } break;
      case Q_GOTO_LOOP: {
        ROOM(1); EMIT0(IR_LOOP);
      } break;
      case Q_GET_ARRAY_EL: {  // arr[idx] -> DEFERRED element (consumer materializes it)
        NEED(2); MATINT(sp-1); if (NOTVAL(sp-1)) FAIL(); if (NOTVAL(sp-2)) FAIL();
        int idx = stk[--sp].ref, arr = stk[--sp].ref;
        // increment 1/2: the array base must come DIRECTLY from a local/arg load (no
        // nested arr[x][y] yet), and its slot is marshaled as a JSObject* (QK_ARRAY).
        if (ir[arr].op != IR_LOAD_LOC) FAIL();
        if (out_slot_kind) out_slot_kind[ir[arr].slot] = QK_ARRAY;
        ROOM(3);
        ir[n] = (IRInsn){.op = IR_ARRAY_COUNT, .a = arr}; int cnt = n++;
        ir[n++] = (IRInsn){.op = IR_GUARD_BOUNDS, .a = idx, .b = cnt};
        ir[n] = (IRInsn){.op = IR_ARRAY_VALUES, .a = arr}; int vals = n++;
        stk[sp] = (StkEnt){0}; stk[sp].is_elem = 1; stk[sp].e_values = vals; stk[sp].e_idx = idx; sp++;
      } break;
      case Q_PUSH_ATOM: {  // interned string atom; only meaningful as a strict_eq operand
        ROOM(0); stk[sp] = (StkEnt){0}; stk[sp].is_atom = 1; stk[sp].atom = t->imm; sp++;
      } break;
      case Q_STREQ: {  // (element === atom) -> 0/1, via the host strict_eq helper
        NEED(2);
        // one operand must be a deferred element, the other an atom (either order)
        StkEnt *e = NULL, *a = NULL;
        if (stk[sp-1].is_elem && stk[sp-2].is_atom) { e = &stk[sp-1]; a = &stk[sp-2]; }
        else if (stk[sp-1].is_atom && stk[sp-2].is_elem) { a = &stk[sp-1]; e = &stk[sp-2]; }
        else FAIL();
        int vals = e->e_values, idx = e->e_idx; int64_t atom = a->atom;
        sp -= 2;
        ROOM(1); ir[n] = (IRInsn){.op = IR_STREQ_EL, .a = vals, .b = idx, .imm = atom}; int r = n++;
        PUSHV(r); stk[sp-1].is_bool = 1;   // a proper boolean (0/1): may feed if_false
      } break;
      case Q_GET_VAR: {  // push a global-fn reference (callable); resolved by name at run time
        ROOM(0); stk[sp] = (StkEnt){0}; stk[sp].is_func = 1; stk[sp].atom = t->imm; sp++;
      } break;
      case Q_CALL: {  // call the fn ref with `slot` int args; side-effect only; push void result
        int argc = t->slot;
        if (argc < 0 || argc > QJIT_MAX_CALL_ARGS) FAIL();
        NEED(argc + 1);
        IRInsn call = (IRInsn){.op = IR_CALL, .argc = argc};
        for (int k = argc - 1; k >= 0; k--) { if (NOTVAL(sp-1)) FAIL(); call.argv[k] = stk[--sp].ref; }
        if (!stk[sp-1].is_func) FAIL();          // callee must be a get_var'd global fn
        call.imm = stk[--sp].atom;               // the global-var atom
        ROOM(1); ir[n++] = call;
        stk[sp] = (StkEnt){0}; stk[sp].is_void = 1; sp++;   // result: void (must be dropped)
      } break;
      case Q_DROP: { NEED(1); sp--; } break;
      case Q_DUP:  { NEED(1); MATINT(sp-1); if (NOTVAL(sp-1)) FAIL(); ROOM(0); stk[sp] = stk[sp-1]; sp++; } break;
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

  // NO DEOPT AFTER CALL: a deopt resumes at the loop header and re-runs the whole
  // iteration — which would re-execute an already-run side-effecting call. So no op
  // that can DEOPT (arith overflow / array bounds / element-type guard) may appear
  // after the first IR_CALL. (IR_ADD_SAFE and control-flow guards never deopt.)
  int first_call = -1;
  for (int i = 0; i < n; i++) if (ir[i].op == IR_CALL) { first_call = i; break; }
  if (first_call >= 0)
    for (int i = first_call + 1; i < n; i++)
      if (ir[i].op == IR_ADD || ir[i].op == IR_SUB || ir[i].op == IR_MUL ||
          ir[i].op == IR_GUARD_BOUNDS || ir[i].op == IR_ARRAY_EL_INT) FAIL();

  if (out_exit_pcs) for (int i = 0; i < nx; i++) out_exit_pcs[i] = exit_pcs[i];
  *ir_n = n; *n_exits = nx > 0 ? nx : 1;
  return 0;
#undef EMIT0
#undef FAIL
#undef NEED
#undef ROOM
#undef PUSHV
}
