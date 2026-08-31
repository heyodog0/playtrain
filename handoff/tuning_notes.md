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

## A/B jobs

- Iteration A/B #1: job **43268228** (tune_ab.sbatch, serial_requeue -C genoa
  --exclusive): live/base/l1/l2/l12 x 5 games x 2 reps, interleaved
  A,B,C,D,E per rep, bench_vec_rollout --no-model 128 envs x 5 threads x 1
  worker, 300-step window. Output outputs/tune_ab_43268228/.

## Pending / next

- Lever 3: instrumented builds (base-state and tip-state), profile workload
  8 games x 30 s, llvm-profdata merge, use-mode rebuild (+thin-LTO if lld
  links; else PGO-only), checksum+gate, second A/B (pgo, l12pgo).
- Lever 4 (NG bump): GATED behind 1-3; vendored-tree diff audit first.
- llvm-bolt: absent on FASRC — BOLT dropped (plan already treated as garnish).
