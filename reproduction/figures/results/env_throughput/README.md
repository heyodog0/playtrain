# Environment-layer throughput — raw measurement data

The data behind the published environment-throughput figure, recovered from FASRC
and committed so the figure derives from files rather than from constants typed
into the plot script.

| file | what |
|---|---|
| `qjs_raw4.txt` | PlayTrain (QuickJS + native rasterizer), 16 ProcGen replicas × 7 trials, one `<game> <steps/sec>` line per trial |
| `procgen4.json` | real ProcGen, same 16 games × 7 trials (`bench_compare.py --backend procgen`) |
| `sweep4.out` | the ProcGen sweep's console output, including the per-game table and the 1.47± mean ratio |
| `qjs_atari6_raw.txt` | PlayTrain, 8 Atari replicas × 7 trials |
| `ale_atari6.json` | ALE via `bench_compare.py --backend ale`, same 8 games × 7 trials |
| `compare_atari6.json` | merged Atari summary |
| `sweep6.out` | the Atari sweep's console output (geomean 6.7×) |
| `qjs_sweep.json` | the earlier 5-trial sweep superseded by `qjs_raw4.txt` — kept for the rasterizer-improvement comparison (mean 27.5k → 33.0k) |
| `backend_ladder_fasrc.json` | **panel (c)**: the Playwright → Node/V8 → QuickJS ladder, per-game across all 24 games plus geomeans |
| `pw_fasrc.json` | the Playwright arm's raw output |
| `backend_ladder/` | the ladder's other two raw arms (`qjs_fasrc.txt`, `v8_fasrc.txt`, `node_{pg,at}.json`) |

Panel (c) verifies from its raw arms with zero per-game mismatches and identical
geomeans: Playwright 517 → Node/V8 4,952 (9.6×) → QuickJS 30,581 (6.2×), i.e. 59×
end to end. Its three arms were measured by three different drivers (Node+Chromium,
Python harness, C loop) — see the caveat below.

Hardware: one FASRC Sapphire Rapids node (Xeon Platinum 8480+), **one core** per
measurement, `frame_skip=1`, 64×64 RGB. ProcGen sweep on `holy8a32607`, Atari on
`holy8a32603` — and in each sweep **both arms ran inside the same Slurm job at the
same core budget**, so no bar is compared against a number from different silicon.
The as-run submissions are committed in `reproduction/figures/as_run/`.

## Two geomeans, both correct

`sweep6.out` prints **6.68×** over six Atari games; the figure reports **6.95×**
over eight. Not a discrepancy — the sweep's own summary block iterates a hardcoded
six-game list (qbert, seaquest, pong, breakout, space_invaders, frostbite) while the
figure includes `freeway` and `asteroids`, which the sweep measured and wrote to
disk but left out of its printed line. Recomputed from this data: 6 games → 6.68×,
8 games → 6.95×. Quote the 8-game figure and say eight.

## Verified against the figure

`reproduction/figures/tools/throughput_panels.py` holds these values as inline constants.
They were checked against this data — recompute the QuickJS per-game mean and
sample SD from the raw trial lines, read ProcGen/ALE mean and SD from the JSONs:

**all 24 games agree to within ±1 frame/s, both suites, zero mismatches.**

So the transcription is faithful and the figure is not misreporting anything. The
remaining improvement is structural, not corrective: have the plotter read these
files so future edits cannot drift from the data.

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
