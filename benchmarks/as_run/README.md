# As-run sweeps behind the published environment-layer figure

These two scripts are the **exact submissions** that produced the figure's numbers,
recovered from the cluster (`~/sweep4.sh`, `~/sweep6.sh` on FASRC) and committed
verbatim, renamed only to say what they sweep:

| script | was | suite | node |
|---|---|---|---|
| `sweep_procgen16.sh` | `~/sweep4.sh` | 16 ProcGen replicas vs real ProcGen | sapphire, `-c 1`, `holy8a32607` |
| `sweep_atari8.sh` | `~/sweep6.sh` | 8 Atari replicas vs ALE | sapphire, `-c 1`, `holy8a32603` |

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

**Recommendation:** keep the published numbers and add one caption clause noting
PlayTrain was timed in its native benchmark loop while baselines were timed through
their Python APIs, a difference measured at ±15% with no consistent direction.
Re-running the sweep is optional, not corrective.
