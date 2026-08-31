# Plan: native-layer tuning of the PlayTrain env step

Brief for a dedicated agent, written 2026-08-31. Execute in a **worktree on a
separate branch**; the live tree and the live `.so` must not change (§3.2).
Read `handoff/HANDOFF-2026-08-25-1901.md` §7 and `handoff/ladder_notes.md`
("Failure / hazard log") for cluster conventions before running anything.

## 0. Objective

Make PlayTrain's environment stepping measurably faster through changes that
preserve bit-exact determinism, so the paper's ProcGen throughput comparison
holds up against a fully tuned EnvPool. Anchor numbers, all on
`holygpu8a17402` at 80 env threads, geomean over the 16 shared ProcGen games:

- PlayTrain, published (sync, unbound, untuned): **1.78M env-steps/s**
- EnvPool, published arm (sync single pool):      0.44M
- EnvPool, tuned (async + NUMA-sharded, excluding its one broken shard): **~1.65M**

Target: **>= 2x tuned EnvPool (~3.3M)** is the stretch goal; **~1.4-1.5x
(~2.3-2.6M) is the realistic ceiling of this plan's levers** and is worth
shipping on its own. Do not manufacture a win: if a lever gates out or
underperforms, report the measured number.

## 1. Ground truth: the component profile (2026-08-31, job 43260288)

Percent of CPU cycles, 60 s per game, one process, 128 envs x 5 threads,
genoa CPU node, the live instrumented `.so`
(md5 `8b539667dcead5513afe365b766f9e92`):

| game     | steps/s | interp | raster | obs_blit | p5_bind | math | gc  | alloc | sched |
|----------|---------|--------|--------|----------|---------|------|-----|-------|-------|
| plunder  | 432k    | 38.3   | 10.7   | **25.2** | 5.2     | 2.6  | 0.2 | 0.9   | 7.2   |
| bigfish  | 334k    | 20.4   | **33.7**| 19.8    | 2.4     | 3.7  | 0.0 | 4.2   | 7.8   |
| breakout | 169k    | **65.2**| 8.0   | 10.2     | 6.4     | 2.7  | 0.1 | 0.6   | 4.3   |
| maze     | 61k     | 51.0   | 16.6   | 3.6      | 13.3    | 5.6  | 0.0 | 0.1   | 8.2   |
| miner    | 32k     | 44.9   | 23.6   | 1.9      | 8.7     | 5.1  | 0.0 | 3.8   | 6.4   |

- `interp` = `JS_CallInternal` + property/conversion helpers. The dominant
  bucket everywhere. Levers: PGO/LTO/(BOLT), later the QuickJS-NG bump.
- `raster` = `rs_*` + Rust rasterizer symbols (span, fill_subpaths,
  ellipse_path). Bigger than the paper's per-pixel story suggested; the cost
  is path setup and span walking, not filled pixels.
- `obs_blit` = `p5::render_obs_rgb` alone — a scalar RGBA->RGB loop.
- **GC is ~0% and alloc <= 4.2%: the GC-threshold and jemalloc levers are
  dead. Do not implement them.**

Raw per-game symbol tables: cluster
`playtrain-trainers/outputs/prof_{game}_43260288.txt`. To re-profile any
build: `benchmarks/pt_prof2.sbatch` (LD_PRELOAD SIGPROF sampler
`benchmarks/prof_preload.so`, source `prof_preload.c`, symbolizer
`prof_symbolize.py`). FASRC has **no** perf/gperftools; this sampler is the
only profiler that works there, and it samples native pthreads correctly.

## 2. Repo and cluster map

Local: `/Users/heyodogo/code/lab/playtrain/playtrain` (this repo, private) and
`playtrain-trainers` (benchmarks). Cluster (reach via the `fasrc` zsh function,
NEVER plain ssh; auth is automated, ~20 s silent on first call):

    /n/holylabs/gershman_lab/Users/rtruong/playtrain            game repo clone
    /n/holylabs/gershman_lab/Users/rtruong/playtrain-trainers   benchmarks, sbatch files
    /n/holylabs/gershman_lab/Users/rtruong/analogen-jaxbench    .venv used by everything

Key files:

- `native/build_qjs_vec.sh` — builds `native/build/libqjs_vec.so`.
  Host C++: `-std=c++17 -O3 -ffp-contract=off -fno-fast-math -fPIC`.
  Engine C (per-file .o): `-O3 -march=x86-64-v3 -ffp-contract=off -DNDEBUG`.
  frozenmath: `-O2`, `-Dsin=fm_sin` etc.
- `native/qjs/qjs_vec_host.cpp` — vec host (spin barrier, MPMC queue, workers).
- `native/runtime/p5.cpp:202` — `render_obs_rgb`, the scalar blit (lever 1).
- `crates/rasterizer/` — Rust rasterizer. `[profile.release]` already has
  `opt-level=3, lto=true, codegen-units=1, panic=abort`. **No target-cpu.**
  Built via `cargo rustc --release --lib --crate-type staticlib` inside
  `build_qjs_vec.sh` (only if the .a is missing — delete it to force rebuild).
- `native/qjs/src/` — vendored QuickJS-NG **0.15.1** (`QJS_VERSION_*` in
  `quickjs.h:1433`).
- `native/gate_qjs.sh` — determinism gate. Read it before first build.
- `src/playtrain/runtime/native_vec_env.py` — `_ROOT = Path(__file__).parents[3]`
  resolves the `.so` relative to the source tree, which is what makes the
  worktree pattern work: putting a worktree's `src` first on PYTHONPATH selects
  that worktree's `native/build/libqjs_vec.so`. Proven in the ladder forensics
  (`playtrain-wt-8e38a6e`).

## 3. Hard constraints

### 3.1 Determinism is a paper claim

"The same actions produce identical frames on any machine." Every change must
pass, in this order:

1. `native/gate_qjs.sh` (read it; run it as-is).
2. The obs-checksum A/B: 50+ steps of a fixed seed/action sequence on
   `breakout`, `miner`, `maze`; the observation byte stream must be identical
   between the live `.so` and the tuned `.so`. (Method precedent: ladder_notes,
   "Isolation experiment" — the rebuilt-8e38a6e binary was accepted only after
   an obs-checksum match.)
3. Keep `-ffp-contract=off -fno-fast-math` on every C/C++ compile, including
   under PGO. Never add `-ffast-math` or allow FMA contraction. Rust: default
   fp behavior already forbids contraction; do not add `-Ffast-math`-style
   flags there either.

### 3.2 Worktree isolation — the live `.so` is load-bearing

Queued jobs pinned to `holygpu8a17402` (`43241140` pt_numa, `43244696`
ep_numa_sweep, `43246914` ep_sync_sharded) load
`rtruong/playtrain/native/build/libqjs_vec.so` **at start time** and their
results are only comparable to published numbers if that binary is unchanged.

- Create `git worktree add ../playtrain-wt-tuning -b native-tuning` (locally
  and/or on the cluster clone; the cluster worktree is where builds happen).
- Build only inside the worktree. All benchmark invocations select it via
  `PYTHONPATH=<worktree>/src:...`.
- Print and check `md5sum` of the loaded `.so` in every job banner (the
  `pt_numa`/`ladder_oldhost` sbatch files show the pattern).
- The cluster playtrain clone has uncommitted local state; leave it untouched.
  Adding a worktree does not disturb it (verified 2026-08-27).

### 3.3 Cluster hazards (all previously observed — do not rediscover)

- NEVER `uv sync` against `analogen-jaxbench/.venv` (hand-installed envpool +
  PyQt5 die silently). Additive `uv pip install --python .venv/bin/python X`
  is fine.
- `sbatch --export=ALL,VAR=a,b,c` splits on commas; export vars in the shell.
- Kempner nodes differ up to 1.56x in clock, and the dbuf ratio itself proved
  node-dependent (1.325x on 15203 vs 1.038x on 17402, same binaries). **Every
  A/B lands both arms in ONE job on ONE node.** Iterate on
  `serial_requeue -C genoa --exclusive` (fast queue, ~192-core nodes); the
  final paper-grade confirm on 17402 happens later and is not this plan's
  gating step.
- A 92-core request on a 192-core node lands asymmetrically across NUMA
  domains and oversubscribes spin threads; use `--exclusive` (see the guard in
  `benchmarks/pt_numa_excl.sbatch`).
- The vec host spins; more threads than allowed cores collapses throughput
  ~70x (`qjs_vec_host.cpp:184`).
- Env-only runs need no GPUs; requesting them triggers idle-GPU emails.
- The cluster clone of analogen-jaxbench is behind its own remote; commits
  land locally, pushes are rejected. Do not force.

## 4. Levers, ranked by measured ceiling

### Lever 1 — SIMD the obs blit (`p5.cpp:202`). Do this first.

Current code: scalar loop copying RGBA to RGB (`out[d]=px[s]; ...`), 12,288
bytes out per env per observation. Costs 25.2% (plunder), 19.8% (bigfish),
10.2% (breakout) of all cycles.

- Implement an SSSE3/AVX2 `pshufb`-based RGBA->RGB pack (e.g., load 32 bytes
  = 8 pixels, shuffle to 24 bytes, store; handle the tail scalar). Guard with
  `#ifdef __AVX2__` + scalar fallback so the wasm/portable builds still
  compile; the native build already targets x86-64-v3, which includes AVX2.
- Optional second step, measure separately: non-temporal stores
  (`_mm256_stream_si256`) for the output — frames are written once and never
  read by this CPU again, so bypassing cache stops ~12 GB/s of obs writes from
  evicting JS heaps. NT stores need 32-byte-aligned destinations; the obs
  buffer slot alignment must be checked first (it comes from the trainer's
  shared buffer; in `bench_vec_rollout` from numpy — check `ctypes` pointer
  alignment and fall back to normal stores if unaligned).
- Correctness is trivial: pure byte reorder, so the obs-checksum gate must
  pass **exactly**. If it does not, the kernel is wrong.
- Expected: kernel 4x+, overall +6-10% geomean (more on plunder/bigfish).

### Lever 2 — rasterizer `target-cpu`. One flag.

`crates/rasterizer` builds for generic x86-64. Add
`RUSTFLAGS="-C target-cpu=x86-64-v3"` to the `cargo rustc` invocation in
`build_qjs_vec.sh` (matching the engine's `-march=x86-64-v3`, portable across
the Sapphire Rapids and Genoa nodes used in the paper). The paper states the
rasterizer is integer-only, so vectorization cannot change results — but the
gate still runs. Expected: +2-6% overall (raster bucket is 8-34%).

### Lever 3 — PGO + LTO on the whole `.so`. The big one.

Targets the 20-65% `interp` bucket; interpreters are the canonical PGO winner
(indirect-branch and hot/cold layout). Pipeline:

1. Check tooling on the login node: `clang --version`, `command -v
   llvm-profdata llvm-bolt`. System clang exists (`/usr/bin/clang`, EL8). If
   `llvm-profdata` is missing, check `module avail llvm`/`gcc`; gcc PGO
   (`-fprofile-generate`/`-fprofile-use` + `gcov`) is the fallback. If neither
   toolchain can complete the loop, report and stop this lever.
2. Instrumented build: add `-fprofile-generate=<dir>` to BOTH the engine
   per-file compiles and the host CXXFLAGS in a worktree copy of
   `build_qjs_vec.sh`. Keep all determinism flags.
3. Profile workload: run the 5 profiled games plus 3 more (chaser, dodgeball,
   coinrun) ~30 s each through `bench_vec_rollout` (1 worker is fine) with the
   instrumented `.so`. Instrumented runs are slow; that is expected.
4. `llvm-profdata merge` -> rebuild with `-fprofile-use=<merged>` + LTO
   (`-flto` on host and engine, link with clang). If LTO breaks the build
   (staticlib interactions with the Rust `.a`), ship PGO without LTO and note
   it.
5. BOLT only if `llvm-bolt` exists: `perf` is unavailable, so BOLT would need
   instrumentation mode (`llvm-bolt -instrument`); treat as optional garnish.
6. Gate (3.1), then A/B.

Expected: +8-18% overall. Also worth reporting per-bucket: rerun the SIGPROF
profiler on the PGO build to show where the cycles went.

### Lever 4 (gated, only after 1-3 are banked) — QuickJS-NG bump 0.15.1 -> current

- FIRST audit local modifications: `git log --oneline -- native/qjs/src` and
  diff the vendored tree against upstream v0.15.1. The frozenmath integration
  (`-Dsin=fm_sin` at compile time) is external to the engine source, but there
  may be in-tree patches; every one must be ported or consciously dropped.
- Bump in the worktree, rebuild, run the FULL gate plus a longer replay
  (2,000-step obs checksum on all 24 games — engine bumps can change
  evaluation order in ways short probes miss).
- Any checksum mismatch = stop and report which game/step diverged. A
  divergent engine bump is a paper-invalidating change, not a tuning knob.
- Expected if it gates through: +5-15% on the interp bucket.

### Explicitly dead / deferred — do not spend time on these

- GC threshold (`JS_SetGCThreshold`): measured 0.0-0.2%. Dead.
- jemalloc / allocator swaps: measured 0.6-4.2%. Dead.
- NUMA binding of workers: measured ~1.0x (process isolation already achieves
  locality). Dead for throughput; docs-only.
- p5 command buffer (batch draw calls through a typed array): ceiling is the
  2-13% p5_bind bucket plus some interp share; real but days of work.
  DEFERRED — describe in the notes, do not implement.
- Async/partial-batch stepping: architecture change, breaks the rollout
  contract. Out of scope permanently for this plan.

## 5. Measurement protocol

- Bench: `playtrain-trainers/benchmarks/bench_vec_rollout.py --no-model
  --frame-skip 1 --steps 300 --max-steps 2000 --envs 128 --env-threads 5`.
- Iteration A/Bs: 1 worker, the 5 profiled games, on `serial_requeue -C genoa
  --exclusive`, both binaries (live-copy vs tuned) in the same job,
  interleaved A,B,A,B (2 reps each) to defeat drift. Report per-game ratio +
  geomean.
- Banked-lever full run: 16 workers x 128 envs x 5 threads (the published
  topology), all 16 ProcGen + 8 ALE games, same-job A/B, one rep per game with
  the 300-step window x 3 trials. This is the number that goes in the report.
- Every job banner prints: node, `uname -r`, md5 of BOTH `.so` files, and the
  resolved `playtrain.__file__` (worktree check).
- Levers are measured INDIVIDUALLY first (each vs live), then STACKED
  (1+2+3 vs live). Interactions matter; do not assume multiplicativity.

## 6. Stopping rules

- A lever that fails its gate twice -> drop it, write down why, move on.
- If stacked gain < 1.10x geomean, the tuning story is not worth paper space;
  report and stop rather than reaching for riskier levers.
- Do not touch: game .js files, obs format, frame_skip/max_steps semantics,
  the trainer, anything under `src/playtrain/gen`.
- Never push to `main`; everything stays on the `native-tuning` branch. Commit
  style: one short phrase, no Claude/Anthropic attribution (repo rule).

## 7. Deliverables

1. Branch `native-tuning` with the changes, each lever a separate commit.
2. `handoff/tuning_notes.md` (ladder_notes style, running log): every build,
   gate result, A/B JSON path, failure, and dead end.
3. Per-lever and stacked A/B results: `outputs/tune_ab_*.json` on the cluster
   + geomean table in the notes.
4. A re-profile (SIGPROF sampler) of the final stacked build, same 5 games —
   shows the new cost structure and what to attack next.
5. An explicit recommendation with numbers, and the two decisions that are
   NOT the agent's to make, flagged for the user:
   a. adoption (a faster binary invalidates EVERY published PlayTrain number —
      Fig 4A, Table 1, per-core panels, Table 8 — and triggers a ~1-day
      re-measurement cascade);
   b. build policy for the paper (portable x86-64-v3 "shipped" build vs tuned
      benchmark build; if they differ, the paper must say which one every
      number comes from).

## 8. Sequencing with in-flight work

Do not cancel or race: `43241140` / `43244696` / `43246914` (pinned 17402
chain), and read—but do not rerun—`43243581` (topology sweep), `43246912`
(sync16 control), `43241139` (pt_numa CPU) whose results may already answer
the "sched" bucket. The final 17402 confirmation of the tuned build should be
submitted only AFTER the pinned chain drains, and only for the stacked
winner.
