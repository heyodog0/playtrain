# GPU Runtime Plan

## Why this doc exists

`JAX_PORT_PLAN.md` formalizes paper 2: byte-exact cross-runtime equivalence via an owned rasterizer + JAX backend. That document is structured around a *property* (verifiability) and a *contribution* (shim-as-contract → cross-backend equivalence).

This document is structured around a different question: **what does it take to get NAVIX-class GPU throughput for node-gym in practice, where do the bottlenecks actually live, and what is the longer-term destination beyond paper 2?** It is not a competing plan; it is the throughput-focused complement, with the V8-JIT direction (paper 3 territory) and an architectural restructuring proposal that paper 2 alone doesn't articulate.

## Bottleneck reality

The current AnaloGen training pipeline (torch IMPALA-CNN + PPO + C₁ multi-env runtime + Cairo) hits ~2,800 end-to-end SPS for a 10hr / 100M-step run. Decomposing where that time goes:

- C₁ framework env throughput: ~9K SPS single-env, ~203K aggregate at N=24 (`MULTI_ENV_RUNTIME.md` §10)
- End-to-end PPO with the policy in the loop: ~2,800 SPS
- **Env-step is somewhere between 1% and 30% of wall time** depending on how you count; aggregate framework numbers put it ~1%, single-env standalone puts it ~30%

The implication is sharp: **env optimization in isolation is Amdahl-bounded.** Even infinite env speedup gives at most 1.1× to ~1.4× end-to-end. The dominant cost is policy forward + PPO update + Python orchestration + CPU↔GPU transfer per step.

This shifts the strategic question. Paper 2's JAX backend cannot, on its own, deliver the headline 100× speedup; the win materializes only when the *entire training step* (env + policy + advantage + update) is one compiled JAX (or `torch.compile`) graph that runs without Python in the inner loop. That requires the policy in the same compiled graph as the env.

## NAVIX as decomposition target

NAVIX[^navix] (the JAX port of MiniGrid) reports ~200,000× over Python-CPU MiniGrid. The number decomposes as:

- **~100× per-env** from jit + pure-functional state + tile-atlas obs replacing rasterization
- **~2000× from vmap width** at N=2048 on an A100 — hardware parallelism, not framework cleverness

For node-gym to land in the NAVIX/Craftax band:

- Per-env factor requires env-on-GPU (game logic + obs computation both lifted to tensor ops). The ~100× ceiling holds whether the framework is JAX or PyTorch-with-`torch.compile`.
- Vmap-width factor is hardware free *once the env is on GPU* and the compiled graph permits batching over N envs.

Crucially, **NAVIX's "no rasterizer" property is what makes its per-env factor land at ~100×**. NAVIX never solves continuous-primitive rasterization with anti-aliasing — observations are tile-atlas gathers (`atlas[grid_state]`). For grid-shaped games this is sufficient; for general 2D rasterization (the broader gym-gen catalog) a real GPU rasterizer is required and the per-env ceiling is lower (~10-30×).

## Pixel observations are preserved

A clarification that recurred in scoping discussions: **the tile-atlas approach still produces pixel observations.** The atlas is `uint8[N_tiles, cell_px, cell_px, 3]`, the gather is `atlas[grid_state]`, the obs is `H_px × W_px × 3` RGB tensor — same shape and dtype the Cairo backend produces. **IMPALA-CNN + PPO carries through unchanged.** No state-vector swap, no policy retraining, no architecture changes. The atlas can be pre-rendered from Cairo to ensure byte-identical pixels to the current observation pipeline.

The 100× speedup comes from *how the pixels are computed*, not *what the obs is*.

## The architectural decision

Three regimes exhaust the option space:

| Regime | Env | Policy | End-to-end speedup |
|---|---|---|---|
| 1. Keep JS, port policy | JS / Cairo / C₁ (today) | JAX/Flax (PureJaxRL-style) or aggressively `torch.compile`-d | ~2-4× (10hr → 2.5-5hr) |
| 2. Env-on-GPU | Tensor-op port (JAX or PyTorch) | Same framework, compiled in same graph | ~50-300× (10hr → minutes) |
| 3. JS untouched + 100× | — | — | **Does not exist architecturally** |

Regime 3 is the request that comes up repeatedly and deserves an honest answer: no JIT or compiler can lift JS into a fused GPU training graph without expressing the env's state transitions as tensor ops at some point in the pipeline. "JS code on GPU" either means (a) the JS source is the input to a compiler that emits GPU code (transpiler or JIT — both produce tensor-op output), or (b) the JS runs on CPU and the GPU only sees obs/actions (regime 1 ceiling).

The cap at ~2-4× for regime 1 is set by:
- Amdahl on env-step fraction
- ~100-300 μs/step of Python orchestration cost that crosses the JS↔GPU boundary
- Inability to `lax.scan` (or equivalent CUDA Graph) across an env step that calls into Cairo/V8

## Within regime 2: framework choice

| | JAX | PyTorch + `torch.compile` |
|---|---|---|
| Compilation entry | `jax.jit` | `torch.compile(mode="reduce-overhead", fullgraph=True)` |
| Rollout fusion | `jax.lax.scan` | CUDA Graphs (via `mode="reduce-overhead"`) |
| Env vmap | `jax.vmap` | leading batch dim in tensors; `torch.func.vmap` for higher-order |
| Optimizer | `optax.adam` | `torch.optim.Adam` (unchanged) |
| Policy port required | Yes — IMPALA-CNN to Flax | **No** — existing torch CNN compiles in place |
| Ecosystem maturity for RL | High (PureJaxRL, NAVIX, Craftax, gymnax) | Lower; `torch.compile` for RL is newer (2024-25) |
| Practical throughput ceiling | ~100-1000× over CPU baseline | ~60-80% of JAX ceiling in current Inductor maturity |
| Custom kernel escape hatch | XLA custom calls | Triton kernels |

**The PyTorch + `torch.compile` path is underappreciated** for projects committed to PyTorch. It avoids the IMPALA-CNN port and keeps everything in one framework, at the cost of a younger compilation toolchain and slightly lower achieved throughput.

## Tile-atlas fast path (gridworld subset)

For tile-grid games — AnaloGen's `analogen_nomemory_grid_v*` family (`_v1` through `_v6b`, plus `_2rooms_door`, `_bigkey`, `_boots`, `_lowmag`, `_2rooms_doorgoal_4x4`, `_2rooms_door_6x6_easy`, etc.) — the GPU env can take a fast path that skips per-primitive rasterization:

- Game state is `int8[N_envs, H_cells, W_cells]` + agent pose pytree
- Obs is computed as `atlas[grid_state]` (a tile-atlas gather), not by rasterizing each cell
- Per-env ~100× speedup; comparable to NAVIX's per-env figure
- IMPALA-CNN consumes the resulting H×W×3 RGB tensor without modification

This fast path requires the env's grid state to be reachable from the GPU side. The spectrum of "how much does the game file have to change":

| Approach | Per-game edits | Framework work | Magic level |
|---|---|---|---|
| Full metadata header (`tileGrid: { cellSize, dims, tiles, agentSprites, hudArea }`) | ~30-60 lines | low | explicit |
| **One-line declaration** (`export const NODE_GYM_TILEGRID = { cellSize, dims }`) | **1 line** | low-medium | medium |
| Filename convention (`*_grid_*.js` triggers detection) | 0 | medium | high |
| Shim pattern recognition (auto-detect from draw stream) | 0 | high | very high |

The one-line declaration is the recommended sweet spot: 5 minutes × ~6 base games of editing, plus framework work for the recording-replay shim that infers tile structure from one calibration rollout. **The differential test against Cairo is the safety net** — if the recognizer ever produces wrong sprites, the diff fires and the cell falls back to rasterization. Failures are detectable, not silent.

For LLM-authored variants going forward, the metadata becomes a one-line addition to the gym-gen template; variant generation continues to scale with no further engineering cost per game.

## Long-term: V8 tracing JIT to GPU (paper 3 territory)

The maximal version of regime 2 — "the JS file is the only thing in the repo; GPU execution is derived from it automatically, no second source representation to maintain" — is not a transpiler. It is a **tracing JIT** that lifts V8's hot loop to a GPU kernel at runtime:

1. V8 executes `draw()` with bytecode tracing instrumented (already exposed via Inspector / IC hooks)
2. Tracer detects that the same call sequence + shape signatures repeat
3. Specialization pass produces a typed, shape-bounded IR from the trace
4. PTX/NVPTX backend emits a GPU kernel from the IR
5. Guard-and-fallback runtime runs the GPU kernel when assumptions hold; falls back to V8 on cold paths or shape changes

**Crucially, the user never sees the generated kernel.** Compilation is ephemeral, regenerated at process start. The JS file is the sole source of truth. This is the meaningful sense in which "no transpiler" is satisfied — no second source representation is maintained.

### Why the shim-bounded subset makes this tractable

General JS-to-GPU is an open research problem. The shim-bounded subset excludes most of the hard parts by construction:

| Hard part of general JS→GPU | Shim subset |
|---|---|
| Garbage collection on GPU | No dynamic allocation |
| Dynamic dispatch / prototypal lookup | Shim API is enumerated |
| `eval` / `Function` | Banned |
| Async / promises / generators | Synchronous `draw()` only |
| Strings / regex / Unicode | Banned (no `text()`) |
| DOM / browser interop | Replaced by shim |
| `Math.random` nondeterminism | Already mulberry32 |
| Variable-shape collections | Shape oracle bounds them statically |
| Reflection / `Proxy` | Not used |

The shim profile is not just an API restriction — it is a **GPU-compilability contract**. Every restriction the shim adds expands the set of JS programs the JIT can lower efficiently. This co-evolution between the runtime and the games people write is the key architectural insight that makes the V8-JIT direction plausible specifically for node-gym, even though it remains hard for arbitrary JS.

### GPU code quality

A real concern: naive PTX emission from bytecode produces correct-but-slow GPU code. The compiler must reason about:

- **Memory coalescing**: state-of-arrays vs array-of-structures layout; the lowering pass forces SoA at trace time
- **Warp divergence**: data-dependent branches cause divergence; the JIT predicates branches when masking is cheap
- **Shared memory**: tile-atlas lookups are shared-memory candidates; access-pattern analysis identifies them
- **Occupancy / register pressure**: too many JS locals → too many GPU registers → fewer concurrent warps
- **Vmap-style parallelism**: each thread = one env (the N envs are the parallelism axis), not one statement within an env

These are real engineering problems, not impossibilities. The shim contract has to evolve to keep games inside the patterns the compiler handles well. JAX gets this for free because authors are forced to write in JAX's functional, scan-friendly idiom. node-gym's JIT gets it by tightening the shim profile over time toward JIT-friendly JS.

### Staged research path (each stage publishable)

| Stage | Work | Time |
|---|---|---|
| 1 | Manual proof of concept: hand-translate one game's bytecode trace to CUDA, measure speedup | 1-2 months |
| 2 | Automated tracer + IR (from V8 bytecode traces) | 3-4 months |
| 3 | PTX/NVPTX backend (IR → GPU kernel) — becomes a real JIT | 3-4 months |
| 4 | Guard-and-fallback runtime + production hardening | 2-3 months |
| 5 | Cross-architecture target (SPIR-V → Metal → WebGPU, intersecting with [ekzhang/jax-js](https://github.com/ekzhang/jax-js)) | 3-6 months |

Realistic timeline for a working prototype: **~12-18 months** of focused research-engineering. The full 5-stage program is a 3-5 year research arc. Out of scope for paper 2; eventual destination of the broader research program.

## Architectural restructuring proposal

The current node-gym directory layout conflates concerns that will only get more entangled as backends multiply. A cleaner shape:

```
node-gym/
├── profile/                  # the spec — what JS can do
│   ├── api.mjs               # enumerated p5 API surface (the contract)
│   ├── semantics.md          # what each call means deterministically
│   └── validators/           # static + runtime checks that games stay within profile
│
├── runtime/                  # how the spec is executed
│   ├── core/                 # V8-side game loop + state extraction (today's "shim")
│   ├── ir/                   # typed shape-bounded IR (compiler input)
│   ├── tracer/               # V8 instrumentation → IR
│   └── backends/
│       ├── cairo/            # today's path; legacy/reference
│       ├── wasm-rust/        # paper 2's byte-exact CPU backend
│       ├── jax/              # paper 2's GPU backend (AOT-emitted)
│       └── jit-ptx/          # paper 3's JIT backend (online emission)
│
├── policy-runtimes/          # PyTorch + JAX/Flax versions of common backbones
├── validation/               # differential test harness across all backends
└── tools/                    # gym-gen template, browser playtester, etc.
```

Key moves:

1. **Profile separated from runtime.** Today `p5-shim.mjs` is both spec and Cairo implementation. Splitting makes the spec a citeable, frozen artifact that all backends conform to. Aligns with the terminology shift from "shim" (compatibility-layer noun) to **profile** (standards-world term for a named subset of a larger API) — see the standards lineage of OpenGL ES, USB device classes, MIDI profiles.

2. **IR as first-class.** The typed, shape-bounded representation is what every non-Cairo backend consumes. Making it primary now means each new backend is just "IR → my emission" rather than a fresh rewrite from JS.

3. **Backends as plugins.** Selectable at runtime via `NODE_GYM_BACKEND=...`. Differential test harness verifies they agree. Adding the JIT-PTX backend in 2027 doesn't require restructuring then; the slot already exists.

4. **Policy runtimes as a sibling concern.** Decouple "what runs the env" from "what runs the policy." Today's coupling is why "JAX env requires JAX policy" feels like an architectural commitment; it should be a free combinatorial choice. Same env backend should work with torch IMPALA-CNN, JAX/Flax IMPALA-CNN, or a future JIT-native policy.

**Cost:** ~1-2 weeks of mostly-mechanical refactoring. Pays for itself once ≥2 backends exist (which is paper 2's first deliverable).

## Recommended phased plan for AnaloGen specifically

Independent of the broader paper 2 / 3 timeline, the AnaloGen training-cycle question has a phased answer:

| Stage | Work | Time | Outcome |
|---|---|---|---|
| 0 | Profile current PPO run with `torch.profiler` — confirm env <10% of wall time | 1 day | Decision data |
| 1 | Port policy + PPO loop to JAX (PureJaxRL pattern, Flax IMPALA-CNN) **or** aggressively `torch.compile` everything | 1-2 weeks | 10hr → 2.5-5hr; AnaloGen iteration unblocked |
| 2 | Library + manual subclass approach for AnaloGen grid games — write `TileGridEnv` base class in PyTorch/JAX tensor ops, subclass per game (~150 lines each) | 3-4 weeks | 10hr → minutes; NAVIX-class throughput on the grid family |
| 3 | (Paper 2) General rasterizer + transpiler for the full gym-gen catalog | per JAX_PORT_PLAN | Catalog-scale byte-exact equivalence |
| 4 | (Paper 3) V8 JIT eliminates the two-source-representation cost from stage 2 | 12-18 months | Single-source `.js` games, GPU-native execution at runtime |

Stage 1 is the immediate unblock and is genuinely independent of everything else. Stage 2 is the "hard-port-with-shared-infrastructure" path that the conversation kept circling back to — it's a real choice that has to be confronted, not avoided. Stages 3 and 4 are research-track and operate on multi-year timelines.

## Open questions

1. **Should the gridworld branch be cut as its own paper rather than a section of paper 2?** Argument for: tile-atlas + cognitive-grounding + AnaloGen + Griddly comparison is a tight, self-contained story that competes directly with NAVIX rather than with Craftax. Argument against: fragments the substrate narrative and dilutes paper 2's verified-equivalence headline. **Recommendation: keep it as a section of paper 2, but design the eval table to break out tile-grid throughput separately so the NAVIX/Griddly comparison is legible.**

2. **PyTorch + `torch.compile` vs JAX — where does PyTorch actually cap in practice for end-to-end RL?** The honest answer is "we don't have benchmarks." A 1-2 day spike comparing a small PPO run on a toy env in both frameworks (same hyperparams, same hardware) would resolve this empirically before committing 3-4 weeks of port work to one framework.

3. **Does the V8-JIT direction belong inside this project, or as a separate research effort?** It is multi-year, research-quality, and largely orthogonal to paper 1/2 deliverables. **Recommendation: write it up as paper 3's positioning in `DISSERTATION_ARC.md`, but do not stage work on it until paper 2 ships.** Premature investment risks both: paper 2 slipping because of JIT bikeshedding, and the JIT design being constrained by paper 2 artifacts that may turn out to be wrong scaffolding.

4. **Restructuring timing.** The profile/runtime/backends restructure is cheap (~1-2 weeks) but should land *before* a second backend exists, not after. If paper 2's first backend (WASM-Rust rasterizer) is imminent, do the restructure first; if paper 2 is still a quarter out, defer the restructure until a few weeks before the WASM backend lands.

5. **Async stepping vs JAX port — which removes more of the remaining gap to ALE?** Phase 2 of paper 1's runtime work (async C₁ stepping) closes ~16% of the gap to ALE on training workloads via overlap. A JAX port closes much more but requires the policy port too. If paper 1's "future work" gestures at the JAX direction (which it does), async stepping might be unnecessary scaffolding rather than a real intermediate.

## References

[^navix]: Pignatelli, E. et al. (2024). *NAVIX: Scaling MiniGrid Environments with JAX.* arXiv:2407.19396. <https://arxiv.org/abs/2407.19396>
