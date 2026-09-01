# Bucketed SIGPROF attribution INSIDE the .so, inline-frame aware.
#
# prof_preload.so dumps "ip count" lines + a copy of /proc/self/maps; the
# nm-based prof_symbolize.py lumps everything the compiler inlined into
# JS_CallInternal under one symbol. This symbolizer instead runs
# llvm-symbolizer --inlines on a -g build (DBG=1) and attributes each sample
# to its INNERMOST inline frame, then buckets frames into the categories an
# inline-cache / representation argument needs: strict_eq, property access,
# conversions, GC/alloc, refcounting, atoms/strings, call machinery, raw
# dispatch residual, rasterizer, p5/host, math.
#
#   python prof_buckets.py <prof.dat> <libqjs_vec.so path>
#
# The .maps copy must sit next to prof.dat (prof_preload writes it).
import bisect
import re
import subprocess
import sys
from collections import Counter

prof, so_path = sys.argv[1], sys.argv[2]
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


samples = []
total = 0
for line in open(prof):
    ip_s, n_s = line.split()
    ip, n = int(ip_s, 16), int(n_s)
    total += n
    samples.append((ip, n))

# split: in-.so vs elsewhere
so_samples = []
lib_counter = Counter()
so_total = 0
for ip, n in samples:
    path = seg_of(ip)
    if path and path.endswith("/" + so_name):
        so_samples.append((ip - bias[path], n))
        so_total += n
    else:
        lib_counter[(path or "?").rsplit("/", 1)[-1]] += n

# one llvm-symbolizer pass over the unique in-.so addresses
addrs = [hex(va) for va, _ in so_samples]
sym = subprocess.run(
    ["llvm-symbolizer", "--obj=" + so_path, "--inlines",
     "--functions=linkage", "--demangle"],
    input="\n".join(addrs), capture_output=True, text=True, timeout=600)
blocks = sym.stdout.rstrip("\n").split("\n\n")
assert len(blocks) == len(so_samples), (len(blocks), len(so_samples))

BUCKETS = [
    ("strict_eq/str-cmp", r"js_strict_eq|^js_eq|string_compare|js_string_memcmp|string_eq"),
    ("property access",   r"JS_GetProperty|JS_SetProperty|find_own_property|find_hashed_shape|add_property|_shape|Shape|JS_DefineProperty|delete_property|set_array_length|js_get_length"),
    ("conversions",       r"JS_To(Number|Float64|Int32|Int64|Uint32|Primitive|String|PropertyKey)|js_atof|js_dtoa|js_ftoa|i64toa|u32toa|js_fcvt"),
    ("atoms/strings",     r"Atom|js_new_string|string_buffer|JS_ConcatString|js_sub_string|JS_NewString"),
    ("gc/alloc",          r"gc_|js_trigger_gc|JS_RunGC|mark_children|js_malloc|js_free|js_realloc|js_mallocz|memory_used"),
    ("refcount/free",     r"JS_FreeValue|free_value|free_object|free_var_ref|free_gc_object|free_zero_refcount"),
    ("call machinery",    r"js_call_c_function|js_call_bound_function|JS_CallConstructor|build_arg_list|js_closure|async_func|JS_NewObjectFromShape"),
    ("array ops",         r"js_array|expand_fast_array|convert_fast_array"),
    ("regexp/unicode",    r"^lre_|unicode|libregexp"),
    ("math (fm/libm)",    r"^fm_|__ieee754|^js::(sin|cos|pow|sqrt|atan2|hypot)|frozenmath"),
    ("rasterizer",        r"playtrain_rasterizer|^rs_|^_RN"),
    ("p5/host/blit",      r"^p5::|qjs_vec|env_step|env_apply|obs|blit|colorFromArgs|^js_(fill|rect|ellipse|stroke|background|circle|arc|line|triangle|quad)"),
    ("interp dispatch",   r"^JS_CallInternal$"),
]


def bucket_of(fn):
    for name, rx in BUCKETS:
        if re.search(rx, fn):
            return name
    return "other"


bucket_counter = Counter()
inner_counter = Counter()
for (va, n), block in zip(so_samples, blocks):
    lines = block.split("\n")
    inner = lines[0] if lines and lines[0] else "??"
    inner_counter[inner] += n
    bucket_counter[bucket_of(inner)] += n

print(f"total samples {total}; in {so_name}: {so_total} ({100.0*so_total/max(total,1):.1f}%)")
print("\n== buckets (% of .so samples | % of ALL samples) ==")
for name, n in bucket_counter.most_common():
    print(f"  {name:<20} {100.0*n/max(so_total,1):6.2f}%   {100.0*n/max(total,1):6.2f}%")
print("\n== top innermost frames ==")
for fn, n in inner_counter.most_common(25):
    print(f"  {100.0*n/max(so_total,1):6.2f}%  {fn}")
print("\n== outside the .so ==")
for lib, n in lib_counter.most_common(8):
    print(f"  {100.0*n/max(total,1):6.2f}%  {lib}")
