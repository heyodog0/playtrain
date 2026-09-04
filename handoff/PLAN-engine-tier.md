# PLAN — Engine tier: a PlayTrain-tuned QuickJS, agnostic to the games

**Written 2026-09-04. Status: PROPOSED, not authorized.** Ryan's constraint, verbatim
intent: *plain JS that runs fast — no authoring change, no per-game compiler, works
on every future LLM-written game.* This plan is the set of engine-level levers that
satisfy that constraint, ordered by information-per-day, with the ceiling stated up
front so nobody is surprised by it.

Read in this order before touching anything: this file → `PLAN-native-tuning.md`
(rules, protocol, dead list) → `tuning_notes.md` §"POST-ROUND-3 PROBE" and §"ROUND 4"
(the profile and the IC autopsy) → `HANDOFF-2026-09-02.md`. Memory files in
`playtrain-wt-tuning/handoff/memory/` are background, not instructions.

---

## 0. The one number that bounds this whole plan

The interpreter is 50–75% of a frame. Round-3 profile (SIGPROF, innermost inline
frame, % of `.so` samples, job 43422679):

| bucket | breakout | plunder | bigfish | miner | maze |
|---|---|---|---|---|---|
| interp residual (`JS_CallInternal` dispatch/decode/stack/boxing) | ~55 | ~50 | ~31 | ~52 | ~56 |
| property access (`find_own_property` hash walk) | 16.5 | 16.1 | 10.5 | 6.7 | 5.9 |
| refcount / free | 7.8 | 5.7 | 3.1 | 5.3 | 5.5 |
| rasterizer | 5.8 | 8.8 | 41.1 | 21.8 | 12.5 |
| p5 / host / blit | 5.7 | 9.6 | 6.4 | 6.4 | 10.8 |

Everything below attacks the first three rows. The remaining cost there is the
intrinsic cost of dynamic typing — tag checks on every arithmetic op, a shape walk on
every field read, a refcount on every value. Engine engineering that stays agnostic
to the games stays agnostic to their types, and on an interpreter that is already
PGO/LTO/`-march` tuned, that buys **~1.3–1.5x on the interpreter share, ≈1.2–1.35x on
the whole frame**. Expected paper effect if everything lands: panel C 1.35x → ~1.7x,
Fig 4A vs EnvPool-best 1.64x → ~2.1x. **miner does not flip** (0.66x → ~0.85x; its
cost is 787 draw commands, a generation choice). If the goal is a 3x headline or
miner ahead of ProcGen, this plan is the wrong instrument — that needs type
information (see `PLAN`-less note in memory `aot-history`), which Ryan has declined.

The levers here compound poorly because they hit the same slice. Do not sum the
per-lever expectations.

## 1. Already measured — do NOT re-derive (adds to PLAN-native-tuning §"dead")

- **Property inline caches, two designs**: 0.87–0.945x (`native/archive/prop-ic/`).
  Root cause: ng's lookup is a 1–2 probe hash walk over lines the caller already
  touches; a monomorphic IC hit cannot be shallower, only add working set. This is
  why "quickening" below must specialize on *operand types*, never cache lookups.
- **Tracing JIT** (commits 42e12f7..a252840, archived af9a35c): bit-exact, net
  slowdown; firing on coinrun 12% slower; instrumentation alone cost 14%.
- **Threaded/computed-goto dispatch**: already on (`DIRECT_DISPATCH 1`,
  `quickjs.c:54`). The July spike measured further dispatch tricks at ~0.
- **p5 command buffer** (`native/qjs/p5_cmdbuf.hpp`): 0.274 JS-side / 0.977 C-side.
  Dead. The p5-intrinsics lever below is a different mechanism (opcode, not buffer).
- GC threshold 0.0–0.2%, jemalloc 0.6–4.2%, NUMA ~1.0x, BOLT, CSPGO, xLTO, THP,
  scheduler surgery, NG bump (0.998x, but bumping IS safe).
- **Infra is not the bottleneck**: job 43976158 — affinity ≤0.6%, async 0.65–0.90x,
  pool depth flat; per-thread rate flat 29.0k from 1 core to 80 threads.

## 2. Rules (non-negotiable; inherited from PLAN-native-tuning + the 09-02 handoff)

1. **Never touch the live tree or the adopted artifact.** `playtrain/` (live) is
   read-only. `playtrain-wt-tuning/native/build/libqjs_vec.so` must stay md5
   `b3709b3980193d0890856dedc923e923` (= `variants/libqjs_vec.adv.so`) and
   `native/build/qjs_host` md5 `46ea49991fe2c6321cb5a0a9b558aebe`. Every build
   writes to `OUT=build/libqjs_vec.<name>.so` and copies to `variants/`; if a
   build script clobbers `build/qjs_host`, restore it from `variants/qjs_host.adv`
   and md5-verify before the job exits.
2. **Every engine change re-collects PGO.** A modified `quickjs.c` mismatches the
   function hashes in `pgo/adv.profdata`; clang silently drops the hot functions'
   profiles ("the mh confound"). Recipe = `analogen-jaxbench/adopt_build.sbatch`:
   `PGO_MODE=gen` build → `_t2prof_driver.py` on the 8 profile games × 30 s →
   `llvm-profdata merge` → `CPP_MODE=use CPP_PROFDATA=<new> VIS=1 RUST_MODE=use
   RUST_PROFDATA=$WT/pgo/rust2.profdata OUT=build/libqjs_vec.<name>.so bash
   native/build_qjs_vec_tune.sh`. Compare tuned-vs-tuned only.
3. **Gate before bench.** `native/gate_qjs.sh --all` (100/100 PASS on both lineages
   as of 09-01; any FAIL is a regression, not "the known blemish") plus the
   2,000-step obs checksum on all 24 games for anything that touches evaluation
   order. Divergence = stop and report game/step; a divergent engine is a
   paper-invalidating change, not a tuning knob.
4. **Same-job, same-node, interleaved A/B.** Nodes differ 1.56x in clock. Two arms
   in two jobs is not a measurement. Iteration A/Bs on `serial_requeue -C genoa
   --exclusive`; banked runs pinned `-w holy8a24307` (the matrix/anchor node).
5. **Quote nothing** in the paper, handoffs-as-results, or memory as a result until
   Ryan adopts. Write findings to `tuning_notes.md` under a new "ROUND 5 — engine
   tier" heading in the established style (hypothesis, build, gate, numbers, verdict).
6. `fasrc '<cmd>'` only, never `ssh`; embedded scripts go base64 (the shell eats
   quotes). Do NOT `uv sync` in `analogen-jaxbench` (it prunes envpool + PyQt5).
7. Fetch and read `tuning_notes.md` tail before starting — another session may
   have moved this.

## 3. Environment map

Cluster (`fasrc`), all under `BASE=/n/holylabs/gershman_lab/Users/rtruong`:
- `$BASE/playtrain-wt-tuning` — worktree, branch `native-tuning` (detached HEAD
  5a42f71 as of 09-02; `git status` first). Engine source `native/qjs/src/`
  (quickjs-ng **0.15.1**). Hosts `native/qjs/qjs_host.cpp` (single-env; gate +
  panel C) and `native/qjs/qjs_vec_host.cpp` (the `.so`; Fig 4A + trainers).
  V8-exact math: `native/frozenmath/` (fdlibm objects) + `native/qjs/v8libm/`.
  Variants: `native/build/variants/libqjs_vec.<name>.so`. PGO: `$WT/pgo/`.
- `$BASE/playtrain-trainers` — benches. `benchmarks/bench_vec_rollout.py` (the
  published protocol; swaps no `.so`, uses the default path) and
  `benchmarks/bench_vec_knobs.py --mode sync --lib-path <so>` (byte-equivalent
  `--no-model` loop, takes an explicit `.so`, prints its md5; **prefer this for A/B
  — no `.so` swapping**). Logs land in `$BASE/playtrain-trainers/logs/` (relative
  to the submit dir, not analogen-jaxbench).
- `$BASE/analogen-jaxbench` — `.venv/bin/python` (3.13, envpool 1.2.5), sbatch
  templates (`adopt_build.sbatch`, `adv_anchor.sbatch`, `ep_best_sweep.sbatch`),
  `outputs/`.
- `$BASE/playtrain` — live tree; games at `examples/games/js/` (33 files; the
  16 ProcGen + 8 ALE names are listed in `adv_anchor.sbatch`).
- Profiling: `native/round3/t7_prof.sbatch` + `prof_buckets.py` (the bucket table
  above; reuse to re-profile any variant).

Laptop: `~/code/lab/playtrain/{playtrain,playtrain-wt-tuning,playtrain-trainers}`;
the July AOT/JIT artefacts are ONLY in the Dropbox backup
`~/Library/CloudStorage/Dropbox/code-backup/lab/node-gym-gen/node-gym/native/`
(`jiteval/aot/` = the ivankra quickjs fork with `qjsc -A`, prebuilt for arm64;
`jiteval/hotloop*`, `compile/transpile.mjs`, `games/bigfish.cpp`, `RESULTS.md`).
Nothing from there is on the cluster; upload what you need (tar | base64).

## 4. Measurement protocol (fixed; deviations get written down)

- **Iteration A/B** (per lever, per variant): 1 worker, `--envs 128 --env-threads 5
  --steps 300 --warmup 20 --max-steps 2000 --frame-skip 1`, `QJS_DIRTY=1` on every
  PlayTrain arm, the 5 profiled games (breakout plunder bigfish miner maze),
  interleaved A,B,A,B, 2 reps each, same job. Report per-game ratio + geomean.
  **Proceed threshold: ≥ +5% geomean on the 5 games.** Below that the lever is
  dead; write it up and move on.
- **Banked run** (only for levers that pass): 16 workers × 128 envs × 5 threads,
  all 24 games, same-job A/B vs adv, 300-step window × 3 trials, `-w holy8a24307`.
  Plus single-core `qjs_host bench` on the 16 ProcGen games for the panel-C number.
  **Bank threshold: ≥ +3% all-24 geomean, gate 100/100, checksum24 clean.**
- Every job banner prints: hostname, `uname -r`, md5 of every `.so`/host it loads,
  `QJS_DIRTY`, git SHA of the worktree.
- One variant per lever, named `libqjs_vec.<lever>.so`; combinations get their own
  name (`e.g. fut_si`). Never overwrite a variant; the record is the file.

## 5. Levers, in execution order

Order is by information-per-day, not expected gain. L1 is first because the code
exists and it bounds L4.

### L1 — Futamura AOT of bytecode (`qjsc -A`): measure the dispatch floor

**What it is.** First Futamura projection: specialize the interpreter to the fixed
bytecode. `qjsc -A` emits, per JS function, a C function that is `JS_CallInternal`'s
handler bodies unrolled in bytecode order, operands constant-folded, `goto`s for
branches; clang -O2 compiles it. Removes dispatch/decode and nothing else — values
stay boxed, `get_field` still walks the shape. 100% coverage by construction (it IS
the interpreter's code); bit-exact by identity modulo float contraction
(`-ffp-contract=off`, already the project convention).

**Evidence.** The fork's README: +36% geomean on Octane v7 (base 2582 → 3518),
+8% from tail-call dispatch alone. The July notes disagree on our workload
(`DESIGN.md`: "AOT/baseline removes dispatch only → 1.6x"; commit a252840:
"dispatch-removal ~0 on QuickJS; only unboxing wins"). **Unmeasured on any real
game.** This lever's job is to settle that.

**Catch.** The fork (`github.com/ivankra/quickjs`, branch `tail` → `-A`) is a fork
of **Bellard's** QuickJS, not quickjs-ng. Its `-A` depends on the tail-call dispatch
refactor. So this is an *engine swap* for the measurement, and any gate divergence
must be attributed correctly.

**Build (standalone harness, do not touch the ng host):**
1. Upload `jiteval/aot/` source (not the arm64 binaries) to `$WT/native/aotfork/`;
   `make` on a genoa node (`clang`, same flags family as `build_qjs.sh`).
2. `qjs_host_fork.cpp` = `qjs_host.cpp` compiled against the fork's `quickjs.h`
   (API is largely shared; expect a handful of `#ifdef`s — ng extensions like
   `JS_IsArray` signature changes; frozenmath registration is plain
   `JS_NewCFunction`, portable). Modes needed: `trace` (gate) and `bench`.
3. Control arm **F0**: the fork's *interpreter* running the game (no `-A`). Gate
   it. Divergences here are engine differences (Math, sort stability, string
   ops), not AOT bugs — fix or document before going further.
4. Arm **F1**: `qjsc -A` the game to C, link into the harness. Read `qjsc.c`
   first for the emitted entry shape (it emits a `main` by default; you need the
   compiled module callable after the host has installed `rect/fill/...` on the
   global object — the game references them as globals at call time, so install
   bindings before evaluating the compiled module). Gate F1 == F0 == ng.
5. Bench F0, F1, and ng adv (`qjs_host bench`, single core, same node, 5 games ×
   3 reps interleaved). **Two ratios matter**: F1/F0 (what `-A` buys, engine held
   constant) and F0/ng (what the engine swap costs/buys on its own).
6. If F1/F0 ≥ 1.15 on the geomean: proceed to a vec-host port
   (`qjs_vec_host.cpp` against the fork + per-game `-A` compile at load, cached
   in `$TMPDIR` keyed by game md5 — compile time is seconds with clang) and the
   full protocol §4. If < 1.15: **write the floor down and stop** — it also means
   L2 and L6 are bounded by roughly the same number.

**Expected**: 1.1–1.4x on the interpreter share. **Kill**: F1/F0 < 1.15, or a
gate divergence in F1 that F0 doesn't have (that would be a codegen bug worth one
day of chasing, not more). **Risk**: adopting the fork abandons "stock quickjs-ng"
and puts engine maintenance on us; note that cost in the write-up whatever the
number says.

### L2 — Superinstructions (ng-local, cheap)

**What.** Fuse the commonest adjacent bytecode pairs into one opcode with one
dispatch: `get_loc N; get_field A` → `get_loc_field`, `get_loc; get_loc; add`,
compare-and-branch (`lt; if_false` → `if_lt`), `get_arg/put_loc` pairs,
`push_i32; add`. Emitter-side peephole in `js_emit_op`/resolve_labels, handler =
the two bodies inlined. Standard interpreter lever; ng has a few already
(`get_loc0_loc1`), check what exists before adding.

**How to pick pairs.** Instrument (in a *profiling build only*, never the bench
build — the JIT's always-on counters cost 14%) a bigram histogram of executed
opcodes over the 5 games × 2000 frames. Take the top ~10 pairs covering ≥40% of
dynamic bigrams. Implement, gate, A/B per §4.

**Expected**: 1.05–1.15x on the interpreter share. **Kill**: < +5% on the 5 games
after the top-10 pairs. **Risk**: low; pure emitter+handler change, gate catches
semantic slips.

### L3 — p5 intrinsics (opcode-level fast path for the closed p5 table)

**What.** `rect(a,b,c,d)` today: `get_var rect` (global lookup) → `call 4` →
`JS_CallInternal` → CFunction trampoline → `argv[]` of boxed `JSValue` → unbox 4
doubles → rasterizer. Intrinsic: the emitter recognizes a direct call to a global
whose name is in the p5 table with matching arity and emits `OP_p5call <id>
<argc>`; the handler reads the operands off the stack, unboxes in place, calls the
rasterizer binding directly, pushes `undefined`. Same trick `frozenmath` plays for
`Math.*`, one level up.

**Semantic guard (mandatory).** A game may shadow `rect` (a local, a redefined
global). The handler must check at run time that the global binding is still the
host's builtin (compare the function pointer / a per-context "p5 intrinsics
valid" flag cleared by any `put_var` to a p5 name); on mismatch fall through to
the generic call path. Gate on all 33 games catches any miss.

**Expected**: 1.03–1.08x whole-frame; ceiling is the 6–11% p5/host bucket. Worth
more on draw-heavy games (miner/maze/heist 65–82% drawing) — it's the only lever
here that touches miner at all. **Kill**: < +3% on miner+maze specifically.
**Risk**: low-medium (emitter change + a new opcode; the guard is the subtle part).

### L4 — Bytecode quickening (type-specialized opcodes, CPython-3.11 style)

**What.** The one lever the round-4 autopsy names as reaching the ~50% interp
residual. At run time, after a generic op executes N times with the same operand
types, rewrite it in place to a specialized variant: `add` → `add_int_int` /
`add_f64_f64`; `lt` → `lt_f64`; `get_field` → `get_field_slot k` guarded by shape
pointer (NOTE: this is *specialization* — one compare + fixed-index load — not a
cache walk; the IC round's lesson is that the lookup can't be cached shallower,
but a resolved slot index is not a lookup); `get_array_el` → typed fast-array
element load. Guard fail → execute the generic path AND rewrite back to generic
(deopt is a bytecode store, no snapshots). `draw()` executes the same code every
frame, so the steady state is reached in the first few frames of an episode and
survives resets (bytecode is per-function, shared across envs — see risk).

**Why it might work where ICs didn't**: ICs saved a *lookup*; quickening saves the
*tag checks and boxing* on arithmetic and compares, which the profile puts inside
the 31–56% residual. It also removes the shape walk for the specialized
`get_field_slot` — the IC failure argues this part will be neutral, so expect the
win from arithmetic, not fields.

**Build.** In `JS_CallInternal`: add specialized opcodes + a per-instruction
counter in the *bytecode stream* (an inline byte, not a side table — the JIT's
side-table counters were the 14%). Start with `add/sub/mul/lt/le/gt/ge/
strict_eq` on int32/f64 and `get_array_el` on fast arrays; add
`get_field_slot` second, measured separately.

**Shared-bytecode hazard — VERIFIED ABSENT (2026-09-04).** `env_init`
(`qjs_vec_host.cpp:431-462`) does `JS_NewRuntime` + `JS_NewContext` + `JS_Eval` of
the game source **per env**, on the env's owning thread. Bytecode is per-env, so
in-place rewriting is race-free with no locking. (Corollary for L1: a per-game
`-A` artefact is shared read-only across envs, which is fine; and 2,048 × compile
at init is startup cost only, outside the timed window.)

**Expected**: 1.1–1.3x on the interpreter share; this is the only lever here that
could plausibly exceed 1.2x whole-frame. **Kill**: < +5% on the 5 games after
arithmetic+array specialization (do NOT proceed to field specialization if
arithmetic alone is dead — fields are the part the IC autopsy already condemned).
**Risk**: medium-high; ~2–4 weeks; touches the interpreter core. Int32 overflow →
double promotion must be exact (the JIT's "overflow-correct codegen" tests in the
archive are reusable as a spec).

### L5 — NaN-boxing on 64-bit

**What.** ng's `JSValue` on 64-bit is 16 bytes (union + int64 tag);
`JS_NAN_BOXING` exists but is enabled only `#if INTPTR_MAX < INT64_MAX`
(`quickjs.h:174-176`, "for 32bit builds"). An 8-byte value halves stack and
heap value traffic. On x86-64 pointers fit 48 bits, so the payload fits a NaN.

**Feasibility first (one day, no cluster).** Force `JS_NAN_BOXING 1` on a 64-bit
build and see what breaks: every `JS_VALUE_GET_PTR`, the tag helpers, `JS_MKPTR`,
and any place that assumes `sizeof(JSValue)==16` (atom/shape structs, the GC mark
loop). Upstream discussions in ng mention this; check their issue tracker for a
patch before writing one. If the arm64 laptop build passes `gate_qjs.sh --all`
locally, take it to the cluster.

**Expected**: 1.05–1.15x. **Kill**: gate failure that isn't fixable in a day, or
< +5% on the 5 games. **Risk**: medium; invasive, but the gate is a strong net.

### L6 — Tail-call dispatch

Comes for free with the L1 fork (+8% Octane on its own; measured there as arm
F0 vs ng). Only relevant if L1 leads to adopting the fork; not worth porting to
ng standalone. No separate work item.

### Out of scope here, but the highest ratio in the building

**Template rules** — not an engine lever, so not in this plan, but the fresh
agent should know: the July `coinrun_fast` experiment changed nothing but how the
LLM wrote the game (flat `Uint8Array` grid, int compares, batched same-color
rects) and measured **1.23–1.40x bit-exact**. The "Performance & Representation
Rules" block for `GAME_TEMPLATE.md` was drafted 2026-07-10 and never written. It
is game-agnostic for *future* games (it is the generator), keeps games plain JS,
costs a day, and is the only lever anywhere that touches miner's 787 draw
commands. Raise it with Ryan alongside this plan.

## 6. Deliverables

Per lever, in `tuning_notes.md` under `## ROUND 5 — engine tier`:
hypothesis → what was built (variant name, md5, git SHA/diff location) → gate
result (100/100 or the exact divergence) → A/B table (5 games, per-game ratio,
geomean, node, job id) → verdict against the §4 thresholds → what it implies for
the next lever. Dead levers get the same write-up; the record of what didn't work
is half the value (see §1).

At the end: one summary table (lever × geomean-5 × all-24 × panel-C × gate) and a
recommendation, framed as a decision for Ryan, never as an adoption.

## 7. Decision points for Ryan (do not pre-decide)

1. **After L1**: adopt the Bellard fork (gains `-A` + tail-call; loses "stock
   quickjs-ng", takes on engine maintenance) — or stay on ng and pursue L2–L5.
2. **After L4**: quickening changes the engine substantially; it ends the "stock
   engine" claim the same way ICs would have. Worth it at the measured number?
3. **Whether anything here goes into *this* paper** or waits for the next: every
   banked lever re-triggers the adv cascade (Table 1, panels C/D, ladder, Fig 4A).

## 8. Appendix — commands

```bash
# cluster access (auth is automatic; first call may take ~20–60 s silently)
fasrc 'cd /n/holylabs/gershman_lab/Users/rtruong/playtrain-wt-tuning && git status -sb && git log -1 --oneline'
# ship a script (quotes get eaten; always base64)
B=$(base64 -i local.sh); fasrc "echo $B | base64 -d | bash"

# build a variant with fresh PGO (mirror adopt_build.sbatch; run as an sbatch on genoa)
PGO_MODE=gen PROFDIR=$WT/pgo/<name>_raw bash native/build_qjs_vec_pgo.sh
#   ... run $WT/pgo/_t2prof_driver.py on: breakout miner bigfish plunder maze chaser dodgeball coinrun (30 s each)
llvm-profdata merge -o $WT/pgo/<name>.profdata $WT/pgo/<name>_raw/*.profraw
CPP_MODE=use CPP_PROFDATA=$WT/pgo/<name>.profdata VIS=1 RUST_MODE=use \
  RUST_PROFDATA=$WT/pgo/rust2.profdata OUT=build/libqjs_vec.<name>.so bash native/build_qjs_vec_tune.sh
cp native/build/libqjs_vec.<name>.so native/build/variants/
# restore the adopted artefacts if the script touched them, then verify
md5sum native/build/libqjs_vec.so native/build/qjs_host   # b3709b39... / 46ea4999...

# gate
cd native && ./gate_qjs.sh --all            # 100 PASS expected

# A/B without swapping .so files (same-job, interleave arms)
PY=$BASE/analogen-jaxbench/.venv/bin/python
export PYTHONPATH=$BASE/playtrain-trainers/src:$WT/src QJS_DIRTY=1 OMP_NUM_THREADS=1
$PY benchmarks/bench_vec_knobs.py --game <g> --games-dir $BASE/playtrain/examples/games/js \
  --lib-path $WT/native/build/variants/libqjs_vec.<name>.so --mode sync \
  --envs 128 --workers 1 --env-threads 5 --steps 300 --warmup 20 --out <json>
# single-core panel-C protocol: ./build/qjs_host <game.js> bench  (see sweep4_adv.sh in ~truong)
```

Profile a variant: `native/round3/t7_prof.sbatch` + `prof_buckets.py` — produce the
§0 table for the new build before and after; the bucket that moved is the claim.
