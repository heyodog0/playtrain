"""Post-hoc held-out evaluation for the binding-level generalization sweep.

Given a trained run (PPO or IMPALA, FF or LSTM), this loads its final checkpoint
and runs a greedy rollout on EVERY held-out "sword=key" config (visual id 12 ->
BLUE_KEY) — the configs training never saw — and reports the win-rate. That
win-rate is the Y-axis point for the run; the run's ``train_pool.n_train_bindings``
is the X-axis point.

Decoupling eval from the training loop means the same metric is computed
identically for PPO and IMPALA, and can be (re)run on any saved checkpoint.

Usage:
    uv run python tools/eval_generalization.py --run-dir outputs/<run> \\
        [--out outputs/<run>/heldout_eval.json] [--device auto]

    # evaluate many runs at once (writes <run>/heldout_eval.json in each)
    uv run python tools/eval_generalization.py --run-dir outputs/gen_*/
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))  # for make_run_card / rollout
from make_run_card import find_checkpoint, load_policy, rollout_one  # noqa: E402
from rollout import pick_device  # noqa: E402

from playtrain.runtime import PlayTrainEnv  # noqa: E402

from analogen.bindings import GAME  # noqa: E402
from analogen.generalization import WIN_RETURN_THRESHOLD, eval_pool, all_pool  # noqa: E402


def make_recolor(mode: str | None):
    """A fixed, invertible 'complete recolor' applied to each rendered frame
    (HWC uint8) before the policy sees it — tests whether the policy learned
    icon SHAPE (color-invariant) or leaned on color. None = identity."""
    if mode in (None, "none"):
        return None
    if mode == "permute":          # RGB -> GBR (every color changes, shapes kept)
        return lambda o: o[..., [1, 2, 0]]
    if mode == "invert":           # photonegative
        return lambda o: 255 - o
    raise ValueError(f"unknown recolor={mode!r}")


def evaluate_run(run_dir: Path, *, device: torch.device,
                 win_threshold: float, scan: int | None = None,
                 eval_per_binding: int | None = None,
                 deterministic: bool = True,
                 max_decisions: int | None = None,
                 recolor: str | None = None,
                 game_override: str | None = None,
                 binding_set: str = "heldout",
                 temperature: float | None = None) -> dict:
    """Greedy-eval a run; return a metrics dict.

    binding_set="heldout" (default) evals the unseen held-out class (id12=key,
    60 bindings). binding_set="all" evals EVERY binding (360) — for visual
    robustness, where the transform is a new env testable on any binding."""
    cfg = {}
    cfg_path = run_dir / "config.json"
    if cfg_path.exists():
        cfg = json.loads(cfg_path.read_text())

    spec = cfg.get("train_pool") or {}
    scan = scan if scan is not None else int(spec.get("scan", 20_000))
    eval_per_binding = (eval_per_binding if eval_per_binding is not None
                        else int(spec.get("eval_per_binding", 1)))
    # game_override builds the ENV (and held-out seeds) from a different game
    # variant than the run trained on — e.g. a recolor variant with identical
    # binding math — while the policy is still loaded from this run's checkpoint.
    game = game_override or cfg.get("game", GAME)
    frame_skip = int(cfg.get("frame_skip", 1))
    # Honor max_decisions (decision horizon) the same way train.py does, so the
    # held-out eval runs at the training episode length rather than the 2000-frame
    # default — important so the binding-agnostic search has the time it had in
    # training. Fall back to an explicit max_steps, else the 2000-frame default.
    # --max-decisions caps the eval horizon below the trained one. A real
    # generalizing solve finishes fast (~30-60 decisions); a non-generalizing
    # policy door-farms to truncation, which dominates eval time. Capping kills
    # that tail without dropping any real win.
    md_cfg = cfg.get("max_decisions")
    md = max_decisions if max_decisions is not None else md_cfg
    if md is not None:
        max_steps = int(md) * frame_skip
    else:
        max_steps = int(cfg.get("max_steps", 2000))
    obs_size = int(cfg.get("obs_size", 64))

    if binding_set == "all":
        seeds = all_pool(scan=scan, eval_per_binding=eval_per_binding, game=game)
    else:
        seeds = eval_pool(scan=scan, eval_per_binding=eval_per_binding, game=game,
                          holdout_pairs=spec.get("functional_holdout"))
    ckpt = find_checkpoint(run_dir)
    env = PlayTrainEnv(game=game, max_steps=max_steps, frame_skip=frame_skip,
                     obs_size=obs_size)
    obs_tf = make_recolor(recolor)
    try:
        policy = load_policy(ckpt, env, device, cfg)
        wins, returns = 0, []
        per_seed = []
        for s in seeds:
            ep = rollout_one(policy, env, seed=s, device=device,
                             deterministic=deterministic, max_steps=max_steps,
                             obs_transform=obs_tf, temperature=temperature)
            won = ep["total_return"] >= win_threshold
            wins += int(won)
            returns.append(ep["total_return"])
            per_seed.append({"seed": s, "return": ep["total_return"],
                             "length": ep["length"], "won": won})
    finally:
        env.close()

    return {
        "run_dir": str(run_dir),
        "checkpoint": str(ckpt),
        "game": game,
        "method": policy.method,
        "use_lstm": policy.use_lstm,
        # X axis: how many distinct bindings training saw (None if not a sweep run)
        "n_train_bindings": spec.get("n_train_bindings"),
        "split_seed": spec.get("split_seed"),
        "model_seed": cfg.get("seed"),
        "win_threshold": win_threshold,
        "n_eval": len(seeds),
        # Y axis:
        "heldout_win_rate": wins / len(seeds),
        "heldout_mean_return": sum(returns) / len(returns),
        "per_seed": per_seed,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run-dir", type=Path, nargs="+", required=True,
                    help="one or more run directories (each with final.pt + config.json)")
    ap.add_argument("--out", type=Path, default=None,
                    help="output JSON (single run only); default <run-dir>/heldout_eval.json")
    ap.add_argument("--device", type=str, default="auto")
    ap.add_argument("--win-threshold", type=float, default=WIN_RETURN_THRESHOLD)
    ap.add_argument("--scan", type=int, default=None,
                    help="override seed scan range (default: from config train_pool)")
    ap.add_argument("--eval-per-binding", type=int, default=None,
                    help="placement variants per held-out binding (default: from config)")
    ap.add_argument("--max-decisions", type=int, default=None,
                    help="cap eval episode horizon (decisions); default = trained "
                         "max_decisions. A real solve is short, so a small cap "
                         "(e.g. 600) speeds up non-generalizing runs hugely.")
    ap.add_argument("--recolor", choices=["none", "permute", "invert"], default="none",
                    help="apply a fixed complete recolor to the policy's input "
                         "(tests color-invariance). Writes heldout_eval_<recolor>.json.")
    ap.add_argument("--game", default=None,
                    help="override the env game (e.g. a recolor variant). Held-out "
                         "seeds come from this game's binding module; policy still "
                         "loads from the run checkpoint.")
    ap.add_argument("--out-suffix", default="",
                    help="suffix for the output filename: heldout_eval<suffix>.json")
    ap.add_argument("--stochastic", action="store_true",
                    help="sample actions instead of greedy argmax")
    ap.add_argument("--binding-set", choices=["heldout", "all"], default="heldout",
                    help="'heldout' (default) = the 60 unseen id12=key bindings "
                         "(generalization); 'all' = every binding (360) — for "
                         "visual-robustness eval, where the transform is a new env.")
    args = ap.parse_args()

    device = pick_device(args.device)
    run_dirs = [d for d in args.run_dir if d.is_dir()]
    if args.out is not None and len(run_dirs) != 1:
        ap.error("--out is only valid with a single --run-dir")

    for run_dir in run_dirs:
        res = evaluate_run(run_dir, device=device, win_threshold=args.win_threshold,
                           scan=args.scan, eval_per_binding=args.eval_per_binding,
                           deterministic=not args.stochastic,
                           max_decisions=args.max_decisions, recolor=args.recolor,
                           game_override=args.game, binding_set=args.binding_set)
        res["recolor"] = args.recolor
        res["eval_game"] = args.game
        res["binding_set"] = args.binding_set
        suffix = args.out_suffix or ("" if args.recolor == "none" else f"_{args.recolor}")
        fname = f"heldout_eval{suffix}.json"
        out = args.out if args.out is not None else run_dir / fname
        out.write_text(json.dumps(res, indent=2))
        print(f"{run_dir.name}: method={res['method']} "
              f"n_train_bindings={res['n_train_bindings']} "
              f"heldout_win_rate={res['heldout_win_rate']:.3f} "
              f"mean_return={res['heldout_mean_return']:.0f} "
              f"(n_eval={res['n_eval']}) -> {out}")


if __name__ == "__main__":
    main()
