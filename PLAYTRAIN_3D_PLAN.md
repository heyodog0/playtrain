# Plan: the 3D (Three.js) extension

Working document, 2026-08-22. Everything in "What already exists" was verified by
reading git history — none of it is speculation. Recovery points are pinned by
tags that exist in this clone: `threejs-archive` (= `44268c8`, the last tree with
`runtime/three/`), `pre-lean-refactor-2026-07-19`, `pre-lean-full-tree`.
**Do not GC-prune this repo before extracting what's needed.**

## Goal

Two distinct deliverables — decide which before starting:

1. **Appendix stub** (paper-scoped): demonstrate the PlayTrain pipeline
   (LLM authors one-file game against a template → automated 5-check validation
   → headless Gymnasium env → unmodified trainer) is *renderer-agnostic* by
   showing it running on Three.js 3D games, with a trained agent and honest
   scoping of what does not transfer (bit-exactness across machines, envpool
   throughput).
2. **PlayTrain-3D** (post-paper): a 3D runtime with the same pillars as 2D —
   deterministic software rasterization, native vectorization, human-play
   identity. Not this cycle; the stub should be built so it feeds this.

## What already exists (in git history)

The 3D path was fully built and then removed **for repo leanness, not because it
failed** (`293a751` "Focus the repo solely on the p5.js 2D pipeline",
`ec89afa` "remove Three.js entirely" — both 2026-07-19, both note recoverability).

| Piece | Where | State when removed |
|---|---|---|
| Headless runtime: WebGPU/Dawn shim, `ThreeGameEnv`, IPC worker | `threejs-archive:runtime/three/{shims,game-env,game-worker}.mjs` | Working; same binary IPC protocol as the p5 worker (env.py still speaks it), mmap obs (`cf537fa`, ~16% speedup) |
| Python env `NodeGymThreeEnv` → `three.py` | `threejs-archive:src/playtrain/runtime/three.py` (379 lines) | Working, Discrete(15), 64×64×3 |
| Template contract | `THREE_GAME_TEMPLATE.md` + `THREE_COMPLEX_TEMPLATE.md` at `293a751^` | v2 spec: `setup({THREE,renderer})` / `update(dt)` / `render()` / `resetGame(seed)` / `getGameState()`, fixed dt=1/60, mulberry32 seeding, per-seed level variation REQUIRED, byte-identical two-run pixel determinism REQUIRED |
| 16 generated games | `threejs-archive:examples/games/threejs/` (mario_64, zelda_dungeon, temple_run, metroid_prime, …) | **16/16 passed all five validation checks** (historical README at `ff78d48`) |
| Generation pipeline | `gen-three`, engine mode, complex tier, `tester-three` browser harness with refiner parity (recipes at `293a751^`) | Working |
| Validation + bench | `tools/validate_three.py`, `three_fps_bench` | Working; 5 checks mirror p5 |
| Vec renderer (atlas) | `threejs-archive:runtime/three/vec-game-env.mjs` | Prototype: N scenes → tiles of one atlas texture, ONE readback amortizes the ~0.21 ms GPU map-stall; NOTE it used per-env `Float32Array(7)` action vectors — a different (richer) action contract than the single-env Discrete(15) |
| **CPU software rasterizer** | `threejs-archive:runtime/three/three-cpu-fast*.mjs` | Prototype: three.js builds scene/camera; static meshes baked to world-space tri buffer once; per-frame transform with three's real matrices, near-clip, tight monomorphic rasterizer; vertex colours + repeating textures, no lighting (baked). Deopt-tuned (`3eb21fd`) |

### Measured throughput (M4 Pro, historical)

- Dawn/WebGPU single env, 84×84, full RL step incl. readback: **median ~1700 FPS**
  (916 bomberman_3d – 2733 stack_drop; complex tier 1000–1500) (`a992905`).
- For scale: today's 2D QuickJS single-env is ~200k steps/s and the 8-env vec
  host ~425k — the 3D path is ~100× off the 2D headline. Fine for a stub;
  the atlas vec (or the CPU rasterizer) is the path to training scale.

## Which pillars transfer, honestly

| Pillar | 2D today | 3D stub (Dawn) | Notes |
|---|---|---|---|
| LLM generation, $/game, 1-file contract | yes | **yes** — 16-game existence proof; LLM-writes-great-three.js is the strongest public prior | template v2 already tuned over many commits |
| Automated validation | 5 checks | **yes** — validate_three existed, 16/16 | determinism check ran byte-identical *same-machine* |
| Seed determinism (logic) | yes | **yes** — fixed dt, seeded RNG | |
| Pixel bit-exactness *across engines/machines* | yes (frozen fdlibm, custom rasterizer) | **no** — GPU readback; same-machine only | this is what three-cpu-fast eventually fixes |
| Envpool-class throughput | ~425k steps/s | **no** — ~1.7k/env; atlas vec amortizes readback but unmeasured at scale | stub trains one agent anyway (PPO tolerates ~10k sps with N workers) |
| Human plays the agent's exact code | yes | **near** — same file runs in browser WebGPU; pixels not bit-identical to Dawn | replay-verified scoring still works at the logic level (score/gameState) |
| Trainer unchanged | proved this week | **yes** — Discrete(15) is just a bigger n; `_infer_action_space` handles it | register `procgen15` in `runtime/action_spaces.json` naming only (3D reads `currentAction` directly; no key plumbing needed) |

## Architecture decision (the real fork in the road)

- **Route A — revive Dawn/WebGPU** for the stub. Cheapest path to a running
  demo; everything exists. Risks: does `three`+`webgpu` still install on
  current Node/macOS (there was a WGSL codegen pin, `ffdcc7b`); does Dawn run
  headless on FASRC CPU nodes (likely needs SwiftShader-Vulkan — verify early;
  if not, train the stub agent locally on M-series, which is where the numbers
  were measured anyway).
- **Route B — three-cpu-fast** is the *strategic* one: it is to 3D what the
  QuickJS+Rust rasterizer was to 2D, and the repo already followed exactly that
  playbook once (Node/canvas → native). Deterministic (single JS engine),
  no GPU dependency, cluster-friendly, portable later into the Rust crate.
  Unknowns: throughput (unmeasured), feature coverage (no lighting — games must
  bake shading into vertex colours; the 16 games were not authored under that
  constraint).
- **Recommendation**: A for the appendix stub now; B as the opening task of
  PlayTrain-3D, with the stub's appendix text explicitly framing it
  ("the 2D path's native-rasterizer trajectory applies; a CPU rasterizer
  prototype exists").

## Tasks (stub scope, in order)

1. **Extract, don't revive in place.** `git checkout threejs-archive -- runtime/three src/playtrain/runtime/three.py tools/validate_three.py examples/games/threejs` and templates from `293a751^`, onto a `three-stub` branch. First commit = verbatim restore, so later diffs show exactly what the revival changed.
2. **Dependency check before anything else**: `three`/`webgpu` (Dawn) on current Node; re-pin versions from historical `package.json` if the WGSL bug persists. If Dawn no longer installs cleanly, stop and reassess (Route B or headless-gl/WebGL fallback) before sinking time.
3. Rebrand/API alignment: `ThreeGameEnv` → current package layout; register the Discrete(15) table as a named space; `action_space=` param for symmetry with this week's work (3D games read `globalThis.currentAction`, so no key-code plumbing).
4. Re-run `validate_three` on all 16 games; expect breakage from three.js version drift — fix or drop games, record the pass count honestly.
5. Train PPO (`train_ppo_clean` accepts any Discrete(n)) on 1–2 games with clear learnable signal (crossy_road_3d, runner_3d) to non-trivial score vs random. Local M-series is acceptable for the stub; note it.
6. Appendix artifacts: generation cost/time for one fresh 3D game (proves the pipeline end-to-end today, not just historically), screenshot strip, learning curve, limitations paragraph (pixel determinism scope, throughput, human-identity nuance).
7. (Stretch) bench the atlas vec path and three-cpu-fast on one game — one number each changes the future-work section from hand-waving to data.

## Verification

- All restored games boot headlessly and the 5-check suite reports a real pass count.
- Determinism check passes at tolerance 0 same-machine (the historical bar).
- Trained agent beats random with a reproducible seed/config.
- Nothing in the 2D path changes: full 2D test suite + gate stay green (the stub must be purely additive).

## Out of scope (stub)

Bit-exact cross-machine pixels; native/vectorized 3D host; mouse-look/continuous
actions (the vec path's Float32 action vector is a lead for later, together with
the 2D mouse-preset discussion); human study on 3D games; DMLab benchmark parity.

## Reporting back (for the paper appendix)

1. The pass count: N/16 historical games under today's stack, plus ≥1 freshly generated game.
2. The trained-agent result (game, steps, score vs random, wall-clock, hardware).
3. Measured single-env FPS today (vs the historical ~1700) and, if stretch done, atlas-vec and CPU-raster numbers.
4. The explicit pillar table above — what transfers, what is future work.
