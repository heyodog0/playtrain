"""The three appendix suite figures: composition against what the captions claim.

fig:suite_trainers says "all 24 games, both with the IMPALA-CNN encoder, 100M
environment steps, three seeds per plot", and the two encoder figures say "same
setup". This checks the curve record behind all three: 24 games, four arms,
three seeds each, and where each arm's curve starts and ends.

It also checks the two arithmetic claims in the caption:
  PPO curves start at 0.5M    (192 envs x 2,000 frames = 0.38M, so 0.5M clears it)
  the 2,000-frame horizon is at 12.3M for IMPALA  (6,144 envs x 2,000 = 12.288M)

    python tools/check_suite.py --data outputs/_suite4_curves.json
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

GAMES_ALL = ["asteroids", "bigfish", "bossfight", "breakout", "caveflyer",
             "chaser", "climber", "coinrun", "dodgeball", "freeway",
             "frostbite", "fruitbot", "heist", "jumper", "leaper", "maze",
             "miner", "ninja", "plunder", "pong", "qbert", "seaquest",
             "space_invaders", "starpilot"]
ARMS = [("impala", "IMPALA + IMPALA-CNN"), ("nature", "IMPALA + Nature-CNN"),
        ("ppo_impala", "PPO + IMPALA-CNN"), ("ppo_nature", "PPO + Nature-CNN")]
NO_FAILURE = ["maze", "heist", "freeway"]
PPO_ENVS, IMPALA_ENVS, HORIZON = 192, 6144, 2000


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=Path("outputs/_suite4_curves.json"), type=Path)
    args = ap.parse_args()
    rec = json.load(open(args.data))

    missing = [g for g in GAMES_ALL if g not in rec]
    print(f"    games {len(rec)} of 24{'' if not missing else '  MISSING ' + ','.join(missing)}"
          "   (paper: all 24 games)")

    for key, label in ARMS:
        counts, lo, hi = [], [], []
        for g in GAMES_ALL:
            seeds = rec.get(g, {}).get(key, {})
            counts.append(len(seeds))
            for s in seeds.values():
                xs = s["x"]          # steps; y is the episodic return
                if xs:
                    lo.append(min(xs)); hi.append(max(xs))
        n = sorted(set(counts))
        print(f"    {label:22s} seeds/game {n if len(n) > 1 else n[0]}"
              f"   first step {min(lo)/1e6:6.2f}M   last step {max(hi)/1e6:7.2f}M")

    print(f"    three seeds everywhere: "
          f"{'yes' if all(len(rec[g].get(k, {})) == 3 for g in GAMES_ALL for k, _ in ARMS) else 'NO'}"
          "   (paper: three seeds per plot)")
    print(f"    PPO truncation wave {PPO_ENVS} x {HORIZON} = {PPO_ENVS*HORIZON/1e6:.2f}M,"
          f" so the 0.5M cut clears it   (paper: PPO curves start at 0.5M)")
    print(f"    IMPALA horizon {IMPALA_ENVS} x {HORIZON} = {IMPALA_ENVS*HORIZON/1e6:.3f}M"
          f"   (paper: 12.3M for {', '.join(NO_FAILURE)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
