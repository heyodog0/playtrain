"""The instruction channel: a game's getInstruction() as info["instruction"].

A text observation for games that give the agent an instruction (DMLab's
language levels, PLAN.md section 11 of the dmlab family). Every backend
returns it, it follows the game (seed, time, autoreset), and a game without
getInstruction gets no "instruction" key at all.
"""
from pathlib import Path

import numpy as np
import pytest

GAME = str(Path(__file__).parent / "games" / "instruction_smoke.js")


def expected(seed, frame):
    return f"pick é {seed % 5} at {frame // 10}"


def test_quickjs_env():
    from playtrain.runtime.qjs_env import QuickJSEnv
    env = QuickJSEnv(game=GAME, obs_size=64, max_steps=1000)
    try:
        _, info = env.reset(seed=7)
        assert info["instruction"] == expected(7, 1)
        for _ in range(12):
            _, _, _, _, info = env.step(0)
        assert info["instruction"].startswith("pick é 2 at ")
        assert info["instruction"] != expected(7, 1)
    finally:
        env.close()


def test_game_env():
    from playtrain.runtime import GameEnv
    env = GameEnv(game=GAME, obs_size=64)
    try:
        _, info = env.reset(seed=3)
        assert info["instruction"].startswith("pick é 3 at ")
        _, _, _, _, info = env.step(0)
        assert info["instruction"].startswith("pick é 3 at ")
    finally:
        env.close()


def test_native_vec_env_per_env():
    from playtrain.runtime import NativeVecEnv
    venv = NativeVecEnv(game=GAME, num_envs=4, num_threads=2, obs_size=64)
    try:
        venv.reset([0, 1, 2, 8])
        assert venv.has_instruction
        got = venv.instructions()
        assert [g.split(" at ")[0] for g in got] == ["pick é 0", "pick é 1", "pick é 2", "pick é 3"]
        _, _, _, _, info = venv.step(np.zeros(4, np.int64))
        assert len(info["instruction"]) == 4
    finally:
        venv.close()


def test_native_vector_env_after_autoreset():
    from playtrain.runtime.native_vector_env import NativeVectorEnv
    venv = NativeVectorEnv(game=GAME, num_envs=2, num_threads=1, obs_size=64)
    try:
        _, info = venv.reset(seed=[4, 9])
        assert [s.split(" at ")[0] for s in info["instruction"]] == ["pick é 4", "pick é 4"]
        _, _, _, _, info = venv.step(np.zeros(2, np.int64))
        assert len(info["instruction"]) == 2
    finally:
        venv.close()


@pytest.mark.parametrize("backend", ["quickjs", "native"])
def test_games_without_instruction_are_unchanged(backend):
    if backend == "quickjs":
        from playtrain.runtime.qjs_env import QuickJSEnv
        env = QuickJSEnv(game="bigfish", obs_size=64, max_steps=100)
        _, info = env.reset(seed=0)
        _, _, _, _, info2 = env.step(0)
        env.close()
        assert "instruction" not in info and "instruction" not in info2
    else:
        from playtrain.runtime import NativeVecEnv
        venv = NativeVecEnv(game="bigfish", num_envs=2, num_threads=1, obs_size=64)
        venv.reset(0)
        assert not venv.has_instruction and venv.instructions() is None
        _, _, _, _, info = venv.step(np.zeros(2, np.int64))
        venv.close()
        assert info == {}
