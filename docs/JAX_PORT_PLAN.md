# Verified Byte-Exact RL Pipeline: Plan

## Thesis

`node-gym` + `gym-gen` already produce LLM-authored, browser-playtestable, headlessly-trainable RL environments at **EnvPool-class throughput for JS-based envs** via the C₁ multi-env runtime (Worker Threads + path-batched native dispatch — see `docs/MULTI_ENV_RUNTIME.md`[^multienv]). C₁ achieves 3.8× over unbatched Cairo, peaking at 203k iters/s at N=24, and closes the gap to ALE from 75% to 84% on end-to-end PPO. This makes node-gym competitive with established C/C++ env runtimes (EnvPool[^envpool]) at training-loop scale while preserving framework-agnostic researcher choice — essential for bespoke sequential models that JAX's functional idiom makes painful to express.

**Catalog scale strategy: controlled variants, not novel games.** The realistic and theoretically stronger path is generating *variants of base games* (visual / role-shuffle / parameter / mechanic / action-remapping / compositional / difficulty) rather than fully novel games. Variants give causal control (isolate one axis at a time), have much lower LLM failure rate (bounded mutations of a working reference), and map directly to the cognitive-theory tests that motivate this work (AnaloGen Settings 1–3 are variant manipulations by construction). A ~30 base × ~8 variants per axis × ~5 axes = ~1,200 controlled envs from a small validated base set — and the controlled-variation structure is *itself* the research contribution, not just catalog scale.

The remaining gap is **JAX-class vmap throughput with byte-level cross-runtime reproducibility**, durable to upstream library drift — a property no existing 3D RL framework provides (see prior art) and no 2D RL framework provides without pinning to a specific moving-target library.

We close that gap by **owning the rasterizer**: a small, formally-specified 2D rasterizer with two provably-equivalent implementations (Rust→WASM and JAX), differential-tested across the full gym-gen catalog. The shim-as-contract pattern in `node-gym/runtime/p5/p5-shim.mjs` makes the surface small enough that owning it is tractable (~3K LOC vs Cairo's ~150K).

**Paper 2's contribution is the *property* (verified byte-exact cross-runtime equivalence), not the throughput record.** Paper 1's C₁ already serves the throughput-but-flexible audience; paper 2 serves the vmap-scale + bit-level-reproducibility audience.

## Two-paper structure

The work splits cleanly into two TMLR submissions with independent contributions:

| | Paper 1 | Paper 2 |
|---|---|---|
| **Focus** | `node-gym` substrate + C₁ multi-env runtime + `gym-gen` catalog | Verified-equivalent rasterizer + byte-exact JAX backend |
| **Contributions** | **(1) LLM-authored env substrate** (shim-as-contract, headless browser execution, 30+ p5 + 16 Three.js base games from `gym-gen`, plus controlled variants along visual / role-shuffle / parameter / mechanic / action-remapping / compositional / difficulty axes — enabling causal generalization studies hand-designed benchmarks can't support); **(2) C₁ multi-env runtime** — Worker Threads + path-batched native dispatch ("EnvPool[^envpool] for JS envs"), 3.8× framework throughput, ~84% of ALE end-to-end; **(3) validation harness** — 5-check ProcGen-style with strict byte-equality determinism. AnaloGen[^analogen] as case study for the variant-based methodology — the `analogen_nomemory_grid_v*` family (room/door/key/sword/boots variants at 4×4, 6×6, 2-room, 3-room scales) is a direct demonstration of difficulty/parameter/mechanic axes over a shared role-shuffling base. | Shim-as-contract → byte-exact cross-runtime equivalence for content-rich systems; demonstrated on the gym-gen catalog at JAX vmap throughput. The contribution is the *property* (verifiability, durability to upstream drift), not the throughput record. |
| **Depends on** | — | Paper 1 as substrate |
| **Doesn't need** | Custom rasterizer, JAX port | Anything beyond what paper 1 ships |
| **Reviewer community** | RL benchmarks, LLM systems, systems-RL | Graphics, PL, RL infrastructure |
| **Diagnostic methodology asset** | C₁ investigation in `MULTI_ENV_RUNTIME.md`[^multienv] — methodical rule-out (allocator, memory bandwidth, library swap) attributing contention to N-API call frequency; 12+ commits, 5 FASRC SLURM jobs. Systems-paper-quality receipts. | Differential test harness across runtimes; one-paragraph-per-primitive rasterizer spec. |

Paper 1 ships first; the rasterizer + JAX work is downstream. Paper 1's "future work" section gestures at paper 2; paper 2 cites paper 1 as substrate. Each paper makes one clear claim well.

## Prior Art

| System | Authoring | Backend | Throughput | Reproducibility |
|---|---|---|---|---|
| ALE[^ale] | Atari ROMs (frozen 1979) | C++ emulator | ~10K steps/s; ~2K end-to-end PPO sps | Bit-exact (deterministic emulator) |
| ProcGen[^procgen] | OpenAI in-house C++ | C++ | ~10-20K steps/s | Seed-deterministic |
| Griddly[^griddly] / GriddlyJS[^griddlyjs] | YAML DSL (GDL) | C++ core | High | Deterministic, DSL-bounded |
| EnvPool[^envpool] | Existing C++ envs (Atari, Mujoco, etc.) | C++ async multi-env runtime | 1M+ steps/s on Atari (8 cores) | Bit-exact (deterministic envs) |
| Craftax[^craftax] | Hand-written JAX | JAX | 257× over Crafter | JAX-deterministic |
| Jumanji[^jumanji] | Hand-written JAX | JAX | Very high | JAX-deterministic |
| NAVIX[^navix] | Hand-written JAX (MiniGrid port) | JAX | ~670M aggregate steps/s @ N=2048 on A100 (~100× per-env, ~2000× from vmap width); tile-atlas gather, no rasterizer | JAX-deterministic |
| Madrona[^madrona] | C++ ECS | GPU-batched | 1.9M steps/s simple; 30K HSSD | **Not bit-exact** — GPU FP non-determinism |
| Isaac Lab[^isaaclab] | USD / Python | GPU (PhysX + RTX) | 540K env-steps/s (Ant) | **Explicitly non-deterministic at bit level**[^isaacrepro] |
| Habitat[^habitat] | Matterport3D / HSSD | GPU | ~10K FPS multi-process | Benchmark-level only |
| XLand[^xland] | Procedural task generator | Custom 3D engine (internal) | Not released | Task-spec level |
| `node-gym` pre-C₁ (SubprocVecEnv) | LLM-authored p5/Three.js | Cairo + node-canvas / Dawn | ~1.5K sps end-to-end PPO (75% of ALE) | JS-deterministic (mulberry32 + fixed timestep) |
| **`node-gym` + C₁ (paper 1)** | LLM-authored p5/Three.js | Cairo + Worker Threads + path-batched dispatch | **203k iters/s framework (N=24); ~2.25K sps end-to-end PPO with `torch.compile` (84% of ALE)** | JS-deterministic; per-game strict byte-equality via `validate.py` |
| **`node-gym` + paper 2 backend** | LLM-authored p5 | WASM rasterizer + JAX (XLA) | ~5-50× over C₁ at moderate vmap (N=1K); **~100-1000× aggregate at JAX-native vmap scales (N=8K-64K)**; comparable to Craftax-class numbers (~277K-10M+ aggregate iters/s) | **Byte-exact cross-runtime, durable to upstream drift** |

The empirically open spot — *LLM-authorable + byte-exact cross-runtime, durable over time* — is paper 2's contribution. Pixman[^pixman] and fontemon-style spec-rigorous rasterizers exist in graphics; high-throughput approximate sims exist in ML; nobody sits at "modest throughput, byte-exact, content-rich" on the Pareto frontier.

**The C₁ contribution (paper 1) parallels EnvPool's architectural innovation:** both replace Python-side per-env coordination (`SubprocVecEnv`) with a native multi-env runtime that batches the Python↔native boundary. EnvPool achieves this for C++ envs via async stepping + lock-free queues; C₁ achieves it for JS envs via Worker Threads + path-batched native dispatch (overcoming the V8/Cairo N-API call-frequency contention diagnosed in `MULTI_ENV_RUNTIME.md` §10[^multienv]). The shared insight: **the dominant overhead in modern multi-env runtimes is not env compute, but Python coordination — and removing it via a native runtime is the architectural unlock.**

**Follow-up optimization for full EnvPool parity:** async stepping. C₁ today has Python wait for all workers each step. Overlapping env-step with the GPU policy update would close the remaining gap to ALE on training workloads and is a natural phase-2 extension of paper 1's runtime work.

## Architectural Enabler

`node-gym/runtime/p5/p5-shim.mjs` (369 LOC) enumerates the entire API surface a game may use. The shim is the contract:

- **Primitives:** `rect`, `ellipse`, `circle`, `line`, `triangle`, `quad`, `beginShape/vertex/endShape`
- **Transforms:** `push/pop/translate/rotate/scale`
- **Math:** `map`, `constrain`, `lerp`, `dist`, IEEE-754 basics + transcendentals
- **Input:** `keyIsDown`, one-frame `simulateKeyPress`
- **Determinism already engineered:** `Math.random` → mulberry32 (`game-env.mjs:127`); obs downsample `imageSmoothingEnabled = false` (`p5-shim.mjs:299`)

Any game using JS outside this enumerated surface fails at load. The "JS subset" is empirically defined by the shim, not aspirational. This is the property Griddly's GDL[^griddly] engineered top-down with a custom DSL; `node-gym` achieves it bottom-up by restricting the shim.

**The shim restriction is what makes owning the rasterizer tractable.** Cairo's ~150K LOC is overkill for the ~10 primitives the shim exposes — a custom rasterizer for this subset is ~3K LOC of Rust.

## The Rasterizer (Paper 2 Core)

### Language and distribution
**Rust → WASM.** `wasm-bindgen` + `wasm-pack` for JS interop; same crate compiles to a native binary for fast iteration and a native node-gym dependency (faster than WASM in headless mode). WASM has stricter FP semantics than JS — no fdlibm transcendental drift, no V8 JIT FP rearrangement.

### Anti-aliasing: supersample + box-filter downsample
Not analytic coverage. Rasterize at `(kH, kW, 3)` with `k ∈ {4, 8}` binary inside-test, downsample by box filter to `(H, W, 3)`. Reasons:

- One-sentence spec: "for each output pixel, the value is the mean of N×N inside-tests at uniformly spaced sub-pixel positions"
- Maps to JAX identically — both backends implement the same algorithm, byte-exact by construction
- No FP-sensitive coverage math
- Visual quality at k=8 is competitive with analytic AA at 64×64 obs scale
- Slower than analytic, but game-loop rates are not throughput-bound

Replace pixman, don't match it.

### Primitive surface (explicit inclusions and exclusions)

**Include** (mirrors the shim):
- `rect` with optional `roundRect` corner radius
- `ellipse` / `circle`
- `line` with stroke weight
- `triangle` / `quad`
- `beginShape` / `vertex` / `endShape(CLOSE?)` — polygon with fill + stroke, non-zero winding
- Transform stack, fill + stroke colors (RGB/RGBA fully-opaque-on-background)

**Exclude** (banned in shim or gym-gen template):
- Text (template-banned; rasterization is the most painful primitive)
- Gradients, filters, blend modes beyond src-over
- Images / textures
- Bezier curves
- Alpha-blending stacks beyond default

### Pinned algorithmic choices
- Pixel-center sampling: integer pixel `(x, y)` center at `(x + 0.5, y + 0.5)`
- Half-open intervals: `[x, x + w)` for rect (no double-counted edges)
- Polygon fill rule: non-zero winding
- Geometry math in `f64`; reduce to `u8` only at pixel write
- No FMA — write `a*b + c` as separate ops so rounding matches across backends
- Transcendentals (`sin`/`cos`/`atan2`/`sqrt`/`exp`/`log`/`pow`) via a sibling Rust crate ported from CORE-MATH[^coremath] or Sleef[^sleef], mirrored in JAX via custom calls

### Testing strategy
Three layers:
1. **Unit tests** on individual primitives across scales/positions/colors: Rust-native ↔ WASM ↔ JAX bit-identical
2. **Cairo sanity diff** — pixel layouts should obviously match; exact bytes will *not* match (different algorithm), this is a visual smoke test only
3. **Full-rollout cross-runtime diff** on the gym-gen catalog: same `(seed, action_sequence)` → byte-identical frames across (Rust-native, WASM-in-Node, WASM-in-browser, JAX). This is the paper-2 headline result.

## Plan — 2D (p5) Arm

| Component | Strategy | Effort |
|---|---|---|
| Rasterizer spec doc | One paragraph per primitive; pin every algorithmic choice | 1-2 weeks |
| Rust native rasterizer | ~3K LOC; Cairo sanity diff | 3-4 weeks |
| WASM build + node-gym integration | Feature-flagged behind `NODE_GYM_RASTERIZER=wasm`; existing games default to Cairo | 2 weeks |
| Browser-shim WASM integration | Replace HTML5 canvas calls in the playtest shim with WASM calls; canvas used only as display surface | 2 weeks |
| IEEE-correct transcendental crate | Rust + JAX, shared spec | 3-4 weeks |
| AST-walking JS→JAX transpiler | Acorn parse → emit Python/JAX; state pytree from top-level `let`; control flow → `lax.{cond, scan, fori_loop, while_loop}`; `arr.push` → masked scatter | 4-6 weeks |
| Shape-inference oracle | Run JS games for ~1000 seeds × 5000 steps in node-gym; log max-array sizes; bake as static bounds | 2 weeks |
| Sequential-reduction discipline + XLA flags | Force scan-based reductions; `XLA_FLAGS=--xla_gpu_enable_fast_math=false` | 1 week |
| JAX rasterizer (mirrors Rust spec) | Pure JAX functions for each primitive; supersample-and-downsample | 4-6 weeks |
| Matter.js → JAX port | Direct port of the subset `angry_birds` / `suika` use; sequential impulse via `lax.fori_loop` | 4-6 weeks |
| Cross-runtime differential test harness | Extend `validate.py`'s 5-check suite with paired `(WASM, JAX)` rollouts | 2 weeks |

**Total paper-2 phase 1 (p5 byte-exact end-to-end): ~7-9 months** of focused work.

## Gridworld Fast Path (subset of the 2D arm)

A subset of the gym-gen catalog is structurally tile-grid: every draw call paints a fixed-size axis-aligned cell, transforms are translate-only, and the entire frame is determined by `(grid: int[H_cells, W_cells], agent_pose)`. The AnaloGen[^analogen] no-memory grid family (`analogen_nomemory_grid_v1` through `_v6b`, plus `_2rooms_door`, `_2rooms_doorgoal_4x4`, `_bigkey`, `_boots`, `_lowmag` variants) is the canonical example — a quick primitive tally on `analogen_nomemory_grid_v5.js` shows 21× `fill` + 11× `rect` + 2× `line` + 1× `ellipse` and nothing else. This is precisely the shape NAVIX[^navix] exploits.

**For games that declare themselves tile-grid via a metadata header** (`gridSize`, `cellSize`, fixed sprite atlas), the JAX backend can take a fast path: observations become a tile-atlas gather (`atlas[grid_indices]` reshape) rather than per-primitive rasterization. This skips supersample-AA, polygon scan conversion, and the IEEE-correct transcendental crate — the heaviest parts of the general rasterizer plan. Per-env throughput rises to NAVIX-class (~100× over CPU rather than the ~10-30× the general rasterizer projects), because the obs path collapses to an integer gather.

**Comparison to Griddly[^griddly]:** Griddly engineers tile-grid speed top-down via a custom DSL (GDL) and a C++ engine. node-gym's fast path engineers it bottom-up from the *same JS source* that runs in browser playtest — no DSL, no separate engine. A tile-grid game declared with the metadata header runs (a) on Cairo for playtest, (b) on WASM for byte-exact CPU rollouts, (c) on the JAX general rasterizer for byte-exact GPU rollouts, and (d) on the tile-atlas fast path for maximum-throughput GPU rollouts — same `.js` file, four backends. Griddly cannot accept LLM-authored content because GDL is not a target current models author fluently; p5 is.

**This is not a separate repo.** Tile-grid is one declaration flag, not a different framework. The shim contract, the validation harness, the variant methodology, and the AnaloGen case study are shared with the general 2D arm. Splitting would fragment the shim, double the variant tooling, and break the same-source-many-backends story that makes the contribution legible. The artifact stays unified; the *paper-2 evaluation table* can break out tile-grid throughput as its own column to make the comparison to NAVIX/Griddly explicit.

**Effort:** ~2 weeks on top of the general JAX rasterizer — the tile-atlas observation function is small once the JAX rasterizer is in place. Metadata-header convention and a validator check that the game actually obeys it ("no draws outside cell bounds, no non-translate transforms, no non-atlas colors") is most of the work.

## Plan — 3D (Three.js) Arm

Byte-exact 3D *pixel* equivalence is structurally hard: GPU rendering is non-deterministic across hardware. Isaac Lab concedes this in writing[^isaacrepro]; Madrona doesn't claim it[^madrona]. The SOTA workaround is state-vector observations (Brax, MuJoCo Playground, Isaac default).

**Paper 2 scope: byte-exact at game-state level, deterministic-within-JAX for pixels.** This matches the field's current bar while improving on it (state-level byte-exact is stronger than Isaac's "bit-drift possible"). Software-rasterized byte-exact 3D is teased as **paper 3** future work, not in scope here.

| Component | Strategy | Effort |
|---|---|---|
| Three.js subset spec (one camera, box/sphere/plane primitives, Lambert + flat, ambient + one directional light, no textures/shadows/PBR) | Doc | 1-2 weeks |
| JAX game-logic transpiler (same machinery as p5 arm) | AST walk; `update(dt)` → pure step function | 4-6 weeks |
| State-trajectory byte-exact tests | `(score, lives, entity_positions, entity_velocities)` equality across runtimes | 2 weeks |
| Pixel-level approximate tests | L2 < ε; policy-transfer score retention as the stricter bar | 3-4 weeks |

**Total 3D arm: ~3-4 months**, layered after the 2D arm.

## Phased Timeline (Go/No-Go Gated)

| Phase | Weeks | Deliverable | Go/No-Go gate |
|---|---|---|---|
| **Paper 1 lock-in** | — | Catalog stable; baselines published; paper 1 submitted | Paper 1 in review |
| 0 | 1-2 | Rasterizer spec doc | Spec reviewed by ≥1 graphics-literate reader |
| 1 | 3-6 | Rust native rasterizer for 3 primitives (`rect`, `circle`, `line`); Cairo sanity diff | Visual layout matches Cairo at 256×256 |
| 2 | 7-12 | Full Rust rasterizer + WASM build + node-gym integration behind feature flag | All 28 non-Matter games render correctly under WASM backend |
| 3 | 13-20 | JAX rasterizer + IEEE-correct transcendentals + cross-runtime diff on 5 representative games (`breakout`, `flappy_bird`, `maze`, `coinrun`, `pong`) | 5/5 byte-exact ≥10K-step rollouts across (WASM, JAX) for seeds 0-99 |
| 4 | 21-30 | Transpiler + full p5 catalog under JAX | ≥25/28 byte-exact at full rollout; ≥100× speedup vs node-gym |
| 5 | 31-36 | Matter.js → JAX port | Both Matter games byte-exact at 5K-step rollouts |
| 6 | 37-44 | Three.js arm — game-state byte-exact, pixel-approximate | 14/16 games state-byte-exact; policy-transfer ≥95% |
| **Paper 2 writeup** | 45-52 | TMLR submission | Submitted |
| Phase 7 (optional, paper 3) | 53-90+ | Software-rasterized byte-exact 3D RL via "Three.js-lite" shim | Open problem solved |

[ekzhang/jax-js](https://github.com/ekzhang/jax-js) becomes relevant in paper 3 as a third backend (browser playtest of the JAX op-graph[^jaxjs]), enabling four-way equivalence (Rust-native ≡ WASM-in-Node ≡ WASM-in-browser ≡ JAX-Python ≡ jax-js-WebGPU).

## Compatibility With the Existing Catalog

Replacing Cairo with the custom rasterizer is **logically backward-compatible** (shim API unchanged; the 30 games don't change) but **pixel-aesthetically different** (supersample AA produces different per-pixel values than Cairo's coverage AA). Migration:

- Existing games keep running on Cairo via the default `NODE_GYM_RASTERIZER=cairo`. The WASM backend is opt-in until paper 2 ships.
- Each game's determinism fixtures re-baseline against the WASM rasterizer when the flag flips.
- Trained policies under Cairo *may* transfer to WASM observations (CNN robustness to small pixel perturbations), but baselines should be re-run under WASM for honest reporting in paper 2.
- Audit needed: any game using `text()`/`textSize()` must be regenerated without text (template-banned; should be zero).

## Pitch for paper 1 (suggested framing)

> *We present `node-gym`, an LLM-authored RL environment substrate where games are single-file p5.js / Three.js sketches whose entire API surface is enumerated by a small JS shim. We use the shim restriction to do two things hand-designed benchmarks can't: (i) **scale to controlled variants** of base games — LLM-driven mutations along theoretically-motivated axes (visual, role-shuffle, parameter, mechanic, action-remapping, compositional, difficulty) that isolate causal variables for generalization studies; and (ii) **match established C/C++ env runtimes at training scale** via C₁, a Worker-Threads-based multi-env runtime that replaces Python's `SubprocVecEnv` with batched native dispatch — the JS analog of EnvPool's[^envpool] C++ async runtime. The N-API call-frequency contention that defeats naive multi-threading of Cairo / Skia (documented via methodical rule-out across 12+ commits and 5 SLURM jobs) is resolved by path-batched draw operations, achieving 3.8× framework throughput and ~84% of ALE on end-to-end PPO. AnaloGen[^analogen] — testing analogical generalization grounded in structure-mapping theory — is presented as case study, showing how variant-axis methodology enables causal claims about what generalizes and what doesn't.*

## Pitch for paper 2 (suggested framing)

> *The graphics community has byte-exact software rasterizers (pixman, fontemon). The ML community has high-throughput approximate simulators (Madrona, Isaac Lab, Habitat). Existing JAX env suites (Craftax, Jumanji) achieve high throughput via vmap but require hand-authoring in JAX's functional idiom — closing off the LLM-authoring substrate. For LLM-authored RL environments, we show that a small custom rasterizer plus an AST-walking JS→JAX transpiler enables a previously-unoccupied Pareto point: **JAX-class aggregate throughput (~100-1000× over CPU-native at vmap scale, comparable to Craftax) AND verified byte-exact cross-runtime equivalence, with LLM-authored content as the source**. The shim-as-contract pattern from `node-gym` (paper 1) makes this tractable: ~3K LOC of Rust replaces ~150K of Cairo, two provably-equivalent backends (WASM and JAX) differential-tested across the gym-gen catalog. We lose to GPU-batched Madrona on raw throughput on hand-coded envs, but Madrona explicitly gives up bit-exactness and can't accept LLM-authored content. The combination — verified byte-exact + JAX-throughput + LLM-authorable — is the contribution.*

These positions paper 1 alongside EnvPool / ProcGen / ALE as a systems-RL contribution, and paper 2 between graphics (pixman, fontemon) and ML (Madrona, Isaac Lab) communities. Graphics reviewers appreciate paper 2's spec rigor; ML reviewers appreciate paper 1's throughput-with-flexibility and paper 2's reproducibility motivation.

## Open Questions and Honest Limitations

Unaddressed by paper 2; remain the load-bearing bets of the broader research program:

1. **Is the LLM-authored env corpus actually useful for RL?** Faster training of low-signal envs is still low-signal. Validation gates each game, but mode collapse and difficulty miscalibration across the catalog are open empirical questions for paper 1.
2. **Does the gym-shape JS subset have a corpus advantage at all?** p5's millions-of-sketches corpus transferring to gym-shaped p5 fluency is plausible but unverified.
3. **Does the shim subset survive catalog growth via variants?** This is now answerable empirically. Variants of existing base games inherit the base's p5-shim usage by construction — mutations along visual/role/parameter/mechanic axes don't introduce new shim primitives. So variant-driven catalog growth is shim-stable by design. Only *novel* base games risk shim expansion. Recommendation: prioritize variant generation; gate novel-base additions on whether the shim already covers what they need.
4. **Does byte-exact give up enough throughput to lose to non-exact GPU suites?** Sequential reductions + IEEE-correct math + disabled fast-math + supersample AA cost real per-step efficiency. But the JAX win is **aggregate via vmap**, not per-env: C₁ peaks at N=24 (Cairo contention) while JAX vmap scales to thousands of envs on one GPU. Realistic aggregate: ~5-50× over C₁ at moderate vmap (N=1K), ~100-1000× at JAX-native scales (N=8K-64K). For comparison, Craftax hits 277K aggregate steps/s on one GPU with a heavier env than ours, and gymnax CartPole (no rendering) hits 100M+. NAVIX[^navix] reports ~200,000× over MiniGrid, which decomposes as ~100× per-env (jit + pure-functional state + tile-atlas obs) and ~2000× from vmap width at N=2048 on an A100 — the per-env factor is what node-gym's JAX port targets, and the vmap-width factor is hardware parallelism shared by any JAX-native env suite. NAVIX gets its per-env factor partly by having *no rasterizer*: observations are integer tile IDs, and pixel mode is a fixed sprite gather. node-gym pays for byte-exact rasterization of continuous primitives, so a ~100× per-env factor is the realistic ceiling rather than NAVIX's framing-headline figure. node-gym's JAX port lands in the same band as Craftax/Jumanji/NAVIX on aggregate throughput. We still lose to GPU-batched Madrona[^madrona] (1.9M steps/s on simple scenes via custom GPU ECS), but Madrona explicitly gives up bit-exactness. **Paper 2's contribution is the *combination*: JAX-class aggregate throughput AND verified byte-exact cross-runtime equivalence, which no existing system provides simultaneously.** Researchers who want maximum throughput on generic algorithms and don't need bit-exactness still go to Madrona; paper 2 serves the (substantial) population that needs both reproducibility *and* throughput at scale.

5. **Does async stepping (EnvPool-style) belong in paper 1 or as follow-up?** C₁ Phase 1 has Python wait for all workers each step; EnvPool overlaps env-step with the GPU update. Adding async stepping would close the remaining 16% gap to ALE on training workloads. **Recommendation:** target Phase 1 of the runtime work as currently scoped (sync C₁) for paper 1; async stepping is a natural Phase 2 of paper 1 if time allows, or a short follow-up note. Don't block paper 1 on it.

## References

[^nodecanvas]: Automattic. *node-canvas: a Cairo-backed Canvas implementation for NodeJS.* <https://github.com/Automattic/node-canvas>
[^ale]: Bellemare, M.G., Naddaf, Y., Veness, J., & Bowling, M. (2013). *The Arcade Learning Environment: An Evaluation Platform for General Agents.* arXiv:1207.4708. <https://arxiv.org/abs/1207.4708>
[^procgen]: Cobbe, K., Hesse, C., Hilton, J., & Schulman, J. (2020). *Leveraging Procedural Generation to Benchmark Reinforcement Learning.* ICML 2020. <https://arxiv.org/abs/1912.01588>
[^griddly]: Bamford, C., Huang, S., Lucas, S. (2021). *Griddly: A platform for AI research in games.* arXiv:2011.06363. <https://arxiv.org/abs/2011.06363>
[^griddlyjs]: Bamford, C. et al. (2022). *GriddlyJS: A Web IDE for Reinforcement Learning.* arXiv:2207.06105. <https://arxiv.org/abs/2207.06105>
[^craftax]: Matthews, M. et al. (2024). *Craftax: A Lightning-Fast Benchmark for Open-Ended Reinforcement Learning.* ICML 2024. arXiv:2402.16801. <https://arxiv.org/abs/2402.16801>
[^jumanji]: Bonnet, C. et al. (2023). *Jumanji: a Diverse Suite of Scalable Reinforcement Learning Environments in JAX.* arXiv:2306.09884. <https://arxiv.org/abs/2306.09884>
[^madrona]: Shacklett, B. et al. (2023). *An Extensible, Data-Oriented Architecture for High-Performance, Many-World Simulation.* SIGGRAPH 2023. <https://madrona-engine.github.io/>
[^isaaclab]: Mittal, M. et al. (2024). *Isaac Lab: A GPU-Accelerated Simulation Framework for Multi-Modal Robot Learning.* arXiv:2511.04831. <https://arxiv.org/html/2511.04831v1>
[^isaacrepro]: NVIDIA. *Isaac Lab — Reproducibility and Determinism.* <https://isaac-sim.github.io/IsaacLab/main/source/features/reproducibility.html>
[^habitat]: Savva, M. et al. (2019). *Habitat: A Platform for Embodied AI Research.* ICCV 2019. <https://arxiv.org/abs/1904.01201>
[^xland]: Open-Ended Learning Team, DeepMind (2021). *Open-Ended Learning Leads to Generally Capable Agents.* <https://deepmind.google/blog/generally-capable-agents-emerge-from-open-ended-play/>
[^pixman]: Pixman. *Pixel manipulation library used by Cairo.* <https://www.pixman.org/>
[^coremath]: Sibidanov, A. et al. *CORE-MATH: Correctly-rounded mathematical functions.* INRIA. <https://core-math.gitlabpages.inria.fr/>
[^sleef]: Shibata, N. *SLEEF: SIMD Library for Evaluating Elementary Functions.* <https://sleef.org/>
[^jaxjs]: Zhang, E. *jax-js: JAX in JavaScript — ML library for the web, running on WebGPU & Wasm.* <https://github.com/ekzhang/jax-js>
[^envpool]: Weng, J. et al. (2022). *EnvPool: A Highly Parallel Reinforcement Learning Environment Execution Engine.* NeurIPS 2022 Datasets and Benchmarks. arXiv:2206.10558. <https://arxiv.org/abs/2206.10558>
[^multienv]: `node-gym/docs/MULTI_ENV_RUNTIME.md` — Phase 0/0.5 investigation into Worker Threads contention, decision for Architecture C₁ (Worker Threads + path-batched Cairo + SharedArrayBuffer). 12+ commits, 5 FASRC SLURM jobs; receipts in §10.4 and §10.6.
[^navix]: Pignatelli, E. et al. (2024). *NAVIX: Scaling MiniGrid Environments with JAX.* arXiv:2407.19396. <https://arxiv.org/abs/2407.19396>
[^analogen]: `analogen/` (sibling repo to `node-gym/`) — node-gym implementation of AnaloGen (Irie, K., Jan 2026), an analogical-generalization challenge grounded in Gentner & Markman (1997) *Structure Mapping in Analogy and Similarity*. Setting 2 (role-shuffling) is implemented; the `analogen_nomemory_grid_v*` family demonstrates difficulty/parameter/mechanic variant axes over a shared base. See `analogen/README.md` and `analogen/reference/Kazuki-Irie--AnaloGen--Synopsis.pdf`.
