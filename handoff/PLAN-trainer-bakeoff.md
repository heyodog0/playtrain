# Plan: IMPALA trainer bake-off for `app:trainer`

Brief for a dedicated agent. Written 2026-08-26. Read
`handoff/HANDOFF-2026-08-25-1901.md` first for cluster conventions.

## 1. What this is for

`app:trainer` currently asserts an architecture ladder in prose: per-actor CPU
inference, then centralised batched GPU inference, then vectorised workers, then
double buffering. Every claim about *why* each step was taken is currently
unquantified, and the only numbers that exist for the first two rungs are
MiniGrid-era (~315 SPS, ~1.5k SPS). **Those must not appear in the paper next to
current numbers.**

The claim to support is deliberately narrow:

> Each architectural step is worth a measured factor on the same node, same
> games, same algorithm, and the finished system is competitive with the
> strongest external implementation on this environment.

Not "our trainer is the fastest." The paper's contribution is that LLM-authored
JavaScript environments run fast; this section explains how the trainer keeps up.

## 2. Arms

All four in-house rungs already exist as one config field, `inference_mode`,
validated at `impala/train.py:550` against
`{shared_cpu, central_gpu, vec, remote_vec}`. `shared_cpu` is still the dataclass
default, so the original design is intact rather than reconstructed.

| arm | mechanism | build cost |
|---|---|---|
| A1 `shared_cpu` | one env per actor process, batch-1 CPU forward against a shared CPU model | config flag |
| A2 `central_gpu` | actors hold no model; one thread batches observations across actors, one GPU forward | config flag |
| A3 `vec`, single-buffered | worker owns M envs and its own GPU model; one batched forward + one GIL-released C++ step | config flag |
| A4 `vec`, double-buffered | the paper config | already measured, `tab:dbuf-ablation` |
| B1 Sample Factory 2, APPO | external reference | the real work |

`remote_vec` is out of scope. It has never backed a paper number.

## 3. Matching rules

- **Same node, one job, back to back.** Kempner H100 nodes differ by up to 1.56x
  in clock. Ratios survive that; absolute numbers do not. Pin a 17xxx node.
  `holygpu8a17402` is where the published scaling data came from.
- **Match hardware, not knobs.** Each arm gets the same node and GPU budget and
  is tuned to *its own* best topology. Do not force A1 to 6,144 envs or force
  Sample Factory into PlayTrain's worker layout; a hobbled baseline is the first
  thing a reviewer attacks. Report each arm's config in the caption.
- **Games**: the four from `tab:dbuf-ablation`, so A3-vs-A4 reproduces the
  existing ablation as an internal consistency check. If those four disagree with
  the published 1.35x, stop and find out why before continuing.
- **Encoder**: Nature-CNN everywhere. IMPALA-CNN as an optional second row.
- **Observation**: 64x64x3 RGB, frame skip 1, everywhere.
- **Statistic**: median of 60-second `sps=` windows with the first discarded,
  matching `tools/bench_train_suite.py`. Do not invent a new one.
- **Disclose**: Sample Factory runs APPO (async PPO with a V-trace correction),
  not IMPALA. B1 is a systems comparison, not an algorithm-identical one. Say so
  in the caption, not in a footnote.

## 4. Phases

**Phase 0, do the rungs still run? (half day, cheap)**
Launch A1 and A2 for ~200k steps on one game. These paths have not been exercised
in months and are the single largest risk in this plan. If they have bit-rotted,
the decision is fix-or-drop and it should be made before anything else is built.
Record what `num_actors` each needs; A1 and A2 are one-env-per-actor, so their
topology has nothing in common with `vec`'s 12 workers x 512 envs.

**Phase 1, ladder job (half day + ~2-3 node-hours)**
One sbatch, four arms x four games, sequential, one node, timed windows, JSON out.
Copy the skeleton from the double-buffering ablation sbatch. Deliverable: a table
of SPS per arm per game plus geomean, and the A3/A4 ratio cross-checked against
the published 1.35x.

**Phase 2, Sample Factory install (half day, local first)**
Fresh venv, `uv venv && uv pip install sample-factory`. Verify it imports against
the gymnasium version PlayTrain pins. **If the pins conflict, stop and ship
A1-A4.** That is already a publishable ladder and the fallback is not a failure.

**Phase 3, Sample Factory adapter (1 day)**
Register PlayTrain through Sample Factory's *batched* vector-env interface, not
its per-env path. The per-env path would measure the wrong thing and understate
them. Smoke test: one game, ~100k steps, sane SPS, curves that move.

**Phase 4, Sample Factory tuning and measurement (half day + node time)**
Short sweep of its worker and env counts on the pinned node; its optimum will not
be PlayTrain's topology. Then measure in the same job as a repeat of A4 so the
two are on identical silicon within one allocation.

**Phase 5, write-up (half day)**
Five-arm table into `app:trainer`. **Replace** `tab:dbuf-ablation` rather than
sitting beside it, since A3-vs-A4 *is* that ablation on the same games.

## 5. Hazards, all observed this month

- **Never `uv sync` against `analogen-jaxbench/.venv`.** envpool and PyQt5 are
  hand-installed and in no lockfile; a sync silently prunes both. Sample Factory
  gets its own venv.
- **`--export=ALL,VAR=a,b,c` silently breaks.** sbatch splits on commas and only
  the first value survives. Export in the submitting shell instead.
- **Do not edit a game file while an array is queued.** Earlier and later tasks
  then measure different environments. This nearly happened with maze and the PPO
  suite.
- **`vec_worker_device` must stay disjoint from the learner GPUs.** A worker
  sharing the learner's device halves throughput.
- **`act_vec_db` ignores `vec_backend`**, so double-buffer plus envpool would
  benchmark PlayTrain against itself. Guarded at `train.py:469`; do not defeat it.
- **The cluster clone of `analogen-jaxbench` is behind its own remote.** Commits
  land locally but `git push` is rejected. Do not force it.
- **Return-window sizes were wrong until this week** (`maxlen=512` over 6,144
  envs, PPO `[-100:]` over 192). Both fixed. Irrelevant to throughput, but any
  *learning* curve produced before those fixes is not comparable.
- **MiniGrid-era ladder numbers are not comparable** to anything current.

## 6. Stopping rules

Ship what exists at each gate rather than pushing through:

- A1 or A2 bit-rotted beyond an hour's repair -> ship the rungs that run, describe
  the rest qualitatively with no numbers.
- Sample Factory pins conflict -> ship A1-A4.
- Sample Factory beats A4 on some games -> **report it**. The ladder is the
  contribution; the external arm is context. A section that only reports
  favourable comparisons is worth less than one that reports all of them.

## 7. Scheduling

Three arrays are in flight (`42009688`, `42009691`, `42009692`) and share a GPU
quota that has been the binding constraint all week. Phase 1 needs a whole node
on a pinned host, so it will queue behind them. Check `squeue --me` before
submitting and do not pile a fourth array onto the same fairshare window.

## 8. Deliverable

1. `outputs/ladder_<jobid>.json`, raw per-arm per-game SPS.
2. A five-arm table, LaTeX, anonymised: no cluster names, no hostnames, no job
   IDs. ICLR is double-blind and the paper body is currently clean.
3. Three to five sentences of notes per arm on what it isolates, for the author
   to write from. **Do not write paper prose.**
4. A short record of anything that failed and why, so the next agent does not
   repeat it.
