---
name: playtrain-human-study-plan
description: "The agreed design for PlayTrain's human baseline study, settled 2026-08-02 but not yet run"
metadata: 
  node_type: memory
  type: project
  originSessionId: cd4c6b8b-fd45-4369-b921-2f401fe36bf4
  modified: 2026-08-03T00:51:41.038Z
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
Crafter five), so 20 is generous. The harness — link, order randomisation,
episode logging against seed — does not exist yet and is the only item with an
external dependency. Related: [[paper-open-issues]].
