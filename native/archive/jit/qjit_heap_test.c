// qjit_heap_test.c — unit tests for increment 1: guarded fast-array INT-element
// load. Builds synthetic JSObject-like arrays in memory (with a test layout that
// mirrors quickjs's field offsets), compiles the heap IR directly, runs it over
// locals where one slot holds the array's base pointer, and checks results +
// that OOB / non-int-element correctly DEOPT (return QJIT_DEOPT), never miscompile.
#include "qjit_ir.h"
#include <stdio.h>
#include <string.h>
#include <stdint.h>
#include <stdlib.h>

// call-helper stub (file scope; C): records (atom, argv[0]) per IR_CALL invocation
static int64_t call_log[64], call_atoms[64];
static int call_n;
static int64_t call_stub(int64_t atom, int64_t argc, int64_t *argv) {
  if (call_n < 64) { call_atoms[call_n] = atom; call_log[call_n] = argc > 0 ? argv[0] : -1; call_n++; }
  return 0;
}

static int g_pass = 0, g_fail = 0;
static void check(const char *name, int cond) {
  printf("  [%s] %s\n", cond ? "PASS" : "FAIL", name);
  if (cond) g_pass++; else g_fail++;
}

// test mirrors of the quickjs structs (only the fields codegen touches)
typedef struct { int32_t int32; int32_t _pad; int64_t tag; } TJSValue;  // 16 bytes
// stub streq helper: "element === atom" faked as (element.int32 == atom) for codegen testing
static int64_t streq_stub(void *elem, int64_t atom) {
  return ((TJSValue *)elem)->int32 == (int32_t)atom ? 1 : 0;
}
typedef struct { uint32_t count; uint32_t _pad; TJSValue *values; } TArray; // count@0, values@8
#define TAG_INT 0
#define TAG_OBJ (-1)

static TArray *make_int_array(int n, const int *vals) {
  TArray *a = calloc(1, sizeof(TArray));
  a->count = n;
  a->values = calloc(n > 0 ? n : 1, sizeof(TJSValue));
  for (int k = 0; k < n; k++) { a->values[k].int32 = vals[k]; a->values[k].tag = TAG_INT; }
  return a;
}

// Build+compile+run an IR trace; return exit id (or -1 deopt / -2 compile fail).
static int64_t run_ir(const IRInsn *ir, int n, int n_exits, int64_t *locals) {
  qjit_trace_fn fn = qjit_ir_compile(ir, n, n_exits);
  if (!fn) return -2;
  return fn(locals);
}

int main(void) {
  setvbuf(stdout, NULL, _IONBF, 0);   // unbuffered: last line before a hang is the culprit
  qjit_layout = (QjitLayout){ .arr_count_off = 0, .arr_values_off = 8,
                              .jsvalue_size = 16, .jsvalue_tag_off = 8, .tag_int = TAG_INT };

  // ---- test 1: sum over an int array:  while(i<n){ s += arr[i]; i+=1 } ----
  // slots: s=0, i=1, n=2, arr=3(ptr).  IR indices tracked by hand.
  {
    IRInsn ir[] = {
      /*0*/ {.op=IR_LOAD_LOC,.slot=1},                 // i
      /*1*/ {.op=IR_LOAD_LOC,.slot=2},                 // n
      /*2*/ {.op=IR_GUARD_LT,.a=0,.b=1,.exit_id=0},    // continue iff i<n
      /*3*/ {.op=IR_LOAD_LOC,.slot=3},                 // arr base ptr
      /*4*/ {.op=IR_ARRAY_COUNT,.a=3},                 // count
      /*5*/ {.op=IR_GUARD_BOUNDS,.a=0,.b=4},           // idx=i(v0) < count(v4) else deopt
      /*6*/ {.op=IR_ARRAY_VALUES,.a=3},                // values ptr
      /*7*/ {.op=IR_ARRAY_EL_INT,.a=6,.b=0},           // arr[i] (guard tag==INT)
      /*8*/ {.op=IR_LOAD_LOC,.slot=0},                 // s
      /*9*/ {.op=IR_ADD,.a=8,.b=7},                    // s + arr[i]
      /*10*/{.op=IR_STORE_LOC,.slot=0,.a=9},           // s =
      /*11*/{.op=IR_LOAD_LOC,.slot=1},                 // i
      /*12*/{.op=IR_CONST,.imm=1},
      /*13*/{.op=IR_ADD,.a=11,.b=12},                  // i+1
      /*14*/{.op=IR_STORE_LOC,.slot=1,.a=13},
      /*15*/{.op=IR_LOOP},
    };
    int vals[8] = {5,10,15,20,25,30,35,40};
    TArray *a = make_int_array(8, vals);
    int64_t L[4] = {0, 0, 8, (int64_t)(intptr_t)a};   // s,i,n,arr
    int64_t e = run_ir(ir, 16, 1, L);
    int rs = 0; for (int k=0;k<8;k++) rs += vals[k];
    check("sum int[8]: exit 0", e == 0);
    check("sum int[8]: s == 180", L[0] == rs && rs == 180);
    check("sum int[8]: i == 8", L[1] == 8);
    free(a->values); free(a);
  }

  // ---- test 2: bounds DEOPT — n exceeds array length -> guard fires ----
  {
    IRInsn ir[] = {
      {.op=IR_LOAD_LOC,.slot=1}, {.op=IR_LOAD_LOC,.slot=2}, {.op=IR_GUARD_LT,.a=0,.b=1,.exit_id=0},
      {.op=IR_LOAD_LOC,.slot=3}, {.op=IR_ARRAY_COUNT,.a=3}, {.op=IR_GUARD_BOUNDS,.a=0,.b=4},
      {.op=IR_ARRAY_VALUES,.a=3}, {.op=IR_ARRAY_EL_INT,.a=6,.b=0}, {.op=IR_LOAD_LOC,.slot=0},
      {.op=IR_ADD,.a=8,.b=7}, {.op=IR_STORE_LOC,.slot=0,.a=9},
      {.op=IR_LOAD_LOC,.slot=1}, {.op=IR_CONST,.imm=1}, {.op=IR_ADD,.a=11,.b=12}, {.op=IR_STORE_LOC,.slot=1,.a=13},
      {.op=IR_LOOP},
    };
    int vals[3] = {5,10,15};
    TArray *a = make_int_array(3, vals);
    int64_t L[4] = {0, 0, 100, (int64_t)(intptr_t)a};  // n=100 > count=3
    int64_t e = run_ir(ir, 16, 1, L);
    check("bounds OOB: DEOPT (bounds)", e == QJIT_DEOPT_BOUNDS);
    check("bounds OOB: summed only in-range (s==30), i==3 at deopt start", L[0] == 30 && L[1] == 3);
    free(a->values); free(a);
  }

  // ---- test 3: non-int element DEOPT — one element has tag OBJECT ----
  {
    IRInsn ir[] = {
      {.op=IR_LOAD_LOC,.slot=1}, {.op=IR_LOAD_LOC,.slot=2}, {.op=IR_GUARD_LT,.a=0,.b=1,.exit_id=0},
      {.op=IR_LOAD_LOC,.slot=3}, {.op=IR_ARRAY_COUNT,.a=3}, {.op=IR_GUARD_BOUNDS,.a=0,.b=4},
      {.op=IR_ARRAY_VALUES,.a=3}, {.op=IR_ARRAY_EL_INT,.a=6,.b=0}, {.op=IR_LOAD_LOC,.slot=0},
      {.op=IR_ADD,.a=8,.b=7}, {.op=IR_STORE_LOC,.slot=0,.a=9},
      {.op=IR_LOAD_LOC,.slot=1}, {.op=IR_CONST,.imm=1}, {.op=IR_ADD,.a=11,.b=12}, {.op=IR_STORE_LOC,.slot=1,.a=13},
      {.op=IR_LOOP},
    };
    int vals[4] = {5,10,999,20};
    TArray *a = make_int_array(4, vals);
    a->values[2].tag = TAG_OBJ;                        // element 2 is a heap value, not int
    int64_t L[4] = {0, 0, 4, (int64_t)(intptr_t)a};
    int64_t e = run_ir(ir, 16, 1, L);
    check("non-int elem: DEOPT (tag)", e == QJIT_DEOPT_TAG);
    check("non-int elem: s==15 (0,1 summed), i==2 at deopt", L[0] == 15 && L[1] == 2);
    free(a->values); free(a);
  }

  // ---- test 4: empty loop bound — n==0, immediate control-flow exit, no load ----
  {
    IRInsn ir[] = {
      {.op=IR_LOAD_LOC,.slot=1}, {.op=IR_LOAD_LOC,.slot=2}, {.op=IR_GUARD_LT,.a=0,.b=1,.exit_id=0},
      {.op=IR_LOAD_LOC,.slot=3}, {.op=IR_ARRAY_COUNT,.a=3}, {.op=IR_GUARD_BOUNDS,.a=0,.b=4},
      {.op=IR_ARRAY_VALUES,.a=3}, {.op=IR_ARRAY_EL_INT,.a=6,.b=0}, {.op=IR_LOAD_LOC,.slot=0},
      {.op=IR_ADD,.a=8,.b=7}, {.op=IR_STORE_LOC,.slot=0,.a=9},
      {.op=IR_LOAD_LOC,.slot=1}, {.op=IR_CONST,.imm=1}, {.op=IR_ADD,.a=11,.b=12}, {.op=IR_STORE_LOC,.slot=1,.a=13},
      {.op=IR_LOOP},
    };
    int vals[2] = {5,10};
    TArray *a = make_int_array(2, vals);
    int64_t L[4] = {77, 0, 0, (int64_t)(intptr_t)a};   // n=0 -> exit immediately, s untouched
    int64_t e = run_ir(ir, 16, 1, L);
    check("n==0: control-flow exit 0", e == 0);
    check("n==0: s unchanged (77)", L[0] == 77);
    free(a->values); free(a);
  }

  // ---- test 5: layout-not-set guard — compiling a heap trace with a zeroed layout
  // MUST fail (return NULL), never emit silently-wrong idx*0 addressing. This is the
  // regression test for the live init-ordering bug (layout set after the compile it feeds).
  {
    IRInsn ir[] = {
      {.op=IR_LOAD_LOC,.slot=1}, {.op=IR_LOAD_LOC,.slot=2}, {.op=IR_GUARD_LT,.a=0,.b=1,.exit_id=0},
      {.op=IR_LOAD_LOC,.slot=3}, {.op=IR_ARRAY_COUNT,.a=3}, {.op=IR_GUARD_BOUNDS,.a=0,.b=4},
      {.op=IR_ARRAY_VALUES,.a=3}, {.op=IR_ARRAY_EL_INT,.a=6,.b=0}, {.op=IR_LOAD_LOC,.slot=0},
      {.op=IR_ADD,.a=8,.b=7}, {.op=IR_STORE_LOC,.slot=0,.a=9},
      {.op=IR_LOAD_LOC,.slot=1}, {.op=IR_CONST,.imm=1}, {.op=IR_ADD,.a=11,.b=12}, {.op=IR_STORE_LOC,.slot=1,.a=13},
      {.op=IR_LOOP},
    };
    QjitLayout saved = qjit_layout;
    qjit_layout = (QjitLayout){0};                       // simulate "not yet initialized"
    qjit_trace_fn fn = qjit_ir_compile(ir, 16, 1);
    check("layout unset: heap trace refuses to compile (NULL)", fn == NULL);
    qjit_layout = saved;                                 // restore
    fn = qjit_ir_compile(ir, 16, 1);
    check("layout set: heap trace compiles", fn != NULL);
  }

  // ---- test 6: IR_CALL codegen — call a host helper each iteration with an int arg ----
  {
    qjit_set_call_helper((void *)&call_stub);
    call_n = 0;
    // while(i<n){ f(i); i+=1 }   slots: i=0, n=1
    IRInsn ir[] = {
      {.op=IR_LOAD_LOC,.slot=0}, {.op=IR_LOAD_LOC,.slot=1}, {.op=IR_GUARD_LT,.a=0,.b=1,.exit_id=0},
      {.op=IR_CALL,.imm=77,.argc=1,.argv={0}},              // f(i)  (i is v0)
      {.op=IR_LOAD_LOC,.slot=0}, {.op=IR_CONST,.imm=1}, {.op=IR_ADD_SAFE,.a=4,.b=5}, {.op=IR_STORE_LOC,.slot=0,.a=6},
      {.op=IR_LOOP},
    };
    int64_t L[2] = {0, 5};                                   // i=0, n=5
    int64_t e = run_ir(ir, 9, 1, L);
    check("call loop: control-flow exit 0", e == 0);
    check("call loop: i==5 after", L[0] == 5);
    check("call loop: helper called 5x", call_n == 5);
    int seq_ok = 1; for (int k = 0; k < 5; k++) if (call_log[k] != k || call_atoms[k] != 77) seq_ok = 0;
    check("call loop: args 0,1,2,3,4 with atom 77 in order", call_n == 5 && seq_ok);
  }
  // ---- test 7: IR_CALL with no helper registered -> compile fails (stays interpreted) ----
  {
    qjit_set_call_helper(NULL);
    IRInsn ir[] = {
      {.op=IR_LOAD_LOC,.slot=0}, {.op=IR_LOAD_LOC,.slot=1}, {.op=IR_GUARD_LT,.a=0,.b=1,.exit_id=0},
      {.op=IR_CALL,.imm=1,.argc=0}, {.op=IR_LOAD_LOC,.slot=0}, {.op=IR_CONST,.imm=1},
      {.op=IR_ADD_SAFE,.a=4,.b=5}, {.op=IR_STORE_LOC,.slot=0,.a=6}, {.op=IR_LOOP},
    };
    qjit_trace_fn fn = qjit_ir_compile(ir, 9, 1);
    check("call, no helper: refuses to compile (NULL)", fn == NULL);
  }

  // ---- test 8: IR_STREQ_EL + IR_GUARD_TRUE — count matches, exit when one differs ----
  // while(i<n){ if(a[i]===K) c+=1; i+=1 }  slots: c=0,i=1,n=2,a=3(ptr); atom K=7
  {
    extern void qjit_set_streq_helper(void *fn);
    qjit_set_streq_helper((void *)&streq_stub);
    IRInsn ir[] = {
      /*0*/ {.op=IR_LOAD_LOC,.slot=1}, /*1*/ {.op=IR_LOAD_LOC,.slot=2}, /*2*/ {.op=IR_GUARD_LT,.a=0,.b=1,.exit_id=0},
      /*3*/ {.op=IR_LOAD_LOC,.slot=3}, /*4*/ {.op=IR_ARRAY_COUNT,.a=3}, /*5*/ {.op=IR_GUARD_BOUNDS,.a=0,.b=4},
      /*6*/ {.op=IR_ARRAY_VALUES,.a=3}, /*7*/ {.op=IR_STREQ_EL,.a=6,.b=0,.imm=7},   // a[i]===7
      /*8*/ {.op=IR_GUARD_TRUE,.a=7,.exit_id=1},                                     // skip/exit iff !match
      /*9*/ {.op=IR_LOAD_LOC,.slot=0}, /*10*/ {.op=IR_CONST,.imm=1}, /*11*/ {.op=IR_ADD,.a=9,.b=10}, /*12*/ {.op=IR_STORE_LOC,.slot=0,.a=11},
      /*13*/ {.op=IR_LOAD_LOC,.slot=1}, /*14*/ {.op=IR_CONST,.imm=1}, /*15*/ {.op=IR_ADD_SAFE,.a=13,.b=14}, /*16*/ {.op=IR_STORE_LOC,.slot=1,.a=15},
      /*17*/ {.op=IR_LOOP},
    };
    int vals[4] = {7, 7, 99, 7};                         // matches at 0,1,3; differs at 2
    TArray *a = make_int_array(4, vals);
    int64_t L[4] = {0, 0, 4, (int64_t)(intptr_t)a};      // c,i,n,a
    int64_t e = run_ir(ir, 18, 2, L);
    check("streq: exits via guard-true (id 1) at first mismatch", e == 1);
    check("streq: counted 2 matches before mismatch (c==2)", L[0] == 2);
    check("streq: stopped at i==2 (the mismatch)", L[1] == 2);
    free(a->values); free(a);
  }

  qjit_ir_finish();
  printf("\n%d passed, %d failed\n", g_pass, g_fail);
  return g_fail ? 1 : 0;
}
