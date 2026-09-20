"""G7: the bundles are ordinary PlayTrain games: the sidecar is honoured and NativeVecEnv steps them, with the level
drawn in the game's own colours."""
import numpy as np
import pytest

from playtrain.runtime.env import load_sidecar, resolve_game_file


def test_sidecar_declares_space_pace_and_reference():
    side = load_sidecar(resolve_game_file("ps_kettle"))
    assert side["family"] == "puzzlescript" and side["action_space"] == "ps6" and len(side["actions"]) == 6
    assert side["max_steps"] == 1000 and side["human"]["steps_per_second"] == 8 and side["parity"] is True
    assert side["reference"]["commit"] == "d236596d993b6ebb7988f1a078f582c0840ccbca" and side["level_mode"] == "seed"


def test_native_vec_steps_and_resets():
    try:
        from playtrain.runtime import NativeVecEnv
        v = NativeVecEnv(game="ps_microban", num_envs=4, num_threads=2, obs_size=64, autoreset=True)
    except Exception as e:  # noqa: BLE001
        pytest.skip(f"native backend unavailable: {e}")
    v.reset([0, 1, 2, 3])
    rng = np.random.default_rng(0)
    total = 0.0
    for _ in range(100):
        out = v.step(rng.integers(0, 6, size=4))
        obs, rew = out[0], out[1]
        total += float(rew.sum())
    v.close()
    assert obs.shape == (4, 64, 64, 3) and obs.dtype == np.uint8
    frame = obs[0]
    colours = {tuple(c) for c in np.unique(frame.reshape(-1, 3), axis=0)}
    assert len(colours) >= 4, colours          # background + walls + player + crates at least
    assert (frame.sum(axis=2) > 0).mean() > 0.1, "the level should cover a good part of the frame"
