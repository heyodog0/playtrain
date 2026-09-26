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
import statistics as st
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
    if not Path(args.data).is_file():
        print("    skipped: its input under figures/outputs/ is missing")
        return 3
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

    # The prose around tab:eval (main.tex L1476-1479) makes four claims about
    # these same curves. Final value = mean over the last 5% of each seed's run.
    def fin(game, arm):
        out = []
        for sd in sorted(rec[game].get(arm, {})):
            x, y = rec[game][arm][sd]["x"], rec[game][arm][sd]["y"]
            if not x:
                continue
            cut = max(x) * 0.95
            v = [b for a, b in zip(x, y) if a >= cut]
            if v:
                out.append(st.fmean(v))
        return out

    checks = []
    fw_i = fin("freeway", "impala") + fin("freeway", "nature")
    checks.append(("freeway: IMPALA zero across both encoders and all 3 seeds",
                   all(abs(v) < 1e-9 for v in fw_i) and len(fw_i) == 6))
    fw_p = fin("freeway", "ppo_impala") + fin("freeway", "ppo_nature")
    checks.append((f"freeway: PPO returns of 12 to 13 on five of six seeds ({[round(v, 1) for v in fw_p]})",
                   sum(11.5 <= v < 13.5 for v in fw_p) == 5))
    ci, cp = st.fmean(fin("climber", "impala")), st.fmean(fin("climber", "ppo_impala"))
    checks.append((f"climber: only IMPALA finishes above zero (IMPALA {ci:.2f}, PPO {cp:.2f})", ci > 0 >= cp))
    ppo_w = [g for g in GAMES_ALL if st.fmean(fin(g, "ppo_impala")) > st.fmean(fin(g, "impala"))]
    imp_w = [g for g in GAMES_ALL if g not in ppo_w]
    named = ["climber", "coinrun", "chaser", "heist", "asteroids"]
    checks.append((f"IMPALA outperforms PPO on {', '.join(named)}", all(g in imp_w for g in named)))
    rest = [g for g in imp_w if g not in named]
    near = all(st.fmean(fin(g, "ppo_impala")) >= 0.97 * st.fmean(fin(g, "impala")) for g in rest)
    checks.append((f"PPO equal or better on the rest (within 3% on {', '.join(rest) or 'none'})", near))
    checks.append((f"PPO wins {len(ppo_w)} of the 24", len(ppo_w) == 17))
    print()
    for what, ok in checks:
        print(f"    {what:78s} {'match' if ok else 'DIFFERS'}")
    return 0 if all(ok for _, ok in checks) else 1

if __name__ == "__main__":
    raise SystemExit(main())
