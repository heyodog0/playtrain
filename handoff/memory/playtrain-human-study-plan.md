---
name: playtrain-human-study-plan
description: "The agreed design for PlayTrain's human baseline study, settled 2026-08-02 but not yet run"
metadata: 
  node_type: memory
  type: project
  originSessionId: cd4c6b8b-fd45-4369-b921-2f401fe36bf4
  modified: 2026-08-04T01:46:44.121Z
---

Design Ryan settled on, not yet collected. IRB is believed to cover it.

**20 participants, 8 games, 2.5 minutes each**, about 23 minutes per session at
\$12/hr, roughly \$122 total with platform fees. Games: breakout, plunder,
seaquest, caveflyer, asteroids, coinrun, flappy\_bird, vvvvvv. That set
deliberately spans three categories — six suite replicas, one variant-pair base,
and one brand-new game — so the data supports playability claims for all three.
caveflyer is the diagnostic case, since its greedy checkpoint scores *below*
random (1.6 to 1.0). maze and freeway were dropped as too hard to be informative
in 2.5 minutes.

**The plots.** Primary artifact is a **wall-clock axis**, not the usual flat
human line: at 348k agent-steps/s a 100M-step run is 4.8 minutes, so a human
playing 2.5 minutes is a *point* in the middle of the agent's own training curve.
Same axis, same units. Also an H column in `tab:eval` beside R and G, and
optionally a human-normalised bar chart, `(agent - random)/(human - random)`.
Four of the eight games are already in panel C (seaquest, caveflyer, coinrun,
plunder); the rest need curves pulled from the suite runs.

**What matters for credibility:** label it a *novice* baseline (DQN's is two
hours of practice per game, this is 2.5 minutes), restrict to desktop with a
physical keyboard, time-box blocks in the harness rather than by instruction,
discard the episode in progress when the timer fires, randomise game order, and
pre-register an exclusion rule on keypress count rather than score.

Context: the field norm is 1-5 players (DQN used one professional tester,
Crafter five), so 20 is generous.

**Harness built 2026-08-03** in `playtrain/tools/`: `build-study.mjs`,
`study-templates.mjs`, `study-config.json`, `verify-replay.mjs`, docs in
`tools/STUDY.md`, recipes `just study-build|study-serve|study-verify`. Static
HTML, no React/TS/build step; it inlines `runtime/p5/p5-shim.mjs` + `raster.mjs`
(isomorphic by design) so the human plays through the agent's own runtime.
Verified: 13/13 browser episodes replay through the headless env with identical
score, frames and termination. Human input is *quantized* to `Discrete(8)` via a
held-key recency stack rather than macro-expanded — see
[[caveflyer-action-space]]. Only the upload endpoint is still missing, plus a
decision on which `frameSkip` matches the eval config behind `tab:eval` (trainer
configs disagree: 7 vs 1). Related: [[paper-open-issues]].
