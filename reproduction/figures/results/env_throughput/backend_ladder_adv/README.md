# Backend ladder, adv re-measurement (job 43783367)

The Playwright and Node/V8 rungs of Figure 4B **as the paper's prose quotes them**.
Job 43783367 `ladderadv`, node holy8a32607, 2026-09-01, engine md5
46ea49991fe2c6321cb5a0a9b558aebe, one core, 24 games, 500 frames.
Submission and console output: `reproduction/runs/43783367/`.

| file | arm |
|---|---|
| `backend_ladder_fasrc_adv.json` | the three geomeans, derived from the arms below |
| `pw_fasrc_adv.json` | Playwright (headless Chromium via `pw_bench_fasrc_adv.mjs`) |
| `node_pg_adv.json`, `node_at_adv.json` | Node/V8, `bench_compare.py --backend node`, 5 trials, `fps_median` |
| `qjs_fasrc_adv.txt` | QuickJS at the adv build, `qjs_host <game>.js bench 0 80000` |

Recomputing the geomeans from the three raw arms over the 24 games reproduces the
JSON exactly: **Playwright 502 → Node/V8 4,374 → QuickJS 37,350**.

## Why this sits beside `../backend_ladder_fasrc.json` instead of replacing it

The published figure's QuickJS rung is not this file's 37,350. It is **58,827**,
the tier3 arm of job 44515373 (`../../../runs/44515373/raw_ladder.txt`), which is
what `../backend_ladder_fasrc.json` carries. But that file's Playwright and V8
rungs were never re-measured after the adv work: they are still the pre-adv 517
and 4,952.

So the two rungs the paper divides by come from here, and the rung it divides
comes from there:

| pair | V8 → QuickJS | browser → QuickJS |
|---|---|---|
| paper, main.tex L543 | 13.4x | 117x |
| 58,827 over **adv** 4,374 / 502 (this file) | 13.45x | 117.2x |
| 58,827 over pre-adv 4,952 / 517 (as plotted) | 11.88x | 113.8x |

The paper quotes the first pair; the repo draws the second. `bash
reproduction/reproduce.sh backend_ladder` prints all three lines so the gap is
visible rather than silent. Which pair is correct is a decision for the authors —
see flag 6 in `playtrain-internal/repro-loop/STATE.md`. Nothing here has been
changed to make the numbers agree.
