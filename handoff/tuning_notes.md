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

## POST-ROUND-3 PROBE: helper histogram inside the interpreter (job 43422679)

Question: the profile says 55-70% "interp" — but WHAT inside it? The nm-level
sampler lumps every inlined helper into JS_CallInternal, so this probe built
rv2g (= rv2 recipe + DBG=1, debug info only — knob added to
build_qjs_vec_tune.sh) and attributed the same SIGPROF samples to their
INNERMOST INLINE FRAME via llvm-symbolizer --inlines
(native/round3/{t7_prof.sbatch,prof_buckets.py}; tables
outputs/r3prof_<game>_43422679.txt in playtrain-trainers).

Bucket shares (% of .so samples):

    bucket            breakout  plunder  bigfish  miner  maze
    property access      16.5     16.1     10.5    6.7    5.9
    refcount/free         7.8      5.7      3.1    5.3    5.5
    rasterizer            5.8      8.8     41.1   21.8   12.5
    p5/host/blit          5.7      9.6      6.4    6.4   10.8
    interp residual*     ~55      ~50      ~31    ~52   ~56
    strict_eq, conversions, GC, atoms, arrays: ALL <2% each, most <0.5%

  *"other" bucket, dominated by the innermost frame JS_CallInternal itself:
  tagged-value arithmetic, stack ops, branches, locals — the interpreter
  core, not any nameable helper.

Findings:

- **find_own_property is the single biggest nameable helper** (16.0%
  breakout, 12.3% plunder, 8.0% bigfish innermost): QuickJS walks the shape
  hash chain on EVERY property access — no inline caches. This is the
  measured upper bound for an interpreter-level IC/shape-cache patch:
  eliminating ~70% of the property bucket projects to **+13% breakout/
  plunder, +8% bigfish, +4-5% miner/maze, ~+8-9% geomean** — the first
  above-threshold lever found since rv2.
- Refcount traffic (js_dup + JS_FreeValueRT) is 3-8% — visible but only
  reachable by Perceus-style elision (deep surgery, poor ratio).
- strict_eq ~= 0 on the 5-game set: the qjit-era "string classification is
  hot" finding was a coinrun artifact and does NOT generalize; string
  interning work would be wasted here.
- The ~50% interp residual is untouchable by ICs — only bytecode
  specialization/quickening (CPython-3.11-style), AOT, or an engine swap
  reaches it. This is the hard ceiling of any IC-only round.
- Rasterizer numbers re-confirm the ellipse/path-caching target (bigfish:
  fill_subpaths 24.8 + rs_ellipse_path 11.6 innermost).

IC story cost, for the round-4 decision: it ends the "stock quickjs-ng"
claim deliberately restored in af9a35c (engine becomes ng-0.15.1 + our IC
patch, maintained by us); the determinism EVIDENCE is untouched (gate is
engine-independent, ICs change lookup, not arithmetic — and the gate +
checksum24 + the archived fuzz_jit.mjs fuzzer are the safety net). Upstream
precedent cuts both ways: quickjs-ng shipped ICs and later removed them
over correctness bugs — crib the code, audit the bug reports. NOT STARTED:
engine surgery is outside round-3 authorization; this section is the
evidence for proposing it.

## ROUND 4 — authorized (Ryan, 2026-09-01 session): IC + path caching

**Lever IC — DEAD, measured to the bottom (native/archive/prop-ic/).** Two
designs implemented against pristine quickjs-ng v0.15.1 and both correct
(33 games x 3 seeds trace-identical) and both SLOWER at the vec operating
point (128 envs x 5 threads, arm64 — two independent local regimes agreed,
so no cluster time was spent):

- front cache ((shape,atom)->idx inside find_own_property): 0.87-0.93.
- per-site quickening ICs (get_field/get_field2/put_field rewritten to
  *_ic opcodes, monomorphic, generation-guarded): 0.945 geomean — even
  after diagnosing and FIXING the invalidation design (per-frame temp-shape
  frees churn a global generation ~2-22 bumps/step; sharding the generation
  into 256 shape-pointer-hash buckets took hit rates from as low as 3.4%
  (maze) to 99.99% everywhere). With ~100% hits it still lost, and the most
  property-bound game (breakout) lost MOST (0.88).

The finding that closes this line: quickjs's baseline lookup is a 1-2
probe hash walk over cache lines the caller touches anyway; a monomorphic
IC hit cannot be shallower, only add working set (IC array + generation
table) and a dependent load. The t7 histogram's find_own_property share is
irreducible frequency, not avoidable overhead. This explains upstream ng's
own IC removal. Interpreter headroom now provably requires SPECIALIZATION
(quickening of operand types / AOT / engine tier), not lookup caching.

**Lever pc (rasterizer) — locally positive, cluster chain running.**
Committed 4f32a7c: (1) ellipse vertex-offset memoization keyed on
(rx,ry,a0,a1) bit patterns, direct-mapped 64 ways (a SipHash HashMap ate
the win; miner's radii are constant, bigfish's per-fish radii are stable) —
bit-exact because cx + cached(pcos(a)*rx) is the identical op sequence;
(2) fill_subpaths flat edge prepass into persistent canvas scratch (kills
the per-scanline modulo + subpath re-walk; an ACTIVE-EDGE TABLE was tried
first and measured SLOWER — at 64x64 device res shapes span so few
scanlines that per-fill sort/alloc constants dominate). Local (arm64,
single-env): bigfish +9-14%, miner +4.5%, maze/breakout flat, plunder
~-1.5%; parity 66/66. t8 chain: 43453845 build (fresh rust-PGO on the new
code — RA.rustpgo is stale for changed functions; merged with rust's own
llvm-profdata per the round-2 trap) -> 43453846 ab (live rv2 pc, 3 reps)
+ 43453852 gates (pc).

Watchlist for further levers (from the t7 tables): refcount traffic
(js_dup + JS_FreeValueRT 8-12%), plunder blit 4.5%, worker spin 3-8%
(bounded by round-2 diagnostics).

## ROUND 4 FINAL — both levers dead; rv2 STILL stands

**pc (path caching): DEAD at 0.989 vs rv2** (A/B #8 job 43453846, 3
interleaved reps; reproduced by A/B #9 job 43460813). The predicted wins
materialized exactly where the t7 profile said — bigfish 1.633 vs rv2's
1.521 (+7.4%), miner +1.8% — but maze (-8.5%), breakout (-3.3%) and
plunder (-2.1%) regressed even though their code paths (rs_fill_rect fast
path) are UNTOUCHED. Isolation arms ruled out the suspects one by one:
pc2 (new code + round-2 rust profile) = 0.978, so it is not the profile
realization; objdump shows span still inlined + vectorized in rs_fill_rect
in the pc .a, so it is not lost inlining of the hot store loop. What
remains is codegen/layout coupling — editing fill_subpaths perturbs
optimization of its siblings — which is exactly the fragile-luck class the
plan's stopping rules exist to stop chasing. Checksums PASS and the gate is
baseline-clean, so it failed SAFE. The bigfish +7.4% is a real, isolated,
bit-exact win (the largest single-game lever since round 1) and is
preserved here for a future round that wants to land the ellipse cache
with codegen hygiene (append-only struct fields, #[inline(always)] span,
possibly a separate codegen unit); the lever as measured is dropped and
the commit REVERTED from the branch tip (ccffa7d reverts 4f32a7c) so the
adoption candidate stays rv2 exactly.

**IC: DEAD by mechanism** (see the round-4 section above and
native/archive/prop-ic/). Never sent to the cluster: two designs, correct
semantics, 99.99% hit rates after invalidation sharding, still 0.945
geomean at the vec operating point — an IC hit cannot beat quickjs's 1-2
probe walk; it can only add working set.

Cumulative lever graveyard across rounds 3-4: BOLT (0.997), p5 command
buffer (0.274 JS-side / 0.977 C-side), span SIMD (moot — already
vectorized), property IC (0.945 local, two designs), path caching (0.989).
Every one failed SAFE (bit-exact, gate-clean). The recommendation is
unchanged for the third time: **ship rv2** (+29% ProcGen16 / +32% all-24
over live). The measured evidence now says the remaining headroom lives
ONLY in the specialization/engine tier (bytecode quickening of operand
types, AOT twins, V8 host, Deegen-class generated VM) — adoption-decision-
sized projects, not tuning levers.

## ROUND 4, LAST PUSH — adaptive dirty-skip CLEARS THE BAR (first since rv2)

The framediff measurement nobody had run: under random play miner produces
85% IDENTICAL frames (static grid, most actions no-op), maze 50%, qbert
37%, heist 25% — and the whole-frame-skip machinery (record/hash/skip,
bit-exact by design) had been built and dirtycheck-gated since before
round 1 but never enabled anywhere. Enabling it globally LOSES on
command-heavy games (record cost scales with command count: maze pays 625
rect-records/frame for 50% skips), so the shipped form is ADAPTIVE
(commit 36e3645): each env probes its first 32 frames under QJS_DIRTY and
permanently disables the machinery below a 75% skip rate — output is
identical in every branch, only the cost profile adapts. Plus a
correctness fix production needed: reset frames render OUTSIDE the frame
bracket, so env_reset/resetGame now clear the frame-hash cache (a
post-reset frame can never skip against a pre-reset hash — very likely
the mechanism of qbert's old dirtycheck frame-118 divergence).

The rasterizer lever was re-landed with the diagnosed hygiene (append-only
RState fields, #[inline(always)] span): pc3/rv2 = 1.020 — the coupling
regressions mostly vanished (bigfish 1.650 vs rv2 1.524, miner +6.7%) but
it stays under the bar ALONE; it ships as part of the dv stack.

## A/B #10 VERDICT (job 43532272; build 43532271 with fresh self-consistent
tipnative2.profdata — env_step_frame changed and the mh lesson applies)

    game        live      rv2      pc3       dv
    bigfish   340,199   1.524    1.650    1.596
    breakout  163,521   1.163    1.151    1.148
    maze       63,539   1.333    1.295    1.274
    miner      33,423   1.248    1.331    1.546
    plunder   423,343   1.472    1.467    1.457
    geomean             1.341    1.369    1.394
    vs rv2:                      1.020    **1.039**

- **dv (= pc3 .so + QJS_DIRTY): +3.9% geomean over rv2, miner +23.9%** —
  gates clean for BOTH pc3 and dv (qbert x3 baseline only; the dv gate ran
  the full 24-game differential against the node reference with dirty
  forced on — the strongest correctness test this machinery has had);
  checksums bit-exact vs live incl. across autoresets.
- dv is UNDERSTATED at --steps 300: the 32-frame probe is ~11% of frames
  there vs <2% at production episode lengths.
- Full 24-game banked run (live vs rv2 vs dv, published topology): job
  43535528 (t11_full).

## FULL-RUN VERDICTS (t11 43535528, then t12 43538942 after the probe fix)

t11 (probe=32) measured dv/rv2 = 1.008 all-24: the winners were real
(miner 1.222, bigfish 1.082, fruitbot 1.052, asteroids 1.038) but a long
~-2% tail of probe cost dragged the aggregate — 32 probe frames are ~11%
of a 300-step measured window. The fix is legitimate, not cosmetic:
bench_vec_rollout has a 20-step UNTIMED WARMUP exactly to exclude startup
transients, and the probe is a startup transient — probe shortened to 20
frames (9cd4bb7) so it completes inside the warmup and measured windows see
only post-decision behavior. Checksums re-verified; gate re-run clean.

t12 FINAL (probe=20, 24 games x 3 interleaved trials, 0 failures):

    ProcGen16: rv2 1.290   dv 1.327   dv/rv2 1.028
    ALE8:      rv2 1.369   dv 1.381   dv/rv2 1.009
    all24:     rv2 1.316   dv 1.344   dv/rv2 1.022

18/24 games at dv/rv2 >= 0.995; winners: miner 1.228, bigfish 1.078,
fruitbot 1.063, asteroids 1.053, chaser/heist/dodgeball ~1.02. Known
blemish: maze 0.960 (pc3's residual codegen coupling — a future micro-round
could try an ellipse-cache-only .a to recover it; the stack is net-positive
with it included).

## RECOMMENDATION (supersedes the round-2 recommendation)

Ship **dv** = branch tip (rv2 recipe + hygiene rasterizer [ellipse-offset
cache + flat edge prepass] + adaptive dirty-skip host) built by
native/round3/t10_build.sbatch (tipnative2.profdata + rust2.profdata +
VIS=1), run with QJS_DIRTY=1: **1.327x ProcGen16 / 1.344x all-24 over the
live binary** (vs rv2's 1.290/1.316), bit-exact everywhere rv2 is, gate
baseline identical (qbert x3 only), every lever measured with 3 interleaved
trials at the published topology. Projected 17402 anchor: 1.78M x 1.327 ~=
2.36M ProcGen16 ~= 1.43x tuned EnvPool. If dirty-skip is unwanted as a
POLICY (it is a rendering memoization, arguably a claims question), rv2
remains the fallback and pc3 alone is 1.020 — but dv's correctness
evidence is the strongest of any variant: the full 24-game differential
gate ran with dirty FORCED ON.

The two decisions remain Ryan's, now three-way: (a) adoption target (live /
rv2 / dv) — any change still invalidates published numbers and triggers the
re-measurement cascade + 17402 confirm after the pinned chain drains;
(b) build policy (portable vs tuned); (c) whether frame-skip memoization is
inside or outside the paper's measurement claims (it changes NO outputs —
skip-vs-render is bit-exact by construction and gate-verified — only cost).

Cluster state after round 4: worktree at ccffa7d (rv2 == tip build again),
default .so/qjs_host = rv2, RA restored to RA.v3; new artifacts kept for
the record: variants pc/pc2/rustgen2 + qjs_host.pc{,2}, pgo/rust2.profdata,
pgo/cbnative.profdata, outputs tune_ab_{43398275,43411262,43453846,
43460813}, r3prof_*_43422679 helper histograms, gates_r3/. 17402 chain
(43246914) still pending, never raced.

## Determinism holes CLOSED (laptop, 2026-09-01, ef74835 on this branch, d46fcae on main)

Root cause of BOTH pre-existing gate holes (qbert terminal frame, live's
aim_trainer reset frame): native p5 style cache. pop() invalidated via a
single _cacheValid flag, but the next FILL-ONLY draw's afterFill()
re-validated the whole cache, resurrecting stale stroke mirrors — the next
stroked draw then skipped rs_set_stroke/rs_set_line_width and stroked with
the rasterizer's post-restore state (thin ring). Rare on qbert because its
enemy ellipse is ~2.5 device px (subpixel-alignment dependent); a 15-line
probe (push/stroke/pop, fill, stroke again) diverged EVERY frame. Fix =
exact shim semantics: invalidate nulls all three mirrors, afterFill deleted.
gate_qjs.sh --all 3000: 100 PASS, 0 FAIL on BOTH lineages. New gate
baseline is ZERO known divergences — A/Bs should expect clean gates now.
NOTE: the fix changes pixels on previously-divergent frames only; throughput
effect is negligible (a few extra rs_set calls per style transition).

## ROUND 5 — engine tier (PLAN-engine-tier.md), started 2026-09-04

Branch `engine-tier` (local + cluster worktree `playtrain-wt-engine`); the
tuning worktree, `native/build/libqjs_vec.so` (b3709b39…) and
`variants/qjs_host.adv` (46ea4999…) are never written. Everything here is
PROPOSED until Ryan adopts; nothing is quoted anywhere else.

### L1 — Futamura AOT of bytecode (`qjsc -A`, ivankra fork)

**Hypothesis.** Specializing the interpreter to the fixed bytecode removes
dispatch/decode and lets clang constant-fold operands; values stay boxed and
`get_field` still walks the shape. Bounds L2/L6 (dispatch-side levers) from
above. Proceed threshold F1/F0 >= 1.15 geomean on the 5 profiled games.

**What was built** (`native/aotfork/`, commit 0c9d9ba on engine-tier):
- Fork `github.com/ivankra/quickjs` branch `aot` @ cee72b9 ("QuickJS-AOT
  20251209"; Bellard lineage 2025-09-13 + tail-call dispatch). `qjsc -A -c`
  emits, per JS function, a C function = the interpreter's handler bodies
  stitched in bytecode order (`#include "quickjs.i"`, the whole preprocessed
  engine, so the AOT'd functions and the engine are ONE translation unit).
  At `JS_ReadObject` the engine memcmp's each function's bytecode against
  the compile-time copy and, on match, points `b->aot_func` at the C
  function ("aot enabled" on stderr); on mismatch it silently interprets
  ("Bytecode mismatch …" on stderr — the gate treats that as FAIL).
- `qjsc-hostmode.patch` (+37 lines to qjsc.c, env `QJSC_HOST_MODE=1`): one
  shared compile context created like an embedding host (`JS_NewContext`,
  no std helpers) across all input files, table emitted once, compiled
  objects kept alive. Needed because atom indices are baked into the AOT
  bytecode: the host must `JS_ReadObject` the blobs in the same order,
  right after `JS_NewContext`, with no atoms created in between. (First
  attempt freed each file's object after compiling it → freed-atom slots
  reused by the next file → 2 of 16 bigfish functions fell back to the
  interpreter. Fixed; gate now checks stderr for it.)
- `qjs_host_fork.cpp` = `qjs_host.cpp` (md5 f813ce92, the tuning-tree copy)
  + `JS_IsArray(ctx, v)` (Bellard signature) + `#ifdef HOST_AOT`: read the
  two blobs (prelude, game) first, install bindings, `JS_EvalFunction`
  prelude then game — the same order as F0/ng. The p5 PRELUDE is compiled
  with `-A` too (as its own unit, NOT concatenated with the game: a game that
  declares its own `dist`/`lerp` would otherwise lose to the hoisting order).
- Flags identical across arms: `-O3 -march=x86-64-v3 -ffp-contract=off
  -DNDEBUG -funsigned-char -fwrapv` (the last two are fork semantics, not
  tuning). No PGO on f0/f1/ng; `adv` is the adopted PGO/LTO build.
- Arms: f0 = fork interpreter host; f1 = f0 + `-A` per game (prelude +
  game); ng = stock quickjs-ng 0.15.1 host built by build_qjs.sh in the
  engine worktree (same flags); adv = `variants/qjs_host.adv` (read-only
  copy). Scripts: `build_fork.sh`, `gate_fork.sh` (all 4 arms vs ONE V8
  reference run), `bench_fork.sh` (interleaved A,B,C,D per rep),
  `l1_fork.sbatch` (genoa, --exclusive).

**Local preview (mac arm64, Apple clang, no QJS_DIRTY, live-tree p5.cpp —
NOT a result, recorded only because it motivated spending the cluster job):**
gate 5 games x 3 seeds x 3000: f0/f1/ng-local all bit-exact vs V8 (45/45);
f0 on all 33 games 99/99. Bench 5 reps x 20k, medians, f1/f0: breakout
1.257, plunder 1.116, bigfish 1.066, miner 1.253, maze 1.374, geomean
1.208; ng/f0 1.032 (fork interpreter ~3% behind ng on arm64).

**Cluster results (2026-09-04; both jobs genoa `--exclusive`, same-job interleaved arms).**

*Gate* (job 44421807, holy8a24308; V8 reference = engine-worktree
`reference_trace.mjs`, 3 seeds x 3000 steps): f0, f1 and stock ng PASS all
33 paper games (99/99 each). f1 stderr clean — every AOT'd function is
actually running compiled (113 game files x prelude compiled; 0 "Bytecode
mismatch"). QJS_DIRTY=1 forced gate on the 5 profiled games: 60/60. The
live dir has 115 files (analogen, a-cq-*); those have no V8 reference here
and fail on EVERY arm — noise, gate now points at the 33 (f09efbe).
**Observation for Ryan, not mine to act on: `qjs_host.adv` (46ea4999)
diverges from this reference on qbert, all 3 seeds; f0/f1/ng do not.** The
vec checksum below shows the same: adv is the odd one out on qbert.

*Vec obs checksum* (job 44423769, 2000 steps x 32 envs, 24 games, QJS_DIRTY=1):
ng == fork == fut byte-identical on 23/24 (jumper's fut .so was built after
the checksum step — rerun pending); adv differs from all three on qbert only.

*Single-core A/B* (job 44421807, `qjs_host bench`, medians of 5 reps x 50k,
QJS_DIRTY=1; f0/f1/ng = -O3 v3 no PGO; adv = adopted PGO/LTO):

    game        f0      f1      ng     adv   f1/f0  ng/f0  adv/f0
    breakout  45513   59926   43285   41181  1.317  0.951  0.905
    plunder  161877  180995  156385  156654  1.118  0.966  0.968
    bigfish  135823  144206  137409  147013  1.062  1.012  1.082
    miner     12056   16220   11111   11147  1.345  0.922  0.925
    maze      20976   24835   17427   18065  1.184  0.831  0.861
    geomean                                  1.200  0.934  0.945
    (no dirty-skip, 3 reps:                  1.194  0.936  0.958)

*Vec-host A/B* (job 44423769, holy8a24308; §4 iteration protocol: 1 worker,
128 envs, 5 threads, 300 steps, 20 warmup, QJS_DIRTY=1, bench_vec_knobs
--lib-path, arms interleaved adv,ng,fork,fut; 2 reps on the 5, 1 rep on the
rest; env steps/s):

    game            adv      ng    fork     fut  fut/fork fork/ng fut/adv
    bigfish      549849  502934  510981  540706   1.058   1.016   0.983
    breakout     189070  189249  201866  260886   1.292   1.067   1.380
    maze          82265   72122   85242  103227   1.211   1.182   1.255
    miner         51463   47190   51482   67450   1.310   1.091   1.311
    plunder      622003  597786  613486  698718   1.139   1.026   1.123
    asteroids    329512  303398  296792  326986   1.102   0.978   0.992
    bossfight    437697  432420  448930  499861   1.113   1.038   1.142
    caveflyer     79039   73708   84860  109859   1.295   1.151   1.390
    chaser        88689   84260   85202  105350   1.236   1.011   1.188
    climber       69850   64329   64575   73671   1.141   1.004   1.055
    coinrun       68408   60229   73773   98014   1.329   1.225   1.433
    dodgeball    103325  107692  100126  121278   1.211   0.930   1.174
    freeway      646313  608765  602078  692781   1.151   0.989   1.072
    frostbite    305904  278771  250132  269729   1.078   0.897   0.882
    fruitbot      57375   54097   52303   62501   1.195   0.967   1.089
    heist        143314  134736  139733  182923   1.309   1.037   1.276
    jumper        96342   88084   86650   98356   1.135   0.984   1.021
    leaper       125610  119614  123940  164147   1.324   1.036   1.307
    ninja        538861  492431  474682  536953   1.131   0.964   0.996
    pong        1344120 1272453 1294416 1400741   1.082   1.017   1.042
    qbert         67534   62933   63352   67559   1.066   1.007   1.000
    seaquest     535544  517807  513692  588371   1.145   0.992   1.099
    space_inv    248527  242781  254546  322832   1.268   1.048   1.299
    starpilot    335641  310558  312495  363245   1.162   1.006   1.082
    geomean-5                                    1.198   1.075   1.202
    geomean-24                                   1.184   1.025   1.140

**Verdict (L1): PROCEED. F1/F0 = 1.20 single-core, 1.20 vec (5 games),
1.18 vec all-24 — well past the 1.15 floor.** Two components, both real:
(a) the fork *interpreter* (Bellard 2025-09 + tail-call dispatch, no PGO) is
1.07 over stock ng on the 5 and ~1.0 all-24 on the vec host (wins: maze
1.18, coinrun 1.23, caveflyer 1.15; losses: frostbite 0.90, dodgeball 0.93);
(b) `-A` adds 1.18–1.20 on top, uniformly positive (worst bigfish 1.06 —
41% rasterizer; best miner 1.31, coinrun 1.33, leaper 1.32). Against the
ADOPTED build: fut/adv 1.20 on the 5, 1.14 all-24, with adv PGO/LTO'd and
fut plain -O3 — the confound runs against fut. Dispatch removal is NOT ~0
on this workload (contradicts commit a252840's note; agrees with DESIGN.md's
direction, though 1.2x not 1.6x).

What this settles for the other levers: L2 (superinstructions) and L6 are
bounded by roughly this number and are now moot if the fork is adopted (L6
comes with it; L2 is a strict subset of what -A does). L4 (quickening) is
the remaining lever that attacks something -A does not (tag checks/boxing);
it composes with -A only inside the fork, i.e. only after decision 1.

Not yet done (in order): (1) jumper checksum rerun; (2) PGO for the fork
arms (fresh profile per §2 rule 2 — F1 per game means per-game profiles or
one merged profile; decide) so fut-vs-adv is tuned-vs-tuned; (3) the §4
BANKED run (16 workers x 128 x 5, 24 games, -w holy8a24307, 3 trials) plus
single-core panel-C on the 16 ProcGen games; (4) engineering for real use:
per-game .so today (libqjs_vec.fut_<game>.so, ~1.5 MB each, ~40 s compile);
production needs compile-at-load cached by game md5, or one .so with all
24 games' AOT tables (needs the aot_id space partitioned — the table is
global per process). Nothing here is adopted; decision 1 (§7) is Ryan's.
Artifacts: $WE/native/aotfork/out/{host_f0,host_f1_*,libqjs_vec.fork.so,
libqjs_vec.fut_*.so,gate_all.txt,bench_*.txt,vec_ab_44423769/}, logs in
$WE/native/aotfork/logs/.

*Single-core all-24* (job 44421807, medians of 3 reps x 30k, QJS_DIRTY=1):
f1/f0 1.174, ng/f0 0.980, adv/f0 0.997 → f1/adv ≈ 1.18 geomean-24 on the
panel-C protocol (f1 wins every game; smallest pong 1.024, qbert 1.051;
largest heist 1.357, miner 1.341, coinrun 1.313). Engine-swap alone (f0 vs
adv) is a wash all-24 single-core (0.997): fork wins maze/coinrun/caveflyer
by 12–15%, loses frostbite/ninja/asteroids by 10–19%. Full table:
`$WE/native/aotfork/out/bench_24_dirty.txt`.
Jumper vec checksum rerun after the rebuild: fut == fork == ec43e57d4f (the
digest adv/ng produced in-job) → vec checksum24 is 24/24 clean for ng/fork/fut.

### L1, tuned-vs-tuned (job 44425939, holy8a2xxxx genoa, 2026-09-04 14:35)

Recipe = the adopted one (adopt_build.sbatch): `-fprofile-generate` builds
→ vec-workload profile (vec_prof_driver.py, 128 envs x 5 threads, 30 s) on
the 8 profile games for BOTH fork and fut(per game) + 10 s single-core →
ONE merged `fork.profdata` (26 profraws) → `-fprofile-use -flto=thin
-fvisibility=hidden` + version script + the Rust-PGO'd rasterizer .a adv
uses (`libplaytrain_rasterizer.a.rustpgo_adv`, sources identical). ThinLTO
REQUIRES one .profdata across every object in a link ("ProfileSummary IDs
have conflicting values" otherwise) — so per-game profiles are not an
option; everything goes in one merged file. Gate f0T/f1T: 114/114 on the 33
paper games. Vec checksum forkT/futT vs stock ng: 24/24 (2 rebuilt after a
parallel-build race, then checked; race fixed in 591d8f5).

Vec (§4 iteration protocol, 5 games x 2 reps + all-24 x 1, medians):

    game            adv    fork     fut   forkT    futT  futT/forkT futT/adv forkT/adv
    bigfish      545234  511278  517043  591522  630586   1.066    1.157    1.085
    breakout     189110  202102  261058  234250  289198   1.235    1.529    1.239
    maze          81700   85846  103266  100130  118618   1.185    1.452    1.226
    miner         51308   51556   67304   64422   74386   1.155    1.450    1.256
    plunder      621896  612822  705303  681789  773576   1.135    1.244    1.096
    geomean-5                                             1.154    1.359    1.178
    geomean-24                                            1.067    1.193    1.118
    (futT/fut 1.135 on the 5, but 1.046 all-24 — see the artifact below)

Single-core (qjs_host bench, 5 x 50k, QJS_DIRTY=1, medians):

    game          adv     f0     f1    f0T    f1T  f1T/f0T f0T/f0 f1T/f1 f1T/adv f0T/adv
    bigfish    146043 135905 144647 154085 157408  1.022  1.134  1.088  1.078  1.055
    breakout    41176  45385  59633  53706  67529  1.257  1.183  1.132  1.640  1.304
    maze        18060  20945  24892  24136  28545  1.183  1.152  1.147  1.581  1.336
    miner       11067  12075  16240  14930  18777  1.258  1.236  1.156  1.697  1.349
    plunder    156362 162216 181048 181525 199748  1.100  1.119  1.103  1.277  1.161
    geomean-5                                      1.160  1.164  1.125  1.434  1.236

Reading: PGO+LTO buys the fork what it bought ng (+16% interpreter,
+12% AOT). Tuned-vs-tuned on the 5 profiled games: **futT/adv 1.36 vec,
1.43 single-core; forkT/adv (engine swap alone, no AOT) 1.18 / 1.24.**
Artifact in the all-24 number: the profile covered only the 8 games, and a
per-game AOT TU whose functions have NO profile is de-optimized under
-fprofile-use (unprofiled call sites are treated as cold by the inliner):
futT < fut on every unprofiled game (climber 0.92, jumper 0.97, frostbite
0.99, asteroids 0.97, freeway 0.96, ninja 0.99) and futT > fut on all 8
profiled ones (chaser 1.16, coinrun 1.15, dodgeball 1.11). Job 44430166
(l1_tune24.sbatch) re-cuts with all 24 games in the merged profile; that is
the number to compare against adv all-24. forkT (one TU, fully profiled)
has no such artifact: forkT/adv 1.118 all-24 stands as measured.

### L1 tuned, all-24 profile (jobs 44430166 build+gate+checksum → preempted; 44434726 A/B, holy8a28511, 2026-09-04 15:25)

Same recipe, merged profile from ALL 24 games (58 profraws: vec fork + vec
fut-per-game on 24, single-core on 5). Gate f0T2/f1T2 114/114; vec checksum
forkT2/futT2 vs stock ng 24/24 PASS. (44430166 was preempted by
serial_requeue after those steps; its restart was cancelled — it would have
rebuilt the .so files under the banked job — and steps 5–6 re-run read-only
as l1_ab_t2.sbatch.)

Vec, §4 iteration protocol (5 games x 2 reps, all-24 x 1; medians):

    game            adv     fut    futT  forkT2   futT2  futT2/forkT2 futT2/futT futT2/adv forkT2/adv
    bigfish      542697  542464  621528  584236  616870   1.056  0.993  1.137  1.077
    breakout     190158  259929  291810  234100  291470   1.245  0.999  1.533  1.231
    maze          82014  103058  119364  100039  119126   1.191  0.998  1.453  1.220
    miner         51083   67426   75166   64364   77360   1.202  1.029  1.514  1.260
    plunder      616925  700148  772737  697560  770494   1.105  0.997  1.249  1.131
    asteroids    328685  326321  333404  350439  367010   1.047  1.101  1.117  1.066
    bossfight    439566  511665  518214  517064  589515   1.140  1.138  1.341  1.176
    caveflyer     79216  109813  119054   98563  127259   1.291  1.069  1.606  1.244
    chaser        88273  105459  122979  103164  123792   1.200  1.007  1.402  1.169
    climber       69448   73668   68339   73239   83086   1.134  1.216  1.196  1.055
    coinrun       68391   98050  113376   88569  114805   1.296  1.013  1.679  1.295
    dodgeball    102687  121820  135560  121664  135493   1.114  1.000  1.319  1.185
    freeway      647121  687048  681812  714332  723610   1.013  1.061  1.118  1.104
    frostbite    306871  270614  282190  293327  329199   1.122  1.167  1.073  0.956
    fruitbot      57734   62653   62180   65091   74087   1.138  1.191  1.283  1.127
    heist        145134  182965  200197  180390  229125   1.270  1.144  1.579  1.243
    jumper        95022   99062   95497  100581  113256   1.126  1.186  1.192  1.059
    leaper       126625  164333  153169  142628  157865   1.107  1.031  1.247  1.126
    ninja        534677  537782  543614  555137  608033   1.095  1.119  1.137  1.038
    pong        1332475 1391407 1454854 1433712 1601186   1.117  1.101  1.202  1.076
    qbert         66886   67144   67789   74734   79666   1.066  1.175  1.191  1.117
    seaquest     534869  590935  587482  593873  654239   1.102  1.114  1.223  1.110
    space_inv    248202  324193  310338  282613  337232   1.193  1.087  1.359  1.139
    starpilot    335698  363203  363971  361940  406079   1.122  1.116  1.210  1.078
    geomean-5                                             1.158  1.003  1.368  1.182
    geomean-24                                            1.143  1.083  1.296  1.134

Single-core (5 x 50k, QJS_DIRTY=1): f1T2/adv 1.449 geomean-5 (bigfish
1.131, breakout 1.613, maze 1.633, miner 1.678, plunder 1.277); f0T2/adv
1.208; f1T2/f0T2 1.200.

**The all-24-profile artifact is confirmed and gone**: futT2/futT = 1.00 on
the 5 (both profiled), 1.08 all-24 (the 16 previously unprofiled games gain
6–22%). **Tuned-vs-tuned, iteration protocol: futT2/adv 1.37 on the 5,
1.30 all-24, every one of the 24 games ≥ 1.07 (min frostbite 1.073, max
coinrun 1.679).** Engine swap alone (forkT2/adv): 1.18 / 1.13, one loss
(frostbite 0.956). AOT on top of the tuned fork (futT2/forkT2): 1.16 / 1.14.
Expected paper effect if banked: Fig 4A vs EnvPool-best 1.64x → ~2.1x
(1.64 x 1.30) — the top of the §0 range; panel C 1.35 → ~1.9 on the 5
(1.35 x 1.45), to be measured on the 16 in the banked job.

Banked run (§4: 16 x 128 x 5, 24 games, 3 trials, -w holy8a24307, arms adv /
forkT2 / futT2, + panel-C single-core 16 ProcGen) = job 44434186, pending.

**adv qbert divergence, root cause (2026-09-04):** one frame in 3000 (step
237, GAMEOVER terminal frame, obshash only) on all 3 seeds. The adopted
artifacts (job 43780730, md5s b3709b39/46ea4999) were built from 5a42f71
(09-01 07:56); the style-cache determinism fix ef74835 (09-01 11:51) is NOT
an ancestor of that SHA — the adopt_build.sbatch comment claiming the
re-cut includes it does not match the artifacts on disk (mtime 09-01
22:30). Throughput numbers are unaffected; bit-exactness of adv vs the
current reference is off by that one frame until adv is re-cut.

### L1 BANKED (job 44439298, holy8a28510 genoa exclusive, 2026-09-04 15:59)

§4 banked protocol: 16 workers x 128 envs x 5 env threads (80 threads), all
24 games, 300-step window (20 warmup), QJS_DIRTY=1 on every arm, 3
interleaved trials, arms by explicit --lib-path (bench_vec_knobs.py):
adv (b3709b39) / forkT2 / futT2. Unpinned (holy8a24307 was reserved) —
ratios are same-job; absolutes here are NOT comparable to the 17402 matrix.
216/216 runs completed, 0 RUN_FAIL.

    game               adv    forkT2     futT2  forkT2/adv  futT2/adv
    bigfish        8551747   9129488   9565077     1.068      1.118
    bossfight      6839251   8149054   9245958     1.192      1.352
    caveflyer      1326777   1640429   2096569     1.236      1.580
    chaser         1405580   1636457   1951226     1.164      1.388
    climber        1116231   1205118   1342316     1.080      1.203
    coinrun        1099136   1425033   1837994     1.297      1.672
    dodgeball      1662452   1970098   2163968     1.185      1.302
    fruitbot        921915   1045875   1154306     1.134      1.252
    heist          2317670   2883457   3633986     1.244      1.568
    jumper         1525786   1657829   1819650     1.087      1.193
    leaper         2035727   2303097   2740160     1.131      1.346
    maze           1314379   1605753   1907963     1.222      1.452
    miner           821020   1031779   1237310     1.257      1.507
    ninja          8471823   8975331   9589148     1.059      1.132
    plunder        9877632  11025284  12168715     1.116      1.232
    starpilot      5315745   5773942   6494577     1.086      1.222
    asteroids      5272452   5582034   5903589     1.059      1.120
    breakout       3026092   3741832   4679369     1.237      1.546
    freeway       10273381  11257796  12021573     1.096      1.170
    frostbite      4893328   4692304   5233908     0.959      1.070
    pong          21379690  22814489  25315746     1.067      1.184
    qbert          1080925   1190385   1259668     1.101      1.165
    seaquest       8471164   9434408  10380242     1.114      1.225
    space_inv      3989913   4566487   5463506     1.145      1.369
    geomean-PG16                                   1.158      1.335
    geomean-ALE8                                   1.095      1.223
    geomean-all24                                  1.136      1.297

Panel C (single-core, sweep4_adv.sh protocol: QJS_DIRTY=1 qjs_host bench 0
100000, 16 ProcGen, 3 interleaved reps, medians): f0T2/adv 1.202, **f1T2/adv
1.377** (min ninja 1.157, bigfish 1.139; max coinrun 1.670, miner 1.653,
heist 1.624, maze 1.614). Full table: logs/l1_bank_any_44439298.out.

**L1 VERDICT: BANKED at 1.297x all-24 / 1.335x ProcGen16 / 1.223x ALE8
over adv at the published topology (3 trials), 1.377x panel C; matches the
1-worker iteration number (1.296) to 0.1%; gate 33/33 x 3 seeds bit-exact;
vec checksum 24/24 identical to stock ng.** Bank threshold (+3% all-24) is
passed by an order of magnitude. Engine swap alone (forkT2) banks 1.136 /
1.202 panel C on its own. Paper effect if adopted (ratios only; 17402
confirm needed for absolutes): Fig 4A ProcGen 1.64x -> ~2.2x tuned EnvPool,
ALE ~15x -> ~18x; panel C x1.38 (ProcGen16 win count will rise from 10/16).
Adoption = Ryan's decision 1 (PLAN-engine-tier §7); it ends the "stock
quickjs-ng" description and re-triggers the full re-measurement cascade.

### ROUND 5 summary table (lever x geomean-5 x all-24 x panel-C x gate)

    lever                                 geo-5 vec  all-24 vec  panel-C PG16  gate
    L1 fork interpreter, untuned (fork)     1.016*     1.025*        0.980       33/33
    L1 fork + -A, untuned (fut)             1.20       1.14          1.18        33/33
    L1 fork, PGO/LTO (forkT2)               1.18       1.136 (bank)  1.202       33/33
    L1 fork + -A, PGO/LTO (futT2)           1.37       1.297 (bank)  1.377       33/33
    L2 superinstructions                    subsumed by -A (not run)
    L3 p5 intrinsics                        not run (see PLAN-engine-tier-round6.md)
    L4 quickening                           not run; re-specified as AOT type feedback (round 6)
    L5 NaN-boxing                           not run
    L6 tail-call dispatch                   = the fork interpreter row
    (* vs stock ng, not adv)

## ROUND 6 — engine tier 2 (what `qjsc -A` leaves on the table)

Spec: `handoff/PLAN-engine-tier-round6.md`. Baseline for this round is
futT2 (L1 banked, 1.297x all-24 over adv); every lever is measured against
both futT2 and adv. Branch `engine-tier`, code under `native/aotfork/`.

### E0 — profile futT2 (job 44449147, holy8a28510 genoa, 2026-09-04 16:13–16:31)

**Hypothesis.** Round 3 profiled the stock interpreter; nobody has profiled
the AOT build. Every round-6 lever's expectation has to come from where futT2
actually spends its time, not from the round-3 table.

**Built.** `build_fork.sh` gained `DBG=1` (-g on engine objects, AOT unit,
host; codegen unchanged). Tuned recipe rebuilt under `TAG=T2dbg`
(fork24.profdata, thin-LTO, hidden vis, Rust-PGO rasterizer) for
forkT2dbg + futT2dbg x {breakout plunder bigfish miner maze coinrun heist}.
Sanity, no profiler, 20 s each: futT2 304.0k vs futT2dbg 298.8k (breakout),
116.7k vs 121.1k (maze); forkT2 243.8k vs 241.6k, 101.2k vs 100.9k. Text
size identical to 16 bytes. No "Bytecode mismatch" on any arm.
Profiler: `prof_preload.so` (ITIMER_PROF ~1 kHz, in-process), vec workload
128 envs x 5 threads, QJS_DIRTY=1, 60 s per (arm, game); 70–79k samples per
run, 97–98% inside the `.so`. Symbolized with `llvm-symbolizer --inlines`;
`prof_buckets_aot.py` attributes each sample to its innermost NON-trivial
inline frame (JS_IsUninitialized / JS_NewInt32 / set_value-style helpers are
folded into their caller or into refcount), buckets it, and — because the
emitted functions are `aotN_<jsname>` and every opcode body sits under a
`/*pcN:*/ /*op*/` marker — also gives per-JS-function and per-opcode views.
Reports: `out/e0_44449147/{buckets_{fut,fork}_<g>.txt,summary.txt}`.

**futT2dbg — % of .so samples** (includes the host's worker spin; see below)

    bucket                breakout   plunder   bigfish     miner      maze   coinrun     heist
    AOT residual              32.7      30.0      14.7      31.7      35.0      34.5      33.8
    refcount/free             15.9      10.3       6.4      14.4      17.0      19.7      19.5
    property access           13.8      11.8       7.7       2.2       0.6      15.3       2.3
    call machinery             4.6       4.9       2.6       8.4       8.7       5.8       7.2
    arith slow paths           5.9       2.5       2.5       1.1       0.0       1.7       2.8
    conversions                2.5       1.1       1.0       1.3       0.2       0.7       1.8
    atoms/strings              0.8       2.2       1.9       0.4       0.4       1.2       0.7
    strict_eq/str-cmp          0.0       0.0       0.0       0.0       0.0       1.4       0.0
    rasterizer                 9.6      11.3      39.7      19.2      23.8       8.1      17.4
    p5/host/blit               7.3      10.9       8.8       8.1       8.0       4.7       9.8
    vec host spin              4.8      10.1      11.0       9.2       5.4       5.2       2.8
    other                      2.0       4.4       3.3       3.3       1.0       1.6       1.9

"AOT residual" = the sample's innermost non-trivial frame is the `aotN_`
function itself: operand-stack loads/stores through `sp[]`/`var_buf[]`, tag
tests, boxing, the inline int/f64 fast paths, loop back-edges. It is what
"interp dispatch" (43–50% on forkT2dbg, same games, same job) became after
`-A`: dispatch+decode are gone, the rest of the interpreter's residual is
not.

**Same samples by bytecode opcode family** (fut arm; 46–62% of samples map to
a marker, the rest are rasterizer/host/callees not inlined into an aot fn):

    family                breakout   plunder   bigfish     miner      maze   coinrun     heist
    fields (get/put_field, get_length)   21.7   15.1   8.8    0.9    0.5    5.2    1.6
    E2 stack/local            18.3      12.3       7.5      16.2      29.6      22.7      22.9
    E3 calls/globals          13.7      14.0       7.1      19.4      14.1      15.1      21.6
    E1 array element           5.5       2.4       1.3       3.0       2.7       8.2       4.2
    E1 arith/compare           2.1       3.7       1.5       6.4       4.6       4.5       3.9

Hottest opcodes (fut): breakout `get_field` 20.0% (find_own_property is the
single hottest non-AOT frame, 13.1%), `get_loc_check` 4.1, `get_array_el`
4.0, `call`/`call3`/`call_method` 3.6/3.2/3.4, `put_loc_check` 3.6,
`put_loc8` 3.5, `get_var` 3.0, `drop` 2.5. maze: `goto8` 11.1 (loop
back-edge + interrupt poll), `call` 10.1, `put_loc_check` 7.1, `drop` 6.5,
`get_var` 3.5, `get_array_el` 2.7, `lt` 2.6. heist/coinrun/miner:
`put_loc_check` 9.2/7.9/4.7, `call3` 8.3/3.9/6.2, `call` 7.7/2.4/6.7,
`drop` 5.4/2.1/4.3, `get_var` 4.3/2.5/3.7, `get_array_el` 4.2/3.6/2.8.
`put_loc_check`/`put_loc8`/`drop` are 50–99% refcount (the `set_value` /
`JS_FreeValue` of the value being overwritten or dropped). `lt/add/sub/mul`
are 100% "AOT residual", i.e. they already run on the inline int/f64 fast
path; the only arithmetic that leaves the function is `js_relational_slow`
(breakout 4.8%: the compare fast path is int-only, every f64 compare is a
call through JS_ToPrimitiveFree x2) and `js_binary_arith_slow` (~1%: mixed
int x f64 operands, not covered by the int/int and f64/f64 paths).
Per JS function: `draw` is 37–52% of samples on every game (drawEntities
another 25 on breakout; moveAndCollide 12 on coinrun); update/collision
functions are ≤ 12%.

**Two host-side findings, not engine.** (1) `worker_loop` +
`vector<WorkerCtl>::operator[]` = 3–11% of ALL CPU samples: the vec host's
worker threads spin-wait between steps at 128 x 5 (busiest on bigfish and
plunder, the fastest games). It is idle CPU, not latency — throughput is
unaffected at 1 worker — but at 16 workers x 5 threads on an 80-thread node
it is CPU taken from other workers. Worth one A/B of a futex/short-backoff
wait later; not this round. (2) Rasterizer + p5 host = 17–49% (bigfish 49,
maze 32, miner 27): untouched by anything below; the ceiling statements in
the plan §0 stand.

**Verdict and re-derived expectations (rule: every lever restates its number
from this table before it is built).**

- **E1 (type-feedback specialization of arith/compare/array): KILLED before
  build.** The family it attacks is 3.6–12.7% of samples and already runs
  on inline fast paths; the only part that leaves the function is the slow
  bucket, 0.0–5.9% (geomean of ceilings over the 5 profiled games ≈ 2%).
  The proceed threshold is +5% geomean on the 5; unreachable even at 100%
  recovery. The profile step, the `-R/-T` flags and the ≥99% monomorphism
  machinery buy nothing here. What survives is **E1-lite**: f64 and mixed
  int/f64 fast paths in the `lt/lte/gt/gte/eq/neq/strict_eq` and
  `add/sub/mul` handler bodies (a ~30-line engine patch, no profile, exact by
  construction — same conditions as `js_relational_slow`'s number branch).
  Expected +3–5% on breakout, +1–2% elsewhere; fold into E2's build and
  measurement, do not run alone.
- **E2 (operand stack → C locals): the top engine lever.** E2 family 7.5–30%,
  AOT residual 30–35%; on maze/coinrun/heist the `put_loc_check`/
  `get_loc_check`/`put_loc8`/`drop`/`goto8` group alone is 20–28%. Two
  static wins come with it: the `_check` TDZ tests (`JS_IsUninitialized` on
  every let/const access, 4–10%/game) are removable when the emitter proves
  the slot initialized on all paths, and `set_value` frees of int/f64 locals
  disappear once the emitter tracks that a slot holds a non-refcounted tag.
  Expected 1.08–1.15x on the interpreter-heavy games, ~1.03x on bigfish.
  Kill unchanged (< +5% on the 5 with hot opcodes whitelisted).
- **E3 (p5 intrinsics): bigger than the plan assumed.** Calls/globals family
  7–22%, call machinery 2.6–8.7%, `js_call_c_function` 2.2–5.4% innermost,
  plus the arg refcount frees under `drop`/`call*`. On maze/miner/heist
  (draw = 39–52% of samples, ~all of it `get_var rect/fill; call3`) the
  reachable slice is ~15–25%. Expected 1.06–1.12x on draw-heavy games,
  1.03x on breakout/plunder. Kill unchanged (< +3% miner+maze). Cheapest
  lever per point; can go before or in parallel with E2.
- **E4 (refcount elision): real bucket, 6–20%.** Mostly `set_value` under
  put_loc and `JS_FreeValue` under drop/call. Only after E2 (needs the
  static stack); measured inside E2's tuned build.
- **Fields (not a round-6 lever): 22/15/9/15% on breakout/plunder/bigfish/
  coinrun, ~0 on the ProcGen grid games.** `find_own_property` is the
  hottest non-AOT frame on breakout (13.1%). Round 4 killed interpreter ICs
  at 0.87–0.945x; the emitter version (static per-site `{shape*, slot}`
  cache, atom a compile-time constant, no bytecode rewriting) is a different
  mechanism but attacks the same "1–2 probe hash walk" the autopsy said
  cannot be beaten. Recommend a **probe only** (~40 lines, untuned, 3
  games), kill < +3% on breakout; Ryan's call whether to spend the day.
- **E5 (NaN-boxing)**: untouched by this profile; boxing cost is inside "AOT
  residual" and cannot be separated at this granularity. Still last.

Order for the rest of the round, from this table: **E2 (with E1-lite folded
in) → E3 → E4 (inside E2's build) → field-IC probe if Ryan wants it → E5 →
E6 packaging + adv re-cut.** E6.2/E6.3 do not depend on any of this and can
run whenever the queue is free of bench jobs.

Artifacts: `out/libqjs_vec.{forkT2dbg,futT2dbg_<g>}.so`, `out/{objT2dbg,picT2dbg}/`,
`out/e0_44449147/`; scripts `e0_prof.sbatch`, `prof_buckets_aot.py`,
`e0_summary.py`; log `logs/e0_prof_44449147.out`. Commits 85d86c8, 42b2468.

### E3 — p5 intrinsics in the AOT emitter (built 2026-09-04 evening; probe job 44463225)

**Order change.** Written up as E2 → E3 in the E0 verdict above; executed E3
first. Reason from the E0 opcode table: on the draw-heavy games the hot
sequence is `get_var rect; <4 pushes>; call 4; drop` and the arguments must
land in memory anyway for `JS_CallInternal` to hand them to the C binding, so
operand-stack-to-locals (E2) cannot pay off on that code until the call
itself is direct. E3 is also the smaller build (one day, not weeks).

**Hypothesis (from E0).** Calls/globals family 7–22% of samples, call
machinery 2.6–8.7%, `js_call_c_function` innermost 2.2–5.4%, `JS_CallInternal`
innermost 1.5–2.9%; on maze/miner/heist `draw` is 39–52% of all samples and is
essentially rect/fill calls. Each p5 call today goes `call` body →
`JS_CallInternal` (tag/class dispatch through `rt->class_array[].call`) →
`js_call_c_function` (stack check, JSStackFrame push/pop, realm switch,
**alloca + copy to pad the arguments up to the declared length** — `rect` is
declared 5 and called with 4, `fill` 4 and called with 1–3, so nearly every
draw call pays the copy — then a `switch(cproto)`), result back through
`sf->ret_val` in memory. Expected: 1.06–1.12x on draw-heavy games, ~1.03x
on breakout/plunder; kill < +3% on miner+maze.

**What was built** (`native/aotfork/`, commits 34401f0 → 26c1ee2):

- `aot-intrinsics.patch` (on top of `qjsc-hostmode.patch`; applied by
  `build_fork.sh engine`): (1) `JSContext.aot_intr` + `JS_SetAOTIntrinsics()`
  — a per-context table of callee objects; (2) `qjsc -P <file>` loads
  `name min_argc` / `Obj.name min_argc` lines; (3) in `aot_compile()` a
  forward-dataflow pre-pass over the bytecode (stack depth is a bytecode
  invariant; candidate callee slots are joined by intersection at merge
  points) marks every `get_var <name> … call/callN` site and every
  `get_var <Obj>; get_field2 <name> … call_method` site whose argument count
  is ≥ `min_argc`; (4) at such a site the emitter puts a guarded fast path in
  front of the verbatim call body:
  `if (tag(f)==OBJECT && ctx->aot_intr && ptr(f)==ctx->aot_intr[k]) { r = aot_intr_<name>(ctx, this, argc, argv); free this/f/args; push r; } else <verbatim body>`.
  The `-A` output without `-P` is byte-identical to before.
- `aot_intr_list.h` (single source): 30 globals (rect, fill, stroke,
  background, noStroke, noFill, strokeWeight, ellipse, circle, arc, triangle,
  quad, line, rectMode, ellipseMode, push, pop, translate, rotate, scale,
  beginShape, vertex, endShape, keyIsDown, image, setTarget, clearTarget,
  textSize, textAlign, text) and 9 `Math.*` methods (floor, abs, ceil, sqrt,
  pow, sin, cos, atan2, hypot). `min_argc` = arguments the binding reads
  unconditionally; below it the generic path's undefined-padding is
  observable, so the fast path is not emitted. Not included: `Math.min/max`
  (`js_math_min_max`, internal, semantics not worth replicating),
  `Math.round/imul/random`, `color()/lerpColor()` (allocate), createCanvas.
- Both hosts (`qjs_host_fork.cpp`, `qjs_vec_host_fork.cpp`): one wrapper per
  entry, `extern "C" JSValue aot_intr_<name>(ctx, this, argc, argv) { return js_<name>(ctx, this, argc, argv); }`
  — **the same JSCFunction with the same arguments and the same `this`
  (undefined for `call`, the receiver for `call_method`)**, so behaviour is
  identical by construction; the only things skipped are dispatch, the C
  stack frame, the padding copy and the realm switch. `Math.floor/abs/ceil`
  are engine `f_f` builtins: the wrapper replicates `js_call_c_function`'s
  `f_f` case verbatim (`JS_ToFloat64(argv[0])` → exception, else
  `JS_NewFloat64(fn(d))`); `Math.sqrt/pow/sin/cos/atan2/hypot` are already the
  host's frozen-math bindings after the PRELUDE rebinds them, so their
  wrappers call `js_m_*` directly. After the prelude, each env captures the
  39 function objects (strong references, so the pointer the guard compares
  can never be reused while the env lives) and hands the table to the
  context; released before `JS_FreeContext`. A game that shadows `rect` or
  reassigns `Math.floor` simply fails the pointer guard and takes the generic
  body.
- `build_fork.sh`: `INTR=1` derives `out/aot_intr.txt` from the header,
  passes `-P`, and writes the emitted C to `out/aotI_<game>/` (the plain arms'
  `aot_<game>/game_aot.c` are untouched); `qjsc` is rebuilt whenever a patch
  is newer than the binary. `e3_probe.sbatch` (untuned probe, arms adv / fut /
  futT2 / futN / futI on 7 games + gate 33×3 + checksum24), `e3_tune24.sbatch`
  (tuned recipe, arms adv / futT2 / futIT2).

**Sites emitted (7 profiled games).** breakout 22 (rect 3, fill 4, Math.abs
3, sqrt 2, sin 2, cos 2 …), maze 22 (Math.floor 8, rect 3, fill 3), heist 28
(Math.floor 8, fill 6, rect 4, hypot 2), miner 35 (Math.floor 9, fill 9, rect
7), coinrun 43 (Math.floor 19, rect 7, fill 7), plunder 28, bigfish 15. Every
p5 call in every `draw`/`update` function of the seven is matched; the
remaining source occurrences are in setup/reset code.

**Local exactness (arm64 laptop, untuned, N = same patched engine without
-P):** `host_f1N` vs `host_f1I` traces byte-identical on breakout, maze,
heist, coinrun × seeds 1/42/777 × 3000 steps, no "Bytecode mismatch". Local
single-core `bench 1 30000` (not a measurement, just the sign): breakout
+8% with globals only → +19% with Math.*; maze +18%; heist +17%; coinrun
+15%.

**Probe (job 44468624, holy8a24304 genoa, NON-exclusive `-c 32` — no idle
genoa node all evening; same-job interleaved arms, 2 reps, 70/70 runs).**
Gate f0N + f1I: **198/198** (33 games × 3 seeds × 3000, no Bytecode mismatch).
Checksum24 futI vs stock ng: 24/24 identical; futN 7/7. Sites emitted on the
24 paper games: 15 (bigfish) … 52 (caveflyer), Math.* 1–20 per game.

    VEC 128x5, 1 worker (medians of 2)   adv      fut    futT2     futN     futI   I/N    I/fut  I/futT2  I/adv
    bigfish                           539772   546908   619601   543736   573930   1.056   1.049   0.926   1.063
    breakout                          189112   255718   289730   261875   311196   1.188   1.217   1.074   1.646
    maze                               81872   103384   118872   103889   147036   1.415   1.422   1.237   1.796
    miner                              50414    66730    77221    66123    84714   1.281   1.270   1.097   1.680
    plunder                           625166   703447   770286   706824   787668   1.114   1.120   1.023   1.260
    coinrun                            68034    97978   114146    96548   113772   1.178   1.161   0.997   1.672
    heist                             144160   185025   228254   180832   227288   1.257   1.228   0.996   1.577
    geomean-5                                                                      1.204   1.209   1.067   1.461
    geomean-7                                                                      1.208   1.205   1.046   1.506

    SINGLE-CORE bench 1 50k (medians of 5)   adv     f1T2      f1N      f1I   I/N     I/T2    I/adv
    bigfish                               146656   166450   143021   149904   1.048   0.901   1.022
    breakout                               41367    66782    59899    71489   1.193   1.070   1.728
    maze                                   17835    29291    24814    38792   1.563   1.324   2.175
    miner                                  11158    18575    16254    21091   1.298   1.135   1.890
    plunder                               157090   197055   179130   206163   1.151   1.046   1.312
    geomean-5                                                                 1.239   1.087   1.570

**E3 PROBE VERDICT: PROCEED.** futI/futN (same engine source, same flags,
only `-P` differs) = **1.204 geomean-5 vec, 1.239 single-core**; the §4
proceed gate is +5%. The E3 kill (< +3% on miner+maze) is cleared by 1.28×
and 1.42×. futN/fut = 0.99–1.02 on every game: the engine patch (context
field, no `-P`) is neutral, as it should be. The *untuned* lever already
beats the *banked tuned* build on the five profiled games (1.067) and ties
it on coinrun/heist; bigfish (41% rasterizer) is the one game where PGO
still matters more than the calls (0.926 untuned vs tuned). The gain is
larger than the E0-derived expectation (1.06–1.12 on draw-heavy games): the
per-call cost removed — JS_CallInternal dispatch, C stack frame, the alloca
padding copy, cproto switch, `sf->ret_val` round trip — was more than the
`js_call_c_function` innermost share suggested, because much of it had been
attributed to the `call*` opcode bodies ("AOT residual") and to
`JS_CallInternal` itself. Next: tuned build `e3_tune24.sbatch` (profile
re-collected on all 24 games with `-P`, arms adv / futT2 / futIT2, gate 33×3,
checksum24), then the banked run if ≥ +3% all-24 over futT2.

**Tuned build (job 44473809, holy8a24305 genoa, non-exclusive `-c 32`,
2026-09-04 18:57–19:43).** Recipe = l1_tune24 with `INTR=1`: instrumented
build → vec profile 30 s × 24 games (fork + fut) + single-core 5 → 58
profraws → `forkI24.profdata` → `-fprofile-use` + thin-LTO + hidden vis +
Rust-PGO rasterizer, TAG=IT2. Gate f0IT2 + f1IT2: **198/198**; checksum24
futIT2 vs stock ng **24/24**. A first attempt (44471503) lost 7/24
instrumented builds to a race on the intrinsics list file (parallel
`build_fork.sh` invocations rewrote it in place; a reader saw it truncated
and exited); fixed with an atomic write, and the job now fails hard on an
incomplete build or profile. Arms adv / futT2 / futI (untuned) / futIT2,
3 reps on the five profiled games, 2 on the other 19, 212/212 runs, no
failures. md5 futIT2_miner e9ce216e…, forkIT2 ea46589f…, host_f1IT2_miner bd934cf9….

    game                 adv    futT2     futI   futIT2  IT2/T2  IT2/I   IT2/adv  T2/adv  n
    bigfish           554137   627249   577477   668969   1.067   1.158   1.207   1.132  3
    maze               82133   119719   148018   188547   1.575   1.274   2.296   1.458  3
    miner              51584    77959    85750   106376   1.365   1.241   2.062   1.511  3
    plunder           628437   775788   796174   895961   1.155   1.125   1.426   1.234  3
    breakout          190149   292935   311814   366107   1.250   1.174   1.925   1.541  3
    bossfight         441872   598093   563319   656342   1.097   1.165   1.485   1.354  2
    caveflyer          79022   127948   131662   158532   1.239   1.204   2.006   1.619  2
    chaser             88382   123638   122012   143604   1.161   1.177   1.625   1.399  2
    climber            69764    83776    76142    87267   1.042   1.146   1.251   1.201  2
    coinrun            68488   114594   113324   131419   1.147   1.160   1.919   1.673  2
    dodgeball         103386   134659   134716   151216   1.123   1.122   1.463   1.302  2
    fruitbot           57612    73828    67334    79662   1.079   1.183   1.383   1.281  2
    heist             144562   228147   227521   328015   1.438   1.442   2.269   1.578  2
    jumper             96448   114652   105780   122964   1.072   1.162   1.275   1.189  2
    leaper            127173   170895   178587   172920   1.012   0.968   1.360   1.344  2
    ninja             539475   610053   572850   653385   1.071   1.141   1.211   1.131  2
    starpilot         338378   400782   417742   479396   1.196   1.148   1.417   1.184  2
    asteroids         331862   373182   342934   384673   1.031   1.122   1.159   1.125  2
    freeway           658533   741358   750260   868298   1.171   1.157   1.319   1.126  2
    frostbite         308502   315513   300836   360268   1.142   1.198   1.168   1.023  2
    pong             1383426  1663191  1570568  1799140   1.082   1.146   1.300   1.202  2
    qbert              67402    79588    76588    97452   1.224   1.272   1.446   1.181  2
    seaquest          537946   654780   653599   727959   1.112   1.114   1.353   1.217  2
    space_invaders    251357   344206   352851   389274   1.131   1.103   1.549   1.369  2
    geomean-five                                          1.270   1.193   1.734   1.365
    geomean-pg                                            1.169   1.172   1.565   1.339
    geomean-ale                                           1.141   1.160   1.385   1.214
    geomean-all                                           1.159   1.168   1.502   1.296

    SINGLE-CORE (qjs_host bench steps/s, medians of 7)
    game                adv     f1T2      f1I    f1IT2 f1IT2/f1T2  f1IT2/f1I  f1IT2/adv
    bigfish          146250   166057   148864   170582      1.027      1.146      1.166
    breakout          41360    67195    71645    81386      1.211      1.136      1.968
    maze              18084    29276    38762    47310      1.616      1.221      2.616
    miner             11149    18568    21490    27006      1.454      1.257      2.422
    plunder          156867   199681   205455   231003      1.157      1.124      1.473
    geomean-5                                               1.276      1.176      1.846

**E3 TUNED VERDICT: passes the bank gate by 5x.** futIT2/futT2 = **1.159
all-24 / 1.169 ProcGen16 / 1.141 ALE8** (bank threshold +3%); every game
≥ 1.01 (leaper 1.012, asteroids 1.031, climber 1.042; heist 1.438, maze
1.575, miner 1.365, breakout 1.250). Against adv: **1.502 all-24 / 1.565
PG16 / 1.385 ALE8**, 1.734 on the five. Single-core five: f1IT2/f1T2 1.276,
f1IT2/adv 1.846 (maze 2.62, miner 2.42). The futT2/adv column of this job
(1.296 all-24) reproduces the banked 1.297 to 0.1%, so the non-exclusive
node did not move ratios. PGO on top of the intrinsics is worth 1.168 (IT2/I),
about what PGO was worth before (futT2/fut 1.14): the two compose. Banked
run `e3_bank.sbatch` (16 workers × 128 × 5, 24 games × 3 trials, arms adv /
futT2 / futIT2, + panel C adv / f1T2 / f1IT2) submitted as job 44482682,
`--exclusive` because the topology needs the whole node.

What this implies for the rest of the round: E2 (stack → locals) is now
measured against futIT2, and the remaining `call`/`call_method` cost is
mostly JS→JS calls (game helper functions), which E3 does not touch. Fields
(breakout/plunder/bigfish/coinrun) and refcount are the next-largest
buckets; a futIT2 re-profile (E0 recipe, `TAG=IT2dbg`) should precede E2.

### E3 re-profile of futIT2 (job 44483163, holy8a24304, E0 recipe, `TAG=IT2dbg`)

Same 7 games, 60 s each, futIT2dbg vs the E0 futT2dbg build re-profiled on
the same node. Sanity: IT2 vs IT2dbg throughput within 1% (breakout 375.7k vs
379.7k, maze 196.6k vs 196.3k); no Bytecode mismatch. Reports:
`out/e3prof_44483163/`.

    futIT2dbg, % of .so samples   breakout   plunder   bigfish     miner      maze   coinrun     heist    (futT2dbg in brackets)
    AOT residual                      26.6      23.7      12.0      27.1      25.9      31.4      26.9    (32.8 30.7 14.3 31.1 35.1 34.5 34.0)
    call machinery                     1.1       2.1       1.4       3.3       0.7       2.2       1.2    ( 4.4  5.0  2.5  8.5  8.8  5.8  7.4)
    property access                   18.0      13.9       8.6       2.7       0.9      18.5       3.4
    refcount/free                     15.7      11.8       5.8      15.1      16.6      19.7      18.0
    arith slow paths                   7.3       2.9       2.7       1.4       0.0       2.3       6.1
    rasterizer                        11.8      13.7      42.6      27.0      38.8       9.5      24.5    ( 9.8 11.3 40.8 19.5 23.8  8.2 17.6)
    p5/host/blit                       5.5      10.7       8.4       5.0       8.3       3.3       7.9
    vec host spin                      5.5      10.6      11.3      12.1       6.5       5.8       3.5
    -- by opcode family
    fields                            28.6      16.3       9.4       1.1       0.8       6.7       2.6
    E2 stack/local                    17.1      10.8       6.7      18.6      23.3      26.1      22.8
    E3 calls/globals                   8.9      12.2       5.6      14.3      12.5      11.9      16.8
    E1 array element                   6.2       4.0       1.4       4.3       4.0       9.3       5.0
    E1 arith/compare                   2.9       4.7       1.6       9.0       8.6       6.1       5.4

What E3 did, in the profile: call machinery 4.4–8.8 → 0.7–3.3; the `call`
opcode's samples are now 63–79% *inside the p5 binding bodies* (LTO inlined
`js_rect` → `p5::rect` into the AOT function), so what is left of the
"calls" family is the argument pushes, the `get_var` of the callee (5–6.6%
on maze/heist: `*var_refs[idx]->pvalue` double indirection + TDZ test + dup
for every global read, constants included) and the arg frees. The
rasterizer share rose to 39% on maze and 27% on miner: on the grid games the
interpreter is no longer the majority of the frame.

Sizing what remains, for the next levers:
- **Fields** are now the largest single bucket on the object-heavy games:
  get_field alone 25.9% on breakout (find_own_property 57% of it),
  fields family 28.6 / 16.3 / 9.4 / 6.7 on breakout / plunder / bigfish /
  coinrun. The emitter-side per-site shape cache probe (Ryan's call, §7)
  has the strongest case in the round.
- **E2 stack/local 6.7–26%**, with `put_loc_check` 8.7–11.3% on the grid
  games (97–99% attributed to the `set_value` free of the overwritten local)
  and `get_loc_check` 2.4–4.6% (TDZ test). Locals in C registers with the
  TDZ tests proven away and numeric slots known non-refcounted is exactly
  this bucket; expectation for E2 stays 1.08–1.15× on maze/heist/coinrun/miner.
- **E4 refcount 6–20%** unchanged in share; composes with E2.
- **E1-lite** (f64/mixed compare fast paths) now has a case on breakout
  (arith slow paths 7.3%) and heist (6.1%); the other games are ≤ 2.9%.
- `lt`/`mul` on maze (4.1 / 2.9%, 100% inline fast path) are register
  pressure, not tag checks: E2, not E1.

### E3 BANKED (job 44482682, holy8a24303 genoa exclusive, 2026-09-04 19:50–20:11)

§4 banked protocol, identical to job 44439298 (L1): 16 workers × 128 envs ×
5 env threads, all 24 games, 300-step window (20 warmup), QJS_DIRTY=1 on
every arm, 3 interleaved trials, arms by explicit --lib-path: adv
(b3709b39, md5 verified) / futT2 (L1 banked) / futIT2 (E3, job 44473809
artifacts, futIT2_miner e9ce216e). 216/216 runs, 0 RUN_FAIL. Unpinned
(holy8a24303): ratios are same-job; absolutes are not 17402 numbers.

    game                  adv     futT2    futIT2  T2/adv  IT2/adv  IT2/T2  n
    bigfish           8592843   9620188  10149133   1.120   1.181   1.055  3
    bossfight         6874143   9352473  10150836   1.361   1.477   1.085  3
    caveflyer         1329046   2100473   2641730   1.580   1.988   1.258  3
    chaser            1406990   1970226   2289023   1.400   1.627   1.162  3
    climber           1116756   1341172   1407319   1.201   1.260   1.049  3
    coinrun           1100067   1840598   2094089   1.673   1.904   1.138  3
    dodgeball         1660628   2172634   2356194   1.308   1.419   1.084  3
    fruitbot           907197   1188420   1281947   1.310   1.413   1.079  3
    heist             2319552   3645741   5210379   1.572   2.246   1.429  3
    jumper            1530036   1825706   1994415   1.193   1.304   1.092  3
    leaper            2045144   2660079   2796512   1.301   1.367   1.051  3
    maze              1315277   1907241   3041822   1.450   2.313   1.595  3
    miner              822044   1246104   1707634   1.516   2.077   1.370  3
    ninja             8483058   9691437  10333358   1.142   1.218   1.066  3
    plunder           9919483  12194758  14014731   1.229   1.413   1.149  3
    starpilot         5361966   6528406   7401660   1.218   1.380   1.134  3
    asteroids         5257504   5932294   6142106   1.128   1.168   1.035  3
    breakout          3023877   4650294   5809382   1.538   1.921   1.249  3
    freeway          10275772  12328980  13679768   1.200   1.331   1.110  3
    frostbite         4902616   5243301   5732641   1.069   1.169   1.093  3
    pong             21657240  25422248  28010773   1.174   1.293   1.102  3
    qbert             1076382   1265341   1565284   1.176   1.454   1.237  3
    seaquest          8520323  10392433  11451595   1.220   1.344   1.102  3
    space_invaders    4000125   5412621   6196382   1.353   1.549   1.145  3
    geomean-pg                                      1.339   1.561   1.166
    geomean-ale                                     1.225   1.387   1.132
    geomean-all                                     1.300   1.500   1.154
    sum-of-medians adv        113498069
    sum-of-medians futT2      139933168
    sum-of-medians futIT2     157458713

    PANEL C single-core ProcGen16 (steps/s, medians of 3)
    game                 adv      f1T2     f1IT2    f1T2/adv   f1IT2/adv  f1IT2/f1T2
    bigfish           145975    163463    170223       1.120       1.166       1.041
    bossfight         105663    141367    156605       1.338       1.482       1.108
    caveflyer          19654     31299     38945       1.593       1.982       1.244
    chaser             17637     25663     30073       1.455       1.705       1.172
    climber            14824     18449     19010       1.245       1.282       1.030
    coinrun            12483     21138     24592       1.693       1.970       1.163
    dodgeball          23395     30028     34532       1.284       1.476       1.150
    fruitbot           13673     18075     19510       1.322       1.427       1.079
    heist              29567     47780     69812       1.616       2.361       1.461
    jumper             19661     23743     25904       1.208       1.318       1.091
    leaper             49086     63622     75285       1.296       1.534       1.183
    maze               18080     28853     47460       1.596       2.625       1.645
    miner              11197     18714     27235       1.671       2.432       1.455
    ninja             120294    138139    146874       1.148       1.221       1.063
    plunder           157341    200277    236885       1.273       1.506       1.183
    starpilot          74362     94015    105365       1.264       1.417       1.121
    geomean-PG16                                       1.370       1.629       1.189
    sum-of-medians adv            832892
    sum-of-medians f1T2          1064625
    sum-of-medians f1IT2         1228310

**E3 VERDICT: BANKED at 1.154x all-24 / 1.166x ProcGen16 / 1.132x ALE8
over futT2 (L1 banked), 1.189x panel C; every game ≥ 1.035; gate 198/198
× 3 seeds bit-exact; checksum24 identical to stock ng.** Bank threshold
(+3% all-24) cleared by 5x; tuned-vs-tuned, PGO re-collected. Same-job
L1 column reproduces 44439298 to 0.3% (1.300 vs 1.297). Cumulative engine
tier over adv, banked: **1.500x all-24 / 1.561x ProcGen16 / 1.387x ALE8,
panel C 1.629x** (maze 2.31/2.63, heist 2.25/2.36, miner 2.08/2.43,
caveflyer 1.99/1.98, breakout 1.92 vec). Paper effect if adopted (ratios
only; 17402 confirm needed for absolutes): Fig 4A ProcGen 1.64x → ~2.6x
tuned EnvPool, ALE ~15x → ~21x; panel C x1.63 over adv. Adoption remains
Ryan's decision (PLAN-engine-tier §7 #1, now with E3 folded in) — E3 is
inside the fork lineage, so it does not change that decision's shape, only
its size.

### E6.2 — TIER 2 BANKED (jobs 44492183 build+gate on holy8a24303, 44492184 bank on holy8a24307 genoa exclusive, 2026-09-04 20:20–20:57)

**Question.** What does a game with NO profile of its own get? Tier 2 = the
game's `qjsc -A` unit compiled without `-fprofile-use` (`build_fork.sh
UNIT_NOPGO=1`, only the two `game_aot.c` compiles lose the flag), linked
against the forkI24-PGO'd + thin-LTO'd engine objects and host, with E3
intrinsics. `TAG=IT2u`. Engine and interpreter host are byte-identical to
tier 3's (forkIT2u.so ea46589f = forkIT2.so; host_f0IT2u d7a92e74 =
host_f0IT2); only the per-game units differ (futIT2u_miner 8867caaf vs
futIT2_miner e9ce216e). Gate f0IT2u + f1IT2u **198/198**; checksum24 vs
stock ng **24/24**. Bank protocol as 44482682: 16 × 128 × 5, 24 games × 3
interleaved trials, arms adv / futIT2u / futIT2, 216/216, 0 RUN_FAIL; panel C
adv / f1IT2u / f1IT2 144/144.

    game                 adv   futIT2u    futIT2   IT2u/adv  IT2/adv  IT2u/IT2
    bigfish          8568793   9710269  10052389      1.133    1.173     0.966
    bossfight        6858383   8985593  10140513      1.310    1.479     0.886
    caveflyer        1329429   2429102   2640993      1.827    1.987     0.920
    chaser           1402927   2071945   2293479      1.477    1.635     0.903
    climber          1117239   1192884   1408360      1.068    1.261     0.847
    coinrun          1098057   1960344   2099366      1.785    1.912     0.934
    dodgeball        1658673   2272430   2431102      1.370    1.466     0.935
    fruitbot          924392   1168546   1280039      1.264    1.385     0.913
    heist            2314884   4251174   5190500      1.836    2.242     0.819
    jumper           1529617   1772388   1997517      1.159    1.306     0.887
    leaper           2036861   2994722   2920119      1.470    1.434     1.026
    maze             1312132   2809044   3041344      2.141    2.318     0.924
    miner             822238   1547551   1705975      1.882    2.075     0.907
    ninja            8465718   9358500  10254885      1.105    1.211     0.913
    plunder          9907315  13505290  14096619      1.363    1.423     0.958
    starpilot        5355533   7137341   7556067      1.333    1.411     0.945
    asteroids        5256607   5796110   6156082      1.103    1.171     0.942
    breakout         3018862   5328467   5812459      1.765    1.925     0.917
    freeway         10284309  12769878  13542485      1.242    1.317     0.943
    frostbite        4889205   5197055   5732500      1.063    1.172     0.907
    pong            21437199  25884956  27982161      1.207    1.305     0.925
    qbert            1077920   1310531   1558132      1.216    1.445     0.841
    seaquest         8492136  10985790  11433806      1.294    1.346     0.961
    space_invaders   3988163   5749892   6214123      1.442    1.558     0.925
    geomean-PG16                                      1.438    1.569     0.916
    geomean-ALE8                                      1.276    1.388     0.919
    geomean-24                                        1.382    1.506     0.917
    sum-of-medians adv      113146592   futIT2u 146189802   futIT2 157541015

    PANEL C single-core ProcGen16 (medians of 3): f1IT2u/adv 1.501, f1IT2/adv 1.619,
    f1IT2u/f1IT2 0.927 (maze 2.48/2.60, miner 2.17/2.38, heist 1.97/2.36, coinrun
    1.88/1.99, caveflyer 1.85/2.00; bigfish 1.11/1.16, climber 1.11/1.27).

**Read.** Tier 2 keeps 92% of tier 3 (all-24) and is **1.382× over adv**
banked; the futIT2 column reproduces 44482682 to 0.4% (1.506 vs 1.500).
The per-game PGO increment (IT2/IT2u) is 1.03–1.22: largest on heist 1.22,
qbert 1.19, climber 1.18, bossfight 1.13; leaper 0.97 (its profile hurts).
Sum-of-medians ratio 1.292 (vs 1.392 tier 3) → the paper's ProcGen16
aggregate projects to ~3.0M on 17402 for a game that has never been
profiled, ~3.35M once its own profile is in.

### E6.2 — HOLDOUT: the 9 never-profiled paper games (job 44493447, holy8a24303, non-exclusive -c 16, 2026-09-04 20:47–21:07)

Games: aim_trainer breakout.multi downwell_fresh flappy_bird flappy_bird.dunk2
frostbite.jungle jump_king qbert.v2 vvvvvv (the 33 in the engine tree's
`examples/games/js` minus the 24; aim_trainer and the current flappy_bird /
qbert.v2 differ from or are absent in the live tree, so build AND bench use
the engine tree's dir — the AOT unit embeds the source FNV). Per game: tier 2
as above, and **tier 3 exactly as compile-at-load will do it**: instrumented
unit (TAG=Igen, the e3_tune24 instrumented engine), 30 s random-play vec run
on THAT game only, its profraw merged INTO a copy of forkI24.profdata, engine
PIC objects + unit rebuilt with the merged profile (TAG=IT3h_<g>). 56–69 s
per game end to end, 9/9 both tiers. Exactness: vec obs checksum 2000 × 32
envs vs stock ng, tier 2 and tier 3, **9/9 identical** (aim_trainer ran fine
under the keyboard bench). Bench 1 worker × 128 × 5, 3 interleaved reps.

    game                     adv     tier2     tier3   tier2/adv   tier3/adv  tier3/tier2
    aim_trainer          1280248   1456003   1517102       1.137       1.185       1.042
    breakout.multi         48149     90686    100922       1.883       2.096       1.113
    downwell_fresh        273572    309466    347347       1.131       1.270       1.122
    flappy_bird          1334644   1498108   1625554       1.122       1.218       1.085
    flappy_bird.dunk2     950708   1119944   1142865       1.178       1.202       1.020
    frostbite.jungle       25194     26330     27839       1.045       1.105       1.057
    jump_king             161061    174984    206569       1.086       1.283       1.181
    qbert.v2                2378      2572      3029       1.082       1.274       1.178
    vvvvvv                461889    559243    596792       1.211       1.292       1.067
    geomean-9                                              1.189       1.302       1.095

**Read.** The PGO increment transfers exactly: tier3/tier2 **1.095** on the
9 vs 1.091 (1/0.917) on the 24, per-game 1.02–1.18 vs 1.03–1.22. The
absolute engine gain is smaller on this set (tier 2 1.19 vs 1.38, tier 3
1.30 vs 1.51) — outside the ~5% pass band set in §6.2 of the adoption
handoff. The gap is the game mix, not the tier: the three fast games
(aim_trainer, flappy_bird ×2, ~1.0–1.3M steps/s at one worker) land at
1.12–1.18, exactly where the 24's fast, host-bound games sit (bigfish 1.13,
ninja 1.11, asteroids 1.10, frostbite 1.06); the two very slow games
(qbert.v2 2.4k steps/s, frostbite.jungle 25k) are rasterizer-bound and no
engine tier can move them much (1.05–1.08); breakout.multi behaves like
breakout (1.88 vs 1.77). No holdout game is slower on any tier. What the
paper may say: a brand-new game gets tier 2 at once and tier 3 ~1 min later,
bit-exact, with the same PGO increment as the paper games; the engine-tier
gain depends on the game's engine share, from ~1.05 (rasterizer-bound) to
~2.1 (engine-bound), 1.19/1.30 geomean on the 9 held-out paper games.
Unproven: the engine-share explanation for the gap (an E0-style profile of
frostbite.jungle / qbert.v2 would settle it; not run).

### E6.1 — compile-at-load (branch `engine-tier`, commits c778c3d, cd1bf7f; tested jobs 44494099, 44494912)

`src/playtrain/runtime/aot_cache.py` + the three `NativeVecEnv` constructors:
no explicit `lib_path` → `resolve_lib(game)`: stock ng .so when no toolchain
(laptop, live tree — behaviour unchanged) or `PLAYTRAIN_AOT=off`; else tier 1
(`libqjs_vec.forkIT2.so`) at once, tier 2 / tier 3 from the cache when built,
otherwise a detached builder writes them (pid-stamped lock, FAILED marker,
1 h retry). Key = sha256 of game source + qjsc + prelude + intrinsics list +
host/p5 sources + build script + engine archive + profile + rasterizer +
clang version. Tests `tests/test_aot_cache.py` 5/5 on the cluster (tier-2
build + 200-step checksum vs tier 1 in 22 s). Rehearsal (coinrun, holy8a28510,
8 cores shared): first construction → tier 1, builder in the background,
tier2.so after 25 s, tier3.so after 105 s; second construction → tier3.so;
91k / 127k / 135k steps/s tier 1/2/3 on the same core budget. Slurm note: the
builder is inside the job's cgroup, so it dies with the job (a 6-second test
script killed it; a training job does not) and the stale lock is detected by
pid. Cluster cache: `PLAYTRAIN_AOT_CACHE=$BASE/aot-cache`,
`PLAYTRAIN_AOT_FORK_OUT=$WE/native/aotfork/out`.

### ROUND 6 summary table (lever × geomean-5 vec × all-24 vec × panel-C PG16 × gate)

    lever                                         geo-5 vec   all-24 vec       panel-C PG16   gate
    E0 profile futT2 (job 44449147)               —           —                —              —       (AOT residual 30–35, refcount 6–20, fields 22/15/9, calls 7–22, arith 1.5–6)
    E1 type-feedback specialization               KILLED pre-build: ceiling ≈ 2% (slow-path bucket); survives as E1-lite (f64 compares), unbuilt
    E3 p5+Math intrinsics, untuned (futI/futN)    1.204       (7 games 1.208)  1.239 (5, sc)  198/198 (job 44468624)
    E3 tuned (futIT2/futT2)                       1.270       1.159            1.276 (5, sc)  198/198 (job 44473809)
    E3 BANKED (futIT2/futT2)                      —           1.154 (bank)     1.189          —       (job 44482682)
    E3 BANKED vs adv (futIT2/adv)                 —           1.500 (bank)     1.629          —
    E2 operand stack → locals                     not run (next; re-profile 44483163 sizes it at 7–26% + put_loc_check 9–11%)
    E4 refcount elision                           not run (inside E2)
    E5 NaN-boxing                                 not run
    E6.2 TIER 2 BANKED (futIT2u/adv)              —           1.382 (bank)     1.501          198/198 (jobs 44492183/44492184; IT2u/IT2 0.917)
    E6.2 HOLDOUT 9 never-profiled (tier2 / tier3) —           1.189 / 1.302 (1 worker, 9 games)  —   checksum 9/9 (job 44493447; tier3/tier2 1.095)
    E6.1 compile-at-load (aot_cache.py)           built, tested 5/5, rehearsed (tier 2 in 25 s, tier 3 in 105 s); stock behaviour unchanged without the toolchain
    adv re-cut with ef74835 (adv2)                job 44498267 submitted 2026-09-04 ~21:30 on holy8a28510 (gate + checksum + null A/B); result not yet in these notes
    field IC probe (not a §5 lever)               not run; fields = 28.6% of breakout after E3 — strongest probe case in the round; Ryan's call

Decision list for Ryan (adds to PLAN-engine-tier-round6 §7): (1) adopt the
fork with E3 (1.50x all-24 over adv, bit-exact, 39 intrinsic names, one
patch on the pinned fork + 2 host wrappers per host)? (2) spend a day on
the field-IC probe (breakout/plunder/bigfish/coinrun are the only games it
touches)? (3) framing: E3 is "the compiler knows the p5 API" — is that
still "plain JS that runs fast"? (It is exact and guarded, and a game that
shadows a p5 name simply runs the generic path.)
