// qjit_ir.h — trace IR + MIR codegen for the QuickJS tracing JIT.
//
// A recorded loop trace lowers to this linear SSA-ish IR, which is then compiled
// to a native loop by MIR. Values live in a `locals` array (the specialized view
// of the QuickJS frame's int slots); loads/stores are memory ops MIR can hoist.
// Guards compile to conditional branches to side-exit blocks that RETURN an exit
// id — the interpreter deopts by resuming at that exit's bytecode PC.
//
// Scope: numeric loops over INT and FLOAT locals/args (both are tagged immediates in
// QuickJS → no refcounting), plus guarded fast-array int/string element loads. The int
// fast path deopts on overflow; the float fast path never overflows (floats never change
// type) so it has no deopt. Heap-value mutation (refcounting) is a later milestone.
#ifndef QJIT_IR_H
#define QJIT_IR_H
#include <stdint.h>
#include <stddef.h>

typedef enum {
  IR_LOAD_LOC,   // r = locals[slot]  (int payload OR, for heap-invariant slots, a JSObject*)
  IR_STORE_LOC,  // locals[slot] = r(a)
  IR_CONST,      // r = imm
  IR_ADD, IR_SUB, IR_MUL,       // r = r(a) op r(b)   (int32, overflow -> deopt)
  IR_ADD_SAFE,   // r = r(a) + r(b), NO overflow guard — only for the loop-induction
                 // increment `i += 1` under a strict `i < n` guard (i+1 <= n <= INT_MAX,
                 // provably no overflow). Guard-free so it can sit safely after a call.
  IR_GUARD_LT,   // if !(r(a) <  r(b)) side-exit exit_id
  IR_GUARD_LE,   // if !(r(a) <= r(b)) side-exit exit_id
  IR_GUARD_GT,   // if !(r(a) >  r(b)) side-exit exit_id
  IR_GUARD_GE,   // if !(r(a) >= r(b)) side-exit exit_id
  // --- heap (increment 1: fast-array int-element load) ---
  // r(a) is a trusted JSObject* (a loop-invariant array, tag+class+fast_array guarded
  // ONCE at trace entry). All heap guards below DEOPT (resume header, re-run iteration
  // interpreted) so the interpreter's slow path handles the non-fast/OOB/non-int case.
  IR_ARRAY_COUNT,   // r = (i64)*(u32*)(r(a) + arr_count_off)         [a = array base]
  IR_ARRAY_VALUES,  // r = *(void**)(r(a) + arr_values_off)           [a = array base]
  IR_GUARD_BOUNDS,  // if (u32)r(a) >= (u32)r(b) DEOPT                 [a = idx, b = count]
  IR_ARRAY_EL_INT,  // e = r(a) + r(b)*jsvalue_size; if *(i32*)(e+tag_off)!=tag_int DEOPT;
                    //   r = (i64)(i32)*(i32*)(e)                     [a = values, b = idx]
  // --- strings (increment 2) ---
  IR_STREQ_EL,      // r = strict_eq(values[idx], atom) as 0/1, via a host helper that
                    //   runs quickjs's own js_strict_eq (content-correct for any element
                    //   type). imm = atom.  [a = values, b = idx]  (no deopt; a pure call)
  IR_GUARD_TRUE,    // if r(a) == 0 side-exit exit_id  (continue iff value truthy)
  IR_GUARD_FALSE,   // if r(a) != 0 side-exit exit_id  (continue iff value falsy) — used when
                    //   the recorded branch path is the negated one. control-flow exit, not deopt.
  // --- nested/global arrays (increment 3) ---
  IR_LOAD_GVAR,     // r = qjit_gvar_array(atom); if r==0 DEOPT. (a global that is a fast
                    //   array, resolved once — loop-invariant, hoisted.)  imm = atom
  IR_ELEM_OBJ,      // r = qjit_elem_array(values + idx*size); if r==0 DEOPT. (materialize an
                    //   array ELEMENT as a fast-array JSObject* — for nested a[x][y].) [a,b]
  // --- call (increment 4: native global fn, int args, result dropped) ---
  IR_CALL,          // call global fn named by atom (imm) with argc int args (r(argv[k]));
                    // side-effect only, result is freed. imm=atom, argc, argv[] = arg refs.
  // --- float specialization (milestone 1) — f64 fast path ---------------------
  // Floats are stored in the SAME int64 `locals` slots (the QuickJS JSValue payload
  // is a double; the host marshals its raw bits into locals[slot] and guards
  // tag==JS_TAG_FLOAT64 at entry, QK_FLOAT). Codegen views a float slot through a
  // MIR_T_D memory op — the 8 bytes reinterpret as the double, no conversion. Float
  // arithmetic NEVER overflows to another type, so the float path has NO deopt (it is
  // like IR_ADD_SAFE — may sit safely after a call). NaN handling lives in the guards.
  IR_FLOAD_LOC,  // r(f64) = *(double*)&locals[slot]      (slot marshaled as FLOAT64)
  IR_FSTORE_LOC, // *(double*)&locals[slot] = r(a)(f64)
  IR_FCONST,     // r(f64) = the double whose raw bits are in `imm` (bit-reinterpret)
  IR_FADD, IR_FSUB, IR_FMUL, IR_FDIV,  // r(f64) = r(a) op r(b)   (no overflow, no deopt)
  IR_I2F,        // r(f64) = (double) r(a)(i64)   — promote an int operand for mixed arith
  // Float compare guards. `imm` carries NEG (0/1): the compare op stored is the ORDERED
  // comparison to test; NEG says which side is "continue".
  //   NEG==0: continue iff (a cmp b) is TRUE  → any unordered/NaN result side-exits.
  //   NEG==1: continue iff (a cmp b) is FALSE → NaN CONTINUES (matches `!(a<b)` in JS).
  // This split is REQUIRED because for floats !(a<b) != (a>=b) under NaN, so — unlike the
  // int guards — negation cannot be folded into the operator; it must stay explicit.
  IR_FGUARD_LT, IR_FGUARD_LE, IR_FGUARD_GT, IR_FGUARD_GE,
  // --- numeric ISA extensions (milestone 2) — int32 bitwise, negate, int mod ---
  // Bitwise ops match JS: operands are int32 (ToInt32), result is a sign-extended int32
  // (MIR *S 32-bit variants). Emitted only when both operands are int (a float operand
  // aborts the trace — the interpreter would ToInt32 it). Shifts mask the count to & 31.
  IR_AND, IR_OR, IR_XOR,  // r = r(a) op r(b)                (ANDS/ORS/XORS)
  IR_SHL,                 // r = (i32)(r(a) << (r(b) & 31))  (LSHS)
  IR_SAR,                 // r = (i32)(r(a) >> (r(b) & 31))  (arithmetic, RSHS)
  IR_NEG,                 // int negate: guard r(a)!=0 && r(a)!=INT32_MIN (else DEOPT — the
                          //   interpreter makes -0.0 / -(INT32_MIN) a float); r = -r(a)
  IR_FNEG,                // float negate: r = -r(a) (via DMUL by -1.0 → correct -0.0 sign)
  IR_MOD,                 // int mod: guard r(a)>=0 && r(b)>0 (else DEOPT, matching the
                          //   interpreter's slow-path bailout); r = r(a) % r(b) (MODS)
  // --- property access (milestone 3) — shape-guarded field read (our inline cache) ---
  // A field read `obj.f` is structurally an array-element read: obj->prop is a JSProperty[]
  // whose entries are 16-byte JSValues (u.value at offset 0), so prop[index] uses the same
  // stride/tag layout as a fast-array element. We add only: a SHAPE guard (deopt if the
  // object's hidden class changed from the one resolved at compile time) and a prop-base
  // load; the value load reuses IR_ARRAY_EL_INT / the new IR_ARRAY_EL_F64.
  IR_SHAPE_GUARD,   // if *(void**)(r(a) + obj_shape_off) != (JSShape*)imm  -> DEOPT   [a = obj]
  IR_LOAD_FIELD_BASE, // r = *(JSProperty**)(r(a) + obj_prop_off)                       [a = obj]
  IR_ARRAY_EL_F64,  // float element/field: guard tag==FLOAT64 (else DEOPT); r(f64) = *(double*)elem
                    //   [a = base(values/prop), b = idx] — the f64 twin of IR_ARRAY_EL_INT
  IR_LOOP        // jump to trace top (loop back-edge)
} IROp;

// Struct offsets for heap access — baked from offsetof/sizeof in the host (patched
// quickjs.c) or set by unit tests. Codegen reads these so qjit stays decoupled from
// the quickjs struct definitions. Must be set before compiling any heap trace.
typedef struct {
  int arr_count_off;    // offsetof(JSObject, u.array.count)
  int arr_values_off;   // offsetof(JSObject, u.array.u.values)
  int jsvalue_size;     // sizeof(JSValue)      (16 on 64-bit)
  int jsvalue_tag_off;  // offsetof(JSValue, tag) (8)
  int tag_int;          // JS_TAG_INT (0)
  int tag_float64;      // JS_TAG_FLOAT64 (used by IR_ARRAY_EL_F64 / field float reads)
  int obj_shape_off;    // offsetof(JSObject, shape)   (property-access shape guard)
  int obj_prop_off;     // offsetof(JSObject, prop)    (JSProperty* base; prop[i] is 16B)
} QjitLayout;
extern QjitLayout qjit_layout;

#define QJIT_MAX_CALL_ARGS 8
typedef struct {
  IROp op;
  int a, b;       // operand IR-value indices (for value/guard ops)
  int slot;       // local slot (LOAD/STORE)
  int64_t imm;    // CONST; for IR_CALL: the global-var atom
  int exit_id;    // GUARD
  int argc;       // IR_CALL: number of args
  int argv[QJIT_MAX_CALL_ARGS]; // IR_CALL: arg IR-value indices
} IRInsn;

// Register the call helper the codegen binds to IR_CALL: a host function
//   int64_t (*)(int64_t atom, int64_t argc, int64_t *argv)
// that resolves the global named `atom`, invokes it with argc unboxed-int args, and
// frees the result (reading the host JSContext from a host-set global). qjit_ir.c stays
// decoupled from quickjs — unit tests register a stub. A trace with IR_CALL fails to
// compile (stays interpreted) if no helper is registered.
void qjit_set_call_helper(void *fn);

// Register the strict-eq helper bound to IR_STREQ_EL: a host function
//   int64_t (*)(void *elem, int64_t atom)   // elem = &JSValue (the array element)
// returning (element === atom) as 0/1 via quickjs's own js_strict_eq. A trace with
// IR_STREQ_EL fails to compile (stays interpreted) if no helper is registered.
void qjit_set_streq_helper(void *fn);

// Helpers for nested/global arrays (bound to IR_LOAD_GVAR / IR_ELEM_OBJ). Each returns a
// fast-array JSObject* or 0 (→ the trace deopts). Signatures:
//   int64_t (*gvar)(int64_t atom)    // global named `atom` if it is a fast array, else 0
//   int64_t (*elem)(void *elem_addr) // *elem_addr if it is a fast array object, else 0
void qjit_set_gvar_helper(void *fn);
void qjit_set_elem_array_helper(void *fn);

// Native trace signature: run the loop over `locals`, return the exit taken:
//   >= 0            -> control-flow exit id (locals flushed; resume at that exit's PC)
//   QJIT_DEOPT (-1) -> overflow/type deopt (locals = iteration-START; resume at header,
//                      i.e. re-run this iteration in the interpreter)
typedef int64_t (*qjit_trace_fn)(int64_t *locals);
// Deopt reason codes (all < 0). The interpreter treats ANY negative return as a
// deopt (resume header, re-run the iteration); the distinct codes aid profiling.
#define QJIT_DEOPT        ((int64_t)-1)   // arithmetic overflow / entry type mismatch
#define QJIT_DEOPT_BOUNDS ((int64_t)-10)  // array index out of bounds
#define QJIT_DEOPT_TAG    ((int64_t)-20)  // array element not the guarded type (e.g. non-int)

// Compile an IR trace to a native function via MIR. n_exits = number of distinct
// exit ids used by guards. Returns NULL on failure. Not thread-safe (one ctx).
qjit_trace_fn qjit_ir_compile(const IRInsn *ir, int n, int n_exits);

// One-time init/teardown of the MIR context used by qjit_ir_compile.
void qjit_ir_init(void);
void qjit_ir_finish(void);

// ---------------------------------------------------------------------------
// IR BUILDER: recorded trace (QOp sequence) -> trace IR (abstract-stack -> SSA).
// QOp is a small engine-independent opcode set; the live recorder maps quickjs-ng
// OP_* -> QOp (capturing operands + resolving push_const to its int value), and
// unit tests construct QOp sequences directly. Anything not in this set -> abort
// (build returns nonzero) so the loop stays interpreted (correct).
// ---------------------------------------------------------------------------
typedef enum {
  Q_GET_LOC,    // push locals[slot]                (operand: slot)
  Q_PUT_LOC,    // locals[slot] = pop               (operand: slot)
  Q_SET_LOC,    // locals[slot] = peek (NO pop)     (operand: slot)   [set_loc/set_arg]
  Q_ADD_LOC,    // locals[slot] += pop              (operand: slot)   [fused]
  Q_PUSH_INT,   // push imm (int)                   (operand: imm)
  Q_PUSH_F64,   // push a float const               (operand: imm = the double's raw bits)
  Q_ADD, Q_SUB, Q_MUL,  // b=pop,a=pop, push a op b  (float if either operand is float)
  Q_AND, Q_OR, Q_XOR, Q_SHL, Q_SAR,  // int32 bitwise (b=pop,a=pop); abort if an operand is float
  Q_NOT,                // int32 bitwise-not (a=pop) -> a ^ -1
  Q_NEG,                // unary negate (a=pop); int (guarded) or float
  Q_MOD,                // int mod (b=pop,a=pop), guarded non-negative; float mod aborts
  Q_LT, Q_LE, Q_GT, Q_GE, // b=pop,a=pop, push compare(a,b)  (consumed by IF)
  Q_IF_FALSE,   // pop compare; guard: continue iff TRUE, side-exit(exit_pc) iff false
  Q_GOTO_LOOP,  // loop back-edge -> IR_LOOP        (operand: -)
  Q_GET_ARRAY_EL, // pop idx, pop array-base; push a DEFERRED element (materialized by its
                  // consumer: as int for arithmetic, or fused into a strict_eq)
  Q_PUSH_ATOM,  // push an interned-atom reference (imm = atom); consumed by strict_eq
  Q_STREQ,      // pop 2 (a deferred element + an atom); push (element === atom) as 0/1
  Q_ARRAY_LENGTH, // pop an array base (global/element/local); push its length (fast-array count)
  Q_GET_VAR,    // push a global reference for atom `imm`: a fn (consumed by Q_CALL) OR a
                // global array (consumed by Q_GET_ARRAY_EL / Q_ARRAY_LENGTH)
  Q_CALL,       // pop `slot` int args + the fn ref; call it (side-effect); push void result
  Q_FIELD_LOC,  // fused `localObj.field` read, resolved at compile time: load the object in
                // `slot` (marshaled QK_OBJECT), guard its shape == `imm` (JSShape*), then read
                // property index `foffset` as `ftag` (JS_TAG_INT -> int, JS_TAG_FLOAT64 -> float).
  Q_DROP,       // pop
  Q_DUP,        // push top
  Q_NOP         // label / no-op
} QOp;

// Per-slot marshaling kind (fills QjitTrace.live_kind): how the entry code reads the
// frame slot into L[]. QK_INT = int payload (guard tag==INT). QK_ARRAY = a fast array
// (guard tag==OBJECT && class==ARRAY && fast_array; store JSObject* in L[]).
// QK_FLOAT = float payload (guard tag==FLOAT64; store the double's raw bits in L[], read
// back as JSValue(float) on a control-flow exit — floats are immediates, NO refcounting).
// QK_SKIP: a purely trace-internal slot (an object temp resolved by store-to-load
// forwarding — never a real IR load/store). Not marshaled at entry, not written back.
// QK_OBJECT: a general JS object (guard tag==OBJECT at entry, store JSObject* in L[]; no
// writeback — field reads are read-only). The in-trace SHAPE guard specializes per access.
enum { QK_INT = 0, QK_ARRAY = 1, QK_SKIP = 2, QK_FLOAT = 3, QK_OBJECT = 4 };

typedef struct {
  QOp op;
  int slot;        // GET/PUT/ADD_LOC; Q_FIELD_LOC: the object's L slot
  int64_t imm;     // PUSH_INT / PUSH_F64 bits; Q_FIELD_LOC: the resolved JSShape*
  int32_t exit_pc; // IF_FALSE resume PC (maps to an exit id)
  int32_t foffset; // Q_FIELD_LOC: resolved property index into obj->prop[]
  int32_t ftag;    // Q_FIELD_LOC: resolved field value tag (JS_TAG_INT / JS_TAG_FLOAT64)
} TraceOp;

// Build IR from a QOp sequence. Writes up to `max_ir` IRInsn into `ir`, sets
// *ir_n and *n_exits. Returns 0 on success, nonzero on abort (unsupported op /
// stack underflow / control shape not handled).
// out_exit_pcs (may be NULL): filled with exit-id -> resume bytecode PC (from the
// IF_FALSE exit_pc values, in the same id order the codegen uses).
// out_slot_kind (may be NULL): per local-slot marshaling kind (QK_INT / QK_ARRAY /
// QK_FLOAT), sized >= (max slot + 1); the caller must zero it before the call.
// in_slot_type (may be NULL = all int): per local-slot ENTRY type observed from the
// live frame (var_buf/arg_buf tag), QK_INT vs QK_FLOAT — this is how the builder learns
// a slot is float without any recorder change. A Q_GET_LOC of a QK_FLOAT slot loads it
// as a double; NULL means treat every slot as int (back-compat for the int-only tests).
int qjit_build_ir(const TraceOp *ops, int n_ops, IRInsn *ir, int max_ir,
                  int *ir_n, int *n_exits, int32_t *out_exit_pcs,
                  unsigned char *out_slot_kind, const unsigned char *in_slot_type);

#endif
