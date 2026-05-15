"""Determinism check for NodeVecEnv: same seeds + same actions → byte-equal obs.

Runs two passes with identical seeds and identical action sequence, then
hash-compares the full obs tensor at every step. If any step differs, prints
the first divergence.
"""

from __future__ import annotations

import hashlib
import sys
import numpy as np

from node_gym import NodeVecEnv


def run_one_pass(*, n: int, game: str, steps: int, seed_base: int,
                 actions_seed: int, autoreset: bool,
                 autoreset_seed: int | None) -> tuple[list[str], int]:
    venv = NodeVecEnv(games=[game] * n, obs_size=64, obs_mode="rgb",
                      autoreset=autoreset, autoreset_seed=autoreset_seed)
    rng = np.random.default_rng(actions_seed)
    hashes: list[str] = []
    n_terminals = 0
    try:
        obs, _ = venv.reset(seeds=[seed_base + i for i in range(n)])
        hashes.append(hashlib.sha256(obs.tobytes()).hexdigest()[:16])
        for _ in range(steps):
            acts = rng.integers(0, 8, size=n).tolist()
            obs, _, terms, truncs, _ = venv.step(acts)
            hashes.append(hashlib.sha256(obs.tobytes()).hexdigest()[:16])
            n_terminals += int(terms.sum() + truncs.sum())
    finally:
        venv.close()
    return hashes, n_terminals


def main(n: int = 4, game: str = "flappy_bird", steps: int = 200,
         autoreset: bool = True, autoreset_seed: int = 7) -> int:
    print(f"Determinism: n={n} game={game} steps={steps} "
          f"autoreset={autoreset} autoreset_seed={autoreset_seed}")
    h1, term1 = run_one_pass(n=n, game=game, steps=steps, seed_base=0,
                             actions_seed=42, autoreset=autoreset,
                             autoreset_seed=autoreset_seed)
    h2, term2 = run_one_pass(n=n, game=game, steps=steps, seed_base=0,
                             actions_seed=42, autoreset=autoreset,
                             autoreset_seed=autoreset_seed)
    print(f"  pass1 terminals={term1}, pass2 terminals={term2}")
    if h1 == h2:
        print(f"PASS — {len(h1)} hashes match (last={h1[-1]})")
        return 0
    for i, (a, b) in enumerate(zip(h1, h2)):
        if a != b:
            print(f"FAIL at step {i}: pass1={a} pass2={b}")
            return 1
    print(f"FAIL — length differs: {len(h1)} vs {len(h2)}")
    return 1


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 4
    game = sys.argv[2] if len(sys.argv) > 2 else "flappy_bird"
    steps = int(sys.argv[3]) if len(sys.argv) > 3 else 200
    autoreset = (sys.argv[4].lower() in ("1", "true", "yes")
                 if len(sys.argv) > 4 else True)
    sys.exit(main(n=n, game=game, steps=steps, autoreset=autoreset))
