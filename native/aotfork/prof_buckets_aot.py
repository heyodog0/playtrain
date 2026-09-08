# E0 (PLAN-engine-tier-round6.md §5): bucketed SIGPROF attribution inside a
# fork vec .so, inline-frame aware, with two AOT-specific views on top of
# round 3's prof_buckets.py:
#   * per-JS-function: every sample whose inline chain passes through an
#     `aotN_<jsname>` frame is attributed to that JS function (innermost such
#     frame), so "which game functions burn the time" comes for free;
#   * per-opcode: the frame of the chain that sits in game_aot.c is mapped to
#     the nearest preceding `/*pcN:*/ /*opname*/` marker the emitter writes, so
#     the residual inside an AOT'd function is broken down by bytecode opcode
#     (what E1/E2 need: which opcodes' tag checks / stack traffic dominate).
# Buckets are round 3's plus "AOT residual" (innermost frame IS the aotN_
# function: operand-stack traffic, tag tests, boxing, refcount inline ops).
#
#   python prof_buckets_aot.py <prof.dat> <libqjs_vec.so> [<game_aot.c>]
#
# prof.dat + prof.dat.maps come from prof_preload.so (playtrain-trainers/benchmarks).
import bisect
import os
import re
import subprocess
import sys
from collections import Counter, defaultdict

prof, so_path = sys.argv[1], sys.argv[2]
aot_c = sys.argv[3] if len(sys.argv) > 3 else None
so_name = so_path.rsplit("/", 1)[-1]

segs, bias = [], {}
for line in open(prof + ".maps"):
    p = line.split()
    if len(p) >= 6 and p[5].startswith("/"):
        s, e = (int(x, 16) for x in p[0].split("-"))
        bias.setdefault(p[5], s)
        bias[p[5]] = min(bias[p[5]], s)
        if "x" in p[1]:
            segs.append((s, e, p[5]))
segs.sort()
starts = [s for s, _, _ in segs]


def seg_of(ip):
    i = bisect.bisect_right(starts, ip) - 1
    if i >= 0 and segs[i][0] <= ip < segs[i][1]:
        return segs[i][2]
    return None


samples, total = [], 0
for line in open(prof):
    ip_s, n_s = line.split()
    ip, n = int(ip_s, 16), int(n_s)
    total += n
    samples.append((ip, n))

so_samples, lib_counter, so_total = [], Counter(), 0
for ip, n in samples:
    path = seg_of(ip)
    if path and path.endswith("/" + so_name):
        so_samples.append((ip - bias[path], n))
        so_total += n
    else:
        lib_counter[(path or "?").rsplit("/", 1)[-1]] += n

sym = subprocess.run(
    ["llvm-symbolizer", "--obj=" + so_path, "--inlines",
     "--functions=linkage", "--demangle"],
    input="\n".join(hex(va) for va, _ in so_samples), capture_output=True, text=True, timeout=900)
blocks = sym.stdout.rstrip("\n").split("\n\n")
assert len(blocks) == len(so_samples), (len(blocks), len(so_samples))

# Trivial inline helpers are never the "cause" of a sample: attribute them to
# the first non-trivial frame outward (JS_IsUninitialized inside get_loc_check
# is the get_loc_check body; set_value is the JS_FreeValue it performs).
TRIVIAL = re.compile(r"^(JS_Is\w+|JS_New(Bool|Int32|Uint32|Float64|Int64)|__JS_NewFloat64|JS_VALUE_\w+|JS_MKVAL|JS_MKPTR|get_u(8|16|32)|get_i(8|16|32)|js_get_stack_pointer|JS_ToBool|JS_VALUE_GET_\w+)$")
BUCKETS = [
    ("vec host spin",     r"^worker_loop|WorkerCtl"),
    ("strict_eq/str-cmp", r"js_strict_eq|^js_eq|string_compare|js_string_memcmp|string_eq"),
    ("property access",   r"JS_GetProperty|JS_SetProperty|find_own_property|find_hashed_shape|add_property|_shape|Shape|JS_DefineProperty|delete_property|set_array_length|js_get_length"),
    ("conversions",       r"JS_To(Number|Float64|Int32|Int64|Uint32|Primitive|String|PropertyKey)|js_atof|js_dtoa|js_ftoa|i64toa|u32toa|js_fcvt"),
    ("atoms/strings",     r"Atom|js_new_string|string_buffer|JS_ConcatString|js_sub_string|JS_NewString"),
    ("gc/alloc",          r"gc_|js_trigger_gc|JS_RunGC|mark_children|js_malloc|js_free|js_realloc|js_mallocz|memory_used"),
    ("refcount/free",     r"JS_FreeValue|free_value|free_object|free_var_ref|free_gc_object|free_zero_refcount|JS_DupValue|^set_value$"),
    ("arith slow paths",  r"js_binary_arith_slow|js_unary_arith_slow|js_relational_slow|js_eq_slow|js_add_slow|js_binary_logic_slow|js_post_inc_slow|js_not_slow|js_shr_slow"),
    ("call machinery",    r"js_call_c_function|js_call_bound_function|JS_CallConstructor|build_arg_list|js_closure|async_func|JS_NewObjectFromShape|JS_CallInternal_exception|^JS_CallInternal(\.|$)|js_poll_interrupts|js_check_stack_overflow|js_create_function|js_function_apply"),
    ("array ops",         r"js_array|expand_fast_array|convert_fast_array|JS_GetPropertyValue|JS_SetPropertyValue|js_get_fast_array"),
    ("regexp/unicode",    r"^lre_|unicode|libregexp"),
    ("math (fm/libm)",    r"^fm_|__ieee754|^js::(sin|cos|pow|sqrt|atan2|hypot)|frozenmath|^js_math"),
    ("rasterizer",        r"playtrain_rasterizer|^rs_|^_RN"),
    ("p5/host/blit",      r"^p5::|qjs_vec|env_step|env_apply|obs|blit|colorFromArgs|^js_(fill|rect|ellipse|stroke|background|circle|arc|line|triangle|quad)"),
    ("AOT residual",      r"^aot\d+(_|\.|$)"),
    ("interp dispatch",   r"^js_OP_"),
]


def bucket_of(fn):
    for name, rx in BUCKETS:
        if re.search(rx, fn):
            return name
    return "other"


# opcode markers in the emitted C: line -> (pc, opname); we take the nearest marker at or above a line
markers = []
if aot_c and os.path.exists(aot_c):
    mk = re.compile(r"/\*pc(\d+):\*/\s*/\*(\w+)\*/")
    fn_rx = re.compile(r"JSValue (aot\d+\w*)\(")
    cur_fn = "?"
    for ln, text in enumerate(open(aot_c, errors="replace"), 1):
        m = fn_rx.search(text)
        if m:
            cur_fn = m.group(1)
        m = mk.search(text)
        if m:
            markers.append((ln, cur_fn, int(m.group(1)), m.group(2)))
marker_lines = [m[0] for m in markers]
aot_c_base = os.path.basename(aot_c) if aot_c else None


def opcode_at(line):
    i = bisect.bisect_right(marker_lines, line) - 1
    return markers[i] if i >= 0 else None


bucket_counter, inner_counter = Counter(), Counter()
jsfn_counter = Counter()                 # samples per JS function (any frame in chain)
jsfn_bucket = defaultdict(Counter)       # per JS function, bucket of the innermost frame
op_counter, site_counter = Counter(), Counter()
op_bucket = defaultdict(Counter)         # per opcode, bucket of innermost frame
aot_frame_total = 0
for (va, n), block in zip(so_samples, blocks):
    lines = block.split("\n")
    frames = [(lines[i], lines[i + 1] if i + 1 < len(lines) else "") for i in range(0, len(lines), 2)]
    inner = "??"
    for fn, _ in frames:
        if fn and not TRIVIAL.match(fn):
            inner = fn
            break
    if inner == "??" and frames and frames[0][0]:
        inner = frames[0][0]
    inner_counter[inner] += n
    b = bucket_of(inner)
    bucket_counter[b] += n
    jsfn = None
    for fn, _ in frames:
        m = re.match(r"aot\d+(_\w+|\.|$)", fn)
        if m:
            jsfn = fn
            break
    if jsfn:
        aot_frame_total += n
        jsfn_counter[jsfn] += n
        jsfn_bucket[jsfn][b] += n
        if markers:
            for fn, loc in frames:
                # loc = "path:line:col"
                parts = loc.rsplit(":", 2)
                if len(parts) == 3 and os.path.basename(parts[0]) == aot_c_base:
                    try:
                        mk = opcode_at(int(parts[1]))
                    except ValueError:
                        mk = None
                    if mk:
                        _, mfn, pc, op = mk
                        op_counter[op] += n
                        op_bucket[op][b] += n
                        site_counter[(mfn, pc, op)] += n
                    break

pct_so = lambda n: 100.0 * n / max(so_total, 1)
print(f"total samples {total}; in {so_name}: {so_total} ({100.0*so_total/max(total,1):.1f}%)")
print("\n== buckets (% of .so samples | % of ALL samples) ==")
for name, n in bucket_counter.most_common():
    print(f"  {name:<20} {pct_so(n):6.2f}%   {100.0*n/max(total,1):6.2f}%")
print("\n== top innermost frames ==")
for fn, n in inner_counter.most_common(25):
    print(f"  {pct_so(n):6.2f}%  {fn}")
print("\n== outside the .so ==")
for lib, n in lib_counter.most_common(8):
    print(f"  {100.0*n/max(total,1):6.2f}%  {lib}")

print(f"\n== JS functions (samples with an aotN_ frame in the inline chain: {pct_so(aot_frame_total):.1f}% of .so) ==")
print(f"  {'% .so':>7}  {'function':<28} top buckets inside")
for fn, n in jsfn_counter.most_common(12):
    tops = ", ".join(f"{k} {100.0*v/n:.0f}%" for k, v in jsfn_bucket[fn].most_common(3))
    print(f"  {pct_so(n):6.2f}%  {fn:<28} {tops}")

if markers:
    op_total = sum(op_counter.values())
    print(f"\n== opcodes (samples mapped to a /*pcN*/ marker: {pct_so(op_total):.1f}% of .so; % of .so | innermost-bucket split) ==")
    for op, n in op_counter.most_common(30):
        tops = ", ".join(f"{k} {100.0*v/n:.0f}%" for k, v in op_bucket[op].most_common(3))
        print(f"  {pct_so(n):6.2f}%  {op:<22} {tops}")
    # opcode families: what E1 (arith/compare/array), E2 (stack/local moves), E3 (calls) would each touch
    FAM = [
        ("E1 arith/compare", r"^(add|sub|mul|div|mod|pow|neg|plus|inc|dec|post_inc|post_dec|inc_loc|dec_loc|add_loc|lt|lte|gt|gte|eq|neq|strict_eq|strict_neq|shl|sar|shr|and|or|xor|not|lnot|typeof)$"),
        ("E1 array element",  r"^(get_array_el|get_array_el2|put_array_el|get_ref_value|put_ref_value|get_length)$"),
        ("E2 stack/local",    r"^(push_|get_loc|put_loc|set_loc|get_arg|put_arg|set_arg|get_var_ref|put_var_ref|set_var_ref|dup|dup1|dup2|dup3|drop|nip|nip1|swap|swap2|rot|perm|insert|undefined|null|goto|if_true|if_false|if_true8|if_false8|goto8|goto16|get_loc0|get_loc1|get_loc2|get_loc3|put_loc0|put_loc1|put_loc2|put_loc3|set_loc0|set_loc1|set_loc2|set_loc3|get_loc_check|put_loc_check|set_loc_uninitialized|get_arg0|get_arg1|get_arg2|get_arg3|put_arg0|put_arg1|put_arg2|put_arg3|get_loc8|put_loc8|set_loc8|push_i8|push_i16|push_i32|push_const|push_const8|push_empty_string|push_this|push_false|push_true|fclosure|fclosure8)"),
        ("E3 calls/globals",  r"^(call|call0|call1|call2|call3|call_method|call_constructor|array_from|apply|return|return_undef|tail_call|tail_call_method|get_var|get_var_undef|check_var)"),
        ("fields",            r"^(get_field|get_field2|put_field|get_field_opt_chain|define_field|get_private_field|put_private_field|get_field_ic|put_field_ic)"),
    ]
    print("\n== opcode families (% of .so) ==")
    fam_tot = Counter()
    for op, n in op_counter.items():
        f = next((name for name, rx in FAM if re.search(rx, op)), "other opcodes")
        fam_tot[f] += n
    for f, n in fam_tot.most_common():
        print(f"  {pct_so(n):6.2f}%  {f}")
    print("\n== top opcode sites (function pc opcode) ==")
    for (fn, pc, op), n in site_counter.most_common(20):
        print(f"  {pct_so(n):6.2f}%  {fn}:{pc} {op}")
