# PLAN — Engine tier, round 6: what `qjsc -A` leaves on the table

**Written 2026-09-04 (end of round 5). Status: IN PROGRESS — E0 done (§0b), E1 killed pre-build, E2 next.**
Round 5 banked L1 (Futamura AOT via the ivankra fork's `qjsc -A`) at
**1.297× all-24 / 1.335× ProcGen16 / 1.223× ALE8 over adv** at the published
topology, 1.377× panel C, bit-exact, checksum-clean — see
`HANDOFF-2026-09-04-engine-tier-L1.md` (what was built, jobs, gotchas) and
`tuning_notes.md` § "ROUND 5 — engine tier" (every table). Adoption of the
fork is Ryan's decision and is **not** assumed here; everything below is
measured against futT2 as the new engine-tier baseline *and* against adv,
so the numbers are useful whichever way that decision goes.

Read in this order: this file → `HANDOFF-2026-09-04-engine-tier-L1.md` →
`PLAN-engine-tier.md` §1–§2 (dead list, rules; still binding) →
`tuning_notes.md` tail. Then `git -C $WE log -1` and `squeue -u rtruong`.

---

## 0. Where the time goes now (and the ceiling)

Round-3 profile of the *interpreter* (SIGPROF, % of `.so` samples):

| bucket | breakout | plunder | bigfish | miner | maze |
|---|---|---|---|---|---|
| interp residual (dispatch/decode/stack/boxing) | ~55 | ~50 | ~31 | ~52 | ~56 |
| property access | 16.5 | 16.1 | 10.5 | 6.7 | 5.9 |
| refcount / free | 7.8 | 5.7 | 3.1 | 5.3 | 5.5 |
| rasterizer | 5.8 | 8.8 | 41.1 | 21.8 | 12.5 |
| p5 / host / blit | 5.7 | 9.6 | 6.4 | 6.4 | 10.8 |

`-A` removed dispatch and decode from the first row and bought 1.14–1.20×
on top of the tuned fork. What is left in that row is **operand-stack
traffic through `sp[]`, tag checks and boxing on every arithmetic/compare,
and refcount churn**; the other rows are untouched. There is **no profile
of futT2 yet** — the first task below produces one, and every lever's
expectation must be re-derived from it before it is built.

Ceiling, stated up front: levers E1–E4 together are worth **~1.15–1.25×
whole-frame on the interpreter-heavy games** (breakout, maze, coinrun,
heist, caveflyer, chaser) and **~1.05× on bigfish/miner** (41%/22%
rasterizer). If everything lands: ProcGen ~2.2× → ~2.5–2.7× tuned EnvPool.
**Miner does not flip on engine work**; its cost is 787 draw commands
(generator choice — the template rules, still unwritten, are the only lever
for that). Do not sum per-lever expectations; they hit the same slice.

### 0b. E0 result (2026-09-04, job 44449147) — read this before §5

futT2 profiled on 7 games (`tuning_notes.md` § "ROUND 6" has the full tables).
% of .so samples: AOT residual 30–35 (bigfish 15) · refcount/free 6–20 ·
property access 0.6–15 (breakout 14, plunder 12, coinrun 15; ~0 on the grid
games) · call machinery 3–9 · arith slow paths 0–6 · rasterizer 8–40 · p5
host 5–11 · vec-host worker spin 3–11 (host finding, not engine). By opcode
family: fields 22/15/9 on breakout/plunder/bigfish; stack/local 7.5–30;
calls/globals 7–22; arith+compare 1.5–6.4; array element 1.3–8.2.
`lt/add/sub/mul` are already on inline fast paths; only f64 compares
(`js_relational_slow`, breakout 4.8%) and mixed int/f64 arithmetic leave
the function.

Consequences for §5: **E1 is killed before build** (its ceiling, the slow
bucket, is ~2% geomean on the 5 — below the +5% proceed gate); what
survives is "E1-lite", static f64/mixed fast paths in the compare/arith
bodies, folded into E2. **E2 is the top lever** (1.08–1.15x expected; the
`_check` TDZ tests and `set_value` frees of numeric locals come with it).
**E3 is larger than written below** (calls family 15–25% on draw-heavy
games; expect 1.06–1.12x there). **Fields** are the hottest single frame on
breakout (`find_own_property` 13%): an emitter-side per-site cache is a
probe candidate, Ryan's call. Execution order is now E2 (+E1-lite) → E3 →
E4 → field probe → E5 → E6.

## 1. Already measured — do NOT re-derive (adds to PLAN-engine-tier §1)

- **Fork interpreter vs stock ng, untuned**: 1.02–1.07× (tail-call dispatch).
  Tuned: 1.136× over adv all-24 banked. `-A` on top: ×1.14 (all-24) / ×1.16
  (5 games). Dispatch removal is NOT ~0 on this workload (commit a252840 was
  wrong for the fork).
- **PGO on the AOT unit without its own profile de-optimizes it** 2–8%
  (job 44425939). An unprofiled unit linked *without* `-fprofile-use` against
  PGO'd engine objects is fine (+3% over untuned AOT, local). One merged
  `.profdata` per link; a no-profile object in a PGO'd link is allowed.
- **Superinstructions (L2) and tail-call dispatch (L6)** are subsumed by `-A`
  + the fork. Not worth a job.
- **Property ICs** 0.87–0.945× (round 4, by mechanism). Field-slot
  specialization is still off the table unless E1's profile says fields
  dominate *after* arithmetic is specialized.
- Everything in PLAN-engine-tier §1 (JIT, cmdbuf, GC/jemalloc/NUMA/BOLT/…).

## 2. Rules (inherited; two additions)

All of PLAN-engine-tier §2 (never touch the tuning worktree or the adopted
artifacts; re-collect PGO on every engine change; gate before bench; same-job
interleaved A/B; quote nothing until Ryan adopts; `fasrc` + base64; no `uv
sync`; read the notes tail first). Plus:

7. **Build and measure in separate jobs, or pin.** `serial_requeue`
   preempts; a restarted build job that rewrites `.so` files under a running
   bench job is a real hazard (happened: 44430166). Tag every build
   (`TAG=<lever>`) so nothing overwrites a measured artifact.
8. **Every lever is measured against BOTH futT2 and adv**, in the same job,
   same node. futT2 is the engine-tier baseline; adv is what the paper has.
   The arms of every A/B: `adv`, `futT2`, `<lever>T` (tuned, same recipe,
   fresh all-24 profile). Untuned arms only for a first probe.
9. **Any change to `aot_compile`/the emitted C must keep the "Bytecode
   mismatch" invariant**: `gate_fork.sh` fails an F1 arm whose stderr shows a
   function fell back to the interpreter. Keep it that way.

## 3. Environment map (delta from PLAN-engine-tier §3)

- Worktree: `$BASE/playtrain-wt-engine`, branch `engine-tier` (tracks
  `origin/engine-tier`; `git fetch && git reset --hard origin/engine-tier` to
  sync — the local repo pushes there). All round-5 code: `native/aotfork/`.
- Fork source: `native/aotfork/out/src` (clone of `github.com/ivankra/quickjs`
  @ `cee72b9`, branch `aot`, with `qjsc-hostmode.patch` applied). The
  emitter is `aot_compile()` in `out/src/quickjs.c` (~line 59798), the
  opcode-body table is generated by `out/src/aot-parse.py` from the
  preprocessed `quickjs.i` into `aot-table.h` (bodies are the verbatim
  `js_OP_*` tail-call handler bodies; `needs_pc`, `done_generator` flags).
  **Any emitter change = a change to the pinned fork = keep it as a patch
  file next to `qjsc-hostmode.patch` and apply in `build_fork.sh engine`.**
- Artifacts (`native/aotfork/out/`): `qjsc`, `host_f0*`, `host_f1*_<g>`,
  `libqjs_vec.{fork,fut_<g>,forkT2,futT2_<g>}.so`, `fork24.profdata`
  (58 profraws, all 24 games), `gate_ref/` (V8 reference traces, cached),
  `bank_44439298/`, `abT2_44434726/`, `tune_44425939/`, `vec_ab_44423769/`.
- Scripts: `build_fork.sh` (engine|f0|f1|vec0|vec1; `TUNE=gen|use`,
  `PROFDIR`, `PROFDATA`, `TAG`), `gate_fork.sh`, `bench_fork.sh`,
  `aot_obs_checksum.py`, `vec_prof_driver.py`; sbatch: `l1_fork`,
  `l1_vec_ab`, `l1_tune24` (the full PGO recipe — copy this for any new
  lever), `l1_ab_t2` (A/B only), `l1_bank_any` (banked). Profiler:
  `$WT/native/round3/t7_prof.sbatch` + `prof_buckets.py` (copy into
  `native/aotfork/`, point at futT2; `build_fork.sh` needs a `DBG=1` knob
  adding `-g` — one line).
- Games: the 33 paper games are `$WE/examples/games/js` (the live dir has
  115; never gate against it). ProcGen16/ALE8 lists are in every sbatch.
- Two lineage facts a fresh agent must know: (a) `qjs_host.adv` and
  `libqjs_vec.adv.so` were built from `5a42f71` and **predate the style-cache
  determinism fix `ef74835`** — one terminal frame on qbert differs from the
  current V8 reference; throughput unaffected. (b) node classes differ 1.56×;
  the paper's absolutes live on holygpu8a17402 (do not race the pinned chain
  there); ratios come from same-job A/Bs on any genoa node.

## 4. Measurement protocol (fixed)

Identical to PLAN-engine-tier §4, with the arms of §2 rule 8. Thresholds:
**proceed** ≥ +5% geomean over futT2 on the 5 profiled games (1 worker,
128×5, 300 steps, QJS_DIRTY=1, interleaved, 2 reps); **bank** ≥ +3% all-24
over futT2 at 16×128×5 × 3 trials, gate 33/33 × 3 seeds, checksum24 clean.
Every banked lever also reports its ratio to adv. Untuned probe first
(cheap, `TAG=<lever>`), tuned build only for levers that pass the probe
(`l1_tune24.sbatch` clone with `TAG=<lever>T`; **profile all 24 games**).

## 5. Work items, in execution order

### E0 — Profile futT2 (1 day; blocks everything else)

Copy `t7_prof.sbatch` + `prof_buckets.py` into `native/aotfork/`, add
`DBG=1` to `build_fork.sh` (`-g` on engine objects, AOT unit, host — codegen
unchanged), build `futT2dbg_<g>` for the 5 profiled games + coinrun/heist
(interpreter-heavy) with the all-24 profile, SIGPROF the vec workload,
symbolize with `--inlines`, bucket. The AOT functions are named
`aotN_<jsname>` so per-JS-function attribution comes for free — record the
top 10 JS functions per game too. **Deliverable**: the §0 table re-done for
futT2, plus a per-opcode view if cheap (the emitted C has `/*pcN: OP_x*/`
comments; `perf annotate` on the hot `aotN_draw` gives it). Every lever
below re-states its expectation from this table before being built.

### E1 — Type-feedback specialization in the AOT emitter (the L4 idea, done at compile time)

**What.** Quickening without runtime rewriting. The tier-3 pipeline already
runs an instrumented build of each game for 30 s; extend it to also record,
per bytecode site of the arithmetic/compare/array opcodes, a histogram of
operand tags (int32 / float64 / other). Feed that to `qjsc -A` (new flag
`-T <types.bin>`); for a site that was monomorphic (≥ 99% one tag pair) emit
a **guarded fast path** before the verbatim generic body:

```c
/*pc17: OP_add*/ {
  if (likely(JS_VALUE_GET_TAG(sp[-2]) == JS_TAG_INT && JS_VALUE_GET_TAG(sp[-1]) == JS_TAG_INT)) {
    int64_t r = (int64_t)JS_VALUE_GET_INT(sp[-2]) + JS_VALUE_GET_INT(sp[-1]);
    if (likely((int32_t)r == r)) { sp[-2] = JS_NewInt32(ctx, (int32_t)r); sp--; goto pc18; }
    /* overflow → fall into the generic body (exactness: promotes to double there) */
  }
  <verbatim generic body>
}
```

Same for float64 pairs (`JS_NewFloat64`), `lt/le/gt/ge/strict_eq/neq` (int
and f64), `inc/dec/neg`, `get_array_el/put_array_el` on fast arrays with
in-range int index. **Not** `get_field` (IC autopsy) unless E0 says fields
are the top bucket after arithmetic.

**Why here and not at run time.** No bytecode rewriting, no per-instruction
counters in the hot build (the JIT's counters cost 14%), no races, and the
guard+fast path is ordinary C that thin-LTO+PGO then optimizes across
opcodes. It composes with the existing profile step (one instrumented run
yields both the PGO profile and the type profile).

**Recording.** In `TUNE=gen` builds, the emitter (flag `-R`) emits a
`static uint32_t aotN_types[NPC][4]` per function and a
`__attribute__((destructor))` that appends `(func, pc, tagpair, count)` to
`$AOT_TYPES_FILE`. Per env means per thread — use relaxed atomics or accept
racy counts (they are only used as a ≥99% test). Merge = concatenate.

**Exactness.** Int32 overflow → generic path (double promotion exact by
construction); `-0`, NaN, `strict_eq` on doubles follow the generic body's
semantics — copy `js_binary_arith_slow`'s fast-path conditions, not your
own. The gate (33 games × 3 seeds) and checksum24 are the net; also add
`native/archive/jit/`'s overflow tests to `gate_fork.sh` as a unit case.

**Build.** ~2–3 weeks. Steps: (1) `-R` recording + merge script, on 5
games; (2) `-T` emission for `add/sub/mul/lt/le/gt/ge/strict_eq` int32 only,
probe untuned vs futT2 (untuned) on the 5 → proceed if ≥ +5%; (3) f64,
inc/dec/neg, array element; (4) tuned build + bank. **Expected** (to be
re-derived from E0): 1.10–1.25× on the interpreter-heavy games, ~1.03× on
bigfish. **Kill**: < +5% on the 5 after step 3. **Risk**: medium; the
emitter is small (~150 lines today) and everything is gate-checked.

### E2 — Operand stack to C locals ("register" allocation for the JS stack)

**What.** `-A` output still moves every value through `sp[]` (memory, and
aliased with the caller's frame so clang cannot keep it in registers). The
stack height at every pc is statically known from the bytecode
(`skip_dead_code`/`ss_check` in quickjs.c compute it). Emit per-function
`JSValue s0..sK` locals, and for a whitelist of opcodes (push_i32, push_const,
get/put/set_loc, get/put_arg, dup/drop/swap/nip, the E1 fast paths,
if_true/if_false/goto) use hand-written templates operating on `sN`
instead of the verbatim body; at any non-whitelisted opcode or call, **spill
the live shadow slots to `sp[]`** before and **reload after** (the verbatim
bodies keep working unchanged). Start with spill-everything at every
boundary (correct, cheap to write), then extend the whitelist until the hot
loops of `draw()` run entirely on locals.

**Why.** The fork's own `-B` vs `-A` gap (half the gain lost when clang
can't optimize across opcodes) is exactly this class of traffic. **Depends
on** E0 showing stack traffic (loads/stores to `sp` and `var_buf`) as a top
bucket. **Expected**: 1.05–1.15×. **Kill**: < +5% on the 5 with the hot
opcodes whitelisted. **Risk**: medium-high; exceptions/`sp` unwinding paths
(`exception:` label, `JS_CallInternal`'s `sp` on throw) must see a coherent
stack — spill before anything that can throw. 2–4 weeks; E1 first because
E1's guards are cheaper to write on `sp[]` and E2 then lifts them for free.

### E3 — p5 intrinsics in the emitter (L3, now cheap)

**What.** In AOT'd code a `get_var <p5name>` + `call N` pair whose callee
is one of the host bindings can be emitted as a direct C call with the
arguments unboxed in place (`double` args, no `argv[]`, no `JSValue` return
boxing). **Guard (mandatory)**: at run time compare the global's value with
the binding's `JSValue` captured at init (one pointer compare); on mismatch
(a game shadowed `rect`) take the generic `call`. Emission needs the
binding table: pass it to `qjsc` (`-P p5_bindings.txt`, name/arity) — the
host's `BINDINGS[]` is the source of truth; keep them in one generated
file. **Expected**: ~1.03–1.08× whole-frame; the only lever here that
moves miner/maze (draw-heavy). **Kill**: < +3% on miner+maze. **Risk**:
low-medium. ~1 week. Also removes `JS_NewFloat64` traffic on `color()`
results if `js_color` gets an unboxed variant.

### E4 — Refcount elision inside AOT'd functions

**What.** With E2's static stack, `dup`/`drop` pairs and
`get_loc`→consume patterns become visible to the emitter; skip the
`JS_DupValue`/`JS_FreeValue` pairs that cancel within a basic block (ints and
floats need none at all — `JS_VALUE_HAS_REF_COUNT` is a tag test the
compiler can fold once E1 proves the tag). **Bucket**: 3–8%. Only after E2.
~1 week. **Kill**: < +2% (fold into E2's measurement).

### E5 — NaN-boxing on 64-bit (L5, unchanged)

Independent of the AOT work; see PLAN-engine-tier §5 L5. One-day
feasibility on the fork (Bellard's tree has `JS_NAN_BOXING` for 32-bit
too). Do it last, or in parallel by a second agent — it touches
`quickjs.h`, not the emitter. **Expected** 1.05–1.15×; **kill** gate
failure not fixable in a day.

### E6 — Packaging and the "fresh game" arm (engineering, ~1 week; needed before any adoption)

1. `libqjs_vec.futT2_<g>.so` is one `.so` per game today. Implement
   **compile-at-load** in the trainers' env loader keyed by
   `md5(game.js) + fork commit + profile id`: tier 1 (fork interpreter
   `.so`, shared) immediately; tier 2 (AOT unit, no `-fprofile-use`, PGO'd
   engine objects) in the background (~40 s); tier 3 (instrumented run 30 s
   + rebuild with the game's profile merged) after that (~2 min). Fallback
   to tier 1 on any build failure. Cache dir on `$BASE`.
2. **Measure tier 2 as a banked arm** (24 games, 3 trials, vs adv and
   futT2) so the paper sentence "a never-seen game gets X immediately and Y
   after an automatic profile step" has numbers. Expected ~1.17–1.20× over
   adv (one local datapoint so far).
3. Re-cut **adv** from a tree containing `ef74835` (same recipe, same
   node, null A/B) so the adopted baseline is bit-exact vs the current
   reference; record the new md5s. Ryan decides whether that replaces the
   adopted artifact.

### Out of scope but still the best ratio in the building

**Template rules for the generator** (flat `Uint8Array` grids, int compares,
batched same-color rects): 1.23–1.40× bit-exact in July, game-agnostic for
*future* games, one day, still unwritten. Raise with Ryan again.

## 6. Deliverables

Per lever, in `tuning_notes.md` under `## ROUND 6 — engine tier 2`:
hypothesis (with the E0 bucket it attacks and the expected number derived
from it) → what was built (patch file, `TAG`, md5s, SHA) → gate (33/33 or
the exact divergence) → probe A/B (5 games vs futT2, untuned) → tuned
build (profile all 24) → banked A/B table (24 games, arms adv/futT2/leverT)
→ verdict vs §4 → what it implies for the next lever. Dead levers get the
same write-up. At the end: one summary table (lever × geo-5 × all-24 × panel
C × gate) and a decision list for Ryan. Update
`HANDOFF-2026-09-04-engine-tier-L1.md`'s "not done" list as items close.

## 7. Decision points for Ryan (do not pre-decide)

1. **Adopt the fork (L1 as banked)?** 1.30× all-24; ends "stock quickjs-ng";
   requires E6.1 packaging and re-triggers the whole measurement cascade +
   17402 confirm. If no: round 6 is moot except E5, and the paper stays on adv.
2. **Tier story in the paper**: tier 2 out of the box vs tier 3 after an
   automatic profile step — needs E6.2's number before it is written.
3. **After E1**: type feedback makes the engine a profile-directed compiler;
   is that still "plain JS that runs fast" in his framing?
4. **Re-cut adv** with the determinism fix (E6.3), or document the one-frame
   qbert blemish?

## 8. Appendix — commands

```bash
# sync the cluster worktree to what was pushed
fasrc 'cd /n/holylabs/gershman_lab/Users/rtruong/playtrain-wt-engine && git fetch -q origin engine-tier && git reset -q --hard origin/engine-tier && git log --oneline -1'
# a tuned lever build = l1_tune24.sbatch with TAG=<lever>T and the lever's patch applied in build_fork.sh engine
# a probe = l1_ab_t2.sbatch with arms edited (adv, futT2, <lever>)
# never `sbatch` a build job while a bench job that reads out/ is queued or running
# profile: copy $WT/native/round3/{t7_prof.sbatch,prof_buckets.py} → native/aotfork/, DBG=1 TUNE=use PROFDATA=out/fork24.profdata TAG=T2dbg bash build_fork.sh vec1 <game.js>
```
