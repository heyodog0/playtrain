"""Tests for configurable discrete action spaces (runtime/action_spaces.json).

Covers the loader, the frozen default8 mapping, a non-default space threaded
through every backend (Discrete(n), meanings, stepping), cross-backend
bit-exactness on a non-default space, and out-of-range rejection.

Native-backend tests are skipped if the native build is missing.
"""
from __future__ import annotations

import numpy as np
import pytest

from playtrain.runtime.action_space import (
    action_names, is_default, load_action_space, packed_tables)
from playtrain.runtime.native_vec_env import _LIB_PATH, NativeVecEnv
from playtrain.runtime.qjs_env import QuickJSEnv, _QJS_HOST

_native = pytest.mark.skipif(
    not _LIB_PATH.exists() or not _QJS_HOST.exists(),
    reason="native backend not built (run native/build_qjs.sh && native/build_qjs_vec.sh)")

DEFAULT8_NAMES = ("NOOP", "LEFT", "RIGHT", "UP", "DOWN", "D", "LEFT_D", "RIGHT_D")


def test_default8_is_frozen():
    acts = load_action_space()
    assert action_names(acts) == DEFAULT8_NAMES
    assert [a["held"] for a in acts] == [[], [37], [39], [38], [40], [], [37], [39]]
    assert [a["press"] for a in acts] == [None] * 5 + [32] * 3
    assert is_default(acts)


def test_loader_forms():
    assert load_action_space("default8") == load_action_space()
    ten = load_action_space("thrust10")
    assert len(ten) == 10 and not is_default(ten)
    inline = load_action_space([{"name": "GO", "held": [38], "press": 32}])
    assert inline[0]["held"] == [38]
    with pytest.raises(ValueError):
        load_action_space("no_such_space")
    with pytest.raises(ValueError):
        load_action_space([{"name": "BAD", "held": [999], "press": None}])


def test_packed_tables_shape():
    held, press, n, max_held = packed_tables(load_action_space("thrust10"))
    assert (n, max_held) == (10, 1)
    assert held.dtype == np.int32 and held.shape == (10,)
    assert press.tolist()[5:] == [32, 32, 32, 32, 32]


@_native
def test_quickjs_env_custom_space():
    env = QuickJSEnv("bigfish", action_space="thrust10")
    try:
        assert env.action_space.n == 10
        _, info = env.reset(seed=7)
        assert info["actionMeanings"][8:] == ["UP_D", "DOWN_D"]
        for a in (8, 9):
            env.step(a)
        with pytest.raises(ValueError):
            env.step(10)
    finally:
        env.close()


@_native
def test_native_vec_custom_space_bit_exact_vs_single():
    """thrust10 through the vec host matches the single-env host step for step."""
    N, STEPS = 2, 100
    seeds = np.array([7, 42], dtype=np.int32)
    vec = NativeVecEnv("bigfish", num_envs=N, action_space="thrust10", autoreset=False)
    singles = [QuickJSEnv("bigfish", action_space="thrust10") for _ in range(N)]
    try:
        assert vec.n_actions == 10
        vobs = vec.reset(seeds=seeds).copy()
        for i in range(N):
            so, _ = singles[i].reset(seed=int(seeds[i]))
            assert np.array_equal(vobs[i], so)
        rng = np.random.default_rng(0)
        for _ in range(STEPS):
            acts = rng.integers(0, 10, size=N)
            vobs, vrew, vterm, _, _ = vec.step(acts)
            for i in range(N):
                if vterm[i]:
                    return  # per-env episode ends diverge the lockstep; enough covered
                so, sr, st, _, _ = singles[i].step(int(acts[i]))
                assert np.array_equal(vobs[i], so)
                assert vrew[i] == pytest.approx(sr)
    finally:
        vec.close()
        for s in singles:
            s.close()


@_native
def test_native_vec_rejects_out_of_range():
    vec = NativeVecEnv("bigfish", num_envs=2, autoreset=True)
    try:
        vec.reset(seeds=[1, 2])
        with pytest.raises(ValueError, match="out of range"):
            vec.step([0, 8])
        with pytest.raises(ValueError, match="out of range"):
            vec.step([-1, 0])
    finally:
        vec.close()


@_native
def test_default_unchanged_with_explicit_default8():
    """action_space='default8' must be byte-identical to passing nothing."""
    a = QuickJSEnv("bigfish")
    b = QuickJSEnv("bigfish", action_space="default8")
    try:
        oa, _ = a.reset(seed=3)
        ob, _ = b.reset(seed=3)
        assert np.array_equal(oa, ob)
        for act in (5, 6, 7, 3):  # press-family actions exercise the union path
            ra = a.step(act)
            rb = b.step(act)
            assert np.array_equal(ra[0], rb[0]) and ra[1] == rb[1]
    finally:
        a.close()
        b.close()
