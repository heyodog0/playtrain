# Handoff, 2026-09-05 — figure data consistency (encoder, curve sources, flappy)

Everything below is about *which runs each figure plots*, not about throughput.
Written so this can be dropped and resumed.

## 1. In flight

**Job 44559823** (`analogen-jaxbench/ppo_variants.sbatch`, array 1-12%4, kempner_h100).
PPO at the **IMPALA-CNN** encoder, 3 seeds, for the four variant games in
Figure 3B: `breakout.multi`, `qbert.v2`, `flappy_bird.dunk2`, `frostbite.jungle`.
Configs cloned from `outputs/ppo_impala_bigfish_s<seed>/config.json` with only
game/seed/log_dir changed, so the arm matches the suite's `ppo_impala` runs.
adv shadow tree + md5 provenance gate + `QJS_DIRTY=1`, same pattern as
`suite3_adv.sbatch`. Outputs land in `outputs/ppo_impala_<game>_s<seed>/`
(dots in game names become underscores), configs in `outputs/_ppovar/`.

When it lands: point Figure 3B's PPO arm at those dirs (see §3) and re-render.

## 2. Why: three figures were plotting different runs

- **Appendix suite figures** read `playtrain-paper/_suite4_curves.json`
  (24 games x 4 arms x 3 seeds).
- **Figure 3C** used to scan TB dirs with hardcoded run ids, and for
  `caveflyer`, `plunder`, `space_invaders` it fell through to `ppo_dirs()` ->
  `pv_p_*`, which are **Nature-CNN**. So three of its eight panels compared
  IMPALA-CNN against Nature-CNN while the caption claimed both were IMPALA-CNN.
  **FIXED**: `playtrain-paper/tools/plot_main_composite.py` `curves_for()` now
  reads `_suite4_curves.json` with the appendix's own band logic (EMA before
  min/max, PPO cut at 0.5M). `IMPALA_RUNS` / `IMPALA_FALLBACK` are now dead code.
  Panel A/B assets (frames) are not in the paper repo, so the composite must be
  re-rendered wherever those live.
- **Human wall-clock figure** used its own `rr_*` protocol runs.
  **CHANGED**: `playtrain-trainers/tools/human_study/rerun_curves_icnn.json` now
  takes step/value from `_suite4_curves.json` for the six games that are in the
  suite (`asteroids`, `breakout`, `seaquest`, `coinrun`, `caveflyer`, `plunder`);
  `vvvvvv` and `flappy_bird` keep their own runs. Run names and `sps` carried
  over so downstream is unchanged. Original at `rerun_curves_icnn.json.bak`.
  Render with `tools/human_study/plot_steps.py` (steps axis), not
  `plot_wallclock5.py` (time axis).

**This moves published numbers.** §4.3 crossings, old -> new:
`asteroids` IMPALA 10.2M -> 26.3M, PPO 7.1M -> 68.2M; `breakout` PPO never ->
68.2M; `seaquest` IMPALA 19.9M -> 30.5M, final 528 -> 715; `coinrun` 78.7M ->
81.2M; `plunder` 15.8M -> 16.1M. Main text ~L700 says "10M on asteroids and 20M
on seaquest" and needs 26.3M / 30.5M.
Two of those flips are knife-edge, not learning differences: PPO's final return
sits within a few percent of the human line on `asteroids` (658 vs 652) and
`breakout` (264 vs 242), so the first-crossing step is unstable there. Consider
reporting final returns alongside crossings.

## 3. Still to do

1. When 44559823 lands, repoint Figure 3B's PPO arm (currently `ppo_dirs()` ->
   `pv_p_*`, Nature-CNN) at the new `ppo_impala_*` dirs, and re-render.
2. `downwell` (Figure 1A): no IMPALA-CNN runs found by a scan of
   `outputs/*/config.json`, yet the main text quotes ~300 PPO / ~170 IMPALA.
   Locate those runs before deciding whether it needs a re-run.
3. Decide whether to adopt the suite-run substitution in the wall-clock figure
   (it is applied in the working tree) and update ~L700 if so.

## 4. flappy_bird: IMPALA gets exactly zero at frame skip 1

Measured from the TB dirs, all 100M steps:

| run | game | frame skip | final | max |
|---|---|---|---|---|
| impala_35032842/48/51 | flappy_bird | 1 | 0.00 | **0.00** |
| impala_35032853/54/56 | flappy_bird.dunk2 | 1 | 0.00 | **0.00** |
| impala_34979919 | flappy_bird | 4 | 1.81 | 8.15 |
| impala_34979921 | flappy_bird.dunk2 | 4 | 1.21 | 2.56 |

Three seeds at frame skip 1 never score a single point on either game; frame
skip 4 learns weakly. `matrix_impala_runs()` picks the lexicographically
greatest dir per seed, so the figures currently show the frame-skip-1 zeros and
the frame-skip-4 runs are unused. Re-running IMPALA at frame skip 1 is
pointless. This is the same pattern as `freeway` (IMPALA/V-trace at zero where
PPO learns, matching Espeholt et al. on ALE Freeway) and the paper now has two
such games.
