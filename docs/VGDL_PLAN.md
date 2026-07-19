# VGDL Runtime for PlayTrain

A plan for building a JS-native interpreter for the Video Game Description Language (VGDL) inside PlayTrain, bringing the full Schaul/GVGAI corpus into the substrate. This expands the catalog ~5-10× with no per-game LLM authoring cost, creates direct continuity with the Tsividis theory-based-RL line that `DISSERTATION_ARC.md` cites as foundational, and (as a bonus) provides a JIT-friendly intermediate DSL for the longer-term V8-to-GPU compilation direction in `GPU_RUNTIME_PLAN.md`.

## Background on VGDL

VGDL is a compact text-based DSL for specifying 2D arcade-like games, originated by Schaul (2013)[^schaul2013] for the General Video Game AI (GVGAI) competition[^gvgai]. Each game is defined by two files:

- **Game spec** (~10-50 lines): sprite types + interactions (collisions, conditional effects) + termination conditions
- **Level layout**: an ASCII grid placing initial sprites

The GVGAI corpus accumulated ~100-200+ games across 2014-2019. The community is largely dormant since ~2019, which is a feature here, not a bug — no scoop risk, and the corpus is a stable target.

**Crucially for the dissertation arc:** Pedro Tsividis used VGDL-style games for the Theory-Based RL line[^tsividis2017][^tsividis2021] that `DISSERTATION_ARC.md` cites as foundational. Building a JS VGDL runtime creates direct, citeable continuity with that work — and a possible collaboration shape with Tsividis (Tenenbaum-circle, Gershman-network adjacent).

VGDL's relationship to modern deep RL is conspicuously underdeveloped:

- Torrado et al. 2018[^torrado2018] benchmarked DRL on **8** GVGAI games — the closest existing precedent
- The GVGAI competition focused on symbolic planners (MCTS variants, search) rather than end-to-end deep RL
- ALE / ProcGen / MiniGrid / Crafter / NetHack / MineRL dominate the modern benchmark landscape; VGDL is conspicuously absent despite the GVGAI framework having "over twice the number of games as ALE"
- **No end-to-end deep RL evaluation across the full VGDL corpus has been published.** This is open ground.

## Why VGDL pairs uniquely well with PlayTrain

Five structural reasons:

1. **Tile-grid + sprite structure aligns with the Flavor B tile-atlas fast path** (`GPU_RUNTIME_PLAN.md`). Every VGDL game is structurally a NAVIX-class target — GPU observations become an atlas gather, not a rasterizer pass.

2. **VGDL is LLM-fluent.** The DSL syntax is small, declarative, and well-documented. LLMs author VGDL specs fluently in a way they cannot author PDDL or general game-engine code. The "LLM-authored substrate" framing of paper 1 *survives* VGDL inclusion: LLMs author both p5 sketches and VGDL specs/variants, and the legacy GVGAI corpus provides the bootstrap.

3. **Direct continuity with Theory-Based RL** (Tsividis lineage). The substrate VGDL represents is the same one the dissertation arc engages with cognitively. Adding it to PlayTrain is substrate completion, not substrate change.

4. **VGDL is a JIT-friendly intermediate DSL.** It is *much* smaller than general JavaScript. If/when the V8-tracing-JIT-to-GPU direction (paper 3 alt in `GPU_RUNTIME_PLAN.md`) proves harder than hoped for general shim-bounded JS, **VGDL is a natural intermediate compilation target**: small declarative spec → JAX kernel is significantly more tractable than imperative-JS → JAX kernel. VGDL → JAX could stand alone as a publishable compiler before the harder JS-to-JAX path is attempted.

5. **VGDL inherits all of PlayTrain's substrate properties for free.** Byte-exact determinism, cross-runtime equivalence, browser-headless playtest equivalence, Worker-Threads multi-env runtime, validation harness — all apply to VGDL games as soon as the interpreter is in place. No per-game infrastructure work.

## Technical design

Build VGDL as an **interpreter inside the PlayTrain JS runtime**, not a per-game transpiler. One JS file (~1500-3000 LOC, well within the shim profile) that:

- Parses VGDL game DSL + ASCII level layouts
- Maintains sprite registry, interaction rules (collisions, conditional effects), and termination conditions
- Renders via shim primitives (`rect` + sprite atlases — already supported)
- Exposes the standard PlayTrain `setup()` / `draw()` / `keyIsDown` API
- Accepts a VGDL game spec as a string parameter at construction

The full corpus loads as data files (`games/vgdl/*.txt`); the interpreter is the single game-as-code. Adding a new VGDL game means dropping in a spec file; no per-game JS authoring needed.

```
PlayTrain/runtime/vgdl/
├── parser.mjs              # VGDL DSL parser
├── interpreter.mjs         # game-loop + interaction rules
├── sprites.mjs             # sprite types and properties
├── terminations.mjs        # win/loss conditions
├── level-loader.mjs        # ASCII layout → grid state
└── compat-py-vgdl.test.mjs # differential test against reference

games/vgdl/                 # the corpus
├── frogger.txt
├── zelda.txt
├── aliens.txt
└── ... (~100-200 games)
```

## Effort estimate

| Component | Effort |
|---|---|
| VGDL DSL parser | 3-5 days |
| Sprite types + interaction rules (semantic bulk) | 2-3 weeks |
| Termination conditions + scoring + reward signal | 3-5 days |
| ASCII level loading | 3-5 days |
| Differential validation against py-vgdl reference (same seed + actions → same trajectory) | 1-2 weeks |
| Corpus curation + polish (full GVGAI library actually loads, edge cases) | 1-2 weeks |

**Total: ~6-9 weeks** of focused work for a JS VGDL runtime covering the full GVGAI corpus. Comparable in scope to the WASM rasterizer in `JAX_PORT_PLAN.md`, but higher-leverage per week because of the catalog multiplier.

## Variant-axis methodology applied to VGDL

The variant axes from `DISSERTATION_ARC.md` (Catalog Strategy section) apply cleanly to VGDL games:

| Variant axis | VGDL implementation |
|---|---|
| Visual | Sprite-image swap (same VGDL spec, different sprite assets) |
| Role-shuffle | Permute which sprite name serves which functional role in the interaction-rules block |
| Parameter | Numeric edits to VGDL spec (speed, damage, etc.) |
| Mechanic-variant | Add/remove/rewrite one rule in the interaction block |
| Action-remapping | Permute the action→effect mapping |
| Compositional | Combine rule fragments across games |
| Difficulty | Scale level layouts |

LLMs author all of these variants fluently because VGDL's DSL is small and constrained. **The 1200-LLM-authored-variants story scales for free to VGDL** — LLMs propose mutations on a working spec, the validation harness gates them, the variant methodology proceeds.

## Strategic placement in the dissertation arc

Three options for slotting this into the paper plan from `DISSERTATION_ARC.md`:

**Option A — Paper 1.5 / methods extension.** Short paper after paper 1: *"PlayTrain-VGDL: First end-to-end deep RL evaluation across the full Video Game Description Language corpus."* Benchmark contribution. ~3-6 months after paper 1. Venue: NeurIPS Datasets & Benchmarks, TMLR, or as the substrate-methods half of a paper paired with cognitive-science findings.

**Option B — Substrate expansion for paper 3 (resource-rational).** The expanded task surface makes the resource-rational story dramatically stronger. AnaloGen variants probe analogical structure-mapping specifically; the full VGDL corpus stretches across navigation, puzzle, shooter, action, sokoban-like, frogger-like — a much wider cognitive-task surface. Resource-rational analyses fit per-game-class would be a richer empirical finding than analyses fit only across AnaloGen variants. This is also where the **Tsividis-line theory-based-RL replication** naturally lives: take Tsividis's VGDL results, train deep RL + cognitively-grounded RL agents on the same games, compare.

**Option C — Foundational infrastructure for all downstream papers.** Treat VGDL as Phase 2 infrastructure that papers 2, 3, 4 all benefit from. No separate paper, but it expands the experimental options.

**Recommendation: A + B together.** Ship a benchmark methods paper that makes the corpus widely available and demonstrates deep RL across all of it; then leverage the expanded surface for paper 3's cognitive science. Two distinct contributions from one engineering investment.

## Connection to the inference work

The Bayesian-inference dimension (`DISSERTATION_ARC.md` "Bayesian Inference as Methodological Backbone") extends to VGDL essentially unchanged. In fact, **VGDL is more PPL-friendly than p5 games** because:

- State is propositional-ish (sprite positions + types + ownership) rather than imperative
- Rules are declarative — easy to express as Gen distributions over event sequences
- The original Schaul VGDL paper subtitled "for model-based or interactive learning" specifically because the DSL was designed to be amenable to inference[^schaul2013]

SIPS-style goal inference, resource-rational fitting, Bayesian rule induction all extend to the full VGDL corpus once the interpreter is in place. **This is the largest single multiplier on the inference research direction** — the inference machinery, built once, applies to ~100-200 games.

## Caveats and risks

1. **VGDL semantic edge cases.** The original Schaul Python implementation accumulated specific behaviors over years; matching them exactly requires careful differential testing. Budget more time than the parser + rules suggests.
2. **Corpus heterogeneity.** Some GVGAI games are buggy, underspecified, or trivially easy/hard. Curation is a real cost. Likely end with a curated subset of ~50-100 high-quality games rather than the full ~200.
3. **GVGAI community dormancy.** The competition wound down ~2019. You're building on a substrate that no active community is investing in — good for scoop risk, bad for momentum. Counter-evidence: cog-sci use of VGDL (Tsividis line) is still active.
4. **Continuous-time / real-time games.** A handful of VGDL games use real-time controls (shooters, action). The fixed-tick / discrete-action PlayTrain framework needs to handle these cleanly — solvable but worth scoping.
5. **Framing tension with "LLM-authored."** Partial — resolved by reframing the substrate's authoring story as "single-source-JS, LLM-friendly, multiple authoring channels (p5 sketches, VGDL specs, future DSLs)." LLMs can author VGDL variants fluently, so the LLM-authoring story scales rather than getting diluted.

## Open questions

1. **Curation criteria.** What defines "high-quality" for the VGDL subset? Game balance? Solvability? Educational value for cognitive theories? Likely requires a curation pass with Tsividis or another VGDL-knowledgeable collaborator.
2. **Reward signal homogenization.** VGDL games have idiosyncratic scoring; standardizing reward across the corpus for cross-game agent training is a non-trivial design choice. Multiple normalization schemes exist (per-game min/max, percentile-rank, terminal-only) and the choice affects what an RL agent learns.
3. **How much of the original py-vgdl semantics is worth matching exactly?** Some idiosyncrasies are bugs, not features. A clean reimplementation may be better than a faithful one — but breaks the differential test against the reference. Tradeoff between cleanness and validation rigor.
4. **Three.js-arm interaction.** Should the VGDL interpreter eventually extend to 3D via the Three.js arm of PlayTrain? Probably not — VGDL is inherently 2D — but worth noting that the interpreter design should not preclude 3D variants if a research question demands them.

## Sources and references

- [Schaul, T. (2013). *A Video Game Description Language for Model-based or Interactive Learning.* CIG 2013.](https://course.ccs.neu.edu/cs5150f13/readings/schaul_vgdl.pdf)
- [Torrado, R. R. et al. (2018). *Deep Reinforcement Learning for General Video Game AI.* arXiv:1806.02448](https://arxiv.org/pdf/1806.02448)
- [Perez-Liebana, D. et al. — VGDL and the GVGAI Framework (book chapter)](https://gaigresearch.github.io/gvgaibook/PDF/chapters/ch02.pdf)
- Tsividis, P.A. et al. (2021). *Human-level reinforcement learning through theory-based modeling, exploration, and planning.* arXiv:2107.12544.
- Tsividis, P.A., Pouncy, T., Xu, J.L., Tenenbaum, J.B., & Gershman, S.J. (2017). *Human Learning in Atari.* AAAI Spring Symposium.

## Footnotes

[^schaul2013]: Schaul, T. (2013). *A Video Game Description Language for Model-based or Interactive Learning.* IEEE Conference on Computational Intelligence and Games. The original VGDL paper, explicitly positioned for "model-based or interactive learning" — the DSL was designed from the outset to support inference.
[^gvgai]: Perez-Liebana, D. et al. The General Video Game AI competition / framework, accumulating the canonical VGDL corpus over 2014-2019. <https://gaigresearch.github.io/gvgaibook/>
[^tsividis2017]: Tsividis, P.A., Pouncy, T., Xu, J.L., Tenenbaum, J.B., & Gershman, S.J. (2017). *Human Learning in Atari.* AAAI Spring Symposium.
[^tsividis2021]: Tsividis, P.A. et al. (2021). *Human-level reinforcement learning through theory-based modeling, exploration, and planning.* arXiv:2107.12544.
[^torrado2018]: Torrado, R. R. et al. (2018). *Deep Reinforcement Learning for General Video Game AI.* arXiv:1806.02448. Benchmarks DRL on 8 GVGAI games — the closest existing precedent to the full-corpus evaluation this plan proposes.
