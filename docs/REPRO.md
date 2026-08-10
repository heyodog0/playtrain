# Reproducing every figure and table in the ICLR paper

One row per artifact: what draws it, what it reads, and whether a clone is
enough. Written 2026-08-10 after auditing all 15.

The pipeline spans four repos, so this file is the index. **`playtrain` is
canonical for game code**; the plotters live next to the data they read.

| repo | remote | branch |
|---|---|---|
| `playtrain` | `heyodog0/playtrain` | `main` |
| `playtrain-paper` | (paper repo) | `main` |
| `playtrain-trainers` | (trainers repo) | `main` |
| `analogen-jaxbench` | `heyodog0/analogen` | **`handoff-2026-08-09`**, not `main` |

`analogen`'s `main` is a "minimal, 5-game catalog" cleanup that the figure code
was never written against. Check out the branch; do not rebase onto main
without re-running the figures afterwards.

---

## Figures

### `fig:learning` — `figures/fig_main_D.png` (Figure 4)

```sh
# analogen-jaxbench, on FASRC (reads TB dirs under outputs/)
.venv/bin/python tools/plot_main_composite.py outputs/figs/fig_main_D.png
```

Four panels: 24 thumbnails, variant pairs, 16-game learning curves, env
throughput. Inputs, all now committed on the branch:

- `outputs/game_thumbs/*.png`, the variant strips from `render_variant_strips.py`
- `results/env_throughput/` — panel D
- `tools/throughput_panels.py` — shared with the standalone throughput plot so
  the two cannot diverge

Panels B/C read ~100 MB of TensorBoard events that live only on cluster
scratch. `outputs/fig4_curves.json` (3.7 MB) is a frozen extract of the one
scalar the plotter uses, for all **16 games x 3 seeds x 2 trainers, 96 runs, 0
missing** — regenerate it with `tools/extract_fig4_curves.py`. It is the backup
if scratch is purged; the plotter itself still reads the raw dirs.

**There is a stale second copy** at `playtrain-paper/tools/plot_main_composite.py`.
It predates the 16-game selection and `_EXCLUDE`, so running it silently redraws
the figure off superseded `_partial` runs. Its docstring says so. Use the
analogen copy.

### `fig:human_wallclock` — `figures/fig_human_wallclock.pdf` + section 4.3

```sh
# playtrain-trainers
python tools/human_study/plot_wallclock5.py \
    tools/human_study/rerun_curves_icnn.json <study-data> <out>
python tools/human_study/crossings.py \
    tools/human_study/rerun_curves_icnn.json <study-data>   # the 4.3 numbers
```

`_icnn` is the arm in the paper — both trainers IMPALA-CNN. `_nature` and the
unsuffixed file are earlier arms; keep them apart. **Never hand-edit the 4.3
crossings** — `crossings.py` copies its participant parsing from `plot_steps.py`
so the threshold is exactly the line the figure draws.

`<study-data>` is `playtrain/dist/study-data` (30 sessions, 6.2 MB), pulled with
`just study-pull`. **It is gitignored and exists on one laptop** — see Open below.

### `fig:suite_grid` — `figures/fig_suite_grid.pdf`

```sh
# playtrain-paper -- fully self-contained
python tools/plot_suite_grid.py
```

Reads `results/suite_tb/` (committed, 480 KB). See that directory's README for
what the runs are: 150M steps, one seed, ImpalaCNN. Note the caption in the
paper says 150M/1-seed while panel C of Figure 4 is 100M over three — different
runs, and the text should not imply otherwise.

### `fig:envcost` — `figures/fig_env_cost.pdf`

```sh
# analogen-jaxbench
.venv/bin/python tools/plot_env_cost.py \
    outputs/percmd.json outputs/logic_probes.json outputs/grid.json OUT
```

Verified 2026-08-10 to rebuild from a clean `git clone` of the branch. Upstream
of it: `tools/gen_probes.py`, `gen_logic_probes.py`, `gen_grid_probes.py` write
the probe environments; `tools/percmd_measure.py` prices each p5 primitive
separately and counts each game per binding. **Run `percmd_measure.py`, never a
flat per-command rate** — see `HANDOFF_2026-08-09.md` §3 for why that was wrong.

### `fig:generation`, `fig:backend` — `generation.png`, `architecture_schematic.png`

Hand-drawn. **No source file in any repo** — no `.svg`, `.key`, or script. A
reviewer asking for a change means redrawing from scratch.
`playtrain/tools/fig_schematic.py` is a *draft replacement* for the backend
schematic (it fixes two things the current drawing gets wrong: one QuickJS
engine per environment, and one observation buffer rather than two that swap).
It is not what produced the figure in the paper.

### `fig:anatomy`

A `lstlisting` inline in the `.tex`, abridged from `examples/games/js/bigfish.js`
(committed). Nothing to run.

### `fig:vec_scaling` — `figures/fig_vec_scaling24.pdf`

**Not reproducible. No generator, no data, anywhere.** The only trace is job
`36696921` in `PROJECT_STATE.md`. This is the figure whose loss prompted the
human-study pipeline to be committed in the first place, and it was never
recovered.

---

## Tables

| table | source | status |
|---|---|---|
| `tab:eval` | `playtrain-paper/results/eval_iddp_suite.json` | **verified** — all 24 rows re-checked against the JSON 2026-08-10, 0 mismatches. Produced by `tools/eval_final_agents.py`; transcribed by hand (no emitter). |
| `tab:envcost` | `analogen tools/mktab_envcost.py outputs/percmd.json` | **verified** — regenerated from a clean clone, byte-identical to the paper for all 29 rows. Writes `outputs/figs/tab_envcost.tex`. |
| `tab:encoder-cost` | `playtrain-trainers/tools/bench_encoders.py` | recomputes from scratch; MMACs/params run anywhere, the timing columns need an H100. No saved output JSON. |
| `tab:llm-cost` | `playtrain/src/playtrain/gen/count_tokens.py` over `games/logs/` | **3 of 6 rows unverifiable** — see Open. |
| `tab:train-throughput` | — | **no emitter and no data file.** The numbers exist only as prose in `PROJECT_STATE.md`. `plot_train_throughput.py` is a different artifact with hardcoded dicts. |
| `tab:contrast`, `tab:hyperparams` | hand-written | qualitative / config. `tab:hyperparams` still wants a re-read now that both trainers are IMPALA-CNN everywhere. |

---

## Open

- **Human study raw data is on one laptop.** `playtrain/dist/study-data`, 30
  sessions, 6.2 MB, gitignored via `dist/`. It is the only copy of data behind a
  main-text figure and every number in 4.3, and unlike a training run it cannot
  be regenerated. It carries pseudonymous Prolific IDs, user agents, screen
  geometry and consent records — no names or emails. Needs a deliberate decision
  about where it is allowed to live before it is committed anywhere.
- **`tab:llm-cost`: logs for `qbert.v2`, `flappy_bird.dunk2` and
  `frostbite.jungle` are not on this machine at all.** `games/logs/` is
  gitignored wholesale, so only 18 force-added files survive and those three
  artifacts' rows cannot be re-tokenized. Check the cluster and the mini before
  assuming they are gone. New logs are invisible to git by default — force-add
  any log a paper artifact depends on.
- **`fig:vec_scaling` is unreproducible** (above). Either re-run the sweep or
  drop the figure.
- **`tab:train-throughput` has no checkable provenance** (above).
- Two hand-drawn figures have no source (above).

## The rule this file exists to enforce

Every artifact that reaches the paper needs its generator *and its input data*
committed, in the same repo, on a pushed branch. Three separate times the
generator was committed and the data was not — `fig_vec_scaling` (lost),
`fig_env_cost` (recovered 2026-08-10), the human figure (recovered 2026-08-10) —
and once the data was committed and the generator was not. The failure is quiet:
the figure is already in the PDF and looks fine.
