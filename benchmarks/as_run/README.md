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

## The one asymmetry you need to know about

The two sides of the figure were **not driven by the same harness**:

- **PlayTrain** was measured by the QuickJS host's own C benchmark loop —
  `native/build/qjs_host <game>.js bench 0 100000`, 7 repetitions per game. No
  Python is involved: the loop lives inside the binary.
- **ProcGen and ALE** were measured through `../bench_compare.py`
  (`--trials 7 --frames 1500 --warmup 200 --fixed-actions`), i.e. a Python
  stepping loop over their Gym APIs.

Both are single-env, single-core, one-frame-per-step, 7 trials — so the *workload*
is matched. What differs is per-step driver overhead: the baselines pay a Python
call per step and PlayTrain does not. At these throughputs that is worth a few
percent for the baselines (~25–50 µs/step, so Python's ~1–2 µs is small) but more
for PlayTrain, whose fastest games are ~10 µs/step. It flatters PlayTrain, and by
more on the games where PlayTrain is fastest.

Two honest ways to close it, in order of preference:

1. **Re-measure both sides through `bench_compare.py`** — now possible, since
   `--backend qjs` exists (it did not when these sweeps ran, which is *why* the
   sweeps used the C loop). Symmetric Python driver on both sides. Expect
   PlayTrain's bars to come in somewhat below the published values.
2. **Keep the C-loop numbers and disclose the asymmetry** in the figure caption,
   noting it favors PlayTrain.

Either is defensible; silently presenting them as one harness is not. The
published figure currently reflects option (2) without the disclosure.
