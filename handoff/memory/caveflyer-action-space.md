---
name: caveflyer-action-space
description: "Discrete(8) cannot express rotate-while-thrusting, a likely cause of caveflyer's greedy-below-random result"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2bca5e23-474c-4c3a-9ee1-206ea1165411
  modified: 2026-08-04T01:46:35.065Z
---

Found 2026-08-03 while building the human-study harness.

`caveflyer.js:212-220` is a rotate-and-thrust flyer: LEFT/RIGHT rotate ±0.1 rad/frame,
UP thrusts along the heading, damping 0.95, no gravity. SPACE fires along the heading.
**`Discrete(8)` cannot express rotate-while-thrusting** (LEFT+UP is not in the ACTIONS
table at `game-env.mjs:42`), nor thrust-while-firing. The agent must discover an
alternating rotate/thrust pattern to fly at all.

This is a plausible mechanical explanation for caveflyer's greedy checkpoint scoring
*below* random (1.6 vs 1.0) in `tab:eval` — not "the game is too hard" but "the action
space cannot fly the ship." Same limitation applies to **asteroids** (rotate+thrust) and
**seaquest** (diagonals, and firing while moving vertically). The paper currently frames
caveflyer as an open question that human play will settle (`sec:experiments:432`).

The other five study games are unaffected: breakout, plunder and flappy_bird read only
LEFT/RIGHT/SPACE, and **coinrun (`:99`) and vvvvvv deliberately alias jump/flip onto
SPACE** so movement+action is legal. That aliasing is the fix pattern if the three games
are ever revised.

Connects the hardcoded-action-space item in [[paper-open-issues]] (`env.py:131`) to an
actual experimental failure. Measurable without running anyone: the harness logs a
per-game `foldedFrames` rate. See [[playtrain-human-study-plan]].
