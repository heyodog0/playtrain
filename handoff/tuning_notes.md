# Native-layer tuning — running notes (working file, 2026-08-31)

Executes handoff/PLAN-native-tuning.md. Branch `native-tuning`, cluster
worktree `/n/holylabs/gershman_lab/Users/rtruong/playtrain-wt-tuning`.
Live tree and live `.so` (md5 8b539667dcead5513afe365b766f9e92) untouched;
pinned 17402 chain (43241140 / 43244696 / 43246914) still PENDING and unraced.

## Facts established during setup

- **The live `.so` predates the continuous-input merge.** Branch-tip
  `_load_lib` bound `vec_set_actions`/`vec_set_action_analog`/
  `vec_set_input_map`/`vec_step_q` unconditionally and could not load the
  Aug-9 live binary. Fixed on-branch (`3c1f49c`): those four bindings are now
  optional; the default8 path never calls them. Every A/B arm therefore runs
  the SAME worktree python, only the `.so` differs.
- **Main's native source != live `.so` source** (continuous-input host
  changes landed after Aug 9). A `base` arm (main 54eb35c build) rides along
  in every A/B as the null check, ladder-forensics style.
- **`native/qjs/src` is untracked**: a fresh worktree build would clone
  CURRENT quickjs-ng (a silent Lever-4). The worktree got the live tree's
  vendored 0.15.1 via `cp -a`. Same for the prebuilt engine/frozenmath
  staticlibs and the live rasterizer `.a` (so base/l1 differ from live by
  exactly the intended files).
- **Repo precedent against Lever 3**: build_qjs.sh:43 records "PGO measured
  -11.5% — don't" (2026-07-20, engine-only, qjs_host CLI workload). This run
  re-tests PGO on the whole .so with the vec workload; if it loses again,
  that is the answer and the lever is dropped.
- Games dir for all measurement arms is pinned to the LIVE tree's
  `examples/games/js` (its uncommitted maze/freeway edits are what the
  profile job 43260288 and the published numbers ran).
- Gate reference deps (reference_trace.mjs, runtime/p5/*, rasterizer.wasm)
  are all git-tracked — the gate runs in the worktree as-is. Node:
  `~/.local-node/bin/node`.

## Builds (2026-08-31, login node, clang 21.1.8, cargo from ~/.cargo)

| variant | contents | .so md5 |
|---------|----------|---------|
| live | byte-copy of live binary (Aug 9) | 8b539667dcead5513afe365b766f9e92 |
| base | main 54eb35c, live engine libs + live rasterizer .a | b4d522eb570c41eea999b2c8d17e3899 |
| l1 | base + simd obs blit (1625bb4) | ae0bb7de5ee6a59b339e54c507ee68f3 |
| l2 | base + rasterizer target-cpu=x86-64-v3 (c6d785a) | d5826004bb805f0c00e769f35bb1cc07 |
| l12 | both levers (branch tip) | 8eddf34b22767bac075e8aa47c9ee266 |

Lever-1 kernel unit test (scalar vs AVX2, random buffers, n=1..65536,
aligned+misaligned, guard bytes): ALL PASS on the login node.

## Gate / determinism status

- Obs-checksum A/B (criterion 2): **PASS 2026-08-31** — 5 games x 300 steps
  x 32 envs, obs+reward+done bytes hashed, all of base/l1/l2/l12 identical
  to live, on an AVX2 host (SIMD path exercised). Driver: /tmp/obs_checksum.py
  (session scratch; recreate from this file's history if needed).
- gate_qjs.sh --all 3000 for base/l1/l2/l12: job **43268226** (tune_gate).
- fp flags: unchanged everywhere; lever 2 is integer-only Rust; PGO script
  carries -ffp-contract=off -fno-fast-math on compile AND link lines.

## A/B #1 VERDICT (job 43268228, holy8a24306 genoa, 2026-08-31)

live/base/l1/l2/l12 x 5 games x 2 interleaved reps, bench_vec_rollout
--no-model, 128 envs x 5 threads x 1 worker, live games dir. decisions/s
means and ratio vs live (JSONs: outputs/tune_ab_43268228/):

    game        live      base/live  l1/live  l2/live  l12/live
    bigfish   183,857       1.002     1.204    1.061     1.309
    breakout   88,254       0.995     1.089    1.022     1.123
    maze       33,592       0.992     1.024    1.066     1.115
    miner      17,956       1.000     1.012    1.052     1.069
    plunder   226,818       1.005     1.280    1.031     1.350
    geomean               **0.999** **1.117** **1.046** **1.188**

- base/live 0.999: the null check is clean — main's post-Aug-9 native drift
  (continuous-input) costs nothing; attribution to the levers is safe.
- l1 lands ABOVE its predicted +6-10% (blit share was underestimated at the
  tail: plunder 1.28). l2 mid-window. Stack ~multiplicative (1.117 x 1.046 =
  1.168 vs measured 1.188).
- Already past the 1.10x stopping-rule floor before PGO.

## Lever 3 (PGO+thin-LTO): built, measuring

- Tooling: clang 21.1.8 + llvm-profdata + ld.lld on login; NO llvm-bolt.
- Profiles: job **43269256** (genoa), both instrumented states x 8 games x
  30 s, 128 envs x 5 threads; 8 profraw per state, merged to
  wt/pgo/{base,tip}.profdata. Instrumented slowdown ~15-20x (expected).
- Use-phase builds (login, thin-LTO linked fine, LTO_USED=1):
  pgo    (base+PGO)  73f05541d04abf69cee485d713d36142
  l12pgo (tip+PGO)   e27158c616a41b4972451dfb820a8a9c
  Script: native/build_qjs_vec_pgo.sh (fp flags kept on compile AND link).
- A/B #2: job **43273826** — live/l12/pgo/l12pgo, same protocol, plus an
  on-node obs-checksum of pgo,l12pgo vs live at job start
  (benchmarks/tune_obs_checksum.py).

## Gate status (correction)

- Job 43268226 (tune_gate) reported FAIL for base/l1/l2 — VOID, do not read:
  the qjs-side trace files came out empty in-job (cause not chased; the
  pipe-to-tail wrapper also lost the per-game detail), and the l12 leg was
  racing this session's manual qjs_host copies + the PGO rebuild of
  build/qjs_host (same shared path — self-inflicted).
- Clean login-node probe: base @ breakout, 3000 steps vs node reference —
  BIT_EXACT.
- Definitive run: serial gate_qjs.sh --all 3000 for all six variants,
  login node, one at a time (nothing else touching build/qjs_host), logs
  at wt/gates/gate_<variant>.log, status wt/gates/STATUS. In progress.
- LESSON for future sessions: build/qjs_host is a shared mutable path —
  never gate two things concurrently, and never pipe the gate to tail.

## A/B #2 VERDICT (job 43273826, holy8a24306 — same node as A/B #1)

live/l12/pgo/l12pgo, same protocol. On-node obs-checksum of pgo+l12pgo vs
live at job start: **PASS** (genoa, AVX2 path live). JSONs:
outputs/tune_ab_43273826/.

    game        live     l12/live   pgo/live  l12pgo/live
    bigfish   182,625      1.321      1.024      1.350
    breakout   88,411      1.122      0.975      1.124
    maze       33,214      1.126      1.158      1.299
    miner      17,979      1.083      1.087      1.158
    plunder   225,714      1.364      1.031      1.416
    geomean               1.198      1.053      **1.264**

- l12 reproduces across jobs (1.188 -> 1.198): the iteration protocol is
  stable at the ~1% level.
- PGO alone +5.3% geomean — it pays where interp dominates (maze +15.8%,
  miner +8.7%) and loses slightly on breakout (-2.5%). This DOES NOT
  contradict build_qjs.sh's old "PGO measured -11.5%": that was engine-only
  PGO on the qjs_host CLI; this is whole-.so PGO+thin-LTO profiled on the
  vec workload.
- Stacking is multiplicative again (1.198 x 1.053 = 1.261 vs 1.264).
- **WINNER: l12pgo** (pending the serial gates).

## Banked runs (submitted 2026-08-31 evening)

- Full run: job **43276792** (tune_full.sbatch) — live vs l12pgo, published
  topology 16 workers x 128 envs x 5 threads, 16 ProcGen + 8 ALE, 3
  interleaved trials/game, one genoa node. Output outputs/tune_full_43276792/.
- Re-profile: job **43276822** (tune_prof.sbatch) — SIGPROF sampler on
  l12pgo (via lib_path, no .so swap), 5 profiled games x 60 s. Output
  outputs/prof_<game>_l12pgo_43276822.txt.

## FULL-RUN VERDICT (job 43276792, holy8a24306, EPYC 9654, 2026-08-31)

Published topology (16 workers x 128 envs x 5 threads), live vs l12pgo,
3 interleaved trials/game, 0 failed runs. JSONs: outputs/tune_full_43276792/.

    ProcGen16: live 945,137   l12pgo 1,146,878   ratio 1.213
    ALE8:      live 2,067,610 l12pgo 2,683,511   ratio 1.298
    all24:     live 1,226,929 l12pgo 1,522,577   ratio 1.241

Every game >= 1.031 (dodgeball); largest pong 1.807, ninja 1.468, freeway
1.448. NOTE the live absolute (945k ProcGen16) is NOT the published 1.78M —
different node class (serial_requeue 9654 vs pinned 17402 9454); ratios are
the deliverable here, and the 17402 confirm happens after the pinned chain
drains (plan section 8). Projected 17402: 1.78M x 1.213 ~= 2.16M ~= 1.31x
tuned EnvPool. Short of the 2x stretch, inside the plan's realistic band.

## Re-profile of l12pgo (job 43276822, SIGPROF, 5 games x 60 s)

The blit lever did exactly what the profile predicted: obs_blit share
plunder 25.2% -> 4.7%, bigfish 19.8% -> 3.4%, breakout 10.2% -> 1.5%.
interp is now even more dominant (breakout 68%, maze 61%, plunder 52%) —
the next levers, if ever needed, are the NG bump / p5 command buffer, both
deferred. Tables: outputs/prof_<game>_l12pgo_43276822.txt.

## Serial gate VERDICT (login node, gate_qjs.sh --all 3000, logs wt/gates/)

Every variant (base l1 l2 l12 pgo l12pgo) shows the IDENTICAL failure set:
aim_trainer (all 3 seeds, diverges from the reset frame) and qbert (all 3
seeds, ONLY line 239 differs — the terminal GAMEOVER frame's obshash after
237 bit-exact steps). base fails the same way, so both are PRE-EXISTING
main-tree reference-vs-qjs divergences, not lever regressions; the levers
reproduce base bit-for-bit everywhere, which is itself the strongest
faithfulness evidence. All other 3000-step games x 3 seeds: bit-exact.
FLAG FOR THE AUTHOR: qbert's terminal-frame divergence and aim_trainer's
wholesale divergence exist on main today and touch the paper's determinism
claim; they predate this branch (aim_trainer is a continuous-input pointer
game; qbert's is a terminal-obs rendering difference).

## Lever 4 / BOLT

- Lever 4 audit DONE: vendored qjs/src is a pristine 0.15.1 clone on both
  machines (local 8ef0e71, cluster 0c545ce; zero source mods; frozenmath is
  compile-time-external). The bump itself NOT executed: levers 1-3 banked
  1.24x, the remaining headroom sits in interp, but an engine bump is a
  paper-invalidating risk the plan reserves for after 1-3 are adopted.
- llvm-bolt: absent on FASRC — BOLT dropped (plan already treated it as
  garnish).

## PROVENANCE CORRECTION (found 2026-08-31 during round 2)

The round-1 variants were NOT built from main's vec-host source. The
worktree setup step `cp -a $LIVE/native/qjs native/` copied the live tree's
qjs_vec_host.cpp and qjs_host.cpp (a92213a-era, pre-continuous-input) over
the checkout, and every round-1 build compiled those. Consequences:

- Round-1 numbers are "LIVE HOST + levers" — the cleanest attribution
  against the live binary (it is exactly why base/live = 0.999 and why
  base.so lacked vec_set_actions), but the branch as committed (main-lineage
  host) was never benchmarked in round 1.
- The live-era host sources are preserved at wt/live_host_backup/ with
  md5s in the phase-1b log; the earlier "base = main 54eb35c build" wording
  in this file is wrong in exactly this one respect.
- Round 2 fixes this: all round-2 variants build from committed branch-tip
  sources, and a lineage arm `mh` (= the l12pgo recipe rebuilt from tip
  sources) is measured against l12pgo to quantify the host-lineage delta.
  If mh/l12pgo ~= 1.00, adoption can ship the branch as committed.

## ROUND 2 (2026-08-31, in progress)

Levers, all built by native/build_qjs_vec_tune.sh (0e503c3), each gated by
obs-checksum + serial gate like round 1:

- r  : rust rasterizer PGO (+ cross-language thin-LTO through rust-lld if
       it links — rustc 1.97 is LLVM 22 vs clang 21, so xLTO REQUIRES the
       LLVM-22 linker; rust profraws merged with rust's own llvm-profdata,
       never the system one)
- v  : -fvisibility=hidden + vec_exports.map version script (vec_* stays
       global via pragma in qjs_vec_host.cpp; rs_*/JS_*/fm_* go DSO-local,
       killing PLT hops on the p5->rasterizer boundary)
- c  : context-sensitive PGO (cs profile collected on a tip csgen build,
       merged INTO tip.profdata)
- rvc: all three
- mh : lineage arm (see above)

Diagnostics, not levers: THP is [always] on the login node (job banners
record the compute nodes — if [always] there too, the hugepage idea is
moot); tune2_diag job = env-thread sweep {1,2,5,8,16} + SIGPROF at T=1 vs
T=5 on miner/plunder to bound the scheduler-spin ceiling before any host
surgery is considered.

Rust/C++ PGO runtime clash note: never instrument both sides in one .so
(duplicate __llvm_profile_* runtimes). The rustgen build has C++ at
profile-USE; the csgen build has rust prebuilt. Second rust trap: rustc
does NOT bundle its profiler runtime into a staticlib — the instrumented
.so had undefined __llvm_profile_instrument_memop until the toolchain's own
libprofiler_builtins rlib was added to the link (19c4355). Never substitute
clang's compiler-rt profile runtime: LLVM 21 profraw vs rust's LLVM-22
llvm-profdata.

xLTO VERDICT (job 43294752): cross-language thin-LTO links FAIL with
"linking module flags 'ProfileSummary': IDs have conflicting values" — the
rust modules carry rust.profdata's summary, the C++ modules tip.profdata's,
and function import refuses to merge them. Not a bitcode-version failure.
Fix would be unifying the two profile summaries; dropped instead — the
visibility lever already de-PLTs the p5->rasterizer boundary, and r keeps
rust PGO. The fallback ladder shipped r without xLTO (XLTO_OK=0).

NEW FASRC TRAP (cost one profiling round): running `python /tmp/driver.py`
puts /tmp at sys.path[0], and a stray stdlib-shadowing file there from ANY
user breaks imports — another user's /tmp/inspect.py on the login node
crashed numpy inside `import inspect` with their PermissionError. Driver
scripts now live in the worktree (wt/pgo/_*.py), never shared /tmp.

## A/B #4 VERDICT (job 43294755, holy8a24306, 2026-08-31 evening)

live/l12pgo/mh/r/v/c/rvc x 5 games x 2 interleaved reps; on-node checksums
for mh,r,v,c,rvc vs live: PASS. Ratios vs live (JSONs
outputs/tune_ab_43294755/): l12pgo 1.265 (reproduces round 1), mh 1.211,
r 1.267, v 1.234, c 1.202, rvc 1.290. Attribution vs mh (same lineage):
rust-PGO +4.6%, visibility +1.9%, CSPGO -0.7% (DEAD — dropped), stack
rvc +6.5% (~= r x v; c contributes nothing in-stack either).

- mh/l12pgo = 0.957: the main-host lineage LOOKS 4.3% slower — but this is
  CONFOUNDED: mh's profile (tip.profdata) was collected on the live-host
  binary, and the hottest p5 bindings (js_fill 145M, js_rect 160M,
  js_ellipse 24M counts) were DISCARDED on hash mismatch at build time.
  mh may be PGO-starved, not intrinsically slower.
- t3 chain (jobs 43300919 tipgen -> 43300922 build -> 43300923 ab5 +
  43300924 gates3): collects a self-consistent tip-host profile
  (tipnative.profdata), rebuilds mh2 (deconfounded lineage arm) and rv2
  (tip + native PGO + rust-PGO + visibility, CSPGO dropped) — rv2 is the
  round-2 adoption candidate.

## A/B #5 VERDICT (job 43300923, holy8a24307 — a FASTER genoa node; ratios
comparable, absolutes ~2x earlier jobs — node-variance hazard on display)

live/l12pgo/mh/mh2/rvc/rv2, checksums PASS. Ratios vs live: l12pgo 1.260
(third reproduction of ~1.26), mh 1.207, **mh2 1.253**, rvc 1.290,
**rv2 1.347** (bigfish 1.506, breakout 1.167, maze 1.348, miner 1.270,
plunder 1.471). JSONs outputs/tune_ab_43300923/.

- The mh confound is CONFIRMED: with the self-consistent tipnative profile,
  the lineage cost shrinks from -4.3% to ~-0.6% (noise). The branch as
  committed is adoption-safe.
- **ROUND-2 WINNER: rv2** = tip sources + tipnative PGO + thin-LTO +
  rust-PGO rasterizer .a + hidden visibility. +7.5% over mh2; +6.9% over
  the round-1 winner. Banked full run (live vs rv2, 24 games, published
  topology): job 43319337; SIGPROF re-profile: job 43319345; gates3
  (mh2, rv2): job 43300924.
- Sequencing near-miss for the record: t3_build was serialized only behind
  tipgen and could in principle have raced t2_ng's engine-src swap; timing
  saved it (ng's restore trap fired before t3_build's compiles — verified
  via QJS_VERSION in qjs/src and job phase logs). Any future job that
  compiles the engine must depend on any job that swaps qjs/src.

## Lever 4 VERDICT (job 43294772, holy8a24306): SAFE BUT WORTHLESS — dropped

- QuickJS-NG v0.16.2 (latest release tag), tip sources, no PGO, vs tipplain
  (identical recipe on vendored 0.15.1). Vendored engine restored by trap;
  variants kept: tipplain, ng (+qjs_hosts).
- Determinism: **CHECKSUM24 PASS** — all 24 games x 2000 steps x 32 envs
  bit-identical to the LIVE binary. Gate: only the pre-existing qbert
  terminal-frame divergence (same as every other variant). An NG bump does
  NOT threaten the determinism claim.
- Performance: **ng/tipplain = 0.998 geomean** (5 games, 2 interleaved
  reps). 0.15.1 -> 0.16.2 buys nothing on this workload. Lever DROPPED per
  the stopping rules; keep the safety datum for the future.
- Side datum: tipplain (tip lineage, NO PGO) = 1.211 vs live — equal to mh
  (tip lineage WITH the stale live-host profile). The stale profile added
  ~nothing on this lineage, reinforcing the mh confound analysis; mh2/rv2
  (self-consistent tipnative.profdata) are the deciding arms.

## Round-2 gates VERDICT (job 43294757, holy8a24303)

mh/r/v/c/rvc, gate_qjs.sh --all 3000 (logs wt/gates2/): every variant fails
ONLY qbert x3 seeds — the known pre-existing terminal-frame divergence.
**aim_trainer PASSES on the tip host**: its round-1 divergence was a
live-era-host limitation that main's continuous-input work fixed. On the
adoptable lineage the determinism claim has exactly one hole (qbert
GAMEOVER frame). Compute-node gating worked cleanly this time (preflight
ok); the 43268226 empty-trace failure never recurred.

## Diagnostics VERDICT (job 43294758, holy8a24306)

- THP: [always] on genoa compute nodes (and login). The hugepage lever was
  already active everywhere — MOOT, dead by diagnosis, zero effort spent.
- Scheduler spin: per-thread efficiency on l12pgo at 128 envs — miner
  T5 98%, T16 97%; plunder T5 92%, T16 79%. worker_loop is invisible in the
  T=1 profile and 5.1-7.5% at T=5, so the spin share is real contention but
  costs only ~2-8% end-to-end at the production topology (5 threads/worker).
  Work-stealing host surgery is NOT worth it at T=5; revisit only if the
  topology ever moves to many threads per worker (plunder loses 21%/thr at
  T=16).

## ROUND-2 FINAL (2026-08-31 night)

- Full run (job 43319337, holy8a24307, live vs rv2, 24 games x 3 interleaved
  trials, 16 workers x 128 envs x 5 threads, 0 failures):
  **ProcGen16 1.291x, ALE8 1.368x, all-24 1.317x** over the live binary.
  min dodgeball 1.101, max pong 1.927. JSONs outputs/tune_full_43319337/.
  Projected 17402 anchor: 1.78M x 1.291 ~= 2.30M ~= 1.39x tuned EnvPool —
  the bottom of the plan's "realistic ceiling" band (2.3-2.6M), reached.
- Re-profile of rv2 (job 43319345): interp 55-70% everywhere; blit residual
  <=4%; bigfish raster still ~34% (fill_subpaths 22.9, ellipse_path 11.1) —
  the only remaining structural headroom is rasterizer algorithmic work
  (ellipse/path caching) and the deferred p5 command buffer.
- Gates3 (job 43300924): mh2, rv2 fail ONLY qbert x3 — identical to the
  no-lever tip baseline. rv2 is exactly as deterministic as main.
- Round-2 levers: rust-PGO +4.6%, visibility +1.9%, self-consistent PGO
  (vs stale profile) ~+4%; DEAD: CSPGO (-0.7%), xLTO (ProfileSummary link
  conflict), NG bump (safe but 0.998x), THP (already [always]), scheduler
  surgery (bounded at ~2-8% @ T=5, not worth the risk).
- The worktree default .so is left at rv2 (tune_full's last swap).

## RECOMMENDATION (supersedes the round-1 recommendation below)

Ship **rv2** = branch tip (simd blit + rasterizer target-cpu, main-lineage
host) + self-consistent whole-.so PGO + thin-LTO + rust-PGO rasterizer +
hidden visibility: **+29% ProcGen16 / +32% all-24** over the live binary,
deterministic exactly where main is (qbert terminal frame is main's
pre-existing hole; aim_trainer is FIXED on this lineage vs live). Every
lever individually measured, gated, and reproducible from committed
scripts (native/build_qjs_vec_tune.sh + wt/pgo/*.profdata). Rebuild recipe:
tipnative.profdata (CPP_MODE=use) + RA.rustpgo + VIS=1.

The two decisions remain the user's (unchanged): (a) adoption — invalidates
every published number, ~1-day re-measurement + 17402 confirm after the
pinned chain drains; (b) build policy — the portable no-PGO build is now
tipplain (+21%); the tuned benchmark build is rv2 (+29% ProcGen16). PGO
artifacts (tipnative.profdata, rust.profdata) are required to reproduce rv2
and live in wt/pgo/.

## round-1 recommendation (superseded)

Ship l12pgo (simd blit + rasterizer target-cpu + whole-.so PGO+thin-LTO):
+21% ProcGen16 / +24% all-24 geomean over the live binary, bit-exact
everywhere the live binary is bit-exact, all three levers individually
gated and measured, stack multiplicative. Stopping rules say stop here:
gains are banked, the two remaining levers are deferred-by-plan (command
buffer) or paper-risk (NG bump).

Decisions that are NOT this branch's to make (plan section 7.5):
a. ADOPTION: a faster binary invalidates every published PlayTrain number
   (Fig 4A, Table 1, per-core panels, Table 8) and triggers the ~1-day
   re-measurement cascade + the 17402 confirm after the pinned chain.
b. BUILD POLICY: portable x86-64-v3 "shipped" build vs tuned benchmark
   build. Note PGO makes the shipped/benchmark distinction REAL: the
   .profdata lives in wt/pgo/ and the build is only reproducible with it;
   a portable no-PGO build is l12 (+19-20% on the 5-game set).

## ROUND 3 — authorized (Ryan, 2026-08-31, laptop session)

The round-2 STOP above is lifted for exactly three levers. Same A/B
discipline, same gates, same stopping rules (drop any lever measuring
under ~+3%; every arm passes gate_qjs.sh --all AND the obs-checksum
bit-exact check vs rv2). Realistic stacked target over live: ~1.45-1.55x.
rv2 is the new base arm; keep a live-.so arm riding along as the null
check, ladder-forensics style, as before.

Levers, in priority order:

1. **BOLT, instrumentation mode.** The round-2 drop was availability, not
   a verdict: FASRC has no llvm-bolt and no perf. Instrumentation mode
   needs neither — build the .so instrumented, run the vec workload to
   collect the fdata, then llvm-bolt-optimize the layout. `emit-relocs`
   is already committed (d48c3c1). The discovery step is sourcing
   llvm-bolt itself in user space (built from the same LLVM release as
   clang 21.1.8 on login, or a matching prebuilt). If llvm-bolt cannot be
   sourced cleanly, record that and drop — do not sink a day into
   toolchain archaeology. Expected: +5-15% on interp-heavy games.
2. **p5 command buffer** (deferred-by-plan since round 1). Batch the
   per-frame p5 calls into a buffer flushed once per frame instead of one
   QuickJS->C++ binding crossing per call. Attacks the 2-13% bind share.
   Behavior-changing code, so the differential gate is the arbiter;
   fillText/no-op commands must stay no-ops in the buffer replay.
3. **Rasterizer span vectorization.** Solid-color scanline span fills are
   scalar Rust; SIMD the fill loop only — coverage/winding decisions stay
   scalar so bit-exactness holds by construction. Attacks the 8-34%
   rasterizer share.

Standing constraints (restated so this section is self-sufficient):

- Do NOT race the pinned 17402 chain: 43246914 (EP sync16 on 17402) is
  still queued and is the gate for the paper pass. Nothing in round 3
  submits to 17402 until it drains.
- Never touch the live tree or the live .so
  (md5 8b539667dcead5513afe365b766f9e92). All work in the worktree
  `/n/holylabs/gershman_lab/Users/rtruong/playtrain-wt-tuning`.
- qbert (terminal frame) and aim_trainer (reset frame, FIXED on this
  lineage) divergences are pre-existing on main — do not chase them as
  round-3 regressions; the gate baseline is rv2's gate output.
- Round-3 numbers fold into the SAME pending adoption decision as rv2.
  Quote nothing anywhere (paper, handoffs presented as results) until
  Ryan decides adoption + build policy. A faster rv3 raises the stakes of
  that decision; it does not pre-make it.
- Dead levers stay dead: CSPGO, xLTO, NG bump, THP, scheduler surgery,
  GC/jemalloc, topology, NUMA binding. Do not re-run them.

## ROUND 3 — progress (2026-08-31 night session)

Lever 1 (BOLT) — BUILT, measuring. A prior session had already executed the
whole pipeline (job 43342607 t4_bolt, playtrain-trainers/benchmarks/
t4_bolt.sbatch): llvm-bolt 21.1.8 sourced as the official LLVM release
binaries run inside `singularity exec ubuntu2404.sif` (EL8's glibc 2.28 is
too old to run them natively — GLIBC_2.29 — and conda-forge llvm-tools has
no bolt; the container only touches ELF files on disk, so it can't affect
results). Artifacts in wt variants/: libqjs_vec.rv2r.so (rv2 rebuilt with
--emit-relocs), libqjs_vec.boltinst.so, libqjs_vec.rv2bolt.so
(ext-tsp + cdsort + split-functions, from pgo/bolt.fdata = 8 games x 30 s
instrumented), qjs_host.rv2bolt for the gate. Smoke (load + 200 steps):
PASS. NOTE ~/bolt/ in $HOME was a duplicate download of tools/llvm21 made
before finding it — deleted.

Lever 3 (span vectorization) — DEAD BY DIAGNOSIS, zero cluster time. The
plan's premise is stale: objdump of the shipped rasterizer .a shows the
solid-color span loop is ALREADY auto-vectorized by LLVM at
target-cpu=x86-64-v3 (vpbroadcastd + 4x-unrolled 32-byte vmovdqu stores) —
the u32-packed store rewrite that landed with lever 1/round 1 made it
vectorizable and the compiler did the rest. The only scalar span path left
is the alpha-blend branch, and grep over examples/games/js finds exactly ONE
4-arg color call in the whole catalog (frostbite.jungle.js, not in the
measured 24): the blend path is unreachable in every benchmark game. No code
change exists to A/B; recorded per the THP precedent.

Lever 2 (p5 command buffer) — IMPLEMENTED, chain running. Committed on
branch (b11dec3 + 819c03c): native/qjs/p5_cmdbuf.hpp + hooks in both hosts,
runtime-toggled by PLAYTRAIN_QJS_CMDBUF=1 (one binary serves both arms).
Draw calls append (opcode,args) doubles into a per-env Float64Array (buffer
allocated JS-side for 0.15.1/head JS_NewArrayBuffer ABI portability; write
index lives in buf[0] so the C++ flush needs no JS call); host flushes after
every JS entry point (draw, handlers, resetGame, getGameState) so ordering
vs frameBegin/frameEnd/render_obs is preserved; replay skips exactly the
NODRAW-marked ops under render-skip; color variants mirror colorFromArgs
including the verbatim-array case; text/* stay no-ops and never enter the
buffer; createCanvas/createGraphics flush-then-delegate. Local verification
(arm64): trace parity cmdbuf on vs off, 33 games x seeds x 400-600 steps —
ALL IDENTICAL; dirtycheck with cmdbuf on: bit-exact except qbert's known
pre-existing frame-118 divergence (identical without cmdbuf).

First chain (t5: 43398251 cbgen -> 43398260 build -> 43398275 ab + 43398278
gates, scripts committed at native/round3/, submitted from playtrain-trainers
root): checksums ALL PASS (every arm bit-exact vs live, 5 games x 300 steps
x 32 envs); gates for rv2r/rv2bolt/cb all IDENTICAL to rv2's baseline (qbert
x3 only, logs wt/gates_r3/).

## A/B #6 VERDICT (job 43398275, holy8a28512)

    game        live      rv2     rv2r  rv2bolt       cb      cb0
    bigfish   341,122   1.495    1.519    1.504    0.791    1.485
    breakout  163,940   1.172    1.166    1.151    0.372    1.110
    maze       62,865   1.350    1.357    1.355    0.178    1.235
    miner      33,457   1.271    1.269    1.265    0.269    1.166
    plunder   425,037   1.458    1.465    1.460    0.482    1.379
    geomean             1.344    1.349    1.341    0.368    1.268
    vs rv2:          rv2r 1.004  rv2bolt 0.997  cb 0.274  cb0 0.943

- rv2 reproduces a 4th time (~1.34); rv2r (emit-relocs) is a clean null.
- **Lever 1 (BOLT): DEAD — rv2bolt/rv2 = 0.997.** With self-consistent
  whole-.so PGO + thin-LTO already in the binary, BOLT's post-link layout
  had nothing left to win. Gate/checksum clean, so it failed SAFE; dropped
  under the +3% rule. (Everything up to the optimized .so was already done
  by job 43342607/t4_bolt before this session.)
- **Lever 2 as specified (JS-side record, one crossing/frame): DEAD —
  cb/rv2 = 0.274.** Two causes, diagnosed locally: (a) the wrappers indexed
  the Float64Array with a float-tagged `n=q[0]` — QuickJS's typed-array fast
  path needs int32-tagged indices, so every store took the generic property
  path; (b) even after `|0` coercion, recording from JS bytecode measured
  2-4.4x slower than the direct bindings under QJS_NODRAW. In an interpreter
  the QuickJS->C++ crossing is CHEAP; the plan's premise was wrong. cb0
  (same .so, flag off) = 0.943 vs rv2: the flag-off direct path was
  PGO-starved (profile collected flag-on), consistent with the mh confound.

Salvage in flight — cb2 (commit c61fcfe): recording moved to the C side.
Bindings stay native (the cheap crossing stays per-call) but append resolved
args (colors pre-resolved via colorFromArgs) to the per-env double buffer;
one flush per frame replays through p5::/rasterizer in a tight loop. The
win channel is i-cache/branch locality only. Local (arm64): parity 33 games
x 2 seeds PASS; single-env bench ~neutral (-2..+1%), and the earlier local
+30% bigfish reading was mac run-to-run variance — the x86 vec A/B decides.
Chain2: 43411259 cbgen -> 43411260 build -> 43411262 ab (live rv2 cb cb0) +
43411263 gates (cb). If cb2 lands under +3%, lever 2 is dropped for good and
rv2 stands as the round-3 recommendation unchanged.

Lever-3 note for the future: the remaining rasterizer headroom is
algorithmic (ellipse-path vertex generation, fill_subpaths edge loop), both
explicitly deferred by the plan; span fills are already vector code.

## A/B #7 VERDICT (job 43411262) — cb2 dead; ROUND 3 CLOSED

cb2 chain (43411259 cbgen -> 43411260 build -> 43411262 ab + 43411263
gates): checksums PASS, gate cb = qbert x3 baseline only.

    game        live      rv2       cb      cb0
    bigfish   341,213   1.518    1.497    1.498
    breakout  162,671   1.175    1.136    1.135
    maze       62,211   1.374    1.316    1.328
    miner      33,400   1.248    1.243    1.250
    plunder   423,050   1.476    1.444    1.439
    geomean             1.352    1.321    1.323
    vs rv2:                      0.977    0.979

- **Lever 2 (cb2, C-side record): DEAD — cb/rv2 = 0.977.** cb == cb0 within
  noise, so the buffer's record+replay bought exactly nothing over direct
  execution and the ~2% deficit is the added per-binding branch + a slightly
  different PGO profile. The i-cache-locality hypothesis does not pay on
  this workload. Dropped; with it, every round-3 lever is dropped.

## ROUND 3 FINAL

All three authorized levers are dead: BOLT 0.997x (nothing left after
self-consistent PGO+LTO), p5 command buffer 0.274x as specified / 0.977x as
salvaged (QuickJS binding crossings are cheap; recording from JS bytecode is
2-4.4x more expensive than the call it replaces; deferred replay wins no
locality), span vectorization moot (already compiler-vectorized; blend path
unreachable in the catalog). Every arm was checksum-bit-exact vs live and
gate-identical to the rv2 baseline, so all three failed SAFE.

**The round-2 recommendation stands unchanged: ship rv2** (+29% ProcGen16 /
+32% all-24 over live). The realistic-ceiling band was already reached in
round 2; round 3 confirms the mechanical-lever well is dry. Remaining
headroom, for a future round to propose (all outside round-3 authorization):
ellipse/path caching in the rasterizer (deterministic by construction,
~10-15% on bigfish-class games), dirty-rect adoption check (machinery built,
skip-rate unmeasured in the production config), and the engine tier (V8
vec host / AOT twins — adoption-decision-sized, not tuning levers).

Cluster state: worktree default .so back at rv2; cb/cb0/rv2r/rv2bolt/boltinst
variants + pgo/bolt.fdata + pgo/cbnative.profdata kept for the record;
~/bolt duplicate deleted (tools/llvm21 + ubuntu2404.sif are the canonical
copies). 17402 chain (43246914) never raced, still pending. The two
decisions (adoption, build policy) remain Ryan's, unchanged from round 2.
