# Provenance

One entry per figure and table label in the paper, in paper order: the graphic,
the `reproduce.sh` step that redraws or checks it, the code, the data it reads,
and the cluster job that produced that data. Each job's as-submitted batch
script, `sacct` submit line and log head are under `reproduction/runs/<jobid>/`.
`bash reproduction/reproduce.sh --list` names the steps.

Where things are:

    data/                raw inputs: the 20 human sessions (study/, and study_rescored/
                         with VVVVVV's win bonus applied by replay), the 26 LLM
                         generation logs, the token counts
    figures/results/     evaluation returns, per-core and backend throughput
    figures/tables/data/ one measurement per table row x game (Table 1a, dbuf)
    figures/tables/tab1b_runs/  median SPS per game x arm (Table 1b)
    figures/scaling/     the thread-scaling measurements (Figure 4A)
    figures/outputs/     TensorBoard events and configs of the training runs;
                         per-command timings (percmd.json); suite curves.
                         A release asset: bash reproduction/fetch_data.sh
    figures/craftax/     the Craftax frames
    expected/            what each check compares against: the paper's printed
                         numbers (paper_values.json) and its figure files
                         (figures/); not an input
    manifests/           name mappings and run lists
    runs/<jobid>/        each cluster job: batch script, submit line, node, log head

## fig:env_efficiency — Environment efficiency

```
graphic:   figures/fig_env_efficiency.pdf
redraw:    bash reproduction/reproduce.sh env_efficiency
code:      reproduction/figures/tools/plot_env_efficiency_bestonly.py
           (+ reproduction/figures/tools/throughput_panels.py, which draws B/C/D)
```

## tab:train-throughput — Single-node training throughput

```
graphic:   tabular, main.tex L490
redraw:    bash reproduction/reproduce.sh t1a        (a)
           bash reproduction/reproduce.sh t1a_nodes  (a), node provenance
           bash reproduction/reproduce.sh t1b        (b)
code:      reproduction/figures/tables/t1a_agg.py, t1a_nodes.py, tab1b.py
data:      reproduction/figures/tables/data/     (a), one JSON per row x game
           reproduction/figures/tables/tab1b_runs/ (b), one file per game x arm: median SPS
           reproduction/figures/tables/nodes/t1a_nodes.tsv  (task -> game -> node)
```

## fig:learning — Generated environments and training curves

```
graphic:   figures/fig_main_D.png
redraw:    bash reproduction/reproduce.sh learning
code:      reproduction/figures/tools/plot_main_composite.py
           (+ throughput_panels.py for its bottom strip, shared with fig:env_efficiency)
data:      figures/outputs/*/tb/  the 96 runs' TensorBoard events (112 MB), and every
           run's config.json, which the script reads to select runs by content
manifests: reproduction/manifests/fig_learning_runs.tsv   (panel C's 48 run dirs)
           reproduction/manifests/variant_names.tsv       (panel B's paper vs repo names)
```

## fig:human_wallclock — Human play vs agent training

```
graphic:   figures/fig_human_wallclock.pdf
redraw:    bash reproduction/reproduce.sh human_cohort      cohort claims
           bash reproduction/reproduce.sh human_wallclock   the figure, pixel-compared with the paper's
           bash reproduction/reproduce.sh human_crossings   steps to the human mean
           bash reproduction/reproduce.sh human_rescore     replays every logged action to regenerate
                                                            data/study_rescored (needs  installed)
code:      reproduction/figures/human/plot_human_wallclock.py, crossings.py, cohort.py
           replay_all.py (rescoring), swap_vv_curves.py (VVVVVV curves)
data:      reproduction/data/study/*.json.gz            the 20 sessions as logged
           reproduction/data/study_rescored/*.json.gz   the same sessions with VVVVVV's +500 win bonus
                                                        applied by replay; every other game replays to
                                                        its logged score exactly
           reproduction/figures/human/rerun_curves_icnn_vvwin.json   agent curves; VVVVVV from the
                                                        win-bonus runs (playtrain-trainers: configs/paper/human_wallclock/)
```

## tab:dbuf-ablation — Double buffering

```
graphic:   tabular, main.tex L1413
redraw:    bash reproduction/reproduce.sh dbuf         the table body
           bash reproduction/reproduce.sh dbuf_check   the caption's claims
code:      reproduction/figures/tables/dbuf_tex2.py, dbuf_check.py
data:      reproduction/figures/tables/data/dbuf_t3_44861569_<game>.json  (24 files)
           reproduction/figures/tables/nodes/dbuf_jobs.tsv  (task -> game -> raw id)
job:       array 44861569 dbuf_t3_24, tasks 0-23, node holygpu8a15203,
           2026-09-06T15:00:50 to 2026-09-07T08:07:20
```

## fig:suite_trainers, fig:suite_enc_impala, fig:suite_enc_ppo — Full-suite curves

```
graphic:   figures/fig_suite_trainers.pdf, fig_suite_enc_impala.pdf, fig_suite_enc_ppo.pdf
redraw:    bash reproduction/reproduce.sh suite_check    composition
           bash reproduction/reproduce.sh suite_grids    all three figures
code:      reproduction/figures/tools/plot_suite_grid3.py, tools/check_suite.py
data:      figures/outputs/_suite4_curves.json  (24 games x 4 arms x 3 seeds)
```

## fig:craftax_views — Craftax-Classic top-down vs first-person

```
graphic:   figures/fig_craftax_views.png
redraw:    bash reproduction/reproduce.sh craftax_views    from the committed frames; pixel-compared
                                                           with the paper's PNG (reference/)
           bash reproduction/reproduce.sh craftax_frames   replays the episode and regenerates the
                                                           frames; needs  installed
code:      reproduction/figures/craftax/collect_frames.py, make_figure.py, check_figure.py
data:      reproduction/figures/craftax/frames/  seed 2, 258 steps, both views + the action log
games:     examples/games/multifile/parity/craftax_classic/     (craftax_classic)
           examples/games/multifile/variants/craftax_fp/        (the first-person variant)
           playable as craftax_classic and craftax_classic.first_person in games/
```

## tab:eval — Mean return over 8 held-out level seeds

```
graphic:   tabular, main.tex L1483
redraw:    bash reproduction/reproduce.sh eval          all 48 cells
           bash reproduction/reproduce.sh suite_check   the prose around the table
code:      reproduction/figures/tools/check_eval.py
data:      reproduction/figures/results/eval_iddp_suite.json   (committed, no archive needed)
           reproduction/figures/tables/nodes/eval_suite_jobs.tsv  (the 24 jobs)
```

## tab:bench-setup — The three throughput measurements

```
graphic:   tabular, main.tex L1524
redraw:    bash reproduction/reproduce.sh bench_setup
code:      reproduction/figures/tools/check_bench_setup.py
data:      no data of its own; every cell cross-references another label
```

## tab:bench-scaling — Thread scaling

```
graphic:   tabular, main.tex L1587
redraw:    bash reproduction/reproduce.sh bench_scaling
code:      reproduction/figures/tools/check_bench_scaling.py
data:      none committed -- the two throughput columns are panel A's constants
jobs:      PlayTrain 43780731; EnvPool 43779854 (10/20/40t) + 43570992 (80t)
           + the config matrix (5t); all on holy8a24307
```

## fig:envcost — Cost of one operation, and per-game step anatomy

```
graphic:   figures/fig_env_cost.pdf
redraw:    bash reproduction/reproduce.sh env_cost        the figure
           bash reproduction/reproduce.sh env_cost_check  the prose numbers
code:      reproduction/figures/tools/plot_env_cost.py, tools/check_env_cost.py
data:      figures/outputs/percmd.json, logic_probes.json, grid.json
job:       44381429 envcost_adv, node holy8a14102, -C sapphirerapids -c 1,
           2026-09-04; built by dependency 44381264 adopt_build_dc
```

## tab:llm-cost — Authorship cost and training throughput per artifact

```
graphic:   tabular, main.tex L1774
redraw:    bash reproduction/reproduce.sh llm_cost        offline, no API key
regenerate: GEMINI_API_KEY=... uv run --with google-genai \
              python -m playtrain.gen.count_tokens
code:      src/playtrain/gen/count_tokens.py  (the generator)
           reproduction/figures/tools/check_llm_cost.py  (the offline check)
data:      reproduction/data/llm_cost.json      the counts
           reproduction/data/tab_llm_cost.tex   the generated tabular
           reproduction/data/generation-logs/   26 logs, one per LLM call
```

## tab:validation — The four validation checks

```
graphic:   tabular, main.tex
source:    src/playtrain/runtime/validate.py
           check_api_compliance, check_determinism, check_observation_sanity,
           check_reward_terminal (a fifth, check_throughput, is optional and not in the table)
```

## tab:contrast — Qualitative properties of environment families

```
graphic:   tabular, main.tex L727
code:      none — a qualitative judgement table
data:      none measured
```

## tab:action-space — The default Discrete(8) action space

```
graphic:   tabular, main.tex L1008
redraw:    bash reproduction/reproduce.sh action_space
code:      reproduction/figures/tools/check_action_space.py
source:    runtime/action_spaces.json  ->  key "default8"
           src/playtrain/runtime/action_space.py  (the loader and contract)
```

## tab:step-return — What a step returns

```
graphic:   tabular, main.tex L1045
redraw:    bash reproduction/reproduce.sh step_return
code:      reproduction/figures/tools/check_step_return.py
source:    src/playtrain/runtime/env.py   (the contract and the defaults)
           src/playtrain/runtime/validate.py  (terminal states)
           native/qjs/qjs_host.cpp, native/aotfork/qjs_host_fork.cpp
```

## fig:action-spaces — Two entries from the action-space file

```
graphic:   lstlisting, main.tex L1067  (style=jsonfig, defined at L63)
data:      runtime/action_spaces.json
redraw:    bash reproduction/reproduce.sh action_space  covers the default8 rows
```

## tab:p5-subset — The p5.js subset the backend binds

```
graphic:   tabular, main.tex L1114
redraw:    bash reproduction/reproduce.sh p5_subset
code:      reproduction/figures/tools/check_p5_subset.py
source:    native/qjs/qjs_host.cpp  ->  BINDINGS[], registered in a
           loop with JS_NewCFunction (L327)
```

## tab:backend-pieces — The four pieces compiled into the backend

```
graphic:   tabular, main.tex L1140
source:    native/build_qjs.sh   (the build that compiles all four)
           crates/rasterizer/    (Rust staticlib)
           native/runtime/p5.cpp (the C++ p5 layer)
           native/frozenmath/    (OpenLibm, cloned at build time, fm_* symbols)
```

## tab:backend-ladder — The three backends behind Figure 4B

```
graphic:   tabular, main.tex L1226
data:      none live — the numeric line is commented out at L1229; the
           ladder's throughputs belong to fig:env_efficiency panel B
```

## fig:trainer_timeline — Three ways inference can work

```
graphic:   TikZ drawn inline, main.tex L1250-L1275. No image file and no
           generating script -- the picture is LaTeX source, so it redraws
           with the paper and has nothing to reproduce separately.
source:    the playtrain-trainers repository:
           playtrain-trainers: src/playtrain_trainers/impala/train.py
             `inference_mode` -- the three panels are its three values
           playtrain-trainers: src/playtrain_trainers/train_ppo_clean.py
             `double_buffer` and `_PingPongVecAdapter` -- panel C
```

## tab:hyperparams — Training configuration

```
graphic:   tabular, main.tex L1368
redraw:    bash reproduction/reproduce.sh hyperparams
code:      reproduction/figures/tools/check_hyperparams.py
source:    figures/outputs/s3_icnn_*/config.json   (IMPALA, 72 runs)
           figures/outputs/p3_icnn_*/config.json   (PPO, 72 runs)
           playtrain-trainers: src/playtrain_trainers/impala/train.py
           playtrain-trainers: src/playtrain_trainers/train_ppo_clean.py
```

## tab:envpool-config — The tuned EnvPool configuration

```
graphic:   tabular, main.tex L1560
redraw:    bash reproduction/reproduce.sh envpool_config
code:      reproduction/figures/tools/check_envpool_config.py
data:      reproduction/runs/43779854/ep_best_sweep.sbatch   (the as-run job)
```

## fig:generation and fig:backend — the two hand-drawn schematics

```
graphic:   figures/generation.png            (fig:generation,  main.tex L194)
           figures/architecture_schematic.png (fig:backend,    main.tex L325)
source:    NONE. Neither has a source file in any repo -- no .svg, .key, .ai
           or generating script. Confirmed by search.
```

## fig:game-interface and fig:variant-generation-example — the two tester screenshots

```
graphic:   figures/game-interface.png, figures/variant-generation-example.png
recipe:    just tester      # -> uv run --extra gen python tools/tester.py
           then localhost:3000
source:    tools/tester.py        (the UI in the screenshots)
           runtime/p5/raster.mjs  (what the centre panel renders through)
```

## fig:catalog — A catalog entry

```
graphic:   lstlisting, main.tex L1760  (style=jsonfig, defined at L63)
data:      games/catalogs/arcade_games.json  ->  the "donkey_kong" entry
consumer:  src/playtrain/gen/generate.py  ->  build_prompt()
```

## tab:envcost — Per-game drawing cost and single-core speed (Table 14)

```
graphic:   tabular, main.tex L1628
redraw:    bash reproduction/reproduce.sh envcost_table
code:      reproduction/figures/tools/check_envcost_table.py
data:      figures/outputs/percmd.json   (job 44381429; same file as fig:envcost)
```

