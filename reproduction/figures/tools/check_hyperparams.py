"""tab:hyperparams: every published value against the suite run configs.

The table describes the 100M suite training runs, so the authority is the
config.json each run carries in the figure-data archive: outputs/s3_icnn_* for
IMPALA and outputs/p3_icnn_* for PPO.

Also checks the caption's two structural claims -- "Each config is identical for
every game" and "per-game tuning: none" -- by diffing every config against the
first, ignoring only the per-run identity fields.

    python tools/check_suite.py --data ...   (for the curves)
    python tools/check_hyperparams.py
"""
from __future__ import annotations

import collections
import glob
import json
from pathlib import Path

D = Path(__file__).resolve().parents[1] / "outputs"
IDENTITY = {"game", "seed", "log_dir", "wandb_name", "wandb_group",
            "ddp_rdzv_port", "xpid", "run_name"}

# (paper cell, config key, expected value)
IMPALA = [("encoder IMPALA-CNN", "net", "impala"),
          ("feature dim 256", "features_dim", 256),
          ("recurrence none", "use_lstm", False),
          ("frame skip 1", "frame_skip", 1),
          ("frame stack 1", "frame_stack", 1),
          ("batch size 256", "batch_size", 256),
          ("unroll length 64", "unroll_length", 64),
          ("discount 0.99", "discounting", 0.99),
          ("baseline cost 0.5", "baseline_cost", 0.5),
          ("entropy cost 0.01", "entropy_cost", 0.01),
          ("reward clip to +-1", "reward_clipping", "abs_one"),
          ("gradient-norm clip 40.0", "grad_norm_clipping", 40.0),
          ("learning rate 5e-4", "learning_rate", 0.0005),
          ("alpha 0.99", "rmsprop_alpha", 0.99),
          ("momentum 0", "rmsprop_momentum", 0.0),
          ("epsilon 1e-5", "rmsprop_epsilon", 1e-05),
          ("precision bf16", "learner_precision", "bf16"),
          ("channels-last", "channels_last", True),
          ("topology 12 workers", "vec_workers", 12),
          ("total 100M", "total_steps", 100_000_000)]
PPO = [("encoder IMPALA-CNN", "net", "impala"),
       ("environments 192", "n_envs", 192),
       ("rollout length 128", "n_steps", 128),
       ("minibatches 8", "n_minibatches", 8),
       ("epochs per batch 3", "n_epochs", 3),
       ("learning rate 2.5e-4", "learning_rate", 0.00025),
       ("annealed", "anneal_lr", True),
       ("discount 0.999", "gamma", 0.999),
       ("GAE lambda 0.95", "gae_lambda", 0.95),
       ("clip coefficient 0.2", "clip_coef", 0.2),
       ("value coefficient 0.5", "vf_coef", 0.5),
       ("entropy coefficient 0.01", "ent_coef", 0.01),
       ("gradient-norm clip 0.5", "max_grad_norm", 0.5),
       ("precision fp32", "bf16", False),
       ("torch.compile off", "compile_mode", None),
       ("total 100M", "total_timesteps", 100_000_000)]


def main():
    if not (D / "s3_icnn_bossfight_s0").exists():
        print("    skipped: run 'bash reproduction/figures/fetch_data.sh' first")
        return 0
    bad = []
    for lab, pat, rows in (("IMPALA", "s3_icnn_*", IMPALA), ("PPO", "p3_icnn_*", PPO)):
        dirs = sorted(glob.glob(str(D / pat)))
        cfg = json.load(open(dirs[0] + "/config.json"))
        print(f"\n    {lab}: {len(dirs)} run configs, checking against {Path(dirs[0]).name}")
        for cell, key, want in rows:
            got = cfg.get(key, "(absent)")
            ok = got == want
            if not ok:
                bad.append(f"{lab} {cell}: config {key}={got!r}, paper implies {want!r}")
            print(f"      {'ok ' if ok else 'NO '} {cell:<26} {key}={got!r}")
        # the caption's identity claim
        base = {k: json.dumps(v, sort_keys=True) for k, v in cfg.items() if k not in IDENTITY}
        diffs = collections.defaultdict(set)
        for d in dirs[1:]:
            f = {k: json.dumps(v, sort_keys=True)
                 for k, v in json.load(open(d + "/config.json")).items() if k not in IDENTITY}
            for k in set(f) | set(base):
                if f.get(k) != base.get(k):
                    diffs[k].add(f.get(k))
        print(f"      identical across all {len(dirs)} configs (ignoring game/seed/log_dir/"
              f"wandb/port): {'YES' if not diffs else 'NO -> ' + str(dict(diffs))}"
              "   (caption: each config is identical for every game; per-game tuning none)")
        if diffs:
            bad.append(f"{lab}: configs differ on {sorted(diffs)}")
    # topology arithmetic
    c = json.load(open(str(D / "s3_icnn_bossfight_s0") + "/config.json"))
    n = c["vec_workers"] * 2 * c["batch_size"]
    print(f"\n    topology: {c['vec_workers']} workers x 2 groups x {c['batch_size']}"
          f" = {n:,} environments   (paper: 12x2x256=6,144)")
    print(f"      vec_worker_device={c['vec_worker_device']!r} ->"
          f" {len(c['vec_worker_device'].split(','))} inference GPUs of 4, rest DDP"
          "   (paper: 2 DDP + 2 inference GPUs)")
    print(f"      that {n:,} is the same count behind fig:suite_trainers'"
          f" {n} x 2000 = {n*2000/1e6:.3f}M horizon")
    print(f"\n    mismatches: {len(bad)}")
    for b in bad:
        print(f"      {b}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
