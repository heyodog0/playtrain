"""N=2 smoke test for NodeVecEnv. Verifies it boots, steps, resets, and
produces obs of the right shape/dtype. No timing yet — that's probe_directvec_bench.py.
"""

from __future__ import annotations

import sys
import numpy as np

from node_gym import NodeVecEnv


def main(n: int = 2, game: str = "flappy_bird", steps: int = 10) -> int:
    print(f"NodeVecEnv smoke: n={n} game={game} steps={steps}")
    venv = NodeVecEnv(games=[game] * n, obs_size=64, obs_mode="rgb")
    try:
        obs, infos = venv.reset(seed=list(range(n)))
        assert obs.shape == (n, 64, 64, 3), f"reset obs shape {obs.shape}"
        assert obs.dtype == np.uint8
        print(f"  reset ok — obs shape {obs.shape}, dtype {obs.dtype}, "
              f"first-pixel sample {obs[0, 0, 0].tolist()}")
        for t in range(steps):
            actions = [t % 8 for _ in range(n)]
            obs, rewards, terms, truncs, infos = venv.step(actions)
            assert obs.shape == (n, 64, 64, 3)
            assert rewards.shape == (n,)
            assert terms.shape == (n,)
            assert truncs.shape == (n,)
            # Gymnasium 1.0: info is a dict (vectorised, not list-of-dicts)
            assert isinstance(infos, dict), f"infos type {type(infos)}"
        print(f"  stepped {steps} times — last rewards {rewards.tolist()} "
              f"terms {terms.tolist()} truncs {truncs.tolist()}")
        # Reset mid-life
        obs, infos = venv.reset(seed=[42 + i for i in range(n)])
        assert obs.shape == (n, 64, 64, 3)
        print(f"  re-reset ok")
    finally:
        venv.close()
    print("PASS")
    return 0


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    game = sys.argv[2] if len(sys.argv) > 2 else "flappy_bird"
    sys.exit(main(n=n, game=game))
