"""Generate the binding-level generalization sweep configs.

For each train-set size N (number of distinct bindings the agent may see) this
emits a PPO and an IMPALA config that:
  - inject a ``train_pool`` spec (restricts training to N distinct non-held-out
    bindings; the held-out "sword=key" class is excluded), and
  - drop ``fixed_env_seed`` (mutually exclusive with train_pool).

Held-out win-rate (the Y-axis) is evaluated post-hoc with
tools/eval_generalization.py; the X-axis is N. Same ``split_seed`` => the N-set
is a nested subset of the (N+k)-set, so the curve is clean.

Base configs are the existing v7 6x6 inv1 LSTM configs (so all the tuned
hyperparameters carry over). Outputs land in configs/nodegym_v7_gen/.

Usage:
    uv run python tools/gen_generalization_configs.py
    uv run python tools/gen_generalization_configs.py --n 1 2 4 8 16 32 64 128 \\
        --model-seeds 0 1 --total-steps 10000000
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from analogen.bindings import GAME
from analogen.generalization import N_TRAIN_BINDINGS_MAX

_REPO = Path(__file__).resolve().parents[1]
_CFG_DIR = _REPO / "configs" / "nodegym_v7"
_OUT_DIR = _REPO / "configs" / "nodegym_v7_gen"

DEFAULT_PPO_BASE = _CFG_DIR / "ppo_cnn_grid_v7_2rooms_door_6x6_inv1_lstm_frameskip7_25m_seed0.json"
DEFAULT_IMPALA_BASE = _CFG_DIR / "impala_nodegym_v7_2rooms_door_6x6_inv1_lstm_frameskip7_25m_seed0.json"

DEFAULT_NS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512]


def _emit(base: dict, *, algo: str, n: int, model_seed: int, split_seed: int,
          scan: int, total_steps: int | None) -> tuple[str, dict]:
    cfg = dict(base)
    cfg.pop("fixed_env_seed", None)  # mutually exclusive with train_pool
    cfg["seed"] = model_seed
    cfg["train_pool"] = {
        "game": GAME,
        "n_train_bindings": n,
        "split_seed": split_seed,
        "scan": scan,
        "placements_per_binding": 1,
        "eval_per_binding": 1,
    }
    if total_steps is not None:
        # PPO uses total_timesteps, IMPALA uses total_steps.
        cfg["total_timesteps" if algo == "ppo" else "total_steps"] = total_steps

    name = f"{algo}_v7_6x6_inv1_gen_n{n:04d}_s{split_seed}_seed{model_seed}"
    cfg["log_dir"] = f"outputs/{name}"
    cfg["wandb_group"] = f"v7_6x6_inv1_gen_{algo}"
    cfg["wandb_name"] = name
    return name, cfg


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--algos", type=str, nargs="+", default=["ppo", "impala"],
                    choices=["ppo", "impala"], help="which trainers to emit configs for")
    ap.add_argument("--n", type=int, nargs="+", default=DEFAULT_NS,
                    help="train-set sizes (distinct bindings) to sweep")
    ap.add_argument("--model-seeds", type=int, nargs="+", default=[0],
                    help="model/training seeds per N (repeats for error bars)")
    ap.add_argument("--split-seed", type=int, default=0,
                    help="fixes which bindings are chosen (nested across N)")
    ap.add_argument("--scan", type=int, default=20_000)
    ap.add_argument("--total-steps", type=int, default=None,
                    help="override training length (default: base config's)")
    ap.add_argument("--ppo-base", type=Path, default=DEFAULT_PPO_BASE)
    ap.add_argument("--impala-base", type=Path, default=DEFAULT_IMPALA_BASE)
    ap.add_argument("--out-dir", type=Path, default=_OUT_DIR)
    args = ap.parse_args()

    for n in args.n:
        if not 0 < n <= N_TRAIN_BINDINGS_MAX:
            ap.error(f"N={n} out of range [1, {N_TRAIN_BINDINGS_MAX}]")

    args.out_dir.mkdir(parents=True, exist_ok=True)
    _base_paths = {"ppo": args.ppo_base, "impala": args.impala_base}
    bases = {algo: json.loads(_base_paths[algo].read_text()) for algo in args.algos}

    written = 0
    for algo, base in bases.items():
        for n in args.n:
            for model_seed in args.model_seeds:
                name, cfg = _emit(base, algo=algo, n=n, model_seed=model_seed,
                                  split_seed=args.split_seed, scan=args.scan,
                                  total_steps=args.total_steps)
                (args.out_dir / f"{name}.json").write_text(json.dumps(cfg, indent=2))
                written += 1

    print(f"wrote {written} configs to {args.out_dir}/")
    print(f"  algos: {list(bases)}  N: {args.n}  model_seeds: {args.model_seeds}")
    print(f"  X-axis = n_train_bindings; Y-axis via tools/eval_generalization.py")


if __name__ == "__main__":
    main()
