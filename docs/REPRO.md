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

```sh
# playtrain-trainers
python benchmarks/plot_vec_scaling24.py          # --job 36696921 by default
```

**Recovered 2026-08-10.** The original plotter is still lost, but the
measurements were never lost — they were sitting in the cluster working tree,
untracked. `results/vec_scaling24_<game>_36696921.json` (24 games x 7 worker
counts), the job script `benchmarks/bench_vec_scaling24.sbatch`, and the job's
own stdout are now committed, and `plot_vec_scaling24.py` redraws the figure
from them. It reproduces the job's summary line for line: 148,083 env-steps/s
at 1 worker to 2,339,129 at 16, efficiency >=99% throughout, 24 games at every
worker count.

The redraw keeps the original's linear axes and adds one thing: perfect scaling
as a wide grey halo under the measured line. At >=99% the two coincide, which is
the whole result — drawn as two separate lines it would look like a bug.

---

## Tables

| table | source | status |
|---|---|---|
| `tab:eval` | `playtrain-paper/results/eval_iddp_suite.json` | **verified** — all 24 rows re-checked against the JSON 2026-08-10, 0 mismatches. Produced by `tools/eval_final_agents.py`; transcribed by hand (no emitter). |
| `tab:envcost` | `analogen tools/mktab_envcost.py outputs/percmd.json` | **verified** — regenerated from a clean clone, byte-identical to the paper for all 29 rows. Writes `outputs/figs/tab_envcost.tex`. |
| `tab:encoder-cost` | `playtrain-trainers/tools/bench_encoders.py` | recomputes from scratch; MMACs/params run anywhere, the timing columns need an H100. No saved output JSON. |
| `tab:llm-cost` | `uv run --with google-genai python -m playtrain.gen.count_tokens` | **verified** — all six rows reproduce exactly from the restored logs. Writes `results/llm_cost.json` + `tab_llm_cost.tex`. Needs `GEMINI_API_KEY` (or `GOOGLE_API_KEY`). |
| `tab:train-throughput` | `playtrain-trainers/benchmarks/mktab_train_throughput.py` | **fully derived, every row reproduces.** Swap block from `logs/*.verdict`, trainer x encoder block from `results/topology/`. **But the rows do not share a basis — see Open.** |
| `tab:contrast`, `tab:hyperparams` | hand-written | qualitative / config. `tab:hyperparams` still wants a re-read now that both trainers are IMPALA-CNN everywhere. |

---

## Open

- **`tab:train-throughput`'s caption is wrong about one row.** It says "Every
  figure is a geometric mean over the 24 games". Traced 2026-08-10, all four
  rows now derive exactly, but on three different bases:

  | row | value | games |
  |---|---|---|
  | IMPALA, Nature | 938,973 -> 0.94M | **24** (16 ProcGen 907,580 + 8 ALE 1,005,056) |
  | IMPALA, IMPALA-CNN | 349,027 -> 0.35M | **15** — ProcGen only, minus `miner` |
  | PPO, Nature | 170,805 -> 171k | **24** |
  | PPO, IMPALA-CNN | 64,202 -> 64k | **24** |

  `miner` failed in the DDP2 run (`suite_icnn_ddp2_37713531`, 11/16) and again
  in the retry (`suite_icnn_retry_37722252`, 4/5), and **no ALE game was ever
  measured under IMPALA-CNN.** Finishing that is the standing "topology 2x2"
  task; one game plus the 8 ALE games would close it.

  **The claim survives, the caption does not.** On the 15 games both encoders
  cover, Nature is 945,467 against IMPALA-CNN's 349,027 = **2.71x**, where the
  table's two numbers imply 2.69x — the mixed basis does not distort it. Same
  for the trainer gap: 5.50x under Nature, 5.49x under IMPALA-CNN. Either
  qualify the caption or finish the sweep.

- **`PROJECT_STATE.md` section 7 says 0.98M** for trained Nature throughput
  where the table says 0.94M. The table is right: 938,973 over 24 games, and
  section 11 of the same file quotes "939k". The 0.98M line is labelled
  "double-buffered" and is a different, older measurement. Fix the glossary row.
- Two hand-drawn figures have no source (above).

### Closed 2026-08-10

- Human study raw data — committed (`playtrain/dist/study-data`, 30 sessions).
  Pseudonymous Prolific IDs, user agents, screen geometry, consent records; no
  names or emails; private repo.
- `tab:llm-cost` — the logs for `qbert.v2`, `flappy_bird.dunk2` and
  `frostbite.jungle` were never lost. They were in git history at `3e60695`,
  reachable but not on any branch tip, dropped by a history rewrite. All 143 are
  restored and force-added, all six rows reproduce, and the union of call counts
  matches the paper exactly. **`games/logs/` is still gitignored — force-add any
  log a paper artifact depends on.**
- `fig:vec_scaling` — recovered (above).

## The rule this file exists to enforce

Every artifact that reaches the paper needs its generator *and its input data*
committed, in the same repo, on a pushed branch. Three separate times the
generator was committed and the data was not — `fig_vec_scaling` (lost),
`fig_env_cost` (recovered 2026-08-10), the human figure (recovered 2026-08-10) —
and once the data was committed and the generator was not. The failure is quiet:
the figure is already in the PDF and looks fine.
