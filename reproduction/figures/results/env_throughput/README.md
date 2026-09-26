# Environment throughput (Figure 4 B, C, D)

One core of a Sapphire Rapids node, `frame_skip=1`, 64x64 RGB. Jobs are in `reproduction/runs/`.

| file | what | job |
|---|---|---|
| `qjs_raw4.txt` | panel C, PlayTrain: 16 ProcGen games x 7 trials | 44515373 |
| `procgen4.json` | panel C, ProcGen: same games and trials | 43783363 |
| `qjs_atari6_raw.txt` | panel D, PlayTrain: 8 Atari games x 7 trials | 44515373 |
| `ale_atari6.json` | panel D, ALE: same games and trials | 43783364 |
| `backend_ladder_fasrc.json` | panel B geomeans: Playwright 502, Node/V8 4,374, QuickJS 58,827 | 43783367, 44515373 |
| `backend_ladder_adv/` | panel B's Playwright and Node/V8 per-game measurements | 43783367 |

`tools/throughput_panels.py` draws from these and refuses to draw if they disagree
with the published figure. PlayTrain is driven by its native C loop and the baselines
by a Python loop over their Gym APIs; measured on the same games, swapping the driver
moves throughput by about ±15% with no consistent direction.
