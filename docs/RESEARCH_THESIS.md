# Research Thesis & Positioning

> Companion to [`JAX_PORT_PLAN.md`](./JAX_PORT_PLAN.md). The plan is *what to build*; this is *why it matters and how to defend it*. Where the two disagree, this document carries the framing and the plan carries the engineering schedule.

## 1. The one-sentence thesis

**Every `node-gym` environment becomes a scoreable, vmappable JAX function — making the catalog a generative-model library for large-scale Bayesian inverse planning / theory-of-mind, with the variant axes as controlled cognitive manipulations.**

The RL-benchmark framing (Papers 1 & 2 in the plan) is the *substrate-and-throughput* contribution. The deeper program is **rational analysis of behavior at GPU scale**: if an environment is a proper generative model, then inferring an agent's latent goals/beliefs from its behavior — `P(goal | behavior) ∝ P(behavior | goal) P(goal)` — becomes a vmap-over-particles computation instead of a Julia-speed bottleneck.

The inference layer is **deliberately swappable**: GenJAX, NumPyro, a hand-rolled SMC, or plain RL all sit on top of the same substrate. The durable property is *"the env is a JAX function with a scoreable density,"* not any one PPL.

## 2. Byte-exactness is an inference-correctness condition, not reproducibility hygiene

The plan sells byte-exactness as a graphics/systems virtue (reproducibility, durability to upstream drift). Through the inverse-planning lens it is something sharper:

> When the environment sits **inside** the generative model, its transition is **part of the likelihood density**. Uncontrolled environment stochasticity silently biases SMC / importance-sampling weights — you are not weighting the density you think you are. Byte-exact `(seed, actions) → trace` guarantees the *only* randomness in the joint is the randomness you explicitly modeled (the agent's Boltzmann policy, declared noise terms). That is precisely the quantity you want to infer over.

So: **byte-exactness is what makes each environment a *proper* generative function.** This is a stronger, more reviewer-resonant motivation than the reproducibility-crisis pitch, and for the cog-sci / probabilistic-ML audience it should be the headline.

## 3. Why JS, not Python — the load-bearing positioning

The obvious objection: *"If the fast path is transpiled JAX, why is JavaScript in the story at all? Aren't these just JAX envs like Craftax?"*

**The defensible answer locates the JS advantage precisely:**

> **JS is the human- and LLM-facing *authoring/interaction* substrate; JAX is the *execution* substrate; the verified JS→JAX bridge is the contribution.** We do not claim JS-the-runtime beats Python-the-runtime — it doesn't; the transpiled JAX is the fast path. We claim JS-for-authoring + JAX-for-runtime beats Python-for-both, because Python-for-both gives you neither the corpus nor the browser.

Two real JS advantages, stated without overclaim:

1. **Corpus / LLM fluency (the generative moat).** Millions of single-file p5.js / Three.js sketches exist on the web; "a complete playable Gym environment in one file" is comparatively rare. LLMs author a working p5 game far more reliably than a working PyGame/Pymunk env. *Caveat to measure, not assert:* the relevant fluency is over the **gym-shaped, shim-restricted dialect**, a narrower distribution than raw p5 — net-positive vs Python, but bounded.

2. **Browser = single-source-of-truth + zero-install human-in-the-loop.** One `.js` file is simultaneously (a) what the LLM wrote, (b) what a human playtests in a browser tab with no install or display server, and (c) via the bridge, what trains at GPU scale. Python's "human plays it" build is almost always a *separate reimplementation* — a fidelity gap and maintenance burden node-gym structurally avoids. Crowdsourced human baselines, demonstrations, and preference data fall out of "it's already a webpage."

Minor point in JS's favor: CPython has libm drift across platforms just like pre-fdlibm V8 did. **JS with a vendored fdlibm is a *cleaner* determinism story than Python**, not a worse one.

## 4. Calibrated pillar claims (overclaiming on any one hands reviewers an easy kill)

| Pillar | Honest claim | The overclaim to avoid |
|---|---|---|
| **p5 2D (continuous or gridworld)** | Strongest ground: clean, byte-exact-tractable, LLM-fluent. Lead with it. | — |
| **Three.js for 3D control** | Three.js is a **renderer**; pair it with a **deterministic JS/WASM physics engine (Rapier — Rust/WASM, advertises cross-platform determinism)**. Credible **rigid-body** substrate for *some* control tasks (locomotion, rigid manipulation). | "Three.js replaces MuJoCo." MuJoCo's value is contact-rich articulated dynamics; Three.js has no physics. Say "rigid-body control substrate," not "MuJoCo replacement." |
| **jax-js (browser-side JAX)** | A **reach / distribution** story: browser-side execution of the compiled op-graph for playtest, demos, approximate client-side rollout. | A **byte-exact fourth backend**. WebGPU is **f32-first**; f64 support is absent/spotty. The byte-exact thesis rests on f64 geometry, so jax-js will not be bit-identical to the CPU reference. Keep it *out* of the verified-equivalence core. |

The verified-equivalence core stays: **(WASM ≡ JAX-CPU) byte-exact; (JAX-GPU) deterministic-per-(GPU, XLA-version).** That is already strictly stronger than the field (Isaac/Madrona give up bit-exactness outright). Don't let the hardest 10% (cross-vendor GPU bit-exactness, f32 browser drift) gate the publishable 90%.

## 5. The missing half of the generative model: the agent/planner

Inverse planning infers over the **agent**, not the environment. The likelihood `P(behavior | goal)` *is a planner*. The plan models the environment generative function thoroughly and says nothing about the agent model. Open design questions:

- **Where does the planner live, and is it itself a JAX generative function?**
  - Gridworld / small discrete: **exact** softmax value iteration in JAX — no approximation in the agent model.
  - Entity / continuous: an amortized or learned policy as the likelihood (approximate).
- **Goal/utility specification language.** Dropping PDDL (InversePlanning.jl's backbone) in favor of JS games as the "domain" is cleaner for continuous games but **loses the symbolic goal language PDDL gave for free**. We need a way to express goals/rewards over raw JS game-state — and note this connects directly to the variant taxonomy: a *role-shuffle* variant is a goal/role relabeling; a *parameter* variant is a latent to infer. The goal language and the variant axes are the same object viewed two ways.

## 6. The gridworld convergence — why it's the first milestone

Three independent reasons land on the **same** subset:

1. **Easiest infrastructure** — tile-atlas observations collapse to integer gathers; no rasterizer, no transcendentals, no entity-ordering problem (NAVIX-class).
2. **Where exact planning is tractable** — softmax value iteration is exact and vectorizable on small discrete grids.
3. **Where SMC / particle inference is cleanest** — discrete state, small support, vectorizable belief updates.

The AnaloGen `analogen_nomemory_grid_v*` family is therefore not just the easy infra slice or a benchmark case study — it is the **inverse-planning flagship**. Start here.

## 7. What this imposes on the transpiler IR (decide now; costly to retrofit)

- **Define an IR; don't AST-walk straight to JAX.** A small ordered, traceable imperative IR with proven JS→IR and IR→JAX semantics-preservation turns byte-exactness into a *property of the IR* (provable once) instead of a per-game miracle (empirical, breaks on game #29). This is what survives catalog growth.
- **Distinguish nuisance randomness from addressable latent choices.** Today everything hides in `mulberry32` (fine for "rollout is a deterministic function of seed"). But to *infer* a hidden environment parameter — which the parameter-variant axis demands — those draws must be **addressable, scoreable random choices**, not anonymous PRNG advances. The IR needs both notions.
- **Emit `simulate` + `assess`, not just `step`.** A generative function needs forward simulation *and* density evaluation. The per-timestep step kernel **is** the generative kernel; a transpiled game loop → `lax.scan` aligns structurally with a PPL `Scan` combinator over timesteps.
- **Target plain traceable JAX / StableHLO, not any PPL's surface.** Lower to the stable compile target so library drift (and PPL API churn) doesn't bite — the same durability argument that motivates byte-exactness in the first place.

## 8. Honest risks a long horizon does *not* automatically buy down

1. **Is the LLM-authored corpus actually useful for RL / cognition?** A flawless byte-exact compiler over low-signal envs is still low-signal. The **science bet** (do the variant axes reveal something real about generalization / inference) is *separable* from the **infrastructure bet** and is **cheap to test now**, on Cairo, with no rasterizer or transpiler. Run it in parallel from day one. This is the one risk that can quietly waste the years.
2. **Cross-vendor GPU bit-exactness vs XLA reassociation** — may never be guaranteed by XLA. Mitigation: scope byte-exact to the CPU reference; deterministic-per-version on GPU. (See §4.)
3. **Inference-programming maturity.** Gen.jl has mature programmable inference (custom proposals, involutive MCMC, SMC rejuvenation); JAX PPLs are catching up. **Audit the specific inference moves your InversePlanning.jl work relied on against your chosen JAX PPL *before* committing.** A hard dependency on a missing combinator is a year-sized risk.
4. **Corpus fluency over the restricted dialect** (§3, pillar 1) — measure it.

## 9. Sequencing — each year ships even if the next bet fails

| Horizon | Build | Ships as |
|---|---|---|
| **Year 1** | Gridworld fast path (LLM-authored, NAVIX-class) **+ IR/dialect design** **+ the science bet on existing Cairo games** **+ exact VI planner → inverse planning on `nomemory_grid_v*`** | A clean benchmark paper *and* a first inverse-planning-at-scale result |
| **Year 2** | Custom rasterizer (Rust→WASM) + WASM ≡ JAX-CPU byte-exact | The "verified property" paper |
| **Year 3** | General transpiler + entity/continuous games + GPU determinism + Three.js/Rapier rigid-body arm | The full-vision paper |

Failure at Year 3 does not retroactively kill Years 1–2.

## 10. Two cheap experiments that can kill the thesis early — run before building infra

1. **One-primitive GPU byte-exact test.** Rasterize *one circle* byte-identically between WASM and JAX-on-GPU for 100 seeds. If this fails, Phases 0–2 of the plan were wasted weeks. (See §4 — likely scope to CPU reference instead.)
2. **Hand-port one entity-list game** (e.g. `asteroids`) to byte-exact JAX *by hand*, measuring how much it's forced into sequential `lax.scan` and how the dynamic-iteration rejection loops behave under vmap. This calibrates the transpiler's true difficulty before you build it.

If both pass, the rest is engineering. If either fails, you've saved months — and the gridworld fast path is still a paper.
