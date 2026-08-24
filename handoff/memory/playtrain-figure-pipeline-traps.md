---
name: playtrain-figure-pipeline-traps
description: Four ways PlayTrain figures silently showed the wrong data
metadata:
  type: project
---

Each of these produced a plausible figure from wrong data, caught only by
noticing an impossible value — not by an error.

- **Prefix globs drop whole arms.** `plot_main_composite.py` selected runs by
  directory prefix; twice a complete arm was invisible and rendered as a curve
  with no band. Select by **config content** (game, net, step budget, has tb).
- **A renamed superseded run sorts after its replacement.**
  `..._s0_partial94M` > `..._s0`, so "latest dir wins" preferred the stale runs.
  `_EXCLUDE` now covers `_partial`, `_failed`, `_dead`. *Tell: a byte-identical
  PNG after a rerun.*
- **Stacked bars on a log axis misreport shares** — segment height is the ratio
  across it, not its share. Composition panels must be linear 0–100%.
- **Denominators change correlations.** Drawing/total includes the fixed
  per-step cost, which is most of a cheap game's step; that manufactured a trend
  with size (r=0.34) that vanished on the work mix (r=0.10).

**How to apply:** before believing a figure, find a quantity that has a physical
bound (a share >100%, a game faster than an empty environment, a negative cost)
and check it. Those bounds caught every one of these. See
[[fasrc-quoting-base64]].
