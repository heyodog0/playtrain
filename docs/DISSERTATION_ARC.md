# Dissertation Arc: PlayTrain, AnaloGen, and the Inductive-Bias Research Program

A planning document capturing the research trajectory from `PlayTrain` infrastructure through a multi-year cognitive-science dissertation using it as the empirical platform.

## Context

- **Researcher**: G1 Psychology PhD student at Harvard
- **Advisor**: Sam Gershman (Computational Cognitive Neuroscience Lab)
- **Affiliated**: Kempner Institute ecosystem; FASRC compute
- **Likely collaborator**: Kazuki Irie (AnaloGen synopsis author)
- **Adjacent tradition**: Theory-Based RL (Tsividis, Tenenbaum, Lake); intuitive theories (Battaglia, Allen, Ullman)
- **Career goal**: top-lab research internship (Anthropic / OpenAI / DeepMind / Google Research) in summer 2027 or later
- **Time horizon**: 4-5 year PhD; ship paper 1 in late summer 2026

## Reframing: From Toolkit Papers to a Cognitive Science Research Program

The initial framing of this work as "two infrastructure papers" (PlayTrain + JAX/rasterizer) was the wrong shape for a Gershman-lab PhD. Pure infrastructure papers don't serve a Psych PhD's career trajectory, and Sam would correctly push back on a second toolkit paper.

**The right shape**: a multi-paper dissertation where each paper pairs **substantive cognitive theory** with **controlled empirical studies enabled by PlayTrain infrastructure**. Infrastructure becomes methodology, not contribution.

The thesis-level research question:

> **Which architectural inductive biases bring deep RL agents toward human-like generalization, and what does the answer teach us about the cognitive architecture of learning?**

This is the question Lake et al. (2017, "Building machines that learn and think like people") posed as a manifesto and that has not been satisfactorily answered a decade later. The combination of LLM-authored variant environments + byte-exact human-RL comparison + JAX-fast agent training makes it tractable in a way it wasn't before.

## Why Theory-Based RL as LLM-Harness Is Not the Answer

Current Theory-Based RL has pivoted from the elegant Bayesian-inference-over-theory-space framing (Tsividis et al. 2021) to an LLM-as-theory-generator pattern. The LLM proposes hypotheses; a symbolic verifier checks them; a planner uses the LLM-derived theory.

This is uncompelling as cognitive science because:
- The LLM is doing the structured reasoning implicitly — uninspectable as a cognitive model
- "Theory" reduces to natural language descriptions, not structured representations
- It conflates the cognitive question ("how do humans structure prior knowledge?") with an engineering hack ("LLMs are good at game descriptions")
- Even when it works, it doesn't teach us anything about cognitive architecture

The interesting alternative: **deep RL agents with explicit, inspectable inductive biases** (object-centric perception, compositional structure, learned world models, schema-based representations), tested comparatively across controlled variant manipulations against human behavior.

## Substrate Decision: Why JS, Why PlayTrain

Captured in detail in `WHY_NOT_PYTHON.md`. Summary:

JS isn't just a UI choice — it's the substrate that uniquely supports the conjunction of properties this research program needs:

1. **LLM authoring fluency** — p5/canvas corpus dwarfs any Python game corpus
2. **Browser as universal client** — same artifact for human study + agent training + collaborator playtest
3. **Per-artifact dependency model** — durable to upstream drift; LLM-authored content is sandboxable
4. **Verified cross-runtime equivalence** (paper 2) — byte-exact replay across browser (humans) and headless (agents) is methodologically essential for human-RL comparison
5. **Shim-as-contract pattern** — the small enumerable API surface (`runtime/p5/p5-shim.mjs`) makes paper 2's infrastructure work tractable

Python with PyGame Zero or similar could in principle work, but pays for it in corpus, sandboxing, browser deployment, and the absence of a small enumerable rendering API to build verified equivalence around.

## Catalog Strategy: Variants, Not Novel Games

The realistic and theoretically stronger path is generating **controlled variants of base games**, not fully novel games:

| Variant axis | Cognitive capacity it probes |
|---|---|
| Visual (recolor, swap sprites) | Object identity vs surface features |
| Role-shuffle (AnaloGen Setting 2) | Relational binding, structure-mapping |
| Parameter (gravity, speed, density) | Continuous parameter generalization, meta-learning |
| Mechanic-variant (new rule on same scaffold) | Rule transfer, theory revision |
| Action-remapping (controls swapped) | Mechanic vs button-mapping grounding |
| Compositional (combine mechanics) | Compositional generalization |
| Difficulty (scaled parameters) | Robustness, curriculum |

Variants give causal control (isolate one axis at a time), have much lower LLM failure rate (bounded mutations of a working reference), and map directly to the cognitive-theory tests that motivate the research. AnaloGen Settings 1–3 are themselves variant manipulations by construction.

Modest first cut: 3-5 base games × ~8 variants per axis × ~4 axes = 100-200 controlled envs from a small validated base set. This is enough for the year-2 experimental program.

## Bayesian Inference as Methodological Backbone

Beyond agent-architecture comparison, the substrate enables a complementary methodological dimension: **Bayesian inference over generative models of human cognition, run on the same envs the agents are trained on.** This is the dimension that converts PlayTrain from a throughput substrate into a cognitive-modeling apparatus.

The pattern, following SIPS[^sips] and the broader Mansinghka / Tenenbaum / Goodman probabilistic-programs-of-mind tradition[^gen]:

1. Author env in PlayTrain (single source of truth, byte-exact across runtimes)
2. Specify a generative model of *what a human is doing while solving this env* as a probabilistic program in GenJAX[^genjax] — e.g., bounded-rational planner[^sips] parameterized by planning depth, particle count, prior over goals or role bindings, time pressure, exploration temperature
3. Observe human behavior (Prolific/MTurk via the same browser substrate that runs the agent training; no separate stimulus pipeline)
4. Run online Bayesian inference (SMC, particle filtering, or programmable inference via Gen's trace semantics) over latent cognitive state: *on each timestep, which role binding does the participant believe holds? How deep are they planning? What is their inferred reward function?*
5. Compare across participants, conditions, and variant axes — including comparison to agent-architecture posteriors under the same inference scheme

### Why this is uniquely enabled by PlayTrain's properties

- **Determinism + cross-runtime equivalence** mean likelihood evaluation in the PPL is well-defined. `p(action | latent_cognitive_state, env_state)` requires reproducible env dynamics across particles; the byte-exact substrate provides this by construction. Most prior PPL-over-RL work has been restricted to toy domains precisely because rich envs introduced uncontrolled stochasticity at the framework level.
- **Vmap-friendly env** (after the GPU backend lands) makes particle-filter inference at N_particles=10K+ tractable on a single GPU. This pushes full Bayesian cognitive modeling into the rich-env regime — previously inaccessible territory.
- **Variant axes provide a principled stimulus space for active experiment design.** Information-theoretic optimization picks the next variant to maximize disambiguation between competing cognitive theories. This is automated psych experiment design constrained by a controlled, theoretically-motivated stimulus manifold.
- **Browser-headless equivalence** means the same env serves the human study AND the inference engine — no separate stimulus pipeline to maintain or validate against drift.

### What this buys cognitively

This dimension transforms the dissertation from "do humans and agents solve the same tasks?" (behavioral comparison) to **"can we recover, on each trial, which cognitive process a human is using?"** (process-level model fitting). Trial-by-trial posteriors over (planning depth, role-binding belief, goal hypothesis, exploration policy) give a finer-grained empirical signature than aggregate behavior — and a natural target for theoretical claims about cognitive architecture.

Critically, this aligns with **resource-rational analysis**[^resource-rational] — the framing that humans optimize utility subject to computational cost. The PPL framework lets us fit subject-specific resource budgets and identify where on the rationality-resources frontier a participant population sits for each cognitive capacity. **This is directly the Gershman-lab home tradition**, applied to rich content-laden envs that resource-rational analyses have historically been unable to address at scale.

### Relation to LLM-harness Theory-Based RL

Earlier section critiques LLM-as-theory-generator approaches as engineering hacks that don't illuminate cognitive architecture. The Bayesian-inference dimension is the principled alternative the critique implicitly demands: **structured representations (PPL traces) + proper inference (programmable particle filters) + cognitive-theory commitment (bounded rationality, structure-mapping, resource-rational tradeoffs)**, with no LLM doing the structured reasoning implicitly. The substrate provides the env; cognitive theory provides the generative model; PPL provides the inference; humans + agents provide the behavior to fit.

## Multi-Paper Dissertation Plan

### Paper 1 (target: late summer 2026): the methods + AnaloGen paper

**Title (working)**: *PlayTrain: An LLM-authored RL environment substrate with controlled variant methodology for cognitive generalization studies*

**Contributions**:
1. **LLM-authored env substrate** — shim-as-contract; headless browser execution; 30+ p5 + 16 Three.js base games; variant-axis methodology
2. **C₁ multi-env runtime** — Worker Threads + path-batched native dispatch ("EnvPool for JS envs"); 3.8× framework throughput; ~84% of ALE end-to-end PPO
3. **5-check ProcGen-style validation harness** with strict byte-equality determinism
4. **AnaloGen case study** — agent-side results on Setting 2 (role-shuffling)

**Venue**: TMLR or NeurIPS Datasets & Benchmarks. Workshop submissions earlier (RLDM 2026, NeurIPS workshops).

**Collaborators**: Kazuki Irie (AnaloGen co-author); possibly Sam Gershman as senior.

**Status**: Mostly ready. Don't perfect; ship.

### Paper 2 (target: 2027): the cognitive science paper

**Title (working)**: *Inductive biases for human-like analogical generalization in reinforcement learning*

**Form factor**: Cognitive science paper, NOT a toolkit paper. Infrastructure appears in methods §, not as contribution.

**Empirical design**:
- 3-4 candidate agent architectures spanning different inductive biases
- 3-4 variant axes from AnaloGen Settings 1-3 family
- Paired human study on Prolific/MTurk
- Comparative analysis: which biases close which gaps?

**Candidate agent architectures** (pick 3-4):
- IMPALA-CNN + PPO (baseline; no explicit cognitive prior)
- Object-centric encoder (Slot Attention[^slot]) + PPO
- Schema Networks (Kansky et al. 2017) or similar object-relational agent
- DreamerV3 with object-centric front-end (combines world-model + object structure)
- Compositional / modular policy networks
- Theory-based agent (Tsividis-style, without LLM harness)

**Predicted result shape**:
> "Object-centric perception accounts for human-like behavior on visual variants but fails on role-shuffling without compositional policy structure. A combined object-centric + compositional agent closes ~70% of the human gap; novel-mechanic variants remain unsolved without explicit theory-revision components. Implications for the cognitive architecture of analogical reasoning."

**Why infrastructure matters** (methods §):
- Byte-exact rasterizer (paper 2 of original plan) ensures humans and agents see *identical* pixels — methodologically required for the comparison
- JAX backend enables training many agent variants quickly to test multiple architectures
- Variant-axis methodology lets us make causal claims about which env property requires which agent property
- **GenJAX-based cognitive process inference** (see "Bayesian Inference as Methodological Backbone") provides trial-by-trial posteriors over latent cognitive state — a richer comparison dimension than aggregate behavior. Agent architectures are compared to humans not only on success rate but on *which inferred cognitive process they most closely match*

**Venue**: *Cognition*, *Nature Human Behaviour*, *Psychological Review*, *Cognitive Science*. NOT TMLR/MLSys.

**Senior co-author candidates**: Sam Gershman (primary advisor); possibly Tenenbaum lab (Pedro Tsividis, Tomer Ullman, Kelsey Allen) for theory-grounding.

### Paper 3 (target: 2028): extension to another cognitive capacity

Same paradigm, different cognitive question. Candidate directions, in order of fit with the substrate's enabled methodology:

**Primary candidate — Resource-rational analyses of analogical structure-mapping via PPL inference.** Direct Gershman-lab continuity. Fit a resource-rational model of human structure-mapping (parameterized planning depth, role-binding particle count, exploration temperature, hypothesis-prior strength) to participant behavior on AnaloGen variants. Compare inferred resource budgets across participants, conditions, and stimulus difficulty. Test the central resource-rational prediction: *participants allocate computation toward the cognitive subroutine (perception vs. binding vs. planning) most informative for the current variant axis*. This is the paper that maximally exploits the Bayesian-inference methodological backbone introduced earlier.

**Secondary candidates:**
- **Theory-of-mind via Bayesian recovery of observer's model.** Two-agent setup: one agent (observer) watches another (actor) solve AnaloGen variants under role shuffles. Fit a Bayesian-ToM generative model to the observer's predictions of the actor's actions; recover the observer's inferred role-binding posterior. Connects to Gergely/Csibra ToM developmental work and Baker/Saxe/Tenenbaum BToM models.
- **Intuitive physics priors transfer across novel environments** (Battaglia/Allen tradition). Requires the Three.js arm; defer until that infrastructure decision lands.
- **Compositional generalization at scale** (Lake/Baroni SCAN tradition, extended to RL). Variant-axis methodology naturally supports compositional manipulations; pairs with PPL inference over composition operators.
- **Causal reasoning in RL agents and humans** (Pearl-adjacent + cog-sci). Variant axes can isolate causal mechanisms; PPL inference recovers participant causal models.

**Venue**: PNAS, Psychological Review, Trends in Cognitive Sciences.

### Paper 4 (target: 2029): synthesis or theoretical paper

A theoretical synthesis using results from papers 2-3 to argue what cognitive architecture deep RL agents need.

### Optional methods notes

The rasterizer + JAX infrastructure work can be documented as a separate methodological note (Behavior Research Methods or similar) if the audience needs the engineering details. But this is supplementary, not central.

## Infrastructure Roadmap

What gets built and when, in service of the research thread:

### Phase 1 (now → late summer 2026): paper 1 infrastructure

- ✅ PlayTrain substrate + headless runtime
- ✅ gym-gen authoring pipeline
- ⏳ C₁ multi-env runtime (in progress, see `MULTI_ENV_RUNTIME.md`)
- ⏳ Variant-axis methodology — 3-5 base games × 4 axes × 5-8 variants per axis
- ⏳ AnaloGen agent-side stabilization (analogen repo)
- Paper 1 writeup

### Phase 2 (Q3 2026 → Q1 2027): variant scaling + agent variety

- 100-200 controlled variant envs
- Agent architectures: object-centric (Slot Attention + PPO), DreamerV3 baseline, schema-based
- Hybrid PyTorch + JAX env pipeline (Path A) — see `JAX_PORT_PLAN.md`
- Async stepping (C₁ Phase 2 = EnvPool parity)
- Human study infrastructure (Prolific/MTurk integration; IRB through Sam's lab)
- Pilot human data on AnaloGen Setting 2
- **GenJAX integration spike**: pilot a SIPS-style particle filter over a single AnaloGen variant using GenJAX, recover trial-level role-binding posteriors on the pilot human data. Goal: working inference pipeline end-to-end on one base game before Phase 3 scales it.

### Phase 3 (Q2 2027 → Q1 2028): paper 2 experiments + writeup

- Full human study on AnaloGen variant axes
- 3-4 agent architectures trained across all variants
- Comparative analysis + cognitive modeling
- **PPL-based cognitive process inference**: scale the GenJAX pipeline from the Phase-2 spike to the full variant set; fit resource-rational parameters per participant; compare to agent-derived posteriors under matched inference
- Paper 2 submission

### Phase 4 (2028+): infrastructure as needed for papers 3+

- WASM rasterizer (paper 2 of original plan) — only if byte-exact pixel parity becomes a methodological bottleneck for a specific study
- Full JAX backend (Path B) — only if specific results need maximum throughput
- 3D / Three.js arm — only if a research question requires richer envs

Critical point: **don't build infrastructure speculatively**. Each piece ships when a research question demands it.

## Throughput and Path Choices

Detailed in `JAX_PORT_PLAN.md`. Strategic summary:

| Path | Speedup over current | Effort | When to choose |
|---|---|---|---|
| Current (C₁ Cairo + PyTorch) | 1× | shipped | now |
| C₁ + `torch.compile` | ~1.5× | days | immediately |
| C₁ + PufferLib training loop | ~2× | weeks | medium-term |
| Hybrid Path A (JAX env + PyTorch policy via dlpack) | ~10-30× | weeks | when paper 2 needs many agent variants |
| Optimized Path A (+ async stepping, CUDA graphs) | ~40-80× | months | when paper 3 needs massive ablations |
| Full Path B (Flax + PureJaxRL) | ~100-1000× | months + porting | when a specific result needs JAX-native peak |

Default: **Path A is the practical answer**. Full Path B only if a specific paper's experimental design requires it. The hybrid bridge preserves PyTorch flexibility for bespoke architectures (object-centric, modular, schema-based) that JAX makes painful.

## Strategic Positioning

### Scoop risk

Multiple adjacent threads are heating up (Genie-class env generation, Computer Use infrastructure, RLVR, JAX RL scaling, ML reproducibility). Combined chance someone publishes adjacent work in 18 months: ~50-60%. None compete head-on with the specific synthesis (LLM-authored JS + variant methodology + cognitive-theory testing), but the field's framing is converging.

Mitigations:
- Ship paper 1 in 2026, not 2027
- Workshop visibility throughout 2026-2027 (RLDM, NeurIPS workshops, CogSci)
- Public artifacts early (rasterizer spec, AnaloGen extensions)
- Engage potential collaborators sooner rather than later

### Collaborator outreach

**For paper 1**: Kazuki Irie (AnaloGen co-author); Sam Gershman (advisor).

**For paper 2**: Sam Gershman primary; Tenenbaum-adjacent researchers (Pedro Tsividis, Tomer Ullman, Kelsey Allen) as theory-grounding co-authors if reachable through Sam's network.

**For paper 3+**: depends on the specific cognitive question chosen.

**For infrastructure-side technical credibility** (if needed for paper 1 or a separate methods note): Eric Zhang (jax-js author) is the strongest candidate; Oxford FLAIR (Matthews/Lu/Foerster) for JAX RL credibility.

### Kempner connections

- **Kazuki Irie** — direct connection via AnaloGen (likely already engaged)
- **Sam Gershman** — primary advisor
- **Sham Kakade** (if active at Kempner) — senior RL voice; industry connections
- **Kanaka Rajan** — if Irie is in her group, she sees the work
- **Kempner Research Engineering Team** — possible institutional support for the infrastructure

### Internship strategy

The combined profile — *Psych PhD doing fundamental human-RL comparisons, with both cognitive theory and serious engineering chops* — is genuinely distinctive and aligns with multiple top labs:

- **Anthropic** — evals/model behavior team, Computer Use team, interpretability
- **OpenAI** — model behavior research, Operator/agents
- **DeepMind** — cognitive ML group, Genie/world models, evals
- **Google Research** — cognitive science of ML

Target: applications fall 2026 for summer 2027, after paper 1 is on arXiv.

Framing to use in pitches:
> "I build verifiable RL environment infrastructure specifically to enable human-RL comparison studies grounded in cognitive theory. The byte-exact substrate I'm developing has direct applications to visual RLVR and Computer Use training pipelines, beyond its cognitive-science use."

### Product angles (not pursued, but noted)

The infrastructure has plausible commercial relevance in:
- Verifiable visual eval infrastructure for VLM labs
- Computer Use / browser-agent training environments
- Reproducible psych replication infrastructure

These are not pursued in the dissertation but mentioned in industry-facing conversations because they signal awareness of the work's broader applications.

## Honest Open Questions

These remain load-bearing bets that the dissertation arc does not yet answer:

1. **Does LLM-authored content provide useful cognitive-research signal?** Validation gates the catalog, but whether variant manipulations produce theoretically clean RL tasks at scale is an empirical question.
2. **Does the variant-axis methodology generalize to richer cognitive capacities?** AnaloGen is the clean case; intuitive physics, causal reasoning, etc. may require richer envs (3D / Three.js arm).
3. **Will the candidate inductive biases (object-centric, compositional, etc.) actually close the human-RL gap empirically?** This is the central empirical question; the answer determines paper 2's contribution.
4. **Can human data collection happen at the scale needed?** Prolific/MTurk for AnaloGen is feasible; richer paradigms may need lab-based studies.
5. **Will the infrastructure investment compound across papers, or does each paper require new infrastructure?** Variant methodology should generalize; specific architectures (Dreamer-OC, etc.) may not.

## Decision Log

Key decisions made through the planning conversation:

| Decision | Rationale |
|---|---|
| Paper 2 reframed from "byte-exact rasterizer toolkit paper" to "cognitive science paper using infrastructure as methods" | Toolkit papers don't serve a Gershman-lab PhD; Sam wouldn't pursue it; cognitive contribution is the natural form factor |
| Variants over novel games for catalog scale | Causal control > catalog size; lower LLM failure rate; maps to cognitive theory tests |
| Skepticism of LLM-harness Theory-Based RL | Engineering hack, not cognitive science; doesn't illuminate architecture |
| Inductive biases as research thesis | Falsifiable, factorizable, cognitive-theory-aligned, Lake-manifesto-shaped |
| Path A (hybrid PyTorch+JAX) as default | Preserves bespoke-architecture flexibility; 10-30× speedup is enough |
| Ship paper 1 in 2026 | Plant flag before convergence; AnaloGen + PlayTrain is ready |
| Custom rasterizer deferred / made optional | Build only when a research question demands byte-exact pixel parity for human-RL comparison |
| Bayesian inference / GenJAX adopted as methodological backbone | Process-level cognitive modeling (not just behavioral comparison) is the natural form factor for a Gershman-lab PhD; the substrate's determinism + cross-runtime equivalence + LLM-authored variants are uniquely suited to PPL-over-rich-env that prior work has been blocked from |

## References

Foundational papers for the research program:

- Lake, B.M., Ullman, T.D., Tenenbaum, J.B., & Gershman, S.J. (2017). *Building machines that learn and think like people.* Behavioral and Brain Sciences.
- Tsividis, P.A., Pouncy, T., Xu, J.L., Tenenbaum, J.B., & Gershman, S.J. (2017). *Human Learning in Atari.* AAAI Spring Symposium.
- Tsividis, P.A. et al. (2021). *Human-level reinforcement learning through theory-based modeling, exploration, and planning.* arXiv:2107.12544.
- Gentner, D. & Markman, A.B. (1997). *Structure Mapping in Analogy and Similarity.* American Psychologist 52(1).
- Irie, K. (2026). *AnaloGen: Analogical Generalization Challenge for RL Agents.* Synopsis (internal, in `analogen/reference/`).
- Locatello, F. et al. (2020). *Object-Centric Learning with Slot Attention.* NeurIPS 2020.
- Kansky, K. et al. (2017). *Schema Networks: Zero-shot Transfer with a Generative Causal Model of Intuitive Physics.* ICML 2017.
- Hafner, D. et al. (2023). *Mastering Diverse Domains through World Models.* DreamerV3.
- Cobbe, K. et al. (2020). *Leveraging Procedural Generation to Benchmark Reinforcement Learning.* ProcGen; ICML 2020.

Bayesian inference / probabilistic-programs-of-mind tradition:

- Zhi-Xuan, T., Mann, J., Silver, T., Tenenbaum, J.B., & Mansinghka, V. (2020). *Online Bayesian Goal Inference for Boundedly Rational Planning Agents.* NeurIPS 2020. arXiv:2006.07532. (SIPS)
- Zhi-Xuan, T. et al. (2024). *Pragmatic Instruction Following and Goal Assistance via Cooperative Language-Guided Inverse Planning.* ICML 2024.
- Cusumano-Towner, M.F., Saad, F.A., Lew, A.K., & Mansinghka, V.K. (2019). *Gen: a general-purpose probabilistic programming system with programmable inference.* PLDI 2019.
- Lew, A.K. et al. *GenJAX: a probabilistic programming system in JAX.* <https://github.com/probcomp/genjax>
- Baker, C.L., Saxe, R., & Tenenbaum, J.B. (2009). *Action understanding as inverse planning.* Cognition.
- Lieder, F. & Griffiths, T.L. (2020). *Resource-rational analysis: Understanding human cognition as the optimal use of limited computational resources.* Behavioral and Brain Sciences.
- Gershman, S.J., Horvitz, E.J., & Tenenbaum, J.B. (2015). *Computational rationality: A converging paradigm for intelligence in brains, minds, and machines.* Science.
- Goodman, N.D., Tenenbaum, J.B., & The ProbMods Contributors. *Probabilistic Models of Cognition.* <https://probmods.org/>
- Baker, C.L., Jara-Ettinger, J., Saxe, R., & Tenenbaum, J.B. (2017). *Rational quantitative attribution of beliefs, desires and percepts in human mentalizing.* Nature Human Behaviour. (Bayesian Theory of Mind)

Internal documents:

- `WHY_NOT_PYTHON.md` — substrate decision rationale
- `JAX_PORT_PLAN.md` — JAX backend + custom rasterizer infrastructure plan
- `GPU_RUNTIME_PLAN.md` — GPU throughput strategy + V8-JIT direction (paper 3 alt) + architectural restructuring
- `MULTI_ENV_RUNTIME.md` — C₁ multi-env runtime investigation and design
- `GAME_TEMPLATE.md` (in gym-gen) — p5 game contract
- `THREE_GAME_TEMPLATE.md` (in gym-gen) — Three.js game contract
- `analogen/README.md` — AnaloGen current state and roadmap

---

## Footnotes

[^sips]: Zhi-Xuan, T. et al. (2020). *Online Bayesian Goal Inference for Boundedly Rational Planning Agents.* NeurIPS 2020. The SIPS algorithm: particle-filter inference over agent goals given observed actions, using a boundedly-rational PDDL planner as the agent model.
[^gen]: Cusumano-Towner, M.F. et al. (2019). *Gen: a general-purpose probabilistic programming system with programmable inference.* PLDI 2019.
[^genjax]: Lew, A.K. et al. *GenJAX: a probabilistic programming system in JAX.* <https://github.com/probcomp/genjax>. Trace-based PPL with jit/vmap-friendly inference primitives.
[^resource-rational]: Lieder, F. & Griffiths, T.L. (2020). *Resource-rational analysis.* BBS. Framework for modeling cognition as optimal use of bounded computational resources; closely tied to Gershman / Griffiths / Tenenbaum tradition.
