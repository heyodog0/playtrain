# Paper tables

Generators for the tables that carry measured numbers, with their data in `data/`.
Verified against the paper.

**Table 1(a), single-node training throughput.** The `t3fix` row is the published one.

    uv run --no-project python t1a_agg.py \
      impala_nature=44748571+44784183 impala_icnn=44748573 \
      ppo_nature=44748574+44784184 ppo_impala=44748575+44784185

Gives 1,071,262 all-24, 1,062,735 ProcGen16, 1,088,521 ALE8, and 344,125 / 185,113 /
67,636 for the other rows. The `adv2` row printed beside it is the previous build, not
what the paper reports.

**Table 7, double-buffering ablation.**

    uv run --no-project --with numpy python dbuf_tex2.py

Emits the table body verbatim.

**The eval table (Appendix)** comes from `results/eval_iddp_suite.json`, not from
`eval_final_agents_b256.json`. The latter sits beside it, is from weaker checkpoints, and
produces 20 of 24 greedy returns too low while every random return still matches.

**The thread-scaling table** shares its data with figure panel A: see `../scaling/`.

The remaining tables in the paper are descriptive, not measured: engine and backend
comparisons, the action space, the step return contract, hyperparameters, and the
benchmark and EnvPool configurations.
