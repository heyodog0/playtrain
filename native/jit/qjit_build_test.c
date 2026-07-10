// qjit_build_test.c — heavy unit tests for the IR builder + codegen + deopt.
// Each test builds IR from a QOp trace, compiles it, runs it over synthetic
// locals, and compares final locals + exit id to a C reference. Also checks that
// malformed/unsupported traces ABORT (build returns nonzero) rather than miscompile.
#include "qjit_ir.h"
#include <stdio.h>
#include <string.h>

static int g_pass = 0, g_fail = 0;
static void check(const char *name, int cond) {
  printf("  [%s] %s\n", cond ? "PASS" : "FAIL", name);
  if (cond) g_pass++; else g_fail++;
}

// Build+compile+run a trace; return exit id (or -1 on build abort).
static int run_trace(const TraceOp *ops, int n_ops, int64_t *locals) {
  IRInsn ir[256]; int ir_n, n_exits;
  if (qjit_build_ir(ops, n_ops, ir, 256, &ir_n, &n_exits) != 0) return -1;
  qjit_trace_fn fn = qjit_ir_compile(ir, ir_n, n_exits);
  if (!fn) return -2;
  return (int)fn(locals);
}

int main(void) {
  // ---- test 1: while(i<n){ s += i; i += 1 }  via add_loc ----
  {
    TraceOp t[] = {
      {Q_GET_LOC,.slot=1}, {Q_GET_LOC,.slot=2}, {Q_LT}, {Q_IF_FALSE,.exit_pc=999},
      {Q_GET_LOC,.slot=1}, {Q_ADD_LOC,.slot=0},          // s += i
      {Q_PUSH_INT,.imm=1}, {Q_ADD_LOC,.slot=1},          // i += 1
      {Q_GOTO_LOOP},
    };
    int64_t L[3] = {0, 0, 1000};                          // s,i,n
    int e = run_trace(t, 9, L);
    int64_t rs = 0; for (int64_t i = 0; i < 1000; i++) rs += i;
    check("sum(i<1000): s", L[0] == rs);
    check("sum(i<1000): i==n", L[1] == 1000);
    check("sum(i<1000): exit 0", e == 0);
  }
  // ---- test 2: while(i<n){ p = p*2; i += 1 }  via get/mul/put ----
  {
    TraceOp t[] = {
      {Q_GET_LOC,.slot=1}, {Q_GET_LOC,.slot=2}, {Q_LT}, {Q_IF_FALSE,.exit_pc=50},
      {Q_GET_LOC,.slot=0}, {Q_PUSH_INT,.imm=2}, {Q_MUL}, {Q_PUT_LOC,.slot=0},
      {Q_PUSH_INT,.imm=1}, {Q_ADD_LOC,.slot=1},
      {Q_GOTO_LOOP},
    };
    int64_t L[3] = {1, 0, 10};                            // p,i,n
    int e = run_trace(t, 11, L);
    int64_t rp = 1; for (int64_t i = 0; i < 10; i++) rp *= 2;
    check("pow2(10): p==1024", L[0] == rp && rp == 1024);
    check("pow2(10): exit 0", e == 0);
  }
  // ---- test 3: while(x>0){ acc += x; x -= 1 }  via GT guard + SUB ----
  {
    TraceOp t[] = {
      {Q_GET_LOC,.slot=1}, {Q_PUSH_INT,.imm=0}, {Q_GT}, {Q_IF_FALSE,.exit_pc=7},
      {Q_GET_LOC,.slot=1}, {Q_ADD_LOC,.slot=0},           // acc += x
      {Q_GET_LOC,.slot=1}, {Q_PUSH_INT,.imm=1}, {Q_SUB}, {Q_PUT_LOC,.slot=1}, // x -= 1
      {Q_GOTO_LOOP},
    };
    int64_t L[2] = {0, 100};                              // acc,x
    int e = run_trace(t, 11, L);
    int64_t racc = 0; for (int64_t x = 100; x > 0; x--) racc += x;
    check("countdown: acc==5050", L[0] == racc && racc == 5050);
    check("countdown: x==0", L[1] == 0);
    check("countdown: exit 0", e == 0);
  }
  // ---- test 4: LE guard: while(i<=n){ s += i; i += 1 } ----
  {
    TraceOp t[] = {
      {Q_GET_LOC,.slot=1}, {Q_GET_LOC,.slot=2}, {Q_LE}, {Q_IF_FALSE,.exit_pc=9},
      {Q_GET_LOC,.slot=1}, {Q_ADD_LOC,.slot=0},
      {Q_PUSH_INT,.imm=1}, {Q_ADD_LOC,.slot=1},
      {Q_GOTO_LOOP},
    };
    int64_t L[3] = {0, 1, 100};
    int e = run_trace(t, 9, L);
    int64_t rs = 0; for (int64_t i = 1; i <= 100; i++) rs += i;
    check("LE-loop: s==5050", L[0] == rs && rs == 5050);
    check("LE-loop: exit 0", e == 0);
  }
  // ---- test 5: TWO exits (loop cond + early break), deopt returns the right id ----
  {
    // while(i<n){ if(!(i<=lim)) break; s+=i; i+=1 }   locals: s,i,n,lim
    TraceOp t[] = {
      {Q_GET_LOC,.slot=1}, {Q_GET_LOC,.slot=2}, {Q_LT}, {Q_IF_FALSE,.exit_pc=100}, // exit A
      {Q_GET_LOC,.slot=1}, {Q_GET_LOC,.slot=3}, {Q_LE}, {Q_IF_FALSE,.exit_pc=200}, // exit B (break)
      {Q_GET_LOC,.slot=1}, {Q_ADD_LOC,.slot=0},
      {Q_PUSH_INT,.imm=1}, {Q_ADD_LOC,.slot=1},
      {Q_GOTO_LOOP},
    };
    int64_t L[4] = {0, 0, 1000, 50};   // lim=50 < n -> should exit via B (id 1)
    int e = run_trace(t, 13, L);
    int64_t rs = 0; for (int64_t i = 0; i <= 50; i++) rs += i;  // breaks when i=51 (i>lim)
    check("two-exit: took break exit (id 1)", e == 1);
    check("two-exit: s==sum(0..50)", L[0] == rs);
    check("two-exit: i==51 at break", L[1] == 51);
  }
  // ---- test 6: OVERFLOW deopt — while(i<n){ s = s*10; i += 1 } overflows int32 ----
  {
    TraceOp t[] = {
      {Q_GET_LOC,.slot=1}, {Q_GET_LOC,.slot=2}, {Q_LT}, {Q_IF_FALSE,.exit_pc=100},
      {Q_GET_LOC,.slot=0}, {Q_PUSH_INT,.imm=10}, {Q_MUL}, {Q_PUT_LOC,.slot=0},  // s = s*10
      {Q_PUSH_INT,.imm=1}, {Q_ADD_LOC,.slot=1},                                  // i += 1
      {Q_GOTO_LOOP},
    };
    int64_t L[3] = {1, 0, 100};                          // s=1, i=0, n=100
    int64_t e = run_trace(t, 11, L);
    // C ref: iterate while s*10 fits int32; s=1->10->...->1e9 (i=9), then 1e9*10 overflows
    check("overflow: deopts (QJIT_DEOPT)", e == QJIT_DEOPT);
    check("overflow: s==1e9 (iteration START, not committed)", L[0] == 1000000000);
    check("overflow: i==9 (iteration START)", L[1] == 9);
    check("overflow: n untouched", L[2] == 100);
  }
  // ---- test 7: no spurious deopt — a loop whose values stay in int32 runs clean ----
  {
    TraceOp t[] = {  // while(i<n){ s += i*i; i += 1 }  (n small so s*... fits)
      {Q_GET_LOC,.slot=1}, {Q_GET_LOC,.slot=2}, {Q_LT}, {Q_IF_FALSE,.exit_pc=9},
      {Q_GET_LOC,.slot=1}, {Q_GET_LOC,.slot=1}, {Q_MUL}, {Q_ADD_LOC,.slot=0},  // s += i*i
      {Q_PUSH_INT,.imm=1}, {Q_ADD_LOC,.slot=1},
      {Q_GOTO_LOOP},
    };
    int64_t L[3] = {0, 0, 1000};
    int64_t e = run_trace(t, 11, L);
    int32_t rs = 0; for (int32_t i = 0; i < 1000; i++) rs += i * i;  // int32 (matches, no overflow)
    check("sum i*i (int32): clean exit 0", e == 0);
    check("sum i*i (int32): s matches int32 ref", L[0] == rs);
  }
  // ---- abort cases: builder must return -1 (stay interpreted), never miscompile ----
  {
    TraceOp bad1[] = {{Q_PUSH_INT,.imm=1}, {Q_IF_FALSE,.exit_pc=0}, {Q_GOTO_LOOP}}; // IF on non-compare
    int64_t L[1] = {0};
    check("abort: IF on non-compare", run_trace(bad1, 3, L) == -1);

    TraceOp bad2[] = {{Q_ADD}, {Q_GOTO_LOOP}};                                     // stack underflow
    check("abort: stack underflow", run_trace(bad2, 2, L) == -1);

    TraceOp bad3[] = {{Q_GET_LOC,.slot=0}, {Q_PUT_LOC,.slot=0}};                    // no loop back-edge
    check("abort: no loop", run_trace(bad3, 2, L) == -1);

    TraceOp bad4[] = {{Q_GET_LOC,.slot=0}, {Q_GOTO_LOOP}};                          // unbalanced stack
    check("abort: unbalanced stack", run_trace(bad4, 2, L) == -1);
  }

  qjit_ir_finish();
  printf("\n%d passed, %d failed\n", g_pass, g_fail);
  return g_fail ? 1 : 0;
}
