# HANDOFF 2026-09-04 — Engine tier, L1 (Futamura AOT via `qjsc -A`)

**Status: BANKED (all §4 thresholds passed), NOT ADOPTED.** Everything below lives on branch
`engine-tier` (local + `origin/engine-tier`; cluster worktree
`$BASE/playtrain-wt-engine`). The tuning worktree, the live tree, the adopted
`libqjs_vec.so` (md5 b3709b39…) and `qjs_host.adv` (46ea4999…) were never
written. Nothing here is quoted in the paper. Ryan's decision (PLAN §7 #1:
adopt the Bellard-lineage fork or stay on stock quickjs-ng) is open.

Read with: `handoff/PLAN-engine-tier.md` (the plan this executes) and
`handoff/tuning_notes.md` § "ROUND 5 — engine tier" (full tables, one entry
per job).

## 1. Result in one paragraph

Compiling each game's bytecode to C with the ivankra QuickJS fork's `qjsc -A`
(first Futamura projection: the interpreter specialized to the fixed bytecode;
values stay boxed, no type information used) and building it with the same
PGO + thin-LTO + hidden-visibility recipe the adopted binary uses gives
**1.30× over adv, geomean of all 24 paper games, every game ≥ 1.07×**, on the
plan's 1-worker iteration protocol (128 envs × 5 threads, QJS_DIRTY=1, same
node, interleaved arms). On the 5 profiled games it is 1.37× (vec) and 1.45×
(single-core). Roughly 1.13× of the 1.30× is the fork *interpreter* itself
(tail-call dispatch); AOT adds 1.14× on top. Bit-exact against the V8
reference on all 33 games × 3 seeds; vec observation checksums identical to
stock quickjs-ng on all 24 games × 2000 steps. **Banked (job 44439298, 16
workers × 128 envs × 5 threads, 24 games × 3 interleaved trials): futT2/adv
1.297 all-24, 1.335 ProcGen16, 1.223 ALE8; panel-C single-core ProcGen16
1.377.** Engine swap alone (forkT2): 1.136 / 1.202. Projected onto Fig 4A:
ProcGen 1.64× → ~2.2× tuned EnvPool; ALE ~15× → ~18×; panel C ×1.38. The
banked job ran on holy8a28510, not the 17402 anchor: ratios are same-job and
final, absolutes need a 17402 confirm.

## 2. What was built (all under `native/aotfork/`)

| file | what |
|---|---|
| `qjsc-hostmode.patch` | +37 lines to the fork's `qjsc.c`. `QJSC_HOST_MODE=1`: one shared compile context created like an embedding host (`JS_NewContext`, no std helpers) across all input files, AOT table emitted once, compiled objects kept alive. Needed because **atom indices are baked into the AOT bytecode**: the host must `JS_ReadObject` the blobs in the same order, right after `JS_NewContext`, with no atoms created in between, or the engine silently falls back to interpreting that function ("Bytecode mismatch" on stderr). |
| `qjs_host_fork.cpp` | `qjs_host.cpp` (tuning-tree copy, md5 f813ce92) compiled against the fork. `JS_IsArray(ctx, v)` signature; `-DHOST_AOT` reads the prelude + game blobs first, installs bindings, then `JS_EvalFunction`s them in the same order as the interpreted path. The p5 PRELUDE is compiled as its own AOT unit (never concatenated with the game — a game declaring its own `dist`/`lerp` would otherwise lose to hoisting order). |
| `qjs_vec_host_fork.cpp` | same treatment for `qjs_vec_host.cpp` (per-env runtime; AOT'd C functions and static bytecode arrays are shared read-only across worker threads). Build-time FNV-1a hash of the game source is checked in `env_init` so a per-game `.so` cannot silently run a different game. |
| `build_fork.sh` | clones the fork pinned at `cee72b9` (branch `aot`, "QuickJS-AOT 20251209"), applies the patch, builds engine/qjsc, F0 host (`host_f0`), F1 hosts per game (`host_f1_<g>`), vec `.so`s (`libqjs_vec.fork.so`, `libqjs_vec.fut_<g>.so`). Knobs: `TUNE=gen PROFDIR=…` / `TUNE=use PROFDATA=…` / `TAG=<suffix>` for PGO builds. Flags identical across arms: `-O3 -march=x86-64-v3 -ffp-contract=off -DNDEBUG -funsigned-char -fwrapv`. |
| `gate_fork.sh` | differential gate (V8+wasm reference via `reference_trace.mjs`, 3 seeds × 3000 steps) for any set of host binaries in one run; F1 stderr scanned for "Bytecode mismatch" (= FAIL even if the trace matches). |
| `bench_fork.sh` | interleaved single-core `qjs_host bench` A/B with medians, ratios, geomean. |
| `aot_obs_checksum.py` | vec obs/reward/done checksum across explicit `--lib-path`s (no `.so` swapping). |
| `vec_prof_driver.py` | PGO profile driver on the vec workload (128 envs × 5 threads). |
| `l1_fork.sbatch` | single-core arms f0/f1/ng/adv: build, gate 33 games, bench. |
| `l1_vec_ab.sbatch` | vec arms adv/ng/fork/fut: checksum24 + §4 A/B. |
| `l1_tune.sbatch`, `l1_tune24.sbatch` | PGO recipe (8-game profile, then all-24 profile), gate, checksum, A/B. |
| `l1_ab_t2.sbatch` | read-only A/B rerun after a preemption. |
| `l1_bank.sbatch` | §4 banked run on holy8a24307 + panel-C single-core ProcGen16. |

No file outside `native/aotfork/` and `handoff/` was changed on this branch.
The fork source is not vendored (cloned at build, pinned commit).

## 3. Jobs and what each showed (all genoa, `--exclusive`, same-job interleaved arms)

| job | what | headline |
|---|---|---|
| 44420887 | first single-core job | failed at link: GNU ld needs archives after the objects that reference them (macOS didn't care). Fixed. |
| 44421807 | single-core f0/f1/ng/adv, untuned fork | gate 33/33 for f0, f1, ng. **f1/f0 1.20** (5 games), 1.17 all-24; fork interpreter ≈ ng; f1/adv 1.18 all-24. |
| 44423769 | vec adv/ng/fork/fut, untuned | checksum24 clean; **fut/fork 1.20**, fut/adv 1.20 (5), 1.14 all-24. |
| 44425939 | PGO+LTO, 8-game profile | gate 114/114; futT/adv **1.36** (5) but only 1.19 all-24 — the 16 unprofiled games' AOT units were *de-optimized* by the PGO inliner (unprofiled call sites treated as cold). |
| 44430166 | PGO+LTO, all-24 profile | builds + gate 114/114 + checksum 24/24 done, then **preempted** by serial_requeue. Restart cancelled (it would have rebuilt the `.so`s under the banked job). |
| 44434726 | A/B of the all-24-profile arms (read-only) | **futT2/adv 1.37 (5), 1.30 all-24, min 1.07 (frostbite), max 1.68 (coinrun); forkT2/adv 1.18 / 1.13; single-core f1T2/adv 1.45 (5).** |
| 44434186 | banked run pinned to holy8a24307 | cancelled — node reserved (ReqNodeNotAvail). |
| 44439298 | **banked run**, any genoa (holy8a28510), 16×128×5, 24 games × 3 trials | **futT2/adv 1.297 all-24 / 1.335 PG16 / 1.223 ALE8; forkT2/adv 1.136; panel-C PG16 f1T2/adv 1.377, f0T2/adv 1.202.** 216/216 runs. |

Node for the measured A/Bs: holy8a24308 (untuned), holy8a2xxxx (tuned #1),
holy8a28511 (tuned #2). Ratios only; absolutes differ 1.56× across node classes.

## 4. Things learned that are not in the plan

1. **Dispatch removal is not ~0 on this workload.** Commit a252840's note
   ("only unboxing wins") was wrong for the fork; `-A` alone is 1.17–1.20×
   on the interpreter with the engine held constant.
2. **The fork interpreter beats stock ng** by ~7% on the 5 profiled games
   (tail-call dispatch), ~1.0 all-24 untuned, 1.13× over adv tuned.
3. **PGO and new games — read this one carefully, it was misstated earlier.**
   Two facts, then what they imply:
   - An AOT unit compiled *with* `-fprofile-use` but *without* its own
     functions in the profile is DE-optimized (the PGO inliner treats the
     game's unprofiled call sites as cold). Job 44425939: the 16 games outside
     the 8-game profile fell 2–8% below the *untuned* AOT build.
   - ThinLTO rejects a link whose objects carry *different* profile summaries
     ("ProfileSummary IDs have conflicting values"). It does NOT reject an
     object with *no* profile linked against PGO'd objects. Verified locally
     (bigfish: unprofiled AOT unit + PGO'd engine objects + thin-LTO links,
     is bit-exact vs V8, and runs +3% over the untuned AOT build, 6% below
     the fully profiled one).
   So the constraint is not "profile every game or lose". It is "never pass
   `-fprofile-use` to a unit that has no profile". And because every game is
   its own `.so` (its own link), adding a new game's profile to the merged
   file relinks that one game plus five tiny aux objects, not everything.
4. **`qjs_host.adv` / `libqjs_vec.adv.so` predate the style-cache determinism
   fix.** The adopted artifacts were built by job 43780730 from `5a42f71`
   (2026-09-01 07:56); the fix `ef74835` ("fix native style cache: null
   mirrors on invalidate, drop afterFill") landed 11:51 the same day and is
   NOT an ancestor of that SHA, although `adopt_build.sbatch`'s comment says
   the re-cut included it (the variant files still carry the 09-01 22:30
   mtime of the earlier job). Symptom: exactly one frame in 3000 differs on
   qbert (step 237, the GAMEOVER terminal frame, obshash only; reward, score,
   lives, state identical) on all 3 seeds; ng/f0/f1 built from main tip match
   the reference. Throughput is unaffected; the "bit-exact" claim for adv has
   this one-frame blemish until adv is re-cut from a tree containing ef74835.
5. The live `examples/games/js` on the cluster has 115 files (analogen,
   `a-cq-*`); the paper's 33 are the worktree's. Gates must use the latter.
6. `serial_requeue` preempts; a job whose build phase writes artifacts another
   job reads is a hazard. Build and measure in separate jobs, or pin.

## 4b. What a brand-new generated game gets (no authoring change, no per-game human work)

| tier | build | cost at load | measured/expected vs adv |
|---|---|---|---|
| 1. interpreter fallback | fork interpreter, PGO'd (`libqjs_vec.forkT2.so`, one shared `.so`) | none | **1.13×** all-24 (measured, job 44434726) |
| 2. AOT, unprofiled unit | `qjsc -A` + clang -O3 thin-LTO on the game unit, linked against the PGO'd engine objects; no `-fprofile-use` on the game unit | ~40 s clang | ~1.17–1.20× (expected: between untuned AOT 1.14 and profiled 1.30; one local datapoint, needs a banked arm) |
| 3. AOT, profiled | tier 2 + instrumented build + 30 s random-play run + rebuild with the game's profile merged in | ~2 min | **1.30×** all-24 (measured, job 44434726) |

All three are scriptable in a compile-at-load pipeline keyed by game md5.
Tier 1 is the safe default; tier 2 is what a fresh game gets the first time it
is trained; tier 3 is the headline number and is reached after an automatic
two-minute step. The paper should say exactly that if this is adopted, and
tier 2 should be added as a measured arm before the sentence is written.
Frictions that remain: the training host needs clang + the pinned fork source
+ the profdata at load time (fine on the cluster, heavy for a released wheel);
every edit to a game in the refine loop invalidates its cache (irrelevant for
browser playtesting, which never touches the `.so`).

## 5. What is NOT done

- **17402 confirm** for absolutes (Fig 4A y-axis), if adopted. Ratios are
  done. Do not race the pinned chain there.
- **Re-cut adv from a tree containing ef74835** so the bit-exact baseline is
  clean (see §4 item 4); same-node null A/B vs the current adv.
- **Production packaging.** Today: one `.so` per game (~1.5 MB, ~40 s compile,
  `libqjs_vec.futT2_<game>.so`), selected by `--lib-path`. For the trainers:
  compile-at-load cached by game md5 with the three tiers of §4b (tier 1
  fallback while tiers 2/3 build in the background), or one `.so` carrying all
  games' AOT tables (needs the fork's global `aot_id` space partitioned).
- **Tier-2 arm** (AOT unit without `-fprofile-use`) measured at the banked
  protocol, so the "fresh game" sentence has a 24-game number.
- **Engine maintenance cost.** Adopting means leaving stock quickjs-ng 0.15.1
  for a Bellard-lineage fork (2025-09-13) + tail-call dispatch + `-A` + our
  37-line qjsc patch. The `-A` output `#include`s the whole preprocessed engine
  per game; any engine change recompiles every game and re-collects PGO.
- L2 (superinstructions) and L6 (tail-call dispatch) are moot if the fork is
  adopted (L6 comes with it; L2 is a subset of what `-A` does). L4
  (quickening: tag checks/boxing) is the only remaining lever `-A` does not
  cover, and only composes inside the fork.
- **Template rules** (PLAN "out of scope"): still the highest ratio-per-day
  item and still unwritten.

## 5b. Next round

**Round 6 status (2026-09-04 evening):** E0 (profile futT2) is done — job
44449147, tables in `tuning_notes.md` § "ROUND 6"; E1 as specified is
killed before build (its bucket is ~2%); E3 (p5 + Math.* intrinsics) built and
probed at **1.20× geo-5 over the same-engine control, untuned** (job 44468624,
gate 198/198, checksum24 clean); tuned build + bank next, then E2. See
`PLAN-engine-tier-round6.md` §0b and `tuning_notes.md` § E3.

`handoff/PLAN-engine-tier-round6.md` — re-profile futT2, then the levers `-A`
leaves on the table (type-feedback specialization in the AOT emitter,
operand-stack-to-locals, p5 intrinsics, refcount elision, NaN-boxing), plus
packaging (compile-at-load tiers) and the adv re-cut.

## 6. Reproduce

```bash
# cluster, engine worktree
cd /n/holylabs/gershman_lab/Users/rtruong/playtrain-wt-engine/native/aotfork
sbatch l1_fork.sbatch      # single-core arms + gate            (~25 min)
sbatch l1_vec_ab.sbatch    # vec arms, untuned                  (~10 min)
sbatch l1_tune24.sbatch    # PGO all-24 → tuned arms, gate, checksum, A/B (~1.5 h)
sbatch l1_bank_any.sbatch  # §4 banked run, any genoa node (~20 min); l1_bank.sbatch = pinned to holy8a24307
# artifacts: out/{host_f0*,host_f1*_<g>,libqjs_vec.{fork,fut_<g>,forkT2,futT2_<g>}.so,
#            fork24.profdata,gate_*.txt,bench_*.txt,vec_ab_*/,abT2_*/,bank_*/}
```
