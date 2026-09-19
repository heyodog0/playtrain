"""The bundles are ordinary PlayTrain games: discoverable by name, steppable, sidecar honoured."""
import numpy as np
import pytest

from playtrain.runtime import list_available_games
from playtrain.runtime.env import load_sidecar, resolve_game_file


def test_discoverable_by_name():
    names = list_available_games()
    assert "vgdl_aliens" in names and "vgdl_vgfmri3_zelda" in names


def test_sidecar_declares_space_and_reference():
    side = load_sidecar(resolve_game_file("vgdl_aliens"))
    assert side["action_space"] == "vgdl6" and len(side["actions"]) == 6
    assert side["parity"] is True and side["reference"]["commit"].startswith("97fb71d")
    side = load_sidecar(resolve_game_file("vgdl_vgfmri3_zelda"))
    assert side["parity"] is True and side["profile"] == "rcrl" and side["reference"]["commit"].startswith("3388f9c")


def test_native_vec_steps_and_resets():
    try:
        from playtrain.runtime import NativeVecEnv
        v = NativeVecEnv(game="vgdl_aliens", num_envs=4, num_threads=2, obs_size=64, autoreset=True, action_space="vgdl6")
    except Exception as e:  # noqa: BLE001
        pytest.skip(f"native backend unavailable: {e}")
    v.reset([0, 1, 2, 3])
    rng = np.random.default_rng(0)
    total = 0.0
    for _ in range(200):
        out = v.step(rng.integers(0, 6, size=4))
        obs, rew = out[0], out[1]
        total += float(rew.sum())
    v.close()
    assert obs.shape == (4, 64, 64, 3) and obs.dtype == np.uint8
