// qjit_build_test.c — heavy unit tests for the IR builder + codegen + deopt.
// Each test builds IR from a QOp trace, compiles it, runs it over synthetic
// locals, and compares final locals + exit id to a C reference. Also checks that
// malformed/unsupported traces ABORT (build returns nonzero) rather than miscompile.
#include "qjit_ir.h"
#include <stdio.h>
#include <string.h>

// stub call helper so call traces can compile (records nothing; just satisfies the bind)
static int64_t bt_call_stub(int64_t atom, int64_t argc, int64_t *argv) { (void)atom;(void)argc;(void)argv; return 0; }

static int g_pass = 0, g_fail = 0;
static void check(const char *name, int cond) {
  printf("  [%s] %s\n", cond ? "PASS" : "FAIL", name);
  if (cond) g_pass++; else g_fail++;
}

// Build+compile+run a trace; return exit id (or -1 on build abort, -2 on compile fail).
// slot_type: per-slot entry types (QK_INT/QK_FLOAT) or NULL for all-int.
static int run_trace_t(const TraceOp *ops, int n_ops, int64_t *locals, const unsigned char *slot_type) {
  IRInsn ir[256]; int ir_n, n_exits; int32_t exit_pcs[8];
  unsigned char kind[64] = {0};
  if (qjit_build_ir(ops, n_ops, ir, 256, &ir_n, &n_exits, exit_pcs, kind, slot_type) != 0) return -1;
  qjit_trace_fn fn = qjit_ir_compile(ir, ir_n, n_exits);
  if (!fn) return -2;
  return (int)fn(locals);
}
static int run_trace(const TraceOp *ops, int n_ops, int64_t *locals) {
  return run_trace_t(ops, n_ops, locals, NULL);
}

int main(void) {
  setvbuf(stdout, NULL, _IONBF, 0);   // unbuffered: last line before a hang is the culprit
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

  // ---- call path: get_var + call + safe increment after the call ----
  qjit_set_call_helper((void *)&bt_call_stub);
  {
    // while(i<n){ f(); i+=1 }   slots: i=0, n=1.  Safe increment (i<n strict) after call OK.
    TraceOp t[] = {
      {Q_GET_LOC,.slot=0}, {Q_GET_LOC,.slot=1}, {Q_LT}, {Q_IF_FALSE,.exit_pc=99},
      {Q_GET_VAR,.imm=77}, {Q_CALL,.slot=0}, {Q_DROP},          // f()
      {Q_PUSH_INT,.imm=1}, {Q_ADD_LOC,.slot=0},                  // i += 1 (safe)
      {Q_GOTO_LOOP},
    };
    int64_t L[2] = {0, 4};
    int e = run_trace(t, 10, L);
    check("call+safe-inc: exit 0", e == 0);
    check("call+safe-inc: i==4", L[1] == 4 && L[0] == 4);
  }
  {
    // no-deopt-after-call: a deoptable MUL after the call must ABORT the build.
    // while(i<n){ f(); s = s*2; i+=1 }   slots: i=0,n=1,s=2
    TraceOp t[] = {
      {Q_GET_LOC,.slot=0}, {Q_GET_LOC,.slot=1}, {Q_LT}, {Q_IF_FALSE,.exit_pc=99},
      {Q_GET_VAR,.imm=77}, {Q_CALL,.slot=0}, {Q_DROP},
      {Q_GET_LOC,.slot=2}, {Q_PUSH_INT,.imm=2}, {Q_MUL}, {Q_PUT_LOC,.slot=2},   // s*=2 (deoptable) AFTER call
      {Q_PUSH_INT,.imm=1}, {Q_ADD_LOC,.slot=0},
      {Q_GOTO_LOOP},
    };
    int64_t L[3] = {0, 4, 1};
    check("abort: deoptable op after call", run_trace(t, 14, L) == -1);
  }
  {
    // call result not dropped -> unbalanced stack at loop end -> abort
    TraceOp t[] = {
      {Q_GET_LOC,.slot=0}, {Q_GET_LOC,.slot=1}, {Q_LT}, {Q_IF_FALSE,.exit_pc=99},
      {Q_GET_VAR,.imm=77}, {Q_CALL,.slot=0},                     // no drop
      {Q_PUSH_INT,.imm=1}, {Q_ADD_LOC,.slot=0},
      {Q_GOTO_LOOP},
    };
    int64_t L[2] = {0, 4};
    check("abort: call result not dropped (unbalanced)", run_trace(t, 9, L) == -1);
  }

  // ===== NUMERIC ISA builder tests (milestone 2) =====
  // M2-A bitwise: while(i<n){ s = (s << 1) ^ i; i += 1 }  (int32 shift + xor)
  {
    TraceOp t[] = {
      {Q_GET_LOC,.slot=1}, {Q_GET_LOC,.slot=2}, {Q_LT}, {Q_IF_FALSE,.exit_pc=99},
      {Q_GET_LOC,.slot=0}, {Q_PUSH_INT,.imm=1}, {Q_SHL},   // s << 1
      {Q_GET_LOC,.slot=1}, {Q_XOR},                        // ^ i
      {Q_PUT_LOC,.slot=0},
      {Q_PUSH_INT,.imm=1}, {Q_ADD_LOC,.slot=1},
      {Q_GOTO_LOOP},
    };
    int64_t L[3] = {12345, 0, 200};
    int e = run_trace(t, 13, L);
    int32_t rs = 12345; for (int32_t i = 0; i < 200; i++) rs = (int32_t)(((uint32_t)rs) << 1) ^ i;
    check("m2 bitwise (shl^xor): exit 0", e == 0);
    check("m2 bitwise: s matches int32 ref", (int32_t)L[0] == rs);
  }
  // M2-B mod + and + or + sar:  while(i<n){ a = a | (i & 3); b = b + (i % 5); c = i >> 1; i+=1 }
  {
    TraceOp t[] = {
      {Q_GET_LOC,.slot=3}, {Q_GET_LOC,.slot=4}, {Q_LT}, {Q_IF_FALSE,.exit_pc=99},  // i<n
      {Q_GET_LOC,.slot=0}, {Q_GET_LOC,.slot=3}, {Q_PUSH_INT,.imm=3}, {Q_AND}, {Q_OR}, {Q_PUT_LOC,.slot=0}, // a |= i&3
      {Q_GET_LOC,.slot=3}, {Q_PUSH_INT,.imm=5}, {Q_MOD}, {Q_ADD_LOC,.slot=1},       // b += i%5
      {Q_GET_LOC,.slot=3}, {Q_PUSH_INT,.imm=1}, {Q_SAR}, {Q_PUT_LOC,.slot=2},        // c = i>>1
      {Q_PUSH_INT,.imm=1}, {Q_ADD_LOC,.slot=3},
      {Q_GOTO_LOOP},
    };
    int64_t L[5] = {0, 0, 0, 0, 300};   // a,b,c,i,n
    int e = run_trace(t, 21, L);
    int32_t a=0,b=0,c=0; for (int32_t i=0;i<300;i++){ a = a | (i & 3); b += i % 5; c = i >> 1; }
    check("m2 and/or/mod/sar: exit 0", e == 0);
    check("m2: a (|= i&3) matches", (int32_t)L[0] == a);
    check("m2: b (+= i%5) matches",  (int32_t)L[1] == b);
    check("m2: c (= i>>1) matches",  (int32_t)L[2] == c);
  }
  // M2-C negate (clean, operand never 0/INT32_MIN): while(i<n){ s = s + (-i); i+=1 } i from 1
  {
    TraceOp t[] = {
      {Q_GET_LOC,.slot=1}, {Q_GET_LOC,.slot=2}, {Q_LT}, {Q_IF_FALSE,.exit_pc=99},
      {Q_GET_LOC,.slot=1}, {Q_NEG}, {Q_ADD_LOC,.slot=0},   // s += -i
      {Q_PUSH_INT,.imm=1}, {Q_ADD_LOC,.slot=1},
      {Q_GOTO_LOOP},
    };
    int64_t L[3] = {0, 1, 500};   // s, i(=1), n
    int e = run_trace(t, 10, L);
    int32_t rs=0; for (int32_t i=1;i<500;i++) rs += -i;
    check("m2 neg (clean): exit 0", e == 0);
    check("m2 neg: s matches",  (int32_t)L[0] == rs);
  }
  // M2-D negate DEOPT on -0: i starts 0 -> first iter -i == -0 (a float) -> deopt, locals unchanged.
  {
    TraceOp t[] = {
      {Q_GET_LOC,.slot=1}, {Q_GET_LOC,.slot=2}, {Q_LT}, {Q_IF_FALSE,.exit_pc=99},
      {Q_GET_LOC,.slot=1}, {Q_NEG}, {Q_ADD_LOC,.slot=0},
      {Q_PUSH_INT,.imm=1}, {Q_ADD_LOC,.slot=1},
      {Q_GOTO_LOOP},
    };
    int64_t L[3] = {77, 0, 500};   // s=77, i=0 -> neg(0) deopts
    int e = run_trace(t, 10, L);   // valid trace, so -1 here == QJIT_DEOPT (not build abort)
    check("m2 neg -0 -> deopt (exit<0)", e < 0);
    check("m2 neg -0: locals unchanged (iteration start)", L[0] == 77 && L[1] == 0);
  }
  // M2-E bitwise on a float operand must ABORT (JS would ToInt32 it -> interpreter path).
  {
    TraceOp t[] = {
      {Q_GET_LOC,.slot=1}, {Q_GET_LOC,.slot=2}, {Q_LT}, {Q_IF_FALSE,.exit_pc=99},
      {Q_GET_LOC,.slot=0}, {Q_PUSH_F64,.imm=0}, {Q_AND}, {Q_PUT_LOC,.slot=0},   // s & <float> -> abort
      {Q_PUSH_INT,.imm=1}, {Q_ADD_LOC,.slot=1},
      {Q_GOTO_LOOP},
    };
    { double d = 2.5; memcpy(&t[5].imm, &d, 8); }
    unsigned char ty[3] = {QK_INT, QK_INT, QK_INT};
    int64_t L[3] = {0, 0, 10};
    check("m2 bitwise-on-float aborts", run_trace_t(t, 11, L, ty) == -1);
  }

  // M2-F lnot on an int -> bool feeding a guard: while(i<n){ if(!(i-i)) c++; i++ } (!0 always true)
  {
    TraceOp t[] = {
      {Q_GET_LOC,.slot=1}, {Q_GET_LOC,.slot=2}, {Q_LT}, {Q_IF_FALSE,.exit_pc=99},
      {Q_GET_LOC,.slot=1}, {Q_GET_LOC,.slot=1}, {Q_SUB}, {Q_LNOT},     // !(i-i) == !0 == true
      {Q_IF_FALSE,.imm=0,.exit_pc=88},                                 // continue iff true (always)
      {Q_PUSH_INT,.imm=1}, {Q_ADD_LOC,.slot=0},                        // c++
      {Q_PUSH_INT,.imm=1}, {Q_ADD_LOC,.slot=1},                        // i++
      {Q_GOTO_LOOP},
    };
    int64_t L[3] = {0, 0, 300};   // c, i, n
    int e = run_trace(t, 14, L);
    check("m2 lnot(int)->bool guard: exit 0", e == 0);
    check("m2 lnot: c==n (branch always taken)", L[0] == 300 && L[1] == 300);
  }
  // M2-G lnot flips a comparison: while(i<n){ if(!(i<0)) c++; i++ }  (!(i<0)==i>=0, always)
  {
    TraceOp t[] = {
      {Q_GET_LOC,.slot=1}, {Q_GET_LOC,.slot=2}, {Q_LT}, {Q_IF_FALSE,.exit_pc=99},
      {Q_GET_LOC,.slot=1}, {Q_PUSH_INT,.imm=0}, {Q_LT}, {Q_LNOT},      // !(i<0)
      {Q_IF_FALSE,.imm=0,.exit_pc=88},
      {Q_PUSH_INT,.imm=1}, {Q_ADD_LOC,.slot=0},
      {Q_PUSH_INT,.imm=1}, {Q_ADD_LOC,.slot=1},
      {Q_GOTO_LOOP},
    };
    int64_t L[3] = {0, 0, 250};
    int e = run_trace(t, 14, L);
    check("m2 lnot(cmp-flip): exit 0", e == 0);
    check("m2 lnot(cmp-flip): c==n", L[0] == 250);
  }
  // M2-H a bool must not be stored/arithmetic'd -> abort (would mismatch TAG_BOOL vs TAG_INT)
  {
    TraceOp t[] = {
      {Q_GET_LOC,.slot=1}, {Q_GET_LOC,.slot=2}, {Q_LT}, {Q_IF_FALSE,.exit_pc=99},
      {Q_GET_LOC,.slot=0}, {Q_GET_LOC,.slot=1}, {Q_PUSH_INT,.imm=1}, {Q_AND}, {Q_LNOT}, {Q_ADD}, // s + bool
      {Q_PUT_LOC,.slot=0}, {Q_PUSH_INT,.imm=1}, {Q_ADD_LOC,.slot=1}, {Q_GOTO_LOOP},
    };
    int64_t L[3] = {0, 0, 10};
    check("m2 lnot: bool-in-arith aborts", run_trace(t, 14, L) == -1);
  }

  // ===== FLOAT builder tests (milestone 1) =====
  // Helpers to move doubles through the int64 `locals` and Q_PUSH_F64 imm.
  #define FB(d) ({ double _d = (d); int64_t _b; memcpy(&_b, &_d, 8); _b; })
  #define FD(b) ({ int64_t _b = (b); double _d; memcpy(&_d, &_b, 8); _d; })

  // ---- F1: while (x < n) { s += g*x; x += 1.0 }  — all-float locals via entry types.
  //   slot0=s, slot1=x, slot2=n, slot3=g ; QK_FLOAT for all. g invariant -> hoisted.
  {
    TraceOp t[] = {
      {Q_GET_LOC,.slot=1}, {Q_GET_LOC,.slot=2}, {Q_LT}, {Q_IF_FALSE,.exit_pc=77}, // x<n
      {Q_GET_LOC,.slot=3}, {Q_GET_LOC,.slot=1}, {Q_MUL}, {Q_ADD_LOC,.slot=0},      // s += g*x
      {Q_PUSH_F64,.imm=0}, {Q_ADD_LOC,.slot=1},                                    // x += 1.0 (imm set below)
      {Q_GOTO_LOOP},
    };
    { double one = 1.0; memcpy(&t[8].imm, &one, 8); }
    unsigned char ty[4] = {QK_FLOAT, QK_FLOAT, QK_FLOAT, QK_FLOAT};
    int64_t L[4] = {FB(0.0), FB(0.0), FB(1000.0), FB(0.3)};
    int e = run_trace_t(t, 11, L, ty);
    double rs = 0, x = 0; for (; x < 1000.0; x += 1.0) rs += 0.3 * x;
    check("float F1: exit 0", e == 0);
    check("float F1: s bit-exact", FD(L[0]) == rs);
    check("float F1: x==n", FD(L[1]) == 1000.0);
  }

  // ---- F2: mixed — while (i < n) { acc += (i * 0.5); i += 1 }  (i,n int; acc float).
  //   Q_MUL of int i and float 0.5 -> promotes i (IR_I2F) -> IR_FMUL. Compare stays int.
  {
    TraceOp t[] = {
      {Q_GET_LOC,.slot=1}, {Q_GET_LOC,.slot=2}, {Q_LT}, {Q_IF_FALSE,.exit_pc=50},  // int i<n
      {Q_GET_LOC,.slot=1}, {Q_PUSH_F64,.imm=0}, {Q_MUL}, {Q_ADD_LOC,.slot=0},       // acc += i*0.5
      {Q_PUSH_INT,.imm=1}, {Q_ADD_LOC,.slot=1},                                     // i += 1 (int)
      {Q_GOTO_LOOP},
    };
    { double half = 0.5; memcpy(&t[5].imm, &half, 8); }
    unsigned char ty[3] = {QK_FLOAT, QK_INT, QK_INT};  // acc float, i/n int
    int64_t L[3] = {FB(0.0), 0, 400};
    int e = run_trace_t(t, 11, L, ty);
    double racc = 0; for (int64_t i = 0; i < 400; i++) racc += (double)i * 0.5;
    check("float F2 (mixed): exit 0", e == 0);
    check("float F2 (mixed): i==n", L[1] == 400);
    check("float F2 (mixed): acc bit-exact", FD(L[0]) == racc);
  }

  // ---- F3: float PUT_LOC (not compound): while (x<n){ y = x*x; x += 1.0 }  y,x,n float.
  {
    TraceOp t[] = {
      {Q_GET_LOC,.slot=1}, {Q_GET_LOC,.slot=2}, {Q_LT}, {Q_IF_FALSE,.exit_pc=60},   // x<n
      {Q_GET_LOC,.slot=1}, {Q_GET_LOC,.slot=1}, {Q_MUL}, {Q_PUT_LOC,.slot=0},        // y = x*x
      {Q_PUSH_F64,.imm=0}, {Q_ADD_LOC,.slot=1},                                      // x += 1.0
      {Q_GOTO_LOOP},
    };
    { double one = 1.0; memcpy(&t[8].imm, &one, 8); }
    unsigned char ty[3] = {QK_FLOAT, QK_FLOAT, QK_FLOAT};
    int64_t L[3] = {FB(0.0), FB(0.0), FB(7.0)};
    int e = run_trace_t(t, 11, L, ty);
    check("float F3: exit 0", e == 0);
    check("float F3: y == (n-1)^2 == 36", FD(L[0]) == 36.0);
    check("float F3: x==n", FD(L[1]) == 7.0);
  }

  // ---- F4: a slot the frame says is INT, then a float stored into it -> codegen must
  //   refuse (int load elsewhere + float store == mixed slot). Here: read slot0 as int
  //   (guard i<n uses it) AND float-store slot0 -> conflict -> compile returns NULL (-2).
  {
    TraceOp t[] = {
      {Q_GET_LOC,.slot=0}, {Q_GET_LOC,.slot=1}, {Q_LT}, {Q_IF_FALSE,.exit_pc=9},     // int slot0 < slot1
      {Q_PUSH_F64,.imm=0}, {Q_PUT_LOC,.slot=0},                                       // float-store slot0
      {Q_PUSH_INT,.imm=1}, {Q_ADD_LOC,.slot=0},                                       // (keeps slot0 live/int too)
      {Q_GOTO_LOOP},
    };
    { double one = 1.0; memcpy(&t[4].imm, &one, 8); }
    int64_t L[2] = {0, 5};
    int e = run_trace(t, 9, L);  // NULL slot_type: slot0 int -> float store conflicts
    check("float F4: mixed int/float slot refused", e == -1 || e == -2);
  }

  #undef FB
  #undef FD

  qjit_ir_finish();
  printf("\n%d passed, %d failed\n", g_pass, g_fail);
  return g_fail ? 1 : 0;
}
