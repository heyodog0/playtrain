// qjit_ir.c — lower trace IR to a native loop via MIR. See qjit_ir.h.
#include "qjit_ir.h"
#include "mir.h"
#include "mir-gen.h"
#include <stdio.h>
#include <stdlib.h>

static MIR_context_t g_ctx = NULL;

// heap struct offsets (set by host or tests before compiling a heap trace)
QjitLayout qjit_layout = {0};

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
        ir[i].op == IR_SUB || ir[i].op == IR_MUL ||
        ir[i].op == IR_ARRAY_COUNT || ir[i].op == IR_ARRAY_VALUES || ir[i].op == IR_ARRAY_EL_INT) {
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
  MIR_link(ctx, MIR_set_gen_interface, NULL);
  void *code = MIR_gen(ctx, func);
  free(reg); free(exit_lab);
  return (qjit_trace_fn)code;
}
