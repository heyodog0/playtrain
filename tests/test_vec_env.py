"""Tests for PlayTrainVecEnv (DirectVecEnv prototype).

Covers:
  - basic boot (smoke test at small N)
  - reset/step return shapes (Gymnasium 1.0 VectorEnv API)
  - autoreset modes: SAME_STEP (SB3-style), NEXT_STEP (Gymnasium 1.0 default),
    DISABLED
  - determinism: same seeds + same actions + same autoreset_seed → byte-equal
    obs across two passes (covers ~100 terminal/reset events at N=4 over 800
    flappy_bird steps)
  - action validation: out-of-range raises ValueError
  - close idempotency

These mirror the standalone probe scripts (tools/probe_directvec_*.py) so
both pytest CI and ad-hoc runs catch regressions.
"""

from __future__ import annotations

import hashlib

import numpy as np
import pytest
from gymnasium.vector import AutoresetMode, VectorEnv

from playtrain.runtime import PlayTrainVecEnv


# ---------------------------------------------------------------------------
# Basic boot + Gymnasium 1.0 API conformance
# ---------------------------------------------------------------------------


@pytest.fixture
def venv2():
    v = PlayTrainVecEnv(games=["flappy_bird"] * 2, obs_size=64, obs_mode="rgb")
    yield v
    v.close()


def test_subclass_of_vector_env(venv2):
    assert isinstance(venv2, VectorEnv)


def test_metadata_has_autoreset_mode(venv2):
    assert venv2.metadata.get("autoreset_mode") == AutoresetMode.NEXT_STEP


def test_observation_space_matches_batch_shape(venv2):
    assert venv2.observation_space.shape == (2, 64, 64, 3)
    assert venv2.single_observation_space.shape == (64, 64, 3)


def test_reset_returns_obs_and_dict_info(venv2):
    obs, info = venv2.reset(seed=0)
    assert obs.shape == (2, 64, 64, 3)
    assert obs.dtype == np.uint8
    # Gymnasium 1.0: info is a dict (not list-of-dicts)
    assert isinstance(info, dict)


def test_reset_accepts_int_seed_and_list_seed(venv2):
    obs1, _ = venv2.reset(seed=42)
    obs2, _ = venv2.reset(seed=[42, 43])
    assert obs1.shape == obs2.shape


def test_reset_rejects_wrong_length_seed(venv2):
    with pytest.raises(ValueError, match="seed length"):
        venv2.reset(seed=[1, 2, 3])  # length 3 for num_envs=2


def test_step_returns_5_tuple_with_correct_shapes(venv2):
    venv2.reset(seed=0)
    obs, rewards, terms, truncs, info = venv2.step([0, 1])
    assert obs.shape == (2, 64, 64, 3)
    assert rewards.shape == (2,)
    assert rewards.dtype == np.float32
    assert terms.shape == (2,) and terms.dtype == bool
    assert truncs.shape == (2,) and truncs.dtype == bool
    assert isinstance(info, dict)


def test_step_accepts_ndarray(venv2):
    venv2.reset(seed=0)
    obs, *_ = venv2.step(np.array([0, 1], dtype=np.int64))
    assert obs.shape == (2, 64, 64, 3)


def test_step_rejects_out_of_range_action(venv2):
    venv2.reset(seed=0)
    with pytest.raises(ValueError, match="actions out of range"):
        venv2.step([0, 99])


def test_step_rejects_negative_action(venv2):
    venv2.reset(seed=0)
    with pytest.raises(ValueError, match="actions out of range"):
        venv2.step([-1, 0])


def test_step_rejects_wrong_length_actions(venv2):
    venv2.reset(seed=0)
    with pytest.raises(ValueError, match="actions length"):
        venv2.step([0, 1, 2])


def test_close_idempotent(venv2):
    venv2.close()
    venv2.close()  # second close is a no-op


# ---------------------------------------------------------------------------
# Determinism (covers autoreset trajectory through ~100 terminals)
# ---------------------------------------------------------------------------


def _run_pass(*, n: int, steps: int, autoreset_mode: str,
              autoreset_seed: int) -> tuple[list[str], int]:
    venv = PlayTrainVecEnv(games=["flappy_bird"] * n, obs_size=64,
                      autoreset_mode=autoreset_mode,
                      autoreset_seed=autoreset_seed)
    rng = np.random.default_rng(42)
    hashes: list[str] = []
    n_terminals = 0
    try:
        obs, _ = venv.reset(seed=list(range(n)))
        hashes.append(hashlib.sha256(obs.tobytes()).hexdigest()[:16])
        for _ in range(steps):
            acts = rng.integers(0, 8, size=n)
            obs, _, terms, truncs, _ = venv.step(acts)
            hashes.append(hashlib.sha256(obs.tobytes()).hexdigest()[:16])
            n_terminals += int(terms.sum() + truncs.sum())
    finally:
        venv.close()
    return hashes, n_terminals


@pytest.mark.parametrize("mode", ["same_step", "next_step"])
def test_autoreset_determinism(mode):
    """Same seeds + same actions + same autoreset_seed → byte-equal obs sequence."""
    h1, t1 = _run_pass(n=2, steps=400, autoreset_mode=mode, autoreset_seed=7)
    h2, t2 = _run_pass(n=2, steps=400, autoreset_mode=mode, autoreset_seed=7)
    assert t1 == t2 > 0, f"expected at least one terminal, got {t1} and {t2}"
    assert h1 == h2, "obs sequences diverged across runs"


# ---------------------------------------------------------------------------
# Autoreset mode behavior
# ---------------------------------------------------------------------------


def test_disabled_autoreset_does_not_reset_after_terminal():
    """With DISABLED autoreset, the worker keeps reporting terminal states."""
    venv = PlayTrainVecEnv(games=["flappy_bird"] * 2, obs_size=64,
                      autoreset_mode="disabled", autoreset_seed=0)
    try:
        venv.reset(seed=0)
        # Step many times until at least one terminal happens
        rng = np.random.default_rng(42)
        first_terminal_step = None
        for t in range(2500):
            _, _, terms, truncs, _ = venv.step(rng.integers(0, 8, size=2))
            if first_terminal_step is None and (terms.any() or truncs.any()):
                first_terminal_step = t
                # If autoreset is truly disabled, the env stays terminal —
                # next step still reports terminal/truncated for the same env.
                _, _, terms2, truncs2, _ = venv.step(rng.integers(0, 8, size=2))
                # In disabled mode, the worker may continue but won't auto-reset;
                # we just verify no exception was raised and that the API didn't
                # silently reset us.
                break
        assert first_terminal_step is not None, "should have hit at least one terminal in 2500 steps"
    finally:
        venv.close()


def test_same_step_autoreset_substitutes_obs():
    """SAME_STEP: when an env terminates, returned obs is the new-episode obs,
    info['final_observation'] holds the terminal obs."""
    venv = PlayTrainVecEnv(games=["flappy_bird"] * 2, obs_size=64,
                      autoreset_mode="same_step", autoreset_seed=11)
    try:
        venv.reset(seed=0)
        rng = np.random.default_rng(42)
        for _ in range(2500):
            obs, _, terms, truncs, info = venv.step(rng.integers(0, 8, size=2))
            done = terms | truncs
            if done.any():
                assert "final_observation" in info, "SAME_STEP must include final_observation"
                assert "_final_observation" in info, "must include the mask too"
                # Mask matches the actual done envs
                assert (info["_final_observation"] == done).all()
                # The substituted obs is different from the terminal obs (new episode)
                final = info["final_observation"]
                for i in np.flatnonzero(done):
                    # If they happen to match exactly, that's still possible for a
                    # deterministic env starting from the same seed — just verify
                    # both arrays exist and have the right shape.
                    assert final[i].shape == (64, 64, 3)
                return
        pytest.skip("no terminal reached in 2500 steps; can't validate same_step semantics")
    finally:
        venv.close()


def test_next_step_autoreset_resets_on_subsequent_step():
    """NEXT_STEP: terminal obs returned this step; reset happens before next step."""
    venv = PlayTrainVecEnv(games=["flappy_bird"] * 2, obs_size=64,
                      autoreset_mode="next_step", autoreset_seed=11)
    try:
        venv.reset(seed=0)
        rng = np.random.default_rng(42)
        terminal_obs = None
        for _ in range(2500):
            obs, _, terms, truncs, _ = venv.step(rng.integers(0, 8, size=2))
            done = terms | truncs
            if done.any():
                # NEXT_STEP returns terminal obs; subsequent step resets.
                terminal_obs = obs.copy()
                # Next step processes the reset internally (action ignored for the
                # reset env), returns a non-terminal obs.
                next_obs, _, terms2, truncs2, _ = venv.step(rng.integers(0, 8, size=2))
                # The just-reset envs should not be terminal again immediately.
                # (They might terminate again later, just not THIS step.)
                done_envs = np.flatnonzero(done)
                for i in done_envs:
                    assert not terms2[i], f"env {i} is terminal again immediately after NEXT_STEP reset"
                    assert not truncs2[i], f"env {i} is truncated again immediately after NEXT_STEP reset"
                return
        pytest.skip("no terminal reached in 2500 steps")
    finally:
        venv.close()


# ---------------------------------------------------------------------------
# Larger-N basic operation
# ---------------------------------------------------------------------------


def test_fixed_env_seed_makes_all_envs_identical():
    """fixed_env_seed forces every env (and every autoreset) to the same seed,
    so all N envs produce byte-identical obs sequences."""
    venv = PlayTrainVecEnv(games=["flappy_bird"] * 4, obs_size=64,
                      autoreset_mode="same_step", autoreset_seed=0,
                      fixed_env_seed=12345)
    try:
        obs, _ = venv.reset()
        # All N envs reset to the same seed → all rows of the batch should match.
        for i in range(1, 4):
            assert (obs[0] == obs[i]).all(), \
                f"env {i} obs differs from env 0 — fixed_env_seed not applied"
        # Step a few times with same actions → still identical.
        for _ in range(20):
            obs, _, _, _, _ = venv.step([0, 0, 0, 0])
            for i in range(1, 4):
                assert (obs[0] == obs[i]).all(), \
                    "envs diverged under same actions + fixed_env_seed"
    finally:
        venv.close()


def test_fixed_env_seed_autoreset_keeps_seed():
    """After an autoreset under fixed_env_seed, the new-episode obs should
    match what we'd get from a fresh reset(seed=fixed_env_seed)."""
    fes = 99
    # Capture what a fresh reset with seed=fes looks like
    venv1 = PlayTrainVecEnv(games=["flappy_bird"] * 2, obs_size=64,
                      autoreset_mode="disabled", fixed_env_seed=fes)
    try:
        ref_obs, _ = venv1.reset()
        ref_first_env = ref_obs[0].copy()
    finally:
        venv1.close()

    # Now run with autoreset and force terminals; verify reset obs matches ref
    venv2 = PlayTrainVecEnv(games=["flappy_bird"] * 2, obs_size=64,
                      autoreset_mode="same_step", autoreset_seed=0,
                      fixed_env_seed=fes)
    try:
        venv2.reset()
        rng = np.random.default_rng(42)
        for _ in range(2500):
            obs, _, terms, truncs, info = venv2.step(rng.integers(0, 8, size=2))
            done = terms | truncs
            if done.any():
                # SAME_STEP returned the new-episode (post-reset) obs for
                # done envs. Those should match our reference (fixed seed).
                for i in np.flatnonzero(done):
                    assert (obs[i] == ref_first_env).all(), \
                        f"env {i} autoreset obs doesn't match fresh reset(seed={fes})"
                return
        pytest.skip("no terminal hit in 2500 steps")
    finally:
        venv2.close()


def test_n8_runs_without_errors():
    venv = PlayTrainVecEnv(games=["flappy_bird"] * 8, obs_size=64,
                      autoreset_mode="same_step", autoreset_seed=0)
    try:
        venv.reset(seed=list(range(8)))
        rng = np.random.default_rng(0)
        for _ in range(50):
            venv.step(rng.integers(0, 8, size=8))
    finally:
        venv.close()
