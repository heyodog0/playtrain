# Where every figure/table number came from, 2026-09-08

Written for whoever picks up reproducibility. Everything is on FASRC unless said
otherwise. `$W` = `/n/holylabs/gershman_lab/Users/rtruong/analogen-jaxbench`.
Connect with the `fasrc` shell function; the venv is `$W/.venv/bin/python`.

**Read this first:** four inputs live in cluster `/tmp` and will vanish on
reboot. They are listed under "VOLATILE" at the end with how to rebuild each.

## Paper commits this describes

ICLR repo (`ICLR-PlayTrain-Fast-LLM-VGEs`), in order:

| commit | what |
|---|---|
| `2a7af7e` | Table 9 body -> 24 games, two panels of twelve |
| `b345fcc` | Figure 4 (human) on the corrected study data |
| `b9cd9ec` | Figure 3 panel C reading the suite curves |
| `880e030` | Figure 3 panel B PPO arm at IMPALA-CNN |
| `19b538a` | Figure 3 panel B base/variant side by side |
| `377029b` | Figure 3 re-rendered from the AUTHORITATIVE plotter |
| `a824f55` | Figure 12 swapped to the adv re-measure |

## Figure 3 (`fig_main_D.png`) -- the composite

**Plotter: `$W/tools/plot_main_composite.py`.** Run with `--no-throughput` for
the three-panel version the paper uses (without the flag it adds panel D, which
`9e16c18` folded into `fig_env_efficiency`).

    cd $W && export PYTHONPATH="$W/tools:$W/../playtrain-trainers/src:\
    /n/holylabs/gershman_lab/Users/rtruong/playtrain-wt-tuning/src"
    .venv/bin/python tools/plot_main_composite.py --no-throughput out.png

**DO NOT run `playtrain-paper/tools/plot_main_composite.py`.** Its line 1 says
SUPERSEDED and its header warns it "silently redraws the figure off stale runs".
It selects runs by directory PREFIX; the real one selects by CONFIG CONTENT
(`net == "impala"`, trainer inferred from `total_steps` vs `total_timesteps`,
`_EXCLUDE` for `_partial`/`_failed`/`_gamma`). I made that mistake on 09-08 and
pushed three figures from it before catching it; those are superseded by
`377029b`. The paper-repo copy was reverted to its pre-session state (`d6a95c8`).

There is also a stray copy at `$W/plot_main_composite.py` (root, not `tools/`)
which is my edited superseded version. **Delete it** -- it only invites the same
mistake.

Inputs: `$W/outputs/game_thumbs/` (25 PNGs, panel A), `$W/outputs/variant_strips/`
(73 PNGs, panel B frames), `$W/tools/throughput_panels.py` (panel D),
`_suite4_curves.json` (panel C; canonical copy is committed in `playtrain-paper`,
staged copy at `$W/_suite4_curves.json`).

Panel B PPO arms resolve, in preference order, to `outputs/p3_icnn_<game>_s*`
(suite, 100M), `outputs/_rerun/rr_ppo_<game>_s*` (human study, 100M), then
`outputs/ppo_impala_<tag>_s*` (job 44806731, 150M). `p3_nat_*` and `pv_p_*` are
the Nature-CNN arms and must never be picked.

## Figure 4 (`fig_human_wallclock.pdf`) -- human study

**Plotter: `$W/plot_steps_log.py`**, a patched copy of
`playtrain-trainers/tools/human_study/plot_steps.py`. Two fixes not yet upstream:

1. Box statistics computed in **log2** space, drawn on a linear axis with ratio
   ticks. `whis=1.5` on raw ratios under a log axis puts the lower fence at a
   NEGATIVE value, so no row could ever show a low outlier and whiskers ran to
   the minimum while claiming to be 1.5*IQR.
2. The final bin anchored at the real last step. Log-spaced bins plotted at their
   geometric centre made every curve end at 94-97M instead of 100M, and worse for
   whichever arm logged more finely.

    .venv/bin/python plot_steps_log.py /tmp/curves_bonus.json /tmp/sd_cohort OUTDIR

**Crossings** (the section 4.3 numbers): `$W/crossings.py CURVES.json STUDY_DIR`.

**Human scores are REPLAYED, not logged.** The vvvvvv +500 win bonus changes no
dynamics, so participants played a bit-identical game and their scores were
recomputed by re-executing the logged `(seed, actions)`. `$W/replay_all.py` does
this and only accepts a replayed score when it reproduces the logged one exactly
or differs by exactly the bonus; anything else keeps the logged value. Result:
1234/1234 episodes faithful, and only vvvvvv moves (284.7 -> 576.4 pooled, or
582.4 as the mean of 20 participant means, which is the paper's definition).

**The study served TWO `flappy_bird` builds.** The gate commit
(`playtrain` `65cbe240`, "hold the bird until the first flap") landed 2026-08-05
16:52 UTC, inside the 14:25-18:16 UTC session window. `$W/fb_which.py` replays
every flappy episode under both builds: sessions from 14:25-15:59 match ONLY the
pre-gate build (86 discriminating episodes), sessions from 17:00-18:16 match ONLY
the gated one (185). Zero exceptions. `plot_steps.py`'s `MIN_START =
"2026-08-05T16:52:00Z"` is what selects the consistent 20-participant cohort --
that constant is load-bearing and undocumented in the paper.

`dist/study/build-manifest.json` is dated 2026-08-23, three weeks AFTER the
study, and records the PRE-gate flappy hash. **Do not treat it as ground truth
for flappy.** It is correct for the other seven games.

## Table 9 (`tab:dbuf-ablation`) -- double buffering

Job **44861569**, `$W/dbuf_t3_24.sbatch`, 24 games, one per array task at `%1`.
Raw: `$W/outputs/dbuf_t3_44861569_<game>.json` (24 files). Aggregate with
`$W/dbuf_agg.py`; regenerate the LaTeX with `$W/dbuf_tex2.py` (two panels of 12)
or `$W/dbuf_tex.py` (single column).

Geomean 1.3441x, median 1.199, range 0.920 (pong) to 2.082 (miner); arm geomeans
904,154 double / 672,666 single. Distribution is BIMODAL -- 11 games at 1.47-2.08
and 11 at 1.02-1.22 -- and `pong`/`plunder` are below 1.0.

`--nodelist=holygpu8a15203` is PINNED because the dbuf ratio is a node property:
15203 measured 1.325x against 17402's 1.038x on the same binaries. The whole dbuf
lineage (published 37689188, adv re-base 43783186, this job) is on that one node,
so the absolutes are 15203's and are NOT peak throughput.

## Figure 12 (`fig_env_cost.pdf`) -- operation cost

Job `$W/envcost.sbatch`. The paper shipped the 2026-08-09 PRE-adv render until
`a824f55`; the adv re-measure had existed since 2026-09-04 as
**`$W/outputs/fig_env_cost_adv.pdf`** and is what is now in the paper.

Fits, `$W/outputs/probes.json` (adv) against `$W/outputs/probes_preadv.json`:

| fit | pre-adv | adv |
|---|---|---|
| `per_draw_call_us` | 0.2559 | **0.1714** |
| `baseline_us` | 6.4996 | **2.0398** |
| `per_pixel_us` | 2.966e-5 | 6.354e-6 |
| `fill_r2` | 0.9334 | **0.8487** |
| `per_state_update_us` | 0.2081 | 0.1721 |

Panel A therefore spans 79-390 ns (was 98-1304), which is what main.tex L767
quotes. Logic probes: `$W/outputs/logic_probes{,_preadv}.json`.

**Two prose numbers in `app:envcost` still disagree with the adv fits**, left as
the author's call: the text says a fixed overhead of 1.96 us where `baseline_us`
is 2.04, and says "some of the faster games spend 50% of their step() for
drawing" where the fastest are the least drawing-bound (pong 34%, flappy_bird
22%, plunder/freeway ~35%; the ~50% games are the SLOW ones, qbert.v2 ~48%,
maze ~97%).

`$W/outputs/tab_envcost_adv.tex` is a **STUB** -- two rows then the literal line
`... 29 rows`. The full per-game table exists only as the commented-out block at
main.tex ~L1596, which does carry adv values (miner 787 cmds / 7,574 sps). The
generator needs re-running if that table is ever uncommented.

## New training runs made this session

| dir | job | what |
|---|---|---|
| `outputs/_fig3bnew/{i,p}_{vvvvvv_v2,downwell_fresh}_s{0,1,2}` | 44926117 / 44926118 | 100M, ICNN, PRE-bonus vvvvvv.v2 |
| `outputs/_fig3bnew/i500_vvvvvv_v2_s{0,1,2}` | 45199583 | 500M IMPALA, PRE-bonus game |
| `outputs/_vvwin/{i,p}_{vvvvvv,vvvvvv_v2}_s{0,1,2}` | 45202952 / 45202953 | 100M, ICNN, WITH the +500 win bonus -- these feed Figure 4 |
| `outputs/_ppoab/ab{1,4}_vvvvvv_v2_s0` | 45249446 / 45249448 | A/B: is PPO faster on 4 GPUs at an IDENTICAL config (`$W/ppoab.sh`) |

Games staged at `$W/games_fig3b_new/` (`vvvvvv.js`, `vvvvvv.v2.js`,
`downwell_fresh.js`). Frame-search pool and strips:
`$W/outputs/showcase_strips/<game>{.png,_strip.npy,_pool.npz}`; search with
`$W/pick_frames.py`, re-select offline with `$W/select_from_pool.py`.

Two sbatch gotchas found the hard way: `train_impala` REJECTS `save_every_steps`
> 0 when `learner_gpus > 1`, and `train_ppo_clean` divides by
`save_every_updates` so 0 is a ZeroDivisionError rather than "never save". Also
`cmd | tail -N` followed by `echo "EXIT=$?"` leaves the script exiting 0, so a
crashed task reports COMPLETED -- `$W/fix_exit.py` patches that, and
`vvwin_*.sbatch` already propagates `rc`.

## VOLATILE -- in cluster /tmp, rebuild or rescue

| path | what | rebuild |
|---|---|---|
| `/tmp/sd_cohort` | corrected study data, Figure 4's input | `replay_all.py /tmp/studydata /tmp/sd_cohort /tmp/sg_cohort` |
| `/tmp/curves_bonus.json` | agent curves with vvvvvv from `_vvwin` | `swap_vv_curves.py <rerun_curves_icnn.json> /tmp/curves_bonus.json` |
| `/tmp/studydata` | the 30 raw sessions | copy of `playtrain/dist/study-data/*.json` (canonical, committed) |
| `/tmp/sg_cohort` | game files at study hashes | from `playtrain` git: `c539cb3:games/js/vvvvvv.js` (pre-bonus, 9ea945af), `65cbe240:examples/games/js/flappy_bird.js` (gated, 69371176), the rest from `examples/games/js` matching `dist/study/build-manifest.json` |

Figure 4 cannot be regenerated from committed inputs until `/tmp/sd_cohort`,
`/tmp/curves_bonus.json` and the two `plot_steps.py` fixes are in a repo. That is
the single biggest reproducibility gap left, and it is the exact failure
`playtrain-trainers/tools/human_study/README.md` was written to prevent.
