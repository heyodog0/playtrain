"""HandRolledSubprocVecEnv — minimal SB3-equivalent for benchmarking.

This is a benchmark-only artifact: a hand-rolled multiprocessing.Process +
multiprocessing.Pipe + pickle vec env that mirrors what
``stable_baselines3.common.vec_env.SubprocVecEnv`` does. We use it as the
A/B baseline against ``PlayTrainVecEnv`` so we can measure the cost of the
per-env child Python process and the obs pickle round-trip without taking
SB3 as a dependency.

Not intended for production use. Real users should pick either SB3's
SubprocVecEnv (battle-tested) or PlayTrainVecEnv (faster, this branch's
contribution). Lives under ``src/playtrain/runtime/_subproc_vec_env.py`` (with
the leading underscore) so it's importable from the bench scripts and
from multiprocessing-spawned children — without putting ``tools/`` on
PYTHONPATH (which would shadow stdlib ``profile`` via ``tools/profile.py``).
"""

from __future__ import annotations

import multiprocessing as mp
from typing import Any

import numpy as np


def _subproc_worker(remote, parent_remote, game: str, obs_size: int,
                    obs_mode: str, max_steps: int, autoreset: bool,
                    autoreset_seed: int | None) -> None:
    parent_remote.close()
    # Import inside child so the parent never imports playtrain.runtime (avoid double
    # mmap setup in parent on fork-based platforms).
    from playtrain.runtime import PlayTrainEnv
    env = PlayTrainEnv(game=game, obs_size=obs_size, obs_mode=obs_mode,
                     max_steps=max_steps)
    rng = np.random.default_rng(autoreset_seed)
    try:
        while True:
            cmd, data = remote.recv()
            if cmd == "step":
                obs, reward, term, trunc, info = env.step(int(data))
                # SB3-style autoreset: do it in the child, just like SB3
                # SubprocVecEnv. Parity with PlayTrainVecEnv's autoreset for an
                # honest A/B.
                if autoreset and (term or trunc):
                    info = dict(info) if not isinstance(info, dict) else info
                    info["terminal_observation"] = obs
                    seed = int(rng.integers(0, 2**31 - 1))
                    obs, _ = env.reset(seed=seed)
                remote.send((obs, float(reward), bool(term), bool(trunc), info))
            elif cmd == "reset":
                obs, info = env.reset(seed=data)
                remote.send((obs, info))
            elif cmd == "close":
                remote.send("ok")
                break
            else:
                remote.send(("error", f"unknown cmd {cmd}"))
                break
    finally:
        env.close()
        remote.close()


class HandRolledSubprocVecEnv:
    """Minimal SB3-equivalent: N child Python processes, each owns one PlayTrainEnv."""

    def __init__(self, *, games: list[str], obs_size: int = 64,
                 obs_mode: str = "rgb", max_steps: int = 2000,
                 autoreset: bool = True,
                 autoreset_seed: int | None = None) -> None:
        self.num_envs = len(games)
        ctx = mp.get_context("spawn")
        self.remotes, self.work_remotes = zip(*[ctx.Pipe() for _ in range(self.num_envs)])
        self.processes: list[mp.Process] = []
        # Per-env autoreset seed derived from the parent seed so different envs
        # don't all reset to the same trajectory.
        rng = np.random.default_rng(autoreset_seed)
        for i, (game, work_remote, remote) in enumerate(zip(games, self.work_remotes, self.remotes)):
            child_seed = int(rng.integers(0, 2**31 - 1))
            p = ctx.Process(target=_subproc_worker,
                            args=(work_remote, remote, game, obs_size, obs_mode,
                                  max_steps, autoreset, child_seed),
                            daemon=True)
            p.start()
            work_remote.close()
            self.processes.append(p)
        self._closed = False

    def reset(self, seeds: list[int | None]) -> np.ndarray:
        for r, s in zip(self.remotes, seeds):
            r.send(("reset", s))
        results = [r.recv() for r in self.remotes]
        obs = np.stack([o for o, _ in results], axis=0)
        return obs

    def step(self, actions) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, list]:
        for r, a in zip(self.remotes, actions):
            r.send(("step", int(a)))
        results = [r.recv() for r in self.remotes]
        obs = np.stack([t[0] for t in results], axis=0)
        rewards = np.array([t[1] for t in results], dtype=np.float32)
        terms = np.array([t[2] for t in results], dtype=bool)
        truncs = np.array([t[3] for t in results], dtype=bool)
        infos = [t[4] for t in results]
        return obs, rewards, terms, truncs, infos

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        for r in self.remotes:
            try:
                r.send(("close", None))
                r.recv()
            except Exception:
                pass
            try:
                r.close()
            except Exception:
                pass
        for p in self.processes:
            p.join(timeout=2)
            if p.is_alive():
                p.terminate()
                p.join(timeout=2)

    def __del__(self) -> None:
        try:
            self.close()
        except Exception:
            pass
