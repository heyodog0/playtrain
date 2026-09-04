# Every number that changes in the paper — adv (adopted) vs published

All PlayTrain arms use the adopted binary (merged main + determinism fix + fresh PGO,
`QJS_DIRTY=1`). Baselines unchanged. Same-node discipline preserved everywhere.

## 1. Table 1(a) — trainer-attached, PlayTrain only (agent-steps/s, 24 games)

| row | published | adv | change |
|---|---|---|---|
| IMPALA + Nature-CNN | 0.94M | **997,689** | +6% |
| IMPALA + IMPALA-CNN | 0.35M | *re-running (44381901)* | — |
| PPO + Nature-CNN | 171k | **177,786** | +4% |
| PPO + IMPALA-CNN | 64k | **66,583** | +4% |
| per-suite (IMPALA+Nature) | 0.91M / 1.01M | **985,269 / 1,023,001** | ~+8% / ~+1% |

**Reading:** barely moved. A 33% faster environment buys 4-6% of trained throughput
because these rows are GPU-bound, not env-bound. This *strengthens* the paper's
existing trainer-bound explanation (line ~539) rather than undermining it.

## 2. Table 1(b) — swap comparisons (same job, same node)

| swap | published | adv | ratio |
|---|---|---|---|
| ProcGen | 618k / 372k = 1.66x | **701,992 / 372,539** | **1.88x** |
| ALE | 873k / 175k = 4.99x | **917,289 / 171,423** | **5.35x** |

Both baselines reproduce their published values (372,539 vs 372k; 171,423 vs 175k),
which is the proof the node class matched. ALE was re-run pinned to holygpu8a15204,
the published row's exact node, precisely to make its absolutes comparable.

## 3. Figure 4 panels

NOTE the baselines differ and are NOT comparable to Fig 4A's ratio: panels C/D
compare against the ProcGen C++ library / ALE on ONE core; Fig 4A compares
against EnvPool at 80 threads. Quote geomeans against geomeans:
**1.35x per-core vs ProcGen** and **1.64x at 80 threads vs EnvPool** are the
consistent pair. The 1.87x is an ARITHMETIC mean across game means and should
not appear in prose (bossfight at ~5x inflates it; the figure's mean bar is a
geomean).

| panel | published | adv |
|---|---|---|
| C, per-core vs ProcGen | 1.47x arith mean, 7 of 16 wins, geomean 1.13x | **1.87x arith mean, 10 of 16 wins, geomean 1.35x** |
| D, per-core vs ALE | 6.95x | **8.1x** |
| B, backend ladder | 517 -> 4,952 -> 30,581 (9.6x / 6.2x / 59x) | **502 -> 4,374 -> 37,350 (8.7x / 8.5x / 74x)** |

## 4. Figure 4A — env-only scaling (the redesigned panel)

ProcGen16 geomeans by env threads (10 / 20 / 40 / 80):

| arm | curve |
|---|---|
| PlayTrain adv | 290,228 / 582,092 / 1,161,420 / **2,325,995** (2.00x per doubling) |
| EnvPool tuned (async+NUMA+affinity) | 355,451 / 587,070 / 931,786 / **1,413,748** |
| EnvPool as-shipped (sync1) | 178,217 / 278,042 / 417,106 / **468,997** |

ALE8: PlayTrain 665,642 -> **5,308,537**; EnvPool tuned -> **350,601**; as-shipped -> 238,829.

**Headline ratios at 80 threads: 1.64x ProcGen / 15.1x ALE** vs EnvPool's best
documented configuration; 5.0x / 22x vs as-shipped.

Two things the data says that the old figure did not:
- EnvPool tuned **wins at 10 threads** (355k vs 290k) and ties at 20. The claim is
  about scaling, not about winning everywhere — and that is the more defensible claim.
- The published "EnvPool flattens" shape is real but belongs to the as-shipped
  protocol; the tuned arm bends rather than flattens.

## 5. Appendix scaling table (published protocol, 1:1 replacement)

4.00x -> **5.22x** ProcGen, 15.50x -> **21.19x** ALE; 1.78M/3.95M -> **2.35M/5.39M**.
(Jobs 43891521/22, kempner fast-class node — independent of the matrix, and it
cross-validates the matrix anchor within ~1%.)

## 6. Table 7 — double buffering

1.35x published -> **1.25x** at 15 workers, **1.36x** at the Table-1(b) 12-worker
topology. Main-text line ~570 ("large part of this speed") softens accordingly.

## 7. Main-text lines to edit

| line | says | should say |
|---|---|---|
| ~519 / Table 1 | 372k / 618k | 372,539 / 701,992 (1.88x) |
| ~529 | "seven of the sixteen", 7.0x / 1.13x | ten of the sixteen, 8.6x / 1.35x |
| ~530 | "remaining nine" | remaining six |
| ~532 | 6x Node/V8, 59x browser | 8.5x, 74x |
| ~536-38 | "15 of 16 ... 1.7x ... miner 0.81x" | recompute per-game from the swap data |
| ~540 | "15x ALE and 4x ProcGen at eighty threads" | 15.1x / 1.64x vs tuned (or 22x / 5.0x vs as-shipped — depends which arm the panel shows) |
| ~541 | "EnvPool flattens ... which is remarkable" | must go; the flattening is the as-shipped protocol's, not the engine's |
| ~570 | "large part of this speed" | soften to the 1.25x/1.36x re-base |

## 8. Figure files staged

`playtrain/handoff/fig_preview_2026-09-03/` (committed on main) holds three
panel-A treatments — as-shipped only, two-arm, documented-best only — plus the
patched preview scripts. Composite renders of the full Fig 4 with adv data are in
the same directory.

On adoption the real pipeline needs: new raw files into
`playtrain-paper/results/env_throughput/`, and `_EXPECTED_PROCGEN` /
`_EXPECTED_ATARI` updated in `tools/plot_throughput_all.py` and
`tools/throughput_panels.py` (they guard the published values by checksum).

## 9. Still open

- **44382216** (array) + 44382217 / 44382221 / 44382222 (chained): ALL FOUR
  Table 1(a) rows re-running together on holygpu8a11101, starting ~21:18 on
  09-04, done ~02:30. The 15204 pin was abandoned — another user's 3-day job
  holds 64 of its 96 CPUs, so the ETA there was 09-07. All four rows on ONE
  node keeps the table internally consistent, which is what matters now that
  every published number is being replaced. The ICNN row runs one game per
  task because the
  single-job loop failed 20/24 — GPU state is not released between games under
  the heavier encoder. The *published* row had the same defect (its geomean covered
  15 of 24 games), so this fixes a pre-existing hole rather than one adv created.
- Panel A design: two-arm vs documented-best-only.
- Legend wording: "EnvPool (tuned)" preferred over "documented best" — EnvPool
  publishes no ProcGen benchmark at all, so provenance belongs in the caption.
- qbert/aim_trainer: published learning curves predate the style-cache fix.
  Footnote or retrain (minutes).
- flappy_bird / vvvvvv wall-clock configs (not in the suite3 manifest).
- Build policy: portable vs PGO-tuned as the released artifact.
