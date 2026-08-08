# PlayTrain project state

Working notes for the ICLR 2027 submission, written so that work can resume on a
different machine without re-deriving anything. Current as of **2026-08-06**.

Everything here is either measured, verified against a source, or explicitly
flagged as unverified. Where a claim is an inference rather than a measurement it
says so.

---

## 1. Repositories

| path (under `~/code/lab/playtrain/`) | what it is |
|---|---|
| `playtrain` | the harness: games, runtime, human-study tooling, `justfile` |
| `playtrain-trainers` | trainers plus `tools/human_study/` (the figure pipeline) |
| `ICLR-PlayTrain-Fast-LLM-VGEs` | the paper, synced bidirectionally with Overleaf |
| `playtrain-paper` | older figure scripts; superseded for the human figure |
| `playtrain-internal` | internal docs, handoffs |
| `playtrain-claude-memory` | assistant memory mirror |

---

## 2. Cluster access

Use the `fasrc` zsh function, never `ssh fasrc` directly. It keeps one SSH
ControlMaster alive so authentication happens at most once per 12 h.

```sh
fasrc '<command>'
```

- If not already authenticated the first call silently re-auths for ~20 s (up to
  60 s) with no output. That is normal — wait it out, do not shorten the timeout.
- Auth is fully automated (password + TOTP from Keychain).
- On auth failure do **not** retry immediately. TOTP codes last 30 s and cannot
  be reused; wait ~30 s for a fresh window, retry once, then stop.
- `scp` works over the same ControlMaster.

### Working tree

```
/n/holylabs/gershman_lab/Users/rtruong/analogen-jaxbench
```

Note **rtruong**, not `truong`. `/n/home06/truong` and `~/node-gym-smoke/*` are
dead ends with older job IDs. The fastest way to relocate the tree for any job is

```sh
fasrc 'sacct -j <jobid> --format=WorkDir%120 -X --noheader'
```

Run scripts with `$W/.venv/bin/python` (matplotlib, tensorboard, torch present).
The human-study scripts live flat in `tools/` on the cluster with an underscore
prefix (`tools/_extract_rerun.py`), and in `tools/human_study/` in the git repo.

**Copying files back:** `fasrc 'cat <path>'` prepends the SSH auth banner to
stdout. Strip everything before the first `{` when pulling JSON.

---

## 3. Cluster hazards

All of these are silent. None produce an obvious error.

### `uv sync` destroys the shared venv

`analogen-jaxbench/.venv` carries **envpool and PyQt5 installed by hand**, in no
lockfile. Any `uv sync` against that tree prunes both, killing concurrently
running jobs with `No module named 'envpool'` and then
`ImportError: EnvPool Procgen requires the system Qt 5 runtime`.
`scripts/bench_train_suite.sh` still contains `uv sync --frozen || uv sync`.

Repair:

```sh
uv pip install --python .venv/bin/python envpool PyQt5
export LD_LIBRARY_PATH=.venv/lib/python3.13/site-packages/PyQt5/Qt5/lib
```

### `vec_worker_device` must not name the learner's GPU

The learner sits on `cuda:0`. A config with `vec_worker_device=cuda:0,cuda:1`
puts a vec worker on that same device and **halves throughput**: 157k vs 308k sps
on breakout, identical config otherwise, confirmed across four nodes at both 46
and 92 cores. Cores are not the constraint — 92 gave the same 157k as 46. Use
`cuda:2,cuda:3` with 4 GPUs.

**Tell:** a suspiciously round, game-independent number. Three different games
all measuring exactly 85k is the same signature as missing MPS.

### `torch.compile` and bf16 make PPO *slower*

Measured on caveflyer, 4M steps, one node:

| config | sps |
|---|---|
| baseline | 59,162 |
| `max-autotune-no-cudagraphs` | 39,094 |
| compile + bf16 | 45,116 |

PPO's bottleneck is synchronous in-process env stepping, not the network, so
compiling the network only adds overhead. `tab:hyperparams` records PPO as
fp32/compile-off — that is correct, not an oversight.

### PPO is ~5× slower than IMPALA architecturally

192 envs stepped synchronously in one process, against IMPALA's 12 workers × 5
env threads that never idle the actors. Any wall-clock comparison between the two
compares architectures, not tuning.

### Identical nodes run at different clocks

`kempner_h100` nodes are all 96-core EPYC 9454 with 4× H100, but
`holygpu8a13401` measured 2.35 GHz against `holygpu8a17201`'s 3.8 GHz — a **1.56×
throughput difference on the same config** (bigfish 626k vs 973k). Slurm
allocates lowest-weight first and the slow `134xx` nodes are weight ~37–43k
against `17xxx`'s ~77–96k, so unpinned jobs land on the slow end.

**Pin `--nodelist` to a `17xxx` node for any number that goes in the paper.**
Ratios survive; absolute numbers do not.

### The partition caps cores per GPU

`sbatch` rejects more than 23 cores per GPU, so `-c 92` needs `--gres=gpu:4`. A
single-GPU run is therefore also a quarter-CPU run, and CPU is what binds
PlayTrain. This is why the local 1-GPU suite lands at 132k while the fleet
reaches 289k on the same one GPU.

### Two hetjob gotchas

Wrapping `srun` in `timeout` tears down the *whole* hetjob, not the step — use
`srun --time`. An MPS daemon started in its own `srun` step dies with that step,
so it must start inside each game's trainer step. Missing MPS cost 1.9× and
showed up as every game returning an identical ~150k.

---

## 4. Human study

### Design

20 participants recruited on Prolific, 8 games, 100 seconds per game. Episodes
capped at 2000 steps (33 s at 60 fps). Seeds 90000–90099, predetermined so every
participant saw identical levels. Participants were told only the controls.
Payment \$13/hr, median session 21 minutes.

Demographics: mean age 32.4, SD 9.0, range 19–54; 6 female, 14 male.

Games (final set — note **coinrun, not bigfish**, which earlier drafts had):
asteroids, vvvvvv, breakout, seaquest, coinrun, caveflyer, plunder, flappy\_bird.

### The 30/20 split — important

30 sessions were collected; **only the latest 20 are analysable.** flappy\_bird's
dynamics changed mid-collection (commit `65cbe24`, "hold the bird until the first
flap", deployed **2026-08-05T16:52Z**). Sessions before that deploy played a
different game.

The split is exactly 10/20, and the surviving 20 are all canvas 520 px, so the
canvas non-uniformity concern does not apply to the analysed set.

Every analysis script encodes this as:

```python
MIN_START = "2026-08-05T16:52:00Z"
```

**Sessions record no game version**, so this split is inferred from deploy
timestamps rather than checked. Logging a game-file hash per block would make it
verifiable — worth doing before any future collection.

Non-participant sessions are filtered by regex:

```python
NON_PARTICIPANT = re.compile(
    r'^(probe|playtest|debug|incident|deploycheck|readycheck|smoke|test|anon|final)', re.I)
```

### Human results (n = 20)

Mean score, and multiple of a random policy on the same seeds:

| game | human mean | × random |
|---|---|---|
| asteroids | 652 | 1.2× |
| vvvvvv | 297 | **59×** |
| breakout | 242 | 2.6× |
| seaquest | 142 | 1.9× |
| coinrun | 79 | 19× |
| caveflyer | 9.3 | 3.2× |
| plunder | 5.3 | **1.0×** (random matches humans) |
| flappy\_bird | 4.0 | random scores 0 |

Seven of eight improve within the 100 s block.

### Participant spread (figure panel B)

Each participant's score divided by that game's median:

| game | median | min/med | max/med | IQR/med | zeros |
|---|---|---|---|---|---|
| asteroids | 466.25 | 0.08 | 3.96 | 0.89 | 0 |
| vvvvvv | 282.50 | 0.06 | 2.01 | 0.97 | 1 |
| breakout | 246.67 | 0.55 | 1.22 | **0.11** | 0 |
| seaquest | 145.00 | 0.28 | 2.76 | 0.53 | 0 |
| coinrun | 65.00 | 0.46 | 3.20 | 0.81 | 0 |
| caveflyer | 9.94 | 0.23 | 1.49 | 0.30 | 0 |
| plunder | 4.52 | 0.48 | 2.62 | 0.68 | 0 |
| flappy\_bird | 2.36 | 0.07 | 6.51 | **2.04** | 0 |

Best-to-worst ratio, the statistic the prose now quotes: **breakout ≈ 2×**
(136–300), **flappy\_bird ≈ 90×** (0.17–15.4).

flappy\_bird's twenty scores, sorted — a smooth right-skewed continuum, **not
bimodal** (an earlier docstring in `plot_spread.py` says bimodal; that is wrong):

```
0.17 0.28 0.38 0.53 0.73 1.06 1.69 1.85 1.90 1.92
2.81 3.47 5.00 5.23 5.36 6.09 6.50 7.56 11.50 15.40
```

Median 2.36, mean 3.97; the mean sits above twelve of the twenty.

Caveat worth knowing: the 90× rests on two people. Dropping the lowest scorer
gives 55×. The magnitude survives; the exact number would move with one more
participant.

### Data location

`playtrain/dist/study-data/*.json`, pulled with `just study-pull`. Stats tool:
`just study-stats` (`playtrain/tools/study-stats.mjs`). The figure scripts mirror
that tool exactly — same `TCRIT` table and fallback, same thirds definition, same
non-participant regex — so figures and tool never disagree.

---

## 5. Agent training reruns

### Jobs

| job | what | status |
|---|---|---|
| 37490808 / 37490810 | 48 runs, 8 games × {impala, ppo} × 3 seeds, 100M steps | complete |
| 37509332 | 24 IMPALA reruns with `stats_log_every: 5` | complete |

The second job exists only to fix logging density. At `stats_log_every: 50`
IMPALA logged **61 points per run, first at 1,638,400 steps**; at `5` it logs
**610 points, first at 163,840**. Throughput was unaffected (301–308k either way),
so the denser logging is free.

PPO was not rerun: it already logs ~4,066 points from step 98,304, and the
plotting bins both trainers into common bins anyway.

### Final results

| game | IMPALA end | IMPALA sps | PPO end | PPO sps |
|---|---|---|---|---|
| asteroids | 1155.5 | 308,014 | 697.2 | 78,367 |
| vvvvvv | 378.1 | 308,014 | 338.5 | 78,194 |
| breakout | 167.7 | 307,961 | 242.0 | 73,016 |
| flappy\_bird | **0.0** | 301,460 | 27.9 | 83,125 |
| seaquest | 528.1 | 301,461 | 337.1 | 77,891 |
| coinrun | 132.6 | 301,429 | 41.9 | 62,262 |
| caveflyer | 3.8 | 301,460 | 4.0 | 61,553 |
| plunder | 4.9 | 294,908 | 6.6 | 75,563 |

flappy\_bird IMPALA scores 0.0 across all three seeds **on the post-update game**,
so "a game IMPALA never learns at all" is a real result, not a stale-version
artifact.

### Crossing times against the human mean

Log-binned to match the figure. "never" means the trainer's binned mean never
reaches the human mean within 100M steps.

| game | human (95% CI) | IMPALA | PPO |
|---|---|---|---|
| asteroids | 652 (395–909) | **34 s** | 70 s |
| plunder | 5.3 (4.1–6.5) | **9 s** | 2 s |
| seaquest | 142 (100–185) | **67 s** | 454 s |
| vvvvvv | 297 (213–381) | **124 s** | 1222 s |
| coinrun | 79 (58–100) | **289 s** | never (36) |
| flappy\_bird | 4.0 (2.1–5.9) | never (0.0) | **20 s** |
| breakout | 242 (224–261) | never (157) | 1303 s |
| caveflyer | 9.3 (8.1–10.6) | never (4.0) | never (3.7) |

**plunder's 9 s crossing is meaningless as a result** — random play already
matches humans there (1.0×), so crossing the human mean measures nothing about
learning. Do not quote it next to asteroids.

---

## 6. Human figure pipeline

Scripts: `playtrain-trainers/tools/human_study/` (see its `README.md` too).

```sh
# on the cluster, from analogen-jaxbench
./.venv/bin/python tools/_extract_rerun.py outputs/_rerun_curves.json

# locally — strip the SSH banner from the copied JSON first
python tools/human_study/plot_wallclock5.py CURVES.json <study-data> <outdir>
```

`plot_wallclock5.py` is the current version and writes `fig_wide.pdf`, which is
installed into the paper as `figures/fig_human_wallclock.pdf`.

### Why log-spaced bins

`plot_wallclock4.py` binned linearly into 70 bins over a 100M budget, so each bin
was 1.43M steps wide and the first bin centre landed at 0.71M steps. Divided by
each trainer's throughput that put PPO's first plotted point at **9.1 s** and
IMPALA's at 2.3 s, even though both log from ~100k steps. On a log x-axis that
read as curves that start late.

`plot_wallclock5.py` bins log-spaced in steps, so both curves start at their true
first logged point. The cost: early bins hold few raw points and empty bins are
forward-filled, so the first decade shows short flat steps. That is sparse data
rendered honestly, not smoothing.

### Figure design decisions already settled

- Two panels, side by side. Panel A is the 2×4 grid of wall-clock curves; panel B
  is the participant-spread boxplot.
- A raw participant range band inside panel A was rejected — it covers whole
  panels on asteroids and breakout.
- Median-normalised, log₂, because the mean is pulled by the outliers the panel
  exists to show and because 0.5× and 2× should sit equally far from centre.
- Boxplot chosen over a dot strip and over a one-number-per-game bar chart.
- Zeros are censored and drawn as small hollow circles at the axis edge (one
  participant scored zero on vvvvvv).
- One centred x-axis label rather than one under every panel.

---

## 7. Benchmark results in the paper

Measured on FASRC 2026-08-02. Scripts in `playtrain-trainers/benchmarks/`,
results in `benchmarks/results/`.

- **16-game matched ProcGen A/B: geomean 1.66×, faster on 15/16.** Only miner
  loses (0.81×); bossfight is the max at 4.95×. Geomean SPS 618k vs 372k. This
  replaced a published single-game bigfish 2.3×, which was real but the most
  favourable game in the suite. Jobs 36690635/6 plus reruns 36737224/5.
- **24-game worker scaling: 99–100% parallel efficiency out to 16 workers**,
  env-only. Geomean 148k at 1 worker to 2.34M at 16. Job 36696921, figure
  `figures/fig_vec_scaling24.pdf`.
- **Local single-GPU suite geomean 132k** (job 36693963). **Remote fleet on one
  GPU reaches 289k on bigfish** (job 36736932). The 24-game fleet run has **not**
  been relaunched since the MPS fix and is the one outstanding measurement.
- **Environment level, per core:** PlayTrain beats ALE 8/8 (geomean 6.96×) and
  ProcGen 7/16 (geomean 1.13×). Raw data in
  `playtrain-paper/results/env_throughput/`.
- **MinAtar's published row is its fastest game.** Breakout 122k, SpaceInvaders
  45k, Freeway 9.6k — three-game geomean ~38k against the 99,646 printed.
  `num_envs` is flat between 1024 and 2048, so it was mismeasured rather than
  undertuned. gymnax ships four MinAtar games, not five (no Seaquest).

Per-core and pipeline pictures differ sharply: 7/16 per core becomes 15/16 end to
end.

### Numbers that must not be confused

| number | what it is |
|---|---|
| 2.34M | env-only stepping, 16 workers, no learner |
| 1.76M | env-only stepping, 12 workers, geomean over 24 games |
| 0.98M | **trained** agent-steps/s, Nature encoder, double-buffered |
| 618k / 873k | matched A/B, **single-buffered**, ProcGen / ALE replicas |
| 348k | trained agent-steps/s, IMPALA-CNN encoder |
| 39k | qbert.v2, the render-bound worst case |

The conclusion previously claimed "over a million steps per second" for
*training*; the trained ceiling is 348k under IMPALA-CNN and 0.98M under Nature.
Do not mix env-only figures into training claims.

---

## 8. Paper state

Repo: `ICLR-PlayTrain-Fast-LLM-VGEs`, synced with Overleaf.

### Length

**Body is 9.78 pages against a 9-page limit** (References begin 78% down page
10). Roughly 0.8 pages must come out.

Measured composition — prose is ~7 of the 10 pages, so figures alone cannot
close the gap:

| section | words |
|---|---|
| Related Work | 735 |
| §2.2 Efficient backend | 603 |
| §1 Introduction | 623 |
| §2.1 Generating environments | 428 |
| §3.1 Efficiency and Learning | 416 |
| §3.3 Variants and new games | 375 |
| §5 Discussion | 373 |
| §2.3 Agent interface | 332 |
| §3.2 Human play | 287 |

Ranked cut list, with estimated pages:

1. Table 2 (related-work feature table) → appendix — **0.35**
2. Related Work 735 → ~500 words — **0.20**. The softest 135 words are the
   POET/co-evolution paragraph, which is lineage rather than competition.
3. §2.3 Interface half → appendix beside `tab:hyperparams` — **0.17**
4. Figure 1 `generation.png` 0.90 → 0.72 linewidth — **0.09**
5. Discussion compression — **0.07**
6. §3.1's motivational opener — **0.06**

**Do not cut Figure 2 (the code anatomy listing).** It is the only place a reader
sees a PlayTrain environment, and two live sentences depend on it being visible:
one asks the reader to judge the code's readability, the other points at `draw()`
from §2.2 four pages later.

Page-free under ICLR 2027 rules: Ethics, Reproducibility, and the **required AI
use statement** — which the paper still does not have.

### Open issues

- **Title block links are dead.** `github.com/heyodog0/playtrain` is private and
  404s; `playtrain.org` has no DNS record. The only item that would actually
  embarrass a preprint.
- **The DMLab/three.js appendix is promised twice and does not exist.** Either
  write it or remove both claims.
- **`tab:train-throughput` has not been audited** for the `vec_worker_device`
  overlap. caveflyer, plunder and flappy\_bird all measured *exactly* 85k in the
  underlying `impala_3504*` / `impala_3503*` runs, which use the overlapping
  setting. Those rows are likely understated ~2×, which would move the 24-game
  geomean and possibly which game is "slowest".
- **The action-space flexibility claim contradicts its own citation.** The prose
  says the action space can extend to mouse or gamepad and cites `app:prompt`;
  constraint 7 of that prompt reads "**Keyboard input only** – no mouse, no
  touch, no gamepad". The action half is hardcoded at `env.py:131` and the
  `ACTIONS` table in `game-env.mjs:42`. The observation half genuinely is
  parameterised.
- **Freeway is being regenerated** because it is too hard. Two numbers depend on
  it: the prose says greedy beats random on twenty-one of 24 while `tab:eval`
  still shows `freeway 0.0 / 0.0`, and freeway is the "fastest game" row at 1.13M.
- `fig:suite_grid`'s caption says 150M steps and one seed while panel C is 100M
  over three; the text implies they are the same runs.
- `tab:contrast` and `fig:suite_grid` are uncited.
- `tab:eval` has no human column.
- **Listing 1 spans three pages** with no caption or continuation cue on pages 2
  and 3. Splitting it at the `##` headers into captioned parts is the fix.
- Intro claims variation was "confined to level layout and random seeds"; a lit
  review found this contestable (XLand, domain randomization, GVGAI/Griddly), and
  neither XLand nor domain randomization appears in the paper.

### caveflyer — the open scientific question

Both trainers plateau at ~4.0 where humans reach 9.3. Two candidate explanations:

1. the replica diverges from real ProcGen caveflyer, or
2. the uniform protocol (one CNN policy, one hyperparameter set, no recurrence)
   fails on an exploration-heavy game.

Evidence for (2), which is the more parsimonious reading: ProcGen's own paper
groups caveflyer with the environments demanding exploration and lists it among
those with a memory mode. ProcGen's normalisation constants for caveflyer are
easy Rmin 3.5 / Rmax 12, hard Rmin 2 / Rmax 13.4 — and Rmin is computed by
training with **masked observations**, so 3.5 is what a blind policy scores. Our
agents sit at 3.8–4.0.

**Not yet checked:** what PPO actually achieves on real caveflyer. The claim
"ProcGen's own trainers solve caveflyer" is *unverified* — do not use it.

**The experiment that settles it:** run real ProcGen caveflyer through our own
trainer at the same hyperparameters. If the original also plateaus near 4, the
trainer is responsible and the replica is exonerated. One single-game run;
ProcGen is already in the Table 1 pipeline.

---

## 9. Paper workflow

### Overleaf sync

Overleaf commits the **whole document as its editor holds it**. If GitHub gains a
commit Overleaf has not pulled, Overleaf's next push writes its older text over
it — a normal commit whose effect looks like a revert.

- Always `git fetch && git merge --ff-only origin/main` before editing.
- After every push, **tell Ryan explicitly to pull in Overleaf** before anyone
  types there.
- To clear an `overleaf-*` branch prompt: merge the branch into main (usually
  main's content plus a small edit, so `git checkout --theirs` on the tex is the
  right resolution), push, then verify with
  `git merge-base --is-ancestor origin/overleaf-<ts> origin/main`.
- Overleaf does **not** force-push.

### Commits

One short phrase. **Never** a `Co-Authored-By` trailer or any Claude/Anthropic
attribution.

### Prose editing style

Minimal changes that keep Ryan's wording and sentence shapes. Lead with the
diagnosis, then offer the revision. Distinguish real errors (agreement, splices,
undefined refs) from preference, and never silently fold in content changes.

Calibration notes learned the hard way:

- "One idea per sentence" taken literally produces staccato he dislikes. Combine
  parallel simple facts; reserve splitting for sentences carrying three ideas.
- He dislikes the "this is X, never Y" construction.
- Avoid `runtime` and `headless` in main text — his advisor flagged both as too
  technical. Say `PlayTrain`.
- He wants *reader-awareness*: say why a reader should care. But motivation
  belongs in the Introduction; a section opener should state the **stake** — what
  depends on this measurement — not restate the thesis.
- Model for concision: Kazuki Irie's ICLR 2023 paper (arXiv 2210.06184). Its
  Discussion is 362 words across three bolded mini-paragraphs, Conclusion 106.
  Style: no em-dashes, plain connectives ("Also," "For example,"), hedged verbs
  ("we note that", "remains opaque"), colons introducing the concrete instance,
  explicit scope concessions ("outside the scope of this work").

---

## 10. Building the paper locally

`pdflatex` and `latexmk` are not installed; `tectonic` is. It aborts on this
document because **`fontawesome5`** fails locally (it is fine on Overleaf).

Recipe that works — build in a scratch copy so the repo stays clean:

```sh
B=/tmp/paperbuild; mkdir -p $B
cp *.tex *.bib *.sty *.bst -r figures $B/
printf '\\ProvidesPackage{fontawesome5}\n\\newcommand{\\faGithub}{[GH]}\n\\newcommand{\\faGlobe}{[W]}\n\\newcommand{\\faEnvelope}{[@]}\n' > $B/fontawesome5.sty
cd $B && tectonic -X compile iclr2027_conference.tex -Z continue-on-errors
```

`-Z continue-on-errors` is needed because the stub does not cover every icon.

Measuring where the body ends, which is what the page limit turns on:

```python
import fitz
d = fitz.open('iclr2027_conference.pdf')
p = d[9]
for b in p.get_text('blocks'):
    if 'REFERENCES' in b[4]:
        print('body ends %.2f pages in' % (9 + b[1] / p.rect.height))
```

Render a page to look at it: `d[n].get_pixmap(dpi=95).save('pg.png')`.

### Appendix layout notes

- Appendix figures use `\begin{figure}[H]` (from the `float` package). With `[p]`
  or `[h]` they float past their own section headings to the last page, leaving
  headings with nothing under them. `\clearpage` alone does **not** fix this — it
  produces a blank page holding only the heading.
- Prompt listings use a `prompt` lstdefinestyle: frameless, `\ttfamily\scriptsize`,
  `lineskip=1.2pt`, `captionpos=t`. `\scriptsize` is the largest size that fits
  the prompt's 95-character hard-wrapped lines without re-wrapping;
  `\footnotesize` wraps every long line and adds three pages.
- `breaklines=true, breakatwhitespace=true` is set. Do **not** add
  `postbreak`/`breakindent` — they throw `Illegal unit of measure` in this setup.

---

## 11. Verified external facts

Checked against sources during drafting, so Related Work claims can be trusted.

### PufferLib

- `suarez2024pufferlib` (arXiv 2406.12905) is the **emulation** paper. Its
  abstract splits the contributions: "one-line environment wrappers that
  eliminate common compatibility problems **and** fast vectorization to
  accelerate training." Emulation is compatibility, not throughput.
- `suarez2025pufferlib2` (RLJ 2025) carries the speed result: 12 first-party
  environments at **1M steps/s on a single CPU core**; end-to-end training
  300k–1.2M steps/s on one RTX 4090. More recently "small models train 3–5M
  steps/second"; Ocean Pong solves in 3–5 s and Breakout in 20–30 s on an
  RTX 5090.
- Ocean is ~20,000 lines of pure C, one `.h` file per environment, raylib for
  rendering.
- **Observations are structured state, not rendered pixels.** Verified in Ocean's
  `breakout.h`: `env->observations = (float*)calloc(11 + env->num_bricks, ...)`,
  filled with normalised paddle/ball position and velocity, score, lives, and one
  entry per brick — about 60 floats. raylib renders for a human, not for the
  policy.
- PufferLib as a *library* does run pixel benchmarks (Atari, Procgen). The
  correct claim is about where the throughput figures come from, not about a
  limitation of the library. Saying otherwise is refutable in one line.
- Its asynchronous vectorization does derive from EnvPool's async batched
  stepping, and the acting/learning decoupling from Sample Factory / SEED RL.
  "Combines both ideas" is accurate.
- **Only `breakout` was checked.** Some Ocean environments feed 2D grids to CNNs;
  a grid of state values is still not a rendered frame, but if this comparison
  becomes load-bearing, spot-check one of those.

### ProcGen

Normalisation constants (Rmin computed by training with masked observations):

| environment | hard Rmin | hard Rmax | easy Rmin | easy Rmax |
|---|---|---|---|---|
| CaveFlyer | 2 | 13.4 | 3.5 | 12 |
| CoinRun | 5 | 10 | 5 | 10 |
| Plunder | 3 | 30 | 4.5 | 30 |
| Maze | 4 | 10 | 5 | 10 |
| Miner | 1.5 | 20 | 1.5 | 13 |

miner is a Boulder Dash clone — a grid with falling-boulder updates every step,
drawn as plain rectangles. Heavy logic, trivial rendering, which is the plausible
reason it is the one ProcGen game our replica loses to C++ (0.81×). **That
attribution is an inference, not a measurement.** A per-step breakdown of time in
QuickJS versus the rasterizer for miner and qbert.v2 would settle it, and the
split should invert between them.

---

## 11c. Handoff, 2026-08-08

`docs/HANDOFF_2026-08-08.md` — the live threads at the end of that session:

- **Job 37785534** (running): 24 human-study PPO reruns on the IMPALA-CNN
  encoder, so both arms of `fig:human_wallclock` share one. Includes the exact
  steps to take when it finishes and what §4.3's crossings will change to.
- **Impoola + stride-2 stem** (scoped, not started): measured encoder costs,
  the ~1 h implementation, a two-stage run plan with stage 2 gated on stage 1,
  and the literature.
- Outstanding paper edits, cluster traps, and the tools added.

Table 1 is finished: the trainer x encoder 2x2 is 0.94M / 0.35M / 171k / 64k,
and PPO is 5.5x slower under BOTH encoders (5.50x, 5.51x) -- the gap is
architectural, not an encoder or tuning artifact.

## 11b. PPO speed work (2026-08-07)

See `docs/PPO_SPEED_PLAN.md` for the full plan. Headline: PPO's update is 90%
forward+backward and caps it at ~359k sps even with a free environment, against
IMPALA's 939k suite geomean — the gap is algorithmic (24 gradient passes per
rollout vs V-trace's one). But ~1.3x is available for free: **bf16 autocast
(1.55x on the update) and `n_minibatches` 8 -> 4 (1.2x)**, no change to data
reuse. bf16 helping **contradicts** the earlier "compile and bf16 make PPO
slower" note — the suspect is compile's recompilation across two batch shapes,
not bf16.

## 12. Immediate next steps

1. Make the length cuts, rebuild, re-measure where References lands.
2. Add the required **AI use statement** (page-free).
3. Audit `tab:train-throughput` for the `vec_worker_device` overlap.
4. Fix or remove the DMLab appendix promise and the action-space claim.
5. Fix the dead title-block links before any preprint.
6. Optional but cheap: run real ProcGen caveflyer through our trainer to settle
   the replica-versus-protocol question.
7. Fix the "bimodal" claim in `plot_spread.py`'s docstring.
