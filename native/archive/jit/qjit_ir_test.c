// qjit_ir_test.c — unit test for trace IR -> MIR codegen + guard/side-exit.
// Trace: while (i < n) { s += i*i; i++ }   locals = [s, i, n]
#include "qjit_ir.h"
#include <stdio.h>
#include <stdint.h>
#include <time.h>

static double now(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec + t.tv_nsec * 1e-9; }

int main(void) {
  // locals: slot0=s, slot1=i, slot2=n
  IRInsn ir[] = {
    {IR_LOAD_LOC,  .slot = 1},               // 0: i
    {IR_LOAD_LOC,  .slot = 2},               // 1: n
    {IR_GUARD_LT,  .a = 0, .b = 1, .exit_id = 0}, // if !(i<n) exit 0
    {IR_LOAD_LOC,  .slot = 0},               // 3: s
    {IR_MUL,       .a = 0, .b = 0},          // 4: i*i
    {IR_ADD,       .a = 3, .b = 4},          // 5: s + i*i
    {IR_STORE_LOC, .slot = 0, .a = 5},       // s = 5
    {IR_CONST,     .imm = 1},                // 7: 1
    {IR_ADD,       .a = 0, .b = 7},          // 8: i + 1
    {IR_STORE_LOC, .slot = 1, .a = 8},       // i = 8
    {IR_LOOP},                               // back to top
  };
  int n = sizeof(ir) / sizeof(ir[0]);

  qjit_trace_fn trace = qjit_ir_compile(ir, n, /*n_exits*/ 1);
  if (!trace) { printf("compile failed\n"); return 1; }

  // --- correctness (exact, N small enough to not overflow i64) ---
  int64_t N = 100000;
  int64_t L[3] = {0, 0, N};
  int64_t exit = trace(L);
  int64_t ref_s = 0; for (int64_t i = 0; i < N; i++) ref_s += i * i;
  printf("correctness N=%lld:  jit s=%lld  ref s=%lld  i=%lld exit=%lld  -> %s\n",
         (long long)N, (long long)L[0], (long long)ref_s, (long long)L[1], (long long)exit,
         (L[0] == ref_s && L[1] == N && exit == 0) ? "PASS" : "FAIL");

  // --- deopt/side-exit: start with i>=n -> immediate exit 0, no mutation ---
  int64_t L2[3] = {42, 5, 5};  // i==n
  int64_t e2 = trace(L2);
  printf("side-exit  (i>=n): exit=%lld s unchanged=%s i unchanged=%s -> %s\n",
         (long long)e2, L2[0] == 42 ? "y" : "n", L2[1] == 5 ? "y" : "n",
         (e2 == 0 && L2[0] == 42 && L2[1] == 5) ? "PASS" : "FAIL");

  // --- speed: JIT native trace vs C -O2 loop (both i64, same wrap) ---
  int64_t BN = 1000000000;
  int64_t Lb[3] = {0, 0, BN};
  double t0 = now(); trace(Lb); double tj = now() - t0;
  volatile int64_t cs = 0; double t1 = now();
  for (int64_t i = 0; i < BN; i++) cs += i * i;
  double tc = now() - t1;
  printf("speed N=%lld:  jit=%.3fs  C-O2=%.3fs  match=%s  (jit/C=%.2fx)\n",
         (long long)BN, tj, tc, Lb[0] == cs ? "yes" : "NO", tj / tc);

  qjit_ir_finish();
  return 0;
}
