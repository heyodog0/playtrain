"""Adversarial generalization test for N=1 memorization runs.

Relative to the TRAINED binding (binding_offset 0), build the maximal
memorization-trap set: bindings where
  - BLUE_KEY sits on a training-UNUSED icon (HAT/ARMOR in training), AND
  - BOOTS is relocated off its trained icon, AND
  - NO functional role (KEY/BOOTS/SWORD) sits on the icon it occupied in training.
A memorizer (grab trained-key icon, ignore trained-distractor icons) gets every
critical item wrong; only a real binding-agnostic searcher can win.

Reports greedy win-rate on the trap set vs a TRAIN baseline, per checkpoint.

    uv run python tools/analysis/adversarial_eval.py \
        --run outputs/impala_23525671 outputs/impala_23525682 outputs/impala_23525683
"""
import argparse
import json
from pathlib import Path

import torch

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # tools/
from make_run_card import find_checkpoint, load_policy, rollout_one  # noqa: E402
from playtrain.runtime import PlayTrainEnv  # noqa: E402
from analogen import bindings_8x8  # noqa: E402
from analogen.generalization import (  # noqa: E402
    _classify_bindings, _balanced_order, WIN_RETURN_THRESHOLD,
)

USED = {"BLUE_KEY", "BOOTS", "SWORD"}


def _icon_of(tool, role):
    return next(v for v, r in tool.items() if r == role)


def build_sets(game, scan, k_train):
    groups, train_keys, test_keys = _classify_bindings(scan, game)
    ordered = _balanced_order(train_keys, groups, 0, game)
    train_key = ordered[0]
    train = bindings_8x8.role_binding(groups[train_key][0])["tool"]
    train_unused = [v for v, r in train.items() if r in ("HAT", "ARMOR")]
    train_func = {v: r for v, r in train.items() if r in USED}
    train_boots = _icon_of(train, "BOOTS")

    adversarial = []
    for kk in train_keys + test_keys:
        t = bindings_8x8.role_binding(groups[kk][0])["tool"]
        key_on_unused = _icon_of(t, "BLUE_KEY") in train_unused
        boots_moved = _icon_of(t, "BOOTS") != train_boots
        no_func_match = all(t.get(v) != train_func[v] for v in train_func)
        if key_on_unused and boots_moved and no_func_match:
            adversarial.append(groups[kk][0])
    train_seeds = groups[train_key][:k_train]
    return train, train_seeds, adversarial


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", nargs="+", required=True)
    ap.add_argument("--game", default="analogen_cavequest_medium")
    ap.add_argument("--scan", type=int, default=50000)
    ap.add_argument("--k-train", type=int, default=10)
    ap.add_argument("--frame-skip", type=int, default=7)
    ap.add_argument("--max-decisions", type=int, default=2000)
    args = ap.parse_args()

    train, train_seeds, adv = build_sets(args.game, args.scan, args.k_train)
    print(f"trained binding: {{{', '.join(f'id{v}:{r}' for v,r in sorted(train.items()))}}}")
    print(f"adversarial trap bindings: {len(adv)}  |  TRAIN placements: {len(train_seeds)}")

    max_steps = args.max_decisions * args.frame_skip
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    env = PlayTrainEnv(game=args.game, max_steps=max_steps, frame_skip=args.frame_skip, obs_size=64)

    def evalset(policy, seeds):
        wins, lens = 0, []
        for s in seeds:
            ep = rollout_one(policy, env, seed=s, device=device, deterministic=True, max_steps=max_steps)
            won = ep["total_return"] >= WIN_RETURN_THRESHOLD
            wins += int(won)
            if won:
                lens.append(ep["length"])
        avglen = (sum(lens) / len(lens)) if lens else None
        return wins / len(seeds), avglen

    print(f"\n{'run':>20} | {'TRAIN win':>10} | {'ADVERSARIAL win':>16} | {'adv win len':>12}")
    print("-" * 66)
    results = {}
    try:
        for rd in args.run:
            rd = Path(rd)
            cfg = json.loads((rd / "config.json").read_text())
            policy = load_policy(find_checkpoint(rd), env, device, cfg)
            tr_wr, _ = evalset(policy, train_seeds)
            adv_wr, adv_len = evalset(policy, adv)
            results[rd.name] = {"train_win": tr_wr, "adv_win": adv_wr,
                                "adv_win_len": adv_len, "n_adv": len(adv)}
            ln = f"{adv_len:.0f}" if adv_len else "-"
            print(f"{rd.name:>20} | {tr_wr:>10.2f} | {adv_wr:>16.2f} | {ln:>12}")
    finally:
        env.close()

    out = Path("outputs/figs/adversarial_eval.json")
    out.write_text(json.dumps(results, indent=2))
    print("wrote", out)


if __name__ == "__main__":
    main()
