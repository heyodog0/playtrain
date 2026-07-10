// qjit_ir.c — lower trace IR to a native loop via MIR. See qjit_ir.h.
#include "qjit_ir.h"
#include "mir.h"
#include "mir-gen.h"
#include <stdio.h>
#include <stdlib.h>

static MIR_context_t g_ctx = NULL;

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
        ir[i].op == IR_SUB || ir[i].op == IR_MUL) {
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

  MIR_label_t *exit_lab = calloc(n_exits, sizeof(MIR_label_t));
  for (int e = 0; e < n_exits; e++) exit_lab[e] = MIR_new_label(ctx);

#define APP(insn) MIR_append_insn(ctx, func, (insn))
#define MEM(slot) MIR_new_mem_op(ctx, MIR_T_I64, (MIR_disp_t)((slot) * 8), Lp, 0, 1)
#define R(i) MIR_new_reg_op(ctx, reg[i])
#define SR(s) MIR_new_reg_op(ctx, sreg[s])

  // prologue: load referenced slots from memory into their slot-regs
  for (int s = 0; s < n_slots; s++)
    if (used[s]) APP(MIR_new_insn(ctx, MIR_MOV, SR(s), MEM(s)));

  MIR_label_t top = MIR_new_label(ctx);
  APP(top);

  for (int i = 0; i < n; i++) {
    const IRInsn *in = &ir[i];
    switch (in->op) {
      case IR_LOAD_LOC:  APP(MIR_new_insn(ctx, MIR_MOV, R(i), SR(in->slot))); break;   // read slot-reg
      case IR_STORE_LOC: APP(MIR_new_insn(ctx, MIR_MOV, SR(in->slot), R(in->a))); break; // write slot-reg
      case IR_CONST:     APP(MIR_new_insn(ctx, MIR_MOV, R(i), MIR_new_int_op(ctx, in->imm))); break;
      case IR_ADD:       APP(MIR_new_insn(ctx, MIR_ADD, R(i), R(in->a), R(in->b))); break;
      case IR_SUB:       APP(MIR_new_insn(ctx, MIR_SUB, R(i), R(in->a), R(in->b))); break;
      case IR_MUL:       APP(MIR_new_insn(ctx, MIR_MUL, R(i), R(in->a), R(in->b))); break;
      case IR_GUARD_LT:  APP(MIR_new_insn(ctx, MIR_BGE, MIR_new_label_op(ctx, exit_lab[in->exit_id]), R(in->a), R(in->b))); break;
      case IR_GUARD_GE:  APP(MIR_new_insn(ctx, MIR_BLT, MIR_new_label_op(ctx, exit_lab[in->exit_id]), R(in->a), R(in->b))); break;
      case IR_GUARD_LE:  APP(MIR_new_insn(ctx, MIR_BGT, MIR_new_label_op(ctx, exit_lab[in->exit_id]), R(in->a), R(in->b))); break;
      case IR_LOOP:      APP(MIR_new_insn(ctx, MIR_JMP, MIR_new_label_op(ctx, top))); break;
    }
  }
  // side-exit blocks: flush slot-regs to memory (deopt state), then ret exit id
  for (int e = 0; e < n_exits; e++) {
    APP(exit_lab[e]);
    for (int s = 0; s < n_slots; s++)
      if (used[s]) APP(MIR_new_insn(ctx, MIR_MOV, MEM(s), SR(s)));
    APP(MIR_new_ret_insn(ctx, 1, MIR_new_int_op(ctx, e)));
  }
  free(sreg); free(used);
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
