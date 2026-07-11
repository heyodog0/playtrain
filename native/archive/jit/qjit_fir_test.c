// qjit_fir_test.c — unit test for the FLOAT fast path (milestone 1). Builds float
// trace IR directly, compiles via MIR, runs over `locals` that hold raw f64 bits in
// their int64 slots, and asserts bit-exact vs a C `double` reference (same IEEE ops,
// same order). Also checks float-guard side-exits + NaN semantics (NEG 0 vs 1).
//
// Build (compile the REFERENCE with -ffp-contract=off so the C compiler does not fuse
// `s + g*x` into an FMA — MIR emits DMUL then DADD separately, so contraction would be
// a spurious 1-ulp mismatch, not a JIT bug):
//   clang -O2 -ffp-contract=off -fno-fast-math -I jit -I jit/mir \
//     jit/qjit_fir_test.c jit/qjit_ir.c jit/mir/libmir.a -o /tmp/ft && /tmp/ft
#include "qjit_ir.h"
#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include <math.h>

static int64_t fbits(double d) { int64_t b; memcpy(&b, &d, 8); return b; }
static double  dbits(int64_t b) { double d; memcpy(&d, &b, 8); return d; }

static int pass = 0, fail = 0;
static void ck(const char *name, int ok) {
  printf("  [%s] %s\n", ok ? "PASS" : "FAIL", name);
  if (ok) pass++; else fail++;
}

int main(void) {
  setvbuf(stdout, NULL, _IONBF, 0);  // unbuffer: a runaway compiled trace can't hide the test

  // ---------------------------------------------------------------------------
  // Test 1 — pure-float accumulation loop:  while (x < n) { s += g*x; x += 1.0 }
  // locals: slot0=s, slot1=x, slot2=n, slot3=g (g invariant -> should be hoisted).
  // ---------------------------------------------------------------------------
  {
    IRInsn ir[] = {
      {IR_FLOAD_LOC, .slot = 1},                    // 0: x
      {IR_FLOAD_LOC, .slot = 2},                    // 1: n
      {IR_FGUARD_LT, .a = 0, .b = 1, .exit_id = 0, .imm = 0}, // if !(x<n) exit 0
      {IR_FLOAD_LOC, .slot = 0},                    // 3: s
      {IR_FLOAD_LOC, .slot = 3},                    // 4: g
      {IR_FMUL,      .a = 4, .b = 0},               // 5: g*x
      {IR_FADD,      .a = 3, .b = 5},               // 6: s + g*x
      {IR_FSTORE_LOC,.slot = 0, .a = 6},            // s = 6
      {IR_FCONST,    .imm = fbits(1.0)},            // 8: 1.0
      {IR_FADD,      .a = 0, .b = 8},               // 9: x + 1.0
      {IR_FSTORE_LOC,.slot = 1, .a = 9},            // x = 9
      {IR_LOOP},
    };
    int n = sizeof(ir) / sizeof(ir[0]);
    qjit_trace_fn trace = qjit_ir_compile(ir, n, 1);
    ck("test1: compiled", trace != NULL);
    if (trace) {
      double N = 1000.0, G = 0.3;
      int64_t L[4] = { fbits(0.0), fbits(0.0), fbits(N), fbits(G) };
      int64_t exit = trace(L);
      double ref_s = 0.0, x = 0.0; for (; x < N; x += 1.0) ref_s += G * x;
      ck("test1: exit 0 (loop end)", exit == 0);
      ck("test1: s bit-exact vs C double", dbits(L[0]) == ref_s);
      ck("test1: x == n at exit", dbits(L[1]) == N);
      printf("    (jit s=%.10g  ref s=%.10g)\n", dbits(L[0]), ref_s);
    }
  }

  // ---------------------------------------------------------------------------
  // Test 2 — immediate side-exit: x >= n at entry -> exit 0, nothing mutated.
  // ---------------------------------------------------------------------------
  {
    IRInsn ir[] = {
      {IR_FLOAD_LOC, .slot = 1}, {IR_FLOAD_LOC, .slot = 2},
      {IR_FGUARD_LT, .a = 0, .b = 1, .exit_id = 0, .imm = 0},
      {IR_FLOAD_LOC, .slot = 0}, {IR_FCONST, .imm = fbits(7.0)},
      {IR_FADD, .a = 3, .b = 4}, {IR_FSTORE_LOC, .slot = 0, .a = 5},
      {IR_FCONST, .imm = fbits(1.0)}, {IR_FADD, .a = 0, .b = 7},
      {IR_FSTORE_LOC, .slot = 1, .a = 8}, {IR_LOOP},
    };
    qjit_trace_fn trace = qjit_ir_compile(ir, sizeof(ir)/sizeof(ir[0]), 1);
    if (trace) {
      int64_t L[3] = { fbits(42.0), fbits(5.0), fbits(5.0) };  // x==n
      int64_t e = trace(L);
      ck("test2: immediate exit 0", e == 0);
      ck("test2: s unchanged (42)", dbits(L[0]) == 42.0);
      ck("test2: x unchanged (5)",  dbits(L[1]) == 5.0);
    } else ck("test2: compiled", 0);
  }

  // ---------------------------------------------------------------------------
  // Test 3 — NaN semantics for both guard polarities. Loop:
  //   while (i < n) { if (x < 0) break; cnt += 1; i += 1 }
  // Guard on `i<n`   = NEG 0 (exit on unordered).  Guard on `x<0` recorded as the
  // NOT-taken (fall-through) path -> continue iff !(x<0) = NEG 1 (continue on NaN).
  // locals: slot0=i, slot1=n, slot2=cnt, slot3=x (invariant).
  // ---------------------------------------------------------------------------
  {
    IRInsn ir[] = {
      {IR_FLOAD_LOC, .slot = 0},                    // 0: i
      {IR_FLOAD_LOC, .slot = 1},                    // 1: n
      {IR_FGUARD_LT, .a = 0, .b = 1, .exit_id = 0, .imm = 0}, // NEG0: continue iff i<n
      {IR_FLOAD_LOC, .slot = 3},                    // 3: x
      {IR_FCONST,    .imm = fbits(0.0)},            // 4: 0.0
      {IR_FGUARD_LT, .a = 3, .b = 4, .exit_id = 1, .imm = 1}, // NEG1: exit1 iff x<0; NaN continues
      {IR_FLOAD_LOC, .slot = 2},                    // 6: cnt
      {IR_FCONST,    .imm = fbits(1.0)},            // 7: 1.0
      {IR_FADD,      .a = 6, .b = 7},               // 8: cnt+1
      {IR_FSTORE_LOC,.slot = 2, .a = 8},            // cnt = 8
      {IR_FLOAD_LOC, .slot = 0},                    // 10: i (reload; store below)
      {IR_FCONST,    .imm = fbits(1.0)},            // 11: 1.0
      {IR_FADD,      .a = 10, .b = 11},             // 12: i+1
      {IR_FSTORE_LOC,.slot = 0, .a = 12},           // i = 12
      {IR_LOOP},
    };
    qjit_trace_fn trace = qjit_ir_compile(ir, sizeof(ir)/sizeof(ir[0]), 2);
    ck("test3: compiled (2 exits)", trace != NULL);
    if (trace) {
      double NAN_ = NAN;
      // (a) x = +5 (not <0): runs all 10 iters, cnt=10, clean loop exit 0.
      int64_t La[4] = { fbits(0.0), fbits(10.0), fbits(0.0), fbits(5.0) };
      int64_t ea = trace(La);
      ck("test3a: x>=0 -> loop exit 0", ea == 0);
      ck("test3a: cnt==10",  dbits(La[2]) == 10.0);
      // (b) x = NaN: NEG1 guard must CONTINUE (matches interpreter !(NaN<0)==true), so
      //     the loop runs to completion — NOT an early exit.
      int64_t Lb[4] = { fbits(0.0), fbits(10.0), fbits(0.0), fbits(NAN_) };
      int64_t eb = trace(Lb);
      ck("test3b: x=NaN -> NEG1 continues, loop exit 0", eb == 0);
      ck("test3b: cnt==10 (did NOT early-exit)", dbits(Lb[2]) == 10.0);
      // (c) x = -1 (<0): NEG1 guard exits at exit 1 on the first iter, cnt still 0.
      int64_t Lc[4] = { fbits(0.0), fbits(10.0), fbits(0.0), fbits(-1.0) };
      int64_t ec = trace(Lc);
      ck("test3c: x<0 -> break exit 1", ec == 1);
      ck("test3c: cnt==0 (broke before increment)", dbits(Lc[2]) == 0.0);
      // (d) n = NaN: NEG0 loop guard i<NaN is false -> immediate exit 0, cnt 0.
      int64_t Ld[4] = { fbits(0.0), fbits(NAN_), fbits(0.0), fbits(5.0) };
      int64_t ed = trace(Ld);
      ck("test3d: n=NaN -> NEG0 immediate exit 0", ed == 0);
      ck("test3d: cnt==0", dbits(Ld[2]) == 0.0);
    }
  }

  // ---------------------------------------------------------------------------
  // Test 4 — mixed int->float promotion via IR_I2F, and FDIV/FSUB.
  //   while (i < n) { acc = acc + (double)i / 2.0 - 1.0; i += 1 }   (i,n int; acc float)
  // Exercises an int slot and a float slot coexisting + I2F on the int value.
  // ---------------------------------------------------------------------------
  {
    IRInsn ir[] = {
      {IR_LOAD_LOC,  .slot = 1},                    // 0: i (int)
      {IR_LOAD_LOC,  .slot = 2},                    // 1: n (int)
      {IR_GUARD_LT,  .a = 0, .b = 1, .exit_id = 0}, // int loop guard
      {IR_FLOAD_LOC, .slot = 0},                    // 3: acc (float)
      {IR_I2F,       .a = 0},                       // 4: (double)i
      {IR_FCONST,    .imm = fbits(2.0)},            // 5: 2.0
      {IR_FDIV,      .a = 4, .b = 5},               // 6: i/2.0
      {IR_FADD,      .a = 3, .b = 6},               // 7: acc + i/2.0
      {IR_FCONST,    .imm = fbits(1.0)},            // 8: 1.0
      {IR_FSUB,      .a = 7, .b = 8},               // 9: - 1.0
      {IR_FSTORE_LOC,.slot = 0, .a = 9},            // acc = 9
      {IR_CONST,     .imm = 1},                     // 11: int 1
      {IR_ADD,       .a = 0, .b = 11},              // 12: i+1
      {IR_STORE_LOC, .slot = 1, .a = 12},           // i = 12
      {IR_LOOP},
    };
    qjit_trace_fn trace = qjit_ir_compile(ir, sizeof(ir)/sizeof(ir[0]), 1);
    ck("test4: compiled (mixed int/float)", trace != NULL);
    if (trace) {
      int64_t N = 500;
      int64_t L[3] = { fbits(0.0), 0, N };          // acc=0.0(bits), i=0(int), n=N(int)
      int64_t e = trace(L);
      double ref = 0.0; for (int64_t i = 0; i < N; i++) ref = ref + (double)i / 2.0 - 1.0;
      ck("test4: exit 0", e == 0);
      ck("test4: i==n", L[1] == N);
      ck("test4: acc bit-exact", dbits(L[0]) == ref);
      printf("    (jit acc=%.10g  ref=%.10g)\n", dbits(L[0]), ref);
    }
  }

  // ---------------------------------------------------------------------------
  // Test 5 — a slot used as BOTH int and float must fail closed (return NULL).
  // ---------------------------------------------------------------------------
  {
    IRInsn ir[] = {
      {IR_LOAD_LOC,  .slot = 0},                    // int load slot0
      {IR_FLOAD_LOC, .slot = 0},                    // float load slot0  <- conflict
      {IR_LOAD_LOC,  .slot = 1}, {IR_LOAD_LOC, .slot = 2},
      {IR_GUARD_LT,  .a = 2, .b = 3, .exit_id = 0},
      {IR_LOOP},
    };
    qjit_trace_fn trace = qjit_ir_compile(ir, sizeof(ir)/sizeof(ir[0]), 1);
    ck("test5: int+float same slot -> refuse (NULL)", trace == NULL);
  }

  qjit_ir_finish();
  printf("\n%d passed, %d failed\n", pass, fail);
  return fail ? 1 : 0;
}
