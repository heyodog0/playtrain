"""Per-key-visual generalization probe for N=1 memorization runs.

For each trained checkpoint, greedy-eval win-rate on bindings grouped by which
icon is the BLUE_KEY (the "key-visual"):
  - TRAIN   : the exact trained binding's placements (memorization baseline)
  - key NN  : OTHER bindings whose key-visual is NN (different binding). The
              trained binding_key is excluded so every probe binding is one the
              run never trained on.
id12 (the held-out sword=key class) is covered by tools/eval_generalization.py.

Tells memorization (wins only on TRAIN) apart from generalization (wins across
other key-visuals too).

    uv run python tools/analysis/binding_probe.py \
        --run outputs/impala_23525671 outputs/impala_23525682 outputs/impala_23525683 \
        --k 8
"""
import argparse
import json
from collections import defaultdict
from pathlib import Path

import torch

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # tools/
from make_run_card import find_checkpoint, load_policy, rollout_one  # noqa: E402
from playtrain.runtime import PlayTrainEnv  # noqa: E402
from analogen.generalization import (  # noqa: E402
    _classify_bindings, _balanced_order, key_visual_of, WIN_RETURN_THRESHOLD,
)

PROBE_KVS = [6, 7, 14, 17, 18]  # train-class key-visuals (id12 = held-out, see eval_generalization)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", nargs="+", required=True)
    ap.add_argument("--game", default="analogen_cavequest_medium")
    ap.add_argument("--scan", type=int, default=50000)
    ap.add_argument("--k", type=int, default=8, help="probe bindings per key-visual")
    ap.add_argument("--frame-skip", type=int, default=7)
    ap.add_argument("--max-decisions", type=int, default=2000)
    args = ap.parse_args()

    groups, train_keys, test_keys = _classify_bindings(args.scan, args.game)
    ordered = _balanced_order(train_keys, groups, 0, args.game)
    train_key = ordered[0]                       # binding_offset 0 = the trained binding
    train_seeds = groups[train_key][:args.k]     # placements of the trained binding

    # bucket OTHER bindings by key-visual (exclude the trained binding_key)
    buckets = defaultdict(list)
    for k in train_keys:
        if k == train_key:
            continue
        buckets[key_visual_of(k, groups, args.game)].append(k)
    probe_seeds = {}
    for kv in PROBE_KVS:
        seeds = []
        for k in buckets.get(kv, []):
            seeds.extend(groups[k][:1])          # one placement per distinct binding
        probe_seeds[kv] = seeds[:args.k]

    max_steps = args.max_decisions * args.frame_skip
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    env = PlayTrainEnv(game=args.game, max_steps=max_steps, frame_skip=args.frame_skip, obs_size=64)

    def winrate(policy, seeds):
        if not seeds:
            return None
        w = 0
        for s in seeds:
            ep = rollout_one(policy, env, seed=s, device=device, deterministic=True, max_steps=max_steps)
            w += int(ep["total_return"] >= WIN_RETURN_THRESHOLD)
        return w / len(seeds)

    cols = ["TRAIN"] + [f"key{kv}" for kv in PROBE_KVS]
    print(f"trained binding key-visual = {key_visual_of(train_key, groups, args.game)} (TRAIN), k={args.k}")
    print(f"{'run':>20} | " + " ".join(f"{c:>6}" for c in cols))
    print("-" * (22 + 7 * len(cols)))
    results = {}
    try:
        for rd in args.run:
            rd = Path(rd)
            cfg = json.loads((rd / "config.json").read_text())
            policy = load_policy(find_checkpoint(rd), env, device, cfg)
            row = {"TRAIN": winrate(policy, train_seeds)}
            for kv in PROBE_KVS:
                row[f"key{kv}"] = winrate(policy, probe_seeds[kv])
            results[rd.name] = row
            cells = " ".join(f"{(row[c] if row[c] is not None else float('nan')):6.2f}" for c in cols)
            print(f"{rd.name:>20} | {cells}")
    finally:
        env.close()

    out = Path("outputs/figs/binding_probe.json")
    out.write_text(json.dumps(results, indent=2))
    print("wrote", out)


if __name__ == "__main__":
    main()
