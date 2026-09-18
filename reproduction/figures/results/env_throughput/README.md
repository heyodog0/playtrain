# Environment-layer throughput — raw measurement data

The data behind Figure 4 panels B, C and D, recovered from FASRC and committed so
the figure derives from files rather than from constants typed into the plot
script. Full provenance, including the cluster jobs, is in
`reproduction/PROVENANCE.md` § fig:env_efficiency; this file describes the files.

| file | what | job |
|---|---|---|
| `qjs_raw4.txt` | **panel C**: PlayTrain (QuickJS + native rasterizer), 16 ProcGen replicas × 7 trials, one `<game> <steps/sec>` line per trial | 44515373, tier3 arm |
| `qjs_atari6_raw.txt` | **panel D**: PlayTrain, 8 Atari replicas × 7 trials | 44515373, tier3 arm |
| `procgen4.json` | panel C baseline: real ProcGen, same 16 games × 7 trials (`bench_compare.py --backend procgen`) | 43783363 |
| `ale_atari6.json` | panel D baseline: ALE via `bench_compare.py --backend ale`, same 8 games × 7 trials | 43783364 |
| `compare_atari6.json` | merged Atari summary | 43783364 |
| `backend_ladder_fasrc.json` | **panel B**: the Playwright → Node/V8 → QuickJS ladder, per-game across all 24 games plus geomeans. QuickJS rung is tier3; the Playwright and V8 rungs are **pre-adv** and are not the ones the paper's prose divides by | QuickJS rung 44515373; lower rungs pre-adv |
| `backend_ladder_adv/` | the adv re-measurement of the two lower rungs (502 / 4,374), which **is** what the paper quotes, plus its three raw arms and a README | 43783367 |
| `pw_fasrc.json` | the pre-adv Playwright arm's raw output | pre-adv |
| `backend_ladder/` | the pre-adv ladder's other two raw arms (`qjs_fasrc.txt`, `v8_fasrc.txt`, `node_{pg,at}.json`) | pre-adv |
| `sweep4.out` | console output of the **superseded pre-adv** ProcGen sweep (plunder 95,442, mean ratio 1.47±). Backed `tools/plot_throughput_all.py` (removed 2026-09-18, in git history), the old figure — **not** anything in the paper | pre-adv |
| `sweep6.out` | console output of the same superseded Atari sweep (geomean 6.68× over six games). Its `NODE: holy8a32603` line refers to that old run | pre-adv |
| `qjs_sweep.json` | the earlier 5-trial sweep, kept for the rasterizer-improvement comparison (mean 27.5k → 33.0k) | older |

`sweep4.out` / `sweep6.out` are kept because they are the only record of the
pre-adv measurement, but nothing in the paper reads them. The as-run submissions
in `reproduction/figures/as_run/` are likewise the pre-adv versions; the
submissions behind the published figure are in `reproduction/runs/`.

Panel B geomeans over all 24 games, as this file carries them: Playwright 517 →
Node/V8 4,952 (9.6×) → QuickJS 58,827 (11.9×), i.e. 114× end to end. **The paper
says 13.4× and 117×**, which is the same QuickJS rung over the adv rungs in
`backend_ladder_adv/` (502 and 4,374) — that directory's README lays out the
difference, and `reproduce.sh backend_ladder` prints both. The ladder's three arms
were measured by three different drivers (Node+Chromium, Python harness, C loop)
— see the caveat below.

Hardware: FASRC Sapphire Rapids (Xeon Platinum 8480+), **one core** per
measurement, `frame_skip=1`, 64×64 RGB. The PlayTrain arm of panels B/C/D ran on
`holy8a32608` (job 44515373, 2026-09-04); the ProcGen and ALE baselines were
**reused** from `holy8a32607` (jobs 43783363/64, 2026-09-01) rather than
re-measured, because they do not depend on our engine build, and the Playwright
and V8 rungs likewise from 43783367 (see `backend_ladder_adv/`). So the
two sides of a bar are from different jobs and nodes of the same class, three
days apart — job 44515373's header states and justifies this.

## Two geomeans, both correct

`sweep6.out` prints **6.68×** over six Atari games while reporting eight would
give **6.95×**. Not a discrepancy — the sweep's own summary block iterates a
hardcoded six-game list (qbert, seaquest, pong, breakout, space_invaders,
frostbite) while `freeway` and `asteroids`, which it measured and wrote to disk,
are left out of its printed line. Both numbers describe the superseded pre-adv
sweep, not the published figure, whose ALE ratio is 12.62× over eight games.

## Verified against the figure

`reproduction/figures/tools/throughput_panels.py` holds the panel C/D values as
inline constants and refuses to draw if the committed data disagrees by more than
1 step/s. Recomputing the PlayTrain per-game mean and sample SD from the raw
trial lines and reading ProcGen/ALE mean and SD from the JSONs:

**all 24 games agree, both suites, zero mismatches.**

Stronger: `qjs_raw4.txt` and `qjs_atari6_raw.txt` are line-for-line identical to
job 44515373's `tier3` arm in `reproduction/runs/44515373/raw_panelc.txt` — all
24 games, all 7 trials. The transcription is faithful and the figure is not
misreporting anything. The remaining improvement is structural, not corrective:
have the plotter read these files so future edits cannot drift from the data.

## Caveat carried from the measurement, quantified

The two sides were driven by different harnesses: PlayTrain by the QuickJS host's
own C benchmark loop, the baselines by a Python stepping loop over their Gym APIs.
Matched workload, unmatched per-step driver overhead.

Measured rather than assumed — same machine, same games, same engine, only the
driver changed: bigfish 207,757 (C loop) vs 176,233 (in-process Python) = −15%;
coinrun 25,558 vs 28,645 = **+12%**. About ±15% with **no consistent direction**, so
the published numbers are not systematically inflated and a caption clause covers
it. This must *not* be "fixed" by re-measuring through PlayTrain's pipe-based
single-env API, which is 4x slower than the engine and not the path the trainer
uses either.
