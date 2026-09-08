"""Apples-to-apples RL-step throughput: identical IMPALA learner + CNN + GPU,
swap ONLY the env backend (node-gym vs ale-py vs procgen).

    python tools/bench_impala.py --backend node    --game breakout --steps 300000
    python tools/bench_impala.py --backend ale     --game breakout --steps 300000
    python tools/bench_impala.py --backend procgen  --game bigfish  --steps 300000

Metric: steady-state agent SPS (env steps consumed by the learner per second),
captured from train()'s own sps logging. Everything except env_fn is fixed:
same net (obs (3,64,64) RGB, cfg.features_dim), same num_actors / unroll / batch,
same GPU, same step budget. All three feed the net identical 64x64x3 RGB frames
(ALE is resized from 210x160; procgen and node-gym are native 64x64).
"""
from __future__ import annotations
import argparse, dataclasses, logging, re, statistics, tempfile
import numpy as np

# node-gym game name -> ALE env id (NoFrameskip == frameskip 1)
ATARI = {
    "breakout": "BreakoutNoFrameskip-v4",
    "space_invaders": "SpaceInvadersNoFrameskip-v4",
    "freeway": "FreewayNoFrameskip-v4",
    "frostbite": "FrostbiteNoFrameskip-v4",
    "asteroids": "AsteroidsNoFrameskip-v4",
}


# --------------------------------------------------------------------------
# minimal wrappers: present each baseline as a Gymnasium-API env emitting
# 64x64x3 uint8 HWC frames, with .action_space.n / .reset(seed=) / .step / .close
# --------------------------------------------------------------------------
def _nn_resize(img, size=64):
    """Nearest-neighbor resize HWC uint8 -> (size,size,3). Dep-free; fidelity
    is irrelevant for a throughput benchmark, but the resize cost is real work
    the ALE path pays per step (fair: it produces the obs the agent consumes)."""
    h, w = img.shape[:2]
    yi = (np.arange(size) * h // size)
    xi = (np.arange(size) * w // size)
    out = img[yi][:, xi]
    if out.ndim == 2:
        out = np.stack([out] * 3, axis=-1)
    return np.ascontiguousarray(out[:, :, :3].astype(np.uint8))


class _AleResize:
    """gymnasium ALE env -> 64x64x3 RGB obs."""
    def __init__(self, env):
        self.env = env
        self.action_space = env.action_space

    def reset(self, seed=None, options=None):
        obs, info = self.env.reset(seed=seed)
        return _nn_resize(obs), info

    def step(self, a):
        obs, r, term, trunc, info = self.env.step(a)
        return _nn_resize(obs), r, term, trunc, info

    def close(self):
        self.env.close()


class _ProcgenGymnasium:
    """old-gym procgen env -> Gymnasium API (reset->(obs,info), 5-tuple step).
    procgen obs is already 64x64x3 uint8."""
    def __init__(self, env):
        self.env = env
        class _AS:  # procgen action_space has .n
            n = int(env.action_space.n)
        self.action_space = _AS()

    def reset(self, seed=None, options=None):
        return np.ascontiguousarray(self.env.reset(), dtype=np.uint8), {}

    def step(self, a):
        obs, r, done, info = self.env.step(a)
        return np.ascontiguousarray(obs, dtype=np.uint8), r, bool(done), False, info

    def close(self):
        try: self.env.close()
        except Exception: pass


def make_env_fn(backend, game, seed):
    if backend == "ale":
        import gymnasium as gym, ale_py
        gym.register_envs(ale_py)
        env_id = ATARI[game]
        def _fn(actor_index):
            e = gym.make(env_id, frameskip=1, repeat_action_probability=0.0)
            return _AleResize(e), seed * 1_000_000 + actor_index
        return _fn
    if backend == "procgen":
        import gym, procgen  # noqa: F401  (registers procgen-* envs)
        def _fn(actor_index):
            e = gym.make(f"procgen-{game}-v0", num_levels=0, start_level=0)
            return _ProcgenGymnasium(e), seed * 1_000_000 + actor_index
        return _fn
    raise ValueError(backend)


# --------------------------------------------------------------------------
class _SpsCapture(logging.Handler):
    """Scrape 'sps=<n>' from train()'s log records."""
    def __init__(self):
        super().__init__()
        self.sps = []
        self._re = re.compile(r"sps=([0-9.]+)")
    def emit(self, record):
        m = self._re.search(record.getMessage())
        if m:
            self.sps.append(float(m.group(1)))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--backend", choices=["node", "ale", "procgen"], required=True)
    p.add_argument("--game", required=True)
    p.add_argument("--steps", type=int, default=300_000)
    p.add_argument("--num-actors", type=int, default=8)
    p.add_argument("--unroll", type=int, default=80)
    p.add_argument("--batch-size", type=int, default=8)
    p.add_argument("--features-dim", type=int, default=256)
    p.add_argument("--device", default="cuda")
    p.add_argument("--inference-mode", default="shared_cpu")
    a = p.parse_args()

    from playtrain_trainers.impala.train import ImpalaConfig, train

    cfg = ImpalaConfig(
        game=a.game,
        env_backend="playtrain",              # only used when backend==node
        frame_skip=1, frame_stack=1,
        total_steps=a.steps,
        num_actors=a.num_actors,
        batch_size=a.batch_size,
        unroll_length=a.unroll,
        features_dim=a.features_dim,
        use_lstm=False,
        device=a.device,
        inference_mode=a.inference_mode,
        obs_shape=(3, 64, 64),               # identical net across all backends
        use_wandb=False,
        log_dir=tempfile.mkdtemp(prefix=f"impala-{a.backend}-{a.game}-"),
        seed=0,
    )

    env_fn = None if a.backend == "node" else make_env_fn(a.backend, a.game, cfg.seed)

    cap = _SpsCapture()
    logging.getLogger().addHandler(cap)
    logging.getLogger().setLevel(logging.INFO)

    print(f"=== IMPALA RL-step bench: backend={a.backend} game={a.game} "
          f"actors={a.num_actors} steps={a.steps} device={a.device} ===")
    train(cfg, env_fn=env_fn)

    # steady state = non-zero samples with the first (warm-up ramp) dropped
    nz = [x for x in cap.sps if x > 1.0]
    steady = nz[1:] if len(nz) >= 4 else nz
    if steady:
        print(f"\nRESULT backend={a.backend} game={a.game}  "
              f"steady-state SPS: median {statistics.median(steady):.0f}  "
              f"mean {statistics.fmean(steady):.0f}  max {max(steady):.0f}  "
              f"(n={len(steady)} of {len(cap.sps)} samples)")
    else:
        print(f"\nRESULT backend={a.backend} game={a.game}: no non-zero sps samples "
              f"({len(cap.sps)} raw)")


if __name__ == "__main__":
    main()
