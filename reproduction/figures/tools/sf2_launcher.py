"""SF2 Atari launcher for gymnasium-0.29 environments: gymnasium removed
plugin autoloading (0.27+), and shimmy 1.3 registers only ALE/v5 — SF2 asks
for legacy NoFrameskip-v4 ids. Register both, then run SF2 unmodified."""
import sys
from shimmy.registration import register_gymnasium_envs
register_gymnasium_envs()
import gymnasium as gym
# gymnasium 1.x renamed the wrappers SF2 uses; alias the 0.29 names.
import gymnasium.wrappers as _w
_w.GrayScaleObservation = _w.GrayscaleObservation
_w.FrameStack = _w.FrameStackObservation
for g in ("breakout", "pong", "space_invaders", "qbert", "seaquest",
          "asteroids", "freeway", "frostbite"):
    cap = "".join(w.capitalize() for w in g.split("_"))
    gym.register(
        id=f"{cap}NoFrameskip-v4",
        entry_point="shimmy.atari_env:AtariEnv",
        kwargs=dict(game=g, obs_type="rgb", frameskip=1,
                    repeat_action_probability=0.0, full_action_space=False),
        max_episode_steps=108000,
    )
if __name__ == "__main__":
    from sf_examples.atari.train_atari import main
    sys.exit(main())
