"""Smoke test: spawn worker, run reset() + a few step() calls on a bundled game."""
from __future__ import annotations

import numpy as np
import pytest

from playtrain.runtime import (
    PlayTrainEnv,
    list_available_games,
)


@pytest.fixture
def env():
    e = PlayTrainEnv(game="flappy_bird", obs_size=64, obs_mode="rgb")
    yield e
    e.close()


def test_list_available_games_nonempty():
    games = list_available_games()
    assert len(games) >= 10
    assert "flappy_bird" in games


def test_reset_returns_valid_obs(env):
    obs, info = env.reset(seed=0)
    assert obs.shape == (64, 64, 3)
    assert obs.dtype == np.uint8
    assert isinstance(info, dict)


def test_step_loop(env):
    env.reset(seed=0)
    total_reward = 0.0
    for _ in range(20):
        action = int(env.action_space.sample())
        obs, reward, terminated, truncated, info = env.step(action)
        assert obs.shape == (64, 64, 3)
        assert isinstance(reward, float)
        total_reward += reward
        if terminated or truncated:
            env.reset()
    # No assertion on reward magnitude — just that the loop runs without error.


def test_observation_space_matches(env):
    obs, _ = env.reset(seed=0)
    assert env.observation_space.contains(obs)


def test_grayscale_mode():
    env = PlayTrainEnv(game="flappy_bird", obs_size=32, obs_mode="grayscale")
    try:
        obs, _ = env.reset(seed=0)
        assert obs.shape == (32, 32, 1) or obs.shape == (32, 32)
    finally:
        env.close()


def test_frame_stack():
    env = PlayTrainEnv(game="flappy_bird", obs_size=64, frame_stack=4)
    try:
        obs, _ = env.reset(seed=0)
        assert obs.shape == (64, 64, 12)
    finally:
        env.close()


@pytest.mark.parametrize("game", list_available_games())
def test_every_bundled_game_boots(game):
    """Each bundled p5 game must reset + take 10 random steps without crashing."""
    env = PlayTrainEnv(game=game, obs_size=64, obs_mode="rgb")
    try:
        obs, info = env.reset(seed=0)
        assert obs.shape == (64, 64, 3)
        for _ in range(10):
            action = int(env.action_space.sample())
            obs, reward, terminated, truncated, info = env.step(action)
            assert obs.shape == (64, 64, 3)
            assert isinstance(reward, float)
            if terminated or truncated:
                env.reset(seed=0)
    finally:
        env.close()

