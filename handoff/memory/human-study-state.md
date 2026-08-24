---
name: human-study-state
description: "The human play study as of 2026-08-06 — collected, analysable set, what is in the paper, and what is still open"
metadata: 
  node_type: memory
  type: project
  originSessionId: 81477060-ad6e-48bb-8136-d0fdcd1f8994
  modified: 2026-08-06T13:57:06.114Z
---

The study ran. 30 sessions collected on Prolific; **only the latest 20 are analysable**
because flappy_bird's dynamics changed mid-collection (commit `65cbe24`, "hold the bird
until the first flap", deployed 2026-08-05T16:52Z). Sessions before it played a different
game. That split is 10/20 exactly, and the surviving 20 are all canvas 520px, so the
canvas non-uniformity warning no longer applies.

Games (final set, differs from earlier drafts — **coinrun, not bigfish**): asteroids,
vvvvvv, breakout, seaquest, coinrun, caveflyer, plunder, flappy_bird. Eight games,
100 s each, seeds 90000–90099, episodes capped at 2000 steps.

**Human means (n=20)** and how far above a random policy on the same seeds:
asteroids 652 (1.2x random), vvvvvv 297 (59x), breakout 242 (2.6x), seaquest 142 (1.9x),
coinrun 79 (19x), caveflyer 9.3 (3.2x), plunder 5.3 (**1.0x** — random matches humans in
100 s), flappy_bird 4.0 (random scores 0). Seven of eight improve within the block.

**In the paper already:** demographics ($N=20$, mean age 32.4, SD 9.0, 6F/14M), the
two-panel wall-clock figure (`fig:human_wallclock`, placeholder caption), and an ethics
statement disclosing consent, IRB, payment and the ten excluded sessions.

**Still open:**
- Prose parity numbers need updating after the rerun sweep; IMPALA's crossings roughly
  halve now that the GPU-overlap bug is fixed (see [[fasrc-trainer-throughput-traps]]).
- "a game IMPALA never learns at all" (flappy_bird) may become false — the rerun trains
  on the post-update game, and the old 0.0 may have been the stale version or a config fault.
- The caveflyer paragraph was **cut deliberately**: humans reaching the reward shows it is
  reachable, not that it is learnable, and ProcGen's own trainers solve real caveflyer — so
  the likely explanation is that the replica differs from the original. Belongs in the
  Discussion limitations passage, and §4.2's promise that human play "separates the two"
  should be withdrawn.
- Playability sentence for vvvvvv (59x random, a game nobody had played before an LLM
  wrote it) belongs in §4.2 next to the new-games paragraph.
- `tab:eval` still has no H column.
- Sessions record no game version — a game-file hash per block would make the version
  split checkable rather than inferred from deploy timestamps.

Pipeline: `playtrain-trainers/tools/human_study/`. Harness and data:
`playtrain/tools/HANDOFF.md`, `just study-pull` / `study-stats`.
See [[playtrain-human-study-plan]] for the original design.
