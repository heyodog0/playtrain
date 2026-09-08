"""Tests for configurable discrete action spaces (runtime/action_spaces.json).

Covers the loader, the frozen default8 mapping, a non-default space threaded
through every backend (Discrete(n), meanings, stepping), cross-backend
bit-exactness on a non-default space, and out-of-range rejection.

Native-backend tests are skipped if the native build is missing.
"""
from __future__ import annotations

import numpy as np
import pytest

from pathlib import Path

from playtrain.runtime.action_space import (
    action_names, is_default, load_action_space, load_space_spec,
    packed_tables, quantize, quantize_box_actions)
from playtrain.runtime.native_vec_env import _LIB_PATH, NativeVecEnv
from playtrain.runtime.qjs_env import QuickJSEnv, _QJS_HOST

# The pointer-tier reference game. It is not in the shipped catalog (that is the
# paper's set), so these tests address it by path.
_AIM = str(Path(__file__).parent / "games" / "aim_trainer.js")

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


def test_quantization_contract():
    # The wire formula: q = floor(clamp(v01)*65535 + 0.5).
    assert quantize(0.0) == 0 and quantize(1.0) == 65535
    assert quantize(0.5) == 32768
    assert quantize(-2.0) == 0 and quantize(2.0) == 65535
    q = quantize_box_actions(np.array([0.5, 0.5, 0.0]),
                             ["pointer_x", "pointer_y", "button:mouse"])
    # axes/buttons map [-1,1] -> [0,1]; 0.0 is exactly the center/threshold
    assert q.tolist() == [32768, 32768, 32768]


def test_box_spec_loader():
    spec = load_space_spec("mouse2d")
    assert spec["type"] == "box"
    assert spec["channels"] == ["pointer_x", "pointer_y", "button:mouse"]
    with pytest.raises(ValueError):
        load_action_space("mouse2d")  # discrete loader must reject box spaces
    with pytest.raises(ValueError):
        load_space_spec({"type": "box", "channels": ["warp_drive"]})


def test_analog_discrete_spec():
    acts = load_action_space("aimgrid18")
    assert len(acts) == 18
    assert acts[0]["pointer"] == [0.17, 0.17] and "buttons" not in acts[0]
    assert acts[9]["buttons"] == ["mouse"]


@_native
def test_box_bit_exact_vec_vs_single():
    """mouse2d through the vec host matches the single-env host step for step."""
    from playtrain.runtime.action_space import quantize_box_actions as _q  # noqa: F401
    N, STEPS = 2, 120
    seeds = np.array([7, 42], dtype=np.int32)
    vec = NativeVecEnv(_AIM, num_envs=N, action_space="mouse2d", autoreset=False)
    singles = [QuickJSEnv(_AIM, action_space="mouse2d") for _ in range(N)]
    try:
        vobs = vec.reset(seeds=seeds).copy()
        for i in range(N):
            so, _ = singles[i].reset(seed=int(seeds[i]))
            assert np.array_equal(vobs[i], so)
        rng = np.random.default_rng(3)
        for _ in range(STEPS):
            acts = np.column_stack([rng.uniform(0, 1, N), rng.uniform(0, 1, N),
                                    rng.uniform(-1, 1, N)])
            vobs, vrew, vterm, _, _ = vec.step(acts)
            for i in range(N):
                if vterm[i]:
                    return
                so, sr, st, _, _ = singles[i].step(acts[i])
                assert np.array_equal(vobs[i], so)
                assert vrew[i] == pytest.approx(sr)
    finally:
        vec.close()
        for s in singles:
            s.close()


@_native
def test_pointer_game_scores_with_pointer_input():
    """Clicking on the target through the box path scores; keyboard can't."""
    env = QuickJSEnv(_AIM, action_space="mouse2d")
    try:
        env.reset(seed=42)
        hit = False
        for gx in range(16):
            for gy in range(16):
                _, r, t, tr, _ = env.step([(gx + 0.5) / 16, (gy + 0.5) / 16, 1.0])
                if r > 0:
                    hit = True
                    break
                if t or tr:
                    break
            if hit:
                break
        assert hit, "grid sweep of clicks never hit the target"
    finally:
        env.close()


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
