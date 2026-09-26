"""tab:hyperparams: every published value against the suite run configs.

The table describes the 100M suite training runs, so the authority is the
config.json each run carries (shipped under figures/outputs/): outputs/s3_icnn_* for
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
        print("    skipped: its input under figures/outputs/ is missing")
        return 3
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
    if n != 6144 or len(c["vec_worker_device"].split(",")) != 2:
        bad.append(f"IMPALA-CNN topology: {n} envs on {c['vec_worker_device']}")
    if c.get("compile_mode") != "max-autotune-no-cudagraphs":
        bad.append(f"IMPALA torch.compile: {c.get('compile_mode')!r}")
    print(f"      torch.compile (IMPALA) {c.get('compile_mode')!r}   (paper: max-autotune-no-cudagraphs)")

    # Nature-CNN topology: the throughput configuration (Table 1a, the dbuf ablation):
    # the full-node template with the batch size those jobs set (runs/44748571).
    root = Path(__file__).resolve().parents[3]
    tr = next((d for d in (root / "trainers", root.parent / "playtrain-trainers") if d.is_dir()), None)
    tpl = json.load(open(tr / "configs" / "pt_bigfish_nature_fullnode.json")) if tr else None
    if not tpl:
        print("    Nature-CNN topology and optimizers: skipped (clone playtrain-trainers beside this repo)")
    if tpl:
        inf = len(tpl["vec_worker_device"].split(","))
        nn = tpl["vec_workers"] * 2 * 256
        print(f"    Nature-CNN topology: {tpl['vec_workers']} workers x {tpl['vec_env_threads']} threads,"
              f" {4 - inf} DDP + {inf} inference GPUs, {tpl['vec_workers']}x2x256 = {nn:,}"
              "   (paper: 15 x 5, 1 DDP + 3 inference, 7,680)")
        if (tpl["vec_workers"], tpl["vec_env_threads"], inf, nn) != (15, 5, 3, 7680):
            bad.append("Nature-CNN topology differs from the paper")
        src = tr / "src" / "playtrain_trainers"
        rms = "torch.optim.RMSprop(" in (src / "impala" / "train.py").read_text()
        adam = "torch.optim.Adam(" in (src / "train_ppo_clean.py").read_text()
        print(f"    optimizers: IMPALA RMSProp {rms}, PPO Adam {adam}   (paper: RMSProp / Adam)")
        if not (rms and adam):
            bad.append("optimizers differ from the paper")
    print(f"\n    mismatches: {len(bad)}")
    for b in bad:
        print(f"      {b}")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
