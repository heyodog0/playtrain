# HANDOFF 2026-09-04 (night) — Round 6: E3 banked, adoption authorized, packaging next

**Read this first, then only what it points at.** Written at the end of a
single long session so the next one can start with a clean context. Every
number below has a job id; every file below is on branch `engine-tier`
(local repo `/Users/heyodogo2/code/lab/playtrain/playtrain`, `origin/engine-tier`,
cluster worktree `/n/holylabs/gershman_lab/Users/rtruong/playtrain-wt-engine`,
all three at commit `c4478ea` or later). The tuning worktree, the live tree,
`libqjs_vec.adv.so` (md5 b3709b39…) and `qjs_host.adv` (46ea4999…) were never
written.

Companion documents (in reading order after this one):
1. `handoff/PLAN-engine-tier-round6.md` — the round-6 spec; §0b is the E0 result and
   the re-derived expectations; §5 E1–E6 are the levers (E3 as *built* differs from
   E3 as *specified*, see §3 below); §7 the decision points.
2. `handoff/tuning_notes.md` § "ROUND 6 — engine tier 2" — every table (E0 profile,
   E3 probe / tuned / banked / re-profile, round-6 summary table, decision list).
3. `handoff/HANDOFF-2026-09-04-engine-tier-L1.md` — what L1 (`qjsc -A`) is, the
   fork, the hosts, PGO constraints, the three-tier story for a new game (§4b).
4. `handoff/PLAN-engine-tier.md` §1–§2 — the dead list and the rules; still binding.

---

## 0. Decision taken at the end of the session

Ryan (the user) said: **adopt this and merge it into the main repo, but make sure
future generated JS games still get the gains.** The agreed sequence (§6) is:

1. **E6.2 — measure tier 2** (AOT + intrinsics on a game unit with NO profile of its
   own, linked against PGO'd engine objects) as a banked arm on all 24 games, vs
   adv and vs futIT2. This is the number for "a never-seen game gets X immediately".
2. **Holdout check** on the 9 paper games that were never profiled or measured
   (`aim_trainer breakout.multi downwell_fresh flappy_bird flappy_bird.dunk2
   frostbite.jungle jump_king qbert.v2 vvvvvv`): tier 2 and tier 3 vs adv. If the
   tier-2 gain there matches the 24, the future-games claim holds by construction.
3. **E6.1 — packaging**: compile-at-load in the env loader (tier 1 → 2 → 3, cached,
   fallback to tier 1), then merge `engine-tier` into `main`.
4. **Re-cut adv** from a tree containing the determinism fix `ef74835`, merge, and
   re-trigger the measurement cascade + the 17402 absolute-throughput confirm.

Nothing has been merged yet. No paper text has been changed.

---

## 1. Where the numbers stand (all ratios same-job, same-node, interleaved)

Baselines: **adv** = adopted tuned quickjs-ng `.so` (the paper); **futT2** = L1,
the fork + `qjsc -A` + PGO/LTO, banked 1.297× all-24 over adv (job 44439298);
**futIT2** = futT2 + E3 intrinsics, own PGO profile.

### E3 BANKED (job 44482682, holy8a24303 genoa exclusive, 16 workers × 128 envs × 5 threads, 24 games × 3 trials, 216/216)

| | futT2/adv | futIT2/adv | **futIT2/futT2** |
|---|---|---|---|
| ProcGen16 geomean | 1.339 | 1.561 | **1.166** |
| ALE8 geomean | 1.225 | 1.387 | **1.132** |
| all-24 geomean | 1.300 | **1.500** | **1.154** |
| ProcGen16 sum-of-medians | 1.265 | 1.440 | 1.138 |
| ALE8 sum-of-medians | 1.203 | 1.338 | 1.112 |
| panel C single-core ProcGen16 (f1IT2 hosts) | 1.370 | **1.629** | **1.189** |

Every game ≥ 1.035 over L1 (asteroids); heist 1.43, maze 1.60, miner 1.37,
caveflyer 1.26, breakout 1.25, qbert 1.24. Over adv: maze 2.31, heist 2.25, miner
2.08, caveflyer 1.99, breakout 1.92, coinrun 1.90 (vec); maze 2.63, miner 2.43,
heist 2.36 (panel C). Bank gate (+3% all-24) cleared by 5×. The futT2 column
reproduces the L1 banked run to 0.3%.

### Exactness
- Gate (V8+wasm reference, 33 paper games × 3 seeds × 3000 steps, byte-identical
  stdout, scan for "Bytecode mismatch"): **198/198** for the untuned intrinsic hosts
  (job 44468624) and **198/198** for the tuned ones (job 44473809).
- Vec obs/reward/done checksum vs stock quickjs-ng, 24 games × 2000 steps × 32 envs:
  **24/24 identical**, untuned and tuned.
- Locally (arm64 laptop) also byte-identical traces on breakout/maze/heist/coinrun ×
  seeds 1/42/777 between the same engine with and without `-P`.

### Projection onto the paper (ratios only; absolutes need one run on holygpu8a17402)
Paper on 17402: adv 2.326M ProcGen16 aggregate; EnvPool sync16 tuned 1.414M; EnvPool
async+NUMA 1.354M. With the banked sum ratio 1.440: **~3.35M ProcGen16 → 2.37× tuned
EnvPool, 2.47× async+NUMA** (geomean-of-ratios framing gives 1.561 → 2.7×). ALE8 sum
ratio 1.338 → the ~15× column becomes ~20×.

### Untuned probe (job 44468624, non-exclusive) — the clean isolation of the lever
futI/futN (same patched engine, only `-P` differs): **1.204 geomean-5 vec, 1.208 on 7
games, 1.239 single-core**; maze 1.42, miner 1.28, heist 1.26, breakout 1.19, coinrun
1.18, plunder 1.11, bigfish 1.06. futN/fut = 0.99–1.02 (engine patch itself neutral).
Untuned futI already beat tuned futT2 by 1.067 on the five profiled games.

### Tuned A/B (job 44473809, non-exclusive, 212/212)
futIT2/futT2 1.159 all-24 / 1.169 PG16 / 1.141 ALE8; futIT2/adv 1.502; PGO on top
of the intrinsics is worth 1.168 (futIT2/futI), about what PGO was worth before
(the two compose).

---

## 2. What E0 found (job 44449147) and what the futIT2 re-profile found (job 44483163)

Method: `prof_preload.so` (ITIMER_PROF ~1 kHz, in-process, from
`playtrain-trainers/benchmarks/`), vec workload 128×5, 60 s/game, `llvm-symbolizer
--inlines`, `native/aotfork/prof_buckets_aot.py` (innermost NON-trivial inline
frame → mechanism bucket; per-JS-function view via the `aotN_<name>` frames; per-
opcode view via the `/*pcN:*/ /*op*/` markers in the emitted C).

% of `.so` samples, futT2 → futIT2 (7 games: breakout plunder bigfish miner maze coinrun heist):

| bucket | futT2 (L1) | futIT2 (L1+E3) |
|---|---|---|
| AOT residual (stack traffic, tag tests, boxing, inline fast paths) | 30–35 (bigfish 15) | 24–31 (bigfish 12) |
| call machinery | 2.6–8.7 | **0.7–3.3** |
| property access (find_own_property etc.) | 0.6–15 | 0.9–18.5 (breakout 18, coinrun 18.5) |
| refcount/free | 6–20 | 6–20 |
| arith slow paths (f64 compares → `js_relational_slow`) | 0–5.9 | 0–7.3 (breakout 7.3, heist 6.1) |
| rasterizer | 8–40 | 9.5–43 (maze 39, miner 27) |
| p5 host / blit | 5–11 | 3–11 |
| vec host worker spin (host finding, not engine) | 3–11 | 3.5–12 |

By opcode family after E3: **fields** 28.6 / 16.3 / 9.4 / 6.7 (breakout / plunder /
bigfish / coinrun; ~1 on the grid games); **stack/local** 6.7–26 (`put_loc_check`
8.7–11.3 on the grid games, 97–99% of it the `set_value` free of the overwritten
local; `get_loc_check` 2.4–4.6 = TDZ test); calls/globals 5.6–16.8 (now mostly
`get_var` of globals, 4–6.6%, and the arg pushes); array element 1.4–9.3; arith 1.6–9.

What this says about the remaining levers (§5 of the plan):
- **E1 (type-feedback specialization) is dead**: its ceiling was the slow-path bucket,
  ~2% geomean on the five. `lt/add/mul` are already inline int/f64 fast paths.
  "E1-lite" (f64 and mixed int/f64 fast paths in `lt/lte/gt/gte/eq/strict_eq/add/sub/
  mul` handler bodies, ~30 lines, no profile) has a case only on breakout/heist.
- **E2 (operand stack → C locals, TDZ tests proven away, numeric locals known non-
  refcounted)**: 1.08–1.15× expected on maze/heist/coinrun/miner. 2–4 weeks. Measure
  against futIT2.
- **Field IC in the emitter** (per-site `{shape*, slot}` cache, static atom, no bytecode
  rewriting — a different mechanism from the round-4 interpreter ICs that died at
  0.87–0.945×): strongest single bucket left on the object-heavy games; a one-day
  probe, kill < +3% on breakout; **Ryan's call** (plan §7).
- **Host worker spin** 3–12% of CPU (`worker_loop` + `vector<WorkerCtl>::operator[]`):
  idle spin between steps, not engine. One A/B of a futex/backoff wait later.

---

## 3. What E3 is, exactly (so it can be reviewed and packaged)

Not the unboxed-`double` variant the plan's §5 describes. Simpler and exact by
construction:

**At every `get_var <name> ; <args> ; call N` site** (and every `get_var Math ;
get_field2 <m> ; <args> ; call_method N` site) whose `<name>` is in the intrinsics
list and whose argument count ≥ that entry's `min_argc`, the emitter puts a guarded
fast path in front of the verbatim call body:

```c
/*pc111:*/ /*call*/ {
  const uint8_t *pc = aot16_bytecode + 112;
  int __intr = 0;
  { JSValue *__argv = sp - 4; JSValue __f = __argv[-1];
    if (__builtin_expect((int32_t)__f.tag == JS_TAG_OBJECT && ctx->aot_intr != NULL
                         && __f.u.ptr == ctx->aot_intr[0], 1)) {   /* intrinsic rect */
      JSValue __r; int __i;
      sf->cur_pc = pc + 2;
      __r = aot_intr_rect(ctx, (JSValue){ ..., JS_TAG_UNDEFINED }, 4, __argv);
      if (unlikely(__r.tag == JS_TAG_EXCEPTION)) { sf->ret_val = __r; musttail return JS_CallInternal_exception(...); }
      for (__i = -1; __i < 4; __i++) JS_FreeValue(ctx, __argv[__i]);
      sp -= 5; *sp++ = __r; __intr = 1;
    }
  }
  if (!__intr) { <verbatim generic call body> }
}
```

- `ctx->aot_intr[k]` is a per-context table of the **binding function objects**,
  captured by the host after the PRELUDE ran (the prelude rebinds `Math.sqrt/pow/sin/
  cos/atan2/hypot` to the frozen-math host bindings). The host holds strong
  references, so the pointer can never be reused while the env lives; a game that
  shadows `rect` or reassigns `Math.floor` fails the compare and runs the generic body.
- `aot_intr_<name>()` is a host wrapper that calls **the same JSCFunction with the
  same arguments and the same `this`** (undefined for `call`, the receiver for
  `call_method`). What is skipped: `JS_CallInternal` dispatch, `js_call_c_function`'s
  stack check / JSStackFrame push+pop / realm switch / **alloca+copy to pad the
  arguments up to the declared length** (`rect` is declared 5 and called with 4;
  `fill` declared 4, called with 1–3 — nearly every draw call paid the copy) / the
  `cproto` switch, and the `sf->ret_val` memory round trip. Under thin-LTO the binding
  body (`js_rect` → `p5::rect`) inlines into the AOT function.
- `Math.floor/abs/ceil` are engine `f_f` builtins; their wrappers replicate
  `js_call_c_function`'s `f_f` case verbatim: `JS_ToFloat64(argv[0])` → exception,
  else `JS_NewFloat64(fn(d))`. `min_argc = 1` keeps the padding case on the generic path.
- `min_argc` per entry = the number of arguments the binding reads unconditionally.
  Below it, the generic path's undefined-padding is observable, so no fast path.
- Not included: `Math.min/max` (internal `js_math_min_max`, semantics not worth
  replicating), `Math.round/imul/random`, `color()/lerpColor()` (allocate),
  `createCanvas/createGraphics`.
- Site matching is a forward dataflow over the bytecode (stack depth is a bytecode
  invariant; candidate callee slots are joined by intersection at merge points), so
  ternaries inside argument lists are handled. On the 24 paper games it emits 15
  (bigfish) … 52 (caveflyer) sites; every p5 call in every `draw`/`update` of the 7
  profiled games is matched.
- Without `-P`, the `-A` output is byte-identical to before.

---

## 4. Files (all under `native/aotfork/` unless noted; commits 85d86c8 … c4478ea)

| file | what |
|---|---|
| `aot-intrinsics.patch` | +~340 lines on the pinned fork (`ivankra/quickjs` @ `cee72b9`, branch `aot`), applied after `qjsc-hostmode.patch` by `build_fork.sh engine`. `quickjs.c`: `JSContext.aot_intr` field; `JS_SetAOTIntrinsics()`; `aot_load_intrinsics()` (reads `-P` file: `name min` or `Obj.name min` lines); `aot_emit_intrinsic_prologue()` (prototypes); `aot_intr_prepass()` (the dataflow); emission in `aot_compile()`. `quickjs.h`: the three declarations. `qjsc.c`: `-P file` option, prologue call. |
| `aot_intr_list.h` | **Single source of truth**: `AOT_INTR(name, min_argc, js_fn)` × 30 globals, `AOT_INTRM(Math, name, min_argc, fn)` × 9. Hosts include it twice (wrapper definitions, capture table); `build_fork.sh` derives the `-P` file from it with sed. Append only — the order is the index `k`. |
| `qjs_host_fork.cpp`, `qjs_vec_host_fork.cpp` | Under `#ifdef HOST_AOT`: `aot_ff()` + `aot_m_floor/abs/ceil`, the two `#include "aot_intr_list.h"` passes, `aot_intr_capture()` (after the prelude), `aot_intr_release()` (before `JS_FreeContext`). Vec host: `Env.intr_vals[64]`, `Env.intr_tbl[64]`. |
| `build_fork.sh` | Knobs: `TUNE=gen PROFDIR=` / `TUNE=use PROFDATA=`, `TAG=`, `DBG=1` (-g everywhere, codegen unchanged), **`INTR=1`** (derives `out/aot_intr.txt` atomically, passes `-P`, emitted C goes to `out/aotI_<game>/`). `qjsc` is rebuilt whenever a patch is newer than the binary. `engine` step: `git checkout -- qjsc.c quickjs.c quickjs.h && apply both patches`. |
| `e0_prof.sbatch`, `prof_buckets_aot.py`, `e0_summary.py` | E0 profiler (E0 recipe; `e3_prof.sbatch` = same on futIT2). |
| `e3_probe.sbatch` | untuned probe (arms adv / fut / futT2 / futN / futI; gate 33×3; checksum24). |
| `e3_tune24.sbatch` | tuned recipe with `INTR=1` (instrumented → 24-game profile → `forkI24.profdata` → PGO+LTO `TAG=IT2`; gate; checksum; A/B 3/2 reps, arms adv / futT2 / futI / futIT2; fails hard on incomplete builds/profiles). |
| `e3_bank.sbatch` | banked protocol, arms adv / futT2 / futIT2 + panel C (adv / f1T2 / f1IT2). `--exclusive` (80 threads need the whole node). |

Cluster artifacts (`$WE/native/aotfork/out/`): `libqjs_vec.futIT2_<g>.so` × 24 (miner
md5 e9ce216e…), `host_f1IT2_<g>` × 33 (miner bd934cf9…), `host_f0IT2` (d7a92e74…),
`libqjs_vec.forkIT2.so` (ea46589f…), `forkI24.profdata`, `libqjs_vec.futI_<g>.so` ×
24 (untuned), `host_f1I_<g>` × 33, `aotI_<g>/game_aot.c` × 33, `*IT2dbg*` debug
builds for 7 games, result dirs `e3_44468624/ e3tune_44473809/ e3bank_44482682/
e0_44449147/ e3prof_44483163/`, logs `logs/{e0_prof,e3_probe,e3_tune24,e3_bank,e3_prof}_*.out`.

Local scratch (not in git, may be gone): a local clone of the fork with both patches
applied and a working `qjsc` at
`/private/tmp/claude-501/-Users-heyodogo2-code-lab-playtrain/a7d1eb4a-…/scratchpad/fork_out/`.
`FORK_OUT=<dir> bash build_fork.sh engine` recreates it in ~2 min on the laptop
(macOS: clang, no `-march`, RA and frozenmath `.a` are present locally, so
`f0`/`f1` hosts and `trace`/`bench` work locally; the vec `.so` needs
`libfrozenmath_pic.a`, which is not local).

---

## 5. Gotchas learned this session (add to the rules)

1. **`--exclusive` on serial_requeue genoa can wait hours** (0 idle nodes all
   evening, 167 mixed). Ryan approved running the probe, tuned build and re-profile
   **non-exclusive** (`-c 32`/`-c 16`); ratios reproduced the exclusive L1 numbers to
   0.3%. The banked run kept `--exclusive` because 16×5 threads need the node.
2. **`set -o pipefail` + `cmd -h | grep`**: `qjsc -h` exits 1, so the pipeline failed
   even when grep matched ("qjsc lacks -P", job 44460224). Use `( cmd || true ) | grep`.
3. **Parallel `build_fork.sh` invocations must not rewrite shared files in place.**
   `out/aot_intr.txt` regenerated by 12 concurrent `vec1` calls → readers saw it
   truncated → 7/24 instrumented builds silently died (job 44471503; the `grep "^built"`
   filter hid it). Fixed: atomic tmp+`mv`; the job now fails hard on an incomplete
   count. Rule: every `xargs -P` build line must surface errors and be followed by a
   count check.
4. **Macros do not survive into `quickjs.i`**: emitted C must use `JSValue`, the
   struct literal for undefined, `(int32_t)v.tag`, `v.u.ptr` — not `JSValueConst`,
   `JS_UNDEFINED`, `JS_VALUE_GET_TAG`, `JS_VALUE_GET_PTR`.
5. **In this fork `get_var` carries a closure-variable index (u16), not an atom**;
   the name is `b->closure_var[idx].var_name`. (`get_field2` carries an atom.)
6. **The prelude rebinds `Math.sqrt/pow/sin/cos/atan2/hypot`**; capture intrinsic
   objects after it runs, never before.
7. `lldb`/`sample` hang on this laptop (permissions); debug qjsc with `fprintf` +
   an env var, or `-fsanitize=address`.
8. Every `fasrc` command's `echo ====X` must be quoted in zsh (`=word` is a path
   expansion).

---

## 6. The adoption plan in detail

### 6.1 E6.2 — tier-2 banked arm (next job; ~1.5 h on a node)

Tier 2 = the game's AOT unit compiled WITHOUT `-fprofile-use`, linked against the
PGO'd + LTO'd engine objects and host. Verified in round 5 (locally, one game): ThinLTO
accepts a no-profile object in a PGO'd link, +3% over the untuned AOT build, 6% below
fully profiled. Never measured at the bank.

Build-script change (`build_fork.sh`): a knob `UNIT_NOPGO=1` that, in `vec1` and `f1`,
compiles `game_aot.c` with `$CFLAGS` minus the `-fprofile-use=...` flag (keep
`-flto=thin`, `-fvisibility=hidden`) while `vec_common`/`host_common` keep the full
`TUNEFLAGS`. Simplest: build a `UNITFLAGS` variable = `CFLAGS` with the profile flag
stripped via bash `${CFLAGS//-fprofile-use=*.profdata/}` (the profdata path has no
spaces), and use it for the two `game_aot` compiles only. Output tag `IT2u` (`TAG=IT2u
INTR=1 TUNE=use PROFDATA=out/forkI24.profdata UNIT_NOPGO=1`). The engine objects for
`TAG=IT2u` are rebuilt identically to `IT2` (same flags), fine.

Job `e6_tier2.sbatch` (clone `e3_bank.sbatch`): build `vec1` × 24 + `f1` × 33 with
the knob (no profiling step); gate f0IT2 + f1IT2u 33×3; checksum24 futIT2u; banked
arms **adv / futIT2u / futIT2**, 24 × 3 trials, 16×128×5; panel C adv / f1IT2u /
f1IT2. Expected: futIT2u/adv ≈ 1.35–1.42 all-24 (between untuned futI 1.46 on the five
and tuned 1.50). Write the result as the tier table row in `tuning_notes.md` and in
the L1 handoff §4b.

### 6.2 Holdout: the 9 never-profiled paper games

`aim_trainer breakout.multi downwell_fresh flappy_bird flappy_bird.dunk2
frostbite.jungle jump_king qbert.v2 vvvvvv` (the 33 in `examples/games/js` minus the
24). For each: tier-2 build (as above) and tier-3 build (instrumented run 30 s on
that game only, merge its profraw INTO a copy of `forkI24.profdata`, relink that
game's `.so` with the merged profile — this is exactly what the compile-at-load tier 3
will do, so it doubles as its rehearsal). Bench adv / tier2 / tier3 at 1 worker
128×5, 3 reps (the banked topology is not needed for a holdout check). Gate the tier-3
hosts (already gated for tier 2). Pass criterion: geomean tier2/adv on the 9 within
~5% of the 24-game tier-2 number, and tier3/tier2 ≈ the 24-game PGO increment (~1.05–
1.10). Note `aim_trainer` uses mouse input (see memory `continuous-input-status`) and
may not run under the keyboard-only bench; skip it if so and say so.

### 6.3 E6.1 — compile-at-load packaging

Where: `src/playtrain/runtime/native_vec_env.py` (`_load_lib(path)` at line ~55;
`NativeVecEnv(..., lib_path=)` at ~161; two more constructors at ~341 and ~467 take
`lib_path` too). Today the trainers pass `--lib-path` explicitly (bench_vec_knobs.py).

Design:
- New module `src/playtrain/runtime/aot_cache.py`: `resolve_lib(game_js_path) -> Path`.
  Key = sha256 of (game source bytes, fork commit, `aot-intrinsics.patch` +
  `qjsc-hostmode.patch` hashes, `aot_intr_list.h` hash, host sources hash, profdata
  id, compiler version string). Cache dir `$PLAYTRAIN_AOT_CACHE` (default
  `$BASE/aot-cache` on the cluster, `~/.cache/playtrain/aot` elsewhere).
- Tier 1: return the shared `libqjs_vec.forkIT2.so` immediately (it is the fork
  interpreter with PGO; games run unchanged).
- Tier 2: if `<key>/tier2.so` exists, return it; else spawn a detached builder
  (`build_fork.sh vec1` with `UNIT_NOPGO=1 INTR=1 TUNE=use`) writing to a temp name and
  `rename(2)`-ing into place; the env keeps tier 1 for this process; the next process
  (or a `reload` hook) picks tier 2 up. ~40 s.
- Tier 3: after tier 2 exists, a second detached step: instrumented build of that game
  (`TUNE=gen`), 30 s random-play run via `vec_prof_driver.py`, `llvm-profdata merge`
  with `forkI24.profdata`, relink → `<key>/tier3.so`. ~2 min. Prefer tier 3 when present.
- Any build failure → log once, stay on tier 1. Never block env construction on a build.
- Requirements on the training host: clang ≥ 17, llvm-profdata, the pinned fork source
  (clone once into the cache), the profdata, the Rust-PGO rasterizer `.a` and
  `libfrozenmath_pic.a`. On the cluster all exist. For a released wheel this is heavy —
  the wheel ships tier 1 only and the cache builds tiers 2/3 if a toolchain is found.
- Keep `--lib-path` working (explicit path bypasses the cache) so every existing
  bench script stays valid.
- Tests: a pytest that builds tier 2 for one small game into a tmp cache and checks
  (a) checksum equality vs tier 1 over 200 steps, (b) the key changes when the game
  source changes by one byte.

### 6.4 Re-cut adv, merge, re-measure

- adv predates `ef74835` (one qbert terminal frame differs from the V8 reference;
  throughput unaffected). Re-cut with the adopted recipe from a tree containing it
  (`analogen-jaxbench/adopt_build.sbatch`), same node as the current adv, null A/B,
  record md5s. Whether it replaces the adopted artifact is Ryan's call; the re-cut is
  needed anyway so the new engine tier is compared against a clean baseline.
- Merge `engine-tier` → `main` (the branch touches only `native/aotfork/` and
  `handoff/`; plus the new `aot_cache.py`). Then: the full measurement cascade on 17402
  (Fig 4A absolutes, panel C, ladder, Table 1(b)/7/8), the paper's "stock quickjs-ng"
  wording, and the tier sentence with the E6.2 numbers.

---

## 7. What is NOT done (round 6)

- E6.2 tier-2 arm, holdout, E6.1 packaging, adv re-cut, merge, 17402 confirm (§6).
- E2 (stack → locals, with E1-lite folded in), E4 (inside E2), E5 (NaN-boxing).
- Field-IC probe (Ryan's call).
- Host worker-spin A/B (host finding).
- The paper has not been touched. Nothing is quoted anywhere as a result yet except
  in `tuning_notes.md` and the handoffs.

---

## 8. Commands

```bash
# sync the cluster worktree to what was pushed
fasrc 'cd /n/holylabs/gershman_lab/Users/rtruong/playtrain-wt-engine && git fetch -q origin engine-tier && git reset -q --hard origin/engine-tier && git log --oneline -1'
# queue state / logs
fasrc 'squeue -u rtruong -o "%i %j %T %M %R"'
fasrc 'cd /n/holylabs/gershman_lab/Users/rtruong/playtrain-wt-engine/native/aotfork && tail -30 logs/<job>.out'
# local emitter iteration (laptop): clone+patch+build qjsc, emit a game, syntax-check
FORK_OUT=$S/fork_out bash native/aotfork/build_fork.sh engine
cd $S/aot_test && cp examples/games/js/maze.js game.js && cp $S/fork_out/prelude.js . \
  && QJSC_HOST_MODE=1 $S/fork_out/qjsc -A -c -P $S/fork_out/aot_intr.txt -o game_aot.c prelude.js game.js \
  && clang -O1 -fsyntax-only -I $S/fork_out/src -D_GNU_SOURCE -DNDEBUG -funsigned-char -fwrapv -Wno-everything game_aot.c
# local exactness: same engine with/without -P (hosts build locally on macOS)
TAG=N bash build_fork.sh engine && TAG=N bash build_fork.sh f1 examples/games/js/maze.js
TAG=I INTR=1 bash build_fork.sh engine && TAG=I INTR=1 bash build_fork.sh f1 examples/games/js/maze.js
$FORK_OUT/host_f1N_maze examples/games/js/maze.js trace 1 3000 > a.txt; $FORK_OUT/host_f1I_maze examples/games/js/maze.js trace 1 3000 > b.txt; cmp a.txt b.txt
# rules that still bind: PLAN-engine-tier.md §2 (1–7) + PLAN-engine-tier-round6.md §2 (7–9)
# + §5 above (pipefail, atomic shared files, count checks after xargs -P).
```
