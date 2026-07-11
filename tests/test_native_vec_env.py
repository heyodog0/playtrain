"""Tests for NativeVecEnv (the envpool-class native threadpool backend,
native/qjs/qjs_vec_host.cpp).

The load-bearing test is bit-exactness: each env in the vectorized threadpool
host must produce byte-identical obs / reward / termination to the single-env
``QuickJSEnv`` (which drives ``qjs_host serve``) for the same game + seed +
action sequence. This is what makes the fast parallel backend a drop-in for the
verified single-env one.

Skipped automatically if the shared lib isn't built (native/build_qjs_vec.sh).
"""
from __future__ import annotations

import numpy as np
import pytest

from node_gym.native_vec_env import _LIB_PATH, NativeVecEnv
from node_gym.qjs_env import QuickJSEnv, _QJS_HOST

pytestmark = pytest.mark.skipif(
    not _LIB_PATH.exists() or not _QJS_HOST.exists(),
    reason="native backend not built (run native/build_qjs.sh && native/build_qjs_vec.sh)")

GAMES = ["bigfish", "coinrun", "miner"]


@pytest.mark.parametrize("game", GAMES)
def test_bit_exact_vs_single_env(game):
    N, STEPS = 4, 200
    seeds = np.array([7, 42, 1234, 99999][:N], dtype=np.int32)

    vec = NativeVecEnv(game, num_envs=N, autoreset=False)
    singles = [QuickJSEnv(game) for _ in range(N)]
    try:
        vobs = vec.reset(seeds=seeds).copy()
        for i in range(N):
            so, _ = singles[i].reset(seed=int(seeds[i]))
            assert np.array_equal(vobs[i], so), f"{game}: reset obs mismatch env {i}"

        rng = np.random.default_rng(0)
        for t in range(STEPS):
            acts = rng.integers(0, 8, size=N)
            vo, vr, vte, vtr, _ = vec.step(acts)
            for i in range(N):
                so, sr, ste, str_, _ = singles[i].step(int(acts[i]))
                assert np.array_equal(vo[i], so), f"{game}: obs mismatch t={t} env={i}"
                assert abs(float(vr[i]) - float(sr)) < 1e-9, f"{game}: reward mismatch t={t} env={i}"
                assert bool(vte[i]) == bool(ste), f"{game}: term mismatch t={t} env={i}"
                assert bool(vtr[i]) == bool(str_), f"{game}: trunc mismatch t={t} env={i}"
    finally:
        vec.close()
        for s in singles:
            s.close()


def test_shapes_and_dtypes():
    env = NativeVecEnv("bigfish", num_envs=3)
    try:
        obs = env.reset()
        assert obs.shape == (3, 64, 64, 3) and obs.dtype == np.uint8
        o, r, te, tr, info = env.step(np.zeros(3, dtype=np.int32))
        assert o.shape == (3, 64, 64, 3)
        assert r.shape == (3,) and r.dtype == np.float32
        assert te.shape == (3,) and te.dtype == bool
        assert tr.shape == (3,) and tr.dtype == bool
    finally:
        env.close()


def test_num_threads_capped_to_envs():
    env = NativeVecEnv("coinrun", num_envs=2, num_threads=8)
    try:
        assert env.num_threads == 2  # T is capped at num_envs
    finally:
        env.close()
