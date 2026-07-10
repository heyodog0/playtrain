// qjit_ir.c — lower trace IR to a native loop via MIR. See qjit_ir.h.
#include "qjit_ir.h"
#include "mir.h"
#include "mir-gen.h"
#include <stdio.h>
#include <stdlib.h>

static MIR_context_t g_ctx = NULL;

// heap struct offsets (set by host or tests before compiling a heap trace)
QjitLayout qjit_layout = {0};

// IR_CALL support: a scratch buffer the trace fills with boxed-int args (synchronous,
// consumed by the helper before any re-entry) + the registered host call helper.
int64_t qjit_argbuf[16];
static void *g_call_helper = NULL;
void qjit_set_call_helper(void *fn) { g_call_helper = fn; }
static void *g_streq_helper = NULL;
void qjit_set_streq_helper(void *fn) { g_streq_helper = fn; }

void qjit_ir_init(void) {
  if (g_ctx) return;
  g_ctx = MIR_init();
  MIR_gen_init(g_ctx);
  MIR_gen_set_optimize_level(g_ctx, 2);
}
void qjit_ir_finish(void) {
  if (!g_ctx) return;
  MIR_gen_finish(g_ctx);
  MIR_finish(g_ctx);
  g_ctx = NULL;
}

static int trace_counter = 0;

qjit_trace_fn qjit_ir_compile(const IRInsn *ir, int n, int n_exits) {
  // Heap ops bake qjit_layout (struct offsets) into the emitted addressing. If the
  // layout was never initialized (jsvalue_size==0), refuse to compile — otherwise the
  // trace would compute idx*0 -> a constant element address and deopt-thrash. The host
  // MUST set qjit_layout before compiling a heap trace; failing closed keeps us on the
  // (correct) interpreter instead of emitting silently-wrong code.
  if (qjit_layout.jsvalue_size == 0)
    for (int i = 0; i < n; i++)
      if (ir[i].op == IR_ARRAY_COUNT || ir[i].op == IR_ARRAY_VALUES ||
          ir[i].op == IR_GUARD_BOUNDS || ir[i].op == IR_ARRAY_EL_INT)
        return NULL;
  // a trace with IR_CALL / IR_STREQ_EL needs its registered host helper; fail closed.
  int has_call = 0, has_streq = 0;
  for (int i = 0; i < n; i++) {
    if (ir[i].op == IR_CALL) has_call = 1;
    if (ir[i].op == IR_STREQ_EL) has_streq = 1;
  }
  if (has_call && !g_call_helper) return NULL;
  if (has_streq && !g_streq_helper) return NULL;

  qjit_ir_init();
  MIR_context_t ctx = g_ctx;
  char mname[32], fname[32];
  snprintf(mname, sizeof mname, "tm%d", trace_counter);
  snprintf(fname, sizeof fname, "trace%d", trace_counter++);
  MIR_module_t m = MIR_new_module(ctx, mname);

  // int64 trace(int64 locals_ptr)
  MIR_type_t res = MIR_T_I64;
  MIR_item_t func = MIR_new_func(ctx, fname, 1, &res, 1, MIR_T_I64, "L");
  MIR_reg_t Lp = MIR_reg(ctx, "L", func->u.func);

  // one MIR reg per IR value-producing insn
  MIR_reg_t *reg = calloc(n, sizeof(MIR_reg_t));
  for (int i = 0; i < n; i++) {
    if (ir[i].op == IR_LOAD_LOC || ir[i].op == IR_CONST || ir[i].op == IR_ADD ||
        ir[i].op == IR_SUB || ir[i].op == IR_MUL || ir[i].op == IR_ADD_SAFE ||
        ir[i].op == IR_ARRAY_COUNT || ir[i].op == IR_ARRAY_VALUES || ir[i].op == IR_ARRAY_EL_INT ||
        ir[i].op == IR_STREQ_EL) {
      char rn[24]; snprintf(rn, sizeof rn, "v%d", i);
      reg[i] = MIR_new_func_reg(ctx, func->u.func, MIR_T_I64, rn);
    }
  }

  // REGISTER PROMOTION: keep each referenced local slot in a MIR reg across the
  // loop; load once before the loop, flush to memory only at side-exits. Turns
  // the memory-bound loop into a register loop (native speed).
  int max_slot = -1;
  for (int i = 0; i < n; i++)
    if ((ir[i].op == IR_LOAD_LOC || ir[i].op == IR_STORE_LOC) && ir[i].slot > max_slot) max_slot = ir[i].slot;
  int n_slots = max_slot + 1;
  MIR_reg_t *sreg = calloc(n_slots > 0 ? n_slots : 1, sizeof(MIR_reg_t));
  char *used = calloc(n_slots > 0 ? n_slots : 1, 1);
  for (int i = 0; i < n; i++)
    if (ir[i].op == IR_LOAD_LOC || ir[i].op == IR_STORE_LOC) used[ir[i].slot] = 1;
  for (int s = 0; s < n_slots; s++)
    if (used[s]) { char rn[24]; snprintf(rn, sizeof rn, "s%d", s); sreg[s] = MIR_new_func_reg(ctx, func->u.func, MIR_T_I64, rn); }

  // scratch regs for heap address arithmetic (element addr = base + idx*size)
  MIR_reg_t h0 = MIR_new_func_reg(ctx, func->u.func, MIR_T_I64, "h0");
  MIR_reg_t h1 = MIR_new_func_reg(ctx, func->u.func, MIR_T_I64, "h1");

  // IR_CALL infrastructure (only if the trace calls out): a proto + import for the
  // host helper int64 qjit_call_global(int64 atom, int64 argc, int64* argv), a reg
  // holding &qjit_argbuf, and a reg for the (discarded) result.
  MIR_item_t call_proto = NULL, call_import = NULL;
  MIR_reg_t cargv = 0, cres = 0;
  if (has_call) {
    MIR_type_t rt = MIR_T_I64;
    call_proto = MIR_new_proto(ctx, "qjit_call_p", 1, &rt, 3,
                               MIR_T_I64, "atom", MIR_T_I64, "argc", MIR_T_P, "argv");
    call_import = MIR_new_import(ctx, "qjit_call_global");
    cargv = MIR_new_func_reg(ctx, func->u.func, MIR_T_I64, "cargv");
    cres  = MIR_new_func_reg(ctx, func->u.func, MIR_T_I64, "cres");
  }
  // IR_STREQ_EL infrastructure: proto+import for int64 qjit_streq_atom(void* elem, int64 atom).
  MIR_item_t streq_proto = NULL, streq_import = NULL;
  if (has_streq) {
    MIR_type_t rt = MIR_T_I64;
    streq_proto = MIR_new_proto(ctx, "qjit_streq_p", 1, &rt, 2, MIR_T_P, "elem", MIR_T_I64, "atom");
    streq_import = MIR_new_import(ctx, "qjit_streq_atom");
  }

  MIR_label_t *exit_lab = calloc(n_exits, sizeof(MIR_label_t));   // control-flow exits (flush)
  for (int e = 0; e < n_exits; e++) exit_lab[e] = MIR_new_label(ctx);
  MIR_label_t deopt = MIR_new_label(ctx);                         // overflow/type deopt (no flush)
  MIR_label_t deopt_b = MIR_new_label(ctx), deopt_t = MIR_new_label(ctx); // diag: bounds/tag

#define APP(insn) MIR_append_insn(ctx, func, (insn))
#define MEM(slot) MIR_new_mem_op(ctx, MIR_T_I64, (MIR_disp_t)((slot) * 8), Lp, 0, 1)
#define R(i) MIR_new_reg_op(ctx, reg[i])
#define SR(s) MIR_new_reg_op(ctx, sreg[s])
// Flush only VARIANT slots: invariant slots are never modified by the body, so
// var_buf already holds their (iteration-start == final) value — no store needed.
// This is the hot per-iteration cost, so keeping it minimal matters.
#define FLUSH() do { for (int s = 0; s < n_slots; s++) if (used[s] && !slot_inv[s]) APP(MIR_new_insn(ctx, MIR_MOV, MEM(s), SR(s))); } while (0)

  // LICM: a slot is loop-invariant if never stored; a value insn is invariant if it
  // only depends on invariant inputs (LOAD_LOC of an invariant slot, CONST, or an
  // ARRAY_COUNT/ARRAY_VALUES on an invariant base). Invariant value insns (no
  // side-effects) are hoisted before the loop top and computed ONCE. Element loads,
  // guards, stores and arithmetic on the induction var stay in the body.
  char *slot_inv = calloc(n_slots > 0 ? n_slots : 1, 1);
  for (int s = 0; s < n_slots; s++) slot_inv[s] = used[s];
  for (int i = 0; i < n; i++) if (ir[i].op == IR_STORE_LOC) slot_inv[ir[i].slot] = 0;
  char *inv = calloc(n > 0 ? n : 1, 1);
  int hoist = !getenv("QJIT_NOHOIST");
  for (int i = 0; hoist && i < n; i++) {
    switch (ir[i].op) {
      case IR_CONST:        inv[i] = 1; break;
      case IR_LOAD_LOC:     inv[i] = slot_inv[ir[i].slot]; break;
      case IR_ARRAY_COUNT:
      case IR_ARRAY_VALUES: inv[i] = inv[ir[i].a]; break;
      default:              inv[i] = 0; break;   // arith/element/guard/store/loop: in body
    }
  }

  // prologue: load referenced slots from memory into slot-regs (once)
  for (int s = 0; s < n_slots; s++)
    if (used[s]) APP(MIR_new_insn(ctx, MIR_MOV, SR(s), MEM(s)));

  MIR_label_t top = MIR_new_label(ctx);
  // Two emission phases: phase 0 hoists invariant value insns (before top, run once);
  // phase 1 is the loop body. `top:`+FLUSH sit between them.
  for (int phase = 0; phase < 2; phase++) {
   if (phase == 1) {
    APP(top);
    // per-iteration sync: var_buf = iteration-START (slot-regs hold last committed values).
    // Body mutates only slot-regs, so on an overflow deopt var_buf is the iteration start
    // and the interpreter can safely re-run this iteration (handling int->float promotion).
    FLUSH();
   }
   for (int i = 0; i < n; i++) {
    if (phase == 0 && !inv[i]) continue;   // hoist only invariants
    if (phase == 1 && inv[i])  continue;   // ...already emitted before the loop
    const IRInsn *in = &ir[i];
    switch (in->op) {
      case IR_LOAD_LOC:  APP(MIR_new_insn(ctx, MIR_MOV, R(i), SR(in->slot))); break;
      case IR_STORE_LOC: APP(MIR_new_insn(ctx, MIR_MOV, SR(in->slot), R(in->a))); break;
      case IR_CONST:     APP(MIR_new_insn(ctx, MIR_MOV, R(i), MIR_new_int_op(ctx, in->imm))); break;
      // int32 arithmetic with overflow -> deopt (matches QuickJS int->float promotion).
      // The overflow op and its MIR_BO must be adjacent.
      case IR_ADD: APP(MIR_new_insn(ctx, MIR_ADDOS, R(i), R(in->a), R(in->b)));
                   APP(MIR_new_insn(ctx, MIR_BO, MIR_new_label_op(ctx, deopt))); break;
      case IR_SUB: APP(MIR_new_insn(ctx, MIR_SUBOS, R(i), R(in->a), R(in->b)));
                   APP(MIR_new_insn(ctx, MIR_BO, MIR_new_label_op(ctx, deopt))); break;
      case IR_MUL: APP(MIR_new_insn(ctx, MIR_MULOS, R(i), R(in->a), R(in->b)));
                   APP(MIR_new_insn(ctx, MIR_BO, MIR_new_label_op(ctx, deopt))); break;
      case IR_ADD_SAFE: APP(MIR_new_insn(ctx, MIR_ADD, R(i), R(in->a), R(in->b))); break; // no overflow guard (proven safe)
      case IR_GUARD_LT:  APP(MIR_new_insn(ctx, MIR_BGE, MIR_new_label_op(ctx, exit_lab[in->exit_id]), R(in->a), R(in->b))); break;
      case IR_GUARD_LE:  APP(MIR_new_insn(ctx, MIR_BGT, MIR_new_label_op(ctx, exit_lab[in->exit_id]), R(in->a), R(in->b))); break;
      case IR_GUARD_GT:  APP(MIR_new_insn(ctx, MIR_BLE, MIR_new_label_op(ctx, exit_lab[in->exit_id]), R(in->a), R(in->b))); break;
      case IR_GUARD_GE:  APP(MIR_new_insn(ctx, MIR_BLT, MIR_new_label_op(ctx, exit_lab[in->exit_id]), R(in->a), R(in->b))); break;
      // --- heap: fast-array int-element load (offsets from qjit_layout) ---
      case IR_ARRAY_COUNT:  // r = (u32)*(base + count_off)  -> zero-extended into i64
        APP(MIR_new_insn(ctx, MIR_MOV, R(i),
              MIR_new_mem_op(ctx, MIR_T_U32, qjit_layout.arr_count_off, reg[in->a], 0, 1))); break;
      case IR_ARRAY_VALUES: // r = *(void**)(base + values_off)
        APP(MIR_new_insn(ctx, MIR_MOV, R(i),
              MIR_new_mem_op(ctx, MIR_T_I64, qjit_layout.arr_values_off, reg[in->a], 0, 1))); break;
      case IR_GUARD_BOUNDS: // if (u32)idx >= (u32)count -> deopt  (negative idx -> huge -> deopt)
        APP(MIR_new_insn(ctx, MIR_UBGES, MIR_new_label_op(ctx, deopt_b), R(in->a), R(in->b))); break;
      case IR_ARRAY_EL_INT: // elem = values + idx*size; guard tag==INT; r = (i32)elem.u.int32
        APP(MIR_new_insn(ctx, MIR_MUL, MIR_new_reg_op(ctx, h0), R(in->b),
              MIR_new_int_op(ctx, qjit_layout.jsvalue_size)));               // h0 = idx*size
        APP(MIR_new_insn(ctx, MIR_ADD, MIR_new_reg_op(ctx, h1), R(in->a),
              MIR_new_reg_op(ctx, h0)));                                     // h1 = values + h0
        APP(MIR_new_insn(ctx, MIR_MOV, MIR_new_reg_op(ctx, h0),
              MIR_new_mem_op(ctx, MIR_T_I32, qjit_layout.jsvalue_tag_off, h1, 0, 1))); // h0 = tag
        APP(MIR_new_insn(ctx, MIR_BNE, MIR_new_label_op(ctx, deopt_t),
              MIR_new_reg_op(ctx, h0), MIR_new_int_op(ctx, qjit_layout.tag_int)));     // tag!=INT -> deopt
        APP(MIR_new_insn(ctx, MIR_MOV, R(i),
              MIR_new_mem_op(ctx, MIR_T_I32, 0, h1, 0, 1)));                 // r = elem.u.int32 (sign-ext)
        break;
      case IR_STREQ_EL: { // elem = values + idx*size; r = qjit_streq_atom(&elem, atom)
        APP(MIR_new_insn(ctx, MIR_MUL, MIR_new_reg_op(ctx, h0), R(in->b),
              MIR_new_int_op(ctx, qjit_layout.jsvalue_size)));               // h0 = idx*size
        APP(MIR_new_insn(ctx, MIR_ADD, MIR_new_reg_op(ctx, h1), R(in->a),
              MIR_new_reg_op(ctx, h0)));                                     // h1 = &elem
        APP(MIR_new_call_insn(ctx, 5,
              MIR_new_ref_op(ctx, streq_proto), MIR_new_ref_op(ctx, streq_import),
              R(i),                                                          // result 0/1
              MIR_new_reg_op(ctx, h1),                                       // &elem
              MIR_new_int_op(ctx, in->imm)));                                // atom
      } break;
      case IR_GUARD_TRUE: // if r(a) == 0 side-exit (flush + resume) — for if_false on a bool
        APP(MIR_new_insn(ctx, MIR_BEQ, MIR_new_label_op(ctx, exit_lab[in->exit_id]),
              R(in->a), MIR_new_int_op(ctx, 0))); break;
      case IR_CALL: {   // fill qjit_argbuf with boxed-int args, call helper(atom, argc, &argbuf)
        APP(MIR_new_insn(ctx, MIR_MOV, MIR_new_reg_op(ctx, cargv),
              MIR_new_int_op(ctx, (int64_t)(intptr_t)qjit_argbuf)));          // cargv = &qjit_argbuf
        for (int k = 0; k < in->argc; k++)
          APP(MIR_new_insn(ctx, MIR_MOV,
                MIR_new_mem_op(ctx, MIR_T_I64, (MIR_disp_t)(k * 8), cargv, 0, 1),
                R(in->argv[k])));                                            // argbuf[k] = arg (int)
        APP(MIR_new_call_insn(ctx, 6,
              MIR_new_ref_op(ctx, call_proto), MIR_new_ref_op(ctx, call_import),
              MIR_new_reg_op(ctx, cres),                                     // result (discarded)
              MIR_new_int_op(ctx, in->imm),                                  // atom
              MIR_new_int_op(ctx, in->argc),                                 // argc
              MIR_new_reg_op(ctx, cargv)));                                  // argv
      } break;
      case IR_LOOP:      APP(MIR_new_insn(ctx, MIR_JMP, MIR_new_label_op(ctx, top))); break;
    }
   }
  }
  // control-flow exits: flush slot-regs (commit values up to this point), ret exit id
  for (int e = 0; e < n_exits; e++) { APP(exit_lab[e]); FLUSH(); APP(MIR_new_ret_insn(ctx, 1, MIR_new_int_op(ctx, e))); }
  // deopt exit: do NOT flush (var_buf already = iteration-start); ret negative (reason code)
  APP(deopt);   APP(MIR_new_ret_insn(ctx, 1, MIR_new_int_op(ctx, QJIT_DEOPT)));        // overflow/type
  APP(deopt_b); APP(MIR_new_ret_insn(ctx, 1, MIR_new_int_op(ctx, QJIT_DEOPT_BOUNDS))); // array bounds
  APP(deopt_t); APP(MIR_new_ret_insn(ctx, 1, MIR_new_int_op(ctx, QJIT_DEOPT_TAG)));    // element non-int
  free(sreg); free(used); free(slot_inv); free(inv);
#undef APP
#undef MEM
#undef R
#undef SR
  MIR_finish_func(ctx);
  MIR_finish_module(ctx);
  MIR_load_module(ctx, m);
  if (has_call)  MIR_load_external(ctx, "qjit_call_global", g_call_helper);  // bind imports
  if (has_streq) MIR_load_external(ctx, "qjit_streq_atom", g_streq_helper);
  MIR_link(ctx, MIR_set_gen_interface, NULL);
  void *code = MIR_gen(ctx, func);
  free(reg); free(exit_lab);
  return (qjit_trace_fn)code;
}
