# Benchmarks — environment-layer throughput

Every environment-throughput number PlayTrain reports is produced by a script in
this directory. Nothing here needs a GPU or a learner: these measure the cost of
*stepping environments*, which is the claim PlayTrain makes about itself.

Training throughput (agent-steps/s through a real learner) is a separate
measurement and lives with the trainers, in
[`playtrain-trainers/benchmarks/`](https://github.com/heyodog0/playtrain-trainers)
— including the same-trainer A/B against real ProcGen and the baseline reruns.

## Which backend is being measured

Three access paths reach the same QuickJS + native-rasterizer engine, and they
cost very different amounts per step. Getting these confused is the single easiest
way to misreport a number, so every script names which one it drives.

| path | how a step travels | measured (bigfish, Apple Silicon) | used for |
|---|---|---|---|
| **C loop** — `qjs_host <game>.js bench` | entirely inside the binary, no Python | 207,757 f/s | the published per-core figure |
| **in-process** — `NativeVecEnv` (ctypes, GIL released, zero-copy obs) | one batched call per N envs | 176,233 f/s at N=1 | **the production training path**, and the aggregate numbers |
| **pipe** — `GameEnv` / `QuickJSEnv` | subprocess over stdin/stdout, ~12 KB obs read per step | 50,381 f/s | portable single-env API: correctness, eval, no-build machines |

The pipe path is 4× off the engine's actual cost because of the per-step IPC, and
**no reported throughput number uses it** — the figure uses the C loop and training
uses the in-process threadpool. It remains the honest number for anyone stepping
`GameEnv` directly from Python, which is why `bench.py` reports it.

The legacy **Node.js + node-canvas** backend (`PlayTrainEnv`) is superseded and
slower again (bigfish 15,139 f/s through the same pipe API); its numbers must never
be mixed into a QuickJS figure. The backend name is written into every output JSON
so a merged figure can be checked for accidental mixing.

## Ground rules

These hold for every script here; deviations are called out per-script below.

- **One step is one frame.** `frame_skip=1` everywhere. A PlayTrain `step()` runs
  exactly one `draw()`, so an agent-step and a rendered frame are the same thing
  and reported numbers are never frameskip-inflated. ALE is driven through the
  `NoFrameskip-v4` ids (`frameskip=1`, `repeat_action_probability=0.0`); ProcGen
  is natively one frame per step.
- **Random actions**, drawn from each system's own action space (PlayTrain 8,
  ProcGen 15, ALE per-game), from a seeded RNG. Episodes auto-reset on terminal
  so no run is measured on a stalled env.
- **Warmup is discarded**, then a fixed number of timed steps is repeated over
  several trials. JIT/inductor warmup, first-touch page faults, and cache-cold
  effects are excluded deliberately; both sides get the same treatment.
- **Observations are recorded, never normalized away.** Each system's resolution
  and channel count goes into the output JSON. PlayTrain renders 64×64 RGB;
  ProcGen is natively 64×64 RGB; ALE emits 210×160 RGB (its native frame) unless
  a script says otherwise. Where resolutions differ, the comparison favors the
  baseline — PlayTrain is doing equal or more readback work.
- **Baselines get their best configuration**, not their default one. Where a
  baseline has a tunable that changes throughput (ProcGen's `num_threads`,
  envpool's thread/batch split, sync vs async), the script sweeps it and reports
  the baseline's *maximum*. PlayTrain gets its best config by the same rule.
- **Same node, same process count, one backend per invocation.** Each baseline
  needs its own venv (incompatible `gym`/`numpy` pins), so backends are run
  separately and merged at plot time. Never compare JSONs from different nodes —
  the published sweeps enforce this by construction, measuring PlayTrain and its
  baseline inside one Slurm job at the same core budget (see
  [`as_run/README.md`](as_run/README.md)).

## What each script measures

| script | measures | used for |
|---|---|---|
| `bench_compare.py` | **per-core, single env**, one backend per invocation, per-game median + SD over trials. Produced the **baseline** bars of the published figure (`--backend procgen` / `--backend ale`); `--backend qjs` measures PlayTrain's pipe-based single-env API, which is 4× below the engine's real cost, so it is *not* the figure's PlayTrain path (that was the C loop — see `as_run/`). | Figure 2(a)/(b) baseline bars |
| `bench_vs_baselines.py` | **PlayTrain vs ProcGen at each system's best**, three ways: raw per-core, best in-process VectorEnv, and single-env×cores ceiling. Sweeps ProcGen's `num_threads` over {8,16,32} and takes its max (its threadpool peaks near 16 and *degrades* past it). | the aggregate/near-linear-scaling claim |
| `bench_native_vec.py` | the four-way coordinator comparison at N envs: `single` (one env, no coordinator) · `ceiling` (N independent processes) · `native-vec` (in-process C++ threadpool, GIL released) · `py-coord` (Python lockstep over N subprocesses, same backend). Isolates *coordination* cost from *env* cost. | the threadpool's share of the headline number |
| `bench_sharded.py` | **measured, not extrapolated,** P-process aggregate with synchronized start. Symmetric: both systems driven through their ordinary single-env Python API, one env per process, so neither gets a coordinator advantage. | the embarrassingly-parallel ceiling |
| `bench_scaling.py` | aggregate SPS vs core budget C, geomean over a suite, each system at its best config *for that C*. | scaling curve |
| `bench_ale.py` | PlayTrain vs ALE at **matched 84×84 RGB**, frameskip 1, no frame stack — the stricter version of Figure 2(b), where ALE is not given its native-resolution handicap. | ALE comparison robustness |
| `bench_ale_async.py` | ALE via envpool at its **true best**: grayscale 84×84 (ALE's standard and its fast path), async send/recv, swept over thread and batch configs, against PlayTrain's best VectorEnv. PlayTrain outputs RGB here — 3× the readback — so this is conservative for PlayTrain. | ALE comparison, adversarial setting |
| `bench.py` | per-game step throughput over the bundled p5 games (`just bench`), QuickJS by default. The everyday regression check, not a paper number. | catalog health |
| `procgen_agg_bench.py` | ProcGen's own C++ batcher, aggregate. Cross-check on the baseline side. | cross-checks |
| `raw_vec_bench.py` | the legacy Python vec coordinator over the Node backend — kept as the "what Python-level vectorization gets you" reference, not a current number. | historical reference |
| `plot_compare.py` | grouped-bar plots from `bench_compare.py` JSONs. | quick looks |
| `fasrc_parallelism.sbatch` | Slurm launcher for the parallelism sweep on a full node. FASRC-specific; adapt the SBATCH header. | cluster runs |
| `as_run/` | the **exact** sweeps that produced the published figure, recovered from the cluster and kept verbatim, plus the driver-asymmetry note. | figure provenance |

Paper-styled figures (the exact rendering used in the manuscript) live in the
paper repo; the data they plot comes from the scripts above.

## Running them

`bench.py` and `bench_native_vec.py` run in the project venv:

```bash
just bench                                        # all bundled games
uv run python benchmarks/bench_native_vec.py --n 8
```

Baseline comparisons need the baseline installed, and ProcGen/envpool pin old
`gym`/`numpy`, so run them in a throwaway venv rather than the project's:

```bash
# vs ProcGen
uv run --no-project --python 3.10 --with procgen --with "numpy<2" --with gymnasium \
    python benchmarks/bench_vs_baselines.py

# vs ALE (envpool)
uv run --no-project --python 3.10 --with envpool --with "numpy<2" --with gym \
    python benchmarks/bench_ale_async.py

# baseline per-core sweeps (the published figure's baseline bars)
python benchmarks/bench_compare.py --backend procgen --suite procgen --trials 7
python benchmarks/bench_compare.py --backend ale     --suite atari   --trials 7

# PlayTrain's per-core side, as published — the engine's own loop, no Python:
native/build/qjs_host examples/games/js/bigfish.js bench 0 100000

# PlayTrain through its portable Python API instead (4x slower: per-step pipe IPC,
# not what the figure or the trainer uses)
python benchmarks/bench_compare.py --backend qjs     --suite procgen --trials 7
```

Results land in `outputs/compare/<backend>_<suite>.json` (untracked). Pass
`--fixed-actions` to pin one seeded action sequence across trials.

## Aggregation, stated exactly

The scripts do not all summarize the same way, and the difference matters when
reading their output:

- `bench_compare.py` reports the **median** over trials with mean and population
  SD alongside, on a **fresh env per trial** (isolates heap/GC accumulation;
  the median shrugs off GC and thermal spikes). Figure 2's error bars are
  SD/√trials.
- `bench_vs_baselines.py` reports **best-of-3** for both systems symmetrically —
  it is answering "what does each system do at its best config", so it takes the
  max on both sides.
- Suite-level aggregates are **geometric** means, over per-game throughput, for
  both PlayTrain and the baseline.

## Configuration differences worth knowing

- ProcGen is created with `distribution_mode="hard"` in `bench_vs_baselines.py`
  and with defaults (`num_levels=0, start_level=0`) in `bench_compare.py`. Level
  distribution has no measurable effect on step cost, but the two scripts are not
  bit-comparable to each other.
- ALE sticky actions are disabled (`repeat_action_probability=0.0`) so that a
  step is always a real emulated frame.
- PlayTrain's rasterizer draws at observation resolution rather than at canvas
  resolution, which is a genuine architectural advantage and part of what is
  being measured — not a methodological shortcut. A general canvas library
  rasterizes at native size and downsamples; PlayTrain bakes the target
  resolution into the render transform.

## Reproducing the published numbers

The manuscript's environment-layer figure was measured on one FASRC Sapphire
Rapids node (Xeon Platinum 8480+), one core per measurement, 7 trials per game,
QuickJS backend with the native rasterizer, `frame_skip=1`, 64×64 RGB. Machine
class matters: Apple Silicon runs roughly 2–3× faster per core and its absolute
numbers are not comparable to the x86 ones.

To reproduce it exactly, submit the two as-run sweeps — each measures PlayTrain
(engine C loop) and its baseline (Python harness) inside one job:

```bash
sbatch benchmarks/as_run/sweep_procgen16.sh    # 16 games vs real ProcGen
sbatch benchmarks/as_run/sweep_atari8.sh       # 8 games vs ALE
```

For a *symmetric* per-core variant — both sides in-process, one Python call per
step — use `bench_vs_baselines.py`'s raw-per-core arm instead
(`NativeVecEnv(num_envs=1, num_threads=1)` vs `ProcgenGym3Env(num=1)`). The driver
difference is about ±15% with inconsistent sign; see
[`as_run/README.md`](as_run/README.md).

### Provenance, stated plainly

The published figure's data is committed: the as-run sweeps are in
[`as_run/`](as_run/) and their raw output in the paper repo under
`results/env_throughput/`, matching the figure bar-for-bar.

One asymmetry travels with it, quantified in [`as_run/README.md`](as_run/README.md):
PlayTrain was timed by the QuickJS host's own C loop, the baselines through their
Python Gym APIs. Measured, the driver is worth about ±15% with **no consistent
direction** (bigfish −15%, coinrun +12%), so there is no systematic inflation — a
caption clause covers it. Note especially that this must *not* be "corrected" by
re-measuring with `--backend qjs`: that path pipes observations over stdin/stdout
per step and is 4× slower than either the figure's loop or the production trainer's
in-process threadpool.

Remaining cosmetic item: the figure script holds its values as inline constants
rather than reading the committed JSON. They were verified equal to within ±1 f/s
across all 24 games, so this is about preventing future drift, not fixing an error.


---

# Figure provenance (was benchmarks/as_run/README.md)

# As-run sweeps behind the published environment-layer figure

These two scripts are the **exact submissions** that produced the figure's numbers,
recovered from the cluster (`~/sweep4.sh`, `~/sweep6.sh` on FASRC) and committed
verbatim, renamed only to say what they sweep:

| script | was | panel | suite | node |
|---|---|---|---|---|
| `sweep_procgen16.sh` | `~/sweep4.sh` | (a) | 16 ProcGen replicas vs real ProcGen | sapphire, `-c 1`, `holy8a32607` |
| `sweep_atari8.sh` | `~/sweep6.sh` | (b) | 8 Atari replicas vs ALE | sapphire, `-c 1`, `holy8a32603` |
| `sweep_backend_ladder.sh` | `~/sweep7.sh` | (c) | Playwright → Node/V8 → QuickJS over all 24 games | sapphire, `-c 1` |
| `pw_bench_playwright.mjs` | `~/pw_bench_fasrc.mjs` | (c) | the Playwright arm: headless Chromium via playwright-core, real p5.js, 64×64 readback | — |

`ladder/` holds the earlier rungs of the same measurements (`sweep{,2,3,5}.sh`) and
the QuickJS engine compile-flag experiments (`exp_driver.sh`, `exp_qjs_opt.sh` —
baseline → `-O3 -march` → PGO), which did not change the published numbers.

Raw output is committed in the paper repo under `results/env_throughput/`
(`qjs_raw4.txt`, `procgen4.json`, `sweep4.out`, and the Atari equivalents). The
values in `sweep4.out` / `sweep6.out` match the figure bar-for-bar.

## Both arms ran in the same job, on the same node

Each script measures PlayTrain **and** its baseline inside a single `sbatch`
submission: the QuickJS loop over every game, then `bench_compare.py` against the
baseline, in the same allocation with the same `-c 1` core budget. The scripts echo
`hostname` for the record and the logs confirm it: the entire ProcGen comparison
ran on `holy8a32607`, the entire Atari comparison on `holy8a32603`. No bar in a
panel is compared against a number measured on different silicon.

Two residual caveats, neither a hardware difference:

- The arms ran **sequentially** within the job, not concurrently, on a **shared**
  `sapphire` partition (`-c 1`, not `--exclusive`). Neighbouring jobs could differ
  between the two arms' time windows, so memory-bandwidth contention is a
  second-order source of noise. The per-game trial CV was 0.14–2.25% for QuickJS
  and up to ±14% for ProcGen, which bounds it.
- **Do not merge across suites.** ProcGen (panel a) and Atari (panel b) came from
  different jobs on different nodes; each panel is internally same-node, and that
  is the level at which the comparison holds.

## Driver asymmetry: real, but small, and measured

The two sides of the figure were not stepped by the same driver:

- **PlayTrain** by the QuickJS host's own C benchmark loop —
  `native/build/qjs_host <game>.js bench 0 100000`, 7 reps/game. No Python in the
  stepping path.
- **ProcGen and ALE** by `../bench_compare.py`, a Python loop over their Gym APIs
  (one Python call per step, in-process C/C++ underneath).

The question is how much the missing Python call is worth. Measured directly —
same machine, same games, same QuickJS+rasterizer backend, only the driver changed:

| game | C loop (`qjs_host bench`) | in-process Python (`NativeVecEnv` n=1, t=1) | delta |
|---|---|---|---|
| bigfish | 207,757 | 176,233 | −15% |
| coinrun | 25,558 | 28,645 | **+12%** |

So the honest per-core number under a Python driver is within roughly ±15% of the
C-loop number, **and the sign is not consistent** — coinrun measures *faster*
through Python. There is no systematic inflation to correct. (Apple Silicon
figures; the ratio between drivers is the quantity of interest, not the absolute
values.)

The baselines' own overhead is the same order: one Python call (~1–2 µs) against a
25–50 µs ProcGen step is 2–5%.

**Do not "fix" this with `bench_compare.py --backend qjs`.** That path builds
`QuickJSEnv`, which talks to `qjs_host` over stdin/stdout pipes and pays a pipe
round-trip plus a 12 KB observation read *per step* — 50,381 f/s on bigfish versus
207,757, i.e. 4× slower. Neither the figure nor the production trainer pays that
cost: training steps environments through the in-process C++ threadpool
(`NativeVecEnv`), one batched ctypes call per N envs with the GIL released and a
zero-copy observation buffer. Re-measuring through the pipe API would understate
PlayTrain by 25–76% and describe a configuration nobody runs.

If you do want a symmetric per-core measurement, the right harness already exists:
`bench_vs_baselines.py`'s raw-per-core arm, which drives `NativeVecEnv(num_envs=1,
num_threads=1)` against `ProcgenGym3Env(num=1)` — both in-process, both one Python
call per step.

**Panel (c) has the same shape.** Its three arms use three drivers: Playwright
through `pw_bench_playwright.mjs` (Node + headless Chromium), Node/V8 through
`bench_compare.py --backend node` (Python harness), QuickJS through the C loop. So
the V8→QuickJS step carries the same ±15% driver uncertainty as panels (a)/(b). The
ladder's qualitative claim is unaffected — a ~6× step does not become a wash at
±15% — but the exact multiplier inherits it.

**Recommendation:** keep the published numbers and add one caption clause noting
PlayTrain was timed in its native benchmark loop while baselines were timed through
their Python APIs, a difference measured at ±15% with no consistent direction.
Re-running the sweeps is optional, not corrective.
