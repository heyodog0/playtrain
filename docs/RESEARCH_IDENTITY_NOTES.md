# Research Identity Notes

Personal strategic notes capturing the tension between research directions, advisor expectations, and intellectual identity. Not for sharing — internal working document. Companion to `DISSERTATION_ARC.md` (which captures the cleaner research plan) but more honest about open questions.

## The three modes

Patterns observed in self-reported cognitive states across different research activities:

| Mode | What it is | Examples in my work | Emotional valence |
|---|---|---|---|
| **Aspirational** | Lower-level theoretical work mapped onto complex RL domains | Vastola-style dynamics analysis; Prat-Carrabin bounded rationality; Carvalho mechanistic RL+cog | Want to be doing this; describes as "increasingly difficult" |
| **Natural** | Cognitive science with rich domains and observational data | Scratch repository remix trajectory analysis; AnaloGen human studies | "Completely different headspace"; comfortable; ideas generate easily |
| **Strategic** | Engineering infrastructure with industry translatability | PlayTrain, C₁ multi-env runtime, JAX port, custom rasterizer | "Impactful"; "translatable"; described in strategic terms, not emotional ones |

Key observation: these are *three different relationships to work*, not three different topics. The cognitive cost of switching between them is real and accumulates. Successful researchers typically have one primary mode with the others as secondary capabilities; trying to do all three at full intensity produces fragmented work and burnout.

## Signals worth weighting

### The Scratch project as data

I described the Scratch remix project as putting me in a "completely different headspace" than PlayTrain/rasterization. This is emotional/cognitive language, not strategic language. It's how people talk about work that fits them.

The project is also *literally in my original dissertation vision* — Scratch remixing is theory generation, transfer, and updating in a developmental/social/creative cognition context. I'm already doing the dissertation work; I just haven't been framing it that way.

This is a research-taste signal that's hard to fake. Worth weighting heavily.

### The "impact = engineering" framing might be partially false

I've been telling myself that PlayTrain/JAX work is more "impactful" and "industry-translatable." Critically examining this:

- Anthropic's model behavior / interpretability teams hire heavily from cognitive science backgrounds, not infrastructure backgrounds
- DeepMind's cognitive ML group (Saxe, Sheahan, etc.) does theory+behavior, not infrastructure
- Chris Olah's mechanistic interpretability work is closer to rigorous theoretical analysis than engineering
- Cognitive scientists with LLM/RL fluency are a *rarer* and more distinctive industry profile than engineers
- The most cited cognitive science work (Tenenbaum, Lake, Gershman) is theory, not infrastructure

The strategic framing of "engineering is the industry path" is partly a story I'm telling myself to justify the pull toward the work I find satisfying for engineering-aesthetic reasons. The honest picture is that *both* paths exist, and they hire for *research taste + execution*, not for specific methodological choices.

### The "LLMs are taking over" anxiety

This is real and many cog sci researchers feel it. The honest framing:

- LLMs achieve *performance* on tasks that look symbolic. They don't explain *mechanism*.
- Cognitive science questions (how do humans actually do this?) remain open even when LLMs do the task.
- The most LLM-invariant work is mechanistic / theoretical / mathematical — exactly the lower-level direction I'm drawn to. Going *more* mechanistic is the hedge against the LLM trend, not less.
- Pure-symbolic AI has been dying for 30 years (not because of LLMs). The interesting space has always been hybrid/structured.

The anxiety isn't wrong but it shouldn't push me toward engineering as a hedge — that's running away from the wrong direction.

## The political situation

### With Sam (primary advisor)

- Sam is bullish on TheoryCoder direction (LLM-as-theory-generator)
- I have intellectual skepticism of LLM-harness Theory-Based RL
- Sam likely doesn't want me doing engineering papers that take time from joint cognitive work
- His vision of me as a scientist is cognitive, not engineering

This is a values clash, not just methodology. Options I've considered:

| Option | Description | Risk |
|---|---|---|
| A | Reframe TheoryCoder critically (use LLMs as comparison, not as the theory) | Manageable; engages Sam's project without surrendering values |
| B | Propose adjacent work that's TheoryCoder-compatible but with my angle | Common path for interdisciplinary students |
| C | Push back explicitly on the LLM-harness direction | Some risk but Sam has produced students in many directions |
| D | Diversify advising (committee additions, co-advisors) | Low risk; common for interdisciplinary students |
| E | Switch labs | High cost; only if values clash is unresolvable |

Don't pretend E doesn't exist, but don't reach for it prematurely. Most likely path: some combination of A-D.

### With Kazuki Irie (incoming Yale CS)

- Senior PI for engineering work is structurally clean
- AnaloGen is his synopsis — he has direct skin in the game
- Different institution = doesn't compete with Sam politically
- Yale CS appointment = engineering papers are natural under his name
- Early-career faculty = needs publications; offering him senior author is mutual benefit

Key constraint: **don't bypass Sam.** Have the explicit conversation:

> "I want to publish a methods/architecture preprint on the JAX port with Kazuki as senior author at Yale. It's mostly engineering, somewhat outside your area, and won't displace my primary work with you. Sam, are you OK with this structure?"

Most likely outcome (~70%): Sam agrees with appropriate framing.

### Multi-PI structure that probably works

- **Cognitive papers**: Sam senior, me first
- **Engineering papers**: Kazuki senior, me first
- **AnaloGen**: bridge — both PIs involved
- **Dissertation committee**: include Kazuki as external

This is normal for interdisciplinary students and shouldn't generate political friction *if delivered transparently*.

## Publication strategy

### Don't try to "protect" ideas — establish visible priority

The mental model of "someone steals my idea" doesn't fit how the field works. Real defenses, ranked:

1. **arXiv early** (timestamps establish priority; ML/CS norms hold)
2. **Open-source implementation** (reimplementing costs months; code is moat)
3. **Coined terminology** (shim-as-contract, variant-axis methodology, EnvPool-for-JS)
4. **Ecosystem of users** (citations, soft endorsements)
5. **Specific empirical results tied to specific infrastructure** (hard to challenge without redoing)

What doesn't work: keeping ideas private (someone else might independently arrive), waiting for perfection (often increases scoop risk).

### Sequencing

| Month | Action |
|---|---|
| Now (May 2026) | Talk to Sam about JAX preprint authorship norms |
| June-July 2026 | Open-source variant tooling + C₁ with clean docs in PlayTrain repo |
| July-August 2026 | Submit paper 1 (PlayTrain + AnaloGen + C₁) to arXiv + TMLR |
| August-September 2026 | Workshop submissions: RLDM 2026, NeurIPS workshops |
| September-November 2026 | Draft + arXiv JAX-port preprint (Kazuki senior, 4-8 pages) |
| October 2026 | Apply for summer 2027 internships |
| Throughout | Public talks: Kempner internal, CogSci, lab visits |

The JAX preprint is a *priority-establishment artifact*, not a formal publication. It can be expanded later into a methods paper or folded into a bigger study. Cheap to produce, powerful as a flag-plant.

### Scoop risk reality check

Adjacent threads heating up: Genie-class env generation, Computer Use, RLVR, JAX RL scaling, ML reproducibility. Combined scoop probability over 18 months: ~50-60% but mostly *partial overlaps*, not head-on. None directly target the specific synthesis (shim-bounded LLM-authored JS + byte-exact JS↔JAX + variant methodology for cognitive theory).

Real risk isn't theft; it's that the framing becomes generic by 2027 if I'm slow. Mitigations: sticky terminology, open-source ecosystem, multi-paper arc, workshop visibility throughout 2026-2027.

## The actual question to sit with

Strategic stuff is secondary. The primary question:

> **What kind of computational cognitive scientist do I actually want to be?**

Candidate identities, each legitimate:

- **Theoretical / mathematical** (Vastola-adjacent) — closed-form analyses, dynamics; produces tools the field uses
- **Mathematical psychologist** (Prat-Carrabin-adjacent) — careful behavioral experiments with rigorous model fits
- **Mechanistic modeler** (Carvalho-adjacent) — structured computational models of specific cognitive phenomena
- **Large-scale empirical** — comparative studies across many tasks/agents (what PlayTrain enables)
- **Systems / engineering** — building infrastructure others use

Can't be all of these deeply. Have to pick a primary; let the others be secondary capabilities.

Signal pattern from this conversation: pulled emotionally toward "theoretical / mathematical" + "mathematical psychologist" axes; doing "large-scale empirical" + "systems / engineering" by strategic reasoning. The Scratch project signal points toward "mathematical psychologist with rich domain content" being the natural mode.

## Concrete experiment

Over the next ~4 weeks:

1. **Two weeks at 80% on Scratch + AnaloGen cognitive work.** Notice: do ideas come easily? Do I want to keep working past 6pm? Is writing fluent? What's the after-hours pull?

2. **Two weeks at 80% on PlayTrain engineering (C₁, JAX prototyping, rasterizer planning).** Same observations.

3. **Compare honestly.** Which felt like home? Which felt like obligation? Which produced more good ideas?

The experiment isn't about deciding forever. It's gathering data on myself before committing to a primary mode. Most students don't do this and end up locked in by inertia.

## Open questions I haven't resolved

1. **Am I drawn to engineering because I actually enjoy it, or because it feels safer / more legible / more industry-translatable than cognitive science work?** Honest answer probably depends on the week.

2. **Is "the lower-level work is increasingly difficult" a real difficulty signal (I lack the math fluency) or a switching-cost signal (collapsed by trying to do too many modes)?** If the latter, focusing would help. If the former, I'd need to invest in technical skill development.

3. **Does Sam's vision of me match what I actually want?** Don't know yet. Might require explicit conversation about identity, not just structure.

4. **Is the Scratch project the dissertation seed I haven't been labeling, or is it a side project I shouldn't over-elevate?** Worth investigating: how much of it could plausibly grow into a chapter?

5. **Would adding a co-advisor / committee diversification fix the values tension, or is the values tension fundamental?** Probably fixable for now via the multi-PI structure; might recur in 2-3 years.

6. **Am I building infrastructure (PlayTrain + JAX) because the science needs it, or because I enjoy the engineering itself?** Both are legitimate but they imply different scopes. If "science needs it," build minimal version; if "I enjoy it," it can be a parallel project.

## Things to NOT do

- **Don't try to do all three modes at full intensity.** This is the worst path. Pick a primary.
- **Don't sole-author engineering work without telling Sam.** Even if he's not on the paper, transparent communication matters.
- **Don't abandon the cognitive vision because LLMs feel threatening.** That's the wrong direction to flee.
- **Don't optimize for industry hireability at the cost of the work I actually want to do.** Both paths lead to industry; the wrong one will burn me out before I get there.
- **Don't keep ideas private hoping nothing gets scooped.** arXiv early instead.
- **Don't let the cognitive switching cost be invisible.** It's real data; track it.

## What I'll commit to anyway

Regardless of how the identity question resolves:

- Ship paper 1 (PlayTrain + AnaloGen + C₁) by late summer 2026. This serves all candidate identities.
- Open-source the infrastructure as I build it. Standard hygiene.
- Have the structural conversation with Sam about the multi-PI / Kazuki structure within the next month.
- Run the 4-week mode experiment honestly.
- Continue the Scratch project; don't drop it for engineering work even if engineering feels more urgent.

## References to anchor the identity question

Researchers whose work-style I should examine closely:

- **Arthur Prat-Carrabin** — perceptual decisions, bounded rationality, Bayesian model fits. Read his eLife and similar papers; study the texture of the method.
- **Josh Vastola** — physics + ML; theoretical dynamics analysis. Look at his recent preprints.
- **Wilka Carvalho** — RL + cognition, Kempner fellow. Closest model for what I might want to be.
- **Yael Niv** — RL + cognition with rigorous behavioral methods. Princeton.
- **Nathaniel Daw** — model-based / model-free RL in humans. Princeton.
- **Tom Griffiths** — Bayesian cognition, rational analysis. Princeton.
- **Pedro Tsividis** — Theory-Based RL canonical (pre-LLM-harness).
- **Sam Gershman** — my advisor's own work; understand his vision clearly before pushing back.

Look at three papers each from Prat-Carrabin, Vastola, and Carvalho. Not abstracts — actual methods. Notice the *texture* of the work. Do I feel intellectual excitement at the day-to-day implied by these papers? That's the signal.

---

Filed and parked. Don't relitigate; just run the experiment and revisit in ~6 weeks.
