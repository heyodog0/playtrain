"""Split per-game env step time into game logic vs rasterization.

The limitations paragraph claims two distinct binding modes -- draw calls
(qbert.v2 at 39k SPS) and game-logic state updates (miner, the one ProcGen
replica slower than the C++ original) -- but reports no number separating them.
This measures the split directly.

Method. The native host has a per-tick `g_nodraw` flag that suppresses p5 draw
calls while still running the game's `draw()` body; it is driven by
`render_skip && (k+1 < frame_skip)`, so with frame_skip=K one condition draws
K times per step and the other draws once:

    render_skip off:  t_off = K*L + K*D
    render_skip on:   t_on  = K*L + 1*D
    =>  D = (t_off - t_on) / (K - 1)        one rasterization
        L = (t_on - D) / K                  one tick of game logic

Rates do not subtract; times do, so everything below is microseconds per tick.

`L` also absorbs the once-per-step obs readback (`render_obs_rgb`, a
64*64*3 = 12 KB copy) and QuickJS interpreter overhead. It is "everything that
is not a p5 draw call", not a pure logic number -- see `obs` below for how much
of the fill cost that leaves on the table.

Running at two obs sizes further splits D, because per-draw-call dispatch is
resolution-independent while the fill is not:

    D(S) = C_call + C_fill * (S/64)^2
    =>  C_fill = (D64 - D32) / (1 - 1/4)
        C_call = D64 - C_fill

Single-threaded on purpose: Figure 4D reports per-core numbers and this has to
be comparable to it.

usage (CPU partition, no GPU):
  uv run python tools/bench_render_split.py --out outputs/render_split.json
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np

from playtrain.runtime.native_vec_env import NativeVecEnv

SUITE = ("plunder bigfish bossfight ninja starpilot heist leaper maze dodgeball "
         "jumper chaser caveflyer coinrun fruitbot climber miner pong freeway "
         "seaquest space_invaders asteroids frostbite breakout qbert").split()
VARIANTS = ["breakout.multi", "qbert.v2", "flappy_bird", "flappy_bird.dunk2",
            "frostbite.jungle"]


def time_condition(game: str, *, render_skip: bool, obs: int, frame_skip: int,
                   num_envs: int, seconds: float, games_dir: str,
                   num_actions: int = 8, seed: int = 0) -> float:
    """Mean wall-clock SECONDS per env-step (a step = frame_skip ticks)."""
    env = NativeVecEnv(game, num_envs=num_envs, obs_size=obs, max_steps=2000,
                       num_threads=1, autoreset=True, frame_skip=frame_skip,
                       render_skip=render_skip, games_dir=games_dir)
    rng = np.random.default_rng(seed)
    env.reset(seeds=(seed + np.arange(num_envs)).astype(np.int32))
    acts = rng.integers(0, num_actions, size=(64, num_envs), dtype=np.int32)
    for i in range(20):                       # warm up JIT + allocator
        env.step(acts[i % 64])
    t0, steps = time.perf_counter(), 0
    while time.perf_counter() - t0 < seconds:
        env.step(acts[steps % 64])
        steps += 1
    el = time.perf_counter() - t0
    try:
        env.close()
    except Exception:
        pass
    return el / (steps * num_envs)


def split(game: str, *, obs: int, frame_skip: int, num_envs: int,
          seconds: float, games_dir: str) -> dict:
    t_off = time_condition(game, render_skip=False, obs=obs, frame_skip=frame_skip,
                           num_envs=num_envs, seconds=seconds, games_dir=games_dir)
    t_on = time_condition(game, render_skip=True, obs=obs, frame_skip=frame_skip,
                          num_envs=num_envs, seconds=seconds, games_dir=games_dir)
    D = (t_off - t_on) / (frame_skip - 1)
    L = (t_on - D) / frame_skip
    # Also time the game the way the PROBES are timed -- frame_skip=1, nothing
    # skipped. The split above derives a PER-TICK cost from a frame_skip=4 run,
    # which amortises the once-per-step obs readback over four ticks; that number
    # is not comparable to a frame_skip=1 probe, and mixing them made one game
    # appear faster than an empty environment.
    t_fs1 = time_condition(game, render_skip=False, obs=obs, frame_skip=1,
                           num_envs=num_envs, seconds=seconds, games_dir=games_dir)
    return {"obs": obs, "t_fs1_us": t_fs1 * 1e6, "sps_fs1": 1.0 / t_fs1,
            "t_off_us": t_off * 1e6, "t_on_us": t_on * 1e6,
            "draw_us": D * 1e6, "logic_us": L * 1e6,
            "render_share": D / (L + D) if (L + D) > 0 else float("nan"),
            "sps_1core": 1.0 / (L + D) if (L + D) > 0 else 0.0}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--games", default=",".join(SUITE + VARIANTS))
    ap.add_argument("--frame-skip", type=int, default=4)
    ap.add_argument("--num-envs", type=int, default=8)
    ap.add_argument("--seconds", type=float, default=4.0)
    ap.add_argument("--obs", default="64,32")
    ap.add_argument("--games-dir",
                    default="../playtrain/examples/games/js")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    obs_sizes = [int(o) for o in args.obs.split(",")]

    rows = []
    for game in args.games.split(","):
        rec = {"game": game}
        try:
            for obs in obs_sizes:
                rec[f"obs{obs}"] = split(game, obs=obs, frame_skip=args.frame_skip,
                                         num_envs=args.num_envs,
                                         seconds=args.seconds,
                                         games_dir=args.games_dir)
            if len(obs_sizes) == 2 and obs_sizes == [64, 32]:
                d64, d32 = rec["obs64"]["draw_us"], rec["obs32"]["draw_us"]
                c_fill = (d64 - d32) / 0.75
                rec["fill_us"] = c_fill
                rec["call_us"] = d64 - c_fill
        except Exception as e:  # noqa: BLE001
            rec["error"] = f"{type(e).__name__}: {e}"
        rows.append(rec)
        r = rec.get("obs64", {})
        print(f"  {game:<20} logic={r.get('logic_us', float('nan')):7.1f}us  "
              f"draw={r.get('draw_us', float('nan')):7.1f}us  "
              f"render={100 * r.get('render_share', float('nan')):5.1f}%  "
              f"1core_sps={r.get('sps_1core', 0):8,.0f}"
              + (f"  [{rec['error']}]" if "error" in rec else ""), flush=True)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(
        {"frame_skip": args.frame_skip, "num_envs": args.num_envs,
         "threads": 1, "rows": rows}, indent=1))
    print("wrote", args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
