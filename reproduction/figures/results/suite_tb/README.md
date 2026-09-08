# Full-suite training curves — the Appendix A source data

TensorBoard event files and run configs for all 24 replica games, recovered from the
cluster (`outputs/impala_<job>/`) and committed here so the
appendix figure is reproducible from this repo. 480 KB total.

`reproduction/figures/tools/plot_suite_grid.py` reads this directory and writes `fig_suite_grid.{png,pdf}` into its `--out` directory.

## What these runs are

Uniform across all 24, verified from each run's own `config.json`:

| | |
|---|---|
| trainer | IMPALA / V-trace, **ImpalaCNN** encoder, feedforward (no LSTM) |
| topology | full node, **2 DDP learner GPUs** + 12 vec workers × 5 env threads |
| budget | **150M environment steps** (`total_steps: 150000000`; last logged step 149,094,400) |
| batch / unroll | 256 / 64, `frame_skip=1`, 64×64×3 RGB |
| seeds | **one seed per game (seed 0)** — these are the DDP2 suite runs, not the 3-seed matrix |
| logging | 91 points on `charts/ep_return_mean`, ~1.64M steps apart; `charts/sps` also present |

These are the same runs behind the 348k suite-geomean throughput figure, and the same
runs `eval_iddp_suite.json` evaluated. Note the budget: **150M, not 100M** — the 100M
configs are the `pv_*` variant-matrix and showcase family, a different set.

`ep_return_mean` is a windowed mean, so flat segments are real convergence rather
than logging artifacts.

## game → job

| game | job | game | job |
|---|---|---|---|
| bigfish | 34819869 | leaper | 34824293 |
| bossfight | 34824266 | maze | 34824294 |
| caveflyer | 34824267 | miner | 34824295 |
| chaser | 34824268 | ninja | 34824296 |
| climber | 34824269 | plunder | 34824297 |
| coinrun | 34824270 | starpilot | 34824298 |
| dodgeball | 34824271 | pong | 34824299 |
| fruitbot | 34824272 | freeway | 34824300 |
| heist | 34824273 | seaquest | 34824301 |
| jumper | 34824292 | space_invaders | 34824302 |
| | | asteroids | 34824303 |
| | | frostbite | 34824304 |
| | | breakout | 34824305 |
| | | qbert | 34824306 |

The plotter resolves game → directory by reading each `config.json`, not by parsing
paths, so renaming a directory cannot silently mislabel a curve.

## What the curves show, before anyone writes the caption

- **freeway and maze never leave zero.** Exploration failures, as the paper says.
- **caveflyer and ninja learn but do not survive greedy held-out evaluation**:
  training ends at 4.5 (random 1.6) and 11.4 (random 0.8), but greedy eval returns
  1.0 and 0.2. That is a *different* failure mode from freeway/maze — brittleness of
  the argmax policy or a generalization gap, not absence of a learning signal — and
  the appendix should name it as such rather than lumping all four together.
- **Five games are still rising at 150M**: asteroids, climber, dodgeball, plunder,
  starpilot. The budget bounds the curves, not the games; worth one sentence so the
  flat-vs-rising distinction is not read as convergence everywhere.
- **Counting "beats random" depends on which eval file you use.**
  `eval_iddp_suite.json` (these runs) gives **20/24**, failing caveflyer, freeway,
  maze, ninja. `eval_final_agents_b256.json` (the NatureCNN b256 runs) gives
  **21/24**, failing climber, freeway, maze. The internal handoff records 18/24.
  Settle which is canonical before Appendix B quotes a number; the figure here
  draws the dashed random rule from `eval_iddp_suite.json`, matching these runs.
