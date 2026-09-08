# Tuning experiments

Cluster job scripts and analysis from the engine optimisation rounds. None of this is
needed to build or run PlayTrain, and nothing here is referenced by the runtime. It is
kept as the record of how the engine-tier numbers in the paper were produced.

- `jobs/` - Slurm scripts per round: `l1_*` and `e0/e3/e6_*` for the AOT engine tiers,
  `adv_recut` for the adopted-build re-cut, `webgl_*` for the WebGL work.
- `round3/` - the third tuning round, closed. Every lever it tested was measured and
  rejected, so the scripts are here for provenance, not reuse.
- `build_qjs_vec_pgo.sh`, `build_qjs_vec_tune.sh` - build variants used for profiling
  and PGO experiments. The shipping build is `native/build_qjs.sh` +
  `native/build_qjs_vec.sh`.

These are FASRC-specific. Adapt the SBATCH headers before running them anywhere else.
